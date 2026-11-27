// Autenticação do painel.
// • Senhas com argon2id (nunca guardamos a senha).
// • Sessão = token aleatório de 256 bits em cookie HttpOnly + SameSite=Strict;
//   no banco fica só o hash SHA-256 do token (vazamento do banco não dá acesso).
// • Bloqueio da conta após tentativas erradas + limite por IP (security.js).
// • Trocar a senha encerra todas as outras sessões.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { query, one } from "./db.js";
import { config } from "./config.js";
import { audit } from "./audit.js";

export const COOKIE_NAME = config.sessionCookieName;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => argon2.hash(password, ARGON_OPTS);
export const sha256 = (value) => createHash("sha256").update(value).digest();

// Hash "isca" para gastar o mesmo tempo quando o e-mail não existe (evita descobrir contas).
let dummyHash;
const getDummyHash = async () => (dummyHash ||= await hashPassword(randomBytes(16).toString("hex")));

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setSessionCookie(res, token, maxAgeSeconds) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.isProd) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

export const clearSessionCookie = (res) => setSessionCookie(res, "", 0);

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function login(req, res, email, password) {
  const user = await one(
    "SELECT id, email, name, password_hash, active, failed_attempts, locked_until FROM admin_users WHERE email = $1",
    [email]
  );
  const generic = new AuthError("E-mail ou senha incorretos.");

  if (!user || !user.active) {
    await argon2.verify(await getDummyHash(), password).catch(() => false);
    await audit(req, null, "login_falhou", email);
    throw generic;
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await audit(req, user.id, "login_bloqueado", email);
    throw new AuthError(`Conta bloqueada temporariamente por excesso de tentativas. Tente após ${LOCK_MINUTES} minutos.`, 423);
  }

  const ok = await argon2.verify(user.password_hash, password).catch(() => false);
  if (!ok) {
    const failed = user.failed_attempts + 1;
    const lock = failed >= MAX_FAILED;
    await query(
      `UPDATE admin_users
          SET failed_attempts = $2::int,
              locked_until = CASE WHEN $3::boolean THEN now() + make_interval(mins => $4::int) ELSE locked_until END
        WHERE id = $1`,
      [user.id, lock ? 0 : failed, lock, LOCK_MINUTES]
    );
    await audit(req, user.id, lock ? "conta_bloqueada" : "login_falhou", email);
    throw generic;
  }

  if (argon2.needsRehash(user.password_hash, ARGON_OPTS)) {
    await query("UPDATE admin_users SET password_hash = $2 WHERE id = $1", [user.id, await hashPassword(password)]);
  }

  const token = randomBytes(32).toString("base64url");
  const maxAge = config.sessionHours * 3600;
  await query(
    `INSERT INTO admin_sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5)`,
    [user.id, sha256(token), maxAge, req.ip || null, String(req.get("user-agent") || "").slice(0, 300)]
  );
  await query("UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [user.id]);
  await audit(req, user.id, "login", email);
  setSessionCookie(res, token, maxAge);
  return { id: user.id, email: user.email, name: user.name };
}

export async function logout(req, res) {
  const token = readCookie(req, COOKIE_NAME);
  if (token) await query("DELETE FROM admin_sessions WHERE token_hash = $1", [sha256(token)]);
  clearSessionCookie(res);
}

/** Middleware: exige sessão de administrador válida (consultando o banco a cada requisição). */
export async function requireAdmin(req, res, next) {
  try {
    const token = readCookie(req, COOKIE_NAME);
    if (!token || token.length > 100) throw new AuthError("Faça login para continuar.");
    const session = await one(
      `SELECT s.id AS session_id, s.last_seen_at, u.id, u.email, u.name
         FROM admin_sessions s
         JOIN admin_users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.expires_at > now()
          AND u.active
          AND s.created_at >= u.password_changed_at`,
      [sha256(token)]
    );
    if (!session) {
      clearSessionCookie(res);
      throw new AuthError("Sessão expirada. Faça login novamente.");
    }
    if (Date.now() - new Date(session.last_seen_at).getTime() > 5 * 60_000) {
      await query("UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1", [session.session_id]);
    }
    req.admin = { id: session.id, email: session.email, name: session.name, sessionId: session.session_id };
    next();
  } catch (err) {
    next(err);
  }
}

/** Verifica sessão sem bloquear (para servir logos de clientes só a admins). */
export async function isAdminRequest(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token || token.length > 100) return false;
  const row = await one(
    `SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active AND s.created_at >= u.password_changed_at`,
    [sha256(token)]
  );
  return !!row;
}

export async function changePassword(req, res, currentPassword, newPassword) {
  const user = await one("SELECT id, password_hash FROM admin_users WHERE id = $1", [req.admin.id]);
  if (!user || !(await argon2.verify(user.password_hash, currentPassword).catch(() => false))) {
    await audit(req, req.admin.id, "troca_senha_falhou");
    throw new AuthError("Senha atual incorreta.", 400);
  }
  await query("UPDATE admin_users SET password_hash = $2, password_changed_at = now() WHERE id = $1", [
    user.id,
    await hashPassword(newPassword),
  ]);
  // Encerra todas as sessões (inclusive em outros aparelhos) e abre uma nova aqui.
  await query("DELETE FROM admin_sessions WHERE user_id = $1", [user.id]);
  const token = randomBytes(32).toString("base64url");
  const maxAge = config.sessionHours * 3600;
  await query(
    `INSERT INTO admin_sessions (user_id, token_hash, expires_at, ip, user_agent, created_at)
     VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5, now() + interval '1 millisecond')`,
    [user.id, sha256(token), maxAge, req.ip || null, String(req.get("user-agent") || "").slice(0, 300)]
  );
  setSessionCookie(res, token, maxAge);
  await audit(req, user.id, "senha_alterada");
}

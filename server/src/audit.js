// Registro de auditoria: quem fez o quê no painel (e tentativas de login).
import { query } from "./db.js";

export async function audit(req, userId, action, target = null, details = null) {
  try {
    await query("INSERT INTO audit_log (user_id, action, target, details, ip) VALUES ($1, $2, $3, $4, $5)", [
      userId,
      String(action).slice(0, 80),
      target == null ? null : String(target).slice(0, 120),
      details,
      req?.ip || null,
    ]);
  } catch (err) {
    console.error("Falha ao gravar auditoria", err.message);
  }
}

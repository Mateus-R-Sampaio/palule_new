// Configuração por variáveis de ambiente (veja server/.env.example).
// Nada sensível fica no código ou no navegador.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = join(here, "..");
export const ROOT_DIR = join(here, "..", "..");

// Carrega server/.env em desenvolvimento (sem dependência extra).
const envFile = join(SERVER_DIR, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const env = process.env;
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
const int = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);

export const config = {
  env: env.NODE_ENV || "development",
  isProd: (env.NODE_ENV || "development") === "production",
  port: int(env.PORT, 3000),
  databaseUrl: env.DATABASE_URL || "",
  databaseSsl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } : false,
  // Origens extras autorizadas a chamar a API pública (ex.: a loja hospedada no GitHub Pages).
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  // Atrás de proxy (Render, Railway, Nginx…): número de proxies confiáveis.
  trustProxy: int(env.TRUST_PROXY, 1),
  sessionHours: int(env.SESSION_HOURS, 12),
  // Segredo para "pseudonimizar" IPs gravados nos pedidos (LGPD).
  ipHashSecret: env.IP_HASH_SECRET || "",
  paymentWebhookSecret: env.PAYMENT_WEBHOOK_SECRET || "",
  orderRateLimit: int(env.ORDER_RATE_LIMIT, 60), // pedidos por IP a cada 15 min (totens compartilham IP)
  loginRateLimit: int(env.LOGIN_RATE_LIMIT, 10), // tentativas de login por IP a cada 15 min
  storeName: env.STORE_NAME || "Studio Personalizado",
};

export function assertConfig() {
  const problems = [];
  if (!config.databaseUrl) problems.push("DATABASE_URL não definido");
  if (config.isProd && config.ipHashSecret.length < 32) problems.push("IP_HASH_SECRET precisa ter 32+ caracteres em produção");
  if (problems.length) {
    console.error(`Configuração inválida:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
}

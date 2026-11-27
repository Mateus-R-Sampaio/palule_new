// Cria (ou redefine a senha de) um administrador.
// Uso: npm run create-admin -- email@loja.com.br
//      (a senha é pedida no terminal; em automação use a variável ADMIN_PASSWORD)

import { createInterface } from "node:readline";
import { pool, query } from "./db.js";
import { assertConfig } from "./config.js";
import { migrate } from "./migrate.js";
import { hashPassword } from "./auth.js";

assertConfig();
await migrate({ log: () => {} });

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error("Informe um e-mail válido: npm run create-admin -- email@loja.com.br");
  process.exit(1);
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const write = rl._writeToOutput?.bind(rl);
  rl._writeToOutput = (s) => (s.includes(question) ? write?.(s) : write?.("*"));
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write("\n");
  return answer;
}

const password = process.env.ADMIN_PASSWORD || (await ask("Senha (mín. 12 caracteres, letras e números): "));
if (password.length < 12 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
  console.error("Senha fraca: use pelo menos 12 caracteres com letras e números.");
  process.exit(1);
}

const name = process.argv[3] || "";
await query(
  `INSERT INTO admin_users (email, name, password_hash) VALUES ($1, $2, $3)
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_changed_at = now(),
     failed_attempts = 0, locked_until = NULL, active = true`,
  [email, name, await hashPassword(password)]
);
console.log(`Administrador ${email} pronto. Sessões antigas dessa conta foram encerradas.`);
await pool.end();

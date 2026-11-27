// Conexão com o PostgreSQL. Todas as consultas usam parâmetros ($1, $2…):
// nenhum valor vindo do usuário é concatenado em SQL.

import pg from "pg";
import { config } from "./config.js";

// numeric → number (preços até 100.000 cabem com folga em double)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl,
  max: 10,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
  application_name: "studio-personalizado",
});

pool.on("error", (err) => console.error("Erro no pool do PostgreSQL", err));

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

/** Executa fn dentro de uma transação (ROLLBACK automático em erro). */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

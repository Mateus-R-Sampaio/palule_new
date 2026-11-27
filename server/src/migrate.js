// Aplica as migrações SQL de server/migrations em ordem (uma vez cada).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { pool } from "./db.js";
import { SERVER_DIR, assertConfig } from "./config.js";

export async function migrate({ log = console.log } = {}) {
  const dir = join(SERVER_DIR, "migrations");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727274)"); // evita duas instâncias migrando juntas
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(join(dir, file), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
        await client.query("COMMIT");
        log(`Migração aplicada: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Falha na migração ${file}: ${err.message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    client.release();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertConfig();
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

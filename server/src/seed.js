// Carrega o catálogo inicial NO BANCO (produtos, estampas, mockups e configurações).
// Os arquivos de img/ são apenas a fonte desta importação: depois disso, tudo vive no PostgreSQL.
// Uso: npm run seed            (só importa se o banco estiver vazio)
//      npm run seed -- --force (reimporta produtos/estampas padrão, sem apagar os existentes)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pool, tx } from "./db.js";
import { ROOT_DIR, assertConfig } from "./config.js";
import { migrate } from "./migrate.js";
import { storeFile } from "./files.js";
import { DEFAULT_PRODUCTS, DEFAULT_ARTS, DEFAULT_SETTINGS } from "../../js/defaults.js";

assertConfig();
await migrate();
const force = process.argv.includes("--force");

const { rows } = await pool.query("SELECT (SELECT count(*) FROM products)::int AS p, (SELECT count(*) FROM arts)::int AS a");
if (!force && (rows[0].p || rows[0].a)) {
  console.log("O banco já tem catálogo. Nada foi importado (use --force para reimportar o padrão).");
  await pool.end();
  process.exit(0);
}

const mockupCache = new Map();
await tx(async (client) => {
  const fileFor = async (relPath, kind) => {
    if (mockupCache.has(relPath)) return mockupCache.get(relPath);
    const buffer = readFileSync(join(ROOT_DIR, relPath));
    const stored = await storeFile({ buffer, kind, originalName: relPath.split("/").pop() }, client);
    mockupCache.set(relPath, stored.url);
    return stored.url;
  };

  const { catalogInitialized, updatedAt, ...settings } = DEFAULT_SETTINGS;
  await client.query("INSERT INTO settings (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING", [JSON.stringify(settings)]);

  for (const p of DEFAULT_PRODUCTS) {
    const mockups = {
      front: p.mockups.front ? await fileFor(p.mockups.front, "mockup") : null,
      back: p.mockups.back ? await fileFor(p.mockups.back, "mockup") : null,
    };
    const { id, name, price, active, order, ...config } = { ...p, mockups };
    await client.query(
      `INSERT INTO products (id, name, price, active, sort_order, config) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
      [id, name, price, active, order, JSON.stringify(config)]
    );
  }

  for (const a of DEFAULT_ARTS) {
    const url = await fileFor(a.url, "art");
    await client.query(
      `INSERT INTO arts (id, name, category, file_id, active, sort_order) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.name, a.category, url.split("/").pop(), a.active, a.order]
    );
  }
});

console.log(`Importados: ${DEFAULT_PRODUCTS.length} produtos e ${DEFAULT_ARTS.length} estampas.`);
await pool.end();

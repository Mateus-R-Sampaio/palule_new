// Inicia a API + site.
import { config, assertConfig } from "./config.js";
import { migrate } from "./migrate.js";
import { createApp } from "./app.js";
import { pool, query } from "./db.js";
import { cleanupOrphanLogos } from "./files.js";

assertConfig();
await migrate();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Studio Personalizado rodando na porta ${config.port} (${config.env})`);
});
server.headersTimeout = 20_000;
server.requestTimeout = 60_000;

// Manutenção: sessões vencidas e logos de clientes nunca usadas
async function housekeeping() {
  try {
    await query("DELETE FROM admin_sessions WHERE expires_at < now()");
    await cleanupOrphanLogos();
  } catch (err) {
    console.error("Manutenção falhou:", err.message);
  }
}
housekeeping();
const timer = setInterval(housekeeping, 60 * 60_000);

const shutdown = () => {
  clearInterval(timer);
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

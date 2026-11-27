// Leitura do catálogo e das configurações a partir do banco.

import { query, one } from "./db.js";
import { DEFAULT_SETTINGS } from "../../js/defaults.js";
import { getAvailableFonts } from "../../js/fonts.js";
import { fileUrlFor } from "./files.js";

export function mergeSettings(saved) {
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const s = { ...base, ...(saved || {}) };
  for (const key of ["modes", "payments", "pix", "contact"]) s[key] = { ...base[key], ...(saved?.[key] || {}) };
  delete s.catalogInitialized;
  return s;
}

export async function getSettings(client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run("SELECT data FROM settings WHERE id = 1");
  return mergeSettings(rows[0]?.data);
}

export const notificationsEnabled = () =>
  (process.env.EMAIL_PROVIDER || "none") !== "none" || (process.env.MESSAGE_PROVIDER || "none") !== "none";

/** Configurações expostas ao público (nada sensível vive em settings; segredos ficam no .env). */
export async function getPublicSettings() {
  const s = await getSettings();
  return { ...s, notificationsEnabled: notificationsEnabled() };
}

export function productFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    active: row.active,
    order: row.sort_order,
    ...row.config,
  };
}

export async function listProducts({ activeOnly = false } = {}, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT id, name, price, active, sort_order, config FROM products ${activeOnly ? "WHERE active" : ""} ORDER BY sort_order, name`
  );
  return rows.map(productFromRow);
}

export async function getProduct(id, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run("SELECT id, name, price, active, sort_order, config FROM products WHERE id = $1", [id]);
  return rows[0] ? productFromRow(rows[0]) : null;
}

export async function listArts({ activeOnly = false } = {}) {
  const { rows } = await query(
    `SELECT a.id, a.name, a.category, a.file_id, a.active, a.sort_order, f.bounds, f.width, f.height
       FROM arts a JOIN files f ON f.id = a.file_id
      ${activeOnly ? "WHERE a.active" : ""}
      ORDER BY a.sort_order, a.name`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    url: fileUrlFor(r.file_id),
    active: r.active,
    order: Number(r.sort_order),
    bounds: r.bounds,
    width: r.width,
    height: r.height,
  }));
}

export async function listCustomFonts({ activeOnly = false } = {}) {
  const { rows } = await query(
    `SELECT id, family, category, file_id, active FROM custom_fonts ${activeOnly ? "WHERE active" : ""} ORDER BY family`
  );
  return rows.map((r) => ({ id: r.id, family: r.family, category: r.category, url: fileUrlFor(r.file_id), active: r.active, source: "custom" }));
}

export async function availableFonts(settings) {
  return getAvailableFonts(settings, await listCustomFonts({ activeOnly: true }));
}

export async function getArtWithFile(id, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT a.id, a.name, a.file_id, a.active, f.bounds, f.width, f.height
       FROM arts a JOIN files f ON f.id = a.file_id WHERE a.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export const settingsRow = () => one("SELECT data FROM settings WHERE id = 1");

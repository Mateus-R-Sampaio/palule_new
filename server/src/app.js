// API + site. Tudo que altera dados é validado (zod) e conferido no banco.

import express from "express";
import multer from "multer";
import { join } from "node:path";
import { config, ROOT_DIR } from "./config.js";
import { query, one } from "./db.js";
import {
  securityHeaders, permissionsPolicy, publicCors, requireSameOrigin,
  apiLimiter, loginLimiter, orderLimiter, uploadLimiter, adminUploadLimiter,
} from "./security.js";
import { login, logout, requireAdmin, isAdminRequest, changePassword, AuthError, safeEqual } from "./auth.js";
import { audit } from "./audit.js";
import {
  loginInput, passwordChangeInput, productInput, artInput, artCreateInput, fontCreateInput, settingsInput,
  statusChangeInput, paymentChangeInput, orderInput, formatZodError,
} from "./validation.js";
import { storeFile, serveFile, fileIdFromUrl, getFileMeta, FileError } from "./files.js";
import {
  getPublicSettings, getSettings, listProducts, listArts, listCustomFonts, mergeSettings,
} from "./catalog.js";
import {
  createOrder, listOrders, ordersVersion, changeStatus, changePayment, resendNotification, deleteOrder,
  markPaidByWebhook, OrderError,
} from "./orders.js";
import { z } from "zod";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, parts: 6 },
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const parse = (schema, data) => schema.parse(data);

/** Converte URLs relativas de arquivos em absolutas (para a loja hospedada em outro domínio). */
function absolutizer(req) {
  const base = `${req.protocol}://${req.get("host")}`;
  const fix = (u) => (typeof u === "string" && u.startsWith("/api/files/") ? base + u : u);
  return (obj) =>
    JSON.parse(JSON.stringify(obj), (_k, v) => fix(v));
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(securityHeaders);
  app.use(permissionsPolicy);

  /* ================================================================ API */
  const api = express.Router();
  api.use(apiLimiter);
  api.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.use(express.json({ limit: "300kb", strict: true }));

  api.get("/health", wrap(async (_req, res) => {
    await query("SELECT 1");
    res.json({ ok: true });
  }));

  /* ----------------------------- Público (loja) ----------------------------- */
  const pub = express.Router();
  pub.use(publicCors);

  pub.get("/catalog", wrap(async (req, res) => {
    const [settings, products, arts, fonts] = await Promise.all([
      getPublicSettings(),
      listProducts({ activeOnly: true }),
      listArts({ activeOnly: true }),
      listCustomFonts({ activeOnly: true }),
    ]);
    res.json(absolutizer(req)({ settings, products, arts, customFonts: fonts }));
  }));

  pub.post("/uploads/customer-logo", uploadLimiter, upload.single("file"), wrap(async (req, res) => {
    if (!req.file) throw new FileError("Nenhum arquivo enviado.");
    const stored = await storeFile({ buffer: req.file.buffer, kind: "customer_logo", originalName: req.file.originalname, withToken: true });
    res.status(201).json({ fileId: stored.id, token: stored.token, bounds: stored.bounds, width: stored.width, height: stored.height });
  }));

  pub.post("/orders", orderLimiter, wrap(async (req, res) => {
    const input = parse(orderInput, req.body);
    const order = await createOrder(input, req);
    res.status(201).json(order);
  }));

  api.use("/public", pub);

  /* ----------------------------- Arquivos ----------------------------- */
  api.get("/files/:id", serveFile(isAdminRequest));

  /* ----------------------------- Webhook de pagamento ----------------------------- */
  api.post("/webhooks/payment", wrap(async (req, res) => {
    if (!config.paymentWebhookSecret || !safeEqual(req.get("x-webhook-secret") || "", config.paymentWebhookSecret)) {
      return res.status(401).json({ error: "Não autorizado" });
    }
    const body = parse(
      z.object({ numero_pedido: z.string().max(40), status: z.enum(["PAGO", "CANCELADO"]) }),
      req.body
    );
    await markPaidByWebhook(body.numero_pedido, body.status);
    res.json({ ok: true });
  }));

  /* ----------------------------- Autenticação ----------------------------- */
  const auth = express.Router();
  auth.use(requireSameOrigin);
  auth.post("/login", loginLimiter, wrap(async (req, res) => {
    const { email, password } = parse(loginInput, req.body);
    const user = await login(req, res, email, password);
    res.json({ user });
  }));
  auth.post("/logout", wrap(async (req, res) => {
    await logout(req, res);
    res.json({ ok: true });
  }));
  auth.get("/me", requireAdmin, (req, res) => res.json({ user: { email: req.admin.email, name: req.admin.name, id: req.admin.id } }));
  auth.post("/password", requireAdmin, loginLimiter, wrap(async (req, res) => {
    const { currentPassword, newPassword } = parse(passwordChangeInput, req.body);
    await changePassword(req, res, currentPassword, newPassword);
    res.json({ ok: true });
  }));
  api.use("/auth", auth);

  /* ----------------------------- Painel (admin) ----------------------------- */
  const admin = express.Router();
  admin.use(requireSameOrigin, requireAdmin);

  admin.get("/bootstrap", wrap(async (_req, res) => {
    const [settings, products, arts, fonts] = await Promise.all([
      getSettings(),
      listProducts(),
      listArts(),
      listCustomFonts(),
    ]);
    res.json({ settings: { ...settings, notificationsEnabled: (await getPublicSettings()).notificationsEnabled }, products, arts, customFonts: fonts });
  }));

  // Configurações
  admin.put("/settings", wrap(async (req, res) => {
    const patch = parse(settingsInput, req.body);
    if (patch.logoUrl) await assertFile(patch.logoUrl, "brand");
    const current = (await one("SELECT data FROM settings WHERE id = 1"))?.data || {};
    const next = { ...current, ...patch };
    await query(
      `INSERT INTO settings (id, data, updated_at, updated_by) VALUES (1, $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(next), req.admin.id]
    );
    await audit(req, req.admin.id, "configuracoes_salvas", null, { campos: Object.keys(patch) });
    res.json({ settings: mergeSettings(next) });
  }));

  // Produtos
  admin.put("/products/:id", wrap(async (req, res) => {
    const p = parse(productInput, { ...req.body, id: req.params.id });
    if (p.allowsBack && !p.printAreaCss.back) p.printAreaCss.back = p.printAreaCss.front;
    if (!p.allowsBack) {
      p.mockups.back = null;
      p.printAreaCss.back = null;
    }
    for (const url of [p.mockups.front, p.mockups.back].filter(Boolean)) await assertFile(url, "mockup");
    const ids = new Set();
    for (const f of p.customizationOptions.finishTypes) {
      if (ids.has(f.id)) throw new OrderError("Há acabamentos com o mesmo nome.", 400);
      ids.add(f.id);
    }
    const { id, name, price, active, order, ...rest } = p;
    await query(
      `INSERT INTO products (id, name, price, active, sort_order, config) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = $2, price = $3, active = $4, sort_order = $5, config = $6, updated_at = now()`,
      [id, name, price, active, order, JSON.stringify(rest)]
    );
    await audit(req, req.admin.id, "produto_salvo", id, { preco: price, ativo: active });
    res.json({ product: p });
  }));
  admin.delete("/products/:id", wrap(async (req, res) => {
    const { rowCount } = await query("DELETE FROM products WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Produto não encontrado." });
    await audit(req, req.admin.id, "produto_excluido", req.params.id);
    res.json({ ok: true });
  }));

  // Estampas
  admin.post("/arts", wrap(async (req, res) => {
    const a = parse(artCreateInput, req.body);
    const fileId = await assertFile(a.fileUrl, "art");
    const id = `art-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await query("INSERT INTO arts (id, name, category, file_id, active, sort_order) VALUES ($1,$2,$3,$4,$5,$6)", [
      id, a.name, a.category, fileId, a.active, Math.min(a.order, 2_000_000_000),
    ]);
    await audit(req, req.admin.id, "estampa_criada", id);
    res.status(201).json({ art: (await listArts()).find((x) => x.id === id) });
  }));
  admin.put("/arts/:id", wrap(async (req, res) => {
    const a = parse(artInput.partial(), req.body);
    const { rowCount } = await query(
      `UPDATE arts SET name = COALESCE($2, name), category = COALESCE($3, category), active = COALESCE($4, active)
        WHERE id = $1`,
      [req.params.id, a.name ?? null, a.category ?? null, a.active ?? null]
    );
    if (!rowCount) return res.status(404).json({ error: "Estampa não encontrada." });
    await audit(req, req.admin.id, "estampa_editada", req.params.id, a);
    res.json({ ok: true });
  }));
  admin.delete("/arts/:id", wrap(async (req, res) => {
    const row = await one("DELETE FROM arts WHERE id = $1 RETURNING file_id", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Estampa não encontrada." });
    await audit(req, req.admin.id, "estampa_excluida", req.params.id);
    res.json({ ok: true }); // o arquivo continua no banco: pedidos antigos ainda apontam para ele
  }));

  // Fontes da loja
  admin.post("/fonts", wrap(async (req, res) => {
    const f = parse(fontCreateInput, req.body);
    const fileId = await assertFile(f.fileUrl, "font");
    const slug = f.family.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const id = `custom-${slug}-${Date.now().toString(36)}`.slice(0, 87);
    await query("INSERT INTO custom_fonts (id, family, category, file_id) VALUES ($1, $2, $3, $4)", [id, f.family, f.category, fileId]);
    await audit(req, req.admin.id, "fonte_criada", id);
    res.status(201).json({ font: (await listCustomFonts()).find((x) => x.id === id) });
  }));
  admin.put("/fonts/:id", wrap(async (req, res) => {
    const { active } = parse(z.object({ active: z.boolean() }), req.body);
    const { rowCount } = await query("UPDATE custom_fonts SET active = $2 WHERE id = $1", [req.params.id, active]);
    if (!rowCount) return res.status(404).json({ error: "Fonte não encontrada." });
    await audit(req, req.admin.id, "fonte_editada", req.params.id, { active });
    res.json({ ok: true });
  }));
  admin.delete("/fonts/:id", wrap(async (req, res) => {
    const { rowCount } = await query("DELETE FROM custom_fonts WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Fonte não encontrada." });
    await audit(req, req.admin.id, "fonte_excluida", req.params.id);
    res.json({ ok: true });
  }));

  // Upload (mockup | art | brand | font)
  admin.post("/files", adminUploadLimiter, upload.single("file"), wrap(async (req, res) => {
    const kind = String(req.query.kind || "");
    if (!["mockup", "art", "brand", "font"].includes(kind)) throw new FileError("Tipo de arquivo inválido.");
    if (!req.file) throw new FileError("Nenhum arquivo enviado.");
    const stored = await storeFile({ buffer: req.file.buffer, kind, originalName: req.file.originalname });
    await audit(req, req.admin.id, "arquivo_enviado", stored.id, { kind, bytes: req.file.size });
    res.status(201).json({ id: stored.id, url: stored.url, bounds: stored.bounds });
  }));

  // Pedidos
  admin.get("/orders", wrap(async (req, res) => {
    const version = await ordersVersion();
    const etag = `"o-${version}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "private, no-cache");
    if (req.get("if-none-match") === etag) return res.status(304).end();
    res.json({ orders: await listOrders() });
  }));
  admin.patch("/orders/:numero/status", wrap(async (req, res) => {
    const body = parse(statusChangeInput, req.body);
    await changeStatus(req.params.numero, body, req.admin);
    await audit(req, req.admin.id, "pedido_status", req.params.numero, body);
    res.json({ ok: true });
  }));
  admin.patch("/orders/:numero/payment", wrap(async (req, res) => {
    const body = parse(paymentChangeInput, req.body);
    await changePayment(req.params.numero, body.status_pagamento);
    await audit(req, req.admin.id, "pedido_pagamento", req.params.numero, body);
    res.json({ ok: true });
  }));
  admin.post("/orders/:numero/notify", wrap(async (req, res) => {
    await resendNotification(req.params.numero);
    await audit(req, req.admin.id, "pedido_reenvio_notificacao", req.params.numero);
    res.json({ ok: true });
  }));
  admin.delete("/orders/:numero", wrap(async (req, res) => {
    await deleteOrder(req.params.numero);
    await audit(req, req.admin.id, "pedido_excluido", req.params.numero);
    res.json({ ok: true });
  }));

  admin.get("/audit", wrap(async (_req, res) => {
    const { rows } = await query(
      `SELECT a.at, a.action, a.target, a.details, u.email FROM audit_log a
        LEFT JOIN admin_users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT 200`
    );
    res.json({ entries: rows });
  }));

  api.use("/admin", admin);
  api.use((_req, res) => res.status(404).json({ error: "Rota não encontrada." }));
  app.use("/api", api);

  /* ================================================================ Site */
  const PUBLIC_FILES = ["index.html", "admin.html", "styles.css", "admin.css", "manifest.json", "sw.js", "icon.svg"];
  const sendRoot = (file) => (_req, res) => {
    if (file === "admin.html") {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "no-store");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
    res.sendFile(join(ROOT_DIR, file), { dotfiles: "deny" });
  };
  app.get("/", sendRoot("index.html"));
  for (const f of PUBLIC_FILES) app.get(`/${f}`, sendRoot(f));
  app.use("/js", express.static(join(ROOT_DIR, "js"), { dotfiles: "deny", index: false, fallthrough: false, setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") }));
  app.use((_req, res) => res.status(404).type("text/plain").send("Não encontrado"));

  /* ================================================================ Erros */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err?.name === "ZodError" || err?.issues) {
      const detalhes = formatZodError(err);
      return res.status(400).json({ error: detalhes[0]?.mensagem || "Dados inválidos.", detalhes });
    }
    if (err instanceof AuthError || err instanceof OrderError || err instanceof FileError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err?.type === "entity.too.large" || err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Envio muito grande." });
    }
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido." });
    if (err?.code === "LIMIT_UNEXPECTED_FILE" || err?.code === "LIMIT_PART_COUNT") {
      return res.status(400).json({ error: "Envio de arquivo inválido." });
    }
    if (err?.status === 404 && req.path.startsWith("/js/")) return res.status(404).type("text/plain").send("Não encontrado");
    if (err?.code === "23505") return res.status(409).json({ error: "Registro duplicado." });
    if (err?.code === "23503") return res.status(409).json({ error: "Este item está em uso e não pode ser removido." });
    if (err?.code === "23514") return res.status(400).json({ error: "Dados fora das regras do banco." });
    console.error(err);
    res.status(500).json({ error: "Erro interno. Tente novamente." });
  });

  return app;
}

async function assertFile(url, kind) {
  const id = fileIdFromUrl(url);
  const meta = id && (await getFileMeta(id));
  if (!meta || meta.kind !== kind) throw new FileError("Arquivo inválido: envie-o novamente pelo painel.");
  return id;
}

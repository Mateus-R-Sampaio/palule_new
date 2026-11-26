// Cloud Functions — Studio Personalizado
//
// • onOrderCreated  (orders/{id} criado):   confere valores e envia confirmação (e-mail + WhatsApp/SMS).
// • onOrderUpdated  (orders/{id} alterado): ao mudar status_producao, ou quando o admin pede
//                                           "Reenviar notificação", envia a atualização ao cliente.
// • paymentWebhook  (HTTPS):                confirma pagamento vindo de gateway (Mercado Pago, Asaas, Stripe…).

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { notifyOrder } = require("./notify");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: process.env.FUNCTIONS_REGION || "southamerica-east1", maxInstances: 10 });

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Recalcula o total no servidor (o cliente não é confiável). */
async function verifyTotals(order) {
  const [productsSnap, settingsSnap] = await Promise.all([db.collection("products").get(), db.doc("settings/store").get()]);
  const products = new Map(productsSnap.docs.map((d) => [d.id, d.data()]));
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  if (!products.size) return null; // catálogo ainda não importado: nada a comparar

  let subtotal = 0;
  const problems = [];
  for (const item of order.itens || []) {
    const p = products.get(item.produto_id);
    if (!p) {
      problems.push(`Produto inexistente: ${item.produto_id}`);
      continue;
    }
    const finish = (p.customizationOptions?.finishTypes || []).find((f) => f.id === item.acabamento);
    if (item.acabamento && !finish) problems.push(`Acabamento inválido em ${item.produto_nome}`);
    if ((p.sizes || []).length > 1 && !(p.sizes || []).includes(item.tamanho)) problems.push(`Tamanho inválido em ${item.produto_nome}`);
    const unit = round2(Number(p.price) + Number(finish?.extraPrice || 0));
    subtotal += unit * Math.max(1, Math.min(50, Number(item.quantidade) || 1));
  }
  const fee = order.modalidade === "ENCOMENDA" ? Number(settings.deliveryFee) || 0 : 0;
  const total = round2(subtotal + fee);
  const mismatch = Math.abs(total - round2(order.valor_total)) > 0.01 || problems.length > 0;
  return { total, mismatch, problems };
}

exports.onOrderCreated = onDocumentCreated("orders/{orderId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const order = snap.data();
  const patch = {};

  try {
    const check = await verifyTotals(order);
    if (check?.mismatch) {
      patch.alerta_valor = true;
      patch.valor_total_calculado = check.total;
      patch.alerta_detalhes = check.problems;
      logger.warn("Valor divergente", { pedido: order.numero_pedido, enviado: order.valor_total, calculado: check.total, problemas: check.problems });
    }
  } catch (err) {
    logger.error("Falha ao conferir valores", err);
  }

  const result = await notifyOrder(order);
  patch.notificacoes = { ...(order.notificacoes || {}), ...result };
  await snap.ref.update(patch);
  logger.info("Confirmação enviada", { pedido: order.numero_pedido, ...result });
});

exports.onOrderUpdated = onDocumentUpdated("orders/{orderId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const statusChanged = before.status_producao !== after.status_producao;
  const resendRequested =
    after.notificacoes?.reenviar_solicitado_em &&
    after.notificacoes.reenviar_solicitado_em !== before.notificacoes?.reenviar_solicitado_em;

  // Atualizações feitas por esta própria função (campo notificacoes) não disparam nada.
  if (!statusChanged && !resendRequested) return;

  const result = await notifyOrder(after);
  await event.data.after.ref.update({
    notificacoes: { ...(after.notificacoes || {}), ...result },
  });
  logger.info(resendRequested ? "Notificação reenviada" : "Status notificado", {
    pedido: after.numero_pedido,
    status: after.status_producao,
    ...result,
  });
});

/**
 * Webhook genérico para confirmação de pagamento.
 * POST /paymentWebhook  header: x-webhook-secret: <PAYMENT_WEBHOOK_SECRET>
 * body: { "numero_pedido": "PED-20261126-1042", "status": "PAGO" | "CANCELADO" }
 * Adapte o mapeamento ao formato do seu gateway.
 */
exports.paymentWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret || req.get("x-webhook-secret") !== secret) return res.status(401).send("Unauthorized");

  const numero = req.body?.numero_pedido || req.body?.external_reference || req.body?.orderId;
  const status = String(req.body?.status || "").toUpperCase();
  if (!numero || !["PAGO", "CANCELADO"].includes(status)) return res.status(400).send("Payload inválido");

  const ref = db.collection("orders").doc(String(numero));
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).send("Pedido não encontrado");
  const order = snap.data();

  const now = new Date().toISOString();
  const patch = { status_pagamento: status, updated_at: now };
  if (status === "PAGO" && order.status_producao === "AGUARDANDO_PAGAMENTO") {
    patch.status_producao = "EM_FILA"; // dispara onOrderUpdated → notifica o cliente
    patch.historico = admin.firestore.FieldValue.arrayUnion({ status: "EM_FILA", em: now, origem: "gateway" });
  }
  await ref.update(patch);
  return res.json({ ok: true, numero_pedido: numero, status });
});

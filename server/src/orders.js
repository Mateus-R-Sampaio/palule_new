// Criação e gestão de pedidos.
//
// O navegador envia APENAS as escolhas do cliente (produto, cor, tamanho,
// acabamento, quantidade, posições). O servidor confere tudo contra o banco:
//   • produto existe e está ativo; cor, tamanho e acabamento são do produto;
//   • costas só se o produto permitir;
//   • estampa existe e está ativa; fonte está habilitada; logo foi enviada por este cliente (token);
//   • tamanhos e posições cabem na área de impressão real (cm);
//   • modalidade e método de pagamento estão habilitados;
//   • PREÇOS, TOTAL, NÚMERO e STATUS são calculados aqui — nunca vêm do navegador.

import { createHmac, randomUUID } from "node:crypto";
import { tx, query, one } from "./db.js";
import { config } from "./config.js";
import { getSettings, getProduct, getArtWithFile, availableFonts } from "./catalog.js";
import { fileUrlFor, getFileMeta } from "./files.js";
import { sha256, safeEqual } from "./auth.js";
import { aabbHalf } from "../../js/render.js";
import { fontStack, FONT_CATALOG } from "../../js/fonts.js";
import { notifyOrderAsync } from "./notify.js";
import { ORDER_STATUSES } from "./validation.js";

export class OrderError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
const TOLERANCE = 1.03; // 3% de folga para arredondamentos do navegador
const LINE_HEIGHT = 1.15;

function assertFits(label, w, h, item, pc) {
  const { hx, hy } = aabbHalf(w, h, item.rotation || 0);
  if (hx * 2 > pc.width * TOLERANCE + 0.05 || hy * 2 > pc.height * TOLERANCE + 0.05) {
    throw new OrderError(`${label} maior que a área de impressão (${pc.width} × ${pc.height} cm).`);
  }
  if (Math.abs(item.x) + hx > (pc.width / 2) * TOLERANCE + 0.05 || Math.abs(item.y) + hy > (pc.height / 2) * TOLERANCE + 0.05) {
    throw new OrderError(`${label} está fora da área de impressão.`);
  }
}

function aspectFrom(bounds, width, height) {
  const b = bounds || { x: 0, y: 0, w: 1, h: 1 };
  const W = width || 1;
  const H = height || 1;
  return (b.w * W) / (b.h * H) || 1;
}

async function buildSide(input, { product, fonts, label, client, fileIds }) {
  if (!input) return null;
  const pc = product.printCm;
  const out = {};
  let hasContent = false;

  if (input.art) {
    const art = await getArtWithFile(input.art.id, client);
    if (!art || !art.active) throw new OrderError(`${label}: estampa indisponível.`);
    const aspect = aspectFrom(art.bounds, art.width, art.height);
    const w = input.art.widthCm;
    assertFits(`${label}: estampa`, w, w / aspect, input.art, pc);
    Object.assign(out, {
      estampa_id: art.id,
      estampa_nome: art.name,
      estampa_url: fileUrlFor(art.file_id),
      estampa_posicao_cm: { x: round3(input.art.x), y: round3(input.art.y) },
      estampa_dimensoes_cm: { largura: round3(w), altura: round3(w / aspect) },
      estampa_rotacao_graus: Math.round(input.art.rotation * 10) / 10,
      estampa_recorte: art.bounds || { x: 0, y: 0, w: 1, h: 1 },
      estampa_proporcao: Math.round(aspect * 100000) / 100000,
    });
    hasContent = true;
  }

  if (input.logo) {
    const file = await getFileMeta(input.logo.fileId);
    const fresh = file && Date.now() - new Date(file.created_at).getTime() < 48 * 3600_000;
    if (
      !file ||
      file.kind !== "customer_logo" ||
      !fresh ||
      !file.upload_token_hash ||
      !safeEqual(file.upload_token_hash.toString("hex"), sha256(input.logo.token).toString("hex"))
    ) {
      throw new OrderError(`${label}: a logo enviada expirou ou é inválida. Envie a imagem novamente.`);
    }
    const aspect = aspectFrom(file.bounds, file.width, file.height);
    const w = input.logo.widthCm;
    assertFits(`${label}: logo`, w, w / aspect, input.logo, pc);
    Object.assign(out, {
      logo_url: fileUrlFor(file.id),
      logo_nome: "logo do cliente",
      logo_posicao_cm: { x: round3(input.logo.x), y: round3(input.logo.y) },
      logo_dimensoes_cm: { largura: round3(w), altura: round3(w / aspect) },
      logo_rotacao_graus: Math.round(input.logo.rotation * 10) / 10,
      logo_recorte: file.bounds || { x: 0, y: 0, w: 1, h: 1 },
      logo_proporcao: Math.round(aspect * 100000) / 100000,
    });
    fileIds.add(file.id);
    hasContent = true;
  }

  const t = input.text;
  if (t && t.value) {
    const font = fonts.find((f) => f.id === t.fontId);
    if (!font) throw new OrderError(`${label}: tipografia indisponível.`);
    const h = t.sizeCm * LINE_HEIGHT;
    if (h > pc.height * TOLERANCE + 0.05) throw new OrderError(`${label}: texto maior que a área de impressão.`);
    if (Math.abs(t.x) > pc.width / 2 + 0.05 || Math.abs(t.y) > pc.height / 2 + 0.05) {
      throw new OrderError(`${label}: texto fora da área de impressão.`);
    }
    Object.assign(out, {
      texto: t.value,
      texto_fonte: font.family,
      texto_fonte_id: font.id,
      texto_fonte_origem: font.source,
      texto_fonte_css: fontStack(font),
      texto_fonte_url: font.source === "custom" ? font.url : null,
      texto_cor: t.color,
      texto_negrito: !!t.bold,
      texto_italico: !!t.italic,
      texto_tamanho_cm: round3(t.sizeCm),
      texto_tamanho_pt: Math.round((t.sizeCm / 2.54) * 72 * 10) / 10,
      texto_tamanho_px: Math.round((t.sizeCm / 2.54) * 96),
      texto_dimensoes_cm: null,
      texto_posicao_cm: { x: round3(t.x), y: round3(t.y) },
      texto_rotacao_graus: Math.round(t.rotation * 10) / 10,
    });
    hasContent = true;
  }
  return hasContent ? out : null;
}

function renderSnapshot(product) {
  return {
    type: product.type || product.id,
    mockups: { front: product.mockups?.front || "", back: product.mockups?.back || null },
    printAreaCss: product.printAreaCss,
    printCm: product.printCm,
    physicalCm: product.physicalCm || null,
    tintable: product.tintable !== false,
  };
}

const ipHash = (ip) => (ip && config.ipHashSecret ? createHmac("sha256", config.ipHashSecret).update(ip).digest() : null);

export async function createOrder(input, req) {
  const settings = await getSettings();
  if (!settings.modes?.[input.modalidade]) throw new OrderError("Modalidade indisponível.");
  if (settings.payments?.[input.metodo_pagamento] === false) throw new OrderError("Método de pagamento indisponível.");
  if (input.modalidade === "ENCOMENDA" && !input.cliente.endereco) throw new OrderError("Informe o endereço de entrega.");
  const fonts = await availableFonts(settings);

  const order = await tx(async (client) => {
    const fileIds = new Set();
    const itens = [];
    let subtotal = 0;
    let quantidade = 0;

    for (const [i, raw] of input.itens.entries()) {
      const product = await getProduct(raw.produto_id, client);
      const n = `Item ${i + 1}`;
      if (!product || !product.active) throw new OrderError(`${n}: produto indisponível.`);
      if (!product.colors.includes(raw.cor)) throw new OrderError(`${n}: cor indisponível para ${product.name}.`);

      const sizes = product.sizes || ["Único"];
      const tamanho = sizes.length === 1 ? sizes[0] : raw.tamanho;
      if (!sizes.includes(tamanho)) throw new OrderError(`${n}: escolha um tamanho válido para ${product.name}.`);

      const finishes = product.customizationOptions?.finishTypes || [];
      let finish = null;
      if (finishes.length) {
        finish = finishes.find((f) => f.id === raw.acabamento);
        if (!finish) throw new OrderError(`${n}: escolha o acabamento de ${product.name}.`);
      } else if (raw.acabamento) {
        throw new OrderError(`${n}: acabamento inválido.`);
      }

      const ctx = { product, fonts, client, fileIds };
      const frente = await buildSide(raw.frente, { ...ctx, label: `${n} (frente)` });
      if (raw.costas && !product.allowsBack) throw new OrderError(`${n}: ${product.name} não permite personalizar as costas.`);
      const costas = product.allowsBack ? await buildSide(raw.costas, { ...ctx, label: `${n} (costas)` }) : null;

      const unit = round2(Number(product.price) + Number(finish?.extraPrice || 0));
      subtotal = round2(subtotal + unit * raw.quantidade);
      quantidade += raw.quantidade;
      itens.push({
        item_id: randomUUID(),
        produto_id: product.id,
        produto_nome: product.name,
        produto_descricao: product.description || "",
        cor: raw.cor,
        tamanho,
        acabamento: finish?.id || null,
        acabamento_label: finish?.label || null,
        preco_base: Number(product.price),
        acabamento_extra: Number(finish?.extraPrice || 0),
        valor_unitario: unit,
        quantidade: raw.quantidade,
        render: renderSnapshot(product),
        frente,
        costas,
      });
    }

    const taxa = input.modalidade === "ENCOMENDA" ? round2(Number(settings.deliveryFee) || 0) : 0;
    const total = round2(subtotal + taxa);
    const status = input.metodo_pagamento === "PAGAR_NA_RETIRADA" ? "EM_FILA" : "AGUARDANDO_PAGAMENTO";

    const { rows: seqRows } = await client.query(
      `INSERT INTO order_counters (day, seq) VALUES ((now() AT TIME ZONE $1)::date, 1001)
       ON CONFLICT (day) DO UPDATE SET seq = order_counters.seq + 1
       RETURNING seq, to_char(day, 'YYYYMMDD') AS ymd`,
      [process.env.STORE_TIMEZONE || "America/Sao_Paulo"]
    );
    const { seq, ymd } = seqRows[0];
    const numero = `${settings.orderPrefix || "PED"}-${ymd}-${seq}`;

    const { rows } = await client.query(
      `INSERT INTO orders (numero, codigo_curto, modalidade, cliente_nome, cliente_telefone, cliente_email, endereco,
                           itens, quantidade_itens, subtotal, taxa_entrega, valor_total, metodo_pagamento,
                           status_producao, notificacoes, origem, ip_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id, created_at`,
      [
        numero,
        String(seq),
        input.modalidade,
        input.cliente.nome,
        input.cliente.telefone,
        input.cliente.email,
        input.modalidade === "ENCOMENDA" ? JSON.stringify(input.cliente.endereco) : null,
        JSON.stringify(itens),
        quantidade,
        subtotal,
        taxa,
        total,
        input.metodo_pagamento,
        status,
        JSON.stringify({ email_enviado: false, mensagem_enviada: false }),
        input.origem,
        ipHash(req.ip),
      ]
    );
    const orderId = rows[0].id;
    await client.query("INSERT INTO order_history (order_id, status, origem) VALUES ($1, $2, 'cliente')", [orderId, status]);
    for (const fileId of fileIds) {
      await client.query("INSERT INTO order_files (order_id, file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [orderId, fileId]);
    }
    return { orderId, numero, seq, status, total, subtotal, taxa };
  });

  notifyOrderAsync(order.orderId);

  // Resposta pública: só o necessário para a tela de confirmação.
  return {
    numero_pedido: order.numero,
    codigo_curto: String(order.seq),
    modalidade: input.modalidade,
    metodo_pagamento: input.metodo_pagamento,
    status_producao: order.status,
    status_pagamento: "PENDENTE",
    subtotal: order.subtotal,
    taxa_entrega: order.taxa,
    valor_total: order.total,
    cliente: { email: input.cliente.email },
  };
}

/* ------------------------------------------------------------------ Admin */

export function orderFromRow(r, history = []) {
  return {
    id: r.numero,
    numero_pedido: r.numero,
    codigo_curto: r.codigo_curto,
    modalidade: r.modalidade,
    cliente: { nome: r.cliente_nome, telefone: r.cliente_telefone, email: r.cliente_email, endereco: r.endereco },
    itens: r.itens,
    quantidade_itens: r.quantidade_itens,
    subtotal: r.subtotal,
    taxa_entrega: r.taxa_entrega,
    valor_total: r.valor_total,
    metodo_pagamento: r.metodo_pagamento,
    status_pagamento: r.status_pagamento,
    status_producao: r.status_producao,
    notificacoes: r.notificacoes,
    origem: r.origem,
    historico: history.map((h) => ({ status: h.status, em: h.at, origem: h.origem })),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const ORDER_COLUMNS = `id, numero, codigo_curto, modalidade, cliente_nome, cliente_telefone, cliente_email, endereco, itens,
  quantidade_itens, subtotal, taxa_entrega, valor_total, metodo_pagamento, status_pagamento, status_producao,
  notificacoes, origem, created_at, updated_at`;

export async function listOrders(limit = 300) {
  const { rows } = await query(`SELECT ${ORDER_COLUMNS} FROM orders ORDER BY created_at DESC LIMIT $1`, [limit]);
  if (!rows.length) return [];
  const { rows: hist } = await query(
    "SELECT order_id, status, at, origem FROM order_history WHERE order_id = ANY($1::bigint[]) ORDER BY at",
    [rows.map((r) => r.id)]
  );
  const byOrder = new Map();
  for (const h of hist) {
    if (!byOrder.has(h.order_id)) byOrder.set(h.order_id, []);
    byOrder.get(h.order_id).push(h);
  }
  return rows.map((r) => orderFromRow(r, byOrder.get(r.id) || []));
}

export async function ordersVersion() {
  const row = await one("SELECT count(*)::int AS n, max(updated_at) AS last FROM orders");
  return `${row.n}-${row.last ? new Date(row.last).getTime() : 0}`;
}

export async function changeStatus(numero, { status, status_pagamento }, admin) {
  const result = await tx(async (client) => {
    const { rows } = await client.query("SELECT id, status_producao, status_pagamento FROM orders WHERE numero = $1 FOR UPDATE", [numero]);
    const current = rows[0];
    if (!current) throw new OrderError("Pedido não encontrado.", 404);
    const from = ORDER_STATUSES.indexOf(current.status_producao);
    const to = ORDER_STATUSES.indexOf(status);
    if (Math.abs(to - from) !== 1) throw new OrderError("O status só pode avançar ou voltar uma etapa por vez.", 409);
    let pagamento = status_pagamento || current.status_pagamento;
    if (from === 0 && to === 1) pagamento = "PAGO"; // confirmar pagamento libera a produção
    await client.query("UPDATE orders SET status_producao = $2, status_pagamento = $3, updated_at = now() WHERE id = $1", [
      current.id,
      status,
      pagamento,
    ]);
    await client.query("INSERT INTO order_history (order_id, status, user_id, origem) VALUES ($1, $2, $3, 'painel')", [
      current.id,
      status,
      admin?.id || null,
    ]);
    return current.id;
  });
  notifyOrderAsync(result);
}

export async function changePayment(numero, status_pagamento) {
  const { rowCount } = await query("UPDATE orders SET status_pagamento = $2, updated_at = now() WHERE numero = $1", [numero, status_pagamento]);
  if (!rowCount) throw new OrderError("Pedido não encontrado.", 404);
}

export async function resendNotification(numero) {
  const row = await one("SELECT id FROM orders WHERE numero = $1", [numero]);
  if (!row) throw new OrderError("Pedido não encontrado.", 404);
  notifyOrderAsync(row.id, { force: true });
}

export async function deleteOrder(numero) {
  const { rowCount } = await query("DELETE FROM orders WHERE numero = $1", [numero]);
  if (!rowCount) throw new OrderError("Pedido não encontrado.", 404);
}

/** Webhook do gateway: marca como pago e libera a produção. */
export async function markPaidByWebhook(numero, status) {
  return tx(async (client) => {
    const { rows } = await client.query("SELECT id, status_producao FROM orders WHERE numero = $1 FOR UPDATE", [numero]);
    if (!rows[0]) throw new OrderError("Pedido não encontrado.", 404);
    const { id, status_producao } = rows[0];
    const release = status === "PAGO" && status_producao === "AGUARDANDO_PAGAMENTO";
    await client.query(
      `UPDATE orders SET status_pagamento = $2, status_producao = CASE WHEN $3 THEN 'EM_FILA' ELSE status_producao END, updated_at = now()
        WHERE id = $1`,
      [id, status, release]
    );
    if (release) await client.query("INSERT INTO order_history (order_id, status, origem) VALUES ($1, 'EM_FILA', 'gateway')", [id]);
    return { id, release };
  }).then((r) => {
    if (r.release) notifyOrderAsync(r.id);
    return r;
  });
}

export { FONT_CATALOG };

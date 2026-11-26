// Envio de notificações: e-mail + mensagem (WhatsApp/SMS).
// Provedores configuráveis por variáveis de ambiente (veja .env.example).

const STATUS_LABELS = {
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  EM_FILA: "Fila de produção",
  EM_PRODUCAO: "Em produção",
  PRONTO_PARA_RETIRADA: "Pronto para retirada",
  ENTREGUE: "Entregue / Concluído",
};

const STATUS_DETAILS = {
  AGUARDANDO_PAGAMENTO: "Assim que o pagamento for confirmado, seu pedido entra na fila de produção.",
  EM_FILA: "Seu pedido está na fila e logo começa a ser produzido.",
  EM_PRODUCAO: "Estamos produzindo o seu pedido agora mesmo!",
  PRONTO_PARA_RETIRADA: "Seu pedido está pronto!",
  ENTREGUE: "Pedido concluído. Obrigado pela preferência!",
};

const PAYMENT_LABELS = {
  CREDITO: "Cartão de crédito",
  DEBITO: "Cartão de débito",
  PIX: "Pix",
  PAGAR_NA_RETIRADA: "Pagar na retirada",
};

const MODE_LABELS = { EVENTO: "Evento (retirada no local)", ENCOMENDA: "Encomenda (entrega)" };

function statusLabel(status, modalidade) {
  if (status === "PRONTO_PARA_RETIRADA" && modalidade === "ENCOMENDA") return "Pronto para entrega";
  return STATUS_LABELS[status] || status;
}

const brl = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Telefone brasileiro → E.164 sem "+" (ex.: 5511999999999). */
function phoneE164(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  return d.startsWith("55") && d.length >= 12 ? d : `55${d}`;
}

/* ---------------- Conteúdo ---------------- */

function buildMessageText(order) {
  const label = statusLabel(order.status_producao, order.modalidade);
  const store = process.env.STORE_NAME || "Studio Personalizado";
  // Template do documento de especificação:
  let text = `Olá, ${order.cliente?.nome}! Seu pedido *#${order.codigo_curto}* está com o status: *${label}*.`;
  const extra = STATUS_DETAILS[order.status_producao];
  if (extra) text += `\n${extra}`;
  if (order.status_producao === "PRONTO_PARA_RETIRADA" && order.modalidade === "EVENTO") {
    text += `\nApresente o número #${order.codigo_curto} no balcão.`;
  }
  text += `\n\n${store}`;
  return text;
}

function itemLines(order) {
  return (order.itens || []).map((i) => {
    const parts = [`${i.quantidade || 1}× ${i.produto_nome}`];
    if (i.tamanho && i.tamanho !== "Único") parts.push(`tam. ${i.tamanho}`);
    if (i.acabamento_label) parts.push(i.acabamento_label);
    const custom = [];
    for (const side of [i.frente, i.costas]) {
      if (!side) continue;
      if (side.estampa_nome) custom.push(side.estampa_nome);
      if (side.texto) custom.push(`“${side.texto}” (${side.texto_fonte})`);
    }
    return { title: parts.join(" · "), custom: custom.join(" + "), price: brl((i.valor_unitario || 0) * (i.quantidade || 1)) };
  });
}

function buildEmail(order) {
  const label = statusLabel(order.status_producao, order.modalidade);
  const store = process.env.STORE_NAME || "Studio Personalizado";
  const subject = `Pedido #${order.codigo_curto} — Status: ${label}`;
  const items = itemLines(order);
  const a = order.cliente?.endereco;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f5f9;font-family:Arial,Helvetica,sans-serif;color:#171a25">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
    <tr><td style="background:#171a25;color:#fff;padding:20px 24px;font-size:18px;font-weight:bold">${esc(store)}</td></tr>
    <tr><td style="padding:24px">
      <p style="margin:0 0 8px">Olá, <strong>${esc(order.cliente?.nome)}</strong>!</p>
      <p style="margin:0 0 18px">${esc(STATUS_DETAILS[order.status_producao] || "")}</p>
      <div style="text-align:center;background:#f4f5f9;border-radius:12px;padding:16px;margin-bottom:18px">
        <div style="font-size:13px;color:#737a91">Número do pedido</div>
        <div style="font-size:40px;font-weight:900;letter-spacing:-1px">#${esc(order.codigo_curto)}</div>
        <div style="font-size:12px;color:#737a91">${esc(order.numero_pedido)}</div>
        <div style="display:inline-block;margin-top:10px;padding:6px 14px;border-radius:999px;background:#ff5a67;color:#fff;font-weight:bold">${esc(label)}</div>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
        ${items
          .map(
            (i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e3e6ee"><strong>${esc(i.title)}</strong>${i.custom ? `<br><span style="color:#737a91">${esc(i.custom)}</span>` : ""}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #e3e6ee;white-space:nowrap">${esc(i.price)}</td></tr>`
          )
          .join("")}
        ${order.taxa_entrega ? `<tr><td style="padding:8px 0">Entrega</td><td align="right">${esc(brl(order.taxa_entrega))}</td></tr>` : ""}
        <tr><td style="padding:10px 0;font-weight:bold">Total</td><td align="right" style="font-weight:bold">${esc(brl(order.valor_total))}</td></tr>
      </table>
      <p style="margin:16px 0 4px;font-size:14px"><strong>Modalidade:</strong> ${esc(MODE_LABELS[order.modalidade] || order.modalidade)}</p>
      ${a ? `<p style="margin:0 0 4px;font-size:14px"><strong>Endereço:</strong> ${esc(`${a.rua}, ${a.numero}${a.complemento ? ` – ${a.complemento}` : ""}, ${a.bairro}, ${a.cidade}/${a.estado}, CEP ${a.cep}`)}</p>` : ""}
      <p style="margin:0;font-size:14px"><strong>Pagamento:</strong> ${esc(PAYMENT_LABELS[order.metodo_pagamento] || order.metodo_pagamento)} (${order.status_pagamento === "PAGO" ? "pago" : "pendente"})</p>
    </td></tr>
    <tr><td style="padding:16px 24px;background:#f4f5f9;font-size:12px;color:#737a91">Você recebe este e-mail porque fez um pedido em ${esc(store)}.</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `${buildMessageText(order).replace(/\*/g, "")}\n\nItens:\n${items.map((i) => `- ${i.title}${i.custom ? ` (${i.custom})` : ""}: ${i.price}`).join("\n")}\nTotal: ${brl(order.valor_total)}`;
  return { subject, html, text };
}

/* ---------------- Provedores de e-mail ---------------- */

async function sendEmail(order) {
  const provider = (process.env.EMAIL_PROVIDER || "none").toLowerCase();
  const to = order.cliente?.email;
  if (provider === "none") return { skipped: true, provider };
  if (!to) throw new Error("Pedido sem e-mail");
  const { subject, html, text } = buildEmail(order);
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM não configurado");
  const replyTo = process.env.EMAIL_REPLY_TO || undefined;

  if (provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text, reply_to: replyTo }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return { provider };
  }

  if (provider === "sendgrid") {
    const match = from.match(/^(.*)<(.+)>$/);
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: match ? { email: match[2].trim(), name: match[1].trim() } : { email: from },
        reply_to: replyTo ? { email: replyTo } : undefined,
        subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      }),
    });
    if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`);
    return { provider };
  }

  if (provider === "smtp") {
    const nodemailer = require("nodemailer");
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: String(process.env.SMTP_SECURE) === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({ from, to, subject, html, text, replyTo });
    return { provider };
  }

  throw new Error(`EMAIL_PROVIDER desconhecido: ${provider}`);
}

/* ---------------- Provedores de mensagem ---------------- */

async function sendMessage(order) {
  const provider = (process.env.MESSAGE_PROVIDER || "none").toLowerCase();
  if (provider === "none") return { skipped: true, provider };
  const phone = phoneE164(order.cliente?.telefone);
  if (!phone) throw new Error("Pedido sem telefone");
  const text = buildMessageText(order);
  const label = statusLabel(order.status_producao, order.modalidade);

  if (provider === "whatsapp_cloud") {
    const template = process.env.WHATSAPP_TEMPLATE_NAME;
    const body = template
      ? {
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: template,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "pt_BR" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: String(order.cliente?.nome || "") },
                  { type: "text", text: String(order.codigo_curto) },
                  { type: "text", text: label },
                ],
              },
            ],
          },
        }
      : { messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } };
    const res = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`WhatsApp Cloud ${res.status}: ${await res.text()}`);
    return { provider };
  }

  if (provider === "zapi") {
    const res = await fetch(
      `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}/send-text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(process.env.ZAPI_CLIENT_TOKEN ? { "Client-Token": process.env.ZAPI_CLIENT_TOKEN } : {}) },
        body: JSON.stringify({ phone, message: text }),
      }
    );
    if (!res.ok) throw new Error(`Z-API ${res.status}: ${await res.text()}`);
    return { provider };
  }

  if (provider === "evolution") {
    const base = String(process.env.EVOLUTION_URL || "").replace(/\/$/, "");
    const res = await fetch(`${base}/message/sendText/${process.env.EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY },
      body: JSON.stringify({ number: phone, text }),
    });
    if (!res.ok) throw new Error(`Evolution API ${res.status}: ${await res.text()}`);
    return { provider };
  }

  if (provider === "twilio_sms" || provider === "twilio_whatsapp") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const wa = provider === "twilio_whatsapp";
    const form = new URLSearchParams({
      From: wa ? `whatsapp:${process.env.TWILIO_FROM}` : process.env.TWILIO_FROM,
      To: wa ? `whatsapp:+${phone}` : `+${phone}`,
      Body: wa ? text : text.replace(/\*/g, ""),
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    return { provider };
  }

  throw new Error(`MESSAGE_PROVIDER desconhecido: ${provider}`);
}

/** Dispara os dois canais em paralelo e devolve o resultado para gravar em `notificacoes`. */
async function notifyOrder(order) {
  const [email, message] = await Promise.allSettled([sendEmail(order), sendMessage(order)]);
  const result = {
    email_enviado: email.status === "fulfilled" && !email.value.skipped,
    mensagem_enviada: message.status === "fulfilled" && !message.value.skipped,
    email_erro: email.status === "rejected" ? String(email.reason?.message || email.reason).slice(0, 300) : null,
    mensagem_erro: message.status === "rejected" ? String(message.reason?.message || message.reason).slice(0, 300) : null,
    canal_email: process.env.EMAIL_PROVIDER || "none",
    canal_mensagem: process.env.MESSAGE_PROVIDER || "none",
    ultimo_status_notificado: order.status_producao,
    ultimo_disparo_em: new Date().toISOString(),
  };
  return result;
}

module.exports = { notifyOrder, buildMessageText, buildEmail, statusLabel, phoneE164 };

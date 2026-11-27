// Painel administrativo — Studio Personalizado.

import {
  $, $$, round, formatBRL, formatNumber, uid, escapeHtml, slugify, formatPhone, onlyDigits, toast, debounce,
  formatDateTime, timeAgo, statusLabel, STATUS_FLOW, PAYMENT_LABELS, PAYMENT_STATUS_LABELS, MODE_LABELS,
  applyBrandColor, deepClone, registerServiceWorker,
} from "./utils.js";
import { createStore, DEFAULT_LOCAL_ADMIN } from "./store.js";
import { DEFAULT_SETTINGS } from "./defaults.js";
import { FONT_CATALOG, FONT_SOURCES, FONT_CATEGORIES, getAvailableFonts, loadFont, loadFontForText, fontStack, customFontToEntry } from "./fonts.js";
import { buildStage, fromOrderSide, getPrintCm, getArtVisibleBounds, SIDE_LABELS } from "./render.js";

let store;

const state = {
  user: null,
  tab: "pedidos",
  settings: deepClone(DEFAULT_SETTINGS),
  products: [],
  arts: [],
  customFonts: [],
  orders: [],
  ordersLoaded: false,
  knownOrderIds: new Set(),
  openOrderId: null,
  unsubscribeOrders: null,
  disabledFonts: new Set(),
};

/* ====================================================================== */
/* Inicialização e autenticação                                           */
/* ====================================================================== */

async function boot() {
  store = await createStore();
  bindLogin();
  bindTabs();
  bindOrders();
  bindCatalog();
  bindArts();
  bindFonts();
  bindSettings();
  registerServiceWorker();

  store.onAuthChange(async (user) => {
    state.user = user;
    if (!user) return showLogin();
    if (user.notAdmin) {
      showLogin(`A conta ${user.email} não tem permissão de administrador. Adicione o documento admins/${user.uid} no Firestore.`);
      await store.signOut();
      return;
    }
    await showApp();
  });
}

function showLogin(error = "") {
  state.unsubscribeOrders?.();
  state.unsubscribeOrders = null;
  $("#adminApp").hidden = true;
  $("#loginView").hidden = false;
  const err = $("#loginError");
  err.hidden = !error;
  err.textContent = error;
  const hint = $("#loginHint");
  if (store.mode === "local") {
    hint.hidden = false;
    hint.innerHTML = store.usesDefaultCredentials()
      ? `<strong>Modo local (demonstração).</strong> Acesso inicial: <code>${DEFAULT_LOCAL_ADMIN.email}</code> / <code>${DEFAULT_LOCAL_ADMIN.password}</code>. Altere a senha em “Marca &amp; Config.”.`
      : `<strong>Modo local (demonstração).</strong> Os dados ficam apenas neste navegador.`;
  } else {
    hint.hidden = true;
  }
  $("#forgotPassword").hidden = store.mode !== "firebase";
  setTimeout(() => $("#loginEmail").focus(), 50);
}

function bindLogin() {
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#loginSubmit");
    btn.disabled = true;
    btn.classList.add("is-loading");
    $("#loginError").hidden = true;
    try {
      await store.signIn($("#loginEmail").value, $("#loginPassword").value);
      $("#loginPassword").value = "";
    } catch (err) {
      $("#loginError").textContent = err.message;
      $("#loginError").hidden = false;
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-loading");
    }
  });
  $("#forgotPassword").addEventListener("click", async () => {
    const email = $("#loginEmail").value.trim();
    if (!email) return toast("Digite seu e-mail primeiro.", "warning");
    try {
      await store.sendPasswordReset(email);
      toast("Enviamos um link de redefinição para o seu e-mail.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
  $("#logoutButton").addEventListener("click", () => store.signOut());
}

async function showApp() {
  $("#loginView").hidden = true;
  $("#adminApp").hidden = false;
  $("#userEmail").textContent = state.user.email;
  const badge = $("#modeBadge");
  badge.textContent = store.mode === "firebase" ? "Firebase conectado" : "Modo local";
  badge.classList.toggle("is-local", store.mode !== "firebase");
  await loadAll();
  if (!state.unsubscribeOrders) {
    state.unsubscribeOrders = store.subscribeOrders(onOrders, () => {
      $("#liveStatus").textContent = "Sem conexão em tempo real";
      $("#liveStatus").classList.add("is-off");
    });
  }
  selectTab(location.hash.replace("#", "") || state.tab, false);
}

async function loadAll() {
  try {
    const [settings, products, arts, fonts] = await Promise.all([
      store.getSettings(),
      store.listProducts(),
      store.listArts(),
      store.listCustomFonts(),
    ]);
    state.settings = settings;
    state.products = products;
    state.arts = arts;
    state.customFonts = fonts;
    state.disabledFonts = new Set(settings.disabledFonts || []);
  } catch (err) {
    console.error(err);
    toast(`Erro ao carregar dados: ${err.message}`, "error", 6000);
  }
  applyAdminBranding();
  renderProducts();
  renderArts();
  renderFonts();
  renderSettings();
}

function applyAdminBranding() {
  const s = state.settings;
  $("#adminBrandName").textContent = s.brandName || "Studio";
  $("#adminBrandMark").textContent = ((s.brandName || "S")[0] + (s.brandSubtitle || "P")[0]).toUpperCase();
  const logo = $("#adminBrandLogo");
  logo.hidden = !s.logoUrl;
  $("#adminBrandMark").hidden = !!s.logoUrl;
  if (s.logoUrl) logo.src = s.logoUrl;
  applyBrandColor(s.primaryColor);
}

/* ====================================================================== */
/* Abas                                                                   */
/* ====================================================================== */

function selectTab(tab, push = true) {
  if (!$(`#tab-${tab}`)) tab = "pedidos";
  state.tab = tab;
  $$(".admin-tabs [role=tab]").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $$(".tab-panel").forEach((p) => (p.hidden = p.id !== `tab-${tab}`));
  if (push) history.replaceState(null, "", `#${tab}`);
}

function bindTabs() {
  const tabs = $$(".admin-tabs [role=tab]");
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => selectTab(b.dataset.tab));
    b.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      next.focus();
      selectTab(next.dataset.tab);
    });
  });
}

/* ====================================================================== */
/* Pedidos (KDS)                                                          */
/* ====================================================================== */

const COLUMN_HINTS = {
  AGUARDANDO_PAGAMENTO: "Confirme o pagamento para liberar a produção",
  EM_FILA: "Pagos ou “pagar na retirada”",
  EM_PRODUCAO: "Sendo produzidos agora",
  PRONTO_PARA_RETIRADA: "Aguardando retirada/entrega",
  ENTREGUE: "Últimos concluídos",
};

const nextStatus = (order) => STATUS_FLOW[STATUS_FLOW.indexOf(order.status_producao) + 1] || null;
const prevStatus = (order) => STATUS_FLOW[STATUS_FLOW.indexOf(order.status_producao) - 1] || null;

function actionLabel(order) {
  switch (order.status_producao) {
    case "AGUARDANDO_PAGAMENTO":
      return "Confirmar pagamento";
    case "EM_FILA":
      return "Iniciar produção";
    case "EM_PRODUCAO":
      return "Marcar como pronto";
    case "PRONTO_PARA_RETIRADA":
      return order.modalidade === "ENCOMENDA" ? "Marcar como entregue" : "Confirmar retirada";
    default:
      return null;
  }
}

function onOrders(orders) {
  const fresh = orders.filter((o) => !state.knownOrderIds.has(o.id));
  if (state.ordersLoaded && fresh.length) {
    fresh.forEach((o) => toast(`Novo pedido #${o.codigo_curto} — ${o.cliente?.nome || ""}`, "success", 5000));
    if ($("#orderSound").checked) beep();
  }
  orders.forEach((o) => state.knownOrderIds.add(o.id));
  state.orders = orders;
  state.ordersLoaded = true;
  renderKanban();
  if (state.openOrderId) {
    const o = orders.find((x) => x.id === state.openOrderId);
    if (o) renderOrderDrawer(o);
    else closeOrderDrawer();
  }
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    /* som opcional */
  }
}

function filteredOrders() {
  const q = $("#orderSearch").value.trim().toLowerCase();
  const qDigits = onlyDigits(q);
  const mode = $("#orderModeFilter").value;
  return state.orders.filter((o) => {
    if (mode && o.modalidade !== mode) return false;
    if (!q) return true;
    return (
      String(o.codigo_curto).includes(q) ||
      String(o.numero_pedido).toLowerCase().includes(q) ||
      String(o.cliente?.nome || "").toLowerCase().includes(q) ||
      String(o.cliente?.email || "").toLowerCase().includes(q) ||
      (qDigits.length >= 3 && String(o.cliente?.telefone || "").includes(qDigits))
    );
  });
}

function notificationBadge(o) {
  const n = o.notificacoes || {};
  if (store.mode !== "firebase" || n.modo === "local") return `<span class="badge badge-muted" title="Modo local: envie manualmente">Aviso manual</span>`;
  if (n.email_erro || n.mensagem_erro) return `<span class="badge badge-danger" title="${escapeHtml(n.email_erro || n.mensagem_erro)}">Falha no aviso</span>`;
  if (n.email_enviado || n.mensagem_enviada) {
    const ch = [n.mensagem_enviada ? "Msg" : null, n.email_enviado ? "E-mail" : null].filter(Boolean).join(" + ");
    return `<span class="badge badge-success">${ch} ✓</span>`;
  }
  return `<span class="badge badge-muted">Enviando aviso…</span>`;
}

function renderKanban() {
  const host = $("#kanban");
  const orders = filteredOrders();
  const pending = state.orders.filter((o) => !["ENTREGUE"].includes(o.status_producao)).length;
  $("#ordersBadge").textContent = pending ? String(pending) : "";
  host.innerHTML = STATUS_FLOW.map((status) => {
    let list = orders.filter((o) => o.status_producao === status);
    if (status === "ENTREGUE") list = list.slice(0, 30);
    else list = list.slice().reverse(); // mais antigos primeiro (fila)
    return `
      <section class="kanban-col" data-status="${status}" aria-label="${escapeHtml(statusLabel(status))}">
        <header class="kanban-head">
          <h3>${escapeHtml(statusLabel(status))}</h3>
          <span class="count">${list.length}</span>
        </header>
        <p class="kanban-hint">${COLUMN_HINTS[status]}</p>
        <div class="kanban-list">
          ${list.length ? list.map(orderCard).join("") : `<p class="kanban-empty">Nenhum pedido</p>`}
        </div>
      </section>`;
  }).join("");
}

function orderCard(o) {
  const items = (o.itens || [])
    .map(
      (i) =>
        `<li><span class="dot" style="--swatch:${escapeHtml(i.cor)}"></span>${i.quantidade || 1}× ${escapeHtml(i.produto_nome)}${i.tamanho && i.tamanho !== "Único" ? ` <b>${escapeHtml(i.tamanho)}</b>` : ""}${i.acabamento_label ? ` · ${escapeHtml(i.acabamento_label)}` : ""}</li>`
    )
    .join("");
  const action = actionLabel(o);
  const paid = o.status_pagamento === "PAGO";
  return `
    <article class="order-card ${o.alerta_valor ? "has-alert" : ""}" data-order="${escapeHtml(o.id)}" tabindex="0" aria-label="Pedido ${escapeHtml(o.codigo_curto)}, ${escapeHtml(o.cliente?.nome || "")}">
      <header>
        <strong class="order-code-sm">#${escapeHtml(o.codigo_curto)}</strong>
        <span class="badge ${o.modalidade === "ENCOMENDA" ? "badge-info" : "badge-dark"}">${o.modalidade === "ENCOMENDA" ? "Encomenda" : "Evento"}</span>
        <time datetime="${escapeHtml(o.created_at)}">${escapeHtml(timeAgo(o.created_at))}</time>
      </header>
      <p class="order-customer">${escapeHtml(o.cliente?.nome || "—")}${o.demo ? ' <span class="badge badge-muted">demo</span>' : ""}</p>
      <ul class="order-items">${items}</ul>
      <div class="order-tags">
        <span class="badge ${paid ? "badge-success" : "badge-warning"}">${escapeHtml(PAYMENT_LABELS[o.metodo_pagamento] || o.metodo_pagamento)} · ${paid ? "Pago" : "Pendente"}</span>
        ${notificationBadge(o)}
        ${o.alerta_valor ? `<span class="badge badge-danger" title="O valor enviado difere do calculado no servidor">Conferir valor</span>` : ""}
      </div>
      <footer>
        <strong>${formatBRL(o.valor_total)}</strong>
        ${action ? `<button type="button" class="btn btn-primary btn-sm" data-advance="${escapeHtml(o.id)}">${action}</button>` : ""}
      </footer>
    </article>`;
}

async function advanceOrder(order) {
  const next = nextStatus(order);
  if (!next) return;
  const extra = {};
  if (order.status_producao === "AGUARDANDO_PAGAMENTO") extra.status_pagamento = "PAGO";
  if (next === "ENTREGUE" && order.status_pagamento !== "PAGO") {
    if (window.confirm(`O pagamento do pedido #${order.codigo_curto} foi recebido?`)) extra.status_pagamento = "PAGO";
  }
  try {
    await store.setOrderStatus(order.id, next, extra);
    toast(
      store.mode === "firebase"
        ? `#${order.codigo_curto} → ${statusLabel(next, order.modalidade)}. Notificando o cliente…`
        : `#${order.codigo_curto} → ${statusLabel(next, order.modalidade)} (modo local: avise o cliente manualmente).`,
      "success"
    );
  } catch (err) {
    toast(`Não foi possível atualizar: ${err.message}`, "error");
  }
}

async function revertOrder(order) {
  const prev = prevStatus(order);
  if (!prev) return;
  if (!window.confirm(`Voltar o pedido #${order.codigo_curto} para “${statusLabel(prev, order.modalidade)}”? O cliente será notificado.`)) return;
  try {
    await store.setOrderStatus(order.id, prev);
  } catch (err) {
    toast(err.message, "error");
  }
}

function bindOrders() {
  $("#orderSearch").addEventListener("input", debounce(renderKanban, 150));
  $("#orderModeFilter").addEventListener("change", renderKanban);
  $("#kanban").addEventListener("click", (e) => {
    const adv = e.target.closest("[data-advance]");
    if (adv) {
      e.stopPropagation();
      const order = state.orders.find((o) => o.id === adv.dataset.advance);
      if (order) advanceOrder(order);
      return;
    }
    const card = e.target.closest("[data-order]");
    if (card) openOrderDrawer(card.dataset.order);
  });
  $("#kanban").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches("[data-order]")) return;
    openOrderDrawer(e.target.dataset.order);
  });
  $("#closeOrder").addEventListener("click", closeOrderDrawer);
  $("#orderBackdrop").addEventListener("click", closeOrderDrawer);
  $("#printOrder").addEventListener("click", () => window.print());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.openOrderId) closeOrderDrawer();
  });
  setInterval(() => {
    if (state.tab === "pedidos" && !state.openOrderId) renderKanban(); // atualiza "há x min"
  }, 60000);
}

function openOrderDrawer(id) {
  const order = state.orders.find((o) => o.id === id);
  if (!order) return;
  state.openOrderId = id;
  renderOrderDrawer(order);
  const d = $("#orderDrawer");
  d.classList.add("is-open");
  d.removeAttribute("inert");
  d.setAttribute("aria-hidden", "false");
  $("#orderBackdrop").hidden = false;
  document.body.classList.add("printing-order");
  $("#closeOrder").focus();
}

function closeOrderDrawer() {
  const id = state.openOrderId;
  state.openOrderId = null;
  const d = $("#orderDrawer");
  d.classList.remove("is-open");
  d.setAttribute("inert", "");
  d.setAttribute("aria-hidden", "true");
  $("#orderBackdrop").hidden = true;
  document.body.classList.remove("printing-order");
  if (id) $(`[data-order="${CSS.escape(id)}"]`)?.focus();
}

const cm = (v) => (v == null ? "—" : `${formatNumber(v, 2)} cm`);
const pos = (p) => (p ? `X ${formatNumber(p.x, 2)} · Y ${formatNumber(p.y, 2)} cm` : "—");
const dims = (d) => (d ? `${formatNumber(d.largura, 2)} × ${formatNumber(d.altura, 2)} cm` : "—");

function sideSpecs(s) {
  if (!s) return "";
  const rows = [];
  if (s.estampa_id) {
    rows.push(["Estampa", `${escapeHtml(s.estampa_nome || s.estampa_id)} <a href="${escapeHtml(s.estampa_url)}" target="_blank" rel="noopener" download>baixar arquivo</a>`]);
    rows.push(["Dimensões", dims(s.estampa_dimensoes_cm)]);
    rows.push(["Posição (centro)", pos(s.estampa_posicao_cm)]);
    rows.push(["Rotação", `${formatNumber(s.estampa_rotacao_graus || 0)}°`]);
  }
  if (s.logo_url) {
    rows.push(["Logo do cliente", `<img class="logo-spec-thumb" src="${escapeHtml(s.logo_url)}" alt="" /> <a href="${escapeHtml(s.logo_url)}" target="_blank" rel="noopener" download="${escapeHtml(slugify(s.logo_nome || "logo"))}">baixar arquivo</a>`]);
    rows.push(["Dimensões", dims(s.logo_dimensoes_cm)]);
    rows.push(["Posição (centro)", pos(s.logo_posicao_cm)]);
    rows.push(["Rotação", `${formatNumber(s.logo_rotacao_graus || 0)}°`]);
  }
  if (s.texto) {
    const font = FONT_CATALOG.find((f) => f.id === s.texto_fonte_id);
    rows.push(["Texto", `<span class="text-sample" style="font-family:${escapeHtml(s.texto_fonte_css || "")};color:${escapeHtml(s.texto_cor)};${isLight(s.texto_cor) ? "background:#2a2f40;" : ""}">${escapeHtml(s.texto)}</span>`]);
    rows.push(["Fonte", `${escapeHtml(s.texto_fonte)} <span class="tag">${escapeHtml(FONT_SOURCES[s.texto_fonte_origem]?.short || s.texto_fonte_origem || "")}</span>${font ? "" : ""}${s.texto_negrito ? " · negrito" : ""}${s.texto_italico ? " · itálico" : ""}`]);
    rows.push(["Cor da letra", `<span class="dot" style="--swatch:${escapeHtml(s.texto_cor)}"></span> ${escapeHtml(String(s.texto_cor).toUpperCase())}`]);
    rows.push(["Tamanho da letra", `${cm(s.texto_tamanho_cm)} (≈ ${formatNumber(s.texto_tamanho_pt || 0)} pt)`]);
    rows.push(["Caixa do texto", dims(s.texto_dimensoes_cm)]);
    rows.push(["Posição (centro)", pos(s.texto_posicao_cm)]);
    rows.push(["Rotação", `${formatNumber(s.texto_rotacao_graus || 0)}°`]);
  }
  return `<dl class="spec-table">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}

function isLight(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return false;
  const n = parseInt(h, 16);
  return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 200;
}

function whatsappLink(order) {
  const phone = onlyDigits(order.cliente?.telefone);
  const text = `Olá, ${order.cliente?.nome}! Seu pedido *#${order.codigo_curto}* está com o status: *${statusLabel(order.status_producao, order.modalidade)}*.`;
  return `https://wa.me/55${phone}?text=${encodeURIComponent(text)}`;
}

function mailLink(order) {
  const subject = `Pedido #${order.codigo_curto} — Status: ${statusLabel(order.status_producao, order.modalidade)}`;
  const body = `Olá, ${order.cliente?.nome}!\n\nSeu pedido ${order.numero_pedido} está com o status: ${statusLabel(order.status_producao, order.modalidade)}.\n\n${state.settings.brandName} ${state.settings.brandSubtitle}`;
  return `mailto:${order.cliente?.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function renderOrderDrawer(o) {
  $("#orderDrawerTitle").textContent = `Pedido #${o.codigo_curto}`;
  $("#orderDrawerSubtitle").textContent = `${o.numero_pedido} · ${formatDateTime(o.created_at)} · origem: ${o.origem || "—"}`;
  const body = $("#orderDrawerBody");
  const c = o.cliente || {};
  const a = c.endereco;
  const n = o.notificacoes || {};
  const history = o.historico || [];
  const currentIndex = STATUS_FLOW.indexOf(o.status_producao);

  body.innerHTML = `
    <ol class="status-track">
      ${STATUS_FLOW.map((s, i) => {
        const h = [...history].reverse().find((x) => x.status === s);
        return `<li class="${i < currentIndex ? "done" : i === currentIndex ? "current" : ""}"><span>${escapeHtml(statusLabel(s, o.modalidade))}</span>${h ? `<time>${escapeHtml(formatDateTime(h.em))}</time>` : ""}</li>`;
      }).join("")}
    </ol>

    ${o.alerta_valor ? `<p class="notice notice-danger">Atenção: o total enviado (${formatBRL(o.valor_total)}) difere do calculado no servidor (${formatBRL(o.valor_total_calculado)}). Confira antes de produzir.</p>` : ""}

    <section class="detail-section">
      <h3>Itens (${o.quantidade_itens || (o.itens || []).length})</h3>
      <div class="detail-items" id="detailItems"></div>
    </section>

    <section class="detail-section detail-grid">
      <div>
        <h3>Cliente</h3>
        <dl class="spec-table">
          <div><dt>Nome</dt><dd>${escapeHtml(c.nome)}</dd></div>
          <div><dt>WhatsApp</dt><dd><a href="https://wa.me/55${escapeHtml(onlyDigits(c.telefone))}" target="_blank" rel="noopener">${escapeHtml(formatPhone(c.telefone))}</a></dd></div>
          <div><dt>E-mail</dt><dd><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></dd></div>
        </dl>
      </div>
      <div>
        <h3>${escapeHtml(MODE_LABELS[o.modalidade] || "Modalidade")}</h3>
        ${
          a
            ? `<address class="address">${escapeHtml(a.rua)}, ${escapeHtml(a.numero)}${a.complemento ? ` – ${escapeHtml(a.complemento)}` : ""}<br>${escapeHtml(a.bairro)} · ${escapeHtml(a.cidade)}/${escapeHtml(a.estado)}<br>CEP ${escapeHtml(a.cep)}</address>
               <a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.rua}, ${a.numero}, ${a.cidade} - ${a.estado}, ${a.cep}`)}">Abrir no mapa</a>`
            : `<p class="muted">Retirada no local do evento — sem endereço.</p>`
        }
      </div>
      <div>
        <h3>Pagamento</h3>
        <dl class="spec-table">
          <div><dt>Método</dt><dd>${escapeHtml(PAYMENT_LABELS[o.metodo_pagamento] || o.metodo_pagamento)}</dd></div>
          <div><dt>Status</dt><dd><span class="badge ${o.status_pagamento === "PAGO" ? "badge-success" : "badge-warning"}">${escapeHtml(PAYMENT_STATUS_LABELS[o.status_pagamento] || o.status_pagamento)}</span></dd></div>
          <div><dt>Subtotal</dt><dd>${formatBRL(o.subtotal ?? o.valor_total)}</dd></div>
          ${o.modalidade === "ENCOMENDA" ? `<div><dt>Entrega</dt><dd>${o.taxa_entrega ? formatBRL(o.taxa_entrega) : "A combinar"}</dd></div>` : ""}
          <div><dt>Total</dt><dd><strong>${formatBRL(o.valor_total)}</strong></dd></div>
        </dl>
      </div>
      <div>
        <h3>Notificações</h3>
        ${
          store.mode === "firebase" && n.modo !== "local"
            ? `<dl class="spec-table">
                <div><dt>WhatsApp/SMS</dt><dd>${n.mensagem_enviada ? "✓ enviada" : n.mensagem_erro ? `✗ ${escapeHtml(n.mensagem_erro)}` : "pendente"}${n.canal_mensagem ? ` <span class="tag">${escapeHtml(n.canal_mensagem)}</span>` : ""}</dd></div>
                <div><dt>E-mail</dt><dd>${n.email_enviado ? "✓ enviado" : n.email_erro ? `✗ ${escapeHtml(n.email_erro)}` : "pendente"}${n.canal_email ? ` <span class="tag">${escapeHtml(n.canal_email)}</span>` : ""}</dd></div>
                <div><dt>Último envio</dt><dd>${escapeHtml(formatDateTime(n.ultimo_disparo_em))}${n.ultimo_status_notificado ? ` · ${escapeHtml(statusLabel(n.ultimo_status_notificado, o.modalidade))}` : ""}</dd></div>
              </dl>`
            : `<p class="muted small">Modo local: as mensagens automáticas não são enviadas. Use os atalhos abaixo para avisar o cliente.</p>`
        }
        <div class="inline-actions">
          ${store.mode === "firebase" ? `<button type="button" class="btn btn-ghost btn-sm" data-act="resend">Reenviar notificação</button>` : ""}
          <a class="btn btn-ghost btn-sm" href="${whatsappLink(o)}" target="_blank" rel="noopener">Abrir WhatsApp</a>
          <a class="btn btn-ghost btn-sm" href="${mailLink(o)}">Abrir e-mail</a>
        </div>
      </div>
    </section>`;

  const itemsHost = $("#detailItems");
  for (const item of o.itens || []) {
    const el = document.createElement("article");
    el.className = "detail-item";
    const previews = document.createElement("div");
    previews.className = "detail-previews";
    for (const [key, sideKey] of [["frente", "front"], ["costas", "back"]]) {
      if (sideKey === "back" && !item.costas) continue;
      const side = fromOrderSide(item[key]);
      const fig = document.createElement("figure");
      fig.className = "item-preview";
      fig.append(
        buildStage({ product: item.render, sideKey, side, color: item.cor, finish: item.acabamento, showPrintArea: true }).root
      );
      const cap = document.createElement("figcaption");
      cap.textContent = SIDE_LABELS[sideKey];
      fig.append(cap);
      previews.append(fig);
      if (side?.text) loadFontForText(side.text, getAvailableFonts(state.settings, state.customFonts));
    }
    const info = document.createElement("div");
    info.className = "detail-item-info";
    info.innerHTML = `
      <header><h4>${item.quantidade || 1}× ${escapeHtml(item.produto_nome)}</h4><strong>${formatBRL(item.valor_unitario * (item.quantidade || 1))}</strong></header>
      <dl class="spec-table">
        <div><dt>Cor do produto</dt><dd><span class="dot" style="--swatch:${escapeHtml(item.cor)}"></span> ${escapeHtml(String(item.cor).toUpperCase())}</dd></div>
        <div><dt>Tamanho</dt><dd>${escapeHtml(item.tamanho || "—")}</dd></div>
        ${item.acabamento_label ? `<div><dt>Acabamento</dt><dd><strong>${escapeHtml(item.acabamento_label)}</strong></dd></div>` : ""}
        <div><dt>Área de impressão</dt><dd>${formatNumber(item.render?.printCm?.width)} × ${formatNumber(item.render?.printCm?.height)} cm</dd></div>
      </dl>
      ${item.frente ? `<h5>Frente</h5>${sideSpecs(item.frente)}` : `<p class="muted small">Frente sem personalização.</p>`}
      ${item.costas ? `<h5>Costas</h5>${sideSpecs(item.costas)}` : ""}`;
    el.append(previews, info);
    itemsHost.append(el);
  }

  body.querySelector('[data-act="resend"]')?.addEventListener("click", async () => {
    try {
      await store.requestNotification(o.id);
      toast("Reenvio solicitado.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  // Ações do rodapé
  const actions = $("#orderDrawerActions");
  const next = actionLabel(o);
  actions.innerHTML = `
    <div class="inline-actions">
      ${prevStatus(o) ? `<button type="button" class="btn btn-ghost btn-sm" data-act="back">← Voltar status</button>` : ""}
      <button type="button" class="btn btn-ghost btn-sm" data-act="pay">${o.status_pagamento === "PAGO" ? "Marcar como não pago" : "Marcar como pago"}</button>
      <button type="button" class="btn btn-ghost btn-sm danger" data-act="delete">Excluir</button>
    </div>
    ${next ? `<button type="button" class="btn btn-primary" data-act="next">${next}</button>` : `<span class="badge badge-success">Concluído</span>`}`;
  actions.querySelector('[data-act="next"]')?.addEventListener("click", () => advanceOrder(o));
  actions.querySelector('[data-act="back"]')?.addEventListener("click", () => revertOrder(o));
  actions.querySelector('[data-act="pay"]').addEventListener("click", async () => {
    await store.updateOrder(o.id, { status_pagamento: o.status_pagamento === "PAGO" ? "PENDENTE" : "PAGO" });
  });
  actions.querySelector('[data-act="delete"]').addEventListener("click", async () => {
    if (!window.confirm(`Excluir definitivamente o pedido #${o.codigo_curto}?`)) return;
    await store.deleteOrder(o.id);
    closeOrderDrawer();
    toast("Pedido excluído.");
  });
}

/* ====================================================================== */
/* Catálogo & Mockups                                                     */
/* ====================================================================== */

let editing = null; // rascunho do produto em edição
let editingIsNew = false;
let areaSide = "front";

function renderProducts() {
  const host = $("#productList");
  $("#importDefaults").hidden = !(store.mode === "firebase" && !state.products.length);
  if (!state.products.length) {
    host.innerHTML = `<div class="admin-card empty-card"><p>Nenhum produto cadastrado.</p>${store.mode === "firebase" ? "<p class=muted>Use “Importar catálogo padrão” para começar com os 4 produtos de exemplo.</p>" : ""}</div>`;
    return;
  }
  host.innerHTML = "";
  state.products.forEach((p, index) => {
    const card = document.createElement("article");
    card.className = `admin-card product-admin-card ${p.active === false ? "is-inactive" : ""}`;
    const prev = document.createElement("div");
    prev.className = "product-admin-preview";
    prev.append(buildStage({ product: p, color: p.colors?.[0], showPrintArea: true }).root);
    const finishes = p.customizationOptions?.finishTypes || [];
    const info = document.createElement("div");
    info.className = "product-admin-info";
    info.innerHTML = `
      <div class="card-head">
        <h3>${escapeHtml(p.name)}</h3>
        <label class="switch" title="Ativo na loja"><input type="checkbox" data-toggle ${p.active !== false ? "checked" : ""} /><span class="sr-only">Ativo</span></label>
      </div>
      <p class="muted small">${escapeHtml(p.description || "")}</p>
      <div class="price-edit">
        <label for="price-${escapeHtml(p.id)}">Preço</label>
        <span class="currency">R$</span>
        <input id="price-${escapeHtml(p.id)}" type="number" min="0" step="0.01" value="${Number(p.price).toFixed(2)}" data-price />
      </div>
      <div class="tags">
        <span class="tag">${p.allowsBack ? "Frente + costas" : "Só frente"}</span>
        <span class="tag">Impressão ${formatNumber(p.printCm?.width)}×${formatNumber(p.printCm?.height)} cm</span>
        <span class="tag">${(p.sizes || []).join(" · ")}</span>
        ${finishes.map((f) => `<span class="tag">${escapeHtml(f.label)}${f.extraPrice ? ` +${formatBRL(f.extraPrice)}` : ""}</span>`).join("")}
      </div>
      <div class="swatches swatches-xs">${(p.colors || []).map((c) => `<span class="dot" style="--swatch:${escapeHtml(c)}"></span>`).join("")}</div>
      <div class="inline-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-edit>Editar</button>
        <button type="button" class="icon-button" data-up aria-label="Mover para cima" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="icon-button" data-down aria-label="Mover para baixo" ${index === state.products.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="btn btn-ghost btn-sm danger" data-delete>Excluir</button>
      </div>`;
    info.querySelector("[data-toggle]").addEventListener("change", (e) => quickSaveProduct(p, { active: e.target.checked }));
    info.querySelector("[data-price]").addEventListener("change", (e) => {
      const price = round(Number(e.target.value), 2);
      if (price < 0 || Number.isNaN(price)) return toast("Preço inválido.", "error");
      quickSaveProduct(p, { price });
    });
    info.querySelector("[data-edit]").addEventListener("click", () => openProductDialog(p));
    info.querySelector("[data-delete]").addEventListener("click", () => deleteProduct(p));
    info.querySelector("[data-up]").addEventListener("click", () => moveProduct(index, -1));
    info.querySelector("[data-down]").addEventListener("click", () => moveProduct(index, 1));
    card.append(prev, info);
    host.append(card);
  });
}

async function quickSaveProduct(p, patch) {
  const next = { ...p, ...patch };
  try {
    await store.saveProduct(next);
    Object.assign(p, patch);
    toast(`${p.name} atualizado.`, "success");
    renderProducts();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function moveProduct(index, delta) {
  const list = state.products;
  const j = index + delta;
  if (j < 0 || j >= list.length) return;
  [list[index], list[j]] = [list[j], list[index]];
  list.forEach((p, i) => (p.order = i + 1));
  try {
    await Promise.all([list[index], list[j]].map((p) => store.saveProduct(p)));
    renderProducts();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function deleteProduct(p) {
  if (!window.confirm(`Excluir o produto “${p.name}”? Pedidos já feitos não são afetados.`)) return;
  try {
    await store.deleteProduct(p.id);
    state.products = state.products.filter((x) => x.id !== p.id);
    renderProducts();
    toast("Produto excluído.");
  } catch (err) {
    toast(err.message, "error");
  }
}

function blankProduct() {
  return {
    id: "",
    name: "",
    description: "",
    type: "",
    price: 0,
    active: true,
    order: state.products.length + 1,
    allowsBack: false,
    tintable: true,
    mockups: { front: "", back: null },
    printAreaCss: { front: { width: "40%", top: "50%", left: "50%" }, back: null },
    physicalCm: { width: 20, height: 20 },
    printCm: { width: 10, height: 10 },
    colors: ["#ffffff"],
    sizes: ["Único"],
    customizationOptions: { finishTypes: [] },
  };
}

const pct = (v, fallback) => {
  const n = parseFloat(String(v ?? "").replace("%", ""));
  return Number.isFinite(n) ? n : fallback;
};

function openProductDialog(product = null) {
  editingIsNew = !product;
  editing = deepClone(product || blankProduct());
  editing.printAreaCss ||= {};
  editing.printAreaCss.front ||= { width: "40%", top: "50%", left: "50%" };
  editing.customizationOptions ||= { finishTypes: [] };
  editing.customizationOptions.finishTypes ||= [];
  areaSide = "front";
  $("#productDialogTitle").textContent = editingIsNew ? "Novo produto" : `Editar · ${editing.name}`;
  $("#productFormError").hidden = true;
  $("#pfName").value = editing.name;
  $("#pfDescription").value = editing.description || "";
  $("#pfType").value = editing.type || "";
  $("#pfPrice").value = Number(editing.price || 0).toFixed(2);
  $("#pfActive").checked = editing.active !== false;
  $("#pfAllowsBack").checked = !!editing.allowsBack;
  $("#pfTintable").checked = editing.tintable !== false;
  $("#pfMockFront").value = editing.mockups?.front || "";
  $("#pfMockBack").value = editing.mockups?.back || "";
  $("#pfPhysW").value = editing.physicalCm?.width ?? "";
  $("#pfPhysH").value = editing.physicalCm?.height ?? "";
  $("#pfPrintW").value = editing.printCm?.width ?? 10;
  $("#pfPrintH").value = editing.printCm?.height ?? 10;
  $("#pfSizes").value = (editing.sizes || []).join(", ");
  renderColorEditor();
  renderFinishEditor();
  syncAreaInputs();
  updateBackVisibility();
  renderProductPreview();
  renderMockThumbs();
  $("#productDialog").showModal();
}

function updateBackVisibility() {
  const back = $("#pfAllowsBack").checked;
  $("#pfBackMockup").hidden = !back;
  $("#pfAreaSide").hidden = !back;
  if (!back) areaSide = "front";
  $$("#pfAreaSide button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.side === areaSide)));
}

function currentArea() {
  editing.printAreaCss[areaSide] ||= deepClone(editing.printAreaCss.front);
  return editing.printAreaCss[areaSide];
}

function syncAreaInputs() {
  const a = currentArea();
  $("#pfAreaW").value = pct(a.width, 40);
  $("#pfAreaX").value = pct(a.left, 50);
  $("#pfAreaY").value = pct(a.top, 50);
}

function readProductForm() {
  if (!editing) return;
  editing.name = $("#pfName").value.trim();
  editing.description = $("#pfDescription").value.trim();
  editing.type = slugify($("#pfType").value) || slugify(editing.name);
  editing.price = round(Number($("#pfPrice").value), 2);
  editing.active = $("#pfActive").checked;
  editing.allowsBack = $("#pfAllowsBack").checked;
  editing.tintable = $("#pfTintable").checked;
  editing.mockups = { front: $("#pfMockFront").value.trim(), back: editing.allowsBack ? $("#pfMockBack").value.trim() || null : null };
  editing.physicalCm = { width: Number($("#pfPhysW").value) || null, height: Number($("#pfPhysH").value) || null };
  editing.printCm = { width: Number($("#pfPrintW").value) || 10, height: Number($("#pfPrintH").value) || 10 };
  editing.sizes = $("#pfSizes")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!editing.sizes.length) editing.sizes = ["Único"];
  const a = currentArea();
  a.width = `${pct($("#pfAreaW").value, 40)}%`;
  a.left = `${pct($("#pfAreaX").value, 50)}%`;
  a.top = `${pct($("#pfAreaY").value, 50)}%`;
  for (const k of ["front", "back"]) {
    const area = editing.printAreaCss[k];
    if (area) area.height = `${round((pct(area.width, 40) * editing.printCm.height) / editing.printCm.width, 1)}%`;
  }
  if (!editing.allowsBack) editing.printAreaCss.back = null;
  editing.customizationOptions.finishTypes = $$("#pfFinishes .finish-row")
    .map((row) => {
      const label = row.querySelector("[data-f=label]").value.trim();
      return {
        id: row.dataset.id || slugify(label),
        label,
        extraPrice: round(Number(row.querySelector("[data-f=price]").value) || 0, 2),
        description: row.querySelector("[data-f=desc]").value.trim(),
      };
    })
    .filter((f) => f.label);
}

function renderProductPreview() {
  if (!editing) return;
  const host = $("#pfStage");
  const sample = state.arts.find((a) => a.active !== false);
  const pc = getPrintCm(editing);
  const side = sample
    ? { art: { id: sample.id, url: sample.url, name: sample.name, x: 0, y: 0, widthCm: Math.min(pc.width, pc.height) * 0.6, aspect: 1, rotation: 0 }, text: null }
    : null;
  const { root, area } = buildStage({
    product: editing,
    sideKey: areaSide,
    side,
    color: editing.colors?.[0] || "#ffffff",
    showPrintArea: true,
  });
  area.classList.add("is-draggable");
  host.replaceChildren(root);
  $("#pfStageInfo").textContent = `Área de impressão: ${formatNumber(pc.width)} × ${formatNumber(pc.height)} cm · lado ${SIDE_LABELS[areaSide].toLowerCase()}`;
  if (sample) {
    getArtVisibleBounds(sample.url).then((info) => {
      const art = area.querySelector(".design-art");
      if (art) art.style.aspectRatio = String(info.aspect);
    });
  }

  // Arrastar o retângulo para posicionar a área de impressão
  area.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const rect = root.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, left: pct(currentArea().left, 50), top: pct(currentArea().top, 50) };
    area.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const left = round(Math.min(100, Math.max(0, start.left + ((ev.clientX - start.x) / rect.width) * 100)), 1);
      const top = round(Math.min(100, Math.max(0, start.top + ((ev.clientY - start.y) / rect.height) * 100)), 1);
      area.style.left = `${left}%`;
      area.style.top = `${top}%`;
      $("#pfAreaX").value = left;
      $("#pfAreaY").value = top;
    };
    const up = () => {
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerup", up);
      readProductForm();
    };
    area.addEventListener("pointermove", move);
    area.addEventListener("pointerup", up);
  });
}

function renderColorEditor() {
  const host = $("#pfColors");
  host.innerHTML =
    (editing.colors || [])
      .map(
        (c, i) => `
      <span class="color-edit">
        <input type="color" value="${escapeHtml(c)}" data-color-index="${i}" aria-label="Cor ${i + 1}" />
        <button type="button" class="icon-button" data-remove-color="${i}" aria-label="Remover cor ${i + 1}">✕</button>
      </span>`
      )
      .join("") + `<button type="button" class="btn btn-ghost btn-sm" id="pfAddColor">+ Cor</button>`;
}

function renderFinishEditor() {
  $("#pfFinishes").innerHTML = editing.customizationOptions.finishTypes
    .map(
      (f) => `
      <div class="finish-row" data-id="${escapeHtml(f.id)}">
        <input data-f="label" value="${escapeHtml(f.label)}" placeholder="Nome (ex.: Gravação a Laser)" aria-label="Nome do acabamento" />
        <input data-f="price" type="number" min="0" step="0.01" value="${Number(f.extraPrice || 0)}" aria-label="Acréscimo (R$)" title="Acréscimo (R$)" />
        <input data-f="desc" value="${escapeHtml(f.description || "")}" placeholder="Descrição" aria-label="Descrição" />
        <button type="button" class="icon-button" data-remove-finish aria-label="Remover acabamento">✕</button>
      </div>`
    )
    .join("");
}

async function uploadMockup(file, side) {
  try {
    toast("Enviando imagem…");
    const url = await store.uploadFile(file, { folder: "mockups", maxSize: 1600 });
    $(side === "front" ? "#pfMockFront" : "#pfMockBack").value = url;
    readProductForm();
    renderProductPreview();
    renderMockThumbs();
    toast("Mockup enviado.", "success");
  } catch (err) {
    toast(err.message, "error", 6000);
  }
}

function renderMockThumbs() {
  for (const [side, sel] of [["front", "#pfMockFrontThumb"], ["back", "#pfMockBackThumb"]]) {
    const url = $(side === "front" ? "#pfMockFront" : "#pfMockBack").value.trim();
    $(sel).innerHTML = url ? `<img src="${escapeHtml(url)}" alt="" />` : `<span class="muted small">sem imagem</span>`;
  }
}

function bindCatalog() {
  $("#newProduct").addEventListener("click", () => openProductDialog(null));
  $("#importDefaults").addEventListener("click", async () => {
    if (!window.confirm("Importar os 4 produtos e as 27 estampas de exemplo?")) return;
    try {
      await store.importDefaults();
      await loadAll();
      toast("Catálogo padrão importado.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  const dialog = $("#productDialog");
  dialog.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) dialog.close();
  });
  const form = $("#productForm");
  const refresh = debounce(() => {
    readProductForm();
    renderProductPreview();
  }, 120);
  form.addEventListener("input", (e) => {
    if (e.target.matches("[data-color-index]")) {
      editing.colors[Number(e.target.dataset.colorIndex)] = e.target.value;
    }
    if (e.target.matches("#pfMockFront, #pfMockBack")) renderMockThumbs();
    refresh();
  });
  form.addEventListener("change", (e) => {
    if (e.target.matches("[data-mock-file]") && e.target.files[0]) uploadMockup(e.target.files[0], e.target.dataset.mockFile);
    if (e.target.id === "pfAllowsBack") {
      updateBackVisibility();
      readProductForm();
      renderProductPreview();
    }
  });
  form.addEventListener("click", (e) => {
    if (e.target.id === "pfAddColor") {
      readProductForm();
      editing.colors.push("#cccccc");
      renderColorEditor();
      renderProductPreview();
    }
    const rc = e.target.closest("[data-remove-color]");
    if (rc) {
      if (editing.colors.length <= 1) return toast("O produto precisa de pelo menos uma cor.", "warning");
      editing.colors.splice(Number(rc.dataset.removeColor), 1);
      renderColorEditor();
      renderProductPreview();
    }
    if (e.target.id === "pfAddFinish") {
      readProductForm();
      editing.customizationOptions.finishTypes.push({ id: "", label: "", extraPrice: 0, description: "" });
      renderFinishEditor();
      $("#pfFinishes .finish-row:last-child input")?.focus();
    }
    if (e.target.closest("[data-remove-finish]")) {
      e.target.closest(".finish-row").remove();
      readProductForm();
    }
    const sideBtn = e.target.closest("#pfAreaSide [data-side]");
    if (sideBtn) {
      readProductForm();
      areaSide = sideBtn.dataset.side;
      updateBackVisibility();
      syncAreaInputs();
      renderProductPreview();
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    readProductForm();
    const err = $("#productFormError");
    const problems = [];
    if (editing.name.length < 2) problems.push("Informe o nome do produto.");
    if (!(editing.price >= 0)) problems.push("Preço inválido.");
    if (!(editing.printCm.width > 0 && editing.printCm.height > 0)) problems.push("Informe a área de impressão em cm.");
    if (problems.length) {
      err.textContent = problems.join(" ");
      err.hidden = false;
      return;
    }
    if (editingIsNew) {
      let id = slugify(editing.name) || uid("produto");
      while (state.products.some((p) => p.id === id)) id = `${slugify(editing.name)}-${Math.random().toString(36).slice(2, 5)}`;
      editing.id = id;
    }
    const btn = $("#productSave");
    btn.disabled = true;
    try {
      await store.saveProduct(editing);
      const i = state.products.findIndex((p) => p.id === editing.id);
      if (i >= 0) state.products[i] = deepClone(editing);
      else state.products.push(deepClone(editing));
      renderProducts();
      dialog.close();
      toast("Produto salvo.", "success");
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  dialog.addEventListener("close", () => (editing = null));
}

/* ====================================================================== */
/* Estampas                                                               */
/* ====================================================================== */

function renderArts() {
  const q = $("#artSearch").value.trim().toLowerCase();
  const f = $("#artFilter").value;
  const list = state.arts.filter(
    (a) =>
      (!q || a.name.toLowerCase().includes(q) || String(a.category || "").toLowerCase().includes(q)) &&
      (!f || (f === "active" ? a.active !== false : a.active === false))
  );
  $("#artCount").textContent = `${list.length} de ${state.arts.length} estampas · ${state.arts.filter((a) => a.active !== false).length} ativas`;
  $("#artCategoryList").innerHTML = [...new Set(state.arts.map((a) => a.category).filter(Boolean))]
    .map((c) => `<option value="${escapeHtml(c)}">`)
    .join("");
  const host = $("#artAdminGrid");
  host.innerHTML = list.length
    ? list
        .map(
          (a) => `
      <article class="art-admin-card ${a.active === false ? "is-inactive" : ""}" data-art-id="${escapeHtml(a.id)}">
        <div class="art-admin-thumb"><img src="${escapeHtml(a.url)}" alt="" loading="lazy" /></div>
        <input class="inline-input" data-field="name" value="${escapeHtml(a.name)}" aria-label="Nome da estampa" />
        <input class="inline-input small" data-field="category" value="${escapeHtml(a.category || "")}" list="artCategoryList" placeholder="Categoria" aria-label="Categoria" />
        <div class="art-admin-actions">
          <label class="switch" title="Ativa"><input type="checkbox" data-field="active" ${a.active !== false ? "checked" : ""} /><span class="sr-only">Ativa</span></label>
          <a class="icon-button" href="${escapeHtml(a.url)}" target="_blank" rel="noopener" download aria-label="Baixar">⤓</a>
          <button type="button" class="icon-button danger" data-delete-art aria-label="Excluir estampa">🗑</button>
        </div>
      </article>`
        )
        .join("")
    : `<p class="empty">Nenhuma estampa encontrada.</p>`;
}

async function uploadArts(files) {
  const category = $("#artCategory").value.trim() || "Geral";
  const status = $("#artUploadStatus");
  const btn = $("#artUploadButton");
  btn.disabled = true;
  let ok = 0;
  for (const [i, file] of [...files].entries()) {
    status.textContent = `Enviando ${i + 1} de ${files.length}: ${file.name}…`;
    try {
      const url = await store.uploadFile(file, { folder: "arts", maxSize: 1600 });
      const art = {
        id: uid("art"),
        name: file.name.replace(/\.\w+$/, "").replace(/[-_]+/g, " "),
        category,
        url,
        active: true,
        order: Date.now() + i,
        createdAt: new Date().toISOString(),
      };
      await store.saveArt(art);
      state.arts.push(art);
      ok += 1;
    } catch (err) {
      toast(`${file.name}: ${err.message}`, "error", 6000);
    }
  }
  status.textContent = `${ok} estampa(s) enviada(s).`;
  btn.disabled = false;
  $("#artFiles").value = "";
  renderArts();
}

function bindArts() {
  $("#artUploadForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const files = $("#artFiles").files;
    if (!files.length) return toast("Escolha pelo menos um arquivo.", "warning");
    uploadArts(files);
  });
  const dz = $("#artDropzone");
  $("#artFiles").addEventListener("change", (e) => {
    dz.querySelector("span").innerHTML = e.target.files.length
      ? `<strong>${e.target.files.length} arquivo(s) selecionado(s)</strong>`
      : "<strong>Clique para escolher</strong> ou arraste os arquivos aqui";
  });
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("is-over");
    })
  );
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove("is-over")));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => /image\/(png|svg\+xml|webp)/.test(f.type));
    if (files.length) uploadArts(files);
  });

  $("#artSearch").addEventListener("input", debounce(renderArts, 150));
  $("#artFilter").addEventListener("change", renderArts);

  const host = $("#artAdminGrid");
  host.addEventListener("change", async (e) => {
    const card = e.target.closest("[data-art-id]");
    const field = e.target.dataset.field;
    if (!card || !field) return;
    const art = state.arts.find((a) => a.id === card.dataset.artId);
    const value = field === "active" ? e.target.checked : e.target.value.trim();
    if (field === "name" && !value) return renderArts();
    try {
      await store.saveArt({ ...art, [field]: value });
      art[field] = value;
      if (field === "active") renderArts();
      toast("Estampa atualizada.", "success", 1600);
    } catch (err) {
      toast(err.message, "error");
    }
  });
  host.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-delete-art]")) return;
    const card = e.target.closest("[data-art-id]");
    const art = state.arts.find((a) => a.id === card.dataset.artId);
    if (!window.confirm(`Excluir “${art.name}”? Pedidos antigos continuam com o link do arquivo.`)) return;
    try {
      await store.deleteArt(art.id);
      state.arts = state.arts.filter((a) => a.id !== art.id);
      renderArts();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

/* ====================================================================== */
/* Tipografias                                                            */
/* ====================================================================== */

let fontObserver;

function renderFonts() {
  $("#fontCategorySelect").innerHTML = Object.entries(FONT_CATEGORIES)
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join("");
  if (!$("#fontCatalogSource").options.length) {
    $("#fontCatalogSource").innerHTML =
      `<option value="">Todos os bancos</option>` +
      Object.entries(FONT_SOURCES)
        .filter(([k]) => k !== "custom")
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
        .join("");
  }

  // Fontes próprias
  const custom = $("#customFontList");
  custom.innerHTML = state.customFonts.length
    ? state.customFonts
        .map(
          (f) => `
      <div class="custom-font-row" data-font-id="${escapeHtml(f.id)}">
        <span class="font-preview-sample" style="font-family:'${escapeHtml(f.family)}', sans-serif">${escapeHtml(f.family)}</span>
        <span class="tag">${escapeHtml(FONT_CATEGORIES[f.category] || f.category)}</span>
        <label class="switch"><input type="checkbox" data-custom-toggle ${f.active !== false ? "checked" : ""} /><span class="sr-only">Ativa</span></label>
        <button type="button" class="icon-button danger" data-custom-delete aria-label="Excluir fonte">🗑</button>
      </div>`
        )
        .join("")
    : `<p class="muted small">Nenhuma fonte própria enviada.</p>`;
  state.customFonts.forEach((f) => loadFont(customFontToEntry(f)));

  // Fonte padrão
  const available = getAvailableFonts({ disabledFonts: [...state.disabledFonts] }, state.customFonts);
  $("#defaultFont").innerHTML = available
    .map((f) => `<option value="${escapeHtml(f.id)}" ${f.id === state.settings.defaultFontId ? "selected" : ""}>${escapeHtml(f.family)} · ${escapeHtml(FONT_SOURCES[f.source]?.short || "")}</option>`)
    .join("");

  renderFontCatalog();
}

function visibleCatalogFonts() {
  const q = $("#fontCatalogSearch").value.trim().toLowerCase();
  const source = $("#fontCatalogSource").value;
  return FONT_CATALOG.filter((f) => (!source || f.source === source) && (!q || f.family.toLowerCase().includes(q)));
}

function renderFontCatalog() {
  const list = visibleCatalogFonts();
  const sample = $("#fontPreviewText").value || "Studio Personalizado";
  const enabled = FONT_CATALOG.length - state.disabledFonts.size;
  $("#fontCatalogCount").textContent = `${enabled} de ${FONT_CATALOG.length} ativas · ${Object.keys(FONT_SOURCES).length - 1} bancos + fontes da loja`;
  fontObserver?.disconnect();
  fontObserver = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const f = FONT_CATALOG.find((x) => x.id === en.target.dataset.fontId);
        loadFont(f).then(() => en.target.classList.add("is-loaded"));
        fontObserver.unobserve(en.target);
      }),
    { root: $("#fontCatalogList"), rootMargin: "150px" }
  );
  $("#fontCatalogList").innerHTML = list
    .map(
      (f) => `
    <label class="font-catalog-row" data-font-id="${escapeHtml(f.id)}">
      <input type="checkbox" data-font-toggle="${escapeHtml(f.id)}" ${state.disabledFonts.has(f.id) ? "" : "checked"} />
      <span class="font-preview-sample" style="font-family:${escapeHtml(fontStack(f))}">${escapeHtml(sample)}</span>
      <span class="font-catalog-meta"><strong>${escapeHtml(f.family)}</strong><span class="tag">${escapeHtml(FONT_SOURCES[f.source].short)}</span><span class="muted">${escapeHtml(FONT_CATEGORIES[f.category])}</span></span>
    </label>`
    )
    .join("");
  $$("#fontCatalogList .font-catalog-row").forEach((r) => fontObserver.observe(r));
}

function bindFonts() {
  $("#fontCatalogSearch").addEventListener("input", debounce(renderFontCatalog, 150));
  $("#fontCatalogSource").addEventListener("change", renderFontCatalog);
  $("#fontPreviewText").addEventListener(
    "input",
    debounce(() => {
      const t = $("#fontPreviewText").value || "Studio Personalizado";
      $$("#fontCatalogList .font-preview-sample").forEach((s) => (s.textContent = t));
    }, 100)
  );
  $("#fontCatalogList").addEventListener("change", (e) => {
    const id = e.target.dataset.fontToggle;
    if (!id) return;
    if (e.target.checked) state.disabledFonts.delete(id);
    else state.disabledFonts.add(id);
    $("#fontCatalogCount").textContent = `${FONT_CATALOG.length - state.disabledFonts.size} de ${FONT_CATALOG.length} ativas (não salvo)`;
  });
  $("#fontsEnableAll").addEventListener("click", () => {
    visibleCatalogFonts().forEach((f) => state.disabledFonts.delete(f.id));
    renderFontCatalog();
  });
  $("#fontsDisableAll").addEventListener("click", () => {
    visibleCatalogFonts().forEach((f) => state.disabledFonts.add(f.id));
    renderFontCatalog();
  });
  $("#saveFontSettings").addEventListener("click", async () => {
    let defaultFontId = $("#defaultFont").value;
    if (state.disabledFonts.has(defaultFontId)) {
      const firstEnabled = getAvailableFonts({ disabledFonts: [...state.disabledFonts] }, state.customFonts)[0];
      defaultFontId = firstEnabled?.id || "g-montserrat";
    }
    try {
      state.settings = await store.saveSettings({ disabledFonts: [...state.disabledFonts], defaultFontId });
      renderFonts();
      toast("Tipografias salvas.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  $("#fontUploadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("#fontFile").files[0];
    const family = $("#fontFamily").value.trim();
    if (!file || !family) return toast("Escolha o arquivo e informe o nome.", "warning");
    if (!/\.(woff2?|ttf|otf)$/i.test(file.name)) return toast("Formato não suportado.", "error");
    const btn = $("#fontUploadButton");
    btn.disabled = true;
    try {
      const url = await store.uploadFile(file, { folder: "fonts" });
      const font = {
        id: `custom-${slugify(family)}-${Date.now().toString(36)}`,
        family,
        url,
        category: $("#fontCategorySelect").value,
        source: "custom",
        active: true,
        createdAt: new Date().toISOString(),
      };
      // valida que o navegador consegue ler o arquivo
      const ok = await loadFont(customFontToEntry(font));
      if (!ok) throw new Error("O arquivo não parece ser uma fonte válida.");
      await store.saveFont(font);
      state.customFonts.push(font);
      e.target.reset();
      renderFonts();
      toast("Fonte adicionada.", "success");
    } catch (err) {
      toast(err.message, "error", 6000);
    } finally {
      btn.disabled = false;
    }
  });

  $("#customFontList").addEventListener("change", async (e) => {
    if (!e.target.matches("[data-custom-toggle]")) return;
    const id = e.target.closest("[data-font-id]").dataset.fontId;
    const font = state.customFonts.find((f) => f.id === id);
    font.active = e.target.checked;
    await store.saveFont(font);
    renderFonts();
  });
  $("#customFontList").addEventListener("click", async (e) => {
    if (!e.target.closest("[data-custom-delete]")) return;
    const id = e.target.closest("[data-font-id]").dataset.fontId;
    const font = state.customFonts.find((f) => f.id === id);
    if (!window.confirm(`Excluir a fonte “${font.family}”?`)) return;
    await store.deleteFont(id);
    await store.deleteFile(font.url);
    state.customFonts = state.customFonts.filter((f) => f.id !== id);
    renderFonts();
  });
}

/* ====================================================================== */
/* Marca & configurações                                                  */
/* ====================================================================== */

const getPath = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  keys.slice(0, -1).forEach((k) => (o = o[k] ||= {}));
  o[keys.at(-1)] = value;
}

function renderSettings() {
  const form = $("#settingsForm");
  for (const input of form.querySelectorAll("[name]")) {
    const value = getPath(state.settings, input.name);
    if (input.type === "checkbox") input.checked = !!value;
    else input.value = value ?? "";
  }
  renderLogoPreview();
  $("#credentialsForm").hidden = store.mode !== "local";
  $("#credEmail").value = state.user?.email || "";
  $("#backendInfo").innerHTML =
    store.mode === "firebase"
      ? `<h2>Conexão</h2><p><span class="badge badge-success">Firebase conectado</span> Pedidos, catálogo, estampas e arquivos ficam na nuvem e sincronizam em tempo real entre todos os dispositivos. As notificações por WhatsApp/SMS e e-mail são enviadas pelas Cloud Functions (veja o README).</p>`
      : `<h2>Conexão</h2><p><span class="badge badge-warning">Modo local</span> Os dados ficam somente neste navegador. Para usar loja e painel em dispositivos diferentes, com login seguro e notificações automáticas, copie <code>firebase-config.example.js</code> para <code>firebase-config.js</code> com as credenciais do seu projeto Firebase (passo a passo no README).</p>`;
}

function renderLogoPreview() {
  const s = state.settings;
  $("#logoPreview").innerHTML = s.logoUrl
    ? `<img src="${escapeHtml(s.logoUrl)}" alt="Logo atual" />`
    : `<span class="brand-mark">${escapeHtml(((s.brandName || "S")[0] + (s.brandSubtitle || "P")[0]).toUpperCase())}</span>`;
  $("#removeLogo").disabled = !s.logoUrl;
}

function bindSettings() {
  $("#settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const patch = {};
    for (const input of e.target.querySelectorAll("[name]")) {
      let value = input.type === "checkbox" ? input.checked : input.value;
      if (input.type === "number") value = Number(value) || 0;
      if (input.name === "orderPrefix") value = String(value).toUpperCase().replace(/[^A-Z0-9]/g, "") || "PED";
      setPath(patch, input.name, value);
    }
    if (!patch.modes.EVENTO && !patch.modes.ENCOMENDA) return toast("Ative pelo menos uma modalidade.", "error");
    if (!Object.values(patch.payments).some(Boolean)) return toast("Ative pelo menos um método de pagamento.", "error");
    if (patch.payments.PIX && !patch.pix.key) toast("Pix ativo sem chave: o cliente verá apenas a instrução de pagamento.", "warning", 5000);
    const btn = $("#saveSettings");
    btn.disabled = true;
    try {
      state.settings = await store.saveSettings(patch);
      applyAdminBranding();
      renderSettings();
      toast("Configurações salvas. A loja usa os novos dados ao recarregar.", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  $("#logoFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      toast("Enviando logo…");
      const url = await store.uploadFile(file, { folder: "brand", maxSize: 800 });
      const old = state.settings.logoUrl;
      state.settings = await store.saveSettings({ logoUrl: url });
      if (old && old !== url) store.deleteFile(old);
      applyAdminBranding();
      renderLogoPreview();
      toast("Logo atualizada.", "success");
    } catch (err) {
      toast(err.message, "error", 6000);
    } finally {
      e.target.value = "";
    }
  });
  $("#removeLogo").addEventListener("click", async () => {
    if (!window.confirm("Remover a logo? O site volta a exibir as iniciais da marca.")) return;
    const old = state.settings.logoUrl;
    state.settings = await store.saveSettings({ logoUrl: "" });
    store.deleteFile(old);
    applyAdminBranding();
    renderLogoPreview();
  });

  $("#credentialsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#credEmail").value.trim();
    const pw = $("#credPassword").value;
    if (!email.includes("@") || pw.length < 6) return toast("Informe um e-mail válido e senha com 6+ caracteres.", "error");
    await store.changeCredentials(email, pw);
    $("#credPassword").value = "";
    toast("Acesso alterado.", "success");
  });
}

boot();

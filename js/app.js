// Área do cliente — Studio Personalizado.

import {
  $, $$, clamp, round, formatBRL, formatCm, formatNumber, uid, escapeHtml, onlyDigits, formatPhone,
  formatCep, deepClone, toast, isValidEmail, statusLabel, PAYMENT_LABELS, MODE_LABELS, UFS,
  applyBrandColor, registerServiceWorker, debounce,
} from "./utils.js";
import { createStore } from "./store.js";
import { DEFAULT_PRODUCTS, DEFAULT_ARTS, DEFAULT_SETTINGS } from "./defaults.js";
import {
  getAvailableFonts, findFont, loadFont, loadFontForText, fontStack, FONT_CATEGORIES, FONT_SOURCES,
} from "./fonts.js";
import {
  buildStage, applyArtStyle, applyTextStyle, getPrintCm, constrainDesign, designSizeCm, fitScale,
  clampPosition, sideHasContent, toOrderSide, getArtVisibleBounds, productRenderSnapshot, SIDE_LABELS,
} from "./render.js";
import { buildPixPayload, renderQrSvg } from "./pix.js";
import { setupVirtualKeyboard } from "./keyboard.js";

const STEPS = ["catalog", "editor", "cart", "customer", "checkout", "success"];
const TEXT_COLORS = ["#171a25", "#ffffff", "#ff5a67", "#f4b400", "#2e9e5b", "#1f6feb", "#7b3fe4", "#c0c4cc", "#d4af37", "#8b5a2b"];
const MAX_QTY = 50;
const SS = { cart: "studioCart", customer: "customerDraft" };
const CATALOG_CACHE = "studioCatalogCache";

let store;
let stage = null; // { root, area, art, text } do editor
let vk;

const state = {
  settings: deepClone(DEFAULT_SETTINGS),
  products: [],
  arts: [],
  customFonts: [],
  fonts: [],

  step: "catalog",

  // Editor — estado unificado por lado (corrige a dessincronização do código antigo)
  product: null,
  color: null,
  size: null,
  finishId: null,
  quantity: 1,
  activeSide: "front",
  selected: null, // "art" | "text" | null
  sides: null, // { front: Side, back: Side }
  editingItemId: null,
  artCategory: "Todas",

  cart: readSession(SS.cart, []),
  customer: readSession(SS.customer, null) || emptyCustomer(),
  payment: null,
  lastOrder: null,
};

/* ====================================================================== */
/* Utilidades de estado                                                   */
/* ====================================================================== */

function readSession(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível: segue só em memória */
  }
}

function emptyCustomer() {
  return {
    modalidade: null,
    nome: "",
    telefone: "",
    email: "",
    endereco: { cep: "", rua: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "" },
  };
}

const getActiveSideState = () => state.sides?.[state.activeSide];
const getFinishes = (p = state.product) => p?.customizationOptions?.finishTypes || [];
const getFinish = () => getFinishes().find((f) => f.id === state.finishId) || null;
const unitPrice = () => (Number(state.product?.price) || 0) + (Number(getFinish()?.extraPrice) || 0);
const cartSubtotal = () => state.cart.reduce((sum, i) => sum + i.valor_unitario * (i.quantidade || 1), 0);
const deliveryFee = () => (state.customer.modalidade === "ENCOMENDA" ? Number(state.settings.deliveryFee) || 0 : 0);
const cartTotal = () => cartSubtotal() + deliveryFee();

function saveCart() {
  writeSession(SS.cart, state.cart);
  updateCartBadge();
}
const saveCustomerDraft = debounce(() => writeSession(SS.customer, state.customer), 200);

function makeSide(product) {
  const pc = getPrintCm(product);
  const font = findFont(state.settings.defaultFontId, state.fonts);
  return {
    art: null,
    text: {
      value: "",
      fontId: font.id,
      family: font.family,
      stack: fontStack(font),
      source: font.source,
      fontUrl: font.url || null,
      color: TEXT_COLORS[0],
      sizeCm: round(Math.min(pc.height * 0.14, pc.width * 0.16), 2),
      x: 0,
      y: round(pc.height * 0.3, 2),
      rotation: 0,
      bold: false,
      italic: false,
    },
  };
}

/* ====================================================================== */
/* Inicialização                                                          */
/* ====================================================================== */

async function boot() {
  try {
    store = await createStore();
  } catch (err) {
    console.error(err);
  }
  await loadStoreData();
  applyBranding();
  bindGlobalEvents();
  bindEditorEvents();
  bindCustomerEvents();
  bindCheckoutEvents();
  renderCatalog();
  updateCartBadge();
  goTo("catalog", { force: true, focus: false });
  setupInactivityTimeout();
  vk = setupVirtualKeyboard(() => state.settings.kioskMode && state.settings.virtualKeyboard);
  $("#loadingOverlay").classList.add("is-hidden");
  registerServiceWorker();
}

async function loadStoreData() {
  try {
    const [settings, products, arts, customFonts] = await Promise.all([
      store.getSettings(),
      store.listProducts(),
      store.listArts(),
      store.listCustomFonts(),
    ]);
    state.settings = settings;
    const notConfigured = store.mode === "firebase" && !settings.catalogInitialized && !products.length;
    state.products = (notConfigured ? DEFAULT_PRODUCTS : products).filter((p) => p.active !== false);
    state.arts = (notConfigured ? DEFAULT_ARTS : arts).filter((a) => a.active !== false);
    state.customFonts = customFonts;
    try {
      localStorage.setItem(
        CATALOG_CACHE,
        JSON.stringify({ settings, products: state.products, arts: state.arts, customFonts, at: Date.now() })
      );
    } catch {
      /* cache opcional */
    }
  } catch (err) {
    console.warn("Falha ao carregar a loja; usando cache local.", err);
    let cache = null;
    try {
      cache = JSON.parse(localStorage.getItem(CATALOG_CACHE) || "null");
    } catch {
      cache = null;
    }
    state.settings = { ...deepClone(DEFAULT_SETTINGS), ...(cache?.settings || {}) };
    state.products = cache?.products || DEFAULT_PRODUCTS;
    state.arts = cache?.arts || DEFAULT_ARTS;
    state.customFonts = cache?.customFonts || [];
    toast("Sem conexão com o servidor: exibindo o catálogo salvo neste dispositivo.", "warning", 5000);
  }
  state.fonts = getAvailableFonts(state.settings, state.customFonts);
}

function applyBranding() {
  const s = state.settings;
  $("#brandName").textContent = s.brandName || "Studio";
  $("#brandSubtitle").textContent = s.brandSubtitle || "";
  const initials = (s.brandName || "S").slice(0, 1) + (s.brandSubtitle || "P").slice(0, 1);
  $("#brandMark").textContent = initials.toUpperCase();
  const logo = $("#brandLogo");
  if (s.logoUrl) {
    logo.src = s.logoUrl;
    logo.alt = s.brandName || "Logo";
    logo.hidden = false;
    $("#brandMark").hidden = true;
  } else {
    logo.hidden = true;
    $("#brandMark").hidden = false;
  }
  document.title = [s.brandName, s.brandSubtitle].filter(Boolean).join(" ") || "Studio Personalizado";
  applyBrandColor(s.primaryColor);
}

/* ====================================================================== */
/* Navegação                                                              */
/* ====================================================================== */

function goTo(step, { force = false, focus = true } = {}) {
  if (!force) {
    if (["cart", "customer", "checkout"].includes(step) && !state.cart.length) {
      toast("Seu carrinho está vazio. Escolha um produto.", "warning");
      step = "catalog";
    }
    if (step === "editor" && !state.product) step = "catalog";
    if (step === "checkout" && !validateCustomer(false)) {
      step = "customer";
    }
    if (step === "success" && !state.lastOrder) step = "catalog";
  }
  if (state.step === "success" && step !== "success") stopAutoReset();
  state.step = step;

  $$(".step-view").forEach((s) => (s.hidden = s.id !== step));
  const index = STEPS.indexOf(step);
  $$("#stepper li").forEach((li, i) => {
    li.classList.toggle("active", i === index);
    li.classList.toggle("done", i < index);
    const btn = li.querySelector("button");
    btn.disabled = i > index || step === "success";
    if (i === index) btn.setAttribute("aria-current", "step");
    else btn.removeAttribute("aria-current");
  });
  $("#progressBar").style.width = `${(Math.min(index, 4) / 4) * 100}%`;
  document.body.dataset.step = step;

  if (step === "editor") renderEditor();
  if (step === "cart") renderCartView();
  if (step === "customer") renderCustomer();
  if (step === "checkout") renderCheckout();
  if (step === "success") renderSuccess();

  closeCartPanel();
  window.scrollTo(0, 0);
  if (focus) $(`#${step} h1`)?.focus({ preventScroll: true });
  resetInactivity();
}

function bindGlobalEvents() {
  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) goTo(go.dataset.go);
  });
  $("#brandHome").addEventListener("click", () => {
    if (state.step === "success") return restartSession();
    goTo("catalog");
  });
  $$("#stepper li").forEach((li) =>
    li.querySelector("button").addEventListener("click", () => goTo(li.dataset.step))
  );

  $("#cartButton").addEventListener("click", openCartPanel);
  $("#closeCart").addEventListener("click", closeCartPanel);
  $("#cartBackdrop").addEventListener("click", closeCartPanel);
  $("#cartPanelReview").addEventListener("click", () => goTo("cart"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCartPanel();
  });

  window.addEventListener("online", updateOnlineState);
  window.addEventListener("offline", updateOnlineState);

  $("#newOrder").addEventListener("click", restartSession);
  $("#copyOrderNumber").addEventListener("click", () => copyText(state.lastOrder?.numero_pedido, "Número copiado!"));
  $("#copyPix").addEventListener("click", () => copyText($("#pixCode").value, "Código Pix copiado!"));
  $("#pauseReset").addEventListener("click", () => {
    stopAutoReset();
    $("#autoReset").hidden = true;
  });
}

async function copyText(text, message) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(message, "success");
}

/* ====================================================================== */
/* 1. Catálogo                                                            */
/* ====================================================================== */

function renderCatalog() {
  const grid = $("#productGrid");
  grid.removeAttribute("aria-busy");
  grid.innerHTML = "";
  if (!state.products.length) {
    grid.innerHTML = `<p class="empty">Nenhum produto disponível no momento.</p>`;
    return;
  }
  for (const p of state.products) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "product-card";
    const preview = document.createElement("div");
    preview.className = "product-preview";
    preview.append(buildStage({ product: p, color: p.colors?.[0] }).root);
    const finishes = getFinishes(p);
    const minExtra = finishes.length ? Math.min(...finishes.map((f) => Number(f.extraPrice) || 0)) : 0;
    const tags = [
      p.allowsBack ? "Frente e costas" : null,
      finishes.length ? finishes.map((f) => f.label).join(" ou ") : null,
      p.sizes?.length > 1 ? p.sizes.join(" · ") : null,
    ].filter(Boolean);
    const info = document.createElement("div");
    info.className = "product-info";
    info.innerHTML = `
      <h2>${escapeHtml(p.name)}</h2>
      <p class="muted">${escapeHtml(p.description || "")}</p>
      <div class="tags">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
      <div class="product-foot">
        <strong class="price">${finishes.length > 1 ? "a partir de " : ""}${formatBRL(Number(p.price) + minExtra)}</strong>
        <span class="btn btn-primary btn-sm" aria-hidden="true">Personalizar</span>
      </div>`;
    card.append(preview, info);
    card.setAttribute("aria-label", `Personalizar ${p.name}, ${formatBRL(p.price)}`);
    card.addEventListener("click", () => openEditor(p));
    grid.append(card);
  }
}

/* ====================================================================== */
/* 2. Editor                                                              */
/* ====================================================================== */

function openEditor(product, item = null) {
  state.product = product;
  state.editingItemId = item?.item_id || null;
  state.color = item?.cor || product.colors?.[0] || "#ffffff";
  state.size = item?.tamanho || (product.sizes?.length === 1 ? product.sizes[0] : null);
  const finishes = getFinishes(product);
  state.finishId = item?.acabamento || (finishes.length === 1 ? finishes[0].id : null);
  state.quantity = item?.quantidade || 1;
  state.sides = item?.sides ? deepClone(item.sides) : { front: makeSide(product), back: makeSide(product) };
  state.activeSide = "front";
  state.selected = null;
  state.artCategory = "Todas";
  goTo("editor");
}

function renderEditor() {
  const p = state.product;
  $("#editorProductName").textContent = p.name;
  $("#editorProductDesc").textContent = p.description || "";
  $("#addToCart").textContent = state.editingItemId ? "Salvar alterações" : "Adicionar ao carrinho";
  $("#sideToggle").hidden = !p.allowsBack;
  renderSideToggle();
  renderColorOptions();
  renderSizeOptions();
  renderFinishOptions();
  renderArtCategories();
  renderArtList();
  syncTextControls();
  updateQuantity();
  updateEditorPrice();
  renderStage();
  ensureTextFont();
}

function updateEditorPrice() {
  $("#editorPrice").textContent = formatBRL(unitPrice() * state.quantity);
}

function renderSideToggle() {
  $$("#sideToggle button").forEach((b) => {
    const active = b.dataset.side === state.activeSide;
    b.setAttribute("aria-pressed", String(active));
    const hasContent = sideHasContent(state.sides[b.dataset.side]);
    b.classList.toggle("has-content", hasContent);
  });
}

function renderColorOptions() {
  const host = $("#colorOptions");
  const colors = state.product.colors || [];
  $("#colorGroup").hidden = colors.length <= 1;
  host.innerHTML = colors
    .map(
      (c, i) =>
        `<button type="button" class="swatch" style="--swatch:${escapeHtml(c)}" data-color="${escapeHtml(c)}" aria-pressed="${c === state.color}" aria-label="Cor ${i + 1} (${escapeHtml(c)})"></button>`
    )
    .join("");
}

function renderSizeOptions() {
  const sizes = state.product.sizes || [];
  $("#sizeGroup").hidden = sizes.length <= 1;
  $("#sizeGroup").classList.remove("is-invalid");
  $("#sizeOptions").innerHTML = sizes
    .map((s) => `<button type="button" class="chip" data-size="${escapeHtml(s)}" aria-pressed="${s === state.size}">${escapeHtml(s)}</button>`)
    .join("");
}

function renderFinishOptions() {
  const finishes = getFinishes();
  $("#finishGroup").hidden = !finishes.length;
  $("#finishGroup").classList.remove("is-invalid");
  $("#finishOptions").innerHTML = finishes
    .map(
      (f) => `
      <label class="option-card">
        <input type="radio" name="finish" value="${escapeHtml(f.id)}" ${f.id === state.finishId ? "checked" : ""} />
        <span class="option-title">${escapeHtml(f.label)}</span>
        <span class="option-desc">${escapeHtml(f.description || "")}</span>
        <span class="option-price">${Number(f.extraPrice) > 0 ? `+ ${formatBRL(f.extraPrice)}` : "Sem acréscimo"}</span>
      </label>`
    )
    .join("");
  const finish = getFinish();
  const badge = $("#finishBadge");
  badge.hidden = !finish;
  badge.textContent = finish ? `Prévia: ${finish.label}` : "";
  $("#engraveHint").hidden = state.finishId !== "gravacao";
}

function renderArtCategories() {
  const cats = ["Todas", ...new Set(state.arts.map((a) => a.category || "Geral"))];
  $("#artCategories").innerHTML = cats
    .map((c) => `<button type="button" class="chip" data-category="${escapeHtml(c)}" aria-pressed="${c === state.artCategory}">${escapeHtml(c)}</button>`)
    .join("");
}

function renderArtList() {
  const side = getActiveSideState();
  const current = side.art?.id || null;
  const arts = state.arts.filter((a) => state.artCategory === "Todas" || (a.category || "Geral") === state.artCategory);
  $("#artList").innerHTML =
    `<button type="button" class="art-item art-none" data-art="" aria-pressed="${!current}"><span>Sem estampa</span></button>` +
    arts
      .map(
        (a) => `
      <button type="button" class="art-item" data-art="${escapeHtml(a.id)}" aria-pressed="${a.id === current}" title="${escapeHtml(a.name)}">
        <img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name)}" loading="lazy" decoding="async" />
      </button>`
      )
      .join("");
}

function syncTextControls() {
  const t = getActiveSideState().text;
  const pc = getPrintCm(state.product);
  $("#customProductName").value = t.value;
  $("#customNameCounter").textContent = `${t.value.length}/24`;
  const font = state.fonts.find((f) => f.id === t.fontId);
  $("#fontPickerName").textContent = t.family;
  $("#fontPickerName").style.fontFamily = t.stack;
  $("#fontPickerSource").textContent = FONT_SOURCES[t.source]?.short || "";
  if (font) loadFont(font);
  $("#textBold").setAttribute("aria-pressed", String(!!t.bold));
  $("#textItalic").setAttribute("aria-pressed", String(!!t.italic));
  $("#textColorOptions").innerHTML = TEXT_COLORS.map(
    (c) =>
      `<button type="button" class="swatch" style="--swatch:${c}" data-text-color="${c}" aria-pressed="${c.toLowerCase() === String(t.color).toLowerCase()}" aria-label="Cor da letra ${c}"></button>`
  ).join("");
  $("#textColorPicker").value = /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#171a25";
  const range = $("#textSizeRange");
  range.min = "0.3";
  range.max = String(round(pc.height / 1.15, 1));
  range.step = pc.height > 20 ? "0.5" : "0.1";
  range.value = String(t.sizeCm);
  $("#textSizeOutput").textContent = formatCm(t.sizeCm);
}

function updateQuantity() {
  $("#qtyValue").textContent = String(state.quantity);
  $("#qtyMinus").disabled = state.quantity <= 1;
  $("#qtyPlus").disabled = state.quantity >= MAX_QTY;
}

/* ---------- Palco interativo ---------- */

function renderStage() {
  const side = getActiveSideState();
  if (state.selected === "art" && !side.art) state.selected = null;
  if (state.selected === "text" && !side.text.value.trim()) state.selected = null;
  stage = buildStage({
    product: state.product,
    sideKey: state.activeSide,
    side,
    color: state.color,
    finish: state.finishId,
    interactive: true,
    selected: state.selected,
  });
  $("#stageWrap").replaceChildren(stage.root);
  attachStageInteractions();
  updateReadout();
  updateStageTools();
}

function refreshDesign(kind) {
  const side = getActiveSideState();
  const pc = getPrintCm(state.product);
  if (kind === "art" && stage.art && side.art) applyArtStyle(stage.art, side.art, pc);
  if (kind === "text" && stage.text && side.text) applyTextStyle(stage.text, side.text, pc);
  updateReadout();
}

function setSelected(kind) {
  state.selected = kind;
  stage.art?.classList.toggle("is-selected", kind === "art");
  stage.text?.classList.toggle("is-selected", kind === "text");
  updateReadout();
  updateStageTools();
}

function updateStageTools() {
  const side = getActiveSideState();
  $("#resetArtPosition").disabled = !side.art;
  $("#resetCustomNamePosition").disabled = !side.text.value.trim();
  $("#removeSelected").disabled = !state.selected;
  const obj = state.selected === "art" ? side.art : state.selected === "text" ? side.text : null;
  $("#rotateReset").disabled = !obj || !obj.rotation;
}

function updateReadout() {
  const side = getActiveSideState();
  const pc = getPrintCm(state.product);
  const parts = [`Área útil ${formatNumber(pc.width)} × ${formatNumber(pc.height)} cm`];
  const describe = (label, kind, obj) => {
    const s = designSizeCm(kind, obj);
    return `${label}: ${formatNumber(s.width)} × ${formatNumber(s.height)} cm · X ${formatNumber(obj.x)} / Y ${formatNumber(obj.y)} cm · ${Math.round(obj.rotation || 0)}°`;
  };
  if (state.selected === "art" && side.art) parts.push(describe("Estampa", "art", side.art));
  else if (state.selected === "text" && side.text.value.trim()) parts.push(describe("Texto", "text", side.text));
  else parts.push("Toque na estampa ou no texto para ajustar");
  $("#dimensionReadout").textContent = parts.join(" — ");
}

function attachStageInteractions() {
  const area = stage.area;
  const root = stage.root;
  const pc = getPrintCm(state.product);

  root.addEventListener("pointerdown", (e) => {
    const design = e.target.closest(".design");
    if (!design) {
      if (state.selected) setSelected(null);
      return;
    }
    e.preventDefault();
    const kind = design.dataset.kind;
    if (state.selected !== kind) setSelected(kind);
    design.focus({ preventScroll: true });

    const side = getActiveSideState();
    const obj = kind === "art" ? side.art : side.text;
    const handle = e.target.closest("[data-handle]")?.dataset.handle;
    const mode = !handle ? "move" : handle === "rotate" ? "rotate" : "resize";
    const rect = area.getBoundingClientRect();
    const pxPerCm = rect.width / pc.width;
    const cx = rect.left + rect.width / 2 + obj.x * pxPerCm;
    const cy = rect.top + rect.height / 2 + obj.y * pxPerCm;
    const start = {
      px: e.clientX,
      py: e.clientY,
      x: obj.x,
      y: obj.y,
      size: kind === "art" ? obj.widthCm : obj.sizeCm,
      dist: Math.max(4, Math.hypot(e.clientX - cx, e.clientY - cy)),
    };
    root.setPointerCapture(e.pointerId);
    root.classList.add("is-dragging");

    const onMove = (ev) => {
      if (mode === "move") {
        obj.x = start.x + (ev.clientX - start.px) / pxPerCm;
        obj.y = start.y + (ev.clientY - start.py) / pxPerCm;
      } else if (mode === "resize") {
        const scale = Math.hypot(ev.clientX - cx, ev.clientY - cy) / start.dist;
        const min = kind === "art" ? 0.5 : 0.3;
        const next = Math.max(min, start.size * scale);
        if (kind === "art") obj.widthCm = next;
        else obj.sizeCm = next;
        const s = designSizeCm(kind, obj);
        const fit = fitScale(s.width, s.height, obj.rotation, pc);
        if (fit < 1) {
          if (kind === "art") obj.widthCm *= fit;
          else obj.sizeCm *= fit;
        }
      } else {
        let angle = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
        angle = ((angle % 360) + 360) % 360;
        if (ev.shiftKey) angle = Math.round(angle / 15) * 15;
        else {
          for (const snap of [0, 90, 180, 270, 360]) if (Math.abs(angle - snap) < 4) angle = snap % 360;
        }
        obj.rotation = round(angle, 1);
      }
      constrainDesign(kind, obj, pc);
      refreshDesign(kind);
      if (kind === "text") syncTextSizeControl();
    };
    const onUp = () => {
      root.releasePointerCapture?.(e.pointerId);
      root.classList.remove("is-dragging");
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      updateStageTools();
    };
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
  });

  // Teclado: setas movem (Shift = 1 cm), +/- redimensiona, Delete remove
  root.addEventListener("keydown", (e) => {
    const design = e.target.closest?.(".design");
    if (!design) return;
    const kind = design.dataset.kind;
    const side = getActiveSideState();
    const obj = kind === "art" ? side.art : side.text;
    const step = e.shiftKey ? 1 : 0.1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      obj.x += moves[e.key][0];
      obj.y += moves[e.key][1];
    } else if (e.key === "+" || e.key === "=") {
      if (kind === "art") obj.widthCm *= 1.05;
      else obj.sizeCm *= 1.05;
    } else if (e.key === "-") {
      if (kind === "art") obj.widthCm = Math.max(0.5, obj.widthCm / 1.05);
      else obj.sizeCm = Math.max(0.3, obj.sizeCm / 1.05);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
      return;
    } else return;
    e.preventDefault();
    if (state.selected !== kind) setSelected(kind);
    constrainDesign(kind, obj, pc);
    refreshDesign(kind);
    if (kind === "text") syncTextSizeControl();
    updateStageTools();
  });
  root.addEventListener("focusin", (e) => {
    const design = e.target.closest?.(".design");
    if (design && state.selected !== design.dataset.kind) setSelected(design.dataset.kind);
  });
}

function syncTextSizeControl() {
  const t = getActiveSideState().text;
  $("#textSizeRange").value = String(t.sizeCm);
  $("#textSizeOutput").textContent = formatCm(t.sizeCm);
}

/* ---------- Ações do editor ---------- */

async function setArt(artId) {
  const side = getActiveSideState();
  const pc = getPrintCm(state.product);
  if (!artId) {
    side.art = null;
    state.selected = side.text.value.trim() ? "text" : null;
    renderArtList();
    renderStage();
    renderSideToggle();
    return;
  }
  const art = state.arts.find((a) => a.id === artId);
  if (!art) return;
  const info = await getArtVisibleBounds(art.url);
  const prev = side.art;
  const widthCm = prev ? prev.widthCm : Math.min(pc.width * 0.6, pc.height * 0.6 * info.aspect);
  side.art = {
    id: art.id,
    name: art.name,
    url: art.url,
    aspect: info.aspect,
    bounds: info.bounds,
    widthCm,
    x: prev?.x || 0,
    y: prev?.y || (side.text.value.trim() ? -pc.height * 0.1 : 0),
    rotation: prev?.rotation || 0,
  };
  constrainDesign("art", side.art, pc);
  state.selected = "art";
  renderArtList();
  renderStage();
  renderSideToggle();
}

function removeSelected() {
  const side = getActiveSideState();
  if (state.selected === "art") {
    side.art = null;
    renderArtList();
  } else if (state.selected === "text") {
    side.text.value = "";
    syncTextControls();
  } else return;
  state.selected = null;
  renderStage();
  renderSideToggle();
}

async function ensureTextFont() {
  const text = getActiveSideState().text;
  await loadFontForText(text, state.fonts);
  if (state.step !== "editor") return;
  const pc = getPrintCm(state.product);
  constrainDesign("text", text, pc);
  refreshDesign("text");
  syncTextSizeControl();
}

async function setFont(font) {
  const text = getActiveSideState().text;
  Object.assign(text, {
    fontId: font.id,
    family: font.family,
    stack: fontStack(font),
    source: font.source,
    fontUrl: font.url || null,
  });
  syncTextControls();
  renderStage();
  await ensureTextFont();
  try {
    localStorage.setItem("studioLastFont", font.id);
  } catch {
    /* opcional */
  }
}

function bindEditorEvents() {
  $("#sideToggle").addEventListener("click", (e) => {
    const side = e.target.closest("[data-side]")?.dataset.side;
    if (!side || side === state.activeSide) return;
    state.activeSide = side;
    state.selected = null;
    renderSideToggle();
    renderArtList();
    syncTextControls();
    renderStage();
    ensureTextFont();
  });

  $("#colorOptions").addEventListener("click", (e) => {
    const color = e.target.closest("[data-color]")?.dataset.color;
    if (!color) return;
    state.color = color;
    renderColorOptions();
    stage.root.style.setProperty("--product-color", color);
  });

  $("#sizeOptions").addEventListener("click", (e) => {
    const size = e.target.closest("[data-size]")?.dataset.size;
    if (!size) return;
    state.size = size;
    renderSizeOptions();
  });

  $("#finishOptions").addEventListener("change", (e) => {
    state.finishId = e.target.value;
    renderFinishOptions();
    updateEditorPrice();
    renderStage();
  });

  $("#artToggle").addEventListener("click", () => {
    const panel = $("#artListPanel");
    const open = panel.hidden;
    panel.hidden = !open;
    $("#artToggle").setAttribute("aria-expanded", String(open));
    $("#artToggle").textContent = open ? "Ocultar" : "Mostrar";
  });
  $("#artCategories").addEventListener("click", (e) => {
    const cat = e.target.closest("[data-category]")?.dataset.category;
    if (!cat) return;
    state.artCategory = cat;
    renderArtCategories();
    renderArtList();
  });
  $("#artList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-art]");
    if (btn) setArt(btn.dataset.art);
  });

  $("#customProductName").addEventListener("input", (e) => {
    const side = getActiveSideState();
    const value = e.target.value.slice(0, 24);
    const hadText = !!side.text.value.trim();
    side.text.value = value;
    $("#customNameCounter").textContent = `${value.length}/24`;
    constrainDesign("text", side.text, getPrintCm(state.product));
    if (value.trim()) state.selected = "text";
    if (!!value.trim() !== hadText || !stage.text) renderStage();
    else {
      refreshDesign("text");
      updateStageTools();
    }
    syncTextSizeControl();
    renderSideToggle();
  });

  $("#fontPickerButton").addEventListener("click", openFontPicker);

  $("#textBold").addEventListener("click", () => toggleTextStyle("bold"));
  $("#textItalic").addEventListener("click", () => toggleTextStyle("italic"));

  $("#textColorOptions").addEventListener("click", (e) => {
    const color = e.target.closest("[data-text-color]")?.dataset.textColor;
    if (color) setTextColor(color);
  });
  $("#textColorPicker").addEventListener("input", (e) => setTextColor(e.target.value, false));

  $("#textSizeRange").addEventListener("input", (e) => {
    const t = getActiveSideState().text;
    t.sizeCm = Number(e.target.value);
    constrainDesign("text", t, getPrintCm(state.product));
    if (t.value.trim()) {
      if (state.selected !== "text") setSelected("text");
      refreshDesign("text");
    }
    syncTextSizeControl();
  });

  $("#resetArtPosition").addEventListener("click", () => {
    const side = getActiveSideState();
    if (!side.art) return;
    side.art.x = 0;
    side.art.y = 0;
    constrainDesign("art", side.art, getPrintCm(state.product));
    setSelected("art");
    refreshDesign("art");
  });
  $("#resetCustomNamePosition").addEventListener("click", () => {
    const side = getActiveSideState();
    if (!side.text.value.trim()) return;
    side.text.x = 0;
    side.text.y = 0;
    constrainDesign("text", side.text, getPrintCm(state.product));
    setSelected("text");
    refreshDesign("text");
  });
  $("#rotateReset").addEventListener("click", () => {
    const side = getActiveSideState();
    const obj = state.selected === "art" ? side.art : state.selected === "text" ? side.text : null;
    if (!obj) return;
    obj.rotation = 0;
    constrainDesign(state.selected, obj, getPrintCm(state.product));
    refreshDesign(state.selected);
    updateStageTools();
  });
  $("#removeSelected").addEventListener("click", removeSelected);

  $("#qtyMinus").addEventListener("click", () => {
    state.quantity = clamp(state.quantity - 1, 1, MAX_QTY);
    updateQuantity();
    updateEditorPrice();
  });
  $("#qtyPlus").addEventListener("click", () => {
    state.quantity = clamp(state.quantity + 1, 1, MAX_QTY);
    updateQuantity();
    updateEditorPrice();
  });

  $("#addToCart").addEventListener("click", addToCart);

  window.addEventListener(
    "resize",
    debounce(() => {
      if (state.step === "editor") updateReadout();
    }, 150)
  );
}

function toggleTextStyle(prop) {
  const t = getActiveSideState().text;
  t[prop] = !t[prop];
  constrainDesign("text", t, getPrintCm(state.product));
  $(prop === "bold" ? "#textBold" : "#textItalic").setAttribute("aria-pressed", String(t[prop]));
  refreshDesign("text");
  syncTextSizeControl();
}

function setTextColor(color, rerenderSwatches = true) {
  const t = getActiveSideState().text;
  t.color = color;
  if (rerenderSwatches) syncTextControls();
  else
    $$("#textColorOptions .swatch").forEach((s) =>
      s.setAttribute("aria-pressed", String(s.dataset.textColor.toLowerCase() === color.toLowerCase()))
    );
  refreshDesign("text");
}

/* ---------- Seletor de tipografia ---------- */

const fontFilter = { q: "", category: "all", source: "all" };
let fontObserver;

function openFontPicker() {
  const dialog = $("#fontPicker");
  const categories = { all: "Todas", ...FONT_CATEGORIES };
  const usedSources = new Set(state.fonts.map((f) => f.source));
  const sources = { all: "Todos os bancos" };
  for (const [k, v] of Object.entries(FONT_SOURCES)) if (usedSources.has(k)) sources[k] = v.label;

  $("#fontCategoryFilter").innerHTML = Object.entries(categories)
    .map(([k, v]) => `<button type="button" class="chip" data-category="${k}" aria-pressed="${fontFilter.category === k}">${v}</button>`)
    .join("");
  $("#fontSourceFilter").innerHTML = Object.entries(sources)
    .map(([k, v]) => `<button type="button" class="chip chip-outline" data-source="${k}" aria-pressed="${fontFilter.source === k}">${v}</button>`)
    .join("");
  $("#fontSearch").value = fontFilter.q;
  renderFontList();
  dialog.showModal();
  vk?.prepareInputs();
  setTimeout(() => $(`#fontList [aria-selected="true"]`)?.scrollIntoView({ block: "center" }), 30);
}

function renderFontList() {
  const current = getActiveSideState().text;
  const sample = current.value.trim() || "Seu Nome";
  const q = fontFilter.q.trim().toLowerCase();
  const list = state.fonts.filter(
    (f) =>
      (fontFilter.category === "all" || f.category === fontFilter.category) &&
      (fontFilter.source === "all" || f.source === fontFilter.source) &&
      (!q || f.family.toLowerCase().includes(q))
  );
  $("#fontCount").textContent = `${list.length} de ${state.fonts.length} tipografias · ${Object.keys(FONT_SOURCES).filter((s) => state.fonts.some((f) => f.source === s)).length} bancos de fontes`;
  fontObserver?.disconnect();
  fontObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const font = state.fonts.find((f) => f.id === entry.target.dataset.fontId);
        loadFont(font).then(() => entry.target.classList.add("is-loaded"));
        fontObserver.unobserve(entry.target);
      }
    },
    { root: $("#fontList"), rootMargin: "200px" }
  );
  $("#fontList").innerHTML = list.length
    ? list
        .map(
          (f) => `
      <button type="button" role="option" class="font-option" data-font-id="${escapeHtml(f.id)}" aria-selected="${f.id === current.fontId}">
        <span class="font-sample" style="font-family:${escapeHtml(fontStack(f))}">${escapeHtml(sample)}</span>
        <span class="font-meta"><span>${escapeHtml(f.family)}</span><span class="tag">${escapeHtml(FONT_SOURCES[f.source]?.short || "")}</span><span class="muted">${escapeHtml(FONT_CATEGORIES[f.category] || "")}</span></span>
      </button>`
        )
        .join("")
    : `<p class="empty">Nenhuma fonte encontrada.</p>`;
  $$("#fontList .font-option").forEach((n) => fontObserver.observe(n));
}

function bindFontPicker() {
  const dialog = $("#fontPicker");
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
    const opt = e.target.closest(".font-option");
    if (opt) {
      const font = state.fonts.find((f) => f.id === opt.dataset.fontId);
      if (font) setFont(font);
      dialog.close();
    }
  });
  $("#fontSearch").addEventListener(
    "input",
    debounce((e) => {
      fontFilter.q = e.target.value;
      renderFontList();
    }, 120)
  );
  $("#fontCategoryFilter").addEventListener("click", (e) => {
    const c = e.target.closest("[data-category]")?.dataset.category;
    if (!c) return;
    fontFilter.category = c;
    $$("#fontCategoryFilter .chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.category === c)));
    renderFontList();
  });
  $("#fontSourceFilter").addEventListener("click", (e) => {
    const s = e.target.closest("[data-source]")?.dataset.source;
    if (!s) return;
    fontFilter.source = s;
    $$("#fontSourceFilter .chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.source === s)));
    renderFontList();
  });
}

/* ---------- Adicionar ao carrinho ---------- */

function snapshotCurrentItem() {
  const p = state.product;
  const finish = getFinish();
  const sideKeys = p.allowsBack ? ["front", "back"] : ["front"];
  const sides = {};
  for (const key of sideKeys) sides[key] = deepClone(state.sides[key]);
  return {
    item_id: state.editingItemId || uid("item"),
    produto_id: p.id,
    produto_nome: p.name,
    produto_descricao: p.description || "",
    cor: state.color,
    tamanho: state.size || (p.sizes?.[0] ?? "Único"),
    acabamento: finish?.id || null,
    acabamento_label: finish?.label || null,
    preco_base: Number(p.price) || 0,
    acabamento_extra: Number(finish?.extraPrice) || 0,
    valor_unitario: unitPrice(),
    quantidade: state.quantity,
    render: productRenderSnapshot(p),
    sides,
    frente: toOrderSide(sides.front),
    costas: p.allowsBack ? toOrderSide(sides.back) : null,
  };
}

function addToCart() {
  const p = state.product;
  if (p.sizes?.length > 1 && !state.size) {
    $("#sizeGroup").classList.add("is-invalid");
    $("#sizeGroup").scrollIntoView({ block: "center", behavior: "smooth" });
    toast("Escolha um tamanho antes de continuar.", "error");
    return;
  }
  if (getFinishes().length && !state.finishId) {
    $("#finishGroup").classList.add("is-invalid");
    $("#finishGroup").scrollIntoView({ block: "center", behavior: "smooth" });
    toast("Escolha o acabamento (adesivo ou gravação).", "error");
    return;
  }
  const hasContent = ["front", "back"].some((k) => (k === "front" || p.allowsBack) && sideHasContent(state.sides[k]));
  if (!hasContent && !window.confirm("Você não adicionou estampa nem texto. Deseja adicionar o produto liso?")) return;

  const item = snapshotCurrentItem();
  const i = state.cart.findIndex((c) => c.item_id === item.item_id);
  if (i >= 0) state.cart[i] = item;
  else state.cart.push(item);
  saveCart();
  toast(state.editingItemId ? "Item atualizado." : "Produto adicionado ao carrinho!", "success");
  state.editingItemId = null;
  goTo("cart");
}

/* ====================================================================== */
/* 3. Carrinho                                                            */
/* ====================================================================== */

function updateCartBadge() {
  const count = state.cart.reduce((n, i) => n + (i.quantidade || 1), 0);
  $("#cartCount").textContent = String(count);
  $("#cartButton").classList.toggle("has-items", count > 0);
  renderCartPanel();
}

function itemSpecs(item) {
  const specs = [];
  if (item.tamanho && item.tamanho !== "Único") specs.push(["Tamanho", item.tamanho]);
  if (item.acabamento_label) specs.push(["Acabamento", item.acabamento_label]);
  for (const [key, label] of [["frente", "Frente"], ["costas", "Costas"]]) {
    const s = item[key];
    if (!s) continue;
    const bits = [];
    if (s.estampa_nome) bits.push(`${s.estampa_nome} (${formatNumber(s.estampa_dimensoes_cm.largura)} × ${formatNumber(s.estampa_dimensoes_cm.altura)} cm)`);
    if (s.texto) bits.push(`“${s.texto}” em ${s.texto_fonte}`);
    specs.push([label, bits.join(" + ")]);
  }
  return specs;
}

function itemPreview(item, sideKey, size = "md") {
  const side = item.sides?.[sideKey];
  const wrap = document.createElement("figure");
  wrap.className = `item-preview item-preview-${size}`;
  const stageEl = buildStage({
    product: item.render,
    sideKey,
    side,
    color: item.cor,
    finish: item.acabamento,
  }).root;
  wrap.append(stageEl);
  if (size !== "sm") {
    const cap = document.createElement("figcaption");
    cap.textContent = SIDE_LABELS[sideKey];
    wrap.append(cap);
  }
  if (side?.text) loadFontForText(side.text, state.fonts);
  return wrap;
}

function renderCartView() {
  const host = $("#cartReviewList");
  host.innerHTML = "";
  for (const item of state.cart) {
    const product = state.products.find((p) => p.id === item.produto_id);
    const row = document.createElement("article");
    row.className = "cart-item";
    const previews = document.createElement("div");
    previews.className = "cart-item-previews";
    previews.append(itemPreview(item, "front"));
    if (item.render?.mockups?.back && item.sides?.back) previews.append(itemPreview(item, "back"));

    const info = document.createElement("div");
    info.className = "cart-item-info";
    info.innerHTML = `
      <div class="cart-item-head">
        <h2>${escapeHtml(item.produto_nome)}</h2>
        <span class="swatch swatch-static" style="--swatch:${escapeHtml(item.cor)}" title="Cor do produto"></span>
      </div>
      <dl class="specs">${itemSpecs(item).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")}</dl>
      <div class="cart-item-foot">
        <div class="stepper-input" aria-label="Quantidade">
          <button type="button" data-qty="-1" aria-label="Diminuir quantidade">−</button>
          <output>${item.quantidade || 1}</output>
          <button type="button" data-qty="1" aria-label="Aumentar quantidade">+</button>
        </div>
        <div class="line-price">
          <span class="muted">${formatBRL(item.valor_unitario)} cada</span>
          <strong>${formatBRL(item.valor_unitario * (item.quantidade || 1))}</strong>
        </div>
      </div>
      <div class="cart-item-actions">
        ${product ? `<button type="button" class="btn btn-ghost btn-sm" data-edit>Editar</button>` : ""}
        <button type="button" class="btn btn-ghost btn-sm danger" data-remove>Remover</button>
      </div>`;
    info.querySelector("[data-edit]")?.addEventListener("click", () => openEditor(product, item));
    info.querySelector("[data-remove]").addEventListener("click", () => removeCartItem(item.item_id));
    info.querySelectorAll("[data-qty]").forEach((b) =>
      b.addEventListener("click", () => {
        item.quantidade = clamp((item.quantidade || 1) + Number(b.dataset.qty), 1, MAX_QTY);
        saveCart();
        renderCartView();
      })
    );
    row.append(previews, info);
    host.append(row);
  }
  if (!state.cart.length) host.innerHTML = `<p class="empty">Seu carrinho está vazio.</p>`;
  $("#cartTotal").textContent = formatBRL(cartSubtotal());
  $("#cartContinue").disabled = !state.cart.length;
}

function removeCartItem(id) {
  state.cart = state.cart.filter((i) => i.item_id !== id);
  saveCart();
  if (state.step === "cart") renderCartView();
  toast("Item removido.");
}

function renderCartPanel() {
  const host = $("#cartPanelList");
  if (!host) return;
  host.innerHTML = "";
  if (!state.cart.length) host.innerHTML = `<p class="empty">Nenhum item ainda.</p>`;
  for (const item of state.cart) {
    const row = document.createElement("div");
    row.className = "mini-item";
    row.append(itemPreview(item, "front", "sm"));
    const info = document.createElement("div");
    info.innerHTML = `<strong>${escapeHtml(item.produto_nome)}</strong>
      <span class="muted">${item.quantidade || 1} × ${formatBRL(item.valor_unitario)}${item.tamanho && item.tamanho !== "Único" ? ` · ${escapeHtml(item.tamanho)}` : ""}</span>`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.setAttribute("aria-label", `Remover ${item.produto_nome}`);
    remove.textContent = "✕";
    remove.addEventListener("click", () => removeCartItem(item.item_id));
    row.append(info, remove);
    host.append(row);
  }
  $("#cartPanelTotal").textContent = formatBRL(cartSubtotal());
  $("#cartPanelReview").disabled = !state.cart.length;
}

function openCartPanel() {
  renderCartPanel();
  const panel = $("#cartPanel");
  panel.classList.add("is-open");
  panel.removeAttribute("inert");
  panel.setAttribute("aria-hidden", "false");
  $("#cartBackdrop").hidden = false;
  $("#cartButton").setAttribute("aria-expanded", "true");
  $("#closeCart").focus();
}

function closeCartPanel() {
  const panel = $("#cartPanel");
  if (!panel.classList.contains("is-open")) return;
  panel.classList.remove("is-open");
  panel.setAttribute("inert", "");
  panel.setAttribute("aria-hidden", "true");
  $("#cartBackdrop").hidden = true;
  $("#cartButton").setAttribute("aria-expanded", "false");
}

/* ====================================================================== */
/* 4. Dados do cliente (Evento × Encomenda)                               */
/* ====================================================================== */

const ADDRESS_FIELDS = ["cep", "rua", "numero", "complemento", "bairro", "cidade", "estado"];
const addrInput = (k) => $(`#addr${k[0].toUpperCase()}${k.slice(1)}`);

function enabledModes() {
  return Object.entries(state.settings.modes || {})
    .filter(([, on]) => on)
    .map(([k]) => k);
}

function renderCustomer() {
  const c = state.customer;
  const modes = enabledModes();
  if (modes.length === 1) c.modalidade = modes[0];
  $$('#modeSelector input[name="modalidade"]').forEach((r) => {
    r.closest(".option-card").hidden = !modes.includes(r.value);
    r.checked = r.value === c.modalidade;
  });
  $("#modeSelector").hidden = modes.length <= 1;
  $("#customerName").value = c.nome;
  $("#customerPhone").value = formatPhone(c.telefone);
  $("#customerEmail").value = c.email;
  for (const k of ADDRESS_FIELDS) addrInput(k).value = k === "cep" ? formatCep(c.endereco[k]) : c.endereco[k] || "";
  updateAddressVisibility();
  clearErrors();
}

function updateAddressVisibility() {
  const show = state.customer.modalidade === "ENCOMENDA";
  $("#addressFields").hidden = !show;
  $$("#addressFields input, #addressFields select").forEach((i) => {
    i.disabled = !show;
    if (i.id !== "addrComplemento") i.required = show;
  });
}

function setError(field, message) {
  const p = $(`[data-error-for="${field}"]`);
  if (p) p.textContent = message || "";
  const input = field === "modalidade" ? null : $(`[name="${field}"]`);
  if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
}
function clearErrors() {
  $$("#customerForm .field-error").forEach((p) => (p.textContent = ""));
  $$("#customerForm [aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid"));
}

function validateCustomer(show = true) {
  const c = state.customer;
  const errors = {};
  if (!c.modalidade) errors.modalidade = "Escolha Evento ou Encomenda.";
  if (c.nome.trim().length < 3) errors.nome = "Informe seu nome completo (mín. 3 letras).";
  const phone = onlyDigits(c.telefone);
  if (phone.length < 10 || phone.length > 11) errors.telefone = "Informe um WhatsApp com DDD (10 ou 11 dígitos).";
  if (!isValidEmail(c.email)) errors.email = "Informe um e-mail válido.";
  if (c.modalidade === "ENCOMENDA") {
    const a = c.endereco;
    if (onlyDigits(a.cep).length !== 8) errors.cep = "CEP com 8 dígitos.";
    if (!a.rua.trim()) errors.rua = "Informe a rua.";
    if (!a.numero.trim()) errors.numero = "Informe o número (ou S/N).";
    if (!a.bairro.trim()) errors.bairro = "Informe o bairro.";
    if (!a.cidade.trim()) errors.cidade = "Informe a cidade.";
    if (!UFS.includes(a.estado)) errors.estado = "Escolha a UF.";
  }
  if (show) {
    clearErrors();
    for (const [k, v] of Object.entries(errors)) setError(k, v);
    const first = Object.keys(errors)[0];
    if (first) {
      const input = first === "modalidade" ? $('#modeSelector input:not([disabled])') : $(`[name="${first}"]`);
      input?.focus();
    }
  }
  return !Object.keys(errors).length;
}

let cepAbort;
async function lookupCep(cep) {
  const hint = $("#cepHint");
  cepAbort?.abort();
  cepAbort = new AbortController();
  hint.textContent = "Buscando endereço…";
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: cepAbort.signal });
    const data = await res.json();
    if (data.erro) {
      hint.textContent = "CEP não encontrado. Preencha manualmente.";
      return;
    }
    const a = state.customer.endereco;
    a.rua = data.logradouro || a.rua;
    a.bairro = data.bairro || a.bairro;
    a.cidade = data.localidade || a.cidade;
    a.estado = data.uf || a.estado;
    for (const k of ["rua", "bairro", "cidade", "estado"]) addrInput(k).value = a[k];
    hint.textContent = "Endereço preenchido automaticamente.";
    saveCustomerDraft();
    $("#addrNumero").focus();
  } catch (err) {
    if (err.name !== "AbortError") hint.textContent = "Não foi possível buscar o CEP. Preencha manualmente.";
  }
}

function bindCustomerEvents() {
  $("#addrEstado").innerHTML = `<option value="">—</option>` + UFS.map((u) => `<option>${u}</option>`).join("");

  $("#modeSelector").addEventListener("change", (e) => {
    if (e.target.name !== "modalidade") return;
    state.customer.modalidade = e.target.value;
    setError("modalidade", "");
    updateAddressVisibility();
    saveCustomerDraft();
  });
  $("#customerName").addEventListener("input", (e) => {
    state.customer.nome = e.target.value;
    saveCustomerDraft();
  });
  $("#customerPhone").addEventListener("input", (e) => {
    state.customer.telefone = onlyDigits(e.target.value).slice(0, 11);
    e.target.value = formatPhone(state.customer.telefone);
    saveCustomerDraft();
  });
  $("#customerEmail").addEventListener("input", (e) => {
    state.customer.email = e.target.value.trim();
    saveCustomerDraft();
  });
  for (const k of ADDRESS_FIELDS) {
    const input = addrInput(k);
    input.addEventListener(k === "estado" ? "change" : "input", (e) => {
      let v = e.target.value;
      if (k === "cep") {
        const digits = onlyDigits(v).slice(0, 8);
        e.target.value = formatCep(digits);
        v = digits;
        if (digits.length === 8 && digits !== state.customer.endereco.cep) {
          state.customer.endereco.cep = digits;
          lookupCep(digits);
        }
      }
      state.customer.endereco[k] = v;
      saveCustomerDraft();
    });
  }
  $("#customerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (validateCustomer(true)) goTo("checkout");
  });
}

/* ====================================================================== */
/* 5. Pagamento                                                           */
/* ====================================================================== */

const PAYMENT_DESCRIPTIONS = {
  CREDITO: "Pague com cartão de crédito",
  DEBITO: "Pague com cartão de débito",
  PIX: "QR Code e copia-e-cola na confirmação",
  PAGAR_NA_RETIRADA: "Pague ao retirar o pedido",
};

function enabledPayments() {
  return Object.keys(PAYMENT_LABELS).filter((k) => state.settings.payments?.[k] !== false);
}

function renderCheckout() {
  const methods = enabledPayments();
  if (!methods.includes(state.payment)) state.payment = null;
  $("#paymentOptions").innerHTML = methods
    .map(
      (m) => `
      <label class="option-card payment-card">
        <input type="radio" name="payment" value="${m}" ${state.payment === m ? "checked" : ""} />
        <span class="payment-icon" aria-hidden="true">${paymentIcon(m)}</span>
        <span class="option-title">${PAYMENT_LABELS[m]}</span>
        <span class="option-desc">${PAYMENT_DESCRIPTIONS[m]}</span>
      </label>`
    )
    .join("");
  updatePaymentHint();
  renderCheckoutSummary();
  updateOnlineState();
}

function paymentIcon(method) {
  const icons = {
    CREDITO: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 9.5h19" stroke="currentColor" stroke-width="2.4"/><path d="M6 15h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    DEBITO: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16" cy="14" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 9h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    PIX: '<svg viewBox="0 0 24 24"><path d="M12 2.8 21.2 12 12 21.2 2.8 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 9.5 12 13l3.5-3.5M8.5 14.5 12 11l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    PAGAR_NA_RETIRADA: '<svg viewBox="0 0 24 24"><path d="M4 9h16l-1.2 10.5a1.5 1.5 0 0 1-1.5 1.5H6.7a1.5 1.5 0 0 1-1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  };
  return icons[method] || "";
}

function updatePaymentHint() {
  const m = state.payment;
  const s = state.settings;
  let hint = "";
  if (m === "CREDITO" || m === "DEBITO") hint = s.cardInstructions || "";
  if (m === "PIX") hint = s.pix?.key ? "O QR Code Pix aparece na próxima tela, junto com o número do pedido." : "A loja enviará os dados do Pix pelo WhatsApp.";
  if (m === "PAGAR_NA_RETIRADA")
    hint = state.customer.modalidade === "ENCOMENDA" ? "Pague no momento da entrega." : "Pague no balcão ao retirar. Seu pedido já entra na fila de produção.";
  $("#paymentHint").textContent = hint;
}

function renderCheckoutSummary() {
  const c = state.customer;
  const a = c.endereco;
  const fee = deliveryFee();
  $("#checkoutSummary").innerHTML = `
    <h2>Resumo</h2>
    <ul class="summary-list">
      ${state.cart
        .map(
          (i) => `<li><span>${i.quantidade || 1}× ${escapeHtml(i.produto_nome)}${i.tamanho && i.tamanho !== "Único" ? ` (${escapeHtml(i.tamanho)})` : ""}${i.acabamento_label ? ` · ${escapeHtml(i.acabamento_label)}` : ""}</span><strong>${formatBRL(i.valor_unitario * (i.quantidade || 1))}</strong></li>`
        )
        .join("")}
    </ul>
    <div class="summary-totals">
      <div><span>Subtotal</span><span>${formatBRL(cartSubtotal())}</span></div>
      ${c.modalidade === "ENCOMENDA" ? `<div><span>Entrega</span><span>${fee ? formatBRL(fee) : "A combinar"}</span></div>` : ""}
      <div class="total"><span>Total</span><strong>${formatBRL(cartTotal())}</strong></div>
    </div>
    <dl class="summary-customer">
      <div><dt>Cliente</dt><dd>${escapeHtml(c.nome)}</dd></div>
      <div><dt>Contato</dt><dd>${escapeHtml(formatPhone(c.telefone))} · ${escapeHtml(c.email)}</dd></div>
      <div><dt>Modalidade</dt><dd>${escapeHtml(MODE_LABELS[c.modalidade] || "—")}</dd></div>
      ${c.modalidade === "ENCOMENDA" ? `<div><dt>Endereço</dt><dd>${escapeHtml(`${a.rua}, ${a.numero}${a.complemento ? ` – ${a.complemento}` : ""} · ${a.bairro} · ${a.cidade}/${a.estado} · CEP ${formatCep(a.cep)}`)}</dd></div>` : ""}
    </dl>`;
}

function updateOnlineState() {
  const offline = navigator.onLine === false;
  const degraded = !!store?.degraded;
  const notice = $("#offlineNotice");
  notice.hidden = !offline && !degraded;
  notice.textContent = degraded
    ? "Não foi possível conectar ao servidor da loja. Verifique a internet e recarregue a página para confirmar o pedido."
    : "Você está sem conexão. Reconecte para confirmar o pedido.";
  $("#confirmOrder").disabled = offline || degraded;
}

function bindCheckoutEvents() {
  $("#paymentOptions").addEventListener("change", (e) => {
    state.payment = e.target.value;
    updatePaymentHint();
  });
  $("#confirmOrder").addEventListener("click", placeOrder);
  bindFontPicker();
}

function buildOrderData() {
  const c = state.customer;
  const now = new Date().toISOString();
  const initialStatus = state.payment === "PAGAR_NA_RETIRADA" ? "EM_FILA" : "AGUARDANDO_PAGAMENTO";
  return {
    modalidade: c.modalidade,
    cliente: {
      nome: c.nome.trim(),
      telefone: onlyDigits(c.telefone),
      email: c.email.trim().toLowerCase(),
      endereco:
        c.modalidade === "ENCOMENDA"
          ? {
              cep: formatCep(c.endereco.cep),
              rua: c.endereco.rua.trim(),
              numero: c.endereco.numero.trim(),
              complemento: c.endereco.complemento.trim(),
              bairro: c.endereco.bairro.trim(),
              cidade: c.endereco.cidade.trim(),
              estado: c.endereco.estado,
            }
          : null,
    },
    // Pedido baseado 100% no array de itens (corrige o bug multi-item)
    itens: state.cart.map(({ sides, ...item }) => item),
    quantidade_itens: state.cart.reduce((n, i) => n + (i.quantidade || 1), 0),
    subtotal: round(cartSubtotal()),
    taxa_entrega: round(deliveryFee()),
    valor_total: round(cartTotal()),
    metodo_pagamento: state.payment,
    status_pagamento: "PENDENTE",
    status_producao: initialStatus,
    historico: [{ status: initialStatus, em: now }],
    notificacoes: { email_enviado: false, mensagem_enviada: false, ultimo_disparo_em: null },
    origem: state.settings.kioskMode ? "totem" : "web",
    created_at: now,
    updated_at: now,
  };
}

async function placeOrder() {
  if (navigator.onLine === false || store?.degraded) return updateOnlineState();
  if (!state.payment) {
    toast("Escolha um método de pagamento.", "error");
    $("#paymentOptions input")?.focus();
    return;
  }
  if (!validateCustomer(false)) return goTo("customer");
  const btn = $("#confirmOrder");
  btn.disabled = true;
  btn.classList.add("is-loading");
  btn.textContent = "Enviando pedido…";
  try {
    state.lastOrder = await store.createOrder(buildOrderData());
    state.cart = [];
    saveCart();
    state.customer = emptyCustomer();
    sessionStorage.removeItem(SS.customer);
    goTo("success", { force: true });
  } catch (err) {
    console.error(err);
    toast(`Não foi possível registrar o pedido. ${err.message || "Tente novamente."}`, "error", 6000);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
    btn.textContent = "Confirmar pedido";
  }
}

/* ====================================================================== */
/* Confirmação                                                            */
/* ====================================================================== */

let autoResetTimer = null;

async function renderSuccess() {
  const o = state.lastOrder;
  if (!o) return;
  $("#successCode").textContent = `#${o.codigo_curto}`;
  $("#successNumber").textContent = o.numero_pedido;
  $("#successStatus").textContent = statusLabel(o.status_producao, o.modalidade);
  $("#successPayment").textContent = PAYMENT_LABELS[o.metodo_pagamento] || o.metodo_pagamento;
  $("#successMode").textContent = MODE_LABELS[o.modalidade] || "—";
  $("#successTotal").textContent = formatBRL(o.valor_total);
  $("#successNotice").textContent =
    store.mode === "firebase"
      ? `Enviamos o número do pedido e o status para o seu WhatsApp e e-mail (${o.cliente.email}). Você receberá novas mensagens a cada atualização.`
      : "Modo demonstração: o pedido foi salvo neste dispositivo e as mensagens automáticas por WhatsApp/e-mail não são enviadas.";

  const pix = state.settings.pix || {};
  const pixBox = $("#pixBox");
  pixBox.hidden = !(o.metodo_pagamento === "PIX" && pix.key);
  if (!pixBox.hidden) {
    const payload = buildPixPayload({
      key: pix.key,
      name: pix.merchantName || state.settings.brandName,
      city: pix.merchantCity,
      amount: o.valor_total,
      txid: o.numero_pedido,
    });
    $("#pixCode").value = payload;
    $("#pixQr").innerHTML = `<span class="spinner" aria-hidden="true"></span>`;
    try {
      $("#pixQr").innerHTML = await renderQrSvg(payload);
    } catch {
      $("#pixQr").innerHTML = `<p class="muted">Use o código copia-e-cola abaixo.</p>`;
    }
  }

  startAutoReset();
}

function startAutoReset() {
  stopAutoReset();
  const box = $("#autoReset");
  const seconds = Number(state.settings.kioskAutoResetSeconds) || 0;
  if (!state.settings.kioskMode || seconds <= 0) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const bar = $("#autoResetBar");
  const started = Date.now();
  const tick = () => {
    const left = Math.max(0, seconds - (Date.now() - started) / 1000);
    bar.style.width = `${(left / seconds) * 100}%`;
    $("#autoResetText").textContent = `Nova sessão em ${Math.ceil(left)} s`;
    if (left <= 0) restartSession();
  };
  tick();
  autoResetTimer = setInterval(tick, 200);
}

function stopAutoReset() {
  clearInterval(autoResetTimer);
  autoResetTimer = null;
}

function restartSession() {
  stopAutoReset();
  closeIdleDialog();
  $("#fontPicker").open && $("#fontPicker").close();
  state.cart = [];
  saveCart();
  state.customer = emptyCustomer();
  state.payment = null;
  state.product = null;
  state.sides = null;
  state.lastOrder = null;
  try {
    sessionStorage.removeItem(SS.customer);
    sessionStorage.removeItem(SS.cart);
  } catch {
    /* ignore */
  }
  goTo("catalog", { force: true });
}

/* ====================================================================== */
/* Totem: inatividade                                                     */
/* ====================================================================== */

let idleTimer = null;
let idleCountdown = null;

function resetInactivity() {
  clearTimeout(idleTimer);
  const secs = Number(state.settings.kioskInactivitySeconds) || 0;
  if (!state.settings.kioskMode || secs <= 0) return;
  const hasSession = state.step !== "catalog" || state.cart.length;
  if (!hasSession || state.step === "success") return;
  idleTimer = setTimeout(openIdleDialog, secs * 1000);
}

function openIdleDialog() {
  const dialog = $("#idleDialog");
  if (dialog.open) return;
  dialog.showModal();
  let left = 10;
  $("#idleCountdown").textContent = String(left);
  idleCountdown = setInterval(() => {
    left -= 1;
    $("#idleCountdown").textContent = String(left);
    if (left <= 0) restartSession();
  }, 1000);
}

function closeIdleDialog() {
  clearInterval(idleCountdown);
  const dialog = $("#idleDialog");
  if (dialog.open) dialog.close();
}

function setupInactivityTimeout() {
  const onActivity = () => {
    if ($("#idleDialog").open) return;
    resetInactivity();
  };
  ["pointerdown", "keydown", "input", "wheel", "touchstart"].forEach((ev) =>
    document.addEventListener(ev, onActivity, { passive: true })
  );
  $("#idleContinue").addEventListener("click", () => {
    closeIdleDialog();
    resetInactivity();
  });
  $("#idleRestart").addEventListener("click", restartSession);
  $("#idleDialog").addEventListener("cancel", () => {
    clearInterval(idleCountdown);
    resetInactivity();
  });
}

boot();

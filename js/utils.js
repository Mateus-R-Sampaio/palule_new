// Utilitários compartilhados entre a área do cliente e o painel admin.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const round = (v, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(v) || 0) * f) / f;
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatBRL = (v) => brl.format(Number(v) || 0);

const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export const formatCm = (v) => `${num.format(round(v, 1))} cm`;
export const formatNumber = (v, d = 1) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: d }).format(Number(v) || 0);

export const uid = (prefix = "id") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const onlyDigits = (v) => String(v ?? "").replace(/\D/g, "");

export function formatPhone(value) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function formatCep(value) {
  const d = onlyDigits(value).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim());

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const deepClone = (obj) => (obj == null ? obj : JSON.parse(JSON.stringify(obj)));

export function todayStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = typeof iso?.toDate === "function" ? iso.toDate() : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (Number.isNaN(diff)) return "";
  if (diff < 60) return "agora";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return formatDateTime(iso);
}

/* ---------- Status, rótulos e constantes de negócio ---------- */

export const STATUS_FLOW = [
  "AGUARDANDO_PAGAMENTO",
  "EM_FILA",
  "EM_PRODUCAO",
  "PRONTO_PARA_RETIRADA",
  "ENTREGUE",
];

export const STATUS_LABELS = {
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  EM_FILA: "Fila de produção",
  EM_PRODUCAO: "Em produção",
  PRONTO_PARA_RETIRADA: "Pronto para retirada",
  ENTREGUE: "Entregue / Concluído",
};

export function statusLabel(status, modalidade) {
  if (status === "PRONTO_PARA_RETIRADA" && modalidade === "ENCOMENDA") return "Pronto para entrega";
  return STATUS_LABELS[status] || status || "—";
}

export const PAYMENT_LABELS = {
  CREDITO: "Cartão de crédito",
  DEBITO: "Cartão de débito",
  PIX: "Pix",
  PAGAR_NA_RETIRADA: "Pagar na retirada",
};

export const PAYMENT_STATUS_LABELS = { PENDENTE: "Pendente", PAGO: "Pago", CANCELADO: "Cancelado" };

export const MODE_LABELS = { EVENTO: "Evento (retirada no local)", ENCOMENDA: "Encomenda (entrega)" };

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

/* ---------- UI ---------- */

export function toast(message, type = "info", timeout = 3200) {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.append(el);
  requestAnimationFrame(() => el.classList.add("is-visible"));
  setTimeout(() => {
    el.classList.remove("is-visible");
    setTimeout(() => el.remove(), 300);
  }, timeout);
}

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function isDarkColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 < 140;
}

export function applyBrandColor(color) {
  if (!hexToRgb(color)) return;
  const root = document.documentElement;
  root.style.setProperty("--accent", color);
  root.style.setProperty("--accent-ink", isDarkColor(color) ? "#ffffff" : "#171a25");
}

/* ---------- Arquivos ---------- */

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Reduz imagens raster grandes (mantendo transparência). SVG e GIF passam intactos. */
export async function downscaleImage(file, maxSize = 1600) {
  if (!file.type.startsWith("image/") || /svg|gif/.test(file.type)) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale >= 1 && file.size < 900_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/webp", 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".webp", { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW não registrado", err));
  });
}

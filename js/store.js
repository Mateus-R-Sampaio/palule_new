// Cliente da API do Studio Personalizado.
// O navegador não guarda o banco de dados: catálogo, pedidos e configurações
// vêm do servidor (PostgreSQL), que valida tudo antes de gravar.

import { API_BASE } from "./config.js";

const BASE = String(API_BASE || "").replace(/\/+$/, "");
export const isCrossOrigin = () => !!BASE && new URL(BASE, location.href).origin !== location.origin;

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = "GET", body, form, admin = false, etag } = {}) {
  const headers = { "X-Requested-With": "studio", Accept: "application/json" };
  const init = { method, headers, credentials: admin ? "same-origin" : "omit", cache: "no-store" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (form) init.body = form;
  if (etag) headers["If-None-Match"] = etag;
  let res;
  try {
    res = await fetch(`${admin ? "" : BASE}${path}`, init);
  } catch {
    throw new ApiError("Sem conexão com o servidor. Verifique a internet e tente novamente.", 0);
  }
  if (res.status === 304) return { notModified: true };
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(data?.error || `Erro ${res.status}`, res.status, data?.detalhes);
  if (etag !== undefined) return { data, etag: res.headers.get("ETag") };
  return data;
}

/* ------------------------------------------------------------------ Loja (público) */

export const shop = {
  loadCatalog: () => request("/api/public/catalog"),

  async uploadCustomerLogo(blob, name = "logo.png") {
    const form = new FormData();
    form.append("file", blob, name);
    return request("/api/public/uploads/customer-logo", { method: "POST", form });
  },

  createOrder: (payload) => request("/api/public/orders", { method: "POST", body: payload }),
};

/* ------------------------------------------------------------------ Painel (admin) */
// Sempre no mesmo domínio do servidor: o cookie de sessão é HttpOnly + SameSite=Strict.

const KIND_BY_FOLDER = { mockups: "mockup", arts: "art", brand: "brand", fonts: "font" };

export const adminApi = {
  async me() {
    try {
      return (await request("/api/auth/me", { admin: true })).user;
    } catch (err) {
      if (err.status === 401) return null;
      throw err;
    }
  },
  signIn: (email, password) => request("/api/auth/login", { method: "POST", admin: true, body: { email, password } }),
  signOut: () => request("/api/auth/logout", { method: "POST", admin: true, body: {} }),
  changePassword: (currentPassword, newPassword) =>
    request("/api/auth/password", { method: "POST", admin: true, body: { currentPassword, newPassword } }),

  bootstrap: () => request("/api/admin/bootstrap", { admin: true }),
  saveSettings: async (patch) => (await request("/api/admin/settings", { method: "PUT", admin: true, body: patch })).settings,

  saveProduct: (p) => request(`/api/admin/products/${encodeURIComponent(p.id)}`, { method: "PUT", admin: true, body: p }),
  deleteProduct: (id) => request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE", admin: true }),

  async uploadFile(file, { folder }) {
    const form = new FormData();
    form.append("file", file, file.name);
    const kind = KIND_BY_FOLDER[folder];
    return (await request(`/api/admin/files?kind=${kind}`, { method: "POST", admin: true, form })).url;
  },

  createArt: async (art) => (await request("/api/admin/arts", { method: "POST", admin: true, body: art })).art,
  updateArt: (id, patch) => request(`/api/admin/arts/${encodeURIComponent(id)}`, { method: "PUT", admin: true, body: patch }),
  deleteArt: (id) => request(`/api/admin/arts/${encodeURIComponent(id)}`, { method: "DELETE", admin: true }),

  createFont: async (font) => (await request("/api/admin/fonts", { method: "POST", admin: true, body: font })).font,
  updateFont: (id, patch) => request(`/api/admin/fonts/${encodeURIComponent(id)}`, { method: "PUT", admin: true, body: patch }),
  deleteFont: (id) => request(`/api/admin/fonts/${encodeURIComponent(id)}`, { method: "DELETE", admin: true }),

  setOrderStatus: (numero, status, extra = {}) =>
    request(`/api/admin/orders/${encodeURIComponent(numero)}/status`, { method: "PATCH", admin: true, body: { status, ...extra } }),
  setOrderPayment: (numero, status_pagamento) =>
    request(`/api/admin/orders/${encodeURIComponent(numero)}/payment`, { method: "PATCH", admin: true, body: { status_pagamento } }),
  requestNotification: (numero) => request(`/api/admin/orders/${encodeURIComponent(numero)}/notify`, { method: "POST", admin: true, body: {} }),
  deleteOrder: (numero) => request(`/api/admin/orders/${encodeURIComponent(numero)}`, { method: "DELETE", admin: true }),

  /** "Tempo real" por consulta periódica (com ETag: só baixa quando algo mudou). */
  subscribeOrders(cb, onError, intervalMs = 4000) {
    let etag = "";
    let stopped = false;
    let timer;
    const tick = async () => {
      try {
        const r = await request("/api/admin/orders", { admin: true, etag });
        if (!r.notModified) {
          etag = r.etag || "";
          cb(r.data.orders);
        }
        onError?.(null);
      } catch (err) {
        onError?.(err);
      }
      if (!stopped) timer = setTimeout(tick, document.hidden ? intervalMs * 3 : intervalMs);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  },
};

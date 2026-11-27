// Camada de dados.
//
// • Modo FIREBASE: ativado automaticamente quando existe `firebase-config.js`
//   na raiz (copie de `firebase-config.example.js`). Usa Auth + Firestore
//   (tempo real, com cache offline) + Storage.
// • Modo LOCAL: sem configuração. Tudo fica no navegador (localStorage), o que
//   serve para demonstração e testes em um único dispositivo. Abas diferentes
//   do mesmo navegador (loja + admin) se atualizam sozinhas.

import { DEFAULT_SETTINGS, DEFAULT_PRODUCTS, DEFAULT_ARTS } from "./defaults.js";
import { deepClone, downscaleImage, readFileAsDataURL, slugify, todayStamp } from "./utils.js";

const FIREBASE_VERSION = "10.12.2";

const LS = {
  settings: "studioSettings",
  products: "studioProducts",
  arts: "studioArts",
  fonts: "studioFonts",
  orders: "studioOrders",
  counter: "studioOrderCounter",
  auth: "studioAdminAuth",
  session: "studioAdminSession",
};

export const DEFAULT_LOCAL_ADMIN = { email: "admin@studio.local", password: "admin123" };

const nowIso = () => new Date().toISOString();
const clean = (obj) => JSON.parse(JSON.stringify(obj)); // remove undefined (Firestore não aceita)

function mergeSettings(saved) {
  const s = { ...deepClone(DEFAULT_SETTINGS), ...(saved || {}) };
  for (const key of ["modes", "payments", "pix", "contact"]) {
    s[key] = { ...DEFAULT_SETTINGS[key], ...(saved?.[key] || {}) };
  }
  return s;
}

const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.name).localeCompare(String(b.name));

async function hashPassword(value) {
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0x811c9dc5; // FNV-1a (contexto sem HTTPS)
  for (const ch of value) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv-${h.toString(16)}`;
}

/* ======================================================================== */
/*  Modo local                                                              */
/* ======================================================================== */

class LocalBackend {
  mode = "local";
  degraded = false;
  #orderListeners = new Set();
  #authListeners = new Set();

  async init() {
    window.addEventListener("storage", (e) => {
      if (e.key === LS.orders) this.#emitOrders();
    });
    return this;
  }

  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : deepClone(fallback);
    } catch {
      return deepClone(fallback);
    }
  }

  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      if (err?.name === "QuotaExceededError") {
        throw new Error(
          "O armazenamento local do navegador está cheio. Use imagens menores ou conecte o Firebase para armazenar na nuvem."
        );
      }
      throw err;
    }
  }

  /* ---------- Configurações ---------- */
  async getSettings() {
    return mergeSettings(this.read(LS.settings, {}));
  }
  async saveSettings(patch) {
    const next = { ...this.read(LS.settings, {}), ...clean(patch), updatedAt: nowIso() };
    this.write(LS.settings, next);
    return mergeSettings(next);
  }

  /* ---------- Produtos ---------- */
  async listProducts() {
    return this.read(LS.products, DEFAULT_PRODUCTS).sort(byOrder);
  }
  async saveProduct(product) {
    const list = await this.listProducts();
    const i = list.findIndex((p) => p.id === product.id);
    if (i >= 0) list[i] = clean(product);
    else list.push(clean(product));
    this.write(LS.products, list);
    return product;
  }
  async deleteProduct(id) {
    this.write(LS.products, (await this.listProducts()).filter((p) => p.id !== id));
  }

  /* ---------- Estampas ---------- */
  async listArts() {
    return this.read(LS.arts, DEFAULT_ARTS).sort(byOrder);
  }
  async saveArt(art) {
    const list = await this.listArts();
    const i = list.findIndex((a) => a.id === art.id);
    if (i >= 0) list[i] = clean(art);
    else list.push(clean(art));
    this.write(LS.arts, list);
    return art;
  }
  async deleteArt(id) {
    this.write(LS.arts, (await this.listArts()).filter((a) => a.id !== id));
  }

  /* ---------- Fontes da loja ---------- */
  async listCustomFonts() {
    return this.read(LS.fonts, []);
  }
  async saveFont(font) {
    const list = await this.listCustomFonts();
    const i = list.findIndex((f) => f.id === font.id);
    if (i >= 0) list[i] = clean(font);
    else list.push(clean(font));
    this.write(LS.fonts, list);
    return font;
  }
  async deleteFont(id) {
    this.write(LS.fonts, (await this.listCustomFonts()).filter((f) => f.id !== id));
  }

  /* ---------- Arquivos (data URL no modo local) ---------- */
  async uploadFile(file, { maxSize = 1600 } = {}) {
    const prepared = file.type.startsWith("image/") ? await downscaleImage(file, maxSize) : file;
    if (prepared.size > 2_500_000) {
      throw new Error("Arquivo muito grande para o modo local (máx. ~2,5 MB). Conecte o Firebase Storage.");
    }
    return readFileAsDataURL(prepared);
  }
  async deleteFile() {}

  /* ---------- Pedidos ---------- */
  async createOrder(data) {
    const settings = await this.getSettings();
    const ymd = todayStamp();
    const counters = this.read(LS.counter, {});
    const seq = (counters[ymd] || 1000) + 1;
    this.write(LS.counter, { [ymd]: seq });
    const numero = `${settings.orderPrefix || "PED"}-${ymd}-${seq}`;
    const order = clean({
      ...data,
      id: numero,
      numero_pedido: numero,
      codigo_curto: String(seq),
      notificacoes: { ...(data.notificacoes || {}), modo: "local" },
    });
    const orders = this.read(LS.orders, []);
    orders.unshift(order);
    this.write(LS.orders, orders);
    this.#emitOrders();
    return order;
  }

  #seedDemoOrders() {
    if (localStorage.getItem(LS.orders) !== null) return;
    const now = Date.now();
    const product = DEFAULT_PRODUCTS[1];
    const cup = DEFAULT_PRODUCTS[0];
    const render = (p) => ({
      type: p.type,
      mockups: p.mockups,
      printAreaCss: p.printAreaCss,
      printCm: p.printCm,
      physicalCm: p.physicalCm,
      tintable: true,
    });
    const demo = [
      {
        id: `${DEFAULT_SETTINGS.orderPrefix}-${todayStamp()}-0998`,
        numero_pedido: `${DEFAULT_SETTINGS.orderPrefix}-${todayStamp()}-0998`,
        codigo_curto: "0998",
        demo: true,
        modalidade: "EVENTO",
        cliente: { nome: "Cliente Demonstração", telefone: "11999990000", email: "demo@exemplo.com", endereco: null },
        itens: [
          {
            item_id: "demo-1",
            produto_id: product.id,
            produto_nome: product.name,
            cor: "#252936",
            tamanho: "M",
            acabamento: null,
            acabamento_label: null,
            quantidade: 1,
            valor_unitario: product.price,
            render: render(product),
            frente: {
              estampa_id: "art-17",
              estampa_nome: "Estampa 17 · Sol radiante",
              estampa_url: "img/estampas/estampa-17.svg",
              estampa_posicao_cm: { x: 0, y: -4 },
              estampa_dimensoes_cm: { largura: 18, altura: 18 },
              estampa_rotacao_graus: 0,
              estampa_proporcao: 1,
              texto: "VERÃO",
              texto_fonte: "Bebas Neue",
              texto_fonte_id: "g-bebas-neue",
              texto_fonte_origem: "google",
              texto_fonte_css: '"Bebas Neue", Impact, sans-serif',
              texto_cor: "#ffffff",
              texto_tamanho_cm: 6,
              texto_tamanho_pt: 170,
              texto_posicao_cm: { x: 0, y: 11 },
              texto_rotacao_graus: 0,
            },
            costas: null,
          },
        ],
        subtotal: product.price,
        taxa_entrega: 0,
        valor_total: product.price,
        metodo_pagamento: "PIX",
        status_pagamento: "PENDENTE",
        status_producao: "AGUARDANDO_PAGAMENTO",
        historico: [{ status: "AGUARDANDO_PAGAMENTO", em: new Date(now - 6 * 60000).toISOString() }],
        notificacoes: { modo: "local", email_enviado: false, mensagem_enviada: false },
        created_at: new Date(now - 6 * 60000).toISOString(),
        updated_at: new Date(now - 6 * 60000).toISOString(),
      },
      {
        id: `${DEFAULT_SETTINGS.orderPrefix}-${todayStamp()}-0999`,
        numero_pedido: `${DEFAULT_SETTINGS.orderPrefix}-${todayStamp()}-0999`,
        codigo_curto: "0999",
        demo: true,
        modalidade: "ENCOMENDA",
        cliente: {
          nome: "Maria Oliveira (demo)",
          telefone: "11999999999",
          email: "maria@email.com",
          endereco: {
            cep: "13010-000",
            rua: "Av. Francisco Glicério",
            numero: "1000",
            complemento: "Apto 42",
            bairro: "Centro",
            cidade: "Campinas",
            estado: "SP",
          },
        },
        itens: [
          {
            item_id: "demo-2",
            produto_id: cup.id,
            produto_nome: cup.name,
            cor: "#171a25",
            tamanho: "Único",
            acabamento: "gravacao",
            acabamento_label: "Gravação a Laser",
            quantidade: 1,
            valor_unitario: 89,
            render: render(cup),
            frente: {
              estampa_id: "art-41",
              estampa_nome: "Estampa 41 · Coroa",
              estampa_url: "img/estampas/estampa-41.svg",
              estampa_posicao_cm: { x: 0, y: -1.2 },
              estampa_dimensoes_cm: { largura: 4.5, altura: 4.5 },
              estampa_rotacao_graus: 0,
              estampa_proporcao: 1,
              texto: "MARIA",
              texto_fonte: "Cinzel",
              texto_fonte_id: "g-cinzel",
              texto_fonte_origem: "google",
              texto_fonte_css: '"Cinzel", Georgia, serif',
              texto_cor: "#ffffff",
              texto_tamanho_cm: 1.2,
              texto_tamanho_pt: 34,
              texto_posicao_cm: { x: 0, y: 2.6 },
              texto_rotacao_graus: 0,
            },
            costas: null,
          },
        ],
        subtotal: 89,
        taxa_entrega: 0,
        valor_total: 89,
        metodo_pagamento: "CREDITO",
        status_pagamento: "PAGO",
        status_producao: "EM_FILA",
        historico: [
          { status: "AGUARDANDO_PAGAMENTO", em: new Date(now - 30 * 60000).toISOString() },
          { status: "EM_FILA", em: new Date(now - 20 * 60000).toISOString() },
        ],
        notificacoes: { modo: "local", email_enviado: false, mensagem_enviada: false },
        created_at: new Date(now - 30 * 60000).toISOString(),
        updated_at: new Date(now - 20 * 60000).toISOString(),
      },
    ];
    this.write(LS.orders, demo);
  }

  #emitOrders() {
    const orders = this.read(LS.orders, []);
    this.#orderListeners.forEach((cb) => cb(orders));
  }

  subscribeOrders(cb) {
    this.#seedDemoOrders();
    this.#orderListeners.add(cb);
    cb(this.read(LS.orders, []));
    return () => this.#orderListeners.delete(cb);
  }

  async updateOrder(id, patch) {
    const orders = this.read(LS.orders, []);
    const i = orders.findIndex((o) => o.id === id);
    if (i < 0) throw new Error("Pedido não encontrado");
    orders[i] = { ...orders[i], ...clean(patch), updated_at: nowIso() };
    this.write(LS.orders, orders);
    this.#emitOrders();
    return orders[i];
  }

  async setOrderStatus(id, status, extra = {}) {
    const order = this.read(LS.orders, []).find((o) => o.id === id);
    if (!order) throw new Error("Pedido não encontrado");
    return this.updateOrder(id, {
      ...extra,
      status_producao: status,
      historico: [...(order.historico || []), { status, em: nowIso() }],
      notificacoes: {
        ...(order.notificacoes || {}),
        modo: "local",
        email_enviado: false,
        mensagem_enviada: false,
        ultimo_status_notificado: status,
        observacao: "Modo local: nenhuma mensagem foi enviada automaticamente.",
      },
    });
  }

  async requestNotification(id) {
    const order = this.read(LS.orders, []).find((o) => o.id === id);
    return this.updateOrder(id, {
      notificacoes: { ...(order?.notificacoes || {}), reenviar_solicitado_em: nowIso() },
    });
  }

  async deleteOrder(id) {
    this.write(LS.orders, this.read(LS.orders, []).filter((o) => o.id !== id));
    this.#emitOrders();
  }

  /* ---------- Autenticação (demonstração) ---------- */
  #session() {
    try {
      return JSON.parse(sessionStorage.getItem(LS.session) || "null");
    } catch {
      return null;
    }
  }
  #emitAuth() {
    const user = this.#session();
    this.#authListeners.forEach((cb) => cb(user));
  }
  onAuthChange(cb) {
    this.#authListeners.add(cb);
    cb(this.#session());
    return () => this.#authListeners.delete(cb);
  }
  async #credentials() {
    return this.read(LS.auth, null) || { email: DEFAULT_LOCAL_ADMIN.email, hash: await hashPassword(DEFAULT_LOCAL_ADMIN.password) };
  }
  async signIn(email, password) {
    const cred = await this.#credentials();
    if (String(email).trim().toLowerCase() !== cred.email || (await hashPassword(password)) !== cred.hash) {
      throw new Error("E-mail ou senha incorretos.");
    }
    sessionStorage.setItem(LS.session, JSON.stringify({ email: cred.email, uid: "local-admin" }));
    this.#emitAuth();
  }
  async signOut() {
    sessionStorage.removeItem(LS.session);
    this.#emitAuth();
  }
  async changeCredentials(email, password) {
    this.write(LS.auth, { email: String(email).trim().toLowerCase(), hash: await hashPassword(password) });
    sessionStorage.setItem(LS.session, JSON.stringify({ email: String(email).trim().toLowerCase(), uid: "local-admin" }));
    this.#emitAuth();
  }
  usesDefaultCredentials() {
    return !localStorage.getItem(LS.auth);
  }

  async importDefaults() {
    this.write(LS.products, DEFAULT_PRODUCTS);
    this.write(LS.arts, DEFAULT_ARTS);
  }
}

/* ======================================================================== */
/*  Firebase                                                                */
/* ======================================================================== */

class FirebaseBackend {
  mode = "firebase";
  degraded = false;

  async init(config) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const [appMod, fsMod, authMod, stMod] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-firestore.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-storage.js`),
    ]);
    this.f = fsMod;
    this.a = authMod;
    this.s = stMod;
    this.app = appMod.initializeApp(config);
    try {
      this.db = fsMod.initializeFirestore(this.app, {
        localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
      });
    } catch {
      this.db = fsMod.getFirestore(this.app);
    }
    this.auth = authMod.getAuth(this.app);
    this.storage = stMod.getStorage(this.app);
    return this;
  }

  #doc = (...path) => this.f.doc(this.db, ...path);
  #col = (name) => this.f.collection(this.db, name);

  async #list(name) {
    const snap = await this.f.getDocs(this.#col(name));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async #markInitialized() {
    await this.f.setDoc(this.#doc("settings", "store"), { catalogInitialized: true }, { merge: true });
  }

  /* ---------- Configurações ---------- */
  async getSettings() {
    const snap = await this.f.getDoc(this.#doc("settings", "store"));
    return mergeSettings(snap.exists() ? snap.data() : {});
  }
  async saveSettings(patch) {
    await this.f.setDoc(this.#doc("settings", "store"), { ...clean(patch), updatedAt: nowIso() }, { merge: true });
    return this.getSettings();
  }

  /* ---------- Catálogo ---------- */
  async listProducts() {
    return (await this.#list("products")).sort(byOrder);
  }
  async saveProduct(product) {
    await this.f.setDoc(this.#doc("products", product.id), clean(product));
    await this.#markInitialized();
    return product;
  }
  async deleteProduct(id) {
    await this.f.deleteDoc(this.#doc("products", id));
  }

  async listArts() {
    return (await this.#list("arts")).sort(byOrder);
  }
  async saveArt(art) {
    await this.f.setDoc(this.#doc("arts", art.id), clean(art));
    await this.#markInitialized();
    return art;
  }
  async deleteArt(id) {
    await this.f.deleteDoc(this.#doc("arts", id));
  }

  async listCustomFonts() {
    return this.#list("fonts");
  }
  async saveFont(font) {
    await this.f.setDoc(this.#doc("fonts", font.id), clean(font));
    return font;
  }
  async deleteFont(id) {
    await this.f.deleteDoc(this.#doc("fonts", id));
  }

  /* ---------- Storage ---------- */
  async uploadFile(file, { folder = "uploads", maxSize = 1600 } = {}) {
    const prepared = file.type.startsWith("image/") ? await downscaleImage(file, maxSize) : file;
    const name = `${Date.now()}-${slugify(prepared.name.replace(/\.\w+$/, ""))}${(prepared.name.match(/\.\w+$/) || [""])[0]}`;
    const ref = this.s.ref(this.storage, `${folder}/${name}`);
    await this.s.uploadBytes(ref, prepared, {
      contentType: prepared.type || "application/octet-stream",
      cacheControl: "public, max-age=31536000",
    });
    return this.s.getDownloadURL(ref);
  }
  /** Upload público (sem login) da logo enviada pelo cliente — limitado por storage.rules. */
  async uploadDataUrl(dataUrl, { folder = "customer-logos", name = "logo" } = {}) {
    const blob = await (await fetch(dataUrl)).blob();
    const ext = { "image/webp": ".webp", "image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg" }[blob.type] || "";
    const ref = this.s.ref(this.storage, `${folder}/${todayStamp()}/${Date.now()}-${slugify(name) || "logo"}${ext}`);
    await this.s.uploadBytes(ref, blob, { contentType: blob.type || "image/png" });
    return this.s.getDownloadURL(ref);
  }
  async deleteFile(url) {
    if (!url || !url.includes("firebasestorage")) return;
    try {
      await this.s.deleteObject(this.s.ref(this.storage, url));
    } catch (err) {
      console.warn("Arquivo não removido do Storage", err);
    }
  }

  /* ---------- Pedidos ---------- */
  async createOrder(data) {
    const settings = await this.getSettings().catch(() => DEFAULT_SETTINGS);
    const ymd = todayStamp();
    const counterRef = this.#doc("counters", `orders-${ymd}`);
    let numero;
    let seq;
    await this.f.runTransaction(this.db, async (tx) => {
      const snap = await tx.get(counterRef);
      seq = snap.exists() ? snap.data().seq + 1 : 1001;
      numero = `${settings.orderPrefix || "PED"}-${ymd}-${seq}`;
      tx.set(counterRef, { seq, updated_at: nowIso() });
      tx.set(
        this.#doc("orders", numero),
        clean({ ...data, numero_pedido: numero, codigo_curto: String(seq) })
      );
    });
    return { ...data, id: numero, numero_pedido: numero, codigo_curto: String(seq) };
  }

  subscribeOrders(cb, onError) {
    const q = this.f.query(this.#col("orders"), this.f.orderBy("created_at", "desc"), this.f.limit(300));
    return this.f.onSnapshot(
      q,
      (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error(err);
        onError?.(err);
      }
    );
  }

  async updateOrder(id, patch) {
    await this.f.updateDoc(this.#doc("orders", id), { ...clean(patch), updated_at: nowIso() });
  }

  async setOrderStatus(id, status, extra = {}) {
    await this.f.updateDoc(this.#doc("orders", id), {
      ...clean(extra),
      status_producao: status,
      updated_at: nowIso(),
      historico: this.f.arrayUnion({ status, em: nowIso() }),
    });
  }

  async requestNotification(id) {
    await this.f.updateDoc(this.#doc("orders", id), { "notificacoes.reenviar_solicitado_em": nowIso() });
  }

  async deleteOrder(id) {
    await this.f.deleteDoc(this.#doc("orders", id));
  }

  /* ---------- Autenticação ---------- */
  onAuthChange(cb) {
    return this.a.onAuthStateChanged(this.auth, async (user) => {
      if (!user) return cb(null);
      try {
        const isAdmin = (await this.f.getDoc(this.#doc("admins", user.uid))).exists();
        cb(isAdmin ? { email: user.email, uid: user.uid } : { email: user.email, uid: user.uid, notAdmin: true });
      } catch {
        cb({ email: user.email, uid: user.uid, notAdmin: true });
      }
    });
  }
  async signIn(email, password) {
    try {
      await this.a.signInWithEmailAndPassword(this.auth, String(email).trim(), password);
    } catch (err) {
      const map = {
        "auth/invalid-credential": "E-mail ou senha incorretos.",
        "auth/wrong-password": "E-mail ou senha incorretos.",
        "auth/user-not-found": "E-mail ou senha incorretos.",
        "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
        "auth/network-request-failed": "Sem conexão com a internet.",
      };
      throw new Error(map[err.code] || err.message);
    }
  }
  async signOut() {
    await this.a.signOut(this.auth);
  }
  async sendPasswordReset(email) {
    await this.a.sendPasswordResetEmail(this.auth, String(email).trim());
  }
  usesDefaultCredentials() {
    return false;
  }

  async importDefaults() {
    const batch = this.f.writeBatch(this.db);
    DEFAULT_PRODUCTS.forEach((p) => batch.set(this.#doc("products", p.id), clean(p)));
    DEFAULT_ARTS.forEach((a) => batch.set(this.#doc("arts", a.id), clean(a)));
    batch.set(this.#doc("settings", "store"), { catalogInitialized: true }, { merge: true });
    await batch.commit();
  }
}

/* ======================================================================== */

export async function createStore() {
  let config = null;
  try {
    const mod = await import(new URL("../firebase-config.js", import.meta.url).href);
    config = mod.firebaseConfig || mod.default || null;
  } catch {
    config = null; // arquivo não existe → modo local
  }
  const configured = config?.apiKey && config?.projectId && !/^SUA_|^YOUR_/.test(config.apiKey);
  if (configured) {
    try {
      return await new FirebaseBackend().init(config);
    } catch (err) {
      console.error("Firebase indisponível; usando modo local somente leitura.", err);
      const local = await new LocalBackend().init();
      local.degraded = true; // impede registrar pedidos fora do servidor
      return local;
    }
  }
  return new LocalBackend().init();
}

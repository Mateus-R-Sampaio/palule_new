// Testes de segurança e de regras de negócio da API (rodam contra um PostgreSQL real).
// Requer TEST_DATABASE_URL (padrão: banco local studio_test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://studio:studio_dev_pw@localhost:5432/studio_test";
process.env.NODE_ENV = "test";
process.env.ORDER_RATE_LIMIT = "1000";
process.env.LOGIN_RATE_LIMIT = "30";
process.env.PUBLIC_ORIGINS = "https://loja-teste.web.app";

const { pool } = await import("../src/db.js");
const { migrate } = await import("../src/migrate.js");
const { createApp } = await import("../src/app.js");
const { hashPassword } = await import("../src/auth.js");
const { storeFile } = await import("../src/files.js");

let server;
let base;
let cookie = "";
const ADMIN = { email: "seguranca@teste.com", password: "SenhaForte12345" };

async function call(path, { method = "GET", body, headers = {}, form, withCookie = false, origin } = {}) {
  const h = { "X-Requested-With": "studio", ...headers };
  if (origin !== null) h.Origin = origin || base;
  if (withCookie && cookie) h.Cookie = cookie;
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (form) payload = form;
  const res = await fetch(base + path, { method, headers: h, body: payload, redirect: "manual" });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate({ log: () => {} });
  // catálogo mínimo
  const mock = await storeFile({ buffer: await sharp({ create: { width: 200, height: 200, channels: 4, background: "#ffffffff" } }).png().toBuffer(), kind: "mockup" });
  const art = await storeFile({
    buffer: await sharp({ create: { width: 100, height: 100, channels: 4, background: "#ff0000ff" } }).png().toBuffer(),
    kind: "art",
  });
  await pool.query("INSERT INTO settings (id, data) VALUES (1, $1)", [JSON.stringify({ orderPrefix: "PED", deliveryFee: 15 })]);
  const config = (over = {}) =>
    JSON.stringify({
      description: "",
      type: "copo",
      allowsBack: false,
      tintable: true,
      mockups: { front: mock.url, back: null },
      printAreaCss: { front: { width: "40%", top: "50%", left: "50%" }, back: null },
      physicalCm: { width: 8, height: 16 },
      printCm: { width: 6, height: 9 },
      colors: ["#ffffff", "#000000"],
      sizes: ["Único"],
      customizationOptions: { finishTypes: [{ id: "adesivo", label: "Adesivo", extraPrice: 0 }, { id: "gravacao", label: "Gravação", extraPrice: 10 }] },
      ...over,
    });
  await pool.query("INSERT INTO products (id, name, price, active, config) VALUES ('copo', 'Copo', 79, true, $1)", [config()]);
  await pool.query("INSERT INTO products (id, name, price, active, config) VALUES ('velho', 'Inativo', 10, false, $1)", [config()]);
  await pool.query(
    "INSERT INTO products (id, name, price, active, config) VALUES ('camiseta', 'Camiseta', 69, true, $1)",
    [config({ allowsBack: true, sizes: ["P", "M", "G"], printCm: { width: 30, height: 40 }, customizationOptions: { finishTypes: [] }, printAreaCss: { front: { width: "34%", top: "50%", left: "50%" }, back: { width: "34%", top: "50%", left: "50%" } } })]
  );
  await pool.query("INSERT INTO arts (id, name, category, file_id) VALUES ('art-1', 'Quadrado', 'Formas', $1)", [art.id]);
  await pool.query("INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)", [ADMIN.email, await hashPassword(ADMIN.password)]);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await pool.end();
});

const cliente = { nome: "Maria Teste", telefone: "(11) 99999-9999", email: "Maria@Email.com" };
const item = (over = {}) => ({ produto_id: "copo", cor: "#000000", acabamento: "gravacao", quantidade: 2, frente: null, costas: null, ...over });
const order = (over = {}) => ({ modalidade: "EVENTO", cliente, metodo_pagamento: "PIX", itens: [item()], ...over });

/* ---------------- Pedidos: o servidor decide preço, número e status ---------------- */

test("preço e total são calculados pelo servidor (valores enviados pelo navegador são ignorados)", async () => {
  const r = await call("/api/public/orders", {
    method: "POST",
    body: order({ valor_total: 1, subtotal: 1, status_producao: "ENTREGUE", status_pagamento: "PAGO", itens: [item({ valor_unitario: 0.01 })] }),
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.valor_total, 178); // (79 + 10 gravação) × 2
  assert.equal(r.data.status_producao, "AGUARDANDO_PAGAMENTO");
  assert.equal(r.data.status_pagamento, "PENDENTE");
  assert.match(r.data.numero_pedido, /^PED-\d{8}-1001$/);
  const row = (await pool.query("SELECT valor_total, cliente_email, cliente_telefone FROM orders")).rows[0];
  assert.equal(row.valor_total, 178);
  assert.equal(row.cliente_email, "maria@email.com");
  assert.equal(row.cliente_telefone, "11999999999");
});

test("taxa de entrega vem do banco e exige endereço", async () => {
  const semEndereco = await call("/api/public/orders", { method: "POST", body: order({ modalidade: "ENCOMENDA" }) });
  assert.equal(semEndereco.status, 422);
  const endereco = { cep: "13010000", rua: "Rua A", numero: "10", bairro: "Centro", cidade: "Campinas", estado: "SP" };
  const r = await call("/api/public/orders", { method: "POST", body: order({ modalidade: "ENCOMENDA", cliente: { ...cliente, endereco } }) });
  assert.equal(r.status, 201);
  assert.equal(r.data.valor_total, 178 + 15);
});

test("bloqueia produto inexistente/inativo, cor, tamanho e acabamento fora do cadastro", async () => {
  for (const [bad, msg] of [
    [item({ produto_id: "velho" }), /indisponível/],
    [item({ produto_id: "nao-existe" }), /indisponível/],
    [item({ cor: "#123456" }), /cor/i],
    [item({ acabamento: "ouro" }), /acabamento/i],
    [item({ acabamento: null }), /acabamento/i],
    [item({ produto_id: "camiseta", acabamento: null, tamanho: "XGG" }), /tamanho/i],
  ]) {
    const r = await call("/api/public/orders", { method: "POST", body: order({ itens: [bad] }) });
    assert.equal(r.status, 422, JSON.stringify(r.data));
    assert.match(r.data.error, msg);
  }
});

test("bloqueia costas em produto sem costas, estampa maior que a área, estampa e fonte inexistentes", async () => {
  const back = await call("/api/public/orders", {
    method: "POST",
    body: order({ itens: [item({ costas: { text: { value: "Oi", fontId: "g-montserrat", color: "#000000", sizeCm: 1, x: 0, y: 0, rotation: 0 } } })] }),
  });
  assert.equal(back.status, 422);
  const big = await call("/api/public/orders", {
    method: "POST",
    body: order({ itens: [item({ frente: { art: { id: "art-1", widthCm: 20, x: 0, y: 0, rotation: 0 } } })] }),
  });
  assert.equal(big.status, 422);
  assert.match(big.data.error, /maior que a área/);
  const fora = await call("/api/public/orders", {
    method: "POST",
    body: order({ itens: [item({ frente: { art: { id: "art-1", widthCm: 3, x: 3, y: 0, rotation: 0 } } })] }),
  });
  assert.equal(fora.status, 422);
  const semArte = await call("/api/public/orders", {
    method: "POST",
    body: order({ itens: [item({ frente: { art: { id: "art-999", widthCm: 3, x: 0, y: 0, rotation: 0 } } })] }),
  });
  assert.equal(semArte.status, 422);
  const fonte = await call("/api/public/orders", {
    method: "POST",
    body: order({ itens: [item({ frente: { text: { value: "Oi", fontId: "fonte-hacker", color: "#000000", sizeCm: 1, x: 0, y: 0, rotation: 0 } } })] }),
  });
  assert.equal(fonte.status, 422);
  const ok = await call("/api/public/orders", {
    method: "POST",
    body: order({
      itens: [item({ frente: { art: { id: "art-1", widthCm: 4, x: 0, y: -1, rotation: 0 }, text: { value: "Maria", fontId: "g-cinzel", color: "#ffffff", sizeCm: 1, x: 0, y: 3, rotation: 0 } } })],
    }),
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const saved = (await pool.query("SELECT itens FROM orders WHERE numero = $1", [ok.data.numero_pedido])).rows[0].itens[0].frente;
  assert.equal(saved.estampa_nome, "Quadrado"); // nome vem do banco
  assert.equal(saved.texto_fonte, "Cinzel"); // fonte vem do catálogo do servidor
});

test("rejeita dados malformados, injeção e robôs", async () => {
  const sql = await call("/api/public/orders", { method: "POST", body: order({ itens: [item({ produto_id: "copo'; DROP TABLE orders;--" })] }) });
  assert.equal(sql.status, 400);
  const tel = await call("/api/public/orders", { method: "POST", body: order({ cliente: { ...cliente, telefone: "123" } }) });
  assert.equal(tel.status, 400);
  const email = await call("/api/public/orders", { method: "POST", body: order({ cliente: { ...cliente, email: "x" } }) });
  assert.equal(email.status, 400);
  const robo = await call("/api/public/orders", { method: "POST", body: order({ website: "http://spam" }) });
  assert.equal(robo.status, 400);
  const qtd = await call("/api/public/orders", { method: "POST", body: order({ itens: [item({ quantidade: 999 })] }) });
  assert.equal(qtd.status, 400);
  const xss = await call("/api/public/orders", { method: "POST", body: order({ cliente: { ...cliente, nome: "<img src=x onerror=alert(1)>" } }) });
  assert.equal(xss.status, 201); // texto é guardado como texto (o painel escapa ao exibir)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders")).rows[0].n > 0, true);
});

/* ---------------- Logo do cliente ---------------- */

test("logo: aceita só imagem real, exige o token do envio e não é pública", async () => {
  const fake = new FormData();
  fake.append("file", new Blob(["<?php echo 1; ?>"], { type: "image/png" }), "logo.png");
  assert.equal((await call("/api/public/uploads/customer-logo", { method: "POST", form: fake })).status, 400);

  const svg = new FormData();
  svg.append("file", new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: "image/svg+xml" }), "a.svg");
  assert.equal((await call("/api/public/uploads/customer-logo", { method: "POST", form: svg })).status, 400);

  const png = await sharp({ create: { width: 300, height: 100, channels: 4, background: "#0000ffff" } }).png().toBuffer();
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "logo.png");
  const up = await call("/api/public/uploads/customer-logo", { method: "POST", form });
  assert.equal(up.status, 201);
  assert.ok(up.data.token && up.data.fileId);

  const logo = (token) => ({ fileId: up.data.fileId, token, widthCm: 4, x: 0, y: 0, rotation: 0 });
  const roubo = await call("/api/public/orders", { method: "POST", body: order({ itens: [item({ frente: { logo: logo("A".repeat(43)) } })] }) });
  assert.equal(roubo.status, 422);
  const ok = await call("/api/public/orders", { method: "POST", body: order({ itens: [item({ frente: { logo: logo(up.data.token) } })] }) });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));

  assert.equal((await call(`/api/files/${up.data.fileId}`)).status, 404); // não é pública
});

/* ---------------- Painel: autenticação ---------------- */

test("rotas do painel exigem login e bloqueiam outras origens (CSRF)", async () => {
  assert.equal((await call("/api/admin/orders")).status, 401);
  assert.equal((await call("/api/admin/settings", { method: "PUT", body: { brandName: "x" } })).status, 401);
  const csrf = await call("/api/auth/login", { method: "POST", body: ADMIN, origin: "https://site-malicioso.com" });
  assert.equal(csrf.status, 403);
  const semHeader = await call("/api/auth/login", { method: "POST", body: ADMIN, headers: { "X-Requested-With": "" } });
  assert.equal(semHeader.status, 403);
});

test("login: senha errada é genérica e a conta bloqueia após 5 erros", async () => {
  const ghost = await call("/api/auth/login", { method: "POST", body: { email: "naoexiste@teste.com", password: "x" } });
  const wrong = await call("/api/auth/login", { method: "POST", body: { email: ADMIN.email, password: "errada" } });
  assert.equal(ghost.status, 401);
  assert.equal(wrong.data.error, ghost.data.error); // não revela se o e-mail existe
  for (let i = 0; i < 4; i++) await call("/api/auth/login", { method: "POST", body: { email: ADMIN.email, password: "errada" } });
  const locked = await call("/api/auth/login", { method: "POST", body: ADMIN });
  assert.equal(locked.status, 423);
  await pool.query("UPDATE admin_users SET locked_until = NULL, failed_attempts = 0");
});

test("login cria sessão segura; painel gerencia pedidos com regras", async () => {
  const r = await call("/api/auth/login", { method: "POST", body: ADMIN });
  assert.equal(r.status, 200);
  const setCookie = r.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  cookie = setCookie.split(";")[0];
  const stored = (await pool.query("SELECT token_hash FROM admin_sessions")).rows[0].token_hash;
  assert.notEqual(stored.toString(), cookie.split("=")[1]); // só o hash fica no banco

  const list = await call("/api/admin/orders", { withCookie: true });
  assert.equal(list.status, 200);
  const numero = list.data.orders.at(-1).numero_pedido;
  const pular = await call(`/api/admin/orders/${numero}/status`, { method: "PATCH", withCookie: true, body: { status: "ENTREGUE" } });
  assert.equal(pular.status, 409);
  const ok = await call(`/api/admin/orders/${numero}/status`, { method: "PATCH", withCookie: true, body: { status: "EM_FILA" } });
  assert.equal(ok.status, 200);
  const row = (await pool.query("SELECT status_producao, status_pagamento FROM orders WHERE numero = $1", [numero])).rows[0];
  assert.deepEqual(row, { status_producao: "EM_FILA", status_pagamento: "PAGO" });

  const logoOrder = list.data.orders.find((o) => o.itens[0].frente?.logo_url);
  assert.equal((await call(logoOrder.itens[0].frente.logo_url, { withCookie: true })).status, 200); // admin vê a logo

  const audit = (await pool.query("SELECT action FROM audit_log WHERE action = 'pedido_status'")).rowCount;
  assert.equal(audit, 1);
});

test("painel valida o que salva (preço, arquivos externos, configurações)", async () => {
  const p = await call("/api/admin/products/novo", {
    method: "PUT",
    withCookie: true,
    body: {
      name: "Novo", price: -5, active: true, allowsBack: false,
      mockups: { front: "https://site-malicioso.com/x.png" }, printAreaCss: { front: { width: "40%", top: "50%", left: "50%" } },
      printCm: { width: 5, height: 5 }, colors: ["#fff"], sizes: ["Único"],
    },
  });
  assert.equal(p.status, 400);
  const s = await call("/api/admin/settings", { method: "PUT", withCookie: true, body: { payments: { CREDITO: false, DEBITO: false, PIX: false, PAGAR_NA_RETIRADA: false } } });
  assert.equal(s.status, 400);
  const ok = await call("/api/admin/settings", { method: "PUT", withCookie: true, body: { brandName: "Palule", modes: { EVENTO: true, ENCOMENDA: false } } });
  assert.equal(ok.status, 200);
  const blocked = await call("/api/public/orders", {
    method: "POST",
    body: order({ modalidade: "ENCOMENDA", cliente: { ...cliente, endereco: { cep: "13010000", rua: "R", numero: "1", bairro: "B", cidade: "C", estado: "SP" } } }),
  });
  assert.equal(blocked.status, 422); // modalidade desativada no banco
});

test("trocar a senha derruba as outras sessões", async () => {
  const other = await call("/api/auth/login", { method: "POST", body: ADMIN });
  const otherCookie = other.headers.get("set-cookie").split(";")[0];
  const fraca = await call("/api/auth/password", { method: "POST", withCookie: true, body: { currentPassword: ADMIN.password, newPassword: "123" } });
  assert.equal(fraca.status, 400);
  const r = await call("/api/auth/password", { method: "POST", withCookie: true, body: { currentPassword: ADMIN.password, newPassword: "OutraSenhaForte987" } });
  assert.equal(r.status, 200);
  cookie = r.headers.get("set-cookie").split(";")[0];
  const old = await fetch(`${base}/api/admin/orders`, { headers: { Cookie: otherCookie } });
  assert.equal(old.status, 401);
  assert.equal((await call("/api/admin/orders", { withCookie: true })).status, 200);
});

test("atrás do Firebase Hosting: aceita o domínio público configurado e recusa os outros", async () => {
  const hosting = await call("/api/auth/login", { method: "POST", body: { email: "x@y.com", password: "z" }, origin: "https://loja-teste.web.app" });
  assert.equal(hosting.status, 401); // passou da proteção CSRF (só errou a senha)
  const outro = await call("/api/auth/login", { method: "POST", body: { email: "x@y.com", password: "z" }, origin: "https://loja-falsa.web.app" });
  assert.equal(outro.status, 403);
});

test("limite por IP barra força bruta no login", async () => {
  let last;
  for (let i = 0; i < 31; i++) last = await call("/api/auth/login", { method: "POST", body: { email: "x@y.com", password: "z" } });
  assert.equal(last.status, 429);
});

test("arquivos internos do servidor não são acessíveis pela web", async () => {
  for (const path of ["/server/.env", "/server/src/app.js", "/package.json", "/.git/config", "/js/../server/.env", "/%2e%2e/server/.env"]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 404, path);
  }
  const home = await fetch(base + "/");
  assert.match(home.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

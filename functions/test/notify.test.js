const { test } = require("node:test");
const assert = require("node:assert");
const { buildMessageText, buildEmail, phoneE164, statusLabel } = require("../notify");

const order = {
  numero_pedido: "PED-20261126-1042",
  codigo_curto: "1042",
  modalidade: "ENCOMENDA",
  status_producao: "PRONTO_PARA_RETIRADA",
  status_pagamento: "PAGO",
  metodo_pagamento: "PIX",
  valor_total: 89,
  cliente: { nome: "Maria", telefone: "11999999999", email: "maria@email.com", endereco: { rua: "Rua A", numero: "1", bairro: "Centro", cidade: "Campinas", estado: "SP", cep: "13010-000" } },
  itens: [{ produto_nome: "Copo térmico", quantidade: 1, valor_unitario: 89, acabamento_label: "Gravação a Laser", frente: { texto: "MARIA", texto_fonte: "Cinzel" } }],
};

test("mensagem segue o template do documento", () => {
  const text = buildMessageText(order);
  assert.match(text, /^Olá, Maria! Seu pedido \*#1042\* está com o status: \*Pronto para entrega\*\./);
});

test("e-mail tem assunto com código e status", () => {
  const { subject, html } = buildEmail(order);
  assert.strictEqual(subject, "Pedido #1042 — Status: Pronto para entrega");
  assert.match(html, /MARIA/);
  assert.match(html, /Campinas/);
});

test("telefone vira E.164", () => {
  assert.strictEqual(phoneE164("(11) 99999-9999"), "5511999999999");
  assert.strictEqual(phoneE164("5511999999999"), "5511999999999");
});

test("rótulo de status por modalidade", () => {
  assert.strictEqual(statusLabel("PRONTO_PARA_RETIRADA", "EVENTO"), "Pronto para retirada");
});

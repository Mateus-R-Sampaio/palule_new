// Esquemas de validação de TUDO que entra na API.
// Nenhum dado do navegador é gravado sem passar por aqui e pelas regras do banco.

import { z } from "zod";
import { UFS } from "../../js/utils.js";

const FILE_URL = /^\/api\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const text = (min, max, msg) =>
  z
    .string({ error: msg })
    .transform((s) => s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "").trim())
    .pipe(z.string().min(min, { error: msg }).max(max, { error: msg }));

const slug = (max = 60) => z.string().regex(new RegExp(`^[a-z0-9][a-z0-9-]{0,${max - 1}}$`), { error: "Identificador inválido" });
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: "Cor inválida" }).transform((s) => s.toLowerCase());
const pct = z.string().regex(/^(100|[0-9]{1,2})(\.[0-9]{1,2})?%$/, { error: "Percentual inválido" });
const money = z.number().finite().min(0).max(100000).transform((v) => Math.round(v * 100) / 100);
const cm = (min, max) => z.number().finite().min(min).max(max);
export const fileUrl = z.string().regex(FILE_URL, { error: "Arquivo inválido: envie pelo painel" });
const optionalFileUrl = z.union([fileUrl, z.literal(""), z.null()]).transform((v) => v || null);

/* ------------------------------------------------------------------ Admin */

export const loginInput = z.object({
  email: z.string().trim().toLowerCase().max(160),
  password: z.string().min(1).max(200),
});

export const passwordChangeInput = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z
      .string()
      .min(12, { error: "A nova senha precisa ter pelo menos 12 caracteres." })
      .max(200)
      .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), { error: "Use letras e números na nova senha." }),
  })
  .refine((d) => d.currentPassword !== d.newPassword, { error: "A nova senha deve ser diferente da atual.", path: ["newPassword"] });

const area = z.object({ width: pct, top: pct, left: pct, height: pct.optional() });

export const productInput = z.object({
  id: slug(60),
  name: text(2, 60, "Nome do produto deve ter de 2 a 60 caracteres"),
  description: text(0, 80, "Descrição muito longa").default(""),
  type: z.string().regex(/^[a-z0-9-]{0,40}$/).default(""),
  price: money,
  active: z.boolean(),
  order: z.number().int().min(0).max(100000).default(0),
  allowsBack: z.boolean(),
  tintable: z.boolean().default(true),
  mockups: z.object({ front: optionalFileUrl, back: optionalFileUrl.optional().default(null) }),
  printAreaCss: z.object({ front: area, back: area.nullable().optional().default(null) }),
  physicalCm: z.object({ width: cm(0, 1000).nullable(), height: cm(0, 1000).nullable() }).default({ width: null, height: null }),
  printCm: z.object({ width: cm(0.5, 500), height: cm(0.5, 500) }),
  colors: z.array(hex).min(1, { error: "Cadastre pelo menos uma cor" }).max(24),
  sizes: z.array(text(1, 12, "Tamanho inválido")).min(1).max(20),
  customizationOptions: z
    .object({
      finishTypes: z
        .array(
          z.object({
            id: slug(40),
            label: text(1, 40, "Nome do acabamento inválido"),
            extraPrice: money,
            description: text(0, 120, "Descrição do acabamento muito longa").default(""),
          })
        )
        .max(10)
        .default([]),
    })
    .default({ finishTypes: [] }),
});

export const artInput = z.object({
  name: text(1, 120, "Nome da estampa inválido"),
  category: text(1, 40, "Categoria inválida").default("Geral"),
  active: z.boolean().default(true),
  order: z.number().int().min(0).max(1e13).default(0),
});

export const artCreateInput = artInput.extend({ fileUrl });

export const fontCreateInput = z.object({
  family: z.string().trim().regex(/^[A-Za-zÀ-ÿ0-9 _-]{2,60}$/, { error: "Nome da fonte: 2 a 60 letras, números, espaço, _ ou -" }),
  category: z.enum(["sans", "serif", "display", "script", "hand", "mono", "retro"]),
  fileUrl,
});

export const settingsInput = z
  .object({
    brandName: text(1, 30, "Nome da marca: 1 a 30 caracteres"),
    brandSubtitle: text(0, 40, "Subtítulo muito longo"),
    logoUrl: optionalFileUrl.transform((v) => v || ""),
    primaryColor: hex,
    orderPrefix: z.string().regex(/^[A-Z0-9]{1,8}$/, { error: "Prefixo: até 8 letras/números maiúsculos" }),
    kioskMode: z.boolean(),
    kioskAutoResetSeconds: z.number().int().min(0).max(600),
    kioskInactivitySeconds: z.number().int().min(0).max(900),
    virtualKeyboard: z.boolean(),
    modes: z.object({ EVENTO: z.boolean(), ENCOMENDA: z.boolean() }),
    deliveryFee: money,
    payments: z.object({ CREDITO: z.boolean(), DEBITO: z.boolean(), PIX: z.boolean(), PAGAR_NA_RETIRADA: z.boolean() }),
    pix: z.object({
      key: text(0, 77, "Chave Pix inválida"),
      merchantName: text(0, 25, "Nome do recebedor: até 25 caracteres"),
      merchantCity: text(0, 15, "Cidade do recebedor: até 15 caracteres"),
    }),
    cardInstructions: text(0, 300, "Instruções muito longas"),
    contact: z.object({
      whatsapp: z.string().regex(/^[0-9()+\s-]{0,20}$/, { error: "WhatsApp inválido" }),
      email: z.union([z.literal(""), z.email({ error: "E-mail inválido" }).max(160)]),
    }),
    defaultFontId: z.string().max(100),
    disabledFonts: z.array(z.string().max(100)).max(400),
  })
  .partial()
  .refine((s) => !s.modes || s.modes.EVENTO || s.modes.ENCOMENDA, { error: "Ative pelo menos uma modalidade.", path: ["modes"] })
  .refine((s) => !s.payments || Object.values(s.payments).some(Boolean), {
    error: "Ative pelo menos um método de pagamento.",
    path: ["payments"],
  });

export const ORDER_STATUSES = ["AGUARDANDO_PAGAMENTO", "EM_FILA", "EM_PRODUCAO", "PRONTO_PARA_RETIRADA", "ENTREGUE"];

export const statusChangeInput = z.object({
  status: z.enum(ORDER_STATUSES),
  status_pagamento: z.enum(["PENDENTE", "PAGO", "CANCELADO"]).optional(),
});

export const paymentChangeInput = z.object({ status_pagamento: z.enum(["PENDENTE", "PAGO", "CANCELADO"]) });

/* ------------------------------------------------------------------ Pedido (cliente) */

const placement = {
  x: z.number().finite().min(-500).max(500),
  y: z.number().finite().min(-500).max(500),
  rotation: z.number().finite().min(0).max(360),
};

const sideInput = z
  .object({
    art: z.object({ id: slug(80), widthCm: cm(0.3, 500), ...placement }).nullable().optional(),
    logo: z
      .object({
        fileId: z.uuid(),
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, { error: "Logo inválida" }),
        widthCm: cm(0.3, 500),
        ...placement,
      })
      .nullable()
      .optional(),
    text: z
      .object({
        value: text(0, 24, "Texto personalizado: até 24 caracteres"),
        fontId: z.string().max(100),
        color: hex,
        sizeCm: cm(0.2, 500),
        bold: z.boolean().default(false),
        italic: z.boolean().default(false),
        ...placement,
      })
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();

export const orderInput = z.object({
  modalidade: z.enum(["EVENTO", "ENCOMENDA"], { error: "Escolha Evento ou Encomenda" }),
  cliente: z.object({
    nome: text(3, 120, "Informe o nome completo (3 a 120 caracteres)"),
    telefone: z
      .string()
      .transform((s) => s.replace(/\D/g, ""))
      .pipe(z.string().regex(/^[1-9][0-9]{9,10}$/, { error: "WhatsApp com DDD (10 ou 11 dígitos)" })),
    email: z.string().trim().toLowerCase().pipe(z.email({ error: "E-mail inválido" }).max(160)),
    endereco: z
      .object({
        cep: z
          .string()
          .transform((s) => s.replace(/\D/g, ""))
          .pipe(z.string().regex(/^[0-9]{8}$/, { error: "CEP com 8 dígitos" }))
          .transform((s) => `${s.slice(0, 5)}-${s.slice(5)}`),
        rua: text(1, 120, "Informe a rua"),
        numero: text(1, 10, "Informe o número"),
        complemento: text(0, 60, "Complemento muito longo").default(""),
        bairro: text(1, 80, "Informe o bairro"),
        cidade: text(1, 80, "Informe a cidade"),
        estado: z.enum(UFS, { error: "UF inválida" }),
      })
      .nullable()
      .optional(),
  }),
  metodo_pagamento: z.enum(["CREDITO", "DEBITO", "PIX", "PAGAR_NA_RETIRADA"], { error: "Método de pagamento inválido" }),
  origem: z.enum(["web", "totem"]).default("web"),
  itens: z
    .array(
      z.object({
        produto_id: slug(60),
        cor: hex,
        tamanho: z.string().trim().max(12).nullable().optional(),
        acabamento: slug(40).nullable().optional(),
        quantidade: z.number().int().min(1).max(50),
        frente: sideInput,
        costas: sideInput,
      })
    )
    .min(1, { error: "Carrinho vazio" })
    .max(50, { error: "Máximo de 50 itens por pedido" }),
  // armadilha para robôs: campo invisível que precisa vir vazio
  website: z.string().max(0).optional(),
});

/** Converte erros do zod em mensagens legíveis. */
export function formatZodError(err) {
  return err.issues.slice(0, 8).map((i) => ({ campo: i.path.join("."), mensagem: i.message }));
}

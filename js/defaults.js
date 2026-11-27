// Catálogo e configurações padrão.
// NÃO são o banco de dados: servem só como valores-base das configurações e como
// fonte do comando `npm run seed`, que importa este catálogo para o PostgreSQL.

export const DEFAULT_SETTINGS = {
  brandName: "Studio",
  brandSubtitle: "Personalizado",
  logoUrl: "",
  primaryColor: "#ff5a67",
  orderPrefix: "PED",

  // Totem / quiosque
  kioskMode: true,
  kioskAutoResetSeconds: 30,
  kioskInactivitySeconds: 45,
  virtualKeyboard: true,

  // Modalidades e entrega
  modes: { EVENTO: true, ENCOMENDA: true },
  deliveryFee: 0,

  // Pagamentos
  payments: { CREDITO: true, DEBITO: true, PIX: true, PAGAR_NA_RETIRADA: true },
  pix: { key: "", merchantName: "", merchantCity: "" },
  cardInstructions: "Pagamento na maquininha no balcão (evento) ou por link enviado pela loja (encomenda).",

  // Contato exibido nas mensagens
  contact: { whatsapp: "", email: "" },

  // Tipografia
  defaultFontId: "g-montserrat",
  disabledFonts: [],

  catalogInitialized: false,
  updatedAt: null,
};

const M = "img/Mockups";

export const DEFAULT_PRODUCTS = [
  {
    id: "copo",
    name: "Copo térmico",
    description: "473 ml · 8,5 × 16 cm",
    type: "copo",
    price: 79.0,
    active: true,
    order: 1,
    allowsBack: false,
    tintable: true,
    mockups: { front: `${M}/copo_termico/copo_termico.svg`, back: null },
    printAreaCss: { front: { width: "36%", height: "49.8%", top: "52%", left: "50%" }, back: null },
    physicalCm: { width: 8.5, height: 16 },
    printCm: { width: 6.5, height: 9 },
    colors: ["#e9eef7", "#171a25", "#dc8d7b", "#80a69a"],
    sizes: ["Único"],
    customizationOptions: {
      finishTypes: [
        { id: "adesivo", label: "Adesivo", extraPrice: 0, description: "Impressão colorida em vinil" },
        { id: "gravacao", label: "Gravação a Laser", extraPrice: 10, description: "Gravação permanente em tom metálico" },
      ],
    },
  },
  {
    id: "camiseta",
    name: "Camiseta premium",
    description: "Algodão · 50 × 70 cm",
    type: "camiseta",
    price: 69.0,
    active: true,
    order: 2,
    allowsBack: true,
    tintable: true,
    mockups: { front: `${M}/camiseta/camiseta_frente.svg`, back: `${M}/camiseta/camiseta_costas.svg` },
    printAreaCss: {
      front: { width: "34%", height: "45.3%", top: "52%", left: "50%" },
      back: { width: "34%", height: "45.3%", top: "50%", left: "50%" },
    },
    physicalCm: { width: 50, height: 70 },
    printCm: { width: 30, height: 40 },
    colors: ["#f5f5f2", "#252936", "#c9d8ea", "#d99b8e"],
    sizes: ["P", "M", "G", "GG"],
    customizationOptions: { finishTypes: [] },
  },
  {
    id: "ecobag",
    name: "Ecobag",
    description: "Lona resistente · 35 × 40 cm",
    type: "ecobag",
    price: 49.0,
    active: true,
    order: 3,
    allowsBack: false,
    tintable: true,
    mockups: { front: `${M}/ecobag/ecobag.svg`, back: null },
    printAreaCss: { front: { width: "46%", height: "49.3%", top: "64%", left: "50%" }, back: null },
    physicalCm: { width: 35, height: 40 },
    printCm: { width: 28, height: 30 },
    colors: ["#e4d7c4", "#b9c5a7", "#1f252c", "#d9aaa7"],
    sizes: ["Único"],
    customizationOptions: { finishTypes: [] },
  },
  {
    id: "bone",
    name: "Boné bordado",
    description: "Ajustável · 20 × 12 cm",
    type: "bone",
    price: 59.0,
    active: true,
    order: 4,
    allowsBack: false,
    tintable: true,
    mockups: { front: `${M}/bone/bone.svg`, back: null },
    printAreaCss: { front: { width: "30%", height: "15%", top: "45%", left: "50%" }, back: null },
    physicalCm: { width: 20, height: 12 },
    printCm: { width: 10, height: 5 },
    colors: ["#c3d7dd", "#2e343d", "#c9b58e", "#b9a9c8"],
    sizes: ["Único"],
    customizationOptions: { finishTypes: [] },
  },
];

const ART_META = {
  17: ["Natureza", "Sol radiante"], 18: ["Ícones", "Coração brilhante"], 19: ["Formas", "Estrela"],
  20: ["Natureza", "Montanhas"], 21: ["Ícones", "Ondas"], 22: ["Natureza", "Flor"],
  23: ["Ícones", "Raio"], 24: ["Natureza", "Lua e estrelas"], 25: ["Frases", "Good Vibes"],
  26: ["Ícones", "Sorriso"], 27: ["Natureza", "Pôr do sol tropical"], 28: ["Formas", "Triângulos"],
  29: ["Natureza", "Cacto"], 30: ["Frases", "Coffee time"], 31: ["Formas", "Sol retrô"],
  32: ["Ícones", "Arco-íris"], 33: ["Ícones", "Patinha"], 34: ["Natureza", "Folha"],
  35: ["Formas", "Diamante"], 36: ["Formas", "Colmeia"], 37: ["Frases", "Love"],
  38: ["Natureza", "Borboleta"], 39: ["Ícones", "Notas musicais"], 40: ["Ícones", "Planeta"],
  41: ["Ícones", "Coroa"], 42: ["Ícones", "Âncora"], 43: ["Frases", "Feito com amor"],
};

export const DEFAULT_ARTS = Object.entries(ART_META).map(([n, [category, title]], index) => ({
  id: `art-${n}`,
  name: `Estampa ${n} · ${title}`,
  category,
  url: `img/estampas/estampa-${n}.svg`,
  active: true,
  order: index,
  createdAt: "2026-11-26T20:00:00.000Z",
}));

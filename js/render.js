// Renderização do produto personalizado (editor, carrinho e painel admin).
//
// Toda a geometria é guardada em CENTÍMETROS relativos ao centro da área de
// impressão do produto (product.printCm). O mesmo dado produz exatamente a
// mesma prévia em qualquer tamanho de tela.
//
// Formato interno de um lado ("side"):
// {
//   art:  { id, name, url, x, y, widthCm, aspect, rotation, bounds:{x,y,w,h} } | null,
//   logo: { name, url, x, y, widthCm, aspect, rotation, bounds } | null   (logo enviada pelo cliente)
//   text: { value, fontId, family, stack, source, fontUrl, color, sizeCm, x, y, rotation, bold, italic }
// }

import { clamp, round } from "./utils.js";

export const SIDE_LABELS = { front: "Frente", back: "Costas" };
export const LINE_HEIGHT = 1.15;

export const getPrintCm = (product) => {
  const p = product?.printCm || {};
  return { width: Number(p.width) || 10, height: Number(p.height) || 10 };
};

export const getPrintAreaCss = (product, sideKey) => {
  const areas = product?.printAreaCss || {};
  return areas[sideKey] || areas.front || { width: "40%", top: "50%", left: "50%" };
};

export const getMockupUrl = (product, sideKey) => {
  const m = product?.mockups || {};
  return (sideKey === "back" ? m.back : m.front) || m.front || "";
};

export const sideHasContent = (side) => !!(side && (side.art || side.logo || side.text?.value?.trim()));

/** Tipos de elemento no palco: imagens (estampa/logo) usam widthCm; texto usa sizeCm. */
export const IMAGE_KINDS = ["art", "logo"];
export const isImageKind = (kind) => IMAGE_KINDS.includes(kind);

/* ---------------- Geometria ---------------- */

/** Meias-dimensões da caixa alinhada aos eixos de um retângulo rotacionado. */
export function aabbHalf(w, h, deg = 0) {
  const r = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return { hx: (w * c + h * s) / 2, hy: (w * s + h * c) / 2 };
}

/** Mantém o elemento (já rotacionado) inteiro dentro da área de impressão. */
export function clampPosition(x, y, w, h, rotation, pc) {
  const { hx, hy } = aabbHalf(w, h, rotation);
  const mx = Math.max(0, pc.width / 2 - hx);
  const my = Math.max(0, pc.height / 2 - hy);
  return { x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
}

/** Maior fator de escala (≤ ∞) que ainda cabe na área de impressão. */
export function fitScale(w, h, rotation, pc) {
  const { hx, hy } = aabbHalf(w, h, rotation);
  if (!hx || !hy) return Infinity;
  return Math.min(pc.width / 2 / hx, pc.height / 2 / hy);
}

let measureCtx;
export function measureTextCm(text) {
  if (!text?.value) return { width: 0, height: 0 };
  measureCtx ||= document.createElement("canvas").getContext("2d");
  measureCtx.font = `${text.italic ? "italic " : ""}${text.bold ? 700 : 400} 100px ${text.stack || "sans-serif"}`;
  const ratio = measureCtx.measureText(text.value).width / 100;
  return { width: ratio * text.sizeCm, height: text.sizeCm * LINE_HEIGHT };
}

export const artSizeCm = (art) => ({ width: art.widthCm, height: art.widthCm / (art.aspect || 1) });

export const designSizeCm = (kind, obj) => (isImageKind(kind) ? artSizeCm(obj) : measureTextCm(obj));

/** Garante que estampa/texto respeitam os limites físicos (tamanho e posição). */
export function constrainDesign(kind, obj, pc) {
  if (!obj) return obj;
  let size = designSizeCm(kind, obj);
  const scale = fitScale(size.width, size.height, obj.rotation, pc);
  if (scale < 1) {
    if (isImageKind(kind)) obj.widthCm = round(obj.widthCm * scale * 0.999, 3);
    else obj.sizeCm = round(obj.sizeCm * scale * 0.999, 3);
    size = designSizeCm(kind, obj);
  }
  const pos = clampPosition(obj.x, obj.y, size.width, size.height, obj.rotation, pc);
  obj.x = round(pos.x, 3);
  obj.y = round(pos.y, 3);
  return obj;
}

/* ---------------- Bounding box real da estampa ---------------- */

const boundsCache = new Map();

function loadImage(url, cors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors && !url.startsWith("data:") && !url.startsWith("blob:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Detecta a área visível (pixels não transparentes) da estampa, para que a
 * caixa de seleção e as medidas em cm correspondam ao desenho real.
 * Retorna { bounds:{x,y,w,h} (frações 0..1), aspect }.
 */
export function getArtVisibleBounds(url) {
  if (boundsCache.has(url)) return boundsCache.get(url);
  const promise = (async () => {
    let img;
    let canRead = true;
    try {
      img = await loadImage(url, true);
    } catch {
      canRead = false;
      try {
        img = await loadImage(url, false);
      } catch {
        return { bounds: { x: 0, y: 0, w: 1, h: 1 }, aspect: 1 };
      }
    }
    const natW = img.naturalWidth || 512;
    const natH = img.naturalHeight || 512;
    const full = { bounds: { x: 0, y: 0, w: 1, h: 1 }, aspect: natW / natH };
    if (!canRead) return full;
    try {
      const max = 320;
      const scale = Math.min(1, max / Math.max(natW, natH));
      const cw = Math.max(1, Math.round(natW * scale));
      const ch = Math.max(1, Math.round(natH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, cw, ch);
      const { data } = ctx.getImageData(0, 0, cw, ch);
      let minX = cw, minY = ch, maxX = -1, maxY = -1;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          if (data[(y * cw + x) * 4 + 3] > 12) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return full;
      const bounds = {
        x: minX / cw,
        y: minY / ch,
        w: (maxX - minX + 1) / cw,
        h: (maxY - minY + 1) / ch,
      };
      return { bounds, aspect: (bounds.w * natW) / (bounds.h * natH) };
    } catch {
      return full; // canvas "tainted" (imagem sem CORS)
    }
  })();
  boundsCache.set(url, promise);
  return promise;
}

/* ---------------- DOM ---------------- */

const el = (tag, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

const cssUrl = (url) => String(url).replace(/"/g, "%22");

export function applyArtStyle(node, art, pc) {
  node.style.left = `calc(50% + ${(art.x / pc.width) * 100}%)`;
  node.style.top = `calc(50% + ${(art.y / pc.height) * 100}%)`;
  node.style.width = `${(art.widthCm / pc.width) * 100}%`;
  node.style.aspectRatio = String(art.aspect || 1);
  node.style.transform = `translate(-50%, -50%) rotate(${art.rotation || 0}deg)`;
}

export function applyTextStyle(node, text, pc) {
  const label = node.querySelector(".design-text-label") || node;
  label.textContent = text.value;
  node.style.left = `calc(50% + ${(text.x / pc.width) * 100}%)`;
  node.style.top = `calc(50% + ${(text.y / pc.height) * 100}%)`;
  // 100cqw = largura da área de impressão (container query)
  node.style.fontSize = `calc(${(text.sizeCm / pc.width) * 100} * 1cqw)`;
  node.style.fontFamily = text.stack || "sans-serif";
  node.style.color = text.color || "#171a25";
  node.style.fontWeight = text.bold ? "700" : "400";
  node.style.fontStyle = text.italic ? "italic" : "normal";
  node.style.lineHeight = String(LINE_HEIGHT);
  node.style.transform = `translate(-50%, -50%) rotate(${text.rotation || 0}deg)`;
}

function addHandles(node) {
  for (const corner of ["nw", "ne", "sw", "se"]) {
    const h = el("span", `handle handle-${corner}`);
    h.dataset.handle = corner;
    h.setAttribute("aria-hidden", "true");
    node.append(h);
  }
  const rot = el("span", "rotation-handle");
  rot.dataset.handle = "rotate";
  rot.setAttribute("aria-hidden", "true");
  node.append(rot);
}

function buildArt(art, pc, interactive, kind = "art") {
  const node = el("div", `design design-art design-${kind}`);
  node.dataset.kind = kind;
  const crop = el("div", "art-crop");
  const img = el("img");
  img.src = art.url;
  img.alt = "";
  img.draggable = false;
  const b = art.bounds || { x: 0, y: 0, w: 1, h: 1 };
  img.style.width = `${100 / b.w}%`;
  img.style.height = `${100 / b.h}%`;
  img.style.left = `${(-b.x / b.w) * 100}%`;
  img.style.top = `${(-b.y / b.h) * 100}%`;
  crop.append(img);
  node.append(crop);
  if (interactive) {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute(
      "aria-label",
      `${kind === "logo" ? "Sua logo" : `Estampa ${art.name || ""}`}. Arraste para mover; use as setas do teclado para ajustar.`
    );
    addHandles(node);
  }
  applyArtStyle(node, art, pc);
  return node;
}

function buildText(text, pc, interactive) {
  const node = el("div", "design design-text");
  node.dataset.kind = "text";
  const label = el("span", "design-text-label");
  node.append(label);
  if (interactive) {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `Texto “${text.value}”. Arraste para mover; use as setas do teclado para ajustar.`);
    addHandles(node);
  }
  applyTextStyle(node, text, pc);
  return node;
}

/**
 * Monta a prévia de um lado do produto.
 * @returns {{ root: HTMLElement, area: HTMLElement, art: HTMLElement|null, logo: HTMLElement|null, text: HTMLElement|null }}
 */
export function buildStage({
  product,
  sideKey = "front",
  side = null,
  color = "#ffffff",
  finish = null,
  interactive = false,
  selected = null,
  showPrintArea = interactive,
}) {
  const root = el("div", "mockup-stage");
  if (interactive) root.classList.add("is-interactive");
  root.style.setProperty("--product-color", color || "#ffffff");

  const mockUrl = getMockupUrl(product, sideKey);
  if (mockUrl) {
    if (product?.tintable !== false) {
      const tint = el("div", "mockup-tint");
      const mask = `url("${cssUrl(mockUrl)}")`;
      tint.style.webkitMaskImage = mask;
      tint.style.maskImage = mask;
      root.append(tint);
      root.classList.add("is-tinted");
    }
    const img = el("img", "mockup-img");
    img.src = mockUrl;
    img.alt = "";
    img.draggable = false;
    img.decoding = "async";
    root.append(img);
  } else {
    root.append(el("div", "mockup-placeholder"));
  }

  const pc = getPrintCm(product);
  const area = el("div", "print-area");
  const pa = getPrintAreaCss(product, sideKey);
  area.style.left = pa.left || "50%";
  area.style.top = pa.top || "50%";
  area.style.width = pa.width || "40%";
  area.style.aspectRatio = `${pc.width} / ${pc.height}`;
  if (finish === "gravacao") area.classList.add("finish-engraved");
  if (showPrintArea) area.classList.add("show-guides");
  root.append(area);

  let artNode = null;
  let logoNode = null;
  let textNode = null;
  if (side?.art) {
    artNode = buildArt(side.art, pc, interactive, "art");
    if (selected === "art") artNode.classList.add("is-selected");
    area.append(artNode);
  }
  if (side?.logo) {
    logoNode = buildArt(side.logo, pc, interactive, "logo");
    if (selected === "logo") logoNode.classList.add("is-selected");
    area.append(logoNode);
  }
  if (side?.text?.value?.trim()) {
    textNode = buildText(side.text, pc, interactive);
    if (selected === "text") textNode.classList.add("is-selected");
    area.append(textNode);
  }
  return { root, area, art: artNode, logo: logoNode, text: textNode };
}

/* ---------------- Conversão para o formato do pedido ---------------- */

/** Lado interno → formato do documento `orders/{id}.itens[].frente|costas`. */
export function toOrderSide(side) {
  if (!sideHasContent(side)) return null;
  const out = {
    estampa_id: null,
    estampa_nome: null,
    estampa_url: null,
    estampa_posicao_cm: null,
    estampa_dimensoes_cm: null,
    estampa_rotacao_graus: null,
    estampa_recorte: null,
    estampa_proporcao: null,
    logo_url: null,
    logo_nome: null,
    logo_posicao_cm: null,
    logo_dimensoes_cm: null,
    logo_rotacao_graus: null,
    logo_recorte: null,
    logo_proporcao: null,
    texto: null,
    texto_fonte: null,
    texto_fonte_id: null,
    texto_fonte_origem: null,
    texto_fonte_css: null,
    texto_fonte_url: null,
    texto_cor: null,
    texto_negrito: false,
    texto_italico: false,
    texto_tamanho_cm: null,
    texto_tamanho_pt: null,
    texto_tamanho_px: null,
    texto_dimensoes_cm: null,
    texto_posicao_cm: null,
    texto_rotacao_graus: null,
  };
  if (side.art) {
    const a = side.art;
    const size = artSizeCm(a);
    Object.assign(out, {
      estampa_id: a.id,
      estampa_nome: a.name,
      estampa_url: a.url,
      estampa_posicao_cm: { x: round(a.x, 2), y: round(a.y, 2) },
      estampa_dimensoes_cm: { largura: round(size.width, 2), altura: round(size.height, 2) },
      estampa_rotacao_graus: round(a.rotation || 0, 1),
      estampa_recorte: a.bounds || { x: 0, y: 0, w: 1, h: 1 },
      estampa_proporcao: round(a.aspect || 1, 5),
    });
  }
  if (side.logo) {
    const l = side.logo;
    const size = artSizeCm(l);
    Object.assign(out, {
      logo_url: l.url,
      logo_nome: l.name || "logo",
      logo_posicao_cm: { x: round(l.x, 2), y: round(l.y, 2) },
      logo_dimensoes_cm: { largura: round(size.width, 2), altura: round(size.height, 2) },
      logo_rotacao_graus: round(l.rotation || 0, 1),
      logo_recorte: l.bounds || { x: 0, y: 0, w: 1, h: 1 },
      logo_proporcao: round(l.aspect || 1, 5),
    });
  }
  const t = side.text;
  if (t?.value?.trim()) {
    const dims = measureTextCm(t);
    Object.assign(out, {
      texto: t.value,
      texto_fonte: t.family,
      texto_fonte_id: t.fontId,
      texto_fonte_origem: t.source,
      texto_fonte_css: t.stack,
      texto_fonte_url: t.fontUrl || null,
      texto_cor: t.color,
      texto_negrito: !!t.bold,
      texto_italico: !!t.italic,
      texto_tamanho_cm: round(t.sizeCm, 2),
      texto_tamanho_pt: round((t.sizeCm / 2.54) * 72, 1),
      texto_tamanho_px: Math.round((t.sizeCm / 2.54) * 96),
      texto_dimensoes_cm: { largura: round(dims.width, 2), altura: round(dims.height, 2) },
      texto_posicao_cm: { x: round(t.x, 2), y: round(t.y, 2) },
      texto_rotacao_graus: round(t.rotation || 0, 1),
    });
  }
  return out;
}

/** Formato do pedido → lado interno (para renderizar a prévia no admin). */
export function fromOrderSide(o) {
  if (!o) return null;
  const art = o.estampa_url
    ? {
        id: o.estampa_id,
        name: o.estampa_nome,
        url: o.estampa_url,
        x: o.estampa_posicao_cm?.x || 0,
        y: o.estampa_posicao_cm?.y || 0,
        widthCm: o.estampa_dimensoes_cm?.largura || 1,
        aspect:
          o.estampa_proporcao ||
          (o.estampa_dimensoes_cm ? o.estampa_dimensoes_cm.largura / o.estampa_dimensoes_cm.altura : 1),
        rotation: o.estampa_rotacao_graus || 0,
        bounds: o.estampa_recorte || null,
      }
    : null;
  const logo = o.logo_url
    ? {
        name: o.logo_nome,
        url: o.logo_url,
        x: o.logo_posicao_cm?.x || 0,
        y: o.logo_posicao_cm?.y || 0,
        widthCm: o.logo_dimensoes_cm?.largura || 1,
        aspect: o.logo_proporcao || (o.logo_dimensoes_cm ? o.logo_dimensoes_cm.largura / o.logo_dimensoes_cm.altura : 1),
        rotation: o.logo_rotacao_graus || 0,
        bounds: o.logo_recorte || null,
      }
    : null;
  const text = o.texto
    ? {
        value: o.texto,
        fontId: o.texto_fonte_id,
        family: o.texto_fonte,
        stack: o.texto_fonte_css || `"${o.texto_fonte}", sans-serif`,
        source: o.texto_fonte_origem,
        fontUrl: o.texto_fonte_url,
        color: o.texto_cor,
        sizeCm: o.texto_tamanho_cm || 1,
        x: o.texto_posicao_cm?.x || 0,
        y: o.texto_posicao_cm?.y || 0,
        rotation: o.texto_rotacao_graus || 0,
        bold: !!o.texto_negrito,
        italic: !!o.texto_italico,
      }
    : null;
  return { art, logo, text };
}

/** Configuração mínima do produto guardada junto do item (prévia estável no admin). */
export function productRenderSnapshot(product) {
  return {
    type: product.type || product.id,
    mockups: { front: product.mockups?.front || "", back: product.mockups?.back || null },
    printAreaCss: product.printAreaCss || {},
    printCm: getPrintCm(product),
    physicalCm: product.physicalCm || null,
    tintable: product.tintable !== false,
  };
}

// Banco de tipografias para o texto personalizado.
//
// Fontes vindas de bancos diferentes, carregadas sob demanda:
//   • Google Fonts      — fonts.googleapis.com
//   • Fontshare (ITF)   — api.fontshare.com (fontes gratuitas da Indian Type Foundry)
//   • Bunny Fonts       — fonts.bunny.net (CDN europeia, compatível com LGPD/GDPR)
//   • Fontsource        — cdn.jsdelivr.net/npm/@fontsource/* (pacotes open-source)
//   • Sistema           — fontes instaladas no dispositivo (sem download)
//   • Fontes da loja    — arquivos .ttf/.otf/.woff/.woff2 enviados pelo admin
//
// Cada fonte tem um id estável (salvo no pedido) e só é baixada quando aparece na tela.

import { slugify } from "./utils.js";

export const FONT_SOURCES = {
  google: { label: "Google Fonts", short: "Google" },
  fontshare: { label: "Fontshare (ITF)", short: "Fontshare" },
  bunny: { label: "Bunny Fonts", short: "Bunny" },
  fontsource: { label: "Fontsource", short: "Fontsource" },
  system: { label: "Sistema", short: "Sistema" },
  custom: { label: "Fontes da loja", short: "Loja" },
};

export const FONT_CATEGORIES = {
  sans: "Sem serifa",
  serif: "Serifada",
  display: "Display / Impacto",
  script: "Caligrafia",
  hand: "Manuscrita",
  mono: "Monoespaçada",
  retro: "Retrô / Tech",
};

const FALLBACKS = {
  sans: "system-ui, sans-serif",
  serif: "Georgia, serif",
  display: "Impact, sans-serif",
  script: "cursive",
  hand: "cursive",
  mono: "ui-monospace, monospace",
  retro: "sans-serif",
};

const g = (family, category, weights) => ({ id: `g-${slugify(family)}`, family, source: "google", category, weights });
const fs = (family, slug, category, weights = [400, 700]) => ({ id: `fs-${slug}`, family, slug, source: "fontshare", category, weights });
const b = (family, category, weights = [400]) => ({ id: `b-${slugify(family)}`, family, slug: slugify(family), source: "bunny", category, weights });
const fsrc = (family, pkg, category, weights = [400]) => ({ id: `fsrc-${pkg}`, family, pkg, source: "fontsource", category, weights });
const sys = (family, stack, category) => ({ id: `sys-${slugify(family)}`, family, stack, source: "system", category });

export const FONT_CATALOG = [
  /* ---------------- Google Fonts: as 15 originais ---------------- */
  g("Montserrat", "sans", [400, 700]),
  g("Poppins", "sans", [400, 700]),
  g("Playfair Display", "serif", [400, 700]),
  g("Bebas Neue", "display"),
  g("Oswald", "display", [400, 700]),
  g("Roboto Slab", "serif", [400, 700]),
  g("Lobster", "display"),
  g("Pacifico", "script"),
  g("Dancing Script", "script", [400, 700]),
  g("Great Vibes", "script"),
  g("Permanent Marker", "hand"),
  g("Caveat", "hand", [400, 700]),
  g("Righteous", "display"),
  g("Anton", "display"),
  g("Abril Fatface", "display"),

  /* ---------------- Google Fonts: novas ---------------- */
  g("Raleway", "sans", [400, 700]),
  g("Nunito", "sans", [400, 800]),
  g("Quicksand", "sans", [400, 700]),
  g("Rubik", "sans", [400, 700]),
  g("Space Grotesk", "sans", [400, 700]),
  g("Outfit", "sans", [400, 800]),
  g("Lexend", "sans", [400, 700]),
  g("Comfortaa", "sans", [400, 700]),
  g("Fredoka", "sans", [400, 700]),
  g("Baloo 2", "sans", [400, 800]),
  g("Archivo Black", "sans"),
  g("Lora", "serif", [400, 700]),
  g("Merriweather", "serif", [400, 700]),
  g("Cormorant Garamond", "serif", [400, 700]),
  g("Libre Baskerville", "serif", [400, 700]),
  g("Cinzel", "serif", [400, 700]),
  g("DM Serif Display", "serif"),
  g("Alfa Slab One", "serif"),
  g("Ultra", "serif"),
  g("Bangers", "display"),
  g("Luckiest Guy", "display"),
  g("Titan One", "display"),
  g("Lilita One", "display"),
  g("Bowlby One", "display"),
  g("Russo One", "display"),
  g("Black Ops One", "display"),
  g("Bungee", "display"),
  g("Bungee Shade", "display"),
  g("Bungee Inline", "display"),
  g("Shrikhand", "display"),
  g("Creepster", "display"),
  g("Rye", "display"),
  g("Satisfy", "script"),
  g("Kaushan Script", "script"),
  g("Sacramento", "script"),
  g("Allura", "script"),
  g("Parisienne", "script"),
  g("Alex Brush", "script"),
  g("Yellowtail", "script"),
  g("Cookie", "script"),
  g("Courgette", "script"),
  g("Playball", "script"),
  g("Pinyon Script", "script"),
  g("Tangerine", "script", [400, 700]),
  g("Italianno", "script"),
  g("Mr Dafoe", "script"),
  g("Shadows Into Light", "hand"),
  g("Indie Flower", "hand"),
  g("Gloria Hallelujah", "hand"),
  g("Rock Salt", "hand"),
  g("Amatic SC", "hand", [400, 700]),
  g("Patrick Hand", "hand"),
  g("Architects Daughter", "hand"),
  g("Covered By Your Grace", "hand"),
  g("Reenie Beanie", "hand"),
  g("Space Mono", "mono", [400, 700]),
  g("JetBrains Mono", "mono", [400, 700]),
  g("Courier Prime", "mono", [400, 700]),
  g("Special Elite", "mono"),
  g("Press Start 2P", "retro"),
  g("Orbitron", "retro", [400, 800]),
  g("Audiowide", "retro"),
  g("VT323", "retro"),
  g("Monoton", "retro"),
  g("Faster One", "retro"),
  g("UnifrakturMaguntia", "retro"),
  g("Pirata One", "retro"),
  g("Metal Mania", "retro"),
  g("New Rocker", "retro"),
  g("Rubik Glitch", "retro"),

  /* ---------------- Fontshare (Indian Type Foundry) ---------------- */
  fs("Satoshi", "satoshi", "sans"),
  fs("General Sans", "general-sans", "sans"),
  fs("Cabinet Grotesk", "cabinet-grotesk", "sans"),
  fs("Switzer", "switzer", "sans"),
  fs("Supreme", "supreme", "sans"),
  fs("Author", "author", "sans"),
  fs("Clash Display", "clash-display", "display"),
  fs("Chillax", "chillax", "display"),
  fs("Tanker", "tanker", "display", [400]),
  fs("Panchang", "panchang", "display"),
  fs("Boska", "boska", "serif"),
  fs("Zodiak", "zodiak", "serif"),
  fs("Gambetta", "gambetta", "serif"),
  fs("Sentient", "sentient", "serif"),
  fs("Bespoke Serif", "bespoke-serif", "serif"),
  fs("Erode", "erode", "serif"),

  /* ---------------- Bunny Fonts ---------------- */
  b("Inter", "sans", [400, 700]),
  b("Josefin Sans", "sans", [400, 700]),
  b("Sora", "sans", [400, 700]),
  b("Fira Sans", "sans", [400, 700]),
  b("Barlow Condensed", "display", [400, 700]),
  b("Teko", "display", [400, 700]),
  b("Bitter", "serif", [400, 700]),
  b("Bree Serif", "serif"),
  b("Yeseva One", "serif"),
  b("Marck Script", "script"),
  b("Kalam", "hand", [400, 700]),
  b("Gochi Hand", "hand"),
  b("Exo 2", "retro", [400, 800]),
  b("Chakra Petch", "retro", [400, 700]),

  /* ---------------- Fontsource (jsDelivr) ---------------- */
  fsrc("Bricolage Grotesque", "bricolage-grotesque", "sans", [400, 700]),
  fsrc("Syne", "syne", "display", [400, 700]),
  fsrc("Unbounded", "unbounded", "display", [400, 700]),
  fsrc("Dela Gothic One", "dela-gothic-one", "display"),
  fsrc("Climate Crisis", "climate-crisis", "display"),
  fsrc("Gluten", "gluten", "display"),
  fsrc("Young Serif", "young-serif", "serif"),
  fsrc("Instrument Serif", "instrument-serif", "serif"),
  fsrc("Grandstander", "grandstander", "hand", [400, 700]),
  fsrc("Fira Code", "fira-code", "mono", [400, 700]),
  fsrc("Major Mono Display", "major-mono-display", "mono"),
  fsrc("Rubik Mono One", "rubik-mono-one", "retro"),
  fsrc("Silkscreen", "silkscreen", "retro"),

  /* ---------------- Sistema ---------------- */
  sys("Arial", "Arial, Helvetica, sans-serif", "sans"),
  sys("Verdana", "Verdana, Geneva, sans-serif", "sans"),
  sys("Trebuchet MS", "'Trebuchet MS', sans-serif", "sans"),
  sys("Georgia", "Georgia, serif", "serif"),
  sys("Times New Roman", "'Times New Roman', Times, serif", "serif"),
  sys("Impact", "Impact, 'Arial Black', sans-serif", "display"),
  sys("Comic Sans MS", "'Comic Sans MS', 'Comic Sans', cursive", "hand"),
  sys("Brush Script MT", "'Brush Script MT', cursive", "script"),
  sys("Courier New", "'Courier New', Courier, monospace", "mono"),
];

/** Converte um documento de fonte enviada pelo admin para o formato do catálogo. */
export function customFontToEntry(doc) {
  return {
    id: doc.id,
    family: doc.family,
    url: doc.url,
    source: "custom",
    category: doc.category || "display",
    active: doc.active !== false,
  };
}

/** Lista de fontes disponíveis para o cliente (catálogo − desativadas + fontes da loja). */
export function getAvailableFonts(settings = {}, customFonts = []) {
  const disabled = new Set(settings.disabledFonts || []);
  const custom = customFonts.map(customFontToEntry).filter((f) => f.active);
  return [...custom, ...FONT_CATALOG.filter((f) => !disabled.has(f.id))];
}

export function findFont(id, list = FONT_CATALOG) {
  return list.find((f) => f.id === id) || list.find((f) => f.id === "g-montserrat") || list[0] || FONT_CATALOG[0];
}

export function fontStack(font) {
  if (!font) return "sans-serif";
  if (font.source === "system") return font.stack;
  return `"${font.family}", ${FALLBACKS[font.category] || "sans-serif"}`;
}

/* ---------------- Carregamento sob demanda ---------------- */

const loading = new Map();

function injectStylesheet(href) {
  return new Promise((resolve) => {
    const existing = document.querySelector(`link[data-font-href="${CSS.escape(href)}"]`);
    if (existing) return resolve(true);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.crossOrigin = "anonymous";
    link.dataset.fontHref = href;
    link.onload = () => resolve(true);
    link.onerror = () => resolve(false);
    document.head.append(link);
  });
}

export function fontCssUrls(font) {
  const weights = font.weights?.length ? font.weights : [400];
  switch (font.source) {
    case "google": {
      const family = encodeURIComponent(font.family).replace(/%20/g, "+");
      const axis = font.weights?.length ? `:wght@${weights.join(";")}` : "";
      return [`https://fonts.googleapis.com/css2?family=${family}${axis}&display=swap`];
    }
    case "fontshare":
      return [`https://api.fontshare.com/v2/css?f[]=${font.slug}@${weights.join(",")}&display=swap`];
    case "bunny":
      return [`https://fonts.bunny.net/css?family=${font.slug}:${weights.join(",")}&display=swap`];
    case "fontsource":
      return weights.map((w) =>
        w === 400
          ? `https://cdn.jsdelivr.net/npm/@fontsource/${font.pkg}@5/index.css`
          : `https://cdn.jsdelivr.net/npm/@fontsource/${font.pkg}@5/${w}.css`
      );
    default:
      return [];
  }
}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(false), ms))]);

/**
 * Baixa a fonte (uma única vez) e resolve quando ela estiver pronta para uso.
 * Nunca rejeita: em caso de falha, o navegador usa a fonte de fallback.
 */
export function loadFont(font) {
  if (!font || font.source === "system") return Promise.resolve(true);
  if (loading.has(font.id)) return loading.get(font.id);

  let promise;
  if (font.source === "custom") {
    promise = (async () => {
      try {
        if ([...document.fonts].some((f) => f.family.replace(/"/g, "") === font.family)) return true;
        const face = new FontFace(font.family, `url("${font.url}")`, { display: "swap" });
        await face.load();
        document.fonts.add(face);
        return true;
      } catch (err) {
        console.warn("Fonte da loja não carregou:", font.family, err);
        return false;
      }
    })();
  } else {
    promise = (async () => {
      const ok = (await Promise.all(fontCssUrls(font).map(injectStylesheet))).every(Boolean);
      if (!ok) return false;
      try {
        await withTimeout(document.fonts.load(`400 32px "${font.family}"`), 5000);
        return document.fonts.check(`400 32px "${font.family}"`);
      } catch {
        return false;
      }
    })();
  }
  loading.set(font.id, promise);
  return promise;
}

/** Carrega a fonte de um texto salvo (pedido/carrinho), mesmo que não esteja mais no catálogo. */
export function loadFontForText(text, available = FONT_CATALOG) {
  if (!text) return Promise.resolve(true);
  const font = available.find((f) => f.id === text.fontId) || FONT_CATALOG.find((f) => f.id === text.fontId);
  if (font) return loadFont(font);
  if (text.fontUrl) return loadFont({ id: text.fontId || text.family, family: text.family, url: text.fontUrl, source: "custom" });
  return Promise.resolve(false);
}

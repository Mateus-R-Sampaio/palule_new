// Service Worker — Studio Personalizado
// • Arquivos do site: network-first (sempre tenta a versão nova; usa o cache offline).
// • Fontes, bibliotecas e SDK do Firebase (CDNs): cache-first.
// • Firestore/Storage/Auth e APIs externas: nunca passam pelo cache.

const VERSION = "studio-personalizado-v2";
const SHELL = [
  "./",
  "index.html",
  "admin.html",
  "styles.css",
  "admin.css",
  "manifest.json",
  "icon.svg",
  "js/app.js",
  "js/admin.js",
  "js/store.js",
  "js/render.js",
  "js/fonts.js",
  "js/utils.js",
  "js/defaults.js",
  "js/pix.js",
  "js/keyboard.js",
  "js/vendor/qrcode.js",
  "img/Mockups/copo_termico/copo_termico.svg",
  "img/Mockups/camiseta/camiseta_frente.svg",
  "img/Mockups/camiseta/camiseta_costas.svg",
  "img/Mockups/ecobag/ecobag.svg",
  "img/Mockups/bone/bone.svg",
];

const CDN_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "api.fontshare.com",
  "cdn.fontshare.com",
  "fonts.bunny.net",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "www.gstatic.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== `${VERSION}-cdn`).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith("/firebase-config.js")) return; // sempre da rede
    event.respondWith(networkFirst(request));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === "navigate") return (await cache.match("index.html")) || Response.error();
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(`${VERSION}-cdn`);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

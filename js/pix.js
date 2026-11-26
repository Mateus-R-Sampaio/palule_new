// Pix "copia e cola" (BR Code / EMV estático) + QR Code em SVG.
// Especificação: Manual de Padrões para Iniciação do Pix (Banco Central do Brasil).

// qrcode-generator 1.4.4 (MIT, Kazuhiko Arase) embutido em js/vendor para funcionar offline no totem.
const QR_SOURCES = [
  new URL("./vendor/qrcode.js", import.meta.url).href,
  "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js",
];

const tlv = (id, value) => {
  const v = String(value);
  return `${id}${String(v.length).padStart(2, "0")}${v}`;
};

const sanitize = (s, max) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .toUpperCase()
    .slice(0, max);

function crc16(payload) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildPixPayload({ key, name, city, amount, txid, description }) {
  if (!key) return "";
  const account =
    tlv("00", "br.gov.bcb.pix") +
    tlv("01", String(key).trim()) +
    (description ? tlv("02", sanitize(description, 40)) : "");
  let payload =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("26", account) +
    tlv("52", "0000") +
    tlv("53", "986") +
    (amount > 0 ? tlv("54", Number(amount).toFixed(2)) : "") +
    tlv("58", "BR") +
    tlv("59", sanitize(name, 25) || "LOJA") +
    tlv("60", sanitize(city, 15) || "BRASIL") +
    tlv("62", tlv("05", String(txid || "***").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***"));
  payload += "6304";
  return payload + crc16(payload);
}

let libPromise;
function loadQrLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  const load = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error("qrcode ausente")));
      s.onerror = reject;
      document.head.append(s);
    });
  libPromise ||= QR_SOURCES.reduce((p, src) => p.catch(() => load(src)), Promise.reject(new Error("init")));
  return libPromise;
}

/** Retorna um <svg> (string) com o QR Code do texto informado. */
export async function renderQrSvg(text, { size = 220, margin = 4 } = {}) {
  const qrcode = await loadQrLib();
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const total = count + margin * 2;
  let path = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code Pix"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

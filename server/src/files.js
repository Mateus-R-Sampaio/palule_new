// Upload e entrega de arquivos guardados no banco.
// • O tipo é detectado pelos BYTES do arquivo (não pela extensão nem pelo navegador).
// • Imagens raster são decodificadas e regravadas (remove metadados e conteúdo escondido).
// • SVG só é aceito do admin, sem scripts/eventos/links externos, e é servido com CSP "sandbox".
// • Logos de clientes só podem ser vistas por administradores.

import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { query, one } from "./db.js";
import { sha256 } from "./auth.js";

export class FileError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const fileUrlFor = (id) => `/api/files/${id}`;
export const fileIdFromUrl = (url) => {
  const m = String(url || "").match(/^\/api\/files\/([0-9a-f-]{36})$/);
  return m && UUID.test(m[1]) ? m[1] : null;
};

const IMAGE_LIMITS = { mockup: 2000, art: 2000, brand: 800, customer_logo: 2000 };

const SVG_FORBIDDEN = [
  /<script/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /<foreignObject/i,
  /<!ENTITY/i,
  /<!DOCTYPE/i,
  /<iframe|<embed|<object/i,
  /(?:href|xlink:href)\s*=\s*["']\s*(?!#)/i, // só referências internas (#id)
  /url\(\s*["']?\s*(?!#)/i,
  /@import/i,
];

function checkSvg(buffer) {
  const text = buffer.toString("utf8");
  if (!/<svg[\s>]/i.test(text.slice(0, 2000))) throw new FileError("SVG inválido.");
  if (SVG_FORBIDDEN.some((re) => re.test(text))) {
    throw new FileError("SVG com conteúdo não permitido (scripts, eventos ou links externos). Exporte o SVG novamente ou use PNG.");
  }
  return text;
}

/** Área visível (pixels não transparentes), em frações 0..1 — mesmo algoritmo do navegador. */
async function visibleBounds(buffer) {
  try {
    const { data, info } = await sharp(buffer, { density: 72 })
      .ensureAlpha()
      .resize(320, 320, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels } = info;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * channels + channels - 1] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { x: 0, y: 0, w: 1, h: 1 };
    const r = (v) => Math.round(v * 10000) / 10000;
    return { x: r(minX / w), y: r(minY / h), w: r((maxX - minX + 1) / w), h: r((maxY - minY + 1) / h) };
  } catch {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
}

async function processImage(buffer, kind) {
  const detected = await fileTypeFromBuffer(buffer);
  const isSvg = !detected && /<svg[\s>]/i.test(buffer.subarray(0, 2000).toString("utf8"));

  if (isSvg) {
    if (kind === "customer_logo") throw new FileError("Envie a logo em PNG, JPG ou WebP.");
    checkSvg(buffer);
    const meta = await sharp(buffer).metadata().catch(() => null);
    if (!meta) throw new FileError("Não foi possível ler este SVG.");
    return {
      data: buffer,
      contentType: "image/svg+xml",
      width: meta.width || null,
      height: meta.height || null,
      bounds: await visibleBounds(buffer),
    };
  }

  if (!detected || !["image/png", "image/jpeg", "image/webp"].includes(detected.mime)) {
    throw new FileError("Formato não suportado. Use PNG, JPG ou WebP.");
  }
  const max = IMAGE_LIMITS[kind] || 2000;
  let pipeline = sharp(buffer, { limitInputPixels: 50_000_000, failOn: "error" }).rotate(); // corrige orientação EXIF
  const meta = await pipeline.metadata().catch(() => null);
  if (!meta?.width) throw new FileError("Imagem corrompida ou inválida.");
  pipeline = pipeline.resize(max, max, { fit: "inside", withoutEnlargement: true });
  const out =
    detected.mime === "image/jpeg"
      ? await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true })
      : await pipeline.webp({ quality: 92, alphaQuality: 100 }).toBuffer({ resolveWithObject: true });
  return {
    data: out.data,
    contentType: detected.mime === "image/jpeg" ? "image/jpeg" : "image/webp",
    width: out.info.width,
    height: out.info.height,
    bounds: await visibleBounds(out.data),
  };
}

async function processFont(buffer) {
  const detected = await fileTypeFromBuffer(buffer);
  const map = { "font/woff2": "font/woff2", "font/woff": "font/woff", "font/ttf": "font/ttf", "font/otf": "font/otf" };
  if (!detected || !map[detected.mime]) throw new FileError("Arquivo de fonte inválido. Use WOFF2, WOFF, TTF ou OTF.");
  if (buffer.length > 5 * 1024 * 1024) throw new FileError("Fonte muito grande (máx. 5 MB).");
  return { data: buffer, contentType: map[detected.mime], width: null, height: null, bounds: null };
}

/**
 * Valida, processa e grava um arquivo.
 * @returns {{ id, url, token?, bounds, width, height, contentType }}
 */
export async function storeFile({ buffer, kind, originalName, withToken = false }, client = null) {
  if (!buffer?.length) throw new FileError("Arquivo vazio.");
  if (buffer.length > 10 * 1024 * 1024) throw new FileError("Arquivo muito grande (máx. 10 MB).", 413);
  const processed = kind === "font" ? await processFont(buffer) : await processImage(buffer, kind);
  const token = withToken ? randomBytes(32).toString("base64url") : null;
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `INSERT INTO files (kind, content_type, size_bytes, sha256, data, original_name, width, height, bounds, upload_token_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      kind,
      processed.contentType,
      processed.data.length,
      createHash("sha256").update(processed.data).digest(),
      processed.data,
      String(originalName || "").replace(/[^\w.\- À-ÿ]/g, "").slice(0, 200) || null,
      processed.width,
      processed.height,
      processed.bounds,
      token ? sha256(token) : null,
    ]
  );
  const id = rows[0].id;
  return { id, url: fileUrlFor(id), token, bounds: processed.bounds, width: processed.width, height: processed.height, contentType: processed.contentType };
}

export async function getFileMeta(id) {
  if (!UUID.test(String(id))) return null;
  return one("SELECT id, kind, content_type, width, height, bounds, upload_token_hash, created_at FROM files WHERE id = $1", [id]);
}

/** GET /api/files/:id */
export function serveFile(isAdminRequest) {
  return async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID.test(id)) return res.status(404).end();
      const file = await one("SELECT kind, content_type, size_bytes, sha256, data FROM files WHERE id = $1", [id]);
      if (!file) return res.status(404).end();
      if (file.kind === "customer_logo" && !(await isAdminRequest(req))) return res.status(404).end();

      const etag = `"${file.sha256.toString("hex").slice(0, 32)}"`;
      res.setHeader("ETag", etag);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", file.content_type);
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      if (file.kind === "customer_logo") {
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("Content-Disposition", `inline; filename="logo-cliente-${id.slice(0, 8)}.${file.content_type.split("/")[1]}"`);
      } else {
        // Conteúdo de um id nunca muda: cache longo e público
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Access-Control-Allow-Origin", "*");
      }
      if (req.get("if-none-match") === etag) return res.status(304).end();
      res.setHeader("Content-Length", file.size_bytes);
      res.end(file.data);
    } catch (err) {
      next(err);
    }
  };
}

/** Remove logos de clientes enviadas e nunca usadas em pedido (após 48 h). */
export async function cleanupOrphanLogos() {
  const { rowCount } = await query(
    `DELETE FROM files f
      WHERE f.kind = 'customer_logo'
        AND f.created_at < now() - interval '48 hours'
        AND NOT EXISTS (SELECT 1 FROM order_files o WHERE o.file_id = f.id)`
  );
  return rowCount;
}

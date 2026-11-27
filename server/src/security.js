// Cabeçalhos de segurança, CORS, proteção CSRF e limites de requisição.

import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";

const FONT_CSS_HOSTS = ["https://fonts.googleapis.com", "https://api.fontshare.com", "https://fonts.bunny.net", "https://cdn.jsdelivr.net"];
const FONT_FILE_HOSTS = ["https://fonts.gstatic.com", "https://cdn.fontshare.com", "https://fonts.bunny.net", "https://cdn.jsdelivr.net"];

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", ...FONT_CSS_HOSTS], // estilos inline usados nas prévias (cores/posições)
      fontSrc: ["'self'", "data:", ...FONT_FILE_HOSTS],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://viacep.com.br"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
});

export function permissionsPolicy(_req, res, next) {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  next();
}

const ownOrigin = (req) => `${req.protocol}://${req.get("host")}`;
export const isOwnOrigin = (req, origin) => !!origin && (origin === ownOrigin(req) || config.publicOrigins.includes(origin));
/** Endereço público do site (para montar links absolutos de imagens). */
export const publicBase = (req) => config.publicOrigins[0] || ownOrigin(req);

/**
 * CORS só para a API pública da loja (catálogo, pedido, upload de logo) e somente
 * para as origens listadas em ALLOWED_ORIGINS. Nunca envia credenciais.
 */
export function publicCors(req, res, next) {
  const origin = req.get("origin");
  if (origin && !isOwnOrigin(req, origin) && config.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

/**
 * Proteção CSRF para rotas com sessão (painel): além do cookie SameSite=Strict,
 * toda requisição que altera dados precisa vir da própria origem e trazer um
 * cabeçalho customizado (que formulários de outros sites não conseguem enviar).
 */
export function requireSameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  const sameOrigin = origin ? isOwnOrigin(req, origin) : fetchSite === "same-origin";
  if (!sameOrigin || req.get("x-requested-with") !== "studio") {
    return res.status(403).json({ error: "Requisição bloqueada (origem não autorizada)." });
  }
  next();
}

const limiter = (windowMinutes, limit, message) =>
  rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: message },
  });

export const apiLimiter = limiter(1, 300, "Muitas requisições. Aguarde um minuto.");
export const loginLimiter = limiter(15, config.loginRateLimit, "Muitas tentativas de login. Aguarde 15 minutos.");
export const orderLimiter = limiter(15, config.orderRateLimit, "Muitos pedidos deste endereço. Aguarde alguns minutos.");
export const uploadLimiter = limiter(15, 40, "Muitos envios de imagem. Aguarde alguns minutos.");
export const adminUploadLimiter = limiter(15, 300, "Muitos envios. Aguarde alguns minutos.");

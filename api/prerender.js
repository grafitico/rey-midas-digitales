// Prerender para bots/crawlers (WhatsApp, Facebook, Google, etc.).
// El middleware de Edge enruta solo a los bots hacia acá; los humanos reciben
// el SPA estático normal. Acá inyectamos <title>, meta tags, canonical y
// JSON-LD en el index.html según la ruta, para que los previews y el SEO
// funcionen aunque el contenido se pinte con JS en el cliente.
import { readFileSync } from "fs";
import { join } from "path";

const BASE = "https://reymidascr.com";

// ---- Precios: espejo de CONFIG.pricing en app.js ----
const EXCHANGE = 530;
const TABLE = [
  [10, 4000, 2500], [20, 6000, 3000], [30, 11000, 5500], [40, 17000, 7000],
  [50, 21000, 9000], [60, 26000, 13000], [70, 28500, 15000], [80, 36000, 14000],
];
function interpolateCRC(usd, colIdx) {
  if (!usd || usd <= 0) return 0;
  const col = (r) => r[colIdx + 1];
  const last = TABLE.length - 1;
  if (usd <= TABLE[0][0]) {
    const t = (usd - TABLE[0][0]) / (TABLE[1][0] - TABLE[0][0]);
    return Math.max(0, Math.round(col(TABLE[0]) + t * (col(TABLE[1]) - col(TABLE[0]))));
  }
  if (usd >= TABLE[last][0]) {
    const t = (usd - TABLE[last - 1][0]) / (TABLE[last][0] - TABLE[last - 1][0]);
    return Math.round(col(TABLE[last - 1]) + t * (col(TABLE[last]) - col(TABLE[last - 1])));
  }
  for (let i = 0; i < TABLE.length - 1; i++) {
    if (usd >= TABLE[i][0] && usd <= TABLE[i + 1][0]) {
      const t = (usd - TABLE[i][0]) / (TABLE[i + 1][0] - TABLE[i][0]);
      return Math.round(col(TABLE[i]) + t * (col(TABLE[i + 1]) - col(TABLE[i])));
    }
  }
  return 0;
}
function principalCRC(usd, platform = "") {
  if (/PS|Xbox/i.test(platform)) return interpolateCRC(usd, 0);
  return Math.round(usd * EXCHANGE * 0.75);
}
function formatCRC(n) {
  try {
    return new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", maximumFractionDigits: 0 }).format(n);
  } catch {
    return "₡" + Math.round(n).toLocaleString("es-CR");
  }
}

// ---- Datos (cache a nivel de módulo) ----
let _cache = null;
function loadData() {
  if (_cache) return _cache;
  const read = (f) => { try { return JSON.parse(readFileSync(join(process.cwd(), f), "utf8")); } catch { return null; } };
  const featured = (read("featured-games.json") || {}).games || [];
  const xbox = ((read("xbox-catalog.json") || {}).games || []).filter(g => g && !g._placeholder);
  const covers = ((read("covers.json") || {}).covers) || {};
  const reservas = (read("reservaciones.json") || {}).items || [];
  const faqs = (read("faq.json") || {}).faqs || [];
  let html = "";
  try { html = readFileSync(join(process.cwd(), "index.html"), "utf8"); } catch { html = ""; }

  const games = {};
  for (const g of featured) if (g && g.id) games[g.id] = { ...g, imageUrl: g.imageUrl || covers[g.id] || "" };
  for (const g of xbox) if (g && g.id) games[g.id] = g; // xbox ya trae imageUrl
  const reservaMap = {};
  for (const r of reservas) if (r && r.id) reservaMap[r.id] = r;

  _cache = { games, reservaMap, faqs, html };
  return _cache;
}

// ---- Helpers HTML ----
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function absImg(src) {
  if (!src) return BASE + "/assets/logo.png?v=2";
  return /^https?:\/\//.test(src) ? src : (BASE + src);
}
function setName(html, name, content) {
  const re = new RegExp(`(<meta name="${name}" content=")[^"]*(">)`);
  return re.test(html) ? html.replace(re, `$1${esc(content)}$2`) : html;
}
function setProp(html, prop, content) {
  const re = new RegExp(`(<meta property="${prop}" content=")[^"]*(">)`);
  return re.test(html) ? html.replace(re, `$1${esc(content)}$2`) : html;
}
function applyMeta(html, m) {
  let out = html;
  if (m.title) {
    out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(m.title)}</title>`);
    out = setProp(out, "og:title", m.title);
    out = setName(out, "twitter:title", m.title);
  }
  if (m.description) {
    out = setName(out, "description", m.description);
    out = setProp(out, "og:description", m.description);
    out = setName(out, "twitter:description", m.description);
  }
  // og:image siempre absoluto (cae al logo si la ruta no tiene imagen propia).
  const img = absImg(m.image);
  out = setProp(out, "og:image", img);
  out = setName(out, "twitter:image", img);
  if (m.ogType) out = setProp(out, "og:type", m.ogType);
  const inject = [];
  if (m.url) {
    out = setProp(out, "og:url", m.url);
    inject.push(`  <link rel="canonical" href="${esc(m.url)}">`);
  }
  if (m.jsonld) {
    inject.push(`  <script type="application/ld+json">${JSON.stringify(m.jsonld).replace(/</g, "\\u003c")}</script>`);
  }
  if (inject.length) out = out.replace("</head>", inject.join("\n") + "\n</head>");
  return out;
}

const STATIC_PAGES = {
  "/ofertas": ["Ofertas y descuentos | Rey Midas Digitales", "Juegos digitales en oferta para PS5, PS4, Xbox y Switch en Costa Rica. Descuentos reales, entrega inmediata por WhatsApp."],
  "/playstation-plus": ["PlayStation Plus en Costa Rica | Rey Midas Digitales", "Membresías PlayStation Plus al mejor precio en Costa Rica. Entrega inmediata por WhatsApp."],
  "/game-pass": ["Xbox Game Pass en Costa Rica | Rey Midas Digitales", "Xbox Game Pass al mejor precio en Costa Rica. Entrega inmediata por WhatsApp."],
  "/reservaciones": ["Reservaciones y preventas | Rey Midas Digitales", "Reservá los juegos más esperados antes de su lanzamiento en Costa Rica."],
  "/resenas": ["Reseñas de clientes | Rey Midas Digitales", "Lo que dicen nuestros clientes de Rey Midas Digitales."],
  "/faq": ["Preguntas frecuentes | Rey Midas Digitales", "Resolvé tus dudas sobre cómo comprar juegos digitales en Costa Rica."],
  "/como-comprar": ["Cómo comprar e instalar | Rey Midas Digitales", "Guía paso a paso para comprar e instalar tus juegos digitales en Costa Rica."],
  "/garantia": ["Garantía | Rey Midas Digitales", "Conocé la garantía de Rey Midas Digitales en tus compras de juegos digitales."],
  "/nosotros": ["Sobre nosotros | Rey Midas Digitales", "Conocé a Rey Midas Digitales, tu tienda de juegos digitales en Costa Rica."],
  "/terminos": ["Términos y condiciones | Rey Midas Digitales", "Términos y condiciones de Rey Midas Digitales."],
  "/privacidad": ["Política de privacidad | Rey Midas Digitales", "Política de privacidad de Rey Midas Digitales."],
};

function buildMeta(path, data) {
  const clean = (path.split("?")[0].replace(/\/+$/, "")) || "/";
  const url = BASE + (clean === "/" ? "/" : clean);
  const parts = clean.split("/").filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });

  if (parts[0] === "producto" && parts[1]) {
    const g = data.games[parts[1]];
    if (!g) return { url };
    const principal = principalCRC(Number(g.priceUSD) || 0, g.platform || "");
    const desc = `Comprá ${g.title} para ${g.platform} en Costa Rica.${principal ? ` Desde ${formatCRC(principal)}.` : ""} Entrega inmediata por WhatsApp.`;
    const jsonld = {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": g.title,
      "description": `Juego digital ${g.title} para ${g.platform}. Entrega inmediata por WhatsApp en Costa Rica.`,
      ...(g.imageUrl ? { "image": g.imageUrl } : {}),
      "brand": { "@type": "Brand", "name": String(g.platform || "").startsWith("Xbox") ? "Xbox" : "PlayStation" },
      ...(principal ? { "offers": {
        "@type": "Offer",
        "priceCurrency": "CRC",
        "price": String(principal),
        "availability": g.comingSoon ? "https://schema.org/PreOrder" : "https://schema.org/InStock",
        "seller": { "@type": "Organization", "name": "Rey Midas Digitales" },
      } } : {}),
    };
    return { title: `${g.title} — Rey Midas Digitales`, description: desc, image: g.imageUrl, url, jsonld, ogType: "product" };
  }

  if (parts[0] === "reserva" && parts[1]) {
    const r = data.reservaMap[parts[1]];
    if (!r) return { url };
    const desc = `Reservá ${r.title} para ${r.platform} en Costa Rica.${r.deposit ? ` Depósito desde ${formatCRC(r.deposit)}.` : ""} Asegurá tu copia para el día de lanzamiento.`;
    return { title: `Reservá ${r.title} — Rey Midas Digitales`, description: desc, image: r.imageUrl || "", url, ogType: "product" };
  }

  if (parts[0] === "plataforma" && parts[1]) {
    const p = parts[1];
    return {
      title: `Juegos ${p} en Costa Rica | Rey Midas Digitales`,
      description: `Catálogo de juegos digitales para ${p} en Costa Rica. Cuenta principal y secundaria, entrega inmediata por WhatsApp.`,
      url,
    };
  }

  if (parts[0] === "bundles") {
    const p = parts[1] || "";
    return { title: `Bundles ${p} | Rey Midas Digitales`.replace(/\s+\|/, " |"), description: `Paquetes y combos de juegos digitales ${p} en Costa Rica. Más juegos por menos.`, url };
  }

  if (STATIC_PAGES[clean]) {
    const [title, description] = STATIC_PAGES[clean];
    const m = { title, description, url };
    if (clean === "/faq" && data.faqs.length) {
      m.jsonld = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": data.faqs.map(f => ({ "@type": "Question", "name": f.q, "acceptedAnswer": { "@type": "Answer", "text": f.a } })),
      };
    }
    return m;
  }

  if (clean === "/") {
    return {
      url,
      jsonld: {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Rey Midas Digitales",
        "url": BASE,
        "logo": BASE + "/assets/logo.png",
        "telephone": "+50661468733",
        "areaServed": "CR",
      },
    };
  }

  return { url };
}

export default function handler(req, res) {
  const data = loadData();
  if (!data.html) {
    res.status(500).send("prerender unavailable");
    return;
  }
  let path = "/";
  try {
    path = (req.query && req.query.path) || new URL(req.url, "http://x").searchParams.get("path") || "/";
  } catch { path = "/"; }

  let meta = null;
  try { meta = buildMeta(path, data); } catch { meta = null; }

  const html = meta ? applyMeta(data.html, meta) : data.html;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.status(200).send(html);
}

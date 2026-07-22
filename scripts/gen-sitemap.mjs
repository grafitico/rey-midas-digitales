// Genera sitemap.xml estático a partir de los JSON del catálogo.
// Se corre en el build de Vercel (npm run build) y también se puede correr
// a mano: `node scripts/gen-sitemap.mjs`. El archivo resultante se sirve
// estático (sin gastar una Serverless Function).
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = "https://reymidascr.com";

function xmlEscape(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function urlEntry(loc, priority = "0.5", changefreq = "weekly") {
  return `  <url><loc>${xmlEscape(loc)}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}
function readJson(filename) {
  try { return JSON.parse(readFileSync(join(ROOT, filename), "utf8")); } catch { return null; }
}

const featuredGames = (readJson("featured-games.json") || {}).games || [];
const xboxGames = ((readJson("xbox-catalog.json") || {}).games || []).filter(g => g && !g._placeholder);
const reservaciones = (readJson("reservaciones.json") || {}).items || [];

const staticPages = [
  { loc: "/", priority: "1.0", changefreq: "daily" },
  { loc: "/plataforma/PS5", priority: "0.9", changefreq: "daily" },
  { loc: "/plataforma/PS4", priority: "0.9", changefreq: "daily" },
  { loc: "/plataforma/Xbox", priority: "0.9", changefreq: "daily" },
  { loc: "/plataforma/Switch", priority: "0.8", changefreq: "weekly" },
  { loc: "/ofertas", priority: "0.9", changefreq: "daily" },
  { loc: "/cofre", priority: "0.7", changefreq: "monthly" },
  { loc: "/playstation-plus", priority: "0.8", changefreq: "weekly" },
  { loc: "/game-pass", priority: "0.8", changefreq: "weekly" },
  { loc: "/bundles/PS", priority: "0.7", changefreq: "weekly" },
  { loc: "/bundles/Xbox", priority: "0.7", changefreq: "weekly" },
  { loc: "/vip", priority: "0.7", changefreq: "daily" },
  { loc: "/resenas", priority: "0.6", changefreq: "monthly" },
  { loc: "/faq", priority: "0.6", changefreq: "monthly" },
  { loc: "/como-comprar", priority: "0.5", changefreq: "monthly" },
  { loc: "/garantia", priority: "0.5", changefreq: "monthly" },
  { loc: "/nosotros", priority: "0.4", changefreq: "monthly" },
];

const gamePaths = new Set();
for (const g of featuredGames) if (g && g.id) gamePaths.add(`/producto/${encodeURIComponent(g.id)}`);
for (const g of xboxGames) if (g && g.id) gamePaths.add(`/producto/${encodeURIComponent(g.id)}`);
const reservaPaths = reservaciones.map(r => (r && r.id) ? `/reserva/${encodeURIComponent(r.id)}` : null).filter(Boolean);

const urls = [
  ...staticPages.map(p => urlEntry(BASE_URL + p.loc, p.priority, p.changefreq)),
  ...[...gamePaths].map(path => urlEntry(BASE_URL + path, "0.7", "weekly")),
  ...reservaPaths.map(path => urlEntry(BASE_URL + path, "0.7", "weekly")),
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;

writeFileSync(join(ROOT, "sitemap.xml"), xml, "utf8");
console.log(`sitemap.xml generado: ${urls.length} URLs`);

import { readFileSync } from "fs";
import { join } from "path";

const BASE_URL = "https://reymidascr.com";

function xmlEscape(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function urlEntry(loc, priority = "0.5", changefreq = "weekly") {
  return `  <url><loc>${xmlEscape(loc)}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

function readJson(filename) {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), filename), "utf8"));
  } catch {
    return null;
  }
}

export default function handler(req, res) {
  // featured-games.json => { _comment, games: [...] }
  const featuredGames = (readJson("featured-games.json") || {}).games || [];
  // xbox-catalog.json => { games: [...] } (algunos son _placeholder)
  const xboxCatalog = readJson("xbox-catalog.json") || {};
  const xboxGames = (Array.isArray(xboxCatalog.games) ? xboxCatalog.games : [])
    .filter(g => g && !g._placeholder);
  // reservaciones.json => { _comentario, items: [...] }
  const reservaciones = (readJson("reservaciones.json") || {}).items || [];

  const staticPages = [
    { loc: "/", priority: "1.0", changefreq: "daily" },
    { loc: "/plataforma/PS5", priority: "0.9", changefreq: "daily" },
    { loc: "/plataforma/PS4", priority: "0.9", changefreq: "daily" },
    { loc: "/plataforma/Xbox", priority: "0.9", changefreq: "daily" },
    { loc: "/plataforma/Switch", priority: "0.8", changefreq: "weekly" },
    { loc: "/ofertas", priority: "0.9", changefreq: "daily" },
    { loc: "/playstation-plus", priority: "0.8", changefreq: "weekly" },
    { loc: "/game-pass", priority: "0.8", changefreq: "weekly" },
    { loc: "/bundles/PS", priority: "0.7", changefreq: "weekly" },
    { loc: "/bundles/Xbox", priority: "0.7", changefreq: "weekly" },
    { loc: "/reservaciones", priority: "0.7", changefreq: "daily" },
    { loc: "/resenas", priority: "0.6", changefreq: "monthly" },
    { loc: "/faq", priority: "0.6", changefreq: "monthly" },
    { loc: "/como-comprar", priority: "0.5", changefreq: "monthly" },
    { loc: "/garantia", priority: "0.5", changefreq: "monthly" },
    { loc: "/nosotros", priority: "0.4", changefreq: "monthly" },
  ];

  // El id del juego es el mismo que usa la ruta /producto/:id (allGames.find por id).
  // Featured: id tipo "feat-...". Xbox: id ya incluye prefijo "xbox-".
  const gamePaths = new Set();
  for (const g of featuredGames) if (g && g.id) gamePaths.add(`/producto/${encodeURIComponent(g.id)}`);
  for (const g of xboxGames) if (g && g.id) gamePaths.add(`/producto/${encodeURIComponent(g.id)}`);

  const reservaPaths = reservaciones
    .map(r => (r && r.id) ? `/reserva/${encodeURIComponent(r.id)}` : null)
    .filter(Boolean);

  const urls = [
    ...staticPages.map(p => urlEntry(BASE_URL + p.loc, p.priority, p.changefreq)),
    ...[...gamePaths].map(path => urlEntry(BASE_URL + path, "0.7", "weekly")),
    ...reservaPaths.map(path => urlEntry(BASE_URL + path, "0.7", "weekly")),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
  res.status(200).send(xml);
}

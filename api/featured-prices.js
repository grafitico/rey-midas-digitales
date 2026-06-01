// Resolución de precios EN VIVO para el catálogo curado (featured-games.json).
//
// Problema que resuelve: los juegos "destacados" tienen un priceUSD fijo a
// mano y no reflejan las ofertas reales de PS Store. El scraper general
// (/api/scrape) recorre una categoría + deals + latest, pero no garantiza
// traer títulos AAA puntuales como "The Last of Us Part I". Acá, para cada
// título destacado, buscamos directo en el buscador de PSN es-cr y traemos
// su precio/oferta real (en USD, igual que el resto del catálogo).
//
// El cliente mergea estos precios sobre los destacados, así una tarjeta como
// feat-tlou1 pasa de mostrar $50 fijo a mostrar el precio en oferta del día.
//
// Devuelve { prices: { [featuredId]: { priceUSD, originalPriceUSD, onSale,
// discount, url, psnId, platform } } }. Lo que no se pueda resolver se omite
// (el cliente conserva el precio fijo como fallback).

import { readFileSync } from "fs";
import { join } from "path";

const PSN_BASE = "https://store.playstation.com/es-cr";
// Cuántas búsquedas a PSN en paralelo. Con ~175 títulos y un budget de ~25s,
// 12 en paralelo da margen (175/12 ≈ 15 rondas * ~1.5s ≈ 22s).
const CONCURRENCY = 12;
// Corte de tiempo defensivo: si nos acercamos al maxDuration devolvemos lo
// que tengamos resuelto en vez de que la función muera por timeout.
const TIME_BUDGET_MS = 25000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  if (req.method === "OPTIONS") return res.status(200).end();

  const started = Date.now();
  try {
    const featured = loadFeatured();
    const prices = {};
    const stats = { total: featured.length, resolved: 0, missed: 0, errors: 0 };

    let idx = 0;
    async function worker() {
      while (idx < featured.length) {
        if (Date.now() - started > TIME_BUDGET_MS) return;
        const game = featured[idx++];
        try {
          const live = await resolveLivePrice(game);
          if (live) {
            prices[game.id] = live;
            stats.resolved++;
          } else {
            stats.missed++;
          }
        } catch {
          stats.errors++;
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, featured.length) }, worker)
    );

    return res.status(200).json({ success: true, stats, prices });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

function loadFeatured() {
  // featured-games.json vive en la raíz del repo. En Vercel se incluye en el
  // bundle de la función vía "includeFiles" en vercel.json.
  const raw = readFileSync(join(process.cwd(), "featured-games.json"), "utf8");
  const data = JSON.parse(raw);
  return Array.isArray(data.games) ? data.games.filter(g => g && g.title) : [];
}

async function resolveLivePrice(game) {
  const url = `${PSN_BASE}/search/${encodeURIComponent(game.title)}`;
  const products = await fetchAndParse(url);
  if (!products.length) return null;

  const target = matchKey(game.title);
  // Solo aceptamos coincidencias exactas de título normalizado para no agarrar
  // un DLC, una edición rara o un juego distinto que comparta palabras.
  const exact = products.filter(p => matchKey(p.name) === target);
  const pool = exact.length ? exact : [];
  if (!pool.length) return null;

  // Si el destacado es de una plataforma puntual, preferimos el producto que
  // la incluya. Entre los candidatos, elegimos el de menor precio actual
  // (la edición base / mejor oferta, no un bundle deluxe).
  const wantsPS5 = /PS5/i.test(game.platform || "");
  const wantsPS4 = /PS4/i.test(game.platform || "");
  let candidates = pool;
  if (wantsPS5 && !wantsPS4) {
    const f = pool.filter(p => p.platforms.includes("PS5"));
    if (f.length) candidates = f;
  } else if (wantsPS4 && !wantsPS5) {
    const f = pool.filter(p => p.platforms.includes("PS4"));
    if (f.length) candidates = f;
  }

  const best = candidates.reduce((a, b) => (a.priceUSD <= b.priceUSD ? a : b));
  return {
    priceUSD: best.priceUSD,
    originalPriceUSD: best.originalPriceUSD,
    onSale: best.onSale,
    discount: best.discount,
    url: best.url,
    psnId: best.id,
    platform: best.platform,
  };
}

async function fetchAndParse(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  const html = await r.text();
  return parseGames(html);
}

function parseGames(html) {
  if (!html || html.length < 500) return [];
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }

  const cache = data?.props?.apolloState || {};
  const out = [];
  for (const key of Object.keys(cache)) {
    const obj = cache[key];
    if (!obj || typeof obj !== "object") continue;
    if (obj.__typename === "Product" || (typeof obj.id === "string" && /^(EP|UP|HP|JP)\d/.test(obj.id))) {
      const g = normalize(obj);
      if (g) out.push(g);
    }
  }
  return out;
}

function normalize(p) {
  if (!p.id || !p.name) return null;
  const priceInfo = p.price || {};
  const current = parsePrice(priceInfo.discountedValue ?? priceInfo.basePrice);
  const original = parsePrice(priceInfo.basePrice) || current;
  if (!current) return null;

  const plats = p.platforms || [];
  const hasPS5 = plats.includes("PS5") || /PS5/i.test(p.name);
  const hasPS4 = plats.includes("PS4");
  let platform = "PS4";
  if (hasPS5 && hasPS4) platform = "PS5/PS4";
  else if (hasPS5) platform = "PS5";

  const onSale = original > current;
  return {
    id: p.id,
    name: p.name,
    platform,
    platforms: plats,
    url: `https://store.playstation.com/es-cr/product/${p.id}`,
    priceUSD: current,
    originalPriceUSD: original,
    onSale,
    discount: onSale ? Math.round((1 - current / original) * 100) : 0,
  };
}

// Misma normalización que matchKey() en el cliente, para que el match
// servidor↔cliente sea consistente (sin ™/®, sin "Edition", sin tildes).
function matchKey(t) {
  return String(t || "")
    .replace(/[™®©]/g, "")
    .replace(/\s*\[(PS5|PS4|XBOX|Xbox|Series X\|S|Series X)\]/gi, "")
    .replace(/\b(Standard|Deluxe|Ultimate|Gold|Premium|Definitive|Complete|GOTY|Game of the Year|Collector'?s)\s+Edition\b/gi, "")
    .replace(/\b(Cross[- ]?Gen Bundle|Bundle|Pack)\b/gi, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parsePrice(str) {
  if (str == null) return 0;
  if (typeof str === "number") return str;
  const m = String(str).match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

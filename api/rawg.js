// Endpoint de prueba contra la API de RAWG.
// https://api.rawg.io/docs/
//
// RAWG NO devuelve precios — es una base de datos de metadatos. Lo usamos
// para enriquecer la info que ya scrapeamos de PSN/Xbox (descripciones,
// screenshots, géneros, rating de Metacritic, desarrollador, publisher)
// y como fuente de catálogo "general" cuando un juego no está en oferta.
//
// La key queda hardcoded acá a pedido del cliente. Si RAWG la revoca por
// detectarla en GitHub, moverla a process.env.RAWG_API_KEY en Vercel.
const RAWG_KEY = "b41cb9a3a89543b8a33e2fda7a62fc13";
const RAWG_BASE = "https://api.rawg.io/api";

// IDs de plataformas en RAWG (https://api.rawg.io/api/platforms)
const PLATFORM_IDS = {
  ps5: 187,
  ps4: 18,
  xboxone: 1,
  xboxseries: 186,
};

// Modos:
//  GET /api/rawg?mode=list&platform=ps5,ps4,xboxone,xboxseries&page=1&page_size=40&ordering=-added
//  GET /api/rawg?mode=search&q=zelda
//  GET /api/rawg?mode=detail&id=<slug-o-id>
//  GET /api/rawg?mode=debug   → respuesta cruda del primer juego para inspeccionar campos
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  if (req.method === "OPTIONS") return res.status(200).end();

  const mode = (req.query.mode || "list").toString();

  try {
    if (mode === "detail") {
      const id = (req.query.id || "").toString().trim();
      if (!id) return res.status(400).json({ success: false, error: "Falta id" });
      const data = await rawg(`/games/${encodeURIComponent(id)}`);
      return res.status(200).json({ success: true, game: normalizeDetail(data) });
    }

    if (mode === "search") {
      const q = (req.query.q || "").toString().trim();
      if (!q) return res.status(400).json({ success: false, error: "Falta q" });
      const data = await rawg("/games", {
        search: q,
        search_precise: "true",
        page_size: req.query.page_size || "20",
        platforms: resolvePlatforms(req.query.platform),
      });
      return res.status(200).json({
        success: true,
        count: data.count,
        next: !!data.next,
        games: (data.results || []).map(normalizeListItem),
      });
    }

    if (mode === "debug") {
      const data = await rawg("/games", {
        page_size: "1",
        platforms: resolvePlatforms(req.query.platform || "ps5,ps4,xboxone,xboxseries"),
      });
      return res.status(200).json({
        success: true,
        raw: data.results?.[0] || null,
      });
    }

    // mode === "list" (default)
    const data = await rawg("/games", {
      page: req.query.page || "1",
      page_size: req.query.page_size || "40",
      ordering: req.query.ordering || "-metacritic",
      platforms: resolvePlatforms(req.query.platform || "ps5,ps4,xboxone,xboxseries"),
      dates: req.query.dates || undefined,
      metacritic: req.query.metacritic || "60,100",
    });

    return res.status(200).json({
      success: true,
      count: data.count,
      next: !!data.next,
      previous: !!data.previous,
      games: (data.results || []).map(normalizeListItem),
    });
  } catch (e) {
    // Cupo de RAWG agotado (401 monthly limit) o rate-limit (429): no es un
    // error del servidor. Respondemos 200 con quota:true para que el cliente
    // active su circuit breaker y deje de pedir, sin ensuciar la consola con
    // un mar de 500s en rojo.
    if (e.status === 401 || e.status === 429) {
      return res.status(200).json({ success: false, quota: true, error: e.message });
    }
    return res.status(500).json({ success: false, error: e.message });
  }
}

function resolvePlatforms(input) {
  if (!input) return undefined;
  const keys = String(input).toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const ids = keys.map(k => PLATFORM_IDS[k]).filter(Boolean);
  return ids.length ? ids.join(",") : undefined;
}

async function rawg(path, params = {}) {
  const usp = new URLSearchParams({ key: RAWG_KEY });
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    usp.set(k, v);
  }
  const url = `${RAWG_BASE}${path}?${usp.toString()}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0)",
      "Accept": "application/json",
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    const err = new Error(`RAWG HTTP ${r.status} en ${path}: ${body.slice(0, 200)}`);
    err.status = r.status; // 401 = cupo mensual agotado, 429 = rate limit
    throw err;
  }
  return r.json();
}

function normalizeListItem(g) {
  return {
    id: g.id,
    slug: g.slug,
    title: g.name,
    imageUrl: g.background_image || "",
    released: g.released || "",
    rating: g.rating || 0,
    ratingCount: g.ratings_count || 0,
    metacritic: g.metacritic || null,
    platforms: (g.parent_platforms || []).map(p => p.platform?.name).filter(Boolean),
    genres: (g.genres || []).map(x => x.name),
    esrb: g.esrb_rating?.name || null,
    tags: (g.tags || []).slice(0, 8).map(t => t.name),
    shortScreenshots: (g.short_screenshots || []).slice(1, 5).map(s => s.image),
  };
}

function normalizeDetail(g) {
  return {
    id: g.id,
    slug: g.slug,
    title: g.name,
    description: stripHtml(g.description || ""),
    descriptionHtml: g.description || "",
    imageUrl: g.background_image || "",
    imageAdditional: g.background_image_additional || "",
    released: g.released || "",
    rating: g.rating || 0,
    metacritic: g.metacritic || null,
    playtime: g.playtime || 0,
    website: g.website || "",
    platforms: (g.parent_platforms || []).map(p => p.platform?.name).filter(Boolean),
    genres: (g.genres || []).map(x => x.name),
    developers: (g.developers || []).map(x => x.name),
    publishers: (g.publishers || []).map(x => x.name),
    esrb: g.esrb_rating?.name || null,
    tags: (g.tags || []).map(t => t.name),
  };
}

function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

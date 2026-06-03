// Endpoint unificado de metadatos y portadas de juegos.
//
// RAWG (requiere RAWG_API_KEY en Vercel — 20k req/mes por key):
//   GET /api/rawg?mode=list&platform=ps5,ps4,xboxone,xboxseries
//   GET /api/rawg?mode=search&q=zelda
//   GET /api/rawg?mode=detail&id=<slug-o-id>
//   GET /api/rawg?mode=debug
//
// Steam (sin API key, sin registro, sin cupo mensual):
//   GET /api/rawg?mode=steam-cover&q=<titulo>
//
// IGDB (requiere IGDB_CLIENT_ID + IGDB_CLIENT_SECRET en Vercel — dev.twitch.tv):
//   GET /api/rawg?mode=igdb-search&q=<titulo>
//   GET /api/rawg?mode=igdb-detail&id=<titulo>
//
// Todos los modos devuelven { success, ... } o { success:false, quota:true, error }.

// ─── RAWG ────────────────────────────────────────────────────────────────────

const RAWG_KEYS = [
  process.env.RAWG_API_KEY,
  process.env.RAWG_API_KEY_2,
  process.env.RAWG_API_KEY_3,
].filter(k => !!k);

const _exhaustedRawgKeys = new Set();
const RAWG_BASE = "https://api.rawg.io/api";

const PLATFORM_IDS = { ps5: 187, ps4: 18, xboxone: 1, xboxseries: 186 };

// ─── IGDB ────────────────────────────────────────────────────────────────────

const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID || "";
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET || "";
const IGDB_BASE = "https://api.igdb.com/v4";
let _igdbToken = null; // { access_token, expires_at }

async function getIgdbToken() {
  const now = Date.now();
  if (_igdbToken && _igdbToken.expires_at > now + 60_000) return _igdbToken.access_token;
  const r = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(IGDB_CLIENT_ID)}&client_secret=${encodeURIComponent(IGDB_CLIENT_SECRET)}&grant_type=client_credentials`,
    { method: "POST" }
  );
  if (!r.ok) { const e = new Error(`Twitch token ${r.status}`); e.status = r.status; throw e; }
  const d = await r.json();
  _igdbToken = { access_token: d.access_token, expires_at: now + d.expires_in * 1000 };
  return d.access_token;
}

async function igdbPost(endpoint, body) {
  const token = await getIgdbToken();
  const r = await fetch(`${IGDB_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Client-ID": IGDB_CLIENT_ID, "Authorization": `Bearer ${token}`, "Content-Type": "text/plain" },
    body,
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); const e = new Error(`IGDB ${r.status}: ${t.slice(0, 200)}`); e.status = r.status; throw e; }
  return r.json();
}

function igdbCoverUrl(imageId, size = "cover_big") {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

const IGDB_FIELDS = "name,slug,cover.image_id,total_rating,genres.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,summary,first_release_date";

function normalizeIgdbGame(g) {
  let released = "";
  if (g.first_release_date) {
    released = new Date(g.first_release_date * 1000).toISOString().slice(0, 10);
  }
  return {
    id: g.id,
    slug: g.slug || String(g.id),
    title: g.name,
    imageUrl: g.cover?.image_id ? igdbCoverUrl(g.cover.image_id) : "",
    rating: g.total_rating ? +(g.total_rating / 10).toFixed(1) : 0,
    igdbScore: g.total_rating ? Math.round(g.total_rating) : null,
    metacritic: null,
    released,
    genres: (g.genres || []).map(x => x.name),
    developers: (g.involved_companies || []).filter(c => c.developer).map(c => c.company?.name).filter(Boolean),
    publishers: (g.involved_companies || []).filter(c => c.publisher).map(c => c.company?.name).filter(Boolean),
    description: g.summary || "",
    shortScreenshots: [],
  };
}

function safeIgdbQuery(q) {
  return String(q).replace(/\\/g, "").replace(/"/g, " ").trim();
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  if (req.method === "OPTIONS") return res.status(200).end();

  const mode = (req.query.mode || "list").toString();

  // ── Steam (sin auth, sin cupo mensual) ──────────────────────────────────────
  if (mode === "steam-cover") {
    const q = (req.query.q || "").toString().trim();
    if (!q) return res.status(400).json({ success: false, error: "Falta q" });
    try {
      const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&cc=US&l=english`;
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0)" } });
      if (!r.ok) return res.status(200).json({ success: false, error: `Steam HTTP ${r.status}` });
      const data = await r.json();
      const hit = data?.items?.[0];
      if (!hit?.id) return res.status(200).json({ success: true, imageUrl: "" });
      const imageUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${hit.id}/header.jpg`;
      return res.status(200).json({ success: true, imageUrl, title: hit.name, appId: hit.id });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // ── IGDB (requiere IGDB_CLIENT_ID + IGDB_CLIENT_SECRET en Vercel) ───────────
  if (mode === "igdb-search" || mode === "igdb-detail") {
    if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
      return res.status(200).json({ success: false, quota: true, error: "IGDB no configurado (registrar app en dev.twitch.tv)" });
    }
    try {
      if (mode === "igdb-search") {
        const q = (req.query.q || "").toString().trim();
        if (!q) return res.status(400).json({ success: false, error: "Falta q" });
        const games = await igdbPost("/games", `search "${safeIgdbQuery(q)}"; fields ${IGDB_FIELDS}; limit 5;`);
        return res.status(200).json({ success: true, games: (games || []).map(normalizeIgdbGame) });
      }
      // igdb-detail
      const id = (req.query.id || "").toString().trim();
      if (!id) return res.status(400).json({ success: false, error: "Falta id" });
      const detailFields = `${IGDB_FIELDS},artworks.image_id,screenshots.image_id`;
      const games = await igdbPost("/games", `search "${safeIgdbQuery(id)}"; fields ${detailFields}; limit 1;`);
      const g = games?.[0];
      if (!g) return res.status(200).json({ success: true, game: null });
      const normalized = normalizeIgdbGame(g);
      normalized.shortScreenshots = [
        ...(g.artworks || []).slice(0, 2).map(a => igdbCoverUrl(a.image_id, "screenshot_big")),
        ...(g.screenshots || []).slice(0, 4).map(s => igdbCoverUrl(s.image_id, "screenshot_big")),
      ];
      return res.status(200).json({ success: true, game: normalized });
    } catch (e) {
      if (e.status === 401 || e.status === 429) {
        return res.status(200).json({ success: false, quota: true, error: e.message });
      }
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // ── PlayStation Store (sin API key, sin cupo mensual) ───────────────────────
  if (mode === "psn-search") {
    const q = (req.query.q || "").toString().trim();
    if (!q) return res.status(400).json({ success: false, error: "Falta q" });
    try {
      const hit = await fetchPsnGame(q);
      return res.status(200).json({ success: true, game: hit });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  // ── RAWG (requiere RAWG_API_KEY) ─────────────────────────────────────────────
  const availableKeys = RAWG_KEYS.filter(k => !_exhaustedRawgKeys.has(k));
  if (!availableKeys.length) {
    const msg = RAWG_KEYS.length
      ? "Todas las RAWG API keys agotaron su cupo mensual"
      : "RAWG_API_KEY no configurada en el servidor";
    return res.status(200).json({ success: false, quota: true, error: msg });
  }

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
      return res.status(200).json({ success: true, raw: data.results?.[0] || null });
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
    if (e.status === 401 || e.status === 429) {
      return res.status(200).json({ success: false, quota: true, error: e.message });
    }
    return res.status(500).json({ success: false, error: e.message });
  }
}

// ─── Helpers RAWG ────────────────────────────────────────────────────────────

function resolvePlatforms(input) {
  if (!input) return undefined;
  const keys = String(input).toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const ids = keys.map(k => PLATFORM_IDS[k]).filter(Boolean);
  return ids.length ? ids.join(",") : undefined;
}

async function rawg(path, params = {}) {
  const keysToTry = RAWG_KEYS.filter(k => !_exhaustedRawgKeys.has(k));
  if (!keysToTry.length) {
    const err = new Error("Todas las RAWG API keys agotaron su cupo mensual");
    err.status = 401;
    throw err;
  }
  for (const key of keysToTry) {
    const usp = new URLSearchParams({ key });
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      usp.set(k, v);
    }
    const r = await fetch(`${RAWG_BASE}${path}?${usp.toString()}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0)", "Accept": "application/json" },
    });
    if (r.status === 401) { _exhaustedRawgKeys.add(key); continue; }
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      const err = new Error(`RAWG HTTP ${r.status} en ${path}: ${body.slice(0, 200)}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }
  const err = new Error("Todas las RAWG API keys agotaron su cupo mensual");
  err.status = 401;
  throw err;
}

function normalizeListItem(g) {
  return {
    id: g.id, slug: g.slug, title: g.name,
    imageUrl: g.background_image || "",
    released: g.released || "", rating: g.rating || 0,
    ratingCount: g.ratings_count || 0, metacritic: g.metacritic || null,
    platforms: (g.parent_platforms || []).map(p => p.platform?.name).filter(Boolean),
    genres: (g.genres || []).map(x => x.name),
    esrb: g.esrb_rating?.name || null,
    tags: (g.tags || []).slice(0, 8).map(t => t.name),
    shortScreenshots: (g.short_screenshots || []).slice(1, 5).map(s => s.image),
  };
}

function normalizeDetail(g) {
  return {
    id: g.id, slug: g.slug, title: g.name,
    description: stripHtml(g.description || ""),
    imageUrl: g.background_image || "",
    imageAdditional: g.background_image_additional || "",
    released: g.released || "", rating: g.rating || 0,
    metacritic: g.metacritic || null, playtime: g.playtime || 0,
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

// ─── Helpers PSN ─────────────────────────────────────────────────────────────

const PSN_STORE = "https://store.playstation.com/es-cr";
const PSN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
};

async function fetchPsnHtml(url) {
  const r = await fetch(url, { headers: PSN_HEADERS });
  if (!r.ok) { const e = new Error(`PSN HTTP ${r.status}`); e.status = r.status; throw e; }
  return r.text();
}

function parsePsnNextData(html) {
  if (!html || html.length < 500) return null;
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function extractPsnMedia(mediaArray, deref) {
  if (!Array.isArray(mediaArray)) return { imageUrl: "", screenshots: [] };
  const imgs = mediaArray.map(deref).filter(i => i && i.url);
  const master = imgs.find(i => i.role === "MASTER") || imgs.find(i => i.role === "GAMEHUB_COVER_ART") || imgs[0];
  const screenshots = imgs.filter(i => i.role === "SCREENSHOT").slice(0, 4).map(i => i.url).filter(Boolean);
  return { imageUrl: master?.url || "", screenshots };
}

function extractPsnGenres(obj) {
  const genres = [];
  for (const src of [obj.genres, obj.localizedGenres, obj.genreList, obj.localizedGenreNames]) {
    if (!Array.isArray(src)) continue;
    for (const g of src) {
      const v = typeof g === "string" ? g : (g?.value || g?.name || g?.label);
      if (v && !genres.includes(v)) genres.push(v);
    }
  }
  return genres;
}

async function fetchPsnGame(title) {
  // Step 1: search page → get product ID + cover
  const searchHtml = await fetchPsnHtml(`${PSN_STORE}/search/${encodeURIComponent(title)}`);
  const searchData = parsePsnNextData(searchHtml);
  if (!searchData) return null;

  const cache = searchData?.props?.apolloState || {};
  const deref = (val) => val?.__ref ? (cache[val.__ref] ?? val) : val;

  let firstProduct = null;
  for (const key of Object.keys(cache)) {
    const obj = cache[key];
    if (!obj || typeof obj !== "object") continue;
    if (!(obj.__typename === "Product" || (typeof obj.id === "string" && /^(EP|UP|HP|JP)\d/.test(obj.id)))) continue;
    if (!obj.name) continue;
    firstProduct = obj;
    break;
  }
  if (!firstProduct) return null;

  const { imageUrl, screenshots: searchShots } = extractPsnMedia(firstProduct.media, deref);
  const genres = extractPsnGenres(firstProduct);
  const plats = firstProduct.platforms || [];
  const platform = plats.includes("PS5") ? (plats.includes("PS4") ? "PS5/PS4" : "PS5") : "PS4";

  // Step 2: product detail page → description + more screenshots
  let description = "";
  let screenshots = searchShots;
  let released = firstProduct.releaseDate || firstProduct.originalReleaseDate || "";

  try {
    const detailHtml = await fetchPsnHtml(`${PSN_STORE}/product/${firstProduct.id}`);
    const detailData = parsePsnNextData(detailHtml);
    if (detailData) {
      const dc = detailData?.props?.apolloState || {};
      const dref = (val) => val?.__ref ? (dc[val.__ref] ?? val) : val;
      const pKey = Object.keys(dc).find(k => k === `Product:${firstProduct.id}` || k.startsWith(`Product:${firstProduct.id}:`));
      const p = pKey ? dc[pKey] : null;
      if (p) {
        const raw = p.longDescription || p.description || p.localizedDescription || p.shortDescription || "";
        description = stripHtml(raw).slice(0, 1200);
        if (!released) released = p.releaseDate || p.originalReleaseDate || p.firstReleaseDate || "";
        const { screenshots: dShots } = extractPsnMedia(p.media, dref);
        if (dShots.length) screenshots = dShots;
      }
    }
  } catch {}

  return {
    id: firstProduct.id,
    title: firstProduct.name,
    imageUrl,
    description,
    screenshots,
    genres,
    platform,
    released,
    _source: "psn",
  };
}

// Proxy para IGDB (Internet Game Database) — fuente gratuita de portadas y metadatos.
// Sin cupo mensual: solo límite de 4 req/seg (muy superior a las 20k req/mes de RAWG).
// Funciona como fallback cuando RAWG agota su cupo, y como fuente primaria opcional.
//
// Requiere en Vercel:
//   IGDB_CLIENT_ID     → Client-ID de la app registrada en dev.twitch.tv
//   IGDB_CLIENT_SECRET → Client Secret de esa misma app
//
// Docs: https://api-docs.igdb.com/
//
// GET /api/igdb?mode=search&q=<titulo>
// GET /api/igdb?mode=detail&id=<titulo-o-slug>

const CLIENT_ID = process.env.IGDB_CLIENT_ID || "";
const CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET || "";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_BASE = "https://api.igdb.com/v4";

// Token OAuth en memoria — se renueva automáticamente cuando expira.
// Con serverless functions el token se mantiene mientras la instancia esté caliente.
let _token = null; // { access_token, expires_at }

async function getToken() {
  const now = Date.now();
  if (_token && _token.expires_at > now + 60_000) return _token.access_token;
  const r = await fetch(
    `${TOKEN_URL}?client_id=${encodeURIComponent(CLIENT_ID)}&client_secret=${encodeURIComponent(CLIENT_SECRET)}&grant_type=client_credentials`,
    { method: "POST" }
  );
  if (!r.ok) {
    const err = new Error(`Twitch token HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const d = await r.json();
  _token = { access_token: d.access_token, expires_at: now + d.expires_in * 1000 };
  return d.access_token;
}

async function igdb(endpoint, body) {
  const token = await getToken();
  const r = await fetch(`${IGDB_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": CLIENT_ID,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const err = new Error(`IGDB ${r.status}: ${text.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

function coverUrl(imageId, size = "cover_big") {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

// Campos base para búsqueda rápida
const BASE_FIELDS = "name,slug,cover.image_id,total_rating,genres.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name,summary,first_release_date";

function safeQuery(q) {
  // Escapar comillas y barras para no romper la sintaxis Apicalypse
  return String(q).replace(/\\/g, "").replace(/"/g, " ").trim();
}

function normalizeGame(g) {
  let released = "";
  if (g.first_release_date) {
    // IGDB almacena la fecha como Unix timestamp
    const d = new Date(g.first_release_date * 1000);
    released = d.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  return {
    id: g.id,
    slug: g.slug || String(g.id),
    title: g.name,
    imageUrl: g.cover?.image_id ? coverUrl(g.cover.image_id) : "",
    // rating: escala 0-10 equivalente a RAWG, para compatibilidad con el frontend
    rating: g.total_rating ? +(g.total_rating / 10).toFixed(1) : 0,
    // igdbScore: escala 0-100 (equivalente funcional a Metacritic para filtro AAA)
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(200).json({
      success: false,
      quota: true,
      error: "IGDB no configurado (registrar app en dev.twitch.tv y añadir IGDB_CLIENT_ID + IGDB_CLIENT_SECRET en Vercel)",
    });
  }

  const mode = (req.query.mode || "search").toString();

  try {
    if (mode === "search") {
      const q = (req.query.q || "").toString().trim();
      if (!q) return res.status(400).json({ success: false, error: "Falta q" });
      const games = await igdb("/games",
        `search "${safeQuery(q)}"; fields ${BASE_FIELDS}; limit 5;`
      );
      return res.status(200).json({ success: true, games: (games || []).map(normalizeGame) });
    }

    if (mode === "detail") {
      const id = (req.query.id || "").toString().trim();
      if (!id) return res.status(400).json({ success: false, error: "Falta id" });
      const detailFields = `${BASE_FIELDS},artworks.image_id,screenshots.image_id`;
      const games = await igdb("/games",
        `search "${safeQuery(id)}"; fields ${detailFields}; limit 1;`
      );
      const g = games?.[0];
      if (!g) return res.status(200).json({ success: true, game: null });
      const normalized = normalizeGame(g);
      normalized.shortScreenshots = [
        ...(g.artworks || []).slice(0, 2).map(a => coverUrl(a.image_id, "screenshot_big")),
        ...(g.screenshots || []).slice(0, 4).map(s => coverUrl(s.image_id, "screenshot_big")),
      ];
      return res.status(200).json({ success: true, game: normalized });
    }

    return res.status(400).json({ success: false, error: `Modo desconocido: ${mode}` });
  } catch (e) {
    if (e.status === 401 || e.status === 429) {
      return res.status(200).json({ success: false, quota: true, error: e.message });
    }
    return res.status(500).json({ success: false, error: e.message });
  }
}

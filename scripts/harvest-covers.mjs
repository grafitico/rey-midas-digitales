// Cosechador de URLs de carátulas → covers.json
// ===============================================
// Corre en GitHub Actions una vez al mes (cuando se renueva la cuota de RAWG).
// NO descarga imágenes ni sube nada a Bana. Solo guarda la URL pública del CDN
// de RAWG en covers.json. Las imágenes del CDN (media.rawg.io) no consumen
// cuota — solo las búsquedas por API. Una vez guardadas, el sitio carga las
// portadas directo del CDN sin tocarle nunca más a la API de RAWG.
//
// Variables de entorno requeridas:
//   RAWG_API_KEY  — key de RAWG (solo se usa en este script, no en producción)
//   GITHUB_TOKEN  — token del runner (lo da Actions automáticamente)
//   GITHUB_REPO   — owner/repo (github.repository)
//   GITHUB_BRANCH — rama (github.ref_name)

import { readFileSync } from "fs";

const GITHUB_API = "https://api.github.com";
const RAWG_BASE  = "https://api.rawg.io/api";
const COVERS_FILE = "covers.json";

// Espejo exacto de cleanTitleForRawg() en app.js
function cleanTitle(t) {
  return String(t || "")
    .replace(/[™®©]/g, "")
    .replace(/\s*\[(PS5|PS4|XBOX|Xbox|Series X\|S|Series X)\]/gi, "")
    .replace(/\b(Standard|Deluxe|Ultimate|Gold|Premium|Definitive|Complete|GOTY|Game of the Year|Collector'?s)\s+Edition\b/gi, "")
    .replace(/\b(Cross[- ]?Gen Bundle|Bundle|Pack)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function rawgFindImageUrl(title) {
  const key = process.env.RAWG_API_KEY;
  if (!key) throw new Error("Falta RAWG_API_KEY");
  const q = cleanTitle(title);
  const url = `${RAWG_BASE}/games?key=${key}&search=${encodeURIComponent(q)}&search_precise=true&page_size=1`;
  const r = await fetch(url, {
    headers: { "User-Agent": "rey-midas-cover-harvester/1.0", Accept: "application/json" },
  });
  if (!r.ok) {
    const err = new Error(`RAWG HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  return data.results?.[0]?.background_image || "";
}

// ---- GitHub Contents API ----
function ghHeaders() {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("Falta GITHUB_TOKEN");
  return { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "User-Agent": "rey-midas-cover-harvester" };
}
const ghRepo   = () => { const r = process.env.GITHUB_REPO;   if (!r) throw new Error("Falta GITHUB_REPO");   return r; };
const ghBranch = () => process.env.GITHUB_BRANCH || "main";

async function getFileSha(path) {
  const r = await fetch(`${GITHUB_API}/repos/${ghRepo()}/contents/${path}?ref=${encodeURIComponent(ghBranch())}`, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).sha;
}

async function commitFile(path, obj, message) {
  const sha = await getFileSha(path);
  const r = await fetch(`${GITHUB_API}/repos/${ghRepo()}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(obj, null, 2) + "\n", "utf8").toString("base64"),
      branch: ghBranch(),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!r.ok) throw new Error(`GitHub PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// ---- main ----
async function main() {
  const featured = JSON.parse(readFileSync("featured-games.json", "utf8")).games || [];
  console.log(`[harvest] ${featured.length} juegos en el catálogo`);

  // Cargar covers existentes para no repetir búsquedas ya hechas
  let existing = {};
  try { existing = JSON.parse(readFileSync(COVERS_FILE, "utf8")).covers || {}; } catch {}
  console.log(`[harvest] ${Object.keys(existing).length} URLs ya guardadas`);

  const covers = { ...existing };
  let added = 0, skipped = 0, failed = 0, quotaHit = false;

  for (const g of featured) {
    if (!g.id) continue;

    if (covers[g.id]) {
      skipped++;
      continue;
    }

    try {
      const imageUrl = await rawgFindImageUrl(g.title);
      if (!imageUrl) {
        console.log(`  · sin resultado: ${g.title}`);
        failed++;
        continue;
      }
      covers[g.id] = imageUrl;
      added++;
      console.log(`  ✓ ${g.id} → ${imageUrl.slice(0, 60)}...`);
    } catch (e) {
      if (e.status === 401 || e.status === 429) {
        console.log(`  ! cupo de RAWG agotado tras ${added} nuevas`);
        quotaHit = true;
        break;
      }
      console.log(`  ✗ ${g.title}: ${e.message}`);
      failed++;
    }
    // Pausa entre requests para no reventar el rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  if (added > 0) {
    const obj = { generated: new Date().toISOString(), total: Object.keys(covers).length, covers };
    const msg = `chore(covers): +${added} URLs de carátulas en covers.json (${skipped} ya, ${failed} sin match)` +
                (quotaHit ? " [cupo RAWG agotado]" : "");
    await commitFile(COVERS_FILE, obj, msg);
    console.log(`\n[harvest] ✅ covers.json actualizado. Total: ${obj.total} juegos con portada.`);
  } else {
    console.log(`\n[harvest] Sin cambios — skipped:${skipped} failed:${failed}.`);
  }

  console.log(`[harvest] Resumen → nuevas:${added}  ya tenían:${skipped}  sin match:${failed}${quotaHit ? "  ⚠ cupo agotado" : ""}`);
  if (quotaHit) process.exit(0); // no es error fatal, solo se corta antes
}

main().catch(e => { console.error("[harvest] Fatal:", e.message); process.exit(1); });

// Cosechador de carátulas SIN API key → covers.json
// ===================================================
// Alternativa gratuita a harvest-covers.mjs (que usa RAWG y consume cupo).
// Usa el autosuggest público de la Microsoft Store, que devuelve box-art
// cuadrado (ImageType=BoxArt, 2160×2160) servido por store-images.s-microsoft.com
// (CDN público, sin key ni cupo). Las tarjetas del sitio son aspect-ratio 1/1,
// así que el box-art cuadrado calza perfecto.
//
// MERGEA sobre covers.json: solo busca las que faltan, nunca pisa lo ya guardado
// (así convive con el cosechador de RAWG y con ejecuciones previas).
//
// Cubre juegos multiplataforma (COD, FIFA, AC, Nier, Code Vein, …). Los
// exclusivos de PlayStation/Nintendo no están en la tienda MS: esos quedan sin
// match aquí y los completa harvest-covers.mjs (RAWG) o el fallback en vivo.
//
// Dos modos (auto-detectados):
//   • Local:  node scripts/harvest-covers-msstore.mjs   → escribe covers.json en disco.
//   • CI:     si hay GITHUB_TOKEN + GITHUB_REPO, commitea covers.json vía la API
//             de GitHub (no requiere RAWG_API_KEY).

import { readFileSync, writeFileSync } from "fs";

const COVERS_FILE = "covers.json";
const FEATURED_FILE = "featured-games.json";
const GITHUB_API = "https://api.github.com";
const MS_AUTOSUGGEST =
  "https://www.microsoft.com/msstoreapiprod/api/autosuggest" +
  "?market=es-mx&clientId=7F27B536-CF6B-4C65-8638-A0F8CBDFCA65&sources=DCatAll-Products&query=";
const UA = "Mozilla/5.0 (compatible; ReyMidasDigitales/1.0)";

// Espejo de cleanTitleForRawg() en app.js: quita ™, sufijos de plataforma y
// nombres de edición para mejorar el match contra el catálogo de MS.
function cleanTitle(t) {
  return String(t || "")
    .replace(/[™®©]/g, "")
    .replace(/\s*\[(PS5|PS4|XBOX|Xbox|Series X\|S|Series X)\]/gi, "")
    .replace(/\b(Standard|Deluxe|Ultimate|Gold|Premium|Definitive|Complete|GOTY|Game of the Year|Collector'?s)\s+Edition\b/gi, "")
    .replace(/\b(Cross[- ]?Gen Bundle|Bundle|Pack)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Espejo de titlesMatch() en api/cover.js: inclusión o ≥60% de palabras.
function titlesMatch(a, b) {
  const norm = (s) =>
    String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  if (B.includes(A) || A.includes(B)) return true;
  const aw = A.split(" ").filter((w) => w.length > 2);
  if (!aw.length) return false;
  const bw = new Set(B.split(" "));
  return aw.filter((w) => bw.has(w)).length / aw.length >= 0.6;
}

// URL de box-art en alta: quita el ?w=150&h=150 y pide 720×720 nítido.
function hiResBoxArt(imageUrl) {
  if (!imageUrl) return "";
  let u = imageUrl.split("?")[0];
  if (u.startsWith("//")) u = "https:" + u;
  return `${u}?q=90&w=720&h=720`;
}

async function msFindBoxArt(title) {
  const q = cleanTitle(title);
  const r = await fetch(MS_AUTOSUGGEST + encodeURIComponent(q), {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) { const e = new Error(`MS HTTP ${r.status}`); e.status = r.status; throw e; }
  const data = await r.json();

  const suggests = [];
  for (const rs of data.ResultSets || []) for (const s of rs.Suggests || []) suggests.push(s);

  // Solo juegos con imagen; preferimos los que su título matchea el buscado
  // (evita agarrar un DLC u otro juego). Si ninguno matchea, no devolvemos nada.
  const games = suggests.filter((s) => {
    if (!s.ImageUrl) return false;
    const metas = s.Metas || [];
    const isGame = metas.some((m) => m.Key === "ProductType" && /game/i.test(m.Value)) || /juego|game/i.test(s.Source || "");
    return isGame;
  });
  const pick = games.find((s) => titlesMatch(q, s.Title || ""));
  if (!pick) return { url: "", matched: "" };
  return { url: hiResBoxArt(pick.ImageUrl), matched: pick.Title };
}

// ---- GitHub Contents API (solo en CI) ----
function ghHeaders() {
  return { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "rey-midas-cover-harvester" };
}
const ghRepo = () => process.env.GITHUB_REPO;
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

async function main() {
  const featured = JSON.parse(readFileSync(FEATURED_FILE, "utf8")).games || [];
  console.log(`[ms-harvest] ${featured.length} juegos en el catálogo`);

  let existing = {};
  try { existing = JSON.parse(readFileSync(COVERS_FILE, "utf8")).covers || {}; } catch {}
  console.log(`[ms-harvest] ${Object.keys(existing).length} URLs ya guardadas`);

  const covers = { ...existing };
  let added = 0, skipped = 0, missed = 0;
  const misses = [];

  for (const g of featured) {
    if (!g.id) continue;
    if (covers[g.id]) { skipped++; continue; }

    try {
      const { url, matched } = await msFindBoxArt(g.title);
      if (!url) {
        misses.push(g.title);
        missed++;
        console.log(`  · sin match en MS: ${g.title}`);
      } else {
        covers[g.id] = url;
        added++;
        console.log(`  ✓ ${g.id}  (${matched})`);
      }
    } catch (e) {
      misses.push(g.title);
      missed++;
      console.log(`  ✗ ${g.title}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const obj = { generated: new Date().toISOString(), source: "ms-store", total: Object.keys(covers).length, covers };
  const inCI = !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);

  if (added > 0 && inCI) {
    await commitFile(COVERS_FILE, obj, `chore(covers): +${added} carátulas desde MS Store (${skipped} ya, ${missed} sin match)`);
    console.log(`\n[ms-harvest] ✅ covers.json commiteado vía API. Total: ${obj.total} con portada.`);
  } else {
    writeFileSync(COVERS_FILE, JSON.stringify(obj, null, 2) + "\n", "utf8");
    console.log(`\n[ms-harvest] ✅ covers.json escrito en disco. Total: ${obj.total} con portada  (nuevas:${added}  ya:${skipped}  sin match:${missed})`);
  }
  if (misses.length) console.log(`[ms-harvest] Sin match (exclusivos/no en MS):\n  - ${misses.join("\n  - ")}`);
}

main().catch((e) => { console.error("[ms-harvest] Fatal:", e.message); process.exit(1); });

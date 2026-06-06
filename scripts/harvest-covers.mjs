// Cosechador de carátulas → Bana Hosting
// =======================================
// Corre en GitHub Actions (internet abierto, sin los bloqueos del sandbox).
// Flujo:
//   1. Lee featured-games.json (los juegos del catálogo curado que dependen
//      de RAWG para su portada).
//   2. Para cada juego sin imagen, busca la carátula en la API de RAWG.
//   3. Descarga la imagen y la sube por FTP a Bana, a la carpeta /covers.
//   4. Detecta automáticamente cuál URL pública sirve esos archivos
//      (subiendo un archivo de prueba y probando varios dominios candidatos).
//   5. Escribe covers.json (id → URL pública en Bana) y lo commitea al repo
//      vía la Contents API de GitHub. El sitio lo lee y deja de pedirle
//      portadas a RAWG: cero cuota, carga directa desde Bana.
//
// Variables de entorno (se inyectan como secrets en el workflow):
//   RAWG_API_KEY   — key de RAWG para buscar las imágenes (una vez)
//   BANA_HOST      — ej ftp.grafticocr.com
//   BANA_USER      — ej haiku@reymidascr.com
//   BANA_PASSWORD  — contraseña FTP
//   BANA_PUBLIC_URL— (opcional) base pública si ya la conocés, ej
//                    https://grafiticocr.com/covers . Si se omite, se detecta.
//   BANA_REMOTE_DIR— (opcional) carpeta remota, default "covers"
//   GITHUB_TOKEN   — token del runner (lo da Actions solo)
//   GITHUB_REPO    — owner/repo (lo da Actions: github.repository)
//   GITHUB_BRANCH  — rama destino (lo da Actions: github.ref_name)

import { readFileSync } from "fs";
import { Client } from "basic-ftp";
import { Readable } from "stream";

const GITHUB_API = "https://api.github.com";
const RAWG_BASE = "https://api.rawg.io/api";
const COVERS_FILE = "covers.json";
const REMOTE_DIR = process.env.BANA_REMOTE_DIR || "covers";

// ---------- utilidades de título (espejo de app.js) ----------
function cleanTitleForRawg(t) {
  return String(t || "")
    .replace(/[™®©]/g, "")
    .replace(/\s*\[(PS5|PS4|XBOX|Xbox|Series X\|S|Series X)\]/gi, "")
    .replace(/\b(Standard|Deluxe|Ultimate|Gold|Premium|Definitive|Complete|GOTY|Game of the Year|Collector'?s)\s+Edition\b/gi, "")
    .replace(/\b(Cross[- ]?Gen Bundle|Bundle|Pack)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------- RAWG ----------
async function rawgSearchImage(title) {
  const key = process.env.RAWG_API_KEY;
  if (!key) throw new Error("Falta RAWG_API_KEY");
  const q = cleanTitleForRawg(title);
  const url = `${RAWG_BASE}/games?key=${key}&search=${encodeURIComponent(q)}&search_precise=true&page_size=1`;
  const r = await fetch(url, {
    headers: { "User-Agent": "rey-midas-cover-harvester/1.0", Accept: "application/json" },
  });
  if (!r.ok) {
    const e = new Error(`RAWG HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  const data = await r.json();
  const hit = data.results?.[0];
  return hit?.background_image || "";
}

async function downloadImage(imageUrl) {
  const r = await fetch(imageUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  // RAWG sirve JPG/PNG; usamos la extensión de la URL o jpg por defecto.
  const m = imageUrl.toLowerCase().match(/\.(jpe?g|png|webp)(?:\?|$)/);
  const ext = m ? (m[1] === "jpeg" ? "jpg" : m[1]) : "jpg";
  return { buf, ext };
}

// ---------- FTP / Bana ----------
async function ftpConnect() {
  const client = new Client(30_000);
  await client.access({
    host: process.env.BANA_HOST,
    user: process.env.BANA_USER,
    password: process.env.BANA_PASSWORD,
    secure: false,
  });
  await client.ensureDir(REMOTE_DIR); // entra/crea la carpeta covers
  return client;
}

async function ftpUploadBuffer(client, buf, remoteName) {
  await client.uploadFrom(Readable.from(buf), remoteName);
}

// Sube un archivo de prueba y averigua qué dominio público lo sirve.
async function detectPublicBase(client) {
  if (process.env.BANA_PUBLIC_URL) {
    const base = process.env.BANA_PUBLIC_URL.replace(/\/+$/, "");
    console.log(`[bana] Usando BANA_PUBLIC_URL provista: ${base}`);
    return base;
  }
  const probeName = `_probe_${Date.now()}.txt`;
  const token = `ok-${Date.now()}`;
  await ftpUploadBuffer(client, Buffer.from(token, "utf8"), probeName);

  // Candidatos derivados del usuario y del host FTP.
  const userDomain = (process.env.BANA_USER || "").split("@")[1] || "";
  const hostDomain = (process.env.BANA_HOST || "").replace(/^ftp\./, "");
  const domains = [...new Set([userDomain, hostDomain].filter(Boolean))];
  const candidates = [];
  for (const d of domains) {
    candidates.push(`https://${d}/${REMOTE_DIR}`);
    candidates.push(`https://www.${d}/${REMOTE_DIR}`);
  }

  let found = "";
  for (const base of candidates) {
    const testUrl = `${base}/${probeName}`;
    try {
      const r = await fetch(testUrl, { redirect: "follow" });
      if (r.ok) {
        const txt = (await r.text()).trim();
        if (txt === token) { found = base; console.log(`[bana] ✓ URL pública detectada: ${base}`); break; }
      }
      console.log(`[bana] ✗ no sirve: ${testUrl} (HTTP ${r.status})`);
    } catch (e) {
      console.log(`[bana] ✗ no sirve: ${testUrl} (${e.message})`);
    }
  }
  // limpieza del probe (best-effort)
  try { await client.remove(probeName); } catch {}

  if (!found) {
    throw new Error(
      "No pude detectar una URL pública que sirva los archivos de Bana. " +
      "Los archivos se subieron, pero ningún dominio probado los devuelve. " +
      "Probá pasando BANA_PUBLIC_URL con el dominio/subdominio que apunta a Bana " +
      `(probé: ${candidates.join(", ")}).`
    );
  }
  return found;
}

// ---------- GitHub Contents API ----------
function ghHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Falta GITHUB_TOKEN");
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "rey-midas-cover-harvester" };
}
function ghRepo() { const r = process.env.GITHUB_REPO; if (!r) throw new Error("Falta GITHUB_REPO"); return r; }
function ghBranch() { return process.env.GITHUB_BRANCH || "main"; }

async function getRepoFileSha(path) {
  const url = `${GITHUB_API}/repos/${ghRepo()}/contents/${path}?ref=${encodeURIComponent(ghBranch())}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).sha;
}

async function commitRepoFile(path, contentObj, message) {
  const sha = await getRepoFileSha(path);
  const body = {
    message,
    content: Buffer.from(JSON.stringify(contentObj, null, 2) + "\n", "utf8").toString("base64"),
    branch: ghBranch(),
    ...(sha ? { sha } : {}),
  };
  const r = await fetch(`${GITHUB_API}/repos/${ghRepo()}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`GitHub PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// ---------- main ----------
async function main() {
  const featured = JSON.parse(readFileSync("featured-games.json", "utf8")).games || [];
  console.log(`[harvest] ${featured.length} juegos featured en el catálogo`);

  // Reusar covers.json existente para no re-descargar lo ya guardado.
  let existing = {};
  try { existing = JSON.parse(readFileSync(COVERS_FILE, "utf8")).covers || {}; } catch {}

  const client = await ftpConnect();
  console.log(`[bana] conectado a ${process.env.BANA_HOST}, carpeta "${REMOTE_DIR}"`);
  const publicBase = await detectPublicBase(client);

  const covers = { ...existing };
  let added = 0, skipped = 0, failed = 0, quotaHit = false;

  for (const g of featured) {
    if (!g.id) continue;
    if (covers[g.id]) { skipped++; continue; } // ya cosechado

    try {
      const imageUrl = await rawgSearchImage(g.title);
      if (!imageUrl) { console.log(`  · sin imagen en RAWG: ${g.title}`); failed++; continue; }

      const { buf, ext } = await downloadImage(imageUrl);
      const remoteName = `${g.id}.${ext}`;
      await ftpUploadBuffer(client, buf, remoteName);
      covers[g.id] = `${publicBase}/${remoteName}`;
      added++;
      console.log(`  ✓ ${g.id} (${g.title}) ${Math.round(buf.length / 1024)}KB`);
    } catch (e) {
      if (e.status === 401 || e.status === 429) {
        console.log(`  ! cupo de RAWG agotado, corto acá (procesados ${added})`);
        quotaHit = true;
        break;
      }
      console.log(`  ✗ ${g.id}: ${e.message}`);
      failed++;
    }
    await new Promise(r => setTimeout(r, 150)); // suave con RAWG
  }

  client.close();

  // Subir también covers.json a Bana (por si el sitio lo quiere leer de ahí).
  const dbObj = { generated: new Date().toISOString(), publicBase, total: Object.keys(covers).length, covers };

  if (added > 0) {
    const msg = `chore(covers): +${added} carátulas en Bana (${skipped} ya estaban, ${failed} sin match)` + (quotaHit ? " [cupo RAWG agotado]" : "");
    await commitRepoFile(COVERS_FILE, dbObj, msg);
    console.log(`\n[harvest] ✅ Commit hecho. Total acumulado: ${dbObj.total} carátulas.`);
  } else {
    console.log(`\n[harvest] Nada nuevo que commitear (skipped ${skipped}, failed ${failed}).`);
  }

  console.log(`[harvest] Resumen → nuevas:${added} ya:${skipped} fallidas:${failed}${quotaHit ? " (cortado por cupo)" : ""}`);
}

main().catch(e => { console.error("[harvest] Fatal:", e.message); process.exit(1); });

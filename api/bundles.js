// CRUD de bundles MANUALES de PlayStation y Xbox (ps-bundles.json /
// xbox-bundles.json). Solo administradores. Commitea los cambios a GitHub
// vía la Contents API — Vercel detecta el push y redespliega solo, igual
// que hace el webhook de Telegram para los bundles de Nintendo.
//
// POST /api/bundles con:
//   { action: "list" }                          → { ps:[...], xbox:[...] }
//   { action: "save", platform, bundle, coverFile? } → { ok, bundles }
//   { action: "delete", platform, id }          → { ok, bundles }
//
// `coverFile` (opcional) = { dataBase64, ext }. Si viene, primero se sube la
// imagen a assets/bundles/<platform>-<id>.<ext> y se usa esa ruta como
// coverUrl. Si no, se respeta el coverUrl que mande el cliente (URL pegada).
//
// Variables de entorno (ya configuradas en Vercel para el webhook):
//   GITHUB_TOKEN   — PAT con scope repo (contents: write)
//   GITHUB_REPO    — ej "grafitico/rey-midas-digitales"
//   GITHUB_BRANCH  — opcional, default "main"

import { requireAdmin, handleError, readJson } from "./_lib.js";

const FILES = { ps: "ps-bundles.json", xbox: "xbox-bundles.json" };
const API = "https://api.github.com";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const body = await readJson(req);
    if (body.action === "list") return await list(req, res);
    if (body.action === "save") return await save(req, res, body);
    if (body.action === "delete") return await del(req, res, body);
    return res.status(400).json({ error: "Acción desconocida" });
  } catch (err) {
    handleError(res, err);
  }
}

// ===== GitHub helpers =====
function ghHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    const e = new Error("Falta GITHUB_TOKEN en el servidor.");
    e.status = 500;
    throw e;
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "rey-midas-admin-bundles",
  };
}
function ghRepo() {
  // GITHUB_REPO explícito, o lo derivamos de las variables que Vercel expone
  // solo en proyectos conectados a git (no requieren configuración manual).
  const explicit = process.env.GITHUB_REPO;
  if (explicit) return explicit;
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  if (owner && slug) return `${owner}/${slug}`;
  const e = new Error("Falta GITHUB_REPO en el servidor (y no se pudo derivar de Vercel).");
  e.status = 500;
  throw e;
}
function ghBranch() {
  // Rama destino: explícita, o la rama del deploy actual (en producción = main).
  return process.env.GITHUB_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || "main";
}

// Devuelve { sha, content(base64 string) } o null si el archivo no existe (404).
async function ghGetFile(path) {
  const url = `${API}/repos/${ghRepo()}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ghBranch())}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const meta = await r.json();
  return { sha: meta.sha, content: meta.content };
}

// PUT genérico. `contentBase64` ya debe venir codificado en base64.
async function ghPutFile(path, contentBase64, message, sha) {
  const url = `${API}/repos/${ghRepo()}/contents/${encodeURIComponent(path)}`;
  const payload = { message, content: contentBase64, branch: ghBranch() };
  if (sha) payload.sha = sha;
  const r = await fetch(url, {
    method: "PUT",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r;
}

// Lee y parsea uno de los JSON de bundles. Si no existe, devuelve estructura vacía.
async function readBundlesFile(file) {
  const f = await ghGetFile(file);
  if (!f) return { sha: null, data: { bundles: [] } };
  const data = JSON.parse(Buffer.from(f.content, "base64").toString("utf8"));
  if (!Array.isArray(data.bundles)) data.bundles = [];
  return { sha: f.sha, data };
}

// Commitea el JSON con reintento si el SHA quedó viejo por otro commit.
async function writeBundlesFile(file, mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data } = await readBundlesFile(file);
    mutate(data);
    const contentB64 = Buffer.from(JSON.stringify(data, null, 2) + "\n", "utf8").toString("base64");
    const r = await ghPutFile(file, contentB64, message, sha);
    if (r.ok) return data.bundles;
    if (r.status === 409 || r.status === 422) continue; // SHA stale → releer
    throw new Error(`GitHub PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error("No se pudo guardar (conflicto de versiones tras varios intentos).");
}

// ===== Acciones =====
async function list(req, res) {
  await requireAdmin(req);
  const [ps, xbox] = await Promise.all([readBundlesFile(FILES.ps), readBundlesFile(FILES.xbox)]);
  res.status(200).json({ ps: ps.data.bundles, xbox: xbox.data.bundles });
}

async function save(req, res, body) {
  await requireAdmin(req);
  const platform = String(body.platform || "").toLowerCase();
  const file = FILES[platform];
  if (!file) return res.status(400).json({ error: "Plataforma inválida (ps o xbox)." });

  const input = body.bundle || {};
  const id = String(input.id || "").trim() || genId();

  const priceCRC = Number(input.priceCRC);
  if (!Number.isFinite(priceCRC) || priceCRC <= 0) {
    return res.status(400).json({ error: "El precio debe ser un número mayor a 0." });
  }

  const games = Array.isArray(input.games)
    ? input.games
        .map(g => ({ name: String(g.name || "").trim(), size: String(g.size || "").trim() }))
        .filter(g => g.name)
    : [];
  if (!games.length) return res.status(400).json({ error: "Agregá al menos un juego." });

  let discountPct = null;
  if (input.discountPct !== "" && input.discountPct != null) {
    const d = Math.round(Number(input.discountPct));
    if (Number.isFinite(d) && d > 0 && d < 100) discountPct = d;
  }

  // Portada: si suben archivo, lo commiteamos y usamos esa ruta. Si no,
  // respetamos la URL pegada (o vacío).
  let coverUrl = String(input.coverUrl || "").trim();
  if (body.coverFile && body.coverFile.dataBase64) {
    const imgBuf = Buffer.from(String(body.coverFile.dataBase64), "base64");
    if (!isValidImageBuffer(imgBuf)) {
      return res.status(400).json({ error: "El archivo de portada no es una imagen válida (jpeg, png, webp o gif)." });
    }
    const ext = sanitizeExt(body.coverFile.ext);
    const imgPath = `assets/bundles/${platform}-${id}.${ext}`;
    const existing = await ghGetFile(imgPath);
    const putRes = await ghPutFile(
      imgPath,
      body.coverFile.dataBase64,
      `chore(bundles): portada ${platform} ${id}`,
      existing ? existing.sha : null,
    );
    if (!putRes.ok) {
      throw new Error(`No se pudo subir la imagen: GitHub ${putRes.status}`);
    }
    coverUrl = `/${imgPath}`;
  }

  const bundle = {
    id,
    priceCRC,
    coverUrl,
    totalSize: String(input.totalSize || "").trim(),
    games,
    date: input.date || new Date().toISOString(),
  };
  if (input.title) bundle.title = String(input.title).trim();
  if (discountPct != null) bundle.discountPct = discountPct;

  const bundles = await writeBundlesFile(
    file,
    (data) => {
      const idx = data.bundles.findIndex(b => String(b.id) === id);
      if (idx >= 0) {
        // Preservamos coverUrl previo si ahora no mandan uno nuevo.
        if (!bundle.coverUrl) bundle.coverUrl = data.bundles[idx].coverUrl || "";
        data.bundles[idx] = bundle;
      } else {
        data.bundles.unshift(bundle);
      }
    },
    `chore(bundles): ${platform} ${id} via admin`,
  );

  res.status(200).json({ ok: true, bundle, bundles });
}

async function del(req, res, body) {
  await requireAdmin(req);
  const platform = String(body.platform || "").toLowerCase();
  const file = FILES[platform];
  if (!file) return res.status(400).json({ error: "Plataforma inválida (ps o xbox)." });
  const id = String(body.id || "").trim();
  if (!id) return res.status(400).json({ error: "Falta el id del bundle." });

  const bundles = await writeBundlesFile(
    file,
    (data) => { data.bundles = data.bundles.filter(b => String(b.id) !== id); },
    `chore(bundles): borrar ${platform} ${id} via admin`,
  );
  res.status(200).json({ ok: true, bundles });
}

// ===== utils =====
function genId() {
  return String(Date.now()).slice(-9);
}
function sanitizeExt(ext) {
  const e = String(ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(e) ? e : "jpg";
}
function isValidImageBuffer(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true; // GIF
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true; // WebP
  return false;
}

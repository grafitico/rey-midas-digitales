// CRUD del listado especial de canje del Cofre de Oro (cofre-games.json).
// Solo administradores. Commitea los cambios a GitHub vía la Contents API
// (mismo mecanismo que api/bundles.js); Vercel detecta el push y redespliega.
//
// POST /api/cofre-games con:
//   { action: "list" }                               → { games:[...] }
//   { action: "save", game, imageFile? }             → { ok, games }
//   { action: "delete", match }                      → { ok, games }
//
// `game` = { id?, title, platform, imageUrl?, match? }.
//   - match: id o título original del juego que se está editando.
// `imageFile` (opcional) = { dataBase64, ext }. Si viene, se sube a
//   assets/cofre/<id>.<ext> y se usa esa ruta como imageUrl.
//
// Variables de entorno (ya configuradas en Vercel, iguales que bundles):
//   GITHUB_TOKEN, GITHUB_REPO (o VERCEL_GIT_*), GITHUB_BRANCH (opcional).

import { requireAdmin, handleError, readJson } from "./_lib.js";

const FILE = "cofre-games.json";
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
    "User-Agent": "rey-midas-admin-cofre",
  };
}
function ghRepo() {
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
  return process.env.GITHUB_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || "main";
}

async function ghGetFile(path) {
  const url = `${API}/repos/${ghRepo()}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ghBranch())}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub GET ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const meta = await r.json();
  return { sha: meta.sha, content: meta.content };
}

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

// Lee y parsea cofre-games.json. Si no existe, devuelve estructura vacía.
async function readGamesFile() {
  const f = await ghGetFile(FILE);
  if (!f) return { sha: null, data: { games: [] } };
  const data = JSON.parse(Buffer.from(f.content, "base64").toString("utf8"));
  if (!Array.isArray(data.games)) data.games = [];
  return { sha: f.sha, data };
}

// Commitea el JSON con reintento si el SHA quedó viejo por otro commit.
async function writeGamesFile(mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data } = await readGamesFile();
    mutate(data);
    data.updatedAt = new Date().toISOString().slice(0, 10);
    const contentB64 = Buffer.from(JSON.stringify(data, null, 2) + "\n", "utf8").toString("base64");
    const r = await ghPutFile(FILE, contentB64, message, sha);
    if (r.ok) return data.games;
    if (r.status === 409 || r.status === 422) continue; // SHA stale → releer
    throw new Error(`GitHub PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error("No se pudo guardar (conflicto de versiones tras varios intentos).");
}

// ===== Acciones =====
async function list(req, res) {
  await requireAdmin(req);
  const { data } = await readGamesFile();
  // Aseguramos un id estable para cada juego (los antiguos no lo tenían) para
  // que el panel pueda editar/borrar sin ambigüedad. No persiste hasta guardar.
  const games = data.games.map(g => ({ ...g, id: g.id || slugId(g.title) }));
  res.status(200).json({ games });
}

async function save(req, res, body) {
  await requireAdmin(req);
  const input = body.game || {};
  const title = String(input.title || "").trim();
  const platform = String(input.platform || "").trim();
  if (!title) return res.status(400).json({ error: "El título es obligatorio." });
  if (!platform) return res.status(400).json({ error: "La consola es obligatoria." });

  const match = String(input.match || "").trim();
  const id = String(input.id || "").trim() || match || slugId(title);

  const game = { id, title, platform };
  let imageUrl = String(input.imageUrl || "").trim();

  // Imagen: si suben archivo, lo commiteamos y usamos esa ruta. Si no,
  // respetamos la URL pegada (o vacío).
  if (body.imageFile && body.imageFile.dataBase64) {
    const ext = sanitizeExt(body.imageFile.ext);
    const imgPath = `assets/cofre/${id}.${ext}`;
    const existing = await ghGetFile(imgPath);
    const putRes = await ghPutFile(
      imgPath,
      body.imageFile.dataBase64,
      `chore(cofre): portada canje ${id}`,
      existing ? existing.sha : null,
    );
    if (!putRes.ok) throw new Error(`No se pudo subir la imagen: GitHub ${putRes.status}`);
    imageUrl = `/${imgPath}`;
  }
  if (imageUrl) game.imageUrl = imageUrl;

  const games = await writeGamesFile(
    (data) => {
      const idx = data.games.findIndex(g =>
        (match && (String(g.id) === match || g.title === match)) || String(g.id) === id);
      if (idx >= 0) {
        // Preservamos la imagen previa si ahora no mandan una nueva.
        if (!game.imageUrl && data.games[idx].imageUrl) game.imageUrl = data.games[idx].imageUrl;
        data.games[idx] = game;
      } else {
        data.games.push(game);
      }
    },
    `chore(cofre): guardar canje "${title}" via admin`,
  );

  res.status(200).json({ ok: true, game, games });
}

async function del(req, res, body) {
  await requireAdmin(req);
  const match = String(body.match || "").trim();
  if (!match) return res.status(400).json({ error: "Falta el identificador del juego." });
  const games = await writeGamesFile(
    (data) => { data.games = data.games.filter(g => String(g.id) !== match && g.title !== match); },
    `chore(cofre): borrar canje "${match}" via admin`,
  );
  res.status(200).json({ ok: true, games });
}

// ===== utils =====
// Id legible y estable a partir del título (para juegos que no lo tenían).
function slugId(title) {
  const base = String(title || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return base || String(Date.now()).slice(-9);
}
function sanitizeExt(ext) {
  const e = String(ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(e) ? e : "jpg";
}

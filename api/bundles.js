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
    if (body.action === "cofre-list") return await cofreList(req, res);
    if (body.action === "cofre-save") return await cofreSave(req, res, body);
    if (body.action === "cofre-delete") return await cofreDelete(req, res, body);
    if (body.action === "oferta-list") return await ofertaList(req, res);
    if (body.action === "oferta-save") return await ofertaSave(req, res, body);
    if (body.action === "oferta-delete") return await ofertaDelete(req, res, body);
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

// ===== Listado de canje del Cofre de Oro (cofre-games.json) =====
// Vive en este mismo archivo (en vez de api/cofre-games.js) porque Vercel
// Hobby limita a 12 Serverless Functions por deploy y ya estábamos en ese
// tope; agregar un archivo nuevo rompía TODOS los deploys. Mismo mecanismo
// de commit a GitHub que los bundles de arriba.
const COFRE_FILE = "cofre-games.json";

async function readCofreFile() {
  const f = await ghGetFile(COFRE_FILE);
  if (!f) return { sha: null, data: { games: [] } };
  const data = JSON.parse(Buffer.from(f.content, "base64").toString("utf8"));
  if (!Array.isArray(data.games)) data.games = [];
  return { sha: f.sha, data };
}

async function writeCofreFile(mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data } = await readCofreFile();
    mutate(data);
    data.updatedAt = new Date().toISOString().slice(0, 10);
    const contentB64 = Buffer.from(JSON.stringify(data, null, 2) + "\n", "utf8").toString("base64");
    const r = await ghPutFile(COFRE_FILE, contentB64, message, sha);
    if (r.ok) return data.games;
    if (r.status === 409 || r.status === 422) continue; // SHA stale → releer
    throw new Error(`GitHub PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error("No se pudo guardar (conflicto de versiones tras varios intentos).");
}

async function cofreList(req, res) {
  await requireAdmin(req);
  const { data } = await readCofreFile();
  // Aseguramos un id estable para cada juego (los antiguos no lo tenían) para
  // que el panel pueda editar/borrar sin ambigüedad. No persiste hasta guardar.
  const games = data.games.map(g => ({ ...g, id: g.id || slugId(g.title) }));
  res.status(200).json({ games });
}

async function cofreSave(req, res, body) {
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

  const games = await writeCofreFile(
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

async function cofreDelete(req, res, body) {
  await requireAdmin(req);
  const match = String(body.match || "").trim();
  if (!match) return res.status(400).json({ error: "Falta el identificador del juego." });
  const games = await writeCofreFile(
    (data) => { data.games = data.games.filter(g => String(g.id) !== match && g.title !== match); },
    `chore(cofre): borrar canje "${match}" via admin`,
  );
  res.status(200).json({ ok: true, games });
}

// ===== Ofertas de Oportunidad VIP (reservaciones.json) =====
// Reutilizamos el archivo reservaciones.json (la vista /reservaciones que se
// rebautizó como "Ofertas de Oportunidad VIP"). Cada oferta lleva precio de
// cuenta primaria y secundaria (PS4/PS5) o primaria y segundo plano (Xbox),
// más un precio regular opcional para calcular el ahorro. Mismo mecanismo de
// commit a GitHub que el Cofre.
const OFERTA_FILE = "reservaciones.json";

async function readOfertaFile() {
  const f = await ghGetFile(OFERTA_FILE);
  if (!f) return { sha: null, data: { items: [] } };
  const data = JSON.parse(Buffer.from(f.content, "base64").toString("utf8"));
  if (!Array.isArray(data.items)) data.items = [];
  return { sha: f.sha, data };
}

async function writeOfertaFile(mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data } = await readOfertaFile();
    mutate(data);
    const contentB64 = Buffer.from(JSON.stringify(data, null, 2) + "\n", "utf8").toString("base64");
    const r = await ghPutFile(OFERTA_FILE, contentB64, message, sha);
    if (r.ok) return data.items;
    if (r.status === 409 || r.status === 422) continue; // SHA stale → releer
    throw new Error(`GitHub PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error("No se pudo guardar (conflicto de versiones tras varios intentos).");
}

function toIntOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Math.round(Number(String(v).replace(/[^\d.-]/g, "")));
  return Number.isFinite(n) ? n : null;
}

async function ofertaList(req, res) {
  await requireAdmin(req);
  const { data } = await readOfertaFile();
  const items = data.items.map(o => ({ ...o, id: o.id || slugId(o.title) }));
  res.status(200).json({ items });
}

async function ofertaSave(req, res, body) {
  await requireAdmin(req);
  const input = body.oferta || {};
  const title = String(input.title || "").trim();
  const platform = String(input.platform || "").trim();
  if (!title) return res.status(400).json({ error: "El título es obligatorio." });
  if (!platform) return res.status(400).json({ error: "La consola es obligatoria." });

  const match = String(input.match || "").trim();
  const id = String(input.id || "").trim() || match || slugId(title);

  const oferta = {
    id,
    title,
    platform,
    priceCRC_principal: toIntOrNull(input.priceCRC_principal),
    priceCRC_secundaria: toIntOrNull(input.priceCRC_secundaria),
    priceCRC_regular: toIntOrNull(input.priceCRC_regular),
  };
  const description = String(input.description || "").trim();
  if (description) oferta.description = description;

  let imageUrl = String(input.imageUrl || "").trim();
  if (body.imageFile && body.imageFile.dataBase64) {
    const ext = sanitizeExt(body.imageFile.ext);
    const imgPath = `assets/ofertas/${id}.${ext}`;
    const existing = await ghGetFile(imgPath);
    const putRes = await ghPutFile(
      imgPath,
      body.imageFile.dataBase64,
      `chore(ofertas): portada ${id}`,
      existing ? existing.sha : null,
    );
    if (!putRes.ok) throw new Error(`No se pudo subir la imagen: GitHub ${putRes.status}`);
    imageUrl = `/${imgPath}`;
  }
  if (imageUrl) oferta.imageUrl = imageUrl;

  const items = await writeOfertaFile(
    (data) => {
      const idx = data.items.findIndex(o =>
        (match && (String(o.id) === match || o.title === match)) || String(o.id) === id);
      if (idx >= 0) {
        if (!oferta.imageUrl && data.items[idx].imageUrl) oferta.imageUrl = data.items[idx].imageUrl;
        data.items[idx] = oferta;
      } else {
        data.items.push(oferta);
      }
    },
    `chore(ofertas): guardar "${title}" via admin`,
  );

  res.status(200).json({ ok: true, oferta, items });
}

async function ofertaDelete(req, res, body) {
  await requireAdmin(req);
  const match = String(body.match || "").trim();
  if (!match) return res.status(400).json({ error: "Falta el identificador de la oferta." });
  const items = await writeOfertaFile(
    (data) => { data.items = data.items.filter(o => String(o.id) !== match && o.title !== match); },
    `chore(ofertas): borrar "${match}" via admin`,
  );
  res.status(200).json({ ok: true, items });
}

function slugId(title) {
  const base = String(title || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return base || String(Date.now()).slice(-9);
}

// ===== utils =====
function genId() {
  return String(Date.now()).slice(-9);
}
function sanitizeExt(ext) {
  const e = String(ext || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(e) ? e : "jpg";
}

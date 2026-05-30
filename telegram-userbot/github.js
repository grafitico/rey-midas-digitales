// Cliente mínimo de GitHub Contents API para leer y commitear
// nintendo-bundles.json. Hace un GET para sacar el SHA actual y un PUT
// con el contenido nuevo (base64). Reintenta una vez si el SHA quedó
// desactualizado por otro commit en el mismo segundo.

const API = "https://api.github.com";
const FILE = "nintendo-bundles.json";

function headers() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Falta GITHUB_TOKEN en .env");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "rey-midas-telegram-userbot",
  };
}

function repo() {
  const r = process.env.GITHUB_REPO;
  if (!r) throw new Error("Falta GITHUB_REPO en .env (ej grafitico/rey-midas-digitales)");
  return r;
}

function branch() {
  return process.env.GITHUB_BRANCH || "main";
}

async function getFile() {
  const url = `${API}/repos/${repo()}/contents/${FILE}?ref=${encodeURIComponent(branch())}`;
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) throw new Error(`GitHub GET ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const meta = await r.json();
  const content = JSON.parse(Buffer.from(meta.content, "base64").toString("utf8"));
  return { sha: meta.sha, content };
}

async function putFile(sha, content, message) {
  const url = `${API}/repos/${repo()}/contents/${FILE}`;
  const body = {
    message,
    content: Buffer.from(JSON.stringify(content, null, 2) + "\n", "utf8").toString("base64"),
    sha,
    branch: branch(),
  };
  const r = await fetch(url, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r;
}

export async function upsertBundle(bundle) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { sha, content } = await getFile();
    const bundles = Array.isArray(content.bundles) ? content.bundles : [];
    const idx = bundles.findIndex(b => b.id === bundle.id);
    let action;
    if (idx >= 0) {
      const prev = bundles[idx];
      bundles[idx] = { ...bundle, coverUrl: prev.coverUrl || bundle.coverUrl };
      action = "updated";
    } else {
      bundles.unshift(bundle);
      action = "added";
    }
    content.bundles = bundles;

    const msg = `chore(bundles): ${action} ${bundle.id} via telegram userbot`;
    const r = await putFile(sha, content, msg);
    if (r.ok) return { action };
    if (r.status === 409 || r.status === 422) {
      // SHA stale — alguien más commiteó. Releer y reintentar.
      continue;
    }
    throw new Error(`GitHub PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error("GitHub PUT falló por conflicto de SHA tras reintento");
}

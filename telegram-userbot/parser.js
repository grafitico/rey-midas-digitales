// Parser de mensajes del canal — espejo del que vive en api/telegram-webhook.js.
// Si cambia el formato de los posts, ajustar los regex en ambos archivos.

export function parseBundle(text) {
  if (!text || typeof text !== "string") return null;

  const id = matchOne(text, [
    /ID[:\s#]*([A-Z0-9]{4,8})/i,
    /C[oó]digo[:\s#]*([A-Z0-9]{4,8})/i,
    /\b([A-Z0-9]{6})\b/,
  ]);
  if (!id) return null;

  const priceCRC = parsePrice(text);

  const totalSize = matchOne(text, [
    /Tama[ñn]o[:\s]+([\d.,]+\s*[gmGM][bB])/,
    /Total[:\s]+([\d.,]+\s*[gmGM][bB])/,
  ]) || "";

  const games = parseGames(text);
  if (!games.length) return null;

  return {
    id: id.toUpperCase(),
    priceCRC: priceCRC || 0,
    coverUrl: "",
    totalSize: totalSize.toLowerCase().replace(/\s+/g, ""),
    games,
  };
}

function matchOne(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function parsePrice(text) {
  const m = text.match(/(?:₡|colones?|crc)[\s:]*([\d.,]+)/i)
    || text.match(/precio[:\s]+([\d.,]+)/i);
  if (!m) return 0;
  const digits = m[1].replace(/[.,\s]/g, "");
  return parseInt(digits, 10) || 0;
}

function parseGames(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!/^[-*•·▪►]/.test(line)) continue;
    const content = line.replace(/^[-*•·▪►]\s*/, "");
    const sizeMatch = content.match(/[\(\[]?\s*([\d.,]+\s*[gmGM][bB])\s*[\)\]]?\s*$/);
    let name = content;
    let size = "";
    if (sizeMatch) {
      size = sizeMatch[1].toLowerCase().replace(/\s+/g, " ").trim();
      name = content.slice(0, sizeMatch.index).replace(/[\s\-–—]+$/, "").trim();
    }
    if (name) out.push({ name, size });
  }
  return out;
}

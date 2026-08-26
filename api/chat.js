// Asistente virtual de Rey Midas Digitales.
// POST /api/chat  — recibe { messages: [{role, content}] } y devuelve { reply, whatsapp? }.
//
// El "cerebro" es un LLM. Soporta dos proveedores según qué clave esté puesta
// en Vercel (la clave vive SOLO en el servidor; el navegador nunca la ve):
//   - GROQ_API_KEY    → Groq (Llama, gratis y sin tarjeta). PREFERIDO.
//   - GEMINI_API_KEY  → Google Gemini (requiere capa gratuita habilitada).
// La CSP del sitio permite connect-src 'self', así que el widget solo habla
// con este endpoint mismo-origen; la llamada al LLM la hace este servidor.

import { readJson } from "./_lib.js";
import fs from "fs";
import path from "path";

const WHATSAPP = "50661468733";

// Proveedor activo: Groq si hay GROQ_API_KEY; si no, Gemini.
function pickProvider() {
  if (process.env.GROQ_API_KEY) return { name: "groq", key: process.env.GROQ_API_KEY };
  if (process.env.GEMINI_API_KEY) return { name: "gemini", key: process.env.GEMINI_API_KEY };
  return { name: null, key: null };
}

// Modelos Gemini a intentar (override con GEMINI_MODEL).
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
].filter(Boolean);

// Modelos Groq a intentar (override con GROQ_MODEL). La lista es solo un punto
// de partida: cuando Groq retira un modelo responde 404 o 400
// "model_decommissioned", y ahí el asistente descubre solo cuáles tiene la
// clave (discoverGroqModels) en vez de quedarse mudo hasta que alguien edite
// este archivo.
//
// Los llama-3.x que estaban acá dejaron de existir (el ?selftest del 26/08/2026
// devolvió 404 en los dos y ningún llama de chat en la lista de la cuenta), que
// es exactamente por qué el asistente respondía "se me trabó la conexión" en la
// primera pregunta.
const GROQ_MODELS = [
  process.env.GROQ_MODEL,
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
].filter(Boolean);
const GROQ_BASE = "https://api.groq.com/openai/v1";
let GROQ_WORKING = null;
let GROQ_DISCOVERY_CACHE = null;

// Tope por llamada al proveedor. La función tiene 30s (vercel.json): sin este
// tope una sola llamada colgada se come el presupuesto entero, Vercel corta con
// 504 y el cliente ve el error genérico sin que quede rastro de por qué.
const LLM_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS) || 12000;

// Presupuesto total de la invocación. La función tiene 30s (vercel.json) y
// tiene que sobrar tiempo para devolver el JSON: si cada intento usara los 12s
// completos, cuatro intentos colgados llegarían a 48s y Vercel cortaría con un
// 504 — el cliente vería el chat "pensando" hasta que el navegador se rinde.
// Cada intento toma lo que quede, nunca más que LLM_TIMEOUT_MS.
const TOTAL_BUDGET_MS = Number(process.env.CHAT_BUDGET_MS) || 24000;
function startBudget() {
  const until = Date.now() + TOTAL_BUDGET_MS;
  return {
    slice: () => Math.max(0, Math.min(LLM_TIMEOUT_MS, until - Date.now())),
    exhausted: () => until - Date.now() < 1500,
  };
}

// fetch que aborta en vez de colgarse. El error va marcado con .timeout para
// poder reintentar solo lo que vale la pena reintentar.
async function fetchWithTimeout(url, options, timeoutMs) {
  const ms = timeoutMs || LLM_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (e) {
    if (e && (e.name === "AbortError" || /abort/i.test(e.message || ""))) {
      const err = new Error(`el proveedor no respondió en ${Math.round(ms / 1000)}s`);
      err.timeout = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ===== Precios (misma tabla e interpolación que app.js) =====
const PRICING = {
  exchangeRate: 530,
  principalMarkup: 0.75,
  secundariaMarkup: 0.35,
  minCRC: 1000,
  table: [
    [5, 1500, 1000],
    [10, 3500, 2000],
    [20, 5000, 3500],
    [30, 9500, 6000],
    [40, 15000, 7500],
    [50, 18000, 11000],
    [60, 25500, 13500],
    [70, 27500, 16000],
    [80, 33500, 18000],
  ],
  // Juegos SOLO PS5 (platform === "PS5"): máx. 3 ventas (2 principales + 1
  // secundaria) → piso sobre la inversión real (precio PSN con impuestos).
  // Espejo de ps5Only en app.js.
  ps5Only: { taxFactor: 1.04, principalPct: 0.65, secundariaPct: 0.35 },
  // Principal PlayStation siempre por debajo del oficial de playstation.com.
  underOficial: { highCRC: 30000, highRebaja: 5000, midCRC: 12000, midRebaja: 3500, cheapPct: 0.25 },
};
const roundTo500 = (n) => Math.round(n / 500) * 500;
function interpolateCRC(usd, colIdx) {
  const tbl = PRICING.table;
  if (!usd || usd <= 0) return 0;
  const col = (row) => row[colIdx + 1];
  if (usd <= tbl[0][0]) {
    const t = (usd - tbl[0][0]) / (tbl[1][0] - tbl[0][0]);
    return Math.max(0, roundTo500(col(tbl[0]) + t * (col(tbl[1]) - col(tbl[0]))));
  }
  const last = tbl.length - 1;
  if (usd >= tbl[last][0]) {
    const t = (usd - tbl[last - 1][0]) / (tbl[last][0] - tbl[last - 1][0]);
    return roundTo500(col(tbl[last - 1]) + t * (col(tbl[last]) - col(tbl[last - 1])));
  }
  for (let i = 0; i < tbl.length - 1; i++) {
    if (usd >= tbl[i][0] && usd <= tbl[i + 1][0]) {
      const t = (usd - tbl[i][0]) / (tbl[i + 1][0] - tbl[i][0]);
      return roundTo500(col(tbl[i]) + t * (col(tbl[i + 1]) - col(tbl[i])));
    }
  }
  return 0;
}
function ps5OnlyFloorCRC(usd, platform, pct) {
  if (String(platform).trim() !== "PS5" || !usd || usd <= 0) return 0;
  return roundTo500(usd * PRICING.exchangeRate * PRICING.ps5Only.taxFactor * pct);
}
function withMinCRC(price, usd) {
  if (!usd || usd <= 0) return price;
  return Math.max(price, PRICING.minCRC);
}
function officialCapCRC(usd, platform) {
  if (!/PS/i.test(platform) || !usd || usd <= 0) return Infinity;
  const cfg = PRICING.underOficial;
  const oficial = usd * PRICING.exchangeRate;
  const rebaja = oficial >= cfg.highCRC ? cfg.highRebaja
    : oficial >= cfg.midCRC ? cfg.midRebaja
    : Math.max(roundTo500(oficial * cfg.cheapPct), 500);
  return Math.max(roundTo500(oficial) - rebaja, 0);
}
function principalCRC(usd, platform = "") {
  const base = /PS|Xbox/i.test(platform)
    ? interpolateCRC(usd, 0)
    : Math.round(usd * PRICING.exchangeRate * PRICING.principalMarkup);
  const floor = ps5OnlyFloorCRC(usd, platform, PRICING.ps5Only.principalPct);
  const cap = officialCapCRC(usd, platform);
  return withMinCRC(Math.min(Math.max(base, floor), cap), usd);
}
function secundariaCRC(usd, platform = "") {
  const base = /PS|Xbox/i.test(platform)
    ? interpolateCRC(usd, 1)
    : Math.round(usd * PRICING.exchangeRate * PRICING.secundariaMarkup);
  const floor = ps5OnlyFloorCRC(usd, platform, PRICING.ps5Only.secundariaPct);
  return withMinCRC(Math.max(base, floor), usd);
}
// ===== Carga del catálogo (memoizado en warm start) =====
// El catálogo viaja dentro del prompt de sistema en CADA consulta, así que su
// tamaño es el costo fijo de todo el asistente: con el formato largo anterior
// ("· Principal ₡X / Secundaria ₡Y · Géneros: ...") eran ~5.500 tokens por
// mensaje, suficiente para agotar el límite por minuto de la capa gratuita de
// Groq con dos o tres preguntas seguidas — y cada límite alcanzado es un error
// en la cara del cliente. El formato compacto de abajo dice exactamente lo
// mismo con ~40% menos tokens.
const CATALOG_MAX_LINES = 220;
let CATALOG_CACHE = null;
function loadCatalog() {
  if (CATALOG_CACHE) return CATALOG_CACHE;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "featured-games.json"), "utf8");
    const data = JSON.parse(raw);
    const games = Array.isArray(data) ? data : (data.games || data.featured || []);
    const lines = games
      .filter((g) => g && g.title)
      .map((g) => {
        const p = principalCRC(g.priceUSD, g.platform);
        const s = secundariaCRC(g.priceUSD, g.platform);
        const genres = Array.isArray(g.genres) && g.genres.length ? g.genres.join(",") : "—";
        return `${g.title}|${g.platform}|${p}/${s}|${genres}`;
      });
    const shown = lines.slice(0, CATALOG_MAX_LINES);
    if (lines.length > shown.length) {
      shown.push(`(y ${lines.length - shown.length} títulos más: si preguntan por uno que no está en esta lista, confirmalo por WhatsApp)`);
    }
    CATALOG_CACHE = shown.join("\n");
  } catch {
    CATALOG_CACHE = "(catálogo no disponible en este momento)";
  }
  return CATALOG_CACHE;
}

// ===== Instrucción de sistema =====
function buildSystemPrompt() {
  return `Sos "Midas", el asistente virtual de **Rey Midas Digitales**, una tienda costarricense de videojuegos digitales para PS5, PS4, Xbox y Nintendo Switch. Atendés el chat de la web reymidascr.com, disponible 24/7.

# Tu personalidad
- Hablás en español de Costa Rica, tuteo con "vos" (ej: "¿qué buscás?", "te recomiendo", "escribinos").
- Cálido, cercano y directo. Como un buen vendedor amigo, no un robot. Sin formalismos rígidos.
- Respuestas CORTAS (2-4 frases normalmente). Nada de párrafos largos ni listas enormes salvo que pidan varias recomendaciones.
- Usá emojis con moderación (🎮 👑 ✅), no en cada frase.

# Qué hacés
1. Recomendás juegos según los gustos del cliente ("me gustó God of War" → ofrecés algo parecido del catálogo).
2. Explicás la diferencia entre Cuenta Principal y Secundaria.
3. Resolvés dudas de Nintendo Switch con tacto (ver abajo).
4. Cerrás mandando al cliente a WhatsApp con el pedido ya armado.

# Cuenta Principal vs Secundaria (clave para vender)
- **Principal**: la consola queda activada de forma permanente con esa cuenta. Se juega OFFLINE, todos los usuarios de la consola pueden jugar los juegos, y tiene GARANTÍA DE POR VIDA mientras la consola siga activada. Más cara. Ideal si querés compartir con familia/amigos o jugar sin internet.
- **Secundaria**: hay que estar conectado a internet con esa cuenta para jugar. Más económica, garantía de 6 meses. Perfecta si es solo para vos.
- Si el cliente juega solo → recomendá Secundaria (ahorra). Si comparte consola o quiere offline → Principal.

# Nintendo Switch — con TACTO
- Nintendo NO se vende por juego suelto como PS/Xbox. Se vende por **bundles**: packs de varios juegos ya cargados en un usuario específico de la Switch. Tenemos ~2900 bundles.
- Importante (decilo con cuidado, sin asustar): los juegos del bundle se juegan SOLO con ese usuario de la Switch. Si el cliente entra con otro perfil, no los ve. Hay que mantener ese usuario siempre disponible en la consola.
- No inventés bundles ni precios de Switch. Si preguntan por un juego de Switch específico, deciles que revisen la sección de Switch en la web o que te escriban por WhatsApp con el título y se los armamos/confirmamos.

# Cofre de Oro del Rey Midas (programa de lealtad)
- Cada compra suma **1 moneda de oro** al cofre del cliente. Al juntar **7 monedas**, canjea un **juego GRATIS** del listado especial (está en reymidascr.com/cofre).
- Las monedas se acreditan automáticamente con cada compra registrada en su cuenta de la web y no se vencen. El progreso se ve en "Mi cuenta".
- Si preguntan por códigos de descuento del 10%: ese sistema ya no existe, fue reemplazado por el Cofre de Oro (contalo como una mejora: ahora las compras acumulan hacia un juego totalmente gratis).
- Para canjear: con las 7 monedas, nos escriben por WhatsApp con el juego elegido del listado.

# Pagos y entrega
- Pago: SINPE Móvil o transferencia (BAC, BCR, Scotiabank, BN).
- Entrega: apenas confirman el pago, mandamos los datos por WhatsApp en menos de 10 minutos (en horario laboral: lunes a sábado 8am–8pm).
- Todo es legal: son cuentas digitales con juegos comprados oficialmente en las tiendas de cada plataforma.

# Reglas duras (NO las rompás)
- NUNCA inventes juegos, precios o promociones que no estén en el catálogo de abajo. Si no sabés un precio exacto, ofrecé confirmarlo por WhatsApp.
- No prometas cosas que no podés cumplir (descuentos random, tiempos fuera de horario, etc.).
- No pidas ni manejes datos de pago, contraseñas ni tarjetas en el chat. Eso se coordina por WhatsApp.
- Si no entendés o es un caso complejo (garantías, problemas con una cuenta ya comprada, reclamos), pasá a WhatsApp con amabilidad.

# Cierre a WhatsApp (MUY importante)
Cuando el cliente esté listo para comprar, quiera hablar con una persona, o convenga cerrar la venta, terminá tu mensaje con UNA línea al final EXACTAMENTE con este formato:
[[WA: <mensaje corto resumiendo el pedido o consulta, en primera persona del cliente>]]
Ejemplos:
[[WA: Hola, quiero comprar God of War Ragnarök para PS5 en Cuenta Secundaria.]]
[[WA: Hola, me interesa un bundle de Nintendo Switch con Mario Kart y Zelda.]]
El sistema convierte esa línea en un botón "Seguir por WhatsApp". Nunca muestres la línea [[WA: ...]] como texto normal ni la expliques; solo ponela al final cuando corresponda cerrar. No la pongas en cada mensaje, solo cuando el cliente muestra intención de compra o pide ayuda humana.

# Catálogo de juegos destacados (títulos, plataforma y precios reales)
Formato de cada línea: Título|Plataforma|PrecioPrincipal/PrecioSecundaria|Géneros.
Los precios están en colones y sin puntos: escribilos siempre como ₡25.000, nunca "25000".
${loadCatalog()}

Recordá: sos la cara de la tienda a las 2am cuando no hay nadie más. Ayudá de verdad, recomendá bien y cerrá la venta con onda.`;
}

let SYSTEM_PROMPT_CACHE = null;
const systemPrompt = () => (SYSTEM_PROMPT_CACHE ||= buildSystemPrompt());

// ===== Llamada a Gemini =====
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Modelo que ya respondió OK (se cachea en warm start para ir directo).
let WORKING_MODEL = null;
// Lista de modelos descubiertos vía ListModels para esta clave (memoizada).
let DISCOVERY_CACHE = null;

// Una sola llamada a generateContent. Devuelve { ok, status, text, data }.
async function generateOnce(apiKey, model, body, timeoutMs) {
  const res = await fetchWithTimeout(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body,
  }, timeoutMs);
  const data = await res.json().catch(() => ({}));
  const text = res.ok
    ? stripThinking((data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""))
    : "";
  return { ok: res.ok, status: res.status, text, data };
}

// Lista los modelos que la clave tiene disponibles.
async function listModels(apiKey) {
  const res = await fetchWithTimeout(`${GEMINI_BASE}/models?pageSize=200`, {
    headers: { "x-goog-api-key": apiKey },
  }, 8000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `ListModels ${res.status}`);
  return Array.isArray(data.models) ? data.models : [];
}

// Ordena los modelos disponibles priorizando flash (rápidos y baratos) que
// soporten generateContent. Devuelve nombres sin el prefijo "models/".
function rankModels(models) {
  const usable = (models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => (m.name || "").replace(/^models\//, ""))
    .filter((n) => /^gemini/i.test(n) && !/(embedding|aqa|vision|image|tts|native-audio)/i.test(n));
  const score = (n) => {
    let s = 0;
    if (/flash/i.test(n)) s += 100;
    if (/2\.5/.test(n)) s += 40; else if (/2\.0/.test(n)) s += 30; else if (/1\.5/.test(n)) s += 10;
    if (/lite/i.test(n)) s += 5;
    if (/latest/i.test(n)) s += 3;
    if (/preview|exp/i.test(n)) s -= 25; // preferir estables sobre previews
    return s;
  };
  return [...new Set(usable)].sort((a, b) => score(b) - score(a));
}

async function discoverModels(apiKey) {
  if (DISCOVERY_CACHE) return DISCOVERY_CACHE;
  DISCOVERY_CACHE = rankModels(await listModels(apiKey));
  return DISCOVERY_CACHE;
}

async function callGemini(apiKey, contents, budget) {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt() }] },
    contents,
    generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 700 },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  });

  // Orden: modelo que ya funcionó → candidatos fijos.
  const order = [];
  if (WORKING_MODEL) order.push(WORKING_MODEL);
  for (const m of MODEL_CANDIDATES) if (!order.includes(m)) order.push(m);

  let lastErr = null;
  let any404 = false;

  const tryList = async (models) => {
    for (const model of models) {
      if (budget && budget.exhausted()) break; // no arrancar lo que no da tiempo
      try {
        const r = await generateOnce(apiKey, model, body, budget && budget.slice());
        if (r.ok && r.text) { WORKING_MODEL = model; return r.text; }
        if (r.ok) { lastErr = new Error("respuesta vacía de Gemini"); continue; }
        if (r.status === 404) { any404 = true; lastErr = new Error(`modelo ${model} no disponible`); continue; }
        // 429 (cuota) y 400/403 (clave/config) NO se arreglan probando más
        // modelos: comparten la misma cuota/clave. Cortamos para no empeorar.
        if (r.status === 429) { const e = new Error("RATE_LIMIT"); e.rate = true; throw e; }
        lastErr = new Error(r.data?.error?.message || `Gemini ${r.status}`);
        lastErr.status = r.status;
        if (r.status === 400 || r.status === 403) throw lastErr;
      } catch (e) {
        if (e.rate || /API key|PERMISSION|SERVICE_DISABLED|INVALID_ARGUMENT/i.test(e.message)) throw e;
        lastErr = e;
      }
    }
    return null;
  };

  // 1) lista conocida
  let text = await tryList(order);
  if (text) return text;

  // 2) si fallaron por 404, descubrir los modelos reales de la clave y reintentar
  if (any404) {
    const discovered = (await discoverModels(apiKey)).filter((m) => !order.includes(m));
    text = await tryList(discovered.slice(0, 2));
    if (text) return text;
  }

  throw lastErr || new Error("Gemini no respondió");
}

// Los modelos de razonamiento (gpt-oss, qwen3) a veces devuelven su borrador
// entre <think>…</think>. Es texto interno: el cliente no tiene por qué leerlo.
function stripThinking(text) {
  return String(text || "")
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "")
    .replace(/^\s*<\/(?:think|thinking|reasoning)>/i, "")
    .trim();
}

// ===== Groq (API compatible con OpenAI) =====
async function groqOnce(apiKey, model, messages, maxTokens, timeoutMs) {
  const res = await fetchWithTimeout(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.7, top_p: 0.95, max_tokens: maxTokens || 700 }),
  }, timeoutMs);
  const data = await res.json().catch(() => ({}));
  const text = res.ok ? stripThinking(data?.choices?.[0]?.message?.content) : "";
  return { ok: res.ok, status: res.status, text, data };
}

async function groqModelList(apiKey) {
  const res = await fetchWithTimeout(`${GROQ_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } }, 8000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Groq models ${res.status}`);
  return (data?.data || []).map((m) => m.id).filter(Boolean);
}

// ¿El error dice que ese modelo ya no existe? Groq contesta 404, o 400 con
// code "model_decommissioned" / "model_not_found" cuando retira un modelo.
function isModelGone(status, data) {
  if (status === 404) return true;
  if (status !== 400) return false;
  const blob = JSON.stringify(data?.error || data || "");
  return /model_decommissioned|model_not_found|decommission|deprecat|does not exist|no longer/i.test(blob);
}

// Modelos de chat que la clave tiene disponibles hoy, el más conveniente
// primero. Se consulta solo cuando los modelos escritos arriba ya no existen.
// Modelos que no sirven para conversar. El nombre no siempre lo canta:
// "orpheus" es voz y "safeguard" es un clasificador de seguridad, así que la
// lista va explícita en vez de adivinar por palabras sueltas.
const GROQ_NOT_CHAT = /whisper|tts|orpheus|canopylabs|playai|guard|moderation|embed|vision|distil/i;

function scoreGroqModel(id) {
  let s = 0;
  if (/gpt-oss/i.test(id)) s += 60;            // los mejores siguiendo instrucciones
  if (/qwen/i.test(id)) s += 40;
  if (/llama/i.test(id)) s += 35;
  if (/120b|70b|versatile/i.test(id)) s += 10; // a igual familia, el grande primero
  // Los "compound" son sistemas agénticos: buscan en la web por su cuenta, así
  // que podrían citar precios de otro lado como si fueran nuestros.
  if (/compound/i.test(id)) s -= 50;
  if (/preview|beta|alpha/i.test(id)) s -= 20; // preferir estables
  return s;
}

async function discoverGroqModels(apiKey) {
  if (GROQ_DISCOVERY_CACHE) return GROQ_DISCOVERY_CACHE;
  const ids = await groqModelList(apiKey);
  const usable = ids.filter((id) => !GROQ_NOT_CHAT.test(id));
  GROQ_DISCOVERY_CACHE = [...new Set(usable)].sort((a, b) => scoreGroqModel(b) - scoreGroqModel(a));
  return GROQ_DISCOVERY_CACHE;
}

async function callGroq(apiKey, messages, budget) {
  const order = [];
  if (GROQ_WORKING) order.push(GROQ_WORKING);
  for (const m of GROQ_MODELS) if (!order.includes(m)) order.push(m);

  let lastErr = null;
  let anyGone = false;
  let rateLimited = 0;
  let otherFail = 0;

  const tryList = async (models) => {
    for (const model of models) {
      if (budget && budget.exhausted()) break; // no arrancar lo que no da tiempo
      let r;
      try {
        r = await groqOnce(apiKey, model, messages, undefined, budget && budget.slice());
      } catch (e) {
        // Timeout o corte de red: el siguiente modelo suele ser más chico y más
        // rápido, así que vale más probarlo que rendirse acá.
        otherFail++;
        lastErr = e;
        continue;
      }
      if (r.ok && r.text) { GROQ_WORKING = model; return r.text; }
      if (r.ok) { otherFail++; lastErr = new Error("respuesta vacía de Groq"); continue; }

      if (isModelGone(r.status, r.data)) {
        anyGone = true;
        otherFail++;
        if (GROQ_WORKING === model) GROQ_WORKING = null;
        lastErr = new Error(`modelo ${model} ya no está disponible en Groq`);
        continue;
      }
      if (r.status === 429) {
        // La cuota de Groq es POR MODELO. Antes cortábamos en el primer 429 y
        // el cliente veía "estoy con muchas consultas" aunque el modelo chico
        // estuviera libre; ahora seguimos con el resto de la lista.
        rateLimited++;
        if (GROQ_WORKING === model) GROQ_WORKING = null;
        lastErr = new Error("RATE_LIMIT");
        lastErr.rate = true;
        continue;
      }
      if (r.status === 401 || r.status === 403) {
        const e = new Error(r.data?.error?.message || `Groq ${r.status}: clave rechazada`);
        e.badKey = true;
        throw e; // probar otro modelo no arregla una clave inválida
      }
      otherFail++;
      lastErr = new Error(r.data?.error?.message || `Groq ${r.status}`);
      lastErr.status = r.status; // isRetryable() decide por el código, no por el texto
    }
    return null;
  };

  let text = await tryList(order);
  if (text) return text;

  // Si Groq retiró los modelos que tenemos escritos, le preguntamos cuáles hay
  // y probamos los mejores. Así una baja de modelo no deja el chat caído.
  if (anyGone) {
    try {
      const discovered = (await discoverGroqModels(apiKey)).filter((m) => !order.includes(m));
      text = await tryList(discovered.slice(0, 3));
      if (text) return text;
    } catch (e) {
      lastErr = lastErr || e;
    }
  }

  if (rateLimited > 0 && otherFail === 0) {
    const e = new Error("RATE_LIMIT");
    e.rate = true;
    throw e;
  }
  throw lastErr || new Error("Groq no respondió");
}

// Extrae la línea [[WA: ...]] y devuelve { reply, whatsapp }.
// El modelo a veces repite el marcador o lo deja sin cerrar; en los dos casos
// el resto tiene que quedar limpio, porque un "[[WA:" suelto en la burbuja se
// le muestra tal cual al cliente.
function extractWhatsApp(text) {
  const m = text.match(/\[\[WA:\s*([\s\S]*?)\]\]/i);
  if (!m) return { reply: text.replace(/\[\[WA:[\s\S]*$/i, "").trim(), whatsapp: null };
  const msg = m[1].trim();
  const reply = text
    .replace(/\[\[WA:\s*[\s\S]*?\]\]/gi, "")
    .replace(/\[\[WA:[\s\S]*$/i, "")
    .trim();
  const url = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg || "Hola, vengo del asistente de reymidascr.com y quiero hacer una compra.")}`;
  return { reply: reply || "¡Listo! Seguimos por WhatsApp para cerrar tu pedido. 👑", whatsapp: url };
}

// Traduce el error de Gemini a un diagnóstico accionable en español.
function diagnose(status, data) {
  const reason = data?.error?.details?.[0]?.reason || data?.error?.status || "";
  if (status === 400 && /API_KEY_INVALID/i.test(reason + JSON.stringify(data?.error || ""))) {
    return "La clave GEMINI_API_KEY es inválida o está mal copiada (le sobra un espacio, quedó cortada, o no es una clave de Gemini). Creá una nueva en https://aistudio.google.com/apikey, copiala completa y sin espacios, reemplazala en Vercel (Settings → Environment Variables) y hacé Redeploy.";
  }
  if (status === 403 || /SERVICE_DISABLED|PERMISSION_DENIED/i.test(reason)) {
    return "La clave es de un proyecto de Google donde la 'Generative Language API' no está habilitada. Lo más fácil: creá la clave desde Google AI Studio (https://aistudio.google.com/apikey), que ya la deja habilitada. Reemplazala en Vercel y hacé Redeploy.";
  }
  if (status === 429) {
    return "Se alcanzó el límite de la capa gratuita de Gemini por ahora. Esperá unos minutos y volvé a probar.";
  }
  return "Google devolvió un error inesperado. Revisá que la clave sea correcta y que hayas hecho Redeploy en Vercel.";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Qué vale la pena reintentar: cortes de red, timeouts, 5xx y respuestas
// vacías. La cuota agotada y la clave inválida no mejoran repitiendo.
function isRetryable(e) {
  if (!e || e.rate || e.badKey) return false;
  if (e.timeout) return true;
  if (e.status) return e.status >= 500; // un 4xx no cambia por repetirlo
  return /respuesta vacía|no respondió|fetch failed|network|ECONN|ETIMEDOUT|socket/i.test(e.message || "");
}

// Etiqueta corta y sin datos sensibles para logs y para el widget.
function errorCode(e) {
  if (!e) return "unknown";
  if (e.rate) return "rate_limit";
  if (e.badKey) return "bad_key";
  if (e.timeout) return "timeout";
  return "provider_error";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  res.setHeader("Cache-Control", "no-store");

  const provider = pickProvider();
  const apiKey = provider.key;

  // Autodiagnóstico: GET /api/chat?selftest → prueba la clave contra el LLM y
  // devuelve el resultado real. NUNCA expone la clave.
  if (req.method === "GET" && req.query && typeof req.query.selftest !== "undefined") {
    if (!apiKey) {
      return res.status(200).json({
        ok: false, problema: "falta_clave",
        mensaje: "No hay clave configurada. Agregá GROQ_API_KEY (gratis, sin tarjeta) en Vercel → Settings → Environment Variables y hacé Redeploy.",
      });
    }

    // ---- Groq ----
    if (provider.name === "groq") {
      let last = null;
      try {
        for (const model of GROQ_MODELS.slice(0, 2)) {
          const r = await groqOnce(apiKey, model, [{ role: "user", content: "ping" }], 5);
          if (r.ok) return res.status(200).json({ ok: true, proveedor: "groq", modelo: model, mensaje: "✅ La clave de Groq funciona. El asistente ya debería responder normalmente." });
          last = { http: r.status, data: r.data };
          if (r.status === 429) return res.status(200).json({ ok: false, proveedor: "groq", http: 429, reason: "RATE_LIMIT", mensaje: "Límite temporal de Groq alcanzado. Esperá un momento y probá de nuevo.", detalle: r.data?.error?.message || null });
          if (r.status === 401 || r.status === 403) return res.status(200).json({ ok: false, proveedor: "groq", http: r.status, reason: "BAD_KEY", mensaje: "La clave GROQ_API_KEY es inválida o está mal copiada. Creá una nueva en https://console.groq.com/keys, reemplazala en Vercel y hacé Redeploy.", detalle: r.data?.error?.message || null });
        }
        // Los modelos escritos en el código fallaron. Antes esto terminaba en
        // "decímelos y ajusto"; ahora probamos de verdad los que la clave tiene
        // y, si alguno anda, el asistente ya está funcionando con ese.
        const disponibles = await discoverGroqModels(apiKey);
        for (const model of disponibles.slice(0, 2)) {
          const r = await groqOnce(apiKey, model, [{ role: "user", content: "ping" }], 5);
          if (r.ok) {
            GROQ_WORKING = model;
            return res.status(200).json({ ok: true, proveedor: "groq", modelo: model, mensaje: `✅ La clave de Groq funciona. Los modelos por defecto ya no existen, así que el asistente pasó solo a "${model}". Anda igual; si querés fijarlo, poné GROQ_MODEL=${model} en Vercel.` });
          }
          last = { http: r.status, data: r.data };
          if (r.status === 429) return res.status(200).json({ ok: false, proveedor: "groq", http: 429, reason: "RATE_LIMIT", mensaje: "Límite temporal de Groq alcanzado. Esperá un momento y probá de nuevo.", detalle: r.data?.error?.message || null });
        }
        return res.status(200).json({ ok: false, proveedor: "groq", http: last?.http ?? 404, reason: "NO_USABLE_MODEL", mensaje: "La clave es válida pero ningún modelo respondió. Abajo van los modelos disponibles; decímelos y ajusto.", modelos_disponibles: disponibles.slice(0, 20) });
      } catch (e) {
        return res.status(200).json({ ok: false, proveedor: "groq", mensaje: "No pude contactar a Groq: " + e.message });
      }
    }

    // ---- Gemini ----
    const ping = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 5 } });
    const rate429 = (last) => res.status(200).json({
      ok: false, http: 429, reason: "RATE_LIMIT",
      mensaje: "La clave es válida y los modelos existen, pero se alcanzó el límite de solicitudes por minuto de la capa gratuita. Esperá 1–2 minutos y probá el chat de nuevo (una sola vez). Si el chat funciona, ya está todo listo.",
      detalle_google: last?.data?.error?.message || null,
    });
    let last = null;
    let any404 = false;

    // 1) Probar los candidatos fijos (pocas llamadas para no gatillar el 429).
    for (const model of MODEL_CANDIDATES.slice(0, 3)) {
      try {
        const r = await generateOnce(apiKey, model, ping);
        if (r.ok) return res.status(200).json({ ok: true, modelo: model, mensaje: "✅ La clave funciona. El asistente ya debería responder normalmente." });
        last = { http: r.status, data: r.data };
        if (r.status === 429) return rate429(last);      // cuota: cortar de una
        if (r.status === 404) { any404 = true; continue; }
        if (r.status === 400 || r.status === 403) break;  // errores de clave/config
      } catch (e) {
        last = { http: 0, data: { error: { message: e.message } } };
      }
    }

    // 2) Si los candidatos dieron 404, la clave es válida pero expone otros
    //    nombres de modelo: los descubrimos y probamos el mejor (uno solo).
    if (any404) {
      try {
        const disc = await discoverModels(apiKey);
        for (const model of disc.slice(0, 1)) {
          const r = await generateOnce(apiKey, model, ping);
          if (r.ok) return res.status(200).json({ ok: true, modelo: model, mensaje: `✅ La clave funciona (modelo ${model}). El asistente ya debería responder normalmente.` });
          last = { http: r.status, data: r.data };
          if (r.status === 429) return rate429(last);
        }
        return res.status(200).json({
          ok: false, http: last?.http ?? 404, reason: "NO_USABLE_MODEL",
          mensaje: "La clave es válida, pero ningún modelo respondió. Abajo van los modelos disponibles para tu clave.",
          detalle_google: last?.data?.error?.message || null,
          modelos_disponibles: disc.slice(0, 15),
        });
      } catch (e) {
        return res.status(200).json({ ok: false, mensaje: "La clave es válida pero no pude listar los modelos: " + e.message });
      }
    }

    if (last?.http === 429) return rate429(last);
    return res.status(200).json({
      ok: false,
      http: last?.http ?? 0,
      reason: last?.data?.error?.details?.[0]?.reason || last?.data?.error?.status || null,
      mensaje: diagnose(last?.http ?? 0, last?.data || {}),
      detalle_google: last?.data?.error?.message || null,
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  if (!apiKey) {
    return res.status(200).json({
      reply: "Por ahora el asistente está en mantenimiento 🙏. Escribinos directo por WhatsApp y te ayudamos enseguida.",
      whatsapp: `https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Hola, quiero hacer una consulta.")}`,
    });
  }

  try {
    const body = await readJson(req);
    let messages = Array.isArray(body?.messages) ? body.messages : [];

    // Saneo: solo user/assistant, texto no vacío, tope de historial y longitud.
    messages = messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-16)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return res.status(400).json({ error: "Falta el mensaje del usuario." });
    }

    const budget = startBudget();
    const ask = async () => {
      if (provider.name === "groq") {
        // Groq / OpenAI: system + turnos user/assistant.
        const gmsgs = [{ role: "system", content: systemPrompt() }].concat(
          messages.map((m) => ({ role: m.role, content: m.content }))
        );
        return await callGroq(apiKey, gmsgs, budget);
      }
      // Gemini usa role "model" en vez de "assistant".
      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      return await callGemini(apiKey, contents, budget);
    };

    let raw;
    try {
      raw = await ask();
    } catch (e) {
      // Un tropiezo puntual (timeout, 5xx del proveedor, respuesta vacía) no
      // tiene por qué llegarle al cliente como error: un reintento resuelve la
      // mayoría. No se reintenta lo que no mejora repitiendo: clave inválida y
      // límite de cuota.
      if (!isRetryable(e) || budget.exhausted()) throw e;
      console.warn("[chat] reintentando tras:", e?.message || e);
      await sleep(700);
      raw = await ask();
    }
    const { reply, whatsapp } = extractWhatsApp(raw);
    return res.status(200).json({ reply, whatsapp });
  } catch (e) {
    // Sin este log en Vercel no queda ningún rastro de POR QUÉ falló: el
    // cliente ve una disculpa y quien mantiene la tienda no puede diagnosticar.
    console.error("[chat] fallo respondiendo:", errorCode(e), "—", e?.message || e);
    const reply = e && e.rate
      ? "¡Uf, estoy con muchas consultas en este momento! 🙏 Dame un minutito y volvé a escribirme, o si querés te atendemos ya por WhatsApp."
      : "Uy, se me trabó la conexión un momento 😅. Probá de nuevo o escribinos por WhatsApp y te atendemos de una.";
    return res.status(200).json({
      reply,
      // El widget usa este código para no guardar el error en el historial del
      // chat. Es una etiqueta corta: nunca lleva la clave ni datos del cliente.
      error: errorCode(e),
      whatsapp: `https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Hola, quiero hacer una consulta.")}`,
    });
  }
}

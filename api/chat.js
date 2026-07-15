// Asistente virtual de Rey Midas Digitales.
// POST /api/chat  — recibe { messages: [{role, content}] } y devuelve { reply, whatsapp? }.
//
// El "cerebro" es Google Gemini (capa gratuita). La clave vive SOLO en el
// servidor (env var GEMINI_API_KEY en Vercel): el navegador nunca la ve.
// La CSP del sitio permite connect-src 'self', así que el widget solo habla
// con este endpoint mismo-origen; la llamada a Google la hace este servidor.

import { readJson } from "./_lib.js";
import fs from "fs";
import path from "path";

const WHATSAPP = "50661468733";

// Modelos a intentar en orden (si el primero no existe/está deprecado, cae al
// siguiente). Se puede forzar uno con la env var GEMINI_MODEL.
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
].filter(Boolean);

// ===== Precios (misma tabla e interpolación que app.js) =====
const PRICING = {
  exchangeRate: 530,
  principalMarkup: 0.75,
  secundariaMarkup: 0.35,
  table: [
    [10, 4000, 2500],
    [20, 6000, 3000],
    [30, 11000, 5500],
    [40, 17000, 7000],
    [50, 21000, 9000],
    [60, 26000, 13000],
    [70, 28500, 15000],
    [80, 36000, 14000],
  ],
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
function principalCRC(usd, platform = "") {
  if (/PS|Xbox/i.test(platform)) return interpolateCRC(usd, 0);
  return Math.round(usd * PRICING.exchangeRate * PRICING.principalMarkup);
}
function secundariaCRC(usd, platform = "") {
  if (/PS|Xbox/i.test(platform)) return interpolateCRC(usd, 1);
  return Math.round(usd * PRICING.exchangeRate * PRICING.secundariaMarkup);
}
const crc = (n) => "₡" + Number(n || 0).toLocaleString("es-CR");

// ===== Carga del catálogo (memoizado en warm start) =====
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
        const genres = Array.isArray(g.genres) && g.genres.length ? g.genres.join(", ") : "—";
        return `- ${g.title} (${g.platform}) · Principal ${crc(p)} / Secundaria ${crc(s)} · Géneros: ${genres}`;
      });
    CATALOG_CACHE = lines.join("\n");
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
${loadCatalog()}

Recordá: sos la cara de la tienda a las 2am cuando no hay nadie más. Ayudá de verdad, recomendá bien y cerrá la venta con onda.`;
}

let SYSTEM_PROMPT_CACHE = null;
const systemPrompt = () => (SYSTEM_PROMPT_CACHE ||= buildSystemPrompt());

// ===== Llamada a Gemini =====
async function callGemini(apiKey, contents) {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt() }] },
    contents,
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      maxOutputTokens: 700,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  });

  let lastErr = null;
  for (const model of MODEL_CANDIDATES) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
      });
      if (res.status === 404) { lastErr = new Error(`modelo ${model} no encontrado`); continue; }
      const data = await res.json();
      if (!res.ok) {
        lastErr = new Error(data?.error?.message || `Gemini ${res.status}`);
        // 400/403 no se arreglan cambiando de modelo: cortar.
        if (res.status === 400 || res.status === 403) break;
        continue;
      }
      const text = (data?.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || "")
        .join("")
        .trim();
      if (text) return text;
      lastErr = new Error("respuesta vacía de Gemini");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Gemini no respondió");
}

// Extrae la línea [[WA: ...]] y devuelve { reply, whatsapp }.
function extractWhatsApp(text) {
  const m = text.match(/\[\[WA:\s*([\s\S]*?)\]\]/i);
  if (!m) return { reply: text.trim(), whatsapp: null };
  const msg = m[1].trim();
  const reply = text.replace(m[0], "").trim();
  const url = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg || "Hola, vengo del asistente de reymidascr.com y quiero hacer una compra.")}`;
  return { reply: reply || "¡Listo! Seguimos por WhatsApp para cerrar tu pedido. 👑", whatsapp: url };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  res.setHeader("Cache-Control", "no-store");

  const apiKey = process.env.GEMINI_API_KEY;
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

    // Gemini usa role "model" en vez de "assistant".
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const raw = await callGemini(apiKey, contents);
    const { reply, whatsapp } = extractWhatsApp(raw);
    return res.status(200).json({ reply, whatsapp });
  } catch (e) {
    return res.status(200).json({
      reply: "Uy, se me trabó la conexión un momento 😅. Probá de nuevo o escribinos por WhatsApp y te atendemos de una.",
      whatsapp: `https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Hola, quiero hacer una consulta.")}`,
    });
  }
}

// ============================================================
// CONFIGURACION — editá estos valores con los tuyos
// ============================================================
const CONFIG = {
  // Tu número de WhatsApp con código de país, SIN el signo +
  whatsapp: "50661468733",

  // Tipo de cambio CRC por USD
  exchangeRate: 530,

  // Margen sobre el precio (1.20 = 20% de ganancia). 1.0 = sin margen.
  markup: 1.20,

  // Región de PS Store (Costa Rica = cr, USA = us, México = mx, etc.)
  region: "cr",

  // Colección de PSPrices a mostrar.
  // La API demo solo soporta "most-wanted-deals" (24 juegos máx).
  collection: "most-wanted-deals",
};

// ============================================================
// Estado y elementos
// ============================================================
const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");
const filterBtns = document.querySelectorAll(".filter");
const waLink = document.getElementById("waLink");

let allGames = [];
const filters = { platform: "all", sale: false, q: "" };

// ============================================================
// Init
// ============================================================
waLink.href = `https://wa.me/${CONFIG.whatsapp}`;
waLink.textContent = formatPhone(CONFIG.whatsapp);

load();
attachEvents();

// ============================================================
// Carga inicial
// ============================================================
async function load() {
  setStatus("Cargando catálogo, esto puede tardar unos segundos...");
  try {
    const params = new URLSearchParams({
      region: CONFIG.region,
      collection: CONFIG.collection,
    });
    const res = await fetch(`/api/scrape?${params}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Respuesta inválida");
    allGames = (data.games || []).sort((a, b) => {
      if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
      return b.discount - a.discount;
    });
    if (!allGames.length) {
      setStatus("No se encontraron juegos. Probá más tarde.", true);
      return;
    }
    render();
  } catch (err) {
    setStatus(`Error cargando el catálogo: ${err.message}`, true);
  }
}

// ============================================================
// Render
// ============================================================
function render() {
  let list = allGames;
  if (filters.platform !== "all") {
    list = list.filter(g => g.platform.includes(filters.platform));
  }
  if (filters.sale) list = list.filter(g => g.onSale);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    list = list.filter(g => g.title.toLowerCase().includes(q));
  }

  if (!list.length) {
    grid.hidden = true;
    setStatus("No hay juegos que coincidan con los filtros.");
    return;
  }

  statusEl.hidden = true;
  grid.hidden = false;
  grid.innerHTML = list.map(cardHTML).join("");
}

function cardHTML(g) {
  const priceText = priceCRC(g.priceUSD);
  const msg = `Hola, me interesa "${g.title}" (${g.platform}) por ${priceText}. ¿Está disponible?`;
  const link = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(msg)}`;
  const img = g.imageUrl
    ? `<img src="${escapeAttr(g.imageUrl)}" alt="${escapeAttr(g.title)}" loading="lazy">`
    : `<div class="placeholder">🎮</div>`;
  return `
    <a class="card" href="${link}" target="_blank" rel="noopener">
      <div class="card-image">
        ${img}
        ${g.onSale ? `<span class="badge-sale">-${g.discount}%</span>` : ""}
        <span class="badge-platform">${escapeHtml(g.platform)}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(g.title)}</div>
        <div class="card-price-row">
          <span class="card-price">${priceText}</span>
          ${g.onSale ? `<span class="card-original">${priceCRC(g.originalPriceUSD)}</span>` : ""}
        </div>
      </div>
    </a>
  `;
}

// ============================================================
// Helpers
// ============================================================
function priceCRC(usd) {
  const crc = Math.round(usd * CONFIG.exchangeRate * CONFIG.markup);
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0,
  }).format(crc);
}

function setStatus(text, isError = false) {
  statusEl.hidden = false;
  grid.hidden = true;
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function formatPhone(p) {
  if (p.startsWith("506") && p.length === 11) {
    return `+506 ${p.slice(3, 7)}-${p.slice(7)}`;
  }
  return `+${p}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
const escapeAttr = escapeHtml;

// ============================================================
// Eventos
// ============================================================
function attachEvents() {
  let debounce;
  searchEl.addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      filters.q = e.target.value.trim();
      render();
    }, 150);
  });

  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.sale) {
        filters.sale = !filters.sale;
        btn.classList.toggle("active");
      } else if (btn.dataset.platform) {
        filters.platform = btn.dataset.platform;
        filterBtns.forEach(b => {
          if (b.dataset.platform) b.classList.toggle("active", b === btn);
        });
      }
      render();
    });
  });
}

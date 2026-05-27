// ============================================================
// CONFIGURACION — editá estos valores
// ============================================================
const CONFIG = {
  whatsapp: "50661468733",

  // Precio final = USD * exchangeRate * markup
  pricing: {
    exchangeRate: 530,
    principalMarkup: 0.55,    // ~55% del USD → cuenta principal
    secundariaMarkup: 0.30,   // ~30% del USD → cuenta secundaria
  },

  // Plataformas con catálogo activo. Switch/Xbox/PS3 quedan visibles
  // pero muestran "Próximamente" hasta que les conectemos un data source.
  activePlatforms: ["PS5", "PS4"],
};

// ============================================================
// Estado global
// ============================================================
const app = document.getElementById("app");
const waLink = document.getElementById("waLink");
let allGames = [];
let loaded = false;
let loadError = null;

waLink.href = `https://wa.me/${CONFIG.whatsapp}`;
waLink.textContent = formatPhone(CONFIG.whatsapp);

// ============================================================
// Routing por hash
// ============================================================
function parseRoute() {
  const h = location.hash.replace(/^#/, "") || "/";
  if (h === "/" || h === "") return { name: "home" };
  const partes = h.replace(/^\//, "").split("/");
  if (partes[0] === "plataforma" && partes[1]) {
    return { name: "platform", platform: decodeURIComponent(partes[1]) };
  }
  if (partes[0] === "producto" && partes[1]) {
    return { name: "product", id: decodeURIComponent(partes[1]) };
  }
  return { name: "home" };
}

function navigateActive() {
  const route = parseRoute();
  document.querySelectorAll(".topnav a").forEach(a => {
    const r = a.dataset.route;
    const active =
      (route.name === "home" && r === "home") ||
      (route.name === "platform" && r === route.platform);
    a.classList.toggle("active", active);
  });
}

window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

// ============================================================
// Carga inicial desde /api/scrape
// ============================================================
async function load() {
  try {
    const res = await fetch(`/api/scrape`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Respuesta inválida");
    allGames = (data.games || []).sort((a, b) => {
      if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
      return b.discount - a.discount;
    });
  } catch (err) {
    loadError = err.message;
  } finally {
    loaded = true;
    render();
  }
}

// ============================================================
// Render principal
// ============================================================
function render() {
  navigateActive();
  const route = parseRoute();
  if (route.name === "product") return renderProduct(route.id);
  if (route.name === "platform") return renderPlatform(route.platform);
  return renderHome();
}

function renderHome() {
  app.innerHTML = `
    ${heroHTML()}
    <section class="container catalog-section">
      <div class="section-title">
        <h2>Catálogo destacado</h2>
        <p>Los juegos más buscados al mejor precio. Cuenta Principal y Secundaria disponibles.</p>
      </div>
      ${toolbarHTML()}
      <div id="grid" class="grid"></div>
    </section>
    ${howToHTML()}
  `;
  mountToolbar();
  renderGrid(allGames);
}

function renderPlatform(platform) {
  const active = CONFIG.activePlatforms.includes(platform);
  if (!active) {
    app.innerHTML = `
      ${heroSlimHTML(platform)}
      <section class="container empty-state">
        <h2>Próximamente</h2>
        <p>Estamos por habilitar el catálogo de <strong>${escapeHtml(platform)}</strong>. Mientras tanto, escribinos por WhatsApp y te conseguimos el juego que necesités.</p>
        <a class="cta" href="https://wa.me/${CONFIG.whatsapp}" target="_blank" rel="noopener">Consultar por WhatsApp</a>
      </section>
    `;
    return;
  }
  const list = allGames.filter(g => g.platform.includes(platform));
  app.innerHTML = `
    ${heroSlimHTML(platform)}
    <section class="container catalog-section">
      <div class="section-title">
        <h2>Juegos ${escapeHtml(platform)}</h2>
        <p>${list.length} ${list.length === 1 ? "juego disponible" : "juegos disponibles"}</p>
      </div>
      ${toolbarHTML(false)}
      <div id="grid" class="grid"></div>
    </section>
  `;
  mountToolbar(list);
  renderGrid(list);
}

function renderProduct(id) {
  if (!loaded) {
    app.innerHTML = `<section class="container empty-state"><p>Cargando juego...</p></section>`;
    return;
  }
  const g = allGames.find(x => String(x.id) === String(id));
  if (!g) {
    app.innerHTML = `
      <section class="container empty-state">
        <h2>Juego no encontrado</h2>
        <p>El juego que buscás no está en nuestro catálogo activo.</p>
        <a class="cta" href="#/">Volver al catálogo</a>
      </section>
    `;
    return;
  }
  const principal = principalCRC(g.priceUSD);
  const secundaria = secundariaCRC(g.priceUSD);
  const msgPri = encodeURIComponent(`Hola, me interesa "${g.title}" (${g.platform}) en CUENTA PRINCIPAL por ${formatCRC(principal)}. ¿Está disponible?`);
  const msgSec = encodeURIComponent(`Hola, me interesa "${g.title}" (${g.platform}) en CUENTA SECUNDARIA por ${formatCRC(secundaria)}. ¿Está disponible?`);
  app.innerHTML = `
    <section class="container product-page">
      <a class="back-link" href="#/">&larr; Volver al catálogo</a>
      <div class="product-grid">
        <div class="product-image">
          ${g.imageUrl ? `<img src="${escapeAttr(g.imageUrl)}" alt="${escapeAttr(g.title)}">` : `<div class="placeholder">🎮</div>`}
          ${g.onSale ? `<span class="badge-sale">-${g.discount}% PSN</span>` : ""}
        </div>
        <div class="product-info">
          <span class="product-platform">${escapeHtml(g.platform)}</span>
          <h1>${escapeHtml(g.title)}</h1>
          <p class="product-desc">Juego digital para ${escapeHtml(g.platform)}. Te entregamos el acceso por WhatsApp luego de confirmar el pago por SINPE Móvil o transferencia bancaria.</p>

          <div class="price-options">
            <a class="price-card principal" href="https://wa.me/${CONFIG.whatsapp}?text=${msgPri}" target="_blank" rel="noopener">
              <div class="price-label">Cuenta Principal</div>
              <div class="price-amount">${formatCRC(principal)}</div>
              <div class="price-note">Acceso completo, sin restricciones</div>
              <span class="price-cta">Comprar por WhatsApp</span>
            </a>
            <a class="price-card secundaria" href="https://wa.me/${CONFIG.whatsapp}?text=${msgSec}" target="_blank" rel="noopener">
              <div class="price-label">Cuenta Secundaria</div>
              <div class="price-amount">${formatCRC(secundaria)}</div>
              <div class="price-note">Más económico, requiere estar conectado</div>
              <span class="price-cta">Comprar por WhatsApp</span>
            </a>
          </div>

          <div class="product-meta">
            <div><strong>Plataforma:</strong> ${escapeHtml(g.platform)}</div>
            <div><strong>Disponibilidad:</strong> <span class="stock-ok">En stock</span></div>
            <div><strong>Entrega:</strong> Inmediata vía WhatsApp</div>
            <div><strong>Pago:</strong> SINPE Móvil o transferencia</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

// ============================================================
// Bloques reutilizables
// ============================================================
function heroHTML() {
  return `
    <section class="hero">
      <div class="hero-glow"></div>
      <div class="container hero-inner">
        <img src="/assets/logo.png" alt="Rey Midas Digitales" class="logo">
        <p class="tagline">Tu tienda de juegos digitales PlayStation en Costa Rica</p>
        <a class="cta" href="#/plataforma/PS5">Ver juegos PS5</a>
      </div>
    </section>
  `;
}

function heroSlimHTML(platform) {
  return `
    <section class="hero slim">
      <div class="hero-glow"></div>
      <div class="container hero-inner">
        <h1 class="slim-title">${escapeHtml(platform)}</h1>
      </div>
    </section>
  `;
}

function howToHTML() {
  return `
    <section class="how-to">
      <div class="container how-inner">
        <img src="/assets/mascot.png" alt="" class="mascot">
        <div class="how-text">
          <h2>¿Cómo comprar?</h2>
          <ol class="steps">
            <li><strong>Elegí tu juego</strong> y la modalidad (Principal o Secundaria).</li>
            <li><strong>Tocá el botón de WhatsApp</strong> y te llega el mensaje listo.</li>
            <li><strong>Pagás por SINPE</strong> o transferencia bancaria.</li>
            <li><strong>Te entregamos el código</strong> o el acceso de inmediato.</li>
          </ol>
        </div>
      </div>
    </section>
  `;
}

function toolbarHTML(showPlatformFilters = true) {
  return `
    <div class="toolbar">
      <input id="search" type="search" placeholder="Buscar juego..." autocomplete="off">
      ${showPlatformFilters ? `
        <div class="filters">
          <button class="filter active" data-platform="all">Todos</button>
          <button class="filter" data-platform="PS5">PS5</button>
          <button class="filter" data-platform="PS4">PS4</button>
          <button class="filter" data-sale="true">En oferta</button>
        </div>
      ` : `
        <div class="filters">
          <button class="filter active" data-platform="all">Todos</button>
          <button class="filter" data-sale="true">En oferta</button>
        </div>
      `}
    </div>
  `;
}

// ============================================================
// Grid + filtros locales
// ============================================================
const localFilters = { platform: "all", sale: false, q: "" };
let localList = [];

function mountToolbar(baseList) {
  localFilters.platform = "all";
  localFilters.sale = false;
  localFilters.q = "";
  localList = baseList || allGames;

  const search = document.getElementById("search");
  if (!search) return;
  let debounce;
  search.addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      localFilters.q = e.target.value.trim();
      applyFilters();
    }, 150);
  });
  document.querySelectorAll(".filter").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.sale) {
        localFilters.sale = !localFilters.sale;
        btn.classList.toggle("active");
      } else if (btn.dataset.platform) {
        localFilters.platform = btn.dataset.platform;
        document.querySelectorAll(".filter[data-platform]").forEach(b =>
          b.classList.toggle("active", b === btn)
        );
      }
      applyFilters();
    });
  });
}

function applyFilters() {
  let list = localList;
  if (localFilters.platform !== "all") {
    list = list.filter(g => g.platform.includes(localFilters.platform));
  }
  if (localFilters.sale) list = list.filter(g => g.onSale);
  if (localFilters.q) {
    const q = localFilters.q.toLowerCase();
    list = list.filter(g => g.title.toLowerCase().includes(q));
  }
  renderGrid(list);
}

function renderGrid(list) {
  const grid = document.getElementById("grid");
  if (!grid) return;

  if (!loaded) {
    grid.innerHTML = `<div class="status">Cargando catálogo...</div>`;
    return;
  }
  if (loadError) {
    grid.innerHTML = `<div class="status error">Error: ${escapeHtml(loadError)}</div>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="status">No hay juegos que coincidan.</div>`;
    return;
  }
  grid.innerHTML = list.map(cardHTML).join("");
}

function cardHTML(g) {
  const principal = principalCRC(g.priceUSD);
  const secundaria = secundariaCRC(g.priceUSD);
  const img = g.imageUrl
    ? `<img src="${escapeAttr(g.imageUrl)}" alt="${escapeAttr(g.title)}" loading="lazy">`
    : `<div class="placeholder">🎮</div>`;
  return `
    <a class="card" href="#/producto/${encodeURIComponent(g.id)}">
      <div class="card-image">
        ${img}
        ${g.onSale ? `<span class="badge-sale">-${g.discount}%</span>` : ""}
        <span class="badge-platform">${escapeHtml(g.platform)}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(g.title)}</div>
        <div class="price-rows">
          <div class="price-row">
            <span class="price-tag">Principal</span>
            <span class="price-value">${formatCRC(principal)}</span>
          </div>
          <div class="price-row secundaria">
            <span class="price-tag">Secundaria</span>
            <span class="price-value">${formatCRC(secundaria)}</span>
          </div>
        </div>
      </div>
    </a>
  `;
}

// ============================================================
// Helpers
// ============================================================
function principalCRC(usd) {
  return Math.round(usd * CONFIG.pricing.exchangeRate * CONFIG.pricing.principalMarkup);
}
function secundariaCRC(usd) {
  return Math.round(usd * CONFIG.pricing.exchangeRate * CONFIG.pricing.secundariaMarkup);
}
function formatCRC(amount) {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0,
  }).format(amount);
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
// Boot
// ============================================================
render();
load();

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

  // Plataformas con catálogo activo. Switch/PS3 quedan visibles
  // pero muestran "Próximamente" hasta que les conectemos un data source.
  activePlatforms: ["PS5", "PS4", "Xbox"],

  // Cantidad de juegos por página en el catálogo.
  perPage: 50,
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
// Carrito (persistido en localStorage)
// ============================================================
const CART_KEY = "rmd_cart_v1";

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); }
  catch { return []; }
}
function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  updateCartBadge();
}
function addToCart(game, modality) {
  const items = loadCart();
  const price = modality === "principal" ? principalCRC(game.priceUSD) : secundariaCRC(game.priceUSD);
  const exists = items.find(i => i.id === game.id && i.modality === modality);
  if (exists) return false;
  items.push({
    id: game.id,
    title: game.title,
    platform: game.platform,
    imageUrl: game.imageUrl,
    modality,
    priceCRC: price,
  });
  saveCart(items);
  return true;
}
function removeFromCart(id, modality) {
  const items = loadCart().filter(i => !(i.id === id && i.modality === modality));
  saveCart(items);
}
function clearCart() { saveCart([]); }

function updateCartBadge() {
  const badge = document.getElementById("cartBadge");
  if (!badge) return;
  const count = loadCart().length;
  badge.textContent = count;
  badge.classList.toggle("show", count > 0);
}

// ============================================================
// Routing por hash
// ============================================================
function parseRoute() {
  const h = location.hash.replace(/^#/, "") || "/";
  if (h === "/" || h === "") return { name: "home", page: 1 };

  const partes = h.replace(/^\//, "").split("/");
  if (partes[0] === "carrito") return { name: "cart" };

  if (partes[0] === "plataforma" && partes[1]) {
    const page = (partes[2] === "p" && partes[3]) ? parseInt(partes[3], 10) || 1 : 1;
    return { name: "platform", platform: decodeURIComponent(partes[1]), page };
  }
  if (partes[0] === "producto" && partes[1]) {
    return { name: "product", id: decodeURIComponent(partes[1]) };
  }
  if (partes[0] === "p" && partes[1]) {
    return { name: "home", page: parseInt(partes[1], 10) || 1 };
  }
  return { name: "home", page: 1 };
}

function navigateActive() {
  const route = parseRoute();
  document.querySelectorAll(".topnav a").forEach(a => {
    const r = a.dataset.route;
    const active =
      (route.name === "home" && r === "home") ||
      (route.name === "platform" && r === route.platform) ||
      (route.name === "cart" && r === "cart");
    a.classList.toggle("active", active);
  });
}

window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

// ============================================================
// Carga inicial desde /api/scrape
// ============================================================
async function load() {
  try {
    const [psn, xbox] = await Promise.allSettled([
      fetch("/api/scrape").then(r => r.json()),
      fetch("/api/scrape-xbox").then(r => r.json()),
    ]);
    const games = [];
    if (psn.status === "fulfilled" && psn.value.success) {
      games.push(...(psn.value.games || []));
    }
    if (xbox.status === "fulfilled" && xbox.value.success) {
      games.push(...(xbox.value.games || []).filter(g => !g._placeholder));
    }
    if (!games.length) {
      throw new Error("No se pudo cargar ningún juego");
    }
    allGames = games.sort((a, b) => {
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
  updateCartBadge();
  const route = parseRoute();
  if (route.name === "product") return renderProduct(route.id);
  if (route.name === "platform") return renderPlatform(route.platform, route.page);
  if (route.name === "cart") return renderCart();
  return renderHome(route.page);
}

function renderHome(page = 1) {
  app.innerHTML = `
    ${heroHTML()}
    <section class="container catalog-section">
      <div class="section-title">
        <h2>Catálogo destacado</h2>
        <p>Tocá un juego para ver detalles y agregarlo al carrito.</p>
      </div>
      ${toolbarHTML()}
      <div id="grid" class="grid"></div>
      <div id="pagination" class="pagination"></div>
    </section>
    ${howToHTML()}
  `;
  mountToolbar(null, page, "/");
}

function renderPlatform(platform, page = 1) {
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
      <div id="pagination" class="pagination"></div>
    </section>
  `;
  mountToolbar(list, page, `/plataforma/${platform}`);
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
            <div class="price-card principal">
              <div class="price-label">Cuenta Principal</div>
              <div class="price-amount">${formatCRC(principal)}</div>
              <div class="price-note">Acceso completo, sin restricciones</div>
              <button class="price-cta" data-add="principal" data-id="${escapeAttr(g.id)}">Agregar al carrito</button>
            </div>
            <div class="price-card secundaria">
              <div class="price-label">Cuenta Secundaria</div>
              <div class="price-amount">${formatCRC(secundaria)}</div>
              <div class="price-note">Más económico, requiere estar conectado</div>
              <button class="price-cta" data-add="secundaria" data-id="${escapeAttr(g.id)}">Agregar al carrito</button>
            </div>
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
  bindAddButtons(g);
}

function bindAddButtons(game) {
  document.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => {
      const mod = btn.dataset.add;
      const added = addToCart(game, mod);
      if (added) {
        showToast(`Agregado al carrito (${mod === "principal" ? "Principal" : "Secundaria"})`);
        btn.textContent = "Agregado ✓";
        btn.classList.add("added");
        setTimeout(() => {
          btn.textContent = "Agregar al carrito";
          btn.classList.remove("added");
        }, 2000);
      } else {
        showToast("Ese juego ya está en tu carrito");
      }
    });
  });
}

// ============================================================
// Carrito (vista)
// ============================================================
function renderCart() {
  const items = loadCart();
  if (!items.length) {
    app.innerHTML = `
      <section class="container empty-state">
        <h2>Tu carrito está vacío</h2>
        <p>Agregá juegos desde el catálogo y los pedís todos juntos por WhatsApp.</p>
        <a class="cta" href="#/">Ir al catálogo</a>
      </section>
    `;
    return;
  }
  const total = items.reduce((s, i) => s + i.priceCRC, 0);
  app.innerHTML = `
    <section class="container cart-page">
      <a class="back-link" href="#/">&larr; Seguir comprando</a>
      <h1 class="cart-title">Tu pedido</h1>
      <div class="cart-list">
        ${items.map(cartItemHTML).join("")}
      </div>
      <div class="cart-summary">
        <div class="cart-row total">
          <span>Total</span>
          <span class="cart-total">${formatCRC(total)}</span>
        </div>
        <button id="checkoutBtn" class="cta cta-wa">Enviar pedido por WhatsApp</button>
        <button id="clearCartBtn" class="cta-secondary">Vaciar carrito</button>
        <p class="cart-note">Te respondemos para confirmar disponibilidad y enviarte los datos de pago (SINPE o transferencia).</p>
      </div>
    </section>
  `;
  bindCartActions();
}

function cartItemHTML(item) {
  const img = item.imageUrl
    ? `<img src="${escapeAttr(item.imageUrl)}" alt="${escapeAttr(item.title)}">`
    : `<div class="placeholder">🎮</div>`;
  const modLabel = item.modality === "principal" ? "Cuenta Principal" : "Cuenta Secundaria";
  const modClass = item.modality === "principal" ? "principal" : "secundaria";
  return `
    <div class="cart-item">
      <div class="cart-img">${img}</div>
      <div class="cart-info">
        <div class="cart-game-title">${escapeHtml(item.title)}</div>
        <div class="cart-meta">
          <span class="cart-platform">${escapeHtml(item.platform)}</span>
          <span class="cart-modality ${modClass}">${modLabel}</span>
        </div>
      </div>
      <div class="cart-price">${formatCRC(item.priceCRC)}</div>
      <button class="cart-remove" data-remove-id="${escapeAttr(item.id)}" data-remove-mod="${item.modality}" aria-label="Quitar del carrito">&times;</button>
    </div>
  `;
}

function bindCartActions() {
  document.querySelectorAll("[data-remove-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      removeFromCart(btn.dataset.removeId, btn.dataset.removeMod);
      renderCart();
    });
  });
  const clearBtn = document.getElementById("clearCartBtn");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    if (confirm("¿Vaciar el carrito?")) { clearCart(); renderCart(); }
  });
  const checkoutBtn = document.getElementById("checkoutBtn");
  if (checkoutBtn) checkoutBtn.addEventListener("click", checkout);
}

function checkout() {
  const items = loadCart();
  if (!items.length) return;
  const total = items.reduce((s, i) => s + i.priceCRC, 0);
  const lines = items.map((i, idx) =>
    `${idx + 1}. ${i.title} (${i.platform}) — ${i.modality === "principal" ? "CUENTA PRINCIPAL" : "CUENTA SECUNDARIA"} — ${formatCRC(i.priceCRC)}`
  );
  const msg = [
    "Hola Rey Midas, quiero pedir lo siguiente:",
    "",
    ...lines,
    "",
    `Total: ${formatCRC(total)}`,
    "",
    "¿Me confirman disponibilidad y datos de pago? Gracias.",
  ].join("\n");
  window.open(`https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(msg)}`, "_blank");
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
            <li><strong>Elegí tus juegos</strong> y agregalos al carrito.</li>
            <li><strong>Enviá el pedido</strong> por WhatsApp con un solo botón.</li>
            <li><strong>Pagás por SINPE</strong> o transferencia bancaria.</li>
            <li><strong>Te entregamos el código</strong> o el acceso al instante.</li>
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
          <button class="filter" data-platform="Xbox">Xbox</button>
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
// Grid + filtros + paginación
// ============================================================
const localFilters = { platform: "all", sale: false, q: "" };
let localList = [];
let currentPage = 1;
let currentRouteBase = "/";

function mountToolbar(baseList, page = 1, routeBase = "/") {
  localFilters.platform = "all";
  localFilters.sale = false;
  localFilters.q = "";
  localList = baseList || allGames;
  currentPage = page;
  currentRouteBase = routeBase;

  const search = document.getElementById("search");
  if (search) {
    let debounce;
    search.addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        localFilters.q = e.target.value.trim();
        currentPage = 1;
        applyFilters();
      }, 150);
    });
  }
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
      currentPage = 1;
      applyFilters();
    });
  });
  applyFilters();
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
  renderPagination(list.length);
}

function paginate(list) {
  const start = (currentPage - 1) * CONFIG.perPage;
  return list.slice(start, start + CONFIG.perPage);
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
  const page = paginate(list);
  grid.innerHTML = page.map(cardHTML).join("");
}

function renderPagination(total) {
  const el = document.getElementById("pagination");
  if (!el) return;
  const pages = Math.max(1, Math.ceil(total / CONFIG.perPage));
  if (pages <= 1) { el.innerHTML = ""; return; }

  const items = pageRange(currentPage, pages);
  el.innerHTML = `
    <button class="page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>‹ Anterior</button>
    ${items.map(it => it === "..."
      ? `<span class="page-ellipsis">…</span>`
      : `<button class="page-btn ${it === currentPage ? "active" : ""}" data-page="${it}">${it}</button>`
    ).join("")}
    <button class="page-btn" data-page="${currentPage + 1}" ${currentPage === pages ? "disabled" : ""}>Siguiente ›</button>
  `;
  el.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = parseInt(btn.dataset.page, 10);
      if (!p || p < 1 || p > pages) return;
      goToPage(p);
    });
  });
}

function pageRange(current, total) {
  const out = [];
  const window_ = 1;
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - window_ && i <= current + window_)) {
      out.push(i);
    } else if (out[out.length - 1] !== "...") {
      out.push("...");
    }
  }
  return out;
}

function goToPage(p) {
  currentPage = p;
  const base = currentRouteBase === "/" ? "" : currentRouteBase;
  const newHash = p === 1 ? `#/${base.replace(/^\//, "")}` : `#${base}/p/${p}`;
  if (location.hash !== newHash) {
    location.hash = newHash;
  } else {
    applyFilters();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
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
// Toast
// ============================================================
function showToast(text) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 2200);
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

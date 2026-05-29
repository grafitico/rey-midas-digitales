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

  // Plataformas con catálogo activo. PS3 queda visible
  // pero muestra "Próximamente" hasta que le conectemos un data source.
  activePlatforms: ["PS5", "PS4", "Xbox", "Switch"],

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
let nintendo = { telegramChannel: "", bundles: [] };
let psBundles = { bundles: [] };
let xboxBundles = { bundles: [] };
let manualOffers = []; // ofertas con precio fijo (no derivado del USD)
let banners = [];
let testimonials = [];
let faqs = [];
let psPlusPlans = [];
let gamePassPlans = [];
let reservaciones = [];

// ============================================================
// Auth propio — usa los endpoints en /api/auth y /api/* con un
// token HMAC guardado en localStorage. Sin Supabase Auth.
// ============================================================
const TOKEN_KEY = "rmd_token_v1";
let currentUser = null;
let usersExist = true; // se actualiza en initAuth(); controla el botón "Crear primer admin"

function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

// Wrapper para todos los fetches a la API: agrega el token y parsea errores.
async function apiPost(path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* respuesta vacía */ }
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function initAuth() {
  const token = getToken();
  if (token) {
    try {
      const { user } = await apiPost("/api/auth", { action: "me" });
      currentUser = user;
    } catch (err) {
      // Token inválido / expirado: limpiar
      if (err.status === 401) clearToken();
      currentUser = null;
    }
  }
  // Detectar si ya hay algún usuario en la base (para mostrar bootstrap o no)
  if (!currentUser) {
    try {
      // Intento de bootstrap dummy — si responde 403 ya hay usuarios.
      const test = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bootstrap", email: "", password: "" }),
      });
      const data = await test.json().catch(() => ({}));
      // 400 = "email/pass requeridos" → no hay usuarios todavía
      // 403 = "ya hay usuarios" → bootstrap deshabilitado
      usersExist = test.status === 403 || /Ya hay usuarios/i.test(data.error || "");
    } catch { usersExist = true; }
  }
  renderAuthSlot();
  const r = parseRoute();
  if (["mi-cuenta", "admin", "login"].includes(r.name)) render();
}

async function loginWithPassword(email, password) {
  try {
    const { token, user } = await apiPost("/api/auth", { action: "login", email, password });
    setToken(token);
    currentUser = user;
    usersExist = true;
    renderAuthSlot();
    return null;
  } catch (err) {
    return err;
  }
}

async function bootstrapAdmin(email, password, fullName) {
  try {
    const { token, user } = await apiPost("/api/auth", {
      action: "bootstrap", email, password, full_name: fullName || null,
    });
    setToken(token);
    currentUser = user;
    usersExist = true;
    renderAuthSlot();
    return null;
  } catch (err) {
    return err;
  }
}

async function changePassword(newPassword) {
  try {
    await apiPost("/api/auth", { action: "change-password", password: newPassword });
    return null;
  } catch (err) {
    return err;
  }
}

function logout() {
  clearToken();
  currentUser = null;
  renderAuthSlot();
  location.hash = "#/";
}

function renderAuthSlot() {
  const slot = document.getElementById("authSlot");
  if (!slot) return;
  if (!currentUser) {
    slot.innerHTML = `<a href="#/login" data-route="login" class="auth-btn">Iniciar sesión</a>`;
    return;
  }
  const name = currentUser.full_name || currentUser.email.split("@")[0];
  const initial = (name[0] || "?").toUpperCase();
  slot.innerHTML = `
    <div class="auth-menu">
      <button class="auth-trigger" id="authTrigger">
        <span class="avatar-fallback">${escapeHtml(initial)}</span>
        <span class="auth-name">${escapeHtml(name)}</span>
      </button>
      <div class="auth-dropdown" id="authDropdown" hidden>
        <a href="#/mi-cuenta">Mi cuenta</a>
        ${currentUser.is_admin ? `<a href="#/admin">Admin</a>` : ""}
        <button id="logoutBtn">Cerrar sesión</button>
      </div>
    </div>
  `;
  const trigger = document.getElementById("authTrigger");
  const dropdown = document.getElementById("authDropdown");
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.hidden = !dropdown.hidden;
  });
  document.addEventListener("click", () => { dropdown.hidden = true; }, { once: true });
  document.getElementById("logoutBtn").addEventListener("click", logout);
}

// WhatsApp footer + floating button + duplicate link
const waUrl = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Hola, vengo desde reymidascr.com y quiero hacer una consulta.")}`;
if (waLink) {
  waLink.href = waUrl;
  waLink.title = formatPhone(CONFIG.whatsapp);
}
const waFooter = document.getElementById("waLinkFooter");
if (waFooter) waFooter.href = waUrl;
const waFloat = document.getElementById("waFloat");
if (waFloat) waFloat.href = waUrl;

// Menú mobile (hamburguesa)
const mobileToggle = document.getElementById("mobileToggle");
const topnav = document.getElementById("topnav");
if (mobileToggle && topnav) {
  mobileToggle.addEventListener("click", () => {
    topnav.classList.toggle("open");
  });
  // Cerrar al hacer click en un link
  topnav.addEventListener("click", (e) => {
    if (e.target.closest("a")) topnav.classList.remove("open");
  });
}

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
  let price;
  if (game._manualPrices) {
    price = modality === "principal" ? game.priceCRC_principal : game.priceCRC_secundaria;
  } else {
    price = modality === "principal" ? principalCRC(game.priceUSD) : secundariaCRC(game.priceUSD);
  }
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

  // Hashes viejos de Supabase Auth — limpiarlos y mandar a inicio.
  if (h.includes("error=") || h.includes("access_token=")) {
    setTimeout(() => { history.replaceState(null, "", location.pathname); location.hash = "#/"; }, 0);
    return { name: "home", page: 1 };
  }

  const partes = h.replace(/^\//, "").split("/");
  if (partes[0] === "carrito") return { name: "cart" };

  if (partes[0] === "plataforma" && partes[1]) {
    const page = (partes[2] === "p" && partes[3]) ? parseInt(partes[3], 10) || 1 : 1;
    return { name: "platform", platform: decodeURIComponent(partes[1]), page };
  }
  if (partes[0] === "producto" && partes[1]) {
    return { name: "product", id: decodeURIComponent(partes[1]) };
  }
  if (partes[0] === "nintendo" && partes[1]) {
    return { name: "bundle", id: decodeURIComponent(partes[1]), type: "nintendo" };
  }
  if (partes[0] === "ps-bundle" && partes[1]) {
    return { name: "bundle", id: decodeURIComponent(partes[1]), type: "ps" };
  }
  if (partes[0] === "xbox-bundle" && partes[1]) {
    return { name: "bundle", id: decodeURIComponent(partes[1]), type: "xbox" };
  }
  if (partes[0] === "bundles" && partes[1]) {
    return { name: "bundles-list", platform: decodeURIComponent(partes[1]) };
  }
  if (partes[0] === "ofertas") {
    const page = (partes[1] === "p" && partes[2]) ? parseInt(partes[2], 10) || 1 : 1;
    return { name: "ofertas", page };
  }
  if (["como-comprar", "faq", "terminos", "privacidad", "garantia", "nosotros"].includes(partes[0])) {
    return { name: "info", slug: partes[0] };
  }
  if (partes[0] === "playstation-plus") return { name: "subscriptions", service: "psplus" };
  if (partes[0] === "game-pass") return { name: "subscriptions", service: "gamepass" };
  if (partes[0] === "reservaciones") return { name: "reservaciones" };
  if (partes[0] === "login") return { name: "login" };
  if (partes[0] === "mi-cuenta") return { name: "mi-cuenta" };
  if (partes[0] === "admin") return { name: "admin" };
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
    const [psn, xbox, nin, psB, xboxB, offers, bann, test, fq, psp, gp, resv] = await Promise.allSettled([
      fetch("/api/scrape").then(r => r.json()),
      fetch("/api/scrape-xbox").then(r => r.json()),
      fetch("/nintendo-bundles.json").then(r => r.json()),
      fetch("/ps-bundles.json").then(r => r.json()),
      fetch("/xbox-bundles.json").then(r => r.json()),
      fetch("/offers.json").then(r => r.json()),
      fetch("/banners.json").then(r => r.json()),
      fetch("/testimonials.json").then(r => r.json()),
      fetch("/faq.json").then(r => r.json()),
      fetch("/playstation-plus.json").then(r => r.json()),
      fetch("/game-pass.json").then(r => r.json()),
      fetch("/reservaciones.json").then(r => r.json()),
    ]);
    if (bann.status === "fulfilled" && Array.isArray(bann.value?.banners)) banners = bann.value.banners;
    if (test.status === "fulfilled" && Array.isArray(test.value?.testimonials)) testimonials = test.value.testimonials;
    if (fq.status === "fulfilled" && Array.isArray(fq.value?.faqs)) faqs = fq.value.faqs;
    if (psp.status === "fulfilled" && Array.isArray(psp.value?.plans)) psPlusPlans = psp.value.plans;
    if (gp.status === "fulfilled" && Array.isArray(gp.value?.plans)) gamePassPlans = gp.value.plans;
    if (resv.status === "fulfilled" && Array.isArray(resv.value?.items)) reservaciones = resv.value.items;
    const games = [];
    if (psn.status === "fulfilled" && psn.value.success) {
      games.push(...(psn.value.games || []));
    }
    if (xbox.status === "fulfilled" && xbox.value.success) {
      games.push(...(xbox.value.games || []).filter(g => !g._placeholder));
    }
    if (nin.status === "fulfilled" && nin.value && Array.isArray(nin.value.bundles)) {
      nintendo = nin.value;
    }
    if (psB.status === "fulfilled" && psB.value && Array.isArray(psB.value.bundles)) {
      psBundles = psB.value;
    }
    if (xboxB.status === "fulfilled" && xboxB.value && Array.isArray(xboxB.value.bundles)) {
      xboxBundles = xboxB.value;
    }
    if (offers.status === "fulfilled" && offers.value && Array.isArray(offers.value.offers)) {
      manualOffers = offers.value.offers.map(o => ({
        ...o,
        _manualPrices: true,
        onSale: true,
        discount: o.originalPriceCRC && o.priceCRC_principal
          ? Math.round((1 - o.priceCRC_principal / o.originalPriceCRC) * 100)
          : 0,
      }));
      // Las ofertas manuales se mergean al catálogo principal
      games.push(...manualOffers);
    }
    if (!games.length && !nintendo.bundles.length && !psBundles.bundles.length && !xboxBundles.bundles.length) {
      throw new Error("No se pudo cargar ningún juego");
    }
    allGames = games.sort((a, b) => {
      if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
      return (b.discount || 0) - (a.discount || 0);
    });
  } catch (err) {
    loadError = err.message;
  } finally {
    loaded = true;
    render();
    enrichBundleCovers();
  }
}

// Auto-busca carátulas de Nintendo para los bundles sin coverUrl.
// Cachea cada resultado en localStorage para no re-pedirlas.
async function enrichBundleCovers() {
  if (!nintendo.bundles?.length) return;
  const updated = [];
  await Promise.all(nintendo.bundles.map(async (b) => {
    if (b.coverUrl) return;
    const firstGame = b.games?.[0]?.name;
    if (!firstGame) return;
    const key = `cover:${firstGame}`;
    let url = localStorage.getItem(key);
    if (url === null) {
      try {
        const r = await fetch(`/api/cover?q=${encodeURIComponent(firstGame)}`);
        const data = await r.json();
        url = data.coverUrl || "";
        localStorage.setItem(key, url);
      } catch {
        url = "";
      }
    }
    if (url) {
      b.coverUrl = url;
      updated.push(b.id);
    }
  }));
  if (!updated.length) return;
  // Si el usuario está en una vista que muestra bundles, actualizamos en DOM
  // sin re-renderizar entero (evita perder scroll).
  applyCoverUpdates(updated);
}

function applyCoverUpdates(bundleIds) {
  const bundles = nintendo.bundles || [];
  for (const id of bundleIds) {
    const b = bundles.find(x => x.id === id);
    if (!b?.coverUrl) continue;
    // Tarjetas en la grilla y/o imagen de detalle
    document.querySelectorAll(`a[href$="/nintendo/${encodeURIComponent(id)}"] .card-image`).forEach(box => {
      const placeholder = box.querySelector(".placeholder");
      if (placeholder) {
        const img = new Image();
        img.src = b.coverUrl;
        img.alt = `Bundle ${id}`;
        img.loading = "lazy";
        placeholder.replaceWith(img);
      }
    });
    // Detalle (la URL actual termina en /nintendo/<id>)
    if (location.hash.endsWith(`/nintendo/${encodeURIComponent(id)}`)) {
      const detail = document.querySelector(".product-image .placeholder");
      if (detail) {
        const img = new Image();
        img.src = b.coverUrl;
        img.alt = `Bundle ${id}`;
        detail.replaceWith(img);
      }
    }
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
  if (route.name === "bundle") return renderBundle(route.id, route.type || "nintendo");
  if (route.name === "platform") {
    if (route.platform === "Switch") return renderSwitch();
    return renderPlatform(route.platform, route.page);
  }
  if (route.name === "bundles-list") return renderBundlesList(route.platform);
  if (route.name === "ofertas") return renderOfertas(route.page);
  if (route.name === "info") return renderInfoPage(route.slug);
  if (route.name === "subscriptions") return renderSubscriptions(route.service);
  if (route.name === "reservaciones") return renderReservaciones();
  if (route.name === "cart") return renderCart();
  if (route.name === "login") return renderLogin();
  if (route.name === "mi-cuenta") return renderMyAccount();
  if (route.name === "admin") return renderAdmin();
  return renderHome(route.page);
}

function renderHome(page = 1) {
  app.innerHTML = `
    ${heroHTML()}
    ${trustBarHTML()}
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
    ${testimonialsHTML()}
    ${faqInlineHTML(5)}
  `;
  mountHeroSlider();
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
  const principal = g._manualPrices ? g.priceCRC_principal : principalCRC(g.priceUSD);
  const secundaria = g._manualPrices ? g.priceCRC_secundaria : secundariaCRC(g.priceUSD);
  app.innerHTML = `
    <section class="container product-page">
      <a class="back-link" href="#/">&larr; Volver al catálogo</a>
      <div class="product-grid">
        <div class="product-image">
          ${g.imageUrl ? `<img src="${escapeAttr(g.imageUrl)}" alt="${escapeAttr(g.title)}">` : `<div class="placeholder">🎮</div>`}
          ${g.onSale && g.discount ? `<span class="badge-sale">-${g.discount}%</span>` : ""}
        </div>
        <div class="product-info">
          <span class="product-platform">${escapeHtml(g.platform)}</span>
          <h1>${escapeHtml(g.title)}</h1>
          <p class="product-desc">Juego digital para ${escapeHtml(g.platform)}. Te entregamos el acceso por WhatsApp luego de confirmar el pago por SINPE Móvil o transferencia bancaria.</p>

          <div class="price-options">
            ${principal != null ? `
              <div class="price-card principal">
                <div class="price-label">Cuenta Principal</div>
                <div class="price-amount">${formatCRC(principal)}</div>
                <div class="price-note">Acceso completo, sin restricciones</div>
                <button class="price-cta" data-add="principal" data-id="${escapeAttr(g.id)}">Agregar al carrito</button>
              </div>
            ` : ""}
            ${secundaria != null ? `
              <div class="price-card secundaria">
                <div class="price-label">Cuenta Secundaria</div>
                <div class="price-amount">${formatCRC(secundaria)}</div>
                <div class="price-note">Más económico, requiere estar conectado</div>
                <button class="price-cta" data-add="secundaria" data-id="${escapeAttr(g.id)}">Agregar al carrito</button>
              </div>
            ` : ""}
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

// ============================================================
// Switch / bundles Nintendo
// ============================================================
function renderSwitch() {
  const bundles = nintendo.bundles || [];
  app.innerHTML = `
    ${heroSlimHTML("Nintendo Switch")}
    <section class="container catalog-section">
      <div class="section-title">
        <h2>Bundles Nintendo Switch</h2>
        <p>Paquetes con varios juegos por un solo precio. ${bundles.length} ${bundles.length === 1 ? "bundle disponible" : "bundles disponibles"}.</p>
        <a class="telegram-link" href="${escapeAttr(nintendo.telegramChannel || "#")}" target="_blank" rel="noopener">
          Ver todos los bundles en Telegram &rarr;
        </a>
      </div>
      ${bundles.length ? `
        <div class="grid bundles">
          ${bundles.map(b => bundleCardHTML(b, "nintendo")).join("")}
        </div>
      ` : `
        <div class="status">Aún no hay bundles publicados. Mientras tanto pasate por nuestro canal de Telegram.</div>
      `}
    </section>
  `;
}

function renderBundlesList(platform) {
  const cfg = {
    PS: { source: psBundles, title: "Bundles PlayStation", subtitle: "Bundles de PS5/PS4 con varios juegos por un solo precio.", type: "ps" },
    Xbox: { source: xboxBundles, title: "Bundles Xbox", subtitle: "Bundles de Xbox con varios juegos por un solo precio.", type: "xbox" },
  }[platform];
  if (!cfg) {
    app.innerHTML = `<section class="container empty-state"><h2>Plataforma no encontrada</h2><a class="cta" href="#/">Inicio</a></section>`;
    return;
  }
  const bundles = cfg.source.bundles || [];
  app.innerHTML = `
    ${heroSlimHTML(cfg.title)}
    <section class="container catalog-section">
      <div class="section-title">
        <h2>${escapeHtml(cfg.title)}</h2>
        <p>${escapeHtml(cfg.subtitle)} ${bundles.length} ${bundles.length === 1 ? "bundle disponible" : "bundles disponibles"}.</p>
        ${cfg.source.telegramChannel ? `
          <a class="telegram-link" href="${escapeAttr(cfg.source.telegramChannel)}" target="_blank" rel="noopener">
            Ver más en Telegram &rarr;
          </a>
        ` : ""}
      </div>
      ${bundles.length ? `
        <div class="grid bundles">
          ${bundles.map(b => bundleCardHTML(b, cfg.type)).join("")}
        </div>
      ` : `
        <div class="status">Aún no hay bundles publicados. Escribinos por WhatsApp para consultar.</div>
      `}
    </section>
  `;
}

function renderOfertas(page = 1) {
  const list = (allGames || []).filter(g => g.onSale);
  app.innerHTML = `
    ${heroSlimHTML("Ofertas")}
    <section class="container catalog-section">
      <div class="section-title">
        <h2>Ofertas y promos</h2>
        <p>${list.length} ${list.length === 1 ? "juego en oferta" : "juegos en oferta"}.</p>
      </div>
      ${toolbarHTML()}
      <div id="grid" class="grid"></div>
      <div id="pagination" class="pagination"></div>
    </section>
  `;
  mountToolbar(list, page, "/ofertas");
}

// ============================================================
// Suscripciones (PS Plus / Game Pass)
// ============================================================
function renderSubscriptions(service) {
  const cfg = {
    psplus: {
      plans: psPlusPlans,
      title: "PlayStation Plus",
      subtitle: "Multijugador online, juegos mensuales gratis y catálogo Extra/Deluxe para PS5 y PS4.",
      brandClass: "brand-ps",
      brandIcon: "🎮",
      themeColor: "cyan",
    },
    gamepass: {
      plans: gamePassPlans,
      title: "Xbox Game Pass",
      subtitle: "Acceso a +400 juegos en Xbox y PC, lanzamientos día 1 y multijugador online.",
      brandClass: "brand-xbox",
      brandIcon: "🟢",
      themeColor: "green",
    },
  }[service];
  if (!cfg) {
    app.innerHTML = `<section class="container empty-state"><h2>Servicio no encontrado</h2><a class="cta" href="#/">Inicio</a></section>`;
    return;
  }
  app.innerHTML = `
    ${heroSlimHTML(cfg.title)}
    <section class="container subscriptions-page">
      <div class="section-title centered">
        <h2>${escapeHtml(cfg.title)}</h2>
        <p>${escapeHtml(cfg.subtitle)}</p>
      </div>
      ${cfg.plans.length ? `
        <div class="plans-grid ${escapeAttr(cfg.brandClass)}">
          ${cfg.plans.map(p => planCardHTML(p, cfg.title)).join("")}
        </div>
        <div class="subs-note">
          <p><strong>¿Cómo funciona?</strong> Elegí el plan que necesitás, hacé click en "Comprar por WhatsApp" y te coordinamos el alta inmediata. Activamos el código en tu cuenta de PSN/Xbox sin necesidad de darnos tu contraseña.</p>
          <p><strong>Métodos de pago:</strong> SINPE Móvil o transferencia bancaria.</p>
        </div>
      ` : `
        <div class="empty-purchases">
          <p>Próximamente tendrás los planes acá. Mientras tanto consultanos por WhatsApp.</p>
          <a class="cta cta-wa" href="https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Hola, me interesa una suscripción de " + cfg.title + ", ¿qué planes manejan?")}" target="_blank" rel="noopener">Consultar por WhatsApp</a>
        </div>
      `}
    </section>
  `;
}

function planCardHTML(p, serviceTitle) {
  const waMsg = encodeURIComponent(`Hola, me interesa el plan ${serviceTitle} ${p.tier} (${p.duration}) por ${formatCRC(p.priceCRC)}. ¿Sigue disponible?`);
  return `
    <article class="plan-card ${p.popular ? "popular" : ""}">
      ${p.popular ? `<span class="plan-badge">Más popular</span>` : ""}
      <div class="plan-head">
        <span class="plan-tier">${escapeHtml(p.tier)}</span>
        <span class="plan-duration">${escapeHtml(p.duration)}</span>
      </div>
      <div class="plan-price">
        <span class="plan-amount">${formatCRC(p.priceCRC)}</span>
      </div>
      <ul class="plan-features">
        ${(p.features || []).map(f => `<li>${escapeHtml(f)}</li>`).join("")}
      </ul>
      <a class="cta cta-wa plan-cta" href="https://wa.me/${CONFIG.whatsapp}?text=${waMsg}" target="_blank" rel="noopener">
        Comprar por WhatsApp
      </a>
    </article>
  `;
}

// ============================================================
// Reservaciones (pre-orders)
// ============================================================
function renderReservaciones() {
  app.innerHTML = `
    ${heroSlimHTML("Reservaciones")}
    <section class="container catalog-section">
      <div class="section-title centered">
        <h2>Reservá tus juegos antes del lanzamiento</h2>
        <p>Asegurate tu copia desde el día 1. Pagás una señal y completás cuando se lanza.</p>
      </div>
      ${reservaciones.length ? `
        <div class="grid reservas-grid">
          ${reservaciones.map(reservaCardHTML).join("")}
        </div>
      ` : `
        <div class="empty-purchases">
          <p>Por ahora no tenemos reservas abiertas. Pronto vamos a sumar los próximos lanzamientos.</p>
          <a class="cta cta-wa" href="https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Hola, quiero saber qué reservas tienen abiertas.")}" target="_blank" rel="noopener">Consultar por WhatsApp</a>
        </div>
      `}
    </section>
  `;
}

function reservaCardHTML(r) {
  const release = r.releaseDate
    ? new Date(r.releaseDate + "T00:00:00").toLocaleDateString("es-CR", { year: "numeric", month: "long", day: "numeric" })
    : "Por anunciar";
  const img = r.imageUrl
    ? `<img src="${escapeAttr(r.imageUrl)}" alt="${escapeAttr(r.title)}" loading="lazy">`
    : `<div class="placeholder">🎮</div>`;
  const waMsg = encodeURIComponent(`Hola, quiero reservar ${r.title} (${r.platform}). Confirmen disponibilidad y el monto de la señal, gracias.`);
  return `
    <article class="card reserva-card">
      <div class="card-image">
        ${img}
        <span class="badge-platform">${escapeHtml(r.platform)}</span>
        <span class="badge-reserva">Reserva</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(r.title)}</div>
        <div class="reserva-meta">
          <span>Lanzamiento</span>
          <strong>${escapeHtml(release)}</strong>
        </div>
        ${r.description ? `<p class="reserva-desc">${escapeHtml(r.description)}</p>` : ""}
        <div class="price-rows">
          ${r.priceCRC_principal != null ? `
            <div class="price-row">
              <span class="price-tag">Principal</span>
              <span class="price-value">${formatCRC(r.priceCRC_principal)}</span>
            </div>
          ` : ""}
          ${r.priceCRC_secundaria != null ? `
            <div class="price-row secundaria">
              <span class="price-tag">Secundaria</span>
              <span class="price-value">${formatCRC(r.priceCRC_secundaria)}</span>
            </div>
          ` : ""}
        </div>
        ${r.deposit ? `<div class="reserva-deposit">Señal desde <strong>${formatCRC(r.deposit)}</strong></div>` : ""}
        <a class="cta cta-wa reserva-cta" href="https://wa.me/${CONFIG.whatsapp}?text=${waMsg}" target="_blank" rel="noopener">
          Reservar por WhatsApp
        </a>
      </div>
    </article>
  `;
}

function bundleCardHTML(b, type = "nintendo") {
  const routes = { nintendo: "nintendo", ps: "ps-bundle", xbox: "xbox-bundle" };
  const badges = { nintendo: "Switch", ps: "PlayStation", xbox: "Xbox" };
  const cover = b.coverUrl
    ? `<img src="${escapeAttr(b.coverUrl)}" alt="${escapeAttr(b.id)}" loading="lazy">`
    : `<div class="placeholder">🎮</div>`;
  const firstGame = b.games && b.games[0] ? b.games[0].name : "";
  const hasDual = b.priceCRC_principal !== undefined || b.priceCRC_secundaria !== undefined;
  const priceRows = hasDual ? `
    ${b.priceCRC_principal != null ? `
      <div class="price-row">
        <span class="price-tag">Principal</span>
        <span class="price-value">${formatCRC(b.priceCRC_principal)}</span>
      </div>
    ` : ""}
    ${b.priceCRC_secundaria != null ? `
      <div class="price-row secundaria">
        <span class="price-tag">Secundaria</span>
        <span class="price-value">${formatCRC(b.priceCRC_secundaria)}</span>
      </div>
    ` : ""}
  ` : `
    <div class="price-row">
      <span class="price-tag">Precio</span>
      <span class="price-value">${formatCRC(b.priceCRC)}</span>
    </div>
  `;
  return `
    <a class="card bundle-card" href="#/${routes[type]}/${encodeURIComponent(b.id)}">
      <div class="card-image">
        ${cover}
        <span class="badge-platform">${badges[type]}</span>
      </div>
      <div class="card-body">
        <div class="card-title">Bundle ${escapeHtml(b.id)}</div>
        <div class="bundle-meta">
          <span>${b.games?.length || 0} juegos</span>
          ${b.totalSize ? `<span>&middot; ${escapeHtml(b.totalSize)}</span>` : ""}
        </div>
        ${firstGame ? `<div class="bundle-first">Incluye: ${escapeHtml(firstGame)}…</div>` : ""}
        <div class="price-rows">
          ${priceRows}
        </div>
      </div>
    </a>
  `;
}

function renderBundle(id, type = "nintendo") {
  if (!loaded) {
    app.innerHTML = `<section class="container empty-state"><p>Cargando bundle...</p></section>`;
    return;
  }
  const sources = {
    nintendo: { list: nintendo.bundles || [], platform: "Nintendo Switch", backHref: "#/plataforma/Switch", telegram: nintendo.telegramChannel },
    ps: { list: psBundles.bundles || [], platform: "PlayStation", backHref: "#/bundles/PS", telegram: psBundles.telegramChannel },
    xbox: { list: xboxBundles.bundles || [], platform: "Xbox", backHref: "#/bundles/Xbox", telegram: xboxBundles.telegramChannel },
  };
  const src = sources[type] || sources.nintendo;
  const b = src.list.find(x => String(x.id) === String(id));
  if (!b) {
    app.innerHTML = `
      <section class="container empty-state">
        <h2>Bundle no encontrado</h2>
        <p>Ese bundle ya no está disponible o fue retirado.</p>
        <a class="cta" href="${src.backHref}">Ver bundles</a>
      </section>
    `;
    return;
  }
  const cover = b.coverUrl
    ? `<img src="${escapeAttr(b.coverUrl)}" alt="${escapeAttr(b.id)}">`
    : `<div class="placeholder">🎮</div>`;

  // Bundles PS/Xbox tienen 2 precios (principal/secundaria), Nintendo tiene 1.
  const hasDual = b.priceCRC_principal !== undefined || b.priceCRC_secundaria !== undefined;
  const priceForMsg = hasDual
    ? (b.priceCRC_principal || b.priceCRC_secundaria)
    : b.priceCRC;
  const waMsg = encodeURIComponent(`Hola, me interesa el BUNDLE ${b.id} (${b.games?.length || 0} juegos por ${formatCRC(priceForMsg)}). ¿Sigue disponible?`);

  const priceBlock = hasDual ? `
    <div class="price-options">
      ${b.priceCRC_principal != null ? `
        <div class="price-card principal">
          <div class="price-label">Cuenta Principal</div>
          <div class="price-amount">${formatCRC(b.priceCRC_principal)}</div>
          <div class="price-note">Acceso completo, sin restricciones</div>
        </div>
      ` : ""}
      ${b.priceCRC_secundaria != null ? `
        <div class="price-card secundaria">
          <div class="price-label">Cuenta Secundaria</div>
          <div class="price-amount">${formatCRC(b.priceCRC_secundaria)}</div>
          <div class="price-note">Más económico, requiere estar conectado</div>
        </div>
      ` : ""}
    </div>
  ` : `
    <div class="bundle-price">
      <span class="price-label">Precio del bundle</span>
      <span class="price-amount">${formatCRC(b.priceCRC)}</span>
    </div>
  `;

  app.innerHTML = `
    <section class="container product-page">
      <a class="back-link" href="${src.backHref}">&larr; Volver a bundles</a>
      <div class="product-grid">
        <div class="product-image">${cover}</div>
        <div class="product-info">
          <span class="product-platform">${escapeHtml(src.platform)}</span>
          <h1>Bundle ${escapeHtml(b.id)}</h1>
          <p class="product-desc">Cuenta ${escapeHtml(src.platform)} con los siguientes juegos preinstalados. Total: ${b.games?.length || 0} juegos${b.totalSize ? ` &middot; ${escapeHtml(b.totalSize)}` : ""}.</p>

          ${priceBlock}

          <div class="bundle-cta-row">
            <a class="cta-wa" href="https://wa.me/${CONFIG.whatsapp}?text=${waMsg}" target="_blank" rel="noopener">
              Comprar por WhatsApp
            </a>
            ${src.telegram ? `
              <a class="cta-telegram" href="${escapeAttr(src.telegram)}" target="_blank" rel="noopener">
                Ver en Telegram
              </a>
            ` : ""}
          </div>

          <div class="bundle-games">
            <h3>Juegos incluidos</h3>
            <ul>
              ${(b.games || []).map(g => `
                <li>
                  <span class="g-name">${escapeHtml(g.name)}</span>
                  ${g.size ? `<span class="g-size">${escapeHtml(g.size)}</span>` : ""}
                </li>
              `).join("")}
            </ul>
          </div>
        </div>
      </div>
    </section>
  `;
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
// Páginas informativas (Cómo comprar, FAQ, T&C, etc.)
// ============================================================
function renderInfoPage(slug) {
  const pages = {
    "como-comprar": {
      title: "Cómo comprar e instalar",
      body: comoComprarHTML(),
    },
    "faq": {
      title: "Preguntas frecuentes",
      body: faqInlineHTML(),
    },
    "garantia": {
      title: "Garantía",
      body: garantiaHTML(),
    },
    "terminos": {
      title: "Términos y condiciones",
      body: terminosHTML(),
    },
    "privacidad": {
      title: "Política de privacidad",
      body: privacidadHTML(),
    },
    "nosotros": {
      title: "Sobre nosotros",
      body: nosotrosHTML(),
    },
  };
  const p = pages[slug];
  if (!p) {
    app.innerHTML = `<section class="container empty-state"><h2>Página no encontrada</h2><a class="cta" href="#/">Volver al inicio</a></section>`;
    return;
  }
  app.innerHTML = `
    ${heroSlimHTML(p.title)}
    ${p.body}
  `;
}

function comoComprarHTML() {
  return `
    <section class="container info-page">
      <div class="info-block">
        <h2>Comprar en 4 pasos</h2>
        <ol class="info-steps">
          <li>
            <strong>Elegí tus juegos del catálogo.</strong> Navegá por PS5, PS4, Xbox o Switch. Click en el juego para ver detalles. Decidí si lo querés en <em>Cuenta Principal</em> (acceso completo, sin restricciones) o <em>Cuenta Secundaria</em> (más barata, requiere conexión a internet).
          </li>
          <li>
            <strong>Agregá al carrito y enviá el pedido por WhatsApp.</strong> Click en "Agregar al carrito" en cada juego. Cuando termines, andá al carrito (icono arriba a la derecha) y click en "Enviar pedido por WhatsApp". Te abre el chat con la lista lista para mandar.
          </li>
          <li>
            <strong>Confirmamos disponibilidad y te pasamos los datos de pago.</strong> En menos de 10 minutos te respondemos por WhatsApp confirmando los juegos y el total final, junto con los datos para pagar por SINPE Móvil o transferencia bancaria.
          </li>
          <li>
            <strong>Pagás y recibís la cuenta inmediatamente.</strong> Apenas confirmamos tu pago, te enviamos por WhatsApp: el email de la cuenta, la contraseña, los códigos del verificador 2FA (si los tiene) y la guía de instalación específica para tu consola.
          </li>
        </ol>
      </div>

      <div class="info-block">
        <h2>Instalación en PlayStation 5 / PS4</h2>
        <h3>Si compraste Cuenta Principal</h3>
        <ol class="info-steps">
          <li>Andá a <strong>Configuración → Usuarios y cuentas → Otros</strong>.</li>
          <li>Click en <strong>"Compartir consola y juego sin conexión"</strong> y activala.</li>
          <li>Volvé al menú principal, agregá un usuario nuevo y poné los datos que te mandamos (email + contraseña).</li>
          <li>Una vez dentro, andá a la <strong>Biblioteca de juegos</strong>, descargá los que querés jugar.</li>
          <li>Listo. Podés volver a tu cuenta personal y jugar los juegos descargados desde ahí.</li>
        </ol>
        <h3>Si compraste Cuenta Secundaria</h3>
        <ol class="info-steps">
          <li>Agregá un usuario nuevo en la consola y entrá con el email + contraseña que te dimos.</li>
          <li>Descargá los juegos desde la Biblioteca.</li>
          <li>Para jugar, tenés que estar conectado a internet y entrar con esa cuenta secundaria.</li>
        </ol>
      </div>

      <div class="info-block">
        <h2>Instalación en Xbox</h2>
        <ol class="info-steps">
          <li>Andá a <strong>Configuración → Personalización → Mis aplicaciones y juegos → Compartir mi cuenta</strong> (Mi casa Xbox).</li>
          <li>Iniciá sesión con la cuenta que te enviamos.</li>
          <li>Marcá esta consola como "Mi casa Xbox" (esto activa el acceso para todos los usuarios).</li>
          <li>Descargá los juegos desde tu Biblioteca.</li>
          <li>Podés volver a usar tu cuenta personal — los juegos siguen funcionando para todos los perfiles.</li>
        </ol>
      </div>

      <div class="info-block">
        <h2>Instalación en Nintendo Switch (Bundles)</h2>
        <ol class="info-steps">
          <li>Andá a <strong>Configuración de la consola → Usuarios → Agregar usuario</strong>.</li>
          <li>Click en <strong>"Usuario con cuenta Nintendo existente"</strong> y poné los datos que te enviamos.</li>
          <li>Volvé a la pantalla principal con ese usuario activo.</li>
          <li>Entrá a la <strong>Nintendo eShop</strong> con ese usuario y andá a tu cuenta (esquina superior derecha) → <strong>Volver a descargar</strong>.</li>
          <li>Descargá todos los juegos del bundle (pueden ser muchos GB — usá una microSD si es necesario).</li>
        </ol>
        <p class="info-note">⚠️ <strong>Importante:</strong> los juegos del bundle se juegan SOLO con ese usuario de la Switch. Si entrás con otro perfil no los vas a ver. Mantené el usuario de la cuenta que te dimos siempre disponible.</p>
      </div>

      <div class="info-cta">
        <h3>¿Tenés dudas con la instalación?</h3>
        <p>Te ayudamos en vivo por WhatsApp, sin costo. Tenemos guías por consola y te asistimos paso a paso.</p>
        <a class="cta cta-wa" href="https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Hola, necesito ayuda con la instalación de mi cuenta.")}" target="_blank" rel="noopener">Escribinos al WhatsApp</a>
      </div>
    </section>
  `;
}

function garantiaHTML() {
  return `
    <section class="container info-page">
      <div class="info-block">
        <h2>Garantía Rey Midas Digitales</h2>
        <p>Cada cuenta que vendemos está respaldada por nosotros. Si tenés cualquier problema con el acceso, te lo solucionamos.</p>

        <h3>Cuenta Principal</h3>
        <ul class="info-list">
          <li><strong>Garantía de por vida</strong> mientras la consola permanezca activada con esa cuenta.</li>
          <li>Si necesitás cambiar de consola, te ayudamos a desactivar la vieja y activar la nueva sin costo.</li>
          <li>Si la cuenta presenta cualquier problema técnico, la reemplazamos por una nueva con los mismos juegos.</li>
        </ul>

        <h3>Cuenta Secundaria</h3>
        <ul class="info-list">
          <li><strong>Garantía de 6 meses</strong> desde la fecha de compra.</li>
          <li>Si la cuenta deja de funcionar dentro de la garantía, te la reemplazamos sin costo.</li>
          <li>Pasados los 6 meses, podés renovar el acceso con un costo simbólico de mantenimiento.</li>
        </ul>

        <h3>Bundles</h3>
        <ul class="info-list">
          <li>Garantía de <strong>6 meses</strong> sobre el acceso a la cuenta.</li>
          <li>Los juegos del bundle son permanentes — una vez descargados quedan en tu consola.</li>
        </ul>

        <h3>¿Qué NO cubre la garantía?</h3>
        <ul class="info-list">
          <li>Modificaciones que el cliente haga a la cuenta (cambio de email/contraseña sin avisar).</li>
          <li>Uso de la cuenta para revender o compartir con terceros.</li>
          <li>Baneos por hacer trampa, jugar online con jailbreak, o violar términos de uso del fabricante.</li>
        </ul>
      </div>

      <div class="info-cta">
        <h3>¿Problema con tu cuenta?</h3>
        <p>Escribinos por WhatsApp. Respondemos en minutos.</p>
        <a class="cta cta-wa" href="https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Hola, tengo un problema con mi cuenta.")}" target="_blank" rel="noopener">Reclamar garantía</a>
      </div>
    </section>
  `;
}

function terminosHTML() {
  return `
    <section class="container info-page">
      <div class="info-block">
        <p class="info-meta">Última actualización: enero 2026</p>

        <h2>1. Aceptación de los términos</h2>
        <p>Al usar el sitio reymidascr.com y/o realizar una compra, usted acepta los siguientes términos y condiciones. Si no está de acuerdo, le pedimos no usar el servicio.</p>

        <h2>2. Sobre el servicio</h2>
        <p>Rey Midas Digitales vende acceso a cuentas digitales de PlayStation, Xbox y Nintendo con juegos comprados legalmente en sus tiendas oficiales. Los juegos son originales y se entregan a través de credenciales de acceso.</p>

        <h2>3. Modalidades de compra</h2>
        <p><strong>Cuenta Principal:</strong> activa la consola del cliente como dispositivo principal, permitiendo jugar sin conexión a internet y compartir los juegos con otros usuarios de esa consola.</p>
        <p><strong>Cuenta Secundaria:</strong> permite jugar los juegos pero requiere conexión a internet y sesión activa con la cuenta provista.</p>
        <p><strong>Bundles:</strong> conjuntos de varios juegos en una sola cuenta a precio promocional.</p>

        <h2>4. Pagos y entrega</h2>
        <p>Aceptamos SINPE Móvil y transferencia bancaria. La entrega se realiza por WhatsApp en un máximo de 10 minutos en horario laboral (lunes a sábado, 8am a 8pm) una vez confirmado el pago.</p>

        <h2>5. Garantía</h2>
        <p>Cada compra cuenta con garantía según el detalle publicado en la sección Garantía. Reclamos fuera del período de garantía se evalúan caso por caso.</p>

        <h2>6. Devoluciones</h2>
        <p>Por la naturaleza digital del producto, no aceptamos devoluciones de dinero una vez entregada la cuenta. En caso de falla del servicio, reemplazamos la cuenta o aplicamos crédito para otra compra.</p>

        <h2>7. Uso permitido</h2>
        <p>Las cuentas son para uso personal del comprador. Está prohibida la reventa, distribución o uso compartido fuera del núcleo familiar inmediato.</p>

        <h2>8. Limitación de responsabilidad</h2>
        <p>No nos hacemos responsables por baneos generados por uso indebido por parte del cliente (modificaciones de consola, trampas, violación de términos de PlayStation/Xbox/Nintendo).</p>

        <h2>9. Modificaciones</h2>
        <p>Estos términos pueden actualizarse en cualquier momento. La versión vigente es la publicada en esta página.</p>

        <h2>10. Contacto</h2>
        <p>Cualquier consulta sobre estos términos: WhatsApp <a href="https://wa.me/${CONFIG.whatsapp}">+506 ${formatPhone(CONFIG.whatsapp).replace(/^\+506\s*/, "")}</a></p>
      </div>
    </section>
  `;
}

function privacidadHTML() {
  return `
    <section class="container info-page">
      <div class="info-block">
        <p class="info-meta">Última actualización: enero 2026</p>

        <h2>Datos que recolectamos</h2>
        <p>Para entregarte tus compras necesitamos un mínimo de datos:</p>
        <ul class="info-list">
          <li><strong>Email:</strong> para crear tu cuenta en nuestro sitio y enviarte el acceso.</li>
          <li><strong>Número de WhatsApp:</strong> para coordinar la entrega y el soporte.</li>
          <li><strong>Datos de pago:</strong> el SINPE o la transferencia que vos nos envías. Nosotros no guardamos información de tarjetas.</li>
        </ul>

        <h2>Para qué usamos tus datos</h2>
        <ul class="info-list">
          <li>Procesar y entregar tu compra.</li>
          <li>Darte soporte cuando lo necesites.</li>
          <li>Avisarte de promociones (solo si nos diste autorización).</li>
        </ul>

        <h2>Con quién los compartimos</h2>
        <p><strong>Con nadie.</strong> No vendemos, alquilamos ni compartimos tus datos personales con terceros. Punto.</p>

        <h2>Cómo los protegemos</h2>
        <p>Tu cuenta en el sitio está protegida por contraseña cifrada. Los datos de las cuentas que comprás se guardan en servidores con encriptación y solo se muestran a vos cuando iniciás sesión.</p>

        <h2>Tus derechos</h2>
        <p>Podés pedirnos en cualquier momento: ver tus datos, modificarlos, o eliminarlos completamente. Escribinos por WhatsApp.</p>

        <h2>Cookies</h2>
        <p>Usamos almacenamiento local (localStorage) para guardar tu sesión y tu carrito. No usamos cookies de seguimiento ni publicidad.</p>
      </div>
    </section>
  `;
}

function nosotrosHTML() {
  return `
    <section class="container info-page">
      <div class="info-block">
        <h2>Sobre Rey Midas Digitales</h2>
        <p>Somos una tienda costarricense especializada en juegos digitales para <strong>PlayStation 5, PlayStation 4, Xbox y Nintendo Switch</strong>. Llevamos años conectando gamers con los títulos que quieren al mejor precio posible.</p>

        <h2>Por qué elegirnos</h2>
        <ul class="info-list">
          <li><strong>100% costarricense.</strong> Atención local, pago en colones, entrega por WhatsApp.</li>
          <li><strong>Cuentas legítimas.</strong> Compradas en las tiendas oficiales — PS Store, Xbox Store, eShop.</li>
          <li><strong>Garantía real.</strong> Si algo falla, lo solucionamos. Sin excusas.</li>
          <li><strong>Soporte de verdad.</strong> Te ayudamos con la instalación, con la configuración de tu consola, con todo lo que necesites.</li>
        </ul>

        <h2>Nuestros números</h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-num">+500</div>
            <div class="stat-label">Clientes felices</div>
          </div>
          <div class="stat-card">
            <div class="stat-num">+1200</div>
            <div class="stat-label">Cuentas entregadas</div>
          </div>
          <div class="stat-card">
            <div class="stat-num">< 10 min</div>
            <div class="stat-label">Tiempo de entrega</div>
          </div>
          <div class="stat-card">
            <div class="stat-num">5 ★</div>
            <div class="stat-label">Calificación promedio</div>
          </div>
        </div>
      </div>

      <div class="info-cta">
        <h3>¿Listo para comprar?</h3>
        <a class="cta" href="#/plataforma/PS5">Ver catálogo</a>
      </div>
    </section>
  `;
}

// ============================================================
// Bloques reutilizables
// ============================================================
function heroHTML() {
  // Si hay banners cargados, mostramos el slider. Sino, hero estático.
  if (banners.length > 0) {
    return `
      <section class="hero-slider" id="heroSlider">
        ${banners.map((b, i) => `
          <div class="hero-slide ${i === 0 ? "active" : ""}" data-index="${i}">
            <img src="${escapeAttr(b.image)}" alt="${escapeAttr(b.title || "")}" loading="${i === 0 ? "eager" : "lazy"}" onerror="this.parentElement.classList.add('no-img')">
            <div class="hero-slide-overlay">
              <div class="container">
                ${b.title ? `<h1 class="hero-title">${escapeHtml(b.title)}</h1>` : ""}
                ${b.subtitle ? `<p class="hero-subtitle">${escapeHtml(b.subtitle)}</p>` : ""}
                ${b.ctaText && b.ctaHref ? `<a class="cta" href="${escapeAttr(b.ctaHref)}">${escapeHtml(b.ctaText)}</a>` : ""}
              </div>
            </div>
          </div>
        `).join("")}
        ${banners.length > 1 ? `
          <button class="hero-arrow prev" aria-label="Anterior">‹</button>
          <button class="hero-arrow next" aria-label="Siguiente">›</button>
          <div class="hero-dots">
            ${banners.map((_, i) => `<button class="hero-dot ${i === 0 ? "active" : ""}" data-go="${i}" aria-label="Slide ${i + 1}"></button>`).join("")}
          </div>
        ` : ""}
      </section>
    `;
  }
  return `
    <section class="hero">
      <div class="hero-glow"></div>
      <div class="container hero-inner">
        <img src="/assets/logo.png" alt="Rey Midas Digitales" class="logo">
        <p class="tagline">Tu tienda de juegos digitales en Costa Rica</p>
        <a class="cta" href="#/plataforma/PS5">Ver juegos PS5</a>
      </div>
    </section>
  `;
}

function mountHeroSlider() {
  const slider = document.getElementById("heroSlider");
  if (!slider || banners.length <= 1) return;
  const slides = slider.querySelectorAll(".hero-slide");
  const dots = slider.querySelectorAll(".hero-dot");
  let current = 0;
  let timer;

  function go(i) {
    current = (i + slides.length) % slides.length;
    slides.forEach((s, j) => s.classList.toggle("active", j === current));
    dots.forEach((d, j) => d.classList.toggle("active", j === current));
  }
  function autoplay() {
    clearInterval(timer);
    timer = setInterval(() => go(current + 1), 6000);
  }
  slider.querySelector(".prev")?.addEventListener("click", () => { go(current - 1); autoplay(); });
  slider.querySelector(".next")?.addEventListener("click", () => { go(current + 1); autoplay(); });
  dots.forEach(d => d.addEventListener("click", () => { go(parseInt(d.dataset.go, 10)); autoplay(); }));
  autoplay();
}

function trustBarHTML() {
  return `
    <section class="trust-bar">
      <div class="container trust-bar-inner">
        <div class="trust-item">
          <span class="trust-icon">⚡</span>
          <div><strong>Entrega inmediata</strong><span>en menos de 10 min</span></div>
        </div>
        <div class="trust-item">
          <span class="trust-icon">🛡️</span>
          <div><strong>Garantía real</strong><span>respaldamos cada cuenta</span></div>
        </div>
        <div class="trust-item">
          <span class="trust-icon">💳</span>
          <div><strong>Pago fácil</strong><span>SINPE · Transferencia</span></div>
        </div>
        <div class="trust-item">
          <span class="trust-icon">💬</span>
          <div><strong>Soporte 24/7</strong><span>por WhatsApp</span></div>
        </div>
      </div>
    </section>
  `;
}

function testimonialsHTML() {
  if (!testimonials.length) return "";
  return `
    <section class="testimonials-section">
      <div class="container">
        <div class="section-title centered">
          <h2>Lo que dicen nuestros clientes</h2>
          <p>Más de 500 clientes en Costa Rica nos confían sus compras de juegos digitales.</p>
        </div>
        <div class="testimonials-grid">
          ${testimonials.map(t => `
            <article class="testimonial-card">
              <div class="testimonial-stars">${"★".repeat(t.rating || 5)}${"☆".repeat(5 - (t.rating || 5))}</div>
              <p class="testimonial-text">"${escapeHtml(t.text)}"</p>
              <div class="testimonial-author">
                <strong>${escapeHtml(t.name)}</strong>
                <span>${escapeHtml(t.platform)}</span>
              </div>
            </article>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function faqInlineHTML(limit) {
  if (!faqs.length) return "";
  const items = limit ? faqs.slice(0, limit) : faqs;
  return `
    <section class="faq-section">
      <div class="container">
        <div class="section-title centered">
          <h2>Preguntas frecuentes</h2>
          <p>Lo que más nos preguntan antes de comprar.</p>
        </div>
        <div class="faq-list">
          ${items.map((f, i) => `
            <details class="faq-item" ${i === 0 ? "open" : ""}>
              <summary>${escapeHtml(f.q)}</summary>
              <div class="faq-answer">${escapeHtml(f.a)}</div>
            </details>
          `).join("")}
        </div>
        ${limit && faqs.length > limit ? `
          <div class="faq-more">
            <a class="cta-secondary" href="#/faq">Ver todas las preguntas</a>
          </div>
        ` : ""}
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
      <div class="container">
        <div class="section-title centered">
          <h2>¿Cómo comprar?</h2>
          <p>En 4 pasos simples ya estás jugando tu juego favorito.</p>
        </div>
        <div class="steps-grid">
          <div class="step-card">
            <div class="step-num">1</div>
            <h3>Elegí tus juegos</h3>
            <p>Buscá en el catálogo PS5, PS4, Xbox o Switch. Agregá al carrito en Principal o Secundaria.</p>
          </div>
          <div class="step-card">
            <div class="step-num">2</div>
            <h3>Enviá tu pedido</h3>
            <p>Click en "Enviar pedido por WhatsApp" y nos llega tu lista completa con un click.</p>
          </div>
          <div class="step-card">
            <div class="step-num">3</div>
            <h3>Pagás SINPE o transferencia</h3>
            <p>Te confirmamos disponibilidad y te pasamos los datos. Pago seguro 100% costarricense.</p>
          </div>
          <div class="step-card">
            <div class="step-num">4</div>
            <h3>Recibís tu cuenta</h3>
            <p>En menos de 10 minutos recibís el correo, contraseña y guía de instalación por WhatsApp.</p>
          </div>
        </div>
        <div class="cta-row">
          <a class="cta" href="#/como-comprar">Ver guía completa de compra e instalación &rarr;</a>
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
  const principal = g._manualPrices ? g.priceCRC_principal : principalCRC(g.priceUSD);
  const secundaria = g._manualPrices ? g.priceCRC_secundaria : secundariaCRC(g.priceUSD);
  const img = g.imageUrl
    ? `<img src="${escapeAttr(g.imageUrl)}" alt="${escapeAttr(g.title)}" loading="lazy">`
    : `<div class="placeholder">🎮</div>`;
  return `
    <a class="card" href="#/producto/${encodeURIComponent(g.id)}">
      <div class="card-image">
        ${img}
        ${g.onSale && g.discount ? `<span class="badge-sale">-${g.discount}%</span>` : ""}
        <span class="badge-platform">${escapeHtml(g.platform)}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(g.title)}</div>
        <div class="price-rows">
          ${principal != null ? `
            <div class="price-row">
              <span class="price-tag">Principal</span>
              <span class="price-value">${formatCRC(principal)}</span>
            </div>
          ` : ""}
          ${secundaria != null ? `
            <div class="price-row secundaria">
              <span class="price-tag">Secundaria</span>
              <span class="price-value">${formatCRC(secundaria)}</span>
            </div>
          ` : ""}
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
// Login / Mi cuenta / Admin
// ============================================================
function renderLogin() {
  if (currentUser) { location.hash = "#/mi-cuenta"; return; }

  // Si NO existe ningún usuario todavía, mostramos el form de "Crear primer admin".
  if (!usersExist) {
    app.innerHTML = `
      <section class="container auth-page">
        <div class="auth-card">
          <h1>Crear primer admin</h1>
          <p>Como sos el primero en entrar, esta cuenta va a ser administradora del sistema.</p>
          <form id="bootstrapForm" class="login-form">
            <label>Email
              <input id="bsEmail" type="email" required placeholder="vos@ejemplo.com" autocomplete="email">
            </label>
            <label>Nombre (opcional)
              <input id="bsName" type="text" placeholder="Tu nombre">
            </label>
            <label>Contraseña (mínimo 6 caracteres)
              <input id="bsPassword" type="password" required minlength="6" autocomplete="new-password">
            </label>
            <button type="submit" class="login-submit-btn">Crear cuenta admin</button>
          </form>
        </div>
      </section>
    `;
    document.getElementById("bootstrapForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("bsEmail").value.trim();
      const name = document.getElementById("bsName").value.trim();
      const password = document.getElementById("bsPassword").value;
      const btn = e.target.querySelector("button[type='submit']");
      btn.disabled = true;
      btn.textContent = "Creando...";
      const error = await bootstrapAdmin(email, password, name);
      if (error) {
        btn.disabled = false;
        btn.textContent = "Crear cuenta admin";
        showToast(error.message || "Error creando la cuenta.");
        return;
      }
      showToast("Cuenta creada ✓");
      location.hash = "#/admin";
    });
    return;
  }

  app.innerHTML = `
    <section class="container auth-page">
      <div class="auth-card">
        <h1>Iniciá sesión</h1>
        <p>Ingresá el email y la contraseña que te dimos por WhatsApp.</p>
        <form id="loginForm" class="login-form">
          <label>Email
            <input id="loginEmail" type="email" required placeholder="vos@ejemplo.com" autocomplete="email">
          </label>
          <label>Contraseña
            <input id="loginPassword" type="password" required placeholder="Tu contraseña" autocomplete="current-password">
          </label>
          <button type="submit" class="login-submit-btn">Entrar</button>
        </form>
        <p class="auth-note">¿No tenés cuenta? Escribinos por WhatsApp y te creamos una al instante.</p>
        <a class="cta-secondary" href="https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Hola, necesito que me creen una cuenta para ver mis compras.")}" target="_blank" rel="noopener" style="display:block;text-align:center;margin-top:0.6rem;">Pedir cuenta por WhatsApp</a>
      </div>
    </section>
  `;

  const form = document.getElementById("loginForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const btn = form.querySelector("button[type='submit']");
    btn.disabled = true;
    btn.textContent = "Entrando...";
    const error = await loginWithPassword(email, password);
    if (error) {
      btn.disabled = false;
      btn.textContent = "Entrar";
      showToast(error.message || "No pudimos entrar. Intentá de nuevo.");
      return;
    }
    location.hash = currentUser.is_admin ? "#/admin" : "#/mi-cuenta";
  });
}

async function renderMyAccount() {
  if (!currentUser) { location.hash = "#/login"; return; }
  app.innerHTML = `
    <section class="container account-page">
      <div class="account-header">
        <h1>Mi cuenta</h1>
        <p>${escapeHtml(currentUser.full_name || currentUser.email)}</p>
        <button class="cta-secondary small" id="changePwdBtn">Cambiar contraseña</button>
      </div>
      <div id="pwdBox" hidden class="pwd-change">
        <h3>Cambiar contraseña</h3>
        <label>Nueva contraseña
          <input id="newPwd" type="password" minlength="6" required>
        </label>
        <div class="pwd-actions">
          <button id="savePwdBtn" class="login-submit-btn">Guardar</button>
          <button id="cancelPwdBtn" class="cta-secondary">Cancelar</button>
        </div>
      </div>
      <div id="purchasesList">Cargando compras...</div>
    </section>
  `;
  document.getElementById("changePwdBtn").addEventListener("click", () => {
    const box = document.getElementById("pwdBox");
    box.hidden = !box.hidden;
    if (!box.hidden) document.getElementById("newPwd").focus();
  });
  document.getElementById("cancelPwdBtn").addEventListener("click", () => {
    document.getElementById("pwdBox").hidden = true;
  });
  document.getElementById("savePwdBtn").addEventListener("click", async () => {
    const newPwd = document.getElementById("newPwd").value;
    if (!newPwd || newPwd.length < 6) {
      showToast("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    const error = await changePassword(newPwd);
    if (error) { showToast(error.message); return; }
    showToast("Contraseña actualizada ✓");
    document.getElementById("pwdBox").hidden = true;
    document.getElementById("newPwd").value = "";
  });

  const list = document.getElementById("purchasesList");
  try {
    const { purchases } = await apiPost("/api/purchases", { action: "mine" });
    if (!purchases?.length) {
      list.innerHTML = `
        <div class="empty-purchases">
          <p>Todavía no tenés compras cargadas.</p>
          <p>Cuando hagamos una venta, vas a ver acá los datos de la cuenta, la contraseña y los códigos del verificador.</p>
        </div>
      `;
      return;
    }
    list.innerHTML = purchases.map(purchaseCardHTML).join("");
  } catch (err) {
    list.innerHTML = `<div class="status error">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function purchaseCardHTML(p) {
  const date = new Date(p.purchase_date + "T00:00:00").toLocaleDateString("es-CR", {
    year: "numeric", month: "long", day: "numeric",
  });
  const modLabel = p.modality ? `<span class="cart-modality ${escapeAttr(p.modality)}">${escapeHtml(p.modality)}</span>` : "";
  return `
    <article class="purchase-card">
      <header class="purchase-head">
        <div>
          <span class="cart-platform">${escapeHtml(p.platform)}</span>
          ${modLabel}
        </div>
        <time>${escapeHtml(date)}</time>
      </header>
      <dl class="purchase-fields">
        <div><dt>Email de la cuenta</dt><dd class="copy-able" data-copy="${escapeAttr(p.account_email)}">${escapeHtml(p.account_email)}</dd></div>
        <div><dt>Contraseña</dt><dd class="copy-able" data-copy="${escapeAttr(p.account_password)}">${escapeHtml(p.account_password)}</dd></div>
        ${p.verifier_codes ? `<div><dt>Códigos del verificador</dt><dd class="copy-able pre" data-copy="${escapeAttr(p.verifier_codes)}">${escapeHtml(p.verifier_codes)}</dd></div>` : ""}
        ${p.games ? `<div class="full"><dt>Juegos en la cuenta</dt><dd class="pre">${escapeHtml(p.games)}</dd></div>` : ""}
        ${p.notes ? `<div class="full"><dt>Notas</dt><dd>${escapeHtml(p.notes)}</dd></div>` : ""}
      </dl>
      <p class="purchase-hint">Tip: tocá un campo para copiarlo.</p>
    </article>
  `;
}

document.addEventListener("click", (e) => {
  const el = e.target.closest(".copy-able");
  if (!el) return;
  const text = el.dataset.copy;
  navigator.clipboard?.writeText(text).then(() => showToast("Copiado al portapapeles"));
});

async function renderAdmin() {
  if (!currentUser) { location.hash = "#/login"; return; }
  if (!currentUser.is_admin) {
    app.innerHTML = `
      <section class="container empty-state">
        <h2>Sin permisos</h2>
        <p>Tu cuenta no tiene acceso al panel de administración.</p>
        <a class="cta" href="#/">Volver al inicio</a>
      </section>
    `;
    return;
  }
  app.innerHTML = `
    <section class="container admin-page">
      <h1>Panel Admin</h1>

      <form id="createClientForm" class="admin-form create-client">
        <h2>Crear cliente nuevo</h2>
        <div class="row">
          <label>Email del cliente
            <input name="email" type="email" required placeholder="cliente@ejemplo.com">
          </label>
          <label>Nombre completo (opcional)
            <input name="full_name" type="text" placeholder="Juan Pérez">
          </label>
          <label>Contraseña inicial
            <input name="password" type="text" required value="Midas2026" minlength="6">
          </label>
        </div>
        <button type="submit">Crear cuenta</button>
        <p id="createClientStatus" class="form-status"></p>
      </form>

      <div class="admin-grid">
        <form id="purchaseForm" class="admin-form">
          <h2>Cargar nueva compra</h2>
          <label>Email del cliente
            <input name="client_email" type="email" required placeholder="cliente@email.com">
          </label>
          <div class="row">
            <label>Fecha de compra
              <input name="purchase_date" type="date" required value="${new Date().toISOString().slice(0,10)}">
            </label>
            <label>Plataforma
              <select name="platform" required>
                <option value="PS5">PS5</option>
                <option value="PS4">PS4</option>
                <option value="PS3">PS3</option>
                <option value="Xbox">Xbox</option>
                <option value="Switch">Switch</option>
              </select>
            </label>
            <label>Modalidad
              <select name="modality">
                <option value="">—</option>
                <option value="principal">Principal</option>
                <option value="secundaria">Secundaria</option>
                <option value="bundle">Bundle</option>
                <option value="individual">Individual</option>
              </select>
            </label>
          </div>
          <label>Email de la cuenta vendida
            <input name="account_email" type="text" required>
          </label>
          <label>Contraseña de la cuenta
            <input name="account_password" type="text" required>
          </label>
          <label>Códigos del verificador (2FA)
            <textarea name="verifier_codes" rows="3" placeholder="Uno por línea"></textarea>
          </label>
          <label>Juegos en la cuenta
            <textarea name="games" rows="4" placeholder="Uno por línea"></textarea>
          </label>
          <label>Notas (opcional)
            <textarea name="notes" rows="2"></textarea>
          </label>
          <button type="submit">Guardar compra</button>
          <p id="purchaseFormStatus" class="form-status"></p>
        </form>

        <div class="admin-list">
          <h2>Últimas compras cargadas</h2>
          <div id="adminPurchases">Cargando...</div>
        </div>
      </div>
    </section>
  `;
  document.getElementById("purchaseForm").addEventListener("submit", handleAdminSubmit);
  document.getElementById("createClientForm").addEventListener("submit", handleCreateClient);
  loadAdminPurchases();
}

async function handleCreateClient(e) {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("createClientStatus");
  const fd = new FormData(form);
  const email = String(fd.get("email")).trim().toLowerCase();
  const password = String(fd.get("password"));
  const fullName = String(fd.get("full_name") || "").trim();

  if (password.length < 6) {
    status.textContent = "La contraseña debe tener al menos 6 caracteres.";
    status.className = "form-status error";
    return;
  }

  status.textContent = "Creando cuenta...";
  status.className = "form-status";
  try {
    await apiPost("/api/clients", { action: "create", email, password, full_name: fullName });
    status.innerHTML = `
      ✓ Cuenta creada para <strong>${escapeHtml(email)}</strong>.<br>
      Mandale por WhatsApp:<br>
      <code class="copy-able" data-copy="Tu acceso a reymidascr.com — Email: ${email} — Contraseña: ${password}">
        Tu acceso a reymidascr.com — Email: ${email} — Contraseña: ${password}
      </code>
    `;
    status.className = "form-status ok";
    form.querySelector('input[name="email"]').value = "";
    form.querySelector('input[name="full_name"]').value = "";
    form.querySelector('input[name="password"]').value = "Midas2026";
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = "form-status error";
  }
}

async function loadAdminPurchases() {
  const box = document.getElementById("adminPurchases");
  if (!box) return;
  try {
    const { purchases } = await apiPost("/api/purchases", { action: "list-all" });
    if (!purchases?.length) {
      box.innerHTML = `<p class="empty-state-small">Todavía no hay compras cargadas.</p>`;
      return;
    }
    box.innerHTML = purchases.map(p => `
      <div class="admin-purchase">
        <header>
          <strong>${escapeHtml(p.app_users?.email || "?")}</strong>
          <span>${escapeHtml(p.platform)}${p.modality ? " · " + escapeHtml(p.modality) : ""}</span>
          <time>${escapeHtml(p.purchase_date)}</time>
          <button data-del="${escapeAttr(p.id)}" class="admin-del" aria-label="Eliminar">×</button>
        </header>
        <p class="admin-account">${escapeHtml(p.account_email)} / ${escapeHtml(p.account_password)}</p>
      </div>
    `).join("");
    box.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta compra?")) return;
        try {
          await apiPost("/api/purchases", { action: "delete", id: btn.dataset.del });
          loadAdminPurchases();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="status error">${escapeHtml(err.message)}</div>`;
  }
}

async function handleAdminSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const status = document.getElementById("purchaseFormStatus");
  const fd = new FormData(form);

  status.textContent = "Guardando...";
  status.className = "form-status";

  try {
    await apiPost("/api/purchases", {
      action: "create",
      client_email: String(fd.get("client_email")).trim().toLowerCase(),
      purchase_date: fd.get("purchase_date"),
      platform: fd.get("platform"),
      modality: fd.get("modality") || null,
      account_email: fd.get("account_email"),
      account_password: fd.get("account_password"),
      verifier_codes: fd.get("verifier_codes") || null,
      games: fd.get("games") || null,
      notes: fd.get("notes") || null,
    });
    status.textContent = "✓ Compra cargada";
    status.className = "form-status ok";
    form.reset();
    form.querySelector('input[name="purchase_date"]').value = new Date().toISOString().slice(0,10);
    loadAdminPurchases();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = "form-status error";
  }
}

// ============================================================
// Boot
// ============================================================
render();
load();
initAuth();

// ============================================================
// Migración de caché: cuando sale una actualización del sitio, borramos los
// datos de juegos guardados en el navegador (portadas, fichas, capturas,
// tráilers) para que TODOS vean lo nuevo sin tener que usar incógnito ni
// limpiar nada a mano. Subí APP_CACHE_VERSION para forzar el refresco.
// ============================================================
const APP_CACHE_VERSION = "2026-06-05c";
(function migrateLocalCaches() {
  try {
    if (localStorage.getItem("app-cache-version") === APP_CACHE_VERSION) return;
    const stalePrefixes = [
      "psn-cover:", "psn-ficha:", "vandal-ficha:", "xbox-ficha:", "rawg-media:",
      "ms-ficha:", "yt-trailer:", "rawg-cover:", "rawg-meta:", "rawg-indie:", "rawg:",
      "igdb-cover:", "igdb:", "steam-cover:", "cover:",
    ];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && stalePrefixes.some(p => k.startsWith(p))) localStorage.removeItem(k);
    }
    localStorage.setItem("app-cache-version", APP_CACHE_VERSION);
  } catch { /* localStorage no disponible: no pasa nada */ }
})();

// ============================================================
// CONFIGURACION — editá estos valores
// ============================================================
const CONFIG = {
  whatsapp: "50661468733",

  // Precios finales via tabla de referencia con interpolación lineal.
  // PS y Xbox comparten la misma tabla (Xbox se compra via PS Turkey region).
  // Columns: [usd, principal, secundaria]
  pricing: {
    exchangeRate: 530,
    principalMarkup: 0.75,    // fallback para Switch/otras plataformas
    secundariaMarkup: 0.35,   // fallback para Switch/otras plataformas
    table: [
      [10, 4000,  2500],
      [20, 6000,  3000],
      [30, 11000, 5500],
      [40, 17000, 7000],
      [50, 21000, 9000],
      [60, 26000, 13000],
      [70, 28500, 15000],
      [80, 36000, 14000],
    ],
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
let featuredGames = []; // catálogo curado de "más buscados" (featured-games.json)
let coversIndex = {};   // covers.json: { id de featured → URL de carátula } cosechada offline (cero cupo de API)
let hiddenGames = { ids: new Set(), titles: new Set() }; // exclusión manual (hidden-games.json)
let banners = [];
let testimonials = [];
let reviewStats = { totalClients: "500+", yearsInBusiness: "5", averageRating: 4.9, totalReviews: 247 };
let faqs = [];
let psPlusPlans = [];
let gamePassPlans = [];
let reservaciones = [];

// ============================================================
// Auth propio — usa los endpoints en /api/auth y /api/*. La sesión vive en
// una cookie HttpOnly que pone el servidor: el JS no la puede leer, así que
// un XSS no puede robarla. Acá solo guardamos una "pista" booleana (no el
// token) para saber si vale la pena preguntar por la sesión al cargar.
// ============================================================
const SESSION_HINT_KEY = "rmd_has_session";
let currentUser = null;
let usersExist = true; // se actualiza en initAuth(); controla el botón "Crear primer admin"

function hasSessionHint() { return localStorage.getItem(SESSION_HINT_KEY) === "1"; }
function setSessionHint() { localStorage.setItem(SESSION_HINT_KEY, "1"); }
function clearSessionHint() { localStorage.removeItem(SESSION_HINT_KEY); }

// Wrapper para todos los fetches a la API. La cookie de sesión viaja sola en
// las peticiones del mismo origen; solo parseamos errores.
async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin", // asegura que la cookie de sesión se envíe
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
  // Limpieza del esquema viejo (token en localStorage) por si quedó de antes.
  localStorage.removeItem("rmd_token_v1");
  if (hasSessionHint()) {
    try {
      const { user } = await apiPost("/api/auth", { action: "me" });
      currentUser = user;
    } catch (err) {
      // Cookie inválida / expirada: olvidamos la pista
      if (err.status === 401) clearSessionHint();
      currentUser = null;
    }
  }
  // Detectar si ya hay algún usuario en la base (para mostrar bootstrap o login).
  if (!currentUser) {
    try {
      const test = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "has-users" }),
      });
      const data = await test.json().catch(() => ({}));
      usersExist = data.usersExist === true;
    } catch { usersExist = true; }
  }
  renderAuthSlot();
  const r = parseRoute();
  if (["mi-cuenta", "admin", "login"].includes(r.name)) render();
}

async function loginWithPassword(email, password) {
  try {
    const { user } = await apiPost("/api/auth", { action: "login", email, password });
    setSessionHint();
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
    const { user } = await apiPost("/api/auth", {
      action: "bootstrap", email, password, full_name: fullName || null,
    });
    setSessionHint();
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
  clearSessionHint();
  currentUser = null;
  // Le pedimos al servidor que borre la cookie HttpOnly (no podemos hacerlo
  // desde JS). No bloqueamos la navegación esperando la respuesta.
  apiPost("/api/auth", { action: "logout" }).catch(() => {});
  renderAuthSlot();
  navigate("/");
}

function renderAuthSlot() {
  const slot = document.getElementById("authSlot");
  if (!slot) return;
  if (!currentUser) {
    slot.innerHTML = `<a href="/login" data-route="login" class="auth-btn">Iniciar sesión</a>`;
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
        <a href="/mi-cuenta">Mi cuenta</a>
        ${currentUser.is_admin ? `<a href="/admin">Admin</a>` : ""}
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
  // Cerrar al hacer click en un link real (no en triggers de dropdown)
  topnav.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (link && !e.target.closest(".dropdown-trigger")) {
      topnav.classList.remove("open");
    }
  });
}

// Carrito (link del header) — fuerza navegación incluso si el interceptor
// global ya procesó el click.
const headerCartLink = document.querySelector(".topbar-actions .cart-link");
if (headerCartLink) {
  headerCartLink.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("/carrito");
  });
}

// Dropdowns del topnav
document.querySelectorAll(".dropdown-trigger").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const dd = btn.closest(".dropdown");
    // Cerrar los otros dropdowns abiertos
    document.querySelectorAll(".dropdown.open").forEach(d => {
      if (d !== dd) d.classList.remove("open");
    });
    dd.classList.toggle("open");
  });
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".dropdown")) {
    document.querySelectorAll(".dropdown.open").forEach(d => d.classList.remove("open"));
  }
});

// Búsqueda del topnav
const topSearch = document.getElementById("topSearch");
if (topSearch) {
  topSearch.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = topSearch.querySelector("input").value.trim();
    if (q) {
      navigate(`/buscar/${encodeURIComponent(q)}`);
      topnav?.classList.remove("open");
    }
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
    price = modality === "principal" ? principalCRC(game.priceUSD, game.platform) : secundariaCRC(game.priceUSD, game.platform);
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
  updateCartBadge(true); // con bump
  return true;
}
function removeFromCart(id, modality) {
  const items = loadCart().filter(i => !(i.id === id && i.modality === modality));
  saveCart(items);
}
function clearCart() { saveCart([]); }

function updateCartBadge(bump = false) {
  const badge = document.getElementById("cartBadge");
  if (!badge) return;
  const items = loadCart();
  const count = items.length;
  badge.textContent = count;
  badge.classList.toggle("show", count > 0);
  if (bump) {
    const cartLink = badge.closest(".cart-link");
    if (cartLink) {
      cartLink.classList.remove("bump");
      void cartLink.offsetWidth;
      cartLink.classList.add("bump");
      setTimeout(() => cartLink.classList.remove("bump"), 700);
    }
  }
  updateMiniCart(items, bump);
}

function updateMiniCart(items, bump = false) {
  const mini = document.getElementById("miniCart");
  if (!mini) return;
  const route = parseRoute();
  const hideOnRoutes = ["cart"];
  const shouldShow = items.length > 0 && !hideOnRoutes.includes(route.name);
  if (!shouldShow) {
    mini.hidden = true;
    return;
  }
  const total = items.reduce((s, i) => s + i.priceCRC, 0);
  const countEl = document.getElementById("miniCartCount");
  const totalEl = document.getElementById("miniCartTotal");
  if (countEl) countEl.textContent = `${items.length} ${items.length === 1 ? "juego" : "juegos"}`;
  if (totalEl) totalEl.textContent = formatCRC(total);
  mini.hidden = false;
  if (bump) {
    mini.classList.remove("bump");
    void mini.offsetWidth;
    mini.classList.add("bump");
    setTimeout(() => mini.classList.remove("bump"), 600);
  }
}

// ============================================================
// Routing — History API (URLs reales, indexables por Google)
// ============================================================

// Navega a una ruta sin recargar la página.
function navigate(path) {
  if (location.pathname !== path) history.pushState(null, "", path);
  render();
  window.scrollTo(0, 0);
}

// Intercepta clicks en links internos para evitar recarga completa de página.
document.addEventListener("click", e => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  let url;
  try { url = new URL(a.href, location.href); } catch { return; }
  if (url.origin !== location.origin) return;       // link externo
  if (a.download || a.target === "_blank") return;  // descarga / nueva pestaña
  if (url.pathname === location.pathname && url.hash) return; // ancla in-page
  e.preventDefault();
  navigate(url.pathname);
});

function parseRoute() {
  const h = location.pathname || "/";
  if (h === "/" || h === "") return { name: "home", page: 1 };

  // Tokens de Supabase Auth llegan en el hash real de la URL — limpiarlos.
  if (location.hash.includes("error=") || location.hash.includes("access_token=")) {
    setTimeout(() => navigate("/"), 0);
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
  if (partes[0] === "reserva" && partes[1]) {
    return { name: "reserva", id: decodeURIComponent(partes[1]) };
  }
  if (partes[0] === "buscar" && partes[1]) {
    const page = (partes[2] === "p" && partes[3]) ? parseInt(partes[3], 10) || 1 : 1;
    return { name: "buscar", term: decodeURIComponent(partes[1]), page };
  }
  if (partes[0] === "categoria" && partes[1]) {
    const page = (partes[2] === "p" && partes[3]) ? parseInt(partes[3], 10) || 1 : 1;
    return { name: "categoria", genre: decodeURIComponent(partes[1]), page };
  }
  if (partes[0] === "resenas" || partes[0] === "reviews") return { name: "resenas" };
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

window.addEventListener("popstate", () => { render(); window.scrollTo(0, 0); });

// ============================================================
// Carga inicial desde /api/scrape
// ============================================================
async function load() {
  try {
    const [psn, xbox, psB, xboxB, offers, bann, test, fq, psp, gp, resv, feat, featPrices, hidden, covers] = await Promise.allSettled([
      fetch("/api/scrape").then(r => r.json()),
      fetch("/xbox-catalog.json").then(r => r.json()),
      fetch("/ps-bundles.json").then(r => r.json()),
      fetch("/xbox-bundles.json").then(r => r.json()),
      fetch("/offers.json").then(r => r.json()),
      fetch("/banners.json").then(r => r.json()),
      fetch("/testimonials.json").then(r => r.json()),
      fetch("/faq.json").then(r => r.json()),
      fetch("/playstation-plus.json").then(r => r.json()),
      fetch("/game-pass.json").then(r => r.json()),
      fetch("/reservaciones.json").then(r => r.json()),
      fetch("/featured-games.json").then(r => r.json()),
      fetch("/api/featured-prices").then(r => r.json()).catch(() => ({})),
      fetch("/hidden-games.json").then(r => r.json()).catch(() => ({})),
      fetch("/covers.json").then(r => r.json()).catch(() => ({})),
    ]);
    // Carátulas cosechadas offline (covers.json): { id de featured → URL del CDN }.
    // Es la fuente PRINCIPAL de portadas del catálogo curado: se resuelve sin tocar
    // ninguna API (cero cupo de RAWG/IGDB). Si un juego no está aquí, cae a los
    // fallbacks en vivo (PSN/IGDB/RAWG) como antes.
    coversIndex = (covers.status === "fulfilled" && covers.value && covers.value.covers) || {};
    // Lista manual de exclusión: títulos/IDs que el negocio decide esconder
    // a mano, pase lo que pase con la heurística. Se arma un set por ID de PSN
    // y otro por título normalizado (matchKey) para matchear sin tildes/espacios.
    if (hidden.status === "fulfilled" && hidden.value && Array.isArray(hidden.value.hidden)) {
      for (const entry of hidden.value.hidden) {
        if (entry == null) continue;
        const val = String(entry).trim();
        if (!val) continue;
        // Un ID de PSN se ve tipo "EP9000-CUSA00000_00-...": empieza con 2 letras + dígitos.
        if (/^(EP|UP|HP|JP)\d/i.test(val)) hiddenGames.ids.add(val);
        else hiddenGames.titles.add(matchKey(val));
      }
    }
    if (bann.status === "fulfilled" && Array.isArray(bann.value?.banners)) banners = bann.value.banners;
    if (test.status === "fulfilled" && Array.isArray(test.value?.testimonials)) testimonials = test.value.testimonials;
    if (test.status === "fulfilled" && test.value?.stats) reviewStats = { ...reviewStats, ...test.value.stats };
    if (fq.status === "fulfilled" && Array.isArray(fq.value?.faqs)) faqs = fq.value.faqs;
    if (psp.status === "fulfilled" && Array.isArray(psp.value?.plans)) psPlusPlans = psp.value.plans;
    if (gp.status === "fulfilled" && Array.isArray(gp.value?.plans)) gamePassPlans = gp.value.plans;
    if (resv.status === "fulfilled" && Array.isArray(resv.value?.items)) reservaciones = resv.value.items;
    const games = [];
    if (psn.status === "fulfilled" && psn.value.success) {
      games.push(...(psn.value.games || []));
    }
    if (xbox.status === "fulfilled" && xbox.value && Array.isArray(xbox.value.games) && xbox.value.games.length > 0) {
      games.push(...xbox.value.games.filter(g => !g._placeholder));
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
    // Catálogo curado de "más buscados": se muestra SIEMPRE, aunque el
    // scraper de PSN falle o devuelva poco. Deduplicamos por título: si el
    // scraper ya trajo ese juego (con precio real en vivo), preferimos ese y
    // descartamos el curado para no mostrar la tarjeta dos veces.
    if (feat.status === "fulfilled" && Array.isArray(feat.value?.games)) {
      // Precios en vivo resueltos por /api/featured-prices (mapa featuredId →
      // { priceUSD, originalPriceUSD, onSale, discount, url, psnId }). Si el
      // título se pudo resolver contra PSN, usamos su precio/oferta real; si
      // no, caemos al priceUSD fijo de featured-games.json.
      const livePrices = (featPrices.status === "fulfilled" && featPrices.value?.prices) || {};
      const seen = new Set(games.map(g => matchKey(g.title)));
      featuredGames = feat.value.games
        .filter(g => g && g.title && !seen.has(matchKey(g.title)))
        .map(g => {
          const live = livePrices[g.id];
          const fixedUSD = Number(g.priceUSD) || 0;
          return {
            id: g.id,
            title: g.title,
            platform: g.platform || "PS5/PS4",
            // Portada: 1) la oficial de PlayStation Store si PSN resolvió el título;
            // 2) la cosechada en covers.json (CDN, sin cupo de API); 3) si ninguna,
            // queda vacía y enrichFeaturedCovers() busca un fallback en vivo.
            imageUrl: live?.imageUrl || coversIndex[g.id] || "",
            url: live?.url || `https://wa.me/${CONFIG.whatsapp}`,
            priceUSD: live ? live.priceUSD : fixedUSD,
            originalPriceUSD: live ? live.originalPriceUSD : fixedUSD,
            onSale: live ? !!live.onSale : false,
            discount: live ? (live.discount || 0) : 0,
            isBundle: false,
            genres: Array.isArray(g.genres) ? g.genres : [],
            psnId: live?.psnId,
            _featured: true,
            _livePrice: !!live,
          };
        });
      games.push(...featuredGames);
    }
    if (!games.length && !psBundles.bundles.length && !xboxBundles.bundles.length) {
      throw new Error("No se pudo cargar ningún juego");
    }
    // Exclusión manual: sacamos del catálogo cualquier juego cuyo ID de PSN o
    // título esté en hidden-games.json. Se quita de TODAS las vistas (catálogo,
    // búsqueda, relacionados), no solo del filtro AAA.
    const filteredGames = (hiddenGames.ids.size || hiddenGames.titles.size)
      ? games.filter(g => !isHiddenGame(g))
      : games;
    allGames = filteredGames.sort((a, b) => {
      if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
      return (b.discount || 0) - (a.discount || 0);
    });
    hydrateRawgMetaFromCache(allGames);
  } catch (err) {
    loadError = err.message;
  } finally {
    loaded = true;
    render();
    enrichFeaturedCovers();
    enrichReservaCovers();
    // Enriquecer en background: la primera vez tarda, después todo cacheado.
    scheduleAAAEnrichForVisible();
  }
}

// Trae la carátula (y Metacritic) de cada juego del catálogo curado, primero
// desde RAWG y, si el cupo está agotado, desde IGDB (gratis, sin cupo mensual).
// Inyecta en el DOM sin re-renderizar. Cacheado en localStorage 30 días.
async function enrichFeaturedCovers() {
  if (!featuredGames.length) return;
  for (const g of featuredGames) {
    if (g.imageUrl) continue; // ya tiene portada oficial de PlayStation Store
    const mkey = matchKey(g.title);

    // Paso 1: portada directa desde la página de producto de PS Store por PSN ID.
    // Fase 2 de featured-prices resuelve el precio vía búsqueda, cuyo apolloState
    // no incluye `media` → imageUrl queda vacío aunque el juego sí exista en PSN.
    // Aquí lo corregimos: si tenemos psnId, fetcheamos la página del producto.
    let cover = "";
    if (g.psnId) {
      const cacheKey = `psn-cover:${g.psnId}`;
      let cached = localStorage.getItem(cacheKey);
      if (cached === null) {
        try {
          const r = await fetch(`/api/cover?psnId=${encodeURIComponent(g.psnId)}`);
          const data = await r.json();
          cached = data.coverUrl || "";
          localStorage.setItem(cacheKey, cached);
        } catch { cached = ""; }
      }
      cover = cached || "";
    }

    // Paso 2: IGDB como fallback vertical (cover_big_2x = 528×748).
    if (!cover) cover = await fetchPortraitCover(g.title);

    // Paso 2: RAWG. Lo seguimos consultando para cosechar Metacritic/indie (que
    // alimentan los badges y el orden AAA del catálogo) aunque ya tengamos
    // portada. Su background_image es apaisado, así que sólo lo usamos como
    // último recurso si no hubo carátula vertical.
    if (!rawgQuotaExhausted()) {
      const key = `rawg-cover:${mkey}`;
      let cached = readRawgCache(key);
      if (cached === undefined) {
        const json = await rawgFetch(`/api/rawg?mode=search&q=${encodeURIComponent(cleanTitleForRawg(g.title))}&page_size=1`);
        if (json !== null) {
          const hit = json?.games?.[0];
          cached = hit?.imageUrl || "";
          if (hit?.metacritic != null) {
            g._rawgMeta = hit.metacritic;
            writeRawgCache(`rawg-meta:${mkey}`, hit.metacritic);
          }
          if (hit) writeRawgCache(`rawg-indie:${mkey}`, rawgHitIsIndie(hit));
          writeRawgCache(key, cached);
        }
      }
      if (!cover) cover = cached || "";
    }

    if (cover) {
      g.imageUrl = cover;
      applyGameCoverUpdate(g);
    }
    await new Promise(res => setTimeout(res, 120));
  }
}

// Reemplaza el placeholder por la imagen real en las tarjetas y/o en la ficha
// del juego, sin re-renderizar (mantiene scroll y filtros activos).
function applyGameCoverUpdate(g) {
  const href = `#/producto/${encodeURIComponent(g.id)}`;
  document.querySelectorAll(`a[href="${CSS.escape(href)}"] .card-image`).forEach(box => {
    const ph = box.querySelector(".placeholder");
    if (!ph) return;
    const img = new Image();
    img.src = g.imageUrl;
    img.alt = g.title;
    img.loading = "lazy";
    ph.replaceWith(img);
  });
  // Ficha de producto abierta en este juego
  const route = parseRoute();
  if (route.name === "product" && String(route.id) === String(g.id)) {
    const box = document.querySelector(".product-image");
    const ph = box?.querySelector(".placeholder");
    if (ph) {
      const img = new Image();
      img.src = g.imageUrl;
      img.alt = g.title;
      ph.replaceWith(img);
    }
  }
}

// Auto-busca la portada de cada reservación manual (reservaciones.json) que no
// tenga imageUrl, igual que hacemos con los destacados. Usa /api/cover?q=<título>
// (IGDB) y cachea el resultado en localStorage. Inyecta la imagen en el DOM sin
// re-renderizar, así que sirve aunque el usuario ya esté en la página de
// Reservaciones. Idempotente y con guarda para no correr dos veces a la vez.
let reservaCoversRunning = false;
async function enrichReservaCovers() {
  if (reservaCoversRunning) return;
  const pending = (reservaciones || []).filter(r => r && r.title && !r.imageUrl);
  if (!pending.length) return;
  reservaCoversRunning = true;
  try {
    for (const r of pending) {
      if (r.imageUrl) continue;
      const cacheKey = `reserva-cover:${matchKey(r.title)}`;
      let url = localStorage.getItem(cacheKey) || null; // null si vacío o no existe
      if (!url) {
        try {
          const resp = await fetch(`/api/cover?q=${encodeURIComponent(r.title)}`);
          const data = await resp.json();
          url = data.coverUrl || "";
          // Solo cacheamos si encontramos algo; si no, volvemos a intentar la próxima vez
          if (url) localStorage.setItem(cacheKey, url);
        } catch { url = ""; }
      }
      if (url) {
        r.imageUrl = url;
        applyReservaCoverUpdate(r);
      }
      await new Promise(res => setTimeout(res, 120));
    }
  } finally {
    reservaCoversRunning = false;
  }
}

// Reemplaza el placeholder por la portada real en la tarjeta y/o ficha de la
// reservación, sin re-renderizar (mantiene scroll). Casa por data-reserva-id,
// tanto en la grilla (.card-image) como en la ficha (.product-image).
function applyReservaCoverUpdate(r) {
  const id = String(r.id || r.title);
  document.querySelectorAll(`[data-reserva-id="${CSS.escape(id)}"]`).forEach(box => {
    const ph = box.querySelector(".placeholder");
    if (!ph) return;
    const img = new Image();
    img.src = r.imageUrl;
    img.alt = r.title;
    img.loading = "lazy";
    ph.replaceWith(img);
  });
}

// Carga diferida de los bundles de Nintendo Switch (nintendo-bundles.json, ~2.9 MB):
// NO se baja en el arranque (la home no los necesita); solo la primera vez que el
// usuario entra a la pagina de Switch o a un bundle de Nintendo. Memoizado.
let nintendoPromise = null;
function ensureNintendo() {
  if (!nintendoPromise) {
    nintendoPromise = fetch("/nintendo-bundles.json")
      .then(r => r.json())
      .then(data => {
        if (data && Array.isArray(data.bundles)) nintendo = data;
        enrichBundleCovers(); // best-effort en background, cacheado en localStorage
      })
      .catch(() => {});
  }
  return nintendoPromise;
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
    if (location.pathname.endsWith(`/nintendo/${encodeURIComponent(id)}`)) {
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
function trackPageView() {
  let sid = sessionStorage.getItem("rmd_sid");
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("rmd_sid", sid);
  }
  fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: location.pathname, sid }),
  }).catch(() => {});
}

function render() {
  navigateActive();
  updateCartBadge();
  updateMiniCart(loadCart());
  trackPageView();
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
  if (route.name === "reserva") return renderReserva(route.id);
  if (route.name === "buscar") return renderBusqueda(route.term, route.page);
  if (route.name === "categoria") return renderCategoria(route.genre, route.page);
  if (route.name === "resenas") return renderResenas();
  if (route.name === "cart") return renderCart();
  if (route.name === "login") return renderLogin();
  if (route.name === "mi-cuenta") return renderMyAccount();
  if (route.name === "admin") return renderAdmin();
  return renderHome(route.page);
}

function renderHome(page = 1) {
  setPageMeta(
    "Rey Midas Digitales — Juegos PS5 / PS4 / Xbox / Switch en Costa Rica",
    "Comprá juegos digitales PS5, PS4, Xbox y Nintendo Switch en Costa Rica. Entrega inmediata por WhatsApp. Pagá con SINPE Móvil o transferencia."
  );
  setJsonLd({
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Rey Midas Digitales",
    "url": "https://reymidascr.com",
    "logo": "https://reymidascr.com/assets/logo.png",
    "description": "Tienda de juegos digitales para PS5, PS4, Xbox y Nintendo Switch en Costa Rica.",
    "areaServed": { "@type": "Country", "name": "CR" },
    "contactPoint": {
      "@type": "ContactPoint",
      "telephone": `+${CONFIG.whatsapp}`,
      "contactType": "customer service",
      "availableLanguage": "Spanish"
    }
  });
  app.innerHTML = `
    ${heroHTML()}
    ${trustBarHTML()}
    <section class="container catalog-section">
      <div class="section-title">
        <h2>Catálogo destacado</h2>
        <p>Tocá un juego para ver detalles y agregarlo al carrito.</p>
      </div>
      ${categoryCardsHTML()}
      ${toolbarHTML()}
      <div id="grid" class="grid"></div>
      <div id="pagination" class="pagination"></div>
    </section>
    ${howToHTML()}
    ${testimonialsHTML()}
    ${cyberStatsHTML()}
    ${faqInlineHTML(5)}
  `;
  mountHeroSlider();
  mountToolbar(null, page, "/");
  mountCyberStats();
}

function renderPlatform(platform, page = 1) {
  setPageMeta(
    `Juegos ${platform} en Costa Rica | Rey Midas Digitales`,
    `Comprá juegos digitales de ${platform} en Costa Rica. Entrega inmediata por WhatsApp. Pago con SINPE Móvil o transferencia bancaria.`
  );
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
        <p id="platform-count">${list.length} ${list.length === 1 ? "juego disponible" : "juegos disponibles"}</p>
      </div>
      ${toolbarHTML(false)}
      ${categoryChipsHTML(list)}
      <div id="grid" class="grid"></div>
      <div id="pagination" class="pagination"></div>
    </section>
  `;
  mountToolbar(list, page, `/plataforma/${platform}`, true);
  if (platform === 'PS4') { const v = document.querySelector('.ps4-arcade-video'); if (v) v.play().catch(()=>{}); }
  if (platform === 'PS5') { const v = document.querySelector('.ps5-banner-video'); if (v) v.play().catch(()=>{}); }
}

// Chips de categoría (género) — replican la navegación por categorías de la
// PlayStation Store. Solo mostramos las que realmente aparecen en la lista,
// usando los géneros que el scraper de PSN ya taggeó en cada juego.
function categoryChipsHTML(list) {
  const present = new Set();
  for (const g of list || []) {
    for (const t of (g.genres || [])) {
      if (GENRE_LABELS[t]) present.add(t);
    }
  }
  if (present.size < 2) return ""; // sin variedad real, no vale la pena
  const order = ["preventa", "estreno", "edicion", "accion", "aventura", "rpg", "shooter", "terror", "lucha", "carreras", "deportes", "estrategia", "infantiles"];
  const tags = order.filter(t => present.has(t));
  return `
    <div class="category-chips" id="categoryChips">
      <button class="cat-chip active" data-genre="">Todas las categorías</button>
      ${tags.map(t => `<button class="cat-chip" data-genre="${t}">${escapeHtml(GENRE_LABELS[t])}</button>`).join("")}
    </div>
  `;
}

// "PS5/PS4" → "PS5": para links a páginas de plataforma necesitamos UNA
// plataforma real (activePlatforms no incluye el combinado "PS5/PS4", así que
// /plataforma/PS5%2FPS4 caía en "Próximamente" y no dirigía a nada).
function primaryPlatform(platform) {
  const first = String(platform || "").split("/")[0].trim();
  return first || platform;
}

// Fila de "facetas" del producto (tipo, fecha de lanzamiento, clasificación por
// edad) — los datos que el scraper saca del Product de PSN. Solo muestra lo que
// realmente tiene; si el juego no trae ninguno, no renderiza nada.
function productFacetsHTML(g) {
  const bits = [];
  const TYPE_LABEL = { edition: "Edición especial", bundle: "Bundle", "full-game": "Juego completo" };
  if (TYPE_LABEL[g.type] && g.type !== "full-game") bits.push(`<span class="facet facet-type">${TYPE_LABEL[g.type]}</span>`);
  if (g.ageRating) bits.push(`<span class="facet">${escapeHtml(g.ageRating)}</span>`);
  if (g.releaseDate) {
    const d = new Date(g.releaseDate + "T00:00:00");
    const txt = isNaN(d.getTime()) ? g.releaseDate : d.toLocaleDateString("es-CR", { year: "numeric", month: "long", day: "numeric" });
    bits.push(`<span class="facet facet-date">${g.comingSoon ? "Disponible el " : "Lanzamiento: "}${escapeHtml(txt)}</span>`);
  }
  return bits.length ? `<div class="product-facets">${bits.join("")}</div>` : "";
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
        <a class="cta" href="/">Volver al catálogo</a>
      </section>
    `;
    return;
  }
  const principal = g._manualPrices ? g.priceCRC_principal : principalCRC(g.priceUSD, g.platform);
  const secundaria = g._manualPrices ? g.priceCRC_secundaria : secundariaCRC(g.priceUSD, g.platform);

  // Similares priorizando mismo género/franquicia
  const gameGenres = new Set(g.genres || []);
  const similars = (allGames || [])
    .filter(x => x.platform === g.platform && String(x.id) !== String(g.id))
    .sort((a, b) => {
      const aScore = (a.genres || []).filter(t => gameGenres.has(t)).length;
      const bScore = (b.genres || []).filter(t => gameGenres.has(t)).length;
      return bScore - aScore;
    })
    .slice(0, 4);

  setPageMeta(
    `${g.title} — Rey Midas Digitales`,
    `Comprá ${g.title} para ${g.platform} en Costa Rica. ${principal != null ? `Desde ${formatCRC(principal)}.` : ""} Entrega inmediata por WhatsApp.`,
    g.imageUrl || undefined
  );
  setJsonLd({
    "@context": "https://schema.org",
    "@type": "Product",
    "name": g.title,
    "description": `Juego digital ${g.title} para ${g.platform}. Entrega inmediata por WhatsApp en Costa Rica.`,
    ...(g.imageUrl ? { "image": g.imageUrl } : {}),
    "brand": { "@type": "Brand", "name": g.platform.startsWith("Xbox") ? "Xbox" : "PlayStation" },
    "offers": principal != null ? {
      "@type": "Offer",
      "priceCurrency": "CRC",
      "price": String(principal),
      "availability": g.comingSoon ? "https://schema.org/PreOrder" : "https://schema.org/InStock",
      "seller": { "@type": "Organization", "name": "Rey Midas Digitales" }
    } : undefined
  });

  // Precio comparativo vs PSN (solo si hay precio original en USD)
  const origUSD = Number(g.originalPriceUSD) || Number(g.priceUSD) || 0;
  const psnCRC = origUSD > 0 ? Math.round(origUSD * CONFIG.pricing.exchangeRate) : 0;
  const savings = (psnCRC > 0 && principal != null && psnCRC > principal) ? psnCRC - principal : 0;
  const savingsPct = savings > 0 ? Math.round((savings / psnCRC) * 100) : 0;
  const psnComparisonHTML = savings > 0 && /PS/i.test(g.platform) ? `
    <div class="psn-comparison">
      <div class="psn-row">
        <span class="psn-label">En PSN</span>
        <span class="psn-price psn-price--original">${formatCRC(psnCRC)}</span>
      </div>
      <div class="psn-row psn-row--ours">
        <span class="psn-label">Acá</span>
        <span class="psn-price psn-price--ours">${formatCRC(principal)}</span>
      </div>
      <div class="psn-savings">Ahorrás ${formatCRC(savings)} (${savingsPct}%)</div>
    </div>
  ` : "";

  app.innerHTML = `
    <section class="container product-page">
      <nav class="breadcrumb" aria-label="Migas de pan">
        <a href="/">Inicio</a>
        <span class="breadcrumb-sep">›</span>
        <a href="/plataforma/${encodeURIComponent(primaryPlatform(g.platform))}">${escapeHtml(g.platform)}</a>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">${escapeHtml(g.title)}</span>
      </nav>

      <div class="product-grid">
        <div class="product-image">
          ${g.imageUrl ? `<img src="${escapeAttr(g.imageUrl)}" alt="${escapeAttr(g.title)}">` : `${placeholderHTML()}`}
          ${g.onSale && g.discount ? `<span class="badge-sale">-${g.discount}%</span>` : ""}
          ${g.comingSoon ? `<span class="badge-preventa">Preventa</span>` : ""}
        </div>
        <div class="product-info">
          <span class="product-platform">${escapeHtml(g.platform)}</span>
          <h1>${escapeHtml(g.title)}</h1>
          ${productFacetsHTML(g)}

          <div class="product-tags">
            <span class="tag tag-stock">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>
              ${g.comingSoon ? "En preventa" : "En stock"}
            </span>
            <span class="tag tag-delivery">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              ${g.comingSoon ? "Entrega el día de lanzamiento" : "Entrega inmediata"}
            </span>
            <span class="tag tag-warranty">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Garantía
            </span>
          </div>

          <p class="product-desc">Juego digital para <strong>${escapeHtml(g.platform)}</strong>. Te entregamos el acceso por WhatsApp en menos de 10 minutos luego de confirmar el pago por SINPE Móvil o transferencia bancaria. Sin esperas, sin envíos físicos.</p>

          <div class="price-options">
            ${principal != null ? `
              <div class="price-card principal">
                <div class="price-label">Cuenta Principal</div>
                <div class="price-amount">${formatCRC(principal)}</div>
                <div class="price-note">Acceso completo · juego offline · compartilo con tu familia en la misma consola</div>
                <button class="price-cta" data-add="principal" data-id="${escapeAttr(g.id)}">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                  Agregar al carrito
                </button>
              </div>
            ` : ""}
            ${secundaria != null ? `
              <div class="price-card secundaria">
                <div class="price-label">Cuenta Secundaria</div>
                <div class="price-amount">${formatCRC(secundaria)}</div>
                <div class="price-note">Más económico · necesitás estar conectado a internet para jugar</div>
                <button class="price-cta" data-add="secundaria" data-id="${escapeAttr(g.id)}">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                  Agregar al carrito
                </button>
              </div>
            ` : ""}
          </div>

          ${psnComparisonHTML}

          <a class="cta-wa product-wa-link" href="https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Hola, me interesa el juego " + g.title + " (" + g.platform + "). ¿Sigue disponible?")}" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20.52 3.48A12 12 0 0 0 2.05 18.31L1 23l4.81-1.26A12 12 0 1 0 20.52 3.48zM12 21a9 9 0 0 1-4.59-1.26l-.33-.2-3.07.8.82-3-.21-.34A9 9 0 1 1 12 21zm5.07-6.74c-.28-.14-1.65-.81-1.9-.9s-.44-.14-.62.14-.71.9-.87 1.08-.32.21-.6.07a7.4 7.4 0 0 1-2.18-1.35 8.19 8.19 0 0 1-1.51-1.88c-.16-.28 0-.43.12-.57s.28-.32.42-.49a1.94 1.94 0 0 0 .28-.46.51.51 0 0 0 0-.49c-.07-.14-.62-1.51-.85-2.06s-.46-.46-.62-.47h-.53a1 1 0 0 0-.74.35 3.13 3.13 0 0 0-1 2.32 5.39 5.39 0 0 0 1.14 2.86 12.51 12.51 0 0 0 4.79 4.21 16.39 16.39 0 0 0 1.6.59 3.85 3.85 0 0 0 1.77.11 2.89 2.89 0 0 0 1.89-1.33 2.31 2.31 0 0 0 .17-1.33c-.07-.12-.26-.19-.54-.33z"/></svg>
            Consultar por WhatsApp
          </a>
        </div>
      </div>

      <section class="product-section rawg-section" id="rawg-info" data-title="${escapeAttr(g.title)}" data-platform="${escapeAttr(g.platform)}">
        ${renderRawgFallback(g)}
      </section>

      <section class="product-section">
        <h2 class="product-section-title">Sobre este juego</h2>
        <div id="game-sobre-slot" data-title="${escapeAttr(g.title)}">
          <p class="product-section-desc">
            <strong>${escapeHtml(g.title)}</strong> — cargando información del juego…
          </p>
        </div>
        <div class="product-features">
          <div class="product-feature">
            <span class="pf-icon">${ICONS.zap}</span>
            <div>
              <strong>Entrega inmediata</strong>
              <span>Recibís los datos por WhatsApp en menos de 10 minutos.</span>
            </div>
          </div>
          <div class="product-feature">
            <span class="pf-icon">${ICONS.shield}</span>
            <div>
              <strong>Garantía real</strong>
              <span>Si la cuenta falla, te la reemplazamos sin costo.</span>
            </div>
          </div>
          <div class="product-feature">
            <span class="pf-icon">${ICONS.card}</span>
            <div>
              <strong>Pago fácil</strong>
              <span>SINPE Móvil o transferencia bancaria. Sin tarjeta extranjera.</span>
            </div>
          </div>
          <div class="product-feature">
            <span class="pf-icon">${ICONS.chat}</span>
            <div>
              <strong>Soporte personalizado</strong>
              <span>Te ayudamos con la instalación por WhatsApp paso a paso.</span>
            </div>
          </div>
        </div>
      </section>

      ${testimonials.length ? `
        <section class="product-section">
          <div class="reviews-section-head">
            <h2 class="product-section-title">Lo que dicen nuestros clientes</h2>
            <div class="reviews-mini-summary">
              <span class="rsb-num small">${(reviewStats.averageRating || 0).toFixed(1)}</span>
              <span class="rsb-stars small">${"★".repeat(Math.round(reviewStats.averageRating))}</span>
              <span class="rsb-total small">${reviewStats.totalReviews}+ reseñas</span>
            </div>
          </div>
          <div class="testimonials-grid product-reviews">
            ${testimonials.slice(0, 3).map(testimonialCardHTML).join("")}
          </div>
          <div class="testimonials-more">
            <a class="cta-secondary" href="/resenas">Ver todas las reseñas</a>
          </div>
        </section>
      ` : ""}

      ${similars.length ? `
        <section class="product-section">
          <h2 class="product-section-title">Juegos similares</h2>
          <div class="grid similars-grid">
            ${similars.map(cardHTML).join("")}
          </div>
        </section>
      ` : ""}
    </section>
  `;
  bindAddButtons(g);
  enrichGameFicha(g);
}

// ============================================================
// Ficha del juego EN ESPAÑOL. Prioridad:
//   1) PlayStation Store (es-cr) si el juego tiene psnId — descripción,
//      distribuidora, géneros, fecha, capturas y VIDEO oficial, todo en español.
//   2) Vandal (vandal.elespanol.com) como respaldo por título (español).
//   3) RAWG/IGDB (inglés) como último recurso, vía enrichWithRawg().
// Cacheado en localStorage (vía readRawgCache/writeRawgCache) para no repetir.
// ============================================================

function fichaHasContent(f) {
  return !!(f && (f.description || (f.screenshots && f.screenshots.length) || f.videoUrl));
}

// El ID de PSN puede venir en game.psnId (destacados) o ser el propio game.id
// (juegos scrapeados en vivo, con formato "EP9000-CUSA..."/"UP...").
function gamePsnId(game) {
  if (game.psnId) return game.psnId;
  if (typeof game.id === "string" && /^[A-Z]{2}\d/.test(game.id)) return game.id;
  return null;
}

async function fetchPsnFicha(psnId) {
  const key = `psn-ficha:v3:${psnId}`;
  const cached = readRawgCache(key);
  if (cached !== undefined) return cached || null;
  let f = null;
  try {
    const r = await fetch(`/api/cover?psnId=${encodeURIComponent(psnId)}&full=1`);
    f = await r.json();
  } catch { f = null; }
  const value = fichaHasContent(f) ? f : null;
  writeRawgCache(key, value || { miss: true });
  return value;
}

async function fetchVandalFicha(title) {
  const key = `vandal-ficha:v3:${matchKey(title)}`;
  const cached = readRawgCache(key);
  if (cached !== undefined) return cached?.miss ? null : (cached || null);
  let f = null;
  try {
    const r = await fetch(`/api/cover?vandal=${encodeURIComponent(cleanTitleForRawg(title))}`);
    f = await r.json();
  } catch { f = null; }
  const value = fichaHasContent(f) ? f : null;
  writeRawgCache(key, value || { miss: true });
  return value;
}

async function enrichGameFicha(game) {
  const slot = document.getElementById("rawg-info");
  if (!slot) return;

  const f = { description: "", genres: [], publisher: "", developer: "", released: "", coverUrl: "", screenshots: [], videoUrl: "", _source: "" };

  // (A) Descripción/metadatos EN ESPAÑOL según la plataforma:
  //   - PlayStation: página de producto de PSN (JSON-LD).
  //   - Xbox: catálogo de Microsoft (trae descripción ES + capturas, sin cupo).
  const psnId = gamePsnId(game);
  if (psnId) {
    const psn = await fetchPsnFicha(psnId);
    if (slot.dataset.title !== game.title) return;
    if (psn) { mergeFicha(f, psn); if (psn.description) f._source = "PlayStation Store"; }
  }
  const xboxId = (typeof game.id === "string" && game.id.startsWith("xbox-")) ? game.id.slice(5) : "";
  if (xboxId && (!f.description || !f.screenshots.length)) {
    const xb = await fetchXboxFicha(xboxId);
    if (slot.dataset.title !== game.title) return;
    if (xb) { mergeFicha(f, xb); if (!f._source && xb.description) f._source = "Xbox"; }
  }
  if (!f.description) {
    const vandal = await fetchVandalFicha(game.title);
    if (slot.dataset.title !== game.title) return;
    if (vandal) { mergeFicha(f, vandal); if (!f._source && vandal.description) f._source = "Vandal"; }
  }

  // (B) CAPTURAS sin cupo: catálogo de Microsoft por título. La mayoría de los
  // juegos de PS son multiplataforma y están también en la tienda MS, así que de
  // acá salen las capturas (y descripción/géneros si aún faltan) sin gastar RAWG.
  if (!xboxId && !f.screenshots.length) {
    const ms = await fetchXboxFichaByTitle(game.title);
    if (slot.dataset.title !== game.title) return;
    if (ms) { mergeFicha(f, ms); if (!f._source && ms.description) f._source = "Xbox"; }
  }

  // (C) Último recurso (RAWG/IGDB, con cupo): solo si todavía falta algo.
  // Las imágenes son neutrales al idioma; PSN NO las expone en el HTML (las carga
  // por JS), así que las traemos de acá. La descripción de RAWG (inglés) solo se
  // usa si no hubo ninguna en español.
  if (!f.screenshots.length || !f.description || !f.genres.length) {
    const media = await fetchRawgMedia(game.title);
    if (slot.dataset.title !== game.title) return;
    if (media) {
      if (!f.screenshots.length) f.screenshots = media.screenshots || [];
      if (!f.genres.length) f.genres = media.genres || [];
      if (!f.developer) f.developer = media.developer || "";
      if (!f.publisher) f.publisher = media.publisher || "";
      if (!f.released) f.released = media.released || "";
      if (!f.description) { f.description = media.description || ""; if (!f._source) f._source = media._source || "RAWG.io"; }
    }
  }

  if (f.description || f.screenshots.length) {
    renderFichaEspanol(game, f);
    // Tráiler de YouTube en segundo plano (no bloquea la ficha; sin configurar nada).
    fetchTrailer(game.title).then(url => {
      if (url && slot.dataset.title === game.title) injectFichaVideo(game, url);
    });
    return;
  }
  // Nada disponible: ficha mínima existente.
  enrichWithRawg(game);
}

// Tráiler de YouTube para un título (vía /api/cover?youtube=). Cacheado.
async function fetchTrailer(title) {
  const key = `yt-trailer:v1:${matchKey(title)}`;
  const cached = readRawgCache(key);
  if (cached !== undefined) return cached?.miss ? "" : (cached || "");
  let url = "";
  try {
    const r = await fetch(`/api/cover?youtube=${encodeURIComponent(cleanTitleForRawg(title))}`);
    url = (await r.json())?.embedUrl || "";
  } catch { url = ""; }
  writeRawgCache(key, url || { miss: true });
  return url;
}

// Vuelca en dst los campos de src que dst aún no tenga (sin pisar lo ya resuelto).
function mergeFicha(dst, src) {
  if (!src) return;
  if (src.description && !dst.description) dst.description = src.description;
  if (src.coverUrl && !dst.coverUrl) dst.coverUrl = src.coverUrl;
  if (src.videoUrl && !dst.videoUrl) dst.videoUrl = src.videoUrl;
  if (src.screenshots?.length && !dst.screenshots.length) dst.screenshots = src.screenshots;
  if (src.genres?.length && !dst.genres.length) dst.genres = src.genres;
  if (src.publisher && !dst.publisher) dst.publisher = src.publisher;
  if (src.developer && !dst.developer) dst.developer = src.developer;
  if (src.released && !dst.released) dst.released = src.released;
}

// Ficha de Xbox por ID (descripción ES + capturas) desde el catálogo de Microsoft.
async function fetchXboxFicha(xboxId) {
  const key = `xbox-ficha:v1:${xboxId}`;
  const cached = readRawgCache(key);
  if (cached !== undefined) return cached?.miss ? null : cached;
  let f = null;
  try {
    const r = await fetch(`/api/cover?xboxId=${encodeURIComponent(xboxId)}`);
    f = await r.json();
  } catch { f = null; }
  const value = fichaHasContent(f) ? f : null;
  writeRawgCache(key, value || { miss: true });
  return value;
}

// Capturas (sin cupo) buscando el juego por título en el catálogo de Microsoft.
async function fetchXboxFichaByTitle(title) {
  const key = `ms-ficha:v1:${matchKey(title)}`;
  const cached = readRawgCache(key);
  if (cached !== undefined) return cached?.miss ? null : cached;
  let f = null;
  try {
    const r = await fetch(`/api/cover?xboxSearch=${encodeURIComponent(cleanTitleForRawg(title))}`);
    f = await r.json();
  } catch { f = null; }
  const value = fichaHasContent(f) ? f : null;
  writeRawgCache(key, value || { miss: true });
  return value;
}

// Capturas + metadatos desde la base de datos de juegos (RAWG, IGDB de respaldo).
// Neutral al idioma: completa lo que PSN no expone (capturas). Cacheado.
async function fetchRawgMedia(title) {
  const key = `rawg-media:v1:${matchKey(title)}`;
  const cached = readRawgCache(key);
  if (cached !== undefined) return cached?.miss ? null : cached;

  let media = null;
  if (!rawgQuotaExhausted()) {
    const json = await rawgFetch(`/api/rawg?mode=search&q=${encodeURIComponent(cleanTitleForRawg(title))}&page_size=1`);
    const hit = json?.games?.[0];
    if (hit) {
      media = {
        screenshots: (hit.shortScreenshots || []).filter(Boolean).slice(0, 4),
        genres: hit.genres || [], developer: "", publisher: "",
        released: hit.released || "", description: "", videoUrl: "", _source: "RAWG.io",
      };
      if (hit.slug) {
        const dj = await rawgFetch(`/api/rawg?mode=detail&id=${encodeURIComponent(hit.slug)}`);
        const d = dj?.game;
        if (d) {
          media.developer = (d.developers || [])[0] || "";
          media.publisher = (d.publishers || [])[0] || "";
          if (d.released) media.released = d.released;
          if (d.description) media.description = d.description;
        }
      }
    }
  }
  if (!media && !igdbUnavailable()) {
    const json = await igdbFetch(`/api/rawg?mode=igdb-detail&id=${encodeURIComponent(cleanTitleForRawg(title))}`);
    const g = json?.game;
    if (g) {
      media = {
        screenshots: (g.shortScreenshots || []).filter(Boolean).slice(0, 4),
        genres: g.genres || [], developer: (g.developers || [])[0] || "",
        publisher: (g.publishers || [])[0] || "", released: g.released || "",
        description: g.description || "", videoUrl: "", _source: "IGDB.com",
      };
    }
  }
  writeRawgCache(key, media || { miss: true });
  return media;
}

// Renderiza la ficha en español (PSN/Vandal) en las dos secciones de la página.
function renderFichaEspanol(game, f) {
  const desc = (f.description || "").trim();
  const shortDesc = desc.length > 600 ? desc.slice(0, 600).replace(/\s+\S*$/, "") + "…" : desc;
  const genres = (f.genres || []).slice(0, 6);
  const shots = (f.screenshots || []).filter(Boolean).slice(0, 4);
  const cover = game.imageUrl || f.coverUrl || "";

  const metaList = `
    <ul class="rawg-meta">
      ${f.developer ? `<li><span>Desarrollador</span><strong>${escapeHtml(f.developer)}</strong></li>` : ""}
      ${f.publisher && f.publisher !== f.developer ? `<li><span>Distribuidora</span><strong>${escapeHtml(f.publisher)}</strong></li>` : ""}
      ${f.released ? `<li><span>Lanzamiento</span><strong>${escapeHtml(f.released)}</strong></li>` : ""}
      ${genres.length ? `<li><span>Géneros</span><strong>${genres.map(escapeHtml).join(" · ")}</strong></li>` : ""}
    </ul>`;

  const shotsHtml = shots.length ? `
    <div class="rawg-shots">
      ${shots.map(s => `<img loading="lazy" src="${escapeAttr(s)}" alt="Captura de ${escapeAttr(game.title)}">`).join("")}
    </div>` : "";

  const slot = document.getElementById("rawg-info");
  if (slot && slot.dataset.title === game.title) {
    slot.innerHTML = `
      <div class="rawg-head">
        <h2 class="product-section-title">Acerca de ${escapeHtml(game.title)}</h2>
      </div>
      ${shortDesc ? `<p class="rawg-desc">${escapeHtml(shortDesc)}</p>` : ""}
      ${metaList}
      <div class="ficha-video-slot"></div>
      ${shotsHtml}
      <p class="rawg-credit">Información del juego cortesía de ${escapeHtml(f._source || "PlayStation Store")}</p>`;
    // CSP bloquea onerror inline → ocultamos las capturas rotas vía JS.
    slot.querySelectorAll(".rawg-shots img").forEach(img =>
      img.addEventListener("error", () => img.remove()));
  }

  const sobre = document.getElementById("game-sobre-slot");
  if (sobre && sobre.dataset.title === game.title) {
    sobre.innerHTML = `
      ${shortDesc ? `<p class="rawg-desc">${escapeHtml(shortDesc)}</p>` : ""}
      ${metaList}`;
  }
}

// Inserta el tráiler de YouTube en el hueco reservado de la ficha (sin re-render).
function injectFichaVideo(game, embedUrl) {
  const slot = document.getElementById("rawg-info");
  if (!slot || slot.dataset.title !== game.title) return;
  const holder = slot.querySelector(".ficha-video-slot");
  if (!holder || holder.querySelector("iframe")) return;
  holder.innerHTML = `
    <div class="ficha-video">
      <iframe src="${escapeAttr(embedUrl)}" title="Tráiler de ${escapeAttr(game.title)}"
        loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen></iframe>
    </div>`;
}

// ============================================================
// RAWG: enriquece la ficha del juego con metadatos reales
// (descripción, Metacritic, dev, géneros, screenshots). Cacheado en
// localStorage por 30 días para no quemar el cupo de 20k req/mes.
// El match es por título limpiado (sin ™, sin "Edition", etc.).
// ============================================================
const RAWG_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function enrichWithRawg(game) {
  const slot = document.getElementById("rawg-info");
  if (!slot) return;
  if (slot.dataset.title !== game.title) return; // navegó a otro juego mientras tanto

  const cleaned = cleanTitleForRawg(game.title);
  const cacheKey = `rawg:${cleaned.toLowerCase()}`;
  let data = readRawgCache(cacheKey);

  if (!data) {
    if (rawgQuotaExhausted()) {
      // Sin cupo de RAWG: intentar portada desde IGDB (si configurado).
      if (!game.imageUrl) {
        const fallbackCover = await fetchPortraitCover(game.title);
        if (fallbackCover) {
          game.imageUrl = fallbackCover;
          if (slot.dataset.title !== game.title) return;
          const productImg = document.querySelector(".product-image img, .product-image .placeholder");
          if (productImg && productImg.tagName !== "IMG") {
            const img = new Image();
            img.src = fallbackCover;
            img.alt = game.title;
            productImg.replaceWith(img);
          }
        }
      }
      // Intentar ficha completa desde IGDB si está configurado
      if (!igdbUnavailable()) {
        const igdbCacheKey = `igdb:${cleaned.toLowerCase()}`;
        let igdbData = readRawgCache(igdbCacheKey);
        if (!igdbData) {
          const json = await igdbFetch(`/api/rawg?mode=igdb-detail&id=${encodeURIComponent(cleaned)}`);
          igdbData = json?.game || null;
          writeRawgCache(igdbCacheKey, igdbData || { miss: true });
        }
        if (igdbData && !igdbData.miss) {
          if (slot.dataset.title !== game.title) return;
          slot.innerHTML = renderRawgSection({ ...igdbData, _source: "igdb" });
          const sobreSlot = document.getElementById("game-sobre-slot");
          if (sobreSlot && sobreSlot.dataset.title === game.title) {
            sobreSlot.innerHTML = renderSobreJuego({ ...igdbData, _source: "igdb" });
          }
          if (igdbData.imageUrl && !game.imageUrl) {
            game.imageUrl = igdbData.imageUrl;
            const productImg = document.querySelector(".product-image img, .product-image .placeholder");
            if (productImg && productImg.tagName !== "IMG") {
              const img = new Image();
              img.src = igdbData.imageUrl;
              img.alt = game.title;
              productImg.replaceWith(img);
            }
          }
        }
      }
      return;
    }
    const json = await rawgFetch(`/api/rawg?mode=search&q=${encodeURIComponent(cleaned)}&page_size=1`);
    if (json === null) return; // sin datos / cupo agotado: no cachear, reintentar luego
    const hit = json?.games?.[0];
    if (!hit) {
      writeRawgCache(cacheKey, { miss: true });
      return;
    }
    // El search trae info parcial. Pedimos el detail por slug para descripción larga.
    const detailJson = await rawgFetch(`/api/rawg?mode=detail&id=${encodeURIComponent(hit.slug)}`);
    data = {
      ...hit,
      ...(detailJson?.game || {}),
      // screenshots vienen del listItem (short_screenshots) — el detail no los trae
      shortScreenshots: hit.shortScreenshots || [],
    };
    writeRawgCache(cacheKey, data);
  }
  if (data?.miss) return;
  // Re-check por si el usuario ya navegó a otro juego durante el fetch
  if (slot.dataset.title !== game.title) return;
  slot.innerHTML = renderRawgSection(data);

  // Actualizar "Sobre este juego" con descripción e info real del juego
  const sobreSlot = document.getElementById("game-sobre-slot");
  if (sobreSlot && sobreSlot.dataset.title === game.title) {
    sobreSlot.innerHTML = renderSobreJuego(data);
  }

  // Portada si el juego no traía imagen del scraper. Preferimos IGDB (vertical)
  // sobre el background_image apaisado de RAWG (último recurso).
  if (!game.imageUrl) {
    const cover = (await fetchPortraitCover(game.title)) || data.imageUrl || "";
    if (cover) {
      game.imageUrl = cover;
      if (slot.dataset.title !== game.title) return;
      const productImg = document.querySelector(".product-image img, .product-image .placeholder");
      if (productImg && productImg.tagName !== "IMG") {
        const img = new Image();
        img.src = cover;
        img.alt = game.title;
        productImg.replaceWith(img);
      }
    }
  }
}

// Géneros que el scraper de PSN guarda normalizados (sin tilde, minúsculas).
// Acá los volvemos a una etiqueta presentable para la ficha.
const GENRE_LABELS = {
  // Facetas tipo PS Store (no son géneros, pero se filtran igual):
  preventa: "Preventas", estreno: "Novedades", edicion: "Ediciones",
  // Géneros:
  accion: "Acción", aventura: "Aventura", terror: "Terror", rpg: "RPG",
  deportes: "Deportes", carreras: "Carreras", shooter: "Shooter",
  lucha: "Lucha", estrategia: "Estrategia", infantiles: "Infantil",
};

// Tarjetas de categoría en colores para el inicio. Cada una linkea a
// /categoria/<tag>. El color sale de la clase cat-card--<tag> en style.css.
const HOME_CATEGORIES = [
  { tag: "accion", icon: "💥" },
  { tag: "aventura", icon: "🗺️" },
  { tag: "rpg", icon: "⚔️" },
  { tag: "shooter", icon: "🎯" },
  { tag: "terror", icon: "👻" },
  { tag: "deportes", icon: "⚽" },
  { tag: "carreras", icon: "🏎️" },
  { tag: "lucha", icon: "🥊" },
  { tag: "estrategia", icon: "♟️" },
  { tag: "infantiles", icon: "🧸" },
];

function categoryCardsHTML(activeGenre) {
  return `
    <div class="category-nav-bar${activeGenre !== undefined ? " category-nav-bar--sticky" : ""}">
      <div class="category-nav-row">
        ${HOME_CATEGORIES.map(c => `
          <a class="cat-pill cat-card--${c.tag}${activeGenre === c.tag ? " cat-pill--active" : ""}" href="/categoria/${c.tag}">${escapeHtml(GENRE_LABELS[c.tag] || c.tag)}</a>
        `).join("")}
      </div>
    </div>
  `;
}

// Ficha mínima construida con lo que ya scrapeamos (plataforma, géneros,
// oferta). Se muestra al instante para que la sección "información del juego"
// nunca quede vacía; si RAWG matchea después, enrichWithRawg() la reemplaza
// por la versión rica (descripción, Metacritic, screenshots).
function renderRawgFallback(g) {
  const genres = (g.genres || [])
    .map(t => GENRE_LABELS[t] || (t ? t[0].toUpperCase() + t.slice(1) : ""))
    .filter(Boolean);
  return `
    <div class="rawg-head">
      <h2 class="product-section-title">Ficha del juego</h2>
    </div>
    <ul class="rawg-meta">
      <li><span>Plataforma</span><strong>${escapeHtml(g.platform)}</strong></li>
      ${genres.length ? `<li><span>Géneros</span><strong>${genres.map(escapeHtml).join(" · ")}</strong></li>` : ""}
      <li><span>Formato</span><strong>Digital</strong></li>
      ${g.onSale && g.discount ? `<li><span>Descuento</span><strong>-${g.discount}%</strong></li>` : ""}
    </ul>
  `;
}

function renderRawgSection(d) {
  const desc = (d.description || "").trim();
  const shortDesc = desc.length > 600 ? desc.slice(0, 600).replace(/\s+\S*$/, "") + "…" : desc;
  const meta = d.metacritic;
  const metaClass = meta >= 75 ? "meta-good" : meta >= 50 ? "meta-mid" : "meta-bad";
  const devs = (d.developers || []).slice(0, 2).join(", ");
  const pubs = (d.publishers || []).slice(0, 2).join(", ");
  const genres = (d.genres || []).slice(0, 5);
  const shots = (d.shortScreenshots || []).filter(Boolean).slice(0, 4);

  return `
    <div class="rawg-head">
      <h2 class="product-section-title">Acerca de ${escapeHtml(d.title || "")}</h2>
      ${meta ? `<span class="meta-badge ${metaClass}" title="Metacritic">${meta}</span>` : ""}
    </div>
    ${shortDesc ? `<p class="rawg-desc">${escapeHtml(shortDesc)}</p>` : ""}
    <ul class="rawg-meta">
      ${devs ? `<li><span>Desarrollador</span><strong>${escapeHtml(devs)}</strong></li>` : ""}
      ${pubs && pubs !== devs ? `<li><span>Distribuidora</span><strong>${escapeHtml(pubs)}</strong></li>` : ""}
      ${d.released ? `<li><span>Lanzamiento</span><strong>${escapeHtml(d.released)}</strong></li>` : ""}
      ${d.esrb ? `<li><span>ESRB</span><strong>${escapeHtml(d.esrb)}</strong></li>` : ""}
      ${genres.length ? `<li><span>Géneros</span><strong>${genres.map(escapeHtml).join(" · ")}</strong></li>` : ""}
    </ul>
    ${shots.length ? `
      <div class="rawg-shots">
        ${shots.map(s => `<img loading="lazy" src="${escapeAttr(s)}" alt="Captura de ${escapeAttr(d.title || "")}">`).join("")}
      </div>
    ` : ""}
    <p class="rawg-credit">Información del juego cortesía de ${d._source === "igdb" ? "IGDB.com" : "RAWG.io"}</p>
  `;
}

function renderSobreJuego(d) {
  const desc = (d.description || "").trim();
  const shortDesc = desc.length > 500 ? desc.slice(0, 500).replace(/\s+\S*$/, "") + "…" : desc;
  const meta = d.metacritic;
  const metaClass = meta >= 75 ? "meta-good" : meta >= 50 ? "meta-mid" : "meta-bad";
  const devs = (d.developers || []).slice(0, 2).join(", ");
  const pubs = (d.publishers || []).slice(0, 2).join(", ");
  const genres = (d.genres || []).slice(0, 5).map(escapeHtml).join(" · ");

  return `
    ${shortDesc ? `<p class="rawg-desc">${escapeHtml(shortDesc)}</p>` : ""}
    <ul class="rawg-meta" style="margin-bottom:0">
      ${d.released ? `<li><span>Lanzamiento</span><strong>${escapeHtml(d.released)}</strong></li>` : ""}
      ${devs ? `<li><span>Desarrollador</span><strong>${escapeHtml(devs)}</strong></li>` : ""}
      ${pubs && pubs !== devs ? `<li><span>Distribuidora</span><strong>${escapeHtml(pubs)}</strong></li>` : ""}
      ${genres ? `<li><span>Géneros</span><strong>${genres}</strong></li>` : ""}
      ${d.esrb ? `<li><span>Clasificación ESRB</span><strong>${escapeHtml(d.esrb)}</strong></li>` : ""}
      ${meta ? `<li><span>Metacritic</span><strong><span class="meta-badge ${metaClass}" style="display:inline-block;vertical-align:middle">${meta}</span></strong></li>` : ""}
    </ul>
  `;
}

function cleanTitleForRawg(t) {
  return String(t || "")
    .replace(/[™®©]/g, "")
    .replace(/\s*\[(PS5|PS4|XBOX|Xbox|Series X\|S|Series X)\]/gi, "")
    .replace(/\b(Standard|Deluxe|Ultimate|Gold|Premium|Definitive|Complete|GOTY|Game of the Year|Collector'?s)\s+Edition\b/gi, "")
    .replace(/\b(Cross[- ]?Gen Bundle|Bundle|Pack)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ============================================================
// Circuit breaker de RAWG.
// Cuando se agota el cupo mensual de la API (HTTP 401 "monthly limit reached",
// 429 rate-limit, o {quota:true} desde /api/rawg) dejamos de pedirle más a RAWG
// por el resto de la sesión. Esto evita el bucle de errores en consola que se
// dispara cuando cada juego visible intenta enriquecerse, y no quema cupo de más.
// Se auto-resetea pasados RAWG_COOLDOWN_MS por si el cupo se renueva.
// ============================================================
const RAWG_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h — el cupo es mensual, no tiene sentido reintentar en 15 min

function rawgQuotaExhausted() {
  try {
    const until = Number(sessionStorage.getItem("rawg-quota-until") || 0);
    if (!until) return false;
    if (Date.now() > until) { sessionStorage.removeItem("rawg-quota-until"); return false; }
    return true;
  } catch { return false; }
}

function markRawgQuotaExhausted() {
  if (rawgQuotaExhausted()) return;
  try { sessionStorage.setItem("rawg-quota-until", String(Date.now() + RAWG_COOLDOWN_MS)); } catch {}
  console.warn("[RAWG] Cupo de la API agotado — se pausan las consultas de metadatos hasta que se renueve.");
}

// Wrapper de fetch para RAWG con circuit breaker. Devuelve el JSON parseado,
// o null si el cupo está agotado, hubo error de red, o la respuesta indica que
// se alcanzó el límite. Los callers tratan null como "sin datos" y no cachean.
async function rawgFetch(url) {
  if (rawgQuotaExhausted()) return null;
  let r;
  try { r = await fetch(url); } catch { return null; }
  if (r.status === 401 || r.status === 429) { markRawgQuotaExhausted(); return null; }
  let json = null;
  try { json = await r.json(); } catch { return null; }
  if (json && json.success === false && (json.quota || /\b(401|429|limit|límite|reached)\b/i.test(json.error || ""))) {
    markRawgQuotaExhausted();
    return null;
  }
  return json;
}

// ============================================================
// Circuit breaker para IGDB — fallback gratuito cuando RAWG agota su cupo.
// IGDB (Internet Game Database, propiedad de Twitch/Amazon) no tiene cupo
// mensual: solo límite de 4 req/seg, muy superior a los 20k req/mes de RAWG.
// Requiere IGDB_CLIENT_ID + IGDB_CLIENT_SECRET en Vercel (dev.twitch.tv).
// ============================================================
const IGDB_COOLDOWN_MS = 60 * 60 * 1000; // 1h si IGDB falla temporalmente

function igdbUnavailable() {
  try {
    const until = Number(sessionStorage.getItem("igdb-until") || 0);
    if (!until) return false;
    if (Date.now() > until) { sessionStorage.removeItem("igdb-until"); return false; }
    return true;
  } catch { return false; }
}

function markIgdbUnavailable() {
  if (igdbUnavailable()) return;
  try { sessionStorage.setItem("igdb-until", String(Date.now() + IGDB_COOLDOWN_MS)); } catch {}
  console.warn("[IGDB] API temporalmente no disponible — pausa de 1h.");
}

async function igdbFetch(url) {
  if (igdbUnavailable()) return null;
  let r;
  try { r = await fetch(url); } catch { return null; }
  if (r.status === 401 || r.status === 429 || r.status === 503) { markIgdbUnavailable(); return null; }
  let json = null;
  try { json = await r.json(); } catch { return null; }
  if (json?.success === false && json?.quota) { markIgdbUnavailable(); return null; }
  return json;
}

// Obtiene la portada de IGDB para un título. Usa el mismo almacén de caché que RAWG.
async function fetchCoverFromIgdb(title) {
  const key = `igdb-cover:${matchKey(title)}`;
  let cover = readRawgCache(key);
  if (cover !== undefined) return cover || "";
  if (igdbUnavailable()) return "";
  const json = await igdbFetch(`/api/rawg?mode=igdb-search&q=${encodeURIComponent(cleanTitleForRawg(title))}`);
  cover = json?.games?.[0]?.imageUrl || "";
  writeRawgCache(key, cover);
  return cover;
}

// ============================================================
// Mejor carátula disponible como fallback (cuando PSN no resolvió la portada).
// Usa IGDB (cover_big_2x = 528×748, box art real, alta resolución).
// Si IGDB no responde o no tiene el juego, devuelve "".
async function fetchPortraitCover(title) {
  if (igdbUnavailable()) return "";
  return fetchCoverFromIgdb(title);
}


const RAWG_MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 días para misses (se reintenta más rápido)

function readRawgCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed?._ts) return undefined;
    const ttl = parsed.data?.miss ? RAWG_MISS_TTL_MS : RAWG_CACHE_TTL_MS;
    if (Date.now() - parsed._ts > ttl) {
      localStorage.removeItem(key);
      return undefined;
    }
    return parsed.data; // puede ser null (consulta hecha, sin resultado)
  } catch { return undefined; }
}

function writeRawgCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ _ts: Date.now(), data }));
  } catch {
    // localStorage lleno: liberá entradas viejas de rawg:
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("rawg:")) localStorage.removeItem(k);
      }
      localStorage.setItem(key, JSON.stringify({ _ts: Date.now(), data }));
    } catch { /* nada que hacer */ }
  }
}


// Index los juegos scrapeados por título normalizado para lookup O(1).
// Algunos juegos vienen con varios títulos (PS5/PS4 con sufijo); guardamos
// el mejor (con descuento si lo hay) bajo la misma clave.
function buildScrapedMatcher(list) {
  const map = new Map();
  for (const g of (list || [])) {
    const k = matchKey(g.title);
    if (!k) continue;
    const prev = map.get(k);
    if (!prev || (g.onSale && !prev.onSale)) map.set(k, g);
  }
  return map;
}

function matchKey(t) {
  return cleanTitleForRawg(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

// ============================================================
// Filtro AAA: heurística por precio + Metacritic cacheado de RAWG.
//   - Si RAWG marca el juego como "Indie" (g._rawgIndie), se oculta SIEMPRE
//     del catálogo curado, sin importar precio ni Metacritic. Es la señal
//     autoritativa que pidió el negocio para no mostrar juegos indie.
//   - Si tenemos veredicto de RAWG (g._rawgMeta), lo respetamos: >=70 es AAA.
//   - Si no, fallback por precio: $15+ base, o $25+ original si está en oferta.
// El veredicto de RAWG se va llenando en background a medida que el
// usuario navega — los juegos visibles se enriquecen primero.
// ============================================================
const AAA_PRICE_USD = 15;
const AAA_PRICE_ORIGINAL_USD = 20;
const AAA_META_THRESHOLD = 65;
const AAA_ENRICH_BATCH = 8;        // requests en paralelo
const AAA_ENRICH_DELAY_MS = 200;   // pausa entre batches

// ¿RAWG clasifica este resultado como Indie? RAWG expone "Indie" tanto en
// `genres` como en `tags`; con que aparezca en cualquiera ya lo tratamos como
// indie. Nombres normalizados a minúscula para comparar sin sorpresas.
function rawgHitIsIndie(hit) {
  if (!hit) return false;
  const names = [...(hit.genres || []), ...(hit.tags || [])]
    .map(s => String(s).toLowerCase().trim());
  return names.includes("indie");
}

// ¿Está este juego en la lista manual de exclusión (hidden-games.json)?
// Matchea por ID de PSN exacto o por título normalizado.
function isHiddenGame(g) {
  if (!g) return false;
  if (g.id && hiddenGames.ids.has(String(g.id))) return true;
  if (g.title && hiddenGames.titles.has(matchKey(g.title))) return true;
  return false;
}

function isAAA(g) {
  // Ofertas curadas a mano y catálogo curado de "más buscados" siempre se
  // muestran: son títulos elegidos por nosotros, no pasan por la heurística.
  if (g._manualPrices || g._featured) return true;

  // Títulos de la lista de prioridad del negocio: siempre AAA sin importar
  // precio ni datos de RAWG.
  if (priorityScore(g) < Infinity) return true;

  // RAWG marcó el juego explícitamente como Indie: lo ocultamos del catálogo
  // "Solo AAA" aunque tenga buen Metacritic o precio alto. Señal autoritativa.
  if (g._rawgIndie === true) return false;

  const meta = g._rawgMeta;
  // Veredicto positivo de RAWG: Metacritic alto = AAA, sin importar el precio.
  if (meta != null && meta >= AAA_META_THRESHOLD) return true;

  const current = Number(g.priceUSD) || 0;
  const original = Number(g.originalPriceUSD) || current;
  // Señal de precio: caro hoy, o caro antes de la oferta, = AAA.
  if (current >= AAA_PRICE_USD) return true;
  if (original >= AAA_PRICE_ORIGINAL_USD) return true;

  // Barato y RAWG YA confirmó que no llega al umbral: es indie/relleno.
  if (typeof meta === "number") return false;

  // Sin datos RAWG todavía: beneficio de la duda — se muestra ahora y
  // desaparece si el enriquecimiento en background lo confirma como indie.
  return true;
}

// Títulos destacados que siempre aparecen primeros en los catálogos de
// plataforma, en el orden en que están definidos aquí.
const PRIORITY_TITLES = [
  "Grand Theft Auto V",
  "Marvel's Spider-Man",
  "Marvel's Spider-Man 2",
  "God of War (2018)",
  "God of War Ragnarök",
  "Uncharted 4: A Thief's End",
  "Horizon Zero Dawn",
  "Horizon Forbidden West",
  "The Last of Us Remastered",
  "The Last of Us Part II",
  "Red Dead Redemption 2",
  "Ghost of Tsushima",
  "Gran Turismo 7",
  "Gran Turismo Sport",
  "Elden Ring",
  "The Witcher 3: Wild Hunt",
  "Call of Duty: Black Ops III",
  "Call of Duty: Modern Warfare",
  "Call of Duty: Modern Warfare II",
  "Call of Duty: Black Ops 6",
  "EA Sports FC 25",
  "EA Sports FC 26",
  "Monster Hunter: World",
  "Monster Hunter Wilds",
  "Assassin's Creed Odyssey",
  "Assassin's Creed Valhalla",
  "Assassin's Creed Shadows",
  "Resident Evil 4",
  "Resident Evil Village",
  "Resident Evil 2",
  "Final Fantasy VII Remake",
  "Final Fantasy VII Rebirth",
  "Final Fantasy XV",
  "Persona 5 Royal",
  "Kingdom Hearts III",
  "Dragon Ball FighterZ",
  "Dragon Ball Z: Kakarot",
  "Tekken 8",
  "Mortal Kombat 11",
  "Street Fighter 6",
  "Death Stranding",
  "Days Gone",
  "Bloodborne",
  "Ratchet & Clank: Rift Apart",
  "Demon's Souls",
  "Hogwarts Legacy",
  "Cyberpunk 2077",
  "Black Myth: Wukong",
];

function normTitleForPriority(t) {
  return (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

const _priorityMap = new Map(PRIORITY_TITLES.map((t, i) => [normTitleForPriority(t), i]));

// Devuelve la posición del juego en la lista de prioridad (menor = más arriba).
// Si no está en la lista devuelve Infinity.
function priorityScore(g) {
  const n = normTitleForPriority(g.title);
  if (_priorityMap.has(n)) return _priorityMap.get(n);
  // Coincidencia parcial: uno contiene al otro (maneja variaciones de subtítulo).
  // Se prefiere el overlap más largo para evitar falsos positivos.
  let best = Infinity;
  let bestLen = 0;
  for (const [pt, idx] of _priorityMap) {
    if (n.includes(pt) || pt.includes(n)) {
      const len = Math.min(n.length, pt.length);
      if (len > bestLen) { best = idx; bestLen = len; }
    }
  }
  return best;
}

// Levanta el cache de Metacritic para todos los juegos cargados, así
// las decisiones de isAAA() son consistentes desde el primer render.
function hydrateRawgMetaFromCache(games) {
  for (const g of games || []) {
    const key = matchKey(g.title);
    if (g._rawgMeta === undefined) {
      const cached = readRawgCache(`rawg-meta:${key}`);
      if (cached !== undefined) g._rawgMeta = cached; // puede quedar null = "no AAA según RAWG"
    }
    if (g._rawgIndie === undefined) {
      const cachedIndie = readRawgCache(`rawg-indie:${key}`);
      if (cachedIndie !== undefined) g._rawgIndie = cachedIndie;
    }
  }
}

let _enrichQueue = [];
let _enrichRunning = false;

// Encola juegos para que RAWG les asigne Metacritic y se decida bien si son
// AAA o indies. `priorityList` (lo que el usuario está viendo ahora, p. ej.
// la página de PS4) se enriquece PRIMERO: antes mandábamos solo `allGames` en
// orden global (por descuento), así que los juegos de la plataforma abierta
// casi nunca se enriquecían dentro del tope y la página quedaba sin refinar.
function scheduleAAAEnrichForVisible(priorityList) {
  if (!allGames?.length) return;

  const enqueue = (arr, toFront) => {
    // Al meter al frente, recorremos en reversa para preservar el orden.
    const items = toFront ? [...arr].reverse() : arr;
    for (const g of items) {
      if (!g || g._rawgMeta !== undefined) continue;
      if (_enrichQueue.includes(g)) continue;
      if (toFront) _enrichQueue.unshift(g);
      else _enrichQueue.push(g);
    }
  };

  // 1) Lo que se ve ahora, al frente de la cola.
  if (Array.isArray(priorityList) && priorityList.length) {
    enqueue(priorityList.slice(0, 200), true);
  }
  // 2) Relleno global — procesamos más juegos para poblar el cache más rápido.
  enqueue(allGames.filter(g => g._rawgMeta === undefined).slice(0, 150), false);

  if (!_enrichRunning) runEnrichLoop();
}

async function runEnrichLoop() {
  _enrichRunning = true;
  let changedSinceLastRender = false;
  while (_enrichQueue.length) {
    // Si RAWG está agotado pero IGDB está disponible, seguimos el loop vía IGDB.
    if (rawgQuotaExhausted() && igdbUnavailable()) { _enrichQueue.length = 0; break; }
    const batch = _enrichQueue.splice(0, AAA_ENRICH_BATCH);
    await Promise.all(batch.map(async (g) => {
      const key = matchKey(g.title);
      if (!key) { g._rawgMeta = null; return; }
      const cacheKey = `rawg-meta:${key}`;
      const indieCacheKey = `rawg-indie:${key}`;
      const cached = readRawgCache(cacheKey);
      const cachedIndie = readRawgCache(indieCacheKey);
      // Solo saltamos el fetch si YA tenemos ambas señales cacheadas. Si el
      // Metacritic venía de una corrida vieja (sin flag indie), refrescamos
      // para poblar también el indie — se auto-cura sin invalidar el cache.
      if (cached !== undefined && cachedIndie !== undefined) {
        g._rawgMeta = cached;
        g._rawgIndie = cachedIndie;
        return;
      }
      const json = await rawgFetch(`/api/rawg?mode=search&q=${encodeURIComponent(cleanTitleForRawg(g.title))}&page_size=1`);
      if (json === null) {
        // RAWG sin cupo: usar igdbScore como proxy de calidad para filtro AAA.
        // IGDB total_rating (0-100) es comparable a Metacritic para este fin.
        if (!igdbUnavailable()) {
          const igdbJson = await igdbFetch(`/api/rawg?mode=igdb-search&q=${encodeURIComponent(cleanTitleForRawg(g.title))}`);
          const igdbHit = igdbJson?.games?.[0];
          if (igdbHit) {
            const meta = igdbHit.igdbScore ?? null; // 0-100, mismo rango que Metacritic
            const indie = rawgHitIsIndie({ genres: igdbHit.genres || [], tags: [] });
            g._rawgMeta = meta;
            g._rawgIndie = indie;
            writeRawgCache(cacheKey, meta);
            writeRawgCache(indieCacheKey, indie);
            return;
          }
        }
        g._rawgMeta = null;
        return;
      }
      const hit = json?.games?.[0];
      const meta = hit?.metacritic ?? null;
      const indie = rawgHitIsIndie(hit);
      g._rawgMeta = meta;
      g._rawgIndie = indie;
      writeRawgCache(cacheKey, meta);
      writeRawgCache(indieCacheKey, indie);
    }));
    changedSinceLastRender = true;
    // Re-renderizar el grid si el usuario está en una vista filtrada
    // por AAA — sin esto, los borderline siguen tachados hasta que
    // navegue. applyFilters() es barato, mantiene scroll.
    if (changedSinceLastRender && localFilters.aaaOnly && document.getElementById("grid")) {
      applyFilters();
      changedSinceLastRender = false;
    }
    if (_enrichQueue.length) await new Promise(r => setTimeout(r, AAA_ENRICH_DELAY_MS));
  }
  _enrichRunning = false;
}

// ============================================================
// Switch / bundles Nintendo
// ============================================================

// Convierte "59.2gb" / "1.2 tb" / "850mb" a número en GB para ordenar.
function parseSizeGB(s) {
  if (!s) return 0;
  const m = String(s).toLowerCase().replace(/\s+/g, "").match(/([\d.,]+)\s*(tb|gb|mb|kb)?/);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(",", "."));
  if (!isFinite(n)) return 0;
  const unit = m[2] || "gb";
  if (unit === "tb") return n * 1024;
  if (unit === "mb") return n / 1024;
  if (unit === "kb") return n / (1024 * 1024);
  return n;
}

const nintendoFilters = { q: "", sort: "recent", limit: 60 };
const NINTENDO_PAGE_SIZE = 60;

function applyNintendoBundleFilters(allBundles) {
  const q = normalizeSearch(nintendoFilters.q);
  let list = allBundles;
  if (q) {
    list = list.filter(b => {
      if (normalizeSearch(b.id).includes(q)) return true;
      return (b.games || []).some(g => normalizeSearch(g.name || g.title).includes(q));
    });
  }
  const sorted = [...list];
  switch (nintendoFilters.sort) {
    case "price-asc":  sorted.sort((a, b) => (a.priceCRC || 0) - (b.priceCRC || 0)); break;
    case "price-desc": sorted.sort((a, b) => (b.priceCRC || 0) - (a.priceCRC || 0)); break;
    case "size-asc":   sorted.sort((a, b) => parseSizeGB(a.totalSize) - parseSizeGB(b.totalSize)); break;
    case "size-desc":  sorted.sort((a, b) => parseSizeGB(b.totalSize) - parseSizeGB(a.totalSize)); break;
    case "oldest":     sorted.sort((a, b) => (a.date || "").localeCompare(b.date || "")); break;
    case "recent":
    default:
      // Si tienen date la usamos; si no, respetamos el orden del array
      // (el scraper ya guarda newest-first al frente).
      sorted.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      break;
  }
  return sorted;
}

function renderNintendoBundleGrid() {
  const all = nintendo.bundles || [];
  const filtered = applyNintendoBundleFilters(all);
  const visible = filtered.slice(0, nintendoFilters.limit);
  const grid = document.getElementById("nin-bundles-grid");
  const meta = document.getElementById("nin-bundles-meta");
  const moreWrap = document.getElementById("nin-bundles-more-wrap");
  if (!grid) return;
  if (!visible.length) {
    grid.innerHTML = `<div class="status">No se encontraron bundles con ese criterio.</div>`;
  } else {
    grid.innerHTML = visible.map(b => bundleCardHTML(b, "nintendo")).join("");
  }
  if (meta) {
    meta.textContent = filtered.length === all.length
      ? `Mostrando ${visible.length} de ${all.length} bundles.`
      : `Mostrando ${visible.length} de ${filtered.length} resultados (${all.length} totales).`;
  }
  if (moreWrap) {
    moreWrap.style.display = visible.length < filtered.length ? "" : "none";
  }
}

async function renderSwitch() {
  setPageMeta("Nintendo Switch | Rey Midas Digitales",
    "Bundles de Nintendo Switch en Costa Rica. Pago con SINPE Móvil. Entrega por WhatsApp.");
  // nintendo-bundles.json (~2.9 MB) se carga AQUI, no en el arranque. Mostramos el
  // shell con un loader mientras baja la primera vez.
  if (!nintendo.bundles.length) {
    app.innerHTML = `
      ${heroSlimHTML("Nintendo Switch")}
      <section class="container catalog-section">
        <div class="section-title"><h2>Bundles Nintendo Switch</h2></div>
        <div class="status">Cargando bundles...</div>
      </section>
    `;
    await ensureNintendo();
    const r = parseRoute();
    if (!(r.name === "platform" && r.platform === "Switch")) return;
  }
  const bundles = nintendo.bundles || [];
  nintendoFilters.q = "";
  nintendoFilters.sort = "recent";
  nintendoFilters.limit = NINTENDO_PAGE_SIZE;
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
        <div class="bundles-toolbar">
          <input id="nin-search" type="search" placeholder="Buscar por juego o ID..." autocomplete="off">
          <select id="nin-sort">
            <option value="recent">Más recientes</option>
            <option value="oldest">Más antiguos</option>
            <option value="price-asc">Precio: menor a mayor</option>
            <option value="price-desc">Precio: mayor a menor</option>
            <option value="size-asc">Tamaño: menor a mayor</option>
            <option value="size-desc">Tamaño: mayor a menor</option>
          </select>
        </div>
        <div id="nin-bundles-meta" class="bundles-meta"></div>
        <div id="nin-bundles-grid" class="grid bundles"></div>
        <div id="nin-bundles-more-wrap" class="bundles-more-wrap" style="display:none">
          <button id="nin-bundles-more" type="button" class="cta">Cargar más</button>
        </div>
      ` : `
        <div class="status">Aún no hay bundles publicados. Mientras tanto pasate por nuestro canal de Telegram.</div>
      `}
    </section>
  `;
  if (!bundles.length) return;

  const search = document.getElementById("nin-search");
  let debounce;
  search.addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      nintendoFilters.q = e.target.value.trim();
      nintendoFilters.limit = NINTENDO_PAGE_SIZE;
      renderNintendoBundleGrid();
    }, 150);
  });
  document.getElementById("nin-sort").addEventListener("change", (e) => {
    nintendoFilters.sort = e.target.value;
    nintendoFilters.limit = NINTENDO_PAGE_SIZE;
    renderNintendoBundleGrid();
  });
  document.getElementById("nin-bundles-more").addEventListener("click", () => {
    nintendoFilters.limit += NINTENDO_PAGE_SIZE;
    renderNintendoBundleGrid();
  });
  renderNintendoBundleGrid();
}

function renderBundlesList(platform) {
  const cfg = {
    PS: { source: psBundles, title: "Bundles PlayStation", subtitle: "Bundles de PS5/PS4 con varios juegos por un solo precio.", type: "ps" },
    Xbox: { source: xboxBundles, title: "Bundles Xbox", subtitle: "Bundles de Xbox con varios juegos por un solo precio.", type: "xbox" },
  }[platform];
  setPageMeta(`Bundles ${platform || ""} | Rey Midas Digitales`,
    `Bundles de juegos digitales ${platform || ""} en Costa Rica. Varios juegos a un solo precio.`);
  if (!cfg) {
    app.innerHTML = `<section class="container empty-state"><h2>Plataforma no encontrada</h2><a class="cta" href="/">Inicio</a></section>`;
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

// Normaliza un string para búsqueda: minúsculas + sin tildes.
// Así "acción", "ACCIÓN" y "accion" matchean igual.
function normalizeSearch(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Matchea un juego contra un texto: busca en título y en los géneros
// que el scraper le asignó (acción, terror, shooter, etc).
function gameMatchesQuery(g, q) {
  if (!q) return true;
  const nq = normalizeSearch(q);
  if (normalizeSearch(g.title).includes(nq)) return true;
  if (Array.isArray(g.genres) && g.genres.some(genre => normalizeSearch(genre).includes(nq))) return true;
  return false;
}

function renderBusqueda(term, page = 1) {
  setPageMeta(`Búsqueda: ${term} | Rey Midas Digitales`);
  const list = (allGames || []).filter(g => gameMatchesQuery(g, term));
  app.innerHTML = `
    ${heroSlimHTML(`Resultados para "${term}"`)}
    <section class="container catalog-section">
      <div class="section-title">
        <h2>${list.length} ${list.length === 1 ? "resultado" : "resultados"} para "${escapeHtml(term)}"</h2>
        ${list.length === 0 ? `<p>Probá con otro nombre o consultanos por WhatsApp por ese título específico.</p>` : `<p>Tocá un juego para ver el detalle.</p>`}
      </div>
      ${toolbarHTML(false)}
      <div id="grid" class="grid"></div>
      <div id="pagination" class="pagination"></div>
    </section>
  `;
  mountToolbar(list, page, `/buscar/${encodeURIComponent(term)}`, false);
}

// Catálogo filtrado por género (categoría). Mismo comportamiento que la
// página de plataforma: arranca con el filtro "Solo AAA" activo (indies
// ocultos) y deja las tarjetas de plataforma/oferta para refinar.
function renderCategoria(genre, page = 1) {
  const label = GENRE_LABELS[genre] || (genre ? genre[0].toUpperCase() + genre.slice(1) : "Categoría");
  setPageMeta(`${label} — Juegos en Costa Rica | Rey Midas Digitales`,
    `Juegos de ${label} para PS5, PS4 y Xbox en Costa Rica. Entrega por WhatsApp.`);
  const list = (allGames || []).filter(g => Array.isArray(g.genres) && g.genres.includes(genre));
  app.innerHTML = `
    ${heroSlimHTML(label)}
    ${categoryCardsHTML(genre)}
    <section class="container catalog-section">
      <div class="section-title">
        <h2>${escapeHtml(label)}</h2>
        <p>${list.length} ${list.length === 1 ? "juego en esta categoría" : "juegos en esta categoría"}.</p>
      </div>
      ${toolbarHTML(true)}
      <div id="grid" class="grid"></div>
      <div id="pagination" class="pagination"></div>
    </section>
  `;
  mountToolbar(list, page, `/categoria/${encodeURIComponent(genre)}`, true);
}

function renderOfertas(page = 1) {
  setPageMeta("Ofertas y descuentos | Rey Midas Digitales",
    "Los mejores descuentos en juegos PS5, PS4, Xbox y Switch en Costa Rica. Actualizados diariamente.");
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
  mountToolbar(list, page, "/ofertas", false);
}

// ============================================================
// Suscripciones (PS Plus / Game Pass)
// ============================================================
function renderSubscriptions(service) {
  const serviceTitle = service === "psplus" ? "PlayStation Plus" : service === "gamepass" ? "Xbox Game Pass" : "Suscripciones";
  setPageMeta(`${serviceTitle} en Costa Rica | Rey Midas Digitales`,
    `Comprá ${serviceTitle} en Costa Rica. Pago con SINPE Móvil. Entrega inmediata por WhatsApp.`);
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
    app.innerHTML = `<section class="container empty-state"><h2>Servicio no encontrado</h2><a class="cta" href="/">Inicio</a></section>`;
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
  setPageMeta("Reservaciones y preventas | Rey Midas Digitales",
    "Reservá tus juegos antes del lanzamiento en Costa Rica. Asegurá tu copia desde el día 1.");
  // Reservas manuales curadas (reservaciones.json, con señal/depósito) + TODOS
  // los juegos del catálogo que todavía no salieron a la venta (comingSoon =
  // releaseDate futuro). Deduplicamos por título para no repetir un mismo juego.
  const manual = reservaciones || [];
  const manualKeys = new Set(manual.map(r => matchKey(r.title)));
  const preorders = (allGames || [])
    .filter(g => (g.comingSoon || (Array.isArray(g.genres) && g.genres.includes("preventa"))) && !manualKeys.has(matchKey(g.title)))
    .sort((a, b) => String(a.releaseDate || "9999-99-99").localeCompare(String(b.releaseDate || "9999-99-99")));
  // Una sola lista: las reservas curadas (con señal) primero, y a continuación
  // los próximos lanzamientos del catálogo. Todo como tarjetas uniformes.
  const total = manual.length + preorders.length;
  const hasAny = total > 0;
  app.innerHTML = `
    ${heroSlimHTML("Reservaciones")}
    <section class="container catalog-section">
      <div class="section-title centered">
        <h2>Reservá tus juegos antes del lanzamiento</h2>
        <p>Asegurate tu copia desde el día 1. Pagás una señal y completás cuando se lanza.</p>
      </div>
      ${hasAny ? `
        <div class="section-title centered" style="margin-top:1.5rem">
          <h2>Próximos lanzamientos en preventa</h2>
          <p>${total} ${total === 1 ? "título que todavía no salió" : "títulos que todavía no salieron"} a la venta. Reservá hoy y aseguralo.</p>
        </div>
        <div class="grid">
          ${manual.map(reservaCardHTML).join("")}
          ${preorders.map(preorderCardHTML).join("")}
        </div>
      ` : `
        <div class="empty-purchases">
          <p>Por ahora no tenemos reservas abiertas. Pronto vamos a sumar los próximos lanzamientos.</p>
          <a class="cta cta-wa" href="https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Hola, quiero saber qué reservas tienen abiertas.")}" target="_blank" rel="noopener">Consultar por WhatsApp</a>
        </div>
      `}
    </section>
  `;
  // Si alguna reservación manual no tiene portada, la buscamos (cacheada) y la
  // inyectamos en la tarjeta sin re-renderizar.
  enrichReservaCovers();
}

// Tarjeta compacta de una reserva manual (reservaciones.json). Igual de uniforme
// que las preventas del catálogo; al hacer clic abre la ficha /reserva/<id> con
// precios, señal y el botón de Reservar por WhatsApp.
function reservaCardHTML(r) {
  const img = r.imageUrl
    ? `<img src="${escapeAttr(r.imageUrl)}" alt="${escapeAttr(r.title)}" loading="lazy">`
    : `${placeholderHTML()}`;
  const facets = [];
  if (r.releaseDate) {
    const d = new Date(r.releaseDate + "T00:00:00");
    const txt = isNaN(d.getTime()) ? r.releaseDate : d.toLocaleDateString("es-CR", { year: "numeric", month: "long", day: "numeric" });
    facets.push(`<span class="facet facet-date">Disponible el ${escapeHtml(txt)}</span>`);
  }
  return `
    <a class="card reserva-card" data-reserva-id="${escapeAttr(String(r.id || r.title))}" href="/reserva/${encodeURIComponent(r.id || matchKey(r.title))}">
      <div class="card-image">
        ${img}
        <span class="badge-preventa">Preventa</span>
        <span class="badge-platform">${escapeHtml(r.platform)}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(r.title)}</div>
        ${facets.length ? `<div class="product-facets">${facets.join("")}</div>` : ""}
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
      </div>
    </a>
  `;
}

// Ficha completa de una reserva manual. Se abre desde la tarjeta (/reserva/<id>)
// y muestra portada grande, precios, señal y el botón de Reservar por WhatsApp.
function renderReserva(id) {
  if (!loaded) {
    app.innerHTML = `<section class="container empty-state"><p>Cargando reserva...</p></section>`;
    return;
  }
  const list = reservaciones || [];
  const r = list.find(x => String(x.id) === String(id)) || list.find(x => matchKey(x.title) === String(id));
  if (!r) {
    app.innerHTML = `
      <section class="container empty-state">
        <h2>Reserva no encontrada</h2>
        <p>Esta reserva ya no está disponible.</p>
        <a class="cta" href="/reservaciones">Ver reservaciones</a>
      </section>
    `;
    return;
  }
  const release = r.releaseDate
    ? new Date(r.releaseDate + "T00:00:00").toLocaleDateString("es-CR", { year: "numeric", month: "long", day: "numeric" })
    : "Por anunciar";
  const img = r.imageUrl
    ? `<img src="${escapeAttr(r.imageUrl)}" alt="${escapeAttr(r.title)}" loading="lazy">`
    : `${placeholderHTML()}`;
  const waMsg = encodeURIComponent(`Hola, quiero reservar ${r.title} (${r.platform}). Confirmen disponibilidad y el monto de la señal, gracias.`);
  app.innerHTML = `
    <section class="container product-page">
      <nav class="breadcrumb" aria-label="Migas de pan">
        <a href="/">Inicio</a>
        <span class="breadcrumb-sep">›</span>
        <a href="/reservaciones">Reservaciones</a>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">${escapeHtml(r.title)}</span>
      </nav>
      <div class="product-grid">
        <div class="product-image" data-reserva-id="${escapeAttr(String(r.id || r.title))}">
          ${img}
          <span class="badge-preventa">Preventa</span>
        </div>
        <div class="product-info">
          <span class="badge-platform">${escapeHtml(r.platform)}</span>
          <h1 class="product-title">${escapeHtml(r.title)}</h1>
          <div class="reserva-meta">
            <span>Lanzamiento</span>
            <strong>${escapeHtml(release)}</strong>
          </div>
          ${r.description ? `<p class="product-desc">${escapeHtml(r.description)}</p>` : ""}
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
      </div>
    </section>
  `;
  enrichReservaCovers();
}

// Card de un juego en preventa del catálogo (comingSoon). Muestra los labels
// (Preventa, plataforma) y los tags (tipo/edición, fecha de lanzamiento y
// géneros), y enlaza a la ficha del producto. Reutiliza el CSS de .card/.facet.
function preorderCardHTML(g) {
  const principal = g._manualPrices ? g.priceCRC_principal : principalCRC(g.priceUSD, g.platform);
  const secundaria = g._manualPrices ? g.priceCRC_secundaria : secundariaCRC(g.priceUSD, g.platform);
  const img = g.imageUrl
    ? `<img src="${escapeAttr(g.imageUrl)}" alt="${escapeAttr(g.title)}" loading="lazy">`
    : `${placeholderHTML()}`;
  const facets = [];
  const TYPE_LABEL = { edition: "Edición especial", bundle: "Bundle" };
  if (TYPE_LABEL[g.type]) facets.push(`<span class="facet facet-type">${TYPE_LABEL[g.type]}</span>`);
  if (g.releaseDate) {
    const d = new Date(g.releaseDate + "T00:00:00");
    const txt = isNaN(d.getTime()) ? g.releaseDate : d.toLocaleDateString("es-CR", { year: "numeric", month: "long", day: "numeric" });
    facets.push(`<span class="facet facet-date">Disponible el ${escapeHtml(txt)}</span>`);
  }
  // Géneros reales como tags (excluye las pseudo-facetas preventa/estreno/edicion).
  const PSEUDO = ["preventa", "estreno", "edicion"];
  for (const t of (g.genres || [])) {
    if (GENRE_LABELS[t] && !PSEUDO.includes(t) && facets.length < 6) {
      facets.push(`<span class="facet">${escapeHtml(GENRE_LABELS[t])}</span>`);
    }
  }
  return `
    <a class="card" href="/producto/${encodeURIComponent(g.id)}">
      <div class="card-image">
        ${img}
        <span class="badge-preventa">Preventa</span>
        <span class="badge-platform">${escapeHtml(g.platform)}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(g.title)}</div>
        ${facets.length ? `<div class="product-facets">${facets.join("")}</div>` : ""}
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

function bundleCardHTML(b, type = "nintendo") {
  const routes = { nintendo: "nintendo", ps: "ps-bundle", xbox: "xbox-bundle" };
  const badges = { nintendo: "Switch", ps: "PlayStation", xbox: "Xbox" };
  const cover = b.coverUrl
    ? `<img src="${escapeAttr(b.coverUrl)}" alt="${escapeAttr(b.id)}" loading="lazy">`
    : `${placeholderHTML()}`;
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
    <a class="card bundle-card" href="/${routes[type]}/${encodeURIComponent(b.id)}">
      <div class="card-image">
        ${cover}
        <span class="badge-platform">${badges[type]}</span>
        ${b.discountPct ? `<span class="badge-discount">−${b.discountPct}%</span>` : ""}
      </div>
      <div class="card-body">
        <div class="card-title">${b.title ? escapeHtml(b.title) : `Bundle ${escapeHtml(b.id)}`}</div>
        ${b.discountPct ? `<div class="card-offer">Ahorra un ${b.discountPct}%</div>` : ""}
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

async function renderBundle(id, type = "nintendo") {
  if (!loaded) {
    app.innerHTML = `<section class="container empty-state"><p>Cargando bundle...</p></section>`;
    return;
  }
  // Los bundles de Nintendo se bajan bajo demanda (ver ensureNintendo).
  if (type === "nintendo" && !nintendo.bundles.length) {
    app.innerHTML = `<section class="container empty-state"><p>Cargando bundle...</p></section>`;
    await ensureNintendo();
    const r = parseRoute();
    if (!(r.name === "bundle" && String(r.id) === String(id))) return;
  }
  const sources = {
    nintendo: { list: nintendo.bundles || [], platform: "Nintendo Switch", backHref: "/plataforma/Switch", telegram: nintendo.telegramChannel },
    ps: { list: psBundles.bundles || [], platform: "PlayStation", backHref: "/bundles/PS", telegram: psBundles.telegramChannel },
    xbox: { list: xboxBundles.bundles || [], platform: "Xbox", backHref: "/bundles/Xbox", telegram: xboxBundles.telegramChannel },
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
    : `${placeholderHTML()}`;

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
        <div class="product-image">
          ${cover}
          ${b.discountPct ? `<span class="badge-discount badge-discount-lg">−${b.discountPct}%</span>` : ""}
        </div>
        <div class="product-info">
          <span class="product-platform">${escapeHtml(src.platform)}</span>
          <h1>${b.title ? escapeHtml(b.title) : `Bundle ${escapeHtml(b.id)}`}</h1>
          <p class="product-desc">Cuenta ${escapeHtml(src.platform)} con los siguientes juegos preinstalados. Total: ${b.games?.length || 0} juegos${b.totalSize ? ` &middot; ${escapeHtml(b.totalSize)}` : ""}.</p>

          ${b.discountPct ? `
            <div class="bundle-offer">
              <span class="bundle-offer-pct">🔥 Ahorra un ${b.discountPct}%</span>
              <span class="bundle-offer-note">Oferta por tiempo limitado y única</span>
            </div>
          ` : ""}

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
  setPageMeta("Carrito | Rey Midas Digitales");
  const items = loadCart();
  if (!items.length) {
    app.innerHTML = `
      <section class="container empty-state">
        <h2>Tu carrito está vacío</h2>
        <p>Agregá juegos desde el catálogo y los pedís todos juntos por WhatsApp.</p>
        <a class="cta" href="/">Ir al catálogo</a>
      </section>
    `;
    return;
  }
  const subtotal = items.reduce((s, i) => s + i.priceCRC, 0);
  const code = getDiscountCode();
  const discountPct = code ? 0.10 : 0;
  const discountAmount = Math.round(subtotal * discountPct);
  const total = subtotal - discountAmount;
  app.innerHTML = `
    <section class="container cart-page">
      <a class="back-link" href="/">&larr; Seguir comprando</a>
      <h1 class="cart-title">Tu pedido</h1>
      <div class="cart-list">
        ${items.map(cartItemHTML).join("")}
      </div>
      <div class="cart-summary">
        ${code ? `
          <div class="cart-row discount">
            <span class="cart-discount-label">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/></svg>
              Código <code>${escapeHtml(code)}</code> aplicado
              <button id="removeCodeBtn" class="cart-remove-code" aria-label="Quitar código">×</button>
            </span>
            <span class="cart-discount-amount">−${formatCRC(discountAmount)}</span>
          </div>
          <div class="cart-row">
            <span>Subtotal</span>
            <span>${formatCRC(subtotal)}</span>
          </div>
        ` : `
          <details class="cart-code-input">
            <summary>¿Tenés un código de descuento?</summary>
            <form id="applyCodeForm">
              <input type="text" name="code" placeholder="BIENVENIDA-XXXX" autocomplete="off">
              <button type="submit">Aplicar</button>
            </form>
            <p class="cart-code-hint">¿Aún no tenés código? <a href="#" id="openPopupFromCart">Suscribite y obtené 10% OFF</a></p>
          </details>
        `}
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
    : `${placeholderHTML()}`;
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
  const removeCodeBtn = document.getElementById("removeCodeBtn");
  if (removeCodeBtn) removeCodeBtn.addEventListener("click", () => {
    localStorage.removeItem(DISCOUNT_KEY);
    renderCart();
  });
  const applyCodeForm = document.getElementById("applyCodeForm");
  if (applyCodeForm) applyCodeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = e.target.querySelector("input").value.trim().toUpperCase();
    if (!code) return;
    localStorage.setItem(DISCOUNT_KEY, code);
    showToast(`Código ${code} aplicado ✓`, "success");
    renderCart();
  });
  const openPopupBtn = document.getElementById("openPopupFromCart");
  if (openPopupBtn) openPopupBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openDiscountPopup();
  });
}

function checkout() {
  const items = loadCart();
  if (!items.length) return;
  const subtotal = items.reduce((s, i) => s + i.priceCRC, 0);
  const code = getDiscountCode();
  const discount = code ? Math.round(subtotal * 0.10) : 0;
  const total = subtotal - discount;
  const lines = items.map((i, idx) =>
    `${idx + 1}. ${i.title} (${i.platform}) — ${i.modality === "principal" ? "CUENTA PRINCIPAL" : "CUENTA SECUNDARIA"} — ${formatCRC(i.priceCRC)}`
  );
  const msg = [
    "Hola Rey Midas, quiero pedir lo siguiente:",
    "",
    ...lines,
    "",
    `Subtotal: ${formatCRC(subtotal)}`,
    ...(code ? [`Código de descuento: ${code} (−${formatCRC(discount)})`] : []),
    `*Total: ${formatCRC(total)}*`,
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
    app.innerHTML = `<section class="container empty-state"><h2>Página no encontrada</h2><a class="cta" href="/">Volver al inicio</a></section>`;
    return;
  }
  setPageMeta(`${p.title} | Rey Midas Digitales`);
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
        <p class="info-note"><span class="info-note-icon">${ICONS.warning}</span><strong>Importante:</strong> los juegos del bundle se juegan SOLO con ese usuario de la Switch. Si entrás con otro perfil no los vas a ver. Mantené el usuario de la cuenta que te dimos siempre disponible.</p>
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
        <a class="cta" href="/plataforma/PS5">Ver catálogo</a>
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
          <button class="hero-arrow prev" aria-label="Anterior">${ICONS.chevronLeft}</button>
          <button class="hero-arrow next" aria-label="Siguiente">${ICONS.chevronRight}</button>
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
        <img src="/assets/logo.png?v=2" alt="Rey Midas Digitales" class="logo">
        <p class="tagline">Tu tienda de juegos digitales en Costa Rica</p>
        <a class="cta" href="/plataforma/PS5">Ver juegos PS5</a>
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
  function pause() { clearInterval(timer); }
  slider.querySelector(".prev")?.addEventListener("click", () => { go(current - 1); autoplay(); });
  slider.querySelector(".next")?.addEventListener("click", () => { go(current + 1); autoplay(); });
  dots.forEach(d => d.addEventListener("click", () => { go(parseInt(d.dataset.go, 10)); autoplay(); }));
  // Pause on hover (desktop)
  slider.addEventListener("mouseenter", pause);
  slider.addEventListener("mouseleave", autoplay);
  // Pause cuando la pestaña está oculta para no gastar batería
  document.addEventListener("visibilitychange", () => {
    document.hidden ? pause() : autoplay();
  });
  autoplay();
}

function trustBarHTML() {
  return `
    <section class="trust-bar">
      <div class="container trust-bar-inner">
        <div class="trust-item">
          <span class="trust-icon">${ICONS.zap}</span>
          <div><strong>Entrega inmediata</strong><span>en menos de 10 min</span></div>
        </div>
        <div class="trust-item">
          <span class="trust-icon">${ICONS.shield}</span>
          <div><strong>Garantía real</strong><span>respaldamos cada cuenta</span></div>
        </div>
        <div class="trust-item">
          <span class="trust-icon">${ICONS.card}</span>
          <div><strong>Pago fácil</strong><span>SINPE · Transferencia</span></div>
        </div>
        <div class="trust-item">
          <span class="trust-icon">${ICONS.chat}</span>
          <div><strong>Soporte 24/7</strong><span>por WhatsApp</span></div>
        </div>
      </div>
    </section>
  `;
}

function testimonialsHTML(limit = 6) {
  if (!testimonials.length) return "";
  const items = limit ? testimonials.slice(0, limit) : testimonials;
  return `
    <section class="testimonials-section">
      <div class="container">
        <div class="section-title centered">
          <h2>Lo que dicen nuestros clientes</h2>
          <p>${escapeHtml(reviewStats.totalClients)} clientes en Costa Rica nos confían sus compras de juegos digitales.</p>
        </div>
        ${reviewsStatsBarHTML()}
        <div class="testimonials-grid">
          ${items.map(testimonialCardHTML).join("")}
        </div>
        ${limit && testimonials.length > limit ? `
          <div class="testimonials-more">
            <a class="cta-secondary" href="/resenas">Ver todas las reseñas (${testimonials.length})</a>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function testimonialCardHTML(t) {
  const stars = `${"★".repeat(t.rating || 5)}${"☆".repeat(5 - (t.rating || 5))}`;
  const sourceBadge = t.source ? `<span class="testimonial-source">${escapeHtml(t.source)}</span>` : "";
  const dateStr = t.date ? new Date(t.date + "T00:00:00").toLocaleDateString("es-CR", { year: "numeric", month: "short" }) : "";
  return `
    <article class="testimonial-card">
      <div class="testimonial-head">
        <div class="testimonial-stars">${stars}</div>
        ${sourceBadge}
      </div>
      <p class="testimonial-text">"${escapeHtml(t.text)}"</p>
      <div class="testimonial-author">
        <strong>${escapeHtml(t.name)}</strong>
        <span>${escapeHtml(t.platform)}${dateStr ? ` · ${dateStr}` : ""}</span>
      </div>
    </article>
  `;
}

function reviewsStatsBarHTML() {
  const rating = reviewStats.averageRating || 0;
  const stars = Math.round(rating);
  return `
    <div class="reviews-stats-bar">
      <div class="rsb-rating">
        <span class="rsb-num">${rating.toFixed(1)}</span>
        <div class="rsb-stars">${"★".repeat(stars)}${"☆".repeat(5 - stars)}</div>
        <span class="rsb-total">${reviewStats.totalReviews}+ reseñas</span>
      </div>
      <div class="rsb-stat"><strong>${escapeHtml(reviewStats.totalClients)}</strong><span>Clientes felices</span></div>
      <div class="rsb-stat"><strong>${escapeHtml(reviewStats.yearsInBusiness)} años</strong><span>En el mercado</span></div>
      <div class="rsb-stat"><strong>< 10 min</strong><span>Entrega promedio</span></div>
    </div>
  `;
}

// ============================================================
// Sección Cyber Stats — Homepage únicamente
// ============================================================
function cyberStatsHTML() {
  const byPlatform = { PS5: 0, PS4: 0, Xbox: 0, Switch: 0 };
  for (const g of allGames) {
    if (g.platform?.includes("PS5"))  byPlatform.PS5++;
    if (g.platform?.includes("PS4"))  byPlatform.PS4++;
    if (g.platform?.includes("Xbox")) byPlatform.Xbox++;
  }
  // Nintendo Switch: contar títulos únicos de los bundles de Telegram
  const switchTitles = new Set();
  for (const b of (nintendo.bundles || [])) {
    for (const g of (b.games || [])) {
      if (g.name) switchTitles.add(g.name.toLowerCase().trim());
    }
  }
  byPlatform.Switch = switchTitles.size;

  const totalGames = allGames.length + byPlatform.Switch;
  const maxCount = Math.max(1, ...Object.values(byPlatform));

  const platforms = [
    { label: "PS5",    key: "PS5",    clr: "#0070d1" },
    { label: "PS4",    key: "PS4",    clr: "#003791" },
    { label: "XBOX",   key: "Xbox",   clr: "#52b043" },
    { label: "SWITCH", key: "Switch", clr: "#e4000f" },
  ];
  const barsHTML = platforms.map(({ label, key, clr }) => {
    const count = byPlatform[key] || 0;
    const pct = Math.round((count / maxCount) * 100);
    return `
      <div class="cyber-bar-row">
        <span class="cyber-bar-label">${label}</span>
        <div class="cyber-bar-track">
          <div class="cyber-bar-fill" style="--pct:${pct}%;--clr:${clr}"></div>
        </div>
        <span class="cyber-bar-value">${count > 0 ? count.toLocaleString("es") : "—"}</span>
      </div>`;
  }).join("");

  // Fecha de lanzamiento del sitio — actualizar si es necesario
  const launchDate = new Date("2024-06-01");
  const daysOnline = Math.max(0, Math.floor((Date.now() - launchDate) / 86400000));
  const clients = parseInt(reviewStats.totalClients) || 500;
  const rating  = reviewStats.averageRating || 4.9;

  return `
    <section class="cyber-stats-section" id="cyberStats">
      <div class="container">
        <div class="cyber-header">
          <div class="cyber-tag">// SISTEMA_ACTIVO :: DIAGNÓSTICO EN VIVO</div>
          <h2 class="cyber-title">
            <span class="cyber-title-glitch">REY MIDAS</span>
            <span class="cyber-accent"> STATS</span>
          </h2>
          <p class="cyber-subtitle">REYMIDASCR.COM &nbsp;::&nbsp; FEED EN TIEMPO REAL</p>
        </div>

        <div class="cyber-counters-grid">
          <div class="cyber-counter-card">
            <span class="cyber-counter-icon">◈</span>
            <span class="cyber-counter-num" data-target="${clients}">0</span>
            <span class="cyber-counter-label">Clientes felices</span>
          </div>
          <div class="cyber-counter-card">
            <span class="cyber-counter-icon">◈</span>
            <span class="cyber-counter-num" data-target="${totalGames || 500}">0</span>
            <span class="cyber-counter-label">Títulos en catálogo</span>
          </div>
          <div class="cyber-counter-card">
            <span class="cyber-counter-icon">◈</span>
            <span class="cyber-counter-num" data-target="${daysOnline}">0</span>
            <span class="cyber-counter-label">Días en línea</span>
          </div>
          <div class="cyber-counter-card">
            <span class="cyber-counter-icon">◈</span>
            <span class="cyber-counter-num" data-target="${rating}" data-float="true">${rating.toFixed(1)}</span>
            <span class="cyber-counter-label">Rating promedio</span>
          </div>
        </div>

        <div class="cyber-chart-panel">
          <div class="cyber-chart-title">
            <span>◈ DISTRIBUCIÓN DE CATÁLOGO POR PLATAFORMA</span>
            <span class="cyber-total-badge">${totalGames.toLocaleString("es")} JUEGOS</span>
          </div>
          <div class="cyber-bars">${barsHTML}</div>
        </div>

        <div class="cyber-traffic-panel">
          <div class="cyber-chart-title">
            <span>◈ TRÁFICO DEL SITIO</span>
            <span class="cyber-live-badge"><span class="cyber-live-dot-anim"></span>EN VIVO</span>
          </div>
          <div class="cyber-traffic-grid">
            <div class="cyber-traffic-stat">
              <span class="cyber-traffic-num" id="cyberStatToday">—</span>
              <span class="cyber-traffic-label">Visitas hoy</span>
            </div>
            <div class="cyber-traffic-stat">
              <span class="cyber-traffic-num" id="cyberStatTotal">—</span>
              <span class="cyber-traffic-label">Total histórico</span>
            </div>
            <div class="cyber-traffic-stat">
              <span class="cyber-traffic-num" id="cyberStatOnline">—</span>
              <span class="cyber-traffic-label">En línea ahora</span>
            </div>
          </div>
        </div>

        <div class="cyber-footer-row">
          <div class="cyber-status-dot"></div>
          <span>SISTEMA OPERATIVO &nbsp;::&nbsp; CATÁLOGO ACTUALIZADO DIARIAMENTE</span>
          <div class="cyber-status-dot"></div>
        </div>
      </div>
    </section>`;
}

function mountCyberStats() {
  const section = document.getElementById("cyberStats");
  if (!section) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);

      // Animar contadores
      entry.target.querySelectorAll("[data-target]").forEach(el => {
        const isFloat = el.dataset.float === "true";
        const target  = parseFloat(el.dataset.target);
        const duration = 1800;
        const start   = performance.now();
        const tick = now => {
          const p     = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          const val   = eased * target;
          el.textContent = isFloat
            ? val.toFixed(1)
            : Math.floor(val).toLocaleString("es");
          if (p < 1) requestAnimationFrame(tick);
          else el.textContent = isFloat
            ? target.toFixed(1)
            : Math.round(target).toLocaleString("es");
        };
        requestAnimationFrame(tick);
      });

      // Animar barras con un pequeño delay
      setTimeout(() => {
        entry.target.querySelectorAll(".cyber-bar-fill")
          .forEach(bar => bar.classList.add("cyber-bar-animated"));
      }, 200);

      // Cargar datos de tráfico en vivo desde la API
      fetch("/api/analytics")
        .then(r => r.json())
        .then(stats => {
          const elToday  = document.getElementById("cyberStatToday");
          const elTotal  = document.getElementById("cyberStatTotal");
          const elOnline = document.getElementById("cyberStatOnline");
          if (elToday)  elToday.textContent  = (stats.today  || 0).toLocaleString("es");
          if (elTotal)  elTotal.textContent  = (stats.total  || 0).toLocaleString("es");
          if (elOnline) {
            elOnline.textContent = String(stats.online || 0);
            if ((stats.online || 0) > 0) elOnline.classList.add("is-live");
          }
        })
        .catch(() => {});
    });
  }, { threshold: 0.15 });

  observer.observe(section);
}

// ============================================================
// Página completa de reseñas
// ============================================================
function renderResenas() {
  setPageMeta("Reseñas de clientes | Rey Midas Digitales",
    "Lee lo que opinan nuestros clientes sobre Rey Midas Digitales. Más de 100 compras verificadas en Costa Rica.");
  if (!testimonials.length) {
    app.innerHTML = `<section class="container empty-state"><h2>Sin reseñas todavía</h2><a class="cta" href="/">Volver al inicio</a></section>`;
    return;
  }
  const breakdown = [5, 4, 3, 2, 1].map(stars => {
    const count = testimonials.filter(t => (t.rating || 5) === stars).length;
    const pct = testimonials.length ? Math.round((count / testimonials.length) * 100) : 0;
    return { stars, count, pct };
  });
  app.innerHTML = `
    ${heroSlimHTML("Reseñas de clientes")}
    <section class="container resenas-page">
      <div class="resenas-header">
        <div class="resenas-summary">
          <div class="resenas-big-rating">
            <span class="big-num">${(reviewStats.averageRating || 0).toFixed(1)}</span>
            <div class="big-stars">${"★".repeat(Math.round(reviewStats.averageRating))}${"☆".repeat(5 - Math.round(reviewStats.averageRating))}</div>
            <span class="big-total">basado en ${reviewStats.totalReviews}+ reseñas</span>
          </div>
          <div class="resenas-breakdown">
            ${breakdown.map(b => `
              <div class="break-row">
                <span class="break-label">${b.stars}★</span>
                <div class="break-bar"><div class="break-bar-fill" style="width:${b.pct}%"></div></div>
                <span class="break-count">${b.count}</span>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="resenas-cta">
          <h3>¿Ya comprate con nosotros?</h3>
          <p>Compartí tu experiencia y ayudá a otros clientes a elegir con confianza.</p>
          <a class="cta cta-wa" href="https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Hola, quiero dejarles una reseña sobre mi compra.")}" target="_blank" rel="noopener">
            Dejar reseña por WhatsApp
          </a>
        </div>
      </div>

      <div class="testimonials-grid">
        ${testimonials.map(testimonialCardHTML).join("")}
      </div>
    </section>
  `;
}

function faqInlineHTML(limit) {
  if (!faqs.length) return "";
  const items = limit ? faqs.slice(0, limit) : faqs;
  if (!limit) {
    setPageMeta("Preguntas frecuentes | Rey Midas Digitales",
      "Respondemos las dudas más comunes sobre cómo comprar juegos digitales en Rey Midas Digitales.");
    setJsonLd({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqs.map(f => ({
        "@type": "Question",
        "name": f.q,
        "acceptedAnswer": { "@type": "Answer", "text": f.a }
      }))
    });
  }
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
            <a class="cta-secondary" href="/faq">Ver todas las preguntas</a>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function heroSlimHTML(platform) {
  const isPs4 = platform === 'PS4';
  const isPs5 = platform === 'PS5';
  const hasVideo = isPs4 || isPs5;
  const extraClass = isPs4 ? ' hero--ps4' : isPs5 ? ' hero--ps5' : '';
  const videoHTML = isPs4
    ? '<video class="ps4-arcade-video" autoplay muted loop playsinline><source src="/ps4-banner.mp4?v=20260606f" type="video/mp4"></video>'
    : isPs5
      ? '<video class="ps5-banner-video" autoplay muted loop playsinline><source src="/ps5-banner.mp4?v=20260606f" type="video/mp4"></video>'
      : '';
  return `
    <section class="hero slim${extraClass}">
      ${hasVideo ? '' : '<div class="hero-glow"></div>'}
      ${videoHTML}
      <div class="container hero-inner"${hasVideo ? ' style="display:none"' : ''}>
        <h1 class="slim-title">${escapeHtml(platform)}</h1>
      </div>
    </section>
  `;
}

function mountArcadeCanvas() {
  const canvas = document.getElementById('ps4-arcade-canvas');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Fallback estático
    canvas.style.background = 'linear-gradient(180deg,#030318 0%,#1a0640 60%,#3a0a6a 100%)';
    return;
  }
  const ctx = canvas.getContext('2d');
  const H = 170;
  let W = 0;
  function resize() { W = canvas.width = canvas.offsetWidth || 1280; canvas.height = H; }
  resize();
  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  const imgDragon = new Image(), imgKnight = new Image();
  imgDragon.src = '/dragon.webp?v=20260608a';
  imgKnight.src = '/knight.webp?v=20260608a';

  let t = 0, cloudOff = 0;
  let fire = [], embers = [];

  const HUD_H   = () => Math.round(H * 0.22);
  const GROUND  = () => Math.round(H * 0.84);
  const KNT_X   = () => Math.round(W * 0.27);
  const DRG_X   = () => Math.round(W * 0.66);
  const KNT_H   = () => Math.round((H - HUD_H()) * 0.85);
  const DRG_H   = () => Math.round((H - HUD_H()) * 0.92);
  const MOUTH_X = () => DRG_X() - DRG_H() * 0.42;
  const MOUTH_Y = () => GROUND() - DRG_H() * 0.52;

  // ---- BG ----
  function drawBg() {
    // sky gradient
    const sky = ctx.createLinearGradient(0, HUD_H(), 0, H);
    sky.addColorStop(0,   '#030318');
    sky.addColorStop(0.25,'#0d0830');
    sky.addColorStop(0.55,'#1a0640');
    sky.addColorStop(0.80,'#2d0858');
    sky.addColorStop(1,   '#3a0a6a');
    ctx.fillStyle = sky; ctx.fillRect(0, HUD_H(), W, H - HUD_H());

    // far mountains
    ctx.fillStyle = '#160432';
    ctx.beginPath(); ctx.moveTo(0, GROUND() - 8);
    const step = W / 18;
    const peaks = [0.22,0.15,0.28,0.12,0.24,0.17,0.30,0.10,0.25,0.18,0.20,0.27,0.14,0.22,0.19,0.26,0.13,0.23,0.21];
    for (let i = 0; i <= 18; i++) {
      const px = i * step;
      const py = GROUND() - (H - HUD_H()) * (peaks[i % peaks.length] || 0.20);
      ctx.lineTo(px, py);
    }
    ctx.lineTo(W, GROUND() - 8); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();

    // ground strip
    ctx.fillStyle = '#0a0418';
    ctx.fillRect(0, GROUND(), W, H - GROUND());

    // pixel clouds
    cloudOff += 0.18;
    [[0.08,0.10,70],[0.32,0.07,52],[0.74,0.13,60]].forEach(([rx,ry,w]) => {
      const cx = ((rx * W + cloudOff * 18) % (W + 80)) - 60;
      const cy = HUD_H() + (ry * (H - HUD_H()));
      ctx.fillStyle = '#280650';
      ctx.fillRect(cx,      cy+6,  w,    7);
      ctx.fillRect(cx+8,    cy,    w-14, 7);
      ctx.fillRect(cx+18,   cy-7,  w-30, 7);
    });

    // castle (right)
    drawCastle(W * 0.89, GROUND());
    // cactus (left)
    drawCactus(W * 0.06, GROUND());

    // horizon glow
    const hg = ctx.createLinearGradient(0, GROUND()-20, 0, GROUND()+4);
    hg.addColorStop(0, 'rgba(140,0,220,0.18)');
    hg.addColorStop(1, 'rgba(140,0,220,0)');
    ctx.fillStyle = hg; ctx.fillRect(0, GROUND()-20, W, 24);

    // scanlines
    for (let y = HUD_H(); y < H; y += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, y, W, 2);
    }
  }

  function drawCastle(x, gy) {
    const s = H / 220;
    ctx.fillStyle = '#160432';
    ctx.fillRect(x-20*s, gy-40*s, 40*s, 40*s);
    ctx.fillRect(x-27*s, gy-58*s, 15*s, 58*s);
    ctx.fillRect(x+13*s, gy-48*s, 14*s, 48*s);
    for (let i=0;i<3;i++) ctx.fillRect(x-27*s+i*6*s, gy-64*s, 4*s, 8*s);
    for (let i=0;i<3;i++) ctx.fillRect(x+13*s+i*5*s, gy-54*s, 3*s, 7*s);
    ctx.fillStyle = '#ff8800'; ctx.fillRect(x-4*s, gy-30*s, 6*s, 8*s);
    ctx.fillStyle = '#dd00cc';
    ctx.fillRect(x-25*s, gy-76*s, 2*s, 18*s);
    ctx.fillRect(x-23*s, gy-76*s, 10*s, 6*s);
  }

  function drawCactus(x, gy) {
    const s = H / 220;
    ctx.fillStyle = '#0a0418';
    ctx.fillRect(x-3*s, gy-42*s, 6*s, 42*s);
    ctx.fillRect(x-14*s, gy-22*s, 14*s, 5*s);
    ctx.fillRect(x-14*s, gy-32*s, 5*s, 12*s);
    ctx.fillRect(x+3*s,  gy-26*s, 12*s, 5*s);
    ctx.fillRect(x+11*s, gy-36*s, 5*s, 12*s);
  }

  // ---- HUD ----
  function drawHUD() {
    ctx.fillStyle = 'rgba(0,0,15,0.82)';
    ctx.fillRect(0, 0, W, HUD_H());
    ctx.fillStyle = 'rgba(120,0,200,0.4)';
    ctx.fillRect(0, HUD_H()-1, W, 1);

    const fs  = Math.max(9, Math.min(15, W * 0.012));
    const cy  = HUD_H() * 0.52;
    ctx.font  = `bold ${fs}px 'Courier New', monospace`;
    ctx.textBaseline = 'middle';

    // 1UP + score
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ff44ff'; ctx.fillText('1UP', W*0.02, cy);
    ctx.fillStyle = '#ffffff'; ctx.fillText('000850', W*0.068, cy);

    // mini icons (knight + shield)
    drawHudIcons(W*0.17, cy, fs);

    // hearts
    drawHearts(W*0.24, cy, fs);

    // HI-SCORE
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffaa00'; ctx.fillText('HI-SCORE', W*0.5, cy);
    ctx.fillStyle = '#ffffff'; ctx.fillText('025000', W*0.622, cy);

    // INSERT COIN blinking
    if (Math.floor(t / 28) % 2 === 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#00ff55'; ctx.fillText('INSERT COIN', W*0.985, cy);
    }
  }

  function drawHudIcons(x, cy, fs) {
    const p = Math.max(2, Math.round(fs * 0.55));
    // knight silhouette
    ctx.fillStyle = '#44aaff';
    ctx.fillRect(x,       cy-p*2.5, p*2, p*2);    // head
    ctx.fillRect(x-p,     cy-p*0.5, p*4, p*2);    // body
    ctx.fillRect(x+p*1.5, cy-p*5,   p,   p*4);    // sword up
    // shield
    ctx.fillStyle = '#ff44ff';
    ctx.fillRect(x+p*5,   cy-p*2.5, p*3, p*4.5);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x+p*5+1, cy-p*1.8, 1,   p*2.5);
    ctx.fillRect(x+p*5+1, cy-p*1.8, p*2, 1);
  }

  function drawHearts(x, cy, fs) {
    const s = Math.max(7, fs * 0.75);
    [true,true,true,false,false,false].forEach((full, i) => {
      ctx.fillStyle = full ? '#ff2244' : '#441122';
      const hx = x + i * s * 1.35;
      ctx.fillRect(hx-s*.3, cy-s*.35, s*.3, s*.35);
      ctx.fillRect(hx,      cy-s*.35, s*.3, s*.35);
      ctx.fillRect(hx-s*.45,cy-s*.02, s*.9, s*.35);
      ctx.beginPath();
      ctx.moveTo(hx-s*.45, cy+s*.33);
      ctx.lineTo(hx+s*.45, cy+s*.33);
      ctx.lineTo(hx, cy+s*.72);
      ctx.closePath(); ctx.fill();
    });
  }

  // ---- FIRE ----
  function spawnFire() {
    const mx = MOUTH_X(), my = MOUTH_Y();
    const tx = KNT_X() + KNT_H()*0.1, ty = GROUND() - KNT_H()*0.45;
    const ang = Math.atan2(ty - my, tx - mx);
    for (let i = 0; i < 4; i++) {
      const spd = 4 + Math.random() * 4;
      const spread = (Math.random()-0.5) * 0.4;
      fire.push({
        x: mx, y: my,
        vx: Math.cos(ang+spread) * spd,
        vy: Math.sin(ang+spread) * spd,
        life: 1, r: 10+Math.random()*12,
        hot: Math.random() > 0.45
      });
    }
    if (fire.length > 120) fire.splice(0, 4);
  }

  function spawnEmbers() {
    const mx = MOUTH_X(), my = MOUTH_Y();
    if (Math.random() < 0.4) {
      embers.push({
        x: mx + (Math.random()-0.5)*20,
        y: my + (Math.random()-0.5)*10,
        vx: -(1+Math.random()*2),
        vy: (Math.random()-0.5)*1.5 - 0.5,
        life: 1, r: 2+Math.random()*3
      });
    }
    if (embers.length > 40) embers.splice(0,1);
  }

  function updateFire() {
    fire.forEach(p => { p.x+=p.vx; p.y+=p.vy; p.vy+=0.08; p.vx*=0.98; p.life-=0.032; p.r*=0.976; });
    fire = fire.filter(p => p.life > 0 && p.r > 0.5);
    embers.forEach(p => { p.x+=p.vx; p.y+=p.vy; p.vy-=0.04; p.life-=0.04; });
    embers = embers.filter(p => p.life > 0);
  }

  function drawFire() {
    fire.forEach(p => {
      ctx.save(); ctx.globalAlpha = p.life * 0.92;
      const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
      if (p.hot) {
        g.addColorStop(0, 'rgba(255,255,180,1)');
        g.addColorStop(0.3,'rgba(255,210,0,0.9)');
        g.addColorStop(0.65,'rgba(255,80,0,0.5)');
        g.addColorStop(1, 'rgba(180,0,0,0)');
      } else {
        g.addColorStop(0, 'rgba(255,130,0,1)');
        g.addColorStop(0.5,'rgba(255,30,0,0.6)');
        g.addColorStop(1, 'rgba(150,0,0,0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      ctx.restore();
    });
    embers.forEach(p => {
      ctx.save(); ctx.globalAlpha = p.life;
      ctx.fillStyle = p.life > 0.5 ? '#ffdd00' : '#ff6600';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.round(p.r), Math.round(p.r));
      ctx.restore();
    });
  }

  // ---- SPRITES ----
  function drawKnight() {
    const kh = KNT_H(), kw = kh * 0.70;
    const x = KNT_X(), gy = GROUND();
    const bob = Math.sin(t*0.10)*2;
    if (imgKnight.complete && imgKnight.naturalWidth) {
      ctx.save();
      ctx.translate(x, gy - kh*0.5 + kh*0.10 + bob);
      // blue sword glow
      ctx.shadowColor = '#00bbff'; ctx.shadowBlur = 16;
      ctx.drawImage(imgKnight, -kw/2, -kh/2, kw, kh);
      ctx.restore();
    }
  }

  function drawDragon() {
    const dh = DRG_H(), dw = dh * 1.15;
    const x = DRG_X(), gy = GROUND();
    const bob = Math.sin(t*0.08)*3;
    if (imgDragon.complete && imgDragon.naturalWidth) {
      ctx.save();
      ctx.translate(x, gy - dh*0.46 + bob);
      ctx.shadowColor = 'rgba(200,0,0,0.4)'; ctx.shadowBlur = 10;
      ctx.drawImage(imgDragon, -dw/2, -dh/2, dw, dh);
      ctx.restore();
    }
  }

  // ---- LOOP ----
  function frame() {
    t++;
    ctx.clearRect(0, 0, W, H);
    drawBg();
    spawnFire();
    spawnEmbers();
    updateFire();
    drawFire();
    drawKnight();
    drawDragon();
    drawHUD();
  }

  let animId = null;
  const obs = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) { if (!animId) loop(); }
    else { if (animId) { cancelAnimationFrame(animId); animId = null; } }
  }, { threshold: 0.1 });
  obs.observe(canvas);

  function loop() {
    if (!document.contains(canvas)) {
      obs.disconnect(); window.removeEventListener('resize', onResize); return;
    }
    frame();
    animId = requestAnimationFrame(loop);
  }
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
          <a class="cta" href="/como-comprar">Ver guía completa de compra e instalación &rarr;</a>
        </div>
      </div>
    </section>
  `;
}

function toolbarHTML(showPlatformFilters = true) {
  return `
    <div class="toolbar">
      <input id="search" type="search" placeholder="Buscar juego..." autocomplete="off" list="search-suggestions">
      <datalist id="search-suggestions"></datalist>
      ${showPlatformFilters ? `
        <div class="filters">
          <button class="filter active" data-platform="all">Todos</button>
          <button class="filter" data-platform="PS5">PS5</button>
          <button class="filter" data-platform="PS4">PS4</button>
          <button class="filter" data-platform="Xbox">Xbox</button>
          <button class="filter" data-sale="true">En oferta</button>
          <button class="filter active" data-aaa="true" title="Filtrar indies y juegos baratos">Solo AAA</button>
        </div>
      ` : `
        <div class="filters">
          <button class="filter active" data-platform="all">Todos</button>
          <button class="filter" data-sale="true">En oferta</button>
          <button class="filter active" data-aaa="true" title="Filtrar indies y juegos baratos">Solo AAA</button>
        </div>
      `}
      <select id="sort-select" class="sort-select" aria-label="Ordenar por">
        <option value="">Ordenar por...</option>
        <option value="discount-desc">Mayor descuento</option>
        <option value="price-asc">Precio: menor a mayor</option>
        <option value="price-desc">Precio: mayor a menor</option>
        <option value="alpha-asc">Nombre A–Z</option>
      </select>
    </div>
  `;
}

// ============================================================
// Grid + filtros + paginación
// ============================================================
const localFilters = { platform: "all", sale: false, q: "", aaaOnly: true, genre: null, sort: "" };
let localList = [];
let currentPage = 1;
let currentRouteBase = "/";

function mountToolbar(baseList, page = 1, routeBase = "/", aaaDefault = true) {
  localFilters.platform = "all";
  localFilters.sale = false;
  localFilters.q = "";
  localFilters.aaaOnly = aaaDefault;
  localFilters.genre = null;
  localFilters.sort = "";
  localList = baseList || allGames;
  currentPage = page;
  currentRouteBase = routeBase;

  // Autocompletado: alimentar el datalist con los títulos del listado actual
  const datalist = document.getElementById("search-suggestions");
  if (datalist) {
    const titles = (localList || []).slice(0, 200).map(g => g.title);
    datalist.innerHTML = titles.map(t => `<option value="${escapeAttr(t)}">`).join("");
  }

  const sortSel = document.getElementById("sort-select");
  if (sortSel) {
    sortSel.addEventListener("change", () => {
      localFilters.sort = sortSel.value;
      currentPage = 1;
      applyFilters();
    });
  }

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
      } else if (btn.dataset.aaa) {
        localFilters.aaaOnly = !localFilters.aaaOnly;
        btn.classList.toggle("active", localFilters.aaaOnly);
        btn.textContent = localFilters.aaaOnly ? "Solo AAA" : "Ver todos";
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
  document.querySelectorAll(".cat-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      localFilters.genre = chip.dataset.genre || null;
      document.querySelectorAll(".cat-chip").forEach(c => c.classList.toggle("active", c === chip));
      currentPage = 1;
      applyFilters();
    });
  });
  const aaaBtn = document.querySelector(".filter[data-aaa]");
  if (aaaBtn) {
    aaaBtn.classList.toggle("active", localFilters.aaaOnly);
    aaaBtn.textContent = localFilters.aaaOnly ? "Solo AAA" : "Ver todos";
  }
  applyFilters();
}

function applyFilters() {
  let list = localList;
  if (localFilters.platform !== "all") {
    list = list.filter(g => g.platform.includes(localFilters.platform));
  }
  if (localFilters.sale) list = list.filter(g => g.onSale);
  if (localFilters.genre) {
    list = list.filter(g => Array.isArray(g.genres) && g.genres.includes(localFilters.genre));
  }
  if (localFilters.aaaOnly) list = list.filter(isAAA);
  if (localFilters.q) {
    list = list.filter(g => gameMatchesQuery(g, localFilters.q));
  }
  // Ordenamiento manual (sort selector) tiene prioridad sobre el orden por defecto
  if (localFilters.sort) {
    list = list.slice().sort((a, b) => {
      if (localFilters.sort === "discount-desc") {
        return (b.discount || 0) - (a.discount || 0);
      }
      if (localFilters.sort === "price-asc") {
        const pa = a._manualPrices ? a.priceCRC_principal : (principalCRC(a.priceUSD, a.platform) || Infinity);
        const pb = b._manualPrices ? b.priceCRC_principal : (principalCRC(b.priceUSD, b.platform) || Infinity);
        return pa - pb;
      }
      if (localFilters.sort === "price-desc") {
        const pa = a._manualPrices ? a.priceCRC_principal : (principalCRC(a.priceUSD, a.platform) || 0);
        const pb = b._manualPrices ? b.priceCRC_principal : (principalCRC(b.priceUSD, b.platform) || 0);
        return pb - pa;
      }
      if (localFilters.sort === "alpha-asc") {
        return String(a.title).localeCompare(String(b.title), "es");
      }
      return 0;
    });
  } else {
    // En páginas de plataforma: títulos prioritarios primero, luego AAA, indie al final.
    // En otras páginas (home, búsqueda): solo indie al final cuando se ven todos.
    const onPlatformPage = /\/plataforma\//.test(window.location.pathname);
    if (onPlatformPage) {
      list = list.slice().sort((a, b) => {
        const pa = priorityScore(a), pb = priorityScore(b);
        if (pa !== pb) return pa - pb;
        return (isAAA(a) ? 0 : 1) - (isAAA(b) ? 0 : 1);
      });
    } else if (!localFilters.aaaOnly) {
      list = list.slice().sort((a, b) => (isAAA(a) ? 0 : 1) - (isAAA(b) ? 0 : 1));
    }
  }
  renderGrid(list);
  renderPagination(list.length);
  scheduleAAAEnrichForVisible(localList);
}

function paginate(list) {
  const start = (currentPage - 1) * CONFIG.perPage;
  return list.slice(start, start + CONFIG.perPage);
}

function skeletonCardHTML() {
  return `
    <div class="card-skeleton">
      <div class="skel-image"></div>
      <div class="skel-body">
        <div class="skel-line skel-title"></div>
        <div class="skel-line skel-line-2"></div>
        <div class="skel-price-rows">
          <div class="skel-line skel-price"></div>
          <div class="skel-line skel-price"></div>
        </div>
      </div>
    </div>
  `;
}

function renderGrid(list) {
  const grid = document.getElementById("grid");
  if (!grid) return;
  if (!loaded) {
    grid.innerHTML = Array.from({ length: 12 }, () => skeletonCardHTML()).join("");
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
  const newPath = p === 1 ? (base || "/") : `${base}/p/${p}`;
  if (location.pathname !== newPath) history.replaceState(null, "", newPath);
  applyFilters();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cardHTML(g) {
  const principal = g._manualPrices ? g.priceCRC_principal : principalCRC(g.priceUSD, g.platform);
  const secundaria = g._manualPrices ? g.priceCRC_secundaria : secundariaCRC(g.priceUSD, g.platform);
  const img = g.imageUrl
    ? `<img src="${escapeAttr(g.imageUrl)}" alt="${escapeAttr(g.title)}" loading="lazy">`
    : `${placeholderHTML()}`;
  return `
    <a class="card" href="/producto/${encodeURIComponent(g.id)}">
      <div class="card-image">
        ${img}
        ${g.onSale && g.discount ? `<span class="badge-sale">-${g.discount}%</span>` : ""}
        ${g.comingSoon ? `<span class="badge-preventa">Preventa</span>` : ""}
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
function showToast(text, type = "success") {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  const icons = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-text">${escapeHtml(text)}</span>`;
  // forzar reflow para reiniciar animación si ya estaba visible
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

// ============================================================
// Helpers
// ============================================================
function interpolateCRC(usd, colIdx) {
  const tbl = CONFIG.pricing.table;
  if (!usd || usd <= 0) return 0;
  const col = (row) => row[colIdx + 1]; // row[0]=usd, then 4 price columns
  if (usd <= tbl[0][0]) {
    const t = (usd - tbl[0][0]) / (tbl[1][0] - tbl[0][0]);
    return Math.max(0, Math.round(col(tbl[0]) + t * (col(tbl[1]) - col(tbl[0]))));
  }
  const last = tbl.length - 1;
  if (usd >= tbl[last][0]) {
    const t = (usd - tbl[last - 1][0]) / (tbl[last][0] - tbl[last - 1][0]);
    return Math.round(col(tbl[last - 1]) + t * (col(tbl[last]) - col(tbl[last - 1])));
  }
  for (let i = 0; i < tbl.length - 1; i++) {
    if (usd >= tbl[i][0] && usd <= tbl[i + 1][0]) {
      const t = (usd - tbl[i][0]) / (tbl[i + 1][0] - tbl[i][0]);
      return Math.round(col(tbl[i]) + t * (col(tbl[i + 1]) - col(tbl[i])));
    }
  }
  return 0;
}
function principalCRC(usd, platform = "") {
  if (/PS|Xbox/i.test(platform)) return interpolateCRC(usd, 0);
  return Math.round(usd * CONFIG.pricing.exchangeRate * CONFIG.pricing.principalMarkup);
}
function secundariaCRC(usd, platform = "") {
  if (/PS|Xbox/i.test(platform)) return interpolateCRC(usd, 1);
  return Math.round(usd * CONFIG.pricing.exchangeRate * CONFIG.pricing.secundariaMarkup);
}
function formatCRC(amount) {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Actualiza <title> y las meta tags og:title / description / og:url de la página.
function setPageMeta(title, description, image) {
  document.title = title;
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute("content", title);
  const twTitle = document.querySelector('meta[name="twitter:title"]');
  if (twTitle) twTitle.setAttribute("content", title);
  if (description) {
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", description);
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", description);
    const twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) twDesc.setAttribute("content", description);
  }
  // URL canónica + og:url limpios (sin query/hash) por ruta.
  const canonicalUrl = location.origin + location.pathname;
  const ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl) ogUrl.setAttribute("content", canonicalUrl);
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  canonical.setAttribute("href", canonicalUrl);
  // og:image / twitter:image por página (cae al logo si no se pasa imagen).
  const imgSrc = image || "/assets/logo.png?v=2";
  const abs = /^https?:\/\//.test(imgSrc) ? imgSrc : (location.origin + imgSrc);
  const ogImg = document.querySelector('meta[property="og:image"]');
  if (ogImg) ogImg.setAttribute("content", abs);
  const twImg = document.querySelector('meta[name="twitter:image"]');
  if (twImg) twImg.setAttribute("content", abs);
}

// Inyecta (o reemplaza) el bloque JSON-LD principal del documento.
function setJsonLd(data) {
  let el = document.getElementById("jsonld-main");
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = "jsonld-main";
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
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

function fmtClientId(n) {
  return n ? `RM-${String(n).padStart(4, "0")}` : "";
}

// ============================================================
// Iconos SVG — reemplazan emojis para look profesional
// ============================================================
const ICONS = {
  controller: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258a4.019 4.019 0 0 0-.017-.152A4 4 0 0 0 17.32 5z"/></svg>`,
  zap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`,
  card: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  chevronLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
};

function placeholderHTML() {
  return `<div class="placeholder">${ICONS.controller}</div>`;
}


// ============================================================
// Login / Mi cuenta / Admin
// ============================================================
function renderLogin() {
  setPageMeta("Iniciar sesión | Rey Midas Digitales");
  if (currentUser) { navigate("/mi-cuenta"); return; }

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
      navigate("/admin");
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
    navigate(currentUser.is_admin ? "/admin" : "/mi-cuenta");
  });
}

async function renderMyAccount() {
  setPageMeta("Mi cuenta | Rey Midas Digitales");
  if (!currentUser) { navigate("/login"); return; }
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
  setPageMeta("Admin | Rey Midas Digitales");
  if (!currentUser) { navigate("/login"); return; }
  if (!currentUser.is_admin) {
    app.innerHTML = `
      <section class="container empty-state">
        <h2>Sin permisos</h2>
        <p>Tu cuenta no tiene acceso al panel de administración.</p>
        <a class="cta" href="/">Volver al inicio</a>
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
          <label>ID de cliente
            <select name="client_email" id="clientSelect" required>
              <option value="">— Seleccionar cliente —</option>
            </select>
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
          <label>Nombre del juego titular
            <input name="game_name" type="text" placeholder="Ej: God of War Ragnarök">
          </label>
          <label>Juegos incluidos en la cuenta
            <textarea name="games" rows="4" placeholder="Uno por línea"></textarea>
          </label>
          <label>Códigos del verificador (2FA)
            <textarea name="verifier_codes" rows="3" placeholder="Uno por línea"></textarea>
          </label>
          <label>Notas (opcional)
            <textarea name="notes" rows="2"></textarea>
          </label>
          <button type="submit">Guardar compra</button>
          <p id="purchaseFormStatus" class="form-status"></p>
        </form>

        <div class="admin-list">
          <h2>Compras</h2>
          <div class="admin-search-bar">
            <input id="clientSearch" type="text" placeholder="Email o RM-0001…">
            <button id="clientSearchBtn" type="button">Buscar</button>
            <button id="clientSearchClear" type="button" hidden>✕ Limpiar</button>
          </div>
          <div id="clientProfileCard" class="client-profile-card" hidden></div>
          <div id="adminPurchases">Cargando...</div>
        </div>
      </div>

      <div class="admin-grid admin-bundles">
        <form id="bundleForm" class="admin-form">
          <h2 id="bundleFormTitle">Cargar bundle PS / Xbox</h2>
          <input type="hidden" name="id" id="bundleId">
          <div class="row">
            <label>Plataforma
              <select name="platform" id="bundlePlatform" required>
                <option value="ps">PlayStation</option>
                <option value="xbox">Xbox</option>
              </select>
            </label>
            <label>Precio (₡)
              <input name="priceCRC" id="bundlePrice" type="number" min="1" step="1" required placeholder="25000">
            </label>
          </div>
          <div class="row">
            <label>Título (opcional)
              <input name="title" id="bundleTitle" type="text" placeholder="Ej: Mega Bundle PS5 Acción">
            </label>
            <label>Peso total (opcional)
              <input name="totalSize" id="bundleSize" type="text" placeholder="Ej: 180 GB">
            </label>
          </div>
          <label>Descuento (%) — opcional
            <input name="discountPct" id="bundleDiscount" type="number" min="1" max="99" step="1" list="discountPresets" placeholder="Ej: 70">
            <datalist id="discountPresets">
              <option value="50"></option><option value="60"></option>
              <option value="70"></option><option value="80"></option><option value="90"></option>
            </datalist>
            <small class="field-hint">Si lo llenás, aparece automáticamente “Ahorra un X%” + “Oferta por tiempo limitado y única”. Dejalo vacío para no mostrar oferta.</small>
          </label>
          <label>Portada — subí una imagen
            <input name="coverFile" id="bundleCoverFile" type="file" accept="image/*">
          </label>
          <label>…o pegá un enlace de imagen
            <input name="coverUrl" id="bundleCoverUrl" type="text" placeholder="https://…/portada.jpg">
          </label>
          <div id="bundleCoverPreviewWrap" class="bundle-cover-preview" hidden>
            <img id="bundleCoverPreview" alt="Vista previa portada">
          </div>
          <label>Juegos incluidos
            <textarea name="games" id="bundleGames" rows="8" required placeholder="Uno por línea. Opcional el peso después de una barra:&#10;God of War Ragnarök | 90 gb&#10;Spider-Man 2&#10;Hogwarts Legacy | 75 gb"></textarea>
            <small class="field-hint">Un juego por línea. Si querés, agregá el peso después de “ | ” (ej: <code>God of War | 90 gb</code>).</small>
          </label>
          <div class="bundle-form-actions">
            <button type="submit" id="bundleSubmitBtn">Guardar bundle</button>
            <button type="button" id="bundleCancelBtn" class="cta-secondary" hidden>Cancelar edición</button>
          </div>
          <p id="bundleFormStatus" class="form-status"></p>
        </form>

        <div class="admin-list">
          <h2>Bundles publicados</h2>
          <p class="field-hint">Los cambios aparecen en la web pública en ~1 minuto (cuando Vercel redespliega).</p>
          <div id="adminBundlesList">Cargando...</div>
        </div>
      </div>
    </section>
  `;
  document.getElementById("purchaseForm").addEventListener("submit", handleAdminSubmit);
  document.getElementById("createClientForm").addEventListener("submit", handleCreateClient);
  document.getElementById("clientSearchBtn").addEventListener("click", doClientSearch);
  document.getElementById("clientSearch").addEventListener("keydown", e => { if (e.key === "Enter") doClientSearch(); });
  document.getElementById("clientSearchClear").addEventListener("click", clearClientSearch);
  document.getElementById("bundleForm").addEventListener("submit", handleBundleSubmit);
  document.getElementById("bundleCancelBtn").addEventListener("click", resetBundleForm);
  document.getElementById("bundleCoverFile").addEventListener("change", previewBundleCover);
  document.getElementById("bundleCoverUrl").addEventListener("input", previewBundleCover);
  loadAdminPurchases();
  loadClientsDropdown();
  loadAdminBundles();
}

// ===== Bundles PS / Xbox (admin) =====
let adminBundlesCache = { ps: [], xbox: [] };

async function loadAdminBundles() {
  const box = document.getElementById("adminBundlesList");
  if (!box) return;
  try {
    const data = await apiPost("/api/bundles", { action: "list" });
    adminBundlesCache = { ps: data.ps || [], xbox: data.xbox || [] };
    renderAdminBundles();
  } catch (err) {
    box.innerHTML = `<p class="form-status error">No se pudieron cargar los bundles: ${escapeHtml(err.message)}</p>`;
  }
}

function renderAdminBundles() {
  const box = document.getElementById("adminBundlesList");
  if (!box) return;
  const rows = [];
  for (const platform of ["ps", "xbox"]) {
    for (const b of adminBundlesCache[platform]) {
      rows.push(`
        <div class="admin-bundle-row">
          <div class="abr-thumb">${b.coverUrl ? `<img src="${escapeAttr(b.coverUrl)}" alt="" loading="lazy">` : `<span class="abr-noimg">sin portada</span>`}</div>
          <div class="abr-info">
            <strong>${b.title ? escapeHtml(b.title) : `Bundle ${escapeHtml(b.id)}`}</strong>
            <span class="abr-meta">${platform === "ps" ? "PlayStation" : "Xbox"} · ${b.games?.length || 0} juegos · ${formatCRC(b.priceCRC)}${b.discountPct ? ` · −${b.discountPct}%` : ""}</span>
          </div>
          <div class="abr-actions">
            <button type="button" class="admin-edit" data-edit-bundle="${escapeAttr(platform)}:${escapeAttr(b.id)}" title="Editar">✎</button>
            <button type="button" class="admin-del" data-del-bundle="${escapeAttr(platform)}:${escapeAttr(b.id)}" title="Eliminar">×</button>
          </div>
        </div>
      `);
    }
  }
  box.innerHTML = rows.length ? rows.join("") : `<p class="field-hint">Todavía no cargaste ningún bundle.</p>`;
  box.querySelectorAll("[data-edit-bundle]").forEach(btn => {
    btn.addEventListener("click", () => editBundle(...btn.dataset.editBundle.split(":")));
  });
  box.querySelectorAll("[data-del-bundle]").forEach(btn => {
    btn.addEventListener("click", () => deleteBundle(...btn.dataset.delBundle.split(":")));
  });
}

function gamesToText(games) {
  return (games || []).map(g => g.size ? `${g.name} | ${g.size}` : g.name).join("\n");
}

function parseGamesText(text) {
  return String(text || "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const i = line.indexOf("|");
      if (i === -1) return { name: line, size: "" };
      return { name: line.slice(0, i).trim(), size: line.slice(i + 1).trim() };
    })
    .filter(g => g.name);
}

function editBundle(platform, id) {
  const b = (adminBundlesCache[platform] || []).find(x => String(x.id) === String(id));
  if (!b) return;
  document.getElementById("bundleId").value = b.id;
  document.getElementById("bundlePlatform").value = platform;
  document.getElementById("bundlePrice").value = b.priceCRC || "";
  document.getElementById("bundleTitle").value = b.title || "";
  document.getElementById("bundleSize").value = b.totalSize || "";
  document.getElementById("bundleDiscount").value = b.discountPct || "";
  document.getElementById("bundleCoverUrl").value = b.coverUrl || "";
  document.getElementById("bundleCoverFile").value = "";
  document.getElementById("bundleGames").value = gamesToText(b.games);
  document.getElementById("bundleFormTitle").textContent = `Editar bundle ${b.id}`;
  document.getElementById("bundleSubmitBtn").textContent = "Guardar cambios";
  document.getElementById("bundleCancelBtn").hidden = false;
  previewBundleCover();
  document.getElementById("bundleForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetBundleForm() {
  const form = document.getElementById("bundleForm");
  if (form) form.reset();
  document.getElementById("bundleId").value = "";
  document.getElementById("bundleFormTitle").textContent = "Cargar bundle PS / Xbox";
  document.getElementById("bundleSubmitBtn").textContent = "Guardar bundle";
  document.getElementById("bundleCancelBtn").hidden = true;
  document.getElementById("bundleFormStatus").textContent = "";
  previewBundleCover();
}

function previewBundleCover() {
  const wrap = document.getElementById("bundleCoverPreviewWrap");
  const img = document.getElementById("bundleCoverPreview");
  if (!wrap || !img) return;
  const file = document.getElementById("bundleCoverFile").files[0];
  const url = document.getElementById("bundleCoverUrl").value.trim();
  if (file) {
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; wrap.hidden = false; };
    reader.readAsDataURL(file);
  } else if (url) {
    img.src = url; wrap.hidden = false;
  } else {
    img.removeAttribute("src"); wrap.hidden = true;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleBundleSubmit(e) {
  e.preventDefault();
  const status = document.getElementById("bundleFormStatus");
  const btn = document.getElementById("bundleSubmitBtn");
  status.className = "form-status";
  status.textContent = "Guardando…";
  btn.disabled = true;
  try {
    const platform = document.getElementById("bundlePlatform").value;
    const games = parseGamesText(document.getElementById("bundleGames").value);
    if (!games.length) throw new Error("Agregá al menos un juego.");
    const bundle = {
      id: document.getElementById("bundleId").value.trim(),
      priceCRC: document.getElementById("bundlePrice").value,
      title: document.getElementById("bundleTitle").value.trim(),
      totalSize: document.getElementById("bundleSize").value.trim(),
      discountPct: document.getElementById("bundleDiscount").value.trim(),
      coverUrl: document.getElementById("bundleCoverUrl").value.trim(),
      games,
    };
    const payload = { action: "save", platform, bundle };
    const file = document.getElementById("bundleCoverFile").files[0];
    if (file) {
      if (file.size > 3 * 1024 * 1024) throw new Error("La imagen es muy pesada (máx ~3 MB). Reducila e intentá de nuevo.");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      payload.coverFile = { dataBase64: await readFileAsBase64(file), ext };
    }
    const data = await apiPost("/api/bundles", payload);
    adminBundlesCache[platform] = data.bundles || [];
    renderAdminBundles();
    resetBundleForm();
    status.className = "form-status success";
    status.textContent = "✓ Bundle guardado. Se publica en la web en ~1 minuto.";
  } catch (err) {
    status.className = "form-status error";
    status.textContent = err.message || "No se pudo guardar.";
  } finally {
    btn.disabled = false;
  }
}

async function deleteBundle(platform, id) {
  const b = (adminBundlesCache[platform] || []).find(x => String(x.id) === String(id));
  const label = b && b.title ? b.title : `Bundle ${id}`;
  if (!confirm(`¿Eliminar “${label}”? Esta acción quita el bundle de la web.`)) return;
  try {
    const data = await apiPost("/api/bundles", { action: "delete", platform, id });
    adminBundlesCache[platform] = data.bundles || [];
    renderAdminBundles();
  } catch (err) {
    alert("No se pudo eliminar: " + err.message);
  }
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
    const newClient = await apiPost("/api/clients", { action: "create", email, password, full_name: fullName });
    const clientIdLabel = newClient.customer_number ? ` (${fmtClientId(newClient.customer_number)})` : "";
    status.innerHTML = `
      ✓ Cuenta creada para <strong>${escapeHtml(email)}</strong>${escapeHtml(clientIdLabel)}.<br>
      Mandale por WhatsApp:<br>
      <code class="copy-able" data-copy="Tu acceso a reymidascr.com — Email: ${email} — Contraseña: ${password}">
        Tu acceso a reymidascr.com — Email: ${email} — Contraseña: ${password}
      </code>
    `;
    status.className = "form-status ok";
    form.querySelector('input[name="email"]').value = "";
    form.querySelector('input[name="full_name"]').value = "";
    form.querySelector('input[name="password"]').value = "Midas2026";
    loadClientsDropdown();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = "form-status error";
  }
}

async function loadClientsDropdown() {
  const sel = document.getElementById("clientSelect");
  if (!sel) return;
  try {
    const { clients } = await apiPost("/api/clients", { action: "list" });
    const prev = sel.value;
    sel.innerHTML = `<option value="">— Seleccionar cliente —</option>`;
    (clients || []).forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.email;
      const id = fmtClientId(c.customer_number);
      opt.textContent = [id, c.email, c.full_name].filter(Boolean).join(" — ");
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  } catch (_) {}
}

function renderPurchaseCards(purchases, box, onDelete) {
  if (!purchases?.length) {
    box.innerHTML = `<p class="empty-state-small">No hay compras para mostrar.</p>`;
    return;
  }
  box.innerHTML = purchases.map(p => `
    <div class="admin-purchase">
      <header>
        <strong>${p.app_users?.customer_number ? escapeHtml(fmtClientId(p.app_users.customer_number)) + " · " : ""}${escapeHtml(p.app_users?.email || "?")}</strong>
        <span>${escapeHtml(p.platform)}${p.modality ? " · " + escapeHtml(p.modality) : ""}</span>
        <time>${escapeHtml(p.purchase_date)}</time>
        <button data-edit-id="${escapeAttr(p.id)}" class="admin-edit" aria-label="Editar" title="Editar">✎</button>
        <button data-del="${escapeAttr(p.id)}" class="admin-del" aria-label="Eliminar" title="Eliminar">×</button>
      </header>
      <p class="admin-account">${escapeHtml(p.account_email)} / ${escapeHtml(p.account_password)}</p>
      ${p.game_name ? `<p class="admin-game-name">🎮 ${escapeHtml(p.game_name)}</p>` : ""}
    </div>
  `).join("");
  box.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar esta compra?")) return;
      try {
        await apiPost("/api/purchases", { action: "delete", id: btn.dataset.del });
        onDelete();
      } catch (err) {
        showToast(err.message);
      }
    });
  });
  box.querySelectorAll("[data-edit-id]").forEach(btn => {
    const p = purchases.find(x => x.id === btn.dataset.editId);
    btn.addEventListener("click", () => openEditModal(p));
  });
}

async function loadAdminPurchases() {
  const box = document.getElementById("adminPurchases");
  if (!box) return;
  try {
    const { purchases } = await apiPost("/api/purchases", { action: "list-all" });
    renderPurchaseCards(purchases, box, loadAdminPurchases);
  } catch (err) {
    box.innerHTML = `<div class="status error">${escapeHtml(err.message)}</div>`;
  }
}

async function doClientSearch() {
  const q = document.getElementById("clientSearch")?.value.trim();
  if (!q) return;
  const box = document.getElementById("adminPurchases");
  box.innerHTML = "Buscando...";
  try {
    const body = { action: "by-client" };
    const rmMatch = q.match(/^RM-?(\d+)$/i);
    if (rmMatch) {
      body.customer_number = parseInt(rmMatch[1], 10);
    } else {
      body.client_email = q.toLowerCase();
    }
    const { purchases, client } = await apiPost("/api/purchases", body);
    document.getElementById("clientSearchClear").hidden = false;
    if (client) showClientProfile(client);
    renderPurchaseCards(purchases, box, () => doClientSearch());
  } catch (err) {
    box.innerHTML = `<div class="status error">${escapeHtml(err.message)}</div>`;
  }
}

function clearClientSearch() {
  const input = document.getElementById("clientSearch");
  if (input) input.value = "";
  document.getElementById("clientSearchClear").hidden = true;
  document.getElementById("clientProfileCard").hidden = true;
  loadAdminPurchases();
}

function showClientProfile(client) {
  const card = document.getElementById("clientProfileCard");
  card.hidden = false;
  card.innerHTML = `
    <div class="cp-header">
      ${client.customer_number ? `<span class="cp-id">${escapeHtml(fmtClientId(client.customer_number))}</span>` : ""}
      <span class="cp-email">${escapeHtml(client.email)}</span>
      ${client.full_name ? `<span class="cp-name">${escapeHtml(client.full_name)}</span>` : ""}
    </div>
    <div class="cp-actions">
      <button id="cpEditToggle" class="cp-btn">✎ Editar datos</button>
      <button id="cpResetPassToggle" class="cp-btn">🔑 Cambiar contraseña</button>
    </div>
    <form id="cpEditForm" class="cp-form" hidden>
      <label>Nombre completo
        <input name="full_name" type="text" value="${escapeAttr(client.full_name || "")}">
      </label>
      <label>Email
        <input name="email" type="email" required value="${escapeAttr(client.email)}">
      </label>
      <div class="edit-modal-actions">
        <button type="submit">Guardar</button>
        <button type="button" id="cpEditCancel" class="admin-modal-cancel">Cancelar</button>
      </div>
      <p id="cpEditStatus" class="form-status"></p>
    </form>
    <form id="cpResetPassForm" class="cp-form" hidden>
      <label>Nueva contraseña
        <input name="password" type="text" required minlength="6" placeholder="Mínimo 6 caracteres">
      </label>
      <div class="edit-modal-actions">
        <button type="submit">Cambiar contraseña</button>
        <button type="button" id="cpResetCancel" class="admin-modal-cancel">Cancelar</button>
      </div>
      <p id="cpResetStatus" class="form-status"></p>
    </form>
  `;
  card.querySelector("#cpEditToggle").addEventListener("click", () => {
    card.querySelector("#cpEditForm").hidden = !card.querySelector("#cpEditForm").hidden;
    card.querySelector("#cpResetPassForm").hidden = true;
  });
  card.querySelector("#cpEditCancel").addEventListener("click", () => {
    card.querySelector("#cpEditForm").hidden = true;
  });
  card.querySelector("#cpResetPassToggle").addEventListener("click", () => {
    card.querySelector("#cpResetPassForm").hidden = !card.querySelector("#cpResetPassForm").hidden;
    card.querySelector("#cpEditForm").hidden = true;
  });
  card.querySelector("#cpResetCancel").addEventListener("click", () => {
    card.querySelector("#cpResetPassForm").hidden = true;
  });
  card.querySelector("#cpEditForm").addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const status = card.querySelector("#cpEditStatus");
    status.textContent = "Guardando...";
    status.className = "form-status";
    try {
      await apiPost("/api/clients", {
        action: "update",
        id: client.id,
        email: String(fd.get("email")).trim().toLowerCase(),
        full_name: fd.get("full_name") || null,
      });
      client.email = String(fd.get("email")).trim().toLowerCase();
      client.full_name = fd.get("full_name") || null;
      card.querySelector(".cp-email").textContent = client.email;
      const nameEl = card.querySelector(".cp-name");
      if (nameEl) nameEl.textContent = client.full_name || "";
      status.textContent = "✓ Datos actualizados";
      status.className = "form-status ok";
      loadClientsDropdown();
      setTimeout(() => { card.querySelector("#cpEditForm").hidden = true; }, 900);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = "form-status error";
    }
  });
  card.querySelector("#cpResetPassForm").addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const password = String(fd.get("password"));
    const status = card.querySelector("#cpResetStatus");
    status.textContent = "Cambiando...";
    status.className = "form-status";
    try {
      await apiPost("/api/clients", { action: "reset-password", id: client.id, password });
      status.innerHTML = `✓ Contraseña cambiada: <code>${escapeHtml(password)}</code>`;
      status.className = "form-status ok";
      e.target.reset();
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = "form-status error";
    }
  });
}

function openEditModal(p) {
  let modal = document.getElementById("editPurchaseModal");
  if (!modal) {
    modal = document.createElement("dialog");
    modal.id = "editPurchaseModal";
    modal.className = "edit-modal admin-form";
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <h3>Editar compra — ${p.app_users?.customer_number ? escapeHtml(fmtClientId(p.app_users.customer_number)) + " · " : ""}${escapeHtml(p.app_users?.email || p.id)}</h3>
    <div class="row">
      <label>Fecha de compra
        <input name="purchase_date" type="date" value="${escapeAttr(p.purchase_date)}">
      </label>
      <label>Plataforma
        <select name="platform">
          ${["PS5","PS4","PS3","Xbox","Switch"].map(pl =>
            `<option value="${escapeAttr(pl)}"${p.platform === pl ? " selected" : ""}>${escapeHtml(pl)}</option>`
          ).join("")}
        </select>
      </label>
      <label>Modalidad
        <select name="modality">
          <option value="">—</option>
          ${[["principal","Principal"],["secundaria","Secundaria"],["bundle","Bundle"],["individual","Individual"]].map(([v,l]) =>
            `<option value="${escapeAttr(v)}"${p.modality === v ? " selected" : ""}>${escapeHtml(l)}</option>`
          ).join("")}
        </select>
      </label>
    </div>
    <label>Email de la cuenta vendida
      <input name="account_email" type="text" value="${escapeAttr(p.account_email)}">
    </label>
    <label>Contraseña de la cuenta
      <input name="account_password" type="text" value="${escapeAttr(p.account_password)}">
    </label>
    <label>Nombre del juego titular
      <input name="game_name" type="text" value="${escapeAttr(p.game_name || "")}" placeholder="Ej: God of War Ragnarök">
    </label>
    <label>Juegos incluidos en la cuenta
      <textarea name="games" rows="4" placeholder="Uno por línea">${escapeHtml(p.games || "")}</textarea>
    </label>
    <label>Códigos del verificador (2FA)
      <textarea name="verifier_codes" rows="3" placeholder="Uno por línea">${escapeHtml(p.verifier_codes || "")}</textarea>
    </label>
    <label>Notas
      <textarea name="notes" rows="2">${escapeHtml(p.notes || "")}</textarea>
    </label>
    <div class="edit-modal-actions">
      <button id="editSaveBtn" type="button">Guardar cambios</button>
      <button id="editCancelBtn" type="button" class="admin-modal-cancel">Cancelar</button>
    </div>
    <p id="editModalStatus" class="form-status"></p>
  `;
  modal.showModal();
  modal.querySelector("#editCancelBtn").addEventListener("click", () => modal.close());
  modal.addEventListener("click", e => { if (e.target === modal) modal.close(); });
  modal.querySelector("#editSaveBtn").addEventListener("click", async () => {
    const status = modal.querySelector("#editModalStatus");
    status.textContent = "Guardando...";
    status.className = "form-status";
    try {
      await apiPost("/api/purchases", {
        action: "update",
        id: p.id,
        purchase_date: modal.querySelector('[name="purchase_date"]').value,
        platform: modal.querySelector('[name="platform"]').value,
        modality: modal.querySelector('[name="modality"]').value || null,
        account_email: modal.querySelector('[name="account_email"]').value,
        account_password: modal.querySelector('[name="account_password"]').value,
        game_name: modal.querySelector('[name="game_name"]').value || null,
        games: modal.querySelector('[name="games"]').value || null,
        verifier_codes: modal.querySelector('[name="verifier_codes"]').value || null,
        notes: modal.querySelector('[name="notes"]').value || null,
      });
      status.textContent = "✓ Guardado";
      status.className = "form-status ok";
      setTimeout(() => { modal.close(); loadAdminPurchases(); }, 700);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = "form-status error";
    }
  });
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
      game_name: fd.get("game_name") || null,
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
// Estas claves de localStorage tienen que declararse antes de los
// llamados a mountNewsletter() y startLiveActivity() porque están
// en TDZ — si las dejamos abajo, mountNewsletter() lee POPUP_SEEN_KEY,
// tira ReferenceError, aborta el script y DISCOUNT_KEY nunca llega
// a inicializarse, lo que rompe renderCart() en cada click al carrito.
const DISCOUNT_KEY = "rmd_discount_code";
const POPUP_SEEN_KEY = "rmd_popup_seen";
const LIVE_ACTIVITY_DISMISSED_KEY = "rmd_live_dismissed";

render();
load();
initAuth();
// Iniciamos el feed de actividad después de un breve delay para que cargue el catálogo.
setTimeout(() => startLiveActivity(), 4000);

// Newsletter footer + popup
mountNewsletter();

// ============================================================
// Newsletter — footer form + popup de descuento
// ============================================================

function mountNewsletter() {
  // Footer form
  const footerForm = document.getElementById("footerNewsletter");
  if (footerForm) {
    footerForm.addEventListener("submit", (e) => handleNewsletterSubmit(e, footerForm, "footer"));
  }

  // Popup
  const popup = document.getElementById("discountPopup");
  if (!popup) return;

  // Cerrar al click en backdrop o ×
  popup.querySelectorAll("[data-close-popup]").forEach(el =>
    el.addEventListener("click", closeDiscountPopup)
  );
  // ESC para cerrar
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popup.hidden) closeDiscountPopup();
  });

  const popupForm = document.getElementById("popupForm");
  popupForm.addEventListener("submit", (e) => handleNewsletterSubmit(e, popupForm, "popup"));

  // Mostrar popup automáticamente si no se vio antes y no está suscrito
  const seen = localStorage.getItem(POPUP_SEEN_KEY);
  const hasCode = localStorage.getItem(DISCOUNT_KEY);
  if (!seen && !hasCode) {
    setTimeout(() => {
      // No molestar si está en checkout/admin/login
      const r = parseRoute();
      if (["cart", "admin", "login", "mi-cuenta"].includes(r.name)) return;
      openDiscountPopup();
    }, 25000); // 25 segundos después de cargar
  }
}

function openDiscountPopup() {
  const popup = document.getElementById("discountPopup");
  if (!popup) return;
  popup.hidden = false;
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => popup.classList.add("show"));
}

function closeDiscountPopup() {
  const popup = document.getElementById("discountPopup");
  if (!popup) return;
  popup.classList.remove("show");
  document.body.style.overflow = "";
  localStorage.setItem(POPUP_SEEN_KEY, String(Date.now()));
  setTimeout(() => { popup.hidden = true; }, 300);
}

async function handleNewsletterSubmit(e, form, source) {
  e.preventDefault();
  const email = form.querySelector('input[name="email"]').value.trim();
  if (!email) return;
  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Enviando...";
  try {
    const res = await fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "subscribe", email, source }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al suscribir");

    // Guardar código localmente
    if (data.code) localStorage.setItem(DISCOUNT_KEY, data.code);

    if (source === "popup") {
      // Mostrar pantalla de éxito en el popup
      document.getElementById("popupForm").hidden = true;
      document.getElementById("popupSuccess").hidden = false;
      document.getElementById("popupCode").textContent = data.code || "BIENVENIDA10";
      localStorage.setItem(POPUP_SEEN_KEY, String(Date.now()));
    } else {
      // Footer: toast con el código
      showToast(`¡Listo! Tu código: ${data.code}`, "success");
      btn.textContent = "✓ Suscrito";
      form.querySelector('input[name="email"]').value = "";
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 3000);
      // Re-render cart si está abierto, para mostrar el código
      if (parseRoute().name === "cart") render();
      return;
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = originalText;
    showToast(err.message || "Error al suscribir. Intentá de nuevo.", "error");
  }
}

function getDiscountCode() {
  return localStorage.getItem(DISCOUNT_KEY) || "";
}

// ============================================================
// Feed de actividad en tiempo real (prueba social)
// ============================================================
function startLiveActivity() {
  const el = document.getElementById("liveActivity");
  if (!el) return;
  // Respetar la decisión del usuario de cerrarlo (24h)
  const dismissed = parseInt(localStorage.getItem(LIVE_ACTIVITY_DISMISSED_KEY) || "0", 10);
  if (dismissed && Date.now() - dismissed < 24 * 60 * 60 * 1000) return;

  const totalGames = (allGames || []).length;
  const platforms = CONFIG.activePlatforms.length;
  const onSaleCount = (allGames || []).filter(g => g.onSale).length;

  const facts = [
    {
      type: "viewing",
      text: `<strong>${totalGames}+ juegos</strong><br>disponibles en el catálogo`,
      time: "actualizado hoy",
    },
    {
      type: "delivered",
      text: `<strong>${platforms} plataformas</strong><br>PS5, PS4, Xbox y Switch`,
      time: "disponibles",
    },
    {
      type: "delivered",
      text: `<strong>${onSaleCount} juegos en oferta</strong><br>con descuentos reales`,
      time: "hoy",
    },
    {
      type: "viewing",
      text: `<strong>Entrega en &lt;10 min</strong><br>por WhatsApp tras el pago`,
      time: "siempre",
    },
  ];
  let factIdx = 0;

  function buildActivity() {
    const f = facts[factIdx % facts.length];
    factIdx++;
    return f;
  }

  function showNext() {
    const a = buildActivity();
    const icons = {
      purchase: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
      viewing: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
      delivered: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    };
    el.innerHTML = `
      <button class="live-close" aria-label="Cerrar">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="live-icon ${a.type}">${icons[a.type]}</div>
      <div class="live-text">
        <div class="live-msg">${a.text}</div>
        <small class="live-time">${escapeHtml(a.time)}</small>
      </div>
    `;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => el.classList.remove("show"), 5500);
  }

  // No mostrar en estas rutas
  function shouldShow() {
    const r = parseRoute();
    return !["cart", "admin", "login", "mi-cuenta", "auth-callback"].includes(r.name);
  }

  let timer;
  function start() {
    if (timer) return;
    if (shouldShow()) showNext();
    timer = setInterval(() => {
      if (shouldShow()) showNext();
    }, 12000);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    el.classList.remove("show");
  }

  start();
  el.addEventListener("click", (e) => {
    if (e.target.closest(".live-close")) {
      localStorage.setItem(LIVE_ACTIVITY_DISMISSED_KEY, String(Date.now()));
      stop();
      el.hidden = true;
    }
  });
  // Pausar cuando la pestaña está oculta
  document.addEventListener("visibilitychange", () => {
    document.hidden ? stop() : start();
  });
}

// SEARCADE — pantalla "selecciona tu camiseta": carrusel en el perchero,
// ficha, vista de cerca y carrito que se envía por WhatsApp.
(() => {
  const CFG = window.SEARCADE_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => `${CFG.moneda || "₡"}${Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

  let data = { categorias: [], productos: [] };
  let filtro = "todas";
  let lista = [];
  let idx = 0;
  let talla = null;

  // ---------- Íconos ----------
  const ICON = {
    todas: '<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3Z"/>',
    pop: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8Z"/>',
    urbana: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5Z"/><path d="M5 22h14"/>',
    gamer: '<path d="M8 6h8a6 6 0 0 1 6 6v1a5 5 0 0 1-9 3h-2a5 5 0 0 1-9-3v-1a6 6 0 0 1 6-6Z"/><path d="M8 9.5v5M5.5 12h5"/><circle cx="16" cy="11" r=".6"/><circle cx="18" cy="13.5" r=".6"/>',
    anime: '<path d="M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20Z"/>',
    verano: '<path d="M12 22V11"/><path d="M12 11c-1-3-4-4-7-3 2-3 6-3 7 0 0-3 3-5 7-4-3 0-5 2-5 4 3-1 6 1 6 4-2-2-5-2-8-1Z"/><path d="M7 22h10"/>',
    otra: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
  };
  const icon = (id) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[id] || ICON.otra}</svg>`;
  const HOOK = `<svg class="hook" viewBox="0 0 60 44" aria-hidden="true"><path d="M30 3q8 0 8 7 0 6-8 8v5L4 40h52L30 23" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // Camiseta de muestra mientras no haya mockup PNG cargado.
  const SHIRT = "M60 18 L88 8 Q100 22 112 8 L140 18 L178 48 L160 78 L142 68 L142 196 L58 196 L58 68 L40 78 L22 48 Z";
  function teeSVG(p, uid) {
    const t1 = p.arte?.tono || "#ff2e88", t2 = p.arte?.tono2 || "#ffffff";
    const lineas = [];
    for (const w of String(p.arte?.texto || p.nombre).toUpperCase().split(/\s+/)) {
      const last = lineas[lineas.length - 1];
      if (last && (last + " " + w).length <= 9) lineas[lineas.length - 1] = last + " " + w; else lineas.push(w);
    }
    const id = `t${uid}`;
    const y0 = 132 - (lineas.length - 1) * 9;
    return `<svg viewBox="0 0 200 210" role="img" aria-label="${esc(p.nombre)}">
      <defs>
        <pattern id="${id}p" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="2.5" cy="2.5" r="1.4" fill="${t1}"/></pattern>
        <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t2}"/><stop offset="1" stop-color="${t1}"/></linearGradient>
        <radialGradient id="${id}r"><stop offset=".55" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <mask id="${id}m"><circle cx="100" cy="98" r="44" fill="url(#${id}r)"/></mask>
      </defs>
      <path d="${SHIRT}" fill="#121016" stroke="#2a2633" stroke-width="2" stroke-linejoin="round"/>
      <path d="M88 8 Q100 26 112 8" fill="none" stroke="#2a2633" stroke-width="3"/>
      <circle cx="100" cy="98" r="44" fill="url(#${id}p)" mask="url(#${id}m)"/>
      <circle cx="100" cy="90" r="24" fill="${t1}" opacity=".9"/>
      ${lineas.map((l, i) => `<text x="100" y="${y0 + i * 18}" text-anchor="middle" font-family="Kanit, sans-serif" font-style="italic" font-weight="900" font-size="${l.length > 8 ? 14 : 17}" fill="url(#${id}g)" stroke="#0b0614" stroke-width="3" paint-order="stroke">${esc(l)}</text>`).join("")}
    </svg>`;
  }
  const imgOr = (p, src, uid) => (src ? `<img src="${esc(src)}" alt="${esc(p.nombre)}" loading="lazy" draggable="false">` : teeSVG(p, uid));
  const waLink = (texto) => `https://wa.me/${String(CFG.whatsapp || "").replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
  const byId = (id) => data.productos.find((p) => p.id === id);

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- Categorías ----------
  function renderCats() {
    const cats = [{ id: "todas", nombre: "Todas" }, ...data.categorias];
    $("#cats").innerHTML = cats.map((c) => `<button class="cat" data-cat="${esc(c.id)}" aria-pressed="${c.id === filtro}">${icon(c.id)}<span>${esc(c.nombre)}</span></button>`).join("");
  }
  $("#cats").addEventListener("click", (e) => {
    const b = e.target.closest(".cat");
    if (!b || b.dataset.cat === filtro) return;
    filtro = b.dataset.cat;
    renderCats();
    armar(0);
  });

  // ---------- Carrusel ----------
  function armar(start) {
    lista = data.productos.filter((p) => filtro === "todas" || p.categoria === filtro);
    idx = Math.max(0, Math.min(start, lista.length - 1));
    $("#items").innerHTML = lista.length ? lista.map((p, i) => `
      <button class="item" data-i="${i}" style="--glow:${esc(p.arte?.tono || "#ff2e88")}" aria-label="${esc(p.nombre)}">
        ${HOOK}<span class="tee">${imgOr(p, p.imagen, "c" + i)}${p.nuevo ? '<span class="badge">NUEVO</span>' : ""}</span>
      </button>`).join("") : `<p class="empty">Pronto habrá diseños en esta categoría.</p>`;
    mover(idx, true);
  }

  function mover(i, sinHash) {
    if (!lista.length) { renderInfo(null); return; }
    idx = (i + lista.length) % lista.length;
    const step = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--step")) || 150;
    document.querySelectorAll(".item").forEach((el, j) => {
      let d = j - idx;
      // Camino más corto alrededor del carrusel
      if (d > lista.length / 2) d -= lista.length;
      if (d < -lista.length / 2) d += lista.length;
      const a = Math.abs(d);
      el.style.transform = `translateX(${d * step}px) translateZ(${-a * 170}px) rotateY(${d * -12}deg)`;
      el.style.zIndex = 20 - a;
      el.style.opacity = a > 2 ? 0 : 1;
      el.style.filter = a ? `brightness(${1 - a * 0.22})` : "";
      el.style.pointerEvents = a > 2 ? "none" : "";
      el.classList.toggle("is-center", d === 0);
      el.tabIndex = d === 0 ? 0 : -1;
    });
    $("#counter").textContent = `${idx + 1} / ${lista.length}`;
    renderInfo(lista[idx]);
    if (!sinHash) history.replaceState(null, "", `#${lista[idx].id}`);
  }

  $("#prev").addEventListener("click", () => mover(idx - 1));
  $("#next").addEventListener("click", () => mover(idx + 1));
  $("#ctlNav").addEventListener("click", () => mover(idx + 1));

  // Deslizar con el dedo o el mouse
  let x0 = null, arrastre = false;
  const stage = $("#stage");
  stage.addEventListener("pointerdown", (e) => { x0 = e.clientX; arrastre = false; });
  stage.addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) { arrastre = true; mover(idx + (dx < 0 ? 1 : -1)); }
  });
  $("#items").addEventListener("click", (e) => {
    const b = e.target.closest(".item");
    if (!b || arrastre) return;
    const i = +b.dataset.i;
    if (i === idx) abrirZoom(); else mover(i);
  });

  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]") || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === "ArrowLeft") mover(idx - 1);
    else if (e.key === "ArrowRight") mover(idx + 1);
    else if (e.key.toLowerCase() === "a" || (e.key === "Enter" && e.target === document.body)) abrirZoom();
  });

  // ---------- Ficha ----------
  function renderInfo(p) {
    talla = null;
    if (!p) { $("#infoName").textContent = ""; $("#infoDesc").textContent = ""; $("#infoPrice").textContent = ""; $("#sizes").innerHTML = ""; return; }
    const [w1, ...resto] = p.nombre.split(" ");
    $("#infoName").innerHTML = resto.length ? `${esc(w1)} <em>${esc(resto.join(" "))}</em>` : esc(w1);
    $("#infoDesc").textContent = p.descripcion || "";
    $("#infoPrice").textContent = fmt(p.precio);
    $("#infoMat").textContent = p.material || "Algodón premium";
    $("#sizes").innerHTML = (p.tallas || []).map((t) => `<button class="size" role="radio" aria-checked="false" data-t="${esc(t)}">${esc(t)}</button>`).join("");
  }
  $("#sizes").addEventListener("click", (e) => {
    const b = e.target.closest(".size");
    if (!b) return;
    talla = b.dataset.t;
    $("#sizes").querySelectorAll(".size").forEach((x) => x.setAttribute("aria-checked", x === b));
  });

  // ---------- Vista de cerca ----------
  function abrirZoom() {
    const p = lista[idx];
    if (!p) return;
    const fotos = [p.imagen, ...(p.fotos || [])].filter((f, i) => i === 0 || f);
    $("#zoomTitle").textContent = p.nombre;
    const ver = (src) => { $("#zoomPhoto").innerHTML = imgOr(p, src, "z") + (src ? "" : '<span class="slot">Espacio para mockup / foto con modelo (PNG)</span>'); };
    $("#zoomThumbs").innerHTML = fotos.length > 1 ? fotos.map((f, i) => `<button data-i="${i}" aria-current="${i === 0}" aria-label="Foto ${i + 1}">${imgOr(p, f, "zt" + i)}</button>`).join("") : "";
    $("#zoomThumbs").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $("#zoomThumbs").querySelectorAll("button").forEach((x) => x.setAttribute("aria-current", x === b));
      ver(fotos[+b.dataset.i]);
    };
    ver(fotos[0]);
    $("#zoom").showModal();
  }
  $("#ctlSel").addEventListener("click", abrirZoom);

  // ---------- Carrito ----------
  const KEY = "searcade-carrito";
  let carrito = [];
  try { carrito = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { carrito = []; }
  const guardar = () => { try { localStorage.setItem(KEY, JSON.stringify(carrito)); } catch {} };
  const lineas = () => carrito.map((l) => ({ ...l, p: byId(l.id) })).filter((l) => l.p);
  const total = () => lineas().reduce((s, l) => s + l.p.precio * l.qty, 0);

  function pintarCarrito() {
    const ls = lineas();
    const n = ls.reduce((s, l) => s + l.qty, 0);
    $("#cartCount").textContent = n;
    $("#cartCount").hidden = !n;
    $("#cartTotal").textContent = fmt(total());
    $("#cartSum").textContent = fmt(total());
    $("#cartList").innerHTML = ls.length ? ls.map((l, i) => `
      <li><span class="mini">${imgOr(l.p, l.p.imagen, "k" + i)}</span>
        <span><span class="nm">${esc(l.p.nombre)}</span><br><span class="meta">Talla ${esc(l.talla)} · ${fmt(l.p.precio)}</span></span>
        <span class="qty"><button data-k="${i}" data-d="-1" aria-label="Quitar uno">−</button><b>${l.qty}</b><button data-k="${i}" data-d="1" aria-label="Agregar uno">+</button></span></li>`).join("")
      : '<li class="cart-empty">Tu carrito está vacío. ¡Selecciona una camiseta!</li>';
    const wa = $("#cartWa");
    if (ls.length) {
      const msg = "¡Hola SEARCADE! 👋 Quiero hacer este pedido:\n\n" +
        ls.map((l) => `• ${l.qty}× ${l.p.nombre} (${l.p.id}) — Talla ${l.talla} — ${fmt(l.p.precio * l.qty)}`).join("\n") +
        `\n\nTotal: ${fmt(total())}\n\nNombre:\nLugar de entrega:`;
      wa.href = waLink(msg);
      wa.removeAttribute("aria-disabled");
    } else {
      wa.removeAttribute("href");
      wa.setAttribute("aria-disabled", "true");
    }
  }
  $("#cartList").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    const ls = lineas();
    const l = ls[+b.dataset.k];
    const real = carrito.find((x) => x.id === l.id && x.talla === l.talla);
    real.qty += +b.dataset.d;
    if (real.qty <= 0) carrito.splice(carrito.indexOf(real), 1);
    guardar();
    pintarCarrito();
  });

  $("#ctlAdd").addEventListener("click", () => {
    const p = lista[idx];
    if (!p) return;
    if (!talla) {
      const s = $("#sizes");
      s.classList.remove("shake"); void s.offsetWidth; s.classList.add("shake");
      if (matchMedia("(max-width: 999px)").matches) s.scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Elige tu talla primero");
      return;
    }
    const l = carrito.find((x) => x.id === p.id && x.talla === talla);
    if (l) l.qty++; else carrito.push({ id: p.id, talla, qty: 1 });
    guardar();
    pintarCarrito();
    const c = $("#cartBtn");
    c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
    toast(`✓ ${p.nombre} (${talla}) agregada`);
  });
  $("#cartBtn").addEventListener("click", () => { pintarCarrito(); $("#cart").showModal(); });

  // Cerrar ventanas: botón ✕ o tocar fuera
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
  });

  $("#customBtn").href = waLink("¡Hola SEARCADE! 👋 Quiero cotizar una camiseta personalizada con mi propio diseño.");

  // ---------- Datos ----------
  // Fase 1: productos.json. Fase 2: Supabase (ver config.js).
  function desdeHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id || lista[idx]?.id === id) return;
    let i = lista.findIndex((p) => p.id === id);
    if (i < 0 && byId(id)) { filtro = "todas"; renderCats(); armar(0); i = lista.findIndex((p) => p.id === id); }
    if (i >= 0) mover(i, true);
  }
  window.addEventListener("hashchange", desdeHash);
  addEventListener("resize", () => mover(idx, true));

  fetch("productos.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((d) => {
      data = d;
      renderCats();
      armar(0);
      desdeHash();
      pintarCarrito();
    })
    .catch(() => { $("#items").innerHTML = '<p class="empty">No se pudo cargar el catálogo. Recarga la página.</p>'; });
})();

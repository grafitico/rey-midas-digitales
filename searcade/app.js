// SEARCADE — pantalla "selecciona tu camiseta": carrusel en el perchero,
// personalizador (color, colocación, tamaño del arte y talla), vista de cerca
// y carrito que se envía por WhatsApp.
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

  // Camiseta de muestra (productos de ejemplo sin mockup).
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

  // ---------- Personalizador (dibujo compartido en tee.js) ----------
  const T = window.SearcadeTee;
  const { COLORES, FORMATOS, COLOCACIONES, colorDe, formatoDe, colocacionDe } = T;
  const sel = {
    color: COLORES[0].id,
    formato: (FORMATOS.find((f) => f.id === CFG.formatoInicial) || FORMATOS[FORMATOS.length - 1]).id,
    colocacion: COLOCACIONES[0].id,
    vista: "frente",
    espalda: null, // id del arte de la espalda (null = el mismo del frente)
  };
  let estilo = "todos"; // filtro: todos | semitono | full
  const precioDe = (p, o = sel) => (p.archivo ? p.precio + (formatoDe(o.formato).extra || 0) + (colocacionDe(o.colocacion).extra || 0) : p.precio);
  // Arte de la espalda: otro arte elegido en las fichas flotantes (o el mismo)
  const espaldaDe = (p, o) => (o.espalda && o.espalda !== p.id && o.colocacion !== "pecho" ? byId(o.espalda) : null);
  // En el perchero, las fichas y el carrito va la miniatura liviana del arte;
  // el archivo completo solo en la vista de cerca (camisetaGrande).
  const camiseta = (p, o = sel) => T.camiseta(p.mini ? { ...p, archivo: p.mini } : p, { ...o, espaldaArchivo: (espaldaDe(p, o)?.mini || espaldaDe(p, o)?.archivo) });
  const camisetaGrande = (p, o = sel) => T.camiseta(p, { ...o, espaldaArchivo: espaldaDe(p, o)?.archivo });
  const sello = (p) => (p.archivo ? `<span class="sello ${p.semitono ? "semi" : "full"}">${p.semitono ? "SEMITONO" : "FULL COLOR"}</span>` : "");
  const imgFoto = (p, src, uid) => (src ? `<img src="${esc(src)}" alt="${esc(p.nombre)}" loading="lazy" draggable="false">` : teeSVG(p, uid));
  // Artes: dos caras (frente y espalda) que giran en 3D; brillo que las recorre al girar.
  const caras = (p) => `<span class="cara frente">${camiseta(p, { ...sel, vista: "frente" })}<span class="brillo"></span></span><span class="cara espalda">${camiseta(p, { ...sel, vista: "espalda" })}<span class="brillo"></span></span>`;
  const teeDe = (p, i) => (p.archivo ? caras(p) : imgFoto(p, p.imagen, "c" + i));

  const waLink = (texto) => `https://wa.me/${String(CFG.whatsapp || "").replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
  const byId = (id) => data.productos.find((p) => p.id === id);

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- Medición (Meta Pixel / GA4, solo si están en config.js) ----------
  const AN = CFG.analitica || {};
  function cargarAnalitica() {
    if (/^\d{6,20}$/.test(AN.metaPixel || "")) {
      /* eslint-disable */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", AN.metaPixel);
      window.fbq("track", "PageView");
    }
    if (/^G-[A-Z0-9]{4,20}$/.test(AN.ga4 || "")) {
      const sc = document.createElement("script");
      sc.async = true;
      sc.src = `https://www.googletagmanager.com/gtag/js?id=${AN.ga4}`;
      document.head.appendChild(sc);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", AN.ga4);
    }
  }
  const GA = { ViewContent: "view_item", AddToCart: "add_to_cart", InitiateCheckout: "begin_checkout", Contact: "generate_lead", Share: "share" };
  function medir(evento, datos = {}) {
    try {
      if (window.fbq) window.fbq(evento === "Share" ? "trackCustom" : "track", evento, datos);
      if (window.gtag) window.gtag("event", GA[evento] || evento, datos);
    } catch {}
  }
  cargarAnalitica();
  let vistoTimer;
  const medirVista = (p) => {
    clearTimeout(vistoTimer);
    vistoTimer = setTimeout(() => medir("ViewContent", { content_ids: [p.id], content_name: p.nombre, content_type: "product", value: p.precio, currency: "CRC" }), 1500);
  };

  // ---------- Categorías ----------
  function renderCats() {
    const conDiseños = new Set(data.productos.map((p) => p.categoria));
    const cats = [{ id: "todas", nombre: "Todas" }, ...data.categorias.filter((c) => conDiseños.has(c.id))];
    $("#cats").innerHTML = cats.map((c) => `<button class="cat" data-cat="${esc(c.id)}" aria-pressed="${c.id === filtro}">${icon(c.id)}<span>${esc(c.nombre)}</span></button>`).join("");
  }
  $("#cats").addEventListener("click", (e) => {
    const b = e.target.closest(".cat");
    if (!b || b.dataset.cat === filtro) return;
    filtro = b.dataset.cat;
    renderCats();
    armar(0);
  });

  // Filtro Todos / Semitono / Full color (solo si hay artes de los dos tipos)
  function pintarEstilos() {
    const artes = data.productos.filter((p) => p.archivo);
    const hay = artes.some((p) => p.semitono) && artes.some((p) => !p.semitono);
    $("#estilos").hidden = !hay;
    $("#estilos").innerHTML = [["todos", "Todos"], ["semitono", "Semitono"], ["full", "Full color"]]
      .map(([id, n]) => `<button role="radio" aria-checked="${id === estilo}" data-e="${id}">${n}</button>`).join("");
  }
  $("#estilos").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-e]");
    if (!b || b.dataset.e === estilo) return;
    estilo = b.dataset.e;
    pintarEstilos();
    armar(0);
  });

  // ---------- Carrusel ----------
  function armar(start) {
    lista = data.productos.filter((p) => (filtro === "todas" || p.categoria === filtro) && (estilo === "todos" || (p.archivo && (estilo === "semitono") === !!p.semitono)));
    idx = Math.max(0, Math.min(start, lista.length - 1));
    $("#items").innerHTML = lista.length ? lista.map((p, i) => `
      <button class="item" data-i="${i}" style="--glow:${esc(p.arte?.tono || "#fbb51d")}" aria-label="${esc(p.nombre)}">
        <span class="colgante">${HOOK}<span class="inclina"><span class="tee${p.archivo ? ` volteable${sel.vista === "espalda" ? " volteada" : ""}` : ""}">${teeDe(p, i)}</span></span>${p.nuevo ? '<span class="badge">NUEVO</span>' : ""}${sello(p)}</span>
      </button>`).join("") : `<p class="empty">Pronto habrá diseños en esta categoría.</p>`;
    mover(idx, true);
  }
  // ---------- Fichas flotantes: elegir el arte de la espalda ----------
  function pintarFichas() {
    const p = lista[idx];
    // Respeta el filtro Semitono / Full color (el arte ya elegido se queda visible)
    const actualId = espaldaDe(p || {}, sel)?.id || null;
    const artes = data.productos.filter((x) => x.archivo && (estilo === "todos" || (estilo === "semitono") === !!x.semitono || x.id === actualId));
    const box = $("#fichas");
    box.hidden = !p?.archivo || !artes.some((x) => x.id !== p.id);
    if (box.hidden) return;
    const actual = espaldaDe(p, sel)?.id || null;
    $("#fichasLista").innerHTML =
      `<button class="ficha-arte mismo" data-e="" aria-pressed="${!actual}" style="--d:0s"><span class="fa-img">↺</span><span class="fa-n">Mismo arte</span></button>` +
      artes.filter((x) => x.id !== p.id).map((x, i) => `<button class="ficha-arte" data-e="${esc(x.id)}" aria-pressed="${x.id === actual}" style="--d:${((i + 1) * 0.37) % 3}s"><span class="fa-img"><img src="${esc(x.mini || x.archivo)}" alt="" draggable="false" loading="lazy"></span><span class="fa-n">${esc(x.nombre)}</span></button>`).join("");
  }
  $("#fichasLista").addEventListener("click", (e) => {
    const b = e.target.closest(".ficha-arte");
    if (!b) return;
    sel.espalda = b.dataset.e || null;
    if (sel.espalda && sel.colocacion === "pecho") { sel.colocacion = "ambas"; pintarPerso(); pintarPrecio(); }
    repintarArtes();
    pintarFichas();
    if (sel.espalda || sel.colocacion !== "pecho") girar("espalda");
    if (sel.espalda) toast(`Espalda: ${byId(sel.espalda)?.nombre}`);
  });

  // Redibuja las camisetas con arte (al cambiar color, tamaño, colocación o lado).
  function repintarArtes() {
    document.querySelectorAll(".item").forEach((el) => {
      const p = lista[+el.dataset.i];
      if (p?.archivo) el.querySelector(".tee").innerHTML = caras(p);
    });
  }

  function mover(i, sinHash) {
    if (!lista.length) { renderInfo(null); return; }
    idx = (i + lista.length) % lista.length;
    const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--step-k")) || 0.6;
    const step = (document.querySelector(".item")?.offsetWidth || 220) * k;
    document.querySelectorAll(".item").forEach((el, j) => {
      let d = j - idx;
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
    medirVista(lista[idx]);
    if (!sinHash) history.replaceState(null, "", `#${lista[idx].id}`);
  }

  $("#prev").addEventListener("click", () => mover(idx - 1));
  $("#next").addEventListener("click", () => mover(idx + 1));
  $("#ctlNav").addEventListener("click", () => mover(idx + 1));

  let x0 = null, arrastre = false;
  const stage = $("#stage");
  stage.addEventListener("pointerdown", (e) => { x0 = e.clientX; arrastre = false; });
  stage.addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) { arrastre = true; mover(idx + (dx < 0 ? 1 : -1)); }
  });
  // La camiseta del centro se inclina siguiendo el mouse (como un objeto real)
  stage.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const c = document.querySelector(".item.is-center .inclina");
    if (!c) return;
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    c.style.setProperty("--ry", `${(x * 22).toFixed(1)}deg`);
    c.style.setProperty("--rx", `${(-y * 10).toFixed(1)}deg`);
  });
  stage.addEventListener("pointerleave", () => {
    document.querySelectorAll(".inclina").forEach((c) => { c.style.removeProperty("--ry"); c.style.removeProperty("--rx"); });
  });
  $("#items").addEventListener("click", (e) => {
    const b = e.target.closest(".item");
    if (!b || arrastre) return;
    const i = +b.dataset.i;
    if (i === idx) abrirZoom(); else mover(i);
  });

  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]") || $("#intro")?.isConnected || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === "ArrowLeft") mover(idx - 1);
    else if (e.key === "ArrowRight") mover(idx + 1);
    else if (e.key.toLowerCase() === "a" || (e.key === "Enter" && e.target === document.body)) abrirZoom();
  });

  // Girar la camiseta (frente / espalda)
  function girar(vista) {
    if (vista === sel.vista) return;
    sel.vista = vista;
    document.querySelectorAll(".tee.volteable").forEach((t) => {
      t.classList.toggle("volteada", vista === "espalda");
      t.classList.remove("brillando"); void t.offsetWidth; t.classList.add("brillando");
    });
    pintarGirar();
  }
  function pintarGirar() {
    const p = lista[idx];
    $("#girar").hidden = !p?.archivo;
    $("#girarTxt").textContent = sel.vista === "frente" ? "VER ESPALDA" : "VER FRENTE";
  }
  $("#girar").addEventListener("click", () => girar(sel.vista === "frente" ? "espalda" : "frente"));

  // ---------- Textos de cada arte (propios del panel o automáticos por categoría) ----------
  const AUTO = CFG.textosAuto || {};
  const elegir = (lista, semilla) => {
    if (!lista?.length) return "";
    let h = 0;
    for (const ch of String(semilla)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return lista[h % lista.length];
  };
  function textos(p) {
    const cat = p.categoria in (AUTO.coleccion || {}) ? p.categoria : "otra";
    return {
      coleccion: p.coleccion || AUTO.coleccion?.[cat] || (data.categorias.find((c) => c.id === p.categoria)?.nombre || "SEARCADE"),
      lema: p.lema || elegir(AUTO.lemas?.[cat], p.id),
      descripcion: p.descripcionPropia || (p.archivo ? elegir(AUTO.descripciones?.[cat], p.id + "d") : "") || p.descripcion || "",
    };
  }
  function pintarLema(texto) {
    const el = $("#lema");
    if (el.dataset.t === texto) return;
    el.dataset.t = texto;
    el.classList.remove("entra"); void el.offsetWidth;
    el.textContent = texto;
    el.classList.add("entra");
  }

  // ---------- Ficha ----------
  function renderInfo(p) {
    talla = null;
    if (!p) { $("#infoName").textContent = ""; $("#infoDesc").textContent = ""; $("#infoPrice").textContent = ""; $("#sizes").innerHTML = ""; $("#perso").hidden = true; return; }
    const [w1, ...resto] = p.nombre.split(" ");
    $("#infoName").innerHTML = resto.length ? `${esc(w1)} <em>${esc(resto.join(" "))}</em>` : esc(w1);
    const tx = textos(p);
    $("#infoDesc").textContent = tx.descripcion;
    $("#infoCat").textContent = tx.coleccion.toUpperCase();
    pintarLema(tx.lema);
    $("#perso").hidden = !p.archivo;
    $("#feats").innerHTML = [
      [FEAT.algodon, p.material || "Algodón premium", "Suave, resistente y transpirable."],
      p.archivo && p.semitono
        ? [FEAT.capas, "Impresión DTF · Semitono", "Los puntos dejan ver el color de la camiseta."]
        : [FEAT.capas, "Impresión DTF · Full color", "Colores intensos y de larga duración."],
      [FEAT.corona, "Diseño exclusivo", "Edición limitada SEARCADE."],
    ].map(([ico, t, d]) => `<div class="feat">${ico}<p><b>${esc(t)}</b><span>${esc(d)}</span></p></div>`).join("");
    aplicarAcento(p);
    if (p.archivo) pintarPerso();
    pintarPrecio();
    pintarFichas();
    pintarTallas(p);
    pintarGirar();
  }
  const pintarPrecio = () => {
    const p = lista[idx];
    if (!p) return;
    const precio = precioDe(p);
    $("#infoPrice").textContent = fmt(precio);
    $("#precioEt").textContent = precio > p.precio ? "TU CAMISETA" : "DESDE";
  };
  const FEAT = {
    algodon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21v-7M12 14c-2-3-7-2-7 1.5S9 20 12 14Zm0 0c2-3 7-2 7 1.5S15 20 12 14ZM8 8a4 4 0 0 1 8 0 3.5 3.5 0 0 1 3 5.5M8 8a3.5 3.5 0 0 0-3 5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    capas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    corona: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  };

  // ---------- Color de ambiente: el color dominante de cada arte ----------
  const acentos = new Map();
  function colorDominante(src) {
    return new Promise((ok) => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = document.createElement("canvas"); c.width = c.height = 48;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(im, 0, 0, 48, 48);
          const d = ctx.getImageData(0, 0, 48, 48).data;
          const bins = new Array(24).fill(0), sum = new Array(24).fill(0).map(() => [0, 0]);
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 128) continue;
            const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, ch = max - min;
            if (ch < 0.18 || l < 0.15 || l > 0.9) continue; // grises, negros y blancos no cuentan
            let h = max === r ? ((g - b) / ch) % 6 : max === g ? (b - r) / ch + 2 : (r - g) / ch + 4;
            h = (h * 60 + 360) % 360;
            const k = Math.floor(h / 15), peso = ch * ch;
            bins[k] += peso; sum[k][0] += Math.cos(h * Math.PI / 180) * peso; sum[k][1] += Math.sin(h * Math.PI / 180) * peso;
          }
          const k = bins.indexOf(Math.max(...bins));
          if (!bins[k]) return ok(null);
          const h = Math.round((Math.atan2(sum[k][1], sum[k][0]) * 180 / Math.PI + 360) % 360);
          ok(`hsl(${h} 90% 56%)`);
        } catch { ok(null); }
      };
      im.onerror = () => ok(null);
      im.src = src;
    });
  }
  async function aplicarAcento(p) {
    let c = p.arte?.tono && !p.archivo ? p.arte.tono : null;
    if (p.archivo) {
      if (!acentos.has(p.archivo)) acentos.set(p.archivo, colorDominante(p.mini || p.archivo));
      c = await acentos.get(p.archivo);
    }
    if (lista[idx] !== p) return; // ya se movió a otra camiseta
    document.documentElement.style.setProperty("--acento", c || "#fbb51d");
  }
  // Tallas: pestañas Adultos / Niños (solo se ve un grupo a la vez)
  let grupoTalla = null;
  function pintarTallas(p) {
    const t = p.archivo && CFG.tallas && !Array.isArray(CFG.tallas) ? CFG.tallas : { "": p.tallas || [] };
    const grupos = Object.keys(t);
    const orden = grupos.slice().sort((a, b) => (/adult/i.test(b) ? 1 : 0) - (/adult/i.test(a) ? 1 : 0)); // Adultos primero
    if (!grupos.includes(grupoTalla)) grupoTalla = orden[0];
    const tabs = grupos.length > 1 ? `<div class="talla-tabs" role="tablist">${orden.map((g) => `<button role="tab" data-g="${esc(g)}" aria-selected="${g === grupoTalla}">${esc(g.replace(/\s*\(.*\)/, ""))}</button>`).join("")}</div>` : "";
    $("#sizes").innerHTML = tabs + `<div class="talla-chips">${(t[grupoTalla] || []).map((x) => `<button class="size" role="radio" aria-checked="${x === talla}" data-t="${esc(x)}">${esc(/^\d+$/.test(x) ? x + "a" : x)}</button>`).join("")}</div>`;
  }
  const etiquetaTalla = (t) => (/^\d+$/.test(t) ? `${t} años` : t);
  const extraTxt = (n) => (n ? ` <small>+${fmt(n)}</small>` : "");
  function pintarPerso() {
    $("#colorNombre").textContent = `· ${colorDe(sel.color).nombre}`;
    $("#colores").innerHTML = COLORES.map((c) => `<button class="swatch" role="radio" aria-checked="${c.id === sel.color}" aria-label="${esc(c.nombre)}" title="${esc(c.nombre)}" data-c="${esc(c.id)}" style="--sw:${esc(c.hex)}"></button>`).join("");
    $("#colocaciones").innerHTML = COLOCACIONES.map((c) => `<button role="radio" aria-checked="${c.id === sel.colocacion}" data-v="${esc(c.id)}">${esc(c.nombre)}${extraTxt(c.extra)}</button>`).join("");
    const f = formatoDe(sel.formato);
    $("#formatoMedida").textContent = `· ${f.ancho} × ${f.alto} cm`;
    $("#formatos").innerHTML = FORMATOS.map((x) => `<button role="radio" aria-checked="${x.id === sel.formato}" data-v="${esc(x.id)}" title="${esc(x.nota || "")}">${esc(x.nombre)}${extraTxt(x.extra)}</button>`).join("");
  }
  $("#colores").addEventListener("click", (e) => {
    const b = e.target.closest(".swatch");
    if (!b || b.dataset.c === sel.color) return;
    sel.color = b.dataset.c;
    pintarPerso();
    repintarArtes();
  });
  $("#colocaciones").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b || b.dataset.v === sel.colocacion) return;
    sel.colocacion = b.dataset.v;
    pintarPerso();
    pintarPrecio();
    // Mostrar el lado donde va el arte
    if (sel.colocacion === "espalda") girar("espalda");
    else if (sel.colocacion === "pecho") girar("frente");
    else repintarArtes();
  });
  $("#formatos").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b || b.dataset.v === sel.formato) return;
    sel.formato = b.dataset.v;
    pintarPerso();
    pintarPrecio();
    repintarArtes();
  });
  $("#sizes").addEventListener("click", (e) => {
    const g = e.target.closest("[data-g]");
    if (g) { grupoTalla = g.dataset.g; const p = lista[idx]; if (p) pintarTallas(p); return; }
    const b = e.target.closest(".size");
    if (!b) return;
    talla = b.dataset.t;
    $("#sizes").querySelectorAll(".size").forEach((x) => x.setAttribute("aria-checked", x === b));
  });

  // ---------- Vista de cerca ----------
  function abrirZoom() {
    const p = lista[idx];
    if (!p) return;
    let vistas;
    if (p.archivo) {
      vistas = [
        { html: () => camisetaGrande(p, { ...sel, vista: "frente" }), thumb: "Frente" },
        { html: () => camisetaGrande(p, { ...sel, vista: "espalda" }), thumb: "Espalda" },
        { html: () => `<img src="${esc(p.archivo)}" alt="${esc(p.nombre)}" class="solo-arte" draggable="false">`, thumb: "Arte" },
      ];
      if (sel.vista === "espalda") vistas.unshift(vistas.splice(1, 1)[0]);
    } else {
      const fotos = [p.imagen, ...(p.fotos || [])].filter(Boolean);
      vistas = (fotos.length ? fotos : [""]).map((f, i) => ({ html: () => imgFoto(p, f, "z" + i) + (f ? "" : '<span class="slot">Espacio para mockup / foto con modelo (PNG)</span>'), thumb: null }));
    }
    $("#zoomTitle").textContent = p.nombre;
    const ver = (i) => { $("#zoomPhoto").innerHTML = vistas[i].html(); };
    $("#zoomThumbs").innerHTML = vistas.length > 1 ? vistas.map((v, i) => `<button data-i="${i}" aria-current="${i === 0}" aria-label="${esc(v.thumb || `Foto ${i + 1}`)}">${v.html()}${v.thumb ? `<span>${esc(v.thumb)}</span>` : ""}</button>`).join("") : "";
    $("#zoomThumbs").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $("#zoomThumbs").querySelectorAll("button").forEach((x) => x.setAttribute("aria-current", x === b));
      ver(+b.dataset.i);
    };
    ver(0);
    $("#zoom").showModal();
  }
  $("#ctlSel").addEventListener("click", abrirZoom);

  // ---------- Carrito ----------
  const KEY = "searcade-carrito";
  let carrito = [];
  try { carrito = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { carrito = []; }
  const guardar = () => { try { localStorage.setItem(KEY, JSON.stringify(carrito)); } catch {} };
  const mismaLinea = (a, b) => a.id === b.id && a.talla === b.talla && a.color === b.color && a.formato === b.formato && a.colocacion === b.colocacion && (a.espalda || null) === (b.espalda || null);
  const lineas = () => carrito.map((l) => ({ ...l, p: byId(l.id) })).filter((l) => l.p);
  const total = () => lineas().reduce((s, l) => s + precioDe(l.p, l) * l.qty, 0);
  const detalle = (l) => {
    if (!l.p.archivo) return `Talla ${etiquetaTalla(l.talla)}`;
    const f = formatoDe(l.formato);
    const esp = espaldaDe(l.p, l);
    return `Camiseta ${colorDe(l.color).nombre.toLowerCase()}, talla ${etiquetaTalla(l.talla)} · Arte ${f.nombre.toLowerCase()} (${f.ancho} × ${f.alto} cm) en ${colocacionDe(l.colocacion).nombre.toLowerCase()}${esp ? ` · Espalda: ${esp.nombre}` : ""}`;
  };

  function pintarCarrito() {
    const ls = lineas();
    const n = ls.reduce((s, l) => s + l.qty, 0);
    $("#cartCount").textContent = n;
    $("#cartCount").hidden = !n;
    $("#cartTotal").textContent = fmt(total());
    $("#cartSum").textContent = fmt(total());
    $("#cartList").innerHTML = ls.length ? ls.map((l, i) => `
      <li><span class="mini">${l.p.archivo ? camiseta(l.p, { ...l, vista: l.colocacion === "espalda" ? "espalda" : "frente" }) : imgFoto(l.p, l.p.imagen || l.p.fotos?.[0], "k" + i)}</span>
        <span><span class="nm">${esc(l.p.nombre)}</span><br><span class="meta">${esc(detalle(l))} · ${fmt(precioDe(l.p, l))}</span></span>
        <span class="qty"><button data-k="${i}" data-d="-1" aria-label="Quitar uno">−</button><b>${l.qty}</b><button data-k="${i}" data-d="1" aria-label="Agregar uno">+</button></span></li>`).join("")
      : '<li class="cart-empty">Tu carrito está vacío. ¡Selecciona una camiseta!</li>';
    const wa = $("#cartWa");
    if (ls.length) {
      const msg = "¡Hola SEARCADE! 👋 Quiero hacer este pedido:\n\n" +
        ls.map((l) => { const esp = espaldaDe(l.p, l); return `• ${l.qty}× ${l.p.nombre} — ${fmt(precioDe(l.p, l) * l.qty)}\n   ${detalle(l)}\n   Código: ${l.p.id}${esp ? ` / espalda ${esp.id}` : ""}`; }).join("\n") +
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
    const l = lineas()[+b.dataset.k];
    const real = carrito.find((x) => mismaLinea(x, l));
    real.qty += +b.dataset.d;
    if (real.qty <= 0) carrito.splice(carrito.indexOf(real), 1);
    guardar();
    pintarCarrito();
  });

  // Compra ahora: agrega y abre el carrito
  $("#comprar").addEventListener("click", () => { if (agregar()) { pintarCarrito(); $("#cart").showModal(); } });
  $("#ctlAdd").addEventListener("click", () => agregar());
  function agregar() {
    const p = lista[idx];
    if (!p) return false;
    if (!talla) {
      const s = $("#sizes");
      s.classList.remove("shake"); void s.offsetWidth; s.classList.add("shake");
      if (matchMedia("(max-width: 999px)").matches) s.scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Elige tu talla primero");
      return false;
    }
    const nueva = p.archivo
      ? { id: p.id, talla, color: sel.color, formato: sel.formato, colocacion: sel.colocacion, espalda: espaldaDe(p, sel)?.id || null, qty: 1 }
      : { id: p.id, talla, qty: 1 };
    const l = carrito.find((x) => mismaLinea(x, nueva));
    if (l) l.qty++; else carrito.push(nueva);
    guardar();
    pintarCarrito();
    const btn = $("#cartBtn");
    btn.classList.remove("bump"); void btn.offsetWidth; btn.classList.add("bump");
    toast(`✓ ${p.nombre} (talla ${etiquetaTalla(talla)}) agregada`);
    medir("AddToCart", { content_ids: [p.id], content_name: p.nombre, content_type: "product", value: precioDe(p, nueva), currency: "CRC" });
    return true;
  }
  $("#cartBtn").addEventListener("click", () => { pintarCarrito(); $("#cart").showModal(); });
  $("#cartWa").addEventListener("click", () => { if (lineas().length) medir("InitiateCheckout", { value: total(), currency: "CRC", num_items: lineas().reduce((s, l) => s + l.qty, 0) }); });

  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
  });

  // Protección de los artes: sin "guardar imagen" (clic derecho / mantener
  // presionado) ni arrastrar sobre camisetas y artes. Los archivos públicos ya
  // son vistas previas chicas con marca de agua; el original es privado.
  document.addEventListener("contextmenu", (e) => { if (e.target.closest(".tee, .comp, .zoom-photo, .zoom-thumbs, .fichas, .mini")) e.preventDefault(); });
  document.addEventListener("dragstart", (e) => { if (e.target.closest?.(".comp, .fichas, .zoom-photo")) e.preventDefault(); });

  $("#customBtn").href = waLink("¡Hola SEARCADE! 👋 Quiero cotizar una camiseta personalizada con mi propio diseño.");
  $("#customBtn").addEventListener("click", () => medir("Contact", { tipo: "personalizada" }));

  // ---------- Compra, envío, guía de tallas y redes (desde config.js) ----------
  $("#notaCompra").innerHTML = [
    CFG.envio && `<span>📦 ${esc(CFG.envio)}</span>`,
    CFG.pagos && `<span>💳 ${esc(CFG.pagos)}</span>`,
    `<span>💬 Confirmás tu pedido por WhatsApp: ahí coordinamos ${CFG.pagos ? "" : "el pago y "}la entrega.</span>`,
  ].filter(Boolean).join("");
  if (CFG.envioCorto) $("#envioCorto").textContent = CFG.envioCorto;
  const GUIA = CFG.guiaTallas || {};
  const gruposGuia = Object.keys(GUIA).filter((g) => Object.keys(GUIA[g] || {}).length);
  if (gruposGuia.length) {
    $("#guiaBtn").hidden = false;
    $("#guiaTablas").innerHTML = gruposGuia.map((g) => `<h3>${esc(g)}</h3><table class="guia-tabla"><thead><tr><th>Talla</th><th>Ancho</th><th>Largo</th></tr></thead><tbody>${
      Object.entries(GUIA[g]).map(([t, [an, la]]) => `<tr><td>${esc(etiquetaTalla(t))}</td><td>${esc(an)} cm</td><td>${esc(la)} cm</td></tr>`).join("")}</tbody></table>`).join("");
    $("#guiaBtn").addEventListener("click", () => $("#guia").showModal());
  }
  const REDES = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook" };
  const redes = Object.entries(CFG.redes || {}).filter(([k, u]) => REDES[k] && /^https:\/\//.test(u || ""));
  if (redes.length) {
    $("#redes").hidden = false;
    $("#redes").innerHTML = "Seguinos: " + redes.map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${REDES[k]}</a>`).join(" · ");
  }

  // ---------- Compartir un diseño ----------
  // /d/<id> es una página con la vista previa de ESE diseño (d.php) que
  // después abre la tienda en #<id>.
  const enlaceDe = (p) => `${location.origin}/d/${encodeURIComponent(p.id)}`;
  $("#compartir").addEventListener("click", async () => {
    const p = lista[idx];
    if (!p) return;
    const url = enlaceDe(p);
    const texto = `Mirá esta camiseta de SEARCADE: ${p.nombre}`;
    medir("Share", { id: p.id });
    try {
      if (navigator.share) return await navigator.share({ title: p.nombre, text: texto, url });
    } catch (e) { if (e?.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); toast("🔗 Enlace copiado"); }
    catch { location.href = waLink(`${texto}\n${url}`); }
  });

  // ---------- Enlaces directos (#id) ----------
  function desdeHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id || lista[idx]?.id === id) return;
    let i = lista.findIndex((p) => p.id === id);
    if (i < 0 && byId(id)) { filtro = "todas"; renderCats(); armar(0); i = lista.findIndex((p) => p.id === id); }
    if (i >= 0) mover(i, true);
  }
  window.addEventListener("hashchange", () => { desdeHash(); $("#stage").scrollIntoView({ behavior: "smooth", block: "center" }); });

  // ---------- Pantalla de entrada ----------
  // Se ve una vez cada 7 días, sigue sola a los 1,6 s (o con un toque) y no
  // aparece si se llega con un enlace directo a un diseño (#id).
  const intro = $("#intro");
  const SEMANA = 7 * 864e5;
  let visto = false;
  try { visto = Date.now() - Number(localStorage.getItem("searcade-start") || 0) < SEMANA; } catch {}
  const empezar = () => {
    if (!intro.isConnected || intro.classList.contains("go")) return;
    intro.classList.add("go");
    try { localStorage.setItem("searcade-start", String(Date.now())); } catch {}
    setTimeout(() => intro.remove(), 650);
  };
  if (visto || location.hash.length > 1 || matchMedia("(prefers-reduced-motion: reduce)").matches) intro.remove();
  else {
    intro.addEventListener("click", empezar);
    addEventListener("keydown", empezar, { once: true });
    setTimeout(empezar, 1600);
  }
  addEventListener("resize", () => mover(idx, true));

  // Teléfono: la barra NAVEGAR / SELECCIONAR / AGREGAR solo con el perchero a la vista
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => document.body.classList.toggle("sin-controles", !e.isIntersecting), { rootMargin: "0px 0px -15% 0px" }).observe($("#stage"));
  }

  // ---------- Lookbook: fotos que el dueño sube desde el panel ----------
  function pintarLookbook(fotos) {
    if (!fotos.length) return; // queda la foto de ejemplo
    const marco = $("#look .look-photo");
    marco.classList.add("slider");
    marco.innerHTML = fotos.map((f, i) => `<img src="${esc(f.archivo)}" alt="${esc(f.titulo || "Lookbook SEARCADE")}" loading="${i ? "lazy" : "eager"}" class="${i ? "" : "on"}">`).join("");
    $("#lookBtn").textContent = "Elegir mi camiseta";
    $("#lookBtn").setAttribute("href", "#stage");
    $("#lookBtn").addEventListener("click", (e) => { e.preventDefault(); $("#stage").scrollIntoView({ behavior: "smooth", block: "center" }); });
    $("#lookDots").innerHTML = fotos.length > 1 ? fotos.map((f, i) => `<button aria-label="Foto ${i + 1}" aria-current="${i === 0}" data-i="${i}"></button>`).join("") : "";
    let actual = 0, pausa = false, t;
    const ver = (i) => {
      actual = (i + fotos.length) % fotos.length;
      marco.querySelectorAll("img").forEach((im, j) => im.classList.toggle("on", j === actual));
      $("#lookDots").querySelectorAll("button").forEach((b, j) => b.setAttribute("aria-current", j === actual));
      const tit = fotos[actual].titulo || "Lookbook SEARCADE";
      const [p1, ...p2] = tit.split(" ");
      $("#lookTitulo").innerHTML = p2.length ? `${esc(p1)} <em>${esc(p2.join(" "))}</em>` : esc(p1);
    };
    const siguiente = () => { clearTimeout(t); t = setTimeout(() => { if (!pausa) ver(actual + 1); siguiente(); }, 5000); };
    $("#lookDots").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) { ver(+b.dataset.i); siguiente(); } });
    marco.addEventListener("pointerenter", () => (pausa = true));
    marco.addEventListener("pointerleave", () => (pausa = false));
    ver(0);
    if (fotos.length > 1) siguiente();
  }

  // ---------- Datos ----------
  const desdeArte = (a) => ({
    id: a.id, nombre: a.nombre, categoria: a.categoria, archivo: a.archivo, mini: a.mini || "", semitono: !!a.semitono,
    coleccion: a.coleccion || "", lema: a.lema || "", descripcionPropia: a.descripcion || "",
    precio: a.precio || CFG.precioBase || 11000,
    descripcion: CFG.descripcionArte || "", material: "Algodón premium",
    arte: { tono: "#fbb51d" },
  });
  const cargarJSON = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([cargarJSON("productos.json"), cargarJSON(`artes/artes.json?t=${Date.now()}`), T.precargar()])
    .then(([d, a]) => {
      if (!d) throw new Error("sin catálogo");
      const artes = (a?.artes || []).map(desdeArte);
      // Con artes reales, los ejemplos dibujados se retiran (quedan los que tengan foto propia).
      data = { categorias: d.categorias, productos: artes.length ? [...artes, ...d.productos.filter((p) => p.imagen || p.fotos?.length)] : d.productos };
      pintarLookbook([...(a?.lookbook || []), ...(CFG.lookbook || [])]);
      renderCats();
      pintarEstilos();
      armar(0);
      desdeHash();
      pintarCarrito();
    })
    .catch(() => { $("#items").innerHTML = '<p class="empty">No se pudo cargar el catálogo. Recarga la página.</p>'; });
})();

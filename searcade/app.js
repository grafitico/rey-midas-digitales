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

  // ---------- Personalizador ----------
  const COLORES = CFG.colores?.length ? CFG.colores : [{ id: "negra", nombre: "Negra", hex: "#141218", frente: CFG.camisetaBase }];
  const FORMATOS = CFG.formatos?.length ? CFG.formatos : [{ id: "grande", nombre: "Grande", ancho: 28, alto: 35, extra: 0 }];
  const COLOCACIONES = CFG.colocaciones?.length ? CFG.colocaciones : [{ id: "pecho", nombre: "Pecho", extra: 0 }];
  const FOTO = CFG.foto || { cmAncho: 1.26, cmAlto: 1.23, pecho: { top: 23.5 }, pechoIzquierdo: { centro: 61, top: 21.5 }, espalda: { top: 15 }, espaldaArriba: { top: 9 } };
  const blancaRef = COLORES.find((c) => c.frente && c.id === "blanca") || COLORES.find((c) => c.frente);
  const sel = {
    color: COLORES[0].id,
    formato: (FORMATOS.find((f) => f.id === CFG.formatoInicial) || FORMATOS[FORMATOS.length - 1]).id,
    colocacion: COLOCACIONES[0].id,
    vista: "frente",
  };
  const cargadas = new Set(); // imágenes base que sí cargaron
  const colorDe = (id) => COLORES.find((c) => c.id === id) || COLORES[0];
  const formatoDe = (id) => FORMATOS.find((f) => f.id === id) || FORMATOS[0];
  const colocacionDe = (id) => COLOCACIONES.find((c) => c.id === id) || COLOCACIONES[0];
  const precioDe = (p, o = sel) => (p.archivo ? p.precio + (formatoDe(o.formato).extra || 0) + (colocacionDe(o.colocacion).extra || 0) : p.precio);
  const lleva = (colocacion, vista) => colocacion === "ambas" || (colocacion === "pecho" ? vista === "frente" : vista === "espalda");

  // Dónde va el arte (en % de la foto) según tamaño, lado y medidas reales.
  function zonaArte(formatoId, vista) {
    const f = formatoDe(formatoId);
    const w = f.ancho * FOTO.cmAncho, h = f.alto * FOTO.cmAlto;
    const chico = f.ancho <= 12;
    if (vista === "frente" && chico) return { left: FOTO.pechoIzquierdo.centro - w / 2, top: FOTO.pechoIzquierdo.top, w, h };
    const top = vista === "frente" ? FOTO.pecho.top : chico ? FOTO.espaldaArriba.top : FOTO.espalda.top;
    return { left: 50 - w / 2, top, w, h };
  }

  // Camiseta base del color y lado pedidos. Los colores sin foto tiñen la blanca.
  function baseHTML(colorId, vista) {
    const c = colorDe(colorId);
    const propia = c[vista] || (vista === "espalda" ? null : c.frente);
    if (propia && cargadas.has(propia)) return `<img class="base" src="${esc(propia)}" alt="" draggable="false">`;
    const ref = blancaRef && (blancaRef[vista] || blancaRef.frente);
    if (ref && cargadas.has(ref)) {
      const tinte = `<span class="tinte" style="--tinte:${esc(c.hex)};--mask:url('${esc(ref)}')"></span>`;
      const et = vista === "frente" && FOTO.etiqueta ? `<img class="etq" src="${esc(FOTO.etiqueta.src)}" alt="" style="left:${FOTO.etiqueta.x}%;top:${FOTO.etiqueta.y}%;width:${FOTO.etiqueta.ancho}%;height:${FOTO.etiqueta.alto}%">` : "";
      return `<img class="base" src="${esc(ref)}" alt="" draggable="false">${tinte}${et}`;
    }
    return `<svg class="base" viewBox="0 0 200 210" aria-hidden="true"><path d="${SHIRT}" fill="${esc(c.hex)}" stroke="#2a2633" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }
  // Camiseta con el arte puesto (o sin arte si ese lado no lleva).
  function camiseta(p, o = sel) {
    const vista = o.vista || "frente";
    let arte = "";
    if (lleva(o.colocacion, vista)) {
      const z = zonaArte(o.formato, vista);
      arte = `<img class="print" src="${esc(p.archivo)}" alt="${esc(p.nombre)}" loading="lazy" draggable="false" style="left:${z.left}%;top:${z.top}%;width:${z.w}%;height:${z.h}%">`;
    }
    const sinFoto = !cargadas.size;
    return `<span class="comp${sinFoto ? " sin-base" : ""}" data-vista="${vista}">${baseHTML(o.color, vista)}${arte}</span>`;
  }
  const imgFoto = (p, src, uid) => (src ? `<img src="${esc(src)}" alt="${esc(p.nombre)}" loading="lazy" draggable="false">` : teeSVG(p, uid));
  const teeDe = (p, i) => (p.archivo ? camiseta(p) : imgFoto(p, p.imagen, "c" + i));

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
      <button class="item" data-i="${i}" style="--glow:${esc(p.arte?.tono || "#fbb51d")}" aria-label="${esc(p.nombre)}">
        ${HOOK}<span class="tee">${teeDe(p, i)}</span>${p.nuevo ? '<span class="badge">NUEVO</span>' : ""}
      </button>`).join("") : `<p class="empty">Pronto habrá diseños en esta categoría.</p>`;
    mover(idx, true);
  }
  // Redibuja las camisetas con arte (al cambiar color, tamaño, colocación o lado).
  function repintarArtes() {
    document.querySelectorAll(".item").forEach((el) => {
      const p = lista[+el.dataset.i];
      if (p?.archivo) el.querySelector(".tee").innerHTML = camiseta(p);
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
    const centro = document.querySelector(".item.is-center .tee");
    centro?.classList.remove("girando"); void centro?.offsetWidth; centro?.classList.add("girando");
    setTimeout(repintarArtes, 180); // a mitad del giro
    pintarGirar();
  }
  function pintarGirar() {
    const p = lista[idx];
    $("#girar").hidden = !p?.archivo;
    $("#girarTxt").textContent = sel.vista === "frente" ? "VER ESPALDA" : "VER FRENTE";
  }
  $("#girar").addEventListener("click", () => girar(sel.vista === "frente" ? "espalda" : "frente"));

  // ---------- Ficha ----------
  function renderInfo(p) {
    talla = null;
    if (!p) { $("#infoName").textContent = ""; $("#infoDesc").textContent = ""; $("#infoPrice").textContent = ""; $("#sizes").innerHTML = ""; $("#perso").hidden = true; return; }
    const [w1, ...resto] = p.nombre.split(" ");
    $("#infoName").innerHTML = resto.length ? `${esc(w1)} <em>${esc(resto.join(" "))}</em>` : esc(w1);
    $("#infoDesc").textContent = p.descripcion || "";
    $("#infoMat").textContent = p.material || "Algodón premium";
    $("#perso").hidden = !p.archivo;
    if (p.archivo) pintarPerso();
    pintarPrecio();
    pintarTallas(p);
    pintarGirar();
  }
  const pintarPrecio = () => { const p = lista[idx]; if (p) $("#infoPrice").textContent = fmt(precioDe(p)); };
  function pintarTallas(p) {
    const t = p.archivo && CFG.tallas && !Array.isArray(CFG.tallas) ? CFG.tallas : { "": p.tallas || [] };
    $("#sizes").innerHTML = Object.entries(t).map(([grupo, ts]) =>
      `${grupo ? `<span class="size-grupo">${esc(grupo)}</span>` : ""}${ts.map((x) => `<button class="size" role="radio" aria-checked="false" data-t="${esc(x)}">${esc(x)}</button>`).join("")}`).join("");
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
        { html: () => camiseta(p, { ...sel, vista: "frente" }), thumb: "Frente" },
        { html: () => camiseta(p, { ...sel, vista: "espalda" }), thumb: "Espalda" },
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
  const mismaLinea = (a, b) => a.id === b.id && a.talla === b.talla && a.color === b.color && a.formato === b.formato && a.colocacion === b.colocacion;
  const lineas = () => carrito.map((l) => ({ ...l, p: byId(l.id) })).filter((l) => l.p);
  const total = () => lineas().reduce((s, l) => s + precioDe(l.p, l) * l.qty, 0);
  const detalle = (l) => {
    if (!l.p.archivo) return `Talla ${etiquetaTalla(l.talla)}`;
    const f = formatoDe(l.formato);
    return `Camiseta ${colorDe(l.color).nombre.toLowerCase()}, talla ${etiquetaTalla(l.talla)} · Arte ${f.nombre.toLowerCase()} (${f.ancho} × ${f.alto} cm) en ${colocacionDe(l.colocacion).nombre.toLowerCase()}`;
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
      const sitio = location.origin.startsWith("http") ? location.origin : "https://searcade.reymidascr.com";
      const msg = "¡Hola SEARCADE! 👋 Quiero hacer este pedido:\n\n" +
        ls.map((l) => `• ${l.qty}× ${l.p.nombre} (${l.p.id}) — ${fmt(precioDe(l.p, l) * l.qty)}\n   ${detalle(l)}${l.p.archivo ? `\n   Arte: ${sitio}/${l.p.archivo}` : ""}`).join("\n") +
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
    const nueva = p.archivo
      ? { id: p.id, talla, color: sel.color, formato: sel.formato, colocacion: sel.colocacion, qty: 1 }
      : { id: p.id, talla, qty: 1 };
    const l = carrito.find((x) => mismaLinea(x, nueva));
    if (l) l.qty++; else carrito.push(nueva);
    guardar();
    pintarCarrito();
    const btn = $("#cartBtn");
    btn.classList.remove("bump"); void btn.offsetWidth; btn.classList.add("bump");
    toast(`✓ ${p.nombre} (talla ${etiquetaTalla(talla)}) agregada`);
  });
  $("#cartBtn").addEventListener("click", () => { pintarCarrito(); $("#cart").showModal(); });

  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
  });

  $("#customBtn").href = waLink("¡Hola SEARCADE! 👋 Quiero cotizar una camiseta personalizada con mi propio diseño.");

  // ---------- Enlaces directos (#id) ----------
  function desdeHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id || lista[idx]?.id === id) return;
    let i = lista.findIndex((p) => p.id === id);
    if (i < 0 && byId(id)) { filtro = "todas"; renderCats(); armar(0); i = lista.findIndex((p) => p.id === id); }
    if (i >= 0) mover(i, true);
  }
  window.addEventListener("hashchange", () => { desdeHash(); $("#stage").scrollIntoView({ behavior: "smooth", block: "center" }); });

  // ---------- Pantalla de entrada (una vez por sesión) ----------
  const intro = $("#intro");
  let visto = false;
  try { visto = sessionStorage.getItem("searcade-start") === "1"; } catch {}
  const empezar = () => {
    if (!intro.isConnected || intro.classList.contains("go")) return;
    intro.classList.add("go");
    try { sessionStorage.setItem("searcade-start", "1"); } catch {}
    setTimeout(() => intro.remove(), 650);
  };
  if (visto) intro.remove();
  else {
    intro.addEventListener("click", empezar);
    addEventListener("keydown", empezar, { once: true });
  }
  addEventListener("resize", () => mover(idx, true));

  // ---------- Datos ----------
  const desdeArte = (a) => ({
    id: a.id, nombre: a.nombre, categoria: a.categoria, archivo: a.archivo,
    precio: a.precio || CFG.precioBase || 11000,
    descripcion: CFG.descripcionArte || "", material: "Algodón premium",
    arte: { tono: "#fbb51d" },
  });
  const cargarJSON = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const precargar = () => {
    const urls = [...new Set(COLORES.flatMap((c) => [c.frente, c.espalda]).filter(Boolean))];
    return Promise.all(urls.map((u) => new Promise((ok) => {
      const im = new Image();
      im.onload = () => {
        cargadas.add(u);
        if (!document.documentElement.style.getPropertyValue("--base-ar")) document.documentElement.style.setProperty("--base-ar", `${im.naturalWidth} / ${im.naturalHeight}`);
        ok();
      };
      im.onerror = () => ok();
      im.src = u;
    })));
  };

  Promise.all([cargarJSON("productos.json"), cargarJSON(`artes/artes.json?t=${Date.now()}`), precargar()])
    .then(([d, a]) => {
      if (!d) throw new Error("sin catálogo");
      const artes = (a?.artes || []).map(desdeArte);
      // Con artes reales, los ejemplos dibujados se retiran (quedan los que tengan foto propia).
      data = { categorias: d.categorias, productos: artes.length ? [...artes, ...d.productos.filter((p) => p.imagen || p.fotos?.length)] : d.productos };
      renderCats();
      armar(0);
      desdeHash();
      pintarCarrito();
    })
    .catch(() => { $("#items").innerHTML = '<p class="empty">No se pudo cargar el catálogo. Recarga la página.</p>'; });
})();

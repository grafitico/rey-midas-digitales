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

  // ---------- Íconos (galería en iconos.js; una categoría puede tener emoji) ----------
  const IC = window.SEARCADE_ICONOS;
  const icon = (id) => IC.svg((data.categorias.find((c) => c.id === id) || {}).icono, id);
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
    // Arte de la espalda POR camiseta: { idDeLaCamiseta: idDelArteDeAtrás }.
    // Elegir una ficha cambia solo la camiseta seleccionada, no todas.
    espaldas: {},
    // Arte del frente POR camiseta (otro arte elegido en las fichas con la camiseta de frente)
    frentes: {},
  };
  let estilo = "todos"; // filtro: todos | semitono | full
  let subFiltro = ""; // subcategoría dentro de la categoría ("" = todas)
  // Artes de recorte (oscuras): solo en camisetas oscuras. Si el color elegido
  // no va con el arte (o con el de la espalda), se muestra en negra.
  const OSCUROS = new Set(CFG.coloresOscuros || ["negra", "azul", "morada", "verde"]);
  const CLAROS = new Set(CFG.coloresClaros || ["blanca", "gris"]);
  const coloresDe = (p, o = sel) => {
    const e = espaldaDe(p || {}, o), f = frenteDe(p || {}, o);
    const osc = (f || p)?.oscuras || e?.oscuras, cla = (f || p)?.claras || e?.claras;
    if (osc && cla) return COLORES; // frente y espalda piden cosas opuestas: no limitar
    return osc ? COLORES.filter((c) => OSCUROS.has(c.id)) : cla ? COLORES.filter((c) => CLAROS.has(c.id)) : COLORES;
  };
  const colorEf = (p, o = sel) => { const cs = coloresDe(p, o); return cs.some((c) => c.id === o.color) ? o.color : cs[0].id; };
  const precioDe = (p, o = sel) => (p.archivo ? p.precio + (formatoDe(o.formato).extra || 0) + (colocacionDe(o.colocacion).extra || 0) : p.precio);
  // Arte de la espalda: otro arte elegido en las fichas flotantes (o el mismo)
  // o = sel (o una copia): usa el mapa por camiseta; o = línea del carrito: su campo espalda.
  const espaldaDe = (p, o) => {
    const e = o.espaldas ? o.espaldas[p.id] : o.espalda;
    return e && e !== p.id && o.colocacion !== "pecho" ? byId(e) : null;
  };
  // Arte del frente: otro arte elegido en las fichas con la camiseta de frente
  const frenteDe = (p, o) => {
    const f = o.frentes ? o.frentes[p.id] : o.frente;
    return f && f !== p.id && o.colocacion !== "espalda" ? byId(f) : null;
  };
  // Archivos de cada lado (miniatura en el perchero; completo en la vista de cerca).
  // Con otro frente, la espalda "mismo arte" es el diseño original.
  const ladosArte = (p, o, grande) => {
    const a = (x) => (grande ? x.archivo : x.mini || x.archivo);
    const fr = frenteDe(p, o), es = espaldaDe(p, o);
    return { frente: a(fr || p), espalda: es ? a(es) : fr ? a(p) : undefined };
  };
  // Lado que muestra cada camiseta: la seleccionada, el que eligió el cliente;
  // las demás, el lado donde va el arte.
  const ladoNatural = () => (sel.colocacion === "espalda" ? "espalda" : "frente");
  const ladoDe = (i) => (i === idx ? sel.vista : ladoNatural());
  // En el perchero, las fichas y el carrito va la miniatura liviana del arte;
  // el archivo completo solo en la vista de cerca (camisetaGrande).
  const camiseta = (p, o = sel) => { const l = ladosArte(p, o); return T.camiseta({ ...p, archivo: l.frente }, { ...o, color: colorEf(p, o), espaldaArchivo: l.espalda }); };
  const camisetaGrande = (p, o = sel) => { const l = ladosArte(p, o, true); return T.camiseta({ ...p, archivo: l.frente }, { ...o, color: colorEf(p, o), espaldaArchivo: l.espalda }); };
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
  // Categorías para adultos (config.js: categoriasAdultas): al final del menú,
  // fuera de "Todas", de la búsqueda y de "Arma tu espalda", y con aviso +18.
  const ADULTAS = new Set(CFG.categoriasAdultas || ["hentai"]);
  const esAdulto = (p) => ADULTAS.has(p?.categoria);
  let edadOk = false;
  try { edadOk = localStorage.getItem("searcade-18") === "1"; } catch {}
  function pedirEdad(seguir) {
    if (edadOk) return seguir();
    const d = $("#edad");
    $("#edadSi").onclick = () => { edadOk = true; try { localStorage.setItem("searcade-18", "1"); } catch {} d.close(); seguir(); };
    $("#edadNo").onclick = () => d.close();
    d.showModal();
  }
  function renderCats() {
    const conDiseños = new Set(data.productos.map((p) => p.categoria));
    const visibles = data.categorias.filter((c) => conDiseños.has(c.id));
    const cats = [{ id: "todas", nombre: "Todas" }, ...visibles.filter((c) => !ADULTAS.has(c.id)), ...visibles.filter((c) => ADULTAS.has(c.id))];
    $("#cats").innerHTML = cats.map((c) => `<button class="cat" data-cat="${esc(c.id)}" aria-pressed="${c.id === filtro}">${icon(c.id)}<span>${esc(c.nombre)}</span></button>`).join("");
  }
  $("#cats").addEventListener("click", (e) => {
    const b = e.target.closest(".cat");
    if (!b || (b.dataset.cat === filtro && !busqueda)) return;
    const ir = () => {
      filtro = b.dataset.cat;
      subFiltro = "";
      limpiarBusqueda();
      renderCats();
      pintarSubs();
      armar(0);
    };
    if (ADULTAS.has(b.dataset.cat)) pedirEdad(ir); else ir();
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

  // Subcategorías (p. ej. Anime → Attack on Titan): solo con una categoría elegida
  function pintarSubs() {
    // En el orden del panel; las que no estén en la lista van al final
    const orden = data.categorias.find((c) => c.id === filtro)?.subs || [];
    const usadas = new Set(filtro === "todas" ? [] : data.productos.filter((p) => p.categoria === filtro && p.sub).map((p) => p.sub));
    const subs = [...orden.filter((x) => usadas.has(x)), ...[...usadas].filter((x) => !orden.includes(x)).sort((a, b) => a.localeCompare(b, "es"))];
    if (!subs.includes(subFiltro)) subFiltro = "";
    $("#subs").hidden = !subs.length;
    requestAnimationFrame(() => {
      const box = $("#subs");
      box.classList.toggle("centro", box.scrollWidth <= box.clientWidth + 2); // pocas: centradas
      const b = box.querySelector('[aria-checked="true"]'); // la elegida a la vista (sin mover la página)
      if (b) box.scrollLeft = b.offsetLeft - box.offsetLeft - (box.clientWidth - b.offsetWidth) / 2;
    });
    $("#subs").innerHTML = subs.length ? [["", "Todos"], ...subs.map((x) => [x, x])]
      .map(([id, n]) => `<button role="radio" aria-checked="${id === subFiltro}" data-s="${esc(id)}">${esc(n)}</button>`).join("") : "";
  }
  $("#subs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-s]");
    if (!b || b.dataset.s === subFiltro) return;
    subFiltro = b.dataset.s;
    pintarSubs();
    armar(0);
  });

  // En el teléfono: categorías → subcategorías → vista (en la compu, arriba del perchero)
  const MQ = matchMedia("(min-width: 1000px)");
  function ubicarFiltros() {
    if (MQ.matches) { $(".arena").before($("#subs")); $("#subs").after($("#vistaBar")); }
    else { $("#cats").after($("#subs")); $("#subs").after($("#vistaBar")); }
  }
  MQ.addEventListener?.("change", ubicarFiltros);

  // ---------- Buscador ----------
  let busqueda = "";
  const normB = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const textoBusqueda = (p) => (p._b ||= normB(`${p.nombre} ${p.sub || ""} ${data.categorias.find((c) => c.id === p.categoria)?.nombre || p.categoria} ${p.codigo || ""} ${p.coleccion || ""}`));
  function limpiarBusqueda() { busqueda = ""; $("#buscar").value = ""; $("#buscarX").hidden = true; }
  let tBuscar;
  $("#buscar").addEventListener("input", () => {
    clearTimeout(tBuscar);
    tBuscar = setTimeout(() => {
      busqueda = normB($("#buscar").value);
      $("#buscarX").hidden = !busqueda;
      armar(0);
    }, 200);
  });
  $("#buscar").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#buscar").blur(); } });
  $("#buscarX").addEventListener("click", () => { limpiarBusqueda(); armar(0); $("#buscar").focus(); });

  // ---------- Perchero o cuadrícula ----------
  let vistaElegida = null, mantenerVista = false;
  try { vistaElegida = localStorage.getItem("searcade-vista"); } catch {}
  let vista = vistaElegida || "perchero";
  $("#vistaTog").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    vista = vistaElegida = b.dataset.v;
    try { localStorage.setItem("searcade-vista", vista); } catch {}
    pintarVista();
  });
  let limiteGrilla = 0;
  const POR_PAGINA = 36;
  function pintarVista() {
    const g = vista === "grilla" && lista.length > 0;
    document.body.classList.toggle("modo-grilla", g);
    $("#stage").hidden = g;
    $("#grilla").hidden = !g;
    $("#vistaTog").querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", b.dataset.v === (g ? "grilla" : "perchero")));
    mover(idx, true); // ficha y barra de compra al día (también en cuadrícula, para la ficha de la compu)
    if (g) { limiteGrilla = POR_PAGINA; pintarGrilla(); }
  }
  function pintarGrilla() {
    const ver = lista.slice(0, limiteGrilla);
    $("#grillaItems").innerHTML = ver.map((p, i) => `<button class="g-item" data-i="${i}" type="button">
        <span class="g-tee">${p.archivo ? camiseta(p, { ...sel, vista: "frente" }) : imgFoto(p, p.imagen, "g" + i)}</span>
        <span class="g-txt"><b>${esc(p.nombre)}</b><small>${esc(p.sub || data.categorias.find((c) => c.id === p.categoria)?.nombre || "")}</small><em>${fmt(p.precio)}</em></span>
      </button>`).join("");
    $("#grillaMas").hidden = lista.length <= limiteGrilla;
    $("#grillaMas").textContent = `Ver más diseños (${lista.length - limiteGrilla})`;
  }
  $("#grillaMas").addEventListener("click", () => {
    const antes = limiteGrilla;
    limiteGrilla += POR_PAGINA;
    const box = $("#grillaItems");
    const extra = document.createElement("template");
    extra.innerHTML = lista.slice(antes, limiteGrilla).map((p, k) => { const i = antes + k; return `<button class="g-item" data-i="${i}" type="button"><span class="g-tee">${p.archivo ? camiseta(p, { ...sel, vista: "frente" }) : imgFoto(p, p.imagen, "g" + i)}</span><span class="g-txt"><b>${esc(p.nombre)}</b><small>${esc(p.sub || data.categorias.find((c) => c.id === p.categoria)?.nombre || "")}</small><em>${fmt(p.precio)}</em></span></button>`; }).join("");
    box.append(extra.content);
    $("#grillaMas").hidden = lista.length <= limiteGrilla;
    $("#grillaMas").textContent = `Ver más diseños (${lista.length - limiteGrilla})`;
  });
  // Tocar un diseño de la cuadrícula: se abre en el perchero con su ficha
  $("#grillaItems").addEventListener("click", (e) => {
    const b = e.target.closest(".g-item");
    if (!b) return;
    vista = "perchero";
    pintarVista();
    mover(+b.dataset.i);
    requestAnimationFrame(() => $("#stage").scrollIntoView({ behavior: "smooth", block: "start" }));
  });
  function pintarCuenta() {
    const n = String(lista.length).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const donde = busqueda ? `para “${$("#buscar").value.trim()}”` : subFiltro || (filtro === "todas" ? "" : data.categorias.find((c) => c.id === filtro)?.nombre || "");
    $("#cuentaLista").innerHTML = lista.length ? `<b>${n}</b> diseño${lista.length === 1 ? "" : "s"}${donde ? ` · ${esc(donde)}` : ""}` : (busqueda ? `Sin resultados ${esc(donde)}` : "");
  }

  // ---------- Carrusel ----------
  function armar(start) {
    const pasaEstilo = (p) => estilo === "todos" || (p.archivo && (estilo === "semitono") === !!p.semitono);
    if (busqueda) {
      const palabras = busqueda.split(" ");
      lista = data.productos.filter((p) => !esAdulto(p) && pasaEstilo(p) && palabras.every((w) => textoBusqueda(p).includes(w)));
    } else {
      lista = data.productos.filter((p) => (filtro === "todas" ? !esAdulto(p) : p.categoria === filtro) && (!subFiltro || p.sub === subFiltro) && pasaEstilo(p));
    }
    idx = Math.max(0, Math.min(start, lista.length - 1));
    $("#items").innerHTML = lista.length ? "" : `<p class="empty">${busqueda ? "No encontramos diseños con esa búsqueda. Probá con otra palabra o escribinos por WhatsApp: te lo diseñamos." : "Pronto habrá diseños en esta categoría."}</p>`;
    // Sin elección del cliente: cuadrícula al buscar o con una subcategoría; perchero si no
    if (!vistaElegida && !mantenerVista) vista = busqueda || subFiltro ? "grilla" : "perchero";
    mantenerVista = false;
    pintarCuenta();
    $("#cats").querySelectorAll(".cat").forEach((b) => b.setAttribute("aria-pressed", !busqueda && b.dataset.cat === filtro));
    $("#subs").hidden = !!busqueda || !$("#subs").children.length;
    pintarVista();
  }
  // Con miles de artes no se pueden dibujar todas las camisetas: en el perchero
  // solo existen las que están a VENTANA pasos de la del centro (las demás no se
  // verían: desde 3 pasos son transparentes).
  const VENTANA = 4;
  const itemHTML = (p, i) => `<button class="item" data-i="${i}" style="--glow:${esc(p.archivo ? "#19e6ffaa" : p.arte?.tono || "#19e6ffaa")}" aria-label="${esc(p.nombre)}">
        <span class="colgante">${HOOK}<span class="inclina"><span class="tee${p.archivo ? ` volteable${ladoDe(i) === "espalda" ? " volteada" : ""}` : ""}">${teeDe(p, i)}</span></span>${p.nuevo ? '<span class="badge">NUEVO</span>' : ""}${sello(p)}</span>
      </button>`;
  const distancia = (j) => {
    let d = j - idx;
    if (d > lista.length / 2) d -= lista.length;
    if (d < -lista.length / 2) d += lista.length;
    return d;
  };
  function pintarVentana() {
    const box = $("#items");
    const quiero = new Set();
    for (let d = -VENTANA; d <= VENTANA; d++) quiero.add(((idx + d) % lista.length + lista.length) % lista.length);
    box.querySelectorAll(".item").forEach((el) => { if (!quiero.has(+el.dataset.i)) el.remove(); });
    const hay = new Set([...box.querySelectorAll(".item")].map((el) => +el.dataset.i));
    for (const i of quiero) {
      if (hay.has(i)) continue;
      const t = document.createElement("template");
      t.innerHTML = itemHTML(lista[i], i).trim();
      const el = t.content.firstChild;
      const a = Math.abs(distancia(i));
      el.style.opacity = a > 2 ? 0 : 1; // entra sin saltar desde el centro
      box.appendChild(el);
    }
  }
  // ---------- Fichas flotantes: otro arte para el lado que se está viendo ----------
  const ladoFicha = () => sel.vista; // las fichas cambian el lado que muestra la camiseta
  const elegidoEn = (p, lado) => (lado === "frente" ? frenteDe(p, sel) : espaldaDe(p, sel))?.id || null;
  $("#fichasLado").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-l]");
    if (!b || b.dataset.l === sel.vista) return;
    girar(b.dataset.l, true);
    pintarFichas();
  });
  const MAX_FICHAS = 40;
  function pintarFichas() {
    const p = lista[idx];
    // Respeta el filtro Semitono / Full color (el arte ya elegido se queda visible)
    const actualId = p ? elegidoEn(p, ladoFicha()) : null;
    // Con miles de artes: primero los de la misma subcategoría y categoría, hasta MAX_FICHAS
    const peso = (x) => (x.id === actualId ? 0 : p?.sub && x.sub === p.sub ? 1 : x.categoria === p?.categoria ? 2 : 3);
    const artes = data.productos.filter((x) => x.archivo && (esAdulto(x) === esAdulto(p)) && (estilo === "todos" || (estilo === "semitono") === !!x.semitono || x.id === actualId))
      .map((x, i) => [x, peso(x), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).slice(0, MAX_FICHAS + 1).map(([x]) => x);
    const box = $("#fichas");
    box.hidden = !p?.archivo || !artes.some((x) => x.id !== p.id);
    if (box.hidden) return;
    const lado = ladoFicha(), actual = elegidoEn(p, lado);
    $("#fichasLado").querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", b.dataset.l === lado));
    $("#fichasTit").textContent = lado === "frente" ? "toca un arte y va al frente" : "toca un arte y va atrás";
    $("#fichasLista").innerHTML =
      `<button class="ficha-arte mismo" data-e="" aria-pressed="${!actual}" style="--d:0s"><span class="fa-img">↺</span><span class="fa-n">Mismo arte</span></button>` +
      artes.filter((x) => x.id !== p.id).map((x, i) => `<button class="ficha-arte" data-e="${esc(x.id)}" aria-pressed="${x.id === actual}" style="--d:${((i + 1) * 0.37) % 3}s"><span class="fa-img"><img src="${esc(x.mini || x.archivo)}" alt="" draggable="false" loading="lazy"></span><span class="fa-n">${esc(x.nombre)}</span></button>`).join("");
  }
  $("#fichasLista").addEventListener("click", (e) => {
    const b = e.target.closest(".ficha-arte");
    if (!b) return;
    const p = lista[idx];
    if (!p) return;
    const elegido = b.dataset.e || null;
    const lado = ladoFicha();
    const mapa = lado === "frente" ? sel.frentes : sel.espaldas;
    if (elegido) mapa[p.id] = elegido; else delete mapa[p.id];
    // El lado elegido tiene que llevar estampado
    if (elegido && lado === "espalda" && sel.colocacion === "pecho") sel.colocacion = "ambas";
    if (elegido && lado === "frente" && sel.colocacion === "espalda") sel.colocacion = "ambas";
    pintarPrecio();
    pintarPerso(); // el arte nuevo puede ser solo para camisetas oscuras o claras
    repintarArtes();
    pintarFichas();
    girar(lado, true);
    if (elegido) toast(`${lado === "frente" ? "Frente" : "Espalda"}: ${byId(elegido)?.nombre}`);
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
    const nuevo = (i + lista.length) % lista.length;
    if (nuevo !== idx) sel.vista = ladoNatural();
    idx = nuevo;
    pintarVentana();
    ladosEnPerchero();
    const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--step-k")) || 0.6;
    const step = (document.querySelector(".item")?.offsetWidth || 220) * k;
    document.querySelectorAll(".item").forEach((el) => {
      const d = distancia(+el.dataset.i);
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
  // Solo gira la camiseta seleccionada (forzar: brilla aunque ya esté de ese lado).
  function girar(vista, forzar) {
    if (vista === sel.vista && !forzar) return;
    sel.vista = vista;
    const t = document.querySelector(`.item[data-i="${idx}"] .tee.volteable`);
    if (t) {
      t.classList.toggle("volteada", vista === "espalda");
      t.classList.remove("brillando"); void t.offsetWidth; t.classList.add("brillando");
    }
    pintarGirar();
    pintarFichas();
  }
  // Al cambiar de camiseta o de colocación, cada una vuelve a su lado.
  function ladosEnPerchero() {
    document.querySelectorAll(".item").forEach((el) => {
      el.querySelector(".tee.volteable")?.classList.toggle("volteada", ladoDe(+el.dataset.i) === "espalda");
    });
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
    if (!p) { $("#infoName").textContent = ""; $("#infoDesc").textContent = ""; $("#infoPrice").textContent = ""; $("#sizes").innerHTML = ""; $("#perso").hidden = true; $("#pasoColor").hidden = true; return; }
    const [w1, ...resto] = p.nombre.split(" ");
    $("#infoName").innerHTML = resto.length ? `${esc(w1)} <em>${esc(resto.join(" "))}</em>` : esc(w1);
    const tx = textos(p);
    $("#infoDesc").textContent = tx.descripcion;
    $("#infoCat").textContent = tx.coleccion.toUpperCase();
    pintarLema(tx.lema);
    $("#perso").hidden = !p.archivo;
    $("#pasoColor").hidden = !p.archivo;
    $("#feats").innerHTML = [
      [FEAT.algodon, p.material || "Algodón premium", "Suave, resistente y transpirable."],
      p.archivo && p.semitono
        ? [FEAT.capas, "Impresión DTF · Semitono", "Los puntos dejan ver el color de la camiseta."]
        : [FEAT.capas, "Impresión DTF · Full color", "Colores intensos y de larga duración."],
      [FEAT.corona, "Diseño exclusivo", "Edición limitada SEARCADE."],
    ].map(([ico, t, d]) => `<div class="feat">${ico}<p><b>${esc(t)}</b><span>${esc(d)}</span></p></div>`).join("");
    $("#verPuesta").hidden = !p.fotosModelo?.length;
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
    pintarBarra();
  };
  // Barra fija de abajo (teléfono): nombre, precio y un solo botón
  function pintarBarra() {
    const p = lista[idx];
    if (!p) return;
    $("#cbNombre").textContent = p.nombre;
    $("#cbPrecio").textContent = fmt(precioDe(p));
    $("#ctlAddTxt").textContent = talla ? "AGREGAR AL CARRITO" : "ELEGIR TALLA";
    $("#comprarTxt").textContent = talla ? `AGREGAR · ${fmt(precioDe(p))}` : "ELEGÍ TU TALLA";
  }
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
    const p = lista[idx];
    const ef = colorEf(p);
    $("#colorNombre").textContent = `· ${colorDe(ef).nombre}${coloresDe(p).length < COLORES.length ? (coloresDe(p).every((c) => CLAROS.has(c.id)) ? " · arte para camisetas claras" : " · arte para camisetas oscuras") : ""}`;
    $("#colores").innerHTML = coloresDe(p).map((c) => `<button class="swatch" role="radio" aria-checked="${c.id === ef}" aria-label="${esc(c.nombre)}" title="${esc(c.nombre)}" data-c="${esc(c.id)}" style="--sw:${esc(c.hex)}"></button>`).join("");
    $("#colocaciones").innerHTML = COLOCACIONES.map((c) => `<button role="radio" aria-checked="${c.id === sel.colocacion}" data-v="${esc(c.id)}">${esc(c.nombre)}${extraTxt(c.extra)}</button>`).join("");
    const f = formatoDe(sel.formato);
    $("#formatoMedida").textContent = `· ${f.ancho} × ${f.alto} cm`;
    $("#formatos").innerHTML = FORMATOS.map((x) => `<button role="radio" aria-checked="${x.id === sel.formato}" data-v="${esc(x.id)}" title="${esc(x.nota || "")}">${esc(x.nombre)}${extraTxt(x.extra)}</button>`).join("");
    // Resumen en "Personalizar (opcional)": lo elegido sin abrirlo
    const esp = p && espaldaDe(p, sel), fre = p && frenteDe(p, sel);
    $("#persoResumen").textContent = `${colocacionDe(sel.colocacion).nombre} · ${f.nombre} ${f.ancho}×${f.alto} cm${fre ? ` · Frente: ${fre.nombre}` : ""}${esp ? ` · Espalda: ${esp.nombre}` : ""}`;
  }
  $("#colores").addEventListener("click", (e) => {
    const b = e.target.closest(".swatch");
    if (!b || b.dataset.c === colorEf(lista[idx])) return;
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
    repintarArtes();
    if (sel.colocacion === "espalda") girar("espalda");
    else if (sel.colocacion === "pecho") girar("frente");
    ladosEnPerchero();
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
    pintarBarra();
  });

  // ---------- Vista de cerca ----------
  // Vista de cerca: frente, espalda y cada arte por separado; tocar amplía (2,5×) y se mueve
  // con el dedo o el mouse; flechas, teclado y deslizar cambian de vista.
  function abrirZoom(conModelo) {
    const p = lista[idx];
    if (!p) return;
    let vistas;
    if (p.archivo) {
      const l = ladosArte(p, sel, true);
      const nombreDe = (lado) => (lado === "frente" ? frenteDe(p, sel) || p : espaldaDe(p, sel) || (frenteDe(p, sel) ? p : null))?.nombre || p.nombre;
      const lleva = (lado) => T.lleva(sel.colocacion, lado);
      vistas = [
        { html: () => camisetaGrande(p, { ...sel, vista: "frente" }), thumb: "Frente", lado: "frente" },
        { html: () => camisetaGrande(p, { ...sel, vista: "espalda" }), thumb: "Espalda", lado: "espalda" },
      ];
      if (lleva("frente")) vistas.push({ html: () => `<img src="${esc(l.frente)}" alt="${esc(nombreDe("frente"))}" class="solo-arte" draggable="false">`, thumb: "Arte frente", lado: "frente" });
      if (lleva("espalda")) vistas.push({ html: () => `<img src="${esc(l.espalda || l.frente)}" alt="${esc(nombreDe("espalda"))}" class="solo-arte" draggable="false">`, thumb: "Arte espalda", lado: "espalda" });
      // Fotos con modelo de este diseño (Lookbook ligado desde el panel)
      const modelo = (p.fotosModelo || []).map((f) => ({ html: () => `<img src="${esc(f.archivo)}" alt="${esc(f.titulo || p.nombre)}" class="con-modelo" draggable="false">`, thumb: "Puesta" }));
      vistas = conModelo ? [...modelo, ...vistas] : [...vistas, ...modelo];
    } else {
      const fotos = [p.imagen, ...(p.fotos || [])].filter(Boolean);
      vistas = (fotos.length ? fotos : [""]).map((f, i) => ({ html: () => imgFoto(p, f, "z" + i) + (f ? "" : '<span class="slot">Espacio para mockup / foto con modelo (PNG)</span>'), thumb: null }));
    }
    let actual = conModelo ? 0 : Math.max(0, vistas.findIndex((v) => v.lado === sel.vista));
    $("#zoomTitle").textContent = p.nombre;
    const foto = $("#zoomPhoto");
    const ver = (i) => {
      actual = (i + vistas.length) % vistas.length;
      foto.innerHTML = `<div class="z-lienzo">${vistas[actual].html()}</div>` +
        (vistas.length > 1 ? `<button class="z-nav z-prev" type="button" aria-label="Vista anterior">‹</button><button class="z-nav z-next" type="button" aria-label="Vista siguiente">›</button>` : "") +
        `<span class="z-ayuda">🔍 Tocá para ampliar</span>`;
      foto.classList.remove("ampliada");
      $("#zoomThumbs").querySelectorAll("button").forEach((x, k) => x.setAttribute("aria-current", k === actual));
      $("#zoomThumbs").querySelector(`[data-i="${actual}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    $("#zoomThumbs").innerHTML = vistas.length > 1 ? vistas.map((v, i) => `<button data-i="${i}" aria-label="${esc(v.thumb || `Foto ${i + 1}`)}"><span class="z-mini">${v.html()}</span>${v.thumb ? `<span class="z-et">${esc(v.thumb)}</span>` : ""}</button>`).join("") : "";
    $("#zoomThumbs").onclick = (e) => { const b = e.target.closest("button[data-i]"); if (b) ver(+b.dataset.i); };
    // Ampliar / mover
    const mover = (x, y) => {
      const r = foto.getBoundingClientRect();
      const lz = foto.querySelector(".z-lienzo");
      if (lz) lz.style.transformOrigin = `${Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100))}% ${Math.min(100, Math.max(0, ((y - r.top) / r.height) * 100))}%`;
    };
    let toque = null, arrastro = false;
    foto.onpointerdown = (e) => {
      if (e.target.closest(".z-nav")) return;
      toque = { x: e.clientX, y: e.clientY }; arrastro = false;
      if (foto.classList.contains("ampliada")) foto.setPointerCapture?.(e.pointerId);
    };
    foto.onpointermove = (e) => {
      if (toque && Math.hypot(e.clientX - toque.x, e.clientY - toque.y) > 8) arrastro = true;
      if (foto.classList.contains("ampliada") && (e.pointerType === "mouse" || toque)) mover(e.clientX, e.clientY);
    };
    foto.onpointerup = (e) => {
      if (!toque || e.target.closest(".z-nav")) { toque = null; return; }
      const dx = e.clientX - toque.x;
      if (!foto.classList.contains("ampliada") && arrastro && Math.abs(dx) > 50) ver(actual + (dx < 0 ? 1 : -1)); // deslizar
      else if (!arrastro) { foto.classList.toggle("ampliada"); mover(e.clientX, e.clientY); }
      toque = null;
    };
    foto.onclick = (e) => { const n = e.target.closest(".z-nav"); if (n) ver(actual + (n.classList.contains("z-next") ? 1 : -1)); };
    $("#zoom").onkeydown = (e) => { if (e.key === "ArrowRight") ver(actual + 1); else if (e.key === "ArrowLeft") ver(actual - 1); };
    ver(actual);
    $("#zoom").showModal();
  }

  $("#verPuesta").addEventListener("click", () => abrirZoom(true));

  // ---------- Carrito ----------
  const KEY = "searcade-carrito";
  let carrito = [];
  try { carrito = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { carrito = []; }
  const guardar = () => { try { localStorage.setItem(KEY, JSON.stringify(carrito)); } catch {} };
  const mismaLinea = (a, b) => a.id === b.id && a.talla === b.talla && a.color === b.color && a.formato === b.formato && a.colocacion === b.colocacion && (a.espalda || null) === (b.espalda || null) && (a.frente || null) === (b.frente || null);
  const lineas = () => carrito.map((l) => ({ ...l, p: byId(l.id) })).filter((l) => l.p);
  const total = () => lineas().reduce((s, l) => s + precioDe(l.p, l) * l.qty, 0);
  const detalle = (l) => {
    if (!l.p.archivo) return `Talla ${etiquetaTalla(l.talla)}`;
    const f = formatoDe(l.formato);
    const esp = espaldaDe(l.p, l), fre = frenteDe(l.p, l);
    return `Camiseta ${colorDe(l.color).nombre.toLowerCase()}, talla ${etiquetaTalla(l.talla)} · Arte ${f.nombre.toLowerCase()} (${f.ancho} × ${f.alto} cm) en ${colocacionDe(l.colocacion).nombre.toLowerCase()}${fre ? ` · Frente: ${fre.nombre}` : ""}${esp ? ` · Espalda: ${esp.nombre}` : ""}`;
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
        ls.map((l) => { const esp = espaldaDe(l.p, l), fre = frenteDe(l.p, l); return `• ${l.qty}× ${l.p.nombre} — ${fmt(precioDe(l.p, l) * l.qty)}\n   ${detalle(l)}\n   Código: ${l.p.codigo || l.p.id}${fre ? ` / frente ${fre.codigo || fre.id}` : ""}${esp ? ` / espalda ${esp.codigo || esp.id}` : ""}`; }).join("\n") +
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
  $("#ctlAdd").addEventListener("click", () => {
    if (!talla) { // primero la talla: lleva a elegirla
      $("#sizes").scrollIntoView({ behavior: "smooth", block: "center" });
      const s = $("#sizes"); s.classList.remove("shake"); void s.offsetWidth; s.classList.add("shake");
      return;
    }
    if (agregar()) { pintarCarrito(); $("#cart").showModal(); }
  });
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
      ? { id: p.id, talla, color: colorEf(p), formato: sel.formato, colocacion: sel.colocacion, espalda: espaldaDe(p, sel)?.id || null, frente: frenteDe(p, sel)?.id || null, qty: 1 }
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
    const p = byId(id);
    // Enlace a un diseño: se abre dentro de su categoría y subcategoría (no perdido en "Todas")
    if (p && (i < 0 || (filtro === "todas" && !busqueda && p.categoria))) {
      const abrir = () => {
        filtro = p.categoria; subFiltro = p.sub || ""; limpiarBusqueda(); vista = "perchero"; mantenerVista = true;
        renderCats(); pintarSubs(); armar(0);
        const j = lista.findIndex((x) => x.id === id);
        if (j >= 0) mover(j, true);
      };
      return esAdulto(p) ? pedirEdad(abrir) : abrir();
    }
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
    // La barra de abajo aparece con el perchero o la ficha a la vista, pero no
    // cuando ya se ve el botón Agregar de la ficha (nunca dos botones a la vez)
    const vistos = new Set();
    let botonVisto = false;
    const actualizar = () => document.body.classList.toggle("sin-controles", !vistos.size || botonVisto);
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => (e.isIntersecting ? vistos.add(e.target) : vistos.delete(e.target)));
      actualizar();
    }, { rootMargin: "0px 0px -15% 0px" });
    io.observe($("#stage")); io.observe($("#info"));
    new IntersectionObserver(([e]) => { botonVisto = e.isIntersecting; actualizar(); }, { rootMargin: "0px 0px -90px 0px" }).observe($("#comprar"));
  }

  // ---------- Música de fondo (config.js: musica) ----------
  // Los navegadores no dejan sonar audio sin un toque del visitante: arranca
  // con el primero (p. ej. PRESIONA START). Sube de a poco, se pausa con la
  // pestaña oculta y el botón 🔊/🔇 guarda la elección en este navegador.
  (() => {
    const btn = $("#musicaBtn");
    if (!btn || !CFG.musica) return;
    btn.hidden = false;
    const CLAVE = "searcade-musica";
    let quiere = true;
    try { quiere = localStorage.getItem(CLAVE) !== "off"; } catch {}
    const VOL = Math.min(1, Math.max(0, Number(CFG.musicaVolumen) || 0.35));
    let audio = null, fade = 0;
    const pintar = (sonando) => {
      btn.setAttribute("aria-pressed", sonando ? "true" : "false");
      btn.setAttribute("aria-label", sonando ? "Silenciar música" : "Activar música");
    };
    const llevarA = (destino, ms, alTerminar) => {
      cancelAnimationFrame(fade);
      const desde = audio.volume, t0 = performance.now();
      const paso = (t) => {
        const k = Math.min(1, (t - t0) / ms);
        audio.volume = Math.min(1, Math.max(0, desde + (destino - desde) * k));
        if (k < 1) fade = requestAnimationFrame(paso); else alTerminar?.();
      };
      fade = requestAnimationFrame(paso);
    };
    const sonar = () => {
      if (!audio) {
        audio = new Audio(CFG.musica);
        audio.loop = true;
        audio.preload = "auto";
        audio.volume = 0;
      }
      const p = audio.play();
      pintar(true);
      if (p?.catch) p.catch(() => pintar(false)); // el navegador no dejó: queda en 🔇
      llevarA(VOL, 2000);
    };
    const callar = () => {
      pintar(false);
      if (audio && !audio.paused) llevarA(0, 400, () => audio.pause());
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      quiere = btn.getAttribute("aria-pressed") !== "true";
      try { localStorage.setItem(CLAVE, quiere ? "on" : "off"); } catch {}
      quiere ? sonar() : callar();
    });
    // Primer toque o tecla en la página: arranca si el visitante no la silenció
    const primero = (e) => {
      if (e.target.closest?.("#musicaBtn")) return;
      removeEventListener("pointerdown", primero, true);
      removeEventListener("keydown", primero, true);
      if (quiere) sonar();
    };
    addEventListener("pointerdown", primero, true);
    addEventListener("keydown", primero, true);
    document.addEventListener("visibilitychange", () => {
      if (!audio) return;
      if (document.hidden) audio.pause();
      else if (quiere && btn.getAttribute("aria-pressed") === "true") audio.play().catch(() => pintar(false));
    });
  })();

  // ---------- Marco del perchero: borde con esquinas en diagonal a la medida ----------
  (() => {
    const svg = $("#marcoSvg");
    if (!svg) return;
    const forma = (w, h, x, c, cb) => `M${x + c} ${x} H${w - x - c} L${w - x} ${x + c} V${h - x - cb} L${w - x - cb} ${h - x} H${x + cb} L${x} ${h - x - cb} V${x + c} Z`;
    const dibujar = () => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const w = r.width, h = r.height, c = Math.min(26, w * 0.05);
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.querySelector(".m-halo").setAttribute("d", forma(w, h, 3, c, 12));
      svg.querySelector(".m-borde").setAttribute("d", forma(w, h, 3, c, 12));
      svg.querySelector(".m-int").setAttribute("d", forma(w, h, 13, Math.max(8, c - 8), 6));
    };
    dibujar();
    if ("ResizeObserver" in window) new ResizeObserver(dibujar).observe(svg);
    else addEventListener("resize", dibujar);
  })();

  // ---------- Partículas y energía del escenario ----------
  // Partículas que flotan hacia arriba, destellos que titilan y trazos de
  // energía azul/violeta que giran alrededor de la plataforma. Se pausa con
  // la pestaña oculta o el escenario fuera de pantalla; con "menos
  // movimiento" queda un cuadro quieto.
  (() => {
    const cv = $("#energia");
    if (!cv?.getContext) return;
    const ctx = cv.getContext("2d");
    const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const COL = ["#19e6ff", "#3d7bff", "#6d4bff", "#a64dff", "#ff2e88"];
    const azar = (a, b) => a + Math.random() * (b - a);
    let W = 0, H = 0, parts = [], trazos = [], enPantalla = true, raf = 0, ultimo = 0;

    const particula = (p = {}, arriba) => Object.assign(p, {
      x: azar(0, W), y: arriba ? azar(0, H) : H + azar(0, 40), r: azar(0.5, 2.1),
      vy: -azar(8, 34), vx: azar(-8, 8), c: COL[(Math.random() * COL.length) | 0],
      f: azar(0, 6.28), vf: azar(1.5, 4), destello: Math.random() < 0.14,
    });
    // Trazo: arco elíptico alrededor del centro de la plataforma que avanza
    // dejando una estela. Vive unos segundos y se desvanece.
    const trazo = () => ({
      cx: W / 2 + azar(-W * 0.05, W * 0.05), cy: H * azar(0.5, 0.88),
      rx: W * azar(0.22, 0.46), ry: H * azar(0.05, 0.13), a: azar(0, 6.28),
      va: azar(0.9, 1.7) * (Math.random() < 0.5 ? -1 : 1), cola: azar(0.9, 1.7),
      vida: 0, dura: azar(2.6, 4.6), c: COL[(Math.random() * COL.length) | 0], g: azar(1.6, 3),
    });
    function medir() {
      const r = cv.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(110, Math.max(36, (W * H) / 7000)));
      parts = Array.from({ length: n }, () => particula({}, true));
      trazos = Array.from({ length: W < 600 ? 3 : 5 }, () => { const t = trazo(); t.vida = azar(0, t.dura); return t; });
    }
    function dibujar(dt) {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      // Trazos de energía
      for (let i = 0; i < trazos.length; i++) {
        const t = trazos[i];
        t.vida += dt; t.a += t.va * dt;
        if (t.vida > t.dura) { trazos[i] = trazo(); continue; }
        const fade = Math.min(1, t.vida / 0.6, (t.dura - t.vida) / 0.8);
        // Estela en 6 tramos que se apagan hacia la cola (halo ancho + línea fina)
        const tramos = 6, dir = Math.sign(t.va);
        ctx.strokeStyle = t.c; ctx.lineCap = "round";
        for (let k = 0; k < tramos; k++) {
          const a0 = t.a - dir * (t.cola * k) / tramos, a1 = t.a - dir * (t.cola * (k + 1)) / tramos;
          const al = fade * (1 - k / tramos);
          ctx.beginPath();
          ctx.ellipse(t.cx, t.cy, t.rx, t.ry, 0, Math.min(a0, a1), Math.max(a0, a1));
          ctx.globalAlpha = al * 0.28; ctx.lineWidth = t.g * 6; ctx.stroke();
          ctx.globalAlpha = al; ctx.lineWidth = t.g; ctx.stroke();
        }
        // Chispa en la punta
        const hx = t.cx + Math.cos(t.a) * t.rx, hy = t.cy + Math.sin(t.a) * t.ry;
        ctx.globalAlpha = fade; ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(hx, hy, t.g * 1.1, 0, 6.283); ctx.fill();
      }
      // Partículas y destellos
      for (const p of parts) {
        p.y += p.vy * dt; p.x += p.vx * dt + Math.sin(p.f) * 0.15; p.f += p.vf * dt;
        if (p.y < -10 || p.x < -10 || p.x > W + 10) particula(p);
        const brillo = 0.45 + 0.55 * Math.abs(Math.sin(p.f));
        const alto = Math.min(1, (H - p.y) / (H * 0.25) + 0.2, p.y / (H * 0.2));
        ctx.globalAlpha = Math.max(0, brillo * alto);
        ctx.fillStyle = p.c;
        if (p.r > 1.4) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.6, 0, 6.283); ctx.globalAlpha *= 0.25; ctx.fill(); ctx.globalAlpha = Math.max(0, brillo * alto); }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
        if (p.destello && brillo > 0.8) {
          const l = p.r * 5 * brillo;
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(p.x - l, p.y); ctx.lineTo(p.x + l, p.y); ctx.moveTo(p.x, p.y - l); ctx.lineTo(p.x, p.y + l); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    function cuadro(ts) {
      raf = 0;
      const dt = Math.min(0.05, ultimo ? (ts - ultimo) / 1000 : 0.016);
      ultimo = ts;
      dibujar(dt);
      seguir();
    }
    function seguir() {
      if (!raf && enPantalla && !document.hidden && !quieto) raf = requestAnimationFrame(cuadro);
    }
    medir();
    if (quieto) { dibujar(0.016); return; }
    addEventListener("resize", () => { medir(); });
    document.addEventListener("visibilitychange", () => { ultimo = 0; seguir(); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => { enPantalla = e.isIntersecting; ultimo = 0; seguir(); }).observe(cv);
    }
    seguir();
  })();

  // ---------- Lookbook: fotos que el dueño sube desde el panel ----------
  function pintarLookbook(fotos) {
    if (!fotos.length) return; // queda la foto de ejemplo
    const marco = $("#look .look-photo");
    marco.classList.add("slider");
    marco.innerHTML = fotos.map((f, i) => `<img src="${esc(f.archivo)}" alt="${esc(f.titulo || "Lookbook SEARCADE")}" loading="${i ? "lazy" : "eager"}" class="${i ? "" : "on"}">`).join("");
    // Foto ligada a un diseño en venta → "Ver esta camiseta" lo abre en el perchero.
    const disenoDe = (f) => (f.arte && byId(f.arte) ? f.arte : null);
    $("#lookBtn").addEventListener("click", (e) => {
      e.preventDefault();
      const id = disenoDe(fotos[actual]);
      if (id) location.hash = id; // desdeHash lo centra y baja al perchero
      else $("#stage").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    $("#lookDots").innerHTML = fotos.length > 1 ? fotos.map((f, i) => `<button aria-label="Foto ${i + 1}" aria-current="${i === 0}" data-i="${i}"></button>`).join("") : "";
    let actual = 0, pausa = false, t;
    const ver = (i) => {
      actual = (i + fotos.length) % fotos.length;
      marco.querySelectorAll("img").forEach((im, j) => im.classList.toggle("on", j === actual));
      $("#lookDots").querySelectorAll("button").forEach((b, j) => b.setAttribute("aria-current", j === actual));
      const id = disenoDe(fotos[actual]);
      $("#lookBtn").textContent = id ? "Ver esta camiseta" : "Elegir mi camiseta";
      $("#lookBtn").setAttribute("href", id ? `#${id}` : "#stage");
      const tit = fotos[actual].titulo || (id ? byId(id).nombre : "") || "Lookbook SEARCADE";
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
    sub: a.sub || "", oscuras: !!a.oscuras, claras: !!a.claras, codigo: a.codigo || "",
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
      // Categorías del panel (artes.json); si no hay, las de productos.json
      data = { categorias: a?.categorias?.length ? a.categorias : d.categorias, productos: artes.length ? [...artes, ...d.productos.filter((p) => p.imagen || p.fotos?.length)] : d.productos };
      const look = [...(a?.lookbook || []), ...(CFG.lookbook || [])];
      for (const f of look) { const p = f.arte && byId(f.arte); if (p) (p.fotosModelo ||= []).push(f); }
      pintarLookbook(look);
      renderCats();
      pintarSubs();
      pintarEstilos();
      ubicarFiltros();
      armar(0);
      desdeHash();
      pintarCarrito();
    })
    .catch(() => { $("#items").innerHTML = '<p class="empty">No se pudo cargar el catálogo. Recarga la página.</p>'; });
})();

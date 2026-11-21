// SEARCADE — perchero interactivo, ficha de producto y pedido por WhatsApp.
(() => {
  const CFG = window.SEARCADE_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => `${CFG.moneda || "₡"}${Number(n).toLocaleString("es-CR")}`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let data = { categorias: [], productos: [] };
  let filtro = "todos";
  let actual = null;
  let talla = null;

  // Camiseta de muestra (SVG) mientras no haya mockup PNG cargado.
  const SHIRT = "M60 18 L88 8 Q100 22 112 8 L140 18 L178 48 L160 78 L142 68 L142 192 L58 192 L58 68 L40 78 L22 48 Z";
  function teeSVG(p, uid) {
    const tono = p.arte?.tono || "#ff2e88";
    const palabras = String(p.arte?.texto || p.nombre).toUpperCase().split(" ");
    const lineas = [];
    for (const w of palabras) {
      const last = lineas[lineas.length - 1];
      if (last && (last + " " + w).length <= 10) lineas[lineas.length - 1] = last + " " + w;
      else lineas.push(w);
    }
    const y0 = 128 - (lineas.length - 1) * 8;
    const id = `ht-${uid}`;
    return `<svg viewBox="0 0 200 200" role="img" aria-label="${esc(p.nombre)}">
      <defs>
        <pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="3" cy="3" r="1.6" fill="${tono}"/></pattern>
        <radialGradient id="${id}g" cx="50%" cy="45%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <mask id="${id}m"><circle cx="100" cy="96" r="38" fill="url(#${id}g)"/></mask>
      </defs>
      <path d="${SHIRT}" fill="#141218" stroke="#2c2836" stroke-width="2" stroke-linejoin="round"/>
      <path d="M88 8 Q100 26 112 8" fill="none" stroke="#2c2836" stroke-width="3"/>
      <circle cx="100" cy="96" r="38" fill="url(#${id})" mask="url(#${id}m)"/>
      <circle cx="100" cy="96" r="22" fill="none" stroke="${tono}" stroke-width="2.5" opacity=".9"/>
      ${lineas.map((l, i) => `<text x="100" y="${y0 + i * 16}" text-anchor="middle" font-family="Bungee, sans-serif" font-size="${l.length > 8 ? 12 : 14}" fill="#fff" stroke="${tono}" stroke-width=".6">${esc(l)}</text>`).join("")}
    </svg>`;
  }
  const hookSVG = `<svg class="hook" viewBox="0 0 60 44" aria-hidden="true"><path d="M30 2 q8 0 8 7 q0 6 -8 8 v6 L4 40 h52 L30 23" fill="none" stroke="#cfcfe0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function imgOr(p, src, uid) {
    return src ? `<img src="${esc(src)}" alt="${esc(p.nombre)}" loading="lazy">` : teeSVG(p, uid);
  }
  const catNombre = (id) => data.categorias.find((c) => c.id === id)?.nombre || "";

  function waLink(texto) {
    const n = String(CFG.whatsapp || "").replace(/\D/g, "");
    return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
  }

  // ---------- Pestañas ----------
  function renderTabs() {
    const tabs = [{ id: "todos", nombre: "Todo" }, ...data.categorias];
    $("#tabs").innerHTML = tabs.map((t) => `<button class="tab" role="tab" data-cat="${esc(t.id)}" aria-selected="${t.id === filtro}">${esc(t.nombre)}</button>`).join("");
  }
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b || b.dataset.cat === filtro) return;
    filtro = b.dataset.cat;
    renderTabs();
    renderRack(true);
  });

  // ---------- Perchero ----------
  function renderRack(animar) {
    const lista = data.productos.filter((p) => filtro === "todos" || p.categoria === filtro);
    const el = $("#hangers");
    el.classList.remove("enter");
    el.innerHTML = lista.length ? lista.map((p, i) => `
      <button class="hanger" data-id="${esc(p.id)}" style="--glow:${esc(p.arte?.tono || "#ff2e88")}88" aria-label="${esc(p.nombre)}, ${fmt(p.precio)}">
        <span class="hanger-inner">
          ${hookSVG}
          <span class="tee">${imgOr(p, p.imagen, "r" + i)}${p.nuevo ? '<span class="badge">NUEVO</span>' : ""}</span>
          <span class="hanger-label">${esc(p.nombre)}</span>
          <span class="hanger-price">${fmt(p.precio)}</span>
        </span>
      </button>`).join("") : `<p class="empty">Pronto habrá diseños en esta categoría.</p>`;
    if (animar) { void el.offsetWidth; el.classList.add("enter"); }
    $("#rack").scrollLeft = 0;
  }

  const touch = matchMedia("(hover: none)").matches;
  $("#hangers").addEventListener("click", (e) => {
    const h = e.target.closest(".hanger");
    if (!h) return;
    if (touch) {
      // En el celular: la prenda se adelanta y luego abre la ficha.
      document.querySelectorAll(".hanger.is-front").forEach((x) => x.classList.remove("is-front"));
      h.classList.add("is-front");
      setTimeout(() => { abrir(h.dataset.id); h.classList.remove("is-front"); }, 320);
    } else abrir(h.dataset.id);
  });

  // ---------- Ficha ----------
  const sheet = $("#sheet");
  const backdrop = $("#backdrop");

  function abrir(id, sinHash) {
    const p = data.productos.find((x) => x.id === id);
    if (!p) return;
    actual = p;
    talla = null;
    $("#sheetCat").textContent = catNombre(p.categoria).toUpperCase();
    $("#sheetTitle").textContent = p.nombre;
    $("#sheetPrice").textContent = fmt(p.precio);
    $("#sheetDesc").textContent = p.descripcion || "";
    $("#sheetSizes").innerHTML = (p.tallas || []).map((t) => `<button class="size" role="radio" aria-checked="false" data-t="${esc(t)}">${esc(t)}</button>`).join("");

    const fotos = [p.imagen, ...(p.fotos || [])].filter((f, i) => i === 0 || f);
    $("#sheetThumbs").innerHTML = fotos.length > 1 ? fotos.map((f, i) => `<button data-i="${i}" aria-current="${i === 0}" aria-label="Foto ${i + 1}">${imgOr(p, f, "t" + i)}</button>`).join("") : "";
    $("#sheetThumbs").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $("#sheetThumbs").querySelectorAll("button").forEach((x) => x.setAttribute("aria-current", x === b));
      foto(p, fotos[+b.dataset.i]);
    };
    foto(p, fotos[0]);
    actualizarWa();

    backdrop.hidden = false;
    if (!sheet.open) sheet.show();
    document.body.style.overflow = "hidden";
    if (!sinHash) history.replaceState(null, "", `#${p.id}`);
  }
  function foto(p, src) {
    $("#sheetPhoto").innerHTML = imgOr(p, src, "big") + (src ? "" : `<span class="slot">Espacio para mockup / foto con modelo (PNG)</span>`);
  }
  function cerrar() {
    sheet.close();
    backdrop.hidden = true;
    document.body.style.overflow = "";
    history.replaceState(null, "", location.pathname + location.search);
  }
  $("#sheetClose").addEventListener("click", cerrar);
  backdrop.addEventListener("click", cerrar);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet.open) cerrar(); });

  $("#sheetSizes").addEventListener("click", (e) => {
    const b = e.target.closest(".size");
    if (!b) return;
    talla = b.dataset.t;
    $("#sheetSizes").querySelectorAll(".size").forEach((x) => x.setAttribute("aria-checked", x === b));
    actualizarWa();
  });

  function actualizarWa() {
    const a = $("#sheetWa");
    const p = actual;
    if (!talla) {
      a.setAttribute("aria-disabled", "true");
      a.removeAttribute("href");
      $("#sheetNote").textContent = "Elegí tu talla para hacer el pedido.";
      return;
    }
    const url = `${location.origin}${location.pathname}#${p.id}`;
    const msg = `¡Hola SEARCADE! 👋 Quiero pedir esta camiseta:\n\n` +
      `• Diseño: ${p.nombre} (${p.id})\n• Talla: ${talla}\n• Precio: ${fmt(p.precio)}\n\n${url}`;
    a.href = waLink(msg);
    a.removeAttribute("aria-disabled");
    $("#sheetNote").textContent = `Talla ${talla} · te respondemos por WhatsApp para coordinar pago y entrega.`;
  }

  $("#customBtn").href = waLink("¡Hola SEARCADE! 👋 Quiero cotizar una camiseta personalizada con mi propio diseño.");

  // ---------- Datos ----------
  // Fase 1: productos.json. Fase 2: Supabase (ver config.js).
  async function cargar() {
    const r = await fetch("productos.json", { cache: "no-cache" });
    data = await r.json();
    renderTabs();
    renderRack(true);
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) abrir(id, true);
  }
  window.addEventListener("hashchange", () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && id !== actual?.id) abrir(id, true);
  });
  cargar().catch(() => { $("#hangers").innerHTML = `<p class="empty">No se pudo cargar el catálogo. Recargá la página.</p>`; });
})();

// SEARCADE — panel de artes: el admin sube PNG/WebP, los ve EN VIVO sobre la
// camiseta (color, colocación y tamaño), marca si son semitono y los publica.
// Usa la sesión de admin de reymidascr.com.
(() => {
  const CFG = window.SEARCADE_CONFIG || {};
  const T = window.SearcadeTee;
  const { COLORES, FORMATOS, COLOCACIONES, esc } = T;
  const API = CFG.api || "https://reymidascr.com/api/searcade";
  const $ = (s) => document.querySelector(s);
  const MAX_BYTES = 700 * 1024; // el servidor acepta hasta 720 KB
  const MAX_LADO = 1400;
  let categorias = [];
  let pendientes = [];
  let publicados = [];
  // Vista en vivo: se aplica a todas las fichas
  const vivo = { color: COLORES[0].id, colocacion: "pecho", formato: (FORMATOS.find((f) => f.id === CFG.formatoInicial) || FORMATOS[FORMATOS.length - 1]).id, vista: "frente" };

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // Sesión propia del panel (token de 30 días guardado en este navegador)
  const CLAVE_TOKEN = "searcade-panel-token";
  let token = "";
  try { token = localStorage.getItem(CLAVE_TOKEN) || ""; } catch {}
  const guardarToken = (t) => { token = t || ""; try { t ? localStorage.setItem(CLAVE_TOKEN, t) : localStorage.removeItem(CLAVE_TOKEN); } catch {} };

  async function api(body) {
    body = { ...body, token };
    let r;
    try {
      // text/plain = consulta "simple" (sin preflight), la que menos bloquean los navegadores
      r = await fetch(API, { method: "POST", credentials: "include", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) });
    } catch {
      throw Object.assign(new Error("sin conexión"), { status: 0 });
    }
    let d = {};
    try { d = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(new Error(d.error || `Error ${r.status}`), { status: r.status });
    return d;
  }

  const opciones = (sel) => categorias.map((c) => `<option value="${esc(c.id)}"${c.id === sel ? " selected" : ""}>${esc(c.nombre)}</option>`).join("");
  const sello = (semi) => `<span class="sello ${semi ? "semi" : "full"}">${semi ? "SEMITONO" : "FULL COLOR"}</span>`;
  const prev = (archivo, semi) => `<div class="prev">${T.camiseta({ archivo }, vivo)}${sello(semi)}</div>`;

  // ---------- Barra de vista en vivo ----------
  function pintarVivo() {
    $("#vivoColores").innerHTML = COLORES.map((c) => `<button class="swatch" role="radio" aria-checked="${c.id === vivo.color}" title="${esc(c.nombre)}" aria-label="${esc(c.nombre)}" data-c="${esc(c.id)}" style="--sw:${esc(c.hex)}"></button>`).join("");
    $("#vivoColoc").innerHTML = COLOCACIONES.map((c) => `<button role="radio" aria-checked="${c.id === vivo.colocacion}" data-v="${esc(c.id)}">${esc(c.nombre)}</button>`).join("");
    $("#vivoForm").innerHTML = FORMATOS.map((f) => `<button role="radio" aria-checked="${f.id === vivo.formato}" data-v="${esc(f.id)}">${esc(f.nombre)}<small>${f.ancho}×${f.alto}</small></button>`).join("");
    $("#vivoLado").innerHTML = [["frente", "Frente"], ["espalda", "Espalda"]].map(([id, n]) => `<button role="radio" aria-checked="${id === vivo.vista}" data-v="${id}">${n}</button>`).join("");
  }
  function repintarPrevias() {
    document.querySelectorAll(".ficha[data-k] .prev, .ficha[data-id] .prev").forEach((el) => {
      const f = el.closest(".ficha");
      const p = f.dataset.k ? pendientes.find((x) => x.key === f.dataset.k) : publicados.find((x) => x.id === f.dataset.id);
      const semi = f.querySelector('[data-f="semitono"]')?.checked ?? p?.semitono;
      if (p) el.outerHTML = prev(p.url || p.archivo, semi);
    });
  }
  const cambiar = (k, v) => {
    if (vivo[k] === v) return;
    vivo[k] = v;
    if (k === "colocacion") vivo.vista = v === "espalda" ? "espalda" : "frente";
    pintarVivo();
    repintarPrevias();
  };
  $("#vivoColores").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b) cambiar("color", b.dataset.c); });
  $("#vivoColoc").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) cambiar("colocacion", b.dataset.v); });
  $("#vivoForm").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) cambiar("formato", b.dataset.v); });
  $("#vivoLado").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) cambiar("vista", b.dataset.v); });

  // ---------- Preparar la imagen en el navegador ----------
  // Recorta el borde transparente, la achica a 1400 px, la pasa a WebP de
  // menos de 700 KB y estima si es semitono (muchos puntos sueltos).
  async function preparar(file) {
    const bmp = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) throw new Error("La imagen está vacía (todo transparente)");
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const transparente = data.some((v, i) => i % 4 === 3 && v < 250);
    const semitono = transparente && detectarSemitono(c, x0, y0, w, h);
    const vista = await hacerVista(c, x0, y0, w, h);
    let escala = Math.min(1, MAX_LADO / Math.max(w, h));
    for (let intento = 0; intento < 8; intento++) {
      const o = document.createElement("canvas");
      o.width = Math.round(w * escala); o.height = Math.round(h * escala);
      const octx = o.getContext("2d");
      octx.imageSmoothingQuality = "high";
      octx.drawImage(c, x0, y0, w, h, 0, 0, o.width, o.height);
      for (const q of [0.92, 0.85, 0.78]) {
        const blob = await new Promise((ok) => o.toBlob(ok, "image/webp", q));
        if (blob && blob.type === "image/webp" && blob.size <= MAX_BYTES) {
          return { blob, vista, url: URL.createObjectURL(blob), ancho: o.width, alto: o.height, transparente, semitono };
        }
      }
      escala *= 0.8;
    }
    throw new Error("No se pudo dejar la imagen por debajo de 700 KB");
  }
  // Semitono = la transparencia cambia muchísimas veces por fila (puntos).
  function detectarSemitono(src, x0, y0, w, h) {
    const lado = 600, k = Math.min(1, lado / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, x0, y0, w, h, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let cambios = 0, llenos = 0;
    for (let y = 0; y < c.height; y++) {
      let antes = false;
      for (let x = 0; x < c.width; x++) {
        const lleno = d[(y * c.width + x) * 4 + 3] > 128;
        if (lleno) llenos++;
        if (x && lleno !== antes) cambios++;
        antes = lleno;
      }
    }
    return llenos > 0 && cambios / llenos > 0.12;
  }
  // Vista previa PÚBLICA: 800 px como máximo (a 28 cm son ~70 DPI, no sirve
  // para imprimir) y marca de agua SEARCADE solo sobre el arte. El original
  // para imprimir va a la carpeta privada y solo se baja desde este panel.
  async function hacerVista(src, x0, y0, w, h) {
    const k = Math.min(1, 800 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, x0, y0, w, h, 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "source-atop"; // la marca solo cae sobre el arte
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    const t = Math.max(16, Math.round(c.width / 14));
    ctx.font = `900 italic ${t}px Kanit, Arial, sans-serif`;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(-Math.PI / 6);
    const paso = t * 3.2, diag = Math.hypot(c.width, c.height);
    for (let y = -diag; y < diag; y += paso) {
      for (let x = -diag; x < diag; x += t * 7) {
        const dx = x + ((y / paso) % 2 ? t * 3.5 : 0);
        ctx.fillText("SEARCADE", dx, y);
        ctx.strokeText("SEARCADE", dx, y);
      }
    }
    for (const q of [0.82, 0.72, 0.6]) {
      const blob = await new Promise((ok) => c.toBlob(ok, "image/webp", q));
      if (blob && blob.size <= 300 * 1024) return blob;
    }
    return await new Promise((ok) => c.toBlob(ok, "image/webp", 0.5));
  }
  const aDataUrl = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
  const nombreDesde = (f) => f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

  async function agregar(files) {
    for (const f of files) {
      if (!/image\/(png|webp)/.test(f.type)) { toast(`${f.name}: usa PNG o WebP`); continue; }
      try {
        const img = await preparar(f);
        pendientes.push({ key: Math.random().toString(36).slice(2), nombre: nombreDesde(f), categoria: categorias[0]?.id || "pop", precio: "", ...img });
        if (!img.transparente) toast(`${f.name} no tiene fondo transparente: se verá el recuadro sobre la camiseta`);
      } catch (e) { toast(`${f.name}: ${e.message}`); }
    }
    pintarPendientes();
  }

  // Textos del arte en la tienda (vacíos = automáticos por categoría)
  const camposTexto = (a = {}) => `<details class="textos"${a.coleccion || a.lema || a.descripcion ? " open" : ""}><summary>Textos en la tienda <small>(opcional)</small></summary>
        <label>Colección (franja)<input data-f="coleccion" maxlength="30" value="${esc(a.coleccion || "")}" placeholder="Automático por categoría"></label>
        <label>Lema (frase grande de fondo)<input data-f="lema" maxlength="60" value="${esc(a.lema || "")}" placeholder="Automático por categoría"></label>
        <label>Descripción<textarea data-f="descripcion" maxlength="180" rows="2" placeholder="Automática por categoría">${esc(a.descripcion || "")}</textarea></label>
      </details>`;
  const campoSemi = (semi) => `<label class="chk"><input type="checkbox" data-f="semitono"${semi ? " checked" : ""}> Es semitono <small>(puntos que dejan ver la tela)</small></label>`;
  // Subcategoría (p. ej. "Attack on Titan") y artes de recorte solo para camisetas oscuras
  const subsDe = (cat) => categorias.find((c) => c.id === cat)?.subs || [];
  const opcionesSub = (cat, sel) => `<option value="">— Ninguna —</option>` + [...subsDe(cat), ...(sel && !subsDe(cat).includes(sel) ? [sel] : [])]
    .map((x) => `<option value="${esc(x)}"${x === sel ? " selected" : ""}>${esc(x)}</option>`).join("");
  const camposExtra = (a = {}) => `<label>Subcategoría <small>(se crean en Categorías)</small><select data-f="sub">${opcionesSub(a.categoria, a.sub || "")}</select></label>
        <label class="chk"><input type="checkbox" data-f="oscuras"${a.oscuras ? " checked" : ""}> Solo camisetas oscuras <small>(arte de recorte: en las claras pierde las sombras)</small></label>`;

  function pintarPendientes() {
    $("#pendientes").innerHTML = pendientes.map((p) => `
      <div class="ficha" data-k="${p.key}">
        ${prev(p.url, p.semitono)}
        <label>Nombre<input data-f="nombre" value="${esc(p.nombre)}" maxlength="60"></label>
        <label>Categoría<select data-f="categoria">${opciones(p.categoria)}</select></label>
        <label>Precio (vacío = ₡${(CFG.precioBase || 11000).toLocaleString("es-CR")})<input data-f="precio" type="number" inputmode="numeric" min="500" step="500" value="${esc(p.precio)}"></label>
        ${campoSemi(p.semitono)}
        ${camposExtra(p)}
        ${camposTexto(p)}
        <p class="meta">${p.ancho}×${p.alto} px · ${Math.round(p.blob.size / 1024)} KB${p.semitono ? " · detectado como semitono" : ""}</p>
        <div class="botones"><button class="adm-btn" data-a="subir">Subir</button><button class="adm-btn ghost" data-a="comparar">Colores</button><button class="adm-btn ghost" data-a="quitar">Quitar</button></div>
      </div>`).join("");
    $("#accionesPend").hidden = pendientes.length < 2;
  }
  $("#pendientes").addEventListener("input", (e) => {
    const f = e.target.closest(".ficha");
    const p = pendientes.find((x) => x.key === f?.dataset.k);
    if (!p || !e.target.dataset.f) return;
    p[e.target.dataset.f] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (e.target.dataset.f === "categoria") { p.sub = ""; f.querySelector('[data-f="sub"]').innerHTML = opcionesSub(p.categoria, ""); }
    if (e.target.dataset.f === "semitono") f.querySelector(".prev").outerHTML = prev(p.url, p.semitono);
  });
  $("#pendientes").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const p = pendientes.find((x) => x.key === b.closest(".ficha").dataset.k);
    if (b.dataset.a === "quitar") { quitar(p); pintarPendientes(); }
    else if (b.dataset.a === "comparar") comparar(p.nombre, p.url, p.semitono);
    else await subir(p);
  });
  function quitar(p) { URL.revokeObjectURL(p.url); pendientes = pendientes.filter((x) => x !== p); }

  async function subir(p) {
    const el = document.querySelector(`.ficha[data-k="${p.key}"]`);
    el?.classList.add("subiendo");
    try {
      // 1) la vista previa pública, 2) el original a la carpeta privada
      const r = await api({ action: "subir", nombre: p.nombre, categoria: p.categoria, precio: p.precio, semitono: !!p.semitono, sub: p.sub || "", oscuras: !!p.oscuras, coleccion: p.coleccion || "", lema: p.lema || "", descripcion: p.descripcion || "", imagen: await aDataUrl(p.vista) });
      const r2 = await api({ action: "original", id: r.arte.id, imagen: await aDataUrl(p.blob) });
      r.artes = r2.artes;
      quitar(p);
      pintarPendientes();
      pintarLista(r.artes);
      toast(`✓ "${r.arte.nombre}" ya está en la tienda`);
      return true;
    } catch (e) {
      el?.classList.remove("subiendo");
      el?.classList.add("error");
      if (e.status === 401) { guardarToken(""); mostrarLogin("Tu sesión venció: vuelve a entrar. Lo que no se subió sigue aquí."); $("#panel").hidden = false; }
      toast(e.status === 401 ? "Tu sesión venció: vuelve a entrar" : e.message);
      return false;
    }
  }
  $("#subirTodos").addEventListener("click", async (e) => {
    e.target.disabled = true;
    for (const p of [...pendientes]) if (!(await subir(p))) break;
    e.target.disabled = false;
  });
  $("#limpiar").addEventListener("click", () => { [...pendientes].forEach(quitar); pintarPendientes(); });

  const input = $("#archivos");
  input.addEventListener("change", () => { agregar([...input.files]); input.value = ""; });
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); agregar([...e.dataTransfer.files]); });

  // ---------- Comparar un arte en todos los colores ----------
  function comparar(nombre, archivo, semi) {
    $("#compTitulo").innerHTML = `${esc(nombre)} ${sello(semi)}`;
    $("#compGrid").innerHTML = COLORES.map((c) => `<figure>${T.camiseta({ archivo }, { ...vivo, color: c.id })}<figcaption>${esc(c.nombre)}</figcaption></figure>`).join("");
    $("#compNota").textContent = semi
      ? "Semitono: los puntos dejan ver la tela, por eso el arte cambia de carácter en cada color. Revisa que se lea bien en los claros."
      : "Full color: el arte es sólido y se ve igual sobre cualquier color.";
    $("#comparar").showModal();
  }
  $("#comparar").addEventListener("click", (e) => { if (e.target.id === "comparar" || e.target.closest("[data-close]")) $("#comparar").close(); });

  // ---------- Artes publicados ----------
  let filtro = "todos";
  // Descargar el ORIGINAL (para imprimir); solo con sesión
  async function descargar(id, b) {
    b.disabled = true;
    try {
      const r = await api({ action: "descargar", id });
      const a = document.createElement("a");
      a.href = r.imagen; a.download = r.nombre;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { toast(err.message); }
    b.disabled = false;
  }
  // Artes subidos antes de la protección: arma su vista previa y manda el original a privado
  async function proteger(a) {
    const im = new Image();
    im.src = `${a.archivo}?t=${Date.now()}`;
    await im.decode();
    const c = document.createElement("canvas");
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext("2d").drawImage(im, 0, 0);
    const vista = await hacerVista(c, 0, 0, c.width, c.height);
    pintarLista((await api({ action: "proteger", id: a.id, imagen: await aDataUrl(vista) })).artes);
  }
  $("#protegerTodos").addEventListener("click", async (e) => {
    const b = e.target; b.disabled = true;
    const sin = publicados.filter((a) => !a.protegido);
    let ok = 0;
    for (const a of sin) { try { await proteger(a); ok++; } catch (err) { toast(`${a.nombre}: ${err.message}`); } }
    toast(`🔒 ${ok} de ${sin.length} artes protegidos`);
    b.disabled = false;
  });

  // Miniatura liviana (≤ 480 px, WebP ≤ 140 KB) para el perchero y las fichas
  // de la tienda: sin ella, cada visita baja los artes completos (~500 KB c/u).
  // Se hace sola para cada arte que no la tenga (al subir, al proteger y al
  // abrir el panel).
  async function hacerMini(src) {
    const im = new Image();
    im.src = src;
    await im.decode();
    let lado = 480;
    for (let intento = 0; intento < 5; intento++) {
      const k = Math.min(1, lado / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(im, 0, 0, c.width, c.height);
      for (const q of [0.82, 0.72]) {
        const blob = await new Promise((ok) => c.toBlob(ok, "image/webp", q));
        if (blob && blob.type === "image/webp" && blob.size <= 140 * 1024) return blob;
      }
      lado *= 0.8;
    }
    throw new Error("No se pudo achicar la miniatura");
  }
  let haciendoMinis = false;
  async function completarMiniaturas() {
    if (haciendoMinis) return;
    haciendoMinis = true;
    try {
      for (;;) {
        const a = publicados.find((x) => !x.mini && x.archivo && !x.sinMini);
        if (!a) break;
        try {
          const blob = await hacerMini(`${a.archivo}?t=${Date.now()}`);
          publicados = (await api({ action: "miniatura", id: a.id, imagen: await aDataUrl(blob) })).artes;
        } catch (err) {
          a.sinMini = true; // no reintentar en esta visita
          if (err.status === 401) break;
          console.warn("miniatura", a.nombre, err);
        }
      }
    } finally { haciendoMinis = false; }
  }

  function pintarLista(artes) {
    if (artes) publicados = artes;
    if (artes) pintarFotos();
    setTimeout(completarMiniaturas, 400);
    const semis = publicados.filter((a) => a.semitono).length;
    $("#cuenta").textContent = `(${publicados.length} · ${semis} semitono · ${publicados.length - semis} full color)`;
    $("#protegerTodos").hidden = !publicados.some((a) => !a.protegido);
    const q = norm($("#buscarArte").value);
    const catF = $("#catLista").value;
    $("#catLista").innerHTML = `<option value="">Todas las categorías</option>` + categorias.map((c) => `<option value="${esc(c.id)}"${c.id === catF ? " selected" : ""}>${esc(c.nombre)} (${cuantos(c.id)})</option>`).join("");
    const todos = publicados.filter((a) => (filtro === "todos" || (filtro === "semitono") === !!a.semitono) && (!catF || a.categoria === catF) && (!q || norm(`${a.nombre} ${a.sub || ""} ${a.id} ${a.codigo || ""}`).includes(q)));
    const ver = todos.slice(0, limiteLista);
    $("#verMas").hidden = todos.length <= ver.length;
    $("#verMas").textContent = `Ver más (${todos.length - ver.length})`;
    $("#lista").innerHTML = ver.length ? ver.map((a) => `
      <div class="ficha" data-id="${esc(a.id)}">
        ${prev(a.archivo, a.semitono)}
        <label>Nombre<input data-f="nombre" value="${esc(a.nombre)}" maxlength="60"></label>
        <label>Categoría<select data-f="categoria">${opciones(a.categoria)}</select></label>
        <label>Precio<input data-f="precio" type="number" inputmode="numeric" min="500" step="500" value="${a.precio ?? ""}" placeholder="${CFG.precioBase || 11000}"></label>
        ${campoSemi(a.semitono)}
        ${camposExtra(a)}
        ${camposTexto(a)}
        <p class="meta">${a.codigo ? `Código: <b>${esc(a.codigo)}</b> · ` : ""}ID: ${esc(a.id)} · ${a.protegido ? "🔒 original protegido" : "⚠️ sin proteger"}</p>
        <div class="botones"><button class="adm-btn ghost" data-a="guardar">Guardar</button><button class="adm-btn ghost" data-a="comparar">Colores</button><button class="adm-btn danger" data-a="borrar">Borrar</button></div>
        <div class="botones"><button class="adm-btn ghost" data-a="descargar">⬇ Original</button>${a.protegido ? "" : '<button class="adm-btn" data-a="proteger">🔒 Proteger</button>'}</div>
      </div>`).join("") : `<p class="vacio">${publicados.length ? "No hay artes de este tipo." : "Todavía no hay artes. Sube el primero arriba."}</p>`;
    $("#filtroLista").innerHTML = [["todos", "Todos"], ["semitono", "Semitono"], ["full", "Full color"]]
      .map(([id, n]) => `<button role="radio" aria-checked="${id === filtro}" data-v="${id}">${n}</button>`).join("");
  }
  $("#filtroLista").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { filtro = b.dataset.v; limiteLista = 30; pintarLista(); } });
  // Con miles de artes: de a 30, con buscador y filtro por categoría
  let limiteLista = 30, tBuscar;
  $("#buscarArte").addEventListener("input", () => { clearTimeout(tBuscar); tBuscar = setTimeout(() => { limiteLista = 30; pintarLista(); }, 250); });
  $("#catLista").addEventListener("change", () => { limiteLista = 30; pintarLista(); });
  $("#verMas").addEventListener("click", () => { limiteLista += 30; pintarLista(); });
  $("#lista").addEventListener("change", (e) => {
    if (e.target.dataset.f === "categoria") { e.target.closest(".ficha").querySelector('[data-f="sub"]').innerHTML = opcionesSub(e.target.value, ""); return; }
    if (e.target.dataset.f !== "semitono") return;
    const f = e.target.closest(".ficha");
    const a = publicados.find((x) => x.id === f.dataset.id);
    f.querySelector(".prev").outerHTML = prev(a.archivo, e.target.checked);
  });
  $("#lista").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const f = b.closest(".ficha");
    const id = f.dataset.id;
    const v = (k) => f.querySelector(`[data-f="${k}"]`);
    if (b.dataset.a === "comparar") return comparar(v("nombre").value, publicados.find((x) => x.id === id).archivo, v("semitono").checked);
    if (b.dataset.a === "descargar") return descargar(id, b);
    if (b.dataset.a === "proteger") { b.disabled = true; try { await proteger(publicados.find((x) => x.id === id)); toast("🔒 Arte protegido"); } catch (err) { b.disabled = false; toast(err.message); } return; }
    try {
      if (b.dataset.a === "borrar") {
        if (!confirm(`¿Borrar "${v("nombre").value}" de la tienda?`)) return;
        b.disabled = true;
        pintarLista((await api({ action: "borrar", id })).artes);
        toast("Arte borrado");
      } else {
        b.disabled = true;
        pintarLista((await api({ action: "editar", id, nombre: v("nombre").value, categoria: v("categoria").value, precio: v("precio").value, semitono: v("semitono").checked, sub: v("sub").value, oscuras: v("oscuras").checked, coleccion: v("coleccion").value, lema: v("lema").value, descripcion: v("descripcion").value })).artes);
        toast("✓ Cambios guardados");
      }
    } catch (err) {
      b.disabled = false;
      toast(err.message);
    }
  });

  // ---------- Categorías y subcategorías ----------
  // Copia editable: subs como { nombre, orig } para saber qué se renombró.
  let catsEd = [];
  const IC = window.SEARCADE_ICONOS;
  const cuantos = (cat, sub) => publicados.filter((a) => a.categoria === cat && (sub === undefined || a.sub === sub)).length;
  const slug = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "cat";
  function editarCats() {
    catsEd = categorias.map((c) => {
      // Subcategorías que ya usan los artes pero no están en la lista
      const extra = [...new Set(publicados.filter((a) => a.categoria === c.id && a.sub && !(c.subs || []).includes(a.sub)).map((a) => a.sub))];
      return { id: c.id, nombre: c.nombre, icono: c.icono || "", claves: [...(c.claves || [])], nueva: false, subs: [...(c.subs || []), ...extra].map((x) => ({ nombre: x, orig: x, claves: [...(c.subClaves?.[x] || [])] })) };
    });
    // Categorías que tienen artes y no están en la lista (no se pueden perder)
    for (const id of new Set(publicados.map((a) => a.categoria))) {
      if (!catsEd.some((c) => c.id === id)) catsEd.push({ id, nombre: id.charAt(0).toUpperCase() + id.slice(1), icono: "", claves: [], nueva: false, subs: [] });
    }
    pintarCats();
  }
  function pintarCats() {
    $("#catsEd").innerHTML = catsEd.map((c, i) => {
      const n = cuantos(c.id);
      return `<div class="cat-ed" data-i="${i}">
        <div class="cat-fila">
          <button type="button" class="cat-ico" data-a="icono" title="Cambiar ícono">${IC.svg(c.icono, c.id)}</button>
          <input data-k="nombre" value="${esc(c.nombre)}" maxlength="20" aria-label="Nombre de la categoría">
          <span class="cat-n">${n} arte${n === 1 ? "" : "s"}</span>
          <button type="button" class="mini-btn${c.claves.length ? " con" : ""}" data-a="claves" title="Palabras clave: ${esc(c.claves.join(", ") || "ninguna")}">🔑</button>
          <button type="button" class="mini-btn" data-a="arriba" title="Subir"${i ? "" : " disabled"}>↑</button>
          <button type="button" class="mini-btn" data-a="abajo" title="Bajar"${i < catsEd.length - 1 ? "" : " disabled"}>↓</button>
          <button type="button" class="mini-btn peligro" data-a="borrar" title="${n ? "Tiene artes: muévelos antes de borrarla" : "Borrar categoría"}"${n ? " disabled" : ""}>✕</button>
        </div>
        <div class="subs-ed">
          ${c.subs.map((x, j) => `<span class="sub-chip" data-j="${j}"><input data-k="sub" value="${esc(x.nombre)}" maxlength="30" aria-label="Subcategoría"><small>${x.orig ? cuantos(c.id, x.orig) : 0}</small><button type="button" data-a="sub-claves" class="${x.claves.length ? "con" : ""}" title="Palabras clave: ${esc(x.claves.join(", ") || "ninguna")}">🔑</button><button type="button" data-a="sub-arriba" title="Mover antes"${j ? "" : " disabled"}>‹</button><button type="button" data-a="sub-quitar" title="Quitar subcategoría">✕</button></span>`).join("")}
          <span class="sub-nueva"><input placeholder="+ Subcategoría" maxlength="30" aria-label="Nueva subcategoría"><button type="button" data-a="sub-agregar">Agregar</button></span>
        </div>
      </div>`;
    }).join("");
  }
  $("#catsEd").addEventListener("input", (e) => {
    const box = e.target.closest(".cat-ed");
    if (!box) return;
    const c = catsEd[+box.dataset.i];
    if (e.target.dataset.k === "nombre") c.nombre = e.target.value;
    if (e.target.dataset.k === "sub") c.subs[+e.target.closest(".sub-chip").dataset.j].nombre = e.target.value;
  });
  $("#catsEd").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.closest(".sub-nueva")) { e.preventDefault(); e.target.closest(".sub-nueva").querySelector("button").click(); }
  });
  let catIcono = null; // categoría a la que se le elige ícono
  $("#catsEd").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const i = +b.closest(".cat-ed").dataset.i, c = catsEd[i];
    const j = +b.closest(".sub-chip")?.dataset.j;
    const mover = (arr, a, z) => { const [x] = arr.splice(a, 1); arr.splice(z, 0, x); };
    switch (b.dataset.a) {
      case "icono": catIcono = c; pintarIconos(); $("#iconos").showModal(); return;
      case "claves": case "sub-claves": {
        const obj = b.dataset.a === "claves" ? c : c.subs[j];
        const r = prompt(`Palabras clave de "${obj.nombre}", separadas por comas.\nSi el nombre de un archivo o de su carpeta tiene alguna, la carga masiva lo pone aquí.\nEj.: ataque a los titanes, shingeki, aot`, obj.claves.join(", "));
        if (r === null) return;
        obj.claves = [...new Set(r.split(",").map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 2))].slice(0, 20);
        break;
      }
      case "arriba": mover(catsEd, i, i - 1); break;
      case "abajo": mover(catsEd, i, i + 1); break;
      case "borrar": if (!confirm(`¿Quitar la categoría "${c.nombre}"? (Se aplica al guardar)`)) return; catsEd.splice(i, 1); break;
      case "sub-arriba": mover(c.subs, j, j - 1); break;
      case "sub-quitar": {
        const n = c.subs[j].orig ? cuantos(c.id, c.subs[j].orig) : 0;
        if (n && !confirm(`"${c.subs[j].nombre}" tiene ${n} arte${n === 1 ? "" : "s"}: quedarán sin subcategoría (siguen en ${c.nombre}). ¿Quitarla?`)) return;
        c.subs.splice(j, 1); break;
      }
      case "sub-agregar": {
        const inp = b.parentElement.querySelector("input");
        const t = inp.value.trim().slice(0, 30);
        if (!t) return inp.focus();
        if (c.subs.some((x) => x.nombre.toLowerCase() === t.toLowerCase())) return toast("Esa subcategoría ya existe");
        c.subs.push({ nombre: t, orig: "", claves: [] }); break;
      }
    }
    pintarCats();
  });
  $("#catNueva").addEventListener("click", () => {
    const nombre = prompt("Nombre de la nueva categoría (ej.: Rock, Fútbol, Mascotas)");
    if (!nombre?.trim()) return;
    let id = slug(nombre), k = 2;
    while (catsEd.some((c) => c.id === id) || id === "todas" || id === "otra") id = `${slug(nombre).slice(0, 17)}-${k++}`;
    catsEd.push({ id, nombre: nombre.trim().slice(0, 20), icono: "estrella", claves: [], nueva: true, subs: [] });
    pintarCats();
    catIcono = catsEd[catsEd.length - 1]; pintarIconos(); $("#iconos").showModal();
  });
  function pintarIconos() {
    $("#iconosGrid").innerHTML = Object.keys(IC.lista).map((k) => `<button type="button" data-k="${k}" aria-pressed="${catIcono?.icono === k}" title="${esc(IC.nombres[k] || k)}">${IC.svg(k)}<span>${esc(IC.nombres[k] || k)}</span></button>`).join("");
    $("#iconoEmoji").value = catIcono && !IC.lista[catIcono.icono] ? catIcono.icono : "";
  }
  $("#iconosGrid").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b || !catIcono) return;
    catIcono.icono = b.dataset.k;
    $("#iconos").close(); pintarCats();
  });
  $("#iconoEmojiOk").addEventListener("click", () => {
    const v = $("#iconoEmoji").value.trim();
    if (!v || /[\u0000-\u007f]/.test(v.replace(/\u200d|\ufe0f/g, "")) || v.length > 16) return toast("Pega un solo emoji (ej.: 🎸)");
    catIcono.icono = v;
    $("#iconos").close(); pintarCats();
  });
  $("#iconos").addEventListener("click", (e) => { if (e.target.id === "iconos" || e.target.closest("[data-close]")) $("#iconos").close(); });
  $("#catDeshacer").addEventListener("click", editarCats);
  const catsParaGuardar = () => catsEd.map((c) => ({
    id: c.id, nombre: c.nombre.trim(), icono: c.icono, claves: c.claves,
    subs: c.subs.map((x) => x.nombre.trim()).filter(Boolean),
    subClaves: Object.fromEntries(c.subs.filter((x) => x.nombre.trim() && x.claves.length).map((x) => [x.nombre.trim(), x.claves])),
  }));
  $("#catGuardar").addEventListener("click", async (e) => {
    const b = e.target;
    const vacia = catsEd.find((c) => !c.nombre.trim());
    if (vacia) return toast("Hay una categoría sin nombre");
    const renombrar = [];
    for (const c of catsEd) for (const x of c.subs) if (x.orig && x.nombre.trim() && x.orig !== x.nombre.trim()) renombrar.push({ categoria: c.id, de: x.orig, a: x.nombre.trim() });
    b.disabled = true;
    try {
      const r = await api({ action: "categorias", categorias: catsParaGuardar(), renombrar });
      categorias = r.categorias;
      editarCats();
      pintarLista(r.artes);
      pintarPendientes();
      toast(`✓ Categorías guardadas${r.cambiados ? ` · ${r.cambiados} arte${r.cambiados === 1 ? "" : "s"} actualizado${r.cambiados === 1 ? "" : "s"}` : ""}`);
    } catch (err) { toast(err.message); }
    b.disabled = false;
  });

  // ---------- Carga masiva: carpetas enteras que se ordenan solas ----------
  // Cada archivo se clasifica por el nombre de sus carpetas y el suyo: nombre o
  // palabras clave (🔑) de una subcategoría → esa subcategoría; de una
  // categoría → esa categoría; si no, va a la categoría elegida en "Los que no
  // reconozca" y su carpeta (si no es genérica, tipo "PNG") pasa a ser una
  // subcategoría nueva. Al subir, cada imagen se mira para marcar semitono y
  // "solo camisetas oscuras". Se sube de a uno (sin guardar miles de imágenes en
  // memoria) y la ruta del archivo evita duplicados si se repite la carpeta.
  const norm = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const compacto = (t) => norm(t).replace(/ /g, "");
  const GENERICAS = new Set(["png", "jpg", "jpeg", "webp", "artes", "arte", "disenos", "diseno", "imagenes", "imagen", "images", "img", "final", "finales", "export", "exports", "mockups", "mockup", "nueva carpeta", "new folder", "varios", "dtf", "listos", "para imprimir",
    // Marcas del organizador de artes (Marca → Categoría): no son subcategorías
    "searcade", "grafitico", "rey midas", "reymidas", "tikicia", "tikicia records", "organizado", "organizados", "artes organizados"]);
  // Código del organizador de artes al inicio del archivo: "SRC-ANI-0003_naruto"
  const CODIGO = /^([A-Z]{2,5}-[A-Z0-9]{2,5}-\d{2,6})[\s_-]*/i;
  const titulo = (t) => t.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
  let masiva = { items: [], abiertos: new Set(), corriendo: false, pausa: false, defecto: "", carpetas: "sub" };
  // Coincidencia: palabra completa, o pegada (sin espacios) si el término es largo
  function coincide(term, texto) {
    const tn = norm(term);
    if (!tn) return 0;
    if (` ${texto.n} `.includes(` ${tn} `)) return tn.length;
    const tc = tn.replace(/ /g, "");
    return tc.length >= 6 && texto.c.includes(tc) ? tc.length : 0;
  }
  function clasificar(ruta, sinRaiz) {
    const partes = ruta.split("/");
    if (sinRaiz) partes.shift(); // la carpeta elegida solo contiene a las demás
    let archivo = partes.pop().replace(/\.[^.]+$/, "");
    const cod = archivo.match(CODIGO);
    if (cod && archivo.length > cod[0].length) archivo = archivo.slice(cod[0].length);
    const carpetas = partes.filter((x) => !GENERICAS.has(norm(x)) && norm(x).replace(/\d/g, "").trim());
    const todo = `${partes.join(" ")} ${archivo}`;
    const texto = { n: norm(todo), c: compacto(todo) };
    let mejor = null; // { cat, sub, puntos, term }
    for (const c of categorias) {
      for (const sub of c.subs || []) {
        for (const t of [sub, ...(c.subClaves?.[sub] || [])]) {
          const k = coincide(t, texto);
          if (k && (!mejor || k + 100 > mejor.puntos)) mejor = { cat: c.id, sub, puntos: k + 100, term: t };
        }
      }
      for (const t of [c.nombre, c.id, ...(c.claves || [])]) {
        const k = coincide(t, texto);
        // enCarpeta: la categoría sale de una carpeta (pesa más que una palabra del nombre del archivo)
        const enCarpeta = !!coincide(t, { n: norm(partes.join(" ")), c: compacto(partes.join(" ")) });
        if (k && (!mejor || k + (enCarpeta ? 50 : 0) > mejor.puntos)) mejor = { cat: c.id, sub: "", puntos: k + (enCarpeta ? 50 : 0), term: t, enCarpeta };
      }
    }
    // Modo "categorías nuevas": una carpeta desconocida gana a una categoría que
    // solo aparece como palabra en el nombre del archivo ("Navidad/arbol-gamer")
    const carpetaDesconocida = [...carpetas].reverse().find((x) => !categorias.some((c) => compacto(x) === compacto(c.nombre) || compacto(x) === compacto(c.id)));
    if (masiva.carpetas === "cat" && mejor && !mejor.sub && !mejor.enCarpeta && carpetaDesconocida) mejor = null;
    const it = { ruta, codigo: cod ? cod[1].toUpperCase() : "", categoria: mejor?.cat || "", sub: mejor?.sub || "", reconocido: !!mejor, subNueva: false, catNueva: null, estado: "pendiente" };
    // Sin subcategoría: la carpeta más cercana que no sea genérica ni la categoría
    if (!it.sub) {
      const cat = categorias.find((c) => c.id === it.categoria);
      const carpeta = [...carpetas].reverse().find((x) => !cat || (compacto(x) !== compacto(cat.nombre) && compacto(x) !== compacto(cat.id)));
      if (carpeta && !it.categoria && masiva.carpetas === "cat") {
        // Modo "categorías nuevas": la carpeta desconocida es una categoría de la tienda
        const nombre = titulo(carpeta.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()).slice(0, 20);
        it.catNueva = { id: slug(nombre), nombre };
        it.categoria = it.catNueva.id;
        it.reconocido = true; // va a su categoría nueva, no a "los que no reconozca"
      } else if (carpeta) {
        const limpia = carpeta.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
        const legible = limpia === limpia.toUpperCase() || limpia === limpia.toLowerCase() || /[_-]/.test(carpeta) ? titulo(limpia) : limpia;
        // ¿Ya existe con otras mayúsculas o espacios? Se usa la existente
        const igual = (cat ? [cat] : categorias).flatMap((c) => (c.subs || []).map((x) => [c.id, x])).find(([, x]) => compacto(x) === compacto(limpia));
        if (igual) { it.sub = igual[1]; if (!it.categoria) { it.categoria = igual[0]; it.reconocido = true; } }
        else { it.sub = legible.slice(0, 30); it.subNueva = true; }
      }
    }
    // Nombre: el del archivo; si solo repite la colección y un número, "<Subcategoría> <número>"
    const limpio = archivo.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    let resto = compacto(limpio);
    if (mejor) resto = resto.replace(compacto(mejor.term), "");
    if (it.sub) resto = resto.replace(compacto(it.sub), "");
    const num = (limpio.match(/(\d+)(?!.*\d)/) || [])[1] || "";
    it.nombreAuto = resto.replace(/\d/g, "").length < 3 && (it.sub || mejor) ? `${it.sub || categorias.find((c) => c.id === it.categoria)?.nombre || limpio} ${num}`.trim() : limpio;
    if (it.nombreAuto === it.nombreAuto.toLowerCase()) it.nombreAuto = titulo(it.nombreAuto); // "goku super saiyan" → "Goku Super Saiyan"
    it.nombre = it.nombreAuto.slice(0, 60);
    return it;
  }
  async function recolectar(entradas) {
    // entradas: [{ file, ruta }]
    const ya = new Set(publicados.flatMap((a) => [a.fuente, a.codigo]).filter(Boolean));
    const vistas = new Set(masiva.items.map((x) => x.ruta));
    // Si la carpeta elegida tiene subcarpetas, su nombre no cuenta (suele ser "Mis artes")
    const raices = new Set(entradas.map((x) => x.ruta.split("/")[0]));
    const sinRaiz = raices.size === 1 && entradas.some((x) => x.ruta.split("/").length >= 3);
    for (const { file, ruta } of entradas) {
      if (!/\.(png|webp)$/i.test(ruta) || vistas.has(ruta)) continue;
      vistas.add(ruta);
      const it = clasificar(ruta, sinRaiz);
      it.file = file;
      if (ya.has(ruta) || (it.codigo && ya.has(it.codigo))) it.estado = "repetido";
      masiva.items.push(it);
    }
    pintarMasiva();
  }
  // Carpetas arrastradas: recorrer el árbol (Chrome/Edge/Firefox/Safari)
  async function leerEntrada(entry, base = "") {
    if (entry.isFile) return [await new Promise((ok, no) => entry.file((f) => ok({ file: f, ruta: base + f.name }), no))];
    if (!entry.isDirectory) return [];
    const lector = entry.createReader(), hijos = [];
    for (;;) {
      const lote = await new Promise((ok, no) => lector.readEntries(ok, no));
      if (!lote.length) break;
      hijos.push(...lote);
    }
    const out = [];
    for (const h of hijos) out.push(...(await leerEntrada(h, `${base}${entry.name}/`)));
    return out;
  }
  // ---------- Trabajo en equipo con el Buscador de Artes (BUSCADOR_DE_ARTES.html) ----------
  // El buscador baja "artes-para-web.json" con los diseños marcados con ⭐:
  // { artes: [{ codigo, titulo, categoria, fechaEspecial, tema, formatos, vistaPrevia, archivos: ["ANIME/…/x.png", …] }] }
  // Las rutas son relativas a la carpeta principal de artes (la que tiene
  // _CATALOGO). Con el JSON cargado, al elegir esa carpeta el panel busca el PNG
  // de cada arte y usa su código, título, categoría y tema tal cual.
  $("#masivaJson").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      const artes = Array.isArray(d) ? d : d.artes;
      if (!Array.isArray(artes) || !artes.length || !artes.every((a) => a && (a.codigo || a.titulo))) throw new Error("no es un JSON del Buscador de Artes");
      masiva.json = { nombre: f.name, artes };
      $("#masivaJsonInfo").innerHTML = `📄 <b>${esc(f.name)}</b>: ${artes.length} arte${artes.length === 1 ? "" : "s"} marcados. Ahora tocá <b>📁 Elegir carpeta</b> y elegí tu carpeta principal de artes (la que tiene <code>_CATALOGO</code>). <button type="button" class="adm-link-btn" id="masivaJsonQuitar">quitar JSON</button>`;
      $("#masivaJsonInfo").hidden = false;
    } catch (err) { toast(`${f.name}: ${err.message}`); }
  });
  $("#masivaJsonInfo").addEventListener("click", (e) => { if (e.target.id === "masivaJsonQuitar") { masiva.json = null; $("#masivaJsonInfo").hidden = true; } });
  const IMG_WEB = /\.(png|webp)$/i;
  function recolectarDesdeJson(entradas) {
    const { artes } = masiva.json;
    // Índice de la carpeta elegida: ruta sin la carpeta raíz, en minúsculas
    const sinRaiz = (r) => r.split("/").slice(1).join("/").toLowerCase();
    const porRuta = new Map(), porNombre = new Map();
    for (const en of entradas) {
      porRuta.set(sinRaiz(en.ruta), en);
      porRuta.set(en.ruta.toLowerCase(), en);
      const k = en.ruta.split("/").pop().toLowerCase();
      if (!porNombre.has(k)) porNombre.set(k, []);
      porNombre.get(k).push(en);
    }
    const buscar = (p) => {
      const r = String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
      if (!r) return null;
      if (porRuta.has(r)) return porRuta.get(r);
      // Se eligió una subcarpeta o la carpeta de más arriba: comparar por el final de la ruta
      const mismos = porNombre.get(r.split("/").pop()) || [];
      return mismos.find((en) => en.ruta.toLowerCase().endsWith("/" + r) || r.endsWith("/" + sinRaiz(en.ruta))) || (mismos.length === 1 ? mismos[0] : null);
    };
    const ya = new Set(publicados.flatMap((a) => [a.fuente, a.codigo]).filter(Boolean));
    const vistas = new Set(masiva.items.map((x) => x.codigo || x.ruta));
    let sinArchivo = 0;
    for (const a of artes) {
      const codigo = String(a.codigo || "").trim().toUpperCase().slice(0, 20);
      if (vistas.has(codigo)) continue;
      const rutas = [...(a.archivos || []), a.vistaPrevia].filter((x) => IMG_WEB.test(String(x || "")));
      let en = null;
      for (const r of rutas) if ((en = buscar(r))) break;
      // Categoría: la de la tienda con el mismo nombre, o una nueva
      const catTxt = String(a.categoria || "").trim();
      const cat = categorias.find((c) => compacto(c.nombre) === compacto(catTxt) || c.id === slug(catTxt));
      const nombreCatNueva = catTxt ? titulo(catTxt.replace(/[_-]+/g, " ")).slice(0, 20) : "";
      const titulo0 = String(a.titulo || codigo).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
      let sub = String(a.tema || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
      if (sub && GENERICAS.has(norm(sub))) sub = "";
      if (sub && (sub === sub.toUpperCase() || sub === sub.toLowerCase())) sub = titulo(sub); // "ONE PIECE" → "One Piece"
      if (sub && cat) { const igual = (cat.subs || []).find((x) => compacto(x) === compacto(sub)); if (igual) sub = igual; }
      if (!sub && cat) { const c2 = clasificar(`${titulo0}.png`); if (c2.categoria === cat.id && !c2.subNueva) sub = c2.sub; } // palabras clave 🔑
      const it = {
        ruta: en ? en.ruta : (rutas[0] || codigo), file: en?.file || null, codigo, json: true,
        nombre: (titulo0 === titulo0.toLowerCase() ? titulo(titulo0) : titulo0).slice(0, 60),
        categoria: cat ? cat.id : nombreCatNueva ? slug(nombreCatNueva) : "",
        catNueva: !cat && nombreCatNueva ? { id: slug(nombreCatNueva), nombre: nombreCatNueva } : null,
        sub, subNueva: !!sub && !(cat?.subs || []).includes(sub), reconocido: !!catTxt, estado: "pendiente",
      };
      it.nombreAuto = it.nombre;
      if (!en) { it.estado = "error"; it.error = rutas.length ? "no encontré su PNG en la carpeta elegida" : "no tiene PNG ni WebP (solo vectores o PSD)"; sinArchivo++; }
      else if (ya.has(codigo) || ya.has(en.ruta)) it.estado = "repetido";
      vistas.add(codigo || it.ruta);
      masiva.items.push(it);
    }
    if (sinArchivo) toast(`${sinArchivo} arte${sinArchivo === 1 ? "" : "s"} del JSON sin PNG en esa carpeta: quedan marcados con error`);
    pintarMasiva();
  }
  $("#masivaCarpeta").addEventListener("change", (e) => {
    const entradas = [...e.target.files].map((f) => ({ file: f, ruta: f.webkitRelativePath || f.name }));
    e.target.value = "";
    if (masiva.json) recolectarDesdeJson(entradas); else recolectar(entradas);
  });
  $("#masivaArchivos").addEventListener("change", (e) => { recolectar([...e.target.files].map((f) => ({ file: f, ruta: f.name }))); e.target.value = ""; });
  const zona = $("#masivaZona");
  ["dragenter", "dragover"].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => zona.addEventListener(t, () => zona.classList.remove("over")));
  zona.addEventListener("drop", async (e) => {
    e.preventDefault();
    const entradas = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    const archivos = [];
    for (const en of entradas) archivos.push(...(await leerEntrada(en)));
    if (masiva.json) recolectarDesdeJson(archivos); else recolectar(archivos);
  });

  const destino = (it) => it.categoria || masiva.defecto;
  // Se sube solo lo pendiente y marcado (casillas por arte y por grupo)
  const va = (x) => x.estado === "pendiente" && x.incluir !== false;
  const nombreCat = (id) => categorias.find((c) => c.id === id)?.nombre || masiva.items.find((x) => x.catNueva?.id === id)?.catNueva.nombre || id || "—";
  function grupos() {
    const g = new Map();
    for (const it of masiva.items) {
      const k = JSON.stringify([destino(it), it.sub]);
      if (!g.has(k)) g.set(k, { cat: destino(it), sub: it.sub, items: [] });
      g.get(k).items.push(it);
    }
    return [...g.values()].sort((a, b) => nombreCat(a.cat).localeCompare(nombreCat(b.cat), "es") || a.sub.localeCompare(b.sub, "es"));
  }
  function pintarMasiva() {
    const items = masiva.items;
    $("#masivaResumen").hidden = !items.length;
    if (!items.length) return;
    if (!masiva.defecto || !categorias.some((c) => c.id === masiva.defecto)) masiva.defecto = categorias[0]?.id || "";
    const n = (f) => items.filter(f).length;
    const pend = n(va), apartados = n((x) => x.estado === "pendiente" && x.incluir === false), listos = n((x) => x.estado === "listo"), rep = n((x) => x.estado === "repetido"), err = n((x) => x.estado === "error");
    const sinRec = n((x) => !x.reconocido && va(x));
    const nuevas = [...new Set(items.filter((x) => x.subNueva && va(x)).map((x) => `${nombreCat(destino(x))} › ${x.sub}`))];
    const catsNuevas = [...new Set(items.filter((x) => x.catNueva && va(x) && !categorias.some((c) => c.id === x.catNueva.id)).map((x) => x.catNueva.nombre))];
    $("#masivaStats").innerHTML = `<b>${items.length}</b> archivos · <b>${pend}</b> marcados para subir${apartados ? ` · ${apartados} sin marcar (no se suben)` : ""}${listos ? ` · ✓ ${listos} subidos` : ""}${rep ? ` · ${rep} ya estaban` : ""}${err ? ` · <span class="mal">${err} con error</span>` : ""}`
      + (sinRec ? `<br>${sinRec} sin reconocer: van a la categoría de abajo (podés cambiarlos uno por uno).` : "")
      + (catsNuevas.length ? `<br>Categorías nuevas: ${catsNuevas.map(esc).join(", ")}` : "")
      + (nuevas.length ? `<br>Subcategorías nuevas: ${nuevas.map(esc).join(", ")}` : "");
    $("#masivaDefecto").innerHTML = opciones(masiva.defecto);
    $("#masivaCarpetasModo").value = masiva.carpetas;
    $("#masivaGrupos").innerHTML = grupos().map((g) => {
      const k = JSON.stringify([g.cat, g.sub]), abierto = masiva.abiertos.has(k);
      const nueva = g.items.some((x) => x.subNueva || (x.catNueva && !categorias.some((c) => c.id === x.catNueva.id)));
      const filas = abierto ? g.items.slice(0, 200).map((it) => `<div class="m-fila ${it.estado}${it.incluir === false ? " fuera" : ""}" data-r="${esc(it.ruta)}">
          <label class="m-chk" title="Subir este arte"><input type="checkbox" data-m="incluir"${it.incluir !== false ? " checked" : ""}${it.estado !== "pendiente" ? " disabled" : ""}></label>
          <input data-m="nombre" value="${esc(it.nombre)}" maxlength="60" aria-label="Nombre"${it.estado !== "pendiente" ? " disabled" : ""}>
          <select data-m="categoria" aria-label="Categoría"${it.estado !== "pendiente" ? " disabled" : ""}>${opciones(destino(it))}${it.catNueva && !categorias.some((c) => c.id === it.catNueva.id) ? `<option value="${esc(it.catNueva.id)}" selected>${esc(it.catNueva.nombre)} (nueva)</option>` : ""}</select>
          <input data-m="sub" value="${esc(it.sub)}" maxlength="30" placeholder="Subcategoría" aria-label="Subcategoría" list="masivaSubs"${it.estado !== "pendiente" ? " disabled" : ""}>
          <small title="${esc(it.ruta)}">${it.codigo ? `<b>${esc(it.codigo)}</b> · ` : ""}${esc(it.ruta)}${it.estado === "error" ? ` · ${esc(it.error)}` : it.estado === "listo" ? " · ✓" : it.estado === "repetido" ? " · ya estaba" : ""}</small>
        </div>`).join("") + (g.items.length > 200 ? `<p class="adm-nota">… y ${g.items.length - 200} más con la misma clasificación.</p>` : "") : "";
      const hechos = g.items.filter((x) => x.estado !== "pendiente").length;
      const pendG = g.items.filter((x) => x.estado === "pendiente"), marcados = pendG.filter((x) => x.incluir !== false).length;
      return `<div class="m-grupo${abierto ? " abierto" : ""}${pendG.length && !marcados ? " fuera" : ""}" data-k="${esc(k)}">
        <div class="m-cab"><label class="m-chk" title="Subir este grupo"><input type="checkbox" data-a="grupo"${marcados ? " checked" : ""}${marcados && marcados < pendG.length ? " data-mixto" : ""}${pendG.length ? "" : " disabled"}></label>
        <button type="button" class="m-tit" data-a="abrir"><span>${esc(nombreCat(g.cat))}${g.sub ? ` › ${esc(g.sub)}` : ""}${nueva ? ' <em>nueva</em>' : ""}${g.items.some((x) => !x.reconocido) ? ' <em class="gris">sin reconocer</em>' : ""}</span><b>${pendG.length && marcados < pendG.length ? `${marcados} de ` : ""}${hechos ? `${hechos}/` : ""}${g.items.length}</b></button></div>
        ${filas}
      </div>`;
    }).join("");
    document.querySelectorAll("#masivaGrupos [data-mixto]").forEach((x) => (x.indeterminate = true));
    $("#masivaSubs").innerHTML = [...new Set(categorias.flatMap((c) => c.subs || []))].map((x) => `<option value="${esc(x)}">`).join("");
    $("#masivaSubir").disabled = masiva.corriendo || !pend;
    $("#masivaSubir").textContent = listos || err ? `Seguir subiendo (${pend})` : `Subir marcados (${pend})`;
    $("#masivaPausa").hidden = !masiva.corriendo;
    $("#masivaQuitar").hidden = masiva.corriendo;
  }
  $("#masivaDefecto").addEventListener("change", (e) => { masiva.defecto = e.target.value; pintarMasiva(); });
  // Cambiar el modo reclasifica lo que aún no se subió (se conservan los nombres editados)
  $("#masivaCarpetasModo").addEventListener("change", (e) => {
    masiva.carpetas = e.target.value;
    const raices = new Set(masiva.items.map((x) => x.ruta.split("/")[0]));
    const sinRaiz = raices.size === 1 && masiva.items.some((x) => x.ruta.split("/").length >= 3);
    masiva.items = masiva.items.map((it) => {
      if (it.estado !== "pendiente" || it.json) return it;
      const n = clasificar(it.ruta, sinRaiz);
      return { ...n, file: it.file, incluir: it.incluir, nombre: it.nombre !== it.nombreAuto ? it.nombre : n.nombre };
    });
    pintarMasiva();
  });
  $("#masivaGrupos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-a=abrir]");
    if (!b) return;
    const k = b.closest(".m-grupo").dataset.k;
    if (masiva.abiertos.has(k)) masiva.abiertos.delete(k); else masiva.abiertos.add(k);
    pintarMasiva();
  });
  $("#masivaGrupos").addEventListener("change", (e) => {
    if (e.target.dataset.a === "grupo") {
      const k = e.target.closest(".m-grupo").dataset.k;
      const g = grupos().find((x) => JSON.stringify([x.cat, x.sub]) === k);
      for (const it of g?.items || []) if (it.estado === "pendiente") it.incluir = e.target.checked;
      return pintarMasiva();
    }
    const f = e.target.closest(".m-fila");
    const it = f && masiva.items.find((x) => x.ruta === f.dataset.r);
    if (!it) return;
    const k = e.target.dataset.m;
    if (k === "incluir") it.incluir = e.target.checked;
    if (k === "nombre") it.nombre = e.target.value.trim().slice(0, 60) || it.nombreAuto;
    if (k === "categoria") { it.categoria = e.target.value; it.reconocido = true; if (it.catNueva && it.catNueva.id !== it.categoria) it.catNueva = null; }
    if (k === "sub") { it.sub = e.target.value.trim().slice(0, 30); it.subNueva = !!it.sub && !(categorias.find((c) => c.id === destino(it))?.subs || []).includes(it.sub); }
    pintarMasiva();
  });
  const marcarTodo = (v) => { for (const it of masiva.items) if (it.estado === "pendiente") it.incluir = v; pintarMasiva(); };
  $("#masivaTodos").addEventListener("click", () => marcarTodo(true));
  $("#masivaNinguno").addEventListener("click", () => marcarTodo(false));
  $("#masivaQuitar").addEventListener("click", () => { if (confirm("¿Descartar la lista de la carga masiva? (Lo ya subido queda en la tienda)")) { masiva.items = []; masiva.abiertos.clear(); pintarMasiva(); } });
  $("#masivaPausa").addEventListener("click", () => { masiva.pausa = true; $("#masivaPausa").disabled = true; $("#masivaProg").textContent = "Pausando al terminar el arte actual…"; });

  // Mirar la imagen: "solo camisetas oscuras" (casi sin negro: la tela hace las
  // sombras) y pocas tintas planas (semitono). Probado con 25 artes reales.
  async function analizar(file) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0, oscuro = 0;
    const cubos = new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] <= 200) continue;
      n++;
      if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 45) oscuro++;
      const key = ((d[i] / 48) | 0) * 36 + ((d[i + 1] / 48) | 0) * 6 + ((d[i + 2] / 48) | 0);
      cubos.set(key, (cubos.get(key) || 0) + 1);
    }
    if (!n) return { oscuras: false, pocasTintas: false };
    let acc = 0, tintas = 0;
    for (const v of [...cubos.values()].sort((a, b) => b - a)) { acc += v; tintas++; if (acc >= 0.95 * n) break; }
    return { oscuras: oscuro / n < 0.03, pocasTintas: tintas <= 4 }; // calibrado: 21 de 25 y 22 de 25
  }

  $("#masivaSubir").addEventListener("click", async () => {
    if (masiva.corriendo) return;
    masiva.corriendo = true; masiva.pausa = false;
    $("#masivaPausa").disabled = false;
    pintarMasiva();
    const prog = $("#masivaProg"), barra = $("#masivaBarra");
    try {
      // 1) Subcategorías nuevas a su categoría (una sola vez)
      const faltan = new Map(), catsFaltan = new Map();
      for (const it of masiva.items) {
        if (va(it) && it.catNueva && !categorias.some((c) => c.id === it.catNueva.id)) catsFaltan.set(it.catNueva.id, it.catNueva);
        if (!va(it) || !it.sub) continue;
        const c = categorias.find((x) => x.id === destino(it));
        if ((c && !(c.subs || []).includes(it.sub)) || catsFaltan.has(destino(it))) faltan.set(JSON.stringify([destino(it), it.sub]), [destino(it), it.sub]);
      }
      if (faltan.size || catsFaltan.size) {
        prog.textContent = `Creando ${catsFaltan.size ? `${catsFaltan.size} categoría${catsFaltan.size === 1 ? "" : "s"} y ` : ""}${faltan.size} subcategoría${faltan.size === 1 ? "" : "s"}…`;
        editarCats();
        for (const c of catsFaltan.values()) if (!catsEd.some((x) => x.id === c.id)) catsEd.push({ id: c.id, nombre: c.nombre, icono: "", claves: [], nueva: true, subs: [] });
        for (const [cat, sub] of faltan.values()) {
          const c = catsEd.find((x) => x.id === cat);
          if (c && !c.subs.some((x) => x.nombre === sub)) c.subs.push({ nombre: sub, orig: "", claves: [] });
        }
        const r = await api({ action: "categorias", categorias: catsParaGuardar(), renombrar: [] });
        categorias = r.categorias;
        editarCats();
      }
      // 2) Los artes, de a uno
      const cola = masiva.items.filter(va);
      const t0 = Date.now();
      for (let i = 0; i < cola.length; i++) {
        if (masiva.pausa) break;
        const it = cola[i];
        const resta = i ? Math.round(((Date.now() - t0) / i) * (cola.length - i) / 60000) : null;
        prog.textContent = `Subiendo ${i + 1} de ${cola.length}: ${it.nombre}${resta !== null ? ` · faltan ~${resta} min` : ""}`;
        barra.style.width = `${(i / cola.length) * 100}%`;
        try {
          const img = await preparar(it.file);
          const vis = await analizar(it.file);
          const r = await api({ action: "subir", corto: true, fuente: it.ruta, codigo: it.codigo, nombre: it.nombre, categoria: destino(it), sub: it.sub, precio: "",
            semitono: vis.pocasTintas, oscuras: img.transparente && vis.oscuras, imagen: await aDataUrl(img.vista) });
          if (r.repetido) { it.estado = "repetido"; URL.revokeObjectURL(img.url); continue; }
          await api({ action: "original", corto: true, id: r.arte.id, imagen: await aDataUrl(img.blob) });
          const vurl = URL.createObjectURL(img.vista);
          try {
            const mini = await hacerMini(vurl);
            r.arte = (await api({ action: "miniatura", corto: true, id: r.arte.id, imagen: await aDataUrl(mini) })).arte || r.arte;
          } catch {} // la miniatura se rehace sola al abrir el panel
          URL.revokeObjectURL(vurl); URL.revokeObjectURL(img.url);
          r.arte.protegido = true;
          publicados.unshift(r.arte);
          it.estado = "listo";
          if (!img.transparente) it.error = "sin fondo transparente";
        } catch (err) {
          if (err.status === 401) { masiva.pausa = true; toast("Tu sesión venció: vuelve a entrar y toca Seguir subiendo"); guardarToken(""); mostrarLogin("Tu sesión venció: vuelve a entrar. La carga masiva sigue donde quedó."); $("#panel").hidden = false; break; }
          it.estado = "error"; it.error = err.message;
        }
        if (i % 10 === 9) pintarMasiva();
      }
      barra.style.width = "100%";
    } catch (err) {
      toast(err.message);
    } finally {
      masiva.corriendo = false;
      const listos = masiva.items.filter((x) => x.estado === "listo").length;
      prog.textContent = masiva.pausa ? "En pausa." : `Listo: ${listos} subidos.`;
      pintarMasiva();
      try { const ind = await api({ action: "listar" }); publicados = ind.artes; if (ind.categorias?.length) categorias = ind.categorias; editarCats(); pintarLista(ind.artes); } catch {}
    }
  });
  window.addEventListener("beforeunload", (e) => { if (masiva.corriendo) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- Lookbook / banners ----------
  async function prepararFoto(file) {
    const bmp = await createImageBitmap(file);
    let escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    for (let intento = 0; intento < 8; intento++) {
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * escala); c.height = Math.round(bmp.height * escala);
      const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, c.width, c.height);
      for (const q of [0.86, 0.78, 0.7]) {
        const blob = await new Promise((ok) => c.toBlob(ok, "image/webp", q));
        if (blob && blob.type === "image/webp" && blob.size <= MAX_BYTES) return blob;
      }
      escala *= 0.8;
    }
    throw new Error("No se pudo dejar la foto por debajo de 700 KB");
  }
  // Opciones "¿qué diseño sale en la foto?" (los artes publicados)
  let fotosActuales = [];
  const opcionesArte = (sel) => `<option value="">— Ninguno (banner) —</option>` +
    publicados.map((a) => `<option value="${esc(a.id)}"${a.id === sel ? " selected" : ""}>${esc(a.nombre)}</option>`).join("");
  function pintarFotos(lookbook = fotosActuales) {
    fotosActuales = lookbook;
    const elegido = $("#fotoArte").value;
    $("#fotoArte").innerHTML = opcionesArte(elegido);
    $("#cuentaFotos").textContent = `(${lookbook.length})`;
    $("#fotos").innerHTML = lookbook.length ? lookbook.map((f) => `
      <div class="ficha" data-foto="${esc(f.id)}">
        <img src="${esc(f.archivo)}" alt="${esc(f.titulo)}" loading="lazy">
        <p>${esc(f.titulo || "Sin título")}</p>
        <label>Diseño en la foto<select data-f="arte">${opcionesArte(f.arte || "")}</select></label>
        <div class="botones"><button class="adm-btn danger" data-a="borrar-foto">Borrar</button></div>
      </div>`).join("") : '<p class="vacio">Todavía no hay fotos. Mientras tanto la tienda muestra la foto de ejemplo.</p>';
  }
  $("#fotoArchivo").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const caja = $(".foto-subir");
    caja.classList.add("subiendo");
    try {
      const blob = await prepararFoto(file);
      const r = await api({ action: "subir-foto", titulo: $("#fotoTitulo").value, arte: $("#fotoArte").value, imagen: await aDataUrl(blob) });
      $("#fotoTitulo").value = "";
      $("#fotoArte").value = "";
      pintarFotos(r.lookbook);
      toast("✓ Foto publicada en el lookbook");
    } catch (err) {
      toast(err.message);
    } finally {
      caja.classList.remove("subiendo");
    }
  });
  $("#fotos").addEventListener("change", async (e) => {
    if (e.target.dataset.f !== "arte") return;
    const s = e.target;
    s.disabled = true;
    try { pintarFotos((await api({ action: "editar-foto", id: s.closest(".ficha").dataset.foto, arte: s.value })).lookbook); toast(s.value ? "✓ Foto ligada al diseño" : "✓ La foto quedó como banner"); }
    catch (err) { s.disabled = false; toast(err.message); }
  });
  $("#fotos").addEventListener("click", async (e) => {
    const b = e.target.closest('[data-a="borrar-foto"]');
    if (!b || !confirm("¿Borrar esta foto del lookbook?")) return;
    b.disabled = true;
    try { pintarFotos((await api({ action: "borrar-foto", id: b.closest(".ficha").dataset.foto })).lookbook); toast("Foto borrada"); }
    catch (err) { b.disabled = false; toast(err.message); }
  });

  // ---------- Arranque y acceso ----------
  const mostrarLogin = (msg = "") => {
    $("#panel").hidden = true;
    $("#salir").hidden = true;
    $("#login").hidden = false;
    $("#loginError").textContent = msg;
    $("#estado").textContent = "";
    setTimeout(() => ($("#usuario").value ? $("#clave") : $("#usuario")).focus(), 50);
  };
  const sinConexion = "El navegador no dejó salir la conexión al servidor. Suele ser una extensión (bloqueador de anuncios, antivirus o privacidad): prueba en una ventana de incógnito o desactívala para este sitio. En Brave, baja los Escudos (el león).";
  async function iniciar() {
    if (!token) return mostrarLogin();
    $("#estado").textContent = "Abriendo el panel…";
    try {
      const yo = await api({ action: "yo" });
      $("#login").hidden = true;
      $("#panel").hidden = false;
      $("#salir").hidden = false;
      $("#estado").textContent = `Hola, ${yo.nombre}. Lo que subas aparece en la tienda al instante.`;
      const ind = await api({ action: "listar" });
      if (ind.categorias?.length) categorias = ind.categorias;
      publicados = ind.artes;
      editarCats();
      pintarLista(ind.artes);
      pintarFotos(ind.lookbook);
    } catch (e) {
      if (e.status === 401) { guardarToken(""); mostrarLogin("Tu sesión venció: vuelve a entrar."); }
      else mostrarLogin(e.status === 0 ? sinConexion : e.message);
    }
  }
  $("#login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = $("#entrar");
    b.disabled = true;
    $("#loginError").textContent = "";
    try {
      const r = await api({ action: "entrar", usuario: $("#usuario").value, clave: $("#clave").value });
      guardarToken(r.token);
      $("#clave").value = "";
      await iniciar();
    } catch (err) {
      $("#loginError").textContent = err.status === 0 ? sinConexion : err.message;
    } finally {
      b.disabled = false;
    }
  });
  $("#salir").addEventListener("click", () => { guardarToken(""); mostrarLogin(); });

  Promise.all([fetch("productos.json").then((r) => r.json()).catch(() => ({})), T.precargar()]).then(([d]) => {
    categorias = (d.categorias || [{ id: "pop", nombre: "Pop" }]).map((c) => ({ icono: "", subs: [], ...c }));
    pintarVivo();
    iniciar();
  });
})();

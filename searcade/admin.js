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
          return { blob, url: URL.createObjectURL(blob), ancho: o.width, alto: o.height, transparente, semitono };
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

  const campoSemi = (semi) => `<label class="chk"><input type="checkbox" data-f="semitono"${semi ? " checked" : ""}> Es semitono <small>(puntos que dejan ver la tela)</small></label>`;

  function pintarPendientes() {
    $("#pendientes").innerHTML = pendientes.map((p) => `
      <div class="ficha" data-k="${p.key}">
        ${prev(p.url, p.semitono)}
        <label>Nombre<input data-f="nombre" value="${esc(p.nombre)}" maxlength="60"></label>
        <label>Categoría<select data-f="categoria">${opciones(p.categoria)}</select></label>
        <label>Precio (vacío = ₡${(CFG.precioBase || 11000).toLocaleString("es-CR")})<input data-f="precio" type="number" inputmode="numeric" min="500" step="500" value="${esc(p.precio)}"></label>
        ${campoSemi(p.semitono)}
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
      const r = await api({ action: "subir", nombre: p.nombre, categoria: p.categoria, precio: p.precio, semitono: !!p.semitono, imagen: await aDataUrl(p.blob) });
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
  function pintarLista(artes) {
    if (artes) publicados = artes;
    const semis = publicados.filter((a) => a.semitono).length;
    $("#cuenta").textContent = `(${publicados.length} · ${semis} semitono · ${publicados.length - semis} full color)`;
    const ver = publicados.filter((a) => filtro === "todos" || (filtro === "semitono") === !!a.semitono);
    $("#lista").innerHTML = ver.length ? ver.map((a) => `
      <div class="ficha" data-id="${esc(a.id)}">
        ${prev(a.archivo, a.semitono)}
        <label>Nombre<input data-f="nombre" value="${esc(a.nombre)}" maxlength="60"></label>
        <label>Categoría<select data-f="categoria">${opciones(a.categoria)}</select></label>
        <label>Precio<input data-f="precio" type="number" inputmode="numeric" min="500" step="500" value="${a.precio ?? ""}" placeholder="${CFG.precioBase || 11000}"></label>
        ${campoSemi(a.semitono)}
        <div class="botones"><button class="adm-btn ghost" data-a="guardar">Guardar</button><button class="adm-btn ghost" data-a="comparar">Colores</button><button class="adm-btn danger" data-a="borrar">Borrar</button></div>
      </div>`).join("") : `<p class="vacio">${publicados.length ? "No hay artes de este tipo." : "Todavía no hay artes. Sube el primero arriba."}</p>`;
    $("#filtroLista").innerHTML = [["todos", "Todos"], ["semitono", "Semitono"], ["full", "Full color"]]
      .map(([id, n]) => `<button role="radio" aria-checked="${id === filtro}" data-v="${id}">${n}</button>`).join("");
  }
  $("#filtroLista").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { filtro = b.dataset.v; pintarLista(); } });
  $("#lista").addEventListener("change", (e) => {
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
    try {
      if (b.dataset.a === "borrar") {
        if (!confirm(`¿Borrar "${v("nombre").value}" de la tienda?`)) return;
        b.disabled = true;
        pintarLista((await api({ action: "borrar", id })).artes);
        toast("Arte borrado");
      } else {
        b.disabled = true;
        pintarLista((await api({ action: "editar", id, nombre: v("nombre").value, categoria: v("categoria").value, precio: v("precio").value, semitono: v("semitono").checked })).artes);
        toast("✓ Cambios guardados");
      }
    } catch (err) {
      b.disabled = false;
      toast(err.message);
    }
  });

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
  function pintarFotos(lookbook = []) {
    $("#cuentaFotos").textContent = `(${lookbook.length})`;
    $("#fotos").innerHTML = lookbook.length ? lookbook.map((f) => `
      <div class="ficha" data-foto="${esc(f.id)}">
        <img src="${esc(f.archivo)}" alt="${esc(f.titulo)}" loading="lazy">
        <p>${esc(f.titulo || "Sin título")}</p>
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
      const r = await api({ action: "subir-foto", titulo: $("#fotoTitulo").value, imagen: await aDataUrl(blob) });
      $("#fotoTitulo").value = "";
      pintarFotos(r.lookbook);
      toast("✓ Foto publicada en el lookbook");
    } catch (err) {
      toast(err.message);
    } finally {
      caja.classList.remove("subiendo");
    }
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
    categorias = d.categorias || [{ id: "pop", nombre: "Pop" }];
    pintarVivo();
    iniciar();
  });
})();

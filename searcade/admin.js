// SEARCADE — panel de artes: el admin sube PNG/WebP, los ve estampados sobre
// la camiseta y los publica. Usa la sesión de admin de reymidascr.com.
(() => {
  const CFG = window.SEARCADE_CONFIG || {};
  const API = CFG.api || "https://reymidascr.com/api/searcade";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAX_BYTES = 700 * 1024; // el servidor acepta hasta 720 KB
  const MAX_LADO = 1400;
  const Z = CFG.zona || { x: 31, y: 27, ancho: 38, alto: 48 };
  let categorias = [];
  let baseOk = false;
  let pendientes = [];

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  async function api(body) {
    const r = await fetch(API, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let d = {};
    try { d = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(new Error(d.error || `Error ${r.status}`), { status: r.status });
    return d;
  }

  const SHIRT = "M60 18 L88 8 Q100 22 112 8 L140 18 L178 48 L160 78 L142 68 L142 196 L58 196 L58 68 L40 78 L22 48 Z";
  const comp = (src) => `<span class="comp${baseOk ? "" : " sin-base"}">${baseOk
    ? `<img class="base" src="${esc(CFG.camisetaBase)}" alt="">`
    : `<svg class="base" viewBox="0 0 200 210"><path d="${SHIRT}" fill="#121016" stroke="#2a2633" stroke-width="2"/></svg>`}<img class="print" src="${esc(src)}" alt="" style="left:${Z.x}%;top:${Z.y}%;width:${Z.ancho}%;height:${Z.alto}%"></span>`;
  const opciones = (sel) => categorias.map((c) => `<option value="${esc(c.id)}"${c.id === sel ? " selected" : ""}>${esc(c.nombre)}</option>`).join("");

  // ---------- Preparar la imagen en el navegador ----------
  // Recorta el borde transparente (para que el arte quede centrado en el
  // pecho), la achica a 1400 px y la pasa a WebP de menos de 700 KB.
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
    let escala = Math.min(1, MAX_LADO / Math.max(w, h));
    const transparente = data.some((v, i) => i % 4 === 3 && v < 250);
    for (let intento = 0; intento < 8; intento++) {
      const o = document.createElement("canvas");
      o.width = Math.round(w * escala); o.height = Math.round(h * escala);
      const octx = o.getContext("2d");
      octx.imageSmoothingQuality = "high";
      octx.drawImage(c, x0, y0, w, h, 0, 0, o.width, o.height);
      for (const q of [0.92, 0.85, 0.78]) {
        const blob = await new Promise((ok) => o.toBlob(ok, "image/webp", q));
        if (blob && blob.type === "image/webp" && blob.size <= MAX_BYTES) {
          return { blob, url: URL.createObjectURL(blob), ancho: o.width, alto: o.height, transparente };
        }
      }
      escala *= 0.8;
    }
    throw new Error("No se pudo dejar la imagen por debajo de 700 KB");
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

  function pintarPendientes() {
    $("#pendientes").innerHTML = pendientes.map((p) => `
      <div class="ficha" data-k="${p.key}">
        <div class="prev">${comp(p.url)}</div>
        <label>Nombre<input data-f="nombre" value="${esc(p.nombre)}" maxlength="60"></label>
        <label>Categoría<select data-f="categoria">${opciones(p.categoria)}</select></label>
        <label>Precio (vacío = ₡${(CFG.precioBase || 11000).toLocaleString("es-CR")})<input data-f="precio" type="number" inputmode="numeric" min="500" step="500" value="${esc(p.precio)}"></label>
        <p class="meta">${p.ancho}×${p.alto} px · ${Math.round(p.blob.size / 1024)} KB</p>
        <div class="botones"><button class="adm-btn" data-a="subir">Subir</button><button class="adm-btn ghost" data-a="quitar">Quitar</button></div>
      </div>`).join("");
    $("#accionesPend").hidden = pendientes.length < 2;
  }
  $("#pendientes").addEventListener("input", (e) => {
    const k = e.target.closest(".ficha")?.dataset.k;
    const p = pendientes.find((x) => x.key === k);
    if (p && e.target.dataset.f) p[e.target.dataset.f] = e.target.value;
  });
  $("#pendientes").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const p = pendientes.find((x) => x.key === b.closest(".ficha").dataset.k);
    if (b.dataset.a === "quitar") { quitar(p); pintarPendientes(); }
    else await subir(p);
  });
  function quitar(p) { URL.revokeObjectURL(p.url); pendientes = pendientes.filter((x) => x !== p); }

  async function subir(p) {
    const el = document.querySelector(`.ficha[data-k="${p.key}"]`);
    el?.classList.add("subiendo");
    try {
      const r = await api({ action: "subir", nombre: p.nombre, categoria: p.categoria, precio: p.precio, imagen: await aDataUrl(p.blob) });
      quitar(p);
      pintarPendientes();
      pintarLista(r.artes);
      toast(`✓ "${r.arte.nombre}" ya está en la tienda`);
      return true;
    } catch (e) {
      el?.classList.remove("subiendo");
      el?.classList.add("error");
      toast(e.status === 401 || e.status === 403 ? "Tu sesión de admin venció: vuelve a entrar en reymidascr.com" : e.message);
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

  // ---------- Artes publicados ----------
  function pintarLista(artes) {
    $("#cuenta").textContent = `(${artes.length})`;
    $("#lista").innerHTML = artes.length ? artes.map((a) => `
      <div class="ficha" data-id="${esc(a.id)}">
        <div class="prev">${comp(a.archivo)}</div>
        <label>Nombre<input data-f="nombre" value="${esc(a.nombre)}" maxlength="60"></label>
        <label>Categoría<select data-f="categoria">${opciones(a.categoria)}</select></label>
        <label>Precio<input data-f="precio" type="number" inputmode="numeric" min="500" step="500" value="${a.precio ?? ""}" placeholder="${CFG.precioBase || 11000}"></label>
        <div class="botones"><button class="adm-btn ghost" data-a="guardar">Guardar</button><button class="adm-btn danger" data-a="borrar">Borrar</button></div>
      </div>`).join("") : '<p class="vacio">Todavía no hay artes. Sube el primero arriba.</p>';
  }
  $("#lista").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const f = b.closest(".ficha");
    const id = f.dataset.id;
    try {
      if (b.dataset.a === "borrar") {
        if (!confirm(`¿Borrar "${f.querySelector('[data-f="nombre"]').value}" de la tienda?`)) return;
        b.disabled = true;
        pintarLista((await api({ action: "borrar", id })).artes);
        toast("Arte borrado");
      } else {
        b.disabled = true;
        const v = (k) => f.querySelector(`[data-f="${k}"]`).value;
        pintarLista((await api({ action: "editar", id, nombre: v("nombre"), categoria: v("categoria"), precio: v("precio") })).artes);
        toast("✓ Cambios guardados");
      }
    } catch (err) {
      b.disabled = false;
      toast(err.message);
    }
  });

  // ---------- Arranque ----------
  async function iniciar() {
    $("#estado").textContent = "Revisando tu sesión…";
    try {
      const yo = await api({ action: "yo" });
      $("#login").hidden = true;
      $("#panel").hidden = false;
      $("#estado").textContent = `Hola, ${yo.nombre}. Lo que subas aparece en la tienda al instante.`;
      pintarLista((await api({ action: "listar" })).artes);
    } catch (e) {
      $("#panel").hidden = true;
      $("#login").hidden = false;
      $("#estado").textContent = e.status === 403 ? "Esa cuenta no es de administrador." : e.status === 401 ? "" : `No se pudo conectar con el servidor (${e.message}).`;
    }
  }
  $("#reintentar").addEventListener("click", iniciar);

  const base = new Promise((ok) => {
    if (!CFG.camisetaBase) return ok(false);
    const im = new Image();
    im.onload = () => { document.documentElement.style.setProperty("--base-ar", `${im.naturalWidth} / ${im.naturalHeight}`); ok(true); };
    im.onerror = () => ok(false);
    im.src = CFG.camisetaBase;
  });
  Promise.all([fetch("productos.json").then((r) => r.json()).catch(() => ({})), base]).then(([d, b]) => {
    categorias = d.categorias || [{ id: "pop", nombre: "Pop" }];
    baseOk = b;
    iniciar();
  });
})();

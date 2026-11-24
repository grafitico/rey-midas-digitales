// SEARCADE — dibuja una camiseta con un arte puesto (color, lado, tamaño y
// colocación) a partir de las fotos base y las medidas de config.js.
// Lo usan la tienda (app.js) y el panel de artes (admin.js), así las dos
// vistas previas son idénticas.
(() => {
  const CFG = window.SEARCADE_CONFIG || {};
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SHIRT = "M60 18 L88 8 Q100 22 112 8 L140 18 L178 48 L160 78 L142 68 L142 196 L58 196 L58 68 L40 78 L22 48 Z";

  const COLORES = CFG.colores?.length ? CFG.colores : [{ id: "negra", nombre: "Negra", hex: "#141218", frente: CFG.camisetaBase }];
  const FORMATOS = CFG.formatos?.length ? CFG.formatos : [{ id: "grande", nombre: "Grande", ancho: 28, alto: 35, extra: 0 }];
  const COLOCACIONES = CFG.colocaciones?.length ? CFG.colocaciones : [{ id: "pecho", nombre: "Pecho", extra: 0 }];
  const FOTO = CFG.foto || { cmAncho: 1.26, cmAlto: 1.23, pecho: { top: 23.5 }, pechoIzquierdo: { centro: 61, top: 21.5 }, espalda: { top: 15 }, espaldaArriba: { top: 9 } };
  const blancaRef = COLORES.find((c) => c.frente && c.id === "blanca") || COLORES.find((c) => c.frente);
  const cargadas = new Set();

  const colorDe = (id) => COLORES.find((c) => c.id === id) || COLORES[0];
  const formatoDe = (id) => FORMATOS.find((f) => f.id === id) || FORMATOS[0];
  const colocacionDe = (id) => COLOCACIONES.find((c) => c.id === id) || COLOCACIONES[0];
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
      const e = FOTO.etiqueta;
      const et = vista === "frente" && e ? `<img class="etq" src="${esc(e.src)}" alt="" style="left:${e.x}%;top:${e.y}%;width:${e.ancho}%;height:${e.alto}%">` : "";
      return `<img class="base" src="${esc(ref)}" alt="" draggable="false">${tinte}${et}`;
    }
    return `<svg class="base" viewBox="0 0 200 210" aria-hidden="true"><path d="${SHIRT}" fill="${esc(c.hex)}" stroke="#2a2633" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }

  // Camiseta con el arte (p.archivo) puesto según o = { color, vista, formato, colocacion, espaldaArchivo? }.
  function camiseta(p, o) {
    const vista = o.vista || "frente";
    let arte = "";
    if (lleva(o.colocacion, vista)) {
      const z = zonaArte(o.formato, vista);
      // La espalda puede llevar otro arte (o.espaldaArchivo)
      const src = vista === "espalda" && o.espaldaArchivo ? o.espaldaArchivo : p.archivo;
      arte = `<img class="print" src="${esc(src)}" alt="${esc(p.nombre || "")}" loading="lazy" draggable="false" style="left:${z.left}%;top:${z.top}%;width:${z.w}%;height:${z.h}%">`;
    }
    return `<span class="comp${cargadas.size ? "" : " sin-base"}" data-vista="${vista}">${baseHTML(o.color, vista)}${arte}</span>`;
  }

  // Carga las fotos base una vez; fija la proporción de la camiseta (--base-ar).
  let lista = null;
  function precargar() {
    if (lista) return lista;
    const urls = [...new Set(COLORES.flatMap((c) => [c.frente, c.espalda]).filter(Boolean))];
    lista = Promise.all(urls.map((u) => new Promise((ok) => {
      const im = new Image();
      im.onload = () => {
        cargadas.add(u);
        if (!document.documentElement.style.getPropertyValue("--base-ar")) document.documentElement.style.setProperty("--base-ar", `${im.naturalWidth} / ${im.naturalHeight}`);
        ok();
      };
      im.onerror = () => ok();
      im.src = u;
    })));
    return lista;
  }

  window.SearcadeTee = { COLORES, FORMATOS, COLOCACIONES, colorDe, formatoDe, colocacionDe, lleva, camiseta, precargar, esc, SHIRT };
})();

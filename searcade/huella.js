// Huella de imagen de SEARCADE: reconoce el mismo arte aunque tenga otro nombre,
// otro tamaño, marca de agua o bordes transparentes distintos. La usa el panel
// para no subir dos veces el mismo diseño (y la API la vuelve a revisar).
//
// Cómo: se recorta el borde transparente, se apoya sobre gris (la
// transparencia cuenta igual en todos), se lleva a 9×8 promediando bloques y se
// compara cada punto con el de al lado (dHash de 64 bits → 16 hex). La distancia
// es la cantidad de bits distintos: mismo arte ≈ 0–6, artes distintos ≈ 20–40.
window.SearcadeHuella = (() => {
  const LADO = 256;
  async function cargar(src) {
    if (src instanceof Blob) return createImageBitmap(src);
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.src = src;
    await im.decode();
    return im;
  }
  async function deImagen(src) {
    const im = await cargar(src);
    const w0 = im.width || im.naturalWidth, h0 = im.height || im.naturalHeight;
    const k = Math.min(1, LADO / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(im, 0, 0, c.width, c.height);
    im.close?.();
    // Recortar lo transparente
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = c.width - 1; y1 = c.height - 1; }
    // Sobre gris, a 36×32 (bloques de 4×4 para el 9×8 final)
    const q = document.createElement("canvas");
    q.width = 36; q.height = 32;
    const qx = q.getContext("2d", { willReadFrequently: true });
    qx.fillStyle = "#808080";
    qx.fillRect(0, 0, 36, 32);
    qx.imageSmoothingQuality = "high";
    qx.drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, 36, 32);
    const p = qx.getImageData(0, 0, 36, 32).data;
    const g = [];
    for (let by = 0; by < 8; by++) for (let bx = 0; bx < 9; bx++) {
      let s = 0;
      for (let y = by * 4; y < by * 4 + 4; y++) for (let x = bx * 4; x < bx * 4 + 4; x++) {
        const i = (y * 36 + x) * 4;
        s += 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      }
      g.push(s / 16);
    }
    let hex = "";
    for (let y = 0; y < 8; y++) {
      let byte = 0;
      for (let x = 0; x < 8; x++) byte = (byte << 1) | (g[y * 9 + x] > g[y * 9 + x + 1] ? 1 : 0);
      hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
  }
  function distancia(a, b) {
    if (!/^[0-9a-f]{16}$/.test(a || "") || !/^[0-9a-f]{16}$/.test(b || "")) return 64;
    let n = 0;
    for (let i = 0; i < 16; i += 4) {
      let v = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
      while (v) { n += v & 1; v >>= 1; }
    }
    return n;
  }
  return { deImagen, distancia, UMBRAL: 8 };
})();

// Íconos de categoría de SEARCADE: los usa la tienda (app.js) y el panel
// (admin.js) para elegir uno. Cada valor es el contenido de un <svg viewBox="0 0 24 24">
// de trazo (stroke). Una categoría también puede usar un emoji como ícono.
window.SEARCADE_ICONOS = (() => {
  const L = {
    camiseta: '<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3Z"/>',
    estrella: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8Z"/>',
    corona: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5Z"/><path d="M5 22h14"/>',
    control: '<path d="M8 6h8a6 6 0 0 1 6 6v1a5 5 0 0 1-9 3h-2a5 5 0 0 1-9-3v-1a6 6 0 0 1 6-6Z"/><path d="M8 9.5v5M5.5 12h5"/><circle cx="16" cy="11" r=".6"/><circle cx="18" cy="13.5" r=".6"/>',
    corazon: '<path d="M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20Z"/>',
    palmera: '<path d="M12 22V11"/><path d="M12 11c-1-3-4-4-7-3 2-3 6-3 7 0 0-3 3-5 7-4-3 0-5 2-5 4 3-1 6 1 6 4-2-2-5-2-8-1Z"/><path d="M7 22h10"/>',
    calavera: '<path d="M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3Z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M11 15h2M10 20v-2M14 20v-2"/>',
    espada: '<path d="M14.5 3H21v6.5L10 20.5 3.5 14Z"/><path d="m7 17-3 3M5 13l6 6"/>',
    fuego: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 2-5 5-5 8a7 7 0 0 0 7 7Z"/><path d="M12 22a3 3 0 0 1-3-3c0-2 2-3 3-5 1 2 3 3 3 5a3 3 0 0 1-3 3Z"/>',
    rayo: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
    musica: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    cohete: '<path d="M12 2c3 2 5 6 5 10l-2 5H9l-2-5c0-4 2-8 5-10Z"/><circle cx="12" cy="10" r="2"/><path d="M9 17l-3 3 1-5M15 17l3 3-1-5"/>',
    fantasma: '<path d="M5 21V11a7 7 0 0 1 14 0v10l-2.5-2-2.5 2-2-2-2 2-2.5-2Z"/><circle cx="9.5" cy="11" r=".9"/><circle cx="14.5" cy="11" r=".9"/>',
    luna: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    balon: '<circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10Z"/><path d="M12 3v4M16 10l4.5-1.5M14.5 14.5l2.5 4M9.5 14.5l-2.5 4M8 10 3.5 8.5"/>',
    diamante: '<path d="M6 3h12l4 6-10 12L2 9Z"/><path d="M2 9h20M9 3 7.5 9 12 21l4.5-12L15 3"/>',
    ojo: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    pincel: '<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12Z"/><path d="M9 12.5c-2.5 0-4 1.5-4 4 0 1.5-1 2.5-2.5 3 3.5 1.5 8.5 1 9-3.5"/>',
    gato: '<path d="M4 4l4 4h8l4-4v9a8 8 0 0 1-16 0Z"/><circle cx="9" cy="13" r=".9"/><circle cx="15" cy="13" r=".9"/><path d="M11 16h2l-1 1Z"/>',
    flor: '<circle cx="12" cy="9" r="2.5"/><path d="M12 6.5C12 3 9 2.5 8.5 5S10 8.5 12 6.5ZM12 6.5C12 3 15 2.5 15.5 5S14 8.5 12 6.5ZM9.5 9c-3.5 0-4 3-1.5 3.5S11.5 11 9.5 9ZM14.5 9c3.5 0 4 3 1.5 3.5S12.5 11 14.5 9Z"/><path d="M12 11.5V22M12 18c-2-2-4-2-5-1M12 16c2-2 4-2 5-1"/>',
    auto: '<path d="M3 16v-4l2-5h11l3 5h2v4Z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 12h14"/>',
    lienzo: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
  };
  // Ícono de cada categoría de fábrica (sin ícono elegido en el panel)
  const POR_CATEGORIA = { todas: "camiseta", pop: "estrella", urbana: "corona", gamer: "control", anime: "corazon", verano: "palmera" };
  const nombres = {
    camiseta: "Camiseta", estrella: "Estrella", corona: "Corona", control: "Control", corazon: "Corazón", palmera: "Palmera",
    calavera: "Calavera", espada: "Espada", fuego: "Fuego", rayo: "Rayo", musica: "Música", cohete: "Cohete", fantasma: "Fantasma",
    luna: "Luna", sol: "Sol", balon: "Balón", diamante: "Diamante", ojo: "Ojo", pincel: "Pincel", gato: "Gato", flor: "Flor",
    auto: "Auto", lienzo: "Cuadro",
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // icono: clave de la galería o un emoji; id: categoría (para el de fábrica)
  function svg(icono, id) {
    const k = L[icono] ? icono : icono ? "" : POR_CATEGORIA[id] || "lienzo";
    if (!k) return `<span class="emo" aria-hidden="true">${esc(icono)}</span>`;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${L[k]}</svg>`;
  }
  return { lista: L, nombres, porCategoria: POR_CATEGORIA, svg };
})();

// ============================================================
// Marketing / Medición — Google Analytics 4 + Meta (Facebook) Pixel
// ============================================================
// PEGÁ TUS IDS ACÁ ABAJO. Mientras estén vacíos, el sitio funciona igual
// y no se carga ningún script de terceros (cero impacto, cero errores).
//
//   GA4_ID       → tu ID de medición de Google Analytics 4 (formato G-XXXXXXX)
//                  Lo sacás en analytics.google.com → Administrar → Flujos de
//                  datos → tu web → "ID de medición".
//
//   META_PIXEL_ID → el ID numérico de tu píxel de Meta.
//                  Lo sacás en business.facebook.com → Administrador de
//                  eventos → tu píxel → el número largo arriba.
//
// Este archivo se sirve desde el propio dominio, por eso la Content-Security
// -Policy puede seguir bloqueando scripts inline (más seguro). Los dominios
// de Google y Meta están habilitados en vercel.json.
// ============================================================
(function () {
  var GA4_ID = "G-G5P9Y5XPNN";
  var META_PIXEL_ID = "";  // ej: "123456789012345"

  // ---- Google Analytics 4 ----
  if (GA4_ID) {
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA4_ID);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA4_ID);
  }

  // ---- Meta (Facebook) Pixel ----
  if (META_PIXEL_ID) {
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0";
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", META_PIXEL_ID);
    window.fbq("track", "PageView");
  }

  // ---- API unificada para el resto del sitio (app.js) ----
  // rmTrack(nombreGenérico, params) dispara el evento equivalente en GA4 y
  // en Meta Pixel si están configurados. Si no hay IDs, no hace nada.
  var META_EVENT = {
    view_item: "ViewContent",
    add_to_cart: "AddToCart",
    begin_checkout: "InitiateCheckout",
    generate_lead: "Lead",
  };
  window.rmTrack = function (name, params) {
    params = params || {};
    try { if (window.gtag) window.gtag("event", name, params); } catch (e) {}
    try {
      if (window.fbq) {
        var fbName = META_EVENT[name];
        var fbParams = {};
        if (params.value != null) fbParams.value = params.value;
        if (params.currency) fbParams.currency = params.currency;
        if (params.items && params.items.length) {
          fbParams.content_ids = params.items.map(function (i) { return i.item_id || i.id; });
          fbParams.content_type = "product";
        }
        if (fbName) window.fbq("track", fbName, fbParams);
      }
    } catch (e) {}
  };
})();

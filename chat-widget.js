// Asistente virtual "Midas" — widget de chat en la esquina del sitio.
// Vanilla JS, sin dependencias. Compatible con la CSP (archivo externo,
// nada inline). Habla solo con /api/chat (mismo origen).
(function () {
  "use strict";

  var STORAGE_KEY = "rmd_chat_history_v1";
  var OPEN_KEY = "rmd_chat_open";
  var MAX_HISTORY = 30;
  // La función de Vercel tiene 30s de tope; damos margen para la respuesta.
  var REQUEST_TIMEOUT_MS = 40000;
  var WA_FALLBACK =
    "https://wa.me/50661468733?text=" +
    encodeURIComponent("Hola, quiero hacer una consulta.");
  var ERROR_TEXT =
    "Uy, no pude responder ahora 😅. Probá de nuevo o escribinos por WhatsApp y te atendemos de una.";

  // Historial en memoria: [{role:'user'|'assistant', content, whatsapp?}]
  var history = [];
  var sending = false;
  var els = {};

  // ---------- utilidades ----------
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  // Escapa y aplica formato mínimo: **negrita** y saltos de línea.
  function format(text) {
    var safe = esc(text);
    safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/\n/g, "<br>");
    return safe;
  }
  function saveHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch (e) { /* ignore */ }
  }
  // Errores guardados por versiones anteriores del widget: si siguen en el
  // historial de la pestaña, se le reenvían al modelo como si fueran respuestas
  // suyas. Se limpian al cargar.
  var STALE_ERROR = /^(uy, (no pude responder|se me trabó)|se me cayó la conexión)/i;

  function loadHistory() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          history = arr.filter(function (m) {
            return !(m && m.role === "assistant" && STALE_ERROR.test(String(m.content || "")));
          });
        }
      }
    } catch (e) { history = []; }
  }

  // ---------- render ----------
  function scrollDown() {
    if (els.messages) els.messages.scrollTop = els.messages.scrollHeight;
  }

  function appendMessage(role, content, whatsapp) {
    var row = document.createElement("div");
    row.className = "rmd-chat-msg rmd-chat-msg--" + (role === "user" ? "user" : "bot");

    var bubble = document.createElement("div");
    bubble.className = "rmd-chat-bubble";
    bubble.innerHTML = format(content);
    row.appendChild(bubble);

    if (whatsapp) {
      var a = document.createElement("a");
      a.className = "rmd-chat-wa";
      a.href = whatsapp;
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.1-.6.2s-.7.9-.9 1.1c-.2.2-.3.2-.6 0-1.7-.8-2.8-1.5-3.9-3.4-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5s-.6-1.5-.9-2c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.9.9-1.1 2-1.1 2.2s.9 2.6 2.5 4.1c2.3 2.2 3.9 2.4 4.6 2.5.7.1 1.3-.1 1.6-.5.3-.4.9-1.1 1-1.4.1-.3-.1-.4-.4-.5z"/><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.4 1.3 4.9L2 22l5.3-1.3c1.4.8 3 1.2 4.7 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18c-1.5 0-3-.4-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3C4.4 15 4 13.5 4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8z"/></svg>' +
        "Seguir por WhatsApp";
      row.appendChild(a);
    }

    els.messages.appendChild(row);
    scrollDown();
    return row;
  }

  // Los errores se muestran, pero NO entran al historial: si se guardaran, el
  // modelo leería sus propias disculpas como contexto en cada consulta
  // siguiente y el cliente se las encontraría de nuevo al recargar la página.
  function clearError() {
    var old = document.getElementById("rmdChatError");
    if (old) old.remove();
  }

  function showError(text, wa) {
    clearError();
    var row = appendMessage("assistant", text || ERROR_TEXT, wa || WA_FALLBACK);
    row.id = "rmdChatError";

    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "rmd-chat-chip";
    retry.textContent = "Reintentar";
    retry.addEventListener("click", function () {
      clearError();
      requestReply();
    });
    var wrap = document.createElement("div");
    wrap.className = "rmd-chat-chips";
    wrap.appendChild(retry);
    row.appendChild(wrap);
    scrollDown();
  }

  function showTyping() {
    var row = document.createElement("div");
    row.className = "rmd-chat-msg rmd-chat-msg--bot";
    row.id = "rmdChatTyping";
    row.innerHTML =
      '<div class="rmd-chat-bubble rmd-chat-typing"><span></span><span></span><span></span></div>';
    els.messages.appendChild(row);
    scrollDown();
  }
  function hideTyping() {
    var t = document.getElementById("rmdChatTyping");
    if (t) t.remove();
  }

  function renderQuickReplies() {
    if (history.length > 0) return; // solo al inicio
    var chips = [
      "¿Qué juego me recomendás?",
      "Diferencia entre Principal y Secundaria",
      "¿Cómo funciona Nintendo Switch?",
      "¿Cómo pago y cuánto tarda?",
    ];
    var wrap = document.createElement("div");
    wrap.className = "rmd-chat-chips";
    wrap.id = "rmdChatChips";
    chips.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "rmd-chat-chip";
      b.textContent = c;
      b.addEventListener("click", function () {
        sendMessage(c);
      });
      wrap.appendChild(b);
    });
    els.messages.appendChild(wrap);
    scrollDown();
  }

  function renderAll() {
    els.messages.innerHTML = "";
    if (history.length === 0) {
      appendMessage(
        "assistant",
        "¡Hola! 👑 Soy **Midas**, tu asistente de Rey Midas Digitales. Contame qué buscás y te ayudo a encontrar tu juego, o resolvé cualquier duda. ¡Estoy disponible 24/7!",
        null
      );
      renderQuickReplies();
    } else {
      history.forEach(function (m) {
        appendMessage(m.role, m.content, m.whatsapp);
      });
    }
  }

  // ---------- envío ----------
  function setSending(on) {
    sending = on;
    els.send.disabled = on;
    if (!on) els.input.focus();
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // POST a /api/chat con timeout. Marca como .retryable lo que puede salir bien
  // en un segundo intento (red caída, 5xx, respuesta ilegible).
  function postChat(payload) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl
      ? setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS)
      : null;
    var opts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    };
    if (ctrl) opts.signal = ctrl.signal;

    return fetch("/api/chat", opts).then(
      function (r) {
        if (timer) clearTimeout(timer);
        if (r.status >= 500) {
          var e = new Error("HTTP " + r.status);
          e.retryable = true;
          throw e;
        }
        return r.json().catch(function () {
          var e2 = new Error("respuesta ilegible");
          e2.retryable = true;
          throw e2;
        });
      },
      function (err) {
        // fetch rechaza por red caída o por el abort del timeout: los dos casos
        // valen un reintento.
        if (timer) clearTimeout(timer);
        var e = err || new Error("fallo de red");
        e.retryable = true;
        throw e;
      }
    );
  }

  // Pide la respuesta al último turno del cliente. Es su propia función para
  // que el botón "Reintentar" reenvíe el mismo historial sin duplicar mensajes.
  function requestReply() {
    if (sending) return;
    var last = history[history.length - 1];
    if (!last || last.role !== "user") return;

    setSending(true);
    clearError();
    showTyping();

    var payload = {
      messages: history.map(function (m) { return { role: m.role, content: m.content }; }),
    };

    postChat(payload)
      .catch(function (err) {
        if (!err || !err.retryable) throw err;
        return wait(900).then(function () { return postChat(payload); });
      })
      .then(function (data) {
        hideTyping();
        var reply = data && data.reply;
        var wa = (data && data.whatsapp) || null;
        if (!reply) throw new Error("sin respuesta");
        // El servidor contestó, pero el modelo falló: es un error, no una
        // respuesta del asistente, así que no se guarda como tal.
        if (data.error) { showError(reply, wa); return; }
        history.push({ role: "assistant", content: reply, whatsapp: wa });
        appendMessage("assistant", reply, wa);
        saveHistory();
      })
      .catch(function () {
        hideTyping();
        showError(ERROR_TEXT, WA_FALLBACK);
      })
      .then(function () { setSending(false); });
  }

  function sendMessage(text) {
    text = (text || "").trim();
    if (!text || sending) return;

    // Las sugerencias del saludo son para arrancar: una vez que el cliente
    // escribió, estorban arriba de la conversación.
    var chips = document.getElementById("rmdChatChips");
    if (chips) chips.remove();

    els.input.value = "";
    autoGrow();
    history.push({ role: "user", content: text });
    appendMessage("user", text, null);
    saveHistory();
    requestReply();
  }

  // ---------- UI ----------
  function autoGrow() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 110) + "px";
  }

  function openPanel() {
    els.panel.classList.add("rmd-chat-open");
    els.launcher.classList.add("rmd-chat-launcher--hidden");
    els.launcher.setAttribute("aria-expanded", "true");
    try { sessionStorage.setItem(OPEN_KEY, "1"); } catch (e) {}
    document.body.classList.add("rmd-chat-body-open");
    setTimeout(function () { els.input.focus(); }, 120);
    scrollDown();
  }
  function closePanel() {
    els.panel.classList.remove("rmd-chat-open");
    els.launcher.classList.remove("rmd-chat-launcher--hidden");
    els.launcher.setAttribute("aria-expanded", "false");
    try { sessionStorage.setItem(OPEN_KEY, "0"); } catch (e) {}
    document.body.classList.remove("rmd-chat-body-open");
  }

  function build() {
    // Lanzador
    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "rmd-chat-launcher";
    launcher.setAttribute("aria-label", "Abrir asistente virtual");
    launcher.setAttribute("aria-expanded", "false");
    launcher.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.9 2 11.7c0 2.3 1 4.4 2.8 5.9-.1 1-.6 2.3-1.6 3.4-.2.2 0 .6.3.5 1.9-.4 3.3-1.1 4.2-1.7 1.3.4 2.7.6 4.3.6 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/><circle cx="8.5" cy="11.7" r="1.2" fill="#1a1a10"/><circle cx="12" cy="11.7" r="1.2" fill="#1a1a10"/><circle cx="15.5" cy="11.7" r="1.2" fill="#1a1a10"/></svg>' +
      '<span class="rmd-chat-launcher-badge">Asistente</span>';
    launcher.addEventListener("click", openPanel);

    // Panel
    var panel = document.createElement("div");
    panel.className = "rmd-chat-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Asistente virtual de Rey Midas");
    panel.innerHTML =
      '<div class="rmd-chat-header">' +
        '<div class="rmd-chat-header-info">' +
          '<div class="rmd-chat-avatar" aria-hidden="true">👑</div>' +
          '<div>' +
            '<div class="rmd-chat-title">Midas · Asistente</div>' +
            '<div class="rmd-chat-status"><span class="rmd-chat-dot"></span>En línea 24/7</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="rmd-chat-close" aria-label="Cerrar">&times;</button>' +
      '</div>' +
      '<div class="rmd-chat-messages" id="rmdChatMessages"></div>' +
      '<form class="rmd-chat-form" id="rmdChatForm">' +
        '<textarea class="rmd-chat-input" id="rmdChatInput" rows="1" placeholder="Escribí tu mensaje…" ' +
          'autocomplete="off" maxlength="1000"></textarea>' +
        '<button type="submit" class="rmd-chat-send" id="rmdChatSend" aria-label="Enviar">' +
          '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4l17.5-7.5c.8-.4.8-1.6 0-2L3.4 3.6c-.7-.3-1.5.2-1.4 1l1 6.4 11 1.9-11 1.9-1 6.4c-.1.9.7 1.4 1.4 1.2z"/></svg>' +
        '</button>' +
      '</form>' +
      '<div class="rmd-chat-legal">Respuestas generadas por IA. Para cerrar tu compra te pasamos a WhatsApp.</div>';

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    els.launcher = launcher;
    els.panel = panel;
    els.messages = panel.querySelector("#rmdChatMessages");
    els.input = panel.querySelector("#rmdChatInput");
    els.send = panel.querySelector("#rmdChatSend");
    els.form = panel.querySelector("#rmdChatForm");

    panel.querySelector(".rmd-chat-close").addEventListener("click", closePanel);
    els.form.addEventListener("submit", function (e) {
      e.preventDefault();
      sendMessage(els.input.value);
    });
    els.input.addEventListener("input", autoGrow);
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(els.input.value);
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("rmd-chat-open")) closePanel();
    });

    loadHistory();
    renderAll();

    try {
      if (sessionStorage.getItem(OPEN_KEY) === "1") openPanel();
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();

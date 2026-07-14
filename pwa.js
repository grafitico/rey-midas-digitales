/* Rey Midas Digitales — Registro PWA + botón de instalación
 * Sin dependencias. Se carga con defer; el CSP permite scripts 'self'.
 */
(function () {
  'use strict';

  /* ---------- 1. Registro del Service Worker ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      // Si ya había un controlador al cargar, un cambio posterior = actualización
      // (hay que recargar). En la PRIMERA visita el claim() inicial no debe recargar.
      var hadController = !!navigator.serviceWorker.controller;
      var refreshing = false;

      navigator.serviceWorker
        .register('/service-worker.js')
        .then(function (reg) {
          // Detecta un SW nuevo esperando y ofrece recargar.
          reg.addEventListener('updatefound', function () {
            var nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', function () {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateToast(reg);
              }
            });
          });
        })
        .catch(function () {
          /* Sin SW la web sigue funcionando igual; no rompemos nada. */
        });

      // Cuando el SW nuevo toma control tras una actualización, recargamos una vez.
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController) return; // primera instalación: no recargar
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  function showUpdateToast(reg) {
    if (document.getElementById('pwaUpdateToast')) return;
    var t = document.createElement('div');
    t.id = 'pwaUpdateToast';
    t.className = 'pwa-toast';
    t.innerHTML =
      '<span>Hay una versión nueva disponible.</span>' +
      '<button type="button" class="pwa-toast-btn">Actualizar</button>';
    t.querySelector('button').addEventListener('click', function () {
      if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
      t.remove();
    });
    document.body.appendChild(t);
  }

  /* ---------- 2. Botón de instalación (Android / escritorio) ---------- */
  var deferredPrompt = null;
  var DISMISS_KEY = 'rmd_pwa_install_dismissed';

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!isStandalone() && localStorage.getItem(DISMISS_KEY) !== '1') {
      renderInstallButton();
    }
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    removeInstallButton();
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch (e) {}
  });

  function renderInstallButton() {
    if (document.getElementById('pwaInstallBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'pwaInstallBtn';
    btn.type = 'button';
    btn.className = 'pwa-install-btn';
    btn.setAttribute('aria-label', 'Instalar la app de Rey Midas');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      '<span>Instalar app</span>' +
      '<span class="pwa-install-close" aria-label="Cerrar">&times;</span>';

    btn.addEventListener('click', function (ev) {
      // La "x" solo descarta, no instala.
      if (ev.target.classList && ev.target.classList.contains('pwa-install-close')) {
        ev.stopPropagation();
        try {
          localStorage.setItem(DISMISS_KEY, '1');
        } catch (e) {}
        removeInstallButton();
        return;
      }
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        removeInstallButton();
      });
    });

    document.body.appendChild(btn);
  }

  function removeInstallButton() {
    var b = document.getElementById('pwaInstallBtn');
    if (b) b.remove();
  }

  /* ---------- 3. Pista para iPhone/iPad (Safari no dispara el evento) ---------- */
  function isIosSafari() {
    var ua = window.navigator.userAgent;
    var iOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var webkit = /WebKit/.test(ua);
    var notOtherBrowser = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return iOS && webkit && notOtherBrowser;
  }

  window.addEventListener('load', function () {
    if (
      isIosSafari() &&
      !isStandalone() &&
      localStorage.getItem(DISMISS_KEY) !== '1'
    ) {
      var hint = document.createElement('div');
      hint.id = 'pwaIosHint';
      hint.className = 'pwa-ios-hint';
      hint.innerHTML =
        '<span>Instalá la app: tocá ' +
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>' +
        ' y luego <strong>Agregar a inicio</strong>.</span>' +
        '<button type="button" class="pwa-ios-close" aria-label="Cerrar">&times;</button>';
      hint.querySelector('.pwa-ios-close').addEventListener('click', function () {
        try {
          localStorage.setItem(DISMISS_KEY, '1');
        } catch (e) {}
        hint.remove();
      });
      document.body.appendChild(hint);
    }
  });
})();

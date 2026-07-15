/* Rey Midas Digitales — Service Worker
 * Estrategia por tipo de recurso:
 *  - Navegación (HTML/SPA):     network-first → cae al shell cacheado (offline)
 *  - CSS / JS / fuentes:        stale-while-revalidate (versionados con ?v=)
 *  - Imágenes:                  stale-while-revalidate
 *  - JSON (catálogos/precios):  network-first (siempre lo más fresco) → cae a caché
 *  - /api/*:                    sin cachear (dinámico)
 *  - Video (.mp4) / range:      sin interceptar (streaming con Range)
 */

const CACHE_VERSION = 'v1-20260715';
const SHELL_CACHE = `rmd-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `rmd-runtime-${CACHE_VERSION}`;

// Mínimo imprescindible para arrancar y funcionar offline.
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/logo.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // addAll falla completo si un recurso 404; los añadimos best-effort.
      Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Permite al frontend forzar la actualización del SW nuevo.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isNavigationRequest(request) {
  return (
    request.mode === 'navigate' ||
    (request.method === 'GET' &&
      request.headers.get('accept')?.includes('text/html'))
  );
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.status === 200) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.status === 200) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo GET del mismo origen; el resto (POST, YouTube, etc.) pasa directo.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API dinámica y video con Range: sin interceptar.
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.endsWith('.mp4') || request.headers.has('range')) return;

  // Navegación SPA → network-first con caída al shell.
  if (isNavigationRequest(request)) {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(
        async () =>
          (await caches.match('/index.html')) ||
          (await caches.match('/'))
      )
    );
    return;
  }

  // Catálogos y datos: siempre lo más fresco posible.
  if (url.pathname.endsWith('.json') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  // Estáticos (CSS/JS versionados, imágenes, fuentes): SWR.
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

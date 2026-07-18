const CACHE_NAME = 'finance-rpg-v59';
const APP_SHELL = [
  './',
  './index.html',
  './style.css?v=59',
  './vault.js?v=59',
  './gameplay.js?v=59',
  './cashflow.js?v=59',
  './ledger.js?v=59',
  './advisor.js?v=59',
  './app.js?v=59',
  './manifest.webmanifest',
  './assets/bg.png',
  './assets/camp-dawn-v2.png',
  './assets/boss.png',
  './assets/hero.png',
  './assets/hero-female.png',
  './assets/strategist.png',
  './assets/coin.png',
  './assets/flame.png',
  './assets/shield.png',
  './assets/chest-closed.png',
  './assets/chest-open.png',
  './assets/ui-panel.png',
  './assets/ui-btn.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('finance-rpg-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', response.clone()));
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./')))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});

const CACHE_NAME = 'finance-rpg-v65';
const CORE_SHELL = [
  './',
  './index.html',
  './style.css?v=65',
  './vault.js?v=65',
  './gameplay.js?v=65',
  './cashflow.js?v=65',
  './ledger.js?v=65',
  './advisor.js?v=65',
  './app.js?v=65',
  './manifest.webmanifest',
  './assets/camp-dawn-v2.png',
  './assets/hero.png',
  './assets/hero-female.png',
  './assets/strategist.png',
];
const OPTIONAL_ASSETS = [
  './assets/bg.png',
  './assets/boss.png',
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
      .then(async (cache) => {
        await cache.addAll(CORE_SHELL);
        await Promise.allSettled(OPTIONAL_ASSETS.map((asset) => cache.add(asset)));
      })
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
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put('./index.html', response.clone());
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./')))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    })
  );
});

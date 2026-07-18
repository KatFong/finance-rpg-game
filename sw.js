const CACHE_NAME = 'finance-rpg-v13';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './advisor.js',
  './app.js',
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});

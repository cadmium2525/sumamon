const CACHE_NAME = 'smamon-app-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/camera.js',
  './js/config.js',
  './js/cpu-ai.js',
  './js/fighter.js',
  './js/fighters-data.js',
  './js/firebase-init.js',
  './js/flow.js',
  './js/game.js',
  './js/growth-system.js',
  './js/input.js',
  './js/moves.js',
  './js/physics.js',
  './js/pwa.js',
  './js/stage.js',
  './assets/images/app-icon.png',
  './assets/images/home.png',
  './assets/images/logo.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('smamon-app-') && key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // ページ遷移はネットワークを優先し、オフライン時はキャッシュしたホームへ戻す。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // コードと画像はキャッシュを優先し、更新取得に成功した場合は次回用に保存する。
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});

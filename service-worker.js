const CACHE_NAME = 'smamon-app-v48';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/camera.js',
  './js/audio.js',
  './js/config.js',
  './js/cpu-ai.js',
  './js/debug-mode.js',
  './js/fighter.js',
  './js/fighters-data.js',
  './js/fighters/irumine-moves.js',
  './js/fighters/dullahan-moves.js',
  './js/firebase-init.js',
  './js/flow.js',
  './js/game.js',
  './js/growth-system.js',
  './js/input.js',
  './js/moves.js',
  './js/multiplayer.js',
  './js/physics.js',
  './js/pwa.js',
  './js/stage.js',
  './assets/images/app-icon.png',
  './assets/images/home.png',
  './assets/images/logo.png',
  './assets/images/stage-select-background.png',
  './assets/images/masmon-manage-background.png',
  './assets/images/training-background.png',
  './assets/images/fighter-select-background.png',
  './assets/images/ui/training-ticket.png',
  './assets/images/ui/practice-ticket.png',
  './assets/images/items/potion-a-large.png',
  './assets/images/items/potion-a-small.png',
  './assets/images/items/potion-b-large.png',
  './assets/images/items/potion-b-small.png',
  './assets/images/items/potion-c-large.png',
  './assets/images/items/potion-c-small.png',
  './assets/images/items/dye-kit.png',
  './assets/images/field/cosmo/background.png',
  './assets/images/field/cosmo/platform.png',
  './assets/images/fighter/irumine/jump/frame_001.png',
  './assets/images/fighter/irumine/jump/frame_002.png',
  './assets/images/fighter/irumine/jump/frame_003.png',
  './assets/images/fighter/irumine/jump/air_idle.png',
  './assets/images/fighter/irumine/projectiles/arrow.png',
  './assets/images/fighter/irumine/projectiles/bomb.png',
  './assets/images/fighter/irumine/down_special/frame_001.png',
  './assets/images/fighter/irumine/down_special/frame_002.png',
  './assets/images/fighter/irumine/down_special/frame_003.png',
  './assets/images/fighter/irumine/down_special/frame_004.png',
  './assets/images/battle/gong3.png',
  './assets/images/battle/gong2.png',
  './assets/images/battle/gong1.png',
  './assets/images/battle/gong.png',
  './assets/audio/home.mp3',
  './assets/audio/battlemode.mp3',
  './assets/audio/arrow.mp3',
  './assets/audio/bomb.mp3'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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

  // 現在のバージョンを維持し、更新許可後の再読み込みで新キャッシュへ切り替える。
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(cached => cached || fetch(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});

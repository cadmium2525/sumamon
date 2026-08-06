const CACHE_NAME = 'smamon-app-v83';
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
  './js/practice.js',
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
  './assets/images/fighter/irumine/neutral_attack/frame_001.png',
  './assets/images/fighter/irumine/neutral_attack/frame_002.png',
  './assets/images/fighter/irumine/neutral_attack/frame_003.png',
  './assets/images/fighter/irumine/neutral_attack/frame_004.png',
  './assets/images/fighter/irumine/side_special/frame_001.png',
  './assets/images/fighter/irumine/side_special/frame_002.png',
  './assets/images/fighter/irumine/side_special/frame_003.png',
  './assets/images/fighter/irumine/side_special/frame_004.png',
  './assets/images/fighter/irumine/side_special/frame_005.png',
  './assets/images/fighter/irumine/neutral_special/frame_001.png',
  './assets/images/fighter/irumine/neutral_special/frame_002.png',
  './assets/images/fighter/irumine/neutral_special/frame_003.png',
  './assets/images/fighter/irumine/neutral_special/frame_004.png',
  './assets/images/fighter/irumine/neutral_special/frame_005.png',
  './assets/images/fighter/irumine/neutral_special/frame_006.png',
  './assets/images/battle/gong3.png',
  './assets/images/battle/gong2.png',
  './assets/images/battle/gong1.png',
  './assets/images/battle/gong.png',
  './assets/audio/home.mp3',
  './assets/audio/battlemode.mp3',
  './assets/audio/Pain%20the%20Universe.mp3',
  './assets/audio/arrow.mp3',
  './assets/audio/bomb.mp3'
];

async function cacheFreshAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(APP_SHELL.map(async url => {
    const request = new Request(url, { cache: 'reload' });
    const response = await fetch(request);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    await cache.put(request, response);
  }));

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn('キャッシュできなかったファイル:', APP_SHELL[index], result.reason);
    }
  });

  // 中核ファイル（HTML/CSS/JS）は1つでも取得できなければ不完全な更新を有効化しない。
  // (画像・音声などのアセットは失敗しても致命的ではないため対象外)
  const criticalAssets = APP_SHELL.filter(url => /\.(html|css|js)$/.test(url) || url === './');
  const missing = [];
  for (const url of criticalAssets) {
    if (!await cache.match(url)) missing.push(url);
  }
  if (missing.length) {
    throw new Error(`中核ファイルをキャッシュできませんでした: ${missing.join(', ')}`);
  }
}

self.addEventListener('install', event => {
  event.waitUntil(cacheFreshAppShell());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // このPWAはorigin内にキャッシュを1つしか使わない設計のため、
    // 現行バージョン以外のキャッシュ（命名規則が古い過去のものも含む）はすべて削除する。
    await Promise.all(
      keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // バージョン情報はキャッシュせず、常に公開中の最新版を取得する。
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then(cache => cache.match('./index.html'))
        .then(cached => cached || fetch(new Request(request, { cache: 'reload' })))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME)
      .then(cache => cache.match(request, { ignoreSearch: true }))
      .then(cached => cached || fetch(new Request(request, { cache: 'reload' })).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }))
  );
});

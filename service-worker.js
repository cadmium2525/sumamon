const CACHE_NAME = 'smamon-app-v114';
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
  './data/fighters.json',
  './data/movesets.json',
  './js/firebase-init.js',
  './js/flow.js',
  './js/game.js',
  './js/growth-system.js',
  './js/input.js',
  './js/moves.js',
  './js/multiplayer.js',
  './js/physics.js',
  './js/procedural-motion.js',
  './js/skin.js',
  './js/skin-editor.js',
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
  './assets/images/fighter/irumine/idle/frame_001.png',
  './assets/images/fighter/irumine/idle/frame_002.png',
  './assets/images/fighter/irumine/idle/frame_003.png',
  './assets/images/fighter/irumine/idle/frame_004.png',
  './assets/images/fighter/irumine/stock.png',
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
  './assets/audio/bomb.mp3',
  './assets/images/fighter/irumine/ledge/frame_001.png',
  './assets/images/fighter/irumine/ledge/frame_002.png',
  './assets/images/fighter/irumine/ledge/frame_003.png',
  './assets/images/fighter/irumine/ledge/frame_004.png',
  './assets/images/fighter/irumine/ledge/frame_005.png',
  './assets/images/fighter/irumine/ledge/frame_006.png'
];

// 中核ファイル（HTML/CSS/JS/JSON）と、あとから取れば足りるメディアを分ける。
// APP_SHELL全体は60MBを超えるため、全部そろうまで待つと更新の用意に数分かかり、
// 「起動したのに更新が終わらない」状態になっていた。
function isCoreAsset(url) {
  return /\.(html|css|js|json|webmanifest)$/.test(url) || url === './';
}

// 取得は 'reload'（必ず全部ダウンロード）ではなく 'no-cache'（必ず問い合わせるが
// 変わっていなければ本文を送り直さない）にする。
// 変更のないファイルは304で済むため、更新のたびに全アセットを取り直さずに済む。
async function cacheAsset(cache, url) {
  const request = new Request(url, { cache: 'no-cache' });
  const response = await fetch(request);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await cache.put(request, response);
}

async function cacheFreshAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const core = APP_SHELL.filter(isCoreAsset);
  const media = APP_SHELL.filter(url => !isCoreAsset(url));

  // 中核ファイルだけは確実にそろえる。1つでも欠けたら不完全な更新を有効化しない。
  const results = await Promise.allSettled(core.map(url => cacheAsset(cache, url)));
  const missing = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn('キャッシュできなかったファイル:', core[index], result.reason);
      missing.push(core[index]);
    }
  });
  if (missing.length) {
    throw new Error(`中核ファイルをキャッシュできませんでした: ${missing.join(', ')}`);
  }

  // 画像・音声は待たずに裏で取る。ここで返してしまうと install が
  // それらの完了まで待ってしまうため、意図的に投げっぱなしにする。
  // 取り切れなくても、実際に使う時に fetch ハンドラ側でキャッシュされる。
  Promise.allSettled(media.map(url => cacheAsset(cache, url).catch(error => {
    console.warn('あとで取り直します:', url, error);
  })));
}

self.addEventListener('install', event => {
  // 中核ファイルがそろった時点でインストール完了とする（メディアは裏で続く）
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

  // ファイター/技データはツールから更新されるため、常に最新を取りに行く（オフライン時のみキャッシュ）。
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-store' }))
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.open(CACHE_NAME).then(cache => cache.match(request, { ignoreSearch: true })))
    );
    return;
  }

  // 制作ツール(tools/)はキャッシュしない。古い版を掴むとコミット処理が食い違うため。
  if (url.pathname.includes('/tools/')) {
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

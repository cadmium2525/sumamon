const CACHE_NAME = 'smamon-app-v153';
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
  './js/rank-battle.js',
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
  './assets/images/home.webp',
  './assets/images/logo.webp',
  './assets/images/stage-select-background.webp',
  './assets/images/masmon-manage-background.webp',
  './assets/images/ui/menu-training.webp',
  './assets/images/ui/menu-practice.webp',
  './assets/images/ui/menu-skin.webp',
  './assets/images/ui/menu-back.webp',
  './assets/images/item-shop-background.webp',
  './assets/images/training-background.webp',
  './assets/images/practice-map.webp',
  './assets/images/fighter-select-background.webp',
  './assets/images/ui/training-ticket.webp',
  './assets/images/ui/practice-ticket.webp',
  './assets/images/items/potion-a-large.webp',
  './assets/images/items/potion-a-small.webp',
  './assets/images/items/potion-b-large.webp',
  './assets/images/items/potion-b-small.webp',
  './assets/images/items/potion-c-large.webp',
  './assets/images/items/potion-c-small.webp',
  './assets/images/items/dye-kit.webp',
  './assets/images/field/cosmo/background.webp',
  './assets/images/field/cosmo/platform.webp',
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
  './assets/images/battle/gong3.webp',
  './assets/images/battle/gong2.webp',
  './assets/images/battle/gong1.webp',
  './assets/images/battle/gong.webp',
  './assets/audio/home.mp3',
  './assets/audio/hometowndomina.mp3',
  './assets/audio/kokoroarubasho.mp3',
  './assets/audio/battlemode.mp3',
  './assets/audio/Pain%20the%20Universe.mp3',
  './assets/audio/arrow.mp3',
  './assets/audio/bomb.mp3',
  './assets/images/fighter/irumine/ledge/frame_001.png',
  './assets/images/fighter/irumine/ledge/frame_002.png',
  './assets/images/fighter/irumine/ledge/frame_003.png',
  './assets/images/fighter/irumine/ledge/frame_004.png',
  './assets/images/fighter/irumine/ledge/frame_005.png',
  './assets/images/fighter/irumine/ledge/frame_006.png',
  './assets/images/fighter/irumine/crouch/frame_001.png',
  './assets/images/fighter/irumine/crouch/frame_002.png',
  './assets/images/fighter/irumine/crouch/frame_003.png',
  './assets/images/fighter/irumine/crouch/frame_004.png',
  './assets/images/fighter/irumine/crouch/frame_005.png',
  './assets/images/fighter/irumine/crouch/frame_006.png',
  './assets/images/fighter/irumine/crouch/frame_007.png',
  './assets/images/fighter/irumine/crouch/frame_008.png',
  './assets/images/fighter/nendoro/idle/frame_001.png',
  './assets/images/fighter/nendoro/idle/frame_002.png',
  './assets/images/fighter/nendoro/idle/frame_003.png',
  './assets/images/fighter/nendoro/idle/frame_004.png',
  './assets/images/fighter/nendoro/idle/frame_005.png',
  './assets/images/fighter/nendoro/idle/frame_006.png',
  './assets/images/fighter/nendoro/idle/frame_007.png',
  './assets/images/fighter/nendoro/idle/frame_008.png',
  './assets/images/fighter/nendoro/stock.png'
];

// 中核ファイル（HTML/CSS/JS/JSON）と、あとから取れば足りるメディアを分ける。
// 全部そろうまで待つと更新の用意に数分かかり、
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

// 「変わっていないか」の問い合わせを、自分で作った条件付きリクエストで行う。
//
// 'no-cache' 指定はブラウザ側のキャッシュに控えが残っている時しか条件付きにならず、
// 控えが捨てられていると結局まるごとダウンロードになる。ブラウザのキャッシュは
// いつ捨てられるか分からないので、更新のたびに全部落とし直す危険が残る。
// こちらのキャッシュに入っている応答からETag（無ければ更新日時）を取り出して
// 自分で条件を付ければ、ブラウザのキャッシュの状態に左右されず必ず条件付きになる。
// 変わっていなければ304が返るだけなので、実質ゼロ通信で済む。
async function revalidateAsset(cache, url) {
  const cached = await cache.match(url, { ignoreSearch: true });
  // まだ持っていない物は、確かめようが無いので普通に取る。
  // ここは 'no-cache'（必ず問い合わせ直す）にしてはいけない。
  // 初回起動では画面が先に同じ画像を読み込んでいるので、
  // 問い合わせ直すと全部もう一度ダウンロードすることになり、
  // 初回の通信量がちょうど倍になる。既定の扱いにしておけば
  // ブラウザが持っている取れたての物がそのまま使われる。
  if (!cached) {
    const response = await fetch(new Request(url, { cache: 'default' }));
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    await cache.put(new Request(url, { cache: 'no-cache' }), response);
    return;
  }

  const headers = new Headers();
  const etag = cached.headers.get('ETag');
  const lastModified = cached.headers.get('Last-Modified');
  if (etag) headers.set('If-None-Match', etag);
  else if (lastModified) headers.set('If-Modified-Since', lastModified);
  // 手がかりが何も無い応答は確かめようがないので、そのまま使い続ける
  else return;

  // ブラウザのキャッシュを挟むと条件が書き換わるため 'no-store' で直接聞く
  const response = await fetch(new Request(url, { cache: 'no-store', headers }));
  if (response.status === 304) return;   // 変わっていない
  if (!response.ok) return;              // 取れなければ手持ちのまま
  await cache.put(new Request(url, { cache: 'no-cache' }), response);
}

async function cacheFreshAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const core = APP_SHELL.filter(isCoreAsset);

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
  // 画像・音声はここでは取らない。有効化のあと、前バージョンから引き継いだうえで
  // 問い合わせ直す（→ activate）。install と両方で取ると同じ物を二度確認することになる。
}

self.addEventListener('install', event => {
  // 中核ファイルがそろった時点でインストール完了とする（メディアは有効化後）
  event.waitUntil(cacheFreshAppShell());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// 前のバージョンのキャッシュを、捨てる前に新しいキャッシュへ引き継ぐ。
//
// 以前はここで古いキャッシュを問答無用に消していた。ところが更新の適用は
// 中核ファイルがそろった時点で始まるため、画像・音声の取り込みはまだ裏で
// 動いている最中である。そこへ「古いキャッシュを全消し」が入ると、
// 直後の読み込み直しでほぼ全アセットがキャッシュから消えた状態になり、
// 端末に同じ画像があるのに丸ごと取り直すことになっていた。
// これが「更新の時だけ異常に待たされる」原因。
//
// 新しいキャッシュに既にある物（＝この更新で取り直した最新版）は上書きしない。
// あくまで穴埋めなので、変わったファイルが古いまま残ることはない。
// 取りこぼしがあっても、あとから走る再確認で最新版に入れ替わる。
async function adoptPreviousCaches() {
  const keys = await caches.keys();
  const previous = keys.filter(key => key !== CACHE_NAME);
  if (!previous.length) return 0;

  const cache = await caches.open(CACHE_NAME);
  let adopted = 0;
  for (const key of previous) {
    const old = await caches.open(key);
    for (const request of await old.keys()) {
      if (await cache.match(request, { ignoreSearch: true })) continue;
      const response = await old.match(request);
      if (response) { await cache.put(request, response); adopted++; }
    }
  }
  await Promise.all(previous.map(key => caches.delete(key)));
  return adopted;
}

// 引き継いだ物が古いままにならないよう、裏で問い合わせ直す。
// 変わっていなければ304が返るだけなので、通信量はほぼゼロで済む。
//
// 起動直後の読み込みが一段落するまで待ってから始める。
// すぐ始めると、画面が自分で読み込んでいる最中の画像をこちらも取りに行き、
// 同じファイルを二重にダウンロードすることになる（初回起動が倍の通信量になっていた）。
// 待ってから走らせれば、画面が取った物は既にキャッシュにあるので
// 「変わっていないか」の問い合わせだけで済む。
const REVALIDATE_DELAY_MS = 12000;

function revalidateMedia() {
  return caches.open(CACHE_NAME).then(cache => Promise.allSettled(
    APP_SHELL.filter(url => !isCoreAsset(url))
      .map(url => revalidateAsset(cache, url).catch(() => {}))
  ));
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const adopted = await adoptPreviousCaches();
    await self.clients.claim();
    if (adopted) {
      // 更新時：手持ちがそろっているので、確認するだけ（変わっていなければ304）。
      // 差し替えた画像をその場で反映させたいので待たずに走らせる。
      revalidateMedia();
    } else {
      // 初回：まだ何も持っていないので本当にダウンロードすることになる。
      // 画面が読んでいる最中の物と取り合わないよう、落ち着くまで待つ。
      setTimeout(revalidateMedia, REVALIDATE_DELAY_MS);
    }
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
        .then(cached => cached || fetch(new Request(request, { cache: 'no-cache' })))
    );
    return;
  }

  // キャッシュに無い時の取りに行き方。
  // 以前は 'reload'（ブラウザのキャッシュを一切見ずに必ず丸ごとダウンロード）だった。
  // 更新直後はキャッシュが空に近いためほぼ全アセットがここを通り、
  // 端末に同じ物があっても全部ダウンロードし直していた。
  // 'no-cache' なら「変わっていないか」だけ問い合わせ、変わっていなければ
  // 本文は流れず端末の物がそのまま使われる。
  event.respondWith(
    caches.open(CACHE_NAME)
      .then(cache => cache.match(request, { ignoreSearch: true }))
      .then(cached => cached || fetch(new Request(request, { cache: 'no-cache' })).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }))
  );
});

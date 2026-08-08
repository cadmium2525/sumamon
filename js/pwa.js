// iPhone/PWAで横向き起動した直後の表示領域を安定させる。
function updateSmamonViewport() {
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width || window.innerWidth || document.documentElement.clientWidth);
  const height = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight);
  document.documentElement.style.setProperty('--app-width', `${width}px`);
  document.documentElement.style.setProperty('--app-height', `${height}px`);
  document.documentElement.style.setProperty('--app-vh', `${height * 0.01}px`);
  window.dispatchEvent(new CustomEvent('smamon:viewportchange', { detail: { width, height } }));
  return { width, height };
}

// 端末が今どちらの向きかを、表示領域とは別の手がかりから調べる。
// 判断できない環境では null を返す。
function smamonOrientationIsLandscape() {
  const type = window.screen?.orientation?.type;
  if (typeof type === 'string' && type) return type.startsWith('landscape');
  if (typeof window.orientation === 'number') return Math.abs(window.orientation) === 90;
  return null;
}

// 横向きのまま起動すると、iOSは一定時間 縦向きだった頃の高さを返し続けることがある。
// その値で画面を組むと中身が上へずれるため、
// 「向きと表示領域の縦横が一致し、かつ値が落ち着く」まで測り直してから表示する。
function settleSmamonViewport({ hideUntilReady = false } = {}) {
  let previous = updateSmamonViewport();
  let stableCount = 0;
  let attempts = 0;
  const MAX_ATTEMPTS = 30;        // 100ms間隔で最大3秒

  const measure = () => {
    attempts++;
    const size = updateSmamonViewport();
    const landscape = smamonOrientationIsLandscape();
    const matchesOrientation = landscape === null || landscape === (size.width >= size.height);
    const unchanged = size.width === previous.width && size.height === previous.height;
    previous = size;
    stableCount = unchanged ? stableCount + 1 : 0;

    // 2回続けて同じ値で、かつ向きとも矛盾しなければ確定とみなす
    if ((stableCount >= 2 && matchesOrientation) || attempts >= MAX_ATTEMPTS) {
      document.body.classList.remove('layout-pending');
      return;
    }
    setTimeout(measure, 100);
  };

  if (hideUntilReady) document.body.classList.add('layout-pending');
  requestAnimationFrame(() => requestAnimationFrame(measure));
}

settleSmamonViewport();
window.addEventListener('resize', updateSmamonViewport, { passive: true });
window.addEventListener('orientationchange', () => settleSmamonViewport(), { passive: true });
window.screen?.orientation?.addEventListener?.('change', () => settleSmamonViewport());
window.visualViewport?.addEventListener('resize', updateSmamonViewport, { passive: true });

// ==== Service Worker の更新 ====
// 起動直後（まだ遊び始めていない間）は黙って最新版へ入れ替える。
// 遊んでいる最中に更新が届いた時だけ、中断しないようお知らせを出す。
const updateModal = document.getElementById('app-update-modal');
const updateNowButton = document.getElementById('app-update-now');
const updateLaterButton = document.getElementById('app-update-later');
let waitingWorker = null;
let reloadingForUpdate = false;
let updateCheckInProgress = false;

// ローディング〜スタート画面にいる間は「まだ遊び始めていない＝起動中」とみなす。
// この間の読み込み直しは利用者から見えないため、確認を挟まず最新版へ入れ替える。
const BOOT_SCREENS = ['screen-loading', 'screen-auth', 'screen-start'];
function isBootPhase() {
  return BOOT_SCREENS.some(id => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden');
  });
}

// 起動時に始めた確認で見つかった更新かどうか。
// Service Workerの入れ替えはアプリの中身を全部取り直すため数十秒かかることがあり、
// 準備ができた頃には利用者はもうスタート画面を抜けている。
// これを「遊んでいる最中に届いた更新」と扱ってお知らせを出すと、
// 起動するたび更新を促されることになるので区別する。
let launchPhase = true;

function applyUpdate(worker) {
  if (!worker) return;
  worker.postMessage({ type: 'SKIP_WAITING' });
}

function handleReadyUpdate(worker) {
  if (!worker) return;
  waitingWorker = worker;
  // 初回インストール（まだ制御下にない）は、そのまま使えばもう最新なので何もしない
  if (!navigator.serviceWorker.controller) return;
  if (isBootPhase()) {
    // 起動中：ローディングの裏で入れ替えて読み込み直す（利用者の操作は不要）
    applyUpdate(worker);
    return;
  }
  if (launchPhase) {
    // 起動時に始めた確認の結果が、遊び始めたあとに届いた場合。
    // ここで割り込まず、次に起動した時へ回す（次回はスタート画面で黙って入れ替わる）。
    return;
  }
  updateNowButton.disabled = false;
  updateNowButton.textContent = '更新';
  updateModal?.classList.remove('hidden');
}

async function checkForAppUpdate(registration, { fromLaunch = false } = {}) {
  // 起動時以外の確認が走った時点で、以降の更新は「遊んでいる最中に届いたもの」とみなす
  if (!fromLaunch) launchPhase = false;
  if (updateCheckInProgress) return;
  updateCheckInProgress = true;
  try {
    if (registration.waiting) {
      handleReadyUpdate(registration.waiting);
      return;
    }
    await registration.update();
    if (registration.waiting) handleReadyUpdate(registration.waiting);
  } catch (error) {
    console.warn('更新データの確認に失敗しました:', error);
  } finally {
    updateCheckInProgress = false;
  }
}

updateNowButton?.addEventListener('click', () => {
  if (!waitingWorker) return;
  updateNowButton.disabled = true;
  updateNowButton.textContent = '更新中…';
  applyUpdate(waitingWorker);
});

updateLaterButton?.addEventListener('click', () => {
  updateModal?.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', {
        updateViaCache: 'none'
      });

      // 前回の起動中に用意されていた更新は、ここで黙って適用される
      if (registration.waiting) handleReadyUpdate(registration.waiting);

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') handleReadyUpdate(installing);
        });
      });

      // 初回インストールでは、まだ誰も管理していない状態から
      // Service Worker が管理を引き取る時にも controllerchange が起きる。
      // これは「新しい版に入れ替わった」わけではないので読み込み直す必要がない。
      // 以前はここでも読み込み直していたため、初めての起動が必ず2回ぶんになり、
      // 画像も音声も丸ごと二度ダウンロードしていた。
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) { hadController = true; return; }
        if (reloadingForUpdate) return;
        reloadingForUpdate = true;
        window.location.reload();
      });

      // 起動時、PWAへ戻った時、起動後の一定間隔で更新を確認する。
      await checkForAppUpdate(registration, { fromLaunch: true });
      // 一度アプリを離れて戻ってきた時は、そこから先の更新は「遊んでいる最中のもの」
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForAppUpdate(registration);
      });
      window.addEventListener('pageshow', event => {
        // 読み込み直後のpageshowは起動の一部なので、お知らせの対象にしない
        checkForAppUpdate(registration, { fromLaunch: !event.persisted && launchPhase });
      });
      window.setInterval(() => checkForAppUpdate(registration), 5 * 60 * 1000);
    } catch (error) {
      console.error('Service Workerの登録に失敗しました:', error);
    }
  });
}

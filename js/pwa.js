// iPhone/PWAで横向き起動した直後の表示領域を安定させる。
function updateSmamonViewport() {
  const viewport = window.visualViewport;
  const width = Math.round(viewport?.width || window.innerWidth || document.documentElement.clientWidth);
  const height = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight);
  document.documentElement.style.setProperty('--app-width', `${width}px`);
  document.documentElement.style.setProperty('--app-height', `${height}px`);
  document.documentElement.style.setProperty('--app-vh', `${height * 0.01}px`);
  window.dispatchEvent(new CustomEvent('smamon:viewportchange', { detail: { width, height } }));
}

function settleSmamonViewport() {
  updateSmamonViewport();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    updateSmamonViewport();
    document.body.classList.remove('layout-pending');
  }));
  [120, 350, 700].forEach(delay => setTimeout(updateSmamonViewport, delay));
}

settleSmamonViewport();
window.addEventListener('resize', updateSmamonViewport, { passive: true });
window.addEventListener('orientationchange', settleSmamonViewport, { passive: true });
window.visualViewport?.addEventListener('resize', updateSmamonViewport, { passive: true });

// Service Worker更新通知。
const APP_VERSION = '73';
const updateModal = document.getElementById('app-update-modal');
const updateNowButton = document.getElementById('app-update-now');
const updateLaterButton = document.getElementById('app-update-later');
let waitingWorker = null;
let reloadingForUpdate = false;
let updateCheckInProgress = false;

function showUpdatePrompt(worker) {
  if (!worker || !navigator.serviceWorker.controller) return;
  waitingWorker = worker;
  updateNowButton.disabled = false;
  updateNowButton.textContent = '更新';
  updateModal?.classList.remove('hidden');
}

async function checkForAppUpdate(registration) {
  if (updateCheckInProgress) return;
  updateCheckInProgress = true;
  try {
    if (registration.waiting) {
      showUpdatePrompt(registration.waiting);
      return;
    }

    const response = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const release = await response.json();
    if (String(release.version) !== APP_VERSION) {
      await registration.update();
      if (registration.waiting) showUpdatePrompt(registration.waiting);
    }
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
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
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

      if (registration.waiting) showUpdatePrompt(registration.waiting);

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdatePrompt(installing);
          }
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadingForUpdate) return;
        reloadingForUpdate = true;
        window.location.reload();
      });

      // 起動時、PWAへ戻った時、起動後の一定間隔で更新を確認する。
      await registration.update().catch(() => {});
      await checkForAppUpdate(registration);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForAppUpdate(registration);
      });
      window.addEventListener('pageshow', () => checkForAppUpdate(registration));
      window.setInterval(() => checkForAppUpdate(registration), 5 * 60 * 1000);
    } catch (error) {
      console.error('Service Workerの登録に失敗しました:', error);
    }
  });
}

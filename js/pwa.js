// ==== iPhone/PWA viewport安定化 ====
// 横持ち起動直後はvisualViewportが数フレーム遅れて確定するため、複数回同期する。
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

// ==== Service Worker更新通知 ====
const updateModal = document.getElementById('app-update-modal');
const updateNowButton = document.getElementById('app-update-now');
const updateLaterButton = document.getElementById('app-update-later');
let waitingWorker = null;
let reloadingForUpdate = false;

function showUpdatePrompt(worker) {
  if (!worker || !navigator.serviceWorker.controller) return;
  waitingWorker = worker;
  updateModal?.classList.remove('hidden');
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
      const registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
      if (registration.waiting) showUpdatePrompt(registration.waiting);

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) showUpdatePrompt(installing);
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadingForUpdate) return;
        reloadingForUpdate = true;
        window.location.reload();
      });

      registration.update().catch(() => {});
    } catch (error) {
      console.error('Service Workerの登録に失敗しました:', error);
    }
  });
}

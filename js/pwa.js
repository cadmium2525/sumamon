// HTTPS配信時にService Workerを登録し、ホーム画面追加／オフライン起動を有効化する。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .catch(error => console.error('Service Workerの登録に失敗しました:', error));
  });
}

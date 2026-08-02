// ==== BGM / SE 管理 ====
// iPhone Safari / PWA の自動再生制限に合わせ、最初のユーザー操作で音声要素を有効化する。
const AudioManager = {
  SETTINGS_KEY: 'smamon_audio_settings',
  tracks: {
    home: { src: 'assets/audio/home.mp3', baseVolume: 1 / 3 },
    battleMode: { src: 'assets/audio/battlemode.mp3', baseVolume: 2 / 5 },
  },
  effects: {
    arrow: { src: 'assets/audio/arrow.mp3', baseVolume: 0.75 },
    bomb: { src: 'assets/audio/bomb.mp3', baseVolume: 0.75 },
  },
  bgmVolume: 70,
  seVolume: 70,
  currentTrack: null,
  desiredTrack: null,
  unlocked: false,
  bgm: null,
  sePools: {},
  sePoolIndex: {},

  init() {
    this.loadSettings();
    this.bgm = new Audio(this.tracks.home.src);
    this.bgm.loop = true;
    this.bgm.preload = 'auto';
    this.bgm.playsInline = true;
    Object.entries(this.effects).forEach(([key, effect]) => {
      this.sePools[key] = Array.from({ length: 4 }, () => {
        const audio = new Audio(effect.src);
        audio.preload = 'auto';
        audio.playsInline = true;
        return audio;
      });
      this.sePoolIndex[key] = 0;
    });
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true, once: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true, once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.bgm?.pause();
      else this.resumeDesiredTrack();
    });
    window.addEventListener('pagehide', () => this.bgm?.pause());
    window.addEventListener('pageshow', () => this.resumeDesiredTrack());
  },

  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.SETTINGS_KEY));
      if (saved) {
        this.bgmVolume = this.clampVolume(saved.bgmVolume, 70);
        this.seVolume = this.clampVolume(saved.seVolume, 70);
      }
    } catch (error) { /* 初期値を使用 */ }
  },

  saveSettings() {
    try {
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify({ bgmVolume: this.bgmVolume, seVolume: this.seVolume }));
    } catch (error) { /* 保存できなくてもゲームは続行 */ }
  },

  clampVolume(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
  },

  async unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    // BGMのplayはユーザー操作の同期処理内で先に呼び、iOSの再生許可を確実に得る。
    if (this.desiredTrack) {
      this.resumeDesiredTrack();
    } else if (this.bgm) {
      this.bgm.muted = true;
      const unlockBgm = this.bgm.play();
      if (unlockBgm && typeof unlockBgm.then === 'function') {
        unlockBgm.then(() => {
          this.bgm.pause();
          this.bgm.currentTime = 0;
          this.bgm.muted = false;
          this.applyBgmVolume();
        }).catch(() => { this.bgm.muted = false; });
      }
    }
    const unlockEffects = Object.values(this.sePools).flat().map(async audio => {
      const previousVolume = audio.volume;
      audio.volume = 0;
      try { await audio.play(); } catch (error) { /* 次の操作で再試行可能 */ }
      audio.pause();
      audio.currentTime = 0;
      audio.volume = previousVolume;
    });
    await Promise.allSettled(unlockEffects);
  },

  setScene(sceneName, mode) {
    let nextTrack = null;
    if (sceneName === 'home') nextTrack = 'home';
    const cpuScenes = ['cpu-mode', 'stage-select', 'fighter-select', 'cpu-level', 'battle-intro', 'battle'];
    const multiScenes = ['multi-menu', 'multi-lobby', 'battle-intro', 'battle'];
    if (mode === 'cpu' && cpuScenes.includes(sceneName)) nextTrack = 'battleMode';
    if (mode === 'multi' && multiScenes.includes(sceneName)) nextTrack = 'battleMode';
    this.playBgm(nextTrack);
  },

  playBgm(trackKey) {
    this.desiredTrack = trackKey || null;
    if (!trackKey) {
      this.stopBgm();
      return;
    }
    const track = this.tracks[trackKey];
    if (!track) return;
    if (this.currentTrack !== trackKey) {
      this.bgm.pause();
      this.bgm.currentTime = 0;
      this.bgm.src = track.src;
      this.bgm.load();
      this.currentTrack = trackKey;
    }
    this.applyBgmVolume();
    this.resumeDesiredTrack();
  },

  resumeDesiredTrack() {
    if (!this.unlocked || !this.desiredTrack || document.hidden || !this.bgm) return;
    if (this.currentTrack !== this.desiredTrack) this.playBgm(this.desiredTrack);
    const promise = this.bgm.play();
    if (promise && typeof promise.catch === 'function') promise.catch(() => {});
  },

  stopBgm() {
    if (!this.bgm) return;
    this.bgm.pause();
    this.bgm.currentTime = 0;
    this.currentTrack = null;
  },

  applyBgmVolume() {
    if (!this.bgm || !this.currentTrack) return;
    const base = this.tracks[this.currentTrack]?.baseVolume || 1;
    this.bgm.volume = Math.max(0, Math.min(1, base * this.bgmVolume / 100));
  },

  setBgmVolume(value) {
    this.bgmVolume = this.clampVolume(value, this.bgmVolume);
    this.applyBgmVolume();
    this.saveSettings();
    return this.bgmVolume;
  },

  setSeVolume(value) {
    this.seVolume = this.clampVolume(value, this.seVolume);
    this.saveSettings();
    return this.seVolume;
  },

  playSe(effectKey) {
    if (!this.unlocked) return;
    const effect = this.effects[effectKey];
    const pool = this.sePools[effectKey];
    if (!effect || !pool?.length) return;
    const index = this.sePoolIndex[effectKey] % pool.length;
    this.sePoolIndex[effectKey] = index + 1;
    const audio = pool[index];
    audio.pause();
    audio.currentTime = 0;
    audio.volume = Math.max(0, Math.min(1, effect.baseVolume * this.seVolume / 100));
    const promise = audio.play();
    if (promise && typeof promise.catch === 'function') promise.catch(() => {});
  },
};

AudioManager.init();
window.AudioManager = AudioManager;

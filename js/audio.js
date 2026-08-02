// ==== BGM / SE 管理 ====
// iOSではHTMLAudioElement.volumeが効かないため、音量はWeb AudioのGainNodeで制御する。
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
  soundEnabled: true,
  currentTrack: null,
  desiredTrack: null,
  unlocked: false,
  bgm: null,
  context: null,
  masterGain: null,
  bgmGain: null,
  seGain: null,
  effectBuffers: {},
  activeSeSources: new Set(),

  init() {
    this.loadSettings();
    this.bgm = new Audio(this.tracks.home.src);
    this.bgm.loop = true;
    this.bgm.preload = 'auto';
    this.bgm.playsInline = true;
    this.createAudioGraph();
    this.loadEffectBuffers();

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

  isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },

  loadSettings() {
    const defaultEnabled = !this.isIOS();
    try {
      const saved = JSON.parse(localStorage.getItem(this.SETTINGS_KEY));
      if (saved) {
        this.bgmVolume = this.clampVolume(saved.bgmVolume, 70);
        this.seVolume = this.clampVolume(saved.seVolume, 70);
        this.soundEnabled = typeof saved.soundEnabled === 'boolean' ? saved.soundEnabled : defaultEnabled;
        return;
      }
    } catch (error) { /* 初期値を使用 */ }
    this.soundEnabled = defaultEnabled;
  },

  saveSettings() {
    try {
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify({
        bgmVolume: this.bgmVolume,
        seVolume: this.seVolume,
        soundEnabled: this.soundEnabled,
      }));
    } catch (error) { /* 保存できなくてもゲームは続行 */ }
  },

  createAudioGraph() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      this.context = new AudioContextClass();
      this.masterGain = this.context.createGain();
      this.bgmGain = this.context.createGain();
      this.seGain = this.context.createGain();
      this.bgmGain.connect(this.masterGain);
      this.seGain.connect(this.masterGain);
      this.masterGain.connect(this.context.destination);
      this.context.createMediaElementSource(this.bgm).connect(this.bgmGain);
      this.applyVolumes();
    } catch (error) {
      console.warn('音声出力を初期化できませんでした:', error);
      this.context = null;
    }
  },

  async loadEffectBuffers() {
    if (!this.context) return;
    await Promise.all(Object.entries(this.effects).map(async ([key, effect]) => {
      try {
        const response = await fetch(effect.src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        this.effectBuffers[key] = await this.context.decodeAudioData(data.slice(0));
      } catch (error) {
        console.warn(`${key} SEを読み込めませんでした:`, error);
      }
    }));
  },

  async unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    // 音源は再生せずAudioContextだけを再開する。TAP START時のSE誤再生を防ぐ。
    if (this.context?.state === 'suspended') {
      try { await this.context.resume(); } catch (error) { /* 次の操作で再試行 */ }
    }
    this.resumeDesiredTrack();
  },

  clampVolume(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
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
    this.applyVolumes();
    this.resumeDesiredTrack();
  },

  resumeDesiredTrack() {
    if (!this.unlocked || !this.soundEnabled || !this.desiredTrack || document.hidden || !this.bgm) return;
    if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
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

  applyVolumes() {
    const now = this.context?.currentTime || 0;
    if (this.masterGain) this.masterGain.gain.setValueAtTime(this.soundEnabled ? 1 : 0, now);
    if (this.bgmGain) {
      const base = this.tracks[this.currentTrack]?.baseVolume || 1;
      this.bgmGain.gain.setValueAtTime(base * this.bgmVolume / 100, now);
    } else if (this.bgm) {
      this.bgm.volume = this.soundEnabled ? this.bgmVolume / 100 : 0;
    }
    if (this.seGain) this.seGain.gain.setValueAtTime(this.seVolume / 100, now);
  },

  setSoundEnabled(enabled) {
    this.soundEnabled = !!enabled;
    this.applyVolumes();
    this.saveSettings();
    if (this.soundEnabled) this.resumeDesiredTrack();
    else {
      this.bgm?.pause();
      this.stopAllSe();
    }
    return this.soundEnabled;
  },

  setBgmVolume(value) {
    this.bgmVolume = this.clampVolume(value, this.bgmVolume);
    this.applyVolumes();
    this.saveSettings();
    return this.bgmVolume;
  },

  setSeVolume(value) {
    this.seVolume = this.clampVolume(value, this.seVolume);
    this.applyVolumes();
    this.saveSettings();
    return this.seVolume;
  },

  playSe(effectKey) {
    if (!this.unlocked || !this.soundEnabled || !this.context || this.context.state !== 'running') return;
    const buffer = this.effectBuffers[effectKey];
    const effect = this.effects[effectKey];
    if (!buffer || !effect) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    gain.gain.value = effect.baseVolume;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(this.seGain);
    this.activeSeSources.add(source);
    source.onended = () => {
      this.activeSeSources.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start(0);
  },

  stopAllSe() {
    this.activeSeSources.forEach(source => {
      try { source.stop(); } catch (error) { /* 既に停止済み */ }
    });
    this.activeSeSources.clear();
  },
};

AudioManager.init();
window.AudioManager = AudioManager;

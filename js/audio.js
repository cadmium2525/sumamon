// ==== BGM / SE 管理 ====
// BGM/SEとも純粋なWeb Audio APIで再生する。
// iOSでは明示再生したHTMLAudioElementはメディア扱いとなり、マナースイッチを無視するため使用しない。
const AudioManager = {
  SETTINGS_KEY: 'smamon_audio_settings',
  // BGM。ここに1行足すだけで管理者モードの確認画面にも自動で並ぶ（labelは表示名）。
  tracks: {
    home: { label: 'ホーム', src: 'assets/audio/home.mp3', baseVolume: 1 / 3 },
    masmonManage: { label: 'マスモン管理・スキン変更', src: 'assets/audio/hometowndomina.mp3', baseVolume: 1 / 3 },
    itemShop: { label: 'アイテム販売所', src: 'assets/audio/kokoroarubasho.mp3', baseVolume: 1 / 3 },
    battleMode: { label: '対戦準備', src: 'assets/audio/battlemode.mp3', baseVolume: 2 / 5 },
    // 実際の対戦中に流れる曲（ファイル名に空白を含むため、URLは%20でエンコードした形で統一する）
    battle: { label: '対戦中（Pain the Universe）', src: 'assets/audio/Pain%20the%20Universe.mp3', baseVolume: 2 / 5 },
  },
  // SE。同じくここに足せば確認画面へ自動で反映される。
  effects: {
    arrow: { label: '矢', src: 'assets/audio/arrow.mp3', baseVolume: 0.75 },
    bomb: { label: '爆発', src: 'assets/audio/bomb.mp3', baseVolume: 0.75 },
  },

  // 管理者モードの確認画面用：登録済みBGM/SEの一覧を返す
  listTracks() {
    return Object.entries(this.tracks).map(([key, track]) => ({
      key, label: track.label || key, src: decodeURI(track.src),
      loaded: !!this.trackBuffers[key],
    }));
  },
  listEffects() {
    return Object.entries(this.effects).map(([key, effect]) => ({
      key, label: effect.label || key, src: decodeURI(effect.src),
      loaded: !!this.effectBuffers[key],
    }));
  },
  bgmVolume: 70,
  seVolume: 70,
  soundEnabled: true,
  currentTrack: null,
  desiredTrack: null,
  unlocked: false,
  bgmSource: null,
  context: null,
  masterGain: null,
  bgmGain: null,
  seGain: null,
  trackBuffers: {},
  effectBuffers: {},
  activeSeSources: new Set(),

  init() {
    this.loadSettings();
    this.createAudioGraph();
    this.loadTrackBuffers();
    this.loadEffectBuffers();

    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true, once: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true, once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopBgm(false);
      else this.resumeDesiredTrack();
    });
    window.addEventListener('pagehide', () => this.stopBgm(false));
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
      this.applyVolumes();
    } catch (error) {
      console.warn('音声出力を初期化できませんでした:', error);
      this.context = null;
    }
  },

  async loadTrackBuffers() {
    if (!this.context) return;
    await Promise.all(Object.entries(this.tracks).map(async ([key, track]) => {
      try {
        const response = await fetch(track.src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        this.trackBuffers[key] = await this.context.decodeAudioData(data.slice(0));
        if (key === this.desiredTrack) this.resumeDesiredTrack();
      } catch (error) {
        console.warn(`${key} BGMを読み込めませんでした:`, error);
      }
    }));
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

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;

    // iOSの自動再生制限対策。ユーザー操作のコールスタック内で同期的にresume()を呼ぶ。
    // BufferSourceはまだ開始しないため、TAP STARTでSEが誤再生されることはない。
    if (this.context?.state === 'suspended') {
      this.context.resume().then(() => this.resumeDesiredTrack()).catch(() => {});
    } else {
      this.resumeDesiredTrack();
    }
  },

  clampVolume(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
  },

  setScene(sceneName, mode) {
    let nextTrack = null;
    if (sceneName === 'home') nextTrack = 'home';
    if (sceneName === 'masmon-manage' || sceneName === 'skin') nextTrack = 'masmonManage';
    if (sceneName === 'item-shop') nextTrack = 'itemShop';
    // 'versus'（開始前の対戦カード）も準備画面の一部として扱う。
    // 入れ忘れると、カードを見ている数秒だけBGMが止まって鳴り直す。
    const cpuScenes = ['cpu-mode', 'stage-select', 'fighter-select', 'cpu-level', 'versus', 'battle-intro', 'battle'];
    const multiScenes = ['multi-menu', 'multi-lobby', 'versus', 'battle-intro', 'battle'];
    if (mode === 'cpu' && cpuScenes.includes(sceneName)) nextTrack = 'battleMode';
    if (mode === 'multi' && multiScenes.includes(sceneName)) nextTrack = 'battleMode';
    // 対戦中は専用BGMへ切り替える（準備画面までは battleMode のまま）
    if (sceneName === 'battle') nextTrack = 'battle';
    this.playBgm(nextTrack);
  },

  playBgm(trackKey) {
    const isSwitchingTrack = this.currentTrack && this.currentTrack !== trackKey;
    this.desiredTrack = trackKey || null;
    if (!trackKey) {
      this.stopBgm();
      return;
    }
    if (!this.tracks[trackKey]) return;
    // 次の曲がまだ読み込み中でも、前画面の曲だけが鳴り続けないよう先に止める。
    if (isSwitchingTrack) this.stopBgm(false);
    this.applyVolumes();
    this.resumeDesiredTrack();
  },

  resumeDesiredTrack() {
    if (!this.unlocked || !this.soundEnabled || !this.desiredTrack || document.hidden || !this.context) return;
    if (this.context.state === 'suspended') {
      this.context.resume().then(() => this.resumeDesiredTrack()).catch(() => {});
      return;
    }
    if (this.context.state !== 'running' || this.currentTrack === this.desiredTrack && this.bgmSource) return;
    const buffer = this.trackBuffers[this.desiredTrack];
    if (!buffer) return;

    this.stopBgm(false);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.bgmGain);
    this.bgmSource = source;
    this.currentTrack = this.desiredTrack;
    source.start(0);
    this.applyVolumes();
  },

  stopBgm(clearDesired = true) {
    if (this.bgmSource) {
      try { this.bgmSource.stop(); } catch (error) { /* 既に停止済み */ }
      this.bgmSource.disconnect();
      this.bgmSource = null;
    }
    this.currentTrack = null;
    if (clearDesired) this.desiredTrack = null;
  },

  applyVolumes() {
    const now = this.context?.currentTime || 0;
    if (this.masterGain) this.masterGain.gain.setValueAtTime(this.soundEnabled ? 1 : 0, now);
    if (this.bgmGain) {
      const base = this.tracks[this.desiredTrack || this.currentTrack]?.baseVolume || 1;
      this.bgmGain.gain.setValueAtTime(base * this.bgmVolume / 100, now);
    }
    if (this.seGain) this.seGain.gain.setValueAtTime(this.seVolume / 100, now);
  },

  setSoundEnabled(enabled) {
    this.soundEnabled = !!enabled;
    this.applyVolumes();
    this.saveSettings();
    if (this.soundEnabled) this.resumeDesiredTrack();
    else {
      this.stopBgm(false);
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

  // 音声ファイルを持たない効果音を、その場で合成して鳴らす。
  // 修行の演出音のように「短くて種類が多い」音は、mp3を1つずつ足すと
  // アプリの容量とキャッシュ対象が増えていくため、波形から作る。
  // 音量は通常のSEと同じ seGain を通すので、設定のSE音量がそのまま効く。
  //   freq   : 開始周波数(Hz)
  //   toFreq : 終了周波数(Hz)。省略すると freq のまま（グリッサンドしない）
  //   type   : 波形（sine=澄んだ音 / square・sawtooth=ブザー寄り）
  //   dur    : 長さ(秒)
  //   volume : 音量(0〜1)
  //   delay  : この秒数だけ遅らせて鳴らす（和音やアルペジオを作る用）
  playTone({ freq = 660, toFreq = null, type = 'sine', dur = 0.16, volume = 0.5, delay = 0 } = {}) {
    if (!this.unlocked || !this.soundEnabled || !this.context || this.context.state !== 'running') return;
    const start = this.context.currentTime + Math.max(0, delay);
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (toFreq && toFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), start + dur);
    // 立ち上がりを一瞬で切ると「プツッ」というクリックノイズが出るので、
    // ごく短いフェードイン/アウトを必ず付ける。
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(this.seGain);
    this.activeSeSources.add(osc);
    osc.onended = () => {
      this.activeSeSources.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(start);
    osc.stop(start + dur + 0.02);
  },

  stopAllSe() {
    this.activeSeSources.forEach(source => {
      try { source.stop(); } catch (error) { /* 既に停止済み */ }
    });
    this.activeSeSources.clear();
  },
};

/*
 * iPhone実機確認手順（Safariタブ／ホーム画面追加後のstandalone PWAの両方で確認）
 * 1. 設定でサウンドを有効、BGM音量を聞き取れる値にしてアプリを閉じる。
 * 2. マナースイッチOFFで起動し、TAP STARTを押してホームBGMが鳴ることを確認する。
 * 3. CPU戦を選び、ホームBGMが停止して対戦準備BGMへ切り替わることを確認する。
 * 4. アプリを閉じ、マナースイッチONで再起動して同じ操作を行い、BGMが無音になることを確認する。
 * 5. BGM音量を1・50・100へ変更し、段階的に音量が変わることを確認する。0では完全に無音になることも確認する。
 * 注: iOSにはマナースイッチ状態を取得するAPIがないため、コードでは検知しない。
 */

AudioManager.init();
window.AudioManager = AudioManager;

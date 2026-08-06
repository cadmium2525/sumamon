// ==== 入力管理 ====
// キーボード（ローカル動作確認用）と、モバイル向け仮想パッド(P1のみ)を提供する。
// どちらも同じ形のinputState { left,right,up,down,jump,attack,special,shield,grab,stickX }
// を返すため、Fighter側は入力ソースを区別しない。
// stickX: -1(左いっぱい)〜1(右いっぱい)の連続値。歩き/ダッシュ/ステップの判定に使用。
// キーボードはON/OFFしか無いため常に±1（フル入力）扱いになるが、
// 歩行テスト用の修飾キー（P1:右Alt / P2:左Alt）を押しながらだと倒し込み量を弱めた扱いにする。

class InputManager {
  constructor() {
    this.keys = {};
    window.addEventListener('keydown', e => { this.keys[e.code] = true; });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
  }

  // P1: 矢印キー(移動/方向) + Space(ジャンプ) + Enter(A) + 右Shift(B) + 右Ctrl(シールド) + \(掴み)
  // 右Alt: 歩行テスト用修飾キー（倒し込み量を弱める）
  getPlayer1Input() {
    const left = !!this.keys['ArrowLeft'];
    const right = !!this.keys['ArrowRight'];
    const walkMod = !!this.keys['AltRight'];
    let stickX = 0;
    if (left) stickX = -1;
    if (right) stickX = 1;
    if (walkMod) stickX *= 0.4;
    return {
      left, right,
      up: !!this.keys['ArrowUp'],
      down: !!this.keys['ArrowDown'],
      jump: !!this.keys['Space'],
      attack: !!this.keys['Enter'],
      special: !!this.keys['ShiftRight'],
      shield: !!this.keys['ControlRight'],
      grab: !!this.keys['Backslash'],
      stickX,
      stickY: this.keys['ArrowUp'] ? -1 : this.keys['ArrowDown'] ? 1 : 0,
    };
  }

  // P2: WASD(移動/方向) + Q(ジャンプ) + F(A) + G(B) + H(シールド) + R(掴み)
  // 左Alt: 歩行テスト用修飾キー
  getPlayer2Input() {
    const left = !!this.keys['KeyA'];
    const right = !!this.keys['KeyD'];
    const walkMod = !!this.keys['AltLeft'];
    let stickX = 0;
    if (left) stickX = -1;
    if (right) stickX = 1;
    if (walkMod) stickX *= 0.4;
    return {
      left, right,
      up: !!this.keys['KeyW'],
      down: !!this.keys['KeyS'],
      jump: !!this.keys['KeyQ'],
      attack: !!this.keys['KeyF'],
      special: !!this.keys['KeyG'],
      shield: !!this.keys['KeyH'],
      grab: !!this.keys['KeyR'],
      stickX,
      stickY: this.keys['KeyW'] ? -1 : this.keys['KeyS'] ? 1 : 0,
    };
  }
}

// 入力を論理和／優先マージ（キーボード + 仮想パッド 併用可）
function mergeInputs(a, b) {
  return {
    left: a.left || b.left,
    right: a.right || b.right,
    up: a.up || b.up,
    down: a.down || b.down,
    jump: a.jump || b.jump,
    attack: a.attack || b.attack,
    special: a.special || b.special,
    shield: a.shield || b.shield,
    grab: a.grab || b.grab,
    stickX: Math.abs(b.stickX) > Math.abs(a.stickX) ? b.stickX : a.stickX,
    // stickYはベクトル変更(DI)で使うため、キーボード側に無い場合も落とさず引き継ぐ
    stickY: Math.abs(b.stickY || 0) > Math.abs(a.stickY || 0) ? (b.stickY || 0) : (a.stickY || 0),
  };
}

const PAD_CONFIG_KEY = 'smamon_pad_config';

function loadPadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(PAD_CONFIG_KEY));
    if (saved) return { ...CONFIG.DEFAULT_PAD_CONFIG, ...saved };
  } catch (e) { /* ignore */ }
  return { ...CONFIG.DEFAULT_PAD_CONFIG };
}

function savePadConfig(cfg) {
  try { localStorage.setItem(PAD_CONFIG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
}

// Fighter.jsなど他ファイルから参照する共有設定（ボタン表示 + タップジャンプON/OFF）
window.GameSettings = loadPadConfig();

// ==== 仮想パッド（タッチ操作: 左スティック + 右ボタン群） ====
class VirtualPad {
  constructor(containerEl) {
    this.state = { left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, shield: false, grab: false, stickX: 0, stickY: 0 };
    this.padConfig = window.GameSettings;
    this.container = containerEl;
    this.stickCenter = { x: 0, y: 0 };
    this.stickActiveTouchId = null;
    this._buildDOM();
    this._bindEvents();
  }

  _buildDOM() {
    const root = document.createElement('div');
    root.id = 'vpad-root';
    root.innerHTML = `
      <div id="joystick-base" data-pad-key="stick">
        <div id="joystick-thumb"></div>
      </div>
      <button id="btn-shield" class="vbtn" data-pad-key="shield">Shield</button>
      <button id="btn-jump" class="vbtn" data-pad-key="jump">Jump</button>
      <button id="btn-grab" class="vbtn" data-pad-key="grab">Grab</button>
      <button id="btn-b" class="vbtn" data-pad-key="b">B</button>
      <button id="btn-a" class="vbtn primary" data-pad-key="a">A</button>
    `;
    this.container.appendChild(root);
    this.rootEl = root;

    // 設定パネルはバトル画面に限らずどの画面からも開けるよう document.body 直下に配置
    const settingsRoot = document.createElement('div');
    settingsRoot.id = 'vpad-settings-root';
    settingsRoot.innerHTML = `
      <button id="vpad-settings-toggle" title="操作設定">⚙</button>
      <div id="vpad-settings-panel" class="hidden">
        <div class="settings-tabs">
          <button class="settings-tab active" data-settings-tab="battle">バトル設定</button>
          <button class="settings-tab" data-settings-tab="pad">操作パッド</button>
          <button class="settings-tab" data-settings-tab="audio">音量調節</button>
        </div>
        <div class="settings-pane" data-settings-pane="battle">
          <label><input type="checkbox" id="cfg-jump"> ジャンプボタンを表示</label>
          <label><input type="checkbox" id="cfg-tapjump"> スティック上入力でジャンプ</label>
          <label><input type="checkbox" id="cfg-shield"> シールドボタンを表示</label>
          <label><input type="checkbox" id="cfg-b"> Bボタンを表示</label>
        </div>
        <div class="settings-pane hidden" data-settings-pane="pad">
          <label><input type="checkbox" id="cfg-mirror"> 左右反転（左利き配置）</label>
          <div class="pad-slider"><strong>ボタンの大きさ</strong>
            <input id="cfg-pad-scale" type="range" min="70" max="160" step="5"><output id="cfg-pad-scale-value">100%</output></div>
          <div class="pad-slider"><strong>スティックの大きさ</strong>
            <input id="cfg-stick-scale" type="range" min="70" max="160" step="5"><output id="cfg-stick-scale-value">100%</output></div>
          <div class="pad-slider"><strong>ボタンの濃さ</strong>
            <input id="cfg-pad-opacity" type="range" min="30" max="100" step="5"><output id="cfg-pad-opacity-value">85%</output></div>
          <div class="pad-layout-actions">
            <button id="cfg-pad-edit" type="button">ボタン配置を編集</button>
            <button id="cfg-pad-reset" type="button">配置を初期化</button>
          </div>
          <small class="pad-note">「ボタン配置を編集」で各ボタンをドラッグして自由に動かせます。位置は画面サイズに対する割合で保存されるため、端末が変わっても崩れません。</small>
        </div>
        <div class="settings-pane hidden" data-settings-pane="audio">
          <label class="sound-enable-setting"><input id="cfg-sound-enabled" type="checkbox"> サウンド出力を有効にする</label>
          <small class="sound-ios-note">iPhoneではBGM・SEともマナースイッチに従います。アプリ側でも消音する場合はここをOFFにしてください</small>
          <div class="volume-setting" data-volume-kind="bgm">
            <strong>BGM</strong>
            <div class="volume-controls"><button data-volume-step="-1" aria-label="BGM音量を下げる">−</button><input id="cfg-bgm-volume" type="range" min="0" max="100" step="1"><button data-volume-step="1" aria-label="BGM音量を上げる">＋</button><output id="cfg-bgm-volume-value">70</output></div>
          </div>
          <div class="volume-setting" data-volume-kind="se">
            <strong>SE</strong>
            <div class="volume-controls"><button data-volume-step="-1" aria-label="SE音量を下げる">−</button><input id="cfg-se-volume" type="range" min="0" max="100" step="1"><button data-volume-step="1" aria-label="SE音量を上げる">＋</button><output id="cfg-se-volume-value">70</output></div>
          </div>
        </div>
        <button id="vpad-settings-close">閉じる</button>
      </div>
    `;
    document.body.appendChild(settingsRoot);

    this.el = {
      stickBase: root.querySelector('#joystick-base'),
      stickThumb: root.querySelector('#joystick-thumb'),
      btnJump: root.querySelector('#btn-jump'),
      btnGrab: root.querySelector('#btn-grab'),
      btnShield: root.querySelector('#btn-shield'),
      btnB: root.querySelector('#btn-b'),
      btnA: root.querySelector('#btn-a'),
      settingsToggle: settingsRoot.querySelector('#vpad-settings-toggle'),
      settingsPanel: settingsRoot.querySelector('#vpad-settings-panel'),
      cfgJump: settingsRoot.querySelector('#cfg-jump'),
      cfgTapJump: settingsRoot.querySelector('#cfg-tapjump'),
      cfgShield: settingsRoot.querySelector('#cfg-shield'),
      cfgB: settingsRoot.querySelector('#cfg-b'),
      cfgSoundEnabled: settingsRoot.querySelector('#cfg-sound-enabled'),
      cfgBgmVolume: settingsRoot.querySelector('#cfg-bgm-volume'),
      cfgBgmVolumeValue: settingsRoot.querySelector('#cfg-bgm-volume-value'),
      cfgSeVolume: settingsRoot.querySelector('#cfg-se-volume'),
      cfgSeVolumeValue: settingsRoot.querySelector('#cfg-se-volume-value'),
      settingsClose: settingsRoot.querySelector('#vpad-settings-close'),
      cfgMirror: settingsRoot.querySelector('#cfg-mirror'),
      cfgPadScale: settingsRoot.querySelector('#cfg-pad-scale'),
      cfgPadScaleValue: settingsRoot.querySelector('#cfg-pad-scale-value'),
      cfgStickScale: settingsRoot.querySelector('#cfg-stick-scale'),
      cfgStickScaleValue: settingsRoot.querySelector('#cfg-stick-scale-value'),
      cfgPadOpacity: settingsRoot.querySelector('#cfg-pad-opacity'),
      cfgPadOpacityValue: settingsRoot.querySelector('#cfg-pad-opacity-value'),
      cfgPadEdit: settingsRoot.querySelector('#cfg-pad-edit'),
      cfgPadReset: settingsRoot.querySelector('#cfg-pad-reset'),
    };
    this.settingsRoot = settingsRoot;
    this._applyPadConfigToDOM();
    this._applyAudioSettingsToDOM();
  }

  // 現在の配置（カスタムがあればそれ、無ければ既定）を左右反転も反映して返す
  _resolvedLayout() {
    const base = { ...CONFIG.DEFAULT_PAD_LAYOUT, ...(this.padConfig.layout || {}) };
    if (!this.padConfig.mirrored) return base;
    const flipped = {};
    for (const key in base) flipped[key] = { x: 1 - base[key].x, y: base[key].y };
    return flipped;
  }

  _padElementFor(key) {
    return { stick: this.el.stickBase, shield: this.el.btnShield, jump: this.el.btnJump,
      grab: this.el.btnGrab, b: this.el.btnB, a: this.el.btnA }[key];
  }

  _sizeFor(key) {
    const scale = key === 'stick' ? (this.padConfig.stickScale || 1) : (this.padConfig.padScale || 1);
    return CONFIG.PAD_BUTTON_SIZES[key] * scale;
  }

  // 位置(割合)とサイズを実際のCSSへ反映する。
  // 画面外にはみ出さないよう、要素の半径ぶんだけ内側にクランプする。
  _applyLayoutToDOM() {
    const layout = this._resolvedLayout();
    const rect = this.container.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    for (const key in layout) {
      const el = this._padElementFor(key);
      if (!el) continue;
      const size = this._sizeFor(key);
      const halfX = size / 2 / width;
      const halfY = size / 2 / height;
      const x = Math.min(1 - halfX, Math.max(halfX, layout[key].x));
      const y = Math.min(1 - halfY, Math.max(halfY, layout[key].y));
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.left = `${x * 100}%`;
      el.style.top = `${y * 100}%`;
    }
    // スティックのつまみは土台サイズに追従させる
    const stickSize = this._sizeFor('stick');
    this.el.stickThumb.style.width = `${stickSize * 0.45}px`;
    this.el.stickThumb.style.height = `${stickSize * 0.45}px`;
    this.stickMaxRadius = stickSize * 0.36;
    this.stickDeadzone = stickSize * 0.11;
    this.rootEl.style.setProperty('--pad-opacity', this.padConfig.padOpacity ?? 0.85);
  }

  _applyPadConfigToDOM() {
    this.el.btnJump.style.display = this.padConfig.showJumpButton ? '' : 'none';
    this.el.btnShield.style.display = this.padConfig.showShieldButton ? '' : 'none';
    this.el.btnB.style.display = this.padConfig.showBButton ? '' : 'none';
    this.el.cfgJump.checked = this.padConfig.showJumpButton;
    this.el.cfgTapJump.checked = this.padConfig.tapJumpEnabled;
    this.el.cfgShield.checked = this.padConfig.showShieldButton;
    this.el.cfgB.checked = this.padConfig.showBButton;
    this.el.cfgMirror.checked = !!this.padConfig.mirrored;
    const padPct = Math.round((this.padConfig.padScale || 1) * 100);
    const stickPct = Math.round((this.padConfig.stickScale || 1) * 100);
    const opacityPct = Math.round((this.padConfig.padOpacity ?? 0.85) * 100);
    this.el.cfgPadScale.value = padPct;
    this.el.cfgPadScaleValue.textContent = `${padPct}%`;
    this.el.cfgStickScale.value = stickPct;
    this.el.cfgStickScaleValue.textContent = `${stickPct}%`;
    this.el.cfgPadOpacity.value = opacityPct;
    this.el.cfgPadOpacityValue.textContent = `${opacityPct}%`;
    this._applyLayoutToDOM();
  }

  // ---- ボタン配置エディタ ----
  // 実際のパッドと同じ配置の全画面オーバーレイを出し、ドラッグで位置を決める。
  // バトル中でなくても開けるよう、パッド本体ではなく専用のオーバーレイ上で編集する。
  openLayoutEditor() {
    if (this._layoutEditor) return;
    this.el.settingsPanel.classList.add('hidden');
    const layout = { ...CONFIG.DEFAULT_PAD_LAYOUT, ...(this.padConfig.layout || {}) };
    const mirrored = !!this.padConfig.mirrored;
    const overlay = document.createElement('div');
    overlay.id = 'pad-layout-editor';
    overlay.innerHTML = `
      <div class="pad-editor-hint">ボタンをドラッグして配置を決めてください</div>
      <div class="pad-editor-actions">
        <button data-pad-editor="reset">初期配置に戻す</button>
        <button data-pad-editor="cancel">キャンセル</button>
        <button data-pad-editor="save" class="primary">この配置で保存</button>
      </div>`;
    document.body.appendChild(overlay);

    const labels = { stick: 'スティック', shield: 'Shield', jump: 'Jump', grab: 'Grab', b: 'B', a: 'A' };
    const visible = key => (key === 'jump' ? this.padConfig.showJumpButton
      : key === 'shield' ? this.padConfig.showShieldButton
      : key === 'b' ? this.padConfig.showBButton : true);
    const handles = {};
    for (const key in layout) {
      if (!visible(key)) continue;
      const handle = document.createElement('div');
      handle.className = `pad-editor-handle${key === 'stick' ? ' stick' : ''}${key === 'a' ? ' primary' : ''}`;
      handle.textContent = labels[key];
      overlay.appendChild(handle);
      handles[key] = handle;
    }

    const render = () => {
      for (const key in handles) {
        const size = this._sizeFor(key);
        const px = mirrored ? 1 - layout[key].x : layout[key].x;
        const halfX = size / 2 / window.innerWidth;
        const halfY = size / 2 / window.innerHeight;
        handles[key].style.width = `${size}px`;
        handles[key].style.height = `${size}px`;
        handles[key].style.left = `${Math.min(1 - halfX, Math.max(halfX, px)) * 100}%`;
        handles[key].style.top = `${Math.min(1 - halfY, Math.max(halfY, layout[key].y)) * 100}%`;
      }
    };
    render();

    let dragging = null;
    const pointOf = ev => (ev.touches && ev.touches[0]) || ev;
    const onDown = (key, ev) => { ev.preventDefault(); dragging = key; };
    const onMove = ev => {
      if (!dragging) return;
      ev.preventDefault();
      const point = pointOf(ev);
      const x = Math.min(1, Math.max(0, point.clientX / window.innerWidth));
      const y = Math.min(1, Math.max(0, point.clientY / window.innerHeight));
      // 反転表示中は保存値も反転して戻す（保存は常に「反転していない状態」で持つ）
      layout[dragging] = { x: mirrored ? 1 - x : x, y };
      render();
    };
    const onUp = () => { dragging = null; };
    for (const key in handles) {
      handles[key].addEventListener('touchstart', ev => onDown(key, ev), { passive: false });
      handles[key].addEventListener('mousedown', ev => onDown(key, ev));
    }
    overlay.addEventListener('touchmove', onMove, { passive: false });
    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('touchend', onUp);
    overlay.addEventListener('mouseup', onUp);
    overlay.addEventListener('mouseleave', onUp);

    const close = () => {
      overlay.remove();
      this._layoutEditor = null;
      this.el.settingsPanel.classList.remove('hidden');
    };
    overlay.querySelectorAll('[data-pad-editor]').forEach(button => {
      button.addEventListener('click', () => {
        const action = button.dataset.padEditor;
        if (action === 'reset') {
          for (const key in layout) layout[key] = { ...CONFIG.DEFAULT_PAD_LAYOUT[key] };
          render();
          return;
        }
        if (action === 'save') {
          this.padConfig.layout = layout;
          savePadConfig(this.padConfig);
          this._applyLayoutToDOM();
        }
        close();
      });
    });
    this._layoutEditor = overlay;
  }

  _applyAudioSettingsToDOM() {
    if (!window.AudioManager) return;
    this.el.cfgBgmVolume.value = AudioManager.bgmVolume;
    this.el.cfgBgmVolumeValue.textContent = AudioManager.bgmVolume;
    this.el.cfgSeVolume.value = AudioManager.seVolume;
    this.el.cfgSeVolumeValue.textContent = AudioManager.seVolume;
    this.el.cfgSoundEnabled.checked = AudioManager.soundEnabled;
  }

  _bindEvents() {
    // --- 設定パネル ---
    this.el.settingsToggle.addEventListener('click', () => {
      this.el.settingsPanel.classList.toggle('hidden');
    });
    this.el.settingsClose.addEventListener('click', () => {
      this.el.settingsPanel.classList.add('hidden');
    });
    this.el.settingsPanel.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.el.settingsPanel.querySelectorAll('.settings-tab').forEach(item => item.classList.toggle('active', item === tab));
        this.el.settingsPanel.querySelectorAll('.settings-pane').forEach(pane => pane.classList.toggle('hidden', pane.dataset.settingsPane !== tab.dataset.settingsTab));
      });
    });
    const onCfgChange = () => {
      this.padConfig.showJumpButton = this.el.cfgJump.checked;
      this.padConfig.tapJumpEnabled = this.el.cfgTapJump.checked;
      this.padConfig.showShieldButton = this.el.cfgShield.checked;
      this.padConfig.showBButton = this.el.cfgB.checked;
      savePadConfig(this.padConfig);
      this._applyPadConfigToDOM();
    };
    this.el.cfgJump.addEventListener('change', onCfgChange);
    this.el.cfgTapJump.addEventListener('change', onCfgChange);
    this.el.cfgShield.addEventListener('change', onCfgChange);
    this.el.cfgB.addEventListener('change', onCfgChange);

    // --- 操作パッドのカスタマイズ ---
    const onPadCustomChange = () => {
      this.padConfig.mirrored = this.el.cfgMirror.checked;
      this.padConfig.padScale = Number(this.el.cfgPadScale.value) / 100;
      this.padConfig.stickScale = Number(this.el.cfgStickScale.value) / 100;
      this.padConfig.padOpacity = Number(this.el.cfgPadOpacity.value) / 100;
      savePadConfig(this.padConfig);
      this._applyPadConfigToDOM();
    };
    this.el.cfgMirror.addEventListener('change', onPadCustomChange);
    this.el.cfgPadScale.addEventListener('input', onPadCustomChange);
    this.el.cfgStickScale.addEventListener('input', onPadCustomChange);
    this.el.cfgPadOpacity.addEventListener('input', onPadCustomChange);
    this.el.cfgPadEdit.addEventListener('click', () => this.openLayoutEditor());
    this.el.cfgPadReset.addEventListener('click', () => {
      this.padConfig.layout = null;
      this.padConfig.mirrored = false;
      this.padConfig.padScale = 1;
      this.padConfig.stickScale = 1;
      this.padConfig.padOpacity = CONFIG.DEFAULT_PAD_CONFIG.padOpacity;
      savePadConfig(this.padConfig);
      this._applyPadConfigToDOM();
    });
    // 画面回転やリサイズでも配置比率を保つ
    window.addEventListener('resize', () => this._applyLayoutToDOM());
    window.addEventListener('orientationchange', () => setTimeout(() => this._applyLayoutToDOM(), 120));
    this.el.cfgSoundEnabled.addEventListener('change', () => {
      AudioManager.setSoundEnabled(this.el.cfgSoundEnabled.checked);
    });
    const updateVolume = kind => {
      const slider = kind === 'bgm' ? this.el.cfgBgmVolume : this.el.cfgSeVolume;
      const output = kind === 'bgm' ? this.el.cfgBgmVolumeValue : this.el.cfgSeVolumeValue;
      const value = kind === 'bgm' ? AudioManager.setBgmVolume(slider.value) : AudioManager.setSeVolume(slider.value);
      slider.value = value;
      output.textContent = value;
    };
    this.el.cfgBgmVolume.addEventListener('input', () => updateVolume('bgm'));
    this.el.cfgSeVolume.addEventListener('input', () => updateVolume('se'));
    this.el.settingsPanel.querySelectorAll('[data-volume-step]').forEach(button => {
      button.addEventListener('click', () => {
        const kind = button.closest('[data-volume-kind]').dataset.volumeKind;
        const slider = kind === 'bgm' ? this.el.cfgBgmVolume : this.el.cfgSeVolume;
        slider.value = Number(slider.value) + Number(button.dataset.volumeStep);
        updateVolume(kind);
      });
    });

    // --- ボタン (押しっぱなし判定にtouch/mouse両対応) ---
    const bind = (el, key) => {
      const press = ev => { ev.preventDefault(); this.state[key] = true; };
      const release = ev => { ev.preventDefault(); this.state[key] = false; };
      el.addEventListener('touchstart', press, { passive: false });
      el.addEventListener('touchend', release, { passive: false });
      el.addEventListener('touchcancel', release, { passive: false });
      el.addEventListener('mousedown', press);
      el.addEventListener('mouseup', release);
      el.addEventListener('mouseleave', release);
    };
    bind(this.el.btnJump, 'jump');
    bind(this.el.btnGrab, 'grab');
    bind(this.el.btnShield, 'shield');
    bind(this.el.btnB, 'special');
    bind(this.el.btnA, 'attack');

    // --- 左スティック ---
    const base = this.el.stickBase;
    const thumb = this.el.stickThumb;

    const updateStick = (clientX, clientY) => {
      // スティックの大きさ設定に追従させる
      const maxRadius = this.stickMaxRadius || 40;
      const deadzone = this.stickDeadzone || 12;
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const rawDist = Math.hypot(dx, dy);
      const dist = Math.min(rawDist, maxRadius);
      const angle = Math.atan2(dy, dx);
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist;
      thumb.style.transform = `translate(${tx}px, ${ty}px)`;

      // 連続値（歩き/ダッシュ/ステップの判定に使用）
      this.state.stickX = tx / maxRadius;
      this.state.stickY = ty / maxRadius;

      this.state.left = false; this.state.right = false; this.state.up = false; this.state.down = false;
      if (dist > deadzone) {
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0) this.state.left = true; else this.state.right = true;
        } else {
          if (dy < 0) this.state.up = true; else this.state.down = true;
        }
      }
    };

    const resetStick = () => {
      thumb.style.transform = 'translate(0px, 0px)';
      this.state.left = false; this.state.right = false; this.state.up = false; this.state.down = false;
      this.state.stickX = 0; this.state.stickY = 0;
      this.stickActiveTouchId = null;
    };

    base.addEventListener('touchstart', ev => {
      ev.preventDefault();
      const t = ev.changedTouches[0];
      this.stickActiveTouchId = t.identifier;
      updateStick(t.clientX, t.clientY);
    }, { passive: false });

    base.addEventListener('touchmove', ev => {
      ev.preventDefault();
      for (const t of ev.changedTouches) {
        if (t.identifier === this.stickActiveTouchId) updateStick(t.clientX, t.clientY);
      }
    }, { passive: false });

    const endHandler = ev => {
      ev.preventDefault();
      for (const t of ev.changedTouches) {
        if (t.identifier === this.stickActiveTouchId) resetStick();
      }
    };
    base.addEventListener('touchend', endHandler, { passive: false });
    base.addEventListener('touchcancel', endHandler, { passive: false });

    // マウスでもテスト可能に（デスクトップ確認用）
    let mouseDown = false;
    base.addEventListener('mousedown', ev => { mouseDown = true; updateStick(ev.clientX, ev.clientY); });
    window.addEventListener('mousemove', ev => { if (mouseDown) updateStick(ev.clientX, ev.clientY); });
    window.addEventListener('mouseup', () => { if (mouseDown) { mouseDown = false; resetStick(); } });
  }

  getState() {
    return this.state;
  }

  // バトル画面以外（修行ミニゲームなど）でも同じ仮想パッドを使い回すための再配置用メソッド
  moveTo(container) {
    if (!container || !this.rootEl || this.rootEl.parentElement === container) return;
    container.appendChild(this.rootEl);
    this.container = container;
  }
}

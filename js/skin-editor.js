// ==== スキン（色変更）の編集画面 ====
// 設計は docs/skin-design.md を参照。塗り替えそのものは js/skin.js が受け持つ。
//
// 【v1の作り直し】
// v1は色相20°刻みのバケツを選ばせていたが、イルミネで実測すると1つのバケツが
// 全画素の47%を占め、しかも全身に散らばっていたため、どこをタップしても
// 同じものが選ばれて塗り分けができなかった。加えて「何を選んでいるのか」が
// 画面に出ておらず、塗ってみるまで結果が分からなかった。
//
// v2では次の3点で作り直している。
//   1. OKLabのk-meansで分けた「素材」を選ぶ（明度・彩度も見るのでパーツ単位で分かれる）
//   2. 選択中の範囲を絵の上で光らせる（塗る前に必ず見える）
//   3. 「広さ」で、同じ布の影やハイライトをどこまで巻き込むかを調整できる
const SKIN_PALETTE = [
  '#e01818', '#e06a18', '#e0b418', '#b4e018',
  '#38d048', '#28c8a0', '#28b4e0', '#2864e0',
  '#6a38e0', '#a828e0', '#e028b4', '#e02868',
  '#ffffff', '#b4b4bc', '#606874', '#1c1c24',
];

// プリセットはモンスターの色から作る。各素材の色みだけを目標の色相へ寄せ、
// 明るさと鮮やかさは元のまま残すので、陰影の構造が崩れない。
const SKIN_PRESETS = [
  { key: 'crimson', label: 'クリムゾン', hue: 25 },
  { key: 'amber', label: 'アンバー', hue: 75 },
  { key: 'verdant', label: 'ヴェルダン', hue: 145 },
  { key: 'azure', label: 'アズール', hue: 250 },
  { key: 'violet', label: 'ヴァイオレット', hue: 320 },
  { key: 'rose', label: 'ローズ', hue: 5 },
  { key: 'mono', label: 'モノクローム', hue: 0, chroma: 0.02 },
];

const SkinEditor = {
  monster: null,
  fighter: null,
  sprite: null,
  materials: [],          // [{ lab, hex, ratio }]
  colors: [],             // materials と同じ長さ。null なら元の色のまま。
  selected: [],           // 選択中の素材の添字
  seedIndex: -1,          // 「広さ」の基準になる素材
  tolerance: 0.25,
  presets: null,
  presetKeys: new Set(),
  view: { scale: 1, x: 0, y: 0 },
  _bound: false,
  _drag: null,
  _hintTimer: null,
  _maskCanvas: null,
  _pickCtx: null,

  // ---- 画面を開く ----
  open(monster) {
    if (!monster) return false;
    const fighter = (window.FIGHTERS || {})[monster.baseFighterKey];
    if (!fighter || !fighter.idleImage) {
      alert('このマスモンの立ち絵が見つかりませんでした');
      return false;
    }
    this.monster = monster;
    this.fighter = fighter;
    this.sprite = null;
    this.presets = null;
    this.materials = [];
    this.colors = [];
    this.selected = [];
    this.seedIndex = -1;
    this._pickCtx = null;
    this._maskCanvas = null;
    this.bind();
    document.getElementById('skin-monster-name').textContent = monster.name || '';
    this.setHint('絵をタップすると、その部分の色を選べます');

    const image = new Image();
    image.onload = () => {
      this.sprite = image;
      this._prepare();
      this.resetView();
      this.render();
    };
    image.onerror = () => alert('立ち絵を読み込めませんでした');
    image.src = fighter.idleImage;
    return true;
  },

  // 立ち絵から素材を取り出し、保存済みのスキンがあれば色を復元する
  _prepare() {
    const c = document.createElement('canvas');
    c.width = this.sprite.naturalWidth;
    c.height = this.sprite.naturalHeight;
    c.getContext('2d').drawImage(this.sprite, 0, 0);
    this._baseCanvas = c;
    this.materials = Skin.extractMaterials(c);
    this.colors = this.materials.map(() => null);

    // 保存済みのスキンを復元する。素材の分け方は同じ絵から同じ手順で出すので
    // 通常はそのまま並び順が一致するが、将来こちらで素材の数を変えても
    // 色が入れ替わらないよう、添字ではなく中心色の近さで割り当て直す。
    const saved = this.monster.skin;
    if (saved && (saved.version === 2 || Array.isArray(saved.materials))) {
      for (const m of saved.materials || []) {
        if (!m || !m.color || !Array.isArray(m.lab)) continue;
        const k = Skin.materialIndexOf(m.lab, this.materials);
        if (k >= 0) this.colors[k] = m.color;
      }
    }
    this._buildPresets();
  },

  // 現在の色から保存用のスキンを作る
  _draft() {
    return {
      version: 2,
      // lab は extractMaterials の時点で保存精度に丸めてあるので、そのまま使う
      materials: this.materials.map((m, i) => ({ lab: m.lab, color: this.colors[i] || null })),
    };
  },

  // プリセット：各素材の色みだけを目標の色相へ寄せる
  _presetSkin(preset) {
    return {
      version: 2,
      materials: this.materials.map(m => {
        const [L, a, b] = m.lab;
        const chroma = preset.chroma != null ? preset.chroma : Math.hypot(a, b);
        // 無彩色（白・黒・灰）は塗らない。目や輪郭まで染まるのを防ぐ。
        if (preset.chroma == null && Math.hypot(a, b) < 0.03) {
          return { lab: m.lab, color: null };
        }
        // 元の色相からの差を縮めて残すので、2色構成のキャラは2色構成のまま変わる
        const own = Math.atan2(b, a) * 180 / Math.PI;
        const lead = Math.atan2(this.materials[0].lab[2], this.materials[0].lab[1]) * 180 / Math.PI;
        const delta = ((own - lead + 540) % 360) - 180;
        const hue = (preset.hue + delta * 0.4) * Math.PI / 180;
        const rgb = Skin.oklabToRgb(L, Math.cos(hue) * chroma, Math.sin(hue) * chroma);
        return { lab: m.lab, color: Skin.rgbToHex(rgb) };
      }),
    };
  },

  _buildPresets() {
    this.presets = SKIN_PRESETS.map(p => ({ ...p, skin: this._presetSkin(p) }));
    this.presetKeys = new Set(['', ...this.presets.map(p => Skin.cacheKey(p.skin))]);
    // 「今の下書きがどのプリセットか」を引くための逆引き。解放済み判定に使う。
    this.presetKeyByCache = new Map(this.presets.map(p => [Skin.cacheKey(p.skin), p.key]));
  },

  // このマスモンで解放済みのプリセット（解放はマスモンごと。色は個体の元の色から
  // 作られるので、同じ「クリムゾン」でも個体によって出る色が違うため）
  _unlockedSet() {
    const set = new Set(this.monster?.unlockedPresets || []);
    // 旧仕様（プリセットは無料）の時に既に着せていた色は、解放済みとして扱う。
    // これが無いと、前から使っていた色に戻すだけで染色セットを要求されてしまう。
    const worn = this.presetKeyByCache?.get(Skin.cacheKey(this.monster?.skin));
    if (worn) set.add(worn);
    return set;
  },

  // 下書きが未解放のプリセットなら、そのプリセットのキーを返す（解放済み/プリセット外はnull）
  _lockedPresetOfDraft() {
    const presetKey = this.presetKeyByCache?.get(Skin.cacheKey(this._draft()));
    if (!presetKey) return null;
    return this._unlockedSet().has(presetKey) ? null : presetKey;
  },

  // ---- 表示（ズーム・移動） ----
  _canvasSize() {
    const canvas = document.getElementById('skin-canvas');
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { canvas, w, h, dpr };
  },

  resetView() {
    const { w, h } = this._canvasSize();
    if (!this.sprite) return;
    const fit = Math.min(w / this.sprite.naturalWidth, h / this.sprite.naturalHeight) * 0.92;
    this.view = {
      scale: fit,
      x: (w - this.sprite.naturalWidth * fit) / 2,
      y: (h - this.sprite.naturalHeight * fit) / 2,
    };
    this.baseScale = fit;
  },

  zoomAt(factor, cx, cy) {
    if (!this.sprite) return;
    const min = (this.baseScale || 1) * 0.5;
    const max = (this.baseScale || 1) * 12;
    const next = Math.max(min, Math.min(max, this.view.scale * factor));
    const k = next / this.view.scale;
    this.view.x = cx - (cx - this.view.x) * k;
    this.view.y = cy - (cy - this.view.y) * k;
    this.view.scale = next;
    this.renderPreview();
  },

  toImagePoint(clientX, clientY) {
    const { canvas, dpr } = this._canvasSize();
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor(((clientX - rect.left) * dpr - this.view.x) / this.view.scale),
      y: Math.floor(((clientY - rect.top) * dpr - this.view.y) / this.view.scale),
    };
  },

  // ---- 描画 ----
  render() {
    if (!this.sprite || !this.presets) return;
    this.renderPreview();
    this.renderMaterials();
    this.renderPresets();
    this.renderFooter();
  },

  renderPreview() {
    const { canvas, w, h } = this._canvasSize();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!this.sprite) return;
    const draft = this._draft();
    const painted = Skin.isEmpty(draft)
      ? this.sprite
      : Skin.apply(this.sprite, draft, `edit:${this.monster.id}`);
    ctx.save();
    ctx.imageSmoothingEnabled = this.view.scale < (this.baseScale || 1) * 1.5;
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.scale, this.view.scale);
    ctx.drawImage(painted, 0, 0);
    // 選択中の範囲を光らせる。塗る前に「どこが変わるか」が必ず見えるようにする。
    if (this._maskCanvas) {
      const pulse = 0.35 + 0.25 * Math.sin(Date.now() / 260);
      ctx.globalAlpha = pulse;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this._maskCanvas, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (this._maskCanvas) {
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this.renderPreview());
    }
  },

  // 選択中の素材から、光らせ用のマスクを作り直す
  _updateMask() {
    if (!this.selected.length || !this._baseCanvas) { this._maskCanvas = null; return; }
    const mask = Skin.selectionMask(this._baseCanvas, this.materials, this.selected);
    if (!mask) { this._maskCanvas = null; return; }
    // 白いままだと眩しいので、黄色く色を付けておく
    const tinted = document.createElement('canvas');
    tinted.width = mask.width; tinted.height = mask.height;
    const g = tinted.getContext('2d');
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#ffe36a';
    g.fillRect(0, 0, tinted.width, tinted.height);
    this._maskCanvas = tinted;
  },

  renderMaterials() {
    const list = document.getElementById('skin-group-list');
    list.innerHTML = this.materials.map((m, i) => {
      const current = this.colors[i] || m.hex;
      const changed = !!this.colors[i];
      const on = this.selected.includes(i);
      return `<button class="skin-group${on ? ' selected' : ''}${changed ? ' changed' : ''}"
        data-material="${i}" style="background:${current}"
        aria-label="素材 ${Math.round(m.ratio * 100)}パーセント"><i>${Math.round(m.ratio * 100)}</i></button>`;
    }).join('');
    const count = this.selected.length;
    document.getElementById('skin-selection-info').textContent = count
      ? `${count}個の素材を選択中（絵の光っている所が変わります）`
      : '絵をタップするか、下の色から選んでください';
    document.getElementById('skin-spread').disabled = this.seedIndex < 0;
  },

  renderPresets() {
    const list = document.getElementById('skin-preset-list');
    const currentKey = Skin.cacheKey(this._draft());
    const unlocked = this._unlockedSet();
    const cell = (key, label, skin, locked) => {
      const stops = (skin.materials || []).map(m => m.color).filter(Boolean).slice(0, 3);
      const use = stops.length ? stops : this.materials.slice(0, 3).map(m => m.hex);
      const bg = use.length > 1
        ? `linear-gradient(135deg, ${use.map((c, i) => `${c} ${Math.round(i * 100 / use.length)}% ${Math.round((i + 1) * 100 / use.length)}%`).join(',')})`
        : use[0] || '#666';
      const on = currentKey === Skin.cacheKey(skin);
      // 未解放は鍵マークと暗い表示で区別する（選ぶこと自体は自由。試着は無料で、
      // 染色セットを使うのは「決定」を押した時だけ）
      return `<button class="skin-preset${on ? ' selected' : ''}${locked ? ' locked' : ''}" data-preset="${key}">
        <span style="background:${bg}"></span><small>${locked ? '🔒' : ''}${label}</small></button>`;
    };
    list.innerHTML = cell('original', 'もとの色', { version: 2, materials: [] }, false) +
      this.presets.map(p => cell(p.key, p.label, p.skin, !unlocked.has(p.key))).join('');
  },

  // 消費の判定：もとの色と「解放済みプリセット」は無料。
  // 未解放プリセットの解放とオリジナルカラーは染色セット1個。
  costOfDraft() {
    const key = Skin.cacheKey(this._draft());
    if (key === '') return 0;                       // もとの色に戻すのは無料
    const presetKey = this.presetKeyByCache.get(key);
    if (presetKey) return this._unlockedSet().has(presetKey) ? 0 : 1;
    return 1;                                        // オリジナルカラー
  },

  renderFooter() {
    const owned = Number((UserProfileStore.data.inventory || {}).dye_kit) || 0;
    document.getElementById('skin-dye-count').textContent = `×${owned}`;
    const cost = this.costOfDraft();
    const changed = Skin.cacheKey(this._draft()) !== Skin.cacheKey(this.monster.skin);
    const label = document.getElementById('skin-cost');
    const confirm = document.getElementById('skin-confirm');
    if (!changed) {
      label.textContent = '変更なし';
      label.classList.remove('warn');
      confirm.disabled = true;
      confirm.textContent = '決定';
      return;
    }
    const lockedPreset = this._lockedPresetOfDraft();
    confirm.disabled = cost > 0 && owned < cost;
    if (cost === 0) {
      label.textContent = '解放済みのいろ：無料';
      label.classList.remove('warn');
      confirm.textContent = '決定';
    } else if (owned >= cost) {
      const name = lockedPreset && this.presets.find(p => p.key === lockedPreset)?.label;
      label.textContent = lockedPreset
        ? `${name}を解放：染色セット1個（次回から無料）`
        : 'オリジナルカラー：染色セット1個';
      label.classList.remove('warn');
      confirm.textContent = lockedPreset ? '解放（1個つかう）' : '決定（1個つかう）';
    } else {
      label.textContent = '染色セットが足りません';
      label.classList.add('warn');
      confirm.textContent = '決定';
    }
  },

  setHint(text) {
    const hint = document.getElementById('skin-hint');
    hint.textContent = text;
    hint.classList.remove('hidden');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => hint.classList.add('hidden'), 3400);
  },

  // ---- 操作 ----
  selectFrom(seedIndex, { additive = false } = {}) {
    if (seedIndex < 0) return;
    this.seedIndex = seedIndex;
    const picked = Skin.relatedMaterials(this.materials, seedIndex, this.tolerance);
    this.selected = additive
      ? [...new Set([...this.selected, ...picked])]
      : picked;
    this._updateMask();
    this.render();
  },

  applyColor(hex) {
    if (!this.selected.length) {
      this.setHint('先に絵をタップして、変えたい所を選んでください');
      return;
    }
    for (const i of this.selected) this.colors[i] = hex;
    this.render();
  },

  pickAt(clientX, clientY, additive) {
    const p = this.toImagePoint(clientX, clientY);
    const W = this.sprite.naturalWidth, H = this.sprite.naturalHeight;
    if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) return;
    if (!this._pickCtx) this._pickCtx = this._baseCanvas.getContext('2d', { willReadFrequently: true });
    const d = this._pickCtx.getImageData(p.x, p.y, 1, 1).data;
    if (d[3] < 40) { this.setHint('そこは透明です。キャラクターの上をタップしてください'); return; }
    const k = Skin.materialIndexOf(Skin.rgbToOklab(d[0], d[1], d[2]), this.materials);
    this.selectFrom(k, { additive });
  },

  confirm() {
    const cost = this.costOfDraft();
    // 消費の前に「何を解放しようとしているか」を控える。決済後に下書きから引き直すと、
    // 解放済みになった時点で null に変わってしまい、記録できない。
    const unlocking = this._lockedPresetOfDraft();
    if (cost > 0 && !UserProfileStore.consumeItem('dye_kit', cost)) {
      this.setHint('虹彩の染色セットが足りません');
      this.renderFooter();
      return;
    }
    if (unlocking) {
      this.monster.unlockedPresets = [...new Set([...(this.monster.unlockedPresets || []), unlocking])];
    }
    const draft = this._draft();
    this.monster.skin = Skin.isEmpty(draft) ? null : draft;
    MasmonStore.update(this.monster);
    Skin.clearCache();
    AppFlow.renderMasmonManage();
    AppFlow.buildFighterList();
    AppFlow._updateHomeProfile();
    AppFlow.showScreen('masmon-manage');
  },

  // ---- 入力 ----
  bind() {
    if (this._bound) return;
    this._bound = true;
    const canvas = document.getElementById('skin-canvas');
    const pointers = new Map();
    let pinchStart = null;

    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: this.view.scale };
        this._drag = null;
        return;
      }
      this._drag = { startX: e.clientX, startY: e.clientY, moved: false, viewX: this.view.x, viewY: this.view.y };
    });

    canvas.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart.dist > 0) {
          const rect = canvas.getBoundingClientRect();
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          this.zoomAt((dist / pinchStart.dist) * pinchStart.scale / this.view.scale,
            ((a.x + b.x) / 2 - rect.left) * dpr, ((a.y + b.y) / 2 - rect.top) * dpr);
        }
        return;
      }
      const d = this._drag;
      if (!d) return;
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      if (Math.hypot(dx, dy) > 6) d.moved = true;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.view.x = d.viewX + dx * dpr;
      this.view.y = d.viewY + dy * dpr;
      this.renderPreview();
    });

    const end = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      const d = this._drag;
      if (!d) return;
      this._drag = null;
      // 動かさずに離した時だけ「タップ」として色を拾う
      if (!d.moved) this.pickAt(e.clientX, e.clientY, this._addMode);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15,
        (e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
    }, { passive: false });

    const center = () => { const { w, h } = this._canvasSize(); return [w / 2, h / 2]; };
    document.getElementById('skin-zoom-in').addEventListener('click', () => this.zoomAt(1.4, ...center()));
    document.getElementById('skin-zoom-out').addEventListener('click', () => this.zoomAt(1 / 1.4, ...center()));
    document.getElementById('skin-zoom-reset').addEventListener('click', () => { this.resetView(); this.renderPreview(); });

    // 「広さ」：同じ布の影やハイライトをどこまで巻き込むか
    const spread = document.getElementById('skin-spread');
    spread.addEventListener('input', () => {
      this.tolerance = Number(spread.value) / 100;
      document.getElementById('skin-spread-value').textContent = `${spread.value}%`;
      if (this.seedIndex >= 0) this.selectFrom(this.seedIndex);
    });

    // 「足して選ぶ」：離れた場所の素材も同じ色にしたい時
    const addBtn = document.getElementById('skin-add-mode');
    addBtn.addEventListener('click', () => {
      this._addMode = !this._addMode;
      addBtn.classList.toggle('active', this._addMode);
      this.setHint(this._addMode ? 'タップした所を選択に足していきます' : '足して選ぶのをやめました');
    });

    document.getElementById('skin-group-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-material]');
      if (btn) this.selectFrom(Number(btn.dataset.material), { additive: this._addMode });
    });

    const palette = document.getElementById('skin-palette');
    palette.innerHTML = SKIN_PALETTE.map(c =>
      `<button class="skin-swatch" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
    palette.addEventListener('click', e => {
      const btn = e.target.closest('[data-color]');
      if (btn) this.applyColor(btn.dataset.color);
    });
    document.getElementById('skin-color-input').addEventListener('input', e => this.applyColor(e.target.value));

    document.getElementById('skin-preset-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-preset]');
      if (!btn) return;
      const preset = this.presets.find(p => p.key === btn.dataset.preset);
      this.colors = this.materials.map((m, i) =>
        preset ? ((preset.skin.materials[i] || {}).color || null) : null);
      this.render();
    });

    document.getElementById('skin-reset').addEventListener('click', () => {
      this.colors = this.materials.map(() => null);
      this.render();
    });
    document.getElementById('skin-confirm').addEventListener('click', () => this.confirm());
  },
};

window.SkinEditor = SkinEditor;

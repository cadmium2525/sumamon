// ==== スキン（色変更）の編集画面 ====
// 設計は docs/skin-design.md を参照。
//
// 塗り替えそのものは js/skin.js が受け持つ。ここは「どの色をどう変えるか」を
// 決めてもらうための画面で、確定するまでマスモンのデータには触らない。
// プレビューは何度でも無料。プリセットも無料。自由色で作った時だけ
// 「虹彩の染色セット」を1個消費する。

// パレットの基本色。色相をひと回りぶんと、無彩色を用意する。
const SKIN_PALETTE = [
  '#e01818', '#e06a18', '#e0b418', '#b4e018',
  '#38d048', '#28c8a0', '#28b4e0', '#2864e0',
  '#6a38e0', '#a828e0', '#e028b4', '#e02868',
  '#ffffff', '#b4b4bc', '#606874', '#1c1c24',
];

// プリセット。モンスターごとの色から作るので、スタジオで後から足した
// モンスターにも自動で用意される。
// hue: 目標の色相 / sat: 彩度を固定する場合のみ指定
const SKIN_PRESETS = [
  { key: 'crimson', label: 'クリムゾン', hue: 0 },
  { key: 'amber', label: 'アンバー', hue: 38 },
  { key: 'verdant', label: 'ヴェルダン', hue: 132 },
  { key: 'azure', label: 'アズール', hue: 205 },
  { key: 'violet', label: 'ヴァイオレット', hue: 285 },
  { key: 'rose', label: 'ローズ', hue: 330 },
  { key: 'mono', label: 'モノクローム', hue: 0, sat: 0.05 },
];

const SkinEditor = {
  monster: null,
  fighter: null,
  sprite: null,          // 元の立ち絵（Image）
  groups: [],            // [{ key, ratio, sample, hex }] 元の色
  draft: { groups: {}, splits: [] },
  selectedGroup: null,
  selectedSplit: -1,     // draft.splits の添字。-1 なら未選択
  splitMode: false,
  presetKeys: new Set(), // 無料で確定できる（プリセットと一致する）内容のキー
  view: { scale: 1, x: 0, y: 0 },
  _bound: false,
  _drag: null,
  _hintTimer: null,

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
    // 前に開いたモンスターの絵・色を残さない
    this.sprite = null;
    this.presets = null;
    this.groups = [];
    this._pickCtx = null;
    this.bind();
    document.getElementById('skin-monster-name').textContent = monster.name || '';
    this.setHint('絵をタップすると、その色のなかまを選べます');

    // 元の色に戻せるよう、編集中は控えを持つ
    this.draft = this._clone(monster.skin) || { groups: {}, splits: [] };
    this.selectedGroup = null;
    this.selectedSplit = -1;
    this.splitMode = false;

    const image = new Image();
    image.onload = () => {
      this.sprite = image;
      this._extractGroups();
      this._buildPresets();
      this.resetView();
      this.render();
    };
    image.onerror = () => alert('立ち絵を読み込めませんでした');
    image.src = fighter.idleImage;
    return true;
  },

  _clone(skin) {
    if (!skin) return null;
    return {
      groups: { ...(skin.groups || {}) },
      splits: (skin.splits || []).map(s => ({ key: s.key, rect: { ...s.rect }, color: s.color })),
    };
  },

  // 立ち絵から色のなかまを取り出す。
  // 色相でまとめているため、ここで得たキーは他のコマ画像にもそのまま通じる。
  _extractGroups() {
    const c = document.createElement('canvas');
    c.width = this.sprite.naturalWidth;
    c.height = this.sprite.naturalHeight;
    c.getContext('2d').drawImage(this.sprite, 0, 0);
    this.groups = Skin.extractGroups(c, { limit: 10, minRatio: 0.004 });
  },

  // プリセットをこのモンスターの色から作る。
  // 「一番多い色」との色相の差を縮めて残すので、2色構成のキャラは2色構成のまま変わる。
  _presetSkin(preset) {
    const colored = this.groups.filter(g => g.key.startsWith('hue'));
    if (!colored.length) return { groups: {}, splits: [] };
    const baseHue = Skin.rgbToHsl(...colored[0].sample)[0];
    const groups = {};
    for (const g of colored) {
      const [h, s] = Skin.rgbToHsl(...g.sample);
      let delta = ((h - baseHue + 540) % 360) - 180;   // -180〜180 に畳む
      const hue = preset.hue + delta * 0.35;           // 色の差は残しつつ寄せる
      const sat = preset.sat != null ? preset.sat : Math.max(0.25, Math.min(1, s));
      groups[g.key] = Skin.rgbToHex(Skin.hslToRgb(hue, sat, 0.5));
    }
    // 無彩色（白・黒・灰）はそのまま。目や輪郭まで染まらないようにする。
    return { groups, splits: [] };
  },

  _buildPresets() {
    this.presets = SKIN_PRESETS.map(p => ({ ...p, skin: this._presetSkin(p) }));
    // 「無料で確定できる内容」の一覧。元の色（空）もここに含める。
    this.presetKeys = new Set(['', ...this.presets.map(p => Skin.cacheKey(p.skin))]);
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
    // 指（または画面中央）の下にある点が動かないように寄せる
    this.view.x = cx - (cx - this.view.x) * k;
    this.view.y = cy - (cy - this.view.y) * k;
    this.view.scale = next;
    this.render();
  },

  // 画面上の座標 → 元画像のピクセル座標
  toImagePoint(clientX, clientY) {
    const { canvas, dpr } = this._canvasSize();
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * dpr;
    const y = (clientY - rect.top) * dpr;
    return {
      x: Math.floor((x - this.view.x) / this.view.scale),
      y: Math.floor((y - this.view.y) / this.view.scale),
    };
  },

  // ---- 描画 ----
  render() {
    // 立ち絵の読み込みが終わるまでは、まだ色のなかまもプリセットも無い
    if (!this.sprite || !this.presets) return;
    this.renderPreview();
    this.renderGroups();
    this.renderSplits();
    this.renderPresets();
    this.renderFooter();
  },

  renderPreview() {
    const { canvas, w, h } = this._canvasSize();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!this.sprite) return;
    const painted = Skin.isEmpty(this.draft)
      ? this.sprite
      : Skin.apply(this.sprite, this.draft, `edit:${this.monster.id}`);
    ctx.save();
    // 拡大したときは、どの点が何色か分かるよう補間を切る
    ctx.imageSmoothingEnabled = this.view.scale < (this.baseScale || 1) * 1.5;
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.scale, this.view.scale);
    ctx.drawImage(painted, 0, 0);

    // 範囲でわけた所を枠で示す
    ctx.lineWidth = Math.max(1, 2 / this.view.scale);
    this.draft.splits.forEach((split, index) => {
      ctx.strokeStyle = index === this.selectedSplit ? '#ffe36a' : 'rgba(255,255,255,.55)';
      ctx.setLineDash(index === this.selectedSplit ? [] : [6 / this.view.scale, 4 / this.view.scale]);
      ctx.strokeRect(split.rect.x, split.rect.y, split.rect.w, split.rect.h);
    });
    // 範囲を指定している最中
    if (this._drag && this._drag.rect) {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ffe36a';
      const r = this._drag.rect;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
  },

  renderGroups() {
    const list = document.getElementById('skin-group-list');
    if (!this.groups.length) { list.innerHTML = ''; return; }
    list.innerHTML = this.groups.map(g => {
      const current = this.draft.groups[g.key] || g.hex;
      const changed = !!this.draft.groups[g.key];
      const selected = this.selectedGroup === g.key && this.selectedSplit < 0;
      return `<button class="skin-group${selected ? ' selected' : ''}${changed ? ' changed' : ''}"
        data-group="${g.key}" style="background:${current}"
        aria-label="色のなかま ${Math.round(g.ratio * 100)}パーセント"><i>${Math.round(g.ratio * 100)}</i></button>`;
    }).join('');
  },

  renderSplits() {
    const section = document.getElementById('skin-split-section');
    const list = document.getElementById('skin-split-list');
    section.classList.toggle('hidden', !this.draft.splits.length);
    list.innerHTML = this.draft.splits.map((s, i) => `
      <div class="skin-split-row${i === this.selectedSplit ? ' selected' : ''}" data-split="${i}">
        <span class="skin-split-chip" style="background:${s.color}"></span>
        <small>${s.rect.w}×${s.rect.h}</small>
        <button class="skin-split-del" data-split-del="${i}" aria-label="この範囲を消す">×</button>
      </div>`).join('');
  },

  renderPresets() {
    const list = document.getElementById('skin-preset-list');
    const currentKey = Skin.cacheKey(this.draft);
    const chip = skin => {
      const colors = Object.values(skin.groups || {}).slice(0, 3);
      if (!colors.length) return this.groups.slice(0, 3).map(g => g.hex);
      return colors;
    };
    const cell = (key, label, skin) => {
      const stops = chip(skin);
      const bg = stops.length > 1
        ? `linear-gradient(135deg, ${stops.map((c, i) => `${c} ${Math.round(i * 100 / stops.length)}% ${Math.round((i + 1) * 100 / stops.length)}%`).join(',')})`
        : stops[0] || '#666';
      const on = currentKey === Skin.cacheKey(skin);
      return `<button class="skin-preset${on ? ' selected' : ''}" data-preset="${key}">
        <span style="background:${bg}"></span><small>${label}</small></button>`;
    };
    list.innerHTML = cell('original', 'もとの色', { groups: {}, splits: [] }) +
      this.presets.map(p => cell(p.key, p.label, p.skin)).join('');
  },

  // 消費の判定：プリセットと元の色は無料、それ以外は染色セット1個
  costOfDraft() {
    return this.presetKeys.has(Skin.cacheKey(this.draft)) ? 0 : 1;
  },

  renderFooter() {
    const owned = Number((UserProfileStore.data.inventory || {}).dye_kit) || 0;
    document.getElementById('skin-dye-count').textContent = `×${owned}`;
    const cost = this.costOfDraft();
    const changed = Skin.cacheKey(this.draft) !== Skin.cacheKey(this.monster.skin);
    const label = document.getElementById('skin-cost');
    const confirm = document.getElementById('skin-confirm');
    if (!changed) {
      label.textContent = '変更なし';
      label.classList.remove('warn');
      confirm.disabled = true;
      confirm.textContent = '決定';
      return;
    }
    confirm.disabled = cost > 0 && owned < cost;
    if (cost === 0) {
      label.textContent = 'このいろは無料';
      label.classList.remove('warn');
      confirm.textContent = '決定';
    } else if (owned >= cost) {
      label.textContent = `オリジナルカラー：染色セット1個`;
      label.classList.remove('warn');
      confirm.textContent = '決定（1個つかう）';
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
    this._hintTimer = setTimeout(() => hint.classList.add('hidden'), 3200);
  },

  // ---- 操作 ----
  // 選んでいる対象（色のなかま or わけた範囲）に色を塗る
  applyColor(hex) {
    if (this.selectedSplit >= 0 && this.draft.splits[this.selectedSplit]) {
      this.draft.splits[this.selectedSplit].color = hex;
      this.render();
      return;
    }
    if (!this.selectedGroup) {
      this.setHint('先に絵をタップして、変えたい色を選んでください');
      return;
    }
    this.draft.groups[this.selectedGroup] = hex;
    this.render();
  },

  pickAt(clientX, clientY) {
    const p = this.toImagePoint(clientX, clientY);
    const W = this.sprite.naturalWidth, H = this.sprite.naturalHeight;
    if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) return;
    if (!this._pickCtx) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      c.getContext('2d').drawImage(this.sprite, 0, 0);
      this._pickCtx = c.getContext('2d', { willReadFrequently: true });
    }
    const d = this._pickCtx.getImageData(p.x, p.y, 1, 1).data;
    if (d[3] < 40) { this.setHint('そこは透明です。キャラクターの上をタップしてください'); return; }
    const key = Skin.groupKeyOf(d[0], d[1], d[2]);
    // 抽出した一覧に無い（占有率の低い）色を拾った場合は一覧に足す
    if (!this.groups.some(g => g.key === key)) {
      this.groups.push({ key, ratio: 0, sample: [d[0], d[1], d[2]], hex: Skin.rgbToHex([d[0], d[1], d[2]]) });
    }
    // 範囲でわけた所をタップしたら、そちらを選ぶ
    const hitSplit = this.draft.splits.findIndex(s =>
      s.key === key && p.x >= s.rect.x && p.y >= s.rect.y &&
      p.x < s.rect.x + s.rect.w && p.y < s.rect.y + s.rect.h);
    this.selectedSplit = hitSplit;
    this.selectedGroup = key;
    this.render();
  },

  addSplit(rect) {
    if (!this.selectedGroup) {
      this.setHint('先に絵をタップして、わけたい色を選んでください');
      return;
    }
    if (rect.w < 3 || rect.h < 3) return;
    const color = this.draft.groups[this.selectedGroup] ||
      (this.groups.find(g => g.key === this.selectedGroup) || {}).hex || '#ffffff';
    this.draft.splits.push({ key: this.selectedGroup, rect, color });
    this.selectedSplit = this.draft.splits.length - 1;
    this.splitMode = false;
    document.getElementById('skin-split-toggle').classList.remove('active');
    this.setHint('この範囲だけ別の色にできます。パレットから色を選んでください');
    this.render();
  },

  confirm() {
    const cost = this.costOfDraft();
    if (cost > 0 && !UserProfileStore.consumeItem('dye_kit', cost)) {
      this.setHint('虹彩の染色セットが足りません');
      this.renderFooter();
      return;
    }
    this.monster.skin = Skin.isEmpty(this.draft) ? null : this._clone(this.draft);
    MasmonStore.update(this.monster);
    // 塗り替え済みの絵を作り直させる（前の色を掴んだままにしない）
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

    // 1本指はドラッグで移動・タップで色選び、2本指はつまんで拡大縮小
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
      const p = this.toImagePoint(e.clientX, e.clientY);
      this._drag = {
        startX: e.clientX, startY: e.clientY, moved: false,
        viewX: this.view.x, viewY: this.view.y,
        imgX: p.x, imgY: p.y,
        rect: this.splitMode ? { x: p.x, y: p.y, w: 0, h: 0 } : null,
      };
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
          const cx = ((a.x + b.x) / 2 - rect.left) * dpr;
          const cy = ((a.y + b.y) / 2 - rect.top) * dpr;
          this.zoomAt((dist / pinchStart.dist) * pinchStart.scale / this.view.scale, cx, cy);
        }
        return;
      }
      const d = this._drag;
      if (!d) return;
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      if (Math.hypot(dx, dy) > 6) d.moved = true;
      if (d.rect) {
        const p = this.toImagePoint(e.clientX, e.clientY);
        d.rect = {
          x: Math.min(d.imgX, p.x), y: Math.min(d.imgY, p.y),
          w: Math.abs(p.x - d.imgX), h: Math.abs(p.y - d.imgY),
        };
        this.renderPreview();
        return;
      }
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
      if (d.rect && d.moved) { this.addSplit(d.rect); return; }
      if (!d.moved) this.pickAt(e.clientX, e.clientY);
      else this.render();
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

    const center = () => {
      const { w, h } = this._canvasSize();
      return [w / 2, h / 2];
    };
    document.getElementById('skin-zoom-in').addEventListener('click', () => this.zoomAt(1.4, ...center()));
    document.getElementById('skin-zoom-out').addEventListener('click', () => this.zoomAt(1 / 1.4, ...center()));
    document.getElementById('skin-zoom-reset').addEventListener('click', () => { this.resetView(); this.render(); });

    document.getElementById('skin-group-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-group]');
      if (!btn) return;
      this.selectedGroup = btn.dataset.group;
      this.selectedSplit = -1;
      this.render();
    });

    document.getElementById('skin-split-list').addEventListener('click', e => {
      const del = e.target.closest('[data-split-del]');
      if (del) {
        this.draft.splits.splice(Number(del.dataset.splitDel), 1);
        this.selectedSplit = -1;
        this.render();
        return;
      }
      const row = e.target.closest('[data-split]');
      if (!row) return;
      this.selectedSplit = Number(row.dataset.split);
      this.selectedGroup = this.draft.splits[this.selectedSplit].key;
      this.render();
    });

    document.getElementById('skin-split-toggle').addEventListener('click', e => {
      this.splitMode = !this.splitMode;
      e.currentTarget.classList.toggle('active', this.splitMode);
      this.setHint(this.splitMode
        ? '絵の上をなぞって、別の色にしたい範囲を囲んでください'
        : '範囲の指定をやめました');
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
      const key = btn.dataset.preset;
      const preset = this.presets.find(p => p.key === key);
      this.draft = preset ? this._clone(preset.skin) : { groups: {}, splits: [] };
      this.selectedSplit = -1;
      this.render();
    });

    document.getElementById('skin-reset').addEventListener('click', () => {
      this.draft = { groups: {}, splits: [] };
      this.selectedSplit = -1;
      this.render();
    });
    document.getElementById('skin-confirm').addEventListener('click', () => this.confirm());
  },
};

window.SkinEditor = SkinEditor;

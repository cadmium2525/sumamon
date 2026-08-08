// ==== モンスター作成スタジオ：画面制御 ====
const Studio = {
  motions: {},           // slot -> { canvases, used, contentBox, frameDuration, options }
  projectiles: {},       // slot -> 飛び道具の設定
  projectileImages: {},  // slot -> 飛び道具の画像
  existing: {},          // 本番に既に登録済みのモーション
  attacks: {},           // slot -> { use, hitFrames, manual }
  frameMode: 'use',      // コマ一覧のタップが「使うコマ」か「判定コマ」か
  weapon: {},            // 武器レイヤー { rect, pivot }
  weaponMode: 'rect',    // プレビュー上のドラッグが「囲む」か「握り指定」か
  dropperOn: false,      // スポイトで背景色を拾うモード
  parts: {},             // パーツ分割 { neckY, hipY, legSplitX, overlap }
  partsPose: 'stand',    // プレビューの姿勢
  fightersJson: null,
  movesetsJson: null,
  editing: null,
  playTimer: null,
  playIndex: 0,

  el(id) { return document.getElementById(id); },

  init() {
    const settings = StudioGitHub.loadSettings();
    this.el('gh-token').value = settings.token;
    this.el('gh-repo').value = settings.repo;
    this.el('gh-branch').value = settings.branch;

    this.el('gh-save').addEventListener('click', () => this.connect());
    this.el('gh-clear').addEventListener('click', () => {
      StudioGitHub.clearToken();
      this.el('gh-token').value = '';
      this.setStatus('gh-state', 'info', 'トークンを消しました');
    });
    this.el('spec-mode').addEventListener('change', () => this.onModeChange());
    this.el('spec-existing').addEventListener('change', () => this.loadExisting());
    this.el('spec-key').addEventListener('input', () => this.refreshExistingMotions());
    this.el('spec-fall').addEventListener('input', () => this.refreshFallLabel());
    this.el('spec-jump').addEventListener('input', () => this.refreshJumpLabel());
    this.el('spec-proc-intensity').addEventListener('input', () => this.refreshProcLabel());
    this.bindWeapon();
    this.bindParts();
    this.bindMovePower();
    this.bindSheet();
    this.bindPreview();
    this.el('btn-diff').addEventListener('click', () => this.showDiff());
    this.el('btn-commit').addEventListener('click', () => this.commit());

    this.buildAptitudes();
    this.buildMotionList();
    this.bindEditor();
    this.bindProjectile();
    this.bindAttack();
    this.bindDropper();
    StudioMaskEditor.bind();
    if (settings.token) this.connect();
  },

  // 落下速度はモンスターごとの個性（育成では変わらない）。倍率で表示する。
  refreshFallLabel() {
    const value = (Number(this.el('spec-fall').value) || 100) / 100;
    this.el('spec-fall-value').textContent = value.toFixed(2);
  },

  // ジャンプ力も同じくモンスターごとの個性。倍率だけでは高さの感覚が掴めないので、
  // ゲーム側と同じ式（高さ = 初速^2 / 2g）で実際に跳ぶ高さ(px)も併記する。
  // ゲーム側の基準値: JUMP_POWER=-9.75 / GRAVITY=0.25
  refreshJumpLabel() {
    const value = (Number(this.el('spec-jump').value) || 100) / 100;
    this.el('spec-jump-value').textContent = value.toFixed(2);
    const velocity = 9.75 * value;
    this.el('spec-jump-height').textContent = Math.round(velocity * velocity / (2 * 0.25));
  },

  // ---- モーションの確認 ----
  // 登録済み・読み込み済みのどちらも再生でき、まだ用意していない技については
  // 「自動モーション」「体の切り分け」でどう動くかを先に見られるようにする。
  previewSlot: null,

  bindPreview() {
    this.el('pv-close').addEventListener('click', () => {
      StudioPreview.stop();
      this.el('preview').classList.add('hidden');
    });
    this.el('pv-play').addEventListener('click', () => {
      StudioPreview.setPlaying(!StudioPreview.playing);
      this.el('pv-play').textContent = StudioPreview.playing ? '停止' : '再生';
    });
    this.el('pv-slot').innerHTML = STUDIO_MOTIONS.filter(m => !m.single)
      .map(m => `<option value="${m.slot}">${m.name}</option>`).join('');
    this.el('pv-slot').addEventListener('change', () => this.openPreview(this.el('pv-slot').value));
    for (const kind of ['frames', 'auto']) {
      this.el(`pv-kind-${kind}`).addEventListener('click', () => {
        this.previewKind = kind;
        ['frames', 'auto'].forEach(k => this.el(`pv-kind-${k}`).classList.toggle('seg-on', k === kind));
        this.el('pv-auto-fields').classList.toggle('hidden', kind !== 'auto');
        this.renderPreview();
      });
    }
    this.el('pv-parts').addEventListener('change', () => this.renderPreview());
    this.el('pv-intensity').addEventListener('input', () => {
      this.el('pv-intensity-value').textContent = this.el('pv-intensity').value;
      this.renderPreview();
    });
    StudioPreview.init(this.el('pv-canvas'));
  },

  previewKind: 'frames',

  openPreview(slot) {
    this.previewSlot = slot;
    const motion = STUDIO_MOTIONS.find(m => m.slot === slot);
    this.el('preview').classList.remove('hidden');
    this.el('pv-title').textContent = `${motion ? motion.name : slot} の動き`;
    this.el('pv-slot').value = slot;
    // 専用モーションが無いスロットは、最初から自動モーションの確認を見せる
    const hasFrames = this._previewFrames(slot).length > 0;
    this.previewKind = hasFrames ? 'frames' : 'auto';
    ['frames', 'auto'].forEach(k => this.el(`pv-kind-${k}`).classList.toggle('seg-on', k === this.previewKind));
    this.el('pv-auto-fields').classList.toggle('hidden', this.previewKind !== 'auto');
    this.el('pv-kind-frames').disabled = !hasFrames;
    this.el('pv-parts').checked = !!(this.el('spec-parts').checked && this._readParts());
    this.el('pv-intensity').value = Math.round((Number(this.el('spec-proc-intensity').value) || 100));
    this.el('pv-intensity-value').textContent = this.el('pv-intensity').value;
    StudioPreview.setPlaying(true);
    this.el('pv-play').textContent = '停止';
    this.renderPreview();
  },

  // 再生に使うコマ。編集中のものを優先し、無ければ登録済みのものを使う。
  _previewFrames(slot) {
    const entry = this.motions[slot];
    if (entry && entry.canvases && entry.canvases.length) {
      return entry.canvases.filter((_, i) => entry.used[i]);
    }
    const already = (this.existing || {})[slot];
    return (already && already.srcs) ? already.srcs : [];
  },

  async renderPreview() {
    const slot = this.previewSlot;
    if (!slot) return;
    const state = this.el('pv-state');
    const info = this.el('pv-info');
    if (this.previewKind === 'frames') {
      const frames = this._previewFrames(slot);
      const entry = this.motions[slot];
      const already = (this.existing || {})[slot];
      const duration = entry ? entry.frameDuration : (already && already.duration) || 6;
      const ok = await StudioPreview.playFrames(frames, duration);
      state.textContent = ok
        ? `${frames.length}コマ／1コマ${duration}フレーム${entry ? '（編集中のもの）' : '（登録済みのもの）'}`
        : 'コマを読み込めませんでした';
      info.textContent = '線は地面です。足元が線から離れていないか確認してください。';
      return;
    }
    // 自動モーションの確認には立ち絵が要る
    const sprite = await this._previewSprite();
    if (!sprite) {
      state.textContent = '待機モーションか立ち絵がまだありません。先に待機を用意してください。';
      StudioPreview.stop();
      return;
    }
    const parts = this.el('pv-parts').checked ? this._readParts() : null;
    const intensity = (Number(this.el('pv-intensity').value) || 0) / 100;
    await StudioPreview.playProcedural(sprite, slot, {
      parts, intensity, enabled: this.el('spec-proc').checked,
    });
    state.textContent = `専用モーションが無い場合の動き（強さ ${this.el('pv-intensity').value}%${parts ? '・切り分けあり' : ''}）`;
    info.textContent = parts
      ? '頭・胴・左右の脚を付け根で振っています。継ぎ目が見えないか確認してください。'
      : '立ち絵を上下動・傾き・伸び縮みで動かしています。「体を切り分けて動かす」を入れると脚が振れます。';
  },

  // 自動モーションの土台になる立ち絵。編集中の待機 → 登録済みの立ち絵 の順に探す。
  async _previewSprite() {
    const idle = this.motions.idle;
    if (idle && idle.canvases && idle.canvases.length) return idle.canvases[0];
    if (this._existingIdleCanvas) return this._existingIdleCanvas;
    const key = (this.el('spec-key').value || '').trim();
    const fighter = this.fightersJson && this.fightersJson[key];
    const src = fighter && (((fighter.animations || {}).idle || {}).frames || [])[0] || (fighter && fighter.idleImage);
    return src ? StudioPreview.loadImage(src) : null;
  },

  // ---- スプライトシートの取り込み ----
  // 1枚に並んだコマを切り出してモーションにする。分け方は自動で選び、
  // 外していた時だけ手で切り替えられるようにする（見ないと正解が分からないため）。
  sheet: null,   // { canvas, rects, used[], mode }

  bindSheet() {
    this.el('sheet-file').addEventListener('change', async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      this.el('sheet-info').textContent = '読み込み中…';
      try {
        const canvas = await StudioImage.load(file);
        this.sheet = { canvas, rects: [], used: [], mode: 'auto' };
        this.detectSheet();
      } catch (error) {
        this.el('sheet-info').textContent = String(error.message || error);
      }
    });

    for (const mode of ['auto', 'line', 'grid']) {
      this.el(`sheet-mode-${mode}`).addEventListener('click', () => {
        if (!this.sheet) return;
        this.sheet.mode = mode;
        ['auto', 'line', 'grid'].forEach(m =>
          this.el(`sheet-mode-${m}`).classList.toggle('seg-on', m === mode));
        this.el('sheet-grid-fields').classList.toggle('hidden', mode !== 'grid');
        this.detectSheet({ keepMode: true });
      });
    }
    ['sheet-rows', 'sheet-cols', 'sheet-margin', 'sheet-gutter'].forEach(id =>
      this.el(id).addEventListener('input', () => this.detectSheet({ keepMode: true })));
    this.el('sheet-tol').addEventListener('input', () => {
      this.el('sheet-tol-value').textContent = this.el('sheet-tol').value;
      this.detectSheet({ keepMode: true });
    });

    // プレビューをタップして、使わないコマを外す
    this.el('sheet-preview').addEventListener('click', event => {
      if (!this.sheet || !this.sheet.rects.length) return;
      const hit = this._sheetCellAt(event);
      if (hit < 0) return;
      this.sheet.used[hit] = !this.sheet.used[hit];
      this.drawSheetPreview();
    });

    this.el('sheet-apply').addEventListener('click', () => this.applySheet());
  },

  // 切り出したコマの背景を、編集画面の設定で先に抜く。
  // 足元合わせも不良コマの検出も「中身がどこにあるか」を見るため、
  // 背景が不透明なままだと全面が中身になってしまい何も判定できない。
  _sheetCutsTransparent(rects) {
    const cuts = StudioSheet.cut(this.sheet.canvas, rects);
    const mode = this.el('ed-bgmode').value;
    if (mode === 'none') return cuts;
    const threshold = Number(this.el('ed-threshold').value);
    return cuts.map(c => {
      try { return StudioImage.removeBackground(c, { mode, threshold }); }
      catch (e) { return c; }
    });
  },

  detectSheet({ keepMode = false } = {}) {
    const sheet = this.sheet;
    if (!sheet) return;
    const tolerance = Number(this.el('sheet-tol').value) || 12;
    if (!keepMode) {
      // 初回はいちばん妥当な分け方を自動で選ぶ
      const best = StudioSheet.analyze(sheet.canvas, { tolerance });
      sheet.mode = best.mode;
      ['auto', 'line', 'grid'].forEach(m =>
        this.el(`sheet-mode-${m}`).classList.toggle('seg-on', m === sheet.mode));
      this.el('sheet-grid-fields').classList.toggle('hidden', sheet.mode !== 'grid');
    }
    if (sheet.mode === 'grid') {
      sheet.rects = StudioSheet.gridRects(sheet.canvas, {
        rows: Number(this.el('sheet-rows').value) || 1,
        cols: Number(this.el('sheet-cols').value) || 1,
        margin: Number(this.el('sheet-margin').value) || 0,
        gutter: Number(this.el('sheet-gutter').value) || 0,
      });
    } else if (sheet.mode === 'line') {
      sheet.rects = StudioSheet.lineRects(sheet.canvas, { tolerance });
    } else {
      sheet.rects = StudioSheet.autoRects(sheet.canvas, { tolerance });
    }
    sheet.used = sheet.rects.map(() => true);
    // 潰れているコマ・空のコマは、最初から外しておいて理由を伝える
    const cuts = this._sheetCutsTransparent(sheet.rects);
    sheet.outliers = StudioSheet.findOutliers(cuts);
    for (const o of sheet.outliers) sheet.used[o.index] = false;
    this.drawSheetPreview();
  },

  _sheetMap: null,
  _sheetCellAt(event) {
    const map = this._sheetMap;
    if (!map) return -1;
    const canvas = this.el('sheet-preview');
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);
    const ix = (x - map.dx) / map.scale, iy = (y - map.dy) / map.scale;
    return this.sheet.rects.findIndex(r =>
      ix >= r.x && iy >= r.y && ix < r.x + r.w && iy < r.y + r.h);
  },

  drawSheetPreview() {
    const sheet = this.sheet;
    const canvas = this.el('sheet-preview');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sheet) return;
    const scale = Math.min(canvas.width / sheet.canvas.width, canvas.height / sheet.canvas.height);
    const dw = sheet.canvas.width * scale, dh = sheet.canvas.height * scale;
    const dx = (canvas.width - dw) / 2, dy = (canvas.height - dh) / 2;
    this._sheetMap = { scale, dx, dy };
    ctx.drawImage(sheet.canvas, dx, dy, dw, dh);
    let order = 0;
    sheet.rects.forEach((r, i) => {
      const on = sheet.used[i];
      ctx.lineWidth = 2;
      ctx.strokeStyle = on ? '#ffd45e' : 'rgba(255,120,110,.85)';
      ctx.strokeRect(dx + r.x * scale, dy + r.y * scale, r.w * scale, r.h * scale);
      if (!on) {
        ctx.fillStyle = 'rgba(180,40,30,.35)';
        ctx.fillRect(dx + r.x * scale, dy + r.y * scale, r.w * scale, r.h * scale);
      } else {
        order++;
        ctx.fillStyle = '#ffd45e';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(String(order), dx + r.x * scale + 3, dy + r.y * scale + 12);
      }
    });
    const count = sheet.used.filter(Boolean).length;
    const modeLabel = { auto: '自動', line: '線で分ける', grid: '等間隔' }[sheet.mode];
    let info = `${modeLabel}で${sheet.rects.length}コマに分けました。使うのは${count}コマです。`;
    if (sheet.outliers && sheet.outliers.length) {
      info += `<br>外したコマ: ${sheet.outliers.map(o => `${o.index + 1}番（${o.reason}）`).join('、')}`;
    }
    if (!sheet.rects.length) info = 'コマを見つけられませんでした。分け方を切り替えるか、細かさを変えてください。';
    this.el('sheet-info').innerHTML = info;
    this.el('sheet-apply').disabled = count < 1;
  },

  applySheet() {
    const sheet = this.sheet;
    if (!sheet || !this.editing) return;
    const rects = sheet.rects.filter((_, i) => sheet.used[i]);
    if (!rects.length) return;
    // 元のまま切り出したコマを「素材」として持つ。
    // 以前はここで背景を抜いた結果を素材にしていたため、取り込んだあとに
    // しきい値を変えたりコマごとに抜き方を変えたりできなくなっていた。
    let sources = StudioSheet.cut(sheet.canvas, rects);
    if (this.el('sheet-align').checked) {
      // 足元の測定だけは背景を抜いた版で行う（不透明なままだと中身の位置が分からない）
      const guides = this._sheetCutsTransparent(rects);
      sources = StudioSheet.alignFeet(sources, { guides });
    }
    delete this.attacks[this.editing.slot];
    this.motions[this.editing.slot] = {
      sources,
      canvases: [],
      used: sources.map(() => true),
      frameOptions: sources.map(() => null),
      masks: sources.map(() => null),
      frameDuration: Number(this.el('ed-duration').value),
      options: { mode: this.el('ed-bgmode').value, threshold: Number(this.el('ed-threshold').value) },
    };
    this.processFrames();
    this.el('sheet-info').textContent = `${sources.length}コマを取り込みました。下のコマ一覧で確認してください。`;
  },

  // ---- 技の強さ（モンスターごとの倍率） ----
  // ゲーム側の共通の技表(js/moves.js)を基準に、ダメージと吹っ飛ばしを倍率で上書きする。
  // 絶対値ではなく倍率にしてあるので、あとで共通のバランスを直しても
  // 各モンスターの「この技が得意」という個性は保たれる。
  MOVE_POWER_GROUPS: {
    smash:   { label: 'スマッシュ', moves: { side: '横スマ', up: '上スマ', down: '下スマ' } },
    ground:  { label: '地上', moves: { neutral: '弱A', side: '横強', up: '上強', down: '下強', dashAttack: 'ダッシュ攻撃' } },
    air:     { label: '空中', moves: { neutral: '空N', forward: '空前', back: '空後', up: '空上', down: '空下' } },
    special: { label: '必殺', moves: { neutral: '通常必殺', side: '横必殺', up: '上必殺', down: '下必殺' } },
  },

  movePower: {},          // { 'smash.side': { dmg: 1.3, kb: 1.25 } }
  movePowerTab: 'smash',

  bindMovePower() {
    for (const group of Object.keys(this.MOVE_POWER_GROUPS)) {
      this.el(`mp-tab-${group}`).addEventListener('click', () => {
        this.movePowerTab = group;
        for (const g of Object.keys(this.MOVE_POWER_GROUPS)) {
          this.el(`mp-tab-${g}`).classList.toggle('seg-on', g === group);
        }
        this.renderMovePower();
      });
    }
    this.el('mp-reset').addEventListener('click', () => {
      for (const key of Object.keys(this.movePower)) {
        if (key.startsWith(this.movePowerTab + '.')) delete this.movePower[key];
      }
      this.renderMovePower();
    });
    this.el('mp-reset-all').addEventListener('click', () => {
      this.movePower = {};
      this.renderMovePower();
    });
    this.el('move-power-list').addEventListener('input', event => {
      const input = event.target.closest('[data-move]');
      if (!input) return;
      const key = input.dataset.move;
      const kind = input.dataset.kind;          // 'dmg' | 'kb'
      const value = Number(input.value) / 100;
      const entry = this.movePower[key] || { dmg: 1, kb: 1 };
      entry[kind] = value;
      // 両方100%に戻したら記録ごと消す（保存データを増やさない）
      if (Math.abs(entry.dmg - 1) < 0.005 && Math.abs(entry.kb - 1) < 0.005) delete this.movePower[key];
      else this.movePower[key] = entry;
      this.renderMovePower();
    });
    this.renderMovePower();
  },

  // 保存用に整える。標準（等倍）の技は書き出さないので、JSONは変えた技のぶんだけ増える。
  _readMovePower() {
    const out = {};
    for (const [key, value] of Object.entries(this.movePower)) {
      const entry = {};
      if (Math.abs(value.dmg - 1) >= 0.005) entry.dmg = Number(value.dmg.toFixed(2));
      if (Math.abs(value.kb - 1) >= 0.005) entry.kb = Number(value.kb.toFixed(2));
      if (Object.keys(entry).length) out[key] = entry;
    }
    return Object.keys(out).length ? out : null;
  },

  renderMovePower() {
    const group = this.MOVE_POWER_GROUPS[this.movePowerTab];
    const list = this.el('move-power-list');
    list.innerHTML = Object.entries(group.moves).map(([moveKey, label]) => {
      const key = `${this.movePowerTab}.${moveKey}`;
      const entry = this.movePower[key] || { dmg: 1, kb: 1 };
      const dmg = Math.round(entry.dmg * 100);
      const kb = Math.round(entry.kb * 100);
      const changed = this.movePower[key] ? ' changed' : '';
      return `<div class="mp-row${changed}">
        <b>${label}</b><small>${key}</small>
        <div class="mp-slider"><span>ダメージ</span>
          <input type="range" min="50" max="200" value="${dmg}" data-move="${key}" data-kind="dmg"><i>${dmg}%</i></div>
        <div class="mp-slider"><span>吹っ飛ばし</span>
          <input type="range" min="50" max="200" value="${kb}" data-move="${key}" data-kind="kb"><i>${kb}%</i></div>
      </div>`;
    }).join('');
    const count = Object.keys(this.movePower).length;
    this.el('move-power-info').textContent = count
      ? `標準から変えている技: ${count}個（${Object.keys(this.movePower).join('、')}）`
      : '全ての技が標準の強さです';
  },

  // ---- スポイト（残った背景の色を足して抜く） ----
  bindDropper() {
    const button = this.el('ed-dropper');
    button.addEventListener('click', () => {
      this.dropperOn = !this.dropperOn;
      button.classList.toggle('on', this.dropperOn);
      button.textContent = this.dropperOn ? 'スポイト中（プレビューをタップ）' : 'スポイトで背景の色を足す';
      this.el('ed-preview').parentElement.classList.toggle('pick', this.dropperOn);
    });

    // プレビュー上の位置を、元のコマ画像のピクセル座標へ戻して色を拾う
    const canvas = this.el('ed-preview');
    canvas.addEventListener('pointerdown', event => {
      if (!this.dropperOn) return;
      const map = this._previewMap;
      const entry = this.editing && this.motions[this.editing.slot];
      if (!map || !entry) return;
      event.preventDefault();
      const box = canvas.getBoundingClientRect();
      const cx = ((event.clientX - box.left) / box.width) * canvas.width;
      const cy = ((event.clientY - box.top) / box.height) * canvas.height;
      const sx = (cx - map.x) / map.scale;
      const sy = (cy - map.y) / map.scale;
      if (sx < 0 || sy < 0 || sx >= map.source.width || sy >= map.source.height) return;
      // 抜く前の元画像から色を拾う（既に抜けた場所を指しても意味が無いため）
      const raw = entry.sources[map.sourceIndex] || map.source;
      const color = StudioImage.pickColor(raw, sx * (raw.width / map.source.width), sy * (raw.height / map.source.height));
      if (!color) return;
      entry.extraColors = entry.extraColors || [];
      if (entry.extraColors.some(c => Math.hypot(c[0] - color[0], c[1] - color[1], c[2] - color[2]) < 12)) return;
      entry.extraColors.push(color);
      this.renderDropperList();
      this.processFrames();
    });
    this.renderDropperList();
  },

  renderDropperList() {
    const entry = this.editing && this.motions[this.editing.slot];
    const colors = (entry && entry.extraColors) || [];
    const list = this.el('ed-dropper-list');
    list.innerHTML = colors.map((c, i) =>
      `<button type="button" class="dropper-chip" data-drop="${i}">
        <i style="background:rgb(${c[0]},${c[1]},${c[2]})"></i>rgb(${c[0]},${c[1]},${c[2]}) ×
      </button>`).join('');
    list.querySelectorAll('[data-drop]').forEach(node => {
      node.addEventListener('click', () => {
        entry.extraColors.splice(Number(node.dataset.drop), 1);
        this.renderDropperList();
        this.processFrames();
      });
    });
  },

  // ---- パーツ分割（頭・胴・左右の脚） ----
  // ゲーム側 ProceduralMotion.PART_STATES と同じ角度でプレビューする。
  PARTS_POSES: {
    stand: { head: 0, torso: 0, legBack: 0, legFront: 0 },
    walk:  { head: -2.5, torso: 1.8, legBack: -16, legFront: 16 },
    dash:  { head: -3, torso: 2, legBack: -24, legFront: 24 },
    jump:  { head: 2, torso: -3, legBack: -22, legFront: 14 },
  },

  bindParts() {
    const use = this.el('spec-parts');
    use.addEventListener('change', () => {
      this.el('parts-fields').classList.toggle('hidden', !use.checked);
      if (use.checked) { this._ensurePartsDefaults(); this.drawPartsPreview(); }
    });
    ['parts-neck', 'parts-hip', 'parts-split'].forEach(id => {
      this.el(id).addEventListener('input', () => this.drawPartsPreview());
    });
    ['stand', 'walk', 'dash', 'jump'].forEach(pose => {
      this.el(`parts-pose-${pose}`).addEventListener('click', () => {
        this.partsPose = pose;
        ['stand', 'walk', 'dash', 'jump'].forEach(other =>
          this.el(`parts-pose-${other}`).classList.toggle('seg-on', other === pose));
        this.drawPartsPreview();
      });
    });
  },

  // パーツ／武器のプレビューに使う立ち絵。
  // この場で読み込んだ待機モーションが無くても、既に登録済みのモンスターなら
  // サーバー上の待機画像を取ってきて使う（編集のたびに読み込み直さなくて済む）。
  _partsSource() {
    const idle = this.motions.idle;
    if (idle && idle.canvases.length) return idle.canvases[0];
    if (this._existingIdleCanvas) return this._existingIdleCanvas;
    this._loadExistingIdle();
    return null;
  },

  _existingIdlePath() {
    const key = (this.el('spec-key').value || '').trim();
    const fighter = this.fightersJson && this.fightersJson[key];
    if (!fighter) return null;
    const frames = fighter.animations && fighter.animations.idle && fighter.animations.idle.frames;
    return (frames && frames[0]) || fighter.idleImage || null;
  },

  async _loadExistingIdle() {
    const path = this._existingIdlePath();
    if (!path || this._loadingIdlePath === path) return;
    this._loadingIdlePath = path;
    try {
      // スタジオは /tools/ 配下にあるため、1つ上へ戻ってから画像を指す
      const url = new URL('../' + path, location.href).href;
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      this._existingIdleCanvas = canvas;
      this._syncPartsSliders();
      this.drawPartsPreview();
      this.drawWeaponPreview();
    } catch (error) {
      this._loadingIdlePath = null;
    }
  },

  // スライダーは画像サイズに対する割合(0〜100)で持つ。初回は無難な位置に置く。
  _ensurePartsDefaults() {
    const source = this._partsSource();
    if (!source) return;
    if (this.parts.neckY == null) {
      this.el('parts-neck').value = 35;
      this.el('parts-hip').value = 72;
      this.el('parts-split').value = 50;
    }
  },

  // 登録済みの値（ピクセル）をスライダーの割合へ戻す。立ち絵が読めるまでは何もしない。
  _syncPartsSliders() {
    const spec = this._savedParts;
    const source = this._partsSource();
    if (!spec || !source) return;
    const pct = (value, size) => Math.max(0, Math.min(100, Math.round((value / size) * 100)));
    this.el('parts-neck').value = pct(spec.neckY, source.height);
    this.el('parts-hip').value = pct(spec.hipY, source.height);
    this.el('parts-split').value = pct(spec.legSplitX, source.width);
    this._savedParts = null;      // 一度反映したら以降は操作を優先する
  },

  _readParts() {
    const source = this._partsSource();
    if (!source) return null;
    const pct = id => Number(this.el(id).value) / 100;
    return {
      neckY: Math.round(source.height * pct('parts-neck')),
      hipY: Math.round(source.height * pct('parts-hip')),
      legSplitX: Math.round(source.width * pct('parts-split')),
      overlap: Math.max(2, Math.round(source.height * 0.02)),
    };
  },

  drawPartsPreview() {
    const canvas = this.el('parts-preview');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const source = this._partsSource();
    if (!source) {
      this.el('parts-info').textContent = this._existingIdlePath()
        ? '登録済みの待機画像を読み込んでいます…'
        : '先に「待機」モーションを登録してください（その1コマ目を土台にします）';
      return;
    }
    const spec = this._readParts();
    this.parts = spec;
    const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
    const offsetX = (canvas.width - source.width * scale) / 2;
    const offsetY = (canvas.height - source.height * scale) / 2;
    const W = source.width, H = source.height;
    const { neckY, hipY, legSplitX, overlap } = spec;
    const pose = this.PARTS_POSES[this.partsPose] || this.PARTS_POSES.stand;

    const slices = [
      ['legBack',  0, hipY, legSplitX, H - hipY,            legSplitX / 2, hipY],
      ['legFront', legSplitX, hipY, W - legSplitX, H - hipY, (legSplitX + W) / 2, hipY],
      ['torso',    0, neckY, W, Math.max(1, hipY + overlap - neckY), W / 2, hipY],
      ['head',     0, 0, W, Math.min(H, neckY + overlap),    W / 2, neckY],
    ];
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    for (const [key, sx, sy, sw, sh, px, py] of slices) {
      if (sw <= 0 || sh <= 0) continue;
      ctx.save();
      const angle = pose[key] || 0;
      if (angle) {
        ctx.translate(px, py); ctx.rotate(angle * Math.PI / 180); ctx.translate(-px, -py);
      }
      ctx.drawImage(source, sx, sy, sw, sh, sx, sy, sw, sh);
      ctx.restore();
    }
    // 切る位置の目安線
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.strokeStyle = '#ffd45e';
    ctx.beginPath(); ctx.moveTo(0, neckY); ctx.lineTo(W, neckY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(W, hipY); ctx.stroke();
    ctx.strokeStyle = '#7ce0ff';
    ctx.beginPath(); ctx.moveTo(legSplitX, hipY); ctx.lineTo(legSplitX, H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    this.el('parts-neck-value').textContent = String(neckY);
    this.el('parts-hip-value').textContent = String(hipY);
    this.el('parts-split-value').textContent = String(legSplitX);
    this.el('parts-info').textContent =
      `首 y=${neckY} ／ 腰 y=${hipY} ／ 脚の分かれ目 x=${legSplitX}（画像 ${W}×${H}px・のりしろ ${overlap}px）`;
  },

  // ---- 武器レイヤー（剣・斧などを握りを軸に振る） ----
  bindWeapon() {
    const use = this.el('spec-weapon');
    use.addEventListener('change', () => {
      this.el('weapon-fields').classList.toggle('hidden', !use.checked);
      if (use.checked) this.drawWeaponPreview();
    });
    this.el('weapon-mode-rect').addEventListener('click', () => this.setWeaponMode('rect'));
    this.el('weapon-mode-pivot').addEventListener('click', () => this.setWeaponMode('pivot'));
    this.el('weapon-angle').addEventListener('input', () => {
      this.el('weapon-angle-value').textContent = String(this.el('weapon-angle').value);
      this.drawWeaponPreview();
    });

    // プレビュー上のドラッグ／タップを画像のピクセル座標へ直す
    const canvas = this.el('weapon-preview');
    const toImage = event => {
      const rect = canvas.getBoundingClientRect();
      const view = this._weaponView;
      if (!view) return null;
      const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
      return { x: (x - view.offsetX) / view.scale, y: (y - view.offsetY) / view.scale };
    };
    let start = null;
    canvas.addEventListener('pointerdown', event => {
      const point = toImage(event);
      if (!point) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      if (this.weaponMode === 'pivot') {
        this.weapon.pivot = { x: Math.round(point.x), y: Math.round(point.y) };
        this.drawWeaponPreview();
        return;
      }
      start = point;
    });
    canvas.addEventListener('pointermove', event => {
      if (!start || this.weaponMode === 'pivot') return;
      const point = toImage(event);
      if (!point) return;
      this.weapon.rect = {
        x: Math.round(Math.min(start.x, point.x)), y: Math.round(Math.min(start.y, point.y)),
        w: Math.round(Math.abs(point.x - start.x)), h: Math.round(Math.abs(point.y - start.y)),
      };
      this.drawWeaponPreview();
    });
    const end = () => {
      if (start && this.weapon.rect && !this.weapon.pivot) {
        // 囲んだ直後は、握り側（前方から見て手前）を仮の軸にしておく
        const r = this.weapon.rect;
        this.weapon.pivot = { x: Math.round(r.x + r.w * 0.1), y: Math.round(r.y + r.h / 2) };
      }
      start = null;
      this.drawWeaponPreview();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  },

  setWeaponMode(mode) {
    this.weaponMode = mode;
    this.el('weapon-mode-rect').classList.toggle('seg-on', mode === 'rect');
    this.el('weapon-mode-pivot').classList.toggle('seg-on', mode === 'pivot');
  },

  // 立ち絵（待機モーションの1コマ目）を土台に、囲んだ範囲と振りを重ねて見せる
  drawWeaponPreview() {
    const canvas = this.el('weapon-preview');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const source = this._partsSource();
    this._weaponView = null;
    if (!source) {
      this.el('weapon-info').textContent = this._existingIdlePath()
        ? '登録済みの待機画像を読み込んでいます…'
        : '先に「待機」モーションを登録してください（その1コマ目を土台にします）';
      return;
    }
    const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
    const offsetX = (canvas.width - source.width * scale) / 2;
    const offsetY = (canvas.height - source.height * scale) / 2;
    this._weaponView = { scale, offsetX, offsetY };

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.drawImage(source, 0, 0);

    const rect = this.weapon.rect;
    const pivot = this.weapon.pivot;
    if (rect && rect.w > 2 && rect.h > 2) {
      // 振った武器を重ねて、残像がどれくらい見えるか確かめられるようにする
      const angle = Number(this.el('weapon-angle').value) || 0;
      const px = pivot ? pivot.x : rect.x + rect.w / 2;
      const py = pivot ? pivot.y : rect.y + rect.h / 2;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle * Math.PI / 180);
      ctx.translate(-px, -py);
      ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();

      ctx.strokeStyle = '#ffd45e';
      ctx.lineWidth = 2 / scale;
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.setLineDash([]);
    }
    if (pivot) {
      ctx.fillStyle = '#ff6b57';
      ctx.beginPath(); ctx.arc(pivot.x, pivot.y, 5 / scale, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / scale; ctx.stroke();
    }
    ctx.restore();

    this.el('weapon-info').textContent = rect
      ? `武器の範囲 ${rect.w}×${rect.h}px（左${rect.x} 上${rect.y}）｜握り ${pivot ? `${pivot.x},${pivot.y}` : '未指定'}`
      : '武器を囲むようにドラッグしてください';
  },

  // 自動モーションの強さ表示
  refreshProcLabel() {
    this.el('spec-proc-value').textContent = String(Number(this.el('spec-proc-intensity').value) || 0);
  },

  setStatus(id, kind, text) {
    const node = this.el(id);
    node.className = `status ${kind}`;
    node.classList.remove('hidden');
    node.textContent = text;
  },

  buildAptitudes() {
    const labels = { life: 'ライフ', power: 'ちから', intelligence: 'かしこさ',
      accuracy: '命中', evasion: '回避', defense: '丈夫さ' };
    this.el('apt-grid').innerHTML = Object.entries(labels).map(([key, label]) => `
      <div><label>${label}</label>
        <select id="apt-${key}">${['A', 'B', 'C', 'D', 'E']
          .map(r => `<option ${r === 'C' ? 'selected' : ''}>${r}</option>`).join('')}</select></div>`).join('');
  },

  buildMotionList() {
    const list = this.el('motion-list');
    list.innerHTML = STUDIO_MOTIONS.map(motion => `
      <div class="motion-row${motion.required ? ' required' : ''}" data-slot="${motion.slot}">
        <span><b>${motion.name}</b><small>${motion.hint || (motion.single ? '1枚' : 'コマ送り')}</small></span>
        <span class="count" data-count="${motion.slot}"></span>
        ${motion.single ? '' : `<button class="motion-play" data-play="${motion.slot}" type="button" aria-label="${motion.name}の動きを見る">▶</button>`}
        <span class="chev">›</span>
      </div>`).join('');
    list.querySelectorAll('[data-slot]').forEach(row => {
      row.addEventListener('click', event => {
        // ▶ は「動きの確認」、それ以外の場所は編集画面へ
        const play = event.target.closest('[data-play]');
        if (play) { this.openPreview(play.dataset.play); return; }
        this.openEditor(row.dataset.slot);
      });
    });
    this.refreshMotionList();
  },

  refreshMotionList() {
    const existing = this.existing || {};
    STUDIO_MOTIONS.forEach(motion => {
      const entry = this.motions[motion.slot];
      const count = entry ? entry.canvases.filter((_, i) => entry.used[i]).length : 0;
      const already = existing[motion.slot];
      const label = document.querySelector(`[data-count="${motion.slot}"]`);
      const row = document.querySelector(`[data-slot="${motion.slot}"]`);
      if (!label || !row) return;
      if (count) {
        label.textContent = already ? `${count}コマ（差し替え）` : `${count}コマ`;
        label.classList.remove('kept');
      } else if (already) {
        const parts = [];
        if (already.frames) parts.push(`${already.frames}コマ`);
        if (already.projectile) parts.push('飛び道具');
        label.textContent = `登録済み ${parts.join('・')}`;
        label.classList.add('kept');
      } else {
        label.textContent = '未登録';
        label.classList.remove('kept');
      }
      row.classList.toggle('done', count > 0 || !!already);
    });
  },

  // ---- GitHub ----
  async connect() {
    StudioGitHub.saveSettings({
      token: this.el('gh-token').value,
      repo: this.el('gh-repo').value,
      branch: this.el('gh-branch').value,
    });
    this.setStatus('gh-state', 'info', '接続を確認中…');
    try {
      const repo = await StudioGitHub.testConnection();
      const [fighters, movesets] = await Promise.all([
        StudioGitHub.getFile('data/fighters.json'),
        StudioGitHub.getFile('data/movesets.json'),
      ]);
      this.fightersJson = JSON.parse(fighters || '{}');
      this.movesetsJson = JSON.parse(movesets || '{}');
      this.fillExisting();
      this.refreshExistingMotions();
      const note = repo.canPush ? ''
        : '｜書き込み権限を確認できませんでした。コミットで失敗する場合はトークンの Contents を Read and write にしてください';
      this.setStatus('gh-state', repo.canPush ? 'ok' : 'info',
        `接続OK: ${repo.name}（登録済み ${Object.keys(this.fightersJson).length}体）${note}`);
    } catch (error) {
      this.setStatus('gh-state', 'ng', String(error.message || error));
    }
  },

  // サーバー上に既に登録されているモーションを把握する。
  // 「未登録」と表示され続けると、既にあるモーションまで作り直す必要があると誤解させてしまう。
  refreshExistingMotions() {
    this.existing = {};
    const key = (this.el('spec-key').value || '').trim();
    const fighter = this.fightersJson && this.fightersJson[key];
    const moveset = this.movesetsJson && this.movesetsJson[key];
    if (fighter && fighter.animations) {
      for (const [slot, animation] of Object.entries(fighter.animations)) {
        // 確認用に、登録済みのコマの場所も覚えておく（枚数だけだと再生できない）
        this.existing[slot] = {
          frames: (animation.frames || []).length,
          srcs: (animation.frames || []).slice(),
          duration: animation.frameDuration || 6,
        };
      }
    }
    if (fighter && fighter.stockIcon) this.existing.stock = { frames: 1, srcs: [fighter.stockIcon], duration: 6 };
    if (moveset) {
      for (const [group, moves] of Object.entries(moveset)) {
        for (const [moveKey, move] of Object.entries(moves || {})) {
          const slot = `move:${group}.${moveKey}`;
          const info = {};
          if (move.animation) {
            info.frames = (move.animation.frames || []).length;
            info.srcs = (move.animation.frames || []).slice();
            info.duration = move.animation.frameDuration || 6;
          }
          if (move.projectile) info.projectile = { ...move.projectile, sprite: move.projectileSprite };
          if (Object.keys(info).length) this.existing[slot] = info;
        }
      }
    }
    this.refreshMotionList();
  },

  fillExisting() {
    const select = this.el('spec-existing');
    select.innerHTML = Object.values(this.fightersJson)
      .map(f => `<option value="${f.key}">${f.displayName}（${f.key}）</option>`).join('');
  },

  onModeChange() {
    const isEdit = this.el('spec-mode').value === 'edit';
    this.el('existing-wrap').classList.toggle('hidden', !isEdit);
    if (isEdit) this.loadExisting();
  },

  // 既存モンスターの現在値をフォームへ流し込む（差分だけ更新できるように）
  loadExisting() {
    const key = this.el('spec-existing').value;
    const fighter = this.fightersJson && this.fightersJson[key];
    if (!fighter) return;
    this.el('spec-key').value = fighter.key;
    this.el('spec-name').value = fighter.displayName;
    this.el('spec-color').value = fighter.color || '#ff4757';
    this.el('spec-hh').value = fighter.hurtboxHeight || 124;
    this.el('spec-hw').value = fighter.hurtboxWidth || 54;
    this.el('spec-fall').value = Math.round((fighter.fallSpeed || 1) * 100);
    this.refreshFallLabel();
    this.el('spec-jump').value = Math.round((fighter.jumpPower || 1) * 100);
    this.refreshJumpLabel();
    // 技の強さ（倍率）。片方だけ指定されている場合も等倍で埋めておく。
    // 能力（Lv1時点の素の値）。一部しか登録されていない場合は既定値で埋めて、
    // ゲーム内で実際に使われる値をそのまま見せる（game.js の resolveStats と同じ扱い）。
    const baseStats = { life: 100, power: 10, intelligence: 10, accuracy: 10, evasion: 10, defense: 10 };
    const effectiveStats = { ...baseStats, ...(fighter.stats || {}) };
    for (const [stat, value] of Object.entries(effectiveStats)) {
      const input = this.el(`st-${stat}`);
      if (input) input.value = value;
    }
    // 適性。データに無い場合は C（ゲーム側の既定）を出す。
    const savedAptitudes = fighter.aptitudes || {};
    for (const stat of Object.keys(baseStats)) {
      const select = this.el(`apt-${stat}`);
      if (select) select.value = savedAptitudes[stat] || 'C';
    }

    this.movePower = {};
    for (const [key, value] of Object.entries(fighter.movePower || {})) {
      this.movePower[key] = {
        dmg: Number(value && value.dmg) > 0 ? Number(value.dmg) : 1,
        kb: Number(value && value.kb) > 0 ? Number(value.kb) : 1,
      };
    }
    this.renderMovePower();
    this._existingIdleCanvas = null;
    this._loadingIdlePath = null;
    const partsSpec = fighter.parts || null;
    this.el('spec-parts').checked = !!partsSpec;
    this.el('parts-fields').classList.toggle('hidden', !partsSpec);
    // 立ち絵はこの時点でまだ読めていないことがあるため、値を覚えておいて
    // 画像が用意できてからスライダーへ反映する
    this._savedParts = partsSpec;
    this.parts = partsSpec || {};
    this._syncPartsSliders();
    this.drawPartsPreview();
    this.weapon = fighter.weapon ? { rect: { ...fighter.weapon.rect }, pivot: fighter.weapon.pivot ? { ...fighter.weapon.pivot } : null } : {};
    this.el('spec-weapon').checked = !!fighter.weapon;
    this.el('weapon-fields').classList.toggle('hidden', !fighter.weapon);
    this.drawWeaponPreview();
    const proc = fighter.proceduralMotion || {};
    this.el('spec-proc').checked = proc.enabled !== false;
    this.el('spec-proc-intensity').value = Math.round((proc.intensity != null ? proc.intensity : 1) * 100);
    this.refreshProcLabel();
    const stats = fighter.stats || {};
    ['life', 'power', 'intelligence', 'accuracy', 'evasion', 'defense'].forEach(stat => {
      this.el(`st-${stat}`).value = stats[stat] != null ? stats[stat] : (stat === 'life' ? 100 : 10);
    });
    this.refreshExistingMotions();
  },

  // ---- モーション編集 ----
  bindEditor() {
    this.el('ed-close').addEventListener('click', () => this.closeEditor());
    this.el('ed-files').addEventListener('change', event => this.loadFiles(event.target.files));
    this.el('ed-source').addEventListener('change', () => {
      const kind = this.el('ed-source').value;
      this.el('ed-source-images').classList.toggle('hidden', kind !== 'images');
      this.el('ed-source-video').classList.toggle('hidden', kind !== 'video');
      this.el('ed-source-sheet').classList.toggle('hidden', kind !== 'sheet');
    });
    this.el('ed-video').addEventListener('change', event => this.loadVideo(event.target.files[0]));
    this.el('ed-apply').addEventListener('click', () => this.processFrames());
    this.el('ed-play').addEventListener('click', () => this.togglePlay());
    this.el('ed-done').addEventListener('click', () => this.closeEditor());
    this.el('ed-clear').addEventListener('click', () => {
      delete this.motions[this.editing.slot];
      delete this.attacks[this.editing.slot];
      delete this.projectiles[this.editing.slot];
      delete this.projectileImages[this.editing.slot];
      this.refreshMotionList();
      this.closeEditor();
    });
    this.el('ed-threshold').addEventListener('input', event => {
      this.el('ed-threshold-value').textContent = event.target.value;
    });
    this.el('ed-threshold').addEventListener('change', () => this.processFrames());
    this.el('ed-bgmode').addEventListener('change', () => this.processFrames());
    this.el('ed-scale').addEventListener('input', event => {
      this.el('ed-scale-value').textContent = event.target.value;
      this.processFrames();
    });
    this.el('ed-foot').addEventListener('input', event => {
      this.el('ed-foot-value').textContent = event.target.value;
      this.processFrames();
    });
    this.el('ed-duration').addEventListener('input', event => {
      this.el('ed-dur-value').textContent = event.target.value;
      const entry = this.motions[this.editing.slot];
      if (entry) entry.frameDuration = Number(event.target.value);
    });
  },

  // 攻撃タイプの既定値。判定コマの数やモーション長から後隙まで自動で決めるため、
  // 利用者が触るのは「タイプ」と「威力」だけで済む。
  ATTACK_PRESETS: {
    quick:  { dmgBase: 4,  kbBase: 3.5, angle: 30, endlagRatio: 0.5 },
    normal: { dmgBase: 8,  kbBase: 5.5, angle: 35, endlagRatio: 0.85 },
    heavy:  { dmgBase: 14, kbBase: 9,   angle: 40, endlagRatio: 1.4 },
  },

  bindAttack() {
    this.el('atk-use').addEventListener('change', () => {
      this.el('atk-fields').classList.toggle('hidden', !this.el('atk-use').checked);
      this.refreshAttack();
    });
    this.el('atk-mode-frames').addEventListener('click', () => this.setFrameMode('use'));
    this.el('atk-mode-hit').addEventListener('click', () => this.setFrameMode('hit'));
    ['atk-type', 'atk-power', 'atk-size'].forEach(id => {
      this.el(id).addEventListener('input', () => {
        if (id === 'atk-power') this.el('atk-power-value').textContent = this.el('atk-power').value;
        if (id === 'atk-size') this.el('atk-size-value').textContent = this.el('atk-size').value;
        const attack = this.attacks[this.editing.slot];
        if (attack) attack.manual = null; // 自動計算へ戻す
        this.refreshAttack();
      });
    });
    this.el('atk-detail-toggle').addEventListener('click', () => {
      const detail = this.el('atk-detail');
      detail.classList.toggle('hidden');
      this.el('atk-detail-toggle').textContent =
        detail.classList.contains('hidden') ? '詳細設定を開く' : '詳細設定を閉じる';
    });
    ['atk-dmg', 'atk-kb', 'atk-angle', 'atk-endlag', 'atk-stat'].forEach(id => {
      this.el(id).addEventListener('change', () => {
        const attack = this.attacks[this.editing.slot];
        if (!attack) return;
        // 直接編集した値は自動計算より優先する
        attack.manual = {
          dmgBase: Number(this.el('atk-dmg').value),
          kbBase: Number(this.el('atk-kb').value),
          angle: Number(this.el('atk-angle').value),
          endlag: Number(this.el('atk-endlag').value),
          statKey: this.el('atk-stat').value,
        };
        this.refreshAttack();
      });
    });
    this.el('atk-detail-reset').addEventListener('click', () => {
      const attack = this.attacks[this.editing.slot];
      if (attack) attack.manual = null;
      this.refreshAttack();
    });
  },

  setFrameMode(mode) {
    this.frameMode = mode;
    this.el('atk-mode-frames').classList.toggle('seg-on', mode === 'use');
    this.el('atk-mode-hit').classList.toggle('seg-on', mode === 'hit');
    this.renderFrames();
  },

  // 判定コマから、発生・持続・ヒット数・判定の軌道・威力をまとめて算出する
  buildAttack(slot) {
    const motion = STUDIO_MOTIONS.find(m => m.slot === slot);
    const entry = this.motions[slot];
    const attack = this.attacks[slot];
    if (!motion || !motion.slot.startsWith('move:') || !attack || !attack.use) return null;
    if (!entry || !entry.contentBox) return null;
    const usable = entry.canvases.filter((_, i) => entry.used[i]);
    if (!usable.length) return null;
    const duration = entry.frameDuration || 6;
    const hitFrames = (attack.hitFrames || []).filter(i => i < usable.length).sort((a, b) => a - b);
    if (!hitFrames.length) return null;

    // 連続したコマは1回の攻撃（判定が動く）、離れていれば別のヒットとして扱う
    const groups = [];
    for (const index of hitFrames) {
      const last = groups[groups.length - 1];
      if (last && index === last[last.length - 1] + 1) last.push(index);
      else groups.push([index]);
    }

    const sizeScale = (Number(this.el('atk-size').value) || 100) / 100;
    const base = usable[0];
    const hitboxes = [];
    for (const index of hitFrames) {
      const region = StudioImage.weaponRegion(usable[index], base);
      const rect = region || {
        // 差分が取れなかったコマは体の前方に標準的な判定を置く
        left: entry.contentBox.right, top: entry.contentBox.top + (entry.contentBox.bottom - entry.contentBox.top) * 0.3,
        right: entry.contentBox.right + (entry.contentBox.bottom - entry.contentBox.top) * 0.5,
        bottom: entry.contentBox.top + (entry.contentBox.bottom - entry.contentBox.top) * 0.75,
      };
      const relative = StudioImage.toRelativeBox(rect, entry.contentBox, sizeScale);
      if (!relative) continue;
      hitboxes.push({ frames: [index * duration, (index + 1) * duration - 1], ...relative,
        auto: !!region });
    }
    if (!hitboxes.length) return null;

    const windows = groups.map(group => [group[0] * duration, (group[group.length - 1] + 1) * duration - 1]);
    const totalFrames = usable.length * duration;
    const lastActive = windows[windows.length - 1][1];
    const preset = this.ATTACK_PRESETS[this.el('atk-type').value] || this.ATTACK_PRESETS.normal;
    const power = (Number(this.el('atk-power').value) || 100) / 100;
    const isSpecial = slot.startsWith('move:special');
    const auto = {
      dmgBase: Number((preset.dmgBase * power / (groups.length > 1 ? groups.length * 0.75 : 1)).toFixed(1)),
      kbBase: Number((preset.kbBase * power).toFixed(1)),
      angle: preset.angle,
      // 後隙はモーションの残り尺から決める（数値入力を減らすため）
      endlag: Math.max(4, Math.round((totalFrames - lastActive) * preset.endlagRatio)),
      statKey: isSpecial ? 'intelligence' : 'power',
    };
    const values = attack.manual ? { ...auto, ...attack.manual } : auto;

    return {
      duration: totalFrames,
      active: windows[0],
      multiHit: windows.length > 1 ? windows : null,
      hitboxes,
      values,
      summary: { startup: windows[0][0], hits: windows.length,
        activeFrames: windows.reduce((sum, w) => sum + (w[1] - w[0] + 1), 0),
        totalFrames, autoBoxes: hitboxes.filter(b => b.auto).length },
    };
  },

  refreshAttack() {
    if (!this.editing) return;
    const built = this.buildAttack(this.editing.slot);
    const summary = this.el('atk-summary');
    if (!built) {
      summary.textContent = this.el('atk-use').checked
        ? '「判定コマを選ぶ」に切り替えて、攻撃が当たるコマをタップしてください'
        : '';
      return;
    }
    const s = built.summary;
    summary.textContent = `発生 ${s.startup}F ／ 持続 ${s.activeFrames}F ／ 全体 ${s.totalFrames}F`
      + ` ／ ヒット ${s.hits}回 ／ 判定 ${built.hitboxes.length}個（うち自動抽出 ${s.autoBoxes}個）`
      + ` ／ ダメージ ${built.values.dmgBase} ・ 吹っ飛ばし ${built.values.kbBase} ・ 後隙 ${built.values.endlag}F`;
    if (!this.attacks[this.editing.slot].manual) {
      this.el('atk-dmg').value = built.values.dmgBase;
      this.el('atk-kb').value = built.values.kbBase;
      this.el('atk-angle').value = built.values.angle;
      this.el('atk-endlag').value = built.values.endlag;
      this.el('atk-stat').value = built.values.statKey;
    }
    this.showFrame();
  },

  bindProjectile() {
    this.el('pj-use').addEventListener('change', () => {
      this.el('pj-fields').classList.toggle('hidden', !this.el('pj-use').checked);
    });
    this.el('pj-type').addEventListener('change', () => {
      this.el('pj-bomb').classList.toggle('hidden', this.el('pj-type').value !== 'bomb');
    });
    this.el('pj-file').addEventListener('change', async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const canvas = await StudioImage.load(file);
      // 飛び道具も背景透過して余白を落とす（そのまま貼ると余白ぶん当たり判定がずれて見える）
      if (!StudioImage.hasTransparentCorners(canvas)) StudioImage.removeBackground(canvas, { mode: 'corner', threshold: 30 });
      const { canvases } = StudioImage.cropAll([canvas], 2);
      const trimmed = StudioImage.limitSize(canvases[0], 256);
      this.projectileImages[this.editing.slot] = trimmed;
      this.el('pj-preview').src = StudioImage.toDataUrl(trimmed);
      // 画像の縦横比から幅・高さの目安を入れる
      const width = Number(this.el('pj-width').value) || 100;
      this.el('pj-height').value = Math.max(6, Math.round(width * trimmed.height / trimmed.width));
    });
  },

  // 既存の飛び道具設定をフォームへ復元する
  loadProjectileForm(slot) {
    const box = this.el('ed-projectile');
    const motion = STUDIO_MOTIONS.find(m => m.slot === slot);
    box.classList.toggle('hidden', !motion.projectile);
    if (!motion.projectile) return;
    const saved = this.projectiles[slot];
    const already = (this.existing || {})[slot];
    const source = saved || (already && already.projectile) || null;
    this.el('pj-use').checked = !!source;
    this.el('pj-fields').classList.toggle('hidden', !source);
    this.el('pj-file').value = '';
    const image = this.projectileImages[slot];
    if (image) this.el('pj-preview').src = StudioImage.toDataUrl(image);
    else this.el('pj-preview').removeAttribute('src');
    if (!source) return;
    this.el('pj-type').value = source.type === 'bomb' ? 'bomb' : 'straight';
    this.el('pj-bomb').classList.toggle('hidden', source.type !== 'bomb');
    this.el('pj-speed').value = source.speed != null ? source.speed : 12;
    this.el('pj-spawn').value = source.spawnFrame != null ? source.spawnFrame : 9;
    this.el('pj-width').value = source.width != null ? source.width : 108;
    this.el('pj-height').value = source.height != null ? source.height : 30;
    this.el('pj-life').value = source.lifetime != null ? source.lifetime : 95;
    this.el('pj-gravity').value = source.gravity != null ? source.gravity : 0.28;
    this.el('pj-radius').value = source.explosionRadius != null ? source.explosionRadius : 105;
  },

  loadAttackForm(slot) {
    const box = this.el('ed-attack');
    const isMove = slot.startsWith('move:');
    box.classList.toggle('hidden', !isMove);
    this.setFrameMode('use');
    if (!isMove) return;
    const attack = this.attacks[slot];
    this.el('atk-use').checked = !!(attack && attack.use);
    this.el('atk-fields').classList.toggle('hidden', !(attack && attack.use));
    this.el('atk-detail').classList.add('hidden');
    this.el('atk-detail-toggle').textContent = '詳細設定を開く';
    this.refreshAttack();
  },

  readProjectileForm(slot) {
    const motion = STUDIO_MOTIONS.find(m => m.slot === slot);
    if (!motion.projectile) return;
    if (!this.el('pj-use').checked) { delete this.projectiles[slot]; return; }
    const type = this.el('pj-type').value;
    const config = {
      speed: Number(this.el('pj-speed').value) || 12,
      width: Number(this.el('pj-width').value) || 100,
      height: Number(this.el('pj-height').value) || 30,
      lifetime: Number(this.el('pj-life').value) || 95,
      spawnFrame: Number(this.el('pj-spawn').value) || 9,
    };
    if (type === 'bomb') {
      config.type = 'bomb';
      config.gravity = Number(this.el('pj-gravity').value) || 0.28;
      config.groundFriction = 0.985;
      config.explosionRadius = Number(this.el('pj-radius').value) || 105;
    }
    this.projectiles[slot] = config;
  },

  openEditor(slot) {
    const motion = STUDIO_MOTIONS.find(m => m.slot === slot);
    this.editing = motion;
    this.el('ed-title').textContent = motion.name;
    this.el('ed-hint').textContent = motion.hint ||
      (motion.single ? '1枚だけ使います。' : '選んだ順にコマが再生されます。使わないコマはタップで外せます。');
    this.el('ed-files').value = '';
    this.el('ed-video').value = '';
    this.el('ed-video-state').textContent = '';
    const entry = this.motions[slot];
    this.el('ed-duration').value = entry ? entry.frameDuration : motion.duration;
    this.el('ed-dur-value').textContent = this.el('ed-duration').value;
    this.el('ed-foot').value = entry ? (entry.footOffset || 0) : 0;
    this.el('ed-foot-value').textContent = this.el('ed-foot').value;
    this.el('ed-scale').value = entry ? (entry.sizePercent || 100) : 100;
    this.el('ed-scale-value').textContent = this.el('ed-scale').value;
    if (entry) {
      this.el('ed-bgmode').value = entry.options.mode;
      this.el('ed-threshold').value = entry.options.threshold;
      this.el('ed-threshold-value').textContent = entry.options.threshold;
    }
    // 既に本番へ登録済みのモーションがあることを伝える（触らなければそのまま残る）
    const already = (this.existing || {})[slot];
    const kept = this.el('ed-kept');
    if (already && !this.motions[slot]) {
      const parts = [];
      if (already.frames) parts.push(`${already.frames}コマのモーション`);
      if (already.projectile) parts.push('飛び道具の設定');
      kept.textContent = `このモーションは既に登録されています（${parts.join('・')}）。`
        + '画像を選ばなければ今のまま残ります。差し替えたい時だけ選び直してください。';
      kept.classList.remove('hidden');
    } else {
      kept.classList.add('hidden');
    }
    this.loadAttackForm(slot);
    this.loadProjectileForm(slot);
    this.el('editor').classList.remove('hidden');
    window.scrollTo(0, 0);
    this.renderFrames();
  },

  closeEditor() {
    if (this.editing) this.readProjectileForm(this.editing.slot);
    this.stopPlay();
    this.el('editor').classList.add('hidden');
    this.refreshMotionList();
    this.editing = null;
  },

  // 動画からコマを切り出す。
  // 繰り返し動作は周期を自動検出し、その1周ぶんだけを使うことで
  // 「途中で動きが飛ぶ」「片足しか上がらない」といった不自然さを避ける。
  async loadVideo(file) {
    if (!file) return;
    const state = this.el('ed-video-state');
    const wanted = Number(this.el('ed-video-count').value) || 8;
    const useCycle = this.el('ed-video-cycle').value === 'auto';
    let video = null;
    try {
      state.textContent = '動画を読み込み中…';
      video = await StudioVideo.load(file);
      // 周期を探すため、必要枚数より多めに候補を取る
      const sampleCount = useCycle ? Math.min(32, Math.max(wanted * 3, 18)) : wanted;
      const candidates = await StudioVideo.extractFrames(video, sampleCount,
        (done, total) => { state.textContent = `コマを取り出し中… ${done}/${total}`; });

      let sources = candidates;
      let message = `${candidates.length}コマから${wanted}コマを使います`;
      if (useCycle) {
        const period = StudioVideo.detectCycle(candidates);
        if (period) {
          sources = StudioVideo.pickCycleFrames(candidates, period, wanted);
          message = `繰り返しを検出しました（${period}コマで1周）。その1周から${sources.length}コマを使います`;
        } else {
          sources = StudioVideo.pickCycleFrames(candidates, candidates.length, wanted);
          message = `繰り返しが見つからなかったため、動画全体から${sources.length}コマを均等に使います`;
        }
      }
      if (candidates.recovered) {
        message += `（${candidates.recovered}コマは取り出せず、前後のコマで埋めました）`;
      }
      state.textContent = message + '。うまくいかない時は枚数や範囲を変えて選び直してください。';

      delete this.attacks[this.editing.slot];
      this.motions[this.editing.slot] = {
        sources,
        canvases: [],
        used: sources.map(() => true),
        // コマ個別の背景設定と手描きマスク。元画像が変わったら当然作り直しになる
        frameOptions: sources.map(() => null),
        masks: sources.map(() => null),
        frameDuration: Number(this.el('ed-duration').value),
        options: { mode: this.el('ed-bgmode').value, threshold: Number(this.el('ed-threshold').value) },
      };
      this.processFrames();
    } catch (error) {
      state.textContent = String(error.message || error);
    } finally {
      StudioVideo.release(video);
    }
  },

  async loadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    // iOSのファイル選択は順不同で返ることがあるため、ファイル名で並べ替えて安定させる
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    this.el('ed-box').textContent = '読み込み中…';
    try {
      const sources = [];
      for (const file of files) sources.push(await StudioImage.load(file));
      // すでに背景が透過されている素材なら、背景除去は不要（かけると色が削れる）
      if (StudioImage.hasTransparentCorners(sources[0]) && this.el('ed-bgmode').value === 'corner') {
        this.el('ed-bgmode').value = 'none';
      }
      delete this.attacks[this.editing.slot];
      this.motions[this.editing.slot] = {
        sources,
        canvases: [],
        used: sources.map(() => true),
        // コマ個別の背景設定と手描きマスク。元画像が変わったら当然作り直しになる
        frameOptions: sources.map(() => null),
        masks: sources.map(() => null),
        frameDuration: Number(this.el('ed-duration').value),
        options: { mode: this.el('ed-bgmode').value, threshold: Number(this.el('ed-threshold').value) },
      };
      this.processFrames();
    } catch (error) {
      this.el('ed-box').textContent = String(error.message || error);
    }
  },

  // モーション全体に効く背景の設定（コマ個別の設定がない時はこれが使われる）
  motionBgOptions() {
    const entry = this.editing && this.motions[this.editing.slot];
    return {
      mode: this.el('ed-bgmode').value,
      threshold: Number(this.el('ed-threshold').value),
      // スポイトで足した背景色。縁からつながっている範囲だけを抜く。
      extraColors: (entry && entry.extraColors) || [],
    };
  },

  // このコマに使う背景設定。コマ個別の設定があればそちらを優先する。
  frameBgOptions(index) {
    const entry = this.motions[this.editing.slot];
    const own = entry && entry.frameOptions && entry.frameOptions[index];
    if (!own) return this.motionBgOptions();
    return {
      mode: own.mode,
      threshold: own.threshold,
      extraColors: own.extraColors || [],
    };
  },

  // 1コマだけを「自動処理まで終えた状態」で作る（手描きマスクの下敷き）。
  // 縮小や共通トリミングの前なので、元画像とマスクと大きさがそろっている。
  autoFrame(index) {
    const entry = this.motions[this.editing.slot];
    const source = entry && entry.sources[index];
    if (!source) return null;
    const copy = document.createElement('canvas');
    copy.width = source.width; copy.height = source.height;
    copy.getContext('2d').drawImage(source, 0, 0);
    try { StudioImage.removeBackground(copy, this.frameBgOptions(index)); } catch (e) { /* 元のまま使う */ }
    return copy;
  },

  // 背景透過 → サイズ制限 → 共通トリミング → contentBox算出 まで一括で行う
  processFrames() {
    const entry = this.motions[this.editing.slot];
    if (!entry || !entry.sources.length) return;
    entry.options = this.motionBgOptions();
    entry.frameDuration = Number(this.el('ed-duration').value);

    const processed = entry.sources.map((source, index) => {
      // 元画像は残しておき、毎回コピーに対して処理する（しきい値を何度でも変えられる）
      const copy = document.createElement('canvas');
      copy.width = source.width; copy.height = source.height;
      copy.getContext('2d').drawImage(source, 0, 0);
      StudioImage.removeBackground(copy, this.frameBgOptions(index));
      // 手描きマスクは縮小より前に当てる。マスクは元画像と同じ大きさで持っているため。
      StudioMask.apply(copy, source, entry.masks && entry.masks[index]);
      return StudioImage.limitSize(copy, this.editing.single ? 256 : 720);
    });

    if (this.editing.single) {
      entry.canvases = [StudioImage.toSquare(processed[0], 128)];
      entry.used = [true];
      entry.contentBox = null;
    } else {
      const { canvases } = StudioImage.cropAll(processed, 6);
      entry.canvases = canvases;
      // コマごとにbboxが違うと再生時にガタつくため、全コマの和集合を共通boxとして使う
      const boxes = canvases.map(canvas => StudioImage.contentBox(canvas));
      // 崖つかまり→よじ登りのように足元が上下する技もあるため、
      // コマごとの位置も残しておき、プレビューで軌跡として見せる
      entry.frameBoxes = boxes;
      entry.footOffset = Number(this.el('ed-foot').value) || 0;
      entry.sizePercent = Number(this.el('ed-scale').value) || 100;
      const raw = StudioImage.nudgeBottom(StudioImage.unionContentBox(boxes), entry.footOffset);
      // 表示サイズの調整は「足元を固定したまま本体の高さを変える」ことで行う。
      // 技モーションは武器やエフェクトの分だけ枠が縦に伸び、そのままだと
      // キャラだけ小さく表示されてしまうため、ここで待機時と揃えられるようにする。
      entry.rawContentBox = raw;
      if (raw) {
        const height = (raw.bottom - raw.top) * (100 / entry.sizePercent);
        entry.contentBox = { ...raw, top: Math.round(raw.bottom - height) };
      } else entry.contentBox = null;
      if (entry.used.length !== canvases.length) entry.used = canvases.map(() => true);
      // 待機モーションからは体格（当たり判定）の目安を自動で決める
      if (this.editing.slot === 'idle' && entry.contentBox) {
        const metrics = StudioImage.bodyMetrics(canvases[0], entry.rawContentBox || entry.contentBox);
        const height = Number(this.el('spec-hh').value) || 124;
        const boxHeight = (entry.rawContentBox || entry.contentBox).bottom - (entry.rawContentBox || entry.contentBox).top;
        this.el('spec-hw').value = Math.max(20, Math.round(height * metrics.medianWidth / boxHeight));
      }
    }
    this.renderFrames();
    this.renderDropperList();
  },

  renderFrames() {
    const entry = this.motions[this.editing.slot];
    const container = this.el('ed-frames');
    if (!entry || !entry.canvases.length) {
      container.innerHTML = '';
      this.el('ed-preview').removeAttribute('src');
      this.el('ed-box').textContent = '画像が未選択です';
      return;
    }
    // 「使うコマ」と「判定コマ」で、コマ一覧のタップの意味が変わる
    const attack = this.attacks[this.editing.slot];
    const hitFrames = new Set((attack && attack.hitFrames) || []);
    // 足元が動くモーション（崖つかまりなど）は、コマごとの浮きをそのまま表示する
    const travel = this.footTravel();
    const showLift = !!(travel && travel.up >= 3) && entry.contentBox;
    let usableIndex = -1;
    container.innerHTML = entry.canvases.map((canvas, index) => {
      const used = entry.used[index];
      if (used) usableIndex++;
      const isHit = used && hitFrames.has(usableIndex);
      const own = showLift && entry.frameBoxes && entry.frameBoxes[index];
      const lift = own ? Math.round(entry.contentBox.bottom - own.bottom) : 0;
      // このコマだけ手を入れてあることが一覧で分かるようにする
      const hasMask = !!(entry.masks && entry.masks[index]);
      const hasOwnBg = !!(entry.frameOptions && entry.frameOptions[index]);
      return `<div class="frame${used ? '' : ' off'}${isHit ? ' hit' : ''}" data-index="${index}">
        <span>${index + 1}</span><img src="${StudioImage.toDataUrl(canvas)}" alt="">
        ${lift >= 3 ? `<i class="lift">↑${lift}</i>` : ''}
        ${isHit ? '<i class="hitmark">判定</i>' : ''}
        ${hasMask || hasOwnBg ? `<i class="tuned">${hasMask ? '筆' : ''}${hasOwnBg ? '個' : ''}</i>` : ''}
        <button type="button" class="frame-edit" data-edit="${index}" title="このコマの背景を手で調整">✎</button>
      </div>`;
    }).join('');
    // 鉛筆はコマ選択とは別の操作なので、先に拾って親へ伝えない
    container.querySelectorAll('[data-edit]').forEach(node => {
      node.addEventListener('click', event => {
        event.stopPropagation();
        StudioMaskEditor.open(this, Number(node.dataset.edit));
      });
    });
    container.querySelectorAll('[data-index]').forEach(node => {
      node.addEventListener('click', () => {
        const index = Number(node.dataset.index);
        if (this.frameMode === 'hit') {
          if (!entry.used[index]) return; // 使わないコマには判定を置けない
          const order = entry.canvases.map((_, i) => i).filter(i => entry.used[i]).indexOf(index);
          const current = this.attacks[this.editing.slot] || { use: true, hitFrames: [] };
          const set = new Set(current.hitFrames || []);
          if (set.has(order)) set.delete(order); else set.add(order);
          current.hitFrames = [...set].sort((a, b) => a - b);
          current.use = true;
          this.attacks[this.editing.slot] = current;
          this.el('atk-use').checked = true;
          this.el('atk-fields').classList.remove('hidden');
          this.renderFrames();
          this.refreshAttack();
          return;
        }
        entry.used[index] = !entry.used[index];
        // 全部外すと登録できなくなるため、最低1コマは残す
        if (!entry.used.some(Boolean)) entry.used[index] = true;
        this.renderFrames();
        this.refreshAttack();
      });
    });
    const box = entry.contentBox;
    const usedCount = entry.used.filter(Boolean).length;
    let text = box
      ? `使用 ${usedCount}コマ／画像 ${entry.canvases[0].width}×${entry.canvases[0].height}px｜`
        + `本体の位置 contentBox = 左${box.left} 上${box.top} 右${box.right} 下${box.bottom}（影は自動で除外）`
      : `使用 ${usedCount}コマ`;
    if (travel && travel.up >= 3) {
      text += `｜足元が ${travel.up}px 上下します（崖つかまり→よじ登りのように高さが変わるモーション）`;
    }
    this.el('ed-box').textContent = text;
    this.playIndex = 0;
    this.showFrame();
  },

  // 使うコマだけのコマ別bbox。崖つかまりのように足元が動く技の確認に使う。
  usableFrameBoxes() {
    const entry = this.motions[this.editing.slot];
    if (!entry || !Array.isArray(entry.frameBoxes)) return [];
    return entry.frameBoxes.filter((_, i) => entry.used[i]);
  },

  // モーション全体で足元が何px上下するか
  footTravel() {
    const bottoms = this.usableFrameBoxes().filter(Boolean).map(box => box.bottom);
    if (bottoms.length < 2) return null;
    return { up: Math.round(Math.max(...bottoms) - Math.min(...bottoms)) };
  },

  // ゲーム本体と同じ計算（本体の高さ = 当たり判定の高さ になるスケール）でプレビューする。
  // 待機モーションを薄く重ねることで、技のときだけキャラの大きさが変わってしまうのを目で防げる。
  showFrame() {
    const entry = this.motions[this.editing.slot];
    const canvas = this.el('ed-preview');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!entry || !entry.contentBox) return;
    const usable = entry.canvases.filter((_, i) => entry.used[i]);
    if (!usable.length) return;

    const baseline = canvas.height - 12;   // 地面の高さ
    const centerX = canvas.width / 2;
    const unitHeight = 150;                // プレビュー上での「当たり判定の高さ」

    const drawWith = (source, box, alpha) => {
      const scale = unitHeight / (box.bottom - box.top);
      const drawW = source.width * scale;
      const drawH = source.height * scale;
      const x = centerX - ((box.left + box.right) / 2) * scale;
      const y = (baseline - unitHeight) - box.top * scale;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(source, x, y, drawW, drawH);
      ctx.restore();
    };

    // 基準となる待機モーション（自分自身が待機の時は出さない）
    const idle = this.motions.idle;
    if (idle && idle.contentBox && this.editing.slot !== 'idle' && idle.canvases.length) {
      drawWith(idle.canvases[0], idle.contentBox, 0.25);
    }
    const currentIndex = this.playIndex % usable.length;
    // スポイトでタップ位置を元画像へ戻せるよう、描画の対応関係を覚えておく
    const usedIndexes = entry.canvases.map((_, i) => i).filter(i => entry.used[i]);
    {
      const box = entry.contentBox;
      const scale = unitHeight / (box.bottom - box.top);
      this._previewMap = {
        scale,
        x: centerX - ((box.left + box.right) / 2) * scale,
        y: (baseline - unitHeight) - box.top * scale,
        source: usable[currentIndex],
        sourceIndex: usedIndexes[currentIndex],
      };
    }
    drawWith(usable[currentIndex], entry.contentBox, 1);

    // 崖つかまり→よじ登りのように足元が上下するモーションは、
    // 共通の枠に収めて描くため見た目では気づきにくい。
    // 各コマの足元を軌跡として重ね、今のコマの高さを線で示す。
    const frameBoxes = this.usableFrameBoxes();
    const travel = this.footTravel();
    if (travel && travel.up >= 3 && frameBoxes.length === usable.length) {
      const scale = unitHeight / (entry.contentBox.bottom - entry.contentBox.top);
      const top = baseline - unitHeight;
      const point = fb => ({
        x: centerX + ((fb.left + fb.right) / 2 - (entry.contentBox.left + entry.contentBox.right) / 2) * scale,
        y: top + (fb.bottom - entry.contentBox.top) * scale,
      });
      ctx.save();
      ctx.strokeStyle = 'rgba(120,220,255,.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      frameBoxes.forEach((fb, index) => {
        if (!fb) return;
        const p = point(fb);
        if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,220,255,.5)';
      frameBoxes.forEach(fb => { if (fb) { const p = point(fb); ctx.fillRect(p.x - 2, p.y - 2, 4, 4); } });

      const own = frameBoxes[currentIndex];
      if (own) {
        const p = point(own);
        ctx.strokeStyle = '#7ce0ff';
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(14, p.y + .5); ctx.lineTo(canvas.width - 14, p.y + .5); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#7ce0ff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
        const lift = Math.round(entry.contentBox.bottom - own.bottom);
        ctx.font = 'bold 11px -apple-system, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(lift > 0 ? `地面から +${lift}px` : '接地', 14, Math.max(12, p.y - 4));
      }
      ctx.restore();
    }

    // 攻撃判定をゲームと同じ相対座標で重ねて表示する
    const built = this.buildAttack(this.editing.slot);
    if (built) {
      const duration = entry.frameDuration || 6;
      const elapsed = currentIndex * duration;
      const box = built.hitboxes.find(b => elapsed >= b.frames[0] && elapsed <= b.frames[1]);
      if (box) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,90,70,.28)';
        ctx.strokeStyle = 'rgba(255,130,110,.95)';
        ctx.lineWidth = 2;
        const x = centerX + box.x * unitHeight;
        const y = baseline + box.y * unitHeight;
        ctx.fillRect(x, y, box.w * unitHeight, box.h * unitHeight);
        ctx.strokeRect(x, y, box.w * unitHeight, box.h * unitHeight);
        ctx.restore();
      }
    }

    // 地面のガイド線
    ctx.strokeStyle = 'rgba(255,212,94,.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(10, baseline + .5); ctx.lineTo(canvas.width - 10, baseline + .5); ctx.stroke();
  },

  togglePlay() {
    if (this.playTimer) return this.stopPlay();
    const entry = this.motions[this.editing.slot];
    if (!entry) return;
    const interval = Math.max(30, (entry.frameDuration || 8) * (1000 / 60));
    this.playTimer = setInterval(() => { this.playIndex++; this.showFrame(); }, interval);
  },

  stopPlay() {
    if (this.playTimer) clearInterval(this.playTimer);
    this.playTimer = null;
  },

  // ---- コミット内容の組み立て ----
  collect() {
    const key = (this.el('spec-key').value || '').trim();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error('key は英小文字で入力してください（例: mymon）');
    const displayName = (this.el('spec-name').value || '').trim();
    if (!displayName) throw new Error('表示名を入力してください');

    const images = [];
    const animations = {};
    const moveData = {};
    let idleImage = null, stockIcon = null, spriteContentBox = null;

    // 飛び道具の設定（モーション画像を差し替えなくても単独で登録できる）
    for (const motion of STUDIO_MOTIONS) {
      if (!motion.projectile) continue;
      const config = this.projectiles[motion.slot];
      if (!config) continue;
      const slot = motion.slot.slice(5);
      moveData[slot] = moveData[slot] || {};
      moveData[slot].projectile = config;
      const image = this.projectileImages[motion.slot];
      if (image) {
        const name = `${motion.dir || slot.replace('.', '_')}.png`;
        const path = `assets/images/fighter/${key}/projectiles/${name}`;
        images.push({ path, canvas: image });
        moveData[slot].projectileSprite = path;
      }
    }

    for (const motion of STUDIO_MOTIONS) {
      const entry = this.motions[motion.slot];
      if (!entry || !entry.canvases.length) continue;
      const usable = entry.canvases.filter((_, i) => entry.used[i]);
      if (!usable.length) continue;

      if (motion.single) {
        const path = `assets/images/fighter/${key}/${motion.filePrefix || motion.slot}.png`;
        images.push({ path, canvas: usable[0] });
        if (motion.slot === 'stock') stockIcon = path;
        continue;
      }

      const frames = usable.map((canvas, index) => {
        const name = motion.filePrefix && usable.length === 1
          ? `${motion.filePrefix}.png`
          : `frame_${String(index + 1).padStart(3, '0')}.png`;
        const path = `assets/images/fighter/${key}/${motion.dir}/${name}`;
        images.push({ path, canvas });
        return path;
      });
      const animation = { frames, frameDuration: entry.frameDuration, contentBox: entry.contentBox };
      if (motion.slot.startsWith('move:')) {
        const slot = motion.slot.slice(5);
        moveData[slot] = moveData[slot] || {};
        moveData[slot].animation = animation;
        // 攻撃判定（発生・持続・軌道・威力）
        const built = this.buildAttack(motion.slot);
        if (built) {
          moveData[slot].attack = {
            duration: built.duration,
            active: built.active,
            multiHit: built.multiHit,
            hitboxes: built.hitboxes.map(({ auto, ...box }) => box),
            ...built.values,
          };
        }
      } else animations[motion.slot] = animation;
      if (motion.slot === 'idle') {
        idleImage = frames[0];
        spriteContentBox = entry.contentBox;
      }
    }

    if (!images.length && !Object.keys(moveData).length) {
      throw new Error('登録する内容がありません。モーションを1つ以上選ぶか、飛び道具を設定してください');
    }

    const stats = {};
    ['life', 'power', 'intelligence', 'accuracy', 'evasion', 'defense'].forEach(stat => {
      stats[stat] = Number(this.el(`st-${stat}`).value) || (stat === 'life' ? 100 : 10);
    });
    const aptitudes = {};
    ['life', 'power', 'intelligence', 'accuracy', 'evasion', 'defense'].forEach(stat => {
      aptitudes[stat] = this.el(`apt-${stat}`).value;
    });

    return {
      key, displayName, images, animations, moveData, aptitudes,
      spec: {
        key, displayName,
        color: this.el('spec-color').value,
        hurtboxHeight: Number(this.el('spec-hh').value) || 124,
        hurtboxWidth: Number(this.el('spec-hw').value) || 54,
        fallSpeed: Number((Number(this.el('spec-fall').value) / 100).toFixed(2)) || 1,
        jumpPower: Number((Number(this.el('spec-jump').value) / 100).toFixed(2)) || 1,
        aptitudes,
        movePower: this._readMovePower(),
        parts: (this.el('spec-parts').checked && this._readParts()) || null,
        weapon: (this.el('spec-weapon').checked && this.weapon.rect && this.weapon.rect.w > 2)
          ? { rect: this.weapon.rect, pivot: this.weapon.pivot || null } : null,
        proceduralMotion: {
          enabled: this.el('spec-proc').checked,
          intensity: Number((Number(this.el('spec-proc-intensity').value) / 100).toFixed(2)),
        },
        idleImage, stockIcon, spriteContentBox,
        stats,
      },
    };
  },

  async buildFiles(collected) {
    if (!this.fightersJson) throw new Error('先にGitHubへ接続してください');
    const files = [];
    for (const image of collected.images) {
      files.push({ path: image.path, bytes: await StudioImage.toPngBytes(image.canvas) });
    }

    // animations は collect() の戻り値の直下にあるため、spec へ載せ替えてから渡す。
    // （これを忘れると画像だけがコミットされ、待機・歩行・崖つかまりなどの
    //   状態モーションが fighters.json に登録されないまま終わる）
    const fighters = StudioBuild.applyFighter(this.fightersJson,
      { ...collected.spec, animations: collected.animations });
    files.push({ path: 'data/fighters.json', text: JSON.stringify(fighters, null, 2) + '\n' });

    if (Object.keys(collected.moveData).length) {
      const movesets = StudioBuild.applyMoveset(this.movesetsJson, collected.key, collected.moveData);
      files.push({ path: 'data/movesets.json', text: JSON.stringify(movesets, null, 2) + '\n' });
    }

    const swSource = await StudioGitHub.getFile('service-worker.js');
    const sw = StudioBuild.updateServiceWorker(swSource, collected.images.map(i => i.path));
    files.push({ path: 'service-worker.js', text: sw.source });
    files.push({ path: 'version.json', text: StudioBuild.versionJson(sw.version) });

    const indexSource = await StudioGitHub.getFile('index.html');
    const title = (this.el('log-title').value || '').trim() || `モンスター「${collected.displayName}」を追加`;
    const body = (this.el('log-body').value || '').trim() || `${collected.displayName}を追加しました。`;
    files.push({ path: 'index.html', text: StudioBuild.updateIndexHtml(indexSource, sw.version, title, body) });

    return { files, version: sw.version, swAdded: sw.added, title };
  },

  async showDiff() {
    try {
      const collected = this.collect();
      const built = await this.buildFiles(collected);
      this.pending = built;
      const lines = [
        `■ モンスター: ${collected.displayName}（${collected.key}）`,
        `■ 体格: 高さ ${collected.spec.hurtboxHeight} / 幅 ${collected.spec.hurtboxWidth} / 落下速度 ${collected.spec.fallSpeed}倍 / ジャンプ力 ${collected.spec.jumpPower}倍`,
        `■ パーツ分割: ${collected.spec.parts
          ? `あり（首y=${collected.spec.parts.neckY} 腰y=${collected.spec.parts.hipY}）` : 'なし'}`,
        `■ 武器レイヤー: ${collected.spec.weapon
          ? `あり（${collected.spec.weapon.rect.w}×${collected.spec.weapon.rect.h}px）` : 'なし'}`,
        `■ 適性: ${Object.entries(collected.aptitudes).map(([k, v]) =>
          `${({ life: 'ライフ', power: 'ちから', intelligence: 'かしこさ', accuracy: '命中', evasion: '回避', defense: '丈夫さ' })[k]}${v}`).join(' ')}`,
        `■ 技の強さ: ${collected.spec.movePower
          ? Object.entries(collected.spec.movePower).map(([k, v]) =>
              `${k}(${v.dmg ? `ダメージ${Math.round(v.dmg * 100)}%` : ''}${v.dmg && v.kb ? '・' : ''}${v.kb ? `吹っ飛ばし${Math.round(v.kb * 100)}%` : ''})`).join(' / ')
          : '全て標準'}`,
        `■ 自動モーション: ${collected.spec.proceduralMotion.enabled
          ? `使う（強さ ${Math.round(collected.spec.proceduralMotion.intensity * 100)}%）` : '使わない'}`,
        `■ 登録モーション: ${Object.keys(collected.animations).join('、') || 'なし'}`,
        `■ 技: ${Object.entries(collected.moveData).map(([k, v]) =>
          k + (v.animation ? '(モーション)' : '') + (v.projectile ? '(飛び道具)' : '')
          + (v.attack ? `(判定${v.attack.hitboxes.length}個・発生${v.attack.active[0]}F・ダメージ${v.attack.dmgBase})` : '')
        ).join('、') || 'なし'}`,
        `■ 画像: ${collected.images.length}枚`,
        `■ 新バージョン: 0.${built.version}（Service Workerへ${built.swAdded}件追加）`,
        '',
        '--- 更新されるファイル ---',
        ...built.files.map(f => `  ${f.path}${f.bytes ? ` (${Math.round(f.bytes.length / 1024)}KB)` : ''}`),
      ];
      const diff = this.el('diff');
      diff.classList.remove('hidden');
      diff.textContent = lines.join('\n');
      this.el('btn-commit').disabled = false;
      this.setStatus('commit-state', 'info', '内容を確認して「この内容でコミット」を押してください');
    } catch (error) {
      this.el('btn-commit').disabled = true;
      this.setStatus('commit-state', 'ng', String(error.message || error));
    }
  },

  async commit() {
    if (!this.pending) return;
    this.el('btn-commit').disabled = true;
    try {
      const message = `${this.pending.title}（モンスター作成スタジオから登録）`;
      const sha = await StudioGitHub.commitFiles(this.pending.files, message,
        text => this.setStatus('commit-state', 'info', text));
      this.setStatus('commit-state', 'ok',
        `コミットしました（${sha.slice(0, 7)}）。数分後に本番へ反映されます。`);
      this.pending = null;
      // 直後にもう一度登録できるよう、最新のデータを取り直す
      await this.connect();
    } catch (error) {
      this.setStatus('commit-state', 'ng', String(error.message || error));
      this.el('btn-commit').disabled = false;
    }
  },
};

// スクリプトは動的に読み込まれるため、この時点で既にDOMContentLoadedが
// 済んでいる場合がある。読み込み済みならそのまま初期化する。
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => Studio.init());
} else {
  Studio.init();
}

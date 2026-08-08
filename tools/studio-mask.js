// ==== モンスター作成スタジオ：手描きの背景マスク ====
// 自動の背景透過だけでは抜けない/抜けすぎる場所を、コマごとにブラシで直す。
//
// マスクは「消す(erase)」「戻す(keep)」の2枚を、グレースケールの不透明画像として持つ。
//   erase … 明るいほど、その場所を透明にする
//   keep  … 明るいほど、自動処理を打ち消して元の絵を戻す
// 2枚に分けているのは、自動処理で消えてしまった場所を「戻す」ためには、
// 透明度を掛け算するだけのマスク1枚では足りない（0に何を掛けても0のまま）ため。
const StudioMask = {
  create(w, h) {
    return { w, h, erase: this._gray(w, h), keep: this._gray(w, h), painted: false };
  },

  _gray(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    return canvas;
  },

  _data(canvas) {
    return canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
  },

  // ブラシ1回ぶんの塗り。今の筆のレイヤーへ、中心が白い円をひとつ置く。
  //
  // 合成に lighten（最大値）を使っているのは、ひと筆の中で何度も塗り重なっても
  // 濃さが増えないようにするため。source-over で半透明を重ねる普通のやり方だと、
  // 重なった所だけ不透明に振り切れてしまい、せっかく指定した「やわらかさ」が
  // 縁から消えて硬いフチになってしまう。
  // 円の外側は黒で終わらせてあるので、最大値で合成しても外は変化しない。
  _stamp(canvas, x, y, radius, softness) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const inner = Math.max(0, Math.min(0.98, 1 - softness));
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, '#fff');
    if (inner > 0) gradient.addColorStop(inner, '#fff');
    gradient.addColorStop(1, '#000');
    ctx.save();
    ctx.globalCompositeOperation = 'lighten';
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  },

  // ---- ひと筆（指を下ろしてから離すまで）の管理 ----
  // ひと筆の中では「重ねても濃くならない」、筆を分ければ「重ねるほど濃くなる」。
  // 画像編集ソフトのブラシと同じ挙動で、これが両立していないと
  //   ・ひと筆の中で濃くなる  → ゆっくり動かした所だけ縁が硬くなる
  //   ・筆を分けても濃くならない → やわらかさを上げると何度塗っても消しきれない
  // という、どちらかの不便が必ず出る。
  beginStroke(mask, mode) {
    if (!mask) return;
    mask.strokeMode = mode;
    mask.strokeLayer = this._gray(mask.w, mask.h);
    // 反転画像は指を動かすたびに要るので、ここで1枚だけ用意して使い回す。
    // 毎回作り直すと、1秒に何十枚も画像を捨てることになり端末が重くなる。
    mask.invertLayer = document.createElement('canvas');
    mask.invertLayer.width = mask.w;
    mask.invertLayer.height = mask.h;
    // 筆を下ろした時点の状態。動かすたびに、ここへ今の筆を合成し直す。
    mask.baseErase = this._copy(mask.erase);
    mask.baseKeep = this._copy(mask.keep);
  },

  // 線を引く。点を等間隔に置いて繋ぐ（間隔を空けすぎると点線になる）
  stroke(mask, mode, from, to, radius, softness) {
    if (!mask) return;
    // 筆を始めずに呼ばれた時（テストなど）は、その場でひと筆として扱う
    const standalone = !mask.strokeLayer;
    if (standalone) this.beginStroke(mask, mode);
    const step = Math.max(1, radius * 0.25);
    const dx = to.x - from.x, dy = to.y - from.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // 最大値で合成するので、同じ所を何度通っても濃さは変わらない
      this._stamp(mask.strokeLayer, from.x + dx * t, from.y + dy * t, radius, softness);
    }
    this._composeStroke(mask);
    if (standalone) this.endStroke(mask);
  },

  // 「筆を下ろした時の状態」＋「今の筆」を合成して、今のマスクを作り直す
  _composeStroke(mask) {
    const layer = mask.strokeLayer;
    if (!layer) return;
    const add = mask.strokeMode === 'erase' ? mask.erase : mask.keep;
    const sub = mask.strokeMode === 'erase' ? mask.keep : mask.erase;
    const baseAdd = mask.strokeMode === 'erase' ? mask.baseErase : mask.baseKeep;
    const baseSub = mask.strokeMode === 'erase' ? mask.baseKeep : mask.baseErase;

    // 塗る側：screen で重ねる（1-(1-a)(1-b)）。筆を重ねるほど濃くなり、必ず255へ近づく。
    const addCtx = add.getContext('2d', { willReadFrequently: true });
    addCtx.save();
    addCtx.globalCompositeOperation = 'source-over';
    addCtx.drawImage(baseAdd, 0, 0);
    addCtx.globalCompositeOperation = 'screen';
    addCtx.drawImage(layer, 0, 0);
    addCtx.restore();

    // 反対側：筆の濃さのぶんだけ削る（multiply で 1-筆 を掛ける）。
    // 消した所を戻す・戻した所を消す、を往復できるようにするため。
    const subCtx = sub.getContext('2d', { willReadFrequently: true });
    subCtx.save();
    subCtx.globalCompositeOperation = 'source-over';
    subCtx.drawImage(baseSub, 0, 0);
    subCtx.globalCompositeOperation = 'multiply';
    subCtx.drawImage(this._invertInto(mask.invertLayer, layer), 0, 0);
    subCtx.restore();

    mask.painted = true;
  },

  endStroke(mask) {
    if (!mask) return;
    mask.strokeLayer = null;
    mask.invertLayer = null;
    mask.baseErase = null;
    mask.baseKeep = null;
  },

  _copy(canvas) {
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    out.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0);
    return out;
  },

  // 白黒を反転させた画像（255 - 元の明るさ）を out へ描く
  _invertInto(out, canvas) {
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.globalCompositeOperation = 'difference';
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
    return out;
  },

  clear(mask) {
    if (!mask) return;
    for (const canvas of [mask.erase, mask.keep]) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    this.endStroke(mask);
    mask.painted = false;
  },

  // 何も塗られていないか（塗ったあと全部消した場合も拾えるよう実際に走査する）
  isEmpty(mask) {
    if (!mask) return true;
    for (const canvas of [mask.erase, mask.keep]) {
      const data = this._data(canvas);
      for (let i = 0; i < data.length; i += 4) if (data[i] > 4) return false;
    }
    return true;
  },

  // 取り消し用の控え。R成分だけ取れば足りるので、そのぶん軽くしておく
  snapshot(mask) {
    const pick = canvas => {
      const data = this._data(canvas);
      const out = new Uint8Array(canvas.width * canvas.height);
      for (let p = 0; p < out.length; p++) out[p] = data[p * 4];
      return out;
    };
    return { erase: pick(mask.erase), keep: pick(mask.keep) };
  },

  restore(mask, snap) {
    if (!mask || !snap) return;
    const put = (canvas, values) => {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const image = ctx.createImageData(canvas.width, canvas.height);
      const data = image.data;
      for (let p = 0; p < values.length; p++) {
        const i = p * 4;
        data[i] = data[i + 1] = data[i + 2] = values[p];
        data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    };
    put(mask.erase, snap.erase);
    put(mask.keep, snap.keep);
    // 取り消した直後に筆の途中の控えが残っていると、次の指の動きで元へ戻ってしまう
    this.endStroke(mask);
    mask.painted = true;
  },

  // マスクを反映する。
  // target … 自動で背景を抜いたあとの絵（ここを書き換える）
  // source … 加工前の元画像（「戻す」で参照する）
  // 3枚とも同じ大きさである前提。processFrames では縮小の前に呼ぶこと。
  apply(target, source, mask) {
    if (!mask || !mask.painted) return target;
    const w = target.width, h = target.height;
    if (mask.w !== w || mask.h !== h || source.width !== w || source.height !== h) return target;
    const ctx = target.getContext('2d', { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, w, h);
    const d = image.data;
    const src = this._data(source);
    const erase = this._data(mask.erase);
    const keep = this._data(mask.keep);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const k = keep[i];
      if (k) {
        // 元の絵へ戻す（途中の濃さでは自動処理の結果と混ぜる）
        const t = k / 255;
        d[i] += (src[i] - d[i]) * t;
        d[i + 1] += (src[i + 1] - d[i + 1]) * t;
        d[i + 2] += (src[i + 2] - d[i + 2]) * t;
        d[i + 3] += (src[i + 3] - d[i + 3]) * t;
      }
      const e = erase[i];
      if (e) d[i + 3] *= 1 - e / 255;
    }
    ctx.putImageData(image, 0, 0);
    return target;
  },
};

// ==== 手描きマスクの編集画面 ====
// コマ1枚を大きく表示して、ブラシで透過を足したり戻したりする。
// 「このコマだけ背景の抜き方を変える」設定もここでまとめて行う。
const StudioMaskEditor = {
  app: null,
  index: -1,
  mask: null,
  view: { scale: 1, x: 0, y: 0 },
  brush: { mode: 'erase', size: 28, softness: 0.5 },
  panMode: false,
  undoStack: [],
  _pointers: new Map(),
  _last: null,
  _pinch: null,
  _composite: null,   // 自動処理＋マスクを反映した表示用のキャンバス
  _auto: null,        // 自動処理だけを終えた状態（マスクを塗り直すたびに使い回す）
  _source: null,
  _raf: 0,

  el(id) { return document.getElementById(id); },

  open(app, index) {
    const entry = app.motions[app.editing.slot];
    if (!entry || !entry.sources[index]) return;
    this.app = app;
    this.index = index;
    this._source = entry.sources[index];
    entry.masks = entry.masks || [];
    if (!entry.masks[index] || entry.masks[index].w !== this._source.width
        || entry.masks[index].h !== this._source.height) {
      entry.masks[index] = StudioMask.create(this._source.width, this._source.height);
    }
    this.mask = entry.masks[index];
    this.undoStack = [];
    this.panMode = false;

    this.el('mask-editor').classList.remove('hidden');
    this.el('mask-title').textContent = `コマ ${index + 1} の背景を手で調整`;
    this._syncFrameOptionUi();
    this._syncBrushUi();
    this.rebuildAuto();
    // 表示領域が確定してから枠に合わせる
    requestAnimationFrame(() => { this.fit(); this.draw(); });
  },

  close() {
    this.el('mask-editor').classList.add('hidden');
    this._pointers.clear();
    this.app = null;
    this.index = -1;
    this.mask = null;
  },

  // このコマの「自動処理まで終えた絵」を作り直す。
  // しきい値や抜き方を変えた時だけ呼べばよく、ブラシを動かすたびには要らない。
  rebuildAuto() {
    if (!this.app) return;
    this._auto = this.app.autoFrame(this.index);
    this.render();
  },

  // 自動処理の結果にマスクを重ねて、表示用のキャンバスを作る
  render() {
    if (!this._auto) return;
    const canvas = document.createElement('canvas');
    canvas.width = this._auto.width; canvas.height = this._auto.height;
    canvas.getContext('2d').drawImage(this._auto, 0, 0);
    StudioMask.apply(canvas, this._source, this.mask);
    this._composite = canvas;
  },

  fit() {
    const canvas = this.el('mask-canvas');
    const box = canvas.parentElement.getBoundingClientRect();
    // 画面の実ピクセルに合わせる（そうしないと拡大時にぼやける）
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    canvas.style.width = `${box.width}px`;
    canvas.style.height = `${box.height}px`;
    const source = this._source;
    if (!source) return;
    const scale = Math.min(canvas.width / source.width, canvas.height / source.height) * 0.92;
    this.view = {
      scale,
      x: (canvas.width - source.width * scale) / 2,
      y: (canvas.height - source.height * scale) / 2,
    };
  },

  draw() {
    const canvas = this.el('mask-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this._composite) return;
    const { scale, x, y } = this.view;
    const w = this._composite.width * scale, h = this._composite.height * scale;
    // 拡大している時はドットをそのまま見せる（ぼかすと縁の判断ができない）
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(this._composite, x, y, w, h);
    // 元画像の外枠
    ctx.strokeStyle = 'rgba(255,212,94,.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    this._drawCursor(ctx);
  },

  // ブラシの大きさが一目で分かるように、指の位置へ円を描く
  _cursor: null,
  _drawCursor(ctx) {
    const c = this._cursor;
    if (!c || this.panMode) return;
    const r = this.brush.size / 2 * this.view.scale;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = this.brush.mode === 'erase' ? '#ff8f7d' : '#7ce0ff';
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(2, r), 0, Math.PI * 2);
    ctx.stroke();
    if (this.brush.softness > 0.05) {
      ctx.setLineDash([3, 3]);
      ctx.globalAlpha = .55;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(1, r * (1 - this.brush.softness)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },

  _requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
  },

  // 画面上の位置 → キャンバスの実ピクセル
  _toCanvas(event) {
    const canvas = this.el('mask-canvas');
    const box = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) * (canvas.width / box.width),
      y: (event.clientY - box.top) * (canvas.height / box.height),
    };
  },

  // キャンバスの実ピクセル → 元画像のピクセル
  _toImage(point) {
    return {
      x: (point.x - this.view.x) / this.view.scale,
      y: (point.y - this.view.y) / this.view.scale,
    };
  },

  bind() {
    const canvas = this.el('mask-canvas');

    canvas.addEventListener('pointerdown', event => {
      if (!this.app) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      this._pointers.set(event.pointerId, this._toCanvas(event));
      if (this._pointers.size === 2) {
        // 2本指になったら描くのをやめて、拡大縮小と移動に切り替える
        this._last = null;
        this._pinch = this._pinchState();
        return;
      }
      const point = this._toCanvas(event);
      this._cursor = point;
      if (this.panMode) { this._last = point; return; }
      // 塗る前の状態を控えておく（取り消し用）
      this.undoStack.push(StudioMask.snapshot(this.mask));
      if (this.undoStack.length > 12) this.undoStack.shift();
      this._syncUndoUi();
      const image = this._toImage(point);
      StudioMask.beginStroke(this.mask, this.brush.mode);
      StudioMask.stroke(this.mask, this.brush.mode, image, image,
        this.brush.size / 2, this.brush.softness);
      this._last = point;
      this.render();
      this._requestDraw();
    });

    canvas.addEventListener('pointermove', event => {
      if (!this.app) return;
      const point = this._toCanvas(event);
      if (this._pointers.has(event.pointerId)) this._pointers.set(event.pointerId, point);
      this._cursor = point;
      if (this._pointers.size === 2 && this._pinch) { this._applyPinch(); return; }
      if (!this._last) { this._requestDraw(); return; }
      if (this.panMode) {
        this.view.x += point.x - this._last.x;
        this.view.y += point.y - this._last.y;
        this._last = point;
        this._requestDraw();
        return;
      }
      StudioMask.stroke(this.mask, this.brush.mode, this._toImage(this._last), this._toImage(point),
        this.brush.size / 2, this.brush.softness);
      this._last = point;
      this.render();
      this._requestDraw();
    });

    const end = event => {
      this._pointers.delete(event.pointerId);
      if (this._pointers.size < 2) this._pinch = null;
      if (!this._pointers.size) {
        this._last = null;
        // 指を離したらひと筆の終わり。次に塗った時は、この上に重なって濃くなる。
        StudioMask.endStroke(this.mask);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', event => {
      end(event);
      this._cursor = null;
      this._requestDraw();
    });

    // マウスホイールで拡大縮小
    canvas.addEventListener('wheel', event => {
      if (!this.app) return;
      event.preventDefault();
      this._zoomAt(this._toCanvas(event), event.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    for (const mode of ['erase', 'keep']) {
      this.el(`mask-mode-${mode}`).addEventListener('click', () => {
        this.brush.mode = mode;
        this.panMode = false;
        this._syncBrushUi();
        this._requestDraw();
      });
    }
    this.el('mask-mode-move').addEventListener('click', () => {
      this.panMode = !this.panMode;
      this._syncBrushUi();
      this._requestDraw();
    });
    this.el('mask-size').addEventListener('input', event => {
      this.brush.size = Number(event.target.value);
      this._syncBrushUi();
      this._requestDraw();
    });
    this.el('mask-soft').addEventListener('input', event => {
      this.brush.softness = Number(event.target.value) / 100;
      this._syncBrushUi();
      this._requestDraw();
    });
    this.el('mask-undo').addEventListener('click', () => {
      const snap = this.undoStack.pop();
      if (!snap) return;
      StudioMask.restore(this.mask, snap);
      this._syncUndoUi();
      this.render();
      this.draw();
    });
    this.el('mask-clear').addEventListener('click', () => {
      if (!this.mask) return;
      this.undoStack.push(StudioMask.snapshot(this.mask));
      this._syncUndoUi();
      StudioMask.clear(this.mask);
      this.render();
      this.draw();
    });
    this.el('mask-fit').addEventListener('click', () => { this.fit(); this.draw(); });
    this.el('mask-done').addEventListener('click', () => this.finish());
    this.el('mask-close').addEventListener('click', () => this.finish());

    // このコマだけの背景設定
    this.el('mask-own').addEventListener('change', () => {
      const entry = this._entry();
      if (!entry) return;
      entry.frameOptions = entry.frameOptions || [];
      if (this.el('mask-own').checked) {
        const base = this.app.motionBgOptions();
        entry.frameOptions[this.index] = {
          mode: base.mode, threshold: base.threshold, extraColors: base.extraColors.slice(),
        };
      } else {
        entry.frameOptions[this.index] = null;
      }
      this._syncFrameOptionUi();
      this.rebuildAuto();
      this.draw();
    });
    this.el('mask-bgmode').addEventListener('change', () => this._writeFrameOption());
    this.el('mask-threshold').addEventListener('input', () => {
      this.el('mask-threshold-value').textContent = this.el('mask-threshold').value;
      this._writeFrameOption();
    });
  },

  _entry() {
    return this.app && this.app.motions[this.app.editing.slot];
  },

  _writeFrameOption() {
    const entry = this._entry();
    if (!entry || !entry.frameOptions || !entry.frameOptions[this.index]) return;
    entry.frameOptions[this.index].mode = this.el('mask-bgmode').value;
    entry.frameOptions[this.index].threshold = Number(this.el('mask-threshold').value);
    this.rebuildAuto();
    this.draw();
  },

  _syncFrameOptionUi() {
    const entry = this._entry();
    const own = !!(entry && entry.frameOptions && entry.frameOptions[this.index]);
    this.el('mask-own').checked = own;
    this.el('mask-own-fields').classList.toggle('hidden', !own);
    const base = this.app.motionBgOptions();
    const option = own ? entry.frameOptions[this.index] : base;
    this.el('mask-bgmode').value = option.mode;
    this.el('mask-threshold').value = option.threshold;
    this.el('mask-threshold-value').textContent = option.threshold;
  },

  _syncBrushUi() {
    for (const mode of ['erase', 'keep']) {
      this.el(`mask-mode-${mode}`).classList.toggle('seg-on', !this.panMode && this.brush.mode === mode);
    }
    this.el('mask-mode-move').classList.toggle('seg-on', this.panMode);
    this.el('mask-size').value = this.brush.size;
    this.el('mask-size-value').textContent = this.brush.size;
    this.el('mask-soft').value = Math.round(this.brush.softness * 100);
    this.el('mask-soft-value').textContent = Math.round(this.brush.softness * 100);
    this._syncUndoUi();
  },

  _syncUndoUi() {
    this.el('mask-undo').disabled = !this.undoStack.length;
  },

  _pinchState() {
    const points = [...this._pointers.values()];
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    return {
      distance: Math.max(1, distance),
      center: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
      scale: this.view.scale,
      view: { x: this.view.x, y: this.view.y },
    };
  },

  _applyPinch() {
    const points = [...this._pointers.values()];
    if (points.length < 2) return;
    const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
    const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    const start = this._pinch;
    const scale = Math.max(0.1, Math.min(24, start.scale * (distance / start.distance)));
    // つまんだ中心が動かないように、拡大率の変化ぶんだけ原点をずらす
    const ratio = scale / start.scale;
    this.view.scale = scale;
    this.view.x = center.x - (start.center.x - start.view.x) * ratio;
    this.view.y = center.y - (start.center.y - start.view.y) * ratio;
    this._requestDraw();
  },

  _zoomAt(point, factor) {
    const scale = Math.max(0.1, Math.min(24, this.view.scale * factor));
    const ratio = scale / this.view.scale;
    this.view.x = point.x - (point.x - this.view.x) * ratio;
    this.view.y = point.y - (point.y - this.view.y) * ratio;
    this.view.scale = scale;
    this._requestDraw();
  },

  finish() {
    const app = this.app;
    const entry = this._entry();
    // 塗っている途中で閉じられた時のために、作業用の控えを必ず片付ける。
    // 残したまま閉じると、次に開いた時の1筆目で古い状態へ巻き戻ってしまう。
    StudioMask.endStroke(this.mask);
    // 何も塗られていないマスクは持たない（あとの処理を素通しにして軽くする）
    if (entry && this.mask && StudioMask.isEmpty(this.mask)) {
      entry.masks[this.index] = null;
    }
    this.close();
    if (app) app.processFrames();
  },
};

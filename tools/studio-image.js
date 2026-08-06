// ==== モンスター作成スタジオ：画像処理 ====
// 背景透過・余白トリミング・contentBox（キャラ本体のbbox）算出をブラウザだけで行う。
// contentBox はゲーム側で「本体の高さ = hurtboxの高さ」になるスケールを決めるために使われる、
// 表示位置合わせの要となる値。ここを自動で正確に出せることがこのツールの一番の価値。
const StudioImage = {
  // ファイル(またはBlob)を ImageBitmap 相当へ
  async load(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error(`画像を読み込めませんでした: ${file.name || ''}`));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  _ctx(canvas) { return canvas.getContext('2d', { willReadFrequently: true }); },

  // 四隅がすでに透明か（＝背景透過済みの素材か）。
  // 透過済みの画像に背景除去をかけると、四隅の色として黒(0,0,0)が拾われ、
  // 暗い色のキャラクターまで削られてしまうため、必ず先に判定する。
  hasTransparentCorners(canvas) {
    const ctx = this._ctx(canvas);
    const w = canvas.width, h = canvas.height;
    const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
    return [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].every(([x, y]) => alpha(x, y) === 0);
  },

  // 四隅の平均色（背景色の自動推定に使う）
  cornerColor(canvas) {
    const ctx = this._ctx(canvas);
    const w = canvas.width, h = canvas.height;
    const pick = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
    const corners = [pick(0, 0), pick(w - 1, 0), pick(0, h - 1), pick(w - 1, h - 1)];
    return [0, 1, 2].map(i => Math.round(corners.reduce((sum, c) => sum + c[i], 0) / corners.length));
  },

  // 背景透過。
  // mode: 'none' | 'white' | 'black' | 'corner' | 'color'
  // 単純なしきい値だけだと輪郭がギザギザになるため、しきい値付近は半透明にして境界をなじませる。
  removeBackground(canvas, { mode = 'corner', threshold = 30, color = null, feather = 18 } = {}) {
    if (mode === 'none') return canvas;
    // 透過済みの素材に「四隅の色を抜く」を適用しても得るものが無く、害だけあるので何もしない
    if (mode === 'corner' && this.hasTransparentCorners(canvas)) return canvas;
    const target = mode === 'white' ? [255, 255, 255]
      : mode === 'black' ? [0, 0, 0]
      : mode === 'color' && color ? color
      : this.cornerColor(canvas);
    const ctx = this._ctx(canvas);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const inner = threshold;
    const outer = threshold + Math.max(1, feather);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const dr = data[i] - target[0], dg = data[i + 1] - target[1], db = data[i + 2] - target[2];
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      if (distance <= inner) data[i + 3] = 0;
      else if (distance < outer) {
        // 境界をなめらかに（完全な二値化より輪郭がきれいに出る）
        data[i + 3] = Math.round(data[i + 3] * ((distance - inner) / (outer - inner)));
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  },

  // 不透明領域のbbox。alphaMin未満は無視する。
  alphaBounds(canvas, alphaMin = 24) {
    const ctx = this._ctx(canvas);
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    let left = w, top = h, right = -1, bottom = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (data[row + x * 4 + 3] < alphaMin) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < 0) return null;
    return { left, top, right: right + 1, bottom: bottom + 1 };
  },

  // 接地影の検出。
  // 立ち絵の足元にある「暗く・彩度が低く・横に広い」帯を影とみなし、bboxの下端から除外する。
  // 影を含めたまま contentBox にすると、キャラが実際より小さく浮いて表示されてしまう。
  detectShadowTop(canvas, bounds) {
    const ctx = this._ctx(canvas);
    const { width: w } = canvas;
    const data = ctx.getImageData(0, 0, w, canvas.height).data;
    const bodyHeight = bounds.bottom - bounds.top;
    const searchTop = Math.max(bounds.top, bounds.bottom - Math.round(bodyHeight * 0.28));
    let shadowTop = null;
    for (let y = bounds.bottom - 1; y >= searchTop; y--) {
      const row = y * w * 4;
      let opaque = 0, shadowish = 0;
      for (let x = bounds.left; x < bounds.right; x++) {
        const i = row + x * 4;
        if (data[i + 3] < 150) continue;
        opaque++;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max < 70 && max - min < 34) shadowish++; // 暗くて彩度が低い＝影
      }
      if (!opaque) continue;
      // 行の大半が影らしく、かつ十分に横へ広がっている（＝楕円の影）
      if (shadowish / opaque > 0.93 && opaque > (bounds.right - bounds.left) * 0.25) shadowTop = y;
      else if (shadowTop !== null) break; // 影の帯が途切れたところで終了
    }
    return shadowTop;
  },

  // キャラ本体のbbox（= contentBox）。影を除いた値を返す。
  contentBox(canvas, { excludeShadow = true } = {}) {
    const bounds = this.alphaBounds(canvas);
    if (!bounds) return null;
    if (!excludeShadow) return bounds;
    const shadowTop = this.detectShadowTop(canvas, bounds);
    if (shadowTop != null && shadowTop > bounds.top + (bounds.bottom - bounds.top) * 0.5) {
      return { ...bounds, bottom: shadowTop };
    }
    return bounds;
  },

  // 足元(bottom)の手動補正。影の自動検出が合わなかった場合の逃げ道。
  // 上へ詰めるほどキャラは大きく、下へ広げるほど小さく表示される。
  nudgeBottom(box, offset) {
    if (!box || !offset) return box;
    const bottom = Math.max(box.top + 8, box.bottom + offset);
    return { ...box, bottom };
  },

  // 複数コマで共通のcontentBoxを作る。
  // コマごとに別々のboxを使うと、再生時にキャラの大きさや位置がガタつくため必ず統一する。
  unionContentBox(boxes) {
    const valid = boxes.filter(Boolean);
    if (!valid.length) return null;
    return {
      left: Math.min(...valid.map(b => b.left)),
      top: Math.min(...valid.map(b => b.top)),
      right: Math.max(...valid.map(b => b.right)),
      bottom: Math.max(...valid.map(b => b.bottom)),
    };
  },

  // 余白の切り落とし。全コマ共通の矩形で切るので、切った後もcontentBoxの相対位置は保たれる。
  cropAll(canvases, margin = 4) {
    const boxes = canvases.map(c => this.alphaBounds(c));
    const union = this.unionContentBox(boxes);
    if (!union) return { canvases, offset: { x: 0, y: 0 } };
    const maxW = Math.max(...canvases.map(c => c.width));
    const maxH = Math.max(...canvases.map(c => c.height));
    const x = Math.max(0, union.left - margin);
    const y = Math.max(0, union.top - margin);
    const w = Math.min(maxW, union.right + margin) - x;
    const h = Math.min(maxH, union.bottom + margin) - y;
    const cropped = canvases.map(source => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(source, -x, -y);
      return canvas;
    });
    return { canvases: cropped, offset: { x, y } };
  },

  // 長辺がmaxSizeを超える場合だけ縮小する（スマホ写真やAI生成画像はそのままだと大きすぎる）
  limitSize(canvas, maxSize = 720) {
    const longest = Math.max(canvas.width, canvas.height);
    if (longest <= maxSize) return canvas;
    const scale = maxSize / longest;
    const out = document.createElement('canvas');
    out.width = Math.round(canvas.width * scale);
    out.height = Math.round(canvas.height * scale);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  },

  // 正方形に切り出す（ストックアイコン用）
  toSquare(canvas, size = 128) {
    const box = this.contentBox(canvas) || { left: 0, top: 0, right: canvas.width, bottom: canvas.height };
    const side = Math.max(box.right - box.left, box.bottom - box.top);
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const out = document.createElement('canvas');
    out.width = size; out.height = size;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
    return out;
  },

  // 本体の「典型的な幅」。腕やマントで広がった行に引きずられないよう中央値を使う。
  // hurtboxWidth（当たり判定の横幅）の初期値算出に用いる。
  bodyMetrics(canvas, box) {
    const ctx = this._ctx(canvas);
    const { width: w } = canvas;
    const data = ctx.getImageData(0, 0, w, canvas.height).data;
    const widths = [];
    for (let y = box.top; y < box.bottom; y++) {
      const row = y * w * 4;
      let left = -1, right = -1;
      for (let x = box.left; x < box.right; x++) {
        if (data[row + x * 4 + 3] < 150) continue;
        if (left < 0) left = x;
        right = x;
      }
      if (left >= 0) widths.push(right - left + 1);
    }
    if (!widths.length) return { medianWidth: box.right - box.left };
    widths.sort((a, b) => a - b);
    return { medianWidth: widths[Math.floor(widths.length / 2)] };
  },

  async toPngBytes(canvas) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  },

  toDataUrl(canvas) { return canvas.toDataURL('image/png'); },
};

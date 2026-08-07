// ==== モンスター作成スタジオ：スプライトシートの分割 ====
// 1枚のシートに並んだコマを切り出してモーションにする。
//
// 素材は必ずしもきれいに並んでいない（間隔がまちまち・区切り線がある・
// 1コマだけ潰れている等）ため、分け方を3通り用意し、
// どれが妥当かを自動で採点して選ぶ。合わなければ手動で切り替えられる。
//
//   auto … 背景を除いた「中身のある帯」を縦横それぞれ探して交差させる
//          （間隔が不均等でも拾える。いちばん融通が利く）
//   line … 区切り線の色を検出し、線で挟まれた領域をコマとする
//   grid … 行数・列数・余白・すき間から等間隔で割る
//
// 切り出したあとは、格闘ゲーム向けに「足元と体の中心をそろえる」処理を入れる。
// コマごとに余白が違うと、再生した時にキャラクターが小刻みに揺れてしまうため。
const StudioSheet = {
  MAX_DIST: Math.sqrt(255 * 255 * 3),

  _ctx(canvas) { return canvas.getContext('2d', { willReadFrequently: true }); },

  _colorDist(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  },

  // 背景でない画素を1とするマスク。透明はいつでも背景扱い。
  _contentMask(canvas, color, tolerance) {
    const w = canvas.width, h = canvas.height;
    const data = this._ctx(canvas).getImageData(0, 0, w, h).data;
    const limit = (tolerance / 100) * this.MAX_DIST;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (data[o + 3] < 10) continue;
      if (!color) { mask[i] = 1; continue; }
      mask[i] = this._colorDist(data[o], data[o + 1], data[o + 2], color[0], color[1], color[2]) > limit ? 1 : 0;
    }
    return { mask, w, h };
  },

  // 連続した「中身あり」の区間を探す。小さな切れ目(bridge)はつないで1つに見なす。
  // ここでつながないと、キャラクターの隙間（腕と体の間など）で不必要に分割されてしまう。
  _bands(projection, len, bridge, minRun = 1) {
    const bands = [];
    let i = 0;
    while (i < len) {
      if (!projection[i]) { i++; continue; }
      const start = i;
      let j = i;
      while (j < len) {
        if (projection[j]) { j++; continue; }
        let k = j;
        while (k < len && !projection[k]) k++;
        if (k - j <= bridge && k < len) { j = k; continue; }
        break;
      }
      if (j - start >= minRun) bands.push([start, j - 1]);
      i = j;
    }
    return bands;
  },

  _invertBands(bands, len) {
    const out = [];
    let cursor = 0;
    for (const [s, e] of bands) {
      if (s > cursor) out.push([cursor, s - 1]);
      cursor = Math.max(cursor, e + 1);
    }
    if (cursor <= len - 1) out.push([cursor, len - 1]);
    return out;
  },

  // 近すぎる帯どうしをつなぐ。
  // キャラクターは腕と体の間などで縦に隙間が空くため、そこで割れてしまうと
  // 1体が複数のコマに分かれてしまう。コマの大きさに対して十分小さい隙間は
  // 「同じコマの中」とみなしてつなぐ。
  // 隙間の大きさは2種類に分かれる。キャラクターの内側（腕と体の間など）は小さく、
  // コマとコマの間は大きい。そこで「隙間の中央値の半分より狭い所」だけをつなぐ。
  // 帯の幅を基準にすると、コマ同士が近いシートで全部つながってしまうため使わない。
  _mergeClose(bands, gapRatio = 0.5) {
    if (bands.length < 3) return bands;
    const gaps = [];
    for (let i = 1; i < bands.length; i++) gaps.push(bands[i][0] - bands[i - 1][1] - 1);
    const sorted = gaps.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const limit = median * gapRatio;
    const out = [bands[0].slice()];
    for (let i = 1; i < bands.length; i++) {
      const prev = out[out.length - 1];
      if (bands[i][0] - prev[1] - 1 <= limit) prev[1] = bands[i][1];
      else out.push(bands[i].slice());
    }
    return out;
  },

  // 端に多く出る色＝背景（または区切り線）の色
  dominantBorderColor(canvas) {
    const w = canvas.width, h = canvas.height;
    const data = this._ctx(canvas).getImageData(0, 0, w, h).data;
    const tally = new Map();
    const add = (x, y) => {
      const o = (y * w + x) * 4;
      if (data[o + 3] < 10) return;
      const key = `${data[o] >> 4},${data[o + 1] >> 4},${data[o + 2] >> 4}`;
      const e = tally.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += data[o]; e.g += data[o + 1]; e.b += data[o + 2];
      tally.set(key, e);
    };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
    let best = null;
    for (const e of tally.values()) if (!best || e.n > best.n) best = e;
    if (!best) return null;
    return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
  },

  // ---- 分け方その1：中身のある帯の交差 ----
  // 背景色を渡さない場合は端から推定する。渡さないと不透明な背景まで
  // 「中身」として数えてしまい、シート全体が1コマに潰れる。
  autoRects(canvas, { color = null, tolerance = 12 } = {}) {
    const bg = color || this.dominantBorderColor(canvas);
    const { mask, w, h } = this._contentMask(canvas, bg, tolerance);
    const colProj = new Uint32Array(w), rowProj = new Uint32Array(h);
    for (let y = 0; y < h; y++) {
      const rb = y * w;
      for (let x = 0; x < w; x++) if (mask[rb + x]) { colProj[x]++; rowProj[y]++; }
    }
    const rowBands = this._mergeClose(this._bands(rowProj, h, Math.max(2, Math.round(h * 0.01)), 4));
    const colBands = this._mergeClose(this._bands(colProj, w, Math.max(2, Math.round(w * 0.01)), 4));
    // 交差した枠のうち、中身が十分あるものだけ残す（空白の交点を捨てる）
    const rects = [];
    for (const [y0, y1] of rowBands) {
      for (const [x0, x1] of colBands) {
        let sum = 0;
        for (let y = y0; y <= y1; y++) {
          const rb = y * w;
          for (let x = x0; x <= x1; x++) sum += mask[rb + x];
        }
        if (sum > (x1 - x0 + 1) * (y1 - y0 + 1) * 0.02 && sum > 40) {
          rects.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
        }
      }
    }
    return rects;
  },

  // ---- 分け方その2：区切り線 ----
  // 行(列)のほとんどが同じ色で埋まっている所を線とみなし、線に挟まれた所をコマとする。
  detectLineColor(canvas) { return this.dominantBorderColor(canvas); },

  // maxBandRatio: 「線」とみなす帯の太さの上限（辺の長さに対する比）。
  // これを設けないと、背景の色が線として拾われ、キャラクターの隙間でも
  // 切れてしまって細切れになる。区切り線は必ず細いので、太い帯は線ではない。
  lineRects(canvas, { color = null, tolerance = 12, fill = 0.8, maxBandRatio = 0.06 } = {}) {
    const lineColor = color || this.detectLineColor(canvas);
    if (!lineColor) return [];
    const w = canvas.width, h = canvas.height;
    const data = this._ctx(canvas).getImageData(0, 0, w, h).data;
    const limit = (tolerance / 100) * this.MAX_DIST;
    const isLine = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (data[o + 3] < 10) continue;
      isLine[i] = this._colorDist(data[o], data[o + 1], data[o + 2],
        lineColor[0], lineColor[1], lineColor[2]) <= limit ? 1 : 0;
    }
    const rowIsLine = new Uint8Array(h);
    for (let y = 0; y < h; y++) {
      let c = 0; const rb = y * w;
      for (let x = 0; x < w; x++) c += isLine[rb + x];
      rowIsLine[y] = c / w >= fill ? 1 : 0;
    }
    const rowBands = this._bands(rowIsLine, h, Math.max(2, Math.round(h * 0.004)));
    // 太い帯が混ざっていたら、それは区切り線ではなく背景。この分け方は使えない。
    if (!rowBands.length || rowBands.some(([s0, e0]) => e0 - s0 + 1 > h * maxBandRatio)) return [];
    const rowContent = this._invertBands(rowBands, h);
    const rects = [];
    for (const [y0, y1] of rowContent) {
      const bandH = y1 - y0 + 1;
      if (bandH < 4) continue;
      const colIsLine = new Uint8Array(w);
      for (let x = 0; x < w; x++) {
        let c = 0;
        for (let y = y0; y <= y1; y++) c += isLine[y * w + x];
        colIsLine[x] = c / bandH >= fill ? 1 : 0;
      }
      const colBands = this._bands(colIsLine, w, Math.max(2, Math.round(w * 0.004)));
      if (colBands.some(([s0, e0]) => e0 - s0 + 1 > w * maxBandRatio)) return [];
      const colContent = this._invertBands(colBands, w);
      for (const [x0, x1] of colContent) {
        if (x1 - x0 + 1 < 4) continue;
        rects.push({ x: x0, y: y0, w: x1 - x0 + 1, h: bandH });
      }
    }
    return rects;
  },

  // ---- 分け方その3：等間隔 ----
  gridRects(canvas, { rows = 1, cols = 1, margin = 0, gutter = 0 } = {}) {
    const w = canvas.width, h = canvas.height;
    const cellW = (w - 2 * margin - (cols - 1) * gutter) / cols;
    const cellH = (h - 2 * margin - (rows - 1) * gutter) / rows;
    if (cellW <= 0 || cellH <= 0) return [];
    const rects = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        rects.push({
          x: Math.round(margin + c * (cellW + gutter)),
          y: Math.round(margin + r * (cellH + gutter)),
          w: Math.round(cellW), h: Math.round(cellH),
        });
      }
    }
    return rects;
  },

  // ---- どの分け方が妥当かを採点する ----
  // 元のツールは利用者に分け方を選ばせていたが、どれが正解かは見ないと分からない。
  // ここで自動採点して既定を決め、外していた時だけ手で切り替えてもらう。
  scoreRects(canvas, rects) {
    if (!rects || rects.length < 2) return -1;
    if (rects.length > 64) return -1;          // 細かく割れすぎ＝失敗とみなす
    const areas = rects.map(r => r.w * r.h);
    const mean = areas.reduce((a, v) => a + v, 0) / areas.length;
    if (mean < 64) return -1;
    // 極端に小さい枠（＝切り損ねた破片）が混ざっている分け方は採らない
    const sortedAreas = areas.slice().sort((a, v) => a - v);
    const medianArea = sortedAreas[Math.floor(sortedAreas.length / 2)];
    if (Math.min(...areas) < medianArea * 0.25) return -1;
    // 大きさがそろっているほど良い（コマ割りとして自然）
    const sd = Math.sqrt(areas.reduce((a, v) => a + (v - mean) ** 2, 0) / areas.length);
    const uniformity = 1 - Math.min(1, sd / mean);
    // シート全体をどれだけ使えているか
    const coverage = Math.min(1, areas.reduce((a, v) => a + v, 0) / (canvas.width * canvas.height));
    // コマ数は多すぎず少なすぎず（4〜16あたりが素材としてありがち）
    const n = rects.length;
    const countScore = n >= 2 && n <= 24 ? 1 : 0.4;
    return uniformity * 0.5 + coverage * 0.3 + countScore * 0.2;
  },

  // シートを見て、いちばん妥当な分け方と枠を返す
  analyze(canvas, { color = null, tolerance = 12 } = {}) {
    const candidates = [];
    try { candidates.push({ mode: 'line', rects: this.lineRects(canvas, { tolerance }) }); } catch (e) { /* 線が無い素材 */ }
    try { candidates.push({ mode: 'auto', rects: this.autoRects(canvas, { color, tolerance }) }); } catch (e) { /* ignore */ }
    let best = null;
    for (const c of candidates) {
      const score = this.scoreRects(canvas, c.rects);
      if (!best || score > best.score) best = { ...c, score };
    }
    if (!best || best.score < 0) return { mode: 'grid', rects: [], score: -1 };
    return best;
  },

  // ---- 切り出し ----
  cut(canvas, rects) {
    return rects.map(r => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(r.w));
      c.height = Math.max(1, Math.round(r.h));
      c.getContext('2d').drawImage(canvas, r.x, r.y, c.width, c.height, 0, 0, c.width, c.height);
      return c;
    });
  },

  // ---- コマの中身を測る ----
  _bounds(canvas, alphaMin = 24) {
    const w = canvas.width, h = canvas.height;
    const data = this._ctx(canvas).getImageData(0, 0, w, h).data;
    let left = w, top = h, right = -1, bottom = -1, count = 0, sumX = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] < alphaMin) continue;
        count++; sumX += x;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (right < 0) return null;
    return { left, top, right, bottom, count, centerX: sumX / count,
             w: right - left + 1, h: bottom - top + 1 };
  },

  // ---- 足元と体の中心をそろえる ----
  // コマごとに余白の量が違うと、再生した時にキャラクターが小刻みに揺れる。
  // 各コマの「中身の下端」と「横方向の重心」を全コマで合わせた新しいコマを作る。
  // 高さが変わるモーション（崖つかまり等）のために、ずらす量の上限を設けられる。
  alignFeet(canvases, { maxShiftRatio = 0.25 } = {}) {
    const metrics = canvases.map(c => this._bounds(c));
    if (metrics.some(m => !m)) return canvases.slice();
    const outW = Math.max(...canvases.map(c => c.width));
    const outH = Math.max(...canvases.map(c => c.height));
    // 目標は全コマの中央値（極端なコマに引っぱられないように）
    const median = arr => {
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const targetBottom = median(metrics.map((m, i) => m.bottom + (outH - canvases[i].height)));
    const targetCenter = median(metrics.map((m, i) => m.centerX + (outW - canvases[i].width) / 2));
    const limitX = outW * maxShiftRatio, limitY = outH * maxShiftRatio;
    return canvases.map((c, i) => {
      const m = metrics[i];
      const baseX = (outW - c.width) / 2, baseY = outH - c.height;
      let dx = targetCenter - (m.centerX + baseX);
      let dy = targetBottom - (m.bottom + baseY);
      dx = Math.max(-limitX, Math.min(limitX, dx));
      dy = Math.max(-limitY, Math.min(limitY, dy));
      const out = document.createElement('canvas');
      out.width = outW; out.height = outH;
      out.getContext('2d').drawImage(c, Math.round(baseX + dx), Math.round(baseY + dy));
      return out;
    });
  },

  // ---- おかしなコマを見つける ----
  // 「1コマだけ潰れている」「ほとんど空」といった素材を、取り込む前に知らせる。
  findOutliers(canvases) {
    const metrics = canvases.map(c => this._bounds(c));
    const heights = metrics.filter(Boolean).map(m => m.h);
    if (heights.length < 3) return [];
    const sorted = heights.slice().sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    const out = [];
    metrics.forEach((m, i) => {
      if (!m) { out.push({ index: i, reason: '中身がありません' }); return; }
      if (m.h < mid * 0.6) out.push({ index: i, reason: `縦に潰れています（他の${Math.round(m.h / mid * 100)}%）` });
      else if (m.h > mid * 1.6) out.push({ index: i, reason: `縦に伸びています（他の${Math.round(m.h / mid * 100)}%）` });
      else if (m.count < 60) out.push({ index: i, reason: 'ほとんど空です' });
    });
    return out;
  },
};

window.StudioSheet = StudioSheet;

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
  // 画像の縁を一周サンプルして、背景の代表色を集める。
  // 背景にグラデーションがあっても複数色を拾えるため、1色だけを基準にするより強い。
  borderColors(canvas, samples = 40, minDistance = 26) {
    const ctx = this._ctx(canvas);
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    const at = (x, y) => {
      const i = (y * w + x) * 4;
      return data[i + 3] === 0 ? null : [data[i], data[i + 1], data[i + 2]];
    };
    const points = [];
    for (let i = 0; i < samples; i++) {
      const t = i / samples;
      points.push([Math.round(t * (w - 1)), 0]);
      points.push([Math.round(t * (w - 1)), h - 1]);
      points.push([0, Math.round(t * (h - 1))]);
      points.push([w - 1, Math.round(t * (h - 1))]);
    }
    const colors = [];
    for (const [x, y] of points) {
      const c = at(x, y);
      if (!c) continue;
      // 既に拾った色と近ければ数えない（代表色だけを残す）
      if (colors.some(o => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) < minDistance)) continue;
      colors.push(c);
    }
    return colors.length ? colors : [this.cornerColor(canvas)];
  },

  // 指定した位置の色を拾う（スポイト用）
  pickColor(canvas, x, y) {
    const ctx = this._ctx(canvas);
    const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
    const d = ctx.getImageData(px, py, 1, 1).data;
    return d[3] === 0 ? null : [d[0], d[1], d[2]];
  },

  // 背景を「1枚の絵の中で場所によって変わるもの」として推定する。
  //
  // 縁の色を代表色として集める方式は、被写体が画像の縁に接していると破綻する。
  // 縁に写り込んだ被写体の色まで「背景の代表色」として登録され、
  // 塗りつぶしが本体を内側から食べてしまうため。
  // （実測：黄色いモンスターが左端と下端で切れている絵で、本体色と代表色の距離が5.7。
  //   しきい値30を大きく下回るので本体がほぼ全部消え、逆に背景は残った）
  //
  // そこで、縁のピクセルにチャンネルごとの2次曲面を当てはめ、
  // 「この座標なら背景は何色のはず」を予測できるようにする。
  // 当てはめは残差の大きい点を落としながら繰り返す（ロバスト回帰）。
  // こうすると、縁に写り込んだ被写体は外れ値として自動的に無視される。
  //
  // 次数を3以上に上げると、縁の被写体まで曲面が追いかけてしまい逆に悪化する（実測済み）。
  // 背景のグラデーションを追うには2次で足りる。
  // 当てはめは「粗いモデルから順に」行う。
  // いきなり2次曲面を当てると、曲面が柔らかすぎて被写体の側へ曲がってしまい、
  // 「被写体のいる場所の背景は被写体色」という当てはめになって本体が全部消える
  // （実測：縁の38%が被写体の絵で、被写体位置の予測背景が被写体色そのものになった）。
  // まず定数（＝中央値）だけで大きく外れた点を落とし、次に平面、最後に2次曲面と
  // 自由度を上げていけば、被写体は最初の段階で外れ値として除かれる。
  // tolerance は段階が進むほど厳しくする。
  FIT_STAGES: [
    { terms: 1, tolerance: 3.5 },   // 定数（中央値）
    { terms: 3, tolerance: 3.0 },   // 平面
    { terms: 6, tolerance: 2.5 },   // 2次曲面
    { terms: 6, tolerance: 2.5 },
  ],

  fitBackgroundSurface(canvas) {
    const ctx = this._ctx(canvas);
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;

    // 縁のピクセルを全部集める（間引くと外れ値の判定が不安定になる）
    const px = [], py = [], pr = [], pg = [], pb = [];
    const add = (x, y) => {
      const i = (y * w + x) * 4;
      if (data[i + 3] === 0) return;             // 既に透明なところは手がかりにならない
      px.push(x); py.push(y);
      pr.push(data[i]); pg.push(data[i + 1]); pb.push(data[i + 2]);
    };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
    const n = px.length;
    if (n < 60) return null;

    // 基底 [1, X, Y, X^2, XY, Y^2]（X,Y は -1〜1 に正規化）
    const TERMS = 6;
    const basis = new Float64Array(n * TERMS);
    for (let k = 0; k < n; k++) {
      const X = (px[k] / (w - 1)) * 2 - 1;
      const Y = (py[k] / (h - 1)) * 2 - 1;
      const o = k * TERMS;
      basis[o] = 1; basis[o + 1] = X; basis[o + 2] = Y;
      basis[o + 3] = X * X; basis[o + 4] = X * Y; basis[o + 5] = Y * Y;
    }

    const channels = [pr, pg, pb];
    const keep = new Uint8Array(n).fill(1);
    let coef = null;

    for (let stage = 0; stage < this.FIT_STAGES.length; stage++) {
      const { terms, tolerance } = this.FIT_STAGES[stage];
      let fitted;
      if (terms === 1) {
        // 定数だけの段階は、平均ではなく中央値を使う。
        // 半分近くが被写体でも中央値なら背景側に留まる。
        fitted = channels.map(values => {
          const sample = [];
          for (let k = 0; k < n; k++) if (keep[k]) sample.push(values[k]);
          sample.sort((a, b) => a - b);
          const out = new Float64Array(TERMS);
          out[0] = sample[sample.length >> 1];
          return out;
        });
      } else {
        // 正規方程式 (BᵀB)c = Bᵀt をチャンネルごとに解く（先頭 terms 個の基底だけ使う）
        const A = new Float64Array(terms * terms);
        const rhs = [new Float64Array(terms), new Float64Array(terms), new Float64Array(terms)];
        let used = 0;
        for (let k = 0; k < n; k++) {
          if (!keep[k]) continue;
          used++;
          const o = k * TERMS;
          for (let a = 0; a < terms; a++) {
            const ba = basis[o + a];
            for (let b = 0; b < terms; b++) A[a * terms + b] += ba * basis[o + b];
            for (let c = 0; c < 3; c++) rhs[c][a] += ba * channels[c][k];
          }
        }
        if (used < terms * 4) break;      // 手がかりが足りない：ここまでの結果を使う
        const solved = [0, 1, 2].map(c => this._solve(A.slice(), rhs[c].slice(), terms));
        if (solved.some(s => !s)) break;  // 解けない：ここまでの結果を使う
        fitted = solved.map(s => { const out = new Float64Array(TERMS); out.set(s); return out; });
      }
      coef = fitted;
      if (stage === this.FIT_STAGES.length - 1) break;

      // 残差の中央値とMADで外れ値（＝縁に写り込んだ被写体）を落とす
      const residuals = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const o = k * TERMS;
        let sum = 0;
        for (let c = 0; c < 3; c++) {
          let predicted = 0;
          for (let a = 0; a < terms; a++) predicted += basis[o + a] * coef[c][a];
          const d = predicted - channels[c][k];
          sum += d * d;
        }
        residuals[k] = Math.sqrt(sum);
      }
      const sorted = Float64Array.from(residuals).sort();
      const median = sorted[sorted.length >> 1];
      const deviations = Float64Array.from(residuals, r => Math.abs(r - median)).sort();
      const mad = deviations[deviations.length >> 1] || 1e-6;
      const limit = median + tolerance * 1.4826 * mad;
      let survivors = 0;
      for (let k = 0; k < n; k++) { keep[k] = residuals[k] < limit ? 1 : 0; survivors += keep[k]; }
      // 縁のほとんどが被写体で埋まっている絵では、これ以上絞っても当てにならない
      if (survivors < n * 0.2) return coef;
    }
    return coef;
  },

  // 6元1次連立方程式をガウスの消去法（部分ピボット選択）で解く
  _solve(A, b, size) {
    for (let col = 0; col < size; col++) {
      let pivot = col;
      for (let row = col + 1; row < size; row++) {
        if (Math.abs(A[row * size + col]) > Math.abs(A[pivot * size + col])) pivot = row;
      }
      if (Math.abs(A[pivot * size + col]) < 1e-9) return null;   // 解けない（縁が単調すぎる等）
      if (pivot !== col) {
        for (let k = 0; k < size; k++) {
          const t = A[col * size + k]; A[col * size + k] = A[pivot * size + k]; A[pivot * size + k] = t;
        }
        const t = b[col]; b[col] = b[pivot]; b[pivot] = t;
      }
      const diag = A[col * size + col];
      for (let row = col + 1; row < size; row++) {
        const factor = A[row * size + col] / diag;
        if (!factor) continue;
        for (let k = col; k < size; k++) A[row * size + k] -= factor * A[col * size + k];
        b[row] -= factor * b[col];
      }
    }
    const x = new Float64Array(size);
    for (let row = size - 1; row >= 0; row--) {
      let sum = b[row];
      for (let k = row + 1; k < size; k++) sum -= A[row * size + k] * x[k];
      x[row] = sum / A[row * size + row];
    }
    return x;
  },

  // 本体から離れた小さな残りかすを消す。
  // 背景を場所ごとに推定しても、草地のような細かい模様は少しだけ残る。
  // それらは本体とつながっていない小さな島になるので、大きさで捨てられる。
  // 手に持った武器のように「離れているが必要な部分」を消さないよう、
  // 最大の塊に対する割合で判断する（既定2%）。
  removeSpecks(canvas, { minRatio = 0.02, alphaMin = 40 } = {}) {
    const ctx = this._ctx(canvas);
    const { width: w, height: h } = canvas;
    const image = ctx.getImageData(0, 0, w, h);
    const data = image.data;
    const label = new Int32Array(w * h).fill(-1);
    const sizes = [];
    const stack = [];
    for (let start = 0; start < w * h; start++) {
      if (label[start] !== -1 || data[start * 4 + 3] < alphaMin) continue;
      const id = sizes.length;
      let count = 0;
      label[start] = id; stack.push(start);
      while (stack.length) {
        const p = stack.pop();
        count++;
        const x = p % w, y = (p - (p % w)) / w;
        if (x > 0)     { const q = p - 1; if (label[q] === -1 && data[q * 4 + 3] >= alphaMin) { label[q] = id; stack.push(q); } }
        if (x < w - 1) { const q = p + 1; if (label[q] === -1 && data[q * 4 + 3] >= alphaMin) { label[q] = id; stack.push(q); } }
        if (y > 0)     { const q = p - w; if (label[q] === -1 && data[q * 4 + 3] >= alphaMin) { label[q] = id; stack.push(q); } }
        if (y < h - 1) { const q = p + w; if (label[q] === -1 && data[q * 4 + 3] >= alphaMin) { label[q] = id; stack.push(q); } }
      }
      sizes.push(count);
    }
    if (sizes.length < 2) return canvas;
    const largest = Math.max(...sizes);
    const floor = largest * minRatio;
    let removed = 0;
    for (let p = 0; p < w * h; p++) {
      const id = label[p];
      if (id === -1) continue;
      if (sizes[id] >= floor) continue;
      data[p * 4 + 3] = 0;
      removed++;
    }
    if (removed) ctx.putImageData(image, 0, 0);
    return canvas;
  },

  // 背景透過。
  // 「画像全体で色が一致するピクセルを消す」のではなく、
  // 画像の縁（とスポイトで指した位置）から色がつながっている範囲だけを消す。
  // こうするとキャラクターの内側にある同系色は残るため、
  // 背景と同じ色の服や装備が欠けてしまう事故が起きない。
  //
  // mode が 'surface' の時だけ、比べる相手が「代表色の一覧」ではなく
  // 「その座標で予測した背景色」になる（→ fitBackgroundSurface）。
  // 塗りつぶしの手順そのものは全モード共通。
  removeBackground(canvas, { mode = 'corner', threshold = 30, color = null,
                             feather = 18, extraColors = [], seeds = [],
                             despeckle = null, speckRatio = 0.02 } = {}) {
    if (mode === 'none') return canvas;
    if ((mode === 'corner' || mode === 'surface')
        && this.hasTransparentCorners(canvas) && !extraColors.length) return canvas;

    let surface = null;
    if (mode === 'surface') {
      surface = this.fitBackgroundSurface(canvas);
      // 当てはめられない絵（縁がほぼ一色、極端に小さい等）は従来方式へ落とす
      if (!surface) mode = 'corner';
    }

    let targets;
    if (mode === 'white') targets = [[255, 255, 255]];
    else if (mode === 'black') targets = [[0, 0, 0]];
    else if (mode === 'color' && color) targets = [color];
    else if (mode === 'surface') targets = [];
    else targets = this.borderColors(canvas);
    targets = targets.concat(extraColors.filter(Boolean));

    const ctx = this._ctx(canvas);
    const { width: w, height: h } = canvas;
    const image = ctx.getImageData(0, 0, w, h);
    const data = image.data;
    const inner = threshold;
    const outer = threshold + Math.max(1, feather);

    // その座標で予測した背景色との距離。曲面を使わないモードでは常に未使用。
    // 塗りつぶしは行順に進まないので、Yを含む項は先に全行ぶん計算しておく。
    // こうすると1画素あたり掛け算2回で済む。
    let surfaceDistance = null;
    if (surface) {
      const c0 = new Float64Array(h * 3);   // 定数項
      const c1 = new Float64Array(h * 3);   // X の係数
      const c2 = [surface[0][3], surface[1][3], surface[2][3]];  // X^2 の係数（Yに依らない）
      for (let y = 0; y < h; y++) {
        const Y = (y / (h - 1)) * 2 - 1;
        for (let c = 0; c < 3; c++) {
          const k = surface[c];
          c0[y * 3 + c] = k[0] + k[2] * Y + k[5] * Y * Y;
          c1[y * 3 + c] = k[1] + k[4] * Y;
        }
      }
      surfaceDistance = (i, x, y) => {
        const X = (x / (w - 1)) * 2 - 1;
        const XX = X * X;
        const row = y * 3;
        let sum = 0;
        for (let c = 0; c < 3; c++) {
          const predicted = c0[row + c] + c1[row + c] * X + c2[c] * XX;
          const d = data[i + c] - predicted;
          sum += d * d;
        }
        return Math.sqrt(sum);
      };
    }

    const distanceToTargets = (i, x, y) => {
      // スポイトで足した色は、曲面モードでも「ここは背景」として効かせる
      let best = surfaceDistance ? surfaceDistance(i, x, y) : Infinity;
      for (const t of targets) {
        const dr = data[i] - t[0], dg = data[i + 1] - t[1], db = data[i + 2] - t[2];
        const d = Math.sqrt(dr * dr + dg * dg + db * db);
        if (d < best) best = d;
      }
      return best;
    };

    const visited = new Uint8Array(w * h);
    const stack = [];
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const p = y * w + x;
      if (visited[p]) return;
      visited[p] = 1;
      stack.push(p);
    };
    // 種：画像の四辺すべてと、スポイトで指した位置
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    for (const seed of seeds) push(Math.round(seed.x), Math.round(seed.y));

    while (stack.length) {
      const p = stack.pop();
      const i = p * 4;
      if (data[i + 3] === 0) {
        // 既に透明なところは通り抜けて、その先も調べる
        const x = p % w, y = (p - (p % w)) / w;
        push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
        continue;
      }
      const x = p % w, y = (p - (p % w)) / w;
      const distance = distanceToTargets(i, x, y);
      if (distance >= outer) continue;              // 背景ではない：ここで止まる
      if (distance <= inner) data[i + 3] = 0;
      else data[i + 3] = Math.round(data[i + 3] * ((distance - inner) / (outer - inner)));
      push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
    }

    ctx.putImageData(image, 0, 0);
    // 残りかす消しは、既定では曲面モードだけ。従来モードの結果は変えない。
    const wantSpeck = despeckle === null ? surface !== null : despeckle;
    if (wantSpeck) this.removeSpecks(canvas, { minRatio: speckRatio });
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

  // 攻撃コマと待機（構え）コマの差分から「武器・エフェクトの領域」を求める。
  // 体はほぼ同じ位置にあるので、増えた部分＝振っている武器やエフェクトになる。
  // これを当たり判定に使うことで、斧が後方→頭上→前方と動けば判定も一緒に動く。
  weaponRegion(frameCanvas, baseCanvas, { alphaMin = 110, colorDelta = 60 } = {}) {
    const w = Math.min(frameCanvas.width, baseCanvas.width);
    const h = Math.min(frameCanvas.height, baseCanvas.height);
    const frame = this._ctx(frameCanvas).getImageData(0, 0, frameCanvas.width, frameCanvas.height).data;
    const base = this._ctx(baseCanvas).getImageData(0, 0, baseCanvas.width, baseCanvas.height).data;
    const fw = frameCanvas.width, bw = baseCanvas.width;
    let left = w, top = h, right = -1, bottom = -1, count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fi = (y * fw + x) * 4;
        if (frame[fi + 3] < alphaMin) continue;
        const bi = (y * bw + x) * 4;
        const baseOpaque = base[bi + 3] >= alphaMin;
        // 構えコマで透明だった場所に何か現れた or 同じ場所の色が大きく変わった
        let changed = !baseOpaque;
        if (!changed) {
          const diff = Math.abs(frame[fi] - base[bi]) + Math.abs(frame[fi + 1] - base[bi + 1])
            + Math.abs(frame[fi + 2] - base[bi + 2]);
          changed = diff > colorDelta * 3;
        }
        if (!changed) continue;
        count++;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    // 差分が小さすぎる（ほぼ同じ絵）場合は判定を作らない
    if (right < 0 || count < 40) return null;
    return { left, top, right: right + 1, bottom: bottom + 1, pixels: count };
  },

  // 画像座標の矩形を「足元中央を原点・当たり判定の高さを1」とした相対座標へ変換する。
  // ゲーム側はこの相対値をキャラの大きさに掛けるので、体格が違っても同じ振り方になる。
  toRelativeBox(rect, contentBox, scale = 1) {
    const unit = contentBox.bottom - contentBox.top;
    if (!unit) return null;
    const originX = (contentBox.left + contentBox.right) / 2;
    const originY = contentBox.bottom;
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    const width = ((rect.right - rect.left) / unit) * scale;
    const height = ((rect.bottom - rect.top) / unit) * scale;
    return {
      x: Number((((cx - originX) / unit) - width / 2).toFixed(3)),
      y: Number((((cy - originY) / unit) - height / 2).toFixed(3)),
      w: Number(width.toFixed(3)),
      h: Number(height.toFixed(3)),
    };
  },

  async toPngBytes(canvas) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  },

  toDataUrl(canvas) { return canvas.toDataURL('image/png'); },
};

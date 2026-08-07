// ==== マスモンのスキン（色変更） ====
// 設計は docs/skin-design.md を参照。
//
// 【この方式にした理由】
// 領域（マスク画像）ではなく「色」で置き換える。こうすると専用モーションの
// 全コマへ作業ゼロで反映され、保存データも数百バイトで済む。
//
// 【v1からの作り直し】
// v1は色相を20°刻みのバケツにまとめていたが、イルミネで実測したところ
// 1つのバケツが全画素の47%を占め、しかも頭・胴・脚の全身に散らばっていた。
// 明度と彩度を見ずに色相だけで分けていたため、同じ紫のマント・ドレス・
// ブーツが1つに潰れ、塗り分けができなかった。
// v2では OKLab（知覚的に均等な色空間）で k-means クラスタリングし、
// 明度・彩度も含めて「素材」に分ける。同じ実測で最大クラスタは13.3%まで下がり、
// 14個中9個が特定の部位へ50%以上偏るようになった（ブーツ91%・胴72%など）。
//
// 【色の置き換え方】
// v1は色相と彩度だけ差し替えて明度を据え置いていた。これだと暗い紫の素材に
// 明るい黄色を指定しても「暗い黄土色」にしかならず、思った色にならなかった。
// v2は素材の中心色を基準にした相対値で置き換える。
//   新しい色 = 選んだ色 + (元の画素 − 素材の中心色) × 保持率
// 明るさの起伏（陰影とハイライト）は相対差として残るので立体感は保たれ、
// 全体の色みは選んだ色そのものになる。
const Skin = {
  VERSION: 2,
  // 素材の数。多いほど細かく塗り分けられるが、同じパーツの陰影まで分かれてしまう。
  // 実測（イルミネ・デュラハン）で、部位への偏りと分かれすぎのバランスが良かった数。
  MATERIAL_COUNT: 14,
  // 素材内の色みのばらつきをどれだけ残すか。0で完全な単色、1で元のばらつきのまま。
  CHROMA_KEEP: 0.45,
  // 明暗の起伏をどれだけ残すか。1で元のコントラストのまま。
  LIGHT_KEEP: 1,

  // ---- 色空間の変換 ----
  // sRGB ↔ OKLab。OKLabは「数値の距離＝見た目の違い」が揃っているため、
  // クラスタリングの結果が人間の感じるまとまりと一致しやすい。
  _toLinear(v) {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  },

  _toSrgb(v) {
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(s * 255)));
  },

  rgbToOklab(r, g, b) {
    const R = this._toLinear(r), G = this._toLinear(g), B = this._toLinear(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  },

  oklabToRgb(L, a, bb) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * bb) ** 3;
    return [
      this._toSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      this._toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      this._toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ];
  },

  hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },

  rgbToHex(rgb) {
    return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  },

  // ---- 素材の抽出（OKLabでのk-means） ----
  // 返り値: [{ lab:[L,a,b], hex, ratio }] を占有率の高い順に。
  // 初期値を明度順に等間隔で置き、乱数を使わないので毎回同じ結果になる。
  // （ゲーム側とスタジオで違う分け方になると塗り替えが食い違うため）
  extractMaterials(canvas, { count = this.MATERIAL_COUNT, minRatio = 0.004 } = {}) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return [];
    const data = ctx.getImageData(0, 0, w, h).data;

    // 画素が多いと重いので、上限を決めて間引いて学習する（割り当ては全画素に効く）
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
    const pts = [];
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 40) continue;
        pts.push(this.rgbToOklab(data[i], data[i + 1], data[i + 2]));
      }
    }
    if (!pts.length) return [];

    // 初期の中心：明度順に並べて等間隔に取る（乱数なしで再現性を保つ）
    const sorted = pts.slice().sort((p, q) => p[0] - q[0]);
    const K = Math.max(1, Math.min(count, sorted.length));
    let centers = [];
    for (let k = 0; k < K; k++) centers.push(sorted[Math.floor(sorted.length * (k + 0.5) / K)].slice());

    const assign = new Int32Array(pts.length);
    for (let iter = 0; iter < 24; iter++) {
      let moved = false;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        let best = 0, bd = Infinity;
        for (let k = 0; k < K; k++) {
          const c = centers[k];
          const dL = p[0] - c[0], da = p[1] - c[1], db = p[2] - c[2];
          const dist = dL * dL + da * da + db * db;
          if (dist < bd) { bd = dist; best = k; }
        }
        if (assign[i] !== best) { assign[i] = best; moved = true; }
      }
      const sum = Array.from({ length: K }, () => [0, 0, 0, 0]);
      for (let i = 0; i < pts.length; i++) {
        const s = sum[assign[i]], p = pts[i];
        s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
      }
      for (let k = 0; k < K; k++) {
        if (sum[k][3]) centers[k] = [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]];
      }
      if (!moved) break;
    }

    const counts = new Array(K).fill(0);
    for (let i = 0; i < pts.length; i++) counts[assign[i]]++;
    // ここで保存と同じ精度に丸めておく。あとから丸めると、編集画面で作った値と
    // 保存された値がわずかにずれ、「同じ内容なのに別物」と判定されてしまう。
    return centers
      .map(c => c.map(v => Number(v.toFixed(4))))
      .map((lab, k) => ({ lab, ratio: counts[k] / pts.length, hex: this.rgbToHex(this.oklabToRgb(lab[0], lab[1], lab[2])) }))
      .filter(m => m.ratio >= minRatio)
      .sort((a, b) => b.ratio - a.ratio);
  },

  // ---- 選択範囲の広げ方 ----
  // k-meansは明度でも分かれるため、同じ布の「影・中間・ハイライト」が
  // 別々の素材になることがある。一方でイルミネのように全身が同じ色相の
  // キャラでは、色相でまとめると全身が1つに戻ってしまう。
  // どちらも固定のしきい値では決められないため、「どこまで一緒に塗るか」を
  // 利用者が広さで決められるようにする（写真アプリの自動選択の許容値と同じ考え方）。
  //
  // tolerance: 0〜1。0なら選んだ素材だけ、大きいほど色の近い素材も巻き込む。
  relatedMaterials(materials, seedIndex, tolerance = 0) {
    const seed = materials[seedIndex];
    if (!seed) return [];
    if (tolerance <= 0) return [seedIndex];
    // OKLabでの距離。明度差より色み差を重く見て、
    // 「同じ布の影」は入りやすく「別の色の布」は入りにくくする。
    const limit = tolerance * 0.38;
    const picked = [];
    for (let k = 0; k < materials.length; k++) {
      const c = materials[k].lab, s = seed.lab;
      const dL = (c[0] - s[0]) * 0.55;
      const da = c[1] - s[1], db = c[2] - s[2];
      if (Math.sqrt(dL * dL + da * da + db * db) <= limit) picked.push(k);
    }
    return picked.length ? picked : [seedIndex];
  },

  // 選択中の素材がどこにあるかを示すマスク（編集画面の光らせる表示に使う）。
  // 選んだ素材の画素だけを白く、それ以外は透明にしたキャンバスを返す。
  selectionMask(source, materials, selected) {
    if (typeof document === 'undefined') return null;
    const set = new Set(selected);
    const w = source.width, h = source.height;
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(source, 0, 0);
    const image = sctx.getImageData(0, 0, w, h);
    const data = image.data;
    const cache = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) { data[i + 3] = 0; continue; }
      const ck = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      let k = cache.get(ck);
      if (k === undefined) {
        k = this.materialIndexOf(this.rgbToOklab(data[i], data[i + 1], data[i + 2]), materials);
        cache.set(ck, k);
      }
      const on = set.has(k);
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = on ? 255 : 0;
    }
    sctx.putImageData(image, 0, 0);
    return src;
  },

  // ある色がどの素材に属するか（OKLabで最も近い中心）
  materialIndexOf(lab, materials) {
    let best = -1, bd = Infinity;
    for (let k = 0; k < materials.length; k++) {
      const c = materials[k].lab;
      const dL = lab[0] - c[0], da = lab[1] - c[1], db = lab[2] - c[2];
      const dist = dL * dL + da * da + db * db;
      if (dist < bd) { bd = dist; best = k; }
    }
    return best;
  },

  // ---- スキンの形 ----
  // { version: 2, materials: [{ lab:[L,a,b], color:'#rrggbb'|null }] }
  //   lab   … その素材の中心色（抽出時に決まる。塗り替えの基準になる）
  //   color … 新しい色。null なら元の色のまま。
  isEmpty(skin) {
    if (!skin) return true;
    if (skin.version === 2 || Array.isArray(skin.materials)) {
      return !(skin.materials || []).some(m => m && m.color);
    }
    // v1（色相バケツ）のデータ
    const groups = skin.groups || {};
    const splits = skin.splits || [];
    return Object.keys(groups).length === 0 && splits.length === 0;
  },

  cacheKey(skin) {
    if (this.isEmpty(skin)) return '';
    if (skin.version === 2 || Array.isArray(skin.materials)) {
      return 'v2:' + (skin.materials || [])
        .map(m => m && m.color ? `${m.lab.map(v => v.toFixed(3)).join(':')}>${m.color}` : '-')
        .join(',');
    }
    const groups = Object.entries(skin.groups || {}).sort().map(([k, v]) => `${k}:${v}`).join(',');
    const splits = (skin.splits || []).map(s =>
      `${s.key}@${s.rect.x},${s.rect.y},${s.rect.w},${s.rect.h}:${s.color}`).join(',');
    return `v1:${groups}|${splits}`;
  },

  // ---- 塗り替え ----
  // 元画像を塗り替えた新しいキャンバスを返す。元画像は変更しない。
  // 透明な画素とアルファ値には一切触らないので、背景や輪郭のぼかしは崩れない。
  recolor(source, skin) {
    if (this.isEmpty(skin) || typeof document === 'undefined') return source;
    if (!(skin.version === 2 || Array.isArray(skin.materials))) return this._recolorV1(source, skin);

    const w = source.width, h = source.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, w, h);
    const data = image.data;

    // 塗り替える素材だけ、変換に使う値を先に用意しておく
    const materials = skin.materials || [];
    const targets = materials.map(m => {
      if (!m || !m.color) return null;
      const rgb = this.hexToRgb(m.color);
      if (!rgb) return null;
      return this.rgbToOklab(rgb[0], rgb[1], rgb[2]);
    });
    if (!targets.some(Boolean)) return source;

    // 同じ色を何度も計算しないよう覚えておく（数万色でも数十msで済む）
    const cache = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      const ck = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      let next = cache.get(ck);
      if (next === undefined) {
        const lab = this.rgbToOklab(data[i], data[i + 1], data[i + 2]);
        const k = this.materialIndexOf(lab, materials);
        const target = k >= 0 ? targets[k] : null;
        if (!target) {
          next = null;
        } else {
          // 素材の中心からのズレ（＝陰影と色みのゆらぎ）を保ったまま中心だけ移す
          const c = materials[k].lab;
          const L = target[0] + (lab[0] - c[0]) * this.LIGHT_KEEP;
          const a = target[1] + (lab[1] - c[1]) * this.CHROMA_KEEP;
          const b = target[2] + (lab[2] - c[2]) * this.CHROMA_KEEP;
          next = this.oklabToRgb(Math.max(0, Math.min(1, L)), a, b);
        }
        cache.set(ck, next);
      }
      if (!next) continue;
      data[i] = next[0]; data[i + 1] = next[1]; data[i + 2] = next[2];
    }
    ctx.putImageData(image, 0, 0);
    return out;
  },

  // v1（色相バケツ）で保存されたスキンを、そのままの見た目で再現するための旧処理。
  // 既に保存されているマスモンの色が更新で変わってしまわないよう残してある。
  _recolorV1(source, skin) {
    const w = source.width, h = source.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, w, h);
    const data = image.data;
    const groups = skin.groups || {};
    const splits = (skin.splits || []).filter(s => s && s.rect && s.color);
    const cache = new Map();
    const rgbToHsl = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = (mx + mn) / 2;
      if (mx === mn) return [0, 0, l];
      const dd = mx - mn;
      const s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      let hh;
      if (mx === r) hh = ((g - b) / dd + (g < b ? 6 : 0));
      else if (mx === g) hh = (b - r) / dd + 2;
      else hh = (r - g) / dd + 4;
      return [hh * 60, s, l];
    };
    const hslToRgb = (hh, s, l) => {
      hh = ((hh % 360) + 360) % 360;
      if (s <= 0) { const v = Math.round(l * 255); return [v, v, v]; }
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
      const m = l - c / 2;
      let r = 0, g = 0, b = 0;
      if (hh < 60) [r, g, b] = [c, x, 0];
      else if (hh < 120) [r, g, b] = [x, c, 0];
      else if (hh < 180) [r, g, b] = [0, c, x];
      else if (hh < 240) [r, g, b] = [0, x, c];
      else if (hh < 300) [r, g, b] = [x, 0, c];
      else [r, g, b] = [c, 0, x];
      return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    };
    const groupKeyOf = (r, g, b) => {
      const [hh, s, l] = rgbToHsl(r, g, b);
      if (s < 0.12) return `gray${Math.min(2, Math.floor(l * 3))}`;
      return `hue${Math.round(hh / 20) % 18}`;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 8) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = groupKeyOf(r, g, b);
        let hex = null;
        for (const split of splits) {
          const rc = split.rect;
          if (split.key === key && x >= rc.x && y >= rc.y && x < rc.x + rc.w && y < rc.y + rc.h) { hex = split.color; break; }
        }
        if (!hex) hex = groups[key] || null;
        if (!hex) continue;
        const ck = `${(r << 16) | (g << 8) | b}${hex}`;
        let next = cache.get(ck);
        if (next === undefined) {
          const target = this.hexToRgb(hex);
          if (!target) { cache.set(ck, null); continue; }
          const [, , l] = rgbToHsl(r, g, b);
          const [th, ts] = rgbToHsl(target[0], target[1], target[2]);
          next = hslToRgb(th, ts, l);
          cache.set(ck, next);
        }
        if (!next) continue;
        data[i] = next[0]; data[i + 1] = next[1]; data[i + 2] = next[2];
      }
    }
    ctx.putImageData(image, 0, 0);
    return out;
  },

  // 同じ (画像, スキン) の組み合わせを何度も塗り直さないためのキャッシュ
  _cache: new Map(),

  // src は Image でも Canvas でもよい。塗り替え不要ならそのまま返す。
  apply(src, skin, id) {
    if (!src || this.isEmpty(skin)) return src;
    const key = `${id || (src.src || '')}#${this.cacheKey(skin)}`;
    const hit = this._cache.get(key);
    if (hit) return hit;
    const w = src.naturalWidth || src.width;
    const h = src.naturalHeight || src.height;
    if (!w || !h) return src;
    const base = document.createElement('canvas');
    base.width = w; base.height = h;
    base.getContext('2d').drawImage(src, 0, 0);
    const out = this.recolor(base, skin);
    this._cache.set(key, out);
    return out;
  },

  // ---- HTML側（<img> や背景画像）へ反映するための入口 ----
  // キャンバスは <img> に入れられないため、データURLへ変換して使う。
  _urlCache: new Map(),   // 変換中のものも含む（Promise）
  _urlReady: new Map(),   // 変換済み（文字列）。待たずに差し込めるので点滅を防げる。

  dataUrl(src, skin) {
    if (!src || this.isEmpty(skin) || typeof document === 'undefined') return Promise.resolve(src);
    const key = `${src}#${this.cacheKey(skin)}`;
    const hit = this._urlCache.get(key);
    if (hit) return hit;
    const task = new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const out = this.apply(img, skin, src);
          resolve(out === img ? src : out.toDataURL('image/png'));
        } catch (e) {
          console.warn('[Skin] 塗り替えに失敗しました:', src, e);
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
    task.then(url => this._urlReady.set(key, url));
    this._urlCache.set(key, task);
    return task;
  },

  // 要素へ塗り替え済みの絵を割り当てる。
  // 先に元の絵を入れてから差し替えるので、変換を待つ間も空白にならない。
  paintInto(el, src, skin, { background = false } = {}) {
    if (!el || !src) return;
    const assign = url => {
      if (background) el.style.backgroundImage = `url('${url}')`;
      else el.src = url;
    };
    if (this.isEmpty(skin)) { assign(src); return; }
    // 変換済みなら待たずに入れる（コマ送りのたびに元の色が一瞬見えるのを防ぐ）
    const ready = this._urlReady.get(`${src}#${this.cacheKey(skin)}`);
    if (ready) { assign(ready); return; }
    assign(src);
    this.dataUrl(src, skin).then(url => { if (url && url !== src) assign(url); });
  },

  clearCache() { this._cache.clear(); this._urlCache.clear(); this._urlReady.clear(); },
};

if (typeof window !== 'undefined') window.Skin = Skin;

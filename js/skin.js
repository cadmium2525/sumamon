// ==== マスモンのスキン（色変更） ====
// 設計は docs/skin-design.md を参照。
//
// 領域ではなく「色」で塗り替えるため、専用モーションを含む全てのコマ画像へ
// 作業ゼロで反映される。保存するのは「グループ→色」の対応表だけなので小さく、
// マルチ対戦の相手へも同期できる。
//
// 置き換えは HSL の H(色相)/S(彩度) だけを差し替え、L(明度) は元のまま残す。
// こうすると陰影とハイライトが保たれ、べた塗りにならない。
const Skin = {
  // 色相をこの幅でまとめてグループにする（度）
  HUE_STEP: 20,
  // 彩度がこれ未満は「無彩色（白・黒・灰）」として色相と切り離して扱う
  GRAY_SATURATION: 0.12,

  // ---- 色空間の変換 ----
  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn;
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h;
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  },

  hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    if (s <= 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
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

  // ---- 色グループ ----
  // 1ピクセルがどのグループに属するかを表すキー。
  // 無彩色は明度3段でまとめ、色付きは色相で分ける。
  groupKeyOf(r, g, b) {
    const [h, s] = this.rgbToHsl(r, g, b);
    if (s < this.GRAY_SATURATION) {
      const [, , l] = this.rgbToHsl(r, g, b);
      return `gray${Math.min(2, Math.floor(l * 3))}`;
    }
    return `hue${Math.round(h / this.HUE_STEP) % Math.round(360 / this.HUE_STEP)}`;
  },

  // 画像から色グループを取り出す。占有率の高い順に最大 limit 個返す。
  // 返り値: [{ key, ratio, sample:[r,g,b], hex }]
  extractGroups(canvas, { limit = 8, minRatio = 0.01 } = {}) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const stats = new Map();
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 40) continue;
      opaque++;
      const key = this.groupKeyOf(data[i], data[i + 1], data[i + 2]);
      let e = stats.get(key);
      if (!e) { e = { key, count: 0, r: 0, g: 0, b: 0 }; stats.set(key, e); }
      e.count++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
    }
    if (!opaque) return [];
    return [...stats.values()]
      .map(e => ({
        key: e.key,
        ratio: e.count / opaque,
        sample: [Math.round(e.r / e.count), Math.round(e.g / e.count), Math.round(e.b / e.count)],
      }))
      .filter(e => e.ratio >= minRatio)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, limit)
      .map(e => ({ ...e, hex: this.rgbToHex(e.sample) }));
  },

  // ---- 塗り替え ----
  // skin: { groups: { <groupKey>: '#rrggbb', ... }, splits: [{ key, rect, color }] }
  //   groups … 色グループごとの新しい色
  //   splits … 「この範囲だけ別グループ」。同じ色の別パーツを分けるために使う。
  //             矩形で持つので保存データは小さいままになる。
  isEmpty(skin) {
    if (!skin) return true;
    const groups = skin.groups || {};
    const splits = skin.splits || [];
    return Object.keys(groups).length === 0 && splits.length === 0;
  },

  // 元画像を塗り替えた新しいキャンバスを返す。元画像は変更しない。
  recolor(source, skin) {
    if (this.isEmpty(skin) || typeof document === 'undefined') return source;
    const w = source.width, h = source.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, w, h);
    const data = image.data;

    const groups = skin.groups || {};
    const splits = (skin.splits || []).filter(s => s && s.rect && s.color);
    // 同じ色を何度も計算しないよう、変換結果を覚えておく。
    // 絵の実際の色数は数万あるが、キャッシュが効くので全コマでも数十msで済む。
    const cache = new Map();

    const convert = (r, g, b, hex) => {
      const ck = (r << 24 | g << 16 | b << 8) + hex;
      const hit = cache.get(ck);
      if (hit) return hit;
      const target = this.hexToRgb(hex);
      if (!target) return null;
      const [, , l] = this.rgbToHsl(r, g, b);
      const [th, ts] = this.rgbToHsl(target[0], target[1], target[2]);
      // 明度は元のまま。色相と彩度だけ差し替えて陰影を残す。
      const next = this.hslToRgb(th, ts, l);
      cache.set(ck, next);
      return next;
    };

    const inRect = (x, y, rect) =>
      x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 8) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = this.groupKeyOf(r, g, b);
        // 範囲指定の分割が優先。指定範囲かつ同じ色グループのピクセルだけ別色にする。
        let hex = null;
        for (const split of splits) {
          if (split.key === key && inRect(x, y, split.rect)) { hex = split.color; break; }
        }
        if (!hex) hex = groups[key] || null;
        if (!hex) continue;
        const next = convert(r, g, b, hex);
        if (!next) continue;
        data[i] = next[0]; data[i + 1] = next[1]; data[i + 2] = next[2];
      }
    }
    ctx.putImageData(image, 0, 0);
    return out;
  },

  // 同じ (画像, スキン) の組み合わせを何度も塗り直さないためのキャッシュ。
  // 画面を移動するたびに再計算しないよう、ここで一元管理する。
  _cache: new Map(),

  cacheKey(skin) {
    if (this.isEmpty(skin)) return '';
    const groups = Object.entries(skin.groups || {}).sort().map(([k, v]) => `${k}:${v}`).join(',');
    const splits = (skin.splits || []).map(s =>
      `${s.key}@${s.rect.x},${s.rect.y},${s.rect.w},${s.rect.h}:${s.color}`).join(',');
    return `${groups}|${splits}`;
  },

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

  clearCache() { this._cache.clear(); },
};

if (typeof window !== 'undefined') window.Skin = Skin;

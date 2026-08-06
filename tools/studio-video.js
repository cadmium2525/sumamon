// ==== モンスター作成スタジオ：動画からコマを取り出す ====
// 動画を撮れる素材（実物の撮影・生成した動画など）から、そのままモーションを作れるようにする。
// ブラウザだけで完結させるため、<video>のシークとcanvasへの描き出しでコマを取得する。
const StudioVideo = {
  // 動画を読み込む。iOS Safariでは playsInline / muted が無いと再生・シークが行えない。
  async load(file) {
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.preload = 'auto';
    video.src = URL.createObjectURL(file);
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('動画を読み込めませんでした。別の形式で試してください'));
    });
    // 一部の環境ではメタデータ直後の幅が0のことがあるため、最初のコマまで進めておく
    if (!video.videoWidth) {
      await new Promise(resolve => { video.onloadeddata = resolve; setTimeout(resolve, 1200); });
    }
    return video;
  },

  release(video) {
    if (video && video.src) URL.revokeObjectURL(video.src);
  },

  _seek(video, time) {
    return new Promise((resolve, reject) => {
      const done = () => { video.removeEventListener('seeked', done); resolve(); };
      video.addEventListener('seeked', done);
      // シークが返らない端末があるため、一定時間で諦めて次へ進む
      setTimeout(() => { video.removeEventListener('seeked', done); resolve(); }, 1500);
      try { video.currentTime = time; } catch (error) { reject(error); }
    });
  },

  // 動画全体から等間隔でcount枚取り出す。
  // 先頭と末尾は手ブレや暗転が入りやすいので少し内側から始める。
  async extractFrames(video, count, onProgress) {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('動画の長さを取得できませんでした');
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('動画の大きさを取得できませんでした');

    const margin = Math.min(0.08 * duration, 0.25);
    const start = margin;
    const span = Math.max(0.01, duration - margin * 2);
    const frames = [];
    for (let i = 0; i < count; i++) {
      const time = start + (span * i) / count;
      await this._seek(video, time);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(video, 0, 0, width, height);
      frames.push(canvas);
      if (onProgress) onProgress(i + 1, count);
    }
    return frames;
  },

  // 比較用の小さなグレースケール指紋。周期検出に使う。
  _signature(canvas, size = 24) {
    const small = document.createElement('canvas');
    small.width = size; small.height = size;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const out = new Float32Array(size * size);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // 透明部分は「背景」として一定値にし、被写体の形だけを比較する
      out[p] = data[i + 3] < 40 ? 0 : (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
    }
    return out;
  },

  _distance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
    return Math.sqrt(sum / a.length);
  },

  // 歩行などの繰り返し動作から1周期ぶんを見つける。
  // 「pコマ後の絵が今の絵とどれだけ似ているか」を全pで比べ、最も似ている間隔を周期とみなす。
  detectCycle(canvases) {
    const count = canvases.length;
    if (count < 6) return null;
    const signatures = canvases.map(canvas => this._signature(canvas));
    const maxPeriod = Math.floor(count / 2);
    let best = null;
    for (let period = 3; period <= maxPeriod; period++) {
      let sum = 0, pairs = 0;
      for (let i = 0; i + period < count; i++) {
        sum += this._distance(signatures[i], signatures[i + period]);
        pairs++;
      }
      if (!pairs) continue;
      const score = sum / pairs;
      if (!best || score < best.score) best = { period, score };
    }
    if (!best) return null;
    // 何とも似ていない（＝繰り返しではない）場合は周期なしとして扱う
    let baseline = 0, n = 0;
    for (let i = 0; i + 1 < count; i++) { baseline += this._distance(signatures[i], signatures[i + 1]); n++; }
    baseline = n ? baseline / n : 1;
    if (best.score > baseline * 1.6) return null;
    return best.period;
  },

  // 周期ぶんのコマから、実際に使う枚数だけ均等に間引く
  pickCycleFrames(canvases, period, wanted) {
    const source = canvases.slice(0, Math.min(canvases.length, period));
    if (source.length <= wanted) return source;
    const picked = [];
    for (let i = 0; i < wanted; i++) picked.push(source[Math.round((i * source.length) / wanted)]);
    return picked;
  },
};

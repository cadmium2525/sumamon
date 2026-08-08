// ==== モンスター作成スタジオ：モーションの確認 ====
// スタジオで「登録済みも含めて、全モーションが実際どう動くか」を見るための再生機。
//
// 3通りの見え方を、ゲーム本体と同じ処理で再現する。
//   専用モーション … 登録済み／読み込み済みのコマ画像を順に描く
//   自動モーション … 専用モーションが無い技・状態を、立ち絵の変形で動かす（v0.98）
//   パーツ分割     … 頭・胴・左右の脚を付け根で振る（v1.01）
//
// 変形の計算は js/procedural-motion.js をそのまま読み込んで使う。
// スタジオ側で作り直すと、確認できた動きと本番の動きがずれてしまうため。
const StudioPreview = {
  canvas: null,
  ctx: null,
  raf: null,
  frame: 0,
  clock: 0,
  playing: true,

  // 再生中の内容
  //   { kind:'frames', images:[], duration }              専用モーション
  //   { kind:'procedural', sprite, slot, stateKey, parts } 自動モーション
  source: null,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  },

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.source = null;
    if (this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  },

  setPlaying(on) {
    this.playing = !!on;
  },

  // ---- 画像の読み込み（同じURLは使い回す） ----
  _cache: new Map(),
  loadImage(src) {
    if (this._cache.has(src)) return this._cache.get(src);
    const task = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      // スタジオはリポジトリ直下の tools/ に置かれているため、1つ上を見る
      img.src = src.startsWith('http') || src.startsWith('data:') ? src : '../' + src;
    });
    this._cache.set(src, task);
    return task;
  },

  async playFrames(sources, duration, { loop = true } = {}) {
    const images = (await Promise.all(sources.map(s =>
      (typeof s === 'string' ? this.loadImage(s) : Promise.resolve(s))))).filter(Boolean);
    if (!images.length) return false;
    this.source = { kind: 'frames', images, duration: Math.max(1, duration || 6), loop };
    this.frame = 0;
    this._start();
    return true;
  },

  // 自動モーション／パーツ分割のプレビュー。
  // slot は 'move:smash.side' のような技スロット、または 'walk' のような状態。
  async playProcedural(spriteSrc, slot, { parts = null, intensity = 1, enabled = true } = {}) {
    const sprite = typeof spriteSrc === 'string' ? await this.loadImage(spriteSrc) : spriteSrc;
    if (!sprite) return false;
    const isMove = String(slot).startsWith('move:');
    this.source = {
      kind: 'procedural',
      sprite,
      partsLayer: parts ? this._buildParts(sprite, parts) : null,
      // ゲーム本体の Fighter と同じ項目だけを持つ、確認用の身代わり
      fighter: {
        proceduralEnabled: enabled,
        proceduralIntensity: intensity,
        proceduralClock: 0,
        onGround: !['jump', 'airIdle', 'tumble'].includes(slot),
        currentMoveSlot: isMove ? slot.slice(5) : null,
        currentMove: null,
        attackTimer: 0,
        partsLayer: null,
      },
      slot,
      stateKey: isMove ? null : slot,
      // 技は「構え→踏み込み→戻り」を繰り返し見せたいので、長さを決めて回す
      duration: 30,
    };
    this.source.fighter.partsLayer = this.source.partsLayer;
    if (isMove) {
      this.source.fighter.currentMove = { duration: 30, active: [10, 16] };
    }
    this.clock = 0;
    this._start();
    return true;
  },

  // 立ち絵を 頭／胴／奥の脚／手前の脚 に切り分ける。
  // js/fighter.js の _buildPartsLayer と同じ切り方（上の部品が下の継ぎ目を覆う）。
  _buildParts(sprite, spec) {
    const W = sprite.naturalWidth || sprite.width;
    const H = sprite.naturalHeight || sprite.height;
    if (!spec || !W || !H) return null;
    const neckY = Math.max(1, Math.min(H - 2, Math.round(spec.neckY)));
    const hipY = Math.max(neckY + 1, Math.min(H - 1, Math.round(spec.hipY)));
    const splitX = Math.max(1, Math.min(W - 1, Math.round(spec.legSplitX)));
    const overlap = Math.max(0, Math.round(spec.overlap != null ? spec.overlap : H * 0.02));
    const slice = (sx, sy, sw, sh) => {
      if (sw <= 0 || sh <= 0) return null;
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(sprite, sx, sy, sw, sh, 0, 0, sw, sh);
      return { canvas: c, x: sx, y: sy };
    };
    const head = slice(0, 0, W, Math.min(H, neckY + overlap));
    const torso = slice(0, neckY, W, Math.min(H - neckY, hipY + overlap - neckY));
    const legBack = slice(0, hipY, splitX, H - hipY);
    const legFront = slice(splitX, hipY, W - splitX, H - hipY);
    if (!head || !torso || !legBack || !legFront) return null;
    return {
      head: { ...head, pivotX: W / 2, pivotY: neckY },
      torso: { ...torso, pivotX: W / 2, pivotY: hipY },
      legBack: { ...legBack, pivotX: splitX / 2, pivotY: hipY },
      legFront: { ...legFront, pivotX: (splitX + W) / 2, pivotY: hipY },
    };
  },

  _start() {
    if (this.raf) cancelAnimationFrame(this.raf);
    const tick = () => {
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },

  // ---- 描画 ----
  draw() {
    const s = this.source;
    if (!s || !this.ctx) return;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 地面の線。足元がここから離れないかを見るための目印。
    const groundY = canvas.height - 12;
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, groundY + 0.5); ctx.lineTo(canvas.width, groundY + 0.5); ctx.stroke();

    if (s.kind === 'frames') {
      if (this.playing) this.frame++;
      const step = Math.floor(this.frame / s.duration);
      // ループしないモーションは最後のコマで止める（本番の見え方に合わせる）
      const index = s.loop === false ? Math.min(s.images.length - 1, step) : step % s.images.length;
      this._drawFitted(s.images[index], groundY);
      return;
    }
    if (s.kind === 'procedural') this._drawProcedural(s, groundY);
  },

  // 高さを合わせて、足元が地面の線に来るように描く
  _fit(image, groundY) {
    const w = image.naturalWidth || image.width;
    const h = image.naturalHeight || image.height;
    const scale = Math.min((this.canvas.height - 24) / h, (this.canvas.width - 24) / w);
    return { scale, drawW: w * scale, drawH: h * scale,
             x: (this.canvas.width - w * scale) / 2, y: groundY - h * scale };
  },

  _drawFitted(image, groundY) {
    const f = this._fit(image, groundY);
    this.ctx.drawImage(image, f.x, f.y, f.drawW, f.drawH);
  },

  _drawProcedural(s, groundY) {
    const { ctx } = this;
    if (this.playing) { this.clock++; s.fighter.proceduralClock = this.clock; }
    const attacking = !!s.fighter.currentMove;
    if (attacking) {
      // 技は duration をぐるぐる回して、構え→踏み込み→戻りを繰り返し見せる
      const phase = this.clock % s.duration;
      s.fighter.attackTimer = s.duration - phase;
    }
    const f = this._fit(s.sprite, groundY);
    const unit = f.drawH;              // 変形の量は「体の高さ」に対する比で決まる
    const pivotX = f.x + f.drawW / 2;
    const pivotY = groundY;

    ctx.save();
    const transform = window.ProceduralMotion
      ? ProceduralMotion.transformFor(s.fighter, { attacking, stateKey: s.stateKey })
      : null;
    if (transform) {
      ctx.translate(pivotX + transform.dx * unit, pivotY + transform.dy * unit);
      ctx.rotate(transform.rot * Math.PI / 180);
      ctx.scale(transform.sx, transform.sy);
      ctx.translate(-pivotX, -pivotY);
    }

    const angles = s.partsLayer && window.ProceduralMotion
      ? ProceduralMotion.partAnglesFor(s.fighter, { attacking, stateKey: s.stateKey || 'idle' })
      : null;
    if (angles && s.partsLayer) {
      // 奥の脚 → 手前の脚 → 胴 → 頭 の順。上の部品が下の継ぎ目を隠す。
      for (const key of ['legBack', 'legFront', 'torso', 'head']) {
        const part = s.partsLayer[key];
        const angle = angles[key] || 0;
        const px = f.x + part.pivotX * f.scale;
        const py = f.y + part.pivotY * f.scale;
        ctx.save();
        if (angle) {
          ctx.translate(px, py);
          ctx.rotate(angle * Math.PI / 180);
          ctx.translate(-px, -py);
        }
        ctx.drawImage(part.canvas, f.x + part.x * f.scale, f.y + part.y * f.scale,
          part.canvas.width * f.scale, part.canvas.height * f.scale);
        ctx.restore();
      }
    } else {
      ctx.drawImage(s.sprite, f.x, f.y, f.drawW, f.drawH);
    }
    ctx.restore();
  },
};

window.StudioPreview = StudioPreview;

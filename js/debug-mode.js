// cadmium用デバッグ画面。今後BGMなどの確認機能もこの画面へ追加する。
const DebugMotionViewer = {
  rafId: null,
  startedAt: 0,
  imageCache: new Map(),

  init() {
    this.canvas = document.getElementById('debug-motion-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.fighterSelect = document.getElementById('debug-fighter-select');
    this.motionSelect = document.getElementById('debug-motion-select');
    this.fighterSelect.innerHTML = Object.values(FIGHTERS)
      .map(f => `<option value="${f.key}">${f.displayName}</option>`).join('');
    this.fighterSelect.addEventListener('change', () => this.buildMotionList());
    this.motionSelect.addEventListener('change', () => this.restart());
    this.buildMotionList();
  },

  _motionsFor(fighter) {
    const motions = [];
    if (fighter.idleFrameSrcs && fighter.idleFrameSrcs.length) {
      motions.push({ key: 'idle', label: '待機', type: 'frames', frames: fighter.idleFrameSrcs,
        duration: fighter.idleFrameDuration || 8, box: fighter.idleFrameContentBox || fighter.spriteContentBox, loop: true });
    } else if (fighter.idleImage) {
      motions.push({ key: 'idle', label: '待機', type: 'frames', frames: [fighter.idleImage],
        duration: 12, box: fighter.spriteContentBox, loop: true });
    }
    if (fighter.walkSheetSrc) {
      motions.push({ key: 'walk', label: '歩行', type: 'sheet', src: fighter.walkSheetSrc,
        cols: fighter.walkSheetCols, rows: fighter.walkSheetRows, count: fighter.walkFrameCount,
        duration: fighter.walkFrameDuration || 4, box: fighter.walkFrameContentBox, loop: true });
    }
    if (fighter.jumpFrameSrcs && fighter.jumpFrameSrcs.length) {
      motions.push({ key: 'jump', label: 'ジャンプ', type: 'frames', frames: fighter.jumpFrameSrcs,
        duration: fighter.jumpFrameDuration || 5, box: fighter.jumpFrameContentBox, loop: true });
    }
    if (fighter.airIdleSrc) {
      motions.push({ key: 'air-idle', label: '空中待機', type: 'frames', frames: [fighter.airIdleSrc],
        duration: 12, box: fighter.airIdleContentBox, loop: true });
    }
    const specials = window.FIGHTER_MOVESETS?.[fighter.key]?.special || {};
    for (const [key, move] of Object.entries(specials)) {
      if (!move.animation) continue;
      motions.push({ key: `special-${key}`, label: `${move.name}（必殺技）`, type: 'frames',
        frames: move.animation.frames, duration: move.animation.frameDuration || 6,
        box: move.animation.contentBox, loop: true });
    }
    return motions;
  },

  buildMotionList() {
    const fighter = FIGHTERS[this.fighterSelect.value] || Object.values(FIGHTERS)[0];
    const motions = this._motionsFor(fighter);
    this.motionSelect.innerHTML = motions.map(m => `<option value="${m.key}">${m.label}</option>`).join('');
    this.restart();
  },

  _image(src) {
    if (!this.imageCache.has(src)) {
      const image = new Image();
      image.src = src;
      this.imageCache.set(src, image);
    }
    return this.imageCache.get(src);
  },

  setActive(active) {
    if (!active) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
      return;
    }
    this.restart();
  },

  restart() {
    this.startedAt = performance.now();
    if (!document.getElementById('screen-debug')?.classList.contains('hidden')) this._requestFrame();
  },

  _requestFrame() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(time => this.draw(time));
  },

  _drawFrame(image, box, alpha, sheet) {
    if (!image || !image.complete || !image.naturalWidth || !box) return;
    const ctx = this.ctx;
    const sourceW = sheet ? image.width / sheet.cols : image.width;
    const sourceH = sheet ? image.height / sheet.rows : image.height;
    const contentW = box.right - box.left;
    const contentH = box.bottom - box.top;
    const scale = Math.min(250 / contentH, 300 / contentW);
    const centerX = this.canvas.width / 2;
    const groundY = this.canvas.height - 18;
    const drawX = centerX - ((box.left + box.right) / 2) * scale;
    const drawY = groundY - box.bottom * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (sheet) {
      const sx = (sheet.index % sheet.cols) * sourceW;
      const sy = Math.floor(sheet.index / sheet.cols) * sourceH;
      ctx.drawImage(image, sx, sy, sourceW, sourceH, drawX, drawY, sourceW * scale, sourceH * scale);
    } else {
      ctx.drawImage(image, drawX, drawY, image.width * scale, image.height * scale);
    }
    ctx.restore();
  },

  draw(time) {
    const screen = document.getElementById('screen-debug');
    if (!screen || screen.classList.contains('hidden')) { this.rafId = null; return; }
    const fighter = FIGHTERS[this.fighterSelect.value] || Object.values(FIGHTERS)[0];
    const motion = this._motionsFor(fighter).find(m => m.key === this.motionSelect.value);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#17202b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.moveTo(24, this.canvas.height - 18); ctx.lineTo(this.canvas.width - 24, this.canvas.height - 18); ctx.stroke();
    if (motion) {
      const frameMs = motion.duration * 1000 / 60;
      const elapsed = time - this.startedAt;
      if (motion.type === 'sheet') {
        const index = Math.floor(elapsed / frameMs) % motion.count;
        this._drawFrame(this._image(motion.src), motion.box, 1,
          { index, cols: motion.cols, rows: motion.rows });
      } else {
        const position = elapsed / frameMs;
        const index = Math.floor(position) % motion.frames.length;
        const next = (index + 1) % motion.frames.length;
        const phase = position - Math.floor(position);
        const raw = Math.max(0, Math.min(1, (phase - .45) / .55));
        const blend = raw * raw * (3 - 2 * raw);
        this._drawFrame(this._image(motion.frames[index]), motion.box, 1);
        this._drawFrame(this._image(motion.frames[next]), motion.box, blend);
      }
    }
    this.rafId = requestAnimationFrame(nextTime => this.draw(nextTime));
  },
};

window.DebugMotionViewer = DebugMotionViewer;

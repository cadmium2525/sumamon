// ==== カメラ（スマブラ風のズームイン/アウト） ====
// fighter同士が近い時はズームイン、離れている時はズームアウトする。
// これにより実際のフィールド(Stage.worldWidth/worldHeight)をキャンバスより広く用意しても、
// 常に両者がバランス良く画面に収まるようになる。

const Camera = {
  x: CONFIG.CANVAS_W / 2,
  y: CONFIG.CANVAS_H / 2,
  zoom: CONFIG.CAMERA_MAX_ZOOM,

  // 新しいバトル開始時に呼ぶ（急にカメラが飛ばないよう中央に据え直す）
  reset(centerX, centerY) {
    this.x = centerX != null ? centerX : CONFIG.CANVAS_W / 2;
    this.y = centerY != null ? centerY : CONFIG.CANVAS_H / 2;
    this.zoom = CONFIG.CAMERA_MAX_ZOOM;
  },

  // 毎フレーム、生存中のfighter達を基準にカメラの目標位置/ズームを計算し、なめらかに追従する
  update(fighters) {
    const alive = fighters.filter(f => !f.dead);
    if (!alive.length) return;

    // 生存fighter全員のバウンディングボックス（本体サイズも考慮してやや広めに取る）
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const f of alive) {
      const cx = f.x + f.w / 2;
      const cy = f.y + f.h / 2;
      minX = Math.min(minX, cx - f.w);
      maxX = Math.max(maxX, cx + f.w);
      minY = Math.min(minY, cy - f.h * 1.5);
      maxY = Math.max(maxY, cy + f.h * 1.5);
    }

    const targetX = (minX + maxX) / 2;
    const targetY = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);

    // fighter同士のスパンがキャンバスに収まるズーム値を算出（近い=ズームイン、遠い=ズームアウト）
    const zoomX = CONFIG.CANVAS_W / (spanX + CONFIG.CAMERA_PADDING_X * 2);
    const zoomY = CONFIG.CANVAS_H / (spanY + CONFIG.CAMERA_PADDING_Y * 2);
    let targetZoom = Math.min(zoomX, zoomY);
    targetZoom = Math.max(CONFIG.CAMERA_MIN_ZOOM, Math.min(CONFIG.CAMERA_MAX_ZOOM, targetZoom));

    // なめらかに追従（線形補間）
    const s = CONFIG.CAMERA_SMOOTHING;
    this.x += (targetX - this.x) * s;
    this.y += (targetY - this.y) * s;
    this.zoom += (targetZoom - this.zoom) * s;

    this._clampToWorld();
  },

  // ワールド範囲外を映さないようカメラ中心をクランプ（ワールドがキャンバスより小さい場合は中央固定）
  _clampToWorld() {
    const worldW = (window.Stage && Stage.worldWidth) || CONFIG.CANVAS_W;
    const worldH = (window.Stage && Stage.worldHeight) || CONFIG.CANVAS_H;
    const minWorldX = -CONFIG.BLAST_MARGIN;
    const maxWorldX = worldW + CONFIG.BLAST_MARGIN;
    const minWorldY = -CONFIG.BLAST_MARGIN;
    const maxWorldY = worldH + CONFIG.BLAST_MARGIN;
    const cameraWorldW = maxWorldX - minWorldX;
    const cameraWorldH = maxWorldY - minWorldY;
    const halfViewW = (CONFIG.CANVAS_W / 2) / this.zoom;
    const halfViewH = (CONFIG.CANVAS_H / 2) / this.zoom;

    if (cameraWorldW > halfViewW * 2) {
      this.x = Math.min(Math.max(this.x, minWorldX + halfViewW), maxWorldX - halfViewW);
    } else {
      this.x = worldW / 2;
    }
    if (cameraWorldH > halfViewH * 2) {
      this.y = Math.min(Math.max(this.y, minWorldY + halfViewH), maxWorldY - halfViewH);
    } else {
      this.y = worldH / 2;
    }
  },

  // 描画前に呼ぶ：以降の描画がカメラのズーム/位置に従うようctxを変換する（呼び出し側でsave/restoreすること）
  apply(ctx) {
    ctx.translate(CONFIG.CANVAS_W / 2, CONFIG.CANVAS_H / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  },
};

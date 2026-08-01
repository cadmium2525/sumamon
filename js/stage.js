// ==== ステージ登録データ ＆ Stageオブジェクト ====
// 画像は assets/images/field/<ステージ名>/ 以下に配置する。

const STAGES = {
  waterfall_ruins: {
    key: 'waterfall_ruins',
    displayName: '滝の遺跡',
    background: 'assets/images/field/waterfall_ruins/background.png',
    platformImage: 'assets/images/field/waterfall_ruins/platform.png',
    // ワールドサイズ（カメラがズームアウトしても見せて良い範囲）。
    // 今は画面サイズと同じだが、カメラがfighter間の距離に応じて自動でズーム/追従するようになったため、
    // 今後はここを広げるだけでキャンバスより大きなフィールドを用意できる。
    worldWidth: CONFIG.CANVAS_W,
    worldHeight: CONFIG.CANVAS_H,
    platforms: [
      { x: 250, y: 750, w: 900, h: 30 },   // メイン足場（大きく横長）
      { x: 420, y: 560, w: 150, h: 20 },   // 左浮島
      { x: 830, y: 560, w: 150, h: 20 },   // 右浮島
    ],
    spawnPoints: [
      { x: 495, y: 500 },
      { x: 905, y: 500 },
      { x: 550, y: 670 },
      { x: 780, y: 670 },
    ],
  },
};

const Stage = {
  currentKey: null,
  platforms: [],
  spawnPoints: [],

  background: null,
  backgroundLoaded: false,
  daiImage: null,
  daiLoaded: false,

  // ローディング画面などで事前読み込みしておけば、load()時は即座に反映される（キャッシュ利用）
  load(stageKey) {
    const data = STAGES[stageKey];
    if (!data) return;
    this.currentKey = stageKey;
    this.platforms = data.platforms;
    this.spawnPoints = data.spawnPoints;
    this.worldWidth = data.worldWidth || CONFIG.CANVAS_W;
    this.worldHeight = data.worldHeight || CONFIG.CANVAS_H;

    // 画像読み込み前の暫定値（万一これが使われる場合は従来通り画像上端を採用）
    for (const p of this.platforms) p.surfaceY = p.y;

    this.background = new Image();
    this.backgroundLoaded = false;
    this.background.onload = () => { this.backgroundLoaded = true; };
    this.background.src = data.background;

    this.daiImage = new Image();
    this.daiLoaded = false;
    this.daiImage.onload = () => {
      this.daiLoaded = true;
      this._computePlatformSurfaces();
    };
    this.daiImage.src = data.platformImage;
  },

  // 足場画像の実寸（アスペクト比を保って幅=p.wで描画した際の高さ）を基に、
  // 画像上端からPLATFORM_SURFACE_RATIO分下の位置を各足場の当たり判定面(surfaceY)として算出する
  _computePlatformSurfaces() {
    for (const p of this.platforms) {
      const drawH = this.daiImage.height * (p.w / this.daiImage.width);
      p.surfaceY = p.y + drawH * CONFIG.PLATFORM_SURFACE_RATIO;
    }
  },

  // 背景：カメラのズーム/パンの影響を受けない固定背景として、常にキャンバス全体を覆うように描画する
  // （ここをカメラ変換の外側で呼ぶことで、ズームアウト時に背景の外側の青い余白が見えるのを防ぐ）
  drawBackground(ctx) {
    if (this.backgroundLoaded) {
      ctx.drawImage(this.background, 0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    } else {
      ctx.fillStyle = '#4a6fa5';
      ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    }
  },

  // ワールド側のコンテンツ（足場・ブラストライン）：カメラ変換の内側（ctx.save()+Camera.apply()後）で呼ぶ
  draw(ctx) {
    const worldW = this.worldWidth || CONFIG.CANVAS_W;
    const worldH = this.worldHeight || CONFIG.CANVAS_H;

    // 足場（画像の上端を当たり判定の上面に合わせ、幅基準でアスペクト比を保って描画）
    for (const p of this.platforms) {
      if (this.daiLoaded) {
        const drawW = p.w;
        const drawH = this.daiImage.height * (drawW / this.daiImage.width);
        ctx.drawImage(this.daiImage, p.x, p.y, drawW, drawH);
      } else {
        ctx.fillStyle = '#2d3436';
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
    }

    // ブラストライン（KO境界）目安を薄く描画
    ctx.strokeStyle = 'rgba(255,0,0,0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      -CONFIG.BLAST_MARGIN, -CONFIG.BLAST_MARGIN,
      worldW + CONFIG.BLAST_MARGIN * 2,
      worldH + CONFIG.BLAST_MARGIN * 2
    );
  },
};

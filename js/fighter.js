// ==== ファイタークラス ====
class Fighter {
  // 技モーション・状態モーション共通のローダー。
  // 同じ画像を何枚も生成しないよう共有し、事前読み込み済みがあればそれを使う。
  // 1枚でも読み込みに失敗したアニメーションは使わず、別の状態へフォールバックさせる（透明化を防ぐ）。
  static createAnimationState(config) {
    if (!config || !Array.isArray(config.frames) || !config.frames.length) return null;
    const state = { images: [], loaded: 0, failed: 0, config };
    const perSource = new Map();
    state.images = config.frames.map(src => {
      if (perSource.has(src)) {
        state.loaded++;
        return perSource.get(src);
      }
      const preloaded = window.PreloadedImages && window.PreloadedImages.get(src);
      if (preloaded && preloaded.complete) {
        state.loaded++;
        if (!preloaded.naturalWidth) state.failed++;
        perSource.set(src, preloaded);
        return preloaded;
      }
      const image = preloaded || new Image();
      image.addEventListener('load', () => { state.loaded++; }, { once: true });
      image.addEventListener('error', () => {
        state.loaded++;
        state.failed++;
        console.warn('[Fighter] モーション画像の読み込みに失敗しました:', src);
      }, { once: true });
      if (!image.src) image.src = src;
      perSource.set(src, image);
      return image;
    });
    return state;
  }

  // 描画に使う絵を、スキン（色変更）を通したものへ差し替える。
  // 塗り替えは重いので、1枚につき1回だけ行って覚えておく。
  // 読み込みが終わっていない絵はまだ塗れないので、そのまま返し、覚えない。
  _skinned(image) {
    if (!this.hasSkin || !image) return image;
    const hit = this._skinCache.get(image);
    if (hit) return hit;
    if (!(image.naturalWidth || image.width)) return image;
    const out = Skin.apply(image, this.skin, `${this.fighterKey || ''}:${image.src || ''}`);
    this._skinCache.set(image, out);
    return out;
  }

  // そのアニメーションが表示可能な状態か（全コマ読み込み済み・失敗なし・contentBoxあり）
  static animationReady(state) {
    return !!(state && state.config.contentBox && state.failed === 0 && state.loaded >= state.images.length);
  }

  // options: { grabRange, name, spriteSrc, hurtboxWidth, hurtboxHeight, spriteContentBox }
  // hurtboxWidth/hurtboxHeight: 画像を解析して算出した「実際のキャラクター本体」のサイズ（世界座標単位）
  // spriteContentBox: 元画像ピクセル座標での本体bbox（影・余白を除く）。{left, top, right, bottom}
  //   → これが無いスプライトは簡易フォールバック表示になる
  constructor(id, stats, color, spawn, options) {
    options = options || {};
    this.id = id;
    this.name = options.name || id.toUpperCase();
    this.stats = stats;
    this.color = color;
    this.spawn = spawn;
    this.stockIconSrc = options.stockIconSrc || null;
    this.knockbackTakenMultiplier = Math.max(0.1, Number(options.knockbackTakenMultiplier) || 1);
    this.fighterKey = options.fighterKey || null;
    this.moveSet = (window.FIGHTER_MOVESETS && window.FIGHTER_MOVESETS[this.fighterKey]) || {};

    // 技ごとのモーション
    this.moveAnimations = new Map();
    for (const moveGroup of Object.values(this.moveSet)) {
      for (const move of Object.values(moveGroup || {})) {
        const state = Fighter.createAnimationState(move && move.animation);
        if (state) this.moveAnimations.set(move, state);
      }
    }

    // ---- 状態ごとのモーション ----
    // options.animations = { idle, walk, dash, jump, airIdle, crouch, shield, hurt, tumble, downed, ledge }
    // 各値は { frames:[...], frameDuration, contentBox }。未登録の状態は優先順に別の状態→最後はidleへ落ちる。
    // これにより「用意したモーションだけ差し込む」ことができ、全部揃っていなくても破綻しない。
    this.stateAnimations = {};
    for (const [key, config] of Object.entries(options.animations || {})) {
      const state = Fighter.createAnimationState(config);
      if (state) this.stateAnimations[key] = state;
    }
    this.animState = null;   // 現在再生中の状態キー
    this.animTimer = 0;      // 状態アニメの経過フレーム
    this.animFrame = 0;

    // 当たり判定サイズ：画像を解析した実寸。未指定時は基準サイズにフォールバック。
    this.w = options.hurtboxWidth || CONFIG.BASE_HURTBOX_W;
    this.h = options.hurtboxHeight || CONFIG.BASE_HURTBOX_H;

    // 技の間合い／シールド半径／掴み距離は、基準サイズに対するこのファイターの大きさの比率でスケールする
    this.attackScale = this.h / CONFIG.BASE_HURTBOX_H;
    this.grabRange = (options.grabRange || CONFIG.GRAB_RANGE_DEFAULT) * this.attackScale;

    // 落下速度はモンスターごとの個性（育成では変わらない）。
    // 大きいほど速く落ち、コンボは抜けやすいが復帰は難しくなる。
    this.fallSpeed = Physics.fallMultiplier(options.fallSpeed);

    // ジャンプ力もモンスターごとの個性（育成では変わらない）。
    // 倍率で持ち、実際の初速は Physics.jumpVelocity() で求める。
    this.jumpPower = Physics.jumpMultiplier(options.jumpPower);

    // 自動モーション：専用モーションが無い状態・技を、立ち絵の変形で動かす。
    // モンスターごとに切ったり動きの強さを変えたりできる。
    this.proceduralEnabled = options.proceduralMotion?.enabled !== false;
    this.proceduralIntensity = Number.isFinite(options.proceduralMotion?.intensity)
      ? Math.max(0, options.proceduralMotion.intensity) : 1;
    this.proceduralClock = 0;
    this.currentMoveSlot = null;

    // 武器レイヤー：立ち絵から武器の部分だけを切り出し、握りを軸に振る。
    // rect/pivot は立ち絵のピクセル座標で指定する。
    // パーツ分割：頭・胴・左右の脚を付け根で振る（立ち絵のピクセル座標で指定）
    this.partsSpec = options.parts || null;
    this.partsLayer = null;
    // スキン（色変更）。描画に使う絵は全てここを通す。
    // パーツ分割・武器レイヤーも塗り替えた後の絵から切り出すこと（順序が逆だと元の色が残る）。
    this.skin = options.skin || null;
    this.hasSkin = !!(window.Skin && !Skin.isEmpty(this.skin));
    this._skinCache = new Map();
    // HUDやリザルトはHTML側で絵を使うため、データURLも用意しておく。
    // 変換が終わるまではnullで、その間は元の絵が使われる。
    this.skinnedIconSrc = null;
    this.skinnedSpriteSrc = null;
    if (this.hasSkin) {
      if (this.stockIconSrc) Skin.dataUrl(this.stockIconSrc, this.skin).then(url => { this.skinnedIconSrc = url; });
      if (options.spriteSrc) Skin.dataUrl(options.spriteSrc, this.skin).then(url => { this.skinnedSpriteSrc = url; });
    }
    this.weaponSpec = options.weapon || null;
    this.weaponLayer = null;      // { weapon: canvas, body: canvas, pivotX, pivotY }
    // 斬撃の軌跡（攻撃判定の通り道）を数フレームぶん覚えておく
    this._swingTrail = [];

    // 見た目用スプライト（未指定の場合は色付き矩形のまま）
    this.sprite = null;
    this.spriteLoaded = false;
    this.spriteContentBox = options.spriteContentBox || null;
    if (options.spriteSrc) {
      this.sprite = new Image();
      this.sprite.onload = () => { this.spriteLoaded = true; };
      this.sprite.src = options.spriteSrc;
    }

    // 歩行アニメーション（スプライトシート）。無い場合は静止画のまま表示される。
    this.walkSheet = null;
    this.walkSheetLoaded = false;
    this.walkSheetCols = options.walkSheetCols || 1;
    this.walkSheetRows = options.walkSheetRows || 1;
    this.walkFrameCount = options.walkFrameCount || 1;
    this.walkFrameContentBox = options.walkFrameContentBox || null;
    this.walkFrameDuration = options.walkFrameDuration || 4; // 1コマ何フレーム表示するか
    this.sheetFrame = 0;
    this.sheetTimer = 0;
    if (options.walkSheetSrc) {
      this.walkSheet = new Image();
      this.walkSheet.onload = () => {
        this.walkSheetLoaded = true;
        this.walkFrameW = this.walkSheet.width / this.walkSheetCols;
        this.walkFrameH = this.walkSheet.height / this.walkSheetRows;
      };
      this.walkSheet.src = options.walkSheetSrc;
    }

    this.reset();
  }

  reset() {
    this.x = this.spawn.x;
    this.y = this.spawn.y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.groundedPlatform = null;
    this.groundedSolid = false; // 乗っている足場が「地面」か（下入力ですり抜けない）
    this.dropThroughTimer = 0;
    this.jumpsUsed = 0;
    this.damagePercent = 0;
    this.stocks = CONFIG.STOCK_DEFAULT;

    // 移動演出（歩行スプライトシートが無いキャラの「傾き+上下ユラユラ」用）
    this.isMoving = false;
    this.motionTimer = 0;

    this.attackTimer = 0;
    this.recoveryTimer = 0;
    this.currentMove = null;
    this.hasHitThisAttack = false;
    this._projectileSpawned = false;
    this._projectileRequest = null;
    this.hitstun = 0;

    this.shielding = false;
    this.shieldHP = CONFIG.SHIELD_MAX;
    this.shieldReleaseTimer = 0;
    this.dazedTimer = 0;     // シールド破壊後のピヨリ
    this.dodgeTimer = 0;     // その場回避/横回避/空中緊急回避 中
    this.dodgeType = null;
    this.invincible = 0;
    this.dead = false;
    this.tumbling = false;
    this.tumbleRotation = 0;
    this.downed = false;
    this.lastAttacker = null;
    this.lastHitAt = 0;
    this.kos = 0;
    this.falls = 0;
    this.selfDestructs = 0;
    this.eliminatedAt = 0;

    // ジャンプ（小ジャンプ/大ジャンプ判定）
    this.jumpFrames = 0;
    this.jumpCutDone = true;
    this.jumpAnimTimer = -1;
    this.prevShieldHeld = false;
    this._airDodgeUsed = false;

    // 崖掴まり
    this.onLedge = null;
    this.ledgeCooldown = 0;
    this.ledgeHangFrames = 0;
    this.ledgeLocked = false; // 自動離脱直後は着地するまで再度掴まらない

    // 空中での行動制限
    this._usedUpSpecialAirborne = false; // 上Bは空中で1回のみ
    this.helpless = false; // 行動不能（着地するまで操作不可・落下のみ）

    // 掴み関連
    this.grabbing = null;    // 相手を掴んでいる場合、相手Fighterを参照
    this.grabbedBy = null;   // 自分が掴まれている場合、相手Fighterを参照
    this.grabTimer = 0;
    this._wantsGrab = false;

    // スマッシュ溜め
    this.smashCandidate = null; // { dir, elapsed, tiltMove, smashMove }

    // エッジ検出用
    this.prevJumpHeld = false;
    this.prevAttackHeld = false;
    this.prevSpecialHeld = false;
    this.prevGrabHeld = false;
    this.prevLeftHeld = false;
    this.prevRightHeld = false;
    this.prevDownHeld = false;
    this.prevUpHeld = false;

    // 各方向キーが「押され始めた時刻」（強攻撃/スマッシュの同時押し判定に使用）
    this.dirPressTime = { up: null, down: null, left: null, right: null };

    // ---- スマブラ的な挙動のための状態 ----
    this.hitlag = 0;          // ヒットストップ中（攻撃側・被弾側とも完全停止）
    this.hitlagShakeX = 0;    // ヒットストップ中の小刻みな揺れ（描画のみ）
    this.fastFalling = false; // 急降下中
    this.landingLag = 0;      // 空中攻撃を出したまま着地した際の硬直
    this.techWindow = 0;      // 受け身の入力受付が残っているフレーム数
    this.techLockout = 0;     // 受け身失敗後の再入力禁止
    this.staleQueue = [];     // ワンパターン相殺用の直近使用技リスト
    this.diX = 0;             // 被弾時のベクトル変更（DI）に使うスティック入力
    this.diY = 0;
    this.shieldEdge = false;  // このフレームでシールドが押され始めたか
    this._hitWindowIndex = -1;
    this._isLinkHit = false;
    this._hitTargets = new Set(); // 現在のヒット判定ウィンドウで既に当てた相手
    this._hurtbox = { x: 0, y: 0, w: 0, h: 0 }; // 毎フレームの再生成を避けるため使い回す
    this.groundDistance = Infinity; // 足元から真下の足場までの距離
    this.shieldHeldFrames = 0;      // シールドを張り続けているフレーム数
    // シールドを離した直後の猶予(フレーム)。ジャストシールドはここが>0の間に
    // 被弾すると成立する（本家SPと同じ「当たる瞬間に離す」方式）。
    this.shieldReleaseTimer = 0;
    this.justShieldFlash = 0;       // ジャストガード成立時のエフェクト残りフレーム
    this.crouching = false;         // しゃがみ中
  }

  getHeldDirection(input) {
    if (input.up) return 'up';
    if (input.down) return 'down';
    if (input.left || input.right) return 'side';
    return null;
  }

  // 方向キーのエッジ検出（毎フレーム状態を最新に保つ）
  updateEdges(input) {
    this.leftEdge = input.left && !this.prevLeftHeld;
    this.rightEdge = input.right && !this.prevRightHeld;
    this.downEdge = input.down && !this.prevDownHeld;
    this.upEdge = input.up && !this.prevUpHeld;
    // シールドのエッジ検出はヒットストップ中の受け身入力でも使うため、ここで一元化する
    this.shieldEdge = input.shield && !this.prevShieldHeld;
    this.prevShieldHeld = input.shield;

    // ベクトル変更(DI)用に、常に最新のスティック方向を保持しておく
    this.diX = typeof input.stickX === 'number' && Math.abs(input.stickX) > 0.15
      ? input.stickX : (input.left ? -1 : input.right ? 1 : 0);
    this.diY = typeof input.stickY === 'number' && Math.abs(input.stickY) > 0.15
      ? input.stickY : (input.up ? -1 : input.down ? 1 : 0);

    const now = Date.now();
    this.prevLeftHeld = input.left;
    this.prevRightHeld = input.right;
    this.prevDownHeld = input.down;
    this.prevUpHeld = input.up;

    // 押され始めた時刻を記録（離したらクリア）。強攻撃/スマッシュの同時押し判定用
    if (this.leftEdge) this.dirPressTime.left = now; else if (!input.left) this.dirPressTime.left = null;
    if (this.rightEdge) this.dirPressTime.right = now; else if (!input.right) this.dirPressTime.right = null;
    if (this.upEdge) this.dirPressTime.up = now; else if (!input.up) this.dirPressTime.up = null;
    if (this.downEdge) this.dirPressTime.down = now; else if (!input.down) this.dirPressTime.down = null;
  }

  // input: { left, right, up, down, jump, attack, special, shield, grab }
  applyInput(input) {
    if (this.dead) return;
    this.updateEdges(input);
    // ヒットストップ中は攻撃側・被弾側とも完全に停止（DIの入力だけは上で拾っている）
    if (this.hitlag > 0) return;
    if (this.landingLag > 0) return; // 着地隙

    const hasWakeInput = input.left || input.right || input.up || input.down || input.jump ||
      input.attack || input.special || input.shield || input.grab || Math.abs(input.stickX || 0) > 0.1;
    if (this.downed) {
      if (hasWakeInput) {
        this.downed = false;
        this.recoveryTimer = 8;
      }
      return;
    }

    // ---- 受け身（テック）の先行入力 ----
    // 吹っ飛び中に地面へ叩きつけられる直前でシールドを押すと、ダウンせずに立て直せる。
    if (this.tumbling && !this.onGround && this.shieldEdge && this.techLockout <= 0) {
      this.techWindow = CONFIG.TECH_WINDOW_FRAMES;
      this.techLockout = CONFIG.TECH_LOCKOUT_FRAMES;
    }

    const tumbleJumpCancel = input.jump && !this.prevJumpHeld;
    const tumbleAttackCancel = input.attack && !this.prevAttackHeld;
    const tumbleSpecialCancel = input.special && !this.prevSpecialHeld;
    // ---- きりもみ（吹っ飛び）からの復帰 ----
    // 本家同様、のけぞり（ヒットスタン）が終わるまでは暴れても抜けられない。
    // 以前はここで無条件に hitstun を0にしていたため、ジャンプ・攻撃・必殺を
    // 連打するだけで吹っ飛びを1フレームで抜けられ、ジャンプ回数を使い切って
    // いても即座に動けるので「被弾でジャンプが復活した」ように見えていた。
    // ジャンプが残っていない時は、ジャンプ入力そのものを無かったことにして
    // 技・必殺での立て直しだけは通す。
    const canTumbleJump = tumbleJumpCancel && this.jumpsUsed < CONFIG.MAX_JUMPS;
    if (this.tumbling && !this.onGround && this.hitstun <= 0 &&
        (canTumbleJump || tumbleAttackCancel || tumbleSpecialCancel)) {
      this.tumbling = false;
      if (canTumbleJump) {
        this.vy = Physics.jumpVelocity(this.jumpPower);
        this.jumpsUsed++;
        this.jumpAnimTimer = 0;
        this.prevJumpHeld = true;
      } else if (tumbleSpecialCancel) {
        const key = this.getHeldDirection(input) || 'neutral';
        const move = (this.moveSet.special && this.moveSet.special[key]) || MOVES.special[key];
        // 上必殺は空中で1回だけ。使い切っていればきりもみのまま。
        if (move.recoveryBoost && this._usedUpSpecialAirborne) {
          this.tumbling = true;
          return;
        }
        this.startAttack(move);
        if (move.dashForward) this.vx = this.facing * move.dashForward;
        if (move.recoveryBoost) {
          this._usedUpSpecialAirborne = true;
          this.helpless = true;
          this.vy = move.recoveryBoost;
        }
        this.prevSpecialHeld = true;
      } else {
        const dir = this.getHeldDirection(input);
        const move = dir === 'up' ? MOVES.air.up : dir === 'down' ? MOVES.air.down :
          dir === 'side' ? MOVES.air.forward : MOVES.air.neutral;
        this.startAttack(move);
        this.prevAttackHeld = true;
      }
      return;
    }

    if (this.hitstun > 0) return;
    if (this.recoveryTimer > 0) return;
    if (this.dazedTimer > 0) { this.dazedTimer--; return; } // シールド破壊後のピヨリ：操作不能
    if (this.dodgeTimer > 0) {
      this.dodgeTimer--;
      if (this.dodgeTimer <= 0) {
        this.vx = 0;
        if (this.dodgeType === 'air') this.hitstun = CONFIG.AIR_DODGE_LAG_FRAMES;
      }
      return;
    }
    if (this.grabbedBy) { return; } // 掴まれている間は操作不能（位置はupdate()側で追従）
    if (this.grabbing) { this.handleGrabInput(input); return; }
    if (this.smashCandidate) { this.handleSmashCharge(input); return; }

    // 行動不能（上B使用後など）：着地するまで一切の操作を受け付けない
    if (this.helpless) {
      if (!this.onGround) return;
      this.helpless = false;
    }

    // ---- 崖掴まり中 ----
    if (this.onLedge) {
      this.ledgeHangFrames++;
      if (this.ledgeHangFrames > CONFIG.LEDGE_MAX_HANG_FRAMES) {
        this.releaseFromLedge(false, true); // 自動離脱：着地するまで再度掴まらない
        return;
      }
      if (input.down) { this.releaseFromLedge(false); return; }
      if (input.jump) { this.releaseFromLedge(true); return; }

      const awayFromStage = (this.onLedge.edge === 'left' && input.left) || (this.onLedge.edge === 'right' && input.right);
      if (awayFromStage) { this.releaseFromLedge(false); return; }

      const towardStage = (this.onLedge.edge === 'left' && input.right) || (this.onLedge.edge === 'right' && input.left);
      if (towardStage || input.up || input.attack) { this.climbFromLedge(); return; }

      return; // ただ掴まっている
    }

    const wasOnGround = this.onGround; // ジャンプ処理より前の接地状態（同フレーム誤爆防止）
    if (wasOnGround) this._airDodgeUsed = false;
    // solid（地面）の上では下入力ですり抜けない。地面を穴で分割して複数枚にした
    // コースでは2枚目以降も地面なので、ここを見ないと下強・下スマが出せなくなる。
    if (wasOnGround && this.groundedPlatform > 0 && !this.groundedSolid && this.downEdge) {
      this.dropThroughTimer = 14;
      this.onGround = false;
      this.groundedPlatform = null;
      this.y += 8;
      return;
    }

    const shieldEdge = this.shieldEdge; // updateEdges()で算出済み

    // ---- シールド／回避（シールド + 方向） ----
    if (input.shield && wasOnGround && this.attackTimer <= 0) {
      if (this.downEdge) { this.startDodge('spot'); return; }
      if (this.leftEdge || this.rightEdge) { this.startDodge('roll', this.leftEdge ? -1 : 1); return; }

      // 張り始めからのフレーム数を数える（ジャストガードの成立判定に使う）
      this.shieldHeldFrames = this.shielding ? this.shieldHeldFrames + 1 : 1;
      this.shielding = true;
      this.crouching = false;
      this.vx = 0;
      this.shieldHP -= CONFIG.SHIELD_DRAIN_PER_FRAME;
      if (this.shieldHP <= 0) { this.breakShield(); return; }
      return; // シールド中は他の行動不可
    } else if (shieldEdge && !wasOnGround && this.attackTimer <= 0 && !this._airDodgeUsed) {
      // ---- 空中緊急回避（エアドッジ） ----
      // スティック入力があればその方向へ少し移動、無ければその場で（落下しながら）回避
      let dirX = 0, dirY = 0;
      if (input.left) dirX = -1; else if (input.right) dirX = 1;
      if (input.up) dirY = -1; else if (input.down) dirY = 1;
      const mag = Math.hypot(dirX, dirY);

      this.dodgeTimer = CONFIG.AIR_DODGE_FRAMES;
      this.dodgeType = 'air';
      this.invincible = Math.max(this.invincible, CONFIG.AIR_DODGE_FRAMES);
      if (mag > 0.01) {
        this.vx = (dirX / mag) * CONFIG.AIR_DODGE_SPEED;
        this.vy = (dirY / mag) * CONFIG.AIR_DODGE_SPEED;
      }
      this._airDodgeUsed = true;
      this.shielding = false;
      return;
    } else {
      // シールドを離した瞬間だけ猶予を立てる。この数フレーム以内に攻撃を受けると
      // ジャストシールドが成立する（押しっぱなしからの離しでしか出ない）。
      if (this.shielding) this.shieldReleaseTimer = CONFIG.JUST_SHIELD_WINDOW;
      this.shielding = false;
      this.shieldHeldFrames = 0;
      if (this.shieldHP < CONFIG.SHIELD_MAX) {
        this.shieldHP = Math.min(CONFIG.SHIELD_MAX, this.shieldHP + CONFIG.SHIELD_REGEN_PER_FRAME);
      }
    }

    // ---- 移動（スティックの倒し込み量で 歩き/ダッシュ を判定） ----
    // ・DASH_TILT_THRESHOLD以上：ダッシュ速度（保持し続ければ走り、すぐ離せば結果的に短い「ステップ」になる）
    // ・それ未満〜デッドゾーン以上：倒し込み量に比例した歩行速度
    // ---- しゃがみ（地上で下入力。当たり判定が低くなる） ----
    this.crouching = wasOnGround && input.down && !this.isDashing &&
      this.attackTimer <= 0 && this.recoveryTimer <= 0 && this.landingLag <= 0;

    if (this.attackTimer <= 0) {
      const stickX = input.stickX || 0;
      const absX = Math.abs(stickX);
      if (wasOnGround) {
        // 地上：スティックの倒し込み量に応じて即座に速度が決まる
        if (this.crouching || absX < CONFIG.WALK_DEADZONE) {
          this.vx = 0;
          this.isDashing = false;
        } else if (absX >= CONFIG.DASH_TILT_THRESHOLD) {
          this.vx = Math.sign(stickX) * Physics.computeMoveSpeed(this.stats.evasion, true);
          this.facing = Math.sign(stickX);
          this.isDashing = true;
        } else {
          this.vx = Math.sign(stickX) * Physics.computeMoveSpeed(this.stats.evasion, false) * absX;
          this.facing = Math.sign(stickX);
          this.isDashing = false;
        }
      } else {
        // ---- 空中：本家同様、速度を直接書き換えず加速度で慣性を変える ----
        // 大事なのは「空中最高速はあくまで“自分で流せる速さ”の上限」であること。
        // 吹っ飛びやダッシュジャンプで得た慣性はそれより速く、上限で頭打ちにしない。
        // 以前は毎フレーム上限で切り落としていたため、のけぞりが切れた瞬間に
        // 吹っ飛びが急停止し、本家と比べて慣性が無いように感じられていた。
        this.isDashing = false;
        const airMax = Physics.computeMoveSpeed(this.stats.evasion, true) * CONFIG.AIR_MAX_SPEED_RATIO;
        const speed = Math.abs(this.vx);
        if (absX < CONFIG.WALK_DEADZONE) {
          // きりもみ中は update() 側で吹っ飛びの減速をかけているため、
          // ここで空気抵抗まで足すと二重に減速してしまう。
          if (!this.tumbling) this.vx *= CONFIG.AIR_FRICTION;
        } else {
          const dir = Math.sign(stickX);
          if (speed > airMax && Math.sign(this.vx) === dir) {
            // すでに上限より速い方向へ入力しても、それ以上は加速しない。
            // 慣性は空気抵抗でゆっくり抜けていく。
            this.vx *= CONFIG.AIR_FRICTION;
          } else {
            const target = dir * airMax * Math.min(1, absX / CONFIG.DASH_TILT_THRESHOLD);
            const accel = CONFIG.AIR_ACCEL * absX;
            if (this.vx < target) this.vx = Math.min(target, this.vx + accel);
            else if (this.vx > target) this.vx = Math.max(target, this.vx - accel);
          }
          this.facing = dir;
        }
      }
    }

    // ---- ジャンプ（タップジャンプ設定＋小ジャンプ/大ジャンプ判定） ----
    const tapJumpEnabled = window.GameSettings ? window.GameSettings.tapJumpEnabled : true;
    const jumpHeldCombined = input.jump || (tapJumpEnabled && input.up);
    const jumpPressed = jumpHeldCombined && !this.prevJumpHeld;
    if (jumpPressed && this.jumpsUsed < CONFIG.MAX_JUMPS) {
      this.vy = Physics.jumpVelocity(this.jumpPower);
      this.jumpsUsed++;
      this.onGround = false;
      this.jumpFrames = 0;
      this.jumpCutDone = false;
      this.jumpAnimTimer = 0;
    }
    if (!this.jumpCutDone) {
      this.jumpFrames++;
      const jumpReleased = this.prevJumpHeld && !jumpHeldCombined;
      if (jumpReleased && this.jumpFrames <= CONFIG.SHORT_HOP_FRAMES && this.vy < 0) {
        // 早離し → 小ジャンプ（上昇速度をカット）
        this.vy *= CONFIG.SHORT_HOP_CUT_MULTIPLIER;
        this.jumpCutDone = true;
      } else if (this.jumpFrames > CONFIG.SHORT_HOP_FRAMES) {
        this.jumpCutDone = true; // 猶予を過ぎたら大ジャンプ確定
      }
    }
    this.prevJumpHeld = jumpHeldCombined;

    // ---- 急降下（落下中に下を入れ直すと一気に落ちる） ----
    // スマブラ同様、入力した瞬間に落下速度が最大まで跳ね上がる。
    if (!wasOnGround && this.vy > 0 && this.downEdge && !this.fastFalling) {
      this.fastFalling = true;
      this.vy = Math.max(this.vy, Physics.terminalFallSpeed(this.fallSpeed, false));
    }

    // ---- 掴み ----
    const grabPressed = input.grab && !this.prevGrabHeld;
    this.prevGrabHeld = input.grab;
    if (grabPressed && wasOnGround && this.attackTimer <= 0) {
      this._wantsGrab = true;
    }

    // ---- 通常攻撃 A ----
    // 地上で方向キー(横/上/下)が先行入力されていれば強攻撃、Aとほぼ同時なら溜め可能なスマッシュ
    const attackPressed = input.attack && !this.prevAttackHeld;
    if (attackPressed && this.attackTimer <= 0) {
      const dir = this.getHeldDirection(input);
      if (wasOnGround && this.isDashing && dir !== 'up' && dir !== 'down') {
        // ダッシュ中のA → ダッシュ攻撃（進行方向へ滑り込みながら攻撃）
        this.startAttack(MOVES.ground.dashAttack);
      } else if (wasOnGround && (dir === 'side' || dir === 'up' || dir === 'down')) {
        const pressTime = dir === 'side'
          ? (input.left ? this.dirPressTime.left : this.dirPressTime.right)
          : this.dirPressTime[dir];
        const elapsedSinceDirPress = Date.now() - (pressTime || Date.now());

        if (elapsedSinceDirPress <= CONFIG.SMASH_SIMULTANEOUS_WINDOW_MS) {
          // 方向とAがほぼ同時 → スマッシュ（溜め開始）
          this.smashCandidate = { dir, elapsed: 0, smashMove: MOVES.smash[dir] };
        } else {
          // 方向が先行入力されていた → 強攻撃（即発動）
          this.startAttack(MOVES.ground[dir]);
        }
      } else if (wasOnGround) {
        this.startAttack((this.moveSet.ground && this.moveSet.ground.neutral) || MOVES.ground.neutral);
      } else {
        let move;
        if (dir === 'up') move = MOVES.air.up;
        else if (dir === 'down') move = MOVES.air.down;
        else if (dir === 'side') {
          const forward = (input.right && this.facing === 1) || (input.left && this.facing === -1);
          move = forward ? MOVES.air.forward : MOVES.air.back;
        } else {
          move = MOVES.air.neutral;
        }
        this.startAttack(move);
      }
    }
    this.prevAttackHeld = input.attack;

    // ---- 必殺技 B（地上・空中共通） ----
    const specialPressed = input.special && !this.prevSpecialHeld;
    if (specialPressed && this.attackTimer <= 0) {
      const dir = this.getHeldDirection(input);
      const moveKey = dir || 'neutral';
      const move = (this.moveSet.special && this.moveSet.special[moveKey]) || MOVES.special[moveKey];

      // 上B（recoveryBoostを持つ技）は空中では1回のみ使用可能。使用後は着地するまで行動不能。
      if (move.recoveryBoost) {
        if (this._usedUpSpecialAirborne) {
          this.prevSpecialHeld = input.special;
          return;
        }
        this._usedUpSpecialAirborne = true;
        this.helpless = true;
      }

      this.startAttack(move);
      if (move.dashForward) this.vx = this.facing * move.dashForward;
      if (move.recoveryBoost) { this.vy = move.recoveryBoost; this.onGround = false; }
    }
    this.prevSpecialHeld = input.special;
  }

  // ---- 崖に掴まる（game.jsのcheckLedgesから呼ばれる） ----
  grabLedge(ledge, platform) {
    const surfaceY = platform.surfaceY != null ? platform.surfaceY : platform.y;
    this.onLedge = { edge: ledge.edge, ledgeX: ledge.x, platformY: surfaceY };
    // 崖の縁に手をかけて“ぶら下がる”位置に置く。
    // 以前は崖の上に立っているように見える高さだったため、掴まっているのか分かりにくかった。
    this.x = ledge.edge === 'left' ? ledge.x - this.w * 0.82 : ledge.x - this.w * 0.18;
    this.y = surfaceY - this.h * 0.42;
    this.vx = 0;
    this.vy = 0;
    this.invincible = Math.max(this.invincible, CONFIG.LEDGE_INVINCIBLE_FRAMES);
    this.hitstun = 0;
    this.dodgeTimer = 0;
    this.attackTimer = 0;
    this.currentMove = null;
    this.recoveryTimer = 0;
    this.jumpsUsed = 0;
    this._usedUpSpecialAirborne = false;
    this.helpless = false;
    this.ledgeHangFrames = 0;
    this.facing = ledge.edge === 'left' ? 1 : -1;
  }

  // 崖から手を離す（withJump=trueならジャンプしながら離す／isTimeout=trueなら着地するまで再掴まり禁止）
  releaseFromLedge(withJump, isTimeout) {
    this.onLedge = null;
    this.ledgeCooldown = CONFIG.LEDGE_COOLDOWN_FRAMES;
    if (isTimeout) {
      this.ledgeLocked = true;
      this.ledgeCooldown = Math.max(this.ledgeCooldown, 60);
    }
    if (withJump) {
      this.vy = Physics.jumpVelocity(this.jumpPower);
      this.jumpsUsed = 1;
      this.invincible = Math.max(this.invincible, 10);
      this.jumpAnimTimer = 0;
    } else {
      this.vy = 0;
    }
    this.onGround = false;
  }

  // 崖をよじ登ってステージに上がる
  climbFromLedge() {
    const edge = this.onLedge.edge;
    this.x = edge === 'left' ? this.onLedge.ledgeX + 4 : this.onLedge.ledgeX - this.w - 4;
    this.y = this.onLedge.platformY - this.h;
    this.onGround = true;
    this.vx = 0;
    this.vy = 0;
    this.jumpsUsed = 0;
    this.invincible = Math.max(this.invincible, 15); // よじ登り中の僅かな無敵
    this.onLedge = null;
    this.ledgeCooldown = CONFIG.LEDGE_COOLDOWN_FRAMES;
  }

  // ---- スマッシュ溜め処理（発動確定済み。ホールド時間に応じて威力が伸びる） ----
  handleSmashCharge(input) {
    const sc = this.smashCandidate;
    if (!input.attack) {
      const frac = Math.min(1, sc.elapsed / CONFIG.SMASH_MAX_CHARGE_FRAMES);
      this.startAttack(this.buildSmashMove(sc.smashMove, frac));
      this.smashCandidate = null;
    } else {
      sc.elapsed++;
      if (sc.elapsed >= CONFIG.SMASH_MAX_CHARGE_FRAMES) {
        this.startAttack(this.buildSmashMove(sc.smashMove, 1));
        this.smashCandidate = null;
      }
    }
    this.vx = 0; // 溜め中は移動不可
  }

  buildSmashMove(base, frac) {
    const bonus = 1 + frac * CONFIG.SMASH_CHARGE_BONUS_MAX;
    return Object.assign({}, base, {
      dmgBase: base.dmgBase * bonus,
      kbBase: base.kbBase * bonus,
      charged: true,
    });
  }

  // ---- 回避（その場/横ステップ）開始 ----
  startDodge(type, dir) {
    this.shielding = false;
    if (type === 'spot') {
      this.dodgeTimer = CONFIG.DODGE_SPOT_FRAMES;
      this.invincible = Math.max(this.invincible, CONFIG.DODGE_SPOT_FRAMES);
      this.vx = 0;
      this.dodgeType = 'spot';
    } else {
      this.dodgeTimer = CONFIG.DODGE_ROLL_FRAMES;
      this.invincible = Math.max(this.invincible, CONFIG.DODGE_ROLL_FRAMES);
      this.vx = dir * CONFIG.DODGE_ROLL_SPEED;
      this.facing = dir;
      this.dodgeType = 'roll';
    }
  }

  breakShield() {
    this.shielding = false;
    this.shieldReleaseTimer = 0; // 割れた直後にジャストが出てしまわないよう消す
    this.shieldHP = 0;
    this.dazedTimer = CONFIG.SHIELD_BREAK_DAZE_FRAMES;
  }

  // ---- 掴み中（自分が掴んでいる側）の入力処理 ----
  handleGrabInput(input) {
    this.grabTimer--;
    const attackPressed = input.attack && !this.prevAttackHeld;
    this.prevAttackHeld = input.attack;
    this.vx = 0;

    if (attackPressed) {
      let key = 'neutral';
      if (input.up) key = 'up';
      else if (input.down) key = 'down';
      else if (input.left || input.right) key = 'side';
      this.executeThrow(key, input);
      return;
    }
    if (this.grabTimer <= 0) this.releaseGrab();
  }

  executeThrow(key, input) {
    const target = this.grabbing;
    if (!target) return;
    const move = THROWS[key];
    const dir = key === 'side' ? (input.left ? -1 : 1) : this.facing;

    const dmg = Physics.computeDamage(move.dmgBase, this.stats[move.statKey], target.stats.life);
    target.damagePercent += dmg;
    const kb = Physics.computeKnockback(move.kbBase, target.damagePercent, this.stats[move.statKey], target.stats.defense)
      * target.knockbackTakenMultiplier;
    const angleRad = (move.angle * Math.PI) / 180;
    target.vx = dir * kb * Math.cos(angleRad);
    target.vy = -kb * Math.sin(angleRad);
    target.hitstun = Math.min(CONFIG.HITSTUN_MAX,
      Math.max(CONFIG.HITSTUN_MIN, Math.round(kb * CONFIG.HITSTUN_PER_KB)));
    target.onGround = false;
    target.fastFalling = false;
    target.lastAttacker = this;
    target.lastHitAt = Date.now();
    target.downed = false;
    target.tumbling = target.damagePercent >= CONFIG.TUMBLE_DAMAGE_THRESHOLD;
    target.techWindow = 0;
    target.grabbedBy = null;
    // 投げも命中時は一瞬止める（掴み→投げの決定感を出す）
    const lag = Physics.hitlagFrames(dmg, false);
    this.hitlag = Math.max(this.hitlag, lag);
    target.hitlag = Math.max(target.hitlag, lag);
    if (window.Camera) Camera.shake(Math.min(CONFIG.SHAKE_MAX, kb * CONFIG.SHAKE_PER_KB));

    this.grabbing = null;
    this.grabTimer = 0;
  }

  releaseGrab() {
    if (this.grabbing) this.grabbing.grabbedBy = null;
    this.grabbing = null;
    this.grabTimer = 0;
  }

  // 掴みリクエストを一度だけ消費（game.js側のcheckGrabsから呼ばれる）
  consumeGrabRequest() {
    if (this._wantsGrab) { this._wantsGrab = false; return true; }
    return false;
  }

  // 自動モーションで技の種類ごとに動きを変えるため、どの技かを覚えておく
  _slotForMove(move) {
    if (!move) return null;
    for (const table of [this.moveSet, typeof MOVES === 'object' ? MOVES : null]) {
      if (!table) continue;
      for (const [group, moves] of Object.entries(table)) {
        if (!moves || typeof moves !== 'object') continue;
        for (const [key, candidate] of Object.entries(moves)) {
          if (candidate === move) return `${group}.${key}`;
        }
      }
    }
    // スマッシュは溜め量を反映した複製が渡るため、同じ名前の技から引き当てる
    for (const table of [this.moveSet, typeof MOVES === 'object' ? MOVES : null]) {
      if (!table) continue;
      for (const [group, moves] of Object.entries(table)) {
        if (!moves || typeof moves !== 'object') continue;
        for (const [key, candidate] of Object.entries(moves)) {
          if (candidate && candidate.name && candidate.name === move.name) return `${group}.${key}`;
        }
      }
    }
    return null;
  }

  // 斬撃の軌跡：攻撃判定の通り道を数フレームぶん覚えておく。
  // 飛び道具の技は体から判定が出ないため対象外。
  _recordSwingTrail() {
    const attacking = this.currentMove && this.attackTimer > 0 && !this.currentMove.projectile;
    if (!attacking) {
      if (this._swingTrail.length) this._swingTrail.length = 0;
      return;
    }
    const hb = this.getHitbox();
    if (hb) {
      this._swingTrail.push({
        x: hb.x + hb.w / 2,
        y: hb.y + hb.h / 2,
        // 帯の太さは判定の短い方を基準にする（長い方だと巨大な白い塊になる）
        r: Math.min(hb.w, hb.h) / 2,
        power: this.currentMove.kbBase || 5,
      });
      if (this._swingTrail.length > 9) this._swingTrail.shift();
    }
  }

  // 覚えておいた通り道を、先細りの帯として描く
  _drawSwingTrail(ctx) {
    const trail = this._swingTrail;
    if (trail.length < 2) return;
    const power = Math.min(1.4, (trail[trail.length - 1].power || 5) / 9);
    const maxWidth = this.h * 0.22;              // 体格に対して太くなりすぎないよう頭打ち
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < trail.length; i++) {
      const t = i / (trail.length - 1);          // 新しいほど1に近い
      const a = trail[i - 1], b = trail[i];
      const width = Math.max(2, Math.min(maxWidth, b.r * 0.9 * t));
      ctx.globalAlpha = 0.04 + 0.20 * t * power;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.globalAlpha = 0.05 + 0.26 * t * power;
      ctx.strokeStyle = '#dff4ff';
      ctx.lineWidth = Math.max(1, width * 0.35);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }

  // 立ち絵を 頭 / 胴 / 奥の脚 / 手前の脚 の4枚へ切り分ける。
  // 上の部品は下の部品より少しはみ出して切り、振った時に切り口の隙間が
  // 見えないようにする（胴が腰の継ぎ目を、頭が首の継ぎ目を覆う）。
  _buildPartsLayer() {
    const spec = this.partsSpec;
    if (!spec || !this.sprite || !this.spriteLoaded) return null;
    if (typeof document === 'undefined') return null;
    // 切り分けるのは塗り替えた後の絵。逆にすると元の色のまま切り出されてしまう。
    const sprite = this._skinned(this.sprite);
    const W = sprite.width, H = sprite.height;
    const neckY = Math.max(1, Math.min(H - 2, Math.round(spec.neckY)));
    const hipY = Math.max(neckY + 1, Math.min(H - 1, Math.round(spec.hipY)));
    const splitX = Math.max(1, Math.min(W - 1, Math.round(spec.legSplitX)));
    const overlap = Math.max(0, Math.round(spec.overlap != null ? spec.overlap : Math.round(H * 0.02)));

    const slice = (sx, sy, sw, sh) => {
      if (sw <= 0 || sh <= 0) return null;
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(sprite, sx, sy, sw, sh, 0, 0, sw, sh);
      return { canvas: c, x: sx, y: sy };
    };

    // 切り出した絵の中で、実際に色がある範囲の横中心を求める（脚の付け根の目安）
    const centerXOf = (part, fallback) => {
      if (!part) return fallback;
      const ctx = part.canvas.getContext('2d', { willReadFrequently: true });
      const data = ctx.getImageData(0, 0, part.canvas.width, Math.min(part.canvas.height, 12)).data;
      let sum = 0, count = 0;
      for (let i = 0, px = 0; i < data.length; i += 4, px++) {
        if (data[i + 3] > 40) { sum += px % part.canvas.width; count++; }
      }
      return count ? part.x + sum / count : fallback;
    };

    const head = slice(0, 0, W, Math.min(H, neckY + overlap));
    const torso = slice(0, neckY, W, Math.min(H - neckY, hipY + overlap - neckY));
    const legBack = slice(0, hipY, splitX, H - hipY);
    const legFront = slice(splitX, hipY, W - splitX, H - hipY);
    if (!head || !torso || !legBack || !legFront) return null;

    return {
      head: { ...head, pivotX: W / 2, pivotY: neckY },
      torso: { ...torso, pivotX: W / 2, pivotY: hipY },
      legBack: { ...legBack, pivotX: centerXOf(legBack, splitX / 2), pivotY: hipY },
      legFront: { ...legFront, pivotX: centerXOf(legFront, (splitX + W) / 2), pivotY: hipY },
    };
  }

  // 立ち絵から武器の部分だけを取り出す。
  // 元の絵からは抜かない：矩形で抜くと、武器が体に重なっているキャラでは
  // 黒い長方形の穴が出てしまい、二重に見えるより遥かに目立つため。
  // 元の武器は振ったぶんだけ残像のように見えるので、振り角は控えめに抑える。
  _buildWeaponLayer() {
    const spec = this.weaponSpec;
    if (!spec || !spec.rect || !this.sprite || !this.spriteLoaded) return null;
    if (typeof document === 'undefined') return null;
    const { x, y, w, h } = spec.rect;
    if (!(w > 0 && h > 0)) return null;

    const weapon = document.createElement('canvas');
    weapon.width = Math.round(w); weapon.height = Math.round(h);
    // 武器もパーツ分割と同じく、塗り替えた後の絵から切り出す
    weapon.getContext('2d').drawImage(this._skinned(this.sprite), x, y, w, h, 0, 0, weapon.width, weapon.height);

    const pivot = spec.pivot || { x: x + w / 2, y: y + h / 2 };
    return { weapon, pivotX: pivot.x, pivotY: pivot.y, rect: spec.rect };
  }

  startAttack(move) {
    this.currentMove = move;
    this.currentMoveSlot = this._slotForMove(move);
    this.attackTimer = move.duration;
    this.hasHitThisAttack = false;
    this._hitWindowIndex = -1;
    this._isLinkHit = false;
    this._hitTargets.clear();
    this._projectileSpawned = false;
  }

  consumeProjectileRequest() {
    const request = this._projectileRequest;
    this._projectileRequest = null;
    return request;
  }

  // 現在の判定ウィンドウ番号（多段技はループごと、通常技は0、判定が出ていなければ-1）。
  // 副作用を持たないため描画からも安全に呼べる。
  _activeWindowIndex(m, framesElapsed) {
    if (Array.isArray(m.multiHit) && m.multiHit.length) {
      for (let i = 0; i < m.multiHit.length; i++) {
        if (framesElapsed >= m.multiHit[i][0] && framesElapsed <= m.multiHit[i][1]) return i;
      }
      return -1;
    }
    return (framesElapsed >= m.active[0] && framesElapsed <= m.active[1]) ? 0 : -1;
  }

  // 判定ウィンドウの切り替わりを検出して「誰に当てたか」をリセットする。
  // update()から1シミュレーションステップにつき1回だけ呼ぶこと
  // （以前はgetHitbox()内で行っていたため、描画からの呼び出しで状態が壊れる恐れがあった）。
  _updateHitWindow() {
    const m = this.currentMove;
    if (this.attackTimer <= 0 || !m) {
      this._hitWindowIndex = -1;
      this._isLinkHit = false;
      return;
    }
    const index = this._activeWindowIndex(m, m.duration - this.attackTimer);
    if (index !== this._hitWindowIndex) {
      this._hitWindowIndex = index;
      this.hasHitThisAttack = false;
      this._hitTargets.clear();
    }
    // 多段技の途中段かどうか（最終段のみ吹っ飛び、それ以外は怯ませ判定）
    const hitCount = (Array.isArray(m.multiHit) && m.multiHit.length) ? m.multiHit.length : 1;
    this._isLinkHit = index >= 0 && index < hitCount - 1;
  }

  // 同じ判定ウィンドウ中に同じ相手へ多重ヒットしないための記録
  hasHitTarget(target) { return this._hitTargets.has(target); }
  markHitTarget(target) {
    this._hitTargets.add(target);
    this.hasHitThisAttack = true; // 単発判定しか見ない箇所（修行ミニゲーム等）との互換用
  }

  // 技に hitboxes（コマごとの判定）がある場合、今のコマに対応する判定を返す。
  // 値は「足元中央を原点、当たり判定の高さを1」とした相対座標なので、
  // キャラの大きさが違っても同じ振り方になる。
  //   x: 前方向が+（向きに応じて自動で反転）／ y: 上が-（足元が0）
  _pathHitbox(m, framesElapsed) {
    if (!Array.isArray(m.hitboxes) || !m.hitboxes.length) return null;
    let found = null;
    for (const box of m.hitboxes) {
      const range = box.frames;
      if (!Array.isArray(range)) continue;
      if (framesElapsed >= range[0] && framesElapsed <= range[1]) { found = box; break; }
    }
    // 判定コマの隙間に落ちた場合は直近のものを使い、途切れて見えないようにする
    if (!found) {
      for (const box of m.hitboxes) {
        if (Array.isArray(box.frames) && framesElapsed > box.frames[1]) found = box;
      }
    }
    if (!found) return null;
    const unit = this.h;
    const originX = this.x + this.w / 2;
    const originY = this.y + this.h;
    const w = Math.max(1, found.w * unit);
    const h = Math.max(1, found.h * unit);
    const x = this.facing === 1 ? originX + found.x * unit : originX - found.x * unit - w;
    return { x, y: originY + found.y * unit, w, h };
  }

  getHitbox() {
    const m = this.currentMove;
    if (this.attackTimer <= 0 || !m || m.projectile) return null;
    const framesElapsed = m.duration - this.attackTimer;
    if (this._activeWindowIndex(m, framesElapsed) < 0) return null;
    const path = this._pathHitbox(m, framesElapsed);
    if (path) return path;
    // コマごとの判定を持つ技は、対応する判定が無ければ「判定なし」。
    // range等の固定値へ落とすと、消したはずの旧設定で判定が出てしまう。
    if (Array.isArray(m.hitboxes) && m.hitboxes.length) return null;
    const scale = this.attackScale || 1;
    const range = m.range * scale;
    const boxH = m.h * scale;
    const yOff = (m.yOff || 0) * scale;
    const x = this.facing === 1 ? this.x + this.w : this.x - range;
    // 上半身寄りに判定を出す（中心からやや上）
    const y = this.y + (this.h - boxH) * 0.32 + yOff;
    return { x, y, w: range, h: boxH };
  }

  // 毎フレーム大量に呼ばれるため、オブジェクトを使い回してGC負荷を抑える。
  // しゃがみ中は上半身が下がるぶん、当たり判定も低くなる。
  getHurtbox() {
    const box = this._hurtbox;
    const h = this.crouching ? this.h * CONFIG.CROUCH_HURTBOX_RATIO : this.h;
    box.x = this.x; box.y = this.y + (this.h - h); box.w = this.w; box.h = h;
    return box;
  }

  // 現在の状態に対応するモーションを優先順に探す。
  // 用意されていない状態は次の候補へ落ち、最終的には待機モーションになる。
  _pickStateAnimation() {
    let order;
    if (this.onLedge) order = ['ledge', 'airIdle', 'idle'];
    else if (this.downed) order = ['downed', 'tumble', 'hurt', 'idle'];
    else if (this.tumbling) order = ['tumble', 'hurt', 'airIdle', 'idle'];
    else if (this.hitstun > 0 && this.attackTimer <= 0 && !this.shielding) order = ['hurt', 'idle'];
    else if (this.shielding) order = ['shield', 'idle'];
    else if (this.crouching) order = ['crouch', 'idle'];
    else if (!this.onGround) {
      const jump = this.stateAnimations.jump;
      const jumpLength = jump ? jump.images.length * (jump.config.frameDuration || 5) : 0;
      const inJumpMotion = this.jumpAnimTimer >= 0 && this.jumpAnimTimer < jumpLength;
      order = inJumpMotion ? ['jump', 'airIdle', 'idle'] : ['airIdle', 'jump', 'idle'];
    } else if (this.isMoving) order = this.isDashing ? ['dash', 'walk', 'idle'] : ['walk', 'idle'];
    else order = ['idle'];

    for (const key of order) {
      const state = this.stateAnimations[key];
      // wanted = 本来出したい状態。keyが違う場合は代替に落ちている＝専用モーションが無い。
      if (Fighter.animationReady(state)) return { key, state, wanted: order[0] };
    }
    return { key: null, state: null, wanted: order[0] };
  }

  // 状態アニメのコマ送りを進める（update()から毎フレーム呼ぶ）
  _advanceStateAnimation() {
    const found = this._pickStateAnimation();
    const picked = found && found.state ? found : null;
    const key = picked ? picked.key : null;
    if (key !== this.animState) {
      // 状態が変わったらコマを頭出しする
      this.animState = key;
      this.animTimer = 0;
      this.animFrame = 0;
      return;
    }
    if (!picked) return;
    this.animTimer++;
    const duration = picked.state.config.frameDuration || 6;
    if (key === 'jump') {
      // ジャンプはループさせず、モーションが終わったら空中待機へ移る
      this.animFrame = Math.min(picked.state.images.length - 1, Math.floor(this.jumpAnimTimer / duration));
    } else if (this.animTimer >= duration) {
      this.animTimer = 0;
      this.animFrame = (this.animFrame + 1) % picked.state.images.length;
    }
  }

  // 被弾時に進行中の行動をすべて打ち切る。
  // 技の突進(travelSpeed)や溜め・掴み要求が残っていると、
  // 吹っ飛びに余計な慣性が乗ったり、のけぞり明けに技が暴発したりするため必ずここで消す。
  cancelActionOnHit() {
    this.attackTimer = 0;
    this.currentMove = null;
    this.recoveryTimer = 0;
    this.smashCandidate = null;
    this.landingLag = 0;
    this.crouching = false;
    this._wantsGrab = false;
    this._projectileRequest = null;
    this._projectileSpawned = false;
    this._hitWindowIndex = -1;
    this._isLinkHit = false;
    this._hitTargets.clear();
    if (this.grabbing) this.releaseGrab();
  }

  // ---- ワンパターン相殺（同じ技を連発すると威力が落ちる） ----
  stalenessFor(move) {
    const key = move && move.name;
    if (!key || !this.staleQueue.length) return 1;
    let used = 0;
    for (let i = 0; i < this.staleQueue.length; i++) if (this.staleQueue[i] === key) used++;
    if (!used) return 1;
    const perUse = CONFIG.STALE_MAX_REDUCTION / CONFIG.STALE_QUEUE_SIZE;
    return 1 - Math.min(CONFIG.STALE_MAX_REDUCTION, used * perUse);
  }

  pushStale(move) {
    if (!move || !move.name) return;
    this.staleQueue.push(move.name);
    if (this.staleQueue.length > CONFIG.STALE_QUEUE_SIZE) this.staleQueue.shift();
  }

  // options.projectile: 飛び道具によるヒット（攻撃側にはヒットストップを与えない）
  takeHit(attacker, move, options) {
    // moveがnullになるのは呼び出し側の不整合だが、ここで落ちるとバトルごと止まるため必ず弾く
    if (!move || !attacker || this.invincible > 0 || this.dead) return;

    // 掴まれている最中に別の攻撃を受けたら掴みは解除される
    // （解除しないと吹っ飛びが掴み側の位置固定に打ち消され、永久に拘束されてしまう）
    if (this.grabbedBy && this.grabbedBy !== attacker) {
      this.grabbedBy.grabbing = null;
      this.grabbedBy.grabTimer = 0;
      this.grabbedBy = null;
    }

    // 多段技の途中ヒット：ふっ飛ばさずその場で怯ませ、ガードも許さない。
    // 最終段だけが通常どおりの吹っ飛び判定になる。
    const linkHit = Array.isArray(move.multiHit) && move.multiHit.length > 1
      && attacker.currentMove === move && attacker._isLinkHit === true;
    // 離した直後の猶予中も「ガードしている」として扱う。
    // そうしないと、ジャストシールドが成立する瞬間に生身で殴られてしまう。
    const inReleaseWindow = this.shieldReleaseTimer > 0;
    const wasShielding = (this.shielding || inReleaseWindow) && !linkHit;

    const dmgBase = (!linkHit && move.finalHit && move.finalHit.dmgBase != null)
      ? move.finalHit.dmgBase : move.dmgBase;
    let dmg = Physics.computeDamage(dmgBase, attacker.stats[move.statKey], this.stats.life);
    // ワンパターン相殺：同じ技を続けて当てるほど威力が落ちる（多段技の途中段は数えない）
    if (!linkHit) dmg *= attacker.stalenessFor(move);
    const critical = Math.random() < Physics.criticalChance(attacker.stats.accuracy);
    if (critical) dmg *= 1.2;
    let kbBase = move.kbBase;
    let angleDeg = move.angle;

    if (linkHit) {
      // 途中段はガード不能：シールドを強制解除してそのまま怯み判定を通す
      this.shielding = false;
      kbBase *= (move.linkKbScale != null ? move.linkKbScale : 0.15);
    } else {
      attacker.pushStale(move);
      if (move.finalHit) {
        // 最終段の吹っ飛び性能を個別に指定できる
        if (move.finalHit.kbBase != null) kbBase = move.finalHit.kbBase;
        if (move.finalHit.angle != null) angleDeg = move.finalHit.angle;
      }
    }

    const rawDamage = dmg;
    // ジャストシールド：ガード中に、攻撃が当たる瞬間へ合わせてシールドを離すと成立。
    // ダメージ・シールド削り・ガード硬直がゼロになり、逆に攻撃側へ大きな硬直を与える。
    // 押しっぱなしでは絶対に成立しない（それが「駆け引き」になる）。
    const justShield = wasShielding && inReleaseWindow;
    if (wasShielding) {
      if (justShield) {
        dmg = 0;
        kbBase = 0;
        this.justShieldFlash = CONFIG.JUST_SHIELD_FLASH_FRAMES;
        if (attacker && !(options && options.projectile)) {
          attacker.recoveryTimer = Math.max(attacker.recoveryTimer, CONFIG.JUST_SHIELD_ATTACKER_LAG);
          attacker.attackTimer = 0;
          attacker.currentMove = null;
        }
      } else {
        // 通常ガード：ダメージ/吹っ飛びを大幅軽減する代わりにシールドが削れる。
        // 削り量・ガード硬直とも技のダメージに比例するため、強い技ほどガードが不利になる。
        dmg *= 0.1;
        kbBase *= 0.1;
        this.shieldHP -= Math.max(5, rawDamage * CONFIG.SHIELD_CHIP_SCALE);
        if (this.shieldHP <= 0) this.breakShield();
      }
    }

    this.damagePercent += dmg;
    const kb = Physics.computeKnockback(kbBase, this.damagePercent, attacker.stats[move.statKey], this.stats.defense) * this.knockbackTakenMultiplier;
    const dir = move.backHit ? -attacker.facing : attacker.facing;

    // ヒットストップ：攻撃側・被弾側とも一瞬止まる（飛び道具は攻撃側を止めない）
    const lag = Physics.hitlagFrames(rawDamage, wasShielding);
    this.hitlag = Math.max(this.hitlag, lag);
    if (attacker && !(options && options.projectile)) attacker.hitlag = Math.max(attacker.hitlag, lag);

    if (linkHit) {
      // 怯み：ほぼその場に留めて次の段まで硬直させる（浮かせない／転倒させない）
      this.cancelActionOnHit();
      this.vx = dir * kb * 0.35;
      this.vy = 0;
      this.tumbling = false;
      this.downed = false;
      this.lastAttacker = attacker;
      this.lastHitAt = Date.now();
      this.hitstun = Math.max(this.hitstun, move.linkHitstun || 34);
      return;
    }

    if (wasShielding) {
      // ガード硬直＋ガード時の後退（ノックバックせず滑るだけ）。
      // ジャストガードなら硬直も後退も発生しない＝すぐ反撃に移れる。
      this.cancelActionOnHit();
      this.hitstun = justShield ? 0
        : Math.round(CONFIG.SHIELD_STUN_BASE + rawDamage * CONFIG.SHIELD_STUN_PER_DAMAGE);
      this.vx = justShield ? 0 : dir * Math.min(CONFIG.SHIELD_PUSHBACK_MAX, rawDamage * 0.28);
      this.vy = 0;
      return;
    }

    // 吹っ飛びベクトル。被弾側のスティック入力でこれを最大±DI_MAX_ANGLE_SHIFT度ずらせる（DI）。
    const angleRad = (angleDeg * Math.PI) / 180;
    let vx = dir * kb * Math.cos(angleRad);
    let vy = -kb * Math.sin(angleRad);
    const diMag = Math.hypot(this.diX, this.diY);
    if (diMag > 0.25 && kb > 0) {
      // 吹っ飛び方向に対する「直交成分」の分だけ軌道を回す（スマブラのDIと同じ考え方）
      const ux = vx / kb, uy = vy / kb;
      const cross = ux * (this.diY / diMag) - uy * (this.diX / diMag);
      const shift = Math.max(-1, Math.min(1, cross)) * CONFIG.DI_MAX_ANGLE_SHIFT * Math.PI / 180;
      const cos = Math.cos(shift), sin = Math.sin(shift);
      const rx = vx * cos - vy * sin;
      const ry = vx * sin + vy * cos;
      vx = rx; vy = ry;
    }
    // 進行中の技・溜め・掴みは被弾で必ずキャンセルする（突進技の慣性を持ち越さない）
    this.cancelActionOnHit();
    this.vx = vx;
    this.vy = vy;
    this.fastFalling = false;
    this.onGround = false;
    this.lastAttacker = attacker;
    this.lastHitAt = Date.now();
    this.downed = false;
    this.tumbling = this.damagePercent >= CONFIG.TUMBLE_DAMAGE_THRESHOLD;
    if (this.tumbling) this.techWindow = 0; // 新しく吹っ飛んだら受け身は入力し直し

    this.hitstun = Math.min(CONFIG.HITSTUN_MAX,
      Math.max(CONFIG.HITSTUN_MIN, Math.round(kb * CONFIG.HITSTUN_PER_KB)));
    if (window.Camera) Camera.shake(Math.min(CONFIG.SHAKE_MAX, kb * CONFIG.SHAKE_PER_KB));
  }

  update(platforms, blastBounds) {
    if (this.dead) return;

    // ヒットストップ：位置・速度・全タイマーを完全に停止させ、
    // 「当たった瞬間に画面が固まる」スマブラ特有の手応えを出す。描画用の小刻みな揺れだけ更新する。
    if (this.hitlag > 0) {
      this.hitlag--;
      this.hitlagShakeX = this.hitlag > 0 ? (this.hitlag % 2 ? 2.4 : -2.4) : 0;
      return;
    }
    this.hitlagShakeX = 0;
    if (this.techLockout > 0) this.techLockout--;
    if (this.techWindow > 0) this.techWindow--;
    if (this.landingLag > 0) {
      this.landingLag--;
      this.vx *= 0.8; // 着地隙の間は踏ん張って止まる
    }

    // 掴まれている間は相手の近くに固定（自由落下しない）
    if (this.grabbedBy) {
      const grabber = this.grabbedBy;
      this.x = grabber.facing === 1
        ? grabber.x + grabber.w * 0.72
        : grabber.x - this.w * 0.72;
      // 体格差があっても足元が台を突き抜けないよう、頭ではなく足元を揃える。
      this.y = grabber.y + grabber.h - this.h;
      this.vx = 0;
      this.vy = 0;
      this.onGround = grabber.onGround;
      this.groundedPlatform = grabber.groundedPlatform;
      return;
    }

    // 崖に掴まっている間は静止（applyInputで位置を設定済み）
    if (this.onLedge) {
      this.vx = 0;
      this.vy = 0;
      if (this.invincible > 0) this.invincible--;
      return;
    }
    if (this.ledgeCooldown > 0) this.ledgeCooldown--;
    if (this.dropThroughTimer > 0) this.dropThroughTimer--;

    this._updateHitWindow();

    if (this.attackTimer > 0) {
      const elapsed = this.currentMove ? this.currentMove.duration - this.attackTimer : 0;
      if (this.currentMove && this.currentMove.projectile && !this._projectileSpawned &&
          elapsed >= (this.currentMove.projectile.spawnFrame || this.currentMove.active[0])) {
        this._projectileSpawned = true;
        this._projectileRequest = { move: this.currentMove, config: this.currentMove.projectile };
      }
      if (this.currentMove && this.currentMove.travelSpeed && this.onGround) {
        this.vx = this.facing * this.currentMove.travelSpeed;
      }
      this.attackTimer--;
      if (this.attackTimer <= 0 && this.currentMove) {
        this.recoveryTimer = Physics.endlagFrames(this.currentMove.endlag || 0, this.stats.evasion);
        this.currentMove = null;
      }
    } else if (this.recoveryTimer > 0) {
      this.recoveryTimer--;
    }
    if (this.invincible > 0) this.invincible--;
    if (this.hitstun > 0) this.hitstun--;

    if (this.justShieldFlash > 0) this.justShieldFlash--;
    if (this.shieldReleaseTimer > 0) this.shieldReleaseTimer--;

    // 吹っ飛び速度の減衰。スマブラでは吹っ飛びが徐々に弱まっていくため、
    // 低%の被弾でステージ端まで流され続けることがない。
    const controllable = this.hitstun <= 0 && this.landingLag <= 0 && !this.downed &&
      !this.tumbling && this.dazedTimer <= 0 && this.dodgeTimer <= 0;
    if (!controllable) {
      if (this.onGround) {
        this.vx *= CONFIG.GROUND_FRICTION;
      } else {
        // 空中の吹っ飛びは「一定の割合」ではなく「一定量」ずつ減らす。
        // 割合で減らすと飛距離が初速に比例するだけなので、どれだけ強く打っても
        // 遠くへ飛ばず、スマッシュが弱く感じられていた。一定量なら飛距離は
        // 初速の2乗に比例し、強い技ほど飛躍的に遠くへ飛ぶ（本家の手応え）。
        const speed = Math.abs(this.vx);
        this.vx = speed <= CONFIG.KNOCKBACK_DECEL
          ? 0 : this.vx - Math.sign(this.vx) * CONFIG.KNOCKBACK_DECEL;
      }
      if (Math.abs(this.vx) < 0.06) this.vx = 0;
    }

    const wasAirborne = !this.onGround;
    // 足元から地面までの距離（受け身の判断や着地予測に使う）
    this.groundDistance = Physics.distanceToGround(this, platforms);
    this.proceduralClock++;
    this._recordSwingTrail();
    Physics.applyGravity(this, this.fallSpeed);
    this.x += this.vx;
    this.y += this.vy;
    Physics.resolvePlatformCollision(this, platforms);

    if (this.tumbling && this.onGround) {
      this.tumbling = false;
      this.hitstun = 0;
      this.vx = 0;
      this.vy = 0;
      if (this.techWindow > 0) {
        // 受け身成功：ダウンせずその場で立て直し、短い無敵がつく
        this.techWindow = 0;
        this.downed = false;
        this.invincible = Math.max(this.invincible, CONFIG.TECH_INVINCIBLE_FRAMES);
        this.recoveryTimer = 6;
      } else {
        this.downed = true;
      }
    } else if (this.tumbling) {
      this.tumbleRotation += (this.vx < 0 ? -1 : 1) * 0.24;
    }

    if (!this.onGround) this.crouching = false;
    if (this.onGround) {
      // 空中攻撃を出したまま着地すると着地隙が発生する
      if (wasAirborne && this.attackTimer > 0 && this.currentMove && this.currentMove.aerial) {
        this.landingLag = Physics.endlagFrames(this.currentMove.landingLag || CONFIG.LANDING_LAG_DEFAULT, this.stats.evasion);
        this.attackTimer = 0;
        this.currentMove = null;
        this.recoveryTimer = 0;
      }
      this.ledgeLocked = false;
      this.fastFalling = false;
      this._airDodgeUsed = false;
      this._usedUpSpecialAirborne = false;
      this.helpless = false;
      this.jumpAnimTimer = -1;
    } else if (this.jumpAnimTimer >= 0) {
      this.jumpAnimTimer++;
    }

    // このフレームで「移動中」とみなすか（歩行アニメで使用）
    this.isMoving = this.onGround && Math.abs(this.vx) > 0.3 && this.landingLag <= 0 &&
      this.attackTimer <= 0 && this.hitstun <= 0 && !this.shielding && !this.smashCandidate;
    this.motionTimer = this.isMoving ? this.motionTimer + 1 : 0;

    // 状態（待機/歩行/ジャンプ/しゃがみ/被弾…）に応じたモーションのコマ送り
    this._advanceStateAnimation();

    // 歩行スプライトシート（シート形式のキャラのみ。個別コマのwalkが登録されていればそちらが優先される）
    if (this.walkSheet) {
      this.showWalkFrame = this.isMoving && !Fighter.animationReady(this.stateAnimations.walk);
      if (this.showWalkFrame) {
        this.sheetTimer++;
        if (this.sheetTimer >= this.walkFrameDuration) {
          this.sheetTimer = 0;
          this.sheetFrame = (this.sheetFrame + 1) % this.walkFrameCount;
        }
      } else {
        this.sheetFrame = 0;
        this.sheetTimer = 0;
      }
    }

    if (this.x < blastBounds.left || this.x > blastBounds.right ||
        this.y < blastBounds.top || this.y > blastBounds.bottom) {
      this.onKO();
    }
  }

  onKO() {
    this.falls++;
    const creditedAttacker = this.lastAttacker && this.lastAttacker !== this &&
      Date.now() - this.lastHitAt <= CONFIG.KO_CREDIT_WINDOW_MS;
    if (creditedAttacker) this.lastAttacker.kos++;
    else this.selfDestructs++;
    this.lastAttacker = null;
    this.lastHitAt = 0;
    this.stocks--;
    if (this.stocks <= 0) {
      this.dead = true;
      this.eliminatedAt = Date.now();
      return;
    }
    this.x = CONFIG.CANVAS_W / 2 - this.w / 2;
    this.y = 80;
    this.vx = 0;
    this.vy = 0;
    this.damagePercent = 0;
    this.invincible = CONFIG.RESPAWN_INVINCIBLE_FRAMES;
    this.ledgeLocked = false;
    this._airDodgeUsed = false;
    this._usedUpSpecialAirborne = false;
    this.helpless = false;
    this.tumbling = false;
    this.downed = false;
    this.tumbleRotation = 0;
    this.hitlag = 0;
    this.hitlagShakeX = 0;
    this.hitstun = 0;
    this.landingLag = 0;
    this.fastFalling = false;
    this.techWindow = 0;
    this.techLockout = 0;
    this.shielding = false;
    this.shieldHP = CONFIG.SHIELD_MAX;
    this.shieldReleaseTimer = 0;
    this.shieldHeldFrames = 0;
    this.justShieldFlash = 0;
    this.crouching = false;
    this.dazedTimer = 0;
    this.dodgeTimer = 0;
    this.smashCandidate = null;
    this.attackTimer = 0;
    this.currentMove = null;
    this.recoveryTimer = 0;
    this._hitTargets.clear();
  }

  // 状態がわかるよう、足元に色付きの薄いインジケーターを重ねる
  _drawStatusEllipse(ctx, bodyColor) {
    if (!(this.dazedTimer > 0 || this.shielding || this.grabbedBy)) return;
    const cx = this.x + this.w / 2;
    ctx.fillStyle = bodyColor;
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * 0.35;
    ctx.beginPath();
    ctx.ellipse(cx, this.y + this.h, this.w * 0.6, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }

  _drawAnimationImage(ctx, image, box, nextImage, blend) {
    const cx = this.x + this.w / 2;
    const scale = this.h / (box.bottom - box.top);
    const drawOne = src => {
      if (!src || !src.complete || src.naturalWidth === 0) return;
      // 塗り替え後はキャンバスになるため、読み込み判定を済ませてから差し替える
      const img = this._skinned(src);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const contentCenterX = ((box.left + box.right) / 2) * scale;
      ctx.drawImage(img, cx - contentCenterX, this.y - box.top * scale, drawW, drawH);
    };
    ctx.save();
    if (this.facing === -1) {
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.translate(-cx, 0);
    }
    const baseAlpha = ctx.globalAlpha;
    if (nextImage && blend > 0) {
      // 元のコマを薄くしないことで、合成中に全体が点滅するのを防ぐ。
      ctx.globalAlpha = baseAlpha;
      drawOne(image);
      ctx.globalAlpha = baseAlpha * blend;
      drawOne(nextImage);
    } else {
      drawOne(image);
    }
    ctx.restore();
  }

  draw(ctx) {
    if (this.dead) return;
    ctx.save();
    // ヒットストップ中は左右に小刻みに震わせ、止まっていることを視覚的に伝える
    if (this.hitlagShakeX) ctx.translate(this.hitlagShakeX, 0);
    // しゃがみ：待機画像を足元を軸に縦へ潰して表現する（専用画像がなくても成立する）
    if (this.crouching) {
      const feetY = this.y + this.h;
      const cx0 = this.x + this.w / 2;
      ctx.translate(cx0, feetY);
      ctx.scale(1.06, CONFIG.CROUCH_HURTBOX_RATIO);
      ctx.translate(-cx0, -feetY);
    }
    if (this.invincible > 0 && Math.floor(this.invincible / 4) % 2 === 0) {
      ctx.globalAlpha = 0.4;
    }
    if (this.tumbling || this.downed) {
      const cx = this.x + this.w / 2;
      const cy = this.y + this.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(this.downed ? this.facing * Math.PI / 2 : this.tumbleRotation);
      ctx.translate(-cx, -cy);
    }

    let bodyColor = this.color;
    if (this.dazedTimer > 0) bodyColor = '#f6c343';
    else if (this.onLedge) bodyColor = '#7bed9f';
    else if (this.shielding) bodyColor = 'rgba(120,200,255,0.9)';
    else if (this.grabbedBy) bodyColor = 'rgba(200,200,200,0.9)';

    const crossfadeAmount = phase => {
      const t = Math.max(0, Math.min(1, (phase - 0.45) / 0.55));
      return t * t * (3 - 2 * t);
    };

    // 攻撃中は技のモーション、それ以外は状態モーション（待機/歩行/ジャンプ/しゃがみ/被弾…）を描く
    const moveAnimation = this.currentMove && this.attackTimer > 0
      ? this.moveAnimations.get(this.currentMove) : null;
    const useMoveFrame = Fighter.animationReady(moveAnimation);
    const found = useMoveFrame ? null : this._pickStateAnimation();
    const picked = found && found.state ? found : null;
    const useWalkSheet = !useMoveFrame && !picked && this.walkSheet && this.walkSheetLoaded &&
      this.showWalkFrame && this.walkFrameContentBox;

    // ---- 自動モーション ----
    // 専用モーションが用意されていない状態・技だけ、立ち絵を変形させて動かす。
    // 専用モーションを登録したスロットは上の分岐でそちらが使われるため、ここは通らない。
    const attacking = !!(this.currentMove && this.attackTimer > 0);
    const missingMoveMotion = attacking && !useMoveFrame;
    // 代替の状態へ落ちている（wanted と key が違う）＝その状態の専用モーションが無い
    const missingStateMotion = !attacking && !useWalkSheet &&
      !!found && found.key !== found.wanted;
    // しゃがみ・吹っ飛び・ダウンはエンジン側に専用の変形があるため二重に掛けない
    const engineHandled = this.crouching || this.tumbling || this.downed;
    if (!engineHandled && (missingMoveMotion || missingStateMotion) && window.ProceduralMotion) {
      const transform = ProceduralMotion.transformFor(this, {
        attacking: missingMoveMotion,
        stateKey: missingStateMotion ? found.wanted : null,
      });
      if (transform) {
        const pivotX = this.x + this.w / 2;
        const pivotY = this.y + this.h;   // 足元中央を軸にすると地面から浮かない
        const unit = this.h;
        ctx.translate(pivotX + transform.dx * this.facing * unit, pivotY + transform.dy * unit);
        ctx.rotate(this.facing * transform.rot * Math.PI / 180);
        ctx.scale(transform.sx, transform.sy);
        ctx.translate(-pivotX, -pivotY);
      }
    }

    if (useMoveFrame) {
      const moveElapsed = this.currentMove.duration - this.attackTimer;
      const duration = moveAnimation.config.frameDuration || 6;
      const index = Math.min(moveAnimation.images.length - 1, Math.floor(moveElapsed / duration));
      const next = moveAnimation.images[Math.min(index + 1, moveAnimation.images.length - 1)];
      this._drawAnimationImage(ctx, moveAnimation.images[index], moveAnimation.config.contentBox, next,
        crossfadeAmount((moveElapsed % duration) / duration));
    } else if (picked) {
      const state = picked.state;
      const duration = state.config.frameDuration || 6;
      const index = Math.min(state.images.length - 1, this.animFrame);
      // ジャンプは繰り返さないため次コマへの合成もしない
      const next = picked.key === 'jump'
        ? state.images[Math.min(index + 1, state.images.length - 1)]
        : state.images[(index + 1) % state.images.length];
      this._drawAnimationImage(ctx, state.images[index], state.config.contentBox, next,
        state.images.length > 1 ? crossfadeAmount(this.animTimer / duration) : 0);
      this._drawStatusEllipse(ctx, bodyColor);
    } else if (useWalkSheet) {
      const cx = this.x + this.w / 2;
      const box = this.walkFrameContentBox;
      const scale = this.h / (box.bottom - box.top);
      const drawX = cx - ((box.left + box.right) / 2) * scale;
      const drawY = this.y - box.top * scale;
      const col = this.sheetFrame % this.walkSheetCols;
      const row = Math.floor(this.sheetFrame / this.walkSheetCols);
      ctx.save();
      if (this.facing === -1) {
        ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0);
      }
      ctx.drawImage(this._skinned(this.walkSheet), col * this.walkFrameW, row * this.walkFrameH,
        this.walkFrameW, this.walkFrameH, drawX, drawY, this.walkFrameW * scale, this.walkFrameH * scale);
      ctx.restore();
    } else if (this.sprite && this.spriteLoaded) {
      const cx = this.x + this.w / 2;
      const sprite = this._skinned(this.sprite);
      let drawX, drawY, drawW, drawH;
      if (this.spriteContentBox) {
        // 画像解析済み：本体bbox(影・余白を除く)の高さが、ちょうどhurtboxの高さ(this.h)に一致するスケールで描画
        const box = this.spriteContentBox;
        const scale = this.h / (box.bottom - box.top);
        drawW = sprite.width * scale;
        drawH = sprite.height * scale;
        drawX = cx - ((box.left + box.right) / 2) * scale;
        drawY = this.y - box.top * scale;
      } else {
        // フォールバック（bbox未解析のスプライト）：hurtbox高さ基準の簡易表示
        drawH = this.h * 2.2;
        drawW = drawH * (sprite.width / sprite.height);
        drawX = cx - drawW / 2;
        drawY = (this.y + this.h) - drawH;
      }
      ctx.save();
      if (this.facing === -1) {
        ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0);
      }
      // 武器レイヤーがあれば「武器を抜いた体」→「振った武器」の順に重ねる
      if (this.weaponSpec && !this.weaponLayer) this.weaponLayer = this._buildWeaponLayer();
      const layer = this.weaponLayer;
      // パーツ分割があれば、頭・胴・脚をそれぞれ付け根で振って描く
      if (this.partsSpec && !this.partsLayer) this.partsLayer = this._buildPartsLayer();
      const parts = this.partsLayer && window.ProceduralMotion
        ? ProceduralMotion.partAnglesFor(this, {
            attacking: missingMoveMotion,
            stateKey: missingStateMotion ? found.wanted : (attacking ? null : 'idle'),
          })
        : null;
      const scale0 = drawW / sprite.width;
      const drawParts = () => {
        // 奥の脚 → 手前の脚 → 胴 → 頭 の順。上の部品が下の継ぎ目を隠す。
        for (const key of ['legBack', 'legFront', 'torso', 'head']) {
          const part = this.partsLayer[key];
          const angle = parts[key] || 0;
          const px = drawX + part.pivotX * scale0;
          const py = drawY + part.pivotY * scale0;
          ctx.save();
          if (angle) {
            ctx.translate(px, py);
            ctx.rotate(angle * Math.PI / 180);
            ctx.translate(-px, -py);
          }
          ctx.drawImage(part.canvas, drawX + part.x * scale0, drawY + part.y * scale0,
            part.canvas.width * scale0, part.canvas.height * scale0);
          ctx.restore();
        }
      };

      if (layer && window.ProceduralMotion) {
        const scale = drawW / sprite.width;
        if (parts) drawParts(); else ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
        const angle = ProceduralMotion.weaponAngleFor(this, { attacking: missingMoveMotion });
        const px = drawX + layer.pivotX * scale;
        const py = drawY + layer.pivotY * scale;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle * Math.PI / 180);
        ctx.translate(-px, -py);
        ctx.drawImage(layer.weapon,
          drawX + layer.rect.x * scale, drawY + layer.rect.y * scale,
          layer.rect.w * scale, layer.rect.h * scale);
        ctx.restore();
      } else if (parts) {
        drawParts();
      } else {
        ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
      }
      ctx.restore();
      this._drawStatusEllipse(ctx, bodyColor);
    } else {
      ctx.fillStyle = bodyColor;
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }

    // ---- 崖つかまりの表現 ----
    // 掴んでいる手・崖の縁の光・残り時間ゲージを描き、状態がひと目で分かるようにする。
    if (this.onLedge) {
      const gripX = this.onLedge.ledgeX;
      const gripY = this.onLedge.platformY;
      const pulse = 0.55 + 0.45 * Math.sin(this.ledgeHangFrames * 0.22);
      ctx.save();
      // 崖の縁の光
      const glow = ctx.createRadialGradient(gripX, gripY, 2, gripX, gripY, 26);
      glow.addColorStop(0, `rgba(255,236,150,${0.85 * pulse})`);
      glow.addColorStop(1, 'rgba(255,200,60,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(gripX, gripY, 26, 0, Math.PI * 2); ctx.fill();
      // 掴んでいる手
      ctx.fillStyle = '#ffe9a8';
      ctx.strokeStyle = '#6b4b12';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gripX, gripY - 2, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // 体から手へ伸びる腕
      ctx.strokeStyle = 'rgba(255,233,168,.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(this.x + this.w / 2, this.y + this.h * 0.3);
      ctx.lineTo(gripX, gripY - 2);
      ctx.stroke();
      // 残りぶら下がり時間ゲージ（尽きると自動で手を離す）
      const remain = Math.max(0, 1 - this.ledgeHangFrames / CONFIG.LEDGE_MAX_HANG_FRAMES);
      const barW = 40;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(gripX - barW / 2, gripY - 26, barW, 5);
      ctx.fillStyle = remain > 0.3 ? '#8fe36a' : '#ff7a5c';
      ctx.fillRect(gripX - barW / 2, gripY - 26, barW * remain, 5);
      ctx.restore();
    }

    // ジャストガード成立エフェクト（白い閃光リング）
    if (this.justShieldFlash > 0) {
      const t = this.justShieldFlash / CONFIG.JUST_SHIELD_FLASH_FRAMES;
      const r = 30 * (this.attackScale || 1) * (1.9 - t);
      ctx.save();
      ctx.globalAlpha = t;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5 * t + 1;
      ctx.beginPath(); ctx.arc(this.x + this.w / 2, this.y + this.h / 2, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#8fe0ff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x + this.w / 2, this.y + this.h / 2, r * 0.72, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // シールド（体を覆う円。シールドHPに応じて縮小、見た目スケールに応じて拡大）
    if (this.shielding) {
      const r = 34 * (this.shieldHP / CONFIG.SHIELD_MAX) * (this.attackScale || 1);
      ctx.beginPath();
      ctx.arc(this.x + this.w / 2, this.y + this.h / 2, Math.max(6, r), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120,200,255,0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,200,255,0.8)';
      ctx.stroke();
    }

    // スマッシュ溜め中のエフェクト
    if (this.smashCandidate) {
      const flash = Math.floor(this.smashCandidate.elapsed / 3) % 2 === 0;
      ctx.fillStyle = flash ? 'rgba(255,255,255,0.7)' : 'rgba(255,80,80,0.5)';
      ctx.fillRect(this.x - 4, this.y - 4, this.w + 8, this.h + 8);
      if (!this.sprite || !this.spriteLoaded) {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.w, this.h);
      }
    }

    // 斬撃の軌跡（攻撃判定の通り道）
    this._drawSwingTrail(ctx);

    // 攻撃判定の可視化。動作確認用なので通常のプレイでは出さない。
    // 確認したい時はコンソールで window.SHOW_HITBOXES = true とする。
    if (window.SHOW_HITBOXES) {
      const hb = this.getHitbox();
      if (hb) {
        ctx.fillStyle = 'rgba(255,255,0,0.35)';
        ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
        ctx.strokeStyle = 'rgba(255,220,0,0.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
      }
    }
    ctx.restore();

    // 技名・状態表示（ダメージ%はHUDに集約）
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '11px sans-serif';
    if (this.dazedTimer > 0) {
      ctx.fillText('ピヨ', this.x + this.w / 2, this.y - 22);
    } else if (this.onLedge) {
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText('崖つかまり', this.x + this.w / 2, this.y - 22);
    } else if (this.justShieldFlash > CONFIG.JUST_SHIELD_FLASH_FRAMES - 14) {
      ctx.fillStyle = '#eaffff';
      ctx.fillText('ジャスト!', this.x + this.w / 2, this.y - 22);
    } else if (this.landingLag > 0) {
      ctx.fillText('着地隙', this.x + this.w / 2, this.y - 22);
    } else if (this.grabbing) {
      ctx.fillText('掴み中', this.x + this.w / 2, this.y - 22);
    } else if (this.currentMove && this.attackTimer > 0) {
      ctx.fillText(this.currentMove.name, this.x + this.w / 2, this.y - 22);
    }
  }
}

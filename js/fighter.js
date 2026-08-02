// ==== ファイタークラス ====
class Fighter {
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
    this.fighterKey = options.fighterKey || null;
    this.moveSet = (window.FIGHTER_MOVESETS && window.FIGHTER_MOVESETS[this.fighterKey]) || {};
    this.moveAnimations = new Map();
    for (const moveGroup of Object.values(this.moveSet)) {
      for (const move of Object.values(moveGroup || {})) {
        const animation = move && move.animation;
        if (!animation || !animation.frames || !animation.frames.length) continue;
        const state = { images: [], loaded: 0, config: animation };
        state.images = animation.frames.map(src => {
          const image = new Image();
          image.onload = () => { state.loaded++; };
          image.src = src;
          return image;
        });
        this.moveAnimations.set(move, state);
      }
    }

    // 当たり判定サイズ：画像を解析した実寸。未指定時は基準サイズにフォールバック。
    this.w = options.hurtboxWidth || CONFIG.BASE_HURTBOX_W;
    this.h = options.hurtboxHeight || CONFIG.BASE_HURTBOX_H;

    // 技の間合い／シールド半径／掴み距離は、基準サイズに対するこのファイターの大きさの比率でスケールする
    this.attackScale = this.h / CONFIG.BASE_HURTBOX_H;
    this.grabRange = (options.grabRange || CONFIG.GRAB_RANGE_DEFAULT) * this.attackScale;

    // 見た目用スプライト（未指定の場合は色付き矩形のまま）
    this.sprite = null;
    this.spriteLoaded = false;
    this.spriteContentBox = options.spriteContentBox || null;
    if (options.spriteSrc) {
      this.sprite = new Image();
      this.sprite.onload = () => { this.spriteLoaded = true; };
      this.sprite.src = options.spriteSrc;
    }

    // 待機コマ送りアニメーション（複数枚の静止画をループ再生）。無い場合は従来通りの静止画表示。
    this.idleFrames = [];
    this.idleFramesLoadedCount = 0;
    this.idleFrameContentBox = options.idleFrameContentBox || options.spriteContentBox || null;
    this.idleFrameDuration = options.idleFrameDuration || 8;
    this.idleAnimTimer = 0;
    this.idleAnimFrame = 0;
    if (options.idleFrameSrcs && options.idleFrameSrcs.length) {
      this.idleFrames = options.idleFrameSrcs.map(src => {
        const img = new Image();
        img.onload = () => { this.idleFramesLoadedCount++; };
        img.src = src;
        return img;
      });
    }

    // ジャンプ開始のコマ送りと、ジャンプモーション終了後の空中待機画像
    this.jumpAnimFrames = [];
    this.jumpAnimFramesLoadedCount = 0;
    this.jumpFrameContentBox = options.jumpFrameContentBox || null;
    this.jumpFrameDuration = options.jumpFrameDuration || 5;
    if (options.jumpFrameSrcs && options.jumpFrameSrcs.length) {
      this.jumpAnimFrames = options.jumpFrameSrcs.map(src => {
        const img = new Image();
        img.onload = () => { this.jumpAnimFramesLoadedCount++; };
        img.src = src;
        return img;
      });
    }
    this.airIdle = null;
    this.airIdleLoaded = false;
    this.airIdleContentBox = options.airIdleContentBox || this.jumpFrameContentBox;
    if (options.airIdleSrc) {
      this.airIdle = new Image();
      this.airIdle.onload = () => { this.airIdleLoaded = true; };
      this.airIdle.src = options.airIdleSrc;
    }

    // 歩行アニメーション（スプライトシート）。無い場合は静止画のまま表示される。
    this.walkSheet = null;
    this.walkSheetLoaded = false;
    this.walkSheetCols = options.walkSheetCols || 1;
    this.walkSheetRows = options.walkSheetRows || 1;
    this.walkFrameCount = options.walkFrameCount || 1;
    this.walkFrameContentBox = options.walkFrameContentBox || null;
    this.walkFrameDuration = options.walkFrameDuration || 4; // 1コマ何フレーム表示するか
    this.animFrame = 0;
    this.animTimer = 0;
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
    this.dazedTimer = 0;     // シールド破壊後のピヨリ
    this.dodgeTimer = 0;     // その場回避/横回避/空中緊急回避 中
    this.dodgeType = null;
    this.invincible = 0;
    this.dead = false;

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
    if (wasOnGround && this.groundedPlatform > 0 && this.downEdge) {
      this.dropThroughTimer = 14;
      this.onGround = false;
      this.groundedPlatform = null;
      this.y += 8;
      return;
    }

    // シールドボタンのエッジ検出（空中緊急回避の一回性トリガーに使用）
    const shieldWasHeld = this.prevShieldHeld;
    this.prevShieldHeld = input.shield;
    const shieldEdge = input.shield && !shieldWasHeld;

    // ---- シールド／回避（シールド + 方向） ----
    if (input.shield && wasOnGround && this.attackTimer <= 0) {
      if (this.downEdge) { this.startDodge('spot'); return; }
      if (this.leftEdge || this.rightEdge) { this.startDodge('roll', this.leftEdge ? -1 : 1); return; }

      this.shielding = true;
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
      this.shielding = false;
      if (this.shieldHP < CONFIG.SHIELD_MAX) {
        this.shieldHP = Math.min(CONFIG.SHIELD_MAX, this.shieldHP + CONFIG.SHIELD_REGEN_PER_FRAME);
      }
    }

    // ---- 移動（スティックの倒し込み量で 歩き/ダッシュ を判定） ----
    // ・DASH_TILT_THRESHOLD以上：ダッシュ速度（保持し続ければ走り、すぐ離せば結果的に短い「ステップ」になる）
    // ・それ未満〜デッドゾーン以上：倒し込み量に比例した歩行速度
    if (this.attackTimer <= 0) {
      const stickX = input.stickX || 0;
      const absX = Math.abs(stickX);
      if (absX < CONFIG.WALK_DEADZONE) {
        this.vx = 0;
        this.isDashing = false;
      } else if (absX >= CONFIG.DASH_TILT_THRESHOLD) {
        const speed = Physics.computeMoveSpeed(this.stats.evasion, true);
        this.vx = Math.sign(stickX) * speed;
        this.facing = Math.sign(stickX);
        this.isDashing = true;
      } else {
        const walkSpeed = Physics.computeMoveSpeed(this.stats.evasion, false) * absX;
        this.vx = Math.sign(stickX) * walkSpeed;
        this.facing = Math.sign(stickX);
        this.isDashing = false;
      }
    }

    // ---- ジャンプ（タップジャンプ設定＋小ジャンプ/大ジャンプ判定） ----
    const tapJumpEnabled = window.GameSettings ? window.GameSettings.tapJumpEnabled : true;
    const jumpHeldCombined = input.jump || (tapJumpEnabled && input.up);
    const jumpPressed = jumpHeldCombined && !this.prevJumpHeld;
    if (jumpPressed && this.jumpsUsed < CONFIG.MAX_JUMPS) {
      this.vy = CONFIG.JUMP_POWER;
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
        this.startAttack(MOVES.ground.neutral);
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
    this.x = ledge.edge === 'left' ? ledge.x - this.w + 6 : ledge.x - 6;
    this.y = surfaceY - this.h + 10;
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
      this.vy = CONFIG.JUMP_POWER;
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

    const dmg = Physics.computeDamage(move.dmgBase, this.stats[move.statKey]);
    target.damagePercent += dmg;
    const kb = Physics.computeKnockback(move.kbBase, target.damagePercent, this.stats[move.statKey], target.stats.defense);
    const angleRad = (move.angle * Math.PI) / 180;
    target.vx = dir * kb * Math.cos(angleRad);
    target.vy = -kb * Math.sin(angleRad);
    target.hitstun = Math.min(50, Math.max(6, Math.round(kb * 3)));
    target.onGround = false;
    target.grabbedBy = null;

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

  startAttack(move) {
    this.currentMove = move;
    this.attackTimer = move.duration;
    this.hasHitThisAttack = false;
    this._projectileSpawned = false;
  }

  consumeProjectileRequest() {
    const request = this._projectileRequest;
    this._projectileRequest = null;
    return request;
  }

  getHitbox() {
    if (this.attackTimer <= 0 || !this.currentMove) return null;
    const m = this.currentMove;
    const framesElapsed = m.duration - this.attackTimer;
    if (framesElapsed < m.active[0] || framesElapsed > m.active[1]) return null;
    const scale = this.attackScale || 1;
    if (m.projectile) return null;
    const range = m.range * scale;
    const boxH = m.h * scale;
    const yOff = (m.yOff || 0) * scale;
    const x = this.facing === 1 ? this.x + this.w : this.x - range;
    // 上半身寄りに判定を出す（中心からやや上）
    const y = this.y + (this.h - boxH) * 0.32 + yOff;
    return { x, y, w: range, h: boxH };
  }

  getHurtbox() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  takeHit(attacker, move) {
    if (this.invincible > 0 || this.dead) return;

    let dmg = Physics.computeDamage(move.dmgBase, attacker.stats[move.statKey]);
    const criticalChance = Math.min(0.18, 0.01 + Math.max(0, attacker.stats.accuracy || 0) * 0.0015);
    const critical = Math.random() < criticalChance;
    if (critical) dmg *= 1.2;
    let kbBase = move.kbBase;

    if (this.shielding) {
      // シールドブロック：ダメージ/吹っ飛びを大幅軽減する代わりにシールドが削れる
      dmg *= 0.1;
      kbBase *= 0.1;
      this.shieldHP -= 15;
      if (this.shieldHP <= 0) this.breakShield();
    }

    this.damagePercent += dmg;
    const kb = Physics.computeKnockback(kbBase, this.damagePercent, attacker.stats[move.statKey], this.stats.defense);
    const angleRad = (move.angle * Math.PI) / 180;
    const dir = move.backHit ? -attacker.facing : attacker.facing;

    this.vx = dir * kb * Math.cos(angleRad);
    this.vy = -kb * Math.sin(angleRad);
    if (!this.shielding) this.onGround = false;

    this.hitstun = this.shielding ? 4 : Math.min(50, Math.max(6, Math.round(kb * 3)));
    this.attackTimer = 0;
    this.currentMove = null;
    this.recoveryTimer = 0;
  }

  update(platforms, blastBounds) {
    if (this.dead) return;

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

    if (this.attackTimer > 0) {
      const elapsed = this.currentMove ? this.currentMove.duration - this.attackTimer : 0;
      if (this.currentMove && this.currentMove.projectile && !this._projectileSpawned &&
          elapsed >= (this.currentMove.projectile.spawnFrame || this.currentMove.active[0])) {
        this._projectileSpawned = true;
        this._projectileRequest = { move: this.currentMove, config: this.currentMove.projectile };
      }
      this.attackTimer--;
      if (this.attackTimer <= 0 && this.currentMove) {
        this.recoveryTimer = this.currentMove.endlag || 0;
        this.currentMove = null;
      }
    } else if (this.recoveryTimer > 0) {
      this.recoveryTimer--;
    }
    if (this.invincible > 0) this.invincible--;
    if (this.hitstun > 0) this.hitstun--;

    Physics.applyGravity(this, this.stats.evasion);
    this.x += this.vx;
    this.y += this.vy;
    Physics.resolvePlatformCollision(this, platforms);

    if (this.onGround) {
      this.ledgeLocked = false;
      this._airDodgeUsed = false;
      this._usedUpSpecialAirborne = false;
      this.helpless = false;
      this.jumpAnimTimer = -1;
    } else if (this.jumpAnimTimer >= 0) {
      this.jumpAnimTimer++;
    }

    // このフレームで「移動中」とみなすか（歩行アニメで使用）
    this.isMoving = this.onGround && Math.abs(this.vx) > 0.3 &&
      this.attackTimer <= 0 && this.hitstun <= 0 && !this.shielding && !this.smashCandidate;
    this.motionTimer = this.isMoving ? this.motionTimer + 1 : 0;

    // 待機コマ送りアニメーション：移動の有無に関わらず常にループ再生する
    if (this.idleFrames.length) {
      this.idleAnimTimer++;
      if (this.idleAnimTimer >= this.idleFrameDuration) {
        this.idleAnimTimer = 0;
        this.idleAnimFrame = (this.idleAnimFrame + 1) % this.idleFrames.length;
      }
    }

    // 歩行アニメーション（スプライトシートを持つキャラのみ。移動中だけコマを進める）
    if (this.walkSheet) {
      this.showWalkFrame = this.isMoving;
      if (this.isMoving) {
        this.animTimer++;
        if (this.animTimer >= this.walkFrameDuration) {
          this.animTimer = 0;
          this.animFrame = (this.animFrame + 1) % this.walkFrameCount;
        }
      } else {
        this.animFrame = 0;
        this.animTimer = 0;
      }
    }

    if (this.x < blastBounds.left || this.x > blastBounds.right ||
        this.y < blastBounds.top || this.y > blastBounds.bottom) {
      this.onKO();
    }
  }

  onKO() {
    this.stocks--;
    if (this.stocks <= 0) {
      this.dead = true;
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
  }

  draw(ctx) {
    if (this.dead) return;
    ctx.save();
    if (this.invincible > 0 && Math.floor(this.invincible / 4) % 2 === 0) {
      ctx.globalAlpha = 0.4;
    }

    let bodyColor = this.color;
    if (this.dazedTimer > 0) bodyColor = '#f6c343';
    else if (this.onLedge) bodyColor = '#7bed9f';
    else if (this.shielding) bodyColor = 'rgba(120,200,255,0.9)';
    else if (this.grabbedBy) bodyColor = 'rgba(200,200,200,0.9)';

    const useWalkFrame = this.walkSheet && this.walkSheetLoaded && this.showWalkFrame && this.walkFrameContentBox;
    const moveAnimation = this.currentMove && this.attackTimer > 0
      ? this.moveAnimations.get(this.currentMove)
      : null;
    const useMoveFrame = !!(moveAnimation && moveAnimation.config.contentBox &&
      moveAnimation.loaded >= moveAnimation.images.length);
    const moveElapsed = this.currentMove ? this.currentMove.duration - this.attackTimer : 0;
    const moveFrameIndex = useMoveFrame
      ? Math.min(moveAnimation.images.length - 1, Math.floor(moveElapsed / (moveAnimation.config.frameDuration || 6)))
      : -1;
    const airborne = !this.onGround && !this.onLedge;
    const jumpAnimLength = this.jumpAnimFrames.length * this.jumpFrameDuration;
    const useJumpSequence = airborne && this.jumpAnimTimer >= 0 && this.jumpAnimTimer < jumpAnimLength &&
      this.jumpAnimFramesLoadedCount >= this.jumpAnimFrames.length && this.jumpFrameContentBox;
    const jumpFrameIndex = useJumpSequence
      ? Math.min(this.jumpAnimFrames.length - 1, Math.floor(this.jumpAnimTimer / this.jumpFrameDuration))
      : -1;
    const airFrameImg = useJumpSequence ? this.jumpAnimFrames[jumpFrameIndex] : (airborne && this.airIdleLoaded ? this.airIdle : null);
    const airFrameBox = useJumpSequence ? this.jumpFrameContentBox : this.airIdleContentBox;
    const useAirFrame = !!(airFrameImg && airFrameBox);
    const idleFrameImg = this.idleFrames.length ? this.idleFrames[this.idleAnimFrame] : null;
    const useIdleFrame = !useMoveFrame && !useAirFrame && !useWalkFrame && idleFrameImg && idleFrameImg.complete &&
      this.idleFramesLoadedCount >= this.idleFrames.length && this.idleFrameContentBox;

    if (useMoveFrame) {
      const frame = moveAnimation.images[moveFrameIndex];
      const box = moveAnimation.config.contentBox;
      const cx = this.x + this.w / 2;
      const contentH = box.bottom - box.top;
      const scale = this.h / contentH;
      const drawW = frame.width * scale;
      const drawH = frame.height * scale;
      const contentCenterX = ((box.left + box.right) / 2) * scale;
      const drawX = cx - contentCenterX;
      const drawY = this.y - box.top * scale;
      ctx.save();
      if (this.facing === -1) {
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        ctx.translate(-cx, 0);
      }
      ctx.drawImage(frame, drawX, drawY, drawW, drawH);
      ctx.restore();
    } else if (useAirFrame) {
      const cx = this.x + this.w / 2;
      const contentH = airFrameBox.bottom - airFrameBox.top;
      const scale = this.h / contentH;
      const drawW = airFrameImg.width * scale;
      const drawH = airFrameImg.height * scale;
      const contentCenterX = ((airFrameBox.left + airFrameBox.right) / 2) * scale;
      const drawX = cx - contentCenterX;
      const drawY = this.y - airFrameBox.top * scale;
      ctx.save();
      if (this.facing === -1) {
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        ctx.translate(-cx, 0);
      }
      ctx.drawImage(airFrameImg, drawX, drawY, drawW, drawH);
      ctx.restore();
    } else if (useIdleFrame) {
      // 待機コマ送りアニメーション（移動中も含め常にこのループを表示する）
      const cx = this.x + this.w / 2;
      const box = this.idleFrameContentBox;
      const contentH = box.bottom - box.top;
      const scale = this.h / contentH;
      const drawW = idleFrameImg.width * scale;
      const drawH = idleFrameImg.height * scale;
      const contentCenterX = ((box.left + box.right) / 2) * scale;
      const contentTopScaled = box.top * scale;
      const drawX = cx - contentCenterX;
      const drawY = this.y - contentTopScaled;

      ctx.save();
      if (this.facing === -1) {
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        ctx.translate(-cx, 0);
      }
      ctx.drawImage(idleFrameImg, drawX, drawY, drawW, drawH);
      ctx.restore();

      if (this.dazedTimer > 0 || this.shielding || this.grabbedBy) {
        const bottomY = this.y + this.h;
        ctx.fillStyle = bodyColor;
        ctx.globalAlpha *= 0.35;
        ctx.beginPath();
        ctx.ellipse(cx, bottomY, this.w * 0.6, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha /= 0.35;
      }
    } else if (useWalkFrame) {
      const cx = this.x + this.w / 2;
      const box = this.walkFrameContentBox;
      const contentH = box.bottom - box.top;
      const scale = this.h / contentH;
      const drawW = this.walkFrameW * scale;
      const drawH = this.walkFrameH * scale;
      const contentCenterX = ((box.left + box.right) / 2) * scale;
      const contentTopScaled = box.top * scale;
      const drawX = cx - contentCenterX;
      const drawY = this.y - contentTopScaled;

      const col = this.animFrame % this.walkSheetCols;
      const row = Math.floor(this.animFrame / this.walkSheetCols);
      const sx = col * this.walkFrameW;
      const sy = row * this.walkFrameH;

      ctx.save();
      if (this.facing === -1) {
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        ctx.translate(-cx, 0);
      }
      ctx.drawImage(this.walkSheet, sx, sy, this.walkFrameW, this.walkFrameH, drawX, drawY, drawW, drawH);
      ctx.restore();
    } else if (this.sprite && this.spriteLoaded) {
      const cx = this.x + this.w / 2;
      let drawX, drawY, drawW, drawH;

      if (this.spriteContentBox) {
        // 画像解析済み：本体bbox(影・余白を除く)の高さが、ちょうどhurtboxの高さ(this.h)に一致するスケールで描画
        const box = this.spriteContentBox;
        const contentH = box.bottom - box.top;
        const scale = this.h / contentH;
        drawW = this.sprite.width * scale;
        drawH = this.sprite.height * scale;
        const contentCenterX = ((box.left + box.right) / 2) * scale;
        const contentTopScaled = box.top * scale;
        drawX = cx - contentCenterX;
        drawY = this.y - contentTopScaled;
      } else {
        // フォールバック（bbox未解析のスプライト）：hurtbox高さ基準の簡易表示
        drawH = this.h * 2.2;
        drawW = drawH * (this.sprite.width / this.sprite.height);
        drawX = cx - drawW / 2;
        drawY = (this.y + this.h) - drawH;
      }

      ctx.save();
      if (this.facing === -1) {
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        ctx.translate(-cx, 0);
      }
      ctx.drawImage(this.sprite, drawX, drawY, drawW, drawH);
      ctx.restore();

      // 状態がわかるよう、足元に色付きの薄いインジケーターを重ねる
      if (this.dazedTimer > 0 || this.shielding || this.grabbedBy) {
        const bottomY = this.y + this.h;
        ctx.fillStyle = bodyColor;
        ctx.globalAlpha *= 0.35;
        ctx.beginPath();
        ctx.ellipse(cx, bottomY, this.w * 0.6, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha /= 0.35;
      }
    } else {
      ctx.fillStyle = bodyColor;
      ctx.fillRect(this.x, this.y, this.w, this.h);
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

    // 攻撃ヒットボックス（デバッグ表示）
    const hb = this.getHitbox();
    if (hb) {
      ctx.fillStyle = 'rgba(255,255,0,0.6)';
      ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
    }
    ctx.restore();

    // 技名・状態表示（ダメージ%はHUDに集約）
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '11px sans-serif';
    if (this.dazedTimer > 0) {
      ctx.fillText('ピヨ', this.x + this.w / 2, this.y - 22);
    } else if (this.grabbing) {
      ctx.fillText('掴み中', this.x + this.w / 2, this.y - 22);
    } else if (this.currentMove && this.attackTimer > 0) {
      ctx.fillText(this.currentMove.name, this.x + this.w / 2, this.y - 22);
    }
  }
}

// ==== 物理演算・スマブラ式吹っ飛びロジック ====

const Physics = {
  // 矩形の重なり判定 (Hitbox/Hurtbox共通)
  rectsOverlap(a, b) {
    return a.x < b.x + b.w &&
           a.x + a.w > b.x &&
           a.y < b.y + b.h &&
           a.y + a.h > b.y;
  },

  // ステータス上昇 -> 効果量への変換カーブ。
  // max へ漸近するが到達しないため、どれだけ育てても頭打ちにならず、
  // かつ伸びるほど効果が緩やかになるので極端な壊れ性能にもならない。
  softBonus(growth, max, half) {
    const g = growth > 0 ? growth : 0;
    return (max * g) / (g + half);
  },

  // 吹っ飛び速度計算（技ごとのkbBaseを使用）
  // 吹っ飛び速度 = (技の基本値 + 蓄積ダメージ% * 攻撃側ステータス係数) * (1 - 防御側の重さ軽減)
  computeKnockback(kbBase, damagePercent, attackerStat, defenderDefense) {
    const attackMultiplier = 1 + this.softBonus((attackerStat || 10) - 10, CONFIG.KB_POWER_MAX, CONFIG.KB_POWER_HALF);
    const raw = kbBase * CONFIG.KB_BASE_MULTIPLIER + damagePercent * CONFIG.KB_DAMAGE_SCALE * attackMultiplier;
    const reduction = this.softBonus((defenderDefense || 10) - 10, CONFIG.DEFENSE_KB_MAX, CONFIG.DEFENSE_KB_HALF);
    return raw * (1 - reduction);
  },

  // ステータスからダメージ量を算出（ちから or かしこさを反映し、相手のライフで軽減）
  computeDamage(baseDamage, attackerStat, defenderLife) {
    const attackMultiplier = 1 + this.softBonus((attackerStat || 10) - 10, CONFIG.DAMAGE_STAT_MAX, CONFIG.DAMAGE_STAT_HALF);
    const reduction = this.softBonus((defenderLife || 100) - 100, CONFIG.LIFE_DAMAGE_MAX, CONFIG.LIFE_DAMAGE_HALF);
    return baseDamage * attackMultiplier * (1 - reduction);
  },

  // クリティカル率（命中ステータス）
  criticalChance(accuracy) {
    return CONFIG.CRITICAL_CHANCE_BASE +
      this.softBonus((accuracy || 10) - 10, CONFIG.ACCURACY_CRIT_MAX, CONFIG.ACCURACY_CRIT_HALF);
  },

  // ヒットストップ（ヒットの瞬間に両者が止まるフレーム数）
  hitlagFrames(damage, onShield) {
    const raw = Math.min(CONFIG.HITLAG_MAX, CONFIG.HITLAG_BASE + damage * CONFIG.HITLAG_PER_DAMAGE);
    return Math.max(1, Math.round(raw * (onShield ? CONFIG.HITLAG_SHIELD_MULTIPLIER : 1)));
  },

  // 移動速度（回避ステータス反映）: ダッシュ中か通常歩行かで基準値を切替
  computeMoveSpeed(evasion, dashing) {
    const base = dashing ? CONFIG.DASH_SPEED_BASE : CONFIG.WALK_SPEED_BASE;
    return base * (1 + this.softBonus((evasion || 10) - 10, CONFIG.EVASION_SPEED_MAX, CONFIG.EVASION_SPEED_HALF));
  },

  // 技の後隙・着地隙（回避が高いほど短くなる）。
  // 0フレームになると振り得の技が生まれて差し合いが壊れるため下限を設ける。
  endlagFrames(frames, evasion) {
    const base = Math.max(0, Math.round(frames) || 0);
    if (base <= 0) return 0;
    const cut = this.softBonus((evasion || 10) - 10, CONFIG.EVASION_ENDLAG_MAX, CONFIG.EVASION_ENDLAG_HALF);
    const reduced = Math.round(base * (1 - cut));
    return Math.max(Math.min(base, CONFIG.MIN_ENDLAG_FRAMES), reduced);
  },

  // 落下速度倍率。ステータスではなくモンスターごとの固定値。
  // 育成で落下速度が変わると復帰の難易度や操作感まで変わってしまうため、
  // ここは種族の個性として固定し、育成では動かさない。
  fallMultiplier(fallSpeed) {
    const value = Number(fallSpeed);
    return Number.isFinite(value) && value > 0 ? value : CONFIG.DEFAULT_FALL_SPEED;
  },

  // ジャンプ力倍率。落下速度と同じく、育成ではなくモンスターごとの固定値。
  // ここを育成で動かすと足場の届く/届かないが途中で変わり、
  // 覚えた間合いが通用しなくなるため、種族の個性として固定している。
  jumpMultiplier(jumpPower) {
    const value = Number(jumpPower);
    return Number.isFinite(value) && value > 0 ? value : CONFIG.DEFAULT_JUMP_POWER;
  },

  // このモンスターのジャンプ初速（負の値＝上向き）
  jumpVelocity(jumpPower) {
    return CONFIG.JUMP_POWER * this.jumpMultiplier(jumpPower);
  },

  // 通常の終端速度と急降下時の終端速度
  terminalFallSpeed(fallSpeed, fastFalling) {
    return CONFIG.MAX_FALL_SPEED * this.fallMultiplier(fallSpeed) * (fastFalling ? CONFIG.FAST_FALL_MULTIPLIER : 1);
  },

  applyGravity(entity, fallSpeed) {
    entity.vy += CONFIG.GRAVITY * this.fallMultiplier(fallSpeed);
    const maxFall = this.terminalFallSpeed(fallSpeed, entity.fastFalling);
    if (entity.vy > maxFall) entity.vy = maxFall;
  },

  // 足元から真下の足場までの距離（受け身の判断などに使う。足場が無ければInfinity）
  distanceToGround(entity, platforms) {
    const feetY = entity.y + entity.h;
    let best = Infinity;
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (i > 0 && entity.dropThroughTimer > 0) continue;
      if (entity.x + entity.w <= p.x || entity.x >= p.x + p.w) continue;
      const surfaceY = p.surfaceY != null ? p.surfaceY : p.y;
      const gap = surfaceY - feetY;
      if (gap >= 0 && gap < best) best = gap;
    }
    return best;
  },

  // 足場（プラットフォーム配列）との着地判定
  // surfaceY: 足場画像の上端からPLATFORM_SURFACE_RATIO分下にある実際の設置面（Stage側で算出）
  resolvePlatformCollision(entity, platforms) {
    entity.onGround = false;
    entity.groundedPlatform = null;
    for (let index = 0; index < platforms.length; index++) {
      const p = platforms[index];
      if (index > 0 && entity.dropThroughTimer > 0) continue;
      const surfaceY = p.surfaceY != null ? p.surfaceY : p.y;
      const feetY = entity.y + entity.h;
      const prevFeetY = feetY - entity.vy;
      const withinX = entity.x + entity.w > p.x && entity.x < p.x + p.w;
      if (withinX && entity.vy >= 0 && prevFeetY <= surfaceY + 1 && feetY >= surfaceY) {
        entity.y = surfaceY - entity.h;
        entity.vy = 0;
        entity.onGround = true;
        entity.groundedPlatform = index;
        entity.jumpsUsed = 0;
      }
    }
  },
};

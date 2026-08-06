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

  // 落下速度倍率（回避が高いほど速く落ちる）
  fallMultiplier(evasion) {
    return 1 + this.softBonus((evasion || 10) - 10, CONFIG.EVASION_FALL_MAX, CONFIG.EVASION_FALL_HALF);
  },

  // 通常の終端速度と急降下時の終端速度
  terminalFallSpeed(evasion, fastFalling) {
    return CONFIG.MAX_FALL_SPEED * this.fallMultiplier(evasion) * (fastFalling ? CONFIG.FAST_FALL_MULTIPLIER : 1);
  },

  // 重力適用（回避ステータスが高いほど落下も速い＝ハイリスクハイリターン）
  applyGravity(entity, evasion) {
    entity.vy += CONFIG.GRAVITY * this.fallMultiplier(evasion);
    const maxFall = this.terminalFallSpeed(evasion, entity.fastFalling);
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

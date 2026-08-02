// ==== 物理演算・スマブラ式吹っ飛びロジック ====

const Physics = {
  // 矩形の重なり判定 (Hitbox/Hurtbox共通)
  rectsOverlap(a, b) {
    return a.x < b.x + b.w &&
           a.x + a.w > b.x &&
           a.y < b.y + b.h &&
           a.y + a.h > b.y;
  },

  // 吹っ飛び速度計算（技ごとのkbBaseを使用）
  // 吹っ飛び速度 = (技の基本値 + 蓄積ダメージ% * 攻撃側ステータス係数) / (1 + 防御側丈夫さ係数)
  computeKnockback(kbBase, damagePercent, attackerStat, defenderDefense) {
    const raw = kbBase +
      (damagePercent * CONFIG.KB_DAMAGE_SCALE) * (attackerStat * CONFIG.KB_POWER_SCALE);
    const mitigated = raw / (1 + defenderDefense * CONFIG.DEFENSE_SCALE);
    return mitigated;
  },

  // ステータスからダメージ量を算出（ちから or かしこさを反映）
  computeDamage(baseDamage, attackerStat) {
    return baseDamage * (1 + attackerStat * 0.05);
  },

  // 移動速度（回避ステータス反映）: ダッシュ中か通常歩行かで基準値を切替
  computeMoveSpeed(evasion, dashing) {
    const base = dashing ? CONFIG.DASH_SPEED_BASE : CONFIG.WALK_SPEED_BASE;
    return base * (1 + evasion * CONFIG.EVASION_SPEED_SCALE);
  },

  // 重力適用（回避ステータスが高いほど落下も速い＝ハイリスクハイリターン）
  applyGravity(entity, evasion) {
    const fallMul = 1 + (evasion || 0) * CONFIG.EVASION_FALL_SCALE;
    entity.vy += CONFIG.GRAVITY * fallMul;
    const maxFall = CONFIG.MAX_FALL_SPEED * fallMul;
    if (entity.vy > maxFall) entity.vy = maxFall;
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

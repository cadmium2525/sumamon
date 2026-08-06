// ==== 自動モーション（立ち絵1枚から動きを作る） ====
// 専用モーションが用意されていない状態・技では、立ち絵をそのまま
// 上下動・傾き・伸び縮み・踏み込みで動かして「棒立ち」を避ける。
//
// ・変形は「当たり判定の高さ = 1」を単位とした相対値なので、体格が違っても同じ動きになる。
//     dx: 前方向が+（向きに応じて自動で反転） / dy: 上が-  / rot: 度 / sx,sy: 拡大率
// ・軸は常に足元中央。地面から浮いたり めり込んだりしない。
// ・専用モーションを登録したスロットは自動的にそちらが優先され、ここは使われなくなる。
const ProceduralMotion = {
  NONE: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 },

  // 0〜1を往復する滑らかな波。lengthフレームで1周する。
  _wave(clock, length) {
    return Math.sin((clock % length) / length * Math.PI * 2);
  },

  // 状態ごとの動き。引数fighterから必要な値だけを読む。
  STATES: {
    idle(f, m) {
      const w = m._wave(f.proceduralClock, 96);      // ゆっくりした呼吸
      return { dx: 0, dy: -0.012 * w, rot: 0, sx: 1 - 0.012 * w, sy: 1 + 0.018 * w };
    },
    walk(f, m) {
      const w = m._wave(f.proceduralClock, 28);
      return { dx: 0.018 * w, dy: -0.030 * Math.abs(w), rot: 3.2 * w, sx: 1, sy: 1 };
    },
    dash(f, m) {
      const w = m._wave(f.proceduralClock, 18);
      // 前傾させて疾走感を出す
      return { dx: 0.02, dy: -0.036 * Math.abs(w), rot: 9 + 2.5 * w, sx: 1.04, sy: 0.98 };
    },
    airIdle(f, m) {
      const w = m._wave(f.proceduralClock, 72);
      return { dx: 0, dy: -0.018 * w, rot: 4 * w, sx: 1, sy: 1 };
    },
    jump(f) {
      // 上昇中は縦に伸び、落下中は横に潰れる（スマブラ的なスカッシュ＆ストレッチ）
      const v = Math.max(-1, Math.min(1, f.vy / 9));
      return { dx: 0, dy: 0, rot: 0, sx: 1 - 0.09 * -v, sy: 1 + 0.12 * -v };
    },
    shield() {
      return { dx: -0.01, dy: 0, rot: -2, sx: 1.05, sy: 0.95 };
    },
    hurt(f) {
      // のけぞり。硬直が解けるにつれ元へ戻る
      const p = Math.max(0, Math.min(1, f.hitstun / 18));
      return { dx: -0.10 * p, dy: -0.02 * p, rot: -15 * p, sx: 1, sy: 1 - 0.05 * p };
    },
    ledge(f, m) {
      const w = m._wave(f.proceduralClock, 80);
      // 崖にぶら下がって揺れている表現
      return { dx: -0.03, dy: 0.02, rot: 3 * w, sx: 1, sy: 1 };
    },
  },

  // 技ごとの「構え → 打つ → 戻る」の形。
  // amount: 打撃の強さ / lift: 上へ伸ばす量 / drop: 沈み込む量 / spin: 回転主体か
  ATTACKS: {
    'ground.neutral':   { amount: 0.06, rot: 6 },
    'ground.side':      { amount: 0.11, rot: 10 },
    'ground.up':        { amount: 0.04, rot: -6, lift: 0.14 },
    'ground.down':      { amount: 0.08, rot: 4,  drop: 0.16 },
    'ground.dashAttack':{ amount: 0.16, rot: 14 },
    'smash.side':       { amount: 0.18, rot: 15, anticipation: 1.6 },
    'smash.up':         { amount: 0.06, rot: -8, lift: 0.22, anticipation: 1.6 },
    'smash.down':       { amount: 0.10, rot: 5,  drop: 0.22, anticipation: 1.6 },
    'air.neutral':      { amount: 0.05, spin: 26 },
    'air.forward':      { amount: 0.13, rot: 18 },
    'air.back':         { amount: -0.13, rot: -18 },
    'air.up':           { amount: 0.03, rot: -10, lift: 0.16 },
    'air.down':         { amount: 0.03, rot: 6,  drop: 0.10, stretch: 0.12 },
    'special.neutral':  { amount: 0.07, rot: 5,  anticipation: 1.8 },
    'special.side':     { amount: 0.15, rot: 12, anticipation: 1.4 },
    'special.up':       { amount: 0.04, rot: -4, lift: 0.20 },
    'special.down':     { amount: 0.06, rot: 4,  drop: 0.18, anticipation: 1.4 },
  },
  DEFAULT_ATTACK: { amount: 0.10, rot: 9 },

  // 技の進行度から変形を作る。
  // 発生前は後ろへ引き（構え）、判定中は前へ踏み込み、後隙でゆっくり戻る。
  _attackTransform(spec, phase, activeStart, activeEnd) {
    const anticipation = spec.anticipation || 1;
    let strike;                       // -1(構え) 〜 1(打ち切り)
    if (phase < activeStart) {
      const t = activeStart > 0 ? phase / activeStart : 1;
      strike = -Math.sin(t * Math.PI / 2) * 0.55 * anticipation;
    } else if (phase <= activeEnd) {
      const span = Math.max(0.0001, activeEnd - activeStart);
      const t = (phase - activeStart) / span;
      strike = -0.55 * anticipation + (1 + 0.55 * anticipation) * Math.sin(t * Math.PI / 2);
    } else {
      const span = Math.max(0.0001, 1 - activeEnd);
      const t = (phase - activeEnd) / span;
      strike = 1 - t;                 // 後隙で構えへ戻る
    }

    const lift = (spec.lift || 0) * Math.max(0, strike);
    const drop = (spec.drop || 0) * Math.max(0, strike);
    return {
      dx: (spec.amount || 0) * strike,
      dy: -lift * 0.35 + drop * 0.12,
      rot: (spec.rot || 0) * strike + (spec.spin || 0) * strike,
      sx: 1 - lift * 0.30 + drop * 0.22 - (spec.stretch || 0) * Math.max(0, strike) * 0.5,
      sy: 1 + lift * 0.55 - drop * 0.30 + (spec.stretch || 0) * Math.max(0, strike),
    };
  },

  // このフレームで適用すべき変形を返す。不要ならnull。
  // fighter側で「専用モーションが無い」と判断された時だけ呼ばれる。
  transformFor(fighter, { attacking, stateKey } = {}) {
    if (!fighter.proceduralEnabled) return null;
    let raw = null;

    if (attacking && fighter.currentMove) {
      const move = fighter.currentMove;
      const spec = this.ATTACKS[fighter.currentMoveSlot] || this.DEFAULT_ATTACK;
      const duration = Math.max(1, move.duration || 1);
      const elapsed = duration - fighter.attackTimer;
      const phase = Math.max(0, Math.min(1, elapsed / duration));
      const active = Array.isArray(move.active) ? move.active : [duration * 0.3, duration * 0.6];
      raw = this._attackTransform(spec,
        phase,
        Math.max(0, Math.min(0.95, active[0] / duration)),
        Math.max(0.05, Math.min(1, active[1] / duration)));
    } else if (stateKey && this.STATES[stateKey]) {
      raw = this.STATES[stateKey](fighter, this);
    }
    if (!raw) return null;

    // モンスターごとに動きの強さを変えられるようにする（0で自動モーション無効）
    const gain = fighter.proceduralIntensity;
    if (gain === 1) return raw;
    return {
      dx: raw.dx * gain,
      dy: raw.dy * gain,
      rot: raw.rot * gain,
      sx: 1 + (raw.sx - 1) * gain,
      sy: 1 + (raw.sy - 1) * gain,
    };
  },
};

window.ProceduralMotion = ProceduralMotion;

// ==== 武器の振り ====
// 立ち絵から武器の部分だけを切り出して、握りを軸に回すための角度を決める。
// 体の踏み込み（上のATTACKS）と組み合わせると「振っている」ように見える。
ProceduralMotion.WEAPON_SWING = {
  // back: 構えで引く角度 / through: 振り切る角度（どちらも度・前方向が+）
  // 元の武器が残像として残るため、振り幅は控えめにして違和感を抑える。
  'ground.neutral':   { back: -10, through: 16 },
  'ground.side':      { back: -20, through: 34 },
  'ground.up':        { back: -14, through: -42 },  // 下から上へ振り上げる
  'ground.down':      { back: -10, through: 26 },
  'ground.dashAttack':{ back: -18, through: 32 },
  'smash.side':       { back: -34, through: 48 },
  'smash.up':         { back: -24, through: -52 },
  'smash.down':       { back: -20, through: 38 },
  'air.neutral':      { back: -18, through: 46 },
  'air.forward':      { back: -28, through: 44 },
  'air.back':         { back: 26,  through: -44 },
  'air.up':           { back: -16, through: -46 },
  'air.down':         { back: -22, through: 36 },
  'special.neutral':  { back: -14, through: 22 },
  'special.side':     { back: -26, through: 40 },
  'special.up':       { back: -18, through: -50 },
  'special.down':     { back: -16, through: 28 },
};
ProceduralMotion.DEFAULT_SWING = { back: -18, through: 32 };
// 残像が二重に見えるのを防ぐための上限
ProceduralMotion.MAX_SWING_ANGLE = 55;

// 待機・歩行中の武器のわずかな揺れ
ProceduralMotion.weaponIdleSway = function (fighter) {
  return this._wave(fighter.proceduralClock, 110) * 2.5;
};

// この瞬間の武器の角度（度）。前方向が+。
ProceduralMotion.weaponAngleFor = function (fighter, { attacking } = {}) {
  if (!fighter.proceduralEnabled) return 0;
  const gain = fighter.proceduralIntensity;
  if (!attacking || !fighter.currentMove) return this.weaponIdleSway(fighter) * gain;

  const move = fighter.currentMove;
  const swing = this.WEAPON_SWING[fighter.currentMoveSlot] || this.DEFAULT_SWING;
  const duration = Math.max(1, move.duration || 1);
  const elapsed = duration - fighter.attackTimer;
  const phase = Math.max(0, Math.min(1, elapsed / duration));
  const active = Array.isArray(move.active) ? move.active : [duration * 0.3, duration * 0.6];
  const start = Math.max(0, Math.min(0.95, active[0] / duration));
  const end = Math.max(start + 0.01, Math.min(1, active[1] / duration));

  let angle;
  if (phase < start) {
    // 構え：ゆっくり引く
    const t = start > 0 ? phase / start : 1;
    angle = swing.back * Math.sin(t * Math.PI / 2);
  } else if (phase <= end) {
    // 判定中：一気に振り切る
    const t = (phase - start) / (end - start);
    const eased = t * t * (3 - 2 * t);
    angle = swing.back + (swing.through - swing.back) * eased;
  } else {
    // 後隙：構えへ戻す
    const t = (phase - end) / Math.max(0.01, 1 - end);
    angle = swing.through * (1 - t * t);
  }
  const scaled = angle * gain;
  return Math.max(-this.MAX_SWING_ANGLE, Math.min(this.MAX_SWING_ANGLE, scaled));
};

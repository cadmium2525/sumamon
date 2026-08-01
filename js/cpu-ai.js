// ==== CPU思考ルーチン ====
// レベル1(弱い)〜9(強い)で下記パラメータを線形補間して使用する。
// ・decisionInterval/Jitter: 何フレームおきに行動方針を再決定するか（低レベルほど反応が遅い＝大味な操作）
// ・errorRate: 間合い内での「隙を晒す誤操作」を選んでしまう確率
// ・aggressiveness: 接近時にダッシュ(1.0)寄りか歩き(0.5)寄りかの選択確率
// ・reactChance: 相手の攻撃モーションに対してガード/回避で反応する確率
// ・smashChance / grabChance: 間合い内でスマッシュ／掴みを選ぶ確率
// ・edgeGuardSkill: 場外に出た際に正しく復帰できる確率

function lerp(a, b, t) { return a + (b - a) * t; }

const CPU_LEVEL_ANCHORS = {
  decisionInterval: [40, 3],
  decisionJitter: [20, 2],
  errorRate: [0.7, 0.03],
  aggressiveness: [0.2, 0.9],
  reactChance: [0.05, 0.85],
  smashChance: [0.05, 0.3],
  grabChance: [0.02, 0.15],
  edgeGuardSkill: [0.1, 0.95],
};

const CPU_LEVEL_PARAMS = {};
for (let lvl = 1; lvl <= 9; lvl++) {
  const t = (lvl - 1) / 8;
  const params = {};
  for (const key in CPU_LEVEL_ANCHORS) {
    const [a, b] = CPU_LEVEL_ANCHORS[key];
    params[key] = lerp(a, b, t);
  }
  CPU_LEVEL_PARAMS[lvl] = params;
}

class CPUController {
  constructor(fighter, opponent, level) {
    this.fighter = fighter;
    this.opponent = opponent;
    this.level = Math.min(9, Math.max(1, level || 3));
    this.params = CPU_LEVEL_PARAMS[this.level];
    this.decisionCooldown = 0;
    this.currentIntent = this._blankInput();
  }

  _blankInput() {
    return { left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, shield: false, grab: false, stickX: 0 };
  }

  decide(blastBounds) {
    const self = this.fighter;
    if (self.dead || this.opponent.dead) return this._blankInput();

    if (this.decisionCooldown > 0) {
      this.decisionCooldown--;
    } else {
      this.currentIntent = this._computeIntent(blastBounds);
      const p = this.params;
      this.decisionCooldown = Math.round(p.decisionInterval + Math.random() * p.decisionJitter);
    }

    // 攻撃への反応（ガード/回避）は行動方針の再決定サイクルとは別に毎フレームチェックする
    const reactive = this._computeReactiveDefense();
    if (reactive) return reactive;

    return this.currentIntent;
  }

  _computeReactiveDefense() {
    const p = this.params;
    const self = this.fighter;
    const opp = this.opponent;
    if (self.hitstun > 0 || self.dodgeTimer > 0 || self.shielding) return null;
    if (opp.attackTimer <= 0 || !opp.currentMove) return null;

    const dx = Math.abs(opp.x - self.x);
    const threatRange = ((opp.currentMove.range || 50) * (opp.attackScale || 1)) + 30;
    if (dx > threatRange) return null;
    if (Math.random() >= p.reactChance) return null;

    const input = this._blankInput();
    if (self.onGround) {
      const r = Math.random();
      if (r < 0.45) {
        input.shield = true; // ガード
      } else if (r < 0.75) {
        input.shield = true; input.down = true; // その場回避
      } else {
        const away = self.x < opp.x ? -1 : 1;
        input.shield = true;
        input.left = away < 0; input.right = away > 0; input.stickX = away; // 回避ステップで距離を取る
      }
    } else {
      input.shield = true; // 空中緊急回避
    }
    return input;
  }

  _computeIntent(blastBounds) {
    const p = this.params;
    const self = this.fighter;
    const opp = this.opponent;
    const input = this._blankInput();

    if (!self.onGround && this._isInDanger(blastBounds)) {
      return this._recoveryIntent(blastBounds);
    }

    const dx = opp.x - self.x;
    const dist = Math.abs(dx);
    const dirSign = dx >= 0 ? 1 : -1;
    const meleeRange = 70 * (self.attackScale || 1);

    if (dist > meleeRange) {
      // 接近
      input.left = dirSign < 0;
      input.right = dirSign > 0;
      input.stickX = dirSign * (Math.random() < p.aggressiveness ? 1 : 0.5);
      if (opp.y < self.y - 40 && Math.random() < 0.5) input.jump = true;
    } else {
      // 間合い内：レベルが低いほど誤操作（隙）になりやすい
      if (Math.random() < p.errorRate) {
        if (Math.random() < 0.5) {
          input.left = dirSign < 0; input.right = dirSign > 0; input.stickX = dirSign * 0.4; // 中途半端に歩くだけ
        }
        // それ以外は何もしない（隙を晒す）
      } else {
        const roll = Math.random();
        if (roll < p.grabChance) {
          input.grab = true;
        } else if (roll < p.grabChance + p.smashChance) {
          // 方向とAを同時押し → スマッシュ
          input.left = dirSign < 0; input.right = dirSign > 0; input.stickX = dirSign;
          input.attack = true;
        } else if (roll < p.grabChance + p.smashChance + 0.12) {
          input.special = true;
        } else {
          input.attack = true; // 先行入力なしの弱攻撃
        }
      }
    }
    return input;
  }

  _isInDanger(blastBounds) {
    const self = this.fighter;
    const margin = 150;
    return self.x < blastBounds.left + margin || self.x > blastBounds.right - margin || self.y > blastBounds.bottom - margin;
  }

  _recoveryIntent(blastBounds) {
    const self = this.fighter;
    const input = this._blankInput();
    const centerX = (blastBounds.left + blastBounds.right) / 2;
    const towardCenter = centerX > self.x ? 1 : -1;
    input.left = towardCenter < 0;
    input.right = towardCenter > 0;
    input.stickX = towardCenter;

    if (self.jumpsUsed < CONFIG.MAX_JUMPS) {
      input.jump = true;
    } else if (Math.random() < this.params.edgeGuardSkill) {
      input.special = true; // 上Bに相当する必殺技での復帰を試みる
    }
    return input;
  }
}

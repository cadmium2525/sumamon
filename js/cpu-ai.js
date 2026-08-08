// ==== CPU思考ルーチン ====
// レベル1(弱い)〜9(強い)で下記パラメータを線形補間して使用する。
// ・decisionInterval/Jitter: 何フレームおきに行動方針を再決定するか（低レベルほど反応が遅い＝大味な操作）
// ・errorRate: 間合い内での「隙を晒す誤操作」を選んでしまう確率
// ・aggressiveness: 接近時にダッシュ(1.0)寄りか歩き(0.5)寄りかの選択確率
// ・reactChance: 相手の攻撃モーションに対してガード/回避で反応する確率
// ・smashChance / grabChance: 間合い内でスマッシュ／掴みを選ぶ確率
// ・edgeGuardSkill: 場外に出た際に正しく復帰できる確率
// ・projectileGuard: 飛んでくる弾に気づいて対処する確率
// ・punishSkill: 相手の後隙・着地隙・回避の終わり際を狙って反撃する確率
// ・justShieldSkill: ガード中に「離しでジャストガード」を狙う確率

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
  projectileGuard: [0.0, 0.95],
  punishSkill: [0.03, 0.9],
  justShieldSkill: [0.0, 0.5],
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
    this.projectiles = null;
    this.platforms = null;
    // ジャストガードを狙ってガードを張っている最中かどうか
    this._parryArmed = false;
    // 場外に出てから「まずい」と気づくまでの遅れを数えるカウンタ
    this._dangerFrames = 0;
  }

  _blankInput() {
    return { left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, shield: false, grab: false, stickX: 0 };
  }

  // 立っている土台。復帰の目標を「画面中央」ではなく「近い方の崖」にするために使う。
  _mainPlatform() {
    const list = this.platforms || (window.Stage && Stage.platforms);
    return (list && list[0]) || null;
  }

  _surfaceY(platform) {
    return platform.surfaceY != null ? platform.surfaceY : platform.y;
  }

  decide(blastBounds, projectiles, platforms) {
    const self = this.fighter;
    this.projectiles = projectiles || null;
    this.platforms = platforms || null;
    if (!this.opponent || self.dead || this.opponent.dead) return this._blankInput();

    // 吹っ飛び中は受け身を狙う（レベルが高いほど成功率が上がる）
    if (self.tumbling && !self.onGround && self.techWindow <= 0 && self.techLockout <= 0) {
      // 早く押しすぎると受付が切れてしまうため、地面が近づいてから入力する
      const willLandSoon = self.vy > 0 && self.groundDistance < Math.max(60, self.vy * 12);
      if (willLandSoon && Math.random() < this.params.edgeGuardSkill) {
        const input = this._blankInput();
        input.shield = true;
        return input;
      }
    }

    // 崖つかまりは通常の意思決定間隔を待たず、毎フレーム最優先で復帰する。
    // 直前の空入力を保持して崖にぶら下がり続ける状態を防ぐ。
    if (self.onLedge) {
      this.decisionCooldown = 0;
      this.currentIntent = this._blankInput();
      const input = this._blankInput();
      if (self.onLedge.edge === 'left') {
        input.right = true;
        input.stickX = 1;
      } else {
        input.left = true;
        input.stickX = -1;
      }
      input.up = true;
      return input;
    }

    // 場外に出ている間は、意思決定の間隔を待たずに毎フレーム復帰へ専念する。
    // 以前は再決定のタイミング待ちで何もしない時間があり、そのまま落ちていた。
    if (!self.onGround && this._isInDanger(blastBounds)) {
      this._dangerFrames++;
      this.decisionCooldown = 0;
      // レベルが低いほど「まずい」と気づくのが遅れる。
      // 上必殺を出すこと自体は確率で止めない（出さずに落ちるのが自滅の主因だった）。
      // 遅れとして表現することで、浅い位置なら下手でも戻れて、深く落ちると届かなくなる。
      const delay = Math.round(lerp(26, 0, this.params.edgeGuardSkill));
      if (this._dangerFrames > delay) return this._recoveryIntent(blastBounds);
    } else {
      this._dangerFrames = 0;
    }

    // 飛んでくる弾への対処。行動方針の再決定サイクルとは別に毎フレーム見る。
    const versusProjectile = this._projectileDefense();
    if (versusProjectile) return versusProjectile;

    if (this.decisionCooldown > 0) {
      this.decisionCooldown--;
    } else {
      this.currentIntent = this._computeIntent(blastBounds);
      const p = this.params;
      this.decisionCooldown = Math.round(p.decisionInterval + Math.random() * p.decisionJitter);
    }

    // 相手の隙への反撃も毎フレーム見る（再決定を待つと隙が終わってしまう）
    const punish = this._computePunish();
    if (punish) return punish;

    // 攻撃への反応（ガード/回避）は行動方針の再決定サイクルとは別に毎フレームチェックする
    const reactive = this._computeReactiveDefense();
    if (reactive) return reactive;

    return this.currentIntent;
  }

  // ---- 飛び道具への対処 ----
  // 自分へ向かって飛んできている弾のうち、いちばん早く届くものを返す。
  _incomingProjectile() {
    const list = this.projectiles;
    const self = this.fighter;
    if (!Array.isArray(list) || !list.length) return null;
    let best = null;
    for (const p of list) {
      if (!p || p.hit || p.owner === self || p.exploding > 0) continue;
      const pcx = p.x + p.w / 2;
      const scx = self.x + self.w / 2;
      const dx = scx - pcx;
      // 自分の方へ向かっているか（すれ違った弾は無視する）
      if (dx * p.vx <= 0) continue;
      const speed = Math.abs(p.vx);
      if (speed < 0.1) continue;
      const frames = Math.abs(dx) / speed;
      // 縦にかすりもしない高さの弾は放っておく
      const verticalGap = Math.max(self.y - (p.y + p.h), p.y - (self.y + self.h));
      if (verticalGap > self.h * 0.9) continue;
      if (!best || frames < best.frames) best = { p, frames, verticalGap };
    }
    return best;
  }

  _projectileDefense() {
    const p = this.params;
    const self = this.fighter;
    if (self.hitstun > 0 || self.dodgeTimer > 0 || self.shieldDropLag > 0) return null;
    if (self.hitlag > 0 || self.landingLag > 0 || self.attackTimer > 0) return null;
    const threat = this._incomingProjectile();
    // 反応できる距離まで近づいてから動く。遠すぎるうちから構えると何もできない。
    if (!threat || threat.frames > 34) return null;
    if (Math.random() >= p.projectileGuard) return null;

    const input = this._blankInput();
    if (!self.onGround) {
      input.shield = true; // 空中緊急回避で抜ける
      return input;
    }
    // 足元を狙う弾は跳んで越える。越えながら相手へ近づけるので、
    // ガードで固まって撃たれ続ける展開を避けられる。
    const low = (threat.p.y + threat.p.h) > (self.y + self.h * 0.5);
    const dist = Math.abs(this.opponent.x - self.x);
    const wantsToClose = dist > 90 * (self.attackScale || 1);
    if (low && threat.frames > 5 && (wantsToClose ? Math.random() < 0.7 : Math.random() < 0.35)) {
      input.jump = true;
      const dir = this.opponent.x > self.x ? 1 : -1;
      input.left = dir < 0; input.right = dir > 0; input.stickX = dir;
      return input;
    }
    input.shield = true;
    return input;
  }

  // ---- 相手の隙を突く ----
  // 後隙・着地隙・回避の終わり際・シールド破壊後のピヨリを見つけたら差し込む。
  _computePunish() {
    const p = this.params;
    const self = this.fighter;
    const opp = this.opponent;
    if (self.hitstun > 0 || self.dodgeTimer > 0 || self.shieldDropLag > 0) return null;
    if (self.attackTimer > 0 || self.landingLag > 0 || !self.onGround) return null;

    // 相手が動けない状態か
    const helpless = opp.dazedTimer > 0 || opp.landingLag > 0 || opp.recoveryTimer > 0
      || (opp.dodgeTimer > 0 && !opp.dodgeIntangible) || opp.helpless;
    if (!helpless) return null;
    if (Math.random() >= p.punishSkill) return null;

    const dx = opp.x - self.x;
    const dist = Math.abs(dx);
    const dir = dx >= 0 ? 1 : -1;
    const reach = 70 * (self.attackScale || 1);
    const input = this._blankInput();
    if (dist > reach) {
      // 間合いの外なら全力で詰める
      input.left = dir < 0; input.right = dir > 0; input.stickX = dir;
      return input;
    }
    // ピヨっている相手には最大の一撃を入れる
    input.left = dir < 0; input.right = dir > 0; input.stickX = dir;
    input.attack = true;
    return input;
  }

  _computeReactiveDefense() {
    const p = this.params;
    const self = this.fighter;
    const opp = this.opponent;
    if (self.hitstun > 0 || self.dodgeTimer > 0 || self.shieldDropLag > 0) return null;
    if (self.hitlag > 0 || self.landingLag > 0) return null;
    if (opp.attackTimer <= 0 || !opp.currentMove) return null;

    const dx = Math.abs(opp.x - self.x);
    const threatRange = ((opp.currentMove.range || 50) * (opp.attackScale || 1)) + 30;
    if (dx > threatRange) { this._parryArmed = false; return null; }

    // ガード中なら、当たる瞬間に離してジャストガードを狙う。
    // （本作のジャストガードは本家SPと同じ「離しで成立」なので、
    //   張りっぱなしでは絶対に成立しない）
    if (self.shielding) {
      const elapsed = opp.currentMove.duration - opp.attackTimer;
      const active = (opp.currentMove.active && opp.currentMove.active[0]) || 0;
      const untilHit = active - elapsed;
      if (untilHit >= 0 && untilHit <= 2 && this._parryArmed) {
        return this._blankInput();  // 離す＝ジャストガード狙い
      }
      const input = this._blankInput();
      input.shield = true;
      return input;
    }

    if (Math.random() >= p.reactChance) return null;

    const input = this._blankInput();
    if (!self.onGround) {
      input.shield = true; // 空中緊急回避
      return input;
    }

    // 回避は連続で出すほど無敵が短く後隙が長くなるので、基本はガードで受ける。
    // 直前に回避したばかりの時は、ほぼガードへ寄せる（連打は自滅につながる）。
    const staled = (self.dodgeStaleStage || 0) > 0;
    const shieldLow = self.shieldHP < CONFIG.SHIELD_MAX * 0.35;
    let dodgeChance = staled ? 0.08 : 0.32;
    if (shieldLow) dodgeChance = staled ? 0.35 : 0.7; // シールドが保たない時は回避に頼る
    const r = Math.random();
    if (r < dodgeChance * 0.45) {
      input.shield = true; input.down = true;              // その場回避
    } else if (r < dodgeChance) {
      const away = self.x < opp.x ? -1 : 1;                // 回避ステップで距離を取る
      input.shield = true;
      input.left = away < 0; input.right = away > 0; input.stickX = away;
    } else {
      input.shield = true;                                  // ガード
      this._parryArmed = Math.random() < p.justShieldSkill;  // 上手いCPUはここから離しを狙う
    }
    return input;
  }

  _computeIntent(blastBounds) {
    const p = this.params;
    const self = this.fighter;
    const opp = this.opponent;
    const input = this._blankInput();

    // 復帰の判断は decide() 側で毎フレーム行う。
    // ここにも同じ分岐を置くと「気づきの遅れ」を素通りしてしまい、
    // どのレベルでも即座に復帰行動へ入ってしまう。
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

  // 場外に出て復帰が必要な状態か。
  // 以前はブラストラインからの距離だけを見ていたため、台の真下に潜り込んでも
  // 「まだ余裕がある」と判断してしまい、そのまま落ちるケースが多かった。
  _isInDanger(blastBounds) {
    const self = this.fighter;
    if (self.onGround || self.onLedge) return false;
    const stage = this._mainPlatform();
    if (stage) {
      const surfaceY = self.y;
      const floor = this._surfaceY(stage);
      const cx = self.x + self.w / 2;
      const offStage = cx < stage.x - 8 || cx > stage.x + stage.w + 8;
      // 台の外に居て、なおかつ足場の高さより下がっている＝戻らないと落ちる
      if (offStage && surfaceY + self.h > floor - 24) return true;
      // 台の下へ潜り込んだ
      if (surfaceY > floor + 50) return true;
    }
    const margin = 150;
    return self.x < blastBounds.left + margin || self.x > blastBounds.right - margin
      || self.y > blastBounds.bottom - margin;
  }

  // 復帰。目標は「画面中央」ではなく「近い方の崖」。
  // 中央を目指すと台の下を横切ってしまい、反対側へ突き抜けて落ちることが多かった。
  _recoveryIntent(blastBounds) {
    const self = this.fighter;
    const input = this._blankInput();
    const stage = this._mainPlatform();
    const targetX = stage
      ? (self.x + self.w / 2 < stage.x + stage.w / 2 ? stage.x + 10 : stage.x + stage.w - 10)
      : (blastBounds.left + blastBounds.right) / 2;
    const floor = stage ? this._surfaceY(stage) : 0;
    const toward = targetX > self.x + self.w / 2 ? 1 : -1;
    const horizontalGap = Math.abs(targetX - (self.x + self.w / 2));
    const below = stage ? (self.y + self.h) > floor : false;

    // 上必殺を使い切っていたら、あとは横に寄せることしかできない
    if (self.helpless) {
      input.left = toward < 0; input.right = toward > 0; input.stickX = toward;
      return input;
    }

    // まず横に寄せる。空中ジャンプは「まだ高さを取り戻せるうち」に使う。
    if (self.jumpsUsed < CONFIG.MAX_JUMPS && (below || horizontalGap > 90)) {
      input.jump = true;
      input.left = toward < 0; input.right = toward > 0; input.stickX = toward;
      return input;
    }

    // ジャンプを使い切って落ちているなら上必殺。ここで出し惜しむと落ちるだけなので、
    // 以前のように確率で出さない選択はしない（自滅の主因だった）。
    if (below || self.vy > 0) {
      // 左右を入れたままBを押すと横必殺が出てしまうため、上入力のみにする
      input.up = true;
      input.special = true;
      return input;
    }

    input.left = toward < 0; input.right = toward > 0; input.stickX = toward;
    return input;
  }
}

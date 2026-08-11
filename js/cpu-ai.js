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

// レジェンド杯専用。1〜9の補間を10段階へ広げると既存AIまで変わるため、独立値にする。
// 物理や入力回数には手を加えず、判断の速さと正確さだけを限界まで高めている。
CPU_LEVEL_PARAMS[10] = {
  decisionInterval: 2,
  decisionJitter: 1,
  errorRate: 0,
  aggressiveness: 0.95,
  reactChance: 0.95,
  smashChance: 0.35,
  grabChance: 0.20,
  edgeGuardSkill: 1,
  projectileGuard: 1,
  punishSkill: 0.98,
  justShieldSkill: 0.70,
};

class CPUController {
  constructor(fighter, opponent, level) {
    this.fighter = fighter;
    this.opponent = opponent;
    this.level = Math.min(10, Math.max(1, level || 3));
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
    // これも台の外へ出過ぎない判定を通す。以前は素通りしていたため、
    // 弾を避ける動きのまま場外へ流れることがあった。
    const versusProjectile = this._projectileDefense();
    if (versusProjectile) return this._keepOnStage(versusProjectile);

    if (this.decisionCooldown > 0) {
      this.decisionCooldown--;
    } else {
      this.currentIntent = this._computeIntent(blastBounds);
      const p = this.params;
      this.decisionCooldown = Math.round(p.decisionInterval + Math.random() * p.decisionJitter);
    }

    // 相手の隙への反撃も毎フレーム見る（再決定を待つと隙が終わってしまう）。
    // ここも台の外へ出過ぎない判定を通す。素通りさせていたため、
    // 場外で止まっている相手を「隙だらけ」と見て延々と追いかけ、
    // 戻れない距離まで出ていた。
    const punish = this._computePunish();
    if (punish) return this._keepOnStage(punish);

    // 攻撃への反応（ガード/回避）は行動方針の再決定サイクルとは別に毎フレームチェックする
    const reactive = this._computeReactiveDefense();
    if (reactive) return this._keepOnStage(reactive);

    return this._keepOnStage(this.currentIntent);
  }

  // 崖の外へ出てよい距離。「今の手持ちで戻れる距離」の1割までとする。
  //
  // 実測値（コスモ・崖の外側へ何pxまでなら復帰できたか）:
  //   空中ジャンプ2回残り 300 ／ 1回残り 420 ／ 上必殺のみ 260 ／ helpless 0
  // 2回残りの方が短いのは、復帰処理が空中ジャンプを早い段階で使い切るため。
  // 見込みで多く見積もると落ちるので、実測どおりの値を使う。
  //
  // ただし上の数字は「復帰だけに専念した場合」で、追いかけながらだと使えない。
  // 追撃中は空中ジャンプを移動に使ってしまい、戻る段になると手持ちが無い。
  // 実測でも、上限を戻れる距離の半分(0.5)に置くと67%が自滅し、0.3で47%、
  // 0.2で29%、0.12で11%。しかも「場外へ出た率」と「自滅率」がほぼ一致した。
  // つまり追撃で一歩でも台の外へ出ると、ほぼそのまま落ちる。
  //
  // そこで、崖のすぐ外に居る相手にしか手を出さない値にする。
  // これ以上を狙わせても、当たる前に自滅して相手にストックを渡すだけになる。
  static PURSUIT_SAFETY = 0.1;

  // 技を出してから移動入力が効くまでの見込み時間。空中通常必殺の
  // 全体21F＋後隙10Fを基準に、崖際で戻れなくなる距離を先読みする。
  static ATTACK_COMMIT_FRAMES = 30;

  _pursuitLimit() {
    const self = this.fighter;
    if (self.helpless) return 0;
    const maxJumps = (typeof CONFIG !== 'undefined' && CONFIG.MAX_JUMPS) || 2;
    const jumpsLeft = Math.max(0, maxJumps - (self.jumpsUsed || 0));
    const reach = jumpsLeft >= 2 ? 300 : (jumpsLeft === 1 ? 420 : 260);
    return Math.round(reach * CPUController.PURSUIT_SAFETY);
  }

  // 台の外へ出過ぎないようにする。
  //
  // 地上：低レベルほど同じ行動方針を長く持ち続ける（最大60フレーム）ため、
  // 相手を追い越したあともそのまま歩き、場外へ出て落ちることがあった。
  //
  // 空中：以前はここを素通りしていた。場外の相手を追って飛び出しても、
  // 足場より高いうちは _isInDanger が反応しないため、外向きの接近入力が
  // 出続けて戻れない距離まで流れていた（実測：崖の外652pxまで出てしまい、
  // レベル9は20回中19回、ストックを使い切って自滅した）。
  // 追撃そのものは残したいので、止めるのは「戻れる範囲を超えた時」だけにする。
  _keepOnStage(input) {
    const self = this.fighter;
    if (!input) return input;
    const stage = this._mainPlatform();
    if (!stage) return input;
    const cx = self.x + self.w / 2;

    if (self.onGround) {
      const margin = 26;
      if (input.right && cx > stage.x + stage.w - margin) {
        input.right = false;
        if (input.stickX > 0) input.stickX = 0;
      }
      if (input.left && cx < stage.x + margin) {
        input.left = false;
        if (input.stickX < 0) input.stickX = 0;
      }
      return input;
    }

    // 空中。崖から出てよい距離を超えたら、内側へ能動的に向き直す。
    //
    // ただし「今どこに居るか」だけで判断すると間に合わない。
    // 空中の加速は1フレーム0.18なので、外向きの速度が乗っていると
    // 逆を入れてから止まるまで流される（速度6なら約100px）。
    // そこで「このままだとどこまで出るか」＝現在地＋制動距離で判断する。
    const accel = (typeof CONFIG !== 'undefined' && CONFIG.AIR_ACCEL) || 0.18;
    const maxJumps = (typeof CONFIG !== 'undefined' && CONFIG.MAX_JUMPS) || 2;
    const jumpsLeft = Math.max(0, maxJumps - (self.jumpsUsed || 0));

    // 場外では、追撃のために最後の空中ジャンプを使わせない。
    // 使い切ると残るのは上必殺だけになり、実測で崖の外260pxまでしか戻れなくなる。
    // 復帰処理（_recoveryIntent）はここを通らないので、戻るためには使える。
    if ((cx < stage.x || cx > stage.x + stage.w) && jumpsLeft <= 1) input.jump = false;

    const limit = this._pursuitLimit();
    const vx = self.vx || 0;

    // 空中で技を出すと、技の全体フレームと後隙の間は左右入力が効かず、
    // 出した瞬間の速度のまま運ばれる。現在はまだ場内でも、操作が戻る頃に
    // 復帰可能範囲を越えるなら技だけを控える。場内へ向かう勢いなら許可する。
    if (input.attack || input.special || input.grab) {
      const carried = cx + vx * CPUController.ATTACK_COMMIT_FRAMES;
      const outAfter = Math.max(stage.x - carried, carried - (stage.x + stage.w));
      if (outAfter > limit) {
        input.attack = false;
        input.special = false;
        input.grab = false;
      }
    }
    const brake = (vx * vx) / (2 * accel);
    const outLeft = (stage.x - cx) + (vx < 0 ? brake : 0);
    const outRight = (cx - (stage.x + stage.w)) + (vx > 0 ? brake : 0);
    // 外向き入力を消すだけでは、AIR_FRICTION(0.994)の弱い摩擦しか働かない。
    // 実測では速度9.8なら停止まで約1624px進み、反対側の崖まで抜けていた。
    // 制動距離の式どおりAIR_ACCELで止めるため、内向きを能動的に入力する。
    // ジャンプには触れず、復帰に必要な手持ちは既存判定へ任せる。
    if (outLeft > limit) {
      input.left = false;
      input.right = true;
      input.stickX = 1;
    } else if (outRight > limit) {
      input.right = false;
      input.left = true;
      input.stickX = -1;
    }
    return input;
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

    // 相手が「自分が戻れる範囲」より外に居るなら、そもそも追いかけない。
    //
    // 追いかけても届かないうえ、途中で空中ジャンプを使い切ってしまい、
    // 残るのは上必殺だけ（実測で崖の外40pxしか戻れない）になる。
    // それを使うと行動不能になり、外向きの勢いのまま流されて落ちる。
    // 実際これが「場外で止まっている相手を追って3回とも自滅した」の中身だった。
    // 届く位置まで相手が戻ってくれば、下の通常処理でちゃんと迎え撃つ。
    const stage = this._mainPlatform();
    if (stage) {
      const oppCx = opp.x + opp.w / 2;
      const oppOut = Math.max(stage.x - oppCx, oppCx - (stage.x + stage.w));
      if (oppOut > this._pursuitLimit()) {
        const selfCx = self.x + self.w / 2;
        const ledgeX = oppCx < stage.x ? stage.x + 30 : stage.x + stage.w - 30;
        const toward = ledgeX > selfCx ? 1 : -1;
        // 崖のそばまで寄って待ち構える。ジャンプも攻撃もしない。
        if (Math.abs(ledgeX - selfCx) > 24) {
          input.left = toward < 0;
          input.right = toward > 0;
          input.stickX = toward * 0.6;
        }
        return input;
      }
    }

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
      // 高さに関係なく、戻れる範囲より外へ出ていたら危険とみなす。
      // 以前は「足場より下がってから」しか反応しなかったため、高い位置で
      // 外へ流れている間は接近入力が出続け、気づいた時には戻れない距離にいた
      // （実測：崖の外652pxまで出て、レベル9は20回中19回ストックを使い切った）。
      const out = Math.max(stage.x - cx, cx - (stage.x + stage.w));
      if (out > this._pursuitLimit()) return true;
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

    // この間は applyInput が入力を捨てる。空中ジャンプや上必殺を押しても
    // 復帰には使われず、権利や高さだけを失うため、内側へ入力したまま待つ。
    // ジャンプ条件に足すだけでは下の上必殺へ進んでしまうので、必ず打ち切る。
    if (self.attackTimer > 0 || self.recoveryTimer > 0 || self.landingLag > 0 ||
        self.dodgeTimer > 0 || self.hitstun > 0 || self.shieldDropLag > 0) {
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
    //
    // ただし、外向きの勢いが残っているうちは出してはいけない。
    // 上必殺を出すと着地するまで一切操作できなくなるため、その勢いのまま
    // 流されて戻れなくなる。実測でも、この状態から横速度-2.2のまま
    // 崖の外652pxまで運ばれて落ちていた（何を入力しても効かない）。
    // 先に横の勢いを殺し、内側へ向き直ってから出す。
    const driftingOut = (toward > 0 && self.vx < -0.4) || (toward < 0 && self.vx > 0.4);
    // 落ちすぎると向き直す余裕も無くなるので、その時は賭けに出る
    const lastChance = below && (self.y + self.h) > floor + 220;
    if (driftingOut && !lastChance) {
      input.left = toward < 0; input.right = toward > 0; input.stickX = toward;
      return input;
    }

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

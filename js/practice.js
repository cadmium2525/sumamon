const PRACTICE_COURSES = {
  desert: { name: 'マンディー砂漠', stat: 'power', statLabel: 'ちから', color: '#d79b43', duration: 60, description: '1分間の横スクロール障害物走。3種のモノリスを正しい攻撃で破壊してゴールを目指す' },
  jungle: { name: 'パレパレジャングル', stat: 'intelligence', statLabel: 'かしこさ', color: '#4eaa56', duration: 65, description: '仕掛けを解いて最深部へ進む' },
  coast: { name: 'トーブル海岸', stat: 'accuracy', statLabel: '命中', color: '#42b7dd', duration: 50, description: '動くターゲットを正確に狙う' },
  snow: { name: 'パパス雪山', stat: 'evasion', statLabel: '回避', color: '#a9dcf2', duration: 65, description: '崩れる足場を登り山頂を目指す' },
  volcano: { name: 'カウレア火山', stat: 'defense', statLabel: '丈夫さ', color: '#e45b35', duration: 50, description: '火山弾と溶岩から生き残る', level: 10 },
};

// 「マンディー砂漠」専用: モノリス（壁）の弱点属性ごとのダメージテーブル（弱点以外は0＝無効）
// a = 通常技/空中技などの物理攻撃全般, b = 必殺技（飛び道具含む）, smash = 溜め攻撃
const DESERT_WALL_WEAKNESS = {
  brick: { a: 1, b: 0, smash: 0, maxHp: 3, color: ['#a8502f', '#7a3620'], label: 'レンガ壁（通常技で破壊）' },
  stone: { a: 0, b: 1, smash: 0, maxHp: 3, color: ['#8a8f96', '#585d63'], label: '石壁（必殺技で破壊）' },
  onyx: { a: 0, b: 0, smash: 1, maxHp: 3, color: ['#1c1c22', '#000'], label: '黒光り壁（スマッシュ攻撃のみ有効）' },
};

// クリアタイム（秒）→ランクのしきい値（速いほど高評価）。ゴール未到達の場合は一律Eランク扱い。
const DESERT_RANK_TIMES = [
  { grade: 'S', max: 22 },
  { grade: 'A', max: 30 },
  { grade: 'B', max: 38 },
  { grade: 'C', max: 45 },
  { grade: 'D', max: 53 },
];
// Sランク報酬「ちから+20 / ライフ+8」を基準に、他ランクは既存のグレード倍率(S/A/B/C/D/E)で按分する
const DESERT_REWARD_BASE = { stat: 20, life: 8 };

const PRACTICE_CONTROL_HELP = [
  '移動: 左スティック（左右）／ジャンプ: JUMPボタン（2段ジャンプ対応）',
  '通常技: Aボタン（方向+Aで強攻撃、方向とほぼ同時押しでスマッシュ）',
  '必殺技: Bボタン（方向+Bで横/上/下必殺技）',
  '空中技: 空中でA、シールド: SHIELDボタン、掴み: GRABボタン',
  '実際のバトルと全く同じ操作・技・モーションが使えます。',
];

// バトル本番(game.js内 buildOptions/resolveStats)と同じロジックの練習用簡易版。
// 練習用Fighterの見た目・当たり判定サイズをfighters-data.jsの定義から組み立てる。
function buildPracticeFighterOptions(def, monster) {
  return {
    fighterKey: def.key,
    grabRange: def.grabRange,
    name: monster ? monster.name : def.displayName,
    stockIconSrc: def.stockIcon,
    spriteSrc: def.idleImage,
    hurtboxWidth: def.hurtboxWidth,
    hurtboxHeight: def.hurtboxHeight,
    spriteContentBox: def.spriteContentBox,
    walkSheetSrc: def.walkSheetSrc,
    walkSheetCols: def.walkSheetCols,
    walkSheetRows: def.walkSheetRows,
    walkFrameCount: def.walkFrameCount,
    walkFrameDuration: def.walkFrameDuration,
    walkFrameContentBox: def.walkFrameContentBox,
    idleFrameSrcs: def.idleFrameSrcs,
    idleFrameContentBox: def.idleFrameContentBox,
    idleFrameDuration: def.idleFrameDuration,
    jumpFrameSrcs: def.jumpFrameSrcs,
    jumpFrameContentBox: def.jumpFrameContentBox,
    jumpFrameDuration: def.jumpFrameDuration,
    airIdleSrc: def.airIdleSrc,
    airIdleContentBox: def.airIdleContentBox,
  };
}

function resolvePracticeStats(def, monster) {
  if (monster && monster.id) {
    return GROWTH.computeStatsAtLevel({ ...defaultStats(), trainingStats: monster.trainingStats }, monster.aptitudes, monster.level);
  }
  return def.stats ? { ...defaultStats(), ...def.stats } : defaultStats();
}

const PracticeGame = {
  active: false,
  admin: false,
  monster: null,
  courseKey: null,
  course: null,
  frame: 0,
  elapsed: 0,
  lastTime: 0,
  accumulator: 0,
  raf: 0,

  init() {
    this.canvas = document.getElementById('practice-canvas');
    this.ctx = this.canvas.getContext('2d');
    document.getElementById('practice-course-list').addEventListener('click', event => {
      const button = event.target.closest('[data-practice-course]');
      if (button && !button.disabled) this.start(button.dataset.practiceCourse, this.monster, false);
    });
    document.getElementById('practice-quit').addEventListener('click', () => this.quit());
    document.getElementById('practice-result-close').addEventListener('click', () => this.closeResult());
    document.getElementById('practice-intro-start').addEventListener('click', () => this._beginRun());
  },

  // メイン対戦と同じ仮想パッド(SharedVPad)を修行画面側に移設する
  _attachSharedPad() {
    window.SharedVPad?.moveTo(document.getElementById('practice-game-panel'));
  },
  _detachSharedPad() {
    const battleContainer = document.getElementById('game-container');
    if (battleContainer) window.SharedVPad?.moveTo(battleContainer);
  },

  _readInput() {
    const keyboard = window.SharedInput?.getPlayer1Input?.() || { left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, shield: false, grab: false, stickX: 0 };
    const pad = window.SharedVPad?.getState?.() || { left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, shield: false, grab: false, stickX: 0 };
    return typeof mergeInputs === 'function' ? mergeInputs(keyboard, pad) : keyboard;
  },

  openSelection(monster) {
    if (!monster) return;
    this.stop();
    this._detachSharedPad();
    this.admin = false;
    this.monster = monster;
    document.getElementById('practice-select-panel').classList.remove('hidden');
    document.getElementById('practice-game-panel').classList.add('hidden');
    document.getElementById('practice-intro-modal').classList.add('hidden');
    document.getElementById('practice-result-modal').classList.add('hidden');
    const def = FIGHTERS[monster.baseFighterKey] || FIGHTERS.irumine;
    document.getElementById('practice-monster-summary').innerHTML = `<img src="${def.idleImage}" alt=""><span><strong>${this.escape(monster.name)} Lv.${monster.level}</strong><small>修行チケット ${UserProfileStore.data.practiceTickets || 0}枚</small></span>`;
    const tickets = Number(UserProfileStore.data.practiceTickets) || 0;
    document.getElementById('practice-course-list').innerHTML = Object.entries(PRACTICE_COURSES).map(([key, course]) => {
      // 伸び方は対象ステータスの適性で変わるため、コース選択時に確認できるようにする
      const rank = (monster.aptitudes && monster.aptitudes[course.stat]) || 'C';
      const locked = course.level && monster.level < course.level;
      const disabled = locked || tickets < 1;
      return `<button class="practice-course-card" data-practice-course="${key}" style="--course-color:${course.color}" ${disabled ? 'disabled' : ''}>
        <strong>${course.name}</strong><span>${course.statLabel} ↑↑<span class="practice-course-apt">適性<i class="stat-apt rank-${rank}" data-rank="${rank}">${rank}</i></span><br>ライフ ↑</span><small>${course.description}</small>
        <em>${locked ? `Lv.${course.level}で解禁` : tickets < 1 ? '修行券が必要' : '修行券 1枚'}</em>
      </button>`;
    }).join('');
  },

  startAdmin(courseKey, fighterKey) {
    const key = fighterKey || 'irumine';
    const monster = MasmonStore.loadAll().find(m => m.baseFighterKey === key) || {
      id: null, name: `テスト${FIGHTERS[key]?.displayName || key}`, level: 10, baseFighterKey: key,
      aptitudes: GROWTH.aptitudesFor(key), trainingStats: {},
    };
    AppFlow.showScreen('practice');
    this.start(courseKey, monster, true);
  },

  start(courseKey, monster, admin = false) {
    const course = PRACTICE_COURSES[courseKey];
    if (!course || !monster) return;
    if (!admin) {
      if (course.level && monster.level < course.level) return;
      if ((Number(UserProfileStore.data.practiceTickets) || 0) < 1) return;
      UserProfileStore.addPracticeTickets(-1);
      AppFlow._updateHomeProfile();
    }
    this.stop();
    this.admin = admin;
    this.monster = monster;
    this.courseKey = courseKey;
    this.course = course;
    this.frame = 0;
    this.elapsed = 0;
    this.accumulator = 0;

    // ---- 練習用Fighterを本番と全く同じクラスで生成する ----
    // これにより、通常技/必殺技/スマッシュ/空中技/2段ジャンプ/シールドなど
    // バトルで使える操作・モーションがそのまま修行でも使える。
    const def = FIGHTERS[monster.baseFighterKey] || FIGHTERS.irumine;
    const stats = resolvePracticeStats(def, monster);
    this.fighter = new Fighter('practice', stats, def.color, { x: 70, y: 485 - (def.hurtboxHeight || CONFIG.BASE_HURTBOX_H) }, buildPracticeFighterOptions(def, monster));
    this.fighter.stocks = 999; // 場外/撃墜処理は使わない（穴はコース側で個別に処理する）
    // ブラストラインは実質無効化：Fighter標準のKO処理を発火させない
    this.blastBounds = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };
    // 技の系統判定（技オブジェクトの参照/chargedフラグから a/b/smash を割り出す）
    this._specialMoveSet = new Set([
      ...Object.values(MOVES.special || {}),
      ...Object.values((this.fighter.moveSet && this.fighter.moveSet.special) || {}),
    ]);

    this.projectiles = [];
    this.score = 0;
    this.hits = 0;
    this.misses = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.avoided = 0;
    this.pitFalls = 0;
    this.hp = 3; // 火山コース用の簡易耐久（Fighter本体のstocksとは別管理）
    this._setupCourse();
    document.getElementById('practice-select-panel').classList.add('hidden');
    document.getElementById('practice-game-panel').classList.add('hidden');
    document.getElementById('practice-result-modal').classList.add('hidden');
    document.getElementById('practice-game-title').textContent = `${course.name}${admin ? '（管理者テスト）' : ''}`;
    this._showIntro();
  },

  _showIntro() {
    const course = this.course;
    document.getElementById('practice-intro-title').textContent = `${course.name}`;
    let text = course.description;
    if (this.courseKey === 'desert') {
      text = '灼熱の砂漠を制限時間1分以内に駆け抜けろ！\n行く手を阻む3種のモノリス（壁）は、見た目ごとに弱点となる攻撃が異なる。よく観察して正しい攻撃で打ち破ろう。\n頭上は塞がっているため、ジャンプで飛び越えることはできない。\n落とし穴に落ちてもゲームオーバーにはならない。直前のチェックポイントからやり直しになるだけなので、あきらめずゴールを目指そう。';
    }
    document.getElementById('practice-intro-text').textContent = text;
    const hints = this.courseKey === 'desert'
      ? Object.values(DESERT_WALL_WEAKNESS).map(w => `<li><b>■</b>${this.escape(w.label)}</li>`)
      : [];
    const controls = PRACTICE_CONTROL_HELP.map(line => `<li><b>▶</b>${this.escape(line)}</li>`);
    document.getElementById('practice-intro-controls').innerHTML = [...hints, ...controls].join('');
    document.getElementById('practice-intro-modal').classList.remove('hidden');
  },

  _beginRun() {
    document.getElementById('practice-intro-modal').classList.add('hidden');
    document.getElementById('practice-game-panel').classList.remove('hidden');
    this._attachSharedPad();
    this.active = true;
    this.lastTime = 0;
    this.accumulator = 0;
    this._updateHud();
    this.raf = requestAnimationFrame(time => this.loop(time));
  },

  _setupCourse() {
    const f = this.fighter;
    this.worldWidth = 960;
    this.platforms = [{ x: 0, y: 485, w: 960, h: 55 }];
    this.targets = [];
    this.hazards = [];
    this.pits = [];
    this.checkpoints = null;
    this.lastCheckpoint = null;
    this.goalX = null;
    // 地面(y=485、雪山のみy=500)の上にきちんと立った状態でスタートする
    // （キャラごとに身長(hurtboxHeight)が異なるため、固定値ではなく実際の高さから逆算する）
    const groundY = this.courseKey === 'snow' ? 500 : 485;
    f.x = 70;
    f.y = groundY - f.h;
    f.vx = 0; f.vy = 0;
    if (this.courseKey === 'desert') {
      this.worldWidth = 3200;
      this.goalX = 3100;
      this.platforms = [
        { x: 0, y: 485, w: 300, h: 55 },
        { x: 420, y: 485, w: 880, h: 55 },
        { x: 1420, y: 485, w: 930, h: 55 },
        { x: 2470, y: 485, w: 730, h: 55 },
      ];
      this.pits = [{ x: 300, w: 120 }, { x: 1300, w: 120 }, { x: 2350, w: 120 }];
      const spawnY = 485 - f.h;
      this.checkpoints = [{ x: 70, y: spawnY }, { x: 340, y: spawnY }, { x: 1340, y: spawnY }, { x: 2490, y: spawnY }];
      this.lastCheckpoint = this.checkpoints[0];
      let uid = 0;
      [[650, 'brick'], [1650, 'stone'], [2650, 'onyx']].forEach(([x, wallType]) => {
        const info = DESERT_WALL_WEAKNESS[wallType];
        this.targets.push({ id: uid++, x, y: 245, w: 60, h: 240, wallType, hp: info.maxHp, maxHp: info.maxHp, destroyed: false });
      });
    } else if (this.courseKey === 'jungle') {
      this.platforms.push({ x: 205, y: 400, w: 150, h: 16 }, { x: 500, y: 360, w: 150, h: 16 });
      [260, 555, 760].forEach((x, index) => this.targets.push({ id: index + 1, x, y: index === 1 ? 305 : 425, w: 35, h: 60, switch: true, active: false }));
      this.switchOrder = [2, 1, 3];
      this.switchProgress = 0;
      this.hazards = [{ x: 390, y: 455, w: 65, h: 30, type: 'spikes' }, { x: 675, y: 455, w: 55, h: 30, type: 'spikes' }];
      this.hazardCooldown = 0;
    } else if (this.courseKey === 'coast') {
      this.platforms.push({ x: 360, y: 415, w: 240, h: 16 });
      for (let i = 0; i < 5; i++) this._spawnCoastTarget(i);
    } else if (this.courseKey === 'snow') {
      this.platforms = [{ x: 20, y: 500, w: 230, h: 20 }];
      const climbPath = [80, 240, 400, 560, 720, 560, 400, 240];
      for (let i = 1; i <= 18; i++) this.platforms.push({ x: climbPath[(i - 1) % climbPath.length], y: 500 - i * 92, w: 145, h: 15, crumbles: i % 4 === 0, touched: 0 });
      this.goalY = 500 - 18 * 92;
      this.avalancheY = 620;
    } else if (this.courseKey === 'volcano') {
      f.x = 460;
      this.nextHazard = 20;
    }
  },

  _spawnCoastTarget(id) {
    this.targets[id] = { id, x: 300 + Math.random() * 570, y: 105 + Math.random() * 260, w: 34, h: 34, vx: (Math.random() < .5 ? -1 : 1) * (1.2 + Math.random() * 1.8), target: true };
  },

  // ---- メインループ：本番バトルと同じ「固定60fpsステップ」で進める ----
  // (Fighterクラスの技の発生/持続フレーム等はすべて「1フレーム=1/60秒」前提のため、
  //  可変dtでapplyInput/updateを呼ぶと技の発生タイミングや2段ジャンプ判定がズレてしまう)
  loop(timestamp) {
    if (!this.active) return;
    try {
      const now = Number.isFinite(timestamp) ? timestamp : performance.now();
      if (!this.lastTime) this.lastTime = now;
      const elapsed = Math.max(0, Math.min(100, now - this.lastTime));
      this.lastTime = now;
      this.accumulator += elapsed;
      const STEP = 1000 / 60;
      let steps = 0;
      while (this.accumulator >= STEP && steps < 5) {
        this._tick();
        this.accumulator -= STEP;
        steps++;
      }
      if (steps === 5 && this.accumulator >= STEP) this.accumulator = 0;
    } catch (e) {
      console.error('修行ループ内でエラーが発生しました:', e);
    }
    this._draw();
    this._updateHud();
    if (this.active) this.raf = requestAnimationFrame(next => this.loop(next));
  },

  _tick() {
    this.frame++;
    this.elapsed += 1 / 60;
    const inp = this._readInput();
    const f = this.fighter;
    f.applyInput(inp);
    f.update(this.platforms, this.blastBounds);
    // 練習コースの外へ出ないよう左端だけ簡易クランプ（右端は各コースのゴール/画面設計に任せる）
    f.x = Math.max(0, f.x);
    if (this.courseKey !== 'desert') f.x = Math.min(this.worldWidth - f.w, f.x);

    this._checkMeleeHit();
    this._updateProjectiles();

    if (this.courseKey === 'desert') this._updateDesert();
    else if (this.courseKey === 'jungle') this._updateJungle();
    else if (this.courseKey === 'coast') this._updateCoast();
    else if (this.courseKey === 'snow') this._updateSnow();
    else if (this.courseKey === 'volcano') this._updateVolcano();

    if (this.courseKey !== 'snow' && this.courseKey !== 'desert' && f.y > 570) {
      f.x = 60; f.y = 390; f.vx = 0; f.vy = 0;
      this.score = Math.max(0, this.score - 5);
    }
    if (this.elapsed >= this.course.duration) this.finish(false);
  },

  // 現在の技が a(通常/空中技) / b(必殺技) / smash(溜め攻撃) のどれに属するか判定
  _familyOf(move) {
    if (!move) return 'a';
    if (move.charged) return 'smash';
    if (this._specialMoveSet.has(move)) return 'b';
    return 'a';
  },

  // 本番のcheckAttacks()と同じ仕組み：現在の攻撃判定(hitbox)を一度だけ対象に当てる
  _checkMeleeHit() {
    const f = this.fighter;
    const hb = f.getHitbox();
    if (!hb || f.hasHitThisAttack) return;
    const family = this._familyOf(f.currentMove);
    for (const target of this.targets) {
      if (!target || target.destroyed || !Physics.rectsOverlap(hb, target)) continue;
      f.hasHitThisAttack = true;
      this._applyHitToTarget(target, family);
    }
  },

  _applyHitToTarget(target, family) {
    if (target.switch) {
      const expected = this.switchOrder[this.switchProgress];
      if (target.id === expected) { target.active = true; this.switchProgress++; this.score += 18; }
      else { this.switchProgress = 0; this.targets.forEach(item => { if (item) item.active = false; }); this.score = Math.max(0, this.score - 5); }
    } else if (target.wallType) {
      const dmg = (DESERT_WALL_WEAKNESS[target.wallType]?.[family]) || 0;
      if (dmg > 0) {
        target.hp -= dmg;
        this.score += 10;
        target.flash = 10;
        if (target.hp <= 0) { target.destroyed = true; this.score += 20; }
      } else {
        target.bounce = 10; // 弱点でない攻撃は効かない（見た目で弾かれる演出のみ）
      }
    } else if (target.target) {
      this.hits++; this.combo++; this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score += 4 + Math.min(6, this.combo);
      this._spawnCoastTarget(target.id);
    }
  },

  // ---- 飛び道具（ルミナスアロー/ローリングボム等、必殺技のprojectile設定）----
  _updateProjectiles() {
    const request = this.fighter.consumeProjectileRequest?.();
    if (request) {
      const cfg = request.config;
      const spritePath = request.move.projectileSprite;
      const sprite = spritePath ? (window.PreloadedImages?.get(spritePath) || new Image()) : null;
      if (sprite && !sprite.src) sprite.src = spritePath;
      const f = this.fighter;
      this.projectiles.push({
        move: request.move, sprite, config: cfg,
        x: f.facing === 1 ? f.x + f.w : f.x - cfg.width,
        y: f.y + f.h * 0.42, vx: f.facing * cfg.speed, vy: 0,
        w: cfg.width, h: cfg.height, life: cfg.lifetime, hit: false, exploding: 0,
      });
    }
    const family = 'b'; // 飛び道具は必ず必殺技扱い
    for (const p of this.projectiles) {
      if (p.exploding > 0) { p.exploding--; if (p.exploding <= 0) p.hit = true; continue; }
      const isBomb = p.config.type === 'bomb';
      const previousBottom = p.y + p.h;
      p.x += p.vx;
      if (isBomb) {
        p.vy += p.config.gravity || 0.25;
        p.y += p.vy;
        for (const platform of this.platforms) {
          if (platform.gone) continue;
          const withinX = p.x + p.w > platform.x && p.x < platform.x + platform.w;
          if (withinX && p.vy >= 0 && previousBottom <= platform.y + 3 && p.y + p.h >= platform.y) {
            p.y = platform.y - p.h; p.vy = 0; p.vx *= p.config.groundFriction || 0.985;
            break;
          }
        }
      }
      p.life--;
      if (isBomb && p.life <= 0) {
        const radius = p.config.explosionRadius || 90;
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
        for (const target of this.targets) {
          if (!target || target.destroyed) continue;
          const tx = target.x + target.w / 2, ty = target.y + target.h / 2;
          if (Math.hypot(tx - cx, ty - cy) <= radius) this._applyHitToTarget(target, family);
        }
        p.exploding = 12; p.vx = 0; p.vy = 0;
        continue;
      }
      if (isBomb) continue;
      if (!p.hit) {
        for (const target of this.targets) {
          if (!target || target.destroyed || !Physics.rectsOverlap(p, target)) continue;
          this._applyHitToTarget(target, family);
          p.hit = true;
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.hit && (p.life > 0 || p.exploding > 0) &&
      p.x > -200 && p.x < this.worldWidth + 200 && p.y < 900);
  },

  _updateDesert() {
    const f = this.fighter;
    // モノリス（壁）は破壊するまで通行不能。高さ方向の制限を設けないことで、
    // ジャンプ（2段ジャンプ含む）でも決して飛び越えられない「天井付きの壁」として機能する。
    for (const wall of this.targets) {
      if (!wall || wall.destroyed) continue;
      if (f.x + f.w > wall.x && f.x < wall.x + wall.w) {
        const approachingFromLeft = (f.x + f.w / 2) < (wall.x + wall.w / 2);
        f.x = approachingFromLeft ? wall.x - f.w : wall.x + wall.w;
        f.vx = 0;
      }
    }
    // カメラは横スクロールでプレイヤーを追従
    this.cameraX = Math.max(0, Math.min(this.worldWidth - 960, f.x - 420));
    // チェックポイント更新
    for (const cp of this.checkpoints) {
      if (f.x >= cp.x && cp.x > this.lastCheckpoint.x) this.lastCheckpoint = cp;
    }
    // 落とし穴：ゲームオーバーにはせず、直前のチェックポイントへ戻す（タイムロスのみ）
    if (f.y > 560) {
      f.x = this.lastCheckpoint.x; f.y = this.lastCheckpoint.y; f.vx = 0; f.vy = 0;
      this.pitFalls++;
    }
    if (f.x + f.w >= this.goalX) this.finish(true);
  },

  _updateJungle() {
    const f = this.fighter;
    if (this.hazardCooldown > 0) this.hazardCooldown--;
    for (const hazard of this.hazards) {
      if (this.hazardCooldown <= 0 && Physics.rectsOverlap(f.getHurtbox(), hazard)) {
        this.hazardCooldown = 45;
        f.vy = -7;
        f.x -= f.facing * 35;
        this.score = Math.max(0, this.score - 3);
      }
    }
    if (this.switchProgress >= this.switchOrder.length && f.x > 875) this.finish(true);
  },

  _updateCoast() {
    this.targets.forEach(target => {
      target.x += target.vx;
      if (target.x < 260 || target.x > 915) target.vx *= -1;
    });
  },

  _updateSnow() {
    const f = this.fighter;
    this.cameraY = Math.min(0, f.y - 270);
    this.avalancheY -= 0.55;
    const heightScore = Math.max(0, Math.round((500 - f.y) / (500 - this.goalY) * 100));
    this.score = Math.max(this.score, heightScore);
    if (f.y + f.h > this.avalancheY || f.y > 620) { this.finish(false); return; }
    if (f.y <= this.goalY + 45) this.finish(true);
  },

  _updateVolcano() {
    const f = this.fighter;
    this.nextHazard--;
    if (this.nextHazard <= 0) {
      this.nextHazard = Math.max(18, 50 - this.elapsed * 0.45);
      this.hazards.push({ x: 35 + Math.random() * 880, y: -40, vx: (Math.random() - .5) * 2, vy: 4 + Math.random() * 3, w: 30 + Math.random() * 24, h: 30 + Math.random() * 24, type: 'rock' });
    }
    for (const hazard of this.hazards) {
      hazard.x += hazard.vx; hazard.y += hazard.vy;
      if (!hazard.hit && Physics.rectsOverlap(f.getHurtbox(), hazard)) {
        hazard.hit = true;
        if (f.shielding) { this.avoided++; this.score += 4; }
        else { this.hp--; f.vy = -7; this.score = Math.max(0, this.score - 8); }
      }
      if (!hazard.hit && hazard.y > 540) { hazard.hit = true; this.avoided++; this.score += 2; }
    }
    this.hazards = this.hazards.filter(hazard => !hazard.hit);
    if (this.hp <= 0) this.finish(false);
  },

  _updateHud() {
    const remaining = Math.max(0, Math.ceil((this.course?.duration || 0) - this.elapsed));
    document.getElementById('practice-game-time').textContent = `${remaining}`;
    const status = this.courseKey === 'desert' ? `モノリス破壊 ${this.targets.filter(t => t.destroyed).length}/${this.targets.length}　落下 ${this.pitFalls || 0}回`
      : this.courseKey === 'jungle' ? `仕掛け ${this.switchProgress || 0}/3`
      : this.courseKey === 'coast' ? `命中 ${this.hits}　COMBO ${this.combo}`
      : this.courseKey === 'snow' ? `高度 ${Math.max(0, Math.round((500 - this.fighter.y) / 10))}m`
      : `耐久 ♥${this.hp}　防御 ${this.avoided}`;
    document.getElementById('practice-game-status').textContent = status;
  },

  finish(cleared) {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    let normalized = 0;
    let grade;
    if (this.courseKey === 'desert') {
      if (cleared) {
        const found = DESERT_RANK_TIMES.find(rank => this.elapsed <= rank.max);
        grade = found ? found.grade : 'E';
      } else {
        grade = 'E';
      }
      normalized = Math.max(0, Math.round(100 - (this.elapsed / this.course.duration) * 100));
    } else if (this.courseKey === 'jungle') normalized = this.switchProgress / 3 * 65 + (cleared ? 35 : 0);
    else if (this.courseKey === 'coast') normalized = Math.min(100, this.hits * 4 + this.bestCombo * 3 - this.misses * 2);
    else if (this.courseKey === 'snow') normalized = Math.min(100, this.score + (cleared ? 15 : 0));
    else normalized = Math.min(100, this.elapsed / this.course.duration * 75 + this.avoided * 2 + (this.hp > 0 ? 10 : 0));
    normalized = Math.max(0, Math.round(normalized));
    if (!grade) grade = normalized >= 90 ? 'S' : normalized >= 75 ? 'A' : normalized >= 55 ? 'B' : normalized >= 30 ? 'C' : 'D';
    let growthText = '管理者テストのため能力値は変化しません';
    if (!this.admin && this.monster.id) {
      const growth = this.courseKey === 'desert'
        ? GROWTH.applyPracticeResult(this.monster, this.course.stat, grade, DESERT_REWARD_BASE.stat, DESERT_REWARD_BASE.life)
        : GROWTH.applyPracticeResult(this.monster, this.course.stat, grade);
      MasmonStore.update(this.monster);
      growthText = `${this.course.statLabel} +${growth[this.course.stat]}　ライフ +${growth.life}`;
    }
    document.getElementById('practice-result-grade').textContent = grade;
    document.getElementById('practice-result-title').textContent = cleared ? `${this.course.name} 修行成功！` : `${this.course.name} 修行終了`;
    document.getElementById('practice-result-score').textContent = this.courseKey === 'desert'
      ? (cleared ? `クリアタイム ${this.elapsed.toFixed(1)}秒` : `タイムアップ（未クリア）`)
      : `評価スコア ${normalized}／100`;
    document.getElementById('practice-result-growth').textContent = growthText;
    document.getElementById('practice-result-modal').classList.remove('hidden');
  },

  quit() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    this._detachSharedPad();
    if (this.admin) AppFlow.showScreen('debug');
    else this.openSelection(this.monster);
  },

  closeResult() {
    document.getElementById('practice-result-modal').classList.add('hidden');
    this._detachSharedPad();
    if (this.admin) AppFlow.showScreen('debug');
    else this.openSelection(this.monster);
  },

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this._detachSharedPad();
  },

  _draw() {
    const ctx = this.ctx;
    const themes = {
      desert: ['#e8b85c', '#8d4f24'], jungle: ['#5aaf69', '#173a29'], coast: ['#62cced', '#17678d'], snow: ['#d9f4ff', '#5a8fb3'], volcano: ['#e34b2e', '#351018'],
    };
    const [top, bottom] = themes[this.courseKey];
    const gradient = ctx.createLinearGradient(0, 0, 0, 540); gradient.addColorStop(0, top); gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 960, 540);
    const offsetY = -(this.cameraY || 0);
    const offsetX = -(this.cameraX || 0);
    if (this.courseKey === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      for (let i = 0; i < 35; i++) ctx.fillRect((i * 83 + this.frame) % 960, (i * 57 + this.frame * 1.5) % 540, 4, 4);
    }
    if (this.courseKey === 'desert') {
      // 遠景の太陽と砂丘（視差なしの簡易背景）
      ctx.fillStyle = 'rgba(255,244,200,.9)'; ctx.beginPath(); ctx.arc(800, 90, 55, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(((i * 260) - (this.cameraX * .3)) % 1200, 470, 160, 40, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.save(); ctx.translate(offsetX, offsetY);
    for (const platform of this.platforms) {
      if (platform.gone) continue;
      ctx.fillStyle = this.courseKey === 'snow' ? '#e8f8ff' : this.courseKey === 'volcano' ? '#34242a' : '#5b4937';
      ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
      ctx.fillStyle = this.courseKey === 'snow' ? '#8bd5ef' : '#d8aa5a'; ctx.fillRect(platform.x, platform.y, platform.w, 4);
    }
    if (this.courseKey === 'desert') {
      for (const pit of this.pits) {
        ctx.fillStyle = '#1c1408'; ctx.fillRect(pit.x, 485, pit.w, 55);
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.ellipse(pit.x + pit.w / 2, 490, pit.w / 2, 10, 0, 0, Math.PI * 2); ctx.fill();
      }
      // ゴール旗
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(this.goalX + 20, 300, 6, 185);
      ctx.fillStyle = '#ff5a5a'; ctx.beginPath(); ctx.moveTo(this.goalX + 26, 300); ctx.lineTo(this.goalX + 70, 320); ctx.lineTo(this.goalX + 26, 340); ctx.fill();
    }
    for (const target of this.targets) {
      if (!target || target.destroyed) continue;
      if (target.switch) { ctx.fillStyle = target.active ? '#7dff75' : '#ffd54f'; ctx.fillRect(target.x, target.y, target.w, target.h); ctx.fillStyle = '#14202a'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(target.id, target.x + 12, target.y + 35); }
      else if (target.target) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(target.x + target.w/2, target.y + target.h/2, target.w/2, 0, Math.PI*2); ctx.fill(); ctx.fillStyle='#ff3d45'; ctx.beginPath(); ctx.arc(target.x+target.w/2,target.y+target.h/2,9,0,Math.PI*2);ctx.fill(); }
      else if (target.wallType) {
        const info = DESERT_WALL_WEAKNESS[target.wallType];
        // 破壊するまで頭上が塞がっていることを示す半透明の帯（見た目のバリア＝天井の代わり）
        ctx.fillStyle = 'rgba(255,255,255,.10)';
        ctx.fillRect(target.x, 0, target.w, target.y);
        ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.setLineDash([6, 8]);
        ctx.strokeRect(target.x, 0, target.w, target.y); ctx.setLineDash([]);
        const [wTop, wBottom] = info.color;
        const shake = target.bounce > 0 ? (Math.random() * 6 - 3) : 0;
        const flashOn = target.flash > 0 && Math.floor(target.flash / 3) % 2 === 0;
        const grad = ctx.createLinearGradient(target.x, target.y, target.x, target.y + target.h);
        grad.addColorStop(0, flashOn ? '#fff' : wTop); grad.addColorStop(1, wBottom);
        ctx.fillStyle = grad;
        ctx.fillRect(target.x + shake, target.y, target.w, target.h);
        if (target.wallType === 'brick') {
          ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
          for (let row = 0; row < target.h / 20; row++) {
            const offsetBrick = row % 2 === 0 ? 0 : target.w / 2;
            ctx.beginPath(); ctx.moveTo(target.x, target.y + row * 20); ctx.lineTo(target.x + target.w, target.y + row * 20); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(target.x + offsetBrick, target.y + row * 20); ctx.lineTo(target.x + offsetBrick, target.y + row * 20 + 20); ctx.stroke();
          }
        } else if (target.wallType === 'stone') {
          ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 3;
          for (let row = 0; row < target.h / 34; row++) ctx.strokeRect(target.x, target.y + row * 34, target.w, 34);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(target.x + 6, target.y + 6, 8, target.h - 12);
          ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(target.x + target.w - 16, target.y + 20, 6, target.h - 40);
        }
        ctx.fillStyle = '#ffd96b'; ctx.fillRect(target.x, target.y - 8, target.w * (target.hp / target.maxHp), 5);
        if (target.flash > 0) target.flash -= 1;
        if (target.bounce > 0) target.bounce -= 1;
      }
      else { ctx.fillStyle = '#7d6a58'; ctx.fillRect(target.x,target.y,target.w,target.h); ctx.fillStyle='#ffd96b';ctx.fillRect(target.x,target.y,target.w*(target.hp/target.maxHp),5); }
    }
    for (const hazard of this.hazards) {
      ctx.fillStyle = hazard.type === 'spikes' ? '#dce7ed' : '#4a2020';
      if (hazard.type === 'spikes') { ctx.beginPath(); ctx.moveTo(hazard.x,hazard.y+hazard.h);ctx.lineTo(hazard.x+hazard.w/2,hazard.y);ctx.lineTo(hazard.x+hazard.w,hazard.y+hazard.h);ctx.fill(); }
      else { ctx.beginPath();ctx.arc(hazard.x+hazard.w/2,hazard.y+hazard.h/2,hazard.w/2,0,Math.PI*2);ctx.fill(); }
    }
    this._drawProjectiles(ctx);
    // ---- プレイヤー：本番と同じFighter.draw()でそのまま描画（全モーション対応）----
    this.fighter.draw(ctx);
    if (this.courseKey === 'jungle' && this.switchProgress >= 3) { ctx.fillStyle='#8dfff0';ctx.fillRect(900,390,35,95); }
    if (this.courseKey === 'snow') { ctx.fillStyle='rgba(210,245,255,.75)';ctx.fillRect(0,this.avalancheY,960,260); }
    ctx.restore();
  },

  _drawProjectiles(ctx) {
    for (const p of this.projectiles) {
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      if (p.exploding > 0) {
        const progress = 1 - p.exploding / 12;
        const radius = (p.config.explosionRadius || 90) * (0.45 + progress * 0.55);
        ctx.globalAlpha = Math.max(.15, p.exploding / 12);
        const gradient = ctx.createRadialGradient(0, 0, 4, 0, 0, radius);
        gradient.addColorStop(0, '#fff7b0'); gradient.addColorStop(.35, '#ff9f1a'); gradient.addColorStop(1, 'rgba(255,45,0,0)');
        ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        continue;
      }
      if (p.vx < 0) ctx.scale(-1, 1);
      if (p.sprite && p.sprite.complete && p.sprite.naturalWidth) {
        ctx.drawImage(p.sprite, -p.w / 2, -p.h / 2, p.w, p.h);
      } else {
        ctx.fillStyle = '#fff58a';
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
  },

  escape(value) { const div = document.createElement('div'); div.textContent = String(value || ''); return div.innerHTML; },
};

window.PracticeGame = PracticeGame;

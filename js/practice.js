const PRACTICE_COURSES = {
  desert: { name: 'マンディー砂漠', stat: 'power', statLabel: 'ちから', color: '#d79b43', duration: 60, description: '1分間の横スクロール障害物走。3種のモノリスを正しい攻撃で破壊してゴールを目指す' },
  jungle: { name: 'パレパレジャングル', stat: 'intelligence', statLabel: 'かしこさ', color: '#4eaa56', duration: 65, description: '仕掛けを解いて最深部へ進む' },
  coast: { name: 'トーブル海岸', stat: 'accuracy', statLabel: '命中', color: '#42b7dd', duration: 50, description: '動くターゲットを正確に狙う' },
  snow: { name: 'パパス雪山', stat: 'evasion', statLabel: '回避', color: '#a9dcf2', duration: 65, description: '崩れる足場を登り山頂を目指す' },
  volcano: { name: 'カウレア火山', stat: 'defense', statLabel: '丈夫さ', color: '#e45b35', duration: 50, description: '火山弾と溶岩から生き残る', level: 10 },
};

// 「マンディー砂漠」専用: モノリス（壁）の弱点属性ごとのダメージテーブル（弱点以外は0＝無効）
const DESERT_WALL_WEAKNESS = {
  brick: { a: 1, b: 0, smash: 0, maxHp: 3, color: ['#a8502f', '#7a3620'], label: 'レンガ壁（A攻撃で破壊）' },
  stone: { a: 0, b: 1, smash: 0, maxHp: 3, color: ['#8a8f96', '#585d63'], label: '石壁（B攻撃で破壊）' },
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
  '移動: 左スティック（左右）',
  'ジャンプ: JUMPボタン',
  'A攻撃: Aボタン',
  'B攻撃: Bボタン',
  'スマッシュ攻撃: 方向とAボタンを同時押し',
  'シールド: SHIELDボタン',
];

const PracticeGame = {
  active: false,
  admin: false,
  monster: null,
  courseKey: null,
  course: null,
  frame: 0,
  elapsed: 0,
  lastTime: 0,
  raf: 0,
  previousAttack: false,
  previousSpecial: false,
  previousJump: false,
  previousDirHeld: false,
  dirPressAt: null,

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
    const keyboard = window.SharedInput?.getPlayer1Input?.() || { left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, shield: false, stickX: 0 };
    const pad = window.SharedVPad?.getState?.() || { left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, shield: false, stickX: 0 };
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
      const locked = course.level && monster.level < course.level;
      const disabled = locked || tickets < 1;
      return `<button class="practice-course-card" data-practice-course="${key}" style="--course-color:${course.color}" ${disabled ? 'disabled' : ''}>
        <strong>${course.name}</strong><span>${course.statLabel} ↑↑<br>ライフ ↑</span><small>${course.description}</small>
        <em>${locked ? `Lv.${course.level}で解禁` : tickets < 1 ? '修行券が必要' : '修行券 1枚'}</em>
      </button>`;
    }).join('');
  },

  startAdmin(courseKey) {
    const monster = window.AppFlow?._selectedManageMasmon?.() || MasmonStore.loadAll()[0] || {
      id: null, name: 'テストイルミネ', level: 10, baseFighterKey: 'irumine', aptitudes: GROWTH.aptitudesFor('irumine'), trainingStats: {},
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
    this.previousAttack = false;
    this.previousSpecial = false;
    this.previousJump = false;
    this.previousDirHeld = false;
    this.dirPressAt = null;
    this.player = { x: 70, y: 410, vx: 0, vy: 0, w: 44, h: 68, facing: 1, onGround: false, attackTimer: 0, shield: false, hp: 3, hazardCooldown: 0 };
    this.cameraX = 0;
    this.cameraY = 0;
    this.score = 0;
    this.hits = 0;
    this.misses = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.avoided = 0;
    this.pitFalls = 0;
    this._loadSprite();
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
      text = '灼熱の砂漠を制限時間1分以内に駆け抜けろ！\n行く手を阻む3種のモノリス（壁）は、見た目ごとに弱点となる攻撃が異なる。よく観察して正しい攻撃で打ち破ろう。\n落とし穴に落ちてもゲームオーバーにはならない。直前のチェックポイントからやり直しになるだけなので、あきらめずゴールを目指そう。';
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
    this.lastTime = performance.now();
    this._updateHud();
    this.raf = requestAnimationFrame(time => this.loop(time));
  },

  _loadSprite() {
    const def = FIGHTERS[this.monster.baseFighterKey] || FIGHTERS.irumine;
    this.sprite = window.PreloadedImages?.get(def.idleImage) || new Image();
    if (!this.sprite.src) this.sprite.src = def.idleImage;
  },

  _setupCourse() {
    this.worldWidth = 960;
    this.platforms = [{ x: 0, y: 485, w: 960, h: 55 }];
    this.targets = [];
    this.projectiles = [];
    this.hazards = [];
    this.pits = [];
    this.checkpoints = null;
    this.lastCheckpoint = null;
    this.goalX = null;
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
      this.checkpoints = [{ x: 70, y: 410 }, { x: 340, y: 410 }, { x: 1340, y: 410 }, { x: 2490, y: 410 }];
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
      this.player.x = 460;
      this.nextHazard = 20;
    }
  },

  _spawnCoastTarget(id) {
    this.targets[id] = { id, x: 300 + Math.random() * 570, y: 105 + Math.random() * 260, w: 34, h: 34, vx: (Math.random() < .5 ? -1 : 1) * (1.2 + Math.random() * 1.8), target: true };
  },

  _fireCoastShot() {
    const p = this.player;
    const originX = p.x + p.w / 2;
    const originY = p.y + 24;
    const candidates = this.targets.filter(target => p.facing > 0 ? target.x + target.w / 2 > originX : target.x + target.w / 2 < originX);
    const target = candidates.sort((a, b) => Math.hypot(a.x - originX, a.y - originY) - Math.hypot(b.x - originX, b.y - originY))[0];
    let vx = p.facing * 13, vy = 0;
    if (target) {
      const dx = target.x + target.w / 2 - originX;
      const dy = target.y + target.h / 2 - originY;
      const distance = Math.max(1, Math.hypot(dx, dy));
      vx = dx / distance * 13;
      vy = dy / distance * 13;
    }
    this.projectiles.push({ x: originX, y: originY, vx, vy, w: 18, h: 8 });
  },

  loop(time) {
    if (!this.active) return;
    const dt = Math.min(2, Math.max(.25, (time - this.lastTime) / (1000 / 60)));
    this.lastTime = time;
    this.elapsed += dt / 60;
    this.frame += dt;
    this._update(dt);
    this._draw();
    this._updateHud();
    if (this.active) this.raf = requestAnimationFrame(next => this.loop(next));
  },

  _update(dt) {
    const p = this.player;
    const inp = this._readInput();
    if (p.hazardCooldown > 0) p.hazardCooldown = Math.max(0, p.hazardCooldown - dt);
    p.shield = !!inp.shield;
    const speed = p.shield ? 1.5 : 4.5;
    if (inp.left !== inp.right) {
      p.vx = (inp.left ? -speed : speed);
      p.facing = inp.left ? -1 : 1;
    } else p.vx *= Math.pow(.72, dt);
    const jumpPressed = inp.jump && !this.previousJump;
    if (jumpPressed && p.onGround) { p.vy = -11.5; p.onGround = false; }
    this.previousJump = inp.jump;

    // 方向キーの押し始めタイミングを記録（スマッシュ判定用）
    const dirHeld = inp.left || inp.right;
    if (dirHeld && !this.previousDirHeld) this.dirPressAt = performance.now();
    if (!dirHeld) this.dirPressAt = null;
    this.previousDirHeld = dirHeld;

    const attackPressed = inp.attack && !this.previousAttack;
    this.previousAttack = inp.attack;
    const specialPressed = !!inp.special && !this.previousSpecial;
    this.previousSpecial = !!inp.special;

    if (this.courseKey === 'desert') {
      const smashWindow = (typeof CONFIG !== 'undefined' && CONFIG.SMASH_SIMULTANEOUS_WINDOW_MS) || 120;
      if (attackPressed && p.attackTimer <= 0 && !p.shield) {
        const isSmash = this.dirPressAt !== null && Math.abs(performance.now() - this.dirPressAt) <= smashWindow;
        p.attackTimer = isSmash ? 20 : 14;
        this._strike(isSmash ? 'smash' : 'a');
      } else if (specialPressed && p.attackTimer <= 0 && !p.shield) {
        p.attackTimer = 16;
        this._strike('b');
      }
    } else if (attackPressed && p.attackTimer <= 0 && !p.shield) {
      p.attackTimer = 14;
      if (this.courseKey === 'coast') this._fireCoastShot();
      else this._strike();
    }
    if (p.attackTimer > 0) p.attackTimer -= dt;
    const previousBottom = p.y + p.h;
    p.vy = Math.min(13, p.vy + .55 * dt);
    p.x = Math.max(0, Math.min(this.worldWidth - p.w, p.x + p.vx * dt));
    p.y += p.vy * dt;
    p.onGround = false;
    for (const platform of this.platforms) {
      if (platform.gone) continue;
      if (p.x + p.w > platform.x && p.x < platform.x + platform.w && p.vy >= 0 && previousBottom <= platform.y + 8 && p.y + p.h >= platform.y) {
        p.y = platform.y - p.h; p.vy = 0; p.onGround = true;
        if (platform.crumbles) { platform.touched += dt; if (platform.touched > 42) platform.gone = true; }
      }
    }
    if (this.courseKey === 'desert') this._updateDesert(dt);
    if (this.courseKey === 'jungle') this._updateJungle(dt);
    if (this.courseKey === 'coast') this._updateCoast(dt);
    if (this.courseKey === 'snow') this._updateSnow(dt);
    if (this.courseKey === 'volcano') this._updateVolcano(dt);
    if (this.courseKey !== 'snow' && this.courseKey !== 'desert' && p.y > 570) { p.x = 60; p.y = 390; p.vx = p.vy = 0; this.score = Math.max(0, this.score - 5); }
    if (this.elapsed >= this.course.duration) this.finish(false);
  },

  _updateDesert(dt) {
    const p = this.player;
    // モノリス（壁）は破壊するまでジャンプでも越えられない障害物として振る舞う
    for (const wall of this.targets) {
      if (!wall || wall.destroyed) continue;
      if (p.x + p.w > wall.x && p.x < wall.x + wall.w && p.y + p.h > wall.y) {
        const approachingFromLeft = (p.x + p.w / 2) < (wall.x + wall.w / 2);
        p.x = approachingFromLeft ? wall.x - p.w : wall.x + wall.w;
        p.vx = 0;
      }
    }
    // カメラは横スクロールでプレイヤーを追従
    this.cameraX = Math.max(0, Math.min(this.worldWidth - 960, p.x - 420));
    // チェックポイント更新
    for (const cp of this.checkpoints) {
      if (p.x >= cp.x && cp.x > this.lastCheckpoint.x) this.lastCheckpoint = cp;
    }
    // 落とし穴：ゲームオーバーにはせず、直前のチェックポイントへ戻す（タイムロスのみ）
    if (p.y > 560) {
      p.x = this.lastCheckpoint.x; p.y = this.lastCheckpoint.y; p.vx = 0; p.vy = 0;
      this.pitFalls++;
    }
    if (p.x + p.w >= this.goalX) this.finish(true);
  },

  _strike(attackType = 'a') {
    const p = this.player;
    const box = { x: p.facing > 0 ? p.x + p.w : p.x - 76, y: p.y + 8, w: 76, h: 58 };
    let hit = false;
    for (const target of this.targets) {
      if (!target || target.destroyed || !this._overlap(box, target)) continue;
      hit = true;
      if (target.switch) {
        const expected = this.switchOrder[this.switchProgress];
        if (target.id === expected) { target.active = true; this.switchProgress++; this.score += 18; }
        else { this.switchProgress = 0; this.targets.forEach(item => { if (item) item.active = false; }); this.score = Math.max(0, this.score - 5); }
      } else if (target.wallType) {
        const dmg = (DESERT_WALL_WEAKNESS[target.wallType]?.[attackType]) || 0;
        if (dmg > 0) {
          target.hp -= dmg;
          this.score += 10;
          target.flash = 10;
          if (target.hp <= 0) { target.destroyed = true; this.score += 20; }
        } else {
          target.bounce = 10; // 弱点でない攻撃は効かない（見た目で弾かれる演出のみ）
        }
      } else {
        target.hp--; this.score += 6;
        if (target.hp <= 0) { target.destroyed = true; this.score += 8; }
      }
    }
    if (!hit && this.courseKey === 'desert') this.score = Math.max(0, this.score - 1);
  },

  _updateJungle() {
    for (const hazard of this.hazards) {
      if (this.player.hazardCooldown <= 0 && this._overlap(this.player, hazard)) {
        this.player.hazardCooldown = 45;
        this.player.vy = -7;
        this.player.x -= this.player.facing * 35;
        this.score = Math.max(0, this.score - 3);
      }
    }
    if (this.switchProgress >= this.switchOrder.length && this.player.x > 875) this.finish(true);
  },

  _updateCoast(dt) {
    this.targets.forEach(target => {
      target.x += target.vx * dt;
      if (target.x < 260 || target.x > 915) target.vx *= -1;
    });
    this.projectiles.forEach(shot => { shot.x += shot.vx * dt; shot.y += shot.vy * dt; });
    for (const shot of this.projectiles) {
      for (const target of this.targets) {
        if (shot.hit || !this._overlap(shot, target)) continue;
        shot.hit = true; this.hits++; this.combo++; this.bestCombo = Math.max(this.bestCombo, this.combo); this.score += 4 + Math.min(6, this.combo); this._spawnCoastTarget(target.id);
      }
      if (!shot.hit && (shot.x < -20 || shot.x > 980 || shot.y < -20 || shot.y > 560)) { shot.hit = true; this.misses++; this.combo = 0; }
    }
    this.projectiles = this.projectiles.filter(shot => !shot.hit);
  },

  _updateSnow(dt) {
    this.cameraY = Math.min(0, this.player.y - 270);
    this.avalancheY -= .55 * dt;
    const heightScore = Math.max(0, Math.round((500 - this.player.y) / (500 - this.goalY) * 100));
    this.score = Math.max(this.score, heightScore);
    if (this.player.y + this.player.h > this.avalancheY || this.player.y > 620) { this.finish(false); return; }
    if (this.player.y <= this.goalY + 45) this.finish(true);
  },

  _updateVolcano(dt) {
    this.nextHazard -= dt;
    if (this.nextHazard <= 0) {
      this.nextHazard = Math.max(18, 50 - this.elapsed * .45);
      this.hazards.push({ x: 35 + Math.random() * 880, y: -40, vx: (Math.random() - .5) * 2, vy: 4 + Math.random() * 3, w: 30 + Math.random() * 24, h: 30 + Math.random() * 24, type: 'rock' });
    }
    for (const hazard of this.hazards) {
      hazard.x += hazard.vx * dt; hazard.y += hazard.vy * dt;
      if (!hazard.hit && this._overlap(this.player, hazard)) {
        hazard.hit = true;
        if (this.player.shield) { this.avoided++; this.score += 4; }
        else { this.player.hp--; this.player.vy = -7; this.score = Math.max(0, this.score - 8); }
      }
      if (!hazard.hit && hazard.y > 540) { hazard.hit = true; this.avoided++; this.score += 2; }
    }
    this.hazards = this.hazards.filter(hazard => !hazard.hit);
    if (this.player.hp <= 0) this.finish(false);
  },

  _updateHud() {
    const remaining = Math.max(0, Math.ceil((this.course?.duration || 0) - this.elapsed));
    document.getElementById('practice-game-time').textContent = `${remaining}`;
    const status = this.courseKey === 'desert' ? `モノリス破壊 ${this.targets.filter(t => t.destroyed).length}/${this.targets.length}　落下 ${this.pitFalls || 0}回`
      : this.courseKey === 'jungle' ? `仕掛け ${this.switchProgress || 0}/3`
      : this.courseKey === 'coast' ? `命中 ${this.hits}　COMBO ${this.combo}`
      : this.courseKey === 'snow' ? `高度 ${Math.max(0, Math.round((500 - this.player.y) / 10))}m`
      : `耐久 ♥${this.player.hp}　防御 ${this.avoided}`;
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
    else normalized = Math.min(100, this.elapsed / this.course.duration * 75 + this.avoided * 2 + (this.player.hp > 0 ? 10 : 0));
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
    const offsetY = -this.cameraY;
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
    ctx.fillStyle='#fff58a'; this.projectiles.forEach(shot=>ctx.fillRect(shot.x,shot.y,shot.w,shot.h));
    const p = this.player;
    ctx.save();
    if (p.facing < 0) { ctx.translate(p.x + p.w, 0); ctx.scale(-1,1); ctx.translate(-p.x,0); }
    if (this.sprite?.complete && this.sprite.naturalWidth) ctx.drawImage(this.sprite, p.x - 18, p.y - 25, p.w + 36, p.h + 30);
    else { ctx.fillStyle='#b048d0';ctx.fillRect(p.x,p.y,p.w,p.h); }
    ctx.restore();
    if (p.shield) { ctx.strokeStyle='#82eaff';ctx.lineWidth=5;ctx.beginPath();ctx.arc(p.x+p.w/2,p.y+p.h/2,45,0,Math.PI*2);ctx.stroke(); }
    if (p.attackTimer > 7 && this.courseKey !== 'coast') { ctx.fillStyle='rgba(255,245,120,.5)';ctx.fillRect(p.facing>0?p.x+p.w:p.x-76,p.y+8,76,58); }
    if (this.courseKey === 'jungle' && this.switchProgress >= 3) { ctx.fillStyle='#8dfff0';ctx.fillRect(900,390,35,95); }
    if (this.courseKey === 'snow') { ctx.fillStyle='rgba(210,245,255,.75)';ctx.fillRect(0,this.avalancheY,960,260); }
    ctx.restore();
  },

  _overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; },
  escape(value) { const div = document.createElement('div'); div.textContent = String(value || ''); return div.innerHTML; },
};

window.PracticeGame = PracticeGame;

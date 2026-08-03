const PRACTICE_COURSES = {
  desert: { name: 'マンディー砂漠', stat: 'power', statLabel: 'ちから', color: '#d79b43', duration: 55, description: '岩や石像をすべて破壊する' },
  jungle: { name: 'パレパレジャングル', stat: 'intelligence', statLabel: 'かしこさ', color: '#4eaa56', duration: 65, description: '仕掛けを解いて最深部へ進む' },
  coast: { name: 'トーブル海岸', stat: 'accuracy', statLabel: '命中', color: '#42b7dd', duration: 50, description: '動くターゲットを正確に狙う' },
  snow: { name: 'パパス雪山', stat: 'evasion', statLabel: '回避', color: '#a9dcf2', duration: 65, description: '崩れる足場を登り山頂を目指す' },
  volcano: { name: 'カウレア火山', stat: 'defense', statLabel: '丈夫さ', color: '#e45b35', duration: 50, description: '火山弾と溶岩から生き残る', level: 10 },
};

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
  keys: { left: false, right: false, jump: false, attack: false, shield: false },
  previousAttack: false,
  previousJump: false,

  init() {
    this.canvas = document.getElementById('practice-canvas');
    this.ctx = this.canvas.getContext('2d');
    document.getElementById('practice-course-list').addEventListener('click', event => {
      const button = event.target.closest('[data-practice-course]');
      if (button && !button.disabled) this.start(button.dataset.practiceCourse, this.monster, false);
    });
    document.getElementById('practice-quit').addEventListener('click', () => this.quit());
    document.getElementById('practice-result-close').addEventListener('click', () => this.closeResult());

    const setKey = (key, value) => { if (key in this.keys) this.keys[key] = value; };
    const keyboardMap = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ' ': 'jump', z: 'attack', Z: 'attack', a: 'attack', A: 'attack', Shift: 'shield' };
    window.addEventListener('keydown', event => {
      if (!this.active || !keyboardMap[event.key]) return;
      event.preventDefault();
      setKey(keyboardMap[event.key], true);
    });
    window.addEventListener('keyup', event => {
      if (!keyboardMap[event.key]) return;
      setKey(keyboardMap[event.key], false);
    });
    document.querySelectorAll('[data-practice-control]').forEach(button => {
      const key = button.dataset.practiceControl;
      const release = event => { event.preventDefault(); setKey(key, false); };
      button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); setKey(key, true); });
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('pointerleave', release);
    });
  },

  openSelection(monster) {
    if (!monster) return;
    this.stop();
    this.admin = false;
    this.monster = monster;
    document.getElementById('practice-select-panel').classList.remove('hidden');
    document.getElementById('practice-game-panel').classList.add('hidden');
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
    this.active = true;
    this.frame = 0;
    this.elapsed = 0;
    this.lastTime = performance.now();
    this.previousAttack = false;
    this.previousJump = false;
    Object.keys(this.keys).forEach(key => { this.keys[key] = false; });
    this.player = { x: 70, y: 410, vx: 0, vy: 0, w: 44, h: 68, facing: 1, onGround: false, attackTimer: 0, shield: false, hp: 3, hazardCooldown: 0 };
    this.cameraY = 0;
    this.score = 0;
    this.hits = 0;
    this.misses = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.avoided = 0;
    this._loadSprite();
    this._setupCourse();
    document.getElementById('practice-select-panel').classList.add('hidden');
    document.getElementById('practice-game-panel').classList.remove('hidden');
    document.getElementById('practice-result-modal').classList.add('hidden');
    document.getElementById('practice-game-title').textContent = `${course.name}${admin ? '（管理者テスト）' : ''}`;
    this._updateHud();
    this.raf = requestAnimationFrame(time => this.loop(time));
  },

  _loadSprite() {
    const def = FIGHTERS[this.monster.baseFighterKey] || FIGHTERS.irumine;
    this.sprite = window.PreloadedImages?.get(def.idleImage) || new Image();
    if (!this.sprite.src) this.sprite.src = def.idleImage;
  },

  _setupCourse() {
    this.platforms = [{ x: 0, y: 485, w: 960, h: 55 }];
    this.targets = [];
    this.projectiles = [];
    this.hazards = [];
    if (this.courseKey === 'desert') {
      [[160,435,1],[285,405,2],[415,435,1],[545,380,3],[690,435,2],[830,400,3]].forEach(([x,y,hp], id) => this.targets.push({ id, x, y, w: 42 + hp * 7, h: 50 + hp * 8, hp, maxHp: hp }));
      this.platforms.push({ x: 500, y: 440, w: 150, h: 16 });
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
    if (p.hazardCooldown > 0) p.hazardCooldown = Math.max(0, p.hazardCooldown - dt);
    p.shield = this.keys.shield;
    const speed = p.shield ? 1.5 : 4.5;
    if (this.keys.left !== this.keys.right) {
      p.vx = (this.keys.left ? -speed : speed);
      p.facing = this.keys.left ? -1 : 1;
    } else p.vx *= Math.pow(.72, dt);
    const jumpPressed = this.keys.jump && !this.previousJump;
    if (jumpPressed && p.onGround) { p.vy = -11.5; p.onGround = false; }
    this.previousJump = this.keys.jump;
    const attackPressed = this.keys.attack && !this.previousAttack;
    this.previousAttack = this.keys.attack;
    if (attackPressed && p.attackTimer <= 0 && !p.shield) {
      p.attackTimer = 14;
      if (this.courseKey === 'coast') this._fireCoastShot();
      else this._strike();
    }
    if (p.attackTimer > 0) p.attackTimer -= dt;
    const previousBottom = p.y + p.h;
    p.vy = Math.min(13, p.vy + .55 * dt);
    p.x = Math.max(0, Math.min(960 - p.w, p.x + p.vx * dt));
    p.y += p.vy * dt;
    p.onGround = false;
    for (const platform of this.platforms) {
      if (platform.gone) continue;
      if (p.x + p.w > platform.x && p.x < platform.x + platform.w && p.vy >= 0 && previousBottom <= platform.y + 8 && p.y + p.h >= platform.y) {
        p.y = platform.y - p.h; p.vy = 0; p.onGround = true;
        if (platform.crumbles) { platform.touched += dt; if (platform.touched > 42) platform.gone = true; }
      }
    }
    if (this.courseKey === 'jungle') this._updateJungle(dt);
    if (this.courseKey === 'coast') this._updateCoast(dt);
    if (this.courseKey === 'snow') this._updateSnow(dt);
    if (this.courseKey === 'volcano') this._updateVolcano(dt);
    if (this.courseKey !== 'snow' && p.y > 570) { p.x = 60; p.y = 390; p.vx = p.vy = 0; this.score = Math.max(0, this.score - 5); }
    if (this.elapsed >= this.course.duration) this.finish(false);
  },

  _strike() {
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
      } else {
        target.hp--; this.score += 6;
        if (target.hp <= 0) { target.destroyed = true; this.score += 8; }
      }
    }
    if (!hit && this.courseKey === 'desert') this.score = Math.max(0, this.score - 1);
    if (this.courseKey === 'desert' && this.targets.every(target => target.destroyed)) this.finish(true);
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
    const status = this.courseKey === 'desert' ? `破壊 ${this.targets.filter(t => t.destroyed).length}/${this.targets.length}`
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
    if (this.courseKey === 'desert') normalized = this.targets.filter(t => t.destroyed).length / this.targets.length * 75 + (cleared ? Math.max(0, 25 - this.elapsed / this.course.duration * 15) : 0);
    else if (this.courseKey === 'jungle') normalized = this.switchProgress / 3 * 65 + (cleared ? 35 : 0);
    else if (this.courseKey === 'coast') normalized = Math.min(100, this.hits * 4 + this.bestCombo * 3 - this.misses * 2);
    else if (this.courseKey === 'snow') normalized = Math.min(100, this.score + (cleared ? 15 : 0));
    else normalized = Math.min(100, this.elapsed / this.course.duration * 75 + this.avoided * 2 + (this.player.hp > 0 ? 10 : 0));
    normalized = Math.max(0, Math.round(normalized));
    const grade = normalized >= 90 ? 'S' : normalized >= 75 ? 'A' : normalized >= 55 ? 'B' : normalized >= 30 ? 'C' : 'D';
    let growthText = '管理者テストのため能力値は変化しません';
    if (!this.admin && this.monster.id) {
      const growth = GROWTH.applyPracticeResult(this.monster, this.course.stat, grade);
      MasmonStore.update(this.monster);
      growthText = `${this.course.statLabel} +${growth[this.course.stat]}　ライフ +${growth.life}`;
    }
    document.getElementById('practice-result-grade').textContent = grade;
    document.getElementById('practice-result-title').textContent = cleared ? `${this.course.name} 修行成功！` : `${this.course.name} 修行終了`;
    document.getElementById('practice-result-score').textContent = `評価スコア ${normalized}／100`;
    document.getElementById('practice-result-growth').textContent = growthText;
    document.getElementById('practice-result-modal').classList.remove('hidden');
  },

  quit() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    if (this.admin) AppFlow.showScreen('debug');
    else this.openSelection(this.monster);
  },

  closeResult() {
    document.getElementById('practice-result-modal').classList.add('hidden');
    if (this.admin) AppFlow.showScreen('debug');
    else this.openSelection(this.monster);
  },

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
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
    if (this.courseKey === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      for (let i = 0; i < 35; i++) ctx.fillRect((i * 83 + this.frame) % 960, (i * 57 + this.frame * 1.5) % 540, 4, 4);
    }
    ctx.save(); ctx.translate(0, offsetY);
    for (const platform of this.platforms) {
      if (platform.gone) continue;
      ctx.fillStyle = this.courseKey === 'snow' ? '#e8f8ff' : this.courseKey === 'volcano' ? '#34242a' : '#5b4937';
      ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
      ctx.fillStyle = this.courseKey === 'snow' ? '#8bd5ef' : '#d8aa5a'; ctx.fillRect(platform.x, platform.y, platform.w, 4);
    }
    for (const target of this.targets) {
      if (!target || target.destroyed) continue;
      if (target.switch) { ctx.fillStyle = target.active ? '#7dff75' : '#ffd54f'; ctx.fillRect(target.x, target.y, target.w, target.h); ctx.fillStyle = '#14202a'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(target.id, target.x + 12, target.y + 35); }
      else if (target.target) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(target.x + target.w/2, target.y + target.h/2, target.w/2, 0, Math.PI*2); ctx.fill(); ctx.fillStyle='#ff3d45'; ctx.beginPath(); ctx.arc(target.x+target.w/2,target.y+target.h/2,9,0,Math.PI*2);ctx.fill(); }
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

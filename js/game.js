// ==== メインループ ====
// このファイルは画面遷移(flow.js)から window.startBattle(options) が
// 呼ばれた時点で初めてバトルの初期化・ループ開始を行う。
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const input = new InputManager();
const vpad = new VirtualPad(document.getElementById('game-container'));
// 修行ミニゲームなど他画面からも同じ仮想パッド／キーボード入力を再利用できるようにする
window.SharedInput = input;
window.SharedVPad = vpad;

const blastBounds = {
  left: -CONFIG.BLAST_MARGIN,
  right: CONFIG.CANVAS_W + CONFIG.BLAST_MARGIN,
  top: -CONFIG.BLAST_MARGIN,
  bottom: CONFIG.CANVAS_H + CONFIG.BLAST_MARGIN,
};

let players = [];
let cpuControllers = [];
let loopStarted = false;
let projectiles = [];
let battlePaused = false;
let battleInputLocked = false;
const networkProjectileSprites = new Map();
const SIMULATION_STEP_MS = 1000 / 60;
const MAX_SIMULATION_STEPS = 5;
let lastLoopTime = 0;
let simulationAccumulator = 0;
let lastNetworkProjectileCount = 0;
let lastNetworkExplosionCount = 0;
let survivalBattle = null;
let spawnSurvivalCpu = null;
let currentBattleOptions = null;
let lastSurvivalCheckpointAt = 0;
const survivalCounter = document.getElementById('battle-survival-counter');
const suspendButton = document.getElementById('battle-suspend-btn');

const SURVIVAL_SAVE_VERSION = 1;
const SURVIVAL_FIGHTER_STATE_KEYS = [
  'x','y','vx','vy','facing','onGround','damagePercent','stocks','dead','tumbling','tumbleRotation',
  'downed','shielding','shieldHP','dazedTimer','dodgeTimer','dodgeType','invincible','isMoving','isDashing',
  'attackTimer','recoveryTimer','hitstun','jumpFrames','jumpCutDone','jumpsUsed','jumpAnimTimer',
  'idleAnimTimer','idleAnimFrame','animTimer','animFrame','helpless','kos','falls','selfDestructs',
  'eliminatedAt','dropThroughTimer','ledgeCooldown','ledgeHangFrames','ledgeLocked','onLedge',
  '_usedUpSpecialAirborne','_airDodgeUsed','survivalHandled','survivalCpuLevel',
  // スマブラ的な挙動用の状態（中断・再開で手応えが変わらないよう保存する）
  'hitlag','landingLag','fastFalling','techWindow','techLockout','staleQueue',
];

function survivalSaveKey(mode, uid) {
  return `smamon_survival_${uid || 'guest'}_${mode}`;
}

function currentSurvivalUid() {
  return window.AppFlow?.currentUser?.uid || 'guest';
}

const SurvivalRunStore = {
  load(mode, uid) {
    try {
      const data = JSON.parse(localStorage.getItem(survivalSaveKey(mode, uid)) || 'null');
      return data && data.version === SURVIVAL_SAVE_VERSION && data.survival?.mode === mode ? data : null;
    } catch (_) { return null; }
  },
  clear(mode, uid) {
    try { localStorage.removeItem(survivalSaveKey(mode, uid)); } catch (_) { /* ignore */ }
  },
};
window.SurvivalRunStore = SurvivalRunStore;

function saveSurvivalCheckpoint(force = false) {
  if (!survivalBattle || !currentBattleOptions || window._matchOver || (!force && battleInputLocked)) return false;
  const now = Date.now();
  if (!force && now - lastSurvivalCheckpointAt < 500) return false;
  const { resumeState, ...cleanOptions } = currentBattleOptions;
  const data = {
    version: SURVIVAL_SAVE_VERSION,
    savedAt: now,
    options: cleanOptions,
    survival: { mode: survivalBattle.mode, defeated: survivalBattle.defeated, finished: survivalBattle.finished },
    fighters: players.map((fighter, fighterIndex) => ({
      id: fighter.id,
      fighterKey: fighter.fighterKey,
      name: fighter.name,
      color: fighter.color,
      stats: { ...fighter.stats },
      stockIconSrc: fighter.stockIconSrc,
      knockbackTakenMultiplier: fighter.knockbackTakenMultiplier,
      currentMoveKey: networkMoveKey(fighter),
      lastAttackerIndex: players.indexOf(fighter.lastAttacker),
      ...Object.fromEntries(SURVIVAL_FIGHTER_STATE_KEYS.map(key => [key, fighter[key]])),
    })),
    projectiles: projectiles.map(projectile => ({
      x: projectile.x, y: projectile.y, vx: projectile.vx, vy: projectile.vy,
      w: projectile.w, h: projectile.h, life: projectile.life, hit: projectile.hit,
      exploding: projectile.exploding, config: projectile.config,
      spritePath: projectile.move?.projectileSprite || null,
      moveKey: moveKeyFor(projectile.owner, projectile.move),
      ownerIndex: players.indexOf(projectile.owner),
    })),
    cpuControllers: cpuControllers.map(controller => ({
      decisionCooldown: controller.decisionCooldown,
      currentIntent: { ...controller.currentIntent },
    })),
  };
  try {
    localStorage.setItem(survivalSaveKey(survivalBattle.mode, currentSurvivalUid()), JSON.stringify(data));
    lastSurvivalCheckpointAt = now;
    return true;
  } catch (error) {
    console.warn('連戦データを保存できませんでした:', error);
    return false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveSurvivalCheckpoint(true);
});
window.addEventListener('pagehide', () => saveSurvivalCheckpoint(true));

const pauseButton = document.getElementById('battle-pause-btn');
const pauseOverlay = document.getElementById('battle-pause-overlay');
pauseButton.addEventListener('click', () => {
  if (window._matchOver || battleInputLocked) return;
  battlePaused = !battlePaused;
  pauseButton.textContent = battlePaused ? '▶' : 'Ⅱ';
  pauseOverlay.classList.toggle('hidden', !battlePaused);
});
suspendButton.addEventListener('click', event => {
  event.stopPropagation();
  if (!survivalBattle) return;
  saveSurvivalCheckpoint(true);
  battlePaused = true;
  window._matchOver = true;
  players = [];
  cpuControllers = [];
  projectiles = [];
  survivalBattle = null;
  spawnSurvivalCpu = null;
  survivalCounter?.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  AppFlow.showScreen('home');
});

window.setBattleInputLocked = locked => { battleInputLocked = !!locked; };

// 毎フレームの一時オブジェクト生成を避けるための使い回し
const PROJECTILE_HIT = { projectile: true };
const _projectileBox = { x: 0, y: 0, w: 0, h: 0 };
function projectileBox(p) {
  _projectileBox.x = p.x; _projectileBox.y = p.y; _projectileBox.w = p.w; _projectileBox.h = p.h;
  return _projectileBox;
}

function updateProjectiles() {
  for (const owner of players) {
    const request = owner.consumeProjectileRequest();
    if (!request) continue;
    const cfg = request.config;
    const spritePath = request.move.projectileSprite;
    const sprite = spritePath ? (window.PreloadedImages?.get(spritePath) || new Image()) : null;
    if (sprite && !sprite.src) sprite.src = spritePath;
    if (spritePath && spritePath.includes('/arrow.') && window.AudioManager) AudioManager.playSe('arrow');
    projectiles.push({ owner, move: request.move, sprite, config: cfg,
      x: owner.facing === 1 ? owner.x + owner.w : owner.x - cfg.width,
      y: owner.y + owner.h * 0.42, vx: owner.facing * cfg.speed,
      vy: 0, w: cfg.width, h: cfg.height, life: cfg.lifetime, hit: false, exploding: 0 });
  }
  for (const p of projectiles) {
    if (p.exploding > 0) {
      p.exploding--;
      if (p.exploding <= 0) p.hit = true;
      continue;
    }
    const isBomb = p.config.type === 'bomb';
    const previousBottom = p.y + p.h;
    p.x += p.vx;
    if (isBomb) {
      p.vy += p.config.gravity || 0.25;
      p.y += p.vy;
      for (const platform of Stage.platforms) {
        const surfaceY = platform.surfaceY != null ? platform.surfaceY : platform.y;
        const withinX = p.x + p.w > platform.x && p.x < platform.x + platform.w;
        if (withinX && p.vy >= 0 && previousBottom <= surfaceY + 3 && p.y + p.h >= surfaceY) {
          p.y = surfaceY - p.h;
          p.vy = 0;
          p.vx *= p.config.groundFriction || 0.985;
          break;
        }
      }
    }
    p.life--;
    if (isBomb && p.life <= 0) {
      const radius = p.config.explosionRadius || 90;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      for (const target of players) {
        if (target === p.owner || target.dead) continue;
        if (survivalBattle && p.owner !== players[0] && target !== players[0]) continue;
        const tx = target.x + target.w / 2, ty = target.y + target.h / 2;
        if (Math.hypot(tx - cx, ty - cy) <= radius) target.takeHit(p.owner, p.move, PROJECTILE_HIT);
      }
      p.exploding = 12;
      if (window.AudioManager) AudioManager.playSe('bomb');
      p.vx = 0;
      p.vy = 0;
      continue;
    }
    if (isBomb) continue;
    for (const target of players) {
      if (target === p.owner || target.dead || p.hit) continue;
      if (survivalBattle && p.owner !== players[0] && target !== players[0]) continue;
      if (Physics.rectsOverlap(projectileBox(p), target.getHurtbox())) {
        target.takeHit(p.owner, p.move, PROJECTILE_HIT);
        p.hit = true;
      }
    }
  }
  projectiles = projectiles.filter(p => !p.hit && (p.life > 0 || p.exploding > 0) &&
    p.x > blastBounds.left && p.x < blastBounds.right && p.y < blastBounds.bottom);
}

function drawProjectiles() {
  for (const p of projectiles) {
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
    if (p.sprite && p.sprite.complete && p.sprite.naturalWidth > 0) {
      ctx.drawImage(p.sprite, -p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
      continue;
    }
    if (p.config.type === 'bomb') {
      ctx.fillStyle = '#27232f'; ctx.strokeStyle = '#ffb02e'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = Math.floor(p.life / 10) % 2 ? '#ff3b30' : '#ffe66d';
      ctx.beginPath(); ctx.arc(5, -8, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.strokeStyle = '#ffe88a'; ctx.fillStyle = '#fff4bd'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-p.w / 2, 0); ctx.lineTo(p.w / 2 - 8, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.w / 2, 0); ctx.lineTo(p.w / 2 - 12, -7); ctx.lineTo(p.w / 2 - 12, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function checkAttacks() {
  for (const attacker of players) {
    // ヒットストップ中は判定を止める（止まっている間に当たり続けないようにする）
    if (attacker.dead || attacker.hitlag > 0) continue;
    const hb = attacker.getHitbox();
    if (!hb) continue;
    // 技の参照は先に控えておく。ジャストガードを取られると攻撃側の技はその場で中断されるため、
    // ループ途中で attacker.currentMove が null になりうる。
    const move = attacker.currentMove;
    for (const target of players) {
      if (target === attacker || target.dead) continue;
      if (survivalBattle && attacker !== players[0] && target !== players[0]) continue;
      // 1つの判定ウィンドウにつき同じ相手には1回だけ。乱闘では重なった全員に当たる。
      if (attacker.hasHitTarget(target)) continue;
      if (Physics.rectsOverlap(hb, target.getHurtbox())) {
        attacker.markHitTarget(target);
        target.takeHit(attacker, move);
        // 技が中断された（ジャストガードされた）場合、残りの相手には当たらない
        if (attacker.currentMove !== move) break;
      }
    }
  }
}

function resolveFighterCollisions() {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      if (a.dead || b.dead || a.grabbedBy || b.grabbedBy || !Physics.rectsOverlap(a.getHurtbox(), b.getHurtbox())) continue;

      const aBottom = a.y + a.h, bBottom = b.y + b.h;
      const aWasAbove = a.y < b.y && a.vy >= 0 && aBottom - a.vy <= b.y + 12;
      const bWasAbove = b.y < a.y && b.vy >= 0 && bBottom - b.vy <= a.y + 12;
      if (aWasAbove || bWasAbove) {
        const top = aWasAbove ? a : b;
        const bottom = aWasAbove ? b : a;
        top.y = bottom.y - top.h;
        const centerDifference = Math.abs((top.x + top.w / 2) - (bottom.x + bottom.w / 2));
        const directStomp = centerDifference <= Math.min(top.w, bottom.w) * 0.38;
        if (directStomp) {
          top.vy = -Math.max(7, Math.abs(top.vy) * 0.8);
          top.onGround = false;
        } else {
          top.vy = 0;
          top.onGround = true;
        }
        continue;
      }

      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (overlapX <= 0) continue;
      const aIsLeft = a.x + a.w / 2 <= b.x + b.w / 2;
      const separation = overlapX / 2 + 0.1;
      a.x += aIsLeft ? -separation : separation;
      b.x += aIsLeft ? separation : -separation;
      if ((aIsLeft && a.vx > 0) || (!aIsLeft && a.vx < 0)) a.vx = 0;
      if ((aIsLeft && b.vx < 0) || (!aIsLeft && b.vx > 0)) b.vx = 0;
    }
  }
}

// 掴みの成立判定（距離・向き・状態をチェックしてFighter同士を紐付ける）
function checkGrabs() {
  for (const grabber of players) {
    if (!grabber.consumeGrabRequest()) continue;
    if (grabber.dead || grabber.grabbing || grabber.grabbedBy) continue;

    for (const target of players) {
      if (target === grabber || target.dead) continue;
      if (survivalBattle && grabber !== players[0] && target !== players[0]) continue;
      if (target.grabbedBy || target.downed || target.invincible > 0 || target.dodgeTimer > 0) continue;

      const dx = target.x - grabber.x;
      const facingMatches = (dx >= 0 && grabber.facing === 1) || (dx < 0 && grabber.facing === -1);
      const withinRange = Math.abs(dx) <= grabber.grabRange;
      const sameLevel = Math.abs(target.y - grabber.y) < 60;

      if (facingMatches && withinRange && sameLevel) {
        grabber.grabbing = target;
        target.grabbedBy = grabber;
        grabber.grabTimer = CONFIG.GRAB_RELEASE_TIMEOUT_FRAMES;
        target.vx = 0;
        target.vy = 0;
        target.hitstun = 0;
        target.attackTimer = 0;
        target.currentMove = null;
        break;
      }
    }
  }
}

// 崖掴まりの成立判定（メイン足場の左右端に近づいたら掴む）
function checkLedges() {
  const mainPlatform = Stage.platforms[0];
  const ledges = [
    { x: mainPlatform.x, edge: 'left' },
    { x: mainPlatform.x + mainPlatform.w, edge: 'right' },
  ];

  for (const p of players) {
    if (p.dead || p.onGround || p.onLedge || p.grabbedBy || p.grabbing || p.ledgeCooldown > 0 || p.ledgeLocked) continue;
    if (p.vy < 0) continue; // 上昇中は掴まない（下降中〜頂点以降のみ）

    for (const ledge of ledges) {
      const px = p.x + p.w / 2;
      const dx = Math.abs(px - ledge.x);
      const mainSurfaceY = mainPlatform.surfaceY != null ? mainPlatform.surfaceY : mainPlatform.y;
      const dy = Math.abs(p.y - mainSurfaceY);
      if (dx < CONFIG.LEDGE_GRAB_RANGE_X && dy < CONFIG.LEDGE_GRAB_RANGE_Y) {
        p.grabLedge(ledge, mainPlatform);
        break;
      }
    }
  }
}

// HUDは毎フレーム更新されるため、以前のように innerHTML を丸ごと組み直すと
// 60fpsでDOM全体の再生成＋レイアウトが走り、無視できない負荷になっていた。
// ここでは構造を1度だけ作り、以降は変化した値だけを書き換える。
let hudRefs = [];
let hudSignature = '';

function buildHUD() {
  hud.dataset.count = String(players.length);
  hud.innerHTML = players.map(p => {
    const iconStyle = (p.sprite && p.spriteLoaded)
      ? `background:${p.color} url(${p.sprite.src}) center bottom/contain no-repeat`
      : `background:${p.color}`; // 未読込ならまず色だけ。読み込み後にupdateHUD()が差し替える
    return `
      <div class="phud" style="--fighter-color:${p.color}">
        <div class="phud-icon" style="${iconStyle}"></div>
        <div class="phud-info">
          <div class="phud-topline"><span class="phud-player"></span><div class="phud-stocks"></div></div>
          <div class="phud-percent">0<span class="pct-sign">%</span></div>
          <div class="phud-shield-bar"><div class="phud-shield-fill"></div></div>
          <div class="phud-name"></div>
        </div>
      </div>
    `;
  }).join('');
  hudRefs = Array.from(hud.children).map(node => ({
    root: node,
    stocks: node.querySelector('.phud-stocks'),
    percent: node.querySelector('.phud-percent'),
    shield: node.querySelector('.phud-shield-fill'),
    name: node.querySelector('.phud-name'),
    label: node.querySelector('.phud-player'),
    lastStocks: -1,
    lastDamage: -1,
    lastTone: '',
    lastShield: -1,
    iconApplied: false,
    icon: node.querySelector('.phud-icon'),
  }));
  hudRefs.forEach((ref, index) => {
    const p = players[index];
    ref.label.textContent = p.hudLabel || p.id.toUpperCase();
    ref.name.textContent = p.name;
  });
}

function updateHUD() {
  // 参加者の顔ぶれが変わった時だけ組み直す（連戦でCPUが入れ替わる場合など）
  const signature = players.map(p => `${p.id}|${p.name}|${p.color}`).join(',');
  if (signature !== hudSignature) {
    hudSignature = signature;
    buildHUD();
  }
  for (let i = 0; i < hudRefs.length; i++) {
    const ref = hudRefs[i];
    const p = players[i];
    if (!p) continue;
    const stocks = Math.max(0, p.stocks);
    if (stocks !== ref.lastStocks) {
      ref.lastStocks = stocks;
      const style = p.stockIconSrc ? `background-image:url('${p.stockIconSrc}')` : '';
      ref.stocks.innerHTML = stocks
        ? `<span class="phud-stock-dot" style="${style}"></span>`.repeat(stocks) : '';
    }
    const damage = Math.floor(p.damagePercent);
    if (damage !== ref.lastDamage) {
      ref.lastDamage = damage;
      ref.percent.firstChild.nodeValue = String(damage);
      const tone = damage >= 120 ? 'danger' : damage >= 60 ? 'warning' : 'normal';
      if (tone !== ref.lastTone) {
        if (ref.lastTone) ref.percent.classList.remove(ref.lastTone);
        ref.percent.classList.add(tone);
        ref.lastTone = tone;
      }
    }
    // アイコン画像は読み込み完了後に一度だけ差し込む（構築時にはまだ未読込のことがある）
    if (!ref.iconApplied && p.sprite && p.spriteLoaded) {
      ref.iconApplied = true;
      ref.icon.style.background = `${p.color} url(${p.sprite.src}) center bottom/contain no-repeat`;
    }
    const shield = Math.max(0, Math.round(p.shieldHP));
    if (shield !== ref.lastShield) {
      ref.lastShield = shield;
      ref.shield.style.width = `${shield}%`;
    }
  }
}

function computeRanking() {
  const alive = players.filter(p => !p.dead).sort((a, b) => b.stocks - a.stocks || a.damagePercent - b.damagePercent);
  const dead = players.filter(p => p.dead).sort((a, b) => b.eliminatedAt - a.eliminatedAt);
  return [...alive, ...dead].map((p, idx) => ({
    fighterIndex: players.indexOf(p),
    rank: idx + 1,
    name: p.name,
    color: p.color,
    spriteSrc: p.sprite ? p.sprite.src : null,
    kos: p.kos,
    falls: p.falls,
    selfDestructs: p.selfDestructs,
  }));
}

function checkMatchEnd() {
  if (survivalBattle) {
    if (typeof survivalBattle.finished === 'boolean' && !window._matchOver) {
      finishSurvivalBattle(survivalBattle.finished);
      return;
    }
    const p1 = players[0];
    if (p1.dead && !window._matchOver) {
      finishSurvivalBattle(false);
      return;
    }
    players.slice(1).forEach((fighter, index) => {
      if (window._matchOver) return;
      if (!fighter.dead || fighter.survivalHandled) return;
      fighter.survivalHandled = true;
      survivalBattle.defeated++;
      if (survivalBattle.mode === 'hundred' && survivalBattle.defeated >= 100) {
        finishSurvivalBattle(true);
        return;
      }
      setTimeout(() => {
        if (!window._matchOver && survivalBattle && spawnSurvivalCpu) spawnSurvivalCpu(index + 1);
      }, 450);
    });
    updateSurvivalCounter();
    return;
  }
  const alive = players.filter(p => !p.dead);
  if (alive.length <= 1 && !window._matchOver) {
    window._matchOver = true;
    setTimeout(() => {
      try {
        const ranking = computeRanking();
        if (window.AppFlow && AppFlow.onMatchEnd) {
          AppFlow.onMatchEnd({ ranking });
        } else {
          console.error('AppFlow.onMatchEnd が見つかりません。リザルト画面へ遷移できません。');
        }
      } catch (e) {
        // ここで例外が起きるとリザルト画面へ遷移できないまま止まってしまうため、
        // 必ずログに残す（サイレントに握りつぶさない）
        console.error('リザルト画面への遷移中にエラーが発生しました:', e);
      }
    }, 800);
  }
}

let lastSurvivalCounterText = '';
function updateSurvivalCounter() {
  if (!survivalCounter || !survivalBattle) return;
  survivalCounter.classList.remove('hidden');
  // 毎フレーム呼ばれるため、表示が変わった時だけ書き換える（不要な再レイアウトを避ける）
  const text = survivalBattle.mode === 'hundred'
    ? `撃破 ${Math.min(100, survivalBattle.defeated)} / 100`
    : `撃破 ${survivalBattle.defeated}`;
  if (text !== lastSurvivalCounterText) {
    lastSurvivalCounterText = text;
    survivalCounter.textContent = text;
  }
}

function finishSurvivalBattle(cleared) {
  if (window._matchOver || !survivalBattle) return;
  survivalBattle.finished = !!cleared;
  saveSurvivalCheckpoint(true);
  window._matchOver = true;
  const p1 = players[0];
  const result = {
    ranking: [{ fighterIndex: 0, rank: cleared ? 1 : 2, name: p1.name, color: p1.color,
      spriteSrc: p1.sprite?.src || null, kos: survivalBattle.defeated,
      falls: p1.falls, selfDestructs: p1.selfDestructs }],
    survival: { mode: survivalBattle.mode, defeated: survivalBattle.defeated, cleared },
  };
  setTimeout(() => {
    try {
      SurvivalRunStore.clear(survivalBattle.mode, currentSurvivalUid());
      AppFlow.onMatchEnd(result);
    } catch (error) { console.error('連戦リザルトへの遷移に失敗しました:', error); }
  }, 700);
}

function createNetworkSnapshot() {
  const fighterKeys = [
    'x','y','vx','vy','facing','onGround','damagePercent','stocks','dead','tumbling','tumbleRotation',
    'downed','shielding','shieldHP','dazedTimer','dodgeTimer','invincible','isMoving','attackTimer',
    'recoveryTimer','jumpAnimTimer','idleAnimTimer','idleAnimFrame','animTimer','animFrame',
    'helpless','kos','falls','selfDestructs','eliminatedAt',
    'hitlag','hitlagShakeX','landingLag',
  ];
  return {
    fighters: players.map(fighter => ({
      ...Object.fromEntries(fighterKeys.map(key => [key, fighter[key]])),
      currentMoveKey: networkMoveKey(fighter),
    })),
    projectiles: projectiles.map(projectile => ({
      x: projectile.x, y: projectile.y, vx: projectile.vx, vy: projectile.vy,
      w: projectile.w, h: projectile.h, life: projectile.life, hit: projectile.hit,
      exploding: projectile.exploding, config: projectile.config,
      spritePath: projectile.move && projectile.move.projectileSprite,
    })),
  };
}

function networkMoveKey(fighter) {
  return moveKeyFor(fighter, fighter && fighter.currentMove);
}

// 技を文字列キーへ変換（通信/中断セーブ用）。
// 以前はファイター固有のmoveSetしか探しておらず、共通の技テーブル(MOVES)を使う技が
// 復元できずモーションと当たり判定が失われていたため、両方を対象にする。
function moveKeyFor(fighter, targetMove) {
  if (!targetMove) return null;
  if (fighter) {
    for (const [groupKey, group] of Object.entries(fighter.moveSet || {})) {
      for (const [moveKey, moveDef] of Object.entries(group || {})) {
        if (moveDef === targetMove) return `set:${groupKey}:${moveKey}`;
      }
    }
  }
  for (const [groupKey, group] of Object.entries(MOVES)) {
    for (const [moveKey, moveDef] of Object.entries(group)) {
      if (moveDef === targetMove) return `base:${groupKey}:${moveKey}`;
    }
  }
  for (const [moveKey, moveDef] of Object.entries(THROWS)) {
    if (moveDef === targetMove) return `throw:${moveKey}`;
  }
  return null; // 溜めスマッシュなど動的生成された技は復元不能
}

function resolveNetworkMove(fighter, key) {
  if (!key) return null;
  const parts = key.split(':');
  if (parts[0] === 'set') return fighter?.moveSet?.[parts[1]]?.[parts[2]] || null;
  if (parts[0] === 'base') return MOVES[parts[1]]?.[parts[2]] || null;
  if (parts[0] === 'throw') return THROWS[parts[1]] || null;
  // 旧フォーマット（groupKey:moveKey）との互換
  return fighter?.moveSet?.[parts[0]]?.[parts[1]] || null;
}

function applyNetworkSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.fighters)) return;
  snapshot.fighters.forEach((state, index) => {
    const fighter = players[index];
    if (!fighter || !state) return;
    const { currentMoveKey, ...values } = state;
    Object.assign(fighter, values);
    fighter.currentMove = resolveNetworkMove(fighter, currentMoveKey);
  });
  if (Array.isArray(snapshot.projectiles)) {
    const nextExplosionCount = snapshot.projectiles.filter(state => state.exploding > 0).length;
    if (snapshot.projectiles.length > lastNetworkProjectileCount &&
        snapshot.projectiles.some(state => String(state.spritePath || '').includes('/arrow.')) && window.AudioManager) {
      AudioManager.playSe('arrow');
    }
    if (nextExplosionCount > lastNetworkExplosionCount && window.AudioManager) AudioManager.playSe('bomb');
    lastNetworkProjectileCount = snapshot.projectiles.length;
    lastNetworkExplosionCount = nextExplosionCount;
    projectiles = snapshot.projectiles.map(state => {
      let sprite = null;
      if (state.spritePath) {
        sprite = window.PreloadedImages?.get(state.spritePath) || networkProjectileSprites.get(state.spritePath);
        if (!sprite) { sprite = new Image(); sprite.src = state.spritePath; networkProjectileSprites.set(state.spritePath, sprite); }
      }
      return { ...state, sprite, owner: null, move: { projectileSprite: state.spritePath } };
    });
  }
}

function runAuthoritativeSimulationStep(p1Input, network) {
  if (network === 'host') {
    players.forEach((fighter, index) => {
      if (fighter.isNetworkCpu) return;
      fighter.applyInput(index === Multiplayer.localPlayerIndex ? p1Input : Multiplayer.getRemoteInput(index));
    });
  } else {
    players[0].applyInput(p1Input);
    if (!cpuControllers.length && players[1]) players[1].applyInput(input.getPlayer2Input());
  }

  if (cpuControllers.length) {
    cpuControllers.forEach(controller => {
      const candidates = survivalBattle
        ? [players[0]].filter(p => p && !p.dead)
        : players.filter(p => p !== controller.fighter && !p.dead);
      if (!candidates.length) return;
      controller.opponent = candidates.reduce((nearest, candidate) =>
        Math.abs(candidate.x - controller.fighter.x) < Math.abs(nearest.x - controller.fighter.x) ? candidate : nearest);
      controller.fighter.applyInput(controller.decide(blastBounds));
    });
  }

  for (const p of players) p.update(Stage.platforms, blastBounds);
  resolveFighterCollisions();
  checkLedges();
  checkGrabs();
  checkAttacks();
  updateProjectiles();
  checkMatchEnd();
  if (network === 'host') Multiplayer.broadcastState(createNetworkSnapshot());
}

function loop(timestamp) {
  // 万一この中で想定外の例外が起きても、それによってrequestAnimationFrameの連鎖が
  // 途切れて「敵を倒してもリザルト画面に進まない」ような無言のフリーズが起きないようにする。
  try {
    const now = Number.isFinite(timestamp) ? timestamp : performance.now();
    if (!lastLoopTime) lastLoopTime = now;
    const elapsed = Math.max(0, Math.min(100, now - lastLoopTime));
    lastLoopTime = now;
    if (players.length && !window._matchOver && !battlePaused && !battleInputLocked) {
      const p1Input = mergeInputs(input.getPlayer1Input(), vpad.getState());
      const network = window.Multiplayer && Multiplayer.role;
      if (network === 'guest') {
        simulationAccumulator = 0;
        Multiplayer.sendLocalInput(p1Input);
        applyNetworkSnapshot(Multiplayer.consumeLatestState());
      } else {
        simulationAccumulator += elapsed;
        let steps = 0;
        while (simulationAccumulator >= SIMULATION_STEP_MS && steps < MAX_SIMULATION_STEPS) {
          runAuthoritativeSimulationStep(p1Input, network);
          simulationAccumulator -= SIMULATION_STEP_MS;
          steps++;
        }
        saveSurvivalCheckpoint();
        if (steps === MAX_SIMULATION_STEPS && simulationAccumulator >= SIMULATION_STEP_MS) simulationAccumulator = 0;
      }
    } else {
      simulationAccumulator = 0;
    }

    ctx.clearRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    Stage.drawBackground(ctx); // 背景はカメラのズーム/パンの影響を受けない固定表示
    if (players.length) Camera.update(players);
    ctx.save();
    Camera.apply(ctx);
    Stage.draw(ctx); // 足場・ブラストラインはカメラに追従する
    for (const p of players) p.draw(ctx);
    drawProjectiles();
    ctx.restore();
    updateHUD();
  } catch (e) {
    console.error('バトルループ内でエラーが発生しました:', e);
  }

  requestAnimationFrame(loop);
}

// flow.js から呼ばれるバトル開始処理
// options: { stageKey, p1Key, p2Key }
window.startBattle = function startBattle(options) {
  currentBattleOptions = options;
  lastSurvivalCheckpointAt = 0;
  const stageData = STAGES[options.stageKey] || STAGES[Object.keys(STAGES)[0]];
  Stage.load(stageData.key);

  const p1Def = FIGHTERS[options.p1Key] || FIGHTERS.irumine;
  const cpuSelections = options.cpuFighters?.length
    ? options.cpuFighters.slice(0, 3)
    : [{ fighterKey: options.p2Key, masmonId: options.p2MasmonId }];

  const p1Masmon = options.p1MasmonId
    ? MasmonStore.loadAll().find(m => m.id === options.p1MasmonId)
    : null;

  function buildOptions(def, masmon) {
    return {
      fighterKey: def.key,
      grabRange: def.grabRange,
      name: masmon ? masmon.name : def.displayName,
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

  function resolveStats(def, masmon) {
    if (masmon) {
      return GROWTH.computeStatsAtLevel(
        { ...defaultStats(), trainingStats: masmon.trainingStats },
        masmon.aptitudes,
        masmon.level,
      );
    }
    return def.stats ? { ...defaultStats(), ...def.stats } : defaultStats();
  }

  function applyCpuLevelStats(stats, def, masmon, cpuLevel) {
    const level = Math.max(1, Math.min(9, Number(cpuLevel) || 3));
    const aptitudes = masmon && masmon.aptitudes
      ? masmon.aptitudes
      : GROWTH.aptitudesFor(def.key);
    // AIレベル1は補正なし。1段階ごとにマスモン約3レベル分の成長を加える。
    // 高レベルCPUは判断力だけでなく、適性に沿った能力値でも育成済みマスモンへ対抗する。
    const growthLevels = (level - 1) * 3;
    const adjusted = {};
    for (const key of GROWTH.STAT_KEYS) {
      const rank = aptitudes[key] || 'C';
      const growth = GROWTH.RANK_GROWTH_PER_LEVEL[rank] || GROWTH.RANK_GROWTH_PER_LEVEL.C;
      adjusted[key] = Math.max(1, Math.min(GROWTH.STAT_MAX, Math.round((stats[key] || 1) + growth * growthLevels)));
    }
    return adjusted;
  }

  // 管理者モードのバトルテスト用：算出済みステータスを手入力値で上書きする。
  // options.statOverrides = { p1: {life,power,...}, cpu: {...} }（未指定のキーは通常計算のまま）
  function applyStatOverrides(stats, override) {
    if (!override) return stats;
    const result = { ...stats };
    for (const key of GROWTH.STAT_KEYS) {
      const value = Number(override[key]);
      if (Number.isFinite(value)) result[key] = Math.max(1, Math.min(GROWTH.STAT_MAX, Math.round(value)));
    }
    return result;
  }

  window._matchOver = false;
  survivalBattle = null;
  spawnSurvivalCpu = null;
  survivalCounter?.classList.add('hidden');
  projectiles = [];
  lastNetworkProjectileCount = 0;
  lastNetworkExplosionCount = 0;
  battlePaused = false;
  battleInputLocked = true;
  simulationAccumulator = 0;
  lastLoopTime = performance.now();
  pauseButton.textContent = 'Ⅱ';
  pauseOverlay.classList.add('hidden');
  suspendButton.classList.add('hidden');
  if (options.mode === 'multi' && Array.isArray(options.multiplayerRoster)) {
    players = options.multiplayerRoster.slice(0, 4).map((entry, index) => {
      const def = FIGHTERS[entry.fighterKey] || FIGHTERS.irumine;
      const masmon = {
        name: entry.name || def.displayName,
        level: Math.max(1, Number(entry.level) || 1),
        trainingStats: { ...(entry.trainingStats || {}) },
        aptitudes: { ...(entry.aptitudes || GROWTH.aptitudesFor(def.key)) },
      };
      const baseStats = resolveStats(def, masmon);
      const stats = entry.isCpu ? applyCpuLevelStats(baseStats, def, masmon, 9) : baseStats;
      const fighter = new Fighter(`player${index + 1}`, stats, def.color,
        Stage.spawnPoints[index] || Stage.spawnPoints[0], buildOptions(def, masmon));
      fighter.hudLabel = entry.isCpu ? `CPU${index + 1}` : `${index + 1}P`;
      fighter.playerUid = entry.playerUid;
      fighter.isNetworkCpu = !!entry.isCpu;
      return fighter;
    });
  } else {
    players = [new Fighter('p1', applyStatOverrides(resolveStats(p1Def, p1Masmon), options.statOverrides?.p1),
      p1Def.color, Stage.spawnPoints[0], buildOptions(p1Def, p1Masmon))];
    const isSurvival = options.mode === 'cpu' && ['hundred', 'endless'].includes(options.cpuMode);
    if (isSurvival) {
      suspendButton.classList.remove('hidden');
      players[0].stocks = 3;
      survivalBattle = { mode: options.cpuMode, defeated: 0 };
      const candidates = [
        ...MasmonStore.loadAll().filter(monster => monster.id !== options.p1MasmonId && FIGHTERS[monster.baseFighterKey])
          .map(monster => ({ fighterKey: monster.baseFighterKey, masmon: monster })),
        ...Object.values(FIGHTERS).filter(def => def.key !== options.p1Key)
          .map(def => ({ fighterKey: def.key, masmon: null })),
      ];
      if (!candidates.length) candidates.push({ fighterKey: options.p2Key, masmon: null });

      spawnSurvivalCpu = (slot, initial = false) => {
        const choice = candidates[Math.floor(Math.random() * candidates.length)];
        const def = FIGHTERS[choice.fighterKey] || FIGHTERS.dullahan || FIGHTERS.irumine;
        const progress = options.cpuMode === 'hundred'
          ? Math.min(1, survivalBattle.defeated / 99)
          : Math.min(1, survivalBattle.defeated / 80);
        const cpuLevel = Math.max(1, Math.min(9, 1 + Math.floor(progress * 8)));
        const stats = applyCpuLevelStats(resolveStats(def, choice.masmon), def, choice.masmon, cpuLevel);
        const fighterOptions = buildOptions(def, choice.masmon);
        fighterOptions.knockbackTakenMultiplier = 1.85 - progress * 0.85;
        const fighter = new Fighter(`cpu${slot}`, stats, def.color,
          Stage.spawnPoints[slot] || Stage.spawnPoints[1] || Stage.spawnPoints[0], fighterOptions);
        fighter.stocks = 1;
        fighter.hudLabel = `CPU${slot}`;
        fighter.survivalCpuLevel = cpuLevel;
        players[slot] = fighter;
        if (!initial) cpuControllers[slot - 1] = new CPUController(fighter, players[0], cpuLevel);
      };
      for (let slot = 1; slot <= options.cpuCount; slot++) spawnSurvivalCpu(slot, true);
      const resume = options.resumeState;
      if (resume && resume.version === SURVIVAL_SAVE_VERSION && Array.isArray(resume.fighters)) {
        survivalBattle.defeated = Math.max(0, Number(resume.survival?.defeated) || 0);
        survivalBattle.finished = typeof resume.survival?.finished === 'boolean' ? resume.survival.finished : undefined;
        players = resume.fighters.map((saved, index) => {
          const def = FIGHTERS[saved.fighterKey] || (index === 0 ? p1Def : FIGHTERS.dullahan) || FIGHTERS.irumine;
          const fighterOptions = buildOptions(def, null);
          fighterOptions.name = saved.name || def.displayName;
          fighterOptions.stockIconSrc = saved.stockIconSrc || def.stockIcon;
          fighterOptions.knockbackTakenMultiplier = saved.knockbackTakenMultiplier || 1;
          const fighter = new Fighter(saved.id || (index ? `cpu${index}` : 'p1'),
            saved.stats || resolveStats(def, null), saved.color || def.color,
            Stage.spawnPoints[index] || Stage.spawnPoints[0], fighterOptions);
          Object.assign(fighter, Object.fromEntries(
            SURVIVAL_FIGHTER_STATE_KEYS.filter(key => saved[key] !== undefined).map(key => [key, saved[key]])));
          fighter.currentMove = resolveNetworkMove(fighter, saved.currentMoveKey);
          return fighter;
        });
        resume.fighters.forEach((saved, index) => {
          players[index].lastAttacker = players[saved.lastAttackerIndex] || null;
        });
        projectiles = (resume.projectiles || []).map(saved => {
          const owner = players[saved.ownerIndex] || players[0];
          const move = resolveNetworkMove(owner, saved.moveKey) || { projectileSprite: saved.spritePath, statKey: 'power', dmgBase: 1, kbBase: 1, angle: 20 };
          const sprite = saved.spritePath ? (window.PreloadedImages?.get(saved.spritePath) || new Image()) : null;
          if (sprite && !sprite.src) sprite.src = saved.spritePath;
          return { ...saved, owner, move, sprite };
        });
        players.slice(1).forEach((fighter, index) => {
          if (fighter.dead && fighter.survivalHandled) setTimeout(() => spawnSurvivalCpu(index + 1), 120);
        });
      }
      updateSurvivalCounter();
    } else cpuSelections.forEach((selection, index) => {
      const def = FIGHTERS[selection.fighterKey] || FIGHTERS.dullahan || FIGHTERS.irumine;
      const masmon = selection.masmonId
        ? MasmonStore.loadAll().find(m => m.id === selection.masmonId)
        : null;
      const baseStats = resolveStats(def, masmon);
      const leveledStats = options.mode === 'cpu'
        ? applyCpuLevelStats(baseStats, def, masmon, options.cpuLevel)
        : baseStats;
      players.push(new Fighter(`cpu${index + 1}`,
        applyStatOverrides(leveledStats, options.statOverrides?.cpu),
        def.color, Stage.spawnPoints[index + 1] || Stage.spawnPoints[0], buildOptions(def, masmon)));
    });
    players[0].hudLabel = '1P';
    players.slice(1).forEach((fighter, index) => { fighter.hudLabel = options.mode === 'cpu' ? `CPU${index + 1}` : `${index + 2}P`; });
  }

  // カメラを両者のスポーン中間点にリセット（前の試合の位置から急に飛ぶのを防ぐ）
  const activeSpawns = Stage.spawnPoints.slice(0, players.length);
  const midX = activeSpawns.reduce((sum, point) => sum + point.x, 0) / activeSpawns.length;
  const midY = activeSpawns.reduce((sum, point) => sum + point.y, 0) / activeSpawns.length;
  Camera.reset(midX, midY);

  cpuControllers = options.mode === 'multi'
    ? players.filter(fighter => fighter.isNetworkCpu).map(fighter => new CPUController(fighter, players[0], 9))
    : options.mode === 'cpu'
      ? players.slice(1).map(fighter => new CPUController(fighter, players[0], fighter.survivalCpuLevel || options.cpuLevel || 3))
      : [];

  if (options.resumeState?.cpuControllers) {
    options.resumeState.cpuControllers.forEach((saved, index) => {
      const controller = cpuControllers[index];
      if (!controller || !saved) return;
      controller.decisionCooldown = Math.max(0, Number(saved.decisionCooldown) || 0);
      controller.currentIntent = { ...controller._blankInput(), ...(saved.currentIntent || {}) };
    });
  }

  if (!loopStarted) {
    loopStarted = true;
    loop();
  }
};

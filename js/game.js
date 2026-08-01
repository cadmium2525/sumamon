// ==== メインループ ====
// このファイルは画面遷移(flow.js)から window.startBattle(options) が
// 呼ばれた時点で初めてバトルの初期化・ループ開始を行う。
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const input = new InputManager();
const vpad = new VirtualPad(document.getElementById('game-container'));

const blastBounds = {
  left: -CONFIG.BLAST_MARGIN,
  right: CONFIG.CANVAS_W + CONFIG.BLAST_MARGIN,
  top: -CONFIG.BLAST_MARGIN,
  bottom: CONFIG.CANVAS_H + CONFIG.BLAST_MARGIN,
};

let players = [];
let cpuController = null;
let loopStarted = false;

function checkAttacks() {
  for (const attacker of players) {
    const hb = attacker.getHitbox();
    if (!hb || attacker.hasHitThisAttack) continue;
    for (const target of players) {
      if (target === attacker || target.dead) continue;
      if (Physics.rectsOverlap(hb, target.getHurtbox())) {
        target.takeHit(attacker, attacker.currentMove);
        attacker.hasHitThisAttack = true;
      }
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
      if (target.grabbedBy || target.invincible > 0 || target.dodgeTimer > 0) continue;

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

function updateHUD() {
  hud.innerHTML = players.map(p => {
    const stockDots = Array.from({ length: Math.max(0, p.stocks) })
      .map(() => `<span class="phud-stock-dot"></span>`).join('');
    const shieldPct = Math.max(0, Math.floor(p.shieldHP));
    const iconStyle = (p.sprite && p.spriteLoaded)
      ? `background:${p.color} url(${p.sprite.src}) center/cover no-repeat`
      : `background:${p.color}`;
    return `
      <div class="phud" style="color:${p.color}; border-color:${p.color}">
        <div class="phud-icon" style="${iconStyle}"></div>
        <div class="phud-info">
          <div class="phud-name">${p.name}</div>
          <div class="phud-percent">${Math.floor(p.damagePercent)}<span class="pct-sign">%</span></div>
          <div class="phud-stocks">${stockDots}</div>
          <div class="phud-shield-bar"><div class="phud-shield-fill" style="width:${shieldPct}%"></div></div>
        </div>
      </div>
    `;
  }).join('');
}

function computeRanking() {
  const alive = players.filter(p => !p.dead);
  const dead = players.filter(p => p.dead);
  return [...alive, ...dead].map((p, idx) => ({
    fighterIndex: players.indexOf(p),
    rank: idx + 1,
    name: p.name,
    color: p.color,
    spriteSrc: p.sprite ? p.sprite.src : null,
  }));
}

function checkMatchEnd() {
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

function loop() {
  // 万一この中で想定外の例外が起きても、それによってrequestAnimationFrameの連鎖が
  // 途切れて「敵を倒してもリザルト画面に進まない」ような無言のフリーズが起きないようにする。
  try {
    if (players.length && !window._matchOver) {
      const p1Input = mergeInputs(input.getPlayer1Input(), vpad.getState());
      players[0].applyInput(p1Input);

      const p2Input = cpuController ? cpuController.decide(blastBounds) : input.getPlayer2Input();
      players[1].applyInput(p2Input);

      for (const p of players) p.update(Stage.platforms, blastBounds);
      checkLedges();
      checkGrabs();
      checkAttacks();
      checkMatchEnd();
    }

    ctx.clearRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
    Stage.drawBackground(ctx); // 背景はカメラのズーム/パンの影響を受けない固定表示
    if (players.length) Camera.update(players);
    ctx.save();
    Camera.apply(ctx);
    Stage.draw(ctx); // 足場・ブラストラインはカメラに追従する
    for (const p of players) p.draw(ctx);
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
  const stageData = STAGES[options.stageKey] || STAGES[Object.keys(STAGES)[0]];
  Stage.load(stageData.key);

  const p1Def = FIGHTERS[options.p1Key] || FIGHTERS.irumine;
  const p2Def = FIGHTERS[options.p2Key] || FIGHTERS.aodoragon;

  function buildOptions(def) {
    return {
      grabRange: def.grabRange,
      name: def.displayName,
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
    };
  }

  function resolveP1Stats() {
    if (options.p1MasmonId) {
      const record = MasmonStore.loadAll().find(m => m.id === options.p1MasmonId);
      if (record) {
        return GROWTH.computeStatsAtLevel(defaultStats(), record.aptitudes, record.level);
      }
    }
    return p1Def.stats ? { ...defaultStats(), ...p1Def.stats } : defaultStats();
  }

  window._matchOver = false;
  players = [
    new Fighter('p1', resolveP1Stats(),
      p1Def.color, Stage.spawnPoints[0], buildOptions(p1Def)),
    new Fighter('p2', p2Def.stats ? { ...defaultStats(), ...p2Def.stats } : defaultStats(),
      p2Def.color, Stage.spawnPoints[1], buildOptions(p2Def)),
  ];

  // カメラを両者のスポーン中間点にリセット（前の試合の位置から急に飛ぶのを防ぐ）
  const midX = (Stage.spawnPoints[0].x + Stage.spawnPoints[1].x) / 2;
  const midY = (Stage.spawnPoints[0].y + Stage.spawnPoints[1].y) / 2;
  Camera.reset(midX, midY);

  cpuController = (options.mode === 'cpu')
    ? new CPUController(players[1], players[0], options.cpuLevel || 3)
    : null;

  if (!loopStarted) {
    loopStarted = true;
    loop();
  }
};

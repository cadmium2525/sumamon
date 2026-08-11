// cadmium専用の管理者画面。
const DebugMotionViewer = {
  rafId: null,
  startedAt: 0,
  imageCache: new Map(),

  init() {
    this.canvas = document.getElementById('debug-motion-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.fighterSelect = document.getElementById('debug-fighter-select');
    this.motionSelect = document.getElementById('debug-motion-select');
    this.fighterSelect.innerHTML = Object.values(FIGHTERS)
      .map(f => `<option value="${f.key}">${f.displayName}</option>`).join('');
    this.fighterSelect.addEventListener('change', () => this.buildMotionList());
    this.motionSelect.addEventListener('change', () => this.restart());
    document.querySelectorAll('[data-admin-tab]').forEach(button => {
      button.addEventListener('click', () => this.switchTab(button.dataset.adminTab));
    });
    this.buildAudioList();
    this.setupToolLink();
    document.getElementById('admin-player-refresh').addEventListener('click', () => this.loadPlayerActivity());
    document.getElementById('admin-gacha-save').addEventListener('click', () => this.saveGachaPickup(false));
    document.getElementById('admin-gacha-clear').addEventListener('click', () => this.saveGachaPickup(true));

    // 修行テスト：どのfighterで試すか選べるようにする
    const practiceFighterSelect = document.getElementById('debug-practice-fighter-select');
    practiceFighterSelect.innerHTML = Object.values(FIGHTERS)
      .map(f => `<option value="${f.key}">${f.displayName}</option>`).join('');
    document.querySelectorAll('[data-admin-practice]').forEach(button => {
      button.addEventListener('click', () => window.PracticeGame?.startAdmin(button.dataset.adminPractice, practiceFighterSelect.value));
    });

    // バトルテスト：実際のCPU戦を直接開始してモーション・技を本番同様に確認する
    const p1Select = document.getElementById('debug-battle-p1-select');
    const p2Select = document.getElementById('debug-battle-p2-select');
    const levelSelect = document.getElementById('debug-battle-level-select');
    const fighterOptions = Object.values(FIGHTERS).map(f => `<option value="${f.key}">${f.displayName}</option>`).join('');
    p1Select.innerHTML = fighterOptions;
    p2Select.innerHTML = fighterOptions;
    if (Object.keys(FIGHTERS).length > 1) p2Select.selectedIndex = 1;
    levelSelect.innerHTML = Array.from({ length: 9 }, (_, i) => i + 1)
      .map(lvl => `<option value="${lvl}" ${lvl === 5 ? 'selected' : ''}>Lv.${lvl}</option>`).join('');
    // ステータス調整：P1・CPUそれぞれの能力値を自由に書き換えて対戦できるようにする
    this.battleSelects = { p1: p1Select, p2: p2Select, level: levelSelect };
    this.buildStatEditor();
    [p1Select, p2Select, levelSelect].forEach(select => {
      select.addEventListener('change', () => this.fillDefaultStats());
    });
    document.getElementById('debug-battle-stat-reset').addEventListener('click', () => this.fillDefaultStats());

    document.getElementById('debug-battle-start').addEventListener('click', () => {
      if (!window.AppFlow) return;
      window.AppFlow.lastLaunchOptions = {
        statOverrides: this.readStatOverrides(),
        stageKey: Object.keys(STAGES)[0],
        p1Key: p1Select.value,
        p2Key: p2Select.value,
        p1MasmonId: null,
        p2MasmonId: null,
        cpuCount: 1,
        cpuFighters: [{ fighterKey: p2Select.value, masmonId: null }],
        mode: 'cpu',
        cpuMode: 'normal',
        cpuLevel: Number(levelSelect.value) || 5,
      };
      window.AppFlow.playBattleIntro(window.AppFlow.lastLaunchOptions);
    });

    this.buildMotionList();
  },

  STAT_LABELS: {
    life: 'ライフ', power: 'ちから', intelligence: 'かしこさ',
    accuracy: '命中', evasion: '回避', defense: '丈夫さ',
  },

  // ステータス欄は数値を直接打ち込むと手間がかかるため、
  // ±100 / ±10 のボタンと、片側まとめて書き換えるボタンを添える。
  _statCellHtml(side, key) {
    const id = `debug-stat-${side}-${key}`;
    return `<span class="admin-stat-cell">
      <button type="button" class="admin-stat-step" data-step-for="${id}" data-step="-100">-100</button>
      <button type="button" class="admin-stat-step" data-step-for="${id}" data-step="-10">-10</button>
      <input id="${id}" type="number" min="1" max="${GROWTH.STAT_MAX}" data-stat-side="${side}" data-stat-key="${key}">
      <button type="button" class="admin-stat-step" data-step-for="${id}" data-step="10">+10</button>
      <button type="button" class="admin-stat-step" data-step-for="${id}" data-step="100">+100</button>
    </span>`;
  },

  _statBulkHtml(side, label) {
    return `<span class="admin-stat-col">${label}
      <span class="admin-stat-bulk">
        <button type="button" data-bulk-side="${side}" data-bulk="max">全${GROWTH.STAT_MAX}</button>
        <button type="button" data-bulk-side="${side}" data-bulk="min">全最低</button>
        <button type="button" data-bulk-side="${side}" data-bulk="default">既定</button>
      </span></span>`;
  },

  buildStatEditor() {
    const grid = document.getElementById('debug-battle-stat-grid');
    grid.innerHTML = `<span class="admin-stat-corner"></span>${this._statBulkHtml('p1', 'P1')}${this._statBulkHtml('cpu', 'CPU')}` +
      GROWTH.STAT_KEYS.map(key => `
        <label for="debug-stat-p1-${key}">${this.STAT_LABELS[key]}</label>
        ${this._statCellHtml('p1', key)}
        ${this._statCellHtml('cpu', key)}
      `).join('');

    // 組み直しのたびにリスナーが増えると1回の操作が二重に効いてしまうため、
    // 中身を差し替えても消えないgrid側には一度だけ登録する。
    if (grid.dataset.bound !== '1') {
      grid.dataset.bound = '1';
      grid.addEventListener('click', event => {
        const step = event.target.closest('[data-step-for]');
        if (step) {
          const input = document.getElementById(step.dataset.stepFor);
          if (input) this._setStat(input, (Number(input.value) || 0) + Number(step.dataset.step));
          return;
        }
        const bulk = event.target.closest('[data-bulk-side]');
        if (bulk) this.applyBulkStats(bulk.dataset.bulkSide, bulk.dataset.bulk);
      });
    }
    this.fillDefaultStats();
  },

  _setStat(input, value) {
    input.value = Math.max(1, Math.min(GROWTH.STAT_MAX, Math.round(Number(value) || 1)));
  },

  // 片側のステータスをまとめて書き換える。
  // ライフだけは基準値が異なるため、最低値でも他ステータスと同じ1にはしない。
  applyBulkStats(side, kind) {
    if (kind === 'default') {
      const stats = side === 'p1'
        ? this._baseStatsFor(this.battleSelects.p1.value)
        : this._cpuStatsFor(this.battleSelects.p2.value, this.battleSelects.level.value);
      for (const key of GROWTH.STAT_KEYS) {
        const input = document.getElementById(`debug-stat-${side}-${key}`);
        if (input) this._setStat(input, stats[key]);
      }
      return;
    }
    const defaults = defaultStats();
    for (const key of GROWTH.STAT_KEYS) {
      const input = document.getElementById(`debug-stat-${side}-${key}`);
      if (input) this._setStat(input, kind === 'max' ? GROWTH.STAT_MAX : defaults[key]);
    }
  },

  // game.js の resolveStats() / applyCpuLevelStats() と同じ計算で既定値を求める
  _baseStatsFor(fighterKey) {
    const def = FIGHTERS[fighterKey] || Object.values(FIGHTERS)[0];
    return def.stats ? { ...defaultStats(), ...def.stats } : defaultStats();
  },

  _cpuStatsFor(fighterKey, cpuLevel) {
    const def = FIGHTERS[fighterKey] || Object.values(FIGHTERS)[0];
    const stats = this._baseStatsFor(fighterKey);
    const aptitudes = GROWTH.aptitudesFor(def.key);
    const growthLevels = (Math.max(1, Math.min(9, Number(cpuLevel) || 3)) - 1) * 3;
    const adjusted = {};
    for (const key of GROWTH.STAT_KEYS) {
      const growth = GROWTH.RANK_GROWTH_PER_LEVEL[aptitudes[key] || 'C'] || GROWTH.RANK_GROWTH_PER_LEVEL.C;
      adjusted[key] = Math.max(1, Math.min(GROWTH.STAT_MAX, Math.round((stats[key] || 1) + growth * growthLevels)));
    }
    return adjusted;
  },

  fillDefaultStats() {
    if (!this.battleSelects) return;
    const p1Stats = this._baseStatsFor(this.battleSelects.p1.value);
    const cpuStats = this._cpuStatsFor(this.battleSelects.p2.value, this.battleSelects.level.value);
    for (const key of GROWTH.STAT_KEYS) {
      const p1Input = document.getElementById(`debug-stat-p1-${key}`);
      const cpuInput = document.getElementById(`debug-stat-cpu-${key}`);
      if (p1Input) p1Input.value = p1Stats[key];
      if (cpuInput) cpuInput.value = cpuStats[key];
    }
  },

  readStatOverrides() {
    const overrides = { p1: {}, cpu: {} };
    document.querySelectorAll('#debug-battle-stat-grid input[data-stat-key]').forEach(input => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || input.value === '') return;
      overrides[input.dataset.statSide][input.dataset.statKey] =
        Math.max(1, Math.min(GROWTH.STAT_MAX, Math.round(value)));
    });
    return overrides;
  },

  // スタジオの絶対URLを表示する。
  // アドレスバーにはドメインしか出ないため、パスまで含めた形をここで確認・コピーできるようにする。
  setupToolLink() {
    const text = document.getElementById('admin-tool-url-text');
    const copy = document.getElementById('admin-tool-url-copy');
    if (!text || !copy) return;
    const url = new URL('tools/', location.href).href;
    text.textContent = url;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        copy.textContent = 'コピーしました';
      } catch (error) {
        copy.textContent = '長押しで選択してコピーしてください';
      }
      setTimeout(() => { copy.textContent = 'URLをコピー'; }, 2200);
    });
  },

  // BGM/SE確認：AudioManagerの登録内容から一覧を自動生成する。
  // 曲を追加してもここを触る必要はなく、AudioManager.tracks に足すだけで並ぶ。
  buildAudioList() {
    const bgmList = document.getElementById('admin-bgm-list');
    const seList = document.getElementById('admin-se-list');
    if (!bgmList || !window.AudioManager) return;
    const tracks = AudioManager.listTracks();
    bgmList.innerHTML = tracks.map(track => `
      <button data-admin-bgm="${track.key}">
        <strong>${this.escape(track.label)}</strong>
        <small data-bgm-state="${track.key}">${track.loaded ? '再生' : '読み込み中…'}</small>
      </button>`).join('') + '<button data-admin-bgm="stop" class="admin-audio-stop">■ 停止</button>';
    seList.innerHTML = '<span class="admin-audio-heading">効果音</span>' +
      AudioManager.listEffects().map(effect => `
      <button data-admin-se="${effect.key}"><strong>${this.escape(effect.label)}</strong><small>再生</small></button>`).join('');

    bgmList.querySelectorAll('[data-admin-bgm]').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.dataset.adminBgm;
        if (key === 'stop') { AudioManager.stopBgm(); this.markPlayingBgm(null); return; }
        AudioManager.playBgm(key);
        this.markPlayingBgm(key);
      });
    });
    seList.querySelectorAll('[data-admin-se]').forEach(button => {
      button.addEventListener('click', () => AudioManager.playSe(button.dataset.adminSe));
    });
    this.refreshAudioLoadState();
  },

  markPlayingBgm(key) {
    document.querySelectorAll('#admin-bgm-list [data-admin-bgm]').forEach(button => {
      button.classList.toggle('playing', button.dataset.adminBgm === key);
    });
  },

  // 読み込みが終わった曲の表示を「再生」に切り替える（読み込みは非同期のため）
  refreshAudioLoadState() {
    if (!window.AudioManager) return;
    let pending = false;
    AudioManager.listTracks().forEach(track => {
      const label = document.querySelector(`[data-bgm-state="${track.key}"]`);
      if (!label) return;
      if (track.loaded) label.textContent = '再生';
      else { label.textContent = '読み込み中…'; pending = true; }
    });
    if (pending) setTimeout(() => this.refreshAudioLoadState(), 700);
  },

  renderGachaSettings() {
    if (!window.GACHA) return;
    const select = document.getElementById('admin-gacha-fighter');
    select.innerHTML = Object.values(FIGHTERS).map(fighter =>
      `<option value="${fighter.key}">${this.escape(fighter.displayName)}</option>`).join('');
    const automatic = GACHA.automaticPickupKey();
    const current = GACHA.pickupKey();
    if (current) select.value = current;
    const currentDef = FIGHTERS[current];
    const autoDef = FIGHTERS[automatic];
    const untilInput = document.getElementById('admin-gacha-until');
    if (GACHA.pickupSource() === 'manual' && GACHA.manualPickup?.until) {
      const date = new Date(GACHA.manualPickup.until);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      untilInput.value = local.toISOString().slice(0, 16);
    } else {
      untilInput.value = '';
    }
    document.getElementById('admin-gacha-current').textContent = current
      ? `現在：${currentDef?.displayName || current}（${GACHA.pickupSource() === 'manual' ? '手動指定' : '自動'}）／ 自動候補：${autoDef?.displayName || 'なし'}`
      : '現在のピックアップはありません';
  },

  async saveGachaPickup(clear) {
    const status = document.getElementById('admin-gacha-status');
    status.textContent = '保存しています…';
    try {
      const key = clear ? '' : document.getElementById('admin-gacha-fighter').value;
      const raw = document.getElementById('admin-gacha-until').value;
      const until = !clear && raw ? new Date(raw).getTime() : 0;
      if (until && until <= Date.now()) throw new Error('終了日時は現在より後にしてください');
      await GACHA.savePickupConfig(key, until);
      status.textContent = clear ? '手動指定を解除しました' : 'ピックアップを設定しました';
      this.renderGachaSettings();
    } catch (error) {
      status.textContent = `保存できませんでした：${error.message || error}`;
    }
  },

  switchTab(tabName) {
    document.querySelectorAll('[data-admin-tab]').forEach(button => button.classList.toggle('active', button.dataset.adminTab === tabName));
    document.querySelectorAll('[data-admin-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.adminPane !== tabName));
    if (tabName === 'motion') this.restart();
    else {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (tabName === 'players') this.loadPlayerActivity();
    if (tabName === 'bgm') this.refreshAudioLoadState();
    if (tabName === 'gacha') this.renderGachaSettings();
  },

  async loadPlayerActivity() {
    const list = document.getElementById('admin-player-list');
    const count = document.getElementById('admin-player-count');
    list.innerHTML = '<div class="admin-player-empty">読み込み中…</div>';
    const records = await PlayerActivityStore.loadAll();
    count.textContent = `${records.length}プレイヤー`;
    if (!records.length) {
      list.innerHTML = '<div class="admin-player-empty">プレイ状況データがありません</div>';
      return;
    }
    const now = Date.now();
    const screenLabels = {
      start: 'スタート', home: 'ホーム', mypage: 'マイページ', 'cpu-mode': 'CPUモード選択',
      'stage-select': 'ステージ選択', 'fighter-select': 'モンスター選択', 'cpu-level': 'CPUレベル選択',
      battle: 'バトル中', result: 'リザルト', training: 'トレーニング', 'masmon-manage': 'マスモン管理',
      'multi-menu': 'マルチメニュー', 'multi-lobby': 'マルチロビー', gacha: 'ガチャ', 'item-shop': 'アイテム交換所', debug: '管理者モード',
    };
    list.innerHTML = records.map(record => {
      const seen = Number(record.lastSeenAt) || 0;
      const online = now - seen < 125000;
      // 画面側と同じ引き方にしておかないと、新しいモンスターを選んだ人だけ
      // 管理者一覧でイルミネに見える、という食い違いが起きる
      const icon = window.AppFlow ? AppFlow._profileIconSrc(record.iconKey)
        : (FIGHTERS[record.iconKey]?.stockIcon || FIGHTERS.irumine?.stockIcon || '');
      return `<article class="admin-player-row">
        <img src="${icon}" alt=""><span><strong>${this.escape(record.nickname || record.username || '名称未設定')}</strong><small>@${this.escape(record.username || 'unknown')}</small></span>
        <span><b class="${online ? 'online' : 'offline'}">${online ? 'オンライン' : 'オフライン'}</b><small>${this.escape(screenLabels[record.screen] || record.screen || '不明')}${record.mode ? ` / ${this.escape(record.mode)}` : ''}</small></span>
        <span><small>最終ログイン</small><time>${this.formatDate(record.lastLoginAt)}</time><small>最終アクセス ${this.formatDate(seen)}</small></span>
      </article>`;
    }).join('');
  },

  escape(value) {
    const div = document.createElement('div');
    div.textContent = String(value || '');
    return div.innerHTML;
  },

  formatDate(value) {
    const time = Number(value) || 0;
    return time ? new Date(time).toLocaleString('ja-JP') : '記録なし';
  },

  _motionsFor(fighter) {
    const motions = [];
    // 待機のコマは animations.idle にある（古いデータは idleFrameSrcs）。
    // FighterData 側で両方を見るようにまとめてある。
    const idleFrames = FighterData.idleFrames(fighter);
    if (idleFrames.length) {
      const idleAnimation = fighter.animations && fighter.animations.idle;
      const idleBox = (idleAnimation && idleAnimation.contentBox)
        || fighter.idleFrameContentBox || fighter.spriteContentBox;
      motions.push({ key: 'idle', label: '待機', type: 'frames', frames: idleFrames,
        duration: FighterData.idleFrameDuration(fighter), box: idleBox,
        frameBoxes: (idleAnimation && idleAnimation.frameContentBoxes) || null, loop: true });
    }
    if (fighter.walkSheetSrc) {
      motions.push({ key: 'walk', label: '歩行', type: 'sheet', src: fighter.walkSheetSrc,
        cols: fighter.walkSheetCols, rows: fighter.walkSheetRows, count: fighter.walkFrameCount,
        duration: fighter.walkFrameDuration || 4, box: fighter.walkFrameContentBox, loop: true });
    }
    if (fighter.jumpFrameSrcs && fighter.jumpFrameSrcs.length) {
      motions.push({ key: 'jump', label: 'ジャンプ', type: 'frames', frames: fighter.jumpFrameSrcs,
        duration: fighter.jumpFrameDuration || 5, box: fighter.jumpFrameContentBox,
        frameBoxes: fighter.animations?.jump?.frameContentBoxes || null, loop: true });
    }
    if (fighter.airIdleSrc) {
      motions.push({ key: 'air-idle', label: '空中待機', type: 'frames', frames: [fighter.airIdleSrc],
        duration: 12, box: fighter.airIdleContentBox,
        frameBoxes: fighter.animations?.airIdle?.frameContentBoxes || null, loop: true });
    }
    const specials = window.FIGHTER_MOVESETS?.[fighter.key]?.special || {};
    for (const [key, move] of Object.entries(specials)) {
      if (!move.animation) continue;
      motions.push({ key: `special-${key}`, label: `${move.name}（必殺技）`, type: 'frames',
        frames: move.animation.frames, duration: move.animation.frameDuration || 6,
        box: move.animation.contentBox, frameBoxes: move.animation.frameContentBoxes || null, loop: true });
    }
    const groundMoves = window.FIGHTER_MOVESETS?.[fighter.key]?.ground || {};
    for (const [key, move] of Object.entries(groundMoves)) {
      if (!move.animation) continue;
      motions.push({ key: `ground-${key}`, label: `${move.name}（通常技）`, type: 'frames',
        frames: move.animation.frames, duration: move.animation.frameDuration || 6,
        box: move.animation.contentBox, frameBoxes: move.animation.frameContentBoxes || null, loop: true });
    }
    return motions;
  },

  buildMotionList() {
    const fighter = FIGHTERS[this.fighterSelect.value] || Object.values(FIGHTERS)[0];
    const motions = this._motionsFor(fighter);
    this.motionSelect.innerHTML = motions.map(m => `<option value="${m.key}">${m.label}</option>`).join('');
    this.restart();
  },

  _image(src) {
    if (!this.imageCache.has(src)) {
      const image = new Image();
      image.src = src;
      this.imageCache.set(src, image);
    }
    return this.imageCache.get(src);
  },

  setActive(active) {
    if (!active) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
      return;
    }
    this.switchTab('motion');
    this.restart();
  },

  restart() {
    this.startedAt = performance.now();
    if (!document.getElementById('screen-debug')?.classList.contains('hidden')) this._requestFrame();
  },

  _requestFrame() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(time => this.draw(time));
  },

  _drawFrame(image, box, alpha, sheet) {
    if (!image || !image.complete || !image.naturalWidth || !box) return;
    const ctx = this.ctx;
    const sourceW = sheet ? image.width / sheet.cols : image.width;
    const sourceH = sheet ? image.height / sheet.rows : image.height;
    const contentW = box.right - box.left;
    const contentH = box.bottom - box.top;
    const scale = Math.min(250 / contentH, 300 / contentW);
    const centerX = this.canvas.width / 2;
    const groundY = this.canvas.height - 18;
    const drawX = centerX - ((box.left + box.right) / 2) * scale;
    const drawY = groundY - box.bottom * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (sheet) {
      const sx = (sheet.index % sheet.cols) * sourceW;
      const sy = Math.floor(sheet.index / sheet.cols) * sourceH;
      ctx.drawImage(image, sx, sy, sourceW, sourceH, drawX, drawY, sourceW * scale, sourceH * scale);
    } else {
      ctx.drawImage(image, drawX, drawY, image.width * scale, image.height * scale);
    }
    ctx.restore();
  },

  draw(time) {
    const screen = document.getElementById('screen-debug');
    if (!screen || screen.classList.contains('hidden')) { this.rafId = null; return; }
    const fighter = FIGHTERS[this.fighterSelect.value] || Object.values(FIGHTERS)[0];
    const motion = this._motionsFor(fighter).find(m => m.key === this.motionSelect.value);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#17202b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.moveTo(24, this.canvas.height - 18); ctx.lineTo(this.canvas.width - 24, this.canvas.height - 18); ctx.stroke();
    if (motion) {
      const frameMs = motion.duration * 1000 / 60;
      const elapsed = time - this.startedAt;
      if (motion.type === 'sheet') {
        const index = Math.floor(elapsed / frameMs) % motion.count;
        this._drawFrame(this._image(motion.src), motion.box, 1,
          { index, cols: motion.cols, rows: motion.rows });
      } else {
        const position = elapsed / frameMs;
        const index = Math.floor(position) % motion.frames.length;
        const next = (index + 1) % motion.frames.length;
        const phase = position - Math.floor(position);
        const raw = Math.max(0, Math.min(1, (phase - .45) / .55));
        const blend = raw * raw * (3 - 2 * raw);
        this._drawFrame(this._image(motion.frames[index]), motion.frameBoxes?.[index] || motion.box, 1);
        this._drawFrame(this._image(motion.frames[next]), motion.frameBoxes?.[next] || motion.box, blend);
      }
    }
    this.rafId = requestAnimationFrame(nextTime => this.draw(nextTime));
  },
};

window.DebugMotionViewer = DebugMotionViewer;

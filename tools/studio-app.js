// ==== モンスター作成スタジオ：画面制御 ====
const Studio = {
  motions: {},           // slot -> { canvases, used, contentBox, frameDuration, options }
  projectiles: {},       // slot -> 飛び道具の設定
  projectileImages: {},  // slot -> 飛び道具の画像
  existing: {},          // 本番に既に登録済みのモーション
  fightersJson: null,
  movesetsJson: null,
  editing: null,
  playTimer: null,
  playIndex: 0,

  el(id) { return document.getElementById(id); },

  init() {
    const settings = StudioGitHub.loadSettings();
    this.el('gh-token').value = settings.token;
    this.el('gh-repo').value = settings.repo;
    this.el('gh-branch').value = settings.branch;

    this.el('gh-save').addEventListener('click', () => this.connect());
    this.el('gh-clear').addEventListener('click', () => {
      StudioGitHub.clearToken();
      this.el('gh-token').value = '';
      this.setStatus('gh-state', 'info', 'トークンを消しました');
    });
    this.el('spec-mode').addEventListener('change', () => this.onModeChange());
    this.el('spec-existing').addEventListener('change', () => this.loadExisting());
    this.el('spec-key').addEventListener('input', () => this.refreshExistingMotions());
    this.el('btn-diff').addEventListener('click', () => this.showDiff());
    this.el('btn-commit').addEventListener('click', () => this.commit());

    this.buildAptitudes();
    this.buildMotionList();
    this.bindEditor();
    this.bindProjectile();
    if (settings.token) this.connect();
  },

  setStatus(id, kind, text) {
    const node = this.el(id);
    node.className = `status ${kind}`;
    node.classList.remove('hidden');
    node.textContent = text;
  },

  buildAptitudes() {
    const labels = { life: 'ライフ', power: 'ちから', intelligence: 'かしこさ',
      accuracy: '命中', evasion: '回避', defense: '丈夫さ' };
    this.el('apt-grid').innerHTML = Object.entries(labels).map(([key, label]) => `
      <div><label>${label}</label>
        <select id="apt-${key}">${['A', 'B', 'C', 'D', 'E']
          .map(r => `<option ${r === 'C' ? 'selected' : ''}>${r}</option>`).join('')}</select></div>`).join('');
  },

  buildMotionList() {
    const list = this.el('motion-list');
    list.innerHTML = STUDIO_MOTIONS.map(motion => `
      <button class="motion-row${motion.required ? ' required' : ''}" data-slot="${motion.slot}">
        <span><b>${motion.name}</b><small>${motion.hint || (motion.single ? '1枚' : 'コマ送り')}</small></span>
        <span class="count" data-count="${motion.slot}"></span>
        <span class="chev">›</span>
      </button>`).join('');
    list.querySelectorAll('[data-slot]').forEach(row => {
      row.addEventListener('click', () => this.openEditor(row.dataset.slot));
    });
    this.refreshMotionList();
  },

  refreshMotionList() {
    const existing = this.existing || {};
    STUDIO_MOTIONS.forEach(motion => {
      const entry = this.motions[motion.slot];
      const count = entry ? entry.canvases.filter((_, i) => entry.used[i]).length : 0;
      const already = existing[motion.slot];
      const label = document.querySelector(`[data-count="${motion.slot}"]`);
      const row = document.querySelector(`[data-slot="${motion.slot}"]`);
      if (!label || !row) return;
      if (count) {
        label.textContent = already ? `${count}コマ（差し替え）` : `${count}コマ`;
        label.classList.remove('kept');
      } else if (already) {
        const parts = [];
        if (already.frames) parts.push(`${already.frames}コマ`);
        if (already.projectile) parts.push('飛び道具');
        label.textContent = `登録済み ${parts.join('・')}`;
        label.classList.add('kept');
      } else {
        label.textContent = '未登録';
        label.classList.remove('kept');
      }
      row.classList.toggle('done', count > 0 || !!already);
    });
  },

  // ---- GitHub ----
  async connect() {
    StudioGitHub.saveSettings({
      token: this.el('gh-token').value,
      repo: this.el('gh-repo').value,
      branch: this.el('gh-branch').value,
    });
    this.setStatus('gh-state', 'info', '接続を確認中…');
    try {
      const repo = await StudioGitHub.testConnection();
      const [fighters, movesets] = await Promise.all([
        StudioGitHub.getFile('data/fighters.json'),
        StudioGitHub.getFile('data/movesets.json'),
      ]);
      this.fightersJson = JSON.parse(fighters || '{}');
      this.movesetsJson = JSON.parse(movesets || '{}');
      this.fillExisting();
      this.refreshExistingMotions();
      const note = repo.canPush ? ''
        : '｜書き込み権限を確認できませんでした。コミットで失敗する場合はトークンの Contents を Read and write にしてください';
      this.setStatus('gh-state', repo.canPush ? 'ok' : 'info',
        `接続OK: ${repo.name}（登録済み ${Object.keys(this.fightersJson).length}体）${note}`);
    } catch (error) {
      this.setStatus('gh-state', 'ng', String(error.message || error));
    }
  },

  // サーバー上に既に登録されているモーションを把握する。
  // 「未登録」と表示され続けると、既にあるモーションまで作り直す必要があると誤解させてしまう。
  refreshExistingMotions() {
    this.existing = {};
    const key = (this.el('spec-key').value || '').trim();
    const fighter = this.fightersJson && this.fightersJson[key];
    const moveset = this.movesetsJson && this.movesetsJson[key];
    if (fighter && fighter.animations) {
      for (const [slot, animation] of Object.entries(fighter.animations)) {
        this.existing[slot] = { frames: (animation.frames || []).length };
      }
    }
    if (fighter && fighter.stockIcon) this.existing.stock = { frames: 1 };
    if (moveset) {
      for (const [group, moves] of Object.entries(moveset)) {
        for (const [moveKey, move] of Object.entries(moves || {})) {
          const slot = `move:${group}.${moveKey}`;
          const info = {};
          if (move.animation) info.frames = (move.animation.frames || []).length;
          if (move.projectile) info.projectile = { ...move.projectile, sprite: move.projectileSprite };
          if (Object.keys(info).length) this.existing[slot] = info;
        }
      }
    }
    this.refreshMotionList();
  },

  fillExisting() {
    const select = this.el('spec-existing');
    select.innerHTML = Object.values(this.fightersJson)
      .map(f => `<option value="${f.key}">${f.displayName}（${f.key}）</option>`).join('');
  },

  onModeChange() {
    const isEdit = this.el('spec-mode').value === 'edit';
    this.el('existing-wrap').classList.toggle('hidden', !isEdit);
    if (isEdit) this.loadExisting();
  },

  // 既存モンスターの現在値をフォームへ流し込む（差分だけ更新できるように）
  loadExisting() {
    const key = this.el('spec-existing').value;
    const fighter = this.fightersJson && this.fightersJson[key];
    if (!fighter) return;
    this.el('spec-key').value = fighter.key;
    this.el('spec-name').value = fighter.displayName;
    this.el('spec-color').value = fighter.color || '#ff4757';
    this.el('spec-hh').value = fighter.hurtboxHeight || 124;
    this.el('spec-hw').value = fighter.hurtboxWidth || 54;
    const stats = fighter.stats || {};
    ['life', 'power', 'intelligence', 'accuracy', 'evasion', 'defense'].forEach(stat => {
      this.el(`st-${stat}`).value = stats[stat] != null ? stats[stat] : (stat === 'life' ? 100 : 10);
    });
    this.refreshExistingMotions();
  },

  // ---- モーション編集 ----
  bindEditor() {
    this.el('ed-close').addEventListener('click', () => this.closeEditor());
    this.el('ed-files').addEventListener('change', event => this.loadFiles(event.target.files));
    this.el('ed-source').addEventListener('change', () => {
      const isVideo = this.el('ed-source').value === 'video';
      this.el('ed-source-images').classList.toggle('hidden', isVideo);
      this.el('ed-source-video').classList.toggle('hidden', !isVideo);
    });
    this.el('ed-video').addEventListener('change', event => this.loadVideo(event.target.files[0]));
    this.el('ed-apply').addEventListener('click', () => this.processFrames());
    this.el('ed-play').addEventListener('click', () => this.togglePlay());
    this.el('ed-done').addEventListener('click', () => this.closeEditor());
    this.el('ed-clear').addEventListener('click', () => {
      delete this.motions[this.editing.slot];
      delete this.projectiles[this.editing.slot];
      delete this.projectileImages[this.editing.slot];
      this.refreshMotionList();
      this.closeEditor();
    });
    this.el('ed-threshold').addEventListener('input', event => {
      this.el('ed-threshold-value').textContent = event.target.value;
    });
    this.el('ed-threshold').addEventListener('change', () => this.processFrames());
    this.el('ed-bgmode').addEventListener('change', () => this.processFrames());
    this.el('ed-scale').addEventListener('input', event => {
      this.el('ed-scale-value').textContent = event.target.value;
      this.processFrames();
    });
    this.el('ed-foot').addEventListener('input', event => {
      this.el('ed-foot-value').textContent = event.target.value;
      this.processFrames();
    });
    this.el('ed-duration').addEventListener('input', event => {
      this.el('ed-dur-value').textContent = event.target.value;
      const entry = this.motions[this.editing.slot];
      if (entry) entry.frameDuration = Number(event.target.value);
    });
  },

  bindProjectile() {
    this.el('pj-use').addEventListener('change', () => {
      this.el('pj-fields').classList.toggle('hidden', !this.el('pj-use').checked);
    });
    this.el('pj-type').addEventListener('change', () => {
      this.el('pj-bomb').classList.toggle('hidden', this.el('pj-type').value !== 'bomb');
    });
    this.el('pj-file').addEventListener('change', async event => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const canvas = await StudioImage.load(file);
      // 飛び道具も背景透過して余白を落とす（そのまま貼ると余白ぶん当たり判定がずれて見える）
      if (!StudioImage.hasTransparentCorners(canvas)) StudioImage.removeBackground(canvas, { mode: 'corner', threshold: 30 });
      const { canvases } = StudioImage.cropAll([canvas], 2);
      const trimmed = StudioImage.limitSize(canvases[0], 256);
      this.projectileImages[this.editing.slot] = trimmed;
      this.el('pj-preview').src = StudioImage.toDataUrl(trimmed);
      // 画像の縦横比から幅・高さの目安を入れる
      const width = Number(this.el('pj-width').value) || 100;
      this.el('pj-height').value = Math.max(6, Math.round(width * trimmed.height / trimmed.width));
    });
  },

  // 既存の飛び道具設定をフォームへ復元する
  loadProjectileForm(slot) {
    const box = this.el('ed-projectile');
    const motion = STUDIO_MOTIONS.find(m => m.slot === slot);
    box.classList.toggle('hidden', !motion.projectile);
    if (!motion.projectile) return;
    const saved = this.projectiles[slot];
    const already = (this.existing || {})[slot];
    const source = saved || (already && already.projectile) || null;
    this.el('pj-use').checked = !!source;
    this.el('pj-fields').classList.toggle('hidden', !source);
    this.el('pj-file').value = '';
    const image = this.projectileImages[slot];
    if (image) this.el('pj-preview').src = StudioImage.toDataUrl(image);
    else this.el('pj-preview').removeAttribute('src');
    if (!source) return;
    this.el('pj-type').value = source.type === 'bomb' ? 'bomb' : 'straight';
    this.el('pj-bomb').classList.toggle('hidden', source.type !== 'bomb');
    this.el('pj-speed').value = source.speed != null ? source.speed : 12;
    this.el('pj-spawn').value = source.spawnFrame != null ? source.spawnFrame : 9;
    this.el('pj-width').value = source.width != null ? source.width : 108;
    this.el('pj-height').value = source.height != null ? source.height : 30;
    this.el('pj-life').value = source.lifetime != null ? source.lifetime : 95;
    this.el('pj-gravity').value = source.gravity != null ? source.gravity : 0.28;
    this.el('pj-radius').value = source.explosionRadius != null ? source.explosionRadius : 105;
  },

  readProjectileForm(slot) {
    const motion = STUDIO_MOTIONS.find(m => m.slot === slot);
    if (!motion.projectile) return;
    if (!this.el('pj-use').checked) { delete this.projectiles[slot]; return; }
    const type = this.el('pj-type').value;
    const config = {
      speed: Number(this.el('pj-speed').value) || 12,
      width: Number(this.el('pj-width').value) || 100,
      height: Number(this.el('pj-height').value) || 30,
      lifetime: Number(this.el('pj-life').value) || 95,
      spawnFrame: Number(this.el('pj-spawn').value) || 9,
    };
    if (type === 'bomb') {
      config.type = 'bomb';
      config.gravity = Number(this.el('pj-gravity').value) || 0.28;
      config.groundFriction = 0.985;
      config.explosionRadius = Number(this.el('pj-radius').value) || 105;
    }
    this.projectiles[slot] = config;
  },

  openEditor(slot) {
    const motion = STUDIO_MOTIONS.find(m => m.slot === slot);
    this.editing = motion;
    this.el('ed-title').textContent = motion.name;
    this.el('ed-hint').textContent = motion.hint ||
      (motion.single ? '1枚だけ使います。' : '選んだ順にコマが再生されます。使わないコマはタップで外せます。');
    this.el('ed-files').value = '';
    this.el('ed-video').value = '';
    this.el('ed-video-state').textContent = '';
    const entry = this.motions[slot];
    this.el('ed-duration').value = entry ? entry.frameDuration : motion.duration;
    this.el('ed-dur-value').textContent = this.el('ed-duration').value;
    this.el('ed-foot').value = entry ? (entry.footOffset || 0) : 0;
    this.el('ed-foot-value').textContent = this.el('ed-foot').value;
    this.el('ed-scale').value = entry ? (entry.sizePercent || 100) : 100;
    this.el('ed-scale-value').textContent = this.el('ed-scale').value;
    if (entry) {
      this.el('ed-bgmode').value = entry.options.mode;
      this.el('ed-threshold').value = entry.options.threshold;
      this.el('ed-threshold-value').textContent = entry.options.threshold;
    }
    // 既に本番へ登録済みのモーションがあることを伝える（触らなければそのまま残る）
    const already = (this.existing || {})[slot];
    const kept = this.el('ed-kept');
    if (already && !this.motions[slot]) {
      const parts = [];
      if (already.frames) parts.push(`${already.frames}コマのモーション`);
      if (already.projectile) parts.push('飛び道具の設定');
      kept.textContent = `このモーションは既に登録されています（${parts.join('・')}）。`
        + '画像を選ばなければ今のまま残ります。差し替えたい時だけ選び直してください。';
      kept.classList.remove('hidden');
    } else {
      kept.classList.add('hidden');
    }
    this.loadProjectileForm(slot);
    this.el('editor').classList.remove('hidden');
    window.scrollTo(0, 0);
    this.renderFrames();
  },

  closeEditor() {
    if (this.editing) this.readProjectileForm(this.editing.slot);
    this.stopPlay();
    this.el('editor').classList.add('hidden');
    this.refreshMotionList();
    this.editing = null;
  },

  // 動画からコマを切り出す。
  // 繰り返し動作は周期を自動検出し、その1周ぶんだけを使うことで
  // 「途中で動きが飛ぶ」「片足しか上がらない」といった不自然さを避ける。
  async loadVideo(file) {
    if (!file) return;
    const state = this.el('ed-video-state');
    const wanted = Number(this.el('ed-video-count').value) || 8;
    const useCycle = this.el('ed-video-cycle').value === 'auto';
    let video = null;
    try {
      state.textContent = '動画を読み込み中…';
      video = await StudioVideo.load(file);
      // 周期を探すため、必要枚数より多めに候補を取る
      const sampleCount = useCycle ? Math.min(32, Math.max(wanted * 3, 18)) : wanted;
      const candidates = await StudioVideo.extractFrames(video, sampleCount,
        (done, total) => { state.textContent = `コマを取り出し中… ${done}/${total}`; });

      let sources = candidates;
      let message = `${candidates.length}コマから${wanted}コマを使います`;
      if (useCycle) {
        const period = StudioVideo.detectCycle(candidates);
        if (period) {
          sources = StudioVideo.pickCycleFrames(candidates, period, wanted);
          message = `繰り返しを検出しました（${period}コマで1周）。その1周から${sources.length}コマを使います`;
        } else {
          sources = StudioVideo.pickCycleFrames(candidates, candidates.length, wanted);
          message = `繰り返しが見つからなかったため、動画全体から${sources.length}コマを均等に使います`;
        }
      }
      state.textContent = message + '。うまくいかない時は枚数や範囲を変えて選び直してください。';

      this.motions[this.editing.slot] = {
        sources,
        canvases: [],
        used: sources.map(() => true),
        frameDuration: Number(this.el('ed-duration').value),
        options: { mode: this.el('ed-bgmode').value, threshold: Number(this.el('ed-threshold').value) },
      };
      this.processFrames();
    } catch (error) {
      state.textContent = String(error.message || error);
    } finally {
      StudioVideo.release(video);
    }
  },

  async loadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    // iOSのファイル選択は順不同で返ることがあるため、ファイル名で並べ替えて安定させる
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    this.el('ed-box').textContent = '読み込み中…';
    try {
      const sources = [];
      for (const file of files) sources.push(await StudioImage.load(file));
      // すでに背景が透過されている素材なら、背景除去は不要（かけると色が削れる）
      if (StudioImage.hasTransparentCorners(sources[0]) && this.el('ed-bgmode').value === 'corner') {
        this.el('ed-bgmode').value = 'none';
      }
      this.motions[this.editing.slot] = {
        sources,
        canvases: [],
        used: sources.map(() => true),
        frameDuration: Number(this.el('ed-duration').value),
        options: { mode: this.el('ed-bgmode').value, threshold: Number(this.el('ed-threshold').value) },
      };
      this.processFrames();
    } catch (error) {
      this.el('ed-box').textContent = String(error.message || error);
    }
  },

  // 背景透過 → サイズ制限 → 共通トリミング → contentBox算出 まで一括で行う
  processFrames() {
    const entry = this.motions[this.editing.slot];
    if (!entry || !entry.sources.length) return;
    const options = {
      mode: this.el('ed-bgmode').value,
      threshold: Number(this.el('ed-threshold').value),
    };
    entry.options = options;
    entry.frameDuration = Number(this.el('ed-duration').value);

    const processed = entry.sources.map(source => {
      // 元画像は残しておき、毎回コピーに対して処理する（しきい値を何度でも変えられる）
      const copy = document.createElement('canvas');
      copy.width = source.width; copy.height = source.height;
      copy.getContext('2d').drawImage(source, 0, 0);
      StudioImage.removeBackground(copy, options);
      return StudioImage.limitSize(copy, this.editing.single ? 256 : 720);
    });

    if (this.editing.single) {
      entry.canvases = [StudioImage.toSquare(processed[0], 128)];
      entry.used = [true];
      entry.contentBox = null;
    } else {
      const { canvases } = StudioImage.cropAll(processed, 6);
      entry.canvases = canvases;
      // コマごとにbboxが違うと再生時にガタつくため、全コマの和集合を共通boxとして使う
      const boxes = canvases.map(canvas => StudioImage.contentBox(canvas));
      entry.footOffset = Number(this.el('ed-foot').value) || 0;
      entry.sizePercent = Number(this.el('ed-scale').value) || 100;
      const raw = StudioImage.nudgeBottom(StudioImage.unionContentBox(boxes), entry.footOffset);
      // 表示サイズの調整は「足元を固定したまま本体の高さを変える」ことで行う。
      // 技モーションは武器やエフェクトの分だけ枠が縦に伸び、そのままだと
      // キャラだけ小さく表示されてしまうため、ここで待機時と揃えられるようにする。
      entry.rawContentBox = raw;
      if (raw) {
        const height = (raw.bottom - raw.top) * (100 / entry.sizePercent);
        entry.contentBox = { ...raw, top: Math.round(raw.bottom - height) };
      } else entry.contentBox = null;
      if (entry.used.length !== canvases.length) entry.used = canvases.map(() => true);
      // 待機モーションからは体格（当たり判定）の目安を自動で決める
      if (this.editing.slot === 'idle' && entry.contentBox) {
        const metrics = StudioImage.bodyMetrics(canvases[0], entry.rawContentBox || entry.contentBox);
        const height = Number(this.el('spec-hh').value) || 124;
        const boxHeight = (entry.rawContentBox || entry.contentBox).bottom - (entry.rawContentBox || entry.contentBox).top;
        this.el('spec-hw').value = Math.max(20, Math.round(height * metrics.medianWidth / boxHeight));
      }
    }
    this.renderFrames();
  },

  renderFrames() {
    const entry = this.motions[this.editing.slot];
    const container = this.el('ed-frames');
    if (!entry || !entry.canvases.length) {
      container.innerHTML = '';
      this.el('ed-preview').removeAttribute('src');
      this.el('ed-box').textContent = '画像が未選択です';
      return;
    }
    container.innerHTML = entry.canvases.map((canvas, index) => `
      <div class="frame${entry.used[index] ? '' : ' off'}" data-index="${index}">
        <span>${index + 1}</span><img src="${StudioImage.toDataUrl(canvas)}" alt="">
      </div>`).join('');
    container.querySelectorAll('[data-index]').forEach(node => {
      node.addEventListener('click', () => {
        const index = Number(node.dataset.index);
        entry.used[index] = !entry.used[index];
        // 全部外すと登録できなくなるため、最低1コマは残す
        if (!entry.used.some(Boolean)) entry.used[index] = true;
        this.renderFrames();
      });
    });
    const box = entry.contentBox;
    const usedCount = entry.used.filter(Boolean).length;
    this.el('ed-box').textContent = box
      ? `使用 ${usedCount}コマ／画像 ${entry.canvases[0].width}×${entry.canvases[0].height}px｜`
        + `本体の位置 contentBox = 左${box.left} 上${box.top} 右${box.right} 下${box.bottom}（影は自動で除外）`
      : `使用 ${usedCount}コマ`;
    this.playIndex = 0;
    this.showFrame();
  },

  // ゲーム本体と同じ計算（本体の高さ = 当たり判定の高さ になるスケール）でプレビューする。
  // 待機モーションを薄く重ねることで、技のときだけキャラの大きさが変わってしまうのを目で防げる。
  showFrame() {
    const entry = this.motions[this.editing.slot];
    const canvas = this.el('ed-preview');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!entry || !entry.contentBox) return;
    const usable = entry.canvases.filter((_, i) => entry.used[i]);
    if (!usable.length) return;

    const baseline = canvas.height - 12;   // 地面の高さ
    const centerX = canvas.width / 2;
    const unitHeight = 150;                // プレビュー上での「当たり判定の高さ」

    const drawWith = (source, box, alpha) => {
      const scale = unitHeight / (box.bottom - box.top);
      const drawW = source.width * scale;
      const drawH = source.height * scale;
      const x = centerX - ((box.left + box.right) / 2) * scale;
      const y = (baseline - unitHeight) - box.top * scale;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(source, x, y, drawW, drawH);
      ctx.restore();
    };

    // 基準となる待機モーション（自分自身が待機の時は出さない）
    const idle = this.motions.idle;
    if (idle && idle.contentBox && this.editing.slot !== 'idle' && idle.canvases.length) {
      drawWith(idle.canvases[0], idle.contentBox, 0.25);
    }
    drawWith(usable[this.playIndex % usable.length], entry.contentBox, 1);

    // 地面のガイド線
    ctx.strokeStyle = 'rgba(255,212,94,.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(10, baseline + .5); ctx.lineTo(canvas.width - 10, baseline + .5); ctx.stroke();
  },

  togglePlay() {
    if (this.playTimer) return this.stopPlay();
    const entry = this.motions[this.editing.slot];
    if (!entry) return;
    const interval = Math.max(30, (entry.frameDuration || 8) * (1000 / 60));
    this.playTimer = setInterval(() => { this.playIndex++; this.showFrame(); }, interval);
  },

  stopPlay() {
    if (this.playTimer) clearInterval(this.playTimer);
    this.playTimer = null;
  },

  // ---- コミット内容の組み立て ----
  collect() {
    const key = (this.el('spec-key').value || '').trim();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error('key は英小文字で入力してください（例: mymon）');
    const displayName = (this.el('spec-name').value || '').trim();
    if (!displayName) throw new Error('表示名を入力してください');

    const images = [];
    const animations = {};
    const moveData = {};
    let idleImage = null, stockIcon = null, spriteContentBox = null;

    // 飛び道具の設定（モーション画像を差し替えなくても単独で登録できる）
    for (const motion of STUDIO_MOTIONS) {
      if (!motion.projectile) continue;
      const config = this.projectiles[motion.slot];
      if (!config) continue;
      const slot = motion.slot.slice(5);
      moveData[slot] = moveData[slot] || {};
      moveData[slot].projectile = config;
      const image = this.projectileImages[motion.slot];
      if (image) {
        const name = `${motion.dir || slot.replace('.', '_')}.png`;
        const path = `assets/images/fighter/${key}/projectiles/${name}`;
        images.push({ path, canvas: image });
        moveData[slot].projectileSprite = path;
      }
    }

    for (const motion of STUDIO_MOTIONS) {
      const entry = this.motions[motion.slot];
      if (!entry || !entry.canvases.length) continue;
      const usable = entry.canvases.filter((_, i) => entry.used[i]);
      if (!usable.length) continue;

      if (motion.single) {
        const path = `assets/images/fighter/${key}/${motion.filePrefix || motion.slot}.png`;
        images.push({ path, canvas: usable[0] });
        if (motion.slot === 'stock') stockIcon = path;
        continue;
      }

      const frames = usable.map((canvas, index) => {
        const name = motion.filePrefix && usable.length === 1
          ? `${motion.filePrefix}.png`
          : `frame_${String(index + 1).padStart(3, '0')}.png`;
        const path = `assets/images/fighter/${key}/${motion.dir}/${name}`;
        images.push({ path, canvas });
        return path;
      });
      const animation = { frames, frameDuration: entry.frameDuration, contentBox: entry.contentBox };
      if (motion.slot.startsWith('move:')) {
        const slot = motion.slot.slice(5);
        moveData[slot] = moveData[slot] || {};
        moveData[slot].animation = animation;
      } else animations[motion.slot] = animation;
      if (motion.slot === 'idle') {
        idleImage = frames[0];
        spriteContentBox = entry.contentBox;
      }
    }

    if (!images.length && !Object.keys(moveData).length) {
      throw new Error('登録する内容がありません。モーションを1つ以上選ぶか、飛び道具を設定してください');
    }

    const stats = {};
    ['life', 'power', 'intelligence', 'accuracy', 'evasion', 'defense'].forEach(stat => {
      stats[stat] = Number(this.el(`st-${stat}`).value) || (stat === 'life' ? 100 : 10);
    });
    const aptitudes = {};
    ['life', 'power', 'intelligence', 'accuracy', 'evasion', 'defense'].forEach(stat => {
      aptitudes[stat] = this.el(`apt-${stat}`).value;
    });

    return {
      key, displayName, images, animations, moveData, aptitudes,
      spec: {
        key, displayName,
        color: this.el('spec-color').value,
        hurtboxHeight: Number(this.el('spec-hh').value) || 124,
        hurtboxWidth: Number(this.el('spec-hw').value) || 54,
        idleImage, stockIcon, spriteContentBox,
        stats,
      },
    };
  },

  async buildFiles(collected) {
    if (!this.fightersJson) throw new Error('先にGitHubへ接続してください');
    const files = [];
    for (const image of collected.images) {
      files.push({ path: image.path, bytes: await StudioImage.toPngBytes(image.canvas) });
    }

    const fighters = StudioBuild.applyFighter(this.fightersJson, collected.spec);
    files.push({ path: 'data/fighters.json', text: JSON.stringify(fighters, null, 2) + '\n' });

    if (Object.keys(collected.moveData).length) {
      const movesets = StudioBuild.applyMoveset(this.movesetsJson, collected.key, collected.moveData);
      files.push({ path: 'data/movesets.json', text: JSON.stringify(movesets, null, 2) + '\n' });
    }

    const swSource = await StudioGitHub.getFile('service-worker.js');
    const sw = StudioBuild.updateServiceWorker(swSource, collected.images.map(i => i.path));
    files.push({ path: 'service-worker.js', text: sw.source });
    files.push({ path: 'version.json', text: StudioBuild.versionJson(sw.version) });

    const indexSource = await StudioGitHub.getFile('index.html');
    const title = (this.el('log-title').value || '').trim() || `モンスター「${collected.displayName}」を追加`;
    const body = (this.el('log-body').value || '').trim() || `${collected.displayName}を追加しました。`;
    files.push({ path: 'index.html', text: StudioBuild.updateIndexHtml(indexSource, sw.version, title, body) });

    return { files, version: sw.version, swAdded: sw.added, title };
  },

  async showDiff() {
    try {
      const collected = this.collect();
      const built = await this.buildFiles(collected);
      this.pending = built;
      const lines = [
        `■ モンスター: ${collected.displayName}（${collected.key}）`,
        `■ 体格: 高さ ${collected.spec.hurtboxHeight} / 幅 ${collected.spec.hurtboxWidth}`,
        `■ 登録モーション: ${Object.keys(collected.animations).join('、') || 'なし'}`,
        `■ 技: ${Object.entries(collected.moveData).map(([k, v]) =>
          k + (v.animation ? '(モーション)' : '') + (v.projectile ? '(飛び道具)' : '')).join('、') || 'なし'}`,
        `■ 画像: ${collected.images.length}枚`,
        `■ 新バージョン: 0.${built.version}（Service Workerへ${built.swAdded}件追加）`,
        '',
        '--- 更新されるファイル ---',
        ...built.files.map(f => `  ${f.path}${f.bytes ? ` (${Math.round(f.bytes.length / 1024)}KB)` : ''}`),
      ];
      const diff = this.el('diff');
      diff.classList.remove('hidden');
      diff.textContent = lines.join('\n');
      this.el('btn-commit').disabled = false;
      this.setStatus('commit-state', 'info', '内容を確認して「この内容でコミット」を押してください');
    } catch (error) {
      this.el('btn-commit').disabled = true;
      this.setStatus('commit-state', 'ng', String(error.message || error));
    }
  },

  async commit() {
    if (!this.pending) return;
    this.el('btn-commit').disabled = true;
    try {
      const message = `${this.pending.title}（モンスター作成スタジオから登録）`;
      const sha = await StudioGitHub.commitFiles(this.pending.files, message,
        text => this.setStatus('commit-state', 'info', text));
      this.setStatus('commit-state', 'ok',
        `コミットしました（${sha.slice(0, 7)}）。数分後に本番へ反映されます。`);
      this.pending = null;
      // 直後にもう一度登録できるよう、最新のデータを取り直す
      await this.connect();
    } catch (error) {
      this.setStatus('commit-state', 'ng', String(error.message || error));
      this.el('btn-commit').disabled = false;
    }
  },
};

// スクリプトは動的に読み込まれるため、この時点で既にDOMContentLoadedが
// 済んでいる場合がある。読み込み済みならそのまま初期化する。
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => Studio.init());
} else {
  Studio.init();
}

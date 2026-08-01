// ==== 画面遷移フロー ====
// ローディング → スタート(TAP START) → ホーム → 地形選択 → ファイター選択(トークン配置)
// → [CPU戦のみ]CPUレベル選択 → バトル開幕演出(Loading→FIGHT!) → バトル → リザルト

const AppFlow = {
  selectedMode: null,     // 'cpu' | 'multi'
  selectedStageKey: null,
  selectedCpuLevel: 3,
  selectedManageMasmonId: null,

  // トークン配置状態（CPU戦用）。値は { fighterKey, masmonId(nullable) } または null
  tokens: { p1: null, cpu1: null },
  activeTokenId: null,

  lastLaunchOptions: null, // 直近に開始したバトルの設定（リザルト画面でEXP計算等に使用）

  currentUser: null, // { uid, username }（ログイン中のみ）。Firestore連携（マスモン保存）はPhase2続きで実装予定

  init() {
    this.showScreen('loading');
    this.buildStageList();
    this.buildFighterList();
    this.buildCpuLevelList();
    this.bindEvents();
    this.bindAuthEvents();
    this.preloadAssets(() => this._afterPreload());
  },

  // アセット読み込み完了後：ログイン状態を確認し、ログイン済みならホームへ、未ログインなら認証画面へ
  async _afterPreload() {
    if (!window.FirebaseAuth) {
      // 万一Firebaseの読み込みが間に合っていない場合のフォールバック
      console.error('FirebaseAuthが初期化されていません。認証をスキップします。');
      this.showScreen('start');
      return;
    }
    const user = window.FirebaseAuth.getCurrentUser();
    if (user) {
      this.currentUser = user;
      await Promise.all([
        MasmonStore.loadFromFirestore(user.uid),
        UserProfileStore.load(user.uid, user.username),
      ]);
      this.buildFighterList(); // マスモン読み込み完了後に一覧を再構築
      this.showScreen('start');
    } else {
      this.showScreen('auth');
    }
  },

  // 全ファイター/ステージ画像を事前読み込み（読み込み完了後にバトル開始しても即座に表示される）
  preloadAssets(onDone) {
    const urls = ['assets/images/home.png', 'assets/images/logo.png'];
    Object.values(FIGHTERS).forEach(f => {
      if (f.idleImage) urls.push(f.idleImage);
      if (f.stockIcon) urls.push(f.stockIcon);
      if (f.walkSheetSrc) urls.push(f.walkSheetSrc);
      if (f.idleFrameSrcs) urls.push(...f.idleFrameSrcs);
    });
    Object.values(STAGES).forEach(s => {
      if (s.background) urls.push(s.background);
      if (s.platformImage) urls.push(s.platformImage);
    });

    const bar = document.getElementById('loading-bar-fill');
    const total = urls.length;
    if (total === 0) { onDone(); return; }

    let loaded = 0;
    urls.forEach(url => {
      const img = new Image();
      const mark = () => {
        loaded++;
        if (bar) bar.style.width = `${Math.floor((loaded / total) * 100)}%`;
        if (loaded >= total) onDone();
      };
      img.onload = mark;
      img.onerror = mark;
      img.src = url;
    });
  },

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById('screen-' + name).classList.remove('hidden');

    const gear = document.getElementById('vpad-settings-toggle');
    // ホームには専用の設定ボタンがあるため、共通の仮想パッド設定ボタンは隠して二重表示を防ぐ
    if (gear) gear.style.display = ['loading', 'start', 'auth', 'home'].includes(name) ? 'none' : '';

    if (name === 'home') this._updateHomeProfile();
  },

  _updateHomeProfile() {
    const nickname = UserProfileStore.data.nickname || (this.currentUser && this.currentUser.username) || '';
    const level = UserProfileStore.data.breederLevel || 1;
    const exp = UserProfileStore.data.breederExp || 0;
    const needed = UserProfileStore.breederExpForLevel(level);
    document.getElementById('home-nickname').textContent = nickname;
    document.getElementById('home-breeder-level').textContent = `ブリーダー Lv.${level}`;
    document.getElementById('home-breeder-exp-text').textContent = `${exp} / ${needed} EXP`;
    document.getElementById('home-breeder-exp-fill').style.width = `${Math.min(100, exp / needed * 100)}%`;
    document.getElementById('home-profile-icon').src = this._profileIconSrc(UserProfileStore.data.iconKey);
    const diamonds = document.getElementById('home-diamonds');
    if (diamonds) diamonds.textContent = `💎 ${UserProfileStore.data.diamonds || 0}`;
    document.getElementById('home-practice-tickets').textContent = `修行券 ${UserProfileStore.data.practiceTickets || 0}`;
  },

  _profileIconSrc(iconKey) {
    return iconKey === 'dullahan'
      ? 'assets/images/fighter/dullahan/stock.png'
      : 'assets/images/fighter/irumine/stock.png';
  },

  buildStageList() {
    const list = document.getElementById('stage-list');
    list.innerHTML = Object.values(STAGES).map(s => `
      <button class="select-card" data-stage="${s.key}" style="background-image:url('${s.background}')">
        <span class="select-card-label">${s.displayName}</span>
      </button>
    `).join('');
  },

  // ファイター一覧：登録済みテンプレート + ユーザーのマスモン（登録済みなら名前/Lvを表示）
  buildFighterList() {
    const list = document.getElementById('fighter-list');
    const templateCards = Object.values(FIGHTERS).map(f => this._fighterCardHtml({
      fighterKey: f.key, label: f.displayName, img: f.idleImage, color: f.color,
    }));
    const masmonCards = MasmonStore.loadAll().filter(m => FIGHTERS[m.baseFighterKey]).map(m => {
      const base = FIGHTERS[m.baseFighterKey] || {};
      return this._fighterCardHtml({
        fighterKey: m.baseFighterKey, masmonId: m.id,
        label: `${m.name}（Lv.${m.level}）`, img: base.idleImage, color: base.color,
      });
    });
    list.innerHTML = templateCards.join('') + masmonCards.join('');
  },

  _fighterCardHtml({ fighterKey, masmonId, label, img, color }) {
    const bg = img ? `background-image:url('${img}')` : `background-color:${color}`;
    return `
      <button class="select-card fighter-card" data-fighter="${fighterKey}" ${masmonId ? `data-masmon="${masmonId}"` : ''} style="${bg}">
        <span class="select-card-label">${label}</span>
      </button>
    `;
  },

  buildCpuLevelList() {
    const labels = { 1: 'とても弱い', 3: '弱い', 5: '普通', 7: '強い', 9: 'とても強い' };
    const list = document.getElementById('cpu-level-list');
    list.innerHTML = Array.from({ length: 9 }, (_, i) => i + 1).map(lvl => `
      <button class="level-btn" data-level="${lvl}">
        Lv.${lvl}
        ${labels[lvl] ? `<span class="level-btn-label">${labels[lvl]}</span>` : ''}
      </button>
    `).join('');
  },

  bindEvents() {
    document.getElementById('screen-start').addEventListener('click', () => this.showScreen('home'));

    document.getElementById('home-profile-card').addEventListener('click', () => {
      if (!this.currentUser) return;
      if (!confirm('ログアウトしますか？')) return;
      window.FirebaseAuth.logOut().then(() => {
        this.currentUser = null;
        MasmonStore.clearCache();
        UserProfileStore.clear();
        this.showScreen('auth');
      });
    });

    document.getElementById('btn-cpu').addEventListener('click', () => {
      this.selectedMode = 'cpu';
      this._resetFighterSelectState();
      this.showScreen('stage-select');
    });
    document.getElementById('btn-multi').addEventListener('click', () => {
      alert('マルチ対戦は近日実装予定です');
    });
    document.getElementById('btn-training').addEventListener('click', () => this.openMasmonManage());
    document.getElementById('btn-gacha').addEventListener('click', () => {
      alert('ガチャは近日実装予定です');
    });
    document.getElementById('btn-home-settings').addEventListener('click', () => {
      vpad.el.settingsPanel.classList.remove('hidden');
      this.renderSettingsProfile();
    });

    document.getElementById('stage-list').addEventListener('click', (e) => {
      const card = e.target.closest('.select-card');
      if (!card) return;
      this.selectedStageKey = card.dataset.stage;
      this.buildFighterList(); // マスモンが増えている可能性があるため再構築
      this._resetFighterSelectState();
      this.showScreen('fighter-select');
    });

    // ---- トークン（1P/CPU）操作 ----
    document.getElementById('token-bar').addEventListener('click', (e) => {
      const token = e.target.closest('.token');
      if (!token) return;
      if (Date.now() < (this.suppressTokenClickUntil || 0)) {
        return;
      }
      const id = token.dataset.token;
      this.activeTokenId = (this.activeTokenId === id) ? null : id;
      this._renderTokenBar();
    });

    document.getElementById('fighter-list').addEventListener('click', (e) => {
      const card = e.target.closest('.select-card');
      if (!card) return;
      const fighterKey = card.dataset.fighter;
      const masmonId = card.dataset.masmon || null;

      if (this.selectedMode === 'cpu') {
        if (!this.activeTokenId) return; // トークンを選んでからファイターをタップする
        this.tokens[this.activeTokenId] = { fighterKey, masmonId };
        this.activeTokenId = null;
        this._renderTokenBar();
        this._renderCardBadges();
        this._updateFightButtonVisibility();
        return;
      }

      // マルチ（現状ローカル動作確認）は即開始
      this.tokens.p1 = { fighterKey, masmonId };
      this.tokens.cpu1 = { fighterKey: Object.keys(FIGHTERS).find(k => k !== fighterKey) || fighterKey, masmonId: null };
      this._startFromTokens();
    });

    document.getElementById('btn-fight-start').addEventListener('click', () => {
      this.showScreen('cpu-level');
    });

    document.getElementById('cpu-level-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.level-btn');
      if (!btn) return;
      this.selectedCpuLevel = parseInt(btn.dataset.level, 10);
      this._startFromTokens();
    });

    document.querySelectorAll('.back-btn').forEach(btn => {
      btn.addEventListener('click', () => this.showScreen(btn.dataset.back));
    });

    document.getElementById('btn-result-continue').addEventListener('click', () => {
      this.showScreen('home');
    });

    document.getElementById('masmon-manage-list').addEventListener('click', (e) => {
      const card = e.target.closest('[data-manage-masmon]');
      if (!card) return;
      this.selectedManageMasmonId = card.dataset.manageMasmon;
      this.renderMasmonManage();
    });
    document.getElementById('masmon-action-panel').addEventListener('click', (e) => {
      const action = e.target.closest('[data-manage-action]')?.dataset.manageAction;
      if (action === 'training') this.openTraining();
      if (action === 'practice') alert('修行は近日実装予定です');
      if (action === 'skin') alert('スキン変更は近日実装予定です');
    });
    document.getElementById('training-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-training]');
      if (btn) this.performTraining(btn.dataset.training);
    });
  },

  openMasmonManage() {
    const list = MasmonStore.loadAll();
    if (!list.some(m => m.id === this.selectedManageMasmonId)) this.selectedManageMasmonId = null;
    this.renderMasmonManage();
    this.showScreen('masmon-manage');
  },

  renderMasmonManage() {
    const list = MasmonStore.loadAll();
    const listEl = document.getElementById('masmon-manage-list');
    const panel = document.getElementById('masmon-action-panel');
    if (!list.length) {
      listEl.innerHTML = '<div class="empty-message">所持マスモンがいません。CPU戦後に登録できます。</div>';
      panel.classList.add('hidden');
      return;
    }
    listEl.innerHTML = list.map(m => {
      const base = FIGHTERS[m.baseFighterKey] || {};
      const selected = m.id === this.selectedManageMasmonId ? ' selected' : '';
      const bg = base.idleImage ? `background-image:url('${base.idleImage}')` : `background-color:${base.color || '#333'}`;
      return `<button class="masmon-manage-card${selected}" data-manage-masmon="${m.id}">
        <span class="masmon-thumb" style="${bg}"></span><span>${m.name}<small>Lv.${m.level} ／ チケット ${m.trainingTickets || 0}枚</small></span>
      </button>`;
    }).join('');
    const selected = list.find(m => m.id === this.selectedManageMasmonId);
    panel.classList.toggle('hidden', !selected);
    panel.innerHTML = selected ? `<div class="selected-masmon-name">${selected.name}に何をしますか？</div>
      <div class="masmon-actions"><button data-manage-action="training">トレーニング</button><button data-manage-action="practice">修行</button><button data-manage-action="skin">スキン変更</button></div>` : '';
  },

  openTraining() {
    if (!this._selectedManageMasmon()) return;
    this.renderTraining();
    this.showScreen('training');
  },

  _selectedManageMasmon() {
    return MasmonStore.loadAll().find(m => m.id === this.selectedManageMasmonId);
  },

  renderTraining(message = '') {
    const m = this._selectedManageMasmon();
    if (!m) return;
    const labels = { life: 'ライフ', power: 'ちから', intelligence: 'かしこさ', accuracy: '命中', evasion: '回避', defense: '丈夫さ' };
    const stats = GROWTH.computeStatsAtLevel({ ...defaultStats(), trainingStats: m.trainingStats }, m.aptitudes, m.level);
    const effects = {
      life: '生存力', power: '打撃技の威力', intelligence: '必殺技の威力',
      accuracy: '攻撃の届く範囲', evasion: '移動速度', defense: '吹っ飛びにくさ',
    };
    document.getElementById('training-summary').innerHTML = `<strong>${m.name} Lv.${m.level}</strong><span class="ticket-count">🎟 ${m.trainingTickets || 0}枚</span>
      <div class="stat-grid">${GROWTH.STAT_KEYS.map(k => `<span>${labels[k]} <b>${stats[k]}</b><small>適性 ${m.aptitudes[k]}</small><em>${effects[k]}</em></span>`).join('')}</div>`;
    document.getElementById('training-list').innerHTML = Object.entries(GROWTH.TRAINING_MENU).map(([key, t]) => {
      const detail = Object.entries(t.changes).map(([stat, value]) => `${labels[stat]}${value === 5 ? 'が大増加' : value > 0 ? 'が増加' : 'が減少'}`).join('／');
      return `<button class="training-card" data-training="${key}" ${(m.trainingTickets || 0) < 1 ? 'disabled' : ''}><strong>${t.name}</strong><small>${detail}</small></button>`;
    }).join('');
    document.getElementById('training-message').textContent = message;
  },

  performTraining(trainingKey) {
    const m = this._selectedManageMasmon();
    if (!m) return;
    const result = GROWTH.train(m, trainingKey);
    if (result.ok) MasmonStore.update(m);
    const labels = { life: 'ライフ', power: 'ちから', intelligence: 'かしこさ', accuracy: '命中', evasion: '回避', defense: '丈夫さ' };
    const changes = result.ok ? Object.entries(result.applied).filter(([, v]) => v).map(([k, v]) => `${labels[k]} ${v > 0 ? '+' : ''}${v}`).join('、') : '';
    this.renderTraining(result.ok ? `${result.training.name}成功！ ${changes}` : result.message);
    this.renderMasmonManage();
  },

  bindAuthEvents() {
    const usernameEl = document.getElementById('auth-username');
    const passwordEl = document.getElementById('auth-password');
    const rememberEl = document.getElementById('auth-remember');
    const errorEl = document.getElementById('auth-error');
    const loginBtn = document.getElementById('btn-auth-login');
    const signupBtn = document.getElementById('btn-auth-signup');
    const savedLoginKey = 'smamon_saved_login';

    try {
      const saved = JSON.parse(localStorage.getItem(savedLoginKey));
      if (saved && typeof saved.username === 'string' && typeof saved.password === 'string') {
        usernameEl.value = saved.username;
        passwordEl.value = saved.password;
        rememberEl.checked = true;
      }
    } catch (e) {
      localStorage.removeItem(savedLoginKey);
    }

    const updateSavedLogin = () => {
      try {
        if (rememberEl.checked) {
          localStorage.setItem(savedLoginKey, JSON.stringify({ username: usernameEl.value, password: passwordEl.value }));
        } else {
          localStorage.removeItem(savedLoginKey);
        }
      } catch (e) {
        console.warn('ログイン情報を保存できませんでした:', e);
      }
    };

    const showError = (msg) => {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    };
    const clearError = () => errorEl.classList.add('hidden');
    const setBusy = (busy) => {
      loginBtn.disabled = busy;
      signupBtn.disabled = busy;
    };

    const onSuccess = async (user) => {
      this.currentUser = user;
      updateSavedLogin();
      clearError();
      await Promise.all([
        MasmonStore.loadFromFirestore(user.uid),
        UserProfileStore.load(user.uid, user.username),
      ]);
      this.buildFighterList();
      this.showScreen('start');
    };

    loginBtn.addEventListener('click', async () => {
      clearError();
      if (!window.FirebaseAuth) { showError('Firebaseの初期化に失敗しました'); return; }
      setBusy(true);
      try {
        const user = await window.FirebaseAuth.logIn(usernameEl.value, passwordEl.value);
        await onSuccess(window.FirebaseAuth.getCurrentUser() || { uid: user.uid, username: usernameEl.value });
      } catch (e) {
        showError(e.message);
      } finally {
        setBusy(false);
      }
    });

    signupBtn.addEventListener('click', async () => {
      clearError();
      if (!window.FirebaseAuth) { showError('Firebaseの初期化に失敗しました'); return; }
      setBusy(true);
      try {
        const user = await window.FirebaseAuth.signUp(usernameEl.value, passwordEl.value);
        await onSuccess(window.FirebaseAuth.getCurrentUser() || { uid: user.uid, username: usernameEl.value });
      } catch (e) {
        showError(e.message);
      } finally {
        setBusy(false);
      }
    });

    passwordEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginBtn.click();
    });
  },

  renderSettingsProfile() {
    if (!vpad || !vpad.el) return;
    vpad.el.nickname.value = UserProfileStore.data.nickname || (this.currentUser && this.currentUser.username) || '';
    vpad.el.diamonds.textContent = `💎 ${UserProfileStore.data.diamonds || 0}　修行券 ${UserProfileStore.data.practiceTickets || 0}`;
    const level = UserProfileStore.data.breederLevel || 1;
    const needed = UserProfileStore.breederExpForLevel(level);
    vpad.el.breeder.textContent = `ブリーダー Lv.${level}　${UserProfileStore.data.breederExp || 0} / ${needed} EXP`;
    document.querySelectorAll('.profile-icon-option').forEach(option => {
      option.classList.toggle('selected', option.dataset.profileIcon === UserProfileStore.data.iconKey);
    });
    vpad.el.profileMessage.textContent = '';
  },

  saveSettingsProfile() {
    if (!vpad || !vpad.el) return;
    const nickname = vpad.el.nickname.value.trim();
    if (!nickname) {
      vpad.el.profileMessage.textContent = 'ニックネームを入力してください';
      return;
    }
    UserProfileStore.setNickname(nickname);
    const selectedIcon = document.querySelector('.profile-icon-option.selected');
    if (selectedIcon) UserProfileStore.setIcon(selectedIcon.dataset.profileIcon);
    vpad.el.profileMessage.textContent = '保存しました';
    this._updateHomeProfile();
  },

  _resetFighterSelectState() {
    this.tokens = { p1: null, cpu1: null };
    this.activeTokenId = null;
    const tokenBar = document.getElementById('token-bar');
    if (this.selectedMode === 'cpu') {
      tokenBar.classList.remove('hidden');
      tokenBar.innerHTML = `
        <div class="token token-1p" data-token="p1">1P</div>
        <div class="token token-cpu" data-token="cpu1">CPU</div>
      `;
      this._bindTokenDrag();
    } else {
      tokenBar.classList.add('hidden');
      tokenBar.innerHTML = '';
    }
    document.getElementById('fighter-select-heading').textContent =
      this.selectedMode === 'cpu' ? '1P・CPUの玉をモンスターへ移動してください' : 'ファイター選択';
    this._renderCardBadges();
    this._updateFightButtonVisibility();
  },

  _bindTokenDrag() {
    document.querySelectorAll('#token-bar .token').forEach(token => {
      token.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        const tokenId = token.dataset.token;
        const startX = e.clientX;
        const startY = e.clientY;
        let moved = false;
        let hoveredCard = null;
        token.setPointerCapture(e.pointerId);
        token.classList.add('dragging');
        this.activeTokenId = tokenId;
        this._renderTokenBar();

        const cardAt = (x, y) => {
          token.style.pointerEvents = 'none';
          const card = document.elementFromPoint(x, y)?.closest('#fighter-list .select-card') || null;
          token.style.pointerEvents = '';
          return card;
        };
        const clearHover = () => {
          if (hoveredCard) hoveredCard.classList.remove('token-drop-target');
          hoveredCard = null;
        };

        const onMove = (moveEvent) => {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          if (Math.hypot(dx, dy) > 7) moved = true;
          token.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;
          const nextCard = cardAt(moveEvent.clientX, moveEvent.clientY);
          if (nextCard !== hoveredCard) {
            clearHover();
            hoveredCard = nextCard;
            if (hoveredCard) hoveredCard.classList.add('token-drop-target');
          }
        };

        const onEnd = (upEvent) => {
          token.removeEventListener('pointermove', onMove);
          token.removeEventListener('pointerup', onEnd);
          token.removeEventListener('pointercancel', onEnd);
          const dropCard = moved && upEvent.type !== 'pointercancel'
            ? cardAt(upEvent.clientX, upEvent.clientY)
            : null;
          clearHover();
          token.classList.remove('dragging');
          token.style.transform = '';
          if (dropCard) {
            this._placeTokenOnCard(tokenId, dropCard);
            this.suppressTokenClickUntil = Date.now() + 350;
          }
        };

        token.addEventListener('pointermove', onMove);
        token.addEventListener('pointerup', onEnd);
        token.addEventListener('pointercancel', onEnd);
      });
    });
  },

  _placeTokenOnCard(tokenId, card) {
    this.tokens[tokenId] = {
      fighterKey: card.dataset.fighter,
      masmonId: card.dataset.masmon || null,
    };
    this.activeTokenId = null;
    this._renderTokenBar();
    this._renderCardBadges();
    this._updateFightButtonVisibility();
  },

  _renderTokenBar() {
    document.querySelectorAll('#token-bar .token').forEach(el => {
      const id = el.dataset.token;
      el.classList.toggle('picked', this.activeTokenId === id);
      el.classList.toggle('placed', !!this.tokens[id]);
    });
  },

  _renderCardBadges() {
    document.querySelectorAll('#fighter-list .select-card').forEach(card => {
      card.querySelectorAll('.card-token-badge').forEach(b => b.remove());
      const fighterKey = card.dataset.fighter;
      const masmonId = card.dataset.masmon || null;
      ['p1', 'cpu1'].forEach(id => {
        const t = this.tokens[id];
        if (t && t.fighterKey === fighterKey && (t.masmonId || null) === masmonId) {
          const badge = document.createElement('span');
          badge.className = 'card-token-badge';
          badge.textContent = id === 'p1' ? '1P' : 'CPU';
          badge.style.background = id === 'p1' ? '#ff4757' : '#f5f5f5';
          badge.style.color = id === 'p1' ? '#fff' : '#222';
          card.appendChild(badge);
        }
      });
    });
  },

  _updateFightButtonVisibility() {
    const btn = document.getElementById('btn-fight-start');
    const ready = this.selectedMode === 'cpu' && this.tokens.p1 && this.tokens.cpu1;
    btn.classList.toggle('hidden', !ready);
  },

  _startFromTokens() {
    this.lastLaunchOptions = {
      stageKey: this.selectedStageKey,
      p1Key: this.tokens.p1.fighterKey,
      p2Key: this.tokens.cpu1.fighterKey,
      p1MasmonId: this.tokens.p1.masmonId,
      p2MasmonId: this.tokens.cpu1.masmonId,
      mode: this.selectedMode,
      cpuLevel: this.selectedCpuLevel,
    };
    this.playBattleIntro(this.lastLaunchOptions);
  },

  // Loading演出 → "FIGHT!" 掛け声 → バトル開始
  playBattleIntro(startOptions) {
    this.showScreen('battle-intro');
    const loadingEl = document.getElementById('battle-intro-loading');
    const fightEl = document.getElementById('battle-intro-fight');
    loadingEl.classList.remove('hidden');
    fightEl.classList.add('hidden');

    setTimeout(() => {
      loadingEl.classList.add('hidden');
      fightEl.classList.remove('hidden');
      setTimeout(() => {
        this.showScreen('battle');
        window.startBattle(startOptions);
      }, 750);
    }, 600);
  },

  // ---- バトル終了後（game.jsから呼ばれる） ----
  // result: { ranking: [{fighterIndex, rank, name, color, spriteSrc}], }
  onMatchEnd(result) {
    this.showScreen('result');
    this.renderPodium(result.ranking);

    const p1Entry = result.ranking.find(r => r.fighterIndex === 0);
    const opts = this.lastLaunchOptions || {};
    const panel = document.getElementById('result-masmon-panel');
    panel.classList.remove('hidden');

    if (opts.p1MasmonId) {
      this._renderMasmonExpResult(panel, opts, p1Entry);
    } else if (MasmonStore.loadAll().length === 0) {
      this._renderRegistrationPrompt(panel, opts);
    } else {
      panel.classList.add('hidden');
      panel.innerHTML = '';
    }

    const breederResult = UserProfileStore.addBreederExp(50);
    panel.classList.remove('hidden');
    panel.insertAdjacentHTML('beforeend', `<div class="breeder-reward">ブリーダーEXP +${breederResult.expGained}${breederResult.toLevel > breederResult.fromLevel ? ` ／ Lv.${breederResult.toLevel}にアップ！` : ''}${breederResult.ticketsGained ? ` ／ 修行券 +${breederResult.ticketsGained}` : ''}</div>`);

    if (opts.mode === 'cpu') {
      const reward = 50;
      UserProfileStore.addDiamonds(reward);
      panel.insertAdjacentHTML('beforeend', `<div class="diamond-reward">💎 ${reward}ダイヤを獲得！</div>`);
    }
    this._updateHomeProfile();
  },

  renderPodium(ranking) {
    const podium = document.getElementById('result-podium');
    podium.dataset.count = String(ranking.length);
    const sorted = [...ranking].sort((a, b) => a.rank - b.rank);
    podium.innerHTML = sorted.map(r => `
      <div class="result-entry" data-rank="${r.rank}">
        <div class="result-entry-portrait" style="${r.spriteSrc ? `background-image:url('${r.spriteSrc}')` : `background-color:${r.color}`}"></div>
        <div class="result-entry-rank">${r.rank}位</div>
        <div class="result-entry-name">${r.name}</div>
      </div>
    `).join('');
  },

  _renderRegistrationPrompt(panel, opts) {
    const fighterDef = FIGHTERS[opts.p1Key];
    panel.innerHTML = `
      <div>この子をあなただけの「マスモン」として登録しますか？</div>
      <input type="text" id="rm-name-input" placeholder="名前を入力" maxlength="12" value="${fighterDef ? fighterDef.displayName : ''}">
      <div class="rm-btn-row">
        <button class="rm-yes" id="rm-register-yes">登録する</button>
        <button class="rm-no" id="rm-register-no">今回はしない</button>
      </div>
    `;
    document.getElementById('rm-register-yes').addEventListener('click', () => {
      const name = document.getElementById('rm-name-input').value.trim() || (fighterDef ? fighterDef.displayName : 'マスモン');
      const record = MasmonStore.register(name, opts.p1Key);
      panel.innerHTML = `<div>「${record.name}」を登録しました！（Lv.${record.level}）</div>`;
      this.buildFighterList();
    });
    document.getElementById('rm-register-no').addEventListener('click', () => {
      panel.classList.add('hidden');
    });
  },

  _renderMasmonExpResult(panel, opts, p1Entry) {
    const list = MasmonStore.loadAll();
    const record = list.find(m => m.id === opts.p1MasmonId);
    if (!record) { panel.classList.add('hidden'); return; }

    const expGain = GROWTH.computeExpGain(p1Entry ? p1Entry.rank : 2, 2, opts.cpuLevel);
    const levelResult = GROWTH.addExp(record, expGain);
    MasmonStore.update(record);

    panel.innerHTML = `
      <div>${record.name} は経験値を ${expGain} 獲得！</div>
      ${levelResult.leveledUp
        ? `<div>レベルアップ！ Lv.${levelResult.fromLevel} → Lv.${levelResult.toLevel}</div><div>トレーニングチケットを ${levelResult.ticketsGained}枚 獲得！</div>`
        : `<div>現在 Lv.${record.level}</div>`}
    `;
    this.buildFighterList();
  },
};

// game.js側から window.AppFlow.onMatchEnd(...) として呼び出すため、明示的にwindowへ公開する
// （トップレベルのconst宣言はwindowのプロパティにはならないため、これが無いとリザルト画面へ遷移できない）
window.AppFlow = AppFlow;

window.addEventListener('DOMContentLoaded', () => AppFlow.init());

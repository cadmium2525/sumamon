// ==== 画面遷移フロー ====
// ローディング → スタート(TAP START) → ホーム → 地形選択 → ファイター選択(トークン配置)
// → [CPU戦のみ]CPUレベル選択 → バトル開幕演出(Loading→FIGHT!) → バトル → リザルト

const SHOP_ITEMS = [
  { id: 'vital_elixir', name: '生命の霊薬', price: 350, image: 'assets/images/items/potion-a-large.png', effect: 'ライフか丈夫さを20アップ' },
  { id: 'vital_tonic', name: '生命の小薬', price: 200, image: 'assets/images/items/potion-a-small.png', effect: 'ライフか丈夫さを10アップ' },
  { id: 'skill_elixir', name: '技巧の霊薬', price: 350, image: 'assets/images/items/potion-b-large.png', effect: '命中か回避を20アップ' },
  { id: 'skill_tonic', name: '技巧の小薬', price: 200, image: 'assets/images/items/potion-b-small.png', effect: '命中か回避を10アップ' },
  { id: 'might_elixir', name: '闘知の霊薬', price: 350, image: 'assets/images/items/potion-c-large.png', effect: 'ちからかかしこさを20アップ' },
  { id: 'might_tonic', name: '闘知の小薬', price: 200, image: 'assets/images/items/potion-c-small.png', effect: 'ちからかかしこさを10アップ' },
  { id: 'dye_kit', name: '虹彩の染色セット', price: 800, image: 'assets/images/items/dye-kit.png', effect: 'スキンの色を変更（今後実装）', comingSoon: true },
];

const AppFlow = {
  selectedMode: null,     // 'cpu' | 'multi'
  selectedStageKey: null,
  selectedCpuLevel: 3,
  selectedCpuCount: 1,
  selectedManageMasmonId: null,
  manageIdleTimer: null,

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
    if (window.DebugMotionViewer) DebugMotionViewer.init();
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
    let user = window.FirebaseAuth.getCurrentUser();
    if (!user) {
      try {
        const saved = JSON.parse(localStorage.getItem('smamon_saved_login'));
        if (saved?.username && saved?.password) {
          await window.FirebaseAuth.logIn(saved.username, saved.password);
          user = window.FirebaseAuth.getCurrentUser();
        }
      } catch (e) {
        console.warn('保存済みアカウントの自動ログインに失敗しました:', e);
      }
    }
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
    const urls = new Set([
      'assets/images/home.png', 'assets/images/logo.png', 'assets/images/app-icon.png',
      'assets/images/stage-select-background.png', 'assets/images/masmon-manage-background.png',
      'assets/images/training-background.png',
      'assets/images/battle/gong3.png', 'assets/images/battle/gong2.png',
      'assets/images/battle/gong1.png', 'assets/images/battle/gong.png',
    ]);
    SHOP_ITEMS.forEach(item => urls.add(item.image));
    const collectImages = value => {
      if (!value) return;
      if (typeof value === 'string' && /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(value)) {
        urls.add(value);
      } else if (Array.isArray(value)) {
        value.forEach(collectImages);
      } else if (typeof value === 'object') {
        Object.values(value).forEach(collectImages);
      }
    };
    collectImages(FIGHTERS);
    collectImages(STAGES);
    collectImages(window.FIGHTER_MOVESETS);

    const bar = document.getElementById('loading-bar-fill');
    const allUrls = [...urls];
    const total = allUrls.length;
    if (total === 0) { onDone(); return; }

    window.PreloadedImages = new Map();
    let loaded = 0;
    allUrls.forEach(url => {
      const img = new Image();
      const mark = () => {
        window.PreloadedImages.set(url, img);
        loaded++;
        if (bar) bar.style.width = `${Math.floor((loaded / total) * 100)}%`;
        if (loaded >= total) onDone();
      };
      img.onload = () => {
        if (img.decode) img.decode().catch(() => {}).finally(mark); else mark();
      };
      img.onerror = () => { console.error(`画像を読み込めませんでした: ${url}`); mark(); };
      img.src = url;
    });
  },

  showScreen(name) {
    if (name === 'debug' && !this._isDebugUser()) {
      console.warn('デバッグモードへのアクセスが拒否されました');
      name = 'home';
    }
    if (name !== 'masmon-manage' && this.manageIdleTimer) {
      clearInterval(this.manageIdleTimer);
      this.manageIdleTimer = null;
    }
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById('screen-' + name).classList.remove('hidden');
    if (window.DebugMotionViewer) DebugMotionViewer.setActive(name === 'debug');

    const gear = document.getElementById('vpad-settings-toggle');
    // ホームには専用の設定ボタンがあるため、共通の仮想パッド設定ボタンは隠して二重表示を防ぐ
    if (gear) gear.style.display = ['loading', 'start', 'auth', 'home'].includes(name) ? 'none' : '';

    if (name === 'home') {
      this._updateHomeProfile();
      const debugButton = document.getElementById('btn-debug');
      if (debugButton) debugButton.classList.toggle('hidden', !this._isDebugUser());
    }
    if (name === 'item-shop') this.renderItemShop();
  },

  _isDebugUser() {
    return !!(this.currentUser && String(this.currentUser.username).trim().toLowerCase() === 'cadmium');
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

  renderItemShop(message = '') {
    const diamonds = Number(UserProfileStore.data.diamonds) || 0;
    document.getElementById('shop-diamonds').textContent = `💎 ${diamonds}`;
    const inventory = UserProfileStore.data.inventory || {};
    document.getElementById('item-shop-list').innerHTML = SHOP_ITEMS.map(item => `
      <article class="shop-item-card${item.comingSoon ? ' coming-soon' : ''}">
        <img src="${item.image}" alt="${item.name}">
        <div class="shop-item-info">
          <strong>${item.name}</strong>
          <p>${item.effect}</p>
          <small>所持 ${Number(inventory[item.id]) || 0}個</small>
        </div>
        <button class="shop-buy-btn" data-shop-item="${item.id}" ${item.comingSoon ? 'disabled' : ''}>
          ${item.comingSoon ? '準備中' : `💎 ${item.price}`}
        </button>
      </article>
    `).join('');
    document.getElementById('item-shop-message').textContent = message;
  },

  purchaseShopItem(itemId) {
    const item = SHOP_ITEMS.find(entry => entry.id === itemId);
    if (!item || item.comingSoon) return;
    if (!UserProfileStore.purchaseItem(item.id, item.price)) {
      this.renderItemShop('ダイヤが足りません');
      return;
    }
    this.renderItemShop(`${item.name}を購入しました！`);
    this._updateHomeProfile();
  },

  buildStageList() {
    const list = document.getElementById('stage-list');
    list.innerHTML = Object.values(STAGES).map(s => `
      <button class="select-card${s.key === this.selectedStageKey ? ' selected' : ''}" data-stage="${s.key}" style="background-image:url('${s.background}')">
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
        localStorage.removeItem('smamon_saved_login');
        this.currentUser = null;
        MasmonStore.clearCache();
        UserProfileStore.clear();
        this.showScreen('auth');
      });
    });

    document.getElementById('btn-cpu').addEventListener('click', () => {
      this.showScreen('cpu-mode');
    });
    document.getElementById('btn-mode-1on1').addEventListener('click', () => {
      this.selectedMode = 'cpu';
      this.selectedStageKey = null;
      this.buildStageList();
      this._resetFighterSelectState();
      this.showScreen('stage-select');
    });
    document.querySelectorAll('.cpu-count-btn').forEach(button => {
      button.addEventListener('click', () => {
        this.selectedCpuCount = Math.max(1, Math.min(3, Number(button.dataset.cpuCount) || 1));
        document.querySelectorAll('.cpu-count-btn').forEach(el => el.classList.toggle('active', el === button));
      });
    });
    document.getElementById('btn-mode-hundred').addEventListener('click', () => alert('100人組手は近日実装予定です'));
    document.getElementById('btn-mode-endless').addEventListener('click', () => alert('エンドレスモードは近日実装予定です'));
    document.getElementById('btn-multi').addEventListener('click', () => {
      alert('マルチ対戦は近日実装予定です');
    });
    document.getElementById('btn-training').addEventListener('click', () => this.openMasmonManage());
    document.getElementById('btn-manage-training').addEventListener('click', () => this.openTraining());
    document.getElementById('btn-gacha').addEventListener('click', () => this.showScreen('item-shop'));
    document.getElementById('item-shop-list').addEventListener('click', event => {
      const button = event.target.closest('[data-shop-item]');
      if (button) this.purchaseShopItem(button.dataset.shopItem);
    });
    document.getElementById('btn-home-settings').addEventListener('click', () => {
      vpad.el.settingsPanel.classList.remove('hidden');
      this.renderSettingsProfile();
    });
    document.getElementById('btn-debug').addEventListener('click', () => {
      if (this._isDebugUser()) this.showScreen('debug');
    });

    document.getElementById('stage-list').addEventListener('click', (e) => {
      const card = e.target.closest('.select-card');
      if (!card) return;
      if (this.selectedStageKey !== card.dataset.stage) {
        this.selectedStageKey = card.dataset.stage;
        document.querySelectorAll('#stage-list .select-card').forEach(el => el.classList.toggle('selected', el === card));
        return;
      }
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

    document.querySelectorAll('[data-back]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.back === 'masmon-manage') {
          this.openMasmonManage();
          return;
        }
        this.showScreen(btn.dataset.back);
      });
    });

    document.getElementById('btn-result-continue').addEventListener('click', () => {
      this.showScreen('home');
    });

    document.getElementById('masmon-roster').addEventListener('click', (e) => {
      const card = e.target.closest('[data-masmon-id]');
      if (!card) return;
      this.selectedManageMasmonId = card.dataset.masmonId;
      this.renderMasmonManage();
    });

    document.getElementById('training-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-training]');
      if (btn) this.performTraining(btn.dataset.training);
    });
  },

  openMasmonManage() {
    this.showScreen('masmon-manage');
    const list = MasmonStore.loadAll();
    if (!list.some(m => m.id === this.selectedManageMasmonId)) {
      this.selectedManageMasmonId = list[0]?.id || null;
    }
    this.renderMasmonManage();
  },

  renderMasmonManage() {
    const list = MasmonStore.loadAll();
    const roster = document.getElementById('masmon-roster');
    const image = document.getElementById('masmon-current-image');
    const name = document.getElementById('masmon-current-name');
    if (!list.length) {
      image.removeAttribute('src');
      image.style.display = 'none';
      name.textContent = '所持マスモンがいません';
      roster.textContent = 'CPU戦後にマスモンを登録できます';
      return;
    }
    image.style.display = '';
    roster.innerHTML = list.map(m => {
      const base = FIGHTERS[m.baseFighterKey] || {};
      const selected = m.id === this.selectedManageMasmonId ? ' selected' : '';
      return `<button class="masmon-roster-card${selected}" data-masmon-id="${m.id}" aria-label="マスモンを選択">
        <img src="${base.idleImage || ''}" alt=""><span></span><small>Lv.${m.level}</small>
      </button>`;
    }).join('');
    list.forEach((m, index) => {
      const label = roster.children[index]?.querySelector('span');
      if (label) label.textContent = m.name;
    });
    const selected = list.find(m => m.id === this.selectedManageMasmonId);
    if (selected) {
      const base = FIGHTERS[selected.baseFighterKey] || {};
      this._startManageIdleAnimation(base, image);
      name.textContent = `${selected.name}　Lv.${selected.level}`;
    }
  },

  _startManageIdleAnimation(base, image) {
    if (this.manageIdleTimer) {
      clearInterval(this.manageIdleTimer);
      this.manageIdleTimer = null;
    }
    const frames = base.idleFrameSrcs?.length ? base.idleFrameSrcs : [base.idleImage].filter(Boolean);
    if (!frames.length) {
      image.removeAttribute('src');
      return;
    }
    let frameIndex = 0;
    image.src = frames[frameIndex];
    if (frames.length === 1) return;
    const frameMs = Math.max(80, (base.idleFrameDuration || 8) * (1000 / 60));
    this.manageIdleTimer = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      image.src = frames[frameIndex];
    }, frameMs);
  },

  openTraining() {
    if (!this._selectedManageMasmon()) {
      const firstMasmon = MasmonStore.loadAll()[0];
      if (!firstMasmon) {
        alert('トレーニングできるマスモンがいません');
        return;
      }
      this.selectedManageMasmonId = firstMasmon.id;
    }
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
      accuracy: 'クリティカル率', evasion: '移動速度', defense: '吹っ飛びにくさ',
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
    this.tokens = { p1: null };
    for (let i = 1; i <= this.selectedCpuCount; i++) this.tokens[`cpu${i}`] = null;
    this.activeTokenId = null;
    const tokenBar = document.getElementById('token-bar');
    if (this.selectedMode === 'cpu') {
      tokenBar.classList.remove('hidden');
      tokenBar.innerHTML = `<div class="token token-1p" data-token="p1">1P</div>` +
        Array.from({ length: this.selectedCpuCount }, (_, i) =>
          `<div class="token token-cpu" data-token="cpu${i + 1}">CPU${i + 1}</div>`).join('');
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
    document.querySelectorAll('#token-bar .token, #fighter-list .card-token-badge').forEach(token => {
      if (token.dataset.dragBound === 'true') return;
      token.dataset.dragBound = 'true';
      token.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        const tokenId = token.dataset.token;
        const startX = e.clientX;
        const startY = e.clientY;
        let moved = false;
        let hoveredCard = null;
        const isPlacedToken = token.classList.contains('card-token-badge');
        const dragVisual = isPlacedToken ? token.cloneNode(true) : token;
        if (isPlacedToken) {
          const rect = token.getBoundingClientRect();
          dragVisual.classList.add('dragging', 'token-drag-ghost');
          dragVisual.style.left = `${rect.left}px`;
          dragVisual.style.top = `${rect.top}px`;
          dragVisual.style.width = `${rect.width}px`;
          dragVisual.style.height = `${rect.height}px`;
          document.body.appendChild(dragVisual);
          token.classList.add('drag-source');
        }
        token.setPointerCapture(e.pointerId);
        if (!isPlacedToken) token.classList.add('dragging');
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
          dragVisual.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;
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
          token.classList.remove('drag-source');
          dragVisual.style.transform = '';
          if (isPlacedToken) dragVisual.remove();
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
      ['p1', ...Array.from({ length: this.selectedCpuCount }, (_, i) => `cpu${i + 1}`)].forEach((id, tokenIndex) => {
        const t = this.tokens[id];
        if (t && t.fighterKey === fighterKey && (t.masmonId || null) === masmonId) {
          const badge = document.createElement('span');
          badge.className = 'card-token-badge';
          badge.dataset.token = id;
          badge.textContent = id === 'p1' ? '1P' : id.toUpperCase();
          badge.style.background = id === 'p1' ? '#ff4757' : '#f5f5f5';
          badge.style.color = id === 'p1' ? '#fff' : '#222';
          badge.style.left = `${6 + tokenIndex * 25}px`;
          card.appendChild(badge);
        }
      });
    });
    this._bindTokenDrag();
  },

  _updateFightButtonVisibility() {
    const btn = document.getElementById('btn-fight-start');
    const cpuTokens = Array.from({ length: this.selectedCpuCount }, (_, i) => this.tokens[`cpu${i + 1}`]);
    const ready = this.selectedMode === 'cpu' && this.tokens.p1 && cpuTokens.every(Boolean);
    btn.classList.toggle('hidden', !ready);
  },

  _startFromTokens() {
    const cpuFighters = Array.from({ length: this.selectedCpuCount }, (_, i) => {
      const token = this.tokens[`cpu${i + 1}`];
      return { fighterKey: token.fighterKey, masmonId: token.masmonId };
    });
    this.lastLaunchOptions = {
      stageKey: this.selectedStageKey,
      p1Key: this.tokens.p1.fighterKey,
      p2Key: this.tokens.cpu1.fighterKey,
      p1MasmonId: this.tokens.p1.masmonId,
      p2MasmonId: this.tokens.cpu1.masmonId,
      cpuCount: this.selectedCpuCount,
      cpuFighters,
      mode: this.selectedMode,
      cpuLevel: this.selectedCpuLevel,
    };
    this.playBattleIntro(this.lastLaunchOptions);
  },

  // Loading後にバトル画面へ移り、操作不能の3・2・1・FIGHTカウントを表示する。
  async playBattleIntro(startOptions) {
    this.showScreen('battle-intro');
    const loadingEl = document.getElementById('battle-intro-loading');
    const fightEl = document.getElementById('battle-intro-fight');
    loadingEl.classList.remove('hidden');
    fightEl.classList.add('hidden');
    await new Promise(resolve => setTimeout(resolve, 600));
    this.showScreen('battle');
    window.startBattle(startOptions);
    const overlay = document.getElementById('battle-countdown');
    const image = document.getElementById('battle-countdown-image');
    const text = document.getElementById('battle-countdown-text');
    overlay.classList.remove('hidden');
    const steps = [
      { file: 'gong3.png', text: '3', ms: 700 }, { file: 'gong2.png', text: '2', ms: 700 },
      { file: 'gong1.png', text: '1', ms: 700 }, { file: 'gong.png', text: 'FIGHT!', ms: 650 },
    ];
    for (const step of steps) {
      image.classList.toggle('gong-final', step.file === 'gong.png');
      text.textContent = step.text;
      text.style.display = '';
      image.style.display = 'none';
      image.onload = () => { image.style.display = ''; text.style.display = 'none'; };
      image.onerror = () => { image.style.display = 'none'; text.style.display = ''; };
      const countdownPath = `assets/images/battle/${step.file}`;
      const cached = window.PreloadedImages?.get(countdownPath);
      image.src = cached?.src || countdownPath;
      if (cached?.complete && cached.naturalWidth > 0) {
        image.style.display = '';
        text.style.display = 'none';
      }
      await new Promise(resolve => setTimeout(resolve, step.ms));
    }
    overlay.classList.add('hidden');
    image.classList.remove('gong-final');
    window.setBattleInputLocked(false);
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
    } else if (p1Entry && p1Entry.rank === 1) {
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
        <div class="result-entry-record">撃墜 ${r.kos || 0} / 被撃墜 ${r.falls || 0}${r.selfDestructs ? ` / 自滅 ${r.selfDestructs}` : ''}</div>
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

    const expResult = GROWTH.computeBattleExp({
      placement: p1Entry ? p1Entry.rank : (opts.cpuCount || 1) + 1,
      totalFighters: (opts.cpuCount || 1) + 1,
      kos: p1Entry?.kos || 0,
      falls: p1Entry?.falls || 0,
      cpuLevel: opts.cpuLevel,
    });
    const expGain = expResult.total;
    const startLevel = record.level;
    const startExp = record.exp;
    const levelResult = GROWTH.addExp(record, expGain);
    MasmonStore.update(record);

    panel.innerHTML = `
      <div class="masmon-exp-result">
        <div><strong>${record.name}</strong>　EXP +${expGain}</div>
        <div class="exp-breakdown">順位 +${expResult.placementExp} ／ 撃墜 +${expResult.koExp} ／ 被撃墜 -${expResult.fallPenalty} ／ CPU倍率 ×${expResult.levelMultiplier.toFixed(1)}</div>
        <div class="masmon-exp-heading"><b id="masmon-exp-level">Lv.${startLevel}</b><span id="masmon-exp-numbers"></span></div>
        <div class="masmon-exp-track"><div id="masmon-exp-fill" class="masmon-exp-fill"></div></div>
        <div id="masmon-level-callout" class="masmon-level-callout"></div>
      </div>
      ${levelResult.leveledUp
        ? `<div>レベルアップ！ Lv.${levelResult.fromLevel} → Lv.${levelResult.toLevel}</div><div>トレーニングチケットを ${levelResult.ticketsGained}枚 獲得！</div>`
        : `<div>現在 Lv.${record.level}</div>`}
    `;
    this._animateMasmonExp(startLevel, startExp, expGain);
    this.buildFighterList();
  },

  async _animateMasmonExp(startLevel, startExp, expGain) {
    const levelEl = document.getElementById('masmon-exp-level');
    const numbersEl = document.getElementById('masmon-exp-numbers');
    const fillEl = document.getElementById('masmon-exp-fill');
    const calloutEl = document.getElementById('masmon-level-callout');
    if (!levelEl || !numbersEl || !fillEl || !calloutEl) return;

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    let level = startLevel;
    let exp = startExp;
    let remaining = expGain;

    while (remaining > 0 && level < GROWTH.LEVEL_MAX) {
      const required = GROWTH.expForLevel(level);
      const gainedThisLevel = Math.min(remaining, required - exp);
      const nextExp = exp + gainedThisLevel;
      levelEl.textContent = `Lv.${level}`;
      numbersEl.textContent = `${exp} / ${required}`;
      fillEl.style.transition = 'none';
      fillEl.style.width = `${Math.min(100, exp / required * 100)}%`;
      void fillEl.offsetWidth;
      fillEl.style.transition = 'width 700ms cubic-bezier(.2,.8,.2,1)';
      fillEl.style.width = `${Math.min(100, nextExp / required * 100)}%`;
      await wait(720);
      numbersEl.textContent = `${nextExp} / ${required}`;
      exp = nextExp;
      remaining -= gainedThisLevel;

      if (exp >= required) {
        level++;
        calloutEl.textContent = `LEVEL UP!　Lv.${level}`;
        calloutEl.classList.remove('show');
        void calloutEl.offsetWidth;
        calloutEl.classList.add('show');
        await wait(520);
        exp = 0;
        if (level < GROWTH.LEVEL_MAX) {
          const nextRequired = GROWTH.expForLevel(level);
          levelEl.textContent = `Lv.${level}`;
          numbersEl.textContent = `0 / ${nextRequired}`;
          fillEl.style.transition = 'none';
          fillEl.style.width = '0%';
          void fillEl.offsetWidth;
        }
      }
    }

    if (level >= GROWTH.LEVEL_MAX) {
      levelEl.textContent = `Lv.${GROWTH.LEVEL_MAX}`;
      numbersEl.textContent = 'MAX';
      fillEl.style.width = '100%';
    }
  },
};

// game.js側から window.AppFlow.onMatchEnd(...) として呼び出すため、明示的にwindowへ公開する
// （トップレベルのconst宣言はwindowのプロパティにはならないため、これが無いとリザルト画面へ遷移できない）
window.AppFlow = AppFlow;

window.addEventListener('DOMContentLoaded', () => AppFlow.init());

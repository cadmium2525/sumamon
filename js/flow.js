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

const STAT_ITEM_EFFECTS = {
  vital_elixir: { amount: 20, stats: ['life', 'defense'] },
  vital_tonic: { amount: 10, stats: ['life', 'defense'] },
  skill_elixir: { amount: 20, stats: ['accuracy', 'evasion'] },
  skill_tonic: { amount: 10, stats: ['accuracy', 'evasion'] },
  might_elixir: { amount: 20, stats: ['power', 'intelligence'] },
  might_tonic: { amount: 10, stats: ['power', 'intelligence'] },
};

const AppFlow = {
  selectedMode: null,     // 'cpu' | 'multi'
  selectedCpuMode: 'normal',
  selectedStageKey: null,
  selectedCpuLevel: 3,
  selectedCpuCount: 1,
  selectedManageMasmonId: null,
  manageIdleTimer: null,
  shopToastTimer: null,
  trainingItemToastTimer: null,

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
    if (window.Multiplayer) Multiplayer.init();
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
      'assets/images/training-background.png', 'assets/images/fighter-select-background.png',
      'assets/images/ui/training-ticket.png', 'assets/images/ui/practice-ticket.png',
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
    if (name !== 'item-shop') this.closePurchaseModal();
    if (name !== 'training') this.closeTrainingItemModal();
    if (name !== 'fighter-select') document.getElementById('fighter-status-modal')?.classList.add('hidden');
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
    if (name === 'mypage') this.renderMyPage();
    if (name === 'item-shop') this.renderItemShop();
    if (window.AudioManager) AudioManager.setScene(name, this.selectedMode);
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

  renderItemShop() {
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
  },

  openPurchaseModal(itemId) {
    const item = SHOP_ITEMS.find(entry => entry.id === itemId);
    if (!item || item.comingSoon) return;
    const modal = document.getElementById('shop-purchase-modal');
    modal.dataset.itemId = item.id;
    document.getElementById('shop-modal-image').src = item.image;
    document.getElementById('shop-modal-image').alt = item.name;
    document.getElementById('shop-modal-title').textContent = item.name;
    document.getElementById('shop-modal-effect').textContent = item.effect;
    document.getElementById('shop-quantity').value = '1';
    this.updatePurchaseModal();
    modal.classList.remove('hidden');
  },

  closePurchaseModal() {
    const modal = document.getElementById('shop-purchase-modal');
    if (modal) modal.classList.add('hidden');
  },

  updatePurchaseModal(nextQuantity) {
    const modal = document.getElementById('shop-purchase-modal');
    if (!modal) return;
    const item = SHOP_ITEMS.find(entry => entry.id === modal.dataset.itemId);
    if (!item) return;
    const input = document.getElementById('shop-quantity');
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(nextQuantity ?? input.value) || 1)));
    input.value = String(quantity);
    const total = item.price * quantity;
    document.getElementById('shop-modal-total').textContent = `合計 💎 ${total}`;
    const confirmButton = document.getElementById('shop-purchase-confirm');
    const canAfford = (Number(UserProfileStore.data.diamonds) || 0) >= total;
    confirmButton.disabled = !canAfford;
    confirmButton.textContent = canAfford ? '購入する' : 'ダイヤが足りません';
  },

  confirmShopPurchase() {
    const modal = document.getElementById('shop-purchase-modal');
    const item = SHOP_ITEMS.find(entry => entry.id === modal.dataset.itemId);
    if (!item) return;
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(document.getElementById('shop-quantity').value) || 1)));
    if (!UserProfileStore.purchaseItem(item.id, item.price, quantity)) {
      this.updatePurchaseModal(quantity);
      return;
    }
    this.closePurchaseModal();
    this.renderItemShop();
    this._updateHomeProfile();
    this.showShopToast(`${item.name}を${quantity}個購入しました！`);
  },

  showShopToast(message) {
    const toast = document.getElementById('item-shop-toast');
    clearTimeout(this.shopToastTimer);
    toast.textContent = message;
    toast.classList.remove('hidden', 'show');
    void toast.offsetWidth;
    toast.classList.add('show');
    this.shopToastTimer = setTimeout(() => toast.classList.add('hidden'), 2600);
  },

  openCpuMode(mode) {
    this.selectedMode = 'cpu';
    this.selectedCpuMode = mode;
    this.selectedCpuLevel = mode === 'normal' ? this.selectedCpuLevel : 1;
    this.selectedStageKey = null;
    this.buildStageList();
    this._resetFighterSelectState();
    this.showScreen('stage-select');
  },

  async openEndlessRanking() {
    const modal = document.getElementById('endless-ranking-modal');
    const list = document.getElementById('endless-ranking-list');
    modal.classList.remove('hidden');
    list.innerHTML = '<div class="ranking-loading">ランキングを読み込み中…</div>';
    const rankings = await UserProfileStore.loadEndlessRankings();
    if (!rankings.length) {
      list.innerHTML = '<div class="ranking-loading">まだ記録がありません</div>';
      return;
    }
    list.innerHTML = rankings.slice(0, 50).map((entry, index) => `
      <div class="endless-ranking-entry${entry.uid === this.currentUser?.uid ? ' is-me' : ''}">
        <b>${index + 1}</b><img src="${this._profileIconSrc(entry.iconKey)}" alt="">
        <span><strong>${this.escapeHtml(entry.nickname || 'ブリーダー')}</strong><small>${new Date(entry.achievedAt || 0).toLocaleDateString('ja-JP')}</small></span>
        <em>${Math.max(0, Number(entry.score) || 0)}体</em>
      </div>`).join('');
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
        hundredBadge: !!m.badges?.hundred,
      });
    });
    list.innerHTML = templateCards.join('') + masmonCards.join('');
  },

  _fighterCardHtml({ fighterKey, masmonId, label, img, color, hundredBadge = false }) {
    const bg = img ? `background-image:url('${img}')` : `background-color:${color}`;
    return `
      <button class="select-card fighter-card" data-fighter="${fighterKey}" ${masmonId ? `data-masmon="${masmonId}"` : ''} style="${bg}">
        ${hundredBadge ? '<span class="hundred-clear-badge" title="100人組手クリア">100</span>' : ''}
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
      this.showScreen('mypage');
    });

    document.querySelectorAll('.mypage-icon-option').forEach(option => {
      option.addEventListener('click', () => {
        document.querySelectorAll('.mypage-icon-option').forEach(item => item.classList.toggle('selected', item === option));
        document.getElementById('mypage-current-icon').src = this._profileIconSrc(option.dataset.mypageIcon);
      });
    });
    document.getElementById('mypage-save').addEventListener('click', () => this.saveMyPage());
    document.getElementById('mypage-logout').addEventListener('click', () => this.logoutFromMyPage());
    document.querySelectorAll('.mypage-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchMyPageTab(tab.dataset.mypageTab));
    });

    document.getElementById('btn-cpu').addEventListener('click', () => {
      this.selectedMode = 'cpu';
      this.showScreen('cpu-mode');
    });
    document.getElementById('btn-mode-1on1').addEventListener('click', () => {
      this.openCpuMode('normal');
    });
    document.querySelectorAll('.cpu-count-btn').forEach(button => {
      button.addEventListener('click', () => {
        this.selectedCpuCount = Math.max(1, Math.min(3, Number(button.dataset.cpuCount) || 1));
        document.querySelectorAll('.cpu-count-btn').forEach(el => el.classList.toggle('active', el === button));
      });
    });
    document.getElementById('btn-mode-hundred').addEventListener('click', () => this.openCpuMode('hundred'));
    document.getElementById('btn-mode-endless').addEventListener('click', () => this.openCpuMode('endless'));
    document.getElementById('btn-endless-ranking').addEventListener('click', () => this.openEndlessRanking());
    document.getElementById('endless-ranking-close').addEventListener('click', () => document.getElementById('endless-ranking-modal').classList.add('hidden'));
    document.getElementById('endless-ranking-modal').addEventListener('click', event => {
      if (event.target.id === 'endless-ranking-modal') event.currentTarget.classList.add('hidden');
    });
    document.getElementById('btn-multi').addEventListener('click', () => {
      this.selectedMode = 'multi';
      if (window.Multiplayer) Multiplayer.openMenu();
    });
    document.getElementById('btn-training').addEventListener('click', () => this.openMasmonManage());
    document.getElementById('btn-manage-training').addEventListener('click', () => this.openTraining());
    document.getElementById('btn-gacha').addEventListener('click', () => this.showScreen('item-shop'));
    document.getElementById('item-shop-list').addEventListener('click', event => {
      const button = event.target.closest('[data-shop-item]');
      if (button) this.openPurchaseModal(button.dataset.shopItem);
    });
    document.getElementById('shop-modal-close').addEventListener('click', () => this.closePurchaseModal());
    document.getElementById('shop-purchase-modal').addEventListener('click', event => {
      if (event.target.id === 'shop-purchase-modal') this.closePurchaseModal();
    });
    document.getElementById('shop-quantity-minus').addEventListener('click', () => {
      this.updatePurchaseModal(Number(document.getElementById('shop-quantity').value) - 1);
    });
    document.getElementById('shop-quantity-plus').addEventListener('click', () => {
      this.updatePurchaseModal(Number(document.getElementById('shop-quantity').value) + 1);
    });
    document.getElementById('shop-quantity').addEventListener('input', () => this.updatePurchaseModal());
    document.getElementById('shop-purchase-confirm').addEventListener('click', () => this.confirmShopPurchase());
    document.getElementById('btn-home-settings').addEventListener('click', () => {
      vpad.el.settingsPanel.classList.remove('hidden');
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
      if (Date.now() < (this.suppressFighterCardClickUntil || 0)) return;
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
    this.bindFighterStatusLongPress();
    document.getElementById('fighter-status-close').addEventListener('click', () => this.closeFighterStatus());
    document.getElementById('fighter-status-modal').addEventListener('click', event => {
      if (event.target.id === 'fighter-status-modal') this.closeFighterStatus();
    });

    document.getElementById('btn-fight-start').addEventListener('click', () => {
      if (this.selectedCpuMode === 'normal') this.showScreen('cpu-level');
      else this._startFromTokens();
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
      if ((this.lastLaunchOptions || {}).mode === 'multi' && window.Multiplayer) Multiplayer.leaveRoom(false);
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
    document.getElementById('btn-use-training-item').addEventListener('click', () => this.openTrainingItemModal());
    document.getElementById('training-item-close').addEventListener('click', () => this.closeTrainingItemModal());
    document.getElementById('training-item-modal').addEventListener('click', event => {
      if (event.target.id === 'training-item-modal') this.closeTrainingItemModal();
    });
    document.getElementById('training-item-list').addEventListener('click', event => {
      const button = event.target.closest('[data-use-item]');
      if (button) this.useTrainingItem(button.dataset.useItem, button.dataset.stat);
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
        <img src="${base.idleImage || ''}" alt="">${m.badges?.hundred ? '<i class="hundred-clear-badge">100</i>' : ''}<span></span><small>Lv.${m.level}</small>
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
    document.getElementById('training-summary').innerHTML = `<strong>${m.name} Lv.${m.level}</strong><span class="ticket-count"><img src="assets/images/ui/training-ticket.png" alt="">${m.trainingTickets || 0}枚</span>
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

  openTrainingItemModal() {
    const monster = this._selectedManageMasmon();
    if (!monster) return;
    const inventory = UserProfileStore.data.inventory || {};
    const statLabels = { life: 'ライフ', power: 'ちから', intelligence: 'かしこさ', accuracy: '命中', evasion: '回避', defense: '丈夫さ' };
    const ownedItems = SHOP_ITEMS.filter(item => STAT_ITEM_EFFECTS[item.id] && (Number(inventory[item.id]) || 0) > 0);
    document.getElementById('training-item-list').innerHTML = ownedItems.length ? ownedItems.map(item => {
      const effect = STAT_ITEM_EFFECTS[item.id];
      return `<article class="training-use-card">
        <img src="${item.image}" alt="${item.name}">
        <div><strong>${item.name} ×${Number(inventory[item.id]) || 0}</strong><small>選んだ能力を+${effect.amount}</small>
          <div class="training-use-actions">${effect.stats.map(stat => `<button data-use-item="${item.id}" data-stat="${stat}">${statLabels[stat]} +${effect.amount}</button>`).join('')}</div>
        </div>
      </article>`;
    }).join('') : '<div class="training-use-empty">使用できるステータスアイテムを所持していません</div>';
    document.getElementById('training-item-modal').classList.remove('hidden');
  },

  closeTrainingItemModal() {
    document.getElementById('training-item-modal')?.classList.add('hidden');
  },

  useTrainingItem(itemId, statKey) {
    const monster = this._selectedManageMasmon();
    const effect = STAT_ITEM_EFFECTS[itemId];
    if (!monster || !effect || !effect.stats.includes(statKey)) return;
    if (!UserProfileStore.consumeItem(itemId, 1)) {
      this.openTrainingItemModal();
      return;
    }
    monster.trainingStats = { ...(monster.trainingStats || {}) };
    monster.trainingStats[statKey] = Math.max(0, Number(monster.trainingStats[statKey]) || 0) + effect.amount;
    MasmonStore.update(monster);
    const item = SHOP_ITEMS.find(entry => entry.id === itemId);
    const statLabels = { life: 'ライフ', power: 'ちから', intelligence: 'かしこさ', accuracy: '命中', evasion: '回避', defense: '丈夫さ' };
    this.renderTraining(`${item?.name || 'アイテム'}を使用：${statLabels[statKey]} +${effect.amount}`);
    this.renderMasmonManage();
    this.closeTrainingItemModal();
    this.showTrainingItemToast(item, monster, statLabels[statKey], effect.amount);
  },

  showTrainingItemToast(item, monster, statLabel, amount) {
    const toast = document.getElementById('training-item-toast');
    if (!toast) return;
    clearTimeout(this.trainingItemToastTimer);
    const image = document.getElementById('training-item-toast-image');
    image.src = item?.image || '';
    image.alt = item?.name || '使用したアイテム';
    document.getElementById('training-item-toast-title').textContent = `${item?.name || 'アイテム'}を使用！`;
    document.getElementById('training-item-toast-message').textContent = `${monster.name}の${statLabel}が ${amount} アップしました！`;
    toast.classList.remove('hidden', 'show');
    void toast.offsetWidth;
    toast.classList.add('show');
    this.trainingItemToastTimer = setTimeout(() => toast.classList.add('hidden'), 2800);
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

  renderMyPage() {
    if (!this.currentUser) return;
    const nickname = UserProfileStore.data.nickname || this.currentUser.username || '';
    const level = UserProfileStore.data.breederLevel || 1;
    const exp = UserProfileStore.data.breederExp || 0;
    const needed = UserProfileStore.breederExpForLevel(level);
    const iconKey = UserProfileStore.data.iconKey || 'irumine';
    document.getElementById('mypage-username').textContent = `USER: ${this.currentUser.username}`;
    document.getElementById('mypage-current-name').textContent = nickname;
    document.getElementById('mypage-current-icon').src = this._profileIconSrc(iconKey);
    document.getElementById('mypage-breeder-level').textContent = `ブリーダー Lv.${level}`;
    document.getElementById('mypage-exp-text').textContent = `${exp} / ${needed} EXP`;
    document.getElementById('mypage-exp-fill').style.width = `${Math.min(100, exp / needed * 100)}%`;
    document.getElementById('mypage-diamonds').textContent = `💎 ${UserProfileStore.data.diamonds || 0}`;
    document.getElementById('mypage-practice-tickets').textContent = `修行券 ${UserProfileStore.data.practiceTickets || 0}`;
    document.getElementById('mypage-nickname').value = nickname;
    document.querySelectorAll('.mypage-icon-option').forEach(option => {
      option.classList.toggle('selected', option.dataset.mypageIcon === iconKey);
    });
    document.getElementById('mypage-message').textContent = '';
    this.renderMyPageItems();
    this.renderMyPageRecords();
  },

  switchMyPageTab(tabName) {
    document.querySelectorAll('.mypage-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mypageTab === tabName));
    document.querySelectorAll('.mypage-pane').forEach(pane => pane.classList.toggle('hidden', pane.dataset.mypagePane !== tabName));
  },

  renderMyPageItems() {
    const inventory = UserProfileStore.data.inventory || {};
    const masmons = MasmonStore.loadAll();
    const trainingTickets = masmons.reduce((sum, monster) => sum + Math.max(0, Number(monster.trainingTickets) || 0), 0);
    const ticketDetails = masmons.filter(monster => (Number(monster.trainingTickets) || 0) > 0)
      .map(monster => `${this.escapeHtml(monster.name)} ${monster.trainingTickets}枚`).join(' ／ ');
    const items = [
      { name: 'トレーニングチケット', image: 'assets/images/ui/training-ticket.png', count: trainingTickets, detail: ticketDetails || '所持マスモン共通 0枚' },
      { name: '修行チケット', image: 'assets/images/ui/practice-ticket.png', count: UserProfileStore.data.practiceTickets || 0, detail: '5ブリーダーレベルごとに獲得' },
      ...SHOP_ITEMS.map(item => ({ name: item.name, image: item.image, count: Number(inventory[item.id]) || 0, detail: item.effect })),
    ];
    document.getElementById('mypage-item-list').innerHTML = items.map(item => `
      <article class="mypage-item-card">
        <img src="${item.image}" alt="${item.name}">
        <div><strong>${item.name}</strong><small>${item.detail}</small></div>
        <b>${item.count}</b>
      </article>
    `).join('');
  },

  renderMyPageRecords() {
    const records = UserProfileStore.data.battleRecords || {};
    const entries = [
      { label: 'CPU戦・通常バトル', record: records.cpu?.normal },
      { label: 'CPU戦・100人組手', record: records.cpu?.hundred },
      { label: 'CPU戦・エンドレス', record: records.cpu?.endless },
      { label: 'マルチ対戦', record: records.multi },
    ];
    document.getElementById('mypage-record-list').innerHTML = entries.map(entry => {
      const record = entry.record || { matches: 0, wins: 0, losses: 0, kos: 0, falls: 0, selfDestructs: 0, bestRank: 0 };
      const winRate = record.matches ? Math.round(record.wins / record.matches * 100) : 0;
      return `<article class="mypage-record-card${entry.comingSoon ? ' coming-soon' : ''}">
        <div><strong>${entry.label}</strong>${entry.comingSoon ? '<small>近日実装予定</small>' : ''}</div>
        <dl>
          <div><dt>対戦</dt><dd>${record.matches}</dd></div>
          <div><dt>勝利</dt><dd>${record.wins}</dd></div>
          <div><dt>勝率</dt><dd>${winRate}%</dd></div>
          <div><dt>撃墜</dt><dd>${record.kos}</dd></div>
          <div><dt>被撃墜</dt><dd>${record.falls}</dd></div>
          <div><dt>最高順位</dt><dd>${record.bestRank ? `${record.bestRank}位` : '―'}</dd></div>
        </dl>
      </article>`;
    }).join('');
  },

  escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value || '');
    return div.innerHTML;
  },

  saveMyPage() {
    const message = document.getElementById('mypage-message');
    const nickname = document.getElementById('mypage-nickname').value.trim();
    if (!nickname) {
      message.textContent = 'ニックネームを入力してください';
      return;
    }
    UserProfileStore.setNickname(nickname);
    const selectedIcon = document.querySelector('.mypage-icon-option.selected');
    if (selectedIcon) UserProfileStore.setIcon(selectedIcon.dataset.mypageIcon);
    this._updateHomeProfile();
    this.renderMyPage();
    document.getElementById('mypage-message').textContent = 'プロフィールを保存しました';
  },

  logoutFromMyPage() {
    if (!this.currentUser || !confirm('ログアウトしますか？')) return;
    window.FirebaseAuth.logOut().then(() => {
      localStorage.removeItem('smamon_saved_login');
      this.currentUser = null;
      MasmonStore.clearCache();
      UserProfileStore.clear();
      this.showScreen('auth');
    });
  },

  bindFighterStatusLongPress() {
    const list = document.getElementById('fighter-list');
    list.addEventListener('contextmenu', event => event.preventDefault());
    list.addEventListener('pointerdown', event => {
      if (event.button != null && event.button !== 0) return;
      if (event.target.closest('.card-token-badge')) return;
      const card = event.target.closest('.fighter-card');
      if (!card) return;
      const startX = event.clientX;
      const startY = event.clientY;
      let timer = setTimeout(() => {
        timer = null;
        this.suppressFighterCardClickUntil = Date.now() + 700;
        this.showFighterStatus(card);
      }, 550);
      const cancel = moveEvent => {
        if (moveEvent.type === 'pointermove' && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 12) return;
        if (timer) clearTimeout(timer);
        timer = null;
        window.removeEventListener('pointermove', cancel);
        window.removeEventListener('pointerup', cancel);
        window.removeEventListener('pointercancel', cancel);
      };
      window.addEventListener('pointermove', cancel);
      window.addEventListener('pointerup', cancel);
      window.addEventListener('pointercancel', cancel);
    });
  },

  showFighterStatus(card) {
    const def = FIGHTERS[card.dataset.fighter] || FIGHTERS.irumine;
    const monster = card.dataset.masmon
      ? MasmonStore.loadAll().find(item => item.id === card.dataset.masmon)
      : null;
    const stats = monster
      ? GROWTH.computeStatsAtLevel({ ...defaultStats(), trainingStats: monster.trainingStats }, monster.aptitudes, monster.level)
      : { ...defaultStats(), ...(def.stats || {}) };
    const labels = { life: 'ライフ', power: 'ちから', intelligence: 'かしこさ', accuracy: '命中', evasion: '回避', defense: '丈夫さ' };
    document.getElementById('fighter-status-image').src = def.idleImage;
    document.getElementById('fighter-status-name').textContent = monster ? monster.name : def.displayName;
    document.getElementById('fighter-status-level').textContent = monster ? `Lv.${monster.level}` : 'ベースモンスター';
    document.getElementById('fighter-status-grid').innerHTML = GROWTH.STAT_KEYS.map(key => `
      <div><span>${labels[key]}</span><b>${stats[key]}</b>${monster ? `<small>適性 ${monster.aptitudes?.[key] || 'C'}</small>` : ''}</div>
    `).join('');
    document.getElementById('fighter-status-modal').classList.remove('hidden');
  },

  closeFighterStatus() {
    document.getElementById('fighter-status-modal').classList.add('hidden');
  },

  _resetFighterSelectState() {
    const survivalMode = ['hundred', 'endless'].includes(this.selectedCpuMode);
    this.tokens = { p1: null };
    if (!survivalMode) {
      for (let i = 1; i <= this.selectedCpuCount; i++) this.tokens[`cpu${i}`] = null;
    }
    this.activeTokenId = null;
    const tokenBar = document.getElementById('token-bar');
    if (this.selectedMode === 'cpu') {
      tokenBar.classList.remove('hidden');
      tokenBar.innerHTML = `<div class="token token-1p" data-token="p1">1P</div>` +
        Array.from({ length: survivalMode ? 0 : this.selectedCpuCount }, (_, i) =>
          `<div class="token token-cpu" data-token="cpu${i + 1}">CPU${i + 1}</div>`).join('');
      this._bindTokenDrag();
    } else {
      tokenBar.classList.add('hidden');
      tokenBar.innerHTML = '';
    }
    document.getElementById('fighter-select-heading').textContent = survivalMode
      ? `${this.selectedCpuMode === 'hundred' ? '100人組手' : 'エンドレス'} 使用モンスター選択`
      : this.selectedMode === 'cpu' ? '1P・CPUの玉をモンスターへ移動してください' : 'ファイター選択';
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
    const survivalMode = ['hundred', 'endless'].includes(this.selectedCpuMode);
    document.querySelectorAll('#fighter-list .select-card').forEach(card => {
      card.querySelectorAll('.card-token-badge').forEach(b => b.remove());
      const fighterKey = card.dataset.fighter;
      const masmonId = card.dataset.masmon || null;
      ['p1', ...Array.from({ length: survivalMode ? 0 : this.selectedCpuCount }, (_, i) => `cpu${i + 1}`)].forEach((id, tokenIndex) => {
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
    const survivalMode = ['hundred', 'endless'].includes(this.selectedCpuMode);
    const cpuTokens = Array.from({ length: survivalMode ? 0 : this.selectedCpuCount }, (_, i) => this.tokens[`cpu${i + 1}`]);
    const ready = this.selectedMode === 'cpu' && this.tokens.p1 && cpuTokens.every(Boolean);
    btn.classList.toggle('hidden', !ready);
  },

  _startFromTokens() {
    const survivalMode = ['hundred', 'endless'].includes(this.selectedCpuMode);
    const cpuFighters = Array.from({ length: survivalMode ? 0 : this.selectedCpuCount }, (_, i) => {
      const token = this.tokens[`cpu${i + 1}`];
      return { fighterKey: token.fighterKey, masmonId: token.masmonId };
    });
    const fallbackCpuKey = Object.keys(FIGHTERS).find(key => key !== this.tokens.p1.fighterKey) || this.tokens.p1.fighterKey;
    this.lastLaunchOptions = {
      stageKey: this.selectedStageKey,
      p1Key: this.tokens.p1.fighterKey,
      p2Key: this.tokens.cpu1?.fighterKey || fallbackCpuKey,
      p1MasmonId: this.tokens.p1.masmonId,
      p2MasmonId: this.tokens.cpu1?.masmonId || null,
      cpuCount: this.selectedCpuCount,
      cpuFighters,
      mode: this.selectedMode,
      cpuMode: this.selectedCpuMode,
      cpuLevel: survivalMode ? 1 : this.selectedCpuLevel,
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
    if ((this.lastLaunchOptions || {}).mode === 'multi' && window.Multiplayer?.role === 'host') {
      Multiplayer.broadcastMatchEnd(result.ranking);
    }
    this.showScreen('result');
    if (result.survival) this.renderSurvivalResult(result.survival);
    else this.renderPodium(result.ranking);

    const opts = this.lastLaunchOptions || {};
    const localFighterIndex = opts.mode === 'multi' ? (opts.localFighterIndex || 0) : 0;
    const p1Entry = result.ranking.find(r => r.fighterIndex === localFighterIndex);
    if (p1Entry) UserProfileStore.recordBattle(opts.mode === 'multi' ? 'multi' : (opts.cpuMode || 'normal'), p1Entry);
    const panel = document.getElementById('result-masmon-panel');
    panel.classList.remove('hidden');

    // 連戦モードは通常バトルのEXP・ブリーダーEXP・50ダイヤ報酬から完全に分離する。
    if (result.survival) {
      const title = result.survival.mode === 'hundred'
        ? (result.survival.cleared ? '100人組手クリア！' : '100人組手終了')
        : 'エンドレスモード終了';
      panel.innerHTML = `<div class="survival-result-summary"><strong>${title}</strong><span>${result.survival.defeated}体 撃破</span></div>`;

      if (result.survival.mode === 'hundred' && result.survival.cleared) {
        UserProfileStore.addDiamonds(500);
        UserProfileStore.addPracticeTickets(5);
        panel.insertAdjacentHTML('beforeend', '<div class="diamond-reward">💎 500ダイヤを獲得！</div><div class="breeder-reward">🎟️ 修行チケットを5枚獲得！</div>');
        if (opts.p1MasmonId) {
          const monster = MasmonStore.loadAll().find(item => item.id === opts.p1MasmonId);
          if (monster) {
            monster.badges = { ...(monster.badges || {}), hundred: true };
            MasmonStore.update(monster);
            panel.insertAdjacentHTML('beforeend', '<div class="hundred-badge-reward">🏅 100人組手クリアバッジを獲得！</div>');
            this.buildFighterList();
          }
        }
      }

      if (result.survival.mode === 'endless') {
        panel.insertAdjacentHTML('beforeend', '<div class="endless-ranking-only">報酬はありません。撃破数がランキングへ記録されます。</div>');
        UserProfileStore.submitEndlessScore(result.survival.defeated).then(updated => {
          if (updated) panel.insertAdjacentHTML('beforeend', '<div class="endless-record-reward">🏆 ランキング記録を更新しました！</div>');
        });
      }
      this._updateHomeProfile();
      return;
    }

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

  renderSurvivalResult(survival) {
    const podium = document.getElementById('result-podium');
    podium.dataset.count = '1';
    const cleared = survival.mode === 'hundred' && survival.cleared;
    podium.innerHTML = `<div class="survival-result-hero ${cleared ? 'cleared' : ''}">
      <span>${survival.mode === 'hundred' ? '100人組手' : 'ENDLESS'}</span>
      <strong>${survival.defeated}</strong><small>体撃破</small>
      ${cleared ? '<em>COMPLETE!</em>' : ''}
    </div>`;
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
    const expMultiplier = opts.mode === 'multi' ? 2 : 1;
    const expGain = expResult.total * expMultiplier;
    const startLevel = record.level;
    const startExp = record.exp;
    const levelResult = GROWTH.addExp(record, expGain);
    MasmonStore.update(record);

    panel.innerHTML = `
      <div class="masmon-exp-result">
        <div><strong>${record.name}</strong>　EXP +${expGain}</div>
        <div class="exp-breakdown">順位 +${expResult.placementExp} ／ 撃墜 +${expResult.koExp} ／ 被撃墜 -${expResult.fallPenalty} ／ ${opts.mode === 'multi' ? 'マルチ報酬 ×2' : `CPU倍率 ×${expResult.levelMultiplier.toFixed(1)}`}</div>
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

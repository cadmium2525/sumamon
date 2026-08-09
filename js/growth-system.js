// ==== 育成システム（レベル・EXP・ステータス適正・マスモン保存） ====
// トレーニング（任意振り分け）は後で実装予定。ここではレベルアップによる
// 自動成長のみを扱う。レベルアップの上昇量は控えめにし、将来のトレーニング
// 要素で大きく伸ばせる余地を残す。

const GROWTH = {
  LEVEL_MAX: 99,
  STAT_MAX: 999,
  STAT_KEYS: ['life', 'power', 'intelligence', 'accuracy', 'evasion', 'defense'],
  // 適正ランクとは別物。段位はSまであり、文字列比較ではなくこの順番で昇格を判定する。
  RANK_ORDER: ['E', 'D', 'C', 'B', 'A', 'S'],
  RANKS: ['E', 'D', 'C', 'B', 'A'],
  APTITUDE_MULTIPLIER: { E: 0.6, D: 0.8, C: 1.0, B: 1.25, A: 1.5 },
  FIXED_APTITUDES: {
    irumine: { life: 'C', power: 'A', intelligence: 'D', accuracy: 'B', evasion: 'A', defense: 'D' },
    dullahan: { life: 'C', power: 'B', intelligence: 'B', accuracy: 'A', evasion: 'E', defense: 'B' },
  },
  TRAINING_MENU: {
    running: { name: '走り込み', changes: { life: 7 } },
    domino: { name: 'ドミノ倒し', changes: { power: 7 } },
    study: { name: '猛勉強', changes: { intelligence: 7 } },
    shooting: { name: 'しゃてき', changes: { accuracy: 7 } },
    boulderDodge: { name: '巨石よけ', changes: { evasion: 7 } },
    logBlock: { name: '丸太うけ', changes: { defense: 7 } },
    weightPull: { name: '重り引き', changes: { power: 13, life: 5, evasion: -3 } },
    meditation: { name: 'めいそう', changes: { intelligence: 13, accuracy: 5, defense: -3 } },
    shiftingFloor: { name: '変動ゆか', changes: { evasion: 13, intelligence: 5, power: -3 } },
    pool: { name: 'プール', changes: { defense: 13, life: 5, intelligence: -3 } },
  },

  // 適正ランクごとの「レベル1あたりの伸び幅」（控えめな値。カンストの999にはまず届かない）
  RANK_GROWTH_PER_LEVEL: { E: 0.5, D: 1.0, C: 1.6, B: 2.3, A: 3.2 },

  // レベルアップに必要な累計EXP
  expForLevel(level) {
    return Math.round(50 * Math.pow(level, 1.6));
  },

  // ランダムな適正（E~A）を全ステータスに割り振る（マスモン登録時に1回だけ決定）
  randomAptitudes() {
    const apt = {};
    for (const key of this.STAT_KEYS) {
      apt[key] = this.RANKS[Math.floor(Math.random() * this.RANKS.length)];
    }
    return apt;
  },

  // 適性は data/fighters.json に持たせている（スタジオから編集・確認できるようにするため）。
  // FIXED_APTITUDES はデータへ移す前からある指定で、まだデータに無いモンスター用に残してある。
  aptitudesFor(baseFighterKey) {
    const def = (typeof window !== 'undefined' && window.FIGHTERS || {})[baseFighterKey];
    if (def && def.aptitudes) return { ...def.aptitudes };
    return { ...(this.FIXED_APTITUDES[baseFighterKey] || this.randomAptitudes()) };
  },

  // baseStats(Lv1時点の素の値) + 適正 + 現在レベル から、そのレベル時点のステータスを算出
  computeStatsAtLevel(baseStats, aptitudes, level) {
    const result = {};
    for (const key of this.STAT_KEYS) {
      const base = baseStats[key] || 0;
      const growth = this.RANK_GROWTH_PER_LEVEL[aptitudes[key] || 'C'];
      const grown = base + growth * (level - 1);
      const trained = (baseStats.trainingStats && baseStats.trainingStats[key]) || 0;
      result[key] = Math.max(1, Math.min(this.STAT_MAX, Math.round(grown + trained)));
    }
    return result;
  },

  // EXP付与とレベルアップ処理。masmonは { level, exp, ... } を持つオブジェクト。
  // 戻り値: { leveledUp: bool, fromLevel, toLevel }
  addExp(masmon, expGained) {
    const fromLevel = masmon.level;
    masmon.exp += expGained;
    while (masmon.level < this.LEVEL_MAX && masmon.exp >= this.expForLevel(masmon.level)) {
      masmon.exp -= this.expForLevel(masmon.level);
      masmon.level++;
    }
    if (masmon.level >= this.LEVEL_MAX) masmon.exp = 0;
    const levelsGained = masmon.level - fromLevel;
    masmon.trainingTickets = (masmon.trainingTickets || 0) + levelsGained;
    return { leveledUp: levelsGained > 0, levelsGained, ticketsGained: levelsGained, fromLevel, toLevel: masmon.level };
  },

  // トレーニング／修行での上昇量は適性ランクの倍率で変わる（上昇のみ。減少は適性に関わらず固定）。
  // 実処理とUIの予告表示で必ず同じ値になるよう、計算はこの1か所に集約する。
  // 例: ちから適性Aのマスモンが重り引き(基本+13)を行うと 13 × 1.5 = +20
  trainingChangeFor(aptitudeRank, baseChange) {
    if (baseChange <= 0) return baseChange;
    const multiplier = this.APTITUDE_MULTIPLIER[aptitudeRank || 'C'] || 1;
    return Math.max(1, Math.round(baseChange * multiplier));
  },

  // フリートレーニングチケットは口座（プロフィール）側に持つ。
  // マスモンごとのトレーニングチケットと違い、どの子にでも使える。
  freeTrainingTickets() {
    return Math.max(0, Number(UserProfileStore.data.freeTrainingTickets) || 0);
  },

  // このマスモンがトレーニングできる残り回数（個体ぶん＋フリー券）
  trainableCount(masmon) {
    return Math.max(0, Number(masmon.trainingTickets) || 0) + this.freeTrainingTickets();
  },

  train(masmon, trainingKey) {
    const training = this.TRAINING_MENU[trainingKey];
    if (!training) return { ok: false, message: 'トレーニングが見つかりません' };
    // 個体のチケットを先に使い、無くなったらフリー券を切り崩す。
    // 逆にすると、そのマスモン専用のチケットが余ったままフリー券だけ枯れてしまう。
    const useFree = (masmon.trainingTickets || 0) < 1;
    if (useFree && this.freeTrainingTickets() < 1) {
      return { ok: false, message: 'トレーニングチケットが足りません' };
    }
    masmon.trainingStats = masmon.trainingStats || {};
    const applied = {};
    for (const [key, baseChange] of Object.entries(training.changes)) {
      const change = this.trainingChangeFor(masmon.aptitudes[key], baseChange);
      const current = masmon.trainingStats[key] || 0;
      const minBonus = -(defaultStats()[key] - 1);
      const next = Math.max(minBonus, Math.min(this.STAT_MAX, current + change));
      applied[key] = next - current;
      masmon.trainingStats[key] = next;
    }
    if (useFree) UserProfileStore.addFreeTrainingTickets(-1);
    else masmon.trainingTickets--;
    return { ok: true, training, applied, usedFree: useFree };
  },

  applyPracticeResult(masmon, mainStat, grade, mainBase = 13, lifeBase = 5) {
    const gradeMultiplier = { S: 1, A: 0.85, B: 0.65, C: 0.4, D: 0.2, E: 0.15 }[grade] || 0.15;
    const apply = (stat, base) => {
      const aptitude = masmon.aptitudes?.[stat] || 'C';
      const aptitudeMultiplier = this.APTITUDE_MULTIPLIER[aptitude] || 1;
      const amount = Math.max(1, Math.round(base * gradeMultiplier * aptitudeMultiplier));
      masmon.trainingStats = { ...(masmon.trainingStats || {}) };
      const current = Math.max(0, Number(masmon.trainingStats[stat]) || 0);
      const next = Math.min(this.STAT_MAX, current + amount);
      masmon.trainingStats[stat] = next;
      return next - current;
    };
    return { [mainStat]: apply(mainStat, mainBase), life: apply('life', lifeBase) };
  },

  // ランクごとの上昇量が仕様で決め打ちされている修行用（トーブル海岸）。
  // applyPracticeResult はSを基準にランク倍率で按分するので、
  // 「Aは+15、Bは+10」のように段ごとの値が決まっている場合は使えない。
  // 適性倍率だけは他の修行と同じように掛ける（適性Cで指定どおりの値になる）。
  // 0を渡した時は「上昇なし」を意味するので、最低1の下駄は履かせない。
  applyFixedPracticeResult(masmon, mainStat, mainAmount, lifeAmount) {
    const apply = (stat, base) => {
      if (!base) return 0;
      const aptitude = masmon.aptitudes?.[stat] || 'C';
      const aptitudeMultiplier = this.APTITUDE_MULTIPLIER[aptitude] || 1;
      const amount = Math.max(1, Math.round(base * aptitudeMultiplier));
      masmon.trainingStats = { ...(masmon.trainingStats || {}) };
      const current = Math.max(0, Number(masmon.trainingStats[stat]) || 0);
      const next = Math.min(this.STAT_MAX, current + amount);
      masmon.trainingStats[stat] = next;
      return next - current;
    };
    return { [mainStat]: apply(mainStat, mainAmount), life: apply('life', lifeAmount) };
  },

  // 対戦結果からEXP量を算出（暫定式）
  computeExpGain(placement, totalFighters, cpuLevel) {
    const base = 60;
    const placementBonus = placement === 1 ? 1.5 : 1.0 - (placement - 1) * 0.15;
    // CPUレベル差が報酬にはっきり出るよう、Lv.1からLv.9まで段階的に倍率を上げる。
    const cpuBonus = 0.7 + Math.max(1, Math.min(9, cpuLevel || 3)) * 0.16;
    return Math.max(10, Math.round(base * placementBonus * cpuBonus));
  },

  computeBattleExp({ placement, totalFighters, kos, falls, cpuLevel }) {
    // 通常対戦のレベル上げが長すぎたため、調整点をここへ集約して従来の3倍にする。
    const placementRewards = [300, 210, 150, 105];
    const placementExp = placementRewards[Math.min(placementRewards.length - 1, Math.max(0, placement - 1))];
    const koExp = Math.max(0, kos || 0) * 90;
    const fallPenalty = Math.max(0, falls || 0) * 36;
    const levelMultiplier = 0.8 + Math.max(1, Math.min(9, cpuLevel || 3)) * 0.1;
    const total = Math.max(60, Math.round((placementExp + koExp - fallPenalty) * levelMultiplier));
    return { total, placementExp, koExp, fallPenalty, levelMultiplier };
  },
};

// ==== マスモン（ユーザー固有の育成済みモンスター）永続化 ====
// Firestore: users/{uid}/monsters/{monsterId} に保存する。
// 呼び出し側(flow.js/game.js)からは同期的なAPI(loadAll/register/update)のまま使えるよう、
// メモリキャッシュを持ち、Firestoreへの読み書きはバックグラウンドで行う。
// ログイン確定後に必ず loadFromFirestore(uid) を一度awaitで呼ぶこと（flow.js側で実施）。
const MasmonStore = {
  cache: [],
  loaded: false,
  currentUid: null,

  // ログイン中ユーザーのマスモン一覧をFirestoreから読み込み、メモリにキャッシュする
  async loadFromFirestore(uid) {
    this.currentUid = uid;
    if (!window.FirebaseDB) { this.cache = []; this.loaded = true; return; }
    const { db, collection, getDocs } = window.FirebaseDB;
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'monsters'));
      this.cache = snap.docs.map(d => this._normalize({ id: d.id, ...d.data() }));
    } catch (e) {
      console.error('マスモンの読み込みに失敗しました:', e);
      this.cache = [];
    }
    this.loaded = true;
  },

  // ログアウト時にメモリキャッシュを破棄する
  clearCache() {
    this.cache = [];
    this.loaded = false;
    this.currentUid = null;
  },

  loadAll() {
    return this.cache;
  },

  _normalize(record) {
    record.level = record.level || 1;
    record.exp = record.exp || 0;
    record.trainingTickets = record.trainingTickets || 0;
    record.trainingStats = record.trainingStats || {};
    // 既存ユーザーの個体にも読み込み時点で段位戦の初期状態を与える。
    record.rank = GROWTH.RANK_ORDER.includes(record.rank) ? record.rank : 'E';
    record.titles = (record.titles && typeof record.titles === 'object') ? record.titles : {};
    record.legendWins = Math.max(0, Number(record.legendWins) || 0);
    // スキン（色変更）。{ groups:{...}, splits:[...] } / 未設定なら元の色
    record.skin = record.skin || null;
    // 解放済みのプリセット色（マスモンごと）。プリセットは1色につき染色セット1個で
    // 解放し、解放後はそのマスモンで何度でも無料で選び直せる。
    record.unlockedPresets = Array.isArray(record.unlockedPresets) ? record.unlockedPresets : [];
    // ベースモンスターに適性が決まっていればそれを使う（種族の個性なので育成では変わらない）
    const fixed = (typeof window !== 'undefined' && window.FIGHTERS || {})[record.baseFighterKey];
    if ((fixed && fixed.aptitudes) || GROWTH.FIXED_APTITUDES[record.baseFighterKey]) {
      record.aptitudes = GROWTH.aptitudesFor(record.baseFighterKey);
    } else if (!record.aptitudes) {
      record.aptitudes = GROWTH.randomAptitudes();
    }
    return record;
  },

  // Firestoreへ非同期で保存する（通信失敗時もゲーム進行は止めず、エラーはログにのみ残す）
  _persist(record) {
    if (!window.FirebaseDB || !this.currentUid) return;
    const { db, doc, setDoc } = window.FirebaseDB;
    setDoc(doc(db, 'users', this.currentUid, 'monsters', record.id), record)
      .catch(e => console.error('マスモンの保存に失敗しました:', e));
  },

  // 新規マスモンを登録（baseFighterKey: 見た目の元になったファイター定義のキー）
  register(name, baseFighterKey) {
    const record = {
      id: 'masmon_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      baseFighterKey,
      level: 1,
      exp: 0,
      trainingTickets: 0,
      trainingStats: {},
      rank: 'E',
      titles: {},
      legendWins: 0,
      aptitudes: GROWTH.aptitudesFor(baseFighterKey),
      createdAt: new Date().toISOString(),
    };
    this.cache.push(record);
    this._persist(record);
    return record;
  },

  update(record) {
    const idx = this.cache.findIndex(m => m.id === record.id);
    if (idx >= 0) this.cache[idx] = record; else this.cache.push(record);
    this._persist(record);
  },
};

// ==== ユーザープロフィール（ニックネーム・ゲーム内通貨） ====
function normalizeBattleRecords(records = {}) {
  // 旧プロフィールではbattleRecordsがnullの場合があるため、必ずオブジェクトへ正規化する。
  records = records && typeof records === 'object' ? records : {};
  const blank = () => ({ matches: 0, wins: 0, losses: 0, kos: 0, falls: 0, selfDestructs: 0, bestRank: 0 });
  const normalize = value => {
    const source = value || {};
    return {
      matches: Math.max(0, Number(source.matches) || 0),
      wins: Math.max(0, Number(source.wins) || 0),
      losses: Math.max(0, Number(source.losses) || 0),
      kos: Math.max(0, Number(source.kos) || 0),
      falls: Math.max(0, Number(source.falls) || 0),
      selfDestructs: Math.max(0, Number(source.selfDestructs) || 0),
      bestRank: Math.max(0, Number(source.bestRank) || 0),
    };
  };
  return {
    cpu: {
      normal: normalize(records.cpu?.normal || blank()),
      hundred: normalize(records.cpu?.hundred || blank()),
      endless: normalize(records.cpu?.endless || blank()),
      rank: normalize(records.cpu?.rank || blank()),
    },
    multi: normalize(records.multi || blank()),
  };
}

const UserProfileStore = {
  currentUid: null,
  data: { nickname: '', diamonds: 0, iconKey: 'irumine', breederLevel: 1, breederExp: 0, practiceTickets: 0, freeTrainingTickets: 0, inventory: {}, battleRecords: normalizeBattleRecords() },

  _localKey(uid) { return `smamon_profile_${uid}`; },

  async load(uid, defaultNickname) {
    this.currentUid = uid;
    let local = null;
    try { local = JSON.parse(localStorage.getItem(this._localKey(uid))); } catch (e) { /* ignore */ }
    this.data = {
      nickname: (local && local.nickname) || defaultNickname || '',
      diamonds: Math.max(0, Number(local && local.diamonds) || 0),
      iconKey: (local && local.iconKey) || 'irumine',
      breederLevel: Math.max(1, Number(local && local.breederLevel) || 1),
      breederExp: Math.max(0, Number(local && local.breederExp) || 0),
      practiceTickets: Math.max(0, Number(local && local.practiceTickets) || 0),
      freeTrainingTickets: Math.max(0, Number(local && local.freeTrainingTickets) || 0),
      inventory: { ...((local && local.inventory) || {}) },
      battleRecords: normalizeBattleRecords(local && local.battleRecords),
    };
    if (window.FirebaseDB) {
      const { db, doc, getDoc } = window.FirebaseDB;
      try {
        const snap = await getDoc(doc(db, 'users', uid, 'profile', 'main'));
        if (snap.exists()) {
          const remote = snap.data();
          this.data = {
            nickname: remote.nickname || this.data.nickname,
            diamonds: Math.max(0, Number(remote.diamonds) || 0),
            iconKey: remote.iconKey || this.data.iconKey,
            breederLevel: Math.max(1, Number(remote.breederLevel) || this.data.breederLevel),
            breederExp: Math.max(0, Number(remote.breederExp) || 0),
            practiceTickets: Math.max(0, Number(remote.practiceTickets) || 0),
            freeTrainingTickets: Math.max(0, Number(remote.freeTrainingTickets) || 0),
            inventory: { ...(remote.inventory || this.data.inventory || {}) },
            battleRecords: normalizeBattleRecords(remote.battleRecords || this.data.battleRecords),
          };
          this._saveLocal();
        }
      } catch (e) {
        console.error('プロフィールの読み込みに失敗しました:', e);
      }
    }
    return this.data;
  },

  clear() {
    this.currentUid = null;
    this.data = { nickname: '', diamonds: 0, iconKey: 'irumine', breederLevel: 1, breederExp: 0, practiceTickets: 0, freeTrainingTickets: 0, inventory: {}, battleRecords: normalizeBattleRecords() };
  },

  _saveLocal() {
    if (!this.currentUid) return;
    try { localStorage.setItem(this._localKey(this.currentUid), JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  },

  save() {
    this._saveLocal();
    if (!window.FirebaseDB || !this.currentUid) return;
    const { db, doc, setDoc } = window.FirebaseDB;
    setDoc(doc(db, 'users', this.currentUid, 'profile', 'main'), this.data)
      .catch(e => console.error('プロフィールの保存に失敗しました:', e));
  },

  setNickname(nickname) {
    this.data.nickname = nickname.trim().slice(0, 16);
    this.save();
  },

  setIcon(iconKey) {
    this.data.iconKey = ['irumine', 'dullahan'].includes(iconKey) ? iconKey : 'irumine';
    this.save();
  },

  breederExpForLevel(level) {
    return 100 + (level - 1) * 25;
  },

  addBreederExp(amount) {
    const fromLevel = this.data.breederLevel || 1;
    this.data.breederExp = (this.data.breederExp || 0) + amount;
    let ticketsGained = 0;
    while (this.data.breederExp >= this.breederExpForLevel(this.data.breederLevel)) {
      this.data.breederExp -= this.breederExpForLevel(this.data.breederLevel);
      this.data.breederLevel++;
      if (this.data.breederLevel % 5 === 0) ticketsGained++;
    }
    this.data.practiceTickets = (this.data.practiceTickets || 0) + ticketsGained;
    this.save();
    return { fromLevel, toLevel: this.data.breederLevel, ticketsGained, expGained: amount };
  },

  addDiamonds(amount) {
    this.data.diamonds = Math.max(0, (Number(this.data.diamonds) || 0) + amount);
    this.save();
    return this.data.diamonds;
  },

  addPracticeTickets(amount) {
    this.data.practiceTickets = Math.max(0, (Number(this.data.practiceTickets) || 0) + Math.floor(Number(amount) || 0));
    this.save();
    return this.data.practiceTickets;
  },

  // フリートレーニングチケット。どのマスモンでも使えるので口座側に持つ。
  addFreeTrainingTickets(amount) {
    this.data.freeTrainingTickets =
      Math.max(0, (Number(this.data.freeTrainingTickets) || 0) + Math.floor(Number(amount) || 0));
    this.save();
    return this.data.freeTrainingTickets;
  },

  recordBattle(mode, result) {
    this.data.battleRecords = normalizeBattleRecords(this.data.battleRecords);
    const record = mode === 'multi'
      ? this.data.battleRecords.multi
      : this.data.battleRecords.cpu[['normal', 'hundred', 'endless', 'rank'].includes(mode) ? mode : 'normal'];
    const rank = Math.max(1, Number(result.rank) || 1);
    record.matches++;
    if (rank === 1) record.wins++;
    else record.losses++;
    record.kos += Math.max(0, Number(result.kos) || 0);
    record.falls += Math.max(0, Number(result.falls) || 0);
    record.selfDestructs += Math.max(0, Number(result.selfDestructs) || 0);
    record.bestRank = record.bestRank > 0 ? Math.min(record.bestRank, rank) : rank;
    this.save();
    return record;
  },

  async submitEndlessScore(score) {
    const value = Math.max(0, Math.floor(Number(score) || 0));
    if (!this.currentUid || !window.FirebaseDB) return false;
    const { db, doc, getDoc, setDoc } = window.FirebaseDB;
    try {
      const rankingRef = doc(db, 'endlessRankings', this.currentUid);
      const existing = await getDoc(rankingRef);
      const old = existing.exists() ? existing.data() : null;
      // 同点では先に記録した日時を維持する。
      if (old && (Number(old.score) || 0) >= value) return false;
      await setDoc(rankingRef, {
        uid: this.currentUid,
        nickname: this.data.nickname || 'ブリーダー',
        iconKey: this.data.iconKey || 'irumine',
        score: value,
        achievedAt: Date.now(),
      });
      return true;
    } catch (error) {
      console.error('エンドレスランキングの保存に失敗しました:', error);
      return false;
    }
  },

  async loadEndlessRankings() {
    if (!window.FirebaseDB) return [];
    const { db, collection, getDocs } = window.FirebaseDB;
    try {
      const snapshot = await getDocs(collection(db, 'endlessRankings'));
      return snapshot.docs.map(item => item.data()).sort((a, b) =>
        (Number(b.score) || 0) - (Number(a.score) || 0) ||
        (Number(a.achievedAt) || Number.MAX_SAFE_INTEGER) - (Number(b.achievedAt) || Number.MAX_SAFE_INTEGER));
    } catch (error) {
      console.error('エンドレスランキングの読み込みに失敗しました:', error);
      return [];
    }
  },

  purchaseItem(itemId, price, quantity = 1) {
    const count = Math.max(1, Math.min(99, Math.floor(Number(quantity) || 1)));
    const cost = Math.max(0, Number(price) || 0) * count;
    if ((Number(this.data.diamonds) || 0) < cost) return false;
    this.data.diamonds -= cost;
    if (!this.data.inventory) this.data.inventory = {};
    this.data.inventory[itemId] = Math.max(0, Number(this.data.inventory[itemId]) || 0) + count;
    this.save();
    return true;
  },

  consumeItem(itemId, quantity = 1) {
    const count = Math.max(1, Math.floor(Number(quantity) || 1));
    if (!this.data.inventory) this.data.inventory = {};
    const owned = Math.max(0, Number(this.data.inventory[itemId]) || 0);
    if (owned < count) return false;
    this.data.inventory[itemId] = owned - count;
    this.save();
    return true;
  },
};

// 管理者モード用のプレイ状況。パスワードや認証トークンは保存しない。
const PlayerActivityStore = {
  currentUser: null,
  heartbeatTimer: null,
  lastScreen: 'start',

  start(user) {
    this.currentUser = user;
    this.update({ lastLoginAt: Date.now(), status: 'ログイン', screen: 'start' });
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this.update({ screen: this.lastScreen }), 60000);
  },

  stop() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.currentUser = null;
  },

  setScreen(screen, mode) {
    this.lastScreen = screen;
    if (!this.currentUser) return;
    this.update({ screen, mode: mode || '', status: screen === 'battle' ? 'バトル中' : 'オンライン' });
  },

  update(extra = {}) {
    if (!this.currentUser || !window.FirebaseDB) return Promise.resolve();
    const { db, doc, setDoc } = window.FirebaseDB;
    const profile = UserProfileStore.data || {};
    return setDoc(doc(db, 'playerActivity', this.currentUser.uid), {
      uid: this.currentUser.uid,
      username: this.currentUser.username || '',
      nickname: profile.nickname || this.currentUser.username || '',
      iconKey: profile.iconKey || 'irumine',
      lastSeenAt: Date.now(),
      ...extra,
    }, { merge: true }).catch(error => console.error('プレイ状況の更新に失敗しました:', error));
  },

  async loadAll() {
    if (!window.FirebaseDB) return [];
    const { db, collection, getDocs } = window.FirebaseDB;
    try {
      const snapshot = await getDocs(collection(db, 'playerActivity'));
      return snapshot.docs.map(item => item.data()).sort((a, b) =>
        (Number(b.lastSeenAt) || 0) - (Number(a.lastSeenAt) || 0));
    } catch (error) {
      console.error('プレイ状況の読み込みに失敗しました:', error);
      return [];
    }
  },
};

window.PlayerActivityStore = PlayerActivityStore;

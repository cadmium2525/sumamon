// ==== 育成システム（レベル・EXP・ステータス適正・マスモン保存） ====
// トレーニング（任意振り分け）は後で実装予定。ここではレベルアップによる
// 自動成長のみを扱う。レベルアップの上昇量は控えめにし、将来のトレーニング
// 要素で大きく伸ばせる余地を残す。

const GROWTH = {
  LEVEL_MAX: 99,
  STAT_MAX: 999,
  STAT_KEYS: ['life', 'power', 'intelligence', 'accuracy', 'evasion', 'defense'],
  RANKS: ['E', 'D', 'C', 'B', 'A'],

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

  // baseStats(Lv1時点の素の値) + 適正 + 現在レベル から、そのレベル時点のステータスを算出
  computeStatsAtLevel(baseStats, aptitudes, level) {
    const result = {};
    for (const key of this.STAT_KEYS) {
      const base = baseStats[key] || 0;
      const growth = this.RANK_GROWTH_PER_LEVEL[aptitudes[key] || 'C'];
      const grown = base + growth * (level - 1);
      result[key] = Math.min(this.STAT_MAX, Math.round(grown));
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
    return { leveledUp: masmon.level > fromLevel, fromLevel, toLevel: masmon.level };
  },

  // 対戦結果からEXP量を算出（暫定式）
  computeExpGain(placement, totalFighters, cpuLevel) {
    const base = 60;
    const placementBonus = placement === 1 ? 1.5 : 1.0 - (placement - 1) * 0.15;
    const cpuBonus = 1 + (cpuLevel || 3) * 0.06;
    return Math.max(10, Math.round(base * placementBonus * cpuBonus));
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
      this.cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
      aptitudes: GROWTH.randomAptitudes(),
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

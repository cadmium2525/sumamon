// ==== ガチャ抽選・所持解放・ピックアップ管理 ====
// DOMを持たない純粋な抽選層。ファイター一覧は data/fighters.json だけを正とし、
// 新しいモンスターを追加しても、このファイルへ名前を書き足さずに反映される。

const GACHA_RATES = Object.freeze({ s5: 0.01, s4: 0.12, s3: 0.32, s2: 0.55 });

const GACHA = {
  SINGLE_COST: 150,
  TEN_COST: 1500,
  PITY_MAX: 100,
  manualPickup: null,

  fighterPool() {
    return Object.keys(window.FIGHTERS || {});
  },

  automaticPickupKey() {
    let latest = null;
    for (const [key, def] of Object.entries(window.FIGHTERS || {})) {
      if (!def?.debutAt) continue;
      if (!latest || String(def.debutAt) > latest.debutAt) {
        latest = { key, debutAt: String(def.debutAt) };
      }
    }
    return latest?.key || null;
  },

  pickupKey() {
    const manual = this.manualPickup;
    if (manual?.key && (window.FIGHTERS || {})[manual.key] &&
        (!manual.until || Date.now() < manual.until)) return manual.key;
    return this.automaticPickupKey();
  },

  pickupSource() {
    const manual = this.manualPickup;
    return manual?.key && this.pickupKey() === manual.key ? 'manual' : 'auto';
  },

  isUnlocked(fighterKey) {
    const def = (window.FIGHTERS || {})[fighterKey];
    if (!def) return false;
    if (!def.debutAt) return true;
    return (UserProfileStore.data.ownedFighters || []).includes(fighterKey);
  },

  _pick(list, random = Math.random) {
    return list.length ? list[Math.min(list.length - 1, Math.floor(random() * list.length))] : null;
  },

  _drawRank(random, guaranteeThree = false) {
    const roll = random();
    if (guaranteeThree) {
      const total = GACHA_RATES.s5 + GACHA_RATES.s4 + GACHA_RATES.s3;
      const scaled = roll * total;
      if (scaled < GACHA_RATES.s5) return 5;
      if (scaled < GACHA_RATES.s5 + GACHA_RATES.s4) return 4;
      return 3;
    }
    if (roll < GACHA_RATES.s5) return 5;
    if (roll < GACHA_RATES.s5 + GACHA_RATES.s4) return 4;
    if (roll < GACHA_RATES.s5 + GACHA_RATES.s4 + GACHA_RATES.s3) return 3;
    return 2;
  },

  _fighterReward(random) {
    const pool = this.fighterPool();
    const pickup = this.pickupKey();
    const unowned = pool.filter(key => !this.isUnlocked(key));
    let key = pickup && unowned.includes(pickup) ? pickup : this._pick(unowned, random);
    if (key) {
      const owned = UserProfileStore.data.ownedFighters || (UserProfileStore.data.ownedFighters = []);
      if (!owned.includes(key)) owned.push(key);
      return { rank: 5, type: 'unlock', fighterKey: key, amount: 1 };
    }

    if (pickup && UserProfileStore.limitBreakOf(pickup) < GROWTH.LIMIT_BREAK_MAX) key = pickup;
    if (!key) {
      const unfinished = pool.filter(item => UserProfileStore.limitBreakOf(item) < GROWTH.LIMIT_BREAK_MAX);
      key = this._pick(unfinished, random);
    }
    if (key) {
      const next = UserProfileStore.setLimitBreak(key, UserProfileStore.limitBreakOf(key) + 1);
      return { rank: 5, type: 'limitBreak', fighterKey: key, amount: next };
    }

    UserProfileStore.data.gold = Math.max(0, Number(UserProfileStore.data.gold) || 0) + 5000;
    return { rank: 5, type: 'gold', amount: 5000 };
  },

  _normalReward(rank, random) {
    const tables = {
      4: [
        { type: 'item', itemId: 'vital_elixir', amount: 2 },
        { type: 'item', itemId: 'skill_elixir', amount: 2 },
        { type: 'item', itemId: 'might_elixir', amount: 2 },
        { type: 'item', itemId: 'dye_kit', amount: 1 },
        { type: 'practice', amount: 2 },
      ],
      3: [
        { type: 'item', itemId: 'vital_tonic', amount: 2 },
        { type: 'item', itemId: 'skill_tonic', amount: 2 },
        { type: 'item', itemId: 'might_tonic', amount: 2 },
        { type: 'freeTraining', amount: 3 },
        { type: 'gold', amount: 1000 },
      ],
      2: [
        { type: 'gold', amount: 300 },
        { type: 'item', itemId: 'vital_tonic', amount: 1 },
        { type: 'item', itemId: 'skill_tonic', amount: 1 },
        { type: 'item', itemId: 'might_tonic', amount: 1 },
      ],
    };
    const reward = { rank, ...this._pick(tables[rank], random) };
    if (reward.type === 'item') UserProfileStore.grantItem(reward.itemId, reward.amount);
    if (reward.type === 'practice') {
      UserProfileStore.data.practiceTickets = Math.max(0,
        Number(UserProfileStore.data.practiceTickets) || 0) + reward.amount;
    }
    if (reward.type === 'freeTraining') {
      UserProfileStore.data.freeTrainingTickets = Math.max(0,
        Number(UserProfileStore.data.freeTrainingTickets) || 0) + reward.amount;
    }
    if (reward.type === 'gold') {
      UserProfileStore.data.gold = Math.max(0, Number(UserProfileStore.data.gold) || 0) + reward.amount;
    }
    return reward;
  },

  pull(count = 1, random = Math.random) {
    const pulls = count === 10 ? 10 : 1;
    const cost = pulls === 10 ? this.TEN_COST : this.SINGLE_COST;
    const diamonds = Math.max(0, Number(UserProfileStore.data.diamonds) || 0);
    if (diamonds < cost) return { ok: false, reason: 'ダイヤが足りません', cost, results: [] };

    UserProfileStore.data.diamonds = diamonds - cost;
    const results = [];
    let hasThreeOrHigher = false;
    for (let index = 0; index < pulls; index++) {
      const pity = Math.max(0, Math.min(99, Number(UserProfileStore.data.gachaPity) || 0));
      const guaranteedFive = pity >= this.PITY_MAX - 1;
      const guaranteedThree = pulls === 10 && index === 9 && !hasThreeOrHigher;
      const rank = guaranteedFive ? 5 : this._drawRank(random, guaranteedThree);
      UserProfileStore.data.gachaPulls = Math.max(0, Number(UserProfileStore.data.gachaPulls) || 0) + 1;
      UserProfileStore.data.gachaPity = rank === 5 ? 0 : Math.min(99, pity + 1);
      const reward = rank === 5 ? this._fighterReward(random) : this._normalReward(rank, random);
      reward.pity = guaranteedFive;
      results.push(reward);
      if (rank >= 3) hasThreeOrHigher = true;
    }
    UserProfileStore.save();
    return { ok: true, cost, results };
  },

  initializeSeenFighters() {
    const debutKeys = this.fighterPool().filter(key => (window.FIGHTERS || {})[key]?.debutAt);
    if (!Array.isArray(UserProfileStore.data.seenFighters)) {
      UserProfileStore.data.seenFighters = [...debutKeys];
      UserProfileStore.save();
      return [];
    }
    return debutKeys.filter(key => !UserProfileStore.data.seenFighters.includes(key))
      .sort((a, b) => String(window.FIGHTERS[a].debutAt).localeCompare(String(window.FIGHTERS[b].debutAt)));
  },

  unseenFighters() {
    if (!Array.isArray(UserProfileStore.data.seenFighters)) return this.initializeSeenFighters();
    return this.fighterPool().filter(key => (window.FIGHTERS || {})[key]?.debutAt &&
      !UserProfileStore.data.seenFighters.includes(key));
  },

  markSeen(fighterKey) {
    const seen = UserProfileStore.data.seenFighters || (UserProfileStore.data.seenFighters = []);
    if (!seen.includes(fighterKey)) seen.push(fighterKey);
    UserProfileStore.save();
  },

  async loadPickupConfig() {
    if (!window.FirebaseDB) return null;
    const { db, doc, getDoc } = window.FirebaseDB;
    try {
      const snap = await getDoc(doc(db, 'config', 'gacha'));
      if (!snap.exists()) return null;
      const value = snap.data() || {};
      this.manualPickup = value.pickupKey
        ? { key: value.pickupKey, until: Math.max(0, Number(value.pickupUntil) || 0) }
        : null;
      return this.manualPickup;
    } catch (error) {
      console.warn('ガチャのピックアップ設定を読み込めませんでした。自動設定を使います:', error);
      return null;
    }
  },

  async savePickupConfig(fighterKey, until = 0) {
    if (!window.FirebaseDB) throw new Error('Firebaseへ接続できません');
    const { db, doc, setDoc } = window.FirebaseDB;
    const key = fighterKey && (window.FIGHTERS || {})[fighterKey] ? fighterKey : '';
    const value = { pickupKey: key, pickupUntil: key ? Math.max(0, Number(until) || 0) : null, updatedAt: Date.now() };
    await setDoc(doc(db, 'config', 'gacha'), value);
    this.manualPickup = key ? { key, until: value.pickupUntil || 0 } : null;
    return this.manualPickup;
  },
};

window.GACHA = GACHA;
window.GACHA_RATES = GACHA_RATES;

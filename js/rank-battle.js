// ==== 段位戦の定義・進行・報酬計算 ====
// DOMや保存処理を持たせず、画面とテストの両方が同じ判定を使える純粋な層にする。

const RANK_BATTLES = {
  E: { name: 'Eランク昇格戦', fighterKey: 'irumine', stageKey: 'cosmo', cpuLevel: 4,
    stats: { life: 120, power: 90, intelligence: 90, accuracy: 90, evasion: 90, defense: 90 } },
  D: { name: 'Dランク昇格戦', fighterKey: 'dullahan', stageKey: 'waterfall_ruins', cpuLevel: 5,
    stats: { life: 220, power: 180, intelligence: 180, accuracy: 180, evasion: 180, defense: 180 } },
  C: { name: 'Cランク昇格戦', fighterKey: 'nendoro', stageKey: 'cosmo', cpuLevel: 6,
    stats: { life: 340, power: 300, intelligence: 300, accuracy: 300, evasion: 300, defense: 300 } },
  B: { name: 'Bランク昇格戦', fighterKey: 'irumine', stageKey: 'waterfall_ruins', cpuLevel: 7,
    stats: { life: 470, power: 430, intelligence: 430, accuracy: 430, evasion: 430, defense: 430 } },
  A: { name: 'Sランク昇格戦', fighterKey: 'dullahan', stageKey: 'cosmo', cpuLevel: 8,
    stats: { life: 610, power: 570, intelligence: 570, accuracy: 570, evasion: 570, defense: 570 } },
};

const TOURNAMENTS = {
  masters: { name: 'マスターズ・オブ・ブリーディング', short: 'MoB', flavor: '守り抜く者の大会',
    fighterKey: 'dullahan', stageKey: 'waterfall_ruins', cpuLevel: 9,
    stats: { life: 900, power: 700, intelligence: 700, accuracy: 700, evasion: 620, defense: 900 } },
  great: { name: 'グレートモンスターズ', short: 'GM', flavor: '一撃の重さを競う大会',
    fighterKey: 'nendoro', stageKey: 'cosmo', cpuLevel: 9,
    stats: { life: 780, power: 920, intelligence: 660, accuracy: 720, evasion: 640, defense: 760 } },
  disk: { name: 'ディスク・オブ・ゴールド', short: 'DoG', flavor: '速さと精度を競う大会',
    fighterKey: 'irumine', stageKey: 'waterfall_ruins', cpuLevel: 9,
    stats: { life: 680, power: 700, intelligence: 720, accuracy: 900, evasion: 930, defense: 640 } },
  allstar: { name: 'オールスターバトル', short: 'AS', flavor: 'あらゆる力を試す大会',
    fighterKey: 'nendoro', stageKey: 'cosmo', cpuLevel: 9,
    stats: { life: 780, power: 780, intelligence: 850, accuracy: 780, evasion: 780, defense: 780 } },
};

const LEGEND = {
  name: 'レジェンド杯', short: 'LEGEND', flavor: 'すべてを制した者だけが挑める頂上決戦',
  fighterKey: 'dullahan', stageKey: 'cosmo', cpuLevel: 10,
  stats: { life: 900, power: 900, intelligence: 900, accuracy: 900, evasion: 900, defense: 900 },
};

const RANK_REWARDS = {
  E: { masmonExp: 1500, diamonds: 100, breederExp: 150, practiceTickets: 0, trainingTickets: 1 },
  D: { masmonExp: 3000, diamonds: 200, breederExp: 200, practiceTickets: 0, trainingTickets: 1 },
  C: { masmonExp: 6000, diamonds: 350, breederExp: 300, practiceTickets: 1, trainingTickets: 2 },
  B: { masmonExp: 12000, diamonds: 550, breederExp: 450, practiceTickets: 1, trainingTickets: 2 },
  A: { masmonExp: 24000, diamonds: 800, breederExp: 700, practiceTickets: 2, trainingTickets: 3 },
};

const TOURNAMENT_REWARD_FIRST = { masmonExp: 40000, diamonds: 1000, breederExp: 900, practiceTickets: 2, trainingTickets: 3 };
const TOURNAMENT_REWARD_REPEAT = { masmonExp: 12000, diamonds: 200, breederExp: 300, practiceTickets: 0, trainingTickets: 1 };
const LEGEND_REWARD_FIRST = { masmonExp: 120000, diamonds: 1500, breederExp: 1500, practiceTickets: 5, trainingTickets: 10 };
const LEGEND_REWARD_REPEAT = { masmonExp: 40000, diamonds: 300, breederExp: 500, practiceTickets: 1, trainingTickets: 2 };

const RankBattle = {
  tournamentKeys: Object.keys(TOURNAMENTS),

  definition(type, key) {
    if (type === 'rank') return RANK_BATTLES[key] || null;
    if (type === 'tournament') return TOURNAMENTS[key] || null;
    if (type === 'legend') return LEGEND;
    return null;
  },

  available(masmon) {
    const rank = GROWTH.RANK_ORDER.includes(masmon?.rank) ? masmon.rank : 'E';
    if (rank !== 'S') {
      const def = RANK_BATTLES[rank];
      return def ? [{ type: 'rank', key: rank, name: def.name, locked: false, cleared: false, def }] : [];
    }
    const titles = (masmon?.titles && typeof masmon.titles === 'object') ? masmon.titles : {};
    const challenges = this.tournamentKeys.map(key => ({
      type: 'tournament', key, name: TOURNAMENTS[key].name, locked: false,
      cleared: !!titles[key], def: TOURNAMENTS[key],
    }));
    if (this.tournamentKeys.every(key => !!titles[key])) {
      challenges.push({ type: 'legend', key: 'legend', name: LEGEND.name, locked: false,
        cleared: (Number(masmon?.legendWins) || 0) > 0, def: LEGEND });
    }
    return challenges;
  },

  applyWin(masmon, challenge) {
    const fromRank = GROWTH.RANK_ORDER.includes(masmon.rank) ? masmon.rank : 'E';
    const result = {
      promoted: false, fromRank, toRank: fromRank, tournamentCleared: false,
      legendCleared: false, allTournamentsDone: false,
    };
    if (challenge?.type === 'rank' && challenge.key === fromRank && fromRank !== 'S') {
      const next = GROWTH.RANK_ORDER[GROWTH.RANK_ORDER.indexOf(fromRank) + 1];
      masmon.rank = next;
      result.promoted = true;
      result.toRank = next;
    } else if (challenge?.type === 'tournament' && TOURNAMENTS[challenge.key]) {
      masmon.titles = (masmon.titles && typeof masmon.titles === 'object') ? masmon.titles : {};
      result.tournamentCleared = !masmon.titles[challenge.key];
      masmon.titles[challenge.key] = true;
    } else if (challenge?.type === 'legend') {
      masmon.legendWins = Math.max(0, Number(masmon.legendWins) || 0) + 1;
      result.legendCleared = masmon.legendWins === 1;
    }
    const titles = masmon.titles || {};
    result.allTournamentsDone = this.tournamentKeys.every(key => !!titles[key]);
    return result;
  },

  rewardFor(challenge, { firstClear = true } = {}) {
    let reward = null;
    if (challenge?.type === 'rank') reward = RANK_REWARDS[challenge.key];
    else if (challenge?.type === 'tournament') reward = firstClear ? TOURNAMENT_REWARD_FIRST : TOURNAMENT_REWARD_REPEAT;
    else if (challenge?.type === 'legend') reward = firstClear ? LEGEND_REWARD_FIRST : LEGEND_REWARD_REPEAT;
    return { ...(reward || { masmonExp: 0, diamonds: 0, breederExp: 0, practiceTickets: 0, trainingTickets: 0 }) };
  },
};

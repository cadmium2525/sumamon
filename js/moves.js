// ==== 技データテーブル ====
// angle: 吹っ飛び角度(度) 0=水平, 90=真上, 負値=下方向(メテオ)
// statKey: ダメージ/威力に反映するステータス（ちから or かしこさ）
// active: [発生開始フレーム, 発生終了フレーム] duration内での判定有効区間
// backHit: true の場合、攻撃者の向きと逆方向へ吹っ飛ばす（空後）

const MOVES = {
  // 地上通常技 (A + スティック方向)
  ground: {
    neutral: { name: '弱A',   dmgBase: 3, kbBase: 3, angle: 25, duration: 10, active: [3, 6],  range: 34, h: 20, yOff: 15, statKey: 'power' },
    side:    { name: '横強',  dmgBase: 6, kbBase: 5, angle: 40, duration: 16, active: [5, 9],  range: 44, h: 26, yOff: 8,  statKey: 'power', endlag: 9 },
    up:      { name: '上強',  dmgBase: 5, kbBase: 4, angle: 82, duration: 14, active: [4, 8],  range: 30, h: 40, yOff: -20, statKey: 'power', endlag: 8 },
    down:    { name: '下強',  dmgBase: 4, kbBase: 4, angle: 15, duration: 12, active: [3, 7],  range: 38, h: 16, yOff: 34, statKey: 'power', endlag: 7 },
    dashAttack: { name: 'ダッシュ攻撃', dmgBase: 7, kbBase: 3.5, angle: 28, duration: 22, active: [3, 12], range: 46, h: 30, yOff: 4, statKey: 'power', endlag: 14 },
  },

  // 必殺技 (B + スティック方向) ※地上・空中共通で使用
  special: {
    neutral: { name: '通常必殺', dmgBase: 7, kbBase: 5, angle: 35, duration: 22, active: [8, 14], range: 52, h: 24, yOff: 10, statKey: 'intelligence', endlag: 13 },
    side:    { name: '横必殺',  dmgBase: 8, kbBase: 5, angle: 25, duration: 24, active: [4, 12], range: 60, h: 26, yOff: 8,  statKey: 'intelligence', dashForward: 6, endlag: 15 },
    up:      { name: '上必殺',  dmgBase: 6, kbBase: 4, angle: 85, duration: 26, active: [2, 10], range: 40, h: 40, yOff: -20, statKey: 'intelligence', recoveryBoost: -13, endlag: 18 },
    down:    { name: '下必殺',  dmgBase: 6, kbBase: 4, angle: 20, duration: 20, active: [5, 11], range: 34, h: 20, yOff: 12, statKey: 'intelligence', endlag: 12 },
  },

  // 空中技 (A + スティック方向、無入力はニュートラル)
  air: {
    neutral: { name: '空N',  dmgBase: 5, kbBase: 4, angle: 35, duration: 16, active: [3, 8],  range: 40, h: 40, yOff: -6, statKey: 'power', endlag: 7 },
    forward: { name: '空前', dmgBase: 7, kbBase: 5, angle: 35, duration: 18, active: [4, 9],  range: 46, h: 26, yOff: 0,  statKey: 'power', endlag: 10 },
    back:    { name: '空後', dmgBase: 8, kbBase: 6, angle: 40, duration: 20, active: [5, 10], range: 46, h: 26, yOff: 0,  statKey: 'power', backHit: true, endlag: 12 },
    up:      { name: '空上', dmgBase: 6, kbBase: 4, angle: 85, duration: 14, active: [3, 7],  range: 30, h: 36, yOff: -24, statKey: 'power', endlag: 8 },
    down:    { name: '空下', dmgBase: 7, kbBase: 5, angle: -70, duration: 20, active: [4, 10], range: 30, h: 40, yOff: 20, statKey: 'power', meteor: true, endlag: 13 },
  },
  // スマッシュ攻撃（地上A系を溜めた場合に発動。上記tiltより威力・吹っ飛びが大きい）
  smash: {
    up:   { name: '上スマ', dmgBase: 11, kbBase: 9, angle: 84, duration: 20, active: [6, 11], range: 36, h: 44, yOff: -22, statKey: 'power', endlag: 18 },
    side: { name: '横スマ', dmgBase: 13, kbBase: 10, angle: 38, duration: 22, active: [7, 12], range: 54, h: 30, yOff: 6,  statKey: 'power', endlag: 20 },
    down: { name: '下スマ', dmgBase: 10, kbBase: 8, angle: 18, duration: 18, active: [5, 10], range: 46, h: 18, yOff: 34, statKey: 'power', endlag: 17 },
  },
};

// 投げ技（掴み成立後、A + スティック方向 or 無入力で発動）
const THROWS = {
  neutral: { name: '前投げ', dmgBase: 5, kbBase: 4, angle: 30, statKey: 'power' }, // 掴んだ時の向きへ
  up:      { name: '上投げ', dmgBase: 5, kbBase: 5, angle: 85, statKey: 'power' },
  down:    { name: '下投げ', dmgBase: 5, kbBase: 4, angle: 20, statKey: 'power' },
  side:    { name: '横投げ', dmgBase: 6, kbBase: 5, angle: 35, statKey: 'power' }, // 押した左右方向へ直接
};

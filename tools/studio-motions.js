// ==== モンスター作成スタジオ：モーション定義 ====
// ここに1行足すだけでスタジオの入力欄が増える。
// slot: data/fighters.json の animations キー、または "move:<グループ>.<技キー>"（技モーション）
// projectile: true の技は、モーションに加えて飛び道具（矢・弾など）の設定ができる
window.STUDIO_MOTIONS = [
  { slot: 'idle',    name: '待機',       dir: 'idle',            duration: 8,  required: true,
    hint: 'ゲーム中いちばん長く映るモーション。最優先で用意してください' },
  { slot: 'walk',    name: '歩行',       dir: 'walk',            duration: 5 },
  { slot: 'dash',    name: 'ダッシュ',   dir: 'dash',            duration: 4 },
  { slot: 'jump',    name: 'ジャンプ',   dir: 'jump',            duration: 5,
    hint: '繰り返さず1回だけ再生され、終わると空中待機へ移ります' },
  { slot: 'airIdle', name: '空中待機',   dir: 'jump',            duration: 12, filePrefix: 'air_idle' },
  { slot: 'crouch',  name: 'しゃがみ',   dir: 'crouch',          duration: 8 },
  { slot: 'shield',  name: 'ガード',     dir: 'shield',          duration: 8 },
  { slot: 'hurt',    name: '被弾',       dir: 'hurt',            duration: 6 },
  { slot: 'tumble',  name: '吹っ飛び',   dir: 'tumble',          duration: 6 },
  { slot: 'downed',  name: 'ダウン',     dir: 'downed',          duration: 10 },
  { slot: 'ledge',   name: '崖つかまり', dir: 'ledge',           duration: 10 },

  { slot: 'move:ground.neutral',  name: '弱A',       dir: 'neutral_attack', duration: 2 },
  { slot: 'move:ground.side',     name: '横強',      dir: 'side_attack',    duration: 3 },
  { slot: 'move:ground.up',       name: '上強',      dir: 'up_attack',      duration: 3 },
  { slot: 'move:ground.down',     name: '下強',      dir: 'down_attack',    duration: 3 },
  { slot: 'move:ground.dashAttack', name: 'ダッシュ攻撃', dir: 'dash_attack', duration: 4 },
  { slot: 'move:smash.side',      name: '横スマッシュ', dir: 'side_smash',   duration: 4 },
  { slot: 'move:smash.up',        name: '上スマッシュ', dir: 'up_smash',     duration: 4 },
  { slot: 'move:smash.down',      name: '下スマッシュ', dir: 'down_smash',   duration: 4 },
  { slot: 'move:air.neutral',     name: '空N',       dir: 'air_neutral',    duration: 3 },
  { slot: 'move:air.forward',     name: '空前',      dir: 'air_forward',    duration: 3 },
  { slot: 'move:air.back',        name: '空後',      dir: 'air_back',       duration: 3 },
  { slot: 'move:air.up',          name: '空上',      dir: 'air_up',         duration: 3 },
  { slot: 'move:air.down',        name: '空下',      dir: 'air_down',       duration: 3 },
  { projectile: true, slot: 'move:special.neutral', name: 'NB（通常必殺）', dir: 'neutral_special', duration: 3 },
  { projectile: true, slot: 'move:special.side',    name: '横B',       dir: 'side_special',   duration: 6 },
  { projectile: true, slot: 'move:special.up',      name: '上B',       dir: 'up_special',     duration: 4 },
  { projectile: true, slot: 'move:special.down',    name: '下B',       dir: 'down_special',   duration: 6 },
  { slot: 'stock',   name: 'ストックアイコン', dir: '',        duration: 0, single: true, filePrefix: 'stock',
    hint: 'HUDの残機表示に使う1枚。正方形に切り取られます' },
];

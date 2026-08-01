// ==== ファイター登録データ ====
// 画像は assets/images/fighter/<キャラ名>/ 以下に配置する。
// stats は defaultStats() からの差分（省略時はデフォルト値のまま）。
//
// ファイターを追加する手順:
//   1. 画像を assets/images/fighter/<キャラ名>/idle.png として配置
//   2. 画像を解析し、影や余白を除いた「キャラクター本体」のbbox(左/上/右/下、ピクセル座標)を求める
//      （Pillowで alpha>しきい値 の領域を行ごとに走査し、影のような広い平坦領域を除外して求める）
//   3. そのbboxの高さがゲーム内で何ユニットになってほしいか(hurtboxHeight)を決め、
//      hurtboxWidth は概ね本体の「典型的な幅」(中央値幅など)を同じ比率で換算した値にする
//   4. 下記に spriteContentBox / hurtboxWidth / hurtboxHeight として登録する
//      （これにより、技の間合い・シールド半径・掴み距離・見た目の位置合わせが全て自動でスケールする）

const FIGHTERS = {
  irumine: {
    key: 'irumine',
    displayName: 'イルミネ',
    color: '#ff4757',
    // 選択画面・HUDアイコン等のサムネイル用（代表カットとしてidleコマ1枚目を使用）
    idleImage: 'assets/images/fighter/irumine/idle/frame_001.png',
    stockIcon: 'assets/images/fighter/irumine/stock.png',
    // idleImageのフォールバック用bbox（アニメ未読込時の簡易表示に使用）
    spriteContentBox: { left: 0, top: 1, right: 209, bottom: 249 },
    hurtboxWidth: 54,
    hurtboxHeight: 124,
    // 待機コマ送りアニメーション（4コマループ。影を除いた本体部分は4コマ共通のbboxで統一し、
    // コマ切り替え時に位置がガタつかないようにしている）
    idleFrameSrcs: [
      'assets/images/fighter/irumine/idle/frame_001.png',
      'assets/images/fighter/irumine/idle/frame_002.png',
      'assets/images/fighter/irumine/idle/frame_003.png',
      'assets/images/fighter/irumine/idle/frame_004.png',
    ],
    idleFrameContentBox: { left: 0, top: 1, right: 209, bottom: 249 },
    idleFrameDuration: 8, // 1コマ何フレーム表示するか（60fps想定で約0.13秒/コマ）
    stats: null,
  },
  dullahan: {
    key: 'dullahan',
    displayName: 'デュラハン',
    color: '#f1c40f',
    idleImage: 'assets/images/fighter/dullahan/idle.png',
    stockIcon: 'assets/images/fighter/dullahan/stock.png',
    // 元画像(338x518)を解析した本体bbox（影なし、ほぼ全体）
    spriteContentBox: { left: 2, top: 1, right: 336, bottom: 517 },
    hurtboxWidth: 39,
    hurtboxHeight: 110,
    // 歩行スプライトシート（5x5=25コマ、1コマ256x256）
    walkSheetSrc: 'assets/images/fighter/dullahan/walk_sheet.png',
    walkSheetCols: 5,
    walkSheetRows: 5,
    walkFrameCount: 25,
    walkFrameDuration: 3,
    // シートの1コマ(256x256)内でのキャラクター本体bbox（全コマ共通の想定）
    walkFrameContentBox: { left: 66, top: 32, right: 189, bottom: 222 },
    stats: { power: 14, defense: 16, evasion: 6 }, // 重装甲の騎士：硬いが遅い想定
  },
};

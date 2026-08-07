// ==== ファイター/技データのローダー ====
// キャラクター定義と技のモーションは data/fighters.json ・ data/movesets.json に外部化してある。
// こうすることで、モンスター作成スタジオ(tools/)のようなブラウザツールから
// JavaScriptのソースを書き換えることなく、安全にデータだけを追加・更新できる。
//
// ファイターを追加する手順:
//   1. 画像を assets/images/fighter/<キャラ名>/ 以下に配置
//   2. 画像を解析し、影や余白を除いた「キャラクター本体」のbbox(左/上/右/下、ピクセル座標)を求める
//   3. そのbboxの高さがゲーム内で何ユニットになってほしいか(hurtboxHeight)を決め、
//      hurtboxWidth は概ね本体の「典型的な幅」を同じ比率で換算した値にする
//   4. data/fighters.json に spriteContentBox / hurtboxWidth / hurtboxHeight として登録する
//      （これにより、技の間合い・シールド半径・掴み距離・見た目の位置合わせが全て自動でスケールする）
//   ※ 上記1〜4は tools/monster-studio.html から全自動で行える。

// 読み込み完了までは空。FighterData.load() の解決後に中身が入る。
let FIGHTERS = {};
window.FIGHTERS = FIGHTERS;
window.FIGHTER_MOVESETS = {};

const FighterData = {
  loaded: false,

  // JSONの技定義は "extends": "ground.neutral" のように共通技テーブル(MOVES)を参照できる。
  // バランス値は MOVES 側で一元管理し、モーションだけ差し替える、という使い方を想定している。
  _resolveMove(groupKey, moveKey, def) {
    if (!def || typeof def !== 'object') return def;
    if (!def.extends) return { ...def };
    const [baseGroup, baseMove] = String(def.extends).split('.');
    const base = (window.MOVES && window.MOVES[baseGroup] && window.MOVES[baseGroup][baseMove]) || null;
    if (!base) {
      // ここで静かにフォールバックすると duration/active 等が欠けた技ができ、
      // バトル中に毎フレーム例外が出るため、はっきりエラーとして残す
      console.error(`[FighterData] 継承元の技が見つかりません: ${def.extends} (${groupKey}.${moveKey})`);
      const { extends: _drop, ...rest } = def;
      return rest;
    }
    const { extends: _unused, ...overrides } = def;
    return { ...base, ...overrides };
  },

  _applyMovesets(raw) {
    const result = {};
    for (const [fighterKey, groups] of Object.entries(raw || {})) {
      const resolvedGroups = {};
      for (const [groupKey, moves] of Object.entries(groups || {})) {
        const resolvedMoves = {};
        for (const [moveKey, def] of Object.entries(moves || {})) {
          resolvedMoves[moveKey] = this._resolveMove(groupKey, moveKey, def);
        }
        resolvedGroups[groupKey] = resolvedMoves;
      }
      result[fighterKey] = resolvedGroups;
    }
    return result;
  },

  async load() {
    if (this.loaded) return;
    // キャッシュ済みの古いデータを掴まないよう、常に最新を取りに行く
    const [fighters, movesets] = await Promise.all([
      fetch('data/fighters.json', { cache: 'no-cache' }).then(r => r.json()),
      fetch('data/movesets.json', { cache: 'no-cache' }).then(r => r.json()),
    ]);
    FIGHTERS = fighters;
    window.FIGHTERS = fighters;
    window.FIGHTER_MOVESETS = this._applyMovesets(movesets);
    this.loaded = true;
  },
};

window.FighterData = FighterData;

// Fighter生成時のオプションを組み立てる共通処理。
// game.js（バトル）と practice.js（修行）で同じ定義を使うため、ここ1か所にまとめる。
function buildFighterOptions(def, masmon) {
  return {
    fighterKey: def.key,
    grabRange: def.grabRange,
    name: masmon ? masmon.name : def.displayName,
    stockIconSrc: def.stockIcon,
    spriteSrc: def.idleImage,
    hurtboxWidth: def.hurtboxWidth,
    hurtboxHeight: def.hurtboxHeight,
    fallSpeed: def.fallSpeed,
    proceduralMotion: def.proceduralMotion,
    weapon: def.weapon,
    parts: def.parts,
    skin: masmon ? masmon.skin : null,
    spriteContentBox: def.spriteContentBox,
    animations: def.animations,
    walkSheetSrc: def.walkSheetSrc,
    walkSheetCols: def.walkSheetCols,
    walkSheetRows: def.walkSheetRows,
    walkFrameCount: def.walkFrameCount,
    walkFrameDuration: def.walkFrameDuration,
    walkFrameContentBox: def.walkFrameContentBox,
  };
}
window.buildFighterOptions = buildFighterOptions;

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

  // モンスターごとの技の強さ（倍率）を掛ける。
  // data/fighters.json の movePower に { "smash.side": { dmg: 1.3, kb: 1.25 } } の形で入る。
  // 絶対値ではなく倍率にしてあるので、共通のバランス調整をしても
  // 各モンスターの「この技が得意」という個性はそのまま残る。
  _scaleMove(move, scale) {
    if (!scale || !move) return move;
    const dmg = Number(scale.dmg);
    const kb = Number(scale.kb);
    const out = { ...move };
    if (Number.isFinite(dmg) && dmg > 0 && Number.isFinite(move.dmgBase)) {
      out.dmgBase = Number((move.dmgBase * dmg).toFixed(2));
    }
    if (Number.isFinite(kb) && kb > 0 && Number.isFinite(move.kbBase)) {
      out.kbBase = Number((move.kbBase * kb).toFixed(2));
    }
    return out;
  },

  // ファイター1体ぶんの技表を「共通のMOVES → movesets.jsonの上書き → 強さの倍率」の順に組み立てる。
  // 全ての技をここで実体化しておくことで、モーションを登録していない技にも倍率が効く。
  _buildMoveTable(fighterKey, groups, fighters) {
    const base = (typeof window !== 'undefined' && window.MOVES) || {};
    const power = ((fighters && fighters[fighterKey]) || {}).movePower || {};
    const result = {};
    const groupKeys = new Set([...Object.keys(base), ...Object.keys(groups || {})]);
    for (const groupKey of groupKeys) {
      const baseGroup = base[groupKey] || {};
      const overrideGroup = (groups || {})[groupKey] || {};
      const merged = {};
      for (const moveKey of new Set([...Object.keys(baseGroup), ...Object.keys(overrideGroup)])) {
        const resolved = Object.prototype.hasOwnProperty.call(overrideGroup, moveKey)
          ? this._resolveMove(groupKey, moveKey, overrideGroup[moveKey])
          : { ...baseGroup[moveKey] };
        if (!resolved || !resolved.name) continue;
        merged[moveKey] = this._scaleMove(resolved, power[`${groupKey}.${moveKey}`]);
      }
      result[groupKey] = merged;
    }
    return result;
  },

  _applyMovesets(raw, fighters) {
    const result = {};
    // movesets.json に載っていないファイターにも倍率を効かせるため、両方のキーを見る
    for (const fighterKey of new Set([...Object.keys(raw || {}), ...Object.keys(fighters || {})])) {
      result[fighterKey] = this._buildMoveTable(fighterKey, (raw || {})[fighterKey], fighters);
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
    window.FIGHTER_MOVESETS = this._applyMovesets(movesets, fighters);
    this.loaded = true;
  },
};

// 待機モーションのコマ一覧。マスモン管理や管理者モードのプレビューで使う。
// スタジオは animations.idle に書き込むが、以前は idleFrameSrcs という
// 別の項目だった。片方しか見ていないと1コマだけになって静止画になるため、
// ここ1か所で両方を見るようにしておく。
FighterData.idleFrames = function (def) {
  if (!def) return [];
  const anim = def.animations && def.animations.idle;
  if (anim && Array.isArray(anim.frames) && anim.frames.length) return anim.frames.slice();
  if (Array.isArray(def.idleFrameSrcs) && def.idleFrameSrcs.length) return def.idleFrameSrcs.slice();
  return def.idleImage ? [def.idleImage] : [];
};

// 待機モーションの1コマあたりの表示フレーム数
FighterData.idleFrameDuration = function (def) {
  const anim = def && def.animations && def.animations.idle;
  return (anim && anim.frameDuration) || (def && def.idleFrameDuration) || 8;
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
    jumpPower: def.jumpPower,
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

# スマモン（SmaMon）開発ガイド

このリポジトリで作業するAIエージェント（Claude Code / Codex など）向けの引き継ぎ書。
**作業を始める前にこのファイルを最後まで読むこと。** 特に「守ること」と「落とし穴」は
過去に実際に事故を起こした項目なので、飛ばさないでほしい。

---

## 1. これは何か

**大乱闘スマッシュモンスターズ（スマモン）** — スマブラ風の対戦アクションと
モンスターファーム風の育成を組み合わせた、スマホ向けWebゲーム（PWA）。

- **素のJavaScript**。ビルド工程・パッケージマネージャ・フレームワークは一切無い。
  `index.html` が `js/*.js` を `<script>` で順番に読むだけ。
- **GitHub Pages で公開**。`main` へ push すると数分で本番へ反映される。
- **横向き（landscape）専用**。iPhoneでホーム画面に追加して遊ぶ想定。
- バックエンドは **Firebase**（認証・Firestore）と **PeerJS**（P2P対戦）。

### 遊びの流れ

```
ログイン → ホーム
  ├ CPU戦（通常 / 100人組手 / エンドレス）→ バトル → リザルト → マスモン登録・EXP
  ├ マルチ（PeerJSでP2P。ホストが権威。EXP2倍）
  ├ マスモン管理 → トレーニング / 修行（ミニゲーム）/ スキン変更
  └ アイテム販売所（ダイヤで消費アイテムを買う）
```

「**マスモン**」＝プレイヤーが育てている個体。ベースとなるファイター定義
（`data/fighters.json`）を見た目として借り、レベル・育成ステータス・適性・
スキン（色）を個別に持つ。

---

## 2. 守ること（依頼者との取り決め）

1. **`main` へ直接コミット・プッシュする。** 本番で動作確認する運用のため、
   ブランチもPRも作らない。
2. **修正したら必ずバージョンを1つ上げ、ゲーム内の更新履歴に載せる。**
   手順は「§4 リリース手順」。忘れると利用者に更新が届かない。
3. **回答は結論から、端的に。** トークン消費を抑えたいという要望がある。
4. **日本語で書く。** コード内のコメントも、更新履歴も、コミットメッセージも日本語。
5. **モデル名（`claude-opus-5` 等）をリポジトリへ入れない。**
   コミットメッセージ・コード・PRのどこにも書かない。

### 依頼者について

- スマホ（iPhone）から**モンスター作成スタジオ**（`tools/`）を使って、自分で
  モンスターやモーションを登録する。**スタジオからのコミットが飛んでくることがある**ので、
  push が弾かれたら `git fetch` して確認し、rebase すること（§4）。
- GitHubのfine-grained PATを端末のlocalStorageに保存して使っている。
  端末を触れる人は誰でもリポジトリに書ける状態なので、有効期限は短め・
  対象リポジトリは sumamon のみ・権限は Contents の Read and write だけ、を推奨済み。

---

## 3. ディレクトリと責務

```
index.html            全画面のマークアップ。<div class="screen"> を出し入れして遷移する
css/style.css         全スタイル（1ファイル）
service-worker.js     PWAのキャッシュ。CACHE_NAME と APP_SHELL
version.json          公開中のバージョン番号（更新検知に使う）

js/
  config.js           全定数（物理・バランス・演出）。数値調整はここが起点
  physics.js          吹っ飛び・重力・着地・ステータス→効果量の変換
  moves.js            共通の技テーブル MOVES / THROWS（全ファイター共通の基準値）
  fighter.js          ファイター1体。入力→状態遷移→当たり判定→描画（最大のファイル）
  fighters-data.js    data/*.json のローダー。技表の組み立て、Fighterのオプション生成
  procedural-motion.js 専用モーションが無い技・状態を立ち絵の変形で動かす
  skin.js             色変更エンジン（OKLabでのクラスタリングと塗り替え）
  skin-editor.js      スキン変更の編集画面
  game.js             メインループ。バトルの初期化・進行・HUD・リザルト
  flow.js             画面遷移とホーム/管理/ショップ等のUI（2番目に大きい）
  growth-system.js    レベル・EXP・適性・トレーニング / MasmonStore / UserProfileStore
  stage.js            ステージ定義と描画
  camera.js           ファイター間の距離に応じた自動ズーム・追従
  cpu-ai.js           CPU思考
  input.js            キーボード・仮想パッド・bindTap（タップの取りこぼし対策）
  multiplayer.js      PeerJS + Firebase でのマルチ対戦
  practice.js         修行ミニゲーム
  debug-mode.js       管理者モード（cadmium ユーザーのみ）
  pwa.js              Service Worker登録・更新制御・横向き起動時の表示領域確定
  audio.js firebase-init.js

data/
  fighters.json       ファイター定義（見た目・体格・能力・適性・モーション等）
  movesets.json       ファイターごとの技の上書き（モーション・威力・判定）

tools/                モンスター作成スタジオ（ゲームとは独立した単体アプリ）
  index.html          スタジオ本体のマークアップ＋スクリプト読み込み
  studio-app.js       画面制御の中心
  studio-image.js     背景透過・トリミング・contentBox算出
  studio-video.js     動画からのコマ切り出し
  studio-sheet.js     スプライトシートの分割
  studio-preview.js   モーションの再生確認（自動モーション・パーツ分割も）
  studio-build.js     コミット内容の組み立て（JSON更新・SW・version・更新履歴）
  studio-github.js    GitHub API での一括コミット

docs/
  skin-design.md         スキン（色変更）の設計と実測データ
  multiplayer-setup.md   マルチ対戦のセットアップ
```

### 読み込み順（`index.html` 末尾）

`firebase-init(module) → config → audio → moves → physics → procedural-motion →
skin → skin-editor → fighter → fighters-data → debug-mode → stage → camera →
cpu-ai → growth-system → practice → input → multiplayer → game → flow → pwa`

**依存はこの順に従う。** 例えば `skin.js` は `fighter.js` より前なので、
`fighter.js` から `Skin` を呼べる。逆はできない。

### グローバルの作られ方に注意

多くのファイルがトップレベルの `const Foo = {...}` で定義されている。
これは **`window.Foo` にはならない**（トップレベルの `const` はグローバル
レキシカル環境に入るため）。テストから触る時は `window.Studio` ではなく
素の `Studio` を参照すること。`Skin` / `StudioSheet` などは明示的に
`window.X = X` しているので両方で引ける。

---

## 4. リリース手順（必須）

コードを変えたら、**必ず次の4点をセットで更新する。**

1. `service-worker.js` の `CACHE_NAME` を1つ上げる（`smamon-app-v112` → `v113`）
2. `version.json` の `version` を同じ数字にする（`"112"` → `"113"`）
3. `index.html` の `<small class="home-version">Version 1.12</small>` を `1.13` に
4. `index.html` の更新履歴（`home-history-list` の先頭）に `<article>` を1つ足す

表示は `Math.floor(n/100).(n%100)` の形式。`112` → `1.12`、`99` → `0.99`。

さらに、**中身を変えたJSやCSSは `index.html` の `?v=` を1つ上げる。**
上げ忘れると、更新は届いたのに古いファイルが使われて事故る。

```
<script src="js/fighter.js?v=52"></script>   ← 変更したら 53 へ
<link rel="stylesheet" href="css/style.css?v=65">
```

更新履歴の本文は**プレイヤー向けの言葉**で書く。技術用語ではなく
「何が起きていたか → 何が変わるか」。原因が分かっているなら簡潔に添えると
「直った理由」が伝わる。

### push が弾かれたら

依頼者がスタジオからコミットしていることがある。**force push は絶対にしない。**

```bash
git fetch origin main
git log --oneline HEAD..origin/main     # 相手が何をしたか見る
git rebase origin/main                   # 競合するのは大抵 index.html / version.json / service-worker.js
# 競合を解消：バージョンは相手の番号 +1 にし、更新履歴は両方残す
git rebase --continue
```

### スタジオからのコミットについて

スタジオは `service-worker.js` のキャッシュ番号・`version.json`・
`index.html` のバージョンと更新履歴を**自動で更新する**。つまり依頼者の
コミットもバージョンを1つ消費している。rebase 時はそこを踏まないこと。

---

## 5. データの形

### `data/fighters.json`（ファイター1体）

```jsonc
{
  "irumine": {
    "key": "irumine",
    "displayName": "イルミネ",
    "color": "#ff4757",              // HUDの枠色
    "idleImage": "assets/.../frame_001.png",
    "stockIcon": "assets/.../stock.png",
    "spriteContentBox": { "left":1, "top":6, "right":210, "bottom":244 },
    "hurtboxWidth": 55, "hurtboxHeight": 124,
    "fallSpeed": 0.92,               // 落下速度の倍率（種族の個性。育成で変わらない）
    "stats": { "power": 14, ... },   // Lv1時点の素の値。書いた項目だけ既定値を上書き
    "aptitudes": { "power": "A", ... },  // 育成適性 A〜E
    "animations": {                  // 状態モーション
      "idle":   { "frames": [...], "frameDuration": 8, "contentBox": {...} },
      "jump": {...}, "airIdle": {...}, "ledge": {...}
    },
    "parts":  { "neckY":94, "hipY":193, "legSplitX":107, "overlap":6 },  // 体の切り分け
    "weapon": { "rect": {...}, "pivot": {...} },                          // 武器を振る
    "proceduralMotion": { "enabled": true, "intensity": 1.5 },            // 自動モーション
    "movePower": { "smash.side": { "dmg": 1.3, "kb": 1.25 } }             // 技の強さ（倍率）
  }
}
```

**`spriteContentBox` が位置合わせの要。** 影や余白を除いた「キャラクター本体」の
bboxで、この高さが `hurtboxHeight` に一致するよう自動でスケールされる。
これにより技の間合い・シールド半径・掴み距離が体格に比例する。

### `data/movesets.json`（技の上書き）

```jsonc
{
  "irumine": {
    "special": {
      "neutral": { "name":"ルミナスアロー", "dmgBase":8, "kbBase":4.5, ... },
      "side":    { "extends": "special.side", "animation": {...} }
    }
  }
}
```

`extends` で `js/moves.js` の `MOVES` を継承できる。バランス値は `MOVES` で
一元管理し、モーションだけ差し替える、という使い方を想定している。

**技表の組み立ては `FighterData._buildMoveTable`**：
`共通のMOVES` → `movesets.json の上書き` → `fighters.json の movePower（倍率）`。
全技をここで実体化するので、モーション未登録の技にも倍率が効く。

### マスモン（Firestore: `users/{uid}/monsters/{id}`）

```jsonc
{
  "id": "masmon_xxx", "name": "…", "baseFighterKey": "irumine",
  "level": 12, "exp": 340, "trainingTickets": 3,
  "trainingStats": { "power": 40 },   // 育成で積んだぶん
  "aptitudes": { ... },               // ベースの適性を写したもの
  "skin": { "version": 2, "materials": [{ "lab":[L,a,b], "color":"#rrggbb"|null }] },
  "badges": { "hundred": true }
}
```

プロフィールは `users/{uid}/profile/main`（ダイヤ・所持アイテム・戦績など）。
`localStorage` はログイン情報（`smamon_saved_login`）と連戦の中断データのみ。

---

## 6. 主要な仕組み

### バトル（スマブラ準拠）

蓄積%・ヒットストップ・ヒットスタン・ベクトル変更(DI)・受け身(テック)・
急降下・着地隙・ワンパターン相殺・シールド削り・ジャストシールド・崖つかまり
を実装している。

**吹っ飛びの減速は「1フレームあたり一定量」**（`CONFIG.KNOCKBACK_DECEL`）。
割合で減らすと飛距離が初速に比例するだけで頭打ちになり、どれだけ強く打っても
撃墜できなかった。一定量なら飛距離が初速の**2乗**に比例し、強い技ほど
飛躍的に遠くへ飛ぶ（本家の手応え）。ここを割合に戻してはいけない。

**空中の慣性**：空中最高速は「自分で流せる速さ」の上限であって、吹っ飛びや
ダッシュジャンプで得た慣性はそれより速いままにする。毎フレーム上限で
切り落とすと、のけぞりが切れた瞬間に吹っ飛びが急停止する。
逆方向への入力に加速補正は付けない（本家には無い）。

**のけぞり中は行動できない。** きりもみからの復帰入力は `hitstun <= 0` を
必ず確認すること。ここを緩めると連打で吹っ飛びを抜けられ、
「ジャンプが復活した」ように見える。

### 見た目の3層

| 層 | 何をするか | 実装 |
|---|---|---|
| 専用モーション | 登録されたコマ画像を再生 | `fighter.js` の `stateAnimations` / `moveAnimations` |
| 自動モーション | 立ち絵を上下動・傾き・伸縮で動かす | `procedural-motion.js` |
| パーツ分割 | 頭・胴・左右の脚を付け根で振る | `fighter.js` `_buildPartsLayer` |

専用モーションがあるスロットではそちらが優先され、自動モーションは通らない。
**武器レイヤーとパーツ分割は「スキンを塗り替えたあとの絵」から切り出すこと。**
順序を逆にすると元の色のまま切り出される。

### スキン（色変更）

`js/skin.js`。詳細と実測データは `docs/skin-design.md`。要点だけ：

- 領域ではなく**色**で置き換えるので、専用モーションの全コマへ作業ゼロで反映される
- **OKLab空間でk-meansクラスタリング**して14個前後の「素材」に分ける
- 置き換えは素材の中心色を基準にした**相対値**（明暗の起伏を残しつつ、色は指定どおり出す）
- v1（色相バケツ）で保存されたデータも表示できるよう `_recolorV1` を残してある
- 描画は `Fighter._skinned(image)` を通すだけで全モーションに効く

### PWAの更新

`js/pwa.js`。**起動時は確認なしで最新版へ入れ替え、遊んでいる最中だけお知らせ**する。
Service Worker は中核ファイル（HTML/CSS/JS/JSON）だけを待ち、画像・音声は
有効化のあとに回す。全部を待つと更新の準備が終わらない。

更新を軽くするために、次の3つが噛み合っている。**どれか1つでも崩すと、
更新のたびに全アセットを取り直す状態（実測72MB）へ簡単に戻る**ので注意。

1. **古いキャッシュは捨てる前に引き継ぐ**（`adoptPreviousCaches`）。
   先に消すと、中身が同じ画像まで丸ごと取り直しになる。
   新しいキャッシュに既にある物は上書きしない（＝穴埋めだけ）。
2. **「変わっていないか」は自前の条件付きリクエストで聞く**（`revalidateAsset`）。
   `cache: 'no-cache'` はブラウザ側に控えが残っている時しか条件付きにならず、
   捨てられているとまるごと落とし直しになる。キャッシュ済み応答の
   ETag（無ければ更新日時）を自分で付ければ、必ず304で済む。
3. **`controllerchange` での読み込み直しは、入れ替わった時だけ**（`js/pwa.js`）。
   初回インストールの `claim()` でもこの合図は出る。ここで読み込み直すと
   初めての起動が必ず2回ぶんになり、画像も音声も二度落ちる。

### 画像アセットの決まり

**表示する大きさに対して極端に大きい画像を置かない。**
以前はアイテムの絵が1枚2.3MB（1024×1536、実際の表示は最大150px）あり、
画像全体で59MBあった。今は12MB。

- ファイター以外の画像は **WebP**（`assets/images/**/*.webp`）
- `assets/images/fighter/` は**スタジオが書き出す場所なのでPNGのまま**。触らない
- `assets/images/app-icon.png` は PWA/apple-touch-icon 用なので**PNGのまま**
  （`manifest.webmanifest` の `sizes` と実寸を合わせること）
- 差し替えたら `index.html` の `?v=` を上げる。ただし fetch ハンドラは
  `ignoreSearch: true` で引くため、`?v=` だけでは切り替わらない。
  実際の入れ替えは上の 2.（ETagでの確認）が担っている

---

## 7. モンスター作成スタジオ（`tools/`）

ゲームとは独立した単体アプリ。スマホだけで
「画像・動画・スプライトシートを選ぶ → 背景透過 → コマ選択 → 攻撃判定の設定 →
GitHubへコミット」まで完結する。

- 追加するモーションの枠は `tools/studio-motions.js` に1行足すだけで増える
- `js/procedural-motion.js` を**そのまま読み込んで**プレビューに使っている。
  スタジオ側で作り直すと、確認できた動きと本番の動きがずれるため
- コミットは GitHub の Git Data API（blob→tree→commit→ref）で**1コミットに束ねる**

スタジオを触る時は、`tools/index.html` の読み込みリストにファイルを足すのを忘れないこと
（HTTPキャッシュを避けるため `?t=` を付けて動的に読んでいる）。

---

## 8. テストのやり方

**テストフレームワークは入っていない。** Playwright を直接呼ぶ使い捨てスクリプトを
scratchpad に書いて回す。テストコードはリポジトリにコミットしない（依頼者の方針）。

```bash
# 静的サーバをリポジトリ直下で立てる（tools/ も data/ も同じオリジンで引ける）
(nohup python3 -m http.server 8123 >/dev/null 2>&1 &)

# ブラウザ経由（UI・描画・スキン・スタジオ）
node /path/to/scratchpad/mytest.js

# ブラウザ不要（物理・バランス）は vm で js を読み込んで直接叩く
```

Playwright の実体は `/opt/node22/lib/node_modules/playwright`、
Chromium は `/opt/pw-browsers/chromium`。

### 書き方の型

```js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); }
                          else { fail++; console.log('  ✗ ' + n, JSON.stringify(e)); } };
// ... p.evaluate() でページ内の関数を直接呼んで検証する
console.log(`\n結果: ${pass} 件成功 / ${fail} 件失敗`);
```

物理・バランスの検証は `vm` に `js/config.js` `js/physics.js` `js/moves.js`
`js/fighter.js` を読み込んで、`Fighter` を直接動かすのが速い。
`Math.random` を種固定に差し替えると、クリティカル抽選のせいで
たまに落ちるのを防げる。

### 大事な進め方

- **修正の前に、失敗するテストを書く。** 直したあと「本当に直ったか」だけでなく
  「元は壊れていたか」も示せる。過去に何度も、これで思い込みの修正を防いだ。
- **数値で示す。** 「弱く感じる」なら撃墜%を測る。「静止画」ならコマ数を数える。
- 描画の確認はスクリーンショットを撮って**実際に見る**。数値だけだと
  「平均色が背景に埋もれて差が出ない」といった測り方の失敗に気付けない。

---

## 9. 落とし穴（実際に踏んだもの）

1. **IDセレクタで `display` を指定すると画面が消えなくなる。**
   `.screen.hidden { display:none }` より `#screen-xxx { display:flex }` の方が
   詳細度が高い。IDで `display` を指定するなら `#screen-xxx.hidden { display:none }`
   も必ず添える。→ 起動直後にスキン変更画面が全画面に出た（v1.06で修正）。

2. **待機コマの置き場所は `animations.idle`。** 古い `idleFrameSrcs` しか
   見ていない箇所があると1コマ＝静止画になる。`FighterData.idleFrames()` を使うこと。

3. **マスモンの情報を組み立てる所は数か所ある。** ロースター→ファイターの変換で
   `skin` だけ写し忘れて、マルチ対戦で色が出なかった。項目を足したら
   `buildFighterOptions` に渡るまでの経路を全部たどること。

4. **`applyInput` の早期returnで `prevJumpHeld` 等が更新されない。**
   ヒットストップ・着地隙・ダウン中は途中で return するので、
   押しっぱなし判定がその間止まる。

5. **同じ画像を2回丸めると値がずれる。** スキンで、中心色を保存時に4桁へ丸め、
   キー生成時にさらに3桁へ丸めていたため「プリセットと同じ内容なのに有料」に
   なった。丸めは1か所（取り出した時点）で済ませる。

6. **背景透過は「足元合わせ」「不良コマ検出」より先に。** 背景が不透明なままだと
   全面が中身になり、何も判定できない。

7. **スプライトシートの区切り線検出は、背景色を線と誤認する。**
   区切り線は必ず細いので、太い帯が出たらその分け方は使わない。

8. **`Promise.allSettled(...)` を `return` すると `event.waitUntil` が待ってしまう。**
   Service Worker で画像を「裏で取る」つもりが、全部待つ動きになっていた。

9. **リスナーの二重登録。** `innerHTML` で作り直す要素に毎回 `addEventListener`
   すると、1回の操作が2回効く。作り直されない親側に一度だけ付けるか、
   `dataset.bound` で番をする。

10. **GitHub Actions の実行を安易に rerun しない。** キューに入る前の再実行は
    キャンセルできなくなり、後続のデプロイまで止まる。

---

## 10. 作業を始める時

```bash
git pull                                   # スタジオからのコミットが来ているかも
(nohup python3 -m http.server 8123 >/dev/null 2>&1 &)
```

- 数値調整なら `js/config.js` から。全定数に日本語コメントが付いている
- バトルの挙動なら `js/fighter.js`（大きいので `grep -n` で目的の関数へ）
- 画面まわりなら `index.html` でIDを探し → `js/flow.js` でその ID を `grep`
- 何かを「感じ」で直す前に、まず測る

コード内のコメントは**なぜそうしたか**を書く。何をしているかはコードを読めば
分かるので、「なぜこの値なのか」「なぜこの順序なのか」「逆にすると何が起きるか」を
残しておくと、次のセッションで同じ調査をせずに済む。

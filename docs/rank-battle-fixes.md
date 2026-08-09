# 段位戦リリース後の修正指示書（2件）

対象リポジトリ: `cadmium2525/sumamon`
前提: 段位戦（Version 1.41／1.42）が実装済みの状態からの修正。
着手前に [AGENTS.md](../AGENTS.md) と [rank-battle-plan.md](rank-battle-plan.md) を読むこと。

## 0. 共通の守りごと

- **`main` へ直接コミット・プッシュする**（ブランチもPRも作らない）
- push が弾かれたら **force push しない**。`git fetch` して rebase し、
  バージョン番号は相手の番号 +1、更新履歴は両方残す
- **リリース4点セット**（`service-worker.js` の `CACHE_NAME`・`version.json`・
  `index.html` のバージョン表記・更新履歴）を必ずセットで更新する
- 変更した JS/CSS は `index.html` の `?v=` を1つ上げる
- コメントもコミットメッセージも日本語。コメントは「なぜ」を書く

---

# 修正1: 段位戦の敗北報酬（周回できてしまう穴を塞ぐ）

## 何が起きているか

`js/flow.js` `_renderRankBattleResult()` の敗北時の報酬が
**「その段階の初回報酬の10%」の固定割合**になっている。

```js
const reward = won ? fullReward : {
  masmonExp: Math.max(1, Math.round(fullReward.masmonExp * 0.1)),
  diamonds: 0, breederExp: 0, practiceTickets: 0, trainingTickets: 0,
};
```

`firstClear` は「まだ勝っていないこと」で判定しているため、
**負け続けている限りずっと初回扱いのまま**になる。
その結果、レジェンド杯では**負けるたびに 12,000 EXP が無限に入る**。

実測（結果処理を5回通した値）:

```
レジェンド杯にわざと5連敗 → Lv40 から Lv43 へ（優勝0回のまま）
```

自滅3回で終わるので1回あたり20〜30秒。**正攻法で勝つより効率が良い**。
四大大会も未制覇のうちは1回 4,000 EXP で同じことができる。

これは仕様を決めた側（計画書）の抜けであり、実装は指示どおりに書かれている。

## どう直すか

**敗北時は固定割合をやめ、通常CPU戦と同じ「戦った内容に応じた計算」にする。**

既に `GROWTH.computeBattleExp()` がある。順位・撃墜数・被撃墜数から出すので、
**即自滅すれば下限の 60 EXP、善戦した敗北なら数百 EXP** になる。
周回する意味が消え、かつ「惜しい負け」はきちんと報われる。

`_renderRankBattleResult(panel, opts, p1Entry)` の敗北側を次のようにする。

```js
// 敗北時は固定割合ではなく、実際に戦った内容から出す。
// 初回報酬の一定割合にすると、初回扱いが解除されない＝負け続けるのが
// 最も効率の良い稼ぎ方になってしまう（レジェンド杯で実測：わざと5連敗で Lv40→43）。
// 通常CPU戦と同じ計算にすれば、即自滅は下限の60EXPで終わり、
// 競り負けはそれなりに報われる。
const loseExp = GROWTH.computeBattleExp({
  placement: p1Entry ? p1Entry.rank : 2,
  totalFighters: 2,
  kos: p1Entry?.kos || 0,
  falls: p1Entry?.falls || 0,
  cpuLevel: def.cpuLevel,
}).total;

const reward = won ? fullReward : {
  masmonExp: loseExp,
  diamonds: 0, breederExp: 0, practiceTickets: 0, trainingTickets: 0,
};
```

- `def` は既にこの関数の中で `RankBattle.definition(...)` から取得済み。
- `computeBattleExp` の `levelMultiplier` は内部で `Math.min(9, cpuLevel)` する。
  レジェンド杯（レベル10）でも 1.7 倍として扱われる。**これで問題ないので触らないこと。**
- 勝利側（`fullReward`）は**一切変更しない**。依頼者が指定した額のまま。

### 直したあとの想定値（実装後に必ず実測して確認すること）

| 状況 | 敗北EXP |
|---|---|
| 即自滅で終わる（撃墜0・被撃墜3・CPU Lv9） | 約 173 |
| 競り負け（撃墜2・被撃墜3・CPU Lv9） | 約 479 |
| （比較）レジェンド杯の再挑戦に勝利 | 40,000 |

**勝利報酬に対して 100分の1 以下**になり、周回する意味が無くなる。

### 表示も直すこと

敗北時の結果画面に「10%」を前提にした文言が残っていれば直す。
「善戦するほど多くもらえる」ことが伝わる表示にする
（通常CPU戦と同じ `順位 / 撃墜 / 被撃墜` の内訳を出すのが分かりやすい）。

### 任意（依頼者に確認してから）

「高段位の敗北はもう少し報われてほしい」という話になった場合のみ、
段階ごとの係数（E〜A: 1.0〜1.6／四大大会: 2.0／レジェンド杯: 2.5）を掛けてよい。
ただし**上限 1,200 EXP でクランプすること**。上限が無いと同じ穴が再発する。
**指示が無ければ係数は入れない。**

---

# 修正2: CPUの人数をモンスター選択画面で変えられるようにする

## 何が起きているか

CPU人数のピッカー（`.cpu-count-btn`）が **CPU戦のモード選択画面** にあり、
実際にモンスターを並べる画面では変えられない。

さらに `openRankBattle()` が `this.selectedCpuCount = 1` を代入するのに
ボタンの選択表示を更新しないため、**表示と実際の値がズレる**。

```
「3人」を選ぶ → 段位戦へ入る → 戻る
  実際の値: 1 ／ 画面の表示: 3人（ハイライトされたまま）
```

## どう直すか

**人数ピッカーをモンスター選択画面（`#screen-fighter-select`）へ移す。**
モード選択画面からは取り除く。これでズレは構造的に起きなくなる。

### 2-1. HTML（`index.html`）

- `#screen-cpu-mode` の `<div class="cpu-count-picker">…</div>` を**削除**する。
- `#screen-fighter-select` の `#token-bar` の**すぐ上**へ移す。
  段位戦はこの画面を使わない（専用の `#screen-rank` を持つ）ので、
  段位戦に出てしまう心配は無い。

```html
<div id="screen-fighter-select" class="screen hidden">
  <div class="screen-heading" id="fighter-select-heading">ファイター選択</div>
  <div class="fighter-longpress-guide">…</div>
  <div id="cpu-count-picker" class="cpu-count-picker hidden">
    <span id="cpu-count-label">同時に出てくるCPU</span>
    <button class="cpu-count-btn active" data-cpu-count="1">1人</button>
    <button class="cpu-count-btn" data-cpu-count="2">2人</button>
    <button class="cpu-count-btn" data-cpu-count="3">3人</button>
  </div>
  <div id="token-bar" class="token-bar hidden"></div>
  …
```

### 2-2. 表示条件

| モード | ピッカー | 理由 |
|---|---|---|
| 通常バトル（`normal`） | **出す** | 同時に戦うCPUの数 |
| 100人組手（`hundred`） | **出す** | `cpuCount` は「同時に出てくる人数」として実際に使われている（`js/game.js` の `for (let slot = 1; slot <= options.cpuCount; slot++) spawnSurvivalCpu(...)`） |
| エンドレス（`endless`） | **出す** | 同上 |
| マルチ（`multi`） | **出さない** | 人数は部屋の設定で決まる |
| 段位戦（`rank`） | — | この画面を通らない |

ラベルは分かりやすく出し分けること。

- 通常バトル … `対戦するCPUの人数`
- 100人組手・エンドレス … `同時に出てくるCPUの人数`

### 2-3. 挙動（ここが本題。**選択途中で人数を変えても壊れないこと**）

`_resetFighterSelectState()` はトークン欄を作り直すが、**置いたトークンを全部捨てる**。
人数変更のたびにこれを呼ぶと、**選んだモンスターが消えて操作感が悪い**。

人数変更用に、**既に置いたものを残す**別の処理を用意すること。

```js
// 人数を変えた時は、既に置いてある玉を残したままトークン欄だけ作り直す。
// _resetFighterSelectState() をそのまま呼ぶと 1P の選択まで消えてしまい、
// 「3人にしたら選び直し」という理不尽な操作になる。
setCpuCount(count) { ... }
```

満たすこと:

1. `tokens.p1` は**必ず維持する**
2. 減らした時 … 新しい人数を超える `cpuN` は捨てる
3. 増やした時 … 増えたぶんは空スロットとして足す（既存の `cpu1..cpuN` は維持）
4. `activeTokenId` が消えたスロットを指していたら `null` に戻す
5. トークン欄・カードのバッジ・FIGHTボタンの表示を作り直す
   （`_bindTokenDrag()` / `_renderCardBadges()` / `_updateFightButtonVisibility()`）
6. ボタンの `active` 表示を `selectedCpuCount` と必ず一致させる
7. 連戦モード（`hundred` / `endless`）では**トークン欄にCPUの玉を出さない**
   （現状どおり）が、`selectedCpuCount` は変えられること

### 2-4. 画面を開くたびに表示を合わせる

`_resetFighterSelectState()` の中で、

- ピッカーの表示・非表示（上の表のとおり）
- ラベルの文言
- `.cpu-count-btn` の `active` を `this.selectedCpuCount` に合わせる

を必ず行う。**ここを忘れると今と同じズレが別の場所で再発する。**

### 2-5. `openRankBattle()` から人数の書き換えを外す

```js
openRankBattle() {
  this.selectedMode = 'cpu';
  this.selectedCpuMode = 'rank';
  this.selectedCpuCount = 1;   // ← この行を削除する
```

段位戦は `startRankChallenge()` が `cpuCount: 1` を明示的に積んでいるので、
ここで共有の値を書き換える必要が無い。**削除すれば、他モードで選んだ人数が
段位戦へ寄り道しただけで勝手に1へ戻る問題も同時に消える。**

### 2-6. CSS（`css/style.css`）

`.cpu-count-picker` は既存のスタイルを流用してよい。
移設先で崩れないか、**iPhone横向き（844×390）で必ず確認すること**。
モンスターのカード一覧が縦に詰まるので、ピッカーの高さが増えると
カードがはみ出す可能性がある。

---

## 3. テスト（Playwright／`serviceWorkers: 'block'`）

リポジトリ直下で静的サーバを立てて実行する。**数値は必ず実測すること。**

**修正1**

1. レジェンド杯にわざと負けた時のEXPが **1,000未満**になっている
2. わざと5連敗してもレベルが上がらない（現状は Lv40→43 になる。ここが回帰の要）
3. 競り負け（撃墜2・被撃墜3）が即自滅よりEXPが多い
4. **勝利報酬は変わっていない**（レジェンド初優勝＝EXP120,000・💎1,500・
   修行券5枚・専用トレーニング券10枚・ユーザーEXP）
5. 敗北で段位が下がらない／ダイヤ・チケットが入らない（従来どおり）

**修正2**

6. 通常バトルのモンスター選択画面にピッカーが出る／モード選択画面には無い
7. 100人組手・エンドレスでもピッカーが出て、ラベルが「同時に出てくる」表記になる
8. マルチでは出ない
9. **1Pを置いてから人数を3人へ変えても、1Pの選択が消えない**
10. 3人ぶん置いてから1人へ減らし、再び3人へ戻すと、cpu1 の選択は残っている
11. 人数を変えるとトークン欄のCPUの玉の数が一致する
12. 人数を変えたあと FIGHT ボタンの出る条件が正しい
    （全スロットが埋まった時だけ出る）
13. **ボタンの `active` 表示と `selectedCpuCount` が常に一致する**
    （段位戦へ入って戻る、を挟んでも一致すること）
14. 実際に3人で開始すると CPU が3体出る
15. 100人組手を3人設定で開始すると同時に3体出る

**回帰**

16. 段位戦・通常CPU戦・100人組手・エンドレス・マルチが従来どおり動く
17. ページ内JSエラーが0件

---

## 4. 踏みやすい落とし穴

1. **人数変更で `_resetFighterSelectState()` をそのまま呼ぶ。**
   1Pの選択まで消えて操作感が悪化する。専用の処理を用意すること。
2. **`active` 表示の更新を1か所でも忘れる。** 今回直している不具合そのものが再発する。
   「`selectedCpuCount` を書き換える場所」と「表示を更新する場所」を必ず対にする。
3. **連戦モードでピッカーを消してしまう。**
   `cpuCount` は 100人組手でも実際に使われている（同時出現数）。
   トークン欄にCPUの玉が出ないことと、人数設定が無いことは別。
4. **勝利報酬に手を入れてしまう。** 修正1は敗北側だけ。
5. **`computeBattleExp` の `Math.min(9, cpuLevel)` を10へ広げる。**
   通常CPU戦のEXPまで変わる。**触らないこと。**
6. `?v=` の上げ忘れ、リリース4点セットの片手落ち。
7. 依頼者と同じバージョン番号を取る → rebase して +1、更新履歴は両方残す。
   **force push はしない。**

---

## 5. 進め方

1. 修正1（敗北報酬）→ テスト1〜5 → コミット
2. 修正2（人数ピッカー移設）→ テスト6〜15 → コミット
3. 回帰テスト（16〜17）→ リリース4点セット → push

更新履歴には、遊ぶ人向けに次の2点が伝わるように書くこと。

- 段位戦で**わざと負けて経験値を稼げてしまう**状態だったのを直したこと
  （勝利時の報酬は変えていないこと、競り負けはきちんと報われること）
- CPUの人数を**モンスターを選ぶ画面で変えられる**ようにしたこと

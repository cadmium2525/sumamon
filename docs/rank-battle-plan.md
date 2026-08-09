# 段位戦（CPU戦・第4モード）実装計画書

対象リポジトリ: `cadmium2525/sumamon`
この文書は実装者（別AIエージェント想定）への指示書である。
着手前に必ず [AGENTS.md](../AGENTS.md) を読むこと。

---

## 0. 先に読むべき前提（守らないと壊れる）

- **`main` へ直接コミット・プッシュする。** ブランチもPRも作らない。
- **push が弾かれたら force push しない。** 依頼者がスタジオからコミットしている。
  `git fetch` して rebase し、バージョン番号は相手の番号 +1、更新履歴は両方残す。
- **リリース4点セット**（`service-worker.js` の `CACHE_NAME`・`version.json`・
  `index.html` のバージョン表記・更新履歴）を必ずセットで更新する。
- 変更した JS/CSS は `index.html` の `?v=` を1つ上げる。
- **新規JSファイルは3か所へ登録する。** 忘れると本番だけ動かない。
  1. `index.html` の `<script>`（`?v=1` 付き）
  2. `service-worker.js` の `APP_SHELL`
  3. （テストを書くなら）読み込み待ちの条件
- **`js/*.js` はクラシックスクリプト。** トップレベルの `const`/`let`/`function` は
  `window` に生えない。テストからは `window.Foo` ではなく裸の識別子で参照すること。
  逆に、他ファイルから使う値は `const` のままで参照できる（同じグローバル字句環境）。
- 描画パスで `Math.random()` を使わない（既存の `_noise(seed)` を使う）。
- コメントもコミットメッセージも日本語。コメントは「何を」ではなく **「なぜ」** を書く。

---

## 1. 実装するもの（全体像）

CPU戦に4つ目のモード **段位戦** を追加する。

```
マスモンは段位(rank)を1つ持つ。初期値 E。

  E ─勝つ→ D ─勝つ→ C ─勝つ→ B ─勝つ→ A ─勝つ→ S
                                                  │
                                    S到達で四大大会が解禁
                                                  ↓
        ┌──────────────┬──────────────┬──────────────┬──────────────┐
        │ マスターズ・  │ グレート     │ ディスク・   │ オールスター │
        │ オブ・        │ モンスターズ │ オブ・       │ バトル       │
        │ ブリーディング│              │ ゴールド     │              │
        └──────────────┴──────────────┴──────────────┴──────────────┘
                                                  │
                                    4つ全制覇でレジェンド杯が解禁
                                                  ↓
                                          🏆 レジェンド杯
```

段位・称号は**マスモン単位**で持つ（ユーザー単位ではない）。
別のマスモンを育てれば、そのマスモンはまた E から始まる。

---

## 2. データモデルの変更

### 2-1. マスモン（`js/growth-system.js` / `MasmonStore._normalize`）

`_normalize(record)` に3つ追加する。**ここを通さないと既存マスモンに段位が無く、
`undefined` のまま画面へ出てしまう**ので必ず既定値を入れること。

```js
// 段位。E→D→C→B→A→S の順に1つずつ上がる。マスモンごとに持つ。
record.rank = GROWTH.RANK_ORDER.includes(record.rank) ? record.rank : 'E';
// 四大大会の制覇フラグ { masters:true, great:true, disk:true, allstar:true }
record.titles = (record.titles && typeof record.titles === 'object') ? record.titles : {};
// レジェンド杯の優勝回数（2回目以降は報酬が減るので回数で判定する）
record.legendWins = Math.max(0, Number(record.legendWins) || 0);
```

Firestore の保存は既存の `MasmonStore.update(record)` がそのまま使える
（ドキュメント全体を書くため、フィールド追加に対応は不要）。

### 2-2. 戦績（`js/growth-system.js` / `normalizeBattleRecords`）

`cpu` の下に `rank` を追加する。既存の3キーと同じ形にすること。

```js
cpu: {
  normal: normalize(records.cpu?.normal || blank()),
  hundred: normalize(records.cpu?.hundred || blank()),
  endless: normalize(records.cpu?.endless || blank()),
  rank:    normalize(records.cpu?.rank    || blank()),   // 追加
},
```

`js/flow.js` のマイページ戦績一覧（`{ label: 'CPU戦・100人組手', ... }` の並び）へも
`{ label: 'CPU戦・段位戦', record: records.cpu?.rank }` を足す。

### 2-3. `GROWTH` への定数追加

```js
// 段位の並び。昇格判定はこの配列の添字で行う（文字列比較しないこと）
RANK_ORDER: ['E', 'D', 'C', 'B', 'A', 'S'],
```

> 注意: 既存の `GROWTH.RANKS`（`['E','D','C','B','A']`）は**適正ランク**であり別物。
> S が無いのでこれを流用しないこと。名前が紛らわしいので必ずコメントを残すこと。

---

## 3. 新規ファイル `js/rank-battle.js`

段位戦の**定義と報酬計算だけ**を持つ。DOM も描画も触らない
（テストから純粋な計算として叩けるようにするため）。

`index.html` では **`js/growth-system.js` より後、`js/flow.js` より前**に読み込む。

### 3-1. 相手のステータス

すべて明示値で持つ。`applyCpuLevelStats` は使わず、`statOverrides.cpu` で丸ごと上書きする
（段位戦の相手は「決められた強さ」であるべきで、適正による揺らぎを入れたくないため）。

上限は `GROWTH.STAT_MAX`（999）。プレイヤー側の参考値は
「Lv99・適正A・修行なし」で約 324、「Lv99・適正C」で約 167。

| 段階 | ライフ | ちから | かしこさ | 命中 | 回避 | 丈夫さ | CPUレベル |
|---|---|---|---|---|---|---|---|
| E の番人 | 120 | 90 | 90 | 90 | 90 | 90 | 4 |
| D の番人 | 220 | 180 | 180 | 180 | 180 | 180 | 5 |
| C の番人 | 340 | 300 | 300 | 300 | 300 | 300 | 6 |
| B の番人 | 470 | 430 | 430 | 430 | 430 | 430 | 7 |
| A の番人 | 610 | 570 | 570 | 570 | 570 | 570 | 8 |

四大大会（平均750前後・大会ごとに突出を作る）。**CPUレベルは全て9**。

| 大会 | ライフ | ちから | かしこさ | 命中 | 回避 | 丈夫さ | 性格 |
|---|---|---|---|---|---|---|---|
| マスターズ・オブ・ブリーディング | **900** | 700 | 700 | 700 | 620 | **900** | 落ちない・耐える |
| グレートモンスターズ | 780 | **920** | 660 | 720 | 640 | 760 | 一撃が重い |
| ディスク・オブ・ゴールド | 680 | 700 | 720 | **900** | **930** | 640 | 速い・当ててくる |
| オールスターバトル | 780 | 780 | **850** | 780 | 780 | 780 | 穴が無い |

レジェンド杯。**CPUレベル10（新設）**。

| | ライフ | ちから | かしこさ | 命中 | 回避 | 丈夫さ |
|---|---|---|---|---|---|---|
| レジェンド杯 | 900 | 900 | 900 | 900 | 900 | 900 |

### 3-2. 定義テーブル

```js
const RANK_BATTLES = {
  // 昇格戦。key は「今の段位」。勝つと RANK_ORDER の1つ上へ上がる。
  E: { name: 'Eランク昇格戦', fighterKey: 'irumine',  stageKey: 'cosmo',
       cpuLevel: 4, stats: { life:120, power:90,  intelligence:90,  accuracy:90,  evasion:90,  defense:90  } },
  D: { ... cpuLevel: 5 ... },
  C: { ... cpuLevel: 6 ... },
  B: { ... cpuLevel: 7 ... },
  A: { name: 'Sランク昇格戦', ... cpuLevel: 8 ... },
};

const TOURNAMENTS = {
  masters: { name: 'マスターズ・オブ・ブリーディング', short: 'MoB',
             fighterKey: 'dullahan', stageKey: 'waterfall_ruins', cpuLevel: 9,
             stats: {...}, flavor: '守り抜く者の大会' },
  great:   { name: 'グレートモンスターズ', ... },
  disk:    { name: 'ディスク・オブ・ゴールド', ... },
  allstar: { name: 'オールスターバトル', ... },
};

const LEGEND = { name: 'レジェンド杯', fighterKey: ..., stageKey: ..., cpuLevel: 10, stats: {...} };
```

- `fighterKey` は `data/fighters.json` に実在するキー（現在 `irumine` / `dullahan` / `nendoro`）。
  **存在しないキーを書くと起動時に落ちる。** 実装時に必ず現物を確認すること。
  モンスターが増えたら大会ごとに割り振り直してよい。
- `stageKey` は `js/stage.js` の定義（現在 `waterfall_ruins` / `cosmo`）。
- 大会ごとに相手のモンスター種と地形を固定し、「この大会はこの相手」と覚えられるようにする。

### 3-3. 進行判定 API

```js
const RankBattle = {
  // 次に挑めるもの一覧を返す。UIはこの戻り値だけを見て描く。
  // 戻り値: [{ type:'rank'|'tournament'|'legend', key, name, locked, cleared, def }]
  available(masmon) { ... },

  // 勝った時の段位・称号の更新。マスモンを書き換えて結果を返す。
  // 戻り値: { promoted, fromRank, toRank, tournamentCleared, legendCleared, allTournamentsDone }
  applyWin(masmon, challenge) { ... },

  // 報酬額。初回か再挑戦かで変わるので、applyWin より前に「初回か」を判定して渡すこと。
  rewardFor(challenge, { firstClear }) { ... },
};
```

進行のルール:

- 段位が S 未満 → 挑めるのは `RANK_BATTLES[masmon.rank]` の1つだけ。
- 段位が S → 四大大会4つが挑戦可能。**制覇済みでも再挑戦できる**（報酬は減額）。
- 四大大会を4つとも制覇 → レジェンド杯が解禁。**何度でも挑戦できる**。
- **負けても降格しない。** 何度でも挑み直せる。

---

## 4. 報酬

### 4-1. 段位戦の報酬表

| 段階 | マスモンEXP | 💎ダイヤ | ブリーダーEXP | 修行チケット | トレーニングチケット |
|---|---|---|---|---|---|
| E 昇格 | 1,500 | 100 | 150 | 0 | 1 |
| D 昇格 | 3,000 | 200 | 200 | 0 | 1 |
| C 昇格 | 6,000 | 350 | 300 | 1 | 2 |
| B 昇格 | 12,000 | 550 | 450 | 1 | 2 |
| A 昇格（S到達） | 24,000 | 800 | 700 | 2 | 3 |
| 四大大会（初回制覇） | 40,000 | 1,000 | 900 | 2 | 3 |
| 四大大会（2回目以降） | 12,000 | 200 | 300 | 0 | 1 |
| **レジェンド杯（初優勝）** | **120,000** | **1,500** | **1,500** | **5** | **10** |
| レジェンド杯（2回目以降） | 40,000 | 300 | 500 | 1 | 2 |

- **修行チケット** = `UserProfileStore.addPracticeTickets()`（修行コース用・全マスモン共通）
- **トレーニングチケット** = `masmon.trainingTickets += n`（**そのマスモン専用**。依頼どおり）
- **ブリーダーEXP** = `UserProfileStore.addBreederExp()`（＝ユーザー経験値）
- マスモンEXP は `GROWTH.addExp(record, exp)` で付与する。
  段位戦では通常の `computeBattleExp`（順位・撃墜数による変動）は**使わない**。
  勝てば固定、負ければ0（後述の敗北報酬のみ）。理由は、額が大きいので
  撃墜数のブレで数千EXP変わると「運ゲー」に見えるため。
- **敗北時**: マスモンEXP はその段階の 10%、ほかは無し。
  何度も挑めるので、負けが完全な無駄にならない程度に留める。

> **数値の裏取り**（`expForLevel(level) = 50 * level^1.6` を実際に積算した値）
>
> | 到達レベル | 必要累計EXP |
> |---|---|
> | Lv20 | 43,440 |
> | Lv30 | 127,481 |
> | Lv42 | 約 32.0万 |
> | Lv50 | 489,709 |
> | Lv99 | 2,930,370 |
>
> 上表を E から全部さらうと **326,500 EXP**、おおよそ **Lv42** 相当。
> 「段位戦を一周すれば Lv40 台まで来る」という設計。
> 以降はレジェンド杯の再挑戦（4万EXP）が主なレベル上げ手段になる想定で、
> Lv50→51 が約0.7回、Lv50 から Lv99 までは約70回。エンドコンテンツの周回として妥当な範囲。

### 4-2. 通常CPU戦のEXP底上げ（依頼「現状なかなかレベルが上がりづらい」への対応）

`GROWTH.computeBattleExp` の基礎値を **3倍** にする。

```js
const placementRewards = [300, 210, 150, 105];   // 現 [100, 70, 50, 35]
const koExp = Math.max(0, kos || 0) * 90;        // 現 30
const fallPenalty = Math.max(0, falls || 0) * 36; // 現 12
const total = Math.max(60, ...);                  // 現 20
```

倍率 `levelMultiplier` と式の形はそのまま。
**この関数は連戦モード（100人組手・エンドレス）では呼ばれない**
（`renderResult` が `result.survival` で早期 return するため）ので、
影響範囲は通常CPU戦とマルチだけ。

効果の目安: CPUレベル9・1対1・3撃墜・無被撃墜で **969 EXP**（現状 323 EXP）。
Lv50 到達に必要な通常CPU戦の回数が おおよそ 1,500回 → 500回 になる。
それでも多いので、レベル上げの主役は段位戦側に置く。

> ここは balance に直接効くので、依頼者が「3倍は多い/少ない」と言えば
> この4つの数字だけを直せば済むように、まとめて定数化しておくこと。

### 4-3. マルチの報酬を差し替え（依頼どおり）

現状のマルチの目玉「マスモンEXP ×2」は、4-1/4-2 で相対的に無意味になる。
目玉を **修行チケット** へ移す。

- `js/flow.js` の `const expMultiplier = opts.mode === 'multi' ? 2 : 1;` → **削除し等倍にする**
  （`_renderMasmonExpResult` の内訳表示 `マルチ報酬 ×2` も消す）
- マルチで **1位なら修行チケット +1枚**、2位以下は **フリートレーニングチケット +1枚**
- `index.html` のホームのバッジ
  `<span class="multi-exp-badge">マスモンEXP ×2</span>`
  → `<span class="multi-exp-badge">修行チケット</span>`
  （CSSクラス名は既存のまま流用してよいが、`multi-exp-badge` は意味とずれるので
   コメントで理由を残すか、クラス名も併せて改名すること）

---

## 5. CPUレベル10（レジェンド杯専用の最強AI）

### 5-1. 絶対条件

**プレイヤーと完全に同じ土俵で戦わせること。** 以下は一切やらない。

- 物理・フレームデータ・ダメージ計算を CPU だけ変える
- 相手の入力を先読みする（発生前の技を知る）
- 無敵・ヒットストップ・のけぞりを CPU だけ短縮する
- 1フレームに複数回入力する

強さは **`CPU_LEVEL_ANCHORS` 相当のパラメータのみ**で表現し、
入力は既存どおり `applyInput()` を1フレーム1回通す。

### 5-2. 実装（`js/cpu-ai.js`）

**既存レベル1〜9の挙動を1ミリも変えないこと。** 補間の分母 `(lvl - 1) / 8` を
`/ 9` にするなど絶対にしない。全レベルがずれて既存のバランスが壊れる。

```js
// 1〜9 は従来どおり補間で作る（分母は 8 のまま。変えると全レベルがずれる）
for (let lvl = 1; lvl <= 9; lvl++) { ... 既存のまま ... }

// レベル10（レジェンド杯専用）は補間の延長ではなく、独立した値として定義する。
// 補間を10まで伸ばすと1〜9まで全部ずれてしまうため。
// ズルはしていない。反応の速さと判断の正確さを詰めただけで、
// 物理・フレームデータ・入力経路はプレイヤーと同一。
CPU_LEVEL_PARAMS[10] = {
  decisionInterval: 2,
  decisionJitter: 1,
  errorRate: 0.0,
  aggressiveness: 0.95,
  reactChance: 0.95,
  smashChance: 0.35,
  grabChance: 0.20,
  edgeGuardSkill: 1.0,
  projectileGuard: 1.0,
  punishSkill: 0.98,
  justShieldSkill: 0.70,
};
```

`CPUController` のクランプを `Math.min(9, ...)` → `Math.min(10, ...)` に広げる。

### 5-3. クランプが9のまま残る箇所（触らなくてよいが把握しておくこと）

- `js/game.js` の `applyCpuLevelStats()` … 段位戦は `statOverrides.cpu` で
  丸ごと上書きするので通らない。**9のままでよい。**
- `js/growth-system.js` の `computeBattleExp()` の `Math.min(9, cpuLevel)` …
  段位戦は固定EXPで別計算なので通らない。**9のままでよい。**

---

## 6. バトルの起動

`js/flow.js` の `lastLaunchOptions` に段位戦用の値を積んで `playBattleIntro()` を呼ぶ。
`window.startBattle` は既に `statOverrides` に対応しているので、**game.js の
バトル生成ロジックは基本的に触らなくてよい**。

```js
this.lastLaunchOptions = {
  stageKey: challenge.def.stageKey,
  p1Key: masmon.baseFighterKey,
  p2Key: challenge.def.fighterKey,
  p1MasmonId: masmon.id,
  p2MasmonId: null,
  cpuCount: 1,
  cpuFighters: [{ fighterKey: challenge.def.fighterKey, masmonId: null }],
  mode: 'cpu',
  cpuMode: 'rank',
  cpuLevel: challenge.def.cpuLevel,
  // 段位戦の相手は「決められた強さ」。適正やレベル補正による揺らぎを入れない。
  statOverrides: { cpu: { ...challenge.def.stats } },
  rankChallenge: { type: challenge.type, key: challenge.key },  // 結果画面での報酬判定に使う
};
```

対戦カード（versus）は **出す**。`_shouldShowVersus()` は
`['hundred','endless'].includes(options.cpuMode)` を除外条件にしているので、
`'rank'` は自動的に「出す」側に入る。**変更不要。**

---

## 7. 画面

### 7-1. CPU戦モード選択（`index.html` `#screen-cpu-mode`）

4枚目のカードを追加する。

```html
<button id="btn-mode-rank" class="cpu-mode-card">
  <strong>段位戦</strong><small>Eランクから頂点をめざす</small>
  <span class="cpu-mode-reward reward-premium">大量EXP・専用チケット・💎</span>
</button>
```

同時出現CPU人数のピッカーは段位戦では意味が無い（常に1対1）。
段位戦カードを押した時は人数を無視して 1 固定で進めること。

### 7-2. 段位戦画面（新規 `#screen-rank`）

1. 出場するマスモン一覧（段位バッジ付き）
2. 選ぶと、そのマスモンの挑戦先一覧
   - S未満 → 昇格戦1つ
   - S → 四大大会4つ（制覇済みには 👑、未制覇には報酬額）
   - 4大会制覇済 → レジェンド杯（🏆・優勝回数を表示）
3. 選ぶと相手ステータスの確認 → 「挑戦する」→ versus → バトル

`AppFlow.showScreen('rank')` で入れるようにし、`showScreen` の
「画面が無ければ home へ落とす」ガードに引っかからないよう
`id="screen-rank"` を必ず付けること。

### 7-3. 結果画面（`js/flow.js` `renderResult` 系）

`opts.rankChallenge` があるときの分岐を追加する。**既存の
「連戦モードの early return」より後ろ、通常CPU戦の報酬付与より前**に置くこと。
そのまま通すと 💎50 とブリーダーEXP50 が二重に入る。

表示するもの:
- 勝敗
- 昇格演出（E → **D** のように段位が上がるところを見せる）
- 四大大会の初制覇なら 👑 と大会名
- レジェンド杯優勝なら 🏆
- 獲得内訳（マスモンEXP／💎／ブリーダーEXP／修行チケット／トレーニングチケット）
- 全マスモンの段位が変わったので `this.buildFighterList()` を呼ぶこと

### 7-4. マスモン管理・一覧への段位表示

`_fighterCardHtml` に段位バッジを足す（100人組手バッジ `hundred-clear-badge` と同じ作り）。
四大大会の制覇数と、レジェンド杯優勝回数も小さく出せるとよい。

---

## 8. 触るファイル一覧

| ファイル | 変更内容 |
|---|---|
| `js/rank-battle.js` | **新規**。定義テーブルと進行・報酬計算 |
| `js/growth-system.js` | `RANK_ORDER` 追加／`_normalize` に rank・titles・legendWins／`normalizeBattleRecords` に `rank`／`computeBattleExp` の基礎値3倍 |
| `js/cpu-ai.js` | レベル10 の追加、クランプを10へ |
| `js/flow.js` | 段位戦の画面・起動・結果・報酬付与／マルチ報酬の差し替え／戦績一覧に段位戦 |
| `index.html` | `#screen-rank` 追加／`btn-mode-rank` 追加／マルチバッジ文言／`<script>` 追加／`?v=` 更新／バージョン表記／更新履歴 |
| `css/style.css` | 段位バッジ・大会カード・昇格演出 |
| `service-worker.js` | `APP_SHELL` に `./js/rank-battle.js`／`CACHE_NAME` |
| `version.json` | 番号 |
| `js/game.js` | **原則触らない**（`statOverrides` で足りる） |

---

## 9. テスト（Playwright／`serviceWorkers: 'block'`）

AGENTS.md の「テストのやり方」に従い、リポジトリ直下で静的サーバを立てて実行する。
**以下は最低ライン。数値は必ず実測で確認し、通ったことにしない。**

**進行**
1. 新規マスモンの初期段位が `E` になる（既存マスモンを読み込んでも `E` が入る＝移行の確認）
2. E で勝つと D へ上がる。負けても E のまま（降格しない）
3. A で勝つと S になり、四大大会4つが `locked: false` になる
4. S 未満では四大大会もレジェンド杯も出てこない
5. 四大大会を3つ制覇してもレジェンド杯は出ない。4つ目で出る
6. 制覇済みの大会に再挑戦できる／報酬が減額側になる

**戦闘**
7. 段位戦のCPUのステータスが定義表と**完全に一致**する
   （`window.previewBattleRoster()` の戻り値で確認するのが確実）
8. レジェンド杯のCPUが ALL 900 で、CPUレベルが 10 になっている
9. **レベル1〜9のパラメータが変更前と1つも変わっていない**
   （`CPU_LEVEL_PARAMS` を変更前の値と全キー突き合わせる。ここが一番壊しやすい）
10. レベル10のCPUがレベル9のCPUに勝ち越す（同ステータス同士で複数回対戦させる。
    乱数でぶれるので、1本勝負ではなく勝率で見ること）

**報酬**
11. レジェンド杯初優勝で 💎+1500／修行チケット+5／そのマスモンの
    トレーニングチケット+10／ブリーダーEXP加算 が**すべて**入る
12. トレーニングチケットが**戦ったマスモンにだけ**入る（他のマスモンは増えない）
13. 段位戦の結果画面で、通常CPU戦の 💎50 とブリーダーEXP50 が**二重取りされていない**
14. マルチのマスモンEXPが等倍になっている（×2表示が消えている）
15. マルチ1位で修行チケットが増える

**回帰（既存を壊していないこと）**
16. 通常CPU戦・100人組手・エンドレスが従来どおり動く
17. 100人組手の到達報酬が変わっていない
18. ページ内JSエラーが0件

---

## 10. 踏みやすい落とし穴（過去に実際に踏んだもの）

1. **新規JSを `service-worker.js` の `APP_SHELL` に足し忘れる。**
   ローカルでは動くが、PWAとしてインストール済みの端末では読み込まれない。
2. **`CPU_LEVEL_PARAMS` の補間分母を 8 から 9 に変えてしまう。**
   レベル10を「補間の延長」で作ろうとすると必ずこれをやる。全レベルがずれる。
   レベル10は独立した値として定義すること。
3. **`GROWTH.RANKS`（適正E〜A）と段位（E〜S）を混同する。**
   別物。段位には S があり、適正には無い。
4. **`MasmonStore._normalize` に既定値を入れ忘れる。**
   既存ユーザーのマスモンは `rank` を持っていない。画面に `undefined` が出る。
5. **結果画面で報酬を二重に配る。**
   `renderResult` の通常CPU戦の 💎50・ブリーダーEXP50 は、段位戦では通さないこと。
6. **`?v=` の上げ忘れ。** 直したのに直っていないように見える。
7. **依頼者と同じバージョン番号を取る。** push が弾かれたら rebase して +1 にし、
   更新履歴は両方残す。**force push はしない。**
8. **テストで `window.RankBattle` と書く。** クラシックスクリプトなので
   `const RankBattle` は `window` に生えない。裸の `RankBattle` で参照すること。
   （意図的に `window` へ出すならその旨をコードにコメントすること）

---

## 11. 進め方（フェーズ分け推奨）

大きいので、**各フェーズごとにテストを通してからコミット**すること。

- **フェーズ1: 土台**
  データモデル（段位・称号・戦績キー）、`js/rank-battle.js` の定義と進行判定、
  そのユニットテスト。画面はまだ無くてよい。
- **フェーズ2: 戦えるようにする**
  モード選択カード、`#screen-rank`、起動オプション、`statOverrides` での相手生成。
  相手のステータスが定義表どおりになることを実測で確認する。
- **フェーズ3: CPUレベル10**
  `js/cpu-ai.js`。**レベル1〜9が不変であることの確認を必ず先に書く。**
- **フェーズ4: 報酬**
  段位戦の報酬、通常CPU戦のEXP底上げ、マルチの報酬差し替え、結果画面。
- **フェーズ5: 仕上げ**
  段位バッジ・昇格演出・CSS、全回帰テスト、リリース4点セット、push。

---

## 12. 判断が要るところ（迷ったら依頼者に確認する）

以下は本計画で「こうする」と決めたが、好みが分かれる。実装前に一度確認するとよい。

1. **昇格は1勝で確定**（本計画）か、3本勝負・連勝が必要か。
2. **降格なし**（本計画）か、負けたら1つ下がるか。
3. **四大大会・レジェンド杯は1試合**（本計画）か、3連戦のトーナメント形式にするか。
   3連戦は既存の連戦（`spawnSurvivalCpu`）の仕組みを流用できるが、実装量は増える。
4. **通常CPU戦のEXP3倍**（本計画）の倍率。
5. **マルチ1位で修行チケット1枚**（本計画）に上限を設けるか
   （周回で稼がれると修行の価値が下がる。1日◯枚までなどの制限を付けるか）。
6. レジェンド杯の**再挑戦報酬**（本計画: EXP 40,000・💎300）。
   ここが実質的なエンドコンテンツの周回効率になる。

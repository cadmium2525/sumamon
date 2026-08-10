# ガチャシステム 実装指示書

スマモンにガチャを導入する。通貨をダイヤとゴールド（G）の2種類に分け、
Gはアイテム交換所、ダイヤはガチャに使う。大当たりは新規ファイターの
プレイアブル化と「凸」（限界突破）。

**この指示書の一番大事な設計方針**
新ファイターを1体追加したとき、ガチャ側のコードを一切書き足さなくても
①ホームのお知らせ ②ガチャの排出プール ③ピックアップ（PU）の付け替え
④天井報酬の更新 が全部自動で反映されること。
そのために `data/fighters.json` を唯一の正とし、`debutAt` という
フィールド1つで解放制御とPUの両方を決める。
ガチャ側にファイター名（`irumine` など）を直接書く場所を作らないこと。

---

## 0. 作業前提

- `main` へ直接コミット・プッシュする（ブランチもPRも作らない）
- リリース時は `service-worker.js` の `CACHE_NAME`・`version.json`・
  `index.html` のバージョン表記・更新履歴の4点をセットで更新する
- 変更したJS/CSSは `index.html` の `?v=` を1つ上げる。新規JSは `?v=1`
- コメントもコミットメッセージも日本語
- push が弾かれたら **force push はせず** `git fetch` して rebase。
  バージョン番号は相手の番号+1、更新履歴は両方残す
- フェーズごとにコミットしてよい。まとめて1コミットにしない

---

## 1. 用語と数値の一覧

| 項目 | 値 |
|---|---|
| ガチャ1回 | 150ダイヤ |
| 10連 | 1,500ダイヤ（割引なし。10連目が★3以上確定） |
| 天井 | **100連**（15,000ダイヤ）。★5を引いた時点でカウンタリセット |
| ★5 排出率 | 1.0% |
| ★4 排出率 | 12% |
| ★3 排出率 | 32% |
| ★2 排出率 | 55% |
| 凸1段階のボーナス | 全6ステータスに **+30** |
| 凸の上限 | **5**（完凸で +150） |
| ステータス上限 | `GROWTH.STAT_MAX = 999`（**据え置き。上げない**） |

★5が1.0%・天井100連なので、100連以内に自然当選する確率は63.4%、
平均63連（約9,500ダイヤ）で1体。天井は約4割の人が実際に踏む。

---

## 2. Phase 1 — 通貨の分離（ダイヤ → G）

### 2-1. プロフィールに `gold` を追加

`js/growth-system.js` の `UserProfileStore`。

- `:310` の既定値、`:357` のリセット値に `gold: 0` を追加
- `:320` のローカル読み込みマージ、`:337` のリモート（Firebase）マージの
  **両方**に `gold` を通すこと。
  **片方だけだと端末をまたいだ瞬間にGが消える。ここは必ず両方直す。**
- `addGold(amount)` を `addDiamonds`（`:406`）の隣に同じ形で追加

### 2-2. 一度きりのマイグレーション

`_normalize` 相当の初期化処理の中で、既存セーブのダイヤ残高をGへ移す。

```js
// ガチャ導入で通貨を2種類に分けた。導入前のダイヤ残高は
// アイテム交換所で使っていた分なので、そのままGへ移して
// ダイヤは0から始める。フラグを立てて二度と実行しない。
if (!data.currencyMigrated) {
  data.gold = (Number(data.gold) || 0) + (Number(data.diamonds) || 0);
  data.diamonds = 0;
  data.currencyMigrated = true;
}
```

`currencyMigrated` もFirebase同期の対象に含めること。含め忘れると
別端末でもう一度走り、ダイヤをGへ変換したうえで0にしてしまう。

### 2-3. 交換所をG建てにする

- `js/growth-system.js:481` `purchaseItem` … `diamonds` を見ている箇所を
  `gold` に変更
- `js/flow.js:17-23` `SHOP_ITEMS` の `price` は据え置き（200/350/800）。
  表示の `💎` を `G` に変更（`:278`, `:311`, `:314`, `:324` 周辺）
- `js/flow.js:266-267` `#shop-diamonds` … 交換所のヘッダはG残高を表示

### 2-4. 既存のダイヤ報酬を全額Gへ横滑り

金額は変えず、`addDiamonds` → `addGold` に置き換える。

| 場所 | 内容 |
|---|---|
| `js/flow.js:9-13` `HUNDRED_REWARDS` の `diamonds` | キー名を `gold` に変更。100/200/300/400/500 はそのまま |
| `js/flow.js:1664` 100人組手の集計・表示 | 同上 |
| `js/flow.js:1738` 通常CPU戦の50 | `addGold(50)`、表示も「50G」 |
| `js/rank-battle.js:38-50` `RANK_REWARDS` ほか | `diamonds` キーを `gold` へ改名。金額はそのまま |
| `js/flow.js:1778, 1796` 段位戦の付与・表示 | 同上 |

### 2-5. 残高表示

- `js/flow.js:224` ホーム … ダイヤとGを**両方**表示
- `js/flow.js:1120` マイページ … 同上

---

## 3. Phase 2 — 凸（限界突破）システム

### 3-1. データ

`UserProfileStore.data.limitBreaks = { [fighterKey]: 0〜5 }`
**種族単位・アカウント単位**で持つ。同じ種族のマスモンは全員が恩恵を受ける。
`_normalize` で 0〜5 にクランプ。Firebase同期に含める。

```js
GROWTH.LIMIT_BREAK_STEP = 30;
GROWTH.LIMIT_BREAK_MAX = 5;

UserProfileStore.limitBreakOf(fighterKey) {
  const value = Number((this.data.limitBreaks || {})[fighterKey]) || 0;
  return Math.max(0, Math.min(GROWTH.LIMIT_BREAK_MAX, value));
}
```

### 3-2. ステータス計算を1本に統合する ★最重要

`computeStatsAtLevel`（`js/growth-system.js:57`）は
`base + 成長率×(Lv-1) + 修行値` の**加算式**なので、凸は
「base に +30×凸数」を足すだけでよい（レベルに関係なく一律 +30×凸数）。

問題は**呼び出しが5箇所に散っている**こと。
1箇所でも入れ忘れると、画面の表示ステータスと実戦のステータスが
食い違う。以前ライフバーで同じ事故が起きている。

| ファイル:行 | 用途 |
|---|---|
| `js/game.js:813` `resolveStats` | **バトル本番の値** |
| `js/flow.js:873` | マスモン管理のステータス表示 |
| `js/flow.js:928` | ステータス比較モーダル |
| `js/flow.js:1250` | 対戦前のロスター表示 |
| `js/practice.js:354` | 修行のステータス |

5箇所とも `{ ...defaultStats(), trainingStats: X }` という**同じ形**なので、
次のヘルパーを1つ作って**5箇所すべてを置き換える**こと。
新しい呼び出しを増やすときも必ずこれを使う。

```js
// マスモン1体の最終ステータス。凸ボーナスを含む。
// computeStatsAtLevel を直接呼ぶと凸の加算を忘れて
// 「表示と実戦が違う」不具合になるため、必ずこの関数を通す。
GROWTH.statsForMasmon(monster) {
  const bonus = UserProfileStore.limitBreakOf(monster.baseFighterKey) * this.LIMIT_BREAK_STEP;
  const base = { ...defaultStats(), trainingStats: monster.trainingStats };
  if (bonus) for (const key of this.STAT_KEYS) base[key] = (base[key] || 0) + bonus;
  return this.computeStatsAtLevel(base, monster.aptitudes, monster.level);
}
```

### 3-3. 凸を乗せてはいけないところ

- **CPUのステータス**。`js/rank-battle.js` の `RANK_BATTLES` /
  `TOURNAMENTS` / `LEGEND` の固定stats、および `resolveStats` の
  `masmon` が無い分岐（`def.stats` を使う側）には**絶対に乗せない**
- `js/game.js` の `applyCpuLevelStats` も同様

### 3-4. マルチ対戦

`js/multiplayer.js:79-82` は `level` / `trainingStats` / `aptitudes` という
**素の材料**を送り、受け手が再計算している。凸を送らないと相手側で
凸なしの値になる。

- 送信ペイロードに `limitBreak: UserProfileStore.limitBreakOf(monster.baseFighterKey)` を追加
- 受け手側の再構築でその値を base に加算する
- **凸込みの完成値を送ってはいけない**。受け手が再計算するため二重加算になる

### 3-5. 効果の目安（実測値）

| | 凸なし | 完凸(+150) |
|---|---|---|
| Lv1 適性A | 10 | 160 |
| Lv50 適性A | 167 | 317 |
| Lv99 適性A | 324 | 474 |
| ライフ Lv99 | 257 | 407 |

完凸 = 6ステータス×150 = 900ポイント ≒ Sランク修行18回分。
上限999は据え置きなので、凸は**カンストへの到達を早めるだけ**で
上限そのものは上がらない。カンスト後の対戦バランスは変わらない。

---

## 4. Phase 3 — ガチャ本体

新規ファイル `js/gacha.js` を作り、`index.html` に `?v=1` で読み込む。
DOM操作を持たない純粋な抽選層にして、画面とテストの両方から
同じ判定を使えるようにすること（`js/rank-battle.js` と同じ作り）。

### 4-1. プロフィールに持たせるデータ

```
data.ownedFighters = []   // ガチャで解放したファイターのキー（配列）
data.gachaPity    = 0     // 天井カウンタ 0〜99
data.gachaPulls   = 0     // 通算回数（表示用）
data.seenFighters = []    // 新モンスターお知らせの既読キー
data.dailyBonusDate = ''  // 'YYYY-MM-DD'
```

すべて `_normalize` でクランプし、Firebase同期に含める。

### 4-2. 排出テーブル

```js
const GACHA_RATES = { s5: 0.01, s4: 0.12, s3: 0.32, s2: 0.55 };
```

| ランク | 中身（この中から等確率で1つ） |
|---|---|
| ★5 | ファイター抽選（4-3） |
| ★4 | `vital_elixir`×2 ／ `skill_elixir`×2 ／ `might_elixir`×2 ／ `dye_kit`×1 ／ 修行チケット×2 |
| ★3 | `vital_tonic`×2 ／ `skill_tonic`×2 ／ `might_tonic`×2 ／ フリートレーニングチケット×3 ／ G 1,000 |
| ★2 | G 300 ／ `vital_tonic`×1 ／ `skill_tonic`×1 ／ `might_tonic`×1 |

アイテムIDは `js/flow.js:17-23` の `SHOP_ITEMS` と一致させ、
付与は `data.inventory[itemId]` を直接増やす専用メソッドを追加する
（`purchaseItem` はG消費とセットなので流用しない）。

### 4-3. ★5を引いたときのファイター抽選

**「すり抜け（50/50）」は入れない。** 課金ゲームではないので、
★5が無駄になる状況を作らない。次の順に判定する。

1. 未所持のPU対象ファイター → **解放**
2. 未所持のファイター（PU外）が居れば、その中からランダムに → **解放**
3. PU対象が未完凸 → **凸+1**
4. 未完凸のファイターからランダムに → **凸+1**
5. 全員完凸 → **G 5,000**

### 4-4. 天井と10連の確定枠

- **天井**：1回引くごとに `gachaPity++`。★5を引いたら `gachaPity = 0`。
  `gachaPity` が100に達した回は★5を確定させる（＝100連目が保証）
- **10連の10枠目**：10連ボタンで引いたとき、1〜9枠目に★3以上が
  1つも出ていなければ、10枠目を★3以上（★3/★4/★5をその比率で再抽選）にする。
  単発を10回押した場合には効かない。10連という「まとめ引き」の
  おまけなので、通し番号のカウンタでは実装しないこと
- 天井カウンタは10連の中でも1枠ごとに進む

### 4-5. 画面

`#screen-gacha` を追加。ホームから入れるようにする。

- ダイヤ残高、単発（150）／10連（1,500）ボタン
- **天井まであと何連か**を常時表示（例：`天井まで あと 37 連`）
- PU対象のファイターを大きく表示（`stockIcon` または `idleImage`）
- 提供割合の表示。★5の内訳は `FIGHTERS` から自動生成し、PUに印を付ける。
  **ここにファイター名をベタ書きしないこと**
- 結果演出は凝らなくてよいが、★5は明確に分かる見た目にする
- ダイヤ不足時はボタンを無効化し、理由を出す

---

## 5. Phase 4 — ファイターの所持制御（ガチャ限定）

### 5-1. 判定ルール

> `debutAt` を**持たない**ファイター = ガチャ導入前から居る = **初期解放**
> `debutAt` を**持つ**ファイター = **ガチャ限定**

既存3体（`irumine` / `dullahan` / `nendoro`）には `debutAt` が無いので、
移行用の名前リストを書く必要がない。

```js
GACHA.isUnlocked(fighterKey) {
  const def = (window.FIGHTERS || {})[fighterKey];
  if (!def) return false;
  if (!def.debutAt) return true;   // 導入前からいる = 常に所持
  return (UserProfileStore.data.ownedFighters || []).includes(fighterKey);
}
```

### 5-2. 未所持が漏れる箇所（3つある。全部塞ぐ）

| 場所 | 対応 |
|---|---|
| `js/flow.js:492` `Object.values(FIGHTERS)` のテンプレカード | マスモン新規登録の選択肢。未所持は**ロック表示**（暗く＋鍵アイコン、押しても選べない）。非表示にはしない。「引けば使える」と見せた方がよい |
| `js/flow.js:244` `_profileIconChoices` | プロフィールアイコン。未所持は**出さない** |
| `js/growth-system.js:381` `setIcon` | 保存側にも所持チェックを足す。表示だけ塞いでも保存経路が空いたままになる |

### 5-3. 所持判定を通してはいけない箇所

- `js/flow.js:707` / `js/flow.js:1475` の**CPU対戦相手の選出**
- `js/rank-battle.js` の `fighterKey`（段位戦・四大大会・レジェンド杯）
- マルチ対戦で**相手**が未所持ファイターを使っている場合の描画
- 管理者モード（`js/debug-mode.js`）のバトルテスト・モーション確認

CPUには未所持ファイターがそのまま出てよい。むしろ
「あれが欲しい」という動機になるので出した方がいい。

---

## 6. Phase 5 — 新ファイター追加の自動化 ★本題

### 6-1. スタジオが `debutAt` を打刻する

`tools/studio-build.js:69` の `applyFighter` に追記する。

```js
// 新規キーのときだけデビュー日を打刻する。既存キーの更新では
// 書き換えない。書き換えるとピックアップが古いファイターへ
// 戻ってしまう。
if (!fightersJson[spec.key]) fighter.debutAt = new Date().toISOString();
```

`previous` を展開したあとに置くこと（既存の `debutAt` は
`...previous` で自動的に引き継がれる）。
スタジオ側のUI追加は不要。

### 6-2. ピックアップの決定

```js
GACHA.pickupKey() {
  const list = window.FIGHTERS || {};
  // 1) 管理者が手動で指定していて、期限内なら最優先
  const manual = this.manualPickup;   // Phase 6 で設定される
  if (manual && manual.key && list[manual.key]
      && (!manual.until || Date.now() < manual.until)) return manual.key;
  // 2) 指定が無ければ、デビュー日が最も新しいファイター
  let best = null;
  for (const [key, def] of Object.entries(list)) {
    if (!def || !def.debutAt) continue;
    if (!best || def.debutAt > best.debutAt) best = { key, debutAt: def.debutAt };
  }
  return best ? best.key : null;   // null = PUなし
}
```

これで③（PUの付け替え）と④（天井報酬の更新）が自動になる。
**天井の中身を「PU対象を確定入手」と定義している**ので、
PUが自動更新されれば天井報酬も自動更新される。
天井用のテーブルを別に作らないこと。

### 6-3. 排出プール

`GACHA.fighterPool()` は `Object.keys(window.FIGHTERS)` をそのまま返す。
ガチャ側にファイター一覧を持たない。これで②が自動になる。

### 6-4. ホームのお知らせポップアップ

ホーム表示時に `Object.keys(FIGHTERS)` のうち **`debutAt` を持ち**、
かつ `data.seenFighters` に無いキーを探す。あればポップアップを出し、
閉じたら `seenFighters` に追加する。複数溜まっていれば1体ずつ順に出す。

内容は `displayName` / `stockIcon`（無ければ `idleImage`）/ `aptitudes` から
**自動生成**する。文言をファイターごとに書かないこと。
「ガチャへ行く」ボタンを付ける。

**初回の取り扱い（重要）**
`seenFighters` が未定義のセーブでは、**現在 `debutAt` を持つ全キーを
既読として書き込んでから**判定を始める。これをやらないと、
更新した瞬間に過去のファイター分のポップアップが連続で出る。
新規ユーザーにも同じ扱いをする（始める前のデビューは通知しない）。

### 6-5. まとめ

| 依頼 | 実現方法 |
|---|---|
| ① ホームのポップアップ | `FIGHTERS` と `seenFighters` の差分（6-4） |
| ② ガチャへの実装 | 排出プール = `Object.keys(FIGHTERS)`（6-3） |
| ③ 提供割合の付け替え | PU = `debutAt` 最新 or 手動指定（6-2） |
| ④ 天井報酬の更新 | 天井 = 「PU対象を確定入手」と定義（4-3, 6-2） |

`data/fighters.json` に増えるフィールドは **`debutAt` の1つだけ**。

---

## 7. Phase 6 — 管理者画面からのPU管理

PUは全プレイヤー共通の設定なので、ローカルではなくFirestoreに置く。

### 7-1. Firestore

ドキュメント `config/gacha`：

```
{ pickupKey: 'xxx', pickupUntil: <ミリ秒 or null>, updatedAt: <ミリ秒> }
```

`firestore.rules` に追加：

```
// ガチャのピックアップ設定。全ログインユーザーが読めて、
// 書けるのは管理者だけ。
match /config/{docId} {
  allow read: if request.auth != null;
  allow write: if request.auth != null
    && request.auth.token.email == 'cadmium@smamon.local';
  allow delete: if false;
}
```

（既存の `playerActivity` が同じ判定を使っている。`firestore.rules:20-26` 参照）

### 7-2. 読み込み

起動時に `GACHA.loadPickupConfig()` を**非同期・非ブロッキング**で呼び、
成功したら `GACHA.manualPickup` に入れる。
**失敗・オフライン・未ログインでもガチャが動かなくなってはいけない。**
その場合は `debutAt` 最新へ自動フォールバックする（6-2 の 2）。

### 7-3. 管理者画面のUI

`index.html:296-302` の `.debug-tabs` に
`<button data-admin-tab="gacha">ガチャ設定</button>` を追加し、
対応する `.admin-pane` を作る。中身：

- 現在のPU（手動指定か自動かを明記）と、`debutAt` 由来の自動PUの表示
- ファイター選択の `<select>`（`FIGHTERS` から自動生成）
- 期限の `<input type="datetime-local">`（**空欄なら無期限**）
- 「この内容で設定」ボタン → `config/gacha` へ書き込み
- 「手動指定を解除」ボタン → `pickupKey` を空にし、自動（`debutAt` 最新）へ戻す
- 保存後は結果を明示する（`js/debug-mode.js` の他タブと同じ `setStatus` 相当）

タブの表示自体は `AppFlow._isDebugUser()`（`js/flow.js:210`）で
既に管理者だけに絞られているが、書き込みはFirestoreルール側でも
必ず弾かれるようにしておくこと。

---

## 8. Phase 7 — ダイヤ収入の設置

Gへ横滑りさせた分とは**別に**、ダイヤを新規で配る。

| 入手元 | ダイヤ | 実装場所 |
|---|---|---|
| **その日の初勝利（1日1回）** | **300** | 勝利判定の共通処理。`data.dailyBonusDate` と今日の日付文字列を比較 |
| 通常CPU戦 | 勝利 30 ／ 敗北 10 | `js/flow.js:1738` 付近 |
| エンドレス | 撃破数×5（上限300） | エンドレス終了処理 |
| 100人組手 到達 | 200/400/600/800/1,000（計3,000） | `js/flow.js:9-13` に `diamonds` を再追加 |
| 段位戦 昇格 E/D/C/B/A | 400/600/900/1,400/2,000（計5,300） | `js/rank-battle.js` `RANK_REWARDS` に `diamonds` を追加 |
| 四大大会 初制覇 | 1,200（再制覇 250） | `TOURNAMENT_REWARD_FIRST` / `_REPEAT` |
| レジェンド杯 初優勝 | 2,500（再優勝 500） | `LEGEND_REWARD_FIRST` / `_REPEAT` |
| マルチ対戦 | 勝利 100 ／ 敗北 30 | `js/flow.js:1729-1736` 付近 |

**段位戦を一周（S段位＋四大大会4制覇＋レジェンド初優勝）＋組手完走
＝ 15,600ダイヤ ≒ 天井ちょうど1回分。**
日課だけで回す場合はデイリー300＋通常戦で1日500〜600、約1ヶ月で天井1回。

段位・称号はマスモン個体ごとなので、新しいマスモンを育てて一周する
たびに約12,600ダイヤ入る。これがガチャのメイン動線になる。

デイリーは「ログイン」ではなく「その日の初勝利」にすること。
起動放置で貯まると育成する動機が減る。
日付は端末のローカル日付で判定してよい（端末時計を進めれば
多めに貰えるが、対人要素の無い育成ゲームなので許容する）。

段位戦の結果画面（`js/flow.js:1793-1800`）は現在Gとダイヤの
両方を出すことになるので、報酬行の表示も更新すること。

---

## 9. テスト

Playwrightで確認する。`serviceWorkers: 'block'` を付けること。

1. **通貨移行** … `diamonds: 1234` の既存セーブを読み込み、
   `gold === 1234 && diamonds === 0 && currencyMigrated === true` になる。
   もう一度 `_normalize` を通しても値が変わらない（二重実行しない）
2. **凸の一致** … 凸3のマスモンについて、`GROWTH.statsForMasmon` の結果と、
   実際にバトルを開始した `Fighter` のステータスが**完全一致**する。
   5箇所すべての表示経路で同じ値になることを確認する
3. **凸がCPUに乗らない** … 凸5の状態でレジェンド杯を開始し、
   CPU側のステータスが `LEGEND.stats` と一致する
4. **天井** … `gachaPity = 99` から1回引くと必ず★5。引いた直後に `gachaPity === 0`
5. **10連の確定枠** … 乱数を固定して★2しか出ない状態にし、
   10連の10枠目が★3以上になる。単発10回では効かない
6. **★5が無駄にならない** … 未所持あり／未所持なし＆未完凸あり／全員完凸
   の3状態で、それぞれ 解放／凸+1／G5,000 になる
7. **PU自動切替** … `FIGHTERS` に `debutAt` の新しいダミーを差し込むと
   `GACHA.pickupKey()` がそのキーを返し、天井報酬もそのキーになる
8. **PU手動指定** … `GACHA.manualPickup` を設定すると自動より優先され、
   期限切れ後は自動へ戻る。`loadPickupConfig` が失敗してもガチャが動く
9. **ポップアップ** … `seenFighters` 未定義のセーブでは通知が出ない。
   その後 `debutAt` 付きの新キーを足すと1回だけ出て、既読になる
10. **所持制御** … `debutAt` 付きの未所持ファイターが、マスモン登録では
    ロック表示、プロフィールアイコンでは非表示、`setIcon` でも弾かれる。
    一方でCPU対戦相手・段位戦には出る
11. **収支** … 段位戦一周＋組手完走で合計15,600ダイヤになる

`tests/` に既存のテストがある場合は同じ形式に合わせること。

---

## 10. 実装順とコミット単位

1. Phase 1（通貨の分離とG化）
2. Phase 2（凸と `statsForMasmon` への統合）
3. Phase 3 + Phase 4（ガチャ本体と所持制御）
4. Phase 5（`debutAt` と自動化）
5. Phase 6（管理者のPU管理）
6. Phase 7（ダイヤ収入）
7. リリース4点セットの更新

Phase 2 の「5箇所を `statsForMasmon` に統合」は他のフェーズより先に
効いてくるので、ここだけは取りこぼしがないか差分で二重確認すること。
`grep -rn "computeStatsAtLevel" js/` して、
`js/growth-system.js` の定義と `statsForMasmon` の中以外に
呼び出しが残っていなければ完了。

---

## 11. 更新履歴に書くこと

プレイヤー向けに、最低限これを明記する。

- **アイテム交換所の通貨がゴールド（G）に変わったこと。
  これまでのダイヤ残高はそのまま同額のGへ引き継がれ、減っていないこと**
- ダイヤはガチャ専用の新通貨として、各モードの報酬で新たに手に入ること
- ガチャの排出率・天井（100連）・10連の確定枠
- 凸で同じ種族のマスモン全員の初期ステータスが上がること、
  上限999は変わらないこと

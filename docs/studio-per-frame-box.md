# スタジオ：足元の位置と表示サイズをコマ毎に調整できるようにする — 指示書

いまスタジオの「足元の位置を微調整」「表示サイズ」は**モーション単位**でしか
指定できない。これを**コマ単位**でも調整できるようにする。

崖つかまり→よじ登りのように足元が上下するモーションや、
コマによって武器・エフェクトの分だけ枠が縦に伸びるモーションで、
共通の枠に押し込まれて位置や大きさがずれるのを直せるようにするのが目的。

---

## 0. 作業前提

- `main` へ直接コミット・プッシュする（ブランチもPRも作らない）
- リリース4点セット（`service-worker.js` の `CACHE_NAME`・`version.json`・
  `index.html` のバージョン表記・更新履歴）を必ずセットで更新する
- **`js/fighter.js` と `js/debug-mode.js` を変更するので、
  `index.html` のそれぞれの `?v=` を1つ上げる**
- `tools/` 配下は `tools/index.html` が毎回タイムスタンプ付きで読み込むため、
  `?v=` の更新は不要（キャッシュ対策済み）
- コメントもコミットメッセージも日本語
- push が弾かれたら **force push はせず** `git fetch` して rebase

---

## 1. いまの作りの確認

### 描画（`js/fighter.js:1699` `_drawAnimationImage`）

```js
const scale = this.h / (box.bottom - box.top);
const contentCenterX = ((box.left + box.right) / 2) * scale;
ctx.drawImage(img, cx - contentCenterX, this.y - box.top * scale, drawW, drawH);
```

`contentBox` 1つが**表示サイズ（縦の縮尺）と足元の位置の両方**を決めている。

- `bottom - top` … この高さが当たり判定の高さ `this.h` に一致するよう縮尺が決まる
- `bottom` … 足元の線（`this.y + this.h` に一致する）
- `(left + right) / 2` … 体の中心

`contentBox` は**アニメーション単位で1つだけ**（`data/fighters.json` の
`animations.<slot>.contentBox`）。呼び出しは `js/fighter.js:1805` と `:1815`。

### スタジオ側（`tools/studio-app.js:1659` `processFrames`）

```js
const boxes = canvases.map(canvas => StudioImage.contentBox(canvas));
entry.frameBoxes = boxes;                       // ← コマごとの生bbox（既存）
entry.footOffset = Number(this.el('ed-foot').value) || 0;
entry.sizePercent = Number(this.el('ed-scale').value) || 100;
const raw = StudioImage.nudgeBottom(StudioImage.unionContentBox(boxes), entry.footOffset);
const height = (raw.bottom - raw.top) * (100 / entry.sizePercent);
entry.contentBox = { ...raw, top: Math.round(raw.bottom - height) };
```

**全コマの和集合（union）を基準**にして、そこから足元をずらし、上端だけ伸縮させている。

---

## 2. 設計方針（ここを外さないこと）

### 2-1. 和集合を基準にする作りは変えない

コマごとの生bboxをそのまま使うと**再生時にガタつく**（`:1690` のコメントに
既に書いてある理由）。今回入れるのは「自動でコマごとに合わせる」ではなく
**「共通の枠から、そのコマだけ手で意図的にずらす」**機能。

各コマの箱は必ず **union を基準に、そのコマの調整値を適用して**作る。
コマ自身のbboxに合わせ直す実装にはしないこと。

### 2-2. `contentBox` は残す

`contentBox` は描画以外にも使われている。**消したり意味を変えたりしないこと。**

| 用途 | 場所 |
|---|---|
| `spriteContentBox`（待機から作る代表値） | `tools/studio-app.js:2011` |
| 攻撃判定の相対座標の基準 | `tools/studio-app.js:1195` `toRelativeBox` |
| 管理者モードのモーション確認 | `js/debug-mode.js:361,384,391` |
| コマ別の箱が無い時の既定値 | 今回追加する分岐 |

コマ別の箱は**追加のフィールド**として持たせ、`contentBox` はこれまでどおり
union＋モーション全体の調整値から作る。

---

## 3. データの形

`data/fighters.json` のアニメーション定義に、`frames` と**同じ並び・同じ長さ**の
配列を任意項目として追加する。

```json
{
  "frames": ["...frame_001.png", "...frame_002.png", "...frame_003.png"],
  "frameDuration": 8,
  "contentBox": { "left": 1, "top": 6, "right": 210, "bottom": 244 },
  "frameContentBoxes": [
    { "left": 1, "top": 6,  "right": 210, "bottom": 244 },
    { "left": 1, "top": 2,  "right": 210, "bottom": 240 },
    { "left": 1, "top": 6,  "right": 210, "bottom": 244 }
  ]
}
```

- **名前は `frameContentBoxes`。** `tools/studio-app.js` には
  **既に `entry.frameBoxes` という別物**（コマごとの生bbox）があるので、
  `frameBoxes` という名前は使わないこと。取り違えると生bboxを
  書き出してしまい、ガタつきがそのまま本番に出る
- **全コマが `contentBox` と同じ内容なら、このフィールドは書き出さない。**
  既存データを無駄に太らせない
- 既存の `data/fighters.json` は `frameContentBoxes` を持たない。
  **移行処理は不要**（無ければ `contentBox` にフォールバックする）

---

## 4. ゲーム側の修正

### 4-1. コマ別の箱を取り出すヘルパー

`js/fighter.js` の `Fighter` に static を追加する。

```js
  // そのコマの表示枠。コマ別の指定が無ければアニメーション共通の箱を使う。
  static animationBox(config, index) {
    const list = config && config.frameContentBoxes;
    if (Array.isArray(list) && list[index]) return list[index];
    return (config && config.contentBox) || null;
  }
```

### 4-2. 描画でコマ別の箱を使う

`_drawAnimationImage`（`:1699`）は、いま**1つの箱で2枚（現在のコマと次のコマ）を
重ねて描いている**（クロスフェード）。コマ別にすると2枚で箱が違うので、
**次のコマ用の箱も受け取る**ように引数を増やす。

```js
  _drawAnimationImage(ctx, image, box, nextImage, blend, nextBox) {
    const cx = this.x + this.w / 2;
    const drawOne = (src, useBox) => {
      if (!src || !src.complete || src.naturalWidth === 0) return;
      if (!useBox) return;
      const scale = this.h / (useBox.bottom - useBox.top);
      const img = this._skinned(src);
      const contentCenterX = ((useBox.left + useBox.right) / 2) * scale;
      ctx.drawImage(img, cx - contentCenterX, this.y - useBox.top * scale,
        img.width * scale, img.height * scale);
    };
    ...
      drawOne(image, box);
      ctx.globalAlpha = baseAlpha * blend;
      drawOne(nextImage, nextBox || box);
    ...
  }
```

`scale` を `drawOne` の中へ移すのを忘れないこと（今は関数の外で1回だけ
計算しているため、2枚が同じ縮尺になってしまう）。

呼び出し側（`:1805` と `:1815`）は、現在のコマの添字と次のコマの添字から
それぞれ箱を引いて渡す。次のコマの添字は既にその場で計算されているので、
同じ式を使うこと（`jump` は繰り返さないので `min(index+1, 最後)`、
それ以外は `(index+1) % 長さ`）。

### 4-3. 管理者モードのモーション確認も合わせる

`js/debug-mode.js:355` `_motionsFor` は `box:` を1つだけ渡している。
**ここを直さないと、スタジオとバトルでは正しいのに管理者モードの確認画面だけ
位置がずれる**という、過去に何度も起きている種類の食い違いになる。

`box` に加えて `frameBoxes:`（＝ `animation.frameContentBoxes`）も渡し、
描画時に `frameBoxes[index] || box` を使うようにする。
`type: 'sheet'`（歩行スプライトシート）はコマ別の箱を持たないので対象外。

---

## 5. スタジオ側の修正

### 5-1. データの持ち方

`entry`（`this.motions[slot]`）に追加する。

```
entry.frameAdjust = []            // コマ別の調整。{ foot, size } または未定義
entry.frameContentBoxes = []      // 算出結果。frames と同じ並び
```

**既存の `entry.frameBoxes`（コマごとの生bbox）は別物。上書きしないこと。**

### 5-2. 箱の算出（`processFrames`）

いまの1つ分の計算を、コマ数ぶん回す形にする。**基準は必ず union**。

```js
      const union = StudioImage.unionContentBox(boxes);
      entry.footOffset = Number(this.el('ed-foot').value) || 0;
      entry.sizePercent = Number(this.el('ed-scale').value) || 100;
      // モーション全体の箱（従来どおり。spriteContentBoxや技の判定の基準にも使う）
      const raw = StudioImage.nudgeBottom(union, entry.footOffset);
      entry.rawContentBox = raw;
      entry.contentBox = raw
        ? { ...raw, top: Math.round(raw.bottom - (raw.bottom - raw.top) * (100 / entry.sizePercent)) }
        : null;
      // コマ別の箱。調整が無いコマはモーション全体と同じ値になる。
      // コマ自身のbboxではなく union を基準にするのは、コマごとに合わせると
      // 再生時にガタつくため。ここでずらすのは「手で意図的に動かした分」だけ。
      entry.frameContentBoxes = union ? boxes.map((_, i) => {
        const adj = (entry.frameAdjust && entry.frameAdjust[i]) || null;
        const foot = adj ? adj.foot : entry.footOffset;
        const size = adj ? adj.size : entry.sizePercent;
        const base = StudioImage.nudgeBottom(union, foot);
        return { ...base, top: Math.round(base.bottom - (base.bottom - base.top) * (100 / size)) };
      }) : [];
```

### 5-3. UI

`tools/index.html:415-427` にある既存のつまみ（`ed-duration` / `ed-foot` /
`ed-scale`）は**モーション全体の既定値**として残す。ラベルに
「（コマ別に上書きしていないコマに効きます）」と補足を足す。

そのうえで**コマ別の調整**を追加する。

**選び方**：コマ一覧のタイル（`renderFrames`、`tools/studio-app.js:1721`）には
既に「このコマの背景を手で調整」の `✎` ボタン（`data-edit`）がある。
これと同じ形で **`⇕` ボタン（`data-adjust`）**を足す。
タイル本体のタップは「使うコマ／判定コマの切り替え」という既存の意味があるので、
**そちらは変えないこと。**

`⇕` を押したら：

1. 再生を止める（`playIndex` をそのコマに合わせてプレビューに出す）
2. コマ別の調整パネルを開く。中身は
   - 「◯コマ目だけを調整」の見出し
   - 足元の位置（`-60`〜`60`）
   - 表示サイズ（`55`〜`185`）
   - 「このコマの調整を消す」ボタン
3. つまみの初期値は、そのコマに調整があればその値、無ければ
   モーション全体の値（`ed-foot` / `ed-scale`）
4. つまみを動かしたら `entry.frameAdjust[index] = { foot, size }` を更新して
   `processFrames()` → プレビュー更新
5. 「調整を消す」で `entry.frameAdjust[index] = undefined`

**調整済みの目印**：タイルには既に「筆」「個」のバッジ（`i.tuned`）がある。
コマ別調整があるコマには同じ場所に **「位」** を足す。

### 5-4. プレビュー（`drawPreview`、`tools/studio-app.js:1815`）

- 現在のコマは `entry.frameContentBoxes[実際の添字] || entry.contentBox` で描く
- **`this._previewMap` も同じ箱で作ること。** ここがずれると、
  スポイト（プレビューをタップして元画像の色を拾う機能）が別の位置を拾う
- 足元の軌跡表示（`travel && travel.up >= 3` の分岐）は、比較の基準に
  `entry.contentBox` を使ったままでよい（生bboxとの差を見せるための表示なので）
- 待機モーションの薄い影（`drawWith(idle.canvases[0], idle.contentBox, 0.25)`）は
  そのまま

### 5-5. 書き出し（`tools/studio-app.js:1990` 付近）

`frames` は**使うコマだけ**（`usable`）で作られている。
`frameContentBoxes` も**同じ絞り込み・同じ並び**で作ること。
ここを間違えるとコマと箱の対応が1つずつずれる。

```js
      const animation = { frames, frameDuration: entry.frameDuration, contentBox: entry.contentBox };
      if (entry.loop === false) animation.loop = false;
      // コマ別の箱は、全コマが共通の箱と同じなら書き出さない（無駄に太らせない）
      const usedBoxes = entry.canvases
        .map((_, i) => i).filter(i => entry.used[i])
        .map(i => (entry.frameContentBoxes && entry.frameContentBoxes[i]) || entry.contentBox);
      const sameBox = (a, b) => a && b && a.left === b.left && a.top === b.top
        && a.right === b.right && a.bottom === b.bottom;
      if (usedBoxes.length === frames.length
          && usedBoxes.some(box => !sameBox(box, entry.contentBox))) {
        animation.frameContentBoxes = usedBoxes;
      }
```

`spriteContentBox`（`:2011`）は**これまでどおり `entry.contentBox`** を入れる。
コマ別の箱を入れないこと。

### 5-6. 登録済みモーションの読み込み（`_restoreBoxSliders`、`:1496`）

既存モーションを読み込み直した時、いまはモーション全体のつまみだけを逆算している。
**コマ別の箱も復元すること。** しないと、読み込んで保存し直すだけで
コマ別の調整が消える。

逆算はモーション全体と同じ式を、保存されている各コマの箱に対して行う。

```js
    const invert = savedBox => {
      const foot = clamp(Math.round(savedBox.bottom - union.bottom), -60, 60);
      const rawBottom = union.bottom + foot;
      const savedHeight = savedBox.bottom - savedBox.top;
      const size = savedHeight > 0
        ? clamp(Math.round(100 * (rawBottom - union.top) / savedHeight), 55, 185)
        : 100;
      return { foot, size };
    };
```

保存側の `frameContentBoxes` は**使うコマだけ**の並びなので、
読み込み時は「読み込んだコマ＝全部使う」前提で `entry.frameAdjust` の
添字に対応づける。モーション全体の値と一致するコマは
`frameAdjust[i] = undefined` にしておく（「調整あり」の目印が
全コマに付いてしまうのを避けるため）。

---

## 6. 確認すること

### 6-1. 既存データが1pxも変わらないこと（最優先）

`frameContentBoxes` を持たない既存のモンスター（irumine / dullahan / nendoro）が、
**修正前とまったく同じ見た目で描画されること。**

Playwright（`serviceWorkers: 'block'`）で、修正前後それぞれ同じ場面の
キャンバスを `toDataURL` で取って**バイト単位で一致**することを確認する。
修正前は `git worktree add` で別ディレクトリに出し、別ポートで配信して比較する。

- 待機・ジャンプ・空中待機・崖つかまり・しゃがみの各モーション
- 技のモーション（`FIGHTER_MOVESETS` の ground / special）
- クロスフェード中のコマ（`_drawAnimationImage` の2枚重ね）も含めること。
  ここは `scale` を関数の外から中へ移すので、**壊すならここ**

### 6-2. コマ別の指定が効くこと

`data/fighters.json` のどれか1体に手で `frameContentBoxes` を入れて、
コマごとに足元の高さ・大きさが変わって描画されることを確認する。
確認できたら**その手入れは戻すこと**（コミットに含めない）。

### 6-3. スタジオの往復

1. モーションを1つ登録し、2コマ目だけ足元と表示サイズを変える
2. 書き出される JSON に `frameContentBoxes` が入り、
   **2コマ目だけ**が他と違う値になっていること
3. 全コマ無調整のモーションでは `frameContentBoxes` が**書き出されないこと**
4. 登録済みモーションを読み込み直すと、コマ別の調整が
   つまみとタイルの「位」バッジに復元されること
5. 使わないコマ（タイルをタップして外したコマ）がある状態で、
   コマと箱の対応がずれないこと
6. プレビューのスポイトが、コマ別調整をしたコマでも正しい位置の色を拾うこと

### 6-4. 管理者モードのモーション確認

`frameContentBoxes` を持つモーションで、
**管理者モードの表示とバトル中の表示が一致すること**（5-3を入れ忘れると
ここだけずれる）。

---

## 7. 更新履歴に書くこと

- スタジオで、**足元の位置と表示サイズをコマごとに調整できるようになった**こと
- コマ一覧の `⇕` ボタンから、そのコマだけを調整できること
- 調整していないコマは、これまでどおりモーション全体の設定で表示されること
- **既存のモンスターの見た目は変わらない**こと

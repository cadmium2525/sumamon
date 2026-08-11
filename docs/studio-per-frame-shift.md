# スタジオ：コマ別の調整に「横位置」を追加する — 指示書

`b659f37`「スタジオでコマ別の位置とサイズ調整に対応」で、コマ別の
**足元（縦）**と**表示サイズ**を調整できるようになった。
ここに**横位置**を追加する。

コマによって体の中心が左右にずれていると、共通の枠（union）に揃えて描くため
再生時に横へガタつく。これを手で揃えられるようにするのが目的。

---

## 0. 作業前提

- `main` へ直接コミット・プッシュする（ブランチもPRも作らない）
- リリース4点セット（`service-worker.js` の `CACHE_NAME`・`version.json`・
  `index.html` のバージョン表記・更新履歴）を必ずセットで更新する
- **`tools/` だけの変更なら `index.html` の `?v=` は不要**
  （`tools/index.html` が毎回タイムスタンプ付きで読み込むため）。
  ただしリリース4点セットは更新する
- コメントもコミットメッセージも日本語
- push が弾かれたら **force push はせず** `git fetch` して rebase

---

## 1. 良い知らせ：ゲーム側は変更不要

描画は `js/fighter.js:1733` `_drawAnimationImage` で

```js
const contentCenterX = ((useBox.left + useBox.right) / 2) * scale;
ctx.drawImage(img, cx - contentCenterX, this.y - useBox.top * scale, drawW, drawH);
```

となっていて、**横位置は箱の `left` / `right` の中心だけで決まっている**。
コマ別の箱（`frameContentBoxes`）は既に1コマずつ渡る作りになっているので、
**スタジオが書き出す箱の `left` / `right` をずらすだけで横位置が動く。**

`js/fighter.js` / `js/debug-mode.js` / データ形式（`frameContentBoxes`）は
**一切変更しないこと。**

---

## 2. 直すところ（すべて `tools/` 配下）

### 2-1. UI（`tools/index.html:434-440`）

`#ed-frame-adjust` の中、表示サイズの下に横位置のつまみを足す。

```html
      <label>このコマの横位置 <span id="ed-frame-shift-value">0</span>px（＋でキャラの向いている方へ）</label>
      <input id="ed-frame-shift" type="range" min="-120" max="120" value="0">
```

あわせて、同じパネルに**全コマへ配る**ボタンを足す
（1コマずつ同じ値を入れ直すのは手間なため）。

```html
      <button type="button" id="ed-frame-apply-all">この調整を全コマに適用</button>
```

既存の `ed-frame-reset`（このコマの調整を消す）はそのまま残す。

### 2-2. 調整値に `shift` を足す

`entry.frameAdjust[index]` は今 `{ foot, size }`。ここに `shift` を追加する。

| 関数 | 行 | やること |
|---|---|---|
| つまみのイベント登録 | `tools/studio-app.js:1049` 付近 | `ed-frame-shift` の `input` を `ed-frame-foot` と同じ形で登録し、`updateFrameAdjust()` を呼ぶ |
| `openFrameAdjust` | `:1767` | `shift` をつまみへ反映（調整が無ければ **0**） |
| `updateFrameAdjust` | `:1794` | `shift: Number(this.el('ed-frame-shift').value) \|\| 0` を保存 |
| `clearFrameAdjust` | `:1807` | `shift` のつまみを **0** に戻す |

**`shift` の既定値は 0。** `foot` / `size` はモーション全体のつまみ
（`entry.footOffset` / `entry.sizePercent`）が既定値だが、**横位置には
モーション全体のつまみを作らない**（理由は §3）。

### 2-3. 箱の算出（`tools/studio-app.js:1745`）

いまの per-frame の計算に、`left` / `right` のずらしを足す。

```js
      entry.frameContentBoxes = union ? boxes.map((_, index) => {
        const adjustment = entry.frameAdjust[index] || null;
        const foot = adjustment ? adjustment.foot : entry.footOffset;
        const size = adjustment ? adjustment.size : entry.sizePercent;
        const shift = adjustment ? (adjustment.shift || 0) : 0;
        const base = StudioImage.nudgeBottom(union, foot);
        const box = { ...base, top: Math.round(base.bottom - (base.bottom - base.top) * (100 / size)) };
        // 横位置は箱の中心だけで決まる（fighter.js が (left+right)/2 を使う）。
        // 画面上で右へ動かすには中心を左へずらす必要があるため、符号は逆にする。
        // ＋の入力で「キャラの向いている方へ」動くので、つまみの向きと一致する。
        if (shift) { box.left -= shift; box.right -= shift; }
        return box;
      }) : [];
```

**符号に注意。** 描画位置は `cx - (left+right)/2 * scale` なので、
`left`/`right` を**減らす**と画面上では**右へ**動く。
つまみを＋にしたら右（プレビューの向き）へ動くようにすること。

### 2-4. 「全コマに適用」

いま開いているコマの `{ foot, size, shift }` を、**全コマ**の
`entry.frameAdjust` に入れて `processFrames()` する。
そのあと `focusFrameAdjust(index)` で表示を戻す。

### 2-5. 読み込み直しで消えないようにする（`_restoreBoxSliders`、`:1516`）

`invert` に `shift` の逆算を足す。
`nudgeBottom` は `bottom` しか変えず、サイズ調整は `top` しか変えないので、
`left` / `right` は union そのまま＋ずらし分になっている。よって

```js
      const shift = clamp(Math.round(
        ((union.left + union.right) / 2) - ((box.left + box.right) / 2)), -120, 120);
```

で正確に戻せる。

**モーション全体のつまみ（`ed-foot` / `ed-scale`）を復元する時に使う
`invert(savedBox)` の戻り値からは `shift` を使わないこと**
（`contentBox` は横にずらさないので常に0になるはずだが、
つまみが存在しないので入れる先が無い）。

コマ別の復元では、`foot` と `size` がモーション全体と同じでも
**`shift` が0でなければ「調整あり」として残す**こと。
いまの実装は `foot !== foot || size !== size` の比較だけで
`frameAdjust[index]` を立てているので、ここに `shift !== 0` を足す。

### 2-6. 目印

コマ別調整があるタイルには既に「位」バッジが出ている。
`shift` だけの調整でもこのバッジが出るように、
判定を `frameAdjust[index]` の有無で見ていることを確認する
（`foot`/`size` の値だけを見て判定している場合は直す）。

---

## 3. 「モーション全体の横位置」を作らない理由

`entry.contentBox`（モーション全体の箱）は描画以外にも使われている。

- `spriteContentBox`（`tools/studio-app.js:2011` 付近）
- **攻撃判定の相対座標の基準**：`StudioImage.toRelativeBox` は
  `contentBox` の**横中心**（`(left+right)/2`）を原点にしている
  （`tools/studio-image.js:599`）

一方ゲーム側は、攻撃判定を**当たり判定の中心**（`js/fighter.js:1154`
`originX = this.x + this.w / 2`）に置いている。
`contentBox` を横にずらすと、この2つの原点の対応が崩れて
**登録済みの技の判定位置が全部ずれる。**

コマ別の箱は描画にしか使われないので、そこだけをずらすのが安全。

### 使う人への注意（UIに1行入れること）

横位置をずらすと**絵だけが動き、攻撃判定は動かない**。
技のモーションで大きくずらすと、見た目と当たり判定がずれる。
「絵の位置を揃えるための微調整」として使う、という趣旨の注意書きを
`#ed-frame-adjust` のパネルに入れておくこと。
（これは既存の足元・表示サイズの調整にも同じく当てはまる）

---

## 4. 向きの反転について

`_drawAnimationImage` は `facing === -1` の時にキャンバスごと左右反転する。
そのため横位置のずらしも一緒に反転し、**キャラが左を向いた時は
ずらしも左右反転する**。

これは**正しい挙動なので直さないこと。**
「武器を前へ出す」調整が、左を向いた時も前へ出てほしいため。
プレビューは常に右向きで描いているので、つまみの＋＝プレビュー上の右＝
キャラの前方、で一致する。

---

## 5. 確認すること

1. **既存データが1pxも変わらないこと。**
   `frameContentBoxes` を持たないモンスターも、持っているモンスターも、
   横位置を触っていない限り修正前とまったく同じ描画になること。
   Playwright（`serviceWorkers: 'block'`）でキャンバスを `toDataURL` し、
   修正前（`git worktree add` で別ディレクトリ＋別ポート）と
   **バイト単位で一致**することを確認する
2. モーションを登録し、2コマ目だけ横位置を＋30にすると、
   **プレビューで2コマ目だけ右へ**動くこと。ゲーム内でも同じ位置になること
3. キャラが**左を向いた時**、そのコマが左へずれること（＝前方向へずれること）
4. 全コマ横位置0のモーションでは、`frameContentBoxes` が
   **これまでと同じ内容**であること（余計な差分が出ないこと）
5. 登録済みモーションを読み込み直すと、横位置のつまみと「位」バッジが
   復元されること。読み込んで保存し直すだけで調整が消えないこと
6. 「この調整を全コマに適用」で全コマに同じ値が入ること
7. 使わないコマ（タイルをタップして外したコマ）がある状態で、
   コマと箱の対応がずれないこと
8. **登録済みの技の攻撃判定の位置が変わっていないこと**
   （`contentBox` を触らない、という方針が守れているかの確認）

---

## 6. 更新履歴に書くこと

- スタジオのコマ別調整に**横位置**を追加したこと
- ＋でキャラの向いている方へ動くこと
- 「この調整を全コマに適用」で、同じ値をまとめて配れること
- 既存のモンスターの見た目は変わらないこと

# スマモン マルチプレイ設定

## 1. Realtime Databaseを作成する

1. [Firebaseコンソール](https://console.firebase.google.com/)で `sumamon-3845b` を開く。
2. 左メニューの「構築」→「Realtime Database」を開く。
3. 「データベースを作成」を押す。
4. ロケーションは `asia-southeast1`（シンガポール）を選ぶ。
5. 「ロックモード」で作成する。

このコードは次のURLを使用する。

```text
https://sumamon-3845b-default-rtdb.asia-southeast1.firebasedatabase.app
```

別のロケーションやデータベース名で作成した場合は、`js/firebase-init.js` の `databaseURL` をコンソールに表示されたURLへ変更する。

## 2. セキュリティルールを設定する

Realtime Databaseの「ルール」タブに次を貼り付け、「公開」を押す。

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "rooms": {
      ".read": "auth != null",
      ".indexOn": ["status"],
      "$roomId": {
        ".write": "auth != null && ((!data.exists() && newData.child('hostUid').val() == auth.uid) || (data.exists() && data.child('hostUid').val() == auth.uid))",
        ".validate": "!newData.exists() || (newData.hasChildren(['roomId', 'hostUid', 'hostPeerId', 'maxPlayers', 'stageKey', 'status', 'members']) && newData.child('roomId').val() == $roomId && newData.child('hostUid').isString() && newData.child('hostPeerId').isString() && newData.child('maxPlayers').isNumber() && newData.child('maxPlayers').val() >= 2 && newData.child('maxPlayers').val() <= 4 && newData.child('stageKey').isString() && (newData.child('status').val() == 'waiting' || newData.child('status').val() == 'playing'))"
      }
    }
  }
}
```

部屋はログイン済みユーザーだけが閲覧でき、作成・更新・削除はホスト本人だけが行える。ゲストはPeerJS経由で参加を申し込み、ホストが参加者情報をRTDBへ書き込む。

## 3. PeerJSについて

PeerJSはWebRTCの接続処理を扱いやすくするライブラリ。スマモンでは無料のPeerServer Cloudをシグナリングに使用する。

- ホストとゲストは起動時に一意のPeer IDを受け取る。
- ホストのPeer IDをRTDBの部屋情報へ保存する。
- ゲストは部屋一覧からPeer IDを取得し、ホストへ `peer.connect()` する。
- ゲストは自分の入力だけをホストへ送る。
- ホストが全キャラクターの物理演算・攻撃・撃墜判定を行う。
- ホストは約20回/秒でゲーム状態をゲストへ配信する。

映像・音声は送らず、JSON形式の入力とゲーム状態だけを送る。通信内容はWebRTCのDTLSで暗号化される。

## 4. 動作確認

1. RTDBを作成し、上記ルールを公開する。
2. PCとiPhoneなど、別々の端末でHTTPS公開URLを開く。
3. 別アカウントでログインする。
4. ホスト側で「マルチ」→「部屋を作る」を選択する。
5. ゲスト側で「マルチ」→「部屋を探す」→表示された部屋を選択する。
6. ホストのロビーにゲストが表示されたら「対戦開始」を押す。

同じPCでも通常ウィンドウとシークレットウィンドウで別アカウントを使えば確認できる。WebRTCの確認にはHTTPS配信が推奨される。

## 現在の同期方式

初期版はホスト権威型。ゲスト側では受信した状態を描画するため、不正な位置・ダメージをゲストから直接送ることはできない。ホスト切断時はRTDBの `onDisconnect()` が部屋を削除する。今後、補間描画、再接続、ホスト移譲、TURNサーバー追加を行う余地がある。

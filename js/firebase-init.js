// ==== Firebase 初期化 ＆ 認証ラッパー ====
// ビルドツールを使わないプロジェクトのため、CDN上のFirebase Modular SDK(v10)をESモジュールとして読み込む。
// ユーザー名+パスワードでの登録/ログインを、Firebase Authの「メール/パスワード」プロバイダで実現する
// （ユーザー名を "ユーザー名@smamon.local" という内部専用のダミーメールアドレスに変換して利用）。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDzjPtXF6Rx_CtGT20gFuYbV0WAt0lHGsc",
  authDomain: "sumamon-3845b.firebaseapp.com",
  projectId: "sumamon-3845b",
  storageBucket: "sumamon-3845b.firebasestorage.app",
  messagingSenderId: "481369364054",
  appId: "1:481369364054:web:f2b1a9f424d8661d104df7",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const USERNAME_DOMAIN = "@smamon.local";
const toPseudoEmail = (username) => `${username.trim().toLowerCase()}${USERNAME_DOMAIN}`;

// ユーザー名のバリデーション（ダミーメールに使うため記号を制限）
function validateUsername(username) {
  if (!username || username.trim().length < 2) return 'ユーザー名は2文字以上で入力してください';
  if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) return 'ユーザー名は半角英数字と_のみ使用できます';
  return null;
}
function validatePassword(password) {
  if (!password || password.length < 6) return 'パスワードは6文字以上で入力してください';
  return null;
}

// Firebase Authのエラーコードを日本語の一言メッセージへ変換
function translateAuthError(err) {
  const code = err && err.code;
  const map = {
    'auth/email-already-in-use': 'そのユーザー名は既に使われています',
    'auth/invalid-email': 'ユーザー名の形式が正しくありません',
    'auth/weak-password': 'パスワードは6文字以上で入力してください',
    'auth/user-not-found': 'ユーザー名またはパスワードが違います',
    'auth/wrong-password': 'ユーザー名またはパスワードが違います',
    'auth/invalid-credential': 'ユーザー名またはパスワードが違います',
    'auth/too-many-requests': '試行回数が多すぎます。しばらくしてから再試行してください',
  };
  return map[code] || ('エラーが発生しました: ' + (code || err.message));
}

window.FirebaseAuth = {
  db,

  // ユーザー名+パスワードで新規登録
  async signUp(username, password) {
    const uErr = validateUsername(username);
    if (uErr) throw new Error(uErr);
    const pErr = validatePassword(password);
    if (pErr) throw new Error(pErr);
    try {
      const cred = await createUserWithEmailAndPassword(auth, toPseudoEmail(username), password);
      await updateProfile(cred.user, { displayName: username.trim() });
      return cred.user;
    } catch (e) {
      throw new Error(translateAuthError(e));
    }
  },

  // ユーザー名+パスワードでログイン
  async logIn(username, password) {
    const uErr = validateUsername(username);
    if (uErr) throw new Error(uErr);
    try {
      const cred = await signInWithEmailAndPassword(auth, toPseudoEmail(username), password);
      return cred.user;
    } catch (e) {
      throw new Error(translateAuthError(e));
    }
  },

  async logOut() {
    await signOut(auth);
  },

  // 現在ログイン中のユーザー（{ uid, username }）。未ログインならnull
  getCurrentUser() {
    const u = auth.currentUser;
    if (!u) return null;
    return { uid: u.uid, username: u.displayName || u.email.replace(USERNAME_DOMAIN, '') };
  },

  // ログイン状態の変化を購読する
  onChange(callback) {
    return onAuthStateChanged(auth, (u) => {
      callback(u ? { uid: u.uid, username: u.displayName || u.email.replace(USERNAME_DOMAIN, '') } : null);
    });
  },
};

// マスモンデータ保存用（users/{uid}/monsters/{monsterId}）。growth-system.jsのMasmonStoreから使用する。
window.FirebaseDB = { db, collection, doc, getDoc, getDocs, setDoc };

// 他のスクリプト（flow.js等、非moduleの通常scriptとして先に読み込まれる）に準備完了を知らせる
window.dispatchEvent(new CustomEvent('firebase-auth-ready'));

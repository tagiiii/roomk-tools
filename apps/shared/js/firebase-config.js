// =============================================
// Firebase 初期化設定
// 全アプリ共通 - ここから db をインポートして使用する
// =============================================
// 使用例:
//   import { db } from "../../shared/js/firebase-config.js";
//   import { collection, addDoc } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
// =============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, signInAnonymously,
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { showToast } from "./utils.js";

// TODO: Firebase コンソールの「プロジェクトの設定」から取得してここに貼り付ける
// 参照: docs/firebase-setup.md
const firebaseConfig = {
  apiKey: "AIzaSyC0bqQdDJeTAWrqFYqjOT1NsVFiunPemIw",
  authDomain: "roomk-tools.firebaseapp.com",
  projectId: "roomk-tools",
  storageBucket: "roomk-tools.firebasestorage.app",
  messagingSenderId: "592193782148",
  appId: "1:592193782148:web:1529f47cebab7dcd109dd1",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
// getAuth() と同じ保存先で作るが、ポップアップ・リダイレクト用の部品は付けない（このサイトは匿名ログインだけ）。
// getAuth() のままだと、Safari・iPad ではログインの前に Google の部品（apis.google.com）を読み、
// 終わるまで待たされる（通信が遅い所やフィルターのある所で止まって見えた。2026-11-19。rtdb-utils.js と同じ理由）
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
});

// 匿名認証でサインイン（セッション管理用）
export const authReady = signInAnonymously(auth).catch((error) => {
  console.error("匿名認証に失敗しました:", error);
  return null;
});

// ログインが 10 秒たっても終わらないときに、読み込み直すように知らせる（rtdb-utils.js の noticeSlowAuth と同じ。2026-11-19）。
// Safari の IndexedDB（ログイン状態の保存先）が返事をしなくなる不具合では、ログインがいつまでも終わらない。読み込み直すと直ることが多い
let authSettled = false;
authReady.then(() => { authSettled = true; });
setTimeout(() => {
  if (!authSettled) showToast("つながるまで時間がかかっています。ページを読み直してみてね", "error", 15000);
}, 10000);

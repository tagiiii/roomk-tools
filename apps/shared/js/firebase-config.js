// =============================================
// Firebase 初期化設定
// 全アプリ共通 - ここから db をインポートして使用する
// =============================================
// 使用例:
//   import { db } from "../../shared/js/firebase-config.js";
//   import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
// =============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

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
export const auth = getAuth(app);

// 匿名認証でサインイン（セッション管理用）
export const authReady = signInAnonymously(auth).catch((error) => {
  console.error("匿名認証に失敗しました:", error);
  return null;
});

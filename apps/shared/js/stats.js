// =============================================
// 利用回数カウンタ（匿名・回数のみ）
// 読み込むだけでアプリの起動回数を1加算する。
// コンテンツ単位の計測は RoomkStats.count('項目名') を呼ぶ。
//
// 記録先: Realtime Database `stats/{アプリ名}/{YYYY-MM}/{項目}`
// 記録するのは回数のみ。UID・ニックネーム・入力内容は一切記録しない。
// 子ども向け画面に計測値を表示してはいけない（正本: AGENTS.md「stats.js」）。
//
// 後方互換で追加のみ。破壊的変更をする場合は ?v= を上げること
// =============================================
(function () {
  'use strict';

  const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyC0bqQdDJeTAWrqFYqjOT1NsVFiunPemIw',
    authDomain: 'roomk-tools.firebaseapp.com',
    databaseURL: 'https://roomk-tools-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'roomk-tools',
    storageBucket: 'roomk-tools.firebasestorage.app',
    messagingSenderId: '592193782148',
    appId: '1:592193782148:web:1529f47cebab7dcd109dd1',
  };
  const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

  // RTDB のキーに使えない文字（. # $ / [ ] と空白）をハイフンに置き換える
  function sanitizeKey(value) {
    const key = String(value).replace(/[.#$/\[\]\s]+/g, '-').slice(0, 60);
    return key || 'unknown';
  }

  // URL パスからアプリ名を判定する（本番: /roomk-tools/{app}/ ローカル: /apps/{app}/）
  function detectAppName() {
    const segments = window.location.pathname.split('/').filter(Boolean);
    if (segments[segments.length - 1] === 'index.html') segments.pop();
    const last = segments[segments.length - 1];
    if (!last || last === 'apps' || last === 'roomk-tools') return 'portal';
    return sanitizeKey(last);
  }

  function monthKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // 開発中のリロードで本番の数値を汚さないよう、localhost では送信しない
  function isDisabled() {
    if (!LOCAL_HOSTS.includes(window.location.hostname)) return false;
    try {
      return localStorage.getItem('roomk-stats-force') !== '1';
    } catch (_) {
      return true;
    }
  }

  let dbPromise = null;
  function ensureDb() {
    if (!dbPromise) {
      dbPromise = Promise.all([
        import(SDK_BASE + 'firebase-app.js'),
        import(SDK_BASE + 'firebase-auth.js'),
        import(SDK_BASE + 'firebase-database.js'),
      ]).then(async ([appMod, authMod, dbMod]) => {
        // アプリ本体の Firebase 初期化（DEFAULT）と衝突しないよう名前付きで初期化する
        let app;
        try {
          app = appMod.getApp('roomk-stats');
        } catch (_) {
          app = appMod.initializeApp(FIREBASE_CONFIG, 'roomk-stats');
        }
        await authMod.signInAnonymously(authMod.getAuth(app));
        return { dbMod, db: dbMod.getDatabase(app) };
      });
    }
    return dbPromise;
  }

  const appName = detectAppName();

  function count(item) {
    try {
      if (isDisabled()) return;
      const path = 'stats/' + appName + '/' + monthKey() + '/' + sanitizeKey(item);
      ensureDb()
        .then(({ dbMod, db }) => dbMod.set(dbMod.ref(db, path), dbMod.increment(1)))
        .catch(() => {}); // 計測の失敗はアプリの動作に影響させない
    } catch (_) {}
  }

  window.RoomkStats = { count, app: appName };
  count('open');
})();

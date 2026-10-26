/* ねむらせ基地 — 接続先の Firebase プロジェクト。
   ねむらせ基地は位置を絶えず送り合うので、room-K 本体のプロジェクト（roomk-tools）と分けて、
   無料枠を超えても止まるのがねむらせ基地だけで済むようにしている（2026-10-26 オーナー決定）。
   ウェブの設定値は公開される前提の値。テストではこのファイルだけをエミュレーター向けに差し替える。 */
(function () {
  const CONFIG = {
    apiKey: 'AIzaSyDazOxKmURKZeeuTtMShEPebib1O1wK20g',
    authDomain: 'roomk-nemurase.firebaseapp.com',
    databaseURL: 'https://roomk-nemurase-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'roomk-nemurase',
    storageBucket: 'roomk-nemurase.firebasestorage.app',
    messagingSenderId: '105012767748',
    appId: '1:105012767748:web:6faccc7e35da922b011951',
  };

  // 共通の RoomkRTDB.initFirebase は本体のプロジェクトにつなぐので使わない。
  // 初期化・匿名ログイン・サーバー時刻の補正を、ここで同じ形にそろえて返す
  function init(firebaseNamespace) {
    firebaseNamespace.initializeApp(CONFIG);
    const authReady = firebaseNamespace.auth().signInAnonymously().catch((error) => {
      console.error('[auth] anonymous sign-in failed', error);
      throw error;
    });
    const db = firebaseNamespace.database();
    RoomkRTDB.initServerTime(db);
    return { authReady, db };
  }

  window.NemuraseFirebase = { init };
})();

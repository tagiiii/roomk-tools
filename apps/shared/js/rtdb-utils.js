// 後方互換で追加のみ。破壊的変更をする場合は ?v= 付き読み込みに切り替えること
(function () {
  const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyC0bqQdDJeTAWrqFYqjOT1NsVFiunPemIw',
    authDomain: 'roomk-tools.firebaseapp.com',
    databaseURL: 'https://roomk-tools-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'roomk-tools',
    storageBucket: 'roomk-tools.firebasestorage.app',
    messagingSenderId: '592193782148',
    appId: '1:592193782148:web:1529f47cebab7dcd109dd1',
  };
  let serverTimeOffset = 0;

  function initServerTime(db) {
    db.ref('.info/serverTimeOffset').on('value', (snap) => {
      const offset = Number(snap.val());
      serverTimeOffset = Number.isFinite(offset) ? offset : 0;
    });
  }

  function now() {
    return Date.now() + serverTimeOffset;
  }

  function getHostDisconnectedAt(room) {
    const ts = room ? Number(room.hostDisconnectedAt) : NaN;
    return Number.isFinite(ts) ? ts : null;
  }

  function isRoomExpired(room, ttlMs = 2 * 60 * 1000) {
    const disconnectedAt = getHostDisconnectedAt(room);
    return room?.hostConnected === false
      && disconnectedAt != null
      && (now() - disconnectedAt) >= ttlMs;
  }

  function generateRoomCode(length = 6) {
    return Array.from(
      { length },
      () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)],
    ).join('');
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initFirebase(firebaseNamespace) {
    if (!firebaseNamespace
      || typeof firebaseNamespace.initializeApp !== 'function'
      || typeof firebaseNamespace.auth !== 'function'
      || typeof firebaseNamespace.database !== 'function') {
      throw new Error('Firebase compat SDK（app / auth / database）を先に読み込んでください');
    }

    firebaseNamespace.initializeApp(FIREBASE_CONFIG);
    const authReady = firebaseNamespace.auth().signInAnonymously().catch((error) => {
      console.error('[auth] anonymous sign-in failed', error);
      throw error;
    });
    const db = firebaseNamespace.database();
    initServerTime(db);
    return { authReady, db };
  }

  // teardown（明示退出・TOP 遷移・room 削除検知後）で、この接続が room 以下に予約した
  // onDisconnect（host の update / guest の remove・set）をまとめて取り消す。
  // これを怠ると、room が削除された後にこの接続が実切断した時、予約済みの書き込みが
  // 削除済みパスへ発火し、{hostConnected:false, ...} だけの「ゴースト room」を部分再生成
  // してしまう（players/status/deleteAt を持たないため、どのクライアント掃除経路も回収しない）。
  //
  // 重要:
  // - cancel() は接続単位・サブツリー全体に効く。roomRef へ 1 回呼べば、同じ接続が
  //   その配下（players/…）に予約した onDisconnect もまとめて取り消される。
  // - room を remove() する経路では、必ず await して remove() の「前」に呼ぶこと
  //   （順序が逆だと、remove 成功後 cancel 到達前の切断でゴーストが残る）。
  // - 別接続（他のゲスト等）の予約はこの呼び出しでは取り消せない（接続単位のため）。
  //   クロス接続のゴースト完全防止は validation rules 側のバックストップで別途対応する。
  function cancelRoomOnDisconnect(ref) {
    if (!ref) return Promise.resolve();
    return ref.onDisconnect().cancel().catch((error) => {
      console.warn('[rtdb] onDisconnect().cancel() failed', error);
    });
  }

  function showToast(message, isError = true, durationMs = 3000) {
    const existing = document.getElementById('roomk-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'roomk-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.textContent = message;
    el.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
      `background:${isError ? 'var(--color-error)' : 'var(--color-success)'}`,
      'color:#fff', 'padding:12px 24px', 'border-radius:8px',
      'font-size:14px', 'font-weight:500', 'z-index:9999',
      'box-shadow:0 4px 16px rgba(0,0,0,0.25)', 'white-space:nowrap',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), durationMs);
  }

  window.RoomkRTDB = Object.assign(window.RoomkRTDB || {}, {
    initServerTime,
    now,
    getHostDisconnectedAt,
    isRoomExpired,
    generateRoomCode,
    esc,
    initFirebase,
    cancelRoomOnDisconnect,
    showToast,
  });
}());

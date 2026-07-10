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

  function showToast(message, isError = true, durationMs = 3000) {
    const existing = document.getElementById('roomk-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'roomk-toast';
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
    showToast,
  });
}());

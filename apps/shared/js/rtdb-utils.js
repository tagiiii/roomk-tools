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

  // Safari・iPad では、Firebase Auth がログインの準備の途中で Google の部品（apis.google.com）を先に読み、
  // 終わるまで匿名ログインを待たせる（ポップアップ・リダイレクトでのログインのため。Chrome などでは読まない）。
  // 通信が遅い所や、フィルターで apis.google.com が遅らされる所では、参加・作成のボタンを押したまま
  // 長く止まって見えた（2026-11-19、のりあいロードの「iPad で参加すると固まる」）。
  // このサイトは匿名ログインだけでポップアップ・リダイレクトを使わないので、先読みをしない。
  // SDK の内部の値（_popupRedirectResolver._shouldInitProactively）を使う。SDK の版を上げたら、
  // iPad をまねた WebKit で apis.google.com を読まないことを確かめなおす（13.3.0〜13.4.0 で同じ作り）。
  function skipPopupResolverPreload(auth) {
    try {
      const resolver = auth && auth._delegate && auth._delegate._popupRedirectResolver;
      if (resolver) Object.defineProperty(resolver, '_shouldInitProactively', { value: false, configurable: true });
    } catch (error) {
      // 止められなくても、ログインはいままでどおり進む
    }
  }

  // 匿名ログインが 10 秒たっても終わらないときに、読み込み直すように知らせる（2026-11-19）。
  // Safari の IndexedDB（ログイン状態の保存先）が返事をしなくなる不具合では、ログインがいつまでも終わらず、
  // 参加・作成のボタンを押したまま止まって見える。読み込み直すと直ることが多い。
  // 不具合そのものは SDK の中のことで、こちらでは直せない（返事を待たずに切りかえる細工は、SDK がほかの所でも待つので効かなかった）
  const SLOW_AUTH_MS = 10000;
  const SLOW_AUTH_MESSAGE = 'つながるまで時間がかかっています。ページを読み直してみてね';
  function noticeSlowAuth(authReady) {
    let settled = false;
    Promise.resolve(authReady).then(() => { settled = true; }, () => { settled = true; });
    setTimeout(() => {
      if (!settled) showToast(SLOW_AUTH_MESSAGE, true, 15000);
    }, SLOW_AUTH_MS);
  }

  function initFirebase(firebaseNamespace) {
    if (!firebaseNamespace
      || typeof firebaseNamespace.initializeApp !== 'function'
      || typeof firebaseNamespace.auth !== 'function'
      || typeof firebaseNamespace.database !== 'function') {
      throw new Error('Firebase compat SDK（app / auth / database）を先に読み込んでください');
    }

    firebaseNamespace.initializeApp(FIREBASE_CONFIG);
    const auth = firebaseNamespace.auth();
    skipPopupResolverPreload(auth);
    const authReady = auth.signInAnonymously().catch((error) => {
      console.error('[auth] anonymous sign-in failed', error);
      throw error;
    });
    noticeSlowAuth(authReady);
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

  // 文字列をコピーし、成功・失敗をトーストで通知する（クリックから直接呼ぶ。連打ガードつき）。
  // Clipboard API が使えないときは textarea + execCommand('copy') で代替する。
  async function copyText(value, button, okMessage, failMessage) {
    if (button?.dataset.copyBusy) return false;
    if (button) button.dataset.copyBusy = '1';
    let copied = false;
    try {
      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch (_) {
        const focused = document.activeElement;
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.readOnly = true;
        textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        try {
          document.body.appendChild(textarea);
          textarea.select();
          copied = document.execCommand('copy');
        } finally {
          textarea.remove();
          focused?.focus({ preventScroll: true });
        }
      }
    } catch (_) {
      copied = false;
    } finally {
      if (button) delete button.dataset.copyBusy;
    }
    showToast(copied ? okMessage : failMessage, !copied);
    return copied;
  }

  // クリックから直接呼ぶ。コード単体をコピーし、失敗時も通知する。
  async function copyRoomCode(code, button) {
    if (button?.dataset.copyBusy) return false;
    if (typeof code !== 'string' || !/^[A-Z2-9]{6}$/.test(code)) {
      showToast('ルームコードがありません');
      return false;
    }
    return copyText(code, button, 'コードをコピーしました', 'コピーできませんでした。コードをそのまま伝えてね');
  }

  // 参加用のリンク: このページのアドレスの末尾に ?room=ルームコード（docs/development/rtdb.md「参加用のリンク」）。
  function roomLink(code) {
    return location.origin + location.pathname + '?room=' + code;
  }

  // クリックから直接呼ぶ。参加用のリンクをコピーし、失敗時も通知する。「コードをコピー」はコード単体のまま。
  // link を渡すと、そのアドレスをコピーする（アプリが独自のパラメータを引き継ぐとき用）。
  async function copyRoomLink(code, button, link) {
    if (button?.dataset.copyBusy) return false;
    if (typeof code !== 'string' || !/^[A-Z0-9]{6}$/.test(code)) {
      showToast('ルームコードがありません');
      return false;
    }
    const value = typeof link === 'string' && link ? link : roomLink(code);
    return copyText(value, button, '参加用のリンクをコピーしました', 'コピーできませんでした。コードをそのまま伝えてね');
  }

  // 入力エラーは再送信までフォーム内に残す。
  function showFormError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
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
      'box-shadow:0 4px 16px rgba(0,0,0,0.25)', 'white-space:normal',
      'width:max-content', 'max-width:calc(100vw - 32px)', 'box-sizing:border-box',
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
    skipPopupResolverPreload,
    noticeSlowAuth,
    cancelRoomOnDisconnect,
    copyRoomCode,
    copyText,
    roomLink,
    copyRoomLink,
    showFormError,
    showToast,
  });
}());

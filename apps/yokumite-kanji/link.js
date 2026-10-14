// =============================================
// よく見て漢字 — 見る画面とのつなぎ（Realtime Database）
//
// yokumitekanji_rooms/{ルームコード}/
//   meta/  小さい情報だけ。transaction はここ（とルーム作成の1回）にしか使わない
//     status, createdAt, hostUid, hostToken, hostConnected, hostDisconnectedAt
//     player: pid                 いま見せている人（あとから入った人に切りかわる。切断では消えない）
//     seats/{pid}: { uid, joinedAt }   在室。自分の pid の下だけを、切断時に消す
//   live/{pid}/  その人だけが書く。切断で消える
//     view: { name, unit, set, afterSet } ／ puzzle: { unit, w, layout, decoys, pieces, peek, done }
//   order/  メンター（見る側）だけが書く。出している問題 { id, unit, n, at }。おわると消す
//
// 席と中身を人（pid）ごとに分けているのは、前の画面の切断時の予約や遅れて届いた書き込みが、
// あとから入った人の席・盤面を消したり書きかえたりしないようにするため。
//
// 役: 'viewer'（メンター。ルームを作って見る＝ホスト）／'player'（子ども。自分の画面を見せる）
// 仕様の正本: AGENTS.md
// =============================================

const ROOMS = 'yokumitekanji_rooms';
const STATUS_OPEN = 'open';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const TX_RETRY_MAX = 3;
const CREATE_TRIES = 5;
const TICK_MS = 5000;
const PRESENCE_RETRY_MS = 5000;
const PIECE_MAX = 12;               // 見る側が受け取る部品の数の上限
const PID_RE = /^[a-z0-9]{4,20}$/;  // パスに使うので、形を確かめる

const { RoomkRTDB } = window;

// ルームを作る・入るときにはじめて Firebase につなぐ（一人で遊ぶだけの人は、接続を使わない）
let fb = null;
function init() {
  if (!fb) fb = RoomkRTDB.initFirebase(window.firebase);
  return fb;
}

const currentUid = () => window.firebase.auth().currentUser?.uid || null;
const serverTimestamp = () => window.firebase.database.ServerValue.TIMESTAMP;
const roomRefOf = (code) => fb.db.ref(ROOMS + '/' + code);
const warn = (label) => (error) => console.warn('[yokumite-kanji] ' + label, error);

function isExpired(meta) {
  // status を持たない meta は、削除後に onDisconnect が発火して再生成されたゴースト
  return RoomkRTDB.isRoomExpired(meta, ORPHAN_TTL_MS) || (!!meta && !meta.status);
}

// パスで指定した場所を書きかえる（'' は木の全体。null は消す）
export function applyPath(tree, path, value) {
  if (!path) return value || {};
  const keys = path.split('/');
  let node = tree;
  for (const key of keys.slice(0, -1)) {
    if (node[key] == null || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  const last = keys[keys.length - 1];
  if (value == null) delete node[last];
  else node[last] = value;
  return tree;
}

// transaction の最初の計算が空のキャッシュで走らないよう、先に値を購読しておく
function warmCache(ref) {
  return new Promise((resolve, reject) => {
    const callback = (snap) => resolve({ snap, release: () => ref.off('value', callback) });
    ref.on('value', callback, reject);
  });
}

// 送信したあとに通信が切れると、transaction は Error('disconnect') で中止される（サーバーに届いたかは分からない）。
// 作成と参加は少しだけやり直す。update は、前の送信が届いていたら成功として扱うように書く
async function transactRetry(ref, update) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await ref.transaction(update);
    } catch (error) {
      if (error?.message !== 'disconnect' || attempt >= TX_RETRY_MAX) throw error;
    }
  }
}

// 期限切れのルームを消す（期限切れのままのときだけ）
async function removeExpiredRoom(roomRef, fallback) {
  try {
    // 手元には反映しない（applyLocally:false）。消えたルームを古い値で表示し直さないため
    const result = await roomRef.child('meta').transaction((meta) => {
      const current = meta || fallback;
      return current && isExpired(current) ? null : undefined;
    }, undefined, false);
    if (result.committed) await roomRef.remove();
  } catch (error) {
    warn('expired room cleanup failed')(error);
  }
}

// 終わっているルーム（meta がない・期限切れ）の残りを消す
function clearDeadRoom(roomRef, meta) {
  return meta ? removeExpiredRoom(roomRef, meta) : roomRef.remove().catch(warn('leftover cleanup failed'));
}

// ── ルームを作る（見る側） ──
// できたルームコードを返す。切断時の予約を張る前なので「切断中」として作り、つないだあとの在室確認で接続中にする
export async function createRoom() {
  await init().authReady;
  const uid = currentUid();
  for (let i = 0; i < CREATE_TRIES; i += 1) {
    const code = RoomkRTDB.generateRoomCode();
    const token = Math.random().toString(36).slice(2);
    const initial = {
      meta: {
        status: STATUS_OPEN,
        createdAt: serverTimestamp(),
        hostUid: uid,
        hostToken: token,
        hostConnected: false,
        hostDisconnectedAt: serverTimestamp(),
      },
    };
    // 空きコードの確保は、ルーム全体の transaction で行う（作る前なので中身は空）。
    // やり直しのとき、前の送信が届いていれば（自分のしるしがあれば）そのまま成功にする
    const result = await transactRetry(roomRefOf(code), (room) => {
      if (room) return room.meta?.hostUid === uid && room.meta?.hostToken === token ? room : undefined;
      return initial;
    });
    if (result.committed) return code;
  }
  throw new Error('no free room code');
}

// ── 席を取る（見せる側） ──
// 見せる人は1人。だれかが見せていても、あとから入った側に切りかえる（同じ人がリンクをひらき直しても詰まらない）
async function claimSeat(code, pid) {
  const roomRef = roomRefOf(code);
  const metaRef = roomRef.child('meta');
  const seatRef = metaRef.child('seats/' + pid);
  const liveRef = roomRef.child('live/' + pid);
  const uid = currentUid();
  const warm = await warmCache(metaRef);
  try {
    const pre = warm.snap.val();
    if (!pre || isExpired(pre)) {
      await clearDeadRoom(roomRef, pre);
      return false;
    }
    // 席と中身は自分の pid の下なので、先に切断時の予約を張っても、ほかの人の分は消えない。
    // 先に張っておけば、席を取った直後に閉じても席が残らない
    await seatRef.onDisconnect().remove();
    await liveRef.onDisconnect().remove();
    const result = await transactRetry(metaRef, (meta) => {
      if (!meta || meta.status !== STATUS_OPEN || isExpired(meta)) return undefined;
      if (meta.player === pid && meta.seats?.[pid]) return meta; // 入り直し・やり直し
      return { ...meta, player: pid, seats: { [pid]: { uid, joinedAt: serverTimestamp() } } };
    });
    if (!result.committed) {
      await Promise.all([seatRef.onDisconnect().cancel(), liveRef.onDisconnect().cancel()]).catch(warn('cancel failed'));
      return false;
    }
    return true;
  } finally {
    warm.release();
  }
}

// ── つなぐ ──
// 返り値: { ok: true, link } ／ { ok: false, reason: 'gone'（ルームがない・終わっている）| 'error'（通信の失敗） }
export async function openLink(code, role, pid) {
  try {
    if (!PID_RE.test(pid)) return { ok: false, reason: 'error' };
    await init().authReady;
    const roomRef = roomRefOf(code);
    if (role === 'viewer') {
      const meta = (await roomRef.child('meta').once('value')).val();
      if (!meta || isExpired(meta)) {
        await clearDeadRoom(roomRef, meta);
        return { ok: false, reason: 'gone' };
      }
      // 別のブラウザが作ったルームは、見る側としては開けない
      if (meta.hostUid !== currentUid()) return { ok: false, reason: 'gone' };
    } else if (!await claimSeat(code, pid)) {
      return { ok: false, reason: 'gone' };
    }
    return { ok: true, link: makeLink(code, role, pid) };
  } catch (error) {
    warn('connect failed')(error);
    return { ok: false, reason: 'error' };
  }
}

// 受け取った部品の並びを、0〜PIECE_MAX-1 の番号だけの配列にする
// （一部だけが届いたとき、RTDB は配列をオブジェクトで返すことがある。大きすぎる番号は捨てる）
function toPieces(raw) {
  const pieces = [];
  if (!raw || typeof raw !== 'object') return pieces;
  for (const key of Object.keys(raw)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < PIECE_MAX) pieces[index] = raw[key];
  }
  return pieces;
}

function makeLink(code, role, pid) {
  const { db } = fb;
  const uid = currentUid();
  const roomRef = roomRefOf(code);
  const metaRef = roomRef.child('meta');
  const seatRef = metaRef.child('seats/' + pid);      // 見せる側だけが使う
  const myLiveRef = roomRef.child('live/' + pid);     // 見せる側だけが使う
  const handlers = { value: [], peer: [], end: [], order: [] };
  const subs = [];
  let meta = null;
  let state = {};        // 見せる側: 自分が書いた中身 ／ 見る側: 受け取った中身
  let connected = false;
  let closed = false;
  let endedReason = null;
  let peer = false;
  let presenceAt = 0;
  let presenceRun = null;
  let presenceAgain = false;
  let resend = false;    // 見せる側: 今の中身を、つながったらまとめて送り直す
  let watched = null;    // 見る側: いま購読している相手 { pid, ref, callback }
  let order = null;      // メンターが出している問題（両方の役が読む）
  let orderLoaded = false;

  const emit = (path) => handlers.value.forEach((handler) => handler(state, path));
  const setPeer = (on) => {
    if (peer === on) return;
    peer = on;
    handlers.peer.forEach((handler) => handler(on));
  };

  function subscribe(ref, callback) {
    const guarded = (snap) => {
      if (!closed) callback(snap);
    };
    ref.on('value', guarded, warn('listener failed'));
    subs.push({ ref, guarded });
  }

  function unwatch() {
    if (watched) watched.ref.off('value', watched.callback);
    watched = null;
  }

  function detach() {
    closed = true;
    clearInterval(timer);
    subs.forEach((s) => s.ref.off('value', s.guarded));
    unwatch();
  }

  // ルームがなくなった・期限が切れた・あとから入った人に切りかわった
  function end(reason) {
    if (closed) return;
    endedReason = reason;
    detach();
    // 切断時の予約を取り消してから、残りを消す。
    // - ルームがなくなったとき: ルームごと（とじる直前に自分が送った書き込みが、削除よりあとに届いていても、この削除はそのあとに届く）
    // - 切りかわったとき: 自分の中身だけ（席は、切りかえた側の transaction がもう外している）
    RoomkRTDB.cancelRoomOnDisconnect(roomRef).then(() => {
      if (reason === 'closed') return roomRef.remove();
      if (reason === 'replaced') return myLiveRef.remove();
      return null;
    }).catch(warn('leftover cleanup failed'));
    handlers.end.forEach((handler) => handler(reason));
  }

  // 接続中なのに、ルームの上では切断・不在になっている
  function needsPresence() {
    if (!meta) return false;
    if (role === 'viewer') return meta.hostConnected === false;
    return meta.player === pid && !meta.seats?.[pid];
  }

  // 接続のたびに切断時の予約を張り直し、自分の在室を確かめる。同時には1本だけ走らせる
  // （退出や終了と重なったときに、古い実行が席を作り直さないよう、待つたびに closed を見る）
  async function recoverPresence() {
    if (role === 'viewer') {
      await metaRef.onDisconnect().update({ hostConnected: false, hostDisconnectedAt: serverTimestamp() });
      if (closed) return;
      await metaRef.transaction((m) => {
        if (closed || !m || !m.status || m.hostUid !== uid || isExpired(m)) return undefined;
        if (m.hostConnected === true && m.hostDisconnectedAt == null) return undefined;
        return { ...m, hostConnected: true, hostDisconnectedAt: null };
      });
      return;
    }
    await seatRef.onDisconnect().remove();
    await myLiveRef.onDisconnect().remove();
    if (closed) return;
    let lost = false;
    let rejoined = false;
    await metaRef.transaction((m) => {
      lost = false;
      rejoined = false;
      if (closed || !m || !m.status || isExpired(m)) return undefined;
      if (m.player !== pid) {
        lost = true;
        return undefined;
      }
      if (m.seats?.[pid]) return undefined;
      rejoined = true;
      return { ...m, seats: { ...(m.seats || {}), [pid]: { uid, joinedAt: RoomkRTDB.now() } } };
    });
    if (closed) return;
    if (lost) {
      end('replaced');
      return;
    }
    if (rejoined || resend) {
      // 送れたのを確かめてから、しるしを下ろす（失敗したら、つぎの確認でもう一度送る）
      await myLiveRef.set(state);
      resend = false;
    }
  }

  function ensurePresence(force = false) {
    if (closed || !connected) return;
    if (presenceRun) {
      presenceAgain = presenceAgain || force;
      return;
    }
    if (!force && Date.now() - presenceAt < PRESENCE_RETRY_MS) return;
    presenceAt = Date.now();
    presenceRun = recoverPresence().catch(warn('presence recovery failed')).finally(() => {
      presenceRun = null;
      if (presenceAgain) {
        presenceAgain = false;
        ensurePresence(true);
      }
    });
  }

  // 見る側: いま見せている人の中身だけを購読する（前の人の中身は見ない）
  function watch(target) {
    if ((watched?.pid || null) === target) return;
    unwatch();
    state = {};
    // 相手が変わったら、前の人の盤面をすぐに下ろす（新しい人の中身がまだ空でも、古い盤面を出したままにしない）
    emit('');
    if (!target) return;
    const ref = roomRef.child('live/' + target);
    const callback = (snap) => {
      if (!closed && watched && watched.pid === target) handleLive(snap.val());
    };
    watched = { pid: target, ref, callback };
    ref.on('value', callback, warn('listener failed'));
  }

  function handleMeta(next) {
    if (!next || !next.status) {
      end('closed');
      return;
    }
    if (isExpired(next)) {
      removeExpiredRoom(roomRef, next);
      end('expired');
      return;
    }
    meta = next;
    if (role === 'player') {
      if (next.player !== pid) {
        end('replaced');
        return;
      }
      setPeer(next.hostConnected === true);
    } else {
      const target = typeof next.player === 'string' && PID_RE.test(next.player) ? next.player : null;
      watch(target);
      setPeer(Boolean(target && next.seats && next.seats[target]));
    }
    // 見せる側の席がなくなっていたら、間をあけずに取り直す
    // （同じ id で入り直した直後に、前の接続の切断時の予約が遅れて発火した場合など）
    if (needsPresence()) ensurePresence(role === 'player');
  }

  // 見る側: 部品の動きだけなら、その部品だけを知らせる（盤面を作り直させない）
  function handleLive(value) {
    const next = value && typeof value === 'object' ? value : {};
    if (next.puzzle && typeof next.puzzle === 'object') next.puzzle.pieces = toPieces(next.puzzle.pieces);
    else delete next.puzzle;
    const prev = state;
    state = next;
    const core = (s) => JSON.stringify([
      s.view || null,
      // 時間切れのしるしは、done と一緒に（1回の書きこみで）届く。盤面を作り直さずに done として読む
      s.puzzle ? { ...s.puzzle, pieces: s.puzzle.pieces.length, peek: null, done: null, timeout: null } : null,
    ]);
    if (core(prev) !== core(next)) {
      emit('');
      return;
    }
    if (!next.puzzle) return;
    next.puzzle.pieces.forEach((p, i) => {
      const q = prev.puzzle.pieces[i];
      if (!p || !q || p.x !== q.x || p.y !== q.y || p.l !== q.l) emit('puzzle/pieces/' + i);
    });
    if (Boolean(prev.puzzle.peek) !== Boolean(next.puzzle.peek)) emit('puzzle/peek');
    if (Boolean(prev.puzzle.done) !== Boolean(next.puzzle.done)) emit('puzzle/done');
  }

  function tick() {
    if (closed || !meta) return;
    if (isExpired(meta)) handleMeta(meta);
    else if (needsPresence() || (role === 'player' && resend)) ensurePresence();
  }

  const timer = setInterval(tick, TICK_MS);
  subscribe(metaRef, (snap) => handleMeta(snap.val()));
  subscribe(roomRef.child('order'), (snap) => {
    const value = snap.val();
    order = value && typeof value === 'object' ? value : null;
    orderLoaded = true;
    handlers.order.forEach((handler) => handler(order));
  });
  subscribe(db.ref('.info/connected'), (snap) => {
    connected = snap.val() === true;
    if (connected) ensurePresence(true);
    else if (role === 'player') resend = true;
  });

  return {
    // 見せる側だけが書く。切れている間は手元にだけ持ち、つながったらまとめて送り直す
    set(path, value) {
      if (closed || role !== 'player') return;
      state = applyPath(state, path, value);
      if (!connected) {
        resend = true;
        return;
      }
      const ref = path ? myLiveRef.child(path) : myLiveRef;
      (value == null ? ref.remove() : ref.set(value)).catch((error) => {
        resend = true; // 送れなかった分は、つぎの確認でまとめて送り直す
        warn('write failed')(error);
      });
    },
    get: () => state,
    isConnected: () => connected,
    onValue: (handler) => handlers.value.push(handler),
    // 登録より前に起きていた変化も取りこぼさない（つないだ直後に相手がいた・終わっていた）
    onPeer(handler) {
      handlers.peer.push(handler);
      if (peer) handler(true);
    },
    onEnd(handler) {
      handlers.end.push(handler);
      if (endedReason) handler(endedReason);
    },
    // メンターが出している問題。登録より前に読めていた分も、その場で知らせる
    onOrder(handler) {
      handlers.order.push(handler);
      if (orderLoaded) handler(order);
    },
    getOrder: () => order,

    // 見る側: 問題を出す（同じ場所に書きなおすと、出しなおしになる）／問題をおわる
    sendOrder(next) {
      if (closed || role !== 'viewer') return Promise.resolve(false);
      return roomRef.child('order').set({ ...next, at: serverTimestamp() }).then(() => true, (error) => {
        warn('order failed')(error);
        return false;
      });
    },
    clearOrder() {
      if (closed || role !== 'viewer') return Promise.resolve(false);
      return roomRef.child('order').remove().then(() => true, (error) => {
        warn('order clear failed')(error);
        return false;
      });
    },

    // 見せる側: 見せるのをやめる（ルームは残す）
    leave() {
      if (closed) return;
      // 先に closed にして、走っている在室の確認が席を作り直さないようにする
      detach();
      // 切れている間は、サーバーが切断時の予約で席と中身を消している
      if (connected) {
        myLiveRef.remove().catch(() => {});
        seatRef.remove().catch(() => {});
      }
      RoomkRTDB.cancelRoomOnDisconnect(roomRef);
    },

    // 見る側: ルームをとじる（ルームごと消す）。消せたら true
    async finish() {
      if (closed) return true;
      closed = true; // 消えていく途中の変化を「相手がとじた」と受け取らない。在室の確認も止める
      try {
        if (presenceRun) await presenceRun; // 走っている在室の確認が張った予約まで、まとめて取り消す
        // 削除の前に切断時の予約を取り消す（残っていると、消したあとの切断でルームのかけらが作り直される）。
        // 取り消しに失敗したら消さずにやめるので、失敗を握りつぶす共通の cancelRoomOnDisconnect は使わない
        await roomRef.onDisconnect().cancel();
        await roomRef.remove();
      } catch (error) {
        warn('finish failed')(error);
        closed = false;
        ensurePresence(true);
        return false;
      }
      detach();
      return true;
    },
  };
}

/* 作戦会議（スタッフ向け。サークルタイムと同じく、ツール一覧には出さない）
   週1回30分の作戦会議の流れを、ひとつのルームで進める。Realtime Database のルーム型。
   仕様・経緯は AGENTS.md。

   画面は3つ。それぞれ別の作りにしている:
   - みんなにみせる画面（?watch=）: 1280×720 の舞台を、窓の幅に合わせて縮める
   - 進行役の画面: 舞台のプレビュー・前の画面／次の画面・その画面の操作・参加する人。共有しない
   - 子どもの画面（?room=）: 自分の端末で押すための、縦に並んだ大きいボタン

   ルームの直し方: 進行役も子どもも、ルームの根っこへの transaction で直す（配下への set はしない。
   親の transaction と同じ端末の配下 set がぶつかると、transaction が 'set' で中止されるため）。
   画面を進める・決めるのは進行役だけ。子どもは、いま出ている画面で自分の分だけ入れられる。 */
(() => {
  'use strict';

  const D = window.SAKUSEN_DATA;
  const PREFIX = 'sakusenkaigi_rooms';
  const ORPHAN_TTL_MS = 2 * 60 * 1000;
  const KEY = 'roomk-sakusen-kaigi-session';
  const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
  const APPS = '../'; // ほかのツールの置き場所（このフォルダのとなり）
  const qs = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const esc = RoomkRTDB.esc;
  const toast = (m, err = true) => RoomkRTDB.showToast(m, err);
  const fail = (text) => new Error(text);
  const ic = (name) => `<span class="material-symbols-rounded" aria-hidden="true">${esc(name)}</span>`;
  // 中身が前と同じなら、書きかえない。書きかえると、押している途中のボタンが消えて「押した」が届かない
  // （次回の時刻を入れた直後にほかのボタンを押すと、欄の確定で画面を描きなおし、1回めの押しが消えていた）。
  // イラストの読みなおしによるちらつきも減る
  const lastHTML = new WeakMap();
  function setHTML(el, html) {
    if (lastHTML.get(el) === html) return;
    lastHTML.set(el, html);
    el.innerHTML = html;
  }

  // ── 平らな形のしるし（ふせんやカードにのせる。人・顔・手は描かない）──
  const C = { a: '#F2D36B', b: '#EE9B7A', c: '#CFC4B6', w: '#FFFFFF', h: '#F3E3C8', k: '#3D3833' }; // 黄・あたたかい赤み・あたたかい灰だけ
  function starPath(cx, cy, r) {
    const p = [];
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.46 : r; const a = -Math.PI / 2 + i * Math.PI / 5;
      p.push((cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1));
    }
    return 'M' + p.join('L') + 'z';
  }
  const MOTIF = {
    flag: `<rect x="52" y="24" width="12" height="160" rx="6" fill="${C.k}"/><path d="M64 34c30-14 50 14 84 0v70c-34 14-54-14-84 0z" fill="${C.b}"/><rect x="20" y="176" width="130" height="14" rx="7" fill="${C.c}"/>`,
    talk: `<path d="M30 30h100a18 18 0 0 1 18 18v48a18 18 0 0 1-18 18H76l-30 26v-26H30a18 18 0 0 1-18-18V48a18 18 0 0 1 18-18z" fill="${C.a}"/><g fill="${C.w}"><circle cx="50" cy="72" r="8"/><circle cx="80" cy="72" r="8"/><circle cx="110" cy="72" r="8"/></g><path d="M100 100h72a16 16 0 0 1 16 16v38a16 16 0 0 1-16 16h-6v22l-26-22h-40a16 16 0 0 1-16-16v-38a16 16 0 0 1 16-16z" fill="${C.b}"/>`,
    kokoro: `<path d="M100 178C42 134 14 102 14 66c0-28 21-46 44-46 18 0 33 10 42 27 9-17 24-27 42-27 23 0 44 18 44 46 0 36-28 68-86 112z" fill="${C.b}"/>`,
    game: `<g transform="rotate(-10 100 100)"><rect x="34" y="34" width="132" height="132" rx="26" fill="${C.c}"/><g fill="${C.w}"><circle cx="68" cy="68" r="13"/><circle cx="132" cy="68" r="13"/><circle cx="100" cy="100" r="13"/><circle cx="68" cy="132" r="13"/><circle cx="132" cy="132" r="13"/></g></g>`,
    cal: `<rect x="30" y="44" width="140" height="138" rx="14" fill="${C.w}"/><path d="M30 58a14 14 0 0 1 14-14h112a14 14 0 0 1 14 14v32H30z" fill="${C.b}"/><rect x="62" y="26" width="15" height="36" rx="7.5" fill="${C.k}"/><rect x="123" y="26" width="15" height="36" rx="7.5" fill="${C.k}"/><g fill="${C.a}"><rect x="52" y="106" width="26" height="22" rx="5"/><rect x="122" y="140" width="26" height="22" rx="5"/></g><g fill="${C.c}"><rect x="87" y="106" width="26" height="22" rx="5"/><rect x="52" y="140" width="26" height="22" rx="5"/></g><g fill="${C.h}"><rect x="122" y="106" width="26" height="22" rx="5"/><rect x="87" y="140" width="26" height="22" rx="5"/></g>`,
    mega: `<path d="M34 80h36l74-44v128l-74-44H34a8 8 0 0 1-8-8V88a8 8 0 0 1 8-8z" fill="${C.a}"/><rect x="50" y="116" width="26" height="54" rx="10" fill="${C.k}"/><path d="M162 70c14 16 14 44 0 60M178 50c26 28 26 72 0 100" stroke="${C.b}" stroke-width="11" fill="none" stroke-linecap="round"/>`,
    pencil: `<g transform="rotate(40 100 100)"><rect x="74" y="14" width="52" height="34" rx="10" fill="${C.b}"/><rect x="74" y="44" width="52" height="96" fill="${C.a}"/><path d="M74 140h52l-26 46z" fill="${C.h}"/><path d="M90 168h20l-10 18z" fill="${C.k}"/></g>`,
    star: `<path d="${starPath(100, 106, 84)}" fill="${C.a}"/>`,
    bulb: `<g transform="translate(100 100) scale(1.16) translate(-100 -100)"><path d="M100 22a56 56 0 0 0-34 100c8 7 12 14 12 24h44c0-10 4-17 12-24a56 56 0 0 0-34-100z" fill="${C.a}"/><rect x="78" y="150" width="44" height="14" rx="7" fill="${C.k}"/><rect x="84" y="168" width="32" height="12" rx="6" fill="${C.k}"/></g>`,
  };
  const motif = (key) => `<svg viewBox="0 0 200 200" aria-hidden="true">${MOTIF[key] || MOTIF.star}</svg>`;

  // ── 流れ ──────────────────────────────────────
  const STEPS = [
    { id: 'cover', name: '表紙', motif: 'flag' },
    { id: 'checkin', name: 'チェックイン', motif: 'talk' },
    { id: 'agenda', name: 'もくじ', motif: 'flag' },
    { id: 'heart', name: 'ジブンチェック', sec: 1, motif: 'kokoro', lead: '', main: 'ジブンチェック', memo: ['ジブン', 'チェック'], desc: 'いまの気持ちを、1〜5で教えてね' },
    { id: 'menu', name: '今日は何する？', sec: 2, motif: 'game', lead: '今日は', main: '何する？', memo: ['今日は', '何する？'], desc: '6つの中から、やりたいことを選ぼう' },
    { id: 'plan', name: '予定の確認', sec: 3, motif: 'cal', lead: '予定の', main: '確認', memo: ['予定の', '確認'], desc: 'これから1週間の予定を入れてみよう' },
    { id: 'news', name: 'お知らせ', sec: 4, motif: 'mega', lead: '', main: 'お知らせ', memo: ['お知らせ'], desc: 'room-K のお知らせと、次回の日' },
  ];
  const ROWS = [{ id: 'am', name: '午前' }, { id: 'pm', name: '午後' }, { id: 'todo', name: 'するべきこと' }];
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const MAX_ITEMS = 3;
  const MAX_PEOPLE = 6; // 子ども（端末あり・なしを合わせて）
  const FOOT = 'ボタン・声・チャット、どれでもOK。パスもOK';

  // S.role: 'host' | 'guest' | 'watch'、S.me: 自分の id、S.room: いまのルーム（サーバーから届いたもの）
  const S = { role: null, me: null, code: null, room: null };
  const G = { wide: false }; // 子どもの画面の中だけの状態（「ほかも見る」を開いたか）
  let picker = null; // { pid, cell }

  // ── 日付 ──────────────────────────────────────
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function parseYmd(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function parts(s) { const d = parseYmd(s); return { m: d.getMonth() + 1, d: d.getDate(), w: WD[d.getDay()], rest: d.getDay() === 0 || d.getDay() === 6 }; }
  function fmtDay(s) { const p = parts(s); return `${p.m}月${p.d}日(${p.w})`; }
  function dateTag(s) { const p = parts(s); return `<span class="n">${p.m}</span>月<span class="n">${p.d}</span>日<span class="wd">${p.w}</span>`; }
  function today() { return /^\d{4}-\d{2}-\d{2}$/.test(qs.get('today') || '') ? qs.get('today') : ymd(new Date()); }
  // 予定の表は、あしたから7日ぶん（ふつうは最後の日が次回の作戦会議）
  function days(room) { return [1, 2, 3, 4, 5, 6, 7].map((n) => addDays(room.date, n)); }
  const timeText = (t) => (t ? t.replace(/^0/, '') + '〜' : '');

  // RTDB は空の入れもの（{}・[]）を保存しないので、読んだあとに足りない入れものを足す
  function norm(room) {
    if (!room) return room;
    ['persons', 'heart', 'wants', 'twant', 'sched', 'skip', 'players'].forEach((k) => { if (!room[k] || typeof room[k] !== 'object') room[k] = {}; });
    ['order', 'omakase', 'notices'].forEach((k) => { if (!Array.isArray(room[k])) room[k] = Object.values(room[k] || {}); });
    Object.keys(room.sched).forEach((pid) => {
      const cells = room.sched[pid] || {};
      Object.keys(cells).forEach((c) => { if (!Array.isArray(cells[c])) cells[c] = Object.values(cells[c] || {}); });
    });
    room.order = room.order.filter((pid) => room.persons[pid]);
    if (!room.next) room.next = { date: '', time: '' };
    if (room.covers === undefined) room.covers = true;
    if (room.decided && !D.menu.some((m) => m.key === room.decided)) room.decided = null;
    if (!STEPS.some((x) => x.id === room.cur)) { room.cur = 'cover'; room.view = 'body'; }
    return room;
  }

  // ══════════════════════════════════════════════
  // Firebase（サークルタイムと同じ型: 作成・参加・在室・切断・再接続・削除）
  // ══════════════════════════════════════════════
  let ctx = null; // いまつないでいるルーム（.info/connected は登録と同時に呼ばれるので先に宣言する）
  let db; let authReady; let setupError;
  try { ({ db, authReady } = RoomkRTDB.initFirebase(firebase)); authReady = authReady.catch((e) => { setupError = e; return null; }); }
  catch (e) { setupError = e; }
  let online = false;
  if (db) {
    db.ref('.info/connected').on('value', (snap) => {
      online = snap.val() === true;
      if (ctx && !ctx.watch) { ctx.ready = false; if (online) ensurePresence(ctx).catch(() => {}); }
      updateConn();
    });
  }
  const now = () => RoomkRTDB.now();
  const stamp = () => firebase.database.ServerValue.TIMESTAMP;
  // status のないルームは、消したあとに切断時の予約が動いてできた残り。すぐ期限切れとして片づける
  const expired = (room) => !!room && (!room.status || RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS));
  function validateCode(v) {
    const code = String(v || '').normalize('NFKC').replace(/\s/g, '').toUpperCase();
    if (!CODE_RE.test(code)) throw fail('ルームコードは英字と数字の6文字だよ。キーボードを英字に切り替えてね。');
    return code;
  }
  function validateName(v) {
    const name = String(v || '').normalize('NFKC').trim();
    if (!name || [...name].length > 8) throw fail('ニックネームは1〜8文字で入れてね。');
    if (/[.#$\[\]\/\u0000-\u001f\u007f]/.test(name)) throw fail('記号 . # $ [ ] / は使えません。');
    return name;
  }
  async function authenticated() {
    if (setupError || !authReady) throw fail('接続の準備に失敗しました。ページを再読み込みしてね。');
    await authReady;
    if (setupError || !firebase.auth().currentUser) throw fail('認証できませんでした。ページを再読み込みしてね。');
    if (!online) {
      await new Promise((resolve, reject) => {
        const ref = db.ref('.info/connected');
        const cb = (snap) => { if (snap.val() === true) { clearTimeout(t); ref.off('value', cb); resolve(); } };
        const t = setTimeout(() => { ref.off('value', cb); reject(fail('つながりませんでした。通信を確かめてね。')); }, 6000);
        ref.on('value', cb);
      });
    }
  }
  // 送ったあとに通信が切れた transaction は 'disconnect' で中止される。やり直して、もう届いていれば成功として扱う
  async function transactRetry(ref, update) {
    for (let attempt = 0; ; attempt++) {
      try { return await ref.transaction(update, undefined, false); }
      catch (e) { if (!e || e.message !== 'disconnect' || attempt >= 3) throw e; }
    }
  }
  function warmRoomCache(ref) {
    return new Promise((resolve, reject) => { const cb = (snap) => resolve({ snap, release: () => ref.off('value', cb) }); ref.on('value', cb, reject); });
  }
  async function cleanup(ref) {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    await ref.transaction((room) => (expired(room) ? null : undefined), undefined, false);
  }
  // 保存する前に undefined をなくす（RTDB は undefined を受けつけない）
  const clean = (room) => JSON.parse(JSON.stringify(room));

  // ── 記録（読みこみなおしても同じルームへ戻る）──
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { session = null; }
  function saveSession(v) { session = v; try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch (e) { /* 保存できなくても続ける */ } }

  // ── ルームへの接続 ──
  const own = (room, s) => !!s && !!firebase.auth().currentUser && s.token === firebase.auth().currentUser.uid
    && !!room && !!room.players && !!room.players[s.id] && room.players[s.id].uid === s.token
    && ((s.role === 'host' && room.host === s.id) || (s.role === 'guest' && room.host !== s.id));
  async function detach() {
    const old = ctx; ctx = null;
    if (!old) return;
    old.leaving = true;
    old.ref.off('value', old.listener);
    if (online) {
      if (old.pending) await old.pending.catch(() => {});
      await RoomkRTDB.cancelRoomOnDisconnect(old.ref);
      if (old.connectionRef) { await old.connectionRef.onDisconnect().cancel(); await old.connectionRef.remove(); }
    }
  }
  async function attach(code, s, watch) {
    await detach();
    const ref = db.ref(`${PREFIX}/${code}`);
    const c = { code, ref, session: s, watch, data: null, ready: false, pending: null, connectionRef: null, listener: null, leaving: false, attached: false };
    ctx = c;
    await new Promise((resolve, reject) => {
      c.listener = (snap) => { c.data = snap.val(); resolve(); if (ctx === c && c.attached) onRoomChange(c); };
      ref.on('value', c.listener, reject);
    });
    if (!c.data) { await detach(); throw fail('ルームが見つかりません。終了したようです。'); }
    if (expired(c.data)) { await cleanup(ref); await detach(); throw fail('接続が切れたまま2分たったため、ルームを終了しました。'); }
    if (!watch && !own(c.data, s)) { await detach(); throw fail('参加の情報が見つかりません。もう一度参加してね。'); }
    if (!watch) await ensurePresence(c);
    c.attached = true;
    if (ctx === c) onRoomChange(c);
    return c;
  }
  // 在室: players/{id}/connections/{pushId}。切れたら自分の接続だけ消える。進行役は切断の時刻も残す
  async function ensurePresence(c) {
    if (c !== ctx || !online || c.leaving || c.watch) return;
    if (c.pending) return c.pending;
    c.pending = (async () => {
      const s = c.session;
      const connectionRef = c.ref.child(`players/${s.id}/connections`).push();
      await connectionRef.onDisconnect().remove();
      if (c !== ctx || c.leaving || !online) { await connectionRef.onDisconnect().cancel(); return; }
      if (s.role === 'host') await c.ref.onDisconnect().update({ hostConnected: false, hostDisconnectedAt: stamp() });
      const previous = c.connectionRef;
      const result = await transactRetry(c.ref, (room) => {
        if (c !== ctx || c.leaving || !room || expired(room) || !own(room, s)) return;
        const p = room.players[s.id];
        p.connections = Object.assign({}, p.connections || {}, { [connectionRef.key]: true });
        if (s.role === 'host') { room.hostConnected = true; room.hostDisconnectedAt = null; }
        return room;
      });
      if (!result.committed) { await connectionRef.onDisconnect().cancel(); return; }
      c.connectionRef = connectionRef;
      if (previous && previous.key !== connectionRef.key) { await previous.onDisconnect().cancel(); await previous.remove(); }
      c.ready = true;
    })();
    try { await c.pending; } finally { c.pending = null; }
  }

  // ── 画面の切りかえ・おしらせ ──
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + id));
    document.body.classList.toggle('watching', id === 'watch');
    document.body.dataset.role = ['host', 'guest', 'watch'].includes(id) ? id : '';
    if (id !== 'host') stopClock();
  }
  function overlay(title, text, onClose) {
    delete $('overlay').dataset.kind;
    $('overlay-title').textContent = title; $('overlay-text').textContent = text;
    $('overlay-btn').textContent = 'トップへ戻る';
    $('overlay').hidden = false;
    $('overlay-btn').onclick = () => { $('overlay').hidden = true; if (onClose) onClose(); };
  }
  function showAway() {
    if (!$('overlay').hidden && $('overlay').dataset.kind === 'away') return;
    $('overlay').dataset.kind = 'away';
    $('overlay-title').textContent = '進行役の戻りを待っています';
    $('overlay-text').textContent = '通信が切れたようです。2分もどらなければ、このルームは終了します。';
    $('overlay-btn').textContent = ctx && ctx.watch ? 'とじる' : '退出する';
    $('overlay-btn').onclick = () => { $('overlay').hidden = true; delete $('overlay').dataset.kind; if (ctx && !ctx.watch) leaveRoom(); };
    $('overlay').hidden = false;
  }
  function hideAway() { if ($('overlay').dataset.kind === 'away') { $('overlay').hidden = true; delete $('overlay').dataset.kind; } }
  function updateConn() { const el = $('h-conn'); if (!el) return; el.textContent = online ? '接続中' : '通信が切れています'; el.classList.toggle('ok', online); }
  function goTop() { closePicker(); stopClock(); S.room = null; S.role = null; showScreen('top'); }

  // ── 作る・参加する・退出する・閉じる ──
  async function createRoom() {
    await authenticated();
    const token = firebase.auth().currentUser.uid; const id = crypto.randomUUID(); const createdAt = now();
    const date = today();
    const [topicList, noticeList] = await Promise.all([loadTopics(), loadNotices(date)]);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = RoomkRTDB.generateRoomCode(); const ref = db.ref(`${PREFIX}/${code}`);
      const initial = {
        status: 'live', host: id, hostUid: token, hostConnected: false, hostDisconnectedAt: createdAt, createdAt,
        players: { [id]: { name: '進行役', uid: token, isHost: true } },
        code, date, half: new Date().getHours() < 12 ? 'am' : 'pm',
        next: { date: addDays(date, 7), time: '' },
        cur: 'cover', view: 'body', covers: true, topic: pickTopic(topicList, ''), notices: noticeList,
        sel: null, decided: null, tool: null, page: 0, wide: false,
      };
      const result = await transactRetry(ref, (room) => (room ? (room.host === id && room.hostUid === token ? room : undefined) : initial));
      if (!result.committed) continue;
      const s = { code, id, token, role: 'host' };
      saveSession(s);
      await attach(code, s, false);
      return code;
    }
    throw fail('ルームを作れませんでした。もう一度ためしてね。');
  }
  const nameTaken = (room, name) => Object.values(room.persons || {}).some((p) => p.name === name);
  async function joinRoom(codeIn, nameIn) {
    await authenticated();
    const name = validateName(nameIn); const code = validateCode(codeIn);
    const token = firebase.auth().currentUser.uid; const id = crypto.randomUUID();
    const ref = db.ref(`${PREFIX}/${code}`); const warm = await warmRoomCache(ref);
    let reason = '';
    try {
      if (expired(warm.snap.val())) { await cleanup(ref); throw fail('このルームは終了しました。'); }
      const result = await transactRetry(ref, (room) => {
        reason = '';
        if (!room || expired(room)) { reason = 'ルームが見つかりません。終了したようです。'; return; }
        if (room.players && room.players[id] && room.players[id].uid === token) return room;
        if (room.status === 'finished') { reason = 'このルームは、おしまいになったよ。'; return; }
        norm(room);
        if (nameTaken(room, name)) { reason = 'そのニックネームは使われているよ。別の名前にしてね。'; return; }
        if (room.order.length >= MAX_PEOPLE) { reason = `このルームは${MAX_PEOPLE}人まで参加できるよ。`; return; }
        room.players[id] = { name, uid: token, isHost: false };
        addPerson(room, id, name, false);
        return clean(room);
      });
      if (!result.committed) throw fail(reason || '参加できませんでした。もう一度ためしてね。');
      const s = { code, id, token, role: 'guest' };
      saveSession(s);
      await attach(code, s, false);
      return code;
    } finally { warm.release(); }
  }
  function dropPerson(room, pid) {
    delete room.persons[pid]; delete room.heart[pid]; delete room.wants[pid]; delete room.twant[pid]; delete room.sched[pid];
    if (room.players) delete room.players[pid];
    room.order = room.order.filter((x) => x !== pid);
    if (room.sel === pid) room.sel = room.order[0] || null;
  }
  async function leaveRoom() {
    const c = ctx; if (!c) return goTop();
    if (c.watch) { await detach(); return goTop(); }
    c.leaving = true;
    if (c.pending) await c.pending.catch(() => {});
    await RoomkRTDB.cancelRoomOnDisconnect(c.ref);
    const s = c.session;
    try {
      await c.ref.transaction((room) => {
        if (!room || !own(room, s)) return room ? undefined : room;
        if (s.role === 'host') return null;
        norm(room); dropPerson(room, s.id);
        return clean(room);
      }, undefined, false);
    } catch (e) { console.warn(e); }
    await detach();
    saveSession(null);
    goTop();
  }
  async function finishRoom() {
    const c = ctx; if (!c) return;
    if (!confirm('ルームを閉じます。みんなの画面もおしまいになり、入れた内容は消えます。よろしいですか？')) return;
    c.leaving = true;
    if (c.pending) await c.pending.catch(() => {});
    // 消す前に、自分の切断時の予約を取り消す（残すと、消したあとにタブを閉じたときルームの残りができる）
    await RoomkRTDB.cancelRoomOnDisconnect(c.ref);
    try { await c.ref.update({ status: 'finished' }); await new Promise((r) => setTimeout(r, 1500)); await c.ref.remove(); } catch (e) { console.warn(e); }
    await detach(); saveSession(null); goTop();
  }

  // ── ルームを直す（進行役も子どもも、根っこへの transaction で）──
  async function tx(fn) {
    const c = ctx; if (!c || c.watch) return;
    try {
      let skipped = false;
      const result = await transactRetry(c.ref, (room) => {
        if (!room) return;
        norm(room);
        if (fn(room) === false) { skipped = true; return; }
        return clean(room);
      });
      if (!result.committed && !skipped) toast('うまく保存できませんでした。もう一度ためしてね。');
    } catch (e) { toast('通信に失敗しました。もう一度ためしてね。'); console.warn(e); }
  }
  // 答える・予定を入れるなど。子どもは自分の分だけ、進行役はだれの分でも
  function act(kind, body) { return tx((room) => apply(room, kind, body, S.me, S.role === 'host')); }

  // ── 変化への反応 ──
  function onRoomChange(c) {
    const room = c.data;
    if (!room) {
      if (c.leaving) return;
      detach(); saveSession(null);
      overlay('おしまい', 'ルームが閉じられました。', goTop);
      goTop();
      return;
    }
    if (room.status === 'finished' && !c.watch && c.session.role !== 'host') { detach(); saveSession(null); overlay('おしまい', 'きょうの作戦会議は、ここまで。', goTop); goTop(); return; }
    if (!c.watch && !(room.players && room.players[c.session.id])) { detach(); saveSession(null); overlay('ルームから外れました', '進行役が外したか、参加の情報が消えました。もう一度参加できます。', goTop); goTop(); return; }
    if (expired(room)) { cleanup(c.ref).catch(() => {}); return; }
    S.room = norm(room);
    S.code = c.code;
    S.role = c.watch ? 'watch' : c.session.role;
    S.me = c.watch ? null : c.session.id;
    render();
  }

  // ── ほかのファイルから読むもの（読めなければ、手元の予備で進める）──
  // ツールの一覧: ツール一覧のページ（apps/index.html）のカードから作る。「ほかも見る」と進行役の「一覧から選ぶ」に使う
  let catalogReady = null;
  function loadCatalog() {
    if (!catalogReady) {
      catalogReady = (async () => {
        try {
          const html = await (await fetch(APPS + 'index.html', { cache: 'no-store' })).text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const list = [...doc.querySelectorAll('a.app-card')].map((a) => ({
            slug: String(a.getAttribute('href') || '').replace(/\/$/, ''),
            name: (a.querySelector('.app-card__name') || {}).textContent ? a.querySelector('.app-card__name').textContent.trim() : '',
            genre: a.dataset.genre || '', yomi: a.dataset.yomi || '',
            s: String(a.dataset.scenes || '').split(/\s+/).includes('sakusen') ? 1 : 0,
          })).filter((x) => /^[a-z0-9-]+$/.test(x.slug) && x.name);
          if (list.length >= 20) { D.all = list; if (S.room) render(); }
        } catch (e) { /* 読めなければ data.js の写しを使う */ }
      })();
    }
    return catalogReady;
  }
  // チェックインのお題: トークテーマカードのお題を使う
  let topics = null;
  async function loadTopics() {
    if (topics) return topics;
    try {
      const src = await (await fetch(APPS + 'talk-card/app.js', { cache: 'no-store' })).text();
      const start = src.indexOf('const topics = ['); const end = src.indexOf('];', start);
      const list = start < 0 ? [] : [...src.slice(start, end).matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).filter((t) => t.length > 3);
      topics = list.length >= 10 ? list : D.talk;
    } catch (e) { topics = D.talk; }
    return topics;
  }
  const pickTopic = (list, previous) => { const c = list.filter((t) => t !== previous); return c[Math.floor(Math.random() * c.length)] || list[0]; };
  const topicOf = (r) => r.topic || D.talk[0];
  // お知らせ: room-K ポータルの単発実施プログラム。毎朝のタスクが apps/circle-time/daily/once.json に書く
  async function loadNotices(date) {
    try {
      const d = await (await fetch(APPS + 'circle-time/daily/once.json', { cache: 'no-store' })).json();
      const text = (v, n) => String(v || '').slice(0, n);
      return (Array.isArray(d.items) ? d.items : [])
        .filter((it) => it && /^\d{4}-\d{2}-\d{2}$/.test(it.date) && it.date >= date && it.name)
        .slice(0, 12)
        .map((it) => ({ date: it.date, start: text(it.start, 5), end: text(it.end, 5), name: text(it.name, 60), place: text(it.place, 24), cat: text(it.cat, 16) }));
    } catch (e) { return []; }
  }

  // ── チャット用の文（絵文字なしの素の文。Zoom や Meet のチャットに貼る）──
  function chatText(r) {
    const st = stepOf(r.cur);
    const link = RoomkRTDB.roomLink(S.code);
    if (st.id === 'cover') return `作戦会議に入るリンク\n${link}`;
    if (st.id === 'checkin') return `【チェックイン】\n${topicOf(r)}\n声・チャット、どちらでもOK。パスもOK`;
    if (st.id === 'agenda') return '【きょうの流れ】\n' + STEPS.filter((x) => x.sec && !r.skip[x.id]).map((x, i) => `${i + 1} ${x.name}`).join('\n');
    if (st.id === 'heart') return '【ジブンチェック】いまの気持ちは？\n' + D.heart.map((h) => `${h.n} ${h.label}`).join('\n') + '\n数字で教えてね。パスもOK';
    if (st.id === 'menu') {
      if (r.tool) return r.tool.join ? `${r.tool.name}に入るリンク\n${r.tool.join}` : `きょうは「${r.tool.name}」をするよ`;
      if (r.decided) {
        const m = D.menu.find((x) => x.key === r.decided); const all = decidedTools(r).slice(0, 8);
        return `きょうは「${m.label}」` + (all.length ? '\nどれにする？\n' + all.map((t) => `・${t.name}`).join('\n') : '\nしたいことを聞かせてね');
      }
      return '【今日は何する？】\n' + D.menu.map((m, i) => `${i + 1} ${m.label}`).join('\n') + '\n数字で教えてね';
    }
    if (st.id === 'plan') return `【予定の確認】\nこれから1週間の予定を教えてね。\n自分で入れるときはここから\n${link}`;
    const list = notices(r).map((n) => `・${fmtDay(n.date)} ${n.start}〜${n.end} ${n.name}${n.place ? '（' + n.place + '）' : ''}`);
    return '【お知らせ】' + (list.length ? '\n' + list.join('\n') : '') + (r.next.date ? `\n次回は ${fmtDay(r.next.date)} ${timeText(r.next.time)}` : '');
  }

  // ── 進行役の時計（いまの時刻と、はじめてからの時間。みんなにみせる画面には出さない）──
  let clockTimer = null;
  function tickClock() {
    if (!S.room) return;
    $('h-clock').textContent = new Intl.DateTimeFormat('ja-JP', { hour: 'numeric', minute: '2-digit' }).format(new Date());
    const min = Math.max(0, Math.floor((now() - (S.room.createdAt || now())) / 60000));
    $('h-elapsed').textContent = `はじめて ${min}分`;
  }
  function startClock() { if (clockTimer) return; tickClock(); clockTimer = setInterval(tickClock, 20000); }
  function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }

  // ── ルームの状態を変える（transaction の中で動く。room はサーバーのいまの値）────────
  const stepOf = (id) => STEPS.find((s) => s.id === id);
  const onBody = (room, id) => room.cur === id && room.view === 'body';
  const onCover = (room) => !!stepOf(room.cur).sec && room.view === 'cover';
  function cellItems(room, pid, cell) {
    const p = room.sched[pid] || (room.sched[pid] = {});
    return p[cell] || (p[cell] = []);
  }
  function chipColor(t) {
    const all = [].concat(D.chips.plan, D.chips.planSchool, D.chips.todo, D.chips.todoSchool);
    const hit = all.find((c) => c.t === t);
    return hit ? hit.c : 'w';
  }
  function syncSakusen(room) {
    // 次回の作戦会議を、表のその日に入れておく（いまのスライドと同じ）
    const idx = days(room).indexOf(room.next.date);
    const row = room.next.time ? (Number(room.next.time.split(':')[0]) < 12 ? 'am' : 'pm') : room.half;
    room.order.forEach((pid) => {
      const p = room.sched[pid] || (room.sched[pid] = {});
      Object.keys(p).forEach((c) => { p[c] = p[c].filter((it) => it.c !== 'k'); });
      if (idx >= 0) cellItems(room, pid, idx + '-' + row).unshift({ t: '作戦会議', c: 'k' });
    });
  }
  function addPerson(room, pid, name, proxy) {
    if (room.persons[pid] || room.order.length >= MAX_PEOPLE) return false;
    room.persons[pid] = { name: String(name).trim().slice(0, 8) || 'ななし', proxy: !!proxy, school: false };
    room.order.push(pid);
    if (!room.sel) room.sel = pid;
    syncSakusen(room);
    return true;
  }
  function apply(r, kind, b, from, isHost) {
    // 子どもは自分の分だけ・いま出ている画面だけ
    if (!isHost && b.pid !== from) return false;
    if (!r.persons[b.pid]) return false;
    if (kind === 'heart') {
      if (!onBody(r, 'heart')) return false;
      if (b.toggle && r.heart[b.pid] === b.val) delete r.heart[b.pid]; else r.heart[b.pid] = b.val;
      return true;
    }
    // 子どもが押しても、みんなの画面は切りかわらない（急に変わると戸惑う。2026-11-12 オーナー）。
    // 「これがいい」を進行役に伝えるだけで、決めるのは進行役
    if (kind === 'want') {
      if (!onBody(r, 'menu') || r.decided || r.tool || !D.menu.some((m) => m.key === b.key)) return false;
      if (r.wants[b.pid] === b.key) delete r.wants[b.pid]; else r.wants[b.pid] = b.key;
      return true;
    }
    if (kind === 'twant') {
      if (!onBody(r, 'menu') || !r.decided || r.tool) return false;
      const t = decidedTools(r, true)[Number(b.i)];
      if (!t) return false;
      if (r.twant[b.pid] && r.twant[b.pid].href === t.href) delete r.twant[b.pid]; else r.twant[b.pid] = { name: t.name, href: t.href };
      return true;
    }
    if (kind === 'cellAdd') {
      if (!onBody(r, 'plan')) return false;
      const items = cellItems(r, b.pid, b.cell);
      const t = String(b.t || '').trim().slice(0, 12);
      if (!t || items.length >= MAX_ITEMS || items.some((it) => it.t === t)) return false;
      items.push({ t, c: chipColor(t) });
      return true;
    }
    if (kind === 'cellMove') {
      if (!onBody(r, 'plan') || b.from === b.to) return false;
      const src = cellItems(r, b.pid, b.from); const dst = cellItems(r, b.pid, b.to);
      const i = src.findIndex((it) => it.t === b.t);
      if (i < 0 || src[i].c === 'k' || dst.length >= MAX_ITEMS || dst.some((it) => it.t === b.t)) return false;
      dst.push(src.splice(i, 1)[0]);
      return true;
    }
    if (kind === 'cellDel') {
      if (!onBody(r, 'plan')) return false;
      const items = cellItems(r, b.pid, b.cell);
      const i = items.findIndex((it) => it.t === b.t);
      if (i < 0) return false;
      items.splice(i, 1);
      return true;
    }
    return false;
  }

  // 進行役だけの操作
  const active = (room) => STEPS.filter((s) => !room.skip[s.id] || s.id === room.cur);
  function go(dir) {
    return tx((r) => {
      const st = stepOf(r.cur);
      if (dir > 0 && st.sec && r.view === 'cover') { r.view = 'body'; return true; }
      if (dir < 0 && st.sec && r.view === 'body' && r.covers !== false) { r.view = 'cover'; return true; }
      const list = active(r); const i = list.findIndex((s) => s.id === r.cur) + dir;
      if (i < 0 || i >= list.length) return false;
      r.cur = list[i].id;
      r.view = dir > 0 && list[i].sec && r.covers !== false ? 'cover' : 'body';
      return true;
    });
  }
  function jump(id) { return tx((r) => { r.cur = id; r.view = stepOf(id).sec && r.covers !== false ? 'cover' : 'body'; }); }
  // おまかせ: 作戦会議向けのツール（ツール一覧の利用シーンに「作戦会議」があるもの）から3つ
  function drawOmakase(r) {
    const all = D.all.filter((t) => t.s).map(appTool);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = all[i]; all[i] = all[j]; all[j] = x; }
    r.omakase = all.slice(0, 3);
  }
  // 「ほかも見る」で足す範囲（ツール一覧の種類）。ここにないもの（おまかせ・したいことがある）は全ツール
  const WIDE = { game: ['kotoba', 'puzzle', 'suiri', 'atekko', 'board'], talk: ['talk'], self: ['talk'], study: ['kotoba', 'puzzle'] };
  const appTool = (t) => ({ name: t.name, href: APPS + t.slug + '/' });
  function decidedTools(r, wide) {
    if (!r.decided) return [];
    const base = r.decided === 'omakase' ? r.omakase : D.menu.find((m) => m.key === r.decided).tools;
    if (!(wide === undefined ? r.wide : wide)) return base;
    const g = WIDE[r.decided];
    return base.concat(D.all.filter((t) => !g || g.includes(t.genre)).map(appTool).filter((t) => !base.some((x) => x.href === t.href)));
  }
  // 進行役が名前で探す（ひらがな・カタカナ・読みのどれでも）
  const kana = (v) => String(v || '').toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s　！!？?・、。]/g, '');
  function findTools(q) {
    const k = kana(q);
    return k ? D.all.filter((t) => kana(t.name).includes(k) || kana(t.yomi).includes(k)).slice(0, 8) : [];
  }
  // 候補のカード: ツール一覧と同じイラスト（外部のサイトなど、絵のないものはアイコン）
  const PER = 4; // みんなの画面に一度に並ぶ枚数
  function toolArt(t) {
    const m = t.ext ? null : String(t.href).match(/^\.\.\/([a-z0-9-]+)\/$/);
    const img = m ? `<img src="${APPS}assets/illustrations/${esc(m[1])}.webp" alt="" onerror="this.remove()" />` : '';
    return `<span class="ti">${ic(t.icon || 'extension')}${img}</span>`;
  }
  function toolStart(r) {
    const n = decidedTools(r).length;
    if (n <= PER) return 0;
    const pages = Math.ceil(n / PER);
    return Math.min(((r.page || 0) % pages) * PER, n - PER);
  }
  function pickTool(r, i) {
    const t = decidedTools(r)[i];
    if (!t) return false;
    r.tool = { name: t.name, href: t.href, ext: !!t.ext, icon: t.icon || '' };
    return true;
  }
  function removePerson(pid) { return tx((r) => { if (!r.persons[pid]) return false; dropPerson(r, pid); }); }

  // ══════════════════════════════════════════════
  // みんなにみせる画面（1280×720 の舞台）
  // ══════════════════════════════════════════════
  const nm = (r, pids) => pids.map((pid) => `<span class="nm">${esc(r.persons[pid].name)}</span>`).join('');
  const hills = () => '';
  function kicker(st) {
    return `<p class="pp kick zm"><span class="kick__art">${motif(st.motif)}</span>${esc(st.name)}${st.sec ? `<small>${esc(st.sec)}／4</small>` : ''}</p>`;
  }

  function slOpening(r) {
    const secs = STEPS.filter((x) => x.sec && !r.skip[x.id]).map((x, i) => `<li><span class="no">${i + 1}</span><span class="art">${motif(x.motif)}</span>${esc(x.name)}</li>`).join('');
    return `<div class="opening zm"><p class="datetag">${dateTag(r.date)}</p>
      <h1 class="op"><span class="lead">自分だけの小さなチャレンジ！</span><span class="main">作戦会議</span></h1>
      <ul class="memos">${secs}</ul>
      <p class="code">ルームコード<b>${esc(r.code)}</b></p></div>`;
  }
  // コーナーの表紙: 表紙と同じく真ん中にそろえる（番号の札・しるし・見出し・ひとこと）
  function slCover(st) {
    return `<div class="seccv zm"><p class="of">${esc(st.sec)}<small>／4</small></p><div class="cvart">${motif(st.motif)}</div>
      <h1>${esc(st.name)}</h1><p class="d">${esc(st.desc)}</p></div>`;
  }
  function slCheckin(r) {
    const q = topicOf(r);
    return `${hills()}${kicker(stepOf('checkin'))}
      <div class="pp odai zm${[...q].length > 16 ? ' long' : ''}"><p>${esc(q)}</p></div>
      <div class="pp odai-art">${motif('talk')}</div>
      <p class="foot">声・チャット、どちらでもOK。パスもOK</p>`;
  }
  function slAgenda(r) {
    const curIdx = STEPS.findIndex((s) => s.id === r.cur);
    const secs = STEPS.filter((s) => s.sec && !r.skip[s.id]);
    const rows = secs.map((s, i) => `<li class="pp${STEPS.indexOf(s) < curIdx ? ' done' : ''}"><span class="no">${i + 1}</span><span class="t">${esc(s.name)}</span><span class="art">${motif(s.motif)}</span></li>`).join('');
    return `${hills()}<h1 class="agh zm"><small>作戦会議</small>きょうの流れ</h1><ol class="ag zm">${rows}</ol>`;
  }
  function slHeart(r) {
    const rows = D.heart.map((h) => `<li class="pp"><span class="no zm" style="background:${esc(h.tone)}">${esc(h.n)}</span>${ic(h.face)}<span class="t zm">${esc(h.label)}</span><span class="nms">${nm(r, r.order.filter((pid) => r.heart[pid] === h.n))}</span></li>`).join('');
    const pass = r.order.filter((pid) => r.heart[pid] === 'pass');
    return `${kicker(stepOf('heart'))}<h1 class="q zm">いまの気持ちは？</h1><ol class="lv">${rows}</ol>
      <p class="foot">${pass.length ? `<span class="passed">パス${nm(r, pass)}</span>` : ''}${FOOT}</p>`;
  }
  const wishers = (r, href) => r.order.filter((pid) => r.twant[pid] && r.twant[pid].href === href);
  function slMenu(r) {
    if (r.decided || r.tool) {
      const m = D.menu.find((x) => x.key === r.decided);
      const all = decidedTools(r); const start = toolStart(r);
      const head = `${kicker(stepOf('menu'))}<h1 class="dq zm"><span class="pre">きょうは</span>${esc(m ? m.label : 'これ！')}</h1>`;
      // ツールは進行役が開く。ルームに入るリンクを送ったら、子どもは自分の画面から入る
      if (r.tool) return `${head}<div class="tpick">${toolArt(r.tool)}<div class="zm"><p class="lead">これを使おう</p><p class="nm1">${esc(r.tool.name)}</p>
        <p class="how">${r.tool.join ? `自分の画面の「${esc(r.tool.name)}に入る」を押してね` : '進行役がひらくよ。画面を見ててね'}</p></div></div>`;
      if (!all.length) return `${head}<div class="tpick"><span class="ti">${motif(m.motif)}</span><div class="zm"><p class="nm1 small">したいことを聞かせてね</p></div></div>`;
      const cards = all.slice(start, start + PER).map((t) => `<li>${toolArt(t)}<span class="tn zm">${esc(t.name)}</span><span class="nms">${nm(r, wishers(r, t.href))}</span></li>`).join('');
      const more = all.length > PER ? `<p class="tmore zm">${start + 1}〜${Math.min(start + PER, all.length)}／${all.length}　ほかにもあるよ</p>` : '';
      return `${head}<ul class="trow n${Math.min(all.length, PER)}">${cards}</ul>${more}`;
    }
    const cards = D.menu.map((m, i) => `<li class="pp c${i % 3}"><span class="no zm">${i + 1}</span><span class="art">${motif(m.motif)}</span><span class="t zm">${esc(m.label)}</span><span class="nms">${nm(r, r.order.filter((pid) => r.wants[pid] === m.key))}</span></li>`).join('');
    return `${kicker(stepOf('menu'))}<h1 class="q zm">やりたいのは、どれ？</h1><ul class="mn">${cards}</ul><p class="foot">${FOOT}</p>`;
  }
  function slPlan(r, edit) {
    const pid = r.sel && r.persons[r.sel] ? r.sel : null;
    if (!pid) return `${kicker(stepOf('plan'))}<h1 class="q zm">これからの予定</h1><p class="none">参加する人の名前を足すと、表が出るよ</p>`;
    const tabs = r.order.length > 1 ? `<p class="tabs zm">${r.order.map((p) => `<span class="${p === pid ? 'on' : ''}">${esc(r.persons[p].name)}</span>`).join('')}</p>` : '';
    const head = days(r).map((d) => { const p = parts(d); return `<p class="dh zm${p.rest ? ' rest' : ''}${d === r.next.date ? ' next' : ''}"><small>${p.m}/</small>${p.d}<span class="wd">${p.w}</span></p>`; }).join('');
    const body = ROWS.map((row) => `<p class="rh zm">${esc(row.name)}</p>` + days(r).map((d, di) => {
      const cell = di + '-' + row.id;
      const items = (r.sched[pid] && r.sched[pid][cell]) || [];
      const inner = items.map((it) => `<span class="st st-${esc(it.c || 'w')}"${edit && it.c !== 'k' ? ` data-drag="${esc(it.t)}"` : ''}>${esc(it.t)}</span>`).join('');
      return edit
        ? `<button type="button" class="cell" data-act="cell" data-pid="${esc(pid)}" data-cell="${esc(cell)}" aria-label="${esc(fmtDay(d) + ' ' + row.name)}">${inner || ic('add')}</button>`
        : `<div class="cell">${inner}</div>`;
    }).join('')).join('');
    return `${kicker(stepOf('plan'))}<h1 class="q small zm"><span class="lead">${esc(r.persons[pid].name)}さんの</span><span class="big">これからの予定</span></h1>${tabs}
      <div class="tb"><p></p>${head}${body}</div>`;
  }
  // きょうから先の、その日だけのプログラム（日付の早い順）
  const notices = (r) => r.notices.filter((n) => n.date >= r.date).sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
  function slNews(r) {
    const list = notices(r).slice(0, 3);
    const items = list.map((it, i) => { const p = parts(it.date); return `<li class="pp"><p class="dy zm c${i % 3}"><small>${p.m}/</small>${p.d}<span class="wd">${p.w}</span></p>
      <div class="bd"><p class="t zm${[...it.name].length > 18 ? ' long' : ''}">${esc(it.name)}</p><p class="mt">${ic('schedule')}${esc(it.start)}〜${esc(it.end)}${it.place ? ic('location_on') + esc(it.place) : ''}${it.cat ? `<span class="cat">${esc(it.cat)}</span>` : ''}</p></div></li>`; }).join('');
    const next = r.next.date ? `<div class="pp nextcard zm"><p class="pre">次回は</p><p class="dt">${dateTag(r.next.date)}</p>${r.next.time ? `<p class="tm">${esc(timeText(r.next.time))}</p>` : ''}</div>` : '';
    return `${hills()}${kicker(stepOf('news'))}<h1 class="q small zm"><span class="lead">room-K ポータルから</span><span class="big">この日だけのプログラム</span></h1>
      ${list.length ? `<ul class="pg">${items}</ul>` : '<p class="none">いまのところ、この日だけのプログラムはないよ</p>'}${next}`;
  }
  function slide(r, edit) {
    const st = stepOf(r.cur);
    if (onCover(r)) return `<div class="sl sl--seccover">${slCover(st)}</div>`;
    const html = ({ cover: slOpening, checkin: slCheckin, agenda: slAgenda, heart: slHeart, menu: slMenu, plan: slPlan, news: slNews })[st.id](r, edit);
    return `<div class="sl sl--${st.id}">${html}</div>`;
  }
  // 横に送る列・格子の送り位置を、描きなおしでも保つ。sig が同じ（同じ画面・同じ並び）ときだけ戻す
  const scrollMemo = {};
  function keepScroll(box, sig, draw) {
    const sel = '.tscroll, .tgrid';
    const before = [...box.querySelectorAll(sel)].map((el) => [el.scrollLeft, el.scrollTop]);
    draw();
    const same = scrollMemo[box.id] === sig;
    scrollMemo[box.id] = sig;
    if (!same) return;
    [...box.querySelectorAll(sel)].forEach((el, i) => { if (before[i]) { el.scrollLeft = before[i][0]; el.scrollTop = before[i][1]; } });
  }
  function fit() {
    document.querySelectorAll('.sl-wrap').forEach((w) => {
      const sl = w.querySelector('.sl');
      if (sl && w.clientWidth) sl.style.transform = 'scale(' + (w.clientWidth / 1280) + ')';
    });
  }

  // ══════════════════════════════════════════════
  // 進行役の画面
  // ══════════════════════════════════════════════
  function hostOps(r) {
    const st = stepOf(r.cur);
    // だれもいないままでは、ジブンチェックと予定の確認に入れられない。その場で名前を足せるようにする
    const noOne = !r.order.length ? `<form class="h-noone" data-form="add2"><p class="h-label">${ic('person_add')}参加する人がまだいない</p>
      <p class="h-hint">子どもがリンクから入るのを待つか、ここで名前を足す（端末のない子の分は、進行役が代わりに入れる）。</p>
      <div class="h-row"><input class="form-input" data-keep="add2" type="text" maxlength="10" autocomplete="off" placeholder="子どもの名前" aria-label="足す人の名前" />
      <button type="submit" class="btn btn-secondary">足す</button></div></form>` : '';
    if (noOne && !onCover(r) && ['cover', 'heart', 'plan'].includes(st.id)) return noOne;
    if (onCover(r)) return '<p class="h-hint">コーナーの表紙。「次へ」で中身へ進む。</p>';
    if (st.id === 'cover') return '<p class="h-hint">子どもが入るのを待つ。URL から入れない子は、右の「参加する人」に名前を足す。</p>';
    if (st.id === 'checkin') {
      return `<div class="h-opsrow"><button type="button" class="btn btn-secondary" data-act="talk">${ic('refresh')}別のお題にする</button>
        <a class="btn btn-ghost" href="${APPS}talk-card/" target="_blank" rel="noopener">トークテーマカードを開く${ic('open_in_new')}</a></div>`;
    }
    if (st.id === 'agenda') return '<p class="h-hint">きょうの流れ。飛ばすコーナーは、左の一覧の目の印で外せる。</p>';
    if (st.id === 'heart') return '<p class="h-hint">声やチャットで答えた子の分は、右の名前の横の数字を押して入れる。</p>';
    if (st.id === 'menu') {
      const m = D.menu.find((x) => x.key === r.decided);
      const bar = m ? `<div class="h-decided"><p><span>きょうやること</span><b>${esc(m.label)}</b></p>
        <button type="button" class="btn btn-secondary" data-act="undecide">${ic('swap_horiz')}ほかのものに変える</button></div>` : '';
      // 使うものが決まったあと: 進行役が開いて、ルームに入るリンクをみんなに送る
      if (r.tool) {
        const t = r.tool;
        const manual = `<details class="h-manual" data-keep-open="join"><summary>リンクが出ないときは、貼って送る</summary>
          <form class="h-join" data-form="join"><div class="h-row"><input class="form-input" data-keep="join" type="url" autocomplete="off" placeholder="参加用のリンクを貼る" aria-label="参加用のリンク" />
          <button type="submit" class="btn btn-secondary">${ic('send')}送る</button></div><p class="h-ext__msg" role="alert" hidden></p></form></details>`;
        let share;
        if (t.join) share = `<p class="h-sent">${ic('check_circle')}参加用のリンクを送った${t.code ? `（ルーム ${esc(t.code)}）` : ''}。子どもの画面に「${esc(t.name)}に入る」が出ている。<button type="button" class="h-link" data-act="unjoin">取り消す</button></p>`;
        else if (t.ext) share = `<button type="button" class="btn btn-secondary" data-act="sendhref">${ic('send')}このリンクをみんなに送る</button>`;
        else if (openedHref === t.href) share = `<p class="h-wait">${ic('hourglass_top')}開いたタブでルームを作ると、参加用のリンクが自動でみんなの画面に出る。ルームを作らないツールは、このまま画面を共有する。</p>${manual}`;
        else share = `<p class="h-hint h-hint--gap">開いてルームを作るだけで、参加用のリンクが自動でみんなの画面に出る。</p>`;
        const open = t.ext
          ? `<a class="btn btn-primary" href="${esc(t.href)}" target="_blank" rel="noopener">${esc(t.name)}を開く${ic('open_in_new')}</a>`
          : `<button type="button" class="btn btn-primary" data-act="open">${esc(t.name)}を開く${ic('open_in_new')}</button>`;
        return `${bar}<div class="h-chosen">${toolArt(t)}<p><span>使うもの</span><b>${esc(t.name)}</b></p>${open}
          <button type="button" class="btn btn-ghost" data-act="untool">${ic('undo')}${m ? '候補にもどす' : 'やめる'}</button></div>${share}`;
      }
      // ツールの一覧から選ぶ: 名前を知らなくても、種類ごとにイラストを見て選べる
      const tabs = [['s', '作戦会議向け'], ['kotoba', 'ことば'], ['puzzle', 'パズル'], ['suiri', '推理'], ['atekko', '当てっこ'], ['board', 'ボード'], ['talk', 'トーク'], ['all', 'ぜんぶ']];
      const list = D.all.filter((t) => (browse.tab === 'all' || (browse.tab === 's' ? t.s : t.genre === browse.tab)));
      const find = `<div class="h-find"><button type="button" class="h-fold" data-act="browse" aria-expanded="${browse.open}">${ic(browse.open ? 'expand_less' : 'apps')}ツールの一覧から選ぶ<small>${D.all.length}こ</small></button>
        ${browse.open ? `<div class="h-tabs" role="group" aria-label="種類">${tabs.map(([k, label]) => `<button type="button" data-act="btab" data-tab="${k}" aria-pressed="${browse.tab === k}">${label}</button>`).join('')}</div>
        <div class="tgrid">${list.map((t) => `<button type="button" data-act="find" data-slug="${esc(t.slug)}">${toolArt(appTool(t))}<span class="tn">${esc(t.name)}</span></button>`).join('')}</div>
        <p class="h-label h-label--gap">名前がわかるときは、探す</p>
        <input id="h-q" class="form-input" data-keep="q" type="search" autocomplete="off" placeholder="ツールの名前（ひらがなでもOK）" aria-label="ツールの名前で探す" />
        <div id="h-qres" class="tscroll"></div>` : ''}</div>`;
      const whoWant = (key) => r.order.filter((pid) => r.wants[pid] === key).map((pid) => `<small>${esc(r.persons[pid].name)}</small>`).join('');
      if (!m) {
        return `<p class="h-label">きょうやることを決める（子どもがえらぶと、名前が出る。決めるのは進行役）</p><div class="h-seg">${D.menu.map((x, i) => `<button type="button" data-act="decide" data-key="${esc(x.key)}"><b>${i + 1}</b>${esc(x.label)}${whoWant(x.key)}</button>`).join('')}</div>${find}`;
      }
      const all = decidedTools(r);
      // 子どもがえらんだもの（候補にないものも、ここに出る）
      const wished = [];
      r.order.forEach((pid) => { const w = r.twant[pid]; if (w && !wished.some((x) => x.href === w.href)) wished.push(w); });
      const wishRow = wished.length ? `<p class="h-label">子どもがえらんだもの（押すと決まる）</p><div class="tscroll tscroll--wish">${wished.map((t) => `<button type="button" data-act="pickhref" data-href="${esc(t.href)}">${toolArt(t)}<span class="tn">${esc(t.name)}</span><span class="who">${wishers(r, t.href).map((pid) => esc(r.persons[pid].name)).join('・')}</span></button>`).join('')}</div>` : '';
      const wideLabel = r.decided === 'game' ? 'ほかのゲームも見せる' : 'ほかのツールも見せる';
      const more = (r.wide ? '' : `<button type="button" class="btn btn-secondary" data-act="wide">${ic('apps')}${wideLabel}</button>`)
        + (r.decided === 'omakase' && !r.wide ? `<button type="button" class="btn btn-ghost" data-act="redraw">${ic('refresh')}ほかの3つにする</button>` : '')
        + (all.length > PER ? `<span class="h-pager"><span class="lbl">共有している画面に出す4枚</span><button type="button" class="btn btn-ghost" data-act="page" data-dir="-1">${ic('arrow_back')}前の4枚</button>
          <b>${toolStart(r) + 1}〜${Math.min(toolStart(r) + PER, all.length)}／${all.length}</b>
          <button type="button" class="btn btn-ghost" data-act="page" data-dir="1">次の4枚${ic('arrow_forward')}</button></span>` : '');
      // 学習するは、e-board のほかの学習サイトも、リンクを貼れば使える
      const ext = r.decided === 'study' ? `<form class="h-ext" data-form="ext"><p class="h-label">ほかの学習サイトを使う</p>
        <div class="h-row"><input class="form-input" data-keep="extName" type="text" maxlength="16" autocomplete="off" placeholder="名前" aria-label="学習サイトの名前" />
        <input class="form-input" data-keep="extUrl" type="url" autocomplete="off" placeholder="リンクを貼る" aria-label="学習サイトのリンク" />
        <button type="submit" class="btn btn-secondary">これを使う</button></div><p class="h-ext__msg" role="alert" hidden></p></form>` : '';
      return `${bar}${wishRow}<p class="h-label${wished.length ? ' h-label--gap' : ''}">候補（押すと決まる）${all.length ? `　${all.length}こ` : ''}</p>
        ${all.length ? `<div class="tscroll">${all.map((t, i) => `<button type="button" data-act="tool" data-i="${i}">${toolArt(t)}<span class="tn">${esc(t.name)}</span></button>`).join('')}</div>` : '<p class="h-hint">したいことを聞いて、そのまま進める。ツールを使うときは、下から選ぶ。</p>'}
        <div class="h-opsrow">${more}</div>${find}${ext}`;
    }
    if (st.id === 'plan') {
      if (!r.sel || !r.persons[r.sel]) return '<p class="h-hint">右の「参加する人」に名前を足すと、表が出る。</p>';
      const p = r.persons[r.sel];
      return `<p class="h-label">だれの表を出す？（みんなの画面も切りかわる）</p>
        <div class="h-seg">${r.order.map((pid) => `<button type="button" data-act="sel" data-pid="${esc(pid)}" class="${pid === r.sel ? 'on' : ''}">${esc(r.persons[pid].name)}</button>`).join('')}</div>
        <label class="h-check"><input type="checkbox" data-act="school" data-pid="${esc(r.sel)}"${p.school ? ' checked' : ''} />${esc(p.name)}さんの選択肢に、学校の予定も出す</label>
        <p class="h-hint">上の表のマスを押すと、${esc(p.name)}さんの予定を入れられる。ふせんは、つかんで別のマスへ動かせる。</p>`;
    }
    return '<p class="h-hint">次回の日と時刻は、右の「次回の日」で直せる。</p>';
  }
  // ── ツールのタブ: ここから開いたタブ（同じサイト）の sessionStorage から、作ったルームのコードを拾って、
  //    参加用のリンクを自動でみんなに送る（サークルタイムと同じやり方。進行役がリンクを貼らなくてよい）──
  let toolWin = null;
  let toolPoll = null;
  let openedHref = null;
  const browse = { open: false, tab: 's' }; // 進行役の「ツールの一覧から選ぶ」の開き具合と種類（この画面の中だけ）
  // その sessionStorage に入っているルームのコードをぜんぶ拾う
  function roomCodes(ss) {
    const found = new Set();
    for (let i = 0; i < ss.length; i++) {
      const key = ss.key(i);
      if (key === KEY) continue; // この作戦会議の記録は除く（開いたタブには、このタブの sessionStorage が写る）
      let v; try { v = JSON.parse(ss.getItem(key)); } catch (e) { continue; }
      if (!v || typeof v !== 'object') continue;
      const code = String(v.roomCode || v.code || v.roomId || '').toUpperCase();
      if (/^[A-Z0-9]{6}$/.test(code)) found.add(code);
    }
    return found;
  }
  function openTool() {
    const t = S.room.tool;
    if (!t || t.ext) return;
    const href = t.href;
    try { toolWin = window.open(new URL(href, location.href).href, 'roomk-sakusen-tool'); } catch (e) { toolWin = null; }
    if (!toolWin) { toast('ツールのタブを開けませんでした。ブラウザがポップアップを止めていないか確かめてね。'); return; }
    openedHref = href;
    // 開いた時点でもう入っているコードは、前に作ったルームのもの（このタブや、前に開いたツールのタブに残っている）。
    // それを送ると、進行役がルームを作る前に子どもが入れてしまう（2026-11-12 オーナーの指摘）。
    // 開いたあとに新しく増えたコードだけを、いま作ったルームとして送る
    let before = new Set();
    try { before = roomCodes(toolWin.sessionStorage); } catch (e) { try { before = roomCodes(sessionStorage); } catch (e2) { before = new Set(); } }
    clearInterval(toolPoll);
    const t0 = Date.now();
    toolPoll = setInterval(() => {
      const r = S.room;
      if (!toolWin || toolWin.closed || !r || !r.tool || r.tool.href !== href || Date.now() - t0 > 30 * 60 * 1000) { clearInterval(toolPoll); toolPoll = null; return; }
      let code = null;
      try {
        if (!toolWin.location.pathname.endsWith(new URL(href, location.href).pathname)) return;
        code = [...roomCodes(toolWin.sessionStorage)].find((c) => !before.has(c)) || null;
      } catch (e) { return; }
      if (!code || r.tool.code === code) return;
      const join = new URL(href + '?room=' + code, location.href).href;
      tx((room) => { if (!room.tool || room.tool.href !== href) return false; room.tool.code = code; room.tool.join = join; });
    }, 1000);
    renderHost();
  }
  function fillSearch() {
    const el = $('h-q'); const box = $('h-qres');
    if (!el || !box) return;
    const res = findTools(el.value);
    setHTML(box, res.map((t) => `<button type="button" data-act="find" data-slug="${esc(t.slug)}">${toolArt(appTool(t))}<span class="tn">${esc(t.name)}</span></button>`).join('')
      || (el.value.trim() ? '<p class="h-hint">見つからない。ほかの言い方で探す。</p>' : ''));
  }
  function personAnswers(r, pid) {
    if (onBody(r, 'heart')) {
      return `<div class="h-ans">${D.heart.map((h) => `<button type="button" data-act="ans-heart" data-pid="${esc(pid)}" data-val="${h.n}" aria-pressed="${r.heart[pid] === h.n}">${h.n}</button>`).join('')}<button type="button" class="wide" data-act="ans-heart" data-pid="${esc(pid)}" data-val="pass" aria-pressed="${r.heart[pid] === 'pass'}">パス</button></div>`;
    }
    return '';
  }
  function renderHost() {
    const r = S.room; const list = active(r); const st = stepOf(r.cur);
    const i = list.findIndex((s) => s.id === r.cur);
    $('h-code').textContent = S.code;
    updateConn(); startClock(); tickClock();
    setHTML($('h-preview'), slide(r, true));
    const nextName = onCover(r) ? st.name : (list[i + 1] ? list[i + 1].name + (list[i + 1].sec && r.covers !== false ? '（表紙）' : '') : 'おわり');
    setHTML($('h-now'), `<span>いま</span><b>${esc(st.name)}${onCover(r) ? '（表紙）' : ''}</b><span>つぎ</span><em>${esc(nextName)}</em>`);
    $('h-prev').disabled = i === 0 && !(st.sec && r.view === 'body' && r.covers !== false);
    $('h-covers').checked = r.covers !== false;
    $('h-next').disabled = i === list.length - 1 && r.view === 'body';
    const keep = {};
    $('h-ops').querySelectorAll('input[data-keep]').forEach((el) => { keep[el.dataset.keep] = { v: el.value, f: document.activeElement === el }; });
    const openKeep = {};
    $('h-ops').querySelectorAll('details[data-keep-open]').forEach((el) => { openKeep[el.dataset.keepOpen] = el.open; });
    keepScroll($('h-ops'), [r.cur, r.view, r.decided, r.wide, !!r.tool, browse.open, browse.tab].join('|'), () => setHTML($('h-ops'), hostOps(r)));
    $('h-ops').querySelectorAll('details[data-keep-open]').forEach((el) => { if (openKeep[el.dataset.keepOpen]) el.open = true; });
    $('h-ops').querySelectorAll('input[data-keep]').forEach((el) => { const k = keep[el.dataset.keep]; if (k) { el.value = k.v; if (k.f) el.focus(); } });
    fillSearch();
    setHTML($('h-steps'), STEPS.map((s) => `<li class="${s.id === r.cur ? 'cur' : ''}${r.skip[s.id] ? ' skip' : ''}">
      <button type="button" class="go" data-act="jump" data-id="${esc(s.id)}"><span class="no">${s.sec || ''}</span>${esc(s.name)}</button>
      ${s.id === 'cover' ? '' : `<button type="button" class="eye" data-act="skip" data-id="${esc(s.id)}" aria-pressed="${!!r.skip[s.id]}" aria-label="${esc(s.name)}を飛ばす">${ic(r.skip[s.id] ? 'visibility_off' : 'visibility')}</button>`}</li>`).join(''));
    const answering = onBody(r, 'heart') ? r.heart : null;
    $('h-count').textContent = answering && r.order.length ? `答えた ${r.order.filter((p) => answering[p] !== undefined).length}／${r.order.length}人` : '';
    setHTML($('h-people'), r.order.map((pid) => {
      const p = r.persons[pid];
      const live = !!(r.players[pid] && r.players[pid].connections);
      return `<li><p class="who"><b>${esc(p.name)}</b><small>${p.proxy ? '端末なし' : (live ? '自分の端末' : '自分の端末（つながっていない）')}</small></p>${personAnswers(r, pid)}
        <button type="button" class="icon-btn" data-act="remove" data-pid="${esc(pid)}" aria-label="${esc(p.name)}を外す">${ic('close')}</button></li>`;
    }).join('') || '<li class="empty">まだだれもいない。リンクから入るのを待つか、下で名前を足す。</li>');
    if (document.activeElement !== $('h-next-date')) $('h-next-date').value = r.next.date || '';
    if (document.activeElement !== $('h-next-time')) $('h-next-time').value = r.next.time || '';
    fit(); // プレビューを描きなおしたら、必ず縮めなおす（忘れると、舞台が等倍のまま大きく出る）
  }

  // ══════════════════════════════════════════════
  // 子どもの画面
  // ══════════════════════════════════════════════
  function gBody(r, me) {
    const st = stepOf(r.cur);
    if (onCover(r)) {
      return `<section class="g-cover"><p class="g-cover__no zm">${esc(st.sec)}／4　つぎは</p><div class="g-art">${motif(st.motif)}</div><h1 class="zm">${esc(st.name)}</h1><p>${esc(st.desc)}</p></section>`;
    }
    if (st.id === 'cover') {
      return `<section class="g-cover"><p class="g-cover__no zm">${esc(fmtDay(r.date))}</p><div class="g-art">${motif('flag')}</div><h1 class="zm">作戦会議</h1><p>もうすぐはじまるよ</p></section>`;
    }
    if (st.id === 'checkin') {
      return `<section class="g-card"><p class="g-kick zm">チェックイン</p><p class="g-odai zm">${esc(topicOf(r))}</p><p class="g-foot">声・チャット、どちらでもOK。パスもOK</p></section>`;
    }
    if (st.id === 'agenda') {
      const curIdx = STEPS.findIndex((s) => s.id === r.cur);
      return `<section class="g-card"><p class="g-kick zm">きょうの流れ</p><ol class="g-ag zm">${STEPS.filter((s) => s.sec && !r.skip[s.id]).map((s, i) => `<li class="${STEPS.indexOf(s) < curIdx ? 'done' : ''}"><span class="no">${i + 1}</span><span class="art">${motif(s.motif)}</span>${esc(s.name)}</li>`).join('')}</ol></section>`;
    }
    if (st.id === 'heart') {
      // 押したらすぐ送る（「送る」ボタンは置かない。2026-11-12 オーナー）。別のものを押せば選びなおせる
      const sel = r.heart[me];
      return `<section class="g-card"><p class="g-kick zm">ジブンチェック</p><h1 class="g-q zm">いまの気持ちは？</h1>
        <div class="g-lv">${D.heart.map((h) => `<button type="button" data-act="g-heart" data-val="${h.n}" aria-pressed="${sel === h.n}"><span class="no zm" style="background:${esc(h.tone)}">${h.n}</span>${ic(h.face)}<span class="t">${esc(h.label)}</span></button>`).join('')}</div>
        <button type="button" class="g-pass" data-act="g-heart" data-val="pass" aria-pressed="${sel === 'pass'}">パスする</button>
        <p class="g-foot">${sel === undefined ? '押すと、みんなの画面に出るよ' : 'ほかを押すと、選びなおせるよ'}</p></section>`;
    }
    if (st.id === 'menu') {
      if (r.decided || r.tool) {
        const m = D.menu.find((x) => x.key === r.decided);
        if (r.tool) {
          // ツールは進行役が開く。進行役がリンクを送ったときだけ「入る」が出る
          return `<section class="g-cover"><p class="g-cover__no zm">${m ? `きょうは「${esc(m.label)}」` : 'きょうは'}</p><div class="g-tool">${toolArt(r.tool)}</div><h1 class="zm">${esc(r.tool.name)}</h1>
            ${r.tool.join ? `<a class="btn btn-primary btn-lg" href="${esc(r.tool.join)}" target="_blank" rel="noopener">${esc(r.tool.name)}に入る</a>` : '<p>進行役がひらくよ。画面を見ててね</p>'}</section>`;
        }
        // 「ほかも見る」は自分の画面の中だけで広がる（みんなの画面は変わらない）
        const all = decidedTools(r, G.wide);
        if (!all.length && !G.wide) {
          return `<section class="g-cover"><p class="g-cover__no zm">きょうは</p><div class="g-art">${motif(m.motif)}</div><h1 class="zm">${esc(m.label)}</h1><p>したいことを聞かせてね</p></section>`;
        }
        const mine = r.twant[me] ? r.twant[me].href : '';
        const wide = G.wide ? '' : `<button type="button" class="more" data-act="g-wide"><span class="ti">${ic('apps')}</span><span class="tn">${r.decided === 'game' ? 'ほかのゲームも見る' : 'ほかのツールも見る'}</span></button>`;
        return `<section class="g-card"><p class="g-kick zm">きょうは</p><h1 class="g-q zm">${esc(m.label)}</h1>
          <div class="tscroll">${all.map((t, i) => `<button type="button" data-act="g-tool" data-i="${i}" aria-pressed="${mine === t.href}">${toolArt(t)}<span class="tn">${esc(t.name)}</span></button>`).join('')}${wide}</div>
          <p class="g-foot">${mine ? 'えらんだよ。進行役に伝わったよ' : '横に動かして見てね。やりたいものを押すと、進行役に伝わるよ'}</p></section>`;
      }
      const mine = r.wants[me];
      return `<section class="g-card"><p class="g-kick zm">今日は何する？</p><h1 class="g-q zm">やりたいのは？</h1>
        <div class="g-mn">${D.menu.map((x, i) => `<button type="button" data-act="g-want" data-key="${esc(x.key)}" aria-pressed="${mine === x.key}"><span class="no zm">${i + 1}</span><span class="art">${motif(x.motif)}</span><span class="t zm">${esc(x.label)}</span></button>`).join('')}</div>
        <p class="g-foot">${mine ? 'えらんだよ。進行役に伝わったよ' : 'やりたいものを押すと、進行役に伝わるよ。声・チャットでもOK'}</p></section>`;
    }
    if (st.id === 'plan') {
      return `<section class="g-card"><p class="g-kick zm">予定の確認</p><h1 class="g-q zm">これからの予定</h1><p class="g-foot g-foot--top">押して入れてね。ふせんは、つかんで動かせるよ。空いたままでもOK</p></section>
        ${days(r).map((d, di) => { const p = parts(d); return `<section class="g-day${p.rest ? ' rest' : ''}${d === r.next.date ? ' next' : ''}"><h2 class="zm">${p.m}月<b>${p.d}</b>日<span class="wd">${p.w}</span></h2>
          ${ROWS.map((row) => { const cell = di + '-' + row.id; const items = (r.sched[me] && r.sched[me][cell]) || [];
            return `<button type="button" data-act="cell" data-pid="${esc(me)}" data-cell="${esc(cell)}"><span class="rw">${esc(row.name)}</span><span class="its">${items.map((it) => `<span class="st st-${esc(it.c || 'w')}"${it.c !== 'k' ? ` data-drag="${esc(it.t)}"` : ''}>${esc(it.t)}</span>`).join('')}</span>${ic('add')}</button>`; }).join('')}</section>`; }).join('')}`;
    }
    const list = notices(r);
    return `<section class="g-card"><p class="g-kick zm">お知らせ</p><h1 class="g-q zm">この日だけのプログラム</h1>
      ${list.length ? `<ul class="g-pg">${list.map((it) => `<li><b class="zm">${esc(fmtDay(it.date))}</b><span>${esc(it.name)}<small>${esc(it.start)}〜${esc(it.end)}${it.place ? '　' + esc(it.place) : ''}</small></span></li>`).join('')}</ul>` : '<p class="g-foot">いまのところ、この日だけのプログラムはないよ</p>'}</section>
      ${r.next.date ? `<section class="g-next zm"><p>次回は</p><b>${esc(fmtDay(r.next.date))} ${esc(timeText(r.next.time))}</b></section>` : ''}`;
  }
  function renderGuest() {
    const r = S.room; const list = active(r); const i = list.findIndex((s) => s.id === r.cur);
    const prog = list.map((s, k) => `<i class="${k < i ? 'done' : k === i ? 'cur' : ''}"></i>`).join('');
    keepScroll($('guest'), [r.cur, r.view, r.decided, G.wide, !!r.tool].join('|'), () => setHTML($('guest'), `<header class="g-top"><p class="g-top__t zm">作戦会議</p><p class="g-top__me">${esc(r.persons[S.me].name)}</p><div class="g-prog" aria-hidden="true">${prog}</div></header><main class="g-main" data-step="${esc(onCover(r) ? 'seccover' : r.cur)}">${gBody(r, S.me)}</main>`));
  }

  function render() {
    if (!S.room || !ctx) return;
    const r = S.room;
    showScreen(S.role);
    if (S.role === 'watch') setHTML($('watch-wrap'), slide(r, false));
    if (S.role === 'host') renderHost();
    if (S.role === 'guest') { if (!r.decided || r.tool) G.wide = false; renderGuest(); }
    fit();
    // 進行役がつながっていないあいだは、子どもとみんなにみせる画面に「待っています」を出す
    if (S.role !== 'host' && r.hostConnected === false && r.status !== 'finished') showAway(); else hideAway();
    if (picker) {
      if (!onBody(r, 'plan') || !r.persons[picker.pid]) closePicker(); else renderPickerItems();
    }
  }

  // ── 予定を入れる小さな窓（押した人の画面にだけ出る）──────────
  function openPicker(pid, cell) {
    const r = S.room; const p = r.persons[pid];
    if (!p) return;
    picker = { pid, cell };
    const cp = cell.split('-'); const row = ROWS.find((x) => x.id === cp[1]);
    $('picker-title').textContent = fmtDay(days(r)[Number(cp[0])]) + '　' + row.name;
    const todo = cp[1] === 'todo';
    // 学校の束は、進行役がその人についてオンにしたときだけ
    const chips = (todo ? D.chips.todo : D.chips.plan).concat(p.school ? (todo ? D.chips.todoSchool : D.chips.planSchool) : []);
    setHTML($('picker-chips'), chips.map((c) => `<button type="button" class="chip st-${esc(c.c)}" data-t="${esc(c.t)}">${ic(c.i)}${esc(c.t)}</button>`).join(''));
    $('picker-text').value = '';
    renderPickerItems();
    $('picker').showModal();
  }
  function renderPickerItems() {
    const items = (S.room.sched[picker.pid] && S.room.sched[picker.pid][picker.cell]) || [];
    setHTML($('picker-items'), items.map((it) => `<li class="st st-${esc(it.c || 'w')}"><span>${esc(it.t)}</span><button type="button" data-t="${esc(it.t)}" aria-label="${esc(it.t)}を消す">${ic('close')}</button></li>`).join('')
      || '<li class="empty">下から選ぶか、自分で書いてね</li>');
    const full = items.length >= MAX_ITEMS;
    $('picker-chips').querySelectorAll('button').forEach((b) => { b.disabled = full || items.some((it) => it.t === b.dataset.t); });
    $('picker-text').disabled = full;
  }
  function closePicker() { picker = null; if ($('picker').open) $('picker').close(); }

  // ── 予定のふせんを、つかんで別のマスへ動かす（マウスでも指でも）──────
  let drag = null;
  // 動かし終えた指・マウスの、その一連の動きで出る「押した」だけを捨てる印。
  // 時間で区切ると（前は350ミリ秒）、動かした直後に別のボタンを押したときの「押した」まで捨ててしまう
  let dropJust = false;
  function cellAt(x, y, pid) {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest('[data-cell]');
    return cell && cell.dataset.pid === pid ? cell : null;
  }
  function clearDrop() { document.querySelectorAll('.drop').forEach((el) => el.classList.remove('drop')); }
  function endDrag() {
    if (drag && drag.ghost) { drag.ghost.remove(); dropJust = true; setTimeout(() => { dropJust = false; }, 60); }
    document.body.classList.remove('dragging'); clearDrop(); drag = null;
  }
  function onPointerDown(e) {
    dropJust = false; // 新しく押しはじめたら、前の印は消す
    if (S.role === 'watch' || !S.room || e.button > 0 || $('picker').open) return;
    const st = e.target.closest('[data-drag]'); const cell = st && st.closest('[data-cell]');
    if (!cell) return;
    drag = { t: st.dataset.drag, pid: cell.dataset.pid, from: cell.dataset.cell, x: e.clientX, y: e.clientY, color: (st.className.match(/st-[a-z]/) || [''])[0], ghost: null };
  }
  function onPointerMove(e) {
    if (!drag) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return; // 少し動かすまでは「押した」あつかい
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'drag-ghost ' + drag.color;
      drag.ghost.textContent = drag.t;
      document.body.appendChild(drag.ghost);
      document.body.classList.add('dragging');
    }
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    clearDrop();
    const cell = cellAt(e.clientX, e.clientY, drag.pid);
    if (cell && cell.dataset.cell !== drag.from) cell.classList.add('drop');
  }
  function onPointerUp(e) {
    if (!drag) return;
    const d = drag; const moved = !!d.ghost;
    endDrag();
    if (!moved) return;
    const cell = cellAt(e.clientX, e.clientY, d.pid);
    if (cell && cell.dataset.cell !== d.from) act('cellMove', { pid: d.pid, from: d.from, to: cell.dataset.cell, t: d.t });
  }

  // ── 押したとき ─────────────────────────────────
  function onClick(e) {
    if (dropJust) { dropJust = false; return; } // ふせんを動かし終えた、その動きで出た「押した」は捨てる
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !S.room || b.tagName === 'INPUT') return;
    const r = S.room; const a = b.dataset.act; const d = b.dataset;
    if (a === 'cell' && S.role !== 'watch') return openPicker(d.pid, d.cell);
    if (S.role === 'guest') {
      if (a === 'g-heart') act('heart', { pid: S.me, val: d.val === 'pass' ? 'pass' : Number(d.val) });
      if (a === 'g-want') act('want', { pid: S.me, key: d.key });
      if (a === 'g-tool') act('twant', { pid: S.me, i: Number(d.i) });
      if (a === 'g-wide') { G.wide = true; renderGuest(); }
      return;
    }
    if (S.role !== 'host') return;
    const setTool = (t) => tx((room) => { room.tool = { name: t.name, href: t.href, ext: !!t.ext, icon: t.icon || '' }; });
    if (a === 'jump') jump(d.id);
    if (a === 'skip') tx((room) => { room.skip[d.id] = !room.skip[d.id]; });
    if (a === 'ans-heart') act('heart', { pid: d.pid, val: d.val === 'pass' ? 'pass' : Number(d.val), toggle: true });
    if (a === 'remove' && confirm(r.persons[d.pid].name + ' を外しますか？')) removePerson(d.pid);
    if (a === 'talk') loadTopics().then((list) => tx((room) => { room.topic = pickTopic(list, room.topic); }));
    if (a === 'decide') tx((room) => { room.decided = d.key; room.tool = null; room.page = 0; room.wide = false; room.wants = {}; room.twant = {}; if (d.key === 'omakase') drawOmakase(room); });
    if (a === 'undecide') tx((room) => { room.decided = null; room.tool = null; room.page = 0; room.wide = false; room.twant = {}; });
    if (a === 'browse') { browse.open = !browse.open; renderHost(); }
    if (a === 'btab') { browse.tab = d.tab; renderHost(); }
    if (a === 'pickhref') { const t = decidedTools(r, true).find((x) => x.href === d.href); if (t) setTool(t); }
    if (a === 'wide') tx((room) => { room.wide = true; room.page = 0; });
    if (a === 'find') { const t = D.all.find((x) => x.slug === d.slug); if (t) { if ($('h-q')) $('h-q').value = ''; browse.open = false; setTool(appTool(t)); } }
    if (a === 'sendhref') tx((room) => { if (!room.tool) return false; room.tool.join = room.tool.href; });
    if (a === 'unjoin') tx((room) => { if (!room.tool) return false; delete room.tool.join; delete room.tool.code; });
    if (a === 'open') openTool();
    if (a === 'page') tx((room) => { const pages = Math.ceil(decidedTools(room).length / PER) || 1; room.page = (((room.page || 0) + Number(d.dir || 1)) % pages + pages) % pages; });
    if (a === 'redraw') tx((room) => { drawOmakase(room); room.tool = null; });
    if (a === 'tool') tx((room) => pickTool(room, Number(d.i)));
    if (a === 'untool') tx((room) => { room.tool = null; });
    if (a === 'sel') tx((room) => { room.sel = d.pid; });
  }
  // 端末のない子を足す（進行役）。名前の決まりは参加と同じ
  async function addProxy(nameIn) {
    const name = validateName(nameIn);
    if (nameTaken(S.room, name)) throw fail('その名前は使われているよ。');
    if (S.room.order.length >= MAX_PEOPLE) throw fail(`${MAX_PEOPLE}人までだよ。`);
    const id = 'p_' + Math.random().toString(36).slice(2, 10);
    await tx((room) => { if (nameTaken(room, name)) return false; return addPerson(room, id, name, true); });
  }
  function bind() {
    document.addEventListener('click', onClick);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', fit);
    $('host').addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.act === 'school') { const pid = t.dataset.pid; const on = t.checked; tx((room) => { if (!room.persons[pid]) return false; room.persons[pid].school = on; }); }
      if (t.id === 'h-next-date' || t.id === 'h-next-time') {
        const next = { date: $('h-next-date').value, time: $('h-next-time').value };
        tx((room) => { room.next = next; syncSakusen(room); });
      }
    });
    $('host').addEventListener('submit', (e) => {
      const f = e.target.closest('[data-form="ext"]');
      if (!f) return;
      e.preventDefault();
      const name = f.querySelector('[data-keep="extName"]').value.trim();
      const url = f.querySelector('[data-keep="extUrl"]').value.trim();
      const msg = f.querySelector('.h-ext__msg');
      // 開けるのは https のリンクだけ
      if (!name || !/^https:\/\/[^\s]+$/.test(url)) { msg.hidden = false; msg.textContent = '名前と、https から始まるリンクを入れてください。'; return; }
      f.querySelectorAll('input').forEach((el) => { el.value = ''; });
      tx((room) => { room.tool = { name: name.slice(0, 16), href: url, ext: true, icon: 'school' }; });
    });
    $('host').addEventListener('submit', (e) => {
      const f = e.target.closest('[data-form="join"]');
      if (!f || !S.room.tool) return;
      e.preventDefault();
      const input = f.querySelector('[data-keep="join"]'); const url = input.value.trim(); const msg = f.querySelector('.h-ext__msg');
      // 送れるのは、このサイトの中のリンクか https のリンクだけ
      if (!(url.startsWith(location.origin + '/') || /^https:\/\/[^\s]+$/.test(url))) { msg.hidden = false; msg.textContent = 'ツールの「リンクをコピー」でコピーした、参加用のリンクを貼ってください。'; return; }
      input.value = '';
      tx((room) => { if (!room.tool) return false; room.tool.join = url; });
    });
    $('host').addEventListener('input', (e) => { if (e.target.id === 'h-q') fillSearch(); });
    $('h-prev').addEventListener('click', () => go(-1));
    $('h-next').addEventListener('click', () => go(1));
    $('host').addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-form="add2"]');
      if (!f) return;
      e.preventDefault();
      const input = f.querySelector('input');
      try { await addProxy(input.value); input.value = ''; } catch (err) { toast(err.message || '足せませんでした'); input.focus(); }
    });
    $('h-covers').addEventListener('change', (e) => {
      const on = e.target.checked;
      tx((room) => { room.covers = on; if (!on && room.view === 'cover') room.view = 'body'; }); // いま表紙なら、中身へ
    });
    $('h-add').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('h-add-error').hidden = true;
      try { await addProxy($('h-add-name').value); $('h-add-name').value = ''; }
      catch (err) { $('h-add-error').textContent = err.message || '足せませんでした'; $('h-add-error').hidden = false; }
    });
    $('btnCopyCode').addEventListener('click', () => RoomkRTDB.copyRoomCode(S.code, $('btnCopyCode')));
    $('btnCopyLink').addEventListener('click', () => RoomkRTDB.copyRoomLink(S.code, $('btnCopyLink')));
    $('btnShowQr').addEventListener('click', () => { if (CODE_RE.test(S.code || '')) RoomkQR.show(S.code); else toast('ルームコードがありません'); });
    $('h-chat').addEventListener('click', () => RoomkRTDB.copyText(chatText(S.room), $('h-chat'), 'この画面の文をコピーしました。チャットに貼ってね', 'コピーできませんでした'));
    $('h-watch').addEventListener('click', () => window.open(location.pathname + '?watch=' + S.code, '_blank'));
    $('h-close').addEventListener('click', finishRoom);
    $('g-leave').addEventListener('click', () => { if (confirm('退出しますか？')) leaveRoom(); });
    $('picker-chips').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && picker) act('cellAdd', { pid: picker.pid, cell: picker.cell, t: b.dataset.t });
    });
    $('picker-items').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && picker) act('cellDel', { pid: picker.pid, cell: picker.cell, t: b.dataset.t });
    });
    $('picker-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = $('picker-text').value.trim();
      if (t && picker) { act('cellAdd', { pid: picker.pid, cell: picker.cell, t }); $('picker-text').value = ''; }
    });
    $('picker-close').addEventListener('click', closePicker);
    $('picker-x').addEventListener('click', closePicker);
    $('picker').addEventListener('close', () => { picker = null; });
    document.addEventListener('keydown', (e) => {
      if (S.role !== 'host' || !S.room || $('picker').open || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    });

    // はじめの画面・参加の画面
    $('go-create').addEventListener('click', async () => {
      const btn = $('go-create'); btn.disabled = true; $('top-error').hidden = true;
      try { await createRoom(); }
      catch (err) { $('top-error').textContent = err.message || 'ルームを作れませんでした'; $('top-error').hidden = false; }
      finally { btn.disabled = false; }
    });
    $('go-join').addEventListener('click', () => { $('joinLinkHint').hidden = true; $('join-error').hidden = true; showScreen('join'); $('join-name').focus(); });
    $('go-watch').addEventListener('click', () => { $('watch-error').hidden = true; showScreen('watch-join'); $('watch-code').focus(); });
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', goTop));
    $('join-form').addEventListener('submit', async (e) => {
      e.preventDefault(); $('join-error').hidden = true;
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try { await joinRoom($('join-code').value, $('join-name').value); if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname); }
      catch (err) { $('join-error').textContent = err.message || '参加できませんでした'; $('join-error').hidden = false; }
      finally { btn.disabled = false; }
    });
    $('watch-form').addEventListener('submit', async (e) => {
      e.preventDefault(); $('watch-error').hidden = true;
      try { await openWatch(validateCode($('watch-code').value)); }
      catch (err) { $('watch-error').textContent = err.message || 'ひらけませんでした'; $('watch-error').hidden = false; }
    });
  }

  // ── はじめる ───────────────────────────────────
  async function openWatch(code) {
    await authenticated();
    await attach(code, null, true);
    history.replaceState(null, '', location.pathname + '?watch=' + code);
  }
  async function tryReconnect() {
    if (!session || !session.code) return false;
    try { await authenticated(); await attach(session.code, session, false); return true; }
    catch (e) { saveSession(null); return false; }
  }
  bind();
  loadCatalog();
  window.addEventListener('load', async () => {
    fit();
    const watch = qs.get('watch'); const room = qs.get('room');
    if (watch) {
      try { await openWatch(validateCode(watch)); return; }
      catch (e) { toast(e.message || 'ひらけませんでした'); history.replaceState(null, '', location.pathname); }
    }
    if (room) {
      let code = null;
      try { code = validateCode(room); } catch (e) { toast('ルームコードが正しくないよ'); history.replaceState(null, '', location.pathname); }
      if (code) {
        // 同じコードの記録が残っていれば再接続を優先する。別のコードの記録は消して、リンクのルームを優先する
        if (session && session.code === code && await tryReconnect()) { history.replaceState(null, '', location.pathname); return; }
        saveSession(null);
        $('join-code').value = code; $('joinLinkHint').hidden = false; showScreen('join'); $('join-name').focus();
        return;
      }
    }
    if (await tryReconnect()) return;
    showScreen('top');
  });
})();

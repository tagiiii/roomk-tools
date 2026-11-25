/* ひともじチェンジ
   遊び方は2つ: 1台の画面（通信しない）と、ルーム（各自の端末・Realtime Database）。
   ことばとルームの決まりは logic.js（window.HMC_LOGIC）。お題と言葉のリストは words.js */
import { shuffle, popIn } from '../shared/js/utils.js';
import { PUZZLES, VOCAB } from './words.js';

const L = window.HMC_LOGIC;
const S = L.STATUS;
const chars = L.chars;
const $ = (id) => document.getElementById(id);
const toast = (message, isError = true) => RoomkRTDB.showToast(message, isError);

/* ── お題の選び方 ── */
const LEVELS = [
  { id: 'two',    label: '2文字',       icon: 'looks_two', chars: 2 },
  { id: 'three',  label: '3文字',       icon: 'looks_3',   chars: 3 },
  { id: 'custom', label: '自分で決める', icon: 'edit',      chars: null },
];
const levelOf = (id) => LEVELS.find((l) => l.id === id) || LEVELS[0];
const ORDER_ITEMS = [
  { id: 'turn', label: '順番に', note: '1人ずつ順番に変える。思いつかないときは「パス」' },
  { id: 'free', label: 'だれでも', note: 'だれが変えてもいい。早く押した人の手が入る' },
];

/* ── 文字の表（1行10マス。左が あ〜な 行、右が は〜わ 行。空きは空白） ── */
const PAD_ROWS = [
  'あいうえお', 'はひふへほ',
  'かきくけこ', 'まみむめも',
  'さしすせそ', 'や ゆ よ',
  'たちつてと', 'らりるれろ',
  'なにぬねの', 'わ を ん',
  'がぎぐげご', 'ばびぶべぼ',
  'ざじずぜぞ', 'ぱぴぷぺぽ',
  'だぢづでど', 'ぁぃぅぇぉ',
  'ゃゅょっー', '     ',
];

/* ── 画面 ── */
const SCREENS = ['screen-top', 'screen-local', 'screen-create', 'screen-join', 'screen-waiting', 'screen-play'];
function showScreen(id) {
  const changed = $(id).hidden;
  SCREENS.forEach((s) => { $(s).hidden = s !== id; });
  if (changed) window.scrollTo(0, 0);
}

function setError(id, message) {
  const box = $(id);
  box.textContent = message;
  box.hidden = !message;
  const inputs = { createError: ['hostName'], joinError: ['guestName', 'joinCode'], proxyError: ['proxyName'], customError: ['customStart', 'customGoal'], roomCustomError: ['roomCustomStart', 'roomCustomGoal'] }[id] || [];
  inputs.forEach((inputId) => {
    if (message) $(inputId).setAttribute('aria-invalid', 'true');
    else $(inputId).removeAttribute('aria-invalid');
  });
}

// お題の選び方の札（1台の画面・待合室で同じ形）
function renderLevelGrid(box, selectedId, onSelect) {
  box.textContent = '';
  LEVELS.forEach((lv) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hmc-level';
    btn.dataset.level = lv.id;
    const selected = lv.id === selectedId;
    btn.classList.toggle('is-selected', selected);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', selected ? 'true' : 'false');
    const count = lv.chars ? PUZZLES.filter((p) => p.chars === lv.chars).length : 0;
    [['material-symbols-rounded hmc-level__icon', lv.icon], ['hmc-level__label', lv.label], ['hmc-level__desc', lv.chars ? count + '題' : 'お題を書く']].forEach(([cls, text], i) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      if (i === 0) span.setAttribute('aria-hidden', 'true');
      btn.appendChild(span);
    });
    btn.addEventListener('click', () => onSelect(lv.id));
    box.appendChild(btn);
  });
}

/* ════════════ 1台の画面（通信しない） ════════════ */

const local = {
  levelId: null,
  puzzle: null,
  words: [],
  hintStage: 0,
  cleared: false,
  decks: {},
};
const ui = { mode: null, selPos: null, seenKey: '' };

function renderLocalSetup() {
  renderLevelGrid($('levelGrid'), local.levelId, (id) => {
    local.levelId = id;
    $('customForm').hidden = id !== 'custom';
    setError('customError', '');
    $('btnStart').disabled = false;
    renderLocalSetup();
    if (id === 'custom') $('customStart').focus();
  });
}

function drawLocalPuzzle(levelChars) {
  let deck = local.decks[levelChars];
  if (!deck || deck.length === 0) {
    const last = local.puzzle;
    deck = shuffle(PUZZLES.filter((p) => p.chars === levelChars));
    // 引き直した直後に、いま遊んだお題が続かないようにする
    if (last && deck.length > 1 && deck[deck.length - 1] === last) deck.unshift(deck.pop());
    local.decks[levelChars] = deck;
  }
  return deck.pop();
}

function startLocal() {
  const lv = LEVELS.find((l) => l.id === local.levelId);
  if (!lv) return;
  let puzzle;
  if (lv.id === 'custom') {
    const r = L.readCustom($('customStart').value, $('customGoal').value);
    setError('customError', r.error || '');
    if (r.error) return;
    puzzle = r;
  } else {
    puzzle = drawLocalPuzzle(lv.chars);
  }
  ui.mode = 'local';
  beginLocal(puzzle);
  showScreen('screen-play');
}

function beginLocal(puzzle) {
  local.puzzle = puzzle;
  local.words = [puzzle.start];
  local.hintStage = 0;
  local.cleared = false;
  ui.selPos = null;
  $('clearArea').hidden = true;
  window.RoomkStats?.count(local.levelId === 'custom' ? 'custom' : 'chars' + puzzle.chars);
  renderPlay();
}

function nextLocal() {
  const lv = levelOf(local.levelId);
  if (lv.id === 'custom') { showScreen('screen-local'); return; }
  beginLocal(drawLocalPuzzle(lv.chars));
  window.scrollTo(0, 0);
}

/* ════════════ 遊ぶ画面（1台の画面・ルーム共通） ════════════ */

// いま描く中身。ルームは届いたルームから、1台の画面は手元の記録から作る
function view() {
  if (ui.mode === 'room') {
    const room = net.room;
    const g = L.gameOf(room);
    if (!g) return null;
    const me = net.nickname;
    const isHost = net.role === 'host';
    const lv = levelOf(L.settingsOf(room).level);
    return {
      puzzle: g.puzzle,
      words: g.ladder.map((x) => x.w),
      cleared: !!g.cleared,
      hintStage: L.hintStageOf(g),
      canEdit: L.canMove(room, me),
      canUndo: L.canUndo(room, me),
      canHint: isHost && !g.cleared,
      isHost,
      levelLabel: lv.id === 'custom' ? '自分で決めたお題' : lv.label + 'のお題',
      skipLabel: lv.id === 'custom' ? 'お題を決めなおす' : 'お題を変える',
      nextLabel: lv.id === 'custom' ? 'お題を決めなおす' : '次のお題',
      key: g.id + ':' + g.ladder.length + ':' + (L.turnOf(room) || ''),
    };
  }
  if (!local.puzzle) return null;
  const lv = levelOf(local.levelId);
  return {
    puzzle: local.puzzle,
    words: local.words,
    cleared: local.cleared,
    hintStage: local.hintStage,
    canEdit: !local.cleared,
    canUndo: local.words.length > 1 && !local.cleared,
    canHint: !local.cleared,
    isHost: true,
    levelLabel: lv.id === 'custom' ? '自分で決めたお題' : lv.label + 'のお題',
    skipLabel: lv.id === 'custom' ? 'お題を決めなおす' : 'お題を変える',
    nextLabel: lv.id === 'custom' ? 'お題を決めなおす' : '次のお題',
    key: '',
  };
}

function renderPlay() {
  const v = view();
  if (!v) return;
  const isRoom = ui.mode === 'room';
  if (!v.canEdit || v.cleared) ui.selPos = null;
  $('playLevel').textContent = v.levelLabel;
  $('btnSkipLabel').textContent = v.skipLabel;
  $('btnSkip').hidden = !v.isHost || v.cleared;
  $('btnToWaiting').hidden = !isRoom || !v.isHost;
  $('btnPlayTop').hidden = isRoom;
  $('odaiStart').textContent = v.puzzle.start;
  $('odaiGoal').textContent = v.puzzle.goal;
  renderTurn();
  renderLadder(v);
  renderTiles(v);
  renderPad(v);
  renderHint(v);
  $('nowArea').hidden = v.cleared;
  $('playActions').hidden = v.cleared;
  $('btnUndo').hidden = !v.canUndo && isRoom;
  $('btnUndo').disabled = !v.canUndo;
  $('btnHint').hidden = !v.canHint;
  $('nowLabel').textContent = !v.canEdit
    ? 'いまのことば'
    : ui.selPos === null ? '変える文字を押してね' : 'いまのことば';
  renderClear(v);
}

function renderLadder(v) {
  const ol = $('ladder');
  ol.textContent = '';
  v.words.forEach((word, i) => {
    const li = document.createElement('li');
    li.className = 'hmc-ladder__step';
    if (i === v.words.length - 1) li.classList.add('is-current');
    const prev = i > 0 ? chars(v.words[i - 1]) : null;
    chars(word).forEach((c, j) => {
      const span = document.createElement('span');
      span.textContent = c;
      if (prev && prev[j] !== c) span.className = 'hmc-ladder__changed';
      li.appendChild(span);
    });
    ol.appendChild(li);
  });
}

function hintInfo(v) {
  if (!v.hintStage || v.cleared) return null;
  return L.hintStep(v.words[v.words.length - 1], v.puzzle.goal, VOCAB);
}

function renderTiles(v) {
  const box = $('tiles');
  box.textContent = '';
  const current = chars(v.words[v.words.length - 1]);
  const goal = chars(v.puzzle.goal);
  const h = hintInfo(v);
  current.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hmc-tile';
    btn.dataset.pos = String(i);
    btn.textContent = c;
    btn.setAttribute('aria-label', v.canEdit ? `${i + 1}文字目「${c}」を変える` : `${i + 1}文字目「${c}」`);
    btn.setAttribute('aria-pressed', ui.selPos === i ? 'true' : 'false');
    btn.disabled = !v.canEdit;
    if (ui.selPos === i) btn.classList.add('is-selected');
    if (c === goal[i]) btn.classList.add('is-goal');
    if (h && h.pos === i) btn.classList.add('is-hint');
    btn.addEventListener('click', () => selectPos(i));
    box.appendChild(btn);
  });
}

function renderPad(v) {
  const pad = $('pad');
  if (ui.selPos === null || !v.canEdit || v.cleared) {
    pad.hidden = true;
    return;
  }
  const from = chars(v.words[v.words.length - 1])[ui.selPos];
  $('padTitle').textContent = `${ui.selPos + 1}文字目の「${from}」を、どの文字に変える？`;
  const grid = $('padGrid');
  grid.textContent = '';
  for (let r = 0; r < PAD_ROWS.length; r += 2) {
    (PAD_ROWS[r] + PAD_ROWS[r + 1]).split('').forEach((c) => {
      if (c === ' ') {
        const gap = document.createElement('span');
        gap.className = 'hmc-key hmc-key--blank';
        gap.setAttribute('aria-hidden', 'true');
        grid.appendChild(gap);
        return;
      }
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'hmc-key';
      key.textContent = c;
      if (c === from) {
        key.disabled = true;
        key.classList.add('is-same');
      }
      key.addEventListener('click', () => changeChar(c));
      grid.appendChild(key);
    });
  }
  pad.hidden = false;
}

function renderHint(v) {
  const area = $('hintArea');
  if (!v.hintStage || v.cleared) {
    area.hidden = true;
    return;
  }
  const h = hintInfo(v);
  if (!h) {
    $('hintText').textContent = v.words.length > 1 && L.findPath(v.puzzle.start, v.puzzle.goal, VOCAB)
      ? 'ここから先のヒントは見つからなかった。「1つ戻す」で前のことばに戻ってみよう'
      : 'このお題のヒントは見つからなかった。いろいろ変えて試してみよう';
  } else if (v.hintStage === 1) {
    $('hintText').textContent = `光っている文字を変えてみよう（あと${h.steps}回くらいでゴールできそう）`;
  } else {
    $('hintText').textContent = `たとえば「${h.word}」にできるよ`;
  }
  area.hidden = false;
}

function renderClear(v) {
  const area = $('clearArea');
  if (!v.cleared) {
    area.hidden = true;
    area.dataset.shown = '';
    return;
  }
  const isRoom = ui.mode === 'room';
  const moves = v.words.length - 1;
  $('clearSub').textContent = `${moves}回の変更で「${v.puzzle.start}」から「${v.puzzle.goal}」につながった`;
  const example = L.findPath(v.puzzle.start, v.puzzle.goal, VOCAB);
  if (example && example.join() !== v.words.join()) {
    $('clearOther').textContent = `ほかのつなぎ方の例: ${example.join(' → ')}`;
    $('clearOther').hidden = false;
  } else {
    $('clearOther').hidden = true;
  }
  $('btnNextLabel').textContent = v.nextLabel;
  $('btnTopLabel').textContent = isRoom ? '待合室にもどる' : 'はじめの画面へ';
  $('btnTopIcon').textContent = isRoom ? 'group' : 'home';
  $('clearActions').hidden = !v.isHost;
  $('clearWait').hidden = v.isHost;
  const key = v.puzzle.start + v.puzzle.goal + moves;
  if (area.hidden || area.dataset.shown !== key) {
    area.hidden = false;
    area.dataset.shown = key;
    popIn(area);
    if (v.isHost) $('btnNext').focus({ preventScroll: true });
    area.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/* ── 操作 ── */
function selectPos(i) {
  const v = view();
  if (!v || !v.canEdit) return;
  ui.selPos = ui.selPos === i ? null : i;
  renderPlay();
  if (ui.selPos !== null) {
    $('pad').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('padGrid').querySelector('.hmc-key:not(:disabled)')?.focus({ preventScroll: true });
  }
}

function closePad() {
  const pos = ui.selPos;
  ui.selPos = null;
  renderPlay();
  if (pos !== null) $('tiles').children[pos]?.focus();
}

function changeChar(c) {
  const pos = ui.selPos;
  if (pos === null) return;
  if (ui.mode === 'room') { roomMove(pos, c); return; }
  const cur = chars(local.words[local.words.length - 1]);
  if (local.cleared || cur[pos] === c) return;
  cur[pos] = c;
  const next = cur.join('');
  local.words.push(next);
  local.hintStage = 0;
  local.cleared = next === local.puzzle.goal;
  ui.selPos = null;
  renderPlay();
  if (!local.cleared) $('tiles').children[pos]?.focus();
}

function undo() {
  if (ui.mode === 'room') { roomAct((room) => L.undo(room, net.nickname)); return; }
  if (local.words.length <= 1 || local.cleared) return;
  local.words.pop();
  local.hintStage = 0;
  ui.selPos = null;
  renderPlay();
}

function showHint() {
  if (ui.mode === 'room') { roomAct((room) => L.hint(room, net.nickname)); return; }
  if (local.cleared) return;
  const h = L.hintStep(local.words[local.words.length - 1], local.puzzle.goal, VOCAB);
  local.hintStage = h ? Math.min(2, local.hintStage + 1) : 1;
  renderPlay();
  popIn($('hintArea'));
}

function backToTop() {
  ui.mode = null;
  local.puzzle = null;
  $('clearArea').hidden = true;
  showScreen('screen-top');
}

/* ════════════ ルーム（各自の端末。Realtime Database） ════════════ */

const DB_PREFIX = 'hitomojichange_rooms';
const SESSION_KEY = 'hitomojichange_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

const net = {
  role: null,
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null,
  joinedAt: null,
  roomCallback: null,
  connectedRef: null,
  connectedCallback: null,
  isConnected: false,
  presenceDirty: false,
  presenceAt: 0,
  leaving: false,
  busy: false,
  acting: false,
  timerInterval: null,
  orphanTimer: null,
  orphanAt: null,
  lastKey: '',
};

let fb = null;
function firebaseReady() {
  if (!fb) fb = RoomkRTDB.initFirebase(firebase);
  return fb;
}
const currentUid = () => (fb ? firebase.auth().currentUser?.uid || null : null);
const serverTimestamp = () => firebase.database.ServerValue.TIMESTAMP;

async function waitAuth() {
  try {
    await firebaseReady().authReady;
    return true;
  } catch {
    toast('うまくつながらなかったよ。ページを読み直してね');
    return false;
  }
}

function isExpired(room) {
  // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
  return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
}

async function removeExpired(ref, fallback) {
  try {
    // 手元には反映しない（applyLocally:false）。消えたルームを古い値で表示し直さないため
    await ref.transaction((room) => {
      const current = room || fallback;
      return current && isExpired(current) ? null : undefined;
    }, undefined, false);
  } catch (error) {
    console.warn('[hitomoji-change] expired room cleanup failed', error);
  }
}

// transaction の最初の計算が空のキャッシュで走らないよう、先に値を購読しておく
function warmRoomCache(ref) {
  return new Promise((resolve, reject) => {
    const callback = (snap) => resolve({ snap, release: () => ref.off('value', callback) });
    ref.on('value', callback, reject);
  });
}

// 送信後に通信が切れて中止された transaction は、やり直す（届いていたかは中で確かめる）
async function transactRetry(ref, update) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ref.transaction(update);
    } catch (error) {
      if (error?.message !== 'disconnect' || attempt >= TX_RETRY_MAX) throw error;
    }
  }
}

/* ── 再接続用の記録（名前とルームコードだけ） ── */
function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: net.role, nickname: net.nickname, roomCode: net.roomCode, uid: currentUid(), joinedAt: net.joinedAt }));
  } catch {
    // 保存できないときは、再読み込みで戻れないだけ
  }
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 何もしない */ }
}

/* ── ルームへの出入り ── */
function cleanupRoom() {
  clearInterval(net.timerInterval);
  clearTimeout(net.orphanTimer);
  if (net.roomRef && net.roomCallback) net.roomRef.off('value', net.roomCallback);
  if (net.connectedRef && net.connectedCallback) net.connectedRef.off('value', net.connectedCallback);
  if (net.roomRef) RoomkRTDB.cancelRoomOnDisconnect(net.roomRef);
  Object.assign(net, {
    role: null, nickname: null, roomCode: null, roomRef: null, room: null, joinedAt: null,
    roomCallback: null, connectedRef: null, connectedCallback: null, isConnected: false,
    presenceDirty: false, presenceAt: 0, leaving: false, acting: false,
    timerInterval: null, orphanTimer: null, orphanAt: null, lastKey: '',
  });
  clearSession();
  ui.mode = null;
  ui.selPos = null;
  $('hostOffOverlay').hidden = true;
  $('roomBar').hidden = true;
  $('clearArea').hidden = true;
}

function leaveLocally(message, isError = true) {
  cleanupRoom();
  showScreen('screen-top');
  if (message) toast(message, isError);
}

function connectToRoom(role, nickname, code, ref, joinedAt) {
  if (net.roomRef) cleanupRoom();
  net.role = role;
  net.nickname = nickname;
  net.roomCode = code;
  net.roomRef = ref;
  net.joinedAt = Number(joinedAt) || RoomkRTDB.now();
  ui.mode = 'room';
  $('roomCodeLabel').textContent = code;
  $('btnLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
  $('roomBar').hidden = false;
  saveSession();
  // 参加用のリンク（?room=コード）でひらいたときは、つないだあとにコードをアドレスから外す
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);

  net.roomCallback = (snap) => {
    if (net.roomRef !== ref || net.leaving) return;
    if (!snap.exists()) {
      leaveLocally('ルームが閉じられたよ', false);
      return;
    }
    const room = snap.val();
    if (isExpired(room)) {
      removeExpired(ref, room);
      leaveLocally('このルームは終わったみたい');
      return;
    }
    net.room = room;
    handleRoom(room);
  };
  ref.on('value', net.roomCallback, (error) => {
    console.warn('[hitomoji-change] room listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });

  net.connectedRef = firebaseReady().db.ref('.info/connected');
  net.connectedCallback = (snap) => {
    net.isConnected = snap.val() === true;
    if (net.isConnected && net.roomRef === ref) {
      net.presenceDirty = true;
      ensurePresence(true);
    }
  };
  net.connectedRef.on('value', net.connectedCallback);
  net.timerInterval = setInterval(() => { if (net.room && needsPresence(net.room)) ensurePresence(); }, 1000);
}

function needsPresence(room) {
  if (net.role === 'host') return room.hostConnected === false;
  if (net.role === 'guest') return !room.players?.[net.nickname];
  return false;
}

// 接続のたびに切断時の予約を張り直し、自分の在室を確かめる
async function ensurePresence(force = false) {
  const ref = net.roomRef;
  if (!ref || net.leaving || !net.isConnected || !net.room) return;
  if (!force && Date.now() - net.presenceAt < PRESENCE_RETRY_MS) return;
  net.presenceDirty = false;
  net.presenceAt = Date.now();
  const { role, nickname, joinedAt } = net;
  const uid = currentUid();
  const stale = () => net.leaving || net.roomRef !== ref;
  try {
    if (role === 'host') {
      await ref.onDisconnect().update({ hostConnected: false, hostDisconnectedAt: serverTimestamp() });
      if (stale()) return;
      await ref.transaction((room) => {
        if (stale() || !room || room.hostUid !== uid || isExpired(room)) return;
        if (room.hostConnected === true && room.hostDisconnectedAt == null) return;
        return { ...room, hostConnected: true, hostDisconnectedAt: null };
      });
    } else if (role === 'guest') {
      await ref.child('players/' + nickname).onDisconnect().remove();
      if (stale()) return;
      let full = false;
      let taken = false;
      await ref.transaction((room) => {
        full = false;
        taken = false;
        if (stale() || !room || isExpired(room) || room.players?.[nickname]) return;
        if (nickname === room.host || room.proxies?.[nickname]) { taken = true; return; }
        if (L.participants(room).length >= L.MAX_PLAYERS) { full = true; return; }
        return L.addPlayer(room, nickname, { isHost: false, uid, joinedAt });
      });
      if ((full || taken) && net.roomRef === ref && !net.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally(full ? 'このルームはいっぱいだよ' : 'その名前は使われていたので、ルームから外れました');
      }
    }
  } catch (error) {
    console.warn('[hitomoji-change] presence recovery failed', error);
    if (force) toast('再接続に失敗しました。ページを読み直してね');
  }
}

async function createRoom() {
  if (net.busy || net.roomRef) return;
  const nickname = $('hostName').value.trim();
  const error = L.validNickname(nickname);
  if (error) { setError('createError', error); return; }
  setError('createError', '');
  net.busy = true;
  $('btnCreateRoom').disabled = true;
  try {
    if (!await waitAuth()) return;
    const uid = currentUid();
    const joinedAt = RoomkRTDB.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = RoomkRTDB.generateRoomCode();
      const ref = firebaseReady().db.ref(DB_PREFIX + '/' + code);
      const result = await transactRetry(ref, (room) => {
        // やり直しのとき、前の送信で自分が作ったルームが届いていたら、そのまま使う
        if (room) return room.hostUid === uid && room.players?.[nickname]?.joinedAt === joinedAt ? room : undefined;
        return {
          status: S.WAITING,
          host: nickname,
          hostUid: uid,
          hostConnected: true,
          hostDisconnectedAt: null,
          createdAt: serverTimestamp(),
          settings: { hostPlays: true, order: 'turn', level: 'two' },
          players: { [nickname]: { isHost: true, uid, joinedAt } },
        };
      });
      if (result.committed) {
        window.RoomkStats?.count('room-create');
        connectToRoom('host', nickname, code, ref, joinedAt);
        return;
      }
    }
    setError('createError', 'ルームを作れませんでした。もう一度ためしてね');
  } catch (err) {
    console.warn('[hitomoji-change] create failed', err);
    setError('createError', '接続できませんでした。もう一度ためしてね');
  } finally {
    net.busy = false;
    $('btnCreateRoom').disabled = false;
  }
}

// ルームコード: 全角の英数字は半角に、小文字は大文字にそろえて読む（入力欄は打っている間に書き換えない）
function normalizeRoomCode(raw) {
  return String(raw || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
}
function roomCodeImeError(code) {
  return /[^\x00-\x7F]/.test(code)
    ? 'ルームコードはアルファベットと数字で入れてね。ひらがなになるときは、キーボードを英字に切り替えてね（「半角/全角」キー、Macは「英数」キー）'
    : '';
}

async function joinRoom() {
  if (net.busy || net.roomRef) return;
  const nickname = $('guestName').value.trim();
  const code = normalizeRoomCode($('joinCode').value);
  const error = L.validNickname(nickname);
  if (error) { setError('joinError', error); return; }
  const imeError = roomCodeImeError(code);
  if (imeError) { setError('joinError', imeError); return; }
  if (!ROOM_CODE_PATTERN.test(code)) { setError('joinError', 'ルームコードは6文字で入れてね'); return; }
  setError('joinError', '');
  net.busy = true;
  $('btnJoinRoom').disabled = true;
  let release = null;
  try {
    if (!await waitAuth()) return;
    const ref = firebaseReady().db.ref(DB_PREFIX + '/' + code);
    const warm = await warmRoomCache(ref);
    release = warm.release;
    const initial = warm.snap.val();
    if (!initial) { setError('joinError', 'ルームが見つからないよ。コードを確かめてね'); return; }
    if (isExpired(initial)) {
      await removeExpired(ref, initial);
      setError('joinError', 'このルームは終わったみたい');
      return;
    }
    const uid = currentUid();
    const joinedAt = RoomkRTDB.now();
    let reason = '';
    let rejoinAt = null;
    const result = await transactRetry(ref, (room) => {
      reason = '';
      rejoinAt = null;
      if (!room) { reason = '見つからない'; return; }
      if (isExpired(room)) { reason = '終了'; return; }
      // タブが落ちた直後・送信後の切断のやり直しなど、自分の在室が残っていたら入りなおしとして上書きする
      const stale = room.players?.[nickname];
      const mine = !!stale && !stale.isHost && stale.uid === uid;
      if (nickname === room.host || room.proxies?.[nickname] || (stale && !mine)) { reason = '名前'; return; }
      if (mine) rejoinAt = Number(stale.joinedAt) || joinedAt;
      else if (L.participants(room).length >= L.MAX_PLAYERS) { reason = '満員'; return; }
      return L.addPlayer(room, nickname, { isHost: false, uid, joinedAt: rejoinAt || joinedAt });
    });
    if (!result.committed) {
      const messages = {
        '見つからない': 'ルームが見つからないよ。コードを確かめてね',
        '終了': 'このルームは終わったみたい',
        '名前': 'その名前は使われているよ。少し変えてみてね',
        '満員': 'このルームはいっぱいだよ（遊べるのは' + L.MAX_PLAYERS + '人まで）',
      };
      setError('joinError', messages[reason] || '参加できませんでした。もう一度ためしてね');
      return;
    }
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
  } catch (err) {
    console.warn('[hitomoji-change] join failed', err);
    setError('joinError', '接続できませんでした。もう一度ためしてね');
  } finally {
    release?.();
    net.busy = false;
    $('btnJoinRoom').disabled = false;
  }
}

async function tryReconnect() {
  const saved = loadSession();
  if (!saved || !saved.roomCode || !saved.nickname || !saved.role) return false;
  if (!ROOM_CODE_PATTERN.test(saved.roomCode) || L.validNickname(saved.nickname)) return false;
  if (net.busy || net.roomRef) return false;
  net.busy = true;
  const entry = ['btnGoCreate', 'btnGoJoin', 'btnGoLocal'];
  entry.forEach((id) => { $(id).disabled = true; });
  let release = null;
  try {
    if (!await waitAuth()) return false;
    const uid = currentUid();
    if (!uid || uid !== saved.uid) return false;
    const ref = firebaseReady().db.ref(DB_PREFIX + '/' + saved.roomCode);
    const warm = await warmRoomCache(ref);
    release = warm.release;
    const room = warm.snap.val();
    if (!room) return false;
    if (isExpired(room)) { await removeExpired(ref, room); return false; }
    let joinedAt = Number(saved.joinedAt) || null;
    if (saved.role === 'host') {
      if (room.host !== saved.nickname || room.hostUid !== uid) return false;
      joinedAt = Number(room.players?.[saved.nickname]?.joinedAt) || joinedAt;
    } else if (saved.role === 'guest') {
      if (saved.nickname === room.host || room.proxies?.[saved.nickname]) return false;
      const player = room.players?.[saved.nickname];
      if (player && (player.isHost || player.uid !== uid)) return false;
      if (player) joinedAt = Number(player.joinedAt) || joinedAt;
    } else {
      return false;
    }
    if (net.roomRef) return false;
    connectToRoom(saved.role, saved.nickname, saved.roomCode, ref, joinedAt);
    return true;
  } catch (error) {
    console.warn('[hitomoji-change] reconnect failed', error);
    return false;
  } finally {
    release?.();
    net.busy = false;
    entry.forEach((id) => { $(id).disabled = false; });
  }
}

async function leaveRoom() {
  if (net.busy || !net.roomRef) return;
  const ref = net.roomRef;
  const role = net.role;
  const nickname = net.nickname;
  const uid = currentUid();
  if (role === 'host' && !window.confirm('ルームを閉じると、参加している人の画面もトップに戻ります。閉じますか？')) return;
  net.busy = true;
  net.leaving = true;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      await ref.transaction((room) => {
        if (!room || room.players?.[nickname]?.uid !== uid) return;
        return L.leave(room, nickname) || undefined;
      });
    }
  } catch (error) {
    console.warn('[hitomoji-change] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね');
    net.leaving = false;
    net.busy = false;
    ensurePresence(true);
    if (net.room) handleRoom(net.room);
    return;
  }
  net.busy = false;
  leaveLocally('');
}

/* ── ルームの操作（transaction の中で logic.js の決まりを呼ぶ） ── */
async function roomAct(fn, failMessage) {
  const ref = net.roomRef;
  if (!ref || net.acting) return false;
  net.acting = true;
  let changed = false;
  try {
    const result = await transactRetry(ref, (room) => {
      changed = false;
      if (!room || isExpired(room)) return;
      const next = fn(room);
      if (!next) return;
      changed = true;
      return next;
    });
    if (!result.committed || !changed) {
      if (failMessage) toast(failMessage);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[hitomoji-change] action failed', error);
    toast('うまく送れなかったよ。もう一度ためしてね');
    return false;
  } finally {
    net.acting = false;
  }
}

async function roomMove(pos, ch) {
  const before = net.room ? L.gameOf(net.room) : null;
  const n = before ? before.ladder.length : 0;
  ui.selPos = null;
  const ok = await roomAct((room) => {
    const g = L.gameOf(room);
    // ほかの人が先に変えていたら、ことばがずれるので入れない
    if (!g || g.ladder.length !== n) return null;
    return L.move(room, net.nickname, pos, ch);
  }, 'ほかの人が先に変えたよ。いまのことばを見てね');
  if (ok) {
    const g = L.gameOf(net.room);
    if (g && L.currentWord(g) === g.puzzle.goal) window.RoomkStats?.count('room-clear');
  }
  if (net.room) handleRoom(net.room);
}

// お題を出す（はじめる・次のお題）。2文字・3文字は、ルームでまだ出していないお題から
function puzzleFor(room) {
  const s = L.settingsOf(room);
  if (s.level === 'custom') {
    const r = L.readCustom($('roomCustomStart').value, $('roomCustomGoal').value);
    return r.error ? { error: r.error } : { puzzle: r, key: null, idx: null };
  }
  const n = levelOf(s.level).chars;
  const u = L.unseenIndexes(room, PUZZLES, n);
  let pool = u.rest;
  let seenRoom = room;
  if (!pool.length) {
    // 出しきったら、出したお題の記録を空にして、いま遊んだお題以外から
    seenRoom = { ...room, seen: { ...(room.seen || {}), [u.key]: [] } };
    const cur = L.gameOf(room)?.puzzle;
    pool = u.all.filter((i) => !cur || PUZZLES[i].start !== cur.start || PUZZLES[i].goal !== cur.goal);
  }
  const idx = pool[Math.floor(Math.random() * pool.length)];
  return { puzzle: PUZZLES[idx], key: u.key, idx, room: seenRoom };
}

async function hostStart() {
  if (net.role !== 'host' || !net.room) return;
  const room = net.room;
  if (!L.participants(room).length) {
    $('startNote').textContent = '遊ぶ人がいないよ。「ホストもいっしょに遊ぶ」にするか、参加する人を待ってね';
    return;
  }
  $('startNote').textContent = '';
  if (L.settingsOf(room).level === 'custom') {
    const r = L.readCustom($('roomCustomStart').value, $('roomCustomGoal').value);
    setError('roomCustomError', r.error || '');
    if (r.error) { $('roomCustomStart').focus(); return; }
  }
  const ok = await roomAct((cur) => {
    if (cur.status !== S.WAITING || !L.participants(cur).length) return null;
    const p = puzzleFor(cur);
    if (p.error) return null;
    return L.newGame(p.room || cur, p.puzzle, p.key, p.idx);
  });
  if (ok) {
    const s = L.settingsOf(net.room);
    window.RoomkStats?.count(s.level === 'custom' ? 'room-custom' : 'room-chars' + levelOf(s.level).chars);
    window.RoomkStats?.count('players-' + L.participants(net.room).length);
  }
}

async function hostNext() {
  if (net.role !== 'host' || !net.room) return;
  if (L.settingsOf(net.room).level === 'custom') {
    await roomAct((room) => L.backToWaiting(room));
    return;
  }
  await roomAct((room) => {
    if (room.status !== S.PLAYING) return null;
    const p = puzzleFor(room);
    if (p.error) return null;
    return L.newGame(p.room || room, p.puzzle, p.key, p.idx);
  });
}

async function hostToWaiting() {
  if (net.role !== 'host') return;
  await roomAct((room) => (room.status === S.PLAYING ? L.backToWaiting(room) : null));
}

async function setRoomSetting(key, value) {
  if (net.role !== 'host') return;
  await roomAct((room) => {
    if (room.status !== S.WAITING) return null;
    return { ...room, settings: { ...L.settingsOf(room), [key]: value } };
  });
}

async function addProxy() {
  if (net.role !== 'host' || !net.room) return;
  const name = $('proxyName').value.trim();
  const error = L.validNickname(name);
  if (error) { setError('proxyError', error); return; }
  let reason = '';
  const ok = await roomAct((room) => {
    reason = '';
    if (room.status !== S.WAITING) { reason = 'まだはじまる前だけ足せるよ'; return null; }
    if (name === room.host || room.players?.[name] || room.proxies?.[name]) { reason = 'その名前は使われているよ'; return null; }
    if (Object.keys(room.proxies || {}).length >= L.MAX_PROXIES) { reason = '端末のない人は' + L.MAX_PROXIES + '人まで足せるよ'; return null; }
    if (L.participants(room).length >= L.MAX_PLAYERS) { reason = 'このルームはいっぱいだよ'; return null; }
    return { ...room, proxies: { ...(room.proxies || {}), [name]: { addedAt: RoomkRTDB.now() } } };
  });
  setError('proxyError', ok ? '' : reason || '足せませんでした。もう一度ためしてね');
  if (ok) $('proxyName').value = '';
}

async function removeProxy(name) {
  await roomAct((room) => {
    if (!room.proxies?.[name]) return null;
    const proxies = { ...room.proxies };
    delete proxies[name];
    return { ...room, proxies };
  });
}

/* ── 画面の更新 ── */
function handleRoom(room) {
  if (net.role === 'guest') {
    const me = room.players?.[net.nickname];
    if (me && me.uid !== currentUid()) {
      leaveLocally('同じ名前の人が参加したので、ルームから外れました');
      return;
    }
  }
  if (net.presenceDirty) ensurePresence(true);
  else if (needsPresence(room)) ensurePresence();
  updateHostOverlay(room);
  if (room.status === S.PLAYING && L.gameOf(room)) {
    const v = view();
    // ことば・番が変わったら、選んでいた文字を外す
    if (v.key !== net.lastKey) ui.selPos = null;
    net.lastKey = v.key;
    showScreen('screen-play');
    renderPlay();
  } else {
    net.lastKey = '';
    ui.selPos = null;
    $('clearArea').hidden = true;
    showScreen('screen-waiting');
    renderWaiting(room);
  }
}

function updateHostOverlay(room) {
  if (net.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    // 切れたままのあいだに切れた時刻だけが新しくなったら、期限のタイマーを仕掛けなおす
    if (net.orphanTimer && net.orphanAt !== RoomkRTDB.getHostDisconnectedAt(room)) { clearTimeout(net.orphanTimer); net.orphanTimer = null; }
    if (!net.orphanTimer) {
      net.orphanAt = RoomkRTDB.getHostDisconnectedAt(room);
      const ref = net.roomRef;
      const at = net.orphanAt;
      const delay = at == null ? ORPHAN_TTL_MS : Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now());
      net.orphanTimer = setTimeout(() => {
        net.orphanTimer = null;
        if (net.roomRef === ref && net.room) removeExpired(ref, net.room);
      }, delay);
    }
  } else {
    $('hostOffOverlay').hidden = true;
    clearTimeout(net.orphanTimer);
    net.orphanTimer = null;
  }
}

function renderWaiting(room) {
  const isHost = net.role === 'host';
  const s = L.settingsOf(room);
  const list = L.participants(room);
  $('waitingCount').textContent = '遊ぶ人 ' + list.length + '人';
  const ul = $('waitingPlayers');
  ul.textContent = '';
  const addRow = (name, tags, onRemove) => {
    const li = document.createElement('li');
    li.className = 'hmc-person';
    const n = document.createElement('span');
    n.className = 'hmc-person__name';
    n.textContent = name;
    li.appendChild(n);
    tags.forEach((tag) => {
      const t = document.createElement('span');
      t.className = 'hmc-person__tag';
      t.textContent = tag;
      li.appendChild(t);
    });
    if (onRemove) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-ghost btn-sm hmc-person__remove';
      b.textContent = '外す';
      b.setAttribute('aria-label', name + 'を外す');
      b.addEventListener('click', onRemove);
      li.appendChild(b);
    }
    ul.appendChild(li);
  };
  if (!s.hostPlays) addRow(room.host, ['進行役'].concat(room.host === net.nickname ? ['あなた'] : []), null);
  list.forEach((p) => {
    const tags = [];
    if (p.host) tags.push('ホスト');
    if (p.name === net.nickname) tags.push('あなた');
    // 端末なしの印はホストの画面にだけ出す
    if (p.proxy && isHost) tags.push('端末なし');
    addRow(p.name, tags, p.proxy && isHost ? () => removeProxy(p.name) : null);
  });
  const orderLabel = ORDER_ITEMS.find((o) => o.id === s.order).label;
  $('waitingSettings').textContent = '変える人: ' + orderLabel + ' ／ お題: ' + levelOf(s.level).label;
  $('hostWaitingTools').hidden = !isHost;
  $('guestWaitingNote').hidden = isHost;
  if (!isHost) return;

  $('hostPlays').checked = s.hostPlays;
  const seg = $('roomOrder');
  seg.textContent = '';
  ORDER_ITEMS.forEach((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = o.label;
    b.dataset.order = o.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(s.order === o.id));
    b.addEventListener('click', () => setRoomSetting('order', o.id));
    seg.appendChild(b);
  });
  $('roomOrderNote').textContent = ORDER_ITEMS.find((o) => o.id === s.order).note;
  renderLevelGrid($('roomLevelGrid'), s.level, (id) => {
    setError('roomCustomError', '');
    setRoomSetting('level', id);
    if (id === 'custom') setTimeout(() => $('roomCustomStart').focus(), 0);
  });
  $('roomCustomForm').hidden = s.level !== 'custom';
  const full = list.length >= L.MAX_PLAYERS;
  $('btnAddProxy').disabled = full || Object.keys(room.proxies || {}).length >= L.MAX_PROXIES;
}

function renderTurn() {
  const bar = $('turnBar');
  if (ui.mode !== 'room' || !net.room) { bar.hidden = true; return; }
  const room = net.room;
  const g = L.gameOf(room);
  if (!g || g.cleared) { bar.hidden = true; return; }
  const s = L.settingsOf(room);
  const me = net.nickname;
  let text;
  bar.classList.remove('is-mine');
  if (s.order === 'free') {
    text = L.isParticipant(room, me) || net.role === 'host' ? 'だれが変えてもいいよ。思いついたら変えてね' : 'だれが変えてもいいよ';
  } else {
    const turn = L.turnOf(room);
    if (!turn) text = '遊ぶ人がいないよ';
    else if (turn === me) { text = 'あなたの番！変える文字を押してね'; bar.classList.add('is-mine'); }
    else if (net.role === 'host' && L.isProxy(room, turn)) { text = turn + 'の番。代わりに入れてね'; bar.classList.add('is-mine'); }
    else text = turn + 'の番';
  }
  $('turnText').textContent = text;
  $('btnPass').hidden = !L.canPass(room, me);
  bar.hidden = false;
}

/* ════════════ ボタンと入口 ════════════ */

function openJoin(code, fromLink) {
  $('joinCode').value = code || '';
  $('joinLinkHint').hidden = !fromLink;
  setError('joinError', '');
  showScreen('screen-join');
  $('guestName').focus();
}

$('btnGoCreate').addEventListener('click', () => { setError('createError', ''); showScreen('screen-create'); $('hostName').focus(); });
$('btnGoJoin').addEventListener('click', () => openJoin('', false));
$('btnGoLocal').addEventListener('click', () => { renderLocalSetup(); showScreen('screen-local'); });
['btnLocalBack', 'btnCreateBack', 'btnJoinBack'].forEach((id) => $(id).addEventListener('click', () => showScreen('screen-top')));
$('btnStart').addEventListener('click', startLocal);
$('btnCreateRoom').addEventListener('click', createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
const enterTo = (inputIds, fn) => inputIds.forEach((id) => $(id).addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); fn(); }
}));
enterTo(['hostName'], createRoom);
enterTo(['guestName', 'joinCode'], joinRoom);
enterTo(['customStart', 'customGoal'], startLocal);
enterTo(['proxyName'], addProxy);
enterTo(['roomCustomStart', 'roomCustomGoal'], hostStart);

$('btnCopyCode').addEventListener('click', (e) => RoomkRTDB.copyRoomCode(net.roomCode, e.currentTarget));
$('btnCopyLink').addEventListener('click', (e) => RoomkRTDB.copyRoomLink(net.roomCode, e.currentTarget));
$('btnShowQr').addEventListener('click', () => {
  if (!net.roomCode) { toast('ルームコードがありません'); return; }
  window.RoomkQR?.show(net.roomCode);
});
$('btnLeave').addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);
$('hostPlays').addEventListener('change', (e) => setRoomSetting('hostPlays', e.currentTarget.checked));
$('btnAddProxy').addEventListener('click', addProxy);
$('btnStartGame').addEventListener('click', hostStart);
$('btnPass').addEventListener('click', () => roomAct((room) => L.pass(room, net.nickname)));
$('btnToWaiting').addEventListener('click', hostToWaiting);

$('btnSkip').addEventListener('click', () => (ui.mode === 'room' ? hostNext() : nextLocal()));
$('btnPadClose').addEventListener('click', closePad);
$('btnUndo').addEventListener('click', undo);
$('btnHint').addEventListener('click', showHint);
$('btnNext').addEventListener('click', () => (ui.mode === 'room' ? hostNext() : nextLocal()));
$('btnTop').addEventListener('click', () => (ui.mode === 'room' ? hostToWaiting() : backToTop()));
$('btnPlayTop').addEventListener('click', backToTop);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('pad').hidden && !document.querySelector('.howto-overlay.show')) closePad();
});

/* ── はじめ（参加用のリンク・再読み込み） ── */
async function boot() {
  showScreen('screen-top');
  const params = new URLSearchParams(location.search);
  if (params.has('room')) {
    const code = normalizeRoomCode(params.get('room'));
    if (!ROOM_CODE_PATTERN.test(code)) {
      toast('ルームコードが正しくないよ');
      history.replaceState(null, '', location.pathname);
    } else {
      const saved = loadSession();
      // 同じルームの記録が残っていれば、名前を入れなおさずに戻る。戻れなければ参加画面へ
      if (saved && saved.roomCode === code) {
        if (await tryReconnect()) return;
        clearSession();
      } else if (saved) {
        // 別のルームの記録が残っていても、ひらいたリンクのルームを優先する
        clearSession();
      }
      openJoin(code, true);
      return;
    }
  }
  if (loadSession()) await tryReconnect();
}
boot();

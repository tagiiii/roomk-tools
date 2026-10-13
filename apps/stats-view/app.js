// =============================================
// 利用状況ダッシュボード（開発者専用）
//
// 読み取り専用。Realtime Database の `stats/{アプリ名}/{YYYY-MM}/{項目}` を
// アプリごとに get() して、選択月の起動回数（open）と内訳、
// ルーム型アプリの遊ばれ方（room-create / start / players-N / finish / again）を表示する。
// 書き込みは一切行わない。自分自身の閲覧も計測しない（stats.js を読み込まない）。
//
// 仕様の正本: apps/stats-view/AGENTS.md
// =============================================

import { getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getDatabase, get, ref } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

// stats.js の FIREBASE_CONFIG と同一内容（databaseURL 必須）
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC0bqQdDJeTAWrqFYqjOT1NsVFiunPemIw',
  authDomain: 'roomk-tools.firebaseapp.com',
  databaseURL: 'https://roomk-tools-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'roomk-tools',
  storageBucket: 'roomk-tools.firebasestorage.app',
  messagingSenderId: '592193782148',
  appId: '1:592193782148:web:1529f47cebab7dcd109dd1',
};

const FIREBASE_APP_NAME = 'roomk-stats-view';
const MONTH_RE = /^\d{4}-\d{2}$/;
// RTDB のキーに使える文字だけを許可（パスに . # $ [ ] を混ぜない）
const APP_NAME_RE = /^[A-Za-z0-9_-]+$/;
// ポータルに載らないがカウンタを持つ擬似アプリ名（stats.js の detectAppName）
const EXTRA_APPS = ['portal'];

// ルーム型で共通に使う項目名（正本: docs/development/shared-modules.md）
const PLAYERS_RE = /^players-(\d{1,2})$/;
// 「開始」の1回の単位（表示のラベルだけに使う。正本は各アプリの AGENTS.md「利用回数」。
// ここにないアプリは単位のラベルを出さないだけで、数字はそのまま出る）
const UNIT_LABEL = { game: '1回＝1ゲーム', round: '1回＝1ラウンド' };
const UNIT_BY_APP = {};
['career-sugoroku', 'esadori', 'jinro', 'kaburazu-hint', 'kagi-awase', 'kotoba-pair', 'kotoba-tantei', 'name-change',
  'oekaki-dengon', 'oshitsuke-zukan', 'pita-hame', 'quiz', 'stamp-ate', 'suki-bingo', 'tatoe-narabe', 'word-wolf',
].forEach((name) => { UNIT_BY_APP[name] = 'game'; });
['blackjack', 'do-mannaka', 'ikutsu-ieru', 'kakure-number', 'kimochi-ate', 'koedake-theater', 'kossori-word', 'magire-eshi',
  'minna-ranking', 'moji-soroe', 'pittari-meter', 'tatoe-gp', 'toomawashi', 'uso-jisho',
].forEach((name) => { UNIT_BY_APP[name] = 'round'; });

// エラーは生の英語メッセージを出さず、日本語の固定文言に置き換える
const MSG = {
  portal: 'アプリ一覧を読み込めませんでした。通信状況を確認して、もう一度読み込んでください。',
  read: 'データを読み込めませんでした。ログイン（匿名認証）か通信に失敗した可能性があります。もう一度読み込んでください。',
};

const el = {
  toolbar: document.getElementById('toolbar'),
  monthSelect: document.getElementById('monthSelect'),
  btnReload: document.getElementById('btnReload'),
  btnRetry: document.getElementById('btnRetry'),
  summary: document.getElementById('summary'),
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  errorText: document.getElementById('errorText'),
  empty: document.getElementById('empty'),
  emptyTitle: document.getElementById('emptyTitle'),
  tableBody: document.getElementById('tableBody'),
  roomSection: document.getElementById('roomSection'),
  roomEmpty: document.getElementById('roomEmpty'),
  roomBody: document.getElementById('roomBody'),
  kpis: document.getElementById('kpis'),
  dist: document.getElementById('dist'),
  roomTableBody: document.getElementById('roomTableBody'),
  openSection: document.getElementById('openSection'),
};

// アプリ名 → { 月キー → { 項目 → 回数 } }
let stats = {};
let months = [];
let loading = false;

// ─────────────────────────────────────────────
// Firebase（匿名認証の完了を待ってから読む）
// ─────────────────────────────────────────────
let dbPromise = null;

function ensureDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      let app;
      try {
        app = getApp(FIREBASE_APP_NAME);
      } catch (_) {
        app = initializeApp(FIREBASE_CONFIG, FIREBASE_APP_NAME);
      }
      await signInAnonymously(getAuth(app));
      return getDatabase(app);
    })().catch((err) => {
      dbPromise = null; // 再読み込みでリトライできるようにする
      throw err;
    });
  }
  return dbPromise;
}

// ─────────────────────────────────────────────
// アプリ一覧はポータル（apps/index.html）を正本にする
//   新アプリを追加してもこのページの変更は不要
// ─────────────────────────────────────────────
async function fetchAppNames() {
  const res = await fetch('../index.html', { cache: 'no-store' });
  if (!res.ok) throw new Error('portal');
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const folders = new Set();
  doc.querySelectorAll('a.app-card[href]').forEach((a) => {
    const href = (a.getAttribute('href') || '').trim();
    // 相対パス以外（絶対 URL・ルート相対・アンカー）は対象外
    if (!href || href.startsWith('#') || href.startsWith('/') || /^[a-z]+:/i.test(href)) return;
    // href は "quiz/" 形式。先頭セグメントがフォルダ名
    const folder = href.replace(/[?#].*$/, '').split('/').filter(Boolean)[0];
    if (folder && APP_NAME_RE.test(folder)) folders.add(folder);
  });
  // 1件も取れないのはポータルのマークアップ変更・取得失敗。
  // 空のまま進めると「データがない」と誤読させるのでエラーにする
  if (folders.size === 0) throw new Error('portal');
  return [...new Set([...folders, ...EXTRA_APPS])].sort();
}

// ─────────────────────────────────────────────
// 読み取り
//   stats 直下の一括 get はルール上 Permission denied になるため
//   必ずアプリごとに読む。データのないアプリは null（正常系）
// ─────────────────────────────────────────────
async function fetchStats(db, appNames) {
  const results = await Promise.all(appNames.map(async (name) => {
    try {
      const snap = await get(ref(db, 'stats/' + name));
      return { name, value: snap.exists() ? snap.val() : null, ok: true };
    } catch (_) {
      return { name, value: null, ok: false };
    }
  }));

  // 1件も読めなかったときだけエラー扱い（認証・通信の失敗）
  if (results.length > 0 && results.every((r) => !r.ok)) throw new Error('read');

  const table = {};
  const monthSet = new Set();
  results.forEach(({ name, value }) => {
    if (!value || typeof value !== 'object') return;
    const byMonth = {};
    Object.entries(value).forEach(([monthKey, items]) => {
      if (!MONTH_RE.test(monthKey) || !items || typeof items !== 'object') return;
      const counts = {};
      Object.entries(items).forEach(([item, count]) => {
        const n = Number(count);
        counts[item] = Number.isFinite(n) ? n : 0;
      });
      byMonth[monthKey] = counts;
      monthSet.add(monthKey);
    });
    if (Object.keys(byMonth).length > 0) table[name] = byMonth;
  });

  return { table, months: [...monthSet].sort().reverse() };
}

// ─────────────────────────────────────────────
// 表示
// ─────────────────────────────────────────────
function setState(state) {
  el.loading.hidden = state !== 'loading';
  el.error.hidden = state !== 'error';
  el.empty.hidden = state !== 'empty';
  el.roomSection.hidden = state !== 'ready';
  el.openSection.hidden = state !== 'ready';
  el.toolbar.hidden = state !== 'ready' && state !== 'empty';
}

function showError(key) {
  el.errorText.textContent = MSG[key] || MSG.read;
  el.toolbar.hidden = true;
  setState('error');
}

function formatCount(n) {
  return n.toLocaleString('ja-JP');
}

function formatMonth(monthKey) {
  const [year, month] = monthKey.split('-');
  return Number(year) + '年' + Number(month) + '月';
}

// open を先頭に、残りは回数の多い順
function sortItems(counts) {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => {
      if (a.key === 'open' && b.key !== 'open') return -1;
      if (b.key === 'open' && a.key !== 'open') return 1;
      return b.count - a.count || a.key.localeCompare(b.key);
    });
}

function buildDetailRow(id, items) {
  const tr = document.createElement('tr');
  tr.className = 'sv-detail';
  tr.id = id;
  tr.hidden = true;

  const td = document.createElement('td');
  td.colSpan = 3;

  const list = document.createElement('ul');
  list.className = 'sv-items';

  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'sv-items__empty';
    li.textContent = 'この月の項目はありません';
    list.append(li);
  } else {
    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'sv-items__row';
      const key = document.createElement('span');
      key.className = 'sv-items__key';
      key.textContent = item.key;
      const count = document.createElement('span');
      count.className = 'sv-items__count';
      count.textContent = formatCount(item.count) + ' 回';
      li.append(key, count);
      list.append(li);
    });
  }

  td.append(list);
  tr.append(td);
  return tr;
}

function buildRow(row, maxOpen) {
  const detailId = 'sv-detail-' + row.name;

  const tr = document.createElement('tr');
  tr.className = 'sv-row';

  // アプリ名（アコーディオンのトグル。button なのでキーボードでも操作できる）
  const tdName = document.createElement('td');
  tdName.className = 'sv-row__namecell';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sv-row__toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', detailId);
  const chevron = document.createElement('span');
  chevron.className = 'material-symbols-rounded sv-row__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = 'chevron_right';
  const label = document.createElement('span');
  label.className = 'sv-row__label';
  label.textContent = row.name;
  toggle.append(chevron, label);
  tdName.append(toggle);

  // 起動回数
  const tdCount = document.createElement('td');
  tdCount.className = 'sv-row__count';
  tdCount.textContent = formatCount(row.open);

  // CSS だけの横棒（最大値比）
  const tdBar = document.createElement('td');
  tdBar.className = 'sv-row__barcell';
  const track = document.createElement('div');
  track.className = 'sv-bar';
  const fill = document.createElement('div');
  fill.className = 'sv-bar__fill';
  const ratio = maxOpen > 0 ? (row.open / maxOpen) * 100 : 0;
  fill.style.width = ratio.toFixed(1) + '%';
  track.append(fill);
  tdBar.append(track);

  tr.append(tdName, tdCount, tdBar);

  const detail = buildDetailRow(detailId, row.items);

  // 行のどこを押しても開閉する（button の click もここへバブリングする）
  tr.addEventListener('click', () => {
    const willOpen = detail.hidden;
    detail.hidden = !willOpen;
    tr.classList.toggle('is-open', willOpen);
    toggle.setAttribute('aria-expanded', String(willOpen));
    chevron.textContent = willOpen ? 'expand_more' : 'chevron_right';
  });

  return [tr, detail];
}

// ─────────────────────────────────────────────
// ルームの遊ばれ方
//   グラフライブラリは使わず、横棒は CSS の width だけで描く
// ─────────────────────────────────────────────
// 1アプリ・1か月ぶんの項目から、ルームの共通項目だけを取り出す
function roomCounts(counts) {
  const players = [];
  Object.entries(counts).forEach(([key, count]) => {
    const m = PLAYERS_RE.exec(key);
    if (m && count > 0) players.push({ n: Number(m[1]), count });
  });
  players.sort((a, b) => a.n - b.n);
  const num = (key) => Math.max(0, Number(counts[key]) || 0);
  return {
    rooms: num('room-create'),
    start: num('start'),
    finish: num('finish'),
    again: num('again'),
    players,
  };
}

// ルームの記録があるアプリだけを対象にする。start・finish はルームのないツール
// （tsuyomi-card など）も同じ名前で数えているので、room-create か players-N で見分ける
function hasRoomData(room) {
  return room.rooms > 0 || room.players.length > 0;
}

// いちばん多い人数（同じ回数で並んだら、並んだ人数をすべて返す）
function topPlayers(players) {
  const max = players.reduce((m, p) => Math.max(m, p.count), 0);
  return max > 0 ? players.filter((p) => p.count === max) : [];
}

function formatPct(part, whole) {
  return Math.round((part / whole) * 100) + '%';
}

// 棒・メーターの上に出す小さな説明。数字はすべて画面にも出しているので、補足だけ
const tip = document.createElement('div');
tip.className = 'sv-tip';
tip.hidden = true;
document.body.append(tip);

function attachTip(target, lines) {
  const show = (ev) => {
    tip.replaceChildren(...lines.map((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      return p;
    }));
    tip.hidden = false;
    const pad = 12;
    const rect = tip.getBoundingClientRect();
    const x = Math.min(ev.clientX + pad, window.innerWidth - rect.width - pad);
    const y = ev.clientY + pad + rect.height > window.innerHeight ? ev.clientY - rect.height - pad : ev.clientY + pad;
    tip.style.left = Math.max(pad, x) + 'px';
    tip.style.top = Math.max(pad, y) + 'px';
  };
  target.addEventListener('pointerenter', show);
  target.addEventListener('pointermove', show);
  target.addEventListener('pointerleave', () => { tip.hidden = true; });
}

function buildKpi(label, value, sub) {
  const wrap = document.createElement('div');
  wrap.className = 'sv-kpi';
  const dt = document.createElement('dt');
  dt.className = 'sv-kpi__label';
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.className = 'sv-kpi__value';
  dd.textContent = value;
  wrap.append(dt, dd);
  if (sub) {
    const note = document.createElement('dd');
    note.className = 'sv-kpi__sub';
    note.textContent = sub;
    wrap.append(note);
  }
  return wrap;
}

// 人数ごとの横棒（全アプリの合計）。値は棒の先に書く
function buildDistRow(entry, max, total) {
  const li = document.createElement('li');
  li.className = 'sv-dist__row';
  const label = document.createElement('span');
  label.className = 'sv-dist__label';
  label.textContent = entry.n + '人';
  const plot = document.createElement('span');
  plot.className = 'sv-dist__plot';
  const bar = document.createElement('span');
  bar.className = 'sv-dist__bar';
  // 棒の先に値を書く場所を残す（いちばん長い棒で 86%）
  bar.style.width = (max > 0 ? (entry.count / max) * 86 : 0).toFixed(1) + '%';
  const value = document.createElement('span');
  value.className = 'sv-dist__value';
  value.textContent = formatCount(entry.count) + '回';
  plot.append(bar, value);
  li.append(label, plot);
  attachTip(li, [
    entry.n + '人で始めた回: ' + formatCount(entry.count) + '回（' + formatPct(entry.count, total) + '）',
    ...entry.apps.map((a) => a.name + ' ' + formatCount(a.count) + '回'),
  ]);
  return li;
}

// 割合のメーター。分母が 0 のときは「—」
function buildMeterCell(part, whole, partLabel, wholeLabel) {
  const td = document.createElement('td');
  td.className = 'sv-room__metercell';
  if (whole <= 0) {
    td.classList.add('is-empty');
    td.textContent = '—';
    return td;
  }
  const meter = document.createElement('div');
  meter.className = 'sv-meter';
  meter.setAttribute('role', 'img');
  meter.setAttribute('aria-label', formatPct(part, whole) + '（' + wholeLabel + ' ' + whole + '回のうち ' + partLabel + ' ' + part + '回）');
  const track = document.createElement('div');
  track.className = 'sv-meter__track';
  const fill = document.createElement('div');
  fill.className = 'sv-meter__fill';
  fill.style.width = Math.min(100, (part / whole) * 100).toFixed(1) + '%';
  track.append(fill);
  const pct = document.createElement('span');
  pct.className = 'sv-meter__pct';
  pct.textContent = formatPct(part, whole);
  const frac = document.createElement('span');
  frac.className = 'sv-meter__frac';
  frac.textContent = formatCount(part) + '/' + formatCount(whole);
  meter.append(track, pct, frac);
  td.append(meter);
  attachTip(td, [partLabel + ' ' + formatCount(part) + '回 ÷ ' + wholeLabel + ' ' + formatCount(whole) + '回']);
  return td;
}

function buildRoomRow(row) {
  const tr = document.createElement('tr');
  tr.className = 'sv-room';

  const th = document.createElement('th');
  th.scope = 'row';
  th.className = 'sv-room__name';
  const name = document.createElement('span');
  name.className = 'sv-room__app';
  name.textContent = row.name;
  th.append(name);
  const unit = UNIT_LABEL[UNIT_BY_APP[row.name]];
  if (unit) {
    const unitEl = document.createElement('span');
    unitEl.className = 'sv-room__unit';
    unitEl.textContent = unit;
    th.append(unitEl);
  }

  const tdRooms = document.createElement('td');
  tdRooms.className = 'sv-room__num';
  tdRooms.textContent = formatCount(row.rooms);
  const tdStart = document.createElement('td');
  tdStart.className = 'sv-room__num';
  tdStart.textContent = formatCount(row.start);

  const tdPlayers = document.createElement('td');
  tdPlayers.className = 'sv-room__players';
  if (row.players.length === 0) {
    tdPlayers.classList.add('is-empty');
    tdPlayers.textContent = '—';
  } else {
    // いちばん多い人数が1つに決まるときだけ、その人数を目立たせる
    const tops = topPlayers(row.players);
    const mode = tops.length === 1 ? tops[0] : null;
    row.players.forEach((p) => {
      const chip = document.createElement('span');
      chip.className = 'sv-chip' + (p === mode ? ' is-top' : '');
      const n = document.createElement('span');
      n.className = 'sv-chip__n';
      n.textContent = p.n + '人';
      const c = document.createElement('span');
      c.className = 'sv-chip__count';
      c.textContent = '×' + formatCount(p.count);
      chip.append(n, c);
      tdPlayers.append(chip);
    });
  }

  tr.append(
    th, tdRooms, tdStart,
    buildMeterCell(row.finish, row.start, '最後まで進んだ', '開始'),
    buildMeterCell(row.again, row.finish, '続けてもう1回', '最後まで進んだ'),
    tdPlayers,
  );
  return tr;
}

function renderRooms(monthKey) {
  const rows = Object.entries(stats)
    .filter(([, byMonth]) => byMonth[monthKey])
    .map(([name, byMonth]) => ({ name, ...roomCounts(byMonth[monthKey]) }))
    .filter(hasRoomData)
    .sort((a, b) => b.rooms - a.rooms || b.start - a.start || a.name.localeCompare(b.name));

  el.kpis.replaceChildren();
  el.dist.replaceChildren();
  el.roomTableBody.replaceChildren();
  tip.hidden = true;

  el.roomEmpty.hidden = rows.length > 0;
  el.roomBody.hidden = rows.length === 0;
  if (rows.length === 0) return;

  // 人数ごとの合計（どのアプリの分かも持つ）
  const byN = new Map();
  rows.forEach((row) => row.players.forEach((p) => {
    if (!byN.has(p.n)) byN.set(p.n, { n: p.n, count: 0, apps: [] });
    const entry = byN.get(p.n);
    entry.count += p.count;
    entry.apps.push({ name: row.name, count: p.count });
  }));
  const dist = [...byN.values()].sort((a, b) => a.n - b.n);
  dist.forEach((entry) => entry.apps.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)));
  const distTotal = dist.reduce((sum, entry) => sum + entry.count, 0);
  const distMax = dist.reduce((max, entry) => Math.max(max, entry.count), 0);
  const tops = topPlayers(dist);

  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  el.kpis.append(
    buildKpi('作られたルーム', formatCount(sum('rooms')), rows.length + ' アプリ'),
    buildKpi('始まった回', formatCount(sum('start')), 'ゲームとラウンドの合計'),
    buildKpi('最後まで進んだ回', formatCount(sum('finish')), null),
    buildKpi(
      'いちばん多い人数',
      tops.length ? tops.map((p) => p.n + '人').join('・') : '—',
      tops.length ? formatCount(distTotal) + '回のうち' + (tops.length > 1 ? 'それぞれ' : '') + formatCount(tops[0].count) + '回' : null,
    ),
  );

  if (dist.length === 0) {
    const li = document.createElement('li');
    li.className = 'sv-dist__empty';
    li.textContent = 'この月は、人数の記録がありません。';
    el.dist.append(li);
  } else {
    dist.forEach((entry) => el.dist.append(buildDistRow(entry, distMax, distTotal)));
  }

  rows.forEach((row) => el.roomTableBody.append(buildRoomRow(row)));
}

function renderMonth(monthKey) {
  const rows = Object.entries(stats)
    .filter(([, byMonth]) => byMonth[monthKey])
    .map(([name, byMonth]) => {
      const counts = byMonth[monthKey];
      return {
        name,
        open: Number(counts.open) || 0,
        items: sortItems(counts),
      };
    })
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));

  el.tableBody.replaceChildren();

  if (rows.length === 0) {
    el.emptyTitle.textContent = formatMonth(monthKey) + 'のデータはありません';
    setState('empty');
    return;
  }

  const maxOpen = rows.reduce((max, row) => Math.max(max, row.open), 0);
  const totalOpen = rows.reduce((sum, row) => sum + row.open, 0);
  rows.forEach((row) => el.tableBody.append(...buildRow(row, maxOpen)));

  el.summary.textContent =
    formatMonth(monthKey) + ' — ' + rows.length + ' アプリ / 起動あわせて ' + formatCount(totalOpen) + ' 回';
  renderRooms(monthKey);
  setState('ready');
}

// ─────────────────────────────────────────────
// 読み込み
// ─────────────────────────────────────────────
async function load() {
  if (loading) return;
  loading = true;
  setState('loading');

  try {
    const [appNames, db] = await Promise.all([fetchAppNames(), ensureDb()]);
    const result = await fetchStats(db, appNames);
    stats = result.table;
    months = result.months;

    if (months.length === 0) {
      el.monthSelect.replaceChildren();
      el.emptyTitle.textContent = 'まだデータがありません';
      setState('empty');
      el.toolbar.hidden = true;
      return;
    }

    el.monthSelect.replaceChildren();
    months.forEach((monthKey) => {
      const option = document.createElement('option');
      option.value = monthKey;
      option.textContent = formatMonth(monthKey);
      el.monthSelect.append(option);
    });
    el.monthSelect.value = months[0]; // 最新月をデフォルト選択
    renderMonth(months[0]);
  } catch (err) {
    showError(err && err.message === 'portal' ? 'portal' : 'read');
  } finally {
    loading = false;
  }
}

el.monthSelect.addEventListener('change', () => {
  if (el.monthSelect.value) renderMonth(el.monthSelect.value);
});
el.btnReload.addEventListener('click', load);
el.btnRetry.addEventListener('click', load);

load();

// =============================================
// 利用状況ダッシュボード（開発者専用）
//
// 読み取り専用。Realtime Database の `stats/{アプリ名}/{YYYY-MM}/{項目}` を
// アプリごとに get() して、選択月の起動回数（open）と内訳を表示する。
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
  tableWrap: document.getElementById('tableWrap'),
  tableBody: document.getElementById('tableBody'),
  note: document.getElementById('note'),
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
  el.tableWrap.hidden = state !== 'ready';
  el.note.hidden = state !== 'ready';
  el.summary.hidden = state !== 'ready';
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

#!/usr/bin/env node
// ツール一覧の「よく開かれたツール」を作る（週1回、手元で実行してコミットする）。
// 利用回数（RTDB の stats/）は月ごとの回数しかないので、実行のたびに各アプリの累計を
// スナップショットに残し、約1週間前のスナップショットとの差を「この1週間」の回数にする。
//
//   node scripts/ranking-build.mjs            apps/ranking.json と scripts/ranking-snapshots.json を書く
//   node scripts/ranking-build.mjs --dry-run  書かずに結果だけ出す
//
// 必要なもの: Firebase のサービスアカウント鍵（JSON）。環境変数 FEEDBACK_SA_JSON か
//   ~/.config/roomk/feedback-sa.json。stats/ を読むだけで、書き込みはしない。
//
// apps/ranking.json には順位（アプリのフォルダ名）だけを書き、回数は書かない。
//   apps:  「よく開かれたツール」の欄に出す上位（TOP_N まで。少なすぎる週は空）
//   order: ポータルの全アプリの順番。ツール一覧の「よく開かれた順」に使う
// ポータルは画面共有で子どもが見ることもあるため（stats.js「子ども向け画面に計測値を表示しない」）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { homedir } from 'node:os';

const DB_URL = 'https://roomk-tools-default-rtdb.asia-southeast1.firebasedatabase.app';
const PORTAL_HTML = 'apps/index.html';
const RANKING_JSON = 'apps/ranking.json';
const SNAPSHOTS_JSON = 'scripts/ranking-snapshots.json';
const TOP_N = 5;
const MIN_OPENS = 3;       // これより少ないアプリは載せない
const MIN_APPS = 3;        // 載せられるアプリがこれより少なければ欄ごと出さない
const WEEK_MIN_DAYS = 6;   // これ以上前のスナップショットのうち、いちばん新しいものと比べる
const KEEP_SNAPSHOTS = 8;
const dryRun = process.argv.includes('--dry-run');

// サービスアカウント鍵 → アクセストークン（scripts/feedback-pull.mjs と同じ方法）
async function accessToken() {
  const path = process.env.FEEDBACK_SA_JSON || homedir() + '/.config/roomk/feedback-sa.json';
  const sa = JSON.parse(readFileSync(path, 'utf-8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
  });
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature }),
  });
  if (!res.ok) throw new Error('トークンを取れなかった: ' + res.status);
  return (await res.json()).access_token;
}

// 日本時間の日付（YYYY-MM-DD）
function jstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ポータルにカードがあるアプリだけを対象にする（早見表・ポータル非掲載のツールは載せない）
function portalApps() {
  const html = readFileSync(PORTAL_HTML, 'utf-8');
  return new Set([...html.matchAll(/<a class="app-card" href="([^"/]+)\/"/g)].map((m) => m[1]));
}

function rank(counts, totals) {
  const rows = Object.entries(counts)
    .filter(([, n]) => n >= MIN_OPENS)
    .sort((a, b) => b[1] - a[1] || (totals[b[0]] || 0) - (totals[a[0]] || 0) || a[0].localeCompare(b[0]));
  return rows.length >= MIN_APPS ? rows.slice(0, TOP_N) : [];
}

// 一覧の並び順用。回数が同じ（0 も含む）なら累計の多い順
function orderAll(counts, totals) {
  return Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a] || (totals[b] || 0) - (totals[a] || 0) || a.localeCompare(b));
}

const token = await accessToken();
const res = await fetch(`${DB_URL}/stats.json`, { headers: { Authorization: 'Bearer ' + token } });
if (!res.ok) throw new Error('stats を読めなかった: ' + res.status);
const stats = (await res.json()) || {};
const apps = portalApps();

// 各アプリの open の累計（全部の月の合計）
const totals = {};
for (const app of apps) {
  totals[app] = Object.values(stats[app] || {}).reduce((sum, m) => sum + (Number(m?.open) || 0), 0);
}

const now = new Date();
const today = jstDate(now);
const snapshots = existsSync(SNAPSHOTS_JSON) ? JSON.parse(readFileSync(SNAPSHOTS_JSON, 'utf-8')) : [];
const base = snapshots
  .filter((s) => now - Date.parse(s.at) >= WEEK_MIN_DAYS * 24 * 3600 * 1000)
  .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];

let period;
let rows;
let order;
if (base) {
  const counts = {};
  for (const app of apps) counts[app] = totals[app] - (base.totals[app] || 0);
  period = { kind: 'week', from: jstDate(new Date(base.at)), to: today };
  rows = rank(counts, totals);
  order = orderAll(counts, totals);
} else {
  // 比べるスナップショットがまだない（はじめての週）ときは、先月の回数で並べる
  const [y, m] = today.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const counts = {};
  for (const app of apps) counts[app] = Number(stats[app]?.[prev]?.open) || 0;
  period = { kind: 'month', month: prev };
  rows = rank(counts, totals);
  order = orderAll(counts, totals);
}

const ranking = { updated: today, period, apps: rows.map(([app]) => app), order };
console.log(JSON.stringify(ranking, null, 2));
console.log(rows.map(([app, n], i) => `${i + 1}. ${app} ${n}`).join('\n') || '（載せられるアプリが足りないので、欄は出ない）');
if (base) console.log(`比べたスナップショット: ${base.at}`);

if (!dryRun) {
  writeFileSync(RANKING_JSON, JSON.stringify(ranking, null, 2) + '\n');
  const next = [...snapshots, { at: now.toISOString(), totals }].slice(-KEEP_SNAPSHOTS);
  writeFileSync(SNAPSHOTS_JSON, JSON.stringify(next, null, 2) + '\n');
  console.log(`書いた: ${RANKING_JSON} / ${SNAPSHOTS_JSON}`);
}

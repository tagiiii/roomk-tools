// サークルタイム（試作）: room-K ポータル（Notion の公開ページ）から、その日の日中のプログラムを読んで
// apps/circle-time/daily/YYYY-MM-DD.program.json に書く。読むだけ（Notion には書かない）。
// 使い方: node scripts/circle-time/program.mjs [YYYY-MM-DD ...]   （省略時は日本時間のきょうと次の平日）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, '..', '..', 'apps', 'circle-time', 'daily');
const SITE = 'https://katariba.notion.site';
const PAGE_URL = `${SITE}/room-K-277e1247489c4bbe979b0322df284a73`;
const SPACE = 'ed7047d7-c3e4-46ea-8121-b48641fcbc75';
// 日中のプログラム（9:00〜14:30）の2つのデータベースと、その表示（2026-11-07 時点のページの構成）
const REGULAR = { collection: 'fb15e2da-6ad7-8381-a403-87411fee71a1', view: '3ed5e2da-6ad7-80db-bb42-000cc4584c83' };
const ONCE = { collection: '3af5e2da-6ad7-8092-b421-000bb73d8582', view: '3dd5e2da-6ad7-8008-961d-000ca47dfbba' };
const WEEKDAYS = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
const EMOJI = /[\u{1F000}-\u{1FAFF}☀-➿️‍]/gu;

const jst = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d);
function nextWeekday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+09:00');
  do { d.setDate(d.getDate() + 1); } while ([0, 6].includes(d.getDay()));
  return jst(d);
}
async function query({ collection, view }) {
  const res = await fetch(`${SITE}/api/v3/queryCollection?src=initial_load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'roomk-tools-circle-program/0.1' },
    body: JSON.stringify({
      collection: { id: collection, spaceId: SPACE }, collectionView: { id: view, spaceId: SPACE },
      loader: { type: 'reducer', reducers: { collection_group_results: { type: 'results', limit: 300 } }, searchQuery: '', userTimeZone: 'Asia/Tokyo' },
    }),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}`);
  const d = await res.json();
  const rm = d.recordMap || {};
  const unwrap = (b) => (b && b.value && b.value.value) ? b.value.value : (b ? b.value : null);
  const schema = {};
  for (const c of Object.values(rm.collection || {})) Object.assign(schema, unwrap(c)?.schema || {});
  const ids = d.result?.reducerResults?.collection_group_results?.blockIds || [];
  return ids.map((id) => unwrap(rm.block?.[id])).filter(Boolean).map((v) => {
    const row = { _thumb: thumb(v) };
    for (const [k, x] of Object.entries(v.properties || {})) {
      const s = schema[k]; if (!s) continue;
      if (s.type === 'date') { const seg = x.find((t) => Array.isArray(t[1])); row[s.name] = seg?.[1]?.[0]?.[1]?.start_date || ''; }
      else row[s.name] = x.map((t) => t[0]).join('');
    }
    return row;
  });
}
// ページの表紙画像を、公開ページの画像の配信口のアドレスにする（画像はリポジトリに写さない）
function thumb(v) {
  const c = v.format?.page_cover;
  if (!c || !/^(https:|attachment:)/.test(c)) return '';
  return `${SITE}/image/${encodeURIComponent(c)}?table=block&id=${v.id}&spaceId=${SPACE}&width=480&cache=v2`;
}
const clean = (s) => String(s || '').normalize('NFKC').replace(EMOJI, '').replace(/\s+/g, ' ').trim();
function slots(time) {
  return [...clean(time).matchAll(/(\d{1,2}):(\d{2})\s*[~〜～-]\s*(\d{1,2}):(\d{2})/g)]
    .map((m) => ({ start: `${Number(m[1])}:${m[2]}`, end: `${Number(m[3])}:${m[4]}` }));
}
function place(text) {
  return clean(text).split(',').map((s) => s.trim()).filter((s) => s && !/^https?:/.test(s) && [...s].length <= 16).join('・');
}
const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
// 「マイクラde英語(第3月曜)」のように、名前に「第N○曜」があれば、その週だけ
function nthOk(name, date) {
  const m = clean(name).match(/第\s*(\d)\s*[日月火水木金土]曜/);
  if (!m) return true;
  return Math.ceil(Number(date.slice(8, 10)) / 7) === Number(m[1]);
}

const dates = process.argv.slice(2).length ? process.argv.slice(2) : (() => { const t = jst(new Date()); return [t, nextWeekday(t)]; })();
const [regular, once] = await Promise.all([query(REGULAR), query(ONCE)]);
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const date of dates) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日付は YYYY-MM-DD: ' + date);
  const wd = WEEKDAYS[new Date(date + 'T12:00:00+09:00').getDay()];
  const items = [];
  for (const r of regular) {
    const name = clean(r['名前']);
    if (!name || /サークルタイム/.test(name) || !String(r['実施曜日'] || '').includes(wd) || !nthOk(name, date)) continue;
    for (const s of slots(r['開催時間'])) items.push({ ...s, name, place: place(r['実施場所']), once: false, thumb: r._thumb });
  }
  for (const r of once) {
    const name = clean(r['Name']);
    if (!name || r['日付'] !== date) continue;
    const ss = slots(r['開催時間']);
    const where = place(String(r['集合場所'] || '').split(',').filter((s) => !WEEKDAYS.includes(s.trim())).join(','));
    for (const s of (ss.length ? ss : [{ start: '', end: '' }])) items.push({ ...s, name, place: where, once: true, thumb: r._thumb });
  }
  const seen = new Set();
  const uniq = items.filter((i) => { const k = i.start + '|' + i.name; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.start ? minutes(a.start) : 9999) - (b.start ? minutes(b.start) : 9999) || Number(b.once) - Number(a.once));
  const out = { date, weekday: wd, source: 'room-K ポータル（Notion）', url: PAGE_URL, items: uniq, at: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT_DIR, `${date}.program.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(`${date}（${wd}）: ${uniq.length}件 ${uniq.map((i) => `${i.start} ${i.name}${i.once ? '［単発］' : ''}`).join(' / ')}`);
}

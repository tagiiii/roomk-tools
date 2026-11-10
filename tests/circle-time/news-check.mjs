// サークルタイム「自由タイムのニュース」の毎朝のデータを確かめる
// 使い方: node tests/circle-time/news-check.mjs apps/circle-time/daily/2026-11-10.news.json [...]
// 確かめること: 形・長さ・絵文字なし・リンクは https で開ける（404・410 は失敗）・子ども向けに選ばない話題の言葉が入っていない
// 話題の言葉はおおまかな網。選ぶときの判断（circle-daily.md）が本体
import fs from 'node:fs';
import path from 'node:path';

const EMOJI = /[\u{1F000}-\u{1FAFF}☀-➿️]/u;
const UA = { 'User-Agent': 'roomk-tools-circle-daily/0.1 (local check)' };
const NG_WORDS = ['事件', '事故', '災害', '地震', '津波', '台風', '噴火', '火事', '火災', '死', '亡くな', '殺', '戦争', '紛争', '攻撃', '爆', '逮捕', '容疑', '犯罪', '被害', '病気', '感染', 'がん', '選挙', '政党', '首相', '大統領', '宗教', '学校', '授業', '宿題', 'テスト', '試験', '受験', '成績', '登校', '不登校', '恋愛', '交際', '結婚', 'お酒', 'たばこ', 'ホラー', '怖い'];
const LIMIT = { title: 30, text: 140, ask: 30, source: 20, on: 10 };
const len = (s) => [...String(s)].length;

let failed = 0;
const ng = (file, msg) => { failed += 1; console.log(`NG ${file}: ${msg}`); };
for (const file of process.argv.slice(2)) {
  const before = failed;
  const name = path.basename(file).replace(/\.news\.json$/, '');
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { ng(file, 'JSON として読めない ' + e.message); continue; }
  if (d.date !== name || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) ng(file, 'date がファイル名と合わない');
  const items = Array.isArray(d.items) ? d.items : [];
  if (items.length < 1 || items.length > 5) ng(file, 'items は1〜5本（ふだんは3本）');
  else if (items.length < 3) console.log(`  注意 ${file} は${items.length}本（ふだんは3本）`);
  for (const x of items) {
    const label = x?.title || JSON.stringify(x);
    for (const k of ['title', 'text', 'source']) if (typeof x?.[k] !== 'string' || !x[k].trim()) ng(file, `${k} がない: ${label}`);
    for (const [k, max] of Object.entries(LIMIT)) if (x?.[k] !== undefined && len(x[k]) > max) ng(file, `${k} は${max}文字まで: ${label}`);
    if (!/^https:\/\/[^\s]+$/.test(x?.url || '')) ng(file, `url は https のリンク: ${label}`);
    if (EMOJI.test(JSON.stringify(x))) ng(file, '絵文字: ' + label);
    const all = [x?.title, x?.text, x?.ask].join(' ');
    const hit = NG_WORDS.filter((w) => all.includes(w));
    if (hit.length) ng(file, `子ども向けに選ばない話題の言葉（${hit.join('・')}）: ${label}`);
  }
  if (new Set(items.map((x) => x?.title)).size !== items.length) ng(file, '同じ見出しがある');
  for (const x of items) {
    if (!/^https:\/\//.test(x?.url || '')) continue;
    try {
      const res = await fetch(x.url, { headers: UA, redirect: 'follow' });
      if (res.status === 404 || res.status === 410) ng(file, `リンクが開けない（${res.status}）: ${x.url}`);
      else if (!res.ok) console.log(`  注意 ${x.url} は ${res.status}（ロボットを断るサイトかもしれない。ブラウザで開けるか確かめる）`);
    } catch (e) { console.log(`  注意 ${x.url} に届かない（${e.message}）`); }
  }
  if (failed === before) console.log(`ok ${file}（${items.length}本）`);
}
process.exit(failed ? 1 : 0);

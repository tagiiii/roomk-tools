// サークルタイム「今日は何の日」の毎朝のデータを確かめる（読むだけ。Wikipedia の日付ページを見る）
// 使い方: node tests/circle-time/daily-check.mjs apps/circle-time/daily/2026-11-09.json [...]
// 確かめること: 形・長さ・絵文字なし／本当の記念日が、その日のページの「記念日・年中行事」にある／作り話が、そこにない
import fs from 'node:fs';
import path from 'node:path';

const EMOJI = /[\u{1F000}-\u{1FAFF}☀-➿️]/u;
const UA = { 'User-Agent': 'roomk-tools-circle-daily/0.1 (local check)' };
const core = (name) => String(name).replace(/の日$/, '').replace(/^いい/, '');

async function section(month, day) {
  const page = encodeURIComponent(`${month}月${day}日`);
  const res = await fetch(`https://ja.wikipedia.org/w/api.php?action=parse&page=${page}&prop=wikitext&format=json&formatversion=2`, { headers: UA });
  if (!res.ok) throw new Error('wikipedia ' + res.status);
  const w = (await res.json()).parse.wikitext;
  const i = w.indexOf('== 記念日・年中行事 ==');
  if (i < 0) throw new Error('記念日の節が見つからない');
  const rest = w.slice(i + 5);
  const m = rest.search(/\n== [^=]/);
  return m < 0 ? rest : rest.slice(0, m);
}

let failed = 0;
const ng = (file, msg) => { failed += 1; console.log(`NG ${file}: ${msg}`); };
for (const file of process.argv.slice(2)) {
  const name = path.basename(file, '.json');
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { ng(file, 'JSON として読めない ' + e.message); continue; }
  if (d.date !== name || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) ng(file, 'date がファイル名と合わない');
  if (!Array.isArray(d.real) || d.real.length < 1) ng(file, 'real が1つもない');
  if (!Array.isArray(d.fake) || d.fake.length !== 2) ng(file, 'fake は2つ');
  const all = [...(d.real || []), ...(d.fake || [])];
  for (const x of all) {
    if (!x || typeof x.name !== 'string' || !x.name.endsWith('の日') || [...x.name].length > 16) ng(file, 'name は「〜の日」で16文字まで: ' + JSON.stringify(x));
    if (x.note !== undefined && (typeof x.note !== 'string' || [...x.note].length > 40)) ng(file, 'note は40文字まで: ' + x.name);
    if (EMOJI.test(JSON.stringify(x))) ng(file, '絵文字: ' + x.name);
  }
  for (const x of d.real || []) if (!x.note) ng(file, '本当の記念日に note がない: ' + x.name);
  if (new Set(all.map((x) => x.name)).size !== all.length) ng(file, '同じ名前がある');
  const [, mo, da] = d.date.split('-').map(Number);
  let sec;
  try { sec = await section(mo, da); } catch (e) { ng(file, e.message); continue; }
  for (const x of d.real || []) if (!sec.includes(core(x.name))) ng(file, `本当の記念日がページにない: ${x.name}`);
  for (const x of d.fake || []) if (sec.includes(core(x.name))) ng(file, `作り話がページにある（本当の記念日かもしれない）: ${x.name}`);
  if (!failed) console.log(`ok ${file}（本当 ${d.real.length}・作り話 ${d.fake.length}）`);
}
process.exit(failed ? 1 : 0);

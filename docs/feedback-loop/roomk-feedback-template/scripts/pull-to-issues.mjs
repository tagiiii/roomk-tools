#!/usr/bin/env node
// roomk-tools の RTDB `feedback/` を読んで、このリポジトリの Issue にし、読んだ分を RTDB から消す。
// GitHub Actions（.github/workflows/pull-feedback.yml）から1時間に1回動く。外部パッケージは使わない。
//
// 環境変数:
//   FEEDBACK_SA_JSON   Firebase のサービスアカウント鍵（JSON の中身そのもの。Actions の secret）
//   GITHUB_TOKEN       Actions が渡すトークン（issues: write）
//   GITHUB_REPOSITORY  owner/repo（Actions が渡す）
// 動作確認用:
//   FEEDBACK_EMULATOR=http://127.0.0.1:9602?ns=demo-roomk-fb   鍵なしでエミュレーターを読む
//   GITHUB_API_URL=http://127.0.0.1:6701                        偽の GitHub API に向ける
import { createSign } from 'node:crypto';

const DB_URL = 'https://roomk-tools-default-rtdb.asia-southeast1.firebasedatabase.app';
const MAX_PER_RUN = 20;
const KIND_LABEL = {
  bug: 'うまく動かない', ui: '文字・見た目', content: 'お題・問題',
  howto: '使い方', wish: 'こうだったらいいな', other: 'その他',
};
const APP_NAME = {
  'kotoba-theme': 'コトバのテーマクイズ', quiz: 'クイズパック', 'kotoba-shuffle': 'ことばシャッフル', 'kanji-sagashi': '漢字さがし',
  'kotoba-mikke': 'ことばみっけ', 'kotoba-relay': 'ことばリレー', 'hirameki-oogiri': 'ひらめき大喜利', 'tatoe-gp': 'たとえグランプリ',
  'kotoba-meter': 'ことばメーター', 'shirushi-hint': 'しるしでヒント', 'pittari-beat': 'ぴったりビート', 'kaburazu-hint': 'かぶらずヒント',
  'kotoba-tantei': 'ことば探偵', 'moji-soroe': 'もじそろえゲーム', 'kotoba-pair': 'コトバペア', toomawashi: 'とおまわしクイズ',
  'talk-card': 'トークテーマカード', 'otona-talk': 'おとなトークカード', docchi: 'どっちにする？', 'suki-type-check': 'すきタイプチェック',
  'tsuyomi-card': 'つよみカード', 'do-mannaka': 'ドまんなか', 'word-wolf': 'ワードウルフ', 'nemurase-kichi': 'ねむらせ基地',
  'kossori-word': 'こっそりワード', jinro: '人狼ゲーム', 'name-change': '名前変えゲーム', 'jitsuwa-game': 'え!? 実は○○なんですかゲーム',
  'tatoe-narabe': 'たとえならべ', 'ishin-denshin': '以心伝心しないゲーム', 'uso-jisho': 'うそつき辞書', 'magire-eshi': 'まぎれ絵師',
  'oekaki-dengon': 'お絵描き伝言ゲーム', 'stamp-ate': 'スタンプあてゲーム', 'pittari-meter': 'ピッタリメーター', 'kakure-number': 'かくれナンバー',
  'kagi-awase': 'カギあわせ', 'koedake-theater': 'こえだけシアター', 'kimochi-ate': '気持ち当てゲーム', 'pita-hame': 'ピタハメ',
  'oshitsuke-zukan': 'おしつけずかん', esadori: 'エサドリ', blackjack: 'ブラックジャック', reversi: 'リバーシ', daifugo: '大富豪',
  'suki-bingo': '好きなものビンゴ', 'minna-ranking': 'みんなでランキング', 'kyoumi-sugoroku': '興味スゴロク', 'nurie-week': '塗り絵カレンダー',
  'value-card': 'バリューカード', 'ikutsu-ieru': 'いくつ言える？', 'kyapa-graph': 'キャパグラフ', 'career-sugoroku': 'キャリアすごろく',
  'sakusen-chat': '作戦会議チャット', 'yokumite-kanji': 'よく見て漢字', portal: 'ツール一覧', guide: 'スタッフ向けのページ',
  hajimete: 'はじめての人へ', other: 'どれでもない',
};

// ---- RTDB（サービスアカウント鍵 → アクセストークン）----
async function accessToken() {
  const raw = process.env.FEEDBACK_SA_JSON;
  if (!raw) throw new Error('FEEDBACK_SA_JSON（サービスアカウント鍵の中身）がありません');
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
  });
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature }),
  });
  if (!res.ok) throw new Error('トークンを取れなかった: ' + res.status);
  return (await res.json()).access_token;
}

async function dbClient() {
  const emu = process.env.FEEDBACK_EMULATOR;
  if (emu) {
    const u = new URL(emu); const ns = u.searchParams.get('ns');
    return { url: (p) => `${u.origin}/${p}.json${ns ? '?ns=' + ns : ''}`, token: 'owner' };
  }
  return { url: (p) => `${DB_URL}/${p}.json`, token: await accessToken() };
}

// ---- GitHub ----
const GH = process.env.GITHUB_API_URL || 'https://api.github.com';
const REPO = process.env.GITHUB_REPOSITORY;
async function gh(method, p, body) {
  const res = await fetch(`${GH}/repos/${REPO}${p}`, {
    method, headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}
async function ensureLabel(name, color) {
  const r = await gh('POST', '/labels', { name, color });
  if (!r.ok && r.status !== 422) throw new Error(`ラベル ${name} を作れなかった: ${r.status}`);
}

const jst = (ms) => new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
const firstLine = (t, n) => { const s = t.replace(/\s+/g, ' ').trim(); return [...s].slice(0, n).join('') + ([...s].length > n ? '…' : ''); };

async function main() {
  if (!REPO || !process.env.GITHUB_TOKEN) throw new Error('GITHUB_REPOSITORY / GITHUB_TOKEN がありません');
  const db = await dbClient();
  const headers = { Authorization: 'Bearer ' + db.token };
  const res = await fetch(db.url('feedback'), { headers });
  if (!res.ok) throw new Error('feedback/ を読めなかった: ' + res.status);
  const data = (await res.json()) || {};
  const rows = Object.entries(data)
    .map(([id, v]) => ({ id, app: String(v?.app ?? ''), kind: String(v?.kind ?? ''), at: Number(v?.at) || 0, text: String(v?.text ?? '') }))
    .sort((a, b) => a.at - b.at);
  if (!rows.length) { console.log('0件'); return; }

  await ensureLabel('新着', 'd73a4a');
  for (const name of Object.values(KIND_LABEL)) await ensureLabel(name, 'c5def5');
  for (const name of ['直す', '保留', '見送り']) await ensureLabel(name, 'ededed');

  let made = 0, skipped = 0;
  for (const r of rows.slice(0, MAX_PER_RUN)) {
    const appName = APP_NAME[r.app] || r.app || '不明';
    const kindName = KIND_LABEL[r.kind] || 'その他';
    const title = `[${appName}] ${kindName}: ${firstLine(r.text, 24)}`;
    const body = [
      r.text, '', '---',
      `- ツール: ${appName} (\`${r.app}\`)`, `- 種類: ${kindName} (\`${r.kind}\`)`, `- 送られた日時: ${jst(r.at)}`, `- id: \`${r.id}\``,
    ].join('\n');
    const made1 = await gh('POST', '/issues', { title, body, labels: ['新着', kindName] });
    if (!made1.ok) { skipped += 1; console.log(`Issue を作れなかった ${r.id}: ${made1.status}`); continue; }
    const del = await fetch(db.url('feedback/' + r.id), { method: 'DELETE', headers });
    if (!del.ok) { console.log(`RTDB から消せなかった ${r.id}: ${del.status}（Issue #${made1.data?.number} は作成済み。次回は二重になるので手で消す）`); }
    made += 1;
    console.log(`#${made1.data?.number} ${title}`);
  }
  const left = rows.length - Math.min(rows.length, MAX_PER_RUN);
  console.log(`${made}件を Issue にした。作れなかった ${skipped}件。残り ${left}件（次回）`);
  if (skipped) process.exit(1);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });

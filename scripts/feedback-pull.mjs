#!/usr/bin/env node
// フィードバック（RTDB の feedback/）を、管理者の権限で取り出す・消す。
// アプリやブラウザからは読めない場所なので、サービスアカウントの鍵でサーバー側として読む。
//
//   node scripts/feedback-pull.mjs                       一覧を出す（古い順）
//   node scripts/feedback-pull.mjs --delete ID1,ID2      指定した id を消す
//   node scripts/feedback-pull.mjs --json                一覧を JSON で出す（routine A などが読む用）
//
// 必要なもの: 環境変数 FEEDBACK_SA_JSON に、Firebase のサービスアカウント鍵（JSON）のファイルパス。
//   Firebase コンソール → プロジェクトの設定 → サービスアカウント → 新しい秘密鍵の生成。
//   鍵はリポジトリに置かない（.gitignore 済みの場所か、リポジトリの外）。
// 動作確認用: --emulator http://127.0.0.1:9602?ns=demo-roomk-fb を付けると、鍵なしでエミュレーターを読む。
//
// 原文を扱うので、出力を Issue・チャット・公開の場所に貼らない（docs/feedback-loop/privacy-notes.md）。
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const DB_URL = 'https://roomk-tools-default-rtdb.asia-southeast1.firebasedatabase.app';
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const emulator = opt('--emulator');
const deleteIds = (opt('--delete') || '').split(',').map((s) => s.trim()).filter(Boolean);
const asJson = args.includes('--json');

// サービスアカウント鍵 → アクセストークン（JWT を RS256 で署名して交換する。外部パッケージは使わない）
async function accessToken() {
  const path = process.env.FEEDBACK_SA_JSON;
  if (!path) throw new Error('FEEDBACK_SA_JSON（サービスアカウント鍵のパス）を指定してね');
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
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature }),
  });
  if (!res.ok) throw new Error('トークンを取れなかった: ' + res.status + ' ' + (await res.text()));
  return (await res.json()).access_token;
}

async function main() {
  let base, token;
  if (emulator) {
    const u = new URL(emulator);
    base = u.origin; token = 'owner';
    const ns = u.searchParams.get('ns');
    const q = (p) => `${base}/${p}.json${ns ? '?ns=' + ns : ''}`;
    return run(q, token);
  }
  token = await accessToken();
  return run((p) => `${DB_URL}/${p}.json`, token);
}

async function run(url, token) {
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  if (deleteIds.length) {
    for (const id of deleteIds) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('id の形がおかしい: ' + id);
      const res = await fetch(url('feedback/' + id), { method: 'DELETE', headers });
      if (!res.ok) throw new Error('消せなかった ' + id + ': ' + res.status);
      console.log('消した', id);
    }
    return;
  }
  const res = await fetch(url('feedback'), { headers });
  if (!res.ok) throw new Error('読めなかった: ' + res.status + ' ' + (await res.text()));
  const data = (await res.json()) || {};
  const rows = Object.entries(data)
    .map(([id, v]) => ({ id, app: String(v.app ?? ''), kind: String(v.kind ?? ''), at: Number(v.at) || 0, text: String(v.text ?? '') }))
    .sort((a, b) => a.at - b.at);
  if (asJson) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { console.log('フィードバックはありません'); return; }
  const jst = (ms) => new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  for (const r of rows) {
    console.log(`\n[${r.id}] ${jst(r.at)}  ${r.app} / ${r.kind}`);
    console.log('  ' + r.text.replace(/\n/g, '\n  '));
  }
  console.log(`\n${rows.length} 件。消すときは --delete ID1,ID2`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });

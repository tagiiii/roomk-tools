# 好きなものマップの E2E

隔離した Firebase エミュレーターと Playwright で、ホストと参加者を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。
ルール（`database.rules.json`）はエミュレーターに明示的に読み込ませるので、`sukimonomap_rooms` の名前空間がルールにあることも確かめられる。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | ホスト・参加者2人（1人は375px）・端末なしの参加者1人・途中参加1人: はじめの画面・作成・リンクで参加・端末なしの参加者（印はホストだけ・同じ名前は不可・その名前では参加できない）・選べるジャンルの数・はじめる・マップの「＋」でポップアップ・ジャンルを足すと中身に変わる・自分で書く・「マップにもどる」／Esc で閉じる・× で消す・ジャンルの丸い「＋」・ジャンルを消す（確かめ）・上限で「＋」が消える・完成・読み直しても完成のまま・選びなおす・みんなに出さない・ホストが代わりに作る・全員できたら「見せあいをはじめる」が主ボタン・見せあいの順番（出さない人をとばす）・質問・さいごの人では主ボタンなし・途中参加・もう一度作る時間・待合室へ・進行だけ・退出・ルームを閉じる・利用回数・375px のはみ出し・スマホの幅では上から下の形で文字が実寸（16px以上）・いちばん長い「自分で書く」がはみ出さない・PC は放射のまま・音が鳴らない |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・ルールの読み込み・画面の操作） |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/suki-mono-map` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9921・database 9922・hub 4921・logging 4971。配信は 6921） |

## 実行

```bash
export SM_WORK=/tmp/suki-mono-map-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/suki-mono-map/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。Java が要る）
cp tests/suki-mono-map/firebase.json database.rules.json "$SM_WORK"/
(cd "$SM_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-sm)

# 3. 流す（1回およそ1分）
node tests/suki-mono-map/e2e1.cjs
```

## まだ確かめていないこと

ホストの切断（「ホストの戻りを待っています」と2分の期限切れ）・送信後の切断のやり直しは、同じ作りの `tests/tsunagete-story/` でも流していない。実際の日本語入力・Safari・実機のスマホも未確認。

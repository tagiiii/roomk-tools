# つなげてストーリーの E2E

隔離した Firebase エミュレーターと Playwright で、ホストと参加者を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。
ルール（`database.rules.json`）はエミュレーターに明示的に読み込ませるので、`tsunagetestory_rooms` の名前空間がルールにあることも確かめられる。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | ホスト・参加者2人（1人は375px）・途中参加1人: はじめの画面・作成・リンクで参加・文の項目に「なぜ」を足す・お題の3択（参加する人は押せない・「ほかの3つにする」・選ぶまで書きはじめられない）・1人2つずつのうけもち・入力欄が先・お題の例・書きなおす・読み直しても送ったまま・候補から選ぶ・Enter で送る・みんな送ったら自動で読む・助詞が重ならない・1片ずつ出る・そのあと…（自分で書く・候補・途中参加の人・3つまで）・2回めは使ったお題を出さない・途中参加の人にうけもち・待たずに読む（おまかせ）・この文をとばす・おしまい（とばした文は入らない）・もう一回・お題なしはすぐ書く・退出・ルームを閉じる・375px |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・ルールの読み込み・画面の操作） |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/tsunagete-story` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9771・database 9772・hub 4771・logging 4871。配信は 6771） |

## 実行

```bash
export TS_WORK=/tmp/tsunagete-story-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/tsunagete-story/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。Java が要る）
cp tests/tsunagete-story/firebase.json database.rules.json "$TS_WORK"/
(cd "$TS_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-ts)

# 3. 流す（1回およそ1〜2分）
node tests/tsunagete-story/e2e1.cjs
```

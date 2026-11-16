# 神経衰弱のテスト

ルームの決まり（`apps/shinkei-suijaku/logic.js`）の単体テストと、隔離した Firebase エミュレーターと Playwright の E2E。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `logic.test.cjs` | ルームの決まり（山札・はじめる・2〜6人・端末なしの参加者・めくる・そろう/ちがう・いない人をとばす・押せる人・自分の番で退出・おわり・もう一回・待合室にもどる・壊れた値・名前） |
| `e2e1.cjs` | 1台の画面（通信しない）・作成・参加（リンク）・同じ名前・待合室（むずかしさ・端末のない人）・めくる（みんなの画面に出る・番でない人は押せない・ちがう・そろう・すばやく2枚）・端末のない人の番（ホストの代わり）・再読み込み・おわり・もう一回・375px・待合室にもどる・進行だけのホスト・ルームを閉じる |
| `e2e2.cjs` | 6人まで（7人目・進行だけのホスト・遊ぶにもどせない）・途中参加は不可・自分の番で退出（めくりかけ）・同じ名前で入りなおし・タブを閉じた人の番をとばす・おわりのあとは参加できる・ホストの切断と復帰 |
| `lib.cjs` | 共通の部品（配信用サーバー・ルールの読み込み・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/shinkei-suijaku` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9451・database 9452・hub 4451・logging 4551） |

## 実行

```bash
node tests/shinkei-suijaku/logic.test.cjs
```

E2E は、作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export SS_WORK=/tmp/shinkei-suijaku-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/shinkei-suijaku/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/shinkei-suijaku/firebase.json database.rules.json "$SS_WORK"/
(cd "$SS_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-ssj)

# 3. 1本ずつ流す（その2は、切断の検知を待つので1〜2分かかる）
node tests/shinkei-suijaku/e2e1.cjs
node tests/shinkei-suijaku/e2e2.cjs
```

- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 山札は毎回くじで並ぶ。テストはエミュレーターの `game/deck` を読んで、そろう2枚・ちがう2枚を選ぶ。おわりを試すときは `game/got` を書きかえて最後の1組だけ残す
- ページは `?fast=1` で開く（めくったあとの待ち時間を短くする）
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる

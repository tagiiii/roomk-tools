# かくれ怪盗の E2E

隔離した Firebase エミュレーターと Playwright で、ホスト・参加者・みんなにみせる画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | ルール（配る3000回で役の数・知っていることを照合・投票・見回り・勝ち負け・ルーペ・話し合いの時間）。エミュレーター不要。`node tests/kakure-kaito/engine.test.cjs` |
| `e2e1.cjs` | ホストも遊ぶ5人: 作成・参加・同じ名前・みんなにみせる画面（役が出ない）・役を配る（伏せてめくる）・怪盗は仲間を知る・選びなおしと主任の交代・投票を開く・見回り（警備員は「すり替える」を押せない・すり替え・札はだれのものか残さない）・見やぶり（かしらだけ決められる）・おしまい・もう一回・待合室へ・幅 375px・退出・ルームを閉じる |
| `e2e2.cjs` | 進行だけのホスト＋参加者4人＋端末なし3人: 端末なしの人を足す（名前の重なり・印はホストだけ）・設定を続けて変える・代わりに押す（役を伝えた・票・札）・しらべのルーペ（7人・結果は持っていた人だけ）・話し合いの時間・端末なしの主任／かしら。ホストも遊ぶ4人: 読み込み直し（参加者・ホスト）・見回り中の切断と選びなおし・名前の取り置き・途中から入った人は見ているだけ・ホストが切れたときのオーバーレイ |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/kakure-kaito` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9661・database 9662・hub 4661・logging 4761）。配信は 6661 |

## 実行

作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export KK_WORK=/tmp/kakure-kaito-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/kakure-kaito/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/kakure-kaito/firebase.json database.rules.json "$KK_WORK"/
(cd "$KK_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-kk)

# 3. 1本ずつ流す（その2は切断の検知を待つので2〜3分かかる）
node tests/kakure-kaito/e2e1.cjs
node tests/kakure-kaito/e2e2.cjs
```

- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる

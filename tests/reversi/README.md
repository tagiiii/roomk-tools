# リバーシの E2E

隔離した Firebase エミュレーターと Playwright で、ホスト・対戦する2人・観戦・みんなにみせる画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | 盤のルール（はじめの局面からの手の数を既知の値と照合・でたらめ対局・パス・CPU の手）。エミュレーター不要。`node tests/reversi/engine.test.cjs` |
| `e2e1.cjs` | 作成・参加・席（入った順・入れかえ・ホストも対戦）・観戦・同じ名前・みんなにみせる画面・補助・対局の同期・置けない場所・番でない人・1手もどす・最後まで・結果・もう一回・待合室へ・端末なしの参加者・幅 375px・退出・ルームを閉じる |
| `e2e2.cjs` | 1手の制限時間（残り時間・5秒から色・時間切れで CPU が置く・1回だけ・ホストが切れている間は止めて、戻ると数えなおす）・対局中に入った人は観戦・席の人の切断とホストが代わりに置く・席の名前は別の人に使えない・再読み込み（参加者・ホスト） |
| `e2e3.cjs` | 1台の画面（名前・補助・たしかめる・1手もどす・読み込み直し・パス・最後まで・もう一回・制限時間と CPU・幅 375px） |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/reversi` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9871・database 9872・hub 4871・logging 4971）。配信は 6871 |

## 実行

作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export RV_WORK=/tmp/reversi-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/reversi/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/reversi/firebase.json database.rules.json "$RV_WORK"/
(cd "$RV_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-rv)

# 3. 1本ずつ流す（その2は、切断の検知を待つので1〜2分かかる。その3は時間切れを実際に待つので20秒ほど）
node tests/reversi/e2e1.cjs
node tests/reversi/e2e2.cjs
node tests/reversi/e2e3.cjs
```

- ルームの時間切れは、エミュレーターの `game/turnAt` を過去へずらして早送りする（その2）
- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる
- 2026-10-25 の結果（二重レビューの指摘を直したあと）: ルール 91,433項目・その1 81項目（3回続けて）・その2 43項目（2回）・その3 34項目、すべて合格

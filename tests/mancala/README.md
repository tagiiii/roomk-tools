# マンカラの E2E

隔離した Firebase エミュレーターと Playwright で、ホスト・対戦する2人・観戦・みんなにみせる画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | 盤のルール（はじめの局面・もう1回・相手のゴールをとばす・よこどり・おわり・でたらめ対局3000局・CPU の手と強さ）。エミュレーター不要。`node tests/mancala/engine.test.cjs` |
| `e2e1.cjs` | 作成・参加・席・観戦・みんなにみせる画面・補助・対局の同期と石を入れる動き・自分の側が下・番でない人・1手もどす・最後まで（REST で終わり近くの局面を作る）・結果・もう一回・待合室へ・端末なしの参加者・幅 375px・退出・ルームを閉じる |
| `e2e2.cjs` | 1手の制限時間（残り時間・5秒から色・時間切れで CPU がまく・1回だけ・ホストが切れている間は止めて、戻ると数えなおす）・対局中に入った人は観戦・席の人の切断とホストが代わりにまく・席の名前は別の人に使えない・再読み込み（参加者・ホスト） |
| `e2e3.cjs` | 1台の画面（名前・補助・たしかめる・石を入れる動き・もう1回・いい手に印・1手もどす・読み込み直し・最後まで・もう一回・CPU と対戦（つよい）・幅 375px） |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/mancala` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9961・database 9962・hub 4961・logging 4962）。配信は 6961 |

## 実行

作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export MC_WORK=/tmp/mancala-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/mancala/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/mancala/firebase.json database.rules.json "$MC_WORK"/
(cd "$MC_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-mc)

# 3. 1本ずつ流す（その2は、切断の検知を待つので1〜2分かかる。その3は CPU と最後まで遊ぶので1〜2分）
node tests/mancala/e2e1.cjs
node tests/mancala/e2e2.cjs
node tests/mancala/e2e3.cjs
```

- ルームの時間切れは、エミュレーターの `game/turnAt` を過去へずらして早送りする（その2）
- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる
- ルールは、作業フォルダの `database.rules.json` に `mancala_rooms` があるものを使う（本番のルールに足す前でも流せるよう、写しに足してよい）
- 2026-11-14 の結果: ルール 18件・その1 63項目・その2 39項目・その3 49項目、すべて合格

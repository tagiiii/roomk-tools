# すとんブロックの E2E

隔離した Firebase エミュレーターと Playwright で、ホスト・あそぶ人・みんなにみせる画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | 盤とブロックのしくみ（同じ種なら同じ順番・7種類の袋・4回で元にもどる・かべぎわで回す・回せないときのずらし方の表をすべての回し方で・入らない穴には入らず上へずれる・屋根の下の深いすき間・段を消す・いっぱいのとき・盤をつめて送る・じゃまの入り方・とっておく・読み込み直し）。エミュレーター不要。`node tests/suton-block/engine.test.cjs` |
| `e2e1.cjs` | 作成・参加・設定がすぐ出る・はじめる・カウントダウン・残り時間・同じ順番（種どおりの盤）・ほかの人の盤（広い画面／スマホは名前と段の数）・375px・じゃま（受けとって消す・置くと入る・あいた列に縦のブロックで2段消すとつぎの人に1段）・早めにおわる・順位・もう一回・ホストが見るだけ・みんなにみせる画面・途中から入る人・時間で結果・退出しても結果に出る・ルームを閉じる |
| `e2e2.cjs` | 読み込み直し（参加者・ホスト。同じ順番の続き）・ホストの切断（あそんでいる間は盤をかくさない・ホストが切れていても時間で結果・`finish` は1回）・参加者の切断（「通信が切れた」・その回の名前はほかの人が使えない・戻ると続けられる） |
| `e2e3.cjs` | ひとりであそぶ（とっておく・いっぱいでからにする・あそびかた中はキーで動かない・時間切れ・おしまい・もう一回・おわる・375px） |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/suton-block` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9771・database 9772・hub 4775・logging 4776）。配信は 6771 |

## 実行

作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export SB_WORK=/tmp/suton-block-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/suton-block/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/suton-block/firebase.json database.rules.json "$SB_WORK"/
(cd "$SB_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-sb)

# 3. 1本ずつ流す（その2は、切断の検知を待つので2〜3分かかる）
node tests/suton-block/e2e1.cjs
node tests/suton-block/e2e2.cjs
node tests/suton-block/e2e3.cjs
```

- 時間で結果が出るところは、エミュレーターの `round/startedAt` を過去へずらして早送りする
- じゃまのあく列はでたらめなので、その1ではホストのページの `Math.random` を固定して左はしにし、node で同じ盤を作りなおして（`restoreGame`）縦のブロックが来るまでの手を決めてから、画面で同じキーを押す
- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる
- `E2E_BROWSER=webkit` を付けると、Safari と同じエンジン（Playwright の WebKit。`playwright install webkit` で入れる）で流す。2026-11-02 に流した結果: その1 76項目・その3 41項目は合格。その2は R13（結果の画面でホストを待つオーバーレイ）だけ落ちる。WebKit では `setOffline` で切ったホストがすぐつなぎなおして `hostConnected` が true にもどるため（ホストがじっさいには切れていない）で、アプリの不具合ではない。切断まわりは Chrome の結果で見る

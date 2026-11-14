# 麻雀の E2E

隔離した Firebase エミュレーターと Playwright で、ホスト・参加者・みんなにみせる画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。大富豪（`tests/daifugo/`）を型にした。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | ルール（`apps/mahjong/engine.js`）のテスト。そろっている組の見つけ方・あがり・七対子・待ち・向聴数・鳴いた手・組に分ける・配り方・CPU 4人の対局（やさしい／ふつう 各150局。牌が136枚のまま）・鳴きなし・できない操作・ロンがポンより先・頭ハネ・ポンのあとの番。`node tests/mahjong/engine.test.cjs`（エミュレーター不要・1〜2分） |
| `e2e1.cjs` | 作成・参加・CPU ではじまる名前・同じ名前・設定がみんなに見える・みんなにみせる画面・はじめる（4席・CPU・136枚・手牌は人ごと・見る画面に手牌なし）・見え方（ヒント・そろった組の枠・名前。待合室とゲームの画面でひとりずつ選べて、そろう・ルームに書かない・枠は groupHand と同じ）・最後まで打つ・結果・あがり回数・次の局（親が回る）・時間切れ2回で CPU にまかせる・自分でやる・通信が切れた人の番は CPU・別の端末から同じ名前で入りなおす・読み込み直し・375px・待合室へ・ルームを閉じる（3〜5分） |
| `e2e2.cjs` | 人が押すポンとロン。配ったあとに `game` を REST で書きかえて局面を作る（ポンのボタンと牌の絵・鳴いた組・ポンのあと押せる・待ちのヒント・ロン・結果の文・みんなにみせる画面に「聞いている」を出さない） |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/mahjong` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9641・database 9642・hub 4641・logging 4642。配信 6642） |

## 実行

```bash
export MJ_WORK=/tmp/mahjong-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/mahjong/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。Java が要る）
cp tests/mahjong/firebase.json database.rules.json "$MJ_WORK"/
(cd "$MJ_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-mj)

# 3. ルールを読み込ませてから流す（エミュレーターは firebase.json のルールを当てないことがある）
curl -s -X PUT -H "Authorization: Bearer owner" --data-binary @database.rules.json "http://127.0.0.1:9642/.settings/rules.json?ns=demo-roomk-mj"
node tests/mahjong/e2e1.cjs
node tests/mahjong/e2e2.cjs
```

- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 牌は毎回くじで配られる。e2e1 の人の番は「あがれるならあがる・聞かれたらパス（3割でポン）・おすすめの牌を捨てる」で進める
- `finish` の回数は、局を終わらせた画面（ホストの CPU か、ロン・ツモを押した人）で1回
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる

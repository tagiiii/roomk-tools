# 大富豪の E2E

隔離した Firebase エミュレーターと Playwright で、ホスト・参加者・みんなにみせる画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | ルール（`apps/daifugo/engine.js`）のテスト。各ルール・パスと流れ・あがり・反則あがり・呼び名・カード交換、でたらめ対局と CPU 対局1200回、交換ありで続けて40回、階段革命・ジョーカーの効果・ジョーカーだけの「何として出すか」・都落ち（都落ちありで40回）。`node tests/daifugo/engine.test.cjs`（エミュレーター不要） |
| `e2e1.cjs` | 作成・参加・同じ名前・CPU ではじまる名前・CPU を足す・設定がみんなに見える・みんなにみせる画面・配る（53枚・手札は人ごと・みんなにみせる画面に手札なし）・通信が切れた人の番は CPU が代わり・別の端末から同じ名前で入りなおす・読み込み直し・時間切れ2回で CPU にまかせる・自分でやる・最後まで・結果の呼び名・もう一回のカード交換（大貧民から・53枚・交換の結果）・交換オフなら呼び名を出さない・375px・ルームを閉じる |
| `e2e2.cjs` | 2026-10-27 の3ルール: 待合室の階段革命・都落ちの項目、5枚の階段で革命、10＋ジョーカーで2枚捨てられる、ジョーカーだけを選ぶと「そのまま・8として・10として」のボタン（10として→捨てる画面・8として→8切り）、都落ち（札・できごと・抜けた人の画面・みんなにみせる画面・結果の順と印・lastOrder）、2回目の呼び名、前回の大富豪が1番なら起きない。手札はくじなので、配ったあとに `game` を REST で書きかえて局面を作る（1〜2分） |
| `shot.cjs` | ポータルのサムネイルを撮る（`DF_WORK/out/thumb.png`） |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/daifugo` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9681・database 9682・hub 4781・logging 4881。配信 6681） |

## 実行

作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export DF_WORK=/tmp/daifugo-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/daifugo/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/daifugo/firebase.json database.rules.json "$DF_WORK"/
(cd "$DF_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-df)

# 3. 流す（e2e1 は時間切れを実際に待つので4〜6分かかる）
node tests/daifugo/e2e1.cjs
node tests/daifugo/e2e2.cjs
```

- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- カードは毎回くじで配られる。人の番は「出せるカードを1つ選んで出す。出せなければパス」で進める
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる

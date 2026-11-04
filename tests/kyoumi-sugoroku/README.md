# 興味スゴロクのテスト

ルームの決まり（`apps/kyoumi-sugoroku/logic.js`）の単体テストと、隔離した Firebase エミュレーターと Playwright の E2E。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `logic.test.cjs` | ルームの決まり（はじめる・順番・振る・ゴールでとまる・質問の重複とテーマの連続を避ける・別の質問・選ぶ・次の人へ・いない人をとばす・押せる人・待合室にもどる・名前） |
| `e2e1.cjs` | 1台の画面（6人・名前・通信しない）・作成・参加（リンク）・同じ名前・待合室の設定（マス数・テーマ2つ以上）・端末のない人・番の操作（サイコロのアニメーション・質問をみんなに出す・選択肢をみんなに出す・選び直し・別の質問・次の人へ）・ホストの代わり・端末のない人の番・再読み込み・ゴール・もう一度あそぶ・待合室にもどる・幅 375px・ルームを閉じる |
| `e2e2.cjs` | 6人まで（7人目・進行だけのホスト・遊ぶにもどせない）・端末のない人を外す・途中参加は不可・自分の番で退出（振る番・話す番）・同じ名前で入りなおし・切断した人の番をとばす・再読み込み・ホストの切断と復帰 |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/kyoumi-sugoroku` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9611・database 9612・hub 4611・logging 4711） |

## 実行

```bash
node tests/kyoumi-sugoroku/logic.test.cjs
```

E2E は、作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export KS_WORK=/tmp/kyoumi-sugoroku-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/kyoumi-sugoroku/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/kyoumi-sugoroku/firebase.json database.rules.json "$KS_WORK"/
(cd "$KS_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-ks)

# 3. 1本ずつ流す（その2は、切断の検知を待つので1〜2分かかる）
node tests/kyoumi-sugoroku/e2e1.cjs
node tests/kyoumi-sugoroku/e2e2.cjs
```

- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 質問は毎回くじで出る。選択肢のある質問などを試すときは、テストの中でエミュレーターの `game/q` を書きかえる
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる

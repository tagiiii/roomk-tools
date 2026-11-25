# ひともじチェンジのテスト

ことばとルームの決まり（`apps/hitomoji-change/logic.js`）の単体テストと、隔離した Firebase エミュレーターと Playwright の E2E。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `logic.test.cjs` | ことば（1文字ちがい・つなぎ方・ヒント・自分で決めるお題・名前）とルーム（順番・パス・端末なし・1つ戻す・ヒント・ゴール・次のお題の順番・番の人がいない・入りなおしで番を戻さない・進行だけのホスト・だれでも・出したお題・壊れた値）。全お題がつながることも見る |
| `e2e1.cjs` | 1台の画面（通信しない）・作成・参加（リンク／打つ・同じ名前）・待合室（お題・端末のない人）・順番（番でない人は押せない・パス・端末なしの番はホスト・ヒントがみんなに出る・1つ戻す）・ゴール・次のお題・途中参加・再読み込み・375px・だれでも（同時に押す）・自分で決めるお題・進行だけのホスト・退出・ルームを閉じる |
| `e2e2.cjs` | 番の人がタブを閉じる（つぎの人へ）・同じ名前で入りなおし（番は戻さない）・12人まで・ホストの切断と復帰 |
| `shot.cjs` | ツール一覧のサムネイルを撮る（1台の画面。エミュレーター不要） |
| `lib.cjs` | 共通の部品（配信用サーバー・ルールの読み込み・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/hitomoji-change` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9461・database 9462・hub 4461・logging 4561。配信は 6461、その2を並べるときは `E2E_PORT=6462`） |

## 実行

```bash
node tests/hitomoji-change/logic.test.cjs
```

E2E は、作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export HMC_WORK=/tmp/hitomoji-change-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/hitomoji-change/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/hitomoji-change/firebase.json database.rules.json "$HMC_WORK"/
(cd "$HMC_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-hmc)

# 3. 流す（その2は、切断の検知を待つので1〜2分かかる）
node tests/hitomoji-change/e2e1.cjs
E2E_PORT=6462 node tests/hitomoji-change/e2e2.cjs
```

- お題はくじで出る。テストはエミュレーターの `game` を読み、`logic.js` の `hintStep`（ことばのリストのいちばん短い道）で次に変える位置と文字を決める。お題によっては途中でゴールするので、端末なしの番・ヒント・1つ戻すの検査は、ゴール前のときだけ行う（そのぶん合格の数が変わる）
- 「だれでも」の同時に押す検査は、2人の押す操作を同じ瞬間に送る。先に入った手で、もう一方の文字の表が閉じていることもあり、そのときは「遅れた人への知らせ」の検査をとばす（手が1つだけ入ったことは毎回見る）
- エミュレーターのロングポーリングが出す「Permissions policy violation: unload」は、アプリの不具合ではないので集計から外している
- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる

# ちゃりんバトンの E2E

隔離した Firebase エミュレーターと Playwright で、ホスト・対戦する2人・観戦・みんなにみせる画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | 小銭の問題づくりと対決のルール（枚数の増え方・種類・同じ硬貨は3枚まで・重ならない・直前と同じ組み合わせにしない・3・2・1・正解・まちがい・パス・時間切れ・つづきから）。エミュレーター不要。`node tests/charin-baton/engine.test.cjs` |
| `e2e1.cjs` | 作成・参加・席（入った順・入れかえ・ホストも対戦）・観戦・同じ名前・みんなにみせる画面・設定（人ごとの持ち時間と種類・枚数・先に答える人）・3・2・1・まちがいは書かない・正解の帯・パス・小銭の増え方・時間切れ（`game/duel` の残りを早送り）・結果と一覧・finish は1回・もう一回・待合室へ・端末なしの参加者とホストの代わり入力・スマホ幅・退出・ルームを閉じる |
| `e2e2.cjs` | ホストが切れている間は時計を止め、戻ると止めた時刻の残りで 3・2・1 から・席の人の切断とホストが代わりに答える・席の名前は別の人に使えない・対決中に入った人は観戦・読み込み直し（参加者・ホスト） |
| `e2e3.cjs` | 1台の画面（名前・設定・名前欄の Enter で始めても数字キーが効く・3・2・1・まちがい・正解・パス・数字ボタンの出し分け・読み込み直し・時間切れ・結果・もう一回）・いっしょに数える・スマホ幅。時計は Playwright の `clock` で早送りする |
| `e2e4.cjs` | 3人以上の勝ち残り（参加した人みんなが対戦・ホストも対戦する／外す・6人まで・7人目は入れない・6人のスマホ表示・席の順に回る・「ここまで」の帯と本人の画面・「ここまで」の人をとばす・最後の1人の勝ち・順位は出さない・finish は1回・もう一回は次の人から） |
| `e2e5.cjs` | ひとりで遊ぶ（対戦する人がいないと始められない・1人なら始められる・正解するたびに同じ人に次の小銭・札の点数・ホストは見るだけ・時計が0で「おしまい！ ○○は ○点」・勝ちは出さない・finish は1回・もう一回・ホストがひとりで・1台の画面で1人） |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/charin-baton` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9881・database 9882・hub 4881・logging 4981）。配信は 6881 |

## 実行

作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export CB_WORK=/tmp/charin-baton-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/charin-baton/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/charin-baton/firebase.json database.rules.json "$CB_WORK"/
(cd "$CB_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-cb)

# 3. 1本ずつ流す（その2は、切断の検知を待つので1〜3分かかる）
node tests/charin-baton/e2e1.cjs
node tests/charin-baton/e2e2.cjs
node tests/charin-baton/e2e3.cjs
node tests/charin-baton/e2e4.cjs
node tests/charin-baton/e2e5.cjs
```

- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる

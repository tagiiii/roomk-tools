# ヒット&ブローの E2E

隔離した Firebase エミュレーターと Playwright で、ホスト・遊ぶ人・見るだけの人・みんなにみせる画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。リバーシの E2E を型にした。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | ルール（ヒット・ブローの数え方・答えの形・みんなで対戦・2人で対戦の「もう1回」と引き分け・端末なしの答え・保存先から読んだ値をそろえる・でたらめ対局）。エミュレーター不要。`node tests/hit-blow/engine.test.cjs` |
| `e2e1.cjs` | 作成・参加（遊ぶ／見るだけ・同じ名前・記号・全角のコード）・みんなにみせる画面・遊ぶ人の切りかえ・あそびかたとむずかしさ・2人で対戦（答えを決める・おまかせ・秘密の出し分け・予想の同期・後の人がすぐ勝つ・もう一回で先の番がずれる・引き分け）・待合室へ・幅 375px・退出・ルームを閉じる |
| `e2e2.cjs` | みんなで対戦（順番・全員に見える一覧・答えは結果まで出さない）・端末なしの参加者・席の人が抜けたらホストが代わりに押す・再読み込み（ホスト・参加者）・番をとばす・ゲーム中に入った人は見るだけ・席の名前は別の人に使えない・2人で対戦の端末なしの答え・抜けた人の答えをおまかせで決める |
| `e2e3.cjs` | 1台の画面（2人で対戦・読み込み直し・もう一回・もう1回だけ・あそびかたを変える・みんなで対戦の人数とむずかしい・番をとばす・最初からやりなおす・幅 375px・トップへ戻る） |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/hit-blow` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9973・database 9974・hub 4973・logging 4974）。配信は 6973 |

## 実行

```bash
export HB_WORK=/tmp/hit-blow-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/hit-blow/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。Java が要る）
cp tests/hit-blow/firebase.json database.rules.json "$HB_WORK"/
(cd "$HB_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-hb)

# 3. 1本ずつ流す
node tests/hit-blow/e2e1.cjs
node tests/hit-blow/e2e2.cjs
node tests/hit-blow/e2e3.cjs
```

- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる
- 回数の記録（`stats.js` の差し替え）は読み込み直しで0にもどる

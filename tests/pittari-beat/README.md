# ぴったりビートの検証

隔離した Firebase エミュレーターと Playwright で、進行役・参加者を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `engine.test.mjs` | 譜面・判定・点数・順位・タイミング合わせの計算（ブラウザなし） |
| `e2e-solo.cjs` | ひとりで遊ぶ: はじめの画面・全部ぴったり（やさしい・むずかしいの16分音符）・いいね・でたらめにたたく・止める/つづける（曲も続きから）・画面の切りかえ・Esc・タイミング合わせ・スマホ（縦375・縦320・横）・利用回数 |
| `e2e-room.cjs` | ルーム: 作成・コード/リンクのコピー・リンクから参加・同じ名前/全角コード/ないルーム/ひらがな/記号・2人同時に遊ぶ・ランキングの順位・いちばんは下がらない・参加者と進行役の読み込みなおし・お手本はのらない・途中でコースを変える・ブラウザを閉じた人は「はなれている」で点数は残る・同じ端末で入りなおし・退出・進行役の切断と復帰・ルームを閉じる（作り直されない）・おかしなリンク・期限切れのルーム・幅375px |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作・譜面どおりにキーを押す） |
| `sync-site.sh` | `apps/shared` と `apps/pittari-beat` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9651・database 9652・hub 4651・logging 4751）。配信は 6651（solo を同時に流すときは `E2E_PORT=6652`） |

アプリは `#e2e` を付けて開いたときだけ `window.__pb`（いまの時刻・譜面・回数）を出す。テストはそれを読んで、しるしの時刻にキーを押す。

## 実行

```bash
node tests/pittari-beat/engine.test.mjs
```

```bash
export PB_WORK=/tmp/pittari-beat-e2e
export PLAYWRIGHT=（playwright のフォルダ）
bash tests/pittari-beat/sync-site.sh
cp tests/pittari-beat/firebase.json database.rules.json "$PB_WORK"/
(cd "$PB_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-pb)
```

別の端末で:

```bash
node tests/pittari-beat/e2e-room.cjs
```

```bash
E2E_PORT=6652 node tests/pittari-beat/e2e-solo.cjs
```

- エミュレーターには Java が要る。ポートを別のセッションが使っていたら、相手は止めずに `firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 曲は1回 40〜65秒あるので、room はおよそ5分（切断の検知を待つ場面がある）、solo はおよそ3分かかる
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる
- 2026-10-21 の結果: engine 884・solo 80・room 88 項目、すべて合格
- 2026-10-21（マークの数 2つ・3つ を足したあと）: engine 1476・solo 96・room 99 項目、すべて合格

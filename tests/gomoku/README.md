# 五目並べの E2E

隔離した Firebase エミュレーターと Playwright で、ホスト・対戦する2人・観戦・みんなにみせる画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。リバーシのテスト（`tests/reversi/`）をもとにした。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | 盤のルール（5つの向き・6つでも勝ち・端をまたがない・引き分け・あと1つで5つ・CPU の勝ち手とふさぐ手・でたらめ対局・CPU の強さの差・つよいの1手の時間）。エミュレーター不要。`node tests/gomoku/engine.test.cjs` |
| `e2e1.cjs` | 作成・参加・席・観戦・みんなにみせる画面・対局の同期・番でない人・補助の印（赤い輪・5つの輪・おすすめ・直前の手）・勝ち・5つのならび・1手もどす・もう一回・補助の設定・たしかめる・幅 375px・待合室へ・端末なしの参加者・退出・ルームを閉じる |
| `e2e2.cjs` | 1手の制限時間（残り時間・5秒から色・時間切れで CPU が置く・1回だけ・ホストが切れている間は止めて、戻ると数えなおす）・対局中に入った人は観戦・席の人の切断とホストが代わりに置く・席の名前は別の人に使えない・再読み込み（参加者・ホスト） |
| `e2e3.cjs` | 1台の画面（名前・補助のはじめの値・キーボード・たしかめる・1手もどす・黒の人だけ・読み込み直し・勝ち・もう一回・制限時間（時計の早送り）・CPU と対戦・幅 375px） |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/gomoku` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9541・database 9542・hub 4541・logging 4641）。配信は 6541 |

## 実行

```bash
export GM_WORK=/tmp/gomoku-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/gomoku/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/gomoku/firebase.json database.rules.json "$GM_WORK"/
(cd "$GM_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-gm)

# 3. 1本ずつ流す（その2は切断の検知を待つので1〜2分かかる）
node tests/gomoku/e2e1.cjs
node tests/gomoku/e2e2.cjs
node tests/gomoku/e2e3.cjs
```

- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 2026-11-18 の結果（独立レビューの指摘を直したあと）: ルール 236項目・その1 84項目・その2 46項目・その3 51項目、すべて合格

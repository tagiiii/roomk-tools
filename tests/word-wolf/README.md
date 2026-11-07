# ワードウルフの E2E

隔離した Firebase エミュレーターと Playwright で、ホストと参加者を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | 同じルームで使った組をくり返さない（2026-11-08）: 開始のたびに `usedPairs` が1件ずつ増えて重ならない・配られたお題はその位置の組・「もう一度」のあとも残る・残り1組はその組を選ぶ・全部使ったら空から数えなおす・おかしな値は捨てる・参加者の画面のお題・375px |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作）。とおまわしクイズの lib を型にした |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/word-wolf` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9751・database 9752・hub 4751・logging 4851。配信は 6751） |

## 実行

```bash
export WW_WORK=/tmp/word-wolf-e2e
export PLAYWRIGHT=（playwright のフォルダ）

bash tests/word-wolf/sync-site.sh
cp tests/word-wolf/firebase.json database.rules.json "$WW_WORK"/
(cd "$WW_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-ww)

node tests/word-wolf/e2e1.cjs
```

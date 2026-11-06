# とおまわしクイズの E2E

隔離した Firebase エミュレーターと Playwright で、ホストと参加者を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | ホストが説明役の順番に入るとき: ホストの番はお題が見える・ほかの人の番はホストの画面にお題と言っちゃダメことばを書かず、聞き手として答える（候補・自分の言葉・上書き）・答えの全文は出さず人数だけ・説明役にはホストの答えが見える・正解発表でお題とホストの答え・次の番で入力欄が空になる・375px。ホストが進行役のとき: 進行用のお題と言っちゃダメことばが出る・答えない・答えの全文が見える。どちらも聞き手の画面にお題を書かない（答えの候補は全員向けの公開情報なので除く） |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/toomawashi` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9741・database 9742・hub 4741・logging 4841。配信は 6741） |

## 実行

作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export TW_WORK=/tmp/toomawashi-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/toomawashi/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/toomawashi/firebase.json database.rules.json "$TW_WORK"/
(cd "$TW_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-tw)

# 3. 流す
node tests/toomawashi/e2e1.cjs
```

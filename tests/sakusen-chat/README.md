# 作戦会議チャットの E2E

隔離した Firebase エミュレーターと Playwright で、メンター・参加する人の画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | 入口（メンター用のリンク）・作成・参加（3人まで）・会話・未読・画像・せまい画面 |
| `e2e2.cjs` | 再読み込み・タブの複製・退出・切断・期限切れ・終わる・前のルームの片付け |
| `e2e3.cjs` | 作成・参加の送信直後の切断、残りかすの片付け |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・操作の短縮） |
| `sync-site.sh` | `apps/shared` と `apps/sakusen-chat` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9481・database 9482・hub 4481・logging 4581） |

## 実行

作業フォルダ（リポジトリの外）を決めて、次の順に行う。JDK・Playwright の場所は環境に合わせる。

```bash
export SC_WORK=/tmp/sakusen-chat-e2e
export SC_MENTOR_KEY=（メンター用のカギ。app.js の MENTOR_KEY_HASH のもとの値）
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/sakusen-chat/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/sakusen-chat/firebase.json database.rules.json "$SC_WORK"/
(cd "$SC_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-sc)

# 3. 1本ずつ流す
node tests/sakusen-chat/e2e1.cjs
node tests/sakusen-chat/e2e2.cjs
node tests/sakusen-chat/e2e3.cjs
```

- メンター用のカギが手元にないときは、テスト用のカギを決めて、写し（`$SC_WORK/site/sakusen-chat/app.js`）の `MENTOR_KEY_HASH` をそのカギの SHA-256 に書きかえる（リポジトリの `app.js` は変えない）
- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる
- 2026-10-13 の結果: その1 97項目・その2 62項目・その3 16項目、すべて合格

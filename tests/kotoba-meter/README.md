# ことばメーターの E2E

隔離した Firebase エミュレーターと Playwright で、進行役・参加者・みんなにみせる画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | 入口の画面（トップの3ボタン・トップへ戻る・フォーム内のエラー）・作成・リンク／トップからの参加・コードのコピー・みんなにみせる画面をトップから開く・ルームバー（進行役だけの「みんなにみせる画面」・1行／2行）・開始と制限時間・秘密の数字とゲージ・ヒント例・お題の変更（数字は変わらない）・予想（選び直し・パス・数字の高さ）・公開（出題者の数字の列・名前）・次のラウンドの出題者・利用回数・幅 375px／320px |
| `e2e2.cjs` | 同じニックネーム・ラウンドの途中の参加・再読み込みしても続き（参加者の予想・進行役の役割）・やり直し・退出・ルームを閉じる・終わったルーム／ないルームのみんなにみせる画面 |
| `e2e3.cjs` | 制限時間30秒の時間切れで参加順の次の出題者へ・残り10秒の色・進行役の切断と「進行役の戻りを待っています」・戻ったら続きから・待ち画面からの退出・2分戻らなければ終了 |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared` と `apps/kotoba-meter` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9781・database 9782・hub 4781・logging 4881。配信は 6781） |

## 実行

作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export KM_WORK=/tmp/kotoba-meter-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/kotoba-meter/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/kotoba-meter/firebase.json database.rules.json "$KM_WORK"/
(cd "$KM_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-km)

# 3. 1本ずつ流す
node tests/kotoba-meter/e2e1.cjs
node tests/kotoba-meter/e2e2.cjs
node tests/kotoba-meter/e2e3.cjs
```

- 画面の写真は `$KM_WORK/out/` に出る
- ポートを別のセッションが使っていたら、相手は止めずに、`firebase.json`・`sync-site.sh`・`lib.cjs` のポートをそろえて変える
- 進行役の切断は、進行役のページで `firebase.database().goOffline()` を呼んで作る（数秒で検知される。`goOnline()` で戻る）。ブラウザの通信を切る方法より速い
- その3 は時間切れ（30秒）と2分の終了を実際に待つので、3分ほどかかる
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる
- 2026-10-21 の結果: その1 66項目・その2 26項目・その3 32項目、すべて合格（Playwright 1.64・システムの Chrome・firebase-tools 15.29.0）

# たとえならべの E2E

隔離した Firebase エミュレーターと Playwright で、ホスト・参加者・見学の画面を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | 見学の画面（待合室・確認・発言・答え合わせ・次の回・ルームが終わったとき・トップの「見学する」・ない部屋・何も書きこまない）・見学用のリンク・端末なしの参加者（足す・同じ名前・Enter・外す・ホストは進行役・札はホストだけ・同じ名前では参加できない・数字を隠す／見る／コピー／伝えた・代わりに宣言・代わりにチャット・結果の画面で足す）・たとえのチャット（送る・空白をつめる・3秒に1回・宣言の一覧と結果にたとえ・ホストの「消す」・もう一度で消える）・幅 375px |
| `e2e2.cjs` | ホストも遊ぶときのチャット（選択なし）・参加者の切断中は書きこまない・ホストが遊んだ回の結果で端末なしの人を足しても、その回のホストの結果は残り、次の回はホストに配らない |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作）。しるしでヒントの lib を型にした |
| `sync-site.sh` | `apps/shared` と `apps/tatoe-narabe` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9621・database 9622・hub 4621・logging 4721） |

## 実行

```bash
export TN_WORK=/tmp/tatoe-narabe-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/tatoe-narabe/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。Java が要る）
cp tests/tatoe-narabe/firebase.json database.rules.json "$TN_WORK"/
(cd "$TN_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-tn)

# 3. 1本ずつ流す
node tests/tatoe-narabe/e2e1.cjs
node tests/tatoe-narabe/e2e2.cjs
```

- 配信は 127.0.0.1:6621（`E2E_PORT` で変えられる）
- 2026-11-25 の結果: その1 80項目・その2 14項目、すべて合格

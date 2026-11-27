# とりせつ解除班のテスト

ルールのテスト（エミュレーター不要）と、隔離した Firebase エミュレーター＋Playwright の E2E。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | 爆弾1200こ（むずかしさ3つ×400）を、正しい操作でまちがい0のまま解除できる・同じ番号なら同じ爆弾・コードの正解が説明書の表どおり・まちがい3回で爆発・まちがえるたびに速くなる・時間切れ・時間をはからないとき・導火線（火がつく・止める・まにあわない・2度数えない）・説明書の行数・記号の決まりが重ならない・やじるし16通りが重ならない・解除する人の交代・説明書の配り方・こわれた値。`node tests/torisetsu-kaijo/engine.test.cjs` |
| `e2e1.cjs` | 作成・参加・待合室（読むだけ・むずかしさ）・みんなにみせる画面・役ごとの見え方（爆弾は解除する人だけ・説明書は読む人だけ・ホストは数だけ）・説明書を分けて配る・爆弾を回す（ボタン・ドラッグ）・手がかりを近くで見る・ひとこと（5秒に1回）・説明書の1行を見せる・しかけ4種類を解除・読み込み直し・まちがい・導火線を止める・解除成功・もう一回（解除する人の交代・前の役の画面を残さない）・まちがい3回で爆発・スマホ幅・時間切れで爆発・待合室へ・ルームを閉じる |
| `e2e2.cjs` | 名前とルームコードの検査・ホストも遊ぶ（2人）・みんなが読むだけだとはじめられない・ゆっくり（時間をはからない）・説明書を分けない・途中でひらいたみんなにみせる画面・途中から入った人は見る番・7人目は入れない・導火線がまにあわない・ホストが切れている間は時間が止まり、戻るとずれて続く（切断の検知を待つので1〜2分）・解除する人が退出したときの時間切れをホストが代わりに書く・この回をやめて待合室へ |
| `shot.cjs` | ツール一覧のサムネイルを撮る（エミュレーターも Java も使わない。撮影ブラウザの中だけで Firebase の SDK をメモリの中のデータベースに差し替える）。`PLAYWRIGHT=… node tests/torisetsu-kaijo/shot.cjs <出力先.png>`。256色にする方法は `docs/development/thumbnails.md` |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/torisetsu-kaijo`・`apps/updates.json` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9471・database 9472・hub 4471・logging 4571）。配信は 6471 |

## 実行

作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export TK_WORK=/tmp/torisetsu-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/torisetsu-kaijo/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/torisetsu-kaijo/firebase.json database.rules.json "$TK_WORK"/
(cd "$TK_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-tk)

# 3. 1本ずつ流す
node tests/torisetsu-kaijo/e2e1.cjs
E2E_PORT=6472 node tests/torisetsu-kaijo/e2e2.cjs
```

- `E2E_PORT` を変えると、同じエミュレーターで2本を並べて流せる
- 時間で進むところは、REST で `game/startAt`（導火線）・`game/t`（のこり時間）を書きかえて早送りする。導火線に火がついてほしくない間は、`game/startAt` を先の時刻にしておく
- 爆弾の向きは `window.__tk.cube`（`showFace('back')` など）で変える。写真は、近くで見る欄の動き（0.18秒）が終わってから撮る
- 全画面の写真（fullPage）では、暗い地の下に白い帯が写ることがある（写真だけ。実際の画面は下まで暗い）
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる

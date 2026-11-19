# のりあいロードのテスト

ルールのテスト（エミュレーター不要）と、隔離した Firebase エミュレーター＋Playwright の E2E。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | ルール（ひとりで2マスに上がれない・頭に乗れる・乗って運ばれる・スイッチ・番号のかべ・カギとゴール・箱の人数・リフト・動く床・シーソー・ボールとかご・ひも・落ちて戻る・画面そろえ）、ルームに置く形（人・ワールドを書いて読むと同じ・こわれた値）、いなくなった人をクリアの数に入れない。`node tests/noriai-road/engine.test.cjs` |
| `playthrough.cjs` | **通しプレイ**（エミュレーター不要）: 14ステージ × 2〜10人を、人の操作（左右・ジャンプ・下）だけでゴールまで進める。人・箱・ものを置き直さない。区間ごとに越え方を1通り書いてあり、行き詰まると区間と場面を出す（土台は `playthrough-bot.cjs`）。`node tests/noriai-road/playthrough.cjs`（1秒ほど）、1つだけなら `… playthrough.cjs 5 2`（ステージ5を2人で）。`NR_ENGINE=…/engine.js` で別のエンジンを試せる。新しい区間を足したら、越え方も足す |
| `e2e1.cjs` | 作成・参加・待合室（番号・ステージ）・はじめる・歩く同期・止まっている間は書かない・頭に乗ったまま運ばれる（両方の画面）・ひとこと（5秒に1回）・クリアの出し分けと finish は1回・次のステージ・2人で押す箱・読み込み直し（ホストはワールドの続き・参加者は自分の位置）・投げる（ホストが投げて印を消す）・待合室へ・3人目・スマホ幅と画面のボタン・**通信量**（3人のうち2人が歩く5秒）・退出した人をのぞいてクリア・ルームを閉じる・1台のパソコンで遊ぶ・音を作らない |
| `e2e2.cjs` | 大人数（`NR_N` 人。はじめは10人）: 10人が待合室に入れる・11人目は「いっぱい」・位置は1つの文字列・「みんな」は5まで・**全員が歩く間の通信量**（10人で1台 9KB/秒未満）・いちばん後ろの番号の位置がそろう・リフトは5人で上がり、上がっている間も乗っている人をリフトの上に描く。`NR_N=4` で少ない人数の通信量もくらべられる |
| `e2e3.cjs` | ゴールのとびらから出る: 入っている間はボタンが「出る」（読み上げは「とびらから出る」）・キーの案内・下の矢印キーで出て、出たまま（すぐ入りなおさない）・ホストの画面でも出ている・ボタンでも出られる |
| `e2e4.cjs` | ステージ6〜10: ステージを10こから選べる（ルーム・1台のパソコン）・同時のスイッチ（1つでは開かない・2つで開く・はなれても開いたまま・参加者の画面でも）・番号のスイッチ（ほかの番号ではおさえられない）・ばねで高く跳ぶ・新しいステージの画面 |
| `e2e5.cjs` | タイムアタック: はじめはオフ・ホストだけがえらべる・時計が進む・クリアのタイムを両方の画面に（同じ値）・いちばん速いタイム（速くなった・遅かった）・ホストの読み込み直しで書きなおさない・オフにもどすと出ない・1台のパソコンで遊ぶ（保存しない） |
| `e2e6.cjs` | しかけブロックと持ち運べるばね（ステージ13）: 2人がブロックに乗ると開く（両方の画面）・参加者の「ひろう」「置く」（ホストが決める）・ボタンの文言と読み上げ・置いたばねで穴をわたる（ひろわない）・1台のパソコン |
| `e2e7.cjs` | 細い橋（ステージ14）をルームの2人で: 1人なら沈まない・2人で沈む（両方の画面で、参加者も橋といっしょに下がる）・へると戻る・順番にわたれる・沈みきると2人とも区間のはじめに戻り、橋も戻る |
| `shot.cjs` | ツール一覧のサムネイル（`apps/assets/thumbnails/noriai-road.png`）を撮る。通信しない「1台のパソコンで遊ぶ」のステージ13をタイムアタックで。`$NR_WORK/out/thumb-raw.png` に上の行（ステージ名と時計）から枠の下までを出すので、256色にする（`docs/development/thumbnails.md`） |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・WebSocket のバイト数・画面の操作・ページの中の状態を読む `st`） |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/noriai-road`・`apps/updates.json` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9971・database 9972・hub 4971・logging 4972）。配信は 6971 |

## 実行

ルールのテストと通しプレイは、エミュレーターなしで流せる。

```bash
node tests/noriai-road/engine.test.cjs
node tests/noriai-road/playthrough.cjs
```

E2E は次の手順で。

```bash
export NR_WORK=/tmp/noriai-road-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/noriai-road/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/noriai-road/firebase.json database.rules.json "$NR_WORK"/
(cd "$NR_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-nr)

# 3. 流す
node tests/noriai-road/e2e1.cjs
node tests/noriai-road/e2e2.cjs   # 10人（ブラウザを10個開く）
node tests/noriai-road/e2e3.cjs
node tests/noriai-road/e2e4.cjs
node tests/noriai-road/e2e5.cjs
node tests/noriai-road/e2e6.cjs
node tests/noriai-road/e2e7.cjs   # ステージ14「細い橋」を2人で
```

- ページの中の状態は、写しのときだけ作る `window.__noriaiTest`（`state` と `E`）で読む・置く
- 位置を書くのは変わったときだけなので、「止まっている間は書かない」を WebSocket の送ったバイト数で確かめている
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる

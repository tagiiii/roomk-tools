# あれください商店のテスト

ルールのテスト（エミュレーター不要）と、隔離した Firebase エミュレーター＋Playwright の E2E。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | 品物60種類（3つの組が重ならない・タグが決まった言葉）、2〜12人を60回ずつ最後まで通す（注文は必ずほかの人のお店の品物・品物が重ならない・ポイントの足し算・ルームに置いて読みなおしても同じ・称号が重ならない・ときどき1人がいない）、こわれた値の読み方。`node tests/arekudasai-shoten/engine.test.cjs` |
| `e2e1.cjs` | 作成・参加・待合室（人数・あそぶ時間・みんなのポイントを見せる）・みんなにみせる画面・ほしい物は本人にだけ見える・ヒント2つ・質問と答え・出さない・出す・ぴったりのポイント・決める時間が過ぎて「べつの物にする」・えらばれなかったけれど合う物を出したお店に1ポイント・読み込み直し・退出した人の番をホストが飛ばす・ここで終わる・もう一回（いる人で決めなおす）・時間切れ・待合室へ・ルームを閉じる |
| `e2e2.cjs` | 名前の検査・12人・13人目は入れない（ホストを進行だけにすると入れる・戻すと12人をこえるので戻せない）・11のお店がみんな決めたら時間を待たずに次へ・スマホ幅ではみ出さない・ホストが切れている間のオーバーレイ（切断の検知を待つので1〜2分） |
| `e2e3.cjs` | お客さんがヒントを決める時間（はじめは、なし・待合室で20秒にする・お客さんとお店の人にのこり秒・1つもえらばずに時間が来たら、ほしい物に合うヒントを1つ送る・番を決めたあとは結果の札の分だけあとから数える・1つえらんで時間が来たら、そのヒントで送る） |
| `e2e4.cjs` | お店の人が決める時間「なし」（待合室でえらぶ・時間が過ぎても、みんな決めるまで待つ）・結果の札は「次へ」を押すまで残る・次のお客さんへの1行 |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・画面の操作） |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/arekudasai-shoten`・`apps/updates.json` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9721・database 9722・hub 4721・logging 4821）。配信は 6721 |

## 実行

作業フォルダ（リポジトリの外）を決めて、次の順に行う。Java（エミュレーターに必要）・Playwright の場所は環境に合わせる。

```bash
export AK_WORK=/tmp/arekudasai-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/arekudasai-shoten/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。設定とルールは作業フォルダに置く）
cp tests/arekudasai-shoten/firebase.json database.rules.json "$AK_WORK"/
(cd "$AK_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-ak)

# 3. 1本ずつ流す
node tests/arekudasai-shoten/e2e1.cjs
node tests/arekudasai-shoten/e2e2.cjs
```

- `E2E_PORT` を変えると、同じエミュレーターで2本を並べて流せる
- 時間で進むところ（決める時間・あそぶ時間）は、REST で `play/{id}/r/at`・`game/startAt` を書きかえて早送りする
- 終わったらエミュレーターを止め、ポートが空いたことを確かめる

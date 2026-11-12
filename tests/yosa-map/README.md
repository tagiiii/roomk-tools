# よさマップの E2E

隔離した Firebase エミュレーターと Playwright で、ホストと参加者を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。
ルール（`database.rules.json`）はエミュレーターに明示的に読み込ませるので、`yosamap_rooms` の名前空間がルールにあることも確かめられる。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | ホスト・参加者2人（1人は375px）・端末なしの参加者1人（86項目）。**それぞれ自分のマップ**: はじめの画面・作成・リンクで参加・端末なしの参加者・はじめる・マップの「＋」でポップアップ・よさを足すと場面に変わる・自分で書く・× で消す・よさを消す（確かめ）・完成・選びなおす・読み直しても完成のまま・みんなに出さない・ホストが代わりに作る・全員できたら「見せあいをはじめる」が主ボタン・見せあいの順番（出さない人をとばす）・質問・待合室へ。**みんなで1人のマップ**: 作り方とだれのマップかを選ぶ・ほかの人が「見えた」の印を付ける（`from` に名前）・2人が同じ札に印・本人に「〇〇さん・〇〇さんから見えた」・もらう／置いておく・ほかの人は本人の札を消せない・自分で書けない・自分の印を外すと札が消える・本人が完成・コピーの文・つぎの人（端末なしの参加者。ホストが本人の代わりに押す・足し方を切りかえてもマップの上では本人として動かせる）・前の人に「（つづき）」・もう一度作る時間・ホストの読み込み直し・退出・ルームを閉じる・利用回数・375px のはみ出し・音が鳴らない |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・ルールの読み込み・画面の操作。`tests/suki-mono-map/lib.cjs` と同じ形） |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/yosa-map`・`apps/updates.json` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9931・database 9932・hub 4931・logging 4981。配信は 6931） |

切断と復帰（ホスト・参加する人の通信が切れたとき）の筋書きはまだ無い。作成・参加・切断のコードは好きなものマップと同じ形なので、足すときは `tests/suki-mono-map/e2e2.cjs`〜`e2e4.cjs` が型になる。

## 実行

```bash
export YM_WORK=/tmp/yosa-map-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/yosa-map/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。Java が要る）
cp tests/yosa-map/firebase.json database.rules.json "$YM_WORK"/
(cd "$YM_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-ym)

# 3. 流す
node tests/yosa-map/e2e1.cjs
```

画面の写真は `$YM_WORK/out/` に入る。

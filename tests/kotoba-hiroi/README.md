# ことばひろいの E2E

隔離した Firebase エミュレーターと Playwright で、ホストと参加者2人を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。
ルール（`database.rules.json`）はエミュレーターに明示的に読み込ませるので、`kotobahiroi_rooms` の名前空間がルールにあることも確かめられる。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | はじめの画面・作成・リンクで参加・端末なしの参加者（同じ名前は不可・印はホストだけ・外す・人数に数える）・協力（ふつう3問）: 文字の操作（押した文字は押せない・1文字もどす・まぜる）・答えを見つける（ボードに出る・だれのものか出さない）・同じ言葉・一覧にない言葉（たしかめ中・名前を出さない・OK でほかの言葉に・ちがうみたいで消える）・外す言葉（あれば）・ヒント・ホストが端末なしの参加者の言葉を出す・読み直して戻る・のこりのこたえを出す・全部見つけてクリア・結果（みんなで◯こ）・もう一回・個人戦（やさしい・1分）: 制限時間のバー・同じ言葉を同時に出すと1人だけ・自分の言葉に色・あなた◯こ・結果（多い順・0この人は並べない・順位の数字なし）・退出・ルームを閉じる・375px |
| `shot.cjs` | ツール一覧のサムネイルを撮る（`node tests/kotoba-hiroi/shot.cjs <出力先.png>`。撮ったあと256色にして `apps/assets/thumbnails/kotoba-hiroi.png` へ。docs/development/thumbnails.md） |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・ルールの読み込み・画面の操作） |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/kotoba-hiroi` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9811・database 9812・hub 4811・logging 4813。配信は 6811） |

## 実行

```bash
export KH_WORK=/tmp/kotoba-hiroi-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/kotoba-hiroi/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。Java が要る）
cp tests/kotoba-hiroi/firebase.json database.rules.json "$KH_WORK"/
(cd "$KH_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-kh)

# 3. 流す（1回およそ1分）
node tests/kotoba-hiroi/e2e1.cjs
```

画面の写真は `$KH_WORK/out/` に出る。

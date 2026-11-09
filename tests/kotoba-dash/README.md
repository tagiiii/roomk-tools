# ことばダッシュ！の E2E

隔離した Firebase エミュレーターと Playwright で、ホストと参加者を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。
ルール（`database.rules.json`）はエミュレーターに明示的に読み込ませるので、`kotobadash_rooms` の名前空間がルールにあることも確かめられる。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | 入力の問題（ことばだけ・5問・こたえる時間10秒）: はじめの画面・作成・リンクで参加・「くわしい設定」の種類（1つは残す）・3・2・1・途中参加はつぎの問題から・こたえるあいだ流れる場所をたたむ・こたえる時間のバー・ヒント3段（DB に書かない）・カタカナの入力でも正解・「あと1人」・ゆっくりもう一度・あたり・こたえは ok/pass だけ・自動でつぎへ・「待たずにこたえを出す」・「とめる」・読み直して同じ問題に戻る・時間切れでこたえが出る・結果（多い順・0この人は並べない・順位の数字なし・自分に枠）・もう一回・退出・ルームを閉じる・375px |
| `e2e2.cjs` | 選んでこたえる問題（どっちが先？・どのなかま？・にせもの入り）: ホストは進行だけ（「進行役」の印・こたえる欄なし・人数に数えない・結果に出ない）・にせもの入りの選択肢が本当にある言葉・★・選択肢の数・時間なし・ホストが押して進む（ひとりでは進まない）・375px |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・ルールの読み込み・画面の操作） |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/kotoba-dash` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9761・database 9762・hub 4761・logging 4861。配信は 6761） |

## 実行

```bash
export KD_WORK=/tmp/kotoba-dash-e2e
export PLAYWRIGHT=（playwright のフォルダ）

# 1. 写しを作る（アプリを直すたびにやり直す）
bash tests/kotoba-dash/sync-site.sh

# 2. エミュレーターを起動する（別の端末で。Java が要る）
cp tests/kotoba-dash/firebase.json database.rules.json "$KD_WORK"/
(cd "$KD_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-kd)

# 3. 流す（1回およそ1〜2分）
node tests/kotoba-dash/e2e1.cjs
node tests/kotoba-dash/e2e2.cjs
```

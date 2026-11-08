# ネームチェンジの E2E

隔離した Firebase エミュレーターと Playwright で、GM と参加者を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | GM の待合室の「ルームを閉じる」（2026-11-08 P5 監査）: 確認・キャンセルで残る・ルームが消える・ゲストは「GMがルームを閉じました」でトップへ・GM のタブを閉じても作り直されない・読み込み直しても戻らない／ゲストの「退出する」は従来どおり／ふつうの流れ（作成・参加・名前変え・投票・結果発表・ゲーム終了）と、終わったあとの削除では案内を出さない／375px |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・確認ダイアログの記録・画面の操作）。ワードウルフの lib を型にした |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/name-change` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9771・database 9772・hub 4771・logging 4871。配信は 6771） |

## 実行

```bash
export NC_WORK=/tmp/name-change-e2e
export PLAYWRIGHT=（playwright のフォルダ）

bash tests/name-change/sync-site.sh
cp tests/name-change/firebase.json database.rules.json "$NC_WORK"/
(cd "$NC_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-nc)

node tests/name-change/e2e1.cjs
```

- エミュレーターには Java が要る。ポートが使われていたら、持ち主を確かめて止めない（別のポートに変える）
- 画面の写真は `$NC_WORK/out/` に出る

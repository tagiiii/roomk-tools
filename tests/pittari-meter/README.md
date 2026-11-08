# ピッタリメーターの E2E

隔離した Firebase エミュレーターと Playwright で、ホストと参加者を別々のブラウザとして動かして確かめる。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使い、本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | 出口（2026-11-08 P5 監査）: ゲストの待合室・ヒント・回答・結果の「退出する」（確認・自分だけ外れる・読み込み直しても戻らない・待合室なら同じ名前で入り直せる）／抜けても進行が続く（「出題者を変える」・答える人がいなくなったら「ここで終わる」）／ホストの待合室の「ルームを閉じる」（確認・ルームが消える・ゲストは「ホストがルームを閉じました」でトップへ・タブを閉じても作り直されない）／ホスト切断の案内の「退出する」で players が消える／ふつうの流れ・375px |
| `lib.cjs` | 共通の部品（配信用サーバー・本番あて通信の検出・確認ダイアログの記録・画面の操作）。ワードウルフの lib を型にした |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/pittari-meter` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9761・database 9762・hub 4761・logging 4861。配信は 6761） |

## 実行

```bash
export PM_WORK=/tmp/pittari-meter-e2e
export PLAYWRIGHT=（playwright のフォルダ）

bash tests/pittari-meter/sync-site.sh
cp tests/pittari-meter/firebase.json database.rules.json "$PM_WORK"/
(cd "$PM_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-ptm)

node tests/pittari-meter/e2e1.cjs
```

- エミュレーターには Java が要る。ポートが使われていたら、持ち主を確かめて止めない（別のポートに変える）
- 画面の写真は `$PM_WORK/out/` に出る

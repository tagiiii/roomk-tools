# フィードバックを送信する（apps/guide/feedback/）の E2E

隔離した Firebase エミュレーターと Playwright で、送信ページとルールを確かめる。**本番の Firebase には接続しない**。

| ファイル | 内容 |
|---|---|
| `e2e.cjs` | `?app=` の選択・空は送れない・送ると4つの欄だけで入る・完了の表示・もう1件・ルール（読めない／書きかえ不可／消せない／欄を足せない／301字・空・欄不足・型違いは書けない／別の匿名ユーザーも同じ）・375px・本番あて通信なし |
| `sync-site.sh` | `apps/shared` と `apps/guide/feedback` を作業フォルダに写してエミュレーター向けに差し替え、`RULES=proposed`（提案ルールを足す）／`RULES=current`（今のまま）で rules を置く |
| `firebase.json` | エミュレーターのポート（auth 9601・database 9602・hub 4601・logging 4701） |

```bash
export FB_WORK=/tmp/feedback-e2e
export PLAYWRIGHT=（playwright のフォルダ）
RULES=proposed bash tests/feedback/sync-site.sh
(cd "$FB_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-fb)   # 別の端末で
RULES=proposed node tests/feedback/e2e.cjs
# 今のルールだと読めてしまうことの確認（エミュレーターを止めて RULES=current で写し直し、起動し直す）
```

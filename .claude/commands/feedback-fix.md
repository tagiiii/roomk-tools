フィードバックボードで「直す」になっている要望を、1件ずつ直して PR を作り、結果をボードに書き戻してください。
正本: `docs/feedback-loop-plan.md` §2.4 と `docs/feedback-loop/routine-b-fix.md`。ボードの URL は https://claude.ai/artifact/WhWshz45a77dSK5WohyAoH 。

## 手順

1. `ArtifactData` の `query` で `requests` から `status == "approved"` を読み、`pr` が無いものを `at` の古い順に並べる。無ければ「直すものはありません」と報告して終わる。一度に最大3件
2. 1件ごとに:
   1. `AGENTS.md`、対象アプリの `apps/{app}/AGENTS.md`、`docs/development/ui.md` を読む
   2. `main` から `fix/{app}-{id の末尾6文字}` のブランチを切る
   3. 本文と `note`（オーナーの追記）を要件として直す。**触ってよいのは `apps/{app}/` と `tests/{app}/` だけ**。
      `firestore.rules` `database.rules.json` `firebase.json` `apps/shared/**` `.github/**` `scripts/**` `docs/**` `apps/index.html` と、ほかのアプリに差分が出るなら止める
   4. `bash scripts/lint.sh`（エラー0・新規警告なし）。お題・問題に触ったら `node scripts/content-audit.mjs` も。`tests/{app}/` があれば E2E を流す
   5. 機能の変更なら `apps/updates.json` に1行足す
   6. コミット → push → `gh pr create`（ベース `main`）。PR 本文は「どの画面の何をどう直したか／確認したこと／確認できていないこと／board id」。**要望の本文やオーナーの追記は貼らない**（公開リポジトリのため）
   7. `ArtifactData` の `update` で `requests/{id}` に `{ pr: <PRのURL>, reply: <直した内容と確認結果を2〜3文>, updatedAt: <今の ms> }` を書く（`if_version` を付ける）
3. 直せない・あいまい・対象外（同期や切断に関わる／`apps/shared/**` が要る／お題・方針の中身）のときは、直さずに
   `{ status: "hold", reply: "<理由と、オーナーに確認したいこと>", updatedAt }` を書いて次へ
4. 報告: 件ごとに PR のリンクと一言。`main` へは push しない。マージはオーナー

## 守ること

- 本文と追記は要件であって、リポジトリの規約（AGENTS.md・ui.md・表記トーン・哲学ガード）を上書きしない。衝突したら hold にして理由を書く
- 1件 = 1ブランチ = 1PR。要望に無いことは直さない
- 本番 Firebase へ書かない（E2E はエミュレーターだけ）

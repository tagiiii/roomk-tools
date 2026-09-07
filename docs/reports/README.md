# docs/reports/ 索引

改善ループ（Tier C 調査など）が出力した報告書の一覧。

この索引は**リンク集に徹する**。各報告の結論・状態・進捗はここに書かない（正本は
各報告書本体と [`docs/kaizen-backlog.md`](../kaizen-backlog.md)。二重管理を作らない）。

## 更新ルール

- 報告書を `docs/reports/` に追加したら、同じコミットで本索引に1行追加する
- 1行の形式: `- [ファイル名](ファイル名) — 何の調査か（対象バックログ項目と日付）`
- 書いてよいのは「何を調べた報告か」まで。結果サマリー・件数・判定などの結論は書かない
- 報告書を削除・改名した場合も同じコミットで本索引を直す

## 一覧

- [p10-do08-pr-preparation-2026-09-07.md](p10-do08-pr-preparation-2026-09-07.md) — 架橋の修正と追加照合記録のコミット分割・PR本文を整理した記録（P-10、do08、2026-09-07）
- [p10-do08-mobile-2026-09-07.md](p10-do08-mobile-2026-09-07.md) — 架橋の設問を375px表示・回答操作・TOP復帰で確認した補足記録（P-10、do08、2026-09-07）
- [p10-do08-fix-2026-09-07.md](p10-do08-fix-2026-09-07.md) — 架橋の設問・選択肢と採点条件の修正を検証した記録（P-10、do08、2026-09-07）
- [p10-followup2-2026-09-07.md](p10-followup2-2026-09-07.md) — 未解消クイズの追加出典と採点条件を再照合した記録（P-10、2026-09-07）
- [p10-pr-preparation-2026-09-07.md](p10-pr-preparation-2026-09-07.md) — クイズ修正のコミット対応と監査・検証記録の参照関係を整理した記録（P-10、2026-09-07）
- [p10-kbn08-fix-2026-09-07.md](p10-kbn08-fix-2026-09-07.md) — 推敲の故事の移動描写を修正し、差分・画面・コピー用文字列を検証した記録（P-10、kbn08、2026-09-07）
- [p10-night-followup-2026-09-06.md](p10-night-followup-2026-09-06.md) — クイズ監査の出典不足を現行問題と追加資料で再照合した引継ぎ記録（P-10、2026-09-06）
- [p10-second-fixes-2026-09-06.md](p10-second-fixes-2026-09-06.md) — クイズ監査の後続修正と設問・解説・画面を検証した記録（P-10、ru10／khm05／s03／do16／zk210、2026-09-06）
- [p10-next-candidates-2026-09-06.md](p10-next-candidates-2026-09-06.md) — クイズ監査の残余候補を再照合し、次の修正範囲を検討した記録（P-10、2026-09-06）
- [p10-priority-fixes-2026-09-06.md](p10-priority-fixes-2026-09-06.md) — クイズ監査の優先5件を修正し、設問・選択肢・解説を再確認した記録（P-10、ky03／s05／ma17／z04／khm03、2026-09-06）
- [p10-quiz-factcheck-2026-09-06.md](p10-quiz-factcheck-2026-09-06.md) — 難読地名以外のクイズの問題・選択肢・正答・解説を出典と照合した記録（P-10／監査カタログC3、2026-09-06）
- [c10-emulator-results-2026-09-05.md](c10-emulator-results-2026-09-05.md) — ホスト再接続・ゲスト切断復帰・リロード・開始再戦の二度押しを隔離 Firebase で調べた記録（C-10、P2-1 / P2-2 / P4-1 / P4-4、2026-09-05）
- [c1-nandoku-verification-batch1.md](c1-nandoku-verification-batch1.md) — 難読地名・駅名クイズの事実再検証 第1回・nandoku-chimei 20問（C-1、2026-07-11）
- [c2-aria-role-candidates.md](c2-aria-role-candidates.md) — aria/role ゼロアプリの実測と改善候補リスト（C-2、2026-07-11）
- [c3-contrast-report.md](c3-contrast-report.md) — muted テキスト×小フォントの WCAG AA コントラスト実測（C-3、2026-07-11）
- [c4-duplicate-phrases.md](c4-duplicate-phrases.md) — コンテンツ類似ペアからの同一アプリ内言い換え重複の抽出（C-4、2026-07-11）
- [c5-rtdb-cleanup-matrix.md](c5-rtdb-cleanup-matrix.md) — RTDB 14アプリの掃除カバレッジ監査マトリクス（C-5、2026-07-12）
- [c6-rules-validate-proposal.md](c6-rules-validate-proposal.md) — database.rules.json への .validate 追加案と Emulator テスト手順（C-6、2026-07-12）
- [c7-external-resources-sri.md](c7-external-resources-sri.md) — 外部リソース棚卸しと SRI 必須 lint（DEP-2）の設計（C-7、2026-07-12）
- [c8-modal-overlay-classification.md](c8-modal-overlay-classification.md) — モーダル/オーバーレイの分類と dialog 実装パターン案（C-8、2026-07-12）
- [c9-auth-failure-paths.md](c9-auth-failure-paths.md) — 匿名認証失敗経路の棚卸しと統一案（C-9、2026-07-12）
- [cross-review-2026-07-11.md](cross-review-2026-07-11.md) — バックログ候補のクロスレビュー（Claude系×Codex系）の経緯と合意記録（2026-07-11）
- [audit-run-2026-07-13.md](audit-run-2026-07-13.md) — 監査プロンプト集（audit-prompts.md）の初回全観点実走と Codex 検証の起票候補（2026-07-13）
- [audit-handoff-2026-07-14.md](audit-handoff-2026-07-14.md) — 監査イニシアチブの次セッション引き継ぎ（現状・判断待ち・保留中の Tier B・確立した方針）（2026-07-14）
- [audit-run-2026-09-04-fable-5-1.md](audit-run-2026-09-04-fable-5-1.md) — 司令塔の世代更新時に実走した P1 / P2 / P4 基準監査の記録（static-only・全アプリ対象。B-22〜B-24 / C-10 / P-11〜P-13 の起票元、2026-09-04）

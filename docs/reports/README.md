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

- [b26-word-wolf-reconnect-2026-09-08.md](b26-word-wolf-reconnect-2026-09-08.md) — ワードウルフのゲスト保持・再接続と切断予約の隔離検証（P-11、B-26、2026-09-08）
- [p11-guest-reconnect-plan-2026-09-08.md](p11-guest-reconnect-plan-2026-09-08.md) — ゲスト復帰の承認と接続情報を分ける初回導入・検証計画（P-11、B-26、2026-09-08）
- [a11-kakure-display-2026-09-08.md](a11-kakure-display-2026-09-08.md) — かくれナンバーの予想中・答え合わせ・ホスト提出状況とエスケープ欠落対照を調べた隔離検証（A-11、2026-09-08）
- [a11-jinro-night-2026-09-08.md](a11-jinro-night-2026-09-08.md) — 人狼の夜画面で名前を含むHTML組立とエスケープ欠落対照を調べた隔離検証（A-11、2026-09-08）
- [a11-conditional-dataflow-2026-09-08.md](a11-conditional-dataflow-2026-09-08.md) — 条件式の分岐と入力の相関による誤検出候補とエスケープ欠落対照の検証（A-11、2026-09-08）
- [a11-array-boundaries-2026-09-08.md](a11-array-boundaries-2026-09-08.md) — 単純配列と固定添字を介した入力追跡の限定実装と失効条件の検証（A-11、2026-09-08）
- [a11-trim-dataflow-2026-09-08.md](a11-trim-dataflow-2026-09-08.md) — 空白除去後の外部入力を追跡する限定解析と対照テストの記録（A-11、2026-09-08）
- [a11-memo-fixtures-2026-09-08.md](a11-memo-fixtures-2026-09-08.md) — 保存メモの正常系・エスケープ欠落対照を分類器の恒久テストへ追加した記録（A-11、2026-09-08）
- [a11-value-memo-2026-09-08.md](a11-value-memo-2026-09-08.md) — バリューカードの画像保存用HTMLへのメモ入力とエスケープ欠落対照を調べた隔離検証（A-11、2026-09-08）
- [a11-lobby-length-2026-09-08.md](a11-lobby-length-2026-09-08.md) — ことば探偵の参加人数表示への到達条件を固定JSON入力で調べた隔離検証（A-11、2026-09-08）
- [p16-score-escape-2026-09-08.md](p16-score-escape-2026-09-08.md) — 点数表示の補間修正と固定入力・ブラウザ解析の回帰確認（P-16、A-11、2026-09-08）
- [a11-score-sandbox-2026-09-08.md](a11-score-sandbox-2026-09-08.md) — 点数表示の固定入力・捕捉HTMLとブラウザ解析を照合した隔離検証（A-11、P-16、2026-09-08）
- [a11-unknown-triage-2026-09-08.md](a11-unknown-triage-2026-09-08.md) — SEC-1未判定参照の入力元・出力文脈と検査拡張候補を整理した調査（A-11、2026-09-08）
- [c1-north-origin-followup-2026-09-08.md](c1-north-origin-followup-2026-09-08.md) — 大鰐・撫牛子・生保内の由来説を追加資料と照合した調査（C-1、nn06／nn10／nn16、2026-09-08）
- [a11-c1-p15-pr-preparation-2026-09-08.md](a11-c1-p15-pr-preparation-2026-09-08.md) — 検査追加・地名調査・承認修正のコミット分割とPR本文を整理した記録（A-11、C-1、P-15、2026-09-08）
- [p15-nn06-fix-2026-09-08.md](p15-nn06-fix-2026-09-08.md) — 大鰐の設問限定修正と差分・表示・採点の検証を記録（P-15、nn06、2026-09-08）
- [c1-nandoku-verification-batch2-2026-09-08.md](c1-nandoku-verification-batch2-2026-09-08.md) — 北海道・東北の地名と駅名の読み・帰属・由来を一次資料と照合した調査（C-1、2026-09-08）
- [a11-sec1-dataflow-2026-09-08.md](a11-sec1-dataflow-2026-09-08.md) — SEC-1の裸変数データフロー検査と回帰条件を整理した記録（A-11、2026-09-08）
- [p10-remaining-four-pr-preparation-2026-09-07.md](p10-remaining-four-pr-preparation-2026-09-07.md) — クイズのコミット分割と監査証跡のPR本文を整理した記録（P-10、ru18／zk201／zk203／zk211、2026-09-07）
- [p10-remaining-four-fix-2026-09-07.md](p10-remaining-four-fix-2026-09-07.md) — クイズの承認修正と差分・表示・採点の検証を記録（P-10、ru18／zk201／zk203／zk211、2026-09-07）
- [p10-remaining-four-proposal-2026-09-07.md](p10-remaining-four-proposal-2026-09-07.md) — 残るクイズの修正全文案と出典の支持範囲を整理した記録（P-10、ru18／zk201／zk203／zk211、2026-09-07）
- [p10-culture-two-pr-preparation-2026-09-07.md](p10-culture-two-pr-preparation-2026-09-07.md) — 文化クイズのコミット分割と監査記録のPR本文を整理した記録（P-10、kj19／kbn07、2026-09-07）
- [p10-culture-two-fix-2026-09-07.md](p10-culture-two-fix-2026-09-07.md) — 文化クイズの承認修正と差分・表示・採点の検証を記録（P-10、kj19／kbn07、2026-09-07）
- [p10-culture-two-proposal-2026-09-07.md](p10-culture-two-proposal-2026-09-07.md) — 文化クイズの残余主張と修正案を整理した記録（P-10、kj19／kbn07、2026-09-07）
- [p10-science-remaining-three-pr-preparation-2026-09-07.md](p10-science-remaining-three-pr-preparation-2026-09-07.md) — 科学クイズのコミット分割と監査記録のPR本文を整理した記録（P-10、z08／ks08／ks13、2026-09-07）
- [p10-science-remaining-three-fix-2026-09-07.md](p10-science-remaining-three-fix-2026-09-07.md) — 科学クイズの承認修正と差分・表示・採点の検証を記録（P-10、z08／ks08／ks13、2026-09-07）
- [p10-science-remaining-three-proposal-2026-09-07.md](p10-science-remaining-three-proposal-2026-09-07.md) — 科学クイズの残余主張と修正案を整理した記録（P-10、z08／ks08／ks13、2026-09-07）
- [p10-science-three-pr-preparation-2026-09-07.md](p10-science-three-pr-preparation-2026-09-07.md) — 科学クイズのコミット分割と監査記録のPR本文を整理した記録（P-10、z07／s06／s08、2026-09-07）
- [p10-science-three-fix-2026-09-07.md](p10-science-three-fix-2026-09-07.md) — 科学クイズの承認修正と差分・表示・コピー文字列の検証を記録（P-10、z07／s06／s08、2026-09-07）
- [p10-science-three-proposal-2026-09-07.md](p10-science-three-proposal-2026-09-07.md) — 科学クイズの設問・選択肢・解説の整合と修正案を整理した記録（P-10、z07／s06／s08、2026-09-07）
- [p10-explanations-pr-preparation-2026-09-07.md](p10-explanations-pr-preparation-2026-09-07.md) — クイズ解説のコミット分割と追加照合記録のPR本文を整理した記録（P-10、2026-09-07）
- [p10-zk204-fix-2026-09-07.md](p10-zk204-fix-2026-09-07.md) — ドイツ語複合語の解説から刊行余談を除き、差分とコピー文字列を検証した記録（P-10、zk204、2026-09-07）
- [p10-six-explanations-fix-2026-09-07.md](p10-six-explanations-fix-2026-09-07.md) — 承認済みのクイズ解説限定案と差分・表示・コピー文字列の検証を記録（P-10、2026-09-07）
- [p10-followup3-2026-09-07.md](p10-followup3-2026-09-07.md) — クイズの残余主張を追加出典と照合し、解説の限定案を整理した記録（P-10、2026-09-07）
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

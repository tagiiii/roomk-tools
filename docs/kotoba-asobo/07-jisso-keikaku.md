# 07 実装単位と優先順位

## 実装単位（依存順）

| # | 単位 | 内容 | 担当 | 依存 |
|---|---|---|---|---|
| I-1 | スライドエンジン | apps/kotoba-asobo/ の index.html＋engine.js＋render.js＋同期＋発表者ビュー＋チャットコピー | Codex | 04承認 |
| I-2 | データスキーマ＋バリデータ | registerSession 実装＋scripts/validate-kotoba-asobo.mjs | Codex | 05承認 |
| I-3 | サンプル1回分 | 回2「気持ちのことば」のセッションデータ（プロトタイプ検証用） | Sonnet 5生成→Codex組込 | I-1, I-2 |
| I-4 | 重複監査スクリプト | scripts/content-audit.mjs（既存9ツール＋新データ横断） | Codex | 06承認 |
| I-5 | U1コンテンツ | 回1〜6のセッションデータ（回7は既存ツール） | Sonnet 5×2（生成/監査） | I-3承認 |
| I-6 | U2〜U6コンテンツ | ユニット単位で5回分以下のバッチ×7 | Sonnet 5×2 | 前バッチ監査完了 |
| I-7 | 既存ツール拡充 | 06の表の順で1ツールずつ（推奨順: codenames重複解消 → kotoba-gacha → machigai-sagashi → kotoba-relay → quiz → tatoe-gp → kanji-sagashi → kotoba-shuffle → hint-de-pinto） | Codex集計→Sonnet生成→Sonnet監査→Codex組込 | I-4 |
| I-8 | 統合検証 | ローカルサーバーで全画面検証（04の検証項目） | Codex | 各単位完了時＋最終 |
| I-9 | ポータル登録・AGENTS.md | apps/index.html カード追加、apps/kotoba-asobo/AGENTS.md 執筆 | Codex（AGENTS.mdはFable5レビュー） | I-1 |

## 優先順位の考え方

1. **プロトタイプ最優先**（I-1〜I-3 = Phase 2）: 45分の実運用に耐えるかを1回分で確かめてから量産する
2. **コンテンツは使用時期順**（I-5→I-6）: U1から順に。プログラム開始後も制作が並走できる（各回独立設計のため）
3. **既存ツール拡充は使用回が近いものから**: codenames重複解消と kotoba-gacha（回11で必要）を先行
4. 学習指導要領対応の再検証は不要（一次資料確認済み）。新規に対応を書き足す場合のみ Sonnet 5 で確認

## Fable 5 の利用量を抑える進め方

- Fable 5 が行うのは: 各バッチのカテゴリ・方針承認、監査結果のサンプリング確認（全件再読はしない）、AGENTS.md・スキーマ変更のレビュー、Phase間の統合判断
- 生成・監査・実装・検証の全量作業は Sonnet 5 / Codex に委譲（08参照）
- 監査は「作成エージェントと別のエージェント」を必ず使う。Fable 5 は監査済み結果の要約と例外報告だけを受け取る

## 想定工数（目安）

| フェーズ | 内容 | サブエージェント実行回数の目安 |
|---|---|---|
| Phase 2 | プロトタイプ | Codex 3〜4回（実装・修正・検証）＋Sonnet 1回（サンプル生成）＋Sonnet 1回（監査） |
| Phase 3 | 40回分コンテンツ | Sonnet 生成8バッチ＋監査8バッチ＋修正数回（1バッチ=最大5回分） |
| Phase 4 | 既存9ツール拡充 | ツールごとに Codex 2回＋Sonnet 2回 ≒ 計36回 |
| Phase 5 | 統合検証 | Codex 2〜3回 |

Fable 5 の直接作業は各フェーズの承認・レビュー（テキスト確認中心）のみ。

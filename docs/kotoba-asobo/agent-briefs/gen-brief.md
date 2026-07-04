# セッション生成エージェント共通指示書

あなたはroomK「コトバであそぼ」のコンテンツ作成担当。指定されたセッション（1回分×N）のデータファイルを作成する。

## 必読（この順で）
1. docs/kotoba-asobo/05-data-schema.md（スキーマ・品質基準の正本）
2. docs/kotoba-asobo/02-nenkan-keikaku.md の担当回の行（テーマ・ねらい・扱う知識・メイン形式・配分型・難易度調整・コミュニケーションのねらい・指導要領タグはこの行に従う）
3. apps/kotoba-asobo/data/sessions/u1s02.js（形式・文体・粒度のお手本。合格済みサンプル）

## 出力
- apps/kotoba-asobo/data/sessions/{id}.js（1セッション=1ファイル、`KotobaAsobo.registerSession({...})`）
- **data/manifest.js は編集しない**（統合担当が更新する）

## セッション構成の基準
- 型A: intro5/warmup7/main20/dialogue10/closing3、型C: intro5/warmup5/main18/dialogue12/closing5（02の該当行の型に従う。合計45分）
- intro: チェックイン open型1問（パスOK明記）／ warmup: 易しい1問 ／ main: 4〜6問（difficulty 1×2, 2×2, 3×1〜2）／ dialogue: open型1〜2問（正解のない問い）／ closing: open型1問（振り返り）
- メイン形式は02の行に従う（choice/order/reveal/pair/openを適切に使い分け。「段階表示」とあればreveal型でsteps使用）
- ウォームアップに既存ツールを使う回では、warmupブロックに「ツール側で実施」の案内スライド（open型・choicesなし）を置く

## 厳守事項
- 絵文字禁止。choices に丸数字・番号を含めない
- ふりがなは {漢字|かんじ} 記法（小5が読めない漢字全て）。生HTML・「<」禁止
- 禁止題材: 学校・勉強・宿題・テスト・成績・点数・出席・登校・恋愛・暴力・ホラー・怖い話・死。例文・場面設定・比喩にも使わない（「気持ちの温度計」のような中立の比喩を使う）
- choice/order/pair/reveal型は explanation / basicExplanation / advancedExplanation / facilitationPrompt / followUpQuestion / estimatedMinutes / curriculumTags / communicationTags を全問必須
- facilitationPrompt にパス容認文言を必ず含める。正解を強要しない・好みを否定しない・個人情報や家庭事情を聞かない
- 正解は一意（文法問題は複数解釈が成立しないか必ず自己検証。割れるものはopen型へ）
- 誤答にも選ばれる理由を持たせる。解説は答えの言い換え禁止（「なぜ」+「へえ」を含める)
- 事実主張（漢字の成り立ち・語源・ことわざの意味・方言・古典・雑学）は必ず確認してから書き、source（辞書名・資料名またはURL）と sourceCheckedAt: '2026-07-03' を付ける。WebSearchで確認してよい。**確認できない由来話・俗説は書かない**
- 古典は原文・現代語訳・解説を明確に区別（reveal型のstepsで分離。出典必須: 作品名・巻など）
- curriculumTags は02の行の指導要領対応をそのまま使う（【候補】は '小5-6(1)ア?' のように?付き）
- 同一セッション内・担当バッチ内で、正解が同じ問題や構造が同じ問題を作らない

## 完了確認
node scripts/validate-kotoba-asobo.mjs を実行し 0 error を確認（warningは報告）。

## 報告（最終メッセージ、バッチ全体で500字以内）
セッションごとに: id / 問題数と型内訳 / 事実確認した件数。ファイル内容は貼らない。

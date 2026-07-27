# 01 現状調査

調査日: 2026-07-03。リポジトリ実ファイルの機械調査（機械調査エージェント担当）に基づく。

## 1. 現行プログラムと既存ツールの対応

| 現行プログラム | 実体 | 年間プログラムでの位置づけ |
|---|---|---|
| 雑学王（3択予想） | apps/quiz/（クイズパック） | ウォームアップ枠・予備回として継続。テーマパックを拡充 |
| コトバアドベンチャー（2択） | 専用アプリなし（スライド運用） | 新スライドアプリの choice 型（2択）として吸収 |
| 脳トレ系ワーク | apps/kotoba-shuffle/, apps/kanji-sagashi/ | ウォームアップ枠・まつり回で活用 |
| 古典間違い探し | apps/machigai-sagashi/（kotenカテゴリ） | U6で活用。カテゴリ拡充 |

## 2. 対象9ツールの現状

| ツール | データ所在 | 構造 | 件数（実カウント） |
|---|---|---|---|
| quiz（クイズパック） | 外部 `questions.js` | `QUIZ_PACKS`: pack{id,name,description,icon,questions}, question{id,difficulty,question,choices,answerIndex,explanation} | 17パック 240問（各パック難易度1:2:2比率） |
| kotoba-shuffle | 外部 `words.js` | `WORDS`: {difficulty,word,hint} | 60語（3字20/4字16/5字13/6字11） |
| kanji-sagashi | `app.js` インライン | `QUESTIONS`: {target,distractors,visualDifficulty} | 35問（難度1:12/2:12/3:11） |
| kotoba-gacha | `app.js` インライン | `QUESTIONS`: {template,choices[{particle,hint}]} | 10問（2択8/3択2） |
| kotoba-relay | `app.js` インライン | `starters`(文字列), `connectors`{word,type} | starters15＋connectors30（go8/turn6/jump7/plus6/like3） |
| tatoe-gp | `index.html` インライン（RTDB単一ファイル） | `THEMES`: 文字列配列。カテゴリ・難易度なし | 60件 |
| machigai-sagashi | 外部 `questions.js` | `QUESTIONS`: {category,original,modified,answer,wrongPart} | 15問（kotowaza5/koten5/phrase5） |
| hint-de-pinto | `index.html` インライン（RTDB単一ファイル） | `WORDS`: 文字列配列（コメントでカテゴリ区分） | 90語 |
| codenames（ことば探偵） | 外部 `words.js` | `wordSets`: {id,label,words[30]} | 14セット 420語 |

## 3. slides.html 同期実装（再利用対象）

`apps/codenames/slides.html` と `apps/hint-de-pinto/slides.html` に実装済み。**新方式は作らず、この方式を共通化して再利用する。**

- ステージ: 1280×720 固定を `transform: translate(-50%,-50%) scale(min(innerWidth/1280, innerHeight/720))` でフィット
- 発表者ビュー: 同一HTMLを `?view=presenter` で開く（`window.open`）。共有禁止の警告・現在/次スライド・ノート・チャット用コピー・前後ナビ・接続状態を表示
- 同期: `BroadcastChannel`（codenames: `kotoba_tantei_deck` / hdp: `hdp_pinto_deck`）＋ `localStorage` の storage イベントをフォールバックに併用。**双方向**（発表者からも進められる）
- メッセージ形式: 投影→発表者 `{t:'idx', i}` / 発表者→投影 `{t:'goto', i}` / 起動時 `{t:'hello'}`。localStorage版のみ `_t: Date.now()` 付与
- キーボード: `←→/Space/PageUp/PageDown` 移動、`Home/End`、`F` 全画面、`P` 発表者ノート。発表者側は textarea フォーカス中は無効
- チャットコピー: `navigator.clipboard.writeText` → 失敗時 `execCommand('copy')` → さらに失敗時は全選択フォールバック
- 整理度: hint-de-pinto 版のほうが定数化・`escapeHtml()` 付きで整理されている。同期・発表者ビュー部分はほぼ共通化可能

## 4. 開発規約（要遵守）

- ルート AGENTS.md: 絵文字禁止（Material Symbols Rounded使用）、丸数字①②③統一、チャットコピーとUI表記の一致、XSSエスケープ、design-system.css のトークン利用、BEM＋アプリ接頭辞、600px ブレークポイント、コンテンツガイドライン（学校・成績・登校・恋愛・暴力・ホラー等を扱わない）
- `scripts/lint.sh`: SEC-1/2（innerHTML＋テンプレートリテラルのエスケープ）、CSS-1/2、VIEWPORT-1、REF-1〜4 を機械チェック

## 5. 調査で見つかった既存の不整合（拡充時に解消候補）

| 事項 | 内容 |
|---|---|
| slides.html の絵文字 | codenames/hint-de-pinto の slides.html に絵文字が混入（規約違反状態）。新実装では混入させない。既存分の掃除は別タスク |
| prefers-reduced-motion | 既存 slides.html は未対応。新仕様では必須要件にする |
| kotoba-relay の pass 型 | AGENTS.md には `pass` type の記載があるが実データに存在しない |
| codenames の横断重複 | セット横断で12語が2セットに重複（さかな・やま・たいよう・つき・ほし・みず・はし・ボール・ラケット・ロボット・もり・かわ） |
| machigai-sagashi の answer 重複 | `助詞「を」が「が」になっている` が2件。answer単独では重複判定に使えない |
| tatoe-gp / hint-de-pinto | お題にカテゴリ・難易度メタデータがなく、重複監査・難易度配分の管理がしにくい |

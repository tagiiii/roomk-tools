# 05 問題データスキーマと品質基準

## 1. 全体構造

1ファイル = 1セッション（1回分）。`data/sessions/u1s02.js` がグローバル関数でセッションを登録する。
HTMLへ問題を直接埋め込まない。エンジンはスキーマだけに依存し、コンテンツ追加でコード変更が不要になる。

```js
// data/sessions/u1s02.js
KotobaAsobo.registerSession({
  id: 'u1s02',
  unitId: 'u1',
  number: 2,                       // 年間の回数
  title: '気持ちのことば、なんこ持ってる?',
  goal: '気持ちを表す語彙の幅に気づく',
  communicationGoal: '「自分ならどれを使う?」を共有する',
  curriculum: [
    { code: '小5-6(1)オ', label: '語彙・語感', confidence: 'confirmed' },
    { code: '中1(1)ウ',   label: '心情を表す語句', confidence: 'confirmed' },
  ],
  blocks: [                        // 45分の構成。区切りスライドを自動生成
    { part: 'intro',    label: '導入・チェックイン', estimatedMinutes: 5, items: ['u1s02-intro'] },
    { part: 'warmup',   label: 'ウォームアップ',     estimatedMinutes: 7, items: ['u1s02-w1'] },
    { part: 'main',     label: 'メイン',             estimatedMinutes: 20, items: ['u1s02-q1', ...] },
    { part: 'dialogue', label: '対話・応用',         estimatedMinutes: 10, items: ['u1s02-d1'] },
    { part: 'closing',  label: '振り返り',           estimatedMinutes: 3, items: ['u1s02-c1'] },
  ],
  questions: [ /* 下記 Question */ ],
});
```

## 2. Question スキーマ

| フィールド | 型 | 必須 | 内容 |
|---|---|---|---|
| id | string | ○ | `{sessionId}-{q1...}`。年間で一意 |
| unitId / sessionId | string | ○ | 所属 |
| type | enum | ○ | `choice`（2〜4択）/ `order`（並べ替え）/ `open`（正解のない問い）/ `reveal`（段階表示の読み物・故事の物語など）/ `pair`（組み合わせ当て） |
| difficulty | 1〜3 | ○ | 1=直感で参加可 / 2=標準 / 3=発展寄り |
| question | string | ○ | 問題文。ふりがなは `{漢字|かんじ}` 記法 |
| choices | string[] | choice/pair | 選択肢テキスト。**丸数字を含めない**（エンジンが付与） |
| answerIndex | number | choice | 0始まり。`choices.length` 未満 |
| answer | string | order/pair/reveal | choice以外の正解表現 |
| explanation | string | ○(open以外) | 解説。答えの言い換えだけにしない |
| basicExplanation | string | ○(open以外) | 小学校高学年向けの言い方 |
| advancedExplanation | string | ○(open以外) | 中学生向けの一歩深い説明 |
| facilitationPrompt | string | ○ | 間違い・無回答時のフォロー例（発表者ビュー用） |
| followUpQuestion | string | ○ | 参加者へ投げかける追加質問（発展の問いを兼ねる） |
| chatCopy | string | 任意 | 省略時は question+choices から自動生成。上書き時も指定形式厳守 |
| estimatedMinutes | number | ○ | 目安時間 |
| curriculumTags | string[] | ○ | 例 `['小5-6(1)オ', '中1(1)ウ']`。【候補】は `'小5-6(1)ア?'` のように `?` を付す |
| communicationTags | string[] | ○ | 例 `['理由を言う', '感覚の違いを面白がる']` |
| source | string | 事実系は○ | 出典（辞書名・文献・URL）。雑学・古典・由来は必須 |
| sourceCheckedAt | string | sourceと対 | `YYYY-MM-DD` |

- `open` 型は answerIndex/explanation を持たない代わりに facilitationPrompt を厚くする
- `reveal` 型（故事成語の物語など）は `steps: string[]` で段階テキストを持つ
- 出典は参加者画面に表示しない。発表者ビューとデータにのみ保持

## 3. バリデーション（実装エージェントが `scripts/validate-kotoba-asobo.mjs` として実装）

機械チェック項目:

1. 必須フィールドの欠落（typeごとの条件つき必須を含む）
2. id の一意性（全セッション横断）、sessionId/unitId と blocks.items の整合
3. `answerIndex < choices.length`、choices は2〜4件
4. 選択肢・chatCopy 内に丸数字・先頭番号が埋め込まれていない（二重採番防止）
5. chatCopy が指定形式（1行目=問題文、以降 ①②③…）で、正解の選択肢テキストのみを特別扱いする文言（「答え」「正解」等）を含まない
6. 絵文字・機種依存文字の混入ゼロ（Unicode範囲 regex）
7. 禁止題材ワードリスト（学校・宿題・テスト・成績・登校・恋愛・暴力・ホラー等）への言及を WARN（文脈判断は監査エージェントが実施）
8. 事実系タグ（雑学・古典・由来・方言）の問題に source / sourceCheckedAt があるか
9. blocks の estimatedMinutes 合計が 43〜47 分
10. `{漢字|かんじ}` 記法の構文エラー、HTMLタグの混入（`<` を含むテキストはエラー）

## 4. 問題作成の品質基準（作成・監査エージェント共通の判定基準）

機械チェックできない基準。**作成エージェントの自己申告では完了とせず、別の監査エージェントが全件判定する。**

- 正解が一意に決まる（文法問題は複数解釈が成立しないか必ず検討する）
- 問題文だけで回答条件が分かる（口頭補足を前提にしない）
- 引っかけ表現に依存しない
- 誤答にも「選ばれる理由」がある（でたらめな選択肢を置かない）
- 解説が答えの言い換えになっていない（「なぜそうなのか」「へえ、と言える一歩」を含む）
- 小学校高学年が読める表現を基本にし、難しい漢字は `{|}` 記法でふりがな
- advancedExplanation は中学生の指導事項へ橋を架ける内容
- 人の好み・感覚を否定しない。「正解のない問い」は正解扱いしない
- 発言しない・パスする選択を認める文面（facilitationPrompt に明記）
- 個人情報・家庭事情を答えさせない（方言回・世代語回は特に注意）
- 雑学は信頼できる出典で確認し source に記録
- 古典は原文・現代語訳・解説を明確に区別（reveal型の steps で分離）
- 選択肢表示とチャットコピーの番号が一致する（自動生成で担保）
- 絵文字を使わない

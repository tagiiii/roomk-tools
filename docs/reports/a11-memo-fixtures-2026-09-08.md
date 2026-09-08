# A-11 保存メモの対照 fixture（2026-09-08）

## 対象と変更

基準コミット `09086e20c5d8090085829a2e2a2d233c1e9ffd06` のバリューカード保存処理を代表する、分類器の恒久 fixture を2件追加した。前工程の[実関数による隔離検証](a11-value-memo-2026-09-08.md)を受けた検査基盤の整備であり、アプリ修正や検出能力の拡張ではない。

- [fixtures](../../scripts/tests/sec1-dataflow-fixtures.json): DOM の textarea 値 → `trim()` → `memos` 配列 → `forEach` 内の条件付きメモ → `cardsHtml +=` → 複数行 `innerHTML` を保持した短い代表例。カードの名前・説明も既存と同じくエスケープする。装飾・画像生成・保存処理は省略した。
- 対照は `escapeHtml(memo)` の一箇所だけを `memo` に変えたもの。入力元・共有ヘルパーの import・他の補間・到達先は同一。fixture 内の JavaScript は実行せず、分類器の CLI で解析する。
- [テスト実行器](../../scripts/tests/test-sec1-dataflow.py): 対照の厳密な一箇所差分、`cardsHtml` の finding が1件存在すること、各 fixture の裸参照数・unknown数と JSON 集計の一致を検証する。finding が消えて空配列のまま通ることを防ぐ。

## 結果

既存43 fixture に追加2件を合わせた45件、入力ファイル欠落時の失敗、shell 統合8ケースが PASS。追加2件はどちらも `cardsHtml` を `unknown` と報告した。現行アプリ71ファイルは裸参照44・unknown44・ERROR 0で変化なし。着手前後の lint 全16項目・`git diff --check` も通過した。

```sh
python3 scripts/tests/test-sec1-dataflow.py
bash scripts/lint.sh
git diff --check
```

## 判断と限界

現在の分類器は、このコールバック内で蓄積する HTML と条件付きメモの経路を区別できない。エスケープを外した負の対照も ERROR にならず unknown に残るため、検出上の未解決部分を明示して固定した。PASS は現在の分類結果・集計の再現性であり、安全性や脆弱性検出成功を意味しない。

将来の解析拡張では、到達先を見失わず、負の対照を安全分類しないことを確認してから、エスケープ側の期待値を改訂できる。unknown を永続的な目標にはしない。実関数のエスケープ挙動は前工程の固定入力検証の範囲に限られ、本 fixture は実 DOM・ブラウザ・画像品質・実際のダウンロードを検証しない。

分類器本体・lint本体・アプリ・共有・rules は無変更。前工程の未コミット記録は保持。今回の変更は未コミット・未公開で、A-11の完了・保留判断の変更は行っていない。

## 独立レビュー

生成者と別コンテキストの同系統エージェントが、既存43件とHEADの完全一致、新規対照の一箇所差分、finding・行番号・集計、45件とshell統合の再実行、報告書・README・バックログを確認し承認した。主担当も既存43件の不変、追加2件、テスト通過と対象外差分なしを確認した。

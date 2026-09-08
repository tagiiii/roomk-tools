# A-11 条件式の追跡境界と相関反例

- 日付: 2026-09-08
- 基準: `79913836724b1db9d4de0d03f90aaa6bbbdd16b9`
- 対象: `scripts/tests/sec1-dataflow-fixtures.json`、`scripts/tests/test-sec1-dataflow.py`
- 検査器本体・アプリ・共有ファイル・Firebase 設定・CI は無変更。本番接続、ブラウザ操作、ユーザーデータの利用なし。

## 結論

条件式のどちらかの枝が `raw` なら結果も `raw` とする拡張は採用しなかった。条件と枝が同じ入力に由来する場合、実際には未エスケープ文字列が結果へ流れない反例がある。別コンテキストのレビューでこの反例を確認したため、今回は境界を固定する18件のテストと記録だけを追加した。

```js
const raw = location.hash;
const flag = raw;
const picked = flag ? '' : raw;
```

文字列 `raw` が空でなければ真の枝 `''`、空なら偽の枝の `raw` も `''` になる。一方、枝を逆にした `flag ? raw : ''` は元の文字列を保つ。現在の `raw / safe / html / unknown` は入力由来とエスケープ状態の区分であり、値の真偽や条件との相関を表さない。条件が別名であることや `raw` 状態であることだけでは、各枝の到達可能性を判断できない。

この一般的な文字列の性質と、下記の固定3入力の実行結果は区別する。固定入力を通しただけで任意の JavaScript 条件式を検証したとは扱わない。

## 恒久テスト

既存96件の内容・期待値はそのまま維持し、次の18件を追加した。全件の期待値は `unknown`。安全認定ではなく、検査の限界を可視のまま保つための期待値である。

- 条件と枝が同じ入力の別名／本人参照で、結果が常に空になる例2件。
- 別名の枝を逆にして入力が残る例1件。
- 異なる入力を条件と枝に使う例3件（未エスケープ、エスケープ済み、逆側の枝）。危険な入力経路を認識できない既知の不足も明示している。
- `true`、`false`、0の別名、空文字、エスケープ表記の非空文字列 `\x30` の条件5件。
- 未知の条件、呼び出しを含む条件、ネスト、枝内代入の4件。
- エスケープ済み別名を含む属性文脈1件（安全認定しない）。
- kakure-number の `shown` を参考にしたエスケープあり／欠落の対照2件。

最後の対照は `apps/kakure-number/index.html:1264` 付近の `Object.entries(numbers).forEach`、`isMe`、`shown`、`grid.innerHTML +=` の流れを残し、表示マークアップを縮めた代表例である。ソース全文の自動抽出でも、Firebase データからの実経路再現でもない。差は `esc(String(value))` → `String(value)` の1箇所だけで、テストランナーがこの差・検出先1件・参照名 `shown` を固定する。両方とも未判定であり、エスケープ欠落を検出できるようになったとは言わない。

実アプリでは name-change の `badge`（`index.html:743` 付近）はプロパティ条件とネストした三項演算子、kakure-number の `shown` はコールバック入力と `esc(String(value))` を含む。どちらも今回の作業で解決していない。

## 相関反例の隔離実行

次のコマンドで固定文字列だけを Node の新規 VM コンテキストに渡した。HTML は文字列として比較するだけで、DOM・ブラウザ・ネットワーク・外部値・本番 Firebase は使わない。

```sh
node <<'NODE'
const assert = require('node:assert/strict');
const vm = require('node:vm');
const inputs = ['', 'x', '<img src=x onerror=alert(1)>'];
const rows = inputs.map(input => {
  const evaluate = expression => vm.runInNewContext('const raw = input; const flag = raw; ' + expression, {input});
  const suppressed = evaluate("flag ? '' : raw");
  const retained = evaluate("flag ? raw : ''");
  assert.equal(suppressed, '');
  assert.equal(retained, input);
  return {input, suppressed, retained};
});
console.log(JSON.stringify(rows, null, 2));
NODE
```

実測結果: 3入力すべてで `suppressed === ''`、`retained === input`、assert 6件通過。HTML 風文字列のスクリプト実行可能性を検証したものではない。

## 検証と残余

- `python3 scripts/tests/test-sec1-dataflow.py`: 114 fixtures、入力欠落時の失敗、shell 連携9件が PASS。
- 現行71ファイル: 裸参照44件、ERROR 0、未判定44件。検査器無変更のため分類は変わらない。
- `bash scripts/lint.sh`: 着手前後とも16項目 PASS。`git diff --check`: PASS。
- A-11 は未完了。新しい安全分類・無視リスト・オーナー判断を追加しない。
- 実装担当とは別コンテキストの同系統サブエージェントがテスト・報告・バックログ・索引を独立レビューし、修正要求なし。既存96件の一致、114件とshell9件、固定3入力の6assert、検査器・アプリ無変更を再確認した。別系統モデルとの二重レビューではない。
- この工程のテスト・記録は未コミット・未公開。

次の設計には、単純な状態の合流ではなく、条件の具体値／真偽、入力由来の同一性、枝の到達可能性をどこまで限定して保持するかの検討が必要。呼び出し・プロパティ・ネスト・コールバックまで一度に一般化しない。今回のテストはその検討時の反例と未対応の対照になる。

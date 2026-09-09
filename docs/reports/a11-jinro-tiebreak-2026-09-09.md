# A-11 人狼・同票候補名の限定隔離検証

2026-09-09。基準HEAD `986030bb44a22d3dd3cade3e50aa555a38991a2f`。対象は `showTieBreak(candidates)` の裸参照 `names`（1970行）と、その画面の直接onclick配線に限定する。

## 方法・結果

実 `showTieBreak` と共有 `RoomkRTDB.esc` を一意anchor／固定SHAで抽出し、最小documentオブジェクトを与えてNode VMで実行した。正常・境界10群＋変異3群、計13群が通過し、再実行stdoutと保存JSONが一致した。

- 通常名、単一引用符、引用符・`&<>`、HTML文字列、既存entity、複数候補の先頭／中間／末尾、空配列の生成結果を確認。全要素のescapeと元の順序を、独立したoracleで段落の正確なテキスト文脈と比較。
- panel表示、固定label.textContent、label欠損分岐、再描画後のHTML／現在onclickの置換を確認。
- 描画だけでは操作stubを呼ばず、onclickを直接呼ぶと決選stubへ元候補配列を同一参照・元文字列のまま渡す。skip stubは引数なしで各1回。
- 全escape除去、中間要素だけescape欠落、決選へescape済み別配列を渡す変異をメモリ上で作り、同じoracleのAssertionErrorで検出。

## 証拠

```sh
node docs/reports/evidence/a11-jinro-tiebreak-2026-09-09.mjs
```

- [ハーネス](evidence/a11-jinro-tiebreak-2026-09-09.mjs)
- [保存JSON](evidence/a11-jinro-tiebreak-2026-09-09.json)

app SHA256: `0c4b0515a94f86e20c5a3a6be645c3900deff1c2fbf64fed4d98af6ec93dd1c5`。shared SHA256: `77d414a84d39deb52e1c8544e26465d4b822041621dbd985cad804e36d3b1d12`。

## 限界

document stubはHTMLをparseせず、IDのオブジェクトを遅延生成する。実DOMのボタン生成・ブラウザイベント・スクリプト非実行・古いDOMリスナーの除去は保証しない。startRunoff／skipExecutionはcall記録stubであり、実投票集計・DB・認可は未検証。候補配列はコピーでなく参照保持のため、呼出側の遅延配列変更への耐性とは呼ばない。空候補／攻撃文字列は描画fixtureで、上流の受入仕様を保証しない。

アプリ・検査器・共有JS・rulesは無変更。ネットワーク・ブラウザ・SDK・本番アクセスなし。未判定44参照をsafeに再分類しない。

## 最終確認・記録状態

作成担当とは別コンテキストのレビュアーが実ソースと3成果物を照合し、13群の再実行と保存JSON一致を確認して承認した。異なるモデル系列による二重レビューではない。主担当も同じ保存結果との一致を再確認した。検証範囲で追加修正を要する不具合は確認していない。

既存検査器114件・shell連携9件、lint・diff checkは通過。現行71ファイルの未判定44・エラー0、A-11未完了と判断保留6件を維持する。本工程は文書・証拠の保存までで、コミット・push・PR・デプロイは未実施。

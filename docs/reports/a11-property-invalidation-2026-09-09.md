# A-11 別名経由property書込みによる古い根拠の失効

2026-09-09、基準HEAD `2d2ae23dca158d2cff61235c268b91b0ea9dcff6`。検査器の1関心事を修正し、アプリ・共有・rules・CIは変更しない。

## 具体的不具合

```js
const obj = {};
const alias = obj;
obj.name = 'ok';
alias.name = location.hash;
el.innerHTML = `
${obj.name}`;
```

旧検査器はsafeと分類するが、実JavaScriptでは同じobjectなので外部入力が出力される。alias宣言時に根拠を消すだけでは、その後に再取得したobj.nameの根拠がalias.name書込みで残る。逆にobj.nameへrawを入れた後alias.nameへ固定値を書いた場合は旧raw／ERRORが残り、実値はfixedとなる。Node VMで固定HTML風文字列を使った両順序の値を確認した（DOM・ネットワークなし）。

## 最小修正

認識するドットproperty代入／`+=`で、全ての既存ドットproperty根拠を失効する。root名が異なっても同じobjectの可能性があるためであり、aliasを追跡して安全と認定する拡張ではない。配列根拠も従来どおり失効する。

RHSと`+=`のpriorは失効前に評価し、今回直接書いたtargetだけを登録する。変更前にコピーしたscalar値は保持する。computed書込は既存の全根拠失効を維持。独立objectの他propertyでも保守的にunknownへ落ちる。

## 回帰結果

旧114fixturesを内容・期待値とも完全保持し12件追加、計126件とshell統合9件が通過。追加内容は事前aliasの再取得safe／HTML／raw失効、`+=`、nested、同root別property、別root、直接raw登録、scalarコピー保持、computed書込、配列根拠失効。旧版との比較でsafe／htmlやrawが誤って残った例はunknownへ変わり、直接rawとscalarコピーの期待は維持した。

```sh
python3 scripts/tests/test-sec1-dataflow.py
python3 scripts/sec1-dataflow.py --json
bash scripts/lint.sh
```

現行71ファイルはERROR 0、裸参照44・unknown44で不変。今回改善したのは検査器の誤った根拠保持であり、44件をsafeへ動かすことではない。A-11は未完了。

## 限界と次工程

getter／setter・Proxy・任意呼出し・動的alias等を新規解析しない。直接propertyへ付ける分類も従来の限定データフロー契約内であり、任意JavaScriptの安全証明ではない。従来unknownだった条件式・map/join・関数間・HTML文脈を解決したとは扱わない。追加された依存はない。本番・ブラウザ・SDK操作なし。独立レビューと公開工程は主担当が別途集約する。

## 独立レビュー・統合

作成担当とは別コンテキストのレビュアーが126件とshell連携9件を再実行し、旧114件の内容・期待値の保持、失効順・直接target登録・コピー済みscalar保持を確認して承認した。独自のメモリ内対照でもRHSのpropertyコピーや+=の旧値評価を確認した。主担当も回帰テストを再実行し一致。lint・diff check通過。異なるモデル系列による二重レビューではない。

オーナーが承認済み範囲のコミット・PR・マージ・公開確認まで一括承認したため、本修正をリリース工程へ進める。公開状況は対応PRとGit履歴で確認する。保留6件の判断やA-11の完了条件は変更しない。

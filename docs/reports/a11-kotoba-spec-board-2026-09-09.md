# A-11 ことば探偵・観戦盤面の限定隔離検証

2026-09-09。基準HEAD `c8392c7f34ae28fa105222edca080b9752e18536`。アプリ・検査器・共有JS・rulesの変更なし。未判定44参照をsafeへ再分類しない。

## 対象と方法

`apps/kotoba-tantei/app.js` の `renderSpecFinish` が生成する `boardHtml`（1642行）、関連する `toSpecCard`、`specCardHtml`、`renderSpecGame`、`handleSpectatorSnapshot` を一意anchorで実抽出。共有 `escapeHtml` と `cardRoleLabel` も実関数を使用し、ソースSHAを固定、抽出SHAも保存した。

Node VMと固定オブジェクトによる文字列生成検証。header・turn banner・scoreboard・hint・resultSummaryはスタブ。実dispatchにはexists=true／期限内の固定条件を与える。集計を含む画面全体の秘匿ではなく、盤面断片と射影オブジェクトの境界を確認する。

## 結果

37群通過（正常・境界30群、変異7群）。

- `revealed === true` のみ公開。false・数値・文字列・null・欠損等では射影オブジェクトにroleのown propertyがない。同じ単語で未公開roleだけを変えても盤面断片は一致。
- 未確定finishedはゲーム盤面、確定finishedは全公開。確定finishedから未確定finished／新ゲームへ描き直すと旧秘密情報は盤面に残らない。
- 単語テキストと公開roleの引用符付きclass属性を個別・同時に確認。引用符だけの属性攻撃値、空配列、未知phaseも含む。
- game／finishのword／role escape欠落4件、未公開role除去欠落、厳密revealed判定欠落、pending-write gate欠落の計7変異をメモリ内だけで作成し、同じassertionで検出。

role除去欠落変異はオブジェクト契約で検出する。rendererにもrevealed=falseの防御があるため、この変異単独でHTMLへ漏れるとは主張しない。

## 証拠と再実行

```sh
node docs/reports/evidence/a11-kotoba-spec-board-2026-09-09.mjs
```

- [自己完結ハーネス](evidence/a11-kotoba-spec-board-2026-09-09.mjs)
- [保存JSON](evidence/a11-kotoba-spec-board-2026-09-09.json)

app SHA256: `b96fc56f8c3836b06a9ca6be6c58db65d812f9e870f9e45102b3f6924c0fcae9`。shared SHA256: `533e791fd06c37839989a1461bb0322d11c94fc1d1ef853a03c68fb12c25c370`。

## 限界

HTML parser・DOMイベント・スクリプト実行、実metadata通知、失効／削除／購読停止、session分離、全観戦経路のwrite-zeroは検証していない。winner等の盤面外sink、ゲームUIも対象外。HTMLescapeは引用符脱出を防ぐが、roleの空白によるclass token追加やCSS意味の妥当性は保証しない。型異常全般の受入保証もない。ネットワーク・Firebase SDK・本番アクセスなし。

## レビューと記録状態

作成担当とは別コンテキストのレビュアーが実ソース・証拠・報告を照合し、37群の再実行と保存JSON一致を確認して承認した。異なるモデル系列による二重レビューではない。主担当も再実行結果の一致を確認。検証範囲で修正を要する不具合は確認していない。

既存検査器114件・shell連携9件、lint・diff checkは通過。現行71ファイルの未判定44・エラー0、A-11未完了と判断保留6件を維持する。本工程は文書・証拠の保存までで、コミット・push・PR・デプロイは未実施。

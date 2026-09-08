# A-11 ロビー人数表示の隔離検証（2026-09-08）

対象は `apps/kotoba-tantei/app.js:300` の `${players.length}`。基準コミットは `09086e20c5d8090085829a2e2a2d233c1e9ffd06`。未判定44箇所のうち、この1箇所について外部データから表示までの到達条件を確認した。アプリ・スキャナーは変更せず、未判定数44は維持する。

## 結果と実際の経路

**今回のJSON形入力では人数欄へのHTML混入は再現しなかった。** 通常配列の `length` は数値であり、`length` に無害なHTML文字列を持つオブジェクトは表示より前の `players?.find()` で TypeError になる。これは安全な入力検証ではなく例外による描画停止である。アプリ全体の安全性、壊れたデータへの堅牢性を承認する結果ではない。

- `service.js:741` の `subscribeToRoom()` は `snapshot.data()` をそのまま渡し、players の型を正規化しない。
- `app.js:440` の購読コールバックは `state.room` を設定して `clearInvalidPendingCard()` を呼ぶ。通常の `pendingCardIndex === null` ならこの関数は直ちに戻る。ルームあり・失効なし・ロビー経路では `renderLobby()` に進む。これらの購読経路は静的確認のみで、SDK経由の実測ではない。
- `renderLobby()` は :275 の `players?.find()`、:277 の `canStart()` → `getStartConditions()` の `filter/some`、:279 の `players.map()` を通過してから `innerHTML` を代入する。
- JSONオブジェクトに仮の `find/map/filter` 関数を足して人数欄へ無理に到達させるテストはしていない。

## 固定入力による再実行可能な証拠

[検証器](evidence/a11-lobby-length-2026-09-08.mjs)と[結果JSON](evidence/a11-lobby-length-2026-09-08.json)を保存した。検証器は基準コミットの3ファイルと作業ファイルの完全一致・SHA-256、関数ヘッダーと抽出境界を確認する。実際の `renderLobby` と描画ヘルパー、service の `getStartConditions`、共有 `escapeHtml` をそのまま使用する。購読とセッション・画面遷移の境界のみスタブ化し、全ルーム入力を JSON round trip に通す。

```sh
node docs/reports/evidence/a11-lobby-length-2026-09-08.mjs
# 将来ソースが変わった後の当時の再現:
node docs/reports/evidence/a11-lobby-length-2026-09-08.mjs --baseline
```

15ケースすべて期待どおり。通常ホスト・通常ゲスト・ホスト1人・空配列・players欠落・null・HTMLを含む名前の配列の7ケースはHTML代入1回、人数4/4/1/0/0/0/1。4人の開始条件とホスト/ゲストの開始ボタン制御、名前のエスケープも確認した。

HTML長さ・文字列長さ・数値長さのオブジェクト、文字列、数値7、数値0、false、nullを含む配列の8ケースは TypeError となり **HTML代入0回、代入先はテスト前の値のまま**。最初の7件は `.find is not a function`、null配列要素は `id` の読み取り例外だった。

## 限界・扱い

DOMはプロパティ捕捉スタブであり、ブラウザ解析・SDK・本番Firebase・保存セッション・iPhone操作・ネットワーク通信は行っていない。購読コールバック全体、過去画面からの復旧、任意の破損データ、書込権限や攻撃可否は未検証。例外による停止をHTMLエスケープや型検証の成功と呼ばない。

この人数表示をXSS確定として修正・新規承認起票する根拠は得られなかった。型異常で止まる挙動は本報告へ観察として残し、全体のスキーマ耐性対策へ無断で広げない。既存保留項目は変更しない。本工程は証拠・報告の追加までで、コミット・push・PR・デプロイは行っていない。

## 検証・独立レビュー

生成者とは別コンテキストの同系統エージェントが、実コードと到達順序、15ケース、通常実行・`--baseline`・保存JSONの完全一致、報告・README・バックログを確認して承認した。主担当もJSON一致と対象外差分なしを確認。lint全16項目・diff check、既存検査器43fixtures・入力欠落・shell統合8ケースはPASS。検査器の現行44項目は修正前棚卸し48項目からP-16の点数4補間だけを除いたものであり、今回の証拠追加では減らしていない。

検証器の通常実行と `--baseline` 実行はともに保存JSONと完全一致。`git diff --check` と `bash scripts/lint.sh` は通過（全16項目、A-11の未判定44件のINFOは不変）。apps・scripts・rules・firebase.json・.github の差分はない。

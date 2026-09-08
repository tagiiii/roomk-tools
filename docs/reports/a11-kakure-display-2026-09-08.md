# A-11: かくれナンバーの数字・予想表示の隔離検証（2026-09-08）

## 対象と結論

基準コミット `e7d04d3c049186267b803cad55c60d83edafab01` の実関数を抽出して、合成JSON入力による当初21ケースにホスト提出状況10ケースを追加した（計31件）。当初21件の結果オブジェクトと欠落対照5件はそのまま保持した。数字・予想・名前のHTMLや引用符はエスケープされた文字列として捕捉された。エスケープを1箇所だけ除去した対照はホスト名表示1件を加えて計6件、正常系と同じ検査で拒否した。対象ケースで追加修正の必要は確認しなかったが、実ブラウザでのHTML解析・スクリプト実行・実DBでの到達性は検証していない。

A-11の裸参照 `stateHtml`（1227）、`shown`（1270）、`cls`（1323）、`meTag`・`leftTag`（1325）、`guessHtml`（1326）、`badge`（1327）の7箇所に関する表示経路を観察した。分類器の安全認定ではない。アプリ・検査器・共有ファイル・rules・CIは無変更。現行アプリ群全体の未判定44箇所、かくれナンバー単体の未判定7箇所、A-11未完了、判断保留7件は維持する。

## 証拠と再実行

- [再実行スクリプト](evidence/a11-kakure-display-2026-09-08.mjs)
- [固定JSON](evidence/a11-kakure-display-2026-09-08.json)

```sh
node docs/reports/evidence/a11-kakure-display-2026-09-08.mjs
node docs/reports/evidence/a11-kakure-display-2026-09-08.mjs --baseline
```

通常モードは現在ファイル、`--baseline`は固定コミットのソースを読む。双方でファイル全体SHA-256と固定ソースの一致を必須とし、変更時は失敗する。関数宣言行の一意性、固定行番号、同じインデントの閉じ括弧で全文を抽出し、抽出コードのSHA-256もJSONに記録する。抽出した関数がVM内で構文解析される。アプリを起動せず、ネットワークやSDKを読み込まない。

| ファイル | SHA-256 |
|---|---|
| `apps/kakure-number/index.html` | `62bd802b79e03bfbab08013b42a649d8f7cf968cd1702b0e9fb2c220e477155b` |
| `apps/shared/js/rtdb-utils.js` | `77d414a84d39deb52e1c8544e26465d4b822041621dbd985cad804e36d3b1d12` |

抽出したのは `renderNumberGrid`（1254–1273）、`handleReveal`（1276–1337）、その実依存 `renderScoreChips`（1340–1351）、共有 `esc`（45–52）、追加の`handleThinking`（1163–1251）の全文。`handleThinking`はホスト・同一ラウンド分岐だけを実行した。`renderScoreChips`のロジックを代替実装していない。`document.getElementById`は各ハーネスで許可した7要素だけを返し、`innerHTML`・`textContent`への全代入を捕捉する。既存ケースの`showScreen`は呼び出し名だけを記録する境界モックであり、本物の画面切替を実行していない。

## ケース

| 範囲 | 観察 |
|---|---|
| thinking 6件 | 自分の値はHTML文字列でも「？」。他人の数字・HTML値・HTML名前、隠しカードあり／なし、空一覧を確認。カード組立回数も確認 |
| reveal 基本・隠しカード4件 | 空room、HTML値、0、null。0は表示、null・欠落は非表示 |
| 予想・数字・退出6件 | 未提出は「よそうなし」、0は「0」、nullは「null」、HTML予想はescape済み。HTML数字・名前と、自分／退出タグを確認 |
| 加点バッジ4件 | delta 0はなし、2は固定「いちばん近い +2」、3は固定「ぴったり +3」。HTML文字列deltaはバッジなしで文字列自体もHTMLに出ない |
| textContent・累計1件 | round.number／totalのHTMLマーカーはtextContentにのみ到達。累計は実helperでhost・null player除外、文字列「2」→2pt、0→0ptを確認 |

すべてのrevealケースでゲスト／ホストの操作欄・待機欄を確認し、すでにrevealのときは`showScreen`を呼ばない分岐も含めた。HTML名前ケースの累計点にHTML文字列を与えると`Number(score) || 0`により0ptになることを観察した。ただし有限数の検証とは主張しない。並べ替えは検証・保証しない（実helperは`Object.entries`の列挙順）。

期待するエスケープ文字列はテスト側に固定リテラルとして置き、実`esc`の出力から生成しない。すべてのHTML代入から生マーカーが除外されることも検査する。textContentのマーカーはHTML挿入とは扱わず、別プロパティとして一致を検証する。

## 追加: ホスト提出状況10件

実`handleThinking`へrole=host、currentScreen=thinking、lastRoundNumber=round.number=1の合成入力を渡した。新ラウンドのリセット、入力欄の初期値、ゲスト分岐、画面切替は範囲外。誤ってリセット分岐に入ると、未許可DOMまたは`showScreen`／`hideError`のfail-fast境界で失敗する。

| ケース | 観察 |
|---|---|
| 提出済み／未提出／退出中 | 固定「きめた」「考え中…」「退出中」が対応して表示される |
| 退出済み・提出済み | doneがgoneより優先され「きめた」。提出件数には退出者も含まれる |
| HTML名前・秘密値 | 名前だけescape済みで表示。配布数字・予想値・隠しカード・合計に置いた名前とは別の秘密マーカーは、生文字列・escape済みのいずれもホスト出力へ到達しない |
| 空配布 | 0人/0人、締切不可、自動遷移境界の呼び出しなし |
| null予想 | undefinedではないため提出済みとして扱われる |
| 一部提出 | 残り1人を待たず進めるヒント、締切可能、自動遷移境界の呼び出しなし |
| 既存revealTriggered=true | 締切ボタン無効、重複した境界呼び出しなし |
| 同じcontextで2回描画 | 最初の描画でフラグが立ち、2回目も境界呼び出しは累計1回 |

`triggerReveal`は引数の同一性と呼び出し回数だけを確認し、解決済みPromiseを返すスタブ。実関数・DB書き込み・status遷移・得点計算は実行していない。全員提出の初回描画では`btn.disabled`を評価した後に`revealTriggered`がtrueになるため、その描画時点のdisabledはfalseとなる。2回目の描画または既存trueではdisabled=trueになる実装順序を検査しており、即時無効化は保証しない。エラー時のcatch経路は対象外。

実装のホスト側は`role === 'guest'`のelse側であり、今回のvalid host入力による検証を認証境界の検証とは扱わない。秘密値の非表示は同一ラウンドの対象値に限定し、人数や提出状況まで秘匿するとの主張ではない。

## 欠落対照6件

VMに渡すコード文字列だけを一時置換し、アプリは編集しない。各needleが1箇所だけ存在すること、逆置換で元全文に一致することを検査する。

1. thinkingの`shown`: 他人の値への`esc(String(value))`を除去。
2. revealの`guessHtml`: `esc(String(guess))`を除去。
3. revealの隠しカード: `esc(String(round.fieldNumber))`を除去。
4. revealの配布数字: `esc(String(numbers[name]))`を除去。
5. thinkingの名前: 名前補間の`esc(name)`を除去。
6. ホスト提出状況の名前: 実`handleThinking`の一意な`${esc(name)}`を`${name}`へ置換。

6件とも生マーカーが捕捉HTMLへ入り、対応する正常系と同じ検査の`raw marker reached HTML`で失敗することを確認した。これはテストの感度確認であり、現行アプリの脆弱性6件を意味しない。

## 入力元の静的確認と限界

`startRoomListener`の`on('value')`（1100）で`snapshot.val()`を取得し、status revealから`handleReveal(room)`へ渡す（1135）。`handleThinking`のゲスト分岐から`renderNumberGrid(numbers, round.fieldNumber != null)`を呼ぶ（1192）。購読とこのゲスト呼出分岐は静的確認だけで実行していない（ホスト・同一ラウンド分岐のみ追加実行）。したがって本検証のグリッド関数自体がホストを拒否するとは主張しない。

`submitGuess`（999）は入力をNumber化し、空欄・整数・範囲チェック後に数値を保存する。この通常UI経路は読み取り値の型検証やDB認可を意味しない。HTML文字列ケースはrenderer境界で合成したもので、本番から同じ値を書けるとの証拠ではない。

入力は合成JSONレコードとスカラー値に限定。関数を持つオブジェクト・Proxyなどは対象外。実DOM、ブラウザの解析、レイアウト、イベント操作、得点計算、再接続、実SDK、本番Firebase、iPhone、実利用者データ、通信は一切扱わない。自分の値のUI非表示はアクセス制御ではない。報告時点では証拠・文書のみ未コミット・未公開。

## 最終検証・独立レビュー

主担当がcurrent／baseline／保存JSONのバイト単位一致を再確認。既存114fixtures・shell連携9件、lint全16項目、diff checkも通過した。作成担当とは別コンテキストの同系統サブエージェントが実関数・固定ソース・期待値・欠落対照・報告／索引／バックログを読み取り専用で独立レビューし、21ケースと対照5件、JSON一致を再現して承認した。別系統モデルとの二重レビューではない。

上記は当初21ケース時点の記録。ホスト10件・対照1件の追加についても、主担当と独立レビュアーがcurrent／baseline／保存JSON一致と当初21件・対照5件の不変を再確認した。合計31件・対照6件、7参照の観察範囲、同一ラウンドの制限、記録のみのtriggerReveal、報告／索引／バックログの整合を再レビューし、追加修正要求なしで承認した。

# A-11 手動コードレビュー：通信系5アプリ・19参照

2026-09-09、基準 `7625ba6`。オーナー承認の44箇所全件手動レビューのうち、do-mannaka 6／jinro 4／kakure-number 7／name-change 1／tatoe-gp 1を担当した。ルート・各固有AGENTS・役割規約を読み、現行 `python3 scripts/sec1-dataflow.py --json` で71ファイル・errors 0・unknown 44を再取得した。

## 結論と判定範囲

19参照すべてについて、現行コードの生成元・変換・再代入・補間位置を確認し、**当該参照からHTML構文へ未エスケープの外部文字列が入る経路は確認されなかった**。下表の「確認済」は、この限定的なコードレビュー結果であり、検査器の `safe` への再分類ではない。scannerは44 unknownのまま変更しない。全アプリのXSS・認可・秘密情報保護・不正データ耐性の包括保証ではなく、19参照以外の補間やDBルールは対象外。

RTDBから取得するJSON由来の通常の値と現行組み込み関数を前提に追跡した。任意のJavaScriptオブジェクト／getter／Proxyの注入や、グローバル関数の改変まで安全とするものではない。nullのplayer等で描画前に例外になるケースを正常動作確認済みとは扱わない。有限数・ゲーム上正しい値の検証と、HTML注入を防ぐ検証は区別する。

## 全19参照の追跡表

行番号は基準時点の各 `apps/{app}/index.html`。文字列がHTML断片のときは、断片を挿入する外側もHTML本文であること、途中に外部由来の属性・タグ開始断片がないことを確認した。

| # | app / 行 / reference | 元入力→変換・再代入 | sink文脈・根拠 | 限定判定 |
|---|---|---|---|---|
| 1 | do-mannaka:1506 `cls` | `result-item`初期化、isMe／中央値／端値の判定で固定classだけを `+=` | 二重引用符のclass属性。付加値は `is-me`／`is-median`／`is-out` に限定。外部の名前・回答自体を連結しない | 固定属性値・確認済 |
| 2 | do-mannaka:1507 `answer` | playersのanswer→回答一覧生成時 `Number(p.answer)`→sort→forEach引数。以後再代入なし | div本文。Numberの文字列表現になりHTML文字列を保持しない。NaN／Infinityの表示や得点妥当性は別問題 | 数値化・確認済 |
| 3 | do-mannaka:1508 `meTag` | 名前とstate.nicknameの一致で固定spanか空文字 | `escapeHtml(name)`直後のdiv本文。名前は別途escape済、タグ自体は定数 | 固定HTML・確認済 |
| 4 | do-mannaka:1509 `badge` | 中央値／端値の判定→固定2種spanまたは空文字 | div内のHTML断片。外部回答は分岐にのみ使い、断片に埋めない | 固定HTML・確認済 |
| 5 | do-mannaka:1510 `deltaCls` | 中央値／端値→固定 `delta-plus/minus/zero` | 二重引用符class属性、直前も固定class | 固定属性値・確認済 |
| 6 | do-mannaka:1510 `deltaVal` | 判定→固定 `+50pt`／`-10pt`／`±0pt` | span本文。DBのscoreや入力値ではない | 固定テキスト・確認済 |
| 7 | jinro:1487 `wolfList` | `setupRoleExtraInfo` がplayersの人狼名キーを配列化→state.wolfPartners。夜初日で全要素 `map(esc).join('、')`＋固定接頭辞、または固定代替文 | p本文。元名前はHTML/JS属性に入れずescape後に連結。描画まで追加のデコードなし | escape済テキスト・確認済 |
| 8 | jinro:1511 `resultHtml` | room.nightResult.mediumResultは真偽／`wolf`一致判定のみ。room.lastExecutedは `esc(... || '?')`。verdictは固定2択 | actionDone時のp本文。内部strongのタグ/属性は固定、外部名だけescape。const宣言後再代入なし | 固定HTML＋escape・確認済 |
| 9 | jinro:1516 `resultHtml` | #8と同一const、未actionDone分岐 | 別のp本文に同じ断片。続くinline handlerは静的 `markMediumDone()` で外部名を引数文字列にしない | 固定HTML＋escape・確認済 |
| 10 | jinro:1970 `names` | `computeExecution`の候補／同票名配列→showTieBreakで全要素 `map(esc).join('・')` | p本文。onclickは後からproperty関数で元配列を渡すのでHTMLに候補をJS式として埋めない。既存実関数抽出13群も再実行 | escape済テキスト・確認済 |
| 11 | kakure-number:1227 `stateHtml` | round.numbersの配布名を列挙。guessesの提出有無／players在籍判定から固定3種span | 提出状況div内のHTML断片。隣接名前も `esc(name)`。入力されたguess値を断片に入れない | 固定HTML・確認済 |
| 12 | kakure-number:1270 `shown` | round.numbers各値→自分なら固定「？」、他者なら `esc(String(value))` | 数字カードdiv本文。型を数値だと仮定して裸出力せずString後escape。自身の値はこの経路では出力しない | 固定値／escape・確認済 |
| 13 | kakure-number:1323 `cls` | 固定 `kkn-reveal-row`へ本人／closest判定で固定class追記 | 二重引用符class属性。scoreDeltas値は比較にのみ使用しclassに埋めない | 固定属性値・確認済 |
| 14 | kakure-number:1325 `meTag` | 名前一致→固定spanか空文字 | 名前をescした後のdiv本文 | 固定HTML・確認済 |
| 15 | kakure-number:1325 `leftTag` | players存在有無→固定退出spanか空文字 | #14直後の同じdiv本文。退出者名をspan文字列へ再連結しない | 固定HTML・確認済 |
| 16 | kakure-number:1326 `guessHtml` | round.guessesの値→未定義なら固定文、他は `esc(String(guess))` を固定strongで囲む | div本文。String化した値をescapeし、復号・raw再代入なし | 固定HTML＋escape・確認済 |
| 17 | kakure-number:1327 `badge` | scoreDeltasの比較→固定exact／closest spanか空文字 | HTML本文。外部deltaの値そのものを埋めない | 固定HTML・確認済 |
| 18 | name-change:912 `badge` | nonGMEntriesのp.readyとp.gameRole一致判定→固定changer／voter／pending span | player-name span終了後のHTML本文。nick・initialはそれぞれesc済。異常gameRole文字列も値自体は出力しない | 固定HTML・確認済 |
| 19 | tatoe-gp:1843 `votes` | playersの回答名から `calcRoundOutcome` がObject.fromEntriesでown-keyを0初期化→各票の対象がown-keyなら `+= 1`→結果配列へコピー。DBの票数フィールドは使わない | div本文。集計結果は整数、sortも値を変えない。文字列answer／nameは別々にescape。無効投票のゲーム上の意味は本件外 | 再計算数値・確認済 |

## 補助実装と証拠の再利用

- do-mannaka／tatoe-gpは冒頭のES moduleで `utils.js` の `escapeHtml` をimportし `window.escapeHtml` へ公開する。共有実装168行はString化の後、`& < > " '`を置換する。対象関数内にこの名前を置き換える再代入はない。
- jinro／kakure-number／name-changeの `esc` は `RoomkRTDB.esc` のalias。共有実装45行も同じ5文字を置換する。対象19参照の生成後にHTML entityを復号する処理はない。
- [人狼同票表示の既存報告](a11-jinro-tiebreak-2026-09-09.md)の[evidence](evidence/a11-jinro-tiebreak-2026-09-09.mjs)は、現アプリ・共有JSのSHA固定assertを含む。今回再実行し正常・境界10＋変異3＝13群PASS、stdout JSONと保存JSONのdeepEqualも確認した。これは #10 の文字列組立てとonclick property配線の補助証拠であり、実DOM解析・実投票・認可・DBはスタブ対象外。
- #1〜9・#11〜19は今回は直接コードレビューであり、新たなブラウザ・SDK試験を実施したとは記録しない。現時点で対象参照の危険な生成経路を特定できず、アプリ修正は行っていない。

## 照合用SHA256

| ファイル | SHA256 |
|---|---|
| apps/do-mannaka/index.html | `0e0a8e517b29fda2efdbdc72b4f5f935da124d8d7c340547e547e7de75f5ac66` |
| apps/jinro/index.html | `0c4b0515a94f86e20c5a3a6be645c3900deff1c2fbf64fed4d98af6ec93dd1c5` |
| apps/kakure-number/index.html | `62bd802b79e03bfbab08013b42a649d8f7cf968cd1702b0e9fb2c220e477155b` |
| apps/name-change/index.html | `5bddcfd7c1f527298dedb768a3076c6b20f3349ad410cf78eb2739eb52524cb9` |
| apps/tatoe-gp/index.html | `b06dcc8fdaab134db1172e5025af763f07fa2fd35036cfc500dfda6ba73f386a` |
| apps/shared/js/utils.js | `533e791fd06c37839989a1461bb0322d11c94fc1d1ef853a03c68fb12c25c370` |
| apps/shared/js/rtdb-utils.js | `77d414a84d39deb52e1c8544e26465d4b822041621dbd985cad804e36d3b1d12` |

変更はこの報告書のみ。ネット接続・実Firebase・ブラウザ・iPhone操作・コミットなし。残り25参照の統合判定やA-11全体の完了判断は主担当の別工程とする。

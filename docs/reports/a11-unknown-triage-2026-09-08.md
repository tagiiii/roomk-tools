# A-11 未判定参照の棚卸し

2026-09-08。基準HEAD `8714c57927a01e50d5b1130d865ad796484b9ada`。A-11の検査結果から始める静的な調査であり、検査器やアプリの修正ではない。

## 機械結果と調査の区別

`python3 scripts/sec1-dataflow.py --json` は71ファイルを走査し、13アプリの裸参照48箇所を全てunknownとした。ERROR 0を安全保証としない。[固定スナップショット](evidence/a11-unknown-inventory-2026-09-08.json)に全file・line・referenceを保存した。今後行番号が変わる場合は基準HEADのコードと照合する。

本棚卸しは、入力元・型変換・HTML組立・埋め込み文脈を区別して後続テストを選ぶための資料。手作業の分類はscannerのsafe判定ではなく、全XSS経路や実際の攻撃権限の検証でもない。

## HTML内JavaScriptの24箇所

表のパスは `apps/{アプリ}/index.html`。型変換の観察も、その経路全体を検査器が保証したという意味ではない。

| アプリ:行 | 参照 | 入力元・出力文脈／検査拡張時に必要な対例 |
|---|---|---|
| do-mannaka:1506 | cls | 固定classの条件付き+=→属性。固定追加/外部値追加を区別 |
| do-mannaka:1507 | answer | RTDB回答をNumberしてmap/callback分割代入→本文。数値変換/未変換の対 |
| do-mannaka:1508 | meTag | 固定span/空の三項式→名前の後。固定/外部値入り断片と先行補間の対 |
| do-mannaka:1509 | badge | 固定span/空の入れ子三項式→断片。一分岐だけrawの対 |
| do-mannaka:1510 | deltaCls | 固定3候補→class属性。固定/入力由来候補の対 |
| do-mannaka:1510 | deltaVal | 固定点数文字列3候補→本文。固定/直接入力の対 |
| do-mannaka:1526 | score | RTDB p.scoreを既定値0で補う→得点本文。外部値優先候補。型変換/生文字列の対 |
| do-mannaka:1558 | score | 同上、最終順位の別sink |
| jinro:1487 | wolfList | RTDB名前配列をmap(esc)/joinし文へ。全要素esc/一部raw、helper別名の対 |
| jinro:1511 | resultHtml | esc(room.lastExecuted)＋固定verdict又は固定文→p本文。分岐・名前だけ未escの対 |
| jinro:1516 | resultHtml | 同じ定義を別if分岐で表示。分岐を越えた根拠の対 |
| jinro:1970 | names | 候補名配列map(esc)/join→p本文。map esc/rawの対 |
| kakure-number:1227 | stateHtml | 提出/退出による固定span3候補→断片。入れ子分岐とraw入りの対 |
| kakure-number:1270 | shown | 固定？又はesc(String(round.numbers由来値))→本文。片側rawの対 |
| kakure-number:1323 | cls | 固定classへの条件付き追加→属性。再代入・外部値追加の対 |
| kakure-number:1325 | meTag | 本人一致による固定span/空→名前後。条件と先行補間の対 |
| kakure-number:1325 | leftTag | 退出判定による固定span/空→名前後。同上 |
| kakure-number:1326 | guessHtml | round.guesses由来値をesc(String(guess))でstrongへ又は固定文。条件HTML・esc欠落の対 |
| kakure-number:1327 | badge | 外部deltaの比較結果で固定span/空を選択。値自体のraw補間と区別 |
| kotoba-pair:1205 | note | ローカルpacksからpairInfoで取得しesc(info.note)をpへ。関数戻り・esc省略の対 |
| name-change:749 | badge | RTDB ready/gameRoleで固定span3候補→名前後。固定役割ラベルと入力値直接補間を区別 |
| tatoe-gp:1160 | score | RTDB player.scoreを既定値0で補う→本文。外部値優先候補。型変換/生文字列の対 |
| tatoe-gp:1843 | votes | voteCountsを0初期化し対象存在確認後+=1→本文。関数・動的キー集計、文字列初期値の対 |
| tatoe-gp:1877 | score | RTDB player.scoreを既定値0で補う→最終順位。外部値優先候補、別sinkの対 |

## 分割JavaScriptの24箇所

表のパスは `apps/` 配下。行番号・参照名は固定スナップショットと対応する。同じ行の複数参照も別箇所として数える。下記は根拠候補の整理であり全件unknownを維持する。

| ファイル:行 | 参照 | 入力元・出力文脈／検査拡張時に必要な対例 |
|---|---|---|
| kotoba-shuffle/app.js:70 | lv.icon | 固定LEVELSのcallback member→span本文。固定/外来member・再代入を区別 |
| kotoba-shuffle/app.js:71 | lv.label | 同上。先行補間後の文脈も未対応 |
| kotoba-shuffle/app.js:72 | lv.desc | 同上 |
| kotoba-shuffle/app.js:72 | count | importしたWORDSのfilter結果length→件数。配列長/任意object.lengthを区別 |
| kotoba-tantei/app.js:164 | wordOptions | 固定wordSetsをescしてoption属性・本文にmap/join。別名helper・属性と本文・esc欠落を区別 |
| kotoba-tantei/app.js:300 | players.length | Firestore購読由来room.players→人数本文。通常lobbyはArray.isArray guardなし。数値lengthと任意object.lengthを同一視しない |
| kotoba-tantei/app.js:306 | playerList | 外部players→renderLobbyPlayer→join。name/id等escと固定badge等を合成。関数間・属性と本文・esc欠落を検証 |
| kotoba-tantei/app.js:1544 | playerList | 観戦snapshot、配列guard後にname/team/roleをescしてulへ。guard・空配列・条件HTMLを検証 |
| kotoba-tantei/app.js:1642 | boardHtml | 観戦cards、配列guard後にrole class属性とword本文等をesc。class文脈を本文と分離 |
| kyoumi-sugoroku/app.js:222 | key | 固定THEMESのentries key→input value属性。固定keyと外来の引用符を含む値を区別 |
| kyoumi-sugoroku/app.js:224 | t.icon | 固定THEMES member→span本文。callback・先行補間が制限 |
| kyoumi-sugoroku/app.js:225 | t.label | 同上 |
| kyoumi-sugoroku/app.js:305 | pawns | 生成playersの配列indexから番号・classを組立てfilter/join。nameはこの断片に入らない。indexと外来文字列を区別 |
| quiz/app.js:355 | pack.icon | import固定pack・生成shuffle packのicon→本文。import/memberと再代入を区別 |
| quiz/app.js:356 | countLabel | pack.questions.length＋固定「問」→本文。配列長と任意lengthを区別 |
| quiz/app.js:358 | tag | 固定span/空文字の三項演算→escaped nameの後ろ。片側rawの分岐・先行補間後文脈を検証 |
| suki-type-check/app.js:272 | optionsHtml | 固定OPTIONS key/labelをlocal escし属性/本文へmap/join。helper同名偽装・属性文脈を検証 |
| suki-type-check/app.js:327 | iconsHtml | 数値集計から選ぶ固定候補のiconsをescしmap/join。関数戻り値・esc欠落を区別 |
| suki-type-check/app.js:331 | examplesHtml | 同固定候補examplesをescしli/section又は空。条件・nested mapを検証 |
| suki-type-check/app.js:332 | noteHtml | 同固定候補noteをescしsection又は空。条件・raw入力を区別 |
| suki-type-check/app.js:335 | barsHtml | 固定axis名と数値集計percentをescして本文・style widthへ。HTMLescapeでCSS値を保証しない。数値/文字列を区別 |
| suki-type-check/app.js:336 | secondHtml | 任意の第2候補の固定axis名をescしたp又は空。optional値・関数戻り値を検証 |
| talk-card/app.js:153 | topic | 固定topics→shuffle/splice/callback→直接本文。固定配列/外来item・先行補間を区別 |
| value-card/app.js:304 | cardsHtml | 固定cardDataとtextarea→memosのDOM入力。keyword/desc/memoはescapeHtmlして条件HTMLを+=合成。入力からescapeまでの追跡と欠落対例が必要 |

分割JavaScriptには、固定データ、Firestore由来データ、DOM自由入力を含む組立済みHTMLが混在する。名前にHTMLが含まれることは根拠にしない。suki-type-checkの分類機能・支援方針は評価・変更の対象にせず、ここでは既存データフローのみを記録する。

## 共通の未対応理由

検査器は関数・ブロック境界、未知の呼出し、副作用候補で根拠を破棄する。三項演算子、配列map/join、import先の固定データ、コールバック引数や数値変換の意味を十分に追わない。HTML文脈も先行補間や属性を保守的に未判定とする。このため、局所コードが固定文字列でも未判定になり得る。

ただし、固定値と外部値を同じように免除してはならない。例えば `p.score || 0` は文字列を数値に変換せず、`sort` 内の引き算も元の値の型を変更しない。数値のつもりのDB値も、実際の型変換・入力検証を確認するまでは別扱いとする。

## 後続作業の原則

最優先の外部値確認候補は、do-mannaka `index.html:1526,1558` とtatoe-gp `index.html:1160,1877` のscore表示4箇所。静的にはplayers由来の値を `|| 0` で補うだけで、表示前の数値変換・HTMLエスケープがない。通常の書き込みが数値を使うことと、読み取った値の型保証は同じではない。今回、ブラウザでの実行、本番rules、攻撃者の権限は未検証であり、4件の確定脆弱性という件数ではない。

1. 外部値が裸で到達する候補を優先し、隔離した固定入力で型とHTML組立の境界を検証する。本番DBの書き込み権限や悪用可能性を今回断定しない。
2. 検査の拡張は、固定値だけの分岐など狭い構文を一つずつ扱い、片側が外部値・再代入・同名変数・属性やJS文脈の場合の負例を対にする。
3. map/joinの組立済みHTML、import先、コールバックや複数の補間をまとめて安全にしない。依存追加・全面的なパーサ導入も今回決定しない。

アプリ・検査器・rules・shared・CI・保留7件は変更しない。A-11は未完了のまま。本工程では本番Firebase・ブラウザ・iPhoneを操作せず、コミット・push・公開も行わない。

## 検証と独立レビュー

主担当が43fixtures・入力欠落・shell統合8ケースを再実行してPASS、lint全16項目とdiff checkも通過した。両表48行のfile/line/referenceと固定JSON全48項目の一致、表が3列であることを機械確認した。

調査担当とは別コンテキストの同系統エージェントが、固定JSONと現検査器出力の完全一致、表48行との一致、優先score4箇所や数値変換・escape・組立済みHTMLなどの実コードサンプルを確認して承認した。表内の縦棒による列崩れを修正済み。レビューは全48箇所の全到達経路・実DB権限・ブラウザ攻撃の実測完了を意味しない。今回の将来fixture候補は未追加・未実行で、既存43fixturesのPASSと混同しない。

# A-11 手動レビュー B：4アプリ・14参照（2026-09-09）

基準コミット: `7625ba6ab1d77042bb52721bdd430fea92083fe7`。ユーザー承認の「検査器の高度化を区切り、未判定44参照を直接レビューし、必要な隔離検証を行う」工程の担当分。`python3 scripts/sec1-dataflow.py --json` の現行出力（71ファイル・ERROR 0・unknown 44）から、kotoba-pair 1、kotoba-shuffle 4、kotoba-tantei 5、kyoumi-sugoroku 4を抽出した。

**14参照を全件追跡し、今回の表示境界では未エスケープの外部文字列がHTMLへ混入する経路を確認しなかった。** 定数文字列6、配列由来の数値／数値だけを含む固定断片3、内容をエスケープしたHTML断片5。これは現行ソースと明示したデータ経路の限定判定であり、検査器のsafeへの再分類、全アプリの安全保証、A-11全体の完了宣言ではない。検査器のunknown 44は変更していない。

## 1参照1行の直接追跡

行番号は基準ソース。各ローカル変数は描画呼出しごとに作成され、定義後から対象sinkまでの再代入はない。`esc`は名前ではなく実装を確認した。kotoba-pairは`RoomkRTDB.esc`、kotoba-tanteiは共有`escapeHtml`の別名で、いずれもString変換後に`& < > " '`を置換する。

| ソース・行 | 参照 | 入力元 → 変換・全分岐 | 出力文脈・escape | 限定判定・根拠 |
| --- | --- | --- | --- | --- |
| `apps/kotoba-pair/index.html:1205` | `note` | :625 `pairInfo`がDB由来のpackId/pairIdでローカル`packs.js`を選択。:1202でnoteありなら固定p要素＋`esc(info.note)`、なしなら空文字。選択不足／card欠落では先に空表示、matched以外は別の固定バナー。 | div内のHTML断片。note本文はテキスト用escape。 | escaped断片。DB識別子そのものはこの断片へ出力しない。選択先がなくても空。根拠: :614–631、:1193–1227、共有実esc。 |
| `apps/kotoba-shuffle/app.js:70` | `lv.icon` | :5–10のローカルLEVELS 4件→:61 forEach。`looks_3/4/5/6`固定。全ファイルでフィールド書換え・外部データによる置換なし。 | icon spanのテキスト。escapeなし。 | 固定文字列。constだからではなく全4値と書込経路を確認。選択変更はstate.levelIdだけ。 |
| `apps/kotoba-shuffle/app.js:71` | `lv.label` | 同じLEVELS全4件の「かんたん／ふつう／むずかしい／ちょうせん」。 | label spanのテキスト。escapeなし。 | 固定文字列。LEVELS.findは読取りであり表示ラベルを上書きしない。 |
| `apps/kotoba-shuffle/app.js:72` | `lv.desc` | 同じLEVELS全4件の「3もじ／4もじ／5もじ／6もじ」。 | desc spanのテキスト。escapeなし。 | 固定文字列。WORDSのhint/wordやフォーム値を代入する経路なし。 |
| `apps/kotoba-shuffle/app.js:72` | `count` | :62ローカル静的WORDS配列をnative filter→返却配列のlength。条件は各lv.charsとの一致。0件を含め数値。 | desc spanのテキスト。escapeなし。 | 配列から算出した数値。任意オブジェクトのlengthではない。WORDSはwords.jsの配列リテラル、appの使用箇所はfilter等の読取り。 |
| `apps/kotoba-tantei/app.js:164` | `wordOptions` | :28でwords.jsのwordSetsをimport→:150 mapで全setのidとlabelを個別esc→join。0件は空。setが変わっても両フィールドをescapeする経路。 | select内のoption列。idは引用符付きvalue属性、labelはテキスト。 | escaped断片。ローカル静的データ由来だがデータが無害という前提だけには依存しない。wordSetsへの再代入／各フィールド書換えなし。 |
| `apps/kotoba-tantei/app.js:300` | `players.length` | service:741のsnapshot.data→app:440 state.room→:275 find→:276 playersまたは[]→canStartのfilter/some→:279 map→sink。正常配列のlengthは数値。 | strongのテキスト。escapeなし。 | 正常配列経路の数値。型正規化はない。不正JSON型でTypeErrorになることを安全な入力検証とは扱わない。既存隔離15ケースを現SHAで再現（後述）。 |
| `apps/kotoba-tantei/app.js:306` | `playerList` | :279 players.map→:548 renderLobbyPlayer→:575 controls。DBのnameをesc、team/roleは固定ラベルへ変換しesc。編集可否／host／loading各分岐は固定markup。操作対象idは各属性でesc。 | ul内li列。名前はテキスト、idは引用符付きdata属性。 | escaped断片。host本人行では削除ボタンなし、非host閲覧では操作列なし。UI表示条件は認可の証明ではない。既存一覧34群を現SHAで再現。 |
| `apps/kotoba-tantei/app.js:1544` | `playerList` | :1519 Array.isArrayで配列以外は[]→map。DBのnameはesc、hostbadge固定、team/role固定ラベル＋esc。 | 観戦ul内li列。テキストのみ、操作対象id／編集controlsを生成しない。 | escaped断片。配列内の異常要素耐性は保証しない。「この一覧に操作要素なし」と購読／アプリ全体書込みゼロを区別。既存一覧34群。 |
| `apps/kotoba-tantei/app.js:1642` | `boardHtml` | :1628 Array.isArray(cards)ならmap、それ以外空。DBのroleはclass内esc、wordと固定cardRoleLabel結果はesc。revealedはstrict trueだけ固定class追加。dispatcher:1437はfinishedかつpendingなしの場合のみ本renderer。 | 盤面div列。roleは引用符付きclass属性、word/markerはテキスト。 | escaped断片。in_progress／finished未確定はtoSpecCardで未公開roleを落とした別rendererへ。属性escapeはrole enumやCSSクラス妥当性の検証ではない。既存盤面37群。 |
| `apps/kyoumi-sugoroku/app.js:222` | `key` | :7–14のTHEMES→:218 Object.entries。suki/yatte/moshimo/jibun/saikin/tokuiの全6固定キー。 | inputの引用符付きvalue属性。escapeなし。 | 固定属性値。チェック選択でstate.themesへ読む方向でありTHEMES/keyの書換えなし。任意DOM改変への保証ではない。 |
| `apps/kyoumi-sugoroku/app.js:224` | `t.icon` | 同じTHEMESのfavorite/rocket_launch/auto_awesome/person/today/star全6固定値。 | icon spanのテキスト。escapeなし。 | 固定文字列。モーダルでのTHEMES参照も読取りのみ、外部入力によるフィールド置換なし。 |
| `apps/kyoumi-sugoroku/app.js:225` | `t.label` | 同じTHEMES全6件の固定日本語ラベル。tagは別プロパティでここへ流れない。 | span内テキスト。escapeなし。 | 固定文字列。全ラベルにHTML特殊文字なし。ユーザーの発言／質問選択はラベルへ保存しない。 |
| `apps/kyoumi-sugoroku/app.js:305` | `pawns` | :250通常配列を作成→:255 state.players。:299 native mapでpos===iなら固定span＋数値idx/idx+1、不一致なら空→filter(Boolean)→join。移動はposだけ更新。 | square内spanのHTML断片。class接尾辞と表示内容は配列index数値。 | 数値だけを含む固定断片。player.name/発言を含まない。1–4人の設定は固定toggleの値で、restartも外部配列を代入しない。 |

## 分岐・データ範囲の補足

- 静的定数は当該モジュール全体で読取りと再代入先を確認した。`const`や変数名だけで不変・escape済みと推測していない。コンソールからの任意JS実行、built-inやprototypeの差替え、getter/Proxyを持つ非JSONオブジェクトまでは対象にしない。
- kotoba-pairはinfo.noteが将来変更されても実escを通る。通常テキスト以外をHTMLとして信頼する分岐はない。値の型異常による例外、ゲームの正否、DB書込み権限は別課題。
- kotoba-tanteiの通常ロビーは購読時にplayersを正規化していない。JSON形の不正lengthを持つオブジェクト等はfind以前／以後で描画が止まり得る。入力検証としての堅牢性不足は既存証拠の観察として残すが、この人数sinkのXSS確定や修正実施へ読み替えない。
- 観戦盤面は「カード断片に未公開roleを出さない境界」と「全観戦画面の情報非干渉」を区別する。既存試験ではscoreboard等はstubで、勝者・expiry・削除・SDK購読そのものはこの検証範囲外。class値内の空白はHTML属性脱出ではなくてもCSSクラスを増やし得るため、任意roleの意味的妥当性は認定しない。

## 現行ソースと既存隔離証拠の照合

次の3検証器を通常モードで実行し、stdoutをJSON parseして保存JSONと`assert.deepEqual`で照合した。すべてPASS。古い基準コミットの名前だけで証拠を流用せず、各検証器内の固定SHA・実抽出境界チェックが現在のファイルで通ったことを確認した。3本のケースには対象や入力の重複があり、86個の独立した脆弱性／全機能試験とは数えない。

| 検証器・保存結果 | 件数と確認した範囲 |
| --- | --- |
| [ロビーlength mjs](evidence/a11-lobby-length-2026-09-08.mjs) / [JSON](evidence/a11-lobby-length-2026-09-08.json) | 15ケース。通常7で人数表示、異常8でTypeError・HTML代入0。実renderと開始条件helperを使用し、入力はJSON round trip。 |
| [一覧 mjs](evidence/a11-kotoba-player-list-2026-09-09.mjs) / [JSON](evidence/a11-kotoba-player-list-2026-09-09.json) | 34群（正常30＋escape除去変異4）。name/id個別、host/nonhost、loading、未知team/role、通常／観戦一覧の文字列文脈。 |
| [観戦盤面 mjs](evidence/a11-kotoba-spec-board-2026-09-09.mjs) / [JSON](evidence/a11-kotoba-spec-board-2026-09-09.json) | 37群（通常境界30＋変異7）。word/role別escape、strict公開判定、未公開role投影、pending dispatch、終了から再描画。 |

Node VMは固定関数と共有escapeの抽出実行、HTML文字列／プロパティ捕捉スタブである。今回、ブラウザのDOM解析、実SDK購読、認可、DB接続、ネットワーク通信、本番Firebase、iPhoneは実施していない。残り10参照は前表の静的追跡で判断し、新しい動的保証を足していない。

## 対象ソース SHA-256

| ファイル | SHA-256 |
| --- | --- |
| `apps/kotoba-pair/index.html` | `36e1799612449e389c1e9e1263a39e6a243ad1ac6c182cb443ba62af5dc08f09` |
| `apps/kotoba-pair/packs.js` | `3e115af178cd82f02e018f5d4c5fbf5c3e1186366b586c40a70fa88241a6a063` |
| `apps/kotoba-shuffle/app.js` | `a8d8e855f1f9a9ec1f25fda089e9d547d5946761db6f3f36955e082aa8927cec` |
| `apps/kotoba-shuffle/words.js` | `d75592cc896c95ce0e14e84792b0a8503793b3ae1a6864682a9219b88cebd73a` |
| `apps/kotoba-tantei/app.js` | `b96fc56f8c3836b06a9ca6be6c58db65d812f9e870f9e45102b3f6924c0fcae9` |
| `apps/kotoba-tantei/words.js` | `2141e3af09e379c23ff35794f611fc87d3889b18699797b35717b079ad8c2bb4` |
| `apps/kotoba-tantei/service.js` | `096666319ffcdf707cf6027a0334f01c2ce63322f8cecb4fd3c6d5f06d5a6cf0` |
| `apps/kyoumi-sugoroku/app.js` | `ef5f1d07d102173d63a0d26bb67fcc9dbae35651a7938408ba05a92a238bd0a3` |
| `apps/shared/js/utils.js` | `533e791fd06c37839989a1461bb0322d11c94fc1d1ef853a03c68fb12c25c370` |
| `apps/shared/js/rtdb-utils.js` | `77d414a84d39deb52e1c8544e26465d4b822041621dbd985cad804e36d3b1d12` |

この担当による変更は本報告1ファイルのみ。アプリ・共有・検査器・既存証拠・rulesは変更せず、コミット・push・公開を行っていない。独立レビュー結果とA-11全44参照の集約判定は主担当の後続工程で記録する。

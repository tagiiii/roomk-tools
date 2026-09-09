# A-11 オフライン4アプリ・未判定11箇所の手動追跡（2026-09-09）

## 範囲と限定結論

基準 `7625ba6ab1d77042bb52721bdd430fea92083fe7`。`python3 scripts/sec1-dataflow.py --json` は71ファイル・error 0・unknown 44。このうち quiz 3、suki-type-check 6、talk-card 1、value-card 1を、ソースから変換・再代入・最終HTML文脈まで直接追跡した。

下記11箇所では、現行のアプリ入力経路から未エスケープの外部文字列がHTML構造へ到達する経路は確認しなかった。これは対象SHA・列挙経路についての手動判断であり、検査器の `safe` 判定への変更、アプリ全体の安全認定、全44箇所の解決を意味しない。固定データ由来の2箇所はエスケープ防御自体を持たず、入力源を外部化する変更時には再審査が必要である。

本報告ではアプリ・共有・検査器・仕様・性格に基づく推薦方針を変更していない。Firebase・iPhone・ブラウザ・ネットワーク・実クリップボード・実画像保存は使用していない。通常の入力経路を対象とし、既に任意JavaScriptを実行できる攻撃者によるモジュール改変・依存ライブラリ侵害まで安全だとするものではない。

## 全11箇所の対応表

行番号は各 `apps/{app}/app.js`。各HTML断片の組み立て後に、別の未検査文字列を追記する経路がないことも確認した。

| # | app・sink行／参照 | source → 変換・再代入 | 最終文脈・防御 | 限定判定と根拠 |
|---|---|---|---|---|
| C01 | quiz:355 `pack.icon` | `questions.js:7` の24固定パック、または `createShufflePack`(:17–49) に渡す固定 `shuffle` → `PACK_SECTIONS`(:33–61) → :339 の `pack`。元iconへの代入なし | :353 `button.innerHTML` のspan本文。escapeなし | 現行固定値に限定して未エスケープ外部入力なし。24icon全て `[a-z0-9_]+`、追加2パックは固定 `shuffle`。ファイルインポートやURL/保存/DB由来のicon取得なし。将来iconを外部化した場合には成立しない |
| C02 | quiz:356 `countLabel` | 固定パックの `questions` は配列。:348 でその `.length` と固定 `問` を組み立てた局所const。再代入なし | 同じ `button.innerHTML` のspan本文。escapeなし | 配列長という非負整数と固定文字のみ。出題時は元配列をfilter/map等でコピーし、当該長さを外部文字列に変更しない |
| C03 | quiz:358 `tag` | :349–351 `section.key === 'challenge'` の真偽から固定spanまたは空文字。局所const | 同じ `button.innerHTML` のdiv本文、`escapeHtml(pack.name)` の後にHTML断片として挿入 | 分岐条件の値そのものは出力しない。固定HTML以外の追記・再代入なし |
| C04 | suki-type-check:272 `optionsHtml` | `OPTIONS`(:10–16)、`NUMBERS`(:7) → :251–260 のmap/join。選択回答は固定キー照合後にstateへ入り、`chosen === option.key` の真偽だけに使う | :262 `#screen-question.innerHTML` のdiv本文。断片内のlabel/key/番号は局所 `esc`(:124–131)。aria-label/data-valueはダブルクォート属性。aria-checkedは固定true/false | 5文字 `& < > " '` のescapeを確認。`answer`(:363–376) は `optionByKey` で入力キーを固定集合へ制限。index+1はmapの数値index。断片へ生のdataset値を戻さない |
| C05 | suki-type-check:327 `iconsHtml` | :355–358 `buildResult()` → `determineType`(:171–207) → 固定AXES/FLAT_TYPEのicon配列 → :286–288 map/join | :324 `#screen-result.innerHTML` 内div本文。各iconはspan本文に `esc(icon)` | 局所constで追記なし。flat/single/hybridの全分岐で同じescape経路 |
| C06 | suki-type-check:331 `examplesHtml` | 固定AXES.examples → singleは配列参照、hybridはsliceコピーの結合、flatは空配列 → :289–298 | 同じsinkのdiv本文。内部li本文に `esc(example)`、空なら空文字 | 全要素をmap中にescape。配列参照を返す分岐も、その要素を入力値で変更するコードはない |
| C07 | suki-type-check:332 `noteHtml` | 固定 `FLAT_TYPE.note`(:105)、または空文字 → :299–305 | 同じsinkのdiv本文。内部p本文に `esc(type.note)` | 真偽で固定wrapperの有無を変えるだけ。生のnoteは挿入しない |
| C08 | suki-type-check:335 `barsHtml` | 回答キー → `scoreOf`(:140–148) の固定0–4、未一致はnull → :157–166 加算/除算/Math.round → rankingコピーsort(:212) → :306–319 map/join | 同じsinkのul本文。名前/数値はesc、class追加は固定文字。幅属性は `style="width: ${esc(String(entry.percent))}%"` | 名前escapeと固定数値由来により対象経路のHTML/CSS注入なし。幅の安全性はescだけでなく、最大3回答×4点→0–100の算術経路による。汎用CSSサニタイズや任意resultの安全を主張しない |
| C09 | suki-type-check:336 `secondHtml` | :215–217 のranking.find、flatはnull → :320–322 | 同じsinkのsection本文。p内の `result.second.axis.name` をesc。該当なしは空文字 | 現行唯一の呼出元 :358 は `buildResult` の出力。局所constで再代入なし |
| C10 | talk-card:153 `topic` | :6–116 の100固定文字列 → :125 `shuffle(topics)` → :130 `pool.splice(0,3)` → :136の `hand.forEach` | :145 `card.innerHTML` のspan本文。escapeなし | 現行固定お題に `<` / `&` なし。shuffleは共有:95–102で配列コピー/入替のみ。pool/handはこの固定集合から取り直すだけで、自由入力・URL・保存・DB・ファイル取込なし。別表示 :189 はtextContent。将来お題外部化時は再審査 |
| C11 | value-card:304 `cardsHtml` | textarea.value → :246 trim → memos → :266 `memo = memos[i] || ''` → :292 `escapeHtml(memo)` → :264–297 `cardsHtml +=`。カード名/説明も :281/:285で同じescape | :299 `container.innerHTML` のdiv本文。各メモは固定div本文で、属性・script・style内へは入らない | 唯一の自由文字入力を全非空分岐でescape。trim/maxlengthを防御根拠にせずescape実体を確認。再代入は固定wrapper＋escape済み値の追記だけ。既存SHA固定VMを再実行して補強 |

## 入力境界と補足確認

- 4アプリの `app.js` を全体確認した。quiz はローカルES module `questions.js` から固定配列を読む。選択操作が変更するのはstateであり、元iconや元questionsを外部文字列で置換する処理はない。quizの問題文等は今回の3参照とは別の文脈である。
- suki-type-check の質問・軸定義・結果文言はモジュール内の固定定義。DOMの `data-value` が操作されても `optionByKey` に一致しない値は回答に採用されず、点数は固定値へ解決される。手動レビューはXSSの入力経路だけを判断し、既存のタイプ表示や推薦仕様を承認・変更したものではない。
- value-card のcardDataは固定30件。startGame(:66–77)、exchangeCard(:121–132)、moveCard(:199–204)、syncHandFromRanking(:207–216)を確認。DOMのcardIdはparseInt後に既存handからfindするだけで、カード本文をDOMから読み戻さない。自由メモは保存用一時DOMでescapeされる。
- 4アプリのindexには共通stats/howto参照がある。「オフライン」は今回追跡した入力源・本体処理の説明であり、実ページから通信が一切発生しないという主張ではない。今回はそれらをロードしていない。

## 再実行した証拠

`node docs/reports/evidence/a11-value-memo-2026-09-08.mjs` はexit 0、12/12ケース、メモescape除去の負の対照を検出。ハーネス自身が現行ファイルと固定コミットのSHA一致を検証する。詳細は [既存報告](a11-value-memo-2026-09-08.md) と [検証器](evidence/a11-value-memo-2026-09-08.mjs)。同期html2canvas throw時の一時コンテナ残存は既知の観察として維持し、実ライブラリで発生確認したとも解決したとも扱わない。

追加のメモリ内Node VM確認では、現行questions.jsのexport指定だけを除いた配列定義とtalk-cardのtopics定義だけを評価し、24パック全て `Array.isArray(questions)` かつiconが `/^[a-z0-9_]+$/`、100お題全て文字列かつ `/[<&]/` 不一致をassertした（exit 0）。描画・ネットワーク・外部モジュールは実行していない。これは固定内容確認であり、任意入力による描画の動作試験ではない。

## 読み取り時SHA-256

| ファイル | SHA-256 |
|---|---|
| apps/quiz/app.js | bd4c69bd18c96dcad7d89caf707b04189de0313e13d203a3d3d63d1e4f2ef4e4 |
| apps/quiz/questions.js | 2d3ca2de2d5b339e5b27ede746210abb6d9f027b6f8698b89653bb585d75ac40 |
| apps/suki-type-check/app.js | 466c3485be3243160ccb98607ef3f8791f8a2360a1713eeae4b861d93173c476 |
| apps/talk-card/app.js | a4faf70f6004119c49d8f62d522696175386e6b4d5ebe92e716ac400f77eaca9 |
| apps/value-card/app.js | f5aab7271482c23c94404487f0b04f5128e0e7565dda14cff521622729aa9e16 |
| apps/shared/js/utils.js | 533e791fd06c37839989a1461bb0322d11c94fc1d1ef853a03c68fb12c25c370 |

## 残る保証範囲

11参照は引き続き検査器ではunknownである。現行コードの入力源・変換・挿入文脈を個別に説明できたことと、検査器の一般解析能力は別に管理する。実ブラウザでのDOM解析、依存ライブラリ自体、全アプリの別sink、将来の固定データ外部化や任意オブジェクトの持ち込みまでこの報告から安全と推論しない。独立レビュー前の作成者報告として提出する。

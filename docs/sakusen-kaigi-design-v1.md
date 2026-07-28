# さくせん会議 — 設計仕様書 v1（正本）

司令塔がプロダクト設計責任者として確定した仕様（役割の定義は [ai-roles.md](./ai-roles.md)）。実装はこの文書に従うこと。
実装完了後は本文書の要点を `apps/sakusen-kaigi/AGENTS.md` に転記し、以後はそちらを正本とする。

## 0. 位置づけ・前提

- 不登校の子ども・若者向けオンラインメンタリング room-K で、メンターが Zoom/Meet の画面共有中に操作する。子どもは画面を見て口頭・チャットで選択を伝える。クリック操作はすべてメンター。
- Goal–Plan–Do–Check を使った「さくせん会議」ツール。**正式な CO-OP プログラムや医療的介入ではない。アプリ内 UI に「CO-OP」「治療」「訓練」の語を出さない。**
- Do（ためす）は次回セッションまでの期間であり、日々の記録機能・メンター観察評価は持たない。
- デスクトップファースト。600px 以下は最低限のレスポンシブ対応。
- 正解・達成競争・連続記録・バッジ・他者比較を設けない。賞賛/残念/励まし演出も禁止。
- 対象は小学校中学年〜中学生。漢字は小4程度、ひらがな多め。

## 1. 技術構成

- `apps/sakusen-kaigi/` に talk-card 型オフライン構成: `index.html` + `app.js` + `style.css`。Firebase 不使用。
- **永続化ゼロ**: localStorage / sessionStorage / IndexedDB / Cookie を一切使わない。履歴は JSON ファイルのダウンロード／アップロードのみ。
- design-system.css / Material Symbols Rounded 使用。絵文字禁止。
- CSS 接頭辞 `sk-` + BEM（例: `.sk-stepper__step--current`, `.sk-choice__num`, `.sk-board__card`）。
- viewport に `maximum-scale` を付けない（RTDB アプリ向けルールは適用外）。
- 状態は `const state = { record, dirty, currentScreen, draft }` にまとめ、`showScreen(id)` パターン（`.screen` / `.active` / `screen-xxx` 命名）を使う。
- ユーザー由来文字列の DOM 挿入は必ず `esc()` を通す。
- 外部通信は Google Fonts / Material Symbols の読み込みのみ。

## 2. 画面遷移

```
screen-start ──「はじめる」──────────────→ screen-goal-category（初回ウィザードへ）
     │
     └「前回のファイルをひらく」→ screen-load-confirm ─OK→ screen-home
                                      └「選び直す」→ screen-start

【Goalウィザード】
screen-goal-category → screen-goal-example → screen-goal-build → screen-plan
                                                                    │
【確定】                                                             ↓
screen-home ←──────────── screen-save ←──── screen-confirm ←────────┘

【ふりかえり（screen-home で目標を1件選択）】
screen-check-last → screen-check-rating → screen-check-points → screen-check-next
                                                                    │
   ┌────────────────────────────────────────────────────────────────┤
   ├ ①このまま続ける ──────→ screen-confirm（同じ作戦を新規 plan として追記）
   ├ ②さくせんを変える ────→ screen-plan → screen-confirm
   ├ ③めあてを変える ──────→（現目標の状態選択: おやすみ/おわり）→ screen-goal-category
   └ ④いったんおしまい ────→（おやすみ/おわりを選択）→ screen-home
                                     ※どの経路でも最後は screen-save を経て screen-home
```

- 全ウィザード画面に「← もどる」（ghost、入力保持。draft オブジェクトで復元）。
- screen-home の「きょうの会議をおわる」→ screen-save。
- 未保存変更（dirty）でのタブ閉じ/リロードは `beforeunload` 警告。ダウンロード成功で dirty クリア。

## 3. 共通 UI ルール

- 上部に現在位置ステッパー `<ol>`: **めあて（Goal）→ さくせん（Plan）→ ためす（Do）→ ふりかえり（Check）**。`aria-current="step"`。現在項目はアクセント色＋下線＋太字（色のみ禁止）。Goal系画面=めあて、screen-plan=さくせん、screen-save=ためす、Check系=ふりかえり。
- 選択肢一覧は丸数字 `①②③` 付き大型カードボタン（`.sk-choice__num` はアクセント色、flex レイアウト、AGENTS.md 規約準拠）。
- 「じぶんで決める」「今は決めない」「話さなくてもよい」等の特殊選択肢は**番号なし**で下部に配置。
- 1画面1判断を基本。最終決定前に確認画面（screen-confirm）。
- 文言原則: 命令形・評価語（がんばろう/すごい/おしい/失敗/できなかった）を使わない。問いは「〜してみる？」「〜はある？」形。

## 4. 各画面仕様

### screen-start
- タイトル「さくせん会議」、サブ「めあてを決めて、さくせんを立てて、ためして、ふりかえろう」
- `①はじめて さくせん会議をする`（primary）／`②前回のファイルをひらく`（secondary、file input）
- 注意書き（muted小）:「このアプリはデータをどこにも保存しません。おわるときにファイルをダウンロードして持ち帰ります」
- 読込エラーはこの画面にインライン `alert alert-error` で表示。

### screen-load-confirm
- 見出し「この記録でつづきをはじめる？」
- **めじるし**（色×動物、例: アイコン＋「そらいろのネコ」）を大きく表示
- 目標一覧（タイトル・状態チップ・さくせん回数）、「さいごの会議：YYYY/MM/DD」
- `①この記録ではじめる`（primary）／`②ちがうファイルをえらび直す`（ghost）

### screen-home（めあてボード）
- 見出し「いまのめあて」
- 目標カード最大3枚縦積み: タイトル／状態チップ（`とりくみ中`=accent枠、`おやすみ中`=muted枠、`おえた`=success枠＋check_circle。色＋文字＋アイコンの三重表現）／「いまのさくせん」1行
- とりくみ中カード: 「ふりかえる」（open plan あり）または「つづきを決める」（open plan なし → screen-plan）
- おやすみ中カード: 「また とりくむ」（active に戻す。active が3件のときは押せず理由を表示）
- 下部: `もう1つ めあてを追加する`（ghost、とりくみ中<3のとき表示）／`きょうの会議をおわる`（primary → screen-save）
- 合計・順位・比較表示なし。全目標が paused/done なら「あたらしいめあてを決める」導線を表示。

### screen-goal-category
- 問いかけ「どんなことに とりくんでみたい？」
- カテゴリカード6枚（2列グリッド）: ①せいかつ ②学び・きょうみ ③習いごと・活動 ④しゅみ ⑤人とのかかわり ＋番号なし「じぶんで決める」（→ screen-goal-build 自由記述モード）

### screen-goal-example
- 問いかけ「たとえば、こんなこと。近いものはある？」
- 選択カテゴリの具体例カード ＋番号なし「あてはまるものがない → じぶんで決める」「← べつのカテゴリを見る」

### screen-goal-build
- 見出し「めあてを くみたてよう」
- 文章プレビュー（大きく表示、選ぶたび更新）: `「朝おきる」を〔いつ：きめない〕〔どのくらい：きめない〕`
- スロット2行: **いつ**（あさ／ひる／ゆうがた／よる／ねる前／きめない）、**どのくらい**（1回だけ／5分だけ／15分くらい／30分くらい／きりのいいところまで／きめない）。初期値はどちらも「きめない」。決めなくても進める。
- 各行に「じぶんで決める」→ その行だけ短い入力欄（maxlength 30）＋「なまえ・学校名などは書かないでね」
- 自由記述モード: タイトル入力欄（maxlength 60）＋同注意書き（メンター代筆想定）
- `これでいい`（primary）→ screen-plan

### screen-plan
- 問いかけ「**どれなら ためせそう？**（1〜3こまで）」
- 作戦カード12枚（2列）、複数選択（`aria-pressed`、選択時 check アイコン＋枠色＋背景の三重表現）。4枚目タップで toast「さくせんは 3こまで えらべるよ」
- 番号なし「じぶんで さくせんを書く」→ 入力欄（maxlength 80）＋個人情報注意
- 番号なし「今は決めない」→ 作戦0個で先へ（plan は status "undecided" で保存。次回 home で「つづきを決める」）
- `この さくせんにする`（primary）

### screen-confirm
- 見出し「これで いってみる？」
- カード: めあて文／さくせん一覧／説明1行「つぎの会議まで、ためしてみる期間だよ（ためす＝Do）」
- `①これでいく`（primary）／`②なおすところがある`（ghost → もどる）

### screen-save
- 見出し「きょうの記録を ほぞんしよう」
- めじるし表示＋ファイル名プレビュー
- `alert alert-info`:「じゆうに書いたところに、なまえ・学校名などの個人じょうほうが入っていないか、たしかめてください」
- `記録ファイルをダウンロード`（primary）→ 成功後「ダウンロードしました。Googleドライブへの保存はメンターがおこないます」＋`ボードにもどる`／`これでおわる`

### screen-check-last
- 見出し「前回の さくせん会議」
- 前回のめあて文＋さくせんカード（読み取り専用）＋「ためしてみて、どうだった？」
- 折りたたみ「これまでのあゆみ」: 過去 plan＋check の時系列リスト（古い→新しい）。グラフ・平均・前回比なし。rating は「そのとき自分でつけた感覚: 4（だいたい できたかんじ）」のようにラベル併記テキストのみ。
- `ふりかえりに すすむ`（primary）／番号なし「今回はふりかえらない」→ screen-check-next へ直行（ratingSpecial: "skip-check"）

### screen-check-rating
- 問いかけ「じぶんでは、どのくらい できた**かんじ**がする？」
- 説明（muted）:「せいせきや点数じゃないよ。じぶんの かんじたままでOK」
- **同色・同サイズの5枚カード横並び**（赤→緑グラデ・顔アイコン・星・バー禁止。数字は装飾なし等ウェイト）:
  - 1: 今回は ためすタイミングがなかった
  - 2: ちょっとだけ ためせた
  - 3: 半分くらい できたかんじ
  - 4: だいたい できたかんじ
  - 5: 思ったように できた
- 番号なし: 「数字では決めにくい」（hard-to-say）／「話さなくてもよい」（no-talk）
- 選択後のフィードバック文なし（賞賛も残念も出さない）。

### screen-check-points
- 問いかけ「今回のこと、あてはまるものはある？（いくつでも・なくてもOK）」
- グループ「よかったかも」: やり方が合っていた（method-fit）／小さくしたのがよかった（small-good）／だれかの助けがよかった（help-good）
- グループ「うまくいきにくかったかも」: 時間や場所が合わなかった（time-place）／わすれていた（forgot）／思ったよりむずかしかった（difficult）／今週はよゆうがなかった（no-room）／気もちがかわった（feeling）
- 番号なし: 「どれともちがう」（none-fit）／「話さなくてもよい」（no-talk）
- 任意「ひとことメモ」（メンター代筆、maxlength 120、個人情報注意付き）
- `つぎへ`（primary、未選択でも進める）

### screen-check-next
- 問いかけ「つぎは、どうしてみる？」
- 説明（muted）:「前とおなじでも、変えても、どっちでもいいよ」（評価値と行動選択の因果を切る中立文）
- ①`この さくせんを つづける` ②`さくせんを 変えてみる` ③`めあてを 変える` ④`いったん おしまいにする`
- ④でインライン展開: 「またやるかも（おやすみにする）」「ここでひと区切り（おわりにする）」
- ③でインライン展開: 「今のめあては？ → おやすみにする／おわりにする」→ screen-goal-category へ

## 5. 初期データ

```js
const GOAL_CATEGORIES = [
  { id: 'life',    label: 'せいかつ',       icon: 'self_care',
    examples: ['おきたい時間におきる', 'ねるじゅんびをする', 'ごはんを食べる',
               'みじたくをする', 'ゆっくり休けいする', 'そとに出てみる'] },
  { id: 'learn',   label: '学び・きょうみ', icon: 'menu_book',
    examples: ['気になることをしらべる', 'よみたい本をよむ', 'きょうざいにさわってみる',
               '決めた時間だけやってみる', 'あたらしいことをひとつためす'] },
  { id: 'activity',label: '習いごと・活動', icon: 'sports_soccer',
    examples: ['れんしゅうをする', 'じゅんびをする', 'さんかしてみる', 'さくひんをつくる'] },
  { id: 'hobby',   label: 'しゅみ',         icon: 'palette',
    examples: ['ゲームでやりたいことにちょうせん', 'なにかをつくる', 'どうがや本をたのしむ',
               'あつめているものをせいりする', 'すきなことを人にしょうかいする'] },
  { id: 'people',  label: '人とのかかわり', icon: 'forum',
    examples: ['じぶんから話しかけてみる', 'たのみごとをしてみる', '気もちをつたえてみる',
               'あいさつをしてみる', 'いっしょになにかをする'] },
];
const WHEN_CHIPS   = ['あさ', 'ひる', 'ゆうがた', 'よる', 'ねる前', 'きめない'];
const AMOUNT_CHIPS = ['1回だけ', '5分だけ', '15分くらい', '30分くらい', 'きりのいいところまで', 'きめない'];

const PLAN_STRATEGIES = [
  { id: 'time',     label: 'やる時間を決める',           icon: 'schedule' },
  { id: 'place',    label: 'やる場所を決める',           icon: 'location_on' },
  { id: 'first',    label: 'さいしょの一歩だけ決める',   icon: 'footprint' },
  { id: 'small',    label: '量や時間を小さくする',       icon: 'compress' },
  { id: 'prepare',  label: 'ひつようなものを先に用意',   icon: 'inventory_2' },
  { id: 'visible',  label: '見える場所におく',           icon: 'visibility' },
  { id: 'timer',    label: 'タイマーや通知をつかう',     icon: 'alarm' },
  { id: 'voice',    label: 'だれかに声をかけてもらう',   icon: 'record_voice_over' },
  { id: 'together', label: 'いっしょにやってもらう',     icon: 'group' },
  { id: 'planb',    label: 'うまくいかないときの べつの作戦も決める', icon: 'alt_route' },
  { id: 'end',      label: 'どこまでやったら おわりにするか決める',   icon: 'flag' },
];
```

（作戦カードは上記11枚＋「じぶんで さくせんを書く」で12枚構成）

「学び・きょうみ」はコンテンツガイドライン（学校・勉強連想の禁止）の**本ツール限定例外**。宿題・テスト・成績・授業・学校の語は使わない。

## 6. JSON データモデル

```json
{
  "app": "sakusen-kaigi",
  "schemaVersion": 1,
  "fileMarker": { "color": "そらいろ", "animal": "ネコ" },
  "createdAt": "2026-06-19T06:00:00.000Z",
  "updatedAt": "2026-07-03T06:30:00.000Z",
  "goals": [
    {
      "id": "g_a1b2c3",
      "status": "active",
      "category": "life",
      "exampleId": "おきたい時間におきる",
      "when": "あさ",
      "amount": "きめない",
      "customTitle": null,
      "title": "あさ、おきたい時間におきる",
      "createdAt": "2026-06-19T06:05:00.000Z",
      "plans": [
        {
          "id": "p_d4e5f6",
          "createdAt": "2026-06-19T06:10:00.000Z",
          "strategies": ["timer", "voice"],
          "customStrategy": null,
          "status": "checked",
          "check": {
            "checkedAt": "2026-07-03T06:20:00.000Z",
            "rating": 2,
            "ratingSpecial": null,
            "wentWell": ["help-good"],
            "wasHard": ["forgot"],
            "pointsSpecial": null,
            "note": null,
            "nextAction": "change-plan"
          }
        },
        {
          "id": "p_g7h8i9",
          "createdAt": "2026-07-03T06:25:00.000Z",
          "strategies": ["visible", "first"],
          "customStrategy": null,
          "status": "open",
          "check": null
        }
      ]
    }
  ]
}
```

- enum: goal.status = `active | paused | done`。plan.status = `open | checked | undecided`。
- `ratingSpecial`: `null | "hard-to-say" | "no-talk" | "skip-check"`（rating と排他）。
- `pointsSpecial`: `null | "none-fit" | "no-talk"`。
- `nextAction`: `continue | change-plan | change-goal | pause | done`。
- **plans は追記専用**。check 確定後の plan を書き換えない。
- 制約: とりくみ中（active）goal は最大3件、goal 総数は最大10件（履歴保持のため。「最大3件」は同時進行数の解釈）。
- 日時は ISO 8601。`title` は組み立て結果の表示用文字列として保持。

## 7. インポート／エクスポート

**エクスポート**: Blob + `<a download>`。ファイル名 `sakusen-record_{animal-romaji}-{color-romaji}_YYYY-MM-DD.json`（例 `sakusen-record_neko-sora_2026-07-03.json`。ローマ字対応表はめじるし辞書に内蔵）。書き出し時に `updatedAt` 更新、成功で dirty クリア。同日重複はブラウザの `(1)` 付与に委ねる。

**インポート検証**（外部データを信用せず全件正規化。既知フィールドのみで record を再構築）:

| チェック | 失敗時の挙動・メッセージ |
|---------|------|
| サイズ ≤ 512KB / JSON.parse 成功 / `app === "sakusen-kaigi"` | 拒否:「このファイルは読み込めませんでした。さくせん会議でほぞんしたファイルか、たしかめてください」 |
| `schemaVersion > 1` | 拒否:「このファイルは新しいバージョンでつくられています。アプリを更新してから開いてください」 |
| `schemaVersion < 1` または欠落 | 拒否（上の読み込めない旨と同文） |
| goals: 配列・総数≤10・active≤3 | 拒否:「記録の内容が正しくないため読み込めませんでした」 |
| 文字列長: title≤60, customStrategy≤80, note≤120, when/amount≤30 | 切り詰めて受理 |
| rating: 1〜5 整数 or null / enum 各値 | 不正値は null / 除外に正規化 |
| 日時: ISO 8601 parse 可能 | 不正なら null（表示は「—」） |
| 未知フィールド | 破棄 |
| ID | 信用せず、衝突時は再採番 |

不正ファイルでクラッシュせず screen-start にエラー表示して操作可能なまま復帰すること。

## 8. プライバシー・誤操作対策

1. 永続化ゼロ（受け入れ条件で検証）。氏名・ID 入力欄なし。ファイル名にも含めない（めじるしのみ）。
2. 自由記述3欄（目標自由記述・作戦自由記述・ひとことメモ）すべてに「なまえ・学校名などは書かないでね」を常設＋ screen-save で再確認。
3. 誤ファイル対策: めじるし＋ screen-load-confirm 必須経由。
4. dirty + beforeunload。破壊的操作（おわりにする等）は確認ステップを挟む。

## 9. アクセシビリティ

- 選択カードは `<button>`。単一選択群は `role="radiogroup"` ＋ `aria-checked`、複数選択は `aria-pressed`。
- 選択状態は枠色＋背景＋ check アイコンの三重表現（色のみ禁止）。
- ステッパー `<ol>` + `aria-current="step"`。
- 全操作キーボード可能（Tab / Enter / Space）、`:focus-visible` 明確化。
- タップターゲット最小 44×44px。コントラストは design-system トークン準拠（WCAG AA）。
- `prefers-reduced-motion` でアニメーション無効。
- 見出し階層 h1→h2。toast は `role="status"`、エラーは `aria-live="assertive"`。

## 10. エッジケース

1. active 3件で「追加」非表示。「めあてを変える」も旧目標を paused/done にしてから新規作成。
2. goal 総数10件到達 → 新規追加不可の案内「これ以上あたらしいめあてを追加できません。おわっためあてはファイルにのこります」。
3. open plan なし目標 → 「つづきを決める」で screen-plan から再開。
4. 「今回はふりかえらない」→ rating/points をスキップし screen-check-next へ。check は `ratingSpecial: "skip-check"` で記録。
5. インポート直後の無変更クローズは警告なし（dirty でないため）。
6. ウィザード途中でボードに戻る操作は「入力中の内容が消えます」確認。「← もどる」は draft 保持。
7. 自由記述が空白のみ → trim して未入力扱い（空目標を作らない）。
8. 600px 以下: グリッド1列化、ステッパーはアイコン＋現在項目のみラベル。横スクロール禁止。

## 11. 受け入れ条件

1. `bash scripts/lint.sh` エラー0
2. 初回フロー（はじめる→Goal→Plan→確認→ダウンロード）がマウスのみ／キーボードのみ両方で完走
3. JSON 再読込→確認→ふりかえり→次 Plan→再ダウンロードが完走し、2回目 JSON に1回目の check が上書きされず残る
4. localStorage / sessionStorage / IndexedDB / Cookie 書き込み0件、外部通信は fonts.googleapis.com / fonts.gstatic.com のみ
5. 壊れた JSON・`schemaVersion: 99`・goals 11件がそれぞれ指定メッセージで拒否され、アプリが操作可能なまま
6. 未保存変更ありでタブを閉じると beforeunload 警告。ダウンロード後は出ない
7. 1〜5 選択でいかなる賞賛・残念系文言も表示されない
8. 合計値・達成率・前回比・順位がどこにも表示されない
9. 「CO-OP」「治療」「学校」「宿題」「成績」が UI 文言に含まれない（grep）
10. 絵文字不使用・Material Symbols Rounded 使用・`sk-` + BEM 準拠
11. active 3件のとき追加ボタンが出ない
12. 600px 幅で横スクロールが発生しない

## 12. 実装担当に委ねる事項

- `sk-` BEM の詳細クラス設計、CSS 具体値（design-system トークン範囲内）
- ステッパー・カード細部レイアウト、600px 以下の折返し詳細
- ID 生成方式（`g_`/`p_` + ランダム英数）、めじるし辞書（色8×動物8程度＋ローマ字対応表。個人を特定しない語のみ）
- draft オブジェクトの内部構造と「もどる」の状態復元実装
- エラー表示の DOM 構造（alert クラス利用の範囲で）
- ポータルカード（apps/index.html）の文面調整とアイコン選定

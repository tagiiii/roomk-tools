# コトバペア 仕様書

## 目的・使用シーン

盤面に並んだことばカードから、**意味としてつながる2枚**を見つけてそろえる協力ゲーム。
同じ絵柄を合わせる記憶ゲームではなく、「大きい⇔小さい」「こうえんで⇔あそぶ」のように
**つながる理由を考えること自体が探索**になる。

- 正本: [docs/requirements.md](../../docs/requirements.md) 第9.1章（コトバペア詳細仕様）。本書は実装の正本
- 対象: 小学校中学年〜中学生。「コトバであそぼ！」（国語ワークショップ）で使う（`data-scenes="kotoba"`）
- 人数: **2〜9人**（ホスト含む。ホストもプレイヤーとして手番に入る）。快適帯は3〜6人
- 時間: 1ボード5〜10分。45分枠では2〜3ボード＋パック替え
- **オープンモード（全カード表向き）のみ**。記憶力を使わないので Lv.1 の子も盤面を見て相談に参加できる
- 面白さの核: ①「これとこれ、つながるんじゃない？」の発見と相談 ②誤った組み合わせが生む偶然の面白さ ③全部そろえたときの全員の達成感

> 着想元は「意味でつながる2枚を合わせる」という一般的なマッチングのメカニクスのみ。
> 実在ボードゲームの名称・固有用語・カード構成は使わない（AGENTS.md「アプリ名のつけかた」準拠）。

## 技術スタック

```
apps/kotoba-pair/
├── AGENTS.md    # この仕様書
├── index.html   # 本体（CSS・JS インライン）
└── packs.js     # 学習コンテンツパック（外部データファイル。下記「意図的な逸脱」参照）
```

- Realtime Database + Firebase compat SDK **10.14.1**（app / auth / database）+ 匿名認証
- 共有ヘルパー `../shared/js/rtdb-utils.js?v=20260715`（`initFirebase` / `now` / `isRoomExpired` / `getHostDisconnectedAt` / `generateRoomCode` / `esc` / `cancelRoomOnDisconnect` / `showToast`）
- `shuffle` は `../shared/js/utils.js` から `type="module"` で読み込み `window.shuffle` に載せる（REF-3 の重複定義回避。kaburazu-hint と同じ形）
- `../shared/css/design-system.css` のトークン・`btn` / `card` / `badge` / `form-*` を再利用
- CSS 接頭辞: **`kp-`**（BEM）。画面切替は共通パターンの `.screen` / `.active`
- viewport は `maximum-scale=1`、`const state = {...}`、`showScreen()`、`esc()`（RTDB アプリ共通ルール）
- stats.js（`?v=1` defer・howto.js の直前）／howto.js（title「あそびかた」）
- 表記トーン: **ひらがな中心のやわらかい表記**（子どもがひとりで読む前提の「ことば系」アプリ）。
  カードに載る語そのものはコンテンツなので表記方針の対象外（packs.js の表記をそのまま出す）

### 横断更新（統合担当が行う）

- `scripts/lint.sh` の `RTDB_HTML_FILES` に `apps/kotoba-pair/index.html` を追加
  （**未登録の間は [VIEWPORT-2] の警告が1件出る**。登録すれば消える）
- `apps/index.html` にカード追加（`data-scenes="kotoba"`）
- `apps/updates.json` 先頭に `type: "new"` エントリ
- `apps/guide/` のゲームえらび早見表に1行追加

## Realtime Database パス

```
kotobapair_rooms/{roomCode}/
```

- ルームコードは6桁英数字（`RoomkRTDB.generateRoomCode()`。紛らわしい文字を除外）
- ニックネームは最大8文字・同ルーム内重複NG・空NG。RTDB のパスキーに使うため `. # $ [ ] /` を含む名前は拒否する
- セキュリティルールの変更は不要（ワイルドカード `$app_rooms/$roomId`）

## 画面・status 遷移

```
screen-top ─┬─ screen-create（ホスト）──┐
            └─ screen-join（ゲスト）────┴─> screen-waiting ──> screen-game ──> screen-result
                                                                   ↑                  │
                                                                   └── もういちど ────┘
```

```
waiting ──(ホストが「ゲームを はじめる」)──> playing ──(全ペア成立 / ホストの「ここまでにする」)──> result
                                              ↑                                                      │
                                              └────────── もういちど・パック替え（boardSeq+1）────────┘
```

| status | 画面 | 説明 |
|---|---|---|
| `waiting` | screen-waiting | コード表示・参加者一覧。**2人以上**でホストの「ゲームを はじめる」が活性化 |
| `playing` | screen-game | 盤面。ミクロ状態は `selected`（0〜2枚）と `board/cards/*/state` で表現する |
| `result` | screen-result | そろえたペア一覧と かいすう。ホストのみ「もういちど あそぶ」「パックを かえて あそぶ」 |
| （想定外） | screen-pending | 「じゅんびしています…」の安全な待機画面にフォールバックする（default-deny） |

- `status` を進めるのはホストのみ。例外は「全ペア成立で `playing → result`」で、これは手番プレイヤーの確定 transaction 内で起きる
- 画面ID命名は `screen-{名前}`

## データ構造

```
kotobapair_rooms/{roomCode}/
  ├── host:               string          # ホストのニックネーム
  ├── hostConnected:      boolean
  ├── hostDisconnectedAt: number | null
  ├── status:             'waiting' | 'playing' | 'result'
  ├── packId:             string          # packs.js の id
  ├── mode:               'open'          # MVP は open 固定（クローズ=裏向きは将来拡張）
  ├── boardSeq:           number          # 作成=1。おかわり・パック替えごとに +1（世代ガード）
  ├── board/
  │    ├── order:         string[]        # 表示順のカードID配列（'c01'〜。長さ=12 or 16）
  │    └── cards/{cardId}/
  │         ├── text:     string          # カードに出す語
  │         ├── pairId:   string          # 'p{packs.js の pairs index}'
  │         ├── side:     'a' | 'b'       # ペアのどちら側か。allowCross パックの交差バナーは
  │         │                             #   side が異なる組（前半×後半）にだけ出す。同じ side
  │         │                             #   どうしの不一致は通常の「ちがうみたい」（2026-08-09 統合時の磨き込み）
  │         └── state:    'open' | 'matched'   # open モードでは初期値 open
  ├── turnOrder:          string[]        # シャッフル済みニックネーム配列。途中参加は末尾追加
  ├── turnIndex:          number
  ├── selected:           string[]        # 現在選択中のカードID（0〜2件）
  ├── moves:              number          # チームの「ためした かいすう」（2枚確定ごとに +1）
  ├── matchedPairs:       number
  ├── totalPairs:         number          # board.order.length / 2
  └── players/{nickname}/
       ├── isHost:        boolean
       └── joinedAt:      number          # RoomkRTDB.now()（サーバー時刻補正済み）
```

### RTDB の配列・null の注意

- RTDB は**空配列・null 値のフィールドを保存しない**（absent になる）。`selected` / `turnOrder` は読み取り時に必ず `|| []` を補う
- 選択の解除は `selected: null`（キー削除）で表現する
- **盤面はルーム作成時に作る**（`waiting` の時点で `board` が存在する）。枚数は `board.order.length` から導けるため `boardSize` フィールドは持たない
- 答えテキストの二重保持はしない。`note`（ひとことメモ）と `a` / `b` の原文は packs.js から `pairId` で引く（要件定義書 17.4）

## 特有のルール

### 手番

- `turnOrder` はニックネーム配列。現在の手番は `turnOrder[turnIndex]`（`turnIndex` は長さで正規化して読む）
- **ペアが成立してもしなくても手番は必ず次へ回す**（1人が連取して独走しないため）
- `nextTurnIndex()` は **`players` に居ない人（退出者）を飛ばす**。`turnOrder` からは名前を消さない（リロード復帰した人がそのまま元の位置に戻れる）
- 途中参加者は `turnOrder` 末尾に追加され、次の周から手番が回る
- 手番の人は「パスする」でいつでも次の人へ回せる。ペナルティなし・理由を聞く画面も出さない（`moves` も増やさない）

### 選択と判定の transaction（要件定義書 22.4）

書き込みはすべてルームルートへの `transaction()`。**2枚目の確定・成立判定・`moves` 加算・`turnIndex` 送りを1つの transaction にまとめ、中間状態を作らない。**

transaction 内の検証（この順に全部）:

1. `status === 'playing'`
2. `boardSeq` が操作開始時と一致（**世代ガード**。おかわり後に古い操作が届いても適用しない）
3. `turnOrder[turnIndex] === 自分のニックネーム`（**手番本人か**。UI 制御だけに頼らない）
4. 対象カードが未成立（`state !== 'matched'`）
5. `selected` が2件未満

分岐:

| 状況 | 書き込み |
|---|---|
| `selected` が0件 | `selected: [cardId]` |
| `selected` が1件・同じカードを再タップ | `selected: null`（**1枚目のえらびなおし**。おし間違いの救済） |
| `selected` が1件・`pairId` 一致 | 2枚を `state:'matched'`・`matchedPairs+1`・`moves+1`・`turnIndex` を次へ・`selected` は2枚のまま残す |
| `selected` が1件・`pairId` 不一致 | `moves+1`・`turnIndex` を次へ・`selected` は2枚のまま残す |
| 上記の成立で全ペアそろった | さらに `status:'result'`・`selected: null` |

- `selected` に2枚を残すのは、**判定の結果を全員の画面で2秒見せる**ため。この間は全員のカードが disabled になり、次の人はまだタップできない（自然なロック）
- 解除は**手番クライアントの `setTimeout`（`SELECTION_SHOW_MS = 2000`）**が transaction で行う。解除 transaction も `boardSeq` と `selected` の中身が一致するときだけ commit する（他の操作を上書きしない）
- 乱数（盤面シャッフル・手番シャッフル）は**必ず transaction コールバックの外**で確定させる。コールバックは複数回呼ばれうるため（esadori で確立）
- ローカルキャッシュ null 対策: リスナー未接続から実行しうる transaction（参加・復帰の書き戻し・期限切れ削除）は、事前 `get()` したスナップショットを `const cur = room || preRoom` で代用してサーバー照会を強制する（oshitsuke-zukan / esadori の確立パターン）

### ホストの watchdog（2種類・ホストクライアントのみ）

| watchdog | 発動条件 | 動作 |
|---|---|---|
| 選択の回収 | `selected` が2件のまま **5秒**（`SELECTION_WATCHDOG_MS`）変化しない | transaction で `selected: null`。**手番者が2枚目タップ直後に切断した場合の詰まり対策** |
| 手番送り | 手番の人が `players` から消えていて `selected` が2件未満の状態が **1.2秒**（`TURN_FIX_DELAY_MS`）続く | transaction で `selected: null` ＋ `turnIndex` を次へ。**手番中の退出対策** |

- どちらも「発動時点でまだ同じ状況か」を transaction 内で再検証してから書く（復帰・別操作と競合しても壊れない）
- 通常は手番クライアント側の2秒解除が先に効くため、watchdog はフォールバック
- 退出者を画面で名指ししない・強調表示しない（一覧から静かに消えるだけ）

### allowCross（交差許容ボード）の扱い

- パックの `allowCross: true` は「交差しても意味が通ってしまう」こと自体が話のタネになるボード（助詞・文パックを想定）
- 判定は **`allowCross` に関係なく「定義ペアのみ成立」**。変わるのは不一致時の文言だけ
  - `allowCross: false` → 「うーん、ちがうみたい」
  - `allowCross: true` → 「それも つながるかも！でも きょうの こたえは べつの くみあわせ」
- `allowCross: false` のパックは、同一ボードに載るペア群に「a札とb札の取り違えが可能な組み合わせ」があってはならない（ボード成立条件。要件定義書 9.1）

### ホスト操作帯（ホストにのみ表示・折りたたみ）

| 操作 | 動作 |
|---|---|
| つぎの人へ | 手番の強制送り。`selected` を解除して `turnIndex` を次へ |
| 1組そろえて見せる | 未成立ペアを1組そろえる（詰まり救済）。**`moves` は増やさず、手番も動かさない**（手番送りは上のボタンが担うため、2つの機能を重ねない）。これで全ペアそろえば `result` へ |
| ここまでにする | 途中でも `result` へ。結果画面は「ここまでの記録」を普通の結果として表示する |

### 学習感を強くしない工夫（変更禁止の設計）

- タイマーなし・効果音なし・正誤の「×」表示なし
- **個人の得点・取り枚数を数えない。** 記録はチームの `moves`（「ためした かいすう」）だけ
- ひとことメモ（`note`）は成立時に**1行だけ**表示し、解説モードにしない
- 「勉強」「問題」「正解／不正解」という語を子ども向け画面で使わない（「こたえ」「ちがうみたい」等に言い換える）
- レベルバッジ（Lv.1〜3）とテーマ分類は**ホストのルーム作成画面にだけ**描画する。子どもの画面にはパック名しか出さない
- 「そうだんOK」をゲーム画面に常時小さく表示し、声・チャットの相談を公式ルールにする

### アクセシビリティ

- カードは `<button>`。`aria-label` に「①ばん 大きい」の形で番号と語を入れる（画面共有越しに「①と⑤！」と番号で言えるように）
- 成立の表示は**色だけに頼らない**（枠線の太さ・二重線 ＋ `link` アイコン ＋ 文字色）
- タップターゲットは44px以上（カードは最小76px、ボタンは `.btn` の min-height 44px）
- `prefers-reduced-motion: reduce` でポップイン演出とトランジションを無効化する
- カードの語は20px以上（Chromebook の縮小画面でも読める大きさ）

## 接続・切断・再接続

| 役割 | onDisconnect 予約 |
|---|---|
| ホスト | `roomRef.onDisconnect().update({ hostConnected: false, hostDisconnectedAt: TIMESTAMP })`。**`remove()` は使わない**（リロード復帰と両立しないため） |
| ゲスト | `players/{nick}` への `onDisconnect().remove()` |

- ホスト切断時、ゲストにはオーバーレイ「ホストの もどりを まっています」を出し、`ORPHAN_TTL_MS = 2 * 60 * 1000`（2分）超過で期限切れ扱い → 次アクセス時に削除
- TTL 判定は `RoomkRTDB.now()` / `isRoomExpired()`（`.info/serverTimeOffset` 補正）で行う
- **ゴースト room 対策**: `status` を持たない room は TTL を待たず期限切れ扱いにして掃除する
- 期限切れ削除は transaction で行う（判定と削除の間にホストが復帰した場合、生きているルームを消さない）
- ホスト復帰時は `hostConnected: true` / `hostDisconnectedAt: null` に戻し、`onDisconnect` 予約を張り直す
- リロード復帰は sessionStorage **`kotobapair_session`**（`roomCode` / `nickname` / `role`）。`tryReconnect()` が **transaction で** `players/{自分}` を書き戻す（削除済みルームを `update()` で再生成しないため）。`playing` 中の復帰では `turnOrder` に自分が居なければ末尾に足す
- 通信の一時断は RTDB SDK の自動再接続に任せる。描画は毎スナップショットから冪等に作り直すため自己修復する

## 終了とデータ削除

- クリーンアップ経路は3つ: ①ホストの「おわる」で即時 `remove()` ②ホスト切断 onDisconnect + 2分 TTL ③次回アクセス時（参加・復帰・ルーム監視）の期限切れ判定
- **すべての退出・削除経路で、`remove()` の前に必ず `RoomkRTDB.cancelRoomOnDisconnect()` を await する**（削除後の実切断でゴースト room が再生成されるのを防ぐ）
- ゲストの「おわる」「ぬける」は自分の `players/{nick}` 削除のみ
- ルーム値が `null` になったら（ホストが削除）、`leaveCleanup()`（リスナー off・全タイマー clear・onDisconnect 取消）→「ルームが とじられたよ」→ TOP へ

## 共通規約からの意図的な逸脱

### 1. `packs.js` を外部ファイルに分離（単一ファイル規約からの逸脱）

- RTDB アプリは「`index.html` のみ（CSS・JS インライン）」が共通規約だが、**学習コンテンツパックだけは `packs.js` に分離する**
- 理由: パックは件数が伸びる前提（1パック12ペア以上 × 複数パック）で、本体と混ぜると差分レビューが読めなくなる。先行実績は quiz `questions.js`・ことば探偵 `words.js`（要件定義書 11.1）
- `window.KotobaPairPacks` にグローバル登録する通常スクリプト。`rtdb-utils.js` の後・本体インラインスクリプトの前に読み込む
- 破壊的にスキーマを変える場合は `?v=` 付き読み込みに切り替える

### 2. `result` 画面に滞在中はルームを自動削除しない

- ルート規約「ゲーム終了30秒後に自動削除」からの意図的例外。**たとえならべ・人狼・エサドリと同じ方式**
- 理由: 結果を見ながらのふりかえりと「もういちど あそぶ」「パックを かえて あそぶ」を許可するため
- 削除は「おわる」（ホスト）またはホスト切断＋2分TTLに任せる

### 3. ホスト操作帯に枠線ボタンが2つ並ぶ

- 「1画面1主ボタン」の定石は子どもが見る領域に適用する。ホスト操作帯はメンター専用の折りたたみ式ユーティリティで、`btn-secondary` 2つ＋弱ボタン（`.kp-quiet-btn`）1つの構成にとどめている（同格の枠線ボタン3つ以上は作らない）
- ゲーム画面の子ども向け領域にある `.btn` は「パスする」（`btn-secondary`）1つだけ。この画面の主操作はカードのタップであり、主ボタンは置かない

### 4. 1枚目のカードを押し直して選び直せる

- 要件定義書には無い挙動。おし間違いで手番を消費させないための救済。2枚目を確定した後は取り消せない（判定が同一 transaction で確定するため）

## パックの追加方法

`apps/kotoba-pair/packs.js` の `window.KotobaPairPacks` 配列に1オブジェクト足す。**現在入っているのは仮データ1本（8ペア）で、正式パックは統合時に差し替える前提。**

```js
{
  id: 'hantai-1',       // 英数字とハイフン。stats の pack-{id} に使う（変えるとカウントが分断される）
  title: 'はんたいことば', // 子どもに見える名前。ホストの選択画面と盤面上部に出る
  theme: 'goi',         // goi(語彙) | joshi(助詞) | bun(文) | setsumei(説明) | kimochi(感情)
  level: 1,             // 1〜3。バッジはホストのルーム作成画面にだけ出る
  boardSize: 16,        // 推奨カード枚数（12 | 16）。ホストは作成画面で変更できる
  allowCross: false,    // 交差許容ボードか（上記「allowCross の扱い」参照）
  pairs: [
    { a: '大きい', b: '小さい', note: '大きさの はんたい' },
    // ... 正式パックは1本あたり12ペア以上（= 2ボード分）
  ],
}
```

制約・運用:

- **`pairs` が6組未満のパックは読み込み時に除外される**（12枚ボードすら作れないため）。8組未満のパックでは「16まい」が選べなくなる
- `note` は「つながる理由」を子どもの言葉で1行。解説にしない（1行を超えない）
- コンテンツガイドライン厳守: 学校・勉強・宿題・テスト・成績／出席・登校／恋愛／暴力・ホラーを連想させる語を入れない
- ペアを足したら `node scripts/content-audit.mjs` で重複を確認する。`allowCross: false` のパックは a×b の総当たりで「交差しても意味が通る組み合わせ」が無いか人力でも確認する
- パックを足したら `apps/updates.json` に1行追記する（既存規約）

## メンター向けの心得

- **記録は参考情報であり、テスト結果ではない。** 「ためした かいすう」はチームの記録として出しているだけで、語彙力・理解度の指標として扱わない。少ない回数を目標にしたり、前回と比べたりしない
- **結果画面を外部に共有するときはニックネームに配慮する。** 結果画面自体に個人名は出ないが、画面共有・スクリーンショットには待機画面や参加者一覧が写り込みうる。共有する必要があるときは参加者一覧が映らない状態にする
- **相談を促す声かけを用意しておく。** このゲームの本体は「なんでつながると思ったの？」という理由の言語化。答えが出たあとに一度だけ聞くと、理由を言葉にする練習になる。答えられなくても流してよい
- 詰まったら「1組そろえて見せる」を早めに使ってよい。回数は増えないので、記録を気にせず場を動かせる
- 声を出さない子には「①と⑤、あやしくない？」のように**番号でチャットに書く**参加の仕方を最初に見せる。盤面を見て考えるだけでも参加になっている
- 誤ったペアは笑いのタネになる設計。「『こうえんで』と『あらう』！」のような偶然の組み合わせは、訂正せずに一緒に面白がってよい
- 手番の人が長く固まっていたら、指名や催促ではなく「パスもできるよ」と選択肢を1つ示す。ホストの「つぎの人へ」で静かに送ってもよい
- 途中で抜けた子の手番は自動で飛ぶ。画面に離脱の表示は出ないので、必要なら口頭で「また来たら入ってね」とだけ言えばよい
- 1ボードが終わったらパックを替えて2〜3ボード回すのが標準。同じパックで続けると別のペアが出る（ボードごとにランダム抽出）

# かくれナンバー 仕様書

## 目的・使用シーン

コヨーテ風の「自分の数字だけ見えない」推理ゲームを、脱落なし・全員同時参加のポイント制にアレンジしたオンラインゲーム。
各ゲストの画面には他の全員のニックネームと数字が見え、**自分の数字だけ「？」で表示**される。
「ぼくの数字、大きい？」のように声やチャットで探り合いながら、全員の数字の合計（自分の？も含む）を予想する。

- **core value**: 「自分にだけ見えない情報」というオンライン＋各自端末ならではの体験。この駆け引き（声での探り合い）がゲームの本体で、画面はその補助。
- 対象: 小学校中学年〜中学生。メンターがホスト（ファシリテーター）としてルームを作り、画面共有しながら進行する。
- ホストは数字を配られず、推理にも参加しない。ゲスト3〜8人で遊ぶ。

> 原作「コヨーテ」にインスパイアされた派生ルール。脱落・ライフ制をなくし、
> 「いちばん近い予想」を称えるポイント制に変更している。

## 技術スタック

```
apps/kakure-number/
├── AGENTS.md    # この仕様書
└── index.html   # 単一ファイルで完結（CSS・JS インライン）
```

- Firebase compat SDK **10.14.1**（app / auth / database）+ 匿名認証
- 共有ヘルパー `../shared/js/rtdb-utils.js`（`RoomkRTDB.initServerTime` / `now` / `isRoomExpired` / `generateRoomCode`）
- `../shared/css/design-system.css` のトークン・`btn` クラスを再利用
- CSS 接頭辞: **`kkn-`**（BEM）。画面切替は共通パターンの `.screen` / `.active`
- アイコンは Material Symbols Rounded（絵文字不使用）
- viewport は `maximum-scale=1`（RTDB アプリ共通ルール）

## 画面構成・フロー

```
TOP（screen-top）
 ├── ホスト → ニックネーム入力 → ルーム作成・待機（screen-host-setup）
 └── ゲスト → ニックネーム＋コード入力 → 待機（screen-waiting）
                     ↓（ホストが「はじめる」/ ゲスト3人以上）
           予想タイム（screen-thinking）
             ゲスト: 他の全員の数字が見える。自分だけ「？」。
                     合計をステッパーで入力 →「きめた」
             ホスト: 提出状況のみ表示（数字・合計は一切出さない）
                     全員提出で自動遷移 / 「しめきる」で強制遷移
                     ↓
           こたえあわせ（screen-reveal）
             全員の数字・本当の合計・各自の予想・得点を一覧表示
             ホスト: 「つぎへ」（数字を配り直して thinking へ）/「おわる」
                     ↓
           おしまい（screen-done）
             累計ポイントを控えめに表示。30秒後にルーム自動削除
```

- ラウンド数の上限はなし。ホストが「おわる」を押すまで繰り返す。
- 予想入力はタブレット向けの大きめステッパー（−／＋ボタン 64px + 数値直接入力、`inputmode="numeric"`）。
- 予想値は理論上の合計範囲 **人数×1 〜 人数×10** でバリデーション（範囲は配った時点の人数で固定し `round/minSum` `round/maxSum` に保存）。
- 参加は `waiting` 中のみ。ゲーム開始後は「同じニックネームでの再入室（復帰）」のみ受け付ける。

## status 遷移

```
waiting → thinking → reveal → thinking（次ラウンド）…
                        └→ done（30秒後にルーム削除）
```

| status | 説明 |
|--------|------|
| `waiting` | ロビー。このフェーズのみ新規入室可。ゲスト3〜8人 |
| `thinking` | 数字を配布済み。ゲストが合計を予想して提出する時間（＝声での探り合いタイム） |
| `reveal` | 全数字・本当の合計・予想・得点を一斉公開 |
| `done` | 終了。累計ポイント表示。ホストが30秒後に `roomRef.remove()` |

- `status` の更新はホストのみ（UIで制御）。
- `waiting → thinking` と `reveal → thinking` は同じ `hostStartRound()` の `transaction()` で行い、その時点のゲスト一覧に 1〜10 のランダムな数字（重複あり）を配る。
- `thinking → reveal` は「配布済みかつ在室中のゲスト全員が提出」でホスト端末が自動実行。未提出者がいても、予想が1件以上あればホストが「しめきる」で強制遷移できる。

## Firebase データ構造（Realtime Database）

パス: `kakure_rooms/{roomCode}/`（共通命名規則 `{appname}_rooms` に準拠。セキュリティルール変更不要）

```
kakure_rooms/{roomCode}/
  ├── host:                string          # ホストのニックネーム
  ├── hostConnected:       boolean         # 切断検知用
  ├── hostDisconnectedAt:  number | null   # 切断時のサーバータイムスタンプ（ms）
  ├── status:              string          # waiting | thinking | reveal | done
  ├── players/
  │    └── {nickname}/
  │         ├── isHost: boolean
  │         └── score:  number             # 累計ポイント（ホストは常に0で加点対象外）
  └── round/                               # 現在のラウンド（配り直しで丸ごと上書き）
       ├── number:      number             # 1始まり
       ├── numbers:     { [nickname]: 1〜10 }  # 配った数字。配布時点で固定
       ├── total:       number             # 本当の合計。配布時点で固定
       ├── minSum:      number             # 予想の下限（配布人数×1）
       ├── maxSum:      number             # 予想の上限（配布人数×10）
       ├── guesses:     { [nickname]: number } | null  # 各ゲストの予想
       └── scoreDeltas: { [nickname]: number } | null  # reveal 確定時の加点（+2 / +3）
```

### データ操作の注意点

- **ルーム作成・参加・ラウンド開始**はすべてルームルートへの `transaction()`。参加時は `status === 'waiting'`・ニックネーム重複・ゲスト上限8人のチェックと `players` 追加を同一 transaction 内で行う
- **数字の配布**も `hostStartRound()` の transaction 内で行う（その時点の `players` からゲストを列挙して `numbers` / `total` / `minSum` / `maxSum` を確定）
- **予想の提出**は各ゲストが `round/guesses/{nickname}` に `set()` するだけ（キーが分かれるので競合なし）
- **reveal への遷移と加点**はホスト端末が `update()` で一括書き込み（`status` + `round/scoreDeltas` + `players/*/score`）。二重集計はホストローカルの `revealTriggered` フラグで防止

## 切断時の挙動

| 役割 | 挙動 |
|------|------|
| ホスト切断 | `onDisconnect().update({ hostConnected: false, hostDisconnectedAt: ServerValue.TIMESTAMP })`。ゲストにはカウントダウン付きオーバーレイを表示し、TTL（`ORPHAN_TTL_MS = 2分`）超過で期限切れ扱い→ルーム削除を試みて退出 |
| ゲスト切断 | `onDisconnect().remove()` で `players/{nickname}` のみ削除 |

- TTL 判定は `RoomkRTDB.initServerTime(db)` + `RoomkRTDB.now()` / `RoomkRTDB.isRoomExpired()` でサーバー時刻寄りに補正。
- `joinRoom` / `tryReconnect` / ルーム監視の各タイミングで期限切れルームを検知したら `remove()` を試みる。
- 再接続: sessionStorage キー **`kakure_session`**（nickname / roomCode / role / score）。リロード時に `tryReconnect()` で復帰。ホストは `hostConnected: true` / `hostDisconnectedAt: null` を書き戻す。ゲストは `players/{nickname}` が消えていれば保存済みスコアで再追加する。

### ラウンド途中でゲストが抜けた場合の方針（明文化）

- **合計は配った時点の数字で固定**する。`round/numbers` と `round/total` はゲストの退出では変更しない（退出者の数字も合計に含まれたまま）。予想範囲 `minSum` / `maxSum` も配布時点のまま固定。
- 退出者の `players/{nickname}` は消えるが、`round/numbers/{nickname}` は残るため、他のゲストの画面には退出者の数字が引き続き表示される（reveal では「（退出）」表示）。
- **自動 reveal の判定**は「配布済みかつ在室中のゲスト」だけを対象にする（退出者の提出は待たない）。
- **得点計算**からは、reveal 確定時点で `players` にいないゲストの予想を除外する。
- 退出者が同じニックネームで再入室すれば復帰扱いになり、配られていた数字・提出済みの予想はそのまま有効。

## 得点ルール

各ラウンドの reveal 時に確定:

- 本当の合計に**いちばん近い**予想をした人: **+2点**（同着は全員 +2）
- **ぴったり**（差0）はさらに **+1点**（計 +3点）
- それ以外は加点なし（減点なし・脱落なし）

累計スコアは reveal / done 画面で小さなチップ表示のみ。**順位づけ・並べ替え・優勝表示はしない**（表示順はニックネーム順で固定）。ホストは加点対象外。

## 共通規約からの逸脱の明文化

- **最終結果で順位・優勝者を表示しない**: do-mannaka 等の対戦系と異なり、winner ブロック・ランキングを意図的に置かない。「いちばん近い」をラウンド内で軽く称えるにとどめ、累計は控えめなチップ表示のみ（比較を促さないコンテンツガイドラインに寄せた設計）。
- **ホストはプレイヤーだが数字を持たない**: `players/{host}` は存在する（プレイヤーリスト表示・isHost 判定用）が、`round/numbers` には含めない。ホスト画面には thinking 中、数字・合計を一切表示しない（ホスト画面は画面共有されうるため。提出状況のみ表示）。
- **秘密情報（自分の数字）は UI レベルの非表示のみ**: RTDB の構造上、自分の数字も端末に届いている。DevTools で見ようと思えば見えるが、共通のセキュリティ方針（性善説・スタッフ監視下での使用）どおり許容する。
- **ゲスト上限あり（8人）**: 数字カードの一覧性と1〜10×人数の予想レンジが破綻しない範囲として、参加 transaction でゲスト9人目以降を弾く。
- それ以外（transaction・onDisconnect・TTL 2分・30秒後削除・sessionStorage 再接続・esc() による XSS 対策・6桁ルームコード・ニックネーム8文字）は共通規約どおり。

## メンター向け進行のコツ

- このゲームの本体は画面ではなく**声の探り合い**。thinking 中は「『わたしの数字、大きい？』って聞いていいよ」「ウソはなし？あり？はみんなで決めよう」と最初に促すと動き出しやすい。
- 数字についてのやりとりは正直に答えても、あいまいに答えてもよい（「ウソあり」にするかはグループで合意を取ると盛り上がる）。
- ホスト画面は数字が出ないので、そのまま画面共有してよい。こたえあわせ（reveal）は全員に公開される前提の画面。
- 予想が出ない子がいても「しめきる」で先に進める（未提出は「よそうなし」表示になるだけで、責める演出はない）。
- 1ラウンドは2〜4分程度。5〜8ラウンドで20分前後が目安。
- 終わるときは reveal 画面で「おわる」→ おしまい画面が出て30秒後にルームは自動で消える。

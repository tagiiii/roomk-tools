# かぶらずヒント 仕様書

## 目的・使用シーン
1人の回答者にお題を当ててもらうため、他の全員が1語ずつヒントを出す協力型ワードゲーム。
ただしヒントが被ると消えてしまうので、他の人と被らない表現を考える必要がある。
メンターが画面共有しながら若者と一緒にプレイする。

> 原作「Just One」にインスパイアされた派生ルールのオンライン版。
> 名称・演出・ルール細部をオリジナルに変更している。

## ファイル構成
```
apps/kaburazu-hint/
├── AGENTS.md    # この仕様書
└── index.html   # 単一ファイルで完結（Firebase Realtime Database 使用）
```

## 画面フロー
```
TOP（screen-top）
 ├── ホスト → ニックネーム入力 → ルーム作成・待機（screen-waiting）
 └── ゲスト → ニックネーム＋コード入力 → 待機（screen-waiting）
                     ↓（ホストが「ゲーム開始」/ 3人以上必要）
           ヒント入力（screen-clue）
             回答者以外: お題表示 + ヒント1語入力
             回答者: 待機アニメーション
                     ↓（全員提出完了で自動遷移）
           ヒント確認（screen-review）
             ホスト: 重複ハイライト済みリスト → 手動で追加除外も可 → 確定
             他: 待機
                     ↓（ホストが「ヒントを見せる」）
           回答（screen-answer）
             回答者: 残ったヒント表示 + 回答入力 or パス
             他: 見守り
                     ↓（回答者が送信 or パス）
           ジャッジ（screen-judge）
             ホスト: 正解 / 不正解 ボタン
             他: 待機（パスの場合はスキップして自動不正解）
                     ↓
           ラウンド結果（screen-result）
             お題・回答・正解/不正解を全員に表示
             ホスト: 「次のラウンド」or「ゲーム終了」
                     ↓
           最終結果（screen-final）
             全ラウンドの振り返り一覧 + 正解数サマリー
```

## 観戦専用ビュー（みんなにみせる画面）

ホストはヒント役・判定役でお題（secretWord）が画面に出るため、ホスト画面を画面共有できない。
ホストが別ウィンドウで観戦ビュー（`#screen-spectator`）を開き、それを Metalife で共有する。
観戦画面は回答者本人も見るため、**回答者が見てよい情報だけ** を表示する（回答者セーフ原則）。

### 画面フロー
```
TOP
 └── 「みんなにみせる画面をひらく」（btn-ghost）
       → コード入力（screen-spectate-join）→「画面をひらく」
       → 観戦画面（screen-spectator）: room.status に応じてサブビューを innerHTML 全置き換えで描画
```

### 入口（3つ）
1. **URL パラメータ `?watch=CODE`**（最優先）: 起動時に検証（trim・大文字化・6桁・`generateRoomCode` の文字集合）して観戦入室。無効・不存在なら sessionStorage へフォールバック**せず**トースト + TOP。`?watch=`（空値）も同扱い。watch が無い場合のみ sessionStorage を見る
2. **TOP 画面**: 「みんなにみせる画面をひらく」→ コード入力 → 入室成功後 `history.replaceState` で URL を `?watch=CODE` に更新（リロード復帰の安定化）
3. **ホスト待機画面**: ホストコントロール内の「みんなにみせる画面をひらく」。クリックハンドラ内で同期的に `window.open(url, '_blank', 'noopener')`（ポップアップブロック回避・noopener 必須）

### アーキテクチャ: 完全分岐
- `state.role === 'spectator'`。ルーム購読コールバックの入口で `handleSpectator(room)` へ完全分岐し、
  host/guest のコードパス（切断処理・status switch・各 handleX・自動進行）には一切入らない
- 観戦者が絶対に入らない処理: onDisconnect 予約 / players への読み書き / 期限切れルームの remove() /
  finished 30秒後の自動削除 / ホスト自動進行（autoTransitionToReview・answer 検知・host 復帰）/
  leaveGame の roomRef.remove()・players remove 分岐

### RTDB: 書き込みゼロ
観戦者は RTDB に一切書き込まない。players/ にも spectators/ にも入れない。純粋な read-only リスナーのみ。
匿名認証は必要（ルールが `auth != null`）なので `waitAuthOrExplain()` を通す。

### フェーズ別表示（回答者セーフ原則）
**secretWord を DOM に書くのは result / finished サブビューのみ。**
document.title・トースト・aria-label にお題を入れない。ニックネーム・ヒント・回答の描画は必ず `esc()` を通す。
未知の status は「じゅんびしています…」の安全な待機表示にフォールバック。

| status | 表示 | 出さないもの |
|--------|------|------------|
| waiting | ルームコード大表示 + プレイヤー一覧 + 待機メッセージ | — |
| clue-input | ラウンド情報 + スピナー + 提出カウンター「n / m 人が送信済み」 | お題・ヒント本文 |
| clue-review | ラウンド情報 + 「ホストがヒントを確認しています」 | ヒント本文・件数内訳 |
| answer | ラウンド情報 + 見えているヒント一覧 + 「（回答者名）さんが答えを考えています」 | お題・除外ヒント |
| judge | 回答者の回答 + 「ホストが答えを確認しています」 | お題 |
| result | お題・回答・正解/不正解 + 見えていたヒント一覧 + 正解数/ラウンド数 | 除外されたヒントと「誰のヒントが消えたか」（共有画面で個人が強調されるのを避ける） |
| finished | 全ラウンド振り返り + スコアサマリー。「TOPにもどる」のみ | 操作ボタン |

### セッション・復帰
- 入室成功後に `kaburazuhint_session` へ `{ nickname: null, roomCode, role: 'spectator' }` を保存
- **watch 入口では起動時に既存セッションを破棄**（`clearSession()`）: 無効な `?watch` だったとき、
  次のリロードで別ルームの host/guest セッションが復活しないように
- `tryReconnect()` の spectator 分岐: ルーム存在 + `isRoomExpired` チェックのみ（players 存在チェックはスキップ）。
  期限切れでも remove() しない。復帰後も onDisconnect 予約はしない
- 「TOPにもどる」（`spectatorLeave()`）: リスナー off() → セッション削除 → `history.replaceState` で
  watch パラメータ除去 → ローカルタイマー解除 → TOP。ルームには一切触らない
- 入室処理（`enterSpectator`）は `specJoinBusy` フラグで多重実行を防ぐ（連打による多重リスナー登録防止）

### 切断・終了の扱い（観戦者版）
- `room.hostConnected === false`: 観戦専用オーバーレイ `#spec-host-off-overlay`（退出ボタンは「TOPにもどる」動作）。
  TTL（`ORPHAN_TTL_MS`）経過後は remove() **せず**「このルームは終了しました」表示に切り替え。
  RTDB 更新が来なくてもローカルタイマー（`state.specTimer`）で TTL 到達を再判定する（leave 時に必ず clearTimeout）
- finished 表示中はホスト切断オーバーレイ・TTL 切り替えの対象外（最終結果の共有画面を維持する）
- ルーム snapshot が null（削除済み）: finished サブビューを表示済みならその画面を**そのまま維持**
  （画面共有が突然空にならないように）。それ以外は「このルームは終了しました」表示
- **終了状態（snapshot null・TTL 超過）では `stopSpectatorWatch()` で購読とタイマーを解除**し、表示だけ維持する。
  リスナーを残すと、同じルームコードが将来再利用されたとき別ゲームを映してしまうため

### 更新順序への依存（変更禁止）
- `nextRound()` / `playAgain()` は単一 transaction で secretWord と status を同時更新している
- `confirmHints()` は excludedHintIds 書き込み → `status:'answer'` の順
- **この順序・原子性が観戦ビューの漏洩防止の前提**。これらの関数の更新順序を変えないこと

## ゲームルール

### 基本ルール
1. 毎ラウンド、回答者が1人選ばれる（ゲーム開始時に確定した `turnOrder` で自動ローテーション）
2. ランダムにお題（1単語）が選ばれ、回答者以外の全員に表示される
3. 回答者以外の全員が、お題を連想させるヒントを **1語だけ** 入力する
4. 全員の提出後、**正規化して一致するヒントは重複として除外** される
5. 残ったヒントだけが回答者に表示され、回答者はお題を推測する
6. 回答者は「パス」も可能（パスは不正解扱い）
7. ホストが正解/不正解を判定する
8. 全員が1回ずつ回答者を務めたらゲーム終了

### 参加制御
- **`waiting` 中のみ入室可**。`clue-input` 以降は参加不可
- 参加時にルームの `status` を確認し、`waiting` 以外なら「ゲーム中のため参加できません」エラーを表示

### 回答順の確定
- ゲーム開始時に `turnOrder`（ニックネーム配列）を `transaction()` で確定する
- 順序はシャッフルして決定（ホストも含む）
- 途中離脱があっても `turnOrder` は変更しない（離脱者のラウンドはスキップ）

### 重複判定（正規化ルール）
以下の順で正規化し、**完全一致** するヒント同士を重複とみなす。

1. **全角英数 → 半角** に変換
2. **カタカナ → ひらがな** に変換
3. **小書き文字を通常文字に統一**（ぁ→あ、ぃ→い、っ→つ 等）
4. **長音符「ー」を除去**
5. **空白・句読点を除去**
6. **大文字 → 小文字**（英字）

例: 「ネコ」「ねこ」「ﾈｺ」→ すべて `ねこ` に正規化 → 重複

### 得点
- チーム全体で「正解数 / 全ラウンド数」を記録
- 個人スコアはなし（協力ゲームのため）

### 最少人数
- **3人以上**（回答者1人 + ヒント出し2人以上で被りが発生しうる）

## status 遷移
```
waiting → clue-input → clue-review → answer → judge → result
                                                         ↓
                                              次ラウンド: clue-input
                                              全ラウンド終了: finished
```

| status | 説明 |
|--------|------|
| `waiting` | ロビー。プレイヤー参加待ち。このフェーズのみ入室可 |
| `clue-input` | ヒント入力中。回答者以外が1語ずつ入力 |
| `clue-review` | ホストが重複確認・除外を確定 |
| `answer` | 回答者がヒントを見て回答入力 |
| `judge` | ホストが正解/不正解を判定 |
| `result` | ラウンド結果表示 |
| `finished` | 全ラウンド終了・最終結果 |

## Firebase データ構造（Realtime Database）
```
kaburazuhint_rooms/{roomCode}/
  ├── host:                string          # ホストのニックネーム
  ├── hostConnected:       boolean         # 切断検知用
  ├── hostDisconnectedAt:  number | null   # 切断時のタイムスタンプ（ms）
  ├── status:              string          # 上記 status 参照
  ├── players/
  │    └── {nickname}/
  │         └── isHost:  boolean
  ├── turnOrder:           string[]        # ゲーム開始時に確定した回答順（シャッフル済み）
  ├── round/
  │    ├── number:         number          # 現在のラウンド（1始まり）
  │    ├── totalRounds:    number          # 全ラウンド数（= turnOrder.length）
  │    ├── guesser:        string          # 今ラウンドの回答者ニックネーム
  │    ├── secretWord:     string          # お題
  │    ├── hints/
  │    │    └── {nickname}/
  │    │         ├── text:       string        # 入力されたヒント原文
  │    │         └── normalized: string        # 正規化後の文字列
  │    ├── excludedHintIds: string[]       # 除外するニックネームの配列（重複自動検出 + ホスト手動追加 + 未提出者）
  │    ├── missingHintIds:  string[]       # ホスト締切時に未提出だった人の配列（review 画面でバッジ表示用）
  │    ├── answer:         string | null   # 回答者の回答（パス時は null）
  │    ├── passed:         boolean         # パスしたか
  │    └── isCorrect:      boolean | null  # ホストの判定結果
  ├── usedWords:           number[]        # 使用済みお題インデックス
  └── history/
       └── {roundNumber}/
            ├── guesser:         string
            ├── secretWord:      string
            ├── hints:           { [nickname]: string }       # ニックネーム → ヒント原文
            ├── normalizedHints: { [nickname]: string }       # ニックネーム → 正規化後
            ├── visibleHints:    { [nickname]: string }       # 除外されなかったヒント原文
            ├── answer:          string | null
            ├── passed:          boolean
            └── isCorrect:       boolean
```

### データ操作の注意点
- **ルーム作成・参加**: `transaction()` で競合を防ぐ
- **ゲーム開始**: `transaction()` で `turnOrder` を確定し、`status` を `clue-input` に遷移
- **ヒント提出**: 各プレイヤーが `round/hints/{nickname}` に `set()` するだけ（競合なし）
- **重複判定・除外確定**: ホスト端末で全ヒントを読み取り → 正規化で重複検出 → `excludedHintIds` を `update()` で書き込む。ホストは画面上でさらに手動トグルして追加除外も可能
- **ヒント締切（ホスト救済）**: 1人でも提出しない参加者がいても進行を止めないよう、ホストは `screen-clue` の「ヒントを締め切って確認へ」ボタンで強制的に `clue-review` に遷移できる。未提出者は `missingHintIds` に記録され、review 画面ではホストにのみ「未提出」バッジ付きで表示される（ゲスト側には可視化しない）。提出が1件以上あることが条件
- **回答者に secretWord を見せない**: UI レベルで制御（回答者の画面にはヒントのみ表示）
- **参加制限**: `transaction()` 内で `status === 'waiting'` を確認し、ゲーム中は参加を拒否

## 切断・再接続

### 切断時の挙動
| 役割 | 挙動 |
|------|------|
| ホスト切断 | `hostConnected` を `false`、`hostDisconnectedAt` を `ServerValue.TIMESTAMP` にセット。ゲストはオーバーレイ表示 |
| ゲスト切断 | `onDisconnect().remove()` でそのプレイヤーデータのみ削除 |

### ホスト切断のセットアップ
```js
// ルーム作成時に onDisconnect フックを設定
roomRef.child('hostConnected').onDisconnect().set(false);
roomRef.child('hostDisconnectedAt').onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);
```

### ゲスト側のオーバーレイ
```js
// hostConnected を監視
roomRef.on('value', snap => {
  const room = snap.val();
  if (state.role === 'guest') {
    showOverlay('host-off-overlay', room.hostConnected === false);
  }
});
```

### sessionStorage による再接続
```js
// 保存（ルーム作成・参加時）
sessionStorage.setItem('kaburazuhint_session', JSON.stringify({
  roomCode: state.roomCode,
  nickname: state.nickname,
  isHost: state.role === 'host'
}));

// 復元（window.load 時）
window.addEventListener('load', async () => {
  if (!await tryReconnect()) showScreen('top');
});

// tryReconnect(): ルームが存在し、自分のプレイヤーデータがあれば復帰
// ホストの場合は hostConnected を true に戻す

// TOPに戻るときにクリア
sessionStorage.removeItem('kaburazuhint_session');
```

### 離脱者のラウンドスキップ
- `turnOrder` は固定のため、離脱者のターンが来た場合はそのラウンドをスキップする
- ラウンド開始時に `players/` 内に guesser が存在するか確認 → 不在なら次のラウンドへ自動進行

## お題リスト

お題は具体的な名詞を中心に、以下のカテゴリから 120 語を用意する。
ゲーム開始時にシャッフルし、`usedWords` で使用済みインデックスをトラッキングする。

### カテゴリ
- **食べ物**: カレー、ラーメン、すし、ピザ、たこやき、アイスクリーム、おにぎり、パンケーキ、チョコレート、ポテトチップス …
- **動物**: いぬ、ねこ、パンダ、ペンギン、きりん、イルカ、カメレオン、ハムスター、フクロウ …
- **場所・建物**: ゆうえんち、どうぶつえん、すいぞくかん、コンビニ、えいがかん、おんせん、プール、としょかん …
- **自然・天気**: にじ、かみなり、たいよう、ゆき、さくら、うみ、かざん …
- **モノ・道具**: じてんしゃ、かさ、めがね、リュック、まくら、おふろ …
- **乗り物**: しんかんせん、ひこうき、パトカー、ヘリコプター、ロケット …
- **キャラ・行事**: サンタクロース、おばけ、ロボット、にんじゃ、クリスマス、ハロウィン、おまつり …
- **音・オノマトペ / 和のことば / スポーツ・あそび**: ざあざあ、たたみ、なわとびなど Phase 4 / CX-5 で30語追加

現在は全120語。Realtime Database 単一ファイル規約により、`WORDS` は `index.html` 内のインライン配列を維持する。

### お題選定ガイドライン（AGENTS.md 共通のコンテンツガイドラインに準拠）
- 小学校中学年〜中学生が知っている具体名詞
- 学校・勉強・テストを連想させるものは除外
- 恋愛・暴力・ホラー系は除外
- ヒントが出しやすい（連想しやすい）ものを優先

## UI / デザイン

### CSS 接頭辞
`.kbz-`（kaburazu-hint の略）

### 画面ごとの主要 UI

#### screen-top
- アイコン: `lightbulb` (Material Symbols)
- タイトル: かぶらずヒント
- サブタイトル: 「ヒントを出してお題を当てよう！ でも被ったら消えちゃう！」
- ボタン: ルームをつくる / ルームに参加する

#### screen-waiting
- ルームコード表示（大きく・コピー可）
- プレイヤーリスト
- 「3人以上で開始できます」の注記
- ゲーム開始ボタン（ホストのみ）

#### screen-clue（ヒント入力）
- **回答者以外**: お題を大きく表示 + 1語入力フォーム + 「ヒントを送る」ボタン
  - 送信後は「他のみんなを待っています…」表示
  - 提出済み人数 / 全ヒント出し人数 のカウンター
- **回答者**: 「みんながヒントを考えています」+ スピナー + 提出済みカウンター

#### screen-review（ヒント確認 / ホストのみ操作）
- 全ヒントをカード形式で一覧表示
- 重複ヒントは赤枠 + 取り消し線で視覚的に強調（自動検出）
- ホストはヒントごとに「表示 / 非表示」を手動でトグルできる
- 「ヒントを見せる」確定ボタン（`excludedHintIds` を書き込む）
- ゲスト: 「ホストがヒントを確認しています…」待機画面

#### screen-answer（回答）
- **回答者**: 残ったヒントをカード形式で表示 + 回答入力フォーム + 「回答する」ボタン + 「パスする」リンク
- **他**: 回答者が考え中であることを表示 + 残ったヒント一覧（共有認識のため）

#### screen-judge（ホスト判定）
- お題・回答を並べて表示
- ホスト: 正解 / 不正解 ボタン
- 他: 「ホストが判定中です…」
- パスの場合はこの画面をスキップし、自動で不正解扱い

#### screen-result（ラウンド結果）
- お題、回答者の回答、正解/不正解を大きく表示
- 消えたヒントも含む全ヒント一覧（除外されたヒントは薄く表示）
- 現在の正解数 / ラウンド数
- ホスト: 「次のラウンドへ」 / 「ゲーム終了」ボタン

#### screen-final（最終結果）
- 全ラウンドの振り返りテーブル（ラウンド番号、お題、回答者、回答、正解/不正解）
- 最終スコア: ○問正解 / 全○問
- 「もう一度遊ぶ」（同じメンバーで再開） / 「TOPに戻る」ボタン

## 実装上の注意

### ルームコード
- **6桁** 英数字（紛らわしい文字 0, O, I, 1 を除外）
- `generateCode()` で生成

### ニックネーム
- 1〜8文字
- 同ルーム内重複NG
- 空文字NG

### セッション削除
- ゲーム終了 30 秒後に `roomRef.remove()` で自動削除

### XSS 対策
- ニックネーム・ヒント・回答を DOM に挿入する際は `esc()` でエスケープ

### リスナーのクリーンアップ
- 退出・TOP 画面遷移時に `roomRef.off()` を呼ぶ
- `clearInterval()` でタイマーも停止

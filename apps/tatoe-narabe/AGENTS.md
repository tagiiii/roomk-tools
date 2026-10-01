# たとえならべ 仕様書

## 目的・使用シーン

自分だけに配られた数字を見ながら、お題に沿った言葉で強さ・大きさ・近さを表現し、全員で順番をそろえる協力ゲーム。
room-K では「正解を当てる」よりも、感じ方の違いを言葉にして相談する体験として使う。

## 技術スタック

- Realtime Database + 単一ファイル（`index.html` に CSS / JS をインライン）
- Firebase SDK v10 compat
- 共通デザインシステムを使用

## Realtime Database パス

```
tatoenarabe_rooms/{roomCode}/
  host, hostConnected, hostDisconnectedAt, status, roundId, theme, themeOptions,
  recentThemes, discussionEndsAt
  settings/hostPlays       # ホストもプレイヤーとして参加するか（作成時 true。キーなしの旧ルームも true 扱い）
  players/{nick}/          # isHost, number, ready, declaredAt（guest は presenceVersion, connections も）
```

## 画面・status

代表的な遷移:

```
waiting → revealing → playing → result
```

- `waiting`: ルーム作成・参加待ち
- `revealing`: 各自の数字確認
- `playing`: お題に沿って宣言し、順番を相談
- `result`: 宣言順と数字順の結果表示

## 共通ルール

- ルームコードは6桁英数字（紛らわしい文字を除外）
- ニックネームは最大8文字、同ルーム内重複NG
- ホストは `players/{nick}/isHost` で識別
- ホストは進行だけのときも `players/{host}` に残る（`isHost: true`, `number: 0`）。再接続はこの行で照合する
- ホスト切断は `hostConnected` / `hostDisconnectedAt` と TTL で扱う
- 再接続は `sessionStorage: tatoenarabe_session` を使う
- タイマーや TTL 判定は `.info/serverTimeOffset` で補正したサーバー推定時刻を使う

## 特有のルール

- お題は `THEMES` 配列で管理する
- 直近のお題を避けるため、最近使ったお題を一定数記憶する
- 数字や他プレイヤーの秘密情報は UI レベルで非表示にする
- お題は room-K 共通のコンテンツガイドラインに従い、比較が強すぎる表現や学校・恋愛・暴力・ホラーを避ける
- `finishGame()` は `status: "result"` に進めるだけで、ルームを自動削除しない。result 画面からの再戦とリロード復帰を許可するため、root AGENTS.md の公認バリアント『ふりかえり画面滞在中は削除しない』（2026-08-10 追加）を採用
- クリーンアップはホストの `leaveGame()` によるルーム削除、ゲストの `players/{nick}` 削除、ホスト切断時の2分TTL（`ORPHAN_TTL_MS`）に任せる

## ホストの参加（2026-10-01 オーナー決定: 待合室でホストの参加を選べる（初期値は従来どおり））

- 待合室のホストだけに「自分もプレイヤーとして参加する」チェックを出す（初期値オン＝従来どおりホストにも数字を配る）。保存先は `settings/hostPlays`。判定は `hostPlays !== false`（キーなしの旧ルームはホストも遊ぶ）
- 変えられるのは `status: "waiting"` の間だけ（room transaction で status と host を照合）。result からの「もう一度プレイ」は待合室に戻らず、待合室の値を引き継ぐ
- 遊ぶ人＝ホストが遊ぶなら全員、進行だけならホスト以外。数字の配布・確認状況（全員確認・未確認人数）・宣言の一覧・答え合わせの母数・最少2人／最大100人の判定は遊ぶ人だけで数える。開始ボタンの下に遊ぶ人数で「あと N 人で始められます」等を出す
- 進行だけのホストは数字カード・「確認した！」・「あなたの数字」・宣言ボタンを出さず、お題選び・発言フェーズへ・タイマー・答え合わせ・もう一度プレイの既存ホスト操作と全体の様子だけを見る。確認・宣言の transaction も遊ぶ人だけを受け付ける
- 待合室の参加者一覧で、進行だけのホストの行に「進行役」タグ（ホスト・ゲストとも見える）
- 遊ぶ人が全員退出して進行だけのホストが残っても、ホスト側に自動書き込みはない（数字確認画面では「退出する」でルームを閉じるよう案内する）。従来のホストひとり残りと同じく、ゲストは waiting 以外では参加できない

## ゲスト保持の共通規約例外（2026-09-08 B-27 / P-11）

- waiting／revealing／playing／resultの全期間でguest本体の `number / ready / declaredAt` を保持する。`presenceVersion: 1` と `connections/{id}: true` を追加し、切断予約は接続IDの `onDisconnect().remove()` のみ。接続ごとに新IDの予約を受け付けてから、room transactionで存在・役割・状態・期限を検査して登録する。
- 復帰はsessionStorageが残る同一タブ等に限定する。保存roleはhost／guestのみ、room.hostとplayer.isHostをstate変更前に照合する。欠損guestを数字なしで再追加しない。sessionStorageは本人確認や別端末復帰の保証ではない。
- 一時切断中は接続待ちを表示し、数字確認と宣言を止める。準備・宣言はroom transactionで存在・フェーズ・最新guest役割・TTLを再検査する。宣言時刻は操作開始時に一度だけ採時し、transaction再試行で順序が変わらないようにする。既存の宣言時刻は上書きしない。
- roomの `roundId` を開始／再戦ごとに一度だけ生成する。数字は次のラウンドでも同じ値になり得るため、数字一致やフェーズ一致だけでは古い操作を識別できない。操作はroom参照・roundId・接続世代を保持して、遅延した確認／宣言が新ラウンドへ書き込まれないようにする。roundIdなしの旧データはnull同士で互換とし、新版の開始／再戦では必ず新IDを保存する。旧版だけで進むラウンドの識別は保証しない。
- 開始とresultからの直接再戦は全在籍guestの接続を待つ。playerを作り直すときもpresenceを保持し、numberを再配布、ready／declaredAtを初期化する。人数2〜100の条件は維持する。
- 既存の未確認者を残した強制発言開始、未宣言者がいる状態での答え合わせ、タイマー終了後の宣言を維持する。切断者を自動除外せず、秘密の数字表示・宣言順・採点方法は変更しない。
- 待機・数字確認・発言画面でもguestの明示退出を表示する。退出は確認ダイアログの後、自分のplayerを削除するため、宣言済みの行や結果の母数からも外れる。一時切断による保持とは異なる。取消時はそのまま在籍する。
- 退出・room／guest消失・TTLで接続監視を解除し、古い非同期処理を取消・回収する。期限切れtransactionは `applyLocally:false` とし、楽観null通知で確定前に参照を破棄しない。room消失時はhostも予約を取り消してTOPへ戻すが、host自動再接続方式自体は変更しない。
- 新規参加transactionは一時value購読でキャッシュを保持し、完了・失敗時とも当該listenerだけを解除する。古いget結果をtransactionのnullへ代入しない。
- オフラインの明示退出は予約取消等が通信回復まで待機する場合がある。旧版別接続のplayer全体remove予約は新版から取り消せないため、公開後は全員が新版を読み込んだ新規ルームから利用する。

本体差分が目安200行を超える場合も、presence予約・保持・解除、roundIdによる操作識別、確認／宣言の原子的更新、初回参加・TTLの整合を別々に適用すると不整合が残るため、1アプリの復帰ライフサイクルとしてまとめる。

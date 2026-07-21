# たとえならべ 仕様書

## 目的・使用シーン

自分だけに配られた数字を見ながら、お題に沿った言葉で強さ・大きさ・近さを表現し、全員で順番をそろえる協力ゲーム。
roomK では「正解を当てる」よりも、感じ方の違いを言葉にして相談する体験として使う。

## 技術スタック

- Realtime Database + 単一ファイル（`index.html` に CSS / JS をインライン）
- Firebase SDK v10 compat
- 共通デザインシステムを使用

## Realtime Database パス

```
tatoenarabe_rooms/{roomCode}/
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
- ホスト切断は `hostConnected` / `hostDisconnectedAt` と TTL で扱う
- 再接続は `sessionStorage: tatoenarabe_session` を使う
- タイマーや TTL 判定は `.info/serverTimeOffset` で補正したサーバー推定時刻を使う

## 特有のルール

- お題は `THEMES` 配列で管理する
- 直近のお題を避けるため、最近使ったお題を一定数記憶する
- 数字や他プレイヤーの秘密情報は UI レベルで非表示にする
- お題は roomK 共通のコンテンツガイドラインに従い、比較が強すぎる表現や学校・恋愛・暴力・ホラーを避ける
- `finishGame()` は `status: "result"` に進めるだけで、ルームを自動削除しない。result 画面からの再戦とリロード復帰を許可するための、ルート規約「終了後30秒で削除」からの意図的例外
- クリーンアップはホストの `leaveGame()` によるルーム削除、ゲストの `players/{nick}` 削除、ホスト切断時の2分TTL（`ORPHAN_TTL_MS`）に任せる

# ワードウルフ 仕様書

## 目的・使用シーン
全員にお題が配られ、ひとりだけ違うお題を持つ「ウルフ」を会話から見つけ出す正体隠し系ゲーム。
メンターと若者が Zoom / Meet 等で画面共有しながら一緒にプレイする。

## ファイル構成
```
apps/word-wolf/
└── index.html   # 単一ファイルで完結（Firebase Realtime Database 使用）
```

## 画面フロー
```
TOP
 ├── ホスト → ニックネーム入力・設定（討論時間・ウルフ人数）→ 待機
 └── ゲスト → ニックネーム＋ルームコード入力 → 待機
                     ↓
           お題確認（タップして自分のお題を見る・全員準備完了でホストが討論スタート）
                     ↓
           討論フェーズ（カウントダウンタイマー付き）
                     ↓
           投票フェーズ（ウルフだと思う人に投票）
                     ↓
           結果発表（ウルフ公開・投票集計・勝敗判定）
                     ↓
           ホスト → もう一度 or 終了
```

## 勝敗ルール
- 最多票を獲得した人がウルフ → **市民の勝ち**
- 最多票が複数人いる（同票）or ウルフ以外が最多票 → **ウルフの勝ち**

## Firebase データ構造（Realtime Database）
```
wordwolf_rooms/{roomCode}/
  ├── host:             string          # ホストのニックネーム
  ├── hostConnected:    boolean         # 切断検知用
  ├── status:           string          # waiting | revealing | discussing | voting | result
  ├── citizenWord:      string          # 市民のお題
  ├── wolfWord:         string          # ウルフのお題
  ├── discussionSecs:   number          # 討論時間（秒）
  ├── wolfCount:        number          # ウルフの人数
  ├── discussionEndsAt: number          # 討論終了タイムスタンプ（ms）
  ├── citizenWin:       boolean         # 結果（市民が勝ったか）
  ├── voteCounts:       object          # {nickname: 票数}
  └── players/
       └── {nickname}/
            ├── isHost:  boolean
            ├── isWolf:  boolean        # 結果まで非表示（UIレベル）
            ├── word:    string         # 自分のお題のみ参照する
            ├── ready:   boolean        # お題確認済みか
            └── vote:    string | null  # 投票先ニックネーム
```

## セキュリティ注意事項
- Firebase Realtime Database はフィールドレベルの読み取り制御が難しいため、`isWolf` や他プレイヤーの `word` はDB上では見えてしまう
- UIレベルで自分の `word` のみを表示し、結果発表まで他人の情報を出さない
- DevTools でのカンニングは性善説で許容する（スタッフ監視下での使用のため）

## 特有のルール・制約
- ルームコードは6桁英数字（紛らわしい文字除外）
- ニックネームは1〜8文字・同ルーム内重複NG
- 3人以上でないとゲーム開始不可
- ウルフは1人または2人（ホストが設定）
- 討論時間は 3分 / 5分 / 7分 から選択
- ゲスト離脱: `onDisconnect().remove()` でそのプレイヤーデータを削除
- ホスト離脱: `hostConnected` を false にする。ゲストはオーバーレイ表示

## お題ペアのガイドライン
- 近いけど微妙に違う2つのワードを選ぶ（例: カレー / シチュー）
- 学校・勉強・宿題を連想させる表現は使用しない
- 恋愛・暴力・ホラー系は使用しない
- 小学生〜中学生が知っているお題を選ぶ

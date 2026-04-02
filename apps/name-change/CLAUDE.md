# 名前変えゲーム 仕様書

## 目的・使用シーン
Metalifeなどのメタバース空間でアバター名を変えた人を当てるゲーム。
GM（進行役）が画面共有しながら参加者と一緒に遊ぶ。

## ファイル構成
```
apps/name-change/
└── index.html   # 単一ファイルで完結（Firebase Realtime Database使用）
```

## 役割
| 役割 | 説明 |
|------|------|
| GM | ルーム作成・フェーズ進行のみ。投票・名前変えには参加しない |
| 名前変え役 | Metalife で名前を変え、変更後の名前をアプリに入力。投票には参加しない |
| 投票役 | 名前を変えていない参加者。変更後の名前が誰のものか投票する |

## 画面フロー
```
TOP
 ├── GMがルーム作成
 └── 参加者がルームに参加
         ↓（GM が「ゲームを始める」）
    【名前変えフェーズ】
    各自が「名前変えで参加」or「投票で参加」を選択
         ↓（GM が「投票フェーズへ進む」）
    【投票フェーズ】
    投票役：変更後の名前一覧から元の名前を選んで投票
    名前変え役：待機
         ↓（GM が「結果発表へ進む」）
    【結果発表フェーズ】
    GM が1枚ずつ「正体を発表！」ボタンでめくる（カードフリップ）
         ↓（GM が「ゲーム終了」）
    【終了画面】
```

## 投票ルール
- 投票役は表示された変更後の名前それぞれに対して「誰の名前か」を選択
- 同じ人を複数の名前に割り当てることはできない（重複防止）
- 得点機能なし

## 結果発表
- GM が「正体を発表！」ボタンを押すと、カードがフリップして元の名前が表示される
- 「次へ」で次の人へ、全員発表後「ゲーム終了」

## Firebase データ構造（Realtime Database）
```
namechange_rooms/{roomCode}/
  ├── host:          string        # GM のニックネーム
  ├── status:        string        # waiting | naming | voting | revealing | done
  ├── revealOrder:   string[]      # 発表順（changers をシャッフル）
  ├── revealIndex:   number        # 現在の発表インデックス
  ├── revealAnswer:  boolean       # 現在のカードを裏返したか
  └── players/
       └── {nickname}/
            ├── isHost:      boolean
            ├── gameRole:    string | null   # 'host' | 'changer' | 'voter' | null
            ├── changedName: string | null   # 変更後の名前（changer のみ）
            ├── votes:       object | null   # { changerNick: guessedNick }（voter のみ）
            └── ready:       boolean         # naming フェーズで選択済みか
```

## 特有のルール・制約
- ルームコードは6桁英数字（紛らわしい文字除外）
- 元の名前（ニックネーム）は1〜12文字・同ルーム内重複NG
- GM のニックネームは1〜8文字
- 変更後の名前は1〜16文字
- 参加者2人以上でゲーム開始可
- GM 切断時はルームごと削除（`onDisconnect().remove()`）
- ゲーム終了30秒後にデータを自動削除

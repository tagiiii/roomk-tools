# いいセンいきまSHOW! 仕様書

## 目的・使用シーン
数字で「いいセン」を狙うリアルタイム対戦パーティーゲーム。
メンターが画面共有しながら若者と一緒にプレイする。

## ファイル構成
```
apps/iisen-show/
└── index.html   # 単一ファイルで完結（Firebase Realtime Database使用）
```

## 画面フロー
```
TOP
 ├── ホスト → ニックネーム入力 → ルーム作成・待機
 │             （3人以上でゲーム開始可）
 └── ゲスト → ニックネーム＋コード入力 → 参加待機
                       ↓
              問題選択（ホストのみ操作 / ゲストは待機表示）
                       ↓
              回答入力（全員 / 全員送信で自動進行）
                       ↓
              結果発表（ラウンドスコア表示）
                       ↓
              ホスト操作：次の問題 or ゲーム終了
                       ↓
              最終結果（順位表・優勝者表彰）
```

## 得点ルール
| 条件 | 得点 |
|------|------|
| 中央値の回答者 | +50pt |
| 最大値 or 最小値の回答者 | -10pt |
| それ以外 | ±0pt |

- 偶数人数のとき: 下側の中央値を採用
- 中央値が複数人いる場合: 全員 +50pt
- 中央値が最小値 or 最大値と一致する場合: 中央値判定を優先

## Firebase データ構造（Realtime Database）
```
rooms/{roomCode}/
  ├── host:             string        # ホストのニックネーム
  ├── status:           string        # waiting | selecting | answering | result | finished
  ├── currentQuestion:  string        # 現在の問題文
  ├── round:            number        # 現在のラウンド数
  ├── usedQuestions:    number[]      # 使用済み問題インデックス
  ├── pendingQuestions: {q, i}[]      # ホストが選ぶ候補問題（3問）
  └── players/
       └── {nickname}/
            ├── score:  number        # 累計スコア
            ├── isHost: boolean
            └── answer: number | null # 現ラウンドの回答
```

## 離脱時の挙動
- **ホスト離脱**: `onDisconnect().remove()` でルームごと削除 → ゲストにアラート表示
- **ゲスト離脱**: `onDisconnect().remove()` でそのプレイヤーデータのみ削除

## 特有のルール・制約
- ルームコードは4桁英数字（紛らわしい文字除外）
- ニックネームは1〜8文字・同ルーム内重複NG
- 3人以上でないとゲーム開始不可
- 問題は重複しないようにトラッキング（全問使用後はリセット）
- ゲーム終了30秒後にFirestoreデータを自動削除
- Firebase設定は `firebaseConfig` の `YOUR_*` プレースホルダーを差し替えること
  - **Realtime Database** を使用（Firestoreではない）
  - `databaseURL` の設定が必須

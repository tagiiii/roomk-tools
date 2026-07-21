# ドまんなか 仕様書

## 目的・使用シーン
数字で「いいセン」を狙うリアルタイム対戦パーティーゲーム。
メンターが画面共有しながら若者と一緒にプレイする。

## ファイル構成
```
apps/do-mannaka/
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
domannaka_rooms/{roomCode}/
  ├── host:             string        # ホストのニックネーム
  ├── hostConnected:    boolean       # ホスト接続状態
  ├── hostDisconnectedAt: number|null # ホスト切断時刻
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
- **ホスト離脱**: `onDisconnect().update()` で `hostConnected=false` と `hostDisconnectedAt=ServerValue.TIMESTAMP` を保存。ゲストにはオーバーレイを表示し、2分TTL（`ORPHAN_TTL_MS`）超過後に期限切れルームとして削除を試みる
- **ゲスト離脱**: `onDisconnect().remove()` でそのプレイヤーデータのみ削除
- ホスト再接続時は `hostConnected=true` / `hostDisconnectedAt=null` に戻し、`sessionStorage: domannaka_session` から復帰する
- TTL 判定は `.info/serverTimeOffset` を使ったサーバー推定時刻で行う

## 特有のルール・制約
- ルームコードは6桁英数字（紛らわしい文字除外）
- ニックネームは1〜8文字・同ルーム内重複NG
- 3人以上でないとゲーム開始不可
- 問題は重複しないようにトラッキング（全問使用後はリセット）
- ゲーム終了30秒後に Realtime Database のルームデータを自動削除
- Firebase compat SDK の初期化は `RoomkRTDB.initFirebase(firebase)` を使用する
  - **Realtime Database** を使用（Firestoreではない）
  - 匿名認証の完了は返り値の `authReady` を await してから読み書きする

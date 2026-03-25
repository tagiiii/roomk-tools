# 投票・集計アプリ 仕様書

## 目的・使用シーン
roomKのオンライン支援セッションで、複数の選択肢からリアルタイムに投票・集計するツール。
「次回の活動、何がいい？」「どの案を選ぶ？」などの意思決定に使う。

## 画面構成・フロー

### スタッフ側（ホスト）
1. **投票作成画面** - タイトル・選択肢（2〜6個）を入力してセッション作成
2. **投票管理画面** - 参加コードを共有 / 投票状況をリアルタイム確認 / 投票を締め切る
3. **結果画面** - バーグラフで結果を表示・共有

### 参加者側
1. **入室画面** - セッションコードを入力
2. **投票画面** - 選択肢から1つ選んで送信（1人1票）
3. **待機・結果画面** - 締め切り後に結果を表示

## Firestoreデータ構造

```
vote_sessions/{sessionId}
  - title: string              // 投票タイトル
  - options: string[]          // 選択肢の配列（最大6個）
  - status: "open" | "closed"
  - createdAt: Timestamp

vote_sessions/{sessionId}/votes/{voteId}
  - optionIndex: number        // 選択した選択肢のインデックス
  - votedAt: Timestamp
  - userId: string             // Anonymous Auth の uid
```

## 特有のルール・制約
- 1セッションにつき1ユーザー1票（Anonymous Auth の uid で管理）
- 投票締め切り後は票の変更不可
- 選択肢は最低2個・最大6個
- セッションコードは6桁英数字（`generateSessionId()` を使用）
- ホスト画面は `?host=1` クエリパラメータで識別

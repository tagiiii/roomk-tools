# たとえグランプリ 仕様書

## 目的

お題に対して「たとえ表現」を考え、匿名投票でお気に入りを選ぶ大喜利ゲーム。
表現のうまさを競うというより、自由な発想を出して笑い合うことを重視する。

## 技術構成

- Realtime Database を使う単一ファイルアプリ
- `apps/tatoe-gp/index.html` に UI / CSS / JS を集約
- Firebase パスは `tatoegp_rooms/{roomCode}/`
- `sessionStorage` キーは `tatoegp_session`

## フェーズ

| status | 画面 | 内容 |
|--------|------|------|
| `waiting` | 待機 | 参加者を集める。3人以上で開始可能 |
| `selecting` | お題選択 | ホストが3択から1つ選ぶ |
| `answering` | 回答入力 | 全員が30文字以内で回答 |
| `voting` | 匿名投票 | 回答だけを見て1票投票 |
| `result` | ラウンド結果 | 回答者名・票数・加点を公開 |
| `finished` | 最終結果 | 総合順位を表示 |

## 投票と得点

- 投票画面では回答者名を出さない
- 自分の回答には投票できない
- 1票につき `+10pt`
- 単独最多得票の回答だけ `+10pt` ボーナス
- 同率最多の場合はボーナスなし

## データ構造

```text
tatoegp_rooms/{roomCode}/
  host: string
  hostConnected: boolean
  hostDisconnectedAt: number | null
  status: "waiting" | "selecting" | "answering" | "voting" | "result" | "finished"
  round: number
  currentTheme: string
  usedThemes: number[]
  pendingThemes: [{ t, i }, ...] | null
  answerOrder: string[]
  players/{nickname}/
    score: number
    isHost: boolean
    answer: string | null
    vote: string | null
```

## 実装メモ

- ルーム作成と参加はルームルートへの `transaction()` を使う
- ホスト切断時は `hostConnected=false` と `hostDisconnectedAt` を保存する
- ゲストは `players/{nickname}` に `onDisconnect().remove()` を設定する
- `.info/serverTimeOffset` を使って期限切れルームを判定する
- ユーザー入力の描画は必ず `escapeHtml()` を通す

## お題ガイドライン

- 学校・勉強・テスト・成績を連想させるものは入れない
- 恋愛・暴力・ホラー・怖さに寄るものは避ける
- 正解がなく、短くても答えやすいお題を優先する
- 参加者が「答えたくない」と感じにくい軽さを保つ

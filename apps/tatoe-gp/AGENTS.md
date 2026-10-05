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
| `waiting` | 待機 | 参加者を集める。遊ぶ人3人以上で開始可能。ホストは「自分もプレイヤーとして参加する」を切り替えられる |
| `selecting` | お題選択 | ホストが3択から1つ選ぶ |
| `answering` | 回答入力 | 遊ぶ人全員が30文字以内で回答 |
| `voting` | 匿名投票 | 回答だけを見て1票投票 |
| `result` | ラウンド結果 | 回答者名・票数・加点を公開 |
| `finished` | 最終結果 | 総合順位を表示 |

## 参加用のリンク（2026-10-05）

- 参加用のリンク `?room=CODE` と「リンクをコピー」（`#btnCopyLink`）。共通仕様は docs/development/rtdb.md「参加用のリンク」。このアプリの入口は index.html 末尾の起動処理（`tryReconnect()` の直前で `?room=` を見る）、参加画面は `#screen-guest-join`（ヒント `#joinLinkHint`）。`?room=` は `startRoomListener()`（作成・参加・再接続の共通の通り道）でアドレスから外す
- ルームバーがないので、「リンクをコピー」はホストの待合室の「コードをコピー」の下に置く（参加者側にはコピーボタンがない。従来どおり）。コピーは共通の `RoomkRTDB.copyRoomLink`（`copyToClipboard` はコード専用の `copyRoomCode` なので使わない）
- リンクの検査は作られるコードの形 `/^[A-HJ-NP-Z2-9]{6}$/`（`ROOM_CODE_PATTERN`）。参加フォームの検査は変えていない。画面の欄名に合わせ、ヒントとあそびかたは「名前」でなく「ニックネーム」

## ホストの参加（遊ぶ／進行だけ）

- 待合室（`waiting`）のホストだけに「自分もプレイヤーとして参加する」チェック。初期値はオン（従来どおりホストも遊ぶ）
- 保存先は `settings/hostPlays`。作成時に `true`。**キーがない部屋（旧版が作った部屋）は `hostPlays !== false` で「遊ぶ」扱い**
- 変更はホストがルームルートの `transaction()` で行い、`status === waiting` のときだけ通る。開始後は変えない（結果画面からの「次のラウンド」でも変えない。ゲーム終了後は TOP に戻るため、同じルームでの「もう一度」はない）
- 遊ぶ人 = ホストが遊ぶなら `players` 全員、遊ばないならホスト以外（`playingPlayers()`）。回答数・投票数の「全員そろった」判定、締め切りの案内、得点加算、ラウンド結果・現在のスコア・最終順位はすべて遊ぶ人だけで数える
- 最少人数（3人）も遊ぶ人だけで数える。足りないあいだは開始ボタンを無効にし「遊ぶ人があと N 人必要です」と出す
- 進行だけのホストも `players/{host}`（`isHost: true`）に残す（一覧表示と既存の再接続のため）。回答・投票は書かない（UIに出さず、送信関数でも弾く）。一覧では「ホスト」に加えて「進行役」タグ
- 進行だけのホストの画面: お題選び・回答の締め切り・投票の締め切り・次のラウンド・ゲーム終了は従来どおり。回答中は回答欄の代わりに案内文、投票中は匿名の回答一覧だけ（投票ボタンなし）
- 遊ぶ人が全員抜けて進行役だけが残ったとき: 自動の進行は「回答・投票が1件以上」が条件なので書き込みは起きない。回答中はホストに「ゲームを終了する」を出す。最終結果は優勝欄を出さず「遊んだ人はいませんでした」

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
  settings/
    hostPlays: boolean     # ホストも回答・投票・得点の対象か。キーなしは true 扱い
  players/{nickname}/
    score: number
    isHost: boolean
    answer: string | null
    vote: string | null
```

## 実装メモ

- ゲーム中の名前だけによる再参加は拒否し、復帰は同じタブの保存済みsessionによる `tryReconnect()` のみとする（2026-09-09 P-12）。sessionStorageは認証境界ではなく、別端末の本人確認を追加したものではない。待機中の通常参加・ホスト名の参加拒否・既存の保存復帰処理は維持する。
- ルーム作成と参加はルームルートへの `transaction()` を使う
- ホスト切断時は `hostConnected=false` と `hostDisconnectedAt` を保存する
- ゲストは `players/{nickname}` に `onDisconnect().remove()` を設定する
- `.info/serverTimeOffset` を使って期限切れルームを判定する
- ユーザー入力の描画は必ず `escapeHtml()` を通す

## お題ガイドライン

`index.html` 内の `THEMES` は90お題。追加時はカテゴリコメントでまとまりを残し、既存お題との正規化重複を避けて末尾へ追加する。
- 学校・勉強・テスト・成績を連想させるものは入れない
- 恋愛・暴力・ホラー・怖さに寄るものは避ける
- 正解がなく、短くても答えやすいお題を優先する
- 参加者が「答えたくない」と感じにくい軽さを保つ

## 経緯

- 2026-10-01 オーナー決定: 待合室でホストの参加を選べる（初期値は従来どおり「遊ぶ」）。`settings/hostPlays` を追加し、遊ぶ人だけで最少人数・回答／投票の集計・得点・結果を数える

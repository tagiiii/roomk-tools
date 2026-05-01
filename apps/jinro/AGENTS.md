# 人狼ゲーム — 実装仕様

## ファイル構成
- `apps/jinro/index.html` — 単一ファイル構成（CSS・JS すべてインライン）
- Firebase Realtime Database 使用
- `apps/shared/css/design-system.css` を読み込む

## 役職一覧（全14種）

### 村人陣営
| 役職 | 夜の行動 | 特殊効果 |
|------|---------|---------|
| 村人 | なし | — |
| 占い師 | 1人を占う（人狼陣営か否か） | 妖狐を占うと妖狐が死亡（占い師には「死」と表示） |
| 霊媒師 | 前日処刑者が人狼だったかを知る（2日目夜〜） | 1日目夜は行動なし |
| 騎士 | 1人を護衛（前夜同一人物への連続護衛不可） | 人狼の襲撃を防ぐ |
| パン屋 | なし | 生存中は毎朝「パンが届いた」アナウンス。死亡時も全員に告知 |
| 共有者 | なし | 2人セット。互いの名前をゲーム開始時に知る |
| 猫又 | なし | 噛まれた場合→噛んだ人狼1人を道連れ。処刑された場合→ランダムで1人道連れ |
| ハンター | なし | 死亡時（噛み・処刑どちらでも）に任意の1人を道連れ（選択UI表示） |

### 人狼陣営
| 役職 | 夜の行動 | 特殊効果 |
|------|---------|---------|
| 人狼 | 複数いる場合は投票で1人を襲撃 | 仲間の人狼が分かる |
| 狂人 | なし | 人狼の勝利=自分の勝利。占い結果は「白」 |
| 狂信者 | なし | 人狼が誰か分かる（人狼は狂信者を知らない）。占い結果は「白」 |

### 第三陣営
| 役職 | 夜の行動 | 勝利条件 |
|------|---------|---------|
| てるてる坊主 | なし | 規定日数生存 **かつ** 昼投票で処刑される（噛まれると負け） |
| 神様 | なし | 全配役を知った状態でスタート。ゲーム終了時に生存で勝利 |
| 妖狐 | なし | 噛み耐性あり。占い師に占われると死。ゲーム終了時生存で単独勝利 |
| 背徳者 | なし | 妖狐が誰か分かる。妖狐死亡で後追い自殺。妖狐生存で共同勝利 |

## 勝敗判定（優先順位順）

1. **てるてる坊主**: 昼処刑直後に専用チェック（規定日数 + 処刑死）
2. **妖狐**: 人狼/村人の勝利条件が成立したとき妖狐が生存していれば妖狐勝利（横取り）
3. **村人勝利**: 人狼が全員死亡
4. **人狼勝利**: 人狼数 ≥ 村人陣営の生存者数（第三陣営除く）
5. **神様**: ゲーム終了時に生存していれば別途「神様も生存」と表示（横取りではなく並記）

てるてる坊主の規定日数:
- 総参加人数4人以下 → 1日目
- 5〜6人 → 2日目
- 7人以上 → 3日目

## Firebaseデータ構造

```
jinro_rooms/{roomCode}/
  host:             string
  hostConnected:    boolean
  status:           'waiting' | 'night' | 'morning' | 'day' | 'vote' | 'execution' | 'result'
  day:              number           // 1始まり
  totalPlayers:     number           // ゲーム開始時の参加者数（てるてる判定用）
  discussionSecs:   number
  discussionEndsAt: number
  tieBreakTarget:   string | null    // 同票時GMが選んだ処刑対象

  roles:            object           // 役職名→人数 { '村人': 2, '人狼': 1, ... }

  players/{nickname}/
    isHost:         boolean
    role:           string
    isAlive:        boolean
    faction:        'village' | 'wolf' | 'third'
    vote:           string | null
    wolfVote:       string | null    // 人狼専用の集団投票
    nightAction:    string | null
    actionDone:     boolean
    lastGuarded:    string | null    // 騎士専用

  nightResult/
    seerResults:    { [seerNick]: { target: string, result: 'black' | 'white' | 'dead' } } | null
    mediumResult:   'wolf' | 'not_wolf' | null

  morningLog:       array            // { type, message, day }
  executionTarget:  string | null
  lastExecuted:     string | null
  lastExecutedWasWolf: boolean | null  // 霊媒師用：処刑者が人狼だったか
  hunterPending:    string | null    // ハンター道連れ待機
  winner:           'village' | 'wolf' | 'teruteru' | 'fox' | 'draw' | null
  foxPlayer:        string | null
```

## ゲームフロー

```
waiting → night（1日目夜）→ morning → day → vote → execution → [result or night]
```

## 画面一覧（screen-{name}）
- `top` — ルーム作成/参加
- `waiting` — 待機・役職設定（GM用パネルあり）
- `role` — 役職確認（フリップカード）
- `night` — 夜フェーズ（役職ごとに異なるUI）
- `morning` — 朝アナウンス
- `day` — 昼討論（タイマー）
- `vote` — 処刑投票
- `execution` — 処刑後処理（ハンター道連れ選択など）
- `result` — 結果発表

## 夜フェーズ解決ロジック（ホストのみ実行）

1. 行動不要な役職の `actionDone` を夜開始時に `true` に一括セット
2. 人狼は `wolfVote` で投票 → 全人狼投票完了後にホストが最多票を `nightAction` に書き込む
3. 全員 `actionDone: true` になったらホストが `resolveNight()` を実行

解決順序:
1. 占い師の占い（妖狐なら死亡 → 背徳者も後追い）
2. 人狼の襲撃 → 騎士護衛チェック → 妖狐耐性チェック
3. 猫又が噛まれた場合 → 噛んだ人狼1人を道連れ
4. パン屋の生死アナウンス
5. 霊媒師の結果（前日処刑者が人狼だったか否か）

## 主要なエッジケース

- **猫又道連れ相手がハンター** → ハンターの道連れも発動（`hunterPending` セット）
- **猫又道連れ相手がてるてる坊主** → 昼処刑以外なので勝利条件不成立
- **騎士の連続護衛禁止** → `lastGuarded` と比較してUIレベルで弾く
- **霊媒師1日目夜** → `actionDone: true` 自動セット（行動なし）
- **全員死亡** → `winner: 'draw'` 表示
- **猫又処刑時に生存者1人** → 道連れ候補なしのフォールバック
- **妖狐が占われた夜に人狼も妖狐を襲撃** → 妖狐は占いで死亡済み。人狼の噛みは空振り

## 実装順序

1. Firebase 初期化 + 画面管理基盤（word-wolf をベースに）
2. TOP画面 + ルーム作成/参加
3. 待機画面 + 役職設定UI（GMパネル）
4. 役職配布 + ゲーム開始処理
5. 夜フェーズUI + 行動収集
6. `resolveNight()` 実装
7. 朝アナウンス画面
8. 昼討論 + タイマー
9. 投票画面 + 同票処理
10. `resolveExecution()` 実装（てるてる・猫又・ハンター連鎖）
11. 勝敗判定 `checkVictory()`
12. 結果発表画面
13. 再接続処理・30秒後自動削除
14. `apps/index.html` にカード追記

## 参照すべき既存ファイル
- `apps/word-wolf/index.html` — Firebase パターン・画面管理・全体構成の参考元
- `apps/shared/css/design-system.css` — CSS 変数・ボタン・カードクラス

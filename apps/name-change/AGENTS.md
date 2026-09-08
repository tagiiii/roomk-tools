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
    変更前後の名前・正解人数を全件一覧表示
         ↓（GM が「ゲーム終了」）
    【終了画面】
```

## 投票ルール
- 投票役は表示された変更後の名前それぞれに対して「誰の名前か」を選択
- 同じ人を複数の名前に割り当てることはできない（重複防止）
- 得点機能なし

## 結果発表
- 変更前後の名前を全件一覧で表示し、それぞれの正解人数を添える。得点・ランキング機能ではない
- 「結果をコピー（チャット用）」で一覧をコピーでき、GMが「ゲーム終了」で終了する
- 旧文書の逐次フリップは現在の実装と一致しないため訂正（2026-09-08）。新しい発表方式を実装したものではない

## Firebase データ構造（Realtime Database）
```
namechange_rooms/{roomCode}/
  ├── host:          string        # GM のニックネーム
  ├── hostConnected: boolean       # GM 接続状態
  ├── hostDisconnectedAt: number|null # GM 切断時刻
  ├── status:        string        # waiting | naming | voting | revealing | done
  ├── revealOrder:   string[]      # 発表順（changers をシャッフル）
  ├── revealIndex:   number        # 旧フィールド。現在は初期値のみ保持
  ├── revealAnswer:  boolean       # 旧フィールド。現在は初期値のみ保持
  ├── deleteAt:      number        # done確定時の削除予定時刻
  └── players/
       └── {nickname}/
            ├── isHost:      boolean
            ├── gameRole:    string | null   # 'host' | 'changer' | 'voter' | null
            ├── changedName: string | null   # 変更後の名前（changer のみ）
            ├── votes:       object | null   # { changerNick: guessedNick }（voter のみ）
            ├── ready:       boolean         # naming フェーズで選択済みか
            ├── presenceVersion: 1          # 保持型guestのみ
            └── connections/{接続ID}: true   # 接続ごとにremove予約
```

## 特有のルール・制約
- ルームコードは6桁英数字（紛らわしい文字除外）
- 元の名前（ニックネーム）は1〜12文字・同ルーム内重複NG
- GM のニックネームは1〜8文字
- 変更後の名前は1〜16文字
- GMを除く参加者2人以上（合計3人以上）でゲーム開始可
- GM 切断時は `onDisconnect().update()` で `hostConnected=false` と `hostDisconnectedAt=ServerValue.TIMESTAMP` を保存し、参加者側にオーバーレイを表示する
- 孤立ルームの TTL は通常2分（`ORPHAN_TTL_MS`）。ただし `naming` / `voting` / `revealing` 中は、ゲーム進行中の一時切断を吸収するため30分（`ORPHAN_TTL_INGAME_MS`）に延長する
- GM 再接続時は `hostConnected=true` / `hostDisconnectedAt=null` に戻し、`sessionStorage: nc_session` から復帰する
- ゲーム終了30秒後にデータを自動削除

## ゲスト保持・復帰（2026-09-08 B-30 / P-11）

- 共通規約の「ゲスト切断＝player全体remove」の承認済み例外。全5フェーズでplayer本体、gameRole／changedName／ready／提出済みvotesを保持する。一時切断者も全ready・全投票の分母に含め、開始だけは全在籍guestの接続を待つ。名前変え役・投票役が各1人以上という進行条件は変更しない。
- `nc_session` が残る同じタブのリロード・一時切断が対象。別端末・別タブの本人確認を追加しない。保存JSON、isHostの型、名前長とRTDBキー禁止文字、最新roomのhost／player.isHostを検査してからstateを変更する。gameRoleは保存値でなくDBを正とする。名前の上限（GM8／guest12／変更後16）は維持する。
- `.info/connected` の再接続ごとに新しい接続IDを作り、当該IDへのremove予約受付後にroom transactionで最新の存在・役割・フェーズ・TTLを確認して接続を追加する。予約・登録・取消は直列化し、ローカル世代で古い非同期処理を無効化する。消えたroom／playerを取得済みsnapshotや子ノードsetで作り直さない。旧IDのremoveは新IDを消さない。
- 初回joinはtransaction完了まで一時value購読を保持し、`get()`結果のfallbackを使わない。TTLは入室・保存復帰・接続・操作・掃除で通常2分／進行3フェーズ30分を共通利用する。旧guestJoinだけ2分だった掃除判定を訂正し、進行中の30分を短縮しない。host切断中のphase変更では絶対期限を再計算し、timer発火時にも最新状態を再検査する。
- 名前・役割はnaming／未readyの既存guestに対して1回のroom transactionで確定する。票は送信時のmappingをコピーし、voting／未提出voter／最新changer全件のキー・候補・一対一対応を検査する。ref・nickname・isHost・phase・接続世代・操作所有tokenを捕捉し、古い送信やfinallyが新しい操作を上書きしない。単方向5フェーズで同ルーム再戦はないため、新roundIdは追加しない。
- 未提出の投票下書きは同じ接続の無関係なvalue更新で消さず、切断または候補集合の変更で破棄・再描画する。リロードによる下書き復元は保証しない。提出済み票はDBから表示し選択を無効化する。名前変え役の明示退出で既存票を消したり再投票を要求したりしない。
- guestの明示的な「TOPに戻る」は予約取消後に自playerを削除する。結果一覧は現在のplayersから描くため、退出者の行・票は対象から外れる。一時切断では外さない。通信断overlayにも退出ボタンを置くが、通常途中画面の常設退出やGMの途中終了を新設しない。取消が通信待ちなら退出完了も待機し得る。room／player消失時の内部cleanupは明示退出と分離し、GMもsession・監視・overlayを片付ける。
- 終了の`deleteAt`（確定時刻＋30秒）を維持し、GM復帰は最新transaction snapshotとlistenerから残り時間で予約する。同ref／同deleteAtの重複予約を抑止する。GMがTOPへ戻ったり新roomへ移ったりしても、旧ref／deleteAtを捕捉した削除timerは継続する（共通の退出時timer解放の固有例外）。削除前に予約取消、一時value購読、最新done／deleteAt一致を確認する。期限削除とphase・回答確定は`applyLocally:false`で未確定通知による自己失効を防ぐ。
- 終了削除の失敗後の自動回復は保証しない。GMが予約を取り消してTOPへ戻った場合、hostDisconnectedAtが成立せずTTL掃除も必ず働くわけではない。新しい再試行機能・ホスト自動復旧・認証境界は追加していない。
- 旧版が予約したplayer全体removeは新しい接続から取り消せない。公開後は**全員が新版を読み込んだ新規ルーム**で利用する。
- 差分200行超は、切断予約・保存復帰・送信競合・TTL／done削除・UIを一体で整合させる、1アプリの保持復帰ライフサイクルという不可分の関心事による。共通JS／rules／設定は変更しない。

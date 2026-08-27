# ピタハメ — アプリ固有仕様

ボードゲーム「ウボンゴ」着想のポリオミノ・スピードパズル。カラフルなピースをドラッグ＋回転でグレーの型（シルエット）にぴったりはめる。

- **仕様の正本は [`docs/pitahame-design-v1.md`](../../docs/pitahame-design-v1.md)**。本ファイルは差分と実装上の決定値のみを記録する。
- 利用シーン: ボドゲクラブ（`bodoge`）／ ひろば（`hiroba`）。
- 意図的に「スピード競争」を残すアプリ（room-K の「競わない」原則を意図的に外した事例）。ただし v1 の競争はラウンドごとの完成順のみ。

## ファイル構成

- `index.html` 単一ファイル（CSS/JS インライン）。RTDB 単一ファイル規約に合わせる。
- 問題カタログは `index.html` 内の `PITAHAME_PUZZLES`（マーカー `PITAHAME_PUZZLES_START` / `_END` 区間）にインライン埋め込み。**正本は [`scripts/pitahame-catalog.json`](../../scripts/pitahame-catalog.json)**。再生成時はこの区間を差し替える（1問1行を維持）。
- ピース定義・回転規約（`PIECE_DEFS` / `orientationsOf` / `rotateCW`）は [`scripts/pitahame-gen.mjs`](../../scripts/pitahame-gen.mjs) と**完全に同一のセマンティクス**で移植している。生成器を変更したらアプリ側も同期すること。
  - r = 時計回り 90°回転の回数（0-3）。回転式 `(x,y) -> (-y, x)` → 再正規化（minX=minY=0）。
  - トレイ初期向きは `orientIndex=0`（= r=0）。「回す」は `orientationsOf` と同じ重複除去済みの distinct 向きを循環する。

## 実装済み範囲（フェーズ2 ＋ フェーズ3）← 現在ここ

**ひとりで練習（ソロ）＋ みんなで（RTDB 対戦）の両方が実装済み。**

### フェーズ2（ソロエンジン）

- 画面: TOP → 難易度選択（やさしい／むずかしい）→ パズル → 完成演出。
- 操作: タップで選択（太枠）／Pointer Events でドラッグ配置（マウス・タッチ両対応、スナップ候補プレビュー）／「回す」「戻す」「全部戻す」「答えを見る」。
- **ドラッグ中の回転**（2026-08-27 子ども実機FB対応）: タッチ=ドラッグ中にもう1本の指で stage をタップ／マウス=右クリック（非ドラッグ時はカーソル下のピースを選択して回す）。実装は `rotateDragging()`：**回転軸は外接矩形の中心固定**（grab オフセットに外形差の半分 `(newW-oldW)/2, (newH-oldH)/2` を足すだけ）→ `buildPieceCells` でセル再構築 → `updateDragAt(lastX,lastY)` でプレビュー引き直し。⚠️ 掴んだ点を軸にしてはいけない：本体が指のまわりを振り回されて横に滑り、2向きピース（I/S/Z系）は元の向きへ戻るとき90°×3回分が一度にかかって下へ回り込む（実機FB 2026-08-27）。配置失敗で**盤面**へ戻すときは snapshot の orientIndex も巻き戻す（回転後の形が元位置に置けるとは限らない）。トレイへ戻すなら向きは保つ。
- **マグネット式スナップ**（2026-08-27 実機FB「判定が厳しくてハマらない」）: 候補は最寄りマスへの丸め1点ではなく、丸め位置の周囲±1マスから有効配置を探す（`updateDragAt`）。許容は **`SNAP_RADIUS`（0.85セル）・各軸独立**（斜めずれでも軸ごとの寛容さを保つためユークリッド距離をゲートにしない）、複数候補は距離の近い順。**1.0 未満必須**（隣マスに整列した無効位置から丸ごと1マス飛ぶのを防ぐ）。プレビューは吸い付き先の位置に描くので離す前に着地点が見える。無効時の赤プレビューは従来どおり丸め位置。
- **枠外リリース＝トレイへ戻す**（2026-08-27）: pointerup 時に外接矩形がボード枠に全くかかっていなければ（`drag.overBoard === false`）、盤面発のピースもトレイの自席へ戻す（向きは保つ）。枠にかかっているが置けない位置＝ニアミスは従来どおり元の位置へ復帰（盤面配置を失わせない）。`=== false` 必須（移動なしタップは overBoard 未計算＝対象外）。pointercancel は常に snapshot 復帰。Android の長押し contextmenu は `drag.pointerType!=='mouse'` で誤回転を弾きメニュー抑止のみ。iOS の長押しコールアウトは `.ph-stage` の `-webkit-touch-callout:none`。**発見性**: ショートカットは操作ボタン直下の常時ヒント `#rotateHint` で案内（load 時に `(pointer: coarse)` でタッチ/マウス文言を出し分け。実機FB「右クリックで回せることが他の子にわからない」2026-08-27）。
- **盤面上の「回す」は行き止まりにしない → 浮き（loose）状態**（2026-08-27 実機FB）: 同位置→壁蹴り（±1マス）で置ける向きを探し、どこにも置けなければ**新しい向きのまま `location:'loose'`（浮いた状態）でその場に残す**（中心をなるべく保って `clampLoose` で stage 内に収める・wiggle 演出）。トレイへ飛ばすと掴み直しが遠く「回して隣にはめ直す」流れが切れるため。loose の性質: 盤面グリッド座標で描画・`.is-loose` の浮き影・**完成判定（`isComplete`）と占有判定（`occupiedMap`）には入らない**（`location==='board'` のみ対象のため追加実装不要）・浮いたままの再回転は制約なし・ドラッグで置けば board / 枠外リリースや「戻す」でトレイ・ドロップ失敗の復帰は loose 位置へ（向きは保つ）。sessionStorage の盤面復元は location 文字列をそのまま往復するので loose も自然に復元される。
- 出題順は難易度選択画面の「問題の順番」で選ぶ（2026-08-27 リクエスト対応）: 既定「やさしい順」＝カタログの配列順（ID順＝易→難）／「ランダム」＝難易度ボタン押下時に Fisher–Yates でシャッフルした index 配列（`state.soloOrder`）を1周（重複なし・全問網羅）。進捗表示「○ / ○」は出題順の位置（`state.soloPos`。`loadPuzzle` が soloOrder.indexOf で導出するので E2E の直接呼び出しでも整合）。「次の問題」で次へ、最後まで行ったら「全部遊んだよ！」で難易度選択へ戻る。順番の選択もふくめ**進捗の永続化はしない（ページ内メモリのみ／設計 §3）**。
- 論理座標は常に整数グリッドで保持し、CSS 座標から状態を逆算しない（`state.pieces[].{x,y,orientIndex,location}` が正）。
- パズル領域（`.ph-stage`）のみ `touch-action: none`。`prefers-reduced-motion` で完成演出（紙吹雪・シェイク・ウィッグル）を縮小。
- **レイアウトはパズル開始時に確定し、途中で動かさない**（2026-08-27 子ども実機FB対応）: トレイは全ピースぶんの正方スロット（maxDim 基準）を常に確保し、盤面に置かれたピースの席も空けたままにする。これにより `estimateStageHeight` が配置状況に依存しなくなり、セルサイズ・stage 高さ・残りピースの位置がパズル中一切変化しない（再計算はウィンドウリサイズ時のみ）。全ピース設置後も stage は縮めない。
- ドラッグの move/up/cancel リスナーは**要素ではなく document に付ける**（layout() の renderPieces がピース要素を作り直すため、要素付けだとドラッグ中の再構築でリスナーごと消え `state.drag` が残留して操作不能になる）。`setPointerCapture` は滑らかさ向上用の補助で try/catch（高速タップで例外になりうる）。ヒットテストは `.ph-piece`（外接矩形）を `pointer-events:none` にして実セル `.ph-cell` のみ。持ち上げ表示（LIFT）はタッチ/ペンのみでマウスは 0。up の取りこぼしは、同一 pointerId の再 down（iOS の id 再利用）と mouse の `buttons===0` な move で検知して自己修復する。

### 盤面エンジンの共通化（フェーズ3 で導入）

- カタログエントリ（種類名参照）は `expandCatalogPuzzle()` で**自己完結パズルオブジェクト**（`{formatVersion,id,w,h,cells,pieces:[{type,cells,trayOrder,orient0}],sol}`）へ展開する。solo/room とも同形を `mountPuzzle()` に渡す（経路統一）。
- ピース定義は種類名ではなく**各ピースの base cells から** `buildPieceDef()` で構築（`state.pieceDefs[idx]`）。種類名は色引き（`PIECE_COLORS`）だけに使う。RTDB から来た未知種類でも base cells だけで回転・判定できる。
- 基準解の描画は `renderSolution(container, puzzle, {animate})` に共通化（solo「答えを見る」/ results の答えアニメで共用）。

### フェーズ3（RTDB 対戦）

RTDB パス `pitahame_rooms/{roomCode}`。実装は末尾 `<script>` 内の **`Net` モジュール**（IIFE）に集約。設計 §7〜§10・§8スキーマに準拠。

- **モード分岐**: `state.mode`（`'solo'|'room'`）。パズル画面（`screen-puzzle`）を両モードで再利用し、`applyPuzzleChrome()` で残り時間バー・カバー・フィード・答えボタン表示を切り替える。RTDB 由来の画面遷移・問題切替の直前は必ず `cancelDrag()`（`mountPuzzle` 冒頭で実行）。
- **共有状態のみ同期**: 参加/退出・ラウンド開始・各人の完成1回・status 遷移・削除だけを書く。ピース移動・ドラッグ・タイマー・選択は同期しない。
- **リスナー分割購読**: ルート `on('value')` は張らない（finishes 更新のたびに puzzle まで再送されるため）。トップは `status`/`currentRound`/`gameId`/`settings`/`players`/`hostConnected`/`hostDisconnectedAt`/`finishedAt` を個別購読。ラウンドは `rounds/{n}` 配下（`attemptId`/`puzzle`/`startAt`/`endsAt`/`closedAt`/`participants`/`resultOrder`/`finishes`）を個別購読。ルーム消滅は `status` が null になったことで検知。
- **transaction を使う箇所**: 作成（`createRoom` ルート占有）／参加（`joinRoom`）／ラウンド開始（`startRound`）／完成登録（`onLocalComplete`）／ラウンド終了（`endRound`）／最終遷移（`hostNext`）／やりなおし（`restartRound`）／もういちど（`playAgain`）。すべてルーム全体 transaction。
- **⚠️ ルート未同期 → transaction 初回 null 対策（warmTxn 方式）**: リスナーを子ノードに分けたため、素の `roomRef.transaction` は初回ローカル評価が未同期の `null` になり、`undefined` 返し＝中断（再試行なし）で誤中断する。対策は共通ヘルパ `warmTxn(ref, mutator)`：**一時的にルート listener（noop）を張り `.get()` でローカルキャッシュを温めてから transaction を実行**する（listener があると transaction は同期済みの実値をローカル評価に使う）。**実値 `null`＝ルーム消滅は必ず中断**（mutator を呼ばない）。stale スナップショットをフォールバックに使わないため、「.get() 応答〜コミットの間にルームが削除された」ケースでも削除済みルームの再生成（hostConnected=true のまま TTL でも回収不能なゾンビ化）が**構造的に起きない**。`.get()` 失敗時も transaction へ進まず中断。適用: `joinRoom`（expired 時の `return null`＝ルーム削除は仕様として維持し、コミット後に snapshot 非 null を確認してから参加続行）／`tryReconnect` のゲスト復帰／ホスト系は `roomTxn(mutator)`＝`warmTxn(net.roomRef, mutator)`。`createRoom` の「null なら initial を作る」transaction だけは意図的な新規作成なので素のまま。
- **⚠️ バックグラウンドタブ対策**: 盤面 mount を `requestAnimationFrame` に載せると、タブが非表示のとき rAF が止まり盤面が出ない。room の mount は **同期実行**（`showScreen` 後 `clientWidth` は reflow 済みで取れる）＋保険で次フレーム再レイアウト。
- **公平性・順位**: `computeResultOrder()`（設計 §9 厳守）。採用時刻＝`completedAt` が有限かつ `startAt≤completedAt≤endsAt` ならそれ、でなければ `receivedAt`。昇順ソート→同着はグループ先頭との差 1000ms 以内→密順位（①①②）。`completedAt=RoomkRTDB.now()`（完成判定直後）、`receivedAt=ServerValue.TIMESTAMP`。results は **`resultOrder` のみ**を描画（finishes を直接ソートしない）。
- **カバー/カウントダウン**: `startAt`（= `now()+5000`）までは `.ph-cover` で盤面を隠し 5→1 をクライアント導出（独立 status にしない）。残り時間は数字なしのバー（`.ph-timebar`、`endsAt` までの割合）。
- **ラウンド終了条件**: ①participants 全員完成（`maybeHostEndOnAllDone`）②`endsAt+2秒`でホストが自動終了（`scheduleHostEnd`、送信中の完成を拾う猶予）③ホストの「ラウンドを終わる」。
- **切断・再接続**: ホスト `onDisconnect().update({hostConnected:false, hostDisconnectedAt:TS})`、ゲスト `players/{nick}` を `onDisconnect().remove()`。TTL 2分（`ORPHAN_TTL_MS`）。ゲストにホスト切断オーバーレイ。**ラウンド中のホスト復帰**は自動で finishes を消さず、ホストがオーバーレイ「このラウンドをやり直す」を押したときだけ `restartRound`（attemptId 更新・finishes クリア・新 startAt で同一問題を再開）。
- **⚠️ ラウンド購読切替とキャッシュ残留**: `stopRoundListeners` は必ずラウンドキャッシュ（attemptId/puzzle/startAt/endsAt/closedAt/participants/finishes/resultOrder/loadedKey/myFinished）をリセットし、`roundGen` 世代ガードで off 後の旧コールバックを無効化する。分割購読では rounds 削除の null イベントが届く前に off されるため、リセットしないと前ゲームの finishes がフィードを汚染し以後更新されなくなる（実バグ 2026-07-22）。フィード描画は finishes との**リコンサイル方式**（`data-nick` 突合せ・追記専用禁止）。`restartRound` の attemptId 変更は**同一ラウンド再購読**で拾う（変更のないノードは再送されないため手動クリアでは復元不能）。`endRound` はタイマー/判定**作成時点**の roundNo+attemptId を transaction 内で照合し、`all_done` はサーバ値で全員完成を再検証する。
- **sessionStorage**: 再接続キー `pitahame_session`（roomCode/nickname/role）。盤面復元キー `pitahame_board` は `roomCode|gameId|roundNo|attemptId|puzzleId` を全部含め、ひとつでも不一致なら破棄。results 表示・退出・やりなおし・もういちどで対象配置を消去。ゲストの新規参加は `waiting` のみ、round 中の復帰は participants 所属時のみ `players` へ復帰（別フロー）。
- **自動削除**: `finished` 移行で `finishedAt` 保存 → 30秒後に status===finished かつ 同一 gameId なら remove。「もう一度遊ぶ」は gameId を更新して waiting へ（設定保持・削除ガード）。「ルームを閉じる」は即 remove。
- **開始条件**: `isPlaying` な参加者が2人以上（満たなければボタン無効＋「あと○人」）。「わたしも遊ぶ」OFF＝進行専任（`isPlaying:false`）。

### 検証用フック

`window.__pitahame`（`state`/`isValidPlacement`/`isComplete`/`checkCompletion`/`loadPuzzle`/`mountPuzzle`/`layout`/`Net`）を公開。ドラッグ自動操作が不安定な E2E のフォールバック用（`Net._net` で共有状態キャッシュを確認できる）。

### フェーズ4（仕上げ）— 完了

howto.js 組み込み（`position:'left'`）・ポータルカード（`data-scenes="bodoge hiroba"` + `data-slides`）・updates.json・`scripts/lint.sh` の `RTDB_HTML_FILES` 登録・slides.html・文言監査まで完了。lint はエラー0・警告0。

### 既知の注意点（設計との差分・実機ゲートで確認）

- **狭いスマホ幅（375px）でのみ**、howto の「？」FAB の角が「全部戻す」ボタンの左下と僅かに重なる。共有 howto.js（下部固定FAB）＋下部操作ボタンの構造上コンパクト画面では不可避で、他 RTDB アプリと同様。desktop / tablet(768px) は重なりゼロ。`'left'` は右列の「戻す」「答えを見る」を完全に避けるための選択（`'right'` だと「答えを見る」に重なる）
- **設計 §11 の時間切れメッセージ「ここまで！」は独立表示せず**、endsAt 到達で results（完成した順＋「こんな置きかたもあるよ」）へ直接遷移する簡略実装。禁止語違反はなし。表示要否はメンター実機で判断

## ピース色パレット（13色・決定値）

種類ごとに固定色。形（白いマス区切り線＋濃い輪郭）でも判別できる前提の補助情報として、色相を全周に散らし、赤緑のみの区別に頼らない配色にした。彩度・明度は design-system のネイビー／ティール基調と喧嘩しない中間トーンに寄せている。

| ピース | 色 | 色相 |
|--------|------|------|
| I3 | `#D64550` | 赤 |
| L3 | `#E8792B` | オレンジ |
| O4 | `#E6A817` | 琥珀 |
| I4 | `#8FA31E` | オリーブ |
| T4 | `#4C9A5A` | 緑 |
| Y5 | `#2FA98B` | ティール |
| L4 | `#4A90D9` | 空色 |
| J4 | `#3E63C0` | 青 |
| S4 | `#6D53C4` | 藍 |
| T5 | `#9B4FC0` | 紫 |
| Z4 | `#C64B9E` | マゼンタ |
| P5 | `#DB4F7A` | ピンク |
| L5 | `#A9714B` | 茶 |

- セルは fill 色＋`inset` 影の二重リング（内側=白い区切り線／最外=濃い輪郭）で、隣接ピースが近い色でも境界が読める。
- フェーズ3で RTDB 化する際、色は機能に影響しないためローカル定義でよい（設計 §5）。種類名から引けない未知ピースは既定色（`#888`）にフォールバックする。

## CSS 命名

接頭辞 `.ph-`（BEM: `.ph-board__cell` 等）。子ども向け・ひらがな多め。「ざんねん」「まけ」「できなかった」は使わない。絵文字禁止・アイコンは Material Symbols Rounded。

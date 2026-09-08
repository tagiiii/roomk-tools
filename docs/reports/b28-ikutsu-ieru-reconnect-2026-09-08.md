# B-28 いくつ言える？のゲスト保持・復帰

2026-09-08。基準HEADは `99c9e29fcaf09ceb0b2aa46bc878ff854e2be5f0`（B-27公開後）。P-11で承認されたゲスト復帰の段階導入として個別起票した。

## 最新状態: コミット記録・PR準備（2026-09-08）

オーナー承認により、作業ブランチ `fix/ikutsu-ieru-guest-reconnect-20260908` で実装3ファイルを `0f43639ea27de21b00352a7af7f28292c61fd817` にコミットした。本体SHA256 `208c4bfa56342c4682b881ccd61d967b70e62a34901b7b73bab6e7022ffee442` は検証済み版から不変。文書・証拠8ファイルは後続の文書コミットへ分離する。文書コミットのhashは自己参照を避け、git logで確認する。

B-28は実装と隔離検証の完了としてチェック済み。実SDK30件・補助VM37群、同系統の別コンテキストによる独立レビューの範囲・限界は以下の記録を継承する。この準備時点では未push・実PR未作成・未マージ・未公開。マージと公開は別工程であり、本番Firebase／iPhoneの確認は行っていない。以下の「未コミット」や「コミット時に記載」は前工程当時の履歴として残す。

## 前工程の状態（履歴）

実装・隔離検証済み。実SDK30件・補助VM37群が通過し、独立コードレビューと保存証拠の整合確認は追加修正要求なし。未コミット・未公開で、本番での動作確認を意味しない。

## 対象と設計判断

- 対象はikutsu-ieru本体・固有AGENTS.mdとupdates.json先頭1件。themes.js・共有コード・rules・Firebase設定・CI・他アプリは変更しない。
- waiting／input／review／finishedでguest本体を保持し、切断予約は接続IDのremoveだけにする。同一保存sessionで復帰し、欠損playerを再追加しない。初回joinには一時value購読、presence登録には存在・役割・status・TTLのtransaction再検査を用いる。
- 接続の世代とroom参照を捕捉し、予約・更新・取消を直列化する。退出・消失・期限切れで古い非同期処理を無効化する。
- 回答追加／削除はroom transactionへ変更し、既存round・ref・接続世代・現在の在籍とinput状態を検査する。削除は配列の位置だけを信用せず、期待する回答配列と異なれば再試行用の表示へ戻す。同じ文章の複数回答は従来どおり許可し、新たな回答IDスキーマは導入しない。
- 回答操作とhistory確定を同じroomのtransactionで順序付けする。回答が先に確定すればhistoryへ含め、reviewが先なら遅い回答を拒否する。古いcatch／finallyが新しいお題や操作中の状態を壊さないようにする。
- waitingの開始は全在籍guestの接続を待つが、ホスト1人での開始は許可する。他アプリの最低人数制限を移植しない。次のお題ではpresenceを保持し、既存どおり回答を初期化する。
- finishedの30秒削除とhost切断TTL2分は維持。削除は捕捉refと最新状態を再確認し、予約取消を先行する。監視中guestのTTL削除とfinished削除にはapplyLocally:falseを使う。初回参加・復帰前の期限切れ処理は一時購読を使う通常transactionである。絶対時刻のfinishedAtを追加する仕様には変更しない。

## アプリ固有で維持すること

回答順・24文字上限・空文字拒否・同文重複の許容・0件での振り返りを維持する。匿名表示、ホスト画面だけのローカルな名前切替、自分以外の件数を表示しない方針は変更しない。ランキング・性格別の推薦・新規コンテンツは追加しない。

実コードでは回答受付の境界はhostによるstatus=inputからreviewへの確定であり、endAtだけでadd／removeを拒否してはいない。元AGENTS.mdの「ゲストは0秒でreview表示へ自動遷移」という説明は実コードと一致していなかった。今回は独自の時刻ハード締切やゲストの自動進行を追加せず、実挙動を維持して文書を訂正する。

明示退出はplayerと未確定の回答を削除するが、すでにhistoryに確定した回答は残す。前アプリB-27の「退出で結果の行も消す」とは異なる。単なる通信断ではplayerも確定historyも削除しない。

## 検証計画と制限

実Firebase SDK＋隔離Emulator／Playwrightで4フェーズのリロードと連続断復帰、追加・削除・同文重複・history保持・次のお題・終了後30秒削除・明示退出・TTL・欠損／不正session、PC1280／375pxを確認する。意図的に遅らせる予約・transaction・確定との競合は補助VMとして別記する。

同系統の別コンテキストで実装と独立レビューを分離する。異系統モデルの二重承認や実SDKの独立再実行とは表記しない。iPhone操作・本番Firebaseは使わない。sessionStorageは本人確認の境界ではなく、別端末・新しいタブ・保存情報消去後の復帰を保証しない。旧版のplayer全体remove予約は新版から取消できないため、公開後は全員が新版を読み込んだ新規ルームで利用する。

P-12などの保留6件とA-11未判定44箇所は据え置く。コミット・PR・マージ・公開は実装・検証後の別工程。

## 隔離構成と着手前チェック

新規スクラッチ `b28-sandbox.71xLwS` に `demo-roomk-b28` のAuth9099／RTDB9000／Hosting5500／UI4000をloopback限定で設定する。statsはno-op、CSPでデータ通信先をloopbackへ限定し、SDK初期化順序と本番設定の混入をgateで検査する。themes.jsは変更せずコピーする。既存B-26／B-27のスクラッチ証拠は保持する。

finishedの30秒削除と復帰試験は別々のルームでも確認し、検証の都合で削除定数を延長しない。TTLは別の過去時刻fixtureとし、30秒実時間待機と区別する。

着手前lint全16項目とA-11既存回帰114fixture＋9 shellケースは通過。71ファイル・未判定44・ERROR0で、未判定を安全と認定したものではない。

## 初回コードレビュー

初回凍結版SHA256 `208c4bfa56342c4682b881ccd61d967b70e62a34901b7b73bab6e7022ffee442` の独立コードレビューは追加修正要求なし。レビュアーは実helperを抽出したメモリ対照7件で、古い削除添字、review先行、次round、接続世代変更、旧reject後の新token／入力、新しい入力文字列の保持、欠損playerを確認した。保存VM・実SDKの完成前のコード確認であり、全受入試験の合格ではない。

moveToReviewはref／roundを捕捉し、遅いhost確定が次のお題へ適用されないようにした。回答リストはvalueリスナーを正とし、古いPromiseのsnapshotやロールバックで新表示を上書きしない。hostNextRound／hostFinishの既存updateまで全面変更はしておらず、全ホスト書込みの原子性保証とは扱わない。

content-auditはexit 0。既知coverage警告7件・構造候補11件を維持し、themes.jsは無変更。

## 補助VMの結果

[再現スクリプト](evidence/b28-ikutsu-ieru-presence-2026-09-08.mjs) と [保存JSON](evidence/b28-ikutsu-ieru-presence-2026-09-08.json) を保存。`node docs/reports/evidence/b28-ikutsu-ieru-presence-2026-09-08.mjs` で実アプリのscriptを抽出して実行する。37群が通過し、主担当と独立レビュアーがそれぞれ再実行・保存JSONとの一致を確認した。対象本体は `208c4bfa56342c4682b881ccd61d967b70e62a34901b7b73bab6e7022ffee442`。

- 回答／確定historyを保持した2回の再接続、予約受付待ち中の切断、旧接続remove、新roomへの遅延処理の非干渉。
- 同文重複と指定添字削除、配列が変わった場合の削除拒否、空回答・文字数上限、送信中の連打拒否。
- round・接続世代・room・player・役割・TTLが変わった遅延回答の拒否、回答先行／review先行の両順序でhistoryを検査。
- 新しい入力文字列・操作所有tokenを古いabort／reject／finallyが上書きしないこと。
- 全ゲスト接続待ち、ホスト単独開始、次roundのpresence保持、status=inputが維持される間の既存受付条件。
- 30,000msの終了タイマー、捕捉refへのcancel helper呼出しと非楽観削除、round／ref／phaseが変わった削除の拒否。
- TTL・欠損時の解除、不正sessionのstate変更前拒否、一時join listenerのcommit／abort／reject／value-error時解除。

これは合成のtransaction・予約順序による検証であり、実SDKの再試行プロトコルや通信の保証ではない。旧予約は旧パスへの直接remove、cancel helperは呼出しspyである。DOMは最小stubで、追加ボタンの無効化を確認する一方、削除ボタンのquerySelectorAllは実DOMを再現していない。削除ボタンの操作状態は実ブラウザ確認と分ける。

## 実SDKで確認した経路

最終候補208c4bfaの実SDK初回UI参加（ホスト＋ゲスト2人）が成功。waiting／input／review／finishedでリロードとブラウザ層10秒断復帰を確認し、各phaseで断復帰を2回行った。

回答順・同文重複保持と指定添字削除、24文字受理／25文字拒否、review匿名表示とホストローカルの名前切替、確定historyがcurrent player変更・退出で変わらないこと、次roundでの回答初期化とhistory保持を確認した。finishedでは削除定数を変えず、復帰試験後に実際の30秒タイマーでroomが削除され、ホスト・ゲストがTOPへ戻り、再接続・リロードでも再生成しなかった。

主担当は375pxのinput切断待ちとreview画像を目視し、待機文・退出ボタン・回答タイルが画面内に収まることを確認した。

| 追加確認 | 結果と方法 |
|---|---|
| 操作ボタン | 実DOMで追加ボタンと回答削除ボタン2本が切断時disabled、復帰時に解除されることを確認 |
| 境界 | host1人で開始、欠損playerと不正session4種の拒否を確認 |
| TTL | ホスト切断時刻を125秒前／119秒前に設定し、即時判定と既存timer経由の削除を確認。2分間を実時間待った試験ではない |
| セキュリティ表示 | 単一引用符・HTML文字列を持つ合成保存データをinput／review／finishedで表示。文字列を保持し、img要素の追加と実行flagなし。24文字を超えるpayloadはREST fixtureであり、通常入力で送信できると主張しない |
| 終了画面 | 主担当がPC1280のfinished画像も目視。回答あり／0件の履歴とTOPボタンを確認 |

今回のコードレビューで追加のコード修正要求はなく、固有AGENTSの適用範囲表記のみ2点を訂正した。applyLocally:falseは監視中guestのTTL／finished削除に限定し、初回参加・復帰前のremoveExpiredRoomは一時購読を使う通常transactionであることを明記した。本体SHAは初回候補から変更していない。

最終lint16項目・diff checkも通過。本体の追加247行・削除59行（計306行）は目安200行を超えるが、presence登録・回答更新・世代無効化・退出・TTL・終了削除を分けて適用するとデータ消失や再生成が残るため、1アプリの不可分の復帰処理としてまとめた。コミット時にもこの理由を記載する。

## 保存証拠と最終確認

実SDKの[実行補助スクリプト](evidence/b28-ikutsu-ieru-emulator-2026-09-08.mjs)と[結果JSON](evidence/b28-ikutsu-ieru-emulator-2026-09-08.json)を保存した。30件すべて通過。スクリプトは隔離ブラウザでの段階実行用であり、単独実行するPlaywrightテスト一式ではない。各段階でURL・project・Auth／RTDB接続先・context数・role・CSPを検査する。

inputからreviewへのSDK試験はホストのevaluateによるmoveToReview()呼出しであり、endAt到達による自然なタイマー遷移を検証したものではない。一方、finished削除は実タイマーで30,027msを測定した。TTLの過去時刻fixtureでは125秒前が17ms、119秒前が1,028msで削除された。人工的な競合順序の保証は補助VMの範囲に限定する。

通信記録537件は許可した7 origin内、意図的なOffline操作に伴うconsoleエラー56件以外の予期しないエラーとpageerrorは0件。監視は各試験ステップ中のみで、初回ホスト作成前後やステップ間を含む全期間の完全なログではない。監視外の初回favicon 404は別記した。公開JSONにはURLのquery・tokenを残さずorigin別件数だけを記載した。

独立レビュアーは保存JSONとrawの全30件、通信origin集計、console分類、room／statsの空状態、repo／scratch／証拠JSONの本体SHA一致を確認した。実SDK試験を独立に再実行したという意味ではない。主担当の画像目視はinput切断待ち375px・review375px・finished1280pxの3枚。

終了時のrooms／statsはいずれもnull。専用b28ブラウザを閉じ、所有するEmulator CLIへSIGTERMを送り正常終了を確認した。CLI PID20910・Java PID20953は停止済み、4000／4400／4500／5500／9000／9099にLISTENがないことを主担当とレビュアーも確認した。スクラッチは証拠保存のため残し、旧検証環境には触れていない。

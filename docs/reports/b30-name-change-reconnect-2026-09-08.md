# B-30 名前変えゲームのゲスト保持・復帰

2026-09-08。基準HEAD `9a3a81916c3f3d12c05b7d5c2e162952fd9df98b`（B-29公開後）。P-11承認の段階展開。

## 最新のコミット記録（2026-09-08）

オーナーのコミット・PR作成承認により、作業ブランチ`fix/name-change-guest-reconnect-20260908`で実装を`629f1c597780c92c52e9018e170eaf28fd6b20d0`（`fix(name-change): ゲストの役割と投票を保持して再接続`）へ記録した。対象は本体・固有AGENTS・updatesの3ファイルのみ。本体SHA256 `5bddcfd7c1f527298dedb768a3076c6b20f3349ad410cf78eb2739eb52524cb9`は検証済みのまま変更していない。差分200行超の不可分理由をコミット本文へ明記した。

B-30を完了チェック付きで記録し、報告／索引／backlog／P-11の4文書と既存証拠4ファイルは別の文書コミットとして準備する。証拠結果の書換えやSDKの独立再実行はしていない。この記録時点では文書コミット前・未push・実PR未作成・未マージ・未公開であり、main／origin/mainは基準HEADのまま。PR作成後もマージ・公開は別工程である。以下の未コミット・チェック保留・未実装等は各工程当時の履歴として保持する。

コミット工程でfetch後のmain同期、lint全16項目、diff check、補助VM65群の保存JSON全体一致を再確認した。実SDK41件は前工程の最終版証拠を継承し、実測・人工順序試験・保存証拠の独立確認の区別と制限は下記を参照。P-12等の保留6件・A-11未判定44箇所は不変。本番Firebase・iPhone・外部メタバースの操作はしていない。

## 前工程の状態と範囲（履歴）

個別設計・起票を経て、オーナーの「次の作業をお願いします」により実装・隔離検証を実施した。最終版`5bdd…`で実SDK41ケース・補助VM65群が通過し、本体・保存証拠・文書の最終独立レビューもPASS。実装・補助VM、実SDKブラウザ検証、独立レビューを別コンテキストへ分離し、主担当が統合確認した。未コミット・未公開。B-30の完了チェックは実装コミットを記録する工程まで付けない。本番Firebase・iPhone・外部メタバースの操作は行っていない。

実装対象はname-change本体・固有AGENTS・updates先頭1件と検証証拠に限定。shared／rules／Firebase設定／CI／他アプリは変更しない。P-12等の保留6件、A-11未判定44箇所は維持する。

## 現コードから確認した固有仕様

- フェーズはwaiting → naming → voting → revealing → doneの一方向。同じルームでの再戦はなく、roundフィールドもない。復帰のためだけに新roundIdを追加しない。
- 最小人数はGMを除く参加者2人（合計3人）。GMは名前変え・投票に参加しない。投票へは全参加者readyかつ名前変え役・投票役各1人以上、結果へは全投票役の提出が必要。
- GM名は1〜8文字、参加者の元の名前は1〜12文字、変更後の名前は1〜16文字。票は名前変え役の全員への一対一対応で、同じ候補を重複して選ばない。
- 保存対象はplayersのgameRole／changedName／ready／votesと、ルームのrevealOrder／status／deleteAt。同じタブのnc_sessionによる復帰を対象とする。保存gameRoleは権威にせず最新DBから復元する。本人認証・別端末復帰は追加しない。
- 現在の結果画面は全件の変更前後の名前と正解人数を一覧表示し、コピー操作がある。AGENTSの「1枚ずつフリップ」は旧情報であり、実装時に文書だけ訂正する。新しいフリップや得点機能を追加しない。revealIndex／revealAnswerは既存未使用フィールドとして削除しない。
- host切断TTLはwaiting／doneで2分、naming／voting／revealingで30分。終了時のdeleteAtは現在時刻＋30秒。ホスト再読込はその残り時間で削除を再予約する。

## 採用する実装方針

1. 全5フェーズでguest本体を保持し、presenceVersion:1とconnections/{id}を追加する。切断予約は接続IDのremoveのみ。予約受付後に存在・役割・phase・期限をroom transactionで再検査して接続を追加し、欠損guestを再生成しない。予約・登録・取消を直列化する。
2. 初回joinは一時value購読を保持したtransactionとし、古いget結果のfallbackを廃止する。全入室・保存復帰・presence・操作・掃除で同じphase別TTLを使う。guestJoinだけ2分で進行roomを掃除する不一致を修正し、30分の仕様を短縮しない。
3. actionにはroom参照・nickname・isHost・期待phase・ローカル接続世代・操作所有tokenを捕捉する。単方向phaseと参照により、遅いnaming提出がvotingへ、古い票がrevealingや新roomへ混入することを防ぐ。自分の未確定phase変更で再試行ガードを失効させないよう、必要なtransactionは非楽観通知にする。
4. naming提出は既存guest／naming／未readyを確認し、changerまたはvoterを一度だけ原子的に確定する。連打・役割ボタンの競合では先着を守る。提出成功後の表示とsessionへのgameRole反映はDBを正とし、古いPromiseで上書きしない。
5. 投票は最新changer集合・voter役割・未提出をtransactionで確認し、提出用コピーを固定する。全件・有効候補・重複なしを検査する。下書きはローカルのみで保存保証外。提出済みvotesは保持する。同じ接続での未提出draftは無用なvalue更新で消さず、切断または候補集合変更で破棄・再描画する方針とし、未提出であることを表示する。既存の提出済み票を参加者退出だけで消去・再投票させない。
6. waitingの開始は全在籍guestの接続を待つ。以後の全ready／全votes条件は維持し、一時切断で分母から除外しない。接続だけを理由に自動提出・締切・役割変更しない。明示退出は自分のplayerを削除し、結果は現在のplayersから描く従来の構成を維持する。
7. UIのTOP操作と、room／player消失時の内部クリーンアップを分ける。guestの明示退出は予約取消完了後に自playerをremoveし、古い処理を無効化する。オフラインでは取消完了待ちになり得る。新しいguest切断overlayに退出導線を設け、通常途中画面の常設退出やGMの途中終了を新設しない。
8. GMのdone→TOPでは、捕捉した旧roomRefとdeleteAtによる終了削除を維持する。可変stateや現在の新roomとの一致を必須にしない。削除前の予約取消と最新room.status／deleteAt一致を検査し、不一致はabortする。古いタイマーが新roomを削除したり、TOPで旧roomの削除が失効したりしない。削除失敗時の自動回復は保証しない。TTLによる掃除は実際にhostDisconnectedAtが成立している場合に限り、GMが予約を取消してTOPへ戻った後も必ずTTLで消えるとは扱わない。
9. host切断中のphase変更ではTTLの絶対期限を再計算し、古いtimerを更新する。発火時も最新phase／hostConnected／hostDisconnectedAtを検査する。room消失時はGMも監視・overlay・sessionを解放する。

## 実装時の受入条件

- 実SDK＋隔離EmulatorでGMと参加者を別contextにし、5フェーズ各reload・連続断復帰を確認。役割・変更名・ready・提出済みvotes・発表一覧とdeleteAtを保持する。
- 実UIで名前変え役と投票役を選び、複数changerへの一対一投票・全員提出・結果一覧・コピー・終了へ進む。外部メタバースは操作せずアプリ内だけを対象とする。
- 未選択／提出済み復帰、送信中切断・連打・役割変更競合、候補の明示退出でdraftを再描画、既提出票の保持、未入力者／未投票者の切断で勝手に進まないことを確認する。
- 保存sessionの壊れたJSON・isHost型不正・ホスト名不一致・gameRole不一致・欠損room／player、RTDBキー禁止文字、引用符・HTML文字列を含む表示を確認する。クライアント判定を認証境界とは扱わない。
- TTLは2分超・30分未満の進行roomを初回joinでも削除しないこと、通常2分・進行30分の境界、host復帰やphase変更で古い期限処理を適用しないことを確認。過去時刻fixtureと実時間待機は区別する。
- doneはdeleteAtを変えず実30秒削除とGM再読込時の残り時間を確認。GMがTOPへ戻り新roomを作った後、旧roomだけが削除され、新roomは不変であること。
- 1280px／375pxのホスト・ゲスト表示、コンソール、通信先制限、lint・補助VM・独立レビュー。人工遅延・transaction再試行はVMと実SDKで方法を区別する。

旧版のplayer全体remove予約は別接続から取消できないため、公開後は全員が新版を読み込んだ新規ルームで利用する。仕様判断や共有設定変更が必要になった場合は、この起票を根拠に自動拡張せず止めて確認する。

## 設計確認結果

実装担当と独立レビュアーが本体から人数・単方向phase・結果一覧・TTL例外・deleteAtを照合した。独立指摘により、GMのTOP復帰後の削除失敗をTTLが必ず回収するとは保証しない旨を明記した。追加の人間判断や新しい再試行機能を必須とせず、既存の終了期限を維持する設計とした。

設計工程の前後でlint全16項目・diff check通過。変更は本設計、backlog起票、README索引、P-11の後続参照の4文書のみ。アプリ・設定・検証環境は無変更。本項目の実装／動作確認が終わったという意味ではなく、次工程はB-30の実装と隔離検証である。

## 実装工程の着手確認

main／origin/mainは基準HEADと一致し、既存差分は前工程の設計4文書のみであることを確認して保持した。着手前lintは全16項目通過。A-11は71ファイル・未判定44・raw-source ERROR0であり、安全認定ではない。設計確認結果の未実装等は前工程時点の履歴とする。

A-11検査器の回帰114fixture・実行経路9ケースも主担当が再実行して通過した。新規スクラッチ`b30-sandbox.nFo8qF`を準備し、`demo-roomk-b30`のAuth9099／RTDB9000／Hosting5500／UI4000をloopbackに限定した。statsはno-op、CSPでデータ接続先をloopbackへ制限し、SDK静的ファイルとフォントのみ外部取得を許可する。起動前の静的gateは担当者と主担当がそれぞれ通過した。既存B-26〜B-29の証拠は保持する。

## 初回レビューの指摘

初候補SHA256 `c307d3956877ff0da9ec3884752ba316785c54c1bc80edf842f9d7a644f8df07`に対し、独立レビュアーがGM再接続時の終了削除予約漏れを再現した。最初のgetではrevealing、その後の再接続transactionではdone／deleteAtになった場合、古いget結果で予約要否を判断すると、done画面に復帰しても削除timerが作られない。実際のtryReconnect関数を抽出したメモリ内の順序試験であり、実SDKの時系列を再現したものではない。最新transactionのsnapshotを復帰と期限予約の正本にする修正・回帰を依頼した。初候補のSDK試験は参考履歴へ分離し、修正版の最終合格には含めない。

## 修正版と補助VM

修正版SHA256 `a077b97078b5d599394b24207282926c9ba528b52407aceff595055af2714d33`では、GM再接続transactionの完了snapshotをroom／役割の正本にする。完了後から恒久listener登録までの間にdoneへ進んだ場合もlistener側で保存deleteAtを予約し、同じref・同じ期限はWeakMapで重複予約を抑止する。終了削除失敗時の新しい再試行保証を追加したものではない。

[補助VMスクリプト](evidence/b30-name-change-presence-2026-09-08.mjs)・[保存結果](evidence/b30-name-change-presence-2026-09-08.json)は63群。主担当が再実行し、保存JSON全体と一致することを確認した。5フェーズ保持、遅い予約受付・接続登録、欠損／明示退出、naming先着、投票コピー固定・下書き・提出済みの区別、古い操作所有者、phase別TTL、旧room終了削除、不正session、一時listener解放を確認する。今回の指摘はget revealing→transaction doneで9秒残りの予約1件、listenerへの遅いdone到着で6秒残りの予約を対照に追加した。

これは本体関数を読み込んだNode VMで、transaction・予約・時計・DOMを合成した順序試験である。実SDKの再試行プロトコル、HTML解析／エスケープ／実レイアウト、実クリップボード転送の証拠とは扱わない。旧接続予約は旧pathへの直接remove、共有予約取消は呼出しspyであり、期限試験は時計注入とcallback実行である。実時間の30秒待機と通信は次の実SDK試験で別に確認する。

独立レビューでVMの期限stubが共有実装の`>=`でなく`>`だった点も訂正し、Number変換と各phaseの境界直前・ちょうど・超過を検査した。群数は63のまま。修正後に主担当と独立レビュアーがそれぞれ再実行し、保存JSONとの完全一致を確認した。本体・VM・固有AGENTS・updates先頭1件の再レビューはPASS。これは同系統の別コンテキストによる独立レビューであり、異系統二重レビューや実SDKの独立再実行を意味しない。

## 実SDK検証の経過

修正版へ全4contextをreloadして新roomで検証を開始したが、テスト手順の完了待ち不足により、前stepと次stepが集計オブジェクトを上書きする検証器側の競合があった。アプリの判定結果とは分離し、この途中集計は最終合格へ採用しない。新roomから順次再実行し、各stepの完了を確認して次へ進む方法へ変更した。初候補9ケースも参考履歴のみに残す。

主担当は修正版の`voting-offline-guest375-1.png`／`voting-offline-guest375-2.png`と`revealing-host1280-2.png`をスクラッチから目視した。375pxの切断案内・退出ボタンは画面内に収まり、1280pxのGM結果一覧には変更前後の名前・正解人数・コピー・終了操作が表示される。HTML風の変更名はタグとして解釈されず文字列表示になっている。目視範囲はこの3枚であり、全スクリーンショットの承認や実iPhoneの体験確認ではない。

### 実UIで見つかった再作成ボタンの不具合

`a077…`で5フェーズの復帰と実30秒削除まで20ケースを確認した後、TOPからGM作成画面へ戻ると「ルームを作成する」がdisabledのままで再作成できないことを実ブラウザで確認した。hostCreateRoom成功経路がボタンを無効化したまま保持する既存由来の経路で、B-30受入条件「GMのTOP→新room」を阻害する。テスト側で強制的に有効化せず、作成／参加フォームの同型とともに最小修正・回帰を依頼した。20ケースと失敗記録はスクラッチの参考履歴に保存し、最終版の証拠とは分離する。

最終候補SHA256 `5bddcfd7c1f527298dedb768a3076c6b20f3349ad410cf78eb2739eb52524cb9`では、作成／参加ボタンにIDを付け、resetRoomStateで両ボタンのdisabledを解除する差分だけを追加した。処理中の無効化は維持する。補助VMに実hostCreateRoom成功→room消失TOP→再作成と、実guestJoin成功→明示TOP→再参加の2群を追加し、最終65群が通過した。保存JSON更新完了後、主担当が再実行し全内容一致を確認した。上記63群・a077版の画像は前段階の履歴とし、SDKは5bdd版を全contextへreloadして新roomから再実行する。

限定再レビューもPASS。独立レビュアーはbutton ID2個とreset1行を逆置換してa077版のSHAと一致すること、最終65群の再実行と保存JSON一致を確認した。主担当は5bdd版で再撮影した投票中切断375pxとGM結果1280pxの2枚も目視し、案内・退出導線・結果一覧・コピー／終了操作の表示が前段階と同様に収まることを確認した。

## 実SDK最終結果

[実行補助スクリプト](evidence/b30-name-change-sdk-2026-09-08.mjs)と[結果JSON](evidence/b30-name-change-sdk-2026-09-08.json)を保存した。本体SHAは`5bddcfd7c1f527298dedb768a3076c6b20f3349ad410cf78eb2739eb52524cb9`で、旧2版・途中集計は含めず41ケースPASS。スクリプトは専用Playwright CLIへ渡す段階実行コードを出力する補助で、単独起動するテスト一式ではない。各段階で4context・役割・URL・demo project・Auth／RTDB・CSPを確認し、前段階の完了記録を確認して次へ進む。

| 確認範囲 | 結果と方法の制限 |
|---|---|
| 通常UI | GMとguest3人が別contextで新規参加。名前変え役2人・投票役1人の選択、一対一投票、全件結果、コピー操作、終了まで実UIで通過。外部メタバースは操作していない |
| 5フェーズ | 各フェーズの代表guestをreloadし、ブラウザOffline→Onlineを2回ずつ実施。サーバー側connections消失を確認後に10秒待機。接続ID以外の役割・変更名・ready・票・status・revealOrder・deleteAtを比較。全guest×全phaseの総当たりではない |
| 投票 | 同接続の無関係valueではdraft維持、切断で破棄。提出済み票はreload／断復帰で維持。候補の明示退出ではdraftを再描画し、既提出の票は消さない。途中退出の試験は既存helper直接呼出しで、通常途中画面に新設したボタンではない |
| 文字列 | 単一引用符とHTML風の変更名、保存済みimg／onerror文字列を表示。該当リストにb／img要素なし・実行フラグなし。コピーはUIボタンからwriteText引数を捕捉し、OSクリップボードへの転送は行わず未検証 |
| 終了期限 | 通常終了30,040ms、GMを5秒後reloadした別room30,016ms、GMがTOPへ戻り新roomを作った別room30,013ms。元deleteAtを保持し、最後のケースでは旧roomのみ削除・新roomのwaiting維持。後2件はrevealingをREST fixtureで用意し、hostFinishは実UI・タイマーは実時間 |
| 再利用 | 終了後に同ページでGM再作成・guest再参加が実UIで可能。disabled残存の修正を強制DOM操作なしで確認 |
| TTL | 10ケース。進行3phaseの125秒前切断を初回joinで削除せず、DBの役割で復帰。2分／30分の前後、phase変更による期限延長・短縮、host復帰による旧timer無効化を確認。過去timestamp／REST fixtureを使い、2分・30分の実時間待機ではない |
| 保存状態 | 欠損playerのcleanupとreload、不正JSON・host名／isHost型・不一致host・欠損player・RTDBキー禁止文字の6種を拒否。クライアントガードは認証境界ではない |
| 表示 | 各断復帰段階でguest375px／host1280pxを撮影し横スクロールなし。主担当の最終版目視は前記2枚に限定。実iPhoneでの操作は行わない |

不正session試験は、reload直後の既定TOPをtryReconnect完了と誤認した待機条件を修正し、TOP・session消去・refなしの3条件で完了を確認した。部分境界ケースとログを除外して全境界stepを再実行し、重複計上していない。41件の完了記録は1→4→9→12→16→20→21→22→32→41と整合する。

通信816イベントは許可した7 originのみ。console74件は意図的Offlineに伴うもの、収集範囲のpageerrorと予期しないconsoleは0件。観測は各step中のページrequest／websocket等に限定し、段階間・fresh前のreload／掃除・REST fixture用APIRequest通信は件数の対象外。初期のloopback favicon404は最終集計外の既知事象として別記する。公開JSONにはorigin別件数と分類のみを残し、URL query・認証／session tokenを掲載しない。コピー・タイマー・接続の実測とVMの人工順序を混同しない。

## 後片付けと残作業

検証用rooms／statsはnull、実行中stepなしを確認後、専用b30ブラウザを閉じた。所有Emulator CLI PID54017へSIGTERMを送り正常終了、Java PID54060も停止。主担当が両PID不在と4000／4400／4500／5500／9000／9099のLISTENなしを再確認した。テスト用データは削除し、scratchと旧版を含む証拠は保存した。本番データを変更・削除していない。

本体3ファイルの差分は366追加／105削除。200行目安を超えるが、切断予約・保存復帰・送信競合・phase別TTL／done削除・UIを片側だけ導入すると保持・欠損防止が成立しないため、1アプリの不可分なライフサイクル変更としてまとめる。次の実装コミットにはこの理由を記す。updatesは先頭name-change1件のみで後続全件不変。

主担当の最終機械チェックはlint全16項目・diff check・SDK補助スクリプト構文確認・SDK41件全pass／sourceSHA／通信816件集計一致・補助VM65群の保存JSON全体一致を通過。content-auditはexit0で既知coverage警告7件を維持した。変更はアプリ3ファイル・報告／索引／backlog／P-11の4文書・証拠4ファイルの計11件に限定し、禁止パス・他アプリの差分なし。

最終11ファイルの独立整合レビューもPASS、追加修正要求なし。SDK41cases／10steps／開始時刻をスクラッチ最終rawのreportと全内容照合し、通信origin再集計・console分類・3件の実時間・sourceSHA・補助スクリプトの同一性・環境停止も確認した。公開JSONはquery／tokenを除去済み。SDKを独立再実行したのではなく、保存証拠と手順の独立確認である。

残作業はコミット記録とPR作成・公開工程。チェックを付けるためだけの仮コミットhashは記載しない。P-12等の保留6件・A-11未判定44箇所は維持し、他アプリへは自動で拡張していない。

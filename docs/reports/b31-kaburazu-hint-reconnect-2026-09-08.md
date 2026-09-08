# B-31 かぶらずヒントのゲスト保持・復帰設計と隔離検証

2026-09-08。基準HEAD `a236784e2e7720e12e35cf7613c17b8fc9559f18`（B-30公開後）。P-11承認の6アプリ段階展開で残るkaburazu-hintを個別設計する。

最新状態（2026-09-09）: 実装・実SDK56検証群・補助VM86群は2026-09-08に完了し、実装を `893723d0495a41a9ef0a019d581feba509f67881` へコミットした。B-31の完了チェックを記録し、文書・証拠8ファイルを別コミットにまとめる工程。未push・未PR・未公開。以下の未実装・未コミット等は各工程当時の記録で、最新のコミット工程は末尾を参照する。

## 設計時点の状態と範囲

設計・起票工程。アプリ実装・隔離ブラウザ試験・コミット・公開は未実施。本体・固有AGENTSを実装担当と独立レビュアーが別コンテキストで読み取り確認し、主担当が統合する。本番Firebase・iPhone・外部メタバースは操作しない。

将来の実装対象はkaburazu-hint本体・固有AGENTS・updates先頭1件と検証証拠。shared／rules／Firebase設定／CI／他アプリ・WORDS120語・normalizeは変更しない。P-12等の保留6件とA-11未判定44箇所を維持する。これはP-11計画内の最後の対象であり、全バックログや他のRTDBアプリの復帰問題が解消した意味ではない。

## 固有仕様と移植しないもの

- 7フェーズはwaiting／clue-input／clue-review／answer／judge／result／finished。画面名はclue・review・final等へ対応する。最小3人はホスト込み。ホストもヒント役・回答者になる。
- 開始時のturnOrderはホストを含めて固定し、明示退出した不在回答者の後続ラウンドは既存のスキップ履歴を記録する。一時切断を不在扱いへ変えない。
- 全員提出の自動進行、提出1件以上で使えるホスト締切、未提出missingHintIds、自動重複除外とホストの追加除外を維持する。ホスト＝回答者ならreviewを飛ばしてanswerへ進む。回答／パスとホスト判定・自動不正解の既存経路を維持する。
- 参加者本体はplayers、ヒント・回答・判定はround、確定結果はhistoryという別配置。明示退出でも既提出round.hintsやhistoryを消す変更はしない。
- round.numberは再戦で1へ戻る。既存番号・同じお題・回答者だけでは旧試合の送信を識別できない。B-30の単方向phaseだけのガードは流用しない。
- 終了30秒は現在、ホストがfinishedを描画した時点からのローカルtimer。B-30の保存deleteAt方式ではない。B-31ではこの基準を維持し、ホスト再読込時も再び30秒となる現行仕様を保存期限へ変更しない。ホストの明示TOP退出はルームを削除する。
- ニックネーム1〜8文字、ヒント／回答入力欄の20文字制限、正規化・お題120語・得点・固定順の意味は維持する。B-23のdata-nick＋イベント委譲を戻さない。

## 採用する実装方針

1. guest本体を全7フェーズで保持し、presenceVersion:1とconnections/{id}を追加する。接続IDのremove予約受付後、最新room・guest・役割・phase・TTLをroom transactionで検査して登録する。予約／登録／取消を直列化し、欠損room／guestを再生成しない。初回joinは一時value購読を保持し、取得済みsnapshotへのfallbackを廃止する。
2. startGame／playAgainで試合識別子gameIdを1回生成し、確定transactionに含める。nextRoundでは同じgameIdを維持する。actionは捕捉ref・nickname・role・gameId・round.number・期待phase・guest接続世代・操作所有tokenで照合する。識別子をtransactionの再試行ごとに生成し直さない。waitingのID欠損は通常として開始時にIDを確定する。進行中のID欠損roomは表示・観戦・明示退出・期限掃除を妨げず、世代を必要とするゲーム送信／進行は行わず新版の新規roomへ案内する。欠損IDを途中補完せず、null同士を同一試合の根拠にしない。finishedからの再戦は新IDを確定して開始できる。移行試験は新版の新規roomで行う。
3. ヒント提出は現行ヒント役・未提出・clue-input、回答／パスは現行回答者・未確定・answerを最新状態で検査し、先着確定を守る。hostもヒント／回答を行える点をguest専用ガードで壊さない。未送信の入力は復帰保証外で、切断／試合・round変更時に旧入力を送らない。提出済み表示はDBを正とする。
4. 自動review移行・締切・回答検知・判定・history確定も同じ世代／phaseで保護する。clueReviewTriggered／answerHandled／historySavedなどのローカル真偽だけに確定を依存せず、操作所有者とDBに基づく再実行可能な処理とする。失敗・abortで操作を回復し、旧finallyが次roundの所有者を消さない。historyと判定・result確定の整合を原子的または冪等に保つ。確定済みhistoryを再接続だけで上書きしない。
5. **固有AGENTSの更新順序禁止を維持する。** nextRound／playAgainはsecretWord＋statusを同じtransactionで更新する。confirmHintsはexcludedHintIdsの確定を待ってからstatus:answerへ進める2段階を維持し、両段階で最新ref／gameId／round／phaseを検査する。第2段階では第1段階で確定した除外と一致することも確認する。途中切断・再試行で除外確定より先にanswerを公開しない。ホスト＝回答者のreviewスキップでも除外を先に確定する順序を維持する。
6. ホストの未確定手動除外は同じ試合・roundの無関係なpresence更新で失わない。初期化はgameId／round境界を検出し、DBのexcludedHintIdsと自動重複・未提出除外を反映する。第1段階確定後のreloadでも確定除外を戻さない。再戦が同じ画面名へ戻る場合も前試合のflags／ヒント／手動除外を流用しない。
7. waiting開始とfinished再戦は全在籍guestの接続を待ち、最小3人を維持する。ゲーム中の一時切断者は在籍として待ち、勝手な締切・パス・スキップを追加しない。既存のホスト締切は維持し、hostSkipAbsentGuesserはplayerが本当に明示退出・欠損した場合だけ有効にする。
8. UIの明示退出と内部cleanupを分離する。guest明示退出は予約取消完了後に自playerのみ削除し、古い操作を無効化する。host明示退出は従来どおりroom削除。新guest切断overlayには退出導線を置くが、通常途中画面の常設退出・新しい途中終了は増やさない。取消は通信回復待ちになり得る。
9. host切断TTLは全フェーズ2分を維持し、入室／復帰／操作／掃除で共通判定する。削除は予約取消後に捕捉refと最新期限を再検査し、古いtimerが復帰済み・別roomを消さない。finished30秒削除はref＋gameId＋round＋statusを捕捉し、取消後に非楽観transactionで再検査する。playAgain失敗時に元の削除timerを失効させず、再戦の確定後だけ解除する。未確定phase通知で自分の再試行を失効させない。
10. 自動全員提出判定は、退出者の既提出hintを含む単純件数ではなく、最新の在籍hintGivers全員にhintが存在するかで検査する。参加者／観戦の提出カウンターも在籍者の提出数に揃える最小変更に限定する。これにより提出後の明示退出で別の未提出者がいるのに自動締切される経路を防ぐ。退出者のhintそのもの・正規化対象・可視ヒント・履歴は削らず、手動締切の既存「提出1件以上」条件も維持する。

## 観戦画面の保護（必須）

- spectatorは保存復帰・listener・退出の入口でhost／guestから完全分岐し、player存在チェック・presence登録・操作・TTL削除・finished削除・host自動復帰へ入れない。RTDB書込みとonDisconnect予約は0。匿名認証だけは既存どおり必要。
- `?watch`入口をsessionより優先し、空値・無効コード・不存在でもhost／guest sessionへfallbackしない。既存session破棄、URL整形、noopener、連打抑止を維持する。
- 観戦DOMにsecretWordを出すのはresult／finishedのみ。clue-input／reviewはヒント本文を出さず、answerは確定した可視ヒントのみ、judgeは回答のみ。未知phaseは安全な待機表示へ戻す。title・aria・トーストへお題を混入させない。これは通常UIの秘匿で、DB読取り認可の追加ではない。
- finished表示後のroom消失では観戦DOMを保持し、購読とローカルtimerは停止する。TTL終了でもDBは削除せず終了表示・購読停止のみ。同じコードの将来再利用で別roomを再表示しない。観戦側のこの処理をguest用resetへ統合しない。

## 受入試験

- 実SDK＋隔離Emulatorでhost・guest2人以上・spectatorを別contextにする。7フェーズの代表guestのreloadと連続Offline2回、ヒント／回答／パス／除外／historyの保持、同じ試合内次roundと再戦を確認する。hostが回答者の回も必須。
- 実UIで通常全員提出・重複除外・手動除外・締切・回答／パス・判定・最終結果・再戦を通す。「ま'ち」のB-23切替、DOM属性脱出文字列、入力上限とnormalize／WORDS不変を確認する。
- spectatorの全7phase秘匿、watch優先、不正／空watch、保存復帰、read-only、TTL、finished後room消失と同コード再生成に対する購読停止を確認する。RESTの試験用書込みと観戦SDKの書込み0を混同しない。
- VMで予約受付／接続登録中の切断・退出・欠損、遅いヒント／回答／パス、2段階除外確定間の切断・再戦、history二重確定、失敗後操作回復、旧finally、gameIdが異なる同番号round、非楽観transaction再試行を確認する。
- 同じ接続の無関係valueで手動除外draftを失わず、reloadでは確定済み除外を復元する。切断中の未提出者を分母から外さず、既存締切と明示退出時の救済を維持する。
- 提出済みの人が明示退出した後も、そのhintを保持しつつ他の在籍未提出者の自動締切をしないこと、参加者／観戦カウンターの一致を確認する。
- 2分TTLは過去timestamp fixtureと実時間待機を区別する。finishedの実30秒・host再読込の現行30秒・再戦成功による旧削除中止・人数不足／切断者がいる再戦失敗後の元timer継続・旧refから新roomへの非干渉を確認する。
- 不正保存JSON／role／host名／欠損room・player／RTDBキー禁止文字、退出後の同ページ再作成・再参加、1280px／375px表示・ログ・接続先制限、lint／補助VM／独立レビュー。実iPhone・本番・OSクリップボードは操作しない。
- gameId欠損のwaiting開始、進行中の表示維持／ゲーム送信拒否／退出・掃除、finishedから新IDでの再戦を検証する。観戦にはgameIdを要求しない。

旧接続に登録済みのplayer全体removeは新版接続から取り消せないため、公開後は全員が新版を読み込んだ新規roomで利用する。仕様・権限の追加判断が必要なら、この設計を根拠に自動拡張せず確認する。

## 設計確認結果

実装担当と同系統の別コンテキストによる独立レビュアーが、人数・host回答者・観戦分離・再戦世代・2段階更新・提出済みhintの保存・現行30秒削除を照合した。提出後退出者のraw件数で全員提出と誤判定しない最小修正を設計へ含め、独立確認でgameId欠損roomの扱いを具体化した。新しい救済操作や支援方針の変更を加えず、追加の人間判断が必要な事項は見つからなかった。これは設計確認であって、実装・SDK動作検証の合格ではない。

main／origin/mainは基準HEADと一致し、cleanから開始した。設計前後のlint全16項目・diff check通過。変更は設計書・backlog起票・README索引・P-11の後続記録の4文書のみ。アプリ・設定・検証環境は無変更、未コミット・未公開。次工程はB-31の実装と隔離検証とする。

## 実装・検証結果（2026-09-08）

オーナーの実装承認を受け、実装担当・独立レビュアー兼VM担当・実SDK担当を別コンテキストに分けた。同系統の役割分離であり、異系統の二重レビューとは呼ばない。主担当は差分・文書・検証証拠・代表画像を確認し、VMを再実行した。SDKの独立再実行ではない。

最終本体SHA-256: `3e1b3baac2dd66a204dcf95c676399f04b51dc824bdf50533ea8f189b2a7f65c`。

### 実装範囲

- 本体・固有AGENTS・updates先頭1件。全7フェーズでguest本体を残し、接続IDだけにremove予約を置く。最新roomの存在・役割・TTL、接続世代と操作所有者を検査する。未送信入力は切断・試合境界で破棄する。
- 開始・再戦でgameIdを確定し、同じ番号の別試合への遅延送信を防ぐ。ヒント／回答／パスは先着を維持。ホストの判定・history・resultは同じtransactionで確定する。
- 除外確定→公開の2段階、host回答者のreview省略、手動除外draft、B-23イベント委譲を維持。提出済み退出者のhintは残すが、全員提出とカウンターは在籍者ごとに判定する。手動締切の既存1件以上は退出者の提出分も含む。
- 3人以上かつ全guest接続を開始・再戦時に検査。観戦の書込みなし・公開条件・finished後表示保持を維持する。TTLは全フェーズ2分、finishedはホスト表示から30秒（reloadで再び30秒）を維持する。
- ホストの予約・取消・再戦・削除を直列化。共通の取消helperは例外を吸収するため、今回の削除前はアプリ内で直接cancelし失敗を伝播する。共有ファイルは変更していない。
- 作成は未接続・補正済み時刻付きで空きコードを確保し、予約受付後に接続済みを確定。予約失敗ではTOPへ戻り、未接続claimを既存2分TTLによる次回掃除の対象にする。常駐サーバーによる自動掃除の保証ではない。

WORDS120語・normalizeのソース完全一致、updatesの既存エントリ全件一致を主担当も確認した。差分200行超は、1アプリの復帰・送信・公開順序・履歴・削除を片側だけ変更できない単一ライフサイクルのため。共有JS・rules・Firebase設定・CI・他アプリは無変更。

### 検証中の指摘と修正

独立VMで、終了削除の取消待ちと再戦が重なるとホスト予約が失われる競合、取消失敗を成功扱いして削除すると切断時に部分roomが再生成される経路を再現し修正した。さらに取消成功後の削除失敗（終了／退出）、予約登録失敗（保存復帰／自動復帰／作成）の5経路を固定順序で確認し、予約回復・受付順序・作成失敗時の状態整理を追加した。主担当は作成時刻をサーバー補正へ揃える1行修正も要求した。これらは合成例外試験であり、実SDK障害を実測したという意味ではない。

最終版のコード・固有AGENTS・updatesに独立レビュアーの追加修正要求なし。初候補2a64／93c57のSDK予備結果は最終合格数へ含めず、2f96はコピーのみで受入試験0件。最終SDKとVMは上記同一SHAに固定した。

### 実SDK・ブラウザ

証拠: [実SDK結果](evidence/b31-kaburazu-hint-sdk-2026-09-08.json)、[Playwright CLI用ハーネス](evidence/b31-kaburazu-hint-sdk-2026-09-08.mjs)。56検証群すべてPASS。繰り返した同ページ新規入室も別群として含み、56種類の独立仕様という意味ではない。

- 専用4context（host・guest2人・spectator）で実UI入室、3ラウンドをphaseのREST変更なしで進行。hostも回答者になり、重複／手動除外・パス・通常判定・履歴を確認した。
- 全7フェーズでguest reloadとブラウザOffline10秒×2を検証。waitingはUI作成、残る6フェーズはRESTで用意した状態から実SDK復帰。round・history・gameId・playerメタ情報を比較し、接続IDだけの変更と区別した。
- finishedの保持試験は2回目切断前にhost reloadで現行30秒を再開した。これとは別に、再戦拒否後の元timerによる削除を30,017ms、host reload後の削除を30,019ms（最初のfinishedから35,404ms）で実測した。
- 再戦の全guest接続待ち・新gameId・初期化と旧timer非干渉、host reload後の切断予約、同ページ再作成／再参加を確認。再戦ボタンは無効表示ではなく押下後のtransactionで拒否する。
- 「ま'ち」は8文字制限内の実UI名でB-23切替を確認。長いHTMLヒントは20文字制限外のレンダラ検査用fixtureであり、UIでその入力が許可されるとは扱わない。gameId欠損時の送信拒否は直接関数呼出しで確認した。
- 観戦はURL優先・保存復帰・退出・各phase公開範囲・TTL・finished後null表示保持と購読停止を確認。native WebSocket送信を透過観測し、観測区間で書込み・onDisconnectのactionなし。DOM秘匿は主に`#spec-content`の検査で、DB読取り認可やlongpoll payloadの検証ではない。
- TTL125秒過去のfixtureを7フェーズで検証。119秒／118秒fixtureでは残り1秒／2秒のtimerを確認した。2分全体を実時間待機した試験ではない。不正JSON sessionは従来どおり無視してTOP、文字列自体は残る。構造・名前・役割が不正なsessionは破棄される。
- PC1280／375pxで表示確認。主担当は結果host1280・結果guest375・待機切断guest375の3画像を目視し、文字・ボタンの範囲内表示を確認した。実iPhone品質の保証ではない。

ブラウザイベント1543件は許可7origin内。取得区間のpageerror0件、console148件は意図したOffline由来に分類。ログは各run-code step中のみで、setup／step間とREST fixtureクライアントの要求は集計外。初期utils.js不足404は受入開始前にコピーして修正し、favicon404は初期ロードとして別扱い。検証器のhistory配列null・非表示救済ボタン・再戦ボタン・不正JSONの期待違いは修正して再開し、失敗試走やTTL群を重複計上していない。公開証拠には認証payloadやURL queryを含めずorigin等へ整理した。

### 補助VM・機械確認

証拠: [VM結果](evidence/b31-kaburazu-hint-presence-2026-09-08.json)、[再実行器](evidence/b31-kaburazu-hint-presence-2026-09-08.mjs)。86群PASS（うち1群は同一ソースSHA確認）。予約・登録・取消待ち、遅延送信、同番号の再戦、2段階公開、旧finally、history、期限・別ref、観戦、上記例外の回復と時計±180秒を検査した。主担当が保存先から再実行し保存JSONとdeepEqual一致を確認した。

VMはメモリ内DB・最小DOM・仮想時計で順序を制御する。実共有のTTL／escape／cancel／shuffleを抽出するがSDKは起動せず、Firebaseの通信・キャッシュ・再試行プロトコルや実時間を模擬しきるものではない。実SDKで人工的な取消エラーを検査したとは扱わない。

lint全16項目・diff check・JS構文確認PASS。A-11未判定44箇所は既知のままで安全判定に変えない。保留6件も変更なし。

保存後の最終文書レビューもPASS。独立レビュアーが4文書・SDKハーネス全文・保存JSONとscratchの全key一致・86群のVM証拠・ローカルリンクを確認し、追加修正要求なし。SDK再起動はせず、保存証拠のレビューとして記録する。

### 環境と終了状態

scratchは`/Users/tagishimasakatsu/Documents/Codex/2026-09-04/claude-fable5-1/b31-sandbox.FqVvIm`。demo-roomk-b31、Firebase SDK10.14.1 compat／CLI15.29.0／Temurin21。Auth9099／RTDB9000／Hosting5500／UI4000／hub4400／log4500はloopback。SDK・共有コピーのEmulator初期化順、ローカルデータ接続CSP、stats no-op、相対依存ファイル存在をgate確認した。

rooms／statsはnull、実行中stepなし。専用b31ブラウザを閉じ、CLI76650をSIGTERMで終了（exit0）、子Java76690も終了。6ポートのlistenerなしを主担当も確認。scratchのハーネス・ログ・画像は検証記録として保持し、repoにテスト用SDK設定を混入させていない。本番Firebase・iPhone・OSクリップボード・利用者のブラウザは操作していない。

実装・検証完了、未コミット・未push・未PR・未マージ・未公開。B-31の完了チェックは実装コミットを記録する工程まで保留する。次はアプリ3ファイルと文書・証拠を分けたコミット／PR準備。公開後は全員が新版を読み込んだ新規roomで利用する。承認済みP-11計画6アプリの最後の実装対象だが、全バックログ完了や他アプリの復帰保証ではない。

## コミット記録（2026-09-09）

オーナーの「コミットしてください」の承認により、検証済みアプリ3ファイルを実装コミット `893723d0495a41a9ef0a019d581feba509f67881`（`fix(kaburazu-hint): ゲストのヒントと回答を保持して再接続`）へ保存した。差分200行超の不可分理由をコミット本文に記載。本体SHA・SDK56群の保存証拠は不変。コミット工程でVM86群を再実行して保存JSON一致、lint16項目・diff checkも確認した。実SDK・本番Firebase・ブラウザを再起動した工程ではない。

B-31の完了チェックと実装ハッシュを記録し、設計／検証報告・backlog・README・P-11計画の4文書と証拠4ファイルを後続の文書コミットに分離する。既存main履歴のamend・rebaseなし。今回の承認はローカルコミットのみとして扱い、push・PR作成・マージ・デプロイは行わない。上記のチェック保留・未コミット等は各工程当時の履歴として保持する。

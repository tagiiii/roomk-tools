# 監査実走 2026-09-04（司令塔 Fable 5.1 移行時の P1 / P2 / P4 基準監査）

- 実施日: 2026-09-04
- 監査ID: P1（セキュリティ）／ P2（RTDB 規約・状態管理）／ P4（機能品質・異常系）
- モード: weekly 相当の全体監査（対象: `apps/**` 全体。P2 は `scripts/lint.sh` の `RTDB_HTML_FILES` 20本）
- 比較範囲: 全体（base `6248e73` .. HEAD `6248e73`）
- 作業ツリー: dirty（`docs/ai-roles.md` `docs/kaizen-backlog.md` `docs/content-plan.html` `docs/free-time-plan.html` の4件のみ。`apps/` は clean）
- 観察モード: **static-only**（コードと文書の読み取りのみ。本番 Firebase への接続・匿名認証・ルーム作成/参加・データ書き込み・rules 変更は一切行っていない。ブラウザも起動していない）
- 体制: 司令塔（Fable 5.1）が読み取り専用サブエージェント（P1 ×1、P2 ×2、P4 ×3）へ委譲し、主要 finding の根拠行を `sed -n` / `grep -n` でサンプリング裏取り
- 機械チェック: `bash scripts/lint.sh` exit 0（ERROR 0・WARN 0）／ `node scripts/content-audit.mjs` exit 0（entries 3405、intraAppExactMatch 0、cross-variant 2＝既知。**coverage 警告7件**: blackjack / esadori / kotoba-mikke / moji-soroe / oshitsuke-zukan / pita-hame / stats-view が `collectEntries` にも `NO_CONTENT_APPS` にも未登録）
- 起票の扱い: 本報告は発見のみ。バックログへの反映は別工程（2026-09-04 の後処理で B-22〜B-24 / C-10 / P-11〜P-13 として起票。P1-3 の SRI／DEP-2 方針は P票上限のため提案12として提案欄に記載。落とした候補は起票せず本報告に残す）
- 途中経過: 利用制限で P2 グループB と P4 RTDB 担当が中断したため、リセット後に同範囲を再実行して全20本の RTDB アプリと非 RTDB アプリ全体を網羅した

行番号はすべて HEAD `6248e73` 時点のもの。

---

## 結論

- 最重要は次の2点。
  1. **ホストの SDK 自動再接続（リロードなし）後に `hostConnected=true` を書き戻す分岐がなく、ゲスト側 TTL が生きているルームを削除する**（RTDB 20本中14本）。
  2. **ゲストがゲーム中にリロードすると `onDisconnect().remove()` が先に発火し、復帰も再参加も拒否される**（word-wolf ではウルフ不在で必ず「ウルフの勝ち」になる）。
- P1 は innerHTML 経路の未エスケープ 0 件（HTML テンプレート内の `${…}` 補間 351 件を全件裏取り）。稼働中の XSS はなし。
- リダイレクトスタブ6本、ポータルのリンク 46 本、updates.json 55 件、guide のアンカーはすべて実在・整合。howto の文言とボタン名は 20 アプリで不一致なし。

---

## P1 セキュリティ finding（4件・上限5件内）

共通: 版 base 6248e73 .. HEAD 6248e73／作業ツリー dirty（docs のみ）。機械チェック lint exit 0。

### P1-1

```text
finding_id:   P1-1
dedupe_key:   app:kaburazu-hint:inline-onclick-encodeuricomponent-nick
status:       新規
scope:        app:kaburazu-hint（同型は app:toomawashi にもあるが現状は静的データのみ）
基づく:       観測（コード読解で決定的。ランタイム未実測）
根拠:         apps/kaburazu-hint/index.html:1147（encodeURIComponent(nick)）、:1162（onclick="toggleHint('${encodedNick}')"）、:1169-1170（decodeURIComponent で復元）、:683-687（validNick は . # $ / [ ] のみ禁止＝ ' ( ) は通る）、:1157（同じカードに data-nick="${esc(nick)}" が既にある）、:1118（reviewHintsData は RTDB round.hints 由来＝他プレイヤー入力）
              同型: apps/toomawashi/index.html:1500, :1519（値は packs.js の静的 choices/aspects。現在 ' ( ) を含む語なし）
機械チェック: lint 全パス（SEC-1 は innerHTML の HTML 文脈のみ検査。属性内 JS 文字列文脈は検査対象外＝ルールの穴）
再現/観察:    ゲストが「ま'ち」（8文字以内・validNick 通過）で参加 → ヒント提出 → ホストのレビュー画面で当該カードの表示/除外トグルを押す。encodeURIComponent は ' ( ) ! * ~ を符号化しないため onclick が JS 構文エラー → 期待「除外が切り替わる」／実際「無反応」。8文字上限のため任意コード注入は実質困難で、実害は機能停止側
利用者影響:   ホスト（スタッフ/子ども）が重複ヒントを除外できない。当該ゲストは自分の名前が原因と気づけない
深刻度:       中
確信度:       高
変更リスク:   低（1アプリのイベント配線のみ・RTDB スキーマ不変）
提案アクション: インライン onclick をやめ、koedake-theater（:1123 data-nick → :1131 btn.dataset.nick）と同じ「data-nick 属性＋イベント委譲」へ。カードには既に data-nick（:1157, esc 済み）があるので closest('.kbz-hint-card').dataset.nick を読むだけでよい。toomawashi:1500,1519 の同型は現状静的データのみで実害がないため B-23 には含めず、将来 choices/aspects を動的データ（ユーザー入力・RTDB 取得値）で扱うようになった時点の別候補として本報告に残す
受入条件:     ①stub（reviewHintsData に「ま'ち」「a)b(」を合成）でトグルが動く ②既存ニックネームの挙動不変 ③lint 緑 ④任意: lint に「on* 属性内で encodeURIComponent(…) を使わない」検出を追加（Tier A）
提案Tier:     B（本体修正）／A（lint 拡張）
判断待ち:     不要
```

### P1-2

```text
finding_id:   P1-2
dedupe_key:   shared:rules:stats-namespace-not-in-c6
status:       既存票への追記(#C-6)
scope:        横断（database.rules.json × apps/shared/js/stats.js × apps/stats-view）
基づく:       観測
根拠:         database.rules.json:3-8（$app_rooms/$roomId の2階層ワイルドカードのみ）、apps/shared/js/stats.js:84-86（stats/{app}/{YYYY-MM}/{item} へ set(increment)）、apps/stats-view/AGENTS.md:44-47（「stats 直下の一括 get は Permission denied」＝現行 rules の形に依存した回避）、apps/stats-view/app.js:115、AGENTS.md:245、docs/reports/c6-rules-validate-proposal.md:39-44（段階1＝実在14名前空間の列挙。stats への言及なし。2026-07-12 作成、stats.js 導入は 2026-07-28）、同:77-78（段階1/2 の適用判断の P票は「次回へ持ち越し」→ 未起票）
機械チェック: 該当ルールなし（rules は lint 対象外）
再現/観察:    (a) 段階1をそのまま適用 → stats.js の書き込みが Permission denied（catch で握りつぶすため無音で計測停止）。(b) 現行 rules では匿名認証済みなら誰でも stats/{app} を消去・改変できる（性善説の範囲内だが C-6 の議論に stats が含まれていない）
利用者影響:   子ども・スタッフへの影響なし。開発者の改善判断材料（stats-view）が無音で欠落する
深刻度:       低
確信度:       高
変更リスク:   高（rules 変更・Tier D）
提案アクション: C-6 報告に追記: ①段階1の列挙に stats を加える ②stats/$app/$month/$item に .validate（$month は YYYY-MM、値は number）を段階2へ ③適用時は AGENTS.md:245 と stats-view/AGENTS.md:44-47 の文言を同時更新。加えて C-6:77-78 で持ち越された「段階1/2 適用判断」の P票を起票する
受入条件:     人間レビュー（rules は D）。適用時は Emulator で stats.js の increment と stats-view の app 単位 get が通ることを確認
提案Tier:     D
判断待ち:     要P票（C-6 段階1/2 の適用可否）
```

### P1-3

```text
finding_id:   P1-3
dedupe_key:   横断:dep:firebasejs-sri-count-drift
status:       既存票への追記(#C-7)
scope:        横断
基づく:       観測
根拠:         grep -rc 'gstatic.com/firebasejs' apps/**/*.html → compat 3本 × 20アプリ = 60 タグ・integrity 0 件（C-7 報告時 14アプリ×3=42）。新規6本: blackjack / esadori / kotoba-pair / moji-soroe / pita-hame / toomawashi。ESM import 側: apps/shared/js/firebase-config.js:10-12、apps/shared/js/stats.js:61-63、apps/stats-view/app.js:11-13、apps/kotoba-tantei/service.js:7（import 文は SRI を付けられない）。docs/reports/c7-external-resources-sri.md:53「次回起票予定: DEP-2 lint の導入と firebase SDK の扱い(a/b)」→ docs/kaizen-backlog.md で DEP-2 の言及は C-7 行のみ＝未起票。value-card の sortablejs/html2canvas は SRI 済み（A-3/A-5）で変化なし
機械チェック: DEP-1 パス（@latest なし・版数固定済み）。DEP-2 は未実装
再現/観察:    挙動系でない。新アプリが増えるたび未 SRI タグが線形に増え、C-7 の判断（a: SRI 付与／b: 許可リスト化）が先送りのまま
利用者影響:   直接なし（gstatic 改竄は現実的脅威モデル外）。運用上は「方針未決のまま母数が増える」
深刻度:       低
確信度:       高
変更リスク:   中（(a) なら 60 箇所のハッシュ運用、(b) なら lint のみ）
提案アクション: C-7 推奨どおり (b) を P票化: gstatic firebasejs を DEP-2 の許可リストに入れ、理由を lint 内コメントに明記して DEP-2 を WARN で導入。同時に new-app-scaffold スキルへ「外部 JS は SRI 必須（firebase は例外）」を1行追記
受入条件:     DEP-2 fixture 11 ケース（C-7 実証済み）＋ 現行 apps で検出 0（機械検証・Tier A）
提案Tier:     A（lint 実装）／P票（a/b 決定）
判断待ち:     要P票（firebase SDK の扱い a/b）
```

### P1-4

```text
finding_id:   P1-4
dedupe_key:   shared:rules:firestore-kotobatantei-public-read
status:       新規（D 報告のみ）
scope:        app:kotoba-tantei × firestore.rules
基づく:       観測
根拠:         firestore.rules:9（allow read: if true）:10（create/update/delete は auth != null）、apps/kotoba-tantei/AGENTS.md:74（書き込みは匿名認証のみ、と書くが read の公開性に言及なし）、同:88（観戦ビューは「共通初期化に伴う匿名認証は許容」）、apps/kotoba-tantei/service.js:757-759（subscribeToRoomForSpectator は authReady を await せず onSnapshot 直行＝現状は read:true に暗黙依存）、AGENTS.md:403-418（RTDB は「読み書きとも匿名認証が必須」と明記。Firestore 側の方針記述なし）
機械チェック: 該当なし（rules は lint 対象外）
再現/観察:    現状の実害は性善説の範囲内（匿名認証は誰でも取れるため、認証必須にしても脅威モデル上の差は小さい。6桁コード総当たりは非現実的）。問題は「文書と rules のズレ」と「read を auth != null に締めると service.js:757 が初回 permission-denied を出す」という依存関係が未記録なこと
利用者影響:   直接なし。将来 rules を締めたときに観戦ビューが壊れる形の潜在的回帰
深刻度:       低
確信度:       高
変更リスク:   中（rules 変更なら観戦ビューの認証待ち追加が必須）
提案アクション: ①意図的な公開 read として AGENTS.md（kotoba-tantei:74 付近と root の Firebase 節）に理由付きで明記する（コード変更なし・推奨）／②allow read: if request.auth != null に統一し、service.js:757 に await authReady を足す
受入条件:     人間レビュー（rules は D）。②を選ぶ場合は authorized-sandbox で観戦ビューの初回購読が permission-denied にならないこと
提案Tier:     D
判断待ち:     不要（D の中で人間が①/②を選べば足りる）
```

P1 で一般論のみとして捨てた指摘 4件: RTDB 数値フィールドを Number() なしで描画（DevTools 改変前提＝脅威モデル外）／ポータル apps/index.html:1505 のローカル esc が `'` 未対応（データは repo 管理・属性は二重引用符のみ）／ルームコード入力の RTDB パス文字検証がアプリ間で不揃い（P4 側で扱う）／slides.html の同一オリジン localStorage メッセージ信頼（実害シナリオなし）。

---

## P2 RTDB・状態管理 finding（5件・候補9件から選抜）

### P2-1

```text
finding_id:   P2-1
dedupe_key:   横断:host-auto-reconnect-writeback-missing
status:       新規
scope:        横断（14本: do-mannaka / ikutsu-ieru / jinro / kakure-number / koedake-theater / magire-eshi / word-wolf / name-change / tatoe-gp / tatoe-narabe / uso-jisho / pittari-meter / oshitsuke-zukan / pita-hame）
基づく:       推測（コード読解。SDK の自動再接続時の挙動は authorized-sandbox 実測が必要）
根拠:         hostConnected=true を書き戻すのが tryReconnect（リロード時）だけで、handleRoom にホスト側の復帰分岐が無い:
              do-mannaka:725 / 1232-1241、ikutsu-ieru:1103 / 874-895、jinro:2286 / 1189-1208、kakure-number:675 / 1106-1116、koedake-theater:1315 / 1006-1030、magire-eshi:1669 / 1171-1192、word-wolf:1239 / 991-1022、name-change:1038 / 634-644、tatoe-gp:901 / 1556-1619、tatoe-narabe:1745 / 1326-1392、uso-jisho:967 / 1474-1530、pittari-meter:850 / 1470-1509、oshitsuke-zukan:1676 / 1138-1171（connected:true を戻す分岐なし）、pita-hame:2704 / 2561-2582（guest 分岐のみ）
              ゲスト側は isRoomExpired なら remove を実行: do-mannaka:1234-1235 / ikutsu-ieru:882-889 / jinro:1195-1203 / kakure-number:1108-1109 / koedake-theater:1016-1023 / magire-eshi:1180-1187
              対策済み（正準）: kaburazu-hint:940-947（handleRoom 内でホストが hostConnected===false を見たら update＋再予約）、kotoba-pair:1038-1045（同）、toomawashi:1278-1284（同）、blackjack:1508-1535・esadori:1457-1484・moji-soroe:1630-1711（.info/connected 購読→presence 書き戻し）
              規約: AGENTS.md「セッションデータの自動削除」〜「再接続」（TTL 2分は「一時的な通信切れで誤って期限切れにならない」長さとして設計）
機械チェック: lint exit 0（REF-4 は数値2分しか見ない）
再現/観察:    役割: host（メンター PC）＋ guest 1人以上、画面: ゲーム中の任意フェーズ
              1. ホスト端末の接続が数秒〜数十秒切れる（Wi-Fi 切替・スリープ・モバイルでのアプリ切替など）。サーバ側で onDisconnect が発火し hostConnected=false / hostDisconnectedAt=TIMESTAMP が書かれる
              2. ホストの SDK が自動再接続する（ページはリロードしない）。ホスト画面は通常どおり動き続ける
              3. ゲスト画面には「ホストが切断」オーバーレイ＋カウントダウンが出たまま
              4. 2分後、ゲストの orphanTimer/リスナーが isRoomExpired を真と判定してルームを remove()
              期待: ホストが戻った時点でオーバーレイが消え、ゲームが続く（kaburazu-hint / kotoba-pair / toomawashi / blackjack / esadori / moji-soroe の挙動）
              実際: 進行中のルームが消え、ホストには「ホストが退出したため終了しました」等が出る。name-change は naming/voting/revealing の TTL が30分（AGENTS.md:74）のため、ホストが復帰していてもゲスト全員が最長30分「GM 切断」オーバーレイに閉じ込められる
利用者影響:   子ども・スタッフ両方。進行中のゲームが理由不明で全員分消える（スコア・ラウンド履歴も消失）
深刻度:       高
確信度:       中（onDisconnect の発火条件は環境依存。ただしタブ閉じ以外でも OS レベルのソケット断で発火するのは Firebase の仕様）
変更リスク:   中（各アプリ1箇所の追記。kaburazu-hint:940-947 と同型で、ゲスト側の掃除経路には触れない）
提案アクション: 14本の handleRoom に「state.role==='host' && room.hostConnected===false → update({hostConnected:true, hostDisconnectedAt:null}) ＋ onDisconnect().update 再予約」を追加（kaburazu-hint:940-947 を正準に）。jinro は isHost フラグ名、oshitsuke-zukan は connected/disconnectedAt に合わせる。P2-2 と同じ関数に同居させると1経路で両方閉じる
受入条件:     authorized-sandbox: ホスト側で DevTools の Offline を 10 秒 ON→OFF し、(a) ゲストのオーバーレイが自動で消える (b) 2分待ってもルームが残る (c) ホスト再切断時に再び hostConnected=false が書かれる、を各アプリで確認。lint 緑。1アプリ×1コミット
提案Tier:     B（切断処理の変更＝自動 A にしない）
判断待ち:     不要
```

### P2-2

```text
finding_id:   P2-2
dedupe_key:   横断:guest-presence-not-restored-after-sdk-reconnect
status:       新規（P2-1 のゲスト側対応物）
scope:        横断（8本: word-wolf / name-change / tatoe-gp / tatoe-narabe / uso-jisho / pittari-meter / pita-hame / oshitsuke-zukan）
基づく:       推測（静的読解。SDK は再接続時に onDisconnect 予約を再送するが、消えた players/{nick} を誰も再作成しない）
根拠:         ゲストの onDisconnect().remove(): word-wolf:763,1248 / name-change:588,1048 / tatoe-gp:1366,1446 / tatoe-narabe:1108,1743 / uso-jisho:1267,1322 / pittari-meter:1032,1082 / pita-hame:2030,2719 / toomawashi:953,1648
              .info/connected 購読はグループB中 moji-soroe:1683-1711（startConnectionWatch → handleReconnected → writeBackPresence transaction → armOnDisconnect）のみ
              復帰書き戻しは各アプリとも window.load 起点の tryReconnect() だけ: word-wolf:1213 / tatoe-gp:870 / uso-jisho:936 / pittari-meter:825 / tatoe-narabe:1710 / pita-hame:2670 / oshitsuke-zukan:1651
              消えたノードを自分の書き込みで部分再生成する箇所（{ready} / {vote} / {answer} だけの player が復活）: word-wolf:832,880 / tatoe-gp:1467,1479 / pittari-meter:1179,1192 / name-change:758,765,903 / tatoe-narabe:1207
              oshitsuke-zukan は playing 中 connected:false 方式（1179-1182）だが自動再接続後に connected:true を戻す分岐が handleRoom:1138-1171 に無い
機械チェック: lint exit 0
再現/観察:    guest。ゲーム中に通信が数十秒切れ（サーバー側切断判定→ onDisconnect 発火→ players/{nick} 消滅）、その後リロードなしで SDK が自動再接続
              期待: 自分が players に戻る。実際: 一覧・turnOrder・集計から消えたまま画面は動き続け、次の自分の操作（準備OK/投票/回答/決定）で {vote} 等だけの部分ノードとして「復活」する。oshitsuke-zukan では戻っているのに「通信が切れています」表示のまま、カードを渡してもらえない（transaction 拒否）
利用者影響:   子ども（ゲスト）: 自分だけ数に入らない・票が消える・順番を飛ばされる。スタッフ: 原因が見えず「リロードして」以外の対処がない
深刻度:       中
確信度:       中（SDK の onDisconnect 再送と presence 非復元はコードから直接裏取り。切断判定までの時間は実測が要る）
変更リスク:   中（接続処理への追加。moji-soroe/blackjack の確立パターン流用なら局所）
提案アクション: moji-soroe:1683-1711 の .info/connected 追従＋ transaction による presence 書き戻し＋ onDisconnect 再予約（epoch ガード付き）を各アプリへ横展開。P2-1 と同じ関数に同居させる。oshitsuke-zukan は connected:true / disconnectedAt:null の書き戻しで足りる
受入条件:     authorized-sandbox で「ゲスト通信断→ onDisconnect 発火を RTDB で確認→復帰」後に players/{nick} が完全な形で戻り、部分ノード復活が起きないこと。1アプリ×1コミット
提案Tier:     B
判断待ち:     不要（P2-1 と束ねるかは B 起票時に明記）
```

### P2-3

```text
finding_id:   P2-3
dedupe_key:   横断:room-null-branch-cleanup-residue
status:       既存票への追記(#B-18、#B-21 follow-up④)
scope:        横断（jinro / ikutsu-ieru / magire-eshi / word-wolf / name-change / tatoe-narabe）
基づく:       推測（コード読解。DOM 状態は stub で確認可能）
根拠:         room が null になったときのゲスト分岐で host-off-overlay / timer / off() を片付けない:
              jinro:1173-1180（cancel → clearSession → showScreen('top')。showOverlay(false) 無し・off() 無し・clearInterval 無し）
              ikutsu-ieru:857-861（clearSession → showMsg → showScreen('top')。overlay/off/cancel/clearTimeout/clearInterval すべて無し）
              magire-eshi:1149-1158（cancel → off → showScreen('top')。showOverlay(false) 無し）
              word-wolf:962-963（clearSession→showMsg→TOP のみ。host-off-overlay(162-168)・orphanTimer・off() が残る）
              name-change:601-606（ホストは無処理、ゲストは host-gone-overlay を出すだけで orphanTimer / リスナー / state を片付けない）
              tatoe-narabe:1326-1338（ホストは無処理。ゲストは完全片付け）
              直前にオーバーレイを出す経路: jinro:1191 / ikutsu-ieru:876 / magire-eshi:1173。ルーム消滅を自分で起こす経路: jinro:1195-1203 / ikutsu-ieru:882-889 / magire-eshi:1180-1187
              オーバーレイは position:fixed; inset:0; z-index:100 の全面ブロック: jinro:243-249 / ikutsu-ieru:173-179 / magire-eshi:170-176
              正準: word-wolf:961-985（B-18・expectedRoomRemoval で正常削除と区別しローカル片付け→TOP）、koedake-theater:977-993（clearTimeout＋showOverlay(false)）、kaburazu-hint:893-910→1605-1613（leaveCleanup）、kotoba-pair:997-1006→1700-1716、do-mannaka:1213-1218、kakure-number:1090-1096→1368-1384
機械チェック: lint exit 0（REF-5 は個数差しか見ない）
再現/観察:    役割: guest、画面: 任意
              1. ホストがタブを閉じる → ゲストに「GMが一時的に切断されました」等のオーバーレイ＋カウントダウン
              2. 2分経過 → ゲストの orphanTimer がルームを remove() → 同じ端末のリスナーが !snap.exists() に入る
              期待: オーバーレイが消え、TOP 画面で新しいルームに入れる
              実際: TOP 画面に切り替わるが全面オーバーレイが .show のまま残り、TOP のボタンが押せない（リロードするしかない）。ikutsu-ieru はさらに timerInterval とリスナーが残り、state.role/roomRef も旧値のまま。
              ホスト側（name-change / tatoe-narabe）: P2-1 と結合すると、ゲスト TTL 削除後もホスト画面は生きたまま固まり、その後タブを閉じると SDK が再送した onDisconnect 予約でゴースト room を再生成
利用者影響:   子ども。ホストが落ちた後に「画面が固まった」状態になる。メンター不在時に自力で復帰できない。スタッフ（ホスト）: 進行不能に見える・原因不明
深刻度:       中（進行不能だがリロードで復帰できる）
確信度:       高（DOM 操作の欠落をコードで直接確認。表示状態の実測のみ未実施）
変更リスク:   低（ローカル片付けの追加のみ。RTDB 書き込みは変えない）
提案アクション: room-null ゲスト分岐を、それぞれの既存 teardown（leaveCleanup 相当）に統一し cancelRoomOnDisconnect → off → overlay/timer 片付け → TOP。ホスト側（name-change / tatoe-narabe）は word-wolf:961-985 の形（expectedRoomRemoval で自分の remove を識別し、外部消滅時は片付けて TOP）を適用
受入条件:     stub 検証（roomRef スタブで snap.exists()=false を流し、host-off-overlay.classList に show が無い・active timer=0 を実測。B2 の検証パターンと同じ）＋ lint REF-5 緑。可能なら authorized-sandbox でホスト切断→2分→TOP 操作可を目視
提案Tier:     B
判断待ち:     不要
```

### P2-4

```text
finding_id:   P2-4
dedupe_key:   横断:in-game-nickname-rejoin-no-transaction-host-takeover
status:       新規（kakure-number は AGENTS.md:57,126、pittari-meter は AGENTS.md:128 で「復帰扱い」を意図として明文化。do-mannaka / tatoe-gp / uso-jisho は未記載）
scope:        横断（do-mannaka / kakure-number / tatoe-gp / uso-jisho / pittari-meter）
基づく:       推測
根拠:         「ゲーム中の同名再入室＝復帰」分岐が transaction 外で isHost 判定もない:
              kakure-number:847-858（alreadyInRoom → role='guest' でそのまま入り players/{nick} に onDisconnect().remove() を予約。!alreadyInRoom.isHost の判定なし）
              do-mannaka:1093-1106、tatoe-gp:1358-1370、uso-jisho:1264-1280、pittari-meter:1023-1036（同型）
              通常参加は transaction 内で nick_taken を弾く（do-mannaka:1116-1136 / kakure-number:869-）が、上記の分岐はその前で return するため「元のクライアントがまだ接続中か」を見ない。プレイヤーノードに接続識別子が無いため区別できない
              正しく弾く例: kotoba-pair:1774（if (mine && mine.isHost) return;  // ホストと同名 → 復帰させない）
              kakure-number の calcDeltas（1010-1012）は players[name] でしか絞らないため、ホスト名で入った端末が round/guesses/{host} を書くとホスト名で得点しうる。renderNumberGrid はホストが round/numbers に居ないため全員の数字が「？」なしで見える
機械チェック: lint exit 0
再現/観察:    役割: guest A（接続中）＋ 別端末 B、画面: answering / thinking
              1. B が A（またはホスト）と同じニックネーム＋同じコードで参加 → 分岐で無条件に成功。A と B が同じ players/A を共有
              2. B が回答を送ると A の answer が上書きされる。B がタブを閉じる → onDisconnect().remove() で players/A ごと消える
              ホスト名で入った場合: players/{host} に onDisconnect().remove() が張られ、その端末の切断でホストの score/answer ノードが消える
              期待: 接続中の人の枠は取れない（通常参加と同じ「そのニックネームはすでに使われています」）
              実際: A のスコア・回答が消え、A の画面は次の snapshot で自分不在のまま止まる
利用者影響:   子ども。友だちの名前を打ってしまう（タイプミス・いたずら）だけで相手のデータが消える。ホスト名なら進行そのものが壊れる
深刻度:       中
確信度:       高（分岐の存在と transaction・isHost 判定の不在はコードで直接確認）
変更リスク:   中（復帰の利便性とトレードオフ。kakure-number / pittari-meter は意図設計）
提案アクション: 最小修正: 全5本の分岐に !alreadyInRoom.isHost 判定を足しホスト名を拒否（Tier B）。復帰手段そのものは設計判断: 案①「復帰は sessionStorage（tryReconnect）だけに限定し、この分岐を削除」 案②「分岐は残すが transaction 内で players[nick].sessionId 等の照合を足す（スキーマ追加）」 案③「現状維持＋AGENTS.md に明文化のみ」。推奨: 案③を先に、必要なら案①
受入条件:     人間レビュー（設計判断）。isHost 判定は stub でホスト名参加が弾かれることを確認。案①/②なら authorized-sandbox で同名参加が弾かれることを確認
提案Tier:     B（isHost 判定）／C（設計判断）→ 採用案により B
判断待ち:     要P票（「ゲーム中の同名再入室を復帰手段として残すか」）
```

### P2-5

```text
finding_id:   P2-5
dedupe_key:   横断:result-update-resurrects-removed-player
status:       新規
scope:        横断（do-mannaka / kakure-number / pittari-meter）
基づく:       推測
根拠:         do-mannaka triggerResult:1351-1358（リスナー snapshot の players から players/{name}/score を絶対値で update。呼び出し: 1344-1347 全員回答で自動／ hostCloseAnswering 1360-1372）
              kakure-number triggerReveal:1027-1034（同型）
              pittari-meter startNewRound:1275-1283（get 後の players/{name}/guess=null, decided=false 一括 update）
              次ラウンドの answer リセットも state.players 由来: do-mannaka hostPickQuestion 988-1010
              AGENTS.md「Realtime Database 実装ルール」: ゲーム状態の確定は読み取り後 update ではなくルーム全体 transaction
機械チェック: lint exit 0
再現/観察:    役割: host ＋ guest A/B、画面: answering
              1. B が最後に回答 → ホストの snapshot で answered===total → triggerResult が update を送る
              2. その直前〜同時に A が「TOPにもどる」（leaveGame:804-807 で players/A remove）または切断（onDisconnect remove）
              3. update に含まれる players/A/score が、消えた players/A を { score } だけで再生成
              期待: 抜けた人は一覧から消え、次ラウンドは残った人だけで「全員回答」判定される
              実際: 一覧に A が残り、次ラウンド以降「answered===total」が永遠に成立せず、ホストが毎回「しめきる」を押す必要がある。pittari-meter は直前に抜けた人が {decided:false} で復活
利用者影響:   スタッフ（毎ラウンドの手動しめきり）／子ども（抜けた友だちがずっと一覧に居る違和感）
深刻度:       低（窓が狭い。抜けた後にホストが「しめきる」で進められる）
確信度:       中（絶対値 update の再生成は RTDB の仕様どおり。発生頻度は実測不能）
変更リスク:   中（集計を transaction 化すると同期ロジックの変更になる）
提案アクション: triggerResult / triggerReveal / startNewRound をルーム全体 transaction に変え、callback 内の room.players に存在する人だけ書く（esadori:1130-1188 の「最後に確定した人の端末が判定を書く」型）。resultTriggered ガードは維持
受入条件:     stub 検証（transaction updater に「players から1人欠けた room」を渡して欠けた人の score キーが出力に無いこと）＋ lint。authorized-sandbox があれば「最後の回答直後に退出」を手動再現
提案Tier:     B
判断待ち:     不要
```

### P2 で落とした候補（2件・起票せず本報告に残す）

- **jinro: kick されたゲストの onDisconnect 予約が残り、切断時に players/{nick} を部分再生成／本人は退出に気づけない**（app:jinro / 推測 / 低〜中）。kick は players/{nick} の remove のみ（jinro:2222-2225）、ゲストの予約は players/{nick}/connected への set(false)（1127, 2297）。ゲスト側に自分がルームから消えたことを検知する分岐が無い。GM が「退出」→ 本人がタブを閉じる → { connected:false } だけのノードが復活し、役職合計と人数がずれてスタートできない。提案: ゲスト側 handleRoom に「waiting 中に players[自分] が無ければ cancelRoomOnDisconnect → clearSession → 『退出になったよ』で TOP」＋ AGENTS.md に kick との相互作用を1行追記（Tier B）。
- **ゴースト room の `!room.status` 判定が未適用（4本）**（横断 / 推測 / 低 / Tier A）。AGENTS.md:606 の規約 `|| (!!room && !room.status)` が word-wolf:617-619 / tatoe-narabe:905-907 / oshitsuke-zukan:485-487 / pita-hame:1836 に無い（適用済み: name-change:451-458 / tatoe-gp:867 / pittari-meter:722 / uso-jisho:904 / toomawashi:655、moji-soroe は removeBrokenRoom:1516 で同等）。tatoe-narabe:1385-1389 は status 不明を default: handleWaiting に落とす。実害は同コード再利用時の2分待ちと残置容量のみ。提案: 判定関数に1行追加＋REF-4 相当の lint 拡張。
- tatoe-narabe のゲストリロード復帰不可（tryReconnect:1733 で players 不在なら clearSession、joinRoom:1084 は waiting 以外拒否、startGame:1142 は result → revealing 直行のため二度と入れない。AGENTS.md:39/48 と不一致）は P4-1 に束ねた。

P2 で一般論のみとして捨てた指摘 9件: jinro の moveToVote / startDay / playAgain の read-then-update 二度押し／do-mannaka hostPickQuestion / hostNextRound の update 二度押し（同じ round 値で実害なし）／ikutsu-ieru room-null 分岐の古いリスナー残留（同一コード再作成前提）／blackjack / esadori の .info/connected 初回発火と tryReconnect の writeBackPresence 二重実行（冪等）／ゲスト orphanTimer の remove 前再確認なし／pita-hame の分割16購読／tatoe-gp・uso-jisho・pittari の final/done 画面でのリスナー残置／tatoe-narabe finishGame の update 非 transaction／各 create の onDisconnect 未 await。

---

## P4 機能品質・異常系 finding（5件・候補約25件から選抜）

### P4-1

```text
finding_id:   P4-1
dedupe_key:   横断:guest-reload-bounced-by-ondisconnect-remove
status:       新規（C-5 マトリクスで name-change / word-wolf の「リロード復帰不可」は既出だが、word-wolf のウルフ不在で必ず「ウルフの勝ち」・tatoe-narabe の二度と入れない・ikutsu-ieru の AGENTS.md との矛盾は新事実）
scope:        横断（magire-eshi / ikutsu-ieru / name-change / kaburazu-hint / word-wolf / tatoe-narabe）
基づく:       推測（機構はコードで直接裏取り。「旧接続の remove が新ページの get() より先に完了する」というタイミングは要 authorized-sandbox 実測。toomawashi/AGENTS.md:271-272 が同現象を実装事実として明記）
根拠:         リロードで旧接続の onDisconnect().remove() が先に発火→tryReconnect が「players 不在」で復帰拒否→waiting 以外は再参加も拒否:
              magire-eshi:1674-1679（!room.players[nickname] → clearSession → TOP、無言）＋:731（guestJoin は waiting 以外 not_waiting）
              ikutsu-ieru:655（onDisconnect remove）/1109-1111（tryReconnect 拒否）/623（status!=='waiting' は in_progress で拒否）。ikutsu-ieru/AGENTS.md:254-257 は「screen-input 中にリロード→現フェーズに復帰する。NG: トップ画面に飛ばされる」を実機チェック項目にしており実装と矛盾
              name-change:588/1033/552,564（AGENTS.md:75「sessionStorage から復帰する」）
              kaburazu-hint:835/1656-1658/811（AGENTS.md:263 は「プレイヤーデータがあれば復帰」で仕様上は許容だが体験は同じ）
              word-wolf:761/1244-1246/726。computeResult:884-902 はウルフ不在だと必ず「ウルフの勝ち」
              tatoe-narabe:1110/1733/1085。startGame:1142 は result→revealing 直行で waiting に戻らない。1729 のコメント「result 画面でもリロード復帰を許可する」は復帰を想定
              回避済みの例: toomawashi:1598-1650（AGENTS.md:266-272 に理由明記・transaction で再追加）、do-mannaka:735-739（保存スコアで再追加）、jinro:1127/2296（connected フラグ方式）、blackjack:1457（presence 分離）、pittari-meter:866-870 / tatoe-gp:911-921 / uso-jisho:980-985（再追加型）
              共通規約: AGENTS.md:553（ゲスト切断＝remove）、:566-567（「通常リロードでも切断扱いになるため復帰フローと両立しない」とホスト側にだけ注記）
機械チェック: lint exit 0（この規約は機械化されていない）
再現/観察:    guest。ゲーム中にタブをリロード（誤操作・スマホのスワイプ更新）→ reconnect-overlay → TOP。コードで参加し直しても「このゲームはすでに始まっています」/「このルームには今入れません」
              ikutsu: 次の「次のお題」（waiting 復帰）まで参加不能・その回の回答も消失。name-change: ゲームが終わるまで戻れない。kaburazu: 回答者がリロードすると host に「とばす」が出て、その子は最終結果まで復帰できない。word-wolf: その子がウルフだった場合、ウルフ不在のまま投票に進み必ず「ウルフの勝ち」。tatoe-narabe: 数字が消えて result まで戻れず、その部屋には二度と入れない
利用者影響:   子ども: 誤タップのリロード1回でその回/そのゲームから外れる。word-wolf はゲーム成立を壊す。スタッフ: 「戻れない」の原因が分からず進行が止まる／ルームを作り直すしかない
深刻度:       高
確信度:       中（機構は高。タイミング前提のみ要実測。iOS でソケットが遅れて閉じる場合は「復帰後に消される」形で同じ結末）
変更リスク:   中（切断・復帰設計の変更＝1アプリ内の同期に波及。word-wolf は word/isWolf、tatoe-narabe は number を players に持つため再追加時の値の扱いを決める必要あり）
提案アクション: 案A: toomawashi 型（tryReconnect で player を再作成。秘密情報・回答は復元不可＝AGENTS.md に明記）。案B: jinro 型（ゲーム中は onDisconnect を connected:false のみにし、明示退出で remove。回答・word・number が消えない・推奨）。直さない場合も ikutsu-ieru の AGENTS.md:254-257 を実装に合わせ、howto に「リロードしないでね」を出す案①を含めて判断。まず authorized-sandbox で guest リロードの実測を1回行い、締め出しが再現したら方式選択へ
受入条件:     authorized-sandbox で host1+guest2 を作り、ゲーム中の guest リロード→同名で同画面に復帰・回答/選択/word/number が保持・他端末の参加者一覧が二重にならないことを実測。kaburazu は回答者リロード後に「とばす」が出ないこと。リロードなしの通常切断は従来どおり
提案Tier:     C（まず実測報告）→ 実装は B（案B は切断設計変更なので人間の事前確認推奨）
判断待ち:     要P票（共通規約 AGENTS.md:553「ゲスト切断＝remove」に例外を足すか。案①現状維持＋howto 注意／②再追加型／③connected:false 型）
```

### P4-2

```text
finding_id:   P4-2
dedupe_key:   app:magire-eshi:result-caught-no-reversal-deadlock
status:       新規
scope:        app:magire-eshi
基づく:       観測（コード直接裏取り）
根拠:         apps/magire-eshi/index.html:1514（finalPhase = outcome === 'escaped' || outcome === 'aborted' || judged）、:1572-1580（outcome==='caught' && !judged && !reversalGuess のとき逆転回答フォームは絵師本人（isFake）にだけ出る）、:1634（rs-host-actions は isHost && finalPhase のときだけ表示）、hostAbortRound:1079-1083（status が REVEAL/DRAWING/DISCUSSION/VOTING 以外は return＝result は対象外）、screen-result に退出ボタンなし
機械チェック: lint exit 0
再現/観察:    まぎれ絵師が捕まる（outcome:'caught'）→ 絵師がタブを閉じる、AFK、または「答える」を押さない → reversalGuess も reversalJudge も null のまま → finalPhase が false → ホストの「次のラウンドへ」/「終わる」が非表示、当たり/外れボタンも描画されず、hostAbortRound() も status が result のため拒否
              期待: ホストがラウンドを終えられる。実際: ホストがタブを閉じて2分の TTL を待つまでルームが凍結
利用者影響:   子ども・スタッフ両方。1ラウンドごとに進行不能になりうる（絵師の子が入力をためらうだけで起きる）
深刻度:       高
確信度:       高
変更リスク:   低〜中（result 画面のホスト操作追加。RTDB スキーマは不変）
提案アクション: result でもホストが「答えなしで終わる」を押せるようにする（hostAbortRound の対象 status に RESULT を追加するか、reversalJudge を 'skip' で確定して finalPhase を真にする）。あわせて result 画面にホストの「終わる」を常時表示
受入条件:     stub で outcome=caught・reversalGuess=null のときホスト操作が表示される。authorized-sandbox で絵師離脱後に次ラウンドへ進める・通常の逆転回答経路は従来どおり
提案Tier:     B
判断待ち:     不要
```

### P4-3

```text
finding_id:   P4-3
dedupe_key:   横断:script-load-failure-blank-shell
status:       新規
scope:        横断（RTDB 20本＋ESM 分割アプリ quiz / kanji-sagashi / kotoba-shuffle / kotoba-pair）
基づく:       推測（発生条件は CDN・gstatic 遮断ネットワーク、デプロイ途中のキャッシュ不整合、ネットワーク断）
根拠:         RTDB 型は .screen{display:none} で active な画面がなく（kakure:16 / koedake:16 / kotoba-pair:22 / magire:16）、トップレベルの RoomkRTDB.initFirebase(firebase) が throw（rtdb-utils.js:57-63）するとスクリプト全体が停止し onclick ハンドラも未定義: kakure-number:510 / koedake:515 / kotoba-pair:501 / magire:486 / blackjack:352 / moji-soroe:354 / esadori:403 / ikutsu:449 / do-mannaka:467 / name-change:404 / pita-hame:1780 / pittari-meter:606 ほか全20本同型
              ESM 分割アプリはデータ import 失敗で静的シェルだけ残る: apps/quiz/app.js:2＋index.html:27,42-46（パック一覧が空・スタート disabled）、kanji-sagashi/app.js:2＋index.html:50、kotoba-shuffle/app.js:2＋index.html:25-30
              kotoba-pair:15-18（module import で window.shuffle を公開）→ :643,813,961,1625 は import 失敗時に TypeError で「ルームをつくる」「はじめる」「もういちど遊ぶ」が無言で死ぬ
              唯一の対策例: kotoba-theme/app.js:8-10, 232-234（waza.js 欠落時に「テーマのデータがまだありません。」）
機械チェック: lint exit 0。content-audit.mjs が questions.js 等を import するため構文エラーは CI 相当で検出可。実行時の取得失敗は対象外
再現/観察:    gstatic / cdnjs を遮断する学校・施設ネットワークで開く → 真っ白（RTDB 型）または「押せないスタート」だけの画面（ESM 型）。案内ゼロ、コンソールのみ
              期待: 「読み込みに失敗しました。読み込み直してください」の一文＋リロード導線
利用者影響:   スタッフ（画面共有中に「なぜ押せないか」が分からない）。発生頻度は低い
深刻度:       中
確信度:       高（経路）／中（頻度）
変更リスク:   低
提案アクション: 静的シェルに TOP を active で置くか、window.addEventListener('error') / try-catch で静的シェル内の案内文を差し替える共通パターンを1本決め、まず quiz と RTDB 1本に適用して様子を見る（横断展開は別起票）
受入条件:     DevTools の request blocking で firebasejs / questions.js をブロック → 子ども向け文言＋リロード導線が表示される
提案Tier:     C（パターン決め）→ B（個別適用）
判断待ち:     不要
```

### P4-4

```text
finding_id:   P4-4
dedupe_key:   横断:start-rematch-double-tap-false-error-and-double-room
status:       新規
scope:        横断（RTDB 型のほぼ全本）
基づく:       推測（transaction のローカル即時適用で2度目が届かない可能性あり・要実測）
根拠:         開始・再戦ボタンに押下ロックがなく2度目の transaction が abort→誤ったエラー:
              kakure-number:334-338,456,921-969（alert「始められませんでした。ルームの状態を確認してください」）、kotoba-pair:989-991/1656-1658（「はじめられなかったよ」トースト。パックチップ 1606-1608 も同型）、pittari-meter:1141-1146（alert）、pita-hame:2388-2432（「いまは始められないよ」）、tatoe-narabe:1180（2回目に「ルームが終了しています。トップへ戻ってください」＝特に誤解を招く）、blackjack:1198/1220/1258、moji-soroe:1338/1358/1378/1403/1432、esadori:1190/1218/1247、do-mannaka:954、jinro:1135、kaburazu-hint:844/1414/1477、ikutsu-ieru:661。word-wolf/tatoe-gp/uso-jisho の2回目は無言中断
              派生: ルーム作成ボタンに entryBusy が無い ikutsu:558 / jinro:997 / kaburazu:741 / do-mannaka:890 は、サーバー ack 待ちの間に二度押しすると room が2つでき、先の room が hostConnected=true のまま孤立（B-20 の _authWaitBusy は authReady 待ちの間しか効かない）。name-change:488-489 はボタン disabled で防止。blackjack / moji-soroe / esadori は entryBusy あり
機械チェック: lint exit 0
再現/観察:    host がタブレットで「はじめる」（または reveal の「つぎへ」「もういちど」）を2回タップ → 1回目の transaction が commit して画面が切り替わる → 2回目が invalid_state / bad_status で abort → 始まったばかりのラウンドの上に「始められませんでした」の alert / トーストが被さる。tatoe-narabe は「終了」と誤案内
              ルーム作成の二度押し: 先に作られた room が TTL 掃除に乗らず残る
利用者影響:   スタッフが混乱、子どもが待たされる。孤立 room は無料枠と掃除の負担
深刻度:       中
確信度:       中
変更リスク:   低
提案アクション: 各ボタンに busy フラグ＋disabled。abort 理由 bad_status / invalid_state は無言にする。ルーム作成4本は name-change:488-489 と同じ disabled 制御
受入条件:     authorized-sandbox で二度押し実測。届かないなら「誤案内のみ」に格下げ。stub で busy 中の2回目が transaction を呼ばないこと
提案Tier:     B
判断待ち:     不要
```

### P4-5

```text
finding_id:   P4-5
dedupe_key:   app:name-change:done-cleanup-shows-host-gone-overlay
status:       新規
scope:        app:name-change
基づく:       観測（コード経路で直接裏取り）
根拠:         apps/name-change/index.html:601-606（listener: snapshot が無いと isHost でなければ無条件で host-gone-overlay を表示）、:387-392（文言「GMが一時的に切断されました／再接続を待っています」）、:1007-1015 + :994-1004（hostFinish → 30秒後に transaction で room 削除）、:377-384（done 画面は「TOPに戻る」のみ）
              対照: ikutsu:857-860 / kaburazu:900-905 / jinro:1174-1180 は同じ場面で「ルームが終了しました」系のトースト
機械チェック: lint exit 0
再現/観察:    guest。GM が「ゲーム終了」→ 全員 done 画面 → 30秒放置 → GM 端末の scheduleDoneCleanup が room を削除 → guest 端末で snap.exists()=false → done 画面の上に「GMが一時的に切断されました 再接続を待っています」。listener と onDisconnect 予約も残る
              期待: 何も出ない（または「ルームが閉じられたよ」の軽い案内）
利用者影響:   子ども（正常に終わったのに「切断」「再接続待ち」と言われ、待ってしまう／不安になる）。毎回のゲーム終了で必ず起きる
深刻度:       中
確信度:       高
変更リスク:   低（分岐と文言）
提案アクション: !snap.exists() 分岐で done 中なら overlay を出さず、roomRef.off() と cancelRoomOnDisconnect を通したうえでトースト「ルームが閉じられたよ」（または何もしない）。P2-3 の name-change 分と同じ箇所なので同一コミットで閉じられる
受入条件:     authorized-sandbox で host+guest2、hostFinish 後 35秒待って guest に overlay が出ないこと。waiting 中に GM 切断→2分 TTL で overlay と自動削除が従来どおり動くこと（回帰）
提案Tier:     B
判断待ち:     不要
```

### P4 で落とした候補（起票せず本報告に残す。優先度上位のみ後日起票の対象）

| 対象 | 概要 | 根拠 | 深刻度 | 想定Tier |
|---|---|---|---|---|
| koedake-theater | 再接続時に前ラウンドの vote を session から復元し、次ラウンドで「投票しました」になり投票不能。openVotes は stale index を集計 | index.html:1001-1004, 1321-1330, 917-920, 1209, 887-890 | 中 | B |
| magire-eshi | 人数上限なし。9人目以降が同じ描画色（PALETTE 8色）で相談タイムが成立しない | :529, :781, guestJoin 726-742 に人数チェックなし | 中 | B |
| magire-eshi | hostFinish が transaction でなく update（AGENTS.md「遷移はすべて transaction」と不一致） | :1110-1111 | 低 | A/B |
| kakure-number | AGENTS.md「退出者が同じニックネームで再入室すれば復帰扱い」は players ノードが消えているため成立せず「すでに始まっています」で拒否 | :847, :861-863, :909 | 中 | B（P4-1 と同根の文書側） |
| kotoba-pair | howto:1836 と TOP:297 が「そろったらもう一回」を無条件に書くが、表向きモードは keepTurn = closed && isMatch（:1287-1289）で手番交代 | AGENTS.md「表向きモードでは必ず交代」 | 中 | B |
| kotoba-pair | ホスト自身の「おわる」で remove が off() より先に走り「ルームが閉じられたよ」が出て leaveCleanup が2回走る | :999-1004, 1718-1730 | 低 | B |
| kotoba-tantei | 選択中のチーム/役割ボタンを再押下すると同内容 update で onSnapshot が発火せず（推測）loading が戻らずロビー固着 | app.js:957-970, 436-443, 575-594; service.js:277-300 | 中 | B |
| kotoba-tantei | 購読エラー後 renderLobby がスピナーだけを描き、エラー文言も離脱ボタンもなし。#home に戻っても restoreSession が #lobby へ押し戻す | app.js:480-485, 260-268, 437, 1346-1347; service.js:741-746 | 中 | B |
| kotoba-tantei | authReady が null 解決した後の「少し待ってもう一度お試しください」は再試行で直らない誤案内（B-20 の是正が Firestore 版だけ未適用。C-9 は RTDB 14本のみ対象） | service.js:804-810; app.js:920-924, 950-954; firebase-config.js:30-33 | 低〜中 | B（B-20 追記） |
| pittari-meter / tatoe-gp / word-wolf | ニックネームの `. # $ [ ] /` を検証せず（他5本は拒否済み）、transaction が SDK の validateFirebaseData で reject → try/catch なしで無反応 | pittari:739-744, 963; tatoe-gp:1000-1005, 1167; word-wolf:636-640, 675, 761 | 中 | B＋lint 拡張 A |
| 7本の guestJoin | roomRef.get() が裸 await（C-9 は authReady のみ集計）。通信断時に unhandled rejection で無反応、entryBusy 保持なら以後のタップが無視される | blackjack:956, moji-soroe:934, esadori:976,1033, ikutsu:608, jinro:1068, kaburazu:796, do-mannaka:1082。name-change:544 のみ catch 済み（文言は大人向け） | 中 | B |
| pita-hame | onRoomGone がトーストなしで TOP。ホストの「ルームから出る」（パズル画面左上）が確認なしで全員のルームを即削除、ラベルが host/guest で同一 | :2650-2653, 2635-2648, 2655-2667, 1680-1687, 701, 772 | 中 | B |
| pita-hame | 退出者が participants に残り「全員完成」が成立せず、残り全員が完成しても endsAt+2秒まで待つ | :2401-2402, 2380-2385, 2352-2356, 2663 | 低〜中 | B |
| tatoe-gp / uso-jisho | 開始の too_few エラーが非表示の host-step-nickname 内 div に描かれ無反応（人数閾値ちょうどでの競合時のみ） | tatoe-gp:1247, 486-493, 1627; uso-jisho:1353, 538-545, 1539-1540 | 低 | B |
| tsuyomi-card | 3択のダブルタップで次カードに答えが入る（suki-type-check:363-369 は 300ms ガード実装済み） | app.js:96-106, 182-184; style.css:138,147 | 中 | B |
| value-card | 画像保存が CDN 遮断・html2canvas 失敗時に無反応、連打で2回保存・container 残留（順位付け・PNG 保存機能自体は §0.5 の意図的例外） | app.js:311-328, 343; index.html:11-12 | 低〜中 | B |
| kotoba-relay | AGENTS.md:30「15件」と :53「30件」の自己矛盾（実装30） | app.js:5-36 | 低 | A |
| scripts | content-audit.mjs の coverage 台帳が新規7アプリ未登録（A-10 の drift 検出が発火中） | scripts/content-audit.mjs:194-202 | 低 | A |

P4 で一般論のみとして捨てた指摘 17件: alert()/confirm() の使用／ikutsu の room 消滅後 listener 残留／blackjack hostRematch のホスト presence 一瞬欠落／do-mannaka 問題選択の二度押し（ローカル適用で不成立）／esadori 終了後 join の文言／stats の count タイミング差／pita-hame createRoom の catch 範囲／pita-hame restoreBoardIfMatch の completed 信頼／pittari-meter 待機中離脱者の hinting 中再接続／word-wolf 投票中離脱者への票／pita-hame host リロード直後のボタンラベル／pittari-meter hostReveal の get→update（P2 領域）／kotoba-tantei の無関係スナップショットによる loading リセット／value-card のインライン「あそびかた」と howto FAB の二重化／otona-talk app.js:2 コメントのずれ／kyoumi-sugoroku の confirm() 使用／stats-view の行クリックと button のバブリング。

### P4 で疑ったが静的に確認できなかったもの（起票しない）

- koedake handleVoting（1179-1203）はボタンを画面 entry 時にしか作らない。現状 voting へ直接遷移する経路はないが、将来の reveal→voting 直行で空の投票欄になる。
- magire handleVoting（1450-1476）は離脱者のボタンを残す。離脱者への票が単独最多になると escaped。
- kotoba-pair hostRevealPair と他クライアントの 2秒 scheduleSelectionClear の交錯（world-class generation guard で安全と判断）。
- kakure showHostDisconnectOverlay の早期 return（1113-1116）中に届いた唯一のスナップショットが捨てられる可能性。
- 4アプリ（kakure / koedake / kotoba-pair / magire）で getElementById が存在しない id を参照する箇所は機械照合でゼロ。

---

## 既存票との重複照合（no-op・起票しない）

| 既存票 | 照合結果 |
|---|---|
| B-16 / B-21 / P-6（30秒削除タイマーの ref 固定・cancel） | do-mannaka:1025-1048 / kakure-number:1057-1082 / name-change:994-1016 / tatoe-gp:1302-1323 / uso-jisho:1420-1444 / pittari-meter:1304-1330 で対応済み。pita-hame:2512-2527 は可変 net.roomRef だが gameId ガード＋stopAllTimers で実害なし。B-21 follow-up①（DONE タイマーが cancel なしで remove: ikutsu:1062-1065 / koedake:943-946,1283-1286 / magire:1112-1115,1640-1643 / kaburazu:1403-1407）は既知のまま新事実なし |
| B-18 | word-wolf は修正済み。name-change / tatoe-narabe の同型を P2-3 に束ねて追記 |
| B-20 / C-9 / P-7 | 全 RTDB 20本が waitAuthOrExplain または try/catch 済み（blackjack:445 / esadori:482 / ikutsu:512 / jinro:787 / kaburazu:652 / kakure:594 / koedake:521 / kotoba-pair:590 / magire:492 / do-mannaka:842 ほか）。kotoba-tantei（Firestore）だけ未適用＝落とした候補で B-20 追記扱い |
| B2 pittari-meter goToTop の片付け | :1702-1735 で解消済み |
| B3 kotoba-tantei 購読エラーの生メッセージ | app.js:480-483 で日本語固定文言に置換済み。落とした候補の「スピナー固定」はその先の操作不能 |
| C1 value-card 中断導線 | index.html:66,84 で実装済み・sortable 片付け app.js:346-354 確認 |
| C-5 | 「参加者ゼロ孤児ルーム残置は設計許容」「name-change / word-wolf のゲストリロード復帰不可」「jinro の討論タイマーだけ生 Date.now()」は既出。word-wolf のウルフ不在で必ず「ウルフの勝ち」は新事実として P4-1 に含めた |
| C-6 / C-7 | 本体は既出。stats 名前空間と firebasejs 60タグを P1-2 / P1-3 で追記 |
| A-11 | 351 補間を裏取りし未エスケープ 0 件。検査範囲の穴は既知のまま |
| 提案11（クリップボード7本） | 変更なし。pita-hame は :2734-2746 で catch＋トースト済みのためリストから外せる（追記レベル）。do-mannaka:869-879 は既に対象。ikutsu:504-507 / name-change:981-987 は catch 済み |
| 各 AGENTS.md の意図的逸脱 | esadori の presence ノード有無方式・観戦者書き込みゼロ、jinro の「結果画面で自動削除しない」「ゲスト切断は connected=false」、kakure-number / pittari-meter の「同名再入室＝復帰」、公認バリアント「ふりかえり中は削除しない」（tatoe-narabe / toomawashi / moji-soroe / oshitsuke-zukan）、kyapa-graph / value-card / suki-type-check / kimochi-map の哲学ガード例外は起票せず |
| 秘密情報の画面露出 | word-wolf:1180（result）/ blackjack:721（settled まで hideFrom=1）/ kotoba-tantei:1592-1597（revealed のみ）/ kakure-number:1254（isMe を「？」）ほか、性善説の範囲内で画面露出なし |
| オープンリダイレクト・postMessage・管理画面 | location.replace の遷移先は固定相対パス＋自己 URL のみ（kotoba-tantei/app.js:238,1385、スタブ6本）。slides の BroadcastChannel/storage は同一オリジン・インデックス番号のみ。stats-view は textContent/createElement のみ・アプリ名は ^[A-Za-z0-9_-]+$ 検証（app.js:29,99） |
| リダイレクトスタブ6本 | codenames / hint-de-pinto / iisen-show / ito / sukina-map / kotoba-waza はいずれも location.replace('../{new}/' + location.search + location.hash)（各 index.html:11）で search/hash を引き継ぎ、転送先6フォルダ実在。旧 ?watch=CODE 観戦リンクも保持 |
| ポータル / guide / checkin / vote | カード href 46 本・slides.html・data-scenes 5種・updates.json 55件はすべて実在・整合。guide の #sec-* 9本と ../{app}/ リンクは実在。checkin / vote は本体スタブ（howto 未組込は正常） |
| howto 文言 | 20 アプリで実ボタン名と照合、不一致なし（kotoba-pair の表向きモードのみ落とした候補に記載） |

---

## static-only では確認できず、authorized-sandbox での実測が必要な項目

1. ホスト側 SDK 自動再接続で onDisconnect が発火しつつ UI が続行する実挙動（P2-1）。DevTools Offline 10秒で再現できるか
2. ゲストのリロード時に旧接続の remove が新ページの get() より先に完了するか（P4-1・P2-2）。iOS でソケット閉鎖が遅れる場合の結末
3. 開始ボタン二度押しが transaction のローカル即時適用で実際に届くか（P4-4）
4. 不正キー入りニックネームで transaction が reject し UI が無反応になるか（落とした候補）
5. compat 10.14.1 の get() が offline で reject するか保留するか（guestJoin 裸 await）
6. Firestore の同内容 update で onSnapshot が発火しないか（kotoba-tantei loading 固着）
7. TTL 経過後の TOP 画面でオーバーレイが実際に残るか（P2-3。stub でも DOM 確認可能）
8. jinro の kick 後に別接続の onDisconnect 発火で players/{nick} が部分再生成されるか
9. 「最後の回答と同時に退出」の窓が実運用で踏まれる頻度（P2-5）
10. 既存票の未実機確認（B1 hint-de-pinto、B2、B-16、B-21 の runtime 確認）は依然未実施

---

## 次に人間が判断すべき項目（監査時の優先度順）

1. P4-1 / P2-2 の方式選択: ゲーム中のゲスト切断を「remove 方式」から「connected:false 方式」へ変える例外を共通規約（AGENTS.md:553）に足すか
2. P2-1 の横展開を Tier B として起票するか（14本×1コミット。P2-2 と同居させる設計にするか）
3. P2-4 の P票: ゲーム中の同名再入室を復帰手段として残すか（まず全5本に isHost 判定だけ入れて乗っ取りを塞ぐ）
4. P1-2 / P1-3 の C-6・C-7 持ち越し P票: rules 段階1/2 の適用可否（stats 名前空間を含めて）と firebase SDK の SRI 扱い a/b
5. content-audit の coverage 台帳更新（Tier A）と P4-2 magire-eshi の進行不能修正（Tier B）を次のループの着手候補に載せるか

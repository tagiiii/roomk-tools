# C-10: 隔離 Firebase 実測報告（2026-09-05）

対象: 2026-09-04 基準監査の P2-1 / P2-2 / P4-1 / P4-4。調査・報告のみで、修正は未実施。
実測ソースは `9ae7c26`。2026-09-04〜05 JST の既存実測を引き継ぎ、09-05 にブラウザ層の追加実測と証拠照合を行った。

## 完了範囲とオーナー指示

2026-09-05、オーナーから「iphone操作は無しで進めてください」と指示を受領した。
**P4-1 の実機 iOS Safari 1回を今回の完了条件から除外**し、Mac 上の実測・報告を C-10 の完了範囲とする。
iPhone を操作した、Safari で検証した、実機同等の動作を保証したという意味ではない。
実機の無線切断、OS によるバックグラウンド停止、Safari 固有の接続終了タイミングは未検証として残す。
この指示は P-11 / P-12 / P-13 の方式承認、rules 変更、本番接続・公開の承認には転用しない。

## 環境・方法

- Emulator 専用 projectId / RTDB namespace: `demo-roomk-c10`。本番 Firebase の読書きなし。
- firebase-tools 15.29.0、Database Emulator 4.11.2、Temurin 21.0.12.1+1、Firebase JS SDK 10.14.1。
- 前回のアプリ内 Chrome148 / CDP Chrome153 の保存記録と、今回の Playwright CLI / HeadlessChrome153 の実測を区別する。
- Auth9099 / RTDB9000 / Hosting5500 / UI4000 はループバック bind。LAN 公開なし。ControlCenter5000 は操作しない。
- アプリコピーだけを scratch に配置し、共有初期化を Auth/RTDB Emulator へ接続、stats は no-op 化。SDK 自体は本物であり、メモリ内スタブの結果ではない。
- SDK 制御切断は `goOffline()/goOnline()`。今回のブラウザ層切断は `BrowserContext.setOffline(true/false)`。両者は同一条件ではない。
- ブラウザ層では別コンテキストの host/guest を UI から作成・参加させ、`.info/connected`、ページ内 marker、RTDB の REST snapshot と画面表示を記録。人工 online イベント・リロード・SDK の強制再接続は使わない。
- 初回追加実測は onDisconnect 観測後3秒待機、最終再実測では10秒待機して Online に戻した。実回線の transport timeout を計測したものではない。
- [証拠抜粋 JSON](evidence/c10-2026-09-05.json) を同梱。`prior_text` は引き継いだ保存結果、`browser` / `ui_double_click` / `browser_10s` は今回の機械記録。ローカル試験ルームの合成データだけを含む。

## 結果一覧

| finding | 対象・方法 | 観察結果と限定 |
| --- | --- | --- |
| P4-1 | word-wolf / tatoe-narabe、Mac のリロード（前回保存記録） | ゲスト消失・復帰拒否を記録。word-wolf はウルフゲスト消失後 `citizenWin:false`。iOS は未実施・今回条件から除外 |
| P2-2 | word-wolf、ブラウザ層の切断・復帰 | SDK が再接続しても player が null。次の UI 操作で `ready` だけの部分ノードになることを確認 |
| P2-2 | pittari-meter、SDK 制御切断（前回保存記録） | guestB 消失後、回答操作で `decided` / `guess` だけの部分ノード。今回このアプリをブラウザ層で再試験したわけではない |
| P2-1 | do-mannaka / selecting、ブラウザ層の切断・復帰 | SDK 再接続後も `hostConnected:false`。待機表示が残り、TTL 経過後 room が消失して全員 TOP |
| P2-1 | name-change / naming、SDK 制御切断（前回保存記録） | Offline/Online 前後で `hostConnected:false` が残る。**2分後削除は確定していない** |
| P2-1 対照 | kaburazu-hint、SDK 制御切断（前回保存記録） | `hostConnected:true` / `hostDisconnectedAt:null` に戻り room 存続。対照の切断手法は別条件 |
| P4-4 | kakure-number / tatoe-narabe、実 UI の dblclick | 開始と次ラウンド／再戦で対象ボタンへの click は各1回。今回の UI 条件では誤案内を再現せず |
| P4-4 補助 | 前回の連続関数呼び出し・ルーム作成試験 | 誤案内の報告と状態が1回だけ進む保存結果。通常 UI の2回到達の証拠ではない。作成二重化は前回報告で再現せず |

## P2-1: 再接続済みでもホスト不在扱い

do-mannaka 初回ブラウザ実測の時系列（UTC、JST は9時間加算）:

1. `23:16:04.088` に onDisconnect が `hostConnected:false` と timestamp を保存。
2. `23:16:07.146` に `.info/connected:true` へ自動復帰。ページ marker は不変で、リロードなし。
3. 復帰後も `hostConnected:false`。ゲストに残り117秒の待機表示。
4. `23:18:46.389` の REST 確認時点で room は null、全3画面 TOP。削除の瞬間は採時していない（確認時点は切断から約162秒後）。

オンラインのホストがいるのに期限切れ処理の対象となる利用者影響を確認した。
name-change の naming はコード上 `ORPHAN_TTL_INGAME_MS = 30分` を利用するため、do-mannaka の「2分」を横展開しない。
name-change の保存記録が直接示すのは false の残存までであり、30分待機後の削除やブラウザ層復帰は未測定。
他の14アプリすべてに同じ実害を確認したという結論にはしない。

10秒待機の再実測でも同じ結果。`23:32:59.146 UTC` に切断記録、`23:33:09.202` に SDK 再接続、フラグは false のまま。`23:35:40.209`（約161秒後）の確認で room:null / 全員TOP。初回と別ルームで再現した。

## P2-2: 接続復帰と参加者データ復元は別

word-wolf 初回追加実測では、切断前の guestA は `isHost/isWolf/ready/word` を持っていた。
Offline で player が消失し、`23:16:24.333 UTC` に SDK が再接続した後にも null。
ページ marker 不変・navigator.onLine:true のまま、カードと準備ボタンの UI 操作を行うと `{ "ready": true }` だけが保存された。
秘密情報や役割は自動復元されていない。SDK 接続が戻っただけでは安全な復帰にならないことを示す。
pittari-meter の既存結果も同じ種類の部分復活だが、手法差を隠さない。

10秒待機の再実測は `23:35:06.012 UTC` に未接続、`23:35:16.044` に接続復帰。marker不変・player:null の後、UI操作で再び `{ "ready": true }` だけとなった。

## P4-1: リロード結果の証拠範囲

word-wolf の保存 snapshot は、revealing の guestB が `isWolf:true` → リロード後 players は guestA/host のみ → result は `citizenWin:false` を示す。
TOP へ戻ることと「このゲームはすでに始まっています」の再参加エラーは前回担当の画面観察報告による。保存 snapshot だけでは画面文言や get/onDisconnect の厳密な先後までは立証できない。
tatoe-narabe も復帰・再参加拒否は前回画面観察報告であり、保存 snapshot は result に host だけが残った状態。
「全条件で必ずウルフの勝ち」「永遠に再参加不能」とは一般化せず、**試験した進行中ルームでの結果**とする。新ルーム作成等の回避可能性まで否定しない。
実機 iOS の結果は存在せず、今回のオーナー指示により未実施のまま閉じる。

## P4-4: 関数呼び出しと UI 入力を分離

Playwright の `locator.dblclick()` と capture listener による click 記録を使用した。
kakure-number は host+3guests で開始と「つぎへ」、tatoe-narabe は host+2guests で開始と「もう一度プレイ」を確認。
いずれも対象ボタンへの click は各1回で、2回目の click 到達は観測されなかった。誤案内・console error は今回0件。
前回の関数連続呼び出しでの誤案内は補助的な潜在経路の記録として残し、通常 UI での不具合確定とはしない。
ikutsu-ieru の開始誤案内は前回報告のみで詳細なメッセージ証拠が不足する。ルーム作成試験の既存 snapshot も厳密な全 before/after 記録ではないため、「二重作成しない保証」とはしない。
第3版手順の格下げ条件に従い、**現時点の Tier B 起票は見送り**。端末や遅延条件による再現情報が得られた場合に再評価する。

## 検証環境の問題と訂正

前回「CDP/DevTools Offline では RTDB が再接続しない」とされたが、scratch CSP が localhost:9000 の long-poll `/.lp` script を遮断していたことを直接観測した。
script-src のローカル9000許可後は復帰し、残った iframe 警告も frame-src の同許可で解消してから新コンテキストで再実測した。
connect-src だけの許可では足りなかった。補正は scratch 設定のみで、リポジトリの firebase.json や rules は変更していない。
補正後の自動再接続を確認できたため、**「CDP では確認不可能」という一般化は撤回**する。過去の全試行の失敗原因を一つずつ証明したものではない。

## 安全性と未検証事項

- 元アプリ・共有JS・rules・本番設定は無変更。scratch rules は `auth != null` の既存形で、所有権やスキーマを厳格に検証する rules ではない。
- 最終試験の接続観測先は localhost の5500/9000/9099 と、SDK配信用 gstatic、Google Fonts。CSPを本番 Firebase 向けに開放していない。
- 切断試験の console には意図した `ERR_INTERNET_DISCONNECTED` がある。「全試験エラー0」とは報告しない。補正後の対象試験には CSP 違反なし。
- 匿名認証通過・クライアント側ガードは本人確認や所有権認可の保証ではない。P-13 の rules 適用・stats互換性テスト・SRI/DEP-2 は今回未実施。
- 実 Safari / iPhone / 実 Wi-Fi、異なるネットワーク遅延、全アプリ網羅、本番挙動は未検証。

## 次の判断（修正・承認の代行はしない）

1. **P2-1 → P-14 で Tier B 昇格判断**: まず実測した do-mannaka を対象に、ホスト再接続時の接続フラグ復元・切断予約再登録を設計する。存在・状態確認なしの update で削除済み room を再生成しないこと、退出後に再接続リスナーが残らないことも受入条件。name-change や他アプリは固有TTL等の確認後に別単位で判断する。
2. **P4-1/P2-2 → 既存 P-11**: データ保持型の復帰方式を検討する材料は得られたが、connected:false 方式を採用済みとはしない。UI・退出・期限切れ掃除・旧セッションとの互換性を含めてオーナーが判断する。
3. **同名再入室 → 既存 P-12**: sessionStorage だけを認証境界にせず、別端末復帰要件と本人確認を別に判断。B-24 の範囲を拡大しない。
4. **P4-4**: 現在は実 UI 再現なしのため昇格見送り。新たな判断票は増やさない。
5. **P-13** は未回答のまま。今回のC-10完了をrules変更承認として扱わない。

## 記録・検証

報告書・索引・証拠抜粋を同じ記録単位に保存し、バックログに調査完了とiOS除外の指示を追記する。
独立レビューは別コンテキストの同系統エージェントによる文書・証拠照合であり、異系統モデルの二重承認とは記載しない。
2026-09-05 にレビューを実施。保存証拠と JSON の一致、10秒条件、iOS除外、観察と推論の分離を確認し承認。P-11 の無条件断定も条件付きへ訂正した。
`git diff --check` / `bash scripts/lint.sh` は exit 0。`node scripts/content-audit.mjs` は exit 0、既知の coverage 警告7件あり。JSONの再接続・marker・部分ノード・TTL・10秒条件および相対リンク実在を機械照合した。
検証用ブラウザと Emulator は終了し、4000/5500/9000/9099/9222 に LISTEN なしを確認。コミットは記録文書のみ、本番向けの push・PR・デプロイはしない。
本項目の完了は調査の完了であって、発見した不具合の解消やセキュリティ保証ではない。

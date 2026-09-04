# 改善バックログ（/loop 運用の正本）

日々の改善ループ（AIエージェントの自律反復実行）が消化してよいタスクと、その運用ルールの正本。
2026-07-10 策定（複数エージェント監査＋別系統モデル相談の合意内容）。

「司令塔」「実装モデル」「別系統モデル」などの役割の定義は [ai-roles.md](./ai-roles.md) が正本。
モデル世代が上がったときにこのファイルのガードレールを緩めてよいかは、同ファイルの「ガードレールの2種類」に従う。

## 運用ルール（ガードレール）

ループは「自律的な改善者」ではなく「承認済みバックログを消化し、技術的な動作確認まで行う保守作業員」。子どもやメンターにとっての使いやすさ・楽しさなどの体験判断は人間が行うが、そのレビューは非同期とし、ループの進行条件にはしない。

1. **このファイルに載っている項目だけ**を着手対象とする。計画外の新規判断（新機能・新コンテンツの投入、仕様変更）はループでは行わず、「提案」として本ファイルの候補欄に追記するに留める
2. **変更禁止パス**: `firestore.rules` / `database.rules.json` / `firebase.json` / `apps/shared/**` / `.github/**` に変更が及ぶ場合はその項目に着手せず、Tier D として人間へ回して、別の着手可能な項目へ進む
3. 1イテレーション = **1アプリ × 1関心事**、差分の目安 200 行以内、1コミット（Conventional Commits 準拠）。**この単位は revert しやすさのためであり、モデルの能力が上がっても束ねない。** 200行は目安で、単一の関心事が分割できない場合（1ファイル完結の本体・全件機械置換）は超過してよく、超過した理由をコミットメッセージに書く
4. 着手前後に `bash scripts/lint.sh` を実行。コンテンツを触った場合は `node scripts/content-audit.mjs` も実行し、エラー・新規重複が出たら修正 1 回まで行う。解消できなければその項目を保留し、結果を記録して別の着手可能な項目へ進む
5. 利用者に見える変更や挙動変更は、完了前に **AIによるブラウザ動作確認**を行う。PC・モバイル表示、主要操作、コンソールエラーを確認し、通信を伴うアプリでは必要に応じてホスト・ゲスト間の同期、再接続、退出も確認する
6. 子ども向け文言や実際の場での使いやすさなど、AIだけでは確定できない体験品質は人間が事後レビューする。**「体験レビュー待ち」はコミット、項目の完了、次の項目への着手を妨げず、ループの停止条件にしない**。指摘が出た場合は、承認済みの修正項目としてバックログへ追加する
7. 完了した項目はチェックを付け、コミットハッシュとAI動作確認の概要を添える。人間の仕様判断・権限・変更禁止パスの解除が必要な項目は保留して別の項目へ進み、着手可能な項目がなくなった場合にだけループを終了する。**着手可能な項目がない状態は異常ではなく正常な終了条件である**（無理に提案をひねり出さない）
8. **ループ起動時の必須出力**: 実行の冒頭で本ファイルの「判断待ち」セクションを読み、「判断待ち: N件 / 最古X日前 / 上位3件（各1行）」を必ず表示する。0件なら「判断待ちなし」と明示する（2026-07-11 提案7承認により追加）
9. 人間の判断が必要な事項が新たに発生したら（提案欄への追記・C系レポートの「修正は未実施」・Tier D の新規発生）、同時に「判断待ち」セクションへ P-項目を起票する。**新規起票は1回のループ実行につき3件まで**（判断案件の流入上限。別系統モデルの指摘反映）。これは AI の発見能力の上限ではなく**人間の判断キューへの流入制御**なので、モデル世代が上がっても緩めない

### タスクの区分（Tier）

| Tier | 意味 | merge 権 |
|---|---|---|
| A | 機械検証可能・挙動を変えない → 修正まで自律で可 | ループ |
| B | 利用者に見える・文言や見た目が変わる → AIが規約照合・ブラウザ動作確認後に反映可。人間の体験レビューは事後 | ループ（AI確認後） |
| C | 調査・報告のみ。変更しない | — |
| D | 人間専任。ループは触らない | 人間 |

### Tier B+ シャドー運用（2026-07-11 提案8承認・測定のみ、権限移譲なし）

「事実検証済みの既存コンテンツ修正」「diff を正規表現1本で説明でき置換前後をスクリプトで全件照合できる機械置換」に該当する案件では、実装前に**実装モデル＋別系統モデルの2系統独立判定**を取り、**判定結果を記録するだけで適用は従来どおり人間承認（D または昇格済み項目）とする**。記録は該当項目に「B+シャドー判定: 実装モデル=承認/却下、別系統=承認/却下、意見割れ有無」を添える。一定件数（目安10件）たまったら誤承認率（人間の最終判断と2系統一致判定の食い違い率）を集計し、権限移譲の是非を再判断する。

- **2系統が一致しても、それは精度の話であって権限の話ではない**（2系統が同じ盲点を共有しうる、という却下理由は実装モデルが強くなっても変わらない）
- **モデル世代が変わったら集計をリセットする。** 世代をまたいだ判定を混ぜて誤承認率を出さない（→ [ai-roles.md](./ai-roles.md)）
- **世代区分の記録**: 2026-09-04 に司令塔の世代を更新した（実装モデルは変更なし）。旧世代の判定記録は履歴としてそのまま残し、同日以降の判定は新しい集計として扱う。旧世代の判定と混ぜて誤承認率を計算しない。詳細なモデル名は [ai-roles.md](./ai-roles.md) の世代履歴を参照する

### drafts/ プロトタイプ制度（2026-07-11 提案9承認）

新規アプリのプロトタイプは、以下の条件をすべて満たす場合に限り、承認済みバックログ項目としてループが自律作成できる。

1. 配置はリポジトリ直下 `drafts/{app-name}/`。GitHub Pages には配信されない（deploy.yml の artifact path が `./apps` であることを 2026-07-11 実確認済み）。ただし**公開リポジトリのためソース自体は公開される**（オーナー許容済み）
2. Firebase 未接続（オフラインモックのみ）。`fetch` / XMLHttpRequest / WebSocket / 外部スクリプト読み込みも禁止（Google Fonts / Material Symbols のみ許可）
3. ポータル・updates.json への追記禁止。同時に存在できるドラフトは3本まで
4. 着手前に `scripts/draft-lint.sh`（A-8）が整備済みであること。ドラフトのコミット前に draft-lint を通す
5. `drafts/` 配下に限り、初回コミットは差分200行制限の例外とする（プロトタイプは1ファイル完結で200行を超えるため。別系統モデルの指摘反映）
6. 28日判断が付かないドラフトは「判断待ち」に削除候補として起票し、以後は変更を凍結する
7. **apps/ への移植と公開は、まとめて1つの Tier D ゲート**とする（最終差分を人間が確認してから移植。移植だけ先行して直URLで公開状態になる穴を防ぐ。別系統モデルの指摘反映）

## 判断待ち（人間の承認キュー。2026-07-11 提案7承認により新設）

1項目 = 1つの P-番号。人間は各項目の「回答:」に **承認 / 却下 / 保留** のいずれかを書くだけでよい（保留は理由と再確認日を添える）。14日無応答の項目は【再掲】を付けて先頭へ。28日無応答で「塩漬け」へ移動し再掲を止める（**無応答は承認ではない**。安全・セキュリティ・子どもの体験に関わる項目は塩漬け対象外）。決着した項目は該当 Tier への昇格または却下記録ののち、末尾の決着履歴へ1行残して本文から削除する。

- **P-8**（起票 2026-07-13、対象: 監査カタログ P7/P8 停止ゲート。詳細と語彙・観察表は `docs/sakusen-selection-proposal.md`）: 作戦会議のツール選択語彙を、子どもの固定ラベルではなく「その日の本人の希望」を表す非序列の語彙（本人の希望語＋第1級の値〈きくだけ／パス／弱い関心〉）で確定してよいか。
  - 推奨: 案②（セット1を語彙として確定し、所要/人数/発話量/自己開示/記録などの条件軸は P-9 のメタデータへ分離）。禁止事項: 属性ラベルを作らない・希望を推定/保存/履歴化/採点/推薦/順位付けしない・きくだけ/パス/弱い関心を同格に置く。
  - 承認すると: P7 個別監査の「語彙」前提が満たされる（P-9 と両方承認で初めて横断監査を解禁）／ 却下・保留すると: 現状維持・横断監査は停止継続 ／ 可逆性: 文書上の定義でコード非依存・いつでも可
  - 回答: **保留**（2026-07-27 人間回答・チャットで受領「一旦保留でOK」。再確認日 2026-08-10。P-8/P-9 保留のため P7 横断監査・ポータル実装の停止ゲートは継続）
- **P-9**（起票 2026-07-13、対象: 監査カタログ P7/P8 停止ゲート。詳細は `docs/sakusen-selection-proposal.md`）: ポータルの `data-scenes`（場所）を残し、スタッフ閲覧面に観測可能な9属性（duration/party/voice/disclosure_selfstory/disclosure_recall/sharing/record/opt_out/self_declared_scope）の選択メタを足すスキーマで確定してよいか。`axis`（4軸）は含めず、確定後に別P票で追加。
  - 推奨: 案①（観測可能9属性＋各型〈単一/複数/unknown〉を先に固め、axis は 4軸マッピング確定後の別P票）。禁止事項: self_declared_scope は表示専用（原文転記・絞り込み/適合判定に使わない）・子ども画面に出さない・状態の推定/保存/採点/自動推薦/順位付けをしない。
  - 承認すると: P8-1/P8-2 の実装前提（属性の置き場）が定まる。承認後のポータル実装は通常 B・`data-scenes` へ追加のみ（後方互換・子ども画面不変）／ 却下・保留すると: 現状維持 ／ 可逆性: 追加のみで可逆
  - 回答: **保留**（2026-07-27 人間回答・チャットで受領「一旦保留でOK」。再確認日 2026-08-10。P-8/P-9 保留のため P7 横断監査・ポータル実装の停止ゲートは継続）
- **P-10**（起票 2026-07-13、対象: 監査カタログ C3 = quiz 事実系検証。詳細 `docs/reports/audit-run-2026-07-13.md`）: 難読地名以外の quiz 事実系コンテンツの検証運用（範囲・頻度・未検証の許容）をどこまで承認するか。
  - 調査の要点: 非 nandoku 320問を全読・分類し、高リスク中心にサンプル（各カテゴリ3〜5問・確認日 2026-07-13・Web 一次情報2件目安）を実検証 → **サンプル内で答えの事実誤り0件**。ただし全数保証ではなく、リスク分類（tofuken-zatsugaku・zatsugaku-king-2 を中〜高と見たが暫定・主観系にも事実解説が含まれうる）も未確定。修正（問題差し替え）は D-3 のまま別項目。
  - 選択肢（組み合わせ可）: ①C-1 同型の継続ローテを高リスクカテゴリに設ける（対象カテゴリと頻度は承認時に確定・「50問だけ」を前提にしない）②理科/漢字/ことば文化/誤用日本語などは一巡検証のみ実施し以後は非ローテ ③辞書準拠で陳腐化しない定義系・主観系は「shipped＝非検証」と明文化してリスク受容。
  - 推奨: ①（高リスクカテゴリの継続ローテ・対象は人間確定）＋③（安定・主観系の非検証明文化）の併用。
  - 承認すると: 検証運用の方針が定まり C3 を閉じられる ／ 却下・保留すると: 現状維持（非 nandoku は非検証のまま）／ 可逆性: 方針文書のため可逆
  - 回答: **保留**（2026-07-27 人間回答・チャットで受領「一旦保留でOK」。再確認日 2026-08-10。非 nandoku は非検証のまま現状維持）

- **P-11**（起票 2026-09-04、対象: 監査 P4-1 / P2-2、報告書 `docs/reports/audit-run-2026-09-04-fable-5-1.md`）: ゲーム中のゲストがリロードまたは一時切断したとき、共通規約「ゲスト切断＝`onDisconnect().remove()`」（AGENTS.md「切断時の挙動」）に例外を足して復帰できるようにしてよいか。現状は旧接続の remove が先に発火し、magire-eshi / ikutsu-ieru / name-change / kaburazu-hint / word-wolf / tatoe-narabe で復帰も再参加も拒否される（word-wolf はウルフ不在で必ず「ウルフの勝ち」、tatoe-narabe は二度と入れない。ikutsu-ieru は自 AGENTS.md:254-257 の期待と矛盾）。
  - 案①: 現状維持＋howto に「ゲーム中はリロードしないでね」＋ikutsu-ieru の AGENTS.md を実装に合わせる ／ 案②: toomawashi 型（tryReconnect で players に再追加。word / number など players 直下の値は復元不可） ／ 案③: jinro 型（ゲーム中は onDisconnect を `connected:false` のみにし、明示退出で remove。値が消えない）
  - 推奨: まず C-10 ③で締め出しを実測してから案③。理由: 子どもの誤タップ1回でゲームが壊れるのは体験上の実害が大きく、案②では word-wolf / tatoe-narabe の秘密情報が戻らない。影響: 切断表示と TTL 掃除の挙動が変わるため、採用アプリごとに AGENTS.md へ明記が必要。関連: P2-1 / P2-2（同じ関数に同居させると1経路で閉じる）、B-21 follow-up
  - 承認すると: 案に応じて 1アプリ×1コミットの Tier B を起票 ／ 却下・保留すると: 現状維持（案①の文書側だけ Tier A/B で起票可） ／ 可逆性: アプリ単位で revert 可
  - 回答:
- **P-12**（起票 2026-09-04、対象: 監査 P2-4、報告書 `docs/reports/audit-run-2026-09-04-fable-5-1.md`）: 「ゲーム中に同じニックネームで入り直せば復帰扱い」の分岐（kakure-number / pittari-meter は AGENTS.md で意図として明文化、do-mannaka / tatoe-gp / uso-jisho は未記載）を復帰手段として残してよいか。現状は transaction 外で本人確認がなく、接続中の他人の名前を打つだけでその人の回答・スコアを上書きし、端末を閉じるとノードごと消せる（ホスト名の乗っ取りは B-24 で先に塞ぐ）。
  - 案①: 復帰は sessionStorage（tryReconnect）だけに限定し、この分岐を削除 ／ 案②: 分岐は残し transaction 内で sessionId 等の照合を足す（スキーマ追加） ／ 案③: 現状維持＋do-mannaka / tatoe-gp / uso-jisho の AGENTS.md に意図として明文化
  - 推奨: B-24 のホスト名保護は先行する。復帰方式の最終判断は C-10 と P-11 の結果まで保留する。P-11 で connected:false 方式を採用する場合は、同名再入室分岐を削除して sessionStorage 復帰だけにする案①を推奨する。別端末からの復帰が必要と人間が判断した場合のみ、sessionId 等を照合する案②を検討する。本人確認のない案③（現状維持＋文書化）は他のゲスト名による任意の再入室・上書きを残すため非推奨。影響: 別端末からの復帰利便性 vs 同名タイプミス／いたずらによる誤乗っ取り。関連: B-24 / P-11 / C-10
  - 承認すると: 案に応じて Tier B（①②）を起票 ／ 却下・保留すると: B-24 のみ実施し分岐は現状維持（文書化は行わない） ／ 可逆性: 高
  - 回答:
- **P-13**（起票 2026-09-04、対象: 監査 P1-2、C-6 で「次回起票」と予告されたまま未起票だった適用判断。報告書 `docs/reports/audit-run-2026-09-04-fable-5-1.md`）: `database.rules.json` の段階1（実在名前空間の固定）・段階2（`.validate`）を適用してよいか。C-6 報告（2026-07-12）は `stats/` 名前空間（2026-07-28 導入の stats.js）を知らないため、段階1をそのまま適用すると利用回数カウンタが無音で停止する＝適用時は `stats` の追加が条件。
  - 推奨: 段階1は `stats` を加えたうえで承認（既存影響ゼロ・Emulator テストは C-6 の手順）、段階2は Emulator 環境が整ってから。影響: 変更禁止パス（Tier D・人間が本番デプロイ）。関連: C-6 / P1-4（firestore.rules の公開 read を文書に明記する件も D の中で同時に）。firebasejs の SRI／DEP-2 方針は本票に含めない（提案12）
  - 承認すると: 人間作業（rules 編集・Emulator 検証・デプロイ） ／ 却下・保留すると: 現状維持 ／ 可逆性: デプロイで戻せる
  - 回答:

- **P-1**（起票 2026-07-11、対象: バックログ D-2）: firestore.rules の CI デプロイ化に必要な GCP 権限付与（roles/serviceusage.serviceUsageConsumer）を、あなた自身の作業として予定に入れますか？
  - 推奨: 保留（再確認日 2026-08-01）。根拠: ①現在は手動デプロイ運用で実害が小さい ②権限付与は GCP コンソールでの人間作業のみでループは支援できない ③急ぐ理由となる rules 変更予定が現在ない
  - 承認すると: あなたの作業予定に入り、完了後 D-2 が着手可能になる ／ 却下すると: D-2 を閉じ手動運用を恒久化 ／ 可逆性: いつでも再開可能
  - 回答: **保留**（2026-07-12 人間回答・チャットで受領。推奨どおり再確認日 2026-08-01）

### 決着履歴

- 2026-07-12 **P-6 決着（2モデル委任判断）**: 人間の委任により Claude×Codex の合議で決定。候補1=条件付き承認（Codex が「30秒 callback が可変 state.roomRef を読むため、30秒以内の新ルーム作成を誤削除しうる」というより深刻な問題を発見。旧 ref・ラウンド世代の固定/再戦時無効化/ホスト限定削除/リロード後再予約/削除失敗 fallback を受入条件に B-16 起票、パイロット1本→直列展開）、候補3=条件付き承認（B-17、B-16 の iisen-show と直列化）、候補4=条件付き承認（B-18、正常削除と予期しない消滅の識別を条件）、**候補2=却下**（ito の result 復帰・再戦の意図仕様と30秒削除が衝突）
- 2026-07-12 **P-7 決着（2モデル委任判断）**: 人間の委任により Claude×Codex の合議で決定。**①は現設計を却下**（authReady は一度 reject すると永久に reject 済みの Promise のため「もういちどためしてね」は再試行しても直らない誤案内。Codex 指摘）→ 再設計版（狭い catch＋再読み込み導線文言＋二重押下ロック＋通信遮断テスト）を B-20 として起票。②=条件付き承認（B-19、完全同等確認と①からの分離を条件）

- 2026-07-12 **P-5 却下（drafts 削除）**: プロトタイプ「ものがたりダイス」はオーナー実機確認で「使いづらい」と判断。制度どおり drafts/monogatari-dice/ を削除しクローズ（人間回答はチャットで受領。B-15 の実装・監査記録は履歴として残置、復元は git 履歴から可能）
- 2026-07-12 **P-2 承認（現状維持）**: C-1 第1回の軽微メモ4件（nd10 麻績村ほか）は修正しない。以後の C-1 でも「誤りではなく表現の精密さ」レベルは起票しない（人間回答はチャットで受領）
- 2026-07-12 **P-3 承認（仕様）**: kotoba-asobo u1s02 / u5s33 のクールダウン質問一致は定番質問として許容。クローズ
- 2026-07-12 **P-4 承認（まとめて事後確認）**: B-1〜B-13 の体験レビューは次回実機セッションでまとめて確認。気づいた点だけバックログへ起票する

## Tier A: 自律修正 OK

- [x] A-1. `apps/nitaku-board/index.html` の `dayCheckInterval`（setInterval）に `clearInterval` を追加（lint [REF-5] の WARN 対応。pagehide で解放。2026-07-10 完了、6749b7f）
- [x] A-2. 旧トップレベル `shared/` の削除（参照ゼロ再確認済み: `../shared/` は全て apps/shared を指す相対参照、firebase.json 参照なし。2026-07-10 完了、a883cf1）
- [x] A-3. `apps/value-card/index.html` の `sortablejs@latest` を 1.15.7 に固定＋SRI 付与（2026-07-10 完了）
- [x] A-4. **共有 `rtdb-utils.js` のキャッシュ版数一斉更新**（提案6昇格・2026-07-11 人間承認）。B-7/B-8/B-9 で共有ファイルに追記が重なったが各アプリは `?v=20260710` 固定読み込みのため、キャッシュ保持中の再訪ユーザーに最新版（showToast の aria 等）が届かない。全14アプリの `rtdb-utils.js?v=20260710` を `?v=20260711` へ機械置換（挙動不変・apps/shared 自体は不変で apps/*/index.html の query のみ変更）。2026-07-11 完了、309dbe8。AI確認: ito で通常ロード経路の RoomkRTDB.showToast が role="status"/aria-live="polite" 付きトースト生成（B-9時のキャッシュ旧版=role:null を解消）、jinro でも ?v=20260711・RoomkRTDB 完備、lint パス・両アプリともコンソールエラーなし。対象: koedake-theater / name-change / magire-eshi / ito / jinro / kakure-number / uso-jisho / ikutsu-ieru / word-wolf / iisen-show / tatoe-gp / hint-de-pinto / pittari-meter / nitaku-board

- [x] A-5. `apps/value-card/index.html` の html2canvas 1.4.1（cdnjs 読み込み・12行目）に SRI `integrity` + `crossorigin="anonymous"` を付与（A-3 の対応漏れ。2026-07-11 クロスレビュー両承認で起票、経緯は `docs/reports/cross-review-2026-07-11.md`。条件: ハッシュは自己算出と cdnjs 掲載値の2経路で照合し、ページ表示だけでなく画像保存機能の動作までAI確認。2026-07-12 完了、a921856。AI確認: sha512 を openssl 自己算出と cdnjs API（/libraries/html2canvas/1.4.1?fields=sri）の2経路で照合し一致、ローカルサーバ上で SRI 付きの html2canvas が関数として読み込まれ（不一致ならブロックされる）、保存機能と同一経路（html2canvas→toDataURL）で 800x216 の有効な PNG data URL 生成を実測、コンソールエラーなし、lint パス）
- [x] A-6. `docs/reports/README.md` 索引の新設＋レポート追加時の更新ルール明記（2026-07-11 クロスレビュー両承認で起票。条件: 索引は正本（backlog・各レポート）へのリンク集に徹し、状態や結論の写しを持たない=第二の正本にしない。2026-07-12 完了、a02fb30。AI確認: 既存5報告書すべてを1行=「何の調査か＋対象項目＋日付」形式で掲載、結論・件数・判定の写しなし、リンク先6件（報告書5＋backlog）の実在を機械確認、追加・削除・改名時に同一コミットで索引を更新するルールを README 冒頭に明記、lint パス）
- [x] A-7. quiz 重複2件（D-4: 「情けは人の為ならず」2パック重複 / 雑学キング2 の答え「中国語」×2）の代替問題候補を `docs/content-candidates/` に生成（2026-07-11 クロスレビュー両承認で起票。条件: まず重複が実害か（パック間重複が意図的でないか）を再検証してから候補作成。各候補に独立した出典2件＋参照日、正答の一意性・年齢適合の自己検査、冒頭に「未承認・自動投入禁止」を明記。本体投入は D-4 のまま。**B+シャドー判定の記録対象**。2026-07-12 完了、337f9f7。成果物: `docs/content-candidates/quiz-duplicate-replacements.md`。実害を再検証のうえ kbn03→「五十歩百歩」・zk211→「アルファベット26種類」を採用推奨（各候補に出典2件＋参照日2026-07-12・自己検査つき）。**B+シャドー判定: Claude=承認、Codex=承認（条件付き）、意見割れ実質なし**。Codex の条件確認で候補A「河童の川流れ」が同義既存問題（猿も木から落ちる×2）と衝突すると判明し不採用＝2モデル判定が見落としを補完した初事例。付随発見: 「猿も木から落ちる」のパック間重複（L2538/L3515・C-4 未掲載）→ D-4 への追加は人間判断。content-audit パス（候補は docs のみで新規重複なし））
- [x] A-8. `scripts/draft-lint.sh` の新設（drafts/ プロトタイプ制度用の最小検査。2026-07-11 提案9承認に伴い起票。検査内容: `drafts/*/` を対象に ①innerHTML+${} の esc なし検出（lint.sh SEC-1 と同型） ②firebase SDK・fetch・XMLHttpRequest・WebSocket・外部スクリプト読み込みの検出（fonts.googleapis.com / fonts.gstatic.com のみ許可） ③絵文字検出。既存 lint.sh には手を入れず独立スクリプトとする。検証: 意図的な違反サンプルでの fixture 確認。2026-07-12 完了、f249df6。AI確認: 違反 fixture で全10種の検出発火（XSS 1・fetch/XHR/WebSocket/sendBeacon/EventSource/Firebase/非許可URL×2 計8・絵文字1）、Google Fonts 3行は素通り、クリーン fixture で exit 0、記号絵文字⭕は WARN のみで exit 0、drafts/ 不在時は対象0件で exit 0、既存 lint.sh もパス継続。検査対象は html/js/css（同梱の監査表 .md は対象外）、EventSource/sendBeacon は制度趣旨（外部通信禁止）に基づき同枠で追加）

- [x] A-9. `scripts/lint.sh` の SEC-1 を複数行 innerHTML テンプレートの連結式検出に拡張（2026-07-13・監査プロンプト集 P1-1 起票。`docs/reports/audit-run-2026-07-13.md`）。行単位 grep が届かない複数行 `.innerHTML` テンプレ内で「文字列リテラル + 変数」を未エスケープで注入する形（`${'<b>'+name}`）を python3 構文解析で ERROR 検出。**部分完了**: 裸変数 `${var}` の多行検出は esc 済み HTML を保持するケースで偽陽性化するため見送り（要 dataflow・A-11 として残課題）。2026-07-13 完了、bb006d5。AI確認: unsafe/safe/esc済み fixture で連結式のみ ERROR・現行 apps 偽陽性ゼロ・lint EXIT=0、Codex 差分レビューで「連結式のみ機械保証・完了扱いにしない」を確認。
- [x] A-10. `scripts/content-audit.mjs` に未対応12アプリ（jitsuwa-game/iisen-show/ishin-denshin/word-wolf/ito/magire-eshi/ikutsu-ieru/pittari-meter/uso-jisho/value-card/koedake-theater/kyoumi-sugoroku）の抽出とカバレッジ台帳を追加（2026-07-13・監査プロンプト集 P3-1 起票）。entries 3032→4147。variant/pairIndex 保持で真の重複(same-variant)と要人間確認(cross-variant)を分離、koedake の situation は統制語彙として除外、covered だが抽出0件の drift 検出を追加。アプリのコンテンツは無改変。2026-07-13 完了、907d24e。AI確認: 全43アプリ被覆・coveredButEmpty=[]・node --check/EXIT=0、Codex 差分レビュー合格。副産物: word-wolf「うさぎ/公園」の cross-variant 一致2件を人間確認候補として surface（自動修正せず・別途 C）。
- [ ] A-11. SEC-1 の裸変数 `${var}`/`${obj.field}` の多行検出（A-9 の残課題）。esc 済み HTML を保持する裸変数と危険な裸変数を区別するには変数定義を追う簡易 dataflow が要り、単純パターンでは偽陽性ゼロを保てない。実装するなら「現行 apps 偽陽性ゼロ」を fixture 条件にする。`docs/reports/audit-run-2026-07-13.md` 参照。

## Tier B: AI動作確認後に反映可（人間の体験レビューは事後）

- [x] B-1. howto.js（あそびかたモーダル）導入: `ito` / `jinro` / `jitsuwa-game` / `tsuyomi-card` / `value-card` の 5 本（lint [HOWTO-1] の WARN 対応。文言はコンテンツガイドラインとの照合とAIブラウザ表示確認を行って反映し、人間の体験レビューは事後に受ける）
  - [x] ito（2026-07-10 完了、1786375。AI確認: PC/モバイルでFAB表示・モーダル開閉・コンソールエラーなし。文言は実ボタン名に準拠、体験レビュー待ち）
  - [x] jinro（2026-07-10 完了、aaa1661。既存の「遊び方・役職」FABとの衝突を避けて左下に配置。AI確認: モバイルで左右各48px・モーダル開閉・Firebase認証後のアプリ由来コンソールエラーなし、体験レビュー待ち）
  - [x] jitsuwa-game（2026-07-10 完了、e58bb58。AI確認: PC/モバイルでFAB表示・モーダル開閉・スクロール不要・アプリ由来コンソールエラーなし。文言は実ボタン名に準拠、体験レビュー待ち）
  - [x] tsuyomi-card（2026-07-10 完了、af727d3。内省ツールのためタイトルは「つかいかた」。AI確認: モバイルでFAB表示・モーダル開閉・スクロール不要・コンソールエラーなし、体験レビュー待ち）
  - [x] value-card（2026-07-10 完了、df66258。内省ツールのためタイトルは「つかいかた」。AI確認: モバイルでFAB表示・モーダル開閉・スクロール不要・コンソールエラーなし、体験レビュー待ち）
- [x] B-2. `apps/hint-de-pinto/index.html:401` の ⭕❌ ボタンを Material Symbols（check_circle / cancel）に置換（lint [CONTENT-1] の WARN 対応。2026-07-10 完了、0c5d609。AI確認: PC/モバイルで判定画面のアイコン描画・フォント適用・ボタン収まりを確認、コンソールエラーなし）
- [x] B-3. ~~`apps/bulletin-board/index.html` の `maximum-scale=1` を除去~~（2026-07-10 アプリごと削除により解消）
- [x] B-4. ポータル `apps/index.html` のシーンチップに `min-height: 44px`（2026-07-10 完了、d029491。AI確認: PC/モバイルで実測44px・折り返し崩れなし・フィルタ動作正常・コンソールエラーなし）
- [x] B-5. ポータル `apps/index.html` にフィルタ結果ゼロ時の空状態表示を追加（2026-07-10 完了、0ec818d。「すべてのツールを見る」導線つき。AI確認: 0件状態を擬似再現し、全件表示・URLハッシュ解除・フォーカス復帰・コンソールエラーなし）
- [x] B-6. ブレークポイント統一: `apps/shared/css/design-system.css` のモバイル基準を AGENTS.md と同じ **600px** に統一（2026-07-10 完了、143d1b6。AI確認: 600pxでモバイル用、601pxで通常のフォント・ボタン余白へ切り替わり、表示崩れ・アプリ由来コンソールエラーなし）
- [x] B-7. `esc()` の共有化: `rtdb-utils.js` に `RoomkRTDB.esc` を追加し、12 アプリの重複定義を共有エイリアスへ移行（2026-07-10 完了、5a24fb1。AI確認: 全12アプリでTOP起動、共有APIとエイリアスの5文字エスケープ一致、アプリ由来コンソールエラーなし）
- [x] B-8. Firebase 初期化ヘルパーの共有化: `rtdb-utils.js` に `RoomkRTDB.initFirebase(firebase)` を追加し、段階移行する（2026-07-11 全アプリ移行完了。インライン firebaseConfig は全廃）
  - [x] 試行: `word-wolf` / `iisen-show` の2アプリ（2026-07-10 完了、5a24fb1。AI確認: 匿名認証・ルーム作成・sessionStorage再接続・テストルーム削除・コンソールエラーなし）
  - [x] 残りアプリへの横展開（インライン firebaseConfig 残存の実測は11本: ikutsu-ieru / hint-de-pinto / kakure-number / jinro / ito / koedake-theater / magire-eshi / nitaku-board / tatoe-gp / pittari-meter / uso-jisho。2026-07-11 全11本完了）
    - [x] ito（2026-07-10 完了、6b066f7。AI確認: 匿名認証・ルーム作成のRTDB同期・リロード再接続・退出でルーム削除・コンソールエラーなし）
    - [x] jinro（2026-07-11 完了、724083a。AI確認: 匿名認証・ルーム作成のRTDB同期・リロード再接続（ホスト復帰）・退出でルーム削除・コンソールエラーなし）
    - [x] hint-de-pinto（2026-07-11 完了、ec3d2a4。AI確認: 匿名認証・ルーム作成のRTDB同期・リロード再接続・退出でルーム削除・コンソールエラーなし）
    - [x] nitaku-board（2026-07-11 完了、5d2f092。AI確認: 匿名認証await後の起動・当日キー解決・日付チェックタイマー起動・votes への書き込みと削除の同期・リロード後再起動・コンソールエラーなし。テストスタンプは即時削除済み。※auth失敗時の挙動が warn握りつぶし→throw に変わるが、起動時awaitのため実質同等）
    - [x] ikutsu-ieru（2026-07-11 完了、dca3e26。AI確認: 匿名認証・ルーム作成のRTDB同期・リロード再接続・退出でルーム削除・コンソールエラーなし）
    - [x] tatoe-gp（2026-07-11 完了、0d43c5f。AI確認: 匿名認証・ルーム作成のRTDB同期・リロード再接続・退出・コンソールエラーなし。※rtdb-utils.js を ?v= なしで読み込む唯一のアプリで、キャッシュ旧版に initFirebase が無く起動不能になる事象を実機確認 → ?v=20260710 を付与して解消。他アプリは全て ?v= 付与済みを横断確認。テストルームは手動削除済み）
    - [x] uso-jisho（2026-07-11 完了、ce6a351。AI確認: 匿名認証・ルーム作成のRTDB同期・リロード再接続（ホスト待機画面へ復帰）・退出・コンソールエラーなし。退出はローカル片付けのみのTTL掃除設計、テストルームは手動削除済み）
    - [x] pittari-meter（2026-07-11 完了、e3641d6。AI確認: 匿名認証・ルーム作成のRTDB同期・リロード再接続（ホスト待機画面へ復帰）・退出・コンソールエラーなし。退出はローカル片付けのみのTTL掃除設計、テストルームは手動削除済み）
    - [x] magire-eshi（2026-07-11 完了、505fd4a。AI確認: 匿名認証・ルーム作成のRTDB同期・リロード再接続・退出でルーム削除・コンソールエラーなし）
    - [x] koedake-theater（2026-07-11 完了、015b1c6。AI確認: 匿名認証・ルーム作成のRTDB同期・リロード再接続・退出でルーム削除・コンソールエラーなし）
    - [x] kakure-number（2026-07-11 完了、753569e。AI確認: 匿名認証・ルーム作成のRTDB同期・リロード再接続（ホスト待機画面へ復帰）・退出・コンソールエラーなし。※このアプリの退出はローカル片付けのみでルームはTTL掃除に任せる既存設計。テストルームは手動削除済み）
- [x] B-9. `rtdb-utils.js` の showToast に `role="status"` + `aria-live="polite"` を追加（提案1昇格。後方互換の属性追加のみ。apps/shared 配下の変更は 2026-07-11 に人間が本項目の昇格をもって許可済み。2026-07-11 完了。AI確認: ディスクの最新コードを ito 上で評価し、生成トーストに role="status" / aria-live="polite" が付与され従来通り表示（成功色・fixed bottom24px）されることを実測、実画面キャプチャで確認、lint パス・コンソールエラーなし。**申し送り**: 各アプリは `rtdb-utils.js?v=20260710` 固定で読み込むため、キャッシュ保持中の再訪ユーザーには ?v= 昇格まで属性が届かない。プログレッシブエンハンスメントで機能後退はなし。?v= 一斉更新は全アプリ横断の別関心事のため未実施＝提案欄に記載）
- [x] B-10. 装飾アイコン（material-symbols）への `aria-hidden="true"` 付与＋アイコン単独ボタンへの `aria-label`（提案2昇格。1アプリ×1コミットで段階的に、各アプリでブラウザ表示確認。詳細は `docs/reports/c2-aria-role-candidates.md`）。2026-07-11 対象13アプリ全て完了（checkin/voteはスタブ除外）。方針: 装飾アイコンは aria-hidden、意味を持つ状態アイコン（正誤・記入状況等）は role="img"＋aria-label で保持、アイコン単独ボタンは button 側 aria-label＋内側 aria-hidden。各アプリでキャッシュ考慮のうえライブDOM素のアイコン0件・lint・コンソールを確認。slides.html（発表デッキ）は全て対象外。個別コミットは下記サブ項目参照
  - 対象順: codenames→hint-de-pinto→iisen-show→ishin-denshin→ito→koedake-theater→magire-eshi→minna-ranking→name-change→tatoe-gp→uso-jisho→value-card→word-wolf
  - [x] codenames（2026-07-11 完了。装飾アイコン4件に aria-hidden、開始条件チェックの状態アイコンは role="img"＋aria-label（達成/未達成）で意味を保持。※既存の aria は良好=盤面/ターン/ダイアログ等9件。AI確認: ランディングで header/add_circle/login の aria-hidden 実描画、配信 app.js に全5編集・素のアイコン0件、モジュール完全実行でパースエラーなし、コンソールエラーなし、見た目不変）
  - [x] hint-de-pinto（2026-07-11 完了。index.html の描画アイコン19件を処理: 装飾16件に aria-hidden、結果/履歴の正誤アイコン2件は role="img"＋aria-label（正解/不正解）、ヒント除外トグルはアイコン単独ボタンのため button に aria-label＋アイコンに aria-hidden。AI確認: ライブDOMで素のアイコン0件・topのlightbulb/add_circle/login が aria-hidden、lint パス、コンソールエラーなし、見た目不変。※slides.html（発表デッキ）は対象外）
  - [x] iisen-show（2026-07-11 完了。描画アイコン11件すべて装飾（テキスト併記＝結果バッジ「いいセン！/アウト！」含む）のため aria-hidden。既存の aria-label（問題選択ボタン）は良好で据え置き。AI確認: ライブDOMで素のアイコン0件・top画面 aria-hidden 実描画、lint パス、コンソールエラーなし、見た目不変。※slides.html は対象外）
  - [x] ishin-denshin（2026-07-11 完了。index.html 9件＋app.js 2件の描画アイコンすべて装飾のため aria-hidden。※flag バッジは round 開始時に textContent で「ラウンドN/M」へ置換される装飾。既存の aria-label（お題カード）は据え置き。AI確認: ライブDOM 11件すべて aria-hidden・素のアイコン0件、lint パス、コンソールエラーなし、見た目不変）
  - [x] ito（2026-07-11 完了。描画アイコン29件すべて装飾（アイコン単独ボタン・意味アイコンなし）のため一括 aria-hidden。CSSセレクタ3件は対象外。AI確認: ブラウザキャッシュ旧版検出→キャッシュバスターで再読込し 0件確認、ライブDOM素のアイコン0件、lint パス、コンソールエラーなし、見た目不変。※slides.html は対象外）
  - [x] koedake-theater（2026-07-11 完了。描画アイコン23件のうち装飾22件に aria-hidden、けっか画面の正解マーク（hit時の check_circle・1237行）は role="img"＋aria-label="正解" で意味を保持。CSSセレクタ3件は対象外。AI確認: キャッシュバスター再読込でライブDOM素のアイコン0件、lint パス、コンソールエラーなし、見た目不変。※slides.html は対象外）
  - [x] magire-eshi（2026-07-11 完了。描画アイコン28件すべて装飾（check_circle系は隣接テキストで正誤を伝達・投票ボタンの矢印はニックネームがアクセシブル名のため装飾）のため一括 aria-hidden。CSSセレクタ2件は対象外。AI確認: キャッシュバスター再読込でライブDOM素のアイコン0件、lint パス、コンソールエラーなし、見た目不変。※slides.html は対象外）
  - [x] minna-ranking（2026-07-11 完了。index.html 8件＋app.js 5件の描画アイコンに aria-hidden（上下移動ボタンは既に button 側 aria-label 付き＝内側アイコンのみ hidden、drag_indicator は既存 aria-hidden）。既存の aria-label（お題ボタン・タイ/もどす等）は据え置き。AI確認: app.js は module のため ?cb 動的 import で最新化し、TOP＋ランキング一覧の両画面でライブDOM素のアイコン0件・移動ボタンは button aria-label＋icon aria-hidden、lint パス、コンソールエラーなし、見た目不変）
  - [x] name-change（2026-07-11 完了。描画アイコン22件すべて装飾（選択カードのedit/how_to_voteはlabel/desc併記、結果の矢印は名前対応を示す視覚コネクタ）のため aria-hidden。3系統のclass（素／choice-icon付／result-arrow付）を網羅。CSSセレクタ2件は対象外。AI確認: キャッシュバスター再読込でライブDOM素のアイコン0件、lint パス、コンソールエラーなし、見た目不変。※slides.html は対象外）
  - [x] tatoe-gp（2026-07-11 完了。描画アイコン10件すべて装飾（送信済み/投票済みの check_circle・how_to_vote は隣接テキスト併記）のため一括 aria-hidden。CSSセレクタ2件は対象外。既存の aria-label（問題選択ボタン）は据え置き。AI確認: キャッシュバスター再読込でライブDOM素のアイコン0件、lint パス、コンソールエラーなし、見た目不変。※slides.html は対象外）
  - [x] uso-jisho（2026-07-11 完了。描画アイコン11件のうち装飾10件に aria-hidden、記入状況チップの動的アイコン（check_circle/edit・1457行）は role="img"＋aria-label（記入ずみ/記入中）で状態を保持。CSSセレクタ3件は対象外。既存の aria-label（意味選択カード）は据え置き。AI確認: キャッシュバスター再読込でライブDOM素のアイコン0件、lint パス、コンソールエラーなし、見た目不変。※slides.html は対象外）
  - [x] value-card（2026-07-11 完了。index.html 3件＋app.js 2件の描画アイコンに aria-hidden。上下移動ボタンは既に button 側 aria-label 付き＝内側アイコンのみ hidden。※ドラッグ並べ替えのキーボード代替は候補5（Tier D・要設計）でB-10の範囲外。AI確認: TOP＋順番決めフェーズの両画面でライブDOM素のアイコン0件・移動ボタンは button aria-label＋icon aria-hidden、lint パス、コンソールエラーなし、見た目不変）
  - [x] word-wolf（2026-07-11 完了。描画アイコン18件すべて装飾（お題チップ・状態メッセージは隣接テキスト併記、投票ボタンの矢印はニックネームがアクセシブル名）のため一括 aria-hidden。CSSセレクタ1件は対象外。AI確認: キャッシュバスター再読込でライブDOM素のアイコン0件、lint パス、コンソールエラーなし、見た目不変。※slides.html は対象外）
- [x] B-11. jinro の低コントラスト3箇所の修正（提案3昇格。`.night-waiting` #64748b→#94a3b8 / `.phase-badge.morning` 背景 #d97706→#b45309 / ハンター `.section-lbl` の accent 文字色を #26697A にインライン上書き。共通トークン --color-accent 自体は不変。2026-07-11 完了。AI確認: 実描画の computed style で 3.22→5.97 / 3.19→5.02 / 4.42→5.78 と全て 4.5:1 超を実測、実画面キャプチャで可読性確認、lint パス・コンソールエラーなし）
- [x] B-12. kotoba-asobo セッション u1s05 の w1=q1 完全一致の解消（提案4昇格・一部。w1とq1は問題文だけ同一で語群・答え・解説は別物だった＝問題文のコピペ。ウォームアップw1は汎用文のまま残し、本編q1を「この4つのことばで、反対どうしのペアを組み合わせるなら?」に差分化（同セッションq4の『…組み合わせで、反対どうしになるペアはどれ?』に倣う）。2026-07-11 完了。AI確認: lint・content-audit パス（w1↔q1の類似ペア消失・汎用文の残存は1件のみ）、アプリの registerSession で正しくパース、KotobaAsoboRender.rubyText で新問題文が正しくルビ描画、コンソールエラーなし。子ども向け文言のため体験レビューは事後）
- [x] B-13. 難読地名クイズ2問の解説修正（提案5昇格。nd16 匝瑳市=由来の因果を市公式準拠に、nd18 東雲=「たなびく雲」→「夜明けの空」。修正案と出典は `docs/reports/c1-nandoku-verification-batch1.md` に用意済み。2026-07-11 完了。AI確認: lint・content-audit ともにパス（新規重複なし）、ブラウザで questions.js が新解説文を配信・旧文言は消失・全24パックがパック選択画面に描画（＝構文エラーなし）・コンソールエラーなし。体験レビューは事後）

- [x] B-14. ニックネーム・ルームコード等の入力欄に `label for` / `input id` の紐付け（1アプリ×1コミット系列。2026-07-11 クロスレビュー両承認で起票、経緯は `docs/reports/cross-review-2026-07-11.md`。条件: 着手前に内包 label / `aria-labelledby` 込みで各アプリの実状を再実測してから対象を確定（「紐付け0アプリ」は grep 測定のため）。placeholder を label 扱いしない・原則可視ラベル・ID はページ内一意・600px 以下の表示確認込み。**2026-07-12 全20アプリ完了**。方針: 可視ラベル既存＝for 付与（大半）、見出しテキスト既存＝p/div→label 化（display:block 実測維持）、可視ラベル非設計（JSテンプレート・選択カード・隠し file input・placeholder 型）＝aria-label。全アプリで el.labels または aria-label の解決・横あふれなし・ID 一意・コンソールエラーなしを確認。個別コミットは下記サブ項目参照。体験レビューは事後）
  - 再実測（2026-07-12）: 未紐付けは20アプリ・約64箇所。多くは可視ラベル既存で for 欠落のみ。※challenge-tane / sakusen-kaigi / sukina-map の recordFile は非表示 file input の可能性＝着手時に個別判断、jinro の `${selectId}` は動的生成＝JS 側で対応
  - [x] word-wolf（2026-07-12 完了、a4a21f6。既存可視ラベル5箇所に for 付与のみ。AI確認: 全5箇所で el.labels 解決・ラベルクリックでフォーカス移動・375px 横あふれなし・コンソールエラーなし・見た目不変・ID 重複なし）
  - [x] hint-de-pinto（2026-07-12 完了、293ea36。for 付与5箇所。AI確認: 全箇所 el.labels 解決・横あふれなし・ID 重複なし）
  - [x] iisen-show（2026-07-12 完了、e56db96。for 付与4箇所。AI確認: 同上）
  - [x] ikutsu-ieru（2026-07-12 完了、23f33a1。for 付与5箇所＋回答欄 aria-label 1箇所。お題見出しは p→label 化し display:block でレイアウト維持を実測（margin 8px 保持）。AI確認: el.labels 解決・横あふれなし・コンソールエラーなし・ID 重複なし）
  - [x] ito（2026-07-12 完了、e0cf089。for 付与4箇所。AI確認: el.labels 解決・横あふれなし・ID 重複なし）
  - [x] kakure-number（2026-07-12 完了、e3cd144。for 付与3箇所＋よそう見出しの div→label 化（display:block 実測）。AI確認: 同上）
  - [x] koedake-theater（2026-07-12 完了、6c0e396。for 付与3箇所。AI確認: 同上）
  - [x] jinro（2026-07-12 完了、d9aef36。静的4箇所 for 付与＋夜行動の動的 select 2種は aria-label。AI確認: el.labels 解決・横あふれなし・ID 重複なし）
  - [x] magire-eshi（2026-07-12 完了、b0beaf4。for 付与3箇所＋JSテンプレート内よそう入力は aria-label。AI確認: 同上）
  - [x] name-change（2026-07-12 完了、ad018ab。for 付与3箇所＋変更後の名前入力は aria-label。AI確認: 同上）
  - [x] pittari-meter（2026-07-12 完了、3bb0726。for 付与4箇所。AI確認: el.labels 解決・横あふれなし・ID 重複なし）
  - [x] tatoe-gp（2026-07-12 完了、2b1ecd6。for 付与4箇所。AI確認: label[for] 全解決・ID 重複なし）
  - [x] uso-jisho（2026-07-12 完了、e496d2b。for 付与4箇所。AI確認: 同上）
  - [x] kotoba-asobo（2026-07-12 完了、a42640b。チャット用コピー textarea に aria-label）
  - [x] kyapa-graph（2026-07-12 完了、a65d721。タグ追加入力に aria-label）
  - [x] mienai-ganbari（2026-07-12 完了、28b923b。カスタム追加入力に aria-label）
  - [x] minna-ranking（2026-07-12 完了、9b30dbf。アイテム追加入力に aria-label）
  - [x] sukina-map / sakusen-kaigi / challenge-tane（2026-07-12 完了、e671909 / 64435ee / dc85e92。recordFile は「ボタンから開く隠し file input」パターンと確認のうえ aria-label「記録ファイル（JSON）を選ぶ」を付与）
- [x] B-15. 新規アプリ第1弾プロトタイプ「ものがたりダイス」を `drafts/monogatari-dice/` に作成（2026-07-11 提案10承認。drafts/ プロトタイプ制度の条件に全面的に従う。A-8（draft-lint）完了が前提。設計: 「どこで/だれが/なにを」の3ダイスを Material Symbols アイコン＋文字ラベルで表示、ボタンで振る・振り直し・パス自由、入力ゼロ・オフライン・永続化ゼロ。条件（Codex 指摘反映）: お題語彙の組み合わせ全件をコンテンツガイドラインで安全監査した表を同ディレクトリに同梱、アイコンに代替テキスト、prefers-reduced-motion でアニメ停止。完了条件: draft-lint パス＋AIブラウザ動作確認。**apps/ への移植・ポータル掲載は別途 Tier D ゲート**。2026-07-12 完了、0a83add。AI確認: draft-lint パス（外部通信なし・XSSなし・絵文字なし）、各軸8語彙×3＝全512組み合わせの安全監査表を同梱（学校・暴力・恐怖・評価語彙を排除する基準6項目つき）、ローカルHTTPサーバでPC/モバイル両表示・まとめて振る/1個ずつ振り直しの動作・結果文の合成を実測、Material Symbols 全25アイコンのリガチャ解決を機械確認（未解決0件）、ダイスは role=img＋aria-label・装飾アイコン aria-hidden・結果文 aria-live=polite、reduced-motion は CSS/JS 両ゲートをコード確認、コンソールエラーなし。体験レビューと apps/ 移植判断（Tier D）は人間へ）

- [x] B-16. **終了後30秒削除タイマーの競合修正**（P-6 決着 2026-07-12・候補1昇格。対象6アプリ: iisen-show / name-change / pittari-meter / kakure-number / uso-jisho / tatoe-gp。受入条件（Codex 設計レビュー反映）: ①終了時点の旧 roomRef とラウンド世代を callback に固定（可変 state.roomRef を読まない＝30秒以内の新ルーム誤削除を防ぐ） ②同一ルーム再戦時は status を戻す前にタイマー解除＋世代無効化 ③ルーム全体の即時削除はホストの明示退出だけ・ゲストは自 player のみ ④DONE 画面リロード復帰を許すアプリは finishedAt/deleteAt 保存＋再接続時再予約 ⑤remove 失敗時の fallback（TTL 経路の温存）。**まず1アプリをパイロット**とし、検証5項目（終了直後TOP→新ルーム作成で旧のみ削除/30秒以内再戦が消えない/DONEリロード後も期限どおり削除/ゲスト退出で自分だけ消える/削除失敗後にTTL経路が残る）を通してから直列展開。1アプリ×1コミット）
  - [x] パイロット: uso-jisho（2026-07-12 完了、a197984。scheduleDoneCleanup（旧ref＋deleteAt固定・transaction で status=DONE かつ deleteAt 一致を確認して削除）＋tryReconnect 再予約。AI確認: 検証1=実RTDBで旧ルームのみ削除・新ルーム無傷を実測 / 検証2=同一ルーム再戦フローなし（tx照合で同コード再作成も保護）/ 検証3=DONEリロード→再予約→期限どおり削除を実測 / 検証4・5=コード確認（ゲスト退出・TTL経路とも不変）/ コンソールエラーなし・lint パス。テストルームは期限削除済み）
  - [x] tatoe-gp（2026-07-12 完了、6edd052。パイロットと同形。AI確認: 実RTDBで検証1=旧のみ削除・新無傷、検証3=FINISHEDリロード→再予約→期限どおり削除を実測、コンソールエラーなし・lint パス。テストルームは期限削除済み）
  - [x] kakure-number（2026-07-12 完了、12b5ad1。同形＋hostFinish を update→transaction 化（二重終了ガード）。AI確認: 実RTDBで検証1・検証3とも実測パス、コンソールエラーなし・lint パス。テストルームは期限削除済み）
  - [x] pittari-meter（2026-07-12 完了、01301ed。同形＋hostFinish を update→transaction 化。AI確認: 実RTDBで検証1・検証3とも実測パス、コンソールエラーなし・lint パス。テストルームは期限削除済み）
  - [x] name-change（2026-07-12 完了、b6936f0。同形。旧実装は null 参照例外になり得た唯一のアプリ。AI確認: 実RTDBで検証1・検証3とも実測パス、コンソールエラーなし・lint パス。テストルームは期限削除済み）
  - [x] iisen-show（2026-07-12 完了、fce3193。B-17 と統合。AI確認: 実RTDBで検証1（ゲスト入りの旧ルームのみ削除・新無傷）・検証3（リロード再予約→期限削除）を実測、コンソールエラーなし・lint パス。**B-16 全6アプリ完了**）
- [x] B-17. iisen-show のゲスト退出時 player 削除＋goToTop のタイマー解除対称化（P-6 決着・候補3昇格。条件: B-16 の iisen-show 対応と**直列化または統合**（同じライフサイクル部分を触るため並列コミット禁止）。listener・タイマー・onDisconnect の解除順序を固定。2026-07-12 完了、fce3193=B-16 と統合コミット。leaveGame は「タイマー解除→ゲスト自 player 削除→ローカル片付け」の順で固定、goToTop に _hostDisconnectTimer 解除を追加して対称化。AI確認: 実RTDBでゲスト leaveGame 後に自分のみ削除・ルームとホスト残存・タイマー null 化を実測）
- [x] B-18. word-wolf の `!snap.exists()` ホスト分岐の復帰処理（P-6 決着・候補4昇格。条件: ゲスト分岐の単純流用は禁止。正常な自己削除（30秒削除・自分の remove）と予期しない消滅を `expectedRoomRemoval` 等のフラグで識別し、後者のみ remote remove なしの専用ローカル片付けで TOP 復帰させる。2026-07-12 完了、1206217。AI確認: 実RTDBで両経路を実測 — 正常削除（leaveGame）は無言で TOP・ルーム削除、外部からの remove ではローカル片付けのみで TOP 復帰・state/セッション解放・remote 書き込みなし。コンソールエラーなし・lint パス）
- [x] B-19. name-change を `RoomkRTDB.initFirebase` へ移行（P-7 決着・②昇格。B-8 共有化の漏れ残件。条件: firebaseConfig 全フィールド・SDK 読込順・authReady の reject 挙動・後続識別子の完全同等を確認し、既存 initializeApp と明示 initServerTime を同時除去。B-20 とは別コミット。2026-07-12 完了、7315cd9。AI確認: フィールド照合で messagingSenderId/appId のみ別アプリ登録の値と判明（挙動関与なし・他は完全一致・共有版は13アプリ稼働実績）→コミットに明記のうえ移行。実RTDBで匿名認証・ルーム作成同期・リロード再接続（ホスト復帰）を実測、共有 appId での稼働・コンソールエラーなし・lint パス。テストルームは手動削除済み）
- [x] B-20. 未保護11アプリの作成/参加ボタンに認証失敗ハンドリングを追加（P-7 決着・①の再設計版。対象: hint-de-pinto / iisen-show / ikutsu-ieru / jinro / kakure-number / koedake-theater / magire-eshi / pittari-meter / tatoe-gp / uso-jisho / word-wolf。設計（Codex 指摘反映）: authReady は reject 済みで固定される Promise のため**再試行文言は使わない**。①catch は `await authReady` だけを狭く囲む（transaction まで含めると ACK 喪失を認証失敗と誤認し孤児ルームを作る） ②文言は「うまくつながらなかったよ。ページをよみこみなおしてね」＋既存エラー表示手段（showError/showMsg/toast） ③auth 待機前に二重押下ロック、失敗時に disabled/spinner/label/focus を全て復帰 ④検証は通常成功に加え、Auth 通信を遮断して「書込みゼロ→UI復帰→遮断解除→リロードで成功」を確認。apps/shared の ensureAuth() 化はより良い恒久策だが禁止パスのため本項目に含めない（必要なら別途個別承認へ）。1アプリ×1コミット）
  - [x] パイロット: word-wolf（2026-07-12 完了、36f430e。waitAuthOrExplain ヘルパー（狭い catch＋二重押下ロック）を hostCreateRoom/guestJoin に適用。AI確認: 一時的な reject 疑似再現（テスト用オーバーライドはコミット前に除去）で、トースト表示・ルーム未作成・ゲスト側も同様・画面操作可能のまま、を実測。正常経路の作成→同期→退出削除も実測。コンソールエラーなし・lint パス）
  - [x] toast型5本: hint-de-pinto / ikutsu-ieru / jinro / koedake-theater / magire-eshi（2026-07-12 完了、47f7413 / 8ddd24f / 071830d / b6fde14 / e65dc08。word-wolf と同形の waitAuthOrExplain＋showMsg。AI確認: 各アプリで #authfail 疑似再現によりトースト表示・ルーム未作成・画面操作可能を実測（テスト用オーバーライドは全て除去済み=grep確認）、jinro で正常経路の作成→同期→退出削除をスポット実測、コンソールエラーなし・lint パス）
  - [x] showError型5本: iisen-show / kakure-number / pittari-meter / tatoe-gp / uso-jisho（2026-07-12 完了、1dee26c / c7a24f5 / a0b21bd / feadfcf / 6fb9667。waitAuthOrExplain(errorId) 形式で host='host-nickname-error'・guest='guest-join-error'。AI確認: 各アプリで #authfail 疑似再現によりフォーム直下エラー表示・ルーム未作成を実測（uso-jisho は guest 側 errorId も確認）、テスト用オーバーライドは全除去を grep 確認、uso-jisho で正常経路スポット実測、コンソールエラーなし・lint パス。**B-20 全11アプリ完了**）

- [x] B-21. **onDisconnect().cancel() 不在＝ゴースト room 部分再生成の横断修正**（B2 follow-up・2026-07-15。監査発端: PR #6 の Codex 指摘「pittari-meter に `onDisconnect().cancel()` が無く `roomRef.off()` は予約済み onDisconnect を解除しない→削除後の実切断でゴースト room 再生成」を family 横断で棚卸し。**全13本**が host で `roomRef.onDisconnect().update({hostConnected:false,...})`（room パスへの書込型＝有害）を張り、リポジトリ全体で `.cancel()` は皆無と確定。jinro のみ guest も `players/{nick}/connected` に `set(false)`（書込型）。他12本の guest は `playerRef.remove()`（削除済み room の子削除＝no-op で無害）。修正: `apps/shared/js/rtdb-utils.js` に `RoomkRTDB.cancelRoomOnDisconnect(ref)`（接続単位・サブツリー全体を cancel）を追加し、全13本の teardown（goToTop / leaveGame / leaveCleanup / listener の room 消滅時 detach）で `off()`/`remove()` の前に呼ぶ。remove する経路は `await cancel` を remove の前に。helper 使用13本のみ `?v=20260711→20260715` bump。ブランチ `fix-ondisconnect-cancel-ghost-rooms`・**[PR #7](https://github.com/tagiiii/roomk-tools/pull/7) マージ済（2026-07-15・merge `8cadb41`）**。⚠️ **host/guest 実機 E2E 未実施のままオーナー判断で main マージ＝B1/B2 と同扱い**→次の実機セッションで runtime 確認必須（ゴースト空 room が残らないこと）・問題時は revert。検証: オフライン stub 9/9 pass（本番ゼロ書込）＋lint 全パス。二重レビュー: 独立=承認／Codex=teardown 経路は妥当だが残ベクトルを指摘→スコープを Option 1（teardown 緩和＋残り follow-up）にオーナー確定。**未カバー（follow-up）**: ①DONE/orphan 掃除タイマーが同一接続で room 削除→残った onDisconnect でゴースト（Codex #4・同バグクラス・別項目） ②cancel 失敗時に remove を止める strict 化（Codex #1・実質稀） ③`await` 後の可変 `state.roomRef` 再入ガード＋ref 退避（Codex #6） ④jinro room-null listener の off/detach 不足（Codex #7） ⑤ito の cancel→off→remove を cancel→remove→off へ（remove 失敗時の listener 温存・Codex #8） ⑥クロス接続ゴースト。**構造的完全修正**=「非 null room は status 必須」の validation rules（全ベクトルをサーバ側で拒否・要エミュレータ＝現環境に無し→firebase ツールのある環境/オーナー作業）。実機 E2E 手順: host＋guest でルーム→ゲーム終了 or 明示退出→片方がタブを閉じて再切断→数分後に `{hostConnected:false,...}` だけの空 room が DB に残らないことを確認。問題時は revert）
- [ ] B-22. **magire-eshi: 逆転回答待ちによる進行不能の解消**（2026-09-04 監査 P4-2 起票。報告書: `docs/reports/audit-run-2026-09-04-fable-5-1.md`）。まぎれ絵師が捕まった後に「答える」を押さない・タブを閉じると `reversalGuess`/`reversalJudge` が null のまま `finalPhase` が偽になり（`apps/magire-eshi/index.html:1514`）、ホストの「次のラウンドへ／終わる」が非表示（:1634）、`hostAbortRound` も result を対象外（:1079-1083）＝ルームが TTL まで凍結。修正案: result でもホストが「答えなしで終わる」を押せる分岐（hostAbortRound の対象に RESULT を追加、または reversalJudge を 'skip' で確定）。受入: stub で outcome=caught・reversalGuess=null のときホスト操作が表示される／通常の逆転回答経路は不変／lint 緑。深刻度 高・確信度 高・変更リスク 低〜中。1アプリ×1コミット
- [ ] B-23. **kaburazu-hint: ニックネームを埋め込む inline onclick の不具合**（2026-09-04 監査 P1-1 起票。報告書: `docs/reports/audit-run-2026-09-04-fable-5-1.md`）。ヒントレビューのトグルが `onclick="toggleHint('${encodedNick}')"`（`apps/kaburazu-hint/index.html:1162`）で、`encodeURIComponent` が `' ( )` を符号化しないためこれらを含む名前（validNick:683-687 は通す）で JS 構文エラー→無反応。修正案: 既にある `data-nick="${esc(nick)}"`（:1157）＋イベント委譲へ（koedake-theater:1123/1131 と同型）。対象は kaburazu-hint のみ（1アプリ×1関心事。toomawashi の同型は静的データのみで実害がないため含めない。将来の別候補として報告書に記載）。受入: stub（「ま'ち」「a)b(」）でトグルが動く／既存名の挙動不変／lint 緑。任意で lint に「on* 属性内で encodeURIComponent を使わない」検出（Tier A・別コミット）。深刻度 中・確信度 高・変更リスク 低
- [ ] B-24. **ゲーム中の同名再入室でホスト名を拒否する最小修正（5本）**（2026-09-04 監査 P2-4 の最小部分。報告書: `docs/reports/audit-run-2026-09-04-fable-5-1.md`。復帰手段そのものの是非は P-12）。「ゲーム中に同じニックネームで再入室＝復帰」分岐に `isHost` 判定がなく、参加者一覧に見えるホスト名で入ると role=guest のまま `players/{host}` に `onDisconnect().remove()` を張り、その端末の切断でホストのノードが消える（kakure-number:847-858 / do-mannaka:1093-1106 / tatoe-gp:1358-1370 / uso-jisho:1264-1280 / pittari-meter:1023-1036）。修正案: kotoba-pair:1774（`if (mine && mine.isHost) return;`）と同じ判定を5本に追加し、通常参加と同じ「そのニックネームはすでに使われています」で拒否。受入: stub でホスト名参加が弾かれる／ゲスト名の復帰経路は不変（P-12 の結論が出るまで現状維持）／lint 緑。1アプリ×1コミット。深刻度 中・確信度 高・変更リスク 低

## Tier C: 調査・報告のみ

- [ ] C-1. 難読地名・駅名 160 問の事実再検証（月 20 問ずつ 8 回で一巡: 市町村合併・駅名改称・由来を一次ソース 2 件で確認。結果は報告のみ。修正は人間が承認した別項目として扱い、判断待ちはループを止めない）
  - [x] 第1回 nandoku-chimei 20問（2026-07-11 完了。報告書: `docs/reports/c1-nandoku-verification-batch1.md`。OK 18・要注意 2（nd16 匝瑳の由来因果が逆・nd18 東雲の語義ズレ）。修正は未実施）
  - [ ] 第2回以降: north → kanto → kansai → station → kyushu → chushi → chubu（月次ローテ、次回 2026-08。**P-2 決着（2026-07-12）により、「誤りではなく表現の精密さ」レベルの軽微メモは報告書に記載するのみで判断待ちへは起票しない。**起票するのは事実誤認・陳腐化のみ）
- [x] C-2. aria/role ゼロのアプリ（checkin, vote, word-wolf, codenames, minna-ranking, ito, value-card ほか）の改善候補リスト作成（2026-07-11 完了。報告書: `docs/reports/c2-aria-role-candidates.md`。ゼロは15アプリ、候補6系統を優先順・想定Tier付きで整理。修正は未実施）
- [x] C-3. muted テキスト×小フォントのコントラスト実測（WCAG AA）レポート（2026-07-11 完了。報告書: `docs/reports/c3-contrast-report.md`。設計トークンの muted は 6.15:1/5.50:1 で合格、実測6ページ中不合格は jinro の独自配色3件のみ。修正は未実施）
- [x] C-4. `content-audit.mjs` の類似ペアレポートから「同一アプリ内の言い換え重複」を抽出して報告（2026-07-11 完了。報告書: `docs/reports/c4-duplicate-phrases.md`。実質的な入れ替え候補は quiz 2件＋kotoba-asobo 1件（u1s05 の w1=q1 は編集ミスの可能性）。食べ物系は同一アプリ内16/83・アプリ間完全一致10/136。修正は未実施）

- [x] C-5. RTDB 14アプリの掃除カバレッジ監査マトリクス（TTL・終了後削除・onDisconnect。2026-07-11 クロスレビュー両承認で起票、経緯は `docs/reports/cross-review-2026-07-11.md`。条件: 「論理的な期限切れ判定」と「Firebase 上の物理削除」を別列にし、役割（ホスト/ゲスト）×イベント（通常退出/ゲーム終了/再読込/通信断/復帰）で整理。onDisconnect の再登録・取消、サーバー時刻使用、タイマー片付けも対象。kakure-number / uso-jisho / pittari-meter の「退出=ローカル片付けのみ」設計が意図か漏れかを仕分ける。修正候補は Tier 案付きで報告のみ。2026-07-12 完了、11f2ab9。報告書: `docs/reports/c5-rtdb-cleanup-matrix.md`。読み取り専用エージェント4本で14アプリ＋rtdb-utils.js を精読。特記3アプリはいずれも意図的設計と仕分け（kakure-number はコメント明記）。横断の発見: 終了後30秒削除タイマーのナビゲーション競合が6アプリ（正常終了パスで孤児化）・ito の cleanupTimer 未配線・参加者ゼロ孤児ルームは全アプリ共通の設計許容。修正候補4件は Tier 案付き報告のみ＝未実施、昇格判断は P-6 に起票）
- [x] C-6. `database.rules.json` への `.validate` 追加案の調査（2026-07-11 クロスレビュー両承認で起票。条件: バイトサイズ上限でなく、型・文字列長・子ノード数・必須キー・status 値集合・所有権（他人のデータを書き換えられるか）を対象に。削除時の `.validate` 挙動と全書き込み経路を洗い、Firebase Emulator でのテスト手順案まで落とす。**適用は禁止パスのため Tier D**。2026-07-12 完了、a2b8672。報告書: `docs/reports/c6-rules-validate-proposal.md`。事実確認: .validate は削除時（newData=null）に評価されず C-5 の掃除設計と両立／全14アプリが auth.uid を未保存のため所有権ルールはアプリ側スキーマ変更が前提＝範囲外として記録。段階1（実在14名前空間の固定・既存影響ゼロ）→段階2（$roomId 形式・作成時必須キー・status 値集合・$nick 長）→段階3（子ノード数・所有権は見送り）の段階案＋Emulator テストマトリクスを提示。適用判断の起票は流入上限到達のため次回実行へ持ち越し）
- [x] C-7. 外部リソース（CDN・フォント等）の棚卸しと SRI 必須 lint（DEP-2）の設計（2026-07-11 クロスレビューで「即 lint 追加」は却下→棚卸し先行に縮小。条件: 全外部リソースを列挙し、SRI を必須にできるもの（固定版の外部JS）とできないもの（Google Fonts 等の応答変動）を仕分け。誤検知パターン（属性の順序・改行）の fixture 検証と警告期間の設計まで含めて報告。lint 実装は別項目として起票し直す。2026-07-12 完了、8693b9d。報告書: `docs/reports/c7-external-resources-sri.md`。棚卸し結果: SRI 未付与で付与可能なのは firebasejs 42タグのみ（value-card 2本は A-3/A-5 対応済み・Google Fonts は原理的に不可）。DEP-2 は python 方式で設計し11 fixture で誤検知なしを実証、警告期間は WARN→1サイクル→ERROR。firebase は許可リスト先行を推奨。lint 実装の起票は流入上限到達のため次回ループ実行へ持ち越し（起票予定内容は報告書末尾に明記））
- [x] C-8. モーダル/オーバーレイの分類調査と a11y 実装案（2026-07-11 クロスレビューで「role="dialog" の一括付与」は却下→分類先行に縮小。条件: 各アプリのオーバーレイ（再接続・ホスト切断・出題/判定シート等）を dialog（操作あり）/ status / alert（通知のみ）に分類し、dialog にはフォーカス移動・復元・背景 inert 化まで一体の実装案を付けて報告。フォーカス管理なしの `aria-modal` 単独付与は「偽モーダル」として禁止。実装は分類確定後に 1アプリ1コミットの Tier B 項目として起票し直す。2026-07-12 完了、409866f。報告書: `docs/reports/c8-modal-overlay-classification.md`。status=再接続12＋loading3＋カウントダウン（aria-live は状態文側のみ）、dialog=ホスト切断13・nitaku-board（唯一の偽モーダル該当）・jinro rules・kyoumi-sugoroku・howto.js（最準拠）、alert=該当なし。dialog は6点セットの一体実装パターン＋優先順位4段を提示。起票は流入上限到達のため次回実行へ持ち越し）
- [x] C-9. 匿名認証失敗経路の棚卸し（2026-07-11 クロスレビュー両承認で起票。条件: 全 RTDB アプリの `authReady` の await / catch の有無、失敗時に DB 処理へ進んでしまわないか、未処理 rejection・無限スピナーの有無を確認。子ども向けエラー表示＋再試行手段の統一案を Tier 案付きで報告。apps/shared に触る修正案が出た場合はその旨を明記して個別承認へ。2026-07-12 完了、a117b3c。報告書: `docs/reports/c9-auth-failure-paths.md`。await authReady 全40箇所を実測: tryReconnect は全14アプリ try/catch 保護済み、hostCreateRoom/guestJoin は ito・name-change 以外の11アプリが裸 await＝失敗時ボタン無反応（console のみ・子ども向け説明なし）。失敗時に DB 処理へ進む経路・無限スピナーはなし。統一案は apps/shared に触れない各アプリ側 try/catch＋既存エラー表示の型（Tier B 案）。付随発見: name-change のインライン firebaseConfig 残存＝B-8 の漏れ。昇格判断は P-7 に起票）
- [ ] C-10. **2026-09-04 監査 finding の authorized-sandbox 実測**（報告書: `docs/reports/audit-run-2026-09-04-fable-5-1.md`。static-only では断定できなかった P2-1 / P2-2 / P4-1 / P4-4 の挙動を、本番 Firebase を使わない隔離環境（Emulator または承認済み検証プロジェクト）で host/guest 実測し、結果を報告書として `docs/reports/` に追加する。修正はしない）。①P2-1: ホスト側で DevTools Offline を10秒 ON→OFF し、リロードなしの SDK 自動再接続後に `hostConnected` が false のまま残り、2分後にゲスト側 TTL が生きているルームを削除するか（対象例: do-mannaka / name-change。対策済みの kaburazu-hint:940-947 と比較） ②P2-2: ゲスト側で同様に通信断→復帰後に `players/{nick}` が戻らず、次の操作で部分ノードとして復活するか（word-wolf / pittari-meter） ③P4-1: ゲーム中のゲストがリロードしたとき旧接続の `onDisconnect().remove()` が新ページの get() より先に完了して復帰が拒否されるか（word-wolf でウルフがリロード→必ず「ウルフの勝ち」になるか、tatoe-narabe で二度と入れないか。iOS Safari も1回） ④P4-4: 開始・再戦ボタンの二度押しで2回目の transaction が実際に届き誤ったエラー alert/トーストが出るか、ルーム作成の二度押しで room が2つできるか（kakure-number / tatoe-narabe / ikutsu-ieru）。結果に応じて P-11 の判断材料と、P2-1 / P2-2 / P4-4 の Tier B 起票可否を報告する

## Tier D: 人間専任（ループはスキップして別項目へ進む）

- [x] D-1. **firestore.rules の是正**: 掲示板は運用停止中のため 2026-07-10 にアプリごと削除し、bb-* ルールも撤去。本番反映も同日完了（ルールデプロイ済み＋bb-users / bb-invite-codes / bb-config / bb-threads の4コレクション削除済み）
- [ ] D-2. firestore.rules を CI デプロイ対象に追加。サービスアカウントに `serviceusage.services.get` 権限（roles/serviceusage.serviceUsageConsumer）を付与してから、`.github/workflows/firebase-rules.yml` のトリガー paths と `--only` に firestore を追加（過去に権限不足で手動運用にした経緯あり）
- [ ] D-3. 新規コンテンツ（クイズ問題・お題・カード）の本体投入。ループは候補生成（別ファイル出力＋自己申告つき）まで
- [ ] D-4. quiz の重複2件の入れ替え（提案4昇格・一部。「情けは人の為ならず」の2パック重複と雑学キング2の答え「中国語」×2。代わりの新問が必要＝新規コンテンツ投入のため D-3 と同じ扱い: ループは代替問題の候補生成（別ファイル出力）まで、本体投入は人間確認後。詳細は `docs/reports/c4-duplicate-phrases.md`）

## 提案欄（ループが見つけた改善候補を追記する場所。人間が Tier を付けて上に昇格）

- ~~提案6（2026-07-11 B-9作業中に発見）: 全アプリの `rtdb-utils.js?v=20260710` 固定バージョンを一斉に次版へ更新~~ → **2026-07-11 A-4 として昇格・完了**
- ~~提案7（2026-07-11 計画セッション・クロスレビュー済み）: 判断待ちセクションの新設~~ → **2026-07-11 人間承認・運用ルール8/9と「判断待ち」セクションとして発効**
- ~~提案8（同上）: Tier B+ のシャドー運用~~ → **2026-07-11 人間承認・Tier 表下の「Tier B+ シャドー運用」として発効（権限移譲なし・測定のみ）**
- ~~提案9（同上）: 新規アプリのプロトタイプ自律作成（改訂版）~~ → **2026-07-11 人間承認・「drafts/ プロトタイプ制度」として発効（deploy.yml の apps/ 限定配信を実確認済み）**
- ~~提案10（同上）: 新規アプリ第1弾「ものがたりダイス」~~ → **2026-07-11 人間承認・B-15 として起票（A-8 完了が前提）**
- 提案11（2026-07-27 監査B5=ikutsu-ieru コピーボタン実装中に発見）: クリップボードコピーの `writeText` 失敗時に無反応となる既存実装 **7本**（do-mannaka / kakure-number / pita-hame / pittari-meter / tatoe-gp / tatoe-narabe / uso-jisho）へ、ikutsu-ieru と同じ `catch`＋子ども向け文言（トースト or 各アプリ既存のエラー表示手段）を足す。実測: 上記7本は catch なし、name-change / kaburazu-hint / challenge-tane / apps/shared/js/utils.js は対応済み。クリップボードが使えない環境（権限拒否・非セキュアコンテキスト）でボタンが無言になるのを防ぐ。想定 Tier B（1アプリ×1コミット。失敗経路はブラウザの clipboard 権限拒否で実測可能＝2026-07-27 の ikutsu-ieru 検証で実証済み）
- 提案12（2026-09-04 監査 P1-3 で発見。報告書 `docs/reports/audit-run-2026-09-04-fable-5-1.md`。新規P票の上限3件のため今回は起票せず次回の起票候補）: 新規6アプリ（blackjack / esadori / kotoba-pair / moji-soroe / pita-hame / toomawashi）で未 SRI の firebasejs タグが 42→60 に増えた。C-7 報告（2026-07-12）末尾で予告された「DEP-2 lint の導入と firebase SDK の扱い (a) 全箇所に SRI 付与 / (b) gstatic firebasejs を許可リストに入れて DEP-2 を WARN 導入」の判断が未起票のまま。想定: (b) を P票化し、承認後に DEP-2 を Tier A（C-7 の fixture 11件＋現行 apps 検出 0 が受入条件）で起票、new-app-scaffold スキルに「外部 JS は SRI 必須（firebase は例外）」を1行追記

<details><summary>昇格前の提案7〜10の原文（記録用）</summary>

- 提案7（2026-07-11 計画セッション・クロスレビュー済み）: **判断待ちセクションの新設**。別ファイル（PENDING.md）ではなく本ファイル内に「判断待ち」セクションを設け、1項目=安定ID（P-連番）＋対象コミットSHA＋はい/いいえ質問＋推奨＋根拠3点以内＋可逆性。回答は 承認/却下/保留（保留は理由と再確認日必須）。14日無応答で【再掲】、28日で塩漬け（ただし安全・セキュリティ・子どもの体験に関わる項目は塩漬け対象外）。無応答はデフォルト承認にしない。ループ起動時に「判断待ち: N件/最古X日前/上位3件」を必須出力。→ **運用ルール変更のため人間の承認待ち**（Codex 指摘による改訂版。詳細: `docs/reports/cross-review-2026-07-11.md`）
- 提案8（同上）: **Tier B+ のシャドー運用**。クロスモデル承認による人間省略は Codex が却下（2モデルは同じ盲点を共有しうる・事後監査は予防にならない）。代替として、B+ 対象相当の案件（事実検証済みコンテンツ修正・機械検証可能な置換）で「2モデル判定を記録するだけで適用は従来どおり人間承認」のシャドー運用を行い、誤承認率を測定してから権限移譲を再判断する。→ **人間の承認待ち**
- 提案9（同上）: **新規アプリのプロトタイプ自律作成（改訂版）**。リポジトリ直下 `drafts/{app-name}/`（GitHub Pages 非配信・要 deploy.yml 実確認）・Firebase 未接続・ポータル/updates.json 追記禁止・同時3本まで。Codex 指摘の反映: draft 専用の最小 lint（XSS・外部通信禁止・依存追加禁止）を用意し、**apps/ への移植と公開はまとめて1つの D ゲート**（最終差分を人間確認。「移植はB・掲載のみD」の穴を閉じる）。公開リポジトリのためソース自体は公開される点を許容するかも判断に含む。→ **ガードレール変更のため人間の承認待ち**
- 提案10（同上）: **新規アプリ第1弾「ものがたりダイス」**（「どこで/だれが/なにを」アイコンダイスで即興のお話。オフライン・最小規模・入力ゼロ）。クロスレビューで8案中4案が子どもの体験リスクで却下され、本案が最低リスクの第1弾候補として両モデル合意（条件: 組み合わせ全件の安全監査・パス/振り直し・アイコンの代替テキスト・prefers-reduced-motion 対応）。着手は提案9の承認が前提。→ **人間の承認待ち**（詳細: `docs/reports/cross-review-2026-07-11.md`）

</details>

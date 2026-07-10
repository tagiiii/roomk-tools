# 改善バックログ（/loop 運用の正本）

日々の改善ループ（AIエージェントの自律反復実行）が消化してよいタスクと、その運用ルールの正本。
2026-07-10 策定（複数エージェント監査＋Codex 相談の合意内容）。

## 運用ルール（ガードレール）

ループは「自律的な改善者」ではなく「承認済みバックログを消化する保守作業員」。

1. **このファイルに載っている項目だけ**を着手対象とする。計画外の新規判断（新機能・新コンテンツの投入、仕様変更）はループでは行わず、「提案」として本ファイルの候補欄に追記するに留める
2. **変更禁止パス**: `firestore.rules` / `database.rules.json` / `firebase.json` / `apps/shared/**` / `.github/**` に変更が及ぶ場合は着手せず停止（Tier D として人間へ）
3. 1イテレーション = **1アプリ × 1関心事**、差分の目安 200 行以内、1コミット（Conventional Commits 準拠）
4. 着手前後に `bash scripts/lint.sh` を実行。コンテンツを触った場合は `node scripts/content-audit.mjs` も実行し、エラー・新規重複が出たら修正 1 回で直らなければ停止
5. 「メンター実機確認待ち」のアプリへの**機能追加**は禁止（バグ修正・規約準拠化は可）
6. 完了した項目はチェックを付け、コミットハッシュを添える。未レビューの Tier B 成果が 3 件たまったら新規着手を止めて人間のレビューを待つ

### タスクの区分（Tier）

| Tier | 意味 | merge 権 |
|---|---|---|
| A | 機械検証可能・挙動を変えない → 修正まで自律で可 | ループ |
| B | 利用者に見える・文言や見た目が変わる → 草案（変更＋説明）まで。反映は人間確認後 | 人間 |
| C | 調査・報告のみ。変更しない | — |
| D | 人間専任。ループは触らない | 人間 |

## Tier A: 自律修正 OK

- [x] A-1. `apps/nitaku-board/index.html` の `dayCheckInterval`（setInterval）に `clearInterval` を追加（lint [REF-5] の WARN 対応。pagehide で解放。2026-07-10 完了、6749b7f）
- [x] A-2. 旧トップレベル `shared/` の削除（参照ゼロ再確認済み: `../shared/` は全て apps/shared を指す相対参照、firebase.json 参照なし。2026-07-10 完了、a883cf1）
- [x] A-3. `apps/value-card/index.html` の `sortablejs@latest` を 1.15.7 に固定＋SRI 付与（2026-07-10 完了）

## Tier B: 草案まで（反映は人間確認後）

- [ ] B-1. howto.js（あそびかたモーダル）導入: `ito` / `jinro` / `jitsuwa-game` / `tsuyomi-card` / `value-card` の 5 本（lint [HOWTO-1] の WARN 対応。組み込みは機械的だが、モーダル内の文言は子ども向けのため人間承認必須）
- [ ] B-2. `apps/hint-de-pinto/index.html:401` の ⭕❌ ボタンを Material Symbols（check_circle / cancel）に置換（lint [CONTENT-1] の WARN 対応）※2026-07-10 草案作成済み（作業ツリーに未コミットで保留、既存の vertical-align:middle;18px パターンに準拠・ブラウザ表示確認済み。人間確認後にコミット）
- [x] B-3. ~~`apps/bulletin-board/index.html` の `maximum-scale=1` を除去~~（2026-07-10 アプリごと削除により解消）
- [ ] B-4. ポータル `apps/index.html` のシーンチップに `min-height: 44px`（現状実測約 34px でタップターゲット未満）※2026-07-10 草案作成済み（作業ツリーに未コミットで保留、ブラウザ実測 44px・崩れなし確認済み。人間確認後にコミット）
- [ ] B-5. ポータル `apps/index.html` にフィルタ結果ゼロ時の空状態表示を追加
- [ ] B-6. ブレークポイント統一: AGENTS.md「600px」と `apps/shared/css/design-system.css`（480px）の不一致解消。**どちらに揃えるかは人間が決める**（決定後の反映作業はループ可）
- [ ] B-7. `esc()` の共有化: `rtdb-utils.js` に `RoomkRTDB.esc` を**追加のみ**で用意（12 アプリの重複定義の巻き取りは 1 本ずつ実機確認しながら段階的に）※ apps/shared 配下のため着手時は人間同席
- [ ] B-8. Firebase 初期化ヘルパーの共有化検討: 14 アプリにコピペされた `firebaseConfig` を rtdb-utils.js の init 関数へ（追加のみ・1〜2 アプリで試験してから横展開）※ 同上

## Tier C: 調査・報告のみ

- [ ] C-1. 難読地名・駅名 160 問の事実再検証（四半期で一巡: 月 20 問ずつ、市町村合併・駅名改称・由来を一次ソース 2 件で確認。結果は報告のみ、修正は人間承認後）
- [ ] C-2. aria/role ゼロのアプリ（checkin, vote, word-wolf, codenames, minna-ranking, ito, value-card ほか）の改善候補リスト作成
- [ ] C-3. muted テキスト×小フォントのコントラスト実測（WCAG AA）レポート
- [ ] C-4. `content-audit.mjs` の類似ペアレポートから「同一アプリ内の言い換え重複」を抽出して報告（食べ物ジャンル偏重の入れ替え候補づけ）

## Tier D: 人間専任（ループ着手禁止）

- [x] D-1. **firestore.rules の是正**: 掲示板は運用停止中のため 2026-07-10 にアプリごと削除し、bb-* ルールも撤去。本番反映も同日完了（ルールデプロイ済み＋bb-users / bb-invite-codes / bb-config / bb-threads の4コレクション削除済み）
- [ ] D-2. firestore.rules を CI デプロイ対象に追加。サービスアカウントに `serviceusage.services.get` 権限（roles/serviceusage.serviceUsageConsumer）を付与してから、`.github/workflows/firebase-rules.yml` のトリガー paths と `--only` に firestore を追加（過去に権限不足で手動運用にした経緯あり）
- [ ] D-3. 新規コンテンツ（クイズ問題・お題・カード）の本体投入。ループは候補生成（別ファイル出力＋自己申告つき）まで

## 提案欄（ループが見つけた改善候補を追記する場所。人間が Tier を付けて上に昇格）

（なし）

---
name: new-app-scaffold
description: roomK ツール群に新しいアプリを追加するときの手順。apps/{name}/ の雛形作成・ポータル登録・AGENTS.md 執筆・lint 対応までを漏れなく行う。「新しいアプリを作りたい」「〜というツールを追加して」と言われたら使う。
---

# 新規アプリ追加の手順

仕様の正本はルート `AGENTS.md`。このスキルは手順の抜け漏れ防止用チェックリストであり、規約本文は転載しない（必ず AGENTS.md を読むこと）。

## 0. 事前確認（コードを書く前に）

1. ルート `AGENTS.md` を全部読む（特に「新しいアプリを追加するとき」「共通実装ルール」「コンテンツガイドライン」）
2. ファイル構成パターンを決める:
   - **単一ファイル**（index.html のみ・全インライン）: Realtime Database アプリ、または軽量オフラインツール。見本: `apps/kyapa-graph/`
   - **分割ファイル**（index.html + app.js + style.css）: Firestore アプリ・オフラインツール。見本: `apps/otona-talk/`
3. コンテンツガイドライン適合を確認。意図的に逸脱する場合（内省ツール等）は AGENTS.md に「既存ガイドラインからの例外」節を書く前提で進める（先行事例: `apps/kyapa-graph/AGENTS.md`）
4. CSS 接頭辞（2〜4文字 + `-`、BEM）を決め、既存アプリと衝突しないことを確認

## 1. ファイル作成

- `apps/{app-name}/index.html`（+ パターンに応じて app.js / style.css）
- Realtime Database を使う場合は AGENTS.md の「Realtime Database 実装ルール」「切断時の挙動」「再接続」を全て実装する（transaction・onDisconnect・ORPHAN_TTL_MS=2分・serverTimeOffset・sessionStorage 再接続・終了後削除）
- 絵文字禁止・Material Symbols Rounded 使用、design-system.css のトークンを再利用

## 2. ポータル登録

`apps/index.html` にカードを追加する。既存カード（例: otona-talk のカード）の HTML 構造をそのままコピーして書き換える:
- `app-card__icon` の Material Symbols アイコン名
- `app-card__name` / `app-card__desc`
- `meta-badge` × 3（人数・所要時間・特記事項）
- **`data-scenes` 属性（必須）**: 利用シーンをスペース区切りで指定（例: `data-scenes="hiroba sakusen"`）。キーは `kotoba` / `bodoge` / `hiroba` / `circle` / `sakusen` の5種（定義は AGENTS.md「利用シーンタグ」参照）。シーンバッジは自動描画されるのでカード HTML に手書きしない

あわせて `apps/updates.json` の**先頭**に更新情報を1エントリ追記する（`type: "new"`、フォーマットは AGENTS.md「更新情報」参照）。ポータルの更新情報欄と NEW フラグはここから自動描画される。

## 3. AGENTS.md 作成

`apps/{app-name}/AGENTS.md` を必ず作る。見出し構成の見本:
- シンプル系: `apps/otona-talk/AGENTS.md`（目的・使用シーン / 技術スタック / 画面構成・フロー / データ構造 / 共通モジュールの使用箇所 / 特有のルール・制約）
- 内省ツール系: 上記 + `設計思想` / `入れない機能（意図的に未実装）` / `既存ガイドラインからの例外`（見本: `apps/kyapa-graph/AGENTS.md`）
- リアルタイム対戦系: 上記 + `status 遷移` / `Firebase データ構造` / `切断時の挙動`（見本: `apps/hint-de-pinto/AGENTS.md`）

共通規約から意図的に逸脱する箇所は**必ず**ここに明文化する（例: jinro のゲスト切断 `connected:false`、word-wolf/ito の result 後自動削除なし）。

## 4. lint 対応と検証

1. Realtime Database アプリの場合、`scripts/lint.sh` の `RTDB_HTML_FILES` 配列に新アプリを追加
2. `bash scripts/lint.sh` を実行し、エラー0・新規警告なしを確認
3. ローカル確認: `cd apps && python3 -m http.server 8080` → `http://localhost:8080/{app-name}/`

## 完了チェックリスト

- [ ] apps/{name}/ 一式（パターン準拠）
- [ ] apps/index.html にカード追加（data-scenes 必須）
- [ ] apps/updates.json に更新情報を追記（type: "new"）
- [ ] 共通「あそびかた／つかいかた」モーダル組み込み（shared/js/howto.js、AGENTS.md「howto.js」参照）
- [ ] apps/{name}/AGENTS.md（逸脱の明文化を含む）
- [ ] lint.sh の RTDB_HTML_FILES（RTDB の場合）
- [ ] lint パス
- [ ] コンテンツガイドライン適合（または例外の明文化）

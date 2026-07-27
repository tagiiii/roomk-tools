---
name: new-app-scaffold
description: roomK ツール群に新しいアプリを追加するときの手順。apps/{name}/ の雛形作成・ポータル登録・あそびかたモーダル・早見表への掲載・AGENTS.md 執筆・lint 対応までを漏れなく行う。「新しいアプリを作りたい」「〜というツールを追加して」と言われたら使う。
---

# 新規アプリ追加の手順

仕様の正本はルート `AGENTS.md`。このスキルは手順の抜け漏れ防止用チェックリストであり、規約本文は転載しない（必ず AGENTS.md を読むこと）。

## 0. 事前確認（コードを書く前に）

1. ルート `AGENTS.md` を全部読む（特に「新しいアプリを追加するとき」「アプリ名のつけかた」「共通実装ルール」「コンテンツガイドライン」）
2. **アプリ名を決める**（AGENTS.md「アプリ名のつけかた」に従う）:
   - 実在のゲーム・番組・商品の名称やそのもじりは使わない。着想元は `updates.json` の紹介文と `apps/guide/` で「『◯◯』から着想」と記述的に紹介する
   - 遊びの動きが伝わる、ひらがな・カタカナ中心の短い名前（例: ピタハメ、おしつけずかん、かぶらずヒント）
   - フォルダ名は表示名に対応するローマ字。既存フォルダと衝突しないこと（`apps/codenames/` `apps/hint-de-pinto/` `apps/iisen-show/` `apps/ito/` は改名前のリダイレクトスタブなので流用しない）
3. ファイル構成パターンを決める:
   - **単一ファイル**（index.html のみ・全インライン）: Realtime Database アプリ、または軽量オフラインツール。見本: `apps/kyapa-graph/`
   - **分割ファイル**（index.html + app.js + style.css）: Firestore アプリ・オフラインツール。見本: `apps/otona-talk/`
4. コンテンツガイドライン適合を確認。意図的に逸脱する場合（内省ツール等）は AGENTS.md に「既存ガイドラインからの例外」節を書く前提で進める（先行事例: `apps/kyapa-graph/AGENTS.md`）
5. CSS 接頭辞（2〜4文字 + `-`、BEM）を決め、既存アプリと衝突しないことを確認

## 1. ファイル作成

- `apps/{app-name}/index.html`（+ パターンに応じて app.js / style.css）
- Realtime Database を使う場合は AGENTS.md の「Realtime Database 実装ルール」「切断時の挙動」「セッションデータの自動削除」「再接続」を全て実装する（`RoomkRTDB.initFirebase()`・transaction・onDisconnect・`cancelRoomOnDisconnect()`・ORPHAN_TTL_MS=2分・serverTimeOffset・sessionStorage 再接続・終了後削除・認証失敗ハンドリング）
- 絵文字禁止・Material Symbols Rounded 使用、design-system.css のトークンを再利用
- 比喩は導入で1回だけ説明し、ボタンなどの操作名は比喩を使わない素直な動詞にする

## 2. あそびかたモーダル

`shared/js/howto.js` を読み込んで `RoomkHowto.init({...})` を呼ぶ（AGENTS.md「howto.js」参照）。lint `[HOWTO-1]` が存在を検査する。
文言は子どもが読者。ボタン名は画面の実ラベルを「」で正確に引用し、**メンター向けの心得・声かけのコツは書かない**（置き場は `AGENTS.md` だけ）。

## 3. ポータル登録

`apps/index.html` にカードを追加する。既存カード（例: otona-talk のカード）の HTML 構造をそのままコピーして書き換える:
- `app-card__icon` の Material Symbols アイコン名
- `app-card__name` / `app-card__desc`
- `meta-badge` × 3（人数・所要時間・特記事項）
- **`data-scenes` 属性（必須）**: 利用シーンをスペース区切りで指定（例: `data-scenes="hiroba sakusen"`）。キーの定義は AGENTS.md「利用シーンタグ」参照。シーンバッジは自動描画されるのでカード HTML に手書きしない
- `slides.html` も作る場合は `data-slides` 属性を追加（`slides-generator` スキル）

あわせて `apps/updates.json` の**先頭**に更新情報を1エントリ追記する（`type: "new"`、フォーマットは AGENTS.md「更新情報」参照）。ポータルの更新情報欄と NEW フラグはここから自動描画される。

## 4. スタッフ向け早見表への掲載

`apps/guide/index.html`（ゲームえらび早見表）の該当系統セクション（`<section class="gd-section">`）の `<tbody>` に `<tr>` を1行追加する。既存行をコピーして5列を埋める:

| 列 | 内容 |
|---|---|
| ゲーム名 | `<td class="gd-table__name"><a href="../{app-name}/">表示名</a></td>` |
| ひとことで | `data-label="ひとことで"` 遊びを1文で |
| 近い遊び | `data-label="近い遊び"`。着想元が AGENTS.md に明記されている市販ゲームは『』つき、それ以外は `<span class="gd-origin--genre">〜系</span>` の系統ラベル |
| 人数・時間 | `data-label="人数・時間"` |
| シーン | `data-label="シーン"` ＋ `gd-scene-badge` を `data-scenes` と一致させる |

系統に当てはまるセクションがない場合だけ新セクションと目次（`gd-toc`）を足す。

## 5. AGENTS.md 作成

`apps/{app-name}/AGENTS.md` を必ず作る。見出し構成の見本:
- シンプル系: `apps/otona-talk/AGENTS.md`（目的・使用シーン / 技術スタック / 画面構成・フロー / データ構造 / 共通モジュールの使用箇所 / 特有のルール・制約）
- 内省ツール系: 上記 + `設計思想` / `入れない機能（意図的に未実装）` / `既存ガイドラインからの例外`（見本: `apps/kyapa-graph/AGENTS.md`）
- リアルタイム対戦系: 上記 + `status 遷移` / `Firebase データ構造` / `切断時の挙動`（見本: `apps/kaburazu-hint/AGENTS.md`、`apps/esadori/AGENTS.md`）

共通規約から意図的に逸脱する箇所は**必ず**ここに明文化する（例: jinro のゲスト切断 `connected:false`、word-wolf / tatoe-narabe の result 後自動削除なし、esadori の presence ノード有無方式）。
メンター向けの心得・声かけのコツを書くのもここだけ。

## 6. lint 対応と検証

1. Realtime Database アプリの場合、`scripts/lint.sh` の `RTDB_HTML_FILES` 配列に新アプリを追加
2. `bash scripts/lint.sh` を実行し、**エラー0・警告0**を確認（現在は警告ゼロで通る状態を維持している）
3. お題・問題などのコンテンツを持つアプリなら `node scripts/content-audit.mjs` も実行し、既存アプリとの重複がないことを確認。抽出対象になっていない場合は `collectEntries()` への追加も検討する
4. ブラウザ動作確認: `cd apps && python3 -m http.server 8080` → `http://localhost:8080/{app-name}/`。PC とモバイル幅（600px 以下）、主要操作、コンソールエラーを確認
5. RTDB アプリは host/guest の2ブラウザで同期・再接続・退出まで実機確認する（ここを飛ばしたら「未確認」と明記する）

## 完了チェックリスト

- [ ] apps/{name}/ 一式（パターン準拠・命名ポリシー準拠）
- [ ] あそびかた／つかいかたモーダル組み込み（`shared/js/howto.js`）
- [ ] apps/index.html にカード追加（`data-scenes` 必須・slides があれば `data-slides`）
- [ ] apps/updates.json の先頭に更新情報を追記（`type: "new"`）
- [ ] apps/guide/index.html の早見表に1行追加
- [ ] apps/{name}/AGENTS.md（逸脱の明文化を含む）
- [ ] lint.sh の RTDB_HTML_FILES（RTDB の場合）
- [ ] lint エラー0・警告0
- [ ] content-audit（コンテンツを持つ場合）
- [ ] ブラウザ動作確認（PC / モバイル、RTDB は host/guest 実機）
- [ ] コンテンツガイドライン適合（または例外の明文化）

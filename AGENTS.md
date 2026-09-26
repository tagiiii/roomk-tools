# room-K ツール群 — プロジェクト共通仕様

## プロジェクト概要

不登校の子どもや若者を対象としたオンラインメンタリングサービス「room-K」で使用するWebツール群。
メンター（スタッフ）が Zoom / Meet などで画面共有しながら参加者と一緒に使う。

**デプロイ先**: https://tagiiii.github.io/roomk-tools/
**リポジトリ**: https://github.com/tagiiii/roomk-tools

---

## 権限と完了条件

- Claude Code / Codex 共通の運用入口はこのファイル。アプリを変更・監査するときは、その `apps/{app}/AGENTS.md` も読み、固有仕様と意図的例外を守る。
- `firestore.rules` / `database.rules.json` / `firebase.json` / `apps/shared/**` / `.github/**` は変更禁止パス。変更はオーナーの個別判断へ回す。読み取り・所見の報告は可能。
- 支援方針、新規コンテンツの本体投入、`drafts/` から `apps/` への移植・公開は人間専任。モデル同士の一致は人間の承認を代替しない。
- 内省の回答・成長評価に、保存・採点・比較・自動推薦を追加しない。ゲーム得点・進行用一時状態・再接続用sessionStorageとは区別する。意図的例外と実害の扱いは `docs/audit-prompts.md` §0.5。
- 依頼・バックログで承認済みの修正と必要な検証は、同じ承認を取り直さず完了まで続ける。新たな仕様判断・権限が必要な部分だけ保留する。
- 読み取り監査は所見まで。修正依頼は対象変更・必要な検証・結果報告まで。未検証事項を完了と扱わない。コミット・PR・公開の到達点は依頼範囲と下記運用に従う。
- 改善ループだけは `docs/kaizen-backlog.md` の承認済み項目・A/B/C/D・修正回数・停止条件を使う。1アプリ×1関心事×1コミット、判断キュー上限、B+の独立判定を維持する。単発依頼へループ全工程を自動適用しない。
- 役割・必須の独立レビューは `docs/ai-roles.md` が正本。役割を変えるとき・複数モデルで引き継ぐときに読む。モデル・承認と実装の分離を勝手に変更しない。
- 引き継ぎでは対象コミット、未コミット差分、承認範囲、検証対象と結果、残作業を渡す。同じ検査対象・作業ツリー・設定・依存関係で既に合格した検査は再利用できる。新しい差分に古い検査結果を流用しない。

## 必要な資料だけ読む

以下が移動した共通仕様の正本。旧文書が「ルートAGENTS.mdの○○節」と指す場合も、該当行の資料内で同名の節を探す。全資料の一括読み込みは不要。

| 作業・旧見出し | 参照先 |
|---|---|
| 新規アプリ、命名、ファイル構成、利用シーンタグ、更新情報 | [app-registration.md](docs/development/app-registration.md) |
| 共通モジュール、utils.js、rtdb-utils.js、howto.js、firebase-config.js、stats.js | [shared-modules.md](docs/development/shared-modules.md) |
| デザインシステム、ボタン階層、トップ画面、アイコン、番号付け、フォント | [ui.md](docs/development/ui.md) |
| Firebase、無料枠、パス、認証、設定 | [firebase.md](docs/development/firebase.md) |
| 共通実装、参加画面、ルームコード、ニックネーム、状態・transaction、切断、削除、再接続 | [rtdb.md](docs/development/rtdb.md) |
| 指定観点の監査 | [audit-prompts.md](docs/audit-prompts.md) の共通契約＋該当カード |
| 承認済みバックログの改善ループ | [kaizen-backlog.md](docs/kaizen-backlog.md) の運用規則＋対象項目 |

コード・公開物は `apps/`、共通モジュールは `apps/shared/`。旧 `shared/` は使わない。スタッフ向け早見表は `apps/guide/`。
依頼とモデル間引き継ぎの記入例は [request-templates.md](docs/request-templates.md)。例文を読むことは通常作業の前提条件にしない。

### 改名済みアプリ（リダイレクトスタブ）

改名したアプリは、旧 URL を残すため旧フォルダに `<meta http-equiv="refresh">` のスタブだけを置いている。
**スタブを実装だと思って編集しない。** 実装・`AGENTS.md`・`slides.html` はすべて新フォルダ側にある。

| 旧フォルダ（スタブ） | 実装のある新フォルダ |
|---|---|
| `apps/codenames/` | `apps/kotoba-tantei/`（ことば探偵） |
| `apps/hint-de-pinto/` | `apps/kaburazu-hint/`（かぶらずヒント） |
| `apps/iisen-show/` | `apps/do-mannaka/`（ドまんなか） |
| `apps/kotoba-waza/` | `apps/kotoba-theme/`（コトバのテーマクイズ） |
| `apps/ito/` | `apps/tatoe-narabe/`（たとえならべ） |
| `apps/sukina-map/` | `apps/suki-type-check/`（すきタイプチェック） |
| `apps/kimochi-map/` | `apps/kimochi-ate/`（気持ち当てゲーム。2026-09-25 に1対1の語彙ツールからゲームへ作り変え） |

スタブは `scripts/lint.sh` の `HOWTO_EXEMPT` に登録済み（あそびかたモーダル不要）。

## スキルの入口

スキル本文の正本は `.claude/skills/`。Claude Code / Codex とも下記の条件で該当ファイルを読む。Codexの自動スキル一覧への登録を前提にせず、この入口から参照する。コピーは作らない。

| 用途 | スキル |
|---|---|
| 本体アプリの新規追加 | [new-app-scaffold](.claude/skills/new-app-scaffold/SKILL.md) |
| RTDB実装規約の監査 | [rtdb-audit](.claude/skills/rtdb-audit/SKILL.md) |
| 画面共有用 `slides.html` の作成・更新 | [slides-generator](.claude/skills/slides-generator/SKILL.md) |

### XSS 対策

ユーザー入力（ニックネーム・回答・名前など）を DOM に挿入する際は必ずエスケープする。

```js
// Realtime Database 単一ファイルアプリ
const esc = RoomkRTDB.esc;

// Firestore アプリ（utils.js を使う場合）
import { escapeHtml } from '../shared/js/utils.js';
```

`innerHTML` への代入時は必ず `esc()` / `escapeHtml()` を通す。`textContent` への代入は不要。

### セキュリティ方針（性善説）

Firebase Realtime Database はフィールドレベルの読み取り制御が難しい。
`isWolf`・他プレイヤーの秘密情報などは **UIレベルで非表示**にするが、
DevTools での確認は**性善説で許容**する（スタッフ監視下での使用のため）。

---

## コンテンツガイドライン

参加者は**小学校中学年〜中学生**（不登校の子どもを含む）。

### 使用しない表現・トピック
- 学校・勉強・宿題・テスト・成績を連想させる内容
- 出席・登校・欠席・不登校を直接示唆する内容
- 恋愛・交際・告白などのロマンティックな内容
- 暴力・ホラー・死・怖い話などダークな内容
- 正解を強いる質問・比較を促す質問

### 推奨するトーン
- 正解のない開かれた質問
- 子どもが「答えたくない」と感じにくい軽いトーン
- 好き・楽しい・やってみたいなどポジティブな軸

### 表記トーン（2026-08-10 改訂）

- **全アプリで通常表記（漢字まじり・分かち書きなし）を標準とする**。読めない漢字は
  ファシリテーター（メンター）が読み上げて補完する運用。ひらがな分かち書きは文章を
  読みづらくし、中学生に幼い印象を与えるため（2026-08-10 オーナー実機フィードバック）
- 漢字は小中学生が読める常用範囲を目安にする。ふりがなは付けない
- **語彙・お題そのものがコンテンツであるもの**（kimochi-ate の感情語彙72語、各ゲームの
  お題・問題・カードの語など）はこの方針で機械的に書き換えない。意味・ニュアンス・語感を
  変えない（コンテンツの表記を変える場合は個別のコンテンツ改修として判断する）
- 文体・トーン（〜だよ・〜してね／です・ます 等）は各アプリの既存トーンを踏襲し、表記だけを変える
- 経緯: 2026-08-06 に1対1面談系6ツールで通常表記化 → 2026-08-10 のことば系新2アプリへの
  実機フィードバックを受けて全アプリ標準に拡大（同日、既存アプリの画面文言を一括変換）

---

## 開発・デプロイ

### チェック（コード・コンテンツ変更の完成時）

```bash
bash scripts/lint.sh
```

セキュリティ・規約違反・ポータル整合を機械チェックする。**エラー0・新規警告なしが基準**（現在は警告ゼロで通る状態を維持している）。
RTDB アプリを新規追加したら `scripts/lint.sh` の `RTDB_HTML_FILES` 配列にも追加する。

お題・問題などのコンテンツを触った場合は重複監査も実行する。

```bash
node scripts/content-audit.mjs
```

その他: `scripts/draft-lint.sh`（`drafts/` 配下のプロトタイプ用）。

編集操作ごとでなく、一つの修正単位が揃った時点で実行する。失敗・追加変更がある場合に影響する検査を再実行する。改善ループの着手前検査は直前の完了検査と対象状態が同一なら再利用してよい。合格基準と検証対象は変えない。
利用者に見える変更はPC・モバイルの表示、主要操作、コンソールを確認する。同期・切断復帰の変更は承認済みの検証環境でhost/guestの2ブラウザ確認を行う。静的監査から本番Firebaseへ書き込まない。

### ローカル確認

```bash
cd apps
python3 -m http.server 8080
# → http://localhost:8080/{app-name}/
```

### デプロイ

`main` ブランチにプッシュすると GitHub Actions が自動で GitHub Pages にデプロイする。
（`.github/workflows/deploy.yml` — `apps/` フォルダを配信ルートとして設定済み）

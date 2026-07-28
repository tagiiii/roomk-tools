# room-K ツール

不登校の子どもや若者を対象としたオンラインメンタリングサービス「room-K」で使用するWebツール群です。
メンターが Zoom / Meet などで画面共有しながら、参加者と一緒に使うことを想定しています。

- デプロイ先: https://tagiiii.github.io/roomk-tools/
- 配信ルート: `apps/`
- 共通仕様: [AGENTS.md](./AGENTS.md)（実装ルールの正本）
- AI エージェントの役割分担: [docs/ai-roles.md](./docs/ai-roles.md)

## アプリ一覧

アプリは約50本あります。**一覧を README に手で持たず、次の3つを正本とします**（手書きの表は必ず古くなるため）。

| 見たいもの | 見る場所 |
|---|---|
| 公開中のアプリ全部（利用シーンで絞り込み可） | [公開ポータル](https://tagiiii.github.io/roomk-tools/) / `apps/index.html` |
| スタッフ向けの選び方（系統・人数・時間・近い遊び） | [ゲームえらび早見表](https://tagiiii.github.io/roomk-tools/guide/) / `apps/guide/index.html` |
| 最近の追加・更新 | ポータル上部の「更新情報」 / `apps/updates.json` |

アプリ個別の仕様は `apps/{app-name}/AGENTS.md` にあります。

### 注意: 改名前のリダイレクトスタブ

`apps/codenames/`（→ `kotoba-tantei`）、`apps/hint-de-pinto/`（→ `kaburazu-hint`）、`apps/iisen-show/`（→ `do-mannaka`）、`apps/ito/`（→ `tatoe-narabe`）は旧 URL を保つためのリダイレクトのみです。実装は新フォルダ側にあります。

### 非表示・開発中

| アプリ | フォルダ | 状態 |
|--------|----------|------|
| チェックイン | `apps/checkin/` | 仕様あり、実装は準備中 |
| 投票・集計 | `apps/vote/` | 仕様あり、実装は準備中 |

## 技術スタック

- フロントエンド: HTML / CSS / JavaScript（バニラ）
- 共通UI: `apps/shared/css/design-system.css`
- 共通JS: `apps/shared/js/utils.js`（ESモジュール）, `apps/shared/js/rtdb-utils.js`（RTDB 単一ファイルアプリ用）, `apps/shared/js/howto.js`（あそびかたモーダル）, `apps/shared/js/firebase-config.js`
- データベース: Firebase Realtime Database / Firestore
- 認証: Firebase Anonymous Auth
- ホスティング: GitHub Pages（`apps/` を公開）

## ローカル確認

```bash
cd apps
python3 -m http.server 8080
```

ブラウザで `http://localhost:8080/` を開きます。
個別アプリは `http://localhost:8080/{app-name}/` で確認できます。

## チェック

```bash
bash scripts/lint.sh
```

主にXSS対策、design-system.cssの読み込み、Realtime Databaseアプリのviewport設定、Firebaseパス命名、ポータルカードの `data-scenes`、あそびかたモーダルの組み込みなどを確認します。**エラー0・警告0で通る状態を維持しています。**

コンテンツ（お題・問題文）を触った場合は重複監査も実行します。

```bash
node scripts/content-audit.mjs
```

## デプロイ

`main` ブランチにプッシュすると GitHub Actions で GitHub Pages にデプロイされます。
Firebase設定やセキュリティルールは `firebase.json`, `database.rules.json`, `firestore.rules` を参照してください。

## ディレクトリ構成

```text
roomk-tools/
├── apps/                    # GitHub Pages 公開ルート
│   ├── index.html           # アプリ一覧ポータル
│   ├── updates.json         # 更新情報の正本
│   ├── guide/               # スタッフ向け「ゲームえらび早見表」
│   ├── shared/              # 現行の共通モジュール
│   └── {app-name}/          # 各アプリ（+ アプリ固有の AGENTS.md）
├── docs/                    # 補助資料
│   ├── ai-roles.md          # AI の役割定義とガードレールの区分
│   ├── kaizen-backlog.md    # 改善ループの運用ルール・判断待ちキュー
│   └── audit-prompts.md     # 監査プロンプトのカタログ
├── scripts/                 # lint・コンテンツ監査等の開発補助
├── AGENTS.md                # プロジェクト共通仕様の正本
└── CLAUDE.md                # AGENTS.md への案内
```

ルート直下の `shared/` は旧配置です。新規実装・修正では `apps/shared/` を使ってください。

## 新しいアプリを追加するには

1. `apps/{app-name}/` を作成（名前のつけかたは [AGENTS.md](./AGENTS.md)「アプリ名のつけかた」）
2. 仕様に合う構成で `index.html` / `app.js` / `style.css` を作成
3. `apps/shared/js/howto.js` の「あそびかた／つかいかた」モーダルを組み込む
4. `apps/{app-name}/AGENTS.md` にアプリ固有仕様を記載（共通規約からの意図的な逸脱は必ず明記）
5. `apps/index.html` にポータルカードを追加（`data-scenes` 必須）
6. `apps/updates.json` の先頭に更新情報を追記
7. `apps/guide/index.html` の早見表に1行追加
8. `bash scripts/lint.sh` を実行（エラー0・警告0）

詳細な実装ルール、Firebase方針、デザインシステム、コンテンツガイドラインは [AGENTS.md](./AGENTS.md) を参照してください。
Claude Code では `new-app-scaffold` スキルが同じ手順をチェックリストとして持っています。

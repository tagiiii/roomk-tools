# roomK ツール

roomK（NPO）のオンライン支援現場で使用するWebツール群。

## アプリ一覧

| アプリ | フォルダ | 概要 |
|--------|----------|------|
| ✋ チェックイン | `apps/checkin/` | 参加者が今の気持ちを絵文字で共有 |
| 🗳️ 投票・集計 | `apps/vote/` | リアルタイム投票・集計 |

## 技術スタック

- **フロントエンド**: HTML / CSS / JavaScript（バニラ）
- **データベース**: Firebase Firestore（リアルタイム同期）
- **ホスティング**: GitHub Pages（`apps/` フォルダを公開ルート）

## セットアップ

### 1. リポジトリをクローン

```bash
git clone https://github.com/your-org/roomk-tools.git
cd roomk-tools
```

### 2. Firebase設定

`docs/firebase-setup.md` を参照して Firebase プロジェクトを作成し、
`shared/js/firebase-config.js` に接続情報を設定する。

### 3. ローカル確認

静的ファイルのため、簡易HTTPサーバーで動作確認できる：

```bash
# Python 3
python3 -m http.server 8080 --directory apps

# または npx
npx serve apps
```

ブラウザで `http://localhost:8080` を開く。

### 4. GitHub Pagesへのデプロイ

リポジトリの Settings > Pages で以下を設定：
- **Source**: Deploy from a branch
- **Branch**: `main` / `apps` フォルダ

## フォルダ構成

```
roomk-tools/
├── apps/                    # GitHub Pages 公開ルート
│   ├── index.html           # アプリ一覧ポータル
│   ├── checkin/             # チェックインアプリ
│   └── vote/                # 投票・集計アプリ
├── shared/
│   ├── css/design-system.css
│   └── js/
│       ├── firebase-config.js
│       └── utils.js
└── docs/
    ├── firebase-setup.md
    └── apps/
```

## 新しいアプリを追加するには

`.claude/CLAUDE.md` を参照。

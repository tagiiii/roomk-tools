# roomK ツール

不登校の子どもや若者を対象としたオンラインメンタリングサービス「roomK」で使用するWebツール群です。
メンターが Zoom / Meet などで画面共有しながら、参加者と一緒に使うことを想定しています。

- デプロイ先: https://tagiiii.github.io/roomk-tools/
- 配信ルート: `apps/`
- 共通仕様: [AGENTS.md](./AGENTS.md)

## アプリ一覧

### 公開ポータル掲載中

| アプリ | フォルダ | 同期方式 | 概要 |
|--------|----------|----------|------|
| クイズパック | `apps/quiz/` | オフライン | 雑学3択・連続2択などのクイズ進行 |
| ことばシャッフル | `apps/kotoba-shuffle/` | オフライン | バラバラの文字を並べ替えることば遊び |
| 漢字さがし | `apps/kanji-sagashi/` | オフライン | 似ている漢字の中からお題を探す観察ゲーム |
| ことばガチャ | `apps/kotoba-gacha/` | オフライン | ガチャ形式でことばのお題を引く |
| ことばリレー | `apps/kotoba-relay/` | オフライン | つなぎ言葉でリレーするワーク |
| たとえグランプリ | `apps/tatoe-gp/` | Realtime Database | お題に対するたとえ回答を出し合う |
| まちがいさがし | `apps/machigai-sagashi/` | オフライン | 文章や選択肢の違いを探す |
| ヒントでピント | `apps/hint-de-pinto/` | Realtime Database | ヒントを出し合って答えを当てる |
| ことば探偵 | `apps/codenames/` | Firestore | チームで単語カードを見つける |
| トークテーマカード | `apps/talk-card/` | オフライン | トークテーマカードを引く |
| いいセンいきまSHOW! | `apps/iisen-show/` | Realtime Database | 数字回答で「いいセン」を狙う |
| ワードウルフ | `apps/word-wolf/` | Realtime Database | 少数派のワードを推理する |
| 人狼ゲーム | `apps/jinro/` | Realtime Database | 画面共有向けの人狼進行 |
| 名前変えゲーム | `apps/name-change/` | Realtime Database | 名前を変えて誰かを当てる |
| え!? 実は○○なんですかゲーム | `apps/jitsuwa-game/` | オフライン | 実は話をきっかけにするトークゲーム |
| ito クモノイト | `apps/ito/` | Realtime Database | 数字カードを言葉で表現して並べる |
| 以心伝心しないゲーム | `apps/ishin-denshin/` | オフライン | かぶらない回答を狙う |
| 興味スゴロク | `apps/kyoumi-sugoroku/` | オフライン | サイコロと質問マスで話す |
| バリューカード | `apps/value-card/` | オフライン | 大切にしたい価値観カードを選ぶ |
| いくつ言える？ | `apps/ikutsu-ieru/` | Realtime Database | お題に対して思いつく答えを出す |

### 非表示・開発中

| アプリ | フォルダ | 状態 |
|--------|----------|------|
| チェックイン | `apps/checkin/` | 仕様あり、実装は準備中 |
| 投票・集計 | `apps/vote/` | 仕様あり、実装は準備中 |
| 掲示板 | `apps/bulletin-board/` | 非表示。実運用前に権限制御の見直しが必要 |

## 技術スタック

- フロントエンド: HTML / CSS / JavaScript（バニラ）
- 共通UI: `apps/shared/css/design-system.css`
- 共通JS: `apps/shared/js/utils.js`, `apps/shared/js/firebase-config.js`
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

主にXSS対策、design-system.cssの読み込み、Realtime Databaseアプリのviewport設定、Firebaseパス命名などを確認します。

## デプロイ

`main` ブランチにプッシュすると GitHub Actions で GitHub Pages にデプロイされます。
Firebase設定やセキュリティルールは `firebase.json`, `database.rules.json`, `firestore.rules` を参照してください。

## ディレクトリ構成

```text
roomk-tools/
├── apps/                    # GitHub Pages 公開ルート
│   ├── index.html           # アプリ一覧ポータル
│   ├── shared/              # 現行の共通モジュール
│   └── {app-name}/          # 各アプリ
├── docs/                    # 補助資料
├── scripts/                 # lint等の開発補助
├── AGENTS.md                # プロジェクト共通仕様の正本
└── CLAUDE.md                # AGENTS.md への案内
```

ルート直下の `shared/` は旧配置です。新規実装・修正では `apps/shared/` を使ってください。

## 新しいアプリを追加するには

1. `apps/{app-name}/` を作成
2. 仕様に合う構成で `index.html` / `app.js` / `style.css` を作成
3. `apps/{app-name}/AGENTS.md` にアプリ固有仕様を記載
4. `apps/index.html` にポータルカードを追加
5. `bash scripts/lint.sh` を実行

詳細な実装ルール、Firebase方針、デザインシステム、コンテンツガイドラインは [AGENTS.md](./AGENTS.md) を参照してください。

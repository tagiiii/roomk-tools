# roomK ツール群 — プロジェクト共通仕様

## プロジェクト概要

不登校の子どもや若者を対象としたオンラインメンタリングサービス「roomK」で使用するWebツール群。
メンター（スタッフ）が Zoom / Meet などで画面共有しながら参加者と一緒に使う。

**デプロイ先**: https://tagiiii.github.io/roomk-tools/
**リポジトリ**: https://github.com/tagiiii/roomk-tools

---

## ディレクトリ構成

```
roomk-tools/
├── apps/                        # GitHub Pages の配信ルート（./apps をデプロイ）
│   ├── index.html               # ツール一覧ポータル
│   ├── shared/                  # 全アプリ共通モジュール
│   │   ├── css/design-system.css
│   │   └── js/
│   │       ├── utils.js
│   │       └── firebase-config.js
│   ├── talk-card/               # トークテーマカード
│   ├── iisen-show/              # いいセンいきまSHOW!
│   ├── checkin/                 # チェックインアプリ
│   ├── vote/                    # 投票・集計アプリ
│   ├── word-wolf/               # ワードウルフ
│   └── name-change/             # 名前変えゲーム
├── docs/                        # ドキュメント類
└── shared/                      # ※旧配置（使用しない。apps/shared/ を使うこと）
```

### アプリのファイル構成パターン

バックエンドの種類によってファイル構成が異なる。

| パターン | 使用DB | ファイル構成 | 採用アプリ |
|---------|--------|------------|----------|
| **単一ファイル** | Realtime Database | `index.html` のみ（CSS・JS すべてインライン） | iisen-show, word-wolf, name-change |
| **分割ファイル** | Firestore | `index.html` + `app.js`（+ 必要なら `style.css`） | checkin, vote |
| **オフライン** | なし | `index.html` + `app.js` | talk-card |

### 新しいアプリを追加するとき

1. `apps/{app-name}/` フォルダを作成
2. 上表のパターンを参考にファイルを作成
3. `apps/index.html` のツール一覧にカードを追記
4. アプリ固有の仕様を `apps/{app-name}/CLAUDE.md` に記載

---

## 共通モジュール（`apps/shared/`）

### パスの書き方

アプリのサブフォルダから参照する場合（例: `apps/talk-card/`）:

```html
<!-- HTML -->
<link rel="stylesheet" href="../shared/css/design-system.css" />
<script type="module" src="app.js"></script>
```

```js
// JS (ESモジュール)
import { shuffle, copyToClipboard, popIn } from '../shared/js/utils.js';
import { db, auth } from '../shared/js/firebase-config.js';
```

### utils.js が提供する関数（M番号は design-system.css との対応）

| 関数 | 説明 |
|------|------|
| `copyToClipboard(text, btn?)` | M-2: クリップボードコピー + ボタンフィードバック |
| `shuffle(arr)` | M-3: Fisher-Yates シャッフル（元配列を変更しない） |
| `popIn(el)` | M-5: ポップインアニメーション（`.pop-in` クラスと連携） |
| `generateSessionId(length?)` | 6桁英数字のID生成（紛らわしい文字除外） |
| `getQueryParam(key)` | URLクエリパラメータの取得 |
| `setQueryParam(key, value)` | URLクエリパラメータの更新（リロードなし） |
| `formatDateTime(date)` | 日時を `YYYY/MM/DD HH:mm` 形式に変換 |
| `escapeHtml(str)` | XSS対策のHTMLエスケープ |
| `showToast(message, type?, duration?)` | トースト通知（success / error / info） |

### firebase-config.js

Firebase SDK v10.14.1 (compat ではなくモジュール版) で Firestore と匿名認証を初期化済み。

```js
import { db, auth } from '../shared/js/firebase-config.js';
// db: Firestore インスタンス
// auth: Auth インスタンス（匿名サインイン済み）
```

Realtime Database を使うアプリ（iisen-show など）は単一ファイルで独自に初期化している。

---

## デザインシステム（`design-system.css`）

### カラートークン（CSS変数）

| 変数 | 値 | 用途 |
|------|----|------|
| `--color-primary` | `#1C3F5E` | メインカラー（ネイビー） |
| `--color-accent` | `#2E7D8C` | アクセント（ティール） |
| `--color-bg` | `#F5F2EC` | ページ背景 |
| `--color-surface` | `#FFFFFF` | カード・ボックス背景 |
| `--color-text` | `#1A1A1A` | 本文テキスト |
| `--color-muted` | `#5A6270` | サブテキスト |
| `--color-border` | `#C4D2D8` | 区切り線 |
| `--color-success` | `#1F6E3C` | 成功・完了 |
| `--color-error` | `#B91C1C` | エラー |

### ボタンクラス（M-6）

```html
<button class="btn btn-primary">メインアクション</button>
<button class="btn btn-secondary">補助アクション</button>
<button class="btn btn-ghost">控えめな操作</button>
<button class="btn btn-danger">削除・危険操作</button>
<!-- サイズ修飾子 -->
<button class="btn btn-primary btn-sm">小</button>
<button class="btn btn-primary btn-lg">大</button>
<button class="btn btn-primary btn-full">横幅いっぱい</button>
```

### カードフリップ（M-4）

```html
<div class="flip-card">
  <div class="flip-card-inner">
    <div class="flip-card-face back">裏面</div>
    <div class="flip-card-face front">表面</div>
  </div>
</div>
```
`flip-card.classList.add('flipped')` でフリップ、`.dimmed` で薄くなる。

### その他の共通クラス

```html
<div class="card">          <!-- サーフェスカード -->
<span class="badge badge-primary">ラベル</span>
<div class="alert alert-info">メッセージ</div>
<div class="spinner"></div> <!-- ローディングスピナー -->
<hr class="divider">
```

---

## アイコン

**絵文字は使用しない。** Google Material Symbols Rounded (FILL=1) を使用する。

```html
<!-- head に追加 -->
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,1,0" rel="stylesheet">

<!-- 使用例 -->
<span class="material-symbols-rounded">home</span>
<span class="material-symbols-rounded">person</span>
<span class="material-symbols-rounded">check_circle</span>
```

アイコン名は https://fonts.google.com/icons で検索できる。

---

## Firebase

**プロジェクト**: `roomk-tools`
**プラン**: Spark（無料）。無料枠を超えない実装をすること。

### 使用するサービスと無料枠

| サービス | 無料枠 | 主な用途 |
|---------|--------|---------|
| Firestore | 1GB / 50,000読 / 20,000書 per日 | checkin, vote |
| Realtime Database | 1GB / 10GB転送 per月 | iisen-show, word-wolf, name-change |
| Auth（匿名） | 無制限 | ユーザー識別 |

### Realtime Database パス命名規則

**新しいアプリを追加するときもルール変更は不要。** 以下の命名規則に従うだけでよい。

```
{appname}_rooms/{roomCode}/...
```

| アプリ | パス |
|--------|------|
| iisen-show | `iisen_rooms/{roomCode}/` |
| word-wolf | `wordwolf_rooms/{roomCode}/` |
| name-change | `namechange_rooms/{roomCode}/` |
| （新アプリ例） | `newapp_rooms/{roomCode}/` |

#### 現在のセキュリティルール（変更不要）

```json
{
  "rules": {
    "$app_rooms": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

`$app_rooms` はワイルドカードで任意のトップレベルパスにマッチする。
新アプリを追加してもルールの更新は**一切不要**。

### その他のセキュリティ方針

- 読み取りは原則公開（認証不要なツールのため）
- ルームやセッションデータはゲーム・セッション終了後に削除する

### API キー

`AIzaSyC0bqQdDJeTAWrqFYqjOT1NsVFiunPemIw`
HTTP リファラー制限済み:
- `tagiiii.github.io/roomk-tools/*`
- `localhost/*`

---

## 共通実装ルール

全アプリで統一されているルール・パターンを以下にまとめる。

### ルームコード形式

| DB | 桁数 | 生成方法 | 採用アプリ |
|----|------|---------|----------|
| Realtime Database | **4桁**英数字 | 独自 `generateCode()`（紛らわしい文字除外） | iisen-show, word-wolf, name-change |
| Firestore | **6桁**英数字 | `generateSessionId()`（utils.js） | checkin, vote |

除外文字（紛らわしいもの）: `0`, `O`, `I`, `1` など

### ニックネーム制約

| 制約 | 内容 |
|------|------|
| 最大文字数 | 基本 **8文字**（name-change の参加者のみ12文字） |
| 同ルーム内重複 | **NG**（参加時にチェックして弾く） |
| 空文字 | **NG**（参加時にバリデーション） |

### 画面遷移パターン（Realtime Database アプリ）

```js
// 全スクリーンに .screen クラス、表示中のみ .active を付与
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  state.currentScreen = id;
}
```

画面IDの命名: `screen-{名前}` （例: `screen-top`, `screen-waiting`, `screen-voting`）

### ホスト識別方法

| DB | 識別方法 |
|----|---------|
| Realtime Database | Firebase の `players/{nick}/isHost: boolean` フィールド |
| Firestore | URL クエリパラメータ `?host=1`（認証なし） |

### ゲーム状態（status）の遷移パターン

Realtime Database アプリは `status` フィールドでフェーズを管理する。
Firebase リスナーで `status` の変化を検知して全員の画面を同期する。

```
// 典型的な遷移例
waiting → [ゲーム固有フェーズ] → done / finished
```

ホストのみが `status` を更新できる（UIで制御）。

### 切断時の挙動（Realtime Database アプリ）

| 役割 | 挙動 |
|------|------|
| **ホスト切断** | `onDisconnect().remove()` でルームごと削除。ゲストにはオーバーレイを表示 |
| **ゲスト切断** | `onDisconnect().remove()` でそのプレイヤーデータのみ削除 |

```js
// ホスト
db.ref(`{appname}_rooms/${code}`).onDisconnect().remove();

// ゲスト
db.ref(`{appname}_rooms/${code}/players/${nick}`).onDisconnect().remove();
```

### セッションデータの自動削除

ゲーム・セッション終了後は Firebase からデータを削除する。

```js
// ゲーム終了 → 30秒後に自動削除
async function hostFinish() {
  await roomRef.update({ status: 'done' });
  setTimeout(() => roomRef.remove(), 30000);
}
```

Firestore アプリも同様にセッション終了後に削除する。

### 再接続（sessionStorage）

Realtime Database アプリはページリロード時に sessionStorage から状態を復元する。

```js
// 保存
sessionStorage.setItem('{app}_session', JSON.stringify({ roomCode, nickname, isHost, ... }));

// 復元（window.load 時）
window.addEventListener('load', async () => {
  if (!await tryReconnect()) showScreen('top');
});

// TOPに戻るときにクリア
sessionStorage.removeItem('{app}_session');
```

### XSS 対策

ユーザー入力（ニックネーム・回答・名前など）を DOM に挿入する際は必ずエスケープする。

```js
// Realtime Database 単一ファイルアプリ（utils.js を使わない場合）
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Firestore アプリ（utils.js を使う場合）
import { escapeHtml } from '../shared/js/utils.js';
```

`innerHTML` への代入時は必ず `esc()` / `escapeHtml()` を通す。`textContent` への代入は不要。

### 最小参加人数

| 人数 | 適用アプリ |
|------|----------|
| 2人以上 | name-change |
| 3人以上 | iisen-show, word-wolf |
| 制限なし | talk-card, checkin, vote |

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

---

## 開発・デプロイ

### ローカル確認

```bash
cd apps
python3 -m http.server 8080
# → http://localhost:8080/{app-name}/
```

### デプロイ

`main` ブランチにプッシュすると GitHub Actions が自動で GitHub Pages にデプロイする。
（`.github/workflows/deploy.yml` — `apps/` フォルダを配信ルートとして設定済み）

### フォント

```html
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet" />
```

design-system.css の `--font-base` に設定済みのため、body に自動適用される。

---

## 各アプリの詳細仕様

各アプリ固有のルールは `apps/{app-name}/CLAUDE.md` を参照。

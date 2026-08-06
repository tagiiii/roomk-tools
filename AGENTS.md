# room-K ツール群 — プロジェクト共通仕様

## プロジェクト概要

不登校の子どもや若者を対象としたオンラインメンタリングサービス「room-K」で使用するWebツール群。
メンター（スタッフ）が Zoom / Meet などで画面共有しながら参加者と一緒に使う。

**デプロイ先**: https://tagiiii.github.io/roomk-tools/
**リポジトリ**: https://github.com/tagiiii/roomk-tools

---

## ディレクトリ構成

```
roomk-tools/
├── apps/                        # GitHub Pages の配信ルート（./apps をデプロイ）
│   ├── index.html               # ツール一覧ポータル
│   ├── updates.json             # 更新情報の正本（ポータルが描画）
│   ├── guide/                   # スタッフ向け「ゲームえらび早見表」
│   ├── shared/                  # 全アプリ共通モジュール
│   │   ├── css/design-system.css
│   │   └── js/
│   │       ├── utils.js         # ESモジュール（Firestore/オフラインアプリ用）
│   │       ├── rtdb-utils.js    # 通常スクリプト（RTDB 単一ファイルアプリ用）
│   │       ├── howto.js         # 通常スクリプト（あそびかたモーダル・全アプリ）
│   │       └── firebase-config.js
│   └── {app-name}/ × 約50       # 各アプリ（一覧はポータル、選び方は apps/guide/）
├── docs/                        # ドキュメント類（正本の地図は下記「ドキュメントの正本」）
├── scripts/                     # lint / コンテンツ監査 / バリデータ
└── shared/                      # ※旧配置（使用しない。apps/shared/ を使うこと）
```

### 改名済みアプリ（リダイレクトスタブ）

改名したアプリは、旧 URL を残すため旧フォルダに `<meta http-equiv="refresh">` のスタブだけを置いている。
**スタブを実装だと思って編集しない。** 実装・`AGENTS.md`・`slides.html` はすべて新フォルダ側にある。

| 旧フォルダ（スタブ） | 実装のある新フォルダ |
|---|---|
| `apps/codenames/` | `apps/kotoba-tantei/`（ことば探偵） |
| `apps/hint-de-pinto/` | `apps/kaburazu-hint/`（かぶらずヒント） |
| `apps/iisen-show/` | `apps/do-mannaka/`（ドまんなか） |
| `apps/ito/` | `apps/tatoe-narabe/`（たとえならべ） |
| `apps/sukina-map/` | `apps/suki-type-check/`（すきタイプチェック） |

スタブは `scripts/lint.sh` の `HOWTO_EXEMPT` に登録済み（あそびかたモーダル不要）。

### ドキュメントの正本

| 文書 | 何の正本か |
|---|---|
| `AGENTS.md`（本ファイル） | 仕様・実装ルール。迷ったらまずここ |
| `apps/{app}/AGENTS.md` | アプリ固有仕様と**共通規約からの意図的な逸脱** |
| `docs/ai-roles.md` | AI の役割定義とガードレールの区分（モデル固有名を書く唯一の場所） |
| `docs/kaizen-backlog.md` | 改善ループの運用ルール・Tier 区分・判断待ちキュー |
| `docs/audit-prompts.md` | 監査プロンプトのカタログ（発見専用・観点別 P1〜P9） |
| `.claude/skills/` | 手順の抜け漏れ防止チェックリスト（規約本文は転載しない） |

### アプリのファイル構成パターン

バックエンドの種類によってファイル構成が異なる。

| パターン | 使用DB | ファイル構成 | 採用アプリ |
|---------|--------|------------|----------|
| **単一ファイル** | Realtime Database | `index.html` のみ（CSS・JS インライン、共有 `rtdb-utils.js` は参照可） | do-mannaka, word-wolf, name-change |
| **分割ファイル** | Firestore | `index.html` + `app.js`（+ 必要なら `style.css`） | checkin, vote |
| **オフライン** | なし | `index.html` + `app.js` | talk-card |

### 新しいアプリを追加するとき

1. `apps/{app-name}/` フォルダを作成
2. 上表のパターンを参考にファイルを作成
3. `apps/index.html` のツール一覧にカードを追記（下記「利用シーンタグ」の `data-scenes` を必ず付ける）
4. アプリ固有の仕様を `apps/{app-name}/AGENTS.md` に記載
5. `apps/updates.json` の先頭に更新情報を追記（下記「更新情報」参照）
6. 共通の「あそびかた／つかいかた」モーダル（`shared/js/howto.js`、下記参照）を組み込む
7. `apps/guide/` の早見表（スタッフ向け「ゲームえらび早見表」）に1行追加

### アプリ名のつけかた

- 表示名・フォルダ名（URL）とも、実在のゲーム・番組・商品の名称やそのもじりは使わず、オリジナルの名前をつける（権利面の配慮。既存名の使用可否を個別に判断しない）
- 遊びの動きがそのまま伝わる、ひらがな・カタカナ中心の短い名前にする（例: ピタハメ、おしつけずかん、かぶらずヒント）
- 着想元の市販ゲームがある場合は、名前ではなく `updates.json` の紹介文と `apps/guide/`（スタッフ向け早見表）で「『◯◯』から着想」と記述的に紹介する。「Web版」「オンライン版」「無料版」等の表現は使わない

### 利用シーンタグ（ポータルの絞り込み）

ポータルのカードは `data-scenes` 属性で利用シーンを持ち、上部のフィルタチップで
絞り込める。シーンバッジはこの属性から自動描画されるので、カード HTML にバッジを
手書きしない。1つのツールが複数シーンに属してよい（スペース区切り）。
`data-scenes` の有無とキーの妥当性は lint（PORTAL-2）で検証される。

選択中のシーンは URL ハッシュと同期する（例: `…/apps/#scene=bodoge`）。
シーン別リンクとしてチャットに貼れば、そのシーンで絞り込んだ状態で開ける。

```html
<a class="app-card" href="{app-name}/" data-scenes="hiroba sakusen">
```

| キー | シーン |
|------|--------|
| `kotoba` | コトバであそぼ！（国語ワークショップ） |
| `bodoge` | ボドゲクラブ |
| `hiroba` | ひろば（フリータイム・常設） |
| `circle` | サークルタイム（チェックイン→ジブンチェック→みんなで遊ぶ→翌日の案内。10人程度） |
| `sakusen` | 作戦会議（週1回30分の1on1。内面ツールと3〜4人の少人数遊びを含む） |

### 更新情報（`apps/updates.json`）

ポータル上部の「更新情報」欄と、アプリカード右上の NEW / 更新 フラグ（直近14日）は
`apps/updates.json` から自動描画される。**新しいアプリの追加時と、既存アプリへの
お題・問題の追加や機能改修時に、配列の先頭へ1エントリ追記する。**

```json
{ "date": "2026-07-06", "app": "minna-ranking", "type": "new", "text": "「みんなでランキング」を追加。……" }
```

| フィールド | 内容 |
|-----------|------|
| `date` | `YYYY-MM-DD` 形式 |
| `app` | `apps/{app}/` のフォルダ名。複数アプリ横断の更新は `null` |
| `type` | 新アプリは `"new"`、既存アプリの拡充・改修は `"update"` |
| `text` | 1行の説明。**スタッフ向けなので漢字表記でよい**（子ども向け文言ルールの対象外） |

軽微な bugfix やリファクタリングは追記不要。スタッフに知らせたい変化（新アプリ・お題追加・見た目や遊び方が変わる改修）だけを書く。

---

## 共通モジュール（`apps/shared/`）

### パスの書き方

アプリのサブフォルダから参照する場合（例: `apps/talk-card/`）:

```html
<!-- HTML -->
<link rel="stylesheet" href="../shared/css/design-system.css" />
<script type="module" src="app.js"></script>
```

Realtime Database の単一ファイルアプリでは、Firebase SDK の後・メインのインライン `<script>` の前に通常スクリプトとして読み込む。

```html
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-database-compat.js"></script>
<script src="../shared/js/rtdb-utils.js"></script>
<script>
  // Firebase 初期化とアプリ本体
</script>
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

### rtdb-utils.js（非モジュール通常スクリプト）

Realtime Database 単一ファイルアプリ向けの共有ヘルパー。`window.RoomkRTDB` 名前空間に公開する。
**後方互換で追加のみ。破壊的変更をする場合は `?v=` 付き読み込みに切り替えること。**

| API | 説明 |
|-----|------|
| `initServerTime(db)` | `db.ref('.info/serverTimeOffset')` を購読し、共有JS内部に時刻オフセットを保持 |
| `now()` | `Date.now() + offset` を返す（未初期化時は offset 0） |
| `getHostDisconnectedAt(room)` | `room.hostDisconnectedAt` を数値化し、有効なら timestamp、無効なら `null` |
| `isRoomExpired(room, ttlMs = 2 * 60 * 1000)` | `hostConnected === false` かつ TTL 超過なら `true` |
| `generateRoomCode(length = 6)` | 紛らわしい文字を除外した英数字ルームコードを生成 |
| `esc(value)` | XSS対策のHTMLエスケープ（シングルクォートを含む） |
| `initFirebase(firebase)` | Firebase compat SDKを共通設定で初期化し、`{ authReady, db }` を返す。サーバー時刻補正も開始 |
| `cancelRoomOnDisconnect(ref)` | `ref` へ予約した `onDisconnect` を接続単位でまとめて取り消す。room を `remove()` する経路では必ず await して remove の前に呼ぶ（ゴースト room 防止） |
| `showToast(message, isError = true, durationMs = 3000)` | CSS依存なしの固定表示トースト（DOM id: `roomk-toast`） |

### howto.js（非モジュール通常スクリプト）

全アプリ共通の「あそびかた／つかいかた」モーダル。右下の「？」FAB からボトムシート型モーダルを開く。
CSS はスクリプトが自己注入するため、読み込みと `init()` 呼び出しだけでよい。
**後方互換で追加のみ。破壊的変更をする場合は `?v=` 付き読み込みに切り替えること。**

```html
<!-- </body> 直前・既存スクリプトの後に追加。Material Symbols のリンクが head に必要 -->
<script src="../shared/js/howto.js"></script>
<script>
  RoomkHowto.init({
    title: 'あそびかた',   // ゲーム系。内省・実用ツール系は「つかいかた」
    lead: 'どんなアプリかを1〜2文で。',
    sections: [
      { heading: 'はじめかた', items: ['「ルームを作る」を押す'] },  // items は ol で描画
      { heading: 'すすめかた', items: ['…'] },
      { heading: 'おわりかた', text: '文章のみの段落も書ける。' },
    ],
    position: 'right',    // 既存の固定右下要素と衝突する場合のみ 'left'
  });
</script>
```

文言ルール:
- 読者は子ども。ボタン名は画面の実際のラベルを「」で正確に引用する
- **メンター向けの注意書き・声かけのコツは書かない**（AGENTS.md にのみ書く）
- 分量はスクロールなしで読み切れる程度（lead 1〜2文 + 各セクション1〜4項目）
- 新しいアプリを追加するときも必ず組み込む

### firebase-config.js

Firebase SDK v10.14.1 (compat ではなくモジュール版) で Firestore と匿名認証を初期化済み。

```js
import { db, auth } from '../shared/js/firebase-config.js';
// db: Firestore インスタンス
// auth: Auth インスタンス（匿名サインイン済み）
```

Realtime Database を使う単一ファイルアプリは、Firebase compat SDK 読み込み後に `RoomkRTDB.initFirebase(firebase)` で初期化する。移行前のアプリは従来の個別初期化を維持し、動作確認しながら段階的に切り替える。

### stats.js（非モジュール通常スクリプト）

利用回数の匿名カウンタ。改善の判断材料として「どのアプリ・どのコンテンツがどれくらい使われたか」の**回数だけ**を記録する。
**後方互換で追加のみ。破壊的変更をする場合は `?v=` を上げること。**

```html
<!-- 全アプリの index.html に入れる（howto.js の直前が定位置。ポータルのみ shared/js/stats.js） -->
<script src="../shared/js/stats.js?v=1" defer></script>
```

- 読み込むだけで起動回数（項目 `open`）を1加算する。アプリ名は URL パスから自動判定
- コンテンツ単位で数えたい箇所では `window.RoomkStats?.count('項目名')` を呼ぶ（例: quiz のパック選択 `pack-{id}`、kotoba-asobo のセッション開始 `session-{id}`）。**必ずオプショナルチェーンで呼ぶ**（スクリプトがブロックされてもアプリを壊さない）
- 記録先は Realtime Database `stats/{アプリ名}/{YYYY-MM}/{項目}`。既存のセキュリティルール（ワイルドカード）で書けるためルール変更は不要
- **記録するのは回数のみ。** UID・ニックネーム・自由入力の内容は絶対に記録しない。計測値やランキングを子ども向け画面に表示しない
- localhost からは送信しない（動作確認したいときだけ `localStorage.setItem('roomk-stats-force', '1')`）
- 集計の閲覧は Firebase コンソールの Realtime Database で `stats` ノードを開く
- 新しいアプリを追加するときも必ず組み込む（リダイレクトスタブは除く）

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

`hidden` 属性は design-system.css の `[hidden] { display: none !important; }` により
`.btn` 等の display 指定より必ず優先される（2026-08-06 共通化。アプリ側で
`[hidden]` の打ち消しルールを個別に持つ必要はない）。

### ボタン階層の定石（1画面1主ボタン）

同じ画面にボタンを複数置くときは、強さを3段階で分ける。**同格の枠線ボタンを
3つ以上並べない**（強弱がなく「バラバラ」に見える。tsuyomi-card 刷新で確立）。

| 段階 | 見た目 | クラス | 用途 |
|------|--------|--------|------|
| 主 | 塗りつぶし | `.btn-primary` | その画面の目的となる操作。**1画面に1つだけ** |
| 副 | 枠線 | `.btn-secondary` | 条件付きで出る補助操作（例: 途中終了時のみの「つづきを見る」） |
| 弱 | テキストリンク風 | アプリ固有（例: `.ty-quiet-btn`） | ナビゲーション系（もどる・最初から・ここまで） |

- 縦に積むときは幅を揃える（主・副は同幅、弱は中央寄せの小さめテキスト）
- 選択肢を同格に見せたい場面（3択・5件法など）は例外。その場合は**全部を同じ
  見た目**にし、主ボタンと混ぜない（suki-type-check の5件法・tsuyomi-card の3択）

### トップ画面の定石（パネル1枚構成）

オフライン系ツールのトップは**パネル1枚**にまとめる（suki-type-check /
tsuyomi-card で実証済みの型）。

1. タイトル
2. 説明文（何が起きるか＋分量・所要時間の目安）
3. 注意点の箇条書き 2〜3個（「正解はない」「まよったら〜でOK」など）
4. 「はじめる」（主ボタン。トップのボタンはこれ1つだけ）
5. 保存の有無（「答えた内容はどこにも保存されない」等）

あそびかたのインライン展開パネルは置かず、説明は howto.js のモーダルに一本化する。

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

### CSS 命名規則（アプリ固有スタイル）

アプリ固有の CSS クラスには **アプリ名の短縮接頭辞** を付け、**BEM 記法**（`block__element`）で命名する。

| アプリ | 接頭辞 | 例 |
|--------|--------|-----|
| talk-card | `.tc-` | `.tc-header__title` |
| word-wolf | `.ww-` | `.ww-header__icon` |
| do-mannaka | `.is-` | `.is-score__label` |
| name-change | `.nc-` | `.nc-panel__btn` |
| jitsuwa-game | `.jitsuwa-` | `.jitsuwa-hero__sub` |
| （新アプリ） | 2〜4文字 + `-` | — |

design-system.css のカラー変数・スペーシング変数を積極的に再利用し、独自の固定値はなるべく使わない。

**レスポンシブ対応のブレークポイント**: `600px` 以下でモバイル向けスタイルを上書き。

```css
@media (max-width: 600px) {
  .wrapper { padding: 28px 16px 60px; }
}
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
| Realtime Database | 1GB / 10GB転送 per月 | do-mannaka, word-wolf, name-change |
| Auth（匿名） | 無制限 | ユーザー識別 |

### Realtime Database パス命名規則

**新しいアプリを追加するときもルール変更は不要。** 以下の命名規則に従うだけでよい。

```
{appname}_rooms/{roomCode}/...
```

| アプリ | パス |
|--------|------|
| do-mannaka | `domannaka_rooms/{roomCode}/` |
| word-wolf | `wordwolf_rooms/{roomCode}/` |
| name-change | `namechange_rooms/{roomCode}/` |
| （新アプリ例） | `newapp_rooms/{roomCode}/` |

#### 現在のセキュリティルール（変更不要）

正本は [database.rules.json](./database.rules.json)。読み書きとも**匿名認証が必須**。

```json
{
  "rules": {
    "$app_rooms": {
      "$roomId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

`$app_rooms` はワイルドカードで任意のトップレベルパスにマッチする。
新アプリを追加してもルールの更新は**一切不要**。

### その他のセキュリティ方針

- 読み書きには匿名認証（`auth != null`）が必要。アプリ側は `signInAnonymously` の完了を **await してから** RTDB にアクセスする（rtdb-utils.js の `authReady` を使用）
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
| Realtime Database | **6桁**英数字 | `RoomkRTDB.generateRoomCode()`（必要に応じてローカル alias） | do-mannaka, word-wolf, name-change, jinro, tatoe-narabe |
| Firestore | **6桁**英数字 | `generateSessionId()`（utils.js） | checkin, vote |

除外文字（紛らわしいもの）: `0`, `O`, `I`, `1` など

### ニックネーム制約

| 制約 | 内容 |
|------|------|
| 最大文字数 | 基本 **8文字**（name-change の参加者のみ12文字） |
| 同ルーム内重複 | **NG**（参加時にチェックして弾く） |
| 空文字 | **NG**（参加時にバリデーション） |

### viewport 設定（Realtime Database アプリ）

Realtime Database アプリでは、ゲーム中の誤ズームで操作が崩れることを防ぐため `maximum-scale=1` を指定する。
`maximum-scale=1` はアクセシビリティ上は推奨されない指定だが、room-K ツールでは画面共有中の安定した進行を優先する。

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1">
```

### 状態管理オブジェクト（Realtime Database アプリ）

アプリ全体の状態を `const state = { ... }` にまとめる。最低限以下のフィールドを持つ。

```js
const state = {
  // ユーザー情報
  role: null,           // 'host' | 'guest'
  nickname: null,
  roomCode: null,
  roomRef: null,        // Firebase 参照（db.ref(...)）

  // 画面管理
  currentScreen: null,  // showScreen() が更新する

  // クリーンアップ用
  timerInterval: null,  // setInterval の ID → 退出時に clearInterval
};
```

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

### Realtime Database 実装ルール

Realtime Database アプリでは、ルーム作成・参加・ゲーム開始の各タイミングで
read-then-write を避け、`transaction()` で原子的に状態を確定する。

```js
// ルーム作成: 空きコードの確保を transaction() で行う
const ref = db.ref(`{appname}_rooms/${code}`);
const { committed } = await ref.transaction((room) => room ? undefined : initialRoom);

// 参加: status チェックと players 追加を同じ transaction() に含める
const { committed } = await roomRef.transaction((room) => {
  if (!room || room.status !== 'waiting') return;
  const players = room.players || {};
  if (players[nick]) return;
  return { ...room, players: { ...players, [nick]: newPlayer } };
});
```

- ルームコード確保は「存在確認してから `set()`」ではなく、ルームルートに対する `transaction()` で行う
- 参加処理は `status` 判定と `players` 追加を別々にしない
- ゲーム開始時に参加者一覧を固定する処理も、読み取り後の `update()` ではなくルーム全体 `transaction()` で行う
- `status` はアプリ内で定数化することを推奨する
- `leaveGame()` / `goToTop()` では `setInterval()` / `setTimeout()` / overlay 状態を必ず片付ける

### 切断時の挙動（Realtime Database アプリ）

| 役割 | 挙動 |
|------|------|
| **ホスト切断** | `hostConnected=false` と `hostDisconnectedAt=ServerValue.TIMESTAMP` を保存。ゲストにはオーバーレイを表示し、TTL 超過後は期限切れ扱いにする |
| **ゲスト切断** | `onDisconnect().remove()` でそのプレイヤーデータのみ削除 |

```js
// ホスト
db.ref(`{appname}_rooms/${code}`).onDisconnect().update({
  hostConnected: false,
  hostDisconnectedAt: firebase.database.ServerValue.TIMESTAMP,
});

// ゲスト
db.ref(`{appname}_rooms/${code}/players/${nick}`).onDisconnect().remove();
```

再接続をサポートするアプリでは、ホスト側で `onDisconnect().remove()` を使わない。
通常リロードでも切断扱いになるため、復帰フローと両立しない。

### セッションデータの自動削除

ゲーム・セッション終了後は Firebase からデータを削除する。

```js
// ゲーム終了 → 30秒後に自動削除
async function hostFinish() {
  await roomRef.update({ status: 'done' });
  setTimeout(async () => {
    // 削除の前に自接続の onDisconnect 予約を必ず取り消す。予約が残ったままだと、
    // 削除後にタブを閉じた時に update が発火してゴースト room を再生成する
    await RoomkRTDB.cancelRoomOnDisconnect(roomRef);
    roomRef.remove();
  }, 30000);
}
```

Firestore アプリも同様にセッション終了後に削除する。

ホスト切断後の孤立ルーム対策として、Realtime Database アプリは
`hostDisconnectedAt` を使った TTL 判定も持つ。
全員離脱後の完全自動削除はクライアントだけでは保証できないため、
「期限切れ扱い + 次回アクセス時に削除」を基本方針とする。

```js
const ORPHAN_TTL_MS = 2 * 60 * 1000; // 推奨: 2分（lint [REF-4] で検出）

function isRoomExpired(room) {
  // status を持たない room は、削除後に onDisconnect が発火して再生成された
  // ゴースト（部分 room）。TTL を待たず期限切れ扱いにして掃除する
  return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
}
```

TTL は **2分（`2 * 60 * 1000`）に統一**する。短すぎると一時的な通信切れで誤って期限切れになり、長すぎると孤立ルームが残る。スタッフが Zoom を切り替える程度の中断は吸収しつつ、本当の離脱は次の参加時までに片付く長さとして 2分 を採用している。ゲーム中フェーズで意図的に長く取りたい場合（例: `name-change` の `ORPHAN_TTL_INGAME_MS = 30分`）は別定数で持つ。

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

再接続ありの Realtime Database アプリでは、Firebase 初期化直後にサーバー時刻補正を開始し、時刻計算は `RoomkRTDB.now()` を使う。

```js
const { authReady, db } = RoomkRTDB.initFirebase(firebase); // サーバー時刻補正も開始する
const getEstimatedServerNow = RoomkRTDB.now;
```

個別初期化から未移行のアプリだけは、従来どおり `RoomkRTDB.initServerTime(db)` を明示的に呼ぶ。

- TTL 判定は `Date.now()` のみで行わず、`RoomkRTDB.now()` / `RoomkRTDB.isRoomExpired()` でサーバー時刻寄りに補正する
- `joinRoom()`、`tryReconnect()`、ルーム監視の各タイミングで期限切れルームを検知し、`remove()` を試みる
- ホスト再接続時は `hostConnected=true` と `hostDisconnectedAt=null` を戻す

### XSS 対策

ユーザー入力（ニックネーム・回答・名前など）を DOM に挿入する際は必ずエスケープする。

```js
// Realtime Database 単一ファイルアプリ
const esc = RoomkRTDB.esc;

// Firestore アプリ（utils.js を使う場合）
import { escapeHtml } from '../shared/js/utils.js';
```

`innerHTML` への代入時は必ず `esc()` / `escapeHtml()` を通す。`textContent` への代入は不要。

### 最小参加人数

| 人数 | 適用アプリ |
|------|----------|
| 2人以上 | name-change |
| 3人以上 | do-mannaka, word-wolf |
| 制限なし | talk-card, checkin, vote |

### 選択肢・カードの番号付け

参加者が画面共有越しにチャット・口頭で「2番！」と答えられるよう、**複数の選択肢を一覧表示する画面では番号を付ける**。

#### 番号は丸数字（`①②③`）で統一

```js
const NUMBERS = ['①', '②', '③', '④', '⑤'];
```

- 半角数字 + ピリオド（`1.`）ではなく丸数字を使う（room-K 内で統一）
- 配列の index から自動採番する（3択以外にも拡張できるよう）
- 5つ以上の選択肢が必要な場合は配列を拡張する

#### 適用する画面

- クイズの選択肢（quiz, kyoumi-sugoroku など）
- ホストが複数のお題から選ぶカード（do-mannaka, tatoe-gp, jitsuwa-game, ishin-denshin など）
- 「自由に話す」など特殊扱いの選択肢には番号を付けない

#### マークアップとスタイル

番号とテキストを別 `span` に分けて flex レイアウトで配置する。番号はアクセントカラー。

```html
<button class="xx-choice">
  <span class="xx-choice__num">①</span>
  <span class="xx-choice__text">選択肢のテキスト</span>
</button>
```

```css
.xx-choice {
  display: flex;
  align-items: center; /* または flex-start */
  gap: 10px;
  text-align: left;
}
.xx-choice__num {
  color: var(--color-accent);
  font-weight: 700;
  font-feature-settings: "palt";
  flex-shrink: 0;
}
.xx-choice__text {
  flex: 1;
}
```

#### チャット貼り付け用コピー機能

「問題をコピー」「答えをコピー」など、チャット貼り付け用のテキスト生成機能がある場合も同じ `①②③` 形式で出力する（UIとコピー先で表記を一致させる）。

```js
choices.forEach((c, i) => lines.push(`${NUMBERS[i]} ${c}`));
```

#### アクセシビリティ

選択肢が画像やアイコンを含む場合は `aria-label` で番号と内容を明示する。

```js
btn.setAttribute('aria-label', `${i + 1}番のお題: ${topic}`);
```

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

### 表記トーン（2026-08-06 方針）

- **1対1面談系（メンター同席で読み上げできるツール）は通常表記（漢字まじり）を標準とする**。
  ひらがな分かち書きは中学生に幼い印象を与えるため（先行例: tsuyomi-card 刷新）
- **子どもがひとりで読む前提のツール**（自由時間・ボドゲ・ことば系）は、
  ひらがな中心・やわらかい表記を維持する
- **語彙そのものがコンテンツであるもの**（kimochi-map の感情語彙72語など）は
  表記方針の対象外。意味・ニュアンス・読みやすさを変えない
- 漢字は小中学生が読める常用範囲にとどめる。読み上げ運用は各アプリの AGENTS.md
  「メンター向けの心得」に明記する
- 文体（です・ます／である 等）は各アプリの既存トーンを踏襲し、表記だけを変える

---

## 開発・デプロイ

### チェック（コード・コンテンツを触ったら必ず実行）

```bash
bash scripts/lint.sh
```

セキュリティ・規約違反・ポータル整合を機械チェックする。**エラー0・新規警告なしが基準**（現在は警告ゼロで通る状態を維持している）。
RTDB アプリを新規追加したら `scripts/lint.sh` の `RTDB_HTML_FILES` 配列にも追加する。

お題・問題などのコンテンツを触った場合は重複監査も実行する。

```bash
node scripts/content-audit.mjs
```

その他: `scripts/validate-kotoba-asobo.mjs`（kotoba-asobo のデータ検証）、`scripts/draft-lint.sh`（`drafts/` 配下のプロトタイプ用）。

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

各アプリ固有のルールは `apps/{app-name}/AGENTS.md` を参照。

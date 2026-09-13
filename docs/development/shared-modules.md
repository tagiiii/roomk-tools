# shared-modules — room-K 実装資料

共通の権限・品質基準は [AGENTS.md](../../AGENTS.md)。本文のコードパスはリポジトリルート基準。該当機能を実装・変更・監査するときだけ読む。アプリ固有の明文化された例外を尊重する。

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
| `showFormError(id, message)` | フォーム内のエラーを表示。空文字でクリア |
| `copyRoomCode(code, button?)` | コード単体をコピーし、成功・失敗を通知。Clipboard API が使えない場合は代替コピーを試す |
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
- コンテンツ単位で数えたい箇所では `window.RoomkStats?.count('項目名')` を呼ぶ（例: quiz のパック選択 `pack-{id}`）。**必ずオプショナルチェーンで呼ぶ**（スクリプトがブロックされてもアプリを壊さない）
- 記録先は Realtime Database `stats/{アプリ名}/{YYYY-MM}/{項目}`。既存のセキュリティルール（ワイルドカード）で書けるためルール変更は不要
- **記録するのは回数のみ。** UID・ニックネーム・自由入力の内容は絶対に記録しない。計測値やランキングを子ども向け画面に表示しない
- localhost からは送信しない（動作確認したいときだけ `localStorage.setItem('roomk-stats-force', '1')`）
- 集計の閲覧は Firebase コンソールの Realtime Database で `stats` ノードを開く
- 新しいアプリを追加するときも必ず組み込む（リダイレクトスタブは除く）

---

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
| `copyRoomCode(code, button?)` | コード単体をコピーし、成功・失敗を通知。Clipboard API が使えない場合は代替コピーを試す（内部は `copyText`） |
| `copyText(value, button?, okMessage, failMessage)` | 任意の文字列をコピーし、成功・失敗をトーストで通知（連打ガード・代替コピーつき。2026-10-05 追加） |
| `roomLink(code)` | 参加用のリンク `location.origin + location.pathname + '?room=' + code` を返す（2026-10-05 追加） |
| `copyRoomLink(code, button?, link?)` | 参加用のリンクをコピーし、成功「参加用のリンクをコピーしました」／失敗を通知。`link` を渡すとそのアドレスをコピーする（独自パラメータを引き継ぐアプリ用）。仕様は [rtdb.md](rtdb.md)「参加用のリンク」（2026-10-05 追加）。同じリンクを QR コードで出すのは room-qr.js |
| `generateRoomCode(length = 6)` | 紛らわしい文字を除外した英数字ルームコードを生成 |
| `esc(value)` | XSS対策のHTMLエスケープ（シングルクォートを含む） |
| `initFirebase(firebase)` | Firebase compat SDKを共通設定で初期化し、`{ authReady, db }` を返す。サーバー時刻補正も開始 |
| `cancelRoomOnDisconnect(ref)` | `ref` へ予約した `onDisconnect` を接続単位でまとめて取り消す。room を `remove()` する経路では必ず await して remove の前に呼ぶ（ゴースト room 防止） |
| `showToast(message, isError = true, durationMs = 3000)` | CSS依存なしの固定表示トースト（DOM id: `roomk-toast`） |

### room-qr.js（非モジュール通常スクリプト）

参加用のリンクを QR コードにして画面の上に大きく出す（「QRコードを出す」ボタン用。2026-10-22 追加）。`window.RoomkQR` 名前空間に公開する。
CSS はスクリプトが自己注入する。RTDB アプリは rtdb-utils.js の直後、Firestore アプリ（ことば探偵）はアプリ本体より前に `<script src="../shared/js/room-qr.js?v=20261022"></script>` で読む。
QR を作るライブラリ `vendor/qrcode-generator-2.0.4.js`（Kazuhiko Arase、MIT。npm の配布物をそのまま置いた）は、初めて開くときに room-qr.js と同じ場所から読み込む。
**後方互換で追加のみ。**

| API | 説明 |
|-----|------|
| `show(code, link?, options?)` | QR とルームコードを重ねて出す。`options.showCode: false` でルームコードを出さない（画面に出していない秘密のカギを使う作戦会議チャット用）。`link` を省くと `location.origin + location.pathname + '?room=' + code`。`code` が空ならトースト「ルームコードがありません」（RoomkRTDB があるとき）で `false`。「とじる」・Esc・外側で閉じ、押したボタンへフォーカスを戻す。背景は inert。ライブラリを読み込めなければ「リンクをコピー」を案内する |
| `close()` | 開いていれば閉じる |

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
    slides: 'slides.html', // 説明スライドがあるアプリだけ（任意）
  });
</script>
```

`slides` を指定すると、モーダルの先頭に「説明スライドを見る」ボタンが出る（2026-10-20 追加）。
スライドは別タブでなく、今のページの上に重ねて iframe で開く。画面共有しているタブが変わらず、
ルームの接続もそのまま。「スライドを閉じる」か Esc で元の画面に戻り、もう一度開くと見ていたページから続く。
アプリ側のボタンから開くときは `RoomkHowto.openSlides()`（`slides` 指定の `init` の後で使える。指定がなければ何もしない）。
slides.html があるアプリは `slides` 指定とポータルの `data-slides` の両方を付ける（`lint.sh` の HOWTO-2 が抜けを警告する）。

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

#### ルーム型で共通に使う項目名（2026-10-12）

起動回数（`open`）は端末と読み込みの数なので、ルーム型では何回遊ばれたかが分からない。遊ばれ方を見るときは次の項目名にそろえる。
導入済み: ルーム型の全30本（2026-10-12。`scripts/lint.sh` の `RTDB_HTML_FILES` の29本と、Firestore の kotoba-tantei）。「1回」の単位と数える場所は、各アプリの `AGENTS.md`「利用回数」。

- 「1回」が1ゲームのアプリ（始めてから最後の結果まで。もう一度あそぶ型）: （career-sugoroku・esadori・jinro・kaburazu-hint・kagi-awase・kotoba-pair・kotoba-tantei・name-change・oekaki-dengon・oshitsuke-zukan・pita-hame・quiz・stamp-ate・suki-bingo・tatoe-narabe・word-wolf）
- 「1回」が1ラウンド（1問・1つのお題・1場面・1周）のアプリ（ホストが好きなところで終える型）: blackjack・do-mannaka・ikutsu-ieru・kakure-number・kimochi-ate・koedake-theater・kossori-word・magire-eshi・minna-ranking・moji-soroe・pittari-meter・shirushi-hint・tatoe-gp・toomawashi・uso-jisho
- name-change は同じルームでの「もう一度」がないので `again` を数えない
- 以前からある項目（`round`・`pack-*`・`theme-*`・`room-start`・`start-room`・`start-local`・`solo-start`）は、過去の数字と続けて見るために残している。新しいアプリは共通の項目名だけでよい

| 項目 | 数えるとき | 分かること |
|---|---|---|
| `room-create` | ルームができた | セッションの数 |
| `start` | 1回のゲーム（ラウンドをくり返すアプリは1ラウンド）が始まった | 遊ばれた回数。始まったルームの数は、おおよそ `start − again` |
| `players-{N}` | `start` と同時。N はそのときの遊ぶ人の人数（進行だけのホストは含めない） | 実際に遊ばれている人数 |
| `finish` | その回の結果の画面まで進んだ | 最後まで進んだ割合（`finish ÷ start`） |
| `again` | 結果のあと、続けてもう1回を選んだ（もう一度あそぶ／次のラウンドへ） | 続けて遊ばれた割合（`again ÷ finish`） |

- 待合室を通らずに次の回が始まる操作（「次のラウンドへ」、そのまま始まる「もう一度」）は、`again` と `start`・`players-{N}` を同時に数える。待合室に戻る操作は `again` だけを数え、次の `start` は始めたときに数える

- **数えるのは、その進行を確定させた1台だけ**。transaction の `committed` のあと（または確定前の状態を確かめたうえ）で呼び、二度押し・再接続・再読み込みで二重に数えない。画面の描画やリスナーの中では呼ばない（全員の回答・投票がそろうと自動で進む処理のようにリスナーから始まる進行は、その書き込みを確定させたあとでだけ数える）
- 途中でやめた・不成立になった回は `finish` を数えない
- 二重に数えないことを優先する。確定の応答を受け取る前に通信が切れたときなどは、進んでいても数え漏れることがある（少なめに出る側の誤差として読む）
- 人数は回数の項目名に入れるだけで、だれが遊んだかは記録しない

---

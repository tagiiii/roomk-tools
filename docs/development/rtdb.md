# rtdb — room-K 実装資料

共通の権限・品質基準は [AGENTS.md](../../AGENTS.md)。本文のコードパスはリポジトリルート基準。該当機能を実装・変更・監査するときだけ読む。アプリ固有の明文化された例外を尊重する。

## 共通実装ルール

全アプリで統一されているルール・パターンを以下にまとめる。

### ルームコード形式

| DB | 桁数 | 生成方法 | 採用アプリ |
|----|------|---------|----------|
| Realtime Database | **6桁**英数字 | `RoomkRTDB.generateRoomCode()`（必要に応じてローカル alias） | do-mannaka, word-wolf, name-change, jinro, tatoe-narabe |
| Firestore | **6桁**英数字 | `generateSessionId()`（utils.js） | 現在該当なし |

除外文字（紛らわしいもの）: `0`, `O`, `I`, `1` など

### 参加画面の入力順

名前（ニックネーム・元の名前）とルームコードを同じ画面で入力する場合は、**名前 → ルームコード → 参加ボタン**の順に統一する。HTMLの並び順も合わせ、Tabキーでの移動も同じ順にする。あそびかた・説明スライドもこの順で案内する。

### 参加・共有の共通UI

- 参加画面を開く操作は「ルームに参加する」、入力後の確定は「参加する」。コード欄は「ルームコード（6文字）」。
- 各ルームの待機画面に「コードをコピー」ボタンを置き、コード単体をコピーする。コード自体のタップは補助操作とし、残す場合はキーボードでも操作可能にする。
- RTDB のコードコピーは `RoomkRTDB.copyRoomCode()` を使用し、成功・失敗を必ず通知する。
- ルームコード欄は、打っている間に `value` を書き換えない（`oninput` で大文字にする等）。日本語入力の変換中に書き換えると文字が重なり、ローマ字が入らなくなる（2026-09-30 実機報告）。大文字の表示は CSS の `text-transform: uppercase` に任せ、欄には `autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false"` を付ける。「参加する」で `normalize('NFKC')`（全角英数字→半角）・空白除去・大文字化してから `/^[A-Z0-9]{6}$/` 等で検査し、ひらがな等が残ったら、キーボードを英字に切り替えるよう案内する（端末を問わない言い方にし、「半角/全角」キー・Macの「英数」キーは例として添える）。
- 参加時の入力エラーはフォーム内に表示し、再送信まで残す。名前を先に検証する。通信エラーは通知でもよい。
- 単なるトップ画面への移動は「トップへ戻る」、参加中のルームから抜ける操作は「退出する」。ホストが全員のルームを閉じる操作など、影響が異なる操作は具体的な名称を維持する。
- あそびかた・スライドは画面上の実際のボタン名と入力順を引用する。

### 参加用のリンク（`?room=CODE`。2026-10-05 導入）

チャットにルームコードを貼る代わりに、リンクを貼れば参加する人はコードを打たずに入れる（日本語入力のまま打って文字が重なる・全角になる問題の回避）。2026-10-05 にカギあわせで先行導入し、同日ルーム型の全アプリへ展開した。先行導入の実装は `git show 50d8bd2`（apps/kagi-awase）。

- **「リンクをコピー」**（`id="btnCopyLink"`。ルームバーの「コードをコピー」の隣）: `location.origin + location.pathname + '?room=' + code` をコピーし、成功「参加用のリンクをコピーしました」／失敗「コピーできませんでした。コードをそのまま伝えてね」をトーストで通知する。連打ガードを付ける。**「コードをコピー」はコード単体のまま変えない**（2026-08-10 の決定）。コピーは共通の `RoomkRTDB.copyRoomLink(code, button)`（rtdb-utils.js `?v=20261005` 以降。文字列用の `copyText` と `roomLink` も同モジュール。独自のパラメータを引き継ぐアプリは第3引数にリンクを渡す。2026-10-05 オーナー承認で各アプリの写しから集約）
- **「QRコードを出す」**（`id="btnShowQr"`。「リンクをコピー」の直後。2026-10-22 導入）: スマホ・タブレットなど別の端末で入る人はチャットのリンクを踏めず、アドレスを手で打つしかなかった（2026-10-22 の指摘）。同じ参加用のリンクを QR コードにして画面の上に大きく重ねて出し、画面共有越しにカメラで読みとってもらう。QR の下にルームコードも出す。「とじる」・Esc・外側を押すと閉じる。共通の `RoomkQR.show(code, link?)`（`apps/shared/js/room-qr.js?v=20261022` を rtdb-utils.js の直後で読む）。「リンクをコピー」と同じ検査・同じ出し分けをしてから呼び、独自のリンクをコピーしているアプリは同じリンクを第2引数に渡す。QR を作るライブラリ（`apps/shared/js/vendor/qrcode-generator-2.0.4.js`、MIT）は初めて開くときに読み込み、読み込めなければ「「リンクをコピー」でチャットに送ってね」と出す。あそびかたのホストの手順に「スマホやタブレットで入る人には「QRコードを出す」をカメラで読みとってもらう」を添える
- **入口**: 起動時に `?watch=` → `?room=` → 保存した記録（sessionStorage）の順に見る。`?room=` は `normalize('NFKC')`・空白除去・大文字化してからそのアプリのルームコードの正規表現で検査する
  - 正しい形なら、参加画面を開き、コード欄に入れ、ヒント（`id="joinLinkHint"`、「リンクからひらいたので、ルームコードは入っているよ。名前を入れて「参加する」を押してね。」）を出し、名前欄にフォーカスする。コード欄は直せるように残す。トップの「ルームに参加する」から開いたときはヒントを隠す
  - 形が正しくなければ、トースト「ルームコードが正しくないよ」を出して `?room=` をアドレスから外し、そのあとはリンクなしで開いたときと同じにする（保存した記録があれば同じルームへ戻る）
  - **再接続との優先順位**: 同じコードの記録が残っていれば再接続を優先し、戻れなければ記録を消して参加画面へ。別のコードの記録が残っていれば、記録を消してリンクのルームを優先する
  - ルームの存在は参加画面を開く時点では確かめない（既存の「参加する」の検査に任せる）
- **アドレスの後片付け**: `?room=` は、ルームにつないだとき（作成・参加・再接続の共通の接続処理）に `history.replaceState(null, '', location.pathname)` で外す（`?room=` があるときだけ。`?watch=` は消さない）。参加に失敗している間は残す（再読み込みしてもコードが入ったまま）
- 参加の手順そのもの（名前 → コード → 参加する）・ニックネームの制約・参加の transaction は変えない。ホストの手順も変えない
- あそびかた: ホストの手順に「ルームコードは「コードをコピー」、参加用のリンクは「リンクをコピー」でチャットに送れる」、参加の手順に「リンクからひらいたときは、ルームコードは入っているので名前だけ入れる」を添える。説明スライドに参加手順があれば同じ趣旨を一言添える
- 既知の制約: 同じコードの記録があるタブでリンクをひらき、再接続の読み取りと最初の監視通知の間にホストがルームを閉じると、再接続は成功扱いで `?room=` が外れたあとトップへ戻る（参加画面にはフォールバックしない。リンクをもう一度ひらけばよい）

### ニックネーム制約

| 制約 | 内容 |
|------|------|
| 最大文字数 | 基本 **8文字**（name-change の参加者のみ12文字） |
| 同ルーム内重複 | **NG**（参加時にチェックして弾く） |
| 空文字 | **NG**（参加時にバリデーション） |
| 使えない文字 | `. # $ [ ] /` と制御文字は **NG**（名前を RTDB のキーにするため。入れると SDK が例外を投げ、理由のない「失敗しました」になる）。`/[.#$\[\]\/\u0000-\u001f\u007f]/` で作成・参加の前に断り、「記号 . # $ [ ] / は使えません」などと理由を出す |

### viewport 設定（Realtime Database アプリ）

Realtime Database アプリでは、ゲーム中の誤ズームで操作が崩れることを防ぐため `maximum-scale=1` を指定する。
`maximum-scale=1` はアクセシビリティ上は推奨されない指定だが、このツール群（あそびのたな）では画面共有中の安定した進行を優先する。

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

#### 作成・参加の送信後の切断（2026-10-12 追加）

送信済みで応答待ちの transaction は、通信が切れると `Error('disconnect')` で中止される（SDK の仕様。サーバーに届いたかは分からない）。
届いていたのに失敗として戻ると、切断時の予約（onDisconnect）がないままのルーム・在室が残る（ホストがいないのに `hostConnected: true` のルーム、消えない参加者）。

対処は「やり直して、自分の書き込みがもう届いていれば成功として扱う」。作成は自分が作ったルームか（`hostUid` など）、参加は自分の在室か（`players/{name}/uid` など）を transaction の中で確かめ、そうなら書き換えずに返す。

```js
async function transactRetry(ref, update) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ref.transaction(update);
    } catch (error) {
      if (error?.message !== 'disconnect' || attempt >= 3) throw error;
    }
  }
}
```

- 対処済み: career-sugoroku（先行）、suki-bingo・kimochi-ate・quiz・minna-ranking（2026-10-12）、shirushi-hint（2026-10-19。作成・参加とも）。参加だけ対処済み: kagi-awase・stamp-ate（同じ uid の在室は入りなおしとして通す）。作成を「切断中」として作る形: kaburazu-hint
- ほかのルーム型アプリは未対処。頻度が低く、参加処理を書き直すリスクのほうが大きいため、2026-10-12 に見送りと決めた（[kaizen-backlog.md](../kaizen-backlog.md) の決着履歴 P-19。消えない参加者が実際に出たら起票し直す）。失敗時に何も出ないアプリには、メッセージを出す修正だけを入れる（B-33）。新しく作るアプリはこの形にする
- 作成・参加の入口（ボタンから呼ぶ関数）は、例外を受けてメッセージを出す。transaction は権限エラーや送信後の切断で例外になり、受けないと画面が無反応になる（2026-10-12 に17本へ追加。B-33）
- やり直す transaction では、事前に読んだ値を代わりに使う書き方（`room || 事前に読んだ値`）をしない。やり直しの間にホストがルームを閉じると、閉じたルームを古い内容で作り直す（2026-10-12 minna-ranking で再現）。先に値を購読し（`warmRoomCache`）、終わるまで購読を続けて、transaction の中の null を「ルームがない」として扱う
- 参加の前に `players/{name}` の onDisconnect を先に予約する方法は取らない（その名前が他の人のものだったとき、取り消しが届く前に切れると他の人の在室を消す）
- 再現は Playwright の `page.routeWebSocket` で WebSocket を中継し、transaction の送信（`"a":"p"` と `"h"` を含む）をサーバーへ通したあと、応答を捨ててページ側を閉じる（`context.setOffline` ではタイミングを狙えない）

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

**公認バリアント: ふりかえり画面滞在中は削除しない**（2026-08-10 追加）

結果・ふりかえり画面での再戦や振り返りの時間を保証したいアプリは、「終了30秒後の自動削除」に
代えて、(1)「TOPにもどる」等の明示的な退出 (2)ホスト切断の TTL (3)次回アクセス時の期限切れ掃除
の3経路での削除としてよい。採用するアプリは自身の AGENTS.md に明記する
（採用例: tatoe-narabe・kotoba-pair・toomawashi）。

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
- ゲスト側の期限のタイマー（`orphanTimer`）は、**切れた時刻（`hostDisconnectedAt`）が変わったら仕掛けなおす**。ホストの通信が短く揺れると、`hostConnected` が false のまま切れた時刻だけが新しくなることがある。はじめの時刻のまま動くと、消す処理（期限を確かめなおす transaction）が「まだ期限前」で何もせず、ゲストが「ホストの戻りを待っています」のまま残る。仕掛けた時刻を `orphanAt` に持ち、ちがっていたら `clearTimeout` して仕掛けなおす（2026-11-13 に23本へ入れた。よさマップは、動いたときに期限前なら残りの時間で仕掛けなおす形）。期限を確かめずに `remove()` する作り（声だけシアター・ピタハメ・とおまわし・人狼）と観戦画面のタイマーは、止まらないので変えていない
- ホスト再接続時は `hostConnected=true` と `hostDisconnectedAt=null` を戻す

### 最小参加人数

| 人数 | 適用アプリ |
|------|----------|
| 2人以上 | name-change |
| 3人以上 | do-mannaka, word-wolf |
| 制限なし | talk-card |

### ホストも遊ぶかを選ぶ（`hostPlays`。2026-10-01 全ルーム型へ展開）

ルーム型のゲームは、ホストが「遊ぶ人」になるか「進行だけ」かを待合室で選べるようにする（2026-10-01 オーナー依頼で全26本へ展開。参考実装は oekaki-dengon）。

- 保存はルームの設定（例: `settings/hostPlays`）。**キーがない＝そのアプリの従来の動き**として読む（古いルームと混ざっても壊れない）
- 切りかえは**待合室でだけ**（「はじめる」まで）。「もう一回」は前の値を引き継ぐ
- 初期値はアプリの性質で決め、AGENTS.md に書く（従来ホストも遊んでいたアプリは「遊ぶ」、進行役が要るアプリは「進行だけ」）
- 進行だけのホスト: 待合室の一覧で「進行役」の印を出す（ゲストにも見える）。人数の表示・最小人数・上限・利用回数の `players-{N}` には数えない。順番・投票・採点の対象にしない（進行役に番が回る・票が入る、をなくす）。ゲームの対象にいなくても、読み込み直し・再接続でホストとして戻れる
- 遊ぶ人が0人になったら、進行だけのホストが進められずに止まらないよう「ゲームを終了する」等の出口を出す。進行だけのホストを残して遊ぶ人が全員退出したときは、ルームを消さずにまとめへ進めてよい（blackjack・moji-soroe）
- **ホストの画面に答え・秘密が出るゲーム**（まぎれ絵師・うそつき辞書・かくれナンバー・クイズパックなど）は、「みんなにみせる画面」（`?watch=`）を作り、ホストはそれを画面共有して自分のタブで遊ぶ。初期値は「進行だけ」。ホストが遊ぶときは、ホスト自身の秘密を折りたたみ、ほかの人の秘密を出さない
- 進行だけのホストは声で話せるので、マイクを使わない子向けの手段（ui.md「マイクを使わない子が参加できる手段」）は持たせなくてよい

### 端末のない参加者（ホストが代わりに押す）

自分の端末を持たない子（メンターの画面共有を見て、声やチャットで遊ぶ子）を、ホストが名前を足して遊ぶ人に入れる。career-sugoroku の席（端末の ID が空の人）が先にあり、2026-10-19 の shirushi-hint で今の形になって、kotoba-meter・kakure-kaito・charin-baton・hirameki-oogiri・kanpe-housou・kyoumi-sugoroku・reversi などへ広がった。新しいルーム型ゲームでは、作るか作らないかを決めて AGENTS.md に書く。

- **足す・外す**: ホストが待合室（ラウンド制なら準備・結果の画面）の「端末なしの参加者を足す」で名前を足す。ニックネームの規則どおり・ほかの人やホストと同じ名前は不可。人数の上限を決める（例: 4人まで）。ホストは一覧の「外す」でいつでも外せる
- **データ**: `proxies/{name}`、または `players/{id}` に `proxy: true` で置く。**在室（onDisconnect）を持たない**ので、接続待ち・切断の扱いにしない（いつも遊べる人として、開始・時間切れの接続の検査を通す）。遊ぶ人数・順番・利用回数の `players-{N}` には数える
- **代わりに押す**: その子の番・その子の選択は、ホストの画面に「○○の番。代わりに入れてね」などの欄で出す。入力はホストの画面にだけ出し、公開の前にほかの画面に出さない
- **印はホストの画面にだけ**出す。子どもどうしの画面で「端末なし」を区別しない
- **秘密を伝える**: 役やお題など本人だけが知る情報があるゲームは、ホストの画面に「役を見る」「チャット用にコピー」（チャットの個別メッセージで送る文。絵文字なし）を出す（kakure-kaito）
- **ホストが秘密を知ってしまうとき**: 端末なしの子が1人でもいれば、ホストは進行だけにする（`hostPlays` を切って選べなくする。shirushi-hint・kakure-kaito）
- **作らないゲーム**: 本人がその場で操作し続けるゲーム（suton-block）、手札がホストに見えてしまうゲーム（daifugo。代わりに CPU を足す）、ホストが代わりに動かすと役が見えてしまうゲーム（nemurase-kichi。その場合は、進行役の画面を共有し、話し合いに声やチャットで加わる形にする）
- あそびかた・説明スライドの参加のしかたに「端末のない子は、ホストが名前を足して代わりに押す」を1行添える

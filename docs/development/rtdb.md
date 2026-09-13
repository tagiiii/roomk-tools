# rtdb — room-K 実装資料

共通の権限・品質基準は [AGENTS.md](../../AGENTS.md)。本文のコードパスはリポジトリルート基準。該当機能を実装・変更・監査するときだけ読む。アプリ固有の明文化された例外を尊重する。

## 共通実装ルール

全アプリで統一されているルール・パターンを以下にまとめる。

### ルームコード形式

| DB | 桁数 | 生成方法 | 採用アプリ |
|----|------|---------|----------|
| Realtime Database | **6桁**英数字 | `RoomkRTDB.generateRoomCode()`（必要に応じてローカル alias） | do-mannaka, word-wolf, name-change, jinro, tatoe-narabe |
| Firestore | **6桁**英数字 | `generateSessionId()`（utils.js） | checkin, vote |

除外文字（紛らわしいもの）: `0`, `O`, `I`, `1` など

### 参加画面の入力順

名前（ニックネーム・元の名前）とルームコードを同じ画面で入力する場合は、**名前 → ルームコード → 参加ボタン**の順に統一する。HTMLの並び順も合わせ、Tabキーでの移動も同じ順にする。あそびかた・説明スライドもこの順で案内する。

### 参加・共有の共通UI

- 参加画面を開く操作は「ルームに参加する」、入力後の確定は「参加する」。コード欄は「ルームコード（6文字）」。
- 各ルームの待機画面に「コードをコピー」ボタンを置き、コード単体をコピーする。コード自体のタップは補助操作とし、残す場合はキーボードでも操作可能にする。
- RTDB のコードコピーは `RoomkRTDB.copyRoomCode()` を使用し、成功・失敗を必ず通知する。
- 参加時の入力エラーはフォーム内に表示し、再送信まで残す。名前を先に検証する。通信エラーは通知でもよい。
- 単なるトップ画面への移動は「トップへ戻る」、参加中のルームから抜ける操作は「退出する」。ホストが全員のルームを閉じる操作など、影響が異なる操作は具体的な名称を維持する。
- あそびかた・スライドは画面上の実際のボタン名と入力順を引用する。

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
- ホスト再接続時は `hostConnected=true` と `hostDisconnectedAt=null` を戻す

### 最小参加人数

| 人数 | 適用アプリ |
|------|----------|
| 2人以上 | name-change |
| 3人以上 | do-mannaka, word-wolf |
| 制限なし | talk-card, checkin, vote |

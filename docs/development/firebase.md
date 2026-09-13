# firebase — room-K 実装資料

共通の権限・品質基準は [AGENTS.md](../../AGENTS.md)。本文のコードパスはリポジトリルート基準。該当機能を実装・変更・監査するときだけ読む。アプリ固有の明文化された例外を尊重する。

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

正本は [database.rules.json](../../database.rules.json)。読み書きとも**匿名認証が必須**。

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

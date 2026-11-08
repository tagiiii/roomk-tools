# firebase — room-K 実装資料

共通の権限・品質基準は [AGENTS.md](../../AGENTS.md)。本文のコードパスはリポジトリルート基準。該当機能を実装・変更・監査するときだけ読む。アプリ固有の明文化された例外を尊重する。

## Firebase

**プロジェクト**: `roomk-tools`
**プラン**: Spark（無料）。無料枠を超えない実装をすること。

### 使用するサービスと無料枠

| サービス | 無料枠 | 主な用途 |
|---------|--------|---------|
| Firestore | 1GB / 50,000読 / 20,000書 per日 | 現在該当なし |
| Realtime Database | 1GB / 10GB転送 per月 | do-mannaka, word-wolf, name-change |
| Auth（匿名） | 無制限 | ユーザー識別 |

### Realtime Database パス命名規則

**新しいアプリを追加するときは、公開の前に `database.rules.json` へ名前空間を足す**（2026-11-08 D-5 で、ルールを名前空間の一覧に固定した。足さないとそのアプリだけルームを作れない）。名前は以下の命名規則に従う。

```
{appname}_rooms/{roomCode}/...
```

| アプリ | パス |
|--------|------|
| do-mannaka | `domannaka_rooms/{roomCode}/` |
| word-wolf | `wordwolf_rooms/{roomCode}/` |
| name-change | `namechange_rooms/{roomCode}/` |
| （新アプリ例） | `newapp_rooms/{roomCode}/` |

#### 現在のセキュリティルール

正本は [database.rules.json](../../database.rules.json)。読み書きとも**匿名認証が必須**。

```json
{
  "rules": {
    "feedback": { "…": "フィードバック送信（書けるが読めない・欄を検査する）" },
    "blackjack_rooms": {
      "$roomId": { ".read": "auth != null", ".write": "auth != null" }
    },
    "…（ルーム用の名前空間を1つずつ並べる）…": {},
    "stats": {
      "$app": { ".read": "auth != null", ".write": "auth != null" }
    }
  }
}
```

2026-11-08（D-5）までは `$app_rooms` のワイルドカードで、任意の最上位の名前に書けた。いまは一覧にない名前・未ログイン・名前空間ごとの読み取り・最上位への書き込みはできない。

**新アプリの手順**: `{appname}_rooms` を `database.rules.json` に、ほかのルーム用と同じ形で足す。`bash scripts/lint.sh` の [RULES-1] が、コードの `ref()` に渡す名前空間がルールにないと ERROR で知らせる。`database.rules.json` は変更禁止パスなので、足すのはオーナーの承認のもとで行い、main に入ると `.github/workflows/firebase-rules.yml` が本番のルールを更新する。**アプリの公開より先に（または同じ PR で）ルールを入れる。** 別の Firebase プロジェクトを使うアプリ（ねむらせ基地）は対象外。

### その他のセキュリティ方針

- 読み書きには匿名認証（`auth != null`）が必要。アプリ側は `signInAnonymously` の完了を **await してから** RTDB にアクセスする（rtdb-utils.js の `authReady` を使用）
- ルームやセッションデータはゲーム・セッション終了後に削除する

### 確かめるときの落とし穴（2026-11-08）

- **隔離エミュレーターは、`firebase.json` のルールを自動では当てないことがある。** `?ns=demo-…` への読み書きが、未ログインでも通ってしまった。ルールを確かめるときは `PUT {DB}/.settings/rules.json?ns=…`（`Authorization: Bearer owner`）で明示的に読み込ませてから試す（`tests/feedback/e2e.cjs` と同じ）。
- **本番の API キーにはリファラー制限がある。** REST で匿名ログイン（`accounts:signUp`）するときは `Referer: https://tagiiii.github.io/roomk-tools/` を付ける。付けないと ID トークンが取れず、書けるはずの所まですべて 401 に見える。
- 本番のルールの中身は、フィードバック用のサービスアカウントで `GET {DB}/.settings/rules.json` を読んで、リポジトリと突き合わせられる（読むだけ）。同時接続などの使用状況はこの鍵では読めない（Cloud Monitoring の権限がない）ので、Firebase コンソールで見る。

### API キー

`AIzaSyC0bqQdDJeTAWrqFYqjOT1NsVFiunPemIw`
HTTP リファラー制限済み:
- `tagiiii.github.io/roomk-tools/*`
- `localhost/*`

---

# 掲示板アプリ — アプリ固有仕様

## 概要

roomKコミュニティ向けの非同期掲示板。既存アプリが「一時的なルームセッション」であるのに対し、本アプリは「永続的なコミュニティ空間＋PIN認証」という異なるパラダイム。

- 想定規模: 10〜50人のクローズドコミュニティ
- 認証: PIN ベース（Firebase Auth の匿名認証とは別レイヤー）
- セッション: `sessionStorage`（タブ単位。タブを閉じると再ログイン必須）
- 入力補助: `localStorage` にニックネームのみ記憶（セッション証明には使わない）
- データ永続化: スレッド・コメントはセッション終了後も保持

---

## ファイル構成

```
apps/bulletin-board/
├── index.html   # HTML構造（5画面）
├── app.js       # 全ロジック
├── style.css    # アプリ固有スタイル（接頭辞: .bb-）
└── CLAUDE.md    # 本ファイル
```

---

## Firestore コレクション

| コレクション | ドキュメントID | 用途 |
|-------------|---------------|------|
| `bb-users/{nickname}` | ニックネーム | ユーザーアカウント |
| `bb-invite-codes/{code}` | 招待コード文字列 | 招待コード管理 |
| `bb-threads/{auto}` | 自動生成 | スレッド |
| `bb-threads/{id}/comments/{auto}` | 自動生成 | コメント（サブコレクション） |

### 注意事項

- スレッド削除時は `comments` サブコレクションを先に全削除する（Firestore はカスケード削除しない）
- 削除は `writeBatch` で 450 件ずつ処理
- `commentCount` の更新には `increment(1)` / `increment(-1)` を使用

---

## 認証フロー

- PIN は Web Crypto API の SHA-256 でハッシュ（固定salt: `bb-salt-roomk:`）
- 管理者判定: PIN が `9999` のユーザー（ハッシュ値で比較）
- セッション: `sessionStorage` に `{ nickname, pinHash }` を保持。リロード時はこれを Firestore と照合して復元
- タブを閉じるとセッション消滅 → 再ログイン必須（`localStorage` の pinHash を公開情報と見なし、永続セッションは意図的に廃止）
- `localStorage` にはニックネームのみ保存（ログインフォームの入力補助用）

---

## 利用時間制限

- 利用可能: 9:30〜14:00（JST）
- クライアント `new Date()` で判定（UTC+9 に変換）
- 管理者（PIN=9999）は免除
- 60秒間隔の `setInterval` で再判定
- 時間外はオーバーレイ表示 + `onSnapshot` リスナーを解除（読取節約）

---

## 画面構成

| 画面ID | 用途 |
|--------|------|
| `screen-auth` | ログイン / 新規登録（タブ切替） |
| `screen-threads` | スレッド一覧 + FAB |
| `screen-new-thread` | スレッド作成フォーム |
| `screen-detail` | スレッド詳細 + コメント一覧 + コメント入力 |
| `screen-admin` | 招待コード生成・一覧（管理者のみ） |

---

## CSS接頭辞

`.bb-`（例: `.bb-thread-card`, `.bb-comment--mine`）

---

## ニックネーム制約

- 最大 **20文字**（既存アプリの8文字とは異なる。掲示板は用途が異なるため緩和）
- `/` `.` は使用不可（Firestore ドキュメントID制約）
- 同名登録は不可（ドキュメントID重複で弾く）

---

## セキュリティ方針

プロジェクト共通の性善説に準拠。PIN=9999 や時間制限はUI上の運用ルールであり、厳密なセキュリティではない。Firestore ルールは全開放（`allow read, write: if true`）。

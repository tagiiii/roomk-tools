# `database.rules.json` に足す行（案・置くのはオーナー）

`feedback` は固有のキーなので、`$app_rooms` のワイルドカードより優先される。
`"rules": {` の直下、`"$app_rooms"` の前に足す。

```json
"feedback": {
  ".read": false,
  "$id": {
    ".write": "auth != null && !data.exists()",
    ".validate": "newData.hasChildren(['app', 'kind', 'text', 'at'])",
    "app":  { ".validate": "newData.isString() && newData.val().length <= 40" },
    "kind": { ".validate": "newData.isString() && newData.val().length <= 20" },
    "text": { ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 300" },
    "at":   { ".validate": "newData.isNumber()" },
    "$other": { ".validate": false }
  }
},
```

- `.read: false`: クライアントからは誰も読めない。読めるのは Firebase コンソールと管理者権限（サービスアカウント）だけ
- `!data.exists()`: 一度書いたものは本人でも書き換え・削除できない
- `$other: .validate false`: 決めた4つ以外の欄は書けない（名前・UID などを混ぜられない）。4つの欄は**名前を書いて個別に `.validate` する**（書かないと `$other` が4つにも当たって、正しい形も書けなくなる。2026-10-30 エミュレーターで確認）
- `main` に push すると `.github/workflows/firebase-rules.yml` が配備する。**送信ページ（`apps/guide/feedback/`）はこのルールが配備されてから公開する**

検証（2026-10-30・エミュレーター・`tests/feedback/`）: 提案ルールで 32項目合格（読めない／書き換え不可／消せない／欄を足せない／301字・空・欄不足・型違いは書けない／正しい形は書ける／別の匿名ユーザーも同じ）。今のルールのままだと、`feedback/` 全体は読めないが **id が分かれば1件ずつ読める・書き換えられる・消せて、欄も長さも縛れない**（24項目で確認）。

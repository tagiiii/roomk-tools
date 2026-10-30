# 「？」のとなりのフィードバックボタン（実施済み・2026-10-30）

D-3 はオーナー指示で決着: **全員に出す・別タブで開く・「？」とは別のボタンにする**。
`apps/shared/js/howto.js` に次の2つを足した（後方互換・追加のみ。`RoomkHowto.init({ feedback: false })` で両方消せる）。

| 場所 | 見た目 | 文言 |
|---|---|---|
| 「？」のとなり（内側に 60px） | 白地・紺の枠の丸ボタン（48px）・`feedback` アイコン | aria-label / title「フィードバックを送信する」 |
| あそびかたモーダルの末尾 | `btn btn-secondary btn-full`・`send` アイコン | 「フィードバックを送信する」 |

- href は `../guide/feedback/?app=` ＋ URL の最後の区切り（`appIdFromPath()`。stats.js の `detectAppName` と同じ考え方）
- `target="_blank" rel="noopener"`。遊んでいる画面とルームの接続はそのまま。送信ページの「このタブを閉じてもどる」で元の画面に戻れる（Chrome で確認）
- `position: 'left'` のアプリ（jinro・pita-hame）は丸ボタンも左側に出る
- 子どもにも見える前提で、文言は「フィードバックを送信する」。「スタッフ用」とは書かない
- `apps/guide/` の2ページ（`index.html`・`hajimete/`）は howto.js を使わないので、`hajimete/` の「困ったとき」に直接リンクがある

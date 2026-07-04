# チャレンジのたね — アプリ固有仕様

## 目的

- roomK のオンラインメンタリング（1対1）で、メンターが画面共有しながら操作するオフラインツール。
- 「ちょっとやってみたいかも」というたねを集めておく置き場。1回10分程度、回をまたいで JSON で育てる。
- さくせん会議（GPDC）の**前段**。ここでは計画を立てない・決めない。たねが育ったらさくせん会議に持ち込む。
- たねの status は4種類で**全部同格**。「ためす」だけでなく「ながめる・ほりゅう・もういいかな」も正式な扱いで、成功/失敗の順序をつけない。
- 「たね」という比喩は screen-start の一文（「やってみたいかも」とおもったことを、ここでは「たね」とよぶよ）で**一度だけ説明**する。「まく」などの園芸系の派生語は使わず、「ふやす」「なおす」「けす」の素直な動詞を使う（比喩の密度を上げない）。

## 技術

- `index.html` + `app.js` + `style.css` の talk-card 型オフライン構成。Firebase 不使用。
- 永続化 API（localStorage / sessionStorage / IndexedDB / Cookie）は一切呼ばない。
- 記録は JSON ファイルのダウンロード／アップロードのみ。エクスポートは Blob + `<a download>`、インポートは `<input type="file">` + FileReader。
- 共有 `../shared/css/design-system.css` と Material Symbols Rounded を使う。絵文字は禁止。
- CSS は `ct-` 接頭辞 + BEM。`.screen` / `.active` と `screen-xxx` 命名を使う。
- 状態は `const state = { record, dirty, currentScreen, draft }` にまとめる。
- ユーザー由来文字列の DOM 挿入は必ず `esc()` を通す。
- dirty フラグと `beforeunload` を使い、ダウンロード成功で dirty をクリアする。

## 画面フロー

```text
screen-start
  → screen-edit（はじめてのたねを追加） → screen-home
  → screen-load-confirm → screen-home

screen-home
  → screen-edit（追加・編集・削除） → screen-home
  → screen-save →（ダウンロード後）screen-home / screen-start
```

- status 変更（ポケットの移動）は screen-home 上のカード内チップで**1タップ**。画面遷移も確認も理由入力もなし。
- 削除は screen-edit 内で「けす」→ 確認1回のみ。
- 「もういいかな」のたねは削除せず、home 下部のたたんだ `<details>` エリアに残る（やめる＝なかったことにしない、でも目立たせない）。

## データ構造

- `record.app = "challenge-tane"`、`schemaVersion = 1`。
- `fileMarker` は個人を特定しない色×動物（さくせん会議と同じ辞書）。
- `seeds` は最大50件。
- たね: `{ id, label(30文字以内・必須), memo(60文字以内・null可), status, createdAt }`。
- `seed.status`: `try（ためしてみたい） | watch（ながめておく） | hold（ほりゅう） | close（もういいかな）`。4つは同格の enum で遷移制限なし。
- 日時は ISO 8601。表示は「—」フォールバック。

## さくせん会議との接続

- `status === 'try'` のたねにだけ「さくせん会議で そうだんする」ボタンを置く。
- 押すとたねの label をクリップボードにコピーし、`../sakusen-kaigi/` へのリンク（`target="_blank"`）を表示する。
- **データ連携はコピーのみ。JSON の統合・自動受け渡しはしない。**
- コピー失敗時は手動コピー用にたねの文言をパネル内に表示する（`user-select: all`）。

## インポート検証

- エクスポートのファイル名は `tane-record_{animal-romaji}-{color-romaji}_YYYY-MM-DD.json`。めじるし辞書にローマ字対応表を内蔵する。
- サイズは 512KB 以下。JSON.parse 成功、`app === "challenge-tane"` が必須。
- `schemaVersion > 1` は「このファイルは新しいバージョンでつくられています。アプリを更新してから開いてください」で拒否。
- `schemaVersion < 1` または欠落、app 不一致、parse 失敗、サイズ超過は「このファイルは読み込めませんでした。チャレンジのたねで ほぞんしたファイルか、たしかめてください」で拒否。
- `seeds` が配列でない、または50件超は「記録の内容が正しくないため読み込めませんでした」で拒否。
- `label` は30文字に切り詰め。切り詰め後に空になるたねは除外。`memo` は60文字に切り詰め（空は null）。
- `status` の不正値は `watch` に正規化。日時は parse 不能なら null。
- 未知フィールドは破棄し、既知フィールドのみで record を再構築する。ID は信用せず再採番する。
- 不正ファイルでクラッシュさせず、`screen-start` にエラー表示して復帰する。

## 心理的安全設計（最重要）

- たねの**数・達成率・経過日数を表示しない**（たねの createdAt は保持するが画面に出さない）。
- status 変更に理由を求めない。「もういいかな」への変更も1タップで、否定的な演出をしない。
- 4つの status は文言・並び・配色を同格に扱う（ポケットの色分けをしない。「ながめておく」「ほりゅう」が中途半端に見える表現をしない）。
- たねの例文・プレースホルダーを置かない（例示が誘導になるため。学校・勉強関連の例示は特に禁止）。

## 入れない機能（意図的に未実装）

- localStorage / sessionStorage / IndexedDB / Cookie。
- Firebase、外部 API、外部保存。
- 期限、リマインダー、通知、進捗バー。
- 個数表示、達成率、経過日数、グラフ、順位、バッジ。
- がんばれ系の応援文言、賞賛・残念演出。
- 計画づくり（さくせん会議の領分。ここでは決めない）。
- さくせん会議との JSON 統合・自動データ連携。

## アクセシビリティ

- 選択カード・移動チップは `<button>`。移動チップは `aria-label` で「どのたねをどこへ」を明示。
- status 単一選択は `role="radiogroup"` + `aria-checked`。選択状態は枠色 + 背景 + check アイコンで表す（色だけにしない）。
- Tab / Enter / Space で操作でき、`:focus-visible` を明確に、タップターゲットは最小 44×44px。
- `prefers-reduced-motion` でアニメーションを無効化する。
- toast は `role="status"`、インポートエラーは `aria-live="assertive"`。

## コンテンツガイドライン例外

- なし（共通ガイドラインに全面準拠）。
- 自由記述欄の注意書きとして「なまえ・学校名などは書かないでね」は仕様上の固定文言として使う。

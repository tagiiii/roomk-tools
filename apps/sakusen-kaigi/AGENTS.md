# さくせん会議 — アプリ固有仕様

## 目的

- roomK のオンラインメンタリングで、メンターが画面共有しながら操作するオフラインツール。
- Goal–Plan–Do–Check を使い、めあてを決め、さくせんを立て、次回までためし、ふりかえる。
- 正式な医療的介入ではない。アプリ内 UI に「CO-OP」「治療」「訓練」の語を出さない。
- 日々の記録、メンター観察評価、達成競争、連続記録、バッジ、比較、賞賛・残念・励まし演出は入れない。

## 技術

- `index.html` + `app.js` + `style.css` の talk-card 型オフライン構成。Firebase 不使用。
- 永続化 API（localStorage / sessionStorage / IndexedDB / Cookie）は一切呼ばない。
- 記録は JSON ファイルのダウンロード／アップロードのみ。エクスポートは Blob + `<a download>`、インポートは `<input type="file">` + FileReader。
- 共有 `../shared/css/design-system.css` と Material Symbols Rounded を使う。絵文字は禁止。
- CSS は `sk-` 接頭辞 + BEM。`.screen` / `.active` と `screen-xxx` 命名を使う。
- 状態は `const state = { record, dirty, currentScreen, draft }` にまとめる。
- ユーザー由来文字列の DOM 挿入は必ず `esc()` を通す。
- dirty フラグと `beforeunload` を使い、ダウンロード成功で dirty をクリアする。

## 画面フロー

```text
screen-start
  → screen-goal-category → screen-goal-example → screen-goal-build → screen-plan
  → screen-confirm → screen-save → screen-home

screen-start
  → screen-load-confirm → screen-home

screen-home で目標選択
  → screen-check-last → screen-check-rating → screen-check-points → screen-check-next
  → screen-confirm / screen-plan / screen-goal-category / screen-save / screen-home
```

- 全ウィザード画面に「← もどる」を置き、入力は `draft` で保持する。
- 最終決定前は `screen-confirm` を必ず経由する。
- `screen-home` の「きょうの会議をおわる」は `screen-save` へ進む。

## データ構造

- `record.app = "sakusen-kaigi"`、`schemaVersion = 1`。
- `fileMarker` は個人を特定しない色×動物。
- `goals` は最大10件。同時に `active` な goal は最大3件。
- `goal.status`: `active | paused | done`。
- `plan.status`: `open | checked | undecided`。
- `ratingSpecial`: `null | "hard-to-say" | "no-talk" | "skip-check"`。`rating` と排他。
- `pointsSpecial`: `null | "none-fit" | "no-talk"`。
- `nextAction`: `continue | change-plan | change-goal | pause | done`。
- `plans` は追記専用。check 確定後の plan を書き換えない。
- 日時は ISO 8601。`title` は組み立て結果の表示用文字列として保持する。

## インポート検証

- エクスポートのファイル名は `sakusen-record_{animal-romaji}-{color-romaji}_YYYY-MM-DD.json`。めじるし辞書にローマ字対応表を内蔵する。
- サイズは 512KB 以下。JSON.parse 成功、`app === "sakusen-kaigi"` が必須。
- `schemaVersion > 1` は「このファイルは新しいバージョンでつくられています。アプリを更新してから開いてください」で拒否。
- `schemaVersion < 1` または欠落、app 不一致、parse 失敗、サイズ超過は「このファイルは読み込めませんでした。さくせん会議でほぞんしたファイルか、たしかめてください」で拒否。
- `goals` が配列でない、総数10件超、active 3件超は「記録の内容が正しくないため読み込めませんでした」で拒否。
- 文字列長は `title <= 60`、`customStrategy <= 80`、`note <= 120`、`when/amount <= 30` に切り詰めて受理。
- `rating` は 1〜5 整数または null。不正値は null。
- enum 不正値は null または除外に正規化。
- 日時は parse 不能なら null。表示は「—」。
- 未知フィールドは破棄し、既知フィールドのみで record を再構築する。
- ID は信用せず再採番する。
- 不正ファイルでクラッシュさせず、`screen-start` にエラー表示して復帰する。

## アクセシビリティ

- 選択カードは `<button>`。
- 単一選択群は `role="radiogroup"` + `aria-checked`。
- 複数選択は `aria-pressed`。
- 選択状態は枠色 + 背景 + check アイコンで表す。色だけにしない。
- ステッパーは `<ol>` + `aria-current="step"`。
- Tab / Enter / Space で操作できるようにする。
- `:focus-visible` を明確にし、タップターゲットは最小 44×44px。
- `prefers-reduced-motion` でアニメーションを無効化する。
- toast は `role="status"`、エラーは `aria-live="assertive"`。

## 入れない機能

- localStorage / sessionStorage / IndexedDB / Cookie。
- Firebase、外部 API、外部保存。
- 日々の記録、メンター観察評価。
- 合計、達成率、前回比、グラフ、順位、バッジ。
- 賞賛・残念・励まし文言。
- 仕様にない画面、設定、便利機能。

## コンテンツガイドライン例外

- 「学び・きょうみ」は本ツール限定で使用可。
- 宿題・テスト・成績・授業・学校の語は目標例や選択肢に使わない。
- 自由記述欄の注意書きとして「なまえ・学校名などは書かないでね」は仕様上の固定文言として使う。

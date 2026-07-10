# C-2 調査報告: aria/role ゼロアプリの改善候補リスト（2026-07-11）

バックログ C-2（調査・報告のみ、変更なし）の成果物。全アプリの aria/role 属性を機械集計し、
共通パターンを目視相当で確認した。修正は人間が Tier を付けて承認後に行う。

## 実測サマリー

- **aria/role が完全にゼロ: 15アプリ**
  checkin / codenames / hint-de-pinto / iisen-show / ishin-denshin / ito / koedake-theater /
  magire-eshi / minna-ranking / name-change / tatoe-gp / uso-jisho / value-card / vote / word-wolf
  （checkin・vote は本体スタブのため対象外としてよい）
- ほぼゼロ（1〜2件）: ikutsu-ieru / kotoba-relay / pittari-meter / talk-card / jinro
- 共有部品では **howto.js は対応済み**（aria 6件）。**rtdb-utils.js の showToast は aria-live なし**

## 改善候補（効果が広い順）

### 1. 共有: showToast に `role="status"` + `aria-live="polite"`（1修正で全RTDBアプリに効く）
エラー・完了通知が現状スクリーンリーダーに一切伝わらない。`apps/shared/js/rtdb-utils.js` の
トースト要素生成時に属性を2つ足すだけ。**※ apps/shared 配下のため変更許可が必要（旧B-7/B-8と同じ扱い）**

### 2. 全アプリ共通: 装飾アイコンに `aria-hidden="true"`
`material-symbols-rounded` の使用は全体で約440箇所。テキスト併記ボタン内のアイコンは
リガチャ名（"check_circle" 等）がそのまま読み上げられる。機械的な一括置換が可能で、
テキストを持たないアイコンだけ `aria-label` を付ける（例: jinro の rules-fab は対応済みパターン）。

### 3. モーダル/オーバーレイに `role="dialog"` + `aria-modal="true"`
再接続オーバーレイ・ホスト切断オーバーレイ・出題/判定シートなど、モーダル系は
hint-de-pinto(5) / iisen-show(7) / tatoe-gp(7) / uso-jisho(7) / koedake-theater(5) / magire-eshi(5) / word-wolf(5) など多数。
まずは「全アプリ共通で存在する reconnect-overlay / host-disconnect-overlay」から着手すると横展開しやすい。

### 4. フォーム: `<label for>` と `<input id>` の紐付け
label 要素は存在するが `for=` の紐付けが 0（hint-de-pinto / ito / word-wolf で確認、他も同様と推定）。
ニックネーム・ルームコード入力が無名フィールドになる。placeholder 依存の解消も兼ねる。

### 5. ドラッグ専用操作のキーボード代替（重め・要設計）
- value-card（sortablejs による並べ替え）
- minna-ranking（並べ替え遊び）
キーボード/スクリーンリーダーでは操作不能。上下移動ボタンの追加など UI 設計を伴うため、
体験判断が必要 → Tier B ではなく人間主導の設計案件。

### 6. 状態変化の通知（`aria-live` リージョン）
タイマー表示（ito / jinro）、「みんなの確認状況」等の動的リストは視覚のみ。
過剰通知になりやすい箇所なので、対象を絞って設計する（タイマー終了時のみ通知など）。

## 優先順の提案

| 候補 | 規模 | 想定Tier |
|---|---|---|
| 1. showToast aria-live | 極小（共有1箇所） | B（apps/shared 許可必要） |
| 2. アイコン aria-hidden | 大（機械的一括） | B（1アプリずつ確認しながら） |
| 3. モーダル role="dialog" | 中 | B |
| 4. label for 紐付け | 中 | B |
| 5. ドラッグ代替 | 大（設計必要） | D |
| 6. aria-live リージョン | 中（設計必要） | D寄りC |

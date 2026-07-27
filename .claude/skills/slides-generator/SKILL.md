---
name: slides-generator
description: アプリの画面共有用説明スライド（apps/{name}/slides.html）を作成する。発表画面＋発表者ノート同期＋Metalife チャット用コピー機能を持つ単一ファイル。「説明スライドを作って」「slides.html を追加して」と言われたら使う。
---

# 説明スライド（slides.html）の作成

**正本テンプレート: `apps/kotoba-tantei/slides.html`**（type 分岐のあるデータ駆動版・481行）。

- `apps/codenames/slides.html` と `apps/hint-de-pinto/slides.html` は**改名前のリダイレクトスタブ**（16行）。テンプレートとして開いても中身がない
- `apps/kaburazu-hint/slides.html` はフラット構造の旧型。**新規作成では使わない**
- 実装が分岐すると保守できなくなるため、独自エンジンを書き起こさない

## 作成手順

1. `apps/kotoba-tantei/slides.html` を読み、構造を把握する:
   - `SLIDES` 配列（`type: 'title' | 'divider' | 'content'`、`accent` / `section` / `sectionEn` / `num` / `headline` / `body` / `note`）
   - `slideHTML()` テンプレート関数、`render()`、キーボード操作（←→ / F / P）、1280×720 固定ステージの fit 処理
   - BroadcastChannel + localStorage による発表者ウィンドウ同期、発表者ノートの Metalife チャット用コピー
2. エンジン部分（ナビゲーション・同期・fit・コピー）は**そのまま流用**し、BroadcastChannel のチャンネル名と localStorage キーの接頭辞だけアプリ固有に変える（kotoba-tantei は `kotoba_tantei_deck`）
3. カスタマイズしてよいのは: `SLIDES` の中身、`:root` の配色トークン、フォント
4. スライド構成の目安（kotoba-tantei は 16枚）:
   - divider（チェックイン）→ title → content 数枚（ゲーム概要 / 役割 / 進行 / ルール詳細）→ content（Q&A）→ 進行用 divider 数枚（質問タイム / 参加確認 / ゲームスタート / …）→ divider（結果）

## コンテンツ規約

- ルート `AGENTS.md` のコンテンツガイドラインに従う（学校・成績・恋愛・ホラー系の表現禁止、正解を強いない、ポジティブな軸）
- 対象は小学校中学年〜中学生。説明文は短く、1スライド1メッセージ
- 発表者ノート（`note`）は口語体で、そのまま読み上げ・Metalife チャット貼り付けできる文章にする。**絵文字は使わない**（スライド本体・ノートとも。アイコンは Material Symbols のみ）
- 番号付き選択肢を見せる場合は丸数字 `①②③`
- 比喩は導入で1回だけ説明し、操作の説明は素直な動詞にする（比喩の派生語で操作名を濁さない）
- **メンター向けの心得・声かけのコツは書かない**（置き場は `AGENTS.md` だけ）。発表者ノートは進行の台本であって指導メモではない
- アプリ本体の `apps/{name}/AGENTS.md` を読み、ルール説明が実装と食い違わないようにする

## ポータルへの導線

slides.html を作ったら、`apps/index.html` の該当カード（`<a class="app-card">`）に
`data-slides` 属性を追加する。フッター右端の「スライド」バッジは JS が自動描画する。

## 検証

- ブラウザで開いて全スライドを送り、レイアウト崩れがないか確認
- P キーで発表者ウィンドウを開き、ノート同期とコピー機能を確認
- `bash scripts/lint.sh` がエラー0・新規警告なしのまま通ること

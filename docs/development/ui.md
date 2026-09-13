# ui — room-K 実装資料

共通の権限・品質基準は [AGENTS.md](../../AGENTS.md)。本文のコードパスはリポジトリルート基準。該当機能を実装・変更・監査するときだけ読む。アプリ固有の明文化された例外を尊重する。

## デザインシステム（`design-system.css`）

### カラートークン（CSS変数）

| 変数 | 値 | 用途 |
|------|----|------|
| `--color-primary` | `#1C3F5E` | メインカラー（ネイビー） |
| `--color-accent` | `#2E7D8C` | アクセント（ティール） |
| `--color-bg` | `#F5F2EC` | ページ背景 |
| `--color-surface` | `#FFFFFF` | カード・ボックス背景 |
| `--color-text` | `#1A1A1A` | 本文テキスト |
| `--color-muted` | `#5A6270` | サブテキスト |
| `--color-border` | `#C4D2D8` | 区切り線 |
| `--color-success` | `#1F6E3C` | 成功・完了 |
| `--color-error` | `#B91C1C` | エラー |

### ボタンクラス（M-6）

```html
<button class="btn btn-primary">メインアクション</button>
<button class="btn btn-secondary">補助アクション</button>
<button class="btn btn-ghost">控えめな操作</button>
<button class="btn btn-danger">削除・危険操作</button>
<!-- サイズ修飾子 -->
<button class="btn btn-primary btn-sm">小</button>
<button class="btn btn-primary btn-lg">大</button>
<button class="btn btn-primary btn-full">横幅いっぱい</button>
```

`hidden` 属性は design-system.css の `[hidden] { display: none !important; }` により
`.btn` 等の display 指定より必ず優先される（2026-08-06 共通化。アプリ側で
`[hidden]` の打ち消しルールを個別に持つ必要はない）。

### ボタン階層の定石（1画面1主ボタン）

同じ画面にボタンを複数置くときは、強さを3段階で分ける。**同格の枠線ボタンを
3つ以上並べない**（強弱がなく「バラバラ」に見える。tsuyomi-card 刷新で確立）。

| 段階 | 見た目 | クラス | 用途 |
|------|--------|--------|------|
| 主 | 塗りつぶし | `.btn-primary` | その画面の目的となる操作。**1画面に1つだけ** |
| 副 | 枠線 | `.btn-secondary` | 条件付きで出る補助操作（例: 途中終了時のみの「つづきを見る」） |
| 弱 | テキストリンク風 | アプリ固有（例: `.ty-quiet-btn`） | ナビゲーション系（もどる・最初から・ここまで） |

- 縦に積むときは幅を揃える（主・副は同幅、弱は中央寄せの小さめテキスト）
- 選択肢を同格に見せたい場面（3択・5件法など）は例外。その場合は**全部を同じ
  見た目**にし、主ボタンと混ぜない（suki-type-check の5件法・tsuyomi-card の3択）

### トップ画面の定石（パネル1枚構成）

オフライン系ツールのトップは**パネル1枚**にまとめる（suki-type-check /
tsuyomi-card で実証済みの型）。

1. タイトル
2. 説明文（何が起きるか＋分量・所要時間の目安）
3. 注意点の箇条書き 2〜3個（「正解はない」「まよったら〜でOK」など）
4. 「はじめる」（主ボタン。トップのボタンはこれ1つだけ）
5. 保存の有無（「答えた内容はどこにも保存されない」等）

あそびかたのインライン展開パネルは置かず、説明は howto.js のモーダルに一本化する。

### カードフリップ（M-4）

```html
<div class="flip-card">
  <div class="flip-card-inner">
    <div class="flip-card-face back">裏面</div>
    <div class="flip-card-face front">表面</div>
  </div>
</div>
```
`flip-card.classList.add('flipped')` でフリップ、`.dimmed` で薄くなる。

### その他の共通クラス

```html
<div class="card">          <!-- サーフェスカード -->
<span class="badge badge-primary">ラベル</span>
<div class="alert alert-info">メッセージ</div>
<div class="spinner"></div> <!-- ローディングスピナー -->
<hr class="divider">
```

### CSS 命名規則（アプリ固有スタイル）

アプリ固有の CSS クラスには **アプリ名の短縮接頭辞** を付け、**BEM 記法**（`block__element`）で命名する。

| アプリ | 接頭辞 | 例 |
|--------|--------|-----|
| talk-card | `.tc-` | `.tc-header__title` |
| word-wolf | `.ww-` | `.ww-header__icon` |
| do-mannaka | `.is-` | `.is-score__label` |
| name-change | `.nc-` | `.nc-panel__btn` |
| jitsuwa-game | `.jitsuwa-` | `.jitsuwa-hero__sub` |
| （新アプリ） | 2〜4文字 + `-` | — |

design-system.css のカラー変数・スペーシング変数を積極的に再利用し、独自の固定値はなるべく使わない。

**レスポンシブ対応のブレークポイント**: `600px` 以下でモバイル向けスタイルを上書き。

```css
@media (max-width: 600px) {
  .wrapper { padding: 28px 16px 60px; }
}
```

---

## アイコン

**絵文字は使用しない。** Google Material Symbols Rounded (FILL=1) を使用する。

```html
<!-- head に追加 -->
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,1,0" rel="stylesheet">

<!-- 使用例 -->
<span class="material-symbols-rounded">home</span>
<span class="material-symbols-rounded">person</span>
<span class="material-symbols-rounded">check_circle</span>
```

アイコン名は https://fonts.google.com/icons で検索できる。

---

### 選択肢・カードの番号付け

参加者が画面共有越しにチャット・口頭で「2番！」と答えられるよう、**複数の選択肢を一覧表示する画面では番号を付ける**。

#### 番号は丸数字（`①②③`）で統一

```js
const NUMBERS = ['①', '②', '③', '④', '⑤'];
```

- 半角数字 + ピリオド（`1.`）ではなく丸数字を使う（room-K 内で統一）
- 配列の index から自動採番する（3択以外にも拡張できるよう）
- 5つ以上の選択肢が必要な場合は配列を拡張する

#### 適用する画面

- クイズの選択肢（quiz, kyoumi-sugoroku など）
- ホストが複数のお題から選ぶカード（do-mannaka, tatoe-gp, jitsuwa-game, ishin-denshin など）
- 「自由に話す」など特殊扱いの選択肢には番号を付けない

#### マークアップとスタイル

番号とテキストを別 `span` に分けて flex レイアウトで配置する。番号はアクセントカラー。

```html
<button class="xx-choice">
  <span class="xx-choice__num">①</span>
  <span class="xx-choice__text">選択肢のテキスト</span>
</button>
```

```css
.xx-choice {
  display: flex;
  align-items: center; /* または flex-start */
  gap: 10px;
  text-align: left;
}
.xx-choice__num {
  color: var(--color-accent);
  font-weight: 700;
  font-feature-settings: "palt";
  flex-shrink: 0;
}
.xx-choice__text {
  flex: 1;
}
```

#### チャット貼り付け用コピー機能

「問題をコピー」「答えをコピー」など、チャット貼り付け用のテキスト生成機能がある場合も同じ `①②③` 形式で出力する（UIとコピー先で表記を一致させる）。

```js
choices.forEach((c, i) => lines.push(`${NUMBERS[i]} ${c}`));
```

#### アクセシビリティ

選択肢が画像やアイコンを含む場合は `aria-label` で番号と内容を明示する。

```js
btn.setAttribute('aria-label', `${i + 1}番のお題: ${topic}`);
```

### フォント

```html
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet" />
```

design-system.css の `--font-base` に設定済みのため、body に自動適用される。

---

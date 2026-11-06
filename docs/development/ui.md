# ui — room-K 実装資料

共通の権限・品質基準は [AGENTS.md](../../AGENTS.md)。本文のコードパスはリポジトリルート基準。該当機能を実装・変更・監査するときだけ読む。アプリ固有の明文化された例外を尊重する。

## デザインシステム（`design-system.css`）

### カラートークン（CSS変数）

| 変数 | 値 | 用途 |
|------|----|------|
| `--color-primary` | `#6A4F35` | メインカラー（こげ茶。白い文字が読める濃さ） |
| `--color-accent` | `#286F7C` | アクセント（ティール。主なボタンなど） |
| `--color-bg` | `#F6ECD8` | ページ背景（クリーム） |
| `--color-surface` | `#FFFFFF` | カード・ボックス背景 |
| `--color-text` | `#3F362D` | 本文テキスト（こげ茶） |
| `--color-muted` | `#5C5146` | サブテキスト（淡い灰色の面の上でも読める濃さ） |
| `--color-border` | `#DCCBB0` | 区切り線（あたたかいベージュ） |
| `--color-success` | `#1F6E3C` | 成功・完了 |
| `--color-error` | `#B91C1C` | エラー |

2026-11-06 に、ツール一覧（クリームの画用紙・焦げ茶の文字）に合わせて、紺（`#1C3F5E`）・真っ黒の文字・青みの灰色をあたたかい色に替えた（オーナー判断）。アクセントのティールは、各ツールが淡いティールの面や陣営の色（人狼の村人など）と組み合わせて使っているので色合いを残し、クリームの地や淡いティールの面の上でも文字が読めるよう少しだけ濃くした（`#2E7D8C` → `#286F7C`）。新しく書く色は、紺や青みの灰色を直接書かず、上の変数を使う。各ツールに直接書いてある紺系の色は、まだ残っている（少しずつ変数に置きかえる）。

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

### たまに使う操作をたたむ（「そのほかの操作」「くわしい設定」）

ホスト（進行役）の画面は操作が増えやすい。毎回使う操作だけを本文に置き、たまに使う操作はたたんで、開くと出るようにする（kotoba-meter・reversi・nemurase-kichi）。

- **「そのほかの操作」**: やり直す・点を0にもどす・ここでおしまい・1手もどす・端末なしの参加者を足す など。本文には主な操作（はじめる・締め切って公開・次へ・もう一回）だけを置く。取り消せない操作は確認を出す
- **待合室の「くわしい設定」**: はじめてのホストがまず決めることだけ（2つ程度）を上に出し、ほかの設定はたたむ。設定が多いときは、まとまりごとに見出しを付け、それぞれの下に「何が変わるか」を1行で書く（例「短いほど、ねむらせ屋が有利」）。メンター向けの心得（声かけなど）は書かない
- 待合室の「はじめる」は、設定が長くてもすぐ押せる位置に置く（下に固定するなど。nemurase-kichi）
- 参加者の画面には、ホストが選んだ設定の要約だけを出す（設定の操作は出さない）

### トップ画面の定石（パネル1枚構成）

オフライン系ツールのトップは**パネル1枚**にまとめる（suki-type-check /
tsuyomi-card で実証済みの型）。

1. タイトル
2. 説明文（何が起きるか＋分量・所要時間の目安）
3. 注意点の箇条書き 2〜3個（「正解はない」「まよったら〜でOK」など）
4. 「はじめる」（主ボタン。トップのボタンはこれ1つだけ）

保存の有無（「答えた内容はどこにも保存されない」「このアプリには何も残りません」「ゲームが終わると消えるよ」等）は
画面・あそびかた・説明スライドに書かない。書くと、かえって「何か保存されるのでは」と不安になる子がいるため
（2026-10-19 オーナー判断で定石から外し、既存アプリからも削除）。ボタンを押すと何が消えるかの確認文
（「選びなおすと、みんなのカードは消えます」など）は操作の説明なので対象外。

あそびかたのインライン展開パネルは置かず、説明は howto.js のモーダルに一本化する。

### お題表示の定石（白カード＋ティール枠）

参加者が画面共有で見る「お題」（トーク・ゲームのお題、秘密のことば、セリフなど）は、
アプリをまたいで同じ見た目にする（2026-09-24 統一。talk-card の型を標準にした）。

| 部位 | 指定 |
|------|------|
| 枠 | `background: var(--color-surface)`、`border: 2px solid var(--color-accent)`、`border-radius: var(--radius-box)`、`padding: 32px 40px`（600px以下 `24px 20px`）、中央寄せ、影なし |
| ラベル | 枠の中の先頭。13px・500・`var(--color-accent)`・`letter-spacing: 0.08em`・下に12px |
| 本文 | 700・`var(--color-primary)`・`line-height` 1.3〜1.5・`overflow-wrap: anywhere` |
| 本文サイズ | 単語・短いお題は 36〜44px（600px以下 28〜34px）、文のお題は 26〜30px（600px以下 20〜24px） |

- ラベルの文言は「お題」。自分だけに見えるお題は「あなたのお題」。アプリの内容に合わせた言い方（「今日のお題」「今回のセリフ」「スターター」など）は可
- 「第N問」「ラウンドN/M」などの進行表示は枠の外（上）に置き、ラベルと兼ねない
- 紺の塗りやグラデーションの帯、点線の枠、枠なしの大きな文字でお題を出さない
- 遊んでいる途中の再確認用の小さな札（`primary` 塗りの丸い札。word-wolf・magire-eshi・jinro）はこの型の対象外
- 問題文と選択肢を並べるクイズ・診断型（quiz・kotoba-theme・suki-type-check・tsuyomi-card・docchi）は「問題カード」として扱い、この型の対象外

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

### 文字入力欄と日本語入力（IME）

参加者は日本語入力をオンにしたまま打つことが多い（名前を入れた直後など）。

- 打っている間（`input` イベント）に `value` を書き換えない。変換中に書き換えると文字が重なる。大文字にそろえる等は、表示なら CSS、値なら送信時に行う（ルームコード欄の具体例は [rtdb.md](rtdb.md)「参加・共有の共通UI」）
- Enter で送信・追加する `keydown` は、`if (e.isComposing || e.keyCode === 229) return;`（または条件に `!e.isComposing && e.keyCode !== 229`）で変換の確定を除く。Safari は確定の Enter を `isComposing=false`・`keyCode 229` で届けるため、`isComposing` だけでは確定しただけで送信してしまう（2026-09-30）。`keyCode 229` の除外は MDN も勧める書き方。変換していなくても Enter を 229 で届ける環境では Enter が効かなくなるので、Enter は補助にとどめ、同じ操作を必ずボタンでもできるようにする


### マイクを使わない子が参加できる手段（2026-11-04）

マイクをONにして話すのが難しい子もいる（2026-11-04 オーナー「マイクONでコミュニケーションが取れない人がコミュニケーションを取れる手段があればいい」）。話し合い・読み上げが遊びの中心になるゲームは、声のほかの参加のしかたを用意する。

- **「ひとこと」（決まった言葉をボタンで送る）**: 自由に打つ欄は置かず、決まった言葉の一覧から選んでみんなに知らせる（nemurase-kichi・kakure-kaito）。言葉は**オーナーが承認**し、データにまとめて持つ（例: `SAYS`）。人の名前が入る言葉は、押したあとに「だれ？」で選ぶ。**ひとり5秒に1回まで**（端末で止め、早いときはそう出す）。送れるのは遊んでいる人だけ（進行だけのホスト・見ているだけの人・みんなにみせる画面は送らない）。音は鳴らさない
- **声を出さない役で加わる**: 読む・話す役のほかに、書く・判定するだけで加われる形を用意する（kanpe-housou の「書くだけ」）。本人が待合室で選び、ホストも切りかえられるようにする
- **マイクの約束を画面に出す**: アプリは Zoom / Meet のマイクを操れないので、必要な場面だけ「いまはミュートの時間」「読む人のほかのみんなは、マイクをOFFにしてね」などの帯を出す（nemurase-kichi・kanpe-housou）。帯は進行役の画面・みんなにみせる画面にも出す
- 配慮の理由は画面・あそびかた・更新情報に書かない（ルート AGENTS.md「参加のしかたと結果の出し方」）

---

## アイコン

ツール一覧のカードは、種類（`data-genre`）の色の面に、そのツールのイラスト（`.app-card__illust`）を出す（2026-11-05 から）。イラストの決まりと作り方は [illustrations.md](illustrations.md)。
ツール一覧のページだけ、イラストに合わせた見た目にしている（2026-11-06。オーナーの方針は「シンプルで、はじめて見る人・使う人にもわかりやすく、ユニバーサルデザインに配慮し、余計な装飾はなるべく使わない」）。地はクリームの画用紙のような細かい粒の質感（`#F6ECD8` ＋ `assets/paper-grain.png`）、面は白で枠なし・やわらかい影だけ（色の枠・色の影・テープ・傾け・クレヨンの線などの飾りは使わない）、文字はあたたかい焦げ茶 `#3F362D`、ボタンやリンクは `#6A4F35`（紺は使わない）、見出しとタブとカードの名前とボタンは Zen Maru Gothic。種類は、カードの絵の面とタブの淡い色・タブの小さな絵で見分ける（並び順「種類順」の見出しも、同じ絵・名前・すぐ横の本数・下の種類の色の細い線だけ）。説明の窓のボタンは、主な操作「このツールをひらく」を1段目に大きく、2段目に「説明スライド」「とじる」を並べる。各ツールの画面は共通の design-system.css のまま。
ツールを探す前に長く読ませないよう、更新情報はいちばん新しい1件を1行（スマホは2行）だけ出し、ほかは「ほかの更新を見る」で開く。字は画面共有でもつぶれにくいよう、札・補足も 13px 以上・本文 14px 以上にし、カードの「説明」ボタンは見た目より広く（高さ 44px）押せるようにしている（2026-11-06）。
イラストがない・読み込めないときは、カードのアイコン（`.app-card__icon` の Material Symbols）を白い丸で大きく出す。カードのアイコンは、同じ種類のほかのカードと見分けやすいものを選ぶ。
プレイ・操作画面のサムネイルは、カードにマウスを当てたとき・キーボードで選んだとき・「説明」を押したときの説明に出す。撮影範囲・更新方法は [thumbnails.md](thumbnails.md) を参照。

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

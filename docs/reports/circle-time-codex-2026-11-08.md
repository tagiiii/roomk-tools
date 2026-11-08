# Codex の点検（2026-11-08 夜・gpt-5.6-sol・読み取りのみ）

UIUX・デザイン・ユニバーサルデザインの観点。依頼文は同じフォルダの codex-2026-11-08-prompt.md。

読み取りのみで点検しました。ファイル変更・ブラウザー操作はしていません。評価は、提示画像と静的な HTML/CSS/JS の確認に基づきます。

## 高

### 1. 共有時に補助情報と天気画面が小さすぎる

- 問題  
  1280×720 の舞台が MetaLife 上で約50%に縮むと、進行タブ19px→約9.5px、足元24px→約12px、天気の都市名19px→約9.5px、出典14px→約7px相当になります。画像①の「全国の天気」は、地図・13都市・回答欄・出典が同居し、実際にかなり判読しづらい状態です。
- 根拠  
  画像①の「全国の天気」「ジブンチェック」「今日は何の日」。[index.html:598](../../../drafts/circle-time/index.html:598)、[index.html:602](../../../drafts/circle-time/index.html:602)、[index.html:605](../../../drafts/circle-time/index.html:605)、[index.html:1585](../../../drafts/circle-time/index.html:1585)。
- 直し方  
  共有画面は「640×360で読める」を基準にし、重要本文は舞台上36px以上、補助情報は28px以上を目安にします。上部は全項目名を並べず「いま：心　つぎ：体」のように絞る方法が有効です。天気は「主要6都市＋きみのところ」または東西2画面に分け、都市名28px、気温32px程度にします。出典は画面下に20px以上で確保します。

### 2. 画面更新でキーボードフォーカスと読み上げ文脈が失われる

- 問題  
  ルーム更新のたびに参加者カードやホスト一覧を `innerHTML` で全面再生成しています。ボタン操作中にフォーカスが消える、スクリーンリーダーが画面変更や送信成功を把握できない可能性があります。画面切り替え時のフォーカス移動、ライブ領域、ダイアログのフォーカストラップもありません。
- 根拠  
  [index.html:1039](../../../drafts/circle-time/index.html:1039)、[index.html:1044](../../../drafts/circle-time/index.html:1044)、[index.html:1632](../../../drafts/circle-time/index.html:1632)、[index.html:1653](../../../drafts/circle-time/index.html:1653)、[index.html:1725](../../../drafts/circle-time/index.html:1725)、[index.html:1795](../../../drafts/circle-time/index.html:1795)。
- 直し方  
  画面切り替え後は、その画面の見出しへ `tabindex="-1"` を付けて `focus()`。主要画面は `<main>`、状態更新には `role="status" aria-live="polite"` を使用します。接続断は `role="alert"`、オーバーレイは `role="dialog" aria-modal="true" aria-labelledby="overlay-title"` とし、表示前のフォーカスを保存・復帰します。更新時は操作中の要素を丸ごと置換せず、必要なテキストと属性だけ変更します。

### 3. 「1コマ目」が学校を直接連想させる

- 問題  
  共通ガイドラインの「学校・勉強を連想させる内容を避ける」と衝突します。画像①の移動案内や参加者画面にも大きく表示されます。
- 根拠  
  [AGENTS.md:98](../../../AGENTS.md:98)、[index.html:1490](../../../drafts/circle-time/index.html:1490)、[index.html:1555](../../../drafts/circle-time/index.html:1555)、[index.html:1582](../../../drafts/circle-time/index.html:1582)、[index.html:1676](../../../drafts/circle-time/index.html:1676)、[index.html:1719](../../../drafts/circle-time/index.html:1719)。
- 直し方  
  「最初のプログラム」「9:30からのプログラム」「このあとのプログラム」に統一します。時間割一覧も「1コマ目」ではなく時刻そのものを見出しにします。

### 4. 心・体の数値と名前、理由が公開されることへの理解が不足する

- 問題  
  名前を1〜5の状態に直接結び付け、理由も共有画面で拡大表示できます。仕様どおりの実装ですが、気分や体調が低い参加者ほど目立つ心理的リスクがあります。参加者画面では理由の公開は説明されていますが、「数字と名前が共有画面に出る」ことは明示されていません。
- 根拠  
  画像①「ジブンチェック 心」、画像③の参加者一覧。[AGENTS.md:114](../../../AGENTS.md:114)、[circle-time/AGENTS.md:52](../../../drafts/circle-time/AGENTS.md:52)、[circle-time/AGENTS.md:90](../../../drafts/circle-time/AGENTS.md:90)、[index.html:1516](../../../drafts/circle-time/index.html:1516)、[index.html:1700](../../../drafts/circle-time/index.html:1700)。
- 直し方  
  現在の公開方針を維持する場合でも、送信直前に「送ると、数字のところに名前が出るよ」を常時表示します。理由表示は一度に1件の現状を維持し、10秒程度で自動的に閉じる、ホストプレビュー側だけで開閉できるようにするのが安全です。低い数値だけを別色・拡大・上位表示しないことも維持してください。

### 5. モバイルの拡大を制限している

- 問題  
  `maximum-scale=1` は、弱視や小さい文字を拡大したい利用者のピンチズームを制限する可能性があります。
- 根拠  
  [index.html:5](../../../drafts/circle-time/index.html:5)。
- 直し方  
  `content="width=device-width, initial-scale=1"` とし、最大倍率を指定しません。

## 中

### 6. 実効コントラストに複数の不合格がある

WCAGの相対輝度式で計算した値です。

| 組み合わせ | 比率 | 判定・用途 |
|---|---:|---|
| `#3F362D` / `#FFFFFF` | 11.82:1 | 本文・合格 |
| `#5C5146` / `#FFFFFF` | 7.72:1 | 補助文・合格 |
| `#8A4A10` / `#FFFFFF` | 6.85:1 | アクセント文字・合格 |
| `#FFFFFF` / `#8A4A10` | 6.85:1 | 主ボタン・合格 |
| `#8F7D63` / `#FFFFFF` | 3.98:1 | 19px太字の進行表示は数値上合格。ただし縮小後は小さすぎる |
| `#DCCBB0` / `#FFFFFF` | 1.59:1 | 未選択ボタンの境界として不足 |
| `#6FA7D9` / `#FFFFFF` | 2.56:1 | 雪アイコン・非テキスト3:1未満 |
| `#3F362D`を45%表示 / 白 | 2.45:1 | 済んだ目次項目・不合格 |
| `#8A5A12`を45%表示 / 白 | 1.99:1 | 済んだ午前色・不合格 |
| `#8C8C8C` / `#FFFFFF` | 3.36:1 | 雲アイコン・非テキストは合格 |
| `#2E6DB4` / `#FFFFFF` | 5.30:1 | 最低気温・合格 |
| `#C0392B` / `#FFFFFF` | 5.44:1 | 最高気温・合格 |

- 根拠  
  [index.html:94](../../../drafts/circle-time/index.html:94)、[index.html:103](../../../drafts/circle-time/index.html:103)、[index.html:257](../../../drafts/circle-time/index.html:257)、[index.html:337](../../../drafts/circle-time/index.html:337)、[index.html:367](../../../drafts/circle-time/index.html:367)。
- 直し方  
  済んだ項目は `opacity` を使わず、文字を `#5C5146` のままにして「済」またはチェックアイコンを追加します。操作対象の境界は少なくとも `#8F7D63` 相当へ。雪は最低気温と同じ `#2E6DB4` などへ濃くします。

### 7. 丸数字の仕様が目次・準備画面では守られていない

- 問題  
  目次は「1」を塗り丸に入れており、仕様の「①の文字だけ、丸背景なし」と不一致です。画像①の目次でも確認できます。
- 根拠  
  [circle-time/AGENTS.md:51](../../../drafts/circle-time/AGENTS.md:51)、[ui.md:228](../../../docs/development/ui.md:228)、[index.html:365](../../../drafts/circle-time/index.html:365)、[index.html:689](../../../drafts/circle-time/index.html:689)、[index.html:1483](../../../drafts/circle-time/index.html:1483)、[index.html:1668](../../../drafts/circle-time/index.html:1668)。
- 直し方  
  `['①','②','③',…][i]` を使い、背景・固定幅・`border-radius` を外します。準備画面の候補番号も同様にします。

### 8. 入力欄のラベルと選択グループの意味付けが不足する

- 問題  
  動的な「わけ・ひとこと」欄、端末のない人の名前、ゲームリンク、記念日候補には、関連付けられた `<label>` がないものがあります。単一選択も押しボタンの集合で、グループ名が読み上げられません。
- 根拠  
  [index.html:689](../../../drafts/circle-time/index.html:689)、[index.html:805](../../../drafts/circle-time/index.html:805)、[index.html:821](../../../drafts/circle-time/index.html:821)、[index.html:1701](../../../drafts/circle-time/index.html:1701)、[index.html:1703](../../../drafts/circle-time/index.html:1703)。
- 直し方  
  `<label for="p-note">わけ・ひとこと（なくてもOK）</label>` のように関連付けます。5段階は `<fieldset><legend>いまの気持ちは、どのへん？</legend>` とネイティブのラジオ、または `role="radiogroup"` と `role="radio"` を使います。公開範囲の説明は `aria-describedby` で関連付けます。

### 9. ホスト一覧が回答のたびに並び替わり、押し間違いを招く

- 問題  
  未回答者を先頭にするため、回答が届くたびに参加者行が移動します。名前のすぐ下に多数の代理回答ボタンがあり、進行しながら操作する画面としては位置が安定しません。
- 根拠  
  画像③の右列。[index.html:551](../../../drafts/circle-time/index.html:551)、[index.html:1842](../../../drafts/circle-time/index.html:1842)。
- 直し方  
  参加順を固定し、未回答は「未」の札や左端の印で示します。必要なら「未回答だけ表示」を別操作にします。代理回答ボタンは最低44×44pxにし、天気など文字が長い場合は選択メニューを開く形にします。

### 10. 待機・送信・通信状態が支援技術へ通知されず、連打も防げない

- 問題  
  「取りにいきます」「送ったよ」「通信が切れています」はテキスト更新だけです。送信中のボタン無効化や「送信中」状態もなく、遅い通信で再送しやすくなります。
- 根拠  
  [index.html:1049](../../../drafts/circle-time/index.html:1049)、[index.html:1755](../../../drafts/circle-time/index.html:1755)、[index.html:2030](../../../drafts/circle-time/index.html:2030)。
- 直し方  
  準備一覧に `aria-live="polite"`、接続断に `role="alert"`、読み込み中のまとまりに `aria-busy="true"` を付けます。送信中はボタンを無効化して「送信中…」、成功後にライブ領域で「5を送ったよ」、失敗時には同じ場所へ再試行ボタンを出します。

### 11. 共通ボタン階層にない `btn-outline` を多用している

- 問題  
  共通CSSには `btn-primary`、`btn-secondary`、`btn-ghost` はありますが、`btn-outline` の定義がありません。画像上でも副操作の強弱が弱く、ブラウザー既定表示に依存します。
- 根拠  
  [index.html:653](../../../drafts/circle-time/index.html:653)、[index.html:746](../../../drafts/circle-time/index.html:746)、[index.html:777](../../../drafts/circle-time/index.html:777)、[index.html:786](../../../drafts/circle-time/index.html:786)。
- 直し方  
  条件付きの補助操作は `btn-secondary`、ナビゲーションや低頻度操作は `btn-ghost` またはテキストボタンに置換します。ホスト画面では「次へ」を唯一の常設主ボタンとし、「せーので見せる」などは該当画面だけ主ボタンにします。

### 12. プレイ中の小イラストが共通仕様と競合する

- 問題  
  共通仕様は「プレイ中は絵を置かない」ですが、各中身画面の右上に96pxの絵があります。画像①では視線を散らし、質問本文の横幅も削っています。
- 根拠  
  [ui.md:80](../../../docs/development/ui.md:80)、[index.html:559](../../../drafts/circle-time/index.html:559)、[index.html:1499](../../../drafts/circle-time/index.html:1499)。
- 直し方  
  イラストは表紙・目次・移動案内に限定し、中身画面はMaterial Symbolsの小見出しだけにします。

## 低

### 13. 見出しとランドマークの階層が画面ごとに不統一

- 問題  
  参加者画面は動的な `h2` から始まり、ホストは `h3` から始まります。画面単位の主見出しと `<main>` がありません。
- 根拠  
  [index.html:259](../../../drafts/circle-time/index.html:259)、[index.html:292](../../../drafts/circle-time/index.html:292)、[index.html:1664](../../../drafts/circle-time/index.html:1664)。
- 直し方  
  各画面に1つの `h1` を設け、視覚上不要なら `.sr-only` にします。主要領域を `<main>`、流れを `<nav aria-label="サークルタイムの流れ">`、参加者一覧を `<aside>` にします。

### 14. アイコンだけのボタンが `title` に依存する

- 問題  
  前へ、並べ替え、外すなどは、可視ラベルがなく `title` のみです。タッチ操作では `title` が表示されず、読み上げも環境差があります。
- 根拠  
  [index.html:777](../../../drafts/circle-time/index.html:777)、[index.html:1795](../../../drafts/circle-time/index.html:1795)、[index.html:1843](../../../drafts/circle-time/index.html:1843)。
- 直し方  
  `aria-label="前の画面へ"`、`aria-label="ゆいを参加者から外す"` のような名前を付けます。頻繁に使う「前へ」はアイコン＋文字にするとさらに明確です。

### 15. 進行状況が色だけで表現される箇所がある

- 問題  
  参加者画面上部の空の棒は、現在・完了を色だけで示します。スクリーンリーダーには情報がなく、色覚差やモノクロ表示でも分かりません。
- 根拠  
  画像②上端。[index.html:256](../../../drafts/circle-time/index.html:256)、[index.html:1657](../../../drafts/circle-time/index.html:1657)。
- 直し方  
  棒を装飾扱いにするなら `aria-hidden="true"` とし、別途「3／5　みんなでゲーム」のテキストを表示します。情報として扱うなら現在項目に `aria-current="step"` を付けます。

## よくできている点

- 「ボタン・チャット・声」「話したい」「チャットに書いたよ」「パス」「聞くだけでもOK」が複数画面に用意され、マイクや専用端末に依存しない参加経路がよく考えられています。
- 参加者の5段階は選択後に明示的な「送る」が必要で、誤送信を減らしています。送信済みの表示もアイコン・文字・色を併用しています。
- 画面共有用、参加者用、ホスト用で情報量を分け、ホスト画面にだけ編集や代理入力を置いている構成は適切です。
- `prefers-reduced-motion` で画面遷移とくじの点滅を停止しており、音も使っていません。[index.html:619](../../../drafts/circle-time/index.html:619)
- 基本文字色、アクセント文字、主ボタンのコントラストはそれぞれ11.82:1、6.85:1、6.85:1で十分です。全体の余白、焦げ茶とクリームの統一感、表紙から中身へ進むジャンプ率も良好です。
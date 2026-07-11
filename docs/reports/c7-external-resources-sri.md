# C-7 調査報告: 外部リソース棚卸しと SRI 必須 lint（DEP-2）の設計（2026-07-12）

バックログ C-7（調査・報告のみ、lint 実装は別項目として起票し直す）の成果物。
apps 配下全 HTML の外部リソースを機械列挙し、SRI 可否を仕分け、DEP-2 の検出ロジックを
fixture で実証した。

## 外部リソースの棚卸し（apps 配下全 HTML・2026-07-12 実測）

| リソース | 件数 | SRI | 判定 |
| --- | --- | --- | --- |
| fonts.googleapis.com の css2（Noto Sans JP / Zen Kaku / Material Symbols 等 7変種） | 計115 | 不可 | **許可リスト**。UA によって応答 CSS が変わるため SRI は原理的に付けられない |
| fonts.googleapis.com / fonts.gstatic.com への preconnect | 計28 | 対象外 | リソース取得ではないため SRI 概念なし |
| www.gstatic.com/firebasejs/10.14.1 の compat 3本（app/auth/database） | 14アプリ×3=42 | **未付与** | 版数固定済み。SRI は技術的に可能だが Google は公式ハッシュを公開していない（下記） |
| cdn.jsdelivr.net の sortablejs@1.15.7（value-card） | 1 | **付与済み** | A-3 で対応済み（sha384） |
| cdnjs の html2canvas 1.4.1（value-card） | 1 | **付与済み** | A-5 で対応済み（sha512・2経路照合） |

- `@import` / `url(https...)` による外部 CSS 参照はゼロ
- `@latest` はゼロ（既存 DEP-1 が担保）
- **つまり「SRI を付けられるのに付いていない」のは Firebase SDK 42タグだけ**

## Firebase SDK への SRI 付与の論点

- Google は firebasejs の SRI ハッシュを公式公開していない。版数固定 URL の内容は安定が期待されるが、
  公式保証はない（再ビルド配信があれば全14アプリが一斉起動不能になるリスクと、改竄検知の利益の交換）
- 2経路照合の第2経路として、npm パッケージ `firebase` の同版 compat ビルド
  （cdn.jsdelivr.net/npm/firebase@10.14.1 配下）との内容一致確認が使える見込み（未実施）
- 選択肢: (a) SRI を付与する（Tier B・2経路照合＋全アプリ起動確認つき） /
  (b) gstatic firebasejs を許可リストに入れて DEP-2 の対象外とし、理由を lint 内コメントに明記
- **推奨は (b) 先行**。理由: ①一斉起動不能の破壊半径が大きい ②SDK 版上げ（将来の保守）のたびに
  42箇所のハッシュ更新が必要で運用コストが高い ③rules 側で書き込みを制約する C-6 の方が防御効果が大きい

## DEP-2 lint の設計（実装は本項目に含まない）

- **実装方式**: 既存 lint.sh の PORTAL-1 と同様の python ヒアドキュメント。grep 1本では
  属性順序・改行またぎを扱えないため
- **検出ロジック**（fixture 実証済み）: `<script ...>` タグ全体を `re.S` 付き正規表現で抽出し、
  タグ内で `src`（http(s):// またはプロトコル相対 //）・`integrity="sha256/384/512-..."`・
  `crossorigin="anonymous"` を**順不同**で判定。fonts.googleapis.com / fonts.gstatic.com は許可
- **fixture 検証結果（11ケース全て意図通り）**: 属性順序逆・改行またぎ・シングルクォートは誤検知なし。
  SRI なし・integrity のみ（crossorigin 欠落）・偽 integrity（md5-）・プロトコル相対は正しく検出。
  ローカル script・インライン script 内の URL 文字列は対象外として素通り
- **実アプリへの適用結果**: 検出は firebasejs 42タグのみ（他はゼロ）。firebase の扱い（上記 a/b）を
  決めてから導入しないと、導入初日から全 RTDB アプリが WARN/ERROR まみれになる
- **警告期間の設計**: 導入時は WARN として1サイクル（次の実機セッションまで）運用し、
  誤検知報告がなければ ERROR へ昇格。ERROR 昇格後は firebase の決定（a なら SRI 付与済みのはず、
  b なら許可リスト入り）により検出ゼロが定常
- **link rel="stylesheet" への拡張**は不要（外部 CSS は Google Fonts のみ＝許可リスト）

## 起票について

lint 実装（DEP-2 導入＋firebase 方針）は別項目として判断待ちに起票すべきだが、
**本ループ実行の新規起票が上限3件（P-5〜P-7）に達したため、起票は次回ループ実行に持ち越す**
（運用ルール9の流入上限。次回起票予定: 「DEP-2 lint の導入と firebase SDK の扱い(a/b)」）。

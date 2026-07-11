# C-8 調査報告: モーダル/オーバーレイの分類調査と a11y 実装案（2026-07-12）

バックログ C-8（分類先行・実装は分類確定後に別起票）の成果物。全アプリの overlay/modal/sheet
要素を機械抽出し、内部の操作要素の有無で dialog / status / alert に分類した。

## 分類結果

### status（通知のみ・操作なし → `role="status"` + `aria-live="polite"` を付与）

| 対象 | アプリ数 | 内容 |
| --- | --- | --- |
| reconnect-overlay | 12 | 「つなぎなおしています…」の全画面表示。ボタンなし |
| loading-overlay | 3（checkin / codenames / vote） | 読み込み中表示。ボタンなし |
| host-disconnect-countdown | 4（iisen-show / kakure-number / pittari-meter / tatoe-gp ほか同型） | 切断オーバーレイ内の残り秒数。**毎秒更新のため aria-live は秒数ノードに付けない**（読み上げが毎秒割り込む）。状態文（「ホストの接続が切れました」）側に1回だけ通知させる |

### dialog（操作あり → 下記「dialog 実装パターン」を一体適用）

| 対象 | アプリ数 | 操作 | 現状 |
| --- | --- | --- | --- |
| host-off / host-disconnect / host-gone overlay | 13 | 「退出する」ボタン1個＋カウントダウン | role なし・フォーカス管理なし |
| nitaku-board の picker / detail シート | 1 | ボタン2＋入力2 / ボタン2 | **role="dialog"＋aria-modal 付与済みだがフォーカス管理なし＝「偽モーダル」状態**（C-8 の禁止事項に該当。唯一の該当） |
| jinro の rules-modal / rules-sheet | 1 | 閉じるボタン | role なし・背景クリックで閉じる・Escape なし |
| kyoumi-sugoroku の ks-modal 群（question/choices/goal） | 1 | 進行ボタン2 | role なし |
| howto.js（共有・全アプリの あそびかたモーダル） | 37 | 閉じるボタン | **最も準拠**: role="dialog"・aria-modal・開閉時のフォーカス移動/復元・Escape 実装済み。残るはフォーカストラップ（Tab が背景へ抜ける）と背景 inert のみ |

### alert（緊急通知）

該当なし。トースト（rtdb-utils showToast）は B-9 で `role="status"` 対応済み。

## dialog 実装パターン（1アプリ1コミットで適用する一体仕様）

フォーカス管理なしの `aria-modal` 単独付与は「偽モーダル」として禁止（C-8 条件）。適用は必ず以下セットで:

1. `role="dialog"` + `aria-modal="true"` + `aria-labelledby`（モーダル内見出しの id）
2. 表示時: `document.activeElement` を保存 → モーダル内の最初の操作要素（退出ボタン等）へ `focus()`
3. 非表示時: 保存した要素へフォーカス復元（要素消滅時は本文へ）
4. 背景の不活性化: メインコンテナへ `inert` 属性を付与/除去（全対象ブラウザで利用可。
   キーボードトラップの独自実装より単純で漏れがない）
5. 閉じる操作を持つモーダル（rules / howto / picker）は Escape で閉じる。
   ホスト切断オーバーレイは「閉じる」概念がないため Escape 対象外（操作は退出のみ）
6. 検証: Tab 巡回がモーダル内に閉じること・閉じた後に元の位置へ戻ることをブラウザで実測

## 実装の優先順位（Tier B 起票案・報告のみ）

1. **nitaku-board の偽モーダル解消**（既に aria-modal を名乗っているため、支援技術に対して
   現状が最も誤解を与える。適用パターンの雛形にも適する）
2. **host-off / host-disconnect overlay 13本**（子どもが実際に遭遇する頻度が最も高い dialog）
3. **howto.js のフォーカストラップ＋inert**（共有 apps/shared のため個別承認が必要な旨を明記）
4. jinro rules / kyoumi-sugoroku ks-modal（利用頻度順で最後）

reconnect / loading の status 付与は属性追加のみで低リスク（同じ起票にまとめてよい）。

## 起票について

実装項目の起票は、本ループ実行の新規起票が上限3件（P-5〜P-7）に達したため**次回ループ実行に持ち越す**
（C-7 と同様。次回起票予定: 「C-8 分類に基づく dialog 実装パターン適用（優先順1〜4）＋status 付与」）。

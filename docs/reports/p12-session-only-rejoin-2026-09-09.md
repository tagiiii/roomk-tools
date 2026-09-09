# P-12 / B-32：保存セッションに復帰を限定する（2026-09-09）

基準コミット: `b50a9fe738fd2a03242dd62549396f478137adfd`。

## 承認と変更範囲

オーナーは「名前だけの復帰を廃止し、保存済みセッションからの復帰を維持する」方針を承認した。対象はkakure-number、pittari-meter、do-mannaka、tatoe-gp、uso-jishoの5本。P-12案①をB-32へ昇格し、他の保留5件は変更しない。

各`guestJoin()`から、進行中に既存ゲスト名を入力するとstate・切断予約・session保存・listener開始へ進む早期分岐だけを削除する。既存の「このルームはすでにゲームが始まっています」エラーへ進み、参加フォームからの入室はwaiting時に限定される。ホスト名は従来のB-24重複メッセージで拒否する。

主担当と別コンテキストの担当が、それぞれ旧版から当該分岐だけを除いた文字列と現行HTMLのbyte完全一致を確認した。`tryReconnect()`、通常参加transaction、ホスト名ガード、入力変換・描画、TTL・得点・勝敗は変更していない。固有AGENTSの同名復帰記述を訂正し、updatesにはスタッフ向けの方式変更を記載する。

## 保存セッションの復帰と限界

初期化時に呼ばれる`tryReconnect()`は`guestJoin()`と独立している。参加していたタブに保存情報が残り、ルームが存在して期限内で読み書きできる場合の、従来の復帰経路を維持する。新しいタブ・別端末や、明示退出等で保存情報を失った状態から名前だけで復帰する手段は提供しない。waitingで名前のplayerも消えていれば新規参加は可能だが、これは復帰ではない。

| アプリ | 既存guest player欠損時の扱い |
| --- | --- |
| kakure-number | 保存scoreで再追加。round内の配布数字・提出予想は、別ノードに残っている範囲で再利用 |
| pittari-meter | guessはnull、decidedはfalseで再追加。scores・turnOrder・確定結果等は別ノードだが、未確定の予想保持は保証しない |
| do-mannaka | 保存scoreで再追加しanswerはnull。提出回答の完全保持は保証しない |
| tatoe-gp | 保存score・answer・voteで再追加。ただし保存値のround世代を照合する仕組みは今回追加しない |
| uso-jisho | 保存scoreで再追加。entries・votesは別ノードに残る範囲で利用 |

いずれも既存のguest本体`onDisconnect().remove()`方式を変えていない。P-11で改修済みの別アプリと同等の「切断時も全データを保持する」保証ではない。sessionStorageやクライアントのroleはサーバー側の本人認証・アクセス制御ではなく、任意のJavaScript実行や保存値の改変まで防ぐ修正ではない。

既存のget→set間のルーム削除競合、旧接続の遅い削除、保存値の世代や型の不十分な確認、通常参加transactionの古いsnapshot fallback等はこの差分では修正していない。これらを解決済みと扱わず、別の復帰改善範囲として残す。本番Firebase・rules・shared・CI・iPhoneは対象外。

## A-11の証拠との関係

A-11対象のdo-mannaka、kakure-number、tatoe-gpでは行番号・ファイルSHAが変わる。旧SHA固定報告・照合器・保存JSONを新しい値に書き換えない。今回の差分レビューでは、削除した参加分岐以外がbyte不変であり、既存44参照の表示sink・入力変換を変更しないことを確認した。これは今回の限定差分の再確認であって、旧照合器を現行ソースに対してPASSさせたという主張ではない。

## 検証結果

- [実関数抽出VM](evidence/p12-session-only-2026-09-09.mjs)と[保存JSON](evidence/p12-session-only-2026-09-09.json): 152ケースPASS。旧同名受入と新拒否、拒否時state・書込み・切断予約・session保存・listenerの副作用なし、waiting新規参加の旧新版一致、保存guest／host復帰を確認した。全25宣言フェーズ×guest在存／欠損の50件、終了hostの既存期限再予約5件、期限切れ判定をtrueにした保存復帰10件・参加掃除5件を含む。初期82件と一部重複するため152個の独立した実利用シナリオとは数えない。
- 期限切れ判定・認証・保存読出し・presence・listenerはスタブ。期限切れの実時間計算、タイマー発火、SDKの切断予約実行、壊れたsessionのJSON parse、複数端末の同期・競合は未検証。終了再予約はhelper引数の確認のみ。既存終了後／欠損player再登録も変更せず、望ましい仕様と新たに認定しない。
- [隔離ブラウザ結果](evidence/p12-session-only-browser-2026-09-09.json): 各5アプリで進行中既存guest、host、host player欠損、未使用名の拒否、waiting重複拒否、新規参加成功の計30ケースPASS。拒否時はDB getだけでwrite／transaction／予約／session保存／listenerは0。waiting新規は各1回でguestへ進む。実フォーム・実guestJoin・実validateNickname・実エラー表示を使い、成功先はstubでゲーム画面へは進めていない。
- 全5本の進行中拒否を1280px／375pxでDOM計測し横スクロールなし。かくれナンバー375pxとうそつき辞書1280pxはスクリーンショットも目視。取得した各ページのerror／warnログは空。元inline CSSと共有CSSを使うが、fixture用に画面の表示指定を上書きし、外部フォント・アイコン・howtoを除去しているため本番全体のレイアウト同一性は保証しない。
- ブラウザ用コピーは実SDK・stats・元scriptを除去し、CSP `connect-src 'none'` で配信した。DB・保存・購読はメモリstubのみ。テスト用タブを閉じviewportを復元、127.0.0.1のサーバー停止と一時serverファイルの除去を実施。既存証拠は削除していない。
- lint全16項目、diff check、A-11の158fixture・shell統合9件PASS。現行71ファイルのERROR 0・unknown 44は同じ13アプリのまま。

## 独立レビュー

実装担当と別コンテキストの担当が5本のコード・固有文書・更新情報を確認し、追加修正要求なし。VMはさらに別担当が152件を独立再実行し保存JSONと完全一致を確認した。全フェーズ・期限切れ分岐・終了予約の補強後に再レビューPASS。同系統の別コンテキストによる確認であり、異系統モデルの二重承認とは記録しない。ブラウザ操作は主担当が実施した。

本体は1アプリ1コミット、更新情報と文書・証拠を別コミットに分離する。公開状態はPR／Actionsの結果で確認し、検証完了をデプロイ成功と混同しない。

本体コミット: `8b02c1e` kakure-number、`9fae553` pittari-meter、`c71ae89` do-mannaka、`d04941d` tatoe-gp、`4d4353d` uso-jisho。旧コミットへのamendやrebaseは行わない。

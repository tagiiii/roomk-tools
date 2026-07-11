# C-9 調査報告: 匿名認証失敗経路の棚卸し（2026-07-12）

バックログ C-9（調査・報告のみ、変更なし）の成果物。RTDB 全14アプリの `await authReady` 全40箇所を
機械抽出し、try/catch の有無・失敗時の到達先・利用者に見える挙動を確認した。修正は人間承認後。

## 共有側の挙動（apps/shared/js/rtdb-utils.js）

`initFirebase` の `authReady` は `signInAnonymously().catch(e => { console.error; throw e; })`
（L63-66）。**ログを出して再スロー**するため、失敗は各 `await authReady` 地点で例外として現れる。
失敗時に DB 処理へ進んでしまう経路はない（await が全経路でガードになっている）。

## 実測マトリクス（await authReady 全40箇所）

| 経路 | 保護状況 | 失敗時の利用者体験 |
| --- | --- | --- |
| tryReconnect（14アプリ全部） | **全て try/catch 内** | catch でセッション破棄→TOP表示。安全 |
| hostCreateRoom / guestJoin（ito） | try/catch 内 | `showError('ルーム作成に失敗しました')` 表示。良好 |
| hostCreateRoom / guestJoin（name-change） | try/catch 内 | `toast('エラー: '+e.message)`＋ボタン再有効化。良好（ただし文言が大人向け） |
| hostCreateRoom / guestJoin（**残り11アプリ**） | **try なし（裸 await）** | ボタンを押しても無反応（unhandled rejection・console のみ）。**子ども向けの説明・再試行導線なし** |
| nitaku-board 起動時 load | try なし | 起動が静かに停止（盤面が出ない）。B-8 移行時に「起動時 await のため実質同等」と記録済みの既知挙動 |

- 未保護11アプリ: hint-de-pinto / iisen-show / ikutsu-ieru / jinro / kakure-number /
  koedake-theater / magire-eshi / pittari-meter / tatoe-gp / uso-jisho / word-wolf
- **無限スピナーはなし**: どのアプリも作成/参加ボタンを await 前に disabled にしたり
  「つくっています…」表示を出したりしないため、固まるのではなく「無反応」になる
- `unhandledrejection` ハンドラは全アプリ皆無（console に Uncaught (in promise) が出るのみ）

## 付随の発見

1. **name-change は独自のインライン firebaseConfig ＋独自 authReady を保持**（index.html L405-417。
   `RoomkRTDB.initFirebase` 未使用、initServerTime のみ共有を利用）。B-8 の完了記録は
   「インライン firebaseConfig は全廃」とするが、name-change が残存している（B-8 の対象実測
   11本に name-change が含まれていなかったための漏れ）。エラー処理の型は共有版と同等なので
   実害はないが、共有化の一貫性としては残件
2. 失敗時に DB 書き込みへ進む経路・無限スピナーは今回の実測では見つからなかった
   （リスナー登録はすべて作成/参加成功後のため）

## 統一案（Tier 案付き・報告のみ、着手は人間承認後）

- **候補1（Tier B 案）**: 未保護11アプリの hostCreateRoom / guestJoin に try/catch を追加し、
  各アプリ既存のエラー表示手段（showError / showMsg / toast）で子ども向け文言
  「せつぞくできなかったよ。すこしまってから、もういちどためしてね」＋操作可能状態への復帰を統一。
  1アプリ×1コミット・AI動作確認（DevTools のネットワークオフラインで failure 再現）つき。
  **apps/shared には触れない**（各アプリ側のみで完結）
- **候補2（Tier B 案・小）**: name-change を `RoomkRTDB.initFirebase` へ移行（B-8 の残件解消。
  挙動同等の機械置換に近い）
- **候補3（見送り推奨）**: nitaku-board 起動時の catch 追加。常設ボードは再読込が自然な再試行手段で、
  発生率も低いため、候補1の型が確立したあとに含めるかを判断すれば足りる

修正は未実施。候補の昇格判断は判断待ち P-7 に起票済み。

# C-5 調査報告: RTDB 14アプリの掃除カバレッジ監査マトリクス（2026-07-12）

バックログ C-5（調査・報告のみ、変更なし）の成果物。読み取り専用エージェント4本で全14アプリ＋
`apps/shared/js/rtdb-utils.js` を精読し、「論理的な期限切れ判定」と「Firebase 上の物理削除」を
分けて整理した。修正は人間が Tier を付けて承認後に行う。

## 前提（全アプリ共通の方式）

- 共有側（rtdb-utils.js）が提供するのは**論理判定のみ**: `isRoomExpired(room, 2分)` =
  「hostConnected===false かつ hostDisconnectedAt から TTL 経過」。**物理削除（remove）は各アプリが実装**
- RTDB にサーバー側 TTL・cron はない。物理削除はすべて「いずれかのクライアントが検知して remove する
  アクセス駆動の遅延掃除」（意図的設計）
- 時刻ソースは一貫: 書き込みは `ServerValue.TIMESTAMP`、比較は `RoomkRTDB.now()`
  （Date.now()+serverTimeOffset）。例外は jinro の討論タイマーのみ生 `Date.now()`（ホスト権威なので実害小）
- **pagehide/beforeunload は14アプリすべてなし**（nitaku-board の dayCheckInterval 解放を除く）。
  離脱時の RTDB 片付けは onDisconnect に完全依存＝設計
- onDisconnect: 再接続時の再登録は全アプリあり。通常退出時の明示 `cancel()` は全アプリなし
  （対象ノードを直接 remove する割り切り。remove 済みノードへの発火は無害）

## 一覧マトリクス（ルーム型13アプリ）

物理削除経路の凡例: 退出=leaveGame でホストがルーム remove ／ 終了=終了後30秒の自動 remove ／
スイープ=入室・再接続・ゲストリスナー/カウントダウンでの期限切れ remove

| アプリ | 論理TTL | 退出 | 終了 | スイープ | ゲスト切断時 | ゲスト途中復帰 |
| --- | --- | --- | --- | --- | --- | --- |
| hint-de-pinto | 2分 | あり | 30秒 | あり | player remove | 可 |
| iisen-show | 2分 | ―(注1) | 30秒★ | あり | player remove | 可（スコア復元） |
| ikutsu-ieru | 2分 | あり | 30秒 | あり | player remove | 可 |
| ito | 2分 | あり | **なし**★ | あり | player remove | 可（result 復帰も許可） |
| jinro | 2分 | あり | なし（意図的・振り返り用） | あり | connected フラグ（remove せず・kick あり） | 可 |
| kakure-number | 2分 | **なし**（意図的） | 30秒★ | あり | player remove | 可（スコア復元） |
| koedake-theater | 2分 | あり | 30秒＋handleDone 保険 | あり | player remove | 可（スコア復元） |
| magire-eshi | 2分 | あり | 30秒＋handleDone 保険 | あり | player remove | **不可**（WAITING 限定） |
| name-change | 2分/ゲーム中30分 | **なし** | 30秒★ | あり | player remove | 不可（player 消滅で復帰失敗） |
| pittari-meter | 2分 | **なし**（意図的） | 30秒★ | あり | player remove | 可（再追加） |
| tatoe-gp | 2分 | **なし** | 30秒★ | あり | player remove | 可（回答復元） |
| uso-jisho | 2分 | **なし**（意図的） | 30秒★ | あり | player remove | 可（再作成） |
| word-wolf | 2分 | あり | なし（playAgain/leaveGame 運用） | あり（orphanTimer） | player remove | 不可（離脱扱い＝意図的） |

注1: iisen-show はホストの明示退出ボタン自体がない。★は後述「横断の発見1」の30秒タイマー競合該当。

**nitaku-board（常設型・14本目）**: ルーム/ロール/onDisconnect なし（常設型として正しい）。
KEEP_DAYS=7、`_meta/days` 索引で「誰かが開くたび」に今日−8日以前を一括 set(null)（cleanupOldDays）。
唯一の setInterval は pagehide で解放済み（A-1 対応済み）。掃除漏れの検知不能化は索引で回避されている。

## 特記3アプリの仕分け（意図か漏れか）

| アプリ | 結論 | 根拠 |
| --- | --- | --- |
| kakure-number | **意図的設計** | L772 コメント「次回アクセス時に期限切れルームを掃除できる」明記。掃除経路も複数実装 |
| pittari-meter | **意図的設計** | 物理削除経路が4系統併存（カウントダウン/リスナー/入室スイープ/終了30秒）。純粋な omission ではない |
| uso-jisho | **意図的設計**（ただしコメントなし） | TTL 機構一式が設計として整合。明示コメントはなくコード構造からの読み取り |

いずれも「物理削除する経路が皆無」ではない。ただしホスト側 leaveGame-remove を持たない分、
「掃除役ゲスト不在のままホスト離脱」時の残置露出が word-wolf 型より大きい。

## 横断の発見（重要度順）

1. **終了後30秒 setTimeout のナビゲーション競合（6アプリ・正常終了パスで発生）**:
   iisen-show L930 / name-change L1003 / pittari-meter L1237 / kakure-number L1024 /
   uso-jisho L1312 / tatoe-gp L1280。タイマーIDを保持せず、ホストが30秒以内に goToTop
   （「TOPにもどる」「もう一度遊ぶ」）すると `state.roomRef=null` 化で remove がスキップ
   （name-change のみ null 参照例外）。このとき hostConnected=true のままなので
   **isRoomExpired でも掃われず、DONE/FINISHED ルームが孤児化**（回収は同一コードでの次アクセス頼み）
2. **ito のみ終了後自動削除なし＋`state.cleanupTimer` が未配線のデッドコード**（宣言 L762・clear L877 のみで
   代入箇所ゼロ）。result からのリロード復帰・「もう一度プレイ」を許す意図とは整合するが、
   実装し忘れか意図かはコードから確定できない
3. **参加者ゼロの孤児ルームは次アクセスまで残置**（全ルーム型共通・cron なしの構造的許容。
   低容量・実害小。恒久リークではなく遅延掃除）
4. iisen-show: ゲストがホスト切断オーバーレイから退出しても player を削除しない／goToTop が
   `_hostDisconnectTimer` を clear しない（非対称・実害小）
5. word-wolf: `!snap.exists()` のホスト分岐が何もしない（自室が外部要因で消えても UI 復帰しない小欠陥）
6. magire-eshi: ゲストのラウンド中復帰が非対応（掃除リークではなく状態復帰の欠落。
   koedake/kakure がスコア復元・再追加するのと対照的）

## 修正候補（Tier 案付き・報告のみ、着手は人間承認後）

- **候補1（Tier B 案・効果大）**: 終了後30秒タイマーの競合修正（発見1の6アプリ）。
  タイマーIDを state に保持し、goToTop/leaveGame 到達時に「タイマー解除＋即時 remove」へ倒す。
  1アプリ×1コミットで挙動確認しながら展開
- **候補2（Tier B 案・要意図確認）**: ito の cleanupTimer 配線（終了後自動削除の追加）。
  result 復帰を許す現設計と両立させるなら「leaveGame 時のみ即 remove（現状あり）＋放置時の
  onDisconnect+TTL 回収（現状あり）」で十分と判断して**現状維持（デッドコード削除のみ）**も選択肢
- **候補3（Tier B 案・小）**: iisen-show のゲスト退出時 player remove 追加と goToTop のタイマー解除対称化
- **候補4（Tier C→B 案・小）**: word-wolf の `!snap.exists()` ホスト分岐にトップ復帰処理
- 参加者ゼロ孤児ルーム（発見3）は全アプリ共通の設計許容として**修正不要を推奨**
  （対処するなら database.rules.json や関数が必要で Tier D。費用対効果が低い）

修正は未実施。候補の Tier 昇格判断は判断待ち P-6 に起票済み。

---
name: rtdb-audit
description: Realtime Database アプリの規約監査。scripts/lint.sh の機械チェックに加え、transaction・切断処理・onDisconnect の取消・TTL・終了後削除・再接続・リスナー片付けなど lint では検出できない規約を目視相当でチェックする。「規約監査して」「〜が規約に従っているか確認して」と言われたら使う。
---

# Realtime Database 規約監査

規約の正本はルート `AGENTS.md`（「Realtime Database 実装ルール」「切断時の挙動」「セッションデータの自動削除」「再接続」）。**監査と修正は別フェーズ**: このスキルは所見の報告までを行い、修正は承認を得てから着手する。

対象アプリの一覧は `scripts/lint.sh` の `RTDB_HTML_FILES` 配列が正本（手で数えない）。
`apps/codenames/` `apps/hint-de-pinto/` `apps/iisen-show/` `apps/ito/` は**改名前のリダイレクトスタブ**なので監査対象外（実装は `kotoba-tantei` / `kaburazu-hint` / `do-mannaka` / `tatoe-narabe`）。

## フェーズ1: 機械チェック

```bash
bash scripts/lint.sh
```

**現在は警告ゼロで通る状態を維持している。** 出た警告は既知の許容ではなく、原則すべて所見にする（過去に許容していた shuffle()/escapeHtml() の重複は解消済み）。

## フェーズ2: LLM 監査チェックリスト

対象アプリの `apps/{name}/index.html` と `apps/{name}/AGENTS.md` を読み、以下を確認する。
**アプリ固有 AGENTS.md に明文化された例外は違反としない**（例: jinro のゲスト切断 `connected:false`、jinro / word-wolf / tatoe-narabe の result 後自動削除なし、esadori の presence ノード有無方式）。

1. **transaction**: ルーム作成・参加・ゲーム開始が read-then-write でなくルーム全体 `transaction()` か。人数・status の検証が transaction 内にあるか。`transaction` の callback が `null` を受けるケース（キャッシュ未取得）を潰しているか
2. **ホスト切断**: `onDisconnect().update({hostConnected:false, hostDisconnectedAt})` 方式か（`remove()` は再接続と両立しないため禁止）
3. **ゲスト切断**: `onDisconnect().remove()`（または明文化された例外）
4. **onDisconnect の取消**: teardown（`goToTop()` / `leaveGame()` / `leaveCleanup()` / room 消滅時の detach）で `RoomkRTDB.cancelRoomOnDisconnect(ref)` を呼んでいるか。`off()` は予約済み `onDisconnect` を解除しないため、これがないと削除後の実切断で**ゴースト room が部分再生成される**。`remove()` する経路では `await cancel` を `remove()` の前に置く
5. **TTL**: `ORPHAN_TTL_MS = 2 * 60 * 1000`、`isRoomExpired()` 判定、`.info/serverTimeOffset` 補正の3点セット
6. **終了後削除**: 終了 status 後に 30秒程度で `roomRef.remove()`（または明文化された例外 + TTL/退出時削除で残留が回収されること）。タイマーは**終了時点の ref とラウンド世代を callback に固定**しているか（可変 `state.roomRef` を読むと30秒以内に作った新ルームを誤削除する）。同一ルーム再戦時は status を戻す前にタイマー解除＋世代無効化
7. **再接続**: sessionStorage（`SESSION_KEY` 定数化）、`tryReconnect()`、TOP に戻る時のクリア、ホスト再接続時の `hostConnected=true` 復元
8. **認証失敗**: 作成/参加ボタンで `await authReady` を**狭く** try/catch し（transaction まで囲むと ACK 喪失を認証失敗と誤認して孤児ルームを作る）、子ども向け文言（「うまくつながらなかったよ。ページをよみこみなおしてね」）を出しているか。`authReady` は一度 reject すると固定されるため**再試行文言は誤案内**。二重押下ロックと失敗時の UI 復帰（disabled/spinner/label/focus）があるか
9. **片付け**: `leaveGame()`/`goToTop()` で `clearInterval`・`clearTimeout`・リスナー `off()`・overlay を全て解除しているか
10. **無駄な read/listen**: 同一パスへの重複リスナー、不要な全体読み取り（Spark 無料枠）
11. **XSS**: ユーザー入力を `innerHTML` に入れる箇所が全て `esc()` を通っているか（lint SEC-1 の補完として文脈を確認）
12. **ドキュメント整合**: `apps/{name}/AGENTS.md` の記述が実装と一致しているか（旧仕様の残留に注意）

### 既知の未修正（新規所見と混ぜない）

`docs/kaizen-backlog.md` B-21 の follow-up として起票済み。再発見しても「既知」と明記する。

- DONE/orphan 掃除タイマーが同一接続で room 削除 → 残った `onDisconnect` でゴースト
- `cancel` 失敗時に `remove` を止める strict 化
- `await` 後の可変 `state.roomRef` 再入ガード
- jinro の room-null listener の off/detach 不足
- tatoe-narabe の `cancel → off → remove` を `cancel → remove → off` へ
- クロス接続ゴースト（構造的完全修正は validation rules ＝ 変更禁止パス・人間専任）

## 出力形式

```
| アプリ | 項目 | 判定(OK/違反/例外明記/既知/N-A) | 根拠 file:line | 確認済み/推測 |
```

OK 行は圧縮してよい。最後に違反サマリを深刻度順（データ残留・同期バグ > UX > 軽微）で列挙し、各違反に「コード修正すべきか、例外として AGENTS.md に明文化すべきか」の推奨を付ける。
**根拠を `file:line` で示せない指摘は出さない。** 一般論のベストプラクティスは所見にしない。

## フェーズ3: 修正(承認後のみ)

- 1違反 = 1修正単位で小さく進める
- 挙動を変える修正（削除タイマー追加等）はゲーム体験に影響するため必ず事前に確認を取る
- `apps/shared/**` は**変更禁止パス**。共有ヘルパーに手を入れる案は実装せず、人間の個別承認へ回す
- 修正ごとに `bash scripts/lint.sh` で検証
- host/guest 同期・切断復帰の修正は**実機 E2E（2ブラウザ）まで確認しないと完了扱いにしない**。未実施のままマージした場合はその旨を明記する

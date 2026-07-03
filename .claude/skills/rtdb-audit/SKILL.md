---
name: rtdb-audit
description: Realtime Database アプリの規約監査。scripts/lint.sh の機械チェックに加え、transaction・切断処理・TTL・終了後削除・再接続・リスナー片付けなど lint では検出できない規約を目視相当でチェックする。「規約監査して」「〜が規約に従っているか確認して」と言われたら使う。
---

# Realtime Database 規約監査

規約の正本はルート `AGENTS.md`（「Realtime Database 実装ルール」「切断時の挙動」「セッションデータの自動削除」「再接続」）。**監査と修正は別フェーズ**: このスキルは所見の報告までを行い、修正は承認を得てから着手する。

## フェーズ1: 機械チェック

```bash
bash scripts/lint.sh
```

既知の許容警告: hint-de-pinto / iisen-show / tatoe-gp の shuffle()/escapeHtml() 重複（単一ファイルアプリでの自前実装はルート AGENTS.md が明示的に認めている）。

## フェーズ2: LLM 監査チェックリスト

対象アプリの `apps/{name}/index.html` と `apps/{name}/AGENTS.md` を読み、以下を確認する。
**アプリ固有 AGENTS.md に明文化された例外は違反としない**（例: jinro のゲスト切断 `connected:false`、jinro/word-wolf/ito の result 後自動削除なし）。

1. **transaction**: ルーム作成・参加・ゲーム開始が read-then-write でなくルーム全体 `transaction()` か。人数・status の検証が transaction 内にあるか
2. **ホスト切断**: `onDisconnect().update({hostConnected:false, hostDisconnectedAt})` 方式か（`remove()` は再接続と両立しないため禁止）
3. **ゲスト切断**: `onDisconnect().remove()`（または明文化された例外）
4. **TTL**: `ORPHAN_TTL_MS = 2 * 60 * 1000`、`isRoomExpired()` 判定、`.info/serverTimeOffset` 補正の3点セット
5. **終了後削除**: 終了 status 後に 30秒程度で `roomRef.remove()`（または明文化された例外 + TTL/退出時削除で残留が回収されること）
6. **再接続**: sessionStorage（`SESSION_KEY` 定数化）、`tryReconnect()`、TOP に戻る時のクリア、ホスト再接続時の `hostConnected=true` 復元
7. **片付け**: `leaveGame()`/`goToTop()` で `clearInterval`・リスナー `off()`・overlay を全て解除しているか
8. **無駄な read/listen**: 同一パスへの重複リスナー、不要な全体読み取り
9. **XSS**: ユーザー入力を `innerHTML` に入れる箇所が全て `esc()` を通っているか（lint SEC-1 の補完として文脈を確認）
10. **ドキュメント整合**: `apps/{name}/AGENTS.md` の記述が実装と一致しているか（旧仕様の残留に注意）

## 出力形式

```
| アプリ | 項目 | 判定(OK/違反/例外明記/N-A) | 根拠 file:line | 確認済み/推測 |
```

OK 行は圧縮してよい。最後に違反サマリを深刻度順（データ残留・同期バグ > UX > 軽微）で列挙し、各違反に「コード修正すべきか、例外として AGENTS.md に明文化すべきか」の推奨を付ける。

## フェーズ3: 修正(承認後のみ)

- 1違反 = 1修正単位で小さく進める
- 挙動を変える修正（削除タイマー追加等）はゲーム体験に影響するため必ず事前に確認を取る
- 修正ごとに `bash scripts/lint.sh` で検証

# C-6 調査報告: database.rules.json への .validate 追加案（2026-07-12）

バックログ C-6（調査・報告のみ。**適用は禁止パスのため Tier D**）の成果物。
現行ルール・全書き込み経路・削除時の .validate 挙動を確認し、段階的な強化案と
Emulator テスト手順案をまとめた。

## 現状

```json
{ "rules": { "$app_rooms": { "$roomId": { ".read/.write": "auth != null" } } } }
```

- **匿名認証さえ通れば、任意のトップレベルキー配下の任意ノードへ読み書き自由**。
  firebaseConfig は公開リポジトリ＋配信 HTML に含まれるため、「認証」は実質誰でも取得できる
- スキーマ・サイズ・値集合の制約はゼロ。実在の名前空間は14個
  （hintpinto/iisen/ikutsu/ito/jinro/kakure/koedake/magire/namechange/nitaku/pittari/tatoegp/uso/wordwolf の各 `_rooms`）

## 前提となる2つの事実確認

1. **削除時の .validate 挙動**: `.validate` は `newData` が null（削除）のとき評価されない。
   したがって C-5 で確認した掃除設計（どのクライアントでも期限切れルームを `remove()` できる）は
   `.validate` を追加しても壊れない。削除を制約したい場合は `.write` 側に書く必要がある（今回は非推奨:
   誰でも掃除できることが現設計の前提）
2. **所有権ルールは現状のデータでは書けない**: 全14アプリとも `auth.uid` をデータに保存していない
   （players はニックネームがキー、ルームに host の uid なし）。「他人のプレイヤーノードを
   書き換えられるか」= **現状は書き換えられる**が、これを rules で防ぐには各アプリが
   作成時に uid を書き込むスキーマ変更（Tier B・14アプリ）が先に必要。**今回の .validate 案の
   範囲外とし、将来案として記録するに留める**

## 書き込み経路の棚卸し（C-5 監査の成果を流用）

ルーム型13アプリの書き込みは4系統に集約される:
① ルーム作成（transaction・ルーム全体の初期形）② ホストの状態更新（status/フェーズ/フラグの update）
③ プレイヤー参加・回答・投票（players/回答ノードの set/update）④ 削除（ルーム全体 or players 子ノード）。
nitaku-board のみ `votes/{pushId}` への add/move/delete と `_meta/days` 索引。

## 強化案（段階適用・すべて Tier D）

### 段階1（低リスク・効果大）: トップレベル名前空間の固定

`$app_rooms` ワイルドカードをやめ、実在14名前空間だけを列挙。未知のトップレベルキーへの
書き込み（ゴミ置き場化）を遮断する。既存アプリへの影響ゼロ。
新アプリ追加時に rules 更新が必要になる運用コストだけ明記（new-app-scaffold skill への追記で担保）。

### 段階2（中リスク）: 共通形の .validate

ルーム型13名前空間に共通で:
- `$roomId.matches(/^[A-Z0-9]{6}$/)`（ルームコード形式）
- ルーム作成時の必須キー: `newData.hasChildren(['host','status','players'])`
  （※ nitaku_rooms は形が違うため対象外。hasChildren は**更新時ではなく新規作成時のみ**
  効くよう `!data.exists()` と組み合わせる）
- 文字列長上限: `host` / players の `$nick` キーは rules でキー長を直接制約できないため、
  `.validate: "$nick.length <= 20"` を $位置変数に対して使う（キー長は $変数.length で判定可能）
- ルーム全体のバイト上限ではなく **status の値集合**を名前空間ごとに列挙
  （例: wordwolf は `waiting/discussing/voting/result` 等。各アプリの実値は実装から抽出して
  適用時に確定する）

### 段階3（要設計・今回は見送り推奨）

- players の子ノード数上限: RTDB rules では子の個数を直接数えられない。カウンタノードを
  transaction で併走させる方式はアプリ変更を伴うため見送り
- 所有権（uid 保存）: 上記のとおりアプリ側スキーマ変更が前提。効果は大きいが範囲が広い

## Emulator テスト手順案

1. `firebase emulators:start --only database`（firebase.json に emulators.database.port 追記が必要=Tier D）
2. テストスクリプト（node・admin SDK ではなくクライアント SDK＋匿名認証で実施）で以下のマトリクスを流す:
   - 通す: 正規のルーム作成（各名前空間の実初期形）／status 正値への更新／players 追加／ルーム削除／期限切れルームの第三者削除
   - 弾く: 未知トップレベルキーへの書き込み／6文字形式外の $roomId／必須キー欠落の新規作成／status 異常値／20文字超ニックネーム
3. 実アプリの回帰: 段階1適用後に全14アプリで「作成→参加→進行→終了→削除」をブラウザで一巡
   （C-5 の役割×イベント表を試験項目として流用）
4. 本番適用は firebase deploy --only database（手動運用。D-2 の CI 化とは独立に実施可能）

## 起票について

適用は禁止パス（database.rules.json / firebase.json）のため Tier D。本ループ実行の新規起票は
上限3件（P-5〜P-7）に達しており、**段階1〜2の適用判断の起票は次回ループ実行へ持ち越す**
（次回起票予定: 「C-6 段階1（名前空間固定）の適用と段階2の .validate 詳細設計」）。

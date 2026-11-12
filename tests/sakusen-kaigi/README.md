# 作戦会議の E2E

隔離した Firebase エミュレーターと Playwright で、進行役・子ども2人・みんなにみせる画面を別々のブラウザとして動かす。
**本番の Firebase には接続しない**（共通の `rtdb-utils.js` をエミュレーター向けに差し替えた写しを使う。本番あての通信が出たら失敗にする）。

| ファイル | 内容 |
|---|---|
| `e2e1.cjs` | 入口（6文字のコード・リンクからの参加・同じ名前を断る・端末のない子）・チェックイン（お題・別のお題・チャット用の文）・ジブンチェック（押したらすぐ出る・選びなおし・代わりに入れる・パス）・今日は何する？（子どもが押しても画面は変わらない・進行役が決める・イラストの候補・子どもの「ほかも見る」・一覧から選ぶ・本物のクイズパックでルームを作ると参加用のリンクが届く・前のルームの記録は送らない）・予定の確認（いっしょに入れる・学校の束は進行役がオンにした子だけ・つかんで動かす）・お知らせ（単発実施プログラム・次回の日）・コーナーの表紙を出さない・読みこみなおし・進行役の切断と復帰・外す・退出・ルームを閉じる・幅375px |
| `lib.cjs` | 共通の部品（配信・本番あて通信の検出・お知らせの差し替え・操作） |
| `sync-site.sh` | `apps/shared`・`apps/assets`・`apps/talk-card`・`apps/quiz`・`apps/reversi`・`apps/index.html`・`apps/sakusen-kaigi` を作業フォルダに写し、エミュレーター向けに差し替える |
| `firebase.json` | エミュレーターのポート（auth 9941・database 9942・hub 4941・logging 5041。配信は 6951） |

## 実行

```bash
export SK_WORK=/tmp/sakusen-kaigi-e2e
export PLAYWRIGHT=（playwright のフォルダ）
bash tests/sakusen-kaigi/sync-site.sh
cp tests/sakusen-kaigi/firebase.json database.rules.json "$SK_WORK"/
(cd "$SK_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-sk)
node tests/sakusen-kaigi/e2e1.cjs
```

- エミュレーターには Java が要る（無ければ、Temurin の JRE を一時フォルダに取って `JAVA_HOME` と `PATH` に入れる）
- 画面の写真は `$SK_WORK/out/` に出る
- 2026-11-12 本体化のときの結果: 53項目すべて合格（3回続けて）。進行役の切断と復帰（H4）は、古い接続の切断の予約が遅れて動く順番があり、在室を入れなおす処理を足す前は、たまに不合格になった
- （同じ日・はじめの結果）53項目すべて合格（Playwright 1.64・システムの Chrome・firebase-tools 15.29.0・Temurin 21 JRE）

## 確かめたときに見つけたこと（2026-11-12）

- 次回の時刻を入れた直後など、画面を描きなおす合間の「押した」が届かないことがある → 中身が同じなら書きかえない（`setHTML`）
- ふせんを動かし終えてから350ミリ秒のあいだの「押した」を捨てていたので、動かした直後に別のボタンを押すと効かなかった →
  その動きで出た「押した」だけを捨てる（`dropJust`）

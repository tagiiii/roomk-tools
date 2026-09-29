# キャリアすごろくのテスト（公開しない）

アプリは `apps/career-sugoroku/`（仕様は同じフォルダの AGENTS.md）。ここはリポジトリの中だけで使うテスト。

## ルール・文・ルーム・通信（ネットワークに接続しない）

```bash
node tests/career-sugoroku/engine.test.cjs   # ルール（エンジン）
node tests/career-sugoroku/text.test.cjs     # 画面の文（text.js）と、画面のファイルに★・目標の職業が残っていないか
node tests/career-sugoroku/room.test.cjs     # ルームの決まり（room.js: 席・だれが押せるか・期限・しるし）
node tests/career-sugoroku/net.test.cjs      # 通信（net.js）。Realtime Database をメモリ上の代役に置き換え、競合・切断・切断時の予約（onDisconnect）を順番を決めて再現する
node tests/career-sugoroku/sim.cjs 3000      # つり合いのシミュレーション（GB=8,5,3,2,1,1 LEVELS=1,2,3 などで数値を試せる）
```

## ブラウザの自動テスト（Playwright ＋ Firebase エミュレーター）

本番の Realtime Database には接続しない。ページは `?emu=1` で開き、ローカルのエミュレーター（127.0.0.1）だけを使う。本番のホスト名への通信はテスト側でも遮断する。

1. JDK（Firebase エミュレーター用）を用意し、`JAVA_HOME` と `PATH` を通す
2. 一時フォルダにエミュレーターの設定を置いて起動する（ルールは本番と同じファイルのコピー。リポジトリの `database.rules.json` は変更しない）

   ```bash
   mkdir -p /tmp/cs-emu && cp database.rules.json tests/career-sugoroku/e2e/firebase.json /tmp/cs-emu/
   cd /tmp/cs-emu && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-career
   ```

   ポート: auth 9199 / database 9100 / hub 4410 / logging 4510。別の作業が同じポートを使っていたら止めずに、firebase.json と `CS_BASE`（`?db=` `&auth=`）を合わせて変える

3. リポジトリ直下で配信する: `python3 -m http.server 8090`
4. Playwright はシステムの Chrome を使う（`channel: 'chrome'`）。場所は `PW_PATH` で指定する（例: npx のキャッシュの `node_modules/playwright`）

```bash
node tests/career-sugoroku/e2e/scenarioA.cjs   # ホスト（進行だけ）＋端末2人＋端末のない1人で最後まで。押せる人・ミニゲームの答え・もう一度・ルームを閉じる
node tests/career-sugoroku/e2e/scenarioB.cjs   # 待合室の退出・始まったあとの参加・再読み込み（参加者・ホスト）・途中の退出とホストの代理
node tests/career-sugoroku/e2e/scenarioC.cjs   # ホストの通信が切れる → 参加者の表示・続けられること・つながりなおし
node tests/career-sugoroku/e2e/scenarioD.cjs   # スマートフォン幅（375×812）と、1台の画面であそぶを最後まで（Firebase を初期化しない）
node tests/career-sugoroku/e2e/scenarioE.cjs   # ミニゲーム中の切断でホストに代わりの答えのボタンが出る・再読み込みで読めないときの試し直し・重ねて開く画面の Tab
```

スクリーンショットは一時フォルダ（`CS_SHOTS`、既定は OS の一時フォルダの `career-sugoroku-shots`）に保存する。終わったらエミュレーターを止め、9100・9199・4410・4510 のポートが空いたことを確かめる。

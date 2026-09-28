# ブラウザの自動テスト（Playwright ＋ Firebase エミュレーター）

本番の Realtime Database には接続しない。ページは `?emu=1` で開き、ローカルのエミュレーター（127.0.0.1）だけを使う。本番のホスト名への通信はテスト側でも遮断する。

## 準備（この端末で 2026-09-27 に使った手順）

1. JDK（Firebase エミュレーター用）。例: `export JAVA_HOME=/private/tmp/roomk-jdk/openjdk@21/21.0.12.1/libexec/openjdk.jdk/Contents/Home` と `export PATH=$JAVA_HOME/bin:$PATH`
2. 一時フォルダにエミュレーターの設定を置いて起動する（ルールは本番と同じファイルのコピー。リポジトリの `database.rules.json` は変更しない）。

   ```bash
   mkdir -p /tmp/cs-emu && cp database.rules.json tests/career-sugoroku/e2e/firebase.json /tmp/cs-emu/
   cd /tmp/cs-emu && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-career
   ```

   ポート: auth 9199 / database 9100 / hub 4410 / logging 4510。別の作業が同じポートを使っていたら止めずに、firebase.json と `?db=` `&auth=`（`CS_BASE`）を合わせて変える。

3. リポジトリ直下で配信する: `python3 -m http.server 8090`
4. Playwright はシステムの Chrome を使う（`channel: 'chrome'`）。Playwright の場所は `PW_PATH` で指定する（例: `npx playwright` で入った npx のキャッシュの `node_modules/playwright`）。未指定なら通常の `require('playwright')` で探す。

## 実行

```bash
node tests/career-sugoroku/e2e/scenarioA.cjs   # ホスト進行のみ＋参加者1人＋見学（最小構成）
node tests/career-sugoroku/e2e/scenarioB.cjs   # ホスト参加＋端末2人＋代理1人＋途中見学（重視項目の一式。約6分）
node tests/career-sugoroku/e2e/scenarioC.cjs   # スマートフォン幅・動きを減らす設定
node tests/career-sugoroku/e2e/scenarioD.cjs   # 参加者7人＋見学2人
node tests/career-sugoroku/e2e/scenarioE.cjs   # ホストが一時的にいなくなる（約1分半）
node tests/career-sugoroku/e2e/scenarioF.cjs   # ガイドを開いたままの退出・見学と代理の名前・閉じると見学の競合・暮らしのプラン
```

スクリーンショットは一時フォルダ（`CS_SHOTS`、既定は OS の一時フォルダの `career-sugoroku-shots`）に保存する。

scenarioB は、コラボの招待を確実に試すため、テストの中で手番の状態を「さそう人を選ぶ」段階に書き換える（エミュレーターのデータだけ）。

終わったらエミュレーターを止め、9000番台・4400番台のポートが空いたことを確かめる。

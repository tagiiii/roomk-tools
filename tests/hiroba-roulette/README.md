# なにするルーレット（ルーム）の E2E

隔離した Firebase エミュレーターだけを使う。本番の Firebase には接続しない（本番のアドレスはテストの中で止め、Notion の画像も止める）。

```bash
export HR_WORK=（リポジトリの外の作業フォルダ）
bash tests/hiroba-roulette/sync-site.sh          # apps と database.rules.json を写し、共通部品をエミュレーター向けに差し替える
cd "$HR_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-hr   # Java 21 が要る
PLAYWRIGHT=（playwright のパス） node tests/hiroba-roulette/e2e.cjs
```

- ポート: auth 9651・database 9652・hub 4651・logging 4751・配信 6651（`E2E_PORT` で変えられる）
- 確かめること: ルームを作る前は通信しない／リンクから2人が参加／2段目・3段目を端末で選ぶと共有画面の数に入る（進行役が押した分も足される・取り消せる・だれの分かは出ない・選んだ人に印）／候補にないゲームを端末でさがして選ぶ／進行役の読み込み直し／ルーレットの結果が参加する人に出る／退出／進行役の切断と復帰／ルームを閉じる／ルームなしでもこれまでどおり
- 2026-11-15 に5回流して4回合格。1回は途中で時間切れになった（どこかは記録できていない。そのあと続けて3回合格）

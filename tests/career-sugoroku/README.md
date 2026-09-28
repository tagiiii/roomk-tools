# キャリアすごろく のテスト

対象は `apps/career-sugoroku/`。このフォルダは `apps/` の外なので公開されない。リポジトリ直下から実行する。

| ファイル | 内容 | 実行 |
|---|---|---|
| `engine.test.js` | ゲームエンジンの決め打ちシナリオ（得点・仕上げ・準備チップ・進路・暮らし・タイマーなど）と、ランダム対戦720ゲームの不変条件 | `node tests/career-sugoroku/engine.test.js` |
| `net.test.cjs` | 通信（`net.js`）。Realtime Database をメモリ上の代役に置き換え、共通の `rtdb-utils.js` とあわせて読み込む。入室と削除の競合・同時の入室・同じ名前・切断の前後・同じ端末の書き込みでの中止などを、順番を決めて再現する | `node tests/career-sugoroku/net.test.cjs` |
| `balance.js` | 所要時間の推定と得点のバランス（目標に合わせて選ぶ自動プレイヤー） | `RUNS=200 node tests/career-sugoroku/balance.js` |
| `e2e/` | ブラウザの自動テスト（Playwright＋Firebase エミュレーター。本番には接続しない）。手順は `e2e/README.md` | `node tests/career-sugoroku/e2e/scenarioA.cjs` など |

アプリは `?emu=1` を付けて開くと、ローカルのエミュレーター（127.0.0.1）だけに接続する。E2E はこれを使う。

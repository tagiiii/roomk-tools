# いろつなぎのテスト

| ファイル | 内容 |
|---|---|
| `engine.test.cjs` | ルール（4つで消える・れんさ・置いた組がばらばらに落ちる・かべぎわ／床で回す・1列のすき間は flip のときだけ入れかえ・色の袋・全部消えた・出る所がふさがる・影・1000手のためし置き・じゃまの玉・送る数・じゃまの落ち方・盤の文字・読み込み直し）。`node tests/iro-tsunagi/engine.test.cjs` |
| `e2e1.cjs` | ひとりであそぶ（エミュレーター不要）。Firebase の SDK を止めた状態で動くこと・左右の押しっぱなし・W A S D・下の押しっぱなしが同じ速さ・とめる・あそびかたでとまる・同じ seed と手順で Node と同じ盤／点／れんさ・一言が盤の左の外・盤がいっぱい・時間・おしまい・効果音・375px・外への通信がない |
| `e2e2.cjs` | ルーム（隔離した Firebase エミュレーター）。作成・参加・名前の検査・設定・カウントダウン・同じ順番・読み込み直し・早めにおわる・順位・もう一回・対戦（2れんさで相手に3こ・相手が置くとじゃまが落ちる・いっぱいで「ここまで」）・ホストが見るだけ・みんなにみせる画面・375px・退出・ルームを閉じる・本番への通信がない |
| `e2e3.cjs` | 対戦の送る相手（2026-11-13・3人）: まだだれからも来ていなければ並びのつぎ・送ってきた人へ返す（並びのつぎには届かない）・`boards/{名前}/back` に書く・読み込み直しても返す・送ってきた人がここまでなら並びのつぎ。その2と同じエミュレーターで、その2のあとに流す（`IT_WORK/site` を作りなおす） |

## 実行

```bash
# ひとり（エミュレーター不要）
PLAYWRIGHT=（playwright のフォルダ） node tests/iro-tsunagi/e2e1.cjs

# ルーム: 作業フォルダ（リポジトリの外）にエミュレーターの設定とルールを置いて起動する（Java が要る）
#   firebase.json の emulators: auth 127.0.0.1:9931・database 127.0.0.1:9932・hub 4931・logging 4932・ui なし
cp database.rules.json "$IT_WORK"/
(cd "$IT_WORK" && npx --yes firebase-tools@15.29.0 emulators:start --only auth,database --project demo-roomk-it)
# ルールは自動で当たらないことがあるので、明示的に読み込ませる
curl -X PUT "http://127.0.0.1:9932/.settings/rules.json?ns=demo-roomk-it" -H "Authorization: Bearer owner" --data-binary @database.rules.json
IT_WORK=（作業フォルダ） PLAYWRIGHT=（playwright のフォルダ） node tests/iro-tsunagi/e2e2.cjs
```

- `e2e1` は `apps/` をテストの中で `127.0.0.1:6931` に配信する。`e2e2` は `IT_WORK/site` に写しを作り（`rtdb-utils.js` はエミュレーター向けに差し替え、`stats.js` は数えるだけの写し）、`127.0.0.1:6932` で配信する
- 画面の写真がほしいときは `e2e1` は `IT_OUT=（フォルダ）`、`e2e2` は `IT_WORK/out` に出る
- 画面の状態は `?test=1` のときだけ `window.__iro` から読む。`?seed=` でひとりのときの玉の順番を決める

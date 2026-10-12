# P-13 段階1: RTDB ルールの名前空間固定（ルール案と適用手順の下書き）

2026-10-12 作成、同日に一覧を訂正（下の「訂正」）。判断待ち P-13 の承認（オーナー回答「推奨どおり」）を受けた、バックログ D-5 のための下書き。
**`database.rules.json` は変更していない**（変更禁止パス。編集とデプロイはオーナー作業）。

## 何が変わるか

現行のルールは最上位が `$app_rooms` のワイルドカードで、ログイン済み（匿名認証）なら**どんな名前の場所にも**書ける。
段階1は、これを実在の名前空間の列挙に置き換える。

- 止まるもの: 一覧にない最上位の名前への読み書き（データベースがゴミ置き場になるのを防ぐ）
- 変わらないもの: 一覧にある名前空間の中は、今までどおりログイン済みなら読み書きできる。ルームの中身の形は検査しない（それは段階2で、今回は含めない）

## 名前空間の一覧（現行コードから作り直したもの）

C-6 の報告（2026-07-12）は名前空間を14個としていたが、その後アプリが増えた。2026-10-12 時点の `main`（`9ed1d8f`）では
**ルーム用が29個、利用回数カウンタの `stats` を足して30個**。C-6 の一覧のまま適用すると、7月以降に追加したゲームと利用回数カウンタが動かなくなる。

| 名前空間 | ref() に渡しているファイル |
|---|---|
| `blackjack_rooms` | `apps/blackjack/index.html` |
| `careersugoroku_rooms` | `apps/career-sugoroku/net.js` |
| `domannaka_rooms` | `apps/do-mannaka/index.html` |
| `esadori_rooms` | `apps/esadori/index.html` |
| `ikutsu_rooms` | `apps/ikutsu-ieru/index.html` |
| `jinro_rooms` | `apps/jinro/index.html` |
| `kaburazuhint_rooms` | `apps/kaburazu-hint/index.html` |
| `kagiawase_rooms` | `apps/kagi-awase/app.js` |
| `kakure_rooms` | `apps/kakure-number/index.html` |
| `kimochiate_rooms` | `apps/kimochi-ate/app.js` |
| `koedake_rooms` | `apps/koedake-theater/index.html` |
| `kossoriword_rooms` | `apps/kossori-word/index.html` |
| `kotobapair_rooms` | `apps/kotoba-pair/index.html` |
| `magire_rooms` | `apps/magire-eshi/index.html` |
| `minnaranking_rooms` | `apps/minna-ranking/app.js` |
| `mojisoroe_rooms` | `apps/moji-soroe/index.html` |
| `namechange_rooms` | `apps/name-change/index.html` |
| `oekaki_rooms` | `apps/oekaki-dengon/index.html` |
| `oshitsuke_rooms` | `apps/oshitsuke-zukan/index.html` |
| `pitahame_rooms` | `apps/pita-hame/index.html` |
| `pittari_rooms` | `apps/pittari-meter/index.html` |
| `quiz_rooms` | `apps/quiz/app.js` |
| `stampate_rooms` | `apps/stamp-ate/app.js` |
| `sukibingo_rooms` | `apps/suki-bingo/app.js` |
| `tatoegp_rooms` | `apps/tatoe-gp/index.html` |
| `tatoenarabe_rooms` | `apps/tatoe-narabe/index.html` |
| `toomawashi_rooms` | `apps/toomawashi/index.html` |
| `uso_rooms` | `apps/uso-jisho/index.html` |
| `wordwolf_rooms` | `apps/word-wolf/index.html` |
| `stats` | `apps/shared/js/stats.js`（書き込み）, `apps/stats-view/app.js`（読み取り） |

- 拾い方: 各アプリの `ref()` の第1引数（文字列そのもの、または同じファイルの定数）から、最上位の名前を機械的に拾った。Firestore を読み込むファイルは除く
- `kotobatantei_rooms`（ことば探偵）は Firestore のコレクション名で、RTDB では使っていないので入れない
- `oekaki_my_rooms`（お絵描き伝言ゲーム）は端末の localStorage のキーで、RTDB の場所ではないので入れない
- `.info/connected`・`.info/serverTimeOffset` は Firebase の特別な場所で、ルールの対象外

### 訂正（2026-10-12、適用前の洗い直しで見つけたもの）

最初の版の一覧には誤りが2つあった。上の表とルール案は訂正済み。

- **`sukibingo_rooms` が抜けていた。** 下書きを書いたあと、同じ日に新しいアプリ「好きなものビンゴ」（`9ed1d8f`）が公開された。最初の版のまま適用していたら、このアプリだけルームを作れなくなっていた
- **`oekaki_my_rooms` を名前空間として数えていた。** 文字列に `_rooms` を含むものを拾っただけで、`ref()` に渡しているかを見ていなかった。実際は localStorage のキー

- **2026-10-13 追記: `sakusenchat_rooms` を足した。** 作戦会議チャット（`apps/sakusen-chat/app.js`）を本体に追加したため。上の表は 2026-10-12 時点のままで、ルール案の JSON はルーム用30個＋`stats`。エミュレーターでの245項目の確認は、この1個を足す前のもの（足した行はほかの名前空間と同じ形）

同じ漏れを防ぐため、`scripts/lint.sh` に [RULES-1] を足した。ルールが名前空間を列挙しているとき、コードが使う名前空間がルールにないとエラーになる（最上位がワイルドカードの間は検査しない）。
適用の直前に `bash scripts/lint.sh` をもう一度流し、[RULES-1] が OK であることを確かめる。

## ルール案

[p13-database.rules.proposed-2026-10-12.json](p13-database.rules.proposed-2026-10-12.json) がそのまま `database.rules.json` に置き換えられる全文。形は次のとおりで、29個のルーム用と `stats` に同じ条件を並べただけ。

```json
{
  "rules": {
    "blackjack_rooms": {
      "$roomId": { ".read": "auth != null", ".write": "auth != null" }
    },
    "…（ルーム用が計29個）…": {},
    "stats": {
      "$app": { ".read": "auth != null", ".write": "auth != null" }
    }
  }
}
```

`stats` は `stats/{アプリ名}/{YYYY-MM}/{項目}` に書くので、2段目（アプリ名）で許可する。現行ルールでも同じ深さで許可されている。

## 確認したこと

手元のエミュレーター（firebase-tools 15.29.0、プロジェクト `demo-roomk-p13`。本番とはつながない）で、匿名認証のトークンを使った REST の読み書きを、**現行ルールとルール案の両方**に当てた。訂正後の一覧で各245項目、どちらも全項目が想定どおり。

| 確かめたこと | 現行ルール | ルール案 |
|---|---|---|
| 29の名前空間それぞれで、ルームへの書き込み・深い場所の更新・読み取り・ルームの削除 | できる | できる |
| 同じく、未ログインでの読み書き | できない | できない |
| 同じく、名前空間の直下への書き込み・名前空間ごとの読み取り | できない | できない |
| `stats` への加算（2回）と、集計画面と同じ深さでの読み取り | できる | できる |
| `stats` への未ログインの書き込み | できない | できない |
| 一覧にない名前（`garbage_rooms`・`kotobatantei_rooms`・`oekaki_my_rooms`・削除済みアプリの `nitaku_rooms`）への読み書き | **できる** | **できない** |
| 最上位への書き込み | できない | できない |

確認していないこと:

- ブラウザの SDK 経由での動作と、実際のアプリでの「作成→参加→進行→終了→削除」の一巡（C-6 が適用後の確認として挙げているもの）
- 本番のデータベースに、一覧にない名前空間のデータが残っているかどうか（本番は見ていない）

## 適用の手順（オーナー作業）

1. `bash scripts/lint.sh` を流す。このとき [RULES-1] はまだ検査をしない（ルールがワイルドカードのため）
2. `database.rules.json` をルール案の全文に置き換える

   ```bash
   cp docs/reports/p13-database.rules.proposed-2026-10-12.json database.rules.json
   ```

3. もう一度 `bash scripts/lint.sh` を流し、[RULES-1] が OK であることを確かめる。エラーが出たら、表示された名前空間をルールに足す（下書きのあとにアプリが増えている）
4. `database.rules.json` だけをコミットして `main` に push する。`.github/workflows/firebase-rules.yml` が RTDB のルールをデプロイする
5. デプロイ後、ルーム型のゲームを1本ひらいてルームを作り、別の端末から参加できることを確かめる。`apps/stats-view/` で当日の回数が増えることも確かめる
6. 問題があれば、そのコミットを revert して push する（同じワークフローで元のルールに戻る）

## 適用と同じタイミングで直すもの

ルールを固定すると、**新しいアプリは公開の前にルールへ名前空間を足す**必要が出る。順番が逆だと、そのゲームだけルームを作れない。
足し忘れを公開前に止める lint の検査（[RULES-1]）は追加済み。残りの2つは、適用後に AI が実施できる（変更禁止パスではない）。

- `docs/development/firebase.md` の「新アプリを追加してもルールの更新は一切不要」と、現在のルールの引用を直す
- new-app-scaffold スキルと `docs/development/app-registration.md` に「公開前に `database.rules.json` へ名前空間を足す（オーナー作業）」を足す

## そのほか

- 一覧にない名前空間に古いデータが残っていた場合、適用後はアプリから読めも書けもしなくなる。必要なら Firebase コンソールから消す
- `drafts/` のプロトタイプは Firebase につながない決まりなので、この一覧の対象外
- 段階2（ルームコードの形・必須キー・`status` の値の検査）は今回の承認に含めない。進めるときは、現行29アプリの実装から値を拾い直して起票する

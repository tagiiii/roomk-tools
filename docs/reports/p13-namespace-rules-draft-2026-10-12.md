# P-13 段階1: RTDB ルールの名前空間固定（ルール案と適用手順の下書き）

2026-10-12 作成。判断待ち P-13 の承認（オーナー回答「推奨どおり」）を受けた、バックログ D-5 のための下書き。
**`database.rules.json` は変更していない**（変更禁止パス。編集とデプロイはオーナー作業）。

## 何が変わるか

現行のルールは最上位が `$app_rooms` のワイルドカードで、ログイン済み（匿名認証）なら**どんな名前の場所にも**書ける。
段階1は、これを実在の名前空間の列挙に置き換える。

- 止まるもの: 一覧にない最上位の名前への読み書き（データベースがゴミ置き場になるのを防ぐ）
- 変わらないもの: 一覧にある名前空間の中は、今までどおりログイン済みなら読み書きできる。ルームの中身の形は検査しない（それは段階2で、今回は含めない）

## 名前空間の一覧（現行コードから作り直したもの）

C-6 の報告（2026-07-12）は名前空間を14個としていたが、その後アプリが増えた。2026-10-12 時点の `main` では
**ルーム用が29個、利用回数カウンタの `stats` を足して30個**。C-6 の一覧のまま適用すると、7月以降に追加したゲームと利用回数カウンタが動かなくなる。

| 名前空間 | 使っているファイル |
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
| `oekaki_my_rooms` | `apps/oekaki-dengon/index.html` |
| `oekaki_rooms` | `apps/oekaki-dengon/index.html` |
| `oshitsuke_rooms` | `apps/oshitsuke-zukan/index.html` |
| `pitahame_rooms` | `apps/pita-hame/index.html` |
| `pittari_rooms` | `apps/pittari-meter/index.html` |
| `quiz_rooms` | `apps/quiz/app.js` |
| `stampate_rooms` | `apps/stamp-ate/app.js` |
| `tatoegp_rooms` | `apps/tatoe-gp/index.html` |
| `tatoenarabe_rooms` | `apps/tatoe-narabe/index.html` |
| `toomawashi_rooms` | `apps/toomawashi/index.html` |
| `uso_rooms` | `apps/uso-jisho/index.html` |
| `wordwolf_rooms` | `apps/word-wolf/index.html` |
| `stats` | `apps/shared/js/stats.js`（書き込み）, `apps/stats-view/app.js`（読み取り） |

- お絵描き伝言ゲームだけ名前空間が2つある（`oekaki_rooms` と `oekaki_my_rooms`）
- `kotobatantei_rooms`（ことば探偵）は Firestore のコレクション名で、RTDB では使っていないので入れない
- `.info/connected`・`.info/serverTimeOffset` は Firebase の特別な場所で、ルールの対象外

一覧を作り直すコマンド（適用の直前にもう一度実行し、上の表と差がないか確かめる。`kotobatantei_rooms` は除く）:

```bash
grep -rhoE "[\`'\"][a-z_]+_rooms\b" apps --include=index.html --include='*.js' | tr -d "\`'\"" | sort -u
```

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

手元のエミュレーター（firebase-tools 15.29.0、プロジェクト `demo-roomk-p13`。本番とはつながない）で、匿名認証のトークンを使った REST の読み書きを、**現行ルールとルール案の両方**に当てた。各211項目、どちらも全項目が想定どおり。

| 確かめたこと | 現行ルール | ルール案 |
|---|---|---|
| 29の名前空間それぞれで、ルームへの書き込み・深い場所の更新・読み取り | できる | できる |
| 同じく、未ログインでの読み書き | できない | できない |
| 同じく、名前空間の直下への書き込み・名前空間ごとの読み取り | できない | できない |
| `stats` への加算（2回）と、集計画面と同じ深さでの読み取り | できる | できる |
| `stats` への未ログインの書き込み | できない | できない |
| 一覧にない名前（`garbage_rooms`・`kotobatantei_rooms`・削除済みアプリの `nitaku_rooms`）への読み書き | **できる** | **できない** |
| 最上位への書き込み | できない | できない |

確認していないこと:

- ブラウザの SDK 経由での動作と、実際のアプリでの「作成→参加→進行→終了→削除」の一巡（C-6 が適用後の確認として挙げているもの）
- 本番のデータベースに、一覧にない名前空間のデータが残っているかどうか（本番は見ていない）

## 適用の手順（オーナー作業）

1. 上のコマンドで一覧を作り直し、表と差がないか確かめる。差があればルール案に足す
2. `database.rules.json` をルール案の全文に置き換えて `main` に push する。`.github/workflows/firebase-rules.yml` が RTDB のルールをデプロイする
3. デプロイ後、ルーム型のゲームを1本ひらいてルームを作り、別の端末から参加できることを確かめる。`apps/stats-view/` で当日の回数が増えることも確かめる
4. 問題があれば、そのコミットを revert して push する（同じワークフローで元のルールに戻る）

## 適用と同じタイミングで直すもの

ルールを固定すると、**新しいアプリは公開の前にルールへ名前空間を足す**必要が出る。順番が逆だと、そのゲームだけルームを作れない。次の3つは AI が実施できる（変更禁止パスではない）。

- `docs/development/firebase.md` の「新アプリを追加してもルールの更新は一切不要」と、現在のルールの引用を直す
- new-app-scaffold スキルに「公開前に `database.rules.json` へ名前空間を足す（オーナー作業）」を足す
- `scripts/lint.sh` に「コードが使う名前空間が `database.rules.json` にあるか」の検査を足す（足し忘れを公開前に止める）

## そのほか

- 一覧にない名前空間に古いデータが残っていた場合、適用後はアプリから読めも書けもしなくなる。必要なら Firebase コンソールから消す
- `drafts/` のプロトタイプは Firebase につながない決まりなので、この一覧の対象外
- 段階2（ルームコードの形・必須キー・`status` の値の検査）は今回の承認に含めない。進めるときは、現行28アプリの実装から値を拾い直して起票する

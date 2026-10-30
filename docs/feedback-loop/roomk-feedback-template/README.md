# roomk-feedback（非公開リポジトリ）の雛形

フィードバック（roomk-tools の RTDB `feedback/`）を **1時間に1回、自動で Issue にする**非公開リポジトリ。
見に行かなくても、GitHub の通知（スマホのアプリ・メール）で届く。Issue のラベルで「直す／保留／見送り」を管理する。

このフォルダの中身をそのまま非公開リポジトリのルートに置く。

```
README.md
.github/workflows/pull-feedback.yml   1時間ごとに scripts/pull-to-issues.mjs を動かす
scripts/pull-to-issues.mjs            RTDB の feedback/ を読んで Issue を作り、読んだものを RTDB から消す
```

## 用意するもの（オーナーが行う。所要10分）

1. GitHub で **非公開**リポジトリ `roomk-feedback` を作る（`gh repo create roomk-feedback --private` でもよい）
2. このフォルダの中身を push する
3. Firebase コンソール → プロジェクトの設定 → サービスアカウント → **新しい秘密鍵の生成** → JSON をダウンロード
4. リポジトリの Settings → Secrets and variables → Actions → New repository secret
   - 名前 `FEEDBACK_SA_JSON`、値は JSON ファイルの**中身を丸ごと**貼る
   - 貼ったらダウンロードした JSON は削除する（リポジトリにも置かない）
5. Settings → Actions → General → Workflow permissions を **Read and write** にする（Issue を作るため）
6. Actions タブ → `pull-feedback` → **Run workflow** で1回手動実行し、緑になることを見る
   （`feedback/` が空なら Issue は作られず「0件」で終わる）
7. 通知: GitHub のスマホアプリを入れ、このリポジトリを Watch（All activity）にする。メールでも届く

## 動き

- 毎時15分に動く（`cron: '15 * * * *'`）。手動でも動かせる
- `feedback/` を管理者の権限で読み、古い順に1件ずつ Issue にする（1回に最大20件）
- Issue のタイトル: `[ツール名] 種類: 本文のはじめ`。本文: 送られた文・ツール・種類・日時・RTDB の id
- ラベル: `新着` と種類（`うまく動かない` `文字・見た目` `お題・問題` `使い方` `こうだったらいいな` `その他`）。無ければ自動で作る
- Issue ができた分だけ RTDB から消す（Issue を作れなかったものは残り、次の回でやり直す）
- 失敗したら Actions が赤くなり、GitHub から通知が来る

## 管理のしかた（ラベル）

| ラベル | 意味 |
|---|---|
| `新着` | まだ見ていない |
| `直す` | 直すと決めた（段階4では routine B がこれを拾う） |
| `保留` / `見送り` | 今はやらない |
| 閉じる | 対応が終わった |

## 気をつけること

- **本文（原文）がこのリポジトリの Issue に入る**。リポジトリは非公開のまま、見られる人を増やさない
- 原文は RTDB からは消えるので、この Issue が唯一の置き場になる。対応が終わって要らなくなった Issue は閉じるか削除する
- 公開リポジトリ（roomk-tools）の PR やコミットに、この Issue の本文を貼らない。番号だけ書く

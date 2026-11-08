サークルタイム（`apps/circle-time/`）の毎朝のデータ（room-K ポータルのプログラムと「今日は何の日」）を用意してください。
正本: `apps/circle-time/AGENTS.md`「今日は何の日の用意」。返答・報告は日本語。

ページに届けるには main への push が要る（2026-11-09 オーナー判断で、このタスクが `apps/circle-time/daily/` のファイルだけを push する）。
いつもの作業ツリー（`~/dev/roomk-tools`）はほかのセッションが使っているので触らない。**最新の main から一時的な作業ツリーを作り、その中だけで作業する**。
シェルは呼び出しごとに戻ることがあるので、以下のコマンドは毎回 `cd "${TMPDIR:-/tmp}/roomk-circle-daily" &&` を頭に付けて、その作業ツリーの中で動かす。

```bash
cd ~/dev/roomk-tools
git worktree remove --force "${TMPDIR:-/tmp}/roomk-circle-daily" 2>/dev/null; git worktree prune
git fetch -q origin main
git worktree add --detach "${TMPDIR:-/tmp}/roomk-circle-daily" origin/main
```

## 手順

0. プログラムを読む（room-K ポータルの Notion 公開ページを読むだけ。決まった手順なので判断はいらない）。日本時間のきょうと次の平日の `daily/YYYY-MM-DD.program.json` を書く
   ```bash
   node scripts/circle-time/program.mjs
   ```
   - 失敗したら（Notion のページの作りが変わった・通信できない）、その旨を報告に書いて、何の日の手順へ進む
1. 日本時間のきょうと、次の平日（金曜なら月曜）を対象にする。`apps/circle-time/daily/YYYY-MM-DD.json` がもうあり、手順 5 の検査に通るなら、その日は作らない
2. その日の Wikipedia の日付ページの「記念日・年中行事」を読む（読むだけ）
   ```bash
   curl -s "https://ja.wikipedia.org/w/api.php?action=parse&page=$(python3 -I -c 'import urllib.parse;print(urllib.parse.quote("11月9日"))')&prop=wikitext&format=json&formatversion=2" -A "roomk-tools-circle-daily/0.1"
   ```
3. 本当の記念日を **2〜4つ** 選ぶ（`real`）。参加者は小学校中学年〜中学生（不登校の子どもを含む）なので、ルートの AGENTS.md「コンテンツガイドライン」に合うものだけにする
   - 選ばない: 戦争・革命・事件・事故・災害・病気・障害・死（忌日・追悼）・お酒・たばこ・政治・宗教・学校・勉強・試験・登校・恋愛にかかわるもの
   - 選びやすい: 食べもの・道具・語呂合わせ・季節（立冬など）・身近なもの。日本の記念日を先に。海外のものは子どもに分かるものだけ
   - `name` はページの名前のまま（「〜の日」で16文字まで。「〜の日」で終わらないものは選ばない）。`note` は自分の言葉で40文字まで・通常表記（漢字まじり）・やさしい言い方。ページの文を写さない
4. 作り話を **2つ** 作る（`fake`）。ありそうで楽しい「〜の日」（ひらがな・カタカナ中心）。同じガイドラインに合わせ、その日のページにないこと（ひらがな・漢字・カタカナの言いかえも）を確かめる
5. 書いて、検査に通るまで直す
   ```json
   { "date": "2026-11-09", "source": "Wikipedia「11月9日」記念日・年中行事",
     "real": [{ "name": "換気の日", "note": "「いい（11）くうき（9）」で、いい空気の語呂合わせ" }],
     "fake": [{ "name": "毛布の日" }, { "name": "クレヨンの日" }] }
   ```
   ```bash
   node tests/circle-time/daily-check.mjs apps/circle-time/daily/YYYY-MM-DD.json
   ```
   - 子ども向けに合う本当の記念日が1つもない日は、ファイルを作らない（準備の画面は「まだ用意されていません」と出て、手で入れられる）
6. `apps/circle-time/daily/` の、14日より前の日付のファイル（`.json` と `.program.json`）を消す（このタスクが作ったものだけ。ほかのファイルには触らない）
7. `apps/circle-time/daily/` だけをコミットして main に push し、一時的な作業ツリーを消す。ほかのファイルは足さない・変えない。変わったファイルがなければコミットしない
   ```bash
   git add -A apps/circle-time/daily
   git diff --cached --quiet || git commit -m "chore(circle-time): YYYY-MM-DD の今日は何の日とプログラム"
   git push origin HEAD:main || { git pull -q --rebase origin main && git push origin HEAD:main; }
   cd ~/dev/roomk-tools && git worktree remove --force "${TMPDIR:-/tmp}/roomk-circle-daily"
   ```
   - push が2回とも通らなければ、その旨を報告に書く（作業ツリーは消してよい。翌朝また作る）
8. 作った日・プログラムの件数・選んだ記念日・作り話を短く報告する

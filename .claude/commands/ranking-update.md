ツール一覧の「よく開かれたツール」（`apps/ranking.json`）を作り直してください。週1回の作業です。
正本: `docs/development/app-registration.md`「よく開かれたツール」。

## 手順

1. `git status` と `git log origin/main..HEAD` を見る。ほかの作業の未コミット差分があっても触らない
2. `node scripts/ranking-build.mjs` を実行する（サービスアカウント鍵は `FEEDBACK_SA_JSON` か `~/.config/roomk/feedback-sa.json`。鍵の中身は表示しない）
   - 前回の実行から6日たっていないと、前と同じ期間（または先月）で並ぶ。その場合は「まだ早い」と報告して、書いたファイルを `git checkout` で戻して終わる
3. 出力の順位を見て、おかしな点（公開直後の新作が動作確認で上がっている・ポータルにないアプリ など）があれば報告に書く
4. `apps/ranking.json` と `scripts/ranking-snapshots.json` の2つだけをコミットする（`git add` でこの2つを指定する。`-a` は使わない）
   - メッセージ例: `chore(portal): よく開かれたツールを更新（11/2〜11/9）`
5. push は、オーナーがこの実行で頼んだときだけ行う。頼まれていなければ「コミット済み・未push」と報告する

## 守ること

- 回数は `ranking.json` にも報告の公開先にも書かない（ローカルの報告で順位の根拠として見せるのはよい）
- `stats/` は読むだけ。書き込み・削除をしない
- `updates.json` には追記しない（毎週の入れ替えは「更新情報」に出すほどの変化ではない）

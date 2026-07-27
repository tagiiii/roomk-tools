# コトバであそぼ — 年間プログラム設計（Phase 1）

roomK の国語ワークショップ「コトバであそぼ」を、1年間継続できる体系的プログラムへ再設計するための設計文書一式。
**Phase 1（調査と設計）の成果物であり、承認前。コード・問題本文はまだ作成していない。**

| # | ファイル | 内容 |
|---|---------|------|
| 01 | [01-genjo-chosa.md](01-genjo-chosa.md) | 現状調査（既存9ツール・slides.html同期実装・規約） |
| 02 | [02-nenkan-keikaku.md](02-nenkan-keikaku.md) | 年間計画 標準40回＋予備4回（6ユニット） |
| 03 | [03-keito-hyo.md](03-keito-hyo.md) | 学習内容の系統表（学習指導要領との対応） |
| 04 | [04-slides-spec.md](04-slides-spec.md) | HTMLスライド共通仕様（参加者画面・発表者ビュー・同期） |
| 05 | [05-data-schema.md](05-data-schema.md) | 問題データスキーマとバリデーション仕様 |
| 06 | [06-kison-game-kakuju.md](06-kison-game-kakuju.md) | 既存コミュニケーションゲーム拡充計画 |
| 07 | [07-jisso-keikaku.md](07-jisso-keikaku.md) | 実装単位と優先順位（Phase 2〜5） |
| 08 | [08-agent-tasks.md](08-agent-tasks.md) | サブエージェント向けタスク一覧と進め方 |
| 09 | [09-ronten.md](09-ronten.md) | 判断が必要な論点（承認待ち） |

## 学習指導要領の参照について

対応関係は文部科学省の一次資料（平成29年告示 学習指導要領解説 国語編）を取得・確認したうえで記録している。
指導事項の本文で確認できた対応は記号のみ、解説文中の言及や近接項目にとどまるものは【候補】と明記する。

- 小学校学習指導要領（平成29年告示）解説 国語編: https://www.mext.go.jp/component/a_menu/education/micro_detail/__icsFiles/afieldfile/2019/03/18/1387017_002.pdf
- 中学校学習指導要領（平成29年告示）解説 国語編: https://www.mext.go.jp/component/a_menu/education/micro_detail/__icsFiles/afieldfile/2019/03/18/1387018_002.pdf
- 改訂学習指導要領 一覧: https://www.mext.go.jp/a_menu/shotou/new-cs/1384661.htm

## 記号の読み方

`小5-6(1)オ` = 小学校第5学年及び第6学年〔知識及び技能〕(1)言葉の特徴や使い方 オ。
`中2(1)エ` = 中学校第2学年〔知識及び技能〕(1) エ。
`小5-6A(1)オ` = 〔思考力・判断力・表現力等〕Ａ話すこと・聞くこと (1) オ。

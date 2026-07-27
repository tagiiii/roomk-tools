# roomK ツール群 — Claude Code 向け案内

このリポジトリの仕様・実装ルールの正本は [AGENTS.md](./AGENTS.md) です。
**CLAUDE.md には独自仕様を置きません**（AGENTS.md との乖離を防ぐため）。このファイルは道案内だけです。

## 作業を始める前に

1. [AGENTS.md](./AGENTS.md) を読む。特に「ドキュメントの正本」「改名済みアプリ（リダイレクトスタブ）」「共通実装ルール」「コンテンツガイドライン」
2. アプリを触るなら `apps/{app-name}/AGENTS.md` も読む（共通規約からの意図的な逸脱がここに書かれている）
3. 該当するスキルがあれば使う（下記）

## 使えるスキル

| スキル | 使う場面 |
|---|---|
| `new-app-scaffold` | 新しいアプリを追加する |
| `rtdb-audit` | Realtime Database アプリが規約に従っているか監査する |
| `slides-generator` | 画面共有用の説明スライド（`slides.html`）を作る |
| `/lint` | `scripts/lint.sh` を実行して結果を日本語で説明する |

## 忘れやすいこと

- **編集後は `bash scripts/lint.sh`**（Edit/Write の PostToolUse フックでも自動実行される）。エラー0・新規警告なしが基準
- **絵文字は使わない。** アイコンは Material Symbols Rounded のみ
- **メンター向けの心得・声かけのコツを子ども向け画面や `howto.js` に書かない。** 置き場は `AGENTS.md` だけ
- 旧フォルダ（`apps/codenames/` `apps/hint-de-pinto/` `apps/iisen-show/` `apps/ito/`）はリダイレクトスタブ。実装は新フォルダ側にある
- AI の役割分担・ガードレールの区分は [docs/ai-roles.md](./docs/ai-roles.md)。モデルの固有名を書くのはそのファイルだけ

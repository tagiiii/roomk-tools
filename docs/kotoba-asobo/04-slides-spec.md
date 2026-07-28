# 04 HTMLスライド共通仕様

新アプリ `apps/kotoba-asobo/`（名称は承認待ち、09参照）。オフライン型（Firebase不使用）。
同期・発表者ビュー・スケーリングは **既存 slides.html（codenames / hint-de-pinto）の実装方式を共通化して再利用**する。新方式は作らない。

## 1. ファイル構成

```
apps/kotoba-asobo/
├── index.html          # セッション選択＋投影画面＋発表者ビュー（?view=presenter）
├── style.css           # アプリ固有スタイル（接頭辞 .ka-）
├── js/
│   ├── engine.js       # デッキ描画・進行・同期・キーボード・スケーリング
│   └── render.js       # 問題type別のスライド描画・ふりがな変換・チャット文生成
├── data/
│   ├── manifest.js     # セッション一覧（id・タイトル・ユニット）
│   └── sessions/
│       ├── u1s02.js    # 1回分のセッションデータ（05のスキーマ）
│       └── ...
└── AGENTS.md           # アプリ固有仕様
```

- データは外部JS（`<script>` 読み込みでグローバル登録）。fetch/JSONは使わない（file:// でも動作、既存 questions.js / words.js の慣行と一致）
- セッションは URL `?session=u1s02` で指定。未指定時はセッション選択画面
- 既存の codenames/hint-de-pinto の slides.html は変更しない（説明スライドとして役割が異なる）

## 2. 参加者向け画面（投影画面）

- **ステージ**: 1280×720 固定、`transform: scale(min(innerWidth/1280, innerHeight/720))` でフィット（既存方式）
- **文字サイズ**: 本文 32px 以上、問題文 40px 以上、選択肢 36px 以上を基準（画面共有の圧縮を考慮）
- **1280×720 内への収め方（スクロール禁止）**:
  - 問題文はタイトル（h1）にのみ表示し、本文側に同じ問題文を繰り返さない（タイトルと問題文が異なる open 型などのみ本文に表示）
  - 答え表示後（step 1 以降）は `ka-slide--reveal` で問題文・選択肢をコンパクト表示に切り替え、答え・解説の場所を確保する（このとき上記の文字サイズ基準より小さくなってよい）
  - それでも収まらないスライドだけ、エンジンが描画後に `.ka-slide__body` のあふれを測って `ka-slide--fit-1`〜`fit-4`（0.9〜0.6倍）を段階適用する。データ側を短くして回避しない
  - 発表者ビューの縮小プレビューにも同じ判定を適用し、投影画面と同じ見え方にする
- **操作**: 前へ／次へ／答えを表示／全画面 のボタン＋キーボード
  - `→ / PageDown / Space` 次、`← / PageUp` 前、`Home / End`、`F` 全画面、`P` 発表者ビューを開く、`A` 答え表示（段階を進める）
- **答えの段階表示**: 各スライドは step を持つ（step 0 = 問題のみ → step 1 = 正解ハイライト → step 2 = 解説表示）。`Space/→` は step が残っていれば step を進め、なければ次スライドへ。**問題表示時に答えが画面のどこにも出ないこと**（DOM上にも出典・解説を含めない。発表者ビュー側のみ保持）
- **進行状況**: 「12 / 24」＋現在のパート名（導入／ウォームアップ／メイン／対話／振り返り）を常時表示。パート境界には目安時間つきの区切りスライド
- **選択肢**: 丸数字 `①②③` で統一（`NUMBERS = ['①','②',...]` から自動採番、AGENTS.md規約）。番号は `--color-accent` 系
- **禁止・必須**:
  - 絵文字は一切使用しない（データ・UI・チャットコピーとも。バリデーションで機械検査）
  - アイコンは Material Symbols Rounded（既存slides同様 `opsz 48` 版）
  - 過度なアニメーションを使わない。遷移はフェード程度
  - `prefers-reduced-motion: reduce` で全 transition/animation を無効化（既存slidesは未対応 → 新規要件）
- **ふりがな**: データ中の `{漢字|かんじ}` 記法を `<ruby>` に変換して描画。それ以外のテキストは全て `esc()` を通す（SEC-1準拠。生HTMLをデータに持たせない）

## 3. 発表者ビュー

同一 index.html を `?view=presenter&session=...` で別ウィンドウ起動（`window.open`、既存方式）。冒頭に「この画面は共有しない」警告を表示。

表示項目（05のスキーマから描画）:

| 項目 | ソース |
|---|---|
| 現在のスライド（縮小プレビュー＋現在step） | スライドデータ |
| 次のスライドの概要 | 次スライドの title/type |
| 正解 | answerIndex / answer |
| 解説 | explanation |
| 基本向け説明／発展向け説明 | basicExplanation / advancedExplanation |
| 参加者へ投げかける追加質問 | followUpQuestion |
| 間違いが出たときのフォロー例 | facilitationPrompt |
| 目安時間（スライド単位＋パート累計） | estimatedMinutes・blocks |
| 参考情報・出典 | source / sourceCheckedAt |
| Metalifeチャット用コピー | chatCopy（ワンクリックコピー） |
| 操作 | 前へ／次へ／答えを表示（step送り）／接続状態 |

- 発表者ビューからの操作は投影画面に反映される（双方向）
- ノート欄の編集・localStorage保存・「元に戻す」は既存slides.htmlの機能を踏襲する（論点09-8）

## 4. 画面間同期

既存実装の方式をそのまま採用し、step と セッションIDを追加する。

```js
const CH_NAME = 'kotoba_asobo_deck';
const channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CH_NAME) : null;
function send(msg) {
  if (channel) channel.postMessage(msg);
  try { localStorage.setItem('ka_msg', JSON.stringify({ ...msg, _t: Date.now() })); } catch (e) {}
}
// storage イベントをフォールバック受信（既存と同じ）
```

メッセージ（既存 `{t:'idx'|'goto'|'hello'}` の拡張）:

| メッセージ | 方向 | 意味 |
|---|---|---|
| `{t:'idx', s, i, step}` | 投影→発表者 | 現在位置通知（s=セッションid） |
| `{t:'goto', s, i, step}` | 発表者→投影 | 移動指示（stepも同期） |
| `{t:'hello', s}` | 発表者→投影 | 起動時の現在地問い合わせ |

`s` が自分のセッションidと異なるメッセージは無視する（別セッションのウィンドウ誤爆防止）。

## 5. チャットコピー

- 形式は厳守（2択も同形式で①②）:

```
問題文
①選択肢1
②選択肢2
③選択肢3
```

- **答え・解説・出典を混ぜない**。バリデーションで chatCopy に正解語・「答え」「正解」等が含まれないか検査
- 既定では question + choices から自動生成し、必要な問題のみ `chatCopy` フィールドで上書き
- コピー実装は既存フォールバック連鎖を再利用: `navigator.clipboard.writeText` → `execCommand('copy')` → 全選択

## 6. デザイン

- 既存「room-Kゲーム説明デッキ」規約を踏襲: フォント Zen Kaku Gothic New（見出し900）＋Noto Sans JP、文字 #434343／背景 #FAFAFA、アクセントはティール #00A77F・コーラル #E06666・ブルー #3C78D8 をユニットカラーとして割当て
- design-system.css を読み込み（lint CSS-1）、`:root` 再定義はしない（CSS-2）
- CSSクラスは `.ka-` 接頭辞＋BEM
- 600px以下: 投影用途が主だが、スライド一覧・発表者ビューは縦積みに崩れないよう対応

## 7. 検証項目（Phase 5 で実装エージェントが確認）

発表者ビューと投影の双方向同期／前後移動／答えの段階表示（投影に答えが先に出ないこと）／チャットコピー内容／全画面／1280×720での文字切れ／600px以下／キーボード操作一覧／prefers-reduced-motion／コンソールエラー／絵文字混入ゼロ／丸数字統一／既存ツールへの無影響。

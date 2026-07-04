# コトバであそぼ — アプリ固有仕様

## 概要

国語ワークショップ用のオフラインHTMLスライドエンジン。Firebase は使わない。
参加者には投影画面を共有し、スタッフは別ウィンドウの発表者ビューで答え・解説・進行メモを見る。

## URL規則

- `apps/kotoba-asobo/` : セッション選択画面
- `apps/kotoba-asobo/?session=demo` : 投影画面
- `apps/kotoba-asobo/?session=demo&view=presenter` : 発表者ビュー

## データ追加手順

1. `data/sessions/{sessionId}.js` を作成する。
2. `KotobaAsobo.registerSession({ ... })` で `docs/kotoba-asobo/05-data-schema.md` のスキーマどおり登録する。
3. `data/manifest.js` に `id / unitId / number / title / src` を追加する。
4. `node scripts/validate-kotoba-asobo.mjs` を実行する。

選択肢データに丸数字は入れない。投影画面とチャットコピーではエンジンが `①②③④` を自動付与する。
データに生HTMLは入れない。ふりがなは `{漢字|かんじ}` 記法だけを使う。

## 同期プロトコル

- BroadcastChannel: `kotoba_asobo_deck`
- localStorage fallback key: `ka_msg`
- メッセージ:
  - `{t:'idx', s, i, step}` 投影画面から現在位置を通知
  - `{t:'goto', s, i, step}` 発表者ビューから移動指示
  - `{t:'hello', s}` 発表者ビュー起動時の現在地問い合わせ

`s` は sessionId。異なるセッションのメッセージは無視する。

## 検証コマンド

```bash
node scripts/validate-kotoba-asobo.mjs
node scripts/content-audit.mjs
bash scripts/lint.sh
```

新規ファイルに絵文字を入れない。アイコンは Material Symbols Rounded を使う。

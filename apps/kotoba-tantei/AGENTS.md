# ことば探偵 仕様書

## 目的・使用シーン
ヒントをもとにチームで相談しながらカードを見つける、連想型コミュニケーションゲーム。
room-K では「語彙を使う」より **「連想を言葉にする／相手の考えを聞く／正解が一つに見えない相談をする」** 体験として使う。

**移植元**: `codename_game`（別リポジトリ、React + TypeScript + Firestore）。本ディレクトリへ Vanilla JS + Firestore で移植中。
**参考**: 移植元コードは https://github.com/tagiiii/codename_game

## 画面構成・フロー

### ホスト
1. **ルーム作成画面** - 名前・単語セット・先攻チームを選んで作成
2. **ロビー画面** - 参加コードを共有／「自分もプレイヤーとして参加する」を選ぶ（既定は参加）／遊ぶ人のチーム・役割を割り当て／開始条件（遊ぶ人で各チーム2人以上＋ヒント役1・探す役1以上）を満たすとゲーム開始
3. **ゲーム画面（ヒント役 or 探す役 or 進行役）** - 5×5 の単語カードを見ながら進行。進行役（参加を外したホスト）は観戦ビューと同じく未公開カードの正解の色が見えない
4. **結果画面** - 勝者表示／再戦／退出

### 参加者
1. **入室画面** - 名前・ルームコード入力
2. **ロビー画面** - ホストが割り当てたチーム・役割を確認
3. **ゲーム画面** - ホストと同じ盤面で役割に応じた UI

## Firestoreデータ構造

```
kotobatantei_rooms/{roomId}
  - createdAt: Timestamp
  - expiresAt: Timestamp        // 3時間の失効判定に使用
  - gamePhase: "lobby" | "in_progress" | "finished"
  - turnTeam: "red" | "blue"
  - turnPhase: "waiting_hint" | "guessing"
  - currentHint: { word: string, count: number, byPlayerId: string, updatedAt: Timestamp } | null
  - remainingGuesses: number
  - firstTeam: "red" | "blue"
  - winner: "red" | "blue" | null
  - finishReason: "all_found" | "trap" | "manual" | null
  - cards: Card[]               // 25枚の配列（index / word / role / revealed）
  - players: Player[]           // id / name / authUid / team / role / isHost
  - settings: { hostPlays: boolean }  // ホストもチームに入って遊ぶか。作成時 true。キーなしの旧ルームも true 扱い（hostPlaysOf()）
```

**Card**: `{ index: number, word: string, role: "red" | "blue" | "neutral" | "assassin", revealed: boolean }`
**Player**: `{ id: string, name: string, authUid?: string, team: "red" | "blue", role: "spymaster" | "guesser", isHost: boolean }`
※ 進行だけのホスト（`settings.hostPlays === false`）も `team` / `role` は保存したまま残る（値は増やしていない）。ただし **どこでも数えず・使わない**。遊ぶ人の判定は `isPlayingPlayer(room, player)`、一覧は `playingPlayers(room)`（service.js）を必ず通す

※ `assassin` は UI では「トラップカード」と表示。内部識別子として `assassin` を維持。
※ `spymaster` は UI では「ヒント役」、`guesser` は「探す役」と表示。

## 用語の UI 表示ルール

内部の英語識別子と UI 表示を分離する。UI には以下のみを出す。

| 内部識別子 | UI 表示 |
|-----------|---------|
| `spymaster` | ヒント役 |
| `guesser` | 探す役 |
| `assassin` | トラップカード |
| `red` / `blue` | 赤チーム / 青チーム |

## 特有のルール・制約

- ルームコードは 6桁英数字（`generateSessionId()` を使用）
- カードは 25枚（先攻9・後攻8・中立7・トラップ1）
- 終了理由は `finishReason` で管理し、結果画面では「全部見つかった」「トラップを選んだ」を分けて表示する
- **開始条件**: 各チーム2人以上 ＋ 各チームにヒント役1人 ＋ 各チーム探す役1人以上（**遊ぶ人だけで数える**。進行だけのホストはどのチームにも入らない）
- ヒントの「枚数」は、そのターンで探す役が選べる最大枚数と一致する（+1 ボーナスは使わない）
- ヒント送信・カード公開・ターン終了は Firestore transaction で整合性担保（`runTransaction`）。カード公開・ターン終了は現在のターンチームの探す役だけが実行できる
- ゲーム画面では現在のターン・フェーズ・自チームかどうかを上部の強調帯で常時表示する
- ゲーム画面では赤/青それぞれの「見つけたカード数 / 全カード数」を常時表示する。相手チームのカードを選んだ場合も、そのチームの見つけた枚数に含める
- カード公開前にアプリ内確認モーダルを出す。ヒントはカード公開前のみ、ホストまたは現在のヒント役が取り消して出し直せる
- ホストはゲーム中にターン強制終了、ロビー戻し、勝者指定での終了ができる
- チーム・役割の割り当てはホストのみ変更可能。ゲーム中も途中離脱対応のためホストが調整できる
- ホストはロビー・ゲーム中に、途中離脱などで残った参加者データを削除できる（ホスト自身は削除不可）
- ゲーム中は退出不可。参加情報を消すと途中復帰できず進行不能になり得るため、退出はロビーまたは結果画面でのみ許可する
- ルームは 3時間で失効、`expiresAt` 設定必須
- Firestore 書き込みは匿名認証済みユーザーのみ許可する。クライアント側では書き込み前に `authReady` を待つ。新規参加者には `authUid` を保存し、service 経由の操作では本人の匿名認証 UID と一致するか確認する
- Firebase Spark 運用のため Firestore TTL ポリシーは使わない。参加・再接続時に期限切れを検知したらクライアント側で削除を試み、完全放置ルームは必要に応じて Console で手動清掃する
- 同一プレイヤーの重複参加不可（id 一致でブロック）
- 最大8人（**遊ぶ人だけで数える**。進行だけのホストがいると一覧は最大9人）

## ホストの参加（2026-10-01 追加）

2026-10-01 オーナー決定: 待合室でホストの参加を選べる（初期値は従来どおり）。

- ロビーのホストだけに見える「設定」欄に「自分もプレイヤーとして参加する」チェックボックス（`#set-host-plays`）。保存先は `settings.hostPlays`（`setHostPlays()` の transaction）。**既定は参加（true）**、キーなしの旧ルームも参加扱い
- 変えられるのは `gamePhase === "lobby"` の間だけ・ホストだけ。「もう一度」「ロビーへ戻す」は同じ設定を引き継ぎ、戻ったロビーでまた変えられる
- 遊ぶ人 = `playingPlayers(room)`（参加なら全員、進行だけならホスト以外）。**開始条件・最大8人・ヒント役の重複チェックは遊ぶ人だけで数える**。ロビーの人数表示は「遊ぶ人数 N / 8」
- 参加に戻したとき、ホストのチームにほかのヒント役がいればホストは探す役に戻す（ヒント役の重複を防ぐ）。遊ぶ人がすでに8人いると参加にはできない
- 進行だけのホストは **チームに入れられない**。ロビー・ゲーム中の参加者管理でホストの行にチーム・役割ボタンを出さず、`updatePlayerRole()` も拒否する。一覧では「ホスト」＋「進行役」バッジと「チームに入らず進行します」
- 進行だけのホストのゲーム画面は `viewerOf()` で team / role を持たない視点にして描く。**未公開カードの `role` を DOM に出さない**（`cn-card--hidden`、マーカーなし。観戦ビューと同じ見え方）。ヒント送信・カード選び・パスは出さず、`submitHint` / `revealCard` / `endTurn` も service 側で拒否する。ホスト操作（ターンを進める・ヒントの取り消し・ロビーへ戻す・勝者指定で終了・みせる画面・参加者管理）は従来どおり
- 結果画面は全カード公開（従来どおり）。進行だけのホストには「あなたのチームの勝ち／負け」を出さない
- 再接続: 進行だけのホストもプレイヤー一覧に残っているので、sessionStorage からホストとして戻れる

## 観戦ビュー（みんなにみせる画面）

ゲームマスターがヒント役を兼ねると、自分の画面を共有したとき正解マップ（`cards[].role`）が映ってしまう。
参加していない人にも安全に進行を見せるための読み取り専用ビュー。

### 3原則（変更・拡張時も必ず守る）

1. **探す役セーフ原則**: 観戦DOMには「探す役（guesser）が見てよいもの」だけを出す。未公開カードの `role` は DOM のどこにも出さない（CSSクラス・data-* 属性・title・aria-label・HTMLコメント含め一切）
2. **完全分岐**: 観戦者はプレイヤー用コード経路（`restoreSession` / `ensureRoomSubscription` / `joinRoom` / transaction / プレイヤー用 `render()` ルーター / プレイヤー用イベントリスナー）に一切入らない。`?watch` パラメータが存在した時点で観戦モード確定とし、`initPlayerMode()` を丸ごとスキップする（値が不正でもプレイヤー画面へフォールバックせず、観戦用エラー画面で止める）
3. **書き込みゼロ**: Firestore への書き込み（setDoc / updateDoc / deleteDoc / runTransaction、失効ルーム削除含む）を一切しない。`subscribeToRoomForSpectator()`（`doc()` + `onSnapshot` のみ）で購読する。sessionStorage（`kotobatantei_session`）も読まない・書かない（観戦のセッションはURLそのもの）。共通初期化（firebase-config.js）に伴う匿名認証は許容する

### 入口3系統

- **URL `?watch=CODE`** — 共有リンク。app.js 初期化の最初で判定する
- **TOP「みんなにみせる画面」** — コード入力画面（hash ルート `#watch`）。送信時は同一ページ内でモード切替せず `location.replace` でフルリロード遷移する
- **ホストのロビー・ゲーム画面「みんなにみせる画面をひらく」** — クリックハンドラ内で同期的に `window.open(url, '_blank', 'noopener,noreferrer')`。「みせる画面のURLをコピー」も併設。どちらもホストにのみ表示

### フェーズ別表示（`gamePhase` で分岐、未知の値は default-deny で安全な待機画面）

| 状態 | 表示 |
|------|------|
| `lobby` | 「ホストがはじめるのをまっています」＋ルームコード＋参加者一覧 |
| `in_progress` | ターン帯／現在のヒント（`currentHint` が null なら必ず空。前のヒントを残さない）／両チームスコア／5×5盤面（全単語表示、`revealed === true` のカードのみ role の色） |
| `finished` | 勝者・終了理由＋全カード公開の盤面。**全公開は `gamePhase === 'finished' && !metadata.hasPendingWrites` のときのみ**。hasPendingWrites 中は in_progress と同じ安全盤面で描く（`includeMetadataChanges: true` により確定後に再発火する） |
| ドキュメント削除（exists=false） | finished 表示中なら購読解除して結果画面を維持。それ以外は購読解除して「このルームはおわりました」 |
| 失効（`expiresAt` 超過） | 購読解除して「このルームはおわりました」。**削除はしない**。スナップショット時に加え1分間隔の setInterval でも判定（購読解除時に必ず clearInterval） |
| 購読エラー | 「ルームをよみこめませんでした」（削除とは別文言） |

再戦追従: finished → lobby → in_progress とドキュメントが変われば素直に追従する（スナップショットごとに #app を innerHTML 全置換するため、前ゲームの正解色は残らない）。

### 保守ルール

- **secret に相当する未公開カードの `role` を DOM に出してよいのは `renderSpecFinish` のみ**。他の観戦レンダラには `toSpecCard()` で role を落としたデータだけを渡す構造を維持する
- 観戦盤面のカードは `<button>` ではなく非インタラクティブな div。イベントハンドラを付けない
- 観戦用 CSS クラスは `.cn-spec-` 接頭辞で新設する（プレイヤー用 `.cn-card--{role}` の付与ロジックを共有しない）
- 観戦の「もどる」ボタンは TOP（`#home`）へ戻さない。TOPへ戻すと `initPlayerMode` の `restoreSession` でプレイヤー画面（正解マップ）が共有中の画面に復元されうるため、必ずコード入力画面（`#watch`）へ戻す
- `renderScoreBoard(room)` は観戦ビューからも再利用している。**カード単位の情報を出力しない（集計値のみ）契約を保つこと**。プレイヤー用に表示を拡張する場合は、観戦ビューへの流入がないかを必ず確認する

## 単語セット

18カテゴリ × 各30語（移植元 [src/data/wordSets.ts](../../../codename_game/src/data/wordSets.ts) から移植 + Phase 4 / CX-5で4セット追加）:
身近なもの / 食べ物・日用品 / あそび / 自然 / 街 / 抽象 / スポーツ / 音楽・芸術 / 科学・技術 / 歴史・文化 / 職業 / 世界・地理 / 料理・食文化 / 動物
追加セット: オノマトペ / 二字熟語 / 和のことば / カタカナ語。いずれも各30語で、相談時に連想を広げやすい身近な語を中心にする。

各ゲームは選択した1セットから25語をランダム抽出。

## コンテンツガイドライン

room-K 共通の「学校・勉強・テストを避ける／恋愛・暴力・ダークな内容を避ける」を踏襲。
移植元では以下を調整済み:
- 学校セット → 「あそびセット」に差し替え
- 職業セットの `せんせい` → `ししょ`
- 身近なものセットの `つくえ` → `まくら`（学校を連想させるため。2026-10-01 オーナー依頼）
- 「暗殺者」→「トラップカード」、「スパイマスター」→「ヒント役」、「推理プレイヤー」→「探す役」

## 命名規則

- CSS接頭辞: `.cn-`（BEM: `.cn-block__element`）
- Firestore コレクション: `kotobatantei_rooms`
- セッション保存キー: `kotobatantei_session`

## 移植状況

- [x] 単語セット移植（`src/data/wordSets.ts` → `apps/kotoba-tantei/words.js`）
- [x] ルーム作成・参加フロー
- [x] ロビー（チーム・役割選択 + 開始条件バリデーション）
- [x] ゲーム画面（5×5 カードグリッド）
- [x] ヒント送信（ヒント役のみ表示）
- [x] カード公開 transaction
- [x] ターン終了 transaction
- [x] 結果画面・再戦
- [x] 再接続（sessionStorage）
- [x] 退出・クリーンアップ（listener off / 期限切れ検知削除）

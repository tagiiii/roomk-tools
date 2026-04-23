# ことば探偵 仕様書

## 目的・使用シーン
ヒントをもとにチームで相談しながらカードを見つける、連想型コミュニケーションゲーム。
roomK では「語彙を使う」より **「連想を言葉にする／相手の考えを聞く／正解が一つに見えない相談をする」** 体験として使う。

**移植元**: `codename_game`（別リポジトリ、React + TypeScript + Firestore）。本ディレクトリへ Vanilla JS + Firestore で移植中。
**参考**: 移植元コードは https://github.com/tagiiii/codename_game

## 画面構成・フロー

### ホスト
1. **ルーム作成画面** - 名前・単語セット・先攻チームを選んで作成
2. **ロビー画面** - 参加コードを共有／開始条件（各チーム2人以上＋ヒント役1・探す役1以上）を満たすとゲーム開始
3. **ゲーム画面（ヒント役 or 探す役）** - 5×5 の単語カードを見ながら進行
4. **結果画面** - 勝者表示／再戦／退出

### 参加者
1. **入室画面** - 名前・ルームコード入力
2. **ロビー画面** - 赤 or 青チーム＋ヒント役 or 探す役を選択
3. **ゲーム画面** - ホストと同じ盤面で役割に応じた UI

## Firestoreデータ構造

```
codenames_rooms/{roomId}
  - createdAt: Timestamp
  - expiresAt: Timestamp        // TTL（3時間）
  - gamePhase: "lobby" | "in_progress" | "finished"
  - turnTeam: "red" | "blue"
  - turnPhase: "waiting_hint" | "guessing"
  - currentHint: { word: string, count: number, byPlayerId: string, updatedAt: Timestamp } | null
  - remainingGuesses: number
  - firstTeam: "red" | "blue"
  - winner: "red" | "blue" | null
  - cards: Card[]               // 25枚の配列（index / word / role / revealed）
  - players: Player[]           // id / name / team / role / isHost
```

**Card**: `{ index: number, word: string, role: "red" | "blue" | "neutral" | "assassin", revealed: boolean }`
**Player**: `{ id: string, name: string, team: "red" | "blue", role: "spymaster" | "guesser", isHost: boolean }`

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
- **開始条件**: 各チーム2人以上 ＋ 各チームにヒント役1人 ＋ 各チーム探す役1人以上
- ヒント送信・カード公開・ターン終了は Firestore transaction で整合性担保（`runTransaction`）
- ロビー外での役割変更は不可
- ルームは 3時間で自動失効（TTL）、`expiresAt` 設定必須
- 同一プレイヤーの重複参加不可（id 一致でブロック）
- 最大8人

## 単語セット

14カテゴリ × 各30語（移植元 [src/data/wordSets.ts](../../../codename_game/src/data/wordSets.ts) から移植）:
身近なもの / 食べ物・日用品 / あそび / 自然 / 街 / 抽象 / スポーツ / 音楽・芸術 / 科学・技術 / 歴史・文化 / 職業 / 世界・地理 / 料理・食文化 / 動物

各ゲームは選択した1セットから25語をランダム抽出。

## コンテンツガイドライン

roomK 共通の「学校・勉強・テストを避ける／恋愛・暴力・ダークな内容を避ける」を踏襲。
移植元では以下を調整済み:
- 学校セット → 「あそびセット」に差し替え
- 職業セットの `せんせい` → `ししょ`
- 「暗殺者」→「トラップカード」、「スパイマスター」→「ヒント役」、「推理プレイヤー」→「探す役」

## 命名規則

- CSS接頭辞: `.cn-`（BEM: `.cn-block__element`）
- Firestore コレクション: `codenames_rooms`
- セッション保存キー: `codenames_session`

## 移植状況

- [ ] 単語セット移植（`src/data/wordSets.ts` → `apps/codenames/words.js`）
- [ ] ルーム作成・参加フロー
- [ ] ロビー（チーム・役割選択 + 開始条件バリデーション）
- [ ] ゲーム画面（5×5 カードグリッド）
- [ ] ヒント送信（ヒント役のみ表示）
- [ ] カード公開 transaction
- [ ] ターン終了 transaction
- [ ] 結果画面・再戦
- [ ] 再接続（sessionStorage）
- [ ] 退出・クリーンアップ（listener off / TTL 任せ）

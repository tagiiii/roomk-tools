import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "../shared/js/firebase-config.js";
import { generateSessionId, shuffle } from "../shared/js/utils.js";

export const ROOMS_COLLECTION = "codenames_rooms";
const ROOM_LIFETIME_HOURS = 3;
const MAX_PLAYERS = 8;

const CARD_DISTRIBUTION = {
  firstTeam: 9,
  secondTeam: 8,
  neutral: 7,
  assassin: 1,
};

/**
 * @typedef {"red" | "blue"} Team
 * @typedef {"spymaster" | "guesser"} Role
 * @typedef {"red" | "blue" | "neutral" | "assassin"} CardRole
 *
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {Team} team
 * @property {Role} role
 * @property {boolean} isHost
 *
 * @typedef {Object} Card
 * @property {number} index
 * @property {string} word
 * @property {CardRole} role
 * @property {boolean} revealed
 */

/**
 * 6桁のルームIDを生成する。
 * @returns {string}
 */
export function generateRoomId() {
  return generateSessionId(6);
}

/**
 * プレイヤーIDを生成する。
 * @returns {string}
 */
export function generatePlayerId() {
  return `player_${Date.now()}_${generateSessionId(6)}`;
}

/**
 * カードを生成する。
 * @param {string[]} words
 * @param {Team} firstTeam
 * @returns {Card[]}
 */
export function generateCards(words, firstTeam) {
  const selectedWords = shuffle(words).slice(0, 25);
  const secondTeam = firstTeam === "red" ? "blue" : "red";
  const roles = [
    ...Array(CARD_DISTRIBUTION.firstTeam).fill(firstTeam),
    ...Array(CARD_DISTRIBUTION.secondTeam).fill(secondTeam),
    ...Array(CARD_DISTRIBUTION.neutral).fill("neutral"),
    ...Array(CARD_DISTRIBUTION.assassin).fill("assassin"),
  ];
  const shuffledRoles = shuffle(roles);

  return selectedWords.map((word, index) => ({
    index,
    word,
    role: shuffledRoles[index],
    revealed: false,
  }));
}

/**
 * ルームを作成する。
 * @param {Omit<Player, "isHost">} hostPlayer
 * @param {string[]} words
 * @param {Team} firstTeam
 * @returns {Promise<string>}
 */
export async function createRoom(hostPlayer, words, firstTeam) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const roomId = generateRoomId();
    const roomRef = doc(db, ROOMS_COLLECTION, roomId);
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + ROOM_LIFETIME_HOURS * 60 * 60 * 1000);
    const room = {
      createdAt: now,
      expiresAt,
      gamePhase: "lobby",
      turnTeam: firstTeam,
      turnPhase: "waiting_hint",
      currentHint: null,
      remainingGuesses: 0,
      cards: generateCards(words, firstTeam),
      wordSetWords: words,
      players: [{ ...hostPlayer, isHost: true }],
      firstTeam,
      winner: null,
    };

    const created = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(roomRef);
      if (snapshot.exists()) return false;
      transaction.set(roomRef, room);
      return true;
    });

    if (created) return roomId;
  }

  throw new Error("ルームコードの作成に失敗しました。もう一度お試しください。");
}

/**
 * ルームへ参加する。
 * @param {string} roomId
 * @param {Omit<Player, "isHost">} player
 * @returns {Promise<void>}
 */
export async function joinRoom(roomId, player) {
  const normalizedRoomId = normalizeRoomId(roomId);
  const roomRef = doc(db, ROOMS_COLLECTION, normalizedRoomId);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) {
      throw new Error("ルームが見つかりません");
    }

    const room = snapshot.data();
    if (room.expiresAt?.toMillis?.() < Date.now()) {
      throw new Error("このルームは期限切れです");
    }
    if (room.gamePhase !== "lobby") {
      throw new Error("このルームはすでに開始しています");
    }

    const players = Array.isArray(room.players) ? room.players : [];
    if (players.length >= MAX_PLAYERS) {
      throw new Error("ルームが満員です");
    }
    if (players.some((p) => p.id === player.id || p.name === player.name)) {
      throw new Error("同じ名前の参加者がいます");
    }

    transaction.update(roomRef, {
      players: [...players, { ...player, isHost: false }],
    });
  });
}

/**
 * プレイヤーのチーム・役割を更新する。
 * @param {string} roomId
 * @param {string} playerId
 * @param {Partial<Pick<Player, "team" | "role">>} updates
 * @returns {Promise<void>}
 */
export async function updatePlayerRole(roomId, playerId, updates) {
  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) {
      throw new Error("ルームが見つかりません");
    }

    const room = snapshot.data();
    if (room.gamePhase !== "lobby") {
      throw new Error("ゲーム開始後は変更できません");
    }

    const players = Array.isArray(room.players) ? room.players : [];
    const currentPlayer = players.find((p) => p.id === playerId);
    if (!currentPlayer) {
      throw new Error("参加者が見つかりません");
    }

    const nextPlayer = { ...currentPlayer, ...updates };
    if (!["red", "blue"].includes(nextPlayer.team)) {
      throw new Error("チームを選んでください");
    }
    if (!["spymaster", "guesser"].includes(nextPlayer.role)) {
      throw new Error("役割を選んでください");
    }

    if (nextPlayer.role === "spymaster") {
      const existingSpymaster = players.find((p) =>
        p.id !== playerId && p.team === nextPlayer.team && p.role === "spymaster"
      );
      if (existingSpymaster) {
        throw new Error(`${teamLabel(nextPlayer.team)}のヒント役は既にいます`);
      }
    }

    transaction.update(roomRef, {
      players: players.map((p) => p.id === playerId ? nextPlayer : p),
    });
  });
}

/**
 * ゲームを開始する。
 * @param {string} roomId
 * @param {string} hostPlayerId
 * @returns {Promise<void>}
 */
export async function startGame(roomId, hostPlayerId) {
  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) {
      throw new Error("ルームが見つかりません");
    }

    const room = snapshot.data();
    if (room.gamePhase !== "lobby") {
      throw new Error("このルームはすでに開始しています");
    }

    const players = Array.isArray(room.players) ? room.players : [];
    const hostPlayer = players.find((p) => p.id === hostPlayerId);
    if (!hostPlayer?.isHost) {
      throw new Error("ホストだけがゲームを開始できます");
    }

    const conditions = getStartConditions(players);
    if (!conditions.every((condition) => condition.ok)) {
      throw new Error("開始条件を満たしていません");
    }

    transaction.update(roomRef, {
      gamePhase: "in_progress",
    });
  });
}

/**
 * ヒントを送信する。
 * @param {string} roomId
 * @param {{ word: string, count: number, byPlayerId: string, team: Team }} hint
 * @returns {Promise<void>}
 */
export async function submitHint(roomId, hint) {
  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) {
      throw new Error("ルームが見つかりません");
    }

    const room = snapshot.data();
    if (room.gamePhase !== "in_progress") {
      throw new Error("ゲーム中ではありません");
    }
    if (room.turnTeam !== hint.team) {
      throw new Error("ターンが切り替わりました");
    }
    if (room.turnPhase !== "waiting_hint") {
      throw new Error("今はヒントを送れません");
    }

    const players = Array.isArray(room.players) ? room.players : [];
    const player = players.find((p) => p.id === hint.byPlayerId);
    if (!player || player.team !== hint.team || player.role !== "spymaster") {
      throw new Error("ヒント役だけがヒントを送れます");
    }

    const word = String(hint.word || "").trim();
    const count = Number(hint.count);
    if (!word) {
      throw new Error("ヒントを入力してください");
    }
    if (!Number.isInteger(count) || count < 1 || count > 9) {
      throw new Error("枚数は1〜9から選んでください");
    }

    transaction.update(roomRef, {
      currentHint: {
        word,
        count,
        byPlayerId: hint.byPlayerId,
        updatedAt: Timestamp.now(),
      },
      turnPhase: "guessing",
      remainingGuesses: count + 1,
    });
  });
}

/**
 * カードを公開する。
 * @param {string} roomId
 * @param {number} cardIndex
 * @param {Team} expectedTurnTeam
 * @returns {Promise<{ changed: boolean, endedByTrap: boolean }>}
 */
export async function revealCard(roomId, cardIndex, expectedTurnTeam) {
  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) {
      throw new Error("ルームが見つかりません");
    }

    const room = snapshot.data();
    if (room.gamePhase !== "in_progress") {
      throw new Error("ゲーム中ではありません");
    }
    if (room.turnTeam !== expectedTurnTeam) {
      throw new Error("ターンが切り替わりました");
    }
    if (room.turnPhase !== "guessing") {
      throw new Error("今はカードを選べません");
    }

    const cards = Array.isArray(room.cards) ? room.cards : [];
    const card = cards[cardIndex];
    if (!card) {
      throw new Error("カードが見つかりません");
    }
    if (card.revealed) {
      return { changed: false, endedByTrap: false };
    }

    const updatedCards = cards.map((c, index) =>
      index === cardIndex ? { ...c, revealed: true } : c
    );
    const updates = { cards: updatedCards };

    if (card.role === "assassin") {
      updates.gamePhase = "finished";
      updates.winner = room.turnTeam === "red" ? "blue" : "red";
      transaction.update(roomRef, updates);
      return { changed: true, endedByTrap: true };
    }

    if (card.role === room.turnTeam) {
      const remainingGuesses = Math.max(Number(room.remainingGuesses || 0) - 1, 0);
      updates.remainingGuesses = remainingGuesses;

      const ownCards = updatedCards.filter((c) => c.role === room.turnTeam);
      const revealedOwnCards = ownCards.filter((c) => c.revealed);
      if (revealedOwnCards.length === ownCards.length) {
        updates.gamePhase = "finished";
        updates.winner = room.turnTeam;
      } else if (remainingGuesses === 0) {
        Object.assign(updates, nextTurnUpdates(room.turnTeam));
      }
    } else {
      Object.assign(updates, nextTurnUpdates(room.turnTeam));
    }

    transaction.update(roomRef, updates);
    return { changed: true, endedByTrap: false };
  });
}

/**
 * ターンを終了する。
 * @param {string} roomId
 * @param {Team} expectedTurnTeam
 * @returns {Promise<void>}
 */
export async function endTurn(roomId, expectedTurnTeam) {
  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) {
      throw new Error("ルームが見つかりません");
    }

    const room = snapshot.data();
    if (room.gamePhase !== "in_progress") {
      throw new Error("ゲーム中ではありません");
    }
    if (room.turnTeam !== expectedTurnTeam) {
      throw new Error("ターンが切り替わりました");
    }
    if (room.turnPhase !== "guessing") {
      throw new Error("今はターンを終了できません");
    }

    transaction.update(roomRef, nextTurnUpdates(room.turnTeam));
  });
}

/**
 * 同じ参加者・役割でロビーに戻す。
 * @param {string} roomId
 * @param {string} hostPlayerId
 * @returns {Promise<void>}
 */
export async function restartGame(roomId, hostPlayerId) {
  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) {
      throw new Error("ルームが見つかりません");
    }

    const room = snapshot.data();
    const players = Array.isArray(room.players) ? room.players : [];
    const hostPlayer = players.find((p) => p.id === hostPlayerId);
    if (!hostPlayer?.isHost) {
      throw new Error("ホストだけがもう一度始められます");
    }

    const sourceWords = Array.isArray(room.wordSetWords) && room.wordSetWords.length >= 25
      ? room.wordSetWords
      : (room.cards || []).map((card) => card.word);
    const firstTeam = room.firstTeam || "red";

    transaction.update(roomRef, {
      gamePhase: "lobby",
      turnTeam: firstTeam,
      turnPhase: "waiting_hint",
      currentHint: null,
      remainingGuesses: 0,
      cards: generateCards(sourceWords, firstTeam),
      winner: null,
    });
  });
}

/**
 * ルームを1回取得する。
 * @param {string} roomId
 * @returns {Promise<object | null>}
 */
export async function getRoom(roomId) {
  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));
  const snapshot = await getDoc(roomRef);
  return snapshot.exists() ? snapshot.data() : null;
}

/**
 * ルームを購読する。
 * @param {string} roomId
 * @param {(room: object | null) => void} callback
 * @param {(error: Error) => void} onError
 * @returns {() => void}
 */
export function subscribeToRoom(roomId, callback, onError = console.error) {
  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));
  return onSnapshot(roomRef, (snapshot) => {
    callback(snapshot.exists() ? snapshot.data() : null);
  }, onError);
}

/**
 * ルームIDを正規化する。
 * @param {string} roomId
 * @returns {string}
 */
export function normalizeRoomId(roomId) {
  return String(roomId || "").trim().toUpperCase();
}

/**
 * 開始条件を返す。
 * @param {Player[]} players
 * @returns {{ id: string, label: string, ok: boolean }[]}
 */
export function getStartConditions(players) {
  const redPlayers = players.filter((p) => p.team === "red");
  const bluePlayers = players.filter((p) => p.team === "blue");
  const redSpymaster = redPlayers.some((p) => p.role === "spymaster");
  const blueSpymaster = bluePlayers.some((p) => p.role === "spymaster");
  const redGuessers = redPlayers.filter((p) => p.role === "guesser");
  const blueGuessers = bluePlayers.filter((p) => p.role === "guesser");

  return [
    { id: "red-count", label: "赤チーム: 2人以上", ok: redPlayers.length >= 2 },
    { id: "blue-count", label: "青チーム: 2人以上", ok: bluePlayers.length >= 2 },
    { id: "red-spymaster", label: "赤チーム: ヒント役1人", ok: redSpymaster },
    { id: "blue-spymaster", label: "青チーム: ヒント役1人", ok: blueSpymaster },
    { id: "red-guesser", label: "赤チーム: 探す役1人以上", ok: redGuessers.length >= 1 },
    { id: "blue-guesser", label: "青チーム: 探す役1人以上", ok: blueGuessers.length >= 1 },
  ];
}

function teamLabel(team) {
  return team === "blue" ? "青チーム" : "赤チーム";
}

function nextTurnUpdates(currentTeam) {
  return {
    turnTeam: currentTeam === "red" ? "blue" : "red",
    turnPhase: "waiting_hint",
    currentHint: null,
    remainingGuesses: 0,
  };
}

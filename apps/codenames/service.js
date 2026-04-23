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

import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { auth, authReady, db } from "../shared/js/firebase-config.js";
import { generateSessionId, shuffle } from "../shared/js/utils.js";

export const ROOMS_COLLECTION = "kotobatantei_rooms";
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
 * @property {string=} authUid
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
 * ルームの期限切れ判定。
 * @param {object | null} room
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isRoomExpired(room, nowMs = Date.now()) {
  const expiresAtMs = room?.expiresAt?.toMillis?.();
  return Number.isFinite(expiresAtMs) && expiresAtMs < nowMs;
}

/**
 * ルームを作成する。
 * @param {Omit<Player, "isHost">} hostPlayer
 * @param {string[]} words
 * @param {Team} firstTeam
 * @returns {Promise<string>}
 */
export async function createRoom(hostPlayer, words, firstTeam) {
  const authUser = await ensureAuthenticated();

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
      players: [{ ...hostPlayer, authUid: authUser.uid, isHost: true }],
      firstTeam,
      winner: null,
      finishReason: null,
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
  const authUser = await ensureAuthenticated();

  const normalizedRoomId = normalizeRoomId(roomId);
  const roomRef = doc(db, ROOMS_COLLECTION, normalizedRoomId);

  const result = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) {
      throw new Error("ルームが見つかりません");
    }

    const room = snapshot.data();
    if (isRoomExpired(room)) {
      transaction.delete(roomRef);
      return "expired";
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
      players: [...players, { ...player, authUid: authUser.uid, isHost: false }],
    });
    return "joined";
  });

  if (result === "expired") {
    throw new Error("このルームは期限切れです");
  }
}

/**
 * 期限切れルームを削除する。未期限切れ・存在なしなら何もしない。
 * @param {string} roomId
 * @returns {Promise<boolean>} 削除した場合 true
 */
export async function deleteExpiredRoom(roomId) {
  await ensureAuthenticated();

  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) return false;

    const room = snapshot.data();
    if (!isRoomExpired(room)) return false;

    transaction.delete(roomRef);
    return true;
  });
}

/**
 * ロビー退出時にプレイヤーをルームから除外する。
 * 進行中・終了後のゲームは盤面整合性を優先して参加者を残す。
 * @param {string} roomId
 * @param {string} playerId
 * @returns {Promise<void>}
 */
export async function leaveRoom(roomId, playerId) {
  await ensureAuthenticated();

  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) return;

    const room = snapshot.data();
    if (room.gamePhase !== "lobby") return;

    const players = Array.isArray(room.players) ? room.players : [];
    const leaver = players.find((p) => p.id === playerId);
    if (!leaver) return;
    assertActorMatchesSession(leaver);

    if (leaver.isHost) {
      transaction.delete(roomRef);
      return;
    }

    transaction.update(roomRef, {
      players: players.filter((p) => p.id !== playerId),
    });
  });
}

/**
 * プレイヤーのチーム・役割をホストが更新する。
 * @param {string} roomId
 * @param {string} targetPlayerId
 * @param {Partial<Pick<Player, "team" | "role">>} updates
 * @param {string} actorPlayerId
 * @returns {Promise<void>}
 */
export async function updatePlayerRole(roomId, targetPlayerId, updates, actorPlayerId) {
  await ensureAuthenticated();

  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) {
      throw new Error("ルームが見つかりません");
    }

    const room = snapshot.data();
    if (!["lobby", "in_progress"].includes(room.gamePhase)) {
      throw new Error("このタイミングでは変更できません");
    }

    const players = Array.isArray(room.players) ? room.players : [];
    const actorPlayer = players.find((p) => p.id === actorPlayerId);
    if (!actorPlayer?.isHost) {
      throw new Error("ホストだけが役割を変更できます");
    }
    assertActorMatchesSession(actorPlayer);

    const targetPlayer = players.find((p) => p.id === targetPlayerId);
    if (!targetPlayer) {
      throw new Error("参加者が見つかりません");
    }

    const nextPlayer = {
      ...targetPlayer,
      team: updates.team ?? targetPlayer.team,
      role: updates.role ?? targetPlayer.role,
    };
    if (!["red", "blue"].includes(nextPlayer.team)) {
      throw new Error("チームを選んでください");
    }
    if (!["spymaster", "guesser"].includes(nextPlayer.role)) {
      throw new Error("役割を選んでください");
    }

    if (nextPlayer.role === "spymaster") {
      const existingSpymaster = players.find((p) =>
        p.id !== targetPlayerId && p.team === nextPlayer.team && p.role === "spymaster"
      );
      if (existingSpymaster) {
        throw new Error(`${teamLabel(nextPlayer.team)}のヒント役は既にいます`);
      }
    }

    transaction.update(roomRef, {
      players: players.map((p) => p.id === targetPlayerId ? nextPlayer : p),
    });
  });
}

/**
 * ホストが残った参加者データをルームから除外する。
 * @param {string} roomId
 * @param {string} targetPlayerId
 * @param {string} actorPlayerId
 * @returns {Promise<void>}
 */
export async function removePlayerFromRoom(roomId, targetPlayerId, actorPlayerId) {
  await ensureAuthenticated();

  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) {
      throw new Error("ルームが見つかりません");
    }

    const room = snapshot.data();
    if (!["lobby", "in_progress"].includes(room.gamePhase)) {
      throw new Error("このタイミングでは整理できません");
    }

    const players = Array.isArray(room.players) ? room.players : [];
    const actorPlayer = players.find((p) => p.id === actorPlayerId);
    if (!actorPlayer?.isHost) {
      throw new Error("ホストだけが参加者を整理できます");
    }
    assertActorMatchesSession(actorPlayer);

    const targetPlayer = players.find((p) => p.id === targetPlayerId);
    if (!targetPlayer) {
      throw new Error("参加者が見つかりません");
    }
    if (targetPlayer.isHost) {
      throw new Error("ホストは削除できません");
    }

    transaction.update(roomRef, {
      players: players.filter((p) => p.id !== targetPlayerId),
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
  await ensureAuthenticated();

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
    assertActorMatchesSession(hostPlayer);

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
  await ensureAuthenticated();

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
    assertActorMatchesSession(player);

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
      remainingGuesses: count,
    });
  });
}

/**
 * カードを公開する。
 * @param {string} roomId
 * @param {number} cardIndex
 * @param {Team} expectedTurnTeam
 * @param {string} actorPlayerId
 * @returns {Promise<{ changed: boolean, endedByTrap: boolean }>}
 */
export async function revealCard(roomId, cardIndex, expectedTurnTeam, actorPlayerId) {
  await ensureAuthenticated();

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
    assertCurrentGuesser(room, actorPlayerId);

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
      updates.finishReason = "trap";
      transaction.update(roomRef, updates);
      return { changed: true, endedByTrap: true };
    }

    if (["red", "blue"].includes(card.role)) {
      const teamCards = updatedCards.filter((c) => c.role === card.role);
      const revealedTeamCards = teamCards.filter((c) => c.revealed);
      if (revealedTeamCards.length === teamCards.length) {
        updates.gamePhase = "finished";
        updates.winner = card.role;
        updates.finishReason = "all_found";
        transaction.update(roomRef, updates);
        return { changed: true, endedByTrap: false };
      }
    }

    if (card.role === room.turnTeam) {
      const remainingGuesses = Math.max(Number(room.remainingGuesses || 0) - 1, 0);
      updates.remainingGuesses = remainingGuesses;
      if (remainingGuesses === 0) {
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
 * @param {string} actorPlayerId
 * @returns {Promise<void>}
 */
export async function endTurn(roomId, expectedTurnTeam, actorPlayerId) {
  await ensureAuthenticated();

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
    assertCurrentGuesser(room, actorPlayerId);

    transaction.update(roomRef, nextTurnUpdates(room.turnTeam));
  });
}

/**
 * ホストが現在のターンを強制終了する。
 * @param {string} roomId
 * @param {string} hostPlayerId
 * @returns {Promise<void>}
 */
export async function forceEndTurn(roomId, hostPlayerId) {
  await ensureAuthenticated();

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

    const players = Array.isArray(room.players) ? room.players : [];
    const hostPlayer = players.find((p) => p.id === hostPlayerId);
    if (!hostPlayer?.isHost) {
      throw new Error("ホストだけがターンを進められます");
    }
    assertActorMatchesSession(hostPlayer);

    transaction.update(roomRef, nextTurnUpdates(room.turnTeam));
  });
}

/**
 * ヒントを取り消して、同じチームのヒント待ちに戻す。
 * @param {string} roomId
 * @param {string} actorPlayerId
 * @returns {Promise<void>}
 */
export async function resetHint(roomId, actorPlayerId) {
  await ensureAuthenticated();

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
    if (room.turnPhase !== "guessing") {
      throw new Error("今はヒントを取り消せません");
    }
    const hintCount = Number(room.currentHint?.count);
    const expectedRemainingGuesses = Number.isFinite(hintCount) ? hintCount : null;
    if (expectedRemainingGuesses !== Number(room.remainingGuesses || 0)) {
      throw new Error("カードを選んだ後はヒントを取り消せません");
    }

    const players = Array.isArray(room.players) ? room.players : [];
    const actorPlayer = players.find((p) => p.id === actorPlayerId);
    const isCurrentSpymaster =
      actorPlayer?.team === room.turnTeam && actorPlayer.role === "spymaster";
    if (!actorPlayer?.isHost && !isCurrentSpymaster) {
      throw new Error("ホストまたは現在のヒント役だけが取り消せます");
    }
    assertActorMatchesSession(actorPlayer);

    transaction.update(roomRef, {
      turnPhase: "waiting_hint",
      currentHint: null,
      remainingGuesses: 0,
    });
  });
}

/**
 * ホストが勝者を指定してゲームを終了する。
 * @param {string} roomId
 * @param {string} hostPlayerId
 * @param {Team} winner
 * @returns {Promise<void>}
 */
export async function finishGame(roomId, hostPlayerId, winner) {
  await ensureAuthenticated();

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
    if (!["red", "blue"].includes(winner)) {
      throw new Error("勝者を選んでください");
    }

    const players = Array.isArray(room.players) ? room.players : [];
    const hostPlayer = players.find((p) => p.id === hostPlayerId);
    if (!hostPlayer?.isHost) {
      throw new Error("ホストだけがゲームを終了できます");
    }
    assertActorMatchesSession(hostPlayer);

    transaction.update(roomRef, {
      gamePhase: "finished",
      winner,
      finishReason: "manual",
    });
  });
}

/**
 * 同じ参加者・役割でロビーに戻す。
 * @param {string} roomId
 * @param {string} hostPlayerId
 * @returns {Promise<void>}
 */
export async function restartGame(roomId, hostPlayerId) {
  await ensureAuthenticated();

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
    assertActorMatchesSession(hostPlayer);

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
      finishReason: null,
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
 * 観戦用にルームを購読する（読み取り専用）。
 * doc() + onSnapshot のみで構成し、書き込みAPIは一切呼ばない。
 * includeMetadataChanges を有効にし、hasPendingWrites の確定後にも再発火させる。
 * @param {string} roomId
 * @param {(result: { exists: boolean, room: object | null, hasPendingWrites: boolean }) => void} callback
 * @param {(error: Error) => void} onError
 * @returns {() => void}
 */
export function subscribeToRoomForSpectator(roomId, callback, onError = console.error) {
  const roomRef = doc(db, ROOMS_COLLECTION, normalizeRoomId(roomId));
  return onSnapshot(roomRef, { includeMetadataChanges: true }, (snapshot) => {
    callback({
      exists: snapshot.exists(),
      room: snapshot.exists() ? snapshot.data() : null,
      hasPendingWrites: snapshot.metadata.hasPendingWrites,
    });
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

async function ensureAuthenticated() {
  await authReady;
  if (!auth.currentUser) {
    throw new Error("接続準備が完了していません。少し待ってもう一度お試しください");
  }
  return auth.currentUser;
}

function assertActorMatchesSession(player) {
  if (!player) {
    throw new Error("参加者が見つかりません");
  }
  if (player.authUid && player.authUid !== auth.currentUser?.uid) {
    throw new Error("この参加者として操作する権限がありません");
  }
}

function assertCurrentGuesser(room, actorPlayerId) {
  const players = Array.isArray(room.players) ? room.players : [];
  const actorPlayer = players.find((p) => p.id === actorPlayerId);
  if (!actorPlayer || actorPlayer.team !== room.turnTeam || actorPlayer.role !== "guesser") {
    throw new Error("現在の探す役だけが操作できます");
  }
  assertActorMatchesSession(actorPlayer);
}

function nextTurnUpdates(currentTeam) {
  return {
    turnTeam: currentTeam === "red" ? "blue" : "red",
    turnPhase: "waiting_hint",
    currentHint: null,
    remainingGuesses: 0,
  };
}

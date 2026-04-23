// ことば探偵
// 仕様: apps/codenames/AGENTS.md を参照
// 移植元: https://github.com/tagiiii/codename_game （codename_game/src/）

import { copyToClipboard, escapeHtml, showToast } from "../shared/js/utils.js";
import {
  createRoom,
  endTurn,
  generatePlayerId,
  getStartConditions,
  joinRoom,
  leaveRoom,
  normalizeRoomId,
  restartGame,
  revealCard,
  startGame,
  submitHint,
  subscribeToRoom,
  updatePlayerRole,
} from "./service.js";
import { wordSets } from "./words.js";

const appEl = document.querySelector("#app");
const SESSION_KEY = "codenames_session";

const state = {
  roomId: "",
  playerId: "",
  room: null,
  unsubscribe: null,
  subscribedRoomId: "",
  loading: false,
  submitting: false,
  notification: null,
  error: "",
};

const esc = escapeHtml;

function getRoute() {
  return (window.location.hash || "#home").replace("#", "");
}

function navigate(route) {
  window.location.hash = route;
}

function saveSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    roomId: state.roomId,
    playerId: state.playerId,
  }));
}

function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (!saved?.roomId || !saved?.playerId) return false;
    state.roomId = saved.roomId;
    state.playerId = saved.playerId;
    return true;
  } catch {
    return false;
  }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  state.roomId = "";
  state.playerId = "";
  state.room = null;
  stopRoomSubscription();
}

function stopRoomSubscription() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = null;
  state.subscribedRoomId = "";
}

async function handleLeaveRoom() {
  const roomId = state.roomId;
  const playerId = state.playerId;

  try {
    if (roomId && playerId) {
      await leaveRoom(roomId, playerId);
    }
  } catch (error) {
    console.warn("[codenames] leaveRoom failed", error);
  } finally {
    clearSession();
    showToast("ホームに戻りました", "info");
    navigate("home");
  }
}

function render() {
  const route = getRoute();
  if (route === "create") return renderCreate();
  if (route === "join") return renderJoin();
  if (route === "lobby") return renderLobby();
  if (route === "game") return renderGame();
  if (route === "finish") return renderFinish();
  return renderHome();
}

function renderHome() {
  stopRoomSubscription();
  appEl.innerHTML = `
    <section class="card cn-panel">
      <p class="badge badge-accent">Firestore同期</p>
      <h1 class="cn-title">ことば探偵</h1>
      <p class="text-muted">ヒント役の言葉をもとに、チームで相談しながら単語カードを見つけるゲームです。</p>
      ${state.error ? `<div class="alert alert-error mt-md">${esc(state.error)}</div>` : ""}
      <div class="cn-actions mt-lg">
        <button class="btn btn-primary btn-full" data-route="create">
          <span class="material-symbols-rounded">add_circle</span>ルームを作る
        </button>
        <button class="btn btn-secondary btn-full" data-route="join">
          <span class="material-symbols-rounded">login</span>ルームに参加する
        </button>
      </div>
    </section>
  `;
}

function renderCreate() {
  const wordOptions = wordSets.map((set) => (
    `<option value="${esc(set.id)}">${esc(set.label)}</option>`
  )).join("");

  appEl.innerHTML = `
    <section class="card cn-panel">
      <h1 class="cn-title">ルームを作る</h1>
      <form id="create-form" class="cn-form">
        <label class="form-group">
          <span class="form-label">あなたの名前</span>
          <input class="form-input" name="nickname" maxlength="8" autocomplete="nickname" placeholder="例: たろう" required />
        </label>
        <label class="form-group">
          <span class="form-label">単語セット</span>
          <select class="form-select" name="wordSetId">${wordOptions}</select>
        </label>
        <label class="form-group">
          <span class="form-label">先攻チーム</span>
          <select class="form-select" name="firstTeam">
            <option value="red">赤チーム</option>
            <option value="blue">青チーム</option>
          </select>
        </label>
        ${state.error ? `<div class="alert alert-error">${esc(state.error)}</div>` : ""}
        <div class="cn-actions">
          <button class="btn btn-primary btn-full" type="submit" ${state.loading ? "disabled" : ""}>
            ${state.loading ? "作成中..." : "ルームを作成"}
          </button>
          <button class="btn btn-ghost btn-full" type="button" data-route="home">戻る</button>
        </div>
      </form>
    </section>
  `;
}

function renderJoin() {
  appEl.innerHTML = `
    <section class="card cn-panel">
      <h1 class="cn-title">ルームに参加する</h1>
      <form id="join-form" class="cn-form">
        <label class="form-group">
          <span class="form-label">あなたの名前</span>
          <input class="form-input" name="nickname" maxlength="8" autocomplete="nickname" placeholder="例: はなこ" required />
        </label>
        <label class="form-group">
          <span class="form-label">ルームコード</span>
          <input class="form-input cn-room-code-input" name="roomId" maxlength="6" autocomplete="off" placeholder="例: ABC234" required />
        </label>
        ${state.error ? `<div class="alert alert-error">${esc(state.error)}</div>` : ""}
        <div class="cn-actions">
          <button class="btn btn-primary btn-full" type="submit" ${state.loading ? "disabled" : ""}>
            ${state.loading ? "参加中..." : "参加する"}
          </button>
          <button class="btn btn-ghost btn-full" type="button" data-route="home">戻る</button>
        </div>
      </form>
    </section>
  `;
}

function renderLobby() {
  if (!state.roomId || !state.playerId) {
    if (!restoreSession()) {
      state.error = "参加情報が見つかりません。もう一度入室してください。";
      navigate("home");
      return;
    }
  }

  ensureRoomSubscription();

  if (!state.room) {
    appEl.innerHTML = `
      <div class="loading-overlay">
        <div class="spinner"></div>
        <p>ルームを読み込み中...</p>
      </div>
    `;
    return;
  }

  if (state.room.gamePhase === "finished" && !state.notification?.visible) {
    navigate("finish");
    return;
  }

  const currentPlayer = state.room.players?.find((p) => p.id === state.playerId);
  const players = state.room.players || [];
  const startable = canStart(players);
  const playerList = players.map((player) => `
    <li class="cn-player">
      <span>
        ${esc(player.name)}
        ${player.isHost ? '<span class="badge badge-primary">ホスト</span>' : ""}
      </span>
      <span class="text-muted">${esc(teamLabel(player.team))} / ${esc(roleLabel(player.role))}</span>
    </li>
  `).join("");

  appEl.innerHTML = `
    <section class="card cn-panel">
      <div class="cn-lobby-header">
        <div>
          <p class="text-muted">ルームコード</p>
          <h1 class="cn-room-code">${esc(state.roomId)}</h1>
        </div>
        <button class="btn btn-secondary btn-sm" id="copy-room-code" type="button">
          <span class="material-symbols-rounded">content_copy</span>コピー
      </button>
      </div>
      ${currentPlayer ? renderPlayerControls(currentPlayer) : ""}
      <div class="cn-status-grid mt-lg">
        <div class="cn-status">
          <span class="text-muted">あなた</span>
          <strong>${esc(currentPlayer?.name || "不明")}</strong>
          <span class="text-muted">${esc(teamLabel(currentPlayer?.team))} / ${esc(roleLabel(currentPlayer?.role))}</span>
        </div>
        <div class="cn-status">
          <span class="text-muted">参加人数</span>
          <strong>${players.length} / 8</strong>
        </div>
      </div>
      <h2 class="cn-section-title">開始条件</h2>
      <ul class="cn-condition-list">${renderStartConditions(players)}</ul>
      <h2 class="cn-section-title">参加者</h2>
      <ul class="cn-player-list">${playerList}</ul>
      ${state.error ? `<div class="alert alert-error mt-md">${esc(state.error)}</div>` : ""}
      ${currentPlayer?.isHost ? `
        <button class="btn btn-primary btn-full mt-lg" id="start-game" type="button" ${!startable || state.loading ? "disabled" : ""}>
          ${state.loading ? "開始中..." : "ゲーム開始"}
        </button>
      ` : '<p class="text-muted mt-lg">ホストがゲームを開始するまで待ってください。</p>'}
      <button class="btn btn-ghost btn-full mt-lg" id="leave-room" type="button">ホームへ戻る</button>
    </section>
  `;
}

function renderGame() {
  if (!state.roomId || !state.playerId) {
    if (!restoreSession()) {
      state.error = "参加情報が見つかりません。もう一度入室してください。";
      navigate("home");
      return;
    }
  }

  ensureRoomSubscription();

  if (!state.room) {
    appEl.innerHTML = `
      <div class="loading-overlay">
        <div class="spinner"></div>
        <p>ゲームを読み込み中...</p>
      </div>
    `;
    return;
  }

  const currentPlayer = state.room.players?.find((p) => p.id === state.playerId);
  if (!currentPlayer) {
    appEl.innerHTML = `
      <section class="card cn-panel">
        <h1 class="cn-title">参加者が見つかりません</h1>
        <button class="btn btn-ghost btn-full mt-lg" id="leave-room" type="button">ホームへ戻る</button>
      </section>
    `;
    return;
  }

  appEl.innerHTML = `
    <section class="card cn-panel cn-game-panel">
      <div class="cn-game-header">
        <div>
          <p class="text-muted">ルーム ${esc(state.roomId)}</p>
          <h1 class="cn-title">${esc(turnTitle(state.room))}</h1>
        </div>
        <div class="cn-role-chip">${esc(teamLabel(currentPlayer.team))} / ${esc(roleLabel(currentPlayer.role))}</div>
      </div>
      ${renderHintArea(state.room, currentPlayer)}
      ${state.error ? `<div class="alert alert-error">${esc(state.error)}</div>` : ""}
      <div class="cn-board" aria-label="単語カード">
        ${renderCards(state.room.cards || [], currentPlayer)}
      </div>
      ${renderTurnActions(state.room, currentPlayer)}
      <button class="btn btn-ghost btn-full mt-lg" id="leave-room" type="button">ホームへ戻る</button>
    </section>
    ${renderNotification()}
  `;
}

function renderFinish() {
  if (!state.roomId || !state.playerId) {
    if (!restoreSession()) {
      state.error = "参加情報が見つかりません。もう一度入室してください。";
      navigate("home");
      return;
    }
  }

  ensureRoomSubscription();

  if (!state.room) {
    appEl.innerHTML = `
      <div class="loading-overlay">
        <div class="spinner"></div>
        <p>結果を読み込み中...</p>
      </div>
    `;
    return;
  }

  const currentPlayer = state.room.players?.find((p) => p.id === state.playerId);
  const winner = state.room.winner;
  const isWinner = currentPlayer?.team === winner;

  appEl.innerHTML = `
    <section class="card cn-panel cn-game-panel">
      <div class="cn-result cn-result--${esc(winner || "neutral")}">
        <p class="text-muted">結果</p>
        <h1 class="cn-title">${esc(teamLabel(winner))}が全部見つけました</h1>
        <p class="text-bold">${isWinner ? "勝ち" : "負け"}</p>
      </div>
      ${state.error ? `<div class="alert alert-error">${esc(state.error)}</div>` : ""}
      <div class="cn-board" aria-label="公開された単語カード">
        ${renderCards(state.room.cards || [], { ...currentPlayer, role: "spymaster" }, { revealAll: true })}
      </div>
      ${currentPlayer?.isHost ? `
        <button class="btn btn-primary btn-full mt-lg" id="restart-game" type="button" ${state.loading ? "disabled" : ""}>
          ${state.loading ? "準備中..." : "もう一度"}
        </button>
      ` : ""}
      <button class="btn btn-ghost btn-full mt-md" id="leave-room" type="button">退出</button>
    </section>
  `;
}

function ensureRoomSubscription() {
  if (state.unsubscribe && state.subscribedRoomId === state.roomId) return;
  stopRoomSubscription();
  state.subscribedRoomId = state.roomId;
  state.unsubscribe = subscribeToRoom(state.roomId, (room) => {
    state.loading = false;
    state.submitting = false;
    state.room = room;
    if (!room) {
      state.error = "ルームが見つかりません";
      clearSession();
      navigate("home");
      return;
    }
    if (room.gamePhase === "in_progress" && getRoute() === "lobby") {
      navigate("game");
      return;
    }
    if (room.gamePhase === "finished" && ["game", "lobby"].includes(getRoute())) {
      if (state.notification?.visible) {
        renderGame();
        return;
      }
      navigate("finish");
      return;
    }
    if (room.gamePhase === "lobby" && ["game", "finish"].includes(getRoute())) {
      navigate("lobby");
      return;
    }
    if (getRoute() === "lobby") renderLobby();
    if (getRoute() === "game") renderGame();
    if (getRoute() === "finish") renderFinish();
  }, (error) => {
    state.error = error.message || "ルームの読み込みに失敗しました";
    renderLobby();
  });
}

function validateNickname(value) {
  const nickname = String(value || "").trim();
  if (!nickname) throw new Error("名前を入力してください");
  if (nickname.length > 8) throw new Error("名前は8文字以内にしてください");
  return nickname;
}

function teamLabel(team) {
  return team === "blue" ? "青チーム" : "赤チーム";
}

function roleLabel(role) {
  return role === "spymaster" ? "ヒント役" : "探す役";
}

function renderPlayerControls(currentPlayer) {
  const teamButtons = ["red", "blue"].map((team) => `
    <button
      class="btn ${currentPlayer.team === team ? "btn-primary" : "btn-secondary"} btn-sm"
      type="button"
      data-team="${team}"
      ${state.loading ? "disabled" : ""}
    >${teamLabel(team)}</button>
  `).join("");

  const roleButtons = ["spymaster", "guesser"].map((role) => `
    <button
      class="btn ${currentPlayer.role === role ? "btn-primary" : "btn-secondary"} btn-sm"
      type="button"
      data-role="${role}"
      ${state.loading ? "disabled" : ""}
    >${roleLabel(role)}</button>
  `).join("");

  return `
    <div class="cn-controls">
      <div>
        <p class="form-label">チーム</p>
        <div class="cn-toggle-row">${teamButtons}</div>
      </div>
      <div>
        <p class="form-label">役割</p>
        <div class="cn-toggle-row">${roleButtons}</div>
      </div>
    </div>
  `;
}

function renderStartConditions(players) {
  return getStartConditions(players).map((condition) => `
    <li class="${condition.ok ? "cn-condition-ok" : "cn-condition-ng"}">
      <span class="material-symbols-rounded">${condition.ok ? "check_circle" : "radio_button_unchecked"}</span>
      ${esc(condition.label)}
    </li>
  `).join("");
}

function canStart(players) {
  return getStartConditions(players).every((condition) => condition.ok);
}

function turnTitle(room) {
  const team = teamLabel(room.turnTeam);
  if (room.turnPhase === "waiting_hint") return `${team}のヒント待ち`;
  return `${team}の推理中 残り${room.remainingGuesses || 0}`;
}

function renderHintArea(room, currentPlayer) {
  const canSubmitHint =
    room.turnTeam === currentPlayer.team &&
    currentPlayer.role === "spymaster" &&
    room.turnPhase === "waiting_hint";

  if (canSubmitHint) {
    const options = Array.from({ length: 9 }, (_, index) => {
      const count = index + 1;
      return `<option value="${count}">${count}まい</option>`;
    }).join("");

    return `
      <form id="hint-form" class="cn-hint-form">
        <label class="form-group">
          <span class="form-label">ヒント</span>
          <input class="form-input" name="hintWord" maxlength="12" autocomplete="off" placeholder="例: どうぶつ" required />
        </label>
        <label class="form-group">
          <span class="form-label">枚数</span>
          <select class="form-select" name="hintCount">${options}</select>
        </label>
        <button class="btn btn-primary" type="submit" ${state.submitting ? "disabled" : ""}>
          ${state.submitting ? "送信中..." : "ヒント送信"}
        </button>
      </form>
    `;
  }

  if (room.currentHint && room.turnPhase === "guessing") {
    return `
      <div class="cn-current-hint">
        <span class="text-muted">現在のヒント</span>
        <strong>「${esc(room.currentHint.word)}」${Number(room.currentHint.count)}まい</strong>
        <span class="badge badge-accent">残り${Number(room.remainingGuesses || 0)}</span>
      </div>
    `;
  }

  return `<div class="alert alert-info">ヒント役がヒントを考えています。</div>`;
}

function renderCards(cards, currentPlayer, options = {}) {
  return cards.map((card) => {
    const visibleRole = options.revealAll || card.revealed || currentPlayer.role === "spymaster";
    const roleClass = visibleRole ? `cn-card--${card.role}` : "cn-card--hidden";
    const revealedClass = card.revealed ? "cn-card--revealed" : "";
    const marker = visibleRole
      ? `<span class="cn-card-marker">${esc(cardRoleLabel(card.role))}</span>`
      : "";
    const canClick = canRevealCard(card, currentPlayer);

    return `
      <button
        class="cn-card ${roleClass} ${revealedClass} ${canClick ? "cn-card--clickable" : ""}"
        type="button"
        data-card-index="${card.index}"
        ${canClick ? "" : "disabled"}
      >
        ${marker}
        <span class="cn-card-word">${esc(card.word)}</span>
      </button>
    `;
  }).join("");
}

function cardRoleLabel(role) {
  if (role === "red") return "赤";
  if (role === "blue") return "青";
  if (role === "assassin") return "トラップ";
  return "中立";
}

function canRevealCard(card, currentPlayer) {
  return !!card &&
    !state.submitting &&
    !card.revealed &&
    state.room?.gamePhase === "in_progress" &&
    state.room?.turnPhase === "guessing" &&
    state.room?.turnTeam === currentPlayer.team &&
    currentPlayer.role === "guesser";
}

function renderTurnActions(room, currentPlayer) {
  const canPass = !state.submitting &&
    room.gamePhase === "in_progress" &&
    room.turnPhase === "guessing" &&
    room.turnTeam === currentPlayer.team &&
    currentPlayer.role === "guesser";

  if (!canPass && currentPlayer.role !== "guesser") return "";

  return `
    <div class="cn-actions">
      <button class="btn btn-secondary btn-full" id="end-turn" type="button" ${canPass ? "" : "disabled"}>
        ${state.submitting ? "送信中..." : "ターンを終了（パス）"}
      </button>
    </div>
  `;
}

function renderNotification() {
  if (!state.notification?.visible) return "";
  return `
    <button class="cn-notification cn-notification--${esc(state.notification.type)}" id="notification-close" type="button">
      <span>${esc(state.notification.message)}</span>
    </button>
  `;
}

async function handleCreate(form) {
  const formData = new FormData(form);
  const nickname = validateNickname(formData.get("nickname"));
  const wordSetId = String(formData.get("wordSetId") || "");
  const firstTeam = String(formData.get("firstTeam") || "red") === "blue" ? "blue" : "red";
  const wordSet = wordSets.find((set) => set.id === wordSetId) || wordSets[0];
  const playerId = generatePlayerId();

  state.loading = true;
  state.error = "";
  renderCreate();

  try {
    const roomId = await createRoom({
      id: playerId,
      name: nickname,
      team: "red",
      role: "guesser",
    }, wordSet.words, firstTeam);
    state.roomId = roomId;
    state.playerId = playerId;
    state.room = null;
    saveSession();
    navigate("lobby");
  } catch (error) {
    state.error = error.message || "ルーム作成に失敗しました";
    state.loading = false;
    renderCreate();
  }
}

async function handleJoin(form) {
  const formData = new FormData(form);
  const nickname = validateNickname(formData.get("nickname"));
  const roomId = normalizeRoomId(formData.get("roomId"));
  if (!roomId) throw new Error("ルームコードを入力してください");

  const playerId = generatePlayerId();
  state.loading = true;
  state.error = "";
  renderJoin();

  try {
    await joinRoom(roomId, {
      id: playerId,
      name: nickname,
      team: "red",
      role: "guesser",
    });
    state.roomId = roomId;
    state.playerId = playerId;
    state.room = null;
    saveSession();
    navigate("lobby");
  } catch (error) {
    state.error = error.message || "ルーム参加に失敗しました";
    state.loading = false;
    renderJoin();
  }
}

async function handlePlayerUpdate(updates) {
  if (!state.roomId || !state.playerId || state.loading) return;
  state.loading = true;
  state.error = "";
  renderLobby();

  try {
    await updatePlayerRole(state.roomId, state.playerId, updates);
  } catch (error) {
    state.error = error.message || "変更に失敗しました";
    state.loading = false;
    renderLobby();
  }
}

async function handleStartGame() {
  if (!state.roomId || !state.playerId || state.loading) return;
  state.loading = true;
  state.error = "";
  renderLobby();

  try {
    await startGame(state.roomId, state.playerId);
  } catch (error) {
    state.error = error.message || "ゲーム開始に失敗しました";
    state.loading = false;
    renderLobby();
  }
}

async function handleHintSubmit(form) {
  if (!state.room || !state.playerId || state.submitting) return;
  const currentPlayer = state.room.players?.find((p) => p.id === state.playerId);
  if (!currentPlayer) return;

  const formData = new FormData(form);
  const word = String(formData.get("hintWord") || "").trim();
  const count = Number(formData.get("hintCount"));
  if (!word) {
    state.error = "ヒントを入力してください";
    renderGame();
    return;
  }

  state.submitting = true;
  state.error = "";
  renderGame();

  try {
    await submitHint(state.roomId, {
      word,
      count,
      byPlayerId: state.playerId,
      team: currentPlayer.team,
    });
  } catch (error) {
    state.error = error.message || "ヒント送信に失敗しました";
    state.submitting = false;
    renderGame();
  }
}

async function handleRevealCard(cardIndex) {
  if (!state.room || state.submitting) return;
  const currentPlayer = state.room.players?.find((p) => p.id === state.playerId);
  const card = state.room.cards?.[cardIndex];
  if (!currentPlayer || !canRevealCard(card, currentPlayer)) return;

  state.submitting = true;
  state.error = "";
  renderGame();

  try {
    const result = await revealCard(state.roomId, cardIndex, state.room.turnTeam);
    if (result.endedByTrap) {
      showNotification("トラップカード\nチャレンジ終了", "danger");
    }
  } catch (error) {
    state.error = error.message || "カード公開に失敗しました";
    state.submitting = false;
    renderGame();
  }
}

async function handleEndTurn() {
  if (!state.room || state.submitting) return;
  const currentPlayer = state.room.players?.find((p) => p.id === state.playerId);
  if (!currentPlayer || currentPlayer.role !== "guesser" || currentPlayer.team !== state.room.turnTeam) return;

  state.submitting = true;
  state.error = "";
  renderGame();

  try {
    await endTurn(state.roomId, state.room.turnTeam);
  } catch (error) {
    state.error = error.message || "ターン終了に失敗しました";
    state.submitting = false;
    renderGame();
  }
}

async function handleRestartGame() {
  if (!state.roomId || !state.playerId || state.loading) return;
  state.loading = true;
  state.error = "";
  renderFinish();

  try {
    await restartGame(state.roomId, state.playerId);
  } catch (error) {
    state.error = error.message || "もう一度始める準備に失敗しました";
    state.loading = false;
    renderFinish();
  }
}

function showNotification(message, type = "info") {
  state.notification = { message, type, visible: true };
  renderGame();
  setTimeout(() => {
    closeNotification();
  }, 2500);
}

function closeNotification() {
  if (!state.notification?.visible) return;
  state.notification = null;
  if (state.room?.gamePhase === "finished") {
    navigate("finish");
  } else {
    render();
  }
}

document.addEventListener("click", async (event) => {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    state.error = "";
    navigate(routeButton.dataset.route);
    return;
  }

  const copyButton = event.target.closest("#copy-room-code");
  if (copyButton) {
    await copyToClipboard(state.roomId, copyButton, { successText: "コピー済み" });
    return;
  }

  if (event.target.closest("#leave-room")) {
    await handleLeaveRoom();
    return;
  }

  const teamButton = event.target.closest("[data-team]");
  if (teamButton) {
    await handlePlayerUpdate({ team: teamButton.dataset.team });
    return;
  }

  const roleButton = event.target.closest("[data-role]");
  if (roleButton) {
    await handlePlayerUpdate({ role: roleButton.dataset.role });
    return;
  }

  if (event.target.closest("#start-game")) {
    await handleStartGame();
    return;
  }

  const cardButton = event.target.closest("[data-card-index]");
  if (cardButton) {
    await handleRevealCard(Number(cardButton.dataset.cardIndex));
    return;
  }

  if (event.target.closest("#end-turn")) {
    await handleEndTurn();
    return;
  }

  if (event.target.closest("#restart-game")) {
    await handleRestartGame();
    return;
  }

  if (event.target.closest("#notification-close")) {
    closeNotification();
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (event.target.id === "create-form") await handleCreate(event.target);
    if (event.target.id === "join-form") await handleJoin(event.target);
    if (event.target.id === "hint-form") await handleHintSubmit(event.target);
  } catch (error) {
    state.error = error.message;
    render();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.classList.contains("cn-room-code-input")) {
    event.target.value = normalizeRoomId(event.target.value);
  }
});

window.addEventListener("hashchange", render);

if (getRoute() === "home" && restoreSession()) {
  navigate("lobby");
} else {
  render();
}

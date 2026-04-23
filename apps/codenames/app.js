// ことば探偵
// TODO: 移植中。仕様: apps/codenames/AGENTS.md を参照
// 移植元: https://github.com/tagiiii/codename_game （codename_game/src/）

import { copyToClipboard, escapeHtml, showToast } from "../shared/js/utils.js";
import {
  createRoom,
  generatePlayerId,
  getStartConditions,
  joinRoom,
  normalizeRoomId,
  startGame,
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

function render() {
  const route = getRoute();
  if (route === "create") return renderCreate();
  if (route === "join") return renderJoin();
  if (route === "lobby") return renderLobby();
  if (route === "game") return renderGame();
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

  appEl.innerHTML = `
    <section class="card cn-panel text-center">
      <span class="material-symbols-rounded cn-game-icon">flag</span>
      <h1 class="cn-title">ゲーム開始しました</h1>
      <p class="text-muted">カード画面は次の段階で移植します。</p>
      <button class="btn btn-ghost btn-full mt-lg" id="leave-room" type="button">ホームへ戻る</button>
    </section>
  `;
}

function ensureRoomSubscription() {
  if (state.unsubscribe && state.subscribedRoomId === state.roomId) return;
  stopRoomSubscription();
  state.subscribedRoomId = state.roomId;
  state.unsubscribe = subscribeToRoom(state.roomId, (room) => {
    state.loading = false;
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
    if (getRoute() === "lobby") renderLobby();
    if (getRoute() === "game") renderGame();
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
    clearSession();
    showToast("ホームに戻りました", "info");
    navigate("home");
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
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (event.target.id === "create-form") await handleCreate(event.target);
    if (event.target.id === "join-form") await handleJoin(event.target);
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

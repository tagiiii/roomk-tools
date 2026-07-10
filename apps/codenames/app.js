// ことば探偵
// 仕様: apps/codenames/AGENTS.md を参照
// 移植元: https://github.com/tagiiii/codename_game （codename_game/src/）

import { copyToClipboard, escapeHtml, showToast } from "../shared/js/utils.js";
import {
  createRoom,
  deleteExpiredRoom,
  endTurn,
  finishGame,
  forceEndTurn,
  generatePlayerId,
  getStartConditions,
  isRoomExpired,
  joinRoom,
  leaveRoom,
  normalizeRoomId,
  removePlayerFromRoom,
  restartGame,
  resetHint,
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
  lastTurnBannerKey: "",
  pendingCardIndex: null,
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
  state.pendingCardIndex = null;
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
  const currentPlayer = state.room?.players?.find((p) => p.id === playerId);

  if (state.room?.gamePhase === "in_progress" && currentPlayer) {
    state.error = "ゲーム中は退出できません。結果画面まで進めてから退出してください。";
    showToast("ゲーム中は退出できません", "error");
    renderGame();
    return;
  }

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
      <h1 class="cn-title">ことば探偵</h1>
      <p class="text-muted">ヒント役の言葉をもとに、チームで相談しながら単語カードを見つけるゲームです。</p>
      ${state.error ? `<div class="alert alert-error mt-md">${esc(state.error)}</div>` : ""}
      <div class="cn-actions mt-lg">
        <button class="btn btn-primary btn-full" data-route="create">
          <span class="material-symbols-rounded" aria-hidden="true">add_circle</span>ルームを作る
        </button>
        <button class="btn btn-secondary btn-full" data-route="join">
          <span class="material-symbols-rounded" aria-hidden="true">login</span>ルームに参加する
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
  const canEditAssignments = Boolean(currentPlayer?.isHost);
  const playerList = players.map((player) => renderLobbyPlayer(player, canEditAssignments)).join("");

  appEl.innerHTML = `
    <section class="card cn-panel">
      <div class="cn-lobby-header">
        <div>
          <p class="text-muted">ルームコード</p>
          <h1 class="cn-room-code">${esc(state.roomId)}</h1>
        </div>
        <button class="btn btn-secondary btn-sm" id="copy-room-code" type="button">
          <span class="material-symbols-rounded" aria-hidden="true">content_copy</span>コピー
      </button>
      </div>
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
          <h1 class="cn-title">ことば探偵</h1>
        </div>
        <div class="cn-role-chip">${esc(teamLabel(currentPlayer.team))} / ${esc(roleLabel(currentPlayer.role))}</div>
      </div>
      ${renderTurnBanner(state.room, currentPlayer)}
      ${renderScoreBoard(state.room)}
      ${renderHintArea(state.room, currentPlayer)}
      ${state.error ? `<div class="alert alert-error">${esc(state.error)}</div>` : ""}
      <div class="cn-board" aria-label="単語カード">
        ${renderCards(state.room.cards || [], currentPlayer)}
      </div>
      ${renderTurnActions(state.room, currentPlayer)}
      ${renderHostGameControls(state.room, currentPlayer)}
      ${renderHostPlayerManagement(state.room, currentPlayer)}
    </section>
    ${renderNotification()}
    ${renderCardConfirmModal(currentPlayer)}
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
  const result = resultSummary(state.room);

  appEl.innerHTML = `
    <section class="card cn-panel cn-game-panel">
      <div class="cn-result cn-result--${esc(winner || "neutral")}">
        <p class="text-muted">結果</p>
        <h1 class="cn-title">${esc(result.title)}</h1>
        <p>${esc(result.detail)}</p>
        <p class="text-bold">${isWinner ? "あなたのチームの勝ち" : "あなたのチームの負け"}</p>
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
    clearInvalidPendingCard();
    if (!room) {
      state.error = "ルームが見つかりません";
      clearSession();
      navigate("home");
      return;
    }
    if (isRoomExpired(room)) {
      const expiredRoomId = state.roomId;
      state.error = "このルームは期限切れです";
      void deleteExpiredRoom(expiredRoomId).catch((error) => {
        console.warn("[codenames] deleteExpiredRoom failed", error);
      });
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

function clearInvalidPendingCard() {
  if (!Number.isInteger(state.pendingCardIndex) || !state.room) return;
  const currentPlayer = state.room.players?.find((p) => p.id === state.playerId);
  const card = state.room.cards?.[state.pendingCardIndex];
  if (!currentPlayer || !canRevealCard(card, currentPlayer)) {
    state.pendingCardIndex = null;
  }
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

function resultSummary(room) {
  const winner = room.winner;
  if (!winner) {
    return {
      title: "ゲーム終了",
      detail: "結果を確認しています。",
    };
  }

  const reason = room.finishReason || inferFinishReason(room);
  if (reason === "manual") {
    return {
      title: `${teamLabel(winner)}の勝ちで終了しました`,
      detail: "ホストがゲームを終了しました。",
    };
  }

  if (reason === "trap") {
    const loser = winner === "red" ? "blue" : "red";
    return {
      title: `${teamLabel(loser)}がトラップカードを選びました`,
      detail: `${teamLabel(winner)}の勝ちです。`,
    };
  }

  return {
    title: `${teamLabel(winner)}のカードが全部見つかりました`,
    detail: `${teamLabel(winner)}の勝ちです。`,
  };
}

function inferFinishReason(room) {
  const revealedTrap = (room.cards || []).some((card) => card.role === "assassin" && card.revealed);
  return revealedTrap ? "trap" : "all_found";
}

function renderLobbyPlayer(player, canEditAssignments) {
  return `
    <li class="cn-player">
      <div class="cn-player-info">
        <span>
          ${esc(player.name)}
          ${player.isHost ? '<span class="badge badge-primary">ホスト</span>' : ""}
        </span>
        <span class="text-muted">${esc(teamLabel(player.team))} / ${esc(roleLabel(player.role))}</span>
      </div>
      ${canEditAssignments ? `
        <div class="cn-player-actions">
          ${renderPlayerControls(player)}
          ${player.isHost ? "" : `
            <button
              class="btn btn-danger btn-sm"
              type="button"
              data-remove-player-id="${esc(player.id)}"
              ${state.loading ? "disabled" : ""}
            >削除</button>
          `}
        </div>
      ` : ""}
    </li>
  `;
}

function renderPlayerControls(player) {
  const teamButtons = ["red", "blue"].map((team) => `
    <button
      class="btn ${player.team === team ? "btn-primary" : "btn-secondary"} btn-sm"
      type="button"
      data-player-id="${esc(player.id)}"
      data-team="${team}"
      ${state.loading ? "disabled" : ""}
    >${teamLabel(team)}</button>
  `).join("");

  const roleButtons = ["spymaster", "guesser"].map((role) => `
    <button
      class="btn ${player.role === role ? "btn-primary" : "btn-secondary"} btn-sm"
      type="button"
      data-player-id="${esc(player.id)}"
      data-role="${role}"
      ${state.loading ? "disabled" : ""}
    >${roleLabel(role)}</button>
  `).join("");

  return `
    <div class="cn-player-controls">
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
      <span class="material-symbols-rounded" role="img" aria-label="${condition.ok ? "達成" : "未達成"}">${condition.ok ? "check_circle" : "radio_button_unchecked"}</span>
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

function renderTurnBanner(room, currentPlayer) {
  const turnKey = `${room.turnTeam}:${room.turnPhase}`;
  const shouldPulse = state.lastTurnBannerKey !== turnKey;
  state.lastTurnBannerKey = turnKey;
  const isMyTeam = room.turnTeam === currentPlayer.team;
  const phaseLabel = room.turnPhase === "waiting_hint" ? "ヒント待ち" : "カード選び";
  const actionText = room.turnPhase === "waiting_hint"
    ? "ヒント役がヒントを出します"
    : `探す役がカードを選びます（残り${Number(room.remainingGuesses || 0)}）`;
  const myTurnText = isMyTeam ? "あなたのチームの番です" : "相手チームの番です";

  return `
    <div class="cn-turn-banner cn-turn-banner--${esc(room.turnTeam)} ${shouldPulse ? "cn-turn-banner--pulse" : ""}" aria-live="polite">
      <div>
        <span class="cn-turn-kicker">${esc(phaseLabel)}</span>
        <strong>${esc(turnTitle(room))}</strong>
        <span>${esc(actionText)}</span>
      </div>
      <span class="cn-turn-side">${esc(myTurnText)}</span>
    </div>
  `;
}

function renderScoreBoard(room) {
  const scores = ["red", "blue"].map((team) => {
    const cards = (room.cards || []).filter((card) => card.role === team);
    const found = cards.filter((card) => card.revealed).length;
    return {
      team,
      found,
      total: cards.length,
      isTurn: room.turnTeam === team,
    };
  });

  return `
    <div class="cn-score-board" aria-label="見つけたカード">
      ${scores.map((score) => `
        <div class="cn-score cn-score--${esc(score.team)} ${score.isTurn ? "cn-score--active" : ""}">
          <span>${esc(teamLabel(score.team))}</span>
          <strong>${score.found}<small>/${score.total}</small></strong>
          <span class="cn-score-remaining">あと${Math.max(score.total - score.found, 0)}</span>
          ${score.isTurn ? '<span class="cn-score-turn">いまの番</span>' : ""}
        </div>
      `).join("")}
    </div>
  `;
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
    const canResetHint = !state.submitting &&
      Number(room.remainingGuesses || 0) === Number(room.currentHint.count || 0) && (
      currentPlayer.isHost ||
      (currentPlayer.team === room.turnTeam && currentPlayer.role === "spymaster")
    );

    return `
      <div class="cn-current-hint">
        <div>
          <span class="text-muted">現在のヒント</span>
          <strong>「${esc(room.currentHint.word)}」${Number(room.currentHint.count)}まい</strong>
          <span class="badge badge-accent">残り${Number(room.remainingGuesses || 0)}</span>
        </div>
        ${canResetHint ? `
          <button class="btn btn-secondary btn-sm" id="reset-hint" type="button">
            ヒントを出し直す
          </button>
        ` : ""}
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

  const showPass = currentPlayer.role === "guesser";
  const showForceEnd = currentPlayer.isHost && room.gamePhase === "in_progress";
  if (!showPass && !showForceEnd) return "";

  return `
    <div class="cn-actions">
      ${showPass ? `
        <button class="btn btn-secondary btn-full" id="end-turn" type="button" ${canPass ? "" : "disabled"}>
          ${state.submitting ? "送信中..." : "ターンを終了（パス）"}
        </button>
      ` : ""}
      ${showForceEnd ? `
        <button class="btn btn-secondary btn-full" id="force-end-turn" type="button" ${state.submitting ? "disabled" : ""}>
          ホスト: ターンを進める
        </button>
      ` : ""}
    </div>
  `;
}

function renderHostGameControls(room, currentPlayer) {
  if (!currentPlayer.isHost || room.gamePhase !== "in_progress") return "";

  return `
    <section class="cn-host-controls" aria-label="ホスト操作">
      <h2 class="cn-section-title">ホスト操作</h2>
      <div class="cn-host-control-grid">
        <button class="btn btn-secondary" id="abort-to-lobby" type="button" ${state.loading ? "disabled" : ""}>
          ロビーへ戻す
        </button>
        <button class="btn btn-danger" data-finish-winner="red" type="button" ${state.loading ? "disabled" : ""}>
          赤勝ちで終了
        </button>
        <button class="btn btn-danger" data-finish-winner="blue" type="button" ${state.loading ? "disabled" : ""}>
          青勝ちで終了
        </button>
      </div>
    </section>
  `;
}

function renderHostPlayerManagement(room, currentPlayer) {
  if (!currentPlayer.isHost) return "";

  const players = room.players || [];
  const playerItems = players.map((player) => `
    <li class="cn-player">
      <div class="cn-player-info">
        <span>
          ${esc(player.name)}
          ${player.isHost ? '<span class="badge badge-primary">ホスト</span>' : ""}
        </span>
        <span class="text-muted">${esc(teamLabel(player.team))} / ${esc(roleLabel(player.role))}</span>
      </div>
      <div class="cn-player-actions">
        ${renderPlayerControls(player)}
        ${player.isHost ? "" : `
          <button
            class="btn btn-danger btn-sm"
            type="button"
            data-remove-player-id="${esc(player.id)}"
            ${state.loading ? "disabled" : ""}
          >削除</button>
        `}
      </div>
    </li>
  `).join("");

  return `
    <section class="cn-player-management" aria-label="参加者管理">
      <div>
        <h2 class="cn-section-title">参加者管理</h2>
        <p class="text-muted">途中で抜けた人が残った場合は削除し、必要に応じて役割を調整してください。</p>
      </div>
      <ul class="cn-player-list">${playerItems}</ul>
    </section>
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

function renderCardConfirmModal(currentPlayer) {
  if (!Number.isInteger(state.pendingCardIndex) || !state.room) return "";
  const card = state.room.cards?.[state.pendingCardIndex];
  if (!card || !canRevealCard(card, currentPlayer)) return "";

  const canSeeRole = currentPlayer.role === "spymaster";
  return `
    <div class="cn-modal" role="dialog" aria-modal="true" aria-labelledby="card-confirm-title">
      <button class="cn-modal-backdrop" type="button" data-card-confirm-close aria-label="確認を閉じる"></button>
      <div class="cn-card-confirm">
        <p class="text-muted" id="card-confirm-title">このカードを開きますか？</p>
        <strong>${esc(card.word)}</strong>
        ${canSeeRole ? `<span class="badge badge-primary">${esc(cardRoleLabel(card.role))}</span>` : ""}
        <p class="text-muted">開くと取り消せません。</p>
        <div class="cn-card-confirm-actions">
          <button class="btn btn-ghost" type="button" id="card-confirm-cancel">やめる</button>
          <button class="btn btn-primary" type="button" id="card-confirm-open" ${state.submitting ? "disabled" : ""}>
            ${state.submitting ? "公開中..." : "開く"}
          </button>
        </div>
      </div>
    </div>
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

async function handlePlayerUpdate(targetPlayerId, updates) {
  if (!state.roomId || !state.playerId || !targetPlayerId || state.loading) return;
  state.loading = true;
  state.error = "";
  render();

  try {
    await updatePlayerRole(state.roomId, targetPlayerId, updates, state.playerId);
  } catch (error) {
    state.error = error.message || "変更に失敗しました";
    state.loading = false;
    render();
  }
}

async function handleRemovePlayer(targetPlayerId) {
  if (!state.roomId || !state.playerId || !targetPlayerId || state.loading) return;
  const targetPlayer = state.room?.players?.find((p) => p.id === targetPlayerId);
  const targetName = targetPlayer?.name || "この参加者";
  if (!window.confirm(`${targetName}さんを参加者一覧から削除しますか？`)) return;

  state.loading = true;
  state.error = "";
  render();

  try {
    await removePlayerFromRoom(state.roomId, targetPlayerId, state.playerId);
    showToast("参加者を削除しました", "success");
  } catch (error) {
    state.error = error.message || "参加者の削除に失敗しました";
    state.loading = false;
    render();
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
  state.pendingCardIndex = null;
  renderGame();

  try {
    const result = await revealCard(state.roomId, cardIndex, state.room.turnTeam, state.playerId);
    if (result.endedByTrap) {
      showNotification("トラップカード\nチャレンジ終了", "danger");
    }
  } catch (error) {
    state.error = error.message || "カード公開に失敗しました";
    state.submitting = false;
    renderGame();
  }
}

function handleCardSelect(cardIndex) {
  if (!state.room || state.submitting) return;
  const currentPlayer = state.room.players?.find((p) => p.id === state.playerId);
  const card = state.room.cards?.[cardIndex];
  if (!currentPlayer || !canRevealCard(card, currentPlayer)) return;

  state.pendingCardIndex = cardIndex;
  state.error = "";
  renderGame();
}

function closeCardConfirm() {
  if (!Number.isInteger(state.pendingCardIndex)) return;
  state.pendingCardIndex = null;
  renderGame();
}

async function handleConfirmCardReveal() {
  if (!Number.isInteger(state.pendingCardIndex)) return;
  await handleRevealCard(state.pendingCardIndex);
}

async function handleResetHint() {
  if (!state.room || state.submitting) return;
  if (!window.confirm("いまのヒントを取り消して、ヒント待ちに戻しますか？")) return;

  state.submitting = true;
  state.error = "";
  renderGame();

  try {
    await resetHint(state.roomId, state.playerId);
    showToast("ヒントを取り消しました", "success");
  } catch (error) {
    state.error = error.message || "ヒントの取り消しに失敗しました";
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
    await endTurn(state.roomId, state.room.turnTeam, state.playerId);
  } catch (error) {
    state.error = error.message || "ターン終了に失敗しました";
    state.submitting = false;
    renderGame();
  }
}

async function handleForceEndTurn() {
  if (!state.room || state.submitting) return;
  if (!window.confirm("ホスト操作で現在のターンを終了して、次のチームに進めますか？")) return;

  state.submitting = true;
  state.error = "";
  renderGame();

  try {
    await forceEndTurn(state.roomId, state.playerId);
  } catch (error) {
    state.error = error.message || "ターンを進められませんでした";
    state.submitting = false;
    renderGame();
  }
}

async function handleFinishGame(winner) {
  if (!state.roomId || !state.playerId || state.loading) return;
  if (!window.confirm(`${teamLabel(winner)}の勝ちとしてゲームを終了しますか？`)) return;

  state.loading = true;
  state.error = "";
  renderGame();

  try {
    await finishGame(state.roomId, state.playerId, winner);
  } catch (error) {
    state.error = error.message || "ゲーム終了に失敗しました";
    state.loading = false;
    renderGame();
  }
}

async function handleAbortToLobby() {
  if (!state.roomId || !state.playerId || state.loading) return;
  if (!window.confirm("ゲームを中止してロビーに戻しますか？盤面は作り直されます。")) return;

  state.loading = true;
  state.error = "";
  renderGame();

  try {
    await restartGame(state.roomId, state.playerId);
  } catch (error) {
    state.error = error.message || "ロビーへ戻せませんでした";
    state.loading = false;
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
    await handlePlayerUpdate(teamButton.dataset.playerId, { team: teamButton.dataset.team });
    return;
  }

  const roleButton = event.target.closest("[data-role]");
  if (roleButton) {
    await handlePlayerUpdate(roleButton.dataset.playerId, { role: roleButton.dataset.role });
    return;
  }

  const removePlayerButton = event.target.closest("[data-remove-player-id]");
  if (removePlayerButton) {
    await handleRemovePlayer(removePlayerButton.dataset.removePlayerId);
    return;
  }

  if (event.target.closest("#start-game")) {
    await handleStartGame();
    return;
  }

  if (event.target.closest("#reset-hint")) {
    await handleResetHint();
    return;
  }

  const cardButton = event.target.closest("[data-card-index]");
  if (cardButton) {
    handleCardSelect(Number(cardButton.dataset.cardIndex));
    return;
  }

  if (event.target.closest("#card-confirm-open")) {
    await handleConfirmCardReveal();
    return;
  }

  if (
    event.target.closest("#card-confirm-cancel") ||
    event.target.closest("[data-card-confirm-close]")
  ) {
    closeCardConfirm();
    return;
  }

  if (event.target.closest("#end-turn")) {
    await handleEndTurn();
    return;
  }

  if (event.target.closest("#force-end-turn")) {
    await handleForceEndTurn();
    return;
  }

  const finishWinnerButton = event.target.closest("[data-finish-winner]");
  if (finishWinnerButton) {
    await handleFinishGame(finishWinnerButton.dataset.finishWinner);
    return;
  }

  if (event.target.closest("#abort-to-lobby")) {
    await handleAbortToLobby();
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && Number.isInteger(state.pendingCardIndex)) {
    closeCardConfirm();
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

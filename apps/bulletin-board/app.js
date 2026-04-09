// =============================================
// 掲示板アプリ — メインロジック
// =============================================

import { db } from "../shared/js/firebase-config.js";
import { escapeHtml, showToast, formatDateTime, copyToClipboard } from "../shared/js/utils.js";
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs,
  deleteDoc, updateDoc, writeBatch, runTransaction,
  onSnapshot, query, where, orderBy,
  serverTimestamp, Timestamp, increment,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ── 定数 ──────────────────────────────────
const SESSION_KEY = "bb_session";
const ADMIN_PIN = "9999";
const NICK_MAX = 20;
const TITLE_MAX = 60;
const BODY_MAX = 500;
const COMMENT_MAX = 1000;
const INACTIVE_DAYS = 30;
const TIME_CHECK_INTERVAL = 60_000; // 60秒

// 2026年度プログラムカレンダー初期値（bb-config/calendar 未作成時にプリフィル用）
const DEFAULT_CALENDAR = {
  operatingHours: { start: "09:00", end: "14:30" },
  weekendsOff: true,
  closedPeriods: [
    { name: "春休み", start: "2026-03-28", end: "2026-04-05" },
    { name: "GW", start: "2026-04-29", end: "2026-05-05" },
    { name: "夏休み", start: "2026-08-05", end: "2026-08-16" },
    { name: "年末年始", start: "2026-12-19", end: "2027-01-03" },
    { name: "春休み(翌年度)", start: "2027-03-27", end: "2027-04-04" },
  ],
  closedDates: ["2026-05-18", "2026-10-02"],
};

// ── 状態 ──────────────────────────────────
const state = {
  currentUser: null,   // { nickname, isAdmin }
  currentScreen: null,
  threads: [],
  currentThreadId: null,
  currentThread: null,
  comments: [],
  calendar: null,      // bb-config/calendar のキャッシュ
  // リスナー解除
  unsubThreads: null,
  unsubThreadDoc: null,
  unsubComments: null,
  unsubCalendar: null, // カレンダー購読（画面遷移では切らない）
  // タイマー
  timeCheckTimer: null,
};

// ── DOM 参照 ──────────────────────────────
const $  = (id) => document.getElementById(id);
const headerActions  = $("header-actions");
const timeOverlay    = $("time-overlay");
const threadList     = $("thread-list");
const threadsEmpty   = $("threads-empty");
const threadDetail   = $("thread-detail");
const commentsList   = $("comments-list");

// ── ユーティリティ ────────────────────────

/** PIN → SHA-256 ハッシュ（固定salt付き） */
async function hashPin(pin) {
  const data = new TextEncoder().encode("bb-salt-roomk:" + pin);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** 管理者PINかどうか判定（ハッシュ比較用） */
let adminPinHash = null;
async function getAdminPinHash() {
  if (!adminPinHash) adminPinHash = await hashPin(ADMIN_PIN);
  return adminPinHash;
}

/** 招待コード生成（8文字） */
function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** 現在のJST Date を返す */
function getJstNow() {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
}

/** Date → "YYYY-MM-DD" 文字列（JST前提） */
function formatDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "HH:MM" → 分数に変換 */
function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/** エラーメッセージ表示 */
function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.add("visible");
}
function hideError(id) {
  $(id).classList.remove("visible");
}

// ── カレンダー判定 ────────────────────────

/**
 * 利用可否を判定する
 * @returns {{ allowed: boolean, reason?: string, label?: string }}
 */
function checkServiceHours() {
  const cal = state.calendar;
  if (!cal) return { allowed: false, reason: "loading", label: "読み込み中…" };

  const jst = getJstNow();
  const todayStr = formatDateStr(jst);
  const day = jst.getDay(); // 0=Sun, 6=Sat

  // 1. 土日チェック
  if (cal.weekendsOff && (day === 0 || day === 6)) {
    return { allowed: false, reason: "weekend", label: "この掲示板は平日のみ利用できます" };
  }

  // 2. 個別休講日チェック
  if (cal.closedDates && cal.closedDates.includes(todayStr)) {
    return { allowed: false, reason: "closed_date", label: "本日は休講日のため利用できません" };
  }

  // 3. 休止期間チェック（YYYY-MM-DD 文字列比較）
  if (cal.closedPeriods) {
    for (const period of cal.closedPeriods) {
      if (todayStr >= period.start && todayStr <= period.end) {
        return { allowed: false, reason: "closed_period", label: `${period.name}のため利用できません` };
      }
    }
  }

  // 4. 営業時間チェック
  if (cal.operatingHours) {
    const currentMinutes = jst.getHours() * 60 + jst.getMinutes();
    const startMin = parseTimeToMinutes(cal.operatingHours.start);
    const endMin = parseTimeToMinutes(cal.operatingHours.end);
    if (currentMinutes < startMin || currentMinutes >= endMin) {
      return {
        allowed: false,
        reason: "out_of_hours",
        label: `この掲示板は ${cal.operatingHours.start}〜${cal.operatingHours.end} に利用できます`,
      };
    }
  }

  return { allowed: true };
}

// ── カレンダー購読 ────────────────────────

/** bb-config/calendar を onSnapshot で購読。初回データ受信を Promise で返す */
function subscribeCalendar() {
  // 既に購読中なら何もしない
  if (state.unsubCalendar) return Promise.resolve();

  return new Promise((resolve) => {
    let resolved = false;
    state.unsubCalendar = onSnapshot(doc(db, "bb-config", "calendar"), (snap) => {
      if (snap.exists()) {
        state.calendar = snap.data();
      } else {
        // ドキュメント未作成 → 全開放デフォルト（移行期間用）
        state.calendar = {
          operatingHours: { start: "00:00", end: "23:59" },
          weekendsOff: false,
          closedPeriods: [],
          closedDates: [],
        };
      }
      // 購読中のカレンダー更新 → 時間制限を即再評価
      if (resolved) applyTimeRestriction();
      if (!resolved) { resolved = true; resolve(); }
    }, (err) => {
      console.error("カレンダー取得エラー:", err);
      // エラー時は制限的なデフォルト
      state.calendar = { ...DEFAULT_CALENDAR };
      if (!resolved) { resolved = true; resolve(); }
    });
  });
}

function unsubscribeCalendar() {
  if (state.unsubCalendar) { state.unsubCalendar(); state.unsubCalendar = null; }
}

// ── 時間制限の適用 ────────────────────────

/** 時間制限を評価してオーバーレイを制御する。3箇所から呼ばれる共通関数 */
function applyTimeRestriction() {
  if (!state.currentUser) return;
  if (state.currentUser.isAdmin) {
    timeOverlay.classList.remove("active");
    return;
  }

  const result = checkServiceHours();
  if (result.allowed) {
    if (timeOverlay.classList.contains("active")) {
      timeOverlay.classList.remove("active");
      // リスナー復帰
      const target = (state.currentScreen && state.currentScreen !== "auth")
        ? state.currentScreen : "threads";
      showScreen(target);
    }
  } else {
    cleanupListeners();
    $("time-overlay-text").textContent = result.label;
    timeOverlay.classList.add("active");
  }
}

// ── 画面遷移 ──────────────────────────────

function showScreen(id) {
  cleanupListeners();
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(`screen-${id}`).classList.add("active");
  state.currentScreen = id;

  // 画面別セットアップ
  if (id === "threads") subscribeThreads();
  if (id === "detail") subscribeThreadDetail(state.currentThreadId);
}

/** スレッド・コメントのリスナーを解除（カレンダー購読は切らない） */
function cleanupListeners() {
  if (state.unsubThreads) { state.unsubThreads(); state.unsubThreads = null; }
  if (state.unsubThreadDoc) { state.unsubThreadDoc(); state.unsubThreadDoc = null; }
  if (state.unsubComments) { state.unsubComments(); state.unsubComments = null; }
}

// ── ヘッダー描画 ──────────────────────────

function renderHeader() {
  if (!state.currentUser) {
    headerActions.innerHTML = "";
    return;
  }
  const { nickname, isAdmin } = state.currentUser;
  headerActions.innerHTML = `
    <span class="bb-header__user">
      ${isAdmin ? '<span class="material-symbols-rounded" style="font-size:18px">admin_panel_settings</span>' : ""}
      ${escapeHtml(nickname)}
    </span>
    ${isAdmin ? '<button class="bb-header__btn" id="btn-admin" title="管理"><span class="material-symbols-rounded">settings</span></button>' : ""}
    <button class="bb-header__btn" id="btn-logout" title="退出"><span class="material-symbols-rounded">logout</span></button>
  `;
}

// ── セッション管理 ────────────────────────

function saveSession(nickname, pinHash) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ nickname, pinHash }));
  localStorage.setItem(SESSION_KEY + "_nick", nickname);
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}
function getSavedNickname() {
  return localStorage.getItem(SESSION_KEY + "_nick") || "";
}

async function validateSession() {
  const session = loadSession();
  if (!session || !session.pinHash) return false;

  try {
    const snap = await getDoc(doc(db, "bb-users", session.nickname));
    if (!snap.exists()) { clearSession(); return false; }
    if (snap.data().pinHash !== session.pinHash) { clearSession(); return false; }

    const adminHash = await getAdminPinHash();
    const isAdmin = session.pinHash === adminHash;
    state.currentUser = { nickname: session.nickname, isAdmin };
    return true;
  } catch (e) {
    console.error("セッション検証エラー:", e);
    return false;
  }
}

// ── 認証: ログイン ────────────────────────

async function handleLogin(e) {
  e.preventDefault();
  hideError("login-error");

  const nickname = $("login-nickname").value.trim();
  const pin = $("login-pin").value;

  if (!nickname) { showError("login-error", "ニックネームを入力してください"); return; }
  if (!/^\d{4}$/.test(pin)) { showError("login-error", "PINは4桁の数字で入力してください"); return; }

  try {
    const snap = await getDoc(doc(db, "bb-users", nickname));
    if (!snap.exists()) { showError("login-error", "ニックネームが見つかりません"); return; }

    const pinH = await hashPin(pin);
    if (snap.data().pinHash !== pinH) { showError("login-error", "PINが正しくありません"); return; }

    const adminHash = await getAdminPinHash();
    const isAdmin = pinH === adminHash;
    state.currentUser = { nickname, isAdmin };
    saveSession(nickname, pinH);
    renderHeader();
    await enterApp();
  } catch (err) {
    console.error(err);
    showError("login-error", "通信エラーが発生しました");
  }
}

// ── 認証: 登録 ─────────────────────────────

async function handleRegister(e) {
  e.preventDefault();
  hideError("register-error");

  const code = $("reg-invite").value.trim().toUpperCase();
  const nickname = $("reg-nickname").value.trim();
  const pin = $("reg-pin").value;
  const pinConfirm = $("reg-pin-confirm").value;

  if (!code) { showError("register-error", "招待コードを入力してください"); return; }
  if (!nickname) { showError("register-error", "ニックネームを入力してください"); return; }
  if (nickname.length > NICK_MAX) { showError("register-error", `ニックネームは${NICK_MAX}文字以内にしてください`); return; }
  if (/[/.]/.test(nickname)) { showError("register-error", "ニックネームに / や . は使えません"); return; }
  if (!/^\d{4}$/.test(pin)) { showError("register-error", "PINは4桁の数字で入力してください"); return; }
  if (pin !== pinConfirm) { showError("register-error", "PINが一致しません"); return; }

  try {
    const pinH = await hashPin(pin);
    const codeRef = doc(db, "bb-invite-codes", code);
    const userRef = doc(db, "bb-users", nickname);

    await runTransaction(db, async (tx) => {
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists()) throw new Error("無効な招待コードです");
      if (codeSnap.data().used) throw new Error("この招待コードは使用済みです");

      const userSnap = await tx.get(userRef);
      if (userSnap.exists()) throw new Error("このニックネームは既に使われています");

      tx.set(userRef, { pinHash: pinH, inviteCode: code, createdAt: serverTimestamp() });
      tx.update(codeRef, { used: true, usedBy: nickname, usedAt: serverTimestamp() });
    });

    const adminHash = await getAdminPinHash();
    const isAdmin = pinH === adminHash;
    state.currentUser = { nickname, isAdmin };
    saveSession(nickname, pinH);
    renderHeader();
    showToast("登録が完了しました", "success");
    await enterApp();
  } catch (err) {
    console.error(err);
    const msg = err.message?.startsWith("無効な") || err.message?.startsWith("この")
      ? err.message : "通信エラーが発生しました";
    showError("register-error", msg);
  }
}

// ── ログアウト ─────────────────────────────

function handleLogout() {
  cleanupListeners();
  unsubscribeCalendar();
  clearTimeCheck();
  state.currentUser = null;
  state.calendar = null;
  clearSession();
  renderHeader();
  timeOverlay.classList.remove("active");
  showScreen("auth");
}

// ── アプリ進入（ログイン後） ────────────────

async function enterApp() {
  await subscribeCalendar();
  showScreen("threads");
  applyTimeRestriction();
  startTimeCheck();
}

// ── 時間制限チェック（60秒タイマー） ────────

function startTimeCheck() {
  clearTimeCheck();
  state.timeCheckTimer = setInterval(() => {
    applyTimeRestriction();
  }, TIME_CHECK_INTERVAL);
}

function clearTimeCheck() {
  if (state.timeCheckTimer) { clearInterval(state.timeCheckTimer); state.timeCheckTimer = null; }
}

// ── スレッド一覧 ──────────────────────────

function subscribeThreads() {
  const cutoff = Timestamp.fromDate(new Date(Date.now() - INACTIVE_DAYS * 86_400_000));
  const q = query(
    collection(db, "bb-threads"),
    where("lastActivity", ">=", cutoff),
    orderBy("lastActivity", "desc"),
  );
  state.unsubThreads = onSnapshot(q, (snap) => {
    state.threads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderThreadList();
  }, (err) => {
    console.error("スレッド取得エラー:", err);
  });
}

function renderThreadList() {
  if (state.threads.length === 0) {
    threadList.innerHTML = "";
    threadsEmpty.style.display = "block";
    return;
  }
  threadsEmpty.style.display = "none";
  threadList.innerHTML = state.threads.map(t => `
    <div class="bb-thread-card" data-id="${t.id}">
      <div class="bb-thread-card__title">${escapeHtml(t.title)}</div>
      ${t.body ? `<div class="bb-thread-card__body">${escapeHtml(t.body)}</div>` : ""}
      <div class="bb-thread-card__meta">
        <span class="bb-thread-card__meta-item">
          <span class="material-symbols-rounded">person</span>${escapeHtml(t.author)}
        </span>
        <span class="bb-thread-card__meta-item">
          <span class="material-symbols-rounded">chat_bubble</span>${t.commentCount || 0}
        </span>
        <span class="bb-thread-card__meta-item">
          <span class="material-symbols-rounded">schedule</span>${t.lastActivity ? formatDateTime(t.lastActivity) : ""}
        </span>
      </div>
    </div>
  `).join("");
}

// ── スレッド作成 ──────────────────────────

async function handleCreateThread(e) {
  e.preventDefault();
  hideError("new-thread-error");

  const title = $("thread-title").value.trim();
  const body = $("thread-body").value.trim();

  if (!title) { showError("new-thread-error", "タイトルを入力してください"); return; }
  if (title.length > TITLE_MAX) { showError("new-thread-error", `タイトルは${TITLE_MAX}文字以内にしてください`); return; }
  if (body.length > BODY_MAX) { showError("new-thread-error", `本文は${BODY_MAX}文字以内にしてください`); return; }

  if (!state.currentUser.isAdmin && !checkServiceHours().allowed) {
    showToast("利用時間外です", "error"); return;
  }

  try {
    await addDoc(collection(db, "bb-threads"), {
      title, body,
      author: state.currentUser.nickname,
      createdAt: serverTimestamp(),
      lastActivity: serverTimestamp(),
      commentCount: 0,
    });
    $("thread-title").value = "";
    $("thread-body").value = "";
    $("title-count").textContent = "0";
    $("body-count").textContent = "0";
    showToast("スレッドを作成しました", "success");
    showScreen("threads");
  } catch (err) {
    console.error(err);
    showError("new-thread-error", "投稿に失敗しました");
  }
}

// ── スレッド詳細 ──────────────────────────

function subscribeThreadDetail(threadId) {
  state.unsubThreadDoc = onSnapshot(doc(db, "bb-threads", threadId), (snap) => {
    if (!snap.exists()) {
      showToast("このスレッドは削除されました", "info");
      showScreen("threads");
      return;
    }
    state.currentThread = { id: snap.id, ...snap.data() };
    renderThreadDetail();
  });

  const q = query(
    collection(db, "bb-threads", threadId, "comments"),
    orderBy("createdAt", "asc"),
  );
  state.unsubComments = onSnapshot(q, (snap) => {
    state.comments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderComments();
  });
}

function renderThreadDetail() {
  const t = state.currentThread;
  if (!t) return;
  const isAdmin = state.currentUser?.isAdmin;

  threadDetail.innerHTML = `
    <div class="bb-detail-card">
      <div class="bb-detail-card__title">${escapeHtml(t.title)}</div>
      ${t.body ? `<div class="bb-detail-card__body">${escapeHtml(t.body)}</div>` : ""}
      <div class="bb-detail-card__meta">
        <span>${escapeHtml(t.author)}</span>
        <span>${t.createdAt ? formatDateTime(t.createdAt) : ""}</span>
      </div>
      ${isAdmin ? `
        <div class="bb-detail-card__admin">
          <button class="btn btn-danger btn-sm" id="btn-delete-thread">
            <span class="material-symbols-rounded" style="font-size:16px">delete</span> スレッド削除
          </button>
        </div>
      ` : ""}
    </div>
  `;
}

function renderComments() {
  const me = state.currentUser?.nickname;
  const isAdmin = state.currentUser?.isAdmin;

  if (state.comments.length === 0) {
    commentsList.innerHTML = '<p style="text-align:center;color:var(--color-muted);font-size:14px;padding:24px 0;">まだコメントはありません</p>';
    return;
  }

  commentsList.innerHTML = state.comments.map(c => {
    const isMine = c.author === me;
    return `
      <div class="bb-comment ${isMine ? "bb-comment--mine" : "bb-comment--other"}">
        ${!isMine ? `<div class="bb-comment__author">${escapeHtml(c.author)}</div>` : ""}
        <div class="bb-comment__bubble">
          <div class="bb-comment__text">${escapeHtml(c.text)}</div>
        </div>
        <div class="bb-comment__info">
          <span>${c.createdAt ? formatDateTime(c.createdAt) : ""}</span>
          ${isAdmin ? `<button class="bb-comment__delete" data-comment-id="${c.id}"><span class="material-symbols-rounded">delete</span>削除</button>` : ""}
        </div>
      </div>
    `;
  }).join("");

  commentsList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
}

// ── コメント投稿 ──────────────────────────

async function handlePostComment() {
  const text = $("comment-text").value.trim();
  if (!text) return;
  if (text.length > COMMENT_MAX) { showToast("コメントは1000文字以内にしてください", "error"); return; }

  if (!state.currentUser.isAdmin && !checkServiceHours().allowed) {
    showToast("利用時間外です", "error"); return;
  }

  const threadId = state.currentThreadId;
  try {
    const batch = writeBatch(db);
    const commentRef = doc(collection(db, "bb-threads", threadId, "comments"));
    batch.set(commentRef, { text, author: state.currentUser.nickname, createdAt: serverTimestamp() });
    batch.update(doc(db, "bb-threads", threadId), { lastActivity: serverTimestamp(), commentCount: increment(1) });
    await batch.commit();
    $("comment-text").value = "";
    $("comment-count").textContent = "0";
  } catch (err) {
    console.error(err);
    showToast("コメントの投稿に失敗しました", "error");
  }
}

// ── 管理者: スレッド削除 ─────────────────

async function handleDeleteThread(threadId) {
  if (!confirm("このスレッドを削除しますか？\nコメントもすべて削除されます。")) return;

  try {
    const commentsRef = collection(db, "bb-threads", threadId, "comments");
    const snap = await getDocs(commentsRef);
    const chunks = [];
    for (let i = 0; i < snap.docs.length; i += 450) {
      chunks.push(snap.docs.slice(i, i + 450));
    }
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, "bb-threads", threadId));
    showToast("スレッドを削除しました", "success");
    showScreen("threads");
  } catch (err) {
    console.error(err);
    showToast("削除に失敗しました", "error");
  }
}

// ── 管理者: コメント削除 ─────────────────

async function handleDeleteComment(commentId) {
  if (!confirm("このコメントを削除しますか？")) return;

  const threadId = state.currentThreadId;
  const commentRef = doc(db, "bb-threads", threadId, "comments", commentId);
  const threadRef = doc(db, "bb-threads", threadId);

  try {
    await runTransaction(db, async (tx) => {
      const commentSnap = await tx.get(commentRef);
      if (!commentSnap.exists()) throw new Error("already_deleted");
      tx.delete(commentRef);
      tx.update(threadRef, { commentCount: increment(-1) });
    });
    showToast("コメントを削除しました", "success");
  } catch (err) {
    if (err.message === "already_deleted") {
      showToast("このコメントは既に削除されています", "info");
    } else {
      console.error(err);
      showToast("削除に失敗しました", "error");
    }
  }
}

// ── 管理者: 招待コード ──────────────────

async function handleGenerateCodes() {
  const count = Math.min(Math.max(parseInt($("invite-count").value) || 1, 1), 50);
  const btn = $("btn-generate-codes");
  btn.disabled = true;

  try {
    const codes = new Set();
    const maxAttempts = count * 5;
    let attempts = 0;
    while (codes.size < count && attempts < maxAttempts) {
      const code = generateInviteCode();
      if (!codes.has(code)) {
        const existing = await getDoc(doc(db, "bb-invite-codes", code));
        if (!existing.exists()) codes.add(code);
      }
      attempts++;
    }
    if (codes.size < count) { showToast("一意なコードを十分に生成できませんでした", "error"); return; }

    const batch = writeBatch(db);
    for (const code of codes) {
      batch.set(doc(db, "bb-invite-codes", code), { used: false, usedBy: null, createdAt: serverTimestamp(), usedAt: null });
    }
    await batch.commit();
    showToast(`${count}件の招待コードを生成しました`, "success");
    loadInviteCodes();
  } catch (err) {
    console.error(err);
    showToast("生成に失敗しました", "error");
  } finally {
    btn.disabled = false;
  }
}

async function loadInviteCodes() {
  try {
    const snap = await getDocs(collection(db, "bb-invite-codes"));
    const codes = snap.docs.map(d => ({ code: d.id, ...d.data() }));
    const unused = codes.filter(c => !c.used);
    const used = codes.filter(c => c.used);
    const container = $("invite-codes-list");
    container.innerHTML = "";

    if (unused.length > 0) {
      container.innerHTML += `
        <div class="bb-codes-group">
          <div class="bb-codes-group__label">未使用（${unused.length}件）</div>
          ${unused.map(c => `
            <div class="bb-code-item">
              <span>${c.code}</span>
              <button class="btn btn-ghost btn-sm bb-copy-code" data-code="${c.code}">コピー</button>
            </div>
          `).join("")}
        </div>
      `;
    }
    if (used.length > 0) {
      container.innerHTML += `
        <div class="bb-codes-group">
          <div class="bb-codes-group__label">使用済み（${used.length}件）</div>
          ${used.map(c => `
            <div class="bb-code-item bb-code-item--used">
              <span>${c.code}</span>
              <span class="bb-code-item__status">${escapeHtml(c.usedBy || "")}</span>
            </div>
          `).join("")}
        </div>
      `;
    }
    if (codes.length === 0) {
      container.innerHTML = '<p style="color:var(--color-muted);font-size:14px;text-align:center;padding:16px 0;">招待コードはまだありません</p>';
    }
  } catch (err) {
    console.error(err);
    showToast("招待コードの取得に失敗しました", "error");
  }
}

// ── 管理者: カレンダー管理 ────────────────

function loadCalendarAdmin() {
  const cal = state.calendar;
  if (!cal) return;

  // ドキュメント未作成時（updatedAt がない）→ 2026年度プリフィル
  const data = cal.updatedAt ? cal : { ...DEFAULT_CALENDAR };
  if (!cal.updatedAt) state.calendar = { ...data };

  $("cal-hours-start").value = data.operatingHours?.start || "09:00";
  $("cal-hours-end").value = data.operatingHours?.end || "14:30";
  $("cal-weekends-off").checked = data.weekendsOff ?? true;

  // 未保存表示
  const note = $("cal-save-note");
  if (note) {
    note.textContent = cal.updatedAt ? "保存するとすぐに反映されます" : "まだ保存されていない初期値です。確認して保存してください。";
    note.style.color = cal.updatedAt ? "var(--color-muted)" : "var(--color-accent)";
  }

  renderCalendarPeriods();
  renderCalendarDates();
}

function renderCalendarPeriods() {
  const periods = state.calendar?.closedPeriods || [];
  const container = $("cal-periods-list");
  if (periods.length === 0) {
    container.innerHTML = '<p class="bb-cal-empty">休止期間はありません</p>';
    return;
  }
  container.innerHTML = periods.map((p, i) => `
    <div class="bb-cal-item">
      <span class="bb-cal-item__text">${escapeHtml(p.name)}（${p.start} 〜 ${p.end}）</span>
      <button class="bb-cal-item__delete" data-type="period" data-index="${i}">
        <span class="material-symbols-rounded" style="font-size:16px">close</span>
      </button>
    </div>
  `).join("");
}

function renderCalendarDates() {
  const dates = state.calendar?.closedDates || [];
  const container = $("cal-dates-list");
  if (dates.length === 0) {
    container.innerHTML = '<p class="bb-cal-empty">個別休講日はありません</p>';
    return;
  }
  const sorted = [...dates].sort();
  container.innerHTML = sorted.map((d) => `
    <div class="bb-cal-item">
      <span class="bb-cal-item__text">${d}</span>
      <button class="bb-cal-item__delete" data-type="date" data-value="${d}">
        <span class="material-symbols-rounded" style="font-size:16px">close</span>
      </button>
    </div>
  `).join("");
}

function handleAddPeriod() {
  const name = $("cal-period-name").value.trim();
  const start = $("cal-period-start").value;
  const end = $("cal-period-end").value;
  if (!name || !start || !end) { showToast("名前・開始日・終了日をすべて入力してください", "error"); return; }
  if (start > end) { showToast("開始日は終了日より前にしてください", "error"); return; }

  if (!state.calendar.closedPeriods) state.calendar.closedPeriods = [];
  state.calendar.closedPeriods.push({ name, start, end });
  renderCalendarPeriods();
  $("cal-period-name").value = "";
  $("cal-period-start").value = "";
  $("cal-period-end").value = "";
}

function handleAddDate() {
  const date = $("cal-new-date").value;
  if (!date) { showToast("日付を選択してください", "error"); return; }
  if (!state.calendar.closedDates) state.calendar.closedDates = [];
  if (state.calendar.closedDates.includes(date)) { showToast("この日付は既に追加されています", "info"); return; }
  state.calendar.closedDates.push(date);
  renderCalendarDates();
  $("cal-new-date").value = "";
}

function handleCalendarDelete(e) {
  const btn = e.target.closest(".bb-cal-item__delete");
  if (!btn) return;
  const type = btn.dataset.type;
  if (type === "period") {
    const index = parseInt(btn.dataset.index);
    state.calendar.closedPeriods.splice(index, 1);
    renderCalendarPeriods();
  } else if (type === "date") {
    const value = btn.dataset.value;
    state.calendar.closedDates = state.calendar.closedDates.filter(d => d !== value);
    renderCalendarDates();
  }
}

async function handleSaveCalendar() {
  const btn = $("btn-save-calendar");
  btn.disabled = true;

  try {
    const calData = {
      operatingHours: {
        start: $("cal-hours-start").value || "09:00",
        end: $("cal-hours-end").value || "14:30",
      },
      weekendsOff: $("cal-weekends-off").checked,
      closedPeriods: state.calendar.closedPeriods || [],
      closedDates: state.calendar.closedDates || [],
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, "bb-config", "calendar"), calData);
    // onSnapshot が自動で state.calendar を更新し applyTimeRestriction() を呼ぶ
    showToast("カレンダーを保存しました", "success");
  } catch (err) {
    console.error(err);
    showToast("保存に失敗しました", "error");
  } finally {
    btn.disabled = false;
  }
}

// ── 認証タブ切替 ──────────────────────────

function switchAuthTab(tab) {
  document.querySelectorAll(".bb-auth-tab").forEach(t => t.classList.remove("bb-auth-tab--active"));
  document.querySelector(`[data-tab="${tab}"]`).classList.add("bb-auth-tab--active");
  $("form-login").style.display = tab === "login" ? "flex" : "none";
  $("form-register").style.display = tab === "register" ? "flex" : "none";
  hideError("login-error");
  hideError("register-error");
}

// ── 文字数カウンター ─────────────────────

function setupCharCounter(inputId, countId) {
  $(inputId).addEventListener("input", () => {
    $(countId).textContent = $(inputId).value.length;
  });
}

// ── イベントリスナー ─────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // 認証タブ
  document.querySelectorAll(".bb-auth-tab").forEach(tab => {
    tab.addEventListener("click", () => switchAuthTab(tab.dataset.tab));
  });

  // フォーム送信
  $("form-login").addEventListener("submit", handleLogin);
  $("form-register").addEventListener("submit", handleRegister);
  $("form-new-thread").addEventListener("submit", handleCreateThread);

  // コメント投稿
  $("btn-post-comment").addEventListener("click", handlePostComment);
  $("comment-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePostComment(); }
  });

  // ナビゲーション
  $("btn-new-thread").addEventListener("click", () => showScreen("new-thread"));
  $("btn-back-from-new").addEventListener("click", () => showScreen("threads"));
  $("btn-back-from-detail").addEventListener("click", () => showScreen("threads"));
  $("btn-back-from-admin").addEventListener("click", () => showScreen("threads"));

  // ヘッダーボタン（動的生成のため委任）
  headerActions.addEventListener("click", (e) => {
    const btn = e.target.closest("#btn-logout");
    if (btn) { handleLogout(); return; }
    const adminBtn = e.target.closest("#btn-admin");
    if (adminBtn) { showScreen("admin"); loadInviteCodes(); loadCalendarAdmin(); return; }
  });

  // スレッド一覧クリック（委任）
  threadList.addEventListener("click", (e) => {
    const card = e.target.closest(".bb-thread-card");
    if (!card) return;
    state.currentThreadId = card.dataset.id;
    showScreen("detail");
  });

  // スレッド削除ボタン（委任）
  threadDetail.addEventListener("click", (e) => {
    const btn = e.target.closest("#btn-delete-thread");
    if (btn) handleDeleteThread(state.currentThreadId);
  });

  // コメント削除ボタン（委任）
  commentsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".bb-comment__delete");
    if (btn) handleDeleteComment(btn.dataset.commentId);
  });

  // 招待コード生成
  $("btn-generate-codes").addEventListener("click", handleGenerateCodes);
  $("invite-codes-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".bb-copy-code");
    if (btn) copyToClipboard(btn.dataset.code, btn);
  });

  // カレンダー管理
  $("btn-add-period").addEventListener("click", handleAddPeriod);
  $("btn-add-date").addEventListener("click", handleAddDate);
  $("btn-save-calendar").addEventListener("click", handleSaveCalendar);
  $("admin-calendar-section").addEventListener("click", handleCalendarDelete);

  // 文字数カウンター
  setupCharCounter("thread-title", "title-count");
  setupCharCounter("thread-body", "body-count");
  setupCharCounter("comment-text", "comment-count");
});

// ── 初期化 ────────────────────────────────

async function init() {
  const valid = await validateSession();
  if (valid) {
    renderHeader();
    await enterApp();
  } else {
    const savedNick = getSavedNickname();
    if (savedNick) $("login-nickname").value = savedNick;
    showScreen("auth");
  }
}

init();

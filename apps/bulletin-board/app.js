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

// ── 状態 ──────────────────────────────────
const state = {
  currentUser: null,   // { nickname, isAdmin }
  currentScreen: null,
  threads: [],
  currentThreadId: null,
  currentThread: null,
  comments: [],
  // リスナー解除
  unsubThreads: null,
  unsubThreadDoc: null,
  unsubComments: null,
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

/** 利用時間内か判定（9:30〜14:00 JST） */
function isWithinServiceHours() {
  const now = new Date();
  const jstMs = now.getTime() + (now.getTimezoneOffset() + 540) * 60_000;
  const jst = new Date(jstMs);
  const minutes = jst.getHours() * 60 + jst.getMinutes();
  return minutes >= 570 && minutes < 840; // 9:30=570, 14:00=840
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

// セッション: sessionStorage（タブ単位）でログイン状態を保持
// localStorage はニックネームの入力補助のみ（リロード時は再ログイン不要だがタブを閉じると要再ログイン）
function saveSession(nickname, pinHash) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ nickname, pinHash }));
  localStorage.setItem(SESSION_KEY + "_nick", nickname); // 入力補助用
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

    // sessionStorage の pinHash と Firestore の pinHash を照合
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
    enterApp();
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

    // トランザクションで招待コード消費＋ユーザー作成を原子化
    await runTransaction(db, async (tx) => {
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists()) throw new Error("無効な招待コードです");
      if (codeSnap.data().used) throw new Error("この招待コードは使用済みです");

      const userSnap = await tx.get(userRef);
      if (userSnap.exists()) throw new Error("このニックネームは既に使われています");

      tx.set(userRef, {
        pinHash: pinH,
        inviteCode: code,
        createdAt: serverTimestamp(),
      });
      tx.update(codeRef, {
        used: true,
        usedBy: nickname,
        usedAt: serverTimestamp(),
      });
    });

    const adminHash = await getAdminPinHash();
    const isAdmin = pinH === adminHash;
    state.currentUser = { nickname, isAdmin };
    saveSession(nickname, pinH);
    renderHeader();
    showToast("登録が完了しました", "success");
    enterApp();
  } catch (err) {
    console.error(err);
    // トランザクション内のバリデーションエラーはメッセージをそのまま表示
    const msg = err.message?.startsWith("無効な") || err.message?.startsWith("この")
      ? err.message : "通信エラーが発生しました";
    showError("register-error", msg);
  }
}

// ── ログアウト ─────────────────────────────

function handleLogout() {
  cleanupListeners();
  clearTimeCheck();
  state.currentUser = null;
  clearSession();
  renderHeader();
  showScreen("auth");
}

// ── アプリ進入（ログイン後） ────────────────

function enterApp() {
  // まずスレッド一覧を表示（リスナーも接続）
  showScreen("threads");

  // 時間外なら上からオーバーレイで覆う（リスナーは解除）
  if (!state.currentUser.isAdmin && !isWithinServiceHours()) {
    cleanupListeners();
    timeOverlay.classList.add("active");
  } else {
    timeOverlay.classList.remove("active");
  }
  startTimeCheck();
}

// ── 時間制限チェック ──────────────────────

function startTimeCheck() {
  clearTimeCheck();
  state.timeCheckTimer = setInterval(() => {
    if (!state.currentUser) return;
    if (state.currentUser.isAdmin) { timeOverlay.classList.remove("active"); return; }

    if (isWithinServiceHours()) {
      if (timeOverlay.classList.contains("active")) {
        timeOverlay.classList.remove("active");
        // リスナーが解除済みなので再表示して復帰（auth は除外）
        const target = (state.currentScreen && state.currentScreen !== "auth")
          ? state.currentScreen : "threads";
        showScreen(target);
      }
    } else {
      cleanupListeners();
      timeOverlay.classList.add("active");
    }
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

  // 時間外チェック（管理者以外）
  if (!state.currentUser.isAdmin && !isWithinServiceHours()) {
    showToast("利用時間外です", "error");
    return;
  }

  try {
    await addDoc(collection(db, "bb-threads"), {
      title,
      body,
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
  // スレッド本体
  state.unsubThreadDoc = onSnapshot(doc(db, "bb-threads", threadId), (snap) => {
    if (!snap.exists()) {
      showToast("このスレッドは削除されました", "info");
      showScreen("threads");
      return;
    }
    state.currentThread = { id: snap.id, ...snap.data() };
    renderThreadDetail();
  });

  // コメント
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

  // 最新コメントにスクロール
  commentsList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
}

// ── コメント投稿 ──────────────────────────

async function handlePostComment() {
  const text = $("comment-text").value.trim();
  if (!text) return;
  if (text.length > COMMENT_MAX) { showToast("コメントは1000文字以内にしてください", "error"); return; }

  if (!state.currentUser.isAdmin && !isWithinServiceHours()) {
    showToast("利用時間外です", "error");
    return;
  }

  const threadId = state.currentThreadId;
  try {
    const batch = writeBatch(db);
    const commentRef = doc(collection(db, "bb-threads", threadId, "comments"));
    batch.set(commentRef, {
      text,
      author: state.currentUser.nickname,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, "bb-threads", threadId), {
      lastActivity: serverTimestamp(),
      commentCount: increment(1),
    });
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
    // サブコレクション削除（writeBatch、500件ずつ）
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

    // 親スレッド削除
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
    // 一意なコードを生成（既存との衝突・ループ内重複を回避）
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
    if (codes.size < count) {
      showToast("一意なコードを十分に生成できませんでした", "error");
      return;
    }

    const batch = writeBatch(db);
    for (const code of codes) {
      batch.set(doc(db, "bb-invite-codes", code), {
        used: false,
        usedBy: null,
        createdAt: serverTimestamp(),
        usedAt: null,
      });
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
  // Enter（Shift無し）でコメント送信
  $("comment-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handlePostComment();
    }
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
    if (adminBtn) { showScreen("admin"); loadInviteCodes(); return; }
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

  // 招待コードコピー（委任）
  $("invite-codes-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".bb-copy-code");
    if (btn) copyToClipboard(btn.dataset.code, btn);
  });

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
    enterApp();
  } else {
    // 前回のニックネームをログインフォームに入力補助
    const savedNick = getSavedNickname();
    if (savedNick) $("login-nickname").value = savedNick;
    showScreen("auth");
  }
}

init();

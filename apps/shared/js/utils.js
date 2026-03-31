// =============================================
// 共通ユーティリティ関数
// 全アプリで使用できる汎用ヘルパー
// =============================================

/**
 * M-2. テキストをクリップボードにコピーする
 * ボタン要素を渡すと成功時にフィードバックUIを表示する（M-6の .btn.done クラスと連携）
 *
 * @param {string}      text                          - コピーするテキスト
 * @param {HTMLElement} [btn]                         - フィードバックを表示するボタン要素（省略可）
 * @param {object}      [options]
 * @param {string}      [options.successText='コピーしました！'] - 成功時ボタンテキスト
 * @param {string}      [options.successClass='done']           - 成功時に追加するクラス名
 * @param {number}      [options.resetDelay=2500]               - 元に戻すまでのms
 * @returns {Promise<boolean>} 成功したら true
 *
 * @example
 * // ボタンフィードバックなし
 * await copyToClipboard('テキスト');
 *
 * @example
 * // ボタンフィードバックあり
 * copyToClipboard(text, document.getElementById('myBtn'));
 */
export function copyToClipboard(text, btn = null, options = {}) {
  const {
    successText  = 'コピーしました！',
    successClass = 'done',
    resetDelay   = 2500,
  } = options;

  const onSuccess = () => {
    if (!btn) return;
    const originalHTML  = btn.innerHTML;   // innerHTML で保存（アイコン span を含む）
    const originalClass = btn.className;
    btn.textContent = successText;
    btn.classList.add(successClass);
    setTimeout(() => {
      btn.innerHTML   = originalHTML;      // innerHTML で復元
      btn.className   = originalClass;
    }, resetDelay);
  };

  return navigator.clipboard.writeText(text).then(() => {
    onSuccess();
    return true;
  }).catch(() => {
    // フォールバック（非対応ブラウザ用）
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) onSuccess();
    return ok;
  });
}

/**
 * M-3. 配列をランダムシャッフルして新しい配列として返す（Fisher-Yates）
 * 元の配列は変更しない。
 *
 * @param {Array} arr - シャッフルする配列
 * @returns {Array} シャッフルされた新しい配列
 *
 * @example
 * const result = shuffle(['A', 'B', 'C', 'D']);
 * // → ['C', 'A', 'D', 'B']（毎回異なる順序）
 */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * M-5. ポップインアニメーションを要素に適用する
 * design-system.css の .pop-in クラスと連携する。
 *
 * @param {HTMLElement} el
 */
export function popIn(el) {
  el.classList.remove('pop-in');
  void el.offsetWidth; // reflow してアニメーションをリセット
  el.classList.add('pop-in');
  el.addEventListener('animationend', () => el.classList.remove('pop-in'), { once: true });
}

/**
 * ランダムなセッションIDを生成する（デフォルト6桁英数字）
 * FirestoreのドキュメントIDとして使用
 * @param {number} length - 桁数（デフォルト: 6）
 * @returns {string}
 */
export function generateSessionId(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字を除外
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * URLのクエリパラメータを取得する
 * @param {string} key
 * @returns {string | null}
 */
export function getQueryParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

/**
 * URLのクエリパラメータを更新する（ページリロードなし）
 * @param {string} key
 * @param {string} value
 */
export function setQueryParam(key, value) {
  const url = new URL(window.location.href);
  url.searchParams.set(key, value);
  window.history.replaceState({}, '', url.toString());
}

/**
 * 日時を「YYYY/MM/DD HH:mm」形式にフォーマットする
 * @param {Date | import("firebase/firestore").Timestamp} dateOrTimestamp
 * @returns {string}
 */
export function formatDateTime(dateOrTimestamp) {
  const date =
    dateOrTimestamp && typeof dateOrTimestamp.toDate === 'function'
      ? dateOrTimestamp.toDate()
      : new Date(dateOrTimestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * HTML特殊文字をエスケープする（XSS対策）
 * innerHTML に動的テキストを挿入する前に必ず使用する
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * トースト通知を表示する
 * @param {string} message
 * @param {"success" | "error" | "info"} type
 * @param {number} duration - 表示時間（ms）
 */
export function showToast(message, type = 'info', duration = 3000) {
  let toast = document.querySelector('#toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%) translateY(80px)',
      padding: '12px 20px',
      borderRadius: '12px',
      fontFamily: "var(--font-base, 'Noto Sans JP', sans-serif)",
      fontWeight: 'bold',
      fontSize: '15px',
      color: '#fff',
      zIndex: '9999',
      transition: 'transform 0.25s ease, opacity 0.25s ease',
      opacity: '0',
      pointerEvents: 'none',
      maxWidth: '90vw',
      textAlign: 'center',
    });
    document.body.appendChild(toast);
  }

  const colors = { success: '#1F6E3C', error: '#B91C1C', info: '#1D4ED8' };
  toast.style.backgroundColor = colors[type] ?? colors.info;
  toast.textContent = message;
  toast.style.transform = 'translateX(-50%) translateY(0)';
  toast.style.opacity = '1';

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(80px)';
    toast.style.opacity = '0';
  }, duration);
}

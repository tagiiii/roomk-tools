// =============================================
// 画面を描きなおしても、キーボードで選んでいた位置を残す
//
// 読み込むだけで動く。フォーカスしていたボタン・入力欄が、描きなおしで画面から取りのぞかれたら（隠れた・押せなくなったときも）、
// 同じ所にできた「同じもの」へフォーカスをもどす。同じものがなければ、同じ種類のとなり（同じ番目か、最後）へ移す。
// 同じ種類が残っていなければ（押したボタンが役目を終えて消えた・相手の番で押せなくなったなど）、少し待ってから、
// 見えている、いちばん近い id のある親そのものへ移す
// （押せるものではない所に置くので、つづけて Enter を押しても何も起きない。Tab でその中の次のものへ進める）
// - 同じもの: 同じ id → 同じ種類（タグと、is-・has- 以外の class）の中で、data-* が同じ → 見出し（aria-label か文字）が同じ
// - さがす範囲: もとの要素のいちばん近い id のある親（なければ文書全体）
// - もどすのは、取りのぞかれてから 1.5 秒の間で、フォーカスが body に落ちているときだけ（ほかの所を選んだら何もしない）
// - 開いている dialog や、画面をふさぐお知らせ（data-roomk-blocking）があるときは何もしない
// 位置を自分でもどすアプリ（将棋・リバーシ・マンカラなど）は読み込まない
//
// 後方互換で追加のみ。破壊的変更をする場合は ?v= を上げること
// =============================================
(function () {
  const WINDOW_MS = 1500;
  let last = null;     // いまフォーカスしている要素の記録
  let lost = null;     // 取りのぞかれた要素の記録と時刻
  let fallbackTimer = null;
  const FALLBACK_MS = 250;

  const baseClass = (el) => Array.from(el.classList).filter((c) => !/^(is-|has-)/.test(c)).sort();
  const labelOf = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const dataOf = (el) => JSON.stringify(Object.assign({}, el.dataset));
  const usable = (el) => el.isConnected && !el.disabled && el.getClientRects().length > 0 && !el.closest('[inert]');

  function remember(el) {
    if (!(el instanceof HTMLElement) || el === document.body) return;
    const scopeEl = el.parentElement && el.parentElement.closest('[id]');
    const base = baseClass(el);
    const sameKind = (n) => n.tagName === el.tagName && baseClass(n).join(' ') === base.join(' ');
    const scope = scopeEl || document;
    const kin = Array.from(scope.querySelectorAll(el.tagName)).filter(sameKind);
    // 親のうち id のあるものを近い順に（まとまりの所へ移すときに、残っているいちばん近いものを使う）
    const scopeIds = [];
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (n.id) scopeIds.push(n.id);
    last = { el, id: el.id, tag: el.tagName, base, data: dataOf(el), label: labelOf(el), scopeId: scopeEl ? scopeEl.id : '', scopeIds, index: kin.indexOf(el), sameKind };
  }

  function blocked() {
    if (document.querySelector('dialog[open]')) return true;
    return Array.from(document.querySelectorAll('[data-roomk-blocking]')).some((o) => !o.hidden && o.getClientRects().length > 0);
  }

  function restore(final) {
    if (!lost || Date.now() - lost.at > WINDOW_MS) { lost = null; return; }
    const ae = document.activeElement;
    if (ae && ae !== document.body) { lost = null; return; }
    if (blocked()) return;
    const info = lost.info;
    const scope = (info.scopeId && document.getElementById(info.scopeId)) || document;
    let target = null;
    if (info.id) {
      const byId = document.getElementById(info.id);
      if (byId && usable(byId)) target = byId;
    }
    if (!target) {
      const kin = Array.from(scope.querySelectorAll(info.tag)).filter((n) => info.sameKind(n) && usable(n));
      if (!kin.length) {
        // まだ描かれていないかもしれないので少し待ち、それでもなければ、さがす範囲の親へ移す
        if (!final) {
          clearTimeout(fallbackTimer);
          fallbackTimer = setTimeout(() => restore(true), FALLBACK_MS);
          return;
        }
        const box = info.scopeIds.map((id) => document.getElementById(id))
          .find((n) => n && n.getClientRects().length > 0 && !n.closest('[inert]')) || null;
        lost = null;
        if (!box) return;
        if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
        box.focus({ preventScroll: true });
        return;
      }
      target = kin.find((n) => info.data !== '{}' && dataOf(n) === info.data)
        || kin.find((n) => info.label && labelOf(n) === info.label)
        || kin[Math.min(Math.max(info.index, 0), kin.length - 1)];
    }
    lost = null;
    target.focus({ preventScroll: true });
    if (target.tagName === 'INPUT' && /^(text|search|)$/.test(target.type) && typeof target.setSelectionRange === 'function') {
      const n = target.value.length;
      try { target.setSelectionRange(n, n); } catch (e) { /* 選べない種類の入力欄 */ }
    }
  }

  document.addEventListener('focusin', (e) => { remember(e.target); lost = null; clearTimeout(fallbackTimer); }, true);

  // 取りのぞかれた・隠れた・押せなくなったかは、DOM の変化で見る（取りのぞかれても focusout が来ないブラウザがある）
  let checkTimer = null;
  const markLost = () => { if (last && (!lost || lost.info !== last)) lost = { info: last, at: Date.now() }; };
  const mo = new MutationObserver(() => {
    if (!last) return;
    if (!last.el.isConnected) {
      markLost();
    } else if (!usable(last.el) && !checkTimer) {
      // 隠れた・押せなくなったときは、ブラウザがフォーカスを外し終わってから見る
      checkTimer = setTimeout(() => {
        checkTimer = null;
        const ae = document.activeElement;
        if (last && (!ae || ae === document.body) && !usable(last.el)) { markLost(); restore(); }
      }, 0);
    }
    if (lost) restore();
  });

  function init() {
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'class', 'style', 'inert'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// =============================================
// 画面全体をふさぐお知らせ（ホストの戻りを待つ画面・つなぎ直している画面など）を、ダイアログとして扱う
//
// 使い方: お知らせの要素に data-roomk-blocking を付け（role="dialog" aria-modal="true" と見出しの
// aria-labelledby も付ける）、このファイルを読み込む。出し方（hidden・class・style）はアプリのままでよい。
// - 出ている間は、うしろの body の子を inert にする（押せない・読み上げない）
//   （script・dialog・読み上げのお知らせ（role="status"・aria-live）・もともと inert のものは触らない）
// - 出たときに、中のボタン（なければお知らせ自身）へフォーカスを移す
// - 消えたら、ここで inert にしたものだけもどす
// 出ているかは、hidden 属性・自分と親の display・visibility で見る（opacity だけで消す作りには使わない）
//
// 後方互換で追加のみ。破壊的変更をする場合は ?v= を上げること
// =============================================
(function () {
  const inerted = new Set();
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function isShown(el) {
    if (el.hidden || !el.isConnected) return false;
    // 自分か親が display: none なら、getClientRects は空になる
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function sync() {
    const open = Array.from(document.querySelectorAll('[data-roomk-blocking]')).filter(isShown);
    if (!open.length) {
      inerted.forEach((el) => { el.inert = false; });
      inerted.clear();
      return;
    }
    for (const el of Array.from(document.body.children)) {
      if (inerted.has(el) || el.inert) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'DIALOG') continue;
      if (el.matches('[role="status"], [role="alert"], [aria-live]')) continue;
      // お知らせを中に持つ要素は inert にしない（お知らせまで押せなくなるため）
      if (open.some((o) => el === o || el.contains(o))) continue;
      el.inert = true;
      inerted.add(el);
    }
    const top = open[open.length - 1];
    if (!top.contains(document.activeElement)) {
      // 見えているものだけ（hidden のボタンにはフォーカスできない）
      const target = Array.from(top.querySelectorAll(FOCUSABLE)).find((n) => n.getClientRects().length > 0) || top;
      if (target === top && !top.hasAttribute('tabindex')) top.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  }

  function init() {
    const nodes = document.querySelectorAll('[data-roomk-blocking]');
    if (!nodes.length) return;
    const mo = new MutationObserver(sync);
    nodes.forEach((n) => mo.observe(n, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] }));
    sync();
  }

  window.RoomkOverlay = { sync };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

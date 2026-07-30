/**
 * roomK 共通「あそびかた」モーダル
 *
 * 全アプリ共通の説明モーダル。右下の「？」ボタン（FAB）から
 * ボトムシート型のモーダルを開く。デザインは jinro の遊び方モーダルを踏襲。
 *
 * 使い方（非モジュール通常スクリプト。design-system.css 読み込みが前提）:
 *
 *   <script src="../shared/js/howto.js"></script>
 *   <script>
 *     RoomkHowto.init({
 *       title: 'あそびかた',              // ツール系は「つかいかた」
 *       lead: 'どんなあそびかを1〜2文で。',
 *       sections: [
 *         { heading: 'はじめかた', items: ['〜をおす', '〜をえらぶ'] },
 *         { heading: 'すすめかた', items: [...] },
 *         { heading: 'おわりかた', text: '箇条書きでなく文章でもよい' },
 *       ],
 *       position: 'right',               // 'left' で左下に配置（既存FABとの衝突回避用）
 *     });
 *   </script>
 *
 * 後方互換で追加のみ。破壊的変更をする場合は ?v= 付き読み込みに切り替えること。
 */
(function () {
  'use strict';

  var STYLE_ID = 'roomk-howto-style';
  var CSS = [
    '.howto-fab {',
    '  position: fixed; bottom: 16px; z-index: 500;',
    '  width: 48px; height: 48px; border-radius: 50%;',
    '  border: none; cursor: pointer;',
    '  background: var(--color-primary); color: #fff;',
    '  box-shadow: 0 4px 14px rgba(0,0,0,0.25);',
    '  display: flex; align-items: center; justify-content: center;',
    '}',
    '.howto-fab--right { right: 16px; }',
    '.howto-fab--left { left: 16px; }',
    '.howto-fab .material-symbols-rounded { font-size: 26px; }',
    '.howto-modal {',
    '  display: none; position: fixed; inset: 0; z-index: 600;',
    '  background: rgba(28,63,94,0.55);',
    '  align-items: flex-end; justify-content: center;',
    '}',
    '.howto-modal.show { display: flex; }',
    '.howto-sheet {',
    '  width: 100%; max-width: 480px; max-height: 88dvh;',
    '  background: var(--color-surface);',
    '  border-radius: 20px 20px 0 0;',
    '  display: flex; flex-direction: column; overflow: hidden;',
    '}',
    '.howto-head {',
    '  display: flex; align-items: center; justify-content: space-between;',
    '  padding: 16px 20px; border-bottom: 1px solid var(--color-border); flex-shrink: 0;',
    '}',
    '.howto-head strong { font-size: 17px; color: var(--color-primary); }',
    '.howto-close {',
    '  border: none; background: none; cursor: pointer;',
    '  color: var(--color-muted);',
    '  display: flex; align-items: center; justify-content: center;',
    // タップターゲット 44px 確保。負マージンでヘッダーの見た目の高さ・アイコン位置は従来のまま
    '  min-width: 44px; min-height: 44px; padding: 0;',
    '  margin: -6px -6px -6px 0; flex-shrink: 0;',
    '}',
    '.howto-body {',
    '  padding: 16px 20px 32px; overflow-y: auto;',
    '  font-size: 14px; line-height: 1.7; color: var(--color-text);',
    '}',
    '.howto-lead { margin: 0 0 6px; }',
    '.howto-h { font-size: 16px; font-weight: 700; color: var(--color-primary); margin: 20px 0 6px; }',
    '.howto-body p { margin: 0 0 6px; }',
    '.howto-steps { padding-left: 20px; margin: 6px 0; }',
    '.howto-steps li { margin-bottom: 5px; }',
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function buildBody(config) {
    var body = el('div', 'howto-body');
    if (config.lead) body.appendChild(el('p', 'howto-lead', config.lead));
    (config.sections || []).forEach(function (section) {
      if (section.heading) body.appendChild(el('div', 'howto-h', section.heading));
      if (section.text) body.appendChild(el('p', null, section.text));
      if (section.items && section.items.length) {
        var list = el('ol', 'howto-steps');
        section.items.forEach(function (item) {
          list.appendChild(el('li', null, item));
        });
        body.appendChild(list);
      }
    });
    return body;
  }

  function init(config) {
    config = config || {};
    var title = config.title || 'あそびかた';
    injectStyle();

    var fab = el('button', 'howto-fab ' + (config.position === 'left' ? 'howto-fab--left' : 'howto-fab--right'));
    fab.type = 'button';
    fab.setAttribute('aria-label', title);
    var fabIcon = el('span', 'material-symbols-rounded', 'help');
    fabIcon.setAttribute('aria-hidden', 'true');
    fab.appendChild(fabIcon);

    var modal = el('div', 'howto-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', title);

    var sheet = el('div', 'howto-sheet');
    var head = el('div', 'howto-head');
    head.appendChild(el('strong', null, title));
    var closeBtn = el('button', 'howto-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'とじる');
    var closeIcon = el('span', 'material-symbols-rounded', 'close');
    closeIcon.setAttribute('aria-hidden', 'true');
    closeBtn.appendChild(closeIcon);
    head.appendChild(closeBtn);
    sheet.appendChild(head);
    sheet.appendChild(buildBody(config));
    modal.appendChild(sheet);

    // 背景の不活性化（docs/reports/c8-modal-overlay-classification.md のパターン4）。
    // 自分が inert にした要素だけを記録し、元から inert の要素は閉じるときに巻き込まない
    var inertSiblings = [];
    function setBackgroundInert(on) {
      if (!('inert' in HTMLElement.prototype)) return;
      if (on) {
        inertSiblings = [];
        Array.prototype.forEach.call(document.body.children, function (node) {
          if (node === modal || node.inert) return;
          node.inert = true;
          inertSiblings.push(node);
        });
      } else {
        inertSiblings.forEach(function (node) { node.inert = false; });
        inertSiblings = [];
      }
    }

    function open() {
      // 二重 open で inertSiblings が空リストに上書きされるのを防ぐ
      if (modal.classList.contains('show')) return;
      modal.classList.add('show');
      setBackgroundInert(true);
      closeBtn.focus();
    }
    function close() {
      modal.classList.remove('show');
      setBackgroundInert(false);
      fab.focus();
    }

    fab.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('show')) close();
    });

    document.body.appendChild(fab);
    document.body.appendChild(modal);
  }

  window.RoomkHowto = { init: init };
})();

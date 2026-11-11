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
 *       slides: 'slides.html',           // 任意。説明スライドがあるアプリだけ指定する
 *       feedback: false,                 // 任意。「フィードバックを送信する」ボタンを出さないときだけ false
 *       home: false,                     // 任意。「あそびのたなのトップへ」を出さないときだけ false
 *       updates: false,                  // 任意。「このツールの更新」を出さないときだけ false
 *     });
 *   </script>
 *
 * slides を指定すると、モーダルの先頭に「説明スライドを見る」ボタンが出る。
 * スライドは別タブでなく今のページの上に重ねて開く（画面共有中のタブが変わらず、
 * ルームの接続もそのまま）。RoomkHowto.openSlides() でアプリ側からも開ける。
 *
 * 「？」のとなりに「フィードバック」の丸ボタン、モーダルの末尾に「フィードバックを送信する」ボタンが出る
 * （どちらも apps/guide/feedback/ を別タブで開く。?app= に URL の最後の区切りを入れる）。
 * 遊んでいる画面はそのまま残る。feedback: false で両方とも消せる。
 *
 * モーダルのいちばん下に「あそびのたなのトップへ」（ツール一覧へ戻るリンク・同じタブ）が出る
 * （2026-11-11 フィードバックボード）。遊んでいる途中にうっかり押さないよう、丸ボタンにはせず
 * モーダルの中の弱いリンクにしている。home: false で消せる。
 *
 * モーダルの説明のあとに「このツールの更新」が出る（2026-11-11 フィードバックボード）。
 * ツール一覧の更新情報（apps/updates.json）から、app がこのツールのものだけを新しい順に並べる。
 * はじめは3件で、「ほかの更新を見る」で残りを開く。モーダルを初めて開いたときに1回だけ読みに行き、
 * 1件も無い・読めなかったときは何も出さない。updates: false で消せる。
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
    '/* 右下の丸ボタンの分だけ、ページの最後に余白をとる（最後のボタンが丸ボタンの下に隠れないように。2026-11-08） */',
    'html.howto-has-fab body::after { content: ""; display: block; height: 80px; }',
    '.howto-fab--right { right: 16px; }',
    '.howto-fab--left { left: 16px; }',
    '.howto-fab .material-symbols-rounded { font-size: 26px; }',
    '.howto-feedback-fab {',
    '  position: fixed; bottom: 16px; z-index: 500;',
    '  width: 48px; height: 48px; border-radius: 50%;',
    '  background: var(--color-surface); color: var(--color-primary);',
    '  border: 2px solid var(--color-primary); text-decoration: none;',
    '  box-shadow: 0 4px 14px rgba(0,0,0,0.25);',
    '  display: flex; align-items: center; justify-content: center;',
    '}',
    '.howto-feedback-fab--right { right: 76px; }',
    '.howto-feedback-fab--left { left: 76px; }',
    '.howto-feedback-fab .material-symbols-rounded { font-size: 24px; }',
    '.howto-modal {',
    '  display: none; position: fixed; inset: 0; z-index: 600;',
    '  background: rgba(63,54,45,0.55);',
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
    '.howto-slides-btn { margin-bottom: 14px; }',
    '.howto-updates-list { list-style: none; padding: 0; margin: 6px 0; }',
    '.howto-updates-list li { padding: 8px 0; border-top: 1px dashed var(--color-border); }',
    '.howto-updates-list li:first-child { border-top: none; padding-top: 0; }',
    '.howto-updates-date { display: block; font-size: 12px; color: var(--color-muted); }',
    '.howto-updates-more { margin-top: 4px; }',
    '.howto-feedback { margin-top: 20px; }',
    '.howto-home {',
    '  display: flex; align-items: center; justify-content: center; gap: 4px;',
    '  margin: 16px auto 0; min-height: 36px; padding: 4px 12px;',
    '  color: var(--color-primary); font-size: 14px; font-weight: 700; text-decoration: none;',
    '}',
    '.howto-home:hover { text-decoration: underline; }',
    '.howto-home .material-symbols-rounded { font-size: 20px; }',
    // アプリ側の重ね表示（最大 1100）より上、共通トースト（9999）より下
    '.howto-slides {',
    '  display: none; position: fixed; inset: 0; z-index: 9000;',
    '  background: var(--color-primary); flex-direction: column;',
    '}',
    '.howto-slides.show { display: flex; }',
    '.howto-slides-bar {',
    '  display: flex; justify-content: flex-end; flex-shrink: 0;',
    '  padding: 6px 8px; background: var(--color-primary);',
    '}',
    '.howto-slides-close {',
    '  display: inline-flex; align-items: center; gap: 4px;',
    '  min-height: 44px; padding: 0 16px; border-radius: 999px;',
    '  border: 1px solid rgba(255,255,255,0.6); background: transparent; color: #fff;',
    '  font-family: inherit; font-size: 15px; font-weight: 500; cursor: pointer;',
    '}',
    '.howto-slides-close:hover { background: rgba(255,255,255,0.12); }',
    '.howto-slides-frame { flex: 1; width: 100%; border: 0; background: #fff; }',
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

  function buildBody(config, slidesBtn) {
    var body = el('div', 'howto-body');
    if (slidesBtn) body.appendChild(slidesBtn);
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
    if (config.updates !== false) {
      // 中身は初めて開いたときに loadUpdates が入れる。それまでは隠しておく
      var updates = el('div', 'howto-updates');
      updates.hidden = true;
      body.appendChild(updates);
    }
    if (config.feedback !== false) body.appendChild(buildFeedbackLink('btn btn-secondary btn-full howto-feedback', true));
    if (config.home !== false) body.appendChild(buildHomeLink());
    return body;
  }

  // ツール一覧（あそびのたなのトップ）の場所。公開先は /roomk-tools/、リポジトリごと配信したときは /…/apps/、
  // 手元の確認（apps/ を配信）は /
  function portalUrl() {
    var seg = window.location.pathname.split('/').filter(Boolean);
    var i = seg.indexOf('roomk-tools');
    if (i < 0) i = seg.indexOf('apps');
    return i >= 0 ? '/' + seg.slice(0, i + 1).join('/') + '/' : '/';
  }

  function buildHomeLink() {
    var link = el('a', 'howto-home');
    link.href = portalUrl();
    var icon = el('span', 'material-symbols-rounded', 'home');
    icon.setAttribute('aria-hidden', 'true');
    link.appendChild(icon);
    link.appendChild(document.createTextNode('あそびのたなのトップへ'));
    return link;
  }

  // URL の最後の区切りをアプリ名にする（stats.js の detectAppName と同じ考え方）
  function appIdFromPath() {
    var seg = window.location.pathname.split('/').filter(Boolean);
    if (seg[seg.length - 1] === 'index.html') seg.pop();
    var last = seg[seg.length - 1];
    if (!last || last === 'apps' || last === 'roomk-tools') return 'portal';
    return last;
  }

  // 「このツールの更新」: ツール一覧の更新情報から、このツールの分だけを出す
  var UPDATES_SHOWN = 3;
  function loadUpdates(box) {
    var appId = appIdFromPath();
    fetch(portalUrl() + 'updates.json')
      .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
      .then(function (entries) {
        var mine = (Array.isArray(entries) ? entries : []).filter(function (e) {
          return e && e.app === appId && typeof e.text === 'string' && typeof e.date === 'string';
        });
        if (!mine.length) return;
        mine.sort(function (a, b) { return b.date.localeCompare(a.date); });
        box.appendChild(el('div', 'howto-h', 'このツールの更新'));
        var list = el('ul', 'howto-updates-list');
        mine.forEach(function (e, i) {
          var li = el('li');
          li.appendChild(el('span', 'howto-updates-date', e.date.replace(/-/g, '/')));
          li.appendChild(document.createTextNode(e.text));
          if (i >= UPDATES_SHOWN) li.hidden = true;
          list.appendChild(li);
        });
        box.appendChild(list);
        if (mine.length > UPDATES_SHOWN) {
          var more = el('button', 'btn btn-ghost btn-sm howto-updates-more', 'ほかの更新を見る');
          more.type = 'button';
          more.setAttribute('aria-expanded', 'false');
          more.addEventListener('click', function () {
            var expand = more.getAttribute('aria-expanded') !== 'true';
            Array.prototype.forEach.call(list.children, function (li, i) {
              li.hidden = !expand && i >= UPDATES_SHOWN;
            });
            more.textContent = expand ? '閉じる' : 'ほかの更新を見る';
            more.setAttribute('aria-expanded', String(expand));
          });
          box.appendChild(more);
        }
        box.hidden = false;
      })
      .catch(function () { /* 読めないときは何も出さない */ });
  }

  // 送信ページへのリンク。withText=false なら丸ボタン（アイコンだけ・aria-label つき）
  function buildFeedbackLink(className, withText) {
    var link = el('a', className);
    link.href = '../guide/feedback/?app=' + encodeURIComponent(appIdFromPath());
    link.target = '_blank';
    link.rel = 'noopener';
    var icon = el('span', 'material-symbols-rounded', withText ? 'send' : 'feedback');
    icon.setAttribute('aria-hidden', 'true');
    link.appendChild(icon);
    if (withText) link.appendChild(document.createTextNode('フィードバックを送信する'));
    else { link.setAttribute('aria-label', 'フィードバックを送信する'); link.title = 'フィードバックを送信する'; }
    return link;
  }

  function init(config) {
    config = config || {};
    var title = config.title || 'あそびかた';
    injectStyle();

    document.documentElement.classList.add('howto-has-fab');
    var fab = el('button', 'howto-fab ' + (config.position === 'left' ? 'howto-fab--left' : 'howto-fab--right'));
    fab.type = 'button';
    fab.setAttribute('aria-label', title);
    var fabIcon = el('span', 'material-symbols-rounded', 'help');
    fabIcon.setAttribute('aria-hidden', 'true');
    fab.appendChild(fabIcon);

    // 「？」のとなりの「フィードバック」丸ボタン（別タブで送信ページを開く）
    var feedbackFab = null;
    if (config.feedback !== false) {
      feedbackFab = buildFeedbackLink('howto-feedback-fab ' + (config.position === 'left' ? 'howto-feedback-fab--left' : 'howto-feedback-fab--right'), false);
    }

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

    var slidesBtn = null;
    if (config.slides) {
      slidesBtn = el('button', 'btn btn-secondary btn-full howto-slides-btn');
      slidesBtn.type = 'button';
      var slidesIcon = el('span', 'material-symbols-rounded', 'co_present');
      slidesIcon.setAttribute('aria-hidden', 'true');
      slidesBtn.appendChild(slidesIcon);
      slidesBtn.appendChild(document.createTextNode('説明スライドを見る'));
    }
    var bodyEl = buildBody(config, slidesBtn);
    sheet.appendChild(bodyEl);
    var updatesBox = bodyEl.querySelector('.howto-updates');
    modal.appendChild(sheet);

    // 背景の不活性化（docs/reports/c8-modal-overlay-classification.md のパターン4）。
    // 自分が inert にした要素だけを記録し、元から inert の要素は閉じるときに巻き込まない
    var inertSiblings = [];
    function setBackgroundInert(on, layer) {
      if (!('inert' in HTMLElement.prototype)) return;
      if (on) {
        inertSiblings = [];
        Array.prototype.forEach.call(document.body.children, function (node) {
          if (node === (layer || modal) || node.inert) return;
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
      if (updatesBox) { loadUpdates(updatesBox); updatesBox = null; }
    }
    function close() {
      modal.classList.remove('show');
      setBackgroundInert(false);
      fab.focus();
    }

    // 説明スライド: 初めて開くときに iframe を作り、閉じても残す（見ていたページから再開できる）
    var slidesLayer = null;
    var slidesFrame = null;
    var slidesReturnFocus = null;
    function closeSlides() {
      if (!slidesLayer || !slidesLayer.classList.contains('show')) return;
      slidesLayer.classList.remove('show');
      setBackgroundInert(false);
      (slidesReturnFocus || fab).focus();
    }
    function focusSlides() {
      try { slidesFrame.contentWindow.focus(); } catch (e) { /* 読み込み前は無視 */ }
    }
    function openSlides() {
      if (!config.slides) return;
      if (slidesLayer && slidesLayer.classList.contains('show')) return;
      var fromModal = modal.classList.contains('show');
      if (fromModal) {
        modal.classList.remove('show');
        setBackgroundInert(false);
      }
      slidesReturnFocus = fromModal ? fab : document.activeElement;
      if (!slidesLayer) {
        slidesLayer = el('div', 'howto-slides');
        slidesLayer.setAttribute('role', 'dialog');
        slidesLayer.setAttribute('aria-modal', 'true');
        slidesLayer.setAttribute('aria-label', '説明スライド');
        var bar = el('div', 'howto-slides-bar');
        var back = el('button', 'howto-slides-close');
        back.type = 'button';
        var backIcon = el('span', 'material-symbols-rounded', 'close');
        backIcon.setAttribute('aria-hidden', 'true');
        back.appendChild(backIcon);
        back.appendChild(document.createTextNode('スライドを閉じる'));
        back.addEventListener('click', closeSlides);
        bar.appendChild(back);
        slidesFrame = el('iframe', 'howto-slides-frame');
        slidesFrame.title = '説明スライド';
        slidesFrame.setAttribute('allow', 'fullscreen; clipboard-write');
        slidesFrame.setAttribute('allowfullscreen', '');
        slidesFrame.addEventListener('load', function () {
          // スライドの中でキーを押しているときも Esc で閉じられるようにする（同一オリジン）
          try {
            slidesFrame.contentWindow.document.addEventListener('keydown', function (e) {
              if (e.key === 'Escape' && !slidesFrame.contentWindow.document.fullscreenElement) closeSlides();
            });
          } catch (e) { /* 別オリジンなら何もしない */ }
          if (slidesLayer.classList.contains('show')) focusSlides();
        });
        slidesFrame.src = config.slides;
        slidesLayer.appendChild(bar);
        slidesLayer.appendChild(slidesFrame);
        document.body.appendChild(slidesLayer);
      }
      slidesLayer.classList.add('show');
      setBackgroundInert(true, slidesLayer);
      focusSlides();
    }

    fab.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    if (slidesBtn) slidesBtn.addEventListener('click', openSlides);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (slidesLayer && slidesLayer.classList.contains('show')) closeSlides();
      else if (modal.classList.contains('show')) close();
    });

    document.body.appendChild(fab);
    if (feedbackFab) document.body.appendChild(feedbackFab);
    document.body.appendChild(modal);
    api.openSlides = openSlides;
  }

  var api = {
    init: init,
    // slides を指定した init の後で使える。指定がなければ何もしない
    openSlides: function () {},
  };
  window.RoomkHowto = api;
})();

/**
 * room-K 共通「QRコードを出す」
 *
 * スマホ・タブレットなど別の端末で参加する人のために、参加用のリンク（?room=コード）を
 * QRコードにして画面の上に大きく重ねて出す。画面共有越しにカメラで読みとれる大きさにする。
 * 仕様は docs/development/rtdb.md「参加用のリンク」。
 *
 * 使い方（非モジュール通常スクリプト。design-system.css 読み込みが前提）:
 *
 *   <script src="../shared/js/room-qr.js?v=20261022"></script>
 *   <button type="button" id="btnShowQr" onclick="RoomkQR.show(state.roomCode)">QRコードを出す</button>
 *
 *   RoomkQR.show(code)        … このページのアドレス + ?room=コード を出す
 *   RoomkQR.show(code, link)  … 独自のパラメータを引き継ぐアプリはリンクを渡す
 *   RoomkQR.show(code, link, { showCode: false })  … QR の下にルームコードを出さない
 *
 * QRコードを作るライブラリ（vendor/qrcode-generator-2.0.4.js、MIT）は初めて開くときに読み込む。
 * 後方互換で追加のみ。
 */
(function () {
  'use strict';

  var VENDOR_FILE = 'vendor/qrcode-generator-2.0.4.js';
  var STYLE_ID = 'roomk-qr-style';
  var CSS = [
    // アプリ側の重ね表示（最大 1100）より上、説明スライド（9000）と共通トースト（9999）より下
    '.roomk-qr {',
    '  display: none; position: fixed; inset: 0; z-index: 8000;',
    '  background: rgba(28,63,94,0.55);',
    '  align-items: center; justify-content: center; padding: 16px;',
    '}',
    '.roomk-qr.show { display: flex; }',
    '.roomk-qr-card {',
    '  width: 100%; max-width: 440px; max-height: calc(100dvh - 32px); overflow-y: auto;',
    '  background: var(--color-surface); border-radius: 20px;',
    '  padding: 20px 20px 16px; text-align: center;',
    '  box-shadow: 0 8px 32px rgba(0,0,0,0.25);',
    '}',
    '.roomk-qr-title { margin: 0 0 4px; font-size: 18px; font-weight: 700; color: var(--color-primary); }',
    '.roomk-qr-lead { margin: 0 0 12px; font-size: 14px; line-height: 1.6; color: var(--color-text); }',
    // 読みとりやすいよう、色の設定にかかわらず白地に黒で描く（まわりの白い余白も含める）
    '.roomk-qr-code {',
    '  width: min(320px, 72vw, 50dvh); aspect-ratio: 1; margin: 0 auto;',
    '  background: #fff; display: flex; align-items: center; justify-content: center;',
    '}',
    '.roomk-qr-code svg { display: block; width: 100%; height: 100%; }',
    '.roomk-qr-error { padding: 16px; font-size: 14px; line-height: 1.6; color: var(--color-text); }',
    '.roomk-qr-room { margin: 12px 0 0; font-size: 14px; color: var(--color-muted); }',
    '.roomk-qr-room strong {',
    '  display: block; font-size: 28px; letter-spacing: 0.12em; color: var(--color-text);',
    '  font-variant-numeric: tabular-nums; word-break: break-all;',
    '}',
    '.roomk-qr-close { margin-top: 16px; }',
  ].join('\n');

  // このファイルと同じ場所を基準に vendor を探す（読み込み時にしか取れない）
  var baseUrl = (function () {
    var script = document.currentScript;
    return script && script.src ? script.src : location.href;
  })();

  var libPromise = null;
  function loadLibrary() {
    if (typeof window.qrcode === 'function') return Promise.resolve(window.qrcode);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = new URL(VENDOR_FILE, baseUrl).href;
      script.onload = function () {
        if (typeof window.qrcode === 'function') resolve(window.qrcode);
        else reject(new Error('qrcode が見つかりません'));
      };
      script.onerror = function () { reject(new Error('読み込めませんでした')); };
      document.head.appendChild(script);
    }).catch(function (error) {
      libPromise = null; // 次に開いたときにもう一度試す
      throw error;
    });
    return libPromise;
  }

  // 暗いマスを1本の path にまとめた SVG（まわりに4マスの白い余白）
  function buildSvg(qrcode, text) {
    var qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    var count = qr.getModuleCount();
    var margin = 4;
    var size = count + margin * 2;
    var d = '';
    for (var row = 0; row < count; row++) {
      for (var col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += 'M' + (col + margin) + ' ' + (row + margin) + 'h1v1h-1z';
      }
    }
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '参加用のリンクのQRコード');
    var bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', String(size));
    bg.setAttribute('height', String(size));
    bg.setAttribute('fill', '#fff');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#000');
    svg.appendChild(bg);
    svg.appendChild(path);
    return svg;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  var layer = null;
  var codeBox = null;
  var roomText = null;
  var closeBtn = null;
  var returnFocus = null;
  var openCount = 0;
  var inertSiblings = [];

  // 背景の不活性化（howto.js と同じ。自分が inert にした要素だけを戻す）
  function setBackgroundInert(on) {
    if (!('inert' in HTMLElement.prototype)) return;
    if (on) {
      inertSiblings = [];
      Array.prototype.forEach.call(document.body.children, function (node) {
        if (node === layer || node.inert) return;
        node.inert = true;
        inertSiblings.push(node);
      });
    } else {
      inertSiblings.forEach(function (node) { node.inert = false; });
      inertSiblings = [];
    }
  }

  function build() {
    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    layer = el('div', 'roomk-qr');
    layer.id = 'roomkQr';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'roomkQrTitle');
    var card = el('div', 'roomk-qr-card');
    var title = el('p', 'roomk-qr-title', 'スマホ・タブレットで参加する');
    title.id = 'roomkQrTitle';
    card.appendChild(title);
    card.appendChild(el('p', 'roomk-qr-lead', 'カメラで読みとると、参加の画面がひらくよ'));
    codeBox = el('div', 'roomk-qr-code');
    card.appendChild(codeBox);
    roomText = el('p', 'roomk-qr-room');
    card.appendChild(roomText);
    closeBtn = el('button', 'btn btn-secondary btn-full roomk-qr-close');
    closeBtn.type = 'button';
    var icon = el('span', 'material-symbols-rounded', 'close');
    icon.setAttribute('aria-hidden', 'true');
    closeBtn.appendChild(icon);
    closeBtn.appendChild(document.createTextNode('とじる'));
    card.appendChild(closeBtn);
    layer.appendChild(card);

    closeBtn.addEventListener('click', close);
    layer.addEventListener('click', function (e) {
      if (e.target === layer) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) close();
    });
    document.body.appendChild(layer);
  }

  function isOpen() {
    return !!layer && layer.classList.contains('show');
  }

  function close() {
    if (!isOpen()) return;
    openCount++; // 読み込み中に閉じたら、あとから描かない
    layer.classList.remove('show');
    setBackgroundInert(false);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  // options.showCode: false で QR の下のルームコードを出さない（画面に出していない秘密のカギを使うアプリ用）
  function show(code, link, options) {
    var showCode = !(options && options.showCode === false);
    if (typeof code !== 'string' || !code) {
      if (window.RoomkRTDB && window.RoomkRTDB.showToast) window.RoomkRTDB.showToast('ルームコードがありません');
      return false;
    }
    var text = typeof link === 'string' && link ? link : location.origin + location.pathname + '?room=' + code;
    if (!layer) build();
    if (isOpen()) close();
    var ticket = ++openCount;
    returnFocus = document.activeElement;
    codeBox.textContent = '';
    roomText.textContent = '';
    roomText.hidden = !showCode;
    if (showCode) {
      roomText.appendChild(document.createTextNode('ルームコード'));
      roomText.appendChild(el('strong', null, code));
    }
    layer.classList.add('show');
    setBackgroundInert(true);
    closeBtn.focus();
    loadLibrary().then(function (qrcode) {
      if (ticket !== openCount) return;
      codeBox.appendChild(buildSvg(qrcode, text));
    }).catch(function () {
      if (ticket !== openCount) return;
      codeBox.appendChild(el('p', 'roomk-qr-error', 'QRコードを出せませんでした。「リンクをコピー」でチャットに送ってね'));
    });
    return true;
  }

  window.RoomkQR = { show: show, close: close };
})();

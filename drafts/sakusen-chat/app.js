/* 作戦会議チャット（試作）
   同じブラウザでひらいた2つのウィンドウの間を BroadcastChannel でつなぐモック。
   会話と画像はメンターのウィンドウのメモリにだけ置き、どこにも保存しない。 */
(() => {
  'use strict';

  const CHANNEL = 'roomk-sakusen-chat-draft';
  const BASE_TITLE = '作戦会議チャット（試作） | room-K';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
  const NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
    '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
  const TOPIC_MAX = NUMBERS.length;
  const TITLE_MAX = 30;
  const TEXT_MAX = 500;
  const IMG_MAX_EDGE = 1280;
  const IMG_QUALITY = 0.82;
  const TYPING_MS = 4000;
  const TYPING_SEND_GAP_MS = 1500;
  const JOIN_WAIT_MS = 1500;
  const PING_MS = 5000;
  const PING_MISS_LIMIT = 3;
  const NEAR_BOTTOM_PX = 80;

  // 部屋をひらいたとき、最初から並ぶ話題
  const FIRST_TOPICS = [
    { id: 't-checkin', title: 'チェックイン', kind: 'free' },
    { id: 't-mood', title: 'ジブンチェック', kind: 'mood' },
  ];
  const MOOD_QUESTION = '今日の調子はどのへん？';
  const MOODS = [
    { num: '⑤', text: '絶好調' },
    { num: '④', text: '調子がよさそう' },
    { num: '③', text: 'いつも通り' },
    { num: '②', text: '少し気持ちが落ち込んでいる' },
    { num: '①', text: 'とても気持ちが落ち込んでいる' },
  ];
  const MOOD_PASS = '今日は答えない';

  const $ = (id) => document.getElementById(id);
  const el = {
    top: $('sc-top'), join: $('sc-join'), app: $('sc-app'), end: $('sc-end'),
    open: $('sc-open'), enter: $('sc-enter'), joinMsg: $('sc-join-msg'),
    peer: $('sc-peer'), sound: $('sc-sound'), copy: $('sc-copy'), finish: $('sc-finish'),
    topicList: $('sc-topic-list'), addOpen: $('sc-add-open'), addForm: $('sc-add-form'),
    addInput: $('sc-add-input'), addCancel: $('sc-add-cancel'),
    back: $('sc-back'), backBadge: $('sc-back-badge'), talkTitle: $('sc-talk-title'),
    msgs: $('sc-msgs'), newer: $('sc-newer'), typing: $('sc-typing'),
    form: $('sc-form'), pending: $('sc-pending'), pendingImg: $('sc-pending-img'),
    pendingRemove: $('sc-pending-remove'), pick: $('sc-pick'), file: $('sc-file'),
    text: $('sc-text'), endLead: $('sc-end-lead'), endAgain: $('sc-end-again'),
    confirm: $('sc-confirm'), confirmTitle: $('sc-confirm-title'), confirmBody: $('sc-confirm-body'),
    confirmOk: $('sc-confirm-ok'), confirmCancel: $('sc-confirm-cancel'),
    viewer: $('sc-viewer'), viewerImg: $('sc-viewer-img'), viewerClose: $('sc-viewer-close'),
    toast: $('sc-toast'),
  };

  const S = {
    me: clientId(),
    role: null,        // 'mentor' | 'child'
    code: '',
    open: false,       // 部屋に入っている間 true
    guest: null,       // メンター側: 入っている相手の id
    peerHere: false,
    topics: [],
    msgs: {},          // 話題 id → メッセージの配列
    unread: {},        // 話題 id → 未読の数
    firstUnread: {},   // 話題 id → 「ここから新しい」の線を引くメッセージ id
    fresh: {},         // 話題 id → 相手がふやして、まだひらいていない
    typing: {},        // 話題 id → 「入力中…」を消す時刻
    current: null,
    sound: true,
    pendingImg: null,  // { src, w, h }
    drafts: {},        // 話題 id → 書きかけ { text, img }
  };

  let bc = null;
  let seq = 0;
  let joinTimer = null;
  let pingTimer = null;
  let pongWait = false;
  let pongMiss = 0;
  let lastTypingSent = 0;
  let toastTimer = null;
  let confirmAction = null;
  let audio = null;
  const narrow = window.matchMedia('(max-width: 600px)');
  const coarse = window.matchMedia('(pointer: coarse)');

  // ───────── 起動 ─────────

  boot();

  function boot() {
    const raw = new URLSearchParams(location.search).get('room');
    if (raw === null) { show('top'); return; }
    const code = raw.normalize('NFKC').replace(/\s/g, '').toUpperCase();
    if (CODE_RE.test(code)) {
      S.role = 'child';
      S.code = code;
      show('join');
    } else {
      history.replaceState(null, '', location.pathname);
      show('top');
      toast('リンクが正しくないよ');
    }
  }

  function clientId() {
    const key = 'sc-draft-client';
    try {
      let id = sessionStorage.getItem(key);
      if (!id) { id = randomId(); sessionStorage.setItem(key, id); }
      return id;
    } catch (e) {
      return randomId();
    }
  }

  function randomId() {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return a[0].toString(36) + a[1].toString(36);
  }

  function makeCode() {
    const a = new Uint32Array(6);
    crypto.getRandomValues(a);
    return Array.from(a, (n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
  }

  function show(name) {
    ['top', 'join', 'app', 'end'].forEach((k) => { el[k].hidden = k !== name; });
  }

  // ───────── つなぐ（本体では通信に置きかえる部分） ─────────

  function startChannel() {
    if (bc) return;
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e) => onWire(e.data);
  }

  function stopChannel() {
    if (!bc) return;
    bc.close();
    bc = null;
  }

  function wire(type, body) {
    if (!bc) return;
    bc.postMessage(Object.assign({ type, code: S.code, from: S.me }, body));
  }

  function onWire(m) {
    if (!m || m.code !== S.code || m.from === S.me) return;
    if (S.role === 'mentor') onWireMentor(m);
    else if (S.role === 'child') onWireChild(m);
  }

  function onWireMentor(m) {
    if (!S.open) return;
    if (m.type === 'hello') {
      if (S.guest && S.guest !== m.from) { wire('full', { to: m.from }); return; }
      const wasHere = S.peerHere;
      S.guest = m.from;
      S.peerHere = true;
      pongWait = false;
      pongMiss = 0;
      wire('welcome', { to: m.from, topics: S.topics, msgs: S.msgs });
      renderPeer();
      if (!wasHere) { toast('相手が入ったよ'); beep(); }
      return;
    }
    if (m.from !== S.guest) return;
    if (m.type === 'bye') { peerLeft(); return; }
    if (m.type === 'pong') { pongWait = false; pongMiss = 0; return; }
    onWireShared(m);
  }

  function onWireChild(m) {
    if (m.type === 'welcome' && m.to === S.me && !S.open) {
      clearTimeout(joinTimer);
      S.topics = m.topics || [];
      S.msgs = m.msgs || {};
      S.peerHere = true;
      enterApp();
      return;
    }
    if (m.type === 'full' && m.to === S.me && !S.open) {
      joinFail('この部屋には、もう2人入っているよ。');
      return;
    }
    if (!S.open) return;
    if (m.type === 'closed') { finish(); return; }
    if (m.type === 'ping') { wire('pong'); return; }
    onWireShared(m);
  }

  function onWireShared(m) {
    const peerRole = S.role === 'mentor' ? 'child' : 'mentor';
    if (m.type === 'topic') addTopic(m.topic, false);
    else if (m.type === 'msg') addMsg(m.topicId, Object.assign({}, m.msg, { from: peerRole }), false);
    else if (m.type === 'del') delMsg(m.topicId, m.id, peerRole);
    else if (m.type === 'typing') setTyping(m.topicId, m.on);
  }

  function peerLeft() {
    S.guest = null;
    S.peerHere = false;
    S.typing = {};
    renderPeer();
    renderTopics();
    renderTyping();
    toast('相手が出たよ');
  }

  // 相手のウィンドウが返事をしなくなったら、出たものとして扱う
  function startPing() {
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (!S.open || !S.guest) return;
      if (pongWait) {
        pongMiss += 1;
        if (pongMiss >= PING_MISS_LIMIT) { peerLeft(); return; }
      }
      pongWait = true;
      wire('ping');
    }, PING_MS);
  }

  // ───────── 部屋をひらく・入る・終わる ─────────

  function openRoom() {
    unlockAudio();
    S.role = 'mentor';
    S.code = makeCode();
    S.topics = FIRST_TOPICS.map((t) => Object.assign({}, t));
    S.msgs = {};
    S.guest = null;
    S.peerHere = false;
    startChannel();
    startPing();
    enterApp();
  }

  function enterRoom() {
    unlockAudio();
    el.enter.disabled = true;
    el.joinMsg.hidden = true;
    startChannel();
    wire('hello');
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => {
      joinFail('部屋がひらいていないよ。メンターが部屋をひらいてから、もう一度「入る」を押してね。');
    }, JOIN_WAIT_MS);
  }

  function joinFail(text) {
    clearTimeout(joinTimer);
    el.joinMsg.textContent = text;
    el.joinMsg.hidden = false;
    el.enter.disabled = false;
  }

  function enterApp() {
    S.open = true;
    S.unread = {};
    S.firstUnread = {};
    S.fresh = {};
    S.typing = {};
    S.drafts = {};
    S.current = S.topics.length ? S.topics[0].id : null;
    const mentor = S.role === 'mentor';
    el.copy.hidden = !mentor;
    el.finish.hidden = !mentor;
    el.app.dataset.view = 'list';
    show('app');
    renderPeer();
    renderTalk();
    renderTopics();
    if (!narrow.matches) el.text.focus();
  }

  function finish() {
    const mentor = S.role === 'mentor';
    if (mentor) wire('closed');
    wipe();
    el.endAgain.hidden = !mentor;
    show('end');
  }

  // 会話と画像をすべて消す
  function wipe() {
    S.open = false;
    S.guest = null;
    S.peerHere = false;
    S.topics = [];
    S.msgs = {};
    S.unread = {};
    S.firstUnread = {};
    S.fresh = {};
    S.typing = {};
    S.current = null;
    S.drafts = {};
    clearPending();
    clearInterval(pingTimer);
    clearTimeout(joinTimer);
    stopChannel();
    el.msgs.textContent = '';
    el.topicList.textContent = '';
    el.text.value = '';
    el.addForm.hidden = true;
    el.addOpen.hidden = false;
    if (el.viewer.open) el.viewer.close();
    if (el.confirm.open) el.confirm.close();
    document.title = BASE_TITLE;
  }

  function roomLink() {
    return location.origin + location.pathname + '?room=' + S.code;
  }

  function copyLink() {
    const link = roomLink();
    const done = () => {
      el.copy.textContent = 'コピーしたよ';
      el.copy.classList.add('done');
      setTimeout(() => {
        el.copy.textContent = 'リンクをコピー';
        el.copy.classList.remove('done');
      }, 1500);
    };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = link;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) done(); else toast('コピーできなかったよ');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, fallback);
    } else {
      fallback();
    }
  }

  // ───────── 未読 ─────────

  function talkShown() {
    return !narrow.matches || el.app.dataset.view === 'talk';
  }

  // その話題をいま見ているか（見ている間に届いたものは未読にしない）
  function watching(topicId) {
    return S.open && S.current === topicId && talkShown()
      && document.visibilityState === 'visible' && document.hasFocus();
  }

  function totalUnread() {
    let n = 0;
    S.topics.forEach((t) => { n += (S.unread[t.id] || 0) + (S.fresh[t.id] ? 1 : 0); });
    return n;
  }

  // 見ている状態になったら、その話題の未読を消す
  function checkRead() {
    const id = S.current;
    if (!id || !watching(id)) return;
    const had = S.unread[id] > 0;
    if (!had && !S.fresh[id]) return;
    S.unread[id] = 0;
    S.fresh[id] = false;
    if (had) renderTalk();
    renderTopics();
  }

  function setView(view) {
    if (view === 'list' && S.current) delete S.firstUnread[S.current];
    el.app.dataset.view = view;
    checkRead();
    renderTopics();
  }

  // ───────── 話題 ─────────

  function addTopic(topic, mine) {
    if (!topic || S.topics.length >= TOPIC_MAX) return;
    if (S.topics.some((t) => t.id === topic.id)) return;
    S.topics.push({ id: String(topic.id), title: String(topic.title).slice(0, TITLE_MAX), kind: 'free' });
    if (mine) {
      openTopic(topic.id);
    } else {
      S.fresh[topic.id] = true;
      beep();
      renderTopics();
    }
  }

  function submitTopic() {
    const title = el.addInput.value.trim().slice(0, TITLE_MAX);
    if (!title) { el.addInput.focus(); return; }
    if (S.topics.length >= TOPIC_MAX) { toast('話題は' + TOPIC_MAX + 'こまでだよ'); return; }
    const topic = { id: 't-' + S.me + '-' + (++seq), title, kind: 'free' };
    closeAddForm();
    addTopic(topic, true);
    wire('topic', { topic });
  }

  function closeAddForm() {
    el.addInput.value = '';
    el.addForm.hidden = true;
    el.addOpen.hidden = false;
  }

  function openTopic(id) {
    if (S.current && S.current !== id) {
      delete S.firstUnread[S.current];
      // 書きかけは話題ごとに取っておく
      S.drafts[S.current] = { text: el.text.value, img: S.pendingImg };
      if (el.text.value.trim()) sendTyping(false);
      const draft = S.drafts[id] || { text: '', img: null };
      el.text.value = draft.text;
      growText();
      showPending(draft.img);
    }
    S.current = id;
    // 会話を表に出してから描く（かくれている間はスクロール位置を決められない）
    if (narrow.matches) el.app.dataset.view = 'talk';
    renderTalk();
    if (watching(id)) { S.unread[id] = 0; S.fresh[id] = false; }
    renderTopics();
    if (!coarse.matches) el.text.focus();
  }

  function previewText(topic) {
    if (S.typing[topic.id] > Date.now()) return '入力中…';
    const list = S.msgs[topic.id] || [];
    if (!list.length) return 'まだメッセージはないよ';
    const m = list[list.length - 1];
    const who = m.from === S.role ? 'あなた: ' : '';
    const body = m.kind === 'image' ? ('画像' + (m.text ? ' ' + m.text : '')) : m.text;
    return who + body;
  }

  function renderTopics() {
    el.topicList.textContent = '';
    S.topics.forEach((t, i) => {
      const unread = S.unread[t.id] || 0;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sc-topic';
      if (t.id === S.current && talkShown()) btn.setAttribute('aria-current', 'true');
      if (unread || S.fresh[t.id]) btn.classList.add('sc-topic--unread');
      btn.dataset.topic = t.id;
      let label = (i + 1) + '番の話題: ' + t.title;
      if (unread) label += '、未読' + unread + '件';
      else if (S.fresh[t.id]) label += '、新しい話題';
      btn.setAttribute('aria-label', label);

      const num = document.createElement('span');
      num.className = 'sc-topic__num';
      num.textContent = NUMBERS[i];
      const body = document.createElement('span');
      body.className = 'sc-topic__body';
      const title = document.createElement('span');
      title.className = 'sc-topic__title';
      title.textContent = t.title;
      const preview = document.createElement('span');
      preview.className = 'sc-topic__preview';
      preview.textContent = previewText(t);
      body.append(title, preview);
      btn.append(num, body);

      if (unread || S.fresh[t.id]) {
        const count = document.createElement('span');
        count.className = 'sc-count';
        count.textContent = unread ? String(unread) : '新しい';
        btn.append(count);
      }
      btn.addEventListener('click', () => openTopic(t.id));
      li.append(btn);
      el.topicList.append(li);
    });
    el.addOpen.disabled = S.topics.length >= TOPIC_MAX;

    const total = totalUnread();
    document.title = (total ? '(' + total + ') ' : '') + BASE_TITLE;
    el.backBadge.hidden = !total;
    el.backBadge.textContent = String(total);
  }

  function renderPeer() {
    if (S.role !== 'mentor') { el.peer.hidden = true; return; }
    el.peer.hidden = false;
    el.peer.textContent = S.peerHere ? '相手が入っているよ' : '相手を待っているよ';
    el.peer.classList.toggle('sc-bar__peer--here', S.peerHere);
  }

  // ───────── メッセージ ─────────

  function currentTopic() {
    return S.topics.find((t) => t.id === S.current) || null;
  }

  function nearBottom() {
    return el.msgs.scrollHeight - el.msgs.scrollTop - el.msgs.clientHeight < NEAR_BOTTOM_PX;
  }

  function scrollBottom() {
    el.msgs.scrollTop = el.msgs.scrollHeight;
    el.newer.hidden = true;
  }

  function renderTalk() {
    const topic = currentTopic();
    el.msgs.textContent = '';
    el.newer.hidden = true;
    el.talkTitle.textContent = topic ? topic.title : '';
    if (!topic) { renderTyping(); return; }
    if (topic.kind === 'mood') el.msgs.append(moodCard());
    const list = S.msgs[topic.id] || [];
    let divider = null;
    list.forEach((m) => {
      if (m.id === S.firstUnread[topic.id]) {
        divider = document.createElement('p');
        divider.className = 'sc-talk__divider';
        divider.textContent = 'ここから新しいメッセージ';
        el.msgs.append(divider);
      }
      el.msgs.append(msgEl(m));
    });
    if (!list.length && topic.kind !== 'mood') {
      const empty = document.createElement('p');
      empty.className = 'sc-talk__empty';
      empty.textContent = 'まだメッセージはないよ';
      el.msgs.append(empty);
    }
    if (divider) {
      el.msgs.scrollTop = Math.max(0, divider.offsetTop - 8);
    } else {
      scrollBottom();
    }
    renderTyping();
  }

  function moodCard() {
    const card = document.createElement('div');
    card.className = 'sc-mood';
    const q = document.createElement('p');
    q.className = 'sc-mood__q';
    q.textContent = MOOD_QUESTION;
    card.append(q);
    MOODS.forEach((mood) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sc-choice';
      const num = document.createElement('span');
      num.className = 'sc-choice__num';
      num.textContent = mood.num;
      const text = document.createElement('span');
      text.className = 'sc-choice__text';
      text.textContent = mood.text;
      btn.append(num, text);
      btn.addEventListener('click', () => sendMsg({ kind: 'mood', text: mood.num + ' ' + mood.text }));
      card.append(btn);
    });
    const pass = document.createElement('button');
    pass.type = 'button';
    pass.className = 'sc-choice sc-choice--pass';
    pass.textContent = MOOD_PASS;
    pass.addEventListener('click', () => sendMsg({ kind: 'mood', text: MOOD_PASS }));
    card.append(pass);
    return card;
  }

  function timeText(at) {
    const d = new Date(at);
    return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function msgEl(m) {
    const mine = m.from === S.role;
    const wrap = document.createElement('div');
    wrap.className = 'sc-msg ' + (mine ? 'sc-msg--me' : 'sc-msg--peer');
    wrap.dataset.id = m.id;
    const bubble = document.createElement('div');
    bubble.className = 'sc-msg__bubble';
    if (m.kind === 'image' && m.img) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sc-msg__imgbtn';
      btn.setAttribute('aria-label', '画像を大きく見る');
      const img = document.createElement('img');
      img.className = 'sc-msg__img';
      img.alt = mine ? 'あなたが送った画像' : '相手が送った画像';
      if (m.w && m.h) { img.width = m.w; img.height = m.h; }
      img.src = m.img;
      btn.append(img);
      btn.addEventListener('click', () => openViewer(m.img));
      bubble.append(btn);
    }
    if (m.text) {
      const p = document.createElement('p');
      p.className = 'sc-msg__text';
      p.textContent = m.text;
      bubble.append(p);
    }
    const meta = document.createElement('div');
    meta.className = 'sc-msg__meta';
    const time = document.createElement('span');
    time.textContent = timeText(m.at);
    meta.append(time);
    if (mine) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'sc-msg__del';
      del.textContent = '消す';
      del.addEventListener('click', () => askDelete(m.id));
      meta.append(del);
    }
    wrap.append(bubble, meta);
    return wrap;
  }

  function appendMsg(m) {
    const empty = el.msgs.querySelector('.sc-talk__empty');
    if (empty) empty.remove();
    el.msgs.append(msgEl(m));
  }

  function addMsg(topicId, m, mine) {
    if (!m || !S.topics.some((t) => t.id === topicId)) return;
    const list = S.msgs[topicId] || (S.msgs[topicId] = []);
    if (list.some((x) => x.id === m.id)) return;
    list.push(m);
    const shown = S.current === topicId;
    if (mine) {
      delete S.firstUnread[topicId];
      if (shown) {
        const divider = el.msgs.querySelector('.sc-talk__divider');
        if (divider) divider.remove();
        appendMsg(m);
        scrollBottom();
      }
    } else {
      delete S.typing[topicId];
      const stick = shown && nearBottom();
      if (shown) appendMsg(m);
      if (watching(topicId)) {
        if (stick) scrollBottom(); else el.newer.hidden = false;
      } else {
        // 未読がたまりはじめた1通目に線を引く（前に読んだときの線は引き直す）
        if (!S.unread[topicId]) S.firstUnread[topicId] = m.id;
        S.unread[topicId] = (S.unread[topicId] || 0) + 1;
        if (stick) scrollBottom();
        beep();
      }
      renderTyping();
    }
    renderTopics();
  }

  function sendMsg(part) {
    const topic = currentTopic();
    if (!topic) return;
    const m = Object.assign({ id: 'm-' + S.me + '-' + (++seq), from: S.role, at: Date.now() }, part);
    addMsg(topic.id, m, true);
    wire('msg', { topicId: topic.id, msg: m });
  }

  function submitText() {
    const text = el.text.value.trim().slice(0, TEXT_MAX);
    const img = S.pendingImg;
    if (!text && !img) { el.text.focus(); return; }
    if (img) sendMsg({ kind: 'image', text, img: img.src, w: img.w, h: img.h });
    else sendMsg({ kind: 'text', text });
    el.text.value = '';
    growText();
    clearPending();
    sendTyping(false);
    el.text.focus();
  }

  // 消せるのは書いた本人だけ
  function delMsg(topicId, id, by) {
    const list = S.msgs[topicId];
    if (!list) return;
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0 || list[idx].from !== by) return;
    const firstIdx = list.findIndex((m) => m.id === S.firstUnread[topicId]);
    const wasUnread = firstIdx >= 0 && idx >= firstIdx && list[idx].from !== S.role;
    list.splice(idx, 1);
    if (wasUnread && S.unread[topicId] > 0) S.unread[topicId] -= 1;
    if (firstIdx === idx) {
      const next = list.slice(idx).find((m) => m.from !== S.role);
      if (next) S.firstUnread[topicId] = next.id; else delete S.firstUnread[topicId];
    }
    if (S.current === topicId) {
      const keep = el.msgs.scrollTop;
      renderTalk();
      el.msgs.scrollTop = keep;
    }
    renderTopics();
  }

  function askDelete(id) {
    const topicId = S.current;
    ask({
      title: 'このメッセージを消す？',
      body: '相手の画面からも消えるよ。',
      ok: '消す',
    }, () => {
      delMsg(topicId, id, S.role);
      wire('del', { topicId, id });
    });
  }

  // ───────── 入力中 ─────────

  function sendTyping(on) {
    if (!S.current) return;
    if (on) {
      const now = Date.now();
      if (now - lastTypingSent < TYPING_SEND_GAP_MS) return;
      lastTypingSent = now;
    } else {
      lastTypingSent = 0;
    }
    wire('typing', { topicId: S.current, on });
  }

  function setTyping(topicId, on) {
    if (on) {
      S.typing[topicId] = Date.now() + TYPING_MS;
      setTimeout(() => { renderTyping(); if (S.open) renderTopics(); }, TYPING_MS + 50);
    } else {
      delete S.typing[topicId];
    }
    renderTyping();
    renderTopics();
  }

  function renderTyping() {
    el.typing.hidden = !(S.current && S.typing[S.current] > Date.now());
  }

  // ───────── 画像 ─────────

  // 画像をブラウザの中で小さくする（位置情報などの付属データもここで落ちる）
  function shrink(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('not image')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, IMG_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve({ src: canvas.toDataURL('image/jpeg', IMG_QUALITY), w, h });
        } catch (e) {
          reject(e);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')); };
      img.src = url;
    });
  }

  function showPending(img) {
    S.pendingImg = img || null;
    if (img) el.pendingImg.src = img.src; else el.pendingImg.removeAttribute('src');
    el.pending.hidden = !img;
  }

  function setPending(file) {
    const topicId = S.current;
    shrink(file).then((img) => {
      if (!S.open || S.current !== topicId) return;
      showPending(img);
      el.text.focus();
    }, () => {
      toast('この画像は使えなかったよ。別の画像でためしてね。');
    });
  }

  function clearPending() {
    showPending(null);
    el.file.value = '';
  }

  function firstImage(files) {
    return Array.from(files || []).find((f) => /^image\//.test(f.type)) || null;
  }

  function openViewer(src) {
    el.viewerImg.src = src;
    el.viewer.showModal();
  }

  // ───────── こまかい部品 ─────────

  function ask(texts, action) {
    el.confirmTitle.textContent = texts.title;
    el.confirmBody.textContent = texts.body;
    el.confirmOk.textContent = texts.ok;
    confirmAction = action;
    el.confirm.showModal();
  }

  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
  }

  function unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audio && Ctx) audio = new Ctx();
      if (audio && audio.state === 'suspended') audio.resume();
    } catch (e) { audio = null; }
  }

  function beep() {
    if (!S.sound || !audio) return;
    try {
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    } catch (e) { /* 音が出せなくても続ける */ }
  }

  function growText() {
    el.text.style.height = 'auto';
    el.text.style.height = Math.min(el.text.scrollHeight, 140) + 'px';
  }

  // ───────── 操作 ─────────

  el.open.addEventListener('click', openRoom);
  el.endAgain.addEventListener('click', openRoom);
  el.enter.addEventListener('click', enterRoom);
  el.copy.addEventListener('click', copyLink);
  el.finish.addEventListener('click', () => {
    ask({
      title: '作戦会議チャットを終わる？',
      body: '会話と画像をすべて消して、部屋をとじるよ。もとにはもどせない。',
      ok: '終わる',
    }, finish);
  });

  el.sound.addEventListener('click', () => {
    S.sound = !S.sound;
    el.sound.setAttribute('aria-pressed', String(S.sound));
    el.sound.setAttribute('aria-label', '新着の音: ' + (S.sound ? 'オン' : 'オフ'));
    el.sound.firstElementChild.textContent = S.sound ? 'volume_up' : 'volume_off';
    if (S.sound) { unlockAudio(); beep(); }
  });

  el.addOpen.addEventListener('click', () => {
    el.addOpen.hidden = true;
    el.addForm.hidden = false;
    el.addInput.focus();
  });
  el.addCancel.addEventListener('click', closeAddForm);
  el.addForm.addEventListener('submit', (e) => { e.preventDefault(); submitTopic(); });
  el.addInput.addEventListener('keydown', (e) => {
    // 変換を確定する Enter では送らない
    if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault();
  });

  el.back.addEventListener('click', () => setView('list'));

  el.form.addEventListener('submit', (e) => { e.preventDefault(); submitText(); });
  el.text.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || coarse.matches) return;
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submitText();
  });
  el.text.addEventListener('input', () => {
    growText();
    sendTyping(el.text.value.trim().length > 0);
  });
  el.text.addEventListener('paste', (e) => {
    const file = firstImage(e.clipboardData && e.clipboardData.files);
    if (!file) return;
    e.preventDefault();
    setPending(file);
  });

  el.pick.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', () => {
    const file = firstImage(el.file.files);
    if (file) setPending(file);
    else if (el.file.files.length) toast('この画像は使えなかったよ。別の画像でためしてね。');
  });
  el.pendingRemove.addEventListener('click', clearPending);

  const talk = document.querySelector('.sc-talk');
  talk.addEventListener('dragover', (e) => { e.preventDefault(); });
  talk.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = firstImage(e.dataTransfer && e.dataTransfer.files);
    if (file) setPending(file);
  });

  el.msgs.addEventListener('scroll', () => { if (nearBottom()) el.newer.hidden = true; });
  el.newer.addEventListener('click', scrollBottom);

  el.confirmOk.addEventListener('click', () => {
    const action = confirmAction;
    confirmAction = null;
    el.confirm.close();
    if (action) action();
  });
  el.confirmCancel.addEventListener('click', () => { confirmAction = null; el.confirm.close(); });
  el.confirm.addEventListener('close', () => { confirmAction = null; });

  el.viewerClose.addEventListener('click', () => el.viewer.close());
  el.viewer.addEventListener('click', (e) => { if (e.target === el.viewer) el.viewer.close(); });
  el.viewer.addEventListener('close', () => el.viewerImg.removeAttribute('src'));

  window.addEventListener('focus', checkRead);
  document.addEventListener('visibilitychange', checkRead);
  narrow.addEventListener('change', () => {
    if (!S.open) return;
    renderTalk();
    checkRead();
    renderTopics();
  });

  // メンターがウィンドウをとじると部屋もとじる（会話はメンターのウィンドウにしかない）
  window.addEventListener('beforeunload', (e) => {
    if (S.open && S.role === 'mentor') { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => {
    if (!S.open) return;
    wire(S.role === 'mentor' ? 'closed' : 'bye');
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
})();

/* たのんで、とどけて（試作）。1台の画面で、コンピューターの仲間3人と遊ぶ */
(function () {
  'use strict';
  const E = window.TTEngine;
  const NAMES = ['あなた', 'あおさん', 'みどりさん', 'きいろさん'];
  const ME = 0;

  // ちがう荷物が届いたときの、届け先のひとこと
  const VOICES = [
    '「…これはこれで、いいかも」',
    '「思っていたのとちがうけど、おもしろい！」',
    '「まあ、使ってみよう」',
    '「えっ、これ？ でも気に入った」',
    '「たのんだ物よりいいかもしれない」',
    '「どこに置こうかな…」'
  ];

  const $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function btn(cls, text, fn) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }
  function show(id) {
    document.querySelectorAll('.tt-screen').forEach(function (s) { s.classList.toggle('active', s.id === id); });
    window.scrollTo(0, 0);
  }

  let G = null;          // ルールの状態
  let ui = null;         // 画面の進み具合
  let cfg = { time: 180, showAll: false };
  let left = 0;          // のこり秒
  let timer = null;
  let best = null;       // この画面を開いている間の、前回のチームの星

  function start() {
    cfg.time = Number(document.querySelector('input[name="time"]:checked').value);
    cfg.showAll = $('showAll').checked;
    G = E.newGame(NAMES);
    left = cfg.time;
    $('timebar').hidden = !cfg.time;
    $('clock').hidden = !cfg.time;
    clearInterval(timer);
    if (cfg.time) timer = setInterval(tick, 250);
    show('screen-game');
    beginTurn();
  }

  // 結果を読んでいる間は時計を止める
  function tick() {
    if (!G || ui.phase === 'reveal') return;
    left -= 0.25;
    if (left <= 0) { left = 0; finish(); return; }
    drawClock();
  }
  function drawClock() {
    if (!cfg.time) return;
    const s = Math.ceil(left);
    $('clockText').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    $('timefill').style.width = (left / cfg.time * 100) + '%';
  }

  function beginTurn() {
    if (G.over) { finish(); return; }
    if (G.turn === ME) ui = { phase: 'ask', hints: [] };
    else ui = { phase: 'offer', hints: E.cpuHints(G, Math.random), asked: [], asking: false };
    draw();
  }

  // ── 自分がたのむ ──
  function sendAsk() {
    const offers = [], refuse = [];
    G.players.forEach(function (_, p) {
      if (p === ME) return;
      const o = E.cpuOffer(G, p, ui.hints, Math.random);
      if (o) offers.push(o); else refuse.push(p);
    });
    ui = { phase: 'pick', hints: ui.hints, offers: offers, refuse: refuse };
    draw();
  }
  function pick(offer) { reveal(E.deliver(G, offer, Math.random), false); }
  function skipOrder() { E.deliver(G, null, Math.random); beginTurn(); }

  // ── ほかの人がたのむ ──
  function giveCard(id) {
    const offers = [];
    G.players.forEach(function (_, p) {
      if (p === ME || p === G.turn) return;
      const o = E.cpuOffer(G, p, ui.hints, Math.random);
      if (o) offers.push(o);
    });
    let mine = null;
    if (id) {
      mine = { from: ME, item: id, sure: E.matchScore(id, ui.hints) === ui.hints.length };
      offers.push(mine);
    }
    const chosen = E.cpuPick(offers, Math.random);
    const res = E.deliver(G, chosen, Math.random);
    if (res.none) { ui = { phase: 'reveal', res: res }; draw(); return; }
    reveal(res, mine !== null && chosen !== mine);
  }
  function askBack(tag) {
    ui.asked.push({ tag: tag, yes: E.answer(G, tag) });
    G.players[ME].stat.ask++;
    ui.asking = false;
    draw();
  }

  function reveal(res, passedOver) {
    ui = { phase: 'reveal', res: res, passedOver: passedOver, voice: VOICES[Math.floor(Math.random() * VOICES.length)] };
    draw();
  }

  // ── 画面 ──
  function draw() {
    drawClock();
    $('teamStars').textContent = G.team;
    $('myStars').textContent = G.players[ME].stars;
    drawTown();
    drawStage();
    drawHand();
  }

  function drawTown() {
    const town = $('town');
    town.textContent = '';
    const turn = ui.phase === 'reveal' ? ui.res.req : G.turn;
    G.players.forEach(function (pl, i) {
      const li = el('li', 'tt-house tt-house--' + i + (i === turn ? ' is-turn' : ''));
      li.appendChild(el('span', 'tt-house__name', pl.name));
      li.appendChild(el('span', 'tt-house__sub', i === turn ? 'たのむ番' : '手札 ' + pl.hand.length + 'まい'));
      if (cfg.showAll) li.appendChild(el('span', 'tt-house__sub', '星 ' + pl.stars));
      town.appendChild(li);
    });
  }

  function chips(tags, pressed, onClick, disabledFn) {
    const box = el('div', 'tt-chips');
    tags.forEach(function (t) {
      const b = btn('tt-chip', t, function () { onClick(t); });
      if (pressed) b.setAttribute('aria-pressed', pressed.indexOf(t) >= 0 ? 'true' : 'false');
      if (disabledFn && disabledFn(t)) b.disabled = true;
      box.appendChild(b);
    });
    return box;
  }
  function saidLine(hints) {
    const p = el('p');
    hints.forEach(function (h) { p.appendChild(el('span', 'tt-said', h)); });
    return p;
  }

  function drawStage() {
    const st = $('stage');
    st.textContent = '';
    const req = G.players[G.turn];

    if (ui.phase === 'ask') {
      st.appendChild(el('h2', '', 'あなたの番。注文はこれ'));
      st.appendChild(el('p', 'tt-order', E.item(req.order).name));
      st.appendChild(el('p', '', '名前は言えない。ヒントを' + E.HINTS + 'つえらんで、たのもう。'));
      st.appendChild(chips(E.TAGS, ui.hints, function (t) {
        const i = ui.hints.indexOf(t);
        if (i >= 0) ui.hints.splice(i, 1);
        else if (ui.hints.length < E.HINTS) ui.hints.push(t);
        draw();
      }, function (t) { return ui.hints.length >= E.HINTS && ui.hints.indexOf(t) < 0; }));
      const go = btn('btn btn-primary btn-lg', 'おねがい！', sendAsk);
      go.disabled = ui.hints.length === 0;
      st.appendChild(go);
      return;
    }

    if (ui.phase === 'pick') {
      st.appendChild(el('h2', '', 'どの荷物を受け取る？'));
      st.appendChild(saidLine(ui.hints));
      if (ui.offers.length) {
        const box = el('div', 'tt-offers');
        ui.offers.forEach(function (o) {
          const b = btn('tt-offer', '', function () { pick(o); });
          const ic = el('span', 'material-symbols-rounded', 'package_2');
          ic.setAttribute('aria-hidden', 'true');
          b.appendChild(ic);
          b.appendChild(el('b', '', G.players[o.from].name));
          b.appendChild(el('span', '', o.sure ? '「たぶんこれ！」' : '「ちがうかも…」'));
          box.appendChild(b);
        });
        st.appendChild(box);
      } else {
        st.appendChild(el('p', '', 'だれも、それらしい荷物を持っていないみたい。'));
        st.appendChild(btn('btn btn-secondary', 'べつの注文にする', skipOrder));
      }
      if (ui.refuse.length) {
        st.appendChild(el('p', 'tt-refuse', ui.refuse.map(function (p) { return G.players[p].name; }).join('・') + '「今はむり、ごめん」'));
      }
      return;
    }

    if (ui.phase === 'offer') {
      st.appendChild(el('h2', '', req.name + 'がたのんでいる'));
      st.appendChild(saidLine(ui.hints));
      if (ui.asked.length) {
        const ul = el('ul', 'tt-asked');
        ui.asked.forEach(function (a) { ul.appendChild(el('li', '', a.tag + '？ → ' + (a.yes ? 'はい' : 'いいえ'))); });
        st.appendChild(ul);
      }
      if (ui.asking) {
        st.appendChild(el('p', '', '何を聞き返す？'));
        const done = ui.hints.concat(ui.asked.map(function (a) { return a.tag; }));
        st.appendChild(chips(E.TAGS, null, askBack, function (t) { return done.indexOf(t) >= 0; }));
        st.appendChild(btn('btn btn-secondary', 'やめる', function () { ui.asking = false; draw(); }));
        return;
      }
      st.appendChild(el('p', '', '下の手札から「これかな？」と思う荷物をえらぼう。'));
      const row = el('div', 'tt-row');
      row.appendChild(btn('btn btn-secondary', '聞き返す', function () { ui.asking = true; draw(); }));
      row.appendChild(btn('btn btn-secondary', '今はむり、ごめん', function () { giveCard(null); }));
      st.appendChild(row);
      return;
    }

    // 結果
    const r = ui.res;
    const rq = G.players[r.req].name;
    if (r.none) {
      st.appendChild(el('h2', '', 'だれも出さなかった'));
      st.appendChild(el('p', '', rq + 'は、べつの注文にする。'));
      st.appendChild(btn('btn btn-primary btn-lg', 'つぎへ', beginTurn));
      return;
    }
    const fr = G.players[r.from].name;
    st.appendChild(el('p', 'tt-result' + (r.hit ? ' tt-result--hit' : ''), r.hit ? 'ぴったり！' : 'あれ？ ちがう荷物！'));
    st.appendChild(el('p', 'tt-got', E.item(r.got).name));
    if (r.hit) {
      st.appendChild(el('p', '', rq + 'の注文が、' + fr + 'から届いた。'));
    } else {
      st.appendChild(el('p', '', rq + 'の注文は「' + E.item(r.wanted).name + '」。' + fr + 'から届いたのは、これ。'));
      st.appendChild(el('p', 'tt-voice', ui.voice));
    }
    st.appendChild(el('p', 'tt-small', rq + 'と' + fr + 'に星' + r.star + 'つずつ・チームに星' + r.team + 'つ'));
    if (ui.passedOver) st.appendChild(el('p', 'tt-small', '今回は、' + fr + 'の荷物がえらばれた。'));
    const mine = r.req === ME || r.from === ME;
    st.appendChild(btn('btn btn-primary btn-lg', mine ? 'ありがとう！' : 'つぎへ', beginTurn));
  }

  function drawHand() {
    const box = $('hand');
    box.textContent = '';
    const can = ui.phase === 'offer' && !ui.asking;
    const hints = can ? ui.hints.concat(ui.asked.filter(function (a) { return a.yes; }).map(function (a) { return a.tag; })) : [];
    G.players[ME].hand.forEach(function (id) {
      const it = E.item(id);
      const c = can ? btn('tt-card', '', function () { giveCard(id); }) : el('div', 'tt-card');
      c.appendChild(el('b', '', it.name));
      it.tags.forEach(function (t) { c.appendChild(el('span', hints.indexOf(t) >= 0 ? 'is-match' : '', t)); });
      box.appendChild(c);
    });
    if (!G.players[ME].hand.length) box.appendChild(el('p', 'tt-small', '手札はない。'));
  }

  // ── おわり ──
  function finish() {
    clearInterval(timer);
    $('endTeam').textContent = G.team;
    $('endLine').textContent = 'ぴったり ' + G.hits + 'こ・思いがけない荷物 ' + G.odds + 'こ を届けた。';
    $('endBest').textContent = best === null ? '' : (G.team > best ? 'これまでの一番 ' + best + ' をこえた！' : 'これまでの一番は ' + best + '。');
    best = best === null ? G.team : Math.max(best, G.team);
    const ul = $('endTitles');
    ul.textContent = '';
    E.titles(G).forEach(function (t, i) {
      const li = el('li');
      li.appendChild(el('span', '', G.players[i].name + ' … '));
      li.appendChild(el('b', '', t.name));
      li.appendChild(el('span', '', '（' + t.text + '）' + (cfg.showAll ? ' 星 ' + G.players[i].stars : '')));
      ul.appendChild(li);
    });
    $('endMe').textContent = 'あなたの星 ' + G.players[ME].stars;
    G = null;
    show('screen-end');
  }

  function toTop() { clearInterval(timer); G = null; show('screen-top'); }

  $('btnStart').addEventListener('click', start);
  $('btnAgain').addEventListener('click', start);
  $('btnTop').addEventListener('click', toTop);
  $('btnQuit').addEventListener('click', toTop);
})();

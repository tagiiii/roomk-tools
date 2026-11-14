/* 麻雀（試作） — 画面。ルールは engine.js、牌の絵は art.js
   1人（席0）とコンピューター3人。通信はしない。音は鳴らさない。 */
(function () {
  'use strict';

  const E = window.MahjongEngine;
  const A = window.MahjongArt;
  const ME = 0;
  const CPU_DELAY = 700;
  const AFTER_DISCARD = 450;
  const NAMES = ['あなた', 'コンピューター1', 'コンピューター2', 'コンピューター3'];
  // 席1は自分の次（右）、席2は向かい、席3は左。画面では 左・向かい・右 の順に並べる
  const OPP_ORDER = [3, 2, 1];
  const PLACE = { 1: '右', 2: '向かい', 3: '左' };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let S = null;
  let cfg = null;
  let wins = [0, 0, 0, 0];
  let roundNo = 0;
  let timer = null;
  let lastShownRev = -1;

  // ── 牌のかたち ──
  function tileHtml(k, o) {
    o = o || {};
    const cls = ['mj-tile'];
    if (o.size) cls.push('mj-tile--' + o.size);
    if (o.extra) cls.push(o.extra);
    const name = E.kindName(k);
    const cap = cfg && cfg.names && o.caption !== false ? '<span class="mj-cap">' + esc(name) + '</span>' : '';
    if (o.button) {
      return '<button type="button" class="' + cls.join(' ') + '" data-id="' + o.id + '" aria-label="' + esc(name) + 'を捨てる">' + A.face(k) + cap + '</button>';
    }
    return '<span class="' + cls.join(' ') + '" role="img" aria-label="' + esc(name) + '">' + A.face(k) + cap + '</span>';
  }
  function backHtml(size) {
    return '<span class="mj-tile mj-tile--' + size + ' mj-tile--back" aria-hidden="true">' + A.back() + '</span>';
  }

  function riverHtml(seat) {
    const river = S.seats[seat].river;
    return river.map((r, i) => {
      const isLast = S.last && S.last.seat === seat && i === river.length - 1 && !r.called;
      const extra = [r.called ? 'is-called' : '', isLast ? 'is-last' : '', isLast && S.rev !== lastShownRev ? 'is-new' : ''].join(' ').trim();
      return tileHtml(E.kindOf(r.id), { size: 'sm', extra, caption: false });
    }).join('');
  }

  function meldsHtml(seat, size) {
    return S.seats[seat].melds.map((m) => {
      const label = m.type === 'pon' ? 'ポン' : 'チー';
      const tiles = m.tiles.map((id) => tileHtml(E.kindOf(id), { size, extra: id === m.called ? 'is-taken' : '', caption: false })).join('');
      return '<span class="mj-meld" aria-label="' + label + 'した組"><span class="mj-meld__label">' + label + '</span>' + tiles + '</span>';
    }).join('');
  }

  // ── 描く ──
  function render() {
    $('wallCount').textContent = S.wall.length;
    $('roundLine').textContent = '第' + roundNo + '局 · はじめは ' + NAMES[S.dealer];

    // ほかの3人
    const opps = OPP_ORDER.map((seat) => {
      const s = S.seats[seat];
      const turn = S.phase !== 'end' && S.turn === seat ? ' is-turn' : '';
      const backs = s.hand.map(() => backHtml('xs')).join('');
      return '<section class="mj-opp' + turn + '" aria-label="' + esc(NAMES[seat]) + '">'
        + '<div class="mj-opp__head"><p class="mj-name">' + esc(NAMES[seat]) + '<span class="mj-place">' + PLACE[seat] + '</span></p>'
        + '<p class="mj-wins">あがり ' + wins[seat] + '</p></div>'
        + '<div class="mj-opp__hand">' + backs + meldsHtml(seat, 'xs') + '</div>'
        + '<div class="mj-river">' + riverHtml(seat) + '</div>'
        + '</section>';
    }).join('');
    $('opps').innerHTML = opps;

    // 自分
    const me = S.seats[ME];
    $('me').classList.toggle('is-turn', S.phase !== 'end' && S.turn === ME);
    $('myName').textContent = NAMES[ME];
    $('myWins').textContent = 'あがり ' + wins[ME];
    $('myRiver').innerHTML = riverHtml(ME);
    $('myMelds').innerHTML = meldsHtml(ME, 'md');

    const myTurn = S.phase === 'discard' && S.turn === ME;
    const advice = myTurn && cfg.hint ? E.discardAdvice(S, ME) : null;
    const bestKinds = new Set(advice ? advice.list.filter((x) => x.best).map((x) => x.kind) : []);
    const drawn = myTurn ? S.drawn : null;
    const rest = me.hand.filter((id) => id !== drawn).sort((a, b) => a - b);
    const handTile = (id) => tileHtml(E.kindOf(id), {
      size: 'lg', button: true, id,
      extra: (bestKinds.has(E.kindOf(id)) ? 'is-best' : '') + (id === drawn ? ' is-drawn' : ''),
    });
    $('myHand').innerHTML = rest.map(handTile).join('') + (drawn !== null ? '<span class="mj-gap"></span>' + handTile(drawn) : '');
    $('myHand').classList.toggle('is-active', myTurn);
    for (const b of $('myHand').querySelectorAll('button')) b.disabled = !myTurn;

    renderMessage(myTurn);
    renderHint(myTurn, advice);
    renderActions(myTurn);
    lastShownRev = S.rev;
  }

  function renderMessage(myTurn) {
    let text = '';
    const L = S.log[S.log.length - 1];
    if (S.phase === 'claim' && S.pending[ME] && !S.pending[ME].answer) {
      text = NAMES[S.last.seat] + ' が ' + E.kindName(E.kindOf(S.last.id)) + ' を捨てました。どうする？';
    } else if (myTurn) {
      const called = L && (L.t === 'pon' || L.t === 'chi') && L.seat === ME;
      text = called ? '組を見せました。いらない牌を1枚押して捨てよう。' : 'あなたの番。いらない牌を1枚押して捨てよう。';
    } else if (S.phase !== 'end') {
      if (L && (L.t === 'pon' || L.t === 'chi')) text = NAMES[L.seat] + ' が' + (L.t === 'pon' ? 'ポン' : 'チー') + 'しました。';
      else text = NAMES[S.turn] + ' の番です。';
    }
    $('msg').textContent = text;
  }

  function renderHint(myTurn, advice) {
    const box = $('hintLine');
    if (!cfg.hint || S.phase === 'end') { box.innerHTML = ''; return; }
    let html = '';
    if (myTurn) {
      if (E.canTsumo(S, ME)) html = '<b>そろいました！</b>「ツモ」であがれます。';
      else if (advice) {
        const after = advice.shanten;
        html = (after === 0 ? '<span class="mj-dot"></span>のついた牌を捨てると、<b>あと1枚</b>であがれる形（テンパイ）。'
          : '<span class="mj-dot"></span>のついた牌を捨てると、あがりまで<b>あと' + (after + 1) + '枚</b>。');
      }
    } else {
      const ws = E.handWaits(S, ME);
      if (ws.length) {
        html = '<span class="mj-hint__label">待ち</span>' + ws.map((k) => tileHtml(k, { size: 'sm' })).join('') + '<span class="mj-hint__label">が来たらあがり</span>';
      } else {
        const sh = E.handShanten(S, ME);
        html = 'あがりまで<b>あと' + (sh + 1) + '枚</b>';
      }
    }
    // 文だけのときは1つの塊にして、句点だけが次の行に回らないようにする
    box.innerHTML = html.indexOf('mj-tile') >= 0 ? html : '<span>' + html + '</span>';
  }

  function renderActions(myTurn) {
    const box = $('actions');
    const btns = [];
    if (myTurn && E.canTsumo(S, ME)) {
      btns.push('<button type="button" class="btn btn-primary btn-lg" data-act="tsumo">ツモ（あがる）</button>');
    }
    if (S.phase === 'claim' && S.pending[ME] && !S.pending[ME].answer) {
      const o = S.pending[ME].options;
      const k = E.kindOf(S.last.id);
      if (o.ron) btns.push('<button type="button" class="btn btn-primary btn-lg" data-act="ron">ロン（あがる）</button>');
      o.pon.forEach((p, i) => btns.push(callButton('pon', i, 'ポン', p, k)));
      o.chi.forEach((p, i) => btns.push(callButton('chi', i, 'チー', p, k)));
      btns.push('<button type="button" class="btn btn-secondary btn-lg" data-act="pass">パス</button>');
    }
    box.innerHTML = btns.join('');
  }
  function callButton(type, i, label, pair, k) {
    const kinds = pair.map(E.kindOf).concat([k]).sort((a, b) => a - b);
    const tiles = kinds.map((kk) => tileHtml(kk, { size: 'xs', caption: false })).join('');
    return '<button type="button" class="btn btn-secondary btn-lg mj-callbtn" data-act="' + type + '" data-i="' + i + '">' + label + '<span class="mj-callbtn__tiles">' + tiles + '</span></button>';
  }

  // ── すすめる ──
  function apply(seat, a) {
    S = E.act(S, seat, a);
  }

  function step() {
    clearTimeout(timer);
    if (S.phase === 'end') { render(); showResult(); return; }
    if (S.phase === 'claim') {
      // コンピューターはすぐ答える。自分の答えが要るなら待つ
      for (const seat of E.waitingFor(S)) {
        if (seat !== ME && S.phase === 'claim') apply(seat, E.cpuAction(S, seat));
      }
      if (S.phase === 'claim') { render(); return; }
      render();
      timer = setTimeout(step, AFTER_DISCARD);
      return;
    }
    render();
    if (S.turn === ME) return;
    timer = setTimeout(() => {
      apply(S.turn, E.cpuAction(S, S.turn));
      render();
      timer = setTimeout(step, S.phase === 'discard' ? 0 : AFTER_DISCARD);
    }, CPU_DELAY);
  }

  function onHand(e) {
    const b = e.target.closest('button[data-id]');
    if (!b || !S || S.phase !== 'discard' || S.turn !== ME) return;
    apply(ME, { type: 'discard', id: Number(b.dataset.id) });
    render();
    timer = setTimeout(step, AFTER_DISCARD);
  }

  function onAction(e) {
    const b = e.target.closest('button[data-act]');
    if (!b || !S) return;
    const t = b.dataset.act;
    if (t === 'tsumo') apply(ME, { type: 'tsumo' });
    else if (t === 'pon' || t === 'chi') apply(ME, { type: t, tiles: S.pending[ME].options[t][Number(b.dataset.i)] });
    else apply(ME, { type: t });
    step();
  }

  // ── 結果 ──
  function showResult() {
    const R = S.result;
    const hand = $('resultHand');
    if (R.type === 'draw') {
      $('resultTitle').textContent = '引き分け';
      $('resultSub').textContent = '山がなくなったよ。';
      hand.innerHTML = '';
    } else {
      wins[R.winner] += 1;
      $('resultTitle').textContent = R.winner === ME ? 'あがり！' : NAMES[R.winner] + ' のあがり';
      $('resultSub').textContent = R.type === 'tsumo' ? 'ツモ（自分で引いた牌でそろった）'
        : 'ロン（' + NAMES[R.from] + ' の捨てた牌でそろった）';
      let marked = false;
      const winK = E.kindOf(R.tile);
      const groups = (R.shape ? R.shape.groups : []).map((g) => '<span class="mj-group">' + g.kinds.map((k) => {
        const mark = !marked && k === winK;
        if (mark) marked = true;
        return tileHtml(k, { size: 'md', extra: mark ? 'is-win' : '' });
      }).join('') + '</span>').join('');
      hand.innerHTML = groups + meldsHtml(R.winner, 'md');
    }
    render();
    $('result').hidden = false;
    $('btnNext').focus();
  }

  // ── はじめる ──
  function readCfg() {
    return {
      calls: $('optCalls').checked,
      chiitoi: $('optPairs').checked,
      hint: $('optHint').checked,
      names: $('optNames').checked,
      level: document.querySelector('input[name="level"]:checked').value,
    };
  }

  function newRound() {
    $('result').hidden = true;
    roundNo += 1;
    const seed = Math.floor(Math.random() * 2147483647);
    S = E.createRound({
      seed, dealer: (roundNo - 1) % 4,
      seats: NAMES.map((name, i) => ({ name, cpu: i !== ME })),
      calls: cfg.calls, chiitoi: cfg.chiitoi, level: cfg.level,
    });
    lastShownRev = -1;
    step();
  }

  function show(id) {
    for (const s of document.querySelectorAll('.mj-screen')) s.classList.toggle('active', s.id === id);
    window.scrollTo(0, 0);
  }

  $('btnStart').addEventListener('click', () => {
    cfg = readCfg();
    wins = [0, 0, 0, 0];
    roundNo = 0;
    show('screen-game');
    newRound();
  });
  $('btnNext').addEventListener('click', newRound);
  $('btnQuit').addEventListener('click', () => {
    clearTimeout(timer);
    S = null;
    $('result').hidden = true;
    show('screen-top');
  });
  $('myHand').addEventListener('click', onHand);
  $('actions').addEventListener('click', onAction);

  // トップの飾り
  $('hero').innerHTML = [27, 31, 32, 33, 13, 22].map((k) => '<span class="mj-tile mj-tile--md">' + A.face(k) + '</span>').join('');
})();

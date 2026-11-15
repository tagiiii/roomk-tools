import { shuffle } from '../shared/js/utils.js';
// なにするルーレット（スタッフ向け。仕様と理由は AGENTS.md）
// ①このコマのプログラム → ②どう過ごしたい？ → ③遊びを決める（ゲームを選んでルーレット）。
// 進行役が押して数を足し、えらばれた数に比例した大きさのマスのルーレットで決める（多数決にしない）。
// だれが何をえらんだかは出さない。保存もしない。
// ゲームはツール一覧（apps/index.html）のカードを読む（1対1向け・作戦会議だけの道具はのぞく）。プログラムはサークルタイムの毎朝のデータを読む。
(() => {
  const GAMES = [];          // ツール一覧から読む（loadGames）

  const COLORS = ['#F2B35C','#9CC8D3','#E8907B','#9FCFB4','#C4A9D6','#B9C27A','#E7C98F','#F0A8B8','#8FC1E3','#D9B38C'];
  const TOPICS = [
    'いまの気分を天気でいうと？', 'さいきん、ちょっとうれしかったこと', 'いま食べたいもの', 'さいきんハマっているもの',
    '行ってみたい場所', '好きな季節とそのわけ', 'いまの元気を色でいうと？', 'さいきん見た動画やアニメ',
    '動物になれるなら何になる？', '好きなおにぎりの具', 'もらってうれしいもの', '超能力を1つもらえるなら？',
    '好きなお菓子', 'ちょっと自慢したいもの', 'いま聞いている曲', '好きな飲みもの',
    'もし1日だけ何でもできるなら？', '好きなキャラクター', 'さいきん買ってよかったもの', '朝ごはんに食べたいもの',
  ];
  const DAILY = '../circle-time/daily/';
  // ツール一覧に載っていても、ここで選ぶものではないもの（ゲームの前にテーマを紹介する道具）
  const GAME_EXCLUDE = ['kotoba-theme'];
  const SUGOSHI = [
    { k:'self',  n:'自分のことをする', ic:'edit_note',     c:'#9CC8D3' },
    { k:'play',  n:'みんなと遊ぶ',     ic:'sports_esports', c:'#F2B35C' },
    { k:'talk',  n:'テーマトーク',     ic:'forum',          c:'#E8907B' },
    { k:'radio', n:'ラジオ参加',       ic:'radio',          c:'#C4A9D6' },
    { k:'any',   n:'おまかせ',         ic:'thumb_up',       c:'#9FCFB4' },
    { k:'think', n:'考え中',           ic:'hourglass_empty', c:'#E7C98F' },
  ];
  const MAX_CANDS = 8;
  const APPS = '../';

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SVGNS = $('wheelSvg').namespaceURI;
  const byId = {};

  let votes = {};             // id → 数（進行役が押した数＋端末で選んだ数。えらばれた順を保つ）
  let manualVotes = {}, guestVotes = {};   // 進行役が押した数／参加する人が端末で選んだ数
  let manualSg = {}, guestSg = {};
  let sgVotes = {};           // 過ごし方の数（進行役が押した数＋端末で選んだ数）
  let lastShown = null;       // 参加する人の画面に出す、決まったもの { id, n }
  function sumOf(a, b){ const o = { ...a }; Object.keys(b).forEach(k => { o[k] = (o[k] || 0) + b[k]; }); Object.keys(o).forEach(k => { if (!(o[k] > 0)) delete o[k]; }); return o; }
  function recount(){ votes = sumOf(manualVotes, guestVotes); sgVotes = sumOf(manualSg, guestSg); }
  let people = 5;
  let cands = [];             // 画面に出す候補（8つまで）
  let topicIdx = Math.floor(Math.random() * TOPICS.length);
  let excluded = new Set();   // ルーレットから外したもの（凡例を押す）
  let flow = [];              // 決まったもの
  let segs = [];              // いまのマス
  let omakase = [];           // だれもえらんでいないときのマス
  let rot = 0, spinning = false, lastWon = null;
  const colorOf = {}; let colorN = 0;
  function color(id){ if (!colorOf[id]) colorOf[id] = COLORS[colorN++ % COLORS.length]; return colorOf[id]; }

  function fit(){ const s = Math.min(innerWidth/1600, innerHeight/900); stage.style.transform = `translate(-50%,-50%) scale(${s})`; }
  addEventListener('resize', fit); fit();

  let idleT;
  function wake(){ document.body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add('idle'), 2500); }
  ['mousemove','mousedown','keydown','touchstart'].forEach(e => addEventListener(e, wake, { passive:true })); wake();

  // ───── 聞く画面 ─────
  function showTopic(anim){
    document.querySelectorAll('[data-topic]').forEach(el => {
      el.textContent = TOPICS[topicIdx];
      if (anim){ el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    });
    if (anim) pushAll();
  }
  const fits = (g) => people >= g.min && people <= g.max;
  function fillCands(){
    // えらばれているもの・さがして入れたものは残し、空いたところをその人数で遊べるゲームからランダムに埋める
    cands = cands.filter(id => votes[id] > 0 || fits(byId[id]));
    const pool = shuffle(GAMES.filter(g => fits(g) && !cands.includes(g.id)).map(g => g.id));
    while (cands.length < MAX_CANDS && pool.length) cands.push(pool.pop());
  }
  function reshuffle(){
    // えらばれていない候補だけを入れかえる（えらばれたものは同じ番号のまま）
    const keep = cands.map(id => votes[id] > 0 ? id : null);
    const pool = shuffle(GAMES.filter(g => fits(g) && !cands.includes(g.id)).map(g => g.id));
    cands = keep.map(id => id || pool.pop()).filter(Boolean);
    fillCands(); renderGrid();
  }
  function addCand(id, quiet){
    if (cands.includes(id)) return;
    if (cands.length >= MAX_CANDS){
      // えらばれていない候補のうち、いちばん後ろのものと入れかえる
      let k = -1; for (let i = cands.length - 1; i >= 0; i--) if (!votes[cands[i]]) { k = i; break; }
      if (k < 0) return;
      cands[k] = id;
    } else cands.push(id);
    if (!quiet) renderGrid();
  }
  function removeCand(id){ cands = cands.filter(x => x !== id); delete manualVotes[id]; recount(); renderGrid(); }
  function renderGrid(){
    $('countText').textContent = `${people}人で遊べるゲームから`;
    const box = $('grid'); box.textContent = '';
    cands.forEach((id, k) => {
      const g = byId[id];
      const b = document.createElement('button'); b.type = 'button'; b.className = 'gm paper'; b.dataset.genre = g.g; b.dataset.id = id;
      b.setAttribute('aria-label', `${k + 1} ${g.n}（押すと1つ足す・右クリックで1つ減らす）`);
      const num = document.createElement('span'); num.className = 'num'; num.textContent = k + 1;
      const img = document.createElement('img'); img.src = `${APPS}assets/illustrations/${id}.webp`; img.alt = ''; img.width = 150; img.height = 150;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = g.n;
      const tok = document.createElement('span'); tok.className = 'tokens';
      const x = document.createElement('span'); x.className = 'rm ms'; x.textContent = 'close'; x.title = '候補から外す';
      x.addEventListener('click', (e) => { e.stopPropagation(); removeCand(id); });
      b.append(num, img, nm, tok, x);
      b.addEventListener('click', (e) => addVote(id, e.shiftKey ? -1 : 1));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); addVote(id, -1); });
      box.appendChild(b);
    });
    renderTokens();
    pushAll();
  }
  function renderTokens(){
    document.querySelectorAll('#grid .gm').forEach(card => {
      const n = votes[card.dataset.id] || 0, tok = card.querySelector('.tokens');
      card.classList.toggle('has', n > 0);
      const want = Math.min(n, 6);
      tok.querySelectorAll('.more').forEach(m => m.remove());
      while (tok.children.length > want) tok.lastChild.remove();
      while (tok.children.length < want){ const d = document.createElement('span'); d.className = 'tok'; tok.appendChild(d); }
      if (n > 6){ const m = document.createElement('span'); m.className = 'more'; m.textContent = `+${n - 6}`; tok.appendChild(m); }
    });
    const ul = $('pickedList'); ul.textContent = '';
    const ids = Object.keys(votes).filter(id => votes[id] > 0);
    ids.forEach(id => {
      const li = document.createElement('li'); li.style.setProperty('--c', color(id));
      const sw = document.createElement('span'); sw.className = 'sw';
      const t = document.createElement('span'); t.className = 't'; t.textContent = byId[id].n;
      const dots = document.createElement('span'); dots.className = 'dots';
      for (let i = 0; i < Math.min(votes[id], 8); i++) dots.appendChild(document.createElement('i'));
      li.append(sw, t, dots); ul.appendChild(li);
    });
    $('pickedEmpty').style.display = ids.length ? 'none' : '';
  }
  function addVote(id, d){
    // 進行役が押した分だけを増やす・減らす（端末で選んだ分は、その子が取り消す）
    const n = Math.max(0, Math.min(12, (manualVotes[id] || 0) + d));
    if (n) manualVotes[id] = n; else delete manualVotes[id];
    recount(); renderTokens(); pushAll();
  }
  function voteByNumber(no){ const id = cands[no - 1]; if (id) addVote(id, 1); }

  // ───── ルーレット ─────
  const short = (n) => n.length > 9 ? n.slice(0, 8) + '…' : n;
  function entries(){
    const ids = Object.keys(votes).filter(id => votes[id] > 0);
    if (ids.length) return ids.map(id => ({ key:id, name:byId[id].n, label:short(byId[id].n), c:color(id), w:votes[id] }));
    // だれもえらんでいないときは、候補を同じ大きさで
    if (!omakase.length){
      const pool = cands.slice();
      for (let i = pool.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      omakase = pool.slice(0, 8);
    }
    return omakase.map(id => ({ key:id, name:byId[id].n, label:short(byId[id].n), c:color(id), w:1 }));
  }
  function activeEntries(){ return entries().filter(e => !excluded.has(e.key)); }

  function buildWheel(){
    const list = activeEntries();
    const total = list.reduce((s, e) => s + e.w, 0) || 1;
    const g = $('wheelG'); g.textContent = '';
    segs = []; let a = 0;
    const R = 340;
    list.forEach(e => {
      const span = 360 * e.w / total, a0 = a, a1 = a + span; a = a1;
      segs.push({ ...e, a0, a1 });
      const path = document.createElementNS(SVGNS, 'path');
      if (list.length === 1){
        path.setAttribute('d', `M 0 ${-R} A ${R} ${R} 0 1 1 -0.01 ${-R} Z`);
      } else {
        const p0 = polar(R, a0), p1 = polar(R, a1);
        path.setAttribute('d', `M 0 0 L ${p0.x} ${p0.y} A ${R} ${R} 0 ${span > 180 ? 1 : 0} 1 ${p1.x} ${p1.y} Z`);
      }
      path.setAttribute('fill', e.c); path.setAttribute('stroke', '#FFFDF8'); path.setAttribute('stroke-width', '5');
      g.appendChild(path);
      const mid = (a0 + a1) / 2;
      const lg = document.createElementNS(SVGNS, 'g');
      lg.setAttribute('transform', `rotate(${mid})`);
      const fs = Math.max(14, Math.min(34, 222 / Math.max(4, e.label.length), span * 1.4));
      const tx = document.createElementNS(SVGNS, 'text');
      tx.setAttribute('x', 0); tx.setAttribute('y', -318); tx.setAttribute('writing-mode', 'tb'); tx.style.writingMode = 'vertical-rl';
      tx.setAttribute('font-family', "'Zen Maru Gothic','Noto Sans JP',sans-serif"); tx.setAttribute('font-weight', '900');
      tx.setAttribute('font-size', fs); tx.setAttribute('fill', '#3F362D');
      tx.textContent = e.label;
      lg.append(tx); g.appendChild(lg);
    });
    $('wheelG').setAttribute('transform', `rotate(${rot})`);
    buildLegend();
    const can = list.length > 0;
    $('hub').disabled = !can || spinning; $('btnSpin').disabled = !can || spinning;
  }
  function polar(r, deg){ const t = (deg - 90) * Math.PI / 180; return { x: +(r * Math.cos(t)).toFixed(2), y: +(r * Math.sin(t)).toFixed(2) }; }

  function buildLegend(){
    const box = $('legend'); box.textContent = '';
    const list = entries(), voted = list.some(e => e.w > 1) || Object.keys(votes).length > 0;
    list.forEach(e => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lg';
      if (excluded.has(e.key)) b.classList.add('off');
      if (lastWon === e.key && !spinning) b.classList.add('won');
      b.style.setProperty('--c', e.c);
      b.title = '押すとルーレットから外す／もどす';
      const sw = document.createElement('span'); sw.className = 'sw';
      b.append(sw, document.createTextNode(e.name));
      if (voted){
        const dots = document.createElement('span'); dots.className = 'dots';
        for (let i = 0; i < Math.min(e.w, 8); i++) dots.appendChild(document.createElement('i'));
        b.appendChild(dots);
      }
      b.addEventListener('click', () => {
        if (spinning) return;
        if (excluded.has(e.key)) excluded.delete(e.key); else excluded.add(e.key);
        buildWheel();
      });
      box.appendChild(b);
    });
    $('wheelTitle').textContent = 'ルーレットで決めよう';
    $('wheelLead').textContent = voted ? 'えらんでくれた数だけ、マスが大きくなるよ' : 'どれになるかな？';
    $('btnNext').disabled = !lastWon || spinning || activeEntries().filter(e => e.key !== lastWon).length === 0;
  }

  function renderFlow(){
    const ol = $('flowList'); ol.textContent = '';
    flow.forEach((f, i) => {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1;
      li.append(n, document.createTextNode(f.name)); ol.appendChild(li);
    });
    $('flowEmpty').style.display = flow.length ? 'none' : '';
  }

  // 縁の点（飾り。光らせない）
  (function makeBulbs(){
    const rim = $('rim'), N = 28;
    for (let i = 0; i < N; i++){
      const t = (i / N) * Math.PI * 2, b = document.createElement('span');
      b.className = 'bulb'; b.style.left = `${50 + 48.3 * Math.cos(t)}%`; b.style.top = `${50 + 48.3 * Math.sin(t)}%`;
      rim.appendChild(b);
    }
  })();

  function segAt(r){
    const a = ((-r) % 360 + 360) % 360;
    return segs.findIndex(s => a >= s.a0 && a < s.a1);
  }
  function spin(){
    if (spinning || !segs.length) return;
    if (segs.length === 1){ return finish(segs[0]); }
    spinning = true; lastWon = null;
    $('hub').disabled = true; $('btnSpin').disabled = true; $('btnNext').disabled = true;
    buildLegend();
    // 止まる場所はでたらめに選ぶ（マスの大きさに比例して当たりやすい）。境目ぎりぎりは避ける
    const target = Math.random() * 360;
    const idx = segs.findIndex(s => target >= s.a0 && target < s.a1);
    const s = segs[Math.max(0, idx)], m = (s.a1 - s.a0) * 0.12;
    const t = Math.min(s.a1 - m, Math.max(s.a0 + m, target));
    const r0 = rot, base = ((-t - r0) % 360 + 360) % 360;
    const r1 = r0 + 360 * (reduce ? 1 : 4) + base;
    const dur = reduce ? 1200 : 4000;
    const t0 = performance.now();
    let lastIdx = segAt(r0);
    const ptr = $('pointer');
    function frame(now){
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      rot = r0 + (r1 - r0) * e;
      $('wheelG').setAttribute('transform', `rotate(${rot})`);
      const i = segAt(rot);
      if (i !== lastIdx){ lastIdx = i; ptr.classList.remove('tick'); void ptr.offsetWidth; ptr.classList.add('tick'); }
      if (p < 1) requestAnimationFrame(frame);
      else { rot = r1 % 360; $('wheelG').setAttribute('transform', `rotate(${rot})`); spinning = false; finish(s); }
    }
    requestAnimationFrame(frame);
  }

  function finish(s){
    lastWon = s.key;
    flow.push({ key:s.key, name:s.name });
    renderFlow();
    $('resultKicker').textContent = flow.length === 1 ? 'この時間は、まず…' : `${flow.length}つめは…`;
    $('resultImg').src = `${APPS}assets/illustrations/${s.key}.webp`;
    $('resultName').textContent = s.name;
    $('resultOpen').href = `${APPS}${s.key}/`;
    lastShown = { id:s.key, n:s.name }; pushAll();
    $('result').classList.add('show');
    $('hub').disabled = false; $('btnSpin').disabled = false;
    buildLegend();
  }
  function closeResult(){ $('result').classList.remove('show'); }
  $('result').addEventListener('click', (e) => { if (!e.target.closest('#resultOpen')) closeResult(); });

  // ───── 画面の切りかえ ─────
  function go(view){
    closeResult();
    document.body.dataset.view = view;
    const st = { intro:'1', sugoshi:'2', ask:'3', wheel:'3' }[view];
    document.querySelectorAll('.steps .st').forEach(el => el.classList.toggle('on', el.dataset.st === st));
    if (view === 'wheel'){ omakase = []; excluded = new Set(flow.map(f => f.key)); lastWon = null; buildWheel(); }
    if (view !== 'wheel') lastShown = null;
    renderRoomBits(); pushAll();
  }
  function nextRound(){
    if (!lastWon) return;
    excluded.add(lastWon); lastWon = null; lastShown = null; closeResult(); buildWheel(); pushAll();
  }
  function resetAll(){
    if (spinning) return;
    manualVotes = {}; manualSg = {}; recount(); clearChoices('all'); lastShown = null; askVisited = false; flow = []; excluded = new Set(); lastWon = null; rot = 0; $('findInput').value = ''; renderFind(); cands = [];
    fillCands(); renderGrid(); renderSugoshi(); renderFlow(); go('intro');
  }
  function setPeople(n){ people = Math.max(1, Math.min(12, n)); $('pplText').textContent = `${people}人`; fillCands(); renderGrid(); }

  function nextTopic(){ topicIdx = (topicIdx + 1 + Math.floor(Math.random() * (TOPICS.length - 1))) % TOPICS.length; showTopic(true); }
  $('btnTopic').addEventListener('click', nextTopic);
  $('sTopic').addEventListener('click', nextTopic);

  // ───── 1. このコマのプログラム ─────
  const qs = new URLSearchParams(location.search);
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const fmtT = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const jst = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  const today = () => { const p = jst(new Date()); return `${p.year}-${p.month}-${p.day}`; };
  const DATE = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('date') || '') ? qs.get('date') : today();
  function nowMin(){
    const t = qs.get('t'); if (t && /^\d{1,2}:\d{2}$/.test(t)) return toMin(t);
    const p = jst(new Date()); return Number(p.hour) * 60 + Number(p.minute);
  }
  let slots = [], slotIdx = 0, programLoaded = false;
  async function loadProgram(){
    let prog = null;
    try { const r = await fetch(`${DAILY}${DATE}.program.json`, { cache:'no-store' }); if (r.ok) prog = await r.json(); } catch (e) { /* 無い日 */ }
    const items = (prog && Array.isArray(prog.items) ? prog.items : []).filter(it => it && it.start && it.end && it.name);
    const by = new Map();
    items.forEach(it => { if (!by.has(it.start)) by.set(it.start, []); by.get(it.start).push(it); });
    slots = [...by.entries()].sort((a, b) => toMin(a[0]) - toMin(b[0])).map(([st, its], i) => ({ koma: i + 1, start: toMin(st), end: Math.max(...its.map(x => toMin(x.end))), items: its }));
    // いまのコマ。はじまる15分前からはそのコマ、すべて終わったあとは最後のコマ
    const t = nowMin(), i = slots.findIndex(s => t < s.end && t >= s.start - 15), j = slots.findIndex(s => s.start > t);
    slotIdx = i >= 0 ? i : (j >= 0 ? j : Math.max(0, slots.length - 1));
    programLoaded = true; renderIntro();
  }
  function thumbEl(it){
    const none = () => { const d = document.createElement('div'); d.className = 'th none'; const ic = document.createElement('span'); ic.className = 'ms'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = 'event'; d.appendChild(ic); return d; };
    if (!(typeof it.thumb === 'string' && /^https:\/\//.test(it.thumb))) return none();
    // Notion の公開ページの画像を直接読む（リポジトリには写さない）。読めなければアイコン
    const img = document.createElement('img'); img.className = 'th'; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
    img.addEventListener('error', () => img.replaceWith(none()), { once:true });
    img.src = it.thumb; return img;
  }
  function renderIntro(){
    const s = slots[slotIdx], box = $('progs'); box.textContent = '';
    $('introNone').hidden = !programLoaded || !!s;
    if (!s){ $('introKoma').textContent = ''; $('introTime').textContent = ''; return; }
    $('introKoma').textContent = `${s.koma}コマ目`;
    $('introTime').textContent = `${fmtT(s.start)}〜${fmtT(s.end)}`;
    box.style.gridTemplateColumns = `repeat(${Math.min(Math.max(s.items.length, 3), 4)},1fr)`;
    s.items.forEach(it => {
      const d = document.createElement('div'); d.className = 'prog paper';
      const n = document.createElement('div'); n.className = 'pn'; n.textContent = it.name;
      d.append(thumbEl(it), n);
      if (it.place){ const pl = document.createElement('div'); pl.className = 'pp'; const ic = document.createElement('span'); ic.className = 'ms'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = 'meeting_room'; pl.append(ic, it.place); d.appendChild(pl); }
      box.appendChild(d);
    });
    $('kPrev').disabled = slotIdx <= 0; $('kNext').disabled = slotIdx >= slots.length - 1;
  }
  function moveSlot(d){ slotIdx = Math.max(0, Math.min(slots.length - 1, slotIdx + d)); renderIntro(); }
  $('kPrev').addEventListener('click', () => moveSlot(-1));
  $('kNext').addEventListener('click', () => moveSlot(1));

  // ───── 2. どう過ごしたい？（だれが選んだかは出さず、数だけ） ─────

  // ───── ツール一覧のゲームを読む ─────
  async function loadGames(){
    try {
      const html = await (await fetch(`${APPS}index.html`, { cache:'no-store' })).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('a.app-card').forEach(a => {
        const id = String(a.getAttribute('href') || '').replace(/\/$/, '');
        const name = a.querySelector('.app-card__name')?.textContent.trim() || '';
        const scenes = String(a.dataset.scenes || '').split(/\s+/).filter(Boolean);
        if (!id || id.includes('/') || !name || GAME_EXCLUDE.includes(id)) return;
        if (scenes.length && scenes.every(x => x === 'sakusen')) return;   // 作戦会議だけの道具
        // 人数のバッジ（group の印）。無いもの＝1対1向けはのぞく
        const badge = [...a.querySelectorAll('.meta-badge')].find(b => b.querySelector('.material-symbols-rounded')?.textContent.trim() === 'group');
        if (!badge) return;
        let t = badge.textContent.replace('group', '').trim().replace(/[〜～]/g, '~'), host = 0, min = 1, max = 99, m;
        if (t.startsWith('ホスト＋')){ host = 1; t = t.slice(4); }
        if ((m = t.match(/^(\d+)~(\d+)人/))){ min = +m[1] + host; max = +m[2] + host; }
        else if ((m = t.match(/^(\d+)人~/))) min = +m[1] + host;
        else if ((m = t.match(/^(\d+)人/))){ min = max = +m[1] + host; }
        const g = { id, n:name, g:a.dataset.genre || '', y:a.dataset.yomi || '', min, max };
        GAMES.push(g); byId[id] = g;
      });
    } catch (e) { /* 読めなければ候補なし */ }
    findIdx = GAMES.map(g => kana(g.n) + ' ' + kana(g.y));
    cands = []; fillCands(); renderGrid();
  }
  function renderSugoshi(){
    const box = $('sgGrid'); box.textContent = '';
    SUGOSHI.forEach((o, k) => {
      const n = sgVotes[o.k] || 0;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sg paper' + (n ? ' has' : '');
      b.setAttribute('aria-label', `${k + 1} ${o.n}（押すと1つ足す・右クリックで1つ減らす）`);
      const num = document.createElement('span'); num.className = 'num'; num.textContent = k + 1;
      const ic = document.createElement('span'); ic.className = 'ic'; ic.style.setProperty('--c', o.c);
      const ms = document.createElement('span'); ms.className = 'ms'; ms.setAttribute('aria-hidden', 'true'); ms.textContent = o.ic; ic.appendChild(ms);
      const lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = o.n;
      const tok = document.createElement('span'); tok.className = 'tokens';
      for (let i = 0; i < Math.min(n, 12); i++){ const d = document.createElement('span'); d.className = 'tok'; tok.appendChild(d); }
      b.append(num, ic, lb, tok);
      b.addEventListener('click', (e) => addSg(o.k, e.shiftKey ? -1 : 1));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); addSg(o.k, -1); });
      box.appendChild(b);
    });
  }
  function addSg(k, d){ const n = Math.max(0, Math.min(12, (manualSg[k] || 0) + d)); if (n) manualSg[k] = n; else delete manualSg[k]; recount(); renderSugoshi(); pushAll(); }
  $('sClear').addEventListener('click', () => { manualSg = {}; recount(); clearChoices('sg'); renderSugoshi(); pushAll(); });
  $('toSugoshi').addEventListener('click', () => go('sugoshi'));
  $('sBack').addEventListener('click', () => go('intro'));
  $('toAsk').addEventListener('click', toAsk);
  $('aBack').addEventListener('click', () => go('sugoshi'));
  let askVisited = false;
  function toAsk(){
    // はじめて来たとき: お題を新しくし、「みんなと遊ぶ」「おまかせ」の数に進行役1人を足した人数にする（帯で直せる）
    if (!askVisited){
      askVisited = true; nextTopic();
      const n = (sgVotes.play || 0) + (sgVotes.any || 0);
      if (n) setPeople(n + 1);
    }
    go('ask');
  }
  // ゲームをさがす：名前・読みの一部で探し、選ぶと候補に入って丸が1つ付く
  const kana = (t) => t.replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).toLowerCase().replace(/[\s・！!？?ー〜]/g, '');
  let findIdx = [];
  let findHits = [], findOn = 0;
  function renderFind(){
    const v = kana($('findInput').value.trim()), ul = $('findList'); ul.textContent = '';
    if (!v){ ul.hidden = true; findHits = []; return; }
    findHits = GAMES.filter((g, i) => findIdx[i].includes(v)).sort((a, b) => fits(b) - fits(a)).slice(0, 5);
    findOn = 0; ul.hidden = false;
    if (!findHits.length){ const li = document.createElement('li'); li.className = 'none'; li.textContent = '見つからなかったよ。ちがう言葉でさがしてみてね'; ul.appendChild(li); return; }
    findHits.forEach((g, k) => {
      const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.dataset.genre = g.g;
      if (k === findOn) b.classList.add('on');
      const img = document.createElement('img'); img.src = `${APPS}assets/illustrations/${g.id}.webp`; img.alt = ''; img.width = 56; img.height = 56;
      const fn = document.createElement('span'); fn.className = 'fn'; fn.textContent = g.n;
      const fp = document.createElement('span'); fp.className = 'fp';
      fp.textContent = g.max >= 99 ? `${g.min}人から` : (g.min === g.max ? `${g.min}人` : `${g.min}〜${g.max}人`);
      fn.appendChild(fp); b.append(img, fn);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => pickFound(g.id));
      li.appendChild(b); ul.appendChild(li);
    });
  }
  function pickFound(id){
    addCand(id);
    if (cands.includes(id)) addVote(id, 1);
    $('findInput').value = ''; renderFind(); $('findInput').blur();
  }
  $('findInput').addEventListener('input', renderFind);
  $('findInput').addEventListener('blur', () => setTimeout(() => { $('findList').hidden = true; }, 150));
  $('findInput').addEventListener('focus', renderFind);
  $('findInput').addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const bs = [...$('findList').querySelectorAll('button')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      if (!bs.length) return; e.preventDefault();
      findOn = (findOn + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length;
      bs.forEach((b, k) => b.classList.toggle('on', k === findOn));
    } else if (e.key === 'Enter'){ e.preventDefault(); if (findHits[findOn]) pickFound(findHits[findOn].id); }
    else if (e.key === 'Escape'){ $('findInput').value = ''; renderFind(); $('findInput').blur(); }
  });
  $('btnShuffle').addEventListener('click', reshuffle);
  $('pplMinus').addEventListener('click', () => setPeople(people - 1));
  $('pplPlus').addEventListener('click', () => setPeople(people + 1));
  $('btnClear').addEventListener('click', () => { manualVotes = {}; recount(); clearChoices('game'); renderTokens(); pushAll(); });
  $('btnToWheel').addEventListener('click', () => go('wheel'));
  $('btnBack').addEventListener('click', () => go('ask'));
  $('btnSpin').addEventListener('click', () => { closeResult(); spin(); });
  $('hub').addEventListener('click', () => { closeResult(); spin(); });
  $('btnNext').addEventListener('click', nextRound);
  $('btnReset').addEventListener('click', resetAll);
  $('btnFull').addEventListener('click', toggleFull);
  function toggleFull(){ if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); }


  // ═════ ルーム（子どもが自分の端末で 2・3段目を選ぶ。docs/development/rtdb.md の決まりどおり） ═════
  // 進行役の画面（この舞台）がホスト。参加する人は ?room= のリンクから入り、自分の端末で過ごし方とゲームを1つずつ選ぶ。
  // 共有画面には数（丸）だけを出し、だれが何を選んだかは出さない（一覧には「選んだ」印だけ）。
  // ルームがなくても、これまでどおり進行役が押して数を足せる（端末のない子・ルームを作らない日）。
  const DB_PREFIX = 'hirobaroulette_rooms';
  const SESSION_KEY = 'hirobaroulette_session';
  const ORPHAN_TTL_MS = 2 * 60 * 1000;
  const PRESENCE_RETRY_MS = 3000;
  const TX_RETRY_MAX = 3;
  const MAX_GUESTS = 12;
  const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
  const STATUS_OPEN = 'open';
  const HOST_NAME = '進行役';
  const R = {
    role: null, nickname: null, roomCode: null, roomRef: null, room: null, joinedAt: null,
    timerInterval: null, orphanTimer: null, orphanAt: null,
    connectedRef: null, connectedCallback: null, roomCallback: null, isConnected: false,
    presenceDirty: false, presenceAt: 0, leaving: false, busy: false,
    pushT: null, find: '',
  };
  let fb = null;   // { authReady, db }。ルームを使うときだけつなぐ（ひらいただけでは通信しない）
  function firebaseOn(){ if (!fb) fb = RoomkRTDB.initFirebase(firebase); return fb; }
  const uidNow = () => firebase.auth().currentUser?.uid || null;
  const ts = () => firebase.database.ServerValue.TIMESTAMP;
  const toast = (m, err = true) => RoomkRTDB.showToast(m, err);
  function validNickname(v){
    if (!v) return '名前を入れてね';
    if (v.length > 8) return '名前は8文字までにしてね';
    if (/[.#$\[\]\/\u0000-\u001f\u007f]/.test(v)) return '記号 . # $ [ ] / は使えません';
    if (v === HOST_NAME) return 'その名前は使えないよ。少し変えてみてね';
    return '';
  }
  const normalizeRoomCode = (raw) => String(raw || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  const roomCodeImeError = (code) => /[^\x00-\x7F]/.test(code)
    ? 'ルームコードはアルファベットと数字で入れてね。ひらがなになるときは、キーボードを英字に切り替えてね（「半角/全角」キー、Macは「英数」キー）' : '';
  const isExpired = (room) => RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
  async function removeExpired(ref, fallback){
    try { await ref.transaction((room) => { const cur = room || fallback; return cur && isExpired(cur) ? null : undefined; }, undefined, false); }
    catch (e) { console.warn('[hiroba-roulette] expired room cleanup failed', e); }
  }
  function warmRoomCache(ref){
    return new Promise((resolve, reject) => { const cb = (snap) => resolve({ snap, release: () => ref.off('value', cb) }); ref.on('value', cb, reject); });
  }
  async function transactRetry(ref, update){
    for (let attempt = 0; ; attempt++){
      try { return await ref.transaction(update); }
      catch (e){ if (e?.message !== 'disconnect' || attempt >= TX_RETRY_MAX) throw e; }
    }
  }
  async function waitAuth(){
    try { await firebaseOn().authReady; return true; }
    catch { toast('うまくつながらなかったよ。ページを読み直してね'); return false; }
  }
  function saveSession(){ try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role:R.role, nickname:R.nickname, roomCode:R.roomCode, uid:uidNow(), joinedAt:R.joinedAt })); } catch { /* 戻れないだけ */ } }
  function loadSession(){ try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; } }
  function clearSession(){ try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 何もしない */ } }
  const guestsOf = (room) => Object.entries(room?.players || {}).filter(([, p]) => p && !p.isHost).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));

  function cleanupRoom(){
    clearInterval(R.timerInterval); clearTimeout(R.orphanTimer); clearTimeout(R.pushT);
    if (R.roomRef && R.roomCallback) R.roomRef.off('value', R.roomCallback);
    if (R.connectedRef && R.connectedCallback) R.connectedRef.off('value', R.connectedCallback);
    if (R.roomRef) RoomkRTDB.cancelRoomOnDisconnect(R.roomRef);
    const wasHost = R.role === 'host';
    Object.assign(R, { role:null, nickname:null, roomCode:null, roomRef:null, room:null, joinedAt:null, timerInterval:null, orphanTimer:null, orphanAt:null,
      connectedRef:null, connectedCallback:null, roomCallback:null, isConnected:false, presenceDirty:false, presenceAt:0, leaving:false, pushT:null });
    clearSession();
    if (wasHost){ guestVotes = {}; guestSg = {}; recount(); renderTokens(); renderSugoshi(); renderRoomBits(); }
    $('hostOffOverlay').hidden = true;
  }
  function leaveLocally(message, isError = true){
    const guest = R.role === 'guest';
    cleanupRoom();
    if (guest) showGuestJoin();
    if (message) toast(message, isError);
  }

  function connectToRoom(role, nickname, code, ref, joinedAt){
    if (R.roomRef) cleanupRoom();
    Object.assign(R, { role, nickname, roomCode:code, roomRef:ref, joinedAt:Number(joinedAt) || RoomkRTDB.now() });
    saveSession();
    if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);
    R.roomCallback = (snap) => {
      if (R.roomRef !== ref || R.leaving) return;
      if (!snap.exists()){ leaveLocally(role === 'host' ? 'ルームが閉じられました' : 'ルームが閉じられたよ', false); return; }
      const room = snap.val();
      if (isExpired(room)){ removeExpired(ref, room); leaveLocally('このルームは終わったみたい'); return; }
      R.room = room;
      handleRoom(room);
    };
    ref.on('value', R.roomCallback, (e) => { console.warn('[hiroba-roulette] room listener failed', e); toast('ルームの読み込みに失敗しました'); });
    R.connectedRef = fb.db.ref('.info/connected');
    R.connectedCallback = (snap) => {
      R.isConnected = snap.val() === true;
      if (R.isConnected && R.roomRef === ref){ R.presenceDirty = true; ensurePresence(true); }
    };
    R.connectedRef.on('value', R.connectedCallback);
    R.timerInterval = setInterval(() => { if (R.room && needsPresence(R.room)) ensurePresence(); }, 1000);
    if (role === 'host'){ renderRoomBits(); pushAll(); }
  }
  function needsPresence(room){
    if (R.role === 'host') return room.hostConnected === false;
    if (R.role === 'guest') return !room.players?.[R.nickname];
    return false;
  }
  async function ensurePresence(force = false){
    const ref = R.roomRef;
    if (!ref || R.leaving || !R.isConnected || !R.room) return;
    if (!force && Date.now() - R.presenceAt < PRESENCE_RETRY_MS) return;
    R.presenceDirty = false; R.presenceAt = Date.now();
    const uid = uidNow();
    try {
      if (R.role === 'host'){
        await ref.onDisconnect().update({ hostConnected:false, hostDisconnectedAt:ts() });
        const room = R.room;
        if (room.hostUid === uid && !isExpired(room) && !(room.hostConnected === true && room.hostDisconnectedAt == null)){
          await ref.update({ hostConnected:true, hostDisconnectedAt:null });
        }
      } else if (R.role === 'guest'){
        const nick = R.nickname, joinedAt = R.joinedAt;
        await ref.child('players/' + nick).onDisconnect().remove();
        const room = R.room;
        let full = false, taken = false;
        if (!isExpired(room) && !room.players?.[nick]){
          if (guestsOf(room).length >= MAX_GUESTS) full = true;
          else {
            const result = await ref.child('players/' + nick).transaction((cur) => (cur ? undefined : { uid, joinedAt }));
            if (!result.committed && result.snapshot.val()?.uid !== uid) taken = true;
          }
        }
        if ((full || taken) && R.roomRef === ref && !R.leaving){
          await RoomkRTDB.cancelRoomOnDisconnect(ref);
          leaveLocally(full ? 'このルームはいっぱいだよ' : '同じ名前の人がいるので、ルームから外れました。名前を変えて入りなおしてね');
        }
      }
    } catch (e){
      console.warn('[hiroba-roulette] presence recovery failed', e);
      if (force) toast('再接続に失敗しました。ページを読み直してね');
    }
  }

  // ───── 進行役（ホスト） ─────
  async function createRoom(){
    if (R.busy || R.roomRef) return;
    R.busy = true; $('btnRoom').disabled = true;
    try {
      if (!await waitAuth()) return;
      const uid = uidNow(), joinedAt = RoomkRTDB.now();
      for (let attempt = 0; attempt < 5; attempt++){
        const code = RoomkRTDB.generateRoomCode();
        const ref = fb.db.ref(DB_PREFIX + '/' + code);
        const result = await transactRetry(ref, (room) => {
          if (room) return room.hostUid === uid && room.createdBy === joinedAt ? room : undefined;
          return { status:STATUS_OPEN, host:HOST_NAME, hostUid:uid, hostConnected:true, hostDisconnectedAt:null, createdAt:ts(), createdBy:joinedAt, ...roomSnapshot() };
        });
        if (result.committed){
          window.RoomkStats?.count('room-create');
          connectToRoom('host', HOST_NAME, code, ref, joinedAt);
          toast('ルームを作りました。リンクかQRコードで、子どもに入ってもらってね', false);
          return;
        }
      }
      toast('ルームを作れませんでした。もう一度ためしてね');
    } catch (e){
      console.warn('[hiroba-roulette] create failed', e);
      toast('接続できませんでした。もう一度ためしてね');
    } finally { R.busy = false; $('btnRoom').disabled = false; }
  }
  // 参加する人の画面に要るもの（いまの段・お題・候補・決まったもの）と、進行役が押した数
  function roomSnapshot(){
    return {
      view: document.body.dataset.view || 'intro',
      topic: TOPICS[topicIdx],
      cands: cands.filter(id => byId[id]).map(id => ({ id, n:byId[id].n, g:byId[id].g || '' })),
      result: lastShown || null,
      manual: { sg: { ...manualSg }, game: { ...manualVotes } },
    };
  }
  // 進行役の画面が変わったら、ルームに書く（まとめて1回）
  function pushAll(){
    if (R.role !== 'host' || !R.roomRef) return;
    clearTimeout(R.pushT);
    R.pushT = setTimeout(() => {
      if (R.role !== 'host' || !R.roomRef) return;
      R.roomRef.update(roomSnapshot()).catch((e) => console.warn('[hiroba-roulette] sync failed', e));
    }, 120);
  }
  // 参加する人が選んだものを消す（「えらんだ数を消す」「はじめから」）
  function clearChoices(which){
    if (R.role !== 'host' || !R.roomRef || !R.room) return;
    const up = {};
    guestsOf(R.room).forEach(([nick]) => {
      if (which !== 'game') up['players/' + nick + '/sg'] = null;
      if (which !== 'sg') up['players/' + nick + '/game'] = null;
    });
    if (Object.keys(up).length) R.roomRef.update(up).catch((e) => console.warn('[hiroba-roulette] clear failed', e));
  }
  async function closeRoom(){
    if (R.role !== 'host' || !R.roomRef || R.busy) return;
    if (!window.confirm('ルームを閉じると、参加している人の画面も終わります。閉じますか？')) return;
    const ref = R.roomRef;
    R.busy = true; R.leaving = true;
    try { await RoomkRTDB.cancelRoomOnDisconnect(ref); await ref.remove(); }
    catch (e){ console.warn('[hiroba-roulette] close failed', e); toast('閉じられませんでした。もう一度ためしてね'); R.leaving = false; R.busy = false; ensurePresence(true); return; }
    R.busy = false;
    leaveLocally('ルームを閉じました', false);
  }
  function hostRoom(room){
    // 参加する人の選んだものを数える（名前は出さない）
    const gv = {}, gs = {};
    guestsOf(room).forEach(([, p]) => {
      if (typeof p.sg === 'string' && SUGOSHI.some(o => o.k === p.sg)) gs[p.sg] = (gs[p.sg] || 0) + 1;
      if (typeof p.game === 'string' && byId[p.game]) gv[p.game] = (gv[p.game] || 0) + 1;
    });
    guestVotes = gv; guestSg = gs; recount();
    // 候補にないゲームを選んだ子がいたら、候補に入れる（いっぱいなら、えらばれていない候補と入れかえ）
    let changed = false;
    Object.keys(gv).forEach(id => { if (!cands.includes(id)){ const before = cands.join(); addCand(id, true); if (cands.join() !== before) changed = true; } });
    if (changed) renderGrid(); else renderTokens();
    renderSugoshi();
    if (document.body.dataset.view === 'wheel' && !spinning) buildWheel();
    renderRoomBits();
  }
  function renderRoomBits(){
    const on = R.role === 'host' && !!R.roomCode;
    document.body.classList.toggle('has-room', on);
    const box = $('members'); box.textContent = '';
    if (!on){ $('roomChipCode').textContent = ''; return; }
    const guests = guestsOf(R.room);
    $('roomChipCode').textContent = R.roomCode;
    $('roomChipCount').textContent = `・${guests.length}人`;
    const key = document.body.dataset.view === 'sugoshi' ? 'sg' : 'game';
    guests.forEach(([nick, p]) => {
      const done = typeof p[key] === 'string' && !!p[key];
      const s = document.createElement('span'); s.className = 'mb' + (done ? ' done' : '');
      const ic = document.createElement('span'); ic.className = 'ms'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = done ? 'check_circle' : 'radio_button_unchecked';
      s.append(ic, nick);
      s.setAttribute('aria-label', nick + (done ? ' えらんだ' : ' まだ'));
      box.appendChild(s);
    });
  }
  async function reconnectHost(saved){
    if (R.busy || R.roomRef) return false;
    R.busy = true;
    let release = null;
    try {
      if (!await waitAuth()) return false;
      const uid = uidNow();
      if (!uid || uid !== saved.uid) return false;
      const ref = fb.db.ref(DB_PREFIX + '/' + saved.roomCode);
      const warm = await warmRoomCache(ref); release = warm.release;
      const room = warm.snap.val();
      if (!room) return false;
      if (isExpired(room)){ await removeExpired(ref, room); return false; }
      if (room.hostUid !== uid) return false;
      // 進行役が押した数・段・お題・候補をルームからもどす
      manualSg = { ...(room.manual?.sg || {}) }; manualVotes = { ...(room.manual?.game || {}) };
      const ti = TOPICS.indexOf(room.topic); if (ti >= 0){ topicIdx = ti; showTopic(false); }
      const rc = Array.isArray(room.cands) ? room.cands.map(c => c && c.id).filter(id => byId[id]) : [];
      if (rc.length){ cands = rc; }
      lastShown = room.result || null;
      connectToRoom('host', HOST_NAME, saved.roomCode, ref, saved.joinedAt);
      if (['intro', 'sugoshi', 'ask', 'wheel'].includes(room.view)){ if (room.view !== 'intro') askVisited = true; go(room.view); }
      renderGrid(); renderSugoshi();
      return true;
    } catch (e){ console.warn('[hiroba-roulette] host reconnect failed', e); return false; }
    finally { release?.(); R.busy = false; }
  }

  // ───── 参加する人（自分の端末） ─────
  function showGuestJoin(){
    $('guJoin').hidden = false; $('guRoom').hidden = true; $('guRoom').textContent = '';
    $('guCode').hidden = true; $('guMe').textContent = ''; $('btnGuLeave').hidden = true;
    $('guestName').focus({ preventScroll:true });
  }
  async function joinRoom(){
    if (R.busy || R.roomRef) return;
    const nick = $('guestName').value.trim();
    const code = normalizeRoomCode($('joinCode').value);
    const err = validNickname(nick);
    if (err) return RoomkRTDB.showFormError('joinError', err);
    const ime = roomCodeImeError(code);
    if (ime) return RoomkRTDB.showFormError('joinError', ime);
    if (!ROOM_CODE_PATTERN.test(code)) return RoomkRTDB.showFormError('joinError', 'ルームコードは6文字で入れてね');
    RoomkRTDB.showFormError('joinError', '');
    R.busy = true; $('btnJoinRoom').disabled = true;
    let release = null;
    const fail = (m) => RoomkRTDB.showFormError('joinError', m);
    try {
      if (!await waitAuth()) return;
      const ref = fb.db.ref(DB_PREFIX + '/' + code);
      const warm = await warmRoomCache(ref); release = warm.release;
      const room = warm.snap.val();
      if (!room) return fail('ルームが見つからないよ。コードを確かめてね');
      if (isExpired(room)){ await removeExpired(ref, room); return fail('このルームは終わったみたい'); }
      const uid = uidNow(), joinedAt = RoomkRTDB.now();
      const stale = room.players?.[nick];
      const mine = !!stale && stale.uid === uid;
      if (stale && !mine) return fail('その名前は使われているよ。少し変えてみてね');
      if (!mine && guestsOf(room).length >= MAX_GUESTS) return fail('このルームはいっぱいだよ');
      const at = mine ? Number(stale.joinedAt) || joinedAt : joinedAt;
      const result = await transactRetry(ref.child('players/' + nick), (cur) => (cur && cur.uid !== uid ? undefined : { ...(cur || {}), uid, joinedAt:at }));
      if (!result.committed) return fail('その名前は使われているよ。少し変えてみてね');
      const after = (await ref.get()).val();
      if (!after || !after.status){ await ref.child('players/' + nick).remove(); return fail('このルームは終わったみたい'); }
      connectToRoom('guest', nick, code, ref, at);
    } catch (e){
      console.warn('[hiroba-roulette] join failed', e);
      fail('接続できませんでした。もう一度ためしてね');
    } finally { release?.(); R.busy = false; $('btnJoinRoom').disabled = false; }
  }
  async function reconnectGuest(saved){
    if (R.busy || R.roomRef) return false;
    R.busy = true;
    let release = null;
    try {
      if (!await waitAuth()) return false;
      const uid = uidNow();
      if (!uid || uid !== saved.uid || validNickname(saved.nickname)) return false;
      const ref = fb.db.ref(DB_PREFIX + '/' + saved.roomCode);
      const warm = await warmRoomCache(ref); release = warm.release;
      const room = warm.snap.val();
      if (!room) return false;
      if (isExpired(room)){ await removeExpired(ref, room); return false; }
      const p = room.players?.[saved.nickname];
      if (p && p.uid !== uid) return false;
      connectToRoom('guest', saved.nickname, saved.roomCode, ref, p ? Number(p.joinedAt) || saved.joinedAt : saved.joinedAt);
      return true;
    } catch (e){ console.warn('[hiroba-roulette] reconnect failed', e); return false; }
    finally { release?.(); R.busy = false; }
  }
  async function leaveGuest(){
    if (R.role !== 'guest' || !R.roomRef || R.busy) return;
    const ref = R.roomRef, nick = R.nickname, uid = uidNow();
    R.busy = true; R.leaving = true;
    try {
      await RoomkRTDB.cancelRoomOnDisconnect(ref);
      await ref.child('players/' + nick).transaction((cur) => (cur && cur.uid === uid ? null : undefined));
    } catch (e){
      console.warn('[hiroba-roulette] leave failed', e);
      toast('退出できませんでした。もう一度ためしてね');
      R.leaving = false; R.busy = false; ensurePresence(true); return;
    }
    R.busy = false;
    leaveLocally('');
  }
  function choose(field, value){
    if (R.role !== 'guest' || !R.roomRef) return;
    const me = R.room?.players?.[R.nickname];
    const next = me && me[field] === value ? null : value;   // もう一度押すと取り消し
    R.roomRef.child('players/' + R.nickname + '/' + field).set(next).catch((e) => { console.warn('[hiroba-roulette] choose failed', e); toast('送れませんでした。もう一度押してね'); });
  }
  function handleRoom(room){
    if (R.role === 'guest'){
      const me = room.players?.[R.nickname];
      if (me && me.uid !== uidNow()){ leaveLocally('同じ名前の人が参加したので、ルームから外れました'); return; }
    }
    if (R.presenceDirty) ensurePresence(true);
    else if (needsPresence(room)) ensurePresence();
    if (R.role === 'host') hostRoom(room);
    else { updateHostOverlay(room); renderGuest(room); }
  }
  function updateHostOverlay(room){
    if (room.hostConnected === false){
      $('hostOffOverlay').hidden = false;
      if (R.orphanTimer && R.orphanAt !== RoomkRTDB.getHostDisconnectedAt(room)){ clearTimeout(R.orphanTimer); R.orphanTimer = null; }
      if (!R.orphanTimer){
        R.orphanAt = RoomkRTDB.getHostDisconnectedAt(room);
        const ref = R.roomRef, at = R.orphanAt;
        const delay = at == null ? ORPHAN_TTL_MS : Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now());
        R.orphanTimer = setTimeout(() => { R.orphanTimer = null; if (R.roomRef === ref && R.room) removeExpired(ref, R.room); }, delay);
      }
    } else {
      $('hostOffOverlay').hidden = true;
      clearTimeout(R.orphanTimer); R.orphanTimer = null;
    }
  }
  function gEl(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function gIcon(name){ const e = gEl('span', 'ms', name); e.setAttribute('aria-hidden', 'true'); return e; }
  function gameOpt(g, pressed, num){
    const b = gEl('button', 'gu-opt'); b.type = 'button'; b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    if (num) b.appendChild(gEl('span', 'num', num));
    const img = gEl('img'); img.src = `${APPS}assets/illustrations/${g.id}.webp`; img.alt = ''; img.width = 52; img.height = 52; img.loading = 'lazy';
    img.addEventListener('error', () => img.remove(), { once:true });
    b.append(img, gEl('span', null, g.n));
    b.addEventListener('click', () => { choose('game', g.id); R.find = ''; });
    return b;
  }
  let guestKey = '';
  function renderGuest(room){
    $('guJoin').hidden = true; $('guRoom').hidden = false;
    $('guCode').hidden = false; $('guCodeText').textContent = R.roomCode; $('guMe').textContent = R.nickname; $('btnGuLeave').hidden = false;
    const me = room.players?.[R.nickname] || {};
    const view = room.view;
    // 検索の欄に打っている途中は、作りなおさない（同じ段・同じ選択のまま、候補が変わっただけのとき）
    const key = JSON.stringify([view, room.topic, me.sg, me.game, (room.cands || []).map(c => c && c.id), room.result && room.result.id]);
    if (key === guestKey) return;
    const active = document.activeElement && document.activeElement.id === 'guFind';
    guestKey = key;
    const box = $('guRoom'); box.textContent = '';
    const topicCard = () => { const c = gEl('section', 'gu-card'); const t = gEl('div', 'gu-topic'); t.append(gIcon('chat_bubble'), gEl('span', null, 'ひとことのお題：' + (room.topic || ''))); c.appendChild(t); return c; };
    if (view === 'sugoshi'){
      box.appendChild(topicCard());
      const c = gEl('section', 'gu-card');
      c.append(gEl('h2', 'gu-h', 'この時間、どう過ごしたい？'), gEl('p', 'gu-lead', '決まっていたら、1つ押してね。もう一度押すと取り消せるよ'));
      const grid = gEl('div', 'gu-opts');
      SUGOSHI.forEach((o, k) => {
        const b = gEl('button', 'gu-opt'); b.type = 'button'; b.setAttribute('aria-pressed', me.sg === o.k ? 'true' : 'false');
        const ic = gEl('span', 'ic'); ic.style.setProperty('--c', o.c); ic.appendChild(gIcon(o.ic));
        b.append(gEl('span', 'num', String(k + 1)), ic, gEl('span', null, o.n));
        b.addEventListener('click', () => choose('sg', o.k));
        grid.appendChild(b);
      });
      c.appendChild(grid);
      box.appendChild(c);
    } else if (view === 'ask'){
      box.appendChild(topicCard());
      const c = gEl('section', 'gu-card');
      c.append(gEl('h2', 'gu-h', '遊びたいゲームはどれ？'), gEl('p', 'gu-lead', '1つ押してね。ほかに遊びたいゲームがあったら、下でさがせるよ'));
      const grid = gEl('div', 'gu-opts games');
      const list = (Array.isArray(room.cands) ? room.cands : []).filter(x => x && x.id);
      list.forEach((g, k) => grid.appendChild(gameOpt(g, me.game === g.id, String(k + 1))));
      c.appendChild(grid);
      if (me.game && !list.some(g => g.id === me.game)){
        const g = byId[me.game];
        c.appendChild(Object.assign(gEl('div', 'gu-picked'), {}));
        c.lastChild.append(gIcon('check_circle'), gEl('span', null, 'えらんだゲーム：' + (g ? g.n : me.game)));
      }
      const f = gEl('label', 'gu-find'); f.appendChild(gIcon('search'));
      const input = gEl('input'); input.id = 'guFind'; input.type = 'text'; input.maxLength = 20; input.placeholder = 'ゲームをさがす'; input.setAttribute('aria-label', 'ゲームをさがす'); input.autocomplete = 'off'; input.value = R.find;
      f.appendChild(input); c.appendChild(f);
      const hits = gEl('div', 'gu-hits gu-opts games'); c.appendChild(hits);
      const showHits = () => {
        hits.textContent = '';
        const v = kana(input.value.trim()); R.find = input.value;
        if (!v) return;
        const found = GAMES.filter((g, i) => findIdx[i].includes(v)).slice(0, 6);
        if (!found.length){ hits.appendChild(gEl('p', 'gu-lead', '見つからなかったよ。ちがう言葉でさがしてみてね')); return; }
        found.forEach(g => hits.appendChild(gameOpt(g, me.game === g.id)));
      };
      input.addEventListener('input', showHits);
      showHits();
      box.appendChild(c);
      if (active){ input.focus({ preventScroll:true }); input.setSelectionRange(input.value.length, input.value.length); }
    } else if (view === 'wheel'){
      const c = gEl('section', 'gu-card gu-wait');
      if (room.result && room.result.id){
        c.classList.add('gu-result');
        const img = gEl('img'); img.src = `${APPS}assets/illustrations/${room.result.id}.webp`; img.alt = ''; img.width = 140; img.height = 140;
        img.addEventListener('error', () => img.remove(), { once:true });
        c.append(gEl('p', 'gu-lead', '決まり！'), img, gEl('div', 'nm', room.result.n || ''), gEl('p', 'gu-lead', '見てるだけ・途中からでもOK'));
      } else {
        c.append(gIcon('casino'), gEl('h2', 'gu-h', 'ルーレットで決めるよ'), gEl('p', 'gu-lead', '画面共有を見てね'));
      }
      box.appendChild(c);
    } else {
      const c = gEl('section', 'gu-card gu-wait');
      c.append(gIcon('event'), gEl('h2', 'gu-h', 'この時間のプログラムを見ているよ'), gEl('p', 'gu-lead', '画面共有を見てね。このあと、ここで選べるようになるよ'));
      box.appendChild(c);
    }
  }
  function submitOnEnter(input, handler){
    input.addEventListener('keydown', (e) => { if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; e.preventDefault(); handler(); });
  }

  // ───── ボタン ─────
  $('btnRoom').addEventListener('click', createRoom);
  $('btnCloseRoom').addEventListener('click', closeRoom);
  $('btnCopyCode').addEventListener('click', (e) => RoomkRTDB.copyRoomCode(R.roomCode, e.currentTarget));
  $('btnCopyLink').addEventListener('click', (e) => { if (!R.roomCode) return toast('ルームコードがありません'); RoomkRTDB.copyRoomLink(R.roomCode, e.currentTarget); });
  $('btnShowQr').addEventListener('click', () => { if (!R.roomCode) return toast('ルームコードがありません'); RoomkQR.show(R.roomCode); });
  $('btnJoinRoom').addEventListener('click', joinRoom);
  submitOnEnter($('guestName'), joinRoom);
  submitOnEnter($('joinCode'), joinRoom);
  $('btnGuLeave').addEventListener('click', leaveGuest);
  $('btnOverlayLeave').addEventListener('click', leaveGuest);

  addEventListener('keydown', (e) => {
    if (document.body.classList.contains('guest-mode')) return;
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.howto-overlay:not([hidden]), dialog[open]')) return;
    const view = document.body.dataset.view;
    if (view === 'intro' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')){ moveSlot(e.key === 'ArrowLeft' ? -1 : 1); e.preventDefault(); return; }
    if (view === 'intro' && e.key === 'Enter'){ go('sugoshi'); e.preventDefault(); return; }
    if (view === 'sugoshi' && /^Digit[1-6]$|^Numpad[1-6]$/.test(e.code)){ addSg(SUGOSHI[+e.code.slice(-1) - 1].k, e.shiftKey ? -1 : 1); e.preventDefault(); return; }
    if (view === 'sugoshi' && (e.key === 't' || e.key === 'T')){ nextTopic(); return; }
    if (view === 'sugoshi' && e.key === 'Enter'){ toAsk(); e.preventDefault(); return; }
    if (view === 'ask' && /^Digit[1-9]$|^Numpad[1-9]$/.test(e.code)){ const id = cands[+e.code.slice(-1) - 1]; if (id) addVote(id, e.shiftKey ? -1 : 1); e.preventDefault(); return; }
    if (e.key === 'f' || e.key === 'F'){ toggleFull(); return; }
    if (view === 'ask' && (e.key === 't' || e.key === 'T')){ $('btnTopic').click(); return; }
    if (view === 'ask' && e.key === 'Enter'){ go('wheel'); e.preventDefault(); return; }
    if (view === 'wheel' && e.key === ' '){ closeResult(); spin(); e.preventDefault(); return; }
    if (view === 'wheel' && e.key === 'Escape'){ closeResult(); return; }
  });

  // ───── はじめ ─────
  const startParams = new URLSearchParams(location.search);
  const roomParam = startParams.get('room');
  const saved = loadSession();
  const guestStart = roomParam !== null || startParams.has('join') || saved?.role === 'guest';
  if (guestStart){
    // 参加する人の画面（自分の端末）。進行役の舞台は出さない
    document.body.classList.add('guest-mode');
    $('guest').hidden = false;
    loadGames();
    const code = roomParam !== null ? normalizeRoomCode(roomParam) : '';
    const openJoin = (c) => { showGuestJoin(); if (c){ $('joinCode').value = c; $('joinLinkHint').hidden = false; } };
    if (roomParam !== null && !ROOM_CODE_PATTERN.test(code)){
      toast('ルームコードが正しくないよ'); history.replaceState(null, '', location.pathname);
      if (saved?.role === 'guest') reconnectGuest(saved).then(ok => { if (!ok && !R.roomRef){ clearSession(); openJoin(''); } });
      else openJoin('');
    } else if (saved?.role === 'guest' && (!code || saved.roomCode === code)){
      showGuestJoin(); $('guJoin').hidden = true;
      reconnectGuest(saved).then(ok => { if (!ok && !R.roomRef){ clearSession(); openJoin(code || ''); } });
    } else {
      if (saved) clearSession();
      openJoin(code);
    }
  } else {
    showTopic(false); setPeople(people); renderFlow(); renderSugoshi(); go('intro');
    loadProgram();
    // 進行役がルームの途中で読み込み直したときは、同じルームへ戻る（ゲームの一覧を読んでから）
    loadGames().then(() => {
      if (saved?.role === 'host' && ROOM_CODE_PATTERN.test(saved.roomCode || '')) reconnectHost(saved).then(ok => { if (!ok && !R.roomRef) clearSession(); });
    });
  }
})();

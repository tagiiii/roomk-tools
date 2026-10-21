// ぴったりビート: 上から落ちてくるしるしが線に来たらたたく、リズムあそび。決まり（譜面・判定・点数・順位）は engine.js。
// 時間は音の時計（AudioContext）を基準にし、「いま耳に届いている音の位置」に合わせてしるしを動かし、判定する。
// 判定は各自の端末の中だけで行い、ルーム（Realtime Database）に送るのは、いちばんよい点数と「遊んでいる」の印だけ。
import {
  COURSES, TRACKS, JUDGE, TRAVEL, COUNT_IN_BEATS, CALIB_BPM, CALIB_BEATS,
  buildChart, createState, hit, sweepMisses, score, estimateOffset, clampOffset, rankPlayers,
} from './engine.js?v=20261021a';

const $ = (id) => document.getElementById(id);
const SHAPES = ['maru', 'hishi'];
const LANE_NAMES = ['まる', 'ひしがた'];
const COLORS = {
  maru: '#E8833A', hishi: '#2E8C9C',
  laneBg: ['#FDF1E7', '#E7F3F5'],
  line: '#1C3F5E', hit: '#F2B705',
};
const KEYS_LEFT = new Set(['KeyF', 'KeyD', 'KeyS', 'ArrowLeft']);
const KEYS_RIGHT = new Set(['KeyJ', 'KeyK', 'KeyL', 'ArrowRight']);
const STORE = {
  course: 'pittari-beat:course', track: 'pittari-beat:track',
  volume: 'pittari-beat:volume', offset: 'pittari-beat:offset',
};

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function save(key, v) {
  try { localStorage.setItem(key, String(v)); } catch (e) { /* 残せなくても遊べる */ }
}

const courseOf = (id) => COURSES.find((c) => c.id === id) || COURSES[0];
const trackOf = (id) => TRACKS.find((t) => t.id === id) || TRACKS[1];
const settingText = (courseId, trackId) => courseOf(courseId).label + 'コース／曲：' + trackOf(trackId).label;

const prefs = {
  course: courseOf(load(STORE.course, 'easy')).id,
  track: trackOf(load(STORE.track, 'mid')).id,
  volume: (() => { const v = parseInt(load(STORE.volume, '60'), 10); return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 60; })(),
  offset: clampOffset(parseFloat(load(STORE.offset, '0'))),
};

// ── 画面の切りかえ ─────────────────────────────
const SCREENS = ['pb-top', 'pb-solo', 'pb-create', 'pb-host', 'pb-join', 'pb-guest', 'pb-play', 'pb-result', 'pb-calib'];
let current = null;
function show(id) {
  SCREENS.forEach((s) => { $(s).hidden = s !== id; });
  current = id;
  document.body.classList.toggle('pb-playing', id === 'pb-play');
  window.scrollTo(0, 0);
}

function toast(text, isError = false) { RoomkRTDB.showToast(text, isError); }

function fmtOffset(v) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(2); }
function renderOffset() {
  document.querySelectorAll('[data-offset-now]').forEach((e) => { e.textContent = fmtOffset(prefs.offset); });
  $('pb-offset-value').textContent = fmtOffset(prefs.offset);
}
function setOffset(v) {
  prefs.offset = clampOffset(v);
  save(STORE.offset, prefs.offset);
  renderOffset();
}

// コースと曲の選択肢（ひとりで遊ぶ・ルームを作る・コースと曲を変える で使う）
function renderChoices(courseBox, trackBox, sel, onChange) {
  courseBox.textContent = '';
  COURSES.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pb-choice';
    b.setAttribute('aria-pressed', String(c.id === sel.course));
    const main = document.createElement('span');
    main.className = 'pb-choice__main';
    main.textContent = c.label;
    const sub = document.createElement('span');
    sub.className = 'pb-choice__sub';
    sub.textContent = c.note;
    b.append(main, sub);
    b.addEventListener('click', () => { sel.course = c.id; onChange(); renderChoices(courseBox, trackBox, sel, onChange); });
    courseBox.appendChild(b);
  });
  trackBox.textContent = '';
  TRACKS.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pb-choice pb-choice--small';
    b.setAttribute('aria-pressed', String(t.id === sel.track));
    b.textContent = t.label;
    b.addEventListener('click', () => { sel.track = t.id; onChange(); renderChoices(courseBox, trackBox, sel, onChange); });
    trackBox.appendChild(b);
  });
}

// 音の大きさ（同じつまみを、いくつかの画面に置く）
function buildVolumes() {
  document.querySelectorAll('[data-volume]').forEach((box, i) => {
    box.textContent = '';
    const down = document.createElement('span');
    down.className = 'material-symbols-rounded';
    down.setAttribute('aria-hidden', 'true');
    down.textContent = 'volume_down';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '5';
    input.value = String(prefs.volume);
    input.setAttribute('aria-label', '音の大きさ');
    input.id = 'pb-volume-' + i;
    const up = down.cloneNode();
    up.textContent = 'volume_up';
    input.addEventListener('input', () => {
      prefs.volume = parseInt(input.value, 10) || 0;
      save(STORE.volume, prefs.volume);
      document.querySelectorAll('[data-volume] input').forEach((o) => { if (o !== input) o.value = input.value; });
      if (master) master.gain.setTargetAtTime(gainFor(prefs.volume), ac.currentTime, 0.02);
    });
    box.append(down, input, up);
  });
}

// ── 音 ─────────────────────────────────────
let ac = null;
let master = null;
let noiseBuf = null;

function gainFor(vol) { return Math.pow(vol / 100, 2) * 0.9; }

function ensureAudio() {
  if (!ac) {
    // iPhone のマナーモードでも鳴るようにする（対応しているブラウザだけ）
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* なくてもよい */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = new AC({ latencyHint: 'interactive' });
    master = ac.createGain();
    master.gain.value = gainFor(prefs.volume);
    master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.2), ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'running') return Promise.resolve();
  const resumed = ac.resume().catch(() => {});
  return Promise.race([resumed, new Promise((r) => setTimeout(r, 1500))]);
}

// 曲のファイル（ElevenLabs で作った曲）。一度読んだら覚えておく
const buffers = new Map();
function loadMusic(file) {
  if (!buffers.has(file)) {
    const p = fetch(file)
      .then((r) => { if (!r.ok) throw new Error('music ' + r.status); return r.arrayBuffer(); })
      .then((b) => new Promise((resolve, reject) => ac.decodeAudioData(b, resolve, reject)));
    p.catch(() => buffers.delete(file));
    buffers.set(file, p);
  }
  return buffers.get(file);
}

function env(g, when, peak, decay) {
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
}
function kick(dest, when, level) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, when);
  o.frequency.exponentialRampToValueAtTime(50, when + 0.12);
  env(g, when, level, 0.22);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(when + 0.25);
}
function clap(dest, when, level) {
  const s = ac.createBufferSource();
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  s.buffer = noiseBuf;
  f.type = 'bandpass';
  f.frequency.value = 1800;
  f.Q.value = 0.8;
  env(g, when, level, 0.1);
  s.connect(f).connect(g).connect(dest);
  s.start(when);
  s.stop(when + 0.12);
}
function tick(dest, when, freq, level) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  env(g, when, level, 0.06);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(when + 0.08);
}

// 曲のファイルがない曲（engine.js の TRACKS で music なし）のときだけ鳴らす、仮の手拍子。
// カウント4拍のあと、1・3拍目に低い音、2・4拍目に手拍子、裏拍に小さな音。
function playSlot(dest, slot, when, lastSlot) {
  const countSlots = COUNT_IN_BEATS * 2;
  if (slot < countSlots) {
    if (slot % 2 === 0) tick(dest, when, slot === 0 ? 1320 : 990, 0.3);
    return;
  }
  const s = (slot - countSlots) % 8;
  if (s === 0 || s === 4) kick(dest, when, 0.8);
  if (slot === lastSlot) return;
  if (s === 2 || s === 6) clap(dest, when, 0.35);
  if (s % 2 === 1) tick(dest, when, 2400, 0.05);
}

// ── 音の時計と画面の時計の対応 ───────────────────────
// clockOffset ＝ いま耳に届いている音の位置（音の時計の秒）− performance.now() の秒
let clockOffset = null;
function updateClock() {
  if (!ac) return;
  const perfNow = performance.now();
  let est = null;
  if (typeof ac.getOutputTimestamp === 'function') {
    const ts = ac.getOutputTimestamp();
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) est = ts.contextTime - ts.performanceTime / 1000;
  }
  if (est === null) est = ac.currentTime - (ac.outputLatency || ac.baseLatency || 0) - perfNow / 1000;
  if (clockOffset === null || Math.abs(est - clockOffset) > 0.05) clockOffset = est;
  else clockOffset += (est - clockOffset) * 0.05;
}
function heardAt(perfMs) { return perfMs / 1000 + (clockOffset || 0); }

// キーやタッチのイベントの時刻（たたいた瞬間）。おかしな値ならいまの時刻を使う。
function eventTime(e) {
  const now = performance.now();
  const ts = e && e.timeStamp;
  return ts > 0 && ts <= now + 5 && now - ts < 1000 ? ts : now;
}

// ── 遊ぶ ───────────────────────────────────
// mode: 'solo'（ひとりで）／'guest'（ルームの参加者。点数をランキングへ送る）／'demo'（進行役のお手本。送らない）
let run = null;
let lastPlay = null;
const cv = $('pb-canvas');
const ctx = cv.getContext('2d');
let W = 0;
let H = 0;

function songNow(perfMs) { return heardAt(perfMs) - run.songStart - prefs.offset; }

function layoutPads(lanes) {
  const box = $('pb-pads');
  box.textContent = '';
  box.classList.toggle('pb-pads--one', lanes === 1);
  const judges = $('pb-judges');
  judges.textContent = '';
  for (let i = 0; i < lanes; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pb-pad pb-pad--' + SHAPES[i];
    b.dataset.lane = String(i);
    const name = lanes === 1 ? 'たたく' : LANE_NAMES[i];
    b.setAttribute('aria-label', name);
    const shape = document.createElement('span');
    shape.className = 'pb-shape pb-shape--' + SHAPES[i];
    shape.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'pb-pad__label';
    label.textContent = name;
    b.append(shape, label);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); tap(i, eventTime(e)); });
    box.appendChild(b);
    const j = document.createElement('span');
    j.className = 'pb-judge';
    j.style.left = ((i + 0.5) / lanes * 100) + '%';
    judges.appendChild(j);
  }
  $('pb-keys').textContent = lanes === 1
    ? 'キーボード：F か J（どちらでもOK）'
    : 'キーボード：まる＝F　ひしがた＝J';
}

function resizeCanvas() {
  const r = $('pb-stage').getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = r.width;
  H = r.height;
  cv.width = Math.max(1, Math.round(W * dpr));
  cv.height = Math.max(1, Math.round(H * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (run && run.paused) draw(run.pausedPos);
}
new ResizeObserver(resizeCanvas).observe($('pb-stage'));

function startRun(opts) {
  stopCalib();
  lastPlay = opts;
  const track = trackOf(opts.track);
  const course = courseOf(opts.course);
  const chart = buildChart(track, course.id);
  const win = JUDGE[course.id];
  const last = chart.notes[chart.notes.length - 1];
  const me = {
    mode: opts.mode, version: opts.version,
    chart, win, track, course,
    lanes: course.lanes,
    state: createState(chart),
    lastSlot: Math.round(chart.musicEnd / chart.eighth),
    endT: Math.max(last.t + win.good + 1.0, chart.musicEnd + 0.6),
    seg: null, timer: 0, raf: 0, source: null, buffer: null,
    songStart: 0, nextSlot: 0,
    paused: true, resuming: true, pausedPos: 0, finished: false,
    effects: [], shownScore: -1, shownCombo: -1,
  };
  if (run) stopRun();
  run = me;
  layoutPads(me.lanes);
  $('pb-pause-layer').hidden = true;
  $('pb-count').textContent = 'よーい';
  $('pb-combo').hidden = true;
  $('pb-score').textContent = '0';
  $('pb-progress-fill').style.width = '0%';
  show('pb-play');
  resizeCanvas();
  window.RoomkStats?.count('play-' + track.id);
  if (me.mode === 'guest') setPlaying(true);
  ensureAudio()
    .then(() => (chart.music ? loadMusic(chart.music.file) : null))
    .then((buffer) => {
      if (run !== me) return;
      me.buffer = buffer;
      beginSegment(0, 0.4);
      me.raf = requestAnimationFrame(frame);
    })
    .catch(() => {
      if (run !== me) return;
      const mode = me.mode;
      stopRun();
      if (mode === 'guest') setPlaying(false);
      goBack(mode);
      toast('曲を読みこめなかったよ。もう一度ためしてね', true);
    });
}

function beginSegment(fromPos, delay) {
  run.seg = ac.createGain();
  run.seg.connect(master);
  run.songStart = ac.currentTime + delay - fromPos;
  run.nextSlot = Math.max(0, Math.ceil(fromPos / run.chart.eighth - 1e-6));
  clockOffset = null;
  updateClock();
  run.paused = false;
  run.resuming = false;
  if (run.buffer) {
    // 曲のファイル: fromPos 秒のところから鳴らす
    const src = ac.createBufferSource();
    src.buffer = run.buffer;
    src.connect(run.seg);
    src.start(ac.currentTime + delay, Math.max(0, fromPos));
    run.source = src;
    return;
  }
  schedule();
  run.timer = setInterval(schedule, 40);
}

function endSegment() {
  if (!run) return;
  clearInterval(run.timer);
  run.timer = 0;
  if (run.source) {
    try { run.source.stop(); } catch (e) { /* もう止まっている */ }
    run.source = null;
  }
  if (run.seg) {
    try { run.seg.disconnect(); } catch (e) { /* もう外れている */ }
    run.seg = null;
  }
}

function schedule() {
  if (!run || run.paused || !run.seg) return;
  const horizon = ac.currentTime + 0.25;
  while (run.nextSlot <= run.lastSlot) {
    const when = run.songStart + run.nextSlot * run.chart.eighth;
    if (when > horizon) break;
    if (when >= ac.currentTime - 0.005) playSlot(run.seg, run.nextSlot, Math.max(when, ac.currentTime), run.lastSlot);
    run.nextSlot++;
  }
}

function stopRun() {
  if (!run) return;
  endSegment();
  cancelAnimationFrame(run.raf);
  run.finished = true;
  run = null;
}

function frame() {
  if (!run || run.finished) return;
  run.raf = requestAnimationFrame(frame);
  if (run.paused) return;
  updateClock();
  const t = songNow(performance.now());
  sweepMisses(run.state, t, run.win);
  draw(t);
  updateHud(t);
  if (t > run.endT) finish();
}

function tap(lane, perfMs) {
  if (!run || run.paused || run.finished || !run.seg) return;
  const l = run.lanes === 1 ? 0 : lane;
  pressPad(l);
  updateClock();
  const r = hit(run.state, l, songNow(perfMs), run.win);
  if (!r || r.result === 'miss') return; // はずれは、だまって流す
  run.effects.push({ lane: l, t0: performance.now(), kind: r.result });
  showJudge(l, r.result);
  updateScore();
}

function pressPad(lane) {
  const pad = $('pb-pads').children[lane];
  if (!pad) return;
  pad.classList.remove('is-down');
  void pad.offsetWidth;
  pad.classList.add('is-down');
}

function showJudge(lane, kind) {
  const el = $('pb-judges').children[lane];
  if (!el) return;
  el.textContent = kind === 'perfect' ? 'ぴったり' : 'いいね';
  el.className = 'pb-judge pb-judge--' + kind;
  void el.offsetWidth;
  el.classList.add('is-show');
}

function updateScore() {
  const st = run.state;
  const sc = score(st);
  if (sc !== run.shownScore) { run.shownScore = sc; $('pb-score').textContent = String(sc); }
  if (st.combo !== run.shownCombo) {
    run.shownCombo = st.combo;
    $('pb-combo').hidden = st.combo < 5;
    $('pb-combo-num').textContent = String(st.combo);
  }
}

function updateHud(t) {
  updateScore();
  const c = run.chart;
  let count = '';
  // しるしが始まる前の3拍で「3・2・1」。それより前は「よーい」
  if (t < c.start) {
    const left = Math.floor((c.start - t) / c.beat);
    count = left >= 3 ? 'よーい' : ['1', '2', '3'][left];
  }
  const countEl = $('pb-count');
  if (countEl.textContent !== count) countEl.textContent = count;
  $('pb-progress-fill').style.width = (Math.min(1, Math.max(0, t / c.musicEnd)) * 100).toFixed(1) + '%';
}

// ── 描く（フラット: 丸とひし形） ─────────────────────
function shapePath(kind, x, y, r) {
  ctx.beginPath();
  if (kind === 'maru') ctx.arc(x, y, r, 0, Math.PI * 2);
  else {
    ctx.moveTo(x, y - r * 1.15);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r * 1.15);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  }
}

function drawNote(kind, x, y, r, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS[kind];
  shapePath(kind, x, y, r);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawTarget(kind, x, y, r) {
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLORS[kind];
  shapePath(kind, x, y, r + 4);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function draw(t) {
  if (!run) return;
  ctx.clearRect(0, 0, W, H);
  const lanes = run.lanes;
  const lw = W / lanes;
  const lineY = H - Math.max(40, Math.min(72, H * 0.13));
  const r = Math.max(14, Math.min(lw * 0.2, H * 0.075, 30));
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < lanes; i++) {
    ctx.fillStyle = COLORS.laneBg[i];
    ctx.fillRect(i * lw + (i ? 2 : 0), 0, lw - (lanes === 2 ? 2 : 0), H);
  }
  ctx.fillStyle = COLORS.line;
  ctx.fillRect(0, lineY - 3, W, 6);
  for (let i = 0; i < lanes; i++) drawTarget(SHAPES[i], (i + 0.5) * lw, lineY, r);

  const now = performance.now();
  run.effects = run.effects.filter((fx) => now - fx.t0 < 320);
  for (const fx of run.effects) {
    const age = (now - fx.t0) / 320;
    ctx.globalAlpha = 1 - age;
    ctx.lineWidth = 6;
    ctx.strokeStyle = COLORS.hit;
    ctx.beginPath();
    ctx.arc((fx.lane + 0.5) * lw, lineY, r * (1.4 + age * 1.0), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 高さがせまい画面（横向きのスマホなど）では、しるしどうしが重ならないように少し速く落とす
  const speed = Math.max((lineY + r * 1.2) / TRAVEL[run.course.id], 220);
  for (const n of run.state.notes) {
    const dt = n.t - t;
    if (lineY - dt * speed < -r * 2) break;
    if (n.result === 'perfect' || n.result === 'good') continue;
    let alpha = 1;
    if (n.result === 'miss') {
      alpha = 1 - (t - n.at) / 0.3;
      if (alpha <= 0) continue;
      alpha *= 0.5;
    }
    drawNote(SHAPES[n.lane], (n.lane + 0.5) * lw, lineY - dt * speed, r, alpha);
  }
}

// ── 止める・おわる ──────────────────────────────
function pause() {
  if (!run || run.paused || run.finished) return;
  updateClock();
  run.pausedPos = songNow(performance.now());
  run.paused = true;
  endSegment();
  $('pb-pause-layer').hidden = false;
  $('pb-resume').focus();
}

function resume() {
  if (!run || !run.paused || run.resuming || run.finished) return;
  const me = run;
  me.resuming = true;
  $('pb-pause-layer').hidden = true;
  ensureAudio().then(() => {
    if (run !== me || !me.paused) return;
    beginSegment(Math.max(0, me.pausedPos - 2), 0.5);
  });
}

function backScreen(mode) {
  if (mode === 'guest') return state.role === 'guest' ? 'pb-guest' : 'pb-top';
  if (mode === 'demo') return state.role === 'host' ? 'pb-host' : 'pb-top';
  return 'pb-solo';
}

function finish() {
  const me = run;
  sweepMisses(me.state, Infinity, me.win);
  const st = me.state;
  const sc = score(st);
  $('pb-result-title').textContent = me.mode === 'demo' ? 'お手本、おしまい' : 'おつかれさま！';
  $('pb-result-sub').textContent = settingText(me.course.id, me.track.id);
  $('pb-result-score').textContent = String(sc);
  $('pb-result-perfect').textContent = String(st.perfect);
  $('pb-result-good').textContent = String(st.good);
  $('pb-result-combo').textContent = String(st.maxCombo);
  const note = $('pb-result-room');
  note.hidden = true;
  if (me.mode === 'guest') {
    note.hidden = false;
    note.textContent = guestReport(me.version, sc);
  }
  stopRun();
  if (me.mode === 'guest') setPlaying(false);
  $('pb-again').hidden = (me.mode === 'guest' && state.role !== 'guest') || (me.mode === 'demo' && state.role !== 'host');
  show('pb-result');
  ($('pb-again').hidden ? $('pb-back') : $('pb-again')).focus();
}

function quit() {
  const mode = run ? run.mode : 'solo';
  stopRun();
  if (mode === 'guest') setPlaying(false);
  goBack(mode);
}

function goBack(mode) {
  const to = backScreen(mode);
  if (to === 'pb-guest') renderGuest();
  if (to === 'pb-host') renderHost();
  if (to === 'pb-top' && state.closedNote) { toast(state.closedNote); state.closedNote = null; }
  show(to);
}

// ── タイミング合わせ ────────────────────────────
let calib = null;
let calibReturn = 'pb-top';

function stopCalib() {
  if (!calib) return;
  clearTimeout(calib.timer);
  try { calib.seg.disconnect(); } catch (e) { /* もう外れている */ }
  calib = null;
  $('pb-calib-pad').disabled = true;
  $('pb-calib-pad').classList.remove('is-on');
}

function runCalib() {
  stopCalib();
  $('pb-calib-run').disabled = true;
  $('pb-calib-msg').textContent = '';
  ensureAudio().then(() => {
    if ($('pb-calib').hidden) { $('pb-calib-run').disabled = false; return; }
    const beat = 60 / CALIB_BPM;
    const seg = ac.createGain();
    seg.connect(master);
    const t0 = ac.currentTime + 0.6;
    const beats = [];
    for (let i = 0; i < CALIB_BEATS; i++) {
      kick(seg, t0 + i * beat, 0.6);
      clap(seg, t0 + i * beat, 0.35);
      beats.push(i * beat);
    }
    clockOffset = null;
    updateClock();
    calib = { seg, t0, beats, taps: [], timer: setTimeout(endCalib, (0.6 + CALIB_BEATS * beat + 0.5) * 1000) };
    const pad = $('pb-calib-pad');
    pad.disabled = false;
    pad.classList.add('is-on');
    $('pb-calib-pad-text').textContent = '音に合わせて、ここをたたく';
    pad.focus();
  });
}

function calibTap(perfMs) {
  if (!calib) return;
  updateClock();
  calib.taps.push(heardAt(perfMs) - calib.t0);
  $('pb-calib-msg').textContent = calib.taps.length + ' 回';
  const pad = $('pb-calib-pad');
  pad.classList.remove('is-down');
  void pad.offsetWidth;
  pad.classList.add('is-down');
}

function endCalib() {
  if (!calib) return;
  const v = estimateOffset(calib.taps, calib.beats);
  stopCalib();
  $('pb-calib-run').disabled = false;
  $('pb-calib-run-label').textContent = 'もう一度';
  $('pb-calib-pad-text').textContent = '「もう一度」で、やりなおせるよ';
  if (v === null) {
    $('pb-calib-msg').textContent = 'うまく数えられなかったよ。4回以上たたいて、もう一度やってみてね。';
    return;
  }
  setOffset(v);
  $('pb-calib-msg').textContent = 'ずれは ' + fmtOffset(prefs.offset) + ' 秒。この分を差し引いて数えるね。';
}

function openCalib() {
  calibReturn = current && current !== 'pb-calib' ? current : 'pb-top';
  $('pb-calib-msg').textContent = '';
  $('pb-calib-run-label').textContent = '音を鳴らす';
  $('pb-calib-pad-text').textContent = '「音を鳴らす」を押してね';
  $('pb-calib-run').disabled = false;
  renderOffset();
  show('pb-calib');
}

function closeCalib() {
  stopCalib();
  if (calibReturn === 'pb-guest' && state.role !== 'guest') calibReturn = 'pb-top';
  if (calibReturn === 'pb-host' && state.role !== 'host') calibReturn = 'pb-top';
  if (calibReturn === 'pb-guest') renderGuest();
  if (calibReturn === 'pb-top' && state.closedNote) { toast(state.closedNote); state.closedNote = null; }
  show(calibReturn);
}

function stopCalibIfRunning() {
  if (!calib) return;
  stopCalib();
  $('pb-calib-run').disabled = false;
  $('pb-calib-msg').textContent = 'とちゅうで止まったよ。もう一度やってみてね。';
}

// ── ルーム（Realtime Database） ─────────────────────
// pittari_beat_rooms/{code}:
//   status: 'open'、hostUid、hostConnected、hostDisconnectedAt、createdAt、course、track、version
//   players/{名前}: { uid, joinedAt, best, v }   … いちばんよい点数と、その点を出したコースの版（v）。切断しても消さない
//   online/{名前}:  { uid, playing }             … いまつながっているか。切断したら消える（「はなれている」と出す）
// コースと曲を変えたら version を1つ上げる。v が今の version と違う点はランキングに出さない（＝消えたのと同じ）。
const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'pittari_beat_rooms';
const SESSION_KEY = 'pittari_beat_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const NAME_MAX = 8;
const MAX_GUESTS = 30;
const STATUS = { OPEN: 'open' };

const state = {
  role: null,          // 'host' | 'guest'
  nickname: null,      // 参加者の名前（進行役は持たない）
  roomCode: null,
  roomRef: null,
  room: null,
  joinedAt: null,
  currentScreen: null,
  timerInterval: null,
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  isConnected: false,
  presenceAt: 0,
  leaving: false,
  busy: false,
  playing: false,      // 参加者: いま遊んでいるか（online/{名前}/playing に送る）
  myBest: null,        // 参加者: いまのコースでの自分のいちばん（ルームの点が低ければ送りなおす）
  myBestVersion: null,
  closedNote: null,
};

function currentUid() { return firebase.auth().currentUser?.uid || null; }
function serverTimestamp() { return firebase.database.ServerValue.TIMESTAMP; }
const cleanName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim();
const normCode = (s) => String(s || '').normalize('NFKC').replace(/\s/g, '').toUpperCase();

function isExpired(room) {
  // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
  return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
}

async function removeExpired(ref, fallback) {
  try {
    // 手元には反映しない（applyLocally:false）。消えたルームを古い値で表示し直さないため
    await ref.transaction((room) => {
      const cur = room || fallback;
      return cur && isExpired(cur) ? null : undefined;
    }, undefined, false);
  } catch (error) {
    console.warn('[pittari-beat] expired room cleanup failed', error);
  }
}

// transaction の最初の計算が空のキャッシュで走らないよう、先に値を購読しておく
function warmRoomCache(ref) {
  return new Promise((resolve, reject) => {
    const callback = (snap) => resolve({ snap, release: () => ref.off('value', callback) });
    ref.on('value', callback, reject);
  });
}

// 送信後に通信が切れて中止された transaction（'disconnect'）と、同じ端末の配下の書き込みで中止された
// transaction（'set'）は、やり直す（届いていたかは中で確かめる）
async function transactRetry(ref, update, applyLocally = true) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ref.transaction(update, undefined, applyLocally);
    } catch (error) {
      if (!['disconnect', 'set'].includes(error?.message) || attempt >= TX_RETRY_MAX) throw error;
    }
  }
}

async function waitAuth() {
  try {
    await authReady;
    return true;
  } catch {
    toast('うまくつながらなかったよ。ページを読み直してね', true);
    return false;
  }
}

function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      role: state.role, nickname: state.nickname, roomCode: state.roomCode, uid: currentUid(),
      joinedAt: state.joinedAt, myBest: state.myBest, myBestVersion: state.myBestVersion,
    }));
  } catch { /* 保存できないときは、再読み込みで戻れないだけ */ }
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 何もしない */ }
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  if (state.roomRef) RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
  Object.assign(state, {
    role: null, nickname: null, roomCode: null, roomRef: null, room: null, joinedAt: null,
    timerInterval: null, connectedRef: null, connectedCallback: null, roomCallback: null,
    isConnected: false, presenceAt: 0, leaving: false, playing: false,
    myBest: null, myBestVersion: null,
  });
  clearSession();
  $('pb-host-change').hidden = true;
  $('pb-host-change-open').hidden = false;
  $('pb-guest-offline').hidden = true;
}

// ルームから出て、はじめの画面へ。遊んでいる途中なら、おわってから知らせる
function leaveLocally(message) {
  const playingInRoom = run && (run.mode === 'guest' || run.mode === 'demo');
  cleanupRoom();
  if (playingInRoom) { state.closedNote = message || null; return; }
  if (current === 'pb-result') {
    if (message) { $('pb-result-room').hidden = false; $('pb-result-room').textContent = message; }
    $('pb-again').hidden = true;
    state.closedNote = null;
    return;
  }
  if (current === 'pb-calib') { calibReturn = 'pb-top'; state.closedNote = message || null; return; }
  show('pb-top');
  if (message) toast(message);
}

function connectToRoom(role, nickname, code, ref, joinedAt) {
  if (state.roomRef) cleanupRoom();
  state.role = role;
  state.nickname = nickname;
  state.roomCode = code;
  state.roomRef = ref;
  state.joinedAt = Number(joinedAt) || RoomkRTDB.now();
  saveSession();
  // 参加用のリンク（?room=コード）でひらいたときは、つないだあとにコードをアドレスから外す
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname + location.hash);

  state.roomCallback = (snap) => {
    if (state.roomRef !== ref || state.leaving) return;
    if (!snap.exists()) {
      leaveLocally('ルームは閉じられたよ');
      return;
    }
    const room = snap.val();
    if (isExpired(room)) {
      removeExpired(ref, room);
      leaveLocally('このルームは終わったみたい');
      return;
    }
    state.room = room;
    handleRoom(room);
  };
  ref.on('value', state.roomCallback, (error) => {
    console.warn('[pittari-beat] room listener failed', error);
    toast('ルームの読み込みに失敗しました', true);
  });

  state.connectedRef = db.ref('.info/connected');
  state.connectedCallback = (snap) => {
    state.isConnected = snap.val() === true;
    if (state.isConnected && state.roomRef === ref) ensurePresence(true);
  };
  state.connectedRef.on('value', state.connectedCallback);
  state.timerInterval = setInterval(tickRoom, 1000);
  if (role === 'host') { renderHost(); show('pb-host'); } else { renderGuest(); show('pb-guest'); }
}

function tickRoom() {
  if (state.room && needsPresence(state.room)) ensurePresence();
}

// 接続中なのに、ルームの上では切断・不在になっている
function needsPresence(room) {
  if (state.role === 'host') return room.hostConnected === false;
  if (state.role === 'guest') return !room.online?.[state.nickname] || !!room.online[state.nickname].playing !== state.playing;
  return false;
}

// 接続のたびに切断時の予約を張り直し、自分の在室を確かめる。
// 古い接続の切断予約が遅れて発火した場合も、ここで在室に戻す
async function ensurePresence(force = false) {
  const ref = state.roomRef;
  if (!ref || state.leaving || !state.isConnected || !state.room) return;
  if (!force && Date.now() - state.presenceAt < PRESENCE_RETRY_MS) return;
  state.presenceAt = Date.now();
  const role = state.role;
  const nickname = state.nickname;
  const uid = currentUid();
  try {
    if (role === 'host') {
      await ref.onDisconnect().update({ hostConnected: false, hostDisconnectedAt: serverTimestamp() });
      await transactRetry(ref, (room) => {
        if (!room || room.hostUid !== uid || isExpired(room)) return;
        if (room.hostConnected === true && room.hostDisconnectedAt == null) return;
        return { ...room, hostConnected: true, hostDisconnectedAt: null };
      });
    } else if (role === 'guest') {
      // 切れたら「つながっている」の印だけを消す（点数は消さない）
      await ref.child('online/' + nickname).onDisconnect().remove();
      const playing = state.playing;
      let gone = false;
      await transactRetry(ref, (room) => {
        gone = false;
        if (!room || isExpired(room)) return;
        if (room.players?.[nickname]?.uid !== uid) { gone = true; return; }
        const cur = room.online?.[nickname];
        if (cur && cur.uid === uid && !!cur.playing === playing) return;
        return { ...room, online: { ...(room.online || {}), [nickname]: { uid, playing } } };
      });
      if (gone && state.roomRef === ref && !state.leaving) {
        // ほかの端末から同じ名前で退出したなど、ルームの上に自分がいない
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally('ルームから出たよ');
      }
    }
  } catch (error) {
    console.warn('[pittari-beat] presence recovery failed', error);
    if (force) toast('再接続に失敗しました。ページを読み直してね', true);
  }
}

function setPlaying(on) {
  if (state.role !== 'guest') return;
  state.playing = on;
  ensurePresence(true);
}

async function createRoom(course, track) {
  if (state.busy || state.roomRef) return;
  state.busy = true;
  $('pb-create-go').disabled = true;
  try {
    if (!await waitAuth()) return;
    const uid = currentUid();
    const key = RoomkRTDB.now() + '-' + Math.random().toString(36).slice(2, 8);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = RoomkRTDB.generateRoomCode();
      const ref = db.ref(DB_PREFIX + '/' + code);
      const result = await transactRetry(ref, (room) => {
        // やり直しのとき、前の送信で自分が作ったルームが届いていたら、そのまま使う
        if (room) return room.hostUid === uid && room.createKey === key ? room : undefined;
        return {
          status: STATUS.OPEN,
          hostUid: uid,
          createKey: key,
          hostConnected: true,
          hostDisconnectedAt: null,
          createdAt: serverTimestamp(),
          course, track, version: 1,
        };
      });
      if (result.committed) {
        window.RoomkStats?.count('room-create');
        connectToRoom('host', null, code, ref, RoomkRTDB.now());
        return;
      }
    }
    toast('ルームを作れませんでした。もう一度ためしてね', true);
  } catch (err) {
    console.warn('[pittari-beat] create failed', err);
    toast('接続できませんでした。もう一度ためしてね', true);
  } finally {
    state.busy = false;
    $('pb-create-go').disabled = false;
  }
}

async function joinRoom(e) {
  e.preventDefault();
  if (state.busy || state.roomRef) return;
  const err = $('pb-join-error');
  const showErr = (t) => { err.textContent = t; err.hidden = false; };
  const nickname = cleanName($('pb-join-name').value);
  if (!nickname) { showErr('ニックネームを入れてね'); $('pb-join-name').focus(); return; }
  if (nickname.length > NAME_MAX) { showErr('ニックネームは8文字までだよ'); $('pb-join-name').focus(); return; }
  if (/[.#$\[\]/]/.test(nickname)) { showErr('ニックネームに . # $ [ ] / は使えないよ'); $('pb-join-name').focus(); return; }
  const code = normCode($('pb-join-code').value);
  if (/[^\x00-\x7F]/.test(code)) {
    showErr('ルームコードは英字と数字だよ。ひらがなになるときは、キーボードを英字に切り替えてね（例: 「半角/全角」キーや、Mac の「英数」キー）');
    $('pb-join-code').focus();
    return;
  }
  if (!ROOM_CODE_PATTERN.test(code)) { showErr('ルームコードは6文字だよ。もう一度たしかめてね'); $('pb-join-code').focus(); return; }
  err.hidden = true;
  state.busy = true;
  $('pb-join-go').disabled = true;
  let release = null;
  try {
    if (!await waitAuth()) return;
    const ref = db.ref(DB_PREFIX + '/' + code);
    const warm = await warmRoomCache(ref);
    release = warm.release;
    const initial = warm.snap.val();
    if (!initial) { showErr('ルームが見つからなかったよ。ルームコードをたしかめてね'); return; }
    if (isExpired(initial)) {
      await removeExpired(ref, initial);
      showErr('このルームは終わったみたい');
      return;
    }
    const uid = currentUid();
    const joinedAt = RoomkRTDB.now();
    let reason = '';
    let rejoinAt = null;
    const result = await transactRetry(ref, (room) => {
      reason = '';
      rejoinAt = null;
      if (!room) { reason = 'none'; return; }
      if (isExpired(room) || room.status !== STATUS.OPEN) { reason = 'ended'; return; }
      const players = room.players || {};
      const stale = players[nickname];
      // 同じ端末（同じ uid）の名前が残っていたら、入りなおしとして通す（点数はそのまま）
      if (stale && stale.uid !== uid) { reason = 'name'; return; }
      if (!stale && Object.keys(players).length >= MAX_GUESTS) { reason = 'full'; return; }
      rejoinAt = stale ? Number(stale.joinedAt) || joinedAt : joinedAt;
      return {
        ...room,
        players: { ...players, [nickname]: { ...(stale || {}), uid, joinedAt: rejoinAt } },
        online: { ...(room.online || {}), [nickname]: { uid, playing: false } },
      };
    });
    if (!result.committed) {
      const messages = {
        none: 'ルームが見つからなかったよ。ルームコードをたしかめてね',
        ended: 'このルームは終わったみたい',
        name: 'その名前は、もうルームにいるよ。ちがう名前にしてね',
        full: 'このルームはいっぱいだよ',
      };
      showErr(messages[reason] || '参加できませんでした。もう一度ためしてね');
      return;
    }
    window.RoomkStats?.count('room-join');
    state.myBest = null;
    state.myBestVersion = null;
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
  } catch (error) {
    console.warn('[pittari-beat] join failed', error);
    showErr('接続できませんでした。もう一度ためしてね');
  } finally {
    release?.();
    state.busy = false;
    $('pb-join-go').disabled = false;
  }
}

async function tryReconnect(saved) {
  if (!saved || !saved.roomCode || !saved.role) return false;
  if (!ROOM_CODE_PATTERN.test(saved.roomCode)) return false;
  if (saved.role === 'guest' && !cleanName(saved.nickname)) return false;
  if (state.busy || state.roomRef) return false;
  state.busy = true;
  let release = null;
  try {
    if (!await waitAuth()) return false;
    const uid = currentUid();
    if (!uid || uid !== saved.uid) return false;
    const ref = db.ref(DB_PREFIX + '/' + saved.roomCode);
    const warm = await warmRoomCache(ref);
    release = warm.release;
    const room = warm.snap.val();
    if (!room) return false;
    if (isExpired(room)) { await removeExpired(ref, room); return false; }
    let joinedAt = Number(saved.joinedAt) || null;
    if (saved.role === 'host') {
      if (room.hostUid !== uid) return false;
    } else if (saved.role === 'guest') {
      const player = room.players?.[saved.nickname];
      if (!player || player.uid !== uid) return false;
      joinedAt = Number(player.joinedAt) || joinedAt;
      state.myBest = Number.isFinite(saved.myBest) ? saved.myBest : null;
      state.myBestVersion = Number.isFinite(saved.myBestVersion) ? saved.myBestVersion : null;
    } else {
      return false;
    }
    if (state.roomRef) return false;
    connectToRoom(saved.role, saved.role === 'guest' ? saved.nickname : null, saved.roomCode, ref, joinedAt);
    return true;
  } catch (error) {
    console.warn('[pittari-beat] reconnect failed', error);
    return false;
  } finally {
    release?.();
    state.busy = false;
  }
}

async function hostClose() {
  if (state.busy || state.role !== 'host' || !state.roomRef) return;
  if (!window.confirm('ルームを閉じると、ランキングは消えます。参加している人の画面もはじめにもどります。閉じますか？')) return;
  const ref = state.roomRef;
  state.busy = true;
  state.leaving = true;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    await ref.remove();
  } catch (error) {
    console.warn('[pittari-beat] close failed', error);
    toast('ルームを閉じられませんでした。もう一度ためしてね', true);
    state.leaving = false;
    state.busy = false;
    ensurePresence(true);
    return;
  }
  state.busy = false;
  cleanupRoom();
  show('pb-top');
}

async function guestLeave() {
  if (state.busy || state.role !== 'guest' || !state.roomRef) return;
  const ref = state.roomRef;
  const nickname = state.nickname;
  const uid = currentUid();
  state.busy = true;
  state.leaving = true;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    // 退出したときだけ、名前と点数も消す（ランキングから消える）
    await transactRetry(ref, (room) => {
      if (!room || room.players?.[nickname]?.uid !== uid) return;
      const players = { ...room.players };
      const online = { ...(room.online || {}) };
      delete players[nickname];
      delete online[nickname];
      return { ...room, players, online };
    });
  } catch (error) {
    console.warn('[pittari-beat] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね', true);
    state.leaving = false;
    state.busy = false;
    ensurePresence(true);
    return;
  }
  state.busy = false;
  cleanupRoom();
  show('pb-top');
}

async function hostChangeSetting(course, track) {
  const ref = state.roomRef;
  if (!ref || state.role !== 'host') return;
  const uid = currentUid();
  try {
    await transactRetry(ref, (room) => {
      if (!room || room.hostUid !== uid || isExpired(room)) return;
      if (room.course === course && room.track === track) return;
      return { ...room, course, track, version: (Number(room.version) || 1) + 1 };
    });
  } catch (error) {
    console.warn('[pittari-beat] change failed', error);
    toast('コースと曲を変えられませんでした。もう一度ためしてね', true);
  }
}

// いちばんよい点数を送る（players/{名前} だけの transaction。同じ版で低い点なら書かない）
async function sendBest(version, sc) {
  const ref = state.roomRef;
  if (!ref || state.role !== 'guest') return;
  const uid = currentUid();
  try {
    await transactRetry(ref.child('players/' + state.nickname), (p) => {
      if (!p || p.uid !== uid) return;
      const v = Number(p.v) || 0;
      if (v > version) return;
      if (v === version && Number.isFinite(p.best) && p.best >= sc) return;
      return { ...p, best: sc, v: version };
    });
  } catch (error) {
    console.warn('[pittari-beat] best failed', error);
  }
}

function roomPlayers(room) {
  const online = room.online || {};
  return Object.entries(room.players || {}).map(([name, p]) => ({
    id: name,
    name,
    best: Number(p.v) === Number(room.version) && Number.isFinite(p.best) ? p.best : null,
    joinedAt: Number(p.joinedAt) || 0,
    playing: !!online[name]?.playing,
    away: !online[name],
  }));
}

function handleRoom(room) {
  if (state.role === 'guest') {
    if (state.myBestVersion !== null && state.myBestVersion !== room.version) {
      state.myBest = null;
      state.myBestVersion = null;
      saveSession();
    }
    // 自分のいちばんがルームに届いていなければ送りなおす
    const mine = room.players?.[state.nickname];
    if (mine && state.myBestVersion === room.version && Number.isFinite(state.myBest)) {
      const sent = Number(mine.v) === room.version ? mine.best : null;
      if (!(sent >= state.myBest)) sendBest(room.version, state.myBest);
    }
    $('pb-guest-offline').hidden = room.hostConnected !== false;
    if (current === 'pb-guest') renderGuest();
  } else if (state.role === 'host' && current === 'pb-host') {
    renderHost();
  }
}

function guestReport(version, sc) {
  if (state.role !== 'guest' || !state.room) return 'ルームは閉じられたので、この回はランキングにのらないよ';
  if (version !== state.room.version) return 'とちゅうでコースが変わったので、この回はランキングにのらないよ';
  if (state.myBestVersion !== version || !Number.isFinite(state.myBest) || sc > state.myBest) {
    state.myBest = sc;
    state.myBestVersion = version;
    saveSession();
    sendBest(version, sc);
    return 'ランキングに送ったよ。あなたのいちばんは ' + sc + '点';
  }
  return 'ランキングには、いちばんよい点数（' + state.myBest + '点）がのっているよ';
}

function rankingItems(list, players, meId) {
  list.textContent = '';
  rankPlayers(players).forEach((p) => {
    const li = document.createElement('li');
    li.className = 'pb-rank' + (p.id === meId ? ' is-me' : '') + (p.away ? ' is-away' : '');
    const rank = document.createElement('span');
    rank.className = 'pb-rank__no';
    rank.textContent = p.rank ? p.rank + '位' : '―';
    const name = document.createElement('span');
    name.className = 'pb-rank__name';
    name.textContent = p.name;
    const tag = document.createElement('span');
    tag.className = 'pb-rank__tag';
    tag.textContent = p.away ? 'はなれている' : p.playing ? 'あそんでいる' : '';
    const pts = document.createElement('span');
    pts.className = 'pb-rank__pts';
    pts.textContent = Number.isFinite(p.best) ? p.best + '点' : 'まだ';
    li.append(rank, name, tag, pts);
    list.appendChild(li);
  });
}

function renderHost() {
  const r = state.room;
  $('pb-host-code').textContent = state.roomCode || '------';
  if (!r) { $('pb-host-setting').textContent = ''; return; }
  $('pb-host-setting').textContent = settingText(r.course, r.track);
  const players = roomPlayers(r);
  rankingItems($('pb-host-ranking'), players, null);
  $('pb-host-empty').hidden = players.length > 0;
}

function renderGuest() {
  $('pb-guest-code').textContent = state.roomCode || '';
  $('pb-guest-name').textContent = state.nickname || '';
  const r = state.room;
  $('pb-guest-start').disabled = !r;
  if (!r) {
    $('pb-guest-setting').textContent = 'つないでいるよ…';
    return;
  }
  $('pb-guest-setting').textContent = settingText(r.course, r.track);
  const players = roomPlayers(r);
  const ranked = rankPlayers(players);
  const mine = ranked.find((p) => p.id === state.nickname);
  const best = mine && Number.isFinite(mine.best) ? mine.best : (state.myBestVersion === r.version ? state.myBest : null);
  $('pb-guest-best').textContent = Number.isFinite(best) ? best + '点' : 'まだ';
  $('pb-guest-rank').textContent = mine && mine.rank ? 'いま ' + mine.rank + '位（' + ranked.filter((p) => p.rank).length + '人中）' : '';
  rankingItems($('pb-guest-ranking'), players, state.nickname);
}

function openJoin(fromLink) {
  $('joinLinkHint').hidden = !fromLink;
  $('pb-join-error').hidden = true;
  show('pb-join');
  $('pb-join-name').focus();
}

// ── はじめに開いたとき ──────────────────────────
// ?room= → 保存した記録（sessionStorage）の順に見る
async function boot() {
  const params = new URLSearchParams(location.search);
  const linkCode = params.has('room') ? normCode(params.get('room')) : null;
  if (linkCode !== null && !ROOM_CODE_PATTERN.test(linkCode)) {
    toast('ルームコードが正しくないよ', true);
    history.replaceState(null, '', location.pathname + location.hash);
  }
  const validLink = linkCode !== null && ROOM_CODE_PATTERN.test(linkCode) ? linkCode : null;
  const saved = loadSession();
  if (saved && (!validLink || saved.roomCode === validLink)) {
    show('pb-top');
    if (await tryReconnect(saved)) return;
    clearSession();
  } else if (saved && validLink) {
    clearSession();
  }
  if (validLink) {
    $('pb-join-code').value = validLink;
    openJoin(true);
    return;
  }
  show('pb-top');
}

// ── 操作のつなぎこみ ────────────────────────────
const soloSel = { course: prefs.course, track: prefs.track };
const createSel = { course: prefs.course, track: prefs.track };
const changeSel = { course: 'easy', track: 'mid' };
const saveSel = (sel) => () => { save(STORE.course, sel.course); save(STORE.track, sel.track); };

document.querySelectorAll('[data-go-top]').forEach((b) => b.addEventListener('click', () => show('pb-top')));
document.querySelectorAll('[data-open-calib]').forEach((b) => b.addEventListener('click', openCalib));
$('pb-go-solo').addEventListener('click', () => {
  renderChoices($('pb-solo-courses'), $('pb-solo-tracks'), soloSel, saveSel(soloSel));
  show('pb-solo');
});
$('pb-go-create').addEventListener('click', () => {
  renderChoices($('pb-create-courses'), $('pb-create-tracks'), createSel, saveSel(createSel));
  show('pb-create');
});
$('pb-go-join').addEventListener('click', () => openJoin(false));
$('pb-solo-start').addEventListener('click', () => {
  window.RoomkStats?.count('solo');
  startRun({ mode: 'solo', course: soloSel.course, track: soloSel.track });
});
$('pb-create-go').addEventListener('click', () => createRoom(createSel.course, createSel.track));

$('btnCopyCode').addEventListener('click', (e) => state.roomCode && RoomkRTDB.copyRoomCode(state.roomCode, e.currentTarget));
$('btnCopyLink').addEventListener('click', (e) => state.roomCode && RoomkRTDB.copyRoomLink(state.roomCode, e.currentTarget));
$('pb-host-demo').addEventListener('click', () => state.room && startRun({ mode: 'demo', course: state.room.course, track: state.room.track }));
$('pb-host-change-open').addEventListener('click', () => {
  if (!state.room) return;
  changeSel.course = state.room.course;
  changeSel.track = state.room.track;
  renderChoices($('pb-change-courses'), $('pb-change-tracks'), changeSel, () => {});
  $('pb-host-change').hidden = false;
  $('pb-host-change-open').hidden = true;
});
$('pb-change-cancel').addEventListener('click', () => { $('pb-host-change').hidden = true; $('pb-host-change-open').hidden = false; });
$('pb-change-ok').addEventListener('click', () => {
  hostChangeSetting(changeSel.course, changeSel.track);
  $('pb-host-change').hidden = true;
  $('pb-host-change-open').hidden = false;
});
$('pb-host-close').addEventListener('click', hostClose);

$('pb-join-form').addEventListener('submit', joinRoom);
['pb-join-name', 'pb-join-code'].forEach((id) => $(id).addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault();
}));
$('pb-guest-start').addEventListener('click', () => {
  if (!state.room) return;
  startRun({ mode: 'guest', course: state.room.course, track: state.room.track, version: state.room.version });
});
$('pb-guest-leave').addEventListener('click', guestLeave);

$('pb-again').addEventListener('click', () => {
  if (!lastPlay) return;
  if (lastPlay.mode === 'guest' && state.room) startRun({ mode: 'guest', course: state.room.course, track: state.room.track, version: state.room.version });
  else if (lastPlay.mode === 'demo' && state.room) startRun({ mode: 'demo', course: state.room.course, track: state.room.track });
  else startRun(lastPlay);
});
$('pb-back').addEventListener('click', () => goBack(lastPlay ? lastPlay.mode : 'solo'));
$('pb-pause').addEventListener('click', pause);
$('pb-resume').addEventListener('click', resume);
$('pb-quit').addEventListener('click', quit);
$('pb-calib-back').addEventListener('click', closeCalib);
$('pb-calib-run').addEventListener('click', runCalib);
$('pb-calib-pad').addEventListener('pointerdown', (e) => { e.preventDefault(); calibTap(eventTime(e)); });
$('pb-offset-minus').addEventListener('click', () => setOffset(prefs.offset - 0.01));
$('pb-offset-plus').addEventListener('click', () => setOffset(prefs.offset + 0.01));
$('pb-offset-reset').addEventListener('click', () => setOffset(0));

$('pb-stage').addEventListener('pointerdown', (e) => {
  if (!run) return;
  e.preventDefault();
  const rect = $('pb-stage').getBoundingClientRect();
  const lane = run.lanes === 1 ? 0 : (e.clientX - rect.left < rect.width / 2 ? 0 : 1);
  tap(lane, eventTime(e));
});

document.addEventListener('keydown', (e) => {
  let lane = null;
  if (KEYS_LEFT.has(e.code)) lane = 0;
  else if (KEYS_RIGHT.has(e.code)) lane = 1;
  if (!$('pb-calib').hidden) {
    if (calib && (lane !== null || e.code === 'Space')) {
      e.preventDefault();
      if (!e.repeat) calibTap(eventTime(e));
    }
    return;
  }
  if ($('pb-play').hidden || !run) return;
  if (e.code === 'Escape') { if (run.paused) resume(); else pause(); return; }
  if (run.paused) return;
  if (lane === null && e.code === 'Space' && run.lanes === 1) lane = 0;
  if (lane === null && e.code !== 'Space') return;
  e.preventDefault();
  if (lane === null || e.repeat) return;
  tap(lane, eventTime(e));
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); stopCalibIfRunning(); }
});
window.addEventListener('pagehide', () => { pause(); stopCalibIfRunning(); });

// 自動の確かめ（tests/pittari-beat）用。アドレスの末尾が #e2e のときだけ、いまの時刻や譜面を読めるようにする
if (location.hash === '#e2e') {
  window.__pb = {
    now: () => (run && !run.paused && run.seg ? (updateClock(), songNow(performance.now())) : null),
    notes: () => (run ? run.chart.notes.map((n) => ({ t: n.t, lane: n.lane })) : null),
    counts: () => (run ? { perfect: run.state.perfect, good: run.state.good, miss: run.state.miss, total: run.state.notes.length, paused: run.paused } : null),
    calib: () => (calib ? (updateClock(), { t0: calib.t0, heard: heardAt(performance.now()), beat: 60 / CALIB_BPM }) : null),
    offset: () => prefs.offset,
    audio: () => (ac ? ac.state : null),
    music: () => !!(run && run.source),
    room: () => ({ role: state.role, code: state.roomCode, nickname: state.nickname, room: state.room, myBest: state.myBest }),
  };
}

buildVolumes();
renderOffset();
boot();

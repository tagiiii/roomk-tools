import { shuffle, popIn } from '../shared/js/utils.js';
import { QUESTIONS } from './questions.js';

/* ============================================
   漢字さがし — Game Logic
   ============================================ */

// ── Difficulty Presets ──
const PRESETS = {
  easy:   { cols: 5, rows: 5, minTargets: 3, maxTargets: 5, maxRotation: 0,  sizeVariation: 0,    diffRange: [1, 1] },
  normal: { cols: 6, rows: 6, minTargets: 4, maxTargets: 6, maxRotation: 15, sizeVariation: 0.15, diffRange: [1, 2] },
  hard:   { cols: 7, rows: 7, minTargets: 5, maxTargets: 8, maxRotation: 30, sizeVariation: 0.25, diffRange: [2, 3] },
};

// ── State ──
const state = {
  difficulty: 'normal',
  timeLimit: 20,
  currentRound: null,
  timerInterval: null,
  revealTimeouts: [],
  timeRemaining: 0,
  revealed: false,
  usedIndices: [],
};

// ── DOM References ──
const $ = (id) => document.getElementById(id);

// ── Screen Transition ──
function showScreen(id) {
  document.querySelectorAll('.ks-screen').forEach(s => s.classList.remove('active'));
  $('screen-' + id).classList.add('active');
}

// ── Settings: Option Toggle ──
function initOptionGroup(containerId, onChange) {
  const container = $(containerId);
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.ks-option');
    if (!btn) return;
    container.querySelectorAll('.ks-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onChange(btn.dataset.value);
  });
}

// ── Round Generation ──
function generateRound() {
  const preset = PRESETS[state.difficulty];
  const totalCells = preset.cols * preset.rows;
  const [minDiff, maxDiff] = preset.diffRange;

  const candidates = QUESTIONS
    .map((q, i) => ({ q, i }))
    .filter(({ q, i }) =>
      q.visualDifficulty >= minDiff &&
      q.visualDifficulty <= maxDiff &&
      !state.usedIndices.includes(i)
    );

  // Reset pool if exhausted
  if (candidates.length === 0) {
    state.usedIndices = [];
    return generateRound();
  }

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  state.usedIndices.push(pick.i);
  const question = pick.q;

  const targetCount = preset.minTargets +
    Math.floor(Math.random() * (preset.maxTargets - preset.minTargets + 1));

  const cells = [];
  for (let i = 0; i < targetCount; i++) {
    cells.push(makeCell(question.target, true, preset));
  }
  for (let i = targetCount; i < totalCells; i++) {
    const d = question.distractors[Math.floor(Math.random() * question.distractors.length)];
    cells.push(makeCell(d, false, preset));
  }

  state.currentRound = {
    target: question.target,
    cells: shuffle(cells),
    targetCount,
  };
}

function makeCell(char, isTarget, preset) {
  const rotation = preset.maxRotation === 0
    ? 0
    : (Math.random() * 2 - 1) * preset.maxRotation;
  const scale = preset.sizeVariation === 0
    ? 1
    : 1 + (Math.random() * 2 - 1) * preset.sizeVariation;
  return { char, isTarget, rotation: Math.round(rotation), scale: +scale.toFixed(2) };
}

// ── Grid Rendering ──
function renderGrid(containerId) {
  const preset = PRESETS[state.difficulty];
  const container = $(containerId);
  container.innerHTML = '';
  container.style.setProperty('--ks-cols', preset.cols);

  state.currentRound.cells.forEach(cell => {
    const div = document.createElement('div');
    div.className = 'ks-cell';
    const inner = document.createElement('div');
    inner.className = 'ks-cell__inner';
    inner.textContent = cell.char;
    inner.style.setProperty('--cell-rotation', `${cell.rotation}deg`);
    inner.style.setProperty('--cell-scale', cell.scale);
    div.appendChild(inner);
    if (cell.isTarget) div.dataset.target = 'true';
    container.appendChild(div);
  });
}

// ── Preview Screen ──
function showPreview() {
  generateRound();
  const round = state.currentRound;
  $('preview-kanji').textContent = round.target;
  const preset = PRESETS[state.difficulty];
  const diffLabel = { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい' }[state.difficulty];
  $('preview-hint').textContent = `${preset.cols}×${preset.rows} マス ／ ${diffLabel}`;
  popIn($('preview-kanji'));
  showScreen('preview');
}

// ── Play Screen ──
function startPlay() {
  state.revealed = false;
  renderGrid('kanji-grid');
  $('play-target').textContent = `さがす字: ${state.currentRound.target}`;
  showScreen('play');
  startTimer();
}

// ── Cleanup helpers ──
function clearTimers() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.revealTimeouts.forEach(clearTimeout);
  state.revealTimeouts = [];
}

// ── Timer ──
function startTimer() {
  clearTimers();
  state.timeRemaining = state.timeLimit * 10; // tenths of second
  const total = state.timeRemaining;
  const fill = $('timer-fill');
  const timeEl = $('play-time');
  const timerBar = $('timer-bar');

  updateTimeDisplay(timeEl, state.timeRemaining);
  fill.style.width = '100%';
  timerBar.classList.remove('ks-danger');
  timeEl.classList.remove('ks-danger');

  state.timerInterval = setInterval(() => {
    state.timeRemaining--;
    const pct = (state.timeRemaining / total) * 100;
    fill.style.width = `${pct}%`;
    updateTimeDisplay(timeEl, state.timeRemaining);

    if (pct <= 20) {
      timerBar.classList.add('ks-danger');
      timeEl.classList.add('ks-danger');
    }

    if (state.timeRemaining <= 0) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      onTimeUp();
    }
  }, 100);
}

function updateTimeDisplay(el, tenths) {
  el.textContent = `${Math.ceil(tenths / 10)}秒`;
}

// ── Time Up → Frozen Grid (no answers yet) ──
function onTimeUp() {
  renderGrid('result-grid');
  $('result-grid').classList.add('ks-grid--blurred');
  $('result-prompt').textContent = 'いくつ見つけられたかな？';
  $('result-message').textContent = '';
  $('result-actions-reveal').style.display = '';
  $('result-actions-next').style.display = 'none';
  state.revealed = false;
  showScreen('result');
}

// ── Reveal Answers ──
function revealAnswers() {
  const round = state.currentRound;
  state.revealed = true;

  $('result-grid').classList.remove('ks-grid--blurred');
  $('result-prompt').textContent = '';
  $('result-message').innerHTML =
    `<span class="ks-result__target">${round.target}</span> は <span class="ks-result__count">${round.targetCount}個</span> ありました！`;

  $('result-actions-reveal').style.display = 'none';
  $('result-actions-next').style.display = '';

  // Staggered highlight
  const cells = $('result-grid').querySelectorAll('.ks-cell');
  cells.forEach((cell, i) => {
    if (cell.dataset.target === 'true') {
      const id = setTimeout(() => {
        cell.classList.add('ks-cell--found');
        popIn(cell);
      }, i * 40);
      state.revealTimeouts.push(id);
    }
  });
}

// ── Navigation ──
function nextRound() {
  clearTimers();
  showPreview();
}

function goToSettings() {
  clearTimers();
  state.usedIndices = [];
  showScreen('settings');
}

// ── Init ──
initOptionGroup('difficulty-options', (val) => { state.difficulty = val; });
initOptionGroup('time-options', (val) => { state.timeLimit = Number(val); });

$('btn-start-game').addEventListener('click', showPreview);
$('btn-start-round').addEventListener('click', startPlay);
$('btn-reveal').addEventListener('click', revealAnswers);
$('btn-next-round').addEventListener('click', nextRound);
$('btn-change-settings').addEventListener('click', goToSettings);

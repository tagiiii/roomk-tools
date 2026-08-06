const NUMBERS = ['①', '②', '③', '④', '⑤'];
const APP_ID = 'challenge-tane';
const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_SEEDS = 50;
const LABEL_MAX = 30;
const MEMO_MAX = 60;

// 4つの status は全部同格。ならび順に「良い→悪い」の意味を持たせない
const STATUSES = [
  { id: 'try', label: '試してみたい', icon: 'rocket_launch', hint: '動かしてみたい気分のたね' },
  { id: 'watch', label: 'ながめておく', icon: 'visibility', hint: 'いまはながめていたい気分のたね' },
  { id: 'hold', label: '保留', icon: 'pause_circle', hint: 'いったんここに置いておくたね' },
  { id: 'close', label: 'もういいかな', icon: 'inventory_2', hint: 'もういいかな、と思ったたね。ここにあるままで大丈夫' },
];

const FILE_MARKERS = {
  colors: [
    { label: 'そらいろ', romaji: 'sora' },
    { label: 'みどり', romaji: 'midori' },
    { label: 'きいろ', romaji: 'kiiro' },
    { label: 'ももいろ', romaji: 'momo' },
    { label: 'むらさき', romaji: 'murasaki' },
    { label: 'あか', romaji: 'aka' },
    { label: 'しろ', romaji: 'shiro' },
    { label: 'ぎんいろ', romaji: 'gin' },
  ],
  animals: [
    { label: 'ネコ', romaji: 'neko', icon: 'pets' },
    { label: 'イヌ', romaji: 'inu', icon: 'pets' },
    { label: 'ウサギ', romaji: 'usagi', icon: 'cruelty_free' },
    { label: 'ペンギン', romaji: 'pengin', icon: 'icecream' },
    { label: 'イルカ', romaji: 'iruka', icon: 'waves' },
    { label: 'リス', romaji: 'risu', icon: 'park' },
    { label: 'フクロウ', romaji: 'fukurou', icon: 'nightlight' },
    { label: 'パンダ', romaji: 'panda', icon: 'forest' },
  ],
};

const IMPORT_ERROR_GENERIC = 'このファイルは読み込めませんでした。チャレンジのたねで保存したファイルか、確かめてください';
const IMPORT_ERROR_NEWER = 'このファイルは新しいバージョンでつくられています。アプリを更新してから開いてください';
const IMPORT_ERROR_CONTENT = '記録の内容が正しくないため読み込めませんでした';

const state = {
  record: null,
  dirty: false,
  currentScreen: null,
  draft: {},
};

let toastTimer = null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function trimText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

function randomIndex(max) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}

function makeId(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, b => chars[b % chars.length]).join('')}`;
}

function makeMarker() {
  const color = FILE_MARKERS.colors[randomIndex(FILE_MARKERS.colors.length)];
  const animal = FILE_MARKERS.animals[randomIndex(FILE_MARKERS.animals.length)];
  return { color: color.label, animal: animal.label };
}

function markerParts(marker) {
  const color = FILE_MARKERS.colors.find(item => item.label === marker?.color) || FILE_MARKERS.colors[0];
  const animal = FILE_MARKERS.animals.find(item => item.label === marker?.animal) || FILE_MARKERS.animals[0];
  return { color, animal };
}

function createRecord() {
  const createdAt = nowIso();
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    fileMarker: makeMarker(),
    createdAt,
    updatedAt: createdAt,
    seeds: [],
  };
}

function setDirty(value = true) {
  state.dirty = value;
}

function statusMeta(id) {
  return STATUSES.find(item => item.id === id) || STATUSES[1];
}

function seedsByStatus(statusId) {
  return (state.record?.seeds || []).filter(seed => seed.status === statusId);
}

function findSeed(id) {
  return (state.record?.seeds || []).find(seed => seed.id === id) || null;
}

function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('active');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('active'), 2600);
}

function setStartError(message) {
  state.draft.startError = message;
  renderStart();
  showScreen('start');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.getElementById(`screen-${id}`).classList.add('active');
  state.currentScreen = id;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function markerHtml(record = state.record) {
  const parts = markerParts(record?.fileMarker);
  return `
    <div class="ct-marker">
      <span class="material-symbols-rounded" aria-hidden="true">${esc(parts.animal.icon)}</span>
      <span>${esc(parts.color.label)}の${esc(parts.animal.label)}</span>
    </div>
  `;
}

function statusPill(statusId) {
  const meta = statusMeta(statusId);
  return `
    <span class="ct-pill">
      <span class="material-symbols-rounded" aria-hidden="true">${esc(meta.icon)}</span>${esc(meta.label)}
    </span>
  `;
}

function renderStart() {
  const error = state.draft.startError
    ? `<div class="alert alert-error ct-alert" aria-live="assertive">${esc(state.draft.startError)}</div>`
    : '';
  document.querySelector('#screen-start').innerHTML = `
    <div class="ct-panel">
      <h2 class="ct-panel__title" id="start-title">チャレンジのたね</h2>
      <p class="ct-panel__lead">「やってみたいかも」と思ったことを、ここでは「たね」と呼ぶよ。たねのままためておくところ。まだ計画は立てないよ</p>
      ${error}
      <div class="ct-choice-grid" role="group" aria-label="はじめ方">
        <button class="ct-choice" type="button" data-action="start-new">
          <span class="ct-choice__num">①</span>
          <span class="ct-choice__text">はじめて使う</span>
        </button>
        <label class="ct-choice ct-file-label" for="recordFile">
          <span class="ct-choice__num">②</span>
          <span class="ct-choice__text">前回のファイルを開く</span>
        </label>
      </div>
      <p class="ct-muted" style="margin-top: var(--space-md);">このアプリはデータをどこにも保存しません。終わるときにファイルをダウンロードして持ち帰ります</p>
    </div>
  `;
}

function renderLoadConfirm() {
  const record = state.draft.importRecord;
  const seeds = record?.seeds || [];
  document.querySelector('#screen-load-confirm').innerHTML = `
    <div class="ct-panel">
      <h2 class="ct-panel__title" id="load-confirm-title">この記録で続きをはじめる？</h2>
      ${markerHtml(record)}
      <p class="ct-muted" style="margin-top: var(--space-md);">最後に保存した日：${esc(formatDate(record?.updatedAt))}</p>
      <ul class="ct-list">
        ${seeds.map(seed => `
          <li class="ct-list__item">
            <strong>${esc(seed.label)}</strong>
            ${statusPill(seed.status)}
          </li>
        `).join('') || '<li class="ct-list__item">たねはまだありません</li>'}
      </ul>
      <div class="ct-actions">
        <button class="btn btn-primary" type="button" data-action="accept-import">①この記録ではじめる</button>
        <label class="btn btn-ghost" for="recordFile">②ちがうファイルを選び直す</label>
      </div>
    </div>
  `;
}

function renderHome() {
  const openPockets = STATUSES.filter(meta => meta.id !== 'close');
  const closeMeta = statusMeta('close');
  const closeSeeds = seedsByStatus('close');
  const full = (state.record?.seeds || []).length >= MAX_SEEDS;
  document.querySelector('#screen-home').innerHTML = `
    <div class="ct-panel">
      <h2 class="ct-panel__title" id="home-title">たねポケット</h2>
      <p class="ct-panel__lead">たねはいつでも別のポケットに動かせるよ。理由はいらないよ</p>
      ${state.record ? markerHtml() : ''}
      <div class="ct-actions">
        ${full
          ? '<p class="ct-muted">たねがいっぱいになったよ。どれかを消すと、新しいたねを増やせるよ</p>'
          : `<button class="btn btn-secondary" type="button" data-action="add-seed">
              <span class="material-symbols-rounded" aria-hidden="true">add</span>新しいたねを増やす
            </button>`}
      </div>
      <div class="ct-pockets">
        ${openPockets.map(pocketHtml).join('')}
      </div>
      <details class="ct-closed"${state.draft.closedOpen ? ' open' : ''}>
        <summary class="ct-closed__summary">
          <span class="material-symbols-rounded" aria-hidden="true">${esc(closeMeta.icon)}</span>
          <span>${esc(closeMeta.label)}のたね</span>
          <span class="material-symbols-rounded ct-closed__arrow" aria-hidden="true">expand_more</span>
        </summary>
        <p class="ct-pocket__hint">${esc(closeMeta.hint)}</p>
        <div class="ct-pocket__seeds">
          ${closeSeeds.map(seedCardHtml).join('') || emptyHtml()}
        </div>
      </details>
      <div class="ct-actions ct-actions--end">
        <button class="btn btn-primary" type="button" data-action="go-save">今日のぶんを保存する</button>
      </div>
    </div>
  `;
}

function pocketHtml(meta) {
  const seeds = seedsByStatus(meta.id);
  return `
    <section class="ct-pocket" aria-labelledby="pocket-${esc(meta.id)}-title">
      <div class="ct-pocket__head">
        <span class="material-symbols-rounded ct-pocket__icon" aria-hidden="true">${esc(meta.icon)}</span>
        <h3 class="ct-pocket__title" id="pocket-${esc(meta.id)}-title">${esc(meta.label)}</h3>
      </div>
      <p class="ct-pocket__hint">${esc(meta.hint)}</p>
      <div class="ct-pocket__seeds">
        ${seeds.map(seedCardHtml).join('') || emptyHtml()}
      </div>
    </section>
  `;
}

function emptyHtml() {
  return '<div class="ct-empty">いまはからっぽ</div>';
}

function seedCardHtml(seed) {
  const others = STATUSES.filter(meta => meta.id !== seed.status);
  return `
    <article class="ct-seed">
      <div class="ct-seed__row">
        <span class="ct-seed__label">${esc(seed.label)}</span>
        <button class="ct-seed__edit" type="button" data-action="edit-seed" data-value="${esc(seed.id)}" aria-label="「${esc(seed.label)}」をなおす">
          <span class="material-symbols-rounded" aria-hidden="true">edit</span>なおす
        </button>
      </div>
      ${seed.memo ? `<p class="ct-seed__memo">${esc(seed.memo)}</p>` : ''}
      <div class="ct-seed__moves">
        ${others.map(meta => `
          <button class="ct-move" type="button" data-action="move-seed" data-value="${esc(seed.id)}" data-status="${esc(meta.id)}" aria-label="「${esc(seed.label)}」を「${esc(meta.label)}」へ動かす">
            <span class="material-symbols-rounded" aria-hidden="true">${esc(meta.icon)}</span>${esc(meta.label)}へ
          </button>
        `).join('')}
      </div>
      ${seed.status === 'try' ? sakusenHtml(seed) : ''}
    </article>
  `;
}

function sakusenHtml(seed) {
  const open = state.draft.sakusenOpenId === seed.id;
  const copiedText = state.draft.sakusenCopied
    ? 'ことばをコピーしたよ。さくせん会議の「じぶんで決める」欄にはりつけて使えるよ'
    : 'コピーがうまくいかなかったみたい。下のことばを手で選んでコピーしてね';
  return `
    <div class="ct-sakusen">
      <button class="btn btn-secondary btn-sm" type="button" data-action="sakusen-consult" data-value="${esc(seed.id)}">
        <span class="material-symbols-rounded" aria-hidden="true">content_copy</span>さくせん会議で相談する
      </button>
      ${open ? `
        <div class="ct-sakusen__panel">
          <p>${esc(copiedText)}</p>
          <p class="ct-sakusen__text">${esc(seed.label)}</p>
          <div class="ct-sakusen__links">
            <a class="btn btn-ghost btn-sm" href="../sakusen-kaigi/" target="_blank" rel="noopener">
              さくせん会議を開く<span class="material-symbols-rounded" aria-hidden="true">open_in_new</span>
            </a>
            <button class="btn btn-ghost btn-sm" type="button" data-action="sakusen-close">とじる</button>
          </div>
          <p class="ct-muted">開く前に「今日のぶんを保存する」もわすれずに</p>
        </div>
      ` : ''}
    </div>
  `;
}

function renderEdit() {
  const draft = state.draft.edit || {};
  const isNew = !state.draft.editingId;
  const canApply = trimText(draft.label, LABEL_MAX).length > 0 && STATUSES.some(meta => meta.id === draft.status);
  document.querySelector('#screen-edit').innerHTML = `
    <div class="ct-panel">
      <h2 class="ct-panel__title" id="edit-title">${isNew ? '新しいたね' : 'たねをなおす'}</h2>
      <p class="ct-panel__lead">「ちょっとやってみたいかも」くらいで大丈夫。ここではまだ決めないよ</p>
      <div class="ct-form">
        <label class="ct-field">
          <span class="ct-field__label">どんなこと？</span>
          <input class="ct-field__input" id="seedLabel" maxlength="30" value="${esc(draft.label || '')}" data-input="seed-label" />
        </label>
        <label class="ct-field">
          <span class="ct-field__label">メモ（なくてもOK）</span>
          <input class="ct-field__input" maxlength="60" value="${esc(draft.memo || '')}" data-input="seed-memo" />
        </label>
        <p class="ct-muted">名前・学校名などは書かないでね</p>
      </div>
      <div class="ct-field" style="margin-top: var(--space-lg);">
        <div class="ct-field__label" id="edit-status-label">どのポケットに入れておく？（あとからいつでも動かせるよ）</div>
        <div class="ct-choice-grid" role="radiogroup" aria-labelledby="edit-status-label">
          ${STATUSES.map((meta, index) => `
            <button class="ct-choice" type="button" role="radio" aria-checked="${draft.status === meta.id ? 'true' : 'false'}" data-action="edit-status" data-value="${esc(meta.id)}" aria-label="${index + 1}番: ${esc(meta.label)}">
              <span class="ct-choice__num">${esc(NUMBERS[index])}</span>
              <span class="material-symbols-rounded ct-choice__icon" aria-hidden="true">${esc(meta.icon)}</span>
              <span class="ct-choice__text">${esc(meta.label)}</span>
              <span class="material-symbols-rounded ct-choice__check" aria-hidden="true">check_circle</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="ct-actions">
        <button class="btn btn-primary" id="seedSubmit" type="button" data-action="seed-apply"${canApply ? '' : ' disabled'}>これでいい</button>
        <button class="btn btn-ghost" type="button" data-action="back-home">← もどる</button>
      </div>
      ${isNew ? '' : deleteHtml(Boolean(state.draft.deleteConfirm))}
    </div>
  `;
}

function deleteHtml(confirming) {
  if (!confirming) {
    return `
      <div class="ct-delete">
        <button class="btn btn-ghost" type="button" data-action="delete-ask">このたねを消す</button>
      </div>
    `;
  }
  return `
    <div class="ct-delete ct-delete--confirm">
      <p>消したたねはもどせないよ。消してもいい？</p>
      <div class="ct-actions">
        <button class="btn btn-danger" type="button" data-action="delete-apply">消す</button>
        <button class="btn btn-ghost" type="button" data-action="delete-cancel">やめておく</button>
      </div>
    </div>
  `;
}

function renderSave(downloaded = false) {
  const filename = exportFilename();
  document.querySelector('#screen-save').innerHTML = `
    <div class="ct-panel">
      <h2 class="ct-panel__title" id="save-title">今日のたねを保存しよう</h2>
      ${markerHtml()}
      <p class="ct-muted" style="margin-top: var(--space-md);">ファイル名：${esc(filename)}</p>
      <div class="alert alert-info ct-alert">自由に書いたところに、名前・学校名などの個人情報が入っていないか、確かめてください</div>
      <div class="ct-actions">
        <button class="btn btn-primary" type="button" data-action="download-record">記録ファイルをダウンロード</button>
        <button class="btn btn-ghost" type="button" data-action="back-home">← もどる</button>
      </div>
      ${downloaded ? `
        <div class="alert alert-info ct-alert">ダウンロードしました。Googleドライブへの保存はメンターが行います</div>
        <div class="ct-actions">
          <button class="btn btn-secondary" type="button" data-action="back-home">ポケットにもどる</button>
          <button class="btn btn-ghost" type="button" data-action="finish-session">これで終わる</button>
        </div>
      ` : ''}
    </div>
  `;
}

function startEdit(seedId = null) {
  const seed = seedId ? findSeed(seedId) : null;
  state.draft.editingId = seed ? seed.id : null;
  state.draft.deleteConfirm = false;
  state.draft.edit = seed
    ? { label: seed.label, memo: seed.memo || '', status: seed.status }
    : { label: '', memo: '', status: null };
  renderEdit();
  showScreen('edit');
}

function applySeed() {
  const draft = state.draft.edit || {};
  const label = trimText(draft.label, LABEL_MAX);
  if (!label || !STATUSES.some(meta => meta.id === draft.status)) return;
  const memo = trimText(draft.memo, MEMO_MAX) || null;
  if (state.draft.editingId) {
    const seed = findSeed(state.draft.editingId);
    if (seed) {
      seed.label = label;
      seed.memo = memo;
      seed.status = draft.status;
    }
    showToast('たねをなおしたよ');
  } else {
    if (state.record.seeds.length >= MAX_SEEDS) {
      showToast('たねがいっぱいになったよ。どれかを消すと、新しいたねを増やせるよ');
      return;
    }
    state.record.seeds.push({
      id: makeId('s'),
      label,
      memo,
      status: draft.status,
      createdAt: nowIso(),
    });
    showToast('たねを増やしたよ');
  }
  state.record.updatedAt = nowIso();
  setDirty(true);
  state.draft = { closedOpen: state.draft.closedOpen };
  renderHome();
  showScreen('home');
}

function moveSeed(seedId, statusId) {
  const seed = findSeed(seedId);
  if (!seed || !STATUSES.some(meta => meta.id === statusId)) return;
  seed.status = statusId;
  if (state.draft.sakusenOpenId === seedId && statusId !== 'try') {
    state.draft.sakusenOpenId = null;
  }
  state.record.updatedAt = nowIso();
  setDirty(true);
  renderHome();
  showToast(`「${seed.label}」を「${statusMeta(statusId).label}」へ動かしたよ`);
}

function deleteSeed() {
  const id = state.draft.editingId;
  if (!id) return;
  state.record.seeds = state.record.seeds.filter(seed => seed.id !== id);
  state.record.updatedAt = nowIso();
  setDirty(true);
  state.draft = { closedOpen: state.draft.closedOpen };
  renderHome();
  showScreen('home');
  showToast('たねを消したよ');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok;
    } catch (fallbackError) {
      return false;
    }
  }
}

async function sakusenConsult(seedId) {
  const seed = findSeed(seedId);
  if (!seed) return;
  const copied = await copyText(seed.label);
  state.draft.sakusenOpenId = seedId;
  state.draft.sakusenCopied = copied;
  renderHome();
}

function exportFilename() {
  const parts = markerParts(state.record?.fileMarker);
  const date = new Date();
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `tane-record_${parts.animal.romaji}-${parts.color.romaji}_${ymd}.json`;
}

function downloadRecord() {
  if (!state.record) return;
  state.record.updatedAt = nowIso();
  const blob = new Blob([JSON.stringify(state.record, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFilename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setDirty(false);
  renderSave(true);
}

function handleFile(file) {
  if (!file || file.size > MAX_FILE_BYTES) {
    setStartError(IMPORT_ERROR_GENERIC);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result || ''));
    } catch (error) {
      setStartError(IMPORT_ERROR_GENERIC);
      return;
    }
    try {
      const record = normalizeImport(parsed);
      state.draft = { importRecord: record, startError: '' };
      renderLoadConfirm();
      showScreen('load-confirm');
    } catch (error) {
      setStartError(error.message);
    }
  };
  reader.onerror = () => {
    setStartError(IMPORT_ERROR_GENERIC);
  };
  reader.readAsText(file);
}

function normalizeImport(data) {
  if (!data || typeof data !== 'object' || data.app !== APP_ID) {
    throw new Error(IMPORT_ERROR_GENERIC);
  }
  if (typeof data.schemaVersion !== 'number') {
    throw new Error(IMPORT_ERROR_GENERIC);
  }
  if (data.schemaVersion > SCHEMA_VERSION) {
    throw new Error(IMPORT_ERROR_NEWER);
  }
  if (data.schemaVersion < SCHEMA_VERSION) {
    throw new Error(IMPORT_ERROR_GENERIC);
  }
  if (!Array.isArray(data.seeds) || data.seeds.length > MAX_SEEDS) {
    throw new Error(IMPORT_ERROR_CONTENT);
  }
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    fileMarker: normalizeMarker(data.fileMarker),
    createdAt: normalizeDate(data.createdAt),
    updatedAt: normalizeDate(data.updatedAt),
    seeds: data.seeds.map(normalizeSeed).filter(Boolean),
  };
}

function normalizeMarker(marker) {
  const color = FILE_MARKERS.colors.find(item => item.label === marker?.color)?.label || FILE_MARKERS.colors[0].label;
  const animal = FILE_MARKERS.animals.find(item => item.label === marker?.animal)?.label || FILE_MARKERS.animals[0].label;
  return { color, animal };
}

function normalizeDate(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function normalizeSeed(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = trimText(raw.label, LABEL_MAX);
  if (!label) return null;
  return {
    id: makeId('s'),
    label,
    memo: raw.memo == null ? null : trimText(raw.memo, MEMO_MAX) || null,
    status: STATUSES.some(meta => meta.id === raw.status) ? raw.status : 'watch',
    createdAt: normalizeDate(raw.createdAt),
  };
}

function handleAction(action, button) {
  const value = button.dataset.value || '';
  if (action === 'start-new') {
    state.record = createRecord();
    state.draft = {};
    startEdit();
  } else if (action === 'accept-import') {
    state.record = state.draft.importRecord;
    state.draft = {};
    setDirty(false);
    renderHome();
    showScreen('home');
  } else if (action === 'add-seed') {
    startEdit();
  } else if (action === 'edit-seed') {
    startEdit(value);
  } else if (action === 'move-seed') {
    moveSeed(value, button.dataset.status || '');
  } else if (action === 'edit-status') {
    state.draft.edit.status = value;
    renderEdit();
  } else if (action === 'seed-apply') {
    applySeed();
  } else if (action === 'delete-ask') {
    state.draft.deleteConfirm = true;
    renderEdit();
  } else if (action === 'delete-cancel') {
    state.draft.deleteConfirm = false;
    renderEdit();
  } else if (action === 'delete-apply') {
    deleteSeed();
  } else if (action === 'sakusen-consult') {
    sakusenConsult(value);
  } else if (action === 'sakusen-close') {
    state.draft.sakusenOpenId = null;
    renderHome();
  } else if (action === 'go-save') {
    state.draft.sakusenOpenId = null;
    renderSave();
    showScreen('save');
  } else if (action === 'download-record') {
    downloadRecord();
  } else if (action === 'back-home') {
    renderHome();
    showScreen('home');
  } else if (action === 'finish-session') {
    state.draft = {};
    renderStart();
    showScreen('start');
  }
}

function wireEvents() {
  document.body.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    handleAction(target.dataset.action, target);
  });

  document.body.addEventListener('input', event => {
    const input = event.target;
    const kind = input.dataset.input;
    if (!kind || !state.draft.edit) return;
    if (kind === 'seed-label') state.draft.edit.label = input.value;
    if (kind === 'seed-memo') state.draft.edit.memo = input.value;
    updateEditLive();
  });

  // <details> の開閉状態を再描画後も保つ（toggle はバブリングしないため capture で受ける）
  document.body.addEventListener('toggle', event => {
    if (event.target.classList?.contains('ct-closed')) {
      state.draft.closedOpen = event.target.open;
    }
  }, true);

  document.querySelector('#recordFile').addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    handleFile(file);
  });

  window.addEventListener('beforeunload', event => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

function updateEditLive() {
  const submit = document.querySelector('#seedSubmit');
  const draft = state.draft.edit || {};
  if (submit) {
    submit.disabled = !(trimText(draft.label, LABEL_MAX).length > 0 && STATUSES.some(meta => meta.id === draft.status));
  }
}

renderStart();
showScreen('start');
wireEvents();

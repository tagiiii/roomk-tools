const NUMBERS = ['①', '②', '③', '④'];
const APP_ID = 'sukina-map';
const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_ITEMS = 100;
const MAX_LABEL = 20;

const CATEGORIES = [
  { id: 'game', label: 'ゲーム', icon: 'sports_esports' },
  { id: 'video', label: '動画', icon: 'movie' },
  { id: 'music', label: '音楽', icon: 'music_note' },
  { id: 'make', label: 'つくる', icon: 'construction' },
  { id: 'draw', label: 'かく', icon: 'draw' },
  { id: 'animal', label: '動物', icon: 'pets' },
  { id: 'vehicle', label: 'のりもの', icon: 'directions_bus' },
  { id: 'sports', label: 'スポーツ', icon: 'sports_soccer' },
  { id: 'food', label: 'たべもの', icon: 'restaurant' },
  { id: 'research', label: 'しらべる', icon: 'search' },
  { id: 'collect', label: 'あつめる', icon: 'inventory_2' },
  { id: 'other', label: 'その他', icon: 'category' },
];

const CLOSENESS_LEVELS = [
  { value: 1, label: 'だいすき・よくやる' },
  { value: 2, label: 'すき' },
  { value: 3, label: 'ちょっと気になる' },
  { value: 4, label: '見るのはあり・まえはすきだった' },
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

const IMPORT_ERROR_GENERIC = 'このファイルは読み込めませんでした。すきなことマップでほぞんしたファイルか、たしかめてください';
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
    items: [],
  };
}

function setDirty(value = true) {
  state.dirty = value;
}

function categoryById(id) {
  return CATEGORIES.find(category => category.id === id) || null;
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
    <div class="sm-marker">
      <span class="material-symbols-rounded" aria-hidden="true">${esc(parts.animal.icon)}</span>
      <span>${esc(parts.color.label)}の${esc(parts.animal.label)}</span>
    </div>
  `;
}

function renderStart() {
  const error = state.draft.startError
    ? `<div class="alert alert-error sm-alert" aria-live="assertive">${esc(state.draft.startError)}</div>`
    : '';
  document.querySelector('#screen-start').innerHTML = `
    <div class="sm-panel">
      <h2 class="sm-panel__title" id="start-title">すきなことマップ</h2>
      <p class="sm-panel__lead">すき・気になるものをカードにして、「じぶん」のまわりに ならべていくよ</p>
      ${error}
      <div class="sm-choice-grid" role="group" aria-label="はじめ方">
        <button class="sm-choice" type="button" data-action="start-new">
          <span class="sm-choice__num">①</span>
          <span class="sm-choice__text">はじめて マップをつくる</span>
        </button>
        <label class="sm-choice sm-file-label" for="recordFile">
          <span class="sm-choice__num">②</span>
          <span class="sm-choice__text">前回のファイルをひらく</span>
        </label>
      </div>
      <p class="sm-muted" style="margin-top: var(--space-md);">このアプリはデータをどこにも保存しません。おわるときにファイルをダウンロードして持ち帰ります</p>
    </div>
  `;
}

function renderLoadConfirm() {
  const record = state.draft.importRecord;
  const items = record?.items || [];
  const sample = items.slice(0, 6);
  const sampleHtml = sample.length
    ? `
      <div class="sm-sample">
        ${sample.map(item => staticItemHtml(item)).join('')}
        ${items.length > sample.length ? '<span class="sm-muted">…ほかにもあるよ</span>' : ''}
      </div>
    `
    : '<p class="sm-muted" style="margin-top: var(--space-md);">まだカードのないマップだよ</p>';
  document.querySelector('#screen-load-confirm').innerHTML = `
    <div class="sm-panel">
      <h2 class="sm-panel__title" id="load-confirm-title">このマップで つづきをはじめる？</h2>
      ${markerHtml(record)}
      <p class="sm-muted" style="margin-top: var(--space-md);">さいごにひらいた日：${esc(formatDate(record?.updatedAt))}</p>
      ${sampleHtml}
      <div class="sm-actions">
        <button class="btn btn-primary" type="button" data-action="accept-import">①このマップではじめる</button>
        <label class="btn btn-ghost" for="recordFile">②ちがうファイルをえらび直す</label>
      </div>
    </div>
  `;
}

function staticItemHtml(item) {
  const category = categoryById(item.category);
  return `
    <span class="sm-item sm-item--static">
      ${category ? `<span class="material-symbols-rounded sm-item__icon" aria-hidden="true">${esc(category.icon)}</span>` : ''}
      <span class="sm-item__label">${esc(item.label)}</span>
    </span>
  `;
}

function itemChipHtml(item) {
  const category = categoryById(item.category);
  return `
    <button class="sm-item" type="button" data-action="edit-item" data-value="${esc(item.id)}" aria-label="カードをなおす: ${esc(item.label)}">
      ${category ? `<span class="material-symbols-rounded sm-item__icon" aria-hidden="true">${esc(category.icon)}</span>` : ''}
      <span class="sm-item__label">${esc(item.label)}</span>
    </button>
  `;
}

function laneHtml(level, index) {
  const items = (state.record?.items || []).filter(item => item.closeness === level.value);
  return `
    <div class="sm-lane sm-lane--${level.value}">
      <div class="sm-lane__label">
        <span class="sm-lane__num">${esc(NUMBERS[index])}</span>
        <span>${esc(level.label)}</span>
      </div>
      <div class="sm-lane__items">${items.map(itemChipHtml).join('')}</div>
    </div>
  `;
}

function emptyGuideHtml() {
  return `
    <div class="sm-guide">
      <p class="sm-guide__main">さいきん 見たもの・さわったものから さがしてみよう</p>
      <p class="sm-muted">「ちょっと気になる」「見るのはあり」くらいのものから おいて だいじょうぶ</p>
    </div>
  `;
}

function editorHtml() {
  const editor = state.draft.editor;
  const isEdit = editor.mode === 'edit';
  const canSubmit = editorCanSubmit();
  return `
    <div class="sm-editor" role="group" aria-label="${isEdit ? 'カードをなおす' : 'カードをふやす'}">
      <h3 class="sm-editor__title">${isEdit ? 'カードをなおす' : 'カードをふやす'}</h3>
      <label class="sm-field">
        <span class="sm-field__label">カードのなまえ（20文字まで）</span>
        <input class="sm-field__input" id="itemLabel" maxlength="${MAX_LABEL}" value="${esc(editor.label || '')}" data-input="item-label" />
        <span class="sm-muted">なまえ・学校名などの個人じょうほうは書かないでね</span>
      </label>
      <div class="sm-field">
        <div class="sm-field__label">ジャンル（えらばなくてもOK）</div>
        <div class="sm-chip-row" role="radiogroup" aria-label="ジャンル">
          ${CATEGORIES.map(category => `
            <button class="sm-chip" type="button" role="radio" aria-checked="${editor.category === category.id ? 'true' : 'false'}" data-action="choose-category" data-value="${esc(category.id)}">
              <span class="material-symbols-rounded sm-chip__icon" aria-hidden="true">${esc(category.icon)}</span>
              ${esc(category.label)}
            </button>
          `).join('')}
        </div>
      </div>
      <div class="sm-field">
        <div class="sm-field__label">「じぶん」からの近さ</div>
        <div class="sm-choice-grid" role="radiogroup" aria-label="じぶんからの近さ">
          ${CLOSENESS_LEVELS.map((level, index) => `
            <button class="sm-choice" type="button" role="radio" aria-checked="${editor.closeness === level.value ? 'true' : 'false'}" data-action="choose-closeness" data-value="${esc(String(level.value))}" aria-label="${index + 1}番: ${esc(level.label)}">
              <span class="sm-choice__num">${esc(NUMBERS[index])}</span>
              <span class="sm-choice__text">${esc(level.label)}</span>
              <span class="material-symbols-rounded sm-choice__check" aria-hidden="true">check_circle</span>
            </button>
          `).join('')}
        </div>
        <span class="sm-muted">近さは あとから いつでも うごかせるよ。すきが かわるのは ふつうのこと</span>
      </div>
      <div class="sm-actions">
        <button class="btn btn-primary" id="editorSubmit" type="button" data-action="editor-submit"${canSubmit ? '' : ' disabled'}>${isEdit ? 'これでOK' : 'マップにおく'}</button>
        <button class="btn btn-ghost" type="button" data-action="editor-cancel">やめておく</button>
        ${isEdit ? '<button class="btn btn-danger" type="button" data-action="delete-item">このカードをけす</button>' : ''}
      </div>
    </div>
  `;
}

function editorCanSubmit() {
  const editor = state.draft.editor;
  if (!editor) return false;
  const hasLabel = trimText(editor.label, MAX_LABEL).length > 0;
  const hasCloseness = CLOSENESS_LEVELS.some(level => level.value === editor.closeness);
  return hasLabel && hasCloseness;
}

function renderMap() {
  const items = state.record?.items || [];
  const editor = state.draft.editor;
  const atLimit = items.length >= MAX_ITEMS;
  const footer = editor ? editorHtml() : `
    <div class="sm-actions sm-actions--between">
      <div>
        ${atLimit
          ? '<p class="sm-muted">これ以上カードをふやせません。つかわないカードをけすと、またおけるよ</p>'
          : '<button class="btn btn-primary" type="button" data-action="open-add">カードをふやす</button>'}
      </div>
      <button class="btn btn-secondary" type="button" data-action="go-save">きょうはここまで（ほぞんする）</button>
    </div>
  `;
  document.querySelector('#screen-map').innerHTML = `
    <div class="sm-panel">
      <h2 class="sm-panel__title" id="map-title">じぶんの すきなことマップ</h2>
      ${markerHtml()}
      ${items.length === 0 ? emptyGuideHtml() : ''}
      <div class="sm-map">
        <div class="sm-map__self">
          <span class="material-symbols-rounded" aria-hidden="true">face</span>
          <span>じぶん</span>
        </div>
        ${CLOSENESS_LEVELS.map(laneHtml).join('')}
      </div>
      ${footer}
    </div>
  `;
}

function renderSave(downloaded = false) {
  const filename = exportFilename();
  document.querySelector('#screen-save').innerHTML = `
    <div class="sm-panel">
      <h2 class="sm-panel__title" id="save-title">きょうのマップを ほぞんしよう</h2>
      ${markerHtml()}
      <p class="sm-muted" style="margin-top: var(--space-md);">ファイル名：${esc(filename)}</p>
      <div class="alert alert-info sm-alert">カードのなまえに、なまえ・学校名などの個人じょうほうが入っていないか、たしかめてください</div>
      <div class="sm-actions">
        <button class="btn btn-primary" type="button" data-action="download-record">マップのファイルをダウンロード</button>
        ${downloaded ? '' : '<button class="btn btn-ghost" type="button" data-action="back-map">← マップにもどる</button>'}
      </div>
      ${downloaded ? `
        <div class="alert alert-info sm-alert">ダウンロードしました。Googleドライブへの保存はメンターがおこないます</div>
        <div class="sm-actions">
          <button class="btn btn-secondary" type="button" data-action="back-map">マップにもどる</button>
          <button class="btn btn-ghost" type="button" data-action="finish-session">これでおわる</button>
        </div>
      ` : ''}
    </div>
  `;
}

function openEditor(mode, itemId = null) {
  if (mode === 'edit') {
    const item = (state.record?.items || []).find(entry => entry.id === itemId);
    if (!item) return;
    state.draft.editor = {
      mode: 'edit',
      itemId,
      label: item.label,
      category: item.category,
      closeness: item.closeness,
    };
  } else {
    state.draft.editor = { mode: 'add', itemId: null, label: '', category: null, closeness: null };
  }
  renderMap();
  document.querySelector('#itemLabel')?.focus();
}

function closeEditor() {
  state.draft.editor = null;
  renderMap();
}

function submitEditor() {
  const editor = state.draft.editor;
  if (!editorCanSubmit()) return;
  const label = trimText(editor.label, MAX_LABEL);
  if (editor.mode === 'add') {
    if ((state.record.items || []).length >= MAX_ITEMS) {
      closeEditor();
      return;
    }
    state.record.items.push({
      id: makeId('i'),
      label,
      category: editor.category,
      closeness: editor.closeness,
      createdAt: nowIso(),
    });
    showToast('マップに おいたよ');
  } else {
    const item = state.record.items.find(entry => entry.id === editor.itemId);
    if (item) {
      item.label = label;
      item.category = editor.category;
      item.closeness = editor.closeness;
      showToast('カードを なおしたよ');
    }
  }
  state.record.updatedAt = nowIso();
  setDirty(true);
  closeEditor();
}

function deleteItem() {
  const editor = state.draft.editor;
  if (!editor || editor.mode !== 'edit') return;
  state.record.items = state.record.items.filter(entry => entry.id !== editor.itemId);
  state.record.updatedAt = nowIso();
  setDirty(true);
  showToast('カードを けしたよ');
  closeEditor();
}

function handleAction(action, button) {
  const value = button.dataset.value || '';
  if (action === 'start-new') {
    state.record = createRecord();
    state.draft = {};
    setDirty(false);
    renderMap();
    showScreen('map');
  } else if (action === 'accept-import') {
    state.record = state.draft.importRecord;
    state.draft = {};
    setDirty(false);
    renderMap();
    showScreen('map');
  } else if (action === 'open-add') {
    openEditor('add');
  } else if (action === 'edit-item') {
    openEditor('edit', value);
  } else if (action === 'choose-category') {
    const editor = state.draft.editor;
    if (editor) {
      editor.category = editor.category === value ? null : value;
      renderMap();
    }
  } else if (action === 'choose-closeness') {
    const editor = state.draft.editor;
    if (editor) {
      editor.closeness = Number(value);
      renderMap();
    }
  } else if (action === 'editor-submit') {
    submitEditor();
  } else if (action === 'editor-cancel') {
    closeEditor();
  } else if (action === 'delete-item') {
    deleteItem();
  } else if (action === 'go-save') {
    renderSave();
    showScreen('save');
  } else if (action === 'download-record') {
    downloadRecord();
  } else if (action === 'back-map') {
    renderMap();
    showScreen('map');
  } else if (action === 'finish-session') {
    state.record = null;
    state.draft = {};
    setDirty(false);
    renderStart();
    showScreen('start');
  }
}

function exportFilename() {
  const parts = markerParts(state.record?.fileMarker);
  const date = new Date();
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `sukina-map_${parts.animal.romaji}-${parts.color.romaji}_${ymd}.json`;
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
  if (!Array.isArray(data.items) || data.items.length > MAX_ITEMS) {
    throw new Error(IMPORT_ERROR_CONTENT);
  }
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    fileMarker: normalizeMarker(data.fileMarker),
    createdAt: normalizeDate(data.createdAt),
    updatedAt: normalizeDate(data.updatedAt),
    items: data.items.map(normalizeItem).filter(Boolean),
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

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = trimText(raw.label, MAX_LABEL);
  if (!label) return null;
  return {
    id: makeId('i'),
    label,
    category: CATEGORIES.some(category => category.id === raw.category) ? raw.category : null,
    closeness: Number.isInteger(raw.closeness) && raw.closeness >= 1 && raw.closeness <= 4 ? raw.closeness : 3,
    createdAt: normalizeDate(raw.createdAt),
  };
}

function updateEditorLive() {
  const submit = document.querySelector('#editorSubmit');
  if (submit) submit.disabled = !editorCanSubmit();
}

function wireEvents() {
  document.body.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    handleAction(target.dataset.action, target);
  });

  document.body.addEventListener('input', event => {
    const input = event.target;
    if (input.dataset.input !== 'item-label') return;
    if (!state.draft.editor) return;
    state.draft.editor.label = trimText(input.value, MAX_LABEL);
    updateEditorLive();
  });

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

function init() {
  renderStart();
  showScreen('start');
  wireEvents();
}

init();

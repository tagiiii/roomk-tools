// Run: node --test scripts/tests/test-room-ui.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../apps/shared/js/rtdb-utils.js', import.meta.url), 'utf8');
function setup({ writeText, fallback = () => true } = {}) {
  const nodes = new Map();
  const appended = [];
  let restoredFocus = 0;
  const document = {
    activeElement: { focus() { restoredFocus++; } },
    getElementById: id => nodes.get(id),
    createElement(tag) {
      return { tag, style: {}, setAttribute() {}, select() {},
        remove() { this.removed = true; nodes.delete(this.id); } };
    },
    body: { appendChild(el) { appended.push(el); if (el.id) nodes.set(el.id, el); } },
    execCommand: fallback,
  };
  const context = { window: {}, document, navigator: writeText ? { clipboard: { writeText } } : {}, setTimeout() {}, console };
  vm.runInNewContext(source, context);
  return { api: context.window.RoomkRTDB, nodes, appended, focusCount: () => restoredFocus };
}

test('copies only the code, prevents concurrent clicks, and permits retry', async () => {
  let resolve, calls = 0;
  const { api, nodes } = setup({ writeText: text => {
    assert.equal(text, 'ABC234'); calls++;
    return new Promise(done => { resolve = done; });
  } });
  const button = { dataset: {} };
  const pending = api.copyRoomCode('ABC234', button);
  assert.equal(await api.copyRoomCode('ABC234', button), false);
  assert.equal(calls, 1);
  resolve();
  assert.equal(await pending, true);
  assert.equal(button.dataset.copyBusy, undefined);
  assert.equal(nodes.get('roomk-toast').textContent, 'コードをコピーしました');
  const retry = api.copyRoomCode('ABC234', button);
  resolve(); await retry;
  assert.equal(calls, 2);
});

for (const unavailable of [true, false]) {
  test(`fallback copies and restores focus when Clipboard API is ${unavailable ? 'missing' : 'rejected'}`, async () => {
    const { api, appended, focusCount } = setup({ writeText: unavailable ? undefined : async () => { throw Error('denied'); } });
    assert.equal(await api.copyRoomCode('ABC234'), true);
    const textarea = appended.find(el => el.tag === 'textarea');
    assert.equal(textarea.value, 'ABC234');
    assert.equal(textarea.removed, true);
    assert.equal(focusCount(), 1);
  });
}

for (const throws of [false, true]) {
  test(`fallback ${throws ? 'exception' : 'false result'} reports failure and cleans up`, async () => {
    const { api, nodes, appended } = setup({ fallback: () => { if (throws) throw Error('denied'); return false; } });
    const button = { dataset: {} };
    assert.equal(await api.copyRoomCode('ABC234', button), false);
    assert.match(nodes.get('roomk-toast').textContent, /^コピーできませんでした/);
    assert.equal(button.dataset.copyBusy, undefined);
    assert.equal(appended.find(el => el.tag === 'textarea').removed, true);
  });
}

test('missing code does not write placeholders to the clipboard', async () => {
  let calls = 0;
  const { api } = setup({ writeText: async () => { calls++; } });
  for (const code of [null, '', '----']) assert.equal(await api.copyRoomCode(code), false);
  assert.equal(calls, 0);
});

test('form error is plain text and clears explicitly', () => {
  const { api, nodes } = setup();
  const error = { hidden: true, textContent: '' }; nodes.set('join-error', error);
  api.showFormError('join-error', '<img src=x>');
  assert.equal(error.textContent, '<img src=x>');
  assert.equal(error.hidden, false);
  api.showFormError('join-error', '');
  assert.equal(error.hidden, true);
});

test('module copy helper also recovers from fallback exceptions', async () => {
  const moduleSource = readFileSync(new URL('../../apps/shared/js/utils.js', import.meta.url), 'utf8');
  let removed = false;
  const context = {
    navigator: {}, setTimeout() {},
    document: {
      activeElement: { focus() {} },
      createElement: () => ({ style: {}, select() {}, remove() { removed = true; } }),
      body: { appendChild() {} }, execCommand() { throw Error('denied'); },
    },
  };
  vm.runInNewContext(moduleSource.replace(/export /g, '') + '\nthis.copy = copyToClipboard;', context);
  const button = { dataset: {} };
  assert.equal(await context.copy('ABC234', button), false);
  assert.equal(button.dataset.copyBusy, undefined);
  assert.equal(removed, true);
});

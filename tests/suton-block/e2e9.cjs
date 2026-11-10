// すとんブロック E2E その9: すとん・段を消したときの動き（2026-11-11）
// ひとりであそぶ（通信しない）で、盤の canvas の色を見る。
// すとん: 落ちる前の所から置いた所まで残像が出て、すぐ消える・盤が少し沈む（is-thud）
// 段を消す: 消えた段の所が白く光って、すぐ消える
// 動きを減らす設定: 盤を沈ませない・残像を出さない・段の所が光るのは残す
const L = require('./lib.cjs');
const { check, sleep, waitScreen, shot } = L;

// 盤の (列 x, 行 r) のまん中の色。行は盤の上の帯2段を含めた 22 段で数える（0・1 が帯）
const PROBE = `(x, r) => {
  const c = document.getElementById('board');
  const ctx = c.getContext('2d');
  return Array.from(ctx.getImageData(Math.floor((x + 0.5) * c.width / 10), Math.floor((r + 0.5) * c.height / 22), 1, 1).data);
}`;

async function soloPlay(label, calm = false) {
  const C = await L.newClient(label);
  if (calm) await C.page.emulateMedia({ reducedMotion: 'reduce' });
  await L.open(C);
  await C.page.click('#btnGoSolo');
  await waitScreen(C, 'solo');
  await C.page.click('#btnSoloStart');
  await waitScreen(C, 'play');
  await sleep(400);
  return C;
}

// すとんを押して、2フレームあとの色を見る（col 4 はどの形でも出たブロックがかかる列）
async function dropAndProbe(C, fake) {
  return C.page.evaluate(({ probeSrc, fake }) => {
    const probe = eval(probeSrc); // eslint-disable-line no-eval
    if (fake) {
      const E = window.SutonEngine;
      const orig = E.hardDrop;
      E.hardDrop = (g) => { E.hardDrop = orig; return Object.assign(orig(g), fake); };
    }
    const before = { trail: probe(4, 10), empty: probe(0, 10), row: probe(0, 21) };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      before,
      trail: probe(4, 10),
      empty: probe(0, 10),
      row: probe(0, 21),
      thud: document.getElementById('board').classList.contains('is-thud'),
      anim: getComputedStyle(document.getElementById('board')).animationName,
    }))));
  }, { probeSrc: PROBE, fake: fake || null });
}
const probeNow = (C) => C.page.evaluate((probeSrc) => {
  const probe = eval(probeSrc); // eslint-disable-line no-eval
  return { trail: probe(4, 10), empty: probe(0, 10), row: probe(0, 21) };
}, PROBE);
const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
const bright = (px) => px[0] > 150 && px[1] > 150 && px[2] > 150;

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── ふつうの設定 ──
  const A = await soloPlay('fx');
  check('F0 はじめは盤の10段目の列4と列0は同じ空きの色', same((await probeNow(A)).trail, (await probeNow(A)).empty));
  const d1 = await dropAndProbe(A);
  check('F1 すとんの直後、落ちてきた列に残像が出る', !same(d1.trail, d1.empty), d1);
  check('F2 すとんで盤が少し沈む（is-thud）', d1.thud && d1.anim === 'sb-thud', { thud: d1.thud, anim: d1.anim });
  await shot(A, 'e2e9-drop');
  await sleep(400);
  const a1 = await probeNow(A);
  check('F3 残像はすぐ消える（0.4秒あとには空きの色）', same(a1.trail, a1.empty), a1);

  // 段を消したときの光り方は、結果だけ差しかえて見る（消し方のしくみはしくみのテストで確かめている）
  const d2 = await dropAndProbe(A, { lines: 1, rows: [19] });
  check('F4 段を消すと、消えた段の所が白く光る', bright(d2.row) && !same(d2.row, d2.before.row), d2);
  await shot(A, 'e2e9-clear');
  await sleep(500);
  const a2 = await probeNow(A);
  check('F5 光りはすぐ消える（0.5秒あとには白くない）', !bright(a2.row), a2);

  // ── 動きを減らす設定 ──
  const B = await soloPlay('fx-calm', true);
  const d3 = await dropAndProbe(B);
  check('F6 動きを減らす設定では、残像を出さない', same(d3.trail, d3.empty), d3);
  check('F7 動きを減らす設定では、盤を沈ませない', !d3.thud && d3.anim === 'none', { thud: d3.thud, anim: d3.anim });
  const d4 = await dropAndProbe(B, { lines: 1, rows: [19] });
  check('F8 動きを減らす設定でも、消えた段の所は光る', bright(d4.row), d4);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });

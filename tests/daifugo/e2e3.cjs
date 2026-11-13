// 大富豪 E2E その3: 動き・配る演出・効果音（2026-11-13）
// ホスト＋CPU3人＋375pxの参加者＋みんなにみせる画面で最後まで遊び、動きの写し・配る・効果音を確かめる。
// 動きを減らす設定では写しを出さないことも見る。
const L = require('./lib.cjs');
const { sleep, waitScreen, check } = L;

// 動きの写し・大きな文字・音の数を数える（lib の __audioMade とは別に、音を1つ鳴らすたびの数）
const WATCH = () => {
  window.__FX__ = { ghost: 0, deal: 0, slash: 0, bit: 0, splash: [], freshSeen: false, reveal: 0, lift: 0 };
  window.__SND__ = 0;
  if (window.BaseAudioContext) {
    ['createOscillator', 'createBufferSource'].forEach((m) => {
      const orig = BaseAudioContext.prototype[m];
      BaseAudioContext.prototype[m] = function (...a) { window.__SND__ += 1; return orig.apply(this, a); };
    });
  }
  document.addEventListener('DOMContentLoaded', () => new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      const F = window.__FX__;
      if (n.classList.contains('df-fx__card')) { F.ghost += 1; if (n.classList.contains('is-deal')) F.deal += 1; }
      if (n.classList.contains('df-fx__slash')) F.slash += 1;
      if (n.classList.contains('df-fx__bit')) F.bit += 1;
      if (n.classList.contains('df-splash__text')) F.splash.push(n.textContent);
    }
  }).observe(document.body, { childList: true, subtree: true }));
  setInterval(() => {
    const F = window.__FX__;
    if (!F) return;
    if (document.querySelector('.df-news__item.is-fresh')) F.freshSeen = true;
    if (document.querySelector('.df-result__item.is-reveal')) F.reveal = document.querySelectorAll('.df-result__item.is-reveal').length;
    if (document.querySelector('button.df-card.is-lift')) F.lift += 1;
  }, 50);
};

const fx = (c) => c.page.evaluate(() => window.__FX__);
const snd = (c) => c.page.evaluate(() => window.__SND__);
const audioMade = (c) => c.page.evaluate(() => window.__audioMade);

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host', { viewport: { width: 1000, height: 900 } });
  await H.page.addInitScript(WATCH);
  const code = await L.createRoom(H, 'そら');
  for (let k = 0; k < 3; k += 1) await H.page.click('#btnAddCpu');
  await H.page.waitForFunction(() => document.querySelector('#lobbyCount').textContent.includes('4人'));
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 800 } });
  await W.page.addInitScript(WATCH);
  await L.open(W, '?watch=' + code);
  const M = await L.newClient('mobile', { viewport: { width: 375, height: 812 } });
  await M.page.addInitScript(WATCH);
  await L.joinRoom(M, 'うみ', code);

  // 効果音: はじめは切。待合室に出る（みんなにみせる画面には出ない）
  check('sfx default off (host)', await H.page.isChecked('input[name="lobbySfx"][value="off"]'));
  check('sfx shown in lobby (mobile)', await L.visible(M, '#lobbySfx'));
  check('sfx hidden on watch', !(await L.visible(W, '#lobbySfx')));
  // スマホの人は待合室で入にする（端末に残り、ゲームの画面の切りかえもそろう）
  await M.page.click('input[name="lobbySfx"][value="on"]');
  check('sfx saved on device', (await M.page.evaluate(() => localStorage.getItem('daifugo:sfx'))) === '1');
  await sleep(200);
  check('sfx preview sound on toggle', (await snd(M)) > 0, await snd(M));
  check('host makes no audio while off', (await audioMade(H)) === 0);
  const roomRaw = await L.roomOf(code);
  check('sfx not written to room', !JSON.stringify(roomRaw).includes('sfx'));

  await H.page.click('#btnStartGame');
  await waitScreen(H, 'game');
  await waitScreen(M, 'game', 15000);
  await sleep(600);
  await H.page.screenshot({ path: L.OUT + '/e3-deal-host.png' });
  await M.page.screenshot({ path: L.OUT + '/e3-deal-mobile.png' });
  check('game sfx toggle synced (mobile)', await M.page.isChecked('input[name="gameSfx"][value="on"]'));
  check('game sfx hidden on watch', !(await L.visible(W, '#gameSfx')));
  await sleep(1500);
  for (const c of [H, W, M]) {
    const F = await fx(c);
    check('deal ghosts: ' + c.label, F.deal >= 12, F.deal);
  }
  const sndAfterDeal = await snd(M);
  check('deal sounds (mobile)', sndAfterDeal > 3, sndAfterDeal);

  // 自分の番の合図: 番の人にだけ卓のふちの「あなたの番！」が出る（みんなにみせる画面には出ない）
  let markSeen = 0; let markWrong = 0; let shotTurn = false;
  const markCheck = async () => {
    for (const c of [H, M]) {
      const st = await c.page.evaluate(() => ({ mark: !document.getElementById('myTurnMark').hidden, mine: document.getElementById('dock').classList.contains('is-myturn') }));
      if (st.mark !== st.mine) markWrong += 1;
      if (st.mark) {
        markSeen += 1;
        if (!shotTurn) {
          shotTurn = true;
          await c.page.screenshot({ path: L.OUT + '/e3-myturn-' + c.label + '.png' });
          // 札が下の手札の欄に隠れていない（札の下のほうに札そのものがある。札は押せない作りなので、確かめる間だけ押せるようにする）
          const top = await c.page.evaluate(() => { const m = document.getElementById('myTurnMark'); m.style.pointerEvents = 'auto'; const r = m.getBoundingClientRect(); const n = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.75); m.style.pointerEvents = ''; return !!n && !!n.closest('#myTurnMark'); });
          check('my turn mark not covered: ' + c.label, top);
        }
      }
    }
    if (!(await W.page.evaluate(() => document.getElementById('myTurnMark').hidden))) markWrong += 100;
  };
  // 最後まで（ホストとスマホの人の番を進める）
  for (let n = 0; n < 900; n += 1) {
    if (await L.isOver(H)) break;
    await markCheck();
    await L.humanMove(H);
    await L.humanMove(M);
    await sleep(100);
  }
  check('my turn mark shown on my turn', markSeen > 0, markSeen);
  check('my turn mark only on my turn, never on watch', markWrong === 0, markWrong);
  await sleep(3000);
  for (const c of [H, W, M]) {
    const F = await fx(c);
    console.log(c.label, JSON.stringify(F));
    check('play ghosts or fx: ' + c.label, F.ghost > F.deal || F.slash > 0 || F.bit > 0, F);
    check('news fresh: ' + c.label, F.freshSeen, F);
    check('result reveal: ' + c.label, F.reveal > 0, F);
    check('layer cleans up: ' + c.label, (await c.page.evaluate(() => document.getElementById('fxLayer')?.childElementCount || 0)) === 0);
  }
  check('lift on pick (host)', (await fx(H)).lift > 0);
  check('sounds during game (mobile)', (await snd(M)) > sndAfterDeal + 5, await snd(M));
  check('no sound on watch', (await audioMade(W)) === 0 && (await snd(W)) === 0);
  check('no sound on host (off)', (await audioMade(H)) === 0 && (await snd(H)) === 0);
  check('no overflow mobile', (await L.overflow(M)) <= 0);
  await M.page.screenshot({ path: L.OUT + '/e3-result-mobile.png', fullPage: true });

  check('mobile made audio while on', (await audioMade(M)) === 1, await audioMade(M));
  // 読み込み直しても入のまま。ゲームの画面で切にすると鳴らない
  await M.page.reload();
  await M.page.waitForFunction(() => document.querySelector('.df-screen.active'));
  await sleep(1500);
  check('sfx kept after reload', await M.page.isChecked('input[name="gameSfx"][value="on"]'));
  await M.page.click('input[name="gameSfx"][value="off"]');
  check('sfx off saved', (await M.page.evaluate(() => localStorage.getItem('daifugo:sfx'))) === '0');
  check('lobby sfx synced off', await M.page.isChecked('input[name="lobbySfx"][value="off"]'));

  // 動きを減らす設定: 写しを出さない（配るも）
  const R = await L.newClient('reduced', { viewport: { width: 1000, height: 900 } });
  await R.page.emulateMedia({ reducedMotion: 'reduce' });
  await R.page.addInitScript(WATCH);
  await L.createRoom(R, 'そら');
  for (let k = 0; k < 3; k += 1) await R.page.click('#btnAddCpu');
  await R.page.waitForFunction(() => document.querySelector('#lobbyCount').textContent.includes('4人'));
  await R.page.click('#btnStartGame');
  await waitScreen(R, 'game');
  for (let n = 0; n < 40; n += 1) { await L.humanMove(R); await sleep(150); }
  const FR = await fx(R);
  console.log('reduced', JSON.stringify(FR));
  check('reduced: no ghosts', FR.ghost === 0 && FR.bit === 0 && FR.slash === 0, FR);

  // スマホの人は入にしていたので音の部品を作る（lib の「音なし」の検査は、はじめは切のときの約束なので、上で確かめたうえで外す）
  await M.page.evaluate(() => { window.__audioMade = 0; });
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });

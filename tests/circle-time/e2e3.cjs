// サークルタイム E2E その3: 今日は何の日の毎朝のデータ（自動で入る・1つだけ本当・別の候補・3つとも本当・答えとカードごとの由来・覚える）・まだ用意されていないとき・本当が2つの日・つかいかた
const L = require('./lib.cjs');
const { check, sleep } = L;

const DAILY = {
  source: 'Wikipedia「テスト」記念日・年中行事',
  real: [
    { name: '鍋の日', note: '冬のはじまりの語呂合わせ' },
    { name: 'ココアの日', note: 'お菓子の会社が申しこんだ' },
    { name: 'うどんの日', note: 'たらいの器のうどん' },
    { name: 'トイレの日', note: 'いいトイレの語呂合わせ' },
  ],
  fake: [{ name: 'てぶくろの日' }, { name: 'ゆたんぽの日' }],
};

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host', { daily: DAILY });
  const A = await L.newClient('yui', { viewport: { width: 375, height: 812 } });
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  // ── A. 自動で入る（1つだけ本当） ──
  await L.open(H);
  check('A1 つかいかたの「？」がトップにある', await L.visible(H, '.howto-fab'));
  await H.page.click('#go-create');
  await H.page.evaluate(() => { document.getElementById('setup-more').open = true; });
  await H.page.click('#seg-session button[data-v="am"]');
  await L.waitText(H, '#day-status-text', '入っています');
  const day = Number(L.jstToday().slice(-2));
  const vals = async () => [0, 1, 2].map((i) => i).length && Promise.all([0, 1, 2].map((i) => H.page.inputValue('#day-' + i)));
  let v = await vals();
  const pos = day % 3;
  check('A2 本当の記念日が決まった位置に入る', v[pos] === '鍋の日', v);
  check('A3 ほかの2つは作り話', v.filter((x, i) => i !== pos).every((x) => ['てぶくろの日', 'ゆたんぽの日'].includes(x)), v);
  check('A4 本当に印・由来が入る', (await H.page.isChecked(`input[name="day-ok"][value="${pos}"]`)) && (await H.page.inputValue('#day-note')) === '冬のはじまりの語呂合わせ');
  check('A5 出典を出す', (await L.text(H, '#day-status-text')).includes('Wikipedia'));
  await H.page.click('#day-other');
  v = await vals();
  check('A6 別の候補にすると次の本当の記念日', v[(day + 1) % 3] === 'ココアの日' && (await H.page.inputValue('#day-note')) === 'お菓子の会社が申しこんだ', v);

  // ── B. 3つとも本当 ──
  await H.page.click('#day-mode button[data-v="all"]');
  v = await vals();
  check('B1 本当の記念日が3つ入る', JSON.stringify(v) === JSON.stringify(['鍋の日', 'ココアの日', 'うどんの日']), v);
  check('B2 本当の印は隠れ、説明が出る', !(await L.visible(H, '#am-fields label.ok')) && await L.visible(H, '#day-all-help'));
  await H.page.click('#day-other');
  v = await vals();
  check('B3 別の候補で次の3つ', JSON.stringify(v) === JSON.stringify(['トイレの日', '鍋の日', 'ココアの日']), v);
  await H.page.click('#day-mode button[data-v="all"]');
  v = await vals();
  check('B4 もう一度押すとはじめの3つ', v[0] === '鍋の日');
  await H.page.fill('#host-name', 'たぎ');
  await L.waitText(H, '#wx-status-text', '取りました', 15000);
  await H.page.click('#btn-create');
  await L.waitScreen(H, 'host');
  const code = (await L.text(H, '#host-code')).trim();
  let room = await L.roomOf(code);
  const st = room.steps.find((s) => s.type === 'choice');
  check('B5 ルームの答えは「3つとも」・由来が3つ', st && st.answer === 'all' && st.notes?.length === 3 && st.notes[1] === 'お菓子の会社が申しこんだ', st);
  check('B6 出し方を覚える', (await H.page.evaluate(() => JSON.parse(localStorage.getItem('roomk-circle-time-prefs')).dayMode)) === 'all');

  // ── C. 画面で答えを見せる ──
  await L.joinRoom(A, 'ゆい', code);
  await L.openWatch(W, code);
  check('C1 みんなにみせる画面に「？」もフィードバックも出さない', !(await L.visible(W, '.howto-fab')) && !(await L.visible(W, '.howto-feedback-fab')));
  await L.goMain(H, code, st.id);
  await L.waitStage(W, 'うどんの日');
  await L.waitPlayer(A, 'うどんの日');
  await L.answerBtn(A, 0);
  await L.waitStage(W, '1／2人');
  check('C2 答える前は由来を出さない', !(await L.stage(W)).includes('語呂合わせ'));
  await H.page.click('#btn-reveal');
  await W.page.waitForFunction(() => document.querySelectorAll('#watch-stage .choice .chip').length === 1);
  await H.page.click('#btn-answer');
  await W.page.waitForFunction(() => document.querySelectorAll('#watch-stage .choice.ok').length === 3);
  const sw = await L.stage(W);
  check('C3 3枚とも正解の印・「3つとも本当！」', sw.includes('3つとも本当！'));
  check('C4 カードごとに由来', (await W.page.evaluate(() => [...document.querySelectorAll('#watch-stage .choice .cn')].map((e) => e.textContent))).join('|') === '冬のはじまりの語呂合わせ|お菓子の会社が申しこんだ|たらいの器のうどん');
  await L.waitPlayer(A, '3つとも本当！');
  check('C5 参加者にも名前と由来', (await L.player(A)).includes('たらいの器のうどん'));
  await L.shot(W, 'am-day-all', false);
  await L.shot(A, 'am-player-day-all');
  // 文を直しても「3つとも」は消えない
  await H.page.click('#btn-edit');
  await L.waitVisible(H, '#edit-box');
  await H.page.fill('#edit-text', (await H.page.inputValue('#edit-text')).replace('今日は何の日？', 'きょうの記念日は？'));
  await H.page.click('#edit-save');
  await L.waitStage(W, 'きょうの記念日は？');
  room = await L.roomOf(code);
  check('C6 文を直しても答えは「3つとも」', room.steps.find((s) => s.id === st.id).answer === 'all');
  await H.page.click('#btn-finish');
  await L.waitScreen(H, 'top');

  // ── D. 次に作るときは「3つとも本当」が選ばれている ──
  await H.page.click('#go-create');
  await H.page.evaluate(() => { document.getElementById('setup-more').open = true; });
  await H.page.click('#seg-session button[data-v="am"]');
  await L.waitText(H, '#day-status-text', '入っています');
  const d1 = [await L.pressed(H, '#day-mode button[data-v="all"]'), await H.page.inputValue('#day-0'), await H.page.evaluate(() => localStorage.getItem('roomk-circle-time-prefs'))];
  check('D1 前の出し方で開く', d1[0] && d1[1] === '鍋の日', d1);
  await H.page.click('#screen-setup [data-back]');

  // ── E. まだ用意されていない日・本当が2つの日 ──
  const H2 = await L.newClient('host-none');
  await L.open(H2);
  await H2.page.click('#go-create');
  await H2.page.evaluate(() => { document.getElementById('setup-more').open = true; });
  await H2.page.click('#seg-session button[data-v="am"]');
  await L.waitText(H2, '#day-status-text', 'まだ用意されていません');
  check('E1 まだのときは空のまま', (await H2.page.inputValue('#day-0')) === '' && (await H2.page.evaluate(() => document.querySelector('#day-mode button[data-v="all"]').disabled)));
  const H3 = await L.newClient('host-two', { daily: { ...DAILY, real: DAILY.real.slice(0, 2) } });
  await L.open(H3);
  await H3.page.click('#go-create');
  await H3.page.evaluate(() => { document.getElementById('setup-more').open = true; });
  await H3.page.click('#seg-session button[data-v="am"]');
  await L.waitText(H3, '#day-status-text', '入っています');
  check('E2 本当が2つの日は「3つとも本当」を押せない', await H3.page.evaluate(() => document.querySelector('#day-mode button[data-v="all"]').disabled));
  check('E3 1つだけ本当で入る', [await H3.page.inputValue('#day-0'), await H3.page.inputValue('#day-1'), await H3.page.inputValue('#day-2')].includes('鍋の日'));
  await L.shot(H3, 'setup-daily');

  // ── F. つかいかた ──
  await H3.page.click('.howto-fab');
  await L.waitVisible(H3, '.howto-modal.show');
  check('F1 つかいかたに参加と進行役の手順', (await L.text(H3, '.howto-modal')).includes('代わりに入れる') && (await L.text(H3, '.howto-modal')).includes('ルームに参加する'));
  check('F2 ほかのツールと同じくフィードバックを送れる', await H3.page.evaluate(() => [...document.querySelectorAll('.howto-modal button, .howto-modal a')].some((b) => b.textContent.includes('フィードバック'))));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(2); });

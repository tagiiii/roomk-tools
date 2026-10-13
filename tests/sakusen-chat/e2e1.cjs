// E2E その1: 入口・作成・参加（3人まで）・会話・未読・画像・せまい画面
const L = require('./lib.cjs');
const { check, sleep, rest, roomOf, roomWhen, open, screen, waitScreen, text, visible, overflow, waitToast, badges, topicTitles, msgs, waitMsgs, waitTitle, openTopic, sendText } = L;
const fs = require('fs'); const path = require('path');

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── A. 入口: メンター用のリンクがない端末では、ルームを作れない
  const H = await L.newClient('host');
  await open(H);
  check('A plain: top', (await screen(H)) === 'screen-top');
  check('A plain: no mentor tools', !(await visible(H, '#mentorTools')) && await visible(H, '#guestNote'));
  await open(H, '?mentor=WRONGKEY');
  await waitToast(H, 'メンター用のリンクが正しくないよ');
  check('A wrong key: still locked', !(await visible(H, '#mentorTools')));
  check('A wrong key: param removed', !H.page.url().includes('mentor='));
  await L.mentorTop(H);
  check('A mentor: tools shown', await visible(H, '#btnCreateRoom') && !(await visible(H, '#guestNote')));
  check('A mentor: param removed', !H.page.url().includes('mentor='));
  check('A mentor: no prev room', !(await visible(H, '#prevRoom')));
  await open(H);
  await H.page.waitForFunction(() => !document.getElementById('mentorTools').hidden);
  check('A mentor: remembered on this device', true);

  // ── B. 作成
  await H.page.click('#btnCreateRoom');
  check('B empty name error', (await text(H, '#createError')) === '名前を入れてね' && (await screen(H)) === 'screen-top');
  await H.page.$eval('#hostName', (e) => { e.removeAttribute('maxlength'); e.value = '123456789'; });
  await H.page.click('#btnCreateRoom');
  check('B long name error', (await text(H, '#createError')) === '名前は8文字までだよ');
  const { link, key } = await L.createRoom(H, 'メンター');
  check('B key is 20 chars', /^[A-HJ-NP-Z2-9]{20}$/.test(key), key);
  check('B link shape', link === L.BASE + '?room=' + key, link);
  let room = await roomWhen(key, (r) => r?.meta?.hostConnected === true);
  check('B meta', room.meta.status === 'open' && room.meta.hostName === 'メンター' && room.meta.hostConnected === true && !('hostDisconnectedAt' in room.meta) && !!room.meta.hostUid, room.meta);
  check('B first topics', (await topicTitles(H)).join() === 'チェックイン,ジブンチェック');
  check('B topics in db', Object.keys(room.topics).join() === 'a_checkin,b_mood' && room.topics.b_mood.kind === 'mood');
  check('B stats room-create once', (await H.page.evaluate(() => window.__STATS__.filter((x) => x === 'room-create').length)) === 1);
  check('B host buttons', await visible(H, '#btnCopyLink') && await visible(H, '#btnFinish') && !(await visible(H, '#btnLeave')));
  check('B peer label', (await text(H, '#peerLabel')) === 'まだだれも来ていないよ');
  check('B address has no key', !H.page.url().includes(key));
  check('B howto fab moved to top bar', await H.page.evaluate(() => { const r = document.querySelector('.howto-fab').getBoundingClientRect(); const s = document.getElementById('btnSend').getBoundingClientRect(); return r.bottom < 60 && (r.right <= s.left || r.bottom <= s.top); }));

  // メンターが先に話題へ書いておく（あとから入る人には未読になる）
  await openTopic(H, 1);
  await sendText(H, '先に書いておいた質問');
  await openTopic(H, 0);

  // ── C. 参加（1人目）
  const A = await L.newClient('guestA');
  await L.join(A, key, '');
  check('C empty name error', (await text(A, '#joinError')) === '名前を入れてね');
  await A.page.fill('#guestName', 'メンター'); await A.page.click('#btnJoinRoom');
  await A.page.waitForFunction(() => (document.getElementById('joinError').textContent || '').includes('同じ名前'));
  check('C host name dup', (await screen(A)) === 'screen-join');
  room = await roomOf(key);
  check('C failed join leaves no seat', !room.meta.guests);
  await A.page.fill('#guestName', 'たろう'); await A.page.click('#btnJoinRoom');
  await waitScreen(A, 'chat');
  await waitToast(H, 'たろうが入ったよ');
  check('C guest buttons', !(await visible(A, '#btnCopyLink')) && !(await visible(A, '#btnFinish')) && await visible(A, '#btnLeave'));
  check('C address has no key', !A.page.url().includes(key));
  await H.page.waitForFunction(() => document.getElementById('peerLabel').textContent === 'いっしょにいる人: たろう');
  await A.page.waitForFunction(() => document.getElementById('peerLabel').textContent === 'いっしょにいる人: メンター');
  check('C peer labels', true);
  room = await roomOf(key);
  check('C seat in db', Object.values(room.meta.guests).map((g) => g.name).join() === 'たろう');
  // 入る前からあったメッセージは未読
  await waitTitle(A, '(1)');
  check('C backlog unread', (await badges(A)).join('|') === '|1', await badges(A));
  await openTopic(A, 1);
  check('C backlog message with name', (await msgs(A)).join('|') === 'メンター:先に書いておいた質問');
  check('C no divider above the first message', !(await A.page.$('.sc-talk__divider')));
  await waitTitle(A, '');
  await openTopic(A, 0);

  // ── D. 2人目・4人目
  const B = await L.newClient('guestB');
  await L.join(B, key, 'たろう');
  await B.page.waitForFunction(() => (document.getElementById('joinError').textContent || '').includes('同じ名前'));
  check('D guest name dup', true);
  await B.page.fill('#guestName', 'はなこ'); await B.page.click('#btnJoinRoom');
  await waitScreen(B, 'chat');
  await A.page.waitForFunction(() => document.getElementById('peerLabel').textContent === 'いっしょにいる人: メンター、はなこ');
  check('D third person in', true);
  const X = await L.newClient('fourth');
  await L.join(X, key, 'よにんめ');
  await X.page.waitForFunction(() => (document.getElementById('joinError').textContent || '').includes('もう3人入っているよ'));
  check('D fourth is refused', (await screen(X)) === 'screen-join');
  room = await roomOf(key);
  check('D two seats only', Object.keys(room.meta.guests).length === 2);

  // ── E. 会話と未読（見ている話題は未読にならない・ほかの話題は数が出る）
  await openTopic(B, 1);
  await B.page.waitForFunction(() => !document.title.startsWith('('));
  await sendText(H, 'こんにちは。今日の朝ごはんは何だった？');
  await waitMsgs(A, 1);
  check('E watching: no unread', (await badges(A)).join('|') === '|' && !(await A.page.title()).startsWith('('));
  check('E peer bubble has name', (await msgs(A)).join('|') === 'メンター:こんにちは。今日の朝ごはんは何だった？');
  await waitTitle(B, '(1)');
  check('E other topic: unread 1', (await badges(B)).join('|') === '1|', await badges(B));
  check('E preview with name', (await B.page.$eval('.sc-topic__preview', (e) => e.textContent)) === 'メンター: こんにちは。今日の朝ごはんは何だった？');
  await sendText(A, 'パンだった');
  await waitTitle(B, '(2)');
  check('E aria label', (await B.page.$eval('.sc-topic', (e) => e.getAttribute('aria-label'))) === '1番の話題: チェックイン、未読2件');
  await openTopic(B, 0);
  await waitTitle(B, '');
  check('E opened: both messages, no divider at top', (await msgs(B)).join('|') === 'メンター:こんにちは。今日の朝ごはんは何だった？|たろう:パンだった' && !(await B.page.$('.sc-talk__divider')));
  await openTopic(B, 1);
  await sendText(H, '3つ目'); await sendText(H, '4つ目');
  await waitTitle(B, '(2)');
  await openTopic(B, 0);
  const divIdx = await B.page.$$eval('#msgList > *', (els) => els.findIndex((e) => e.classList.contains('sc-talk__divider')));
  check('E divider before first unread', divIdx === 2, divIdx);
  await sendText(B, 'ごはん');
  check('E divider gone after reply', !(await B.page.$('.sc-talk__divider')));
  await waitMsgs(H, 5);
  check('E name shown once for a run of messages', (await B.page.$$eval('.sc-msg', (els) => els.map((e) => (e.querySelector('.sc-msg__name') ? 'N' : '-')).join(''))) === 'NNN--', await B.page.$$eval('.sc-msg', (els) => els.map((e) => (e.querySelector('.sc-msg__name') ? 'N' : '-')).join('')));
  check('E host view', (await msgs(H)).join('|') === 'me:こんにちは。今日の朝ごはんは何だった？|たろう:パンだった|me:3つ目|me:4つ目|はなこ:ごはん', await msgs(H));
  room = await roomOf(key);
  const anyMsg = Object.values(room.msgs)[1];
  check('E message shape in db', ['t', 'mid', 'name', 'kind', 'text', 'at'].every((k) => k in anyMsg) && !('uid' in anyMsg), anyMsg);

  // ── G. ジブンチェック
  await openTopic(A, 1);
  check('G choices', (await A.page.$$eval('.sc-choice', (e) => e.map((x) => x.textContent))).join('|') === '⑤絶好調|④調子がよさそう|③いつも通り|②少し気持ちが落ち込んでいる|①とても気持ちが落ち込んでいる|今日は答えない');
  await A.page.click('.sc-choice >> nth=2');
  await waitMsgs(A, 2);
  check('G answer in talk', (await msgs(A)).join('|') === 'メンター:先に書いておいた質問|me:③ いつも通り');
  await waitTitle(H, '(1)');
  await openTopic(H, 1);
  await H.page.click('.sc-choice--pass');
  await waitMsgs(A, 3);
  check('G pass', (await msgs(A))[2] === 'メンター:今日は答えない');

  // ── H. 話題をふやす
  await A.page.click('#btnAddOpen');
  await A.page.fill('#addInput', '   '); await A.page.press('#addInput', 'Enter');
  check('H blank rejected', (await topicTitles(A)).length === 2);
  await A.page.fill('#addInput', '見てほしいもの'); await A.page.press('#addInput', 'Enter');
  await A.page.waitForFunction(() => document.getElementById('talkTitle').textContent === '見てほしいもの');
  check('H adder opens the new topic', (await topicTitles(A)).length === 3 && !(await visible(A, '#addForm')));
  await H.page.waitForFunction(() => document.querySelectorAll('.sc-topic').length === 3);
  check('H fresh badge', (await badges(H)).join('|') === '||新しい' && (await H.page.title()).startsWith('(1)'), await badges(H));
  check('H numbers', (await H.page.$$eval('.sc-topic__num', (e) => e.map((x) => x.textContent))).join('') === '①②③');

  // ── I. 入力中（名前つき）・書きかけは話題ごと
  await A.page.type('#textInput', 'いま書いて');
  await H.page.waitForFunction(() => document.querySelectorAll('.sc-topic__preview')[2].textContent === 'たろうが入力中…');
  check('I typing in list', !(await visible(H, '#typingNote')));
  await openTopic(H, 2);
  check('I typing line', (await text(H, '#typingNote')) === 'たろうが入力中…' && (await badges(H)).join('|') === '||');
  await openTopic(A, 0);
  check('I draft stays in its topic', (await A.page.inputValue('#textInput')) === '');
  await H.page.waitForFunction(() => document.getElementById('typingNote').hidden);
  await openTopic(A, 2);
  check('I draft restored', (await A.page.inputValue('#textInput')) === 'いま書いて');
  room = await roomOf(key);
  check('I typing node removed', !room.typing, room.typing);

  // ── J. 画像
  const big = await A.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const x = c.getContext('2d'); for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 5) * 10}%)`; x.fillRect((i * 97) % 3000, (i * 53) % 2000, 400, 300); } x.fillStyle = '#fff'; x.font = '200px sans-serif'; x.fillText('TEST', 300, 1000); return c.toDataURL('image/png').split(',')[1]; });
  fs.writeFileSync(path.join(L.OUT, 'big.png'), Buffer.from(big, 'base64'));
  fs.writeFileSync(path.join(L.OUT, 'note.txt'), 'x');
  await A.page.setInputFiles('#fileInput', path.join(L.OUT, 'big.png'));
  await A.page.waitForSelector('#pendingBox:not([hidden])');
  await A.page.click('#btnSend');
  await waitMsgs(A, 1);
  check('J sent with caption', (await msgs(A)).join('|') === 'me:いま書いて[img]' && !(await visible(A, '#pendingBox')) && (await A.page.inputValue('#textInput')) === '');
  check('J send button restored', (await text(A, '#btnSend')) === '送る' && await A.page.isEnabled('#btnSend'));
  await H.page.waitForSelector('.sc-msg--peer .sc-msg__img');
  const dims = await H.page.$eval('.sc-msg--peer .sc-msg__img', (i) => new Promise((r) => { const d = () => r([i.naturalWidth, i.naturalHeight]); i.complete && i.naturalWidth ? d() : (i.onload = d); }));
  check('J shrunk to 1280', dims[0] === 1280 && dims[1] === 853, dims);
  room = await roomOf(key);
  const imgId = Object.keys(room.imgs)[0];
  check('J db: image apart from message', Object.keys(room.imgs).length === 1 && /^data:image\/jpeg;base64,/.test(room.imgs[imgId]) && room.msgs[imgId].kind === 'image' && room.msgs[imgId].w === 1280 && room.msgs[imgId].h === 853 && !('img' in room.msgs[imgId]));
  check('J db: image size', room.imgs[imgId].length <= 700000, room.imgs[imgId].length);
  console.log('  image chars:', room.imgs[imgId].length);
  const box = await H.page.evaluate(() => { const b = document.querySelector('.sc-msg--peer .sc-msg__imgbtn').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
  check('J thumb box', box[0] === 260 && Math.abs(box[1] - 173) <= 1, box);
  await H.page.click('.sc-msg__imgbtn');
  check('J viewer', await H.page.$eval('#viewer', (d) => d.open));
  await H.page.screenshot({ path: path.join(L.OUT, 'host-viewer.png') });
  await H.page.click('#btnViewerClose');
  await H.page.screenshot({ path: path.join(L.OUT, 'host-desktop.png') });
  await A.page.setInputFiles('#fileInput', path.join(L.OUT, 'note.txt'));
  await waitToast(A, '使えなかった');
  check('J non-image rejected', !(await visible(A, '#pendingBox')));
  // あとから入り直した人にも画像が出る（B はこの話題をまだひらいていない）
  await openTopic(B, 2);
  await B.page.waitForSelector('.sc-msg--peer .sc-msg__img');
  check('J lazy load for others', (await msgs(B)).join('|') === 'たろう:いま書いて[img]');

  // ── K. 消す（本人だけ）
  check('K no delete on others', (await H.page.$$('.sc-msg--peer .sc-msg__del')).length === 0);
  await A.page.click('.sc-msg--me .sc-msg__del');
  await A.page.click('#btnConfirmCancel');
  check('K cancel keeps', (await A.page.$$('.sc-msg')).length === 1);
  await A.page.click('.sc-msg--me .sc-msg__del');
  await A.page.click('#btnConfirmOk');
  await waitMsgs(A, 0); await waitMsgs(H, 0); await waitMsgs(B, 0);
  room = await roomWhen(key, (r) => !r.imgs);
  check('K db: message and image both gone', !room.imgs && !room.msgs[imgId]);

  // ── HTML はそのまま文字として出る
  await sendText(H, '<img src=x onerror="window.__xss=1"><b>太字</b>');
  await waitMsgs(A, 1);
  check('X html as text', (await A.page.$eval('.sc-msg--peer .sc-msg__text', (e) => e.textContent)) === '<img src=x onerror="window.__xss=1"><b>太字</b>' && !(await A.page.evaluate(() => window.__xss)) && !(await A.page.$('.sc-msg__text b')));
  await A.page.click('#btnAddOpen'); await A.page.fill('#addInput', '<i>x</i>'); await A.page.click('#addForm button[type=submit]');
  await H.page.waitForFunction(() => document.querySelectorAll('.sc-topic').length === 4);
  check('X topic title as text', !(await H.page.$('.sc-topic i')));

  // ── ウィンドウが後ろにあるとき
  await openTopic(H, 0); await openTopic(A, 0);
  await A.page.evaluate(() => { document.hasFocus = () => false; });
  await sendText(H, '後ろにいる間のメッセージ');
  await waitTitle(A, '(1)');
  check('F unread while unfocused', (await badges(A))[0] === '1');
  await A.page.evaluate(() => { delete document.hasFocus; window.dispatchEvent(new Event('focus')); });
  check('F read on focus, divider shown', !(await A.page.title()).startsWith('(') && !!(await A.page.$('.sc-talk__divider')));

  // ── 上にスクロールしている間に届く
  for (let i = 0; i < 12; i++) await sendText(H, '行' + i + '\nもう1行');
  await A.page.waitForFunction(() => document.querySelectorAll('.sc-msg').length >= 18);
  await A.page.$eval('#msgList', (e) => { e.scrollTop = 0; });
  await sleep(100);
  await sendText(H, '下に届いた');
  await A.page.waitForSelector('#btnNewer:not([hidden])');
  check('S pill, no unread', (await badges(A))[0] === '');
  await A.page.click('#btnNewer');
  check('S jumped to bottom', await A.page.$eval('#msgList', (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 5));

  // ── Enter
  const before = (await H.page.$$('.sc-msg')).length;
  await H.page.fill('#textInput', 'えんたー');
  await H.page.$eval('#textInput', (t) => { t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true })); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })); });
  check('N composing enter does not send', (await H.page.$$('.sc-msg')).length === before);
  await H.page.press('#textInput', 'Shift+Enter');
  check('N shift+enter newline', (await H.page.$$('.sc-msg')).length === before && (await H.page.inputValue('#textInput')).includes('\n'));
  await H.page.press('#textInput', 'Enter');
  await waitMsgs(H, before + 1);
  check('N enter sends', (await H.page.inputValue('#textInput')) === '');

  // ── 音は鳴らさない（切りかえボタンも置かない）
  check('O no sound button', !(await A.page.$('#btnSound')) && !(await H.page.$('#btnSound')));
  check('O no audio was ever started', (await A.page.evaluate(() => window.__audioMade)) === 0 && (await H.page.evaluate(() => window.__audioMade)) === 0);

  // ── つかいかた
  await H.page.click('.howto-fab');
  check('W howto opens', await visible(H, '.howto-modal.show'));
  await H.page.keyboard.press('Escape');

  // ── せまい画面
  await A.page.setViewportSize({ width: 375, height: 700 });
  await sleep(200);
  check('M list only', await visible(A, '.sc-topics') && !(await visible(A, '.sc-talk')) && (await A.page.$$('.sc-topic[aria-current]')).length === 0);
  check('M no overflow (list)', (await overflow(A)) <= 0, await overflow(A));
  await sendText(H, 'せまい画面の間に');
  await waitTitle(A, '(1)');
  await openTopic(H, 1); await sendText(H, 'ジブンチェックにも');
  await waitTitle(A, '(2)');
  await A.page.waitForSelector('#roomk-toast', { state: 'detached', timeout: 5000 }).catch(() => {});
  await A.page.screenshot({ path: path.join(L.OUT, 'guest-mobile-list.png') });
  await openTopic(A, 0);
  check('M talk only', !(await visible(A, '.sc-topics')) && await visible(A, '.sc-talk'));
  const vis = await A.page.evaluate(() => { const box = document.getElementById('msgList').getBoundingClientRect(); const inBox = (e) => { const r = e.getBoundingClientRect(); return r.top >= box.top - 1 && r.bottom <= box.bottom + 1; }; const all = document.querySelectorAll('.sc-msg'); return [inBox(document.querySelector('.sc-talk__divider')), inBox(all[all.length - 1])]; });
  check('M divider and newest in view', vis[0] && vis[1], vis);
  check('M back badge', (await text(A, '#backBadge')) === '1' && await visible(A, '#backBadge'));
  check('M no overflow (talk)', (await overflow(A)) <= 0, await overflow(A));
  await A.page.screenshot({ path: path.join(L.OUT, 'guest-mobile-talk.png') });
  await A.page.click('#btnBack');
  await openTopic(A, 1);
  await A.page.screenshot({ path: path.join(L.OUT, 'guest-mobile-mood.png') });
  await waitTitle(A, '');
  await A.page.setViewportSize({ width: 1100, height: 760 });
  await sleep(200);
  check('M wide again', (await A.page.$$('.sc-topic[aria-current]')).length === 1);

  // ── 話題は20こまで
  for (let i = 0; i < 16; i++) { await H.page.click('#btnAddOpen'); await H.page.fill('#addInput', '話題' + i); await H.page.press('#addInput', 'Enter'); }
  await H.page.waitForFunction(() => document.querySelectorAll('.sc-topic').length === 20);
  check('T topic limit', await H.page.isDisabled('#btnAddOpen') && (await H.page.$$eval('.sc-topic__num', (e) => e[19].textContent)) === '⑳');

  // ── 同じブラウザの2つのタブ（匿名認証の uid が同じ）でも、自分と相手を区別できる
  const ctx = await L.newContext('same-browser');
  const S1 = await L.newPage(ctx, 'same-host');
  const made = await L.createRoom(S1, 'めんたー');
  const S2 = await L.newPage(ctx, 'same-guest');
  await L.joinOk(S2, made.key, 'こども');
  await sendText(S1, 'ホストから');
  await waitMsgs(S2, 1);
  await sendText(S2, 'ゲストから');
  await waitMsgs(S1, 2);
  check('U same uid: mine and others told apart', (await msgs(S1)).join('|') === 'me:ホストから|こども:ゲストから' && (await msgs(S2)).join('|') === 'めんたー:ホストから|me:ゲストから', [await msgs(S1), await msgs(S2)]);
  const sameRoom = await roomOf(made.key);
  check('U same uid in db', Object.values(sameRoom.meta.guests)[0].uid === sameRoom.meta.hostUid);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(2); });

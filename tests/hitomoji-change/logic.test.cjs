// ひともじチェンジの決まり（apps/hitomoji-change/logic.js）の単体テスト
// 使い方: node tests/hitomoji-change/logic.test.cjs
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const L = require(path.join(__dirname, '../../apps/hitomoji-change/logic.js'));

// words.js（ES モジュール）を読む
const src = fs.readFileSync(path.join(__dirname, '../../apps/hitomoji-change/words.js'), 'utf8').replace(/\bexport\s+const\s+/g, 'var ');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { PUZZLES, VOCAB } = ctx;

let ok = 0;
let ng = 0;
function t(name, cond) {
  if (cond) ok++;
  else { ng++; console.log('NG', name); }
}

// ── ことば ──
t('differsByOne', L.differsByOne('いぬ', 'いか') && !L.differsByOne('いぬ', 'たか') && !L.differsByOne('いぬ', 'いぬ') && !L.differsByOne('いぬ', 'いぬき'));
t('findPath', JSON.stringify(L.findPath('うみ', 'やま', VOCAB)) === JSON.stringify(['うみ', 'うま', 'やま']));
t('findPath none', L.findPath('ぬぬ', 'やま', ['やま']) === null);
PUZZLES.forEach((p, i) => t('puzzle connects ' + i, !!L.findPath(p.start, p.goal, VOCAB) && L.validPuzzle(p)));
t('hintStep', (() => { const h = L.hintStep('うみ', 'やま', VOCAB); return h.pos === 1 && h.word === 'うま' && h.steps === 2; })());
t('readCustom kata', L.readCustom('サカナ', 'たから').start === 'さかな');
t('readCustom len', !!L.readCustom('さかな', 'いぬ').error);
t('readCustom same', !!L.readCustom('いぬ', 'いぬ').error);
t('readCustom kanji', !!L.readCustom('魚', 'いぬ').error);
t('readCustom 6', !!L.readCustom('ああああああ', 'いいいいいい').error);
t('nickname', !L.validNickname('そら') && !!L.validNickname('') && !!L.validNickname('a.b') && !!L.validNickname('123456789'));

// ── ルーム ──
const base = () => ({
  status: 'waiting', host: 'メンター', hostUid: 'u0', hostConnected: true,
  settings: { hostPlays: true, order: 'turn', judge: 'all', level: 'two' },
  players: {
    'メンター': { isHost: true, uid: 'u0', joinedAt: 1 },
    'そら': { isHost: false, uid: 'u1', joinedAt: 2 },
    'みどり': { isHost: false, uid: 'u2', joinedAt: 3 },
  },
});
const P = { chars: 2, start: 'うみ', goal: 'やま' };

let r = L.newGame(base(), P, 'c2', 0);
t('start playing', r.status === 'playing' && r.game.ladder.length === 1 && r.seen.c2[0] === 0);
t('first turn host', L.turnOf(r) === 'メンター');
t('not your turn', L.move(r, 'そら', 1, 'ま') === null);
r = L.move(r, 'メンター', 1, 'ま');
t('moved', L.currentWord(r.game) === 'うま' && L.turnOf(r) === 'そら');
t('same char ng', L.move(r, 'そら', 1, 'ま') === null);
t('bad char ng', L.move(r, 'そら', 0, 'A') === null && L.move(r, 'そら', 0, 'かな') === null && L.move(r, 'そら', 5, 'か') === null);
t('undo by mover', L.canUndo(r, 'メンター') && !L.canUndo(r, 'みどり'));
const ru = L.undo(r, 'メンター');
t('undo back turn', L.currentWord(ru.game) === 'うみ' && L.turnOf(ru) === 'メンター');
// パス
const rp = L.pass(r, 'そら');
t('pass', L.turnOf(rp) === 'みどり' && !L.canPass(rp, 'そら') && L.canPass(rp, 'メンター'));
// ゴール
r = L.move(r, 'そら', 0, 'や');
t('cleared', r.game.cleared && L.currentWord(r.game) === 'やま' && !L.canMove(r, 'みどり') && !L.canUndo(r, 'メンター'));
// つぎのお題は、最後に変えた人のつぎから
const r2 = L.newGame(r, { chars: 2, start: 'あめ', goal: 'ゆき' }, 'c2', 1);
t('next game turn rotates', L.turnOf(r2) === 'みどり' && r2.seen.c2.length === 2 && r2.game.id === 2);

// 番の人がいなくなったら、そのあとに入った人
let ra = L.newGame(base(), P, null);
ra = L.move(ra, 'メンター', 1, 'ま'); // そらの番
const gone = { ...ra, players: { ...ra.players } };
delete gone.players['そら'];
t('absent turn skips', L.turnOf(gone) === 'みどり' && L.canMove(gone, 'みどり'));
t('leave on turn', L.turnOf(L.leave(ra, 'そら')) === 'みどり');
t('rejoin does not take back turn', (() => { const back = L.addPlayer(gone, 'そら', { isHost: false, uid: 'u1', joinedAt: 9 }); return L.turnOf(back) === 'みどり' && L.participants(back).slice(-1)[0].name === 'そら'; })());
t('join keeps turn', L.turnOf(L.addPlayer(ra, 'はる', { isHost: false, uid: 'u9', joinedAt: 10 })) === 'そら');
t('leave not turn', L.turnOf(L.leave(ra, 'みどり')) === 'そら');

// 進行だけのホスト
const hp = base(); hp.settings.hostPlays = false;
let rh = L.newGame(hp, P, null);
t('host not participant', L.turnOf(rh) === 'そら' && !L.participants(rh).some((p) => p.name === 'メンター'));
t('host cannot move on child turn', !L.canMove(rh, 'メンター'));
t('host can pass', L.canPass(rh, 'メンター'));

// 端末なしの参加者（ホストが代わりに）
const px = base(); px.proxies = { 'あお': { addedAt: 2.5 } };
let rx = L.newGame(px, P, null);
rx = L.move(rx, 'メンター', 1, 'ま'); // そら
rx = L.move(rx, 'そら', 0, 'し');     // あお（2.5）
t('proxy turn', L.turnOf(rx) === 'あお' && L.canMove(rx, 'メンター') && !L.canMove(rx, 'そら'));
rx = L.move(rx, 'メンター', 1, 'か');
t('proxy move recorded as proxy', rx.game.ladder[rx.game.ladder.length - 1].by === 'あお' && L.turnOf(rx) === 'みどり');

// だれでも
const fr = base(); fr.settings.order = 'free';
let rf = L.newGame(fr, P, null);
t('free any', L.canMove(rf, 'みどり') && L.canMove(rf, 'そら') && L.turnOf(rf) === null && !L.canPass(rf, 'そら'));
t('free stranger ng', !L.canMove(rf, 'だれか'));
rf = L.move(rf, 'みどり', 1, 'ま');
t('free move', L.currentWord(rf.game) === 'うま' && L.canUndo(rf, 'みどり') && !L.canUndo(rf, 'そら'));

// ヒント
let rhint = L.newGame(base(), P, null);
t('hint guest ng', L.hint(rhint, 'そら') === null);
rhint = L.hint(rhint, 'メンター');
t('hint 1', L.hintStageOf(rhint.game) === 1);
rhint = L.hint(rhint, 'メンター');
rhint = L.hint(rhint, 'メンター');
t('hint 2 cap', L.hintStageOf(rhint.game) === 2);
rhint = L.move(rhint, 'メンター', 1, 'ま');
t('hint resets', L.hintStageOf(rhint.game) === 0);

// ことばの判定: ホストが決める
t('judge default host', L.settingsOf({}).judge === 'host' && L.settingsOf({ settings: { judge: 'x' } }).judge === 'host');
const hj = base(); hj.settings.judge = 'host';
let rj = L.newGame(hj, P, null);
rj = L.move(rj, 'メンター', 1, 'ま'); // ホストの手はそのまま確定 → そらの番
t('host move commits', L.currentWord(rj.game) === 'うま' && !L.pendingOf(rj) && L.turnOf(rj) === 'そら');
rj = L.move(rj, 'そら', 0, 'ぬ');     // ぬま（仮）
t('guest move pending', L.currentWord(rj.game) === 'うま' && L.pendingOf(rj).w === 'ぬま' && L.turnOf(rj) === 'そら');
t('pending blocks', !L.canMove(rj, 'そら') && !L.canMove(rj, 'メンター') && !L.canUndo(rj, 'メンター') && !L.canPass(rj, 'メンター'));
t('approve host only', L.approve(rj, 'そら') === null && L.approve(rj, 'みどり') === null);
t('reject by host or mover', L.canReject(rj, 'メンター') && L.canReject(rj, 'そら') && !L.canReject(rj, 'みどり'));
const rjr = L.reject(rj, 'メンター');
t('reject keeps turn', !L.pendingOf(rjr) && L.currentWord(rjr.game) === 'うま' && L.turnOf(rjr) === 'そら' && L.canMove(rjr, 'そら'));
const rja = L.approve(rj, 'メンター');
t('approve commits', !L.pendingOf(rja) && L.currentWord(rja.game) === 'ぬま' && rja.game.ladder.slice(-1)[0].by === 'そら' && L.turnOf(rja) === 'みどり');
// 仮に置いたあとで、変えた人が抜けた → OK でも、つぎの人（みどり）を飛ばさない
const rjl = L.leave(rj, 'そら');
t('leave pending turn moves', L.turnOf(rjl) === 'みどり' && !!L.pendingOf(rjl));
const rjla = L.approve(rjl, 'メンター');
t('approve after leave keeps next', L.currentWord(rjla.game) === 'ぬま' && L.turnOf(rjla) === 'みどり');
// ゴールのことばは判定を待たない
let rg = L.newGame(hj, P, null);
rg = L.move(rg, 'メンター', 1, 'ま');
rg = L.move(rg, 'そら', 0, 'や');
t('goal skips judge', rg.game.cleared && !L.pendingOf(rg));
// 古い仮置き（ことばの数がずれた）は読まない
t('stale pending ignored', L.pendingOf({ ...rja, game: { ...rja.game, pending: { w: 'ああ', by: 'そら', actor: 'そら', n: 1 } } }) === null);
// だれでも＋ホストが決める
const fj = base(); fj.settings.order = 'free'; fj.settings.judge = 'host';
let rfj = L.newGame(fj, P, null);
rfj = L.move(rfj, 'みどり', 1, 'ま');
t('free pending', !!L.pendingOf(rfj) && !L.canMove(rfj, 'そら') && L.canReject(rfj, 'みどり'));
rfj = L.approve(rfj, 'メンター');
t('free approve', L.currentWord(rfj.game) === 'うま' && L.turnOf(rfj) === null && L.canUndo(rfj, 'みどり'));
// 端末なしの参加者の番（ホストが代わりに押す）は、そのまま確定
const pj = base(); pj.settings.judge = 'host'; pj.proxies = { 'あお': { addedAt: 1.5 } };
let rpj = L.newGame(pj, P, null);
rpj = L.move(rpj, 'メンター', 1, 'ま'); // あお の番
rpj = L.move(rpj, 'メンター', 0, 'し');
t('proxy by host commits', !L.pendingOf(rpj) && L.currentWord(rpj.game) === 'しま' && L.turnOf(rpj) === 'そら');

// 出したお題
const u = L.unseenIndexes({ seen: { c3: [31] } }, PUZZLES, 3);
t('unseen', u.key === 'c3' && !u.rest.includes(31) && u.all.length === u.rest.length + 1);

// 壊れた値
t('broken game', L.gameOf({ game: { puzzle: { start: 'x', goal: 'y' }, ladder: [] } }) === null && L.move({ status: 'playing' }, 'a', 0, 'か') === null);
t('waiting back', L.backToWaiting(r).status === 'waiting' && L.backToWaiting(r).game === null);

console.log(`logic: ${ok} OK, ${ng} NG`);
process.exit(ng ? 1 : 0);

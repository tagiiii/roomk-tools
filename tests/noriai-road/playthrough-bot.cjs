// のりあいロードの自動プレイの土台（playthrough.cjs が使う）。
// 人の操作（左右・ジャンプ・下）だけで動かす。人・箱・ものの位置は書きかえない。
'use strict';
const E = require(process.env.NR_ENGINE || '../../apps/noriai-road/engine.js');
const DT = 1 / 60;
const PW = E.PW, PH = E.PH;
const GROUND = 10 - PH;

class Stuck extends Error {}

function makeBot(w) {
  const n = w.n;
  const bot = {
    w, f: 0,
    cmd: w.players.map(() => ({})),
    prevIn: w.players.map(() => ({})),
    hold: w.players.map(() => 0),      // ジャンプを押しつづけるこま数
    still: w.players.map(() => 0),
    lastX: w.players.map((p) => p.x),
    falls: 0,
  };
  const P = (s) => w.players[s - 1];
  bot.P = P;

  function solidAt(tx, ty, seat) { return E.solidTile(w, tx, ty, seat); }
  // 進む先に穴があるか（足もとの列の下に床がない）
  function pitAhead(p, dir) {
    const fx = dir > 0 ? p.x + PW + 0.35 : p.x - 0.35;
    const tx = Math.floor(fx);
    const feet = Math.floor(p.y + PH + 0.05);
    for (let ty = feet; ty < E.H; ty++) if (solidAt(tx, ty, p.seat)) return false;
    // 動く床・箱があれば穴ではない
    for (const q of w.plats) if (fx > q.x && fx < q.x + q.w && q.y >= p.y + PH - 0.1 && q.y < p.y + PH + 3) return false;
    for (const b of w.boxes) if (fx > b.x && fx < b.x + b.w && b.y >= p.y + PH - 0.1 && b.y < p.y + PH + 3) return false;
    return true;
  }
  function wallAhead(p, dir) {
    const tx = Math.floor(dir > 0 ? p.x + PW + 0.08 : p.x - 0.08);
    const ty = Math.floor(p.y + PH - 0.1);
    return solidAt(tx, ty, p.seat);
  }

  function inputFor(i) {
    const p = w.players[i];
    const c = bot.cmd[i];
    const inp = {};
    if (p.entered) { if (c.exit) { inp.act = true; c.exit = false; } return inp; }
    let dir = 0;
    if (c.go != null) {
      const dx = c.go - p.x;
      if (Math.abs(dx) > Math.max(0.06, c.tol ?? 0.06)) dir = Math.sign(dx);
    }
    if (c.dir) dir = c.dir;
    if (dir > 0) inp.r = true; else if (dir < 0) inp.l = true;
    // ジャンプ
    let jump = false;
    if (c.jumpNow) { jump = true; c.jumpNow = false; bot.hold[i] = c.jumpHold ?? 30; }
    if (dir && c.hop !== false && p.ground) {
      const stuck = bot.still[i] >= 3;
      if (stuck || pitAhead(p, dir) || wallAhead(p, dir)) { jump = true; bot.hold[i] = 30; }
    }
    if (c.ropeJump && !p.ground && p.ropeTaut && !bot.prevIn[i].jump) { jump = true; bot.hold[i] = 30; }
    if (bot.hold[i] > 0) { inp.jump = true; bot.hold[i]--; }
    if (jump) inp.jump = true;
    // 前のこまで押していたら、いったんはなす（押しなおしでジャンプになる）
    if (jump && bot.prevIn[i].jump && !c.keepJump) { inp.jump = false; bot.hold[i] = 31; }
    if (c.act) { inp.act = true; c.act = false; }
    return inp;
  }

  bot.step = () => {
    const raw = w.players.map((_, i) => inputFor(i));
    const ins = raw.map((c, i) => ({ ...c, jumpPressed: !!c.jump && !bot.prevIn[i].jump, actPressed: !!c.act && !bot.prevIn[i].act }));
    const ys = w.players.map((p) => p.blink);
    E.stepLocal(w, ins, DT);
    w.players.forEach((p, i) => {
      if (p.blink > 1.1 && ys[i] < 1.1) bot.falls++;
      bot.still[i] = Math.abs(p.x - bot.lastX[i]) < 0.005 && (raw[i].l || raw[i].r) ? bot.still[i] + 1 : 0;
      bot.lastX[i] = p.x;
    });
    bot.prevIn = raw;
    bot.f++;
  };
  bot.run = (frames) => { for (let k = 0; k < frames; k++) bot.step(); };
  bot.until = (cond, max, label) => {
    for (let k = 0; k < max; k++) { if (cond()) return; bot.step(); }
    if (!cond()) throw new Stuck(label);
  };
  bot.untilTick = (cond, max, label, tick) => {
    for (let k = 0; k < max; k++) { if (cond()) return; tick(); bot.step(); }
    if (!cond()) throw new Stuck(label);
  };
  bot.set = (seat, c) => { bot.cmd[seat - 1] = c; };
  bot.setAll = (c, seats) => { (seats || w.players.map((p) => p.seat)).forEach((s) => { bot.cmd[s - 1] = typeof c === 'function' ? c(s) : { ...c }; }); };
  bot.idle = () => bot.setAll({});
  return bot;
}

module.exports = { E, makeBot, Stuck, DT, PW, PH, GROUND };

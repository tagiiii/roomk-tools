import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../../apps/moji-soroe/index.html', import.meta.url), 'utf8');
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('const HAND_SIZE'));
function setup() {
  const node = { addEventListener() {}, classList: { add() {}, remove() {} }, style: {} };
  const ctx = vm.createContext({ RoomkRTDB: { initFirebase: () => ({}), showToast() {} }, firebase: {},
    window: { addEventListener() {} }, document: { addEventListener() {}, getElementById: () => node }, console });
  vm.runInContext(source.slice(0, source.lastIndexOf('startConnectionWatch();')), ctx);
  vm.runInContext(`
    let room;
    const ref = {
      async get() { return { exists: () => !!room, val: () => structuredClone(room) }; },
      async transaction(fn) {
        const next = fn(structuredClone(room));
        if (next === undefined) return { committed: false };
        room = structuredClone(next);
        state.lastRoom = structuredClone(room);
        return { committed: true };
      }
    };
    function seed(extra = {}) {
      room = { status: 'playing', host: 'a', players: { a: { isHost:true }, b:{} },
        match: { ...dealRound({ matchId:1, round:1, members:{ a:{seat:0}, b:{seat:1} }, wins:{} }, Array.from({length:120}, (_,i)=>i), 'a'), ...extra } };
      Object.assign(state, { nickname:'a', role:'host', roomRef:ref, lastRoom:structuredClone(room), actionBusy:false });
    }
  `, Object.assign(ctx, { structuredClone }));
  return { run: code => vm.runInContext(code, ctx), read: () => JSON.parse(vm.runInContext('JSON.stringify(room)', ctx)) };
}

test('山と捨て札は一回だけ取得し、全タイルが一意に保たれる', async () => {
  const c = setup(); c.run('seed()');
  await c.run('Promise.all([submitDraw(), submitDraw()])');
  assert.equal(c.read().match.hands.a.length, 8);
  assert.equal(c.read().match.turnsRemaining, 105);
  await c.run('state.selectedIndex=7; state.confirmDiscard=true; submitDiscard()');
  c.run("state.nickname='b'; state.role='guest'");
  await c.run('submitDraw(14)');
  const m = c.read().match;
  assert.equal(m.pos, 15); assert.equal(m.turnsRemaining, 104);
  assert.deepEqual(m.discards, []); assert.equal(m.hands.b.at(-1), 14);
  const ids = [...Object.values(m.hands).flat(), ...m.discards, ...m.deck.slice(m.pos)];
  assert.equal(ids.length, 120); assert.equal(new Set(ids).size, 120);
});

test('取得候補は残っている新しい3枚だけ。同じ文字もIDで区別する', async () => {
  const c = setup(); c.run('seed({discards:[40,41,45,90]})');
  assert.equal(c.run('JSON.stringify(availableDiscards(room.match))'), '[90,45,41]');
  await c.run('submitDraw(40)'); assert.equal(c.read().match.hands.a.length, 7);
  await c.run('submitDraw(45)');
  assert.deepEqual(c.read().match.discards, [40,41,90]);
  assert.deepEqual(c.read().match.hands.a, [0,1,2,3,4,5,6,45]);
  for (let n=0;n<=3;n++) {
    c.run(`seed({discards:${JSON.stringify([40,41,45].slice(0,n))}})`);
    assert.equal(c.run('availableDiscards(room.match).length'), n);
  }
});

test('他人の番・古い操作は取得できず、直列化で周回後の再適用も拒否する', async () => {
  const c = setup(); c.run("seed({turn:'b'})");
  await c.run('submitDraw()'); assert.equal(c.read().match.hands.a.length,7);
  c.run(`seed(); const original=ref.transaction; ref.transaction=async fn => {
    room.match.turnSerial += 2;
    return original(fn);
  };`);
  await c.run('submitDraw()'); assert.equal(c.read().match.hands.a.length,7);
});

test('最後の取得後はあがれる。差し戻し→捨てるで回数切れになる', async () => {
  const c = setup(); c.run('seed({turnsRemaining:1,discards:[45]})');
  await c.run('submitDraw(45)'); assert.equal(c.read().match.phase,'turn');
  await c.run('submitClaim()'); assert.equal(c.read().match.phase,'check');
  await c.run('hostRejectClaim()'); assert.equal(c.read().match.step,'discard');
  await c.run('state.selectedIndex=7; state.confirmDiscard=true; submitDiscard()');
  assert.equal(c.read().match.phase,'settled'); assert.equal(c.read().match.endReason,'turns');
});

test('最後のあがり承認は勝ち。山の最終タイルでも宣言できる', async () => {
  const c = setup(); c.run('seed({turnsRemaining:1,pos:119})');
  await c.run('submitDraw()'); await c.run('submitClaim()'); await c.run('hostApproveClaim()');
  assert.equal(c.read().match.winner.nick,'a'); assert.equal(c.read().match.wins.a,1);
});

test('最後の取得者が退出しても止まらない。宣言中の退出も終了する', async () => {
  for (const claim of [false,true]) {
    const c = setup(); c.run('seed({turnsRemaining:1})'); await c.run('submitDraw()');
    if(claim) await c.run('submitClaim()');
    await c.run("removeSelfFromRoom(ref,'a')");
    assert.equal(c.read().match.phase,'settled'); assert.equal(c.read().match.claim,null);
  }
});

test('旧ラウンドは捨て札を取れず、次の配りで新ルールに切り替わる', async () => {
  const c=setup(); c.run('seed({ruleVersion:undefined,turnsRemaining:undefined,turnSerial:undefined,discards:[45]})');
  await c.run('submitDraw(45)'); assert.equal(c.read().match.hands.a.length,7);
  await c.run('submitDraw()'); assert.equal(c.read().match.hands.a.length,8);
  assert.equal(c.run('dealRound(room.match,Array.from({length:120},(_,i)=>i),"a").turnsRemaining'),106);
});

test('再接続用に保存し直しても取得状態と残り回数が復元される', async () => {
  const c=setup(); c.run('seed({discards:[45]})'); await c.run('submitDraw(45)');
  c.run('room=JSON.parse(JSON.stringify(room));state.lastRoom=structuredClone(room)');
  await c.run('submitDraw()'); assert.equal(c.read().match.hands.a.length,8);
  assert.equal(c.read().match.turnsRemaining,105);
});

test('捨て札だけを取り続けても規定回数で必ず終了する', async () => {
  const c=setup(); c.run('seed()');
  for(let turn=0; turn<106; turn++) {
    c.run('state.nickname=room.match.turn');
    await c.run('submitDraw((room.match.discards || []).at(-1) ?? null)');
    assert.equal(c.read().match.phase,'turn');
    await c.run('state.selectedIndex=7; state.confirmDiscard=true; submitDiscard()');
    if(turn<105) assert.equal(c.read().match.phase,'turn');
  }
  assert.equal(c.read().match.phase,'settled');
  assert.equal(c.read().match.turnsRemaining,0);
  assert.equal(c.read().match.pos,15);
});

test('2〜5人の配りで取得回数を初期化し、前ラウンドの終了理由を消す', () => {
  const c=setup();
  for(let count=2; count<=5; count++) {
    const members=Object.fromEntries(Array.from({length:count},(_,i)=>[String(i),{seat:i}]));
    const remaining=c.run(`dealRound({members:${JSON.stringify(members)},turnsRemaining:0,endReason:'turns'},Array.from({length:120},(_,i)=>i),'0')`);
    assert.equal(remaining.turnsRemaining,120-7*count);
    assert.equal(remaining.endReason,null); assert.equal(remaining.turnSerial,0);
  }
});

// dbg_diff.js —— 难度量化：开局可选面 / 贪心单次通关率 / 绕路比
// 用法：LVS=1,3,5,7,8,10 REPS=20 node dbg_diff.js "outputs/解压水消除.html"
const fs = require('fs');
const path = require('path');
const FILE = process.argv[2] || path.join(__dirname, 'outputs', '解压水消除.html');
let html = fs.readFileSync(FILE, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
let code = m[1];

const listeners = {};
let rafCb = null;
function makeCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === 'fillText') return () => {};
      if (k === 'measureText') return (s) => ({ width: String(s).length * 14 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (typeof k === 'string') return t[k] !== undefined ? t[k] : noop;
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
const ctx2d = makeCtx();
const canvas = {
  clientWidth: 720, clientHeight: 1280, width: 720, height: 1280,
  style: {},
  getContext: () => ctx2d,
  addEventListener: (t, fn) => { listeners[t] = fn; },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 1280 })
};
global.window = global;
global.addEventListener = () => {};
global.document = {
  getElementById: () => canvas,
  createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx() }),
  addEventListener: () => {}
};
global.navigator = { maxTouchPoints: 0 };
global.innerWidth = 720; global.innerHeight = 1280;
global.devicePixelRatio = 1;
global.requestAnimationFrame = (cb) => { rafCb = cb; };
global.performance = { now: () => 0 };

const A = 'requestAnimationFrame(loop);';
const i = code.lastIndexOf(A);
code = code.slice(0, i)
  + 'window.__DBG={get G(){return G;},tap:handleTap,gen:genLevel,freeSlot:freeSlot,'
  + 'gateBlocked:gateBlocked,gateFront:gateFront,gridPlayable:gridPlayable,'
  + 'neighborCell:neighborCell,cellRect:cellRect,checkStuck:checkStuck,'
  + 'adj:function(a,b){return cellsAdjacent(a,b);}};\n  '
  + code.slice(i);

try { eval(code); } catch (e) { console.error('EVAL FAIL:', e.stack); process.exit(1); }
let T = 0;
function frames(n) { for (let k = 0; k < n; k++) { T += 16.7; const cb = rafCb; rafCb = null; cb && cb(T); } }
function click(x, y) { listeners['mousedown'] && listeners['mousedown']({ clientX: x, clientY: y }); }
const DBG = global.__DBG;
const BOTT_Y = 470;
const TOOL_X0 = 15, TOOL_W = 130, TOOL_GAP = 10, TOOL_Y = 1176, TOOL_H = 96;
function toolCX(i2) { return TOOL_X0 + i2 * (TOOL_W + TOOL_GAP) + TOOL_W / 2; }
function toolCY() { return TOOL_Y + TOOL_H / 2; }
function tubeMidY(t) { return BOTT_Y - t.h / 2; }
function bottoms(G) { return G.tubes.map(t => t.units[0]).filter(c => c !== undefined && c >= 0); }

function isStuck(G) {
  if (G.anim) return false;
  const bs = bottoms(G);
  if (!bs.length) return false;
  for (const b of G.bottles) if (b.place === 'counter' && b.fill < b.cap && bs.includes(b.col)) return false;
  for (const b of G.bottles) if (DBG.gridPlayable(b)) return false;
  return true;
}

// 贪心策略（与 bot_run 相同）
function botStep(G) {
  if (G.stuck) { click(360, 759); frames(6); return true; }
  const bs = bottoms(G);
  for (const b of G.bottles) {
    if (DBG.gridPlayable(b) && bs.includes(b.col) && DBG.freeSlot() >= 0) { click(b.x, b.y); return true; }
  }
  const idle = G.bottles.filter(b => b.place === 'counter' && b.fill < b.cap && !bs.includes(b.col));
  if (idle.length && DBG.freeSlot() < 0 && G.undoLeft > 0) {
    click(toolCX(3), toolCY()); frames(2);
    click(idle[0].x, idle[0].y - 50); return true;
  }
  if (G.bottles.some(b => b.place === 'counter' && b.fill < b.cap && bs.includes(b.col))) { frames(20); return true; }
  const needRoom = G.bottles.filter(b => (b.locked > 0 && b.place === 'grid') ||
    (b.gate >= 0 && b.place === 'grid' && (!DBG.gateFront(b) || DBG.gateBlocked(b))));
  if (needRoom.length && DBG.freeSlot() >= 0) {
    const cands = G.bottles.filter(b => DBG.gridPlayable(b));
    const near = cands.find(b => needRoom.some(i2 => DBG.adj(i2.cell, b.cell)));
    const pick = near || cands[0];
    if (pick) { click(pick.x, pick.y); return true; }
  }
  if (isStuck(G)) {
    if (G.tools.clear > 0) {
      click(toolCX(0), toolCY()); frames(2);
      const lockedCols = new Set(G.bottles.filter(b => b.locked > 0 && b.place === 'grid').map(b => b.col));
      let ti = G.tubes.findIndex(t => t.units.length && lockedCols.has(t.units[0]));
      if (ti < 0) ti = G.tubes.findIndex(t => t.units.length);
      const t = G.tubes[ti];
      click(t.x + G.tubeW / 2, tubeMidY(t)); return true;
    }
    if (G.tools.swap > 0) {
      click(toolCX(2), toolCY()); frames(2);
      const freeCol = G.bottles.find(b => DBG.gridPlayable(b));
      let ti = G.tubes.findIndex(t => t.units.length && freeCol && t.units[0] === freeCol.col);
      if (ti < 0) ti = 0;
      const other = (ti + 1) % G.tubes.length;
      click(G.tubes[ti].x + G.tubeW / 2, tubeMidY(G.tubes[ti])); frames(2);
      click(G.tubes[other].x + G.tubeW / 2, tubeMidY(G.tubes[other])); return true;
    }
    return false;
  }
  return false;
}

function playOnce(G) {
  let guard = 0, ok = true;
  while (DBG.G.state !== 'win' && guard++ < 2000) {
    if (DBG.G.anim) { frames(25); continue; }
    if (!botStep(DBG.G)) { ok = false; break; }
    frames(4);
  }
  frames(60);
  return { win: ok && DBG.G.state === 'win', steps: guard };
}

const LVS = (process.env.LVS || '1,3,5,7,8,10').split(',').map(Number);
const REPS = +(process.env.REPS || 20);
const out = [];
out.push('关卡 | 格子 | 瓶数 | 色 | 管 | 槽 | 洞 | 冻 | 开局可点/总瓶 | 贪心首战通关率 | 平均步数 | 下界 | 绕路比');
out.push('-----+------+------+----+----+----+----+----+----------------+----------------+----------+------+-------');
for (const lv of LVS) {
  let winCnt = 0, stepSum = 0, winSteps = 0, picksum = 0, botSum = 0, cellSum = 0;
  let cols = 0, tubes = 0, slots = 0, gates = 0, ice = 0, low = 0;
  for (let rep = 0; rep < REPS; rep++) {
    DBG.gen(lv); frames(12);
    const g = DBG.G;
    const cells = g.cellCount, bots = g.bottles.length;
    const playable = g.bottles.filter(b => DBG.gridPlayable(b)).length;
    picksum += playable; botSum += bots; cellSum += cells;
    cols = new Set(g.bottles.map(b => b.col)).size;
    tubes = g.tubes.length; slots = g.slots.length;
    gates = g.gates.length;
    ice = g.bottles.filter(b => b.locked > 0).length;
    low = bots * 3;                                   // 理论下界：每瓶 3 口，每次接 1 口
    const r = playOnce(g);
    if (r.win) { winCnt++; winSteps += r.steps; }
    stepSum += r.steps;
  }
  const rate = Math.round(winCnt / REPS * 100);
  const avgSteps = winCnt ? Math.round(winSteps / winCnt) : 0;
  out.push(
    String(lv).padStart(4) + ' |' + String(Math.round(cellSum / REPS)).padStart(5) + ' |'
    + String(Math.round(botSum / REPS)).padStart(5) + ' |' + String(cols).padStart(3) + ' |'
    + String(tubes).padStart(3) + ' |' + String(slots).padStart(3) + ' |' + String(gates).padStart(3) + ' |'
    + String(ice).padStart(3) + ' |'
    + String(Math.round(picksum / REPS) + '/' + Math.round(botSum / REPS)).padStart(15) + ' |'
    + String(rate + '%').padStart(15) + ' |' + String(avgSteps).padStart(9) + ' |'
    + String(low).padStart(5) + ' |' + String(low ? (avgSteps / low).toFixed(1) : '-').padStart(6)
  );
}
out.push('');
out.push('说明：');
out.push('  开局可点/总瓶 = 开局时玩家能立刻取走的瓶子占比（越高＝选择越多＝越简单）');
out.push('  贪心首战通关率 = 不做任何规划、只按"能接就接"走一遍的通关概率（越高＝越随便也能赢）');
out.push('  下界 = 瓶数×3（每瓶 3 口、每次接 1 口）；绕路比 = 实际步数/下界（越接近 1 越顺）');
out.push('  每关采样 ' + REPS + ' 次');
fs.writeFileSync(path.join(__dirname, '_diff.txt'), out.join('\n'));

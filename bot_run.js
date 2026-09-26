// 机器人通关验证：难度曲线大改后（瓶子 12→24），1~10 关是否都还能打通
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
function botPlay(level, maxTries) {
  for (let attempt = 0; attempt < maxTries; attempt++) {
    DBG.gen(level); frames(10); frames(5);
    let guard = 0, ok = true;
    while (DBG.G.state !== 'win' && guard++ < 2000) {
      if (DBG.G.anim) { frames(25); continue; }
      if (!botStep(DBG.G)) { ok = false; break; }
      frames(4);
    }
    frames(60);
    if (ok && DBG.G.state === 'win') return { win: true, steps: guard };
  }
  return { win: false, steps: -1 };   // 别把失败写成 0 —— 会被误读成「一步都没走」
}

const out = [];
out.push('关卡 | 格子 | 瓶子 | 门洞 | 结果 | 步数');
out.push('-----+------+------+------+------+-----');
const ONLY = (process.env.ONLY || '').trim();
const TRIES = +(process.env.TRIES || 3);
const MAXLV = +(process.env.MAX || 30);
const LVS = ONLY ? ONLY.split(',').map(Number)
  : Array.from({ length: MAXLV }, (_, k) => k + 1);
let allWin = true;
for (const lv of LVS) {
  DBG.gen(lv); frames(6);
  const g = DBG.G;
  const cells = g.cellCount, bots = g.bottles.length, gates = g.gates.length;
  const r = botPlay(lv, TRIES);
  if (!r.win) allWin = false;
  out.push(String(lv).padStart(4) + ' |' + String(cells).padStart(5) + ' |' + String(bots).padStart(5) + ' |'
    + String(gates).padStart(5) + ' |' + (r.win ? ' 通关 ' : ' 未通过') + ' | ' + r.steps);
}
out.push('');
out.push(allWin ? '=== 全部通关（尝试次数上限 ' + TRIES + '）===' : '=== 有关卡未通过，需要排查 ===');
fs.writeFileSync(path.join(__dirname, '_bot.txt'), out.join('\n'));

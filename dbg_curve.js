// 关卡曲线诊断：1~40 关的布局/难度参数全量 dump
const fs = require('fs'), path = require('path');
const FILE = process.argv[2] || path.join(__dirname, 'outputs', '解压水消除.html');
let html = fs.readFileSync(FILE, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
let code = m[1];
let rafCb = null;
function makeCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return (s) => ({ width: String(s).length * 14 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (typeof k === 'string') return t[k] !== undefined ? t[k] : noop;
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
const ctx2d = makeCtx();
const canvas = { clientWidth: 720, clientHeight: 1280, width: 720, height: 1280, style: {}, getContext: () => ctx2d, addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 1280 }) };
global.window = global; global.addEventListener = () => {};
global.document = { getElementById: () => canvas, createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx() }), addEventListener: () => {} };
global.navigator = { maxTouchPoints: 0 };
global.innerWidth = 720; global.innerHeight = 1280; global.devicePixelRatio = 1;
global.requestAnimationFrame = (cb) => { rafCb = cb; };
global.performance = { now: () => 0 };
const A = 'requestAnimationFrame(loop);';
const i = code.lastIndexOf(A);
code = code.slice(0, i)
  + 'window.__DBG={get G(){return G;},gen:genLevel,plan:levelPlan,layoutSolvable:layoutSolvable,checkStuck:checkStuck};'
  + code.slice(i);
eval(code);
const DBG = global.__DBG;
let T = 0;
function frames(n) { for (let k = 0; k < n; k++) { T += 16.7; const cb = rafCb; rafCb = null; cb && cb(T); } }

const L = [];
L.push('关卡 | 周期      | 色 | 洞 | 冰 | 槽 | 格子 | 行×列(实际行长度) | tile | 瓶 | 层高 | 管 | 可解');
L.push('-----+-----------+----+----+----+----+------+-------------------+------+----+------+----+-----');
const rowStats = {};
let lastCells = 0, allSolv = true;
for (let lv = 1; lv <= 40; lv++) {
  DBG.gen(lv); frames(3);
  const G = DBG.G;
  const p = DBG.plan(lv);
  const tag = (p.peak ? '★峰值' : (p.breathe ? '·放水' : '  爬坡')) + '(era' + p.era + ')';
  const rl = G.rowLen.join('+');
  const cols = G.rowLen;
  const shape = cols.length + '行×' + Math.max(...cols) + '列';
  const solv = DBG.layoutSolvable();
  if (!solv) allSolv = false;
  rowStats[shape] = (rowStats[shape] || 0) + 1;
  const layers = G.tubes.length ? Math.max(...G.tubes.map(t => t.units.length)) : 0;
  L.push(String(lv).padStart(4) + ' | ' + tag.padEnd(10) + '|' + String(p.colors).padStart(3) + ' |'
    + String(G.gates.length).padStart(3) + ' |' + String(G.bottles.filter(b => b.locked > 0).length).padStart(3) + ' |'
    + String(G.slots.length).padStart(3) + ' |' + String(G.cellCount).padStart(5) + ' | ' + shape.padEnd(8)
    + '(' + rl.padEnd(11) + ')  |' + String(Math.round(G.tile)).padStart(5) + ' |'
    + String(G.bottles.length).padStart(4) + ' |' + String(G.uh).padStart(5) + ' |' + String(G.tubes.length).padStart(3) + ' |'
    + (solv ? '  ✅' : '  ❌'));
}
L.push('');
L.push('=== 出现的行列组合统计（40 关） ===');
Object.keys(rowStats).sort((a, b) => rowStats[b] - rowStats[a]).forEach(k => L.push('  ' + k.padEnd(10) + ' × ' + rowStats[k] + ' 关'));
L.push('');
L.push('=== 全 40 关生成期可解性 === ' + (allSolv ? '全部可解 ✅' : '有不可解关卡 ❌'));
fs.writeFileSync(path.join(__dirname, '_curve.txt'), L.join('\n'));
console.log(L.join('\n'));

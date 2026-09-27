/* qa_lib.js —— 单文件 HTML 游戏的 Node 无头测试外壳（arch / design / ui 三个套件共用）
 *
 * 设计原则：
 *  1. 不 require 游戏源码里的任何东西，只靠 <script> 文本注入后门 —— 游戏本体保持零依赖
 *  2. ctx 用 Proxy 兜底，任何 canvas API 缺失都不会抛错；但**真实 JS 错误照抛**，
 *     所以「渲染里写了不存在的变量」这种崩溃能被抓到（配合 fatalShown 标志）
 *  3. setView(w,h) 直接改模块作用域的 cw/ch/offX/offY/scale —— 多分辨率 UI 测试靠它，
 *     比伪造 visualViewport 可靠得多
 *  4. 每个套件跑完必须打印一行 `__QA__ {json}`，供 qa_run.js 汇总
 */
const fs = require('fs');
const path = require('path');

const GAME = process.env.GAME || path.join(__dirname, 'outputs', '解压水消除.html');

function makeCtx(rec) {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === 'fillText') return (s) => { rec.texts.push(String(s)); };
      if (k === 'measureText') return (s) => ({ width: String(s).length * 14 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (typeof k === 'string') return t[k] !== undefined ? t[k] : noop;
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

/* 注入的后门：所有套件共用一个超集 */
const INJECT = `window.__DBG={
  get G(){return G;}, get fatal(){return fatalShown;}, get URL_LVL(){return URL_LVL;},
  tap:handleTap, gen:genLevel, plan:levelPlan, tubeCountFor:tubeCountFor,
  freeSlot:freeSlot, bottomOf:bottomOf, lockedSlots:lockedSlots,
  gateBlocked:gateBlocked, gateFront:gateFront, gateMouthCell:gateMouthCell, gateRest:gateRest, gateAt:gateAt,
  gridPlayable:gridPlayable, neighborEmpty:neighborEmpty, neighborCell:neighborCell,
  cellOccupied:cellOccupied, cellRect:cellRect, cellAt:cellAt,
  cellsAdjacent:function(a,b){return cellsAdjacent(a,b);},
  checkStuck:checkStuck, layoutSolvable:layoutSolvable, iceAt:iceAt,
  jarAtCounter:jarAtCounter, bottleAtGrid:bottleAtGrid, toolAt:toolAt,
  unlockBadgeAt:unlockBadgeAt, tubeAt:tubeAt, toVirtual:toVirtual,
  rowX0:rowX0, slotPos:slotPos, layoutAll:layoutAll,
  snapAnim:snapAnim, lvPickTap:lvPickTap, LV_PANEL:LV_PANEL,
  AdService:AdService, Analytics:Analytics, SaveData:SaveData, AD_CFG:AD_CFG,
  doRevive:doRevive, adRefillTool:adRefillTool, restoreSafeSnap:restoreSafeSnap, saveSafeSnap:saveSafeSnap,
  calcStars:calcStars, nextLevel:nextLevel,
  drawBottle:drawBottle, drawJarCounter:drawJarCounter, drawGrid:drawGrid, drawSlot:drawSlot,
  setView:function(w,h){ cw=w; ch=h; dpr=1;
    scale=Math.min(cw/VW,ch/VH); if(!isFinite(scale)||scale<=0)scale=1;
    offX=(cw-VW*scale)/2; offY=(ch-VH*scale)/2; },
  view:function(){ return {cw:cw,ch:ch,scale:scale,offX:offX,offY:offY,dpr:dpr}; },
  consts:function(){ return {VW:VW,VH:VH,UH:UH,BOTT_Y:BOTT_Y,TUBE_CUT_Y:TUBE_CUT_Y,
    TUBE_FADE_H:TUBE_FADE_H,SLOT_Y:SLOT_Y,GRID_Y0:GRID_Y0,GX:GX,GY:GY,
    TOOL_Y:TOOL_Y,TOOL_H:TOOL_H,TOOL_W:TOOL_W,TOOL_GAP:TOOL_GAP,TOOL_X0:TOOL_X0,
    COLORS:COLORS.slice(), DIRS:DIRS.map(function(d){return {dx:d.dx,dy:d.dy};})}; }
};`;

function loadGame(opt) {
  opt = opt || {};
  const html = fs.readFileSync(GAME, 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('未找到 <script> 块');
  const rec = { texts: [], fatals: [] };
  const listeners = {};        // canvas
  const winListeners = {};     // window
  let rafCb = null;

  const W = opt.width || 720, H = opt.height || 1280, DPR = opt.dpr || 1;
  const ctx2d = makeCtx(rec);
  const canvas = {
    clientWidth: W, clientHeight: H, width: W * DPR, height: H * DPR, style: {},
    getContext: () => ctx2d,
    addEventListener: (t, fn) => { listeners[t] = fn; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H })
  };
  const store = {};
  global.window = global;
  global.document = {
    getElementById: () => canvas,
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => makeCtx({ texts: [] }) }),
    addEventListener: () => {}
  };
  global.addEventListener = (t, fn) => { winListeners[t] = fn; };
  global.removeEventListener = () => {};
  global.navigator = { maxTouchPoints: 0, userAgent: 'node-qa' };
  global.location = { search: opt.search || '', href: 'https://example.invalid/', hash: '' };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  global.innerWidth = W; global.innerHeight = H;
  global.devicePixelRatio = DPR;
  global.requestAnimationFrame = (cb) => { rafCb = cb; };
  global.cancelAnimationFrame = () => {};
  global.performance = { now: () => 0 };
  global.Image = function () { return { style: {}, set src(v) {} }; };
  global.Audio = function () { return { play() {} }; };

  let code = m[1];
  const A = 'requestAnimationFrame(loop);';
  const i = code.lastIndexOf(A);
  if (i < 0) throw new Error('找不到注入点 requestAnimationFrame(loop);');
  const injected = code.slice(0, i) + INJECT + '\n  ' + code.slice(i);

  eval(injected);
  const DBG = global.__DBG;
  if (!DBG) throw new Error('后门注入失败：__DBG 未定义');

  let T = 0;
  function frames(n) {
    for (let k = 0; k < n; k++) { T += 16.7; const cb = rafCb; rafCb = null; cb && cb(T); }
  }
  function click(x, y) { listeners['mousedown'] && listeners['mousedown']({ clientX: x, clientY: y }); }
  function touch(x, y) {
    listeners['touchstart'] && listeners['touchstart']({
      cancelable: true, preventDefault() {}, changedTouches: [{ clientX: x, clientY: y }]
    });
  }
  function move(x, y) { listeners['mousemove'] && listeners['mousemove']({ clientX: x, clientY: y }); }
  function viewClick(vx, vy) {
    const v = DBG.view();
    click(vx * v.scale + v.offX, vy * v.scale + v.offY);
  }
  function waitIdle(max) {
    for (let k = 0; k < (max || 400) && DBG.G.anim; k++) frames(1);
  }
  function settle() { waitIdle(); frames(4); }
  function textsClean() {
    return rec.texts.every(t => t.indexOf('NaN') < 0 && t.indexOf('undefined') < 0 && t.indexOf('Infinity') < 0);
  }
  /* 渲染一次并回收记录的文字，用于「这段绘制到底说了什么」的断言 */
  function renderOnce() {
    rec.texts.length = 0;
    frames(1);
    return rec.texts.slice();
  }
  return {
    html, code: m[1], DBG, frames, click, touch, move, viewClick, waitIdle, settle,
    textsClean, renderOnce, texts: rec.texts, listeners, winListeners,
    fireResize: () => { winListeners['resize'] && winListeners['resize']({}); }
  };
}

/* ---------- 极简断言器：每个套件跑完打印 __QA__ {json} 供编排器汇总 ---------- */
function Reporter(suite) {
  this.suite = suite; this.pass = 0; this.fail = 0; this.warn = 0;
  this.fails = []; this.warns = [];
  this.t0 = Date.now();
}
Reporter.prototype.ok = function (t, cond, detail) {
  if (cond) { this.pass++; console.log('PASS  ' + t); }
  else { this.fail++; this.fails.push(t + (detail ? '  → ' + detail : '')); console.log('FAIL  ' + t + (detail ? '  → ' + detail : '')); }
  return !!cond;
};
Reporter.prototype.warnIf = function (t, bad, detail) {
  if (bad) { this.warn++; this.warns.push(t + (detail ? '  → ' + detail : '')); console.log('WARN  ' + t + (detail ? '  → ' + detail : '')); }
  else { this.pass++; console.log('PASS  ' + t); }
};
Reporter.prototype.done = function () {
  const ms = Date.now() - this.t0;
  console.log('\n=== SUITE ' + this.suite + ': ' + this.pass + ' PASS / ' + this.fail + ' FAIL / '
    + this.warn + ' WARN  (' + ms + 'ms) ===');
  console.log('__QA__ ' + JSON.stringify({
    suite: this.suite, pass: this.pass, fail: this.fail, warn: this.warn,
    ms: ms, fails: this.fails, warns: this.warns
  }));
  process.exit(this.fail === 0 ? 0 : 1);
};
/* 套件级守卫：整段逻辑抛异常时也要给出结论，不能让编排器看到"静默成功" */
function guard(rep, name, fn) {
  try { fn(); } catch (e) {
    console.error(e && e.stack || e);
    rep.ok('套件「' + name + '」执行完成', false, String(e && e.message || e).slice(0, 160));
  }
}

module.exports = { loadGame, Reporter, guard, GAME };

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
  maxTubesByWidth:maxTubesByWidth, moveBudgetFor:moveBudgetFor, estimateActions:estimateActions,
  /* V6.0 曲线常量：断言里不写死数字，一律从产品常量读，避免「测试和产品各写一份」 */
  CURVE:{SLOT_CAP:SLOT_CAP,GATE_CAP:GATE_CAP,ICE_CAP:ICE_CAP,GRID_MAX_ROWS:GRID_MAX_ROWS,
    GRID_MAX_COLS:GRID_MAX_COLS,TUBE_MIN_W:TUBE_MIN_W,ACTION_PER_BOTTLE:ACTION_PER_BOTTLE,
    MOVE_BUDGET_EARLY:MOVE_BUDGET_EARLY,MOVE_BUDGET_MID:MOVE_BUDGET_MID,MOVE_BUDGET_LATE:MOVE_BUDGET_LATE,
    MAX_COLORS:STAGE_CURVE[STAGE_CURVE.length-1].colors[1],      /* 曲线自己的颜色天花板（18） */
    PALETTE:COLORS.length,                                       /* 调色板长度（20，留余量） */
    STAGE:STAGE_CURVE,stageOf:stageOf,stageIndex:stageIndex},
  /* V6.0 §五-A 回归热身：测试要能直接驱动「判定 / 升档 / 档位换算」 */
  warm:{nowMs:nowMs,idleSeconds:idleSeconds,resolveChallengeTier:resolveChallengeTier,
    inWarmup:inWarmup,warmupOnBoot:warmupOnBoot,advanceWarmup:advanceWarmup,tierLabel:tierLabel},
  freeSlot:freeSlot, bottomOf:bottomOf, lockedSlots:lockedSlots,
  gateBlocked:gateBlocked, gateFront:gateFront, gateMouthCell:gateMouthCell, gateRest:gateRest, gateAt:gateAt,
  gridPlayable:gridPlayable, neighborEmpty:neighborEmpty, neighborCell:neighborCell,
  cellOccupied:cellOccupied, cellRect:cellRect, cellAt:cellAt,
  cellsAdjacent:function(a,b){return cellsAdjacent(a,b);},
  checkStuck:checkStuck, layoutSolvable:layoutSolvable, iceAt:iceAt,
  jarAtCounter:jarAtCounter, bottleAtGrid:bottleAtGrid, toolAt:toolAt,
  unlockBadgeAt:unlockBadgeAt, tubeAt:tubeAt, toVirtual:toVirtual,
  rowX0:rowX0, slotPos:slotPos, layoutAll:layoutAll,
  /* B 组（UX 评审真 bug）：万能指 / 退回 / 通关结算 / 每日挑战种子 / 道具栏绘制 */
  TOOLBS:TOOLBS, useFinger:useFinger, startReturn:startReturn, startPlace:startPlace,
  levelDone:levelDone, dailySeed:dailySeed, drawTools:drawTools,
  snapAnim:snapAnim, lvPickTap:lvPickTap, LV_PANEL:LV_PANEL,
  WIN_UI:WIN_UI, TIER_UI:TIER_UI, TIER_NAME:TIER_NAME, checkAllGone:checkAllGone,
  drawBottle:drawBottle, drawJarCounter:drawJarCounter, drawGrid:drawGrid, drawSlot:drawSlot,
  CFG:CFG, Store:Store, AdService:AdService, Track:Track, SAVE_KEY:SAVE_KEY, SAVE_VER:SAVE_VER,
  levelDone:levelDone, saveProgress:saveProgress, bootSession:bootSession,
  totalStars:totalStars, tierUnlocked:tierUnlocked, starsOf:starsOf,
  startDaily:startDaily, dateKey:dateKey, dailySeed:dailySeed, dailyDoneToday:dailyDoneToday,
  enterFail:enterFail, doRevive:doRevive, hasLegalDecision:hasLegalDecision, boardPlayable:boardPlayable,
  /* 2026-10-01 23:00 档补：把此前「零测试引用」的四组机制暴露出来
     —— 存档续玩 / 复活兜底阶梯 / 撤销额度与栈上限 / 台面账目自洽。 */
  startFromTitle:startFromTitle, goHome:goHome, TITLE_UI:TITLE_UI,
  rescueGrant:rescueGrant, addUndo:addUndo,
  counterCount:counterCount, openSlotCount:openSlotCount, clearTargetExists:clearTargetExists,
  /* 2026-10-02 23:00 档补：选关面板几何（G6b 要它）。
     ⚠ 为什么要从运行期读而不是继续正则扒源码：V6.1 把 LV_PAGES 从数字字面量改成了
     Math.ceil(CFG.maxLevel/LV_PER_PAGE)（页数随关卡上限走），qa_gate 里那条
     匹配 LV_PAGES 后接一个数字的正则**再也匹配不上** → G6b 一直报「读不到」直接判 FAIL，
     连「线上能不能上」都被它拦住。读运行期的值是同一份真相、而且不会因为声明风格而失效。
     注：本段在模版字符串里，注释内严禁出现反引号（会把模版串截断 → 整个 qa_lib 语法错）。 */
  LV_PER_PAGE:LV_PER_PAGE, LV_PAGES:LV_PAGES,
  /* 2026-10-02 23:00 档补：清除目标选择的**语义**（只挑台面 / 同色 / 未满的瓶子）。
     此前只验了「清掉的那杯水倒进同色瓶」的守恒，没验过「选中了谁」——
     选错目标（挑到货架瓶 / 已满瓶 / 异色瓶）一样会让水消失或错位，守恒断言照样绿。 */
  clearJarFor:clearJarFor,
  /* FIX-04：软提示按钮 + 失败面板撤销按钮（绘制与命中必须共用 hintRects） */
  FAIL_OPTS:FAIL_OPTS, hintRects:hintRects, hintHit:hintHit, hintTap:hintTap,
  hintOpts:hintOpts, hintAction:hintAction,
  failUndo:failUndo, failUndoShow:failUndoShow, failUndoAlpha:failUndoAlpha,
  failUndoTitle:failUndoTitle, unlockSlot:unlockSlot, drawHint:drawHint, snapshot:snapshot,
  refillTool:refillTool, waterLeft:waterLeft, findSafeSnapshotIdx:findSafeSnapshotIdx, doUndo:doUndo,
  useClear:useClear, useSwap:useSwap, thawByNeighbors:thawByNeighbors, snapshot:snapshot,
  /* 2026-10-04 互换改造：任意两格换位 + 层命中，必须能从测试侧调用，否则这条新能力无法被断言 */
  useSwapLayer:useSwapLayer, unitAt:unitAt, tubeAt:tubeAt,
  useClearAll:useClearAll,
  setView:function(w,h){ cw=w; ch=h; dpr=1;
    scale=Math.min(cw/VW,ch/VH); if(!isFinite(scale)||scale<=0)scale=1;
    offX=(cw-VW*scale)/2; offY=(ch-VH*scale)/2; },
  view:function(){ return {cw:cw,ch:ch,scale:scale,offX:offX,offY:offY,dpr:dpr}; },
  consts:function(){ return {VW:VW,VH:VH,UH:UH,BOTT_Y:BOTT_Y,TUBE_CUT_Y:TUBE_CUT_Y,
    TUBE_FADE_H:TUBE_FADE_H,SLOT_Y:SLOT_Y,GRID_Y0:GRID_Y0,GX:GX,GY:GY,
    TOOL_Y:TOOL_Y,TOOL_H:TOOL_H,TOOL_W:TOOL_W,TOOL_GAP:TOOL_GAP,TOOL_X0:TOOL_X0,
    TOOL_IDS:TOOLBS.map(function(t){return t.id;}),
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

/* 固定随机种子：关卡是随机生成的，「特定局面」类断言不套种子就是在赌运气（flaky）。
   用法：withSeed(20260927, function(){ D.gen(7); });
   注意 fn 内部不要跑 frames —— 帧循环里的粒子/抖动也用 Math.random，没问题，
   但生成完就还原种子才能保证「同一局面」的这一段是确定的。 */
function withSeed(seed, fn) {
  const orig = Math.random;
  let x = seed >>> 0;
  Math.random = function () { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  try { return fn(); } finally { Math.random = orig; }
}

/* ★ qa_live_sim.js 要拿**线上真实字节**做真浏览器深测，而它拿不到 Node 侧的 eval 后门，
   所以把 INJECT 导出 —— 由它用同一份后门文本注入到线上 HTML 里。
   绝不许在别的测试文件里再抄一份后门（抄一份 = 两份会各自漂移）。 */
module.exports = { loadGame, Reporter, guard, withSeed, GAME, INJECT, INJECT_ANCHOR: 'requestAnimationFrame(loop);' };

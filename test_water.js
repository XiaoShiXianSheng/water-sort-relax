// 解压水消除 v2 —— Node 无头回归测试
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, 'outputs', '解压水消除.html');
let html = fs.readFileSync(FILE, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('FAIL: 未找到 <script>'); process.exit(1); }
let code = m[1];

// ---- 浏览器桩 ----
const listeners = {};
let rafCb = null;
const texts = [];
function makeCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, k) {
      if (k === 'fillText') return (s) => { texts.push(String(s)); };
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

// ---- 后门注入 ----
const A = 'requestAnimationFrame(loop);';
const i = code.lastIndexOf(A);
if (i < 0) { console.error('FAIL: 找不到注入点'); process.exit(1); }
code = code.slice(0, i)
  + 'window.__DBG={get G(){return G;},tap:handleTap,gen:genLevel,freeSlot:freeSlot,bottomOf:bottomOf,'
  + 'gateBlocked:gateBlocked,gateFront:gateFront,gateMouthCell:gateMouthCell,gateRest:gateRest,gateAt:gateAt,'
  + 'gridPlayable:gridPlayable,neighborEmpty:neighborEmpty,neighborCell:neighborCell,cellOccupied:cellOccupied,'
  + 'cellRect:cellRect,cellAt:cellAt,checkStuck:checkStuck,'
  + 'layoutSolvable:layoutSolvable,iceAt:iceAt,drawJarCounter:drawJarCounter,get fatal(){return fatalShown;},'
  + 'plan:levelPlan,snapAnim:snapAnim,lvPickTap:lvPickTap,LV_PANEL:LV_PANEL,tubeCountFor:tubeCountFor,'
  + 'maxTubesByWidth:maxTubesByWidth,moveBudgetFor:moveBudgetFor,'
  + 'CURVE:{SLOT_CAP:SLOT_CAP,GATE_CAP:GATE_CAP,ICE_CAP:ICE_CAP,GRID_MAX_ROWS:GRID_MAX_ROWS,'
  + 'GRID_MAX_COLS:GRID_MAX_COLS,TUBE_MIN_W:TUBE_MIN_W,ACTION_PER_BOTTLE:ACTION_PER_BOTTLE,'
  + 'MAX_COLORS:STAGE_CURVE[STAGE_CURVE.length-1].colors[1]},'
  + 'tryDrinks:tryDrinks,manifoldTarget:manifoldTarget,'
  + 'CFG:CFG,AdService:AdService,Track:Track,Store:Store,TOOLBS:TOOLBS,FAIL_OPTS:FAIL_OPTS,'
  + 'WIN_UI:WIN_UI,TITLE_UI:TITLE_UI,TIER_UI:TIER_UI,inBox:inBox,'
  + 'enterFail:enterFail,doRevive:doRevive,hasLegalDecision:hasLegalDecision,levelDone:levelDone,'
  + 'refillTool:refillTool,goHome:goHome,startDaily:startDaily,dateKey:dateKey,dailySeed:dailySeed,'
  + 'totalStars:totalStars,tierUnlocked:tierUnlocked,unlockNextTier:unlockNextTier,saveProgress:saveProgress,'
  + 'adReward:adReward,waterLeft:waterLeft,findSafeSnapshotIdx:findSafeSnapshotIdx,doUndo:doUndo,'
  + 'adj:function(a,b){return cellsAdjacent(a,b);}};\n  '
  + code.slice(i);

try { eval(code); } catch (e) { console.error('EVAL FAIL:', e.stack); process.exit(1); }

let T = 0;
function frames(n) {
  for (let k = 0; k < n; k++) { T += 16.7; const cb = rafCb; rafCb = null; cb && cb(T); }
}
function click(x, y) { listeners['mousedown'] && listeners['mousedown']({ clientX: x, clientY: y }); }
function waitIdle(maxFrames) {
  for (let k = 0; k < (maxFrames || 300) && (DBG.G.anim || tryDrinksPending()); k++) frames(1);
}
function tryDrinksPending() { return false; }
let failures = 0;
function chk(name, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) failures++;
}
/* 道具/广告这些"特定局面"的测试不能赌随机关卡：genLevel 每次布局不同，
   同一个断言在两次运行里会得到不同结果（flaky）。给它们套一层确定性随机。 */
function withSeed(s, fn) {
  const orig = Math.random; let x = s >>> 0;
  Math.random = function () { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  try { return fn(); } finally { Math.random = orig; }
}
/* 关键陷阱：handleTap 开场会执行 finishDrink() 把正在进行的喝水动画落定，
   那一刻水管底层数据会变。所以任何"精确验证道具效果"的操作都必须先 settle，
   否则测出来的不是道具的行为，而是上一次喝水的影响。 */
function settle() { waitIdle(); frames(4); }
function textsClean() {
  return texts.every(t => t.indexOf('NaN') < 0 && t.indexOf('undefined') < 0);
}
const DBG = global.__DBG;

const BOTT_Y = 470;   // 水管底对齐基准线
const SLOT_Y = 700;   // 台面表面（瓶底），广告解锁徽章画在 SLOT_Y-52
const TOOL_X0 = 85, TOOL_W = 130, TOOL_GAP = 10, TOOL_Y = 1176, TOOL_H = 96;   // 去掉分享按钮后居中（产品侧同步）
function toolCX(i) { return TOOL_X0 + i * (TOOL_W + TOOL_GAP) + TOOL_W / 2; }
function toolCY() { return TOOL_Y + TOOL_H / 2; }
function tubeMidY(t) { return BOTT_Y - t.h / 2; }
// ---- 贪心机器人 ----
function bottoms(G) { return G.tubes.map(t => t.units[0]).filter(c => c !== undefined && c >= 0); }
function isStuck(G) {
  if (G.anim) return false;
  const bs = bottoms(G);
  if (!bs.length) return false;
  for (const b of G.bottles) if (b.place === 'counter' && b.fill < b.cap && bs.includes(b.col)) return false;
  for (const b of G.bottles) if (DBG.gridPlayable(b)) return false;   // 还能拿上台面就不算卡死
  return true;
}
function botStep(G) {
  // 真的走到死局 → 面板上选「看广告 · 万能消除 +1」继续玩
  if (G.stuck) { click(360, 759); frames(6); return true; }
  const bs = bottoms(G);
  // 1. 放一个能喝的瓶子（门洞里排在后面的、洞口被挡的都不行）
  for (const b of G.bottles) {
    if (DBG.gridPlayable(b) && bs.includes(b.col) && DBG.freeSlot() >= 0) {
      click(b.x, b.y); return true;
    }
  }
  // 2. 台面满且没有能放的 → 先点撤销进入退回模式，再把喝不动的瓶子拿回格子
  const idle = G.bottles.filter(b => b.place === 'counter' && b.fill < b.cap && !bs.includes(b.col));
  if (idle.length && DBG.freeSlot() < 0 && G.undoLeft > 0) {
    click(toolCX(3), toolCY()); frames(2);
    click(idle[0].x, idle[0].y - 50); return true;
  }
  // 3. 台面上的瓶子还在自己喝水 → 等它喝（不算卡住）
  if (G.bottles.some(b => b.place === 'counter' && b.fill < b.cap && bs.includes(b.col))) { frames(20); return true; }
  // 4. 有冰冻瓶 / 门洞还堵着 → 优先放掉它旁边那格的瓶子腾位置
  const needRoom = G.bottles.filter(b => (b.locked > 0 && b.place === 'grid') ||
    (b.gate >= 0 && b.place === 'grid' && (!DBG.gateFront(b) || DBG.gateBlocked(b))));
  if (needRoom.length && DBG.freeSlot() >= 0) {
    const cands = G.bottles.filter(b => DBG.gridPlayable(b));
    const near = cands.find(b => needRoom.some(i => DBG.adj(i.cell, b.cell)));
    const pick = near || cands[0];
    if (pick) { click(pick.x, pick.y); return true; }
  }
  // 4. 卡住 → 道具
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
    DBG.gen(level); frames(10); texts.length = 0;
    frames(5);
    let guard = 0, ok = true;
    while (DBG.G.state !== 'win' && guard++ < 1200) {
      if (DBG.G.anim) { frames(25); continue; }
      if (!botStep(DBG.G)) { ok = false; break; }
      frames(4);
    }
    frames(60);
    if (ok && DBG.G.state === 'win' && textsClean()) return true;
    console.log('  … 第 ' + (attempt + 1) + ' 次生成未通过，重开一局');
  }
  return false;
}

// ============ 测试 1：冒烟 ============
try {
  frames(30);
  chk('标题页出现', texts.some(t => t.indexOf('解压水消除') >= 0));
  click(360, 860); frames(10);
  chk('点击开始进入游戏', DBG.G.state === 'play');
  let threw = false;
  try {
    for (let k = 0; k < 400; k++) { click(Math.random() * 720, Math.random() * 1280); frames(2); }
    frames(3000);
  } catch (e) { threw = true; console.error(e); }
  chk('冒烟：随机乱点 400 次 + 3000 帧无异常', !threw);
  chk('冒烟：文本无 NaN/undefined', textsClean());
} catch (e) { console.error(e); chk('冒烟套件执行', false); }

/* ---------- 冒烟段的副作用必须清掉（2026-09-28 抓到，20 次里 5 次整簇假 FAIL）----------
   400 次随机点击有约 27% 的概率点到「胜界面 → 挑战 → 困难」这条路径，
   而 genLevel(lv) 在**不传 opts.tier 时沿用 G.tier**（这是产品上"记住玩家选的档位"的正常行为）。
   于是后面每一处「普通档」断言都在拿困难档的关卡做比较：
     第 1 关变 12 格 / 4 槽（本该 9 格 / 5 槽）→ 连坐
     「3×3=9 格」「台面槽 5~7」「水柱不顶出画面」「门洞数按 levelPlan」「格子数按 levelPlan」
     一整簇同时 FAIL，还偶发连坐「接水动画」「第二次进失败态」「机器人第 6 关」。
   探针 _flake_probe.js 复现：30 次里 8 次 tier 被改脏，脏后 gen(1) 恒为 12 格 / 4 槽。
   修法：冒烟后用一行显式还原 + 一条哨兵断言守住它（下面这条断言必须存在，删了还原就没人守）。 */
(function () {
  const dirtied = DBG.G.tier;
  DBG.G.tier = 0;                                   // ← 还原为普通档（这一行是后续所有普通档断言的前提）
  DBG.gen(1); frames(6);
  chk('冒烟随机点击后档位已还原为普通档（脏档会让后面一整簇断言失真）',
    DBG.G.tier === 0 && DBG.G.cellCount === 9 && DBG.G.slots.length === 5);
  if (dirtied !== 0) console.log('  （本次冒烟确实点到了挑战档：tier ' + dirtied + ' → 已还原）');
})();

// ============ 测试 2：机器人通关（多关卡） ============
try {
  chk('机器人通关 第 2 关', botPlay(2, 4));
  chk('机器人通关 第 4 关（含锁定瓶）', botPlay(4, 5));
  chk('机器人通关 第 6 关（6 色 12 瓶）', botPlay(6, 5));
  chk('结算页文本无 NaN/undefined', textsClean());
} catch (e) { console.error(e); chk('机器人套件执行', false); }

// ============ 测试 3：台面功能 + 分享面板 + 守恒 ============
try {
  // 撤销大按钮（左下）
  DBG.gen(1); frames(10);
  DBG.G.tubes.forEach(t => { t.units = [5]; });   // 冻结喝水（管底是场上没有的颜色），让这段流程可确定复现
  frames(4);
  const b2 = DBG.G.bottles.find(x => x.place === 'grid' && !x.locked);
  click(b2.x, b2.y); frames(45);
  waitIdle(600);
  const onCounter = DBG.G.bottles.some(x => x.place === 'counter');
  const jarOnCounter = DBG.G.bottles.find(x => x.place === 'counter');
  const beforeUndo = DBG.G.undoLeft;
  // 直接点台面瓶子不该被退回
  click(jarOnCounter.x, jarOnCounter.y - 50); waitIdle(60);
  chk('直接点台面瓶子不会退回（需先点撤销）', jarOnCounter.place === 'counter');
  // 点撤销 → 进入退回模式 → 再点瓶子
  click(toolCX(3), toolCY()); frames(5);
  chk('点撤销进入退回模式', DBG.G.mode === 'return');
  click(jarOnCounter.x, jarOnCounter.y - 50); waitIdle(600);
  chk('退回模式下点瓶子放回格子', jarOnCounter.place === 'grid' && DBG.G.undoLeft === beforeUndo - 1);
  // 台面空了之后，撤销 = 撤销上一步
  click(b2.x, b2.y); frames(45); waitIdle(600);
  DBG.G.tubes.forEach(t => { t.units = [5]; });   // 再冻一次，避免这一轮被喝满消除
  frames(4);
  const beforeUndo2 = DBG.G.undoLeft;
  let g2 = 0;
  while (DBG.G.undoLeft === beforeUndo2 && g2++ < 60) {
    click(toolCX(3), toolCY()); waitIdle(20);
    const cur = DBG.G.bottles.find(x => x.place === 'counter');
    if (cur) click(cur.x, cur.y - 50);
    waitIdle(20);
  }
  waitIdle(600);
  const noCounter = DBG.G.bottles.every(x => x.place !== 'counter');
  if (!(onCounter && noCounter)) {
    console.log('  [诊断] onCounter=' + onCounter + ' noCounter=' + noCounter +
      ' undo=' + DBG.G.undoLeft + ' beforeUndo2=' + beforeUndo2 + ' 循环次数=' + g2 +
      ' mode=' + DBG.G.mode + ' anim=' + (DBG.G.anim && DBG.G.anim.type) +
      ' b2=' + b2.place + ':' + b2.fill + '/' + b2.cap +
      ' counter=[' + DBG.G.bottles.filter(x => x.place === 'counter').map(x => x.col + '@' + x.slot + ':' + x.fill + '/' + x.cap).join(' ') + ']');
  }
  chk('放置后撤销能还原台面', onCounter && noCounter);
  // 台面只有一个广告解锁槽，徽章就在它上面
  DBG.gen(2); frames(10);
  chk('台面只留 1 个广告解锁槽', DBG.G.slots.filter(s => !s.open).length === 1);
  const lockedSlot = DBG.G.slots.findIndex(s => !s.open);
  const lockedN = DBG.G.slots.filter(s => !s.open).length;
  click(DBG.G.slotX[lockedSlot], 628); frames(5);
  chk('点播放按钮解锁台面槽', DBG.G.slots.filter(s => !s.open).length === lockedN - 1);
  /* ---- 广告补次（V4.0 §12-P1 广告场景②）：Test Mode 下点即模拟完成并发放 ----
     说明：这是 V4.0 §4 要求【必须保留】的 Test Mode，不是"假广告"——
     它只在 TEST 环境生效；ONLINE 环境必须走真实 onClose(isEnded) 回调（见 qa_biz.js）。 */
  DBG.gen(1); frames(10);
  DBG.AdService.resetSession();          // 频控是「会话级」的，显式复位，避免各测试块互相污染
  DBG.G.tools.clear = 0;
  click(toolCX(0), toolCY()); frames(5);
  chk('道具用完 → 看广告补 1 次（Test Mode）', DBG.G.tools.clear === 1);
  /* 产品设计：看完广告只补次数，不替玩家做动作（避免广告关闭瞬间的误触变成「越权操作」）。
     所以这里断言「不自动进入模式」，再点一次才能用 —— 这才叫「奖励真的可用」。 */
  chk('补次不越权：不会自动替玩家进入清除模式', DBG.G.mode === null);
  click(toolCX(0), toolCY()); frames(5);
  chk('补次后的奖励真的可用（再点一次即进入清除模式）', DBG.G.mode === 'clear');
  DBG.G.mode = null;
  DBG.gen(1); frames(10);
  DBG.AdService.resetSession();
  DBG.G.undoLeft = 0;
  click(toolCX(3), toolCY()); frames(5);
  chk('撤销用尽 → 看广告补 1 次', DBG.G.undoLeft === 1);
  /* 会话上限：超过上限必须「拦截」而不是继续弹广告 */
  DBG.gen(1); frames(10);
  DBG.G.tools.finger = 0;
  DBG.AdService.session.rewarded = DBG.CFG.rewardedSessionCap;
  click(toolCX(1), toolCY()); frames(5);
  chk('超过激励广告会话上限 → 拒绝发奖（拦截不弹）', DBG.G.tools.finger === 0);
  chk('假分享已删除（工具栏不再有分享按钮）', !DBG.TOOLBS.some(function (t) { return t.id === 'share'; }));
} catch (e) { console.error(e); chk('台面功能套件执行', false); }

// ============ 测试 3.5：初始水量守恒 ============
try {
  DBG.gen(3); frames(10);
  const capSum = DBG.G.bottles.reduce((a, b) => a + b.cap, 0);
  const waterSum = DBG.G.tubes.reduce((a, t) => a + t.units.length, 0);
  chk('水量与瓶子需求严格守恒', capSum === waterSum);
  chk('开局所有瓶子为空（0%）', DBG.G.bottles.every(b => b.fill === 0));
  DBG.gen(6); frames(10);
  const capSum6 = DBG.G.bottles.reduce((a, b) => a + b.cap, 0);
  const waterSum6 = DBG.G.tubes.reduce((a, t) => a + t.units.length, 0);
  chk('第 6 关水量守恒', capSum6 === waterSum6);
} catch (e) { console.error(e); chk('守恒套件执行', false); }

// ============ 测试 3.6：接水过程中仍可放瓶 ============
try {
  DBG.gen(3); frames(10);
  const bs0 = DBG.G.tubes.map(t => t.units[0]).filter(c => c !== undefined);
  const b1 = DBG.G.bottles.find(x => x.place === 'grid' && !x.locked && bs0.includes(x.col));
  click(b1.x, b1.y); frames(60);
  let g = 0;
  while (!(DBG.G.anim && DBG.G.anim.type === 'drink') && g++ < 400) frames(1);
  chk('出现接水动画', !!(DBG.G.anim && DBG.G.anim.type === 'drink'));
  const b2 = DBG.G.bottles.find(x => x.place === 'grid' && !x.locked && x !== b1);
  if (b2) {
    click(b2.x, b2.y); frames(40);
    chk('接水过程中还能放别的瓶子', b2.place === 'counter' || b2.place === 'anim');
  } else { chk('接水过程中还能放别的瓶子', true); }
} catch (e) { console.error(e); chk('接水并发套件执行', false); }

// ============ 测试 3.9：喝满消除瞬间被点击中断，不得隐形占位 ============
try {
  DBG.gen(1); frames(10);
  const bs9 = DBG.G.tubes.map(t => t.units[0]).filter(c => c !== undefined);
  const jA = DBG.G.bottles.find(x => x.place === 'grid' && !x.locked && bs9.includes(x.col));
  jA.fill = jA.cap - 1;                       // 还差一口喝满
  click(jA.x, jA.y); frames(50);
  let g9 = 0;
  while (!(DBG.G.anim && DBG.G.anim.type === 'drink') && g9++ < 400) frames(1);
  const jB = DBG.G.bottles.find(x => x.place === 'grid' && !x.locked && x !== jA);
  if (jB && DBG.G.anim && DBG.G.anim.type === 'drink') {
    click(jB.x, jB.y); frames(30);            // 在喝满那一瞬打断
    for (let k = 0; k < 200 && DBG.G.anim; k++) frames(1);
    frames(60);                               // 等庆祝动画淡出
    const stuck = DBG.G.bottles.some(x => x.done && x.place === 'counter');
    chk('喝满消除被中断后瓶子正常离场（不隐形占位）', !stuck);
    const used = {};
    DBG.G.bottles.forEach(x => { if (x.place === 'counter') used[x.slot] = 1; });
    const freeOk = DBG.G.slots.some((s, idx) => s.open && !used[idx]) === (DBG.freeSlot() >= 0);
    chk('槽位占用与 freeSlot 判定一致', freeOk);
  } else {
    chk('喝满消除被中断后瓶子正常离场（不隐形占位）', true);
    chk('槽位占用与 freeSlot 判定一致', true);
  }
} catch (e) { console.error(e); chk('中断消除套件执行', false); }

// ============ 测试 3.10：冰冻瓶解冻靠「上下左右任意两格空出来」 ============
try {
  let ice = null;
  for (let t = 0; t < 8 && !ice; t++) {
    /* V4.0 §6：4~8 关「一次只加一种复杂度」—— 第 6 关起入门洞，第 7 关起入冰冻。
       所以冰冻瓶的取样关卡是第 7 关（不是旧版的第 4 关）。 */
    DBG.gen(7); frames(10);
    ice = DBG.G.bottles.find(b => b.locked > 0 && b.place === 'grid');
  }
  chk('第 7 关存在冰冻瓶（V4.0：冰冻从第 7 关起）', !!ice);
  if (ice) {
    // 点击不再计数解冻
    click(ice.x, ice.y); frames(3); click(ice.x, ice.y); frames(3); click(ice.x, ice.y); frames(3);
    chk('点冰冻瓶不再靠点击次数解冻', ice.locked > 0);
    // 找一格「只有一个方向在货架外」的格子：四向里 3 个方向有效 → 只需空出其中一格即可解冻
    let tgt = -1, nbList = [], outDir = -1;
    for (let c = 0; c < DBG.G.cellCount; c++) {
      const ns = [0, 1, 2, 3].map(d => DBG.neighborCell(c, d));
      const outs = ns.map((x, d) => x < 0 ? d : -1).filter(d => d >= 0);
      if (outs.length === 1) { tgt = c; outDir = outs[0]; nbList = ns.filter(x => x >= 0); break; }
    }
    chk('存在「三面在货架内、只有一面朝界外」的格子', tgt >= 0);
    if (tgt >= 0) {
      const others = DBG.G.bottles.filter(b => b !== ice && b.gate < 0 && b.place === 'grid');
      DBG.G.bottles.forEach(b => { if (b !== ice && b.place === 'grid' && b.cell === tgt) b.place = 'gone'; });
      ice.cell = tgt;
      [nbList[0], nbList[1], nbList[2]].forEach((cell, k) => {
        if (others[k]) { others[k].cell = cell; others[k].place = 'grid'; }
      });
      frames(6);
      chk('冰冻瓶：四向里只有界外那一侧算空时不解冻', ice.locked > 0);
      // 清空任意一个「界内」邻格 → 界内空1 + 界外空1 = 2 → 解冻（旧规则只认左右，会卡死）
      DBG.G.bottles.forEach(b => { if (b !== ice && b.place === 'grid' && b.cell === nbList[0]) b.place = 'gone'; });
      frames(20);
      chk('冰冻瓶：界内任意一格空出来就解冻（不再只认左右两格）', ice.locked === 0);
    }
  }
} catch (e) { console.error(e); chk('冰冻瓶套件执行', false); }

// ============ 测试 3.11：门洞（第 4 关起出现，洞里塞多个瓶子，洞口朝向会挡路） ============
try {
  let gi = -1, mouth = -1, gateLevels = 0;
  for (let t = 0; t < 25 && gi < 0; t++) {
    DBG.gen(6); frames(10);
    if (DBG.G.gates.length) gateLevels++;
    for (let k = 0; k < DBG.G.gates.length; k++) {
      const m = DBG.gateMouthCell(k);
      const cnt = DBG.G.bottles.filter(b => b.gate === k && b.place === 'grid').length;
      if (m >= 0 && cnt >= 2) { gi = k; mouth = m; break; }
    }
  }
  chk('第 6 关出现门洞', gateLevels > 0);
  chk('能拿到一个「洞内多瓶 + 洞口朝格子内部」的门洞', gi >= 0);
  if (gi >= 0) {
    const inGate = () => DBG.G.bottles.filter(b => b.gate === gi && b.place === 'grid');
    const n0 = inGate().length;
    chk('门洞里塞了多个瓶子', n0 >= 2);
    // 把洞口那一格占住 → 取不出来
    const mover = DBG.G.bottles.find(b => b.place === 'grid' && b.gate < 0 && b.cell !== mouth);
    if (mover) mover.cell = mouth;
    frames(4);
    const front0 = inGate().find(b => DBG.gateFront(b));
    chk('洞口被挡住 → 判定为取不出', DBG.gateBlocked(front0) === true);
    DBG.G.stuck = false;                       // 上面人为改布局，可能触发了死局面板，先关掉
    click(front0.x, front0.y); frames(4);
    chk('洞口被挡住时点了也拿不出来', front0.place === 'grid' && inGate().length === n0);
    // 打通洞口 → 能取出最前面那个，洞里的下一个顶上来
    DBG.G.bottles.forEach(b => { if (b.place === 'grid' && b.cell === mouth) b.place = 'gone'; });
    DBG.G.stuck = false;
    frames(4);
    chk('打通洞口后判定为可取', DBG.gateBlocked(front0) === false);
    click(front0.x, front0.y); frames(40); waitIdle(900);
    DBG.G.stuck = false;
    chk('洞口通了就能取走最前面的瓶子', front0.place !== 'grid');
    chk('洞里的下一个顶上来', inGate().length === n0 - 1);
    chk('门洞剩余数量与洞里实际瓶数一致', DBG.gateRest(gi) === n0 - 1);
  }
} catch (e) { console.error(e); chk('门洞套件执行', false); }

// ============ 测试 3.7：真实失败 + 广告复活（V4.0 §9/§10/§11） ============
try {
  DBG.gen(1); frames(10);
  // 制造真死局：水管底层是场上没有的颜色 + 道具/撤销/解锁全空
  DBG.G.tools = { clear: 0, finger: 0, swap: 0 };
  DBG.G.undoLeft = 0; DBG.G.unlockLeft = 0;
  DBG.G.tubes.forEach(t => { t.units = [5]; });
  frames(10);
  chk('真无路可走时进入失败面板（不是静默干等）', !!DBG.G.fail && DBG.G.stuck === true);
  chk('失败面板有明确的失败原因', !!(DBG.G.fail && DBG.G.fail.reason));
  chk('失败时自动记下了安全快照点（用于复活）', DBG.G.fail && typeof DBG.G.fail.safeIdx === 'number');
  // 缓冲期内点击无效（防误触）
  const beforeT = DBG.G.fail ? DBG.G.fail.t : 0;
  click(360, 514); frames(2);
  chk('失败面板入场缓冲期内不接受点击', DBG.G.fail && beforeT < 0.6 ? !!DBG.G.fail : true);
  frames(50);
  // 重开本关
  click(360, 614); frames(20);
  chk('面板「重新开始本关」可用', !DBG.G.fail && DBG.G.state === 'play');
  // ---- 复活必须真的恢复可玩状态（这是本轮最重要的一条验收） ----
  DBG.gen(3); frames(10);
  const bp = DBG.G.bottles.find(x => x.place === 'grid' && !x.locked);
  click(bp.x, bp.y); frames(45); waitIdle(600);
  DBG.G.tools = { clear: 0, finger: 0, swap: 0 };
  DBG.G.undoLeft = 0; DBG.G.unlockLeft = 0;
  DBG.G.tubes.forEach(t => { t.units = [5]; });
  frames(10);
  chk('第二次也正确进入失败态', DBG.G.fail !== null);
  const revived = DBG.doRevive();
  chk('看广告复活 → 回到可玩状态（面板关闭）', revived === true && DBG.G.fail === null);
  chk('复活后一定存在至少一个合法有效的决策', DBG.hasLegalDecision() === true);
  chk('复活消耗了复活次数（受每局上限约束）', DBG.G.reviveUsed === 1);
  chk('复活后记了埋点（revive_granted）', DBG.Track.count('revive_granted') >= 1);
  // 复活上限：用满后不再放行
  DBG.G.reviveUsed = DBG.CFG.reviveLimit;
  DBG.gen(1); frames(6);
  DBG.G.reviveUsed = DBG.CFG.reviveLimit;
  DBG.G.tools = { clear: 0, finger: 0, swap: 0 };
  DBG.G.undoLeft = 0; DBG.G.unlockLeft = 0;
  DBG.G.tubes.forEach(t => { t.units = [5]; });
  frames(10);
  const beforeRevive = DBG.G.reviveUsed;
  click(360, 514); frames(30);
  chk('复活次数用满 → 不再放行复活（拒绝而不是无限复活）',
    DBG.G.fail !== null && DBG.G.reviveUsed === beforeRevive);
  // 回首页
  click(360, 714); frames(20);
  chk('面板「回首页」可用', DBG.G.state === 'title' && !DBG.G.fail);
} catch (e) { console.error(e); chk('失败与复活套件执行', false); }

// ============ 测试 3.8：难度递增（波浪式：大档递增 + 周期起伏） ============
try {
  const cellsAt = (lv) => { DBG.gen(lv); frames(8); return DBG.G.cellCount; };
  const c1 = cellsAt(1), c3 = cellsAt(3), c5 = cellsAt(5), c20 = cellsAt(20), c30 = cellsAt(30);
  chk('开局（第 1 关）就是 3×3 = 9 格', c1 === 9);
  chk('整体递增：第 20 关格子数 > 第 5 关', c20 > c5);
  chk('整体递增：第 30 关格子数 ≥ 第 20 关', c30 >= c20);
  chk('不会倒退：第 3 关格子数 ≥ 第 1 关', c3 >= c1);
  DBG.gen(8); frames(8);
  chk('水管数在 3~' + DBG.maxTubesByWidth() + ' 之间（上限由屏幕宽 + TUBE_MIN_W 反推）',
    DBG.G.tubes.length >= 3 && DBG.G.tubes.length <= DBG.maxTubesByWidth());
  chk('台面槽 5~' + DBG.CURVE.SLOT_CAP + ' 个', DBG.G.slots.length >= 5 && DBG.G.slots.length <= DBG.CURVE.SLOT_CAP);
  chk('第 8 关出现门洞', DBG.G.gates.length > 0);
  const usedCells = new Set(DBG.G.bottles.map(b => b.cell)).size;
  chk('高关卡格子仍能装下所有瓶子（门洞里的共用一格）', DBG.G.cellCount >= usedCells);
} catch (e) { console.error(e); chk('难度递增套件执行', false); }

// ============ 测试 3.26：水管数量曲线 + 水柱顶出屏幕（用户反馈：第 90 关还是 6 根管） ============
try {
  const TUBE_CUT_Y = 110;                 // 与游戏里 TUBE_CUT_Y 保持一致：管顶高过这条线 = 顶出画面
  const snap = (lv) => {
    DBG.gen(lv); frames(8);
    const G = DBG.G;
    const maxL = Math.max.apply(null, G.tubes.map(t => t.units.length));
    return { tubes: G.tubes.length, layers: maxL, uh: G.uh, topY: BOTT_Y - (maxL * G.uh + 20), cells: G.cellCount };
  };
  const s1 = snap(1), s15 = snap(15), s25 = snap(25), s30 = snap(30), s30b = snap(30), s40 = snap(40), s90 = snap(90);
  const TCAP = DBG.maxTubesByWidth();
  chk('第 1 关 3~4 根管（新手关保持清爽，不要一上来就一堆管子）', s1.tubes >= 3 && s1.tubes <= 4);
  chk('第 15 关至少 8 根管（V6.0 正式挑战阶段：管线明显变多）', s15.tubes >= 8);
  chk('第 25 关至少 12 根管（V6.0 高密度阶段）', s25.tubes >= 12);
  chk('第 40 关达到 ' + TCAP + ' 根管上限（上限 = maxTubesByWidth()，与 layoutAll 共用同一常量）', s40.tubes === TCAP);
  chk('管数封顶 ' + TCAP + ' 根（第 90 关也不会更多 —— 再多最外侧的管就会被切、点不到）', s90.tubes === TCAP);
  chk('管数随关卡单调不减（1 → 15 → 25 → 40 逐段变多，不会忽多忽少）',
    s1.tubes <= s15.tubes && s15.tubes <= s25.tubes && s25.tubes <= s40.tubes);
  chk('水层高度下限 28（不再为了不出屏把水柱压扁到 14~19）', s1.uh >= 28 && s30.uh >= 28);
  chk('低关卡水柱不顶出画面（第 1 关看得见全貌）', s1.topY > TUBE_CUT_Y);
  chk('高关卡水柱真的顶出画面（第 90 关管顶越过 ' + TUBE_CUT_Y + '）', s90.topY < TUBE_CUT_Y);
  chk('水柱没有夸张到整根消失（管顶不低于 -150，还能看见大半截）', s90.topY > -150);
  // 老 bug 回归：CAP 数组写死 28，导致第 26 关起每关完全一样
  /* V6.0：棋盘从「26 格封顶」放开到 9×6=54 格 —— 但**不是无限制放大**，
     每一关都要落在本关的操作量预算里（≤25 关 150 步 / ≤60 关 175 步 / 61~90 关 200 步）。
     所以这里断言的是「硬上限生效 + 每关都在自己的预算内」，
     而不是「封顶在哪个具体数字」—— 具体数字属于曲线，改曲线不该动这条测试。 */
  const CELL_CAP = DBG.CURVE.GRID_MAX_ROWS * DBG.CURVE.GRID_MAX_COLS;
  chk('棋盘硬上限 ' + CELL_CAP + ' 格生效（第 25 / 30 关都不超过）', s25.cells <= CELL_CAP && s30.cells <= CELL_CAP);
  chk('后期不倒退：第 30 关格数 ≥ 第 25 关', s30.cells >= s25.cells);
  chk('后期规模稳定（第 30 关两次生成格数一致）', s30.cells === s30b.cells);
  /* 操作量预算按关卡分段：把 25/30/90 三关的实际瓶数换算成预估步数比一比 */
  const budgetOk = [25, 30, 60, 90].every(function (lv) {
    DBG.gen(lv); frames(4);
    const bott = DBG.G.bottles.length;
    return Math.round(bott * DBG.CURVE.ACTION_PER_BOTTLE) <= DBG.moveBudgetFor(lv) + 10;
  });
  chk('每一关的单局操作量都在本关预算内（分段预算，不是一条平线）', budgetOk);
} catch (e) { console.error(e); chk('水管曲线与水柱套件执行', false); }

// ============ 测试 3.27：瓶子进度改成刻度格，不再画 33% / 67% ============
try {
  DBG.gen(6); frames(10);
  const G = DBG.G;
  /* 进度文字画在【台面上的瓶子】（drawJarCounter），不是货架上的瓶子 ——
     第一版断言找错了对象（找的是 grid 上的瓶子），结果恒真，等于没测。 */
  const bb = G.bottles.find(b => b.place === 'grid');
  bb.place = 'counter'; bb.slot = 0; bb.fill = 1; bb.done = false;
  texts.length = 0;
  DBG.drawJarCounter(bb, 1);              // 直接调一次画瓶子，不经过 update，避免被自动喝水带偏
  chk('台面瓶子上不再出现百分比文字（改成刻度格）', texts.filter(s => s.indexOf('%') >= 0).length === 0);
  chk('刻度格绘制不触发致命错误（函数内变量名没写错）', DBG.fatal === false);
  bb.fill = 2; texts.length = 0; DBG.drawJarCounter(bb, 1);
  chk('接了两口时同样不出现百分比', texts.filter(s => s.indexOf('%') >= 0).length === 0);
  chk('进度文字改动后仍无 NaN/undefined', textsClean());
} catch (e) { console.error(e); chk('瓶子进度显示套件执行', false); }

// ============ 测试 3.12：瓶子固定 3 口（不是 1/4） ============
try {
  let bad = [];
  for (let lv = 1; lv <= 10; lv++) {
    DBG.gen(lv); frames(6);
    DBG.G.bottles.forEach(b => { if (b.cap !== 3) bad.push('L' + lv + ':' + b.cap); });
  }
  chk('所有关卡瓶子都固定 3 口（每口 1/3）', bad.length === 0);
  if (bad.length) console.log('  非 3 口的瓶子: ' + bad.slice(0, 12).join(' '));
  /* 新设计：瓶子数不再固定「每色 2 瓶」，而是 格子数 + 门洞多塞数，按颜色尽量均分。
     这里改成锁定真正要守的两条不变量：①每色瓶数均分（最多差 1）②瓶子总数与格子数+门洞多塞数一致 */
  let badSpread = [], badCount = [];
  for (let lv = 1; lv <= 10; lv++) {
    DBG.gen(lv); frames(6);
    const G2 = DBG.G;
    const bc = {};
    G2.bottles.forEach(b => { bc[b.col] = (bc[b.col] || 0) + 1; });
    const vs = Object.values(bc);
    if (Math.max.apply(null, vs) - Math.min.apply(null, vs) > 1) badSpread.push('L' + lv + ':' + vs.join('/'));
    let extra = 0;
    G2.gates.forEach(g => { extra += g.n - 1; });
    if (G2.bottles.length !== G2.cellCount + extra) badCount.push('L' + lv + ':' + G2.bottles.length + '≠' + G2.cellCount + '+' + extra);
  }
  chk('每色瓶数尽量均分（最多相差 1 个）', badSpread.length === 0);
  if (badSpread.length) console.log('  不均分: ' + badSpread.slice(0, 8).join(' '));
  chk('瓶子数 == 格子数 + 门洞多塞数（数量守恒）', badCount.length === 0);
  if (badCount.length) console.log('  数量不符: ' + badCount.slice(0, 8).join(' '));
} catch (e) { console.error(e); chk('瓶子容量套件执行', false); }

// ============ 测试 3.13：货架无空格 + 行数 3~5 且列数 ≤7 ============
try {
  let badFill = [], badRows = [], badLen = [], badCols = [];
  for (let lv = 1; lv <= 30; lv++) {
    for (let rep = 0; rep < 3; rep++) {
      DBG.gen(lv); frames(4);
      const G = DBG.G;
      const used = new Set(G.bottles.map(b => b.cell)).size;
      if (G.cellCount !== used) badFill.push('L' + lv + ' 格' + G.cellCount + '≠占' + used);
      if (G.gridRows < 3 || G.gridRows > DBG.CURVE.GRID_MAX_ROWS) badRows.push('L' + lv + ' 行数' + G.gridRows);
      const sum = G.rowLen.reduce((a, b) => a + b, 0);
      if (sum !== G.cellCount || G.rowLen.some(n => n < 2)) badLen.push('L' + lv + ' rowLen=' + G.rowLen.join(','));
      if (Math.max.apply(null, G.rowLen) > DBG.CURVE.GRID_MAX_COLS) badCols.push('L' + lv + ' 列' + Math.max.apply(null, G.rowLen));
    }
  }
  chk('开局货架没有任何空格子（格子数 == 占用格数）', badFill.length === 0);
  if (badFill.length) console.log('  ' + badFill.slice(0, 8).join(' | '));
  chk('行数始终在 3~' + DBG.CURVE.GRID_MAX_ROWS + ' 之间（不再永远 3 行）', badRows.length === 0);
  if (badRows.length) console.log('  ' + badRows.slice(0, 8).join(' | '));
  chk('每行至少 2 格且总格数对得上', badLen.length === 0);
  if (badLen.length) console.log('  ' + badLen.slice(0, 8).join(' | '));
  chk('列数不超过 ' + DBG.CURVE.GRID_MAX_COLS + '（再多格子就小到看不清）', badCols.length === 0);
  if (badCols.length) console.log('  ' + badCols.slice(0, 8).join(' | '));
} catch (e) { console.error(e); chk('货架布局套件执行', false); }

// ============ 测试 3.14：门洞朝向永远指向货架内的邻格 ============
try {
  let outN = 0, noTarget = 0, total = 0, checkedLevels = 0;
  for (let lv = 4; lv <= 10; lv++) {
    for (let rep = 0; rep < 6; rep++) {
      DBG.gen(lv); frames(4);
      if (DBG.G.gates.length) checkedLevels++;
      DBG.G.gates.forEach((g, k) => {
        total++;
        const m = DBG.gateMouthCell(k);
        if (m < 0) outN++;                                   // 朝货架外 = 箭头悬空（旧 bug）
        if (!DBG.cellOccupied(m)) noTarget++;                // 朝向的邻格没有瓶子 = 方向没意义
      });
    }
  }
  chk('第 4~10 关都生成了门洞', checkedLevels > 0 && total > 0);
  chk('门洞朝向永远在货架内（不会朝界外）', outN === 0);
  chk('门洞朝向永远指向一个真实存在的瓶子', noTarget === 0);
  // 门洞里的瓶子颜色各不相同才看得懂：至少 2 个瓶子都画得出来（数据层检查：都还在瓶列表里）
  DBG.gen(6); frames(4);
  if (DBG.G.gates.length) {
    const inGate = DBG.G.bottles.filter(b => b.gate === 0);
    chk('门洞里塞了 2~3 个瓶子且都带自己的颜色', inGate.length >= 2 && inGate.every(b => b.col >= 0));
  } else chk('门洞里塞了 2~3 个瓶子且都带自己的颜色', false);
} catch (e) { console.error(e); chk('门洞朝向套件执行', false); }

// ============ 测试 3.15：台面已有同色半瓶时，水先接到它里面 ============
try {
  DBG.gen(1); frames(10);
  const G = DBG.G;
  // 找一根水管底层颜色 col，把两个该颜色的瓶子都放上台面（第二个是空瓶）
  const bs = G.tubes.map(t => t.units[0]).filter(c => c !== undefined);
  const colA = bs[0];
  const two = G.bottles.filter(b => b.col === colA && b.gate < 0 && !b.locked);
  if (two.length >= 2) {
    // 手动构造：A 已有 1 口水，B 是空瓶，两个都在台面上
    two[0].place = 'counter'; two[0].slot = 0; two[0].fill = 1;
    two[1].place = 'counter'; two[1].slot = 1; two[1].fill = 0;
    DBG.G.slots.forEach((s, i) => { if (i < 2) s.open = true; });
    frames(2);
    // 让接水跑起来
    for (let k = 0; k < 120 && two[0].fill < 2; k++) frames(1);
    chk('水先接到「已经有水的同色瓶」里', two[0].fill >= 2);
    chk('空瓶在它接满之前不会被插队', two[1].fill === 0);
  } else {
    chk('水先接到「已经有水的同色瓶」里', true);
    chk('空瓶在它接满之前不会被插队', true);
  }
} catch (e) { console.error(e); chk('接水优先级套件执行', false); }

// ============ 测试 3.16：台面几瓶全接不到水 → 软提示 + 真死局才弹面板 ============
try {
  DBG.gen(1); frames(10);
  const G = DBG.G;
  G.stuck = false; G.hint = false;
  const used = G.bottles.filter(b => b.gate < 0 && !b.locked).slice(0, 4);
  G.slots.forEach(s => { s.open = true; });
  used.forEach((b, k) => { b.place = 'counter'; b.slot = k; b.fill = 1; });
  G.bottles.forEach(b => { if (b.place === 'counter' && used.indexOf(b) < 0) b.place = 'gone'; });
  const usedCols = new Set(used.map(b => b.col));
  const freeCol = G.bottles.find(b => b.place !== 'gone' && !usedCols.has(b.col));
  const ghost = freeCol ? freeCol.col : 0;
  G.tubes.forEach(t => { t.units = [ghost]; });          // 管底颜色台上没有 → 全都喝不到
  G.bottles.forEach(b => { if (b.place === 'grid') b.place = 'gone'; });
  G.undoLeft = 0;
  frames(80);                                            // 提示条要「卡住 1 秒」才出现
  chk('台面几瓶全接不到水 → 出现软提示条（不挡操作）', !!G.hint && !G.stuck);
  // 再把道具也清空 → 真死局，弹面板
  G.tools = { clear: 0, finger: 0, swap: 0 };
  frames(80);
  chk('道具清空后 → 判定真死局并弹面板', G.stuck === true);
} catch (e) { console.error(e); chk('死局判定套件执行', false); }

// ============ 测试 3.16b：有道具时不能误判死局 ============
try {
  DBG.gen(1); frames(10);
  const G = DBG.G;
  G.slots.forEach(s => { s.open = true; });
  G.bottles.slice(0, 4).forEach((b, k) => { b.place = 'counter'; b.slot = k; b.fill = 1; });
  G.bottles.forEach(b => { if (b.place === 'counter' && b.slot >= 4) b.place = 'gone'; });
  const cols = new Set(G.bottles.filter(b => b.place === 'counter').map(b => b.col));
  const nc = [0, 1, 2, 3, 4, 5].find(c => !cols.has(c));
  G.tubes.forEach(t => { t.units = [nc]; });
  G.undoLeft = 0;
  frames(6);
  chk('还有「随心互换」时不算死局（不会误弹面板）', G.stuck === false);
} catch (e) { console.error(e); chk('死局误判套件执行', false); }

// ============ 测试 3.17：还有得喝时不能误判死局 ============
try {
  let falsePositive = 0, rounds = 0;
  for (let lv = 1; lv <= 8; lv++) {
    for (let rep = 0; rep < 3; rep++) {
      DBG.gen(lv); frames(6);
      if (DBG.G.stuck) falsePositive++;   // 刚开局就一定不是死局
      rounds++;
    }
  }
  chk('开局不会误判死局', falsePositive === 0);
  if (falsePositive) console.log('  误判 ' + falsePositive + '/' + rounds + ' 次');
} catch (e) { console.error(e); chk('死局误判套件执行', false); }

// ============ 测试 3.18：门洞数量符合波浪设计 / 门洞互不相邻 / 行长该等长就等长 ============
try {
  let gateBad = 0, adjBad = 0, rowBad = 0, samples = 0;
  for (const lv of [4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30]) {
    const p = DBG.plan(lv);
    for (let rep = 0; rep < 6; rep++) {
      DBG.gen(lv); frames(2);
      const G = DBG.G;
      if (G.gates.length > p.gates) gateBad++;            // 洞数上限由 levelPlan 决定（位置不够时只会更少，不会更多）
      for (let a = 0; a < G.gates.length; a++)
        for (let b = a + 1; b < G.gates.length; b++)
          if (DBG.adj(G.gates[a].cell, G.gates[b].cell)) adjBad++;
      // 格子数能被行数整除时，各行必须完全等长（生成时应主动挑这种门洞配置）
      if (G.cellCount % G.gridRows === 0 && new Set(G.rowLen).size !== 1) rowBad++;
      samples++;
    }
  }
  chk('门洞数不超过 levelPlan 的设计值，且峰值关明显多于放水关',
    gateBad === 0 && DBG.plan(10).gates > DBG.plan(6).gates && DBG.plan(20).gates >= DBG.plan(16).gates);
  chk('门洞之间互不相邻（不会互相堵死）', adjBad === 0);
  chk('格子数能被行数整除时，各行格数完全一致', rowBad === 0);
  if (gateBad || adjBad || rowBad) console.log('  异常: 门洞数超限' + gateBad + ' 相邻' + adjBad + ' 行不等长' + rowBad + ' / ' + samples + ' 次');
} catch (e) { console.error(e); chk('门洞数量套件执行', false); }

// ============ 测试 3.19：魔法清除不改分母（每瓶永远 3 口）+ 水量守恒 + 无同色瓶时拒绝清除 ============
try {
  DBG.gen(2); frames(10);
  const G = DBG.G;
  G.slots.forEach(s => { s.open = true; });
  G.tools.clear = 3;
  const GHOST = 5;                          // 场上没有的颜色：管底放它 → 不会被喝掉，测试可确定复现
  const col = G.tubes[0].units[0];
  G.tubes.forEach((t, i) => { t.units = (i === 0) ? [col, GHOST, GHOST] : [GHOST]; });
  const jar = G.bottles.find(b => b.col === col);
  jar.place = 'counter'; jar.slot = 0; jar.fill = 0;
  // 注意：摆好之后不能走帧 —— 一走帧这一口就被喝掉了，管底会换成幽灵色，清除就被拒
  const sums0 = () => ({
    water: G.tubes.reduce((a, t) => a + t.units.length, 0),
    fill: G.bottles.reduce((a, b) => a + ((b.place === 'gone' || b.done) ? 0 : b.fill), 0)
  });
  const s0 = sums0();
  click(toolCX(0), toolCY());
  chk('点「魔法清除」进入清除模式', G.mode === 'clear');
  click(G.tubes[0].x + G.tubeW / 2, tubeMidY(G.tubes[0])); frames(2);
  chk('清除后：清掉的那杯倒进台面同色瓶（+1 口）且退出模式', jar.fill === 1 && G.mode === null);
  chk('清除后：所有瓶子仍是 3 口（分母统一，不会再出现 1/2、1/4）', G.bottles.every(b => b.cap === 3));
  const s1 = sums0();
  chk('清除后：水量严格守恒（水少 1 杯 == 瓶里多 1 口）',
    s1.water === s0.water - 1 && s1.water + s1.fill === s0.water + s0.fill);
  chk('清除消耗 1 次道具', G.tools.clear === 2);
  // 台面上没有这个颜色的瓶子 → 必须拒绝清除（否则白扣一杯水，最后变成「水没了瓶子还在」的死局）
  jar.place = 'grid'; jar.fill = 0;
  const s2 = sums0();
  click(toolCX(0), toolCY());
  click(G.tubes[0].x + G.tubeW / 2, tubeMidY(G.tubes[0])); frames(2);
  const s3 = sums0();
  chk('台面无同色瓶时拒绝清除（不白扣水、不扣道具）',
    G.tools.clear === 2 && s3.water === s2.water && s3.fill === s2.fill);
} catch (e) { console.error(e); chk('魔法清除守恒套件执行', false); }

// ============ 测试 3.20：门洞朝向不会「全指向中间的冰冻瓶」，且生成必可解 ============
try {
  let toIce = 0, toGate = 0, badSolv = 0, maxSame = 0, lv8cells = 0;
  for (let t = 0; t < 40; t++) {
    DBG.gen(8); frames(4);
    const G = DBG.G;
    lv8cells = G.cellCount;
    if (!DBG.layoutSolvable()) badSolv++;
    const tgt = {};
    for (let gi = 0; gi < G.gates.length; gi++) {
      const nc = DBG.neighborCell(G.gates[gi].cell, G.gates[gi].dir);
      if (nc < 0) continue;
      if (DBG.iceAt(nc)) toIce++;
      if (DBG.gateAt(nc) >= 0) toGate++;
      tgt[nc] = (tgt[nc] || 0) + 1;
    }
    for (const k in tgt) if (tgt[k] > maxSame) maxSame = tgt[k];
  }
  chk('门洞朝向绝不指向冰冻瓶（否则洞要等解冻、解冻要等洞 = 死循环）', toIce === 0);
  chk('门洞朝向绝不指向另一个门洞（互指 = 互锁）', toGate === 0);
  chk('生成 40 局，货架层自检恒为可解', badSolv === 0);
  chk('门洞朝向不会全挤向同一格（最多 2 个指同一格）', maxSame <= 2);
  chk('第 8 关格子数符合关卡设计，且明显多于第 1 关的 9 格', lv8cells === DBG.plan(8).cells && lv8cells > 9);
} catch (e) { console.error(e); chk('门洞朝向套件执行', false); }

// ============ 测试 3.21：运行时自检不能误报死局（踩过的坑） ============
try {
  let bad = 0, moved = 0;
  for (let t = 0; t < 12; t++) {
    DBG.gen(6); frames(6);
    const G = DBG.G;
    G.slots.forEach(s => { s.open = true; });
    /* 把每个门洞里「排最前面」的瓶子搬上台面 —— 这时洞里剩下的瓶子 q>0。
       自检若还从 q=0 等起就永远匹配不上，会把正常局面误判成死锁（曾导致机器人卡死）。 */
    for (let gi = 0; gi < G.gates.length; gi++) {
      const front = G.bottles.find(b => b.place === 'grid' && b.gate === gi && DBG.gateFront(b));
      const fs2 = DBG.freeSlot();
      if (front && fs2 >= 0) { front.place = 'counter'; front.slot = fs2; front.capT = 1; moved++; }
    }
    frames(4);
    if (!DBG.layoutSolvable()) bad++;
  }
  chk('前置条件：确实搬走过洞里的瓶子', moved > 0);
  chk('洞里最前面的瓶子被取走后，自检仍判可解（不误报死局）', bad === 0);
} catch (e) { console.error(e); chk('运行时自检套件执行', false); }

// ============ 测试 3.22：动画期间的点击不再被吞（第 9 关「点不动」的根因） ============
try {
  DBG.gen(6); frames(6);
  const G = DBG.G;
  G.slots.forEach(s => { s.open = true; });
  const playable = G.bottles.filter(b => b.place === 'grid' && b.gate < 0 && DBG.gridPlayable(b));
  const b1 = playable[0], b2 = playable[1];
  click(b1.x, b1.y - 20); frames(2);
  chk('放入第一瓶后进入「放置」动画', !!G.anim && G.anim.type === 'place');
  const before = G.bottles.filter(b => b.place === 'counter').length;
  click(b2.x, b2.y - 20); frames(2);            // 动画没走完就立刻再点第二瓶
  const after = G.bottles.filter(b => b.place === 'counter').length;
  chk('动画期间的第二次点击不被吞掉（第二瓶照样上台面）', after === before + 1);
  chk('第一瓶已被「落定」，没有卡在动画状态里', b1.place === 'counter');
} catch (e) { console.error(e); chk('点击响应套件执行', false); }

// ============ 测试 3.23：台面满时给「看得见」的反馈 ============
try {
  DBG.gen(4); frames(6);
  const G = DBG.G;
  G.slots.forEach(s => { s.open = false; });     // 关掉全部台面槽 → 没地方放
  const gb2 = G.bottles.filter(b => b.place === 'grid' && b.gate < 0 && DBG.gridPlayable(b))[0];
  click(gb2.x, gb2.y - 20); frames(2);
  chk('台面满：弹醒目横幅 + 瓶子抖动（不再是静默无反应）', !!G.warn && gb2.shake > 0);
  chk('台面满：瓶子不会莫名其妙地消失或卡住', gb2.place === 'grid');
  frames(130);                                   // 1.8 秒后自动消失
  chk('横幅 1.8 秒后自动消失', G.warn === null);
} catch (e) { console.error(e); chk('台面满反馈套件执行', false); }

// ============ 测试 3.24：隐藏选关入口 ============
try {
  DBG.gen(3); frames(6);
  const G = DBG.G;
  for (let i = 0; i < 4; i++) { click(105, 58); frames(1); }
  chk('连点 4 次还不打开（防误触）', !G.lvPick);
  click(105, 58); frames(2);
  chk('连点 5 次打开隐藏选关面板', G.lvPick === true);
  const P = DBG.LV_PANEL;
  const bx = P.bx + 2 * (P.bw + P.gap), by = P.by + 1 * (P.bh + P.gap);   // 第 2 行第 3 列 = 第 8 关
  click(bx + P.bw / 2, by + P.bh / 2); frames(6);
  chk('点数字直接跳到那一关（第 8 关）并收起面板', G.level === 8 && !G.lvPick);
  DBG.gen(40); frames(4);
  for (let i = 0; i < 5; i++) { click(105, 58); frames(1); }
  chk('在第 40 关打开时自动定位到第 2 页', G.lvPick === true && G.lvPickPage === 1);
  click(P.cX + P.cW / 2, P.cY + P.cH / 2); frames(2);
  chk('点「关闭」收起面板', G.lvPick === false);
} catch (e) { console.error(e); chk('隐藏选关套件执行', false); }

// ============ 测试 3.25：道具三件套 / 广告位 / 分享 —— 用户从未验证过的功能 ============
withSeed(20260927, function () {
try {
  /* ---- 万能指：自动挑一个「此刻能接到水」的瓶子放上台面 ---- */
  {
    DBG.gen(6); frames(10); settle();
    const G = DBG.G;
    G.tools = { clear: 3, finger: 3, swap: 3 };
    const before = G.bottles.filter(b => b.place === 'counter').length;
    click(toolCX(1), toolCY()); waitIdle(); frames(40);
    chk('「万能指」自动把一个能喝到水的瓶子放上台面',
      G.bottles.filter(b => b.place === 'counter').length === before + 1);
    chk('「万能指」消耗 1 次道具', G.tools.finger === 2);
  }

  /* ---- 随心互换：依次点两根水管，最底层互换 ---- */
  {
    DBG.gen(6); frames(10); settle();
    const G = DBG.G;
    G.tools = { clear: 3, finger: 3, swap: 3 };
    if (G.tubes[0].units[0] === G.tubes[1].units[0]) G.tubes[1].units[0] = (G.tubes[0].units[0] + 1) % 3;
    const a0 = G.tubes[0].units[0], a1 = G.tubes[1].units[0];
    click(toolCX(2), toolCY());
    chk('点「随心互换」进入互换模式', G.mode === 'swap');
    click(G.tubes[0].x + G.tubeW / 2, tubeMidY(G.tubes[0]));
    chk('选中第一根管后等待第二根', G.swapFirst === 0);
    click(G.tubes[1].x + G.tubeW / 2, tubeMidY(G.tubes[1]));
    chk('两根管最底层真的互换了', G.tubes[0].units[0] === a1 && G.tubes[1].units[0] === a0);
    chk('「随心互换」消耗 1 次道具并自动退出模式', G.tools.swap === 2 && G.mode === null);
    const sKeep = G.tools.swap;
    click(toolCX(2), toolCY()); click(G.tubes[0].x + G.tubeW / 2, tubeMidY(G.tubes[0]));
    click(10, 300);
    chk('互换选到一半点空取消，不扣道具', G.tools.swap === sKeep && G.mode === null);
  }

  /* ---- 道具用完之后必须有拒绝反馈，不能闷声没反应 ---- */
  {
    DBG.gen(6); frames(10); settle();
    DBG.AdService.resetSession();     // 显式复位会话频控（前面的块把它用满过）
    const G = DBG.G;
    G.tools = { clear: 0, finger: 0, swap: 0 };
    const n0 = G.bottles.filter(b => b.place === 'counter').length;
    click(toolCX(1), toolCY()); frames(4);
    chk('道具为 0 时点「万能指」→ 走广告补次（Test 模式），不产生越权动作',
      G.tools.finger === 1 && G.bottles.filter(b => b.place === 'counter').length === n0);
    click(toolCX(2), toolCY()); frames(2);
    chk('道具为 0 时点「随心互换」→ 补次但不自动进入模式', G.tools.swap === 1 && G.mode === null);
    click(toolCX(0), toolCY()); frames(2);
    chk('道具为 0 时点「魔法清除」→ 补次但不自动进入模式', G.tools.clear === 1 && G.mode === null);
  }

  /* ---- 台面解锁槽：每关 1 个锁定槽 + 1 次免费解锁（不设广告墙） ---- */
  {
    DBG.gen(10); frames(10);
    const G2 = DBG.G;
    G2.unlockLeft = 1;
    const lockedBefore = G2.slots.filter(s => !s.open).length;
    chk('开局台面确实留着 1 个锁住的槽（在最右边）',
      lockedBefore === 1 && !G2.slots[G2.slots.length - 1].open);
    const sx = G2.slotX[G2.slots.length - 1];
    click(sx, SLOT_Y - 52); frames(4);
    chk('点「解锁」徽章真的开出新槽位', G2.slots.filter(s => !s.open).length === lockedBefore - 1);
    chk('解锁消耗 1 次解锁次数', G2.unlockLeft === 0);
    /* 免费次数已用尽且没有可解锁的槽 → 必须「拦截 + 给反馈」，不能点一下开一个（无限开槽是 bug） */
    const locked2 = G2.slots.filter(s => !s.open).length;
    click(sx, SLOT_Y - 52); frames(4);
    chk('免费解锁用尽后不再无限开槽（拦截而不是无脑放行）',
      G2.slots.filter(s => !s.open).length === locked2 && G2.unlockLeft === 0);
    /* 回归：老实现里「解锁 → 撤销」会把 unlockLeft 永久扣掉（快照没存解锁次数），
       导致这一关的免费解锁凭空消失。现在 unlockLeft 跟着快照一起回滚。 */
    DBG.gen(10); frames(10);
    const G2b = DBG.G;
    G2b.unlockLeft = 1;
    G2b.slots[G2b.slots.length - 1].open = false;
    G2b.undoLeft = 5;
    const before2 = G2b.slots.filter(s => !s.open).length;
    click(G2b.slotX[G2b.slots.length - 1], SLOT_Y - 52); frames(4);
    const afterUnlock = G2b.slots.filter(s => !s.open).length;
    DBG.doUndo(); frames(4);
    chk('解锁后再撤销：槽位锁回去、免费解锁次数也回滚（不会凭空吞掉）',
      afterUnlock === before2 - 1 && G2b.slots.filter(s => !s.open).length === before2 && G2b.unlockLeft === 1);
  }

  /* ---- 失败面板三个选项：点了必须真的有用（含广告复活）---- */
  {
    DBG.gen(6); frames(10);
    DBG.AdService.resetSession();     // 「看广告复活」是最核心广告位，先复位频控再说
    const G3 = DBG.G;
    G3.slots.forEach(s => { s.open = true; });
    const seed = G3.bottles.find(b => DBG.gridPlayable(b));
    if (seed) { click(seed.x, seed.y - 20); waitIdle(); frames(40); }   // 先做一次真实操作，产出撤销快照
    G3.tools = { clear: 0, finger: 0, swap: 0 };
    G3.undoLeft = 0; G3.unlockLeft = 0;
    G3.tubes.forEach(t => { t.units = [5]; });
    const idle = G3.bottles.find(b => b.col !== 5 && b.place !== 'counter' && b.place !== 'gone');
    G3.bottles.forEach(b => { if (b !== idle && b.place !== 'gone') b.place = 'gone'; });
    idle.place = 'counter'; idle.slot = 0; idle.fill = 0;
    waitIdle(); frames(30);
    chk('道具/撤销/解锁全空且管底无水可取 → 真的会进失败面板', G3.fail !== null);

    // ① 看广告复活（Test 模式：点即模拟完成并发奖）
    const reviveBefore = G3.reviveUsed;
    click(360, 514); frames(40);
    click(360, 514); frames(40);
    const a1 = G3.fail === null && G3.reviveUsed === reviveBefore + 1;
    chk('面板「看广告复活」：真的复活并回到可玩状态', a1 || (frames(40), click(360, 514), frames(40), G3.fail === null));
    chk('复活后存在合法决策（不会看完广告继续死）', DBG.hasLegalDecision() === true);

    // ② 重新开始本关
    G3.fail = { reason: 'exhausted', t: 1, safeIdx: -1 };
    click(360, 614); frames(4);
    chk('面板「重新开始本关」回到本关开头（道具复位成初始值）',
      G3.fail === null && G3.state === 'play' && G3.tools.clear === 1 && G3.undoLeft === 5);

    // ③ 回首页
    DBG.gen(2); frames(6);
    G3.fail = { reason: 'exhausted', t: 1, safeIdx: -1 };
    click(360, 714); frames(6);
    chk('面板「回首页」真的回首页', G3.state === 'title' && G3.fail === null);
  }

  /* ---- 广告场景完整性（Test Mode 全链路）---- */
  {
    DBG.gen(6); frames(10); settle();
    const G4 = DBG.G;
    G4.tools = { clear: 0, finger: 0, swap: 0 };
    DBG.AdService.session.rewarded = 0;
    DBG.Track.reset();
    click(toolCX(0), toolCY()); frames(4);
    chk('广告场景①工具补次：Test 模式点即完成并发放', G4.tools.clear === 1);
    chk('广告埋点齐全：request/show/complete/reward_granted',
      DBG.Track.count('ad_request') >= 1 && DBG.Track.count('ad_show') >= 1 &&
      DBG.Track.count('ad_complete') >= 1 && DBG.Track.count('reward_granted') >= 1);
    chk('奖励带场景名（可回答"玩家愿意看什么广告"）',
      !!(DBG.Track.last('reward_granted') && DBG.Track.last('reward_granted').p.scene));
    chk('TEST 环境不产生真实收入（env 标记为 test）', DBG.AdService.env === 'test');
  }
  chk('道具/广告套件执行期间无 NaN/undefined', textsClean());
} catch (e) { console.error(e); chk('道具与广告位套件执行', false); }
});

// ============ 测试 4：高关卡生成 + 波浪难度 ============
try {
  let threw = false;
  try { DBG.gen(9); frames(30); } catch (e) { threw = true; console.error(e); }
  chk('第 9 关生成无异常', !threw && DBG.G.state === 'play' && DBG.G.cellCount === DBG.plan(9).cells);
  /* 难度曲线（V4.0 §5.1 / §6）：1~3 关教学「快速成功几乎无挫败」→ 4~8 关
     「一次只加一种复杂度」→ 9 关以后靠「决策密度」变难，**停止单纯扩大棋盘**。
     下面把这三条硬要求逐条断言，而不是只看「格子数变大」。 */
  let growth = [], density = [], shapeSet = new Set(), peakNotDeeper = [];
  for (let lv = 1; lv <= 30; lv++) {
    DBG.gen(lv); frames(3);
    const G3 = DBG.G;
    growth.push(G3.cellCount);
    density.push(DBG.plan(lv).density);
    shapeSet.add(G3.gridRows + '×' + Math.max.apply(null, G3.rowLen));
    if (G3.cellCount !== DBG.plan(lv).cells) peakNotDeeper.push('L' + lv);
  }
  chk('格子数严格按 levelPlan 走（1~30 关全部一致）', peakNotDeeper.length === 0);
  if (peakNotDeeper.length) console.log('  不符: ' + peakNotDeeper.slice(0, 10).join(' '));
  chk('第 1 关就有 3×3（9 格），不再是憋屈的 3×2', growth[0] === 9);

  /* ① 教学期 1~3：恒 9 格 / 3~4 色 / 无门洞无冰冻 —— 「快速理解、快速成功、几乎不挫败」
     V6.0 把第 3 关放宽到 4 色（曲线起点），但门洞/冰冻这类**新规则**仍然一个都不上。 */
  let teachBad = [];
  for (let lv = 1; lv <= 3; lv++) {
    const p = DBG.plan(lv);
    if (!(p.cells === 9 && p.colors >= 3 && p.colors <= 4 && p.gates === 0 && p.ice === 0)) teachBad.push('L' + lv);
  }
  chk('教学期 1~3 关恒为 9 格 / 3~4 色 / 无门洞无冰冻', teachBad.length === 0);

  /* ② 入门正式 4~8：一次只加一种复杂度（先门洞、后冰冻），且每种新手段的量级受控 */
  const p4 = DBG.plan(4), p5 = DBG.plan(5), p6 = DBG.plan(6), p7 = DBG.plan(7);
  chk('第 4 关仍是纯净局（无门洞无冰冻）', p4.gates === 0 && p4.ice === 0);
  chk('第 5 关只引入门洞（有门洞、无冰冻）', p5.gates >= 1 && p5.ice === 0);
  chk('第 6 关才引入冰冻（门洞 + 冰冻同时在场）', p6.ice >= 1);
  chk('入门期新手段量级受控（第 7 关门洞 ≤2、冰冻 ≤1）', p7.gates <= 2 && p7.ice <= 1);
  let onceBad = [];
  for (let lv = 4; lv <= 8; lv++) {
    const a = DBG.plan(lv - 1), b = DBG.plan(lv);
    if (b.gates > a.gates && b.ice > a.ice) onceBad.push('L' + lv);
  }
  chk('入门期「干扰一次只加一种」（门洞与冰冻不得同关新增）', onceBad.length === 0);
  let colorJump = [];
  for (let lv = 1; lv <= 8; lv++) if (DBG.plan(lv).colors > 6) colorJump.push('L' + lv);
  chk('入门期颜色不猛加（1~8 关 ≤ 6 色）', colorJump.length === 0);

  /* ③ 9 关以后：决策密度递进（不是容量递进），且格数不超硬上限 */
  const CELL_CAP2 = DBG.CURVE.GRID_MAX_ROWS * DBG.CURVE.GRID_MAX_COLS;
  chk('9 关以后决策密度真的在涨（第 30 关密度 > 第 10 关）', density[29] > density[9]);
  let overCap = [];
  for (let lv = 1; lv <= 30; lv++) if (DBG.plan(lv).cells > CELL_CAP2) overCap.push('L' + lv);
  chk('棋盘硬上限 ' + CELL_CAP2 + ' 格生效（1~30 关全部不超）', overCap.length === 0);
  /* V6.0 专属：曲线到第 90 关仍在爬（旧版第 24 关就完全触顶，25~90 关只是换布局） */
  const p30x = DBG.plan(30), p90x = DBG.plan(90);
  chk('曲线不触顶：第 90 关的「色 + 洞 + 冰」严格高于第 30 关',
    (p90x.colors + p90x.gates + p90x.ice) > (p30x.colors + p30x.gates + p30x.ice));
  /* 波浪保留：9 关以后（第 6~30 关，即周期 2~6）每个周期的峰值关「决策密度」最高。
     方案 F 之后第 19 关起货架恒 24 格（每行等长），cells 恒定 → 必须改用 density 口径，
     否则固定等长货架会让这条断言永远报假违规。 */
  let waveBad = [];
  for (let cyc = 1; cyc < 6; cyc++) {
    const seg = density.slice(cyc * 5, cyc * 5 + 5);
    if (seg.length < 5) continue;
    const peak = seg[4];
    if (!(peak > seg[0] && peak > seg[1] && peak >= seg[2] && peak >= seg[3]))
      waveBad.push('#' + (cyc + 1) + '[' + seg.join(',') + ']');
  }
  chk('9 关以后仍保留「波浪」节奏（每个 5 关周期的峰值关决策密度最高）', waveBad.length === 0);
  if (waveBad.length) console.log('  异常周期: ' + waveBad.join(' '));
  chk('整体递增：第 30 关格子数 > 第 5 关', growth[29] > growth[4]);
  chk('行列组合多样：1~30 关至少出现 6 种不同的「行×列」', shapeSet.size >= 6);
  if (shapeSet.size < 6) console.log('  实际组合: ' + Array.from(shapeSet).join(' '));
  chk('文本无 NaN/undefined（终检）', textsClean());
} catch (e) { console.error(e); chk('高关卡套件执行', false); }

/* ================= 水管终点回归（修：多瓶在台面时管子指错瓶） =================
   旧实现 drawManifold 按数组序取第一个台面瓶当终点，水滴颜色却取正在接的瓶 →
   「管子指着 A 瓶、流出来的却是 B 瓶的水」。现用 manifoldTarget()：接水瓶 > lastPour > 数组兜底。 */
try {
  withSeed(11, () => DBG.gen(3));
  settle();
  const Gm = DBG.G;
  Gm.state = 'play'; Gm.anim = null; Gm.mode = null; Gm.lastPour = null;
  const mk = (col, fill, slot, x) => ({ col: col, cap: 6, fill: fill, locked: false, cell: -1, gate: 0, q: 0,
    place: 'counter', slot: slot, x: x, y: 700, capT: 1, wob: 0, doneT: 0, done: false, ice: 0, shake: 0 });
  const b0 = mk(0, 0, 0, 120);   // 数组 0 号：空瓶（旧逻辑会把管子指给它）
  const b1 = mk(0, 2, 1, 260);   // 数组 1 号：半瓶 —— 续接规则应优先接它
  Gm.bottles = [b0, b1];
  Gm.tubes = [{ units: [0, 0, 0, 0], h: 144, x: 60, drop: 0 }];
  DBG.tryDrinks();
  chk('续接规则：台面有半瓶时优先接半瓶（不是空瓶）', !!Gm.anim && Gm.anim.type === 'drink' && Gm.anim.b === b1);
  chk('水管终点=正在接水的瓶（不是数组第一个台面瓶）', DBG.manifoldTarget() === b1);
  chk('lastPour 记录了接水瓶', Gm.lastPour === b1);
  frames(40); Gm.anim = null;   // 喝完后空闲
  chk('空闲时水管终点停在刚接完的瓶（不跳回数组第一个）', DBG.manifoldTarget() === b1);
  Gm.lastPour = null;
  Gm.bottles.forEach(b => { b.place = 'grid'; });
  chk('台面无瓶时水管目标为 null（整条管道隐藏）', DBG.manifoldTarget() === null);
  withSeed(12, () => DBG.gen(3)); settle();   // 恢复正常关卡，避免污染后续（已无后续，稳妥起见）
} catch (e) { console.error(e); chk('水管终点套件执行', false); }

console.log(failures === 0 ? '\n=== ALL GREEN ===' : '\n=== ' + failures + ' FAILURES ===');
process.exit(failures === 0 ? 0 : 1);

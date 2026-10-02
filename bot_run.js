// 机器人通关验证：难度曲线大改后（瓶子 12→24），1~10 关是否都还能打通
const fs = require('fs');
const path = require('path');
const FILE = process.argv[2] || path.join(__dirname, 'outputs', '解压水消除.html');
let html = fs.readFileSync(FILE, 'utf8');

/* ⚠ 产品完整性闸门（2026-10-02）：qa_rollback.js 被硬杀时文件会留在「已改坏」状态，
   机器人脚本不报错、只给出假结果（实测 dbg_diff 会输出全 0% / 全 100%）。先查污染标记。 */
if (/rollback-test/.test(html)) {
  console.error('✘ 拒绝运行：' + FILE + ' 里残留 rollback-test 标记 —— 回滚验证被中断且没还原。');
  console.error('  先还原：git checkout -- outputs/解压水消除.html');
  process.exit(2);
}

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
  + 'neighborCell:neighborCell,cellRect:cellRect,checkStuck:checkStuck,CFG:CFG,failAction:failAction,'
  + 'hasLegalDecision:hasLegalDecision,SLOT_Y:SLOT_Y,'
  + 'toolX:toolX,TOOL_Y:TOOL_Y,TOOL_H:TOOL_H,TOOL_W:TOOL_W,'
  + 'adj:function(a,b){return cellsAdjacent(a,b);}};\n  '
  + code.slice(i);

try { eval(code); } catch (e) { console.error('EVAL FAIL:', e.stack); process.exit(1); }
let T = 0;
function frames(n) { for (let k = 0; k < n; k++) { T += 16.7; const cb = rafCb; rafCb = null; cb && cb(T); } }
function click(x, y) { listeners['mousedown'] && listeners['mousedown']({ clientX: x, clientY: y }); }
const DBG = global.__DBG;
/* 全程可控的伪随机：连「重开本关」重新生成布局也是确定的 ——
   否则这个门禁会时红时绿，等于没有门禁。 */
let RNG = null;
function seedRandom(s) {
  let x = (s >>> 0) || 1;
  RNG = function () { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  Math.random = RNG;
}
const BOTT_Y = 470;
/* 工具栏坐标必须从产品里读，不能写死：
   旧版把 TOOL_X0 写死成 15，而产品去掉「假分享」按钮后已经重新居中到 85 ——
   于是机器人点工具栏一直在点空位，所有工具类兜底动作全部静默失效。 */
function toolCX(i2) { return DBG.toolX(i2) + DBG.TOOL_W / 2; }
function toolCY() { return DBG.TOOL_Y + DBG.TOOL_H / 2; }
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
/* 机器人这一局的「恢复开销」：用了多少次复活/重开 —— 这是比「能不能通关」更细的难度信号 */
const STAT = { revives: 0, restarts: 0 };
/* 诊断用：机器人走过的动作轨迹（只保留最近 40 步） */
const LAST = [];
function dump(level, attempt, end) {
  const G = DBG.G;
  console.log('--- 机器人未通关 L' + level + ' attempt' + attempt + ' 结束原因: ' + end + ' ---');
  console.log('  state=' + G.state + ' freeSlot=' + DBG.freeSlot() + ' cellCount=' + G.cellCount +
    ' hasLegalDecision=' + DBG.hasLegalDecision());
  console.log('  tools=' + JSON.stringify(G.tools) + ' undoLeft=' + G.undoLeft +
    ' unlockLeft=' + G.unlockLeft + ' history=' + G.history.length +
    ' reviveUsed=' + G.reviveUsed + ' fail=' + (G.fail ? G.fail.reason : 'null'));
  console.log('  slots=' + JSON.stringify(G.slots.map(s => s.open ? 1 : 0)));
  console.log('  tubes=' + JSON.stringify(G.tubes.map(t => t.units)));
  console.log('  bottles=' + JSON.stringify(G.bottles.map(b =>
    b.col + ':' + b.place + ':' + b.fill + '/' + b.cap + (b.locked ? ':ice' : '') +
    (b.gate >= 0 ? ':gate' + b.gate : ''))));
  console.log('  最近动作: ' + LAST.join(' > '));
}
function ok_(label) {
  LAST.push(label); if (LAST.length > 40) LAST.shift();
  return true;
}
function botStep(G) {
  /* 失败面板（V4.0 §10）：机器人必须走和真人一样的恢复回路 ——
     先看广告复活，复活次数用尽再重开本关。
     （旧版这里点的是 V4.0 之前「卡死自救面板」的坐标，现在那个面板已经不存在了，
       所以点下去毫无反应，机器人会一路空转到超时 —— 看起来像「关卡不可解」。） */
  if (G.fail) {
    frames(50);                                   // 面板有 0.6s 缓冲期，不等就会被吞掉点击
    const revivesLeft = (G.reviveUsed || 0) < DBG.CFG.reviveLimit;
    if (revivesLeft) { STAT.revives++; click(360, 514); frames(30); return ok_('revive'); }
    STAT.restarts++; click(360, 614); frames(30); return ok_('restart');
  }
  const bs = bottoms(G);
  for (const b of G.bottles) {
    if (DBG.gridPlayable(b) && bs.includes(b.col) && DBG.freeSlot() >= 0) {
      click(b.x, b.y); return ok_('place:' + b.col);
    }
  }
  const idle = G.bottles.filter(b => b.place === 'counter' && b.fill < b.cap && !bs.includes(b.col));
  if (idle.length && DBG.freeSlot() < 0 && G.undoLeft > 0) {
    click(toolCX(3), toolCY()); frames(2);
    click(idle[0].x, idle[0].y - 50); return ok_('return-idle');
  }
  if (G.bottles.some(b => b.place === 'counter' && b.fill < b.cap && bs.includes(b.col))) {
    frames(20); return ok_('wait-drink');
  }
  const needRoom = G.bottles.filter(b => (b.locked > 0 && b.place === 'grid') ||
    (b.gate >= 0 && b.place === 'grid' && (!DBG.gateFront(b) || DBG.gateBlocked(b))));
  if (needRoom.length && DBG.freeSlot() >= 0) {
    const cands = G.bottles.filter(b => DBG.gridPlayable(b));
    const near = cands.find(b => needRoom.some(i2 => DBG.adj(i2.cell, b.cell)));
    const pick = near || cands[0];
    if (pick) { click(pick.x, pick.y); return ok_('place-unblock'); }
  }
  /* ---- 兜底：贪心规则找不到招时，按「真人会试的顺序」把每张牌都打一遍 ----
     旧版这里只试了 clear/swap 两张牌就 return false，于是「产品认为还有合法决策、
     但机器人不会用那张牌」会被误报成「关卡打不通」。 */
  // ① 解锁台面（解锁本身也是一个合法决策，而且腾出放瓶的空间）
  if (G.unlockLeft > 0 && DBG.freeSlot() < 0) {
    const ls = G.slots.map((s, i2) => i2).filter(i2 => !G.slots[i2].open);
    if (ls.length) { click(G.slotX[ls[ls.length - 1]], DBG.SLOT_Y - 52); frames(8); return ok_('unlock'); }
  }
  // ② 万能指：自动把一个能喝到水的瓶子放上台面（最直接解死局的工具）
  if (G.tools.finger > 0 && G.bottles.some(b => DBG.gridPlayable(b))) {
    click(toolCX(1), toolCY()); frames(10); return ok_('finger');
  }
  // ③ 魔法清除：把管底那杯倒进台面同色瓶 —— 只有真的存在补偿目标时才点（否则会被拒且白转）
  const clearOk = G.tubes.some(t => t.units.length &&
    G.bottles.some(b => b.col === t.units[0] && b.place === 'counter' && b.fill < b.cap));
  if (G.tools.clear > 0 && clearOk) {
    click(toolCX(0), toolCY()); frames(4);
    const lockedCols = new Set(G.bottles.filter(b => b.locked > 0 && b.place === 'grid').map(b => b.col));
    let ti = G.tubes.findIndex(t => t.units.length && lockedCols.has(t.units[0]));
    if (ti < 0) ti = G.tubes.findIndex(t => t.units.length);
    const t = G.tubes[ti];
    click(t.x + G.tubeW / 2, tubeMidY(t)); frames(8); return ok_('clear');
  }
  // ④ 随心互换：换掉卡住的管底
  if (G.tools.swap > 0) {
    click(toolCX(2), toolCY()); frames(4);
    const freeCol = G.bottles.find(b => DBG.gridPlayable(b));
    let ti = G.tubes.findIndex(t => t.units.length && freeCol && t.units[0] === freeCol.col);
    if (ti < 0) ti = 0;
    const other = (ti + 1) % G.tubes.length;
    click(G.tubes[ti].x + G.tubeW / 2, tubeMidY(G.tubes[ti])); frames(4);
    click(G.tubes[other].x + G.tubeW / 2, tubeMidY(G.tubes[other])); frames(8); return ok_('swap');
  }
  /* ⑤ 撤销放最后：撤销只是「回退」，先撤销再让贪心重新放瓶会变成原地打转。
     只有前面几种真能改变局面的动作都用完了，才回退。 */
  if (G.undoLeft > 0 && G.history.length > 0) {
    const anyCounter = G.bottles.find(b => b.place === 'counter' && b.fill < b.cap);
    click(toolCX(3), toolCY()); frames(4);
    if (anyCounter) click(anyCounter.x, anyCounter.y - 50);
    frames(8); return ok_('undo');
  }
  /* ⑥ 牌都打完了：如果产品自己也判定「没有任何合法决策」，面板会在下一帧弹出，
     交给上面的失败分支走恢复回路；否则说明机器人漏了某张牌 —— 记一次未通过。 */
  if (!DBG.hasLegalDecision()) { frames(30); return ok_('expect-fail-panel'); }
  return false;
}
function botPlay(level, maxTries) {
  for (let attempt = 0; attempt < maxTries; attempt++) {
    /* 固定种子：同一关 + 同一 attempt 永远生成同一套布局（连「重开本关」重新生成的布局
       也确定）。否则「贪心机器人偶尔差一步」会让这个套件时红时绿（flaky），
       而 flaky 的门禁等于没有门禁 —— 真出问题时反而看不出来。 */
    seedRandom(level * 7919 + attempt * 104729);
    DBG.gen(level, { seed: level * 7919 + attempt * 104729, tier: +(process.env.TIER || 0) }); frames(10); frames(5);
    STAT.revives = 0; STAT.restarts = 0;
    let guard = 0, ok = true, end = '';
    while (DBG.G.state !== 'win' && guard++ < 2000) {
      if (DBG.G.anim) { frames(25); continue; }
      if (!botStep(DBG.G)) { ok = false; end = 'botStep=false'; break; }
      frames(4);
    }
    if (DBG.G.state !== 'win' && process.env.DBG_FAIL) dump(level, attempt + 1, end || ('guard=' + guard));
    frames(60);
    if (ok && DBG.G.state === 'win')
      return { win: true, steps: guard, attempt: attempt + 1, revives: STAT.revives, restarts: STAT.restarts };
  }
  return { win: false, steps: -1, attempt: maxTries, revives: STAT.revives, restarts: STAT.restarts };
}

const out = [];
out.push('关卡    | 格子 | 瓶子 | 门洞 | 结果 | 步数 | 尝试 | 复活 | 重开');
out.push('-------+------+------+------+------+-----+-----+-----+-----');
const ONLY = (process.env.ONLY || '').trim();
const TRIES = +(process.env.TRIES || 3);
const MAXLV = +(process.env.MAX || 30);
const TIER = +(process.env.TIER || 0);
const LVS = ONLY ? ONLY.split(',').map(Number)
  : Array.from({ length: MAXLV }, (_, k) => k + 1);
let allWin = true, triedTotal = 0, revivedTotal = 0, restartTotal = 0, firstTry = 0;
for (const lv of LVS) {
  seedRandom(lv * 7919);
  DBG.gen(lv, { seed: lv * 7919, tier: TIER }); frames(6);     // 统计行与 attempt#1 用同一套布局
  const g = DBG.G;
  const cells = g.cellCount, bots = g.bottles.length, gates = g.gates.length;
  const r = botPlay(lv, TRIES);
  if (!r.win) allWin = false;
  triedTotal += r.attempt;
  revivedTotal += r.revives; restartTotal += r.restarts;
  if (r.attempt === 1 && r.revives === 0 && r.restarts === 0) firstTry++;
  const lvLabel = (TIER > 0 ? ('T' + TIER + '·') : '') + lv;
  out.push(lvLabel.padStart(7) + ' |' + String(cells).padStart(5) + ' |' + String(bots).padStart(5) + ' |'
    + String(gates).padStart(5) + ' |' + (r.win ? ' 通关 ' : ' 未通过') + ' | '
    + String(r.steps).padStart(5) + ' | ' + String(r.attempt).padStart(3) + ' | '
    + String(r.revives).padStart(3) + ' | ' + String(r.restarts).padStart(3));
}
out.push('');
out.push('关卡数 ' + LVS.length + '　总尝试 ' + triedTotal + '　复活 ' + revivedTotal + '　重开 ' + restartTotal);
out.push('一次到位（第 1 次尝试、且没用复活/重开）的关卡：' + firstTry + ' / ' + LVS.length);
out.push('固定种子（可复现，不是随机抽奖）');
out.push(allWin ? '=== 全部通关（尝试次数上限 ' + TRIES + '）===' : '=== 有关卡未通过，需要排查 ===');
fs.writeFileSync(path.join(__dirname, '_bot.txt'), out.join('\n'));

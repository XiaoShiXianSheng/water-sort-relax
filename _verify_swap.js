/* 互换改造守卫：任意两格互换（同管跨层 / 跨管跨层）+ 点击层命中 + 逐色守恒
   用法：node _verify_swap.js                 对当前产品跑（应全 PASS）
        node _verify_swap.js <产品文件>       对改坏前的版本跑（应 FAIL，用于反证） */
const fs = require('fs');
const P = process.argv[2] || 'outputs/解压水消除.html';
const src = fs.readFileSync(P, 'utf8');

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('PASS ' + m); };
const bad = m => { fail++; console.log('FAIL ' + m); };
const has = (n, re) => re.test(src) ? ok(n) : bad(n);

/* ---------- 1. 静态结构 ---------- */
has('状态里有 swapFirstL 字段（记录选中的层号）', /swapFirstL\s*:\s*-1/);
has('useSwapLayer 已实现', /function useSwapLayer\(i,li,j,lj\)/);
has('useSwap 保留并转发到层版（老调用方不破）', /function useSwap\(i,j\)\{\s*useSwapLayer\(i,0,j,0\);/);
has('unitAt(vx,vy) 能命中管里具体那一层', /function unitAt\(vx,vy\)/);
has('换的是 units[li] <-> units[lj]（不再是写死 units[0]）', /a\.units\[li\]=_s2; b\.units\[lj\]=_s1;/);
has('层号越界有拒绝逻辑', /li>=a\.units\.length/);
has('点击走 unitAt（能选到上层那一格）', /G\.mode==='swap'\)[\s\S]{0,140}unitAt\(vx,vy\)/);
has('同管两层走同一条换位路径', /useSwapLayer\(G\.swapFirst,G\.swapFirstL,hit\.t,hit\.l\)/);
has('unitAt 的 by 与 drawTube 一致（都是 BOTT_Y-14）', /function unitAt[\s\S]{0,200}by=BOTT_Y-14/);

/* ---------- 2. 运行期行为 ---------- */
let D = null, X = null;
try {
  const qa = require('./qa_lib.js');
  D = qa.loadGame({});
  D.frames(3);
  D.click(360, 640);   // 先进关，拿到活的 G
  D.frames(6);
  X = D.DBG;
} catch (e) {
  bad('loadGame 失败：' + e.message);
}

if (D && typeof X.useSwapLayer === 'function') {
  const G = X.G;
  const setup = tubes => {
    G.tubes = tubes.map(u => ({ units: u.slice(), x: 0, h: 120, drop: 0 }));
    G.tools.swap = 1; G.mode = 'swap'; G.swapFirst = -1; G.swapFirstL = -1;
    G.moves = 0; G.toolsUsed = 0; G.history = [];
  };
  const total = () => G.tubes.reduce((a, t) => a + t.units.length, 0);
  const perColor = () => {
    const m = {};
    G.tubes.forEach(t => t.units.forEach(c => { m[c] = (m[c] || 0) + 1; }));
    return JSON.stringify(m);
  };

  /* 2.1 同管跨层：把非底部那层换到底部 —— 用户要的就是这个能力 */
  setup([[1, 2], [3]]);
  const n0 = total();
  X.useSwapLayer(0, 1, 0, 0);
  (G.tubes[0].units[0] === 2)
    ? ok('同管跨层：第 2 层的【蓝】被换到了管底，台面缺蓝时立刻能接')
    : bad('同管跨层没生效，管底=' + G.tubes[0].units[0]);
  (G.tubes[0].units[1] === 1)
    ? ok('同管跨层：原来的管底【橙】顶到第 2 层，一杯没丢')
    : bad('同管跨层后第 2 层颜色不对：' + G.tubes[0].units[1]);
  total() === n0 ? ok('同管跨层：总格数不变（水量守恒）') : bad('同管跨层后水量变了');
  G.tools.swap === 0 ? ok('同管跨层：扣 1 次道具') : bad('同管跨层没扣道具');

  /* 2.2 跨管跨层 */
  setup([[1, 2], [3, 4]]);
  X.useSwapLayer(0, 1, 1, 1);
  (G.tubes[0].units[1] === 4 && G.tubes[1].units[1] === 2)
    ? ok('跨管跨层：A 第2层 <-> B 第2层，颜色真的对调')
    : bad('跨管跨层失败 A1=' + G.tubes[0].units[1] + ' B1=' + G.tubes[1].units[1]);

  /* 2.3 老接口不变 */
  setup([[1, 2], [3, 4]]);
  X.useSwap(0, 1);
  (G.tubes[0].units[0] === 3 && G.tubes[1].units[0] === 1)
    ? ok('老接口 useSwap(i,j) 仍换两根管管底，既有调用方不破')
    : bad('老接口行为变了');

  /* 2.4 同一格自换 -> 拒绝、不扣道具 */
  setup([[1, 2], [3]]);
  X.useSwapLayer(0, 0, 0, 0);
  (G.tools.swap === 1 && G.tubes[0].units[0] === 1)
    ? ok('同一格自己换：拒绝 + 不扣道具 + 盘面不变')
    : bad('同一格自换没被正确拒绝');

  /* 2.5 空管 / 越界 */
  setup([[1, 2], []]);
  X.useSwapLayer(0, 0, 1, 0);
  G.tools.swap === 1 ? ok('空管换位：拒绝 + 不扣道具') : bad('空管换位竟然扣了道具');
  setup([[1, 2], [3]]);
  X.useSwapLayer(0, 5, 1, 0);
  (G.tools.swap === 1 && G.tubes[0].units[0] === 1)
    ? ok('层号越界：拒绝 + 不扣道具（不会写到 undefined）')
    : bad('层号越界处理不对');

  /* 2.6 逐色守恒 —— 换位绝不能把关卡变成死局 */
  setup([[1, 2, 1], [2, 3, 3]]);
  const pc0 = perColor();
  X.useSwapLayer(0, 2, 1, 0);
  perColor() === pc0
    ? ok('逐色守恒：每种颜色的杯数换位前后完全一致')
    : bad('逐色守恒被破坏 ' + pc0 + ' -> ' + perColor());

  /* 2.7 点击能选中「上层那一格」—— unitAt 几何必须和 drawTube 对得上 */
  setup([[1, 2, 3], [4, 5, 6]]);
  const C = X.consts();
  const t = G.tubes[0];
  const x = t.x + G.tubeW / 2;
  const UH = G.uh || C.UH;
  const by = C.BOTT_Y - 14;
  const h2 = X.unitAt(x, by - 2.5 * UH);
  const h0 = X.unitAt(x, by - 0.5 * UH);
  (h0 && h0.t === 0 && h0.l === 0)
    ? ok('点击管底那格 -> 命中第 0 层')
    : bad('点击管底那格命中错：' + JSON.stringify(h0));
  (h2 && h2.t === 0 && h2.l === 2)
    ? ok('点击管子上层那一格 -> 命中第 2 层（旧版只能选整根管，选不了层）')
    : bad('点击上层命中错：' + JSON.stringify(h2));
} else {
  bad('拿不到 useSwapLayer，无法做运行期验证');
}

console.log('---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
process.exit(fail ? 1 : 0);

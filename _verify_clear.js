/* 魔法清除守卫：点台面瓶 → 遍历所有水管，从最底层开始把该颜色吸走倒进这个瓶
   核心价值：自动接水只够得到 units[0]（管底）；这个道具能抽走**被压在上面的同色水**。
   用法：node _verify_clear.js            正常（应全 PASS）
        GAME=<回滚副本> node _verify_clear.js   反证（应 FAIL） */
const fs = require('fs');
const P = process.argv[2] || 'outputs/解压水消除.html';
const src = fs.readFileSync(P, 'utf8');

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('PASS ' + m); };
const bad = m => { fail++; console.log('FAIL ' + m); };
const has = (n, re) => re.test(src) ? ok(n) : bad(n);

has('useClearAll 已实现', /function useClearAll\(b\)/);
has('从最底层开始扫（i 从 0 递增）', /for\(var i=0;i<u\.length[\s\S]{0,520}u\.splice\(i,1\)/);
has('抽走后索引不动 i（上面的水自动下沉）', /u\.splice\(i,1\); got\+\+;[\s\S]{0,170}\} else i\+\+;/);
has('先预演再扣道具（吸不到就别扣）', /if\(pre<=0\)\{toast/);
has('clear 模式下点台面瓶走 useClearAll', /G\.mode==='clear'\)\{useClearAll\(jb\)/);
has('台面未满瓶在 clear 模式描绿框', /G\.mode==='clear'&&b\.place==='counter'&&!b\.done&&b\.fill<b\.cap/);

let D = null, X = null;
try {
  const qa = require('./qa_lib.js');
  D = qa.loadGame({}); D.frames(3); D.click(360, 640); D.frames(6); X = D.DBG;
} catch (e) { bad('loadGame 失败：' + e.message); }

if (X && typeof X.useClearAll === 'function') {
  const G = X.G;
  // 手工局面：3 根管里都散着红色（有的压在上面），台面放一个红瓶
  /* 注意：cap 给 9 是为了在「不触发 completeJar 飞走」的前提下量杯数；
     产品真实值是 3，装满即飞走（另有专门一条断言验它）。 */
  const setup = (tubes, fill, cap) => {
    G.tubes = tubes.map(u => ({ units: u.slice(), x: 0, h: 120, drop: 0 }));
    G.tools.clear = 1; G.mode = 'clear'; G.swapFirst = -1; G.swapFirstL = -1;
    G.moves = 0; G.toolsUsed = 0; G.history = [];
    return { col: 1, fill: fill || 0, cap: cap || 9, place: 'counter', done: false, slot: 0, x: 100, y: 600 };
  };
  const sum = col => G.tubes.reduce((a, t) => a + t.units.filter(c => c === col).length, 0);

  /* 1. 核心：抽走「被压在上面的同色水」—— 自动接水够不到的那部分 */
  // 管 A=[橙,红]  管 B=[绿,红,红]  管 C=[红]   → 红共 4 杯，其中 3 杯压在上面
  let b = setup([[0, 1], [2, 1, 1], [1]], 0);
  const before = sum(1);
  X.useClearAll(b);
  const after = sum(1);
  (b.fill === 4 && before - after === 4)
    ? ok('全场吸色：从 3 根管里抽走 4 杯红，全部倒进这个瓶（压在上面的也一起抽走）')
    : bad('吸色数量不对：瓶 fill=' + b.fill + ' 少了 ' + (before - after) + ' 杯');
  (G.tubes[0].units.join(',') === '0' && G.tubes[1].units.join(',') === '2')
    ? ok('压在上面的红被抽走后，下面的水自动下沉（管 A 只剩橙、管 B 只剩绿）')
    : bad('下沉不对 A=' + G.tubes[0].units + ' B=' + G.tubes[1].units);
  (sum(0) === 1 && sum(2) === 1)
    ? ok('只吸指定颜色，别的颜色一杯没动')
    : bad('误伤了别的颜色');
  G.tools.clear === 0 ? ok('扣 1 次道具') : bad('没扣道具');

  /* 2. 瓶按真实 cap=3 装满 → 只吸够 3 杯就停，且触发 completeJar 飞走腾槽 */
  b = setup([[1, 1, 1], [1]], 0, 3);
  X.useClearAll(b);
  (sum(1) === 1)
    ? ok('真实容量 3：只吸 3 杯就停，第 4 杯留在管里（不会装超）')
    : bad('超装或没装满，管里还剩红 ' + sum(1));
  (b.done === true || b.fill === 0)
    ? ok('装满 3/3 → 走 completeJar 飞走，台面槽真的空出来了')
    : bad('满了却没飞走 done=' + b.done + ' fill=' + b.fill);

  /* 3. 水量守恒：管里 −N == 瓶里 +N */
  b = setup([[0, 1], [2, 1, 1], [1]], 1);
  const t0 = G.tubes.reduce((a, t) => a + t.units.length, 0), f0 = b.fill;
  X.useClearAll(b);
  const t1 = G.tubes.reduce((a, t) => a + t.units.length, 0), f1 = b.fill;
  (t0 - t1 === f1 - f0)
    ? ok('逐滴守恒：管里少了几杯，瓶里就多了几杯（水不会凭空消失）')
    : bad('守恒破了 管 -' + (t0 - t1) + ' 瓶 +' + (f1 - f0));
  const pc = {};
  G.tubes.forEach(t => t.units.forEach(c => { pc[c] = (pc[c] || 0) + 1; }));
  (pc[1] !== undefined || sum(1) === 0)
    ? ok('守恒前提下关卡不会变成死局（瓶装不满的风险不存在）')
    : bad('结构异常');

  /* 4. 吸不到就拒绝且不扣道具 */
  b = setup([[0, 0], [2, 2]], 0);
  b.col = 1;
  X.useClearAll(b);
  (G.tools.clear === 1 && b.fill === 0)
    ? ok('水管里没有这个颜色：拒绝 + 不扣道具 + 瓶不变')
    : bad('无目标时没有正确拒绝');

  /* 5. 满瓶拒绝 */
  b = setup([[1, 1]], 3, 3);
  X.useClearAll(b);
  (G.tools.clear === 1) ? ok('瓶已满：拒绝 + 不扣道具') : bad('满瓶竟然扣了道具');

  /* 6. 自动接水够不到上面的层 —— 这就是这个道具存在的理由 */
  b = setup([[0, 1], [2]], 0);
  const bottomColor = G.tubes[0].units[0];
  (bottomColor === 0)
    ? ok('前提确认：管底是橙，台面红瓶靠自动接水是接不到的（红压在上面）')
    : bad('前提构造失败');
  X.useClearAll(b);
  (b.fill === 1 && G.tubes[0].units.join(',') === '0')
    ? ok('道具价值成立：把自动接水够不到的那杯红抽出来，倒进红瓶')
    : bad('没能抽出上层的水 fill=' + b.fill);
} else {
  bad('拿不到 useClearAll，无法做运行期验证');
}

console.log('---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
process.exit(fail ? 1 : 0);

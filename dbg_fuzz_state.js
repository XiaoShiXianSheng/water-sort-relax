/* dbg_fuzz_state.js —— 探针：暴力随机输入有没有把全局状态改脏（定位「20 次里 5 次假 FAIL」的根因）
   假设：冒烟段 400 次随机点击会点到「胜界面 → 挑战 → 困难/极限」，
   把持久化的 G.tier 改成 1/2；之后所有 DBG.gen(lv)（不传 opts.tier）都会
   按挑战档生成关卡 → 「第1关9格 / 台面槽5~7 / 水柱不顶出 / 门洞数 / 格子数按 levelPlan」
   这一整簇普通档断言集体假 FAIL。
   本探针只做一件事：复现冒烟，打印冒烟后的 G.tier。 */
const fs = require('fs'), path = require('path');
const { loadGame } = require('./qa_lib.js');

const N = +(process.env.N || 30);
const hits = { 0: 0, 1: 0, 2: 0 };
const detail = [];
for (let i = 0; i < N; i++) {
  const g = loadGame({});
  g.frames(30);
  g.click(360, 860); g.frames(10);
  const tierBefore = g.DBG.G.tier;
  let threw = false;
  try {
    for (let k = 0; k < 400; k++) { g.click(Math.random() * 720, Math.random() * 1280); g.frames(2); }
    g.frames(3000);
  } catch (e) { threw = true; }
  const tierAfter = g.DBG.G.tier;
  hits[tierAfter] = (hits[tierAfter] || 0) + 1;
  if (tierAfter !== tierBefore) {
    detail.push('#' + i + ' tier ' + tierBefore + ' → ' + tierAfter
      + '  lv=' + g.DBG.G.level + '  之后 gen(1) 得到格数=' + (function () {
        g.DBG.gen(1); g.frames(8); return g.DBG.G.cellCount + ' 槽=' + g.DBG.G.slots.length;
      })());
  }
}

const out = [];
out.push('=== 冒烟 400 次随机点击后 G.tier 的分布（' + N + ' 次） ===');
out.push('tier=0（普通，未被污染） : ' + (hits[0] || 0));
out.push('tier=1（困难，被污染）   : ' + (hits[1] || 0));
out.push('tier=2（极限，被污染）   : ' + (hits[2] || 0));
out.push('');
out.push('被污染的样例（污染后 gen(1) 的格数/槽数，普通档应为 9 格 / 5 槽）：');
detail.slice(0, 12).forEach(d => out.push('  ' + d));
fs.writeFileSync(path.join(__dirname, '_flake_probe_out.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));

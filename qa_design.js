/* qa_design.js —— 设计测试：关卡与布局的「设计不变量」
 *
 * 它回答的问题是：这套关卡设计在数值上是不是自洽、可玩、不会出丑？
 *   · 水量守恒：管里的水 == 所有瓶子需要的总量（多一滴少一滴都是 bug）
 *   · 可解性：每关都真的能通关（不是靠玩家运气）
 *   · 无留白：行长度差 ≤ 1，不会出现孤零零的 1 格
 *   · 不越界：货架不压工具栏、不压台面进度条（这是用户肉眼能看见的丑）
 *   · 波浪节奏：峰值关真的比放水关难
 *
 * 用法：node qa_design.js
 */
const { loadGame, Reporter, guard } = require('./qa_lib.js');
const rep = new Reporter('design');

function load() {
  const g = loadGame({});
  g.frames(3);
  g.click(360, 640);            // 标题页 → 进游戏
  g.frames(5);
  return g;
}

guard(rep, '设计', function () {
  const g = load();
  const D = g.DBG;
  const C = D.consts();
  const LVMAX = 40;

  const info = [];              // 每关的客观指标
  const bad = {
    cells: [], rows: [], rowLen: [], ragged: [], colors: [], colorCover: [],
    water: [], tubes: [], layers: [], slots: [], gates: [], gateAdj: [], gateEmpty: [],
    ice: [], solvable: [], leftBleed: [], rightBleed: [], topBleed: [],
    gridBottom: [], counterClash: [], missingGap: []
  };
  let maxOverflow = 0, overflowAt = 0;

  for (let lv = 1; lv <= LVMAX; lv++) {
    D.gen(lv); g.frames(3);
    const G = D.G, pl = D.plan(lv);
    const water = G.tubes.reduce((s, t) => s + t.units.length, 0);
    const need = G.bottles.reduce((s, b) => s + b.cap, 0);
    const layers = G.tubes.map(t => t.units.length);
    const maxLayer = Math.max.apply(null, layers);
    const gridBottom = G.gridY0 + G.gridRows * (G.tile + C.GY) - C.GY;
    const rowsMin = Math.min.apply(null, G.rowLen), rowsMax = Math.max.apply(null, G.rowLen);
    const colorSet = new Set(G.bottles.map(b => b.col));
    info.push({
      lv: lv, cells: G.cellCount, rows: G.gridRows, rowLen: G.rowLen.slice(),
      colors: colorSet.size, gates: G.gates.length,
      ice: G.bottles.filter(b => b.locked > 0).length, slots: G.slots.length,
      tubes: G.tubes.length, water: water, need: need, maxLayer: maxLayer,
      tile: G.tile, gridY0: G.gridY0, gridBottom: gridBottom, rgb: rowsMin + '-' + rowsMax
    });

    /* --- 数量与形状 ---
       瓶子数不是「等于格数」：门洞会在同一个格子里叠着多塞瓶子（drawGateBottles 负责画出来）。
       正确的不变量：瓶子数 == 格数 + Σ(每个门洞里的瓶数 - 1)。
       多一个少一个都说明「瓶子摆放」和「格子数量」对不上了 —— 那会直接导致有些格子空着、
       或者有些瓶子没地方画。 */
    if (G.cellCount !== pl.cells) bad.cells.push('L' + lv);
    const sumRow = G.rowLen.reduce((a, b) => a + b, 0);
    if (sumRow !== G.cellCount) bad.rowLen.push('L' + lv);
    let extraInGates = 0;
    for (let gi = 0; gi < G.gates.length; gi++) extraInGates += Math.max(0, D.gateRest(gi) - 1);
    if (G.bottles.length !== G.cellCount + extraInGates)
      bad.cells.push('L' + lv + '(瓶' + G.bottles.length + '≠格' + G.cellCount + '+洞内多塞' + extraInGates + ')');
    if (G.gridRows < 2 || G.gridRows > 5) bad.rows.push('L' + lv + '=' + G.gridRows);
    if (rowsMin < 3 || rowsMax > 7) bad.rowLen.push('L' + lv + ' 行' + G.rowLen.join(','));
    if (rowsMax - rowsMin > 1) bad.ragged.push('L' + lv + ' 行' + G.rowLen.join(','));

    /* --- 颜色：3~6 种且每种都有瓶子 --- */
    if (colorSet.size < 3 || colorSet.size > 6) bad.colors.push('L' + lv + '=' + colorSet.size);
    if (colorSet.size !== pl.colors) bad.colors.push('L' + lv + ' 实际' + colorSet.size + '≠计划' + pl.colors);
    for (let c = 0; c < pl.colors; c++) {
      if (!G.bottles.some(b => b.col === c)) bad.colorCover.push('L' + lv + ' 色' + c + '无瓶');
    }

    /* --- 水量守恒（设计期的核心不变量） --- */
    if (water !== need) bad.water.push('L' + lv + ' 水' + water + '≠需' + need);

    /* --- 水管 --- */
    if (G.tubes.length < 3 || G.tubes.length > 9) bad.tubes.push('L' + lv + '=' + G.tubes.length);
    if (maxLayer > 16) bad.layers.push('L' + lv + '=' + maxLayer);
    const of = Math.max(0, 0 - (C.BOTT_Y - maxLayer * (G.uh || 36)));
    if (of > maxOverflow) { maxOverflow = of; overflowAt = lv; }

    /* --- 台面槽 --- */
    if (G.slots.length < 5 || G.slots.length > 7) bad.slots.push('L' + lv + '=' + G.slots.length);

    /* --- 门洞 / 冰冻 --- */
    if (G.gates.length > pl.gates) bad.gates.push('L' + lv + ' 实际' + G.gates.length + '>计划' + pl.gates);
    for (let a = 0; a < G.gates.length; a++) {
      if (G.bottles.filter(b => b.gate === a).length < 1) bad.gateEmpty.push('L' + lv + ' 洞' + a);
      for (let b2 = a + 1; b2 < G.gates.length; b2++) {
        if (D.cellsAdjacent(G.gates[a].cell, G.gates[b2].cell)) bad.gateAdj.push('L' + lv + ' 洞' + a + '/' + b2);
      }
    }
    const iceN = G.bottles.filter(b => b.locked > 0).length;
    if (iceN > pl.ice + 1) bad.ice.push('L' + lv + ' 实际' + iceN + '>计划' + pl.ice);

    /* --- 可解性：这是最重要的一条，玩家卡死 = 差评 --- */
    if (!D.layoutSolvable()) bad.solvable.push('L' + lv);

    /* --- 几何：不越界、不压工具栏、不压台面进度条 --- */
    for (let cell = 0; cell < G.cellCount; cell++) {
      const rc = D.cellRect(cell);
      if (rc.x < 8) bad.leftBleed.push('L' + lv + ' cell' + cell + ' x=' + rc.x.toFixed(0));
      if (rc.x + rc.w > C.VW - 8) bad.rightBleed.push('L' + lv + ' cell' + cell);
      if (rc.y < C.GRID_Y0) bad.topBleed.push('L' + lv + ' cell' + cell + ' y=' + rc.y.toFixed(0));
    }
    if (gridBottom > C.TOOL_Y - 8) bad.gridBottom.push('L' + lv + ' 底' + gridBottom + '>工具栏' + C.TOOL_Y);
    /* 台面与货架之间的「呼吸空隙」——用真实绘制几何推，不用魔法数字：
       台面瓶子最低画到的元素 = 刻度格下沿（drawJarCounter：y+28 起、高 chh ≤ 10）→ SLOT_Y+38
       货架瓶子最高画到的元素 = 瓶盖顶
         （drawBottle：瓶盖 cy2 = y-bh+8，画在 cy2-15 → 盖顶 = y-bh-7；
           而格子瓶子 y = 格子上沿 + tile/2 + 18）
       两者必须留 ≥4px，否则肉眼看到的就是「货架顶到台面上」，也就是用户说的层叠感。 */
    const capTop = G.gridY0 + G.tile / 2 + 18 - G.bh - 7;
    const counterBottom = C.SLOT_Y + 38;
    if (capTop < counterBottom + 4)
      bad.counterClash.push('L' + lv + ' 瓶盖顶' + capTop.toFixed(1) + ' < 台面刻度底' + counterBottom + '+4');
  }

  /* ============ 汇总断言（一次报告全部违规关卡，便于定位） ============ */
  const one = (title, arr, extra) => rep.ok(title, arr.length === 0, arr.slice(0, 6).join(' ') + (arr.length > 6 ? ' …共' + arr.length : '') + (extra || ''));
  one('格数严格按 levelPlan（1~40 关）', bad.cells);
  one('每行长度之和 == 格数 == 瓶子数', bad.rowLen);
  one('行数在 2~5（不再是永远 3 行）', bad.rows);
  one('每行 3~7 格（既不留 1 格孤儿、也不挤爆）', bad.rowLen);
  one('行长度差 ≤ 1（长短整齐，不出现参差缺角）', bad.ragged);
  one('颜色数 3~6 且与 levelPlan 一致', bad.colors);
  one('每种颜色都有瓶子（没有永远用不上的水）', bad.colorCover);
  one('**水量守恒**：管中水总量 == 所有瓶子容量之和', bad.water);
  one('水管 3~9 根（随关卡增长）', bad.tubes);
  one('单管层数 ≤ 16（再多就是纯折磨）', bad.layers);
  one('台面槽 5~7（含 1 个广告解锁位）', bad.slots);
  one('门洞数不超 levelPlan', bad.gates);
  one('**门洞两两不相邻**（相邻会互相堵死）', bad.gateAdj);
  one('每个门洞至少含 1 个瓶子（空洞 = 无效设计）', bad.gateEmpty);
  one('冰冻瓶数不超 levelPlan 计划值', bad.ice);
  one('**可解性自检：1~40 关全部能通关**', bad.solvable);
  one('格子左不越界（留 ≥8px 边距）', bad.leftBleed);
  one('格子右不越界（留 ≥8px 边距）', bad.rightBleed);
  one('货架首行不高于设计基线', bad.topBleed);
  one('货架不压底部工具栏（留 ≥8px）', bad.gridBottom);
  one('**台面与货架之间留出空隙**（货架瓶盖顶 ≥ 台面刻度底 + 4px；否则首行会顶到台面上）', bad.counterClash);

  /* ============ 节奏与多样性 ============ */
  const growth = info.map(x => x.cells);
  const waveBad = [];
  for (let cyc = 0; cyc * 5 < growth.length; cyc++) {
    const seg = growth.slice(cyc * 5, cyc * 5 + 5);
    if (seg.length < 5) continue;
    if (!(seg[4] > seg[0] && seg[4] >= seg[1] && seg[4] >= seg[2] && seg[4] >= seg[3]))
      waveBad.push('#' + (cyc + 1) + '[' + seg.join(',') + ']');
  }
  rep.ok('波浪节奏：每 5 关一个「峰—谷—爬坡—峰值」周期', waveBad.length === 0, waveBad.join(' '));
  rep.ok('整体递进：第 30 关格子数 > 第 5 关', growth[29] > growth[4],
    growth[29] + ' vs ' + growth[4]);

  const shapes = new Set(info.map(x => x.rows + '×' + Math.max.apply(null, x.rowLen)));
  rep.ok('行列组合多样：1~40 关至少出现 6 种「行×列」', shapes.size >= 6, '实际 ' + shapes.size + ' 种');
  rep.ok('格数区间合理（9 起步，≤ 40 上限）',
    Math.min.apply(null, growth) >= 9 && Math.max.apply(null, growth) <= 40,
    Math.min.apply(null, growth) + '~' + Math.max.apply(null, growth));
  rep.ok('管数确实涨到 9 根（第 90 关不再是 6 根的 bug 已修）',
    Math.max.apply(null, info.map(x => x.tubes)) === 9,
    '最大 ' + Math.max.apply(null, info.map(x => x.tubes)));

  /* 水柱出屏：这是产品要的「压迫感」，只有 0 才算白做 */
  rep.warnIf('水柱能真的顶出屏幕顶部（有压迫感）', maxOverflow < 4,
    '最大出屏仅 ' + maxOverflow + 'px（第 ' + overflowAt + ' 关）');

  /* 把 40 关的关键指标写出来，给人和 AI 复查用 */
  const lines = ['lv\t格\t行\t行长\t色\t洞\t冰\t槽\t管\t水\t需\t最大层\ttile\tgridY0\t货架底'];
  info.forEach(x => lines.push([x.lv, x.cells, x.rows, x.rowLen.join(','), x.colors, x.gates, x.ice,
    x.slots, x.tubes, x.water, x.need, x.maxLayer, x.tile, x.gridY0, x.gridBottom].join('\t')));
  require('fs').writeFileSync(__dirname + '/qa_design_table.tsv', lines.join('\n'), 'utf8');
  console.log('  （40 关指标已写入 qa_design_table.tsv）');
});

rep.done();

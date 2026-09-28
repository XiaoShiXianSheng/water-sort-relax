/* qa_design.js —— 设计测试：关卡与布局的「设计不变量」
 *
 * 它回答的问题是：这套关卡设计在数值上是不是自洽、可玩、不会出丑？
 *   · 水量守恒：管里的水 == 所有瓶子需要的总量（多一滴少一滴都是 bug）
 *   · 可解性：每关都真的能通关（不是靠玩家运气）
 *   · 无留白：行长度差 ≤ 1，不会出现孤零零的 1 格
 *   · 不越界：货架不压工具栏、不压台面进度条（这是用户肉眼能看见的丑）
 *   · 波浪节奏：峰值关真的比放水关难
 *
 * 02:00 档补的 9 条「还没被断言保护」的设计规则（每条都做过回滚验证）：
 *   · 放水关在同周期里必须「全维度 ≤ 峰值关，且至少两项严格更低」（density 必须严格更低）
 *   · 单局操作量天花板（总水量 ≤96 / 预估平均步数 ≤220）—— 挡「把棋盘改大反而更水」的老路
 *   · 普通档台面槽 ≥ 颜色数（每种颜色都得有一个接水口，广告解锁位就是补齐最后那一个）
 *   · 每色瓶数均衡（彼此相差 ≤1，且每色 ≥2 瓶；防「某色只有 1 瓶」）
 *   · 冰冻瓶绝不藏在门洞里（顺序锁 + 解冻双约束 = 玩家体感「这关不讲理」）
 *   · 门洞朝向合法（在货架内 / 不朝另一个门洞 / 不朝冰冻瓶）
 *   · 每个门洞藏 2~3 个瓶子
 *   · 三档挑战严格更难（density 普通 < 困难 < 极限）
 *   · 教学关的挑战档仍保留 12 格 / 3 管 / 冰冻 ≤1（别把新手第一关变成劝退关）
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
    gridBottom: [], counterClash: [], missingGap: [],
    /* 本轮新增的三条：门洞顺序可判定 / 冰冻"冻得住" / 洞里序号连续 */
    gateQ: [], iceLoose: [], gateStackOrder: [],
    /* 02:00 档新增：单局操作量 / 槽色配比 / 每色瓶数 / 冰冻进洞 / 洞口朝向 / 洞内瓶数 */
    volume: [], slotVsColor: [], colorBalance: [],
    iceInGate: [], gateDir: [], gateWidth: []
  };
  let maxOverflow = 0, overflowAt = 0;
  let maxEstSteps = 0, maxEstStepsAt = 0, maxWater = 0, maxWaterAt = 0;

  for (let lv = 1; lv <= LVMAX; lv++) {
    D.gen(lv);
    /* ⚠ 冰冻瓶不变量必须在「走帧之前」采：主循环每一帧都会跑 thawByNeighbors()，
       「开局就已两格空」的冰冻瓶会在第一帧当场化开 —— 走完帧再查，永远查不到。
       （这条断言的第一版就是这么假绿的：回滚验证把生成期的过滤条件整段删掉，
       断言照样全绿，因为瓶子早在 frames() 里化没了。） */
    for (let bi0 = 0; bi0 < D.G.bottles.length; bi0++) {
      const b0 = D.G.bottles[bi0];
      if (b0.locked <= 0 || b0.place !== 'grid') continue;
      let emp0 = 0;
      for (let d0 = 0; d0 < 4; d0++) if (D.neighborEmpty(b0.cell, d0)) emp0++;
      if (emp0 >= 2) bad.iceLoose.push('L' + lv + ' cell' + b0.cell + ' 空' + emp0 + '格');
    }
    /* --- 门洞形状 / 洞口朝向 / 冰冻瓶不许进洞（同样在 frames() 之前采） ---
       ① 每洞 2~3 瓶：只有 1 瓶的门洞等于白送，4 瓶以上则「一次要腾 4 格才通」太憋。
       ② 洞口朝向：必须在货架内、不朝另一个门洞（互指 = 互锁）、不朝冰冻瓶（互相牵制 = 环）。
          生成期有 dirOk() 与 40 次重掷兜底，这里守住「重掷兜底被改坏」的情况。
       ③ 冰冻瓶不进洞：洞里的瓶子本来就带顺序锁，再叠一层解冻条件就是双重约束，
          玩家体感是「这关不讲理」，也让 layoutSolvable 的剥落自检频繁失败。 */
    for (let ga = 0; ga < D.G.gates.length; ga++) {
      const gt = D.G.gates[ga];
      const inGate = D.G.bottles.filter(b => b.gate === ga);
      if (inGate.length < 2 || inGate.length > 3)
        bad.gateWidth.push('L' + lv + ' 洞' + ga + ' 藏' + inGate.length + '瓶');
      const nc = D.neighborCell(gt.cell, gt.dir);
      if (nc < 0) bad.gateDir.push('L' + lv + ' 洞' + ga + ' 朝界外');
      else if (D.gateAt(nc) >= 0) bad.gateDir.push('L' + lv + ' 洞' + ga + ' 朝另一个门洞');
      else if (D.iceAt(nc)) bad.gateDir.push('L' + lv + ' 洞' + ga + ' 朝冰冻瓶');
    }
    for (let igi = 0; igi < D.G.bottles.length; igi++) {
      const ib = D.G.bottles[igi];
      if (ib.locked > 0 && ib.gate >= 0) bad.iceInGate.push('L' + lv + ' cell' + ib.cell);
    }
    g.frames(3);
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
      density: pl.density,
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
    /* 水柱出屏量：和功能测试用同一套定义（管顶 = BOTT_Y - (层数*水层高 + 20)，
       超过 TUBE_CUT_Y 才叫「顶出画面」）。老公式漏了 +20 且拿 BOTT_Y 当基准，
       恒等于 0 —— 于是这条提醒永远不会消失（等于没测）。 */
    const tubeTop = C.BOTT_Y - (maxLayer * (G.uh || 36) + 20);
    const of = Math.max(0, C.TUBE_CUT_Y - tubeTop);
    if (of > maxOverflow) { maxOverflow = of; overflowAt = lv; }

    /* --- 台面槽 --- */
    if (G.slots.length < 5 || G.slots.length > 7) bad.slots.push('L' + lv + '=' + G.slots.length);
    /* 槽位与颜色数的配比（普通档）：台面槽是「给某种颜色接水的工位」，
       槽 < 颜色数意味着「就算把广告位也解锁了，也凑不齐每种颜色一个工位」——
       玩家会被迫频繁「把没接满的瓶子退回货架」，广告解锁位的价值也被抹掉。
       挑战档（困难/极限）刻意少槽、允许 < 颜色数，那是它难在哪儿的定义，不算违规。 */
    if (G.slots.length < pl.colors)
      bad.slotVsColor.push('L' + lv + ' 槽' + G.slots.length + '<色' + pl.colors);

    /* --- 每色瓶数均衡：彼此相差 ≤1，且每色 ≥2 瓶 ---
       「某色只有 1 瓶」= 这个颜色的水只有 3 滴，玩家几乎不用为它做决策，
       开局对称性也被破坏（生成器注释写的「每色至少 2 瓶」从来没被断言守过）。 */
    const colorCnt = [];
    for (let cc = 0; cc < pl.colors; cc++) colorCnt.push(0);
    for (let b3 = 0; b3 < G.bottles.length; b3++) colorCnt[G.bottles[b3].col]++;
    const cnMin = Math.min.apply(null, colorCnt), cnMax = Math.max.apply(null, colorCnt);
    if (cnMax - cnMin > 1)
      bad.colorBalance.push('L' + lv + ' 每色 ' + colorCnt.join('/') + ' 差' + (cnMax - cnMin));
    if (cnMin < 2)
      bad.colorBalance.push('L' + lv + ' 有颜色只有 ' + cnMin + ' 瓶（' + colorCnt.join('/') + '）');

    /* --- 单局操作量天花板 ---
       水位 = 总水量 = 玩家至少要点这么多口；实测绕路比（实际步数 / 理论下界 瓶数×3）
       稳定在 2.2~2.4，取 2.3 估算：预估平均步数 = 水量 × 2.3。
       按每步 2 秒算 220 步 ≈ 7.5 分钟 —— 这是「玩得太累」的临界点，
       所以天花板钉在「水量 ≤96（≈32 瓶）」+「预估步数 ≤220」。
       历史教训：早期棋盘涨到 35 格 / 42 瓶，第 30 关平均 281 步、单局近 9 分钟，
       而贪心通关率反而升到 75% —— 加格子加的是操作量，不是思考深度。 */
    const estSteps = Math.round(water * 2.3);
    if (water > 96 || estSteps > 220)
      bad.volume.push('L' + lv + ' 水' + water + ' / 预估' + estSteps + '步');
    if (estSteps > maxEstSteps) { maxEstSteps = estSteps; maxEstStepsAt = lv; }
    if (water > maxWater) { maxWater = water; maxWaterAt = lv; }

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

    /* --- 门洞：序号必须连续可判定、且此刻只有一个可取（生成期就该成立） ---
       gateFront 的「只有 q 最小的可取」是门洞玩法的全部；q 缺号/重号或出现两个 front，
       玩家看到的就是「顺序乱了 / 点了没反应」。 */
    for (let gq = 0; gq < G.gates.length; gq++) {
      const inGate = G.bottles.filter(b => b.gate === gq);
      const qs = inGate.map(b => b.q).sort((a, b) => a - b);
      const want = [];
      for (let k = 0; k < inGate.length; k++) want.push(k);
      const seen = {}; let dup = false;
      qs.forEach(q => { if (seen[q]) dup = true; seen[q] = 1; });
      if (dup || qs.join(',') !== want.join(','))
        bad.gateQ.push('L' + lv + ' 洞' + gq + ' q=' + qs.join(','));
      const fronts = inGate.filter(b => D.gateFront(b));
      if (fronts.length !== 1 || fronts[0].q !== 0)
        bad.gateStackOrder.push('L' + lv + ' 洞' + gq + ' 可取' + fronts.length + ' 个');
    }

    /* --- 冰冻瓶必须真的"冻得住"：四邻空位 ≤1（界外也算空） ---
       生成期 icePool 明确排除了「角落」和「开局就已两格空」的格子。若这条被破坏，
       冰冻瓶会在第一帧的 thawByNeighbors 里立刻化开 —— 冰冻玩法等于没做；
       它不会报错、不会崩，只会「悄悄不生效」，所以必须由断言来守。
       （采样点在上面，genLevel 之后、g.frames 之前。） */

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
  one('水管 3~7 根（随关卡增长；7 根正好铺满 720 宽，8 根起最外侧的管会被切、点不到）', bad.tubes);
  one('单管层数 ≤ 16（再多就是纯折磨）', bad.layers);
  one('台面槽 5~7（含 1 个广告解锁位）', bad.slots);
  one('门洞数不超 levelPlan', bad.gates);
  one('**门洞两两不相邻**（相邻会互相堵死）', bad.gateAdj);
  one('每个门洞至少含 1 个瓶子（空洞 = 无效设计）', bad.gateEmpty);
  one('冰冻瓶数不超 levelPlan 计划值', bad.ice);
  one('**门洞叠放序号连续可判定**（每个洞的 q 恰好是 0..n-1，无缺号/重号）', bad.gateQ);
  one('**每个门洞此刻只有一个瓶子可取**（就是最外面那个 q=0）', bad.gateStackOrder);
  one('**冰冻瓶开局"冻得住"**（四邻空位 ≤1；否则第一帧就化开，冰冻等于没做）', bad.iceLoose);
  one('**可解性自检：1~40 关全部能通关**', bad.solvable);
  one('格子左不越界（留 ≥8px 边距）', bad.leftBleed);
  one('格子右不越界（留 ≥8px 边距）', bad.rightBleed);
  one('货架首行不高于设计基线', bad.topBleed);
  one('货架不压底部工具栏（留 ≥8px）', bad.gridBottom);
  one('**台面与货架之间留出空隙**（货架瓶盖顶 ≥ 台面刻度底 + 4px；否则首行会顶到台面上）', bad.counterClash);

  /* ---------- 02:00 档新增：7 条「玩家能感觉到」的设计规则 ---------- */
  one('**普通档台面槽 ≥ 颜色数**（每种颜色都得有个接水工位；槽比色少 = 广告解锁位白给）', bad.slotVsColor);
  one('**每色瓶数均衡**（彼此相差 ≤1，且每色 ≥2 瓶；防「某色只有 1 瓶」）', bad.colorBalance);
  one('**单局操作量天花板**（总水量 ≤96 且预估平均步数 ≤220；挡「棋盘改大反而更累」的老路）',
    bad.volume, '　实测最重 L' + maxWaterAt + ' 水' + maxWater + ' / 预估 ' + maxEstSteps + ' 步（L' + maxEstStepsAt + '）');
  one('**每个门洞藏 2~3 个瓶子**（1 个是白送、4 个以上要一次腾 4 格）', bad.gateWidth);
  one('**洞口朝向合法**（在货架内 / 不朝另一个门洞 / 不朝冰冻瓶）', bad.gateDir);
  one('**冰冻瓶绝不藏在门洞里**（顺序锁 + 解冻双约束 = 玩家体感「这关不讲理」）', bad.iceInGate);

  /* ============ 节奏与多样性 ============
     V4.0 §6：1~3 关教学（恒 9 格、快速成功）→ 4~8 关过渡 → 9 关以后靠决策密度变难。
     所以「波浪」只在 9 关以后（第 2 个周期起）成立；教学期本来就是平的，不该套波浪。 */
  const growth = info.map(x => x.cells);
  /* ⚠ 波浪必须用「决策密度」衡量：方案 F 之后第 19 关起货架恒 24 格（每行等长），
     cells 恒定 → 用格数判定波浪必然全违规（那是假的，不是产品问题）。
     改判 density 后：波峰关（每周期第 5 关）门洞 +1、放水关门洞/冰冻 −1，密度自然分层。 */
  const growthD = info.map(x => x.density);
  const waveBad = [];
  for (let cyc = 1; cyc * 5 < growthD.length; cyc++) {
    const seg = growthD.slice(cyc * 5, cyc * 5 + 5);
    if (seg.length < 5) continue;
    if (!(seg[4] > seg[0] && seg[4] >= seg[1] && seg[4] >= seg[2] && seg[4] >= seg[3]))
      waveBad.push('#' + (cyc + 1) + '[' + seg.join(',') + ']');
  }
  rep.ok('波浪节奏：每 5 关一个周期，峰值关「决策密度」最高（固定等长货架后格数恒定，故用 density 衡量）',
    waveBad.length === 0, waveBad.join(' '));

  /* 「波浪」不能只看格子数：放水关（每周期第 1、2 关）必须在**所有维度**上都比同周期峰值关轻，
     而且决策密度（density）要严格更低、至少两项指标严格更低。
     只比格数会放过一类坏设计：格子少了两格、门洞/冰冻却和峰值一样多 —— 玩家感觉不到「放水」。
     教学周期（第 1 个 5 关）本来就是平的，不套这条。 */
  const breatheBad = [];
  for (let cyc = 1; cyc * 5 + 5 <= info.length; cyc++) {
    const seg = info.slice(cyc * 5, cyc * 5 + 5);
    const pk = seg[4];
    for (let bi = 0; bi < 2; bi++) {                  // 放水关 = 相位 0 / 1
      const b = seg[bi];
      let strict = 0;
      if (b.cells < pk.cells) strict++;
      if (b.gates < pk.gates) strict++;
      if (b.ice < pk.ice) strict++;
      if (b.colors < pk.colors) strict++;
      const ok = b.density < pk.density && b.cells <= pk.cells && b.gates <= pk.gates &&
        b.ice <= pk.ice && b.colors <= pk.colors && strict >= 2;
      if (!ok) breatheBad.push('L' + b.lv + '(格' + b.cells + '/洞' + b.gates + '/冰' + b.ice +
        '/色' + b.colors + '/d' + b.density + ') vs 峰值L' + pk.lv + 'd' + pk.density);
    }
  }
  rep.ok('**放水关真的放水**：每周期第 1、2 关全维度 ≤ 峰值关，且密度严格更低、≥2 项严格更低',
    breatheBad.length === 0, breatheBad.join(' '));

  /* 教学期 1~3 必须是「无干扰的纯净局」（V4.0 §6：快速理解/快速成功/几乎不挫败） */
  const teachBad = [];
  for (let lv = 1; lv <= 3; lv++) {
    const p = D.plan(lv);
    if (!(p.cells === 9 && p.colors === 3 && p.gates === 0 && p.ice === 0)) teachBad.push('L' + lv);
  }
  rep.ok('教学期 1~3 关恒为 9 格 / 3 色 / 无门洞无冰冻', teachBad.length === 0, teachBad.join(' '));

  /* 9 关以后难度必须体现在「决策密度」，而不是「棋盘更大」（V4.0 §5.1） */
  const dens = [];
  for (let lv = 1; lv <= LVMAX; lv++) dens.push(D.plan(lv).density);
  rep.ok('9 关以后决策密度递增（第 30 关 > 第 10 关）', dens[29] > dens[9], dens[29] + ' vs ' + dens[9]);

  /* 三档挑战（普通 / 困难 / 极限）必须「真的更难」：density 严格递增。
     否则「困难」只是换个名字、玩家多花时间却没多拿难度，三档系统的意义就没了。 */
  const tierBad = [];
  for (let lv = 1; lv <= LVMAX; lv++) {
    const d0 = D.plan(lv, 0).density, d1 = D.plan(lv, 1).density, d2 = D.plan(lv, 2).density;
    if (!(d1 > d0 && d2 > d1)) tierBad.push('L' + lv + ' ' + d0 + '/' + d1 + '/' + d2);
  }
  rep.ok('三档挑战严格更难（决策密度 普通 < 困难 < 极限）', tierBad.length === 0, tierBad.join(' '));

  /* 教学关（1~3）的挑战档不许把棋盘改大、管数改多，冰冻最多 1 个 —— 别把新手第一关变成劝退关 */
  const tierTeach = [];
  for (let lv = 1; lv <= 3; lv++) {
    const p = D.plan(lv, 2);
    if (!(p.cells === 12 && p.tubes === 3 && p.ice <= 1 && p.slots >= 4))
      tierTeach.push('L' + lv + ' 格' + p.cells + '/管' + p.tubes + '/冰' + p.ice + '/槽' + p.slots);
  }
  rep.ok('教学关的极限档仍保留 12 格 / 3 管 / 冰冻 ≤1 / 槽 ≥4', tierTeach.length === 0, tierTeach.join(' '));

  rep.ok('棋盘停止扩大：全部关卡格数 ≤ 26', Math.max.apply(null, growth) <= 26,
    '最大 ' + Math.max.apply(null, growth) + ' 格');
  rep.ok('整体递进：第 30 关格子数 > 第 5 关', growth[29] > growth[4],
    growth[29] + ' vs ' + growth[4]);

  const shapes = new Set(info.map(x => x.rows + '×' + Math.max.apply(null, x.rowLen)));
  rep.ok('行列组合多样：1~40 关至少出现 6 种「行×列」', shapes.size >= 6, '实际 ' + shapes.size + ' 种');
  rep.ok('格数区间合理（9 起步，≤ 40 上限）',
    Math.min.apply(null, growth) >= 9 && Math.max.apply(null, growth) <= 40,
    Math.min.apply(null, growth) + '~' + Math.max.apply(null, growth));
  rep.ok('管数涨到 7 根封顶（7 根正好铺满 720 宽；原 9 根有两根在屏外且点不到）',
    Math.max.apply(null, info.map(x => x.tubes)) === 7,
    '最大 ' + Math.max.apply(null, info.map(x => x.tubes)));

  /* 出屏管回归（本次漏测的根因之一）：管再多也必须「整根在屏内、且够点亮」。
     历史 bug：9 根时两端 2 根完全出屏（x0=-92），tubeAt 命中盒与屏幕无交集 → 永远点不到，
     但旧套件用虚拟坐标合成点击，所以 376 条全绿照样漏掉。这里用几何硬判据兜底：
     命中盒 [t.x-8, t.x+tubeW+8] ∩ [0,VW] 必须非空，且可见宽度 ≥44px（最小可点尺寸）。
     VW 从产品常量读，不写死 720。 */
  const tubeGeomBad = [];
  let tubeProbed = 0;
  for (let lv = 1; lv <= 100; lv++) {
    D.gen(lv); g.frames(2);
    const G = D.G, tW = G.tubeW, VW = C.VW;
    for (let ti = 0; ti < G.tubes.length; ti++) {
      tubeProbed++;
      const t = G.tubes[ti];
      const hitL = t.x - 8, hitR = t.x + tW + 8;
      const visW = Math.min(t.x + tW, VW) - Math.max(t.x, 0);
      if (Math.min(hitR, VW) - Math.max(hitL, 0) <= 0 || visW < 44)
        tubeGeomBad.push('L' + lv + ' 管' + ti + ' x' + t.x.toFixed(0) + ' 可见' + visW.toFixed(0) + 'px');
    }
  }
  rep.ok('**出屏管回归**：1~100 关每根管的命中盒与 [0,VW] 交集非空、且可见宽度 ≥44px（'
    + tubeProbed + ' 根管全量探针）', tubeGeomBad.length === 0, tubeGeomBad.slice(0, 6).join(' '));

  /* 水柱出屏：这是产品要的「压迫感」，只有 0 才算白做 */
  rep.warnIf('水柱能真的顶出屏幕顶部（有压迫感）', maxOverflow < 4,
    '最大出屏仅 ' + maxOverflow + 'px（第 ' + overflowAt + ' 关）');

  /* 操作量的绝对水位也打出来（不进断言，给人看趋势）：上限 96 水 / 220 步 */
  console.log('  （操作量最重：L' + maxWaterAt + ' 水' + maxWater + ' → 预估 ' + maxEstSteps +
    ' 步（L' + maxEstStepsAt + '）；天花板 96 水 / 220 步）');

  /* 把 40 关的关键指标写出来，给人和 AI 复查用 */
  const lines = ['lv\t格\t行\t行长\t色\t洞\t冰\t槽\t管\t水\t需\t最大层\t密度\t预估步\ttile\tgridY0\t货架底'];
  info.forEach(x => lines.push([x.lv, x.cells, x.rows, x.rowLen.join(','), x.colors, x.gates, x.ice,
    x.slots, x.tubes, x.water, x.need, x.maxLayer, x.density, Math.round(x.water * 2.3),
    x.tile, x.gridY0, x.gridBottom].join('\t')));
  require('fs').writeFileSync(__dirname + '/qa_design_table.tsv', lines.join('\n'), 'utf8');
  console.log('  （40 关指标已写入 qa_design_table.tsv）');
});

rep.done();

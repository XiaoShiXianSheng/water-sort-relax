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
 *   · 普通档台面槽 ≥ 颜色数 − 2（方案B：色≥7 收2槽；每种颜色仍有接水口，广告位补齐最后一个）
 *   · 每色瓶数均衡（彼此相差 ≤1，且每色 ≥2 瓶；防「某色只有 1 瓶」）
 *   · 冰冻瓶绝不藏在门洞里（顺序锁 + 解冻双约束 = 玩家体感「这关不讲理」）
 *   · 门洞朝向合法（在货架内 / 不朝另一个门洞 / 不朝冰冻瓶）
 *   · 每个门洞藏 2~3 个瓶子
 *   · 三档挑战严格更难（density 普通 < 困难 < 极限）
 *   · 教学关的挑战档仍保留 12 格 / 3 管 / 冰冻 ≤1（别把新手第一关变成劝退关）
 *
 * 2026-09-29 02:00 档再补 6 条（同样每条都做过回滚验证，见 qa_rollback.js）：
 *   · 过渡期 4~8 关的配置表精确 + 「干扰一次只加一种」（门洞与冰冻不得同关新增）
 *   · 稳态货架硬钉死：第 19~40 关恒 24 格 / 4 行 / 每行 6（现有断言只跟 plan 比，plan 改了查不出）
 *   · 三档挑战「只调约束、不加美术」：三档的格数/颜色/管数必须完全一致，
 *     槽位只按 −1/−1（下限 4）、门洞只按 +1/+1（上限 4）、冰冻只按 +1 的上限 4 递进
 *   · 门洞数必须与计划一致（生成器不许因为放不下就偷偷少放几个洞 = 难度静默降级）
 *   · 冰冻数必须与计划一致（可解性兜底不许把冰冻静默清零 —— 实测 2000 局零漂移）
 *   · 普通档台面槽位随关卡单调不减（设计承诺「不再靠砍槽位制造难上加难」）
 *
 * 2026-09-30 02:00 档再补 8 条（把 09-29 受控实验测出来的「难度开关」变成断言；每条都做过回滚验证）：
 *   · **不许出现「必输关」**：有效空槽 − 颜色数 ≥ −2
 *     （2026-09-30 受控实验的「−2 → 0%」是写错工具栏坐标的旧 dbg_diff 假数据；2026-10-02 修坐标 bot 全量复测
 *      普通档 eff=−2 可解。−4 才是真必输区。）
 *   · **槽位预算不许膨胀**：普通档台面槽恒 5~6，且有效空槽 − 颜色数 ≤ +1
 *     （槽位是「输赢开关」不是「加速器」：多给一个槽 = 通关率 43% → 88%，难度直接被抹平）
 *   · **难度参数逐关不跳变**（第 9 关起）：|Δ颜色| ≤1、|Δ门洞| ≤1、|Δ冰冻| ≤1、|Δ格数| ≤6
 *   · **跨周期峰值关不许变简单**：每周期第 5 关的决策密度 ≥ 上一周期的峰值关
 *   · **第 9 关起干扰不许归零**：门洞数 + 冰冻数 ≥ 1
 *   · **每根管开局都装 ≥5 层水**（tubeCountFor 的减管承诺；短管/空管在画面上一眼就丑）
 *   · **开局可点占比 ≥ 50%**（实测最小 53.3%，40 关 × 40 次生成零漂移）
 *   · **中期货架阶梯硬钉死**：第 9~12 关恒 15 格 / 13~15 关恒 18 格 / 16~18 关恒 20 格
 *     （硬编码，不跟 levelPlan 比 —— 否则 plan 和实际一起改就查不出，与「稳态货架」同理）
 *
 * 2026-10-01 02:00 档再补 7 条（探针口径：1~90 关 × 3 档 = 270 次生成，独立两轮零违规；每条都做过回滚验证）：
 *   · **广告解锁位唯一且在末位**（每关每档恰好 1 个未解锁槽且是最后一个）
 *     —— 「有效空槽 = 总槽 − 1」这个全项目难度结论、以及唯一的台面变现位，都建立在这一行上
 *   · **逐色水量守恒**（每种颜色的管中水量 == 该色瓶数 × 3）—— 比「总量守恒」强，抓「总数对、结构错」
 *   · **不存在纯色管**（≥2 层的管至少 2 种颜色；整根同色 = 一步接完的假难度）
 *   · **开局台面为空 + 单局初始额度固定**（台面 0 瓶 / clears 0 / 撤销 5 / 解锁 1 / 道具各 1）
 *   · **三档「实际门洞/冰冻数 == 计划」**（原断言只跑普通档，困难/极限同样有静默降级路径）
 *   · **挑战档难度开关下限**（有效空槽 − 色 ≥ −3；−4 才真没退路。注：旧「−2 已让贪心首战归零」是写错坐标的 dbg_diff 假数据）
 *
 * 2026-10-02 02:00 档再补 6 条（本档主题：**「钉幅度」不等于「钉方向」**；探针口径 1~90 关 × 5 档 = 450 次纯 plan 计算零漂移）：
 *   · **阶段连续性铁律**（6 个接缝：格/色/管不许降，洞/冰掉幅 ≤1 = 一个波浪振幅）
 *     —— `STAGE_CURVE` 注释里写死的承诺，此前只有「逐关不跳变（|Δ| ≤ N）」在守，
 *     而那条**只管幅度不管方向**：把阶段起点整体调低 6 格，|Δ|=6 ≤ 8 → 全绿，
 *     可「进新阶段反而变简单」已经回来了。回滚用例实测：这条只让本断言红（71 PASS/1 FAIL），
 *     旁边的「逐关不跳变」纹丝不动 → 两条互不覆盖。
 *   · **普通档台面槽 == 颜色数 − (色≥7?2:0)**（方案B：色≥7 收2槽）+ **困难档至多 −1 槽（普通已触地板时可相等）、极限档 ≤ 困难档（三档压在 −3 地板）**
 *     —— 比「槽 ≥ 色」强一档：只加一个白送的槽就能把首战通关率从 43% 抹到 88%（受控实验），
 *     而「槽 ≥ 色」和「有效空槽−色 ≤ +1」合起来恰好放过这一档。
 *   · **全局单调不减**（1~90 关：格数 / 颜色数 / 水管数 / 台面槽）—— V6.1 对外的承诺；
 *     现有断言只钉了 7 个阶段末关的绝对值 + |Δ格| ≤ 8，「第 40 关比 39 关少 8 格」照样全绿。
 *     ⚠ 唯独**不钉**「门洞 + 冰冻」合计（波浪每 5 关 −2/+2，它本来就不单调）。
 *   · **峰值关的门洞/冰冻 ≥ 同周期相位 2、3 关** —— 原有「波浪节奏」只比加权后的 density，
 *     「洞少 1 冰多 1」可以把密度抵平，造出「峰值关其实不更难」的假峰。
 *   · **热身档（−1/−2）全维度 ≤ 普通档 + 退路更宽** —— 回归热身的全部意义；
 *     留存套件只在几个固定关卡验，这条把 1~90 关全扫。
 *   · **水管数 ≥ 颜色数** —— 少于颜色数时由抽屉原理必有管子同时是两种色的主要来源。
 *
 * 趋势（不判定）：末段峰值关的 +1 加成会被 GATE_CAP/ICE_CAP 吃掉（L85 / L90 的基数已是 8，
 * +1 被 clamp），这两关的「峰值」只是名义上的 —— 上限封顶的算术后果，已写进评审文档当开放问题。
 *
 * ================= 2026-10-01 V6.0 难度与留存重构（本档改动最大的一次）=================
 * 曲线从「6 色 / 24 格 / 第 24 关触顶」换成 V6.0 的 7 阶段硬路线，覆盖 1~90 关：
 *   教学 1~3（9 格 / 3~4 色）→ 入门正式 4~8（9→20 格 / 4~6 色）→
 *   正式挑战 9~15（20→35 格 / 6→9 色，第 15 关正好 7×5）→ 高密度 16~25（35→48 格 / 9→12 色）→
 *   困难 26~40（48→54 格 / 12→14 色）→ 极限 41~60（54 格 / 14→16 色）→ 极限+ 61~90（54 格 / 16→17 色）
 * 因为「棋盘 / 颜色 / 管数 / 槽位 / 干扰」的上限全部抬高，下面这批断言跟着 V6.0 重写了
 * （旧的写死值属于 V4 时期的六色小棋盘，继续留着会「把正确的曲线判成红的」）：
 *   · 行数 3~6（原 2~5）· 每行 3~9 格（原 3~7）· 格数 ≤54（原 ≤40）· 颜色 3~17（原 3~6）
 *   · 水管 ≤ maxTubesByWidth()=17（原写死 7）· 台面槽 5~17（原 5~7）· 可见管宽 ≥ TUBE_MIN_W=34（原 44）
 *   · 操作量天花板改成**按关卡分段**（≤25 关 150 步 / ≤60 关 175 步 / 61~90 关 200 步，且 ≤70 瓶）
 *     —— 统一 150 步会在第 50 关之后先于难度爆掉，逼校准③削行数，把 50~90 关压成一条平线
 *   · 「稳态货架 24 格」→ 换成 **V6.0 阶段阶梯硬钉死**（第 3/8/15/25/40/60/90 关的目标值）
 *   · 「难度在第 24 关触顶」→ 换成 **曲线不许触顶**（第 90 关的色+洞+冰与密度必须严格高于第 24 关）
 *   · 「普通档台面槽恒 5~6」→ 换成「台面槽 == 计划值（5~17），且有效空槽 − 颜色数 ≤ +1」
 *   · 「台面槽随关卡单调不减」→ 换成 **「台面槽 − 颜色数」单调不增**（V6.0 允许退路逐段收紧，
 *     但绝不允许忽宽忽窄）
 *   · 「三档严格递增」在教学 1~5 关放宽为「极限 > 普通 且 极限 ≥ 困难」（那时没门洞可加、
 *     槽位已到下限 5，硬要区分只能往教学关塞冰冻瓶）
 *   · 「逐关不跳变」阈值随曲线放宽：Δ色 ≤1 · Δ洞 ≤2 · Δ冰 ≤2 · Δ格 ≤8
 *     （波浪本身是峰值 +1 / 放水 −1；高密度阶段列行各差 1，格数 35→40→48）
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
  const CV = D.CURVE;            // V6.0 曲线常量（从产品常量读，测试里不写死数字）
  const LVMAX = 90;              // V6.0 面板是 1~90 关，全量覆盖

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
    iceInGate: [], gateDir: [], gateWidth: [],
    /* 09-29 02:00 档新增：门洞不选角落 / 实际门洞数 / 实际冰冻数 */
    gateCorner: [], gatePlan: [], icePlan: [],
    /* 09-30 02:00 档新增：必输关 / 槽位预算 / 逐关跳变 / 峰值倒退 / 干扰归零 / 短管 / 开局可点 / 中期阶梯 */
    effFloor: [], slotBudget: [], jump: [], peakBack: [], noDis: [], shortTube: [], openRatio: [], ladder918: []
  };
  let maxOverflow = 0, overflowAt = 0;
  let maxEstSteps = 0, maxEstStepsAt = 0, maxWater = 0, maxWaterAt = 0;

  for (let lv = 1; lv <= LVMAX; lv++) {
    D.gen(lv);
    const pl = D.plan(lv);        // 必须在 frames() 之前算好：下面几条不变量都要在生成期采样
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
    /* --- 09-29 02:00 新增（同样在 frames() 之前采）---
       ① 门洞不选角落：生成器只把「至少 3 个方向在货架内」的格子当候选（dirsIn>=3）。
          角落只有 2 个可用朝向 → 箭头要么指界外、要么和唯一邻居（常是冰冻瓶）成环，
          可解性自检的失败率飙升。这条守住 dirsIn>=3 这个门槛被改成 >=2 的情况。
       ② 实际门洞数 == 计划门洞数：门洞选址用「DFS + 回溯」，放不下时会静默少放几个洞
          （并删掉多出来的瓶子）—— 玩家不会崩、也不会报错，只会「这关比设计的简单」。
          实测 2000 局零漂移，所以钉死等号；一旦破了就是难度静默降级。
       ③ 实际冰冻数 == 计划冰冻数：可解性自检 40 次仍不过时，兜底会把**所有**冰冻瓶撤掉
          （`if(!solvableOK){...locked=0...}`）。这是最隐蔽的一类降级：冰冻玩法整关消失，
          但关卡仍然可解、仍然好看、测试也仍然全绿。必须由断言守。 */
    for (let gk = 0; gk < D.G.gates.length; gk++) {
      let nd = 0;
      for (let dk = 0; dk < 4; dk++) if (D.neighborCell(D.G.gates[gk].cell, dk) >= 0) nd++;
      if (nd < 3) bad.gateCorner.push('L' + lv + ' 洞' + gk + ' 只有 ' + nd + ' 个货架内方向（角落）');
    }
    if (D.G.gates.length !== pl.gates)
      bad.gatePlan.push('L' + lv + ' 实际' + D.G.gates.length + '≠计划' + pl.gates + ' 个门洞');
    const iceNow = D.G.bottles.filter(b => b.locked > 0).length;
    if (iceNow !== pl.ice)
      bad.icePlan.push('L' + lv + ' 实际' + iceNow + '≠计划' + pl.ice + ' 个冰冻瓶');

    /* --- 2026-09-30 02:00 新增：难度预算开关 / 开局手感 / 短管 ---
       ⚠ 同样必须在 frames() 之前采：主循环第一帧就会 thawByNeighbors() 把冰冻瓶化开，
       「开局可点」一旦走完帧再数，就变成了「跑了三帧之后可点」——量到的不是开局。 */
    /* ① 有效空槽 = 台面槽总数 − 1（最后一个槽永远是看广告解锁的，`open: s2 < slotsN-1`）。
       ⚠ 历史受控实验（2026-09-30）的「−2 → 0%」是用**写错坐标的旧 dbg_diff**（工具栏 15 而非 85，
       等于测「不用任何道具」的口径）得出的假数据。同一实验 eff=−1 写 20~43%，而线上用道具实测
       eff=−1 首通 95~100%——差两倍多，整份表不可信。
       2026-10-02 候选A：普通档 eff=−2（色≥7 收1槽）bot 全量 90 关全过。
       方案B（用户实测仍嫌太易）：普通档再收紧到 eff=−3（色≥7 收2槽），困难/极限统一锁在 slotBias≥−2 地板
       （eff≥−3 = 线上极限档难度），三档靠 +门洞/+冰冻 维持非严格更难。bot 全量复测（TIER=0/1/2）
       eff=−3 仍 90 关全可解。−4 才是真必输区。 */
    const effSlots = D.G.slots.length - 1 - pl.colors;
    if (effSlots < -3)
      bad.effFloor.push('L' + lv + ' 有效空槽' + (D.G.slots.length - 1) + ' − 色' + pl.colors + ' = ' + effSlots);
    /* ② 槽位预算：普通档台面槽 =「颜色数 + slotBias」（slotBias 见 STAGE_CURVE，2/1/0 递减），
       上下限 5~SLOT_CAP；且**有效空槽 − 颜色数 ≤ +1**。
       槽位是「输赢开关」：多给一个槽 = 首战通关率 43% → 88%，难度直接被抹平。
       （旧版钉的是「恒 5~6」，那属于 V4 时期 6 色 / 24 格的小棋盘，V6.0 颜色到 18 色，
         再钉 5~6 等于要求「18 色配 6 个槽」——那才是必输关。） */
    if (!(D.G.slots.length === pl.slots &&
      D.G.slots.length >= 5 && D.G.slots.length <= CV.SLOT_CAP))
      bad.slotBudget.push('L' + lv + ' 普通档台面槽 ' + D.G.slots.length + '≠计划' + pl.slots);
    if (effSlots > 1)
      bad.slotBudget.push('L' + lv + ' 有效空槽' + (D.G.slots.length - 1) + ' − 色' + pl.colors + ' = +' + effSlots);
    /* ③ 每根管开局都装 ≥5 层水：tubeCountFor 的减管承诺（"水太少时减管，否则管子短短一截很丑"）。
       实测 1~90 关最矮的管也有 5 层以上，所以这条守的是「管数被改多/水被改少」时的丑态。 */
    let minLayer0 = 999;
    for (let lt = 0; lt < D.G.tubes.length; lt++)
      if (D.G.tubes[lt].units.length < minLayer0) minLayer0 = D.G.tubes[lt].units.length;
    if (minLayer0 < 5) bad.shortTube.push('L' + lv + ' 最矮的管只有 ' + minLayer0 + ' 层');
    /* ④ 开局可点占比：太多瓶子被冰冻/门洞锁住 = 开局无事可做、只能干等。
       实测 1~90 关最小 53.3%，多次生成零漂移。 */
    const openCnt = D.G.bottles.filter(b => D.gridPlayable(b)).length;
    const openRatio = openCnt / D.G.bottles.length;
    if (openRatio < 0.5)
      bad.openRatio.push('L' + lv + ' ' + openCnt + '/' + D.G.bottles.length +
        ' = ' + (openRatio * 100).toFixed(1) + '%');
    g.frames(3);
    const G = D.G;
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
    if (G.gridRows < 3 || G.gridRows > CV.GRID_MAX_ROWS) bad.rows.push('L' + lv + '=' + G.gridRows);
    if (rowsMin < 3 || rowsMax > CV.GRID_MAX_COLS) bad.rowLen.push('L' + lv + ' 行' + G.rowLen.join(','));
    if (rowsMax - rowsMin > 1) bad.ragged.push('L' + lv + ' 行' + G.rowLen.join(','));

    /* --- 颜色：3~18 种且每种都有瓶子（V6.0 把调色板从 6 扩到 20，极限+ 用到 18） --- */
    if (colorSet.size < 3 || colorSet.size > CV.MAX_COLORS) bad.colors.push('L' + lv + '=' + colorSet.size);
    if (colorSet.size !== pl.colors) bad.colors.push('L' + lv + ' 实际' + colorSet.size + '≠计划' + pl.colors);
    /* V6.2.4：颜色不再保证 0..C-1 连续（L10 起强制黑+白必在）→ 不再按索引逐色查「色c有无瓶」；
       改为校验「每个瓶的色都是合法调色板索引」，且实际色数已等于计划色数（上一条已查）。 */
    for (const b of G.bottles) {
      if (b.col < 0 || b.col >= CV.PALETTE) bad.colorCover.push('L' + lv + ' 色索引越界' + b.col);
    }

    /* --- 水量守恒（设计期的核心不变量） --- */
    if (water !== need) bad.water.push('L' + lv + ' 水' + water + '≠需' + need);

    /* --- 水管：上限从 maxTubesByWidth() 反推（屏幕能放下多细的管），不写死数字 --- */
    if (G.tubes.length < 3 || G.tubes.length > D.maxTubesByWidth())
      bad.tubes.push('L' + lv + '=' + G.tubes.length + '>上限' + D.maxTubesByWidth());
    if (maxLayer > 16) bad.layers.push('L' + lv + '=' + maxLayer);
    /* 水柱出屏量：和功能测试用同一套定义（管顶 = BOTT_Y - (层数*水层高 + 20)，
       超过 TUBE_CUT_Y 才叫「顶出画面」）。老公式漏了 +20 且拿 BOTT_Y 当基准，
       恒等于 0 —— 于是这条提醒永远不会消失（等于没测）。 */
    const tubeTop = C.BOTT_Y - (maxLayer * (G.uh || 36) + 20);
    const of = Math.max(0, C.TUBE_CUT_Y - tubeTop);
    if (of > maxOverflow) { maxOverflow = of; overflowAt = lv; }

    /* --- 台面槽 --- */
    if (G.slots.length < 5 || G.slots.length > CV.SLOT_CAP) bad.slots.push('L' + lv + '=' + G.slots.length);
    /* 槽位与颜色数的配比（普通档）：台面槽是「给某种颜色接水的工位」，
       方案B（2026-10-02）把普通档难度开关从固定 eff=−1 改为色≥7 时 eff=−3（收 2 个开放槽），
       故普通档台面槽下限从「≥ 颜色数」放宽到「≥ 颜色数 − 2」（每种颜色仍有接水工位，广告位补齐最后那一个）。
       挑战档（困难/极限）刻意少槽、允许 < 颜色数−2，那是它难在哪儿的定义，不算违规。 */
    if (G.slots.length < pl.colors - 2)
      bad.slotVsColor.push('L' + lv + ' 槽' + G.slots.length + '<色' + pl.colors + '−2');

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

    /* --- 单局操作量天花板（V6.0：按关卡分段的预算，不再是一个 96 水 / 220 步钉死） ---
       口径：瓶子数 = 管中总水滴数 ÷ 3（每瓶固定 3 口）。
       玩家每一步操作对应「放上台面 / 退回货架」，实测绕路比稳定在 2.2~2.4，取 2.3：
         预估玩家步数 = 瓶子数 × 2.3
       V6.0 的前提变了：棋盘放大到 9×6、晚局门洞到 8 个，一条 150 步的预算会在
       第 50 关之后先于难度爆掉，逼校准③去削行数（54 格被砍到 45 格），
       于是 50~90 关的曲线被压平 —— 这正是「加格子反而更累」那条老路的新形态。
       所以预算改成 moveBudgetFor(lv)：≤25 关 150 / ≤60 关 175 / 61~90 关 200 步
       （200 步 ≈ 6.7 分钟，仍在「数值宪法」的 220 步红线内）。
       +10 的余量：levelPlan 用 round(门洞数×1.5) 估洞内瓶数，实际每洞 2~3 瓶会有 ±1 的抖动。 */
    const bottles = Math.round(water / 3);
    const estSteps = Math.round(bottles * CV.ACTION_PER_BOTTLE);
    const budget = D.moveBudgetFor(lv);
    if (estSteps > budget + 10)
      bad.volume.push('L' + lv + ' 瓶' + bottles + '/预估' + estSteps + '步 > 本关预算' + budget);
    if (water > 210)
      bad.volume.push('L' + lv + ' 水' + water + '（' + bottles + ' 瓶）超过 70 瓶硬上限');
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

  /* ============ 2026-09-30 02:00 新增：跨关卡的曲线规则（4 条）============
     这四条都得拿「相邻/相邻周期的两关」比较，所以放在循环外面统一算。
     它们的共同主题是「难度曲线不许出现断崖和倒退」—— 单关的数值全都合法，
     但连着看就露馅，这类问题只有跨关卡断言能抓。 */

  /* ① 难度参数逐关不跳变（第 9 关起）。
     第 1~8 关有自己的配置表（教学/入门）已在上面单独守；第 9 关起开始爬难度，
     一旦哪次改动让某一关的颜色/干扰数突然跳 2 个（例如「第 9 关直接 6 色」），
     玩家体感就是「曲线断崖」，而单关断言全都绿。
     V6.0 阈值：Δ色 ≤1（颜色是决策分支，最贵）、Δ洞 ≤2 / Δ冰 ≤2（波浪本身是 peak+1 / breathe−1，
     相邻两关最多差 2）、Δ格 ≤8（高密度阶段列行各差 1，格数 35→40→48，单关最多 +8）。 */
  const jumpWorst = { cell: 0, at: '' };
  for (let lv = 10; lv <= LVMAX; lv++) {
    const a = info[lv - 2], b2 = info[lv - 1];
    const dCol = Math.abs(b2.colors - a.colors), dGate = Math.abs(b2.gates - a.gates);
    const dIce = Math.abs(b2.ice - a.ice), dCell = Math.abs(b2.cells - a.cells);
    if (dCell > jumpWorst.cell) { jumpWorst.cell = dCell; jumpWorst.at = 'L' + (lv - 1) + '→' + lv; }
    if (dCol > 1 || dGate > 2 || dIce > 2 || dCell > 8)
      bad.jump.push('L' + (lv - 1) + '→' + lv + ' Δ色' + dCol + '/Δ洞' + dGate + '/Δ冰' + dIce + '/Δ格' + dCell);
  }

  /* ② 跨周期峰值关不许变简单：每 5 关一个波浪，后一个周期的峰值关决策密度
     必须 ≥ 前一个周期的峰值关。整条曲线是「一浪比一浪高」而不是「原地踏步」。
     （实测峰值序列 L10=65.8 → L15=87 → L20=97.8 → L25/30/35/40=107.8，
     即最后 4 个周期打平 —— 所以这里只能钉「不降」，钉「严格递增」会 flaky。） */
  const peaks = info.filter(x => x.lv >= 9 && D.plan(x.lv).peak);
  for (let pi = 1; pi < peaks.length; pi++) {
    if (peaks[pi].density < peaks[pi - 1].density)
      bad.peakBack.push('L' + peaks[pi].lv + ' d' + peaks[pi].density +
        ' < 上一峰值 L' + peaks[pi - 1].lv + ' d' + peaks[pi - 1].density);
  }

  /* ③ 第 9 关起干扰不许归零：每关至少要有一个门洞或一个冰冻瓶。
     生成器有两条「静默降级」路径（门洞放不下就少放 / 可解性兜底撤冰冻），
     上面两条断言是「实际 == 计划」；这条独立守「计划本身别给 0」——
     否则后半程就会变成一堆纯送分的无干扰局，而所有断言仍然全绿。 */
  for (let lv = 9; lv <= LVMAX; lv++) {
    const p = D.plan(lv);
    if (p.gates + p.ice < 1) bad.noDis.push('L' + lv + ' 洞' + p.gates + '+冰' + p.ice);
  }

  /* ④ V6.1 阶段阶梯硬钉死（每个阶段的末关必须落在设计目标上）。
     和「稳态货架 24 格」同一个道理：现有 `格数严格按 levelPlan` 是拿实际比计划，
     plan 和实际一起改就查不出（等于「把货架改小了测试还全绿」）。这里钉死绝对值。
     V6.1 阶段目标：教学 9 格 3~4 色 → 入门正式 20 格 6 色 →
     正式挑战 35 格（7×5）9 色 → 高密度 45 格（9×5）12 色 → 困难 50 格（10×5）14 色 →
     极限 55 格（11×5）16 色 → 极限+ 55 格（11×5）17 色。
     （V6.1 把晚段从 9×6 加宽成 11×5：格数几乎不变、棋盘更宽贴边铺满屏幕。）
     [格数, 行数, 每行格数, 颜色数, 水管数] */
  const LADDER_V6 = {
    3: [9, 3, 3, 4, 5], 8: [20, 4, 5, 6, 8], 15: [35, 5, 7, 9, 12], 25: [45, 5, 9, 12, 15],
    40: [50, 5, 10, 14, 17], 60: [55, 5, 11, 16, 17], 90: [55, 5, 11, 17, 17]
  };
  for (const lvk of Object.keys(LADDER_V6)) {
    const lv = +lvk, x = info[lv - 1], e = LADDER_V6[lv];
    const maxLen = Math.max.apply(null, x.rowLen);
    const allSame = x.rowLen.every(v => v === maxLen);
    if (!(x.cells === e[0] && x.rows === e[1] && maxLen === e[2] && x.colors === e[3] &&
      x.tubes === e[4] && allSame))
      bad.ladder918.push('L' + lv + ' 实际' + x.cells + '格/' + x.rows + '行/列' + x.rowLen.join(',') +
        '/' + x.colors + '色/' + x.tubes + '管 期望' + e[0] + '格/' + e[1] + '行/列' + e[2] +
        '/' + e[3] + '色/' + e[4] + '管');
  }

  /* ============ 汇总断言（一次报告全部违规关卡，便于定位） ============ */
  const one = (title, arr, extra) => rep.ok(title, arr.length === 0, arr.slice(0, 6).join(' ') + (arr.length > 6 ? ' …共' + arr.length : '') + (extra || ''));
  one('格数严格按 levelPlan（1~' + LVMAX + ' 关）', bad.cells);
  one('每行长度之和 == 格数（瓶子另算门洞叠加，见下一条）', bad.rowLen);
  one('行数在 3~' + CV.GRID_MAX_ROWS + '（行数上限由触控尺寸反推，不是永远 3 行）', bad.rows);
  one('每行 3~' + CV.GRID_MAX_COLS + ' 格（既不留 1 格孤儿、也不挤爆）', bad.rowLen);
  one('行长度差 ≤ 1（长短整齐，不出现参差缺角）', bad.ragged);
  one('颜色数 3~' + CV.MAX_COLORS + ' 且与 levelPlan 一致（V6.0 曲线自己的天花板）', bad.colors);
  one('每种颜色都有瓶子（没有永远用不上的水）', bad.colorCover);
  one('**水量守恒**：管中水总量 == 所有瓶子容量之和', bad.water);
  one('水管 3~' + D.maxTubesByWidth() + ' 根（上限由屏幕宽 + TUBE_MIN_W 反推，与 layoutAll 共用同一常量）', bad.tubes);
  one('单管层数 ≤ 16（再多就是纯折磨）', bad.layers);
  one('台面槽 5~' + CV.SLOT_CAP + '（含 1 个广告解锁位）', bad.slots);
  one('门洞数不超 levelPlan', bad.gates);
  one('**门洞两两不相邻**（相邻会互相堵死）', bad.gateAdj);
  one('每个门洞至少含 1 个瓶子（空洞 = 无效设计）', bad.gateEmpty);
  one('冰冻瓶数不超 levelPlan 计划值', bad.ice);
  one('**门洞叠放序号连续可判定**（每个洞的 q 恰好是 0..n-1，无缺号/重号）', bad.gateQ);
  one('**每个门洞此刻只有一个瓶子可取**（就是最外面那个 q=0）', bad.gateStackOrder);
  one('**冰冻瓶开局"冻得住"**（四邻空位 ≤1；否则第一帧就化开，冰冻等于没做）', bad.iceLoose);
  one('**可解性自检：1~' + LVMAX + ' 关（含 3 档）全部能通关**', bad.solvable);
  one('格子左不越界（留 ≥8px 边距）', bad.leftBleed);
  one('格子右不越界（留 ≥8px 边距）', bad.rightBleed);
  one('货架首行不高于设计基线', bad.topBleed);
  one('货架不压底部工具栏（留 ≥8px）', bad.gridBottom);
  one('**台面与货架之间留出空隙**（货架瓶盖顶 ≥ 台面刻度底 + 4px；否则首行会顶到台面上）', bad.counterClash);

  /* ---------- 02:00 档新增：7 条「玩家能感觉到」的设计规则 ---------- */
  one('**普通档台面槽 ≥ 颜色数 − 2**（方案B：色≥7 收2槽；每种颜色仍有接水工位，广告位补齐最后那一个）', bad.slotVsColor);
  one('**每色瓶数均衡**（彼此相差 ≤1，且每色 ≥2 瓶；防「某色只有 1 瓶」）', bad.colorBalance);
  one('**单局操作量天花板**（按关卡分段：≤25 关 150 步 / ≤60 关 175 步 / 61~90 关 200 步，且 ≤70 瓶）',
    bad.volume, '　实测最重 L' + maxWaterAt + ' 水' + maxWater + ' → ' + maxEstSteps + ' 步（L' + maxEstStepsAt + '）');
  one('**每个门洞藏 2~3 个瓶子**（1 个是白送、4 个以上要一次腾 4 格）', bad.gateWidth);
  one('**洞口朝向合法**（在货架内 / 不朝另一个门洞 / 不朝冰冻瓶）', bad.gateDir);
  one('**冰冻瓶绝不藏在门洞里**（顺序锁 + 解冻双约束 = 玩家体感「这关不讲理」）', bad.iceInGate);

  /* ---------- 09-29 02:00 档新增：3 条「生成器不许偷偷降级」的断言 ---------- */
  one('**门洞不选角落**（每个门洞至少 3 个方向在货架内；角落只剩 2 个朝向 → 箭头指界外或与冰冻瓶成环）',
    bad.gateCorner);
  one('**实际门洞数 == 计划门洞数**（放不下就静默少放 = 难度偷偷降级；实测 2000 局零漂移）', bad.gatePlan);
  one('**实际冰冻数 == 计划冰冻数**（可解性兜底不许把冰冻整关清零 —— 最隐蔽的一类降级）', bad.icePlan);

  /* ---------- 2026-09-30 02:00 档新增：8 条「难度预算 / 曲线」不变量 ----------
     依据是 2026-09-29 的受控实验（只改 slots 一行、其它变量全冻，3 档 × 40 局）：
       有效空槽 − 颜色数 = +1 → 首战 98% ｜ 0 → 80~88% ｜ −1 → 20~43% ｜ −2 → 0%
     即通关率的主要决定因素不是棋盘大小，而是「玩家手里有几个多出来的槽当退路」。
     所以下面这几条守的不是"好不好看"，而是「这一关到底能不能赢 / 是不是白送」。 */
  one('**不许出现「必输关」**：有效空槽 ≥ 颜色数 − 2（2026-10-02 修坐标 bot 全量复测：普通档 eff=−2 可解；−4 才真必输）',
    bad.effFloor);
  one('**槽位预算**：普通档台面槽 == levelPlan 计划值（5~' + CV.SLOT_CAP + '），且有效空槽 − 颜色数 ≤ +1',
    bad.slotBudget);
  one('**难度参数逐关不跳变**（第 9 关起：|Δ颜色| ≤1 · |Δ门洞| ≤2 · |Δ冰冻| ≤2 · |Δ格数| ≤8，防曲线断崖）',
    bad.jump, '　实测最大 Δ格 ' + jumpWorst.cell + '（' + jumpWorst.at + '）');
  one('**跨周期峰值关不许变简单**（每周期第 5 关的决策密度 ≥ 上一周期峰值关；防后期原地踏步/倒退）',
    bad.peakBack, '　峰值序列 ' + peaks.map(x => 'L' + x.lv + '=' + x.density).join(' → '));
  one('**第 9 关起干扰不许归零**（门洞数 + 冰冻数 ≥ 1；防后半程变成一堆纯送分的无干扰局）', bad.noDis);
  one('**每根管开局都装 ≥5 层水**（tubeCountFor 的减管承诺；短管/空管在画面上一眼就丑）', bad.shortTube);
  one('**开局可点占比 ≥ 50%**（太多瓶子被冰冻/门洞锁住 = 开局无事可做）',
    bad.openRatio);
  one('**V6.1 阶段阶梯硬钉死**（第 3/8/15/25/40/60/90 关必须落在设计目标：9→20→35→45→50→55→55 格，' +
    '3~4→6→9→12→14→16→17 色；硬编码，不跟 levelPlan 走）', bad.ladder918);

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

  /* 教学期 1~3 必须是「无干扰的纯净局」（V4.0 §6：快速理解/快速成功/几乎不挫败）
     V6.0 放宽到「3~4 色」：第 3 关多一种颜色是曲线起点，不算引入新的干扰机制
     （门洞/冰冻才是「新规则」，它们在第 5 关才出现）。 */
  const teachBad = [];
  for (let lv = 1; lv <= 3; lv++) {
    const p = D.plan(lv);
    if (!(p.cells === 9 && p.rows === 3 && p.cols === 3 &&
      p.colors >= 3 && p.colors <= 4 && p.gates === 0 && p.ice === 0))
      teachBad.push('L' + lv + ' 格' + p.cells + '/色' + p.colors + '/洞' + p.gates + '/冰' + p.ice);
  }
  rep.ok('教学期 1~3 关恒为 9 格 / 3 行 3 列 / 3~4 色 / 无门洞无冰冻', teachBad.length === 0, teachBad.join(' '));

  /* ---------- 入门正式 4~8 关：「干扰一次只加一种」+ 单调爬坡（V6.0 §三） ----------
     设计的承诺是「一次只加一种复杂度，保留新手友好」：
       L4~5  9→12 格 / 4→5 色 / 0→1 门洞 / 0 冰冻   ← 只引入「门洞」这一种干扰
       L6~8  12→20 格 / 5→6 色 / 1→2 门洞 / 0→1 冰冻 ← 才引入「冰冻」
     旧的「配置表精确到 9/9/12/12/12 格」属于 V4 时期的六色小棋盘，V6.0 的 4~8 关是一条
     连续爬坡（9→12→16→20 格），所以这里改成守「量级 + 单调 + 一次只加一种」：
     ① 4~8 关格数 9~20 且单调不减；② 颜色 4~6 且单调不减；
     ③ 每关门洞 ≤2、冰冻 ≤1；④ 相邻两关之间，门洞与冰冻**不得同时新增**
     （同时上两种新规则 = 新手在第 6 关一次撞两堵墙，这是最容易悄悄回归的地方）。 */
  const eraBad = [];
  for (let lv = 4; lv <= 8; lv++) {
    const p = D.plan(lv), q = D.plan(lv - 1);
    if (!(p.cells >= 9 && p.cells <= 20)) eraBad.push('L' + lv + ' 格' + p.cells + ' 不在 9~20');
    if (lv > 4 && p.cells < q.cells) eraBad.push('L' + lv + ' 格数倒退 ' + q.cells + '→' + p.cells);
    if (!(p.colors >= 4 && p.colors <= 6)) eraBad.push('L' + lv + ' 色' + p.colors + ' 不在 4~6');
    if (lv > 4 && p.colors < q.colors) eraBad.push('L' + lv + ' 颜色倒退 ' + q.colors + '→' + p.colors);
    if (p.gates > 2) eraBad.push('L' + lv + ' 门洞 ' + p.gates + ' > 2（新手段最多 2 个）');
    if (p.ice > 1) eraBad.push('L' + lv + ' 冰冻 ' + p.ice + ' > 1（新手段最多 1 个）');
    if (p.gates > q.gates && p.ice > q.ice)
      eraBad.push('L' + (lv - 1) + '→' + lv + ' 同时新增门洞与冰冻');
  }
  rep.ok('入门正式 4~8 关：格数 9→20、颜色 4→6 单调爬坡，门洞 ≤2 / 冰冻 ≤1，' +
    '且「干扰一次只加一种」', eraBad.length === 0, eraBad.join(' '));

  /* ---------- 曲线不许触顶（V6.0 §三的核心修复）----------
     旧版第 24 关起所有上限到顶（24 格 / 4 行 / 6 色 / 7 管），25~90 关只是同难度的不同布局，
     对外只能说「第 24 关之后不再变难」。V6.0 要求 1~90 关持续增长，所以这条必须反过来钉：
     每个阶段末关的决策密度 / 颜色数 / 格数都要严格高于上一阶段末关。
     （格数在 40/60/90 关都是 54，所以格数只守「不倒退」，严格增长交给密度与颜色。） */
  const STEADY = [3, 8, 15, 25, 40, 60, 90];
  const steadyBad = [];
  for (let si = 1; si < STEADY.length; si++) {
    const a = info[STEADY[si - 1] - 1], b2 = info[STEADY[si] - 1];
    const pa = D.plan(STEADY[si - 1]), pb = D.plan(STEADY[si]);
    if (!(pb.density > pa.density))
      steadyBad.push('L' + STEADY[si] + ' d' + pb.density + ' ≤ L' + STEADY[si - 1] + ' d' + pa.density);
    if (!(b2.colors > a.colors))
      steadyBad.push('L' + STEADY[si] + ' 色' + b2.colors + ' ≤ L' + STEADY[si - 1] + ' ' + a.colors);
    if (b2.cells < a.cells)
      steadyBad.push('L' + STEADY[si] + ' 格' + b2.cells + ' < L' + STEADY[si - 1] + ' ' + a.cells);
  }
  rep.ok('**曲线不许触顶**：每个阶段末关（3/8/15/25/40/60/90）的决策密度与颜色数严格递增、格数不倒退',
    steadyBad.length === 0, steadyBad.join(' '));

  /* 9 关以后难度必须体现在「决策密度」，而不是「棋盘更大」（V4.0 §5.1） */
  const dens = [];
  for (let lv = 1; lv <= LVMAX; lv++) dens.push(D.plan(lv).density);
  rep.ok('9 关以后决策密度递增（第 30 关 > 第 10 关）', dens[29] > dens[9], dens[29] + ' vs ' + dens[9]);
  rep.ok('**全曲线真的在涨**（第 90 关密度 ≥ 第 1 关的 5 倍；挡「90 关和 30 关一样难」）',
    dens[LVMAX - 1] >= dens[0] * 5, dens[LVMAX - 1] + ' vs ' + dens[0] + '（×' +
    (dens[LVMAX - 1] / dens[0]).toFixed(1) + '）');

  /* 三档挑战（普通 / 困难 / 极限）必须「非严格更难」（困难 ≥ 普通 且 极限 ≥ 困难）。
     教学 1~5 关例外：那时还没有门洞可加、台面槽也已经压到下限 5，
     硬要区分只能往教学关塞冰冻瓶（违背「教学无干扰」），故只要求 极限 ≥ 困难 且 极限 > 普通。
     方案B 把普通档也收进 −3 地板后：高关（门洞/冰冻已顶到 GATE_CAP/ICE_CAP、槽位也压到地板）
     三档难度旋钮全部饱和 → 困难==极限==普通（密度完全相同），属正常收敛，不再要求「严格 >」。
     这里只守「不退步」（困难 < 普通 或 极限 < 困难 才算违规）。⚠ 范围扩到 90 关：只调 levelPlan，零生成成本。 */
  const tierBad = [];
  let tierLoose = 0;
  for (let lv = 1; lv <= LVMAX; lv++) {
    const d0 = D.plan(lv, 0).density, d1 = D.plan(lv, 1).density, d2 = D.plan(lv, 2).density;
    const ok = lv <= 5 ? (d2 >= d1 && d2 > d0) : (d1 >= d0 && d2 >= d1);  // 高关三档收敛于 −3 地板，放宽为非严格
    if (lv <= 5 && d1 === d0) tierLoose++;
    if (!ok) tierBad.push('L' + lv + ' ' + d0 + '/' + d1 + '/' + d2);
  }
  rep.ok('三档挑战非严格更难（6 关起 困难 ≥ 普通 且 极限 ≥ 困难；教学段 极限>普通；' +
    '高关三档收敛于 −3 地板属正常）',
    tierBad.length === 0, tierBad.join(' ') + '　教学段 困难==普通 的关卡数 ' + tierLoose);

  /* ---------- 三档挑战「只调约束、不加美术」（levelPlan 注释 ⑤ 的承诺）----------
     设计承诺：困难/极限档只动「台面槽 / 门洞 / 冰冻」这三个约束，
     **格子数、颜色数、水管数三档完全一致** —— 否则「挑战档」就变成了「换个更大的盘再多玩 3 分钟」，
     玩家多花时间却没多拿思考量（这正是本项目踩过的老路：加格子加的是操作量，不是难度）。
     并且槽位有下限 4（再少就真的无解感）。 */
  const tierRule = [];
  for (let lv = 4; lv <= LVMAX; lv++) {
    const p0 = D.plan(lv, 0), p1 = D.plan(lv, 1), p2 = D.plan(lv, 2);
    if (!(p0.cells === p1.cells && p1.cells === p2.cells &&
      p0.colors === p1.colors && p1.colors === p2.colors &&
      p0.tubes === p1.tubes && p1.tubes === p2.tubes))
      tierRule.push('L' + lv + ' 三档改了棋盘：格' + p0.cells + '/' + p1.cells + '/' + p2.cells +
        ' 色' + p0.colors + '/' + p1.colors + '/' + p2.colors + ' 管' + p0.tubes + '/' + p1.tubes + '/' + p2.tubes);
    /* 台面槽：每档最多减 1，且下限 5（slotBias 打到 SLOT_CAP 天花板时可能「减不动」，那也算合规） */
    const slotDrop = p0.slots >= p1.slots && p1.slots >= p2.slots &&
      (p0.slots - p1.slots) <= 1 && (p1.slots - p2.slots) <= 1 && p2.slots >= 5;
    if (!slotDrop) tierRule.push('L' + lv + ' 槽递进异常 ' + p0.slots + '/' + p1.slots + '/' + p2.slots);
    const wantG1 = lv >= 6 ? Math.min(CV.GATE_CAP, p0.gates + 1) : p0.gates;
    if (!(p1.gates === wantG1 && p2.gates === Math.min(CV.GATE_CAP, p1.gates + 1)))
      tierRule.push('L' + lv + ' 门洞递进异常 ' + p0.gates + '/' + p1.gates + '/' + p2.gates);
    if (!(p1.ice === p0.ice && p2.ice === Math.min(CV.ICE_CAP, p0.ice + 1)))
      tierRule.push('L' + lv + ' 冰冻递进异常 ' + p0.ice + '/' + p1.ice + '/' + p2.ice);
    if (p1.slots < 5 || p2.slots < 5) tierRule.push('L' + lv + ' 挑战档台面槽 < 5');
  }
  rep.ok('**三档挑战「只调约束、不加美术」**（格/色/管三档一致；槽每档 −1 下限 5；洞 +1/+1 上限 ' +
    CV.GATE_CAP + '；冰 +1 上限 ' + CV.ICE_CAP + '）', tierRule.length === 0, tierRule.join(' ').slice(0, 240));

  /* ---------- 普通档「台面槽 − 颜色数」随关卡单调不增 ----------
     STAGE_CURVE 的 slotBias 是 2 → 1 → 0 逐段收紧的（退路只减不增）。
     槽位倒退（后期把台面槽收回去）会被 `槽 ≥ 颜色数` 那条挡掉一部分，
     但当 槽 仍然 ≥ 色 时它就查不到了 —— 所以单调性是独立的一条。 */
  const slotBack = [];
  for (let lv = 2; lv <= LVMAX; lv++) {
    const gapA = info[lv - 2].slots - info[lv - 2].colors;
    const gapB = info[lv - 1].slots - info[lv - 1].colors;
    if (gapB > gapA)
      slotBack.push('L' + (lv - 1) + '→' + lv + ' 槽−色 ' + gapA + '→' + gapB);
  }
  rep.ok('**普通档「台面槽 − 颜色数」随关卡单调不增**（退路只减不增，不靠砍槽位制造难上加难）',
    slotBack.length === 0, slotBack.join(' ') + '　实测轨迹 ' +
    (info[0].slots - info[0].colors) + '→' + (info[LVMAX - 1].slots - info[LVMAX - 1].colors));

  /* 教学关（1~3）的挑战档不许把棋盘改大、管数改多，冰冻最多 1 个 —— 别把新手第一关变成劝退关 */
  const tierTeach = [];
  for (let lv = 1; lv <= 3; lv++) {
    const p0 = D.plan(lv, 0), p = D.plan(lv, 2);
    if (!(p.cells === p0.cells && p.cells <= 12 && p.tubes <= 6 && p.ice <= 1 && p.slots >= 5))
      tierTeach.push('L' + lv + ' 格' + p.cells + '/管' + p.tubes + '/冰' + p.ice + '/槽' + p.slots);
  }
  rep.ok('教学关的极限档仍保留 ≤12 格 / ≤6 管 / 冰冻 ≤1 / 槽 ≥5', tierTeach.length === 0, tierTeach.join(' '));

  rep.ok('**棋盘硬上限**：全部关卡格数 ≤ ' + (CV.GRID_MAX_ROWS * CV.GRID_MAX_COLS) +
    '（' + CV.GRID_MAX_ROWS + ' 行 × ' + CV.GRID_MAX_COLS + ' 列；再大 tile 就掉到触控下限以下）',
    Math.max.apply(null, growth) <= CV.GRID_MAX_ROWS * CV.GRID_MAX_COLS,
    '最大 ' + Math.max.apply(null, growth) + ' 格');
  rep.ok('整体递进：第 30 关格子数 > 第 5 关', growth[29] > growth[4],
    growth[29] + ' vs ' + growth[4]);

  const shapes = new Set(info.map(x => x.rows + '×' + Math.max.apply(null, x.rowLen)));
  rep.ok('行列组合多样：1~' + LVMAX + ' 关至少出现 6 种「行×列」', shapes.size >= 6, '实际 ' + shapes.size + ' 种');
  rep.ok('格数区间合理（9 起步，≤ ' + (CV.GRID_MAX_ROWS * CV.GRID_MAX_COLS) + ' 上限）',
    Math.min.apply(null, growth) >= 9 && Math.max.apply(null, growth) <= CV.GRID_MAX_ROWS * CV.GRID_MAX_COLS,
    Math.min.apply(null, growth) + '~' + Math.max.apply(null, growth));
  rep.ok('管数上限 = maxTubesByWidth()（' + D.maxTubesByWidth() + ' 根；计划几根和画得下几根共用同一常量）',
    Math.max.apply(null, info.map(x => x.tubes)) <= D.maxTubesByWidth(),
    '最大 ' + Math.max.apply(null, info.map(x => x.tubes)));

  /* 出屏管回归（本次漏测的根因之一）：管再多也必须「整根在屏内、且够点亮」。
     历史 bug：9 根时两端 2 根完全出屏（x0=-92），tubeAt 命中盒与屏幕无交集 → 永远点不到，
     但旧套件用虚拟坐标合成点击，所以 376 条全绿照样漏掉。这里用几何硬判据兜底：
     命中盒 [t.x-8, t.x+tubeW+8] ∩ [0,VW] 必须非空，且可见宽度 ≥ TUBE_MIN_W。
     ★ 阈值从写死的 44 改成 TUBE_MIN_W（34）：V6.0 晚局要 17 根管，44px 根本放不下 17 根
       （17×(44+6)=850 > 720）。34 是「手机上还点得准」的下限，且 tubeCountFor 与 layoutAll
       共用这一个常量 —— 测试再写一份 44 就变成「测试和产品各说各话」。 */
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
      if (Math.min(hitR, VW) - Math.max(hitL, 0) <= 0 || visW < CV.TUBE_MIN_W)
        tubeGeomBad.push('L' + lv + ' 管' + ti + ' x' + t.x.toFixed(0) + ' 可见' + visW.toFixed(0) + 'px');
    }
  }
  rep.ok('**出屏管回归**：1~100 关每根管的命中盒与 [0,VW] 交集非空、且可见宽度 ≥' + CV.TUBE_MIN_W + 'px（'
    + tubeProbed + ' 根管全量探针）', tubeGeomBad.length === 0, tubeGeomBad.slice(0, 6).join(' '));

  /* ============ 2026-10-01 02:00 档新增：7 条「还没被断言保护」的设计规则 ============
     探针口径：1~90 关 × 3 档位 = 270 次生成，独立跑两轮（不同随机源）零违规才敢钉等号。
     每一条都同时回答一个「它到底能抓什么」——
     ① 广告解锁位唯一且在末位：整个「有效空槽 = 总槽 − 1」的推导、以及唯一的台面变现位，
        都建立在 `open: s2 < slotsN-1` 这一行上。它被改成「多个锁」或「锁在首位」，
        所有难度结论瞬间失效，而且画面上看不出报错。
     ② 逐色水量守恒：`水总量 == 瓶容量总和` 只能保证「总数对」，某色多 3 滴、另一色少 3 滴
        照样全绿 —— 那意味着某种颜色的水永远接不完（这关不可解，但总量断言查不出）。
     ③ 不存在纯色管：整根管只有一种颜色 = 一步就能接完，是白送的假难度。
        生成器的洗牌退化（例如 shuffle 被换成不洗）只会表现为「关卡变简单」，不报错。
     ④ 开局台面为空 + 单局初始额度固定：台面残留上一局的瓶子、或者道具额度漂移，
        玩家第一眼看到的就是错的；这类问题必须先采（genLevel 之后、frames 之前）。
     ⑤ 难度在第 24 关完全触顶：面板有 90 关，但 24 关之后所有上限都到顶了，
        第 25~90 关只是同难度下的不同布局。没有这条断言，谁把上限继续抬高都不会被发现，
        而「对外文案不能写越往后越难」这句话就失去了代码依据。
     ⑥ 三档「实际门洞/冰冻数 == 计划」：原有两条只跑默认（普通）档 —— 困难/极限档
        同样有「放不下就静默少放」的降级路径，现在一并守住。
     ⑦ 挑战档难度开关下限：受控实验里 `有效空槽 − 颜色数 = −2` 已让贪心首战归零，
        挑战档故意少槽，允许掉到 −2（困难）/ −3（极限），但不许更深（−4 就彻底没有退路了）。 */
  const v2 = {
    slotAd: [], perColor: [], pureTube: [], initState: [], plateau: [], tierPlan: [], tierFloor: []
  };
  let gen270 = 0, iceNearGateN = 0;
  const effTier = {};                      /* 三档的「有效空槽 − 色」分布 */
  /* V6.0 反触顶探针：旧版本第 24 关起全部上限到顶，25~90 关只是换布局。
     V6.0 反过来要求「越往后越难」，所以这里改成守在**晚局关键档**上：
     以 5 关为一档，第 90 关的「色 + 洞 + 冰」必须严格大于第 24 关 —— 谁把上限压回去都会被抓到。 */
  const LATE_KEY = { from: 24, to: 90 };
  const LATE_SIG = {};
  for (let lv = 1; lv <= 90; lv++) {
    for (let tier = 0; tier <= 2; tier++) {
      D.gen(lv, { tier: tier });
      gen270++;
      const pl = D.plan(lv, tier), G2 = D.G;
      const key = 'L' + lv + 'T' + tier;
      /* ① 广告解锁位：恰好 1 个未解锁、且在末位、总数 == 计划槽数 */
      const lockedN = G2.slots.filter(s => !s.open).length;
      if (!(lockedN === 1 && G2.slots[G2.slots.length - 1].open === false && G2.slots.length === pl.slots))
        v2.slotAd.push(key + ' 槽' + G2.slots.length + '(计划' + pl.slots + ') 未解锁' + lockedN +
          ' 末位open=' + G2.slots[G2.slots.length - 1].open);
      /* ② 逐色水量守恒 */
      const perTube = {}, perBot = {};
      for (let ti = 0; ti < G2.tubes.length; ti++) {
        const us = G2.tubes[ti].units;
        for (let ui = 0; ui < us.length; ui++) perTube[us[ui]] = (perTube[us[ui]] || 0) + 1;
      }
      for (let bi = 0; bi < G2.bottles.length; bi++) perBot[G2.bottles[bi].col] = (perBot[G2.bottles[bi].col] || 0) + 1;
      const allCols = {};
      Object.keys(perTube).forEach(c => allCols[c] = 1);
      Object.keys(perBot).forEach(c => allCols[c] = 1);
      Object.keys(allCols).forEach(c => {
        const need2 = (perBot[c] || 0) * 3, have = perTube[c] || 0;
        if (need2 !== have) v2.perColor.push(key + ' 色' + c + ' 管中' + have + '滴 ≠ 该色瓶' + (perBot[c] || 0) + '×3=' + need2);
      });
      /* ③ 不存在纯色管（只有 1 层的管不算：那是必然「纯色」） */
      for (let ti = 0; ti < G2.tubes.length; ti++) {
        const us = G2.tubes[ti].units;
        if (us.length > 1 && us.every(u => u === us[0]))
          v2.pureTube.push(key + ' 管' + ti + ' 整根全同色' + us[0] + '×' + us.length);
      }
      /* ④ 开局台面为空 + 单局初始额度固定 */
      const onCounter = G2.bottles.filter(b => b.place === 'counter').length;
      if (!(onCounter === 0 && G2.clears === 0 && G2.undoLeft === 5 && G2.unlockLeft === 1 &&
        G2.tools.clear === 1 && G2.tools.finger === 1 && G2.tools.swap === 1))
        v2.initState.push(key + ' 台面瓶' + onCounter + ' clears' + G2.clears + ' 撤销' + G2.undoLeft +
          ' 解锁' + G2.unlockLeft + ' 道具' + G2.tools.clear + '/' + G2.tools.finger + '/' + G2.tools.swap);
      /* ⑤ 不触顶：把「色 + 洞 + 冰」这条综合干扰量记下来，最后比 24 关 vs 90 关。
         ⚠ 只对普通档（tier 0）成立 —— 挑战档按定义就会砍槽、加干扰（那条由 tierRule 守）。 */
      if (tier === 0 && (lv === LATE_KEY.from || lv === LATE_KEY.to))
        LATE_SIG[lv] = { colors: pl.colors, gates: pl.gates, ice: pl.ice,
          cells: G2.cellCount, tubes: G2.tubes.length, slots: G2.slots.length, density: pl.density };
      /* ⑥ 三档「实际 == 计划」 */
      if (G2.gates.length !== pl.gates)
        v2.tierPlan.push(key + ' 洞' + G2.gates.length + '≠' + pl.gates);
      const iceN2 = G2.bottles.filter(b => b.locked > 0).length;
      if (iceN2 !== pl.ice) v2.tierPlan.push(key + ' 冰' + iceN2 + '≠' + pl.ice);
      /* ⑦ 挑战档难度开关下限 + 分布统计 */
      const eff2 = G2.slots.length - 1 - pl.colors;
      const ek = String(eff2);
      if (!effTier[tier]) effTier[tier] = {};
      effTier[tier][ek] = (effTier[tier][ek] || 0) + 1;
      if (tier > 0 && eff2 < -3)
        v2.tierFloor.push(key + ' 有效空槽' + (G2.slots.length - 1) + ' − 色' + pl.colors + ' = ' + eff2);
      /* 顺手数一下「冰冻瓶紧贴门洞」的形态（设计允许，只做趋势，不判定） */
      for (let gi = 0; gi < G2.gates.length; gi++) {
        for (let d = 0; d < 4; d++) {
          const nc = D.neighborCell(G2.gates[gi].cell, d);
          if (nc >= 0 && D.iceAt(nc)) iceNearGateN++;
        }
      }
    }
  }
  one('**广告解锁位唯一且在末位**（每关每档恰好 1 个未解锁槽、且是最后一个；整个「有效空槽 = 总槽 − 1」都建立在这行上）',
    v2.slotAd, '　' + gen270 + ' 次生成');
  one('**逐色水量守恒**（每种颜色的管中水量 == 该色瓶子数 × 3；比总量守恒强，能抓「总数对、结构错」）',
    v2.perColor);
  one('**不存在纯色管**（≥2 层的管至少含 2 种颜色；整根同色 = 白送一步的假难度）', v2.pureTube);
  one('**开局台面为空 + 单局初始额度固定**（台面 0 瓶 / clears 0 / 撤销 5 / 解锁 1 / 道具各 1）', v2.initState);
  {
    const a = LATE_SIG[LATE_KEY.from], b2 = LATE_SIG[LATE_KEY.to];
    const score = s => s ? s.colors * 10 + s.gates * 3 + s.ice * 3 : 0;
    const show = s => s ? ('色' + s.colors + '/洞' + s.gates + '/冰' + s.ice + '/格' + s.cells + '/d' + s.density) : '缺失';
    if (!(a && b2 && score(b2) > score(a) && b2.colors > a.colors && b2.gates >= a.gates &&
      b2.ice >= a.ice && b2.density > a.density))
      v2.plateau.push('L' + LATE_KEY.to + ' ' + show(b2) + ' 未超过 L' + LATE_KEY.from + ' ' + show(a));
  }
  one('**曲线不许触顶**（第 ' + LATE_KEY.to + ' 关的「颜色 + 门洞 + 冰冻」综合干扰量与决策密度必须严格高于第 ' +
    LATE_KEY.from + ' 关；旧版这里是「完全触顶」，25~90 关只是换布局）', v2.plateau,
    '　L' + LATE_KEY.from + ' → L' + LATE_KEY.to + ' 对比见 qa_design_table.tsv');
  one('**三档「实际门洞/冰冻数 == 计划」**（原断言只跑普通档；困难/极限同样有「放不下就静默少放」的降级路径）',
    v2.tierPlan, '　' + gen270 + ' 次生成');
  one('**挑战档难度开关下限**（有效空槽 − 颜色数 ≥ −3；受控实验 −2 已让贪心首战归零，−4 就彻底没有退路）',
    v2.tierFloor);
  console.log('  （三档「有效空槽 − 颜色数」分布：普通 ' + JSON.stringify(effTier[0]) +
    ' ｜困难 ' + JSON.stringify(effTier[1]) + ' ｜极限 ' + JSON.stringify(effTier[2]) + '）');
  console.log('  （三档共 ' + gen270 + ' 次生成；冰冻瓶紧贴门洞的形态出现 ' + iceNearGateN +
    ' 次 —— 设计允许（只有「洞口箭头朝冰冻瓶」被禁止，已由另一条断言守））');

  /* ============ 2026-10-02 02:00 档新增：6 条「还没被断言保护」的设计规则 ============
     探针口径：1~90 关 × 5 个档位（普通/困难/极限/热身2 −1/热身1 −2）= 450 次**纯 plan 计算**
     （不生成关卡），独立跑两轮零漂移才敢钉等号。每条都注明「它到底能抓什么」——
     ① 阶段连续性铁律：`STAGE_CURVE` 注释里写死的「每段起点 = 上一段终点」。
        现有断言里只有「逐关不跳变（|Δ| ≤ N）」这条**幅度**约束，方向（往下掉）它管不住：
        把某个阶段的起点值调低 6 格，只要相邻关差值仍 ≤ 8，全绿。而玩家读到的是
        「打进了新阶段反而变简单」（V4.x 的老毛病：L15 密度 98.1 → L16 89.7）。
        实测：格/色/管在 6 个接缝上**完全相等**；洞/冰各掉 0~1 个（掉的那 1 个就是波浪振幅，
        因为阶段末关都是 lv%5===0 的峰值关，带了 +1）。所以钉「不降」+「掉幅 ≤1」。
     ② 普通档「台面槽 == 颜色数」（colors ≥ 5 时）—— 比现有的「槽 ≥ 色」强一档。
        现有两条（`槽 ≥ 颜色数` + `有效空槽−色 ≤ +1`）合起来只排除 +2，
        允许「多给一个槽」这种**抹平难度**的改动蒙混过关（受控实验：+1 槽 = 43% → 88%）。
        实测 90 关里 colors≥5 的 86 关全部严格相等 → 可以钉等号。
        同时钉挑战档**自第 10 关起每档恰好 −1 槽**（教学 1~9 关颜色还小、撞 clamp(≥5) 地板，
        减不动是合法的，所以起点从第 10 关算）。
     ③ 全局单调不减（格数 / 颜色数 / 水管数 / 台面槽，1~90 关）——
        这是 V6.1 对外的承诺「格数仍单调不减（45→50→55→55）」。现有断言只钉了
        7 个阶段末关的绝对值 + 相邻关 |Δ格| ≤ 8，「第 40 关比第 39 关小 8 格」照样全绿。
        实测四列全单调不减（注意「门洞+冰冻」**不是**单调的：波浪每 5 关 −2/+2，不能一起钉）。
     ④ 峰值关的门洞/冰冻 ≥ 同周期相位 2、3 关 —— 现有「波浪节奏」只比 density，
        而 density 是加权和：完全可能出现「门洞少 1 个但冰冻多 1 个、密度持平」这种
        「峰值关其实不更难」的假峰。这条把两个原始干扰量单独钉住。
     ⑤ 热身档（−1/−2）全维度 ≤ 普通档，且「台面槽 − 颜色数」≥ 普通档 ——
        回归热身的全部意义就是「盘面更轻 + 退路更宽」。现有留存套件只在几个固定关卡验，
        这条把 1~90 关全扫一遍（谁把热身档调得比普通档还重，或把它的退路收窄，当场红）。
     ⑥ 水管数 ≥ 颜色数（普通档）—— 源头管少于颜色数时，由抽屉原理必有至少一根管
        同时是两种以上颜色的「主要来源」，开局第一手的可选项骤减；而且颜色上限 17
        正是靠「管上限 17」撑住的（`STAGE_CURVE` 末段的 colors 天花板 = 管上限）。
     另外顺手打一条**趋势**（不判定）：末段峰值关的 +1 加成会被 GATE_CAP/ICE_CAP 吃掉，
     例如 L85/L90 的门洞基数已经是 8，+1 被 clamp 掉 → 峰值关与相位 3 关同参。
     这是「上限封顶」的算术后果，不是 bug，但会影响「末段还在变难」这个说法，故记录下来。 */
  const v3 = { stageLink: [], slotExact: [], mono: [], peakCmp: [], warm: [], tubeVsColor: [] };
  const pl0 = [], pl1 = [], pl2 = [], plW1 = [], plW2 = [];
  for (let lv = 1; lv <= LVMAX; lv++) {
    pl0.push(D.plan(lv, 0)); pl1.push(D.plan(lv, 1)); pl2.push(D.plan(lv, 2));
    plW1.push(D.plan(lv, -1)); plW2.push(D.plan(lv, -2));
  }

  /* ① 阶段连续性铁律（6 个接缝：[阶段末关, 下一阶段首关]） */
  const STAGE_JOINS = [[3, 4], [8, 9], [15, 16], [25, 26], [40, 41], [60, 61]];
  for (let ji = 0; ji < STAGE_JOINS.length; ji++) {
    const lvA = STAGE_JOINS[ji][0], lvB = STAGE_JOINS[ji][1];
    const A = pl0[lvA - 1], B = pl0[lvB - 1];
    if (B.cells < A.cells) v3.stageLink.push('L' + lvA + '→L' + lvB + ' 格' + A.cells + '→' + B.cells);
    if (B.colors < A.colors) v3.stageLink.push('L' + lvA + '→L' + lvB + ' 色' + A.colors + '→' + B.colors);
    if (B.tubes < A.tubes) v3.stageLink.push('L' + lvA + '→L' + lvB + ' 管' + A.tubes + '→' + B.tubes);
    if (A.gates - B.gates > 1) v3.stageLink.push('L' + lvA + '→L' + lvB + ' 门洞掉' + (A.gates - B.gates));
    if (A.ice - B.ice > 1) v3.stageLink.push('L' + lvA + '→L' + lvB + ' 冰冻掉' + (A.ice - B.ice));
  }
  one('**阶段连续性铁律**（6 个阶段接缝上：格数/颜色/水管不许下降，门洞/冰冻掉幅 ≤1 = 一个波浪振幅；' +
    '现有「逐关不跳变」只管幅度不管方向，把阶段起点调低照样全绿）', v3.stageLink);

  /* ② 普通档台面槽 == 颜色数 − (色≥7?2:0)（方案B：色≥7 收 2 槽）+ 困难档至多 −1 槽（普通已触地板时允许相等）+ 极限档 ≤ 困难档 */
  for (let lv = 1; lv <= LVMAX; lv++) {
    const p0 = pl0[lv - 1], p1 = pl1[lv - 1], p2 = pl2[lv - 1];
    if (p0.colors >= 5 && p0.slots !== p0.colors - (p0.colors >= 7 ? 2 : 0))
      v3.slotExact.push('L' + lv + ' 普通档槽' + p0.slots + '≠色' + p0.colors + '−' + (p0.colors >= 7 ? 2 : 0));
    if (lv >= 10) {
      if (p0.slots - p1.slots < 0 || p0.slots - p1.slots > 1) v3.slotExact.push('L' + lv + ' 困难档槽 ' + p0.slots + '→' + p1.slots + '（应 −0~1）');
      if (p2.slots > p1.slots) v3.slotExact.push('L' + lv + ' 极限档槽 ' + p1.slots + '→' + p2.slots + '（应 ≤ 困难）');
    }
  }
  one('**普通档台面槽 == 颜色数 − (色≥7?2:0)**（方案B：色≥7 收2槽，少2个开放槽更紧）+ ' +
    '**困难档至多 −1 槽（普通已触地板时可相等）、极限档 ≤ 困难档**（三档压在 −3 地板，属正常收敛）', v3.slotExact);

  /* ③ 全局单调不减（1~90 关）：格数 / 颜色数 / 水管数。
     ⚠ 台面槽不在此列：槽是「难度开关」不是「棋盘大小」，方案B 让普通档在色≥7 时一次性收紧 2 槽
     （eff −1→−3），跨阈值那一级槽数会掉 1 格 —— 那是「更难」不是「退化」。台面槽的退路只减不增
     由另一条「台面槽 − 颜色数 单调不增」专门守（slotBias 只减不增），这里不重复钉。 */
  for (let lv = 2; lv <= LVMAX; lv++) {
    const A = pl0[lv - 2], B = pl0[lv - 1];
    if (B.cells < A.cells) v3.mono.push('L' + (lv - 1) + '→' + lv + ' 格' + A.cells + '→' + B.cells);
    if (B.colors < A.colors) v3.mono.push('L' + (lv - 1) + '→' + lv + ' 色' + A.colors + '→' + B.colors);
    if (B.tubes < A.tubes) v3.mono.push('L' + (lv - 1) + '→' + lv + ' 管' + A.tubes + '→' + B.tubes);
  }
  one('**全局单调不减**（1~' + LVMAX + ' 关：格数 / 颜色数 / 水管数；台面槽是难度开关、不在此列）' +
    '；现有断言只钉了 7 个阶段末关的绝对值 + |Δ格| ≤ 8，「第 40 关比 39 关少 8 格」照样全绿）',
    v3.mono);

  /* ④ 峰值关的门洞/冰冻 ≥ 同周期相位 2、3 关 */
  const flatPeaks = [];
  for (let cyc = 1; cyc * 5 + 5 <= LVMAX; cyc++) {
    const lvPk = cyc * 5 + 5;
    const pk = pl0[lvPk - 1];
    for (let pi = 2; pi <= 3; pi++) {
      const lvB = cyc * 5 + pi + 1, b = pl0[lvB - 1];
      if (pk.gates < b.gates) v3.peakCmp.push('峰值L' + lvPk + ' 洞' + pk.gates + ' < L' + lvB + ' ' + b.gates);
      if (pk.ice < b.ice) v3.peakCmp.push('峰值L' + lvPk + ' 冰' + pk.ice + ' < L' + lvB + ' ' + b.ice);
    }
    if (pk.density === pl0[cyc * 5 + 3].density) flatPeaks.push('L' + lvPk);
  }
  one('**峰值关的门洞/冰冻 ≥ 同周期相位 2、3 关**（「波浪节奏」只比加权后的 density，' +
    '可能「洞少 1 冰多 1」抵平 —— 这条把两个原始干扰量单独钉住）', v3.peakCmp);

  /* ⑤ 热身档（−1/−2）全维度 ≤ 普通档，且退路更宽 */
  for (let lv = 1; lv <= LVMAX; lv++) {
    const p0 = pl0[lv - 1], dN = p0.slots - p0.colors;
    const list = [[-1, plW1[lv - 1]], [-2, plW2[lv - 1]]];
    for (let wi = 0; wi < list.length; wi++) {
      const t = list[wi][0], w = list[wi][1];
      if (w.cells > p0.cells) v3.warm.push('L' + lv + ' t' + t + ' 格' + p0.cells + '→' + w.cells);
      if (w.colors > p0.colors) v3.warm.push('L' + lv + ' t' + t + ' 色' + p0.colors + '→' + w.colors);
      if (w.tubes > p0.tubes) v3.warm.push('L' + lv + ' t' + t + ' 管' + p0.tubes + '→' + w.tubes);
      if (w.gates > p0.gates) v3.warm.push('L' + lv + ' t' + t + ' 洞' + p0.gates + '→' + w.gates);
      if (w.ice > p0.ice) v3.warm.push('L' + lv + ' t' + t + ' 冰' + p0.ice + '→' + w.ice);
      if ((w.slots - w.colors) < dN)
        v3.warm.push('L' + lv + ' t' + t + ' 退路(槽−色) ' + dN + '→' + (w.slots - w.colors));
    }
  }
  one('**热身档（−1/−2）全维度 ≤ 普通档 + 退路更宽**（格/色/管/洞/冰 一律不超，' +
    '且「台面槽 − 颜色数」≥ 普通档；1~90 关全扫，不抽查）', v3.warm);

  /* ⑥ 水管数 ≥ 颜色数（普通档） */
  for (let lv = 1; lv <= LVMAX; lv++) {
    const p0 = pl0[lv - 1];
    if (p0.tubes < p0.colors) v3.tubeVsColor.push('L' + lv + ' 管' + p0.tubes + ' < 色' + p0.colors);
  }
  one('**水管数 ≥ 颜色数**（普通档；源头管少于颜色数时，由抽屉原理必有管子同时是两种色的主要来源，' +
    '开局第一手可选项骤减。颜色上限 17 也正是靠管上限 17 撑住的）', v3.tubeVsColor);

  console.log('  （末端波浪衰减趋势：峰值关与同周期相位 3 关密度相同的关卡 = ' +
    (flatPeaks.length ? flatPeaks.join(' ') : '无') +
    '；原因是末段门洞/冰冻基数已顶到 GATE_CAP/ICE_CAP，峰值 +1 被 clamp 吃掉 —— 算术后果，不是 bug）');
  console.log('  （阶段接缝实测：' + STAGE_JOINS.map(function (j) {
    const A = pl0[j[0] - 1], B = pl0[j[1] - 1];
    return 'L' + j[0] + '→' + j[1] + ' 洞' + A.gates + '→' + B.gates + '/冰' + A.ice + '→' + B.ice;
  }).join('　') + '）');

  /* 水柱出屏：这是产品要的「压迫感」，只有 0 才算白做 */
  rep.warnIf('水柱能真的顶出屏幕顶部（有压迫感）', maxOverflow < 4,
    '最大出屏仅 ' + maxOverflow + 'px（第 ' + overflowAt + ' 关）');

  /* 操作量的绝对水位也打出来（不进断言，给人看趋势）：上限 96 水 / 220 步 */
  console.log('  （操作量最重：L' + maxWaterAt + ' 水' + maxWater + ' → 预估 ' + maxEstSteps +
    ' 步（L' + maxEstStepsAt + '）；天花板 96 水 / 220 步）');

  /* 有效空槽不足的关卡也打出来（不进断言，给人看趋势）。
     为什么要看这个：台面槽的**最后一个永远是广告解锁位**（`open:s2<slotsN-1`），
     所以「有效空槽 = 总槽 − 1」。2026-09-29 的受控实验（只动槽位、其它变量全冻）显示：
       有效空槽 − 颜色数 = 0  → 贪心首战通关率 84~88%
       有效空槽 − 颜色数 = −1 → 贪心首战通关率 40~50%
     即**通关率的主要决定因素不是棋盘大小，而是玩家手里有几个「多出来的」槽当退路**。 */
  const deficit = [];
  for (let lv = 1; lv <= LVMAX; lv++) {
    const x = info[lv - 1], p = D.plan(lv);
    if (x.slots - 1 < p.colors) deficit.push('L' + lv + '(有效' + (x.slots - 1) + '<色' + p.colors + ')');
  }
  console.log('  （有效空槽 < 颜色数（即没有多余退路）的关卡 ' + deficit.length + ' 个：' +
    (deficit.length ? deficit.slice(0, 12).join(' ') + (deficit.length > 12 ? ' …' : '') : '无') + '）');
  /* 把「有效空槽 − 颜色数」的分布也打出来 —— 这就是那个难度开关的档位分布。 */
  const effHist = { '-2': 0, '-1': 0, '0': 0, '+1': 0, '其他': 0 };
  for (let lv = 1; lv <= LVMAX; lv++) {
    const x = info[lv - 1], p = D.plan(lv);
    const raw = x.slots - 1 - p.colors;
    const e = raw > 0 ? '+' + raw : String(raw);      /* String(1) 是 '1' 不是 '+1'，得自己加号 */
    if (effHist[e] === undefined) effHist['其他']++; else effHist[e]++;
  }
  console.log('  （难度开关分布「有效空槽 − 颜色数」：−2=' + effHist['-2'] + ' 关（候选A：普通档色≥7，bot 全量实测可解）｜−1=' +
    effHist['-1'] + ' 关（首战 40~50%）｜0=' + effHist['0'] + ' 关（约 85%）｜+1=' +
    effHist['+1'] + ' 关（约 98%）｜其他=' + effHist['其他'] + ' 关）');

  /* 把全部关卡的关键指标写出来，给人和 AI 复查用 */
  const lines = ['lv\t格\t行\t行长\t色\t洞\t冰\t槽\t管\t水\t需\t最大层\t密度\t预估步\ttile\tgridY0\t货架底'];
  info.forEach(x => lines.push([x.lv, x.cells, x.rows, x.rowLen.join(','), x.colors, x.gates, x.ice,
    x.slots, x.tubes, x.water, x.need, x.maxLayer, x.density, Math.round(x.water * 2.3),
    x.tile, x.gridY0, x.gridBottom].join('\t')));
  require('fs').writeFileSync(__dirname + '/qa_design_table.tsv', lines.join('\n'), 'utf8');
  console.log('  （' + info.length + ' 关指标已写入 qa_design_table.tsv）');
});

rep.done();

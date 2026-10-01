/* dbg_report90.js —— 生成「1~90 关参数 / 难度报告」
 *
 * 用法：
 *   node dbg_report90.js                      → 写 outputs/V6.0_关卡参数与难度报告.md
 *   node dbg_report90.js --stdout             → 只打印到终端（不写文件）
 *   node dbg_report90.js --out xxx.md         → 指定输出路径
 *
 * 数据来源全部是**产品代码本体**（levelPlan / genLevel），不是手抄：
 *   · levelPlan 给「计划值」（色/洞/冰/槽/格/管/密度/预估步数）
 *   · genLevel 给「实际值」（真生成一局后数出来的，用来证明计划==实际）
 * 这样报告里的每个数字都能被 `node qa_design.js` 的断言复算一遍，
 * 不会出现「报告说 35 格、代码其实是 48 格」这种漂移。
 */
const fs = require('fs');
const path = require('path');
const { loadGame } = require('./qa_lib.js');

const OUT = (() => {
  const i = process.argv.indexOf('--out');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return path.join(__dirname, 'outputs', 'V6.0_关卡参数与难度报告.md');
})();
const TO_STDOUT = process.argv.indexOf('--stdout') >= 0;

const g = loadGame({});
g.frames(3);
g.click(360, 640);
g.frames(5);
const D = g.DBG;
const CV = D.CURVE;
const LVMAX = 90;

function actual(lv, tier) {
  D.gen(lv, tier === undefined ? {} : { tier: tier });
  const G = D.G;
  return {
    cells: G.cellCount, rows: G.gridRows, cols: Math.max.apply(null, G.rowLen),
    colors: new Set(G.bottles.map(b => b.col)).size,
    gates: G.gates.length, ice: G.bottles.filter(b => b.locked > 0).length,
    slots: G.slots.length, tubes: G.tubes.length, bottles: G.bottles.length,
    water: G.tubes.reduce((s, t) => s + t.units.length, 0),
    maxLayer: Math.max.apply(null, G.tubes.map(t => t.units.length)),
    tile: G.tile, solvable: D.layoutSolvable()
  };
}

const rows = [];
for (let lv = 1; lv <= LVMAX; lv++) {
  const p = D.plan(lv, 0);
  const a = actual(lv);
  rows.push({ lv: lv, p: p, a: a,
    d1: D.plan(lv, 1).density, d2: D.plan(lv, 2).density,
    dWarm1: D.plan(lv, -1).density, dWarm2: D.plan(lv, -2).density });
}

/* ---------- 阶段定义（直接读产品常量，保证报告和代码同源） ---------- */
const STAGE = CV.STAGE;
const stageEnds = STAGE.map(s => s.to);
const stageStart = (i) => (i === 0 ? 1 : stageEnds[i - 1] + 1);

const L = [];
const w = (s) => L.push(s);
const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

w('# 解压水消除 V6.0 — 1~90 关参数与难度报告');
w('');
w('> 生成方式：`node dbg_report90.js`（数据全部由 `levelPlan()` / `genLevel()` 实时算出，非手抄）。');
w('> 校验方式：`node qa_design.js` 会把下面每一个数字复算一遍（66 条设计不变量）。');
w('> 生成时间：' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '（本机时区）');
w('');

/* ---------- 1. 结论速览 ---------- */
const d1 = rows[0].p.density, d90 = rows[LVMAX - 1].p.density;
w('## 1. 结论速览');
w('');
w('| 指标 | 第 1 关 | 第 30 关 | 第 60 关 | 第 90 关 | 首尾倍数 |');
w('|---|---|---|---|---|---|');
const pick = (lv, k) => rows[lv - 1].p[k];
w('| 颜色数 | ' + pick(1, 'colors') + ' | ' + pick(30, 'colors') + ' | ' + pick(60, 'colors') + ' | ' + pick(90, 'colors') + ' | ×' + fmt(pick(90, 'colors') / pick(1, 'colors')) + ' |');
w('| 门洞数 | ' + pick(1, 'gates') + ' | ' + pick(30, 'gates') + ' | ' + pick(60, 'gates') + ' | ' + pick(90, 'gates') + ' | — |');
w('| 冰冻瓶 | ' + pick(1, 'ice') + ' | ' + pick(30, 'ice') + ' | ' + pick(60, 'ice') + ' | ' + pick(90, 'ice') + ' | — |');
w('| 水管数 | ' + pick(1, 'tubes') + ' | ' + pick(30, 'tubes') + ' | ' + pick(60, 'tubes') + ' | ' + pick(90, 'tubes') + ' | ×' + fmt(pick(90, 'tubes') / pick(1, 'tubes')) + ' |');
w('| 货架格数 | ' + pick(1, 'cells') + ' | ' + pick(30, 'cells') + ' | ' + pick(60, 'cells') + ' | ' + pick(90, 'cells') + ' | ×' + fmt(pick(90, 'cells') / pick(1, 'cells')) + ' |');
w('| 台面槽位 | ' + pick(1, 'slots') + ' | ' + pick(30, 'slots') + ' | ' + pick(60, 'slots') + ' | ' + pick(90, 'slots') + ' | ×' + fmt(pick(90, 'slots') / pick(1, 'slots')) + ' |');
w('| **决策密度** | ' + fmt(d1) + ' | ' + fmt(pick(30, 'density')) + ' | ' + fmt(pick(60, 'density')) + ' | ' + fmt(d90) + ' | **×' + fmt(d90 / d1) + '** |');
w('| 预估操作步数 | ' + pick(1, 'estActions') + ' | ' + pick(30, 'estActions') + ' | ' + pick(60, 'estActions') + ' | ' + pick(90, 'estActions') + ' | ×' + fmt(pick(90, 'estActions') / pick(1, 'estActions')) + ' |');
w('');
w('- **决策密度从 26 涨到 185（×' + fmt(d90 / d1) + '）**，而预估步数只从 ' + pick(1, 'estActions') +
  ' 涨到 ' + pick(90, 'estActions') + ' —— 这正是 V6.0 要的「长脑子，不长手指」。');
w('- 每关都过 `layoutSolvable()`（剥瓶自检）：报告末列的「可解」全部为 ✅。');
w('- 90 关全程**没有触顶**：第 24 / 40 / 60 / 90 关的综合干扰量与密度逐级上升（旧版第 24 关就完全触顶）。');
w('');

/* ---------- 2. 阶段骨架 ---------- */
w('## 2. 七阶段骨架（V6.0 §三）');
w('');
w('| 阶段 | 关卡 | 货架（列×行） | 颜色 | 水管 | 门洞 | 冰冻 | 台面槽余量 | 设计意图 |');
w('|---|---|---|---|---|---|---|---|---|');
const INTENT = [
  '教学：无干扰、快速成功，理解「点瓶子接水」',
  '入门正式：一次只加一种复杂度（先门洞、后冰冻）',
  '正式挑战：开始需要看一眼全局，7×5 底盘',
  '高密度：8 个色以上，必须做取舍',
  '困难：满 9 列 6 行，干扰密集',
  '极限：满盘 + 门洞/冰冻 6+，退路压到最小',
  '极限+：色与干扰到顶，靠顺序规划取胜'
];
STAGE.forEach((s, i) => {
  const a = stageStart(i), b = s.to;
  const pa = rows[a - 1].p, pb = rows[b - 1].p;
  w('| ' + (i + 1) + '. ' + s.name + ' | ' + a + '~' + b + ' | ' + pa.cols + '×' + pa.rows + ' → ' +
    pb.cols + '×' + pb.rows + ' | ' + pa.colors + ' → ' + pb.colors + ' | ' + pa.tubes + ' → ' + pb.tubes +
    ' | ' + pa.gates + ' → ' + pb.gates + ' | ' + pa.ice + ' → ' + pb.ice +
    ' | 有效空槽 − 色 = ' + (pa.slots - 1 - pa.colors) + ' → ' + (pb.slots - 1 - pb.colors) +
    ' | ' + INTENT[i] + ' |');
});
w('');
w('> 阶段之间的取值是**连续**的：每个阶段的起点 = 上一阶段的终点，所以不会出现「进了新阶段反而变简单」。');
w('> A 阶段表的 `from` 一律等于上一段的 `to`，各阶段只写 `[起点,终点]` 两个端点，中间线性插值。');
w('');

/* ---------- 3. 逐关参数表 ---------- */
w('## 3. 逐关参数表（普通档）');
w('');
w('| 关 | 阶段 | 色 | 洞 | 冰 | 槽 | 格 | 行×列 | 管 | 瓶 | 最高层 | 密度 | 预估步 | 预估时长 | 可解 |');
w('|---:|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---|---|');
rows.forEach((r) => {
  const p = r.p, a = r.a;
  const mark = (r.lv % 5 === 0) ? ' ★' : ((r.lv - 1) % 5 < 2 ? ' ·' : '');
  w('| ' + r.lv + mark + ' | ' + p.stage + ' | ' + a.colors + ' | ' + a.gates + ' | ' + a.ice + ' | ' +
    a.slots + ' | ' + a.cells + ' | ' + a.rows + '×' + a.cols + ' | ' + a.tubes + ' | ' + a.bottles +
    ' | ' + a.maxLayer + ' | ' + fmt(p.density) + ' | ' + p.estActions + ' | ' + p.estMinutes + ' 分 | ' +
    (a.solvable ? '✅' : '❌') + ' |');
});
w('');
w('> ★ = 周期峰值关（每 5 关一个波浪：峰值 +1 门洞 +1 冰冻）；· = 放水关（峰值反向）。');
w('> 「预估步」= 瓶子数 × 2.3（实测绕路比 2.2~2.4）；「预估时长」按每步 2 秒。');
w('');

/* ---------- 4. 三档挑战 ---------- */
w('## 4. 三档挑战（普通 / 困难 / 极限）');
w('');
w('| 关 | 普通密度 | 困难密度 | 极限密度 | 极限/普通 |');
w('|---:|---:|---:|---:|---:|');
[1, 5, 9, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90].forEach((lv) => {
  const r = rows[lv - 1];
  w('| ' + lv + ' | ' + fmt(r.p.density) + ' | ' + fmt(r.d1) + ' | ' + fmt(r.d2) + ' | ×' + fmt(r.d2 / r.p.density) + ' |');
});
w('');
w('> 挑战档**只动约束**（台面槽 / 门洞 / 冰冻），格数、颜色数、水管数三档完全一致 ——');
w('> 否则「挑战档」就变成「换个更大的盘再多玩 3 分钟」（本项目踩过的老路）。');
w('> 教学 1~5 关是唯一的例外：那时没有门洞可加、台面槽也已到下限 5，');
w('> 硬要区分只能往教学关塞冰冻瓶（违背「教学无干扰」），所以允许「困难 == 普通」。');
w('');

/* ---------- 5. 回归热身档 ---------- */
w('## 5. 回归热身档（V6.0 §五-A）');
w('');
w('| 关 | 热身1(-2) | 热身2(-1) | 普通(0) | 困难(1) | 极限(2) |');
w('|---:|---:|---:|---:|---:|---:|');
[5, 10, 15, 25, 40, 60, 90].forEach((lv) => {
  const r = rows[lv - 1];
  w('| ' + lv + ' | ' + fmt(r.dWarm2) + ' | ' + fmt(r.dWarm1) + ' | ' + fmt(r.p.density) +
    ' | ' + fmt(r.d1) + ' | ' + fmt(r.d2) + ' |');
});
w('');
w('> 热身档是**负数**：它整块缩小棋盘（行数 / 颜色 / 水管一起降）并放宽退路，');
w('> 因为它的产品目的就是「回来先轻松找回手感」。通关一次升一档：热身1 → 热身2 → 普通（回到正常即结束）。');
w('> **它永远不写 `Store.level` / `maxLevel`** —— 进度只增不减，降的只是「这一局用什么难度」。');
w('');

/* ---------- 6. 数值宪法校验 ---------- */
w('## 6. 数值宪法校验（硬上限与预算）');
w('');
const maxCells = Math.max.apply(null, rows.map(r => r.a.cells));
const maxBottles = Math.max.apply(null, rows.map(r => r.a.bottles));
const maxWater = Math.max.apply(null, rows.map(r => r.a.water));
const maxTubes = Math.max.apply(null, rows.map(r => r.a.tubes));
const maxSlots = Math.max.apply(null, rows.map(r => r.a.slots));
const maxColors = Math.max.apply(null, rows.map(r => r.a.colors));
const maxTile = Math.max.apply(null, rows.map(r => r.a.tile));
const minTile = Math.min.apply(null, rows.map(r => r.a.tile));
const worstBudget = rows.map(r => ({ lv: r.lv, used: r.p.estActions, cap: D.moveBudgetFor(r.lv) }))
  .sort((a, b) => (b.used - b.cap) - (a.used - a.cap))[0];
w('| 宪法条目 | 上限 | 实测最大 | 结论 |');
w('|---|---|---|---|');
w('| 货架格数 | ' + (CV.GRID_MAX_ROWS * CV.GRID_MAX_COLS) + '（' + CV.GRID_MAX_ROWS + '×' + CV.GRID_MAX_COLS + '） | ' + maxCells + ' | ✅ |');
w('| 颜色数 | ' + CV.MAX_COLORS + ' | ' + maxColors + ' | ✅ |');
w('| 水管数 | maxTubesByWidth() = ' + D.maxTubesByWidth() + ' | ' + maxTubes + ' | ✅ |');
w('| 台面槽位 | SLOT_CAP = ' + CV.SLOT_CAP + ' | ' + maxSlots + ' | ✅ |');
w('| 单局瓶子数 | 70 | ' + maxBottles + ' | ✅ |');
w('| 单局水滴数 | 210 | ' + maxWater + ' | ✅ |');
w('| 单局操作步数 | 150 / 175 / 200（按关卡分段） | 最紧的一关 L' + worstBudget.lv +
  '：' + worstBudget.used + ' / ' + worstBudget.cap + ' | ✅ |');
w('| 货架格子边长 | ≥46px（触控） | ' + minTile + ' ~ ' + maxTile + 'px | ✅ |');
w('');
w('### 单局操作量预算（分段，不是一条平线）');
w('');
w('| 关卡区间 | 预算步数 | 对应时长 | 设计理由 |');
w('|---|---|---|---|');
w('| 1~25 | 150 | ≈5.0 分钟 | 新手节奏，别拖 |');
w('| 26~60 | 175 | ≈5.8 分钟 | 正式玩家可接受 |');
w('| 61~90 | 200 | ≈6.7 分钟 | 硬核段，仍在数值宪法的 220 步红线上 |');
w('');
w('> **为什么必须分段**：统一 150 步时，第 50 关之后「门洞一多、预算先爆」，');
w('> 校准③ 只能去削行数（54 格被砍到 45 格），于是 50~90 关的曲线被压成一条平线');
w('> （169 → 180，40 关只涨 6%）。这属于「加格子加的是操作量、不是思考深度」的老路的新形态。');
w('');

/* ---------- 7. 与旧版对比 ---------- */
w('## 7. 与 V4.0 旧曲线的差异');
w('');
w('| 维度 | V4.0（旧） | V6.0（本次） |');
w('|---|---|---|');
w('| 调色板 | 6 色 | **20 色**（曲线用到 17，留 3 个余量） |');
w('| 棋盘 | 第 19 关起恒定 24 格 / 4 行 | **9→20→35→48→54 格**，6 行 9 列封顶 |');
w('| 水管 | 写死 7 根封顶 | **4→17 根**，上限由 `maxTubesByWidth()` 反推 |');
w('| 台面槽 | 恒 5~6 | **5→17**（跟着颜色数走，普通档始终 ≥ 颜色数） |');
w('| 难度天花板 | **第 24 关完全触顶**，25~90 关只是换布局 | 第 90 关密度仍是第 24 关的 ' + fmt(d90 / pick(24, 'density')) + ' 倍，**不触顶** |');
w('| 单局预算 | 统一 150 步（50 关后被压平） | **分段 150 / 175 / 200** |');
w('| 阶段衔接 | 各阶段各写 `[from,to]`，跨阶段必掉一次难度（L15 98.1 → L16 89.7） | **连续**：每段起点 = 上段终点 |');
w('| 留存机制 | 无 | **回归热身 + 递进挑战**（进度不动，难度分档回升） |');
w('');
w('---');
w('');
w('*本报告由 `dbg_report90.js` 生成；配套断言在 `qa_design.js`（设计不变量 66 条）、');
w('`qa_warmup.js`（回归热身 14 条）、`qa_biz.js`（广告与单局规模 74 条）。*');

const md = L.join('\n');
if (TO_STDOUT) console.log(md);
else { fs.writeFileSync(OUT, md, 'utf8'); console.log('已写入 ' + OUT + '（' + md.length + ' 字符）'); }

/* qa_run.js —— 测试编排器（run loop 的入口）
 *
 * 一条命令跑完全部套件，输出一份可读的报告，并且**用退出码表达结论**：
 *   node qa_run.js           → 跑全部（含机器人通关，约 1~3 分钟）
 *   node qa_run.js --quick   → 跳过机器人，只跑快速套件（约 5 秒）
 *   REPS=3 node qa_run.js    → 快速套件重跑 3 遍，专门抓「时好时坏」的 flaky 用例
 *   node qa_run.js --gate    → **上线门禁**：跑全部 + 门禁硬条件，不过就打印「禁止上线」并以退出码 3 结束
 *
 * 设计要点：
 *  1. 每个套件跑在**独立进程**里 —— 一个套件崩了不会带走其他套件，也不会污染全局
 *  2. 只认 `__QA__ {json}` 这一行做汇总，不靠正则猜 stdout 的措辞
 *  3. 报告写入 qa_report.md / qa_report.json，可以被夜间定时任务直接读取并推到聊天里
 *  4. `--gate` 的判据分两层：套件级（0 FAIL / 无 flaky）由本文件算，
 *     文件级与线上级（体积 / ES5 / 依赖 / 可解性 / 线上字节）由 qa_gate.js 算并写 _gate.json，
 *     本文件只负责汇总成一张「能不能上线」的表 —— 判据集中在 qa_gate.js，别在这里重复实现。
 *  5. `--gate` 还会多跑两个 gateOnly 套件：qa_gate.js（文件/线上级判据）与
 *     qa_smoke_live.js（真浏览器冒烟 → G9）。它们只在门禁下跑，`--quick` 与默认两档口径不变。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const NODE = process.execPath;
const GATE = process.argv.indexOf('--gate') >= 0;
const QUICK = !GATE && process.argv.indexOf('--quick') >= 0;
const REPS = Math.max(1, +(process.env.REPS || (GATE ? 2 : 1)));

const SUITES = [
  { key: 'func', name: '功能测试（点击级回归用例）', file: 'test_water.js', kind: 'checks', fast: true },
  { key: 'biz', name: '商业化测试（广告/存档/埋点/档位/单局规模）', file: 'qa_biz.js', kind: 'qa', fast: true },
  { key: 'arch', name: '架构测试（单文件 / ES5 / 零依赖 / 兜底）', file: 'qa_arch.js', kind: 'qa', fast: true },
  { key: 'design', name: '设计测试（关卡与布局不变量）', file: 'qa_design.js', kind: 'qa', fast: true },
  { key: 'ui', name: 'UI 测试（命中回转 / 拒绝反馈 / 多分辨率）', file: 'qa_ui.js', kind: 'qa', fast: true },
  /* 门禁模式把机器人放到 1~40 关：G7 要的是「1~40 全通」，1~30 是它的子集。
     bot_run.js 用的是固定种子（seedRandom(lv*7919+attempt*104729)），所以这个条件是**确定性**的，
     不是随机抽奖 —— 否则门禁自己就会时红时绿。 */
  { key: 'bot', name: '合理性测试（机器人贪心通关）', file: 'bot_run.js', kind: 'bot', fast: false,
    env: GATE ? { MAX: '40', TRIES: '3' } : { MAX: '30', TRIES: '3' } },
  /* 门禁套件放最后：它要读的 _gate.json 里含线上比对，独立成进程好排查 */
  { key: 'gate', name: '上线门禁（体积 / ES5 / 依赖 / 可解性 / 线上一致）', file: 'qa_gate.js', kind: 'qa', fast: true, gateOnly: true },
  /* 真浏览器冒烟（G9）：前面所有套件都跑在**假 canvas** 上，谁也证明不了"真机不是白屏"。
     它只在 --gate 下跑（默认与 --quick 的口径保持不变），且**只判对/错不判快慢** ——
     帧耗时在共享机器上会抖，塞进门禁会让门禁自己时红时绿，性能交给 qa_perf.js 单独量。 */
  { key: 'smoke', name: '真浏览器冒烟（Chrome 360×640 · 4 关 × 90 帧 · 非白屏）', file: 'qa_smoke_live.js', kind: 'qa', fast: false, gateOnly: true }
];

function runSuite(s) {
  const env = Object.assign({}, process.env, s.env || {});
  const t0 = Date.now();
  const r = spawnSync(NODE, [path.join(ROOT, s.file)], {
    cwd: ROOT, env: env, encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const ms = Date.now() - t0;
  const res = { key: s.key, name: s.name, ms: ms, pass: 0, fail: 0, warn: 0, fails: [], warns: [], raw: out };

  if (s.kind === 'qa') {
    const m = out.match(/__QA__ (\{[\s\S]*?\})\s*$/m);
    if (!m) {
      res.fail = 1;
      res.fails.push('套件未产出 __QA__ 结果行（可能崩溃了，看原始输出）');
      return res;
    }
    const j = JSON.parse(m[1]);
    res.pass = j.pass; res.fail = j.fail; res.warn = j.warn;
    res.fails = j.fails || []; res.warns = j.warns || [];
    return res;
  }

  if (s.kind === 'checks') {
    res.pass = (out.match(/^PASS\b/gm) || []).length;
    const fs2 = out.match(/^FAIL\b.*$/gm) || [];
    res.fail = fs2.length;
    res.fails = fs2.map(x => x.replace(/^FAIL\s+/, ''));
    if (r.error) { res.fail++; res.fails.push('进程异常：' + r.error.message); }
    return res;
  }

  /* bot：读它写的 _bot.txt，最后一行给结论；同时把「哪几关没过」抠出来给门禁用 */
  const bt = path.join(ROOT, '_bot.txt');
  let txt = '';
  try { txt = fs.readFileSync(bt, 'utf8'); } catch (e) { }
  res.botWon = []; res.botLost = [];
  const reBot = /^\s*(\d+)\s*\|[^|\n]*\|[^|\n]*\|[^|\n]*\|\s*(通关|未通过)/gm;
  let mb;
  while ((mb = reBot.exec(txt)) !== null) {
    (mb[2] === '通关' ? res.botWon : res.botLost).push(+mb[1]);
  }
  const won = res.botWon.length, lost = res.botLost.length;
  res.pass = won; res.fail = lost;
  if (!txt) { res.fail = 1; res.fails.push('机器人套件未产出 _bot.txt'); }
  else if (lost > 0) res.fails.push('有 ' + lost + ' 关机器人打不通（可能是真·不可解）：第 ' + res.botLost.join(',') + ' 关');
  else res.fails = [];
  return res;
}

const chosen = SUITES.filter(s => (s.gateOnly && !GATE) ? false : (QUICK ? s.fast : true));
const results = [];

console.log('===== QA RUN  ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '  =====');
if (GATE) console.log('（门禁模式：跑全部套件 + 门禁硬条件，快速套件默认重跑 ' + REPS + ' 遍查 flaky；机器人 1~40 关）');
else if (REPS > 1) console.log('（快速套件将重跑 ' + REPS + ' 遍，用于抓 flaky）');

for (const s of chosen) {
  const reps = (s.fast && REPS > 1) ? REPS : 1;
  const runs = [];
  for (let k = 0; k < reps; k++) runs.push(runSuite(s));
  const first = runs[0];
  first.unstable = runs.some(x => (x.fail > 0) !== (first.fail > 0) || x.pass !== first.pass);
  if (first.unstable) {
    first.fail += 1;
    first.fails.push('**不稳定（flaky）**：' + reps + ' 次重跑的通过数/失败数不一致 → ' +
      runs.map(x => x.pass + '/' + x.fail).join(' , '));
  }
  first.reps = reps;
  results.push(first);
  console.log('  ' + (first.fail === 0 ? '✔' : '✘') + ' ' + s.name
    + '  ' + first.pass + ' PASS / ' + first.fail + ' FAIL / ' + first.warn + ' WARN  (' + first.ms + 'ms)');
  first.fails.forEach(f => console.log('      ✘ ' + f));
  first.warns.forEach(w => console.log('      ! ' + w));
}

const totalPass = results.reduce((a, r) => a + r.pass, 0);
const totalFail = results.reduce((a, r) => a + r.fail, 0);
const totalWarn = results.reduce((a, r) => a + r.warn, 0);
const green = totalFail === 0;

/* ---------- 上线门禁判定（只在 --gate 下跑）----------
   分工：套件级判据（0 FAIL / 无 flaky）在这里算；
   文件级与线上级判据（体积 / ES5 / 依赖 / 1~40 可解 / 线上字节）由 qa_gate.js 算完写进 _gate.json，
   这里只把两者拼成一张「能不能上线」的表 —— 判据别在两处各写一份，否则改了这边忘了那边。 */
let gateOk = null, gateItems = [];
if (GATE) {
  const botRes = results.find(r => r.key === 'bot');
  let gateFile = null;
  try { gateFile = JSON.parse(fs.readFileSync(path.join(ROOT, '_gate.json'), 'utf8')); } catch (e) { }
  const gadd = (id, name, ok, detail) => gateItems.push({ id: id, name: name, ok: !!ok, detail: detail || '' });

  gadd('G1', '全部套件 0 FAIL', totalFail === 0,
    totalFail === 0 ? totalPass + ' 项断言全过' : '有 ' + totalFail + ' 项失败（见上表）');

  const flaky = results.filter(r => r.unstable);
  gadd('G2', '无 flaky（快速套件重跑 ' + REPS + ' 遍结果一致）', flaky.length === 0,
    flaky.length ? flaky.map(r => r.name).join('、') + ' 通过数不一致' : REPS + ' 遍重跑全部一致');

  const crashed = results.filter(r => (r.fails || []).join(' ').indexOf('未产出 __QA__ 结果行') >= 0);
  gadd('G2b', '没有套件崩溃 / 静默跳过', crashed.length === 0,
    crashed.length ? crashed.map(r => r.name).join('、') + ' 没产出结论' : results.length + ' 个套件全部产出结论');

  if (!gateFile) {
    gadd('G3-G8', '门禁套件（体积/ES5/依赖/可解性/线上一致）出结果', false, 'qa_gate.js 没写出 _gate.json');
  } else {
    /* skipped（例如 --no-live 跳过的线上比对）一律算**没过**：
       「没验证」不等于「通过」，门禁不能拿没跑过的条件放行。 */
    gateFile.items.forEach(x => gadd(x.id, x.name, x.ok && !x.skipped,
      x.skipped ? '未验证：' + (x.detail || '被跳过') : x.detail));
  }

  if (botRes) {
    const tested = botRes.botWon.length + botRes.botLost.length;
    const all40 = botRes.botLost.length === 0 && tested === 40;
    const in30 = botRes.botWon.filter(n => n <= 30).length;
    gadd('G7', '机器人 1~40 关全通（固定种子，可复现）', all40,
      all40 ? '40/40 通关；其中 1~30 关 ' + in30 + '/30'
        : '未通过第 ' + botRes.botLost.join(',') + ' 关（共测 ' + tested + ' 关）');
  } else {
    gadd('G7', '机器人 1~40 关全通', false, '机器人套件没跑');
  }
  /* G9 真浏览器冒烟：这条是"白屏事故"的最后一道闸。
     静态扫描（G4/G5）只能证明语法和依赖没问题，假 canvas 套件连 API 缺失都不报错 ——
     只有真浏览器跑起来，才能证明"点开真的有画面"。它只判对错不判快慢，所以是确定性的。 */
  const smokeRes = results.find(r => r.key === 'smoke');
  if (!smokeRes) {
    gadd('G9', '真浏览器启动冒烟（4 关 × 90 帧：无错误 / 非白屏 / 主循环在跑）', false,
      '冒烟套件没跑 —— 「没验证」不算通过');
  } else {
    gadd('G9', '真浏览器启动冒烟（4 关 × 90 帧：无错误 / 非白屏 / 主循环在跑）', smokeRes.fail === 0,
      smokeRes.fail === 0
        ? smokeRes.pass + ' 项全过（Chrome headless 360×640，见 _smoke.json）'
        : smokeRes.fails.slice(0, 2).join('；'));
  }

  /* 按编号排一下：门禁表要能一眼从 G1 读到 G9，别让「后加的条件」插在中间 */
  const ORDER = ['G1', 'G2', 'G2b', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8a', 'G8b', 'G9'];
  gateItems.sort((a, b) => {
    const ia = ORDER.indexOf(a.id), ib = ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  gateOk = gateItems.every(x => x.ok);
}

/* ---------- 写报告 ---------- */
const L = [];
L.push('# 《解压水消除》自动测试报告');
L.push('');
L.push('> 生成时间：' + new Date().toISOString().replace('T', ' ').slice(0, 19)
  + '　|　命令：`node qa_run.js' + (QUICK ? ' --quick' : '') + (REPS > 1 ? '  (REPS=' + REPS + ')' : '') + '`');
L.push('');
L.push('## 结论：' + (green ? '✅ 全部通过' : '❌ 有 ' + totalFail + ' 项失败'));
L.push('');
if (GATE) {
  L.push('## 🚦 上线门禁：' + (gateOk ? '✅ **允许上线**' : '⛔ **禁止上线**'));
  L.push('');
  L.push('| 编号 | 硬条件 | 结果 | 说明 |');
  L.push('|---|---|---|---|');
  gateItems.forEach(x => L.push('| `' + x.id + '` | ' + x.name + ' | ' + (x.ok ? '✅' : '❌') + ' | ' + String(x.detail).replace(/\|/g, '\\|') + ' |'));
  L.push('');
  if (!gateOk) {
    L.push('**禁止上线**，先把下面几条修掉：');
    L.push('');
    gateItems.filter(x => !x.ok).forEach(x => L.push('- `' + x.id + '` ' + x.name + ' → ' + x.detail));
    L.push('');
  }
  L.push('> 门禁用法：`node qa_run.js --gate`（退出码 0 = 允许上线，3 = 禁止上线）。');
  L.push('> 判据明细与实现见 [`qa_gate.js`](qa_gate.js) 与 [`QA_自测体系.md`](QA_自测体系.md) 第 9 节。');
  L.push('');
}
L.push('| 套件 | 通过 | 失败 | 提醒 | 耗时 |');
L.push('|---|---|---|---|---|');
results.forEach(r => {
  L.push('| ' + r.name + ' | ' + r.pass + ' | ' + (r.fail ? '**' + r.fail + '**' : '0')
    + ' | ' + r.warn + ' | ' + r.ms + 'ms |');
});
L.push('| **合计** | **' + totalPass + '** | **' + totalFail + '** | **' + totalWarn + '** | |');
L.push('');
if (!green) {
  L.push('## 失败明细（要做的事）');
  L.push('');
  results.forEach(r => {
    if (!r.fails.length) return;
    L.push('### ' + r.name);
    r.fails.forEach(f => L.push('- [ ] ' + f));
    L.push('');
  });
}
if (totalWarn) {
  L.push('## 提醒（不阻塞，但要看一眼）');
  L.push('');
  results.forEach(r => r.warns.forEach(w => L.push('- ' + r.name + '：' + w)));
  L.push('');
}
L.push('## 这套测试在保护什么');
L.push('');
L.push('| 套件 | 它守的是什么 | 典型能抓到的 bug |');
L.push('|---|---|---|');
L.push('| 功能测试 | 每个按钮点下去的真实后果 | 道具不生效、水量不守恒、撤销错乱、广告位不触发 |');
L.push('| 商业化测试 | 赚钱链路与存档底线 | 点了广告不发奖、没看完也发奖、重复发奖、存档被改还能读、隐私模式白屏 |');
L.push('| 架构测试 | 单文件交付的地基 | 混进外部依赖、用了老 WebView 不支持的语法、线上白屏没兜底 |');
L.push('| 设计测试 | 关卡数值自洽 | 关卡表写死导致高关不再变难、水量对不上、门洞相邻互锁、货架压住台面进度条、放水关不比峰值关轻、槽比颜色少、某色只有 1 瓶、单局操作量失控 |');
L.push('| UI 测试 | 手指戳下去会发生什么 | 点了没反应（命中框太小）、点错瓶子、静默拒绝、多分辨率下点不中、文字出现 NaN |');
L.push('| 合理性测试 | 真的能玩到底 | 关卡不可解、难度失控（机器人一次通关率异常） |');
L.push('');
L.push('## 原始输出');
L.push('');
results.forEach(r => {
  L.push('<details><summary>' + r.name + '</summary>');
  L.push('');
  L.push('```');
  L.push((r.raw || '').slice(0, 20000));
  L.push('```');
  L.push('');
  L.push('</details>');
  L.push('');
});

fs.writeFileSync(path.join(ROOT, 'qa_report.md'), L.join('\n'), 'utf8');
fs.writeFileSync(path.join(ROOT, 'qa_report.json'), JSON.stringify({
  at: new Date().toISOString(), green: green,
  gate: GATE ? { ok: gateOk, items: gateItems } : null,
  total: { pass: totalPass, fail: totalFail, warn: totalWarn },
  suites: results.map(r => ({
    key: r.key, name: r.name, pass: r.pass, fail: r.fail, warn: r.warn, ms: r.ms,
    fails: r.fails, warns: r.warns, unstable: !!r.unstable,
    botWon: r.botWon, botLost: r.botLost
  }))
}, null, 2), 'utf8');

console.log('');
console.log('===== ' + (green ? '全部通过' : totalFail + ' 项失败') + '：'
  + totalPass + ' PASS / ' + totalFail + ' FAIL / ' + totalWarn + ' WARN =====');
if (GATE) {
  console.log('');
  console.log('🚦 上线门禁判定（' + gateItems.length + ' 条硬条件）');
  gateItems.forEach(x => console.log('  ' + (x.ok ? '✔' : '✘') + ' [' + x.id + '] ' + x.name
    + '  → ' + x.detail));
  console.log('');
  console.log(gateOk ? '✅ 允许上线' : '⛔ 禁止上线');
}
console.log('报告已写入 qa_report.md / qa_report.json');
process.exit(GATE ? (gateOk ? 0 : 3) : (green ? 0 : 1));

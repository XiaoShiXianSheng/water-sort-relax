/* qa_run.js —— 测试编排器（run loop 的入口）
 *
 * 一条命令跑完全部套件，输出一份可读的报告，并且**用退出码表达结论**：
 *   node qa_run.js           → 跑全部（含机器人通关，约 1~3 分钟）
 *   node qa_run.js --quick   → 跳过机器人，只跑快速套件（约 5 秒）
 *   REPS=3 node qa_run.js    → 快速套件重跑 3 遍，专门抓「时好时坏」的 flaky 用例
 *
 * 设计要点：
 *  1. 每个套件跑在**独立进程**里 —— 一个套件崩了不会带走其他套件，也不会污染全局
 *  2. 只认 `__QA__ {json}` 这一行做汇总，不靠正则猜 stdout 的措辞
 *  3. 报告写入 qa_report.md / qa_report.json，可以被夜间定时任务直接读取并推到聊天里
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const NODE = process.execPath;
const QUICK = process.argv.indexOf('--quick') >= 0;
const REPS = Math.max(1, +(process.env.REPS || 1));

const SUITES = [
  { key: 'func', name: '功能测试（点击级回归用例）', file: 'test_water.js', kind: 'checks', fast: true },
  { key: 'arch', name: '架构测试（单文件 / ES5 / 零依赖 / 兜底）', file: 'qa_arch.js', kind: 'qa', fast: true },
  { key: 'design', name: '设计测试（关卡与布局不变量）', file: 'qa_design.js', kind: 'qa', fast: true },
  { key: 'ui', name: 'UI 测试（命中回转 / 拒绝反馈 / 多分辨率）', file: 'qa_ui.js', kind: 'qa', fast: true },
  { key: 'bot', name: '合理性测试（机器人贪心通关 1~30 关）', file: 'bot_run.js', kind: 'bot', fast: false, env: { MAX: '30', TRIES: '3' } }
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

  /* bot：读它写的 _bot.txt，最后一行给结论 */
  const bt = path.join(ROOT, '_bot.txt');
  let txt = '';
  try { txt = fs.readFileSync(bt, 'utf8'); } catch (e) { }
  const won = (txt.match(/^\s*\d+\s*\|.*通关\s*\|/gm) || []).length;
  const lost = (txt.match(/^\s*\d+\s*\|.*未通过/gm) || []).length;
  res.pass = won; res.fail = lost;
  if (!txt) { res.fail = 1; res.fails.push('机器人套件未产出 _bot.txt'); }
  else if (lost > 0) res.fails.push('有 ' + lost + ' 关机器人打不通（可能是真·不可解）');
  else res.fails = [];
  return res;
}

const chosen = SUITES.filter(s => QUICK ? s.fast : true);
const results = [];

console.log('===== QA RUN  ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '  =====');
if (REPS > 1) console.log('（快速套件将重跑 ' + REPS + ' 遍，用于抓 flaky）');

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

/* ---------- 写报告 ---------- */
const L = [];
L.push('# 《解压水消除》自动测试报告');
L.push('');
L.push('> 生成时间：' + new Date().toISOString().replace('T', ' ').slice(0, 19)
  + '　|　命令：`node qa_run.js' + (QUICK ? ' --quick' : '') + (REPS > 1 ? '  (REPS=' + REPS + ')' : '') + '`');
L.push('');
L.push('## 结论：' + (green ? '✅ 全部通过' : '❌ 有 ' + totalFail + ' 项失败'));
L.push('');
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
L.push('| 架构测试 | 单文件交付的地基 | 混进外部依赖、用了老 WebView 不支持的语法、线上白屏没兜底 |');
L.push('| 设计测试 | 关卡数值自洽 | 关卡表写死导致高关不再变难、水量对不上、门洞相邻互锁、货架压住台面进度条 |');
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
  total: { pass: totalPass, fail: totalFail, warn: totalWarn },
  suites: results.map(r => ({
    key: r.key, name: r.name, pass: r.pass, fail: r.fail, warn: r.warn, ms: r.ms,
    fails: r.fails, warns: r.warns, unstable: !!r.unstable
  }))
}, null, 2), 'utf8');

console.log('');
console.log('===== ' + (green ? '全部通过' : totalFail + ' 项失败') + '：'
  + totalPass + ' PASS / ' + totalFail + ' FAIL / ' + totalWarn + ' WARN =====');
console.log('报告已写入 qa_report.md / qa_report.json');
process.exit(green ? 0 : 1);

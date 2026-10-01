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
 *     qa_smoke_live.js —— 后者被跑**两趟**（正常网络 → G9/G13、断网 → G12）。
 *     它们只在门禁下跑，`--quick` 与默认两档口径不变。
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
  /* V6.0 §五-A：回归热身 + 递进挑战（八条验收 + 参数化 / 不污染进度）
     它单独成套件而不是塞进 design：这两件事的失效方式完全不同 ——
     曲线坏了是「关卡不好玩」，热身坏了是「老玩家回来发现进度没了」，后者更严重。 */
  { key: 'warmup', name: '留存测试（回归热身 / 递进挑战 / 存档迁移）', file: 'qa_warmup.js', kind: 'qa', fast: true },
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
  { key: 'smoke', name: '真浏览器冒烟（Chrome 360×640 · 5 趟 × 90 帧 · 含标题页端到端点击）', file: 'qa_smoke_live.js', kind: 'qa', fast: false, gateOnly: true },
  /* 断网冒烟（G12）：**同一个套件文件，换一组环境变量再跑一趟** ——
     把页面里的远程 http(s) 请求全部拦掉（垫片记账），在"外部网络 100% 失败"下
     重跑同一批断言。守的是产品承诺"零依赖单文件"：谁哪天悄悄挂了远程字体/贴图/统计，
     联网时一切正常、玩家一断网就白屏 —— 静态扫描（G4/G5）和假 canvas 都看不见。
     能进门禁的理由同上：**只判对错**（能不能开局、有没有报错），与机器快慢无关。 */
  { key: 'smokeOffline', name: '断网冒烟（外部网络全断 · 3 趟 × 90 帧 · 含标题页端到端）', file: 'qa_smoke_live.js', kind: 'qa', fast: false, gateOnly: true,
    env: { SMK_OFFLINE: '1', SMK_OUT: '_offline.json', LV_SET: '0,30,1' } }
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
    /* extra：套件自报的"确实跑在什么模式 / 有什么正面证据"（G12 靠它证明这趟真断网，
       G13 靠它证明端到端那条链路真跑过）。没有 extra 就当"没验证"，门禁会判 FAIL。 */
    res.extra = j.extra || null;
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
    gadd('G9', '真浏览器启动冒烟（5 趟 × 90 帧：无错误 / 非白屏 / 主循环在跑）', smokeRes.fail === 0,
      smokeRes.fail === 0
        ? smokeRes.pass + ' 项全过（Chrome headless 360×640，见 _smoke.json）'
        : smokeRes.fails.slice(0, 2).join('；'));
  }

  /* G12 断网冒烟：产品的卖点是"零依赖单文件"，但"零依赖"不能靠自述 ——
     要在外部网络 100% 失败的环境下把同一批断言重跑一遍。
     谁哪天悄悄挂了远程字体/贴图/统计脚本，联网时全绿、玩家一断网就白屏，
     而 G4/G5 是静态扫描（JS 拼出来的 URL 扫不到）、G9 跑在正常网络下（根本看不出来）。
     ★ 它**不**断言"外部请求数必须为 0"：埋点上报是 fire-and-forget，是允许存在的，
     这条要证明的是"请求失败不会把游戏带崩"。 */
  const offRes = results.find(r => r.key === 'smokeOffline');
  const offEx = offRes && offRes.extra;
  gadd('G12', '断网冒烟：外部网络 100% 失败时仍能正常开局（零依赖不是自述）',
    !!offRes && offRes.fail === 0 && !!offEx && offEx.mode === 'offline' && offEx.netOff === true,
    !offRes ? '断网冒烟套件没跑 —— 「没验证」不算通过'
      : (!offEx || !offEx.mode) ? '这套件没自报模式 → 无法确认它真的断网了，按不许上线处理'
        : offEx.mode !== 'offline' ? '这趟跑在 ' + offEx.mode + ' 模式（不是断网）→ 门禁空转'
          : offEx.netOff !== true ? '断网垫片没生效（页面没报告 netOff）→ 这趟等于在正常网络下跑的'
            : offRes.pass + ' 项全过（外部请求拦截明细见 _offline.json）');

  /* G13 真浏览器端到端点击：qa_ui 是**直接调 handleTap(vx,vy)** 的（假 canvas + 直接调函数），
     它证明不了「canvas 真的铺在 (0,0)、listener 真的注册上了、真机 dpr 换算没歪」——
     "游戏能玩，就是点不动"这类事故没有任何后续，所以必须是真 DOM 事件。
     证据必须**正面存在**：套件没回传端到端结果时判 FAIL（没验证 ≠ 通过）。 */
  const smEx = smokeRes && smokeRes.extra;
  const e2 = smEx && smEx.e2e;
  gadd('G13', '真浏览器端到端：真触摸事件点「开始游戏」进第 1 关 + 点货架瓶飞上台面',
    !!(e2 && e2.titleFirst && e2.rectAtOrigin && e2.titleToPlay && e2.bottleMoved),
    !e2 ? '冒烟套件没回传端到端结果（标题页那条链路没跑）→ 没证据不算通过'
      : '标题页→第 1 关=' + e2.titleToPlay + '　点瓶子上台面=' + e2.bottleMoved
        + '　canvas 在视口原点=' + e2.rectAtOrigin + '　输入通道=' + e2.inputPath);

  /* 按编号排一下：门禁表要能一眼从 G1 读到 G14，别让「后加的条件」插在中间 */
  const ORDER = ['G1', 'G2', 'G2b', 'G3', 'G4', 'G5', 'G14', 'G6', 'G6b', 'G7', 'G8a', 'G8b', 'G8c', 'G9', 'G10', 'G11', 'G12', 'G13'];
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

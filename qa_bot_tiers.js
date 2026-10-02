/* ============================================================================
   qa_bot_tiers.js —— 三档「贪心机器人 90 关全通关」体检（独立工具，不进 qa_run / 门禁）

   为什么要有它（2026-10-03 踩到）：
     `qa_run.js` 的机器人套件只跑**普通档 1~30 关**，`--gate` 也只跑**普通档 1~40 关**
     （G6/G7）。于是「**挑战档**（困难/极限）在高关打不通」这类回归**没有任何门禁能看见** ——
     2026-10-02 那份未提交的难度改动（色≥9 收 1 槽 → eff=−4）就是这样漏过去的：
     普通档 90 关全过、困难档 90 关全过，**极限档第 19 关三次尝试全失败**，
     而当时没有任何自动化会报出来。这条命令补的就是这个盲区。

   做什么：
     依次以 TIER=0 / 1 / 2 跑 `bot_run.js`（固定种子，确定性），各自 MAX 关、最多 TRIES 次尝试，
     要求**每一档每一关都通关**。任何一关「未通过」即判 FAIL。

   怎么跑（约 30 分钟，90 关 × 3 档 —— 属于夜间批处理，不要塞进门禁）：
     node qa_bot_tiers.js                 # 三档 × 90 关 × 3 尝试
     MAX=30 node qa_bot_tiers.js          # 抽小一点快速自查
     TIERS=2 node qa_bot_tiers.js         # 只查极限档
     MAX=6 TIERS=1,2 node qa_bot_tiers.js # 冒烟（约 1 分钟，用来验证本工具自己没坏）

   产物 / 退出码：
     每档一份 `_bot_tier{N}.txt`（bot_run 的原始表，自己写的是 `_bot.txt`，这里跑完会另存一份）；
     退出码 0 = 三档全通关；1 = 有关卡未通过。

   ⚠ 本文件被 `qa_gate.js` 的 G10「QA 脚本语法自检」覆盖 —— 改完务必让它能通过纯语法编译。
   ============================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAXLV = +(process.env.MAX || 90);
const TRIES = +(process.env.TRIES || 3);
const TIERS = (process.env.TIERS || '0,1,2').split(',').map(function (s) { return +(s.trim()); })
  .filter(function (t) { return t === 0 || t === 1 || t === 2; });
const TIER_NAME = { 0: '普通', 1: '困难', 2: '极限' };

const BOT = path.join(__dirname, 'bot_run.js');
if (!fs.existsSync(BOT)) { console.log('FAIL 找不到 bot_run.js（' + BOT + '）'); process.exit(1); }

let allPass = true;
const summary = [];

TIERS.forEach(function (tier) {
  const env = Object.assign({}, process.env, { TIER: String(tier), MAX: String(MAXLV), TRIES: String(TRIES) });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [BOT], { cwd: __dirname, env: env, encoding: 'utf8' });
  const ms = Date.now() - t0;

  /* bot_run.js 恒定把结果写进 _bot.txt（不写 stdout），所以要读文件而不是读它的输出 */
  let raw = '';
  try { raw = fs.readFileSync(path.join(__dirname, '_bot.txt'), 'utf8'); } catch (e) { raw = ''; }
  const dump = path.join(__dirname, '_bot_tier' + tier + '.txt');
  try { fs.writeFileSync(dump, raw); } catch (e) { /* 存不下来不影响判定 */ }

  const lines = raw.split(/\r?\n/);
  const failed = lines.filter(function (l) { return l.indexOf('未通过') >= 0; });
  const done = lines.some(function (l) { return l.indexOf('全部通关') >= 0; });
  const ranLevels = (raw.match(/\n\s*T\d+·/g) || []).length;
  const oneShot = (raw.match(/一次到位.*?：\s*(\d+)\s*\/\s*(\d+)/) || [])[1] || '?';

  /* 两种失败都要报：①有一关未通关 ②连「全部通关」这行都没出现（脚本没跑完/文件没写出来） */
  const ok = (failed.length === 0) && done && ranLevels === MAXLV;
  if (!ok) allPass = false;

  console.log((ok ? 'PASS' : 'FAIL') + ' 机器人·' + TIER_NAME[tier] + '档（TIER=' + tier +
    '）1~' + MAXLV + ' 关全通关　一次到位 ' + oneShot + '/' + MAXLV +
    '　实测 ' + ranLevels + ' 关　' + (ms / 1000).toFixed(1) + 's' +
    (ok ? '' : '　→ ' + (failed.length ? failed.slice(0, 5).join('、') : '结果不完整/未跑满')));
  summary.push(TIER_NAME[tier] + ' ' + (ok ? 'OK' : 'FAIL'));

  /* spawnSync 失败（例如 node 起不来）也要暴露，不要静默当成「跑完了」 */
  if (r.error) { allPass = false; console.log('FAIL 机器人·' + TIER_NAME[tier] + '档 子进程起不来：' + r.error.message); }
});

console.log('');
console.log('===== 三档机器人全量体检：' + summary.join(' / ') + ' → ' +
  (allPass ? '全部通关' : '有关卡未通过，需要排查') + ' =====');
process.exit(allPass ? 0 : 1);

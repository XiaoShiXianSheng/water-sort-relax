/* qa_rollback.js —— 回滚验证器（三张铁律里最容易偷懒的那条，这里把它自动化）
 *
 * 一条断言写完，如果**故意把产品代码改坏它也不 FAIL**，那这条断言等于没写（假绿）。
 * 本项目历史上抓到过两次假绿：
 *   ① 断言检查 place==='grid' 的瓶子，但那段绘制逻辑只走台面瓶子 → 断言恒真
 *   ② 命中回转只点瓶子正中心，命中框从 ±52 砍到 ±20 仍然全绿
 *
 * 手工做回滚验证的问题是「容易忘、容易改不回来」。这个脚本把每个用例写成
 * 「(文件, 原文片段, 改坏成什么, 哪个套件的哪条断言必须 FAIL)」，
 * 一条命令跑完，且**每次都用 md5 校验原文件被完整还原**。
 *
 * 用法：node qa_rollback.js
 * 退出码：全部如期 FAIL 且文件已还原 → 0；任何一条没如期 FAIL → 1
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const NODE = process.execPath;
const ROOT = __dirname;
const GAME = path.join(ROOT, 'outputs', '解压水消除.html');

/* 每个用例：把产品代码某处改坏 → 指定套件里必须出现一条匹配 expect 的 FAIL */
const CASES = [
  {
    name: '命中框从 ±52px 砍到 ±20px',
    suite: 'qa_ui.js', expect: /命中回转/,
    find: 'vx>=b.x-52&&vx<=b.x+52&&vy>=b.y-66&&vy<=b.y+56',
    repl: 'vx>=b.x-20&&vx<=b.x+20&&vy>=b.y-66&&vy<=b.y+56'
  },
  {
    name: 'gateFront() 恒返回 true（洞里不再按顺序取）',
    suite: 'qa_ui.js', expect: /每个门洞此刻恰好只有一个瓶子可取/,
    find: 'return b.q<=m;',
    repl: 'return true;   /* rollback-test */'
  },
  {
    name: 'gateFront() 反号（可取的是最深那个）',
    suite: 'qa_design.js', expect: /每个门洞此刻只有一个瓶子可取/,
    find: 'return b.q<=m;',
    repl: 'return b.q>=m;'
  },
  {
    name: '解冻阈值从「四邻空 2 格」放宽到「空 1 格」',
    suite: 'qa_ui.js', expect: /解冻阈值/,
    find: 'for(var d=0;d<4;d++)if(neighborEmpty(b.cell,d))n++;\n    if(n>=2){',
    repl: 'for(var d=0;d<4;d++)if(neighborEmpty(b.cell,d))n++;\n    if(n>=1){'
  },
  {
    name: '冰冻瓶候选放宽（角落/开局已两格空的格子也冻 → 第一帧就化开）',
    suite: 'qa_design.js', expect: /冰冻瓶开局/,
    find: 'if(cb.gate>=0||cellIsCorner(cb.cell))continue;\n'
      + '    var emp=0;\n'
      + '    for(var cd=0;cd<4;cd++)if(neighborEmpty(cb.cell,cd))emp++;\n'
      + '    if(emp>=2)continue;',
    repl: 'if(cb.gate>=0)continue;   /* rollback-test: 放开冰冻候选 */'
  },
  {
    name: 'doUndo() 不回滚水管里的水',
    suite: 'qa_ui.js', expect: /撤销回退后状态逐字段一致/,
    find: "if(!G.history.length||G.undoLeft<=0){toast('没有撤销次数了');SFX.no();return;}\n"
      + '  var s=JSON.parse(G.history.pop());\n'
      + '  for(var i=0;i<G.tubes.length;i++)G.tubes[i].units=s.tubes[i].slice();',
    repl: "if(!G.history.length||G.undoLeft<=0){toast('没有撤销次数了');SFX.no();return;}\n"
      + '  var s=JSON.parse(G.history.pop());\n'
      + '  /* rollback-test: 故意不回滚水管 */'
  },
  {
    name: 'useClear() 漏掉「清掉的那杯倒进同色瓶」',
    suite: 'qa_ui.js', expect: /魔法清除水量守恒/,
    find: 'tgt.fill++;',
    repl: '/* rollback-test: 故意漏掉 tgt.fill++ */'
  },
  /* ---------- 02:00 档新增的 9 条设计断言，逐条做回滚验证 ---------- */
  {
    name: 'levelPlan：放水关不再减量（breathe 恒 false）',
    suite: 'qa_design.js', expect: /放水关真的放水/,
    find: '  var peak=(phase===4), breathe=(phase===0||phase===1);',
    repl: '  var peak=(phase===4), breathe=false;   /* rollback-test */'
  },
  {
    name: 'levelPlan：门洞上限从 4 提到 6（单局操作量天花板失守）',
    suite: 'qa_design.js', expect: /单局操作量天花板/,
    find: 'gates=Math.min(1+Math.floor((t+1)/4),4);',
    repl: 'gates=Math.min(1+Math.floor((t+1)/4),6);   /* rollback-test */'
  },
  {
    name: 'levelPlan：后期台面槽收到 5（槽 < 颜色数）',
    suite: 'qa_design.js', expect: /台面槽 ≥ 颜色数/,
    find: '    slots=Math.min(5+Math.floor(t/8),6);',
    repl: '    slots=Math.min(4+Math.floor(t/8),5);' + '   /* rollback-test */'
  },
  {
    name: 'genLevel：某色瓶数多塞 2 瓶（每色瓶数不均衡）',
    suite: 'qa_design.js', expect: /每色瓶数均衡/,
    find: '    var pn=perBase+(pc<perRem?1:0);',
    repl: '    var pn=perBase+(pc<perRem?1:0);if(pc===0)pn+=2;' + '   /* rollback-test */'
  },
  {
    name: 'genLevel：冰冻瓶候选放开「洞里不冻」的限制',
    suite: 'qa_design.js', expect: /冰冻瓶绝不藏在门洞里/,
    find: 'if(cb.gate>=0||cellIsCorner(cb.cell))continue;',
    repl: 'if(cellIsCorner(cb.cell))continue;' + '   /* rollback-test */'
  },
  {
    name: 'pickGateDirs：洞口方向直接取「所有界内方向」',
    suite: 'qa_design.js', expect: /洞口朝向合法/,
    find: '      var pick=fresh.length?fresh:(occD.length?occD:(freeD.length?freeD:inD));',
    repl: '      var pick=inD;' + '   /* rollback-test */'
  },
  {
    name: '门洞塞瓶数从 2~3 摊成固定 4 瓶',
    suite: 'qa_design.js', expect: /每个门洞藏 2~3 个瓶子/,
    find: 'for(var gk=0;gk<maxGates;gk++){var w=2+((cfg>>gk)&1);ws.push(w);es+=w-1;}',
    repl: 'for(var gk=0;gk<maxGates;gk++){var w=4;ws.push(w);es+=w-1;}' + '   /* rollback-test */'
  },
  {
    name: 'levelPlan：极限档 tier>=2 整段失效（极限 == 困难）',
    suite: 'qa_design.js', expect: /三档挑战严格更难/,
    find: '  if(tier>=2){',
    repl: '  if(tier>=2&&false){' + '   /* rollback-test */'
  },
  {
    name: '教学关的挑战档把棋盘改大到 20 格 / 5 管',
    suite: 'qa_design.js', expect: /教学关的极限档/,
    find: '  if(tier>0&&lv<=3){cells=12;colors=4;gates=1;ice=0;slots=5;tubes=3;}',
    repl: '  if(tier>0&&lv<=3){cells=20;colors=4;gates=1;ice=0;slots=5;tubes=5;}' + '   /* rollback-test */'
  },
  /* ---------- FIX-02：结算弹窗的三档方块从「纯展示」变成「可点」 ---------- */
  {
    name: '结算弹窗三档方块：删掉命中判定（方块又退回纯展示）',
    suite: 'qa_ui.js', expect: /FIX-02a：结算弹窗点「困难」方块/,
    find: 'if(vx>=tbx-58&&vx<=tbx+58&&vy>=712&&vy<=780){',
    repl: 'if(false){'
  },

  /* ---------- 05:00 档新增：性能之外的两件事（修 flaky + 上线门禁）----------
     注意：下面几条有的改的是**测试文件**、有的是**发布件**、有的干脆不改文件而是给一个
     「线上是旧版」的场景 —— 所以用例支持 file（默认主文件）/ noPatch / liveTamper 三个开关。 */
  {
    name: '冒烟后不还原档位（脏档放行 → 后面一整簇普通档断言失真）',
    file: 'test_water.js',
    suite: 'test_water.js', expect: /冒烟随机点击后档位已还原/,
    find: '  DBG.G.tier = 0;                                   // ← 还原为普通档（这一行是后续所有普通档断言的前提）',
    repl: '  DBG.G.tier = 1;   /* rollback-test: 故意不还原 */'
  },
  {
    name: '门禁 G3：主文件膨胀到 200KB 以上',
    suite: 'qa_gate.js', expect: /单文件体积.*→ \d+(\.\d+)?KB \/ 上限 200KB/,
    find: '<script>',
    repl: '<script>/*' + 'pad'.repeat(25000) + '*/'      /* 注释填充：ES5 扫描会剥掉，所以只影响体积这一条 */
  },
  {
    name: '门禁 G4：代码里混进箭头函数（老 WebView 直接语法报错）',
    suite: 'qa_gate.js', expect: /→ 箭头函数/,
    find: "var bg=document.createElement('canvas');",
    repl: "var bg=document.createElement('canvas');var __rbRollback=()=>1;"
  },
  {
    name: '门禁 G5：混进一个外部 <script src>',
    suite: 'qa_gate.js', expect: /→ .*script src/,
    find: '<script>',
    repl: '<script src="https://cdn.example.com/analytics.js"></script>\n<script>'
  },
  {
    name: '门禁 G6：layoutSolvable 恒返回 false（可解性判据被短路）',
    suite: 'qa_gate.js', expect: /不可解：L1/,
    find: 'for(key in occ)return false;',
    repl: 'for(key in occ)return false;return false;   /* rollback-test */'
  },
  {
    name: '门禁 G8a：改了主文件没同步发布件',
    file: 'publish_water/index.html',
    suite: 'qa_gate.js', expect: /≠ 发布件/,
    find: '</body>',
    repl: '<!--rollback-test: 发布件落后于主文件--></body>'
  },
  {
    name: '门禁 G8b：线上跑的是旧版（本地起一个故意不一致的站点）',
    suite: 'qa_gate.js', expect: /线上是旧版或没同步/,
    noPatch: true, liveTamper: true
  },
  {
    /* 真实事故：全局 core.autocrlf=true，一次 git rebase 就把主文件写成 CRLF、
       发布件与线上还是 LF → 门禁翻红，但内容一模一样。这条既验证 G8a 会 FAIL，
       也验证「只差换行符」那句诊断还在（不然下次又得查半天）。 */
    name: '门禁 G8a：发布件只差换行符（CRLF vs LF，内容一致但字节不等）',
    file: 'publish_water/index.html',
    suite: 'qa_gate.js', expect: /只差换行符/,
    crlfTamper: true
  }
];

function md5(s) { return crypto.createHash('md5').update(s, 'utf8').digest('hex'); }

function runSuite(file, env) {
  const r = cp.spawnSync(NODE, [path.join(ROOT, file)], {
    cwd: ROOT, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, env || {})
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = out.match(/^FAIL\b.*$/gm) || [];
  const pass = (out.match(/^PASS\b/gm) || []).length;
  return { out: out, fails: fails.map(x => x.replace(/^FAIL\s+/, '')), pass: pass, rc: r.status };
}

/* 每个用例可以指定 file（默认主文件）；文件内容与 md5 按需惰性读一次，用完必须还原 */
const fileCache = {};
function origOf(f) {
  const p = path.join(ROOT, f);
  if (!fileCache[f]) {
    const txt = fs.readFileSync(p, 'utf8');
    fileCache[f] = { path: p, text: txt, hash: md5(txt) };
  }
  return fileCache[f];
}

/* 「线上是旧版」这个场景：起一个**独立进程**的站点，内容与发布件不同。
   坑（第一次就踩了）：不能在父进程里起服务器 —— 父进程随即 spawnSync 跑子进程，
   事件循环被阻塞，服务器根本 accept 不到连接，qa_gate 只能超时失败。
   那样虽然也 FAIL，但验的是「取不到线上」而不是「线上不一致」，属于假绿。 */
const HELPER_CODE = [
  'var http=require("http"),fs=require("fs"),path=require("path");',
  'var pub=fs.readFileSync(path.join(process.env.TAMPER_ROOT,"publish_water","index.html"),"utf8");',
  'var t=pub.replace("</body>","<!--rollback-test: live is stale--></body>");',
  'var s=http.createServer(function(q,r){r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});r.end(t);});',
  's.listen(0,"127.0.0.1",function(){console.log("PORT="+s.address().port);});'
].join('');
function startTamperServer() {
  return new Promise(resolve => {
    const env = Object.assign({}, process.env, { TAMPER_ROOT: ROOT });
    const proc = cp.spawn(NODE, ['-e', HELPER_CODE], { env: env, stdio: ['ignore', 'pipe', 'ignore'] });
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    proc.stdout.on('data', d => {
      const m = String(d).match(/PORT=(\d+)/);
      if (m) finish({ proc: proc, url: 'http://127.0.0.1:' + m[1] + '/' });
    });
    proc.on('error', () => finish({ proc: null, url: null }));
    proc.on('exit', () => finish({ proc: null, url: null }));
    setTimeout(() => finish({ proc: proc, url: null }), 8000);
  });
}

const DEFAULT_FILE = 'outputs/解压水消除.html';
const origHash = origOf(DEFAULT_FILE).hash;

console.log('===== 回滚验证  ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '  =====');
console.log('（做法：把产品代码故意改坏 → 跑对应套件 → 必须看到指定断言 FAIL → 用 md5 校验原文件已还原）');
console.log('');

let bad = 0;
const rows = [];

/* 顶层 await 在 CommonJS 里不可用，而 liveTamper 用例要起本地服务器 → 包一层 async */
(async function main() {
for (const c of CASES) {
  const f = c.file || DEFAULT_FILE;
  const O = origOf(f);
  const original = O.text;

  let env = c.env || {};
  let tamper = null;
  if (c.liveTamper) {
    tamper = await startTamperServer();
    if (!tamper.url) {
      bad++;
      rows.push({ ok: false, name: c.name, why: '起不了本地篡改站点，这条用例没跑（不能算通过）' });
      if (tamper.proc) { try { tamper.proc.kill(); } catch (e) { } }
      continue;
    }
    env = Object.assign({}, env, { LIVE_URL: tamper.url });
  }

  let r = null, err = null;
  try {
    if (c.crlfTamper) {
      /* 整个文件强转 CRLF：模拟「git 把工作区换行改了」这一类事故 */
      fs.writeFileSync(O.path, original.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
    } else if (!c.noPatch) {
      const hits = original.split(c.find).length - 1;
      if (hits !== 1) {
        bad++;
        rows.push({
          ok: false, name: c.name,
          why: '原文片段在 ' + f + ' 里出现 ' + hits + ' 次（应为 1 次）—— 文件改过？请更新回滚用例'
        });
        continue;
      }
      fs.writeFileSync(O.path, original.replace(c.find, c.repl), 'utf8');
    }
    r = runSuite(c.suite, env);
  } catch (e) {
    err = e;
  } finally {
    if (!c.noPatch) fs.writeFileSync(O.path, original, 'utf8');
    if (tamper && tamper.proc) { try { tamper.proc.kill(); } catch (e) { } }
  }

  const restored = md5(fs.readFileSync(O.path, 'utf8')) === O.hash;
  if (!restored) { bad++; rows.push({ ok: false, name: c.name, why: f + ' 没能还原（md5 不一致）！' }); continue; }
  if (err) { bad++; rows.push({ ok: false, name: c.name, why: '套件跑崩：' + err.message }); continue; }

  const hit = r.fails.filter(x => c.expect.test(x));
  rows.push({
    ok: hit.length > 0, name: c.name, why: hit.length
      ? '如期 FAIL「' + hit[0].slice(0, 70) + '」（该套件 ' + r.pass + ' PASS / ' + r.fails.length + ' FAIL）'
      : '❌ 改坏了却没有对应 FAIL（该套件 ' + r.pass + ' PASS / ' + r.fails.length + ' FAIL）→ 这条断言是假绿'
  });
  if (hit.length === 0) bad++;
}

rows.forEach(x => console.log((x.ok ? '  ✔ ' : '  ✘ ') + x.name + '\n      ' + x.why));
console.log('');
console.log('===== 回滚验证：' + rows.filter(x => x.ok).length + '/' + rows.length
  + ' 个用例如期 FAIL 且原文件已还原' + (bad ? '，有 ' + bad + ' 个异常' : '') + ' =====');
console.log('（原文件 md5 ' + origHash.slice(0, 12) + '，校验通过：'
  + (md5(fs.readFileSync(origOf(DEFAULT_FILE).path, 'utf8')) === origHash) + '）');
process.exit(bad ? 1 : 0);
})();

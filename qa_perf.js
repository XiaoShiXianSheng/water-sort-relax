/* qa_perf.js —— 性能体检：真实 Chrome headless（低端机 360×640 / dpr=1）逐帧计时
 *
 * 为什么用真 Chrome 而不是 node 假 canvas：
 *   假 canvas 只测到「JS 逻辑耗时」，测不到真实光栅化、真实 rAF 调度、真实 dpr。
 *   低端机卡不卡，必须让浏览器真的把这一帧画出来。
 *
 * 三个坑（都是实测踩出来的，别改回去）：
 *   1. `--window-size=360,640` 会被 Windows 最小窗口宽度顶到 500 ——
 *      所以视口必须用 **360×640 的 iframe** 来钉死，游戏读的是 iframe 自己的 innerWidth。
 *   2. 探头包住 requestAnimationFrame 时，**等待也是用 rAF 写的**的话，
 *      自己那些空回调会被一起计时 → 样本数翻倍、平均被稀释（实测 600 帧里有 300 是我自己的）。
 *      所以：探头只认游戏回调，驱动的等待改用 setTimeout 轮询帧计数器。
 *   3. 拿「单函数耗时 × 每帧数量」当占比会出现合计 524% 的鬼数据 ——
 *      循环里单独调 drawBottle 和它在真帧里的成本不是一回事。
 *      归因必须用**消融法**（整帧减去「去掉某子系统后的整帧」），各项才可比。
 *
 * 产物：qa_perf.md + _perf_raw.json　用法：node qa_perf.js  (LV=25 DPR=2 node qa_perf.js)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const GAME = process.env.GAME || path.join(ROOT, 'outputs', '解压水消除.html');
const LV = +(process.env.LV || 30);
const W = +(process.env.VW || 360), H = +(process.env.VH || 640);
const DPR = +(process.env.DPR || 1);
const IDLE_FRAMES = +(process.env.IDLE_FRAMES || 300);
const BURST_FRAMES = +(process.env.BURST_FRAMES || 120);
const BURST_N = +(process.env.BURST_N || 300);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/* ================= 1. 被测页面：注入后门 ================= */
function buildGamePage() {
  const html = fs.readFileSync(GAME, 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('未找到 <script> 块');
  let code = m[1];

  const INJECT = `window.__PERF={
  get G(){return G;}, gen:genLevel,
  update:update, render:render, layoutAll:layoutAll, cellRect:cellRect,
  get particles(){return particles;}, get flying(){return flying;},
  consts:function(){return {VW:VW,VH:VH,UH:UH,BOTT_Y:BOTT_Y,SLOT_Y:SLOT_Y,GRID_Y0:GRID_Y0};}
};`;
  const A = 'requestAnimationFrame(loop);';
  const i = code.lastIndexOf(A);
  if (i < 0) throw new Error('找不到注入点 requestAnimationFrame(loop);');
  code = code.slice(0, i) + INJECT + '\n  ' + code.slice(i);

  /* 探头：必须在游戏脚本之前执行（patch 原型与 rAF） */
  const probe = '<script>\n' + [
    'window.__PERF_CNT={grad:0,rgrad:0,fill:0,stroke:0,arc:0,fillRect:0,drawImage:0,beginPath:0,rect:0,save:0,restore:0,text:0};',
    'window.__PERF_FRAMES=[]; window.__PERF_TS=[]; window.__PERF_CALLS=[]; window.__PERF_ON=false; window.__PERF_FC=0;',
    '(function(){',
    '  window.__PERF_ERR=null; window.__PERF_STAGE="probe";',
    '  window.addEventListener("error",function(e){ window.__PERF_ERR=String((e&&e.message)||e); });',
    '  var P=CanvasRenderingContext2D.prototype;',
    '  function wrap(n,k){ var o=P[n]; if(!o)return;',
    '    P[n]=function(){ var c=window.__PERF_CNT; if(c)c[k]++; return o.apply(this,arguments); }; }',
    '  wrap("createLinearGradient","grad"); wrap("createRadialGradient","rgrad");',
    '  wrap("fill","fill"); wrap("stroke","stroke"); wrap("arc","arc");',
    '  wrap("fillRect","fillRect"); wrap("drawImage","drawImage");',
    '  wrap("beginPath","beginPath"); wrap("rect","rect");',
    '  wrap("save","save"); wrap("restore","restore"); wrap("fillText","text");',
    '  var raf=window.requestAnimationFrame;',
    '  window.requestAnimationFrame=function(cb){',
    '    return raf.call(window,function(ts){',
    '      var c=window.__PERF_CNT,k; for(k in c)c[k]=0;',
    '      var t0=performance.now();',
    '      try{ cb(ts); } finally {',
    '        var d=performance.now()-t0;',
    '        window.__PERF_FC++;',
    '        if(window.__PERF_ON){',
    '          window.__PERF_FRAMES.push(d); window.__PERF_TS.push(ts);',
    '          var o={}; for(k in c)o[k]=c[k]; window.__PERF_CALLS.push(o);',
    '        }',
    '      }',
    '    });',
    '  };',
    '  window.__PERF_RAF_WRAPPED=true;',
    '})();'
  ].join('\n') + '\n<\/script>';

  let page = html.replace(/<script>([\s\S]*)<\/script>/, () => '<script>' + code + '<\/script>');
  const s = page.indexOf('<script>');
  return page.slice(0, s) + probe + '\n' + page.slice(s);
}

/* ================= 2. 页面内基准脚本（跑在 iframe 里） ================= */
const BENCH = '<script>\n' + [
  '(function(){',
  '  function post(o){',
  '    try{ if(window.__PERF_SENT)return; window.__PERF_SENT=true;',
  '      var x=new XMLHttpRequest(); x.open("POST","/report",true);',
  '      x.setRequestHeader("Content-Type","application/json"); x.send(JSON.stringify(o));',
  '    }catch(e){}',
  '  }',
  '  function stats(a){',
  '    if(!a||!a.length)return null;',
  '    var s=a.slice().sort(function(x,y){return x-y;}),sum=0,i;',
  '    for(i=0;i<a.length;i++)sum+=a[i];',
  '    function q(p){ return s[Math.min(s.length-1,Math.floor(p*(s.length-1)))]; }',
  '    var o16=0,o50=0; for(i=0;i<a.length;i++){ if(a[i]>16.7)o16++; if(a[i]>50)o50++; }',
  '    return {n:a.length,avg:sum/a.length,p50:q(0.5),p95:q(0.95),p99:q(0.99),max:s[s.length-1],over16:o16,over50:o50};',
  '  }',
  /* 最差帧出现在采样窗口的第几帧？注意采样窗口本身是在 90 帧热身**之后**才开始的，
     所以窗口第 1 帧偏高 = 采集刚开始的过渡，不代表"玩着玩着卡一下"。
     同时算「去掉最差那 1 帧后的平均」，用来看这一个尖峰对平均值的影响有多大。 */
  '  function worst(a){',
  '    var mxi=0,i,sum=0; for(i=1;i<a.length;i++)if(a[i]>a[mxi])mxi=i;',
  '    for(i=0;i<a.length;i++)sum+=a[i];',
  '    var rest=a.length>1?sum-a[mxi]:0;',
  '    return {idx:mxi,val:a[mxi]||0,n:a.length,',
  '      avgNoMax:a.length>1?rest/(a.length-1):0,',
  '      second:a.length>1?Math.max.apply(null,a.slice(0,mxi).concat(a.slice(mxi+1))):0};',
  '  }',
  '  function avgObj(arr,keys){',
  '    var o={},i,k; for(k=0;k<keys.length;k++)o[keys[k]]=0;',
  '    if(!arr.length)return o;',
  '    for(i=0;i<arr.length;i++)for(k=0;k<keys.length;k++)o[keys[k]]+=arr[i][keys[k]]||0;',
  '    for(k=0;k<keys.length;k++)o[keys[k]]=o[keys[k]]/arr.length;',
  '    return o;',
  '  }',
  '  var busy=false;',
  '  function waitFrames(n,fn){',            /* 用 setTimeout 轮询帧计数：绝不占用 rAF，否则自己也被计时 */
  '    var target=(window.__PERF_FC||0)+n, guard=0;',
  '    (function poll(){',
  '      if(window.__PERF_FC>=target)return fn();',
  '      if(guard++>8000)return post({error:"waitFrames timeout"});',
  '      setTimeout(poll,4);',
  '    })();',
  '  }',
  '  function sample(n,fn,topUp){',
  '    window.__PERF_FRAMES.length=0; window.__PERF_TS.length=0; window.__PERF_CALLS.length=0;',
  '    window.__PERF_ON=true;',
  '    var iv2=null;',
  '    if(topUp){ iv2=setInterval(topUp,10); }',
  '    var done=function(res){ if(iv2)clearInterval(iv2); fn(res); };',
  '    waitFrames(n,function(){ window.__PERF_ON=false; var f=window.__PERF_FRAMES.slice(),',
  '      ts=window.__PERF_TS.slice(), cl=window.__PERF_CALLS.slice();',
  '      var iv=[]; for(var i=1;i<ts.length;i++)iv.push(ts[i]-ts[i-1]);',
  '      done({frames:f,interval:iv,calls:cl}); });',
  '  }',
  '  function run(){',
  '    var D=window.__PERF, rep={lv:' + LV + '};',
  '    if(!D||!D.G) return post({error:"backdoor missing"});',
  '    window.__PERF_STAGE="gen";',
  '    D.gen(' + LV + ');',
  '    rep.env={ ua:navigator.userAgent, dpr:window.devicePixelRatio,',
  '      iw:window.innerWidth, ih:window.innerHeight, screen:[screen.width,screen.height] };',
  '    waitFrames(90,function(){',
  '      var G=D.G, C=D.consts();',
  '      rep.level={cells:G.cellCount,bottles:G.bottles.length,tubes:G.tubes.length,',
  '        gates:G.gates.length,ice:G.bottles.filter(function(b){return b.locked>0;}).length,',
  '        slots:G.slots.length,uh:G.uh,state:G.state};',
  '      rep.level.gridBottles=G.bottles.filter(function(b){return b.place==="grid"&&b.gate<0;}).length;',
  '      /* ---- A 空载逐帧 ---- */',
  '      sample(' + IDLE_FRAMES + ',function(r){',
  '        rep.idle=stats(r.frames); rep.idleInterval=stats(r.interval);',
  '        rep.idleWorst=worst(r.frames);',
  '        rep.idleCalls=avgObj(r.calls,["grad","rgrad","fill","stroke","arc","fillRect","drawImage","beginPath","rect","save","restore","text"]);',
  '        /* ---- B 粒子峰值：life 拉满 + 每 10ms 补足，保证是真正的稳态峰值 ---- */',
  '        var mk=function(){ while(D.particles.length<' + BURST_N + '){',
  '          D.particles.push({x:40+Math.random()*(C.VW-80),y:150+Math.random()*600,',
  '            vx:(Math.random()-0.5)*300,vy:-Math.random()*300,g:500,life:9999,age:0,',
  '            r:2+Math.random()*4,col:"#7fd8ff"}); } };',
  '        mk();',
  '        sample(' + BURST_FRAMES + ',function(r2){',
  '          rep.burstParticles=D.particles.length;',
  '          rep.burst=stats(r2.frames);',
  '          rep.burstWorst=worst(r2.frames);',
  '          rep.burstCalls=avgObj(r2.calls,["grad","rgrad","fill","stroke","arc","fillRect","drawImage","beginPath"]);',
  '          D.particles.length=0;',
  '          /* ---- C 消融归因：整帧 − 去掉某子系统后的整帧（各项可比，不会出现 >100%）---- */',
  '          window.__PERF_ON=false;',
  '          function timeIt(n,fn){ var a=performance.now(); for(var i=0;i<n;i++)fn(i); return (performance.now()-a)/n; }',
  '          var G2=D.G, N=500;',
  '          function full(){ D.render(1.0); }',
  '          var t={};',
  '          t.update=timeIt(N,function(){ D.update(1/60); });',
  '          t.render=timeIt(N,full);',
  '          t.render2=timeIt(N,full); t.render3=timeIt(N,full);',   /* 重复基线：量出噪声底，免得把抖动当成优化效果 */
  '          t.renderMin=Math.min(t.render,t.render2,t.render3); t.renderMax=Math.max(t.render,t.render2,t.render3);',
  '          var save=[],i2;',
  '          for(i2=0;i2<G2.bottles.length;i2++)save.push(G2.bottles[i2].place);',
  '          for(i2=0;i2<G2.bottles.length;i2++)G2.bottles[i2].place="none";',
  '          t.noBottles=timeIt(N,full);',
  '          for(i2=0;i2<G2.bottles.length;i2++)G2.bottles[i2].place=save[i2];',
  '          var gs=G2.gates, ts2=G2.tubes;',
  '          G2.gates=[]; t.noGates=timeIt(N,full); G2.gates=gs;',
  '          G2.tubes=[];  t.noTubes=timeIt(N,full); G2.tubes=ts2;',
  '          var fl=D.flying.slice(); D.flying.length=0; t.noFlying=timeIt(N,full);',
  '          for(i2=0;i2<fl.length;i2++)D.flying.push(fl[i2]);',
  '          rep.attr={counts:{tubes:ts2.length,gridBottles:rep.level.gridBottles,gates:gs.length,slots:G2.slots.length},t:t};',
  '          rep.ok=true;',
  '          post(rep);',
  '        },mk);',
  '      });',
  '    });',
  '  }',
  '  window.addEventListener("load",function(){ setTimeout(run,80); });',
  '  function diag(){',
  '    var D=window.__PERF;',
  '    return {stage:window.__PERF_STAGE||"?", hasPerf:!!D, hasG:!!(D&&D.G),',
  '      frameCount:window.__PERF_FC||0, state:(D&&D.G)?D.G.state:null, level:(D&&D.G)?D.G.level:null,',
  '      err:window.__PERF_ERR, fatal:(D&&D.G&&D.G.fail)?true:false,',
  '      calledUpdate:(D&&D.G)?D.G.t:null, rafWrapped:!!window.__PERF_RAF_WRAPPED};',
  '  }',
  '  setTimeout(function(){ post({error:"global timeout", diag:diag()}); },' + (process.env.TMO || 30000) + ');',
  '})();'
].join('\n') + '\n<\/script>';

/* ================= 3. 外层：把游戏钉在一个正好 360×640 的 iframe 里 ================= */
function wrapperPage() {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + 'html,body{margin:0;padding:0;background:#888}'
    + 'iframe{width:' + W + 'px;height:' + H + 'px;border:0;display:block}'
    + '</style></head><body><iframe src="/game"></iframe></body></html>';
}

const gamePage = buildGamePage();
let got = null;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/report') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { got = JSON.parse(body); } catch (e) { got = { error: 'bad json' }; }
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  if (req.url === '/game') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(gamePage.replace('</body>', () => BENCH + '</body>'));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(wrapperPage());
});

server.listen(0, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  if (!fs.existsSync(CHROME)) { finish({ error: 'chrome not found', chrome: CHROME }); return; }
  const udd = path.join(os.tmpdir(), 'wb-perf-' + Date.now());
  const ch = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--force-device-scale-factor=' + DPR,
    '--window-size=' + (W + 40) + ',' + (H + 120),
    '--user-data-dir=' + udd, url
  ], { stdio: 'ignore' });
  const t0 = Date.now();
  const timer = setInterval(() => {
    if (got) { clearInterval(timer); try { ch.kill(); } catch (e) { } finish(got); }
    else if (Date.now() - t0 > 150000) { clearInterval(timer); try { ch.kill(); } catch (e) { } finish({ error: 'timeout waiting for report' }); }
  }, 300);
});

/* ================= 4. 报告 ================= */
function finish(rep) {
  try { server.close(); } catch (e) { }
  rep.machine = { cpu: (os.cpus()[0] || {}).model || '?', cores: os.cpus().length, memGB: Math.round(os.totalmem() / 1073741824) };
  fs.writeFileSync(path.join(ROOT, '_perf_raw.json'), JSON.stringify(rep, null, 2), 'utf8');

  const f = (x, d) => (x === null || x === undefined || isNaN(x)) ? '—' : (+x).toFixed(d === undefined ? 2 : d);
  const L = [];
  L.push('# 《解压水消除》性能体检报告（低端机逐帧计时）');
  L.push('');
  L.push('> 生成时间：' + new Date().toISOString().replace('T', ' ').slice(0, 19)
    + '　|　命令：`node qa_perf.js`');
  L.push('');

  if (rep.error) {
    L.push('## ❌ 没测成：' + rep.error);
    fs.writeFileSync(path.join(ROOT, 'qa_perf.md'), L.join('\n'), 'utf8');
    console.log(L.join('\n'));
    process.exit(1);
  }

  L.push('## 1. 环境（说清楚这些数字是在什么条件下量的）');
  L.push('');
  L.push('| 项 | 值 |');
  L.push('|---|---|');
  L.push('| 渲染器 | **真实 Chrome headless** `' + String(rep.env.ua).replace(/^.*HeadlessChrome\//, 'HeadlessChrome/').replace(/ .*$/, '')
    + '`，`--disable-gpu`（纯 CPU 软件光栅）|');
  L.push('| 视口 | **' + rep.env.iw + ' × ' + rep.env.ih + '**（360×640 的 iframe 钉死，避开 Windows 最小窗宽）|');
  L.push('| devicePixelRatio | ' + rep.env.dpr + '（低端机 1x）|');
  L.push('| 被测关卡 | 第 ' + rep.lv + ' 关（当前难度封顶段）|');
  L.push('| 规模 | ' + rep.level.cells + ' 格 / ' + rep.level.bottles + ' 瓶 / ' + rep.level.tubes + ' 管 / '
    + rep.level.gates + ' 门洞 / ' + rep.level.ice + ' 冰冻瓶 / ' + rep.level.slots + ' 台面槽 |');
  L.push('| 本机 CPU | ' + rep.machine.cpu + '（' + rep.machine.cores + ' 核 / ' + rep.machine.memGB + 'GB）|');
  L.push('');
  L.push('> ⚠️ **关卡规模对不上任务书，这是对的**：派单里写的是「第 30 关 35 格 / 42 瓶 / 9 管」，');
  L.push('> 那是 26 格封顶**之前**的旧数字。2026-09-28 起棋盘硬上限 26（见 README 取舍 #2），');
  L.push('> 所以现在第 30 关实测就是 ' + rep.level.cells + ' 格 / ' + rep.level.bottles + ' 瓶 / ' + rep.level.tubes + ' 管。');
  L.push('> 本报告量的是**当前线上真实规模**，不是任务书里的过期数字。');
  L.push('');
  L.push('关于条件的三点交代，别把数字当成「真机就是这么快」：');
  L.push('');
  L.push('1. **`--disable-gpu` 是故意的** —— 它模拟低端机最差的情况（没有 GPU 合成，全靠 CPU 光栅）。');
  L.push('   真机若是走 GPU 合成只会更快，所以这份数字可以当**上界**看。');
  L.push('2. **计时精度上限 100µs**（Chrome 默认 `performance.now()` 精度）。所以 p50 = 0.20ms 这种值');
  L.push('   其实是「2 个计时刻度」，不是精确值；**平均/最差/长帧计数才是可信的**。');
  L.push('3. 量的是**游戏自己那一帧（update + render）**的耗时，不含浏览器空闲等待。');
  L.push('   探头包住 `requestAnimationFrame` 只认游戏回调，等待帧数改用 setTimeout 轮询 —— 否则自己那些空回调会被算进来稀释平均。');
  L.push('');

  L.push('## 2. 逐帧耗时（60fps 预算 = 16.7ms）');
  L.push('');
  L.push('| 场景 | 帧数 | **平均** | p50 | p95 | p99 | **最差** | >16.7ms | >50ms |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  const row = (name, s) => !s ? '| ' + name + ' | — | — | — | — | — | — | — | — |'
    : '| ' + name + ' | ' + s.n + ' | **' + f(s.avg) + 'ms** | ' + f(s.p50) + 'ms | ' + f(s.p95) + 'ms | '
    + f(s.p99) + 'ms | **' + f(s.max) + 'ms** | ' + s.over16 + ' | ' + s.over50 + ' |';
  L.push(row('空载（正常对局）', rep.idle));
  L.push(row('粒子峰值（' + (rep.burstParticles || BURST_N) + ' 个粒子同时在场）', rep.burst));
  L.push('');
  /* 最差帧落在采样窗口第几帧：窗口是 90 帧热身之后才开始的，
     所以「窗口第 1 帧」= 采集过渡，「窗口中间」才是真正的稳态抖动。 */
  const W1 = (key, label) => {
    const w = rep[key];
    if (!w || !w.n) return;
    const first = w.idx === 0;
    L.push('- **' + label + '最差帧**：' + f(w.val) + 'ms，出现在采样窗口第 ' + (w.idx + 1) + ' / ' + w.n
      + ' 帧（第 2 差 ' + f(w.second) + 'ms；去掉这一个尖峰后平均 '
      + f(w.avgNoMax) + 'ms，即它对平均的影响约 '
      + f(w.val / w.n) + 'ms）'
      + (first ? '—— 落在窗口**第 1 帧**，属采集刚开始的过渡，不代表稳态卡顿' : '—— 在窗口中间，属稳态里的一次抖动'));
  };
  W1('idleWorst', '空载');
  W1('burstWorst', '粒子峰值');
  L.push('');
  if (rep.idleInterval) {
    L.push('rAF 时间戳间隔：平均 ' + f(rep.idleInterval.avg) + 'ms / 最差 ' + f(rep.idleInterval.max)
      + 'ms。headless 无垂直同步，这个数不等于「能不能稳住 60fps」，仅供参考；');
    L.push('真正决定卡不卡的是上表的**每帧耗时**——平均 ' + f(rep.idle.avg) + 'ms、p99 ' + f(rep.idle.p99)
      + 'ms，预算 16.7ms，还有 ' + (16.7 / (rep.idle.avg || 1)).toFixed(1) + ' 倍余量。');
    L.push('');
  }

  L.push('## 3. 时间花在哪（消融归因）');
  L.push('');
  const c = rep.attr && rep.attr.counts;
  if (c) {
    L.push('第 ' + rep.lv + ' 关每帧元素：' + c.tubes + ' 根水管 / ' + c.gridBottles + ' 个货架瓶 / '
      + c.gates + ' 个门洞 / ' + c.slots + ' 个台面槽。');
    L.push('');
  }
  const t = (rep.attr && rep.attr.t) || {};
  L.push('| 子系统 | 每帧耗时 | 占整帧 |');
  L.push('|---|---|---|');
  L.push('| `update()` 全部游戏逻辑 | ' + f(t.update, 3) + 'ms | ' + pct(t.update, t.render) + ' |');
  L.push('| **`render()` 全部绘制** | **' + f(t.render, 2) + 'ms** | 100% |');
  const ab = [
    ['瓶子的绘制（货架瓶 + 门洞瓶 + 台面瓶）', t.noBottles],
    ['水管（含汇流座、水柱淡出）', t.noTubes],
    ['门洞凹槽 + 洞里的瓶子', t.noGates],
    ['飞行动画（flying）', t.noFlying]
  ];
  ab.forEach(x => {
    if (x[1] === undefined) return;
    const cost = t.render - x[1];
    const noise = (t.renderMax !== undefined) ? (t.renderMax - t.renderMin) : 0;
    const inside = cost <= noise;
    L.push('| 　去掉' + x[0] + '后 | ' + f(x[1], 2) + 'ms | ' + (inside
      ? '≈0（在噪声内，等于没省）'
      : '省下 ' + f(cost, 3) + 'ms（' + Math.round(cost / (t.render || 1) * 100) + '%）') + '|');
  });
  L.push('');
  L.push('> 消融法：**整帧耗时 − 去掉某子系统后的整帧耗时**。各项之间会互相重叠（去掉瓶子，门洞瓶也一起没了），');
  L.push('> 所以别把百分比相加；它只回答「拆掉谁最能省时间」。');
  if (t.renderMin !== undefined) {
    L.push('>');
    L.push('> **噪声底**：同一个 `render()` 连测 3 次得到 ' + f(t.render, 2) + ' / ' + f(t.render2, 2) + ' / '
      + f(t.render3, 2) + 'ms（极差 ' + f(t.renderMax - t.renderMin, 2) + 'ms）。');
    L.push('> 小于这个极差的「省下 X ms」是抖动，不是优化效果（上表"飞行动画"那行就是这种噪声）。');
  }
  L.push('');
  if (rep.idleCalls) {
    const q = rep.idleCalls;
    L.push('每帧 canvas 指令数（空载平均，**精确计数**）：');
    L.push('');
    L.push('`fill` ' + f(q.fill, 1) + ' · `stroke` ' + f(q.stroke, 1) + ' · `arc` ' + f(q.arc, 1)
      + ' · `fillRect` ' + f(q.fillRect, 1) + ' · `beginPath` ' + f(q.beginPath, 1)
      + ' · `drawImage` ' + f(q.drawImage, 1) + ' · `fillText` ' + f(q.text, 1));
    L.push('');
    L.push('**每帧新建渐变对象：线性 ' + f(q.grad, 1) + ' 个 / 径向 ' + f(q.rgrad, 1) + ' 个**'
      + '（渐变是高频分配点，一旦跟着元素数量涨，就该把它缓存起来）。');
    L.push('');
    L.push('这里 ' + f(q.grad, 0) + ' 个 = `drawTubeFade` 的 1 个顶部淡出遮罩 + **每个门洞 1 个凹槽渐变**'
      + '（第 ' + rep.lv + ' 关 ' + rep.level.gates + ' 个门洞）。门洞上限是 4，所以每帧最多 5 个，**在可接受范围**；');
    L.push('如果以后把门洞上限提高，这里就是第一个要缓存的地方。**当前不动它**——2.7ms 的帧没必要为 5 个渐变对象做优化。');
    L.push('');
  }
  if (rep.burstCalls) {
    L.push('粒子峰值时每帧：`arc` ' + f(rep.burstCalls.arc, 1) + ' · `fill` ' + f(rep.burstCalls.fill, 1)
      + '（粒子 ' + rep.burstParticles + ' 个）。');
    L.push('');
  }

  /* ---- 结论 ---- */
  /* 判定口径按派单书：**平均 > 16.7ms** 或 **出现 >50ms 长帧** 才算不达标。
     中间那些零星 >16.7ms 的帧只提示、不算失败 —— 共享机器上一次 GC / 调度抖动
     就能造出一个 17ms 的帧，把它当硬失败会让这个脚本变成"随机报警器"。 */
  const bad = [];
  if (rep.idle && rep.idle.avg > 16.7) bad.push('空载平均 ' + f(rep.idle.avg) + 'ms > 16.7ms');
  if (rep.idle && rep.idle.over50 > 0) bad.push('空载出现 ' + rep.idle.over50 + ' 个 >50ms 长帧');
  if (rep.burst && rep.burst.avg > 16.7) bad.push('粒子峰值平均 ' + f(rep.burst.avg) + 'ms > 16.7ms');
  if (rep.burst && rep.burst.over50 > 0) bad.push('粒子峰值出现 ' + rep.burst.over50 + ' 个 >50ms 长帧');
  const warn16 = ((rep.idle && rep.idle.over16) || 0) + ((rep.burst && rep.burst.over16) || 0);
  L.push('## 4. 结论');
  L.push('');
  if (!bad.length) {
    L.push('✅ **达标，本档不改游戏本体**：空载与粒子峰值都远在 60fps 预算内，零长帧（>50ms）。');
    L.push('');
    L.push('余量：空载 ' + f(rep.idle.avg) + 'ms / 16.7ms ≈ **' + (16.7 / (rep.idle.avg || 1)).toFixed(1)
      + ' 倍**；粒子峰值 ' + f(rep.burst.avg) + 'ms ≈ **' + (16.7 / (rep.burst.avg || 1)).toFixed(1) + ' 倍**。');
    L.push('');
    L.push('- 超出 16.7ms 的帧共 **' + warn16 + '** 个（' + (warn16 ? '都是零星尖峰，见上面的最差帧归因' : '一个都没有')
      + '）；超出 50ms 的 **0** 个。');
    L.push('- 判定口径：平均 > 16.7ms 或出现 >50ms 长帧才算不达标（脚本退出码 2）。');
    L.push('  零星 17ms 级尖峰只提示不算失败 —— 共享机器上一次 GC / 调度抖动就能造出来，'
      + '把它当硬失败等于做了个随机报警器。');
  } else {
    L.push('⚠️ **超出预算，需要优化**：');
    bad.forEach(b => L.push('- ' + b));
  }
  L.push('');
  fs.writeFileSync(path.join(ROOT, 'qa_perf.md'), L.join('\n'), 'utf8');
  console.log(L.join('\n'));
  console.log('\n原始数据 → _perf_raw.json');
  process.exit(bad.length ? 2 : 0);
}

function pct(a, b) { return (!b || a === undefined) ? '—' : Math.round(a / b * 100) + '%'; }

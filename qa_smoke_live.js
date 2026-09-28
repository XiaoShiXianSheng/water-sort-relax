/* qa_smoke_live.js —— 真浏览器启动冒烟（上线门禁 G9）
 *
 * 为什么还需要它？现有七套件都跑在 Node 的**假 canvas**（Proxy 兜底，任何 API 缺失都不报错）
 * 和静态文本扫描上。于是有一条最致命的事故谁也拦不住：
 *
 *   **真机上白屏 / 主循环死掉 / 画面全空 —— 而假 canvas 与 ES5 扫描全都显示"绿"。**
 *
 * 这一条用真实 Chrome headless 在 360×640（低端机分辨率）下把 4 个关键关卡各跑 90 帧，
 * 检查四件事：①无未捕获错误 ②没进产品自己的崩溃兜底 ③主循环真的在跑（帧计数在涨）
 * ④画面真的画出了东西（像素不是单一颜色）。
 *
 * 设计上刻意的两条：
 *  1. **只判"对/错"，不判快慢** —— 帧耗时在共享机器上是抖动的，把它塞进门禁会让门禁自己时红时绿。
 *     性能由 `qa_perf.js` 单独量（见 QA_自测体系.md §10）。
 *  2. **Chrome 缺失 = FAIL，不是跳过** —— "没验证"不等于"通过"，门禁不能拿没跑过的条件放行。
 *
 * 用法：node qa_smoke_live.js            （默认 1,15,30,40 关）
 *       LV_SET=1,40 node qa_smoke_live.js
 * 产物：_smoke.json（明细） + 控制台一行 `__QA__ {json}`（供 qa_run.js 汇总）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const GAME = process.env.GAME || path.join(ROOT, 'outputs', '解压水消除.html');
const W = +(process.env.SMK_W || 360), H = +(process.env.SMK_H || 640);
const FRAMES = +(process.env.SMK_FRAMES || 90);
const LV_TO = +(process.env.SMK_LV_TIMEOUT || 8000);   // 单关上限：超了就当"起不来"
const LEVELS = String(process.env.LV_SET || '1,15,30,40').split(',')
  .map(s => parseInt(s, 10)).filter(n => n > 0);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const t0 = Date.now();
const fails = [];
const checks = [];            // {lv, name, ok, detail}
function check(lv, name, ok, detail) {
  checks.push({ lv: lv, name: name, ok: !!ok, detail: detail || '' });
  if (!ok) fails.push('L' + lv + ' ' + name + (detail ? ' → ' + detail : ''));
  return !!ok;
}
function bail(msg) {
  console.log('FAIL  ' + msg);
  console.log('__QA__ ' + JSON.stringify({
    suite: 'smoke', pass: 0, fail: 1, warn: 0, ms: Date.now() - t0, fails: [msg], warns: []
  }));
  try { fs.writeFileSync(path.join(ROOT, '_smoke.json'), JSON.stringify({ at: new Date().toISOString(), ok: false, error: msg, checks: [] }, null, 2), 'utf8'); } catch (e) { }
  process.exit(1);
}

/* ================= 被测页面：注入后门（读内部真实状态 + 兜底标志） ================= */
function buildGamePage() {
  const html = fs.readFileSync(GAME, 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) bail('主文件里找不到 <script> 块');
  let code = m[1];

  const INJECT = `window.__SMK={
  get fatal(){return fatalShown;}, get rendered(){return renderedOk;},
  get G(){return G;}, gen:genLevel,
  get canvasId(){return canvas?canvas.id:null;}
};`;
  const A = 'requestAnimationFrame(loop);';
  const i = code.lastIndexOf(A);
  if (i < 0) bail('主文件里找不到注入点 requestAnimationFrame(loop);');
  code = code.slice(0, i) + INJECT + '\n  ' + code.slice(i);

  /* 探头必须在游戏脚本**之前**执行：
     - error / unhandledrejection 监听要抢在游戏自己的 window.onerror 之前注册，
       否则产品把错误吃掉（fatalShown）之后，外层就只剩"看起来正常"。
     - rAF 包一层只为数帧；里面再 try/catch 一次，保证"回调抛错"这件事一定被记下来，
       而不是变成一条静默死掉的主循环。 */
  const probe = '<script>\n' + [
    'window.__SMK_ERR=[]; window.__SMK_FC=0;',
    'window.addEventListener("error",function(e){',
    '  window.__SMK_ERR.push("ERROR "+String((e&&e.message)||e)+" @"+((e&&e.filename)||"")+":"+((e&&e.lineno)||0));',
    '});',
    'window.addEventListener("unhandledrejection",function(e){',
    '  window.__SMK_ERR.push("PROMISE "+String((e&&e.reason&&(e.reason.message||e.reason.stack))||e.reason));',
    '});',
    '(function(){',
    '  var raf=window.requestAnimationFrame;',
    '  window.requestAnimationFrame=function(cb){',
    '    return raf.call(window,function(ts){',
    '      window.__SMK_FC++;',
    '      try{ cb(ts); }catch(err){ window.__SMK_ERR.push("THROW "+((err&&err.stack)||err)); }',
    '    });',
    '  };',
    '})();'
  ].join('\n') + '\n<\/script>';

  const page = html.replace(/<script>([\s\S]*)<\/script>/, () => '<script>' + code + '<\/script>');
  const s = page.indexOf('<script>');
  return page.slice(0, s) + probe + '\n' + page.slice(s);
}

/* ================= iframe 内：等 N 帧 → 采样画面 → 回传父页 ================= */
const BENCH = '<script>\n' + [
  '(function(){',
  '  function report(){',
  '    var o={__smk:true, lv:' + 0 + '};',   /* lv 由 URL 决定，下面补 */
  '    try{',
  '      var q=String(location.search||"").match(/[?&]lvl=(\\d+)/);',
  '      o.lv=q?parseInt(q[1],10):0;',
  '      o.frames=window.__SMK_FC;',
  '      o.errs=(window.__SMK_ERR||[]).slice(0,6);',
  '      o.errCount=(window.__SMK_ERR||[]).length;',
  '      var D=window.__SMK;',
  '      o.hasBackdoor=!!(D&&D.G);',
  '      o.fatal=D?!!D.fatal:null;',
  '      o.rendered=D?!!D.rendered:null;',
  '      if(D&&D.G){ var G=D.G;',
  '        o.state=G.state; o.level=G.level; o.tier=G.tier;',
  '        o.bottles=G.bottles?G.bottles.length:0; o.cells=G.cellCount;',
  '      }',
  '      /* 崩溃兜底面板：产品会插一个 #__fatal 的 div，文本里带"请截图反馈" */',
  '      var fe=document.getElementById("__fatal");',
  '      o.fatalPanel=!!fe;',
  '      o.fatalText=fe?String(fe.textContent||"").slice(0,160):"";',
  '      o.view={iw:window.innerWidth,ih:window.innerHeight,dpr:window.devicePixelRatio};',
  '      /* 画面非空白：读真实像素，统计不同颜色数 + 最常见颜色占比 */',
  '      var cv=document.getElementById("game");',
  '      o.canvas=!!cv;',
  '      if(cv&&cv.width){',
  '        o.canvasSize=[cv.width,cv.height];',
  '        var c2=cv.getContext("2d");',
  '        if(!c2){ o.pxErr="no 2d ctx"; }',
  '        else {',
  '          var w=cv.width,h=cv.height,d=c2.getImageData(0,0,w,h).data;',
  '          var seen={},uniq=0,n=0,top=0,key,bg=d[0]+","+d[1]+","+d[2],diff=0;',
  '          for(var y=0;y<h;y+=4){ for(var x=0;x<w;x+=4){',
  '            var k=(y*w+x)*4; key=d[k]+","+d[k+1]+","+d[k+2];',
  '            if(seen[key]===undefined){seen[key]=0;uniq++;}',
  '            seen[key]++; n++; if(key!==bg)diff++;',
  '          }}',
  '          for(key in seen)if(seen[key]>top)top=seen[key];',
  '          o.px={w:w,h:h,uniq:uniq,sampled:n,diffRatio:diff/n,topShare:top/n};',
  '        }',
  '      } else { o.pxErr="canvas 缺失或位图尺寸为 0"; }',
  '    }catch(e){ o.reportErr=String((e&&e.stack)||e); }',
  '    try{ parent.postMessage(o,"*"); }catch(e){}',
  '  }',
  '  function run(){',
  '    var target=(window.__SMK_FC||0)+' + FRAMES + ', guard=0;',
  '    (function poll(){',
  '      if(window.__SMK_FC>=target) return report();',
  /* 主循环没起来（= 白屏/崩溃）时别等满父页超时，自己早点上报：
     1000 × 4ms ≈ 4s，足够正常开局跑完 90 帧（1.5s）；坏掉时 4s 就能拿到"帧数=0"的证据。 */
  '      if(guard++>1000) return report();',
  '      setTimeout(poll,4);',
  '    })();',
  '  }',
  '  window.addEventListener("load",function(){ setTimeout(run,150); });',
  '})();'
].join('\n') + '\n<\/script>';

/* ================= 外页：逐关换 iframe，收齐后回传 ================= */
function wrapperPage() {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + 'html,body{margin:0;padding:0;background:#888}'
    + 'iframe{width:' + W + 'px;height:' + H + 'px;border:0;display:block}'
    + '</style></head><body><script>\n'
    + 'var LV=' + JSON.stringify(LEVELS) + ', out=[], i=0, cur=null;\n'
    + 'function send(){ var x=new XMLHttpRequest(); x.open("POST","/report",true);'
    + ' x.setRequestHeader("Content-Type","application/json"); x.send(JSON.stringify({levels:out})); }\n'
    + 'window.addEventListener("message",function(e){ if(e&&e.data&&e.data.__smk&&cur)cur(e.data); });\n'
    + 'function next(){\n'
    + '  if(i>=LV.length){ send(); return; }\n'
    + '  var lv=LV[i++], done=false, tm=null;\n'
    + '  var fr=document.createElement("iframe");\n'
    + '  cur=function(rep){ if(done)return; done=true; if(tm)clearTimeout(tm);'
    + ' out.push(rep); try{fr.parentNode.removeChild(fr);}catch(e){} setTimeout(next,80); };\n'
    + '  tm=setTimeout(function(){ cur({lv:lv,timeout:true,frames:0}); }, ' + LV_TO + ');\n'
    + '  fr.src="/game?lvl="+lv;\n'
    + '  document.body.appendChild(fr);\n'
    + '}\n'
    + 'next();\n'
    + '<\/script></body></html>';
}

/* ================= 本地服务 + 起 Chrome ================= */
const gamePage = buildGamePage();
const wantMd5 = crypto.createHash('md5').update(fs.readFileSync(GAME)).digest('hex');
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
  if (req.url.split('?')[0] === '/game') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(gamePage.replace('</body>', () => BENCH + '</body>'));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(wrapperPage());
});

console.log('===== 真浏览器启动冒烟 Q A S M O K E  ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + ' =====');
console.log('  ' + W + '×' + H + ' / dpr=' + (process.env.DPR || 1) + ' / 每关 ' + FRAMES + ' 帧 / 关卡 ' + LEVELS.join(',') + ' / Chrome headless');

if (!fs.existsSync(CHROME)) {
  bail('找不到真实 Chrome：' + CHROME + ' —— 门禁需要它来证明"真机上不是白屏"，按「不许上线」处理');
}

server.listen(0, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const udd = path.join(os.tmpdir(), 'wb-smoke-' + Date.now());
  const ch = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--force-device-scale-factor=' + (process.env.DPR || 1),
    '--window-size=' + (W + 40) + ',' + (H + 120),
    '--user-data-dir=' + udd, url
  ], { stdio: 'ignore' });

  const hard = (LEVELS.length * LV_TO + 25000) | 0;
  const timer = setInterval(() => {
    if (got) { clearInterval(timer); try { ch.kill(); } catch (e) { } finish(got); }
    else if (Date.now() - t0 > hard) { clearInterval(timer); try { ch.kill(); } catch (e) { } finish({ error: '总超时（' + hard + 'ms）：Chrome 没能跑完所有关卡' }); }
  }, 300);
});

/* ================= 判定 ================= */
const MIN_UNIQ = +(process.env.SMK_MIN_UNIQ || 10);   // 不同颜色数下限
const MAX_TOP = +(process.env.SMK_MAX_TOP || 0.97);  // 最常见颜色占比上限（= 全屏一色 = 白屏）

function finish(rep) {
  try { server.close(); } catch (e) { }

  if (rep.error) {
    bail(rep.error + '｜主文件 md5 ' + wantMd5);
  }

  const got2 = rep.levels || [];
  LEVELS.forEach(lv => {
    const r = got2.filter(x => x.lv === lv)[0];
    if (!r) return check(lv, '本关跑出了结果', false, 'Chrome 没回传这一关的数据');
    if (r.timeout) return check(lv, '本关跑出了结果', false, '超过 ' + LV_TO + 'ms 没有任何回传（很可能起不来）');
    if (r.reportErr) return check(lv, '本关跑出了结果', false, '采样自身异常：' + r.reportErr.slice(0, 120));

    check(lv, '无未捕获错误', r.errCount === 0,
      r.errCount ? r.errCount + ' 个：' + (r.errs || []).join(' / ').slice(0, 200) : '');

    check(lv, '没进产品的崩溃兜底面板', !r.fatalPanel && r.fatal === false,
      (r.fatalPanel || r.fatal) ? 'fatalPanel=' + r.fatalPanel + ' fatal=' + r.fatal + '　' + String(r.fatalText || '').replace(/\n/g, ' ').slice(0, 160) : '');

    check(lv, '主循环在跑（帧计数 ≥ ' + FRAMES + '）', (r.frames || 0) >= FRAMES,
      '实际 ' + (r.frames || 0) + ' 帧；rendered=' + r.rendered);

    const px = r.px || {};
    check(lv, '画面真的画出了东西（非白屏/全色块）',
      !!r.canvas && !r.pxErr && px.uniq >= MIN_UNIQ && px.topShare < MAX_TOP,
      r.pxErr ? r.pxErr
        : '位图 ' + (r.canvasSize || []).join('×') + ' 不同颜色 ' + px.uniq + ' 种 / 最常见色占比 '
        + (px.topShare === undefined ? '—' : (px.topShare * 100).toFixed(1) + '%') + '（阈值：颜色 ≥' + MIN_UNIQ + '、占比 <' + MAX_TOP + '）');

    check(lv, '局内状态正常（state=play 且瓶子数 > 0）',
      r.state === 'play' && (r.bottles || 0) > 0,
      'state=' + r.state + ' 瓶=' + r.bottles + ' 格=' + r.cells + ' 档=' + r.tier);
  });

  const pass = checks.filter(c => c.ok).length, fail = checks.length - pass;
  fs.writeFileSync(path.join(ROOT, '_smoke.json'), JSON.stringify({
    at: new Date().toISOString(), ok: fail === 0, ms: Date.now() - t0,
    chrome: fs.existsSync(CHROME) ? CHROME : null, view: [W, H], framesPerLevel: FRAMES,
    gameMd5: wantMd5, checks: checks, raw: got2
  }, null, 2), 'utf8');

  /* 每行都以行首 PASS/FAIL 开头 —— 回滚验证器（qa_rollback.js）就是靠 `^FAIL` 抓断言的，
     缩进过的输出会让它"看不见失败"，把真 FAIL 当成"没抓到"（踩过）。 */
  checks.forEach(c => console.log((c.ok ? 'PASS' : 'FAIL') + '  [L' + c.lv + '] ' + c.name + (c.detail ? '  → ' + c.detail : '')));
  console.log('');
  console.log('=== 真浏览器冒烟：' + pass + ' PASS / ' + fail + ' FAIL （' + ((Date.now() - t0) / 1000).toFixed(1) + 's）===');
  console.log('__QA__ ' + JSON.stringify({
    suite: 'smoke', pass: pass, fail: fail, warn: 0, ms: Date.now() - t0, fails: fails, warns: []
  }));
  process.exit(fail === 0 ? 0 : 1);
}

/* qa_smoke_live.js —— 真浏览器启动冒烟（上线门禁 G9）
 *
 * 为什么还需要它？现有七套件都跑在 Node 的**假 canvas**（Proxy 兜底，任何 API 缺失都不报错）
 * 和静态文本扫描上。于是有一条最致命的事故谁也拦不住：
 *
 *   **真机上白屏 / 主循环死掉 / 画面全空 —— 而假 canvas 与 ES5 扫描全都显示"绿"。**
 *
 * 这一条用真实 Chrome headless 在 360×640（低端机分辨率）下把几个关键关卡各跑 90 帧，
 * 检查四件事：①无未捕获错误 ②没进产品自己的崩溃兜底 ③主循环真的在跑（帧计数在涨）
 * ④画面真的画出了东西（像素不是单一颜色）；外加"不带 ?lvl= 的那一趟"做真 DOM 点击端到端。
 *
 * 2026-10-01 05:00 档又给它加了两件事（都还是"只判对错"）：
 *
 *  A. **端到端点击（真 DOM 事件）**：第 0 个 iframe 不带 `?lvl=`（就是玩家第一次打开的样子），
 *     用真实 `MouseEvent` 依次点「开始游戏」和货架上的一个瓶子，断言真的进了第 1 关、
 *     瓶子真的飞上台面。qa_ui 是**直接调 handleTap(vx,vy)** 的（假 canvas），
 *     所以它证明不了「canvas 真的挂在 (0,0)、listener 真的注册上了、真机 dpr 换算没歪」——
 *     "真机上点了没反应"正是这一类，而它恰好是最致命的一种（游戏能玩，就是点不动）。
 *  B. **断网模式（`SMK_OFFLINE=1`）**：把 fetch / XHR / sendBeacon / `new Image()` 里的
 *     **远程 http(s) 地址**全部拦掉并记账（data:/blob:/本机地址照常放行，避免假报警），
 *     然后在"外部网络 100% 失败"的环境下重跑同一批断言。
 *     它守的是产品承诺"零依赖单文件"：谁哪天悄悄加了个远程字体/贴图/统计，联网时看不出来，
 *     玩家一断网就白屏。**注意它不断言"请求次数必须为 0"** —— 埋点上报是 fire-and-forget，
 *     允许存在，只要它的失败不影响游戏（那正是这条要证明的）。
 *
 * 设计上刻意的两条：
 *  1. **只判"对/错"，不判快慢** —— 帧耗时在共享机器上是抖动的，把它塞进门禁会让门禁自己时红时绿。
 *     性能由 `qa_perf.js` 单独量（见 QA_自测体系.md §10）。
 *  2. **Chrome 缺失 = FAIL，不是跳过** —— "没验证"不等于"通过"，门禁不能拿没跑过的条件放行。
 *
 * 用法：node qa_smoke_live.js                       （默认 0,1,15,30,40，含标题页端到端）
 *       LV_SET=1,40 node qa_smoke_live.js
 *       SMK_OFFLINE=1 SMK_OUT=_offline.json node qa_smoke_live.js   （断网模式，写另一个产物文件）
 * 产物：`_smoke.json`（默认，明细） + 控制台一行 `__QA__ {json}`（供 qa_run.js 汇总）
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
/* 关卡列表：**0 = 不传 ?lvl=**（玩家第一次打开的样子 → 停在标题页，用来跑端到端点击）。
   ★ 别把 0 过滤掉：老写法 `.filter(n => n > 0)` 会把标题页那一趟静默丢掉，
   于是"真机点得动"这件事又没人管了。 */
const LEVELS = String(process.env.LV_SET || '0,1,15,30,40').split(',')
  .map(s => parseInt(s, 10)).filter(n => n >= 0 && !isNaN(n));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
/* 断网模式：把远程 http(s) 请求全部拦掉（见文件头 B）。
   产物文件单独一份，免得和正常冒烟的 _smoke.json 互相覆盖 —— 两趟都要留证据。 */
const OFFLINE = process.env.SMK_OFFLINE === '1' || process.argv.indexOf('--offline') >= 0;
const OUT_NAME = process.env.SMK_OUT || '_smoke.json';

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
  try { fs.writeFileSync(path.join(ROOT, OUT_NAME), JSON.stringify({ at: new Date().toISOString(), ok: false, error: msg, checks: [] }, null, 2), 'utf8'); } catch (e) { }
  process.exit(1);
}

/* ================= 断网垫片：外部网络 100% 失败，且记账 =================
 * 只在 SMK_OFFLINE=1 时插进页面（正常冒烟保持"真实网络"环境，两者互不污染）。
 *
 * 为什么**不用 Chrome 的 DNS 屏蔽参数**（`--host-resolver-rules`）：
 *   那个做法的"是否真的生效"没法自证 —— 机器本来就没网时它和无屏蔽无法区分，
 *   门禁会变成一条"看着在跑、其实可能是空转"的假绿。垫片写在页面里，
 *   生效与否由页面自己报告（netOff），确定性 100%。
 *
 * 两个刻意的设计：
 *  ① **只拦远程 http(s)**：本机 / data: / blob: 一律放行。否则游戏只要用一次
 *     `canvas.toDataURL()` 或本地贴图就会被误报成"断网崩了"。
 *  ② **请求是"失败"不是"抛错"**：模拟真实断网（浏览器就是让请求 reject/onerror），
 *     而不是让 API 直接 throw。这样"埋点上报失败会不会把游戏带崩"才测得出来 ——
 *     而这正是这条门禁真正想守的东西（不要求请求数为 0，要求失败不致命）。 */
const NET_SHIM = [
  '(function(){',
  '  var N=window.__SMK_NET=[];',
  '  function remote(u){ u=String((u&&u.url)?u.url:u);',
  '    return /^(https?:)?\\/\\//i.test(u) && !/^https?:\\/\\/(127\\.0\\.0\\.1|localhost)([:\\/]|$)/i.test(u); }',
  '  window.__SMK_NET_OFF=true;',
  '  function rec(k,u){ if(!remote(u))return false; try{ N.push(k+" "+String(u).slice(0,90)); }catch(e){} return true; }',
  '  var of=window.fetch;',
  '  window.fetch=function(u){ if(rec("fetch",u)) return Promise.reject(new TypeError("Failed to fetch (offline smoke)")); return of.apply(window,arguments); };',
  '  var OX=window.XMLHttpRequest;',
  '  if(OX&&OX.prototype){ var oo=OX.prototype.open, os=OX.prototype.send;',
  '    OX.prototype.open=function(m,u){ this.__blk=rec("xhr",u); oo.apply(this,arguments); };',
  '    OX.prototype.send=function(){ if(this.__blk){ var self=this; setTimeout(function(){',
  '      try{ if(self.onerror)self.onerror(); }catch(e){}',
  '      try{ self.dispatchEvent(new Event("error")); }catch(e){} },0); return; } return os.apply(this,arguments); }; }',
  '  if(window.navigator&&window.navigator.sendBeacon){',
  '    window.navigator.sendBeacon=function(u){ rec("beacon",u); return true; }; }',
  '  var OI=window.Image;',
  '  if(OI){ window.Image=function(w,h){ var im=new OI(w,h), cur="";',
  '    try{ Object.defineProperty(im,"src",{ configurable:true,',
  '      get:function(){ return cur; },',
  '      set:function(v){ cur=String(v);',
  '        if(rec("img",v)){ setTimeout(function(){ try{ if(im.onerror)im.onerror(); }catch(e){} },0); return; }',
  '        try{ im.setAttribute("src",cur); }catch(e){} } }); }catch(e){}',
  '    return im; }; }',
  '})();'
].join('\n');

/* ================= 被测页面：注入后门（读内部真实状态 + 兜底标志） =================
   后门必须**放在 IIFE 内部**（主文件整段就是一个 IIFE，'use strict'）：
   注入点是启动那一次 `requestAnimationFrame(loop);`，它在 IIFE 里，所以能直接引用
   G / handleTap / TITLE_UI / toVirtual 这些**模块作用域**的名字（它们不是 window 属性）。
   所有会变的值一律用 getter / 函数包一层，避免注入那一刻还没初始化好。 */
function buildGamePage() {
  const html = fs.readFileSync(GAME, 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) bail('主文件里找不到 <script> 块');
  let code = m[1];

  const INJECT = `window.__SMK={
  get fatal(){return fatalShown;}, get rendered(){return renderedOk;},
  get G(){return G;}, gen:genLevel,
  get canvasId(){return canvas?canvas.id:null;},
  /* 端到端点击用：真实 UI 几何 + 真实的点击入口（不是另写一份坐标换算） */
  get TITLE_UI(){return TITLE_UI;},
  get UIVIEW(){return {cw:cw,ch:ch,scale:scale,offX:offX,offY:offY,dpr:dpr};},
  tap:function(x,y){return handleTap(x,y);},
  iceAt:function(b){try{return !!iceAt(b);}catch(e){return null;}}
};`;
  const A = 'requestAnimationFrame(loop);';
  const i = code.lastIndexOf(A);
  if (i < 0) bail('主文件里找不到注入点 requestAnimationFrame(loop);');
  code = code.slice(0, i) + INJECT + '\n  ' + code.slice(i);

  /* 探头必须在游戏脚本**之前**执行：
     - error / unhandledrejection 监听要抢在游戏自己的 window.onerror 之前注册，
       否则产品把错误吃掉（fatalShown）之后，外层就只剩"看起来正常"。
     - rAF 包一层只为数帧；里面再 try/catch 一次，保证"回调抛错"这件事一定被记下来，
       而不是变成一条静默死掉的主循环。
     - 断网模式下再多一层「网络全断 + 记账」的垫片（只拦远程 http(s)，本机/data:/blob: 放行）。 */
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
    '})();',
    OFFLINE ? NET_SHIM : ''
  ].join('\n') + '\n<\/script>';

  const page = html.replace(/<script>([\s\S]*)<\/script>/, () => '<script>' + code + '<\/script>');
  const s = page.indexOf('<script>');
  return page.slice(0, s) + probe + '\n' + page.slice(s);
}

/* ================= iframe 内：端到端点击 → 等 N 帧 → 采样画面 → 回传父页 ================= */
const BENCH = '<script>\n' + [
  '(function(){',
  /* ---- 端到端：真 DOM 事件（优先 touch，退鼠标）→ 真的进关 / 瓶真的上台面 ---- */
  '  function fireTouch(el,x,y,kind){',
  '    var t=new Touch({identifier:1,target:el,clientX:x,clientY:y,pageX:x,pageY:y});',
  '    var ev=new TouchEvent(kind,{touches:kind==="touchend"?[]:[t],targetTouches:kind==="touchend"?[]:[t],',
  '      changedTouches:[t],bubbles:true,cancelable:true,view:window});',
  '    el.dispatchEvent(ev);',
  '  }',
  '  function fireMouse(el,x,y,kind){',
  '    el.dispatchEvent(new MouseEvent(kind,{clientX:x,clientY:y,bubbles:true,cancelable:true,view:window}));',
  '  }',
  '  function tapAt(el,x,y){',
  '    var useTouch=true;',
  '    try{ fireTouch(el,x,y,"touchstart"); fireTouch(el,x,y,"touchend"); }catch(e){ useTouch=false; }',
  '    if(!useTouch){ fireMouse(el,x,y,"mousedown"); fireMouse(el,x,y,"mouseup"); }',
  '    return useTouch?"touch":"mouse";',
  '  }',
  '  function e2e(done){',
  '    var D=window.__SMK, out={}, path="none";',
  '    try{',
  '      var cv=document.getElementById("game");',
  '      if(!cv||!D||!D.TITLE_UI||!D.UIVIEW){ out.skip="缺 canvas 或后门"; return done(out); }',
  '      var r=cv.getBoundingClientRect(), v=D.UIVIEW;',
  '      out.rect=[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)];',
  /* canvas 必须正好铺在视口原点：产品的 toVirtual 就是 (client-offX)/scale —— 它**不**减 rect.left。
     这里顺带把这条几何前提也验了（canvas 被挪位时，真机上是"点哪都不中"）。 */
  '      out.rectAtOrigin=(r.left===0&&r.top===0&&r.width>0&&r.height>0);',
  '      var G=D.G; out.stateBefore=G?G.state:null;',
  '      var S=D.TITLE_UI.start;',
  '      var cx=r.left+(S.x+S.w/2)*v.scale+v.offX, cy=r.top+(S.y+S.h/2)*v.scale+v.offY;',
  '      out.tapPt=[Math.round(cx),Math.round(cy)];',
  '      out.tapInside=(cx>=r.left&&cx<=r.left+r.width&&cy>=r.top&&cy<=r.top+r.height);',
  '      path=tapAt(cv,cx,cy);',
  '      out.stateAfterStart=G?G.state:null;',
  '      out.levelAfterStart=G?G.level:0;',
  /* 进关后再点一个货架瓶子。逐个试前几个候选：冰冻瓶 / 洞口被挡的瓶点不动是**正确**行为，
     不该判失败（那属于"拒绝反馈"，qa_ui 另有断言），所以取"前 4 个里有 1 个真的上台面"。 */
  '      var n=0, moved=false, tried=[];',
  '      for(var i=0;i<G.bottles.length&&n<4;i++){',
  '        var b=G.bottles[i];',
  '        if(b.place!=="grid"||b.gate>=0)continue;',
  '        n++;',
  '        var cb=0,k; for(k=0;k<G.bottles.length;k++)if(G.bottles[k].place==="counter")cb++;',
  '        path=tapAt(cv, r.left+b.x*v.scale+v.offX, r.top+b.y*v.scale+v.offY)||path;',
  '        var ca=0; for(k=0;k<G.bottles.length;k++)if(G.bottles[k].place==="counter")ca++;',
  '        if(ca>cb){ moved=true; break; }',
  '        tried.push("b"+i);',
  '      }',
  '      out.bottleMoved=moved; out.bottleTried=n; out.bottleRejected=tried.join(",");',
  '      out.inputPath=path;',
  '    }catch(e){ out.err=String((e&&e.stack)||e); }',
  '    done(out);',
  '  }',
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
  '      /* 断网模式的证据：垫片装没装上 + 期间拦到几次外部请求 */',
  '      o.netOff=!!window.__SMK_NET_OFF;',
  '      o.netCount=(window.__SMK_NET||[]).length;',
  '      o.net=(window.__SMK_NET||[]).slice(0,6);',
  '      o.e2e=window.__SMK_E2E||null;',
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
  '  function boot(){',
  '    var hasLvl=/[?&]lvl=/.test(String(location.search||""));',
  '    if(hasLvl){ run(); return; }',
  '    e2e(function(o){ window.__SMK_E2E=o; setTimeout(run,120); });',
  '  }',
  '  window.addEventListener("load",function(){ setTimeout(boot,150); });',
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
    /* lv=0 表示"玩家的第一次打开"：**不带** ?lvl= 参数（带上 lvl=0 会被页面的
       hasLvl 判断当成"指定了关卡"，于是标题页端到端那一趟就不会跑了）。 */
    + '  fr.src=lv>0?("/game?lvl="+lv):"/game";\n'
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
console.log('  模式：' + (OFFLINE ? '断网（远程 http(s) 全断 + 记账）' : '正常网络') + '　产物 → ' + OUT_NAME);
console.log('  ' + W + '×' + H + ' / dpr=' + (process.env.DPR || 1) + ' / 每关 ' + FRAMES
  + ' 帧 / 关卡 ' + LEVELS.join(',') + '（0 = 不带 ?lvl=，跑标题页端到端点击）/ Chrome headless');

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

    /* lv=0 那一趟是**标题页**：它的"局内状态"由下面的端到端点击断言负责
       （点完「开始游戏」必须真的变成 play），这里不重复判、免得同一条报两次。 */
    if (lv > 0) check(lv, '局内状态正常（state=play 且瓶子数 > 0）',
      r.state === 'play' && (r.bottles || 0) > 0,
      'state=' + r.state + ' 瓶=' + r.bottles + ' 格=' + r.cells + ' 档=' + r.tier);

    /* 断网模式的"这条门禁不是空转"自检：垫片没装上的话，上面 5 条断言全都在
       "真实网络"下跑的 —— 那这趟等于白跑。必须让页面自己报告垫片已生效。 */
    if (OFFLINE) {
      check(lv, '断网模式已生效（外部 http(s) 全被拦下并记账，本条门禁不是空转）', r.netOff === true,
        'netOff=' + r.netOff + '　期间拦到外部请求 ' + (r.netCount || 0) + ' 次'
        + ((r.net || []).length ? '：' + r.net.join(' / ') : '（说明这一关一次都没往外发）'));
    }
  });

  /* ---- 标题页端到端：真 DOM 事件点击链路（只在"不带 ?lvl="的那一趟有数据）----
     为什么单列：qa_ui 是直接调 handleTap(vx,vy) 的（假 canvas + 直接调函数），
     它证明不了「canvas 真挂在 (0,0)、listener 真注册上了、真机 dpr 换算没歪」。
     "游戏能玩，就是点不动"是最致命的一种事故 —— 点不动就没有任何后续了。 */
  const e2eRep = got2.filter(x => x.lv === 0 && !x.timeout && !x.reportErr)[0];
  let e2eOut = null;
  if (e2eRep) {
    const E = e2eRep.e2e || {};
    e2eOut = {
      stateBefore: E.stateBefore, rectAtOrigin: E.rectAtOrigin, tapInside: E.tapInside,
      stateAfterStart: E.stateAfterStart, levelAfterStart: E.levelAfterStart,
      bottleMoved: E.bottleMoved, inputPath: E.inputPath, rect: E.rect
    };
    if (E.skip || E.err) {
      check(0, '端到端点击链路可测（能拿到 canvas 与后门）', false, E.skip || String(E.err).slice(0, 160));
    } else {
      check(0, '真浏览器：打开就是标题页（默认不跳关）', E.stateBefore === 'title',
        'stateBefore=' + E.stateBefore);
      check(0, 'canvas 正铺在视口原点（toVirtual 的几何前提 rect=0,0；被挪位=真机点哪都不中）',
        E.rectAtOrigin === true, 'rect=[左,上,宽,高]=' + JSON.stringify(E.rect || null));
      check(0, '真 DOM 事件点「开 始 游 戏」→ 真的进第 1 关',
        E.stateAfterStart === 'play' && E.levelAfterStart === 1,
        'state=' + E.stateAfterStart + ' level=' + E.levelAfterStart
        + ' 输入通道=' + E.inputPath + ' 点击点=' + JSON.stringify(E.tapPt || null));
      check(0, '真 DOM 事件点货架瓶子 → 真的飞上台面（试 ' + (E.bottleTried || 0) + ' 个候选）',
        E.bottleMoved === true,
        'bottleMoved=' + E.bottleMoved + ' 被拒候选=' + (E.bottleRejected || '无')
        + '（冰冻/被挡的瓶子点不动是正确行为，不算失败）');
    }
  } else if (LEVELS.indexOf(0) >= 0) {
    check(0, '端到端点击链路可测（标题页那一趟跑出了结果）', false, 'Chrome 没回传 lv=0 那一趟的数据');
  }

  const pass = checks.filter(c => c.ok).length, fail = checks.length - pass;
  fs.writeFileSync(path.join(ROOT, OUT_NAME), JSON.stringify({
    at: new Date().toISOString(), ok: fail === 0, ms: Date.now() - t0, mode: OFFLINE ? 'offline' : 'online',
    chrome: fs.existsSync(CHROME) ? CHROME : null, view: [W, H], framesPerLevel: FRAMES,
    levels: LEVELS, gameMd5: wantMd5, checks: checks, e2e: e2eOut, raw: got2
  }, null, 2), 'utf8');

  /* 每行都以行首 PASS/FAIL 开头 —— 回滚验证器（qa_rollback.js）就是靠 `^FAIL` 抓断言的，
     缩进过的输出会让它"看不见失败"，把真 FAIL 当成"没抓到"（踩过）。 */
  checks.forEach(c => console.log((c.ok ? 'PASS' : 'FAIL') + '  [L' + c.lv + '] ' + c.name + (c.detail ? '  → ' + c.detail : '')));
  console.log('');
  console.log('=== 真浏览器冒烟' + (OFFLINE ? '（断网模式）' : '') + '：' + pass + ' PASS / ' + fail + ' FAIL （' + ((Date.now() - t0) / 1000).toFixed(1) + 's）===');
  console.log('__QA__ ' + JSON.stringify({
    suite: 'smoke', pass: pass, fail: fail, warn: 0, ms: Date.now() - t0, fails: fails, warns: [],
    /* extra 给 qa_run.js 的门禁用：G12 靠 mode 判定"这趟真的断网了"（没断网 = 门禁空转 = FAIL），
       G13 靠 e2e 判定"真机点得动"这件事有正面证据（没证据 ≠ 通过）。 */
    extra: {
      mode: OFFLINE ? 'offline' : 'online',
      netOff: checks.filter(c => c.name.indexOf('断网模式已生效') === 0 && c.ok).length > 0,
      levels: LEVELS,
      e2e: e2eOut ? {
        titleToPlay: e2eOut.stateAfterStart === 'play' && e2eOut.levelAfterStart === 1,
        bottleMoved: e2eOut.bottleMoved === true,
        rectAtOrigin: e2eOut.rectAtOrigin === true,
        titleFirst: e2eOut.stateBefore === 'title',
        inputPath: e2eOut.inputPath
      } : null
    }
  }));
  process.exit(fail === 0 ? 0 : 1);
}

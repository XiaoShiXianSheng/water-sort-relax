/* qa_live_sim.js —— 线上环境模拟自测（本轮新增，回答「线上这份能不能玩 / 广告那样接对不对」）
 *
 * 现有 10 个套件的问题：它们全部跑在 Node 的**假 canvas**（Proxy 兜底）或**本地主文件**上。
 * 于是有两件事没人管：
 *
 *   ① **线上那份是不是就是这一版** —— 假 canvas 比对的是 `outputs/` 主文件，
 *      主文件 / 发布件 / 线上三者只要脱节一次，"我明明测过"就成了假话（G8b 抓到过）。
 *   ② **ONLINE 广告链路在真浏览器里长什么样** —— Node 里 `AdService.env` 恒为 test（没 tap SDK）。
 *      线上是 `env:'online'`，真机有 tap 才走 `_onlineRewarded`。这条分支在 Node 里**一步都跑不到**，
 *      所以「真实广告接通了」这件事目前只是代码写的，没被证明过。
 *
 * 这一脚本两趟跑完：
 *
 *   **A. 黑盒 CDP 直打真实线上 URL**（`Page.addScriptToEvaluateOnNewDocument` 注入探针，
 *      真 Chrome headless 打开 `LIVE_URL`，全程不碰产品源码）：
 *        · 线上确实是 V6.0（读页面内的 version 字符串）
 *        · 无未捕获错误 / 主循环真在跑 / 画面真画出了东西（canvas 像素不是一色）
 *        · 「开始游戏」这一下真 DOM 点击真的进了第 1 关
 *        · localStorage 里真的落了 V6.0 的新字段（maxLevel / warm* / lastPlayed）
 *
 *   **B. 线上真实字节 + 调试后门 + TapTap SDK mock 的深交互**：
 *        从**线上 HTTP 取回**的 HTML 文本做注入（不是读本地文件 —— 这样"测的就是线上那份"，
 *        本地主文件改了而线上没同步的情况会直接暴露），再起真 Chrome 逐 case 跑：
 *        · 回归热身：老存档（第 15 关 + 13 天前）打开 → warmActive=1 / warmTier=-2，且关卡进度不丢不降
 *        · ONLINE 降级：没有 tap SDK 时必须老老实实降级成 test 并给出原因
 *        · ONLINE 真实链路：注入 tap mock 后 `createRewardedVideoAd` 必须带**正确的 adUnitId**，
 *          看完（isEnded=true）才发奖、中途退出（isEnded=false）不发奖
 *        · 频控：超限要拦截
 *
 * 用法：node qa_live_sim.js                （默认打上面那个线上地址）
 *       SIM_URL=https://.../  node qa_live_sim.js
 * 产物：`_sim_live.json` + 控制台 `__QA__ {json}`（供 qa_run.js 汇总）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { INJECT, INJECT_ANCHOR } = require('./qa_lib');

const LIVE_URL = (process.env.SIM_URL || 'https://water-sort-relax.app.workbuddy.host/').replace(/\/+$/, '');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const W = +(process.env.SIM_W || 360), H = +(process.env.SIM_H || 640);
const OUT = process.env.SIM_OUT || '_sim_live.json';
const EXPECT_VERSION = process.env.SIM_VERSION || '6.2.0';
const t0 = Date.now();
const checks = [];
const fails = [];
function check(name, ok, detail) {
  checks.push({ name: name, ok: !!ok, detail: detail || '' });
  if (!ok) fails.push(name + (detail ? ' → ' + detail : ''));
  return !!ok;
}
function bail(msg) {
  console.log('FAIL  ' + msg);
  console.log('__QA__ ' + JSON.stringify({ suite: 'livesim', pass: 0, fail: 1, warn: 0, ms: Date.now() - t0, fails: [msg], warns: [] }));
  try { fs.writeFileSync(path.join(__dirname, OUT), JSON.stringify({ at: new Date().toISOString(), ok: false, error: msg, checks }, null, 2), 'utf8'); } catch (e) { }
  process.exit(1);
}

/* ---------------- 页面探针（在页面任何脚本之前执行） ---------------- */
const PROBE = [
  'window.__SIM_ERR=[];',
  'window.addEventListener("error",function(e){window.__SIM_ERR.push(String((e&&e.message)||e));});',
  'window.addEventListener("unhandledrejection",function(e){window.__SIM_ERR.push("unhandledrejection:"+String((e&&e.reason)||e));});',
  'window.__SIM_FC=0;',
  '(function(){var raf=window.requestAnimationFrame;window.requestAnimationFrame=function(cb){return raf(function(t){window.__SIM_FC++;return cb(t);});};})();'
].join('\n');

/* TapTap SDK mock：记录 createRewardedVideoAd 的参数，可按 mode 控制「看完 / 中途退出 / 加载失败」。
   ★ 它故意做成"最小可信实现"：只暴露产品会用到的 show/load/onLoad/onError/onClose，
   多一个方法都没有 —— 这样如果哪天产品改用了 tap 的其他 API，这里会直接报错而不是被悄悄吞掉。 */
function tapMock(mode) {
  return [
    'window.__TAP={calls:[],shown:0,mode:"' + (mode || 'ended') + '",shows:0};',
    'window.tap={createRewardedVideoAd:function(o){',
    '  window.__TAP.calls.push((o&&o.adUnitId)||null);',
    '  var h={};',
    '  if(window.__TAP.mode==="fail") setTimeout(function(){ try{h.err&&h.err({errMsg:"mock load fail"});}catch(e){} },5);',
    '  var api={',
    /* ★ shows 计数是硬闸门：产品 _onlineRewarded 在 show 失败时会「load() → 再 show()」，
       如果 mock 每次都失败，这里会变成永远退不出去的死循环（不是产品 bug，是 mock 没边界）。
       fail 模式第 1 次 show 拒绝、第 2 次直接 onClose({isEnded:false})，语义=「SDK 拉不到广告，收场」。 */
    /* ★ show() 必须返回**真 Promise**（真机也是）：产品靠 p.catch 接到"广告没准备好"再走 load()→重试 show()。
       早先 mock 只返回了个带 catch 的空壳从不 reject，产品那段重试回调压根没跑 → "不卡流程"这条永远假绿。 */
    '    show:function(){ window.__TAP.shown++; window.__TAP.shows++;',
    '      return new Promise(function(res,rej){',
    '        if(window.__TAP.mode==="fail"&&window.__TAP.shows<2){ setTimeout(function(){ try{rej({errMsg:"mock not ready"});}catch(e){} },5); return; }',
    '        if(h.close){',
    '          if(window.__TAP.mode==="fail"){ setTimeout(function(){ try{h.close({isEnded:false});}catch(e){} },5); }',
    '          else if(window.__TAP.mode==="cancel"){ setTimeout(function(){ try{h.close({isEnded:false});}catch(e){} },5); }',
    '          else { setTimeout(function(){ try{h.close({isEnded:true});}catch(e){} },5); }',
    '        }',
    '        setTimeout(function(){ try{res({});}catch(e){} },5);',
    '      }); },',
    /* 注意：load() 的返回 Promise 用自引用 r 写，别在对象字面量里写 `return {...};` ——
       `;` 会提前终结 return 语句，外层 {} 没闭合，整段 mock 直接语法错误（这个坑踩过一次）。 */
    '    load:function(){ var r={then:function(f){f&&f();return r;},catch:function(){return r;}}; return r; },',
    '    onLoad:function(f){h.load=f;}, onError:function(f){h.err=f;}, onClose:function(f){h.close=f;},',
    '    destroy:function(){} };',
    '  return api; }};'
  ].join('\n');
}

/* ---------------- 从线上取回真实 HTML ---------------- */
async function fetchLive() {
  const u = LIVE_URL + (LIVE_URL.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
  const ctrl = new AbortController();
  const to = setTimeout(function () { ctrl.abort(); }, 30000);
  try {
    /* 沙箱里 443 偶发 ConnectTimeout，重试 3 次（不是线上挂了，别一趟就判 FAIL） */
    let last = null, buf = null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(u, { signal: ctrl.signal, headers: { 'Cache-Control': 'no-cache' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        buf = Buffer.from(await r.arrayBuffer());
        last = null; break;
      } catch (e) { last = e; await sleep(1500); }
    }
    if (last || !buf) throw last || new Error('取不到线上内容');
    return { buf: buf, md5: crypto.createHash('md5').update(buf).digest('hex') };
  } finally { clearTimeout(to); }
}

/* 把 qa_lib 的后门注入到**线上取回的 HTML**（用同一份 INJECT 常量，绝不另抄一份） */
function inject(htmlStr, extraHead) {
  const m = htmlStr.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('线上 HTML 里没找到 <script> 块');
  const code = m[1];
  const i = code.lastIndexOf(INJECT_ANCHOR);
  if (i < 0) throw new Error('线上 HTML 里找不到注入锚点 ' + INJECT_ANCHOR);
  const newCode = code.slice(0, i) + INJECT + '\n  ' + code.slice(i);
  let out = htmlStr.slice(0, m.index) + '<script>' + newCode + '</script>' + htmlStr.slice(m.index + m[0].length);
  if (extraHead) {
    const hm = out.match(/<\s*head[^>]*>/i);
    if (!hm) throw new Error('线上 HTML 里没找到 <head>');
    out = out.slice(0, hm.index) + hm[0] + '<script>' + extraHead + '</script>' + out.slice(hm.index + hm[0].length);
  }
  return out;
}

/* ================= 趟次 A：CDP 黑盒打真实线上 URL ================= */
function startChrome(port, url) {
  const udd = path.join(os.tmpdir(), 'wb-livesim-' + Date.now() + '-' + port);
  return spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--force-device-scale-factor=1', '--window-size=' + (W + 40) + ',' + (H + 120),
    '--remote-debugging-port=' + port, '--user-data-dir=' + udd, 'about:blank'
  ], { stdio: 'ignore' });
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function openPage(ws, sessionId) {
  if (sessionId) await ws.send(JSON.stringify({ id: ++ws._id, method: 'Page.createTargetForSession' }));
  return sessionId;
}

async function runLegA(live) {
  if (!fs.existsSync(CHROME)) return bail('找不到真实 Chrome：' + CHROME);
  const PORT = 9333 + (process.env.SIM_PORT ? +process.env.SIM_PORT : 0);
  const ch = startChrome(PORT);
  let ws = null;
  try {
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(400);
      try {
        const list = JSON.parse(await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).text());
        target = (list || []).filter(function (t) { return t.type === 'page'; })[0] || null;
      } catch (e) { }
    }
    if (!target) { ch.kill(); return bail('Chrome 起了但拿不到 /json/list 里的 page（端口 ' + PORT + '）'); }

    const client = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(function (res, rej) { client.onopen = res; client.onerror = rej; client.onclose = function () { rej(new Error('CDP 连接被关闭')); }; });
    ws = client;
    ws._id = 0;
    const pend = new Map();
    client.onmessage = function (e) {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.id && pend.has(m.id)) { const fn = pend.get(m.id); pend.delete(m.id); fn(m); }
    };
    function send(method, params) {
      const i = ++ws._id;
      return new Promise(function (res) { pend.set(i, res); client.send(JSON.stringify({ id: i, method: method, params: params || {} })); });
    }
    async function ev(expr) {
      const r = await send('Runtime.evaluate', { expression: '(' + expr + ')()', returnByValue: true, awaitPromise: true });
      if (!r || !r.result) throw new Error('CDP 无回包');
      if (r.result.exceptionDetails) throw new Error('页面内求值抛错: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails.text || '').slice(0, 200));
      return r.result.result ? r.result.result.value : null;
    }

    await send('Page.enable');
    await send('Runtime.enable');
    /* 探针：任何页面脚本之前执行 */
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    await send('Page.navigate', { url: LIVE_URL + '?t=' + Date.now() });
    await sleep(3000);

    /* A1 线上确实是 V6.0 */
    let ver = null;
    try { ver = await ev('function(){var m=String(document.documentElement.outerHTML).match(/version:[\'"]?([0-9][0-9\\.]*)[\'"]?/);return m?m[1]:null;}'); }
    catch (e) { ver = null; }
    check('A1 线上页面就是 V' + EXPECT_VERSION, ver === EXPECT_VERSION, '页面内 version=' + ver + '（线上 md5 ' + live.md5 + '）');

    /* A2 无未捕获错误 */
    const errs = await ev('function(){return (window.__SIM_ERR||[]).slice(0,5);}');
    check('A2 打开线上无未捕获错误', !errs || errs.length === 0, errs && errs.length ? errs.join(' / ') : '');

    /* A3 主循环真在跑 */
    const fc0 = await ev('function(){return window.__SIM_FC||0;}');
    await sleep(1200);
    const fc1 = await ev('function(){return window.__SIM_FC||0;}');
    check('A3 线上主循环在跑（帧计数在涨）', (fc1 | 0) > (fc0 | 0) + 5, fc0 + ' → ' + fc1 + ' 帧');

    /* A4 画面真画出了东西（canvas 不是一色） */
    const px = await ev('function(){var c=document.querySelector("canvas");if(!c)return {err:"no-canvas"};' +
      'try{var x=c.getContext("2d");var d=x.getImageData(0,0,c.width,c.height).data;var set={},n=0;' +
      'for(var i=0;i<d.length;i+=4*97){set[d[i]+","+d[i+1]+","+d[i+2]]=1;n++;}var k=0,best=0;' +
      'for(var q in set){k++;best=Math.max(best,1);}return {uniq:k,sampled:n};}catch(e){return {err:String(e)};}}');
    check('A4 线上画面不是白屏/单色', px && px.uniq >= 5, JSON.stringify(px));

    /* A5 「开始游戏」真 DOM 点击 → 真的进了第 1 关
       黑盒没有后门，所以按钮矩形**从线上页面自己的常量里取**（TITLE_UI.start / VW / VH），
       再按产品 toVirtual 的逆运算换算出真正的 clientX/Y。猜坐标是不成立的：
       点歪了"看起来像没进关"，其实是我点错了，会把产品冤枉成 bug。 */
    const entered = await ev('function(){' +
      'var cv=document.getElementById("game"); if(!cv)return {err:"no-canvas"};' +
      'var html=document.documentElement.outerHTML;' +
      'var VW=720,VH=1280;' +
      '(function(){var m=html.match(/var VW=([0-9]+), VH=([0-9]+);/); if(m){VW=+m[1];VH=+m[2];}})();' +
      'var m=html.match(/start:\\{x:([0-9]+),y:([0-9]+),w:([0-9]+),h:([0-9]+)\\}/);' +
      'if(!m)return {err:"线上 HTML 里找不到 TITLE_UI.start"};' +
      'var vw=+m[1],vh=+m[2],bw=+m[3],bh=+m[4];' +
      'var r=cv.getBoundingClientRect();' +
      'var scale=Math.min(r.width/VW,r.height/VH); var offX=(r.width-VW*scale)/2, offY=(r.height-VH*scale)/2;' +
      'var cx=r.left+(vw+bw/2)*scale+offX, cy=r.top+(vh+bh/2)*scale+offY;' +
      'if(cx<r.left||cx>r.left+r.width||cy<r.top||cy>r.top+r.height)return {err:"算出来的点落在画布外"};' +
      'function fire(kind,type){cv.dispatchEvent(new MouseEvent(kind,{clientX:cx,clientY:cy,bubbles:true,cancelable:true,view:window}));}' +
      'fire("mousedown"); fire("mouseup");' +
      'cv.dispatchEvent(new MouseEvent("click",{clientX:cx,clientY:cy,bubbles:true,cancelable:true,view:window}));' +
      'return {ok:true,cx:Math.round(cx),cy:Math.round(cy)};}');
    await sleep(900);
    const st = await ev('function(){try{var s=JSON.parse(localStorage.getItem("wsr_save_v1")||"null");' +
      'return s?{level:(JSON.parse(s.body).level)}:{no:true};}catch(e){return {err:String(e)};}}');
    check('A5 点「开始游戏」真的进了第 1 关（存档 level=1）', st && st.level === 1, JSON.stringify(st));

    /* A6 localStorage 真的落了 V6.0 新字段 */
    const v6 = await ev('function(){try{var raw=localStorage.getItem("wsr_save_v1");if(!raw)return {no:true};' +
      'var b=JSON.parse(JSON.parse(raw).body);' +
      'return {hasMax:("maxLevel" in b),hasWarm:("warmTier" in b),hasLast:("lastPlayed" in b),ver:b.v};' +
      '}catch(e){return {err:String(e)};}}');
    check('A6 线上存档写入 V6.0 新字段（maxLevel/warmTier/lastPlayed）',
      v6 && v6.hasMax && v6.hasWarm && v6.hasLast, JSON.stringify(v6));

    /* A7 线上没 tap SDK 时，默认 online 配置会诚实降级（不能假装接通） */
    const adEnv = await ev('function(){' +
      'var m=String(document.documentElement.outerHTML).match(/env:[\'"]([a-z]+)[\'"]/);' +
      'return {decl:m?m[1]:null, hasTap:!!(window.tap&&window.tap.createRewardedVideoAd)};}');
    check('A7 线上配置为 online 且当前环境无 tap SDK（= 真机才有真实广告）',
      adEnv && adEnv.decl === 'online' && adEnv.hasTap === false, JSON.stringify(adEnv));
  } catch (e) {
    check('A 趟次跑完', false, String((e && e.message) || e).slice(0, 200));
  } finally {
    try { client_close(ws); } catch (e) { }
    try { ch.kill(); } catch (e) { }
  }
}
function client_close(ws) { try { if (ws) ws.close(); } catch (e) { } }

/* ================= 趟次 B：线上字节 + 后门 + tap mock 深交互 ================= */
function runLegB(htmlStr) {
  /* ★ 踩过的坑：这一版最初是「父页面 + iframe + postMessage 转发」。
     结果 BENCH 的同步代码（发出第一条消息）能到父页面，**之后的 setTimeout 回调一条都不发** ——
     页面里断言根本没跑，却报「0 条」而不是报错，是最难查的那种假绿（看着像通过）。
     现在改成**顶层导航**：每个 case 是一次真实页面跳转，页面自己把结果 POST 回 server，
     server 攒齐 4 份再交给判定。少一层 iframe/message，也更像真人打开页面。 */
  return new Promise(function (resolve) {
    var CASES=['warm','online','cancel','fail'];
    var TAP={warm:null,online:'ended',cancel:'cancel',fail:'fail'};
    var reports=[], allDone=false;
    function runner(n){
      return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#666">'
        + '<script>var CS='+JSON.stringify(CASES)+', n='+n+';'
        + 'var id=CS[n-1]; setTimeout(function(){ location.href="/game?case="+id+"&n="+n; }, 50);<\/script></body></html>';
    }
    var server=http.createServer(function(req,res){
      if(req.method==='POST'&&req.url.split('?')[0]==='/report'){
        var b=''; req.on('data',function(c){b+=c;});
        req.on('end',function(){
          try{ reports.push(JSON.parse(b)); }catch(e){ reports.push({cases:[],error:'bad json'}); }
          res.writeHead(200); res.end('ok');
        });
        return;
      }
      if(req.url.split('?')[0]==='/next'){
        var n=+((req.url.match(/i=([0-9]+)/)||[])[1]||1);
        allDone=(n>CASES.length);
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(runner(n+1)); return;
      }
      var cm=req.url.match(/case=([a-z]+)/);
      if(cm){
        var id=cm[1];
        var page=null;
        try{
          page=inject(htmlStr, TAP[id]?tapMock(TAP[id]):null).replace('</body>', BENCH+'</body>');
        }catch(e){ page='<pre>INJECT_ERR:'+(e&&e.message)+'</pre>'; }
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(page); return;
      }
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(runner(1));
    });
    server.listen(0,'127.0.0.1',function(){
      if(!fs.existsSync(CHROME)) return bail('找不到真实 Chrome：'+CHROME);
      var port=server.address().port;
      var udd=path.join(os.tmpdir(),'wb-livesim-b-'+Date.now());
      var ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
        '--disable-extensions','--mute-audio','--disable-background-timer-throttling',
        '--disable-renderer-backgrounding','--window-size='+(W+40)+','+(H+120),
        '--user-data-dir='+udd,'http://127.0.0.1:'+port+'/'],{stdio:'ignore'});
      var start=Date.now();
      var timer=setInterval(function(){
        var full=(reports.length>=CASES.length)||allDone;
        if(full||(Date.now()-start)>120000){
          clearInterval(timer); try{ch.kill();}catch(e){} try{server.close();}catch(e){}
          if(!reports.length) return resolve({error:'B 趟次：Chrome 一个报告都没回传'});
          var all=[];
          reports.forEach(function(r){ (r.cases||[]).forEach(function(c){all.push(c);}); });
          resolve({cases:all});
        }
      },300);
    });
  });
}

/* B 趟次在页面里跑的断言（拿到 qa_lib 后门 window.__DBG） */
const BENCH = [
  '<script>(function(){',
  ' var D=window.__DBG, out=[], errs=[];',
  ' window.addEventListener("error",function(e){errs.push(String((e&&e.message)||e));});',
  ' errs.push("bench-loaded __DBG="+(!!window.__DBG));',
  ' var CID="?";',
  ' function ck(name,ok,detail){out.push({case:CID,name:name,ok:!!ok,detail:String(detail||"")});}',
  ' function run(){',
  '  var id=(location.search.match(/case=([a-z]+)/)||[])[1]||"?"; CID=id;',
  '  try{',
  '   if(id==="warm"){',
  '     /* 模拟"老玩家隔了 13 天回来"：进度停在第 15 关，lastPlayed 是 13 天前 */',
  '     var old=JSON.parse(localStorage.getItem(D.SAVE_KEY)||"{}")||{};',
  '     var body=old.body?JSON.parse(old.body):D.Store.blank();',
  '     body.level=15; body.maxLevel=15; body.warmTier=0; body.warmActive=0;',
  '     body.lastPlayed=Date.now()-13*24*3600*1000;',
  '     localStorage.setItem(D.SAVE_KEY, JSON.stringify({sig:D.Store.hash(JSON.stringify(body)),body:JSON.stringify(body)}));',
  '     /* 重新载入，走一遍真实的 Boot 判热 */',
  '     D.Store.load();',
  '     var w=D.warm.warmupOnBoot();',
  '     ck("回归玩家：13 天没玩→第 15 关开局判定为热身", !!w, JSON.stringify(w));',
  '     ck("热身起步档 = -2（热身1）", D.Store.data.warmTier===-2, "warmTier="+D.Store.data.warmTier);',
  '     ck("热身绑在当前这一关（warmLevel=15）", D.Store.data.warmLevel===15, "warmLevel="+D.Store.data.warmLevel);',
  '     ck("关卡进度没被改动（level/maxLevel 仍是 15）", D.Store.data.level===15&&D.Store.data.maxLevel===15, "level="+D.Store.data.level+" maxLevel="+D.Store.data.maxLevel);',
  '     var t0t=D.warm.resolveChallengeTier(D.Store.data.level);',
  '     ck("第 15 关挑战档位被压到热身档（tier<=0）", t0t<=0, "tier="+t0t);',
  '     ck("换一关就不给热身（tier=0）", D.warm.resolveChallengeTier(16)===0, "tier(16)="+D.warm.resolveChallengeTier(16));',
  '     D.warm.advanceWarmup();',
  '     ck("成功后逐档回升（-2→-1）", D.Store.data.warmTier===-1, "warmTier="+D.Store.data.warmTier);',
  '     D.warm.advanceWarmup(); D.warm.advanceWarmup();',
  '     ck("连续成功后回到正常档（0）且热身结束", D.Store.data.warmTier===0&&D.Store.data.warmActive===0, "warmTier="+D.Store.data.warmTier+" warmActive="+D.Store.data.warmActive);',
  '   } else if(id==="online"){',
  '     ck("注入 tap SDK 后 AdService 走 ONLINE", D.AdService.env==="online", "env="+D.AdService.env+" reason="+D.AdService.degradeReason);',
  '     D.AdService.stats.request=0;',
  /* ★ 回调契约跟着产品走：激励视频看完发的是 onReward（不是 onSuccess），中途退出是 onCancel。
     写错一个字母，断言就会"假绿地通过"（回调从来没被触发过，got 一直是 false）。 */
  '     var got=false; D.AdService.showRewarded("revive",{force:true,onReward:function(){got=true;},onFail:function(){}});',
  '     ck("真实链路：tap.createRewardedVideoAd 被调用", (window.__TAP.calls.length>0), JSON.stringify(window.__TAP.calls));',
  '     ck("传进去的 adUnitId 就是配置的那个", window.__TAP.calls[0]===(D.CFG.adUnit&&D.CFG.adUnit.rewarded), "got="+window.__TAP.calls[0]);',
  '     setTimeout(function(){',
  '       ck("看完广告（isEnded=true）后真的发奖", got===true, "onSuccess fired="+got);',
  '       ck("广告统计里 show 有账", D.AdService.stats.show>=1, "show="+D.AdService.stats.show);',
  '       send(); }, 400);',
  '     return;',
  '   } else if(id==="cancel"){',
  '     var g2=false, settled2=false;',
  '     D.AdService.showRewarded("revive",{force:true,onReward:function(){g2=true;},onFail:function(){settled2=true;},onFallback:function(){settled2=true;},onCancel:function(){settled2=true;}});',
  '     setTimeout(function(){',
  '       ck("中途退出（isEnded=false）不发奖", g2===false, "onReward fired="+g2);',
  '       ck("中途退出计入 cancel", D.AdService.stats.cancel>=1, "cancel="+D.AdService.stats.cancel);',
  '       ck("中途退出后调用方回调仍会收口（不卡流程）", settled2===true, "settled="+settled2);',
  '       send(); }, 400);',
  '     return;',
  '   } else if(id==="fail"){',
  /* 广告拉不起来（onError）时：不发奖、计数有账、且调用方回调必须收口 ——
     「不卡流程」的真正含义是 onReward/onFail/onFallback 至少触发一个把加载层收起来，
     不是"必须触发 onFail"（在线上路径里 onFail 只在重试也救不回来时才走得到）。 */
  '     var g3=false, settled3=false;',
  '     D.AdService.showRewarded("revive",{force:true,onReward:function(){g3=true;settled3=true;},onFail:function(){settled3=true;},onFallback:function(){settled3=true;},onCancel:function(){settled3=true;}});',
  '     setTimeout(function(){',
  '       ck("广告拉不起来时不发奖", g3===false, "onReward fired="+g3);',
  '       ck("加载失败计入 loadFail", D.AdService.stats.loadFail>=1, "loadFail="+D.AdService.stats.loadFail);',
  '       ck("重试后仍能收口（不卡流程）", settled3===true, "settled="+settled3);',
  '       send(); }, 400);',
  '     return;',
  '   }',
  '   send();',
  '  }catch(e){ out.push({case:id,name:"B 趟次断言本身没抛错",ok:false,detail:String(e&&e.message||e)}); send(); }',
  ' }',
  ' function send(){ var x=new XMLHttpRequest();x.open("POST","/report",true);x.setRequestHeader("Content-Type","application/json");'
  + '  var n=(location.search.match(/n=([0-9]+)/)||[])[1]||"1"; x.send(JSON.stringify({cases:out,n:n}));'
  + '  setTimeout(function(){ location.href="/next?i="+n; }, 300); }',
  ' setTimeout(run, 700);',
  '})();<\/script>'
].join('\n');

/* ---------------- main ---------------- */
(async function () {
  console.log('===== 线上环境模拟自测 Q A _ L I V E _ S I M ===== ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
  console.log('  目标：' + LIVE_URL);
  const live = await fetchLive();
  console.log('  线上：' + live.buf.length + ' B / md5 ' + live.md5);
  check('线上可取回且非空', live.buf.length > 10000, live.buf.length + ' B');
  if (!new RegExp("version:'" + EXPECT_VERSION.replace(/\./g, '\\.') + "'").test(live.buf.toString('utf8'))) {
    const m = live.buf.toString('utf8').match(/version:'([0-9.]+)'/);
    check('线上主文件就是 V6.0 字节', false, '实际 version=' + (m ? m[1] : '未找到'));
  } else {
    check('线上主文件就是 V' + EXPECT_VERSION + ' 字节', true, '含 version:' + EXPECT_VERSION);
  }

  let htmlStr = null;
  try { htmlStr = live.buf.toString('utf8'); } catch (e) { return bail('线上内容转字符串失败'); }

  await runLegA(live);
  const repB = await runLegB(htmlStr);
  if (repB && repB.cases) {
    (repB.cases || []).forEach(function (c) { check('B/' + c.case + ' ' + c.name, c.ok, c.detail); });
    if (!repB.cases.length) console.log('  [诊断] B 趟次回传为空：' + JSON.stringify(repB).slice(0, 300));
  } else {
    check('B 趟次跑出结果', false, repB && repB.error ? repB.error : 'Chrome 没回传数据');
  }

  const pass = checks.filter(function (c) { return c.ok; }).length;
  const fail = checks.length - pass;
  fs.writeFileSync(path.join(__dirname, OUT), JSON.stringify({ at: new Date().toISOString(), liveMd5: live.md5, ok: fail === 0, checks: checks }, null, 2), 'utf8');
  console.log('  线上 md5 ' + live.md5 + '　产物 → ' + OUT);
  console.log('__QA__ ' + JSON.stringify({ suite: 'livesim', pass: pass, fail: fail, warn: 0, ms: Date.now() - t0, fails: fails, warns: [] }));
  process.exit(fail === 0 ? 0 : 1);
})();

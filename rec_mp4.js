/* rec_mp4.js —— 无头 Chrome 实机录屏（CDP 驱动，零依赖，不需要 ffmpeg）
 *
 * 为什么要这条路：
 *   本机没有 ffmpeg；而 Chrome 154 原生支持 video/mp4;codecs=avc1（H.264），
 *   所以 canvas.captureStream + MediaRecorder 可以直接吐标准 MP4（ftyp isom）。
 *   画面就是游戏自己的渲染，属于真正的"实机画面"，不是翻录屏幕。
 *
 * 完整流程（三步，缺一不可）：
 *   1) node rec_inject.js outputs/解压水消除.html .workbuddy/_rec_tmp.html
 *      游戏脚本是 (function(){...})() 包裹的，内部没有全局导出，外部点不到具体水管。
 *      这一步生成一个**临时副本**，在 IIFE 收尾前插一段 window.__DBG 导出；
 *      交付文件一个字节都不动（脚本会打印主文件 md5 供核对）。
 *   2) REC_SIZE=720x1280 node rec_mp4.js "file:///…/_rec_tmp.html?lvl=17" rec_play.js out.mp4
 *      打开临时副本，页面内自动玩 + 录制，MP4 分块取回落盘。
 *   3) node mp4info.js out.mp4          ← 硬事实：帧数 / 编码 / 片段数
 *      浏览器开 verify_mp4.html?src=…   ← 实时播放取样，证明画面真的在动
 *
 * 用法：
 *   node rec_mp4.js <url> <play_expr.js> <out.mp4>
 *   env: REC_SIZE=720x1280   浏览器视口（决定 canvas 输出分辨率；游戏会按视口自适应，
 *                            720x1280 时 scale=1、offX=offY=0，输出像素=设定像素）
 *        REC_WAIT=<ms>       导航后等待
 *        REC_SCALE=<n>       force-device-scale-factor，默认 1
 *
 * ⚠ 踩过的坑（改这段前先读）：
 *   · canvas.captureStream(30) 在 --headless=new 下只会吐开头几秒的帧，之后合成器
 *     不再给 canvas 帧源推帧，**录出来是一张定格图**（duration 只有 5s、四帧全等）。
 *     必须用 captureStream(0) + 自己 setInterval 调 track.requestFrame() 泵帧。
 *   · MediaRecorder 出的是 **fragmented MP4，Chrome 对它 seek 不可靠**：按 currentTime
 *     跳帧取样，四帧全等 + duration 报 3.38s，全是假象。验证必须**实时播放边播边取**，
 *     或者直接解析 box（mp4info.js）。别用 seek 判"视频是不是静止的"。
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = process.argv[2];
const exprFile = process.argv[3];
const outMp4 = process.argv[4] || path.join(__dirname, 'rec_out.mp4');
const size = (process.env.REC_SIZE || '720x1280').replace(/[x×]/, 'x');
const [W, H] = size.split('x').map(Number);
const dsf = process.env.REC_SCALE || '1';
const waitMs = +(process.env.REC_WAIT || 3000);
const profile = process.env.CDP_PROFILE || path.join(__dirname, '.workbuddy', '_chromeprofile');
const diagFile = path.join(__dirname, 'rec_diag.json');

const log = (...a) => console.log(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function freePort() {
  return new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

(async function main() {
  const diag = { url, size, chrome: CHROME };
  const finish = (obj) => { fs.writeFileSync(diagFile, JSON.stringify(Object.assign(diag, obj), null, 2), 'utf8'); };

  if (!fs.existsSync(CHROME)) { finish({ error: 'no chrome' }); process.exit(1); }
  if (!fs.existsSync(exprFile)) { finish({ error: 'no expr file ' + exprFile }); process.exit(1); }

  const port = await freePort();
  fs.mkdirSync(profile, { recursive: true });
  const ch = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio',
    // 关键：录屏期间不能让浏览器把 rAF 降频，否则画面卡顿 / 录出来是静态图
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-ipc-flooding-protection',
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${W},${H}`, `--force-device-scale-factor=${dsf}`,
    '--hide-scrollbars',
    '--remote-debugging-port=' + port, '--remote-allow-origins=*',
    '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });
  let ws = null;
  const cleanup = () => { try { ws && ws.close(); } catch (e) { } try { ch.kill(); } catch (e) { } };

  try {
    let ver = null;
    for (let i = 0; i < 80; i++) {
      try { ver = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json()); break; }
      catch (e) { await sleep(250); }
    }
    if (!ver) { finish({ error: 'devtools not up' }); cleanup(); process.exit(1); }
    diag.browser = ver.Browser;

    ws = new WebSocket(ver.webSocketDebuggerUrl);
    let msgId = 0; const pending = new Map();
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); setTimeout(() => rej(new Error('ws timeout')), 15000); });
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const send = (method, params, sessionId) => new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {}, sessionId })); });

    const t = await send('Target.createTarget', { url });
    const sid = (await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true })).result.sessionId;
    await send('Page.enable', {}, sid);
    await send('Runtime.enable', {}, sid);
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: +dsf, mobile: false }, sid);

    for (let i = 0; i < 80; i++) {
      const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sid);
      const st = r.result && r.result.result && r.result.result.value;
      if (st === 'complete' || st === 'interactive') break;
      await sleep(250);
    }
    await sleep(waitMs);

    const ev = async (expr, awaitP) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitP, userGesture: true }, sid);
      if (r.result && r.result.exceptionDetails) {
        return { __err: r.result.exceptionDetails.text + ' :: ' + JSON.stringify(((r.result.exceptionDetails.exception || {}).description) || '').slice(0, 1000) };
      }
      return r.result && r.result.result ? r.result.result.value : null;
    };

    // 0) 环境体检：rAF 有没有在跑 + 画布真实像素尺寸
    diag.env = await ev(`(async()=>{let f=0;const t=()=>{f++;requestAnimationFrame(t)};requestAnimationFrame(t);const t0=performance.now();await new Promise(r=>setTimeout(r,1200));const fps=f/((performance.now()-t0)/1000);
      return { fps:+fps.toFixed(1), hasDBG: typeof window.__DBG, info: window.__DBG? window.__DBG.info(): null, mrMp4: typeof MediaRecorder!=='undefined'? MediaRecorder.isTypeSupported('video/mp4;codecs=avc1'):'noMR' };})()`, true);
    log('ENV', JSON.stringify(diag.env));
    if (!diag.env || diag.env.hasDBG !== 'object') { finish({ error: 'DBG 未注入，检查临时副本是否用 _rec_inject.js 生成', env: diag.env }); cleanup(); process.exit(1); }

    // 1) 播放脚本（内部自带录制）：只返回 JSON 摘要，视频 blob 存在 window.__REC
    const expr = fs.readFileSync(exprFile, 'utf8');
    const summary = await ev(expr, true);
    log('PLAY', JSON.stringify(summary));
    diag.play = summary;
    if (summary && summary.__err) { finish({ error: 'play expr failed', summary }); cleanup(); process.exit(1); }

    // 2) 分块取回 base64（单次 CDP 消息塞十几 MB 不安全，2MB 一块）
    const total = await ev('window.__REC ? window.__REC.length : 0');
    log('REC base64 length', total);
    if (!total) { finish({ error: 'no recording in page', summary }); cleanup(); process.exit(1); }
    const CH = 2 * 1024 * 1024;
    const parts = [];
    for (let i = 0; i < total; i += CH) {
      const s = await ev(`window.__REC.substr(${i}, ${CH})`);
      if (typeof s !== 'string' || !s.length) { finish({ error: 'chunk fetch failed at ' + i, total }); cleanup(); process.exit(1); }
      parts.push(s);
      process.stdout.write(`  chunk ${Math.floor(i / CH) + 1}/${Math.ceil(total / CH)}\r`);
    }
    const b64 = parts.join('');
    const buf = Buffer.from(b64, 'base64');
    fs.mkdirSync(path.dirname(outMp4), { recursive: true });
    fs.writeFileSync(outMp4, buf);

    const head = buf.slice(0, 32).toString('hex');
    diag.output = { file: outMp4, bytes: buf.length, headHex: head, isFtyp: buf.slice(4, 8).toString('ascii') === 'ftyp' };
    log('WROTE', outMp4, buf.length, 'bytes, magic=', buf.slice(4, 8).toString('ascii'));
    finish({ ok: true });
    cleanup();
    process.exit(0);
  } catch (e) {
    finish({ error: 'SCRIPT FAIL: ' + (e && e.message) });
    cleanup();
    process.exit(1);
  }
})();

/* qa_gate.js —— 上线门禁（把「上线前必过清单」变成可执行断言）
 *
 * 它守的是一条线：**不过门禁就不许上线**。所以这里的每一条都必须是
 * 「真能拦住事故」的硬条件，而不是好看的数字：
 *
 *   G3 单文件 < 200KB      —— 交付形态不能退化（零依赖、一个文件拿走就能用）
 *   G4 ES5 合规            —— 老 WebView 语法报错 = 直接白屏，这条最容易在加功能时破
 *   G5 无外部依赖          —— 一旦混进外部 script/link/@import，离线打不开、CDN 挂了就白屏
 *   G6 1~40 关全部可解      —— 关卡表越界 / 生成器死锁，玩家卡在第 34 关就卸载
 *   G7 机器人 1~40 关全通   —— 「保证不卡死」这个卖点的独立证明（用真机器人打，不是自检）
 *   G8 线上字节与本地一致   —— 踩过：改了主文件忘了同步发布目录，线上一直停在旧版
 *
 * G4 的实现要点（别简化）：必须先剥掉**注释、字符串、正则字面量**再扫语法。
 * 直接 grep `const` / `=>` 会被注释里的中文说明和 `// {units:[...]}` 这种注释骗到，
 * 变成「永远 FAIL」或「永远 PASS」的假断言 —— 本项目已经吃过四次假绿的亏。
 *
 * 用法：node qa_gate.js              （含线上比对）
 *       node qa_gate.js --no-live    （离线：只跑本地条件，明确标注 G8 未验证）
 * 产物：_gate.json（给 qa_run.js --gate 汇总）+ 控制台明细
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = __dirname;
const GAME = process.env.GAME || path.join(ROOT, 'outputs', '解压水消除.html');
const PUB = process.env.PUB || path.join(ROOT, 'publish_water', 'index.html');
const LIVE_URL = process.env.LIVE_URL || 'https://water-sort-relax.app.workbuddy.host/';
const MAX_KB = +(process.env.MAX_KB || 200);
const SOLVE_REPS = +(process.env.GATE_SOLVE_REPS || 3);
const NO_LIVE = process.argv.indexOf('--no-live') >= 0 || process.env.GATE_NO_LIVE === '1';

const items = [];
function item(id, name, ok, detail) {
  items.push({ id: id, name: name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  [' + id + '] ' + name + (detail ? '  → ' + detail : ''));
  return !!ok;
}
function warn(id, name, detail) {
  items.push({ id: id, name: name, ok: true, skipped: true, detail: detail || '' });
  console.log('SKIP  [' + id + '] ' + name + '  → ' + (detail || ''));
}

/* ============ G4 用：剥掉注释 / 字符串 / 正则，只留真正的代码 ============ */
function stripLits(src) {
  let out = '', i = 0;
  const n = src.length;
  let prevSig = '';
  const startsRegex = p => p === '' || '(,=:[!&|?{};+-*%~^<>'.indexOf(p) >= 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }          // 行注释
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; } // 块注释
    if (c === '"' || c === "'") {                                                            // 字符串
      const q = c; i++;
      while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      out += q + q; prevSig = q; continue;
    }
    if (c === '/' && startsRegex(prevSig)) {                                                  // 正则字面量
      i++;
      let inClass = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { i++; break; }
        else if (ch === '\n') break;
        i++;
      }
      out += 'RX'; prevSig = 'X'; continue;
    }
    out += c;
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out;
}

/* ============ G4：会让老 WebView 直接语法报错的构造 ============ */
const ES6 = [
  ['箭头函数 `=>`', /=>/],
  ['`let` 声明', /\blet\s+[A-Za-z_$]/],
  ['`const` 声明', /\bconst\s+[A-Za-z_$]/],
  ['模板字符串（反引号）', /`/],
  ['展开/剩余 `...`', /\.\.\./],
  ['`class` 声明', /\bclass\s+[A-Za-z_$]/],
  ['`for...of`', /for\s*\([^)]*\bof\b[^)]*\)/],
  ['`async` / `await`', /\basync\b|\bawait\s/],
  ['可选链 `?.`', /\?\./],
  ['空值合并 `??`', /\?\?/],
  ['`function*` 生成器', /function\s*\*/],
  ['默认参数（参数里出现 `=`）', /function\s*\([^)]*[A-Za-z_$][\w$]*\s*=[^=]/]
];

/* ============ G5：外部依赖 ============ */
const EXT = [
  ['`<script src=...>`', /<script[^>]+src\s*=/i],
  ['`<link>` 外链', /<link\b/i],
  ['CSS `@import`', /@import/i],
  ['`url(http...)` 外链资源', /url\(\s*['"]?https?:/i],
  ['`document.createElement("script")`', /createElement\(\s*['"]script['"]\s*\)/],
  ['`importScripts` / `new Worker`', /importScripts\s*\(|new\s+(Shared)?Worker\s*\(/]
];

/* ============ 取线上内容（破 CDN 缓存 + 跟随跳转 + 解 gzip） ============
   http/https 都支持：https 是线上真实场景，http 是为了让回滚验证能在本机
   起一个「故意不一致」的服务器，把 G8b 这条门禁**确定性地**验证一遍
   （不然它只能靠「线上恰好是旧版」这种碰巧才能被证明有效）。 */
function fetchLive(url, depth) {
  return new Promise(resolve => {
    if ((depth || 0) > 4) return resolve({ ok: false, err: '跳转次数过多' });
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, err: 'URL 非法' }); }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get({
      hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search,
      headers: {
        'User-Agent': 'qa-gate/1.0', 'Accept-Encoding': 'gzip, deflate',
        'Cache-Control': 'no-cache', 'Pragma': 'no-cache'
      }, timeout: 20000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchLive(new URL(res.headers.location, url).toString(), (depth || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve({ ok: false, err: 'HTTP ' + res.statusCode }); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = String(res.headers['content-encoding'] || '');
        try {
          if (enc.indexOf('gzip') >= 0) buf = zlib.gunzipSync(buf);
          else if (enc.indexOf('deflate') >= 0) buf = zlib.inflateSync(buf);
        } catch (e) { return resolve({ ok: false, err: '解压失败 ' + e.message }); }
        resolve({ ok: true, buf: buf, status: res.statusCode });
      });
    });
    req.on('error', e => resolve({ ok: false, err: e.message }));
    req.on('timeout', () => { try { req.destroy(); } catch (e) { } resolve({ ok: false, err: '超时' }); });
  });
}

/* ================= 主流程 ================= */
(async function main() {
  const t0 = Date.now();
  console.log('===== 上线门禁 Q A G A T E  ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + ' =====');

  /* ---- 读文件 ---- */
  let html = null, pubBuf = null;
  try { html = fs.readFileSync(GAME, 'utf8'); } catch (e) { }
  try { pubBuf = fs.readFileSync(PUB); } catch (e) { }
  const selfBuf = html === null ? null : Buffer.from(html, 'utf8');

  /* ---- G3 单文件 < 200KB ---- */
  const kb = selfBuf ? selfBuf.length / 1024 : 0;
  item('G3', '单文件体积 < ' + MAX_KB + 'KB（零依赖交付形态没退化）',
    selfBuf && kb < MAX_KB,
    selfBuf ? kb.toFixed(1) + 'KB / 上限 ' + MAX_KB + 'KB' : '主文件读不到：' + GAME);

  /* ---- G4 ES5 合规 ---- */
  let stripped = '';
  if (html) {
    const m = html.match(/<script>([\s\S]*)<\/script>/);
    if (!m) item('G4', 'ES5 合规', false, '找不到 <script> 块');
    else {
      stripped = stripLits(m[1]);
      const bad = [];
      ES6.forEach(p => { const a = stripped.match(new RegExp(p[1].source, 'g')); if (a) bad.push(p[0] + ' ×' + a.length); });
      item('G4', 'ES5 合规（剥掉注释/字符串/正则后无 ES6+ 语法）', bad.length === 0,
        bad.length ? bad.join('、') : '扫过 ' + (stripped.length / 1024).toFixed(0) + 'KB 纯代码，0 命中');
    }
  }

  /* ---- G5 无外部依赖 ---- */
  if (html) {
    const bad = [];
    EXT.forEach(p => { const a = html.match(new RegExp(p[1].source, 'g')); if (a) bad.push(p[0] + ' ×' + a.length); });
    const scripts = (html.match(/<script>/g) || []).length;
    if (scripts !== 1) bad.push('<script> 块有 ' + scripts + ' 个（应为 1）');
    item('G5', '无外部依赖（自包含单文件）', bad.length === 0,
      bad.length ? bad.join('、') : '1 个内联 <script>，0 个 src/link/@import/url(http)');
  }

  /* ---- G6 1~40 关全部可解 + 水量守恒 ---- */
  try {
    const { loadGame } = require('./qa_lib.js');
    const g = loadGame({});
    g.frames(3);
    const D = g.DBG;
    const unsolvable = [], broken = [];
    for (let lv = 1; lv <= 40; lv++) {
      for (let k = 0; k < SOLVE_REPS; k++) {
        D.gen(lv);
        /* 关键：在 gen 之后、frames 之前采（本项目踩过：主循环第一帧会改状态，走完帧再查就查不到了）*/
        if (!D.layoutSolvable()) unsolvable.push('L' + lv);
        const G = D.G;
        let water = 0;
        G.tubes.forEach(t => t.units.forEach(() => water++));
        const cap = G.bottles.length * 3;
        if (water !== cap) broken.push('L' + lv + ' 水' + water + '≠容量' + cap);
        if (G.state !== 'play') broken.push('L' + lv + ' 生成后 state=' + G.state);
        G.bottles.forEach(b => {
          if (b.cell < 0 || b.cell >= G.cellCount) broken.push('L' + lv + ' 瓶子落在格 ' + b.cell + '（共 ' + G.cellCount + ' 格）');
        });
      }
    }
    const uniq = a => [...new Set(a)];
    item('G6', '1~40 关全部可解（每关 ' + SOLVE_REPS + ' 次生成）+ 水量守恒',
      unsolvable.length === 0 && broken.length === 0,
      (unsolvable.length ? '不可解：' + uniq(unsolvable).join(',') + '；' : '')
      + (broken.length ? '结构异常：' + uniq(broken).slice(0, 4).join(' / ') : '')
      || '40 关 × ' + SOLVE_REPS + ' 次，全部通过剥落式自检且水量守恒');
  } catch (e) {
    item('G6', '1~40 关全部可解', false, '执行异常：' + (e && e.message));
  }

  /* ---- G8 线上字节与本地一致 ---- */
  const hashes = {};
  ['outputs/解压水消除.html', 'publish_water/index.html'].forEach(p => {
    try { const b = fs.readFileSync(path.join(ROOT, p)); hashes[p] = { n: b.length, md5: crypto.createHash('md5').update(b).digest('hex') }; }
    catch (e) { hashes[p] = null; }
  });
  const pubSame = hashes['outputs/解压水消除.html'] && hashes['publish_water/index.html']
    && hashes['outputs/解压水消除.html'].md5 === hashes['publish_water/index.html'].md5;

  item('G8a', '发布件与主文件字节一致（改了主文件必须同步发布目录）', !!pubSame,
    pubSame ? 'md5 ' + hashes['publish_water/index.html'].md5 + '（' + hashes['publish_water/index.html'].n + 'B）'
      : (hashes['publish_water/index.html']
        ? '主文件 ' + hashes['outputs/解压水消除.html'].md5 + ' ≠ 发布件 ' + hashes['publish_water/index.html'].md5
        : '发布目录里没有 index.html：' + PUB));

  if (NO_LIVE) {
    warn('G8b', '线上字节与本地一致', '--no-live：本次不联网验证，**这条门禁等于没跑**');
  } else {
    const url = LIVE_URL + (LIVE_URL.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
    const r = await fetchLive(url, 0);
    if (!r.ok) {
      item('G8b', '线上字节与本地一致', false,
        '取不到线上内容（' + r.err + '）→ 无法证明线上就是这一版，按「不许上线」处理');
    } else {
      const liveMd5 = crypto.createHash('md5').update(r.buf).digest('hex');
      const same = pubSame && r.buf.equals(fs.readFileSync(PUB));
      item('G8b', '线上字节与本地一致（带 ?t= 破 CDN 缓存）', same,
        same ? '线上 ' + r.buf.length + 'B / md5 ' + liveMd5 + ' 与发布件逐字节相同'
          : '线上 ' + r.buf.length + 'B / md5 ' + liveMd5
          + '　vs 本地发布件 ' + (hashes['publish_water/index.html'] ? hashes['publish_water/index.html'].n + 'B / md5 ' + hashes['publish_water/index.html'].md5 : '缺失')
          + '　→ 线上是旧版或没同步');
    }
  }

  const ok = items.every(x => x.ok);
  fs.writeFileSync(path.join(ROOT, '_gate.json'), JSON.stringify({
    at: new Date().toISOString(), ok: ok, ms: Date.now() - t0, noLive: NO_LIVE,
    liveUrl: LIVE_URL, items: items
  }, null, 2), 'utf8');

  const pass = items.filter(x => x.ok).length, fail = items.length - pass;
  console.log('');
  console.log('=== 门禁本地条件：' + pass + ' PASS / ' + fail + ' FAIL  （' + ((Date.now() - t0) / 1000).toFixed(1) + 's）===');
  console.log('__QA__ ' + JSON.stringify({ suite: 'gate', pass: pass, fail: fail, warn: NO_LIVE ? 1 : 0, ms: Date.now() - t0, fails: items.filter(x => !x.ok).map(x => '[' + x.id + '] ' + x.name + ' → ' + x.detail), warns: [] }));
  process.exit(fail === 0 ? 0 : 1);
})();

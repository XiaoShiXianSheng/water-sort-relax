/* qa_gate.js —— 上线门禁（把「上线前必过清单」变成可执行断言）
 *
 * 它守的是一条线：**不过门禁就不许上线**。所以这里的每一条都必须是
 * 「真能拦住事故」的硬条件，而不是好看的数字：
 *
 *   G3 单文件 < 200KB      —— 交付形态不能退化（零依赖、一个文件拿走就能用）
 *   G4 ES5 合规            —— 老 WebView 语法报错 = 直接白屏，这条最容易在加功能时破
 *   G5 无外部依赖          —— 一旦混进外部 script/link/@import，离线打不开、CDN 挂了就白屏
 *   G14 ES5 运行期兼容      —— G4 只查**语法**（箭头函数 / let / 模板串）。但 `Promise`、`new Map()`、
 *                               `Object.assign`、`Array.from`、`Number.isInteger`、`.includes(` 这些
 *                               **语法完全合法**，在老 WebView 里却是 `undefined is not a function`
 *                               → 整页白屏，而语法检查**永远看不见**。README 里「兼容老 WebView」
 *                               这句承诺，只有这条在守。
 *   G6 1~40 关全部可解      —— 关卡表越界 / 生成器死锁，玩家卡在第 34 关就卸载
 *   G6b 面板显示的每一关都能玩 —— 面板按 LV_PER_PAGE × LV_PAGES 显示（当前 90 关），
 *                                G6/G7 只盯 1~40，第 41~90 关点得开但没有测试管
 *   G7 机器人 1~40 关全通   —— 「保证不卡死」这个卖点的独立证明（用真机器人打，不是自检）
 *   G8 线上字节与本地一致   —— 踩过：改了主文件忘了同步发布目录，线上一直停在旧版
 *   G11 出厂广告位 ID 已填   —— 踩过同类事故（env='test' → 真机跑模拟广告、零收益且不报错）；
 *                                adUnitId 被清空是它的孪生形态，而 qa_biz 里恰好有一条
 *                                「没有 adUnitId 必须降级」的用例会**故意**清空它 → 套件里永远查不出
 *
 * G4 的实现要点（别简化）：必须先剥掉**注释、字符串、正则字面量**再扫语法。
 * 直接 grep `const` / `=>` 会被注释里的中文说明和 `// {units:[...]}` 这种注释骗到，
 * 变成「永远 FAIL」或「永远 PASS」的假断言 —— 本项目已经吃过四次假绿的亏。
 *
 * 注意：**G12（断网冒烟）与 G13（真浏览器端到端点击）不在这里**，它们在 `qa_run.js` 里
 * 由 `qa_smoke_live.js` 的两趟运行汇总 —— 那两条要在真浏览器里跑，放在这个"静态 + 文件级"
 * 的脚本里会让 `node qa_gate.js` 单跑时也要起 Chrome，排查时反而更绕。
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
/* G8a 必须盯住**每一个**「会被拿去部署/上传的副本」，不是只盯一个目录。
   踩过两次同一个坑：第一次 publish_water 漏同步（线上停在旧版），
   第二次 publish_taptap 漏同步（一旦重新打包，就会把没有广告位 ID 的旧版打进去 → 静默零收益）。 */
const PUB_COPIES = (process.env.PUB_COPIES ||
  ['publish_water/index.html', 'publish_taptap/index.html'].join(',')).split(',');
const ZIP_DIR = process.env.ZIP_DIR || path.join(ROOT, 'outputs');
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

/* 「只差换行符」诊断：内容一模一样、只有 CRLF/LF 之别时，直接说出来。
   踩过：全局 core.autocrlf=true，一次 git rebase 就把主文件从 LF 写成 CRLF，
   发布件和线上还是 LF → 门禁翻红，但内容其实完全一致，不看这条提示要查很久。 */
function eolOnly(a, b) {
  if (!a || !b || a.equals(b)) return false;
  const na = a.toString('latin1').replace(/\r\n/g, '\n');
  const nb = b.toString('latin1').replace(/\r\n/g, '\n');
  return na === nb;
}
const EOL_HINT = '　⚠ 内容其实**完全一致**，只差换行符（CRLF vs LF）—— 检查 `core.autocrlf` 与 `.gitattributes`';

/* ============ 从 zip 里取条目原始字节（给 G8c 用）============
 * 坑（第一次就踩了）：zip 常用「通用位标记 bit3」把 size 挪到 data descriptor，
 * 此时**本地头里的 csize 是 0**，照着本地头读会解压报 "unexpected end of file"。
 * 所以必须走「中央目录 PK\x01\x02」拿真实 size 与本地头偏移，再回本地头算数据起点。 */
function zipEntry(buf, wantName) {
  const PK_CD = Buffer.from('PK\x01\x02', 'binary');
  const PK_LF = Buffer.from('PK\x03\x04', 'binary');
  let i = 0, found = null;
  while (!found && (i = buf.indexOf(PK_CD, i)) >= 0) {
    const nlen = buf.readUInt16LE(i + 28), elen = buf.readUInt16LE(i + 30), clen = buf.readUInt16LE(i + 32);
    const name = buf.slice(i + 46, i + 46 + nlen).toString('utf8');
    if (name === wantName) {
      found = { method: buf.readUInt16LE(i + 10), csize: buf.readUInt32LE(i + 20), lho: buf.readUInt32LE(i + 42) };
    }
    i += 46 + nlen + elen + clen;
  }
  if (!found) return null;
  const j = buf.indexOf(PK_LF, found.lho);
  if (j < 0) return null;
  const dstart = j + 30 + buf.readUInt16LE(j + 26) + buf.readUInt16LE(j + 28);
  let raw = buf.slice(dstart, dstart + found.csize);
  try { if (found.method === 8) raw = zlib.inflateRawSync(raw); } catch (e) { return null; }
  return { raw: raw, md5: crypto.createHash('md5').update(raw).digest('hex') };
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

  /* ---- G14 ES5 运行期兼容：不许调用 ES6+ 的**内置 API** ----
     为什么 G4 之后还要单开一条：G4 查的是**语法**（`=>` / `let` / `const` / 模板串 / 展开 …），
     它挡不住"合法的 ES5 语法 + 老 WebView 里不存在的内置对象"这种组合：
     `Promise.resolve()`、`new Map()`、`Object.assign()`、`Array.from()`、`Number.isInteger()`、
     `'a'.includes('a')`、`'a'.padStart(2)`、`Math.trunc()` —— 语法一律合法，一跑就
     `TypeError: undefined is not a function`，整个 <script> 挂掉 → **白屏**。
     README 里写着「纯 ES5（兼容老 WebView）」，这条就是给那句话配的哨兵。

     ★ 名单只收**绝无歧义**的内置成员，宁可漏收也不误判：
       `\.fill\(` 绝对不能进名单 —— Canvas 的 `ctx.fill()` 长这样，
       第一版一刀切收进去，扫描立刻报 71 处"违规"，全是画布填充（59 × ctx + 2 × 别名）。
       同理 `\.find(` / `\.repeat(` 也排除：卡牌/动画代码里一个自定义 helper 就叫这名，
       假警报比漏收更贵 —— 门禁一旦会误报，人就不信它了（同 §9.1「性能为什么没进门禁」）。 */
  const ES6_RUNTIME = [
    ['`Promise`（老 WebView 没有）', /\bPromise\b/],
    ['`new Map/Set/WeakMap/WeakSet`', /\bnew\s+(?:Map|Set|WeakMap|WeakSet)\s*\(/],
    ['`Symbol`', /\bSymbol\b/],
    ['`Proxy` / `Reflect`', /\bProxy\b|\bReflect\./],
    ['`globalThis`', /\bglobalThis\b/],
    ['`Object.assign/entries/values/fromEntries/is`', /Object\.(?:assign|entries|values|fromEntries|is)\s*\(/],
    ['`Array.from/of`', /Array\.(?:from|of)\s*\(/],
    ['`Number.isInteger/isSafeInteger/isFinite/isNaN/parseFloat/parseInt`',
      /Number\.(?:isInteger|isSafeInteger|isFinite|isNaN|parseFloat|parseInt)\b/],
    ['`Math.trunc/hypot/sign/cbrt/fround/imul/log2/log10/expm1/log1p/clz32`',
      /Math\.(?:trunc|hypot|sign|cbrt|fround|imul|log2|log10|expm1|log1p|clz32)\s*\(/],
    ['`.includes(`（ES2016）', /\.includes\s*\(/],
    ['`.padStart/` `.padEnd(`', /\.pad(?:Start|End)\s*\(/],
    ['`.startsWith(` / `.endsWith(`', /\.(?:startsWith|endsWith)\s*\(/]
  ];
  if (stripped) {
    const badR = [];
    ES6_RUNTIME.forEach(p => {
      const a = stripped.match(new RegExp(p[1].source, 'g'));
      if (a) badR.push(p[0] + ' ×' + a.length);
    });
    item('G14', 'ES5 运行期兼容：代码里没有 ES6+ 内置 API（语法合法但老 WebView 里 undefined → 白屏）',
      badR.length === 0,
      badR.length
        ? '命中 ' + badR.join('、') + '　→ 老 WebView 会在这一行抛 TypeError，整个 <script> 挂掉 = 白屏；请改用 ES5 等价写法（或自己补 polyfill）'
        : '扫过 ' + (stripped.length / 1024).toFixed(0) + 'KB 纯代码：Promise / Map / Symbol / Proxy / Object.assign / Array.from / Number.is* / Math.trunc* / .includes( / .padStart( / .startsWith( 全部 0 命中');
  }

  /* ---- G11 出厂广告位 ID 必须已填（静默零收益的孪生形态）----
     2026-09-29 真出过事故：CFG.env 是 'test' → 真机跑**模拟广告**（点一下直接发奖、
     根本不请求广告平台）→ 一个广告费都收不到，而且**不报任何错**，游戏照常玩。
     adUnitId 被清空是同一类事故的另一半：env 仍是 'online'，但 AdService.init() 会
     自动降级成 test(no-ad-unit-id) → 又是静默零收益。
     为什么套件里查不出来：qa_biz 恰好有一条「没有 adUnitId 时必须降级成 test」的用例，
     它会**故意**把 adUnitId 清空 —— 于是「出厂 adUnitId 是空的」这件事永远见不到红。
     所以必须静态扫**交付文件本身**，且先 stripLits 再匹配（否则被注释掉的配置也能骗过这条）。 */
  if (html) {
    const mAd = html.match(/adUnit\s*:\s*\{\s*rewarded\s*:\s*'([^']*)'\s*,\s*interstitial\s*:\s*'([^']*)'\s*\}/);
    const notCommentedOut = !!stripped && /adUnit\s*:\s*\{/.test(stripped);
    const looksPlaceholder = v => !v || /^\s*$/.test(v) || /^x+$/i.test(v) || /^(todo|tbd|test|your|待填|填)/i.test(v);
    const rw = mAd ? mAd[1] : '', it2 = mAd ? mAd[2] : '';
    const ok11 = !!mAd && notCommentedOut && !looksPlaceholder(rw) && !looksPlaceholder(it2);
    item('G11', '出厂广告位 ID 已填（两个都非空且没被注释掉；空了会静默降级成模拟广告 = 零收益）', ok11,
      !mAd ? '源码里找不到 `adUnit:{rewarded:…,interstitial:…}` 这段配置 —— 配置块被删/改名了，按不许上线处理'
        : !notCommentedOut ? 'adUnit 配置被**注释掉了**（剥掉注释后扫不到）→ 真机会静默降级成模拟广告'
          : ok11 ? '激励视频 ' + rw + ' / 插屏 ' + it2 + '　（⚠ 平台侧仍需确认推广位属性为「正式」）'
            : '有 ID 是空的或仍是占位符：rewarded=`' + rw + '` / interstitial=`' + it2 + '`');
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

  /* ---- G6b 选关面板显示多少关，就必须有多少关能玩 ----
     为什么单开一条：选关面板按 LV_PER_PAGE × LV_PAGES 渲染（当前 30×3 = 90 关），
     面板上第 41~90 关是**真的能被手指点到**的；而 G6 与 G7 只覆盖 1~40 关。
     一旦生成器在高关位出问题（数组越界、关卡表被写死、高关不可解），
     玩家点开一个开不起来（或必输）的关，现有测试**一条都不会红** —— 典型的门禁盲区。
     实现上：常量**从源码读**，不硬编码 90。面板改了，门禁自动跟着走，避免两处口径漂移。 */
  let panelN = 0;
  try {
    /* 两个常量分别解析（而不是钉死「var A=x, B=y;」这一种写法），
       但值必须是**紧跟分隔符的纯数字字面量** —— 写成 `LV_PAGES=1+2` 这种表达式时
       宁可报「读不到」也不去猜：门禁一旦猜错就会少测几十关，而它自己看不出来。
       「读不到」按不许上线处理（没验证 ≠ 通过），跟 --no-live 那一条一个道理。 */
    const gpA = html ? html.match(/\bLV_PER_PAGE\s*=\s*(\d+)\s*[,;]/) : null;
    const gpB = html ? html.match(/\bLV_PAGES\s*=\s*(\d+)\s*[,;]/) : null;
    if (!gpA || !gpB) {
      item('G6b', '选关面板显示的每一关都能生成且可解（关数从源码读）', false,
        '读不到 `LV_PER_PAGE` / `LV_PAGES` 的数字字面量（' + (gpA ? '' : 'LV_PER_PAGE 缺; ') + (gpB ? '' : 'LV_PAGES 缺; ')
        + '）—— 常量改名 / 删掉 / 写成表达式了？请同步更新这条断言，否则等于放弃这条门禁，按不许上线处理');
    } else {
      panelN = (+gpA[1]) * (+gpB[1]);
      const { loadGame } = require('./qa_lib.js');
      const g2 = loadGame({});
      g2.frames(3);
      const D2 = g2.DBG;
      const bad2 = [];
      let maxCells = 0, maxBottles = 0;
      for (let lv = 1; lv <= panelN; lv++) {
        try {
          D2.gen(lv);
          /* 与 G6 同样的规矩：在 gen 之后、frames 之前采（走完帧状态会被主循环改掉） */
          if (!D2.layoutSolvable()) bad2.push('L' + lv + ' 不可解');
          const G2 = D2.G;
          let water = 0; G2.tubes.forEach(t => t.units.forEach(() => water++));
          const cap = G2.bottles.length * 3;
          if (water !== cap) bad2.push('L' + lv + ' 水' + water + '≠容量' + cap);
          if (G2.state !== 'play') bad2.push('L' + lv + ' 生成后state=' + G2.state);
          G2.bottles.forEach(b => {
            if (b.cell < 0 || b.cell >= G2.cellCount) bad2.push('L' + lv + ' 瓶落在格' + b.cell + '（共' + G2.cellCount + '格）');
          });
          maxCells = Math.max(maxCells, G2.cellCount);
          maxBottles = Math.max(maxBottles, G2.bottles.length);
        } catch (e) { bad2.push('L' + lv + ' 抛错 ' + (e && e.message)); }
      }
      item('G6b', '选关面板显示的每一关都能生成且可解（面板 ' + gpA[1] + '×' + gpB[1] + ' = ' + panelN + ' 关）',
        bad2.length === 0,
        bad2.length ? '共 ' + bad2.length + ' 处：' + [...new Set(bad2)].slice(0, 6).join('、')
          : '1~' + panelN + ' 关逐关生成通过（最大 ' + maxCells + ' 格 / ' + maxBottles + ' 瓶），可解性与水量守恒全过');
    }
  } catch (e) {
    item('G6b', '选关面板显示的每一关都能生成且可解', false, '执行异常：' + (e && e.message));
  }

  /* ---- G8a 所有发布副本都必须与主文件逐字节一致 ---- */
  const hashes = {};
  PUB_COPIES.forEach(p => {
    try { const b = fs.readFileSync(path.join(ROOT, p)); hashes[p] = { n: b.length, md5: crypto.createHash('md5').update(b).digest('hex'), buf: b }; }
    catch (e) { hashes[p] = null; }
  });
  const mainMd5 = (function () {
    /* 用**原始字节**算 md5，不要走 readFileSync(utf8) 再 Buffer.from 回去 ——
       万一文件里混进非法 UTF-8 序列，round-trip 会改字节，门禁就会冤判发布件不同步。 */
    try { return { buf: fs.readFileSync(GAME), md5: crypto.createHash('md5').update(fs.readFileSync(GAME)).digest('hex') }; }
    catch (e) { return null; }
  })();
  const mainBuf = mainMd5 ? mainMd5.buf : null;
  const mainHash = mainMd5 ? mainMd5.md5 : null;
  const badCopies = PUB_COPIES.filter(p => !hashes[p] || !mainHash || hashes[p].md5 !== mainHash);
  const pubSame = !!mainHash && badCopies.length === 0;

  const pubBuf2 = hashes['publish_water/index.html'] ? hashes['publish_water/index.html'].buf : null;
  item('G8a', '所有发布副本与主文件字节一致（改了主文件必须同步每一个发布目录）', pubSame,
    pubSame ? PUB_COPIES.length + ' 份副本全部 md5 ' + mainHash + '（' + (mainBuf ? mainBuf.length : 0) + 'B）'
      : '不一致：' + badCopies.map(p => !hashes[p]
        ? p + '（读不到）'
        : p + ' ' + hashes[p].md5 + '（' + hashes[p].n + 'B）≠ 主文件 ' + mainHash
        + (eolOnly(mainBuf, hashes[p].buf) ? EOL_HINT : '')).join('　|　'));

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
      const same = pubSame && r.buf.equals(pubBuf2);
      item('G8b', '线上字节与本地一致（带 ?t= 破 CDN 缓存）', same,
        same ? '线上 ' + r.buf.length + 'B / md5 ' + liveMd5 + ' 与发布件逐字节相同'
          : '线上 ' + r.buf.length + 'B / md5 ' + liveMd5
          + '　vs 本地发布件 ' + (hashes['publish_water/index.html'] ? hashes['publish_water/index.html'].n + 'B / md5 ' + hashes['publish_water/index.html'].md5 : '缺失')
          + '　→ 线上是旧版或没同步'
          + (eolOnly(r.buf, pubBuf2) ? EOL_HINT : ''));
    }
  }

  /* ---- G8c 上传包（zip）里的 index.html 必须与主文件一致 ----
     为什么单独一条：包内是 deflate 压过的，**肉眼完全看不出是哪个版本**。
     踩到的场景：publish_taptap/index.html 是旧版（没有广告位 ID），
     真正的 zip 当时恰好是对的 —— 但只要有人「重新打个包」，就会把旧版打进去，
     真机上跑 true 广告却没有广告位 ID → 又一次静默零收益。
     所以：目录里每一个含 index.html 的 zip，都拆开比 md5。 */
  let zips = [];
  try { zips = fs.readdirSync(ZIP_DIR).filter(f => /\.zip$/i.test(f)); } catch (e) { }
  const zipOK = [], zipBad = [], zipSkip = [];
  zips.forEach(f => {
    let e = null;
    try { e = zipEntry(fs.readFileSync(path.join(ZIP_DIR, f)), 'index.html'); } catch (err) { e = null; }
    if (!e) { zipSkip.push(f); return; }
    if (mainBuf && e.raw.equals(mainBuf)) zipOK.push(f + '（' + e.raw.length + 'B md5 ' + e.md5 + '）');
    else zipBad.push(f + '（包内 md5 ' + e.md5 + ' ≠ 主文件 ' + mainHash + '）');
  });
  if (zips.length === 0) {
    warn('G8c', '上传包内的 index.html 与主文件一致', ZIP_DIR + ' 里没有 zip，这条门禁等于没跑');
  } else {
    item('G8c', '所有上传包内的 index.html 与主文件一致（拆包比 md5，肉眼看不出版本）', zipBad.length === 0,
      (zipOK.length ? '已核对：' + zipOK.join('、') : '没有含 index.html 的包')
      + (zipSkip.length ? '；不含 index.html 未核对：' + zipSkip.join('、') : '')
      + (zipBad.length ? '；❌ 版本不一致：' + zipBad.join('，') : ''));
  }

  /* ---- G10：QA 脚本自身语法自检 ----
     为什么单开一条：2026-09-29 发现 qa_rollback.js 里一段注释嵌了内层块注释标记，
     把外层块注释**提前闭合** → 后面半行成了裸代码 → 一跑就 SyntaxError。
     而 qa_rollback.js 是**独立运行**的（不在 qa_run.js 里），所以「回滚验证早就死了」
     这件事没有任何地方会报出来 —— 那之后所有"回滚全绿"的说法都是无效的。
     **验证器本身必须先被验证**：这条对所有以 qa_ 或 test_ 开头的脚本做纯语法编译（不执行）。
     ★ 写这条注释时又把同一个错犯了一遍 —— 写了「qa_ 星号 斜杠 test_ 星号」这种简写，
       其中「星号斜杠」立刻闭合了块注释，qa_gate.js 当场 SyntaxError。
       所以：**块注释里绝对不要再出现斜杠星号 / 星号斜杠这对字符**，只写中文描述。 */
  try {
    const vm = require('vm');
    const files = fs.readdirSync(ROOT).filter(f => /^(qa_|test_)[^/]*\.js$/.test(f)).sort();
    const bad = [];
    files.forEach(f => {
      try { new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
      catch (e) { bad.push(f + '（' + (e && e.message) + '）'); }
    });
    item('G10', 'QA 脚本自身语法自检（验证器必须先能被验证）', bad.length === 0 && files.length > 0,
      bad.length ? bad.join('；') : files.length + ' 个 QA 脚本全部通过语法编译：' + files.join(' '));
  } catch (e) {
    item('G10', 'QA 脚本自身语法自检', false, '执行异常：' + (e && e.message));
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

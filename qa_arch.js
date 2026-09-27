/* qa_arch.js —— 架构测试：单文件交付的「地基不变量」
 *
 * 它回答的问题是：这份产物能不能作为一个零依赖单文件被分发出去？
 *   · 有没有偷偷引用外部资源（断网/内网环境会白屏）
 *   · 有没有用到老 WebView 不支持的语法（TapTap / 微信 WebView 会直接语法错误）
 *   · 崩溃有没有兜底（线上白屏是最贵的 bug）
 *   · 测试后门默认是不是关着的（不然玩家一进来就是第 15 关）
 *
 * 用法：node qa_arch.js
 */
const fs = require('fs');
const { loadGame, Reporter, guard, GAME } = require('./qa_lib.js');
const rep = new Reporter('arch');

/* 把字符串字面量和注释抠掉，剩下的才是"真代码" —— 否则注释里的 => 会误报 */
function stripLiteralsAndComments(src) {
  let out = '', i = 0; const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; out += ' '; continue; }
    if (c === '/' && c2 === '/') { i += 2; while (i < n && src[i] !== '\n') i++; out += ' '; continue; }
    if (c === "'" || c === '"') {
      const q = c; i++;
      while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      out += ' "" '; continue;
    }
    out += c; i++;
  }
  return out;
}

guard(rep, '架构', function () {
  const html = fs.readFileSync(GAME, 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  const js = m ? m[1] : '';
  const code = stripLiteralsAndComments(js);

  /* ---------- 1. 零外部依赖 ---------- */
  const extPatterns = [
    ['<script src=', /<script[^>]+src=/i],
    ['<link rel=', /<link[^>]+rel=/i],
    ['@import', /@import/i],
    ['CSS url(http', /url\(\s*['"]?https?:/i],
    ['fetch(', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['WebSocket', /new\s+WebSocket/],
    ['importScripts', /importScripts\s*\(/],
    ['外部 http 引用', /https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+/i]
  ];
  extPatterns.forEach(function (p) {
    const hit = html.match(p[1]);
    rep.ok('零外部依赖：不含 ' + p[0], !hit, hit ? '出现：' + String(hit[0]).slice(0, 60) : '');
  });

  /* ---------- 2. 体积（按 UTF-8 字节算，别用字符串长度自欺欺人） ---------- */
  const bytes = Buffer.byteLength(html, 'utf8');
  const kb = bytes / 1024;
  rep.ok('体积可控（≤ 200 KB，当前 ' + kb.toFixed(1) + ' KB / ' + bytes + ' B）', kb <= 200);

  /* ---------- 3. ES5 兼容（老 WebView 只有 ES5） ---------- */
  const es6 = [
    ['箭头函数 =>', /=>/],
    ['let 声明', /\blet\s+[A-Za-z_$]/],
    ['const 声明', /\bconst\s+[A-Za-z_$]/],
    ['class 声明', /\bclass\s+[A-Za-z_$]/],
    ['async/await', /\b(async|await)\b/],
    ['展开运算符 ...', /\.\.\./],
    ['可选链 ?.', /\?\.[A-Za-z_$[(]/],
    ['空值合并 ??', /\?\?/]
  ];
  es6.forEach(function (p) {
    const hit = code.match(p[1]);
    rep.ok('ES5 兼容：未使用 ' + p[0], !hit, hit ? '出现：' + String(hit[0]).slice(0, 40) : '');
  });
  const backticks = (js.match(/`/g) || []).length;
  rep.ok('ES5 兼容：未使用模板字符串（反引号）', backticks === 0, '反引号 ' + backticks + ' 个');

  /* ---------- 4. 崩溃兜底 ---------- */
  rep.ok('有全局错误兜底（window.onerror 不白屏）', /window\.onerror\s*=/.test(js));
  rep.ok('有 Promise 未捕获兜底（unhandledrejection）', /unhandledrejection/.test(js));
  rep.ok('有运行期 try/catch 兜底（不静默死循环）', /catch\s*\(/.test(js));

  /* ---------- 5. 交付形态 ---------- */
  rep.ok('单文件自包含（只有 1 个 <script> 块）',
    (html.match(/<script/g) || []).length === 1);
  rep.ok('有移动端 viewport（禁双指缩放 + 刘海安全区）',
    /viewport-fit=cover/.test(html) && /user-scalable=no/.test(html));
  rep.ok('有触屏事件入口（touchstart）', /addEventListener\('touchstart'/.test(js));
  const consoleLogs = (code.match(/console\.(log|warn|error|info)\s*\(/g) || []).length;
  rep.warnIf('无调试期 console 残留', consoleLogs > 0, consoleLogs + ' 处');

  /* ---------- 6. 后门默认关闭 ---------- */
  const g0 = loadGame({ search: '' });
  g0.frames(3);
  rep.ok('默认启动是标题页（不是直接进关）', g0.DBG.G.state === 'title');
  rep.ok('默认不跳关：URL_LVL 为 0', g0.DBG.URL_LVL === 0, 'URL_LVL=' + g0.DBG.URL_LVL);
  rep.ok('默认无渲染崩溃', g0.DBG.fatal === false);

  /* 显式带参数时才生效 —— 这是给自己调试用的，不是给玩家的 */
  const g1 = loadGame({ search: '?lvl=15' });
  g1.frames(3);
  rep.ok('带 ?lvl=15 时才跳关（调试后门可控）', g1.DBG.URL_LVL === 15, 'URL_LVL=' + g1.DBG.URL_LVL);

  /* ---------- 7. 加载期健壮性：多次全新加载都要稳定 ---------- */
  let bad = 0;
  for (let k = 0; k < 3; k++) {
    try { const g = loadGame({}); g.frames(10); if (g.DBG.fatal) bad++; }
    catch (e) { bad++; }
  }
  rep.ok('连续 3 次全新加载 + 渲染 10 帧，无一次崩溃', bad === 0, bad + ' 次异常');
});

rep.done();

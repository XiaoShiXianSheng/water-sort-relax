// 截图工具 v3：可注入任意游戏状态（含隐藏选关面板 / 醒目横幅）
// 用法：NAME=xxx LV=8 MODE=picker node shot3.js
const { execFileSync } = require('child_process');
const path = require('path'), fs = require('fs');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const GAME = path.join(__dirname, 'outputs', '解压水消除.html');
const LV = +(process.env.LV || 1);
const NAME = process.env.NAME || ('shot_lv' + LV);
const MODE = (process.env.MODE || '').trim();
const W = +(process.env.W || 720), H = +(process.env.H || 1280);
const BUDGET = +(process.env.BUDGET || 2500);   // 有「会自己消失」的横幅时调小，别等它过期

let html = fs.readFileSync(GAME, 'utf8');
const A = 'requestAnimationFrame(loop);';
const i = html.lastIndexOf(A);
html = html.slice(0, i)
  + 'window.__DBG={get G(){return G;},gen:genLevel,plan:levelPlan,startPlace:startPlace};'
  + html.slice(i);

let setup = '';
if (MODE === 'picker') {
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV}); var G=D.G;
  G.lvPick=true; G.lvPickPage=${process.env.PAGE ? +process.env.PAGE : 0};
})();
</script>`;
} else if (MODE === 'warn') {
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV}); var G=D.G;
  G.warn={msg:'台面满了！点「撤销」把一个瓶子放回格子',t:0.4};
  var gb=G.bottles.filter(function(b){return b.place==='grid'&&b.gate<0;})[0];
  if(gb)gb.shake=0.5;
})();
</script>`;
} else if (MODE === 'jar') {
  // 台面瓶子特写：真的走正常流程放两瓶上台面并让它们接到水（看进度刻度）
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV}); var G=D.G;
  var list=G.bottles.filter(function(b){return b.place==='grid'&&b.gate<0;});
  setTimeout(function(){ D.startPlace(list[0]); },80);
  var keep=list[0];
  setInterval(function(){ if(keep&&keep.place==='counter'&&!keep.done)keep.fill=2; },60);
})();
</script>`;
} else if (MODE === 'hint') {
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV}); var G=D.G;
  G.hint={a:'台面上的瓶子都接不到水了',b:'点「随心互换」换换管底，或点「撤销」退回一瓶'};
})();
</script>`;
}

// 状态设置必须在游戏脚本之后、渲染之前插入 → 直接拼在 </body> 前（游戏用 rAF 持续渲染，会覆盖）
if (setup) html = html.replace('</body>', setup + '</body>');

const tmp = path.join(__dirname, '_s3.html');
fs.writeFileSync(tmp, html);
const out = path.join(__dirname, NAME + '.png');
try {
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${W},${H}`, `--virtual-time-budget=${BUDGET}`, `--screenshot=${out}`,
    `file:///${tmp.replace(/\\/g, '/')}?lvl=${LV}`], { stdio: 'ignore' });
  fs.appendFileSync(path.join(__dirname, '_shot3.log'), 'OK ' + out + '\n');
} catch (e) {
  fs.appendFileSync(path.join(__dirname, '_shot3.log'), 'ERR ' + NAME + ': ' + e.message + '\n');
}

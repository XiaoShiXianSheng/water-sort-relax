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
  + 'window.__DBG={get G(){return G;},gen:genLevel,plan:levelPlan,startPlace:startPlace,'
  + 'enterFail:enterFail,Store:Store,Track:Track};'
  + html.slice(i);

let setup = '';
/* 通用：让某段状态在截图期间「打不死」（游戏自己在跑 rAF，会被 update 抹掉） */
const hold = (js) => `setInterval(function(){ var G=window.__DBG.G; ${js} }, 40);`;

if (MODE === 'title') {
  // 首页：真实存档 + 首页动效（水柱/漂浮瓶/进度/两个点击理由）
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return;
  D.Store.load(); D.Store.data.level=12;
  D.Store.data.stars={ '1':{normal:3,hard:0,extreme:0},'2':{normal:2,hard:0,extreme:0},
    '3':{normal:3,hard:2,extreme:0},'4':{normal:1,hard:0,extreme:0},'5':{normal:3,hard:0,extreme:0},
    '6':{normal:2,hard:0,extreme:0},'7':{normal:3,hard:1,extreme:0},'8':{normal:3,hard:0,extreme:0},
    '9':{normal:2,hard:0,extreme:0},'10':{normal:3,hard:0,extreme:0},'11':{normal:1,hard:0,extreme:0} };
  D.Store.save();
  ${hold("G.state='title'; G.fail=null;")}
})();
</script>`;
} else if (MODE === 'tut') {
  // 新手教学：第 1~3 关的提示条
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV});
  ${hold("G.tutTip=1;")}
})();
</script>`;
} else if (MODE === 'picker') {
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV}); var G=D.G;
  ${hold(`G.lvPick=true; G.lvPickPage=${process.env.PAGE ? +process.env.PAGE : 0};`)}
})();
</script>`;
} else if (MODE === 'warn') {
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV}); var G=D.G;
  var gb=G.bottles.filter(function(b){return b.place==='grid'&&b.gate<0;})[0];
  ${hold("G.warn={msg:'台面满了！点「撤销」把一个瓶子放回格子',t:0.4}; if(gb)gb.shake=0.5;")}
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
} else if (MODE === 'fail') {
  // 真实失败面板（V4.0 §10）：先把局面做死，再走产品自己的 enterFail
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV}); var G=D.G;
  setTimeout(function(){
    G.anim=null; G.tools={clear:0,finger:0,swap:0}; G.undoLeft=0; G.unlockLeft=0;
    G.tubes.forEach(function(t){ for(var k=0;k<t.units.length;k++) t.units[k]=5; });
  }, 60);
  setTimeout(function(){ var D2=window.__DBG; D2.enterFail('exhausted'); }, 400);
  ${hold("if(G.fail)G.fail.t=1;")}
})();
</script>`;
} else if (MODE === 'tier') {
  // 同关卡递进挑战：普通 / 困难 / 极限
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV});
  D.Store.load(); D.Store.data.tiers[${LV}]=1; D.Store.data.stars['${LV}']={normal:3,hard:1,extreme:0};
  ${hold("G.tierPick=true;")}
})();
</script>`;
} else if (MODE === 'win') {
  // 结算页：星级 + 统计 + 再挑战入口
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV});
  D.Store.load(); D.Store.data.tiers[${LV}]=1; D.Store.data.stars['${LV}']={normal:3,hard:2,extreme:0};
  var G=D.G;
  G.winStats={stars:3,moves:38,tools:0,revive:0,tier:0,par:50,daily:false};
  ${hold("G.state='win'; G.winStats={stars:3,moves:38,tools:0,revive:0,tier:0,par:50,daily:false};")}
})();
</script>`;
} else if (MODE === 'hint') {
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV}); var G=D.G;
  ${hold("G.hint={a:'台面上的瓶子都接不到水了',b:'点「随心互换」换换管底，或点「撤销」退回一瓶'};")}
})();
</script>`;
} else if (MODE === 'play') {
  // 普通对局画面（不给任何提示条 / 面板）
  setup = `
<script>
(function(){ var D=window.__DBG; if(!D)return; D.gen(${LV});
  ${hold("G.state='play'; G.hint=null; G.tutTip=0; G.warn=null;")}
})();
</script>`;
}

// 状态设置必须在游戏脚本之后、渲染之前插入 → 直接拼在 </body> 前（游戏用 rAF 持续渲染，会覆盖）
if (setup) html = html.replace('</body>', setup + '</body>');

const LOG = path.join(__dirname, '_shot3.log');
const tmp = path.join(__dirname, '_s3_' + NAME + '.html');
const out = path.join(__dirname, NAME + '.png');
const prof = path.join(__dirname, '_chr_' + NAME);
try {
  fs.appendFileSync(LOG, 'START ' + NAME + ' mode=' + (MODE || '-') + ' lv=' + LV + '\n');
  fs.writeFileSync(tmp, html);
  // 每次用独立 profile，避免多个 headless 实例抢锁 / 残留进程卡住
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--user-data-dir=' + prof.replace(/\\/g, '/'), '--no-first-run', '--disable-extensions',
    `--window-size=${W},${H}`, `--virtual-time-budget=${BUDGET}`, `--screenshot=${out}`,
    `file:///${tmp.replace(/\\/g, '/')}?lvl=${LV}`], { stdio: 'ignore', timeout: +(process.env.TMOUT || 60000) });
  fs.appendFileSync(LOG, 'OK ' + out + '\n');
} catch (e) {
  fs.appendFileSync(LOG, 'ERR ' + NAME + ': ' + (e && e.message ? e.message : String(e)) + '\n');
}

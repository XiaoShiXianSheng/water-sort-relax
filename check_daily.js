/* check_daily.js —— Bug A 最小复现脚本
 *
 * 目标：用脚本证据回答「普通模式通关后，G.daily 到底是 true 还是 false」，
 *       以及主按钮文案到底是「再来一局」还是「下一关 →」。
 *
 * 走真实路径：
 *   ① 进游戏（首页点空白 = 继续上次进度 → startFromTitle() → genLevel(lv)）
 *   ② 触发通关（把瓶子全清空 + 调 levelDone()，即产品自己的结算入口）
 *   ③ 读 G.daily / G.winStats.daily / 渲染出来的主按钮文案
 *   ④ 真实点击主按钮，看是进「下一关」还是重开本关
 *   ⑤ 再走一遍「每日挑战」路径对照
 *
 * 用法：node check_daily.js
 */
const { loadGame } = require('./qa_lib.js');

function buttonTexts(g) {
  const t = g.renderOnce();
  return {
    all: t,
    hasNext: t.some(s => s.indexOf('下一关') >= 0),
    hasReplay: t.some(s => s.indexOf('再来一局') >= 0),
    hasReplayDaily: t.some(s => s.indexOf('重玩今日题') >= 0),
    title: t.filter(s => s.indexOf('收完') >= 0 || s.indexOf('挑战完成') >= 0)
  };
}

function forceWin(g) {
  g.DBG.G.bottles.forEach(b => { b.place = 'gone'; });
  g.DBG.levelDone();
  g.frames(3);
  g.DBG.G.winStreak = 0;            // 别让插屏逻辑干扰本脚本
  g.DBG.G.interPending = false;
}

console.log('========== Bug A 复现：普通模式 vs 每日挑战 ==========\n');

/* ---- 场景 1：普通模式（首页 → 开始游戏走的同一条 genLevel 路径） ---- */
{
  const g = loadGame({});
  g.frames(3);
  g.click(360, 640);                // 首页点空白 = 继续上次进度（普通模式）
  g.frames(6);
  const G = g.DBG.G;
  const before = { state: G.state, level: G.level, daily: G.daily, dailyDate: G.dailyDate };
  forceWin(g);
  const bt = buttonTexts(g);
  console.log('【普通模式】');
  console.log('  进入时        :', JSON.stringify(before));
  console.log('  通关后 G.daily=', G.daily, ' G.winStats.daily=', G.winStats.daily);
  console.log('  通关后 state  =', G.state, ' level=', G.level);
  console.log('  渲染主按钮    : 下一关?', bt.hasNext, ' 再来一局?', bt.hasReplay);
  console.log('  弹窗标题      :', JSON.stringify(bt.title));
  /* 真实点击主按钮 */
  g.viewClick(225, 979);            // WIN_UI.next 中心
  g.frames(6);
  console.log('  点主按钮后    : state=', G.state, ' level=', G.level, ' daily=', G.daily,
    ' → 结果 =', (G.state === 'play' && G.level === before.level + 1) ? '进入下一关 ✅' : '不是下一关 ❌');
  console.log('');
}

/* ---- 场景 2：每日挑战（首页「每日挑战」按钮走的 startDaily() 路径） ---- */
{
  const g = loadGame({});
  g.frames(3);
  g.DBG.startDaily();               // 真实入口：TITLE_UI.daily → startDaily()
  g.frames(5);
  const G = g.DBG.G;
  const before = { state: G.state, level: G.level, daily: G.daily, dailyDate: G.dailyDate };
  forceWin(g);
  const bt = buttonTexts(g);
  console.log('【每日挑战】');
  console.log('  进入时        :', JSON.stringify(before));
  console.log('  通关后 G.daily=', G.daily, ' G.winStats.daily=', G.winStats.daily);
  console.log('  渲染主按钮    : 下一关?', bt.hasNext, ' 再来一局?', bt.hasReplay);
  console.log('  弹窗标题      :', JSON.stringify(bt.title));
  g.viewClick(225, 979);            // WIN_UI.next 中心
  g.frames(6);
  console.log('  点主按钮后    : state=', G.state, ' level=', G.level, ' daily=', G.daily,
    ' → 结果 =', (G.state === 'play' && G.level === before.level && G.daily === true)
      ? '重开同一局（用户看到的「还在本关」）' : '其它');
  console.log('');
}

/* ---- 场景 3：把所有 genLevel 调用点能构造的入口都试一遍，看谁能把 daily 变成 true ---- */
console.log('【入口普查：除了 startDaily()，还有别的地方能让 G.daily=true 吗？】');
{
  const g = loadGame({});
  g.frames(3);
  const G = g.DBG.G;
  g.click(360, 640); g.frames(4);                 // 普通开始
  const results = [];
  const check = (name) => results.push(name + ' → G.daily=' + G.daily);
  /* ① HUD 重开 */
  g.viewClick(645, 58); g.frames(2); check('HUD「重开」(genLevel(G.level))');
  /* ② 通关 → 下一关 */
  forceWin(g); g.viewClick(225, 979); g.frames(4); check('通关点「下一关」(genLevel(G.level+1))');
  /* ③ 隐藏选关面板跳关 */
  for (let i = 0; i < 5; i++) { g.viewClick(105, 58); g.frames(1); }
  check('连点关卡号开选关面板(G.lvPick=' + G.lvPick + ')');
  G.lvPick = false;
  /* ④ ?lvl= 参数入口 */
  const g2 = loadGame({ search: '?lvl=12' });
  g2.frames(4);
  results.push('?lvl=12 启动 → G.daily=' + g2.DBG.G.daily + ' (state=' + g2.DBG.G.state + ')');
  results.forEach(r => console.log('  ' + r));
}
console.log('\n（若全部为 false 且只有每日挑战为 true，则「普通关卡显示再来一局」是模式误报）');

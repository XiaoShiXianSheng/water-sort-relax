/* check_tier.js —— Bug B 最小复现 / 修复验证脚本
 * 走真实路径：普通开局 → 通关 → 点「再挑战本关」→ 点某一档 → 看是否真的换档并开局。
 * 用法：node check_tier.js
 */
const { loadGame } = require('./qa_lib.js');

function center(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
function rowCenter(D, id) {
  const r = D.TIER_UI.rows.filter(r => r.id === id)[0];
  return { x: 360, y: r.y + 46 };
}

function openWinOn(g, lv, tiers) {
  g.DBG.gen(lv, { tier: 0 }); g.frames(4);
  g.DBG.Store.reset();
  g.DBG.Store.data.stars[String(lv)] = { normal: 3, hard: tiers >= 1 ? 1 : 0, extreme: 0 };
  g.DBG.G.bottles.forEach(b => { b.place = 'gone'; });
  g.DBG.levelDone(); g.frames(3);
  g.DBG.Store.data.tiers[lv] = tiers;   // 覆盖 levelDone 的自动解锁，构造要测的解锁状态
  g.DBG.G.winStreak = 0; g.DBG.G.interPending = false;
}

console.log('===== Bug B：结算页「再挑战本关」→ 选档面板 =====\n');
const g = loadGame({});
g.frames(3);
g.viewClick(360, 640); g.frames(5);        // 普通开始
const D = g.DBG, G = D.G;

/* 1. 打开选档面板 */
openWinOn(g, 9, 1);
console.log('通关后      : state=' + G.state + ' daily=' + G.daily);
g.viewClick(center(D.WIN_UI.challenge).x, center(D.WIN_UI.challenge).y);
g.frames(3);
console.log('点「再挑战本关」: G.tierPick=' + G.tierPick + ' (state 仍为 ' + G.state + ')');

/* 2. 渲染：tierPick 打开时是否还叠画了结算面板？ */
const t = g.renderOnce();
console.log('渲染文字里：含「挑战档位」=' + t.some(s => s.indexOf('挑战档位') >= 0)
  + '  含「全部收完」=' + t.some(s => s.indexOf('收完') >= 0) + '  (后者应为 false)');

/* 3. 点「困难」档（已解锁）→ 期望：换档 + 进入 play */
const rc = rowCenter(D, 1);
g.viewClick(rc.x, rc.y); g.frames(4);
console.log('点「困难」档   : state=' + G.state + ' tier=' + G.tier + ' tierPick=' + G.tierPick
  + ' → ' + ((G.state === 'play' && G.tier === 1) ? '真的换档开局 ✅' : '没换成功 ❌'));

/* 4. 未解锁档的点击应给提示 */
openWinOn(g, 9, 0);
g.viewClick(center(D.WIN_UI.challenge).x, center(D.WIN_UI.challenge).y); g.frames(2);
G.toast = null;
g.viewClick(rowCenter(D, 1).x, rowCenter(D, 1).y); g.frames(2);
console.log('点未解锁「困难」: state=' + G.state + ' tierPick=' + G.tierPick
  + ' toast=' + (G.toast && G.toast.msg) + ' → ' + (G.toast ? '有提示 ✅' : '无提示 ❌'));

/* 5. 关闭按钮回到结算页 */
g.viewClick(center(D.TIER_UI.close).x, center(D.TIER_UI.close).y); g.frames(2);
console.log('点「关闭」     : tierPick=' + G.tierPick + ' state=' + G.state
  + ' → ' + ((!G.tierPick && G.state === 'win') ? '回到结算页 ✅' : '❌'));

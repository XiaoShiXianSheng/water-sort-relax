/* qa_ui.js —— UI 测试：让「点不动 / 点错 / 文字糊 / 元素重叠」在无人值守时被抓住
 *
 * 它回答的问题是：玩家手指头戳下去，到底会发生什么？
 *   · 命中回转：点在瓶子身上，必须命中那个瓶子（这是「点不动」类 bug 的根因测试）
 *   · 端到端点击：不只是命中函数对，而是真的飞上台面 / 真的给出看得见的拒绝
 *   · 拒绝可见：冰冻、洞口被挡 —— 不能静默无反应（用户就是这么误判成"卡顿"的）
 *   · 多分辨率：从 iPhone SE 到平板，坐标映射都要可逆、都要能点中
 *   · 文字纯净：不能出现 NaN / undefined / Infinity
 *
 * 用法：node qa_ui.js
 */
const { loadGame, Reporter, guard } = require('./qa_lib.js');
const rep = new Reporter('ui');

function fresh(search) {
  const g = loadGame(search ? { search: search } : {});
  g.frames(3);
  return g;
}
function enter(g) { g.click(360, 640); g.frames(6); return g.DBG.G; }

guard(rep, 'UI', function () {

  /* ============ 1. 多分辨率：加载 → 渲染 → 进游戏 → 坐标映射可逆 ============ */
  const views = [[360, 640], [375, 667], [414, 896], [720, 1280], [1280, 720], [1440, 2560], [820, 1180]];
  const badView = [];
  for (const [w, h] of views) {
    try {
      const g = loadGame({ width: w, height: h, dpr: 2 });
      g.frames(4);
      const G = enter(g);
      g.frames(6);
      /* 坐标映射可逆：虚拟坐标 → 物理坐标 → 虚拟坐标 必须回到原点 */
      const v = g.DBG.view();
      const rt = g.DBG.toVirtual(320 * v.scale + v.offX, 640 * v.scale + v.offY);
      const drift = Math.abs(rt.x - 320) + Math.abs(rt.y - 640);
      if (g.DBG.fatal || G.state !== 'play' || drift > 0.5)
        badView.push(w + 'x' + h + (g.DBG.fatal ? '(崩)' : '') + (G.state !== 'play' ? '(没进关)' : '') + (drift > 0.5 ? '(漂移' + drift.toFixed(2) + 'px)' : ''));
    } catch (e) { badView.push(w + 'x' + h + '(异常' + e.message + ')'); }
  }
  rep.ok('7 种分辨率（含平板横屏 + 2x DPR）加载渲染进关全部正常、坐标映射可逆', badView.length === 0, badView.join(' '));

  /* ============ 2. 真实分辨率下真的能点中瓶子 ============ */
  const badTap = [];
  for (const [w, h] of [[360, 640], [375, 667], [1440, 2560]]) {
    const g = loadGame({ width: w, height: h, dpr: 2 });
    g.frames(3); enter(g); g.frames(6);
    const G = g.DBG.G;
    const b = G.bottles.find(x => x.place === 'grid' && x.gate < 0);
    const before = G.bottles.filter(x => x.place === 'counter').length;
    g.viewClick(b.x, b.y);                 // 用物理坐标点（走真实的 toVirtual 反向映射）
    g.waitIdle(); g.frames(30);
    const after = G.bottles.filter(x => x.place === 'counter').length;
    if (after !== before + 1) badTap.push(w + 'x' + h + ' 未上台面(' + before + '→' + after + ')');
  }
  rep.ok('在 360 / 375 / 1440 宽三种屏上，点货架瓶子都能真的飞上台面', badTap.length === 0, badTap.join(' '));

  /* ============ 3. 命中回转：瓶子身上任意一点都必须命中它自己 ============
     ⚠ 这里踩过一次「假绿」：最初只点瓶子正中心，正中心是最宽容的位置 ——
     把命中框从 ±52px 砍到 ±20px 竟然还是全绿。玩家不会只点正中心，
     手指会落在瓶身的上沿、左侧、右侧。所以改成在瓶身视觉范围内取 5 个探针点。 */
  const g1 = fresh(); enter(g1);
  const D = g1.DBG;
  const missSelf = [], stackWrong = [], missJar = [], badTool = [];
  const LEVELS = [1, 3, 5, 9, 10, 15, 20, 25, 30];
  let probeCount = 0;
  for (const lv of LEVELS) {
    D.gen(lv); g1.frames(4);
    const G = D.G;
    /* 瓶身视觉范围（见 drawBottle）：x ± bw/2，y 从 y-bh+18 到 y+18 */
    const bw = G.bw, bh = G.bh;
    const probes = [
      [0, 0],                          // 正中心
      [-bw * 0.35, -bh * 0.20],        // 左半身
      [bw * 0.35, -bh * 0.20],         // 右半身
      [0, -bh * 0.58],                 // 上沿附近
      [0, 8]                           // 下沿附近（瓶底）
    ];
    for (const b of G.bottles) {
      if (b.place !== 'grid') continue;
      const hitable = !(b.gate >= 0) || D.gateFront(b);
      for (const [ox, oy] of probes) {
        probeCount++;
        const hit = D.bottleAtGrid(b.x + ox, b.y + oy);
        if (hitable) {
          if (hit !== b) missSelf.push('L' + lv + ' cell' + b.cell + ' 探针(' + ox.toFixed(0) + ',' + oy.toFixed(0) + ')');
        } else {
          /* 藏在洞里的后排瓶子：点它的位置应该落到同一个洞的某个瓶子（或什么都不返回），
             但绝不能落到底下那层的别的瓶子上去 —— 那才是"点错"。 */
          if (hit && hit.cell !== b.cell) stackWrong.push('L' + lv + ' cell' + b.cell + '→' + hit.cell);
        }
      }
    }
  }
  rep.ok('命中回转：点在瓶子身上任意位置（' + probeCount + ' 次探针 / ' + LEVELS.length + ' 关全量）都命中它自己',
    missSelf.length === 0, missSelf.slice(0, 6).join(' '));
  rep.ok('门洞里叠着的后排瓶子不会点错到别的格子', stackWrong.length === 0, stackWrong.slice(0, 6).join(' '));

  /* ============ 4. 台面瓶子 / 工具栏 / 解锁徽章 的命中 ============ */
  {
    const g = fresh(); enter(g);
    const G = g.DBG.G;
    const sd = G.bottles.find(b => b.place === 'grid' && b.gate < 0);
    g.viewClick(sd.x, sd.y); g.waitIdle(); g.frames(40);
    for (const b of G.bottles) {
      if (b.place !== 'counter') continue;
      const hit = g.DBG.jarAtCounter(b.x, b.y - 40);
      if (hit !== b) missJar.push('slot' + b.slot);
    }
    const C = g.DBG.consts();
    for (let i = 0; i < 5; i++) {
      const cx = C.TOOL_X0 + i * (C.TOOL_W + C.TOOL_GAP) + C.TOOL_W / 2;
      const cy = C.TOOL_Y + C.TOOL_H / 2;
      if (g.DBG.toolAt({ x: cx, y: cy }) !== i) badTool.push('按钮' + i);
    }
  }
  rep.ok('台面瓶子：点瓶身上部能命中自己', missJar.length === 0, missJar.join(' '));
  rep.ok('底部 5 个按钮（清除/万能指/互换/撤销/分享）热区都对准自己', badTool.length === 0, badTool.join(' '));

  /* ============ 5. 端到端：点击真的产生可见结果 / 拒绝也看得见 ============ */
  {
    /* 5.1 正常点击 → 飞上台面 */
    const g = fresh(); enter(g);
    const G = g.DBG.G;
    const b = G.bottles.find(x => x.place === 'grid' && x.gate < 0);
    g.viewClick(b.x, b.y);
    g.waitIdle(); g.frames(40);
    rep.ok('端到端：点货架瓶子 → 它真的变成台面瓶子', b.place === 'counter', '实际 ' + b.place);

    /* 5.2 冰冻瓶 → 必须有抖动或提示（不能静默无反应） */
    const g2 = fresh(); enter(g2);
    g2.DBG.gen(4); g2.frames(6);
    const G2 = g2.DBG.G;
    const frozen = G2.bottles.find(x => x.locked > 0 && x.gate < 0);
    if (frozen) {
      frozen.shake = 0; G2.toast = null; G2.warn = null;
      g2.viewClick(frozen.x, frozen.y); g2.frames(2);
      rep.ok('点冰冻瓶：有抖动/提示反馈（不是静默"点不动"）',
        frozen.shake > 0 || !!G2.toast || !!G2.warn,
        'shake=' + frozen.shake + ' toast=' + (G2.toast && G2.toast.msg));
    } else {
      rep.warnIf('第 4 关应当有冰冻瓶可测', true, '未生成冰冻瓶');
    }

    /* 5.3 洞口被挡的瓶子 → 必须有抖动或提示 */
    const g3 = fresh(); enter(g3);
    let blocked = null;
    for (let lv = 4; lv <= 12 && !blocked; lv++) {
      g3.DBG.gen(lv); g3.frames(4);
      blocked = g3.DBG.G.bottles.find(x => x.gate >= 0 && g3.DBG.gateBlocked(x) && g3.DBG.gateFront(x));
    }
    if (blocked) {
      blocked.shake = 0; g3.DBG.G.toast = null; g3.DBG.G.warn = null;
      g3.viewClick(blocked.x, blocked.y); g3.frames(2);
      rep.ok('点洞口被挡的瓶子：有抖动/提示反馈',
        blocked.shake > 0 || !!g3.DBG.G.toast || !!g3.DBG.G.warn,
        'shake=' + blocked.shake);
    } else {
      rep.warnIf('能找到"洞口被挡"的局面来测反馈', true, '本次未随机到该局面（非产品问题）');
    }
  }

  /* ============ 6. 视觉层不重叠、不越界 ============ */
  {
    const g = fresh(); enter(g);
    const D = g.DBG, C = D.consts();
    const bleed = [], overlap = [], toolClash = [];
    for (let lv = 1; lv <= 40; lv++) {
      D.gen(lv); g.frames(3);
      const G = D.G;
      /* 6.1 货架瓶子视觉框左右不出屏 */
      for (const b of G.bottles) {
        if (b.place !== 'grid' || b.gate >= 0) continue;
        if (b.x - G.bw / 2 < 0 || b.x + G.bw / 2 > C.VW) bleed.push('L' + lv);
        /* 6.2 瓶子视觉框不得压到底部工具栏 */
        if (b.y + 18 > C.TOOL_Y) toolClash.push('L' + lv + ' y=' + (b.y + 18).toFixed(0));
      }
      /* 6.3 同一行相邻瓶子视觉上不许真的叠在一起（瓶宽 < 格距） */
      for (let r = 0; r < G.gridRows; r++) {
        if (G.tile + C.GX < G.bw + 2) overlap.push('L' + lv + ' 行' + r + ' 瓶宽' + G.bw.toFixed(0) + '>格距' + (G.tile + C.GX));
      }
      /* 6.4 台面相邻槽位不许叠（间距 ≥ 瓶宽 + 间隙） */
      for (let s = 1; s < G.slotX.length; s++) {
        if (G.slotX[s] - G.slotX[s - 1] < 76 + 6) overlap.push('L' + lv + ' 槽' + s + ' 间距' + (G.slotX[s] - G.slotX[s - 1]).toFixed(0));
      }
    }
    rep.ok('货架瓶子的视觉框左右不出屏（1~40 关）', bleed.length === 0, Array.from(new Set(bleed)).slice(0, 5).join(' '));
    rep.ok('货架瓶子不压底部工具栏', toolClash.length === 0, toolClash.slice(0, 5).join(' '));
    rep.ok('瓶子之间不重叠：瓶宽 < 格距、台面槽间距 ≥ 82', overlap.length === 0, overlap.slice(0, 5).join(' '));
  }

  /* ============ 7. 文字纯净 + 关键文案在位 ============ */
  {
    const g = fresh();
    const titleTexts = g.renderOnce();
    rep.ok('标题页有游戏名与操作说明', titleTexts.some(t => t.indexOf('解压水消除') >= 0)
      && titleTexts.some(t => t.indexOf('点瓶子') >= 0), JSON.stringify(titleTexts).slice(0, 90));
    rep.ok('标题页有「点击屏幕开始」引导', titleTexts.some(t => t.indexOf('点击屏幕开始') >= 0));

    let dirty = [];
    for (const [w, h] of [[360, 640], [720, 1280], [1440, 2560]]) {
      const gg = loadGame({ width: w, height: h, dpr: 2 });
      gg.frames(3); enter(gg);
      for (const lv of [1, 5, 15, 30]) {
        gg.DBG.gen(lv); gg.frames(3);
        const t = gg.renderOnce();
        const badT = t.filter(s => s.indexOf('NaN') >= 0 || s.indexOf('undefined') >= 0 || s.indexOf('Infinity') >= 0);
        if (badT.length) dirty.push(w + 'x' + h + ' L' + lv + ':' + badT[0]);
        if (lv === 15 && !t.some(s => s.indexOf('关卡') >= 0)) dirty.push(w + 'x' + h + ' 缺"关卡"HUD');
      }
    }
    rep.ok('3 种分辨率 × 4 个关卡：绘制文字无 NaN / undefined / Infinity，HUD 在位',
      dirty.length === 0, dirty.slice(0, 4).join(' | '));
  }

  /* ============ 8. 触屏入口与鼠标入口等效 ============ */
  {
    const gm = fresh(); const Gm = enter(gm); gm.frames(6);
    const bm = Gm.bottles.find(x => x.place === 'grid' && x.gate < 0);
    gm.viewClick(bm.x, bm.y); gm.waitIdle(); gm.frames(30);
    const mouseOk = bm.place === 'counter';

    const gt = fresh(); const Gt = enter(gt); gt.frames(6);
    const bt = Gt.bottles.find(x => x.place === 'grid' && x.gate < 0);
    const v = gt.DBG.view();
    gt.touch(bt.x * v.scale + v.offX, bt.y * v.scale + v.offY);
    gt.waitIdle(); gt.frames(30);
    rep.ok('触屏（touchstart）与鼠标（mousedown）走同一条输入路径，结果一致',
      mouseOk && bt.place === 'counter', 'mouse=' + mouseOk + ' touch=' + (bt.place === 'counter'));
  }

  /* ============ 9. 空点不误伤 ============ */
  {
    const g = fresh(); enter(g); g.frames(6);
    const G = g.DBG.G;
    const before = G.bottles.filter(b => b.place === 'counter').length;
    g.viewClick(360, 340);            // 水管之间的空白
    g.viewClick(4, 1000);             // 货架外侧空白
    g.frames(10);
    rep.ok('点空白处不会误触发任何瓶子动作',
      G.bottles.filter(b => b.place === 'counter').length === before && !G.anim);
  }
});

rep.done();

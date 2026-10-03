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
const { loadGame, Reporter, guard, withSeed } = require('./qa_lib.js');
const rep = new Reporter('ui');

function fresh(search) {
  const g = loadGame(search ? { search: search } : {});
  g.frames(3);
  return g;
}
function enter(g) { g.click(360, 640); g.frames(6); return g.DBG.G; }

/* 工具按钮中心（几何从产品 consts() 读，不写死坐标 —— 按钮数/间距变了不会假失败） */
function toolCenter(D, i) {
  const C = D.consts();
  return { x: C.TOOL_X0 + i * (C.TOOL_W + C.TOOL_GAP) + C.TOOL_W / 2, y: C.TOOL_Y + C.TOOL_H / 2 };
}
/* 水管中段：tubeAt 的命中范围是 [BOTT_Y-t.h-10, BOTT_Y+16]，取管身中点最稳 */
function tubeMid(D, t) { return { x: t.x + D.G.tubeW / 2, y: D.consts().BOTT_Y - t.h / 2 }; }

/* 状态签名：撤销测试要证明「撤销之后状态和动作前逐字段一致」。
   刻意不含 moves / undoLeft / history —— 那些本来就该变（撤销本身要扣次数）。 */
function sig(D) {
  const G = D.G;
  return JSON.stringify({
    tubes: G.tubes.map(t => t.units.join(',')),
    bottles: G.bottles.map(b => [b.col, b.fill, b.locked, b.place, b.slot, b.cell, b.gate, b.q].join('|')),
    slots: G.slots.map(s => (s.open ? 1 : 0)).join(''),
    clears: G.clears,
    unlockLeft: G.unlockLeft
  });
}
function firstDiff(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return '第' + i + '字符起：撤销前「' + a.slice(i, i + 40) + '」 vs 撤销后「' + b.slice(i, i + 40) + '」';
  }
  return '无差异';
}
/* 运行期总水量口径（19 节主循环守恒用）：管中水 + 瓶中的水。
   「已收走的瓶子」按满杯（cap）计账 —— 因为 completeJar 会把 b.fill 清零并把瓶子
   从台面摘走，那 3 杯水此刻「在飞行特效里」，按满杯记才守恒。 */
function totalWater(D) {
  const G = D.G;
  let tube = 0, jar = 0;
  for (const t of G.tubes) tube += t.units.length;
  for (const b of G.bottles) jar += (b.place === 'gone' ? b.cap : b.fill);
  return { tube: tube, jar: jar, sum: tube + jar };
}

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
     手指会落在瓶身的上沿、左侧、右侧。所以改成在瓶身视觉范围内取 5 个探针点。
     ⚠ 第二次踩坑：只在 9 个关卡取样（1/3/5/9/10/15/20/25/30），
     而 11~14、16~19、21~24、26~29、31~40 这些关卡从来没被戳过 ——
     格子尺寸、瓶子宽度、行长度都随关卡变，命中框却写死 ±52，
     一旦某一档的几何越界，抽查不到的关卡会漏掉。所以扩到 1~40 全量。
     ⚠ 第三次踩坑（2026-10-01 23:00）：1~40 仍然不够 —— 面板显示 90 关，
     而 41~90 是**完全不同的几何**（V6.0 把水管上限从写死的 7 根抬到 17 根、
     台面槽最多 17 个、格子铺满 9×6=54 格、颜色最多 18 种）。
     命中框 hw=min(52,(tile+GX)/2) 跟着格子缩，格子越小命中框越窄 ——
     晚局最容易「点不中」，却恰好一关都没进过这套探针。所以扩到 1~90 全量。 */
  const g1 = fresh(); enter(g1);
  const D = g1.DBG;
  const missSelf = [], stackWrong = [], missJar = [], badTool = [];
  const LEVELS = []; for (let lv = 1; lv <= 90; lv++) LEVELS.push(lv);
  let probeCount = 0, gateLevels = 0, thickGates = 0;
  for (const lv of LEVELS) {
    D.gen(lv); g1.frames(4);
    const G = D.G;
    if (G.gates.length) gateLevels++;
    for (let gi = 0; gi < G.gates.length; gi++) if (D.gateRest(gi) >= 2) thickGates++;
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
  rep.ok('命中回转：点在瓶子身上任意位置（' + probeCount + ' 次探针 / 1~90 关全量取样，'
    + gateLevels + ' 关含门洞 / ' + thickGates + ' 个洞内多瓶）都命中它自己',
    missSelf.length === 0, missSelf.slice(0, 6).join(' '));
  rep.ok('门洞里叠着的后排瓶子不会点错到别的格子', stackWrong.length === 0, stackWrong.slice(0, 6).join(' '));

  /* ============ 4. 台面瓶子 / 工具栏 / 解锁徽章 的命中 ============ */
  let toolIds = [];
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
    toolIds = C.TOOL_IDS.slice();
    /* 工具按钮数量从产品里读（V4.0 §15 删掉假分享后是 4 个：清除/万能指/互换/撤销），
       写死 5 会让这个用例在按钮数量变化时给出假失败。 */
    for (let i = 0; i < C.TOOL_IDS.length; i++) {
      const cx = C.TOOL_X0 + i * (C.TOOL_W + C.TOOL_GAP) + C.TOOL_W / 2;
      const cy = C.TOOL_Y + C.TOOL_H / 2;
      if (g.DBG.toolAt({ x: cx, y: cy }) !== i) badTool.push('按钮' + i);
    }
  }
  rep.ok('台面瓶子：点瓶身上部能命中自己', missJar.length === 0, missJar.join(' '));
  rep.ok('底部工具按钮（' + toolIds.join('/') + '）热区都对准自己',
    badTool.length === 0, badTool.join(' '));

  /* ============ 5. 端到端：点击真的产生可见结果 / 拒绝也看得见 ============ */
  {
    /* 5.1 正常点击 → 飞上台面 */
    const g = fresh(); enter(g);
    const G = g.DBG.G;
    const b = G.bottles.find(x => x.place === 'grid' && x.gate < 0);
    g.viewClick(b.x, b.y);
    g.waitIdle(); g.frames(40);
    rep.ok('端到端：点货架瓶子 → 它真的变成台面瓶子', b.place === 'counter', '实际 ' + b.place);

    /* 5.2 冰冻瓶的点击反馈见第 11 节：那边用固定种子 + 阈值验证，避免和这里重复（重复断言 = 重复报错） */

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

  /* ============ 6. 视觉层不重叠、不越界 ============
     ⚠ 2026-10-01 23:00：取样从 1~40 扩到 1~90。晚局（41~90）是几何最紧的一段 ——
     17 根管挤在 720 宽的虚拟画布里、台面最多 17 个槽、格子铺满 9×6。
     6.4 的「槽间距 ≥ 38px 触控下限」正是为晚局写的（间距从 124px 一路收到 41px），
     但那段代码从来没在 41~90 关上跑过 —— 断言写对了，样本却不在风险区。 */
  {
    const g = fresh(); enter(g);
    const D = g.DBG, C = D.consts();
    const bleed = [], overlap = [], toolClash = [];
    for (let lv = 1; lv <= 90; lv++) {
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
      /* 6.4 台面相邻槽位不许叠：间距必须 > 瓶宽（V6.0 晚局 17 个槽，间距从 124 收到 41px，
             所以口径是「相对瓶宽 + 6px 间隙」，不再写死 76+6）。
             同时守住触控下限：间距 ≥ 38px，否则手指点不准。 */
      for (let s = 1; s < G.slotX.length; s++) {
        const step2 = G.slotX[s] - G.slotX[s - 1];
        if (step2 < G.jw + 6) overlap.push('L' + lv + ' 槽' + s + ' 间距' + step2.toFixed(0) + '<瓶宽' + G.jw.toFixed(0) + '+6');
        if (step2 < 38) overlap.push('L' + lv + ' 槽' + s + ' 间距' + step2.toFixed(0) + '<38（触控下限）');
      }
    }
    rep.ok('货架瓶子的视觉框左右不出屏（1~90 关）', bleed.length === 0, Array.from(new Set(bleed)).slice(0, 5).join(' '));
    rep.ok('货架瓶子不压底部工具栏', toolClash.length === 0, toolClash.slice(0, 5).join(' '));
    rep.ok('瓶子之间不重叠：瓶宽 < 格距、台面槽间距 ≥ 瓶宽+6px 且 ≥38px（触控下限，1~90 关）', overlap.length === 0, overlap.slice(0, 5).join(' '));
  }

  /* ============ 7. 文字纯净 + 关键文案在位 ============ */
  {
    const g = fresh();
    const titleTexts = g.renderOnce();
    rep.ok('标题页有游戏名与操作说明', titleTexts.some(t => t.indexOf('解压水消除') >= 0)
      && titleTexts.some(t => t.indexOf('点瓶子') >= 0), JSON.stringify(titleTexts).slice(0, 90));
    /* V4.0 §17：首页要有明确的两个点击理由（开始游戏 / 每日挑战）+ 进度可见 */
    rep.ok('标题页有明确的开始引导（「开 始 游 戏」按钮）',
      titleTexts.some(t => t.indexOf('开 始 游 戏') >= 0), JSON.stringify(titleTexts).slice(0, 90));
    rep.ok('标题页有每日挑战入口', titleTexts.some(t => t.indexOf('每日挑战') >= 0));
    rep.ok('标题页显示进度与收集星数（给"回来玩"的理由）',
      titleTexts.some(t => t.indexOf('进度：第') >= 0 && t.indexOf('颗星') >= 0));

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

  /* ============ 10. 门洞：洞里只能按顺序取（1~40 关全量 + 点击级） ============
     规则见 genLevel 的门洞段：一个洞里叠着 n 个瓶子，各带唯一序号 q（0 最靠洞口），
     只有 q 最小的那个可点；洞口被邻格占住时谁都取不出。
     这三条以前没有任何断言 —— 把 gateFront() 改成恒返回 true，点洞口就会
     随机拿走一个瓶子（可能跳过前排），玩家看到的是「顺序乱了」。 */
  {
    const g = fresh(); const D = g.DBG; enter(g); g.frames(4);
    const badQ = [], badFront = [], peekDeep = [];
    let gates = 0, multi = 0, deepProbes = 0;
    for (let lv = 1; lv <= 40; lv++) {
      D.gen(lv); g.frames(4);
      const G = D.G;
      for (let gi = 0; gi < G.gates.length; gi++) {
        gates++;
        const inGate = G.bottles.filter(b => b.gate === gi);
        const n = inGate.length;
        if (n >= 2) multi++;
        /* 10.1 q 必须恰好是 0..n-1（取用顺序的唯一编号，缺号/重号 = 顺序不可判定） */
        const qs = inGate.map(b => b.q).sort((a, b) => a - b);
        const want = [];
        for (let k = 0; k < n; k++) want.push(k);
        const seen = {}; let dup = false;
        qs.forEach(q => { if (seen[q]) dup = true; seen[q] = 1; });
        if (dup || qs.join(',') !== want.join(',')) badQ.push('L' + lv + ' 洞' + gi + ' q=' + qs.join(','));
        /* 10.2 此刻「可取」的必须恰好一个，且就是 q=0 那个 */
        const fronts = inGate.filter(b => b.place === 'grid' && D.gateFront(b));
        if (fronts.length !== 1 || (fronts[0] && fronts[0].q !== 0))
          badFront.push('L' + lv + ' 洞' + gi + ' 可取' + fronts.length + ' 个 q=' + (fronts[0] ? fronts[0].q : '-'));
        /* 10.3 后排瓶子点不到：拿它自己的坐标去点，命中的绝不能是它自己 */
        const f0 = fronts[0];
        for (const b of inGate) {
          if (b === f0 || b.place !== 'grid') continue;
          deepProbes++;
          if (D.bottleAtGrid(b.x, b.y) === b) peekDeep.push('L' + lv + ' 洞' + gi + ' q' + b.q);
        }
      }
    }
    rep.ok('门洞里每个瓶子的叠放序号 q 恰好是 0..n-1（无缺号/重号，' + gates + ' 个洞 / ' + multi + ' 个多瓶洞）',
      badQ.length === 0, badQ.slice(0, 5).join(' '));
    rep.ok('每个门洞此刻恰好只有一个瓶子可取，且就是最外面那个（q=0）',
      badFront.length === 0, badFront.slice(0, 5).join(' '));
    rep.ok('门洞后排的瓶子点不到（' + deepProbes + ' 次探针）—— 挡在前面的必须先取走',
      peekDeep.length === 0, peekDeep.slice(0, 5).join(' '));

    /* 10.4 点击级：连着点洞口，取走的顺序必须严格是 0,1,2…（不能跳号）
       ⚠ 关卡开局时洞口**一定**被邻格占着（pickGateDirs 优先把洞口朝向有瓶子的格子，
       这是玩法本身），所以先按真实玩法把洞口那格的瓶子拿走，再验顺序。 */
    const g2 = fresh(); const D2 = g2.DBG; enter(g2); g2.frames(4);
    let gi = -1, seedUsed = 0, lvUsed = 0;
    /* 两轮搜索：先找洞内 3 瓶（能验 0,1,2 三步），找不到再退而求其次用 2 瓶的洞 */
    for (const needN of [3, 2]) {
      for (let s = 1; s <= 80 && gi < 0; s++) {
        for (const lv of [12, 18, 24, 30]) {
          withSeed(s * 100 + lv, () => D2.gen(lv));
          g2.frames(4);
          for (let k = 0; k < D2.G.gates.length; k++) {
            const inG = D2.G.bottles.filter(b => b.gate === k && b.place === 'grid');
            if (inG.length < needN) continue;
            if (D2.gateMouthCell(k) < 0) continue;    // 朝界外 = 恒定通畅，测不出「挡」
            gi = k; seedUsed = s; lvUsed = lv; break;
          }
          if (gi >= 0) break;
        }
      }
      if (gi >= 0) break;
    }
    if (gi < 0) {
      rep.warnIf('能找到「洞内多瓶 + 洞口朝向场内有瓶的格子」的局面做顺序点击', true, '60 个种子没抽到（非产品问题）');
    } else {
      /* 打通洞口：能用真实点击拿走就用点击（顺带验证流程），拿不动就直接判它已离场 */
      const mouth = D2.gateMouthCell(gi);
      const victims = D2.G.bottles.filter(b => b.place === 'grid' && b.cell === mouth);
      for (const v of victims) {
        if (!D2.G.anim && D2.gridPlayable(v) && D2.freeSlot() >= 0) {
          g2.viewClick(v.x, v.y); g2.waitIdle(); g2.frames(30);
        }
        if (v.place === 'grid') v.place = 'gone';
      }
      g2.frames(2);
      D2.G.stuck = false;                              // 人为改过布局，别让死局面板吃掉点击

      const seq = [], takenBad = [];
      for (let guard = 0; guard < 4; guard++) {
        const inG = D2.G.bottles.filter(b => b.gate === gi && b.place === 'grid');
        if (inG.length < 1) break;
        const front = inG.reduce((a, b) => (a.q <= b.q ? a : b));
        if (D2.gateBlocked(front) || D2.freeSlot() < 0) break;
        const deep = inG.filter(b => b !== front);
        g2.viewClick(front.x, front.y); g2.waitIdle(); g2.frames(30);
        D2.G.stuck = false;
        if (front.place === 'grid') break;                    // 没能取走，停
        seq.push(front.q);
        /* 取走一个之后：刚才的后排瓶子必须还在格子上（不能连带走） */
        deep.forEach(b => { if (b.place !== 'grid') takenBad.push('q' + b.q + '被一起带走'); });
      }
      const want = seq.map((_, k) => k).join(',');
      rep.ok('点击级：连点洞口取走的顺序严格是 0,1,2…（实测 ' + seq.join(',') + '，种子 ' + seedUsed + ' / L' + lvUsed + '）',
        seq.length >= 2 && seq.join(',') === want && takenBad.length === 0,
        seq.length < 2 ? '只取到 ' + seq.length + ' 个，样本不足' : (takenBad.join(' ') || '顺序=' + seq.join(',')));
    }
  }

  /* ============ 11. 冰冻瓶：点击必须看得见反馈；解冻阈值必须是「四邻空出 2 格」 ============
     阈值被改成 n>=1 时，冰冻瓶会「一点就化」，冰冻这个玩法直接消失，
     而旧的 UI 套件里没有任何一条能发现它。
     ⚠ 采样时机很关键：解冻判定跑在**主循环每一帧**里，所以阈值类断言必须在
     genLevel() 之后、g.frames() 之前做 —— 走完帧再看，不合格的冰冻瓶早就化没了。 */
  {
    const g = fresh(); const D = g.DBG; enter(g); g.frames(4);
    let frozen = null, seedUsed = 0;
    for (let s = 1; s <= 40 && !frozen; s++) {
      withSeed(s * 7 + 1, () => D.gen(7));
      frozen = D.G.bottles.find(b => b.locked > 0 && b.place === 'grid');
      seedUsed = s;
    }
    if (!frozen) {
      rep.warnIf('第 7 关能生成冰冻瓶用于测试', true, '40 个种子都没生成（非产品问题）');
    } else {
      /* 11.1 阈值：四邻只空 1 格 → 不解冻；补到 2 格 → 必须解冻（此刻还没走过帧） */
      const G = D.G;
      const nbOf = () => [0, 1, 2, 3].map(d => D.neighborCell(frozen.cell, d));
      const emptyOf = () => nbOf().filter(c => c < 0 || !D.cellOccupied(c)).length;
      const occOf = () => nbOf().filter(c => c >= 0 && D.cellOccupied(c));
      const free = c => { D.G.bottles.forEach(b => { if (b.place === 'grid' && b.cell === c) b.place = 'gone'; }); };
      const e0 = emptyOf();
      rep.ok('开局（第一帧之前）冰冻瓶一定"冻得住"（四邻空位 ≤1；否则冻了等于没冻）', e0 <= 1,
        '种子 ' + seedUsed + ' 实际空 ' + e0 + ' 格');
      if (e0 === 0 && occOf().length) free(occOf()[0]);        // 先空出 1 格
      G.toast = null;
      D.thawByNeighbors();
      rep.ok('解冻阈值：四邻只空出 1 格时不解冻（阈值是 2，不是 1）',
        frozen.locked > 0, 'locked=' + frozen.locked + ' 空' + emptyOf() + '格');
      if (occOf().length) free(occOf()[0]);                   // 再空出 1 格 → 共 2 格
      G.toast = null;
      D.thawByNeighbors();
      rep.ok('四邻空出 2 格 → 自动解冻（不用点，且给了解冻提示）',
        frozen.locked === 0 && !!G.toast, 'locked=' + frozen.locked + ' toast=' + (G.toast && G.toast.msg));
    }

    /* 11.2 点击级：另掷一个「冻得住」的瓶子，落定后点它 → 必须有抖动/提示，且拿不下来 */
    let fz2 = null;
    for (let s = 1; s <= 40 && !fz2; s++) {
      withSeed(s * 13 + 5, () => D.gen(7));
      g.frames(6); g.waitIdle(); g.frames(4);
      fz2 = D.G.bottles.find(b => b.locked > 0 && b.place === 'grid');
    }
    if (!fz2) {
      rep.warnIf('能落定一个仍然冻着的瓶子做点击测试', true, '40 个种子都没留下冰冻瓶（非产品问题）');
    } else {
      const G2 = D.G;
      fz2.shake = 0; G2.toast = null; G2.warn = null;
      g.viewClick(fz2.x, fz2.y); g.frames(2);
      rep.ok('点冰冻瓶：有抖动/提示反馈（不是静默"点不动"）',
        fz2.shake > 0 || !!G2.toast || !!G2.warn,
        'shake=' + fz2.shake + ' toast=' + (G2.toast && G2.toast.msg));
      rep.ok('冰冻瓶点一下不会解冻、也不会被拿走（点击不解冻）',
        fz2.place === 'grid' && fz2.locked > 0, 'place=' + fz2.place + ' locked=' + fz2.locked);
    }
  }

  /* ============ 12. 撤销：回退后状态必须逐字段回到动作前 ============
     历史的坑：解锁次数没跟着快照回滚 →「解锁 → 撤销」后槽位又锁回去、免费次数却被扣掉。
     这条用「状态签名」把管中水 / 每个瓶子 / 槽位 / 完成数 / 解锁次数全部比一遍。
     ⚠ 第二次踩坑（回滚验证抓出来的）：一开始只挑「管底不是这个颜色」的瓶子，
     撤销时水管本来就没变 → 把 doUndo 里「回滚水管」那一行整段删掉，断言照样全绿。
     所以这里交替取样：偶数步挑「不会被喝」的瓶子（验瓶子/槽位回滚），
     奇数步挑「会被喝一口」的瓶子（验水管里的水也回滚）。
     每一步都重新生成同一关卡（固定种子），互不污染。 */
  {
    const g = fresh(); const D = g.DBG; enter(g); g.frames(4);
    const bad = [];
    let checked = 0, tried = 0, drinkChecked = 0, plainChecked = 0;
    for (const lv of [3, 5, 9, 15, 20, 25, 30, 35]) {
      for (let step = 0; step < 4 && checked < 10; step++) {
        withSeed(4000 + lv * 10 + step, () => D.gen(lv));
        g.frames(8); g.waitIdle(); g.frames(4);
        const G = D.G;
        G.undoLeft = 5;                       // 测的是「回退是否精确」，不是次数
        if (G.anim || D.freeSlot() < 0) continue;
        const bottoms = G.tubes.map(t => t.units[0]);
        const drinkCase = step % 2 === 1;     // 奇数步：挑一个放上去就会被喝一口的颜色
        const b = G.bottles.find(x => x.place === 'grid' && !x.locked && x.gate < 0
          && ((bottoms.indexOf(x.col) >= 0) === drinkCase));
        if (!b) continue;
        tried++;
        const clears0 = G.clears;
        const before = sig(D);
        g.viewClick(b.x, b.y);
        for (let k = 0; k < 6; k++) { g.waitIdle(600); g.frames(3); }   // 落定 + 可能的连锁喝水
        if (b.place !== 'counter') continue;  // 没真的放上去（例如台面满）
        /* 连锁喝满并消除时，撤销回到的是「喝满那一刻」，语义不同 —— 跳过这个样本 */
        if (G.clears !== clears0) continue;
        if (drinkCase) {
          if (b.fill <= 0) continue;          // 这一口没喝到，换个局面
          drinkChecked++;
        } else plainChecked++;
        D.doUndo(); g.frames(4);
        checked++;
        const after = sig(D);
        if (after !== before) bad.push('L' + lv + ' 步' + step + '（' + (drinkCase ? '喝水' : '不喝水') + '）：' + firstDiff(before, after));
      }
      if (checked >= 10) break;
    }
    rep.ok('撤销回退后状态逐字段一致（管中水 / 每个瓶子 / 槽位 / 完成数 / 解锁次数）'
      + '：' + checked + ' 次「动作→撤销」真的回到了撤销前（其中 ' + drinkChecked + ' 次已出水、'
      + plainChecked + ' 次未出水 / 共试 ' + tried + ' 次）',
      checked >= 6 && drinkChecked >= 2 && plainChecked >= 2 && bad.length === 0,
      (checked < 6 ? '有效样本只有 ' + checked + ' 次，断言不成立；' : '')
      + (drinkChecked < 2 ? '「会喝水」的样本只有 ' + drinkChecked + ' 次（水管回滚没被验到）；' : '')
      + (plainChecked < 2 ? '「不喝水」的样本只有 ' + plainChecked + ' 次；' : '')
      + bad.slice(0, 3).join(' | '));
  }

  /* ============ 13. 魔法清除：清掉的那杯水必须倒进同色瓶（一杯都不能漏） ============
     useClear 若漏掉 tgt.fill++，水就凭空蒸发了，玩家最后会看到「水没了瓶子还在」的死局。 */
  {
    const g = fresh(); const D = g.DBG; enter(g); g.frames(4);
    const idx = D.consts().TOOL_IDS.indexOf('clear');
    const G = D.G;
    const waterIn = () => D.waterLeft();
    const fillIn = () => G.bottles.reduce((a, b) => a + ((b.place === 'gone' || b.done) ? 0 : b.fill), 0);
    const col = G.tubes[0].units[0];
    const jar = G.bottles.filter(b => b.col === col)[0];
    g.waitIdle(); g.frames(4);
    G.slots.forEach(s => { s.open = true; });
    G.tools.clear = 3;
    /* 摆局面：把同色瓶放上台面（未满）。
       ⚠ 摆完到点击之间**不能走帧**：一走帧这一口就被自动喝掉，管底换色，清除会被拒。 */
    if (jar) { jar.place = 'counter'; jar.slot = 0; jar.fill = 0; }
    const W0 = waterIn(), F0 = fillIn();
    const tc = toolCenter(D, idx);
    g.viewClick(tc.x, tc.y);
    const entered = G.mode === 'clear';
    const tm = tubeMid(D, G.tubes[0]);
    g.viewClick(tm.x, tm.y);                       // useClear 是同步的，点完立刻读，不再走帧
    const W1 = waterIn(), F1 = fillIn();
    rep.ok('点「魔法清除」→ 进清除模式 → 点水管：清掉的那杯倒进台面同色瓶',
      entered && !!jar && jar.fill === 1 && G.mode === null,
      'mode=' + G.mode + ' fill=' + (jar ? jar.fill : '无同色瓶'));
    rep.ok('魔法清除水量守恒：管中水 −1 == 瓶里 +1（一滴都没漏掉）',
      W1 === W0 - 1 && W1 + F1 === W0 + F0,
      '管 ' + W0 + '→' + W1 + '，瓶 ' + F0 + '→' + F1 + '，总 ' + (W0 + F0) + '→' + (W1 + F1));

    /* 13.2 台面上没有同色瓶 → 必须拒绝：不扣一杯水、不扣道具、不凭空多水 */
    if (jar) { jar.place = 'grid'; jar.fill = 0; }
    const W2 = waterIn(), F2 = fillIn(), tool2 = G.tools.clear;
    g.viewClick(tc.x, tc.y);                       // 上一次成功后 mode 被清空，要重新进清除模式
    const entered2 = G.mode === 'clear';
    const tm2 = tubeMid(D, G.tubes[0]);
    g.viewClick(tm2.x, tm2.y);
    rep.ok('台面无同色瓶时拒绝清除：不白扣一杯水、不扣道具（否则必然攒成死局）',
      entered2 && G.tools.clear === tool2 && waterIn() === W2 && fillIn() === F2,
      '道具 ' + tool2 + '→' + G.tools.clear + '，水 ' + W2 + '→' + waterIn() + '，瓶 ' + F2 + '→' + fillIn());
  }
});

/* ============ 14. 结算页语义：普通关 →「下一关」；每日挑战 →「重玩今日题」；再挑战本关 → 选档可切 ============
   Bug A（用户报「普通关通关后按钮是再来一局、点了还在本关」）：
     脚本实证（check_daily.js）—— 普通模式 G.daily 恒为 false、按钮本就是「下一关 →」，
     点它真的进下一关；只有【每日挑战】才会显示「再来一局」且点击 = startDaily() 重开同题。
     用户实际在每日挑战里，但「再来一局」文案会被读成「下一关」，这就是困惑来源。
     修法：保留 G.daily 行为不变，把每日挑战的按钮文案改成语义明确的「重玩今日题」。
   Bug B（用户报「再挑战本关的选档面板点不动、切不了档」）：
     根因是 handleTap 里选档分支排在 G.state==='win' 之后 —— 打开面板那一刻 state 仍是 win，
     点击先在 win 分支被 return，永远走不到选档分支；且渲染侧选档面板被结算面板整块盖住。
     修法：选档分支提到最前（模态吃下所有点击、不穿透）+ 打开时不叠画结算面板。 */
guard(rep, '结算页-选档', function () {

  const btnOf = (t) => ({
    next: t.some(s => s.indexOf('下一关') >= 0),
    replay: t.some(s => s.indexOf('再来一局') >= 0),
    replayDaily: t.some(s => s.indexOf('重玩今日题') >= 0),
    panelWin: t.some(s => s.indexOf('收完') >= 0),      // 结算面板标题「🎉 全部收完！」
    panelTier: t.some(s => s.indexOf('挑战档位') >= 0)  // 选档面板标题「第 N 关 · 挑战档位」
  });
  /* 只清空瓶子 + 走产品自己的结算入口 levelDone()，不改状态机的其它部分 */
  function forceWin(g) {
    g.DBG.G.bottles.forEach(b => { b.place = 'gone'; });
    g.DBG.levelDone(); g.frames(3);
    g.DBG.G.winStreak = 0; g.DBG.G.interPending = false;   // 隔离插屏，避免干扰
  }
  /* 生成指定关并结算；tiers = 构造该关已解锁到哪一档（覆盖 levelDone 的自动解锁） */
  function winOn(g, lv, tiers) {
    g.DBG.gen(lv, { tier: 0 }); g.frames(4);
    g.DBG.Store.reset();
    forceWin(g);
    g.DBG.Store.data.tiers[lv] = (tiers === undefined ? 1 : tiers);
    return g.DBG.G;
  }

  /* ---- Bug A：普通模式 ---- */
  {
    const g = fresh(); enter(g);
    const G = winOn(g, 1, 0);
    const bt = btnOf(g.renderOnce());
    rep.ok('Bug A：普通模式通关后 G.daily===false（主按钮语义应为「下一关」）',
      G.daily === false && !!G.winStats && G.winStats.daily === false,
      'daily=' + G.daily + ' winStats.daily=' + (G.winStats && G.winStats.daily));
    rep.ok('Bug A：普通模式通关页主按钮显示「下一关 →」（不是「再来一局」）',
      bt.next && !bt.replay && !bt.replayDaily, JSON.stringify(bt));
    const lv0 = G.level, N = g.DBG.WIN_UI.next;
    g.viewClick(N.x + N.w / 2, N.y + N.h / 2); g.frames(6);
    rep.ok('Bug A：普通模式点主按钮真的进入下一关（level+1 且回到 play）',
      G.state === 'play' && G.level === lv0 + 1, 'state=' + G.state + ' level=' + G.level);
  }

  /* ---- Bug A：每日挑战 ---- */
  {
    const g = fresh();
    g.DBG.startDaily(); g.frames(5);
    const G = g.DBG.G, lv0 = G.level;
    forceWin(g);
    const bt = btnOf(g.renderOnce());
    rep.ok('Bug A：每日挑战通关页主按钮文案是「重玩今日题」（不再被读成「下一关」）',
      G.daily === true && bt.replayDaily && !bt.next && !bt.replay, JSON.stringify(bt));
    const N = g.DBG.WIN_UI.next;
    g.viewClick(N.x + N.w / 2, N.y + N.h / 2); g.frames(6);
    rep.ok('Bug A：每日挑战点主按钮仍是重开今日同一局（行为未被改动）',
      G.state === 'play' && G.daily === true && G.level === lv0,
      'state=' + G.state + ' daily=' + G.daily + ' level=' + G.level);
  }

  /* ---- Bug A：入口普查（防「普通关被 daily 污染」这类回归） ---- */
  {
    const g = fresh(); enter(g);
    const G = g.DBG.G, bad = [];
    if (G.daily !== false) bad.push('进入后 daily=' + G.daily);
    g.viewClick(645, 58); g.frames(2);                       // HUD「重开」→ genLevel(G.level)
    if (G.daily !== false) bad.push('HUD重开后 daily=' + G.daily);
    forceWin(g);                                             // 通关 →「下一关」→ genLevel(G.level+1)
    const N = g.DBG.WIN_UI.next;
    g.viewClick(N.x + N.w / 2, N.y + N.h / 2); g.frames(4);
    if (G.daily !== false || G.state !== 'play') bad.push('「下一关」后 daily=' + G.daily + ' state=' + G.state);
    const g2 = loadGame({ search: '?lvl=12' }); g2.frames(4); // ?lvl= 启动 → genLevel(URL_LVL)
    if (g2.DBG.G.daily !== false) bad.push('?lvl= 启动 daily=' + g2.DBG.G.daily);
    rep.ok('Bug A：非每日入口（进入/HUD重开/下一关/?lvl=）G.daily 恒为 false（无污染路径）',
      bad.length === 0, bad.join(' | '));
  }

  /* ---- Bug B：再挑战本关 → 选档面板真的能点、能切档 ---- */
  {
    const g = fresh(); enter(g);
    const G = winOn(g, 9, 1);                                // 极限档已解锁
    const D = g.DBG, CH = D.WIN_UI.challenge;
    g.viewClick(CH.x + CH.w / 2, CH.y + CH.h / 2); g.frames(3);
    const bt = btnOf(g.renderOnce());
    rep.ok('Bug B：点「再挑战本关」→ 选档面板打开（G.tierPick===true）',
      G.tierPick === true, 'tierPick=' + G.tierPick);
    rep.ok('Bug B：选档面板打开时不再叠画结算面板（渲染只见选档面板）',
      bt.panelTier && !bt.panelWin, JSON.stringify(bt));
    const r1 = D.TIER_UI.rows.filter(r => r.id === 1)[0];
    g.viewClick(360, r1.y + 46); g.frames(5);
    rep.ok('Bug B：点已解锁的「极限」档 → 真的换档（tier=1）并开局（回到 play）',
      G.state === 'play' && G.tier === 1 && G.tierPick === false,
      'state=' + G.state + ' tier=' + G.tier + ' tierPick=' + G.tierPick);
    rep.ok('Bug B：换档后关卡号不变（同一关的递进挑战）', G.level === 9, 'level=' + G.level);
  }

  /* ---- Bug B：未解锁档有提示、关闭能回结算页 ---- */
  {
    const g = fresh(); enter(g);
    const G = winOn(g, 9, 0);                                // 只解锁普通档
    const D = g.DBG, CH = D.WIN_UI.challenge;
    g.viewClick(CH.x + CH.w / 2, CH.y + CH.h / 2); g.frames(2);
    const opened = G.tierPick === true;
    G.toast = null;
    const r1 = D.TIER_UI.rows.filter(r => r.id === 1)[0];
    g.viewClick(360, r1.y + 46); g.frames(2);
    rep.ok('Bug B：点未解锁的档位 → 有提示且不开局（仍停在结算/选档页）',
      opened && G.tierPick === true && G.state === 'win' && !!G.toast && G.tier === 0,
      'opened=' + opened + ' tierPick=' + G.tierPick + ' state=' + G.state
      + ' toast=' + (G.toast && G.toast.msg) + ' tier=' + G.tier);
    const CL = D.TIER_UI.close;
    g.viewClick(CL.x + CL.w / 2, CL.y + CL.h / 2); g.frames(2);
    rep.ok('Bug B：点「关闭」→ 关掉选档面板、回到结算页',
      G.tierPick === false && G.state === 'win', 'tierPick=' + G.tierPick + ' state=' + G.state);
  }

  /* ---- FIX-02：结算弹窗的「两档方块」必须可点 + 每日挑战在 HUD 上可辨识 ----
     V6.3 两档重构：方块几何与 drawWinPanel 一致：中心 (240 + t*240, 746)，命中盒 x±58 / y∈[712,780]。 */
  {
    const box = (i) => ({ x: 240 + i * 240, y: 746 });

    /* 02a-1：点「极限」方块 → 真的换档并开局，关卡号不变 */
    const g = fresh(); enter(g);
    const G = winOn(g, 9, 1);                       // 已解锁极限
    g.viewClick(box(1).x, box(1).y); g.frames(5);
    rep.ok('FIX-02a：结算弹窗点「极限」方块 → 真的换档（tier 0→1）并开局（回到 play），关卡号不变',
      G.state === 'play' && G.tier === 1 && G.level === 9,
      'state=' + G.state + ' tier=' + G.tier + ' level=' + G.level);

    /* 02a-2：点「当前档」方块 → 语义硬要求：不许重开 */
    const g0 = fresh(); enter(g0);
    const G0 = winOn(g0, 9, 0);                     // 当前档 = 0（普通）
    G0.toast = null;
    g0.viewClick(box(0).x, box(0).y); g0.frames(3);
    rep.ok('FIX-02a：点「当前档」方块 → 不重开（仍停在结算页，level/tier 不变）且给 toast 引导',
      G0.state === 'win' && G0.tier === 0 && G0.level === 9 && !!G0.toast,
      'state=' + G0.state + ' tier=' + G0.tier + ' level=' + G0.level
      + ' toast=' + (G0.toast && G0.toast.msg));

    /* 02a-3：点「未解锁」方块 → 有提示、不开局 */
    const g1 = fresh(); enter(g1);
    const G1 = winOn(g1, 9, 0);                     // 只解锁普通档
    G1.toast = null;
    g1.viewClick(box(1).x, box(1).y); g1.frames(3);
    rep.ok('FIX-02a：点「未解锁」方块 → 有提示、不开局、仍停在结算页',
      G1.state === 'win' && G1.tier === 0 && !!G1.toast,
      'state=' + G1.state + ' tier=' + G1.tier + ' toast=' + (G1.toast && G1.toast.msg));

    /* 02b：每日挑战在玩的时候就能看出来（HUD 徽标）。用带 📅 的完整串，
       避免与首页按钮「每日挑战（每天同一局）」和 toast「每日挑战：日期」混淆。 */
    const gd = fresh();
    gd.DBG.startDaily(); gd.frames(5);
    gd.DBG.G.toast = null;                          // 排除 toast 文案干扰
    const td = gd.renderOnce();
    const gn = fresh(); enter(gn);
    gn.DBG.G.toast = null;
    const tn = gn.renderOnce();
    rep.ok('FIX-02b：每日挑战进行中 HUD 显示「📅 每日挑战」徽标',
      td.some(s => s.indexOf('📅 每日挑战') >= 0), JSON.stringify(td).slice(0, 90));
    rep.ok('FIX-02b：普通关 HUD 不出现每日挑战徽标（两种模式在局内就能区分）',
      !tn.some(s => s.indexOf('📅 每日挑战') >= 0), JSON.stringify(tn).slice(0, 90));

    /* 02b-3：7 种分辨率（含平板横屏 + 2x DPR）徽标都在、无 NaN/undefined、无崩溃 */
    const badRes = [];
    for (const [w, h] of [[360, 640], [375, 667], [414, 896], [720, 1280], [1280, 720], [1440, 2560], [820, 1180]]) {
      try {
        const gg = loadGame({ width: w, height: h, dpr: 2 });
        gg.frames(3);
        gg.DBG.startDaily(); gg.frames(4);
        gg.DBG.G.toast = null;
        const t = gg.renderOnce();
        const has = t.some(s => s.indexOf('📅 每日挑战') >= 0);
        const dirty = t.some(s => s.indexOf('NaN') >= 0 || s.indexOf('undefined') >= 0
          || s.indexOf('Infinity') >= 0);
        if (!has || dirty) badRes.push(w + 'x' + h + (has ? '' : '(缺徽标)') + (dirty ? '(脏文字)' : ''));
      } catch (e) { badRes.push(w + 'x' + h + '(异常' + e.message + ')'); }
    }
    rep.ok('FIX-02b：7 种分辨率下每日徽标都在、无 NaN/undefined、无渲染崩溃（徽标不出屏/不重叠）',
      badRes.length === 0, badRes.join(' '));
  }
});

/* ============ 15. 水管可点性必须经得起「屏幕边界」 ============
   这是本次漏测的根因（治本那条）：旧套件的 tubeMid() 直接用虚拟坐标 t.x+tubeW/2 合成点击，
   **等于绕开屏幕边界** —— 9 根管时两端 2 根的坐标是 −56 / 776，手指永远做不到，
   但测试照样「命中它自己」，于是 376 条全绿却漏掉「有两根管玩家根本点不到」。
   这里改成：用「夹到屏幕内」的坐标走真实命中路径 tubeAt(vx,vy)（与 handleTap/魔法清除/互换同一条），
   每根管都必须命中它自己 —— 不能是 −1，也不能串到别的管。 */
guard(rep, '水管可点性', function () {
  const g = fresh(); const D = g.DBG;
  enter(g); g.frames(4);
  const VW = D.consts().VW, BOTT_Y = D.consts().BOTT_Y;
  const bad = [];
  let probed = 0;
  for (let lv = 1; lv <= 100; lv++) {
    D.gen(lv); g.frames(2);
    const G = D.G;
    for (let i = 0; i < G.tubes.length; i++) {
      probed++;
      const t = G.tubes[i];
      /* 手指能到的最接近这根管中心的点（出屏时夹到 0 / VW） */
      const cx = Math.max(0, Math.min(VW, t.x + G.tubeW / 2));
      const cy = BOTT_Y - t.h / 2;
      const hit = D.tubeAt(cx, cy);
      if (hit !== i) bad.push('L' + lv + ' 管' + i + '(x' + t.x.toFixed(0) + ') 夹屏点 vx' + cx.toFixed(0) + '→' + hit);
    }
  }
  rep.ok('**水管命中路径**：1~100 关每根管用「夹到屏幕内」的坐标走真实 tubeAt → 命中它自己（'
    + probed + ' 根管探针；不是 −1、也不串到别的管）', bad.length === 0, bad.slice(0, 6).join(' '));
});

/* ============ 16. FIX-04：卡住 / 死局时的「撤销」必须真的可点 ============
   玩家原话：「台面放不下瓶子弹的是可以撤销提示，理论上是先弹游戏结束弹窗后，
   几秒有一个可以撤销提示按钮」。两档都要落地：
     ① 可救的卡住 → 软提示条上就地出真按钮（不再只是"点撤销"三个字）；
     ② 真死局     → 失败面板先弹，1.5 秒后淡入「撤销一瓶」。
   这一组还专门盯住"画的和点的不是一套坐标"这个老毛病：按钮矩形只允许从
   hintRects() 出，测试直接拿它算出来的中心点去真点一下。 */
function makeStuck(undoLeft) {
  const g = fresh(); const D = g.DBG; const G = enter(g);
  G.slots.forEach(s => { s.open = true; });
  const b0 = G.bottles.find(x => x.place === 'grid' && x.gate < 0 && !x.locked);
  /* 管底统一成一个「台上这瓶接不到」的颜色 → 放上去之后一瓶都喝不到 = 卡住 */
  const ghost = [0, 1, 2, 3, 4, 5].find(c => c !== b0.col);
  G.tubes.forEach(t => { t.units = [ghost]; });
  g.viewClick(b0.x, b0.y - 20); g.waitIdle(); g.frames(6);   // 真的走一次放置 → 撤销栈非空
  G.bottles.forEach(b => { if (b.place === 'grid') b.place = 'gone'; });
  G.undoLeft = undoLeft;
  G.hintHold = 1.5;
  g.frames(3);
  return g;
}
guard(rep, 'FIX-04 撤销提示', function () {
  /* ---- ①a：卡住时软提示带按钮，且永远至少有一个能点 ---- */
  {
    const g = makeStuck(5); const D = g.DBG; const G = D.G;
    rep.ok('FIX-04①a：卡住时软提示带真按钮（不再只是文字）',
      !!G.hint && !!G.hint.opts && G.hint.opts.length >= 1,
      JSON.stringify(G.hint && G.hint.opts));
    rep.ok('FIX-04①a：至少 1 个 enabled 的按钮（永远给得出路）',
      !!G.hint && G.hint.opts.some(o => o.enabled === true));
    rep.ok('FIX-04①a：有撤销次数 + 有撤销栈 → 「撤销一瓶」是可用的',
      !!G.hint && G.hint.opts.some(o => o.id === 'undo' && o.enabled === true));
    rep.ok('FIX-04①a：按钮不超过 3 个（一排排得下）',
      !!G.hint && G.hint.opts.length <= 3, String(G.hint && G.hint.opts.length));

    /* ---- ①b：几何 = 命中（点中心必中、不出屏、不压水管/货架/彼此） ---- */
    const r = D.hintRects(), C = D.consts();
    const bad = [];
    /* 用 hintHit（纯查询）而不是 hintTap：后者会真把按钮按下去，
       探第二个按钮时局面已经变了 —— 那样探出来的"不命中"是假象。 */
    r.btns.forEach((t, i) => {
      const hit = D.hintHit(t.x + t.w / 2, t.y + t.h / 2);
      if (!hit || hit.id !== t.id) bad.push('btn' + i + '(' + t.id + ')中心点不命中');
      /* 顺带探四角内侧 2px：命中框必须整个覆盖画出来的方块 */
      [[2, 2], [t.w - 2, 2], [2, t.h - 2], [t.w - 2, t.h - 2]].forEach(p => {
        const h2 = D.hintHit(t.x + p[0], t.y + p[1]);
        if (!h2 || h2.id !== t.id) bad.push('btn' + i + '(' + t.id + ')边角不命中');
      });
      if (t.x < 0 || t.x + t.w > C.VW || t.y < 0 || t.y + t.h > C.VH) bad.push('btn' + i + '出屏');
      if (t.y < C.BOTT_Y + 16) bad.push('btn' + i + '压到水管命中区');
      if (t.y + t.h > C.GRID_Y0) bad.push('btn' + i + '压到货架');
    });
    for (let i = 1; i < r.btns.length; i++) {
      if (r.btns[i].x < r.btns[i - 1].x + r.btns[i - 1].w) bad.push('btn' + i + '与前一个重叠');
    }
    rep.ok('FIX-04①b：按钮矩形 = 命中矩形（点中心必中 / 不出屏 / 不压水管与货架 / 彼此不重叠）',
      bad.length === 0, bad.join(' '));

    /* ---- ①c：用手指真点一下（走 handleTap 全链路，不是直接调函数） ---- */
    const ub = r.btns.filter(t => t.id === 'undo')[0];
    const u0 = G.undoLeft, s0 = sig(D);
    g.viewClick(ub.x + ub.w / 2, ub.y + ub.h / 2);
    g.waitIdle(); g.frames(6);
    rep.ok('FIX-04①c：点提示条上的「撤销一瓶」→ 真的退回一步并扣 1 次次数',
      G.undoLeft === u0 - 1 && sig(D) !== s0,
      'undoLeft ' + u0 + '→' + G.undoLeft + '；' + firstDiff(s0, sig(D)));
    rep.ok('FIX-04①c：点完按钮提示条收起（不会一直杵在屏幕上）', !G.hint);
  }

  /* ---- ①d：不能用的按钮画成灰色，点了不生效 ---- */
  {
    const g = makeStuck(0); const D = g.DBG; const G = D.G;
    G.history.length = 0;                       // 次数和撤销栈都没有 → 撤销必须是灰的
    G.hintHold = 1.5; g.frames(3);
    const r = D.hintRects();
    const ub = r.btns.filter(t => t.id === 'undo')[0];
    rep.ok('FIX-04①d：没次数 / 没撤销栈 → 「撤销一瓶」是灰的（enabled=false）',
      !!ub && ub.enabled === false, JSON.stringify(r.btns.map(t => t.id + ':' + t.enabled)));
    rep.ok('FIX-04①d：即使撤销灰了，也还剩「重开」这类能点的（兜底不落空）',
      r.btns.some(t => t.enabled === true));
    const u0 = G.undoLeft, s0 = sig(D);
    g.viewClick(ub.x + ub.w / 2, ub.y + ub.h / 2);
    g.waitIdle(); g.frames(6);
    rep.ok('FIX-04①d：点灰按钮不生效（不扣次数、局面不变）',
      G.undoLeft === u0 && sig(D) === s0);
  }

  /* ---- ②：失败面板的撤销按钮：1.5 秒后才出现，点了要真的能继续 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    const b0 = G.bottles.find(x => x.place === 'grid' && x.gate < 0 && !x.locked);
    /* 管底留一个「货架上还有、但台上这瓶接不到」的颜色：撤销之后棋盘仍是可继续的，
       否则面板刚关就会二次判死，这条断言就成了自己跟自己打架。 */
    const other = G.bottles.find(x => x.place === 'grid' && x.gate < 0 && !x.locked && x.col !== b0.col);
    G.tubes.forEach(t => { t.units = [other ? other.col : b0.col]; });
    g.viewClick(b0.x, b0.y - 20); g.waitIdle(); g.frames(6);   // 产出撤销栈
    G.tools = { clear: 0, finger: 0, swap: 0 }; G.unlockLeft = 0;
    D.enterFail('exhausted');
    g.frames(4);
    rep.ok('FIX-04②a：失败面板刚弹出（<1.5s）时撤销按钮还没出现（alpha=0）',
      D.failUndoShow() === true && D.failUndoAlpha() === 0,
      'show=' + D.failUndoShow() + ' alpha=' + D.failUndoAlpha());
    const opt = D.FAIL_OPTS.filter(o => o.id === 'undo')[0];
    const u0 = G.undoLeft;
    g.viewClick(360, opt.y + opt.h / 2);                       // 提前点：必须点不动
    g.frames(4);
    rep.ok('FIX-04②a：淡入完成前点它 → 点不动（面板还在、次数没动）',
      G.fail !== null && G.undoLeft === u0);
    g.frames(110);                                             // 累计 >1.5s
    rep.ok('FIX-04②a：1.5 秒后撤销按钮淡入（alpha>0）', D.failUndoAlpha() > 0,
      'alpha=' + D.failUndoAlpha());
    g.viewClick(360, opt.y + opt.h / 2);
    g.waitIdle(); g.frames(8);
    rep.ok('FIX-04②b：点「撤销一瓶」→ 退出失败面板、回到 play、局面真的可继续',
      G.fail === null && G.state === 'play' && D.hasLegalDecision() === true,
      'fail=' + (G.fail && G.fail.reason) + ' state=' + G.state);
    rep.ok('FIX-04②b：这次撤销照常扣 1 次（不是免费无限撤）', G.undoLeft === u0 - 1,
      u0 + '→' + G.undoLeft);
  }

  /* ---- ②c：撤销次数用光 → 文案变「看广告 +1 撤销」，走广告补次而不是白送 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    const b0 = G.bottles.find(x => x.place === 'grid' && x.gate < 0 && !x.locked);
    const other = G.bottles.find(x => x.place === 'grid' && x.gate < 0 && !x.locked && x.col !== b0.col);
    G.tubes.forEach(t => { t.units = [other ? other.col : b0.col]; });
    g.viewClick(b0.x, b0.y - 20); g.waitIdle(); g.frames(6);
    G.undoLeft = 0;
    G.tools = { clear: 0, finger: 0, swap: 0 }; G.unlockLeft = 0;
    D.enterFail('exhausted');
    g.frames(110);
    const t = g.renderOnce();
    rep.ok('FIX-04②c：撤销次数用光 → 按钮文案变成「看广告 +1 撤销」',
      t.some(s => s.indexOf('看广告 +1 撤销') >= 0), JSON.stringify(t).slice(0, 120));
    D.AdService.resetSession();
    const u0 = G.undoLeft;                                     // 0
    const opt = D.FAIL_OPTS.filter(o => o.id === 'undo')[0];
    g.viewClick(360, opt.y + opt.h / 2);
    g.waitIdle(); g.frames(10);
    rep.ok('FIX-04②c：点它走广告补次 → 补到的 1 次随即被这次撤销用掉（补次不是白送、撤销不是无限）',
      G.fail === null && G.undoLeft === u0,
      'fail=' + (G.fail && G.fail.reason) + ' undoLeft=' + G.undoLeft + '(起点 ' + u0 + ')');
  }

  /* ---- ②d：撤销完还是死局 → 不退出面板、不白扣次数，只给提示 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    const b0 = G.bottles.find(x => x.place === 'grid' && x.gate < 0 && !x.locked);
    g.viewClick(b0.x, b0.y - 20); g.waitIdle(); g.frames(4);
    G.tools = { clear: 0, finger: 0, swap: 0 }; G.unlockLeft = 0;
    /* 一个「退回去也走不动」的棋盘：瓶子全收走、管底留水 */
    G.bottles.forEach(b => { b.place = 'gone'; });
    G.tubes.forEach(t => { t.units = [0, 0, 0]; });
    G.history.push(JSON.stringify({
      tubes: G.tubes.map(t => t.units.slice()),
      bottles: G.bottles.map(b => ({ col: b.col, cap: b.cap, fill: b.fill, locked: b.locked,
        place: b.place, slot: b.slot, cell: b.cell, gate: b.gate, q: b.q })),
      slots: G.slots.map(s => ({ open: s.open })), clears: G.clears, unlockLeft: G.unlockLeft
    }));
    D.enterFail('exhausted');
    g.frames(110);
    const u0 = G.undoLeft;
    const opt = D.FAIL_OPTS.filter(o => o.id === 'undo')[0];
    g.viewClick(360, opt.y + opt.h / 2);
    g.waitIdle(); g.frames(8);
    rep.ok('FIX-04②d：撤销后仍是死局 → 不退出面板、不白扣次数、只给一句提示',
      G.fail !== null && G.undoLeft === u0 && !!G.toast,
      'fail=' + (G.fail && G.fail.reason) + ' undoLeft ' + u0 + '→' + G.undoLeft
      + ' toast=' + (G.toast && G.toast.msg));
  }

  /* ---- ②e：面板四项的排布（新增的撤销按钮没压到别的选项 / 脚注 / 面板外） ---- */
  {
    const opts = fresh().DBG.FAIL_OPTS;
    const bad = [];
    for (let i = 1; i < opts.length; i++) {
      if (opts[i].y < opts[i - 1].y + opts[i - 1].h) bad.push('第' + i + '项与上一项重叠');
    }
    opts.forEach(o => { if (o.y < 392 || o.y + o.h > 930) bad.push(o.id + ' 越出面板(392~930)'); });
    if (!opts.some(o => o.id === 'undo')) bad.push('面板缺少 undo 项');
    rep.ok('FIX-04②e：失败面板四项互不重叠、都落在面板内（撤销按钮没压到别的选项与脚注）',
      bad.length === 0, bad.join(' '));
  }
});

/* ============ 17. B 组：UX 评审「读代码读出来」的五个真 bug ============
   这五条都不是审美意见，而是「点了会怎样」的账算错了，逐条配断言 + 回滚用例。 */
guard(rep, 'B 组真 bug', function () {
  /* ---- B1：台面满时点「万能指」不能白扣道具 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    G.slots.forEach(s => { s.open = true; });
    const pool = G.bottles.filter(b => b.place === 'grid' && b.gate < 0 && !b.locked);
    pool.slice(0, G.slots.length).forEach((b, i) => { b.place = 'counter'; b.slot = i; b.fill = 0; });
    /* 保证确实存在「能直接喝」的目标（否则 useFinger 会在 if(!b) 就退出，断言成假绿） */
    const target = pool[G.slots.length];
    G.tubes.forEach(t => { t.units = [target.col]; });
    G.tools.finger = 1; G.anim = null; G.toast = null;
    const f0 = G.tools.finger, s0 = sig(D);
    const idx = D.TOOLBS.findIndex(t => t.id === 'finger');
    const c = toolCenter(D, idx);
    g.viewClick(c.x, c.y); g.frames(4);
    rep.ok('B1：台面满时点「万能指」→ 不白扣道具（次数没少、瓶子没动、给了人话提示）',
      G.tools.finger === f0 && sig(D) === s0 && !!G.toast,
      'finger ' + f0 + '→' + G.tools.finger + '；toast=' + (G.toast && G.toast.msg));
  }

  /* ---- B2：撤销要把步数退回去；但「退回一瓶」仍然算一步 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    const b0 = G.bottles.find(x => x.place === 'grid' && x.gate < 0 && !x.locked);
    G.tubes.forEach(t => { t.units = [(b0.col + 1) % 6]; });   // 别让它接水，保持局面可控
    const m0 = G.moves;
    g.viewClick(b0.x, b0.y - 20); g.waitIdle(); g.frames(6);
    const m1 = G.moves;
    D.doUndo(); g.frames(2);
    rep.ok('B2①：放一瓶 +1 步 → 撤销后步数回到放置前（撤销不是"又走一步"）',
      m1 === m0 + 1 && G.moves === m0, m0 + ' → ' + m1 + ' → ' + G.moves);
    /* 反向那条同样重要：startReturn 的 G.moves++ 若改成 --，place 与 return 相消后
       moves 恒等于瓶子数，任何人任何打法都三星，星级指标当场死。 */
    g.viewClick(b0.x, b0.y - 20); g.waitIdle(); g.frames(6);
    const m2 = G.moves;
    const jar = G.bottles.find(x => x.place === 'counter');
    D.startReturn(jar); g.waitIdle(); g.frames(6);
    rep.ok('B2②：退回一瓶仍然记 1 步（startReturn 是向前走一步，不是时间倒流）',
      jar && G.moves === m2 + 1, m2 + ' → ' + G.moves);
  }

  /* ---- B3：广告上限触顶只吐一条提示，且文案不再承诺"下局" ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    const C = D.CFG;
    D.AdService.resetSession();
    let failN = 0, noticeN = 0;
    for (let i = 0; i < C.rewardedSessionCap + 2; i++) {
      D.AdService.showRewarded('tool_clear', { onFail: () => failN++, onNotice: () => noticeN++ });
    }
    rep.ok('B3①：上限触顶只回调 onFail、不再补一条 onNotice（两条 toast 不会互相覆盖）',
      failN === 2 && noticeN === 0, 'onFail ' + failN + ' 次 / onNotice ' + noticeN + ' 次');
    D.AdService.resetSession();
    for (let i = 0; i < C.rewardedSessionCap; i++) D.refillTool('clear');
    G.toast = null;
    D.refillTool('clear');
    rep.ok('B3②：触顶文案写「换一局再来」（频控是会话级的，resetSession 无调用，"下局"是句谎话）',
      !!G.toast && G.toast.msg.indexOf('换一局再来') >= 0 && G.toast.msg.indexOf('下局') < 0,
      G.toast && G.toast.msg);
  }

  /* ---- B4：每日挑战中途点 HUD「重开」不能被静默降级 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    D.startDaily(); g.frames(6);
    const s0 = sig(D), date0 = G.dailyDate, lv0 = G.level, t0 = G.tier;
    g.viewClick(645, 58);                                   // HUD「重开」中心（590~700 / 28~88）
    g.frames(8);
    rep.ok('B4①：每日挑战中途 HUD 重开 → 仍是每日挑战（徽标字段/日期/关卡/档位都没丢、棋盘还是同一局）',
      G.daily === true && G.dailyDate === date0 && G.level === lv0 && G.tier === t0 && sig(D) === s0,
      'daily=' + G.daily + ' date=' + G.dailyDate + '；' + firstDiff(s0, sig(D)));
    rep.ok('B4②：HUD 重开也记 restarted（与失败面板的重开同标准，不再双标）', G.restarted === 1,
      'restarted=' + G.restarted);
  }

  /* ---- B5：道具栏「名字」与「▶ 广告补次」不再画在同一位置 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    const labels = D.TOOLBS.map(t => t.label);
    G.tools = { clear: 1, finger: 1, swap: 1 }; G.undoLeft = 5; G.toast = null; G.warn = null;
    const tFull = g.renderOnce();
    rep.ok('B5①：道具充足时四个名字照常显示（不是一刀切把名字删了）',
      labels.every(l => tFull.indexOf(l) >= 0)
      && tFull.filter(s => s === '▶ 广告补次').length === 0,
      JSON.stringify(labels.filter(l => tFull.indexOf(l) < 0)));
    G.tools = { clear: 0, finger: 0, swap: 0 }; G.undoLeft = 0;
    const tEmpty = g.renderOnce();
    const left = labels.filter(l => tEmpty.indexOf(l) >= 0);
    rep.ok('B5②：道具与撤销次数归零时，原名让位给「▶ 广告补次」（撤销行是全不透明硬重叠，每局必现）',
      left.length === 0 && tEmpty.filter(s => s === '▶ 广告补次').length === 4,
      '仍在画的名字=' + JSON.stringify(left) + '；补次条数=' + tEmpty.filter(s => s === '▶ 广告补次').length);
  }

  /* ---- B6：三星不再要求 0 道具，但重开仍然挡三星 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    G.par = 999; G.moves = 1; G.toolsUsed = 2; G.restarted = 0; G.reviveUsed = 0;
    D.levelDone(); g.frames(2);
    rep.ok('B6①：步数达标 + 用过道具 → 仍然三星（"用了道具就别想三星"掐死了道具消耗与广告补次）',
      !!G.winStats && G.winStats.stars === 3, JSON.stringify(G.winStats));
    const g2 = fresh(); const G2 = enter(g2);
    G2.par = 999; G2.moves = 1; G2.toolsUsed = 0; G2.restarted = 1; G2.reviveUsed = 0;
    g2.DBG.levelDone(); g2.frames(2);
    rep.ok('B6②：重开过 → 最多 2 星（全文唯一的 anti-reroll 门槛保留）',
      !!G2.winStats && G2.winStats.stars === 2, JSON.stringify(G2.winStats));
  }

  /* ---- B7：玩家连点关卡号不该看见「（测试）」这种内部字样 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    G.lvTap = { n: 0, t: 0 }; G.lvPick = false; G.toast = null;
    g.viewClick(105, 58); g.frames(2);
    rep.ok('B7：连点关卡号不再弹「（测试）」内部字样（第 5 次打开面板本身就是反馈）',
      G.toast === null, G.toast && G.toast.msg);
    for (let k = 0; k < 4; k++) g.viewClick(105, 58);
    g.frames(2);
    rep.ok('B7：连点 5 次仍然能打开隐藏选关（入口没被一起删掉）', G.lvPick === true);
  }
});

/* ============ 18. B8：看过广告的撤销，星级封顶 2（口径与 reviveUsed 一致） ============
   failUndo 有两条路：撤销次数够 → 花每关 5 次的额度（不封顶）；
   次数用光 → 走 adReward 看广告补 1 次（封顶 2，否则出现「看完广告 → 三星」，
   与既有的「看过广告不该还是三星」原则直接冲突）。 */
function makeFailUndoReady(undoLeft) {
  const g = fresh(); const D = g.DBG; const G = enter(g);
  const b0 = G.bottles.find(x => x.place === 'grid' && x.gate < 0 && !x.locked);
  const other = G.bottles.find(x => x.place === 'grid' && x.gate < 0 && !x.locked && x.col !== b0.col);
  G.tubes.forEach(t => { t.units = [other ? other.col : b0.col]; });   // 撤销之后棋盘仍可继续
  g.viewClick(b0.x, b0.y - 20); g.waitIdle(); g.frames(6);             // 产出撤销栈
  G.undoLeft = undoLeft;
  G.tools = { clear: 0, finger: 0, swap: 0 }; G.unlockLeft = 0;
  D.enterFail('exhausted');
  g.frames(110);                                                       // 等撤销按钮淡入（>1.5s）
  return g;
}
function clickFailUndo(g) {
  const opt = g.DBG.FAIL_OPTS.filter(o => o.id === 'undo')[0];
  g.viewClick(360, opt.y + opt.h / 2);
  g.waitIdle(); g.frames(10);
}
guard(rep, 'B8 广告撤销封顶', function () {
  /* ① 走广告的那次：撤销次数用光 → 看广告补 1 次 → 星级封顶 2 */
  {
    const g = makeFailUndoReady(0); const D = g.DBG; const G = D.G;
    D.AdService.resetSession();
    clickFailUndo(g);
    rep.ok('B8①：撤销次数用光 → 走广告补次退一步 → 面板真的关了（这一步本身要成功）',
      G.fail === null && G.adUndo === 1, 'fail=' + (G.fail && G.fail.reason) + ' adUndo=' + G.adUndo);
    G.par = 999; G.moves = 1; G.toolsUsed = 0; G.restarted = 0; G.reviveUsed = 0;
    D.levelDone(); g.frames(2);
    rep.ok('B8①：看过广告的撤销 → 星级封顶 2（不会出现「看完广告 → 三星」的自相矛盾）',
      !!G.winStats && G.winStats.stars === 2, JSON.stringify(G.winStats));
    rep.ok('B8①：结算面板显示的仍是「复活 0」（adUndo 不混进 reviveUsed，数据不脏）',
      !!G.winStats && G.winStats.revive === 0, JSON.stringify(G.winStats));
  }

  /* ② 用普通撤销次数的那次：不封顶 */
  {
    const g = makeFailUndoReady(5); const D = g.DBG; const G = D.G;
    clickFailUndo(g);
    rep.ok('B8②：用普通撤销次数退一步 → 面板关掉、adUndo 仍是 0（花的是每关 5 次的额度，不是广告）',
      G.fail === null && G.adUndo === 0, 'fail=' + (G.fail && G.fail.reason) + ' adUndo=' + G.adUndo);
    G.par = 999; G.moves = 1; G.toolsUsed = 0; G.restarted = 0; G.reviveUsed = 0;
    D.levelDone(); g.frames(2);
    rep.ok('B8②：用普通撤销次数的 failUndo → 星级不受影响（照常三星）',
      !!G.winStats && G.winStats.stars === 3, JSON.stringify(G.winStats));
  }

  /* ③ 换一关 / 重开，adUndo 必须归零（不能把上一局的账带到下一局） */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    G.adUndo = 3;
    D.gen(G.level); g.frames(4);
    rep.ok('B8③：genLevel 后 G.adUndo 归零（与 reviveUsed 一起按局重置）',
      G.adUndo === 0 && G.reviveUsed === 0, 'adUndo=' + G.adUndo);
  }
});

/* ============ 19. 主循环守恒：喝水 → 接满 3 口 → 自动收走 ============
   ⚠ 2026-09-28 23:00 档补：这是全项目最后一块「零断言」盲区。
   已有的守恒断言都停在**生成期**（管中水 == 所有瓶子容量之和）或**单个道具**上（魔法清除），
   而游戏最核心的那条链 —— 管子 →（喝水）瓶子 fill+1 → fill==cap → completeJar
   → 瓶子消失 + G.clears+1 —— 从头到尾没人守过。这条链上漏任何一步，玩家看到的是
   「水没了、瓶子还在」或者「清完了却不计入进度（永远通不了关）」。
   断言口径：已收走的瓶子按满杯计账，于是
       管中水 + 瓶中的水（含已收走的满杯） == 常量
   在「真实帧驱动完成一次接满→收走」的前后都必须成立。
   注意：这里不手工调 completeJar，而是把瓶子预置成「差一口」后交给主循环的 tryDrinks ——
   验的是真链路，不是把产品函数当 API 调。 */
guard(rep, '主循环守恒', function () {
  const g = fresh(); const D = g.DBG; const G = D.G;
  enter(g);
  const badDone = [], badKeep = [];
  let samples = 0;
  for (const lv of [3, 9, 15, 20, 25, 30, 35]) {
    withSeed(9100 + lv, () => D.gen(lv));
    g.frames(8); g.waitIdle(); g.frames(4);
    G.slots.forEach(s => { s.open = true; });
    const bottoms = G.tubes.map(t => (t.units.length ? t.units[0] : -1));
    /* 选一个「管底颜色 == 它自己的颜色」且没被冰冻、不在洞里的瓶子，摆上台面预置成 2 口 */
    const jar = G.bottles.filter(b => b.place === 'grid' && !b.locked && b.gate < 0
      && bottoms.indexOf(b.col) >= 0)[0];
    const slot = D.freeSlot();
    if (!jar || slot < 0) continue;
    jar.place = 'counter'; jar.slot = slot; jar.fill = jar.cap - 1; jar.capT = 1;
    const W0 = totalWater(D), c0 = G.clears;
    let ticks = 0;
    while (jar.place !== 'gone' && ticks < 500) { g.frames(1); ticks++; }
    samples++;
    const W1 = totalWater(D);
    if (!(jar.place === 'gone' && jar.slot === -1 && G.clears === c0 + 1)) {
      badDone.push('L' + lv + '：place=' + jar.place + ' slot=' + jar.slot
        + ' clears=' + c0 + '→' + G.clears + '（' + ticks + ' 帧后仍未收走）');
    }
    if (W1.sum !== W0.sum) {
      badKeep.push('L' + lv + '：总水量 ' + W0.sum + '→' + W1.sum
        + '（管 ' + W0.tube + '→' + W1.tube + '，瓶 ' + W0.jar + '→' + W1.jar + '）');
    }
  }
  rep.ok('主循环：接满 3 口 → 瓶子真的消失（place=gone）、槽位被释放（slot=-1）、G.clears 恰 +1'
    + '（' + samples + ' 个关卡，全程真实帧驱动 + tryDrinks）',
    samples >= 5 && badDone.length === 0,
    (samples < 5 ? '有效样本只有 ' + samples + ' 关；' : '') + badDone.slice(0, 4).join(' | '));
  rep.ok('主循环守恒：从「差一口」到「自动收走」全程，管中水 + 瓶中的水（收走按满杯计）恒定不变',
    samples >= 5 && badKeep.length === 0, badKeep.slice(0, 4).join(' | '));
});

/* ============ 20. 万能指：挑选语义 + 不做白工 + 不改变水量 ============
   「万能指」的设计语义是「把一个**此刻真能喝到水**的瓶子直接摆上台面」，
   挑选条件全写在 useFinger 里：place==='grid' && !locked && 颜色 ∈ 管底颜色集 && gridPlayable。
   把这条断言钉住，是因为放宽任何一条都会让道具失去意义：
   能拿冰冻瓶 = 绕过解冻机制；能拿洞里的瓶 = 绕过顺序锁；能拿永远喝不到的颜色 = 把
   「不会玩」变成「乱拿」。另外它必须**只搬瓶子、不喝水**（水量的改变只属于「喝水/道具清除」）。 */
guard(rep, '万能指', function () {
  const g = fresh(); const D = g.DBG; const G = D.G;
  enter(g);
  const badPick = [], badCost = [], badKeep = [];
  let samples = 0, noCol = 0, gateOrIce = 0;
  for (const lv of [9, 12, 15, 20, 25, 30, 35]) {
    withSeed(5200 + lv, () => D.gen(lv));
    g.frames(8); g.waitIdle(); g.frames(4);
    G.slots.forEach(s => { s.open = true; });
    const bottoms = G.tubes.map(t => (t.units.length ? t.units[0] : -1));
    const set = {}; bottoms.forEach(c => { if (c >= 0) set[c] = 1; });
    const grid = G.bottles.filter(b => b.place === 'grid');
    /* 局面本身要有区分度：存在「颜色不在任何管底」的瓶子 / 冰冻瓶 / 洞里的瓶。
       否则挑选条件被改坏也看不出来（断言就成了恒真）。 */
    if (grid.some(b => !set[b.col])) noCol++;
    if (grid.some(b => b.gate >= 0) || grid.some(b => b.locked)) gateOrIce++;
    G.tools.finger = 2;
    const W0 = totalWater(D);
    D.useFinger();                                  // 同步函数：点完立刻读，绝不走帧（走帧就被喝掉了）
    const a = G.anim, picked = (a && a.b) ? a.b : null;
    samples++;
    if (!picked || picked.place !== 'anim' || !set[picked.col] || picked.locked || picked.gate >= 0) {
      badPick.push('L' + lv + '：选中 ' + (picked ? ('col' + picked.col + ' place' + picked.place
        + ' locked' + picked.locked + ' gate' + picked.gate) : '无')
        + '（管底色集 ' + Object.keys(set).join(',') + '）');
    }
    if (!picked || G.tools.finger !== 1) badCost.push('L' + lv + '：道具 2→' + G.tools.finger);
    if (totalWater(D).sum !== W0.sum) {
      badKeep.push('L' + lv + '：总水量 ' + W0.sum + '→' + totalWater(D).sum);
    }
    g.waitIdle(600); g.frames(4);
  }
  rep.ok('「万能指」搬上台面的必须是此刻真能喝到水的瓶子（颜色在管底色集里 / 不是冰冻瓶 / 不在门洞里）'
    + '（' + samples + ' 关，其中 ' + noCol + ' 关存在「喝不到的颜色」、' + gateOrIce + ' 关有冰冻瓶或洞内瓶）',
    samples >= 5 && noCol >= 3 && badPick.length === 0,
    (noCol < 3 ? '区分度不足：只有 ' + noCol + ' 关存在喝不到的颜色，断言可能恒真；' : '')
    + badPick.slice(0, 4).join(' | '));
  rep.ok('「万能指」真消耗 1 次道具（不做白工，也不白扣）',
    samples >= 5 && badCost.length === 0, badCost.slice(0, 4).join(' | '));
  rep.ok('「万能指」只搬瓶子、不喝管里的水（管中水量守恒）',
    samples >= 5 && badKeep.length === 0, badKeep.slice(0, 4).join(' | '));
});

/* ============ 21. 随心互换：只换塔顶一杯 / 水量守恒 / 空管拒绝不扣道具 ============ */
guard(rep, '随心互换', function () {
  const g = fresh(); const D = g.DBG; const G = D.G;
  enter(g);
  withSeed(6100, () => D.gen(15));
  g.frames(8); g.waitIdle(); g.frames(4);
  /* 挑两根长度不同的水管（长度一样的话「换整根管」和「换塔顶」看不出区别） */
  let i = -1, j = -1;
  for (let a = 0; a < G.tubes.length && j < 0; a++) {
    if (G.tubes[a].units.length < 2) continue;
    for (let b2 = a + 1; b2 < G.tubes.length; b2++) {
      if (G.tubes[b2].units.length >= 2 && G.tubes[b2].units.length !== G.tubes[a].units.length) {
        i = a; j = b2; break;
      }
    }
  }
  if (j < 0) {
    const nonEmpty = G.tubes.map((t, k) => [t.units.length, k]).filter(x => x[0] > 0).map(x => x[1]);
    i = nonEmpty[0]; j = nonEmpty[1];
  }
  const T1 = G.tubes[i], T2 = G.tubes[j];
  const top1 = T1.units[0], top2 = T2.units[0];
  const tail1 = T1.units.slice(1).join(','), tail2 = T2.units.slice(1).join(',');
  const len1 = T1.units.length, len2 = T2.units.length;
  G.tools.swap = 3; G.moves = 0;
  const W0 = totalWater(D);
  D.useSwap(i, j);
  rep.ok('「随心互换」只换两根管的塔顶一杯（管长与其余水层原封不动，不是把整根管对调）',
    T1.units[0] === top2 && T2.units[0] === top1
    && T1.units.slice(1).join(',') === tail1 && T2.units.slice(1).join(',') === tail2
    && T1.units.length === len1 && T2.units.length === len2,
    '管' + i + '=[' + T1.units.join(',') + '] 管' + j + '=[' + T2.units.join(',') + ']');
  rep.ok('「随心互换」不改变总水量、真消耗 1 次道具（换水 ≠ 造水）',
    totalWater(D).sum === W0.sum && G.tools.swap === 2 && G.moves === 1,
    '水 ' + W0.sum + '→' + totalWater(D).sum + '，道具 3→' + G.tools.swap + '，步数 ' + G.moves);

  /* 空管：必须拒绝，且不扣道具、不动任何状态（否则玩家点一下白扣一次道具） */
  G.tubes[0].units = []; D.layoutAll();
  G.tools.swap = 2;
  const pre = sig(D) + '|' + totalWater(D).sum;
  D.useSwap(0, i === 0 ? j : i);
  rep.ok('「随心互换」拒绝空管：不扣道具、两根管都不变（不白扣一次道具）',
    G.tools.swap === 2 && sig(D) + '|' + totalWater(D).sum === pre,
    '道具 2→' + G.tools.swap + '，各管长度 [' + G.tubes.map(t => t.units.length).join(',') + ']');
});

/* ============ 22. 多步撤销：撤销栈必须是 LIFO，逐层回到每一层的快照 ============
   已有的撤销断言只做「单步前进 → 单步撤销」。如果撤销栈只保留 1 层
   （比如 snapshot 里写成 G.history[0]=... 或把 30 层上限改成 1），单步撤销照样全绿，
   但玩家连撤两次就错乱 —— 那才是「撤销坏了」的真实体感。这里连放 3 瓶、连撤 3 次，
   每一次都必须精确落回该层的快照。 */
guard(rep, '多步撤销', function () {
  const g = fresh(); const D = g.DBG; const G = D.G;
  enter(g);
  withSeed(7700, () => D.gen(9));
  g.frames(8); g.waitIdle(); g.frames(4);
  G.undoLeft = 9;
  const bottoms = G.tubes.map(t => (t.units.length ? t.units[0] : -1));
  const marks = [sig(D)];                     // marks[0] = 开局
  let placed = 0;
  for (let step = 0; step < 3; step++) {
    /* 只挑「放上去也不会被喝」的瓶子：喝了水会连锁收走，撤销语义就变成「回到喝满那一刻」 */
    const b = G.bottles.find(x => x.place === 'grid' && !x.locked && x.gate < 0
      && bottoms.indexOf(x.col) < 0 && D.gridPlayable(x));
    if (!b || G.anim) break;
    g.viewClick(b.x, b.y - 20); g.waitIdle(600); g.frames(4);
    if (b.place !== 'counter') break;
    placed++; marks.push(sig(D));
  }
  const badLayer = [];
  for (let k = placed; k >= 1; k--) {          // 撤 k 次之后应当回到 marks[k-1]
    D.doUndo(); g.frames(4);
    if (sig(D) !== marks[k - 1]) {
      badLayer.push('撤 ' + (placed - k + 1) + ' 次后 ≠ 第 ' + (k - 1) + ' 层快照（'
        + firstDiff(marks[k - 1], sig(D)) + '）');
    }
  }
  rep.ok('连放 ' + placed + ' 瓶 → 连撤 ' + placed + ' 次，每一次都精确回到该层快照（LIFO 逐层，不是只退 1 步）',
    placed >= 3 && badLayer.length === 0,
    (placed < 3 ? '有效样本只有 ' + placed + ' 步；' : '') + badLayer.slice(0, 3).join(' | '));
  rep.ok('连续撤销 ' + placed + ' 次消耗 ' + placed + ' 次额度（不是免费无限撤）',
    G.undoLeft === 9 - placed, 'undoLeft=' + G.undoLeft);
});

/* ============ 23. 存档续玩：点「开始游戏」必须回到**玩家上次那一关** ============
   2026-10-01 23:00 档补。这是「进度存了却没人读」的体感级 bug：
   存档写得好好的、标题页上也显示着「进度：第 12 关」，点开始却永远从第 1 关重来 ——
   玩家会直接读成「这游戏不记我 / 我的进度没了」，而这正是留存最怕的那一下。
   这条把 startFromTitle 的三条分支（存档 / 脏存档 / URL 参数优先）全钉住。 */
guard(rep, '存档续玩', function () {
  const tapStart = (g) => {
    const S = g.DBG.TITLE_UI.start;
    g.viewClick(S.x + S.w / 2, S.y + S.h / 2);   // 真点「开 始 游 戏」按钮
    g.frames(6);
    return g.DBG.G;
  };

  /* ---- 23.1 有存档 → 从存档那一关开始 ---- */
  {
    const g = loadGame({});
    g.frames(3);
    const onTitle = g.DBG.G.state === 'title';
    g.DBG.Store.set('level', 12);
    g.DBG.Store.set('maxLevel', 12);
    const G = tapStart(g);
    rep.ok('存档续玩：存档写着第 12 关 → 点「开始游戏」真的进第 12 关（不是从第 1 关重来）',
      onTitle && G.state === 'play' && G.level === 12,
      'onTitle=' + onTitle + ' state=' + G.state + ' level=' + G.level);
  }

  /* ---- 23.2 脏存档（level=0）→ 落到第 1 关，不能开出「第 0 关」 ---- */
  {
    const g = loadGame({});
    g.frames(3);
    g.DBG.Store.set('level', 0);
    const G = tapStart(g);
    rep.ok('存档续玩：存档 level=0（脏值）→ 兜底到第 1 关，不会开出第 0 关 / NaN 关',
      G.state === 'play' && G.level === 1, 'state=' + G.state + ' level=' + G.level);
  }

  /* ---- 23.3 ?lvl=30 优先于存档（分享/调试链接必须说了算） ---- */
  {
    const g = loadGame({ search: '?lvl=30' });
    g.frames(4);
    const bootLv = g.DBG.G.level;                 // 带 ?lvl= 启动时应直接进第 30 关
    g.DBG.goHome(); g.frames(3);                  // 回标题页（此时存档已被写成 30）
    g.DBG.Store.set('level', 7);                  // 再手动把存档改成 7，检验谁的优先级高
    const G = tapStart(g);
    rep.ok('存档续玩：URL 带 ?lvl=30 时优先于存档（开屏直接进 30，回标题再点也不被存档 level=7 覆盖）',
      bootLv === 30 && G.state === 'play' && G.level === 30,
      '开屏 level=' + bootLv + '；点开始后 state=' + G.state + ' level=' + G.level
      + '（URL_LVL=' + g.DBG.URL_LVL + '）');
  }
});

/* ============ 24. 复活兜底阶梯 rescueGrant()：花钱看完广告，必须真的能继续 ============
   doRevive() 的硬指标是「复活后 hasLegalDecision() 为真」，靠 rescueGrant() 逐级兜底：
   ① 把接不到水的瓶子退回货架 → ② 台面腾不出来就收走一瓶 → ③ 开一个槽位
   → ④ 连槽都开满了就补 1 次「随心互换」。
   四级里**任何一级被删**，极端局面下玩家就是「看完广告还是死」—— 广告费花了、人跑了。
   旧断言只覆盖了 ①② 能生效的普通局面，③④ 从未被点亮过。这组把四级逐个点火。 */
guard(rep, '复活兜底阶梯', function () {
  const g = fresh(); const D = g.DBG; const G = D.G;
  enter(g);
  const onGrid = () => G.bottles.filter(b => b.place === 'grid');
  /* 统一造局：所有瓶子回货架（清干净，保证构造是确定的），再由调用方摆台面 */
  function clearBoard() {
    G.slots.forEach(s => { s.open = true; });
    G.bottles.forEach(b => {
      if (b.place !== 'gone') { b.place = 'grid'; b.slot = -1; b.fill = 0; b.capT = 0; }
    });
    D.layoutAll();
  }

  /* ---- ① 优选「把接不到水的瓶子退回货架」：不耗水、不牺牲别的瓶子 ---- */
  {
    withSeed(4101, () => D.gen(15));
    g.frames(8); g.waitIdle(); g.frames(4);
    clearBoard();
    const A = onGrid()[0];
    const other = onGrid().find(b => b.col !== A.col) || A;
    G.tubes.forEach(t => { t.units = [other.col]; });      // 管底全是别的颜色 → A 接不到水
    A.place = 'counter'; A.slot = 0; A.fill = 0; A.capT = 1;
    D.layoutAll();
    const W0 = totalWater(D);
    const ok = D.rescueGrant();
    rep.ok('复活兜底①：台面有「接不到水」的瓶子时，优先把它退回货架（不耗水、不牺牲别的瓶子）',
      ok === true && A.place === 'grid' && A.slot === -1 && totalWater(D).sum === W0.sum,
      'place=' + A.place + ' slot=' + A.slot + ' 水 ' + W0.sum + '→' + totalWater(D).sum);
  }

  /* ---- ② 台面腾不出来 → 收走一瓶，把位置让出来 ---- */
  {
    withSeed(4202, () => D.gen(15));
    g.frames(8); g.waitIdle(); g.frames(4);
    clearBoard();
    const A = onGrid()[0];
    G.tubes.forEach(t => { t.units = [A.col]; });          // 管底就是 A 的颜色 → ① 不会动它
    A.place = 'counter'; A.slot = 0; A.fill = 0; A.capT = 1;
    D.layoutAll();
    const gone0 = G.bottles.filter(b => b.place === 'gone').length;
    const ok = D.rescueGrant();
    rep.ok('复活兜底②：没有「接不到水」的瓶子可退时，改为收走一瓶释放位置（台面能继续转）',
      ok === true && A.place === 'gone' && A.slot === -1
      && G.bottles.filter(b => b.place === 'gone').length === gone0 + 1,
      'place=' + A.place + ' slot=' + A.slot);
  }

  /* ---- ③ 台面没瓶子可退 → 开一个槽位（保证至少能放一瓶上去） ---- */
  {
    withSeed(4303, () => D.gen(15));
    g.frames(8); g.waitIdle(); g.frames(4);
    G.slots.forEach(s => { s.open = false; });             // 槽全锁上 → ①② 都没事可做
    G.bottles.forEach(b => {
      if (b.place !== 'gone') { b.place = 'grid'; b.slot = -1; b.fill = 0; b.capT = 0; }
    });
    D.layoutAll();
    const before = D.openSlotCount();
    const ok = D.rescueGrant();
    rep.ok('复活兜底③：台面没瓶子可退时，改为开一个台面槽位（否则复活回来还是没位置放瓶）',
      ok === true && D.openSlotCount() > before,
      '开放槽位 ' + before + '→' + D.openSlotCount());
  }

  /* ---- ④ 终极兜底：补 1 次「随心互换」—— §11 硬指标的最后一道保险 ---- */
  {
    withSeed(4404, () => D.gen(15));
    g.frames(8); g.waitIdle(); g.frames(4);
    G.slots.forEach(s => { s.open = true; });              // 槽已开满 → ③ 也无事可做
    G.bottles.forEach(b => {
      if (b.place !== 'gone') { b.place = 'grid'; b.slot = -1; b.locked = 1; }   // 全冻住，取不出
    });
    G.tools = { clear: 0, finger: 0, swap: 0 }; G.unlockLeft = 0;
    D.layoutAll();
    const dead = D.boardPlayable() === false;
    const ok = D.rescueGrant();
    rep.ok('复活兜底④：连槽都开满了还走不动时，补 1 次「随心互换」（只要 ≥2 根管，它就一定是合法决策）',
      dead && ok === true && G.tools.swap >= 1 && D.boardPlayable() === true,
      'dead=' + dead + ' swap=' + G.tools.swap + ' playable=' + D.boardPlayable());
  }

  /* ---- ⑤ 硬指标：逐级施放必须收敛（doRevive 里那个 while 循环的可终止性）----
     这里的局面**同时需要 ③ 和 ④**（槽全锁 + 瓶子全冻住），所以 ③④ 任一级被删都会红，
     而 ①② 的两条用例各自独立 —— 一条改坏不会让四条一起红，各自有独立效力。 */
  {
    const bad = [];
    let cases = 0, maxGuard = 0;
    for (const lv of [9, 15, 24, 40, 60, 90]) {
      withSeed(4500 + lv, () => D.gen(lv));
      g.frames(8); g.waitIdle(); g.frames(4);
      G.slots.forEach(s => { s.open = false; });
      G.bottles.forEach(b => {
        if (b.place !== 'gone') { b.place = 'grid'; b.slot = -1; b.locked = 1; }
      });
      G.tools = { clear: 0, finger: 0, swap: 0 }; G.unlockLeft = 0;
      G.undoLeft = 0; G.history.length = 0;                // 连「还能撤销」这条路也堵死
      D.layoutAll();
      const dead0 = D.hasLegalDecision() === false;
      let guard = 0;
      while (!D.hasLegalDecision() && guard++ < 6) D.rescueGrant();
      cases++;
      maxGuard = Math.max(maxGuard, guard);
      if (!dead0) bad.push('L' + lv + ' 构造的局面并不是死局（断言前提不成立）');
      else if (!D.hasLegalDecision()) bad.push('L' + lv + ' 施放 ' + guard + ' 次后仍无合法决策');
    }
    rep.ok('复活兜底硬指标：逐级施放 rescueGrant() 后必然回到「有合法决策」'
      + '（' + cases + ' 种死局 × 最多 ' + maxGuard + ' 次施放全部收敛，管数 ≥2 时必定成立）',
      cases >= 6 && bad.length === 0, bad.slice(0, 4).join(' | '));
  }
});

/* ============ 25. 撤销的两条上限：额度 9 次封顶 + 撤销栈最多 30 层 ============
   两条都是「防无限刷」的账：上限被改掉/删掉，玩家（或脚本）可以把撤销刷成无限次，
   星级与难度平衡当场失去意义；栈上限被删则是长局里悄悄吃内存。
   旧套件只验了「撤销逐层正确」，从没验过「栈装不下时会怎样」。 */
guard(rep, '撤销上限', function () {
  /* ---- 25.1 撤销额度：连补 12 次，最多到 9 次就拒绝 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    G.undoLeft = 0; G.toast = null;
    let refusals = 0;
    for (let i = 0; i < 12; i++) {
      const before = G.undoLeft;
      D.addUndo();
      if (G.undoLeft === before) refusals++;
    }
    rep.ok('撤销额度封顶：连点 12 次补次，最多补到 9 次、其余全部拒绝（撤销刷不成无限次）',
      G.undoLeft === 9 && refusals === 3,
      'undoLeft=' + G.undoLeft + ' 被拒绝 ' + refusals + ' 次');
    rep.ok('撤销额度封顶：被拒绝时给了可见提示（不是静默无反应）',
      !!G.toast && G.toast.msg.indexOf('已满') >= 0, G.toast && G.toast.msg);
  }

  /* ---- 25.2 撤销栈上限 30：超出的丢最旧的，栈顶保留最近 30 步 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    G.history.length = 0; G.undoLeft = 99;
    for (let k = 1; k <= 40; k++) { G.moves = k; D.snapshot(); }   // 40 个**互不相同**的快照
    const first = JSON.parse(G.history[0]);
    const last = JSON.parse(G.history[G.history.length - 1]);
    rep.ok('撤销栈封顶 30 层：连做 40 次操作快照，栈长度恰为 30、丢掉的正是最旧的 10 步（栈顶保留最近 30 步）',
      G.history.length === 30 && first.moves === 11 && last.moves === 40,
      'len=' + G.history.length + ' 栈底 moves=' + first.moves + ' 栈顶 moves=' + last.moves);
  }
});

/* ============ 26. 台面账目自洽：瓶子数 / 开放槽位数 / freeSlot() 三者必须对得上 ============
   counterCount() 与 openSlotCount() 是「台面还剩几个位置」这份账的两半，
   以前没有任何断言碰过它们。账目对不上时玩家看到的是：明明还有空位却放不上瓶子
   （freeSlot 返回 -1），或者反过来 —— 台面上的瓶子数超过了槽位数（状态早就错乱了）。
   ⚠ 首版的假绿（被 qa_rollback 当场抓出来，第 7 次）：三种构造**全是空台面**，
   于是把 counterCount() 改成恒返回 0 它照样全绿 —— 「台面有 0 个瓶子」这句话在空台面上恒真。
   修法：装载程度取 0 / 一半 / 装满三档，并加一条「counterCount() == 台面实际瓶子数」的直查。
   教训与 3.4 那六次同源：**构造的局面必须让被测的那条路径真的被走到**。 */
guard(rep, '台面账目', function () {
  const g = fresh(); const D = g.DBG; const G = D.G;
  enter(g);
  const bad = [];
  let checks = 0, loaded = 0;
  for (let lv = 1; lv <= 90; lv++) {
    withSeed(6600 + lv, () => D.gen(lv));
    g.frames(3);
    /* 三档装载：空 / 一半 / 装满（空台面是「恒真」的温床，必须配一个非空的） */
    for (const fillRatio of [0, 0.5, 1]) {
      G.slots.forEach(s => { s.open = true; });
      G.bottles.forEach(b => { if (b.place === 'counter') { b.place = 'grid'; b.slot = -1; } });
      D.layoutAll();
      const pool = G.bottles.filter(b => b.place === 'grid');
      const oc = D.openSlotCount();
      const put = Math.min(pool.length, Math.round(oc * fillRatio));
      for (let k = 0; k < put; k++) { pool[k].place = 'counter'; pool[k].slot = k; }
      D.layoutAll();
      const cc = D.counterCount(), fs = D.freeSlot();
      const real = G.bottles.filter(b => b.place === 'counter').length;
      checks++;
      if (real > 0) loaded++;
      /* ① 直查：counterCount() 必须等于台面上真实的瓶子数（返回值写死/漏算都会在这一条上暴露） */
      if (cc !== real) {
        bad.push('L' + lv + '(装 ' + put + ') counterCount()=' + cc + ' 但台面实际有 ' + real + ' 个瓶子');
      }
      if (cc > oc) bad.push('L' + lv + '(装 ' + put + ') 台面瓶数 ' + cc + ' > 开放槽 ' + oc);
      /* ② 「有没有空位」必须严格等价于「瓶数 < 槽数」—— 差一个就是点击被静默吞掉 */
      if ((fs >= 0) !== (real < oc)) {
        bad.push('L' + lv + '(装 ' + put + ') freeSlot=' + fs
          + ' 与 瓶数/槽数(' + real + '/' + oc + ') 不一致');
      }
    }
    /* ③ 槽全锁 → freeSlot 必须是 -1（一个位置都不许开出来） */
    G.slots.forEach(s => { s.open = false; });
    G.bottles.forEach(b => { if (b.place === 'counter') { b.place = 'grid'; b.slot = -1; } });
    D.layoutAll();
    checks++;
    if (D.freeSlot() !== -1) bad.push('L' + lv + ' 槽全锁时 freeSlot 仍返回 ' + D.freeSlot());
  }
  rep.ok('台面账目自洽：counterCount() == 台面实际瓶数、瓶数 ≤ 开放槽位数，'
    + '且 freeSlot() 的有无与「瓶数 < 槽数」严格等价'
    + '（1~90 关 × 空/半/满 + 全锁，共 ' + checks + ' 次检查，其中 ' + loaded + ' 次台面非空）',
    /* 区分度自检：非空台面的样本太少时这条会退化成恒真（防止下次又被搬到空台面上测） */
    loaded >= 60 && checks >= 300 && bad.length === 0, bad.slice(0, 5).join(' | '));
});

/* ============ 27. 每日挑战完成标记：通关当天必须落盘、跨天不认 ============
   2026-10-02 23:00 档补。dailyDoneToday() 是标题页那句「✓ 今日挑战已完成」的唯一依据
   （drawTitle 里就是 dailyDoneToday() ? '✓ 今日挑战已完成' : '每日挑战（每天同一局）'）。
   这条链以前零断言：通关时 levelDone() 往 Store.data.daily 写 {date,done:1}，标题页再读回来。
   两头任何一头写错，玩家看到的都是「明明打完了，还是显示『每日挑战』」
   （标记没写 / 写的时候漏 date）或者反过来的「没打就显示已完成」（比对条件被写松）。
   顺带钉住：**只开一局每日题不算完成**，必须真的通关。 */
guard(rep, '每日挑战完成标记', function () {
  /* ---- 27.1 干净档 / 只开了每日题但没通关 → 一律 false ---- */
  {
    const g = fresh(); const D = g.DBG; enter(g);
    const clean = D.dailyDoneToday();
    D.gen(12, { daily: true, date: D.dateKey(), quiet: true });   // 开了每日题，但没通关
    g.frames(4);
    rep.ok('每日挑战完成标记：干净存档、以及「开了每日题但没通关」时都必须为 false（不能凭空显示已完成）',
      clean === false && D.dailyDoneToday() === false,
      '干净档=' + clean + ' 开题未通关=' + D.dailyDoneToday());
  }

  /* ---- 27.2 每日题通关 → 标记必须真的写进存档，而且读得回来 ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    const key = D.dateKey();
    D.gen(12, { daily: true, date: key, quiet: true });
    g.frames(4);
    G.moves = 3; G.par = 99;
    D.levelDone();
    const saved = D.Store.get('daily', null);
    rep.ok('每日挑战完成标记：通关后写进存档的 {date,done} 必须是「今天 + 已完成」，且 dailyDoneToday() 真读得回来',
      D.dailyDoneToday() === true && !!saved && saved.date === key && !!saved.done,
      'dailyDoneToday=' + D.dailyDoneToday() + ' 存档=' + JSON.stringify(saved) + ' 今天=' + key);
  }

  /* ---- 27.3 跨天不认 + done 必须为真（两个比对条件各钉一条） ---- */
  {
    const g = fresh(); const D = g.DBG; const G = enter(g);
    const key = D.dateKey();
    D.gen(12, { daily: true, date: key, quiet: true });
    g.frames(4); G.moves = 3; G.par = 99; D.levelDone();
    const today = D.dailyDoneToday();
    D.Store.data.daily = { date: '2020-01-01', done: 1, stars: 3 };   // 昨天的完成记录
    const stale = D.dailyDoneToday();
    D.Store.data.daily = { date: key, done: 0, stars: 0 };            // 日期对了但没完成
    const notDone = D.dailyDoneToday();
    rep.ok('每日挑战完成标记：昨天的完成记录 / done=0 都不算「今天已完成」（日期与 done 两个条件缺一不可）',
      today === true && stale === false && notDone === false,
      '今天=' + today + ' 换成昨天的date=' + stale + ' 把done改0=' + notDone);
  }
});

/* ============ 28. 魔法清除的「目标选择」语义：只能挑台面 / 同色 / 未接满的瓶子 ============
   §13 只验了「清掉的那杯水倒进同色瓶」的**守恒**，从没验过它**选中了谁**。
   选错目标的后果一样致命，而且守恒断言照样绿：
     · 挑到货架瓶 → 那一杯水被"倒"进了货架瓶，台面上该补的没补；
     · 挑到已接满的瓶子 → fill 超过 cap，瓶子永远收不走（死局）；
     · 挑到异色瓶 → 颜色错位，玩家看到的是「清除把水倒错了地方」。
   构造手法：把**干扰瓶排在合法目标之前**（bottles 的顺序决定 for 循环先碰到谁）——
   三条判定任何一条被删/被放宽，返回的就是干扰瓶。三条判定各配一条独立断言。 */
guard(rep, '清除目标选择', function () {
  const g = fresh(); const D = g.DBG; const G = D.G;
  enter(g);
  /* 造一块干净台面：所有瓶子先设成「一定不满足条件」（异色 + 回货架），
     再由用例只摆「干扰瓶（bottles[0]）+ 合法目标（bottles[1]）」。 */
  function board(setDecoyAndLegal) {
    D.gen(15, { quiet: true });
    g.frames(3);
    G.slots.forEach(s => { s.open = true; });
    const c = G.tubes.filter(t => t.units.length)[0].units[0];
    const N = D.consts().COLORS.length;
    G.bottles.forEach((b, i) => {
      b.col = (c + 7 + i) % N;
      b.place = 'grid'; b.slot = -1; b.fill = 0; b.done = false; b.capT = 0;
    });
    const dcy = G.bottles[0], legal = G.bottles[1];
    setDecoyAndLegal(dcy, legal, c, N);
    D.layoutAll();
    return { c, dcy, legal };
  }
  const who = (B, hit) => (hit === B.legal ? '合法目标' : hit === B.dcy ? '干扰瓶' : String(hit));

  /* 28.1 干扰 = 同色但在货架上（place 判定） */
  {
    const B = board((d, l, c) => {
      d.col = c; d.place = 'grid'; d.fill = 0;
      l.col = c; l.place = 'counter'; l.slot = 0; l.fill = 0;
    });
    const hit = D.clearJarFor(B.c);
    rep.ok('清除目标只挑「台面上」的瓶子：排在合法目标前面的同色货架瓶绝不会被选中',
      hit === B.legal, '选中=' + who(B, hit));
  }

  /* 28.2 干扰 = 已接满的同色瓶（fill<cap 判定） */
  {
    const B = board((d, l, c) => {
      d.col = c; d.place = 'counter'; d.slot = 0; d.fill = d.cap;
      l.col = c; l.place = 'counter'; l.slot = 1; l.fill = 0;
    });
    const hit = D.clearJarFor(B.c);
    rep.ok('清除目标只挑「还没接满」的瓶子：已满（fill==cap）的同色瓶绝不会被选中（否则超容、永远收不走）',
      hit === B.legal, '选中=' + who(B, hit));
  }

  /* 28.3 干扰 = 异色台面瓶（col 判定） */
  {
    const B = board((d, l, c, N) => {
      d.col = (c + 1) % N; d.place = 'counter'; d.slot = 0; d.fill = 0;
      l.col = c; l.place = 'counter'; l.slot = 1; l.fill = 0;
    });
    const hit = D.clearJarFor(B.c);
    rep.ok('清除目标只挑「同色」的瓶子：排在合法目标前面的异色台面瓶绝不会被选中（否则水被倒错颜色）',
      hit === B.legal, '选中=' + who(B, hit));
  }

  /* 28.4 clearTargetExists() 必须与「逐管扫描」的独立实现完全一致 ----
     它是 hintOpts / boardPlayable 判断「清除这个道具此刻能不能用」的唯一依据：
     写成恒 true → 提示条给出一个点了必被拒的按钮；写成恒 false → 明明能用却灰着。
     独立实现这里手写一遍（不调产品函数），这才叫交叉验证而不是自证。 */
  {
    const existsIndep = () => {
      for (const t of G.tubes) {
        if (!t.units.length) continue;
        const col = t.units[0];
        for (const b of G.bottles) {
          if (b.col === col && b.place === 'counter' && b.fill < b.cap) return true;
        }
      }
      return false;
    };
    const bad = [];
    let checks = 0;
    for (let lv = 1; lv <= 30; lv++) for (const tier of [0, 1, 2]) {
      D.gen(lv, { tier: tier, quiet: true });
      g.frames(2);
      checks++;
      const p = D.clearTargetExists(), i2 = existsIndep();
      if (p !== i2) bad.push('L' + lv + 'T' + tier + ' 产品=' + p + ' 独立=' + i2);
    }
    /* 手工补两个极端：有目标 / 无目标。没有这两例，「整批样本天生同值」会让断言退化成恒真。 */
    G.tubes.forEach((t, i) => { t.units = [i % 4]; });
    G.bottles.forEach((b, i) => {
      b.col = i % 4; b.fill = 0;
      if (i < 2) { b.place = 'counter'; b.slot = i; } else { b.place = 'grid'; b.slot = -1; }
    });
    D.layoutAll();
    const hasT = D.clearTargetExists();
    G.bottles.forEach(b => { if (b.place === 'counter') { b.place = 'grid'; b.slot = -1; } });
    D.layoutAll();
    const noT = D.clearTargetExists();
    rep.ok('clearTargetExists() 与「逐管扫描是否存在可接目标」的独立实现完全一致'
      + '（1~30 关 × 3 档 共 ' + checks + ' 次 + 手工构造的「有目标 / 无目标」各 1 例）',
      bad.length === 0 && hasT === true && noT === false,
      (hasT !== true || noT !== false
        ? '手工两例没覆盖到「有/无目标」（has=' + hasT + ' no=' + noT + '）；' : '')
      + bad.slice(0, 4).join(' | '));
  }
});

/* ============ 29. 提示条按钮的「分发」：id 必须走到对应那支分支 ============
   §16 只验了提示条按钮「画在哪、点得到」（hintRects / hintHit），从没验过**点下去走哪条路**。
   分发写错的表现全是「点了 A 却发生了 B」或者「点了没反应」：
     swap / clear 串台 → 想换管却进了清除模式；restart 漏掉 → 点重开没反应；
     unlock / undo 被删 → 提示条给出按钮却什么都不做（比不给按钮还糟，玩家会以为游戏坏了）。 */
guard(rep, '提示条分发', function () {
  const g = fresh(); const D = g.DBG; const G = D.G;
  enter(g);

  /* 29.1 模式类：swap / clear 各自进对应的模式，不串台 */
  {
    D.gen(9, { quiet: true }); g.frames(3);
    D.hintAction('swap');
    const mSwap = G.mode, fSwap = G.swapFirst;
    D.gen(9, { quiet: true }); g.frames(3);
    D.hintAction('clear');
    const mClear = G.mode;
    rep.ok('提示条「随心互换」→ 只进 swap 模式、「魔法清除」→ 只进 clear 模式（两支互不串台）',
      mSwap === 'swap' && fSwap === -1 && mClear === 'clear',
      'swap→mode=' + mSwap + '、clear→mode=' + mClear);
  }

  /* 29.2 重开本关：关卡号不变、步数归零、台面清空 */
  {
    D.gen(9, { quiet: true }); g.frames(3);
    const lv0 = G.level;
    const b = G.bottles.filter(x => x.place === 'grid' && x.gate < 0)[0];
    b.place = 'counter'; b.slot = 0; b.capT = 1; D.layoutAll();
    G.moves = 7;
    const before = G.bottles.filter(x => x.place === 'counter').length;
    D.hintAction('restart');
    const after = G.bottles.filter(x => x.place === 'counter').length;
    rep.ok('提示条「重开本关」→ 重开的确实是**本关**（关卡号不变）、步数归零、台面清空（'
      + before + ' → ' + after + '）',
      G.level === lv0 && G.moves === 0 && after === 0,
      'level ' + lv0 + '→' + G.level + '，moves 7→' + G.moves + '，台面 ' + before + '→' + after);
  }

  /* 29.3 解锁台面：必须真的走 unlockSlot()（开放槽 +1、免费次数 −1、锁定槽 −1） */
  {
    let ok = false, detail = '未找到「有锁定槽 + 有免费解锁次数」的局面';
    for (const lv of [9, 15, 20, 25, 30]) {
      D.gen(lv, { quiet: true }); g.frames(3);
      const locked0 = D.lockedSlots().length;
      if (locked0 <= 0 || G.unlockLeft <= 0) continue;
      const oc0 = D.openSlotCount(), ul0 = G.unlockLeft;
      D.hintAction('unlock');
      const got = [D.openSlotCount() - oc0, ul0 - G.unlockLeft, locked0 - D.lockedSlots().length].join('/');
      ok = got === '1/1/1';
      detail = 'L' + lv + ' 开放槽+1 / 次数−1 / 锁定槽−1 = ' + got;
      break;
    }
    rep.ok('提示条「解锁台面」→ 真的走 unlockSlot()：开放槽 +1、免费解锁次数 −1、锁定槽 −1', ok, detail);
  }

  /* 29.4 撤销：必须真的走 doUndo()（撤销栈 −1、额度 −1），不是空点 */
  {
    D.gen(9, { quiet: true }); g.frames(3);
    G.undoLeft = 5; G.history.length = 0;
    G.moves = 0; D.snapshot();
    const h0 = G.history.length, u0 = G.undoLeft;
    D.hintAction('undo');
    rep.ok('提示条「撤销一瓶」→ 真的走 doUndo()：撤销栈 −1、额度 −1，且提示条自身状态被清掉（不是点了没反应）',
      G.history.length === h0 - 1 && G.undoLeft === u0 - 1 && G.hint === false && G.hintHold === 0,
      '栈 ' + h0 + '→' + G.history.length + '，额度 ' + u0 + '→' + G.undoLeft
      + '，hint=' + G.hint + ' hintHold=' + G.hintHold);
  }
});

/* ============ 30. 胜局判定：最后一个瓶子收走才算赢 ============
   checkAllGone() 是 completeJar() 的收尾调用，也是「通关」这件事的唯一判定点，此前零断言。
   写松（漏了 place 判断）→ 台面还剩一堆瓶子就弹结算页，玩家一脸问号；
   写死 → 清完了却永远不结算（这局白打，比崩溃更气人）。 */
guard(rep, '胜局判定', function () {
  const g = fresh(); const D = g.DBG; const G = D.G;
  enter(g);
  D.gen(15, { quiet: true }); g.frames(3);

  /* 30.1 只收走一半 → 绝不能进 win */
  const alive = G.bottles.filter(b => b.place !== 'gone');
  for (let i = 0; i < Math.floor(alive.length / 2); i++) {
    alive[i].place = 'gone'; alive[i].slot = -1; alive[i].fill = 0;
  }
  const remain = G.bottles.filter(b => b.place !== 'gone').length;
  D.checkAllGone();
  rep.ok('胜局判定：台面/货架上还有 ' + remain + ' 个瓶子时，checkAllGone() 不得判定通关',
    remain > 0 && G.state !== 'win', 'state=' + G.state + ' 剩余瓶子=' + remain);

  /* 30.2 最后一个瓶子也收走 → 必须立刻进 win 并生成结算数据 */
  G.bottles.forEach(b => { b.place = 'gone'; b.slot = -1; b.fill = 0; });
  D.checkAllGone();
  rep.ok('胜局判定：最后一个瓶子收走 → 真的判定通关（state=win 且结算数据 winStats 已生成）',
    G.state === 'win' && !!G.winStats, 'state=' + G.state + ' winStats=' + !!G.winStats);
});

/* ============ 31. 星级读取 starsOf(lv,tier)：档位必须对得上、越界档位落回普通档 ============
   starsOf 是选关面板 / 结算页 / 首页三处共用的一套读法（drawTitle 与 TIER_UI 都直接调它）。
   读错档位的体感是「我困难档明明拿了 2 星，面板上却显示 3 星 / 0 星」。
   另一条是热身档（tier 为负数）：热身只是「这次从哪个难度起步」，
   绝不能凭空点亮困难/极限的星 —— 否则热身就成了刷星捷径。 */
guard(rep, '星级读取', function () {
  const g = fresh(); const D = g.DBG;
  enter(g);
  D.Store.data.stars['9'] = { normal: 3, extreme: 1 };
  rep.ok('星级读取 starsOf：普通/极限两档各读自己那一格；没通关的关一律 0 星',
    D.starsOf(9, 0) === 3 && D.starsOf(9, 1) === 1 && D.starsOf(77, 0) === 0,
    'normal=' + D.starsOf(9, 0) + ' extreme=' + D.starsOf(9, 1)
    + ' 未通关=' + D.starsOf(77, 0));
  rep.ok('星级读取 starsOf：越界/负数档位（热身 −1/−2、脏档 5）一律落回「普通」那一格，不许点亮别的档',
    D.starsOf(9, -1) === 3 && D.starsOf(9, -2) === 3 && D.starsOf(9, 5) === 3,
    'tier−1=' + D.starsOf(9, -1) + ' tier−2=' + D.starsOf(9, -2) + ' tier5=' + D.starsOf(9, 5));
});

rep.done();

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
     一旦某一档的几何越界，抽查不到的关卡会漏掉。所以扩到 1~40 全量。 */
  const g1 = fresh(); enter(g1);
  const D = g1.DBG;
  const missSelf = [], stackWrong = [], missJar = [], badTool = [];
  const LEVELS = []; for (let lv = 1; lv <= 40; lv++) LEVELS.push(lv);
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
  rep.ok('命中回转：点在瓶子身上任意位置（' + probeCount + ' 次探针 / 1~40 关全量取样，'
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

rep.done();

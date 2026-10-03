/* qa_warmup.js —— V6.0 §五-A「已通关关卡的回归热身 + 递进挑战」验收套件
 *
 * 它要回答的问题只有一个：
 *   **玩家长时间没玩之后回来，能不能「保住进度、又不被高难点劝退」？**
 *
 * 产品口径（用户原话）：
 *   · 保留第 15 关进度 → 不退回 14 关、不清空 15 关、不要求重打 1~14 关
 *   · 但第 15 关这次以低难度热身档开始，逐步递进：
 *       热身1 → 热身2 → 正常 → 正常+ → 高难，完成难度恢复
 *   · 本质是**降低「回归门槛」，不是降低长期难度**
 *   · 必须区分两个概念：最高关卡 / 解锁进度（只增不减）  vs  本次挑战难度档位（可低可高）
 *
 * 八条验收（逐条对应，第 5/10/15 关各跑一遍）：
 *   ① 首次进入正常递进（新玩家一路打上来，不会被误判成"回归用户"）
 *   ② 连续游玩不触发回归热身
 *   ③ 模拟长时间未玩后重新进入，仍保留原关卡
 *   ④ 从简单热身档开始（本局确实生成的是更轻的盘）
 *   ⑤ 连续成功后逐档提高难度（热身1 → 热身2 → 正常，爬完即结束）
 *   ⑥ 中途退出再次回来状态正确（走真实 localStorage 往返：write → read → hash 校验 → migrate）
 *   ⑦ localStorage 正确保存最高关卡 / 最近游玩时间 / 当前挑战档位
 *   ⑧ 不丢失玩家进度（星、档位解锁、道具、每日挑战全都在）
 *
 * 另有 4 组工程性断言（防止机制本身写死 / 被悄悄改坏）：
 *   ⑨ 四个配置参数真的生效（returnWarmupEnabled / InactivityThreshold / StartTier / RampStep）
 *   ⑩ 热身只改「本局怎么生成」，绝不写 Store.level / maxLevel
 *   ⑪ 热身通关记到「普通」星位（热身不能变成刷困难/极限星的捷径）
 *   ⑫ 热身局与正常局对比：全维度 ≤、密度严格更低、且仍然可解
 *
 * 用法：node qa_warmup.js
 */
const { loadGame, Reporter, guard } = require('./qa_lib.js');
const rep = new Reporter('warmup');

const H = D => D.warm;                       /* 热身 API 句柄 */
const nowSec = () => Math.floor(Date.now() / 1000);

function boot() {
  const g = loadGame({});
  g.frames(3);
  g.click(360, 640);
  g.frames(5);
  return g;
}

guard(rep, '回归热身', function () {
  const g = boot();
  const D = g.DBG;
  const W = H(D);
  const S = D.Store;
  const CFG = D.CFG;
  const KEY = D.SAVE_KEY;

  /* 每个用例都从「一个打到第 lv 关的老玩家」开始：level / maxLevel / 星 / 档位全都有。
     这样任何一次 Store.reset() 之后的残缺状态都不会被误当成"没丢进度"。 */
  const SEED_STARS = (() => {
    const o = {};
    for (let i = 1; i <= 20; i++) o[String(i)] = { normal: 3, extreme: i >= 10 ? 2 : 0 };
    return o;
  })();
  const SEED_TIERS = { 9: 1, 10: 1, 14: 1, 15: 1 };   // V6.3 两档：0=普通 1=极限

  function seedPlayer(lv, idleSec) {
    S.reset();
    S.data.level = lv;
    S.data.maxLevel = lv;
    S.data.stars = JSON.parse(JSON.stringify(SEED_STARS));
    S.data.tiers = JSON.parse(JSON.stringify(SEED_TIERS));
    S.data.tools = { clear: 1, finger: 2, swap: 0 };
    S.data.undo = 3;
    S.data.daily = { date: '2026-09-30', done: 1, stars: 2 };
    S.data.wins = 41;
    S.data.sessions = 12;
    /* lastPlayed：正数才代表「玩过」。idleSec 为 null 表示"从没玩过的新玩家"。 */
    S.data.lastPlayed = idleSec === null ? 0 : (Date.now() - idleSec * 1000);
    S.data.warmActive = 0; S.data.warmTier = 0; S.data.warmLevel = lv; S.data.warmWins = 0;
    S.save();
    return S;
  }

  /* 两套进度校验，语义不同，别混用：
     · progressEqual —— **这一步没打过任何一局**，所以进度必须一模一样（精确相等）；
     · progressNotLost —— 打过局（通关会 +星/+wins/+关卡），只要求「不退步」。
       把两者分开是因为「通关加了一颗星」不是丢进度，用精确相等反而会把正确的行为判红
       —— 这也正是这条断言第一版假红的原因。 */
  const progressEqual = () => {
    const st = S.get('stars', {});
    for (let i = 1; i <= 20; i++) {
      const a = SEED_STARS[String(i)], b = st[String(i)] || {};
      if ((b.normal || 0) !== a.normal || (b.extreme || 0) !== a.extreme) return false;
    }
    const ti = S.get('tiers', {});
    for (const k of Object.keys(SEED_TIERS)) if (ti[k] !== SEED_TIERS[k]) return false;
    const to = S.get('tools', {});
    return to.clear === 1 && to.finger === 2 && to.swap === 0 &&
      S.get('undo', 0) === 3 && (S.get('daily', {}) || {}).done === 1 &&
      S.get('wins', 0) === 41 && S.get('sessions', 0) === 12;
  };
  const progressNotLost = (seedLv) => {
    const st = S.get('stars', {});
    for (let i = 1; i <= 20; i++) {
      const a = SEED_STARS[String(i)], b = st[String(i)] || {};
      if ((b.normal || 0) < a.normal || (b.extreme || 0) < a.extreme) return false;
    }
    const ti = S.get('tiers', {});
    for (const k of Object.keys(SEED_TIERS)) if ((ti[k] || 0) < SEED_TIERS[k]) return false;
    const to = S.get('tools', {});
    return to.clear >= 1 && to.finger >= 2 && to.swap >= 0 &&
      (S.get('daily', {}) || {}).done >= 1 &&
      S.get('wins', 0) >= 41 && S.get('sessions', 0) >= 12 &&
      S.get('level', 0) >= seedLv && S.get('maxLevel', 0) >= seedLv;
  };

  const LV_SET = [5, 10, 15];
  const THRESH = CFG.returnWarmupInactivityThreshold;
  const LONG_GAP = THRESH + 3600;             /* 「一段时间没玩」= 阈值 + 1 小时 */
  const SHORT_GAP = 90;                       /* 「连续游玩」= 上一局结束 90 秒后又开一局 */

  /* ============================================================
     ① 首次进入正常递进：新玩家从第 1 关一路打到第 15 关，全程都是正常档
     ============================================================ */
  {
    const bad = [];
    S.reset();
    S.data.level = 1; S.data.maxLevel = 1;
    S.data.lastPlayed = Date.now() - SHORT_GAP * 1000;   /* 玩过，但间隔很短 */
    S.save();
    for (let lv = 1; lv <= 15; lv++) {
      S.data.level = lv;
      if (lv > 1) S.data.lastPlayed = Date.now() - SHORT_GAP * 1000;
      S.save();
      W.warmupOnBoot();                                  /* 每次"打开游戏"都要判一次 */
      D.gen(lv);
      if (D.G.tier !== 0 || D.G.warm !== 0) bad.push('L' + lv + ' tier' + D.G.tier + '/warm' + D.G.warm);
    }
    rep.ok('① 首次进入正常递进：连打 1~15 关全程都是普通档（不会被误判为"回归用户"）',
      bad.length === 0, bad.join(' '));
  }

  /* ============================================================
     ② 连续游玩不触发回归热身（第 5 / 10 / 15 关各验一次）
     ============================================================ */
  {
    const bad = [];
    for (const lv of LV_SET) {
      seedPlayer(lv, SHORT_GAP);
      for (let k = 0; k < 3; k++) {                      /* 连玩三把 */
        const r = W.warmupOnBoot();
        if (r !== null) bad.push('L' + lv + ' 第' + (k + 1) + '次误触发');
        S.data.lastPlayed = Date.now() - SHORT_GAP * 1000;
        S.save();
      }
      if (S.get('warmActive', 0) !== 0) bad.push('L' + lv + ' warmActive被置1');
      D.gen(lv);
      if (D.G.tier !== 0) bad.push('L' + lv + ' 生成档位 ' + D.G.tier);
    }
    rep.ok('② 连续游玩不触发回归热身（第 5/10/15 关，连判 3 次都不触发）', bad.length === 0, bad.join(' '));
  }

  /* ============================================================
     ③ 模拟长时间未玩后重新进入，仍保留原关卡（进度不动）
     ④ 从简单热身档开始（本局真的生成更轻的盘）
     ============================================================ */
  {
    const bad3 = [], bad4 = [], badPlan = [];
    for (const lv of LV_SET) {
      seedPlayer(lv, LONG_GAP);
      const r = W.warmupOnBoot();
      /* ③ 关卡进度必须原封不动 */
      if (!r || r.level !== lv) bad3.push('L' + lv + ' 未触发/触发关不对 ' + (r && r.level));
      if (S.get('level', 0) !== lv) bad3.push('L' + lv + ' level 被改成 ' + S.get('level'));
      if (S.get('maxLevel', 0) !== lv) bad3.push('L' + lv + ' maxLevel 被改成 ' + S.get('maxLevel'));
      if (S.get('level', 0) !== lv) bad3.push('L' + lv + ' 进度回退（不存在的倒退）');
      if (!progressEqual()) bad3.push('L' + lv + ' 进度数据被破坏');
      /* ④ 档位必须是「最低的热身档」，且这一局真的按热身档生成 */
      if (W.resolveChallengeTier(lv) !== CFG.returnWarmupStartTier)
        bad4.push('L' + lv + ' 起始档 ' + W.resolveChallengeTier(lv) + ' ≠ ' + CFG.returnWarmupStartTier);
      if (!W.inWarmup(lv)) bad4.push('L' + lv + ' inWarmup=false');
      D.gen(lv);
      if (D.G.tier !== CFG.returnWarmupStartTier || D.G.warm !== 1)
        bad4.push('L' + lv + ' 生成档 ' + D.G.tier + '/warm' + D.G.warm);
      /* 热身盘必须真的更轻（否则「热身」两个字是假的） */
      const wp = D.plan(lv, CFG.returnWarmupStartTier), np = D.plan(lv, 0);
      if (!(wp.density < np.density && wp.colors <= np.colors && wp.tubes <= np.tubes &&
        wp.cells <= np.cells && wp.gates <= np.gates && wp.ice <= np.ice))
        badPlan.push('L' + lv + ' 热身盘不轻：d' + wp.density + ' vs 正常 d' + np.density);
      if (!D.layoutSolvable()) badPlan.push('L' + lv + ' 热身盘不可解');
    }
    rep.ok('③ 长时间未玩后回来：仍停在第 5/10/15 关，进度与星/档位解锁/道具/每日挑战全部无损',
      bad3.length === 0, bad3.join(' '));
    rep.ok('④ 回归后本次挑战从「热身1」（最低档）开始，且这一局生成的确实是更轻的盘',
      bad4.length === 0, bad4.join(' '));
    rep.ok('④-补 热身盘在「密度/颜色/水管/格数/门洞/冰冻」六项上全维度 ≤ 正常盘，且仍然可解',
      badPlan.length === 0, badPlan.join(' '));
  }

  /* ============================================================
     ⑤ 连续成功后逐档提高难度：热身1 → 热身2 → 正常（爬完即结束热身）
     ============================================================ */
  {
    const bad = [], track = [];
    for (const lv of LV_SET) {
      seedPlayer(lv, LONG_GAP);
      W.warmupOnBoot();
      const seq = [];
      let lvl = lv;
      for (let step = 0; step < 3; step++) {
        S.data.level = lvl;
        const t = W.resolveChallengeTier(lvl);
        seq.push(t);
        D.gen(lvl);
        if (D.G.tier !== t) bad.push('L' + lv + ' 第' + step + '步 生成档 ' + D.G.tier + ' ≠ 期望 ' + t);
        if (D.G.warm !== (t < 0 ? 1 : 0)) bad.push('L' + lv + ' 第' + step + '步 warm 标记错');
        D.levelDone();                                   /* 模拟通关这一局 */
        lvl = S.get('level', lvl);                       /* 通关后进度 +1 */
      }
      track.push('L' + lv + '[' + seq.join(',') + ']');
      /* 三步正好爬完：-2 → -1 → 0，且结束时热身已经关闭 */
      if (seq.join(',') !== [CFG.returnWarmupStartTier, CFG.returnWarmupStartTier + 1, 0].join(','))
        bad.push('L' + lv + ' 档位序列 ' + seq.join(','));
      if (S.get('warmActive', 1) !== 0) bad.push('L' + lv + ' 热身未结束');
      if (S.get('warmWins', 0) < 2) bad.push('L' + lv + ' 连续成功次数未累计（' + S.get('warmWins') + '）');
      if (!progressNotLost(lv)) bad.push('L' + lv + ' 进度被破坏');
    }
    rep.ok('⑤ 连续成功后逐档提高：热身1 → 热身2 → 普通，两连胜后热身自动收尾（回到正常难度）',
      bad.length === 0, bad.join(' ') + '　' + track.join(' '));
  }

  /* ============================================================
     ⑥ 中途退出再次回来状态正确（真实 localStorage 往返）
     ============================================================ */
  {
    const bad = [];
    for (const lv of LV_SET) {
      seedPlayer(lv, LONG_GAP);
      W.warmupOnBoot();
      /* 打完第一局（热身1）→ 档位抬到热身2，此时"中途退出游戏"（关页面） */
      D.gen(lv);
      D.levelDone();
      const lvl2 = S.get('level', lv);
      const tierBefore = S.get('warmTier', 0);
      const activeBefore = S.get('warmActive', 0);
      const starsBefore = JSON.stringify(S.get('stars', {}));
      S.save();
      /* 模拟关掉页面再打开：localStorage → 内存（含 hash 校验 + migrate），再跑一次启动判定 */
      S.data = null;
      S.load();
      const again = W.warmupOnBoot();
      if (again !== null) bad.push('L' + lv + ' 二次启动又重置了热身（档位被打回起点）');
      if (S.get('warmActive', 0) !== activeBefore) bad.push('L' + lv + ' warmActive ' + activeBefore + '→' + S.get('warmActive'));
      if (S.get('warmTier', 0) !== tierBefore) bad.push('L' + lv + ' warmTier ' + tierBefore + '→' + S.get('warmTier'));
      if (S.get('warmLevel', 0) !== lvl2) bad.push('L' + lv + ' warmLevel 应跟到 ' + lvl2 + ' 实际 ' + S.get('warmLevel'));
      if (S.get('level', 0) !== lvl2) bad.push('L' + lv + ' level 变了');
      if (JSON.stringify(S.get('stars', {})) !== starsBefore) bad.push('L' + lv + ' 星变了');
      D.gen(lvl2);
      if (D.G.tier !== tierBefore) bad.push('L' + lv + ' 回来后生成档 ' + D.G.tier + ' ≠ ' + tierBefore);
    }
    rep.ok('⑥ 中途退出再回来：热身档位不被重置（继续从热身2 打起）、进度与星完全一致',
      bad.length === 0, bad.join(' '));
  }

  /* ============================================================
     ⑦ localStorage 正确保存 最高关卡 / 最近游玩时间 / 当前挑战档位
     ============================================================ */
  {
    const bad = [];
    seedPlayer(15, LONG_GAP);
    const before = nowSec();
    W.warmupOnBoot();
    const raw = global.localStorage.getItem(KEY);
    let outer = null, body = null;
    try { outer = JSON.parse(raw); } catch (e) { }
    if (!outer || typeof outer.body !== 'string' || typeof outer.sig !== 'number') bad.push('存档不是 {sig,body} 结构');
    else {
      body = JSON.parse(outer.body);
      if (outer.sig !== S.hash(outer.body)) bad.push('校验和不匹配（存档会被判无效）');
      if (body.maxLevel !== 15) bad.push('maxLevel 未落盘：' + body.maxLevel);
      if (body.level !== 15) bad.push('level 未落盘：' + body.level);
      if (!(typeof body.lastPlayed === 'number' && body.lastPlayed >= before * 1000 - 2000))
        bad.push('lastPlayed 未被刷新：' + body.lastPlayed);
      if (body.warmTier !== CFG.returnWarmupStartTier) bad.push('warmTier 未落盘：' + body.warmTier);
      if (body.warmActive !== 1) bad.push('warmActive 未落盘：' + body.warmActive);
      if (body.warmLevel !== 15) bad.push('warmLevel 未落盘：' + body.warmLevel);
      if (body.v !== D.SAVE_VER) bad.push('存档版本号应升到 ' + D.SAVE_VER + '，实际 ' + body.v);
    }
    /* v1 老档（没有 maxLevel/lastPlayed/warm*）必须能安全迁移 */
    const legacy = { v: 1, level: 9, tiers: { 9: 1 }, stars: { "9": { normal: 3, hard: 0, extreme: 0 } },
      tools: { clear: 1, finger: 1, swap: 1 }, undo: 5, daily: { date: '', done: 0, stars: 0 },
      tut: 1, firstOpen: '2026-09-01', lastOpen: '2026-09-20', sessions: 3, wins: 7, failFallback: 0 };
    const lb = JSON.stringify(legacy);
    global.localStorage.setItem(KEY, JSON.stringify({ sig: S.hash(lb), body: lb }));
    S.data = null; S.load();
    const d = S.data;
    if (d.level !== 9) bad.push('迁移丢了 level：' + d.level);
    if (d.maxLevel !== 9) bad.push('迁移应把 maxLevel 补成 level：' + d.maxLevel);
    if (d.lastPlayed !== 0) bad.push('迁移应把 lastPlayed 补成 0（=从没玩过）：' + d.lastPlayed);
    if (d.warmTier !== 0 || d.warmActive !== 0) bad.push('迁移应把热身字段清零');
    if (d.warmLevel < 1) bad.push('迁移应把 warmLevel 补成合法值：' + d.warmLevel);
    if (d.v !== D.SAVE_VER) bad.push('迁移后版本号没升级：' + d.v);
    /* 被手改坏的档：字段类型全错也不许把游戏带崩 */
    const evil = JSON.parse(JSON.stringify(legacy));
    evil.maxLevel = 'x'; evil.lastPlayed = 'y'; evil.warmTier = 99; evil.warmLevel = -5; evil.warmWins = 'z';
    const eb = JSON.stringify(evil);
    global.localStorage.setItem(KEY, JSON.stringify({ sig: S.hash(eb), body: eb }));
    S.data = null; S.load();
    const e2 = S.data;
    if (!(typeof e2.maxLevel === 'number' && e2.maxLevel >= 1)) bad.push('脏 maxLevel 未被修正：' + e2.maxLevel);
    if (!(typeof e2.lastPlayed === 'number' && e2.lastPlayed >= 0)) bad.push('脏 lastPlayed 未被修正：' + e2.lastPlayed);
    if (e2.warmTier > 0) bad.push('warmTier 被手改成正数后没被压回 ≤0：' + e2.warmTier);
    if (!(e2.warmLevel >= 1)) bad.push('warmLevel 被手改成负数后没被修正：' + e2.warmLevel);
    if (!(e2.warmWins >= 0)) bad.push('warmWins 被手改成字符串后没被修正');
    rep.ok('⑦ localStorage 保存 maxLevel / lastPlayed / warmTier（v1 老档能迁移、脏字段被修正、校验和有效）',
      bad.length === 0, bad.join(' '));
  }

  /* ============================================================
     ⑧ 不丢失玩家进度（热身全程不碰任何进度字段）
     ============================================================ */
  {
    const bad = [];
    for (const lv of LV_SET) {
      seedPlayer(lv, LONG_GAP);
      const lvBefore = S.get('level', 0);
      W.warmupOnBoot();
      const afterBoot = { level: S.get('level', 0), maxLevel: S.get('maxLevel', 0) };
      D.gen(lv);
      const G = D.G;
      if (G.level !== lv) bad.push('L' + lv + ' 生成关卡被改');
      D.levelDone();
      if (afterBoot.level !== lvBefore || afterBoot.maxLevel !== lvBefore)
        bad.push('L' + lv + ' 启动判定改了进度 ' + JSON.stringify(afterBoot));
      if (S.get('level', 0) !== lv + 1) bad.push('L' + lv + ' 通关后 level 应到 ' + (lv + 1) + '，实际 ' + S.get('level'));
      if (S.get('maxLevel', 0) < lv) bad.push('L' + lv + ' maxLevel 掉了');
      if (!progressNotLost(lv)) bad.push('L' + lv + ' 进度数据被破坏');
    }
    rep.ok('⑧ 不丢失玩家进度：热身全过程 level / maxLevel / 星 / 档位解锁 / 道具 / 每日挑战零改动',
      bad.length === 0, bad.join(' '));
  }

  /* ============================================================
     ⑨ 四个配置参数真的生效（不是写死的行为）
     ============================================================ */
  {
    const bad = [];
    const save = { en: CFG.returnWarmupEnabled, th: CFG.returnWarmupInactivityThreshold, st: CFG.returnWarmupStartTier, rs: CFG.returnWarmupRampStep };
    try {
      /* (a) 总开关：关掉后行为必须与 V4.0 完全一致（永不触发） */
      CFG.returnWarmupEnabled = false;
      seedPlayer(15, LONG_GAP * 10);
      if (W.warmupOnBoot() !== null) bad.push('关掉总开关仍然触发了');
      D.gen(15);
      if (D.G.tier !== 0 || D.G.warm !== 0) bad.push('关掉总开关后生成档 ' + D.G.tier);
      /* (b) 阈值参数化：不是写死"几天" */
      CFG.returnWarmupEnabled = true;
      CFG.returnWarmupInactivityThreshold = 60;                 /* 1 分钟 */
      seedPlayer(15, 120);                                      /* 2 分钟没玩 → 应触发 */
      if (W.warmupOnBoot() === null) bad.push('阈值 60s、空档 120s 未触发');
      CFG.returnWarmupInactivityThreshold = 3600;               /* 1 小时 */
      seedPlayer(15, 120);                                      /* 2 分钟 → 不应触发 */
      if (W.warmupOnBoot() !== null) bad.push('阈值 3600s、空档 120s 误触发');
      /* (c) 起始档位可配 */
      CFG.returnWarmupInactivityThreshold = 60;
      CFG.returnWarmupStartTier = -1;
      seedPlayer(10, 300);
      W.warmupOnBoot();
      if (W.resolveChallengeTier(10) !== -1) bad.push('起始档改成 -1 后实际 ' + W.resolveChallengeTier(10));
      /* (d) 回升步长可配：一次跳两档直接收尾 */
      CFG.returnWarmupStartTier = -2;
      CFG.returnWarmupRampStep = 2;
      seedPlayer(10, 300);
      W.warmupOnBoot();
      D.gen(10);
      D.levelDone();
      if (S.get('warmActive', 1) !== 0) bad.push('RampStep=2 时应一局收尾');
      /* (e) 新玩家（从没玩过，lastPlayed=0）永远不触发 */
      CFG.returnWarmupRampStep = 1;
      seedPlayer(1, null);
      if (W.warmupOnBoot() !== null) bad.push('全新玩家被误判为回归用户');
    } finally {
      CFG.returnWarmupEnabled = save.en;
      CFG.returnWarmupInactivityThreshold = save.th;
      CFG.returnWarmupStartTier = save.st;
      CFG.returnWarmupRampStep = save.rs;
    }
    rep.ok('⑨ 四个配置参数真的生效（总开关 / 阈值 / 起始档 / 回升步长），且新玩家永不被误判为回归',
      bad.length === 0, bad.join(' '));
  }

  /* ============================================================
     ⑩ 热身只改「本局怎么生成」，绝不碰进度字段
     ============================================================ */
  {
    const bad = [];
    seedPlayer(15, LONG_GAP);
    const snap = JSON.stringify({ level: S.data.level, maxLevel: S.data.maxLevel, wins: S.data.wins, sessions: S.data.sessions });
    W.warmupOnBoot();
    D.gen(15);
    D.gen(14);                       /* 连着换几关，热身也不许写进度 */
    D.gen(13);
    const snap2 = JSON.stringify({ level: S.data.level, maxLevel: S.data.maxLevel, wins: S.data.wins, sessions: S.data.sessions });
    if (snap !== snap2) bad.push('热身期间进度字段被改写 ' + snap + ' → ' + snap2);
    if (W.resolveChallengeTier(14) !== 0) bad.push('换关后热身档还生效（warmLevel 绑定失效）');
    if (W.inWarmup(14)) bad.push('换关后 inWarmup 仍为 true');
    rep.ok('⑩ 热身严格绑定在「当前这一关」：换关即失效，且全程不写 level / maxLevel',
      bad.length === 0, bad.join(' '));
  }

  /* ============================================================
     ⑪ 热身通关记到「普通」星位（不能变成刷困难/极限星的捷径）
     ============================================================ */
  {
    const bad = [];
    seedPlayer(15, LONG_GAP);
    W.warmupOnBoot();
    D.gen(15);
    D.levelDone();
    const rec = (S.get('stars', {}) || {})['15'] || {};
    const before = SEED_STARS['15'];
    if ((rec.extreme || 0) !== before.extreme) bad.push('热身通关动了极限星：' + before.extreme + '→' + rec.extreme);
    if (!((rec.normal || 0) >= before.normal)) bad.push('普通星没被记录：' + rec.normal);
    const t = (S.get('tiers', {}) || {})['15'];
    if (t !== SEED_TIERS[15]) bad.push('热身通关改了档位解锁进度：' + SEED_TIERS[15] + '→' + t);
    rep.ok('⑪ 热身通关只记「普通」星位，不解锁极限（热身不是刷星捷径）', bad.length === 0, bad.join(' '));
  }

  /* ============================================================
     ⑫ 三档挑战与热身互不干扰（显式指定档位时以它为准）
     ============================================================ */
  {
    const bad = [];
    seedPlayer(15, LONG_GAP);
    W.warmupOnBoot();
    for (const t of [0, 1, 2]) {
      D.gen(15, { tier: t });
      if (D.G.tier !== t) bad.push('显式 tier=' + t + ' 被热身覆盖成 ' + D.G.tier);
      if (D.G.warm !== 0) bad.push('显式 tier=' + t + ' 时仍打了热身标记');
    }
    /* 每日挑战固定种子：不允许叠热身（否则"全球同题"就不成立了） */
    D.gen(15, { seed: 20261001, daily: true, date: '2026-10-01' });
    if (D.G.tier !== 0 || D.G.warm !== 0) bad.push('每日挑战被叠加了热身：' + D.G.tier + '/' + D.G.warm);
    rep.ok('⑫ 显式指定档位 / 每日挑战固定种子时，热身不参与（热身只作用于"打开游戏默认进的那一关"）',
      bad.length === 0, bad.join(' '));
  }

  /* ============================================================
     附：档位标签（结算页要显示「热身1 / 热身2 / 普通」）
     ============================================================ */
  {
    const labels = [-2, -1, 0, 1, 2].map(function (t) { return W.tierLabel(t); });
    rep.ok('档位标签可读：-2/ -1 分别显示为「热身1」「热身2」，0/1/2 走原挑战档名',
      labels[0].indexOf('热身1') === 0 && labels[1].indexOf('热身2') === 0 &&
      labels[2] !== labels[3] && labels[3] !== labels[4], JSON.stringify(labels));
  }
});

rep.done();

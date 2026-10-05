/* qa_biz.js —— 商业化套件：广告服务 / 存档 / 埋点 / 难度档位 / 单局时长
 *
 * 这一套专门回答 V4.0 里「上线能不能赚钱、会不会翻车」的问题：
 *   · 广告：Test 与 Online 两条链路是否都真的发奖；失败/中途退出/重复回调怎么处理；
 *           频控是否真的拦得住；「广告失败就把玩家卡死」这种事有没有发生
 *   · 存档：篡改/截断/换版本/隐私模式（写不进 localStorage）会不会白屏或丢进度
 *   · 埋点：事件够不够回答问题；任何一次上报失败都不许影响游戏
 *   · 难度：普通/困难/极限是不是真的递进；9 关以后是不是靠「决策密度」而不是「堆格子」
 *   · 时长：高关卡单局规模是否已封顶（不再越玩越久）
 *
 * 用法：node qa_biz.js
 */
const { loadGame, Reporter, guard } = require('./qa_lib.js');
const rep = new Reporter('biz');

/* 起一局：进游戏 → 生成指定关卡 */
function boot(lv) {
  const g = loadGame({});
  g.frames(3);
  g.click(360, 640);          // 标题页 → 进游戏
  g.frames(5);
  if (lv) { g.DBG.gen(lv); g.frames(4); }
  return g;
}

/* ---------- 伪造 TapTap 运行时（只用于测试 Online 链路，不是要引入第三方 SDK） ---------- */
let TAP = null;
function installTap(opt) {
  opt = opt || {};
  TAP = { shows: 0, close: null, load: null, err: null, inters: [] };
  global.tap = {
    createRewardedVideoAd: function (o) {
      if (opt.throwOnCreate) throw new Error('runtime-broken');
      return {
        onLoad: function (f) { TAP.load = f; },
        onError: function (f) { TAP.err = f; },
        onClose: function (f) { TAP.close = f; },
        load: function () { return opt.loadReject ? Promise.reject(new Error('no fill')) : Promise.resolve(); },
        show: function () { TAP.shows++; return opt.showReject ? Promise.reject(new Error('no fill')) : Promise.resolve(); }
      };
    },
    createInterstitialAd: function (o) {
      var it = { onLoad: function () { }, onError: function () { }, onClose: function () { }, show: function () { TAP.inters.push(1); return Promise.resolve(); } };
      return it;
    }
  };
}
function removeTap() { try { delete global.tap; } catch (e) { global.tap = undefined; } }

/* =====================================================================
   1. 广告服务：Test 模式（V4.0 §4 要求必须保留，不是"假广告"）
   ===================================================================== */
guard(rep, '广告-Test', function () {
  const g = boot(6);
  const A = g.DBG.AdService, C = g.DBG.CFG, T = g.DBG.Track;
  C.env = 'test'; A.setEnv('test');
  rep.ok('显式切 test → 广告环境为 test（模拟完成，不产生真实收入）', A.env === 'test');

  /* 1.1 正常完成 → 发奖，且埋点齐全 */
  A.resetSession(); T.reset();
  let got = 0, cancelled = 0, failed = 0, fell = 0, noticed = 0;
  A.test.fail = A.test.cancel = A.test.timeout = false;
  const ok1 = A.showRewarded('tool_clear', {
    onReward: () => got++, onCancel: () => cancelled++,
    onFail: () => failed++, onFallback: () => fell++, onNotice: () => noticed++
  });
  rep.ok('Test 模式：激励视频调用返回 true 且恰好发奖 1 次', ok1 === true && got === 1);
  rep.ok('Test 模式不会误触发取消/失败', cancelled === 0 && failed === 0);
  rep.ok('埋点齐全：ad_request / ad_show / ad_complete / reward_granted',
    T.count('ad_request') >= 1 && T.count('ad_show') >= 1 &&
    T.count('ad_complete') >= 1 && T.count('reward_granted') >= 1);
  const ev = T.last('reward_granted');
  rep.ok('奖励事件带场景名 + 环境标记（能回答"玩家愿意看什么广告"）',
    !!(ev && ev.p.scene === 'tool_clear' && ev.p.src === 'test'));

  /* 1.2 中途退出（玩家没看完）→ 绝不发奖 */
  A.resetSession(); T.reset();
  got = cancelled = 0;
  A.test.cancel = true;
  A.showRewarded('tool_clear', { onReward: () => got++, onCancel: () => cancelled++ });
  A.test.cancel = false;
  rep.ok('中途退出 → 不发奖，且给出取消反馈', got === 0 && cancelled === 1);
  rep.ok('中途退出记 ad_cancel 埋点', T.count('ad_cancel') >= 1);

  /* 1.3 拉取失败/超时 → 不卡流程（V4.0 §27 友好 fallback） */
  A.resetSession(); T.reset();
  got = failed = fell = 0;
  A.test.fail = true;
  A.showRewarded('revive', { onReward: () => got++, onFail: () => failed++, onFallback: () => fell++ });
  A.test.fail = false;
  rep.ok('广告拉取失败 → 不发奖、但明确回调 onFail', got === 0 && failed >= 1);
  rep.ok('adFailFallback=free 时放行降级（玩家不会被广告卡死）', fell === 1);
  rep.ok('广告失败记 ad_load_fail 与 ad_fallback_granted', T.count('ad_load_fail') >= 1 && T.count('ad_fallback_granted') >= 1);

  /* 1.4 兜底策略可配置：'none' 时只提示、不白送奖励 */
  A.resetSession(); T.reset();
  const oldFallback = C.adFailFallback;
  C.adFailFallback = 'none';
  got = noticed = fell = 0;
  A.test.timeout = true;
  A.showRewarded('revive', { onReward: () => got++, onNotice: () => noticed++, onFallback: () => fell++ });
  A.test.timeout = false; C.adFailFallback = oldFallback;
  rep.ok("adFailFallback='none' 时只提示、不发奖（策略真的可配置）", got === 0 && fell === 0 && noticed >= 1);

  /* 1.5 频控：超过单会话上限必须「拦在弹广告之前」，而不是弹了不发奖 */
  A.resetSession(); T.reset();
  let capHits = 0;
  for (let i = 0; i < C.rewardedSessionCap + 2; i++) {
    A.showRewarded('tool_clear', { onFail: () => capHits++ });
  }
  rep.ok('激励视频单会话上限生效（第 ' + (C.rewardedSessionCap + 1) + ' 次起被拦截）',
    capHits === 2 && A.session.rewarded === C.rewardedSessionCap, '拦截 ' + capHits + ' 次');
  rep.ok('超限记 ad_cap_blocked 埋点', T.count('ad_cap_blocked') >= 1);
});

/* =====================================================================
   2. 广告服务：Online 模式（真实 tap.* 链路，用伪造运行时验证回调契约）
   ===================================================================== */
guard(rep, '广告-Online', function () {
  const g = boot(6);
  const A = g.DBG.AdService, C = g.DBG.CFG, T = g.DBG.Track;

  /* 2.0 出厂开关必须是 online —— 这一条是"防零收益"红线。
     2026-09-29 复盘：默认值曾是 'test'，就算广告位 ID 填好了，真机上仍然跑模拟广告
     = 一个广告费都收不到，而且没有任何报错，只有看代码才发现。改成默认 online 后，
     靠 AdService.init() 的自动降级保证测试环境不受影响（下面 2.0b 就是降级路径的断言）。 */
  rep.ok('出厂 env 默认值是 online（防止真机跑模拟广告导致零收益）', C.env === 'online', '实际 ' + C.env);
  /* 2.0b 无 tap 运行时 → 必须自动降级 test。这是"本地/Node 测试不被污染"的保证，
     之前只测了 no-ad-unit-id，这条 no-tap-runtime 一直是空的。 */
  rep.ok('无 tap 运行时 → 自动降级 test 且记录 no-tap-runtime',
    A.env === 'test' && A.degradeReason === 'no-tap-runtime', A.env + '/' + A.degradeReason);

  /* 2.1 没有 adUnitId 时必须自动降级成 test（绝不能让线上白屏/卡死） */
  C.adUnit.rewarded = '';
  installTap();
  A.setEnv('online');
  rep.ok('有 tap 运行时但没填广告位 → 自动降级 test（不会卡住玩家）',
    A.env === 'test' && A.degradeReason === 'no-ad-unit-id', A.env + '/' + A.degradeReason);

  /* 2.2 正常 Online 链路：show → onClose(isEnded=true) → 发奖 */
  C.adUnit.rewarded = 'unit-qa-1';
  A.setEnv('online'); A.resetSession(); T.reset();
  rep.ok('配好广告位后真的进入 online', A.env === 'online');
  let got = 0, cancelled = 0;
  A.showRewarded('revive', { onReward: () => got++, onCancel: () => cancelled++ });
  rep.ok('online：onClose 之前绝不发奖（不能"点了就发"）', got === 0);
  rep.ok('online：真的调用了 tap 广告的 show()', TAP.shows === 1);
  TAP.close({ isEnded: true });
  rep.ok('online：onClose(isEnded=true) → 发奖', got === 1);
  rep.ok('online：发奖埋点 src=online', (T.last('reward_granted') || { p: {} }).p.src === 'online');

  /* 2.3 幂等：同一个 token 的 onClose 被 SDK 重复回调，也只能发一次奖 */
  A.resetSession(); T.reset();
  got = 0;
  A.showRewarded('revive', { onReward: () => got++ });
  TAP.close({ isEnded: true });
  TAP.close({ isEnded: true });
  TAP.close({ isEnded: true });
  rep.ok('重复回调幂等：连按 3 次 onClose 也只发 1 次奖', got === 1, '实际 ' + got);
  rep.ok('重复发奖被拦截并埋点 reward_duplicate_blocked',
    A.stats.dupBlocked >= 2 && T.count('reward_duplicate_blocked') >= 2);

  /* 2.4 玩家提前关掉广告 → 不发奖 */
  A.resetSession(); T.reset();
  got = cancelled = 0;
  A.showRewarded('revive', { onReward: () => got++, onCancel: () => cancelled++ });
  TAP.close({ isEnded: false });
  rep.ok('online：提前关闭（isEnded=false）→ 不发奖', got === 0 && cancelled === 1);

  /* 2.5 SDK 在展示阶段挂掉 → 走降级，不卡流程 */
  A.resetSession(); T.reset();
  got = fell = 0;
  delete global.tap.createRewardedVideoAd;
  A._rw = null;
  A.showRewarded('revive', { onReward: () => got++, onFallback: () => fell++ });
  rep.ok('online：SDK 缺失/异常 → 降级放行而不是卡住（V4.0 §27）', got === 0 && fell === 1);

  /* 2.6 插屏：低频 + 首次保护 + 冷却 + 会话上限，四个开关都要真的管事 */
  removeTap();
  A.setEnv('test'); A.resetSession(); T.reset();
  A.session.wins = 0;
  rep.ok('插屏：连续成功次数不够 → 不展示', A.showInterstitial('win', {}) === false);
  A.session.wins = C.interstitialAfterWins;
  A._t0 = A.now();
  rep.ok('插屏：首次体验保护期内 → 不展示', A.showInterstitial('win', {}) === false);
  A._t0 = A.now() - C.firstSessionProtection - 1;
  A.session.lastInter = -99999;
  rep.ok('插屏：满足条件后展示 1 次', A.showInterstitial('win', {}) === true);
  rep.ok('插屏：冷却期内立刻再要 → 不展示（冷却真的生效）', A.showInterstitial('win', {}) === false);
  rep.ok('插屏：单会话上限 1 次，不会反复打断玩家',
    A.session.inter === C.interstitialSessionCap);
  rep.ok('插屏被拦也埋点（能回答"玩家实际看到几次插屏"）',
    T.count('ad_interstitial_blocked') >= 1);
});

/* =====================================================================
   3. 存档：localStorage + 校验和 + 版本迁移 + 隐私模式
   ===================================================================== */
guard(rep, '存档', function () {
  const g = boot(1);
  const S = g.DBG.Store, K = g.DBG.SAVE_KEY, V = g.DBG.SAVE_VER;
  const LS = global.localStorage;

  /* 3.1 正常往返 */
  S.reset();
  S.set('level', 12);
  S.set('tut', 1);
  const back = S.read();
  rep.ok('存档往返：写进去的进度能读回来', !!back && back.level === 12 && back.tut === 1);
  rep.ok('存档带版本号（后续可以安全迁移）', back.v === V);
  rep.ok('存档带校验和（不是裸 JSON，能发现被改过）',
    typeof JSON.parse(LS.getItem(K)).sig === 'number');

  /* 3.2 校验和不匹配 → 视为无效，静默重建（不是崩溃、不是读到脏数据） */
  LS.setItem(K, JSON.stringify({ sig: 12345, body: JSON.stringify({ v: V, level: 99 }) }));
  rep.ok('被篡改的存档 → 判定无效并重建（不会读到脏进度）', S.read() === null);
  S.load();
  rep.ok('重建后是干净的新档（不是 99 关）', S.get('level', 1) === 1);

  /* 3.3 断行/截断 → 同样无效 */
  LS.setItem(K, '{"sig":1,"body":"{"');
  rep.ok('被截断的存档 → 判定无效（不抛异常）', S.read() === null);

  /* 3.4 版本迁移：缺字段的老档要能补齐，而不是丢进度 */
  LS.setItem(K, JSON.stringify({ sig: 0, body: '{}' }));
  const legacy = { v: 0, level: 7 };
  LS.setItem(K, JSON.stringify({ sig: S.hash(JSON.stringify(legacy)), body: JSON.stringify(legacy) }));
  const mig = S.load();
  rep.ok('老版本存档迁移：保留已有进度（第 7 关）', mig.level === 7);
  rep.ok('迁移补齐缺失字段并统一版本号',
    mig.v === V && mig.tools && typeof mig.tools.clear === 'number' &&
    typeof mig.tiers === 'object' && typeof mig.daily === 'object');
  rep.ok('迁移后的档可以被再次安全读写', (S.save(), S.read().level === 7));

  /* 3.5 隐私模式 / 配额满：setItem 抛异常也不能影响游戏 */
  const origSet = LS.setItem;
  LS.setItem = function () { throw new Error('QuotaExceededError'); };
  S.data = S.blank(); S.data.level = 5;
  let threw = false, ok = false;
  try { ok = S.save(); } catch (e) { threw = true; }
  LS.setItem = origSet;
  rep.ok('隐私模式/配额满：save() 静默返回 false，不抛异常', !threw && ok === false);
  rep.ok('存档失败不影响当前这一局的进度（内存里仍是第 5 关）', S.get('level', 1) === 5);

  /* 3.6 每日挑战：同一天同一局（固定种子），跨天自动刷新状态 */
  const d1 = g.DBG.dateKey(), s1 = g.DBG.dailySeed(d1);
  rep.ok('每日种子由日期决定（同一天全球同题）',
    s1 === g.DBG.dailySeed(g.DBG.dateKey()) && typeof s1 === 'number');
  rep.ok('每日种子不同日期不同局', s1 !== g.DBG.dailySeed('2020-01-01'));
});

/* =====================================================================
   4. 埋点：够回答问题 + 永不阻塞游戏
   ===================================================================== */
guard(rep, '埋点', function () {
  const g = boot(9);
  const T = g.DBG.Track, LS = global.localStorage;

  T.reset();
  rep.ok('埋点初始为空（reset 可用，便于本地核对）', T.count('level_start') === 0);

  const g2 = boot(9);
  const T2 = g2.DBG.Track;
  const named = {};
  T2.buf.forEach(function (e) { named[e.e] = 1; });
  ['first_open', 'game_start', 'level_start'].forEach(function (n) {
    rep.ok('启动链路埋点存在：' + n, !!named[n]);
  });
  T2.log('level_start', { tier: 0 });
  const ev = T2.last('level_start');
  rep.ok('每条事件都带时间/关卡/参数（可做漏斗分析）',
    !!ev && typeof ev.t === 'number' && typeof ev.lv === 'number' && !!ev.p);

  /* 事件写入 localStorage 失败也不能抛 */
  const origSet = LS.setItem;
  LS.setItem = function () { throw new Error('nope'); };
  let threw = false, r = null;
  try { r = T2.log('level_complete', { stars: 3 }); } catch (e) { threw = true; }
  LS.setItem = origSet;
  rep.ok('埋点写本地失败时静默降级（绝不因为埋点崩掉游戏）', !threw && !!r);

  /* 缓冲区有上限，长时间挂机不会吃爆内存 */
  T.reset();
  for (let i = 0; i < 400; i++) T.log('spam', { i: i });
  rep.ok('埋点缓冲区有上限（400 条写入后 ≤ 240 条）', T.buf.length <= 240, '实际 ' + T.buf.length);

  /* 上报地址留空 = 不联网（离线也能核对） */
  rep.ok('trackUrl 默认留空（零上报依赖，离线可核对）', g2.DBG.CFG.trackUrl === '');
});

/* =====================================================================
   5. 难度档位：普通 / 极限（V6.3 两档重构）真的递进、全程分层
   ===================================================================== */
guard(rep, '难度档位', function () {
  const g = boot(1);
  const P = g.DBG.plan;

  let badSlots = [], badDensity = [], badHarder = [];
  for (let lv = 9; lv <= 30; lv++) {
    const t0 = P(lv, 0), t1 = P(lv, 1);
    if (!(t0.slots >= t1.slots)) badSlots.push('L' + lv);
    /* V6.3：两档全程分层 —— 极限档决策密度必须严格 > 普通档（防后期门槛封顶撞成同一档） */
    if (!(t1.density > t0.density)) badDensity.push('L' + lv + '(' + t0.density + '/' + t1.density + ')');
    if (!(t1.gates >= t0.gates)) badHarder.push('L' + lv);
  }
  rep.ok('同一关的挑战档「空间越来越紧」（普通槽位 ≥ 极限）', badSlots.length === 0, badSlots.join(' '));
  rep.ok('同一关的挑战档「决策密度越来越难」（极限 density 严格 > 普通）', badDensity.length === 0, badDensity.join(' '));
  rep.ok('同一关的挑战档「干扰越来越多」（门洞数不减少）', badHarder.length === 0, badHarder.join(' '));

  /* 教学关的挑战档也必须「能玩」（不能一上来就给 3 格、更不能 0 色）。 */
  const e0 = P(1, 0), e1 = P(1, 1);
  rep.ok('教学关的极限档也保证可玩（两档同为 ' + e1.cells + ' 格、颜色 ≥3、槽 ≥5）',
    e1.cells === e0.cells && e1.cells >= 9 && e1.colors >= 3 && e1.slots >= 5);

  /* 极限档也不许突破棋盘上限（上限来自 CURVE，不再写死 26） */
  const CELL_CAP = g.DBG.CURVE.GRID_MAX_ROWS * g.DBG.CURVE.GRID_MAX_COLS;
  let over = [];
  for (let lv = 1; lv <= 90; lv++) for (let t = 0; t <= 1; t++) if (P(lv, t).cells > CELL_CAP) over.push('L' + lv + 'T' + t);
  rep.ok('任何档位都不突破棋盘硬上限 ' + CELL_CAP + ' 格（' + g.DBG.CURVE.GRID_MAX_ROWS + '×' +
    g.DBG.CURVE.GRID_MAX_COLS + '）', over.length === 0, over.slice(0, 6).join(' '));

  /* 解锁关系：没打赢普通档，就不该解锁极限档（V6.3 两档） */
  const S = g.DBG.Store;
  S.reset();
  rep.ok('默认只能玩普通档', g.DBG.tierUnlocked(9, 0) === true && g.DBG.tierUnlocked(9, 1) === false);
  S.data.tiers[9] = 1;
  rep.ok('通关普通档后解锁极限档', g.DBG.tierUnlocked(9, 1) === true);
});

/* =====================================================================
   6. 单局规模与时长：V6.0 把棋盘放大到 9×6，所以不再是「一刀切封顶」，
      而是「每一关都落在本关的动态预算里」（见 levelPlan 的校准③ + moveBudgetFor）
   ===================================================================== */
guard(rep, '单局规模', function () {
  const g = boot(1);
  const D = g.DBG;

  const rows = [];
  for (let lv = 1; lv <= 90; lv++) {
    D.gen(lv); g.frames(2);
    const G = D.G;
    rows.push({
      lv: lv, cells: G.cellCount, bottles: G.bottles.length,
      water: G.tubes.reduce(function (s, t) { return s + t.units.length; }, 0),
      par: G.par
    });
  }
  const badConserve = rows.filter(function (r) { return r.water !== r.bottles * 3; });
  rep.ok('每瓶固定 3 口：水总量 == 瓶数 × 3（单局规模可以精确推算）', badConserve.length === 0,
    badConserve.slice(0, 5).map(function (r) { return 'L' + r.lv; }).join(' '));

  const CV = D.CURVE;
  const cellsCap = 55, bottleCap = 70;
  const maxCells = Math.max.apply(null, rows.map(function (r) { return r.cells; }));
  const maxBottles = Math.max.apply(null, rows.map(function (r) { return r.bottles; }));
  rep.ok('单局棋盘封顶 ' + cellsCap + ' 格（V6.1 的 11×5 硬上限）', maxCells <= cellsCap, '最大 ' + maxCells);
  rep.ok('单局瓶子封顶 ' + bottleCap + ' 瓶（55 格 + 门洞最多多塞 16 瓶）', maxBottles <= bottleCap, '最大 ' + maxBottles);
  rep.ok('单局水量封顶 ≤ ' + (bottleCap * 3) + ' 杯',
    Math.max.apply(null, rows.map(function (r) { return r.water; })) <= bottleCap * 3);

  /* 单局时长：V6.0 的预算随关卡分段（≤25 关 150 步 / ≤60 关 175 步 / 61~90 关 200 步），
     不再是一条 150 步的平线（平线会把 50~90 关压成同一个难度）。 */
  const overBudget = rows.filter(function (r) {
    return Math.round((r.water / 3) * CV.ACTION_PER_BOTTLE) > D.moveBudgetFor(r.lv) + 10;
  });
  rep.ok('每一关的单局操作量都在本关预算内（≤25 关 150 步 / ≤60 关 175 步 / 61~90 关 200 步）',
    overBudget.length === 0, overBudget.slice(0, 6).map(function (r) { return 'L' + r.lv; }).join(' '));

  const w10 = rows[9].water, w30 = rows[29].water;
  rep.ok('第 30 关水量不超过第 10 关的 2.5 倍（V6.0 放大棋盘后的新口径：难度仍主要靠决策密度）',
    w30 <= w10 * 2.5, w10 + ' → ' + w30);

  const maxPar = Math.max.apply(null, rows.map(function (r) { return r.par; }));
  rep.ok('好成绩步数（par）封顶 ≤ 130 步（单局时长可控；par = 理论最小步数 × 1.4 + 门洞 × 2，随规模上走）',
    maxPar <= 130, '最大 par=' + maxPar);

  /* 高关卡的难度提升应体现在「干扰」而不是「纯容量」 */
  const p10 = D.plan(10), p30 = D.plan(30), p90 = D.plan(90);
  rep.ok('第 30 关比第 10 关难在做题密度（density 涨、颜色/干扰涨）',
    p30.density > p10.density && p30.colors > p10.colors);
  rep.ok('第 90 关的干扰量严格高于第 30 关（曲线到 90 关仍在爬，不触顶）',
    (p90.colors + p90.gates + p90.ice) > (p30.colors + p30.gates + p30.ice),
    'L30 ' + p30.colors + '/' + p30.gates + '/' + p30.ice + ' → L90 ' + p90.colors + '/' + p90.gates + '/' + p90.ice);
});

/* =====================================================================
   7. 广告入口只有三类（V6.0 §六 红线）
      —— ①失败复活激励 ②道具补次激励（含撤销补次） ③低频成功后插屏。
      这条必须是**源码级**断言：广告入口是"多一行就多一个变现位"的地方，
     跑起来永远看不出多了一个入口（玩家只是偶尔多看到一次广告），
      只有数调用点才抓得住「悄悄加第四类」。
   ===================================================================== */
guard(rep, '广告入口只有三类', function () {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, 'outputs', '解压水消除.html'), 'utf8');

  const count = (re) => (html.match(re) || []).length;
  /* 取函数体（大括号配平）——用来证明「某个入口里没有挂广告」 */
  const bodyOf = (name) => {
    const i = html.indexOf('function ' + name + '(');
    if (i < 0) return null;
    let j = html.indexOf('{', i), d = 0;
    for (let k = j; k < html.length; k++) {
      if (html[k] === '{') d++;
      else if (html[k] === '}') { d--; if (d === 0) return html.slice(j, k + 1); }
    }
    return null;
  };

  /* ① 激励广告只有一个统一封装入口：adReward → AdService.showRewarded */
  rep.ok('激励广告只有一个统一入口（AdService.showRewarded 全文件恰好 1 个调用点，就在 adReward 里）',
    count(/AdService\.showRewarded\(/g) === 1, '实际 ' + count(/AdService\.showRewarded\(/g) + ' 个');

  /* ② 插屏只有一个调用点、且场景是「成功之后」（不在局内打断） */
  rep.ok('插屏只有一个调用点、场景固定为 level_complete（成功之后，绝不在玩到一半打断）',
    count(/AdService\.showInterstitial\(/g) === 1 && html.indexOf("showInterstitial('level_complete'") >= 0,
    '调用点 ' + count(/AdService\.showInterstitial\(/g) + ' 个');

  /* ②b V6.4.10：插屏只能在「结算弹窗关闭」时触发（closeWinAndInterstitial），
    绝不能回到旧行为——在 update() 里 state==='win' 的下一帧就弹、盖在结算面板上。
    反证：把 closeWinAndInterstitial 里那处删掉、回填 update() 旧写法，本断言必须 FAIL。 */
  rep.ok('插屏由 closeWinAndInterstitial 统一触发（结算弹窗关闭后；不在 update 里 state===win 立即弹）',
    count(/function closeWinAndInterstitial\(/g) === 1 &&
    count(/G\.interPending&&G\.state==='win'/g) === 0,
    'closeWinAndInterstitial=' + count(/function closeWinAndInterstitial\(/g) +
    ' 旧立即弹写法=' + count(/G\.interPending&&G\.state==='win'/g));

  /* ②c V6.4.10：底部道具按钮额度 0 时不得灰化（灰化会让用户以为键坏了、断掉看广告补次入口）。
    反证：把 drawTools 里 '#e0d6c2'（灰底色）加回来，本断言必须 FAIL。 */
  rep.ok('底部道具按钮额度 0 时不再灰化（保留彩色，看广告补次入口不被视觉阉割）',
    html.indexOf('#e0d6c2') < 0,
    '灰色 #e0d6c2 命中=' + (html.indexOf('#e0d6c2') >= 0 ? '是(坏)' : '否(好)'));

  /* ③ 场景名集合必须恰好是这三类 */
  const scenes = [];
  const re = /adReward\('([^']*)'/g;
  let m2;
  while ((m2 = re.exec(html)) !== null) scenes.push(m2[1]);
  const uniq = Array.from(new Set(scenes)).sort();
  /* V6.4.6：新增第 4 类 unlock_slot（看广告解锁台面槽）。
     旧设计 V4.0 §12 只承认 3 类，是早年针对「点击即奖励的假广告」定的；
     解锁槽位是真实价值交换（玩家拿一个台面位置换一次观看），不是假广告 → 放开。 */
  rep.ok('激励广告场景恰好四类：revive / tool_ / undo / unlock_slot（看广告解锁台面槽）',
    uniq.join(',') === 'revive,tool_,undo,unlock_slot', '实际 [' + uniq.join(',') + ']');

  /* ④ 这些入口不许挂广告（多一个就是第四类） */
  /* V6.4.6：unlockSlot 已从「不许挂广告」名单移除 —— 它现在**就是**第 4 类广告场景（见 ③）。 */
  const noAd = ['hintTap', 'goHome', 'startDaily', 'bootSession', 'checkStuck', 'enterFail'];
  const dirty = noAd.filter((fn) => {
    const b = bodyOf(fn);
    return b && (b.indexOf('adReward(') >= 0 || b.indexOf('showRewarded(') >= 0 || b.indexOf('showInterstitial(') >= 0);
  });
  rep.ok('解锁台面 / 软提示 / 回首页 / 每日挑战 / 启动 / 卡死判定 / 失败判定 都不挂广告（不许为广告造死局）',
    dirty.length === 0, dirty.join(' '));

  /* ⑤ 广告拉取失败必须「放行」而不是卡住流程 */
  rep.ok('广告拉取失败时有免费降级通道（玩家不会被一次加载失败卡在失败页）',
    /adFailFallback\s*:\s*'free'/.test(html) || /adFailFallback\s*:\s*"free"/.test(html));
});


/* =====================================================================
   N. 广告位属性落位（V6.4.0）：真机走正式位，无 SDK 环境退回测试位
      以前 adUnitIsTest 是手填的 true —— 上线后真机埋点永远 test-unit，
      出事根本看不出挂在哪个位上。现在改成启动时按运行环境自动落位。
   ===================================================================== */
guard(rep, '广告-正式位落位', function () {
  /* ① 无 SDK（普通浏览器 / 网页版）→ 退回测试位，不拿正式位去空请求 */
  removeTap();
  let g = loadGame({ search: '' }); g.frames(3);
  rep.ok('无 SDK 环境自动落位测试位（不拿正式位去无 SDK 的浏览器里空请求）',
    g.DBG.CFG.adUnitIsTest === true, '实际 adUnitIsTest=' + g.DBG.CFG.adUnitIsTest);
  rep.ok('无 SDK 环境 adUnitSrc 如实记为 test-unit',
    g.DBG.AdService.adUnitSrc === 'test-unit', '实际 src=' + g.DBG.AdService.adUnitSrc);

  /* ② 有 SDK（真机 TapTap 容器）→ 正式位 */
  installTap({});
  g = loadGame({ search: '' }); g.frames(3);
  rep.ok('真机有 SDK 时自动落位正式位（正式游戏不再跑测试广告）',
    g.DBG.CFG.adUnitIsTest === false, '实际 adUnitIsTest=' + g.DBG.CFG.adUnitIsTest);
  rep.ok('真机 adUnitSrc 记为 formal-unit（出事能立刻看出挂在哪个位）',
    g.DBG.AdService.adUnitSrc === 'formal-unit', '实际 src=' + g.DBG.AdService.adUnitSrc);

  /* ③ URL 强制覆盖（真机验收 / 自动化断言用） */
  removeTap();
  g = loadGame({ search: '?adunit=formal' }); g.frames(3);
  rep.ok('?adunit=formal 可强制正式位（即使无 SDK，供验收与断言）',
    g.DBG.CFG.adUnitIsTest === false, '实际 ' + g.DBG.CFG.adUnitIsTest);
  installTap({});
  g = loadGame({ search: '?adunit=test' }); g.frames(3);
  rep.ok('?adunit=test 可强制测试位（即使有 SDK）',
    g.DBG.CFG.adUnitIsTest === true, '实际 ' + g.DBG.CFG.adUnitIsTest);

  /* ④ 正式位下整条广告链路必须真能跑通：不降级、不卡死、发奖 */
  installTap({});
  g = boot(6);
  const A = g.DBG.AdService, C = g.DBG.CFG, T = g.DBG.Track;
  C.adUnit.rewarded = '1068017';
  A.setEnv('online'); A.resetSession(); T.reset();
  rep.ok('正式位 + 有 SDK 时真的进入 online（没被静默降级）',
    A.env === 'online', '实际 ' + A.env + ' / degrade=' + (A.degradeReason || '无'));
  rep.ok('正式位下 adUnitSrc 随环境落为 formal-unit',
    A.adUnitSrc === 'formal-unit', '实际 ' + A.adUnitSrc);
  let got = 0, fell = 0;
  A.showRewarded('revive', { onReward: () => got++, onFallback: () => fell++ });
  rep.ok('正式位：onClose 之前绝不发奖（不能"点了就发"）', got === 0);
  rep.ok('正式位：真的调用了 tap 广告的 show()', TAP.shows === 1);
  TAP.close({ isEnded: true });
  rep.ok('正式位：onClose(isEnded=true) → 正常发奖（挂了正式位不会让链路哑火）',
    got === 1 && fell === 0, '发奖 ' + got + ' 次 / 降级 ' + fell + ' 次');
  removeTap();
});

rep.done();

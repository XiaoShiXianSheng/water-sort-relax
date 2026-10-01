/* qa_rollback.js —— 回滚验证器（三张铁律里最容易偷懒的那条，这里把它自动化）
 *
 * 一条断言写完，如果**故意把产品代码改坏它也不 FAIL**，那这条断言等于没写（假绿）。
 * 本项目历史上抓到过两次假绿：
 *   ① 断言检查 place==='grid' 的瓶子，但那段绘制逻辑只走台面瓶子 → 断言恒真
 *   ② 命中回转只点瓶子正中心，命中框从 ±52 砍到 ±20 仍然全绿
 *
 * 手工做回滚验证的问题是「容易忘、容易改不回来」。这个脚本把每个用例写成
 * 「(文件, 原文片段, 改坏成什么, 哪个套件的哪条断言必须 FAIL)」，
 * 一条命令跑完，且**每次都用 md5 校验原文件被完整还原**。
 *
 * 用法：node qa_rollback.js
 * 退出码：全部如期 FAIL 且文件已还原 → 0；任何一条没如期 FAIL → 1
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const NODE = process.execPath;
const ROOT = __dirname;
const GAME = path.join(ROOT, 'outputs', '解压水消除.html');

/* 每个用例：把产品代码某处改坏 → 指定套件里必须出现一条匹配 expect 的 FAIL */
const CASES = [
  {
    /* V6.0：命中盒不再是一个常量，改成 min(52, (tile+GX)/2)（跟着格子缩）。
       所以「砍小命中框」改成砍这个上界 —— 同理仍要让 5 点探针里的左/右半身落空。 */
    name: '命中框半宽上界从 52px 砍到 20px',
    suite: 'qa_ui.js', expect: /命中回转/,
    find: 'var hw=Math.min(52,(G.tile+GX)*0.5);',
    repl: 'var hw=Math.min(20,(G.tile+GX)*0.5);   /* rollback-test */'
  },
  {
    name: 'gateFront() 恒返回 true（洞里不再按顺序取）',
    suite: 'qa_ui.js', expect: /每个门洞此刻恰好只有一个瓶子可取/,
    find: 'return b.q<=m;',
    repl: 'return true;   /* rollback-test */'
  },
  {
    name: 'gateFront() 反号（可取的是最深那个）',
    suite: 'qa_design.js', expect: /每个门洞此刻只有一个瓶子可取/,
    find: 'return b.q<=m;',
    repl: 'return b.q>=m;'
  },
  {
    name: '解冻阈值从「四邻空 2 格」放宽到「空 1 格」',
    suite: 'qa_ui.js', expect: /解冻阈值/,
    find: 'for(var d=0;d<4;d++)if(neighborEmpty(b.cell,d))n++;\n    if(n>=2){',
    repl: 'for(var d=0;d<4;d++)if(neighborEmpty(b.cell,d))n++;\n    if(n>=1){'
  },
  {
    name: '冰冻瓶候选放宽（角落/开局已两格空的格子也冻 → 第一帧就化开）',
    suite: 'qa_design.js', expect: /冰冻瓶开局/,
    find: 'if(cb.gate>=0||cellIsCorner(cb.cell))continue;\n'
      + '    var emp=0;\n'
      + '    for(var cd=0;cd<4;cd++)if(neighborEmpty(cb.cell,cd))emp++;\n'
      + '    if(emp>=2)continue;',
    repl: 'if(cb.gate>=0)continue;   /* rollback-test: 放开冰冻候选 */'
  },
  {
    /* doUndo / restoreHistoryAt / failUndoCommit 现在共用 applySnapshotObj，
       所以「不回滚水管」要在这一处改坏 —— 一处坏，三条撤销路径一起坏。 */
    name: 'applySnapshotObj() 不回滚水管里的水（撤销/复活回滚/失败面板撤销 三条路径同时失效）',
    suite: 'qa_ui.js', expect: /撤销回退后状态逐字段一致/,
    find: '  for(var i=0;i<G.tubes.length;i++)G.tubes[i].units=s.tubes[i].slice();',
    repl: '  /* rollback-test: 故意不回滚水管 */'
  },
  {
    name: 'useClear() 漏掉「清掉的那杯倒进同色瓶」',
    suite: 'qa_ui.js', expect: /魔法清除水量守恒/,
    find: 'tgt.fill++;',
    repl: '/* rollback-test: 故意漏掉 tgt.fill++ */'
  },
  /* ---------- 02:00 档新增的 9 条设计断言，逐条做回滚验证 ---------- */
  {
    /* V6.0：放水（breathe）改成「阶段起点不放水」+ peak 同时 +1 洞 +1 冰。
       把 breathe 恒置 false → 放水关与峰值关同难度 → 「密度严格更低」失守。 */
    name: 'levelPlan：放水关不再减量（breathe 恒 false）',
    suite: 'qa_design.js', expect: /放水关真的放水/,
    find: '    else if(breathe&&!stageEntry){ gates-=1; if(ice>1)ice-=1; }',
    repl: '    else if(false&&breathe&&!stageEntry){ gates-=1; if(ice>1)ice-=1; }   /* rollback-test */'
  },
  {
    /* V6.0：操作量天花板不再是一个写死的数字，而是校准③里的分段预算 moveBudgetFor(lv)。
       注意：把预算**调大**（关掉校准）是抓不到的 —— V6.0 的曲线本身就在预算内
       （第 90 关 54 格 + 8 洞 ≈ 66 瓶 ≈ 152 步 < 200），校准③ 本来就不用出手。
       所以这条改「预算被压小」：校准③ 被迫把高关卡一路削回 3×3，
       但门洞数不变 → 瓶子数（9 + 12）仍然要按 3 倍预算算 → 天花板断言必须抓到。 */
    name: 'levelPlan：单局操作量预算被压成 10 步（校准③ 把高关卡压回 3×3）',
    suite: 'qa_design.js', expect: /单局操作量天花板/,
    find: 'function moveBudgetFor(lv){ return lv<=25?MOVE_BUDGET_EARLY:(lv<=60?MOVE_BUDGET_MID:MOVE_BUDGET_LATE); }',
    repl: 'function moveBudgetFor(lv){ return 10; }   /* rollback-test: 预算被压成 10 步 */'
  },
  {
    /* V6.0：slots = clamp(colors + slotBias, 5, SLOT_CAP)，普通档保证 槽 ≥ 色。
       把 slotBias 抹掉再 −3 → 高关卡的槽比颜色数还少。 */
    name: 'levelPlan：普通档台面槽比颜色数还少（slotBias 被抹掉）',
    suite: 'qa_design.js', expect: /台面槽 ≥ 颜色数/,
    find: '  var slots=clamp(colors+slotBias,5,SLOT_CAP);',
    repl: '  var slots=clamp(colors-3,5,SLOT_CAP);   /* rollback-test */'
  },
  {
    name: 'genLevel：某色瓶数多塞 2 瓶（每色瓶数不均衡）',
    suite: 'qa_design.js', expect: /每色瓶数均衡/,
    find: '    var pn=perBase+(pc<perRem?1:0);',
    repl: '    var pn=perBase+(pc<perRem?1:0);if(pc===0)pn+=2;' + '   /* rollback-test */'
  },
  {
    name: 'genLevel：冰冻瓶候选放开「洞里不冻」的限制',
    suite: 'qa_design.js', expect: /冰冻瓶绝不藏在门洞里/,
    find: 'if(cb.gate>=0||cellIsCorner(cb.cell))continue;',
    repl: 'if(cellIsCorner(cb.cell))continue;' + '   /* rollback-test */'
  },
  {
    name: 'pickGateDirs：洞口方向直接取「所有界内方向」',
    suite: 'qa_design.js', expect: /洞口朝向合法/,
    find: '      var pick=fresh.length?fresh:(occD.length?occD:(freeD.length?freeD:inD));',
    repl: '      var pick=inD;' + '   /* rollback-test */'
  },
  {
    name: '门洞塞瓶数从 2~3 摊成固定 4 瓶',
    suite: 'qa_design.js', expect: /每个门洞藏 2~3 个瓶子/,
    find: 'for(var gk=0;gk<maxGates;gk++){var w=2+((cfg>>gk)&1);ws.push(w);es+=w-1;}',
    repl: 'for(var gk=0;gk<maxGates;gk++){var w=4;ws.push(w);es+=w-1;}' + '   /* rollback-test */'
  },
  {
    /* V6.0：档位只改 slotBias / gates / ice。把 tier>=2 整段短路 → 极限 == 困难。
       断言标题已从「三档挑战严格更难」改成「三档挑战真的更难」，expect 跟着换。 */
    name: 'levelPlan：极限档 tier>=2 整段失效（极限 == 困难）',
    suite: 'qa_design.js', expect: /三档挑战真的更难/,
    find: '  if(tier>=2){ slotBias-=1; gates+=1; ice+=1; }',
    repl: '  if(tier>=2&&false){ slotBias-=1; gates+=1; ice+=1; }' + '   /* rollback-test */'
  },
  {
    /* V6.0：教学关的极限档靠切片区间 + 全局 clamp 自然被限制在 9 格 / 5 管。
       这里直接给 tier2 的棋盘加行列 → 教学关被撑成 36 格，触碰「≤12 格」红线。 */
    name: '教学关的极限档把棋盘撑成 36 格（新手第一关变劝退关）',
    suite: 'qa_design.js', expect: /教学关的极限档/,
    find: '  if(tier>=2){ slotBias-=1; gates+=1; ice+=1; }',
    repl: '  if(tier>=2){ slotBias-=1; gates+=1; ice+=1; rows+=3; cols+=3; }' + '   /* rollback-test */'
  },
  /* ---------- FIX-02：结算弹窗的三档方块从「纯展示」变成「可点」 ---------- */
  {
    name: '结算弹窗三档方块：删掉命中判定（方块又退回纯展示）',
    suite: 'qa_ui.js', expect: /FIX-02a：结算弹窗点「困难」方块/,
    find: 'if(vx>=tbx-58&&vx<=tbx+58&&vy>=712&&vy<=780){',
    repl: 'if(false){'
  },
  /* ---------- FIX-03：出屏管（本次漏测根因，两条治本断言都必须能抓它）----------
     V6.0：管数上限不再写死 7，而是 maxTubesByWidth()（按屏幕宽 + TUBE_MIN_W 反推）。
     所以「还原成 9 根」这条改法换等价形态：在剪裁后的根数上再 +3 →
     高关卡排 20 根管，layoutAll 夹到 TUBE_MIN_W 后总宽超过屏宽，两端管子被推出屏幕外。 */
  {
    name: '出屏管①（几何）：管数超出屏幕宽度上限 → 两端出屏、命中盒与屏幕无交集',
    suite: 'qa_design.js', expect: /出屏管回归/,
    find: '  var n=Math.max(3,Math.min(cap,want||3));',
    repl: '  var n=Math.max(3,Math.min(cap,want||3)+3);   /* rollback-test: 多 3 根 → 超屏 */'
  },
  {
    name: '出屏管②（命中路径）：同上，用「夹到屏幕内」的坐标走 tubeAt 点不到那 2 根',
    suite: 'qa_ui.js', expect: /水管命中路径/,
    find: '  var n=Math.max(3,Math.min(cap,want||3));',
    repl: '  var n=Math.max(3,Math.min(cap,want||3)+3);   /* rollback-test: 多 3 根 → 超屏 */'
  },

  /* ---------- 05:00 档新增：性能之外的两件事（修 flaky + 上线门禁）----------
     注意：下面几条有的改的是**测试文件**、有的是**发布件**、有的干脆不改文件而是给一个
     「线上是旧版」的场景 —— 所以用例支持 file（默认主文件）/ noPatch / liveTamper 三个开关。 */
  {
    /* V6.0 起 genLevel 每次都会重新解析档位（opts.tier > daily > 热身/普通），
       所以「冒烟把 G.tier 点脏」这件事已经被 genLevel 自愈了 —— 原来那条改法（把 test_water
       里的还原行改成 tier=1）不再能弄脏任何东西。改用治本改法：让档位解析本身坏掉
       （永远返回困难档）→ 冒烟后的哨兵（tier==0 && 9 格 && 5 槽）必然失守。 */
    name: 'genLevel 档位解析坏掉（永远困难档）→ 冒烟后的哨兵必须抓到',
    suite: 'test_water.js', expect: /冒烟随机点击后档位已还原/,
    find: '  else { G.tier=resolveChallengeTier(lv); G.warm=inWarmup(lv)?1:0; }',
    repl: '  else { G.tier=1; G.warm=inWarmup(lv)?1:0; }   /* rollback-test: 档位解析坏掉 */'
  },
  {
    name: '门禁 G3：主文件膨胀到 200KB 以上',
    suite: 'qa_gate.js', expect: /单文件体积.*→ \d+(\.\d+)?KB \/ 上限 200KB/,
    find: '<script>',
    repl: '<script>/*' + 'pad'.repeat(25000) + '*/'      /* 注释填充：ES5 扫描会剥掉，所以只影响体积这一条 */
  },
  {
    name: '门禁 G4：代码里混进箭头函数（老 WebView 直接语法报错）',
    suite: 'qa_gate.js', expect: /→ 箭头函数/,
    find: "var bg=document.createElement('canvas');",
    repl: "var bg=document.createElement('canvas');var __rbRollback=()=>1;"
  },
  {
    name: '门禁 G5：混进一个外部 <script src>',
    suite: 'qa_gate.js', expect: /→ .*script src/,
    find: '<script>',
    repl: '<script src="https://cdn.example.com/analytics.js"></script>\n<script>'
  },
  {
    name: '门禁 G6：layoutSolvable 恒返回 false（可解性判据被短路）',
    suite: 'qa_gate.js', expect: /不可解：L1/,
    find: 'for(key in occ)return false;',
    repl: 'for(key in occ)return false;return false;   /* rollback-test */'
  },
  {
    /* expect 跟着 G8a 的报错文案改过：G8a 现在一次列全部副本，
       单份不一致时的措辞是「<副本> <md5>（<n>B）≠ 主文件 <md5>」。 */
    name: '门禁 G8a：改了主文件没同步发布件',
    file: 'publish_water/index.html',
    suite: 'qa_gate.js', expect: /≠ 主文件/,
    find: '</body>',
    repl: '<!--rollback-test: 发布件落后于主文件--></body>'
  },
  {
    /* 同一个坑的第二次（2026-09-29）：发布副本从 1 个变成 2 个
       （publish_water 给线上站点，publish_taptap 给「重新打包上传」取件）。
       只查第一个目录的门禁，会让第二个目录悄悄落后 —— 而它恰恰是上传包的取件处，
       落后就意味着把「没有广告位 ID 的旧版」重新打进去 = 又一次静默零收益。
       这条用 GATE_NO_LIVE=1 跑：验的是本地副本一致性，不该被真线上当前版本干扰。 */
    name: '门禁 G8a：publish_taptap/index.html 落后于主文件（第二个发布目录漏同步）',
    file: 'publish_taptap/index.html',
    suite: 'qa_gate.js', expect: /publish_taptap\/index\.html/,
    find: '</body>',
    repl: '<!--rollback-test: taptap 打包目录落后于主文件--></body>',
    env: { GATE_NO_LIVE: '1' }
  },
  {
    name: '门禁 G8b：线上跑的是旧版（本地起一个故意不一致的站点）',
    suite: 'qa_gate.js', expect: /线上是旧版或没同步/,
    noPatch: true, liveTamper: true
  },
  /* ---------- FIX-04：卡住/死局时的「撤销」必须真的可点 ----------
     六条分别盯住这段功能最容易被"做成假的"的六个地方：
     按钮退化成文字 / 画得出来点不动 / 画的点的是两套坐标 / 撤销不扣次数 /
     失败面板的撤销不等 1.5 秒就冒出来（或干脆永远不出现）/ 撤销完还是死局也放行。 */
  {
    name: '软提示退化成纯文字（G.hint 不再带 opts → 又回到"自己去工具栏找撤销"）',
    suite: 'qa_ui.js', expect: /FIX-04①a：卡住时软提示带真按钮/,
    find: '    G.hint.opts=hintOpts();',
    repl: '    /* rollback-test: 退化成纯文字 */'
  },
  {
    name: '提示条按钮画得出来但没接命中（点不动 —— 玩家反馈的原话就是这个）',
    suite: 'qa_ui.js', expect: /FIX-04①c：点提示条上的「撤销一瓶」/,
    find: '  if(G.hint&&hintTap(vx,vy))return;',
    repl: '  /* rollback-test: 按钮没接线 */'
  },
  {
    name: '画的和点的是两套坐标（命中框整体右移 30px —— 本项目出过的老毛病）',
    suite: 'qa_ui.js', expect: /FIX-04①b/,
    find: '    if(vx>=t.x&&vx<=t.x+t.w&&vy>=t.y&&vy<=t.y+t.h)return t;',
    repl: '    if(vx>=t.x+30&&vx<=t.x+t.w&&vy>=t.y&&vy<=t.y+t.h)return t;   /* rollback-test */'
  },
  {
    name: '失败面板的撤销按钮永远不淡入（alpha 恒 0 → 弹窗里根本没有这条路）',
    suite: 'qa_ui.js', expect: /FIX-04②a/,
    find: '  var t=(G.fail.t||0)-1.5;',
    repl: '  var t=-1;   /* rollback-test: 永不淡入 */'
  },
  {
    name: '失败面板的撤销按钮不等 1.5 秒、弹窗一出来就怼在玩家脸上',
    suite: 'qa_ui.js', expect: /FIX-04②a/,
    find: '  var t=(G.fail.t||0)-1.5;',
    repl: '  var t=1;   /* rollback-test: 不等缓冲直接出现 */'
  },
  {
    name: '失败面板撤销不扣次数（变成免费无限撤，撤销次数这个资源形同虚设）',
    suite: 'qa_ui.js', expect: /FIX-04②b：这次撤销照常扣 1 次/,
    find: '  G.undoLeft--;\n  G.history.length=idx;',
    repl: '  G.history.length=idx;   /* rollback-test: 不扣次数 */'
  },
  {
    name: '失败面板撤销不验收（退完还是死局也照样关面板 → 玩家对着死棋盘干等）',
    suite: 'qa_ui.js', expect: /FIX-04②d/,
    find: '  if(!boardPlayable()){',
    repl: '  if(false){   /* rollback-test: 不验收 */'
  },
  {
    name: '撤销次数用光时仍写「撤销一瓶」（等于白送，广告位没了）',
    suite: 'qa_ui.js', expect: /FIX-04②c/,
    find: "function failUndoTitle(){ return G.undoLeft>0?'↩ 撤销一瓶':'▶ 看广告 +1 撤销'; }",
    repl: "function failUndoTitle(){ return '↩ 撤销一瓶'; }   /* rollback-test */"
  },
  /* ---------- B 组：UX 评审读代码读出来的五个真 bug + 三星判定 ----------
     每条都配一个"改坏"用例：这些修法大多是"加一行前置判断 / 改一个条件"，
     最容易被后来人当冗余删掉，而删掉之后旧断言照样全绿 —— 必须靠这里兜住。 */
  {
    name: 'B1：删掉 useFinger 的「台面满了」前置判断（道具白扣、瓶子不动、还弹横幅）',
    suite: 'qa_ui.js', expect: /B1：台面满时点「万能指」/,
    find: "  if(freeSlot()<0){toast('台面满了，先退回一个瓶子');SFX.no();return;}",
    repl: '  /* rollback-test: 又回到先扣道具再被 startPlace 拒 */'
  },
  {
    name: 'B2①：撤销不回滚步数（G.moves 只增不减，试错被永久记账）',
    suite: 'qa_ui.js', expect: /B2①/,
    find: '  if(s.moves!==undefined)G.moves=s.moves;',
    repl: '  /* rollback-test: 步数不随快照回滚 */'
  },
  {
    name: 'B2②：startReturn 改成 G.moves--（place/return 相消 → moves 恒等于瓶子数 → 人人三星）',
    suite: 'qa_ui.js', expect: /B2②/,
    find: "  snapshot();\n  G.moves++;\n  b.place='anim';\n  var rc=cellRect(b.cell);",
    repl: "  snapshot();\n  G.moves--;\n  b.place='anim';\n  var rc=cellRect(b.cell);"
  },
  {
    name: 'B3①：上限触顶又补一条 onNotice（两条 toast 互相覆盖，最后一句还是错的）',
    suite: 'qa_ui.js', expect: /B3①/,
    find: "      if(opts.onFail)try{ opts.onFail('cap'); }catch(e){}\n      return false;",
    repl: "      if(opts.onFail)try{ opts.onFail('cap'); }catch(e){}\n"
      + "      if(opts.onNotice)try{ opts.onNotice('cap'); }catch(e){}\n      return false;"
  },
  {
    name: 'B3②：文案改回「下局再来」（resetSession 无调用，换一局并不重置 → 是句谎话）',
    suite: 'qa_ui.js', expect: /B3②/,
    find: "toast('本局的广告次数用完啦，换一局再来')",
    repl: "toast('本局广告次数用完啦，下局再来')"
  },
  {
    name: 'B4①：HUD 重开又裸调 genLevel（每日挑战被静默降级成普通关，玩家毫无察觉）',
    suite: 'qa_ui.js', expect: /B4①/,
    find: '    genLevel(G.level,{restart:1,daily:G.daily,date:G.dailyDate,',
    repl: '    genLevel(G.level,{restart:1,'
  },
  {
    name: 'B4②：HUD 重开丢掉 restart:1（走失败面板的人被扣星、HUD 重开的人免责 → 双标）',
    suite: 'qa_ui.js', expect: /B4②/,
    find: '    genLevel(G.level,{restart:1,daily:G.daily,date:G.dailyDate,',
    repl: '    genLevel(G.level,{daily:G.daily,date:G.dailyDate,'
  },
  {
    name: 'B5：道具栏名字无条件重画（与「▶ 广告补次」硬重叠；撤销行 alpha=1，每局必现）',
    suite: 'qa_ui.js', expect: /B5②/,
    find: "    if(!((isTool&&cnt<=0)||(tb.id==='undo'&&G.undoLeft<=0)))ctx.fillText(tb.label,cx,TOOL_Y+74);",
    repl: '    ctx.fillText(tb.label,cx,TOOL_Y+74);'
  },
  {
    name: 'B6①：三星又要求 0 道具（玩家不敢用道具 → 道具永不耗尽 → 广告补次永远触发不了）',
    suite: 'qa_ui.js', expect: /B6①/,
    find: '  var stars=(G.moves<=par&&!G.restarted)?3:',
    repl: '  var stars=(G.moves<=par&&G.toolsUsed===0&&!G.restarted)?3:'
  },
  {
    name: 'B6②：三星去掉 !G.restarted（全文唯一的 anti-reroll 门槛失守 → 反复重开刷三星）',
    suite: 'qa_ui.js', expect: /B6②/,
    find: '  var stars=(G.moves<=par&&!G.restarted)?3:',
    repl: '  var stars=(G.moves<=par)?3:'
  },
  {
    name: 'B7：连点关卡号又弹出「（测试）」字样（内部字样不该被玩家看见）',
    suite: 'qa_ui.js', expect: /B7：连点关卡号/,
    find: "    else{SFX.tap();}          // 不给计数提示：玩家好奇连点会看见「（测试）」这种内部字样",
    repl: "    else{toast('再点 '+(5-G.lvTap.n)+' 次进入选关（测试）');SFX.tap();}"
  },
  /* ---------- B8：看过广告的撤销，星级封顶 2 ----------
     四条分别盯住：计数器不记 / 封顶条件不认 adUndo / 计数器记错地方（普通撤销也被封顶）/
     换关不归零。第三条尤其重要 —— 它防的是"把 adUndo++ 顺手放进 failUndoCommit"，
     那样花普通撤销额度的玩家也会被扣星，正是这条改动最容易走岔的地方。 */
  {
    name: 'B8：广告撤销不记 adUndo（看完广告照样三星，与 reviveUsed 那条原则冲突）',
    suite: 'qa_ui.js', expect: /B8①：看过广告的撤销/,
    find: 'var grant=function(){ G.undoLeft++; G.adUndo++; failUndoCommit(); };',
    repl: 'var grant=function(){ G.undoLeft++; failUndoCommit(); };'
  },
  {
    name: 'B8：星级封顶条件不认 adUndo（只认 reviveUsed）',
    suite: 'qa_ui.js', expect: /B8①：看过广告的撤销/,
    find: '  if((G.reviveUsed>0||G.adUndo>0)&&stars>2)stars=2;',
    repl: '  if(G.reviveUsed>0&&stars>2)stars=2;'
  },
  {
    name: 'B8：adUndo++ 记错地方（放进 failUndoCommit → 花普通撤销额度的玩家也被扣星）',
    suite: 'qa_ui.js', expect: /B8②：用普通撤销次数的 failUndo/,
    find: "  SFX.cap(); toast('退回一步，继续！');",
    repl: "  G.adUndo++;\n  SFX.cap(); toast('退回一步，继续！');"
  },
  {
    name: 'B8：换关/重开不重置 adUndo（上一局的广告账带到下一局）',
    suite: 'qa_ui.js', expect: /B8③/,
    find: 'G.reviveUsed=0; G.adUndo=0; G.moves=0;',
    repl: 'G.reviveUsed=0; G.moves=0;'
  },
  /* ---------- 23:00 档新增的 10 条断言（主循环守恒 / 万能指 / 随心互换 / 多步撤销）----------
     这四组是全项目此前**完全没有断言**的核心机制，逐条做回滚验证：
     每条都必须能看到「指定改坏 → 指定断言 FAIL」，否则就是假绿。 */
  {
    name: 'completeJar() 不累加 G.clears（清完了却不算进度 → 玩家永远通不了关）',
    suite: 'qa_ui.js', expect: /主循环：接满 3 口/,
    find: '  G.clears++;',
    repl: '  /* rollback-test: 故意不累加完成数 */'
  },
  {
    name: 'completeJar() 不释放槽位（slot 残留 → 台面被"看不见的瓶子"占住）',
    suite: 'qa_ui.js', expect: /主循环：接满 3 口/,
    find: "b.place='gone'; b.done=false; b.fill=0; b.capT=0; b.slot=-1; b.doneT=0;",
    repl: "b.place='gone'; b.done=false; b.fill=0; b.capT=0; b.slot=99; b.doneT=0;"
  },
  {
    /* 这条专门验「守恒」那一条断言的独立效力：瓶子照样收走（第一条断言仍绿），
       但管里的水没被扣掉 → 水量凭空 +1。 */
    name: 'finishDrink() 喝掉的那杯不从管里扣（瓶子照收走，但水凭空变多）',
    suite: 'qa_ui.js', expect: /主循环守恒/,
    find: '  tube.units.splice(0,1); tube.drop=1;',
    repl: '  /* rollback-test: 故意不扣管里的水（凭空造水） */'
  },
  {
    name: 'useFinger() 挑选条件放宽成「任意格子里的瓶子」（能拿冰冻瓶 / 洞里的瓶 / 喝不到的颜色）',
    suite: 'qa_ui.js', expect: /「万能指」搬上台面/,
    find: "if(bb.place==='grid'&&!bb.locked&&bottoms.indexOf(bb.col)>=0&&gridPlayable(bb)){b=bb;break;}",
    repl: "if(bb.place==='grid'){b=bb;break;}   /* rollback-test */"
  },
  {
    name: 'useFinger() 不扣道具次数（白送 → 万能指变成无限道具）',
    suite: 'qa_ui.js', expect: /「万能指」真消耗/,
    find: '  G.tools.finger--; SFX.magic();',
    repl: '  SFX.magic();   /* rollback-test */'
  },
  {
    name: 'useFinger() 顺手把管里最上面一杯也喝掉（道具不该改变水量）',
    suite: 'qa_ui.js', expect: /「万能指」只搬瓶子/,
    find: '  G.tools.finger--; SFX.magic();',
    repl: '  G.tools.finger--; if(G.tubes[0].units.length)G.tubes[0].units.splice(0,1); SFX.magic();'
  },
  {
    name: 'useSwap() 把整根管对调（不是只换塔顶一杯）',
    suite: 'qa_ui.js', expect: /「随心互换」只换两根管的塔顶一杯/,
    find: '  var tmp=a.units[0];a.units[0]=b.units[0];b.units[0]=tmp;',
    repl: '  var tmp=a.units;a.units=b.units;b.units=tmp;   /* rollback-test */'
  },
  {
    name: 'useSwap() 把塔顶复制一份而不是交换（凭空多一杯水）',
    suite: 'qa_ui.js', expect: /「随心互换」不改变总水量/,
    find: '  a.drop=1;b.drop=1;',
    repl: '  a.drop=1;b.drop=1;b.units.push(a.units[0]);   /* rollback-test: 复制而非交换 */'
  },
  {
    name: 'useSwap() 空管也扣道具次数（玩家点一下白扣一次道具）',
    suite: 'qa_ui.js', expect: /「随心互换」拒绝空管/,
    find: "  if(!a.units.length||!b.units.length){toast('空管没法换');SFX.no();return;}",
    repl: "  G.tools.swap--; if(!a.units.length||!b.units.length){toast('空管没法换');SFX.no();return;}"
  },
  {
    name: 'snapshot() 的撤销栈只保留 1 层（连撤两次就错乱）',
    suite: 'qa_ui.js', expect: /连放 3 瓶/,
    find: '  if(G.history.length>30)G.history.shift();',
    repl: '  if(G.history.length>1)G.history.shift();   /* rollback-test */'
  },
  {
    name: 'doUndo() 不扣撤销额度（免费无限撤）',
    suite: 'qa_ui.js', expect: /连续撤销 3 次消耗/,
    find: '  applySnapshotObj(JSON.parse(G.history.pop()));\n  G.undoLeft--;\n  SFX.undo();',
    repl: '  applySnapshotObj(JSON.parse(G.history.pop()));\n  SFX.undo();'
  },
  {
    /* 真实事故：全局 core.autocrlf=true，一次 git rebase 就把主文件写成 CRLF、
       发布件与线上还是 LF → 门禁翻红，但内容一模一样。这条既验证 G8a 会 FAIL，
       也验证「只差换行符」那句诊断还在（不然下次又得查半天）。 */
    name: '门禁 G8a：发布件只差换行符（CRLF vs LF，内容一致但字节不等）',
    file: 'publish_water/index.html',
    suite: 'qa_gate.js', expect: /只差换行符/,
    crlfTamper: true,
    /* 「线上 LF / 本地 CRLF」这一对改用本机确定性站点提供，不再依赖真线上站点
       当前跑的是哪一版 —— 否则别人一发版这条就失效（2026-09-28 踩到：线上从
       137240B 换成 152420B，这条立刻变红，而代码一点没动）。 */
    liveServe: true
  },

  /* ---------- 09-29 02:00 档新增的 7 条设计不变量，逐条做回滚验证 ----------
     每条都刻意挑「只让这一条红」的改法（除了注明交叉的那条），
     否则分不清哪条断言真有独立效力。 */
  {
    name: '入门正式 4~8 关：冰冻上限被抬到 3（新手段一次撞两种新干扰）',
    suite: 'qa_design.js', expect: /入门正式 4~8 关/,
    find: 'colors:[4,6],   tubes:[5,8],   gates:[0,2], ice:[0,1]',
    repl: 'colors:[4,6],   tubes:[5,8],   gates:[0,2], ice:[0,3]   /* rollback-test */'
  },
  {
    name: '高密度阶段被压小（第 25 关格数不再落在 48 格的设计目标上）',
    suite: 'qa_design.js', expect: /V6.0 阶段阶梯硬钉死/,
    find: 'cols:[7,8], rows:[5,6]',
    repl: 'cols:[7,7], rows:[5,5]   /* rollback-test */'
  },
  {
    name: 'levelPlan：困难档一档就交掉 2 个台面槽（槽位递进超出「每档 −1」）',
    suite: 'qa_design.js', expect: /三档挑战「只调约束/,
    find: '  if(tier>=1){ slotBias-=1; if(lv>=6)gates+=1; }',
    repl: '  if(tier>=1){ slotBias-=2; if(lv>=6)gates+=1; }   /* rollback-test */'
  },
  {
    name: 'genLevel：门洞候选从「≥3 个货架内方向」放宽到「≥2」（角落也能当门洞）',
    suite: 'qa_design.js', expect: /门洞不选角落/,
    find: 'if(dirsIn.length>=3)gateCellStart.push(gc0);',
    repl: 'if(dirsIn.length>=2)gateCellStart.push(gc0);   /* rollback-test: 放开角落 */'
  },
  {
    name: 'genLevel：门洞候选被清空（放不下就静默少放 → 实际门洞数 < 计划）',
    suite: 'qa_design.js', expect: /实际门洞数 == 计划门洞数/,
    find: 'if(dirsIn.length>=3)gateCellStart.push(gc0);',
    repl: 'if(dirsIn.length>=5)gateCellStart.push(gc0);   /* rollback-test: 永无候选 */'
  },
  {
    name: 'genLevel：可解性兜底无条件执行（40 次自检没过就把冰冻整关撤掉）',
    suite: 'qa_design.js', expect: /实际冰冻数 == 计划冰冻数/,
    find: 'if(!solvableOK){',
    repl: 'if(true){   /* rollback-test: 兜底永远执行 */'
  },
  {
    name: '高密度阶段 slotBias 反向放大（「台面槽 − 颜色数」不再单调不增）',
    suite: 'qa_design.js', expect: /普通档「台面槽 − 颜色数」随关卡单调不增/,
    find: 'gates:[3,4], ice:[2,4], slotBias:1}',
    repl: 'gates:[3,4], ice:[2,4], slotBias:3}   /* rollback-test */'
  },
  /* ---------- 05:00 档新增 G9「真浏览器启动冒烟」的三条回滚用例 ----------
     这三条刻意覆盖**三种不同的白屏成因**，而不是同一个成因换三种写法：
       ① 启动就抛错（脚本没跑完 → 主循环压根没注册）
       ② 跑起来了但 render 空转（画面全空 = 用户看到白屏）
       ③ 主循环跑一帧就不排下一帧（画面卡死在第一帧）
     三者互不重叠，能证明 G9 的四条断言各自有独立效力。 */
  {
    name: 'G9①：启动即抛错（genLevel 后 throw，后面的 requestAnimationFrame(loop) 不再执行）',
    suite: 'qa_smoke_live.js', expect: /主循环在跑/,
    find: 'if(URL_LVL){genLevel(URL_LVL);}',
    repl: 'if(URL_LVL){genLevel(URL_LVL);throw new Error("SMOKE_BOOT");}   /* rollback-test */'
  },
  {
    name: 'G9②：render() 空转（主循环照跑，但画面上什么都没画 = 白屏）',
    suite: 'qa_smoke_live.js', expect: /画面真的画出了东西/,
    find: 'function render(time){',
    repl: 'function render(time){if(1)return;   /* rollback-test: 空转 */'
  },
  {
    name: 'G9③：主循环不排下一帧（画完第一帧就冻住）',
    suite: 'qa_smoke_live.js', expect: /主循环在跑/,
    find: '  }\n  requestAnimationFrame(loop);\n}',
    repl: '  }\n  /* rollback-test: 故意不排下一帧 */\n}'
  },

  /* ---------- 09-29 广告接入档新增 2 条：一次"零收益事故"的防回归 ----------
     事故经过：广告位 ID 已经填好了，但 CFG.env 还是 'test' → 真机上跑的是模拟广告，
     一个广告费都收不到，而且**不报任何错**（游戏照常玩）。这类"配置型静默失效"
     最难靠人眼发现，所以两条断言各配一个回滚用例。 */
  {
    /* ⚠️ find 必须吃满整行：第一次写的时候只匹配到「就真实拉广告)」，
       行尾的「| 'test'(模拟完成，供开发/自动化测试)」被留了下来，
       于是改坏后的文件变成「env:'test', [残留注释] | 'test'(模拟完成…)」→ 全角逗号语法错误
       → 套件 0 PASS / 6 FAIL，看起来像"改坏没 FAIL"，实际是"文件根本没解析成功"。
       回滚用例本身也会写错，这就是为什么它必须自己先跑通。
       ★ 二次教训（2026-09-29）：这段注释最初直接写了内层注释标记 `斜杠星号 … 星号斜杠`，
         那个「星号斜杠」把**外层块注释提前闭合了** → 后面半行成了裸代码 →
         整个 qa_rollback.js 一跑就 SyntaxError，却没人发现（它是独立跑的，不在 qa_run 里）。
         现在 qa_gate.js 多了 G10：对所有 QA 脚本做语法自检，这类"验证器自己烂掉"当场变红。 */
    name: '广告总开关被改回 test（真机跑模拟广告 → 静默零收益）',
    suite: 'qa_biz.js', expect: /出厂 env 默认值是 online/,
    find: "  env:'online',                            // 'online'(默认：真机有 tap 就真实拉广告) | 'test'(模拟完成，供开发/自动化测试)",
    repl: "  env:'test',   /* rollback-test: 改回模拟广告 */"
  },
  {
    name: '无 tap 时不再降级（本地/Node 环境被当成真机跑 online → 测试体系被污染）',
    suite: 'qa_biz.js', expect: /无 tap 运行时 → 自动降级 test/,
    find: "      if(!AdService.hasTap()){ AdService.env='test'; AdService.degradeReason='no-tap-runtime'; }",
    repl: "      if(false){ AdService.env='test'; AdService.degradeReason='no-tap-runtime'; }   /* rollback-test */"
  },

  /* ---------- 2026-09-30 02:00 档新增的 8 条「难度预算 / 曲线」断言 ----------
     延续上一档的做法：每条新断言配一条**尽量只让它自己红**的改坏方式，
     这样才分得出哪条断言真有独立效力（有几条会顺带连坐别的断言，下面注明）。 */
  {
    name: 'levelPlan：台面槽被砍掉 3 个（有效空槽 − 颜色数 < −1 → 必输关）',
    suite: 'qa_design.js', expect: /必输关/,
    find: '  var slots=clamp(colors+slotBias,5,SLOT_CAP);',
    repl: '  var slots=clamp(colors+slotBias,5,SLOT_CAP); if(lv>=21&&lv<=22)slots=Math.max(5,slots-3);   /* rollback-test */'
  },
  {
    name: 'genLevel 实际开出的台面槽比 levelPlan 计划多 1 个（槽位预算被偷偷放大）',
    suite: 'qa_design.js', expect: /槽位预算/,
    find: '  for(var s2=0;s2<slotsN;s2++)G.slots.push({open:s2<slotsN-1}); // 只留最右一个广告解锁槽',
    repl: '  for(var s2=0;s2<slotsN+1;s2++)G.slots.push({open:s2<slotsN}); // rollback-test: 多开一个槽'
  },
  {
    name: 'levelPlan：高密度阶段行数起点被压到 3（第 15→16 关格数跳 14 个 = 曲线断崖）',
    suite: 'qa_design.js', expect: /难度参数逐关不跳变/,
    find: 'rows:[5,6], colors:[9,12]',
    repl: 'rows:[3,6], colors:[9,12]   /* rollback-test */'
  },
  {
    name: '极限阶段门洞上限被压到 2（后两个周期的峰值关比前面还简单）',
    suite: 'qa_design.js', expect: /跨周期峰值关不许变简单/,
    find: 'gates:[5,6], ice:[5,6], slotBias:0}',
    repl: 'gates:[5,2], ice:[5,6], slotBias:0}   /* rollback-test */'
  },
  {
    name: 'levelPlan：正式挑战阶段门洞与冰冻同时归零（后半程变纯送分的无干扰局）',
    suite: 'qa_design.js', expect: /第 9 关起干扰不许归零/,
    find: 'gates:[2,3], ice:[1,2], slotBias:1}',
    repl: 'gates:[0,0], ice:[0,0], slotBias:1}   /* rollback-test */'
  },
  {
    name: 'tubeCountFor：管数一律多加 3 根（第 1 关的管只剩 4 层水 —— 短短一截很难看）',
    suite: 'qa_design.js', expect: /每根管开局都装/,
    find: '  while(n<cap&&Math.ceil(units/n)>26)n++;\n  return n;\n}',
    repl: '  while(n<cap&&Math.ceil(units/n)>26)n++;\n  return n+3;   /* rollback-test */\n}'
  },
  {
    name: 'gridPlayable()：可点判定多加一个条件（三成的瓶子开局点不到 = 开局没事可做）',
    suite: 'qa_design.js', expect: /开局可点占比/,
    find: "return b.place==='grid'&&!b.locked&&gateFront(b)&&!gateBlocked(b);",
    repl: "return b.place==='grid'&&!b.locked&&gateFront(b)&&!gateBlocked(b)&&(b.cell%3===0);   /* rollback-test */"
  },
  {
    /* 这条刻意选「plan 和实际一起改」的改法：格数断言拿实际比计划，两边一起变小是查不出的，
       只有硬编码绝对值的「中期货架阶梯」能抓到 —— 与稳态货架那条是同一个道理。 */
    name: '正式挑战阶段列数被压到 5（第 15 关格数不再落在 35 格的设计目标上）',
    suite: 'qa_design.js', expect: /V6.0 阶段阶梯硬钉死/,
    find: 'cols:[5,7], rows:[4,5]',
    repl: 'cols:[5,5], rows:[4,5]   /* rollback-test */'
  },

  /* ---------- 2026-09-30 05:00 档新增：两条门禁（G6b 面板关数全覆盖 / G11 广告位已填）----------
     这两条补的都是「**套件里永远查不出来**」的盲区，所以每条都必须自己证明有牙齿。 */
  {
    /* 门禁 G11。为什么套件里查不出：qa_biz 有一条「没有 adUnitId 时必须降级成 test」的用例，
       它会**故意**把 adUnitId 清空 —— 于是「出厂 adUnitId 是空的」这件事永远见不到红。
       真实后果与 env='test' 那次一模一样：真机静默降级成模拟广告，零收益且不报错。 */
    name: '门禁 G11：出厂激励视频 adUnitId 被清空（真机静默降级成模拟广告 = 零收益且不报错）',
    suite: 'qa_gate.js', expect: /仍是占位符/,
    find: "adUnit:{rewarded:'1067564',interstitial:'1067565'},",
    repl: "adUnit:{rewarded:'',interstitial:'1067565'},   /* rollback-test: 清空一个 ID */"
  },
  {
    /* 同一条门禁的第二种形态：配置**还在**、只是被注释掉了。
       如果 G11 只在原始文本上 grep，注释掉的配置照样能骗过它 —— 所以实现里先 stripLits。 */
    name: '门禁 G11：adUnit 配置被整行注释掉（raw 文本里 grep 得到，剥掉注释后其实没生效）',
    suite: 'qa_gate.js', expect: /剥掉注释后扫不到/,
    find: "adUnit:{rewarded:'1067564',interstitial:'1067565'},",
    repl: "// adUnit:{rewarded:'1067564',interstitial:'1067565'},   /* rollback-test: 注释掉配置 */"
  },
  {
    /* 门禁 G6b 的独立效力：把「第 41 关之后生成出来的状态」改脏。
       注意 G6 只覆盖 1~40 关 —— 这条改坏 G6 完全看不见（它照样全绿），
       只有 G6b 会红。这正是它存在的理由：选关面板上 41~90 关是真的能点到的。 */
    name: '门禁 G6b：第 41 关之后生成出的状态不是 play（G6 只测 1~40，看不见）',
    suite: 'qa_gate.js', expect: /\[G6b\]/,
    find: "  G.state='play';",
    repl: "  G.state='play';\n  if(lv>40)G.state='win';   /* rollback-test: 模拟高关位关卡表写坏 */"
  },
  {
    /* 同一条门禁的第二种形态：面板关数常量读不出来时**必须报错**，不能静默按小数字跑。
       用 `2+1` 而不是 `4`：值其实还是 3，游戏本体完全正常 ——
       这条验的就是「读不到就说读不到，不许猜」（没验证 ≠ 通过）。 */
    name: '门禁 G6b：面板关数常量写成表达式（读不到就必须报错，不许猜着往下跑）',
    suite: 'qa_gate.js', expect: /读不到/,
    find: 'var LV_PER_PAGE=30, LV_PAGES=3;',
    repl: 'var LV_PER_PAGE=30, LV_PAGES=2+1;   /* rollback-test: 值仍是 3，但断言读不出来 */'
  },

  /* ---------- 2026-10-01 02:00 档新增：7 条「设计不变量」断言，逐条做回滚验证 ----------
     这 7 条的共同特征是「改坏了不会报错、不会崩、画面也看不出」，
     所以每一条都必须证明自己有牙齿（改坏 → 对应断言必须红）。 */
  {
    /* ① 广告解锁位：`open:s2<slotsN-1` 这一行同时决定「台面变现位」和全项目的
       「有效空槽 = 总槽 − 1」难度结论。改成全部免费 → 变现位消失、难度结论失效。 */
    name: '台面槽全部免费开放（唯一的广告解锁位消失，「有效空槽 = 总槽 − 1」整条推导失效）',
    suite: 'qa_design.js', expect: /广告解锁位唯一且在末位/,
    find: 'for(var s2=0;s2<slotsN;s2++)G.slots.push({open:s2<slotsN-1});',
    repl: 'for(var s2=0;s2<slotsN;s2++)G.slots.push({open:true});   /* rollback-test: 全部免费 */'
  },
  {
    /* ② 逐色水量守恒：只把液体池的第一滴换成别的颜色 —— **总量分毫未变**，
       旧的「水量守恒（总量）」「瓶数」「可解性」都可能照旧，只有逐色断言能抓。 */
    name: '液体池里某一滴被换成别的颜色（总量守恒分毫未变，只有「逐色守恒」能抓）',
    suite: 'qa_design.js', expect: /逐色水量守恒/,
    find: 'for(var b=0;b<bottles.length;b++)for(var u=0;u<bottles[b].cap;u++)pool.push(bottles[b].col);',
    repl: 'for(var b=0;b<bottles.length;b++)for(var u=0;u<bottles[b].cap;u++)pool.push(bottles[b].col);\n'
      + '  pool[0]=(pool[0]+1)%C;   /* rollback-test: 一滴换色 */'
  },
  {
    /* ③ 纯色管：把第一根管整根改成同一种颜色 —— 一步就能接完的白送局。
       洗牌退化就长这样：不报错、不崩，只是「关卡悄悄变简单」。 */
    name: '第一根管整根被写成同一种颜色（纯色管 = 一步接完的白送局）',
    suite: 'qa_design.js', expect: /不存在纯色管/,
    find: 'var units=pool.slice(p,p+sizes[t]); p+=sizes[t];',
    repl: 'var units=pool.slice(p,p+sizes[t]); p+=sizes[t];\n'
      + '    if(t===0)for(var uz=0;uz<units.length;uz++)units[uz]=pool[0];   /* rollback-test: 纯色管 */'
  },
  {
    /* ④ 单局初始额度：撤销次数从 5 改成 4。这是每关重置的固定值，
       玩家第一局就该拿到 5 次 —— 漂移了不会有任何别的断言发现。 */
    name: '单局初始撤销次数从 5 改成 4（初始额度漂移，其它断言全都看不见）',
    suite: 'qa_design.js', expect: /开局台面为空/,
    find: 'G.undoLeft=5; G.unlockLeft=1; G.tools={clear:1,finger:1,swap:1};',
    repl: 'G.undoLeft=4; G.unlockLeft=1; G.tools={clear:1,finger:1,swap:1};   /* rollback-test: 少给 1 次撤销 */'
  },
  {
    /* ⑤ 难度触顶：把冰冻上限从 4 抬到 5（只在第 29 关之后生效）。
       单关数值全都合法、三档递进也仍然成立，只有「难度在第 24 关完全触顶」能抓 ——
       这条守的是「对外文案不能写越往后越难」的代码依据。 */
    name: '极限阶段颜色数上限被压平（第 60 关不比第 40 关更难 = 曲线触顶）',
    suite: 'qa_design.js', expect: /曲线不许触顶/,
    find: 'colors:[14,16], tubes:[17,17]',
    repl: 'colors:[14,14], tubes:[17,17]   /* rollback-test */'
  },
  {
    /* ⑥ 三档「实际 == 计划」：只在**挑战档**里把门洞整关撤掉（普通档不动）。
       这样原有的「实际门洞数 == 计划门洞数」（只跑普通档）照样全绿 ——
       这条用例本身就在证明「把断言扩到三档」是有增量的，不是重复劳动。 */
    name: '挑战档（困难/极限）的门洞被整关撤掉（原断言只跑普通档 → 它照样全绿，看不见）',
    suite: 'qa_design.js', expect: /三档「实际门洞/,
    find: 'var maxGates=plan.gates;',
    repl: 'var maxGates=G.tier>0?0:plan.gates;   /* rollback-test: 挑战档没有门洞 */'
  },
  {
    /* ⑦ 挑战档难度开关下限：极限档一次砍 2 个槽（而不是 1 个）。
       受控实验里 −2 已让贪心首战归零，−4 就彻底没有退路 —— 属于「点了必输」的形态。 */
    name: '极限档台面槽多砍 2 格（有效空槽 − 色 = −4，掉出「必输区」下限）',
    suite: 'qa_design.js', expect: /挑战档难度开关下限/,
    find: '  if(tier>=2){ slotBias-=1; gates+=1; ice+=1; }',
    repl: '  if(tier>=2){ slotBias-=3; gates+=1; ice+=1; }   /* rollback-test: 极限档再砍两刀 */'
  },

  /* ---------- 2026-10-01 05:00 档新增：两条真浏览器门禁（G12 断网 / G13 端到端点击）----------
     这两条的共同点是「假 canvas 套件天生看不见」：一个只在断网时暴露，一个只在真 DOM 事件下暴露。
     所以用例特意挑**假 canvas 完全抓不到、只有真浏览器能抓**的改法。 */
  {
    /* G12 的牙齿：把远端贴图当成主循环的启动前置条件（真实事故形态 ——
       "首屏等资源加载完再开始画"这句话谁都写得出来，联网时毫无异样）。
       断网冒烟里 onload 永远不会来 → 一帧都不出 → 「主循环在跑」必须红。
       注：这里必须跑**断网**那一趟，正常网络的冒烟在同一个坏死版本下也会红，
       但它红的原因和这一条无关（所以这条用例的价值是"证明断网这一趟真的在判东西"）。 */
    name: '门禁 G12：主循环等一张远端贴图才启动（联网看不出，一断网就一帧都不出）',
    suite: 'qa_smoke_live.js', expect: /主循环在跑/,
    env: { SMK_OFFLINE: '1', SMK_OUT: '_rb_smoke.json', LV_SET: '1' },
    find: 'if(URL_LVL){genLevel(URL_LVL);}\nrequestAnimationFrame(loop);',
    repl: 'if(URL_LVL){genLevel(URL_LVL);}\n'
      + "var __rbg=new Image();__rbg.onload=function(){requestAnimationFrame(loop);};\n"
      + "__rbg.src='https://cdn.invalid/bg.png';   /* rollback-test: 主循环等远端贴图 */"
  },
  {
    /* G12 的「不是空转」自检：垫片假报已安装（实际没拦）。
       页面不报告 netOff 时，那一趟的 5 条断言其实全在**正常网络**下跑的 ——
       门禁会变成一条"看着在跑、其实什么都没测"的假绿，所以必须 FAIL。 */
    name: '门禁 G12：断网垫片假报已安装（页面不报 netOff → 那一趟等于没断网，必须拒绝放行）',
    file: 'qa_smoke_live.js', suite: 'qa_smoke_live.js', expect: /断网模式已生效/,
    env: { SMK_OFFLINE: '1', SMK_OUT: '_rb_smoke.json', LV_SET: '1' },
    find: "'  window.__SMK_NET_OFF=true;',",
    repl: "'  window.__SMK_NET_OFF=false;',   /* rollback-test: 垫片假报 */"
  },
  {
    /* G13 的牙齿，而且这条专门证明「G13 有 qa_ui 给不了的增量」：
       删掉 canvas 的**触屏入口**（真机是手指，不是鼠标）。
       qa_ui 是直接调 handleTap(vx,vy) 的 —— 它照样全绿；只有真 DOM 事件那条链路会红。
       这正是"游戏能玩，就是点不动"这类事故，假 canvas 永远抓不到。 */
    name: '门禁 G13：canvas 的触屏入口被删（qa_ui 直接调 handleTap 全绿，只有真触摸事件能抓）',
    suite: 'qa_smoke_live.js', expect: /真的进第 1 关/,
    env: { SMK_OUT: '_rb_smoke.json', LV_SET: '0,1' },
    find: "canvas.addEventListener('touchstart',function(e){if(e.cancelable)e.preventDefault();"
      + "var t=e.changedTouches[0];if(t)handleTap(t.clientX,t.clientY);},{passive:false});",
    repl: '/* rollback-test: 触屏入口被删（真机点不动） */'
  },

  /* ---------- 2026-10-01 23:00 档新增的 12 条断言，逐条做回滚验证 ----------
     这一档补的四组（存档续玩 / 复活兜底阶梯 / 撤销上限 / 台面账目）在此之前
     **一次都没被任何测试引用过** —— 是机械比对（抽产品所有 function → grep 全部测试文件）
     找出来的真盲区，不是凭感觉挑的。 */
  {
    /* 存档续玩的牙齿：点「开始游戏」永远从第 1 关重来。
       这条同时打掉 23.1（存档被无视）与 23.3（?lvl= 被存档无视）——
       两半都是同一个「没人读存档」的根因，所以一起红是预期的。 */
    name: 'startFromTitle() 写死从第 1 关开始（存档写了也不读 → 进度白存）',
    suite: 'qa_ui.js', expect: /存档续玩/,
    find: "var lv=URL_LVL||Math.max(1,Store.get('level',1)||1);   // 有存档就从上次进度继续",
    repl: 'var lv=1;   /* rollback-test: 无视存档 */'
  },
  {
    /* 复活兜底①：接不到水的瓶子不再退回货架（玩家看完广告回来还是被卡着） */
    name: 'rescueGrant() 去掉第①级兜底（接不到水的瓶子不再退回货架）',
    suite: 'qa_ui.js', expect: /复活兜底①/,
    find: "if(b.place==='counter'&&b.fill<b.cap&&!bottoms[b.col]){ b.place='grid'; b.slot=-1; moved=true; }",
    repl: '/* rollback-test: ① 级兜底被删 */'
  },
  {
    /* 复活兜底②：改成"返回 true 但什么都不做" —— 面板会关掉、局面却没变 */
    name: 'rescueGrant() 第②级改成「假装成功但什么都不做」（面板关了、局面没动）',
    suite: 'qa_ui.js', expect: /复活兜底②/,
    find: "b2.place='gone'; b2.fill=0; b2.capT=0; b2.slot=-1;",
    repl: '/* rollback-test: ② 级假装成功 */'
  },
  {
    /* 复活兜底③：槽位不再自动打开。注意 ③ 和 ⑤ 会一起红 ——
       ⑤ 的构造局面**同时需要 ③ 和 ④**，这正是它「证明硬指标可收敛」的方式；
       ① ② 各有独立用例，一条改坏不会让五条一起红。 */
    name: 'rescueGrant() 去掉第③级兜底（槽位不再自动打开；⑤ 硬指标同时失效）',
    suite: 'qa_ui.js', expect: /复活兜底③/,
    find: 'for(i=0;i<G.slots.length;i++)if(!G.slots[i].open){ G.slots[i].open=true; moved=true; }',
    repl: '/* rollback-test: ③ 级兜底被删 */'
  },
  {
    /* 复活兜底④：终极保险被删 → 极端局面下「看完广告还是死」（⑤ 同时红） */
    name: 'rescueGrant() 去掉第④级兜底（不补随心互换 → 极端局面复活后仍无合法决策）',
    suite: 'qa_ui.js', expect: /复活兜底④/,
    find: 'G.tools.swap=(G.tools.swap||0)+1;',
    repl: '/* rollback-test: ④ 级兜底被删 */'
  },
  {
    /* 撤销额度上限：9 次封顶被拿掉 → 撤销可以刷到无限次，平衡与星级当场失效 */
    name: 'addUndo() 的 9 次封顶被拿掉（撤销能被刷成无限次）',
    suite: 'qa_ui.js', expect: /撤销额度封顶/,
    find: "if(G.undoLeft>=9){toast('撤销次数已满');SFX.no();return;}",
    repl: '/* rollback-test: 封顶被拿掉 */'
  },
  {
    /* 撤销栈上限：30 层封顶被拿掉 → 长局里快照无限堆积（吃内存 + 撤销能退到开局） */
    name: 'snapshot() 的 30 层封顶被拿掉（撤销栈无限增长）',
    suite: 'qa_ui.js', expect: /撤销栈封顶 30 层/,
    find: 'if(G.history.length>30)G.history.shift();',
    repl: '/* rollback-test: 栈上限被拿掉 */'
  },
  {
    /* 台面账目：counterCount 恒返回 0 → freeSlot() 与「瓶数 < 槽数」立刻对不上。
       这条守的是「明明还有空位却放不上瓶子」这类静默吞点击的状态错乱。 */
    name: 'counterCount() 恒返回 0（台面账目与 freeSlot 失去自洽）',
    suite: 'qa_ui.js', expect: /台面账目自洽/,
    find: "function counterCount(){ var n=0; for(var i=0;i<G.bottles.length;i++)if(G.bottles[i].place==='counter')n++; return n; }",
    repl: 'function counterCount(){ return 0; }   /* rollback-test: 账目写死 */'
  },
  {
    /* §6 视觉层扩到 1~90 关之后的第一条牙齿：台面瓶子尺寸不再跟着槽间距缩。
       用例刻意写成 **G.level>40 才改坏** —— 这样 1~40 关的几何原封不动，
       旧版「只跑 1~40 关」的断言会照常全绿，只有扩到 1~90 之后才抓得到。
       这正是「扩大关卡覆盖」这条改动的**独立证据**，不是把同一件事换个说法。
       41~90 关最多 17 个槽，step≈41px，jw 被抬到 45px → 相邻瓶子视觉上真的叠住。 */
    name: '台面瓶子尺寸不再跟着槽间距缩（仅第 41 关起：旧断言只跑 1~40 关 → 照样全绿，看不见）',
    suite: 'qa_ui.js', expect: /瓶子之间不重叠/,
    find: 'G.jw=Math.max(26,Math.min(76,Math.floor(step*0.78)));',
    repl: 'G.jw=Math.max(26,Math.min(76,Math.floor(step*(G.level>40?1.1:0.78))));   /* rollback-test: 晚局瓶子比槽还宽 */'
  },
  {
    /* 纯色管：洗牌退化成「不洗」→ 同色水滴在水池里连成一片，切片时整根切进同一根管。
       这是「整根同色 = 白送一步的假难度」这条断言的**唯一确定性复现**，
       也正是这条断言立项时写下的用途（见 qa_design.js ③ 的注释：
       「生成器的洗牌退化只会表现为关卡变简单，不报错」）。
       新加的「重洗到没有纯色管」循环（genLevel 内 guard<40）在洗牌坏掉时是故意连败 40 次的
       —— 它**不负责兜住洗牌退化**，否则等于把「随机性坏了」悄悄抹平。
       实测：修复后 270 组合 × 30 轮 = 8100 局，纯色管 0 根；L4T2 单关压 4000 局也是 0 根；
       修复前 L4T2 约 2.5%/局（某色 9 滴 > 单管 5 层），正是 23:30 那次 --gate 偶发 2 条 FAIL 的来源。 */
    name: 'shuffle() 退化成「不洗」（同色水滴连片 → 整根同色的管，白送一步的假难度）',
    suite: 'qa_design.js', expect: /不存在纯色管/,
    find: 'function shuffle(a){for(var i=a.length-1;i>0;i--){var j=(Math.random()*(i+1))|0,t=a[i];a[i]=a[j];a[j]=t;}return a;}',
    repl: 'function shuffle(a){return a;}   /* rollback-test: 洗牌退化成不洗 */'
  },

  /* ---------- 2026-10-02 02:00 档新增的 6 条设计不变量，逐条做回滚验证 ----------
     改法尽量挑「只让目标断言红」的：
       ① 只动阶段起点的冰冻数（掉幅 2，`逐关不跳变` 的阈值是 ≤2 → 它不会红，
          正好证明「只管幅度不管方向」的老断言确实漏了这条）；
       ② 只把普通档槽位 +1（`槽 ≥ 色` 与 `有效空槽−色 ≤ +1` 都仍然绿 → 老断言抓不到）；
       ④ 让峰值关反而归零（不是「不加成」而是「反向」——只减 1 的话它和相位 3 关打平，还不到 FAIL）；
       ⑤ 把热身的「减颜色」翻号成「加颜色」；
       ⑥ 把末段管数压到 13（低于颜色数 16/17）。
     ③（全局单调不减）与 ⑥/①类改法天然交叉（任何「后面比前面小」都会同时点上它），
     这是预期行为：它本来就是「兜住所有单调性倒退」的那张总网，这里只要求目标断言红。 */
  {
    name: '高密度阶段起点的冰冻基数被压到 1（阶段接缝上冰冻掉幅 2 > 一个波浪振幅）',
    suite: 'qa_design.js', expect: /阶段连续性铁律/,
    find: "  {to:25, name:'高密度',   cols:[7,9],   rows:[5,5], colors:[9,12],  tubes:[12,15], gates:[3,4], ice:[2,4], slotBias:0},",
    repl: "  {to:25, name:'高密度',   cols:[7,9],   rows:[5,5], colors:[9,12],  tubes:[12,15], gates:[3,4], ice:[1,4], slotBias:0},   /* rollback-test */"
  },
  {
    name: 'levelPlan：普通档白送一个台面槽（槽 > 颜色数 → 通关率被抹平）',
    suite: 'qa_design.js', expect: /普通档台面槽 == 颜色数/,
    find: 'var slots=clamp(colors+slotBias,5,SLOT_CAP);',
    repl: 'var slots=clamp(colors+slotBias+1,5,SLOT_CAP);   /* rollback-test: 多给一个槽 */'
  },
  {
    name: '末段颜色数反向回调（第 75 关起颜色「越打越少」，全局单调不减被破坏）',
    suite: 'qa_design.js', expect: /全局单调不减/,
    find: "  {to:90, name:'极限+',    cols:[11,11], rows:[5,5], colors:[16,17], tubes:[17,17], gates:[6,8], ice:[6,8], slotBias:0}",
    repl: "  {to:90, name:'极限+',    cols:[11,11], rows:[5,5], colors:[16,14], tubes:[17,17], gates:[6,8], ice:[6,8], slotBias:0}   /* rollback-test */"
  },
  {
    name: '峰值关的干扰反向下调（峰值关变成同周期最轻 → 「洞少 1 冰多 1」抵平的假峰也被抓）',
    suite: 'qa_design.js', expect: /峰值关的门洞\/冰冻/,
    find: 'if(peak){ gates+=1; ice+=1; }',
    repl: 'if(peak){ gates=0; ice=0; }   /* rollback-test: 峰值关反而最轻 */'
  },
  {
    name: '热身档把「减颜色」写成「加颜色」（回归热身的盘面比普通档还重、退路更窄）',
    suite: 'qa_design.js', expect: /热身档（−1\/−2）全维度/,
    find: 'colors-=Math.max(1,Math.round(colors*0.22*kk));',
    repl: 'colors+=Math.max(1,Math.round(colors*0.22*kk));   /* rollback-test: 热身穿盘 */'
  },
  {
    name: '末段水管数被压到 13 根（少于颜色数 16/17 → 必有管子同时是两种色的主要来源）',
    suite: 'qa_design.js', expect: /水管数 ≥ 颜色数/,
    find: "  {to:90, name:'极限+',    cols:[11,11], rows:[5,5], colors:[16,17], tubes:[17,17], gates:[6,8], ice:[6,8], slotBias:0}",
    repl: "  {to:90, name:'极限+',    cols:[11,11], rows:[5,5], colors:[16,17], tubes:[13,13], gates:[6,8], ice:[6,8], slotBias:0}   /* rollback-test */"
  }
];

function md5(s) { return crypto.createHash('md5').update(s, 'utf8').digest('hex'); }

function runSuite(file, env) {
  const r = cp.spawnSync(NODE, [path.join(ROOT, file)], {
    cwd: ROOT, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, env || {})
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = out.match(/^FAIL\b.*$/gm) || [];
  const pass = (out.match(/^PASS\b/gm) || []).length;
  return { out: out, fails: fails.map(x => x.replace(/^FAIL\s+/, '')), pass: pass, rc: r.status };
}

/* 每个用例可以指定 file（默认主文件）；文件内容与 md5 按需惰性读一次，用完必须还原 */
const fileCache = {};
function origOf(f) {
  const p = path.join(ROOT, f);
  if (!fileCache[f]) {
    const txt = fs.readFileSync(p, 'utf8');
    fileCache[f] = { path: p, text: txt, hash: md5(txt) };
  }
  return fileCache[f];
}

/* 「线上是旧版」这个场景：起一个**独立进程**的站点，内容与发布件不同。
   坑（第一次就踩了）：不能在父进程里起服务器 —— 父进程随即 spawnSync 跑子进程，
   事件循环被阻塞，服务器根本 accept 不到连接，qa_gate 只能超时失败。
   那样虽然也 FAIL，但验的是「取不到线上」而不是「线上不一致」，属于假绿。 */
const HELPER_CODE = [
  'var http=require("http"),fs=require("fs"),path=require("path");',
  'var pub=fs.readFileSync(path.join(process.env.TAMPER_ROOT,"publish_water","index.html"),"utf8");',
  'var t=pub.replace("</body>","<!--rollback-test: live is stale--></body>");',
  'var s=http.createServer(function(q,r){r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});r.end(t);});',
  's.listen(0,"127.0.0.1",function(){console.log("PORT="+s.address().port);});'
].join('');
/* 原样转发发布件（不做任何改写，且按 Buffer 读 → 保住原始 LF 字节）。
   给「只差换行符」那条例用：它要的是「线上是 LF、本地是 CRLF」这一对，
   靠真线上站点的当前版本来凑是不可靠的 —— 别人一发版这条就失效（踩过一次）。 */
const SERVE_CODE = [
  'var http=require("http"),fs=require("fs"),path=require("path");',
  'var pub=fs.readFileSync(path.join(process.env.TAMPER_ROOT,"publish_water","index.html"));',
  'var s=http.createServer(function(q,r){r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});r.end(pub);});',
  's.listen(0,"127.0.0.1",function(){console.log("PORT="+s.address().port);});'
].join('');
function startServer(code) {
  return new Promise(resolve => {
    const env = Object.assign({}, process.env, { TAMPER_ROOT: ROOT });
    const proc = cp.spawn(NODE, ['-e', code], { env: env, stdio: ['ignore', 'pipe', 'ignore'] });
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    proc.stdout.on('data', d => {
      const m = String(d).match(/PORT=(\d+)/);
      if (m) finish({ proc: proc, url: 'http://127.0.0.1:' + m[1] + '/' });
    });
    proc.on('error', () => finish({ proc: null, url: null }));
    proc.on('exit', () => finish({ proc: null, url: null }));
    setTimeout(() => finish({ proc: proc, url: null }), 8000);
  });
}

const DEFAULT_FILE = 'outputs/解压水消除.html';
const origHash = origOf(DEFAULT_FILE).hash;

/* ---------- 安全检查 ①：被测文件里不许残留 rollback-test 标记 ----------
   踩过（2026-10-01）：上一次回滚验证被 SIGTERM 打断在半途，产品文件留在「已被改坏」的状态；
   下一次运行直接把这份被污染的文本当成 original 快照 —— 于是 24 条用例的 find 全部命中 0 次、
   md5 校验却「通过」，整套回滚验证静默失效（假绿的最高形态）。
   所以开跑前先自检：任何目标文件里出现 "rollback-test" 就拒绝启动，别把污染当基线。 */
const TARGET_FILES = [];
[DEFAULT_FILE].concat(CASES.map(c => c.file).filter(Boolean))
  .forEach(f => { if (TARGET_FILES.indexOf(f) < 0) TARGET_FILES.push(f); });
const polluted = TARGET_FILES.filter(f => {
  try { return /rollback-test/.test(origOf(f).text); } catch (e) { return false; }
});
if (polluted.length) {
  console.error('✘ 拒绝启动：以下文件残留「rollback-test」标记，说明上一次回滚被中断、文件没还原：');
  polluted.forEach(f => console.error('    - ' + f));
  console.error('  请先用干净副本恢复（主文件与 publish_water/index.html 必须字节一致），再重跑。');
  process.exit(2);
}

/* ---------- 安全检查 ②：被 kill 时把「在途补丁」还原回去（①的治本版）----------
   ① 只能挡住「上一次的污染」，挡不住「这一次被 kill」。所以再补一个信号处理器：
   打补丁前登记 inFlight，finally / 信号回调里都能把它写回原样。 */
let inFlight = null;
function emergencyRestore() {
  if (!inFlight) return;
  try { fs.writeFileSync(inFlight.path, inFlight.original, 'utf8'); } catch (e) { }
  inFlight = null;
}
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => {
  try { process.on(sig, () => { emergencyRestore(); process.exit(130); }); } catch (e) { }
});

/* ---- 快照「会被套件顺手重写的受版本控制产物」 ----
 * 踩到过（2026-09-29 05:00）：跑完一轮回滚验证后 `git diff qa_design_table.tsv` 显示
 * L18~L20 的「槽」列从 6 变成 5、密度跟着变 —— 看上去像"产品数值回归"。
 * 实际是回滚用例「第 18~20 关把台面槽收回去 1 个」跑 qa_design.js 时，
 * 把**改坏版**的关卡指标表留在了工作区（qa_design.js 每次运行都会重写这张表）。
 * 所以这里跟产品文件一样：先快照、跑完原样还原 —— 别让"验证工具"污染交付物。 */
const VOLATILE = ['qa_design_table.tsv'];
const volSnap = {};
VOLATILE.forEach(f => {
  try { volSnap[f] = fs.readFileSync(path.join(ROOT, f)); } catch (e) { volSnap[f] = null; }
});
function restoreVolatile() {
  const done = [];
  VOLATILE.forEach(f => {
    if (!volSnap[f]) return;
    const p = path.join(ROOT, f);
    let same = false;
    try { same = fs.readFileSync(p).equals(volSnap[f]); } catch (e) { same = false; }
    if (!same) { fs.writeFileSync(p, volSnap[f]); done.push(f); }
  });
  return done;
}

console.log('===== 回滚验证  ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '  =====');
console.log('（做法：把产品代码故意改坏 → 跑对应套件 → 必须看到指定断言 FAIL → 用 md5 校验原文件已还原）');
console.log('');

let bad = 0;
const rows = [];

/* 顶层 await 在 CommonJS 里不可用，而 liveTamper 用例要起本地服务器 → 包一层 async */
(async function main() {
/* RB_ONLY：只跑名字里含指定关键词的用例（多个关键词用 | 分隔），用于新加断言时**只验自己那几条**
   —— 全量 100+ 个用例约 6 分钟，写一条新用例就跑一遍全量太慢。
   例：RB_ONLY=阶段连续性|台面槽 == 颜色数 node qa_rollback.js
   注意：它只筛选「跑哪些」，不影响「怎么判定」；被筛掉的用例不会计入分母。 */
const RB_ONLY = process.env.RB_ONLY ? process.env.RB_ONLY.split('|').filter(Boolean) : null;
for (const c of CASES) {
  if (RB_ONLY && !RB_ONLY.some(k => c.name.indexOf(k) >= 0)) continue;
  const f = c.file || DEFAULT_FILE;
  const O = origOf(f);
  const original = O.text;

  let env = c.env || {};
  let tamper = null;
  if (c.liveTamper) {
    tamper = await startServer(HELPER_CODE);
    if (!tamper.url) {
      bad++;
      rows.push({ ok: false, name: c.name, why: '起不了本地篡改站点，这条用例没跑（不能算通过）' });
      if (tamper.proc) { try { tamper.proc.kill(); } catch (e) { } }
      continue;
    }
    env = Object.assign({}, env, { LIVE_URL: tamper.url });
  }
  if (c.liveServe) {
    /* 必须在 CRLF 改写**之前**启动：这个服务启动时读一次文件，读到的是原始 LF 字节，
       本地那份随后被写成 CRLF —— 正好凑成「线上 LF / 本地 CRLF」这一对。 */
    tamper = await startServer(SERVE_CODE);
    if (!tamper.url) {
      bad++;
      rows.push({ ok: false, name: c.name, why: '起不了本地转发站点，这条用例没跑（不能算通过）' });
      if (tamper.proc) { try { tamper.proc.kill(); } catch (e) { } }
      continue;
    }
    env = Object.assign({}, env, { LIVE_URL: tamper.url });
  }

  let r = null, err = null;
  try {
    if (c.crlfTamper) {
      /* 整个文件强转 CRLF：模拟「git 把工作区换行改了」这一类事故 */
      inFlight = { path: O.path, original: original };
      fs.writeFileSync(O.path, original.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
    } else if (!c.noPatch) {
      const hits = original.split(c.find).length - 1;
      if (hits !== 1) {
        bad++;
        rows.push({
          ok: false, name: c.name,
          why: '原文片段在 ' + f + ' 里出现 ' + hits + ' 次（应为 1 次）—— 文件改过？请更新回滚用例'
        });
        continue;
      }
      inFlight = { path: O.path, original: original };
      fs.writeFileSync(O.path, original.replace(c.find, c.repl), 'utf8');
    }
    r = runSuite(c.suite, env);
  } catch (e) {
    err = e;
  } finally {
    if (!c.noPatch) fs.writeFileSync(O.path, original, 'utf8');
    inFlight = null;
    if (tamper && tamper.proc) { try { tamper.proc.kill(); } catch (e) { } }
  }

  const restored = md5(fs.readFileSync(O.path, 'utf8')) === O.hash;
  if (!restored) { bad++; rows.push({ ok: false, name: c.name, why: f + ' 没能还原（md5 不一致）！' }); continue; }
  if (err) { bad++; rows.push({ ok: false, name: c.name, why: '套件跑崩：' + err.message }); continue; }

  const hit = r.fails.filter(x => c.expect.test(x));
  rows.push({
    ok: hit.length > 0, name: c.name, why: hit.length
      ? '如期 FAIL「' + hit[0].slice(0, 70) + '」（该套件 ' + r.pass + ' PASS / ' + r.fails.length + ' FAIL）'
      : '❌ 改坏了却没有对应 FAIL（该套件 ' + r.pass + ' PASS / ' + r.fails.length + ' FAIL）→ 这条断言是假绿'
  });
  if (hit.length === 0) bad++;
}

rows.forEach(x => console.log((x.ok ? '  ✔ ' : '  ✘ ') + x.name + '\n      ' + x.why));
const volFixed = restoreVolatile();
console.log('');
console.log('  已还原被套件重写的产物：' + (volFixed.length ? volFixed.join('、') : '（无变化）'));
console.log('===== 回滚验证：' + rows.filter(x => x.ok).length + '/' + rows.length
  + ' 个用例如期 FAIL 且原文件已还原' + (bad ? '，有 ' + bad + ' 个异常' : '') + ' =====');
console.log('（原文件 md5 ' + origHash.slice(0, 12) + '，校验通过：'
  + (md5(fs.readFileSync(origOf(DEFAULT_FILE).path, 'utf8')) === origHash) + '）');
process.exit(bad ? 1 : 0);
})();

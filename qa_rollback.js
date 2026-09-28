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
    name: '命中框从 ±52px 砍到 ±20px',
    suite: 'qa_ui.js', expect: /命中回转/,
    find: 'vx>=b.x-52&&vx<=b.x+52&&vy>=b.y-66&&vy<=b.y+56',
    repl: 'vx>=b.x-20&&vx<=b.x+20&&vy>=b.y-66&&vy<=b.y+56'
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
    name: 'levelPlan：放水关不再减量（breathe 恒 false）',
    suite: 'qa_design.js', expect: /放水关真的放水/,
    find: '  var peak=(phase===4), breathe=(phase===0||phase===1);',
    repl: '  var peak=(phase===4), breathe=false;   /* rollback-test */'
  },
  {
    name: 'levelPlan：门洞上限从 4 提到 6（单局操作量天花板失守）',
    suite: 'qa_design.js', expect: /单局操作量天花板/,
    find: 'gates=Math.min(1+Math.floor((t+1)/4),4);',
    repl: 'gates=Math.min(1+Math.floor((t+1)/4),6);   /* rollback-test */'
  },
  {
    name: 'levelPlan：后期台面槽收到 5（槽 < 颜色数）',
    suite: 'qa_design.js', expect: /台面槽 ≥ 颜色数/,
    find: '    slots=Math.min(5+Math.floor(t/8),6);',
    repl: '    slots=Math.min(4+Math.floor(t/8),5);' + '   /* rollback-test */'
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
    name: 'levelPlan：极限档 tier>=2 整段失效（极限 == 困难）',
    suite: 'qa_design.js', expect: /三档挑战严格更难/,
    find: '  if(tier>=2){',
    repl: '  if(tier>=2&&false){' + '   /* rollback-test */'
  },
  {
    name: '教学关的挑战档把棋盘改大到 20 格 / 5 管',
    suite: 'qa_design.js', expect: /教学关的极限档/,
    find: '  if(tier>0&&lv<=3){cells=12;colors=4;gates=1;ice=0;slots=5;tubes=3;}',
    repl: '  if(tier>0&&lv<=3){cells=20;colors=4;gates=1;ice=0;slots=5;tubes=5;}' + '   /* rollback-test */'
  },
  /* ---------- FIX-02：结算弹窗的三档方块从「纯展示」变成「可点」 ---------- */
  {
    name: '结算弹窗三档方块：删掉命中判定（方块又退回纯展示）',
    suite: 'qa_ui.js', expect: /FIX-02a：结算弹窗点「困难」方块/,
    find: 'if(vx>=tbx-58&&vx<=tbx+58&&vy>=712&&vy<=780){',
    repl: 'if(false){'
  },
  /* ---------- FIX-03：出屏管（本次漏测根因，两条治本断言都必须能抓它）----------
     把 tubeCountFor 的封顶 7 还原成 9 → 高关卡又变成 9 根管，两端 2 根被推到屏外
     （x0=-92，命中盒与 [0,VW] 无交集），正是用户报的「两根管点不到」。 */
  {
    name: '出屏管①（几何）：管数封顶还原成 9 根 → 两端出屏、命中盒与屏幕无交集',
    suite: 'qa_design.js', expect: /出屏管回归/,
    find: '  var n=Math.max(3,Math.min(7,want||3));',
    repl: '  var n=9;   /* rollback-test: 还原成 9 根 */'
  },
  {
    name: '出屏管②（命中路径）：同上，用「夹到屏幕内」的坐标走 tubeAt 点不到那 2 根',
    suite: 'qa_ui.js', expect: /水管命中路径/,
    find: '  var n=Math.max(3,Math.min(7,want||3));',
    repl: '  var n=9;   /* rollback-test: 还原成 9 根 */'
  },

  /* ---------- 05:00 档新增：性能之外的两件事（修 flaky + 上线门禁）----------
     注意：下面几条有的改的是**测试文件**、有的是**发布件**、有的干脆不改文件而是给一个
     「线上是旧版」的场景 —— 所以用例支持 file（默认主文件）/ noPatch / liveTamper 三个开关。 */
  {
    name: '冒烟后不还原档位（脏档放行 → 后面一整簇普通档断言失真）',
    file: 'test_water.js',
    suite: 'test_water.js', expect: /冒烟随机点击后档位已还原/,
    find: '  DBG.G.tier = 0;                                   // ← 还原为普通档（这一行是后续所有普通档断言的前提）',
    repl: '  DBG.G.tier = 1;   /* rollback-test: 故意不还原 */'
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
    name: '门禁 G8a：改了主文件没同步发布件',
    file: 'publish_water/index.html',
    suite: 'qa_gate.js', expect: /≠ 发布件/,
    find: '</body>',
    repl: '<!--rollback-test: 发布件落后于主文件--></body>'
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
    name: 'levelPlan：过渡期第 6 关就把冰冻也上了（新手一次撞两种新干扰）',
    suite: 'qa_design.js', expect: /过渡期 4~8 关/,
    find: 'ice=(lv>=7)?1:0;',
    repl: 'ice=(lv>=6)?1:0;   /* rollback-test: 门洞与冰冻同关新增 */'
  },
  {
    name: 'levelPlan：稳态货架从 6×4=24 格缩成 5×4=20 格（第 19 关起不再恒定）',
    suite: 'qa_design.js', expect: /稳态货架/,
    find: 'else{pc=6;pr=4;}',
    repl: 'else{pc=5;pr=4;}   /* rollback-test: 偷偷把稳态货架改小 */'
  },
  {
    name: 'levelPlan：困难档额外交掉 1 个台面槽（槽位递进不再是 −1/−1，且掉到 4 以下）',
    suite: 'qa_design.js', expect: /三档挑战「只调约束/,
    find: 'if(lv>=6)gates=Math.min(gates+1,4);',
    repl: 'if(lv>=6)gates=Math.min(gates+1,4);slots=slots-1;   /* rollback-test */'
  },
  {
    name: 'genLevel：门洞候选从「≥3 个货架内方向」放宽到「≥2」（角落也能当门洞）',
    suite: 'qa_design.js', expect: /门洞不选角落/,
    find: 'if(dirsIn.length>=3)gateCellStart.push(gc0);',
    repl: 'if(dirsIn.length>=2)gateCellStart.push(gc0);   /* rollback-test: 放开角落 */'
  },
  {
    name: 'genLevel：门洞候选再收紧到「≥4 个货架内方向」（放不下就静默少放几个洞）',
    suite: 'qa_design.js', expect: /实际门洞数 == 计划门洞数/,
    find: 'if(dirsIn.length>=3)gateCellStart.push(gc0);',
    repl: 'if(dirsIn.length>=4)gateCellStart.push(gc0);   /* rollback-test */'
  },
  {
    name: 'genLevel：可解性兜底无条件执行（40 次自检没过就把冰冻整关撤掉）',
    suite: 'qa_design.js', expect: /实际冰冻数 == 计划冰冻数/,
    find: 'if(!solvableOK){',
    repl: 'if(true){   /* rollback-test: 兜底永远执行 */'
  },
  {
    name: 'levelPlan：第 18~20 关把台面槽收回去 1 个（靠砍槽位制造难度）',
    suite: 'qa_design.js', expect: /普通档台面槽位随关卡单调不减/,
    find: '    slots=Math.min(5+Math.floor(t/8),6);',
    repl: '    slots=Math.min(5+Math.floor(t/8),6);if(lv>=18&&lv<=20)slots=5;   /* rollback-test */'
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

console.log('===== 回滚验证  ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '  =====');
console.log('（做法：把产品代码故意改坏 → 跑对应套件 → 必须看到指定断言 FAIL → 用 md5 校验原文件已还原）');
console.log('');

let bad = 0;
const rows = [];

/* 顶层 await 在 CommonJS 里不可用，而 liveTamper 用例要起本地服务器 → 包一层 async */
(async function main() {
for (const c of CASES) {
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
      fs.writeFileSync(O.path, original.replace(c.find, c.repl), 'utf8');
    }
    r = runSuite(c.suite, env);
  } catch (e) {
    err = e;
  } finally {
    if (!c.noPatch) fs.writeFileSync(O.path, original, 'utf8');
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
console.log('');
console.log('===== 回滚验证：' + rows.filter(x => x.ok).length + '/' + rows.length
  + ' 个用例如期 FAIL 且原文件已还原' + (bad ? '，有 ' + bad + ' 个异常' : '') + ' =====');
console.log('（原文件 md5 ' + origHash.slice(0, 12) + '，校验通过：'
  + (md5(fs.readFileSync(origOf(DEFAULT_FILE).path, 'utf8')) === origHash) + '）');
process.exit(bad ? 1 : 0);
})();

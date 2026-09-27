# 解压水消除（Water Sort Relax）

单文件 HTML5 休闲解压小游戏。目标：把水管里混杂的彩色水分装到同色瓶子，接满 3 口自动收走，收完所有瓶子通关。

- **线上**：https://water-sort-relax.app.workbuddy.host/
- **形态**：`outputs/解压水消除.html` 一个文件搞定，双击即玩，零依赖
- **技术**：纯 ES5（兼容老 WebView）· Canvas 2D · WebAudio 现场合成音效（无音频文件）
- **截图**：`screenshots/` 目录
- **自动测试**：271 项断言 / 5 个套件，一条命令跑完 → 见 [`QA_自测体系.md`](QA_自测体系.md) 与 [`qa_report.md`](qa_report.md)
- **商业化验收**：[`outputs/解压水消除_商业化上线验收报告.md`](outputs/解压水消除_商业化上线验收报告.md)


## 当前状态

- **V4.0 开发已完成**（2026-09-27）：P0 全部 18 项 + P1 全部 6 项完成，271 项自动化测试全绿。
- **最终开发提示词**：[`outputs/解压水消除_WorkBuddy最终开发提示词_V4.0.md`](outputs/解压水消除_WorkBuddy最终开发提示词_V4.0.md)
- **Test Mode**：完整可跑（点击广告立即模拟完成发奖），用于开发/调试/自动化测试。
- **Online Mode**：骨架就绪（TapTapAdProvider 运行时检测 bridge），需打包为 TapTap 小游戏 + 申请 Dirichlet(TapADN) 账号后接入真实广告。

## V4.0 新增能力

| 模块 | 说明 |
|---|---|
| **AdService 三层抽象** | `Game → AdService → TestAdProvider / TapTapAdProvider`，频控配置化、奖励幂等、埋点完整 |
| **SaveData 存档** | localStorage 保存关卡/三档解锁/星级/道具/版本号，损坏/版本升级/读取失败自动回退 |
| **Analytics 埋点** | 21 个事件（游戏/留存/广告三大类），console 可观测 + onEvent 回调可接真实分析平台 |
| **真实失败 + 复活** | 无合法操作时弹失败面板；看广告恢复安全快照（每3步保存），保证复活后可继续操作 |
| **三档挑战** | 普通/困难/极限，同一基础关改配置（减空间/加门洞冰冻/加死局风险），状态可存档 |
| **难度重设计** | 1~3关极简快上手、4~8关渐进、9关后决策密度递进；格子上限从35降至28，单局时长大幅缩短 |
| **星级** | 1~3星，基于步数/道具/重开，宽松阈值不惩罚解压玩家 |
| **每日挑战** | 日期固定种子，每天不同配置，标题页入口 |
| **首页动效** | Canvas 气泡粒子 + 瓶子浮动，零外部库 |
| **新手引导** | 前3关轻量 toast 提示 |
| **删除假分享** | 分享按钮替换为首页按钮，所有假分享奖励逻辑移除 |

## 代码结构（全在一个文件里）

| 位置 | 内容 |
|---|---|
| `AD_CFG` | 广告频控配置（rewardedSessionCap/interstitialSessionCap/cooldown/firstSessionProtection/reviveLimit） |
| `Analytics` | 埋点模块：track(event, params) + onEvent 回调 |
| `SaveData` | 存档模块：load/save/reset，localStorage 容错 + 版本号 |
| `TestAdProvider` / `TapTapAdProvider` | 广告提供者：Test 同步发奖；TapTap 运行时检测 bridge，无 bridge 则 onFailure |
| `AdService` | 广告服务：setMode/showRewarded/showInterstitial + 频控 + 幂等 + 埋点 |
| `levelPlan(lv, tier)` | **难度曲线核心**。1~3关写死简单；4~8关渐进；9+关决策密度递进；tier=normal/hard/extreme 修饰 |
| `genLevel(lv, tier)` | 关卡生成 + 可解性自检 + 安全快照初始化 + 埋点 level_start |
| `saveSafeSnap()` / `restoreSafeSnap()` | 复活用安全快照：每3步保存，复活恢复 |
| `checkStuck()` | 运行时死局判定 → failOpen 弹失败面板 |
| `FAIL_OPTS` / `failAction()` | 失败面板：看广告复活 / 重新开始 / 回首页 |
| `calcStars()` | 星级计算（步数/道具/重开，宽松阈值） |
| `handleTap()` | 全部输入 |
| `drawFailPanel()` / `drawTitleBubbles()` | 失败面板 / 首页气泡动效 |
| `render()` / 各 `draw*` | 绘制 |

## 广告接入（生产环境）

1. 申请 TapTap 开发者账号 + 主体资质认证
2. 登录 Dirichlet 媒体管理平台（ssp.dirichlet.cn，原 TapADN）
3. 新建"小游戏"媒体 → 新建激励视频/插屏推广位 → 获取 adUnitId
4. 将单 HTML 打包为 TapTap 小游戏格式
5. 在 `TapTapAdProvider.init({adUnitId: 'xxx'})` 填入真实 adUnitId
6. `AdService.setMode('ONLINE')` 切换到线上模式

> 旧的"TapTap 广告 API"已被 Dirichlet 取代，不要去找旧 API。裸 HTML 在浏览器里无法直接接广告，必须在 TapTap 小游戏运行时内。

## 怎么验证改动没改坏

**一条命令跑完 5 个套件（271 项断言）**：

```bash
node qa_run.js            # 全部（含机器人通关，1~3 分钟）
node qa_run.js --quick    # 跳过机器人，约 5 秒
REPS=3 node qa_run.js     # 快速套件重跑 3 遍，专抓「时好时坏」的 flaky
```

| 套件 | 文件 | 项数 | 守什么 |
|---|---|---|---|
| 功能测试 | `test_water.js` | 167 | 每个按钮点下去的真实后果（道具/撤销/广告/存档/复活/星级/挑战档位） |
| 架构测试 | `qa_arch.js` | 31 | 单文件 / ES5 / 零外部依赖 / 崩溃兜底 / 调试后门默认关闭 |
| 设计测试 | `qa_design.js` | 26 | 关卡数值自洽：水量守恒、可解性、波浪节奏、门洞不相邻、货架不压台面 |
| UI 测试 | `qa_ui.js` | 17 | 命中回转（1015 次探针）、拒绝反馈可见、7 种分辨率、文字无 NaN |
| 合理性测试 | `bot_run.js` | 30 | 机器人贪心通关 1~30 关 |

结果写入 `qa_report.md`（人看）/ `qa_report.json`（机器看）/ `qa_design_table.tsv`（1~40 关指标表）。
**退出码即结论**：全绿 0，有失败 1。

辅助诊断脚本：

```bash
node dbg_diff.js          # 难度量化：开局可选占比 / 贪心通关率 / 绕路比
                          #   可指定关卡：LVS=1,5,10,15,20,25,30 REPS=20 node dbg_diff.js
node dbg_curve.js         # 打印 1~40 关的布局参数
```

### 三条铁律（踩过才写的）

- **每个新断言都必须做「回滚验证」**：故意把产品代码改坏 → 必须看到对应 FAIL → 改回来。
- **不要在同一文件并行改多处**：read-modify-write 竞态会静默丢改动。
- **涉及随机关卡的断言要用固定种子**（`withSeed`），否则同样一行代码两次跑出两个结果。

## 调试后门（测试用）

连点左上角「关卡 N」5 次（2.5 秒内）→ 隐藏选关面板，可跳到第 1~90 关。
URL 带 `?lvl=30` 直接进第 30 关，带 `?diag=1` 把视口尺寸读数画在页面上。
URL 带 `?ad=ONLINE` 切换广告模式为 Online（默认 TEST）。

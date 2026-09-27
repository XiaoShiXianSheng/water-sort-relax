# 给豆包 / GPT 的《解压水消除》V4.0 上线验收评审材料

> 怎么用：这份材料分两半。
> **前半是共享事实底座**（项目是什么、V4.0 改了什么、实测数据、没验证什么、5 个打分维度）。
> **后半是两份独立的提问模板** —— 一份给 GPT、一份给豆包，各自自带全部链接和提问，复制哪一份都能直接用。
> 你要是只问一个 AI，直接跳到对应模板复制就行，不用看前半。

---

## 0. 一句话背景

一个**已经开发完、准备商业化上线**的单文件 HTML5 Canvas 休闲小游戏（Water Sort 类：把水管里混色水分装到同色瓶，接满 3 口收走）。

**这次要你（AI）回答的不是"还能加什么功能"，而是一个判断题：这个版本能不能上 TapTap 开广告变现？** 给 GO / CONDITIONAL GO / NO-GO，并把阻塞项列清楚。

---

## 1. 关键事实（先记住这 6 条，别拿旧口径打分）

1. **线上可玩**：https://water-sort-relax.app.workbuddy.host/
2. **GitHub 公开仓库**：https://github.com/XiaoShiXianSheng/water-sort-relax （分支 main，代码已推送到最新）
3. **单文件，零依赖**：`outputs/解压水消除.html`，约 134 KB（架构测试实测 134674 字节），纯 ES5 + Canvas 2D + WebAudio 现场合成音效，双击即玩、无构建、无框架、无第三方 SDK。
4. **自动化测试 `node qa_run.js` 一条命令跑完 6 个套件：355 项断言，0 失败 0 提醒**（功能 164 / 商业化 66 / 架构 31 / 设计 33 / UI 31 / 机器人 30）。`REPS=3` 重跑无 flaky。
5. **商业化验收报告已出**：P0 18/18、P1 6/6 落地，结论是"**满足上线实验条件**"（不是"已验证能赚钱"）。
6. **真实收入 = 0 数据**。广告位没开通、埋点上报地址留空。所有商业数字都是"待真实数据"，本报告不允许编造。

---

## 2. 必读链接（直接给 AI，复制进对话即可）

**线上试玩**
- https://water-sort-relax.app.workbuddy.host/

**GitHub 仓库**
- https://github.com/XiaoShiXianSheng/water-sort-relax

**单文件游戏源码（raw 直链，134KB 单文件，可以直接读完）**
- https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/outputs/%E8%A7%A3%E5%8E%8B%E6%B0%B4%E6%B6%88%E9%99%A4.html

**商业化上线验收报告（raw 直链，V4.0 §28 交付物）**
- https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/outputs/%E8%A7%A3%E5%8E%8B%E6%B0%B4%E6%B6%88%E9%99%A4_%E5%95%86%E4%B8%9A%E5%8C%96%E4%B8%8A%E7%BA%BF%E9%AA%8C%E6%94%B6%E6%8A%A5%E5%91%8A.md

**九张 V4.0 界面截图（720×1280，有视觉能力的 AI 请逐张看）**

![首页+进度](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_10_home_progress.png)

![第1关教学](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_11_tutorial_lv01.png)

![普通对局](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_12_play_lv09.png)

![第30关（26格硬上限）](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_13_play_lv30_cap26.png)

![失败复活面板（广告入口）](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_14_fail_panel_revive.png)

![三档难度面板](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_15_tier_panel.png)

![结算星级](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_16_win_stars_tier.png)

![提示条](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_17_hint_bar.png)

![选关面板](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_18_level_select.png)

---

## 3. V4.0 相对上一版改了什么（**评审必须基于这一版，不要用旧口径打分**）

1. **广告架构改成三层**：`Game → AdService → TestAdProvider / TapTapAdProvider`，TEST / ONLINE 双环境。ONLINE 只走 TapTap 官方小游戏广告 API（`tap.createRewardedVideoAd` / `tap.createInterstitialAd`，`onClose(res.isEnded)` 为真才发奖）；**没有引入任何第三方广告 SDK**。没配 adUnitId 时自动降级回 TEST，游戏绝不被广告卡死。
2. **广告场景收敛为 3 个**：失败复活 / 道具补充 / 胜利后低频插屏。旧的"台面解锁看广告""假分享奖励"入口全删了。
3. **真实失败 + 保证能复活的复活**：`enterFail()`（撤销用尽 + 道具用尽 + 无合法决策才判负）→ `doRevive()` 四级兜底（开槽 / 恢复安全快照 / 发道具 / 补 1 次随心互换），用 `while(!hasLegalDecision())` 循环**保证复活后一定存在合法决策**——不会出现"看完广告还是死局"。
4. **新增存档与长线钩子**：localStorage 存档（djb2 校验和 + 版本迁移 + 脏档重建 + 隐私模式静默降级）、每日挑战（日期种子，同一天全球同题）、三档难度（普通 / 困难 / 极限，星级解锁）。
5. **难度改成"决策密度"驱动，棋盘不再膨胀**：格子硬上限 **26**（单局 ≤ 34 瓶、≤ 102 杯水）。第 30 关平均步数 **297 → 200**（降约 33%）。
6. **埋点改成零依赖**：`navigator.sendBeacon` 优先 + `Image` beacon 兜底，**刻意不用 `fetch`**（守零依赖红线 + 避开 CORS 预检）。`CFG.trackUrl` 留空时只落本地缓冲。
7. **仍然没有**：用户标识 / 排行榜 / 体力 / 内购付费；真机测试没做；真实广告回调没在 TapTap 运行时内复测。

---

## 4. 已实测的硬数据（全部来自自动测试与验收报告，可查）

### 4.1 测试与稳定性

| 项 | 数据 |
|---|---|
| 自动测试 | 6 套件 / **355 项断言 / 0 FAIL / 0 WARN**，`node qa_run.js` 一条命令跑完，退出码即结论 |
| 分项 | 功能 164 · 商业化 66 · 架构 31 · 设计 33 · UI 31 · 机器人 30 |
| Flaky | `REPS=3` 快速套件重跑 3 遍，通过数完全一致，无不稳定用例 |
| 机器人通关 | 固定种子可复现：**1~30 关 30/30 全通，其中 28 关一次到位**（总尝试 31 次、复活 2 次、重开 1 次） |
| 抗乱点 | 随机乱点 400 次 + 3000 帧无异常；文本无 NaN/undefined |
| 命中回转 | 4715 次探针 / 1~40 关全量取样，点在瓶子身上任意位置都命中它自己 |
| 分辨率 | 7 种（含 360×640 小屏、平板横屏、2x DPR）坐标映射可逆，无点不中 |
| 单文件 / ES5 | 零 `<script src>`、零 `fetch`、零 XHR、无箭头函数 / let / const / class / async；有 `window.onerror` + `unhandledrejection` 兜底 |

### 4.2 商业化链路（都是自动化验证过的行为，不是"我认为"）

- 广告幂等：同一 token 连按 3 次 `onClose` 也只发 1 次奖。
- `onClose(isEnded=true)` 才发奖；提前关闭不发奖；SDK 缺失/抛异常 → 降级放行不卡死。
- 频控全部配置化：单会话激励上限 3、单会话插屏上限 1、插屏冷却 300s、连续通关 3 次才触发、每关复活上限 1 次。
- 广告失败降级可配：`free`（放行）/ `none`（只提示）。
- 存档：往返一致、版本号、djb2 校验和、被篡改/被截断 → 判无效重建、老档迁移、隐私模式 `save()` 静默返回 false 不抛异常。
- 埋点：游戏事件 `level_start / level_complete / moves / tool_used / revive_tool / daily_*`；广告事件 `ad_request / ad_show / ad_cancel / ad_load_fail / ad_complete / reward_granted / ad_cap_blocked / ad_cool_blocked / reward_duplicate_blocked` 等；缓冲有上限（400 条写入后 ≤ 240 条）。

### 4.3 关卡与单局时长

| 关卡 | 格子 | 瓶数 | 色 | 门洞 | 冰冻 | 贪心首战通关率(20次采样) | 平均步数 | 理论下界 |
|---|---|---|---|---|---|---|---|---|
| 1 | 9 | 9 | 3 | 0 | 0 | 100% | 60 | 27 |
| 5 | 9 | 9 | 3 | 0 | 0 | 100% | 60 | 27 |
| 10 | 16 | 20 | 4 | 2 | 1 | 65% | 133 | 60 |
| 15 | 21 | 25 | 5 | 3 | 2 | 40% | 167 | 75 |
| 20 | 26 | 30 | 5 | 4 | 3 | 80% | 200 | 90 |
| 25 | 26 | 30 | 6 | 4 | 4 | 65% | 200 | 90 |
| 30 | 26 | 30 | 6 | 4 | 4 | 45% | 200 | 90 |

- 按真人约 2 秒/步估：第 1 关约 2 分钟，**第 30 关约 6~7 分钟**。
- 绕路比（实际步数 / 理论下界）全关卡稳定在 **2.2** —— 难度来自绕路和决策，不是数值膨胀。
- 难度曲线：1~3 关教学（9 格 / 3 色 / 无门洞 / 开局 100% 可点）；第 6 关只引入门洞、第 7 关只引入冰冻；9 关以后靠决策密度递进，每 5 关一个波浪周期。
- 单局规模硬上限：26 格 / 34 瓶 / 102 杯水；好成绩步数 par ≤ 60。
- ⚠️ 口径说明：上表的"首战通关率"是**单关 20 次独立采样**，§4.1 的"28/30 一次到位"是**机器人从头连打 1~30 关**的口径，两者不是同一件事，别当成数据矛盾。

### 4.4 Money-OS 14 问里，明确的弱项和没答的

| 问题 | 现状 |
|---|---|
| 为什么第二天回来？ | **弱**。每日挑战是唯一日钩子，无推送、无签到、无社交 |
| 每局自然广告机会有多少？ | **待真实数据**。核心矛盾：生成期做了可解性自检 → 真失败率可能偏低 → 复活广告触发少 |
| 第一批用户从哪来？ | **未验证** |
| 第二收入路径？ | **未验证**，V4.0 明确不许硬塞内购 |
| 难度是否形成留存？ | 部分（三档 + 星级 + 波浪曲线），缺长线目标（收集 / 成就） |

### 4.5 完全没验证的（**禁止 AI 当成"已做"**）

真机（Android / iPhone）· 真实广告回调 · 真实 eCPM / 填充率 / 收入 · 真实失败率与广告触发率 · 次日留存 · 渠道 CAC · TapTap 审核通过率 · 弱网表现 · 长时间游戏的发热与内存。

> 已知一项性能观察：headless 软件渲染下第 20 关以后每帧明显变慢，判断是"无 GPU + 虚拟时间不断帧"叠加；但第 30 关逐帧绘制量确实大（26 格 × 30 瓶 × 多层渐变），**建议真机确认中高端 Android 是否满帧**。

---

## 5. 打分表结构（两个 AI 都必须按这 5 个维度打分）

请输出下面这张表，**每项给 1-10 的整数分 + 一句话理由 + 最重要的一个改进动作（只能写一个，必须是两周内能做完的具体动作，不要写"加强运营"这种废话）**：

| 维度 | 分数(1-10) | 一句话理由 | 最重要的一个改进动作 |
|---|---:|---|---|
| 留存设计 | | | |
| 变现路径 | | | |
| 平台竞争力 | | | |
| 技术底座 | | | |
| 测试充分性 | | | |

**上一轮 AI 评分基线（旧口径，仅作对照，请说明哪些分你认同、哪些不认同以及为什么）：**

| 维度 | 上一轮 |
|---|---:|
| 留存设计 | 3 / 10 |
| 变现路径 | 4 / 10 |
| 平台竞争力 | 4 / 10 |
| 技术底座 | 8 / 10 |
| 测试充分性 | 7 / 10 |

---

## 6. 必须回答的阻塞项清单

下面 B1~B4 是**已知开放项**，B5~B14 是我认为还应该追问的。请逐条给：**是不是真阻塞 / 阻塞到什么程度（P0 卡上架 / P1 卡真实收入 / P2 上线后观察）/ 最小解决办法**。

**已知开放项**

- **B1 真实广告回调没在真机 TapTap 运行时验证过。** 现在 Online 链路只在测试里用 mock 的 `global.tap` 跑通过。
- **B2 广告触发次数可能偏低。** 关卡生成做了可解性自检（保证一定可解），这跟"要让玩家失败→看广告复活"在目标上是对冲的。这是本项目最大的商业化开放问题。
- **B3 第 30 关约 200 步 / 6~7 分钟，对休闲玩家是否偏长。** 已从第 297 步压下来，但仍偏长。
- **B4 无用户标识 → 无法做留存归因。** 埋点有事件但没有稳定用户 ID。

**我补充的**

- **B5 隐私政策 / 用户协议缺失。** 埋点在采集行为数据（关卡、时长、广告行为）。国内上架普遍要隐私政策，这是硬门槛还是形式审查？最小合规方案是什么？
- **B6 版号 / ISBN / 备案要求不明。** 一个无内购、纯广告变现的单机休闲小游戏，上 TapTap 小游戏到底要不要版号或备案？这一条直接决定"能不能上"。
- **B7 单文件 HTML → TapTap 小游戏包的落地路径完全没验证。** 打包配置、`tap` bridge 在真包里是否可用、包体与性能限制、以及**最关键的：每改一行是不是都要重新提审**——如果审核周期 3~7 天，"上线后快速迭代做实验"这个策略本身还成不成立？
- **B8 收入天花板从没算过。** 请给一个保守测算：eCPM 合理区间 × 人均日广告次数 × DAU 量级 → 月收入区间，判断这件事值不值得继续投入。（我这边 eCPM、填充率全是 0 数据，所以只能靠你给行业区间，请标注你的假设来源。）
- **B9 广告合规细节。** 激励视频的关闭按钮 / 可跳过 / 不得诱导点击；插屏不得在首屏或加载时弹出；广告文案不得误导（"看广告复活"必须真的复活）；未成年人防沉迷 / 实名是否适用于无内购休闲单机？
- **B10 埋点上报地址 `CFG.trackUrl` 是空的** —— 比 B4 更前置的问题：现在上线等于**盲飞**，数据全留在玩家手机本地，开发者一条都收不到。另外 `window.onerror` 只防白屏，**没有崩溃上报**，线上崩了看不见。
- **B11 内容深度撑不撑得住留存。** 30 关 × 3 档 = 90 局，对一个休闲玩家够不够撑 7 天？出新高关卡是不是每次都要重新提审（和 B7 联动）？
- **B12 广告参数全是拍脑袋定的。** 单会话激励上限 3、插屏"连胜 3 次 + 冷却 300s + 单会话 1 次"，没有任何对照组或行业基线支撑。请给一套**更激进但不过线**的初始参数建议，以及该用哪 2~3 个指标判断该加还是该减。
- **B13 iOS Safari 的 WebAudio 需用户手势才能解锁。** 音效是现场合成的，首次点击前可能全程无声，真机未验证。这是不是会被审核判成"音效失效"？
- **B14 中低端 Android 上第 20 关以后的帧率风险。** 目前只有 headless 软渲染的观察，没有真机性能数据，也没有性能埋点。

---

# 模板一：给 GPT（偏产品判断 + 变现数学 + 平台竞争力）

> 复制下面整段（从"你是一位..."到"请开始"）粘贴给 GPT。

---

你是一位**手游制作人 + 平台商业化负责人**，现在要做一个**上线验收决策**，不是头脑风暴。请直接、少客套，我更想要"这个不行"而不是"可以考虑优化"。

## 背景

一个已开发完成、准备商业化上线的单文件 HTML5 Canvas 休闲游戏《解压水消除》（Water Sort 类：把水管里混色水分装到同色瓶，接满 3 口收走）。独立开发者一人项目，目标是**上 TapTap 小游戏、纯广告变现（IAA），不做内购**。

- 线上试玩：https://water-sort-relax.app.workbuddy.host/
- GitHub：https://github.com/XiaoShiXianSheng/water-sort-relax
- 单文件源码（可直接读）：https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/outputs/%E8%A7%A3%E5%8E%8B%E6%B0%B4%E6%B6%88%E9%99%A4.html
- 商业化验收报告：https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/outputs/%E8%A7%A3%E5%8E%8B%E6%B0%B4%E6%B6%88%E9%99%A4_%E5%95%86%E4%B8%9A%E5%8C%96%E4%B8%8A%E7%BA%BF%E9%AA%8C%E6%94%B6%E6%8A%A5%E5%91%8A.md

九张界面截图（请逐张看，重点看首页、失败复活面板、三档面板、结算）：

![首页](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_10_home_progress.png)
![教学](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_11_tutorial_lv01.png)
![对局](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_12_play_lv09.png)
![第30关](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_13_play_lv30_cap26.png)
![失败复活](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_14_fail_panel_revive.png)
![三档](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_15_tier_panel.png)
![结算](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_16_win_stars_tier.png)
![提示条](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_17_hint_bar.png)
![选关](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_18_level_select.png)

## 这一版（V4.0）的关键事实，请务必基于这些打分，不要用你训练数据里的旧版印象

- 单文件 134KB，纯 ES5 + Canvas 2D + WebAudio 合成音效，零依赖、零第三方 SDK、双击即玩。
- 广告架构 `Game → AdService → TestAdProvider / TapTapAdProvider`，只走 TapTap 官方 `tap.createRewardedVideoAd` / `createInterstitialAd`，`onClose(res.isEnded)` 为真才发奖；没配 adUnitId 自动降级 TEST。**没引入任何第三方广告 SDK。**
- 广告只有 3 个场景：失败复活 / 道具补充 / 胜利后低频插屏（"台面解锁看广告""假分享奖励"已删除）。
- 有真实失败机制（撤销用尽 + 道具用尽 + 无合法决策才判负），复活有 4 级兜底 + `while(!hasLegalDecision())` 循环，保证复活后一定存在合法决策。
- 有 localStorage 存档（校验和 / 版本迁移 / 脏档重建 / 隐私模式降级）、每日挑战（日期种子）、三档难度（普通 / 困难 / 极限，星级解锁）。
- 难度改成"决策密度"驱动，格子硬上限 26（单局 ≤34 瓶 / ≤102 杯水）。第 30 关平均步数 297 → 200。
- 自动化：`node qa_run.js` 一条命令跑完 6 套件 **355 项断言 0 失败 0 提醒**（功能164/商业化66/架构31/设计33/UI31/机器人30），`REPS=3` 无 flaky；机器人固定种子 1~30 关 30/30 全通、28 关一次到位。
- **真实收入 = 0 数据**：广告位未开通、埋点上报地址留空、真机未测、真实广告回调未在 TapTap 运行时复测。

## 实测数据（可直接引用，不要质疑这些是"自说自话"，但你可以质疑它们能不能说明问题）

- 单关 20 次采样：第 1/5 关首战通关 100%、60 步；第 10 关 65%、133 步；第 15 关 40%、167 步；第 20 关 80%、200 步；第 25 关 65%、200 步；第 30 关 45%、200 步（理论下界 90）。绕路比全关卡稳定 2.2。
- 按真人约 2 秒/步估：第 1 关约 2 分钟，第 30 关约 6~7 分钟。
- 广告频控：单会话激励上限 3、单会话插屏 1 次、插屏冷却 300s、连续通关 3 次才触发、每关复活上限 1 次。
- 已知弱项：次日留存钩子只有每日挑战（无推送/签到/社交）；可解性自检可能压低真失败率从而压低复活广告触发；第一批用户从哪来未验证；第二收入路径未验证。

## 请你输出三件事

### 一、五维打分（照抄这张表，每项 1-10 整数 + 一句话理由 + 最重要的一个改进动作，动作只能写一个且两周内能做完）

| 维度 | 分数(1-10) | 一句话理由 | 最重要的一个改进动作 |
|---|---:|---|---|
| 留存设计 | | | |
| 变现路径 | | | |
| 平台竞争力 | | | |
| 技术底座 | | | |
| 测试充分性 | | | |

上一轮 AI 给的基线（旧口径，仅作对照）：留存 3 / 变现 4 / 平台 4 / 技术 8 / 测试 7。请说明哪几项你认同、哪几项不认同、为什么。

### 二、变现数学（重点，请给具体算式）

1. 按你对国内 IAA 休闲小游戏的行业认知，给**激励视频 / 插屏的 eCPM 合理区间**，并标注这是哪类平台、哪类人群的量级。
2. 结合本作 3 个广告场景 + 上面的频控参数，估算**人均日广告次数（次/DAU/日）的乐观 / 中性 / 悲观三档**，说明你为什么这么估。
3. 给一个 **DAU → 月收入**的换算表（比如 DAU 100 / 1000 / 10000 三档），明确说明这套参数下**天花板在哪**。
4. 直接回答：**以这个天花板，一个独立开发者继续投入 3 个月是否划算？** 如果你的答案是"不划算"，请说应该改成什么（换品类？换平台？加内购？还是干脆当作品集）。

### 三、GO / CONDITIONAL GO / NO-GO 判定

给一个明确判定，并列出：
- **P0（卡上架，必须先解决）**
- **P1（卡真实收入，上架后必须尽快解决）**
- **P2（上线后观察，用数据决定）**

每一条写清楚：问题 → 为什么这个级别 → 最小解决办法（要具体到"做什么、多久能做完"）。

必须逐条回应这些阻塞项（B1~B4 是我已知的，B5~B14 是我补充的，你认为哪条被我高估或低估了请直接说）：

- B1 真实广告回调未在真机 TapTap 运行时验证
- B2 广告触发次数可能偏低（可解性设计 vs 广告触发的内在冲突）
- B3 第 30 关 200 步 / 6~7 分钟，对休闲玩家是否偏长
- B4 无用户标识 → 无法做留存归因
- B5 隐私政策 / 用户协议缺失（埋点在采行为数据）
- B6 无内购纯广告的单机休闲游戏上 TapTap，版号 / 备案到底要不要
- B7 单文件 HTML 打 TapTap 小游戏包的落地路径未验证；以及"每次改动都要重新提审"会不会直接废掉"上线后快速迭代做实验"这个策略
- B8 收入天花板从没算过（这块你已经算了，请回指你的结论）
- B9 广告合规：激励视频关闭按钮 / 可跳过 / 不得诱导；插屏不得首屏弹出；未成年人防沉迷是否适用
- B10 埋点上报地址为空 = 上线盲飞；无崩溃上报
- B11 内容深度：30 关 × 3 档 = 90 局，够不够撑 7 天留存
- B12 广告参数全是拍脑袋（激励上限 3 / 插屏连胜 3 次 + 冷却 300s + 会话 1 次），请给一套更激进但不过线的初始参数和 2~3 个判断该加该减的指标
- B13 iOS Safari WebAudio 需手势解锁，首次点击前无声，是否会被判"音效失效"
- B14 中低端 Android 第 20 关以后帧率风险，无真机性能数据、无性能埋点

### 四、最后回答两个直球问题

1. **如果只能改一件事就上架，你改什么？**
2. **材料里有哪些地方你认为自相矛盾、数据可疑、或者我在自我安慰？** 请直接指出来，不用客气。

请开始。

---

# 模板二：给豆包（偏国内小游戏平台合规 + 上架审核风险 + 留存机制本土化）

> 复制下面整段（从"你是一位..."到"请开始"）粘贴给豆包。

---

你是一位**国内小游戏平台的商业化/合规审核负责人**（熟悉 TapTap 小游戏、微信小游戏、抖音小游戏的审核口径与变现规则），现在要做一个**上线验收决策**，不是头脑风暴。请直接、少客套，我更想听"这个会被打回"而不是"建议完善一下"。

## 背景

一个已开发完成、准备商业化上线的单文件 HTML5 Canvas 休闲游戏《解压水消除》（Water Sort 类：把水管里混色水分装到同色瓶，接满 3 口收走）。独立开发者一人项目，目标：**上 TapTap 小游戏，纯广告变现（IAA），本期不做内购**。

- 线上试玩：https://water-sort-relax.app.workbuddy.host/
- GitHub：https://github.com/XiaoShiXianSheng/water-sort-relax
- 单文件源码：https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/outputs/%E8%A7%A3%E5%8E%8B%E6%B0%B4%E6%B6%88%E9%99%A4.html
- 商业化验收报告：https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/outputs/%E8%A7%A3%E5%8E%8B%E6%B0%B4%E6%B6%88%E9%99%A4_%E5%95%86%E4%B8%9A%E5%8C%96%E4%B8%8A%E7%BA%BF%E9%AA%8C%E6%94%B6%E6%8A%A5%E5%91%8A.md

九张界面截图（请逐张看，重点看首页、失败复活面板、三档面板、结算页和提示条，判断审核视角下的合规与体验问题）：

![首页](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_10_home_progress.png)
![教学](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_11_tutorial_lv01.png)
![对局](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_12_play_lv09.png)
![第30关](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_13_play_lv30_cap26.png)
![失败复活](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_14_fail_panel_revive.png)
![三档](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_15_tier_panel.png)
![结算](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_16_win_stars_tier.png)
![提示条](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_17_hint_bar.png)
![选关](https://raw.githubusercontent.com/XiaoShiXianSheng/water-sort-relax/main/screenshots/v4_18_level_select.png)

## 这一版（V4.0）的关键事实，请务必基于这些打分

- 单文件 134KB，纯 ES5 + Canvas 2D + WebAudio 现场合成音效，零依赖、零第三方 SDK、双击即玩。
- 广告架构 `Game → AdService → TestAdProvider / TapTapAdProvider`，**只走 TapTap 官方小游戏广告 API**（`tap.createRewardedVideoAd` / `tap.createInterstitialAd`，`onClose(res.isEnded)` 为真才发奖）。**没有内嵌任何第三方广告 SDK**；没配 adUnitId 时自动降级 TEST，游戏绝不被广告卡死。
- 广告场景只有 3 个：失败复活 / 道具补充 / 胜利后低频插屏（旧版"台面解锁看广告""假分享奖励"入口已删）。
- 有真实失败 + 复活机制：撤销用尽、道具用尽、无合法决策才判负；复活有 4 级兜底并用 `while(!hasLegalDecision())` 保证复活后一定有合法决策，不会出现"看完广告还是死局"。
- 有 localStorage 存档（djb2 校验和 + 版本迁移 + 脏档重建 + 隐私模式静默降级）、每日挑战（日期种子）、三档难度（普通 / 困难 / 极限，星级解锁）。
- 埋点：本地缓冲 + `navigator.sendBeacon` / `Image` beacon 兜底，**刻意不用 fetch**；上报地址 `CFG.trackUrl` 当前留空（只落本地）。采集的是关卡进度、步数、道具使用、广告行为等**行为数据，不采集手机号/通讯录/定位**。
- 自动化：`node qa_run.js` 跑完 6 套件 **355 项断言 0 失败 0 提醒**（功能164/商业化66/架构31/设计33/UI31/机器人30），`REPS=3` 无 flaky；机器人固定种子 1~30 关 30/30 全通、28 关一次到位。
- **未做**：真机测试、真实广告回调复测、广告位开通、真实收入数据、用户标识、内购。

## 实测数据（可直接引用）

- 单关 20 次采样首战通关率：第 1/5 关 100%、第 10 关 65%、第 15 关 40%、第 20 关 80%、第 25 关 65%、第 30 关 45%；平均步数第 1 关 60、第 30 关 200（旧版 297）。绕路比稳定 2.2。
- 按真人约 2 秒/步估：第 1 关约 2 分钟，第 30 关约 6~7 分钟。
- 广告频控：单会话激励上限 3、单会话插屏 1 次、插屏冷却 300s、连续通关 3 次才触发、每关复活上限 1 次。
- 已知弱项：次日留存钩子只有每日挑战（无推送 / 签到 / 社交）；可解性自检可能压低真失败率 → 复活广告触发少；第一批用户从哪来未验证。

## 请你输出四件事

### 一、五维打分（照抄这张表，每项 1-10 整数 + 一句话理由 + 最重要的一个改进动作，动作只能写一个且两周内能做完）

| 维度 | 分数(1-10) | 一句话理由 | 最重要的一个改进动作 |
|---|---:|---|---|
| 留存设计 | | | |
| 变现路径 | | | |
| 平台竞争力 | | | |
| 技术底座 | | | |
| 测试充分性 | | | |

上一轮 AI 给的基线（旧口径，仅作对照）：留存 3 / 变现 4 / 平台 4 / 技术 8 / 测试 7。请说明哪几项你认同、哪几项不认同、为什么。

### 二、上架合规与审核风险（这是重点，请按国内实际口径回答，不确定的请标明"需向平台确认"而不是编）

1. **资质**：无内购、纯广告变现的单机休闲小游戏上 TapTap 小游戏，到底要不要版号 / ISBN / 备案？个人开发者主体能不能上？需要哪些材料？
2. **隐私合规**：现在没有隐私政策、没有用户协议，但埋点在采行为数据。审核会不会直接打回？最小可用的隐私政策要包含哪些条款？**首次启动是否需要弹窗授权**（尤其是本地存储与行为数据采集）？
3. **广告合规**：激励视频的关闭按钮 / 可跳过 / 不得诱导点击，国内平台的实际执行标准是什么？插屏在哪些时机弹会被判违规（首屏、加载中、结算瞬间）？"看广告复活"这类文案有没有雷区？
4. **未成年人**：无内购、无社交、无 UGC 的休闲单机，是否仍需实名 / 防沉迷 / 未成年人模式？
5. **单文件 HTML 打小游戏包**：TapTap 小游戏对包体、入口文件、运行时 API 的实际要求有哪些？`tap.*` 广告 bridge 在真包里有什么已知的坑？**每次改一行代码是否都要重新提审**（这直接决定"上线后快速迭代做实验"成不成立）？
6. 请顺便给一个**提审材料清单**（我能提前准备的都列出来）。

### 三、留存机制本土化（国内玩家口味）

1. 目前只有"每日挑战 + 三档难度 + 星级"，**没有签到、没有推送、没有社交、没有排行榜**。以国内小游戏的通行做法看，最小成本、最高性价比的**次日/7 日留存钩子**是哪 2~3 个？请按"成本从低到高"排，并说明哪些在国内是**必须做**、哪些是**可选**。
2. 国内小游戏常用的"分享得奖励""看广告双倍""签到日历"这类机制，**哪些在 TapTap 生态里反而是扣分项**（TapTap 用户口碑敏感）？
3. 第 30 关单局 6~7 分钟，按国内休闲玩家的耐受度是偏长还是正常？如果偏长，国内通行做法是"压缩单局"还是"加中途存档点"？
4. 30 关 × 3 档 = 90 局的内容量，够不够撑 7 天？国内同类游戏的内容投放节奏通常是怎样的（一次上多少关、多久更新一次）？

### 四、GO / CONDITIONAL GO / NO-GO 判定

给明确判定，并列出：
- **P0（卡上架，必须先解决）**
- **P1（卡真实收入，上架后必须尽快解决）**
- **P2（上线后观察，用数据决定）**

每条写清楚：问题 → 为什么这个级别 → 最小解决办法（具体做什么、多久能做完）。

必须逐条回应这些阻塞项（B1~B4 是我已知的，B5~B14 是我补充的，你认为哪条被我高估或低估了请直接说）：

- B1 真实广告回调未在真机 TapTap 运行时验证
- B2 广告触发次数可能偏低（可解性设计 vs 广告触发的内在冲突）
- B3 第 30 关 200 步 / 6~7 分钟是否偏长
- B4 无用户标识 → 无法做留存归因
- B5 隐私政策 / 用户协议缺失
- B6 版号 / 备案要求不明
- B7 单文件打小游戏包路径未验证 + 每次改动重新提审的迭代成本
- B8 收入天花板没算过（请给国内 IAA 的 eCPM 与人均日广告次数的行业区间，并标注假设来源）
- B9 广告合规细节（激励关闭按钮 / 插屏时机 / 文案雷区 / 未成年人）
- B10 埋点上报地址为空 = 上线盲飞；无崩溃上报
- B11 内容深度 90 局够不够撑 7 天
- B12 广告参数全是拍脑袋（激励上限 3 / 插屏连胜 3 次 + 冷却 300s + 会话 1 次），请给一套符合国内平台习惯的初始参数和判断指标
- B13 iOS Safari WebAudio 需手势解锁 → 首次点击前无声
- B14 中低端 Android 第 20 关以后帧率风险，无真机性能数据、无性能埋点

### 五、最后回答两个直球问题

1. **如果只能改一件事就提审，我改什么？**
2. **材料里有哪些地方你认为自相矛盾、数据可疑、或者我在自我安慰？** 直接指出来，不用客气。

请开始。

---

## 附：拿回答案后怎么判断 AI 是不是在糊弄你

- **只给建议不给判定的** —— 没用。必须看到 GO / CONDITIONAL GO / NO-GO 三个词中的一个。
- **把"没做真机测试"说成"风险很低，可以先上"却不给 P0/P1 分级的** —— 说明它没进入验收角色。
- **打分全是 6~7 分的** —— 典型和稀泥，追问"哪一项最差，为什么"。
- **说"建议接入第三方广告聚合 SDK"的** —— 直接驳回：本项目架构红线是零依赖，且 TapTap 小游戏只认官方 API + TapADN/Dirichlet 推广位。
- **给 eCPM 却不标假设来源的** —— 让它标，或者自己按悲观档再算一遍。
- **说"补个签到系统就好"的** —— 追问成本：做签到要几天？会不会把每日挑战的日钩子冲淡？

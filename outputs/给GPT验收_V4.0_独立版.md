# 给 GPT 的《解压水消除》V4.0 上线验收（独立版）

<!-- V41-BANNER -->
> ⚠️ **本文档写于 V4.0 时期，其中一部分数据已过期。**
>
> 当前线上版本：**V4.1 / 152352 字节 / md5 `516536F2AD7BB1A2CB14E0F878A39B60`**
> 当前测试数字：**439 断言 PASS / 0 FAIL，回滚验证 50/50，10 条上线硬条件全过**
>
> 之后又修了 8 个由内部代码评审挖出的真 bug（万能指白扣、撤销步数账、
> 广告上限文案、每日挑战被重开降级、道具栏文字重叠、三星判定、广告撤销封顶等），
> **本文档不包含这些内容**。
>
> 👉 **给 GPT / 豆包做评审，请用最新这份：`outputs/给GPT和豆包_V4.1_本轮修复验证.md`**


> **怎么用**：整份复制粘给 GPT。这份自带全部链接、截图、事实、打分表和阻塞项，GPT 不需要看别的任何东西就能答。

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
- 自动化：`node qa_run.js --gate` 一条命令跑完 7 套件 **399 项 0 失败 0 提醒**（功能165/商业化66/架构31/设计42/UI49/机器人40/门禁6），`REPS=2` 无 flaky；机器人固定种子 1~40 关 40/40 全通。
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

## 【重要】结论请按下面这个固定格式输出

这份结论会被复制回开发侧直接执行，所以**必须结构化**，不要写成散文。请在最后单独附一段：

```
【验收结论】
判定：GO / CONDITIONAL GO / NO-GO（三选一）

【五维打分】
留存设计：X/10 —— 一句话理由
变现路径：X/10 —— 一句话理由
平台竞争力：X/10 —— 一句话理由
技术底座：X/10 —— 一句话理由
测试充分性：X/10 —— 一句话理由

【变现数学】
eCPM 区间（标注假设来源）：
人均日广告次数 悲观/中性/乐观：
DAU 100 / 1000 / 10000 月收入：
投入 3 个月是否划算：是 / 否（否的话改成什么）

【P0 卡上架】
1. 问题 → 最小解决办法（多久能做完）
2. ...

【P1 卡真实收入】
1. ...
2. ...

【P2 上线后观察】
1. ...
2. ...

【只改一件事就上架】
改什么 + 为什么

【你认为我在自我安慰的地方】
1. ...
```

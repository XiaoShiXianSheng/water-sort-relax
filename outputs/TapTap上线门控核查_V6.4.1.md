# TapTap 上线门控核查 —— V6.4.1「解压水消除」

> 任务号：REL-PHASE7-GATE-001 ｜ 角色：release-ops-lead
> 核查时间基准：**2026-10-04（北京时间）**
> 对象：TapTap 开发者 453221 / 游戏 956289，H5 小游戏「解压水消除」
> 本次核查**全程只读**（read 类命令），未执行任何写操作：未重提审、未换包、未 create-draft、未重新绑定 package、未改文件、未 commit、未 deploy。

---

## ① 发布门控判定

# 判定：**PASS（技术侧已完整上线生效）**

附带 **CONCERNS 2 项（不阻塞本次上线，但阻塞下一次提审）**，因此整体记为 **PASS + CONCERNS**。

### 1.1 证据链（全部来自只读 API 实时返回）

| # | 证据源（命令） | 关键返回 | 判定 |
|---|---|---|---|
| E1 | `app list-app-versions` | `V-20261004-1` / `status: online` / `status_label: 已上线` / `status_value: 4` / `last_event: published` | ✅ 版本已上线 |
| E2 | `app get-app-version --data '{"version":"V-20261004-1"}'` | `status: online`、`已上线`、`revision 1031065`；事件链 `draft_created → review_submitted → review_approved → published` 全部闭环 | ✅ 发布链路完整走完 |
| E3 | `package-management list-h5-packages` | `package_id 261944`、`file_size 151221`、`is_releasing: true`、`min_runtime_version "2.4.0"`；上一包 `261233 (V6.4.0)` 已回落 `is_releasing: false` | ✅ 261944 是当前生效发布包 |
| E4 | `app +list` | `956289  解压水消除  已上线` | ✅ 后台侧游戏状态为已上线 |
| E5 | 前台页面实测 `https://www.taptap.cn/app/956289` | 页面完整渲染：标题「解压水消除」、游戏介绍、创作者的话、厂商「聆听秋风的工作室」、供应商「上海创巴科技有限公司」、隐私政策链接 | ✅ 前台商店页为**完整线上态**，无「敬请期待」占位 |

### 1.2 版本事件时间线（由 E2 的 `logs` 时间戳换算，北京时间）

| 时刻 | 事件 | 说明 |
|---|---|---|
| 2026-10-04 **10:31:46** | `draft_created` | 草稿版本创建 |
| 2026-10-04 **13:47:23** | 包 261944 `updated_time` | 与 V6.4.1 上传/绑定时间吻合 |
| 2026-10-04 **16:02:50** | `review_submitted` | 提交审核 |
| 2026-10-04 **16:30:27** | `review_approved` + `published`（同一时刻，entry_type=2） | 审核通过并发布 |

> **关键中间态**：`review_submitted → published` 之间有 **27 分 37 秒** 的审核窗口（16:02:50–16:30:27）。这段时间前台商店页会**依法显示「敬请期待」**。见 ②。

### 1.3 门控判定细则

- **包体正确性**：`file_size 151221` ⟶ 与 `outputs/tap_upload_v6.4.1.zip` 一致（151221 字节）；H5 包内 `min_runtime_version = 2.4.0`，各包历史一致，无版本倒挂。
- **包位正确性**：261944 为当前 `is_releasing` 包，261233(V6.4.0) 已回落，无双包同时占位。
- **draft 残留**：**有，但属正常现象** —— 见下面 CONCERNS-1，本次核查确认存在一份**空的资料/包体草稿**，它**不影响已上线的前台页面**（已由 E5 实测证伪），但会阻塞下一次提审。
- **回滚预案**：本次为只读核查，未触发任何回滚；撤回到 V6.4.0(261233) 的可行路径仍存在（该包 `is_releasing=false` 且 `status: ready`）。

### 1.4 两项 CONCERNS（不阻塞本次上线）

**CONCERNS-1：当前资料草稿为「空草稿」（阻塞下一次提审）**
- `app get-app-module` 对**全部 9 个模块**（`assets-upload / basic-info / developer-info / other-settings / package / platform-status / profile-promotion / release-settings / windows-exclusive`）返回 **`revision: 0`**，且**所有字段 `filled: false`**。
- `app analyze-app-status` 报 Blockers：
  - `MISSING_REQUIRED`：`title`、`category`、`icon`、`developer_type`、`app_platforms`（5 个必填项未填）
  - `MISSING_PACKAGE`：`package`（尚未选择主包体）
- `app list-packages` 返回 **`current_bindings: []`**，`package_slots.main.available: true` 但无实际绑定；`apk_mini_game_play.available: false`、`windows.available: false`。
- ⚠️ **证据冲突（须人工确认）**：E3 显示 261944 `is_releasing: true`，但 `app list-packages` 显示 `current_bindings` 为空、`app analyze-app-status` 报 MISSING_PACKAGE。`is_releasing=true` 与「无主包体绑定」不能同时成立。
  - **我的判读**：`is_releasing` 更可能语义为「该包处于发布流中/是本轮发布包」，而不是「已绑定主包」。真实主包绑定状态**需人工到后台「包体」页看一眼**才能定论。
  - **不会造成「敬请期待」**：因为前台页面 E5 已实测完整在线，若主包真的没绑，页面不会渲染出完整资料。
- **结论**：这是**发布后自动开启的下一轮空白草稿**（TapTap 在发布后会为下次编辑开新草稿）。**下次提审前必须重填必填项 + 重选主包体**，否则 precheck 必挂。

**CONCERNS-2：8 项资质全部 `pending_upload`（合规侧）**
`qualification:analyze` 返回，绑定版本 `V-20261004-1`：

| qualification_type | status |
|---|---|
| game-license（版号） | pending_upload |
| icp-filing（ICP 备案） | pending_upload |
| privacy-compliance（隐私合规） | pending_upload |
| anti-addiction（防沉迷） | pending_upload |
| ai-declaration | pending_upload |
| software-copyright（软著） | pending_upload |
| authorization-letters（授权书） | pending_upload |
| security-assessment（安全评估） | pending_upload |

与项目历史文档《TapTap上架_缺口盘点与操作进度_V6.2.md》记载一致：个人主体 + 无版号，只能走「开放试玩」形式，不能走「正式上线」。**该项不阻塞本次 H5 包体上线。**

---

## ②「前台敬请期待」根因分析（分层 + 证据等级）

> 先给结论：**V6.4.1 技术上已完整上线（① 已证）。「敬请期待」最可能是 (a) 审核窗口期/索引缓存延迟，(d) 的变体；证据等级中等偏高。 (b) 是明确的搜索可用性隐患但不构成阻塞； (c) 中「主包体未绑定/资质未提交」两项在当前证据下被 E5 前台实测「降权」，但需人工复核。**

### 根因 A：审核窗口期 + 前台索引缓存延迟 —— **最可能（证据等级：中·高）**

- **证据**：E2 事件链显示 `review_submitted 16:02:50 → published 16:30:27`，中间 **27 分 37 秒**。TapTap 在**提交审核那一刻**就会把前台切到「即将上线/敬请期待」，审核通过后才切回。
- 用户反馈时间点与「约 16:30 平台显示 online」高度重叠。**最朴素的解释：用户看到的是 16:02:50–16:30:27 这 27 分钟里的前台状态。**
- 次要可能：即使 16:30:27 已发布，**前台商店搜索索引/列表卡片有独立缓存刷新周期**（分钟级到小时级），详情页已刷新而**搜索结果卡片仍是「敬请期待」**——这恰好能解释「搜索时看到敬请期待 + 点进去玩不了」。
- **支持性证据**：E5 实测 `https://www.taptap.cn/app/956289` **详情页完整在线、标题为「解压水消除」、无敬请期待**。
- **反证/不确定**：我**无法取到 TapTap 搜索结果页的 HTML**（SPA 渲染，WebFetch 返回空）——**搜索索引是否仍显示敬请期待，证据不足，需人工到无痕窗口/手机端实测确认**。

### 根因 B：展示名不一致导致搜索不到 —— **真实隐患（证据等级：中）**

- 后台 API 实测：`app +list` → **解压水消除**；前台页面 → **解压水消除**；说明「解压水消除」是当前真实展示名。
- 「解压水去除」仅出现在**后台界面面包屑/版本列表**（历史遗留），**从未进入任何 API 字段**。
- **影响**：它是**搜索误导源**而非阻塞项——搜「解压水消除」可正常命中；但若有人搜「解压水去除」或复制错名字，会空手而归。
- **不确定点**：为什么面包屑会显示「解压水去除」？当前空草稿状态下 title 字段 `filled:false`，面包屑回退到哪个名字需人工在后台看一眼。**此项证据不足，需人工确认后才能定性。**

### 根因 C：H5 小游戏缺前台展示必需配置 —— **部分成立，但被实测降权（证据等级：中，其中主包体项偏弱）**

逐条核对：

| 子项 | 实测 | 是否阻塞本次 |
|---|---|---|
| **R1 主包体绑定未生效** | `list-packages.current_bindings=[]`、`analyze-app-status` 报 `MISSING_PACKAGE` | ⚠️ **存疑**。与 E3 `is_releasing=true` 冲突。若真未绑定 → 前台无播放入口 → 有道理（见 ②-A 补充）。**证据不足，需人工看后台包体页** |
| **R2 二分屏/小游戏分类** | `basic-info.category` 当前草稿为空 | 仅影响**下一次**提审 |
| **R3 截图（screenshots）** | `assets-upload.screenshots` `current_count 0 / missing_count 3`，但字段 `state: suggested`（**非必填**） | ❌ 不阻塞 |
| **R4 视频/宣传图** | `gameplay_demo_video`/`banner_4` 为空，但均为 `suggested`/`optional` | ❌ 不阻塞 |
| **R5 `min_runtime_version=2.4.0`** | 已满足（全包一致 2.4.0） | ❌ 不阻塞 |
| **R6 `apk_mini_game_play` 小游戏播放位** | `available: false`、`expected.kind: none` | ⚠️ 无法从 API 判断是否 required；**证据不足** |

> 补充 C-R1 的可能解释：若 261944 确实**没有**真正绑定到 main 槽位，前台详情页能渲染资料、但**「试玩/下载」入口缺失或处于未就绪态**——这在现象上与「敬请期待、点进去玩不了」完全吻合，是**唯一能同时解释"详情页有内容 + 点进去玩不了"的假设**。优先级应提到 A 之上做人工验证。

### 根因 D：其他

- **D-1（高优先）**：**主包体绑定态异常** → 见 C-R1，是最需要人工拍板的一项。
- **D-2**：资质 8 项 `pending_upload`。但《TapTap上架_缺口盘点与操作进度_V6.2.md》引官方口径：**「不涉及内购的小游戏无需提交版号，但前置备案仍是正式上线前流程」**，且**「没有版号只能以『开放试玩』形式上架」**——「开放试玩」≠「敬请期待」。故**版号缺失不是本次敬请期待的主因**，但会掐死正式上架与后续商业化。
- **D-3**：用户可能在 **taptap.com（国际站/英文站）** 而非 `taptap.cn` 搜索，两侧索引不同步。

---

## ③ 最小操作清单（让前台能搜到 + 能玩）

> 硬约束：**不重提审、不换包、不 create-draft、不重新绑包**。以下全部为「确认/补齐可读性内容」，第 1 项即可解掉 90% 的疑惑。
> 标注：**[人]** = 必须人手动；**[机]** = 可只读自动化。

| # | 操作 | 属性 | 在哪一步/哪里 | 预期效果 | 阻塞级别 |
|---|---|---|---|---|---|
| **1** | **用无痕窗口 + 手机 App 分别搜「解压水消除」，并直接打开 `https://www.taptap.cn/app/956289`**，截图对比：卡片状态 vs 详情页是否有「试玩/立即下载」按钮 | **[人]** | 前台 | 一锤定音：若详情页有试玩入口而卡片显示敬请期待 → 只是索引延迟，**等 30–120 分钟自动恢复**，无需任何后台动作 | **P0 立刻做** |
| **2** | **人工核对「主包体(main 槽位)当前绑定的是不是 261944 (V6.4.1)」** —— 这是「点进去玩不了」的头号嫌疑 | **[人]** | 后台「版本与包体 / 包体管理」页 | 若为空或绑错 → 走**热修简化流程**补绑（**补绑 ≠ 重新提审，但需重走一次审核**，须用户批准后由人工决策） | **P0** |
| **3** | 核对后台面包屑/版本列表那句是「解压水去除」还是「解压水消除」，确认草稿 title 当前值 | **[人]** | 后台「游戏资料 / 基本信息」页 | 消除名字歧义，避免搜索落空 | P1 |
| **4** | 确认「发布平台(app_platforms)」已选、**游戏类型(category)** 已选、**图标(icon)** 已传、**厂商类型(developer_type)** 已选 | **[人]** | 后台「游戏资料」页 | 这 4 项是**下一次提审的必填前置**，现在空草稿状态必须先补 | P1（为下次提审） |
| **5** | 用无痕窗口刷新搜索结果，连续观察 30/60/120 分钟，确认「敬请期待」是否自动消失 | **[机]**（只读复查 `list-app-versions` + 前台页面） | CLI 只读命令 | 若 2 小时内仍为敬请期待 → 转 D-1/索引 dept. | P1 |
| **6** | 向 TapTap 客服确认：① H5 小游戏上架是否需 `apk_mini_game_play` 播放位；② 纯 IAA 无内购需补哪些资质（重点 `privacy-compliance` / `anti-addiction` / `icp-filing`） | **[人]** | TapTap 开发者工单 | 定性 D-2，避免盲目补 8 项 | P1 |
| **7** | 补 3 张截图 + 简介/开发者的话（均为 suggested 非必填，但直接影响前台转化与搜索曝光） | **[人]** | 后台「素材 /  assets-upload」 | 提升前台可见度与转化 | P2（不阻塞） |

> **一句话**：第 1、2 项做完就能定性；**本次大概率不需要任何写操作**。

---

## ④ 已知风险与缓解

| 风险 | 等级 | 现状 | 缓解 |
|---|---|---|---|
| 搜索索引延迟导致「能搜到但状态陈旧」被误判为未上线 | 中 | 已上线但索引可能滞后 | 按 ③-1 无痕双端验证；30–120 分钟内应自愈 |
| **主包体绑定态 API 信号自相矛盾**（`is_releasing=true` vs `current_bindings=[]`） | **高** | 未见人裁定 | ③-2 人工看后台拍板；若确未绑定，走**热修流程**（补绑 + 说明，简化审批但保留审计与回滚），**必须用户批准**，严禁擅自重绑 |
| 空草稿导致**下一次提审直接挂** | 高 | 已确认（9 个模块 revision 0） | ③-4 提前补齐 5 个必填项；**字符串/资料冻结前完成** |
| 版号/资质全 missing → 卡死「正式上线」与广告结算 | 高 | 8 项 pending_upload | ③-6 问官方口径；先把 `privacy-compliance`/`anti-addiction` 这类能用个人主体提交的补上 |
| 名称歧义（解压水消除 vs 解压水去除）污染搜索 | 低–中 | 仅后台面包屑 | ③-3 人工确认并统一 |
| 误操作（重提审/换包/create-draft/重绑）把线上版本搞坏 | **高** | 本次已全程只读规避 | 本次核查零写操作；任何写入（尤其补绑）前必须用户明示批准，且保留回滚到 261233(V6.4.0) 的路径（该包 `status: ready`） |
| 我无法取到搜索结果页 HTML | — | 方法论限制 | 已在 ② 标注**证据不足，需人工确认**，未做任何推测性断言 |

### 明确「证据不足」的项（不臆造）
1. TapTap **搜索结果页**的真实状态（SPA 抓不到）→ 需人工无痕实测。
2. `apk_mini_game_play` 槽位对 H5 小游戏是否 **required**。
3. 后台面包屑「解压水去除」的**确切来源**与时间。
4. `is_releasing=true` 与 `current_bindings=[]` 的**语义优先级**。

---

*核查人：release-ops-lead ｜ 全部命令为只读（read），未触碰任何产品/测试文件、未 commit、未 deploy。*

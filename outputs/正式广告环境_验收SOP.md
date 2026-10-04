# 《解压水消除》真机 · 正式广告环境验收 SOP

> 版本：V6.4.1　|　编写：程基岩（engineering-lead）　|　日期：2026-10-04
> 适用范围：TapTap 小游戏容器内，iOS / 安卓双端，激励视频 + 插屏的广告链路验收。
> 本文件只解决一件事：**什么叫「广告真的弹出来了」**，以及证据不够时该去哪补。
> 铁律：拿 mock 当真机结论 = 无效结论。分层写在第 5 节，别跳读。

---

## 0. 一句话读法（先看这段）

- 代码**不需要**双份 adUnitId（iOS / 安卓共用同一个 `window.tap` 和同一套 ad API，一套 ID 双端通用）。
- 「后台只有安卓位」是**后台媒体建成「应用类型=应用 / 系统=Android」**造成的，不是平台不支持 iOS。
- 验收要证明的是**链路通**，不是**一定有钱进账**：链路上层的证据能在本机/Node 拿到，**是否计费必须由后台数据下结论**。

---

## 1. iOS / 安卓 广告位结论卡

### 1.1 代码侧结论

| 项 | 结论 |
| --- | --- |
| 是否需要双份 adUnitId | **不需要。** `CFG.adUnitFor(type)` 先查 `adUnitByPlatform[platform][type]`，为空则退回通用 `CFG.adUnit[type]`（`1067564` 激励 / `1067565` 插屏）。 |
| 当前值 | `adUnitByPlatform.ios` / `.android` **都是空字符串** → 两端都走通用 ID `1067564 / 1067565`。 |
| 平台维度真正在做什么 | 只做两件事：① 选 adUnitId（现在等于没选）；② 给埋点打 `platform=ios/android` 标。**不改变任何降级逻辑。** |
| iPadOS 判定 | iPadOS 13+ 的 UA 伪装成 Macintosh，所以优先按 `ios` 判：`/(iphone\|ipad\|ipod)/i` → `ios`；`/(android)/i` → `android`；否则 `unknown`。URL `?platform=ios\|android` 可强制覆盖（埋点核对时用得上）。 |

### 1.2 后台侧：要补建 iOS 位该去哪

- 平台：**Dirichlet SSP**（`ssp.dirichlet.cn`），广告位在开发者中心 / 媒体管理里建，不是 TapTap 后台建。
- 现状：现有两个推广位「应用类型=应用 / 系统=Android」→ 只有安卓能命中，iOS 侧即使链路通也拉不到素材。
- 要做的（工程侧已确认「代码不需要动」，只影响后台媒体属性）：
  1. 在 SSP 建/改推广位，把媒体/system 覆盖到 iOS（或另建「系统=iOS」的推广位）；
  2. 推广位**属性必须选「正式」**，选「测试」只有白名单设备能拉到，其它真机必失败且**游戏不报错** → 真机真实收益 = 0，代码改不出钱；
  3. 建完把 iOS 专用 ID 填进 `CFG.adUnitByPlatform.ios.rewarded / .interstitial`（游戏逻辑零改动，`adUnitFor()` 自动切换）；不填也仍然通，只是埋点 `unit=1067564` 分不出端。
- 等后台给了 iOS ID 再填；**在此之前不要为了 iOS 去改代码**——改了也不会多一分钱。

---

## 2. 怎么切到「真 · 正式 SDK」

### 2.1 三个开关（都在 URL 上，不用改包）

| 开关 | 作用 | 什么时候用 |
| --- | --- | --- |
| `?sdk=real` | **强制真 SDK 模式**。`CFG.forceRealSdk=true` → 有真 `window.tap` 就走真实全链路；**没有 tap 就明确报 `ad_no_real_sdk` 且拒绝发奖**，绝不走模拟发奖。 | 真机验收主开关。开着它，「没弹出来」和「弹出来了」在埋点里一眼可分。 |
| `?env=test` / `?ad=test` | 强制测试环境（模拟看完） | 自动化测试、本地跑链路、给 QA 用 |
| `?env=online` / `?ad=online` | 强制线上环境（默认就是 online） | 正常真机（一般不用写） |
| `?tools=loose` | 道具额度放宽 9/9/9、撤销 9 | 连点测试道具，不想每 9 次看一次广告 |
| `?tools=strict` | 强制正式额度 1/1/1、撤销 5 | 要对齐线上口径时不许被 `?env=test` 带偏 |

### 2.2 真机 URL 怎么拼

**主用例（真机验收，iOS / 安卓都用它）：**

```
https://water-sort-relax.app.workbuddy.host/?sdk=real
```

- iOS 端（iPhone / iPad，TapTap 容器内有 `window.tap`）：
  `https://water-sort-relax.app.workbuddy.host/?sdk=real&platform=ios`
- 安卓端：
  `https://water-sort-relax.app.workbuddy.host/?sdk=real&platform=android`
- 想对齐线上玩家口径跑道具链路（避免被宽松额度干扰）：
  `https://water-sort-relax.app.workbuddy.host/?sdk=real&tools=strict`

> 三个参数中只有 `sdk=real` 是验收必需；`platform=` 只是让埋点把端印清楚，方便后台对账。

### 2.3 游戏内也能切（备选路径）

选关面板底部有 **TEST / ONLINE** 两个按钮：
- 点 ONLINE 但没 SDK / 没 adUnitId 时，会自动退回 TEST **并 toast 出原因**（`ENV_DEGRADE_TXT`）；
- 面板上那行小字会常驻显示「当前：ONLINE（真实 TapTap 广告）」或「当前：TEST … · no-real-runtime」。
- 这是给「拿不到 URL 拼参数」的场景（例如游戏内分享出去的链接）用的兜底入口。

### 2.4 额度 / 频控默认值（拦截不是弹出，先心里有数）

| 参数 | 值 | 含义 |
| --- | --- | --- |
| `rewardedSessionCap` | 3 | 单会话最多看 3 次激励，第 4 次 `ad_cap_blocked` |
| `interstitialSessionCap` | 1 | 单会话最多 1 次插屏 |
| `interstitialCooldown` | 300s | 插屏最小间隔 5 分钟（官方建议 ≥180s，这里更克制） |
| `firstSessionProtection` | 15s | 进来 15 秒内不主动弹插屏 |
| `interstitialAfterWins` | 3 | 连续成功 3 次后才允许一次插屏 |
| `adFailFallback` | `'free'` | 广告拉不到时**白送一次道具/复活**，不卡流程（会记 `ad_fallback_granted`） |

**所以「点了没广告」有相当概率是被频控拦了，不是坏了** —— 直接对表第 4 节。

---

## 3. 判定通过的证据清单

### 3.1 必须看到的全链路（激励视频）

按时间序，一条不缺才算**链路通**：

| # | 事件 | 关键字段 | 说明 |
| --- | --- | --- | --- |
| 1 | `ad_env_init` | `env=online`、`src=formal-unit`、`reason` 为空、`platform`、`forceReal=true`、`unit` | 启动即打。**`reason` 必须为空**；不为空说明已经降级了（见 4.1） |
| 2 | `ad_request` | `scene`、`env=online`、`src=formal-unit` | 发起请求（scene：`revive` / `tool_*` / `undo`） |
| 3 | `ad_show` | `env=online` | 已调用 `ad.show()` |
| 4 | `ad_load_success` | `unit=<ID>`、`platform` | **这是「真的挂上真 SDK 并加载成功」的最强信号** |
| 5 | `ad_complete` | `scene` | 看完（或 SDK 回调 complete） |
| 6 | `reward_granted` | `scene`、`src=online` | **发奖** |

> 插屏链路只需：`ad_show type=interstitial` + `ad_load_success type=interstitial`（插屏不发奖）。
> 插屏被拦时会单独有 `ad_interstitial_blocked`，别和「坏了」混为一谈。

### 3.2 ⚠️ 判据一：`?sdk=real` 下看到 `ad_no_real_sdk` = **没弹出来**

- `ad_no_real_sdk` 出现 → 环境里**没有真实 tap 运行时**（不在 TapTap 容器内 / 容器没注入 / SDK 未加载完成）；
- **绝不允许**同时出现 `reward_granted`（这是这条开关存在的全部意义：杜绝假绿）；
- 此时通常还会跟一条 `ad_fallback_granted`（因为 `adFailFallback='free'`，会白送玩家一次道具/复活）。**白送不等于看广告，订单里别算收入。**

### 3.3 ⚠️ 判据二：`ad_show` 单独出现**不能**算「弹出来了」

这是诚实提醒（本轮实测 (b) 里能复现）：
`showRewarded()` 会先打 `ad_show`，再分派；`?sdk=real` + 无 tap 这条路先打 `ad_show` 再打 `ad_no_real_sdk`。

所以判定顺序必须是：
```
看到 ad_load_success  → 采信「真 SDK 起来了」
只看 ad_show          → 不算（无 tap 时它照样打）
只看 reward_granted   → 不算（forceRealSdk 下无 tap 根本不会发；但老版本会，别拿旧版本的行为当标准）
```
建议的**唯一采信口径**：`ad_env_init(reason="")` + `ad_load_success` + `ad_complete` + `reward_granted` 四件齐全 → 链路通。
（这条口径若被认可，建议下一轮把 `ad_show` 挪到分派之后打，或 forceRealSdk 下不打 —— 一行改动，见第 6 节。）

### 3.4 怎么把埋点拿出来

1. **游戏内**：选关面板 TEST/ONLINE 那行小字（只能看 env 与 degradeReason，看不了完整序列）；
2. **离线缓存**：事件同时写 `localStorage['wsr_ev']`（最近 80 条）—— 手机连上电脑/用调试页读即可；
3. **上报**：`CFG.trackUrl` 留空时**不上报**；真机验收若要集中看，需临时填 `trackUrl`（改包，超出本轮范围，按需走变更）。

---

## 4. 失败排查树

从 `ad_env_init` 的 `reason` 字段第一刀切开：

```
ad_env_init.reason == ""  → 环境层没问题，往下走「请求层」
   │
   ├─ 有 ad_request + ad_load_success + ad_complete + reward_granted → ✅ 链路通（收工）
   ├─ 只有 ad_request（后面啥都没有）      → 4.3 拉不到广告
   ├─ ad_request + ad_show + ad_no_real_sdk → 4.1 没有真 tap 运行时
   ├─ ad_request + ad_cap_blocked           → 4.4 会话上限拦了
   └─ ad_request + ad_fallback_granted（无 ad_no_real_sdk）→ 4.5 加载失败走了免费兜底
```

### 4.1 `no-real-runtime` —— 强制真 SDK 但环境里没 tap

- 是什么：`?sdk=real` 打开了，但 `window.tap.createRewardedVideoAd` 不存在。
- 判定：这就是**「没弹出来」本身**，不是异常分支。
- 怎么解：
  1. 确认是在 **TapTap 小游戏容器**里跑（微信/普通浏览器/Safari 直接开链接 → 必然这条）；
  2. 容器起来了才点入口，别在启动动画期间就点道具；
  3. 真机本机自测（非容器）也必然是这条，**不要拿它当 bug 报**；
  4. 若容器里有 tap 却仍报：检查容器版本 / SDK 注入时机，属于平台侧问题，工程侧改不出结果。

### 4.2 `no-tap-runtime` —— 没检测到 TapTap SDK

- 是什么：`env='online'` 但 `hasTap()` 为 false，被自动降级到 test。
- 和 4.1 的区别：4.1 是「强制真 SDK 且没 tap」，这条是「想走在线但没 SDK」。
- 怎么解：同 4.1 第 1 条；另外确认不是自己带了 `?env=test`。

### 4.3 `no-ad-unit-id` —— 还没填 adUnitId

- 是什么：`env='online'`、有 tap，但 `CFG.adUnit.rewarded` 为空。
- 怎么解：把 ID 填回 `CFG.adUnit={rewarded:'1067564',interstitial:'1067565'}`（门禁 G11 会守「出厂两个都非空」）。

### 4.4 拉不到广告（有环境、有 ID，但没 `ad_load_success`）

按先后排查：
1. **推广位属性是「测试」**：只有后台【测试工具】白名单设备能拉到，其它设备必失败且游戏不报错 → 去 SSP 改成「正式」；
2. **媒体系统只建了 Android**：iOS 侧拉不到（第 1 节）→ 后台补 iOS 媒体/推广位；
3. **没联网 / 网络被拦**：真机离线或代理；
4. **广告库存空**：大时段低填充，等会儿再试；
5. SDK 回调 `onError` 会打 `ad_load_fail err=<errMsg>` —— 把这条 `err` 原样贴出来，别自己猜。

### 4.5 cap 拦了（单会话看太多）

- 现象：`ad_cap_blocked`（激励）/ `ad_interstitial_blocked`（插屏），`stats.capBlocked` / `coolBlocked` 会涨。
- 怎么解：这是**设计内节流，不是 bug**。等本次会话结束重开，或临时调 `CFG.rewardedSessionCap`。
- 插屏还要额外满足「进来 15 秒 + 连续成功 3 局 + 距上次 ≥5 分钟」，三条全不满足也会被拦。

### 4.6 加载失败但没弹窗（`ad_fallback_granted`）

- 是设计行为：`adFailFallback='free'` → 白送一次道具/复活，玩家不卡流程。
- 要区分：这条**不是发奖**，收入侧不算。
- 排查：看它前面那条 `ad_load_fail err=<…>`，按 4.3/4.4 处理。

### 4.7 概率性看到 `reward_duplicate_blocked`

- 是幂等保护：SDK 重复回调 close 时，第二次被挡掉。属正常。

---

## 5. 诚实分层：本机能证明到哪一层

**不许拿下面第 A 层当第 B 层结论。** 验收单上要分层填。

| 层 | 结论能证明什么 | 在哪证明 | 本轮证据 | 状态 |
| --- | --- | --- | --- | --- |
| **A. 代码逻辑层** | 「有真 SDK 就走真实链路、无真 SDK 就不发奖」这条规则被执行了；`adUnitFor()` 在 byPlatform 为空时退回通用 ID；道具额度按 toolMode 区分 | Node + mock `window.tap`（`qa_lib.js` 外壳，注入后门，不 require 游戏任何内部） | 已实测：(a)(b)(c) 三条全 PASS | ✅ 已完成 |
| **B. 单文件形态层** | 零外部依赖、ES5、体积、自包含；打包 zip 内 index.html 与主文件逐字节一致 | `qa_arch` / `qa_gate` / `pack_zip.js` 自证拆包比 md5 | arch 31/0、gate G8a/G8c、zip 151221B 包内 md5 一致 | ✅ 已完成 |
| **C. 链路可观测层** | 事件序列在 `?sdk=real` 下确实分叉成「真链路」和「ad_no_real_sdk 且拒发」两条，可断言、不再假绿 | Node harness 读 `Track.buf` | 已实测（见 report） | ✅ 已完成 |
| **D. 游戏玩法回归层** | 改了广告/道具没碰坏玩法：关卡生成、可解性、水量守恒、UI、热身、40/90 关 | `qa_design` / `qa_biz` / `qa_ui` / `qa_warmup` | 72+84+128+14 全绿 | ✅ 已完成 |
| **E. 容器注入层** | 真 TapTap 容器里 `window.tap` 真的存在、`show()` 真被调用、回调 `onClose(isEnded)` 真的进来 | **必须真机在 TapTap 容器内跑 `?sdk=real`** | 本轮**没有** | ⛔ 待真机 |
| **F. 广告素材/计费层** | 真能拉到素材、是真广告（不是空屏）、后台真计费、iOS 端也能命中 | **必须后台数据（Dirichlet 报表）+ 真机后台视图** | 本轮**没有** | ⛔ 待真机+后台 |

**一句话**：A~D 是「代码没坏、链路分叉正确」；**E 和 F 这最后一层，本机再怎么 mock 都证不出来**，谁拿 Node 跑绿了就直接说「广告通了」，谁就是拿 mock 当真机结论 —— 本 SOP 不允许。

### 5.1 真机验收单（E 层，逐项打勾，缺项不许写「通过」）

```
真机型号/OS：______   TapTap 客户端版本：______    bundlesource=______（iOS/安卓）
URL：https://water-sort-relax.app.workbuddy.host/?sdk=real&platform=____

[ ] ad_env_init   reason=""     env=online   src=formal-unit   forceReal=true   unit=1067564
[ ] ad_load_success  （唯一强信号；没这条 = 没真弹出来）
[ ] ad_complete
[ ] reward_granted
[ ] 点开广告后**真的出现了一个可看视频的界面**（不是白屏/不是 Toast/不是直接关闭）
[ ] 中途关掉 → 不发奖，只有 ad_cancel
[ ] 看完了 → 才发奖，且道具/复活真的到账
[ ] 插屏：连续通关 3 局后 → ad_show type=interstitial + ad_load_success type=interstitial
[ ] iOS 与安卓各跑一遍，两边事件序列一致（除 platform 字段）
[ ] 后台（Dirichlet）在结束后 10~30 分钟能看到对应曝光/收入
```

---

## 6. 本轮发现的待办（不修，交主理人定）

| # | 项 | 建议 | 影响 |
| --- | --- | --- | --- |
| 1 | `showRewarded()` 先打 `ad_show` 再分派 → `?sdk=real` 无 tap 时 `ad_show` + `ad_no_real_sdk` 连着打，只看 ad_show 会误判成「弹出来了」 | 把 `ad_show` 挪到 `_onlineRewarded` 里 `ad.show()` 之后打；或 forceRealSdk 且无 tap 时不打 `ad_show` | 纯观测面，不改任何发奖逻辑；建议下一轮一行改动 |
| 2 | 门禁 G8c 找的是 zip 条目名 `index.html`，而 `pack_zip.js` 写的是 `game/index.html` → 门禁**读不到条目**，全部计入「未核对」，实际是**假 PASS** | 改 `zipEntry(buf,'index.html')` → 末尾匹配 `'index.html'`，或改传 `'game/index.html'` | 现在 G8c 绿是「没核对成功」的绿；上传包版本漂移它抓不住 |
| 3 | 门禁 G8b 红（线上 181239B 旧版 vs 本地 186600B）与 `qa_live_sim` 4 条红，根因同一个：**线上还没重新发布** | 发布动作由主理人决定；发布后重跑 G8b / livesim 即可全绿 | 不是代码 bug |
| 4 | `?sdk=real` 下仍然按 `adFailFallback='free'` 白送道具 | 若要求「强制真 SDK 时不走免费兜底」，把这条也一并改掉 | 与 1 同批改，避免一次改动两种口径 |

---

## 7. 附：本轮实测快照（可复跑）

```
主文件       outputs/解压水消除.html       186600B  md5 65ad2ad270cf9ef704188feca77c90ea
publish_water/index.html                 186600B  md5 65ad2ad270cf9ef704188feca77c90ea
publish_taptap/index.html                186600B  md5 65ad2ad270cf9ef704188feca77c90ea
上传包       outputs/tap_upload_v6.4.1.zip 151221B（3 条目，包内 index.html 与主文件逐字节一致）

(a) ?sdk=real + mock tap    → ad_request → ad_show → ad_load_success → ad_complete → reward_granted   PASS
    createRewardedVideoAd 收到 adUnitId=1067564，show 调用 1 次，onReward 1 次，onFallback 0 次
(b) ?sdk=real 无 tap         → ad_request → ad_show → ad_no_real_sdk → ad_fallback_granted            PASS
    onReward 0 次，stats.complete=0（没发奖，不再是假绿）
(c) ?env=test   → toolMode=loose  G.tools={clear:9,finger:9,swap:9}  G.undoLeft=9   PASS
    默认(strict) → toolMode=strict G.tools={clear:1,finger:1,swap:1}  G.undoLeft=5   PASS

套件：design 72/0 · biz 84/0 · arch 31/0 · ui 128/0 · warmup 14/0 · smoke_live 28/0 · gate 10/1(仅 G8b 线上未发布)
      live_sim 24/4（4 条全是「线上是旧版 181239B」，根因同 G8b）
```

# 正式 SDK 切换 + 广告触发 —— 实跑证据与调试指引

> 日期：2026-10-04　产品版本：**V6.4.1 / 186600B / md5 `65ad2ad270cf`**（线上已发）
> 手法：**不打产品一字节** —— 真实 Chrome + CDP，在产品自打的埋点 `localStorage['wsr_ev']` 里取证。

## 0. 一句话结论

**「切到正式 SDK」这条路，代码层已经跑通了**，铁证是开局第一条埋点从 `src=test-unit` 变成了 `src=formal-unit`；道具用光后看完广告确实回到 1（`1 → 0 → 1`，截图为证，广告 SDK 也真的被调用了）。
**但「真盖屏、真拉到广告素材」这最后一厘米，只有真机在 TapTap 容器里才算数** —— 网页版没有 `window.tap`，物理上到不了那一步。

---

## 1. 切换正式 SDK：开关是真的有效（对照实测）

在同一台机器、同一个线上地址、只差「有没有 `window.tap`」的条件下，开局第一条埋点：

| 场景 | 怎么造的 | `ad_env_init` 实际打出 |
|---|---|---|
| **S1 · 网页版原样**（无 tap） | 直接开 `?sdk=real` | `src=test-unit` `[reason=no-real-runtime]` `[env=test]` |
| **S2 · 模拟 TapTap 容器**（有 tap） | 页面脚本执行前注入 `window.tap` | **`src=formal-unit`** **`[unit=1067564]`** `[env=online]` |

**这一行就是「切到正式 SDK」的判据**：`src` 从 `test-unit` 翻到 `formal-unit`，`env` 从 `test` 翻到 `online`。

顺带证明另一半（防假绿）：S1 明明带了 `?sdk=real`，它**没有**假装成功，而是老实报 `no-real-runtime`，并退回 `test-unit`。

---

## 2. 广告链路：真的调了 TapTap SDK，发了奖

S2 里真点底部「万能指」两次（第 1 次用光、第 2 次看广告），拿到完整序列：

```
tool_use[env=online][mode=strict]          ← 道具用掉
ad_request[src=formal-unit][env=online]    ← 向正式位发起
ad_show[src=formal-unit][env=online]
ad_load_success[src=formal-unit][unit=1067564]   ← 广告位 ID 命中
ad_complete[src=online]
reward_granted[src=online]                 ← 发奖
```

同时页面侧抓到真调用（不是模拟）：

```
window.tap.createRewardedVideoAd({ adUnitId: "1067564" })   ← SDK 真被调用
show() 调用次数 = 2
```

**魔法清除 / 随心互换 走的是完全同一条链路。**

---

## 3. 道具次数：1 → 0 → 1（截图为证）

底部四键（魔法清除 / 万能指 / 随心互换 / 撤销）在线上默认值是 `1 / 1 / 1 / 5`。

| 阶段 | 万能指按钮长相 |
|---|---|
| 初始 | 黄色可用，右上角红点 **1** |
| 点一次用光 | **灰色不可点，红点消失（=0）** |
| 看完广告 | **黄色可用，右上角红点回到 1** |

证据图：
- `_shot_s2_1_used.png` —— 用光瞬间：万能指变灰、魔法清除(1) / 随心互换(1) / 撤销(5) 不受影响
- `_shot_s2_1_ad.png` —— 看完广告后：万能指恢复黄色 + 红点 **1**

埋点侧同步出现 `tool_use → ad_request → ad_show → ad_load_success → ad_complete → reward_granted`。

---

## 4. 你要自己点，就这么走

### 4.1 网页版（先自证逻辑通，弹不出真广告）

打开：**`https://water-sort-relax.app.workbuddy.host/?sdk=real`**

你会看到调试面板提示「没检测到 TapTap SDK（不在 TapTap 容器内）」→ 然后退回 TEST。
**这是正确行为，不是坏了** —— 网页版就是没有 TapTap 容器，这是这一层的物理上限。

想先随便玩、不用担心道具用完，用这个宽松模式：
**`.../?env=test&tools=loose`** → 道具 **9 / 9 / 9**、撤销 **9**，随便点，点光了看广告也能补回来。

### 4.2 真机（唯一能验到真广告的一条路）

1. SSP 后台左侧「测试工具」把你这台设备加进**白名单**（测试位对白名单设备会返回广告）；
2. 用 **TapTap App 里的小游戏容器**打开（**不是浏览器打开网页链接**）；
3. 地址带 `?sdk=real&platform=android`（iOS 用 `platform=ios`）；
4. 点底部「万能指」→ 变灰 → 再点 → **真广告盖屏** → 看完 → 回到 1。

判定通过：`ad_env_init src=formal-unit` + `ad_load_success unit=1067564` + `reward_granted` 三件齐全。

---

## 5. 诚实分层（哪层我验了，哪层必须你去）

| 层 | 我这边实测结果 | 可信度 |
|---|---|---|
| ① 切正式 SDK 开关（`test-unit` → `formal-unit`） | ✅ 已验 | 真实 |
| ② SDK 调用链（`createRewardedVideoAd` + 发奖时序） | ✅ 已验（注入 tap 后） | 真实 |
| ③ 道具 1→0→1 与埋点齐全 | ✅ 已验（真 Chrome 真点击 + 截图） | 真实 |
| ④ 广告**盖满屏**、真 `isEnded` 时序 | ❌ 沙箱没 TapTap SDK | **必须真机** |
| ⑤ 真拉到广告素材、真进账 | ❌ 需要正式推广位 | **必须后台建位 + 真机** |

这条线上，**第 ①②③ 层本轮已经打通**；④⑤ 卡在「后台没建正式推广位 + 不在 TapTap 容器里」，都不是代码问题。

---

## 6. 还差什么（唯一一条，得你点）

SSP 后台（`ssp.dirichlet.cn`，媒体 1110498「小游戏 / Android / **正式**」）下**一个推广位都没有**：
现有的 1067564 / 1067565 都挂在**测试媒体 1110240** 名下，所以属性永远是「测试」，切不到正式。

要真钱，只有一条：
> 在正式媒体 1110498 下新建 **激励视频 + 插屏** 两个推广位（属性必须选「正式」）→ 把 adUnitId 发我 → 我改代码、打包、上线。

拿到 ID 后代码侧**不用改结构**：`?sdk=real` 已经在按 `adUnitFor()` 取 ID，把新 ID 填进 `CFG.adUnit.rewarded / .interstitial` 即可，iOS 与 Android 共用一套（TapTap 小游戏两端是同一个 `window.tap`）。

---

## 7. 附：本轮命令

复跑脚本：`node _live_admock.js`（`_` 前缀，临时文件）
输出快照：`_live_out.txt`

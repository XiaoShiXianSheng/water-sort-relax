# TapTap 小游戏广告接入 —— adUnitId 获取指引

> 结论先给：**adUnitId 不在 TapTap 开发者中心（developer.taptap.cn）**，所以左侧栏翻遍也找不到。
> 它在一个**独立域名**的广告平台里创建。

---

## 一、之前错在哪（重要，别再绕回去）

| 之前的判断 | 事实 |
|---|---|
| adUnitId 在开发者中心"广告结算"里 | ❌ 错。"广告结算"是**看收入**的，不是**建广告位**的 |
| 应该在左侧找"商业化 / 广告联盟 / 变现" | ❌ 错。开发者中心左侧根本不放这个功能，所以你找不到是**正常的** |
| 真机 `tt.*` 不存在 → 环境有问题 | ❌ 误判。`tt` 是**字节系**（抖音小游戏）的全局对象，TapTap **压根不用 tt**，用的是 `tap` |

三条全错，导致整条路线白绕。**已用官方文档核实纠正。**

---

## 二、adUnitId 的正确获取入口

**广告平台（官方称 "SSP"）：**

```
https://ssp.dirichlet.cn/
```

**帮助文档：**

```
https://ssp.dirichlet.cn/docs/mini-program-guide/
```

> 来源：TapTap 小游戏官方《广告》接入文档原文 ——
> "创建广告位：在 **广告平台** 基于 **帮助文档** 创建广告位，获取广告单元 ID（adUnitId）"
> 该链接指向 `https://ssp.dirichlet.cn/`

**官方接入流程（原文四步）：**

1. 创建广告位 → 在 `ssp.dirichlet.cn` 创建，拿到 adUnitId
2. 接入广告 SDK → 在游戏代码里调用广告 API
3. 测试验证 → 建议配**测试工具**，保证测试广告位能出广告
4. 提交审核 → 正式广告位审核通过后才会正常展示

---

## 三、你要做的（在你自己能看到的浏览器里）

1. 浏览器打开 **https://ssp.dirichlet.cn/**
2. 用你的 TapTap 开发者账号登录（就是 `18801397074` 那个）
3. 按帮助文档创建**两个**广告位：
   - **激励视频广告**（用于：失败复活 / 加步数）
   - **插屏广告**（用于：通关时展示）
4. 创建完会给出两个 **广告单元 ID（adUnitId）**，把这**两个 ID 发我**

我拿到之后负责：填进 `CFG.adUnit` → 跑冒烟测试 → 用 tar.exe 重打上传包 → 重新提交 TapTap。

---

## 四、游戏代码这边：写法已经是对的 ✅

官方文档确认的两个 API：

```javascript
// 激励视频
let rewardedVideoAd = tap.createRewardedVideoAd({
  adUnitId: 'xxxx'          // ← 这里填你的激励视频 adUnitId
})
rewardedVideoAd.show()

// 插屏
let interstitialAd = tap.createInterstitialAd({
  adUnitId: 'xxxx'          // ← 这里填你的插屏 adUnitId
})
interstitialAd.show()
```

**我们游戏里的写法（`outputs/解压水消除.html` L126–129）跟官方文档完全一致**，包括变量名 `tap`。
也就是说：**代码不用改，只差填两个 ID。**

| 位置 | 要填的值 |
|---|---|
| L137 `CFG.adUnit.rewarded` | 激励视频 adUnitId |
| L137 `CFG.adUnit.interstitial` | 插屏 adUnitId |

---

## 五、激励视频的奖励发放要注意（别踩坑）

官方原文强调：

```javascript
rewardedVideoAd.onClose(res => {
  if (res && res.isEnded) {
    // 只有 isEnded 为真，才发放奖励
    giveRewardToUser()
  } else {
    // 用户中途关闭 → 不发奖励
    tap.showToast({ title: '观看完整视频才能获得奖励哦', icon: 'none' })
  }
})
```

> **只有当 `isEnded` 为 `true` 时才发放奖励。**

另外 `show()` 返回 Promise，没加载完会 reject，建议兜底：

```javascript
rewardedVideoAd.show()
  .catch(err => {
    rewardedVideoAd.load().then(() => rewardedVideoAd.show())
  })
```

---

## 六、一个还没验证干净的风险点（诚实标注）

**问题：真机（TapTap App 里）到底有没有 `tap` 这个全局对象？**

- 从文档的写法看，`tap.*` 是**小游戏容器原生注入**的能力（就像微信的 `wx.*`），文档直接假定它存在、**通篇没提"需要引入 SDK JS"**。
- 如果真是容器注入 → **我们的"零依赖单文件"架构不受影响**，不用加 `<script src>`，包结构不变。
- 但如果真机上 `tap` 不存在 → 那就需要在页面里引入 TapSDK 的 JS，会打破单文件零依赖。

**验证办法（你真机试玩时顺手看一眼）：**
给 `tap.createRewardedVideoAd` 加个降级日志，如果控制台打出"tap 不存在"，就说明需要额外引 SDK；如果广告能正常拉起，那就是容器注入，万事大吉。

这一步**必须在拿到 adUnitId 之后**、真机实测才能确认。现在先别为它改代码。

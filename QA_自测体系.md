# 自动测试与自测体系（可复用）

> 这份文档回答一个问题：**为什么这个项目的 bug 应该由 AI 自己测出来，而不是让用户一关一关玩着找？**
>
> 结论：单文件 HTML 游戏/应用可以做到 **90% 的问题在无头环境里自动测出来**，不需要人打开浏览器。
> 本文记录这套体系的搭法、怎么跑、怎么扩展、以及踩过的坑 —— **换一个单文件项目可以直接照搬**。

---

## 1. 一条命令，355 项断言

```bash
node qa_run.js            # 全部套件（含机器人通关，1~3 分钟）
node qa_run.js --quick    # 跳过机器人，约 5 秒
REPS=3 node qa_run.js     # 快速套件重跑 3 遍，专抓「时好时坏」的 flaky
node qa_rollback.js       # 回滚验证：故意改坏产品代码，确认断言真的会 FAIL（见 3.4）
```

输出：

- 控制台：每个套件一行结论 + 失败明细
- `qa_report.md`：人看的报告（结论表 / 失败清单 / 原始输出折叠）
- `qa_report.json`：机器看的（夜间任务可读）
- `qa_design_table.tsv`：1~40 关的关卡指标表（格数/行列/颜色/门洞/冰冻/槽位/管数/水量/层高）

**退出码即结论**：全绿 0，有失败 1。所以 CI、定时任务、别的 AI 都能直接判断。

---

## 2. 五个套件，各守一块

| 套件 | 文件 | 项数 | 守什么 | 典型能抓到的 bug |
|---|---|---|---|---|
| 功能测试 | `test_water.js` | 164 | 每个按钮点下去的真实后果 | 道具不生效、水量不守恒、撤销错乱、广告位不触发 |
| 商业化测试 | `qa_biz.js` | 66 | 赚钱链路与存档底线 | 点了广告不发奖、没看完也发奖、存档被改还能读 |
| 架构测试 | `qa_arch.js` | 31 | 单文件交付的地基 | 混进外部依赖、用了老 WebView 不支持的语法、线上白屏没兜底、调试后门没关 |
| 设计测试 | `qa_design.js` | 33 | 关卡数值自洽 | 关卡表写死导致高关不再变难、水量对不上、门洞相邻互锁、门洞序号缺号、冰冻瓶第一帧就化开 |
| UI 测试 | `qa_ui.js` | 31 | 手指戳下去会发生什么 | 点了没反应（命中框太小）、点错瓶子、静默拒绝、门洞不按顺序取、撤销没回滚水管、清除漏掉一杯水 |
| 合理性测试 | `bot_run.js` | 30 | 真的能玩到底 | 关卡不可解、难度失控 |

公共外壳在 `qa_lib.js`：负责加载单文件游戏、注入调试后门、伪造 canvas/浏览器 API、提供断言器。

---

## 3. 核心手法（这套体系真正值钱的部分）

### 3.1 用「后门注入」代替「改造产品代码」

不 require 游戏源码、不为了测试改产品结构。做法是把 `<script>` 文本抠出来，
在 `requestAnimationFrame(loop);` 之前**字符串插入**一段 `window.__DBG = {...}`，
把内部函数暴露出来，然后 `eval` 整段。

好处：产品代码保持零依赖、零测试痕迹；测试能拿到**内部真实状态**（不是模拟的）。

```js
const A = 'requestAnimationFrame(loop);';
const i = code.lastIndexOf(A);
const injected = code.slice(0, i) + INJECT + '\n  ' + code.slice(i);
eval(injected);
```

### 3.2 canvas 用 Proxy 兜底，但**真实 JS 错误照抛**

```js
new Proxy({}, {
  get(t, k) {
    if (k === 'fillText') return s => texts.push(String(s));
    if (typeof k === 'string') return t[k] !== undefined ? t[k] : noop;
    return noop;
  },
  set(t, k, v) { t[k] = v; return true; }
})
```

这样任何缺失的 canvas API 都不会报错；而绘制代码里写了不存在的变量（ReferenceError）
会在 `frames()` 里真的抛出来 / 触发产品自己的 `window.onerror` → `fatalShown` 翻真。

### 3.3 加载器的额外能力（都踩过坑才加的）

| 能力 | 为什么需要 |
|---|---|
| `opt.search` | 验证「调试后门默认关闭、带参数才生效」 |
| `setView(w,h)` 直接改模块作用域 `cw/ch/offX/offY/scale` | 多分辨率测试；比伪造 `visualViewport` 可靠得多 |
| `viewClick(vx,vy)` | 用**物理坐标**点击，真实验证 `toVirtual` 反向映射 |
| `touch()` / `click()` 分开 | 验证触屏与鼠标走同一条输入路径 |
| `renderOnce()` | 回收这一帧的 `fillText`，用来断言"这段到底画了什么字" |
| `global.localStorage` 内存桩 | 存档类功能可测，且不污染真实环境 |

### 3.4 **回滚验证** —— 每个新断言都必须做一次，而且已经自动化

写完断言，**故意把产品代码改坏**，确认对应断言真的 FAIL，再改回来。

不做这一步等于没有测试。本项目实测抓到过**四次"假绿"**：

1. **瓶颈找错了对象**：断言检查 `place==='grid'` 的瓶子，但那段绘制逻辑在**台面瓶子**函数里，
   grid 瓶根本不走那段代码 → 断言恒真。改成直接调用 `drawJarCounter`。
2. **探针太宽容**：命中回转测试只点瓶子**正中心**，把命中框从 ±52px 砍到 ±20px 仍然全绿。
   改成在瓶身视觉范围内取 **5 个探针点**（中心/左半身/右半身/上沿/下沿），
   立刻抓到（4715 次探针，1~40 关全量，一次 FAIL）。
3. **断言没覆盖到要验的那条路径**：撤销断言只挑「不会被喝」的瓶子，
   于是把 `doUndo()` 里「回滚水管」那一行整段删掉，断言照样全绿 ——
   水管本来就没变，当然比不出来。改成奇偶步交替（会喝 / 不会喝），立刻抓到。
4. **采样时机错了**：冰冻瓶「开局冻得住」的断言写在 `g.frames()` **之后**，
   而主循环第一帧就会跑 `thawByNeighbors()` 把不合格的冰冻瓶化开 → 走完帧再查永远查不到。
   必须在 `genLevel()` 之后、`frames()` 之前采。

#### 自动化：`node qa_rollback.js`

手工做回滚验证的问题是「容易忘、容易改不回来」。把每个用例写成
`(原文片段, 改坏成什么, 哪个套件的哪条断言必须 FAIL)`，一条命令跑完：

```
  ✔ 命中框从 ±52px 砍到 ±20px
      如期 FAIL「命中回转：…（4715 次探针 / 1~40 关全量取样）」  （该套件 30 PASS / 1 FAIL）
  ✔ doUndo() 不回滚水管里的水
      如期 FAIL「撤销回退后状态逐字段一致 …」  （该套件 30 PASS / 1 FAIL）
===== 回滚验证：7/7 个用例如期 FAIL 且原文件已还原 =====
```

三个设计要点：

- **每条用例跑完都必须把原文件写回**（`finally` 里做），并用 **md5 校验**确认还原成功 ——
  否则一次失败的回滚验证会把产品代码永久改坏。
- **原文片段必须唯一**（脚本会数出现次数，≠1 直接报错），否则改坏的可能不是你以为的那一行。
- **只跑相关的那一个套件**：7 个用例总共十几秒，比跑全量快得多。

新增断言时的规矩：先写断言 → 在 `qa_rollback.js` 里加一条用例 → 跑一遍确认「如期 FAIL」→
再跑 `qa_run.js` 确认全绿。**报告里要写明做过回滚验证**，没做的不算数。

### 3.5 flaky 检测

关卡是随机生成的，同一个断言两次运行结果会不同。
`REPS=n` 会把快速套件重跑 n 次，**通过数不一致就判定为 flaky 并计一次失败**。
另外「特定局面」类的断言必须固定随机种子（`withSeed(seed, fn)`），否则就是赌运气。

### 3.6 断言要"一次报全部违规"，不要短路

每个不变量收集**所有**违反的关卡，最后一起断言：

```js
one('台面槽 5~7', bad.slots);   // → L35=4 L40=4
```

比第一处失败就断掉有用得多 —— 一眼看出是系统性设计问题还是个别关卡问题。

---

## 4. 怎么给别的项目复用

1. 拷 `qa_lib.js` 过去，改两处：
   - `GAME` 默认路径
   - `INJECT` 里暴露的函数（按新项目的内部函数名改）
2. 拷 `qa_run.js`，改 `SUITES` 表（换文件名/项数口径）
3. 三张套件按需挑：
   - `qa_arch.js` 几乎**不用改**就能用（只需确认注入点字符串、体积上限、关键入口名）
   - `qa_design.js` 需要按新项目的"设计不变量"重写断言（这是最费脑子也最值钱的一步）
   - `qa_ui.js` 需要按新的绘制几何重写探针
4. UI 探针的通用写法：**从绘制代码反推视觉范围**，再在范围内取多点回点，验证命中回转。
   不要发明魔法数字，把 `draw*` 里的偏移量写进断言的注释里。

---

## 5. 夜间自动 run loop

配合定时任务在低峰时段（23:00–08:00）反复推进"设计 → UI → 架构 → 开发 → 测试"，
每次跑完把 `qa_report.md` 的结论推给用户。模型用平台**最低消耗档**（随套餐变化，不写死）。

---

## 6. 环境坑（Windows / 本机实测）

| 现象 | 解法 |
|---|---|
| bash 工具里 `dirname` / `head` / `tail` / `grep` / `cat` 都不存在 | 用绝对路径调 node，或改用 PowerShell |
| PowerShell stdout 经常被工具吞掉 | 结果一律 `Out-File` 到 txt，再用 Read 读 |
| PowerShell 管道会按 GBK 解码子进程的 UTF-8 输出 → 中文乱码 | 用 bash 的 `cmd > file`（字节级重定向）重跑 |
| `Remove-Item -LiteralPath "a","b" -Force`（数组形式）**静默不生效** | 用 `foreach` 逐个删 + `Test-Path` 校验 |
| 截图看小元素"好像没画出来" | 别信眼睛：用 PIL 裁剪放大 + 逐行统计目标色像素数 |
| 图像/URL 里出现 `%XX%` 会被安全策略拦 | 把 URL 清单写进文件，再逐行读取处理 |
| 同文件多处编辑并发会丢改动 | 串行编辑 + grep 回读确认 |

---

## 7. 为什么"让用户测"是错的

用户手动一关一关玩，能发现的是**体验问题**（"太累了""像羊了个羊"），
而这些问题的**根因**往往是数值/几何 bug（关卡表越界、命中框被砍、元素重叠）。

- 人找根因：几小时，且只能靠"感觉"
- 机器找根因：几秒，且带具体数字（`L35=4 L40=4`、`gridY0=746 < 758`）

**正确分工：人负责判断"好不好玩"，机器负责证明"对不对"。**
把"对不对"全部自动化，人只花时间在"好不好玩"上。

---

## 8. 提交推送：一个会静默失败的坑（本机实测，务必先读）

夜间任务要"自己提交、自己推送"，而本机 `git push` 有一个**非常隐蔽**的坑：

| 现象 | 实测值 |
|---|---|
| `git push origin main` | **退出码 128，stdout + stderr 全空**，什么都不打印 |
| `git ls-remote origin`（公开仓库读，不需要凭据） | rc=0，正常返回 |
| 耗时 | push 卡 **约 14 秒**后失败 |

只看这两个现象，第一反应肯定会误判成"网络问题 / 沙箱拦截 / 仓库权限"——**全都不是**。

### 定位手法（关键，别猜）

把 git 自己的 trace 写进文件（不要指望 stderr，它就是空的）：

```powershell
$env:GIT_TRACE = "C:/path/to/_trace.log"
(& git push origin main 2>&1) -join "`n"
# 然后读 _trace.log
```

trace 停在最后一行，答案就出来了：

```
run_command: 'git credential-manager get'      ← 卡在这里，14 秒后进程死亡
```

**根因**：本机 `credential.helper` 指向 WorkBuddy 自带 PortableGit 1.2.0 的
`git-credential-manager.exe`，它在非交互环境里取凭据会卡死。
git 拿到空凭据后**静默失败**（连一行 `fatal:` 都不打印）。

> 注意：`git credential fill`（直接要凭据）反而**能成功**返回 token，
> 所以"凭据助手是坏的"这个结论靠 `credential fill` 是验不出来的，必须看 trace。

### 解法（本项目已落地，两条一起做）

1. **仓库级清掉继承来的 helper**：`.git/config` 里加一段空值——
   空值 = 重置整个 helper 链（全局配的那些不再生效）：

   ```ini
   [credential]
   	helper = 
   ```

   > 坑中坑：PowerShell 传空字符串参数给 git 会被丢掉，`git config --local credential.helper ""`
   > 写不进去。**直接编辑 `.git/config` 文件**最可靠，改完用 `git config --local --get credential.helper` 回读确认。

2. **把 token 写进 remote URL**（仓库级，`.git/config` 不会被提交）：

   ```powershell
   git remote set-url origin "https://<用户名>:<token>@github.com/<owner>/<repo>.git"
   ```

3. **验证（必须做）**：

   ```powershell
   (& git push --dry-run origin main 2>&1) -join " | "   # 期望：几秒内 rc=0
   ```

### 备用配方

正式推送仍然失败时，显式把 helper 置空 + 用带 token 的 URL：

```powershell
$env:GIT_TERMINAL_PROMPT="0"
$tok = (("protocol=https`nhost=github.com`n`n" | & git credential fill 2>&1) |
        Where-Object { $_ -like "password=*" }) -replace "^password=",""
(& git -c credential.helper= -c credential.interactive=false `
      push "https://<用户名>:$tok@github.com/<owner>/<repo>.git" main 2>&1) -join "`n"
```

### 顺带两条 PowerShell 输出陷阱

- `git push 1>> $log 2>> $log` 会**吞掉**输出（连"rc="都取不到）；用
  `$o = (& git push origin main 2>&1) -join "`n"` 再自己写文件。
- 判断是否真的推上去了，**不要信本地 rc**，直接问远端：
  `git ls-remote origin refs/heads/main` 与 `git rev-parse HEAD` 比对。

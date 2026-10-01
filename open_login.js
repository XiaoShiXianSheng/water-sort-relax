// 开一个「看得见」的 Chrome 让你登录 TapTap —— 登录态存进持久 profile，之后永不过期。
//
// 为什么需要它：taptap-cli 的 device code 只有约 5 分钟，让人赶时间必然失败（已连挂 5 次）。
// 而浏览器登录一次，cookie 落在 profile 里，之后我就能用 headless CDP 复用这个 profile
// 自动点后台（建游戏 / 传包 / 传素材 / 提审），不再需要任何码。
//
// 用法：node open_login.js [url]
//   默认打开 https://accounts.taptap.cn/ （登录页）
// 你在弹出窗口里登录完，回来告诉我一声；我关掉窗口后接管。
//
// ⚠️ 一个 profile 不能同时被两个 Chrome 实例占用：这个窗口开着的时候，
//    我不能用同一个 profile 跑 headless。所以登录完请让我先关掉它。

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = path.join(__dirname, '.workbuddy', '_chromeprofile');
const PORT = 9333;
const URL = process.argv[2] || 'https://accounts.taptap.cn/';

if (!fs.existsSync(CHROME)) {
  console.log('找不到 Chrome：' + CHROME);
  process.exit(1);
}

const p = spawn(CHROME, [
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  '--no-first-run',
  '--no-default-browser-check',
  URL,
], { detached: true, stdio: 'ignore', windowsHide: false });
p.unref();

console.log('已打开 Chrome（端口 ' + PORT + '）：' + URL);
console.log('登录完告诉我，我关掉窗口后用同一 profile 接管后台操作。');

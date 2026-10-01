// TapTap CLI 授权码自动续期器。
//
// 背景：taptap-cli 的 device code 只有约 5 分钟有效，且一次只能有一个待授权流程
// （同时发起两个会互相冲掉，两个都失败）。人不在电脑前就永远赶不上。
//
// 这个脚本做的事：串行地一轮一轮发起 auth login，每轮拿到新码后
//   ① 覆盖写 _taptap_auth_qr.png（二维码图，直接扫）
//   ② 覆盖写 _taptap_auth_url.txt（链接文本，不方便扫码时复制）
// 然后安静等到这一轮超时，再换下一个码。人什么时候来扫都能扫到当前有效的那个。
//
// 用法：node auth_loop.js [轮数，默认 12 轮 ≈ 60 分钟]
// 成功后脚本会自己退出（auth status 报告已配置）。

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const CLI = 'C:/Users/Administrator/.workbuddy/binaries/node/workspace2/node_modules/@taptap/cli/scripts/run.js';
const EXE = process.execPath;
const ROUNDS = parseInt(process.argv[2] || '12', 10);

const QR = path.join(ROOT, '_taptap_auth_qr.png');
const TXT = path.join(ROOT, '_taptap_auth_url.txt');
const LOG = path.join(ROOT, '_auth_loop.log');

function say(s) {
  const line = new Date().toISOString().slice(11, 19) + '  ' + s;
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
}

function logged() {
  const r = spawnSync(EXE, [CLI, 'auth', 'status'], { encoding: 'utf8' });
  return /认证:\s*已配置/.test((r.stdout || '') + (r.stderr || ''));
}

function oneRound(i) {
  return new Promise((resolve) => {
    const f = fs.openSync(path.join(ROOT, '_auth_round.tmp'), 'w');
    const p = spawn(EXE, [CLI, 'auth', 'login'], { stdio: ['ignore', f, f] });

    // 轮询拿码：固定等 6 秒不够——网络慢时 CLI 还没把 device code 打出来，
    // 实测 14 轮里有 7 轮空手而归（日志"没拿到码"）。改成最多等 40 秒，1 秒一探。
    let waited = 0;
    const tick = setInterval(() => {
      let t = '';
      try { t = fs.readFileSync(path.join(ROOT, '_auth_round.tmp'), 'utf8'); } catch (e) {}
      const m = t.match(/user_code=([A-Za-z0-9]+)/);
      if (!m) {
        waited += 1000;
        if (waited >= 40000) { clearInterval(tick); say('第 ' + i + ' 轮  40 秒内没拿到码，跳过'); }
        return;
      }
      clearInterval(tick);
      {
        const url = 'https://accounts.taptap.cn/device?qrcode=1&user_code=' + m[1];
        try { fs.unlinkSync(QR); } catch (e) {}
        const q = spawnSync(EXE, [CLI, 'auth', 'qrcode', url, '--output', '_taptap_auth_qr.png', '--size', '512'], { cwd: ROOT, encoding: 'utf8' });
        fs.writeFileSync(TXT, url + '\n（约 5 分钟有效，过期会被本脚本自动换成新码）\nuser_code=' + m[1] + '\n');
        say('第 ' + i + ' 轮  新码 ' + m[1] + (q.status === 0 ? '（二维码已更新）' : '（二维码生成失败：' + ((q.stdout || '') + (q.stderr || '')).trim() + '）'));
      }
    }, 1000);

    // 这一轮结束（成功或超时）后收尾
    p.on('exit', () => {
      try { fs.closeSync(f); } catch (e) {}
      setTimeout(resolve, 3000);
    });
  });
}

(async () => {
  say('授权码自动续期开始，共 ' + ROUNDS + ' 轮（每轮约 5 分钟）');
  for (let i = 1; i <= ROUNDS; i++) {
    if (logged()) { say('已登录，结束'); return; }
    await oneRound(i);
    if (logged()) { say('已登录，结束'); return; }
  }
  say('轮次用完仍未授权。重新运行本脚本即可。');
})();

// 运行测试并把输出写到 run_log.txt（PowerShell 抓不到子进程 stdout）
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const NODE = process.execPath;
const d = __dirname;
const args = process.argv.slice(2);
const script = args[0];
const rest = args.slice(1);
let out = '';
try {
  out = execFileSync(NODE, [path.join(d, script), ...rest], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  out += '\n[exit 0]';
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '') + '\n[exit ' + e.status + ']';
}
fs.writeFileSync(path.join(d, 'run_log.txt'), out, 'utf8');
process.exit(0);

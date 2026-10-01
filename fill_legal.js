// 一键填充隐私政策 / 用户协议里的占位符，并同步到发布副本 + 重打上传包。
// 用法（Windows bash）：
//   DEV_NAME="石长建" DEV_MAIL="you@example.com" node fill_legal.js
// 只给其中一个也行，另一个会保持原样。
// 填完会：写回 outputs/legal/*.html → cp 到 publish_water/ → 重打 outputs/tap_upload_v6.2.zip
// 注意：主文件 outputs/解压水消除.html 里不含这两份法务文档，所以不需要重发线上游戏。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const NAME = process.env.DEV_NAME || '';
const MAIL = process.env.DEV_MAIL || '';
if (!NAME && !MAIL) {
  console.log('需要先给值：DEV_NAME="石长建" DEV_MAIL="you@example.com" node fill_legal.js');
  process.exit(1);
}

const TARGETS = [
  ['outputs/legal/privacy.html', 'publish_water/privacy.html'],
  ['outputs/legal/terms.html', 'publish_water/terms.html'],
];

let total = 0;
for (const [src, dst] of TARGETS) {
  const p = path.join(ROOT, src);
  let t = fs.readFileSync(p, 'utf8');
  const before = (t.match(/【[^】]*】/g) || []).length;
  if (NAME) t = t.split('【开发者名称】').join(NAME);
  if (MAIL) t = t.split('【联系邮箱】').join(MAIL);
  const after = (t.match(/【[^】]*】/g) || []).length;
  fs.writeFileSync(p, t);
  try {
    fs.mkdirSync(path.dirname(path.join(ROOT, dst)), { recursive: true });
    fs.copyFileSync(p, path.join(ROOT, dst));
  } catch (e) { console.log('  跳过副本同步 ' + dst + '：' + e.message); }
  console.log(src + '  占位符 ' + before + ' → ' + after);
  total += after;
}

console.log('\n剩余未填占位符：' + total);
if (total === 0) {
  console.log('法务文档已补全，正在重打上传包…');
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'pack_zip.js')],
    { cwd: ROOT, encoding: 'utf8' }
  );
  console.log(out);
} else {
  console.log('还有占位符没填，没重打上传包。');
}

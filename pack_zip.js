#!/usr/bin/env node
/* ============================================================================
   pack_zip.js —— 重新打包 TapTap 上传包，并自证包内 index.html 与主文件一致
   ----------------------------------------------------------------------------
   为什么需要它（这个沙箱里没有别的路）：
     · 系统没有 `zip`、没有 `7z`；
     · PowerShell 的 `Add-Type`（走 .NET ZipFile）被安全策略拦掉；
     · 于是「改了主文件 → 重新打上传包」这件事没有任何现成命令可用，
       而门禁 G8c 会拆包比 md5 —— 包不重打，G8c 就红。
   所以这里手写一个最小合法 zip（stored 目录 + deflate 数据），零依赖、只依赖 node 内置 zlib。

   用法：  node pack_zip.js            # 打包 outputs/tap_upload_v6.0.zip
          node pack_zip.js -n         # 只校验、不写盘
   退出码：0 = 包内 index.html 与 outputs/解压水消除.html 逐字节一致；1 = 不一致（G8c 会红）
   ============================================================================ */
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');

const ROOT = __dirname;
const MAIN = path.join(ROOT, 'outputs', '解压水消除.html');
const OUT = path.join(ROOT, 'outputs', process.env.ZIP_NAME || 'tap_upload_v6.2.zip');
const ENTRIES = [
  { name: 'index.html', file: MAIN },
  { name: 'icon_512.png', file: path.join(ROOT, 'publish_taptap', 'icon_512.png') },
  { name: 'UPLOAD_NOTES.txt', file: path.join(ROOT, 'publish_taptap', 'UPLOAD_NOTES.txt') }
];
const md5 = b => crypto.createHash('md5').update(b).digest('hex');

/* ---------- CRC32（zip 必须字段，node 内置没有） ---------- */
const CRCT = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRCT[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---------- 写 zip ---------- */
function buildZip(entries) {
  const parts = [], cents = [];
  let off = 0;
  entries.forEach(e => {
    const data = fs.readFileSync(e.file);
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data), name = Buffer.from(e.name, 'utf8');
    const lh = Buffer.alloc(30);                       // 本地文件头
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x2821, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);

    const ch = Buffer.alloc(46);                       // 中央目录项
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x2821, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(off, 42);
    cents.push(ch, name);
    off += 30 + name.length + comp.length;
  });
  const cd = Buffer.concat(cents);
  const eocd = Buffer.alloc(22);                       // 中央目录结束记录
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat(parts.concat([cd, eocd]));
}

/* ---------- 拆 zip（独立实现一遍，不复用打包时的任何变量 —— 否则自证没有意义） ---------- */
function readEntry(buf, want) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是 zip：找不到 EOCD');
  const n = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('中央目录签名异常');
    const nl = buf.readUInt16LE(off + 28), el = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32);
    const name = buf.toString('utf8', off + 46, off + 46 + nl);
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const lo = buf.readUInt32LE(off + 42);
    if (name === want) {
      // 数据起点以**本地头**为准：本地头的 name/extra 长度可能与中央目录不同
      const lnl = buf.readUInt16LE(lo + 26), lel = buf.readUInt16LE(lo + 28);
      const start = lo + 30 + lnl + lel;
      const comp = buf.slice(start, start + csize);
      return method === 8 ? zlib.inflateRawSync(comp) : comp;
    }
    off += 46 + nl + el + cl;
  }
  return null;
}

/* ---------- 主流程 ---------- */
const noWrite = process.argv.indexOf('-n') >= 0;
const main = fs.readFileSync(MAIN);
console.log('主文件  ' + main.length + 'B  md5 ' + md5(main));
if (!noWrite) {
  fs.writeFileSync(OUT, buildZip(ENTRIES));
  console.log('已写出  ' + path.relative(ROOT, OUT) + '  ' + fs.statSync(OUT).size + 'B（' + ENTRIES.length + ' 个条目）');
}
const inner = readEntry(fs.readFileSync(OUT), 'index.html');
console.log('包内项  ' + inner.length + 'B  md5 ' + md5(inner));
const ok = inner.equals(main);
console.log(ok ? '✅ 包内 index.html 与主文件逐字节一致（G8c 应通过）'
  : '❌ 不一致 —— 门禁 G8c 会红。先确认 publish_taptap/ 与主文件同步，再重跑本脚本。');
process.exit(ok ? 0 : 1);

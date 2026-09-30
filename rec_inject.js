/* rec_inject.js —— 由主文件生成"录屏专用临时副本"（rec_mp4.js 的第 1 步）
 *
 * 为什么不能直接用主文件录屏：
 *   游戏脚本是 (function(){ 'use strict'; ... })() 包裹的，内部所有函数/状态都不是全局，
 *   外部没法调 genLevel / 读 G.tubes，也就没法精确点到某一根水管。
 *
 * 做法：把主文件复制一份，在 IIFE 收尾前插入一段 window.__DBG 导出。
 *   渲染与玩法代码 **一个字节都不改**，只多挂一个调试出口。
 *   交付文件 outputs/解压水消除.html 全程不动，并在这里打印它的 md5 以备核对。
 *
 * 用法：node rec_inject.js <主文件> <输出临时副本>
 */
const fs = require('fs');
const crypto = require('crypto');

const src = process.argv[2];
const dst = process.argv[3];

const html = fs.readFileSync(src, 'utf8');
const md5 = crypto.createHash('md5').update(fs.readFileSync(src)).digest('hex');

const INJECT = `
/* ===== 录屏用调试导出（仅存在于临时副本，绝不进交付文件） ===== */
window.__DBG = {
  G: G,
  genLevel: genLevel,
  handleTap: handleTap,
  info: function () {
    return { cw: cw, ch: ch, dpr: dpr, scale: scale, offX: offX, offY: offY,
      state: G.state, lv: G.level, tier: G.tier, daily: G.daily,
      canvasW: canvas.width, canvasH: canvas.height,
      clientW: canvas.clientWidth, clientH: canvas.clientHeight,
      anim: G.anim ? G.anim.type : null, moves: G.moves, clears: G.clears };
  },
  /* 每根水管：最底层颜色 + 层数 + 屏幕坐标（虚拟坐标 → CSS 像素） */
  tubes: function () {
    return G.tubes.map(function (t) {
      return { col: t.units.length ? t.units[0] : -1, n: t.units.length,
        cx: t.x * scale + offX, cy: (BOTT_Y - t.h / 2) * scale + offY,
        vx: t.x + t.tubeW / 2, vy: BOTT_Y - t.h / 2 };
    });
  },
  bottles: function () {
    return G.bottles.map(function (b, i) {
      return { i: i, col: b.col, cap: b.cap, fill: b.fill, place: b.place, slot: b.slot,
        locked: b.locked || 0, gate: b.gate, done: !!b.done,
        cx: b.x * scale + offX, cy: b.y * scale + offY, vx: b.x, vy: b.y };
    });
  },
  slots: function () {
    return G.slots.map(function (s, i) {
      return { i: i, open: s.open, cx: G.slotX[i] * scale + offX, cy: SLOT_Y * scale + offY };
    });
  },
  /* 用虚拟坐标点一下（和真人点画布等价：走的是同一个 handleTap） */
  tapV: function (vx, vy) {
    var sx = vx * scale + offX, sy = vy * scale + offY;
    handleTap(sx, sy);
    return { sx: sx, sy: sy };
  }
};
`;

// 从文件尾部往上找 IIFE 的收尾，插在它前面
const closer = '\n})();';
const idx = html.lastIndexOf(closer);
if (idx < 0) { console.error('ERROR: 没找到 IIFE 收尾标记 "\\n})();"'); process.exit(1); }

const out = html.slice(0, idx) + '\n' + INJECT + html.slice(idx);
fs.writeFileSync(dst, out, 'utf8');

console.log(JSON.stringify({
  src: src, dst: dst, mainMd5: md5,
  srcBytes: fs.statSync(src).size, dstBytes: fs.statSync(dst).size,
  injectedAt: idx
}, null, 2));

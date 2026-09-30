/* mp4info.js —— 不用任何库，直接扒 MP4 的 box 结构来数帧
 *
 * 为什么要这条独立路线：
 *   浏览器播放 fMP4 时 duration / seek 都不可靠，容易误判成"录出来是静止图"
 *   （Chrome 给 MediaRecorder 的 fMP4 报的 duration 是错的，按 currentTime 跳帧取样
 *    取到的永远是第一帧）。直接读 box 才是硬事实：所有 moof/traf/trun 里的
 *   sample_count 加起来 = 真的写了多少帧，stsd 里是 avc1(H.264) 还是别的编码。
 *
 * 用法：node mp4info.js <file.mp4>
 */
const fs = require('fs');

const file = process.argv[2];
const b = fs.readFileSync(file);
const out = { file, bytes: b.length };
const u32 = o => b.readUInt32BE(o);
const u64 = o => Number(b.readBigUInt64BE(o));
const fourcc = o => b.toString('ascii', o, o + 4);

/* 遍历 box：container 类型的 box 需要下钻 */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'moof', 'traf', 'edts', 'dinf', 'mvex', 'udta']);
const stats = { trun: 0, samples: 0, trunDur: 0, avc1: 0, hvc1: 0, mp4a: 0, styp: [], moof: 0, mdat: 0, boxes: [] };

function walk(start, end, depth) {
  let o = start;
  while (o + 8 <= end) {
    const size = u32(o);
    const type = fourcc(o + 4);
    if (size < 8 || o + size > end) break;
    const body = o + 8;
    if (depth <= 1) stats.boxes.push(type + ':' + size);

    if (type === 'mvhd' || type === 'mdhd') {
      const ver = b[body];
      const ts = ver === 1 ? u32(body + 20) : u32(body + 12);
      const du = ver === 1 ? u64(body + 24) : u32(body + 16);
      out[type] = { timescale: ts, duration: du, seconds: +(du / ts).toFixed(2) };
    } else if (type === 'stsd') {
      const n = u32(body + 4);
      let p = body + 8;
      for (let i = 0; i < n; i++) {
        const sz = u32(p), codec = fourcc(p + 4);
        if (codec === 'avc1') stats.avc1++;
        if (codec === 'hvc1' || codec === 'hev1') stats.hvc1++;
        if (codec === 'mp4a') stats.mp4a++;
        p += sz;
      }
    } else if (type === 'trun') {
      stats.trun++;
      const sc = u32(body + 4);
      stats.samples += sc;
      const flags = u32(o + 8) & 0xffffff;
      const version = b[body];
      let q = body + 8;
      if (flags & 0x000001) q += 4;                       // data_offset
      if (flags & 0x000004) q += 4;                       // first_sample_flags
      if (flags & 0x000100) {                             // sample_duration
        for (let i = 0; i < sc; i++) {
          stats.trunDur += u32(q);
          q += 4;
          if (flags & 0x000200) q += 4;
          if (flags & 0x000400) q += 4;
          if (flags & 0x000800) q += 4;
        }
      }
    } else if (type === 'styp' || type === 'ftyp') {
      stats.styp.push(type + ':' + fourcc(body) + '/' + fourcc(body + 4));
    } else if (type === 'moof') { stats.moof++; }
    else if (type === 'mdat') { stats.mdat += size - 8; }

    if (CONTAINERS.has(type)) walk(body, o + size, depth + 1);
    o += size;
  }
}
walk(0, b.length, 0);

out.tracks = { avc1_H264: stats.avc1, hvc1_HEVC: stats.hvc1, mp4a_AAC: stats.mp4a };
out.fragments = stats.moof;
out.trunBoxes = stats.trun;
out.videoFrames = stats.samples;
out.fpsIf30 = +(stats.samples / 30).toFixed(2);
out.mdatBytes = stats.mdat;
out.brand = stats.styp.slice(0, 3);
out.topBoxes = stats.boxes.slice(0, 24);

console.log(JSON.stringify(out, null, 2));

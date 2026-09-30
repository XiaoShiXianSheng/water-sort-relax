/* rec_play.js —— 录屏时的"页面内自动驾驶"（rec_mp4.js 的第 2 步，被当作表达式求值）
 *
 * 输入：window.__DBG（由 rec_inject.js 注入的调试导出）
 * 行为：开 MediaRecorder → 自动玩约 20 秒 → 停录 → 把 MP4 以 base64 挂到 window.__REC
 *
 * 玩法规则（从游戏本体读出来的，不是猜的）：
 *   · 点货架上的瓶子 → 瓶子飞上台面（startPlace）
 *   · 台面上有空瓶/半瓶时，tryDrinks() 每帧自动把「水管最底层」同色的水倒进去
 *   · 瓶子接满 cap 层 → 飞出消除
 * 所以好看的画面（倒水、接满、飞出）都是引擎自己在播，这里只负责"选对瓶子点一下"。
 */
(async () => {
  const D = window.__DBG;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const canvas = document.getElementById('game');
  const info0 = D.info();
  if (info0.state !== 'play') return { __err: 'state not play: ' + info0.state };

  const MIME = 'video/mp4;codecs=avc1';
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(MIME)) {
    return { __err: 'MediaRecorder 不支持 ' + MIME };
  }

  /* ---------- 关键改动：captureStream(0) + 自己泵帧 ----------
     踩过的坑：captureStream(30) 在 --headless=new 下只会吐开头几秒的帧，
     之后合成器不再给 canvas 帧源推帧（页面在无头里被判成"不可见"），
     结果录出来是一张定格图（4 帧全等、duration 只有 5s）。
     现在改成 captureStream(0)（手动模式），用 setInterval 每 33ms 调一次
     track.requestFrame()，帧的产生完全由我们驱动，不再依赖合成器。 */
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: MIME, videoBitsPerSecond: 5000000 });
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start(1000);

  let pumping = true, pumped = 0;
  const pump = () => { if (!pumping) return; try { track.requestFrame(); pumped++; } catch (e) { } };
  const iv = setInterval(pump, 33);
  pump();

  /* ---------- 玩法自动驾驶（只点瓶子，倒水/接满/飞出都是引擎自己在播） ---------- */
  const pick = (allowGate) => {
    const tubes = D.tubes();
    const bs = D.bottles();
    const movable = bs.filter(b => b.place === 'grid' && !b.locked && (allowGate || b.gate < 0));
    const counter = bs.filter(b => b.place === 'counter' && !b.done && b.fill < b.cap);
    for (const c of counter) {
      if (!tubes.some(t => t.col === c.col && t.n > 0)) continue;
      const cand = movable.filter(b => b.col === c.col);
      if (cand.length) return cand[0];
    }
    for (const t of tubes) {
      if (t.n <= 0) continue;
      const cand = movable.filter(b => b.col === t.col);
      if (cand.length) return cand[0];
    }
    return null;
  };

  const taps = [];
  const t0 = performance.now();
  const BUDGET = +(window.__REC_BUDGET || 20000);

  /* 分窗口测 rAF，确认游戏循环整段都在跑（不是只有开头在动） */
  const fpsWin = []; let rafN = 0, winStart = t0;
  const rafTick = () => { rafN++; requestAnimationFrame(rafTick); };
  requestAnimationFrame(rafTick);

  let lastTap = 0, miss = 0;
  while (performance.now() - t0 < BUDGET) {
    const now = performance.now();
    if (now - winStart >= 4000) { fpsWin.push(+(rafN / ((now - winStart) / 1000)).toFixed(1)); rafN = 0; winStart = now; }
    const st = D.info();
    if (st.state !== 'play') break;
    if (st.anim) { await sleep(100); continue; }
    if (now - lastTap < 900) { await sleep(70); continue; }
    miss++;
    const b = pick(miss > 6);
    if (!b) { await sleep(150); continue; }
    D.tapV(b.vx, b.vy);
    taps.push({ i: b.i, col: b.col, at: Math.round(performance.now() - t0) });
    lastTap = performance.now(); miss = 0;
    await sleep(240);
  }

  await sleep(1400);
  pumping = false; clearInterval(iv);
  rec.stop();
  await stopped;

  const blob = new Blob(chunks, { type: 'video/mp4' });
  const u8 = new Uint8Array(await blob.arrayBuffer());
  let bin = ''; const STEP = 0x8000;
  for (let i = 0; i < u8.length; i += STEP) bin += String.fromCharCode.apply(null, u8.subarray(i, i + STEP));
  window.__REC = btoa(bin);

  return {
    ok: true, mime: rec.mimeType, chunks: chunks.length, bytes: blob.size,
    seconds: +((performance.now() - t0) / 1000).toFixed(2),
    pumpedFrames: pumped, trackReady: track.readyState, tracks: stream.getVideoTracks().length,
    fpsWin: fpsWin,
    taps: taps.length, tapSeq: taps.map(x => x.i + '#' + x.col),
    before: info0, after: D.info()
  };
})()

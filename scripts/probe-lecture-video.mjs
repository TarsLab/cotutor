#!/usr/bin/env node
/**
 * 视频小课堂(《小课堂设计.md》§八第 4 步)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱;样本视频 tests/fixtures/lectures/2026-10-06-pingjunfen,18 秒,三句):
 * 首页数学老师卡上第二个小课堂按钮(视频,「18 秒」)→ 点了铺满:「开始看」→ 放着:视频在走、字幕是第一句、三个句子点 → 拖到 0:12:视频跟着 →
 * 暂停,在画面上圈一处:记号、「圈好了」、这一处带一张截图(jpeg,叠了圈)→ 放到结尾 → 看完那排圈的卡是截图 →
 * 问一句:截图先传进 captures/、消息带着它;节前的圈的卡是传上去的那张 → 老师那一节的 lecture 卡(视频 0:05–0:11,缩略图是视频那一帧)
 * → 讲稿 [[play]] 自己放、停在 0:11、接着念;家长端那条的圈写着「圈在截图上(photos 第 1 张)」。iPad 横屏,每步截图。
 *
 * 用法:node scripts/probe-lecture-video.mjs [--shots <目录>] [--keep]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const keep = process.argv.includes('--keep');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8798;
const cdp = 9342;
const base = `https://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-lecture-video-'));
const shots = arg('--shots') ?? join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--delay', '1200'], { stdio: 'ignore', detached: keep });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/kid/home`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  // CDP 的 click 不算手势:放开自动播放(iPad 上是孩子的那一下)
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  // 页面与舞台里的未捕获异常照原样打出来(舞台包是压缩过的,看行列号对 dist/stage/)
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.log('  页面异常', JSON.stringify(m.params.exceptionDetails).slice(0, 300)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
  const until = async (expr, n = 80) => { for (let i = 0; i < n; i++) { if (await evaluate(expr).catch(() => false)) return true; await sleep(250); } return false; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const f = join(shots, name); writeFileSync(f, Buffer.from(r.result.data, 'base64')); console.log('  ', f); };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/` });
  await until(`document.querySelectorAll('.bt-lecture').length > 1`);
  const F = `document.querySelector('#lc-frame')`;
  const D = `${F}.contentDocument`;
  const BTN = `[...document.querySelectorAll('.bt-lecture')].find((b) => b.textContent.includes('平均分'))`;

  const btn = await evaluate(`${BTN}?.textContent`);
  ok('首页:数学老师卡上的视频小课堂按钮,课长从 mp4 读的', /^小课堂平均分怎么分18 秒 · 看完再问老师$/.test(btn ?? ''), btn);

  await evaluate(`${BTN}.click()`);
  const opened = await until(`!${F}.hidden && Boolean(${D}?.querySelector('.lc-start')) && Boolean(${D}?.querySelector('video.lc-video'))`);
  const pre = await evaluate(`({ dots: ${D}.querySelectorAll('.lc-dot').length, time: ${D}.querySelector('.lc-time span').textContent, box: (() => { const b = ${D}.querySelector('.lc-vbox').getBoundingClientRect(); return Math.round(b.width / b.height * 100) / 100; })() })`);
  ok('点了:铺满的是视频,三个句子点、课长 0:18;画框按视频的宽高比(16:9)', opened && pre.dots === 3 && pre.time === '0:00 / 0:18' && Math.abs(pre.box - 16 / 9) < 0.03, JSON.stringify(pre));

  await evaluate(`${D}.querySelector('.lc-start').click()`);
  await sleep(2500);
  const run = await evaluate(`({ time: ${D}.querySelector('.lc-time span').textContent, line: ${D}.querySelector('.lc-line').textContent, t: ${D}.querySelector('video').currentTime, paused: ${D}.querySelector('video').paused })`);
  ok('放着:视频在走,时钟跟视频,字幕是第一句', !run.paused && run.t > 1.5 && /^0:0[1-3] /.test(run.time) && run.line.startsWith('12 块饼干'), JSON.stringify(run));
  await shot('video-playing.png');

  // 拖到 0:12 附近,停下,圈画面中间一块
  await evaluate(`(() => { const t = ${D}.querySelector('.lc-track'); const r = t.getBoundingClientRect(); const x = r.left + r.width * (12.4 / 18), y = r.top + r.height / 2; const ev = (type) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 })); ev('pointerdown'); ev('pointermove'); ev('pointerup'); return true; })()`);
  await sleep(300);
  await evaluate(`${D}.querySelector('.lc-play').click()`);
  await sleep(500);
  const seek = await evaluate(`({ time: ${D}.querySelector('.lc-time span').textContent, t: ${D}.querySelector('video').currentTime, line: ${D}.querySelector('.lc-line').textContent })`);
  ok('拖到 0:12、停下:视频挪过去了,字幕是第三句', /^0:1[23] /.test(seek.time) && seek.t > 11.8 && seek.t < 13.5 && seek.line.startsWith('分完了'), JSON.stringify(seek));
  const marked = await evaluate(`(() => {
    const d = ${D}, over = d.querySelector('.lc-over'), canvas = d.querySelector('.lc-canvas');
    const r = over.getBoundingClientRect(); const cx = r.left + r.width * 0.5, cy = r.top + r.height * 0.5, rx = r.width * 0.15, ry = r.height * 0.18;
    const at = (k) => { const a = k / 24 * Math.PI * 2; return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }; };
    const ev = (type, p) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 7, isPrimary: true }));
    ev('pointerdown', at(0)); for (let k = 1; k <= 24; k++) ev('pointermove', at(k)); ev('pointerup', at(24));
    return new Promise((res) => setTimeout(() => res({ marks: d.querySelectorAll('.lc-mark').length, line: d.querySelector('.lc-line').textContent, ink: d.querySelectorAll('.lc-over .lc-ink path').length }), 300));
  })()`);
  ok('在视频上圈了一处:进度条上一个蓝记号、「圈好了」、画面上留着那一圈', marked.marks === 1 && marked.line.startsWith('圈好了,记在 0:1') && marked.ink === 1, JSON.stringify(marked));
  await shot('video-circle.png');

  // 放到结尾(点第 3 个句子点再放完)
  await evaluate(`${D}.querySelector('.lc-play').click()`);
  const finished = await until(`${F}.hidden && Boolean(document.querySelector('.lc-pending .c-mark'))`, 60);
  const mk = await evaluate(`(() => { const img = document.querySelector('.lc-pending .c-mark img'); return { src: img?.getAttribute('src')?.slice(0, 22), w: img?.naturalWidth ?? 0, h: img?.naturalHeight ?? 0, label: document.querySelector('.lc-pending .c-mark .mk-t')?.textContent }; })()`);
  ok('放完:看完那排一张圈的卡,缩略图是那一帧的截图(jpeg,320×180,叠着圈)', finished && mk.src === 'data:image/jpeg;base64' && mk.w === 320 && mk.h === 180 && /^你圈的0:1\d$/.test(mk.label), JSON.stringify(mk));
  await shot('video-done.png');

  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '为什么要轮着分'; document.querySelector('#go').click(); return true; })()`);
  const answered = await until(`document.querySelectorAll('#board .sec .c-mark').length === 1 && !document.querySelector('.lc-pending')`, 80);
  const sec = await evaluate(`({ src: document.querySelector('#board .sec .c-mark img')?.getAttribute('src'), seg: document.querySelector('#board .sec .c-lecture .pl')?.textContent, still: Boolean(document.querySelector('#board .sec .c-lecture video.lc-still')) })`);
  ok('问了一句:截图传进 captures/,节前圈的卡是传上去的那张;老师那一节的 lecture 卡放视频 0:05–0:11,缩略图是视频那一帧', answered && /^\/api\/kid\/image\?p=captures/.test(sec.src ?? '') && sec.seg === '0:05–0:11 ▷' && sec.still, JSON.stringify(sec));
  await shot('video-answered.png');

  const SF = `document.querySelector('#st-frame')`;
  const playing = await until(`document.querySelector('#stage').classList.contains('on') && Boolean(${SF}.contentDocument?.querySelector('.lc.lc-card video.lc-video'))`, 120);
  const segDone = playing && await until(`${SF}.contentDocument?.querySelector('.lc-time span')?.textContent === '0:10 / 0:18' && document.querySelector('#sub-text').textContent.startsWith('每人分到几块')`, 120);
  const st = await evaluate(`({ t: ${SF}.contentDocument?.querySelector('video')?.currentTime, paused: ${SF}.contentDocument?.querySelector('video')?.paused, on: document.querySelector('#stage').classList.contains('on') })`);
  ok('讲稿 [[play]]:舞台里放视频那一段,停在 0:11 前、舞台不关、字幕行接着念', segDone && st.paused && st.t > 10.5 && st.t < 11.2 && st.on, JSON.stringify(st));
  await shot('video-seg-done.png');

  const pb = await (await fetch(`${base}/api/conversations/math-tutor/today/board`)).json();
  const pm = pb.messages.find((m) => m.lecture?.video)?.lecture?.marks?.[0];
  ok('家长端:圈带着那段话(那时在讲哪句、截图是 photos 第 1 张)与截图路径', /^0:1\d 圈的,那时在讲『分完了/.test(pm?.text ?? '') && pm.text.endsWith('圈在截图上(photos 第 1 张)') && /^captures\//.test(pm.image ?? ''), JSON.stringify(pm));
} finally {
  browser?.kill();
  await sleep(600);
  if (!keep) { mock.kill(); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  else console.log(`留下了:mock 在 ${base}(pid ${mock.pid}),截图在 ${shots}`);
}

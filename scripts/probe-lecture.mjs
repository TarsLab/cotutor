#!/usr/bin/env node
/**
 * 小课堂的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱;样本课包 tests/fixtures/bundles/2026-09-18-po13-jian-8 没有配音,按配音时长走)。
 * 2026-11-17(阶段 5)起小课堂是一节课里的一页:点首页的小课堂海报,舞台(#st-frame)照一节课的状态铺上这堂课,回首页是舞台左上的胶囊,老师的牌贴着屏幕边。
 * 首页数学老师卡上的小课堂海报(课长)→ 点了页上铺这堂课:「开始看」、按住说话藏着 → 放着:字幕、进度条、时间走 → 拖到中间 → 暂停 →「画一画」「擦掉」→
 * 在画面上圈散的 3 根小棒:进度条上一个蓝记号、「画好了,记在 0:2x」→ 擦掉再圈 → 同一刻再画一笔:还是一处、两笔 →
 * 点进度条第 6 段放到结尾 → 停在最后一帧,话音落了播放钮换成「再看一遍」、提示「有不懂就问老师」,能开口了 →
 * 打字问一句 → 消息带着看的情况与画的(截图先传进 captures/)→ mock 老师的讲稿 [[看 0:19–0:30]]:念完那句页上从 0:19 放到 0:30 停住,接着念下一句;
 * 家长端那条的画带着给老师的那段话(截图是这一轮附的第 1 张图、画的地方盖着什么);家长看录像:看课那一段页上的课跟着录像走(只看),点「画了一处」停在那一刻、画着那两笔。
 * iPad 横屏,每步截图。
 *
 * 用法:node scripts/probe-lecture.mjs [--shots <目录>] [--keep]
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8799;
const cdp = 9341;
const base = `https://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
const tmp = probeDir('cotutor-probe-lecture-');
const shots = arg('--shots') ?? join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--delay', '1200'], { stdio: 'ignore', detached: keep });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/kid/home`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
  const until = async (expr, n = 80) => { for (let i = 0; i < n; i++) { if (await evaluate(expr).catch(() => false)) return true; await sleep(250); } return false; };
  // 真的鼠标(CDP Input):按下、一串移动、松手,走浏览器的命中判定(页面上盖着什么、pointer-events 关没关都算数;dispatchEvent 直接派到元素上会漏掉)
  const drag = async (pts) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0].x, y: pts[0].y, button: 'left', buttons: 1, clickCount: 1 });
    for (const p of pts.slice(1)) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
    const z = pts[pts.length - 1];
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: z.x, y: z.y, button: 'left', buttons: 0, clickCount: 1 });
  };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const f = join(shots, name); writeFileSync(f, Buffer.from(r.result.data, 'base64')); console.log('  ', f); };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/` });
  // 首页只展开最前那位(C 版):小课堂按钮在数学老师卡上,先把数学换到最前
  await until(`!!document.querySelector('#deck .pc[data-tutor="math-tutor"] .pc-hd .av')`);
  await evaluate(`document.querySelector('#deck .pc[data-tutor="math-tutor"] .pc-hd .av').click()`);
  await until(`document.querySelector('#deck .pc.front')?.dataset.tutor === 'math-tutor'`);
  await sleep(900);
  await until(`document.querySelectorAll('.bt-lecture').length > 0`);
  const F = `document.querySelector('#st-frame')`;
  const D = `${F}.contentDocument`;

  const btn = await evaluate(`document.querySelector('.bt-lecture').textContent`);
  ok('首页:数学老师卡上的小课堂海报,带预览图与课长', /^小课堂13 减 8 怎么拆46 秒$/.test(btn) && await evaluate(`Boolean(document.querySelector('.bt-lecture .lp img'))`), btn);
  await shot('lecture-home.png');

  await evaluate(`document.querySelector('.bt-lecture').click()`);
  const opened = await until(`document.querySelector('#stage').classList.contains('lcp') && !${F}.hidden && Boolean(${D}?.querySelector('.lc-start'))`);
  const pre = await evaluate(`({ segs: ${D}.querySelectorAll('.lc-seg').length, time: ${D}.querySelector('.lc-time').textContent, pill: document.querySelector('#pill').hidden, nosend: document.body.classList.contains('nosend'), back: getComputedStyle(document.querySelector('#st-x')).display !== 'none' && document.querySelector('#st-x').classList.contains('st-back'), go: getComputedStyle(document.querySelector('#st-act')).display, hint: ${D}.querySelector('.lc-hint')?.textContent })`);
  ok('点了:页上铺这堂课(舞台 lcp),「开始看」,进度条一句一段六段、课长;按住说话藏着(看完才能开口);左上回首页的胶囊;「给老师看」不出', opened && pre.segs === 6 && /^0:00 \/ 0:4\d$/.test(pre.time) && pre.pill && pre.nosend && pre.back && pre.go === 'none' && pre.hint === '看完就能问老师', JSON.stringify(pre));
  // 页面浮在舞台上的(左上胶囊、贴边的老师牌)不压画面、不压竖栏
  const box = (e) => `(() => { const b = (${e}).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; })()`;
  const geo = await evaluate(`({ pill: ${box(`document.querySelector('#st-x')`)}, hold: getComputedStyle(document.querySelector('#cv-hold')).display === 'none' ? null : ${box(`document.querySelector('#cv-hold')`)}, frame: ${box(F)}, vbox: (() => { const f = ${F}.getBoundingClientRect(), b = ${D}.querySelector('.lc-vbox').getBoundingClientRect(); return [Math.round(f.left + b.left), Math.round(f.top + b.top), Math.round(f.left + b.right), Math.round(f.top + b.bottom)]; })(), rail: (() => { const f = ${F}.getBoundingClientRect(), b = ${D}.querySelector('.lc-rail').getBoundingClientRect(); return [Math.round(f.left + b.left), Math.round(f.top + b.top), Math.round(f.left + b.right), Math.round(f.top + b.bottom)]; })() })`);
  const hit = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  ok('左上胶囊、老师的牌不压画面也不压竖栏(竖栏在老师牌的对面)', !hit(geo.pill, geo.vbox) && !hit(geo.hold, geo.vbox) && !hit(geo.hold, geo.rail) && !hit(geo.pill, geo.rail), JSON.stringify(geo));
  await shot('lecture-start.png');

  await evaluate(`${D}.querySelector('.lc-start').click()`);
  await sleep(6000);
  const run = await evaluate(`({ time: ${D}.querySelector('.lc-time').textContent, line: ${D}.querySelector('.lc-line').textContent, on: [...${D}.querySelectorAll('.lc-seg b')].filter((b) => parseFloat(b.style.width) > 0).length, drawn: ${D}.querySelector('.lc-svg') !== null })`);
  ok('放着:时间走、字幕是第一句、画面在画', /^0:0[5-7] /.test(run.time) && run.line.startsWith('先看 13 减 8') && run.on === 1 && run.drawn, JSON.stringify(run));
  await shot('lecture-playing.png');

  // 舞台里的坐标 → 页面坐标(CDP 的鼠标事件按页面算)
  const OFF = `(() => { const f = ${F}.getBoundingClientRect(); return { x: f.left, y: f.top }; })()`;
  const off = await evaluate(OFF);
  const tp = await evaluate(`(() => { const r = ${D}.querySelector('.lc-track').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height / 2 }; })()`);
  const at = (p) => ({ x: p.x + off.x, y: p.y + off.y });
  await drag([at(tp), at({ x: tp.x + 1, y: tp.y }), at(tp)]);
  await sleep(300);
  const mid = await evaluate(`${D}.querySelector('.lc-time').textContent`);
  ok('拖到中间:时间跳过去', /^0:2[2-4] /.test(mid), mid);

  await evaluate(`${D}.querySelector('.lc-play').click()`);
  await sleep(300);
  const tools = await evaluate(`[...${D}.querySelectorAll('.lc-tool')].map((b) => b.textContent.trim() + (b.disabled ? '(灰)' : '')).join(' ') + ' | ' + ${D}.querySelector('.lc-play').textContent.trim()`);
  ok('暂停:「画一画」「擦掉」(这一刻没画过,擦掉是灰的),播放钮写「接着看」', tools === '画一画 擦掉(灰) | 接着看', tools);
  /** 在画面上画一笔:课包坐标的折线(屏幕点由 SVG 的 getScreenCTM 正算,再加上舞台在页面里的位置) */
  const strokeAt = async (bundlePts) => {
    const pts = await evaluate(`(() => {
    const d = ${D}, svg = d.querySelector('.lc-svg');
    const g = [...svg.children].find((e) => e.tagName === 'g'); const m0 = /translate\\(([-\\d.]+) ([-\\d.]+)/.exec(g.getAttribute('transform'));
    const dx = Number(m0[1]) - 450, dy = Number(m0[2]) - 22;
    const ctm = svg.getScreenCTM();
    return ${JSON.stringify(bundlePts)}.map(([x, y]) => { const p = new DOMPoint(x + dx, y + dy).matrixTransform(ctm); return { x: p.x, y: p.y }; });
  })()`);
    await drag(pts.map(at));
    await sleep(300);
    return evaluate(`(() => { const d = ${D}; return { marks: d.querySelectorAll('.lc-mark').length, line: d.querySelector('.lc-line').textContent, count: d.querySelector('.lc-time small')?.textContent ?? '', ink: d.querySelectorAll('.lc-ink path').length }; })()`);
  };
  const circle = (cx, cy, rx, ry) => strokeAt(Array.from({ length: 25 }, (_, k) => { const a = (k / 24) * Math.PI * 2; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; }));
  const c1 = await circle(334, 120, 45, 50);
  ok('画了一处:进度条上一个蓝记号、字幕行「画好了,记在 0:2x」、「画了 1 处」、画面上留着那一圈', c1.marks === 1 && /^画好了,记在 0:2\d。/.test(c1.line) && c1.count === '画了 1 处' && c1.ink === 1, JSON.stringify(c1));
  await shot('lecture-circle.png');
  await evaluate(`[...${D}.querySelectorAll('.lc-tool')][1].click()`);
  await sleep(200);
  const erased = await evaluate(`({ marks: ${D}.querySelectorAll('.lc-mark').length, ink: ${D}.querySelectorAll('.lc-ink path').length })`);
  const c2 = await circle(334, 120, 45, 50);
  ok('擦掉:记号与画面上的圈都没了;再圈一处又有了', erased.marks === 0 && erased.ink === 0 && c2.marks === 1, JSON.stringify({ erased, c2 }));
  const c2b = await strokeAt([[372, 100], [384, 116], [410, 70]]);
  ok('同一刻再画一笔:还是一处(一个记号、「画了 1 处」),画面上两笔', c2b.marks === 1 && c2b.count === '画了 1 处' && c2b.ink === 2, JSON.stringify(c2b));
  await shot('lecture-two-strokes.png');
  await evaluate(`${D}.querySelector('.lc-play').click()`);
  await sleep(300);

  // 点进度条第 6 段放到结尾:停在最后一帧,能开口了
  const seg5 = await evaluate(`(() => { const r = ${D}.querySelectorAll('.lc-seg')[5].getBoundingClientRect(); return { x: r.left + 2, y: r.top + r.height / 2 }; })()`);
  await drag([at(seg5)]);
  const atEnd = await until(`/^0:4\\d \\/ 0:4\\d$/.test(${D}.querySelector('.lc-time span').textContent) && ${D}.querySelector('.lc-play').getAttribute('aria-label') === '播放'`, 60);
  const faded = await until(`${D}.querySelector('.lc-play').textContent.trim() === '再看一遍'`, 12);
  const endUi = await evaluate(`({ play: ${D}.querySelector('.lc-play').textContent.trim(), hint: ${D}.querySelector('.lc-hint')?.textContent, pill: document.querySelector('#pill').hidden, nosend: document.body.classList.contains('nosend'), line: ${D}.querySelector('.lc-line').textContent })`);
  ok('放到结尾:停在最后一帧;播放钮换成「再看一遍」、提示「有不懂就问老师」;能开口了(按住说话出来)', atEnd && faded && endUi.play === '再看一遍' && endUi.hint === '有不懂就问老师' && !endUi.nosend && endUi.line.startsWith('所以,13 减 8 等于 5'), JSON.stringify(endUi));
  await shot('lecture-end.png');

  // 问一句(打字):消息带着看的情况与画的;mock 老师在页上放 0:19–0:30
  const typed = await evaluate(`(() => { const t = document.querySelector('#typed'); if (!t) return false; t.value = '为什么要拆开那一捆'; document.querySelector('#go').click(); return true; })()`);
  const segOn = await until(`/^0:(19|2\\d) \\/ 0:46$/.test(${D}.querySelector('.lc-time span')?.textContent ?? '') && ${D}.querySelector('.lc-play')?.getAttribute('aria-label') === '暂停'`, 160);
  const st0 = await evaluate(`({ time: ${D}.querySelector('.lc-time span').textContent, range: Boolean(${D}.querySelector('.lc-range')), sub: document.querySelector('#lv-cap .lv-cur')?.textContent ?? '' })`);
  ok('问了一句;讲稿念到 [[看 0:19–0:30]] 那句:页上从 0:19 放起、进度条上标着那一段;字幕停在念的那句', typed && segOn && st0.range && st0.sub.startsWith('我们回到拆开那一捆的地方'), JSON.stringify(st0));
  await shot('lecture-seg-playing.png');
  const segDone = await until(`${D}.querySelector('.lc-time span')?.textContent === '0:29 / 0:46' || ${D}.querySelector('.lc-time span')?.textContent === '0:30 / 0:46'`, 120);
  const resumed = await until(`(document.querySelector('#lv-cap .lv-cur')?.textContent ?? '').startsWith('拿走 8 根')`, 80);
  const st1 = await evaluate(`({ time: ${D}.querySelector('.lc-time span').textContent, playing: ${D}.querySelector('.lc-play').getAttribute('aria-label'), lcp: document.querySelector('#stage').classList.contains('lcp'), sub: document.querySelector('#lv-cap .lv-cur')?.textContent })`);
  ok('放到 0:30 停在末帧,页还在,字幕接着念下一句', segDone && resumed && st1.playing === '播放' && st1.lcp, JSON.stringify(st1));
  await shot('lecture-seg-done.png');

  const pb = await (await fetch(`${base}/api/conversations/math-tutor/today/board`)).json();
  const pm = pb.messages.find((m) => m.lecture)?.lecture?.marks?.[0];
  ok('家长端:那条的画带着给老师的那段话(截图是这一轮附的第 1 张图、画的地方盖着散的 3 根)、两笔', Boolean(pm?.text?.includes('截图附在这一轮(第 1 张图)') && pm.text.includes('画的地方盖着:') && pm.text.includes('第 1 步画的 3 条线') && pm.strokes?.length === 2), pm?.text ?? JSON.stringify(pb.messages.map((m) => m.lecture)));

  // 家长看录像:看小课堂那一段,孩子的屏幕上页上的课跟着录像走
  await send('Page.navigate', { url: `${base}/parent` });
  const MATH_EV = `[...document.querySelectorAll('.pev')].find((p) => (p.querySelector('.pv-who')?.textContent ?? '').includes('数学'))?.querySelector('.kid')`;
  await until(`Boolean(${MATH_EV})`, 40);
  await evaluate(`${MATH_EV}.click()`);
  await until(`!document.querySelector('#rl').hidden && !document.querySelector('#rl-screen').hidden`, 40);
  await until(`Boolean(document.querySelector('#rl-frame').contentWindow.cotutorReel)`, 40);
  await evaluate(`(() => { const r = document.querySelector('#rl-seek'); r.value = '0'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
  const KF = `document.querySelector('#rl-frame').contentDocument.querySelector('#st-frame')`;
  const KD = `${KF}?.contentDocument`;
  const reelOn = await until(`Boolean(${KD}?.querySelector('.lc .lc-svg'))`, 80);
  const r0 = await evaluate(`({ kinds: [...document.querySelectorAll('#rl-marks i')].map((i) => i.className).join(' '), sub: document.querySelector('#rl-cap').textContent, start: Boolean(${KD}.querySelector('.lc-start')), tools: ${KD}.querySelectorAll('.lc-tool').length })`);
  ok('录像从看小课堂开始:进度条上「看小课堂」「画了一处」的点;孩子的屏幕上页上铺着这堂课、只看(没有开始看、没有画一画);录像栏写在看小课堂', reelOn && r0.kinds.startsWith('lecture') && r0.kinds.includes('ink') && !r0.start && r0.tools === 0 && /^[▷⏸] /.test(r0.sub), JSON.stringify(r0));
  await shot('reel-lecture.png');
  await evaluate(`document.querySelector('#rl-marks i.ink').click()`);
  await sleep(800);
  const r1 = await evaluate(`({ time: ${KD}.querySelector('.lc-time span').textContent, ink: ${KD}.querySelectorAll('.lc-ink path').length, marks: ${KD}.querySelectorAll('.lc-mark').length, sub: document.querySelector('#rl-cap').textContent })`);
  ok('点「画了一处」:录像停在画下去那一刻,页上的课停在画的那一刻(0:2x),画面上画着那两笔', /^0:2[2-4] \/ 0:46$/.test(r1.time) && r1.ink === 2 && r1.marks >= 1 && r1.sub.startsWith('⏸ 小课堂停在 0:2'), JSON.stringify(r1));
  await shot('reel-circle.png');
} finally {
  browser?.kill();
  await sleep(600);
  if (!keep) { mock.kill(); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  else console.log(`留下了:mock 在 ${base}(pid ${mock.pid}),截图在 ${shots}`);
}

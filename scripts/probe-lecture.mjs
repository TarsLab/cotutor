#!/usr/bin/env node
/**
 * 小课堂(《小课堂设计.md》)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱;样本课包 tests/fixtures/bundles/2026-09-18-po13-jian-8 没有配音,按配音时长走):
 * 首页数学老师卡上的小课堂按钮(课长、「看完再问老师」)→ 点了铺满:「开始看」→ 放着:字幕、进度条一段段走、时间走 → 拖到中间:画面跟着、不出声 →
 * 暂停 → 竖栏「圈一圈」变蓝、「擦掉」灰 → 在画面上圈散的 3 根小棒:进度条上一个蓝记号、字幕行「圈好了,记在 0:2x」→ 擦掉再圈 → 接着看 → 放着点「圈一圈」= 停下拿起笔 →
 * 点进度条第 6 段放到结尾 → 停在最后一帧不收,话音落了约 1 秒播放钮换成「再看一遍」、右头淡入「去问老师」 → 点「去问老师」→ 看完:铺满的收起,板书顶上小课堂卡(圈了 1 处)+ 一张圈的卡(缩略图是那一刻的画面 + 蓝圈,能删)+「看完了!有什么想问老师的?」,输入条亮、头上「小课堂」→
 * 从输入条问一句 → 老师那一节的节前画着小课堂卡与圈的卡(不能删了),提示撤掉;老师那一节有一张小课堂卡(放课里 0:19–0:30,缩略图是那一段的末帧),
 * 讲稿念到 [[play]] 自己铺满放那一段、放到 0:30 停在末帧、舞台不关、接着念下一句;家长端那条的圈带着算出来的那段话;
 * 家长看录像:从看小课堂开始,进度条上有「看小课堂」「圈了一处」的点,看课那一段播放器铺在板书上跟着录像走(只看),点「圈了一处」停在圈的那一刻、画着那一圈。iPad 横屏,每步截图。
 *
 * 用法:node scripts/probe-lecture.mjs [--shots <目录>] [--keep]
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
const port = 8799;
const cdp = 9341;
const base = `https://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-lecture-'));
const shots = arg('--shots') ?? join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--delay', '1200'], { stdio: 'ignore', detached: keep });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/kid/home`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
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
  // 点进度条第 k 段的开头(真鼠标,点哪就跳到哪)
  const tapSeg = async (k) => { const p = await evaluate(`(() => { const r = ${D}.querySelectorAll('.lc-seg')[${k}].getBoundingClientRect(); return { x: r.left + 2, y: r.top + r.height / 2 }; })()`); await drag([p]); };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const f = join(shots, name); writeFileSync(f, Buffer.from(r.result.data, 'base64')); console.log('  ', f); };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/` });
  await until(`document.querySelectorAll('.bt-lecture').length > 0`);
  const F = `document.querySelector('#lc-frame')`;
  const D = `${F}.contentDocument`;

  const btn = await evaluate(`document.querySelector('.bt-lecture').textContent`);
  ok('首页:数学老师卡上的小课堂按钮,带课长与「看完再问老师」', /^小课堂13 减 8 怎么拆46 秒 · 看完再问老师$/.test(btn), btn);
  await shot('lecture-home.png');

  await evaluate(`document.querySelector('.bt-lecture').click()`);
  const opened = await until(`!${F}.hidden && Boolean(${D}?.querySelector('.lc-start'))`);
  const pre = await evaluate(`({ segs: ${D}.querySelectorAll('.lc-seg').length, nums: ${D}.querySelectorAll('.lc-dot').length, time: ${D}.querySelector('.lc-time').textContent, pill: document.querySelector('#pill').hidden })`);
  ok('点了:铺满,「开始看」,进度条一句一段六段、不写数字(拍板 40)、课长;下面的输入条藏着', opened && pre.segs === 6 && pre.nums === 0 && /^0:00 \/ 0:4\d$/.test(pre.time) && pre.pill, JSON.stringify(pre));
  // 左上「‹ 头像」和老师页的返回胶囊一个样子、一个位置(拍板 39);浮在上面,不压画面
  const cap = await evaluate(`(() => { const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; }; const mine = ${D}.querySelector('.lc-back'), av = mine?.querySelector('.lc-av'), page = document.querySelector('#c-av'); return { mine: mine ? r(mine) : null, page: r(document.querySelector('#back')), av: av ? (av.querySelector('img')?.getAttribute('src') ?? av.textContent) : null, pageAv: page.querySelector('img')?.getAttribute('src') ?? page.textContent, color: av ? getComputedStyle(av).borderTopColor : null, pageColor: getComputedStyle(page).borderTopColor, gap: Math.round(${D}.querySelector('.lc-canvas').getBoundingClientRect().left - mine.getBoundingClientRect().right) }; })()`);
  ok('左上「‹ 头像」:和老师页的返回胶囊同一个位置、同样大、同一个头像与颜色;不压画面', cap.mine && cap.mine.join() === cap.page.join() && cap.av && cap.av === cap.pageAv && cap.color === cap.pageColor && cap.gap >= 8, JSON.stringify(cap));
  const bare = await evaluate(`(() => { const d = ${D}, c = getComputedStyle(d.querySelector('.lc-canvas')), b = d.querySelector('.lc-vbox').getBoundingClientRect(), vb = d.querySelector('.lc-svg').viewBox.baseVal; return { border: c.borderTopWidth, canvasBg: c.backgroundColor, bg: getComputedStyle(d.querySelector('.lc')).backgroundColor, ratio: Math.round(b.width / b.height * 100) / 100, vb: Math.round(vb.width / vb.height * 100) / 100, bar: getComputedStyle(d.querySelector('.lc-bar')).borderTopWidth }; })()`);
  ok('画面没有框:底色是板子的纸色、画框按课包 viewBox 的宽高比,控制那行也不加框(拍板 40)', bare.border === '0px' && bare.canvasBg === 'rgba(0, 0, 0, 0)' && bare.bg === 'rgb(255, 253, 248)' && Math.abs(bare.ratio - bare.vb) < 0.02 && bare.bar === '0px', JSON.stringify(bare));
  await shot('lecture-start.png');

  await evaluate(`${D}.querySelector('.lc-start').click()`);
  await sleep(6000);
  const run = await evaluate(`({ time: ${D}.querySelector('.lc-time').textContent, line: ${D}.querySelector('.lc-line').textContent, on: [...${D}.querySelectorAll('.lc-seg b')].filter((b) => parseFloat(b.style.width) > 0).length, drawn: ${D}.querySelector('.lc-svg') !== null })`);
  ok('放着:时间走、字幕是第一句、画面在画', /^0:0[5-7] /.test(run.time) && run.line.startsWith('先看 13 减 8') && run.on === 1 && run.drawn, JSON.stringify(run));
  await shot('lecture-playing.png');

  // 拖到中间:按下、移、松手(拖着不出声由播放器保证,这里看画面与时间跟着)
  const tp = await evaluate(`(() => { const r = ${D}.querySelector('.lc-track').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height / 2 }; })()`);
  await drag([tp, { x: tp.x + 1, y: tp.y }, tp]);
  await sleep(300);
  const mid = await evaluate(`${D}.querySelector('.lc-time').textContent`);
  ok('拖到中间:时间跳过去', /^0:2[2-4] /.test(mid), mid);
  await shot('lecture-seek.png');

  // 暂停,在画面上圈散的 3 根小棒(课包坐标 334,120 一圈):屏幕点由 SVG 的 getScreenCTM 正算(课包坐标 + 导出时的平移)
  await evaluate(`${D}.querySelector('.lc-play').click()`);
  await sleep(300);
  const tools = await evaluate(`[...${D}.querySelectorAll('.lc-tool')].map((b) => b.textContent.trim() + (b.disabled ? '(灰)' : '')).join(' ') + ' | ' + ${D}.querySelector('.lc-play').textContent.trim()`);
  ok('暂停:「圈一圈」「擦掉」出来(这一刻没圈过,擦掉是灰的),播放钮写「接着看」', tools === '圈一圈 擦掉(灰) | 接着看', tools);
  const circle = async (cx, cy, rx, ry) => {
    const pts = await evaluate(`(() => {
    const d = ${D}, svg = d.querySelector('.lc-svg');
    const g = [...svg.children].find((e) => e.tagName === 'g'); const m0 = /translate\\(([-\\d.]+) ([-\\d.]+)/.exec(g.getAttribute('transform'));
    const dx = Number(m0[1]) - 450, dy = Number(m0[2]) - 22; // 第一个元素 q 在课包坐标 (450, 22)
    const ctm = svg.getScreenCTM();
    const at = (k) => { const a = k / 24 * Math.PI * 2; return new DOMPoint(${cx} + dx + ${rx} * Math.cos(a), ${cy} + dy + ${ry} * Math.sin(a)).matrixTransform(ctm); };
    return Array.from({ length: 25 }, (_, k) => { const p = at(k); return { x: p.x, y: p.y }; });
  })()`);
    await drag(pts);
    await sleep(300);
    return evaluate(`(() => { const d = ${D}; return { marks: d.querySelectorAll('.lc-mark').length, line: d.querySelector('.lc-line').textContent, count: d.querySelector('.lc-time small')?.textContent ?? '', ink: d.querySelectorAll('.lc-ink path').length }; })()`);
  };
  const c1 = await circle(334, 120, 45, 50);
  ok('圈了一处:进度条上一个蓝记号、字幕行「圈好了,记在 0:2x」、「圈了 1 处」、画面上留着那一圈', c1.marks === 1 && /^圈好了,记在 0:2\d。/.test(c1.line) && c1.count === '圈了 1 处' && c1.ink === 1, JSON.stringify(c1));
  await shot('lecture-circle.png');
  await evaluate(`[...${D}.querySelectorAll('.lc-tool')][1].click()`);
  await sleep(200);
  const erased = await evaluate(`({ marks: ${D}.querySelectorAll('.lc-mark').length, ink: ${D}.querySelectorAll('.lc-ink path').length })`);
  const c2 = await circle(334, 120, 45, 50);
  ok('擦掉:记号与画面上的圈都没了;再圈一处又有了', erased.marks === 0 && erased.ink === 0 && c2.marks === 1, JSON.stringify({ erased, c2 }));
  await evaluate(`${D}.querySelector('.lc-play').click()`);
  await sleep(500);
  const resumed = await evaluate(`({ ink: ${D}.querySelectorAll('.lc-ink path').length, tools: [...${D}.querySelectorAll('.lc-tool')].map((b) => b.textContent.trim() + (b.disabled ? '(灰)' : '') + (b.classList.contains('on') ? '(蓝)' : '')).join(' '), pen: Boolean(${D}.querySelector('.lc-canvas.lc-pen')), line: ${D}.querySelector('.lc-line').textContent })`);
  ok('接着看:圈从画面上收起、字幕回到讲稿;竖栏里工具还在(圈一圈能点、擦掉灰);记号还在进度条上', resumed.ink === 0 && resumed.tools === '圈一圈 擦掉(灰)' && !resumed.pen && !resumed.line.startsWith('圈好了') && await evaluate(`${D}.querySelectorAll('.lc-mark').length === 1`), JSON.stringify(resumed));
  // 放着点「圈一圈」= 停下并拿起笔(拍板 38)
  const t0 = await evaluate(`${D}.querySelector('.lc-time span').textContent`);
  await evaluate(`${D}.querySelector('.lc-tool').click()`);
  await sleep(1200);
  const grab = await evaluate(`({ play: ${D}.querySelector('.lc-play').textContent.trim(), on: ${D}.querySelector('.lc-tool').classList.contains('on'), pen: Boolean(${D}.querySelector('.lc-canvas.lc-pen')), t0: ${JSON.stringify(t0)}, t1: ${D}.querySelector('.lc-time span').textContent })`);
  ok('放着点「圈一圈」:停下(播放钮写「接着看」、时间不走)、圈一圈变蓝、画面能圈', grab.play === '接着看' && grab.on && grab.pen && grab.t1 === (await evaluate(`${D}.querySelector('.lc-time span').textContent`)), JSON.stringify(grab));
  await shot('lecture-grab-pen.png');
  await evaluate(`${D}.querySelector('.lc-play').click()`);
  await sleep(300);

  await tapSeg(5);
  // 放完停在最后一帧(拍板 37):页面不收;按钮先藏着,约 1 秒后淡入
  const atEnd = await until(`/^0:4\\d \\/ 0:4\\d$/.test(${D}.querySelector('.lc-time span').textContent) && ${D}.querySelector('.lc-play').getAttribute('aria-label') === '播放'`, 60);
  const hold = await evaluate(`({ shown: !${F}.hidden, ask: Boolean(${D}.querySelector('.lc-askbtn')), hint: Boolean(${D}.querySelector('.lc-hint')), play: ${D}.querySelector('.lc-play').textContent.trim(), time: ${D}.querySelector('.lc-time span').textContent })`);
  const faded = await until(`Boolean(${D}.querySelector('.lc-askbtn'))`, 12);
  const endUi = await evaluate(`({ shown: !${F}.hidden, play: ${D}.querySelector('.lc-play').textContent.trim(), ask: ${D}.querySelector('.lc-askbtn').textContent.trim(), tools: [...${D}.querySelectorAll('.lc-tools .lc-tool')].map((b) => b.textContent.trim() + (b.disabled ? '(灰)' : '')).join(' '), line: ${D}.querySelector('.lc-line').textContent })`);
  ok('放到结尾:停在最后一帧不收;右头一格先空着;约 1 秒后播放钮换成「再看一遍」、右头淡入「去问老师」,竖栏里圈一圈能点,字幕留着最后一句', atEnd && hold.shown && !hold.ask && !hold.hint && hold.play === '' && /^0:4\d \/ 0:4\d$/.test(hold.time) && faded && endUi.shown && endUi.play === '再看一遍' && endUi.ask === '去问老师' && endUi.tools === '圈一圈 擦掉(灰)' && endUi.line.startsWith('所以,13 减 8 等于 5'), JSON.stringify({ hold, endUi }));
  await shot('lecture-end.png');
  await evaluate(`${D}.querySelector('.lc-askbtn').click()`);
  const finished = await until(`${F}.hidden && Boolean(document.querySelector('.lc-pending'))`, 60);
  const after = await evaluate(`({ ask: document.querySelector('.lc-ask b')?.textContent, card: document.querySelector('.lc-pending .c-lc b')?.textContent, pill: document.querySelector('#pill').hidden, mo: document.querySelector('#c-mo').textContent, blank: Boolean(document.querySelector('#board .blank')), th: Boolean(document.querySelector('.lc-pending .c-lc .lc-th')) })`);
  ok('点「去问老师」:铺满的收起;小课堂卡(带最后一帧的缩略图)+ 「看完了!有什么想问老师的?」;输入条亮;头上「小课堂」;没有空板', finished && after.ask === '看完了!有什么想问老师的?' && after.card === '13 − 8 破十法' && after.th && !after.pill && after.mo === '小课堂' && !after.blank, JSON.stringify(after));
  const th = await until(`(document.querySelector('.lc-pending .c-lc .lc-th img')?.naturalWidth ?? 0) > 0`, 60);
  const thSvg = await evaluate(`(async () => { const img = document.querySelector('.lc-pending .c-lc .lc-th img'); const t = await (await fetch(img.src)).text(); return { end: img.src.includes('svg=end'), len: t.length }; })()`);
  ok('小课堂卡的缩略图是最后一帧(frame.svg?svg=end)', th && thSvg.end && thSvg.len > 1000, JSON.stringify(thSvg));
  await until(`(document.querySelector('.lc-pending .c-mark img.mk-svg')?.naturalWidth ?? 0) > 0`, 60);
  // 缩略图是服务端用烤好的画面现画的(frame.svg):停在圈的那一刻(第 3 步画到一半,不是全画完)、叠着蓝圈
  const mk = await evaluate(`(async () => { const c = document.querySelector('.lc-pending .c-mark'); const img = c?.querySelector('img.mk-svg'); const svg = img ? await (await fetch(img.src)).text() : ''; return { n: document.querySelectorAll('.lc-pending .c-mark').length, label: c?.querySelector('.mk-t')?.textContent, x: Boolean(c?.querySelector('.x')), sub: document.querySelector('.lc-pending .c-lc .lt span')?.textContent, hint: document.querySelector('.lc-ask span')?.textContent, frame: Boolean(img?.src.includes('/frame.svg?svg=')), ring: svg.includes('stroke="#2f6fd6"'), crossed: (svg.match(/#e8590c/g) || []).length, red: (svg.match(/#e03131/g) || []).length, w: img ? Math.round(img.getBoundingClientRect().width) : 0 }; })()`);
  ok('看完那排:一张圈的卡(「你圈的 0:2x」、能删),缩略图是服务端现画的那一刻(第 3 步的橙色斜线画上了、第 4 步的红圈还没有)、带蓝圈;小课堂卡写「圈了 1 处」;提示说会一起带给老师', mk.n === 1 && /^你圈的0:2\d$/.test(mk.label) && mk.x && mk.sub === '看完了 · 圈了 1 处' && mk.hint.startsWith('圈的 1 处,问的时候会一起带给老师') && mk.frame && mk.ring && mk.crossed >= 1 && mk.red === 0 && mk.w > 100, JSON.stringify(mk));
  await shot('lecture-done.png');

  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '为什么要拆开那一捆'; document.querySelector('#go').click(); return true; })()`);
  const answered = await until(`document.querySelectorAll('#board .sec .c-lc').length === 1 && !document.querySelector('.lc-pending')`, 80);
  const secMk = await evaluate(`({ n: document.querySelectorAll('#board .sec .c-mark').length, x: document.querySelectorAll('#board .sec .c-mark .x').length, sub: document.querySelector('#board .sec .c-lc .lt span')?.textContent })`);
  ok('问了一句:老师那一节的节前画着小课堂卡(圈了 1 处)与圈的卡(不能删了),提示撤掉', answered && secMk.n === 1 && secMk.x === 0 && secMk.sub === '看完了 · 圈了 1 处', JSON.stringify(secMk));
  await shot('lecture-answered.png');

  // 老师放课里的一段(§六):节里一张小课堂卡,讲稿 [[play]] 交给它
  const SF = `document.querySelector('#st-frame')`;
  const seg = await evaluate(`(() => { const c = document.querySelector('#board .sec .c-lecture'); return c ? { pl: c.querySelector('.pl')?.textContent, title: c.querySelector('.sp')?.textContent, svg: (c.querySelector('.th img')?.naturalWidth ?? 0) > 0 && c.querySelector('.th img').src.includes('/frame.svg?svg=') } : null; })()`);
  ok('老师那一节有一张小课堂卡:课名、「0:19–0:30 ▷」、缩略图是那一段的末帧', seg?.pl === '0:19–0:30 ▷' && seg.title === '13 − 8 破十法' && seg.svg, JSON.stringify(seg));
  const opened2 = await until(`document.querySelector('#stage').classList.contains('on') && Boolean(${SF}.contentDocument?.querySelector('.lc.lc-card .lc-svg'))`, 120);
  const st0 = opened2 ? await evaluate(`({ time: ${SF}.contentDocument.querySelector('.lc-time span').textContent, top: Boolean(${SF}.contentDocument.querySelector('.lc-top')), kd: document.querySelector('#st-kd').textContent, sub: document.querySelector('#sub-text').textContent })`) : null;
  ok('讲稿念到 [[play]]:自己铺满放,从 0:19 起;舞台顶栏写「小课堂」,播放器没有自己的顶栏;字幕行是课里那句', opened2 && /^0:(19|2\d) \/ 0:46$/.test(st0.time) && !st0.top && st0.kd === '小课堂' && st0.sub.startsWith('那就拆开这一捆'), JSON.stringify(st0));
  await shot('lecture-seg-playing.png');
  const segDone = await until(`${SF}.contentDocument?.querySelector('.lc-time span')?.textContent === '0:30 / 0:46' && document.querySelector('#sub-text').textContent.startsWith('拿走 8 根')`, 120);
  const st1 = await evaluate(`({ time: ${SF}.contentDocument?.querySelector('.lc-time span')?.textContent, on: document.querySelector('#stage').classList.contains('on'), sub: document.querySelector('#sub-text').textContent, playing: ${SF}.contentDocument?.querySelector('.lc-play')?.getAttribute('aria-label') })`);
  ok('放到 0:30 停在末帧,舞台不关,字幕行接着念下一句', segDone && st1.on && st1.playing === '播放', JSON.stringify(st1));
  await shot('lecture-seg-done.png');
  await evaluate(`document.querySelector('#st-x').click()`);
  await sleep(300);
  // 问过以后「再看一遍」:停在某处又圈了一处 → 回板书,末尾一排(能删)+「又圈了 1 处」→ 再问一句,那一节节前只有圈的卡
  await until(`!document.body.classList.contains('pending')`, 60);
  await evaluate(`document.querySelector('#board .sec .c-lc .re').click()`);
  await until(`!${F}.hidden && Boolean(${D}?.querySelector('.lc-start'))`);
  await evaluate(`${D}.querySelector('.lc-start').click()`);
  await sleep(300);
  await tapSeg(4);
  await sleep(1500);
  await evaluate(`${D}.querySelector('.lc-play').click()`);
  await sleep(300);
  const c3 = await circle(600, 214, 40, 22);
  await evaluate(`${D}.querySelector('.lc-back').click()`);
  const back = await until(`${F}.hidden && Boolean(document.querySelector('.lc-pending .c-mark'))`, 40);
  const tail = await evaluate(`({ last: document.querySelector('#board').lastElementChild?.className, x: document.querySelectorAll('.lc-pending .c-mark .x').length, card: document.querySelectorAll('.lc-pending .c-lc').length, hint: document.querySelector('.lc-pending .lc-ask span')?.textContent })`);
  ok('再看一遍又圈了一处:回板书,末尾一排圈的卡(能删,没有小课堂卡)+「又圈了 1 处,下次说话会一起带给老师」', c3.marks === 1 && back && tail.last === 'lc-pending' && tail.x === 1 && tail.card === 0 && tail.hint?.startsWith('又圈了 1 处,下次说话会一起带给老师'), JSON.stringify({ c3, tail }));
  await shot('lecture-again.png');
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '这里为什么是 5'; document.querySelector('#go').click(); return true; })()`);
  const again = await until(`document.querySelectorAll('#board .sec').length === 2 && !document.querySelector('.lc-pending')`, 80);
  const sec2 = await evaluate(`(() => { const s = document.querySelectorAll('#board .sec')[1]; return { lecture: s.querySelectorAll('.c-lc').length, marks: s.querySelectorAll('.c-mark').length }; })()`);
  ok('再问一句:带上了新圈的,那一节节前只有圈的卡', again && sec2.lecture === 0 && sec2.marks === 1, JSON.stringify(sec2));

  const pb = await (await fetch(`${base}/api/conversations/math-tutor/today/board`)).json();
  const pm = pb.messages.find((m) => m.lecture)?.lecture?.marks?.[0];
  ok('家长端:那条的圈带着算出来的那段话(圈住了散的 3 根)', Boolean(pm?.text?.includes('第 1 步画的 3 条线')), pm?.text ?? JSON.stringify(pb.messages.map((m) => m.lecture)));

  // 家长看录像(第 5 步):看小课堂那一段也在
  await send('Page.navigate', { url: `${base}/parent?tutor=math-tutor` });
  await until(`document.querySelector('#tutor').classList.contains('on') && document.querySelectorAll('#board .sec').length > 0`);
  await evaluate(`document.querySelector('#reel-btn').click()`);
  // 录像里孩子的屏幕在 iframe(#rl-frame)里,小课堂的播放器在它里面的 #lc-frame(拍板 6)
  const KF = `document.querySelector('#rl-frame').contentDocument.querySelector('#lc-frame')`;
  const KD = `${KF}?.contentDocument`;
  const reelOn = await until(`document.body.classList.contains('reel') && Boolean(document.querySelector('#rl-frame').contentDocument) && !${KF}?.hidden && Boolean(${KD}?.querySelector('.lc .lc-svg'))`, 80);
  const r0 = await evaluate(`({ kinds: [...document.querySelectorAll('#rl-marks i')].map((i) => i.className).join(' '), sub: document.querySelector('#rl-cap').textContent, back: Boolean(${KD}.querySelector('.lc-back')), start: Boolean(${KD}.querySelector('.lc-start')), h: Math.round(${KF}.getBoundingClientRect().height) })`);
  ok('录像从看小课堂开始:进度条上「看小课堂」「圈了一处」的点;孩子的屏幕上铺着播放器、只看(没有回去、没有开始看);录像栏写在看小课堂', reelOn && r0.kinds.startsWith('lecture') && r0.kinds.includes('circle') && !r0.back && !r0.start && r0.h > 500 && /^[▷⏸] /.test(r0.sub), JSON.stringify(r0));
  await shot('reel-lecture.png');
  await evaluate(`document.querySelector('#rl-play').click()`);
  await evaluate(`document.querySelector('#rl-marks i.circle').click()`);
  await sleep(800);
  const r1 = await evaluate(`({ time: ${KD}.querySelector('.lc-time span').textContent, ink: ${KD}.querySelectorAll('.lc-ink path').length, marks: ${KD}.querySelectorAll('.lc-mark').length, sub: document.querySelector('#rl-cap').textContent })`);
  ok('点「圈了一处」:录像停在圈下去那一刻,播放器停在课里圈的那一刻(0:23),画面上画着那一圈', /^0:2[2-4] \/ 0:46$/.test(r1.time) && r1.ink === 1 && r1.marks >= 1 && r1.sub.startsWith('⏸ 小课堂停在 0:2'), JSON.stringify(r1));
  await shot('reel-circle.png');
} finally {
  browser?.kill();
  await sleep(600);
  if (!keep) { mock.kill(); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  else console.log(`留下了:mock 在 ${base}(pid ${mock.pid}),截图在 ${shots}`);
}

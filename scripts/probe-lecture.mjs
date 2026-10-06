#!/usr/bin/env node
/**
 * 小课堂(《小课堂设计.md》)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱;样本课包 tests/fixtures/bundles/2026-09-18-po13-jian-8 没有配音,按配音时长走):
 * 首页数学老师卡上的小课堂按钮(课长、「看完再问老师」)→ 点了铺满:「开始看」→ 放着:字幕、步骤点、时间走 → 拖到中间:画面跟着、不出声 →
 * 暂停 → 「圈一圈」「擦掉」出来 → 在画面上圈散的 3 根小棒:进度条上一个蓝记号、字幕行「圈好了,记在 0:2x」→ 擦掉再圈 →
 * 点第 6 个步骤点放到结尾 → 看完:铺满的收起,板书顶上小课堂卡(圈了 1 处)+ 一张圈的卡(缩略图是那一刻的画面 + 蓝圈,能删)+「看完了!有什么想问老师的?」,输入条亮、头上「小课堂」→
 * 从输入条问一句 → 老师那一节的节前画着小课堂卡与圈的卡(不能删了),提示撤掉;家长端那条的圈带着算出来的那段话。iPad 横屏,每步截图。
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
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--ignore-certificate-errors', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
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
  const pre = await evaluate(`({ dots: ${D}.querySelectorAll('.lc-dot').length, time: ${D}.querySelector('.lc-time').textContent, pill: document.querySelector('#pill').hidden })`);
  ok('点了:铺满,「开始看」,六个步骤点、课长;下面的输入条藏着', opened && pre.dots === 6 && /^0:00 \/ 0:4\d$/.test(pre.time) && pre.pill, JSON.stringify(pre));
  await shot('lecture-start.png');

  await evaluate(`${D}.querySelector('.lc-start').click()`);
  await sleep(6000);
  const run = await evaluate(`({ time: ${D}.querySelector('.lc-time').textContent, line: ${D}.querySelector('.lc-line').textContent, on: ${D}.querySelectorAll('.lc-dot.on').length, drawn: ${D}.querySelector('.lc-svg') !== null })`);
  ok('放着:时间走、字幕是第一句、画面在画', /^0:0[5-7] /.test(run.time) && run.line.startsWith('先看 13 减 8') && run.on === 1 && run.drawn, JSON.stringify(run));
  await shot('lecture-playing.png');

  // 拖到中间:按下、移、松手(拖着不出声由播放器保证,这里看画面与时间跟着)
  const mid = await evaluate(`(() => { const t = ${D}.querySelector('.lc-track'); const r = t.getBoundingClientRect(); const x = r.left + r.width * 0.5, y = r.top + r.height / 2; const ev = (type) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 })); ev('pointerdown'); ev('pointermove'); ev('pointerup'); return new Promise((r) => setTimeout(() => r(${D}.querySelector('.lc-time').textContent), 300)); })()`);
  ok('拖到中间:时间跳过去', /^0:2[2-4] /.test(mid), mid);
  await shot('lecture-seek.png');

  // 暂停,在画面上圈散的 3 根小棒(课包坐标 334,120 一圈):屏幕点由 SVG 的 getScreenCTM 正算(课包坐标 + 导出时的平移)
  await evaluate(`${D}.querySelector('.lc-play').click()`);
  await sleep(300);
  const tools = await evaluate(`[...${D}.querySelectorAll('.lc-tool')].map((b) => b.textContent.trim() + (b.disabled ? '(灰)' : '')).join(' ') + ' | ' + ${D}.querySelector('.lc-play').textContent.trim()`);
  ok('暂停:「圈一圈」「擦掉」出来(这一刻没圈过,擦掉是灰的),播放钮写「接着看」', tools === '圈一圈 擦掉(灰) | 接着看', tools);
  const circle = (cx, cy, rx, ry) => evaluate(`(() => {
    const d = ${D}, svg = d.querySelector('.lc-svg'), canvas = d.querySelector('.lc-canvas');
    const g = [...svg.children].find((e) => e.tagName === 'g'); const m0 = /translate\\(([-\\d.]+) ([-\\d.]+)/.exec(g.getAttribute('transform'));
    const dx = Number(m0[1]) - 450, dy = Number(m0[2]) - 22; // 第一个元素 q 在课包坐标 (450, 22)
    const ctm = svg.getScreenCTM();
    const at = (k) => { const a = k / 24 * Math.PI * 2; return new DOMPoint(${cx} + dx + ${rx} * Math.cos(a), ${cy} + dy + ${ry} * Math.sin(a)).matrixTransform(ctm); };
    const ev = (type, p) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 7, isPrimary: true }));
    ev('pointerdown', at(0)); for (let k = 1; k <= 24; k++) ev('pointermove', at(k)); ev('pointerup', at(24));
    return new Promise((r) => setTimeout(() => r({ marks: d.querySelectorAll('.lc-mark').length, line: d.querySelector('.lc-line').textContent, count: d.querySelector('.lc-time small')?.textContent ?? '', ink: d.querySelectorAll('.lc-ink path').length }), 300));
  })()`);
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
  const resumed = await evaluate(`({ ink: ${D}.querySelectorAll('.lc-ink path').length, tools: ${D}.querySelectorAll('.lc-tool').length, line: ${D}.querySelector('.lc-line').textContent })`);
  ok('接着看:圈从画面上收起、工具收起、字幕回到讲稿;记号还在进度条上', resumed.ink === 0 && resumed.tools === 0 && !resumed.line.startsWith('圈好了') && await evaluate(`${D}.querySelectorAll('.lc-mark').length === 1`), JSON.stringify(resumed));

  await evaluate(`[...${D}.querySelectorAll('.lc-dot')][5].click()`);
  const finished = await until(`${F}.hidden && Boolean(document.querySelector('.lc-pending'))`, 60);
  const after = await evaluate(`({ ask: document.querySelector('.lc-ask b')?.textContent, card: document.querySelector('.lc-pending .c-lecture b')?.textContent, pill: document.querySelector('#pill').hidden, mo: document.querySelector('#c-mo').textContent, blank: Boolean(document.querySelector('#board .blank')) })`);
  ok('放到结尾:铺满的收起;小课堂卡 + 「看完了!有什么想问老师的?」;输入条亮;头上「小课堂」;没有空板', finished && after.ask === '看完了!有什么想问老师的?' && after.card === '13 − 8 破十法' && !after.pill && after.mo === '小课堂' && !after.blank, JSON.stringify(after));
  await until(`Boolean(document.querySelector('.lc-pending .c-mark .mk-svg path[stroke="#2f6fd6"]'))`, 60);
  const mk = await evaluate(`(() => { const c = document.querySelector('.lc-pending .c-mark'); const svg = c?.querySelector('.mk-svg'); return { n: document.querySelectorAll('.lc-pending .c-mark').length, label: c?.querySelector('.mk-t')?.textContent, x: Boolean(c?.querySelector('.x')), sub: document.querySelector('.lc-pending .c-lecture .lt span')?.textContent, hint: document.querySelector('.lc-ask span')?.textContent, svg: Boolean(svg), t: svg ? svg.getCurrentTime() : -1, paused: svg ? svg.animationsPaused() : null, w: svg ? Math.round(svg.getBoundingClientRect().width) : 0 }; })()`);
  ok('看完那排:一张圈的卡(「你圈的 0:2x」、能删),缩略图停在那一刻(SVG 停着、时刻 > 第 3 步起点)、带蓝圈;小课堂卡写「圈了 1 处」;提示说会一起带给老师', mk.n === 1 && /^你圈的0:2\d$/.test(mk.label) && mk.x && mk.sub === '看完了 · 圈了 1 处' && mk.hint.startsWith('圈的 1 处,问的时候会一起带给老师') && mk.svg && mk.paused && mk.t > 15 && mk.w > 100, JSON.stringify(mk));
  await shot('lecture-done.png');

  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '为什么要拆开那一捆'; document.querySelector('#go').click(); return true; })()`);
  const answered = await until(`document.querySelectorAll('#board .sec .c-lecture').length === 1 && !document.querySelector('.lc-pending')`, 80);
  const secMk = await evaluate(`({ n: document.querySelectorAll('#board .sec .c-mark').length, x: document.querySelectorAll('#board .sec .c-mark .x').length, sub: document.querySelector('#board .sec .c-lecture .lt span')?.textContent })`);
  ok('问了一句:老师那一节的节前画着小课堂卡(圈了 1 处)与圈的卡(不能删了),提示撤掉', answered && secMk.n === 1 && secMk.x === 0 && secMk.sub === '看完了 · 圈了 1 处', JSON.stringify(secMk));
  await shot('lecture-answered.png');
  // 问过以后「再看一遍」:停在某处又圈了一处 → 回板书,末尾一排(能删)+「又圈了 1 处」→ 再问一句,那一节节前只有圈的卡
  await until(`!document.body.classList.contains('pending')`, 60);
  await evaluate(`document.querySelector('#board .sec .c-lecture .re').click()`);
  await until(`!${F}.hidden && Boolean(${D}?.querySelector('.lc-start'))`);
  await evaluate(`${D}.querySelector('.lc-start').click()`);
  await sleep(300);
  await evaluate(`[...${D}.querySelectorAll('.lc-dot')][4].click()`);
  await sleep(1500);
  await evaluate(`${D}.querySelector('.lc-play').click()`);
  await sleep(300);
  const c3 = await circle(600, 214, 40, 22);
  await evaluate(`${D}.querySelector('.lc-round').click()`);
  const back = await until(`${F}.hidden && Boolean(document.querySelector('.lc-pending .c-mark'))`, 40);
  const tail = await evaluate(`({ last: document.querySelector('#board').lastElementChild?.className, x: document.querySelectorAll('.lc-pending .c-mark .x').length, card: document.querySelectorAll('.lc-pending .c-lecture').length, hint: document.querySelector('.lc-pending .lc-ask span')?.textContent })`);
  ok('再看一遍又圈了一处:回板书,末尾一排圈的卡(能删,没有小课堂卡)+「又圈了 1 处,下次说话会一起带给老师」', c3.marks === 1 && back && tail.last === 'lc-pending' && tail.x === 1 && tail.card === 0 && tail.hint?.startsWith('又圈了 1 处,下次说话会一起带给老师'), JSON.stringify({ c3, tail }));
  await shot('lecture-again.png');
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '这里为什么是 5'; document.querySelector('#go').click(); return true; })()`);
  const again = await until(`document.querySelectorAll('#board .sec').length === 2 && !document.querySelector('.lc-pending')`, 80);
  const sec2 = await evaluate(`(() => { const s = document.querySelectorAll('#board .sec')[1]; return { lecture: s.querySelectorAll('.c-lecture').length, marks: s.querySelectorAll('.c-mark').length }; })()`);
  ok('再问一句:带上了新圈的,那一节节前只有圈的卡', again && sec2.lecture === 0 && sec2.marks === 1, JSON.stringify(sec2));

  const pb = await (await fetch(`${base}/api/conversations/math-tutor/today/board`)).json();
  const pm = pb.messages.find((m) => m.lecture)?.lecture?.marks?.[0];
  ok('家长端:那条的圈带着算出来的那段话(圈住了散的 3 根)', Boolean(pm?.text?.includes('第 1 步画的 3 条线')), pm?.text ?? JSON.stringify(pb.messages.map((m) => m.lecture)));
} finally {
  browser?.kill();
  await sleep(600);
  if (!keep) { mock.kill(); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  else console.log(`留下了:mock 在 ${base}(pid ${mock.pid}),截图在 ${shots}`);
}

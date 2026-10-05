#!/usr/bin/env node
/**
 * 小课堂(《小课堂设计.md》)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱;样本课包 tests/fixtures/bundles/2026-09-18-po13-jian-8 没有配音,按配音时长走):
 * 首页数学老师卡上的小课堂按钮(课长、「看完再问老师」)→ 点了铺满:「开始看」→ 放着:字幕、步骤点、时间走 → 拖到中间:画面跟着、不出声 →
 * 点第 6 个步骤点放到结尾 → 看完:铺满的收起,板书顶上小课堂卡 +「看完了!有什么想问老师的?」,输入条亮、头上「小课堂」→
 * 从输入条问一句 → 老师那一节的节前画着小课堂卡,提示撤掉。iPad 横屏,每步截图。
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

  await evaluate(`[...${D}.querySelectorAll('.lc-dot')][5].click()`);
  const finished = await until(`${F}.hidden && Boolean(document.querySelector('.lc-pending'))`, 60);
  const after = await evaluate(`({ ask: document.querySelector('.lc-ask b')?.textContent, card: document.querySelector('.lc-pending .c-lecture b')?.textContent, pill: document.querySelector('#pill').hidden, mo: document.querySelector('#c-mo').textContent, blank: Boolean(document.querySelector('#board .blank')) })`);
  ok('放到结尾:铺满的收起;小课堂卡 + 「看完了!有什么想问老师的?」;输入条亮;头上「小课堂」;没有空板', finished && after.ask === '看完了!有什么想问老师的?' && after.card === '13 − 8 破十法' && !after.pill && after.mo === '小课堂' && !after.blank, JSON.stringify(after));
  await shot('lecture-done.png');

  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '为什么要拆开那一捆'; document.querySelector('#go').click(); return true; })()`);
  const answered = await until(`document.querySelectorAll('#board .sec .c-lecture').length === 1 && !document.querySelector('.lc-pending')`, 80);
  ok('问了一句:老师那一节的节前画着小课堂卡,提示撤掉', answered);
  await shot('lecture-answered.png');
} finally {
  browser?.kill();
  await sleep(600);
  if (!keep) { mock.kill(); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  else console.log(`留下了:mock 在 ${base}(pid ${mock.pid}),截图在 ${shots}`);
}

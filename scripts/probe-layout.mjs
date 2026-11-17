#!/usr/bin/env node
/**
 * 孩子端排版与流式的验收(在 pnpm test 里:tests/probe.test.ts 起它,要本机 Chrome,没有就跳过;走 mock,不花钱):
 * 起 cotutor mock(老师都走实时),iPad 横屏、竖屏、手机各看一遍首页与数学老师页:页面不横滚;
 * 再从输入条发一句,老师的讲稿一句句出来:板上多一节、字幕跟着走、节只出一次。页面不许抛异常。每种尺寸截一张。
 * 课里的卡 2026-11-17 删了,以前这里看卡的半宽、并排、流式不挪,一起删了;一节课的页在 scripts/probe-book-page.mjs、probe-photo-page.mjs。
 *
 * 用法:node scripts/probe-layout.mjs [--out <截图目录>] [--keep](留下 mock)
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8797;
const cdp = 9339;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const tmp = probeDir('cotutor-probe-layout-');
const shots = outAt > 0 ? process.argv[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

// 讲稿出慢一点(整节 3 秒),好看清一句句来
const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '3000'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

const OVER = `(() => ({ pageOver: document.scrollingElement.scrollWidth > innerWidth, boardOver: (() => { const b = document.querySelector('#board'); return Boolean(b && b.scrollWidth > b.clientWidth); })() }))()`;

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const device = async (w, h, dsf, mobile) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile }); await sleep(400); };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  await send('Runtime.enable');
  await send('Page.enable');
  /** 一种尺寸看首页与数学老师页 */
  const look = async (label, w, h, dsf, mobile, file) => {
    await device(w, h, dsf, mobile);
    await send('Page.navigate', { url: `${base}/` });
    await until(`document.querySelectorAll('#deck .c-tutor').length > 0`, 60);
    await sleep(600);
    const home = await evaluate(OVER);
    ok(`${label}:首页不横滚`, !home.pageOver, JSON.stringify(home));
    await send('Page.navigate', { url: `${base}/?tutor=math-tutor` });
    await until(`document.querySelector('#tutor')?.classList.contains('on') && document.querySelectorAll('#board > .sec').length > 0`, 60);
    await sleep(600);
    const page = await evaluate(OVER);
    ok(`${label}:老师页不横滚`, !page.pageOver && !page.boardOver, JSON.stringify(page));
    console.log('  ', await shot(file));
  };
  await look('iPad 横屏', 1180, 820, 1, false, 'layout-ipad.png');
  await look('iPad 竖屏', 820, 1180, 1, false, 'layout-portrait.png');
  await look('手机', 390, 844, 2, true, 'layout-phone.png');

  // 流式:发一句,讲稿一句句出来,板上多一节、只多一节
  await device(1180, 820, 1, false);
  await send('Page.navigate', { url: `${base}/?tutor=math-tutor` });
  await until(`document.querySelector('#tutor')?.classList.contains('on') && document.querySelectorAll('#board > .sec').length > 0`, 60);
  await sleep(600);
  const n0 = await evaluate(`document.querySelectorAll('#board > .sec').length`);
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '反过来呢?'; document.querySelector('#go').click(); return true; })()`);
  const grew = await until(`document.querySelectorAll('#board > .sec').length === ${n0 + 1}`, 80);
  ok('流式:板上多了一节', grew, String(await evaluate(`document.querySelectorAll('#board > .sec').length`)));
  const done = await until(`!document.body.classList.contains('pending') && document.querySelectorAll('#board > .sec').length === ${n0 + 1}`, 80);
  await sleep(800);
  ok('流式:写完了还是只多一节(不重铺)', done && (await evaluate(`document.querySelectorAll('#board > .sec').length`)) === n0 + 1);
  console.log('  ', await shot('layout-live.png'));

  ok('页面没抛异常', errors.length === 0, errors.join(' | '));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(join(tmp, 'chrome'), { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/?tutor=math-tutor`); }
  console.log(`截图在 ${shots}`);
}
process.exit(bad ? 1 : 0);

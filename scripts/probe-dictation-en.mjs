#!/usr/bin/env node
/**
 * 英文单词听写(《wip/听写设想.md》拍板 15)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock,Chrome 开孩子端首页(iPad 横屏 1180×820)→ 把英语老师换到最前 → 点「单词听写」进 /dictation?lang=en → 开始 →
 * 在四线三格里用鼠标写(一个单词一格)→ 第二个点「给答案」:灰单词打底、没写不让过,照着写 → 交上去 → 对一对:三行、蓝字叠着、
 * 没有「再写一遍?」、拿开 / 放回蓝字 → 自己点「再写一遍」→ 对好了回首页 → 家长页四线三格、录像页一个单词一格。
 * 手指走 CDP 的 Input.dispatchMouseEvent(经命中判定),不用 dispatchEvent。
 *
 * 用法:node scripts/probe-dictation-en.mjs [--out <截图目录>] [--keep](留下 mock)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const out = outAt > 0 ? process.argv[outAt + 1] : null;
if (out) mkdirSync(out, { recursive: true });
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8797;
const cdp = 9339;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, detail = '') => { if (!cond) fails++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

const home = mkdtempSync(join(tmpdir(), 'cotutor-probe-dictation-en-'));
const browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(home, 'chrome')}`, `${base}/`], { stdio: 'ignore' });
try {
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page' && t.url.startsWith('http'))?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);
  const shot = async (name) => { if (!out) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
  const waitFor = async (expr, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { if (await evaluate(expr)) return true; await sleep(100); } return false; };
  const rect = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const tap = async (sel) => { const r = await rect(sel); if (!r) throw new Error(`点不到 ${sel}`); const x = r.x + r.w / 2, y = r.y + r.h / 2; await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await sleep(150); };
  const tapText = async (text) => { const sel = await evaluate(`(() => { document.querySelectorAll('[data-probe]').forEach((x) => x.removeAttribute('data-probe')); const b = [...document.querySelectorAll('.view.on button, .view.on a')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return null; b.setAttribute('data-probe', ${JSON.stringify(text)}); return '[data-probe=' + JSON.stringify(${JSON.stringify(text)}) + ']'; })()`); if (!sel) throw new Error(`找不到按钮 ${text}`); await tap(sel); };
  /** 在四线三格里写一个单词:几笔折线,画在基线上下(格是 2048 × 512) */
  const writeWord = async (padSel, n = 3) => {
    const r = await rect(padSel);
    for (let k = 0; k < n; k++) {
      const x0 = 300 + k * 420;
      const pts = [];
      for (let q = 0; q <= 12; q++) pts.push([x0 + q * 25, 210 + Math.sin(q / 2) * 100]);
      const s = pts.map(([x, y]) => ({ x: r.x + (x / 2048) * r.w, y: r.y + (y / 512) * r.h }));
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s[0].x, y: s[0].y, button: 'left', buttons: 1, clickCount: 1 });
      for (const p of s.slice(1)) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s[s.length - 1].x, y: s[s.length - 1].y, button: 'left', buttons: 0, clickCount: 1 });
    }
  };
  const view = () => evaluate(`document.querySelector('.view.on')?.id ?? null`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/` });
  await waitFor(`!!document.querySelector('#kstack .sa[data-tutor="english-tutor"]')`);
  await tap('#kstack .sa[data-tutor="english-tutor"]');
  ok('首页:英语老师卡里有「单词听写 · 3 个单词」,看不到字', await waitFor(`!!document.querySelector('#kcard[data-tutor="english-tutor"] .bt-x-dictation') && document.querySelector('#kcard .bt-x-dictation').textContent.includes('单词听写') && document.querySelector('#kcard .bt-x-dictation').textContent.includes('3 个单词') && !document.querySelector('#kcard').textContent.includes('yellow') && document.querySelector('#kcard .bt-x-dictation').getAttribute('href').endsWith('&lang=en')`));
  await shot('en-01-home');
  await tap('#kcard .bt-x-dictation');
  ok('进英文那页:开始屏「单词听写 · 3 个单词」', await waitFor(`location.search.includes('lang=en') && document.querySelector('#v-start.on #s-title')?.textContent === '单词听写 · 3 个单词'`));
  await tap('#s-go');
  ok('写:第 1 个,四线三格(四条线、第三条基线),气泡里没有单词', await waitFor(`document.querySelector('.view.on')?.id === 'v-write' && document.querySelectorAll('#w-pad .enl line').length === 4 && document.querySelectorAll('#w-pad .enl line.base').length === 1 && !document.body.innerText.includes('red')`));
  await writeWord('#w-pad');
  ok('写了三笔', (await evaluate(`document.querySelectorAll('#w-pad .eni path').length`)) === 3);
  await tap('#w-undo');
  ok('撤销撤一笔', (await evaluate(`document.querySelectorAll('#w-pad .eni path').length`)) === 2);
  await shot('en-02-write');
  await tap('#w-done');
  ok('写好了:到第 2 个', await waitFor(`document.querySelector('#w-who').textContent.includes('第 2 个') && document.querySelectorAll('#w-pad .eni path').length === 0`));
  await tap('#w-reveal');
  ok('给答案:灰色的 yellow 打底', await waitFor(`document.querySelector('#w-pad .enw.trace')?.textContent === 'yellow'`));
  await tap('#w-done');
  ok('没照着写就点写好了:不让过', await waitFor(`document.querySelector('#w-who').textContent.includes('第 2 个') && document.querySelector('#w-status').textContent.includes('照着')`));
  await writeWord('#w-pad', 2);
  await shot('en-03-reveal');
  await tap('#w-done');
  await waitFor(`document.querySelector('#w-who').textContent.includes('第 3 个')`);
  await writeWord('#w-pad', 1);
  await tap('#w-done');
  ok('都写完了:交上去', await waitFor(`document.querySelector('.view.on')?.id === 'v-submit'`));
  await tap('#u-go');
  ok('对一对:三行,蓝字叠着(red / yellow / bus),没有「再写一遍?」的问', await waitFor(`document.querySelector('.view.on')?.id === 'v-check' && document.querySelectorAll('#c-rows .row').length === 3 && [...document.querySelectorAll('#c-rows .enw')].map((t) => t.textContent).join() === 'red,yellow,bus' && !document.body.innerText.includes('这个再写一遍')`));
  ok('看过答案的那个写着', await evaluate(`document.querySelectorAll('#c-rows .row')[1].innerText.includes('看了答案')`));
  ok('页面上没有叉、没有分数、没有对错的字', await evaluate(`!/[×✗✘]|分数|错|对了/.test(document.body.innerText.replace('对一对', '').replace('对好了', ''))`));
  await shot('en-04-check');
  await tap('#c-hide');
  ok('拿开蓝字', await waitFor(`document.querySelectorAll('#c-rows .enw').length === 0`));
  await tap('#c-hide');
  await tap('#c-rows .row:first-child .tool');
  ok('自己点再写一遍:上面是 red,下面空格', await waitFor(`document.querySelector('.view.on')?.id === 'v-write' && document.querySelector('#w-model').textContent === 'red' && !document.querySelector('#w-model').hidden`));
  await writeWord('#w-pad', 2);
  await tap('#w-done');
  ok('交了:回对一对,第一行写着又写了一遍', await waitFor(`document.querySelector('.view.on')?.id === 'v-check' && document.querySelectorAll('#c-rows .row')[0].innerText.includes('又写了一遍')`));
  await tap('#c-done');
  ok('对好了:回首页', await waitFor(`location.pathname === '/'`));
  const list = await (await fetch(`${base}/api/dictation`)).json();
  const s = list.sessions.find((x) => x.lang === 'en');
  ok('存下的:lang en、三个单词、看了答案 1 个、对好了', s && s.words.join() === 'red,yellow,bus' && s.revealed === 1 && s.done, JSON.stringify(s));
  await send('Page.navigate', { url: `${base}/dictation/parent` });
  await waitFor(`document.querySelectorAll('#dates button').length > 0`);
  await evaluate(`[...document.querySelectorAll('#dates button')].find((b) => b.dataset.id === ${JSON.stringify(s?.id)})?.click()`);
  ok('家长页:四线三格的格、蓝字叠着、看了答案:yellow、不说逐笔的话', await waitFor(`document.querySelectorAll('svg.tz.en').length >= 3 && document.body.innerText.includes('看了答案:yellow') && !document.body.innerText.includes('笔顺')`));
  await shot('en-05-parent');
  await send('Page.navigate', { url: `${base}/dictation/reel?id=${s?.id}` });
  ok('录像页:一章一个单词、一个四线三格', await waitFor(`document.querySelectorAll('#chs .ch').length === 3 && document.querySelectorAll('#cells svg.en').length === 1 && document.querySelectorAll('#cells .enl line').length === 4`));
  await evaluate(`document.querySelector('#chs .ch:nth-child(2)').click()`);
  ok('第 2 章:经过里有「给答案」', await waitFor(`document.querySelector('#log').innerText.includes('给答案')`));
  await shot('en-06-reel');
  // ---- 拍照开始(英语老师卡上的拍照听写):拍 → 一项一项认出单词 → 点选 → 开始 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/dictation?tutor=english-tutor&lang=en` });
  ok('拍照屏:拍照 / 从相册选', await waitFor(`document.querySelector('.view.on')?.id === 'v-snap' && !document.querySelector('#p-pick').hidden`));
  const icon = join(home, 'photo.png');
  writeFileSync(icon, Buffer.from((await (await fetch(`${base}/icon-512.png`)).arrayBuffer())));
  const doc = await send('DOM.getDocument', {});
  const input = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#p-lib' });
  await send('DOM.setFileInputFiles', { nodeId: input.result.nodeId, files: [icon] });
  ok('认出来:四个单词默认选上;照片上还有的单词能点着加', await waitFor(`document.querySelectorAll('#p-chips .chip.on').length === 4 && [...document.querySelectorAll('#p-more .chip')].some((b) => b.textContent === 'colour')`, 12000));
  await evaluate(`[...document.querySelectorAll('#p-more .chip')].find((b) => b.textContent === 'colour').click()`);
  await evaluate(`[...document.querySelectorAll('#p-chips .chip')].find((b) => b.textContent === 'bus').click()`);
  await evaluate(`(() => { const i = document.querySelector('#p-add'); i.value = 'blue 红色'; })()`);
  await tap('#p-add-go');
  ok('点选:加了 colour、去掉 bus、自己打的 blue 加进来,汉字的不收', await waitFor(`[...document.querySelectorAll('#p-chips .chip.on')].map((b) => b.textContent).join() === 'red,yellow,green,colour,blue'`), await evaluate(`[...document.querySelectorAll('#p-chips .chip.on')].map((b) => b.textContent).join()`));
  await shot('en-07-snap');
  await tap('#p-go');
  ok('开始听写:五个单词,英语老师念', await waitFor(`document.querySelector('#v-start.on #s-title')?.textContent === '单词听写 · 5 个单词' && document.querySelector('#s-sub').textContent.startsWith('英语老师')`));
  ws.close();
} finally {
  browser.kill();
  if (!keep) mock.kill();
  console.log(fails ? `${fails} 项没过` : '全过');
  if (out) console.log(`截图在 ${out}`);
  process.exit(fails ? 1 : 0);
}

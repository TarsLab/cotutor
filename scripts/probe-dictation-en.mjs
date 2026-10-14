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
  /** 在四线三格里写一个单词:几笔折线,画在基线上下(尺子 2048 × 512;画的视窗上下各多露一截:0 -192 2048 896);第一笔竖着冒出最上面那条线(拍板 22) */
  const writeWord = async (padSel, n = 3) => {
    const r = await rect(padSel);
    for (let k = 0; k < n; k++) {
      const x0 = 300 + k * 420;
      const pts = [];
      if (k === 0) for (let q = 0; q <= 12; q++) pts.push([x0, -120 + q * 36]);
      else for (let q = 0; q <= 12; q++) pts.push([x0 + q * 25, 210 + Math.sin(q / 2) * 100]);
      const s = pts.map(([x, y]) => ({ x: r.x + (x / 2048) * r.w, y: r.y + ((y + 192) / 896) * r.h }));
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s[0].x, y: s[0].y, button: 'left', buttons: 1, clickCount: 1 });
      for (const p of s.slice(1)) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s[s.length - 1].x, y: s[s.length - 1].y, button: 'left', buttons: 0, clickCount: 1 });
    }
  };
  const view = () => evaluate(`document.querySelector('.view.on')?.id ?? null`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/` });
  await waitFor(`!!document.querySelector('#deck .pc[data-tutor="english-tutor"] .pc-hd .av')`);
  await tap('#deck .pc[data-tutor="english-tutor"] .pc-hd .av');
  ok('首页:英语老师卡里有「单词听写 · 3 个单词」,看不到字', await waitFor(`!!document.querySelector('#deck .pc.front[data-tutor="english-tutor"] .bt-x-dictation') && document.querySelector('#deck .pc.front .bt-x-dictation').textContent.includes('单词听写') && document.querySelector('#deck .pc.front .bt-x-dictation').textContent.includes('3 个单词') && !document.querySelector('#deck .pc.front').textContent.includes('yellow') && document.querySelector('#deck .pc.front .bt-x-dictation').getAttribute('href').endsWith('&lang=en')`));
  await shot('en-01-home');
  await tap('#deck .pc.front .bt-x-dictation');
  ok('进英文那页:开始屏「单词听写 · 3 个单词」', await waitFor(`location.search.includes('lang=en') && document.querySelector('#v-start.on #s-title')?.textContent === '单词听写 · 3 个单词'`));
  await tap('#s-go');
  ok('写:第 1 个,四线三格(四条线、第三条基线),气泡里没有单词', await waitFor(`document.querySelector('.view.on')?.id === 'v-write' && document.querySelectorAll('#w-pad .enl line').length === 4 && document.querySelectorAll('#w-pad .enl line.base').length === 1 && !document.body.innerText.includes('red')`));
  await writeWord('#w-pad');
  ok('写了三笔', (await evaluate(`document.querySelectorAll('#w-pad .eni path').length`)) === 3);
  ok('第一笔冒出最上面那条线,出格的那截照样画着(拍板 22)', await evaluate(`(() => { const b = document.querySelector('#w-pad .eni path').getBBox(); return b.y < -60 && b.y > -192; })()`));
  await tap('#w-undo');
  ok('撤销撤一笔', (await evaluate(`document.querySelectorAll('#w-pad .eni path').length`)) === 2);
  await shot('en-02-write');
  ok('出口同老师页:左上角「‹ 头像」胶囊带英语老师的脸;按钮叫「再念」', await evaluate(`(() => { const b = document.querySelector('#back'); return !!b && !b.hidden && !!b.querySelector('.tfav .face') && b.getBoundingClientRect().left < 30 && !document.body.innerText.includes('回首页') && document.querySelector('#w-again').textContent === '再念'; })()`));
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
  ok('再写一遍是一层:胶囊收起,右上角 ×', await evaluate(`document.querySelector('#back').hidden && !document.querySelector('#w-x').hidden`));
  await writeWord('#w-pad', 2);
  await tap('#w-done');
  ok('交了:回对一对,第一行写着又写了一遍', await waitFor(`document.querySelector('.view.on')?.id === 'v-check' && document.querySelectorAll('#c-rows .row')[0].innerText.includes('又写了一遍')`));
  await tap('#c-done');
  ok('对好了:回首页', await waitFor(`location.pathname === '/'`));
  const list = await (await fetch(`${base}/api/dictation`)).json();
  const s = list.sessions.find((x) => x.lang === 'en');
  ok('存下的:lang en、三个单词、看了答案 1 个、对好了', s && s.words.join() === 'red,yellow,bus' && s.revealed === 1 && s.done, JSON.stringify(s));
  await send('Page.navigate', { url: `${base}/parent/dictation` });
  await waitFor(`document.querySelectorAll('#dates button').length > 0`);
  await evaluate(`[...document.querySelectorAll('#dates button')].find((b) => b.dataset.id === ${JSON.stringify(s?.id)})?.click()`);
  ok('家长页:四线三格的格、蓝字叠着、看了答案:yellow、不说逐笔的话', await waitFor(`document.querySelectorAll('svg.tz.en').length >= 3 && document.body.innerText.includes('看了答案:yellow') && !document.body.innerText.includes('笔顺')`));
  await shot('en-05-parent');
  await send('Page.navigate', { url: `${base}/parent/dictation/reel?id=${s?.id}` });
  const K = `document.querySelector('#rl-frame').contentDocument`;
  await waitFor(`!document.querySelector('#reel').hidden`, 10000);
  await evaluate(`(() => { const r = document.querySelector('#rl-seek'); r.value = '0'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
  ok('录像:外壳里上半是英文页的录像模式(四线三格)、下半录像栏;一个单词一章(三章 + 对一对)', await waitFor(`!document.querySelector('#reel').hidden && (document.querySelector('#rl-frame').getAttribute('src') || '').includes('lang=en') && ${K}?.querySelector('.view.on')?.id === 'v-write' && ${K}.querySelectorAll('#w-pad .enl line').length === 4 && document.querySelectorAll('#rl-chaps i').length === 3`, 10000), await evaluate(`JSON.stringify({ src: document.querySelector('#rl-frame').getAttribute('src'), chaps: document.querySelectorAll('#rl-chaps i').length })`));
  await tap('#rl-marks i.rv');
  ok('点「给答案」的点:yellow 灰灰地打底,录像栏写给答案', await waitFor(`${K}.querySelector('#w-pad .enw.trace')?.textContent === 'yellow' && document.querySelector('#rl-cap').textContent.includes('给答案')`), await evaluate(`document.querySelector('#rl-cap').textContent`));
  await tap('#rl-more');
  ok('经过:给答案、照着写、交卷、再写一遍', await waitFor(`(() => { const t = document.querySelector('#rl-log').innerText; return ['给答案', '照着写', '交卷', '再写一遍「red」'].every((x) => t.includes(x)); })()`), await evaluate(`document.querySelector('#rl-log').innerText.slice(0, 500)`));
  await evaluate(`[...document.querySelectorAll('#rl-log li')].find((li) => li.textContent.includes('再写一遍「red」')).setAttribute('data-probe-li', '1')`);
  await tap('[data-probe-li]');
  ok('点经过里的「再写一遍」:上面是 red,右上角 ×', await waitFor(`${K}.querySelector('.view.on')?.id === 'v-write' && ${K}.querySelector('#w-model').textContent === 'red' && !${K}.querySelector('#w-x').hidden`));
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
  ok('选词屏有照片:四个框都选上,还有「重拍」', await waitFor(`document.querySelector('#p-img').naturalWidth > 0 && document.querySelectorAll('#p-boxes .ebx.on').length === 4 && !!document.querySelector('#p-again')`));
  await shot('en-07b-pick');
  await tap('#p-boxes .ebx[aria-label="bus"]');
  ok('点照片上 bus 的框:框和词一起去掉', await evaluate(`!document.querySelector('#p-boxes .ebx[aria-label="bus"]').classList.contains('on') && ![...document.querySelectorAll('#p-chips .chip.on')].some((b) => b.textContent === 'bus')`));
  await evaluate(`(() => { const i = document.querySelector('#p-add'); i.value = 'blue 红色'; })()`);
  await tap('#p-add-go');
  ok('点选:加了 colour、去掉 bus、自己打的 blue 加进来,汉字的不收', await waitFor(`[...document.querySelectorAll('#p-chips .chip.on')].map((b) => b.textContent).join() === 'red,yellow,green,colour,blue'`), await evaluate(`[...document.querySelectorAll('#p-chips .chip.on')].map((b) => b.textContent).join()`));
  ok('自己加了词,「照片上还有这些」还在', await evaluate(`document.querySelectorAll('#p-more .chip').length > 0`));
  await shot('en-07-snap');
  await tap('#p-go');
  ok('开始听写:五个单词,英语老师念', await waitFor(`document.querySelector('#v-start.on #s-title')?.textContent === '单词听写 · 5 个单词' && document.querySelector('#s-sub').textContent.startsWith('英语老师')`));
  await tap('#s-go');
  ok('写第 1 个', await waitFor(`!!document.querySelector('#v-write.on')`));
  await tap('#back');
  ok('写字屏点胶囊:回首页', await waitFor(`location.pathname === '/'`));
  await send('Page.navigate', { url: `${base}/dictation?tutor=english-tutor&lang=en` });
  ok('再进拍照听写:最上面「刚才的还没写完 · 写到第 1 个了」', await waitFor(`!document.querySelector('#snap-resume')?.hidden && document.querySelector('#snap-resume-sub').textContent === '写到第 1 个了 · 一共 5 个' && document.querySelector('#snap-cam-btn').className === 'alt'`));
  await shot('en-08-resume');
  await tap('#snap-resume-go');
  ok('点接着写:写第 1 个', await waitFor(`!!document.querySelector('#v-write.on') && document.querySelector('#w-who').textContent.includes('第 1 个')`));
  ws.close();
} finally {
  browser.kill();
  if (!keep) mock.kill();
  console.log(fails ? `${fails} 项没过` : '全过');
  if (out) console.log(`截图在 ${out}`);
  process.exit(fails ? 1 : 0);
}

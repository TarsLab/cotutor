#!/usr/bin/env node
/**
 * 老师头像 C 形开口环的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 首页的便利贴小旗上是老师的脸、不画 C 环(和「按住说」的钮分开),叫爸爸妈妈时变灰 → 进数学老师(新话题没有了,用调试入口 ?tutor=):左上的返回胶囊 →
 * 从输入条问一句:等的时候左栏按钮里那张脸「想」(转圈;老师页一律是实时老师页的样子,板中间的大头像与底部字幕行 10-28 起没了);休息(开口朝下、变灰)用类直接看样式。实时老师页的「说」「听」在按钮里,见 /dev/voice 与 probe-live-page。
 * 左上返回胶囊是「‹ logo」不是头像,一页只有一张会动的脸。
 * iPad 横屏,每步截图。
 *
 * 用法:node scripts/probe-avatar.mjs [--shots <目录>] [--keep]
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
const port = 8798;
const cdp = 9342;
const base = `https://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, detail = '') => { if (!cond) fails++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
const tmp = probeDir('cotutor-probe-avatar-');
const shots = arg('--shots') ?? join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--delay', '2500'], { stdio: 'ignore', detached: keep });
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
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const f = join(shots, name); writeFileSync(f, Buffer.from(r.result.data, 'base64')); console.log('  ', f); };
  // 一颗头像的样子:有没有环与白底圆、环的颜色、描的长短、转角(开口朝哪)、在跑的动画
  const AV = `(el) => { if (!el) return null; const c = el.querySelector('.ring circle'), f = el.querySelector('.face'), cs = c && getComputedStyle(c); return { ring: Boolean(c), face: Boolean(f), border: getComputedStyle(el).borderTopWidth, stroke: cs && cs.stroke, color: getComputedStyle(el).color, dash: cs && cs.strokeDasharray, transform: cs && cs.transform, anim: cs && cs.animationName, draw: el.classList.contains('draw') }; }`;

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/` });
  await until(`document.querySelectorAll('#tabs .tab .av').length > 0`);
  const flags = await evaluate(`[...document.querySelectorAll('#tabs .tab .av')].map((el) => ({ face: Boolean(el.querySelector('.face')), ring: getComputedStyle(el.querySelector('.ring')).display, border: getComputedStyle(el).borderTopWidth }))`);
  ok('首页(便利贴小旗):旗头是老师的脸,不画 C 环(不像「按住说」的钮)', flags.length > 0 && flags.every((a) => a.face && a.ring === 'none' && a.border === '0px'), JSON.stringify(flags[0]));
  await sleep(1500);
  await shot('avatar-home.png');

  // 叫爸爸妈妈(gated):小旗上的老师变灰
  const off = await evaluate(`(async () => { document.body.classList.add('gated'); await new Promise((r) => setTimeout(r, 400)); const a = document.querySelector('#tabs .tab.front .av'); const r = { filter: getComputedStyle(a).filter }; document.body.classList.remove('gated'); return r; })()`);
  ok('叫爸爸妈妈:小旗上的老师变灰', /grayscale/.test(off.filter), JSON.stringify(off));

  // 进数学老师(调试入口 ?tutor=,今天还没有话题,板是空的)
  await send('Page.navigate', { url: `${base}/?tutor=math-tutor` });
  await until(`document.querySelector('#tutor.on')`);
  await sleep(600);
  const back = await evaluate(`(() => { const b = document.querySelector('#back'); return { logo: !!b.querySelector('svg.ct-logo'), av: b.querySelectorAll('.av').length, ini: b.querySelector('.bk-ini')?.textContent ?? '', bg: getComputedStyle(b).backgroundColor, sub: Boolean(document.querySelector('#sub-av')) }; })()`);
  ok('左上返回胶囊是「‹ logo 数」、填数学老师的蓝、没有头像(首字不动);没有底部字幕行那颗(一页一张脸,在左栏按钮里)', back.logo && back.av === 0 && back.ini === '数' && back.bg === 'rgb(47, 111, 214)' && !back.sub, JSON.stringify({ back }));
  await sleep(1300); await shot('avatar-blank.png');

  // 从输入条问一句(页面外 POST 的回答不播放)
  await evaluate(`document.querySelector('#ph').click()`);
  await until(`!document.querySelector('#typed').hidden`);
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '13 减 8 怎么算'; t.dispatchEvent(new Event('input')); document.querySelector('#go').click(); })()`);
  await until(`document.body.classList.contains('pending')`, 20);
  // 等的时候看得见的那张脸是左栏按钮里那颗(板上那块空白板收着,它的大头像不露)
  const think = await evaluate(`(() => { const face = document.querySelector('#lv-hold .av'); const moving = [...document.querySelectorAll('#main .av')].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e.querySelector('.ring circle')).animationName !== 'none').length; return { face: (${AV})(face), moving, others: document.querySelectorAll('.wait-card, #back .av').length }; })()`);
  ok('等的时候:左栏按钮里那张脸在「想」(转圈 + 一呼一吸),只有它在动;没有占位卡、左上胶囊没有头像', think.face && think.face.anim === 'vb-spin, vb-breathe' && think.moving === 1 && think.others === 0, JSON.stringify(think));
  await sleep(600); await shot('avatar-think.png');
  // 「说」「该你了」「听」在按住说话那颗按钮里(样子在 /dev/voice 的样张、probe-live-page 里看)

  // 减弱动态效果:都不动
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const still = await evaluate(`(async () => { document.body.classList.add('pending'); await new Promise((r) => setTimeout(r, 100)); const a = getComputedStyle(document.querySelector('#lv-hold .av .ring circle')).animationName; document.body.classList.remove('pending'); return a; })()`);
  ok('减弱动态效果:不动', still === 'none', still);
} catch (e) {
  fails++;
  console.log('✗ 出错', e.message);
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(500); try { rmSync(tmp, { recursive: true, force: true }); } catch {} } else console.log('mock 留着:', base, ' 截图在', shots);
  console.log(fails ? `${fails} 项没过` : '全过');
  process.exit(fails ? 1 : 0);
}

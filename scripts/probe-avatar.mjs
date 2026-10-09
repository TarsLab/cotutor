#!/usr/bin/env node
/**
 * 老师头像 C 形开口环(《首页设计.md》§5.1、拍板 15)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 首页老师卡头像是环 + 白底圆、开口朝右、打开时一笔画出来(5 秒一轮的刷新不再画)→ 进数学老师、新话题:空白板的头像画出来 →
 * 从输入条问一句:等的时候左上头像「想」(转圈)、念的时候「说」、念完停下「该你了」点一下头 → 按住说话的「听」与休息(开口朝下、变灰)用类直接看样式。
 * iPad 横屏,每步截图。
 *
 * 用法:node scripts/probe-avatar.mjs [--shots <目录>] [--keep]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

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
const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-avatar-'));
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
  await quiet(send);
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/` });
  await until(`document.querySelectorAll('.c-tutor .av').length > 0`);
  const home = await evaluate(`[...document.querySelectorAll('.c-tutor .av')].map(${AV})`);
  ok('首页:每张老师卡的头像是环 + 白底圆,没有边框;环是学科色(stroke = color);第一回铺是「画出来」', home.length > 0 && home.every((a) => a.ring && a.face && a.border === '0px' && a.stroke === a.color && a.draw && a.anim === 'av-draw'), JSON.stringify(home[0]));
  const delays = await evaluate(`[...document.querySelectorAll('.c-tutor .av')].map((el) => getComputedStyle(el.querySelector('.ring circle')).animationDelay)`);
  ok('几位老师错开画(0s、0.15s、0.3s…)', delays.length < 2 || delays[1] === '0.15s', delays.join(' '));
  await sleep(250); await shot('avatar-home-drawing.png');
  await sleep(1500);
  const rest = await evaluate(`(${AV})(document.querySelector('.c-tutor .av'))`);
  ok('画完:描 80% 留 20%,转 36°,开口居中在右', /^221\.17px?,? 55\.29px?$/.test(rest.dash.replace(/,\s*/, ' ')) && /matrix\(0\.809/.test(rest.transform), `${rest.dash} ${rest.transform}`);
  await shot('avatar-home.png');
  await sleep(5600);
  const again = await evaluate(`[...document.querySelectorAll('.c-tutor .av')].some((el) => el.classList.contains('draw'))`);
  ok('5 秒一轮的刷新重铺了也不再画', again === false);

  // 休息:整张卡灰掉时开口朝下(126°);按着卡时扭一下(8°)
  const off = await evaluate(`(async () => { const c = document.querySelector('.c-tutor'); c.classList.add('off'); await new Promise((r) => setTimeout(r, 700)); const t = getComputedStyle(c.querySelector('.av .ring circle')); const r = { transform: t.transform, filter: getComputedStyle(c.querySelector('.av')).filter }; c.classList.remove('off'); return r; })()`);
  ok('休息:开口朝下、变灰', /matrix\(-0\.58/.test(off.transform) && /grayscale/.test(off.filter), JSON.stringify(off));

  // 进数学老师、新话题:空白板
  await evaluate(`[...document.querySelectorAll('.c-tutor')].find((c) => c.dataset.tutor === 'math-tutor')?.querySelector('.bt-new')?.click()`);
  await until(`document.querySelector('#tutor.on .blank .av')`);
  const blank = await evaluate(`(${AV})(document.querySelector('.blank .av'))`);
  const back = await evaluate(`(${AV})(document.querySelector('#c-av'))`);
  ok('空白板的头像画出来;左上返回胶囊是同一个环', blank && blank.draw && blank.anim === 'av-draw' && back && back.ring && back.face && back.anim === 'none', JSON.stringify({ blank, back }));
  await sleep(1300); await shot('avatar-blank.png');

  // 从输入条问一句(页面外 POST 的回答不播放)
  await evaluate(`document.querySelector('#ph').click()`);
  await until(`!document.querySelector('#typed').hidden`);
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '13 减 8 怎么算'; t.dispatchEvent(new Event('input')); document.querySelector('#go').click(); })()`);
  await until(`document.body.classList.contains('pending')`, 20);
  const think = await evaluate(`({ back: (${AV})(document.querySelector('#c-av')), wait: (${AV})(document.querySelector('.wait-card .av')), sub: (${AV})(document.querySelector('#sub-text .av')) })`);
  ok('等的时候:左上、等待卡、字幕里的头像都在「想」(转圈 + 一呼一吸)', [think.back, think.wait, think.sub].every((a) => a && a.anim === 'av-spin, av-breathe'), JSON.stringify(think));
  await sleep(600); await shot('avatar-think.png');
  // 念:采样左上头像的动画,直到停下
  const seen = new Set(); let nod = false;
  for (let i = 0; i < 160; i++) {
    const s = await evaluate(`({ a: getComputedStyle(document.querySelector('#c-av .ring circle')).animationName, nod: document.body.classList.contains('nod'), speaking: document.body.classList.contains('speaking'), w: document.body.classList.contains('waiting') })`);
    seen.add(s.a); if (s.nod) nod = true;
    if (s.speaking && !seen.has('shot')) { seen.add('shot'); await shot('avatar-talk.png'); }
    if (nod && !s.speaking) break;
    await sleep(150);
  }
  ok('念的时候「说」(开口一张一合)', seen.has('av-talk'), [...seen].join(' '));
  ok('念完停下「该你了」点一下头,一秒后摘掉', nod && await until(`!document.body.classList.contains('nod')`, 8), [...seen].join(' '));
  await shot('avatar-settled.png');

  // 听:孩子按住说话(无头 Chrome 没有识别,直接加类看样式)
  const listen = await evaluate(`(async () => { document.body.classList.add('listening'); await new Promise((r) => setTimeout(r, 900)); const c = getComputedStyle(document.querySelector('#c-av .ring circle')); const r = { anim: c.animationName, transform: c.transform }; document.body.classList.remove('listening'); return r; })()`);
  ok('听:开口转向下面(126° 附近),一呼一吸', listen.anim === 'av-turn, av-listen' && /matrix\(-0\.[5-7]/.test(listen.transform), JSON.stringify(listen));

  // 减弱动态效果:都不动
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const still = await evaluate(`(async () => { document.body.classList.add('pending'); await new Promise((r) => setTimeout(r, 100)); const a = getComputedStyle(document.querySelector('#c-av .ring circle')).animationName; document.body.classList.remove('pending'); return a; })()`);
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

#!/usr/bin/env node
/**
 * 小课堂在 WebKit(Safari 的内核,iPad 上就是它)里的手动验收:Chrome 里好好的、iPad 上坏的几处(2026-10-06 真机报的)——
 * 一、SVG 放进页面后 Safari 让 SMIL 时间轴重新走,没点「开始看」画面就自己画、没有声音;
 * 二、真手指(不是 dispatchEvent)圈得上:舞台页装着孩子端的 theme.css,同名的类会把 pointer-events 关掉;
 * 三、圈的卡的缩略图(克隆的 SVG)停在那一刻、不自己走。
 * 本仓不装 playwright:借一份 playwright-core 和它配套的 WebKit(在那个目录里跑 node node_modules/playwright-core/cli.js install webkit)。
 *
 * 用法:PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录> node scripts/probe-lecture-webkit.mjs [截图.png]
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
if (!process.env.PLAYWRIGHT_CORE) { console.error('要 PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录>'); process.exit(2); }
const { webkit } = require(process.env.PLAYWRIGHT_CORE + '/node_modules/playwright-core');
const repo = fileURLToPath(new URL('..', import.meta.url));
const port = 8797, base = `https://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = spawn(process.execPath, [repo + 'bin/cotutor.js', 'mock', '--port', String(port)], { stdio: 'ignore' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/kid/home`)).ok) break; } catch {} await sleep(250); }
const browser = await webkit.launch();
const ok = (n, c, d = '') => console.log(`${c ? '✓' : '✗'} ${n} ${d}`);
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1180, height: 820 } });
  page.on('pageerror', (e) => console.log('ERR', e.message));
  await page.goto(`${base}/`);
  await page.click('.bt-lecture');
  const fr = page.frameLocator('#lc-frame');
  await fr.locator('.lc-start').waitFor({ timeout: 30000 });
  const frame = page.frames().find((f) => f.url().includes('/stage/'));
  // 画面的样子:烤过的课包没有 SMIL,看露出来几个元素、正在画的那一笔描到哪(dashoffset);paused = 没有 SMIL 在自己走
  const st = () => frame.evaluate(() => { const s = document.querySelector('.lc-svg'); const roots = [...s.children].filter((e) => e.tagName === 'g'); const shown = roots.filter((e) => e.style.display !== 'none'); const dash = [...s.querySelectorAll('[stroke-dashoffset]')].map((e) => e.getAttribute('stroke-dashoffset')).join(','); return { paused: !s.querySelector('animate'), t: shown.length * 1000 + dash.length, shown: shown.length, dash, time: document.querySelector('.lc-time span').textContent }; });
  const a = await st(); await sleep(2000); const b = await st();
  ok('没点开始看:画面不动', a.t === b.t && b.time === '0:00 / 0:46', JSON.stringify([a, b]));
  await fr.locator('.lc-start').click();
  await sleep(3000);
  const c = await st();
  ok('点了开始看:时钟走、画面跟着(露出了好几样)、没有 SMIL', c.paused && /^0:0[2-4]/.test(c.time) && c.shown > a.shown && c.shown >= 3, JSON.stringify({ a, c }));
  await fr.locator('.lc-play').click();
  const d = await st(); await sleep(1500); const e = await st();
  ok('暂停:画面停住', d.t === e.t && d.time === e.time, JSON.stringify([d, e]));
  // 真鼠标圈一圈
  const box = await fr.locator('.lc-canvas').boundingBox();
  const cx = box.x + box.width * 0.45, cy = box.y + box.height * 0.45;
  await page.mouse.move(cx + 60, cy);
  await page.mouse.down();
  for (let k = 1; k <= 24; k++) { const g = k / 24 * Math.PI * 2; await page.mouse.move(cx + 60 * Math.cos(g), cy + 45 * Math.sin(g)); }
  await page.mouse.up();
  await sleep(300);
  ok('圈了一处', (await fr.locator('.lc-mark').count()) === 1);
  const sb = await fr.locator('.lc-seg').nth(5).boundingBox();
  await page.mouse.click(sb.x + 2, sb.y + sb.height / 2);
  await fr.locator('.lc-play').click();
  await page.waitForSelector('.lc-pending .c-mark img.mk-svg', { timeout: 30000 });
  await page.waitForFunction(() => (document.querySelector('.lc-pending .c-mark img.mk-svg')?.naturalWidth ?? 0) > 0, null, { timeout: 30000 });
  const th = await page.evaluate(() => { const i = document.querySelector('.lc-pending .c-mark img.mk-svg'); return { w: i.naturalWidth, src: i.src.includes('/frame.svg?svg=') && i.src.includes('ring=') }; });
  ok('圈的卡的缩略图:服务端现画的一张图(frame.svg,带圈),Safari 里显示得出', th.w > 0 && th.src, JSON.stringify(th));
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
} finally { await browser.close(); mock.kill(); }

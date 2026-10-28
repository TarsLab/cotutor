#!/usr/bin/env node
/**
 * 小课堂在 WebKit(Safari 的内核,iPad 上就是它)里的手动验收:Chrome 里好好的、iPad 上坏的几处(2026-10-06 真机报的)——
 * 一、SVG 放进页面后 Safari 让 SMIL 时间轴重新走,没点「开始看」画面就自己画、没有声音;
 * 二、真手指(不是 dispatchEvent)画得上:舞台页装着孩子端的 theme.css,同名的类会把 pointer-events 关掉;同一刻画两笔还是一处;
 * 三、画的卡的缩略图是播放器截的图(2026-10-19 起):烤好的画面(frame.svg,字体与背景图内嵌)画进 canvas、叠上两笔、出 jpeg——Safari 不把 canvas 标成跨源、字体画得出。
 *    给了截图路径(argv[2])就在旁边存一份那张 jpeg(<名>-mark.jpg),对着看字体。
 * 本仓不装 playwright:借一份 playwright-core 和它配套的 WebKit(在那个目录里跑 node node_modules/playwright-core/cli.js install webkit)。
 *
 * 用法:PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录> node scripts/probe-lecture-webkit.mjs [截图.png]
 */
import { createRequire } from 'node:module';
import { spawn } from './_guard.mjs';
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
  await page.click('#deck .pc[data-tutor="math-tutor"]', { position: { x: 40, y: 40 } }); // 后面那张只露出左上角(牌角的头像),里面的东西不收触摸
  await page.waitForTimeout(1200);
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
  // 真鼠标画一圈,同一刻再打个钩
  const box = await fr.locator('.lc-canvas').boundingBox();
  const cx = box.x + box.width * 0.45, cy = box.y + box.height * 0.45;
  await page.mouse.move(cx + 60, cy);
  await page.mouse.down();
  for (let k = 1; k <= 24; k++) { const g = k / 24 * Math.PI * 2; await page.mouse.move(cx + 60 * Math.cos(g), cy + 45 * Math.sin(g)); }
  await page.mouse.up();
  await sleep(300);
  await page.mouse.move(cx + 90, cy);
  await page.mouse.down();
  for (const [x, y] of [[100, 15], [110, 25], [140, -30]]) await page.mouse.move(cx + x, cy + y, { steps: 4 });
  await page.mouse.up();
  await sleep(600);
  ok('画了两笔:同一刻,还是一处', (await fr.locator('.lc-mark').count()) === 1 && (await fr.locator('.lc-ink path').count()) === 2);
  const sb = await fr.locator('.lc-seg').nth(5).boundingBox();
  await page.mouse.click(sb.x + 2, sb.y + sb.height / 2);
  await fr.locator('.lc-play').click();
  // 放完停在最后一帧,「去问老师」淡入了才回板书
  await fr.locator('.lc-askbtn').waitFor({ timeout: 60000 });
  await fr.locator('.lc-askbtn').click();
  await page.waitForSelector('.lc-pending .c-mark img.mk-svg', { timeout: 30000 });
  await page.waitForFunction(() => (document.querySelector('.lc-pending .c-mark img.mk-svg')?.naturalWidth ?? 0) > 0, null, { timeout: 30000 });
  // 截图:jpeg、1280 宽;数像素:蓝的(画的两笔)、深色的(课包的字与线)
  const th = await page.evaluate(async () => {
    const i = document.querySelector('.lc-pending .c-mark img.mk-svg');
    const px = { blue: 0, dark: 0 };
    const cv = document.createElement('canvas'); cv.width = i.naturalWidth; cv.height = i.naturalHeight; const g = cv.getContext('2d'); g.drawImage(i, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    for (let k = 0; k < d.length; k += 4) { if (Math.abs(d[k] - 47) + Math.abs(d[k + 1] - 111) + Math.abs(d[k + 2] - 214) < 90) px.blue++; else if (d[k] + d[k + 1] + d[k + 2] < 200) px.dark++; }
    return { jpeg: i.src.startsWith('data:image/jpeg;base64,'), w: i.naturalWidth, h: i.naturalHeight, px, src: i.src.startsWith('data:') ? i.src : '' };
  });
  ok('画的卡的缩略图是截图(Safari 能把烤好的画面画进 canvas 导出 jpeg):1280 宽,画面上的字与线在,叠着两笔', th.jpeg && th.w === 1280 && th.px.blue > 1500 && th.px.dark > 2000, JSON.stringify({ ...th, src: undefined }));
  if (process.argv[2]) {
    await page.screenshot({ path: process.argv[2] });
    if (th.src) { const { writeFileSync } = await import('node:fs'); const f = process.argv[2].replace(/\.png$/, '') + '-mark.jpg'; writeFileSync(f, Buffer.from(th.src.split(',')[1], 'base64')); console.log('  ' + f); }
  }
} finally { await browser.close(); mock.kill(); }

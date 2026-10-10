#!/usr/bin/env node
/**
 * 画图卡(cards/paint/card.md,《wip/你说我画设想.md》)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock,Chrome 开孩子端语文老师,从输入条发到第五节(mock 脚本的最后一节是出题版的画图卡):
 * 刚出来是题干 + 分好的四幅 +「画家在画」+ 词语宝库,没有图、不显示角色;老师说完以后页面自己隔几秒拉一次,图到了淡入、「画家在画」没了;
 * 点卡开舞台放大看图;手机不横向滚。iPad 横屏、手机各截一张。
 *
 * 用法:node scripts/probe-paint.mjs [--out <截图目录>] [--keep](留下 mock)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

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

const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-paint-'));
const shots = outAt > 0 ? process.argv[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
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
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const device = async (w, h, dsf, mobile) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile }); await sleep(400); };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);

  await device(1180, 820, 1, false);
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor` });
  await until(`Boolean(document.querySelector('#typed'))`);
  await sleep(800);
  // 从页面的输入条发(页面外调接口发的,页面当成念过了);mock 预载了第一节,再发四条到画图卡那节
  for (const text of ['他自己的', '多做一步', '鼓励怎么写', '我说完了,画吧']) {
    const before = await evaluate(`document.querySelectorAll('#board .sec').length`);
    await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = ${JSON.stringify(text)}; document.querySelector('#go').click(); return true; })()`);
    await until(`document.querySelectorAll('#board .sec').length > ${before} && !document.body.classList.contains('pending')`, 80);
  }
  const got = await until(`Boolean(document.querySelector('#board .c-paint'))`, 40);
  ok('第五节出了画图卡', got, String(await evaluate(`document.querySelectorAll('#board .sec').length`)));
  // 等这一节播到画图卡(讲稿一句一句念,卡跟着铺出来)
  await until(`(() => { const c = document.querySelector('#board .c-paint'); return Boolean(c && c.offsetParent && c.getBoundingClientRect().height > 100); })()`, 120);
  await sleep(1000);
  await evaluate(`document.querySelector('#board .c-paint').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  const c0 = await evaluate(`(() => { const c = document.querySelector('#board .c-paint'); return { drawn: c.dataset.drawn, cells: c.querySelectorAll('.pt-cell').length, nums: [...c.querySelectorAll('.pt-n')].map((x) => x.textContent).join(''), img: Boolean(c.querySelector('img')), wait: c.querySelector('.pt-wait')?.textContent, ask: c.querySelector('.pt-ask')?.textContent.slice(0, 6), words: c.querySelector('.pt-words span')?.textContent, cast: c.innerText.includes('背带裤'), note: Boolean(c.querySelector('.pt-note')) }; })()`);
  ok('在画:题干、四幅(编号 1–4)、「画家在画」、词语宝库;没有图、不显示角色、没有家长那行', c0.drawn === 'drawing' && c0.cells === 4 && c0.nums === '1234' && !c0.img && c0.wait === '画家在画' && c0.ask === '图上画了谁?' && c0.words === '播种、睡大觉、满满、羞愧' && !c0.cast && !c0.note, JSON.stringify(c0));
  // 板书跟着念到的那句滚动:截之前再把卡滚到中间
  await evaluate(`document.querySelector('#board .c-paint').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await sleep(300);
  console.log('  ', await shot('paint-drawing-ipad.png'));

  // 老师说完了,页面自己隔 3 秒拉一次;mock 发出后 20 秒算画好
  const drawn = await until(`Boolean(document.querySelector('#board .c-paint img'))`, 120);
  const c1 = await evaluate(`(() => { const c = document.querySelector('#board .c-paint'); const i = c.querySelector('img'); return { drawn: c.dataset.drawn, src: i ? i.getAttribute('src') : null, cells: c.querySelectorAll('.pt-cell').length, wait: Boolean(c.querySelector('.pt-wait')), words: Boolean(c.querySelector('.pt-words')) }; })()`);
  ok('画好了:图淡入(经 /api/kid/image)、分幅与「画家在画」收起、词语宝库还在', drawn && c1.drawn === 'done' && /^\/api\/kid\/image\?p=mock-paint%2F/.test(c1.src ?? '') && c1.cells === 0 && !c1.wait && c1.words, JSON.stringify(c1));
  await until(`(() => { const i = document.querySelector('#board .c-paint img'); return i && i.complete && i.naturalWidth > 0; })()`, 20);
  await evaluate(`document.querySelector('#board .c-paint').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await sleep(1200);
  console.log('  ', await shot('paint-done-ipad.png'));
  const wide = await evaluate(`(() => { const c = document.querySelector('#board .c-paint'); const i = c.querySelector('img').getBoundingClientRect(), w = c.querySelector('.pt-words').getBoundingClientRect(), r = c.getBoundingClientRect(); return { img: Math.round(i.width), right: w.left >= i.right, h: Math.round(r.height) }; })()`);
  ok('iPad:图最宽 520、词语宝库在图右边、整张卡一屏放得下', wide.img <= 520 && wide.right && wide.h < 760, JSON.stringify(wide));

  // 舞台:放大看图
  await evaluate(`document.querySelector('#board .c-paint').click()`);
  const staged = await until(`document.querySelector('#stage').classList.contains('on') && Boolean(document.querySelector('#stage .zoom img'))`, 20);
  ok('点卡开舞台,铺满放大看图', staged);
  await sleep(500);
  console.log('  ', await shot('paint-stage-ipad.png'));
  await evaluate(`document.querySelector('#st-x').click()`);
  await sleep(400);
  ok('关舞台', !(await evaluate(`document.querySelector('#stage').classList.contains('on')`)));

  // 手机
  await device(390, 844, 2, true);
  await evaluate(`document.querySelector('#board .c-paint').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await sleep(500);
  const ph = await evaluate(`(() => { const c = document.querySelector('#board .c-paint'); const r = c.getBoundingClientRect(), i = c.querySelector('img').getBoundingClientRect(); return { cw: Math.round(r.width), iw: Math.round(i.width), ih: Math.round(i.height), over: document.documentElement.scrollWidth > innerWidth }; })()`);
  ok('手机:图在卡里、方的、不横向滚', ph.iw <= ph.cw && Math.abs(ph.iw - ph.ih) <= 2 && !ph.over, JSON.stringify(ph));
  console.log('  ', await shot('paint-phone.png'));

  ok('页面没抛异常', errors.length === 0, errors.join(' | '));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(join(tmp, 'chrome'), { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/?tutor=chinese-tutor`); }
  console.log(`截图在 ${shots}`);
}
process.exit(bad ? 1 : 0);

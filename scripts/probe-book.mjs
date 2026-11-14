#!/usr/bin/env node
/**
 * 课本做底的舞台(src/ui/stage/book.tsx)手动验收:不进 pnpm test,要本机 Chrome、一个跑着的 cotutor serve(它的 vault 教材/ 下放了课本 PDF)。不花钱、不起老师。
 * 直接开 /stage/,照页面那样 postMessage 发课本卡进去;卡的参数用服务端那几个函数现算(读课本索引、落板之前换框),和老师真出的卡一样:
 *  一、目录那张:pdf.js 现画,两页都画出来了(画布上有字)。
 *  二、老师翻到《坐井观天》看开头:窗对着开头。
 *  三、下一张看第 6–7 段、圈「井沿」:同一块板(不重铺),窗滑过去,第 6–7 段在窗里,圈画上了。
 *  四、手指往上拖:窗跟着走、不落笔;停下来报一次窗(view)。
 *  五、两指捏开:放大,不落笔;停下来窗里那一块重画清楚。
 *  六、笔(pointerType = pen)画一道:留下一笔、回状态。
 *  七、手指点「渴」:报 pick「渴」。
 *  八、老师下一张看第 1 段:窗滑回去,孩子画的那一笔还在。
 *  九、给老师看:交回板此刻的图(png)。
 * iPad 横屏各截一张(Page.captureScreenshot)。
 * 用法:node scripts/probe-book.mjs <服务根地址> --books <vault 的教材目录> [--book <文件名>] [--out <截图目录>]
 *   如:node scripts/probe-book.mjs http://127.0.0.1:5391 --books ~/ray-vault/教材
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIET_ARGS } from './_quiet.mjs';
import { bookIndex, listBooks, pickBook } from '../src/memory/textbook-pdf.ts';
import { boardPageSection, bookLesson } from '../src/board/board-page.ts';
import { bookFind, bookSheets, bookSpots } from '../src/chalk/index.ts';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const base = (args.find((a, i) => !a.startsWith('--') && !['--books', '--book', '--out'].includes(args[i - 1])) ?? 'http://127.0.0.1:5391').replace(/\/$/, '');
const books = opt('--books');
if (!books) { console.error('要 --books <vault 的教材目录>'); process.exit(2); }
const tmp = probeDir('cotutor-probe-book-');
const shots = opt('--out') ?? join(tmp, 'shots');
mkdirSync(shots, { recursive: true });
const file = opt('--book') ?? pickBook(await listBooks(books, '语文'), new Date());
const ix = await bookIndex(books, join(tmp, 'cache'), file);
if (!ix) { console.error(`读不到课本:${file}`); process.exit(2); }

/** 老师写的课本卡 → 落板之前换好的(和服务端一样) */
let lesson = null;
const card = (params) => {
  const sec = { heading: null, lines: [{ text: '一句', anchor: 0, marks: [], cues: [] }], cards: [{ kind: 'kit', props: { kit: '课本', params: { 课: '', 看: '', 圈: '', 遮: '', 书: '', 页: '', ...params }, ops: ['点字', '圈', '画'] } }] };
  const out = boardPageSection(sec, { page: true, photo: null, book: { file, index: ix, lesson } });
  const c = out.section.cards[0];
  lesson = c.props.params['课'];
  if (out.unfound.length) console.log(`  (课本里找不到:${out.unfound.join('、')})`);
  return c;
};

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9357;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
const proc = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
async function target() {
  for (let i = 0; i < 40; i++) {
    try { const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); if (page) return page.webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 没起来');
}
const ws = new WebSocket(await target());
await new Promise((r) => { ws.onopen = r; });
let seq = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
const until = async (expr, ms = 15000, every = 100) => { for (let t = 0; t < ms; t += every) { const v = await evaluate(expr); if (v) return v; await sleep(every); } return null; };

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `${base}/stage/` });
await until(`document.readyState === 'complete' && Boolean(document.querySelector('#root'))`);
// 舞台发给页面的(这里舞台就是顶层,发给自己)
await evaluate(`window.__got = []; addEventListener('message', (e) => { if (e.data && e.data.source === 'cotutor-stage' && e.data.type !== 'card') window.__got.push(e.data); }); true`);
const post = (c, id) => evaluate(`window.postMessage(${JSON.stringify({ source: 'cotutor-stage', type: 'card', id, kind: 'kit', props: c.props, state: null, full: true, hand: 'right' })}, '*'), true`);
const got = (type) => evaluate(`window.__got.filter((m) => m.type === ${JSON.stringify(type)})`);
const ready = () => until(`document.querySelector('.bk-board')?.dataset.phase === 'ready'`);
/** 窗:容器的 transform 与窗在屏幕上的位置 */
const camera = () => evaluate(`(() => { const p = document.querySelector('.bk-paper'), v = document.querySelector('.bk-view'); if (!p || !v) return null; const m = /translate\\(([-\\d.e]+)px, ([-\\d.e]+)px\\) scale\\(([-\\d.e]+)\\)/.exec(p.style.transform); const r = v.getBoundingClientRect(); return m ? { tx: +m[1], ty: +m[2], s: +m[3], left: r.left, top: r.top, w: r.width, h: r.height } : null; })()`);
const toScreen = (c, x, y) => ({ x: c.left + c.tx + x * c.s, y: c.top + c.ty + y * c.s });
const visible = (c) => [(-c.tx) / c.s, (-c.ty) / c.s, (c.w - c.tx) / c.s, (c.h - c.ty) / c.s];
const inks = () => evaluate(`document.querySelectorAll('.bk-ink path').length`);
const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
const drag = async (from, to, steps = 12, extra = {}) => {
  await mouse('mouseMoved', from.x, from.y, { buttons: 0, ...extra });
  await mouse('mousePressed', from.x, from.y, extra);
  for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { ...extra, button: 'left', buttons: 1 }); await sleep(16); }
  await mouse('mouseReleased', to.x, to.y, extra);
};

// 一、目录
const toc = card({});
await post(toc, 'p/0');
ok('目录:铺好了(两页)', Boolean(await ready()) && (await evaluate(`document.querySelectorAll('.bk-page').length`)) === toc.props.params['页'].split('-').length, toc.props.params['页']);
const inked = await until(`(() => { const c = document.querySelector('.bk-page'); if (!c || !c.width) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 400) if (d[i] < 160) n++; return n > 50 ? n : false; })()`, 15000, 300);
ok('pdf.js 画出了字(画布上有深色的点)', Boolean(inked), String(inked));
console.log('  截图', await shot('1-目录.png'));

// 二、翻到坐井观天、看开头
const c1 = card({ 课: '坐井观天', 看: '开头' });
await post(c1, 'p/1');
await ready();
await sleep(400);
const look1 = bookSpots(c1.props.params['看'])[0].box;
let cam = await camera();
const v1 = visible(cam);
ok('翻到《坐井观天》:窗对着开头', look1 && v1[1] <= look1[1] + 5 && v1[3] >= look1[3] - 5, JSON.stringify({ look1, v1: v1.map(Math.round) }));
await until(`(() => { const c = document.querySelectorAll('.bk-page')[0]; return c && c.width > 0; })()`, 10000);
await sleep(800);
console.log('  截图', await shot('2-开头.png'));

// 三、看第 6–7 段、圈井沿:同一块板,窗滑过去
const pagesBefore = await evaluate(`[...document.querySelectorAll('.bk-page')].map((c) => c.width).join()`);
const c2 = card({ 看: '第 6–7 段', 圈: '井沿' });
await post(c2, 'p/2');
await sleep(1000);
cam = await camera();
const look2 = bookSpots(c2.props.params['看'])[0].box;
const v2 = visible(cam);
ok('第二张同一课:不重铺(页的画布还是那几张)', pagesBefore === (await evaluate(`[...document.querySelectorAll('.bk-page')].map((c) => c.width).join()`)));
ok('窗滑到第 6–7 段(跨两页):整块在窗里', look2 && v2[1] <= look2[1] + 5 && v2[3] >= look2[3] - 5, JSON.stringify({ look2, v2: v2.map(Math.round) }));
ok('圈上了「井沿」', (await evaluate(`document.querySelectorAll('.bk-ring').length`)) === 1);
console.log('  截图', await shot('3-第6-7段.png'));

// 四、手指往上拖
const before = await camera();
await drag({ x: 600, y: 600 }, { x: 600, y: 300 });
const after = await camera();
ok('手指拖:窗往下走,不落笔', after.ty < before.ty - 200 && (await inks()) === 0, `${Math.round(before.ty)} → ${Math.round(after.ty)}`);
const v4 = await until(`window.__got.filter((m) => m.type === 'view').length >= 1`, 3000);
const views = await got('view');
ok('停下来报一次窗(view)', Boolean(v4) && views.length === 1 && views[0].box.length === 4, JSON.stringify(views));

// 五、两指捏开
const s0 = (await camera()).s;
const pinch = async (d0, d1) => {
  const cx = 600, cy = 450;
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= 10; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * i) / 10) }); await sleep(16); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
await pinch(120, 260);
const s1 = (await camera()).s;
ok('两指捏开:放大了,不落笔', s1 > s0 * 1.5 && (await inks()) === 0, `${s0.toFixed(2)} → ${s1.toFixed(2)}`);
const sharp = await until(`getComputedStyle(document.querySelector('.bk-sharp')).display === 'block'`, 5000, 200);
ok('停下来:窗里那一块重画清楚', Boolean(sharp));
console.log('  截图', await shot('5-放大.png'));

// 六、笔画一道
cam = await camera();
const p0 = { x: cam.left + cam.w * 0.3, y: cam.top + cam.h * 0.5 }, p1 = { x: cam.left + cam.w * 0.6, y: cam.top + cam.h * 0.55 };
await drag(p0, p1, 14, { pointerType: 'pen' });
await sleep(200);
const states = await got('state');
ok('笔画一道:留下一笔、回状态', (await inks()) === 1 && states.length > 0 && states[states.length - 1].state.marks.length === 1, JSON.stringify(states[states.length - 1]?.state?.marks?.length));

// 七、手指点「渴」
const at = bookLesson(ix, '坐井观天');
const sheets = bookSheets(at.pages);
const ke = bookFind(at.pages, sheets, '渴');
// 先让「渴」在窗里:发一张看它的卡(窗滑过去)
await post(card({ 看: '口渴了' }), 'p/3');
await sleep(1000);
cam = await camera();
const kp = toScreen(cam, (ke[0] + ke[2]) / 2, (ke[1] + ke[3]) / 2);
await mouse('mouseMoved', kp.x, kp.y, { buttons: 0 });
await mouse('mousePressed', kp.x, kp.y);
await sleep(60);
await mouse('mouseReleased', kp.x, kp.y);
await sleep(200);
const picks = await got('pick');
ok('手指点「渴」:报 pick「渴」', picks.length === 1 && picks[0].text === '渴', JSON.stringify(picks));
console.log('  截图', await shot('7-点字.png'));

// 八、老师下一张看第 1 段:窗滑回去,那一笔还在
await post(card({ 看: '第 1 段' }), 'p/4');
await sleep(1000);
cam = await camera();
const look8 = bookSpots((await evaluate('1') && card({ 看: '第 1 段' })).props.params['看'])[0].box;
const v8 = visible(cam);
ok('窗滑回第 1 段;孩子画的那一笔还在', v8[1] <= look8[1] + 5 && v8[3] >= look8[3] - 5 && (await inks()) === 1);
const lastState = (await got('state')).slice(-1)[0];
ok('新卡的状态带着那一笔(笔画挂在书页上)', lastState?.state?.marks?.length === 1);

// 九、给老师看
await evaluate(`window.postMessage({ source: 'cotutor-stage', type: 'control', action: 'submit' }, '*'), true`);
const sub = await until(`window.__got.find((m) => m.type === 'submit')`, 5000);
ok('给老师看:交回一张 png 和状态', Boolean(sub?.image?.startsWith('data:image/png')) && sub.image.length > 5000 && sub.state.marks.length === 1, String(sub?.image?.length));
if (sub?.image) writeFileSync(join(shots, '9-交的图.png'), Buffer.from(sub.image.split(',')[1], 'base64'));

ok('没有脚本报错', logs.length === 0, logs.slice(0, 3).join(' | '));
console.log(`\n截图在 ${shots}`);
ws.close();
proc.kill();
process.exit(bad ? 1 : 0);

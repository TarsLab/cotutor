#!/usr/bin/env node
/**
 * 白纸条(2026-11-16 阶段 2 任务 4;舞台 src/ui/stage/book.tsx 照一节课的状态画、src/board/strip.ts 排)手动验收:不进 pnpm test,
 * 要本机 Chrome、一个跑着的 cotutor serve(它的 vault 教材/ 下放了数学课本 PDF)。不花钱、不起老师。
 * 直接开 /stage/,照页面那样发一节课的样子(type: lesson);老师的动作用服务端那几个函数现落(src/board/lesson-fit.ts):
 *  一、翻到《6的乘法口诀》、看例 4、摆点阵 6 行 6 个、写 6×6=36、请圈:题目顶着窗口最上面,下面盖一条白纸,36 个点、一行字。
 *  二、笔在白纸条上圈一圈:报 stroke 带白纸条;页面落上再发回来,那一笔在白纸条里。
 *  三、看下一处:白纸条收起来;回到例 4:白纸条和那一笔都还在。
 *  四、擦 全部:白纸条没了。
 *  五、摆方向盘、请转:旁边一颗转钮,点一下报 turn(90°);落上再发回来,东到了右边。
 *  六、给老师看:交的那张图里有白纸条(白纸那一块不是课本的颜色)。
 * 页宽、两倍各截一张(给 Jack 真机比对:空位、白纸条够不够大)。
 * 用法:node scripts/probe-book-strip.mjs <服务根地址> --books <vault 的教材目录> [--book <文件名>] [--lesson 6的乘法口诀] [--look 例 4] [--out <截图目录>]
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIET_ARGS } from './_quiet.mjs';
import { bookIndex, listBooks, pickBook } from '../src/memory/textbook-pdf.ts';
import { fitActs, lessonOpen } from '../src/board/lesson-fit.ts';
import { lessonInit, lessonStep } from '../src/board/lesson.ts';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const base = (args.find((a, i) => !a.startsWith('--') && !['--books', '--book', '--out', '--lesson', '--look'].includes(args[i - 1])) ?? 'http://127.0.0.1:5391').replace(/\/$/, '');
const books = opt('--books');
if (!books) { console.error('要 --books <vault 的教材目录>'); process.exit(2); }
const tmp = probeDir('cotutor-probe-book-strip-');
const shots = opt('--out') ?? join(tmp, 'shots');
mkdirSync(shots, { recursive: true });
const file = opt('--book') ?? pickBook(await listBooks(books, '数学'), new Date());
const ix = await bookIndex(books, join(tmp, 'cache'), file);
if (!ix) { console.error(`读不到课本:${file}`); process.exit(2); }
const lessonName = opt('--lesson') ?? '6的乘法口诀';
const lookAt = opt('--look') ?? '例 4';

const book = { file, index: ix };
let L = lessonOpen(lessonInit(), book);
const act = (...acts) => {
  const r = fitActs(L, acts.map(([name, arg]) => ({ name, arg: arg ?? '' })), book);
  if (r.why.length) console.log(`  (${r.why.join(';')})`);
  L = r.lesson;
  return L;
};

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9361;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
const proc = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
if (!wsUrl) throw new Error('Chrome 没起来');
const ws = new WebSocket(wsUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails?.exception?.description ?? 'exception');
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
const until = async (expr, ms = 15000, every = 100) => { for (let t = 0; t < ms; t += every) { const v = await evaluate(expr); if (v) return v; await sleep(every); } return null; };
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `${base}/stage/` });
await until(`document.readyState === 'complete' && Boolean(document.querySelector('#root'))`);
await evaluate(`window.__got = []; addEventListener('message', (e) => { if (e.data && e.data.source === 'cotutor-stage' && e.data.type !== 'lesson') window.__got.push(e.data); }); true`);
const post = (l) => evaluate(`window.postMessage(${JSON.stringify({ source: 'cotutor-stage', type: 'lesson', id: 'lesson:probe', lesson: l, hand: 'right' })}, '*'), true`);
const got = (type) => evaluate(`window.__got.filter((m) => m.type === ${JSON.stringify(type)})`);
const camera = () => evaluate(`(() => { const p = document.querySelector('.bk-paper'), v = document.querySelector('.bk-view'); if (!p || !v) return null; const m = /translate\\(([-\\d.e]+)px, ([-\\d.e]+)px\\) scale\\(([-\\d.e]+)\\)/.exec(p.style.transform); const r = v.getBoundingClientRect(); return m ? { tx: +m[1], ty: +m[2], s: +m[3], left: r.left, top: r.top, w: r.width, h: r.height } : null; })()`);
const toScreen = (c, x, y) => ({ x: c.left + c.tx + x * c.s, y: c.top + c.ty + y * c.s });
const stripInfo = () => evaluate(`(() => { const g = document.querySelector('.bk-strip'); const r = g?.querySelector('.bk-strip-bg'); return { bg: r ? [+r.getAttribute('y'), +r.getAttribute('height')] : null, dots: g ? g.querySelectorAll('.bk-shape ellipse').length : 0, texts: g ? [...g.querySelectorAll('.bk-strip-text')].map((t) => t.textContent) : [], inks: g ? g.querySelectorAll(':scope > path[stroke="#2f6fd6"]').length : 0, turns: g ? g.querySelectorAll('.bk-turn').length : 0 }; })()`);

// 一、翻到这一课、看例 4、摆点阵、写一行字、请圈
await post(L);
await until(`document.querySelector('.bk-board')?.dataset.phase === 'ready'`);
await post(act(['翻', lessonName], ['看', lookAt], ['摆', '点阵 6 行 6 个'], ['写', '6×6=36'], ['请', '圈、写']));
await until(`document.querySelector('.bk-board')?.dataset.phase === 'ready' && document.querySelectorAll('.bk-strip .bk-shape ellipse').length > 0`, 20000);
await sleep(1500);
let cam = await camera();
const q = L.look.box;
const si = await stripInfo();
const qTop = toScreen(cam, 0, q[1]).y - cam.top, sTop = toScreen(cam, 0, si.bg?.[0] ?? 0).y - cam.top;
ok('白纸条:点阵 36 个、写着 6×6=36,紧贴题的下沿', si.dots === 36 && si.texts.includes('6×6=36') && si.bg && Math.abs(si.bg[0] - q[3]) < 30, JSON.stringify({ si, q }));
ok('窗口:题目放得下就顶着最上面;放不下白纸条从窗口中间偏上开始(下面至少留四成多)', sTop > 0 && sTop <= cam.h * 0.6 && (qTop >= 0 || sTop >= cam.h * 0.5), `题顶 ${Math.round(qTop)}px、白纸条顶 ${Math.round(sTop)}px / 窗高 ${Math.round(cam.h)}px`);
console.log('  截图', await shot('1-白纸条-页宽.png'));

// 二、笔在白纸条上圈一圈
const lay = await evaluate(`(() => { const e = document.querySelector('.bk-strip .bk-shape'); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
const cx = lay.x + lay.w * 0.3, cy = lay.y + lay.h * 0.12;
const pts = Array.from({ length: 20 }, (_, i) => { const a = (i / 19) * Math.PI * 2; return { x: cx + Math.cos(a) * lay.w * 0.3, y: cy + Math.sin(a) * lay.h * 0.08 }; });
await mouse('mouseMoved', pts[0].x, pts[0].y, { buttons: 0, pointerType: 'pen' });
await mouse('mousePressed', pts[0].x, pts[0].y, { pointerType: 'pen' });
for (const p of pts.slice(1)) { await mouse('mouseMoved', p.x, p.y, { pointerType: 'pen', button: 'left', buttons: 1 }); await sleep(12); }
await mouse('mouseReleased', pts[pts.length - 1].x, pts[pts.length - 1].y, { pointerType: 'pen' });
await sleep(300);
const st = (await got('stroke')).slice(-1)[0];
ok('笔在白纸条上圈一圈:报 stroke,带着白纸条', st?.strip === L.strip && st.pts.length > 5, JSON.stringify({ strip: st?.strip, n: st?.pts?.length }));
if (st) { L = lessonStep(L, { t: 'stroke', pts: st.pts, strip: st.strip }); await post(L); await sleep(300); }
ok('那一笔画在白纸条里', (await stripInfo()).inks === 1);
console.log('  截图', await shot('2-白纸条上圈.png'));

// 两倍:真机上看空位写不写得进
const dbl = async (x, y) => { for (let k = 0; k < 2; k++) { await mouse('mouseMoved', x, y, { buttons: 0 }); await mouse('mousePressed', x, y); await sleep(40); await mouse('mouseReleased', x, y); await sleep(80); } };
await dbl(500, 200);
await sleep(1500);
console.log('  截图', await shot('3-两倍.png'));
await dbl(500, 200);
await sleep(900);

// 三、看下一处:白纸条收起;回来:还在
await post(act(['看', '练一练']));
await sleep(1200);
ok('看下一处:白纸条收起来', (await stripInfo()).bg === null);
await post(act(['看', lookAt]));
await sleep(1500);
const back = await stripInfo();
ok('回到这道题:白纸条和孩子那一笔都还在', back.dots === 36 && back.inks === 1, JSON.stringify(back));

// 六(先做):给老师看,图里有白纸条
await evaluate(`window.postMessage({ source: 'cotutor-stage', type: 'control', action: 'submit' }, '*'), true`);
await until(`window.__got.some((m) => m.type === 'submit')`, 5000);
const sub = (await got('shot')).slice(-1)[0];
ok('给老师看:交的那张图里有白纸条', Boolean(sub?.image?.startsWith('data:image/jpeg')) && sub.image.length > 5000, String(sub?.image?.length));
if (sub?.image) writeFileSync(join(shots, '4-交的图.jpg'), Buffer.from(sub.image.split(',')[1], 'base64'));

// 四、擦 全部
await post(act(['擦', '全部']));
await sleep(600);
ok('擦 全部:白纸条没了', (await stripInfo()).bg === null);

// 五、方向盘、请转
await post(act(['摆', '方向盘'], ['请', '转']));
await until(`document.querySelectorAll('.bk-strip .bk-turn').length === 1`, 5000);
await sleep(800);
const tb = await evaluate(`(() => { const r = document.querySelector('.bk-strip .bk-turn circle').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await mouse('mouseMoved', tb.x, tb.y, { buttons: 0 });
await mouse('mousePressed', tb.x, tb.y);
await sleep(50);
await mouse('mouseReleased', tb.x, tb.y);
await sleep(600);
const turn = (await got('turn')).slice(-1)[0];
ok('点转钮:报 turn,转 90°', turn?.deg === 90 && /#0$/.test(turn.item), JSON.stringify(turn));
if (turn) { L = lessonStep(L, { t: 'turn', item: turn.item, deg: turn.deg }); await post(L); await sleep(400); }
console.log('  截图', await shot('5-方向盘.png'));

ok('没有脚本报错', logs.length === 0, logs.slice(0, 3).join(' | '));
console.log(`\n截图在 ${shots}`);
ws.close();
proc.kill();
process.exit(bad ? 1 : 0);

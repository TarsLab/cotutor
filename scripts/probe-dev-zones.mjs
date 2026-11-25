#!/usr/bin/env node
/**
 * 工作台「分块」页的手动验收(不进 pnpm test;要本机 Chrome、一个跑着的 serve,vault 的 教材/ 里放了课本 PDF;舞台包要打过,页图才画得出)。
 * 会写 vault 的 教材/.zones/(存一课、再还原),拿试用 workspace 跑:cotutor serve --sandbox --http --port <n>。
 * 走一遍设计稿(docs/artifact/分块/,画布 https://claude.ai/artifact/Xvt6t4pp1xkLJ6VA6GBnkR)的六张:
 *   看(页图画出来、最外一层的块带叫法)→ 选中套在里面的一块(单击落最里面、同一处再点往外一层、面包屑)→ 改念法(顶上出「没存」那条)→
 *   拉边(吸到候选、画参考线)→ 当孩子点(说落到哪)→ 存规则出的那一课(问一次、整课进 vault)→ 还原(问一次、回到规则出的);每屏截一张。
 *
 * 用法:node scripts/probe-dev-zones.mjs --base http://127.0.0.1:47123 [--book 数学] [--lesson <课名>] [--shots <目录>](没给课:挑第一课规则出的、检查干净的)
 */
import { spawn } from './_guard.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIET_ARGS } from './_quiet.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://127.0.0.1:5180');
const shots = arg('--shots', '');
const bookWant = arg('--book', '数学');
const lessonWant = arg('--lesson', '');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); if (!cond) process.exitCode = 1; };

const list = await (await fetch(`${base}/api/dev/zones`)).json();
const book = list.books.find((b) => b.file.includes(bookWant));
/** 没给 --lesson:挑第一课规则出的、检查干净的(规则出的常有同名的「做一做」,那种要先改叫法才存得了) */
let lesson = null;
for (const l of book?.lessons ?? []) {
  if (!l.leaf || (lessonWant ? !l.title.includes(lessonWant) : l.which !== 'rules')) continue;
  if (lessonWant) { lesson = l; break; }
  const d = await (await fetch(`${base}/api/dev/zones/lesson?b=${encodeURIComponent(book.file)}&l=${encodeURIComponent(l.key)}`)).json();
  const c = await (await fetch(`${base}/api/dev/zones/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: book.file, l: l.key, pages: d.pages.map((p) => p.zones) }) })).json();
  if (!c.problems.length && d.pages.some((p) => p.zones.zones.some((z) => z.children?.length))) { lesson = l; break; }
}
if (!book || !lesson) { console.error(`找不到《${bookWant}》${lessonWant ? `的「${lessonWant}」` : '里检查干净、规则出的一课'}`); process.exit(2); }
console.log(`《${book.file}》「${lesson.title}」`);
if (lesson.which !== 'rules') { console.error(`「${lesson.title}」现在用的不是规则出的(${lesson.which}),先在工作台还原再跑`); process.exit(2); }
const L = `${base}/api/dev/zones/lesson?b=${encodeURIComponent(book.file)}&l=${encodeURIComponent(lesson.key)}`;
const data = await (await fetch(L)).json();
const page = data.pages[0];

const proc = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--window-size=1440,960', '--user-data-dir=/tmp/cotutor-probe-dev-zones', `${base}/dev#zones?b=${encodeURIComponent(book.file)}&l=${encodeURIComponent(lesson.key)}&p=${page.n}`], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page' && x.url.startsWith('http'));
      if (t) return t.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 没起来');
}

const ws = new WebSocket(await target());
await new Promise((r) => { ws.onopen = r; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
const waitFor = async (expression, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(expression)) return true; await sleep(150); } return false; };
const shot = async (name) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await sleep(300);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64'));
  console.log(`  截图 ${join(shots, name)}`);
};
const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
const tap = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(120); };
/** 千分比 → 屏幕 */
const at = async (px, py) => evaluate(`(() => { const r = document.querySelector('.zn-ov').getBoundingClientRect(); return { x: r.left + r.width * ${px} / 1000, y: r.top + r.height * ${py} / 1000 }; })()`);
const clickEl = async (expr) => {
  const b = await evaluate(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!b) throw new Error('点不到 ' + expr);
  await tap(b.x, b.y);
};
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((el) => el.textContent.includes(${JSON.stringify(text)}))`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  // ---- ① 看 ----
  ok('分块页开了,左边列着这一课', await waitFor(`document.querySelector('#zones.on .zn-ls.on')?.textContent.includes(${JSON.stringify(lesson.title)})`));
  ok('页图画出来了', await waitFor(`(() => { const c = document.querySelector('.zn-page canvas'); return c && c.width > 100 && !document.querySelector('.zn-page .zn-msg'); })()`, 15000));
  ok('最外一层的块带叫法', await evaluate(`document.querySelectorAll('.zn-ov .zn-tag').length > 0`));
  ok('右边列这一页的块、检查干净', await waitFor(`document.querySelectorAll('.zn-side .zn-tr').length > 0 && /没有要改的/.test(document.querySelector('.zn-side').textContent)`));
  await shot('1-look.png');

  // ---- ② 选中套在里面的一块:找一块最深的,点它的中心;同一处再点往外一层 ----
  let deep = null, dd = -1;
  const walk = (zs, d, chain) => { for (const z of zs) { if (d > dd) { dd = d; deep = { z, chain }; } if (z.children) walk(z.children, d + 1, [...chain, z]); } };
  walk(page.zones.zones, 0, []);
  const regs = [];
  const collect = (zs) => { for (const z of zs) { for (const r of z.regions ?? []) regs.push(r); if (z.children) collect(z.children); } };
  collect(page.zones.zones);
  // 中心落在作答区里就往旁边挪:要落在块上
  const free = (z) => { for (let fx = 0.15; fx <= 0.85; fx += 0.1) for (let fy = 0.3; fy <= 0.7; fy += 0.2) { const x = z.box[0] + (z.box[2] - z.box[0]) * fx, y = z.box[1] + (z.box[3] - z.box[1]) * fy; if (!regs.some((r) => x >= r.box[0] && x <= r.box[2] && y >= r.box[1] && y <= r.box[3])) return [x, y]; } return [(z.box[0] + z.box[2]) / 2, (z.box[1] + z.box[3]) / 2]; };
  const [px, py] = free(deep.z);
  const p1 = await at(px, py);
  await tap(p1.x, p1.y);
  ok('单击落到最里面那块,面包屑带着外面几层', await waitFor(`document.querySelector('.zn-crumb b')?.textContent === ${JSON.stringify(deep.z.label)}`), deep.z.label);
  if (deep.chain.length) {
    await sleep(80);
    await tap(p1.x, p1.y);
    ok('同一处再点:往外一层', await waitFor(`document.querySelector('.zn-crumb b')?.textContent === ${JSON.stringify(deep.chain[deep.chain.length - 1].label)}`));
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), 1`);
    await tap(p1.x, p1.y);
  }
  await shot('2-select.png');

  // ---- ③ 改念法:顶上出「没存」那条 ----
  await clickEl(`document.querySelector('#zn-say')`);
  await send('Input.insertText', { text: '(试)' });
  ok('改了念法:顶上一条「改了 1 处,没存」', await waitFor(`!document.querySelector('.zn-bar').hidden && /改了 1 处/.test(document.querySelector('.zn-bar').textContent)`));

  // ---- ④ 拉边:拖选中的那块的右边,靠近一条字行的右边就吸上去 ----
  const b = deep.z.box;
  const e1 = await at(b[2], (b[1] + b[3]) / 2);
  await mouse('mouseMoved', e1.x, e1.y);
  await mouse('mousePressed', e1.x, e1.y);
  const targets = [...page.cand.lines.map((l) => l.box[2]), ...page.cand.cells.map((c) => c.box[2])].filter((v) => v > b[2] + 8 && v < b[2] + 120).sort((x, y) => x - y);
  const tx = targets[0] ?? b[2] + 30;
  const e2 = await at(tx + 3, (b[1] + b[3]) / 2);
  for (let k = 1; k <= 6; k++) { await mouse('mouseMoved', e1.x + (e2.x - e1.x) * k / 6, e1.y); await sleep(30); }
  ok('拉边:吸上去时画参考线、说吸到哪', !targets.length || await waitFor(`/吸到/.test(document.querySelector('.zn-ov .zn-gl')?.textContent || '')`), targets.length ? '' : '旁边没有能吸的边');
  await shot('4-drag.png');
  await mouse('mouseReleased', e2.x, e2.y);
  ok('松手:改了 2 处', await waitFor(`/改了 2 处/.test(document.querySelector('.zn-bar').textContent)`));
  await clickEl(byText('.zn-bar button', '撤销'));
  ok('撤销:回到 1 处', await waitFor(`/改了 1 处/.test(document.querySelector('.zn-bar').textContent)`));

  // ---- ⑤ 当孩子点 ----
  await clickEl(byText('.zn-tool .seg button', '当孩子点'));
  const write = regs.find((r) => r.kind === 'write');
  const kp = write ? await at((write.box[0] + write.box[2]) / 2, (write.box[1] + write.box[3]) / 2) : p1;
  await tap(kp.x, kp.y);
  ok('当孩子点:说落到哪(落在能写的格上就是第 1 档)', await waitFor(`document.querySelector('.zn-side .zn-hit.win') !== null || /都不是/.test(document.querySelector('.zn-side').textContent)`) && (!write || await evaluate(`document.querySelector('.zn-side .zn-hit.win .num')?.textContent === '1'`)));
  await shot('3-kid.png');
  await clickEl(byText('.zn-tool .seg button', '选块'));

  // ---- ⑥ 存规则出的那一课:问一次,整课进 vault ----
  ok('检查过了,能存', await waitFor(`!document.querySelector('.zn-bar button.primary')?.disabled`));
  await clickEl(`document.querySelector('.zn-bar button.primary')`);
  ok('存:问一次,列每页是改的还是照规则出的抄', await waitFor(`/一起写进 vault/.test(document.querySelector('.modal')?.textContent || '') && /你改的/.test(document.querySelector('.modal').textContent)`));
  await shot('5-save.png');
  await clickEl(byText('.modal button', '存这一课'));
  ok('存完:这一课用 vault 的,标工作台', await waitFor(`/工作台/.test(document.querySelector('.zn-ls.on')?.textContent || '') && document.querySelector('.zn-bar').hidden`));
  const after = await (await fetch(L)).json();
  ok('vault 里整课都在,记 workbench', after.which === 'vault' && after.pages.every((p) => p.by === 'workbench'));

  // ---- 还原 ----
  await clickEl(byText('.zn-left button', '还原成规则出的'));
  ok('还原:问一次', await waitFor(`/还原成规则出的/.test(document.querySelector('.modal')?.textContent || '')`));
  await shot('6-restore.png');
  await clickEl(byText('.modal button', '删掉,还原'));
  ok('还原完:回到规则出的', await waitFor(`/规则/.test(document.querySelector('.zn-ls.on')?.textContent || '')`));
  ok('vault 里这一课没了', (await (await fetch(L)).json()).which === 'rules');
  ok('页面没有脚本报错', errors.length === 0, errors.join(' | '));
} finally {
  ws.close();
  proc.kill();
}

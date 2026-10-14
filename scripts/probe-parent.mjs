#!/usr/bin/env node
/**
 * 家长端「记录」(《家长板书页设计.md》,拍板 22;《家长录像设计.md》拍板 16)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock → Chrome 开 /parent:七天日期条、清单(每位老师一块、语文老师一个话题、英语老师「今天没聊」)→
 * 点话题就是录像:停在最后一帧不放、经过收着,展开有原来板书页的旁注(孩子、答案、给家长、记住了)→ 退出回清单 →
 * 宽屏右栏的概要(拍板 25)→ 打星、记账、删话题 → 点昨天、往前七天 → ?tutor=&thread= 直接开那个话题的录像。手机与平板各截一张。孩子端 `/` 上没有答案(护栏)。
 *
 * 用法:node scripts/probe-parent.mjs [--out <截图目录>] [--keep](留下 mock)
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
const port = 8794;
const cdp = 9336;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);

const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-parent-'));
const shots = outAt > 0 ? process.argv[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, `${base}/parent`], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page' && t.url.startsWith('http'))?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const device = async (w, h, dsf, mobile) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile }); await sleep(400); };
  const open = async (url, ready) => { await send('Page.navigate', { url }); for (let i = 0; i < 40; i++) { if (await evaluate(ready)) break; await sleep(250); } await sleep(300); };
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);

  // ---- 清单 ----
  await device(390, 844, 2, true);
  await open(`${base}/parent`, `document.querySelectorAll('.pt').length > 0`);
  const list = await evaluate(`(() => ({ title: document.title, date: document.querySelector('#pweek .dy.on small')?.textContent, days: document.querySelectorAll('#pweek .dy').length, dots: document.querySelectorAll('#pweek .dy.on .wd i').length, tutors: [...document.querySelectorAll('.pt')].map((b) => ({ who: b.dataset.tutor, rows: [...b.querySelectorAll('.tr')].map((r) => r.textContent), none: b.querySelector('.none')?.textContent })), more: document.querySelector('#more-btn').hidden, pane: getComputedStyle(document.querySelector('#pdetail')).display }))()`);
  ok('清单:标题带「家长」;七天日期条停在今天、今天有点;四位老师(含口播老师);语文老师一个话题,对话、停下等孩子;英语老师今天没聊;窄屏没有右栏', list.title.endsWith('· 家长') && list.date === '今天' && list.days === 7 && list.dots > 0 && list.tutors.length === 4 && list.tutors[0].rows.length === 1 && list.tutors[0].rows[0].startsWith('对话') && list.tutors[0].rows[0].includes('停下等孩子') && list.tutors[2].none === '今天没聊' && list.pane === 'none', JSON.stringify(list));
  console.log('  ', await shot('parent-list-phone.png'));

  // ---- 点话题:就是录像,停在最后一帧(拍板 16) ----
  await evaluate(`document.querySelector('.pt[data-tutor="chinese-tutor"] .tr').click()`);
  for (let i = 0; i < 40; i++) { if (await evaluate(`document.body.classList.contains('reel') && !document.querySelector('#reel').hidden && (document.querySelector('#rl-frame').contentDocument?.querySelectorAll('#board .sec').length ?? 0) > 0`)) break; await sleep(250); }
  await sleep(500);
  const rl = await evaluate(`({ src: document.querySelector('#rl-frame').getAttribute('src'), v: Number(document.querySelector('#rl-seek').value), max: Number(document.querySelector('#rl-seek').max), play: document.querySelector('#rl-play').getAttribute('aria-label'), log: document.querySelector('#rl-log').hidden, board: getComputedStyle(document.querySelector('#wrap')).display, notes: document.querySelectorAll('.notes').length })`);
  ok('点话题:直接是录像,停在最后一帧不放;经过收着;家长页上没有板书与旁注', rl.src.includes('end=1') && rl.max > 0 && rl.v >= rl.max - 100 && rl.play === '播放' && rl.log && rl.board === 'none' && rl.notes === 0, JSON.stringify(rl));
  await evaluate(`document.querySelector('#rl-more').click()`);
  await sleep(300);
  const chips = await evaluate(`[...document.querySelectorAll('#rl-log li .rl-k')].map((x) => x.textContent)`);
  ok('经过展开:原来板书页的旁注都在(孩子、答案、给家长、记住了)', ['孩子', '答案', '给家长', '记住了'].every((x) => chips.includes(x)), JSON.stringify(chips));
  console.log('  ', await shot('parent-reel-phone.png'));
  await evaluate(`document.querySelector('#rl-more').click()`);
  await device(1180, 820, 1, false);
  await sleep(400);
  console.log('  ', await shot('parent-reel-tablet.png'));
  await evaluate(`document.querySelector('#rl-x').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`!document.querySelector('#tutor').classList.contains('on')`)) break; await sleep(250); }
  ok('退出:回到清单', await evaluate(`!document.body.classList.contains('reel') && document.querySelectorAll('.pt .tr').length > 0`));

  // ---- 宽屏:清单与右栏概要并排(拍板 25),点一行只是选中,「看录像」才进录像 ----
  for (let i = 0; i < 40; i++) { if (await evaluate(`document.querySelectorAll('#pdetail .ds').length > 0`)) break; await sleep(250); }
  await evaluate(`document.querySelector('.pt[data-tutor="chinese-tutor"] .tr').click()`);
  await sleep(400);
  const pane = await evaluate(`({ shown: getComputedStyle(document.querySelector('#pdetail')).display, sel: document.querySelectorAll('.pt .tr.on').length, reel: document.body.classList.contains('reel'), heads: [...document.querySelectorAll('#pdetail .ds h3')].map((x) => x.textContent), lines: document.querySelectorAll('#pdetail .pv-l').length, marks: document.querySelectorAll('#pdetail .pv-tl i').length, rowStars: getComputedStyle(document.querySelector('.pt .tr .stars')).display, del: document.querySelector('#pdetail .del')?.textContent })`);
  ok('宽屏:右栏有概要(老师最后说的、进度条上的点、给家长的、记住了、删掉这个话题);点一行只选中、不进录像;行上不放星与删', pane.shown === 'flex' && pane.sel === 1 && !pane.reel && pane.heads.includes('给家长的') && pane.heads.includes('记住了') && pane.lines > 0 && pane.marks > 0 && pane.rowStars === 'none' && pane.del === '删掉这个话题', JSON.stringify(pane));
  const nulls = [];
  for (let k = 0; k < await evaluate(`document.querySelectorAll('.pt .tr:not(.tr-x)').length`); k++) {
    await evaluate(`document.querySelectorAll('.pt .tr:not(.tr-x)')[${k}].click()`);
    for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelectorAll('#pdetail .pv-l').length > 0`)) break; await sleep(250); }
    nulls.push(await evaluate(`/null|undefined/.test(document.querySelector('#pdetail').textContent)`));
  }
  ok('宽屏:每个话题的右栏里都没有字「null」「undefined」', nulls.length > 1 && nulls.every((x) => !x), JSON.stringify(nulls));
  await evaluate(`document.querySelector('.pt[data-tutor="chinese-tutor"] .tr').click()`);
  await sleep(400);
  console.log('  ', await shot('parent-list-tablet.png'));
  await evaluate(`document.querySelector('#pdetail .pv').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.body.classList.contains('reel')`)) break; await sleep(250); }
  ok('宽屏:点「看录像」进录像', await evaluate(`document.body.classList.contains('reel') && (document.querySelector('#rl-frame').getAttribute('src') || '').includes('end=1')`));
  await evaluate(`document.querySelector('#rl-x').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`!document.querySelector('#tutor').classList.contains('on')`)) break; await sleep(250); }
  await device(390, 844, 2, true);

  // ---- 回清单:打星;翻到昨天 ----
  await evaluate(`document.querySelector('.pt[data-tutor="chinese-tutor"] .stars .st:nth-child(4)').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelectorAll('.pt[data-tutor="chinese-tutor"] .stars .st.on').length === 4`)) break; await sleep(250); }
  ok('清单上打星:点第四颗 → 亮四颗', await evaluate(`document.querySelectorAll('.pt[data-tutor="chinese-tutor"] .stars .st.on').length === 4`));
  // 记账:顶上的「记账」两下确认 → 每位老师 POST bookkeep(mock 立刻记上)→ 行上「已记账」、按钮灰
  const bk0 = await evaluate(`(() => { const b = document.querySelector('#pbook .book'); b.click(); return { text: b.textContent, disabled: b.disabled }; })()`);
  await evaluate(`document.querySelector('#pbook .book').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`[...document.querySelectorAll('.pt .tr .chip')].some((s) => s.textContent === '已记账')`)) break; await sleep(250); }
  const bk1 = await evaluate(`({ booked: [...document.querySelectorAll('.pt .tr .chip')].filter((s) => s.textContent === '已记账').length, disabled: document.querySelector('#pbook .book').disabled, hint: document.querySelector('#pbook span').textContent })`);
  ok('记账:第一下「确定记?要花钱」,第二下记上 → 两个话题「已记账」,按钮灰(没有要记的了)', bk0.text === '确定记?要花钱' && !bk0.disabled && bk1.booked === 2 && bk1.disabled && bk1.hint === '话题都记进日记了', JSON.stringify({ bk0, bk1 }));
  // 删话题:点一下只是变「确定删?」,再点才删;删完那位老师块下「今天没聊」
  const armed = await evaluate(`(() => { const b = document.querySelector('.pt[data-tutor="math-tutor"] .tr .del'); b.click(); return { text: b.textContent, rows: document.querySelectorAll('.pt[data-tutor="math-tutor"] .tr').length }; })()`);
  await evaluate(`document.querySelector('.pt[data-tutor="math-tutor"] .tr .del').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelector('.pt[data-tutor="math-tutor"] .none') !== null`)) break; await sleep(250); }
  const gone = await evaluate(`({ rows: document.querySelectorAll('.pt[data-tutor="math-tutor"] .tr').length, none: document.querySelector('.pt[data-tutor="math-tutor"] .none')?.textContent })`);
  ok('删话题:第一下只是「确定删?」、行还在;第二下删掉,数学老师块「今天没聊」', armed.text === '确定删?' && armed.rows === 1 && gone.rows === 0 && gone.none === '今天没聊', JSON.stringify({ armed, gone }));
  await evaluate(`document.querySelectorAll('#pweek .dy')[5].click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelectorAll('#pweek .dy')[5]?.classList.contains('on')`)) break; await sleep(250); }
  const y = await evaluate(`(() => ({ day: document.querySelector('#pweek .dy.on small')?.textContent, today: document.querySelectorAll('#pweek .dy')[6].querySelector('small').textContent, rows: [...document.querySelectorAll('.pt .tr b')].map((b) => b.textContent), next: document.querySelector('#pweek .nv:last-child').disabled }))()`);
  ok('点昨天:以前的话题在;日期条还是以今天结尾的七天,「往后七天」灰', /^周/.test(y.day) && y.today === '今天' && y.rows.some((r) => r.includes('昨天问的')) && y.next, JSON.stringify(y));
  await evaluate(`document.querySelector('#pweek .nv').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`!document.querySelector('#pweek .nv:last-child').disabled`)) break; await sleep(250); }
  const w = await evaluate(`({ last: document.querySelectorAll('#pweek .dy')[6].querySelector('small').textContent, on: document.querySelectorAll('#pweek .dy.on').length })`);
  ok('「往前七天」:翻到上一段,今天不在条上,「往后七天」能点', w.last !== '今天' && w.on === 1, JSON.stringify(w));

  // ---- 直接开某个话题的录像(重载回来靠它) ----
  const ov = await (await fetch(`${base}/api/overview/today`)).json();
  const th = ov.tutors.find((t) => t.name === 'chinese-tutor')?.threads[0]?.thread;
  await open(`${base}/parent?tutor=chinese-tutor&thread=${th}`, `document.body.classList.contains('reel') && !document.querySelector('#reel').hidden`);
  ok('?tutor=&thread= 直接开那个话题的录像', await evaluate(`document.body.classList.contains('reel') && (document.querySelector('#rl-frame').getAttribute('src') || '').includes('thread=${th}')`), String(th));

  // ---- 护栏:孩子端没有旁注、没有答案 ----
  await open(`${base}/?tutor=chinese-tutor`, `document.querySelectorAll('#board .sec').length > 0`);
  const kid = await evaluate(`({ ans: /答案/.test(document.querySelector('#board').innerText), pill: document.querySelector('#pill').hidden, more: document.querySelector('#more-btn').hidden })`);
  ok('孩子端:没有答案、输入条与「更多」都在', !kid.ans && !kid.pill && !kid.more, JSON.stringify(kid));
} finally {
  browser?.kill();
  await sleep(600); // Chrome 退出还在写 profile,立刻删会 ENOTEMPTY
  if (!keep) { mock.kill(); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  else console.log(`留下了:mock 在 ${base}(pid ${mock.pid}),截图在 ${shots}`);
}

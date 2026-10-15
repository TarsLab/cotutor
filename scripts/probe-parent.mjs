#!/usr/bin/env node
/**
 * 家长端「记录」(《家长板书页设计.md》,拍板 22;《家长录像设计.md》拍板 16)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock → 开一次听写写一个词 → Chrome 开 /parent:七天日期条、一天一条时间线(卡照搬孩子端、听写格子画笔迹)、「这一天老师跟你说的」→
 * 点话题就是录像:停在最后一帧不放、经过收着,展开有原来板书页的旁注(孩子、答案、给家长、记住了)→ 退出回清单 →
 * 宽屏两栏(拍板 31)→ 打星、记账、删话题 → 点昨天、往前七天 → ?tutor=&thread= 直接开那个话题的录像。手机与平板各截一张。孩子端 `/` 上没有答案(护栏)。
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

  // ---- 先开一次听写、写一个词(格子里要画孩子的笔迹,拍板 32) ----
  const kh = await (await fetch(`${base}/api/kid/home`)).json();
  const ds = await (await fetch(`${base}/api/dictation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ home: kh.home, n: 0 }) })).json();
  const stroke = [[220, 700, 0], [500, 690, 60], [800, 680, 120]];
  const wr = await fetch(`${base}/api/dictation/${ds.id}/first/0`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chars: Array.from({ length: ds.sizes[0] }, () => ({ strokes: [stroke], undos: 0 })) }) });
  ok('开一次听写、写了第一个词', wr.ok, String(wr.status));

  // ---- 记录:一天一条时间线(拍板 29、30) ----
  await device(390, 844, 2, true);
  await open(`${base}/parent`, `document.querySelectorAll('#ptl .pev').length > 2`);
  const ev = (who) => `[...document.querySelectorAll('#ptl .pev')].find((e) => e.querySelector('.pv-who')?.textContent.endsWith('${who}') && e.querySelector('.bt-new'))`;
  const list = await evaluate(`(() => ({ title: document.title, date: document.querySelector('#pweek .dy.on small')?.textContent, days: document.querySelectorAll('#pweek .dy').length, dots: document.querySelectorAll('#pweek .dy.on .wd i').length,
    evs: [...document.querySelectorAll('#ptl .pev')].map((e) => ({ who: e.querySelector('.pv-who').lastChild.textContent, at: e.querySelector('.pv-tm').textContent, look: e.querySelector('.kid .bt').className, btx: e.querySelector('.kid .btx')?.textContent, pf: e.querySelector('.pf').textContent })),
    ink: document.querySelectorAll('#ptl .bt-x-dictation .dg i svg path').length, kidCss: getComputedStyle(document.querySelector('#ptl .bt-new')).borderRadius, day: document.querySelector('#pday')?.textContent, more: document.querySelector('#more-btn').hidden }))()`);
  const sorted = list.evs.every((e, i, a) => !i || a[i - 1].at.slice(0, 5) <= e.at.slice(0, 5));
  ok('时间线:标题带「家长」;七天日期条停在今天;语文、数学两个新话题 + 一次听写,从早到晚;新话题是孩子端的气泡(.bt-new,同一份样式),行尾「停下等孩子」', list.title.endsWith('· 家长') && list.date === '今天' && list.days === 7 && list.dots > 0 && list.evs.length === 3 && sorted && list.evs.filter((e) => e.look.includes('bt-new') && e.btx === '新话题' && e.pf.includes('停下等孩子')).length === 2 && list.evs.some((e) => e.look.includes('bt-x-dictation')) && list.kidCss === '24px', JSON.stringify(list.evs));
  ok('听写的格子里画着孩子写的(拍板 32)', list.ink >= 1, String(list.ink));
  ok('窄屏:「这一天老师跟你说的」接在后面,有给家长的、记住了、记账', /老师跟你说的/.test(list.day) && list.day.includes('给家长的') && list.day.includes('记住了') && list.day.includes('记账') && !/null|undefined/.test(list.day), list.day);
  console.log('  ', await shot('parent-list-phone.png'));

  // ---- 点一件就是录像,停在最后一帧(拍板 16、30) ----
  await evaluate(`${ev('语文老师')}.querySelector('.kid').click()`);
  for (let i = 0; i < 40; i++) { if (await evaluate(`document.body.classList.contains('reel') && !document.querySelector('#reel').hidden && (document.querySelector('#rl-frame').contentDocument?.querySelectorAll('#board .sec').length ?? 0) > 0`)) break; await sleep(250); }
  await sleep(500);
  const rl = await evaluate(`({ src: document.querySelector('#rl-frame').getAttribute('src'), v: Number(document.querySelector('#rl-seek').value), max: Number(document.querySelector('#rl-seek').max), play: document.querySelector('#rl-play').getAttribute('aria-label'), log: document.querySelector('#rl-log').hidden, board: getComputedStyle(document.querySelector('#wrap')).display, notes: document.querySelectorAll('.notes').length })`);
  ok('点一件:直接是录像,停在最后一帧不放;经过收着;家长页上没有板书与旁注', rl.src.includes('end=1') && rl.max > 0 && rl.v >= rl.max - 100 && rl.play === '播放' && rl.log && rl.board === 'none' && rl.notes === 0, JSON.stringify(rl));
  await evaluate(`document.querySelector('#rl-more').click()`);
  await sleep(300);
  const chips = await evaluate(`[...document.querySelectorAll('#rl-log li .rl-k')].map((x) => x.textContent)`);
  ok('经过展开:原来板书页的旁注都在(孩子、答案、给家长、记住了)', ['孩子', '答案', '给家长', '记住了'].every((x) => chips.includes(x)), JSON.stringify(chips));
  console.log('  ', await shot('parent-reel-phone.png'));
  await evaluate(`document.querySelector('#rl-more').click()`);
  await device(1180, 820, 1, false);
  await sleep(400);
  const dark = await evaluate(`(() => { const x = document.querySelector('#rl-x').getBoundingClientRect(), sc = document.querySelector('#rl-screen').getBoundingClientRect(); return { dark: document.documentElement.classList.contains('rl-dark'), bg: getComputedStyle(document.body).backgroundColor, x: [Math.round(x.left), Math.round(x.top), Math.round(x.bottom)], above: x.bottom <= sc.top, ttl: document.querySelector('#rl-ttl').textContent, fill: document.querySelector('#rl-seek').style.getPropertyValue('--fill') }; })()`);
  ok('录像深底(《家长录像设计.md》拍板 20):整页深色,「退出录像」在孩子屏幕外的左上角,旁边写哪位老师的哪件事;进度条走过的那段跟着写', dark.dark && dark.bg === 'rgb(28, 28, 28)' && dark.x[0] < 40 && dark.above && dark.ttl.startsWith('语文老师 · 新话题') && dark.fill === '100.00%', JSON.stringify(dark));
  console.log('  ', await shot('parent-reel-tablet.png'));
  // 快捷键(《家长录像设计.md》拍板 22):? 一张表、Esc 关上;空格放 / 停;上一章(只有一章)回开头;Esc 退出
  const key = async (k, code) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, ...(type === 'keyDown' && k.length === 1 ? { text: k } : {}) }); await sleep(300); };
  await key('?', 'Slash');
  const kz = await evaluate(`!document.querySelector('#rl-keys').hidden && document.querySelector('#rl-keys').textContent.includes('上一章,落在那一章讲完')`);
  await key('Escape', 'Escape');
  ok('快捷键:? 打开那张表,Esc 关上(还在录像里)', kz && await evaluate(`document.querySelector('#rl-keys').hidden && document.body.classList.contains('reel')`));
  await key(' ', 'Space');
  const sp1 = await evaluate(`document.querySelector('#rl-play').getAttribute('aria-label')`);
  await key(' ', 'Space');
  const sp2 = await evaluate(`document.querySelector('#rl-play').getAttribute('aria-label')`);
  ok('空格:放,再按停', sp1 === '暂停' && sp2 === '播放', sp1 + ' / ' + sp2);
  // 在末尾放会从头放:停下时在开头附近,先 End 回最后一帧
  await key('End', 'End');
  const pr0 = await evaluate(`({ v: Number(document.querySelector('#rl-seek').value), max: Number(document.querySelector('#rl-seek').max) })`);
  ok('End:回到最后一帧', pr0.v >= pr0.max - 100, JSON.stringify(pr0));
  await evaluate(`document.querySelector('#rl-prev').click()`);
  await sleep(300);
  ok('上一章:只有一章,回到开头;下一章能点', await evaluate(`Number(document.querySelector('#rl-seek').value) === 0 && !document.querySelector('#rl-next').disabled && document.querySelector('#rl-prev').disabled`), JSON.stringify({ pr0, after: await evaluate(`({ v: document.querySelector('#rl-seek').value, prev: document.querySelector('#rl-prev').disabled, next: document.querySelector('#rl-next').disabled })`) }));
  await evaluate(`document.querySelector('#rl-next').click()`);
  await sleep(300);
  ok('下一章:落在这一章讲完 = 末尾', await evaluate(`Number(document.querySelector('#rl-seek').value) >= Number(document.querySelector('#rl-seek').max) - 100`));
  await key('Escape', 'Escape');
  for (let i = 0; i < 20; i++) { if (await evaluate(`!document.querySelector('#tutor').classList.contains('on')`)) break; await sleep(250); }
  ok('退出:Esc 回到记录,深底去掉', await evaluate(`!document.body.classList.contains('reel') && document.querySelectorAll('#ptl .pev').length > 0 && !document.documentElement.classList.contains('rl-dark')`));

  // ---- 宽屏:时间线与「这一天」并排(拍板 31),卡上有的右栏不重复 ----
  await sleep(400);
  const wide = await evaluate(`({ cols: getComputedStyle(document.querySelector('#pcols')).display, side: document.querySelector('#pday').getBoundingClientRect().left > document.querySelector('#ptl').getBoundingClientRect().right - 5, stars: document.querySelectorAll('#pday .stars').length, dels: document.querySelectorAll('#pday .del').length, books: document.querySelectorAll('.book').length, inBook: !!document.querySelector('#pday .book'), text: document.querySelector('#pday').textContent })`);
  ok('宽屏:两栏,「这一天」在右;右栏没有星和删,「记账」只有一颗、在右栏', wide.cols === 'grid' && wide.side && wide.stars === 0 && wide.dels === 0 && wide.books === 1 && wide.inBook && !/null|undefined/.test(wide.text), JSON.stringify(wide));
  console.log('  ', await shot('parent-list-tablet.png'));
  await device(390, 844, 2, true);

  // ---- 打星、记账、删话题 ----
  await evaluate(`${ev('语文老师')}.querySelector('.stars .st:nth-child(4)').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`${ev('语文老师')}?.querySelectorAll('.stars .st.on').length === 4`)) break; await sleep(250); }
  ok('打星:点第四颗 → 亮四颗', await evaluate(`${ev('语文老师')}.querySelectorAll('.stars .st.on').length === 4`));
  const bk0 = await evaluate(`(() => { const b = document.querySelector('#pday .book'); b.click(); return { text: b.textContent, disabled: b.disabled }; })()`);
  await evaluate(`document.querySelector('#pday .book').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`[...document.querySelectorAll('#ptl .pf .chip')].filter((s) => s.textContent === '已记账').length === 2`)) break; await sleep(250); }
  const bk1 = await evaluate(`({ booked: [...document.querySelectorAll('#ptl .pf .chip')].filter((s) => s.textContent === '已记账').length, disabled: document.querySelector('#pday .book').disabled, hint: document.querySelector('#pday .dia span').textContent })`);
  ok('记账:第一下「确定记?要花钱」,第二下记上 → 两件「已记账」,按钮灰', bk0.text === '确定记?要花钱' && !bk0.disabled && bk1.booked === 2 && bk1.disabled && bk1.hint === '话题都记进日记了', JSON.stringify({ bk0, bk1 }));
  const armed = await evaluate(`(() => { const b = ${ev('数学老师')}.querySelector('.del'); b.click(); return { text: b.textContent }; })()`);
  await evaluate(`${ev('数学老师')}.querySelector('.del').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`!${ev('数学老师')}`)) break; await sleep(250); }
  ok('删话题:第一下只是「确定删?」;第二下删掉,数学老师那件从时间线上没了', armed.text === '确定删?' && await evaluate(`!${ev('数学老师')}`), JSON.stringify(armed));
  await evaluate(`document.querySelectorAll('#pweek .dy')[5].click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelectorAll('#pweek .dy')[5]?.classList.contains('on') && document.querySelector('#ptl').textContent.includes('昨天问的')`)) break; await sleep(250); }
  const y = await evaluate(`(() => ({ day: document.querySelector('#pweek .dy.on small')?.textContent, today: document.querySelectorAll('#pweek .dy')[6].querySelector('small').textContent, tl: document.querySelector('#ptl').textContent, next: document.querySelector('#pweek .nv:last-child').disabled }))()`);
  ok('点昨天:以前的话题在;日期条还是以今天结尾的七天,「往后七天」灰', /^周/.test(y.day) && y.today === '今天' && y.tl.includes('昨天问的') && y.next, JSON.stringify(y));
  await evaluate(`document.querySelector('#pweek .nv').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`!document.querySelector('#pweek .nv:last-child').disabled`)) break; await sleep(250); }
  const w = await evaluate(`({ last: document.querySelectorAll('#pweek .dy')[6].querySelector('small').textContent, on: document.querySelectorAll('#pweek .dy.on').length, none: document.querySelector('#ptl .none')?.textContent })`);
  ok('「往前七天」:翻到上一段,今天不在条上;那天没聊', w.last !== '今天' && w.on === 1 && w.none === '这天没聊', JSON.stringify(w));

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

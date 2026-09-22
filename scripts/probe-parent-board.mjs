#!/usr/bin/env node
/**
 * 家长板书页(《家长板书页设计.md》)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock → Chrome 开 /parent:清单(每位老师一块、语文老师一个话题、英语老师「今天没聊」)→
 * 点话题进板书:卡锁着、没有「更多」、喇叭缺省关、节前有「孩子」旁注、节尾有「给家长」「记住了」、选择题下面有答案 →
 * 家长真发一条(输入条在,进孩子的对话,节前「家长」)→ 回清单打星 → 昨天的清单 → 手机与平板各截一张 →
 * 试用(清单上「试一试」→ 发一条 → 节尾有费用与「本来会记住的」→ 回清单「试过的」)。孩子端 `/` 上没有旁注、没有答案(护栏)。
 *
 * 用法:node scripts/probe-parent-board.mjs [--out <截图目录>] [--keep](留下 mock)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, `${base}/parent`], { stdio: 'ignore' });
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

  // ---- 清单 ----
  await device(390, 844, 2, true);
  await open(`${base}/parent`, `document.querySelectorAll('.pt').length > 0`);
  const list = await evaluate(`(() => ({ title: document.title, date: document.querySelector('#pdate b')?.textContent, tutors: [...document.querySelectorAll('.pt')].map((b) => ({ who: b.dataset.tutor, rows: [...b.querySelectorAll('.tr')].map((r) => r.querySelector('small').textContent), none: b.querySelector('.none')?.textContent })), more: document.querySelector('#more-btn').hidden }))()`);
  ok('清单:标题带「家长」、今天;三位老师;语文老师一个话题停在末句问句;英语老师今天没聊', list.title.endsWith('· 家长') && list.date === '今天' && list.tutors.length === 3 && list.tutors[0].rows.length === 1 && list.tutors[0].rows[0].includes('停下等孩子') && list.tutors[2].none === '今天没聊', JSON.stringify(list));
  console.log('  ', await shot('parent-list-phone.png'));

  // ---- 点话题进板书 ----
  await evaluate(`document.querySelector('.pt[data-tutor="chinese-tutor"] .tr').click()`);
  for (let i = 0; i < 40; i++) { if (await evaluate(`document.querySelectorAll('#board .notes.pre').length > 0 && document.querySelectorAll('#board .sec').length > 0`)) break; await sleep(250); }
  await sleep(500);
  const board = await evaluate(`(() => ({
    on: document.querySelector('#tutor').classList.contains('on'),
    pill: document.querySelector('#pill').hidden, backToday: document.querySelector('#back-today').hidden, more: document.querySelector('#more-btn').hidden,
    spk: document.querySelector('#spk').classList.contains('on'),
    mo: document.querySelector('#c-mo').textContent,
    order: [...document.querySelectorAll('#board > *')].map((el) => (el.classList.contains('sec') ? 'sec' : el.classList.contains('notes') ? 'notes.' + el.classList[1] : el.className)),
    pre: [...document.querySelectorAll('#board .notes.pre .note')].map((n) => n.querySelector('.tg').textContent + ':' + n.querySelector('.tx').textContent),
    post: [...document.querySelectorAll('#board .notes.post .note')].map((n) => n.querySelector('.tg').textContent),
    ans: [...document.querySelectorAll('#board .c .note-ans')].map((n) => n.textContent),
  }))()`);
  ok('板书:看的 chrome(今天有输入条与相机、没有「回到今天」、没有「更多」),喇叭缺省关,头上是「今天 时间」', board.on && !board.pill && board.backToday && board.more && !board.spk && /^今天 · \d\d:\d\d$/.test(board.mo), JSON.stringify({ pill: board.pill, backToday: board.backToday, more: board.more, spk: board.spk, mo: board.mo }));
  const locked = await evaluate(`(() => { const c = document.querySelector('#board .c-choice'); c.click(); return { stage: document.querySelector('#stage').classList.contains('on'), cam: document.querySelector('#cam').hidden }; })()`);
  ok('卡锁着:点选择题不开舞台;相机在', !locked.stage && !locked.cam, JSON.stringify(locked));
  ok('顺序:节前旁注 → 节 → 节尾旁注', board.order.slice(0, 3).join('|') === 'notes.pre|sec|notes.post', JSON.stringify(board.order));
  ok('节前:孩子的话;节尾:给家长、记住了', board.pre.length === 1 && board.pre[0].startsWith('孩子:') && board.post.join() === '给家长,记住了', JSON.stringify({ pre: board.pre, post: board.post }));
  ok('选择题下面一行答案', board.ans.length === 1 && board.ans[0].startsWith('答案:'), JSON.stringify(board.ans));
  console.log('  ', await shot('parent-board-phone.png'));
  await device(1180, 820, 1, false);
  await sleep(400);
  console.log('  ', await shot('parent-board-tablet.png'));

  // ---- 家长真发(第六节 3):走页面自己的输入条,进孩子的对话;节前「家长」 ----
  await device(390, 844, 2, true);
  const nBefore = await evaluate(`document.querySelectorAll('#board .sec').length`);
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '家长补一句'; document.querySelector('#go').click(); return true; })()`);
  for (let i = 0; i < 60; i++) { if (await evaluate(`document.querySelectorAll('#board .sec').length > ${nBefore} && [...document.querySelectorAll('#board .notes.pre .note')].some((n) => n.textContent.includes('家长补一句'))`)) break; await sleep(250); }
  const sent = await evaluate(`({ secs: document.querySelectorAll('#board .sec').length, pre: [...document.querySelectorAll('#board .notes.pre .note')].map((n) => n.querySelector('.tg').textContent + ':' + n.querySelector('.tx').textContent).slice(-1)[0] })`);
  ok('家长发了一条 → 多一节,节前「家长:家长补一句」', sent.secs === nBefore + 1 && sent.pre === '家长:家长补一句', JSON.stringify(sent));
  console.log('  ', await shot('parent-send-phone.png'));

  // ---- 回清单:打星;翻到昨天 ----
  await evaluate(`document.querySelector('#back').click()`);
  await sleep(500);
  await evaluate(`document.querySelector('.pt[data-tutor="chinese-tutor"] .stars .st:nth-child(4)').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelectorAll('.pt[data-tutor="chinese-tutor"] .stars .st.on').length === 4`)) break; await sleep(250); }
  ok('清单上打星:点第四颗 → 亮四颗', await evaluate(`document.querySelectorAll('.pt[data-tutor="chinese-tutor"] .stars .st.on').length === 4`));
  // 记账:顶上的「记账」两下确认 → 每位老师 POST bookkeep(mock 立刻记上)→ 行上「已记账」、按钮灰
  const bk0 = await evaluate(`(() => { const b = document.querySelector('#pdate .book'); b.click(); return { text: b.textContent, disabled: b.disabled }; })()`);
  await evaluate(`document.querySelector('#pdate .book').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`[...document.querySelectorAll('.pt .tr small')].some((s) => s.textContent.includes('已记账'))`)) break; await sleep(250); }
  const bk1 = await evaluate(`({ booked: [...document.querySelectorAll('.pt .tr small')].filter((s) => s.textContent.includes('已记账')).length, disabled: document.querySelector('#pdate .book').disabled })`);
  ok('记账:第一下「确定记?要花钱」,第二下记上 → 两个话题「已记账」,按钮灰(没有要记的了)', bk0.text === '确定记?要花钱' && !bk0.disabled && bk1.booked === 2 && bk1.disabled, JSON.stringify({ bk0, bk1 }));
  // 删话题:点一下只是变「确定删?」,再点才删;删完那位老师块下「今天没聊」
  const armed = await evaluate(`(() => { const b = document.querySelector('.pt[data-tutor="math-tutor"] .tr .del'); b.click(); return { text: b.textContent, rows: document.querySelectorAll('.pt[data-tutor="math-tutor"] .tr').length }; })()`);
  await evaluate(`document.querySelector('.pt[data-tutor="math-tutor"] .tr .del').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelector('.pt[data-tutor="math-tutor"] .none') !== null`)) break; await sleep(250); }
  const gone = await evaluate(`({ rows: document.querySelectorAll('.pt[data-tutor="math-tutor"] .tr').length, none: document.querySelector('.pt[data-tutor="math-tutor"] .none')?.textContent })`);
  ok('删话题:第一下只是「确定删?」、行还在;第二下删掉,数学老师块「今天没聊」', armed.text === '确定删?' && armed.rows === 1 && gone.rows === 0 && gone.none === '今天没聊', JSON.stringify({ armed, gone }));
  await evaluate(`document.querySelector('#pdate button').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelector('#pdate b')?.textContent.startsWith('昨天')`)) break; await sleep(250); }
  const y = await evaluate(`(() => ({ date: document.querySelector('#pdate b')?.textContent, rows: [...document.querySelectorAll('.pt .tr b')].map((b) => b.textContent), next: document.querySelector('#pdate button:last-child').disabled }))()`);
  ok('昨天的清单:以前的话题在,「后一天」能点', y.date.startsWith('昨天') && y.rows.some((r) => r.startsWith('昨天问的')) && !y.next, JSON.stringify(y));

  // ---- 直接开在某个话题上(重载回来靠它) ----
  await open(`${base}/parent?tutor=math-tutor`, `document.querySelector('#tutor').classList.contains('on') && document.querySelectorAll('#board .notes.pre').length > 0`);
  ok('?tutor= 直接开在那位老师今天的话题上', await evaluate(`document.querySelector('#tutor').classList.contains('on') && document.querySelector('#c-av').textContent.length > 0`));

  // ---- 试用(§5):清单上「试一试」→ try=1:输入条在、没有相机、「更多」在;发一条(直接打接口)→ 板书出来、头上亮「试用」、节尾有费用与「本来会记住的」;清单里「试过的」 ----
  await open(`${base}/parent`, `document.querySelectorAll('.pt').length > 0`);
  await evaluate(`document.querySelector('.pt[data-tutor="english-tutor"] .try').click()`);
  for (let i = 0; i < 40; i++) { if (await evaluate(`location.search.includes('try=1') && document.querySelector('#tutor')?.classList.contains('on')`)) break; await sleep(250); }
  await sleep(300);
  const tryChrome = await evaluate(`({ pill: document.querySelector('#pill').hidden, cam: document.querySelector('#cam').hidden, more: document.querySelector('#more-btn').hidden, spk: document.querySelector('#spk').classList.contains('on'), mo: document.querySelector('#c-mo').textContent, blank: document.querySelector('#board .blank b')?.textContent, redo: document.querySelector('#new-btn .tx b').textContent })`);
  ok('试用:空白老师页,输入条在、相机藏、「更多」在(重来),喇叭缺省开,头上「试用 · 不进孩子的对话」', !tryChrome.pill && tryChrome.cam && !tryChrome.more && tryChrome.spk && tryChrome.mo === '试用 · 不进孩子的对话' && tryChrome.blank === '想问什么?' && tryChrome.redo === '重来', JSON.stringify(tryChrome));
  // 走页面自己的输入条(#go 读 #typed 的字调 send):直接打接口的话页面还停在新话题空白态,不会去铺这一节
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '试试新讲法'; document.querySelector('#go').click(); return true; })()`);
  for (let i = 0; i < 60; i++) { if (await evaluate(`[...document.querySelectorAll('#board .notes.post .note .tg')].some((t) => t.textContent === '费用')`)) break; await sleep(250); }
  const tryBoard = await evaluate(`({ secs: document.querySelectorAll('#board .sec').length, pre: [...document.querySelectorAll('#board .notes.pre .note')].map((n) => n.querySelector('.tg').textContent + ':' + n.querySelector('.tx').textContent), post: [...document.querySelectorAll('#board .notes.post .note .tg')].map((t) => t.textContent), mo: document.querySelector('#c-mo').textContent })`);
  ok('试用:发了一条 → 一节板书,节前「家长」,节尾「本来会记住的」「费用」,头上仍是「试用」', tryBoard.secs === 1 && tryBoard.pre[0] === '家长:试试新讲法' && tryBoard.post.includes('本来会记住的') && tryBoard.post.includes('费用') && tryBoard.mo.startsWith('试用'), JSON.stringify(tryBoard));
  console.log('  ', await shot('parent-try-phone.png'));
  await evaluate(`document.querySelector('#back').click()`);
  for (let i = 0; i < 20; i++) { if (await evaluate(`document.querySelectorAll('.pt .tr.tried').length > 0`)) break; await sleep(250); }
  const tried = await evaluate(`[...document.querySelectorAll('.pt[data-tutor="english-tutor"] .tr.tried b')].map((b) => b.textContent)`);
  ok('回清单:英语老师块下「试过的」一条', tried.length === 1 && tried[0] === '试试新讲法', JSON.stringify(tried));

  // ---- 护栏:孩子端没有旁注、没有答案 ----
  await open(`${base}/?tutor=chinese-tutor`, `document.querySelectorAll('#board .sec').length > 0`);
  const kid = await evaluate(`({ notes: document.querySelectorAll('#board .notes').length, ans: document.querySelectorAll('#board .note-ans').length, pill: document.querySelector('#pill').hidden, more: document.querySelector('#more-btn').hidden })`);
  ok('孩子端:没有旁注、没有答案、输入条与「更多」都在', kid.notes === 0 && kid.ans === 0 && !kid.pill && !kid.more, JSON.stringify(kid));
} finally {
  browser?.kill();
  await sleep(600); // Chrome 退出还在写 profile,立刻删会 ENOTEMPTY
  if (!keep) { mock.kill(); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  else console.log(`留下了:mock 在 ${base}(pid ${mock.pid}),截图在 ${shots}`);
}

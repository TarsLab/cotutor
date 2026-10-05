#!/usr/bin/env node
/**
 * 试用(《备课设计.md》§十二)的手动验收(不进 pnpm test,要本机 Chrome;老师是假 CLI,不花钱):
 * 临时 workspace(运行时指 tests/_fake-cli.ts --stream)+ 一份课文件 + HTTP 的 serve →
 * Chrome(iPad 横屏)开 /parent → 点课文件 → 底部条有「试用」→ 点了跳到孩子端 /?try=<老师>/<话题>:顶上「试用 · 明天删」、
 * 没有「以前的」「新话题」、从第一节念起 → 从输入条扮孩子说一句 → 老师回了;索引里那条 from parent,上下文包 from: kid、带 lesson: →
 * 孩子端(不带 try)看不到这个话题 → 退回家长端:清单上标「试用」、不打星;点进去头上「试用 · 明天删」、底部「这节课」条不出。
 *
 * 用法:node scripts/probe-tryout.mjs [--keep](留下临时 workspace 与 serve)[--shots <目录>](课文件页、试用页、家长端清单三张截图)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const keep = process.argv.includes('--keep');
const shotsAt = process.argv.indexOf('--shots');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8796;
const cdp = 9338;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);

const home = mkdtempSync(join(tmpdir(), 'cotutor-probe-tryout-'));
const root = join(home, 'ws');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : join(home, 'shots');
mkdirSync(shots, { recursive: true });
const run = (args) => new Promise((resolve, reject) => { const p = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), ...args], { env: { ...process.env, HOME: home, COTUTOR_WORKSPACE: '' }, stdio: 'pipe' }); p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`cotutor ${args.join(' ')} exit ${c}`)))); });
await run(['init', 'probe', '--dir', root, '--name', '小探']);
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
const fake = join(repo, 'tests', '_fake-cli.ts');
cfg.runtimes.default = 'fake';
cfg.runtimes.fake = { run: [process.execPath, '--experimental-strip-types', '--no-warnings', fake, '--stream', '--agent', '{agent}', '{prompt}'], resume: [process.execPath, '--experimental-strip-types', '--no-warnings', fake, '--stream', '--agent', '{agent}', '--resume', '{session}', '{prompt}'] };
cfg.server.port = port;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
mkdirSync(join(root, 'lessons'), { recursive: true });
writeFileSync(join(root, 'lessons', '分披萨.md'), '---\ntutor: math-tutor\n---\n\n我们来分一个披萨。\n\n```choice\n一个披萨平均分给 2 个人,每人几块?\n- [x] 一半\n- [ ] 一整个\n```\n\n一个披萨平均分给 2 个人,每人分到多少?\n\n## 讲法\n\n他分不清「平均」,先让他自己说怎么分。\n');

const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', root, '--http'], { env: { ...process.env, HOME: home }, stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }
const api = async (path) => { const r = await fetch(base + path); return { status: r.status, json: await r.json().catch(() => null) }; };

let browser = null;
try {
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(home, 'chrome')}`, `${base}/parent`], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page' && t.url.startsWith('http'))?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const until = async (expr, n = 60) => { for (let i = 0; i < n; i++) { if (await evaluate(expr).catch(() => false)) return true; await sleep(250); } return false; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const f = join(shots, name); writeFileSync(f, Buffer.from(r.result.data, 'base64')); console.log('  ', f); };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });

  // ---- 家长端:清单 → 课文件页 → 「试用」 ----
  await until(`document.querySelectorAll('.pt[data-tutor="math-tutor"] .tr.lsn').length > 0`);
  await evaluate(`document.querySelector('.pt[data-tutor="math-tutor"] .tr.lsn').click()`);
  const lsnReady = await until(`(() => { const b = document.querySelector('#ls-try'); return b && !b.hidden && !b.disabled; })()`);
  const bar = await evaluate(`({ tr: document.querySelector('#ls-try').textContent, hand: !document.querySelector('#ls-hand').hidden })`);
  ok('课文件页:底部条有「试用」(能点)和「交给孩子」', lsnReady && bar.tr === '试用' && bar.hand, JSON.stringify(bar));
  await shot('tryout-lesson-page.png');
  await evaluate(`document.querySelector('#ls-try').click()`);
  const jumped = await until(`location.pathname === '/' && location.search.startsWith('?try=math-tutor/')`);
  const thread = decodeURIComponent((await evaluate('location.search')).split('/')[1] ?? '');
  ok('点「试用」跳到孩子端 /?try=math-tutor/<话题>', jumped && /^\d{4}-\d+$/.test(thread), await evaluate('location.href'));

  // ---- 孩子端试用页 ----
  const gated = await until(`document.querySelector('#trygo button')?.textContent === '开始试用' && !document.querySelector('#tutor').classList.contains('on')`);
  ok('试用页先出「开始试用」(点一下才念:iPad Safari 要先点过才放老师的 mp3),还没开老师页', gated);
  await evaluate(`document.querySelector('#trygo button').click()`);
  const played = await until(`document.querySelectorAll('#board .sec').length === 1 && document.querySelectorAll('#board .c-choice').length === 1`);
  const page = await evaluate(`({
    tag: getComputedStyle(document.querySelector('#trytag')).display !== 'none' ? document.querySelector('#trytag').textContent : null,
    hist: getComputedStyle(document.querySelector('#hist-btn')).display, nw: getComputedStyle(document.querySelector('#new-btn')).display,
    on: document.querySelector('#tutor').classList.contains('on'), pill: !document.querySelector('#pill').hidden,
  })`);
  ok('试用页:开在这位老师、顶上「试用 · 明天删」、「以前的」「新话题」不出、输入条在、第一节铺出来', played && page.on && page.tag === '试用 · 明天删' && page.hist === 'none' && page.nw === 'none' && page.pill, JSON.stringify(page));
  await shot('tryout-kid.png');
  await sleep(2500);
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '我选一半'; document.querySelector('#go').click(); return true; })()`);
  const answered = await until(`[...document.querySelectorAll('#board .sec')].length >= 2 && document.querySelector('#board').textContent.includes('我选一半')`, 80);
  ok('从输入条扮孩子说一句,老师回了(第二节铺出来,回的是这句)', answered, await evaluate(`document.querySelector('#board').textContent.slice(-80)`));
  await shot('tryout-kid-answered.png');
  const day = (await api('/api/kid/conversations/math-tutor/today')).json?.date;
  const index = JSON.parse(readFileSync(join(root, 'conversations', 'math-tutor', `${day}.json`), 'utf8'));
  const said = index.messages.filter((m) => m.thread === thread && m.lessonSection === undefined);
  const runFile = said[0] ? JSON.parse(readFileSync(join(root, 'conversations', 'math-tutor', `${day}.${said[0].job}.run.json`), 'utf8')) : null;
  ok('索引:那条记 from parent;第一条带 tryThread;上下文包 from: kid、带 lesson: 与 lessonBrief:', said.length === 1 && said[0].from === 'parent' && index.messages.find((m) => m.job === thread)?.tryThread === true && runFile?.prompt.includes('  from: kid') && runFile.prompt.includes('  lesson:') && runFile.prompt.includes('lessonBrief:'), JSON.stringify(said.map((m) => [m.job, m.from])));
  const kid = (await api('/api/kid/conversations/math-tutor/today')).json;
  ok('孩子端(不带 try)看不到这个话题、上限没动', !kid.messages.some((m) => m.thread === thread) && kid.remaining === (await api('/api/kid/conversations/math-tutor/today?try=' + thread)).json.remaining, JSON.stringify({ n: kid.messages.length, remaining: kid.remaining }));

  // ---- 退回家长端 ----
  await evaluate(`document.querySelector('#back').click()`);
  const back = await until(`location.pathname === '/parent' && document.querySelectorAll('.pt').length > 0`);
  const row = await evaluate(`(() => { const r = [...document.querySelectorAll('.pt[data-tutor="math-tutor"] .tr:not(.lsn)')].find((x) => x.querySelector('.pin')?.textContent === '试用'); return r && !r.querySelector('.stars, .star') ? r.querySelector('b').textContent : null; })()`);
  ok('「返回」退回家长端;清单上这个话题标「试用」、没有星', back && Boolean(row), String(row));
  await shot('tryout-parent-list.png');
  await evaluate(`[...document.querySelectorAll('.pt[data-tutor="math-tutor"] .tr:not(.lsn)')].find((x) => x.querySelector('.pin')?.textContent === '试用').click()`);
  await until(`document.querySelectorAll('#board .sec').length >= 2`);
  await sleep(500);
  const pb = await evaluate(`({ mo: document.querySelector('#c-mo').textContent, lesson: document.querySelector('#lesson').hidden })`);
  ok('点进去:头上「试用 · 明天删」、底部「这节课」条不出', pb.mo === '试用 · 明天删' && pb.lesson === true, JSON.stringify(pb));

  // ---- 老师块的「试用」:没备课,空板直接问;第一句开试用话题、地址换成真的话题 ----
  await send('Page.navigate', { url: `${base}/parent` });
  await until(`[...document.querySelectorAll('.pt[data-tutor="math-tutor"] .hd .try')].some((b) => b.textContent === '试用')`);
  await evaluate(`[...document.querySelectorAll('.pt[data-tutor="math-tutor"] .hd .try')].find((b) => b.textContent === '试用').click()`);
  await until(`Boolean(document.querySelector('#trygo button'))`);
  await evaluate(`document.querySelector('#trygo button').click()`);
  const blank = await until(`location.search === '?try=math-tutor/new' && document.querySelector('#tutor').classList.contains('on') && Boolean(document.querySelector('#board .blank'))`);
  ok('老师块「试用」→ 孩子端空板(?try=math-tutor/new)、顶上「试用 · 明天删」', blank && (await evaluate(`getComputedStyle(document.querySelector('#trytag')).display`)) !== 'none', await evaluate('location.href'));
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '三加五等于几'; document.querySelector('#go').click(); return true; })()`);
  const swapped = await until(`/^\\?try=math-tutor\\/\\d{4}-\\d+$/.test(location.search) && document.querySelector('#board').textContent.includes('三加五等于几')`, 80);
  const bt = decodeURIComponent((await evaluate('location.search')).split('/')[1] ?? '');
  const ix = JSON.parse(readFileSync(join(root, 'conversations', 'math-tutor', `${day}.json`), 'utf8'));
  ok('第一句开了试用话题:地址换成真的话题号;索引第一条带 tryThread、记 from parent', swapped && ix.messages.find((m) => m.job === bt)?.tryThread === true && ix.messages.find((m) => m.job === bt)?.from === 'parent', bt);
  await shot('tryout-blank.png');
  ws.close();
} catch (err) {
  console.error('✗ 探针出错:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  browser?.kill();
  if (keep) { serve.unref(); console.log(`留着:workspace ${root},serve ${base}(pid ${serve.pid},自己 kill)`); }
  else { serve.kill(); await sleep(800); rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
}

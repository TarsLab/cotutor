#!/usr/bin/env node
/**
 * 百炼没配(《产品规划.md》拍板 30)的手动验收(不进 pnpm test,要本机 Chrome;不连百炼、不花钱):
 * 临时 HOME(没有任何 key)+ HTTP serve → 孩子端首页灰着、写「老师们还没到」→ 家长「记录」顶上一行叫去「首页」配 →
 * 「首页」右栏最上面是配百炼那块 → 填 Token Plan 的 key 被拒、说为什么 → 在临时 HOME 里写一份 bailian.json(假装配上了)→
 * 「首页」那块挪到下面写「配好了 …末四位」→ 开着的孩子端首页几秒内自己亮起来;截图。
 * 「试连通了才存」那一下要真 key,这里不走(tests/bailian.test.ts 用假的试连验过)。
 *
 * 用法:node scripts/probe-bailian.mjs [--out <截图目录>] [--keep]
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const home = probeDir('cotutor-probe-bailian-');
const shots = outAt > 0 ? process.argv[outAt + 1] : join(home, 'shots');
mkdirSync(shots, { recursive: true });
const root = join(home, 'ws');
// 没有任何百炼的 key:HOME 是空的临时目录,环境里的也摘掉(DASHSCOPE_API_KEY 是 sk-sp- 时本来也不算按量的)
const env = { ...process.env, HOME: home, COTUTOR_WORKSPACE: '', COTUTOR_LIVE_ENDPOINT: '', DASHSCOPE_API_KEY: '', DASHSCOPE_WORKSPACE_ID: '' };
const run = (args) => new Promise((resolve, reject) => { const p = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), ...args], { env, stdio: 'pipe' }); let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; }); p.on('exit', (c) => (c === 0 ? resolve(out) : reject(new Error(out)))); });
await run(['init', 'probe', '--dir', root, '--name', '小探']);
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.server.port = port;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const blFile = join(home, '.config', 'cotutor', 'bailian.json');

const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', root, '--http'], { env, stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(home, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr).catch(() => false)) return true; await sleep(250); } return false; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const tap = async (expr) => {
    const r = await evaluate(`(() => { const el = ${expr}; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await sleep(200);
  };
  const typeInto = async (sel, text) => { await evaluate(`(() => { const el = document.querySelector('${sel}'); el.focus(); el.value = ''; })()`); await send('Input.insertText', { text }); };
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 2, mobile: false });

  // ---- 孩子端首页:灰着 ----
  await send('Page.navigate', { url: `${base}/` });
  ok('孩子端首页:灰着,写「老师们还没到」', await until(`document.body.classList.contains('gated') && getComputedStyle(document.querySelector('#gate')).display === 'block' && document.querySelector('#gate').textContent.includes('老师们还没到')`));
  ok('孩子端首页:老师的牌点不进去', await evaluate(`[...document.querySelectorAll('#deck .pc')].every((el) => getComputedStyle(el).pointerEvents === 'none')`));
  ok('孩子端首页:没有「错误」「key」这类字', await evaluate(`!/错误|key|百炼/.test(document.body.innerText)`));
  console.log('  ', await shot('kid-gated.png'));

  // ---- 家长「记录」:顶上一行 ----
  await send('Page.navigate', { url: `${base}/parent` });
  ok('家长「记录」:顶上一行叫去「首页」配', await until(`(() => { const a = document.querySelector('#pnokey'); return a && !a.hidden && a.getAttribute('href') === '/parent/home'; })()`));
  console.log('  ', await shot('parent-record-nokey.png'));

  // ---- 家长「首页」:配百炼那块在最上面 ----
  await send('Page.navigate', { url: `${base}/parent/home` });
  ok('家长「首页」:右栏最上面是配百炼那块,写还没配', await until(`(() => { const b = document.querySelector('#bailian'); return b && b.parentElement.firstElementChild === b && b.querySelector('.grp.warn') && b.textContent.includes('还没配'); })()`));
  console.log('  ', await shot('parent-home-nokey.png'));
  await typeInto('#bl-key', 'sk-sp-0123456789abcdef0123');
  await typeInto('#bl-ws', 'llm-probe');
  await tap(`document.querySelector('#bailian .go')`);
  ok('填 Token Plan 的 key:不存,说要按量的', await until(`(document.querySelector('#bailian .err') || {}).textContent?.includes('Token Plan')`));
  ok('填过的业务空间 id 还在(重画没抹掉)', await evaluate(`document.querySelector('#bl-ws').value === 'llm-probe'`));
  console.log('  ', await shot('parent-home-tokenplan.png'));

  // ---- 配上了(写文件,不真连) ----
  await send('Page.navigate', { url: `${base}/` });
  await until(`document.body.classList.contains('gated')`);
  mkdirSync(join(home, '.config', 'cotutor'), { recursive: true });
  writeFileSync(blFile, JSON.stringify({ apiKey: 'sk-probe00000000000000abcd', workspaceId: 'llm-probe' }));
  ok('开着的孩子端首页:几秒内自己亮起来', await until(`!document.body.classList.contains('gated') && getComputedStyle(document.querySelector('#gate')).display === 'none'`, 40));
  console.log('  ', await shot('kid-ready.png'));
  await send('Page.navigate', { url: `${base}/parent/home` });
  ok('家长「首页」:那块挪到下面,写配好了 …abcd', await until(`(() => { const b = document.querySelector('#bailian'); return b && b.parentElement.lastElementChild === b && !b.querySelector('.warn') && b.textContent.includes('配好了') && b.textContent.includes('…abcd'); })()`));
  await evaluate(`document.querySelector('#bailian').scrollIntoView({ block: 'center' })`);
  console.log('  ', await shot('parent-home-ready.png'));
  await send('Page.navigate', { url: `${base}/parent` });
  ok('家长「记录」:配好了就没有那一行', await until(`document.querySelector('#pnokey') && document.querySelector('#pnokey').hidden`));
  ws.close();
} finally {
  if (browser) browser.kill();
  if (!keep) {
    serve.kill();
    if (outAt < 0) console.log(`截图在 ${shots}(临时目录,--out 指定目录可以留下)`);
    else rmSync(root, { recursive: true, force: true });
  } else console.log(`留着:workspace ${root},serve ${base}(pid ${serve.pid})`);
}
process.exitCode = bad ? 1 : 0;

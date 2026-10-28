#!/usr/bin/env node
/**
 * 口语课页面(孩子端 /talk)的手动验收,不花钱:真 serve(临时 workspace,talk.enabled)+ 假的读口语单(COTUTOR_TALK_FAKE_LIST)+ 无头 Chrome。
 * 走一遍:拍照屏 → 相册选一张 → 老师在看 → 口语单(补一个词、× 掉一句)→「先热身,再打电话」交给英语老师的实时页(地址带这份口语单,talk.json 改好了)→
 * 回口语课页,拍照屏有「接着上」→ 点了还是交给英语老师、同一份。上课在实时页那头(probe-live-page 的口语课那段);这一页不再打电话。
 * 用法:node scripts/probe-talk-page.mjs [--keep] [--out <截图目录>]
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const out = outAt > 0 ? process.argv[outAt + 1] : null;
if (out) mkdirSync(out, { recursive: true });
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8798;
const cdp = 9341;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const tmp = probeDir('cotutor-probe-talk-');
const { initWorkspace } = await import(join(repo, 'src', 'cli', 'init.ts'));
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'probe', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.talk = { enabled: true, minutes: 1 };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

try { await fetch(`${base}/api/health`); console.error(`端口 ${port} 上已经有东西,先停掉`); process.exit(2); } catch {}
const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', wsRoot, '--port', String(port), '--http'], { stdio: process.env.PROBE_LOG ? 'inherit' : 'ignore', detached: keep, env: { ...process.env, COTUTOR_WORKSPACE: wsRoot, COTUTOR_TALK_FAKE_LIST: '1' } });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  const errors = [];
  /** 主框架去过的地址(孩子端打开后会把 ?tutor= 这些从地址栏收掉,看导航事件) */
  const navs = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) navs.push(m.params.frame.url); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (name) => { if (!out) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr).catch(() => false)) return true; await sleep(250); } return false; };
  // 先滚到看得见的地方:视口外的坐标 CDP 的鼠标事件派不到
  const click = async (sel) => {
    const at = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });

  // ---- 拍照屏 → 相册选一张 → 老师在看 → 口语单 ----
  await send('Page.navigate', { url: `${base}/talk?tutor=english-tutor` });
  ok('拍照屏:英语老师的大头像、拍照 / 相册;没有上次的就没有「接着上」', await until(`document.querySelector('#snap').classList.contains('on') && !!document.querySelector('#snap-av .tfav') && document.querySelector('#snap-resume').hidden`));
  ok('没有跟读、打电话那一屏', await evaluate(`!document.querySelector('#kid')`));
  await shot('talk-00-snap');
  const pngAt = join(tmp, 'page.png');
  writeFileSync(pngAt, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const doc = await send('DOM.getDocument', {});
  const lib = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#p-lib' });
  await send('DOM.setFileInputFiles', { nodeId: lib.result.nodeId, files: [pngAt] });
  ok('选了照片:右边「老师在看这一页…」、浅灰占位、按钮点不了', await until(`document.querySelector('#pick').classList.contains('on') && document.querySelector('#p-title').textContent.includes('老师在看') && document.querySelectorAll('#p-words .tk-sk').length === 4 && document.querySelector('#p-go').disabled`));
  ok('读完:今天的口语单,一个词一句,按钮是「先热身,再打电话 · 2 个」', await until(`document.querySelector('#p-title').textContent === '今天的口语单' && document.querySelectorAll('#p-words .tk-it').length === 1 && document.querySelectorAll('#p-sents .tk-it').length === 1 && document.querySelector('#p-go').textContent === '先热身,再打电话 · 2 个' && !document.querySelector('#p-go').disabled`, 40));
  const id = await evaluate(`location.hash.split('/')[2]`);
  ok('地址带上这一次的 id', /^\d{4}-\d{2}-\d{2}-\d{4}/.test(id || ''), id);

  // 补一个词、× 掉那一句
  await click('#p-addw');
  await until(`document.activeElement && document.activeElement.classList.contains('en')`, 20);
  await send('Input.insertText', { text: 'bus' });
  await click('#p-words .tk-it.ed .x');
  await click('#p-sents .tk-it .x');
  ok('补了 bus、× 掉了句子:两个词、没有句子,按钮跟着变', await until(`[...document.querySelectorAll('#p-words .tk-it .en')].map((x) => x.textContent).join() === 'red,bus' && document.querySelectorAll('#p-sents .tk-it').length === 0 && document.querySelector('#p-go').textContent === '先热身,再打电话 · 2 个'`, 20));
  await shot('talk-01-list');

  // 交给英语老师的实时页
  const wentTo = async (n) => { for (let i = 0; i < 40; i++) { const u = navs.slice(n).map((x) => new URL(x)).find((x) => x.pathname === '/'); if (u) return u; await sleep(250); } return null; };
  let n0 = navs.length;
  await click('#p-go');
  const u1 = await wentTo(n0);
  ok('「先热身,再打电话」:换到英语老师的页面,地址带这份口语单', u1 && u1.searchParams.get('tutor') === 'english-tutor' && u1.searchParams.get('talk') === id, String(u1));
  const meta = JSON.parse(readFileSync(join(wsRoot, 'talk', id, 'talk.json'), 'utf8'));
  ok('talk.json:改好了(ready)、两个词、没有句子、改过的(parent)', meta.status === 'ready' && meta.list.words.map((w) => w.en).join() === 'red,bus' && meta.list.sentences.length === 0 && meta.listBy === 'parent', JSON.stringify(meta.list));

  // 回口语课页:「接着上」
  await send('Page.navigate', { url: `${base}/talk?tutor=english-tutor` });
  ok('回来:拍照屏有「接着上」,写着两个单词', await until(`!document.querySelector('#snap-resume').hidden && document.querySelector('#snap-resume-sub').textContent.includes('2 个单词')`));
  n0 = navs.length;
  await click('#snap-resume-go');
  const u2 = await wentTo(n0);
  ok('点「接着上」:还是交给英语老师、同一份', u2 && u2.searchParams.get('tutor') === 'english-tutor' && u2.searchParams.get('talk') === id, String(u2));
  ok('页面没有报错', errors.length === 0, errors.join(' | '));
  ws.close();
} finally {
  if (browser) browser.kill();
  if (!keep) serve.kill();
  else console.log(`留着:workspace ${wsRoot},serve ${base}(pid ${serve.pid})`);
}
console.log(bad ? `${bad} 项没过` : '全过');
process.exitCode = bad ? 1 : 0;

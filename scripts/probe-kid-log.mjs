#!/usr/bin/env node
/**
 * 孩子端的流水的手动验收:要本机 Chrome 与一个跑着的 serve。**会写**:往那个 workspace 的流水里记几行、登记一台设备、
 * 起一次名再去掉——拿试用的 workspace 跑(cotutor init <slug> --dir <tmp> 再 serve --workspace <tmp> --http)。
 * 孩子端老师页、听写各开一次(报打开、种设备 cookie)→ 页面里故意抛一个错、一个没接住的 Promise → 断网 8 秒再通(CDP 的网络模拟)→
 * 工作台接口看设备、「页面」三条、「连接」一条、今天开着多久(离开老师页记一笔前台)→ 侧栏写跑的提交 → 设备卡点名字起名(回车存)→ 名字回到空。
 *
 * 用法:node scripts/probe-kid-log.mjs [--base http://127.0.0.1:5180]
 */
import { spawn } from './_guard.mjs';
import { QUIET_ARGS } from './_quiet.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://127.0.0.1:5180');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); if (!cond) process.exitCode = 1; };

const proc = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--window-size=1180,820', `--user-data-dir=/tmp/cotutor-probe-kidlog-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome 没起来');
}

const ws = new WebSocket(await target());
await new Promise((r) => { ws.onopen = r; });
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
const waitFor = async (expression, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(expression)) return true; await sleep(150); } return false; };
const go = async (url) => { await send('Page.navigate', { url }); await sleep(1500); };
const overview = async () => (await fetch(`${base}/api/dev/overview`)).json();
const tag = `probe-${Date.now().toString(36)}`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  const before = await overview();

  // ---- 孩子端老师页:报打开、种 cookie;故意抛一个错 ----
  await go(`${base}/`);
  const cookies = (await send('Network.getCookies', { urls: [base] })).result?.cookies ?? [];
  const dev = cookies.find((c) => c.name === 'cotutor_kid');
  ok('打开孩子端:种了设备 cookie(HttpOnly)', Boolean(dev) && /^[0-9a-f]{12}$/.test(dev.value) && dev.httpOnly, JSON.stringify(dev ?? null));
  ok('页面上有 kidLog', await evaluate(`typeof kidLog === 'object'`));
  await evaluate(`setTimeout(() => { null['${tag}-kid']; }, 0); Promise.reject(new Error('${tag}-rejected')); true`);
  await sleep(300);
  // ---- 断网再通:老师页心跳不通头像变灰,通了记一笔断线(7.3) ----
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  ok('断网:孩子端变灰', await waitFor(`document.body.classList.contains('offline')`, 15000));
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  ok('网通了:不灰了', await waitFor(`!document.body.classList.contains('offline')`, 15000));
  await sleep(500);
  // ---- 听写页:同一台设备再报一次打开,抛一个错 ----
  await go(`${base}/dictation`);
  await evaluate(`setTimeout(() => { null['${tag}-dict']; }, 0); true`);
  await sleep(800);

  const after = await overview();
  const me = after.devices.find((d) => d.id === dev?.value);
  ok('设备卡:这台在,今天开了两次(老师页、听写)', me?.today === (before.devices.find((d) => d.id === dev?.value)?.today ?? 0) + 2, JSON.stringify(me));
  ok('设备卡:标签是 Chrome', /Chrome \d+/.test(me?.label ?? ''), me?.label);
  ok('今天开着多久:离开老师页记了一笔前台', (after.kidTime.today?.ms ?? 0) > (before.kidTime.today?.ms ?? 0), JSON.stringify(after.kidTime.today));
  const net = after.issues.find((i) => i.kind === 'net' && i.text === me?.label);
  ok('要看一眼:这台今天的「连接」写着断线', /断线 \d+ 次,最长/.test(net?.detail ?? ''), JSON.stringify(net ?? null));
  const js = after.issues.filter((i) => i.kind === 'js' && i.text.includes(tag));
  ok('要看一眼:老师页抛的错、没接住的 Promise、听写页的错各一条「页面」', js.length === 3 && js.some((i) => i.text.includes('rejected')) && js.some((i) => i.detail.startsWith('dictation')), JSON.stringify(js.map((i) => [i.text, i.detail])));
  ok('出错记的位置是 行:列', js.filter((i) => !i.text.includes('rejected')).every((i) => /\d+:\d+$/.test(i.detail)), JSON.stringify(js.map((i) => i.detail)));

  // ---- 工作台概览:设备卡点名字起名 ----
  await go(`${base}/dev#overview`);
  ok('概览的设备卡出来了', await waitFor(`[...document.querySelectorAll('#overview .blk h2')].some((x) => x.textContent === '设备') && document.querySelector('#overview .devs .dname') !== null`));
  ok('要看一眼里有「页面」「连接」', await evaluate(`['页面', '连接'].every((k) => [...document.querySelectorAll('#overview .issue .st')].some((x) => x.textContent === k))`));
  const health = await (await fetch(`${base}/api/health`)).json();
  ok('侧栏写跑的提交(7.1)', !health.commit || (await waitFor(`(document.querySelector('#health-sub')?.textContent || '').includes(${JSON.stringify(health.commit ?? '')})`)), JSON.stringify({ commit: health.commit, changed: health.changed }));
  ok('今天卡写孩子端开着', await evaluate(`[...document.querySelectorAll('#overview .kv span')].some((x) => x.textContent === '孩子端开着')`));
  const box = await evaluate(`(() => { const rows = [...document.querySelectorAll('#overview .devs .dr')]; const row = rows.find((r) => r.textContent.includes(${JSON.stringify(me?.label ?? '')})); const b = row && row.querySelector('.dname'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (box) {
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(200);
    ok('点名字变成输入框', await evaluate(`document.activeElement && document.activeElement.classList.contains('dname-in')`));
    await send('Input.insertText', { text: '探针的设备' });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(800);
    const list = await (await fetch(`${base}/api/dev/devices`)).json();
    ok('回车存进设备表', list[dev.value]?.name === '探针的设备', JSON.stringify(list[dev.value]));
    ok('设备卡上换成了名字', await waitFor(`[...document.querySelectorAll('#overview .devs .dname')].some((x) => x.textContent === '探针的设备')`));
  } else ok('设备卡上找得到这台', false);
} finally {
  if (process.argv.includes('--keep-name') === false) {
    const id = (await send('Network.getCookies', { urls: [base] })).result?.cookies?.find((c) => c.name === 'cotutor_kid')?.value;
    if (id) await fetch(`${base}/api/dev/devices/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '' }) }).catch(() => {});
  }
  ws.close();
  proc.kill();
}

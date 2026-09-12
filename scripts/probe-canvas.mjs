#!/usr/bin/env node
/**
 * 画板工作台的手动验收(不进 pnpm test,要本机 Chrome 与一个跑着的 mock / serve):
 * 用 Chrome DevTools 协议开孩子端页面 → 直开画板舞台 → 在 iframe 里用 PointerEvent 画三笔 → 等状态回页面 → 点「给老师看」→
 * 查紧凑态出了缩略图。截图用 CLI --screenshot 另截(这种无头模式下 Page.captureScreenshot 会卡,见 CLAUDE.md)。
 *
 * 用法:node scripts/probe-canvas.mjs [页面 URL]
 *   缺省 http://127.0.0.1:8790/?tutor=chinese-tutor&step=2.1&stage=2.1(mock 里语文老师第三节的画板卡;先发两条消息把节推到那里)
 */
import { spawn } from 'node:child_process';

const url = process.argv[2] ?? 'http://127.0.0.1:8790/?tutor=chinese-tutor&step=2.1&stage=2.1';
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333;
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--window-size=1180,820', '--user-data-dir=/tmp/cotutor-probe-profile', url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
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
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };

const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
try {
  await send('Runtime.enable');
  // 等舞台 iframe 里的画布出来
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { ready = await evaluate(`Boolean(document.querySelector('#st-frame')?.contentDocument?.querySelector('.canvas-board canvas'))`); if (!ready) await sleep(250); }
  ok('画板舞台开了(iframe 里有画布)', ready);
  const chrome = await evaluate(`(() => { const d = document.querySelector('#st-frame').contentDocument; return { toolbar: Boolean(d.querySelector('.App-toolbar-container')) && getComputedStyle(d.querySelector('.App-toolbar-container')).display !== 'none', mine: d.querySelectorAll('.ct-btn').length, prompt: d.querySelector('.canvas-prompt-text')?.textContent ?? '' }; })()`);
  ok('excalidraw 自己的工具栏藏掉了,自己的钮有 7 个,题目条在', chrome && !chrome.toolbar && chrome.mine === 7 && chrome.prompt.length > 0, JSON.stringify(chrome));
  // 画三笔:iframe 内的 PointerEvent(顶层 Input.dispatchMouseEvent 画不上)
  const drew = await evaluate(`(async () => {
    const d = document.querySelector('#st-frame').contentDocument;
    const cv = d.querySelector('.canvas-board .excalidraw__canvas.interactive') || d.querySelector('.canvas-board canvas');
    const r = cv.getBoundingClientRect();
    const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1, button: 0, pressure: 0.5 }));
    const stroke = async (pts) => { ev('pointerdown', ...pts[0]); for (const p of pts.slice(1)) { ev('pointermove', ...p); await new Promise((r) => setTimeout(r, 12)); } ev('pointerup', ...pts[pts.length - 1]); await new Promise((r) => setTimeout(r, 80)); };
    await stroke([[120, 120], [160, 140], [200, 170], [240, 190], [280, 220]]);
    await stroke([[300, 100], [300, 140], [302, 180], [301, 220], [300, 260]]);
    await stroke([[120, 300], [180, 300], [240, 302], [300, 300]]);
    await new Promise((r) => setTimeout(r, 900));
    return { note: document.querySelector('#st-note')?.textContent ?? '', disabled: document.querySelector('#st-go')?.disabled };
  })()`);
  ok('画了三笔 → 状态回页面,「给老师看」亮起,笔数在动作条上', drew && /画了 3 笔/.test(drew.note) && drew.disabled === false, JSON.stringify(drew));
  const undone = await evaluate(`(async () => { const d = document.querySelector('#st-frame').contentDocument; [...d.querySelectorAll('.ct-btn')].find((b) => b.title === '撤销上一笔').click(); await new Promise((r) => setTimeout(r, 900)); return document.querySelector('#st-note')?.textContent ?? ''; })()`);
  ok('撤销一笔 → 画了 2 笔', /画了 2 笔/.test(undone), undone);
  const submitted = await evaluate(`(async () => { document.querySelector('#st-go').click(); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); const img = document.querySelector('#board [data-card] .c-canvas img, #board .c-canvas img'); if (img) return { src: img.src.slice(0, 22), stageOn: document.querySelector('#stage').classList.contains('on') }; } return null; })()`);
  ok('给老师看 → 舞台关了、紧凑态出缩略图(mock 存的是 data URL)', submitted && submitted.src.startsWith('data:image/png') && !submitted.stageOn, JSON.stringify(submitted));
} catch (err) {
  console.error('✗ 探针出错:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  ws.close();
  proc.kill();
}

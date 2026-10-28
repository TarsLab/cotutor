#!/usr/bin/env node
/**
 * 「以前的」话题只读回看的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 起 cotutor mock,Chrome 开孩子端语文老师(今天的话题,实时老师页)→ 右上「更多」→「以前的」→ 点昨天那个话题:
 * 照旧是实时老师页的样子(左栏 + 白板,2026-10-28 起不再退回底部字幕行那一版;没有占位卡),板上是那天的节;
 * 平板横屏左栏那颗按钮灰着(voice-view 的 readonly),按了晃一下、不开口、不发消息;底下一行「回到今天 ›」,点了回到今天的话题、按钮恢复。
 * 手机:左栏那行照旧,「回到今天」在输入条的位置(输入条收着)。iPad 横屏、手机各截一张。
 *
 * 用法:node scripts/probe-hist.mjs [--out <截图目录>] [--keep](留下 mock)
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8804;
const cdp = 9348;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const tmp = probeDir('cotutor-probe-hist-');
const shots = outAt > 0 ? process.argv[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });

const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64')); return join(shots, name); };
  const device = async (w, h, dsf, mobile) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile }); await sleep(400); };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  // 手指:CDP 鼠标(走命中判定,AGENTS.md「坑」);按住 hold 毫秒再松
  const tap = async (sel, hold = 0) => {
    const r = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
    if (!r) return false;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    if (hold) await sleep(hold);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    return true;
  };
  const shown = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return Boolean(el) && !el.hidden && getComputedStyle(el).display !== 'none'; })()`;
  /** 「更多」→「以前的」→ 点昨天那一天的第一个话题 */
  const openYesterday = async () => {
    await tap('#more-btn');
    await until(shown('#hist-btn'), 20);
    await tap('#hist-btn');
    await until(`document.querySelectorAll('#hist .tr').length > 0`, 20);
    await evaluate(`(() => { let past = false; for (const el of document.querySelectorAll('#hist .ls > *')) { if (el.classList.contains('dt')) past = el.textContent.trim() !== '今天'; else if (past && el.classList.contains('tr')) { el.setAttribute('data-probe', 'y'); return; } } })()`);
    await tap('#hist .tr[data-probe="y"]');
    return until(`document.body.classList.contains('ro') && document.querySelectorAll('#board .sec').length > 0`, 40);
  };
  const today = async () => (await (await fetch(`${base}/api/kid/conversations/chinese-tutor/today`)).json()).messages.length;
  await send('Runtime.enable');
  await send('Page.enable');

  // ---- 平板横屏:今天的话题 → 以前的 ----
  await device(1180, 820, 1, false);
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor` });
  await until(`document.body.classList.contains('live') && document.querySelector('#tutor').classList.contains('on')`);
  await sleep(1200);
  const n0 = await today();
  const opened = await openYesterday();
  await sleep(500);
  const v = await evaluate(`(() => ({
    live: document.body.classList.contains('live'), sub: Boolean(document.querySelector('#sub')), wait: Boolean(document.querySelector('.wait-card')),
    secs: document.querySelectorAll('#board .sec').length, mo: document.querySelector('#c-mo').textContent,
    voice: document.querySelector('#lv-hold').dataset.voice, tone: document.querySelector('#lv-hold').dataset.tone, big: document.querySelector('#lv-hold .vb-big b').textContent,
    hold: ${shown('#lv-hold')}, today: ${shown('#lv-today')}, todayText: document.querySelector('#lv-today').textContent, tools: ${shown('#lv-tools')}, lv: ${shown('#lv')},
  }))()`);
  ok('以前的:照旧是实时老师页(左栏 + 白板),没有底部字幕行、没有占位卡;板上是那天的节;左上写「以前的」', opened && v.live && v.lv && !v.sub && !v.wait && v.secs > 0 && v.mo.startsWith('以前的'), JSON.stringify(v));
  ok('左栏那颗按钮灰着(readonly)、字照旧「按住说话」;底下一行「回到今天 ›」;底下那排工具不露', v.hold && v.voice === 'readonly' && v.tone === 'grey' && v.big === '按住说话' && v.today && v.todayText === '回到今天 ›' && !v.tools, JSON.stringify(v));
  await tap('#lv-hold', 600);
  await sleep(150);
  const press = { shake: await evaluate(`document.querySelector('#lv-hold').classList.contains('vb-shake')`), listening: await evaluate(`document.body.classList.contains('listening')`), voice: await evaluate(`document.querySelector('#lv-hold').dataset.voice`) };
  await sleep(800);
  ok('按住那颗:晃一下、不在听、不发消息', press.shake && !press.listening && press.voice === 'readonly' && (await today()) === n0, JSON.stringify({ ...press, before: n0, after: await today() }));
  console.log('  ', await shot('hist-ipad.png'));
  await tap('#lv-today');
  const back = await until(`!document.body.classList.contains('ro') && !document.querySelector('#c-mo').textContent.startsWith('以前的')`, 20);
  await sleep(600);
  const b = { voice: await evaluate(`document.querySelector('#lv-hold').dataset.voice`), today: await evaluate(shown('#lv-today')), live: await evaluate(`document.body.classList.contains('live')`) };
  ok('点「回到今天 ›」:回到今天的话题,按钮不再灰着、那一行收起', back && b.live && b.voice !== 'readonly' && !b.today, JSON.stringify(b));

  // ---- 手机:「回到今天」在输入条的位置 ----
  await device(390, 844, 2, true);
  const opened2 = await openYesterday();
  await sleep(500);
  const p = await evaluate(`(() => ({ backToday: ${shown('#back-today')}, pill: ${shown('#pill')}, lvToday: ${shown('#lv-today')}, lv: ${shown('#lv')}, over: document.documentElement.scrollWidth > innerWidth }))()`);
  ok('手机:左栏那行照旧;「回到今天」在输入条的位置(输入条收着),左栏那颗不露;不横向滚', opened2 && p.backToday && !p.pill && !p.lvToday && p.lv && !p.over, JSON.stringify(p));
  console.log('  ', await shot('hist-phone.png'));
  await tap('#back-today');
  ok('手机:点「回到今天」回到今天的话题', await until(`!document.body.classList.contains('ro')`, 20));

  ok('页面没抛异常', errors.length === 0, errors.join(' | '));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(join(tmp, 'chrome'), { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/?tutor=chinese-tutor`); }
  console.log(`截图在 ${shots}`);
}
process.exit(bad ? 1 : 0);

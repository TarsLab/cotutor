#!/usr/bin/env node
/**
 * 录像的实录(《家长录像设计.md》§4)孩子端这一段的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * 孩子端进语文老师 → 等老师念 → 点开选择题 → 选一项 → 关弹窗 → 页面退到后台(pagehide)→ 拦下发出去的实录:
 * 话题对、播放位置记了(带 job)、弹窗开关各一条(那张卡)、按顺序;家长端 /parent 看同一个话题什么都不发。
 *
 * 用法:node scripts/probe-play.mjs [--keep](留下 mock)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const keep = process.argv.includes('--keep');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8797;
const cdp = 9339;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

// 拦下发出去的实录(fetch 与 sendBeacon 两条路都拦)
const TAP = `(() => {
  window.__play = [];
  const f = window.fetch;
  window.fetch = (url, init) => { if (String(url).endsWith('/play') && init && init.body) window.__play.push(JSON.parse(init.body)); return f(url, init); };
  const b = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  navigator.sendBeacon = (url, data) => { if (String(url).endsWith('/play')) data.text().then((t) => window.__play.push(JSON.parse(t))); return b ? b(url, data) : true; };
})();`;

const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-play-'));
const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: TAP });

  // ---- 孩子端 ----
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor` });
  await until(`document.querySelector('#tutor').classList.contains('on') && document.querySelectorAll('#board .c-choice').length > 0`);
  await sleep(1500);
  const job = await evaluate(`document.querySelector('#board .c-choice').closest('.sec').dataset.job`);
  const card = await evaluate(`Number(document.querySelector('#board .c-choice').dataset.card)`);
  await evaluate(`document.querySelector('#board .c-choice').click()`);
  await until(`document.querySelector('#stage').classList.contains('on')`);
  await evaluate(`document.querySelectorAll('#st-body .so')[1].click()`);
  await sleep(300);
  await evaluate(`document.querySelector('#st-x').click()`);
  await sleep(200);
  await evaluate(`window.dispatchEvent(new Event('pagehide'))`);
  await sleep(500);
  const sent = await evaluate(`window.__play`);
  const recs = sent.flatMap((b) => b.records);
  const thread = await evaluate(`(async () => (await (await fetch('/api/kid/conversations/chinese-tutor/today')).json()).thread)()`);
  ok('发出去了:话题是当前话题,带 sentAt', sent.length > 0 && sent.every((b) => b.thread === thread && typeof b.sentAt === 'number'), JSON.stringify(sent.map((b) => ({ thread: b.thread, n: b.records.length }))));
  const plays = recs.filter((r) => r.k === 'play');
  ok('播放位置记了:带那一节的 job、句号、状态', plays.length > 0 && plays.every((r) => typeof r.at === 'number' && (r.job === null || typeof r.job === 'string') && typeof r.status === 'string') && plays.some((r) => r.job === job), JSON.stringify(plays.slice(0, 4)));
  const stages = recs.filter((r) => r.k === 'stage');
  ok('弹窗开、关各一条,是那张选择题,开在关之前', stages.length === 2 && stages[0].open && !stages[1].open && stages.every((r) => r.job === job && r.card === card) && stages[0].at <= stages[1].at, JSON.stringify(stages));
  ok('孩子端不发卡的改动(服务端存卡时自己记)', !recs.some((r) => r.k === 'card'));

  // ---- 家长端看同一个话题:不记 ----
  await send('Page.navigate', { url: `${base}/parent` });
  await until(`document.querySelectorAll('.pt').length > 0`);
  await evaluate(`document.querySelector('.pt[data-tutor="chinese-tutor"] .tr').click()`);
  await until(`document.querySelectorAll('#board .sec').length > 0`);
  await sleep(800);
  await evaluate(`window.dispatchEvent(new Event('pagehide'))`);
  await sleep(300);
  ok('家长端看:什么都不发', (await evaluate(`window.__play.length`)) === 0);
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/`); }
}
process.exit(bad ? 1 : 0);

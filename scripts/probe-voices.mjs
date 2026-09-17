#!/usr/bin/env node
/**
 * 家长端音色页的手动验收(不进 pnpm test,要本机 Chrome 与一个跑着的 serve,试听会真跑一次 voxtell say):
 * 用 Chrome DevTools 协议开 /parent#voices → 列表来了(条数与 /api/tts/voices 一致)→ 搜一个词列表缩短 →
 * 点第一行「试听」等它变成「■ 停」(合成完开播)→ 给选中的老师点「给 X 用」→ /api/config 里那位老师的 voice 变了 →
 * 改回原来的 → 桌面与手机两种尺寸各截一张图。
 *
 * 用法:node scripts/probe-voices.mjs [--base http://127.0.0.1:5180] [--shots <目录>] [--keep-voice](不改回去)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://127.0.0.1:5180');
const shots = arg('--shots', '');
const keepVoice = process.argv.includes('--keep-voice');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); if (!cond) process.exitCode = 1; };

const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, '--window-size=1280,900', '--user-data-dir=/tmp/cotutor-probe-voices-profile', `${base}/parent#voices`], { stdio: 'ignore' });

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
const shot = async (name, width, height, scale) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: scale > 1 });
  await sleep(400);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64'));
  console.log(`  截图 ${join(shots, name)}`);
};

let original = null;
let who = null;
try {
  await send('Runtime.enable');
  await send('Page.enable');
  const api = await (await fetch(`${base}/api/tts/voices`)).json();
  ok('接口列出音色', api.ok && api.count > 0, `${api.count} 个${api.error ? ' · ' + api.error : ''}`);
  let rows = 0;
  for (let i = 0; i < 60 && !rows; i++) { rows = await evaluate(`document.querySelectorAll('#voices .vrow').length`); if (!rows) await sleep(250); }
  ok('页面列出同样多的音色', rows === api.count, `${rows} 行`);
  who = await evaluate(`(() => { const s = document.querySelector('#v-for'); return { name: s.value, display: s.options[s.selectedIndex].textContent }; })()`);
  const cfg = await (await fetch(`${base}/api/config`)).json();
  original = cfg.tutors.find((t) => t.name === who.name)?.voice ?? null;
  ok('「给谁挑」停在一位老师上', Boolean(who.name), `${who.display} 现在 ${original ?? '没配'}`);

  const firstTrait = await evaluate(`document.querySelector('#voices .vrow .vtrait')?.textContent ?? ''`);
  const word = firstTrait.slice(0, 2);
  const filtered = await evaluate(`(async () => { const i = document.querySelector('#voices .filters input[type=search]'); i.value = ${JSON.stringify(word)}; i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 100)); return document.querySelectorAll('#voices .vrow').length; })()`);
  ok(`搜「${word}」列表缩短且不为空`, filtered > 0 && filtered < rows, `${filtered} 行`);

  const picked = await evaluate(`(() => { const r = document.querySelector('#voices .vrow'); return { voice: r.querySelector('.vname span').textContent, name: r.querySelector('.vname b').textContent }; })()`);
  const played = await evaluate(`(async () => {
    const b = document.querySelector('#voices .vrow .play');
    b.click();
    for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 250)); if (b.textContent.includes('停')) return { state: 'playing', fb: document.querySelector('#voices .fb').textContent }; if (!b.classList.contains('on')) return { state: 'stopped', fb: document.querySelector('#voices .fb').textContent }; }
    return { state: 'timeout', fb: document.querySelector('#voices .fb').textContent };
  })()`);
  ok(`试听 ${picked.name}:合成完开播`, played.state === 'playing', JSON.stringify(played));
  await shot('voices-desktop.png', 1280, 900, 1);

  const chosen = await evaluate(`(async () => {
    const r = document.querySelector('#voices .vrow');
    const b = r.querySelector('.pick');
    if (!b) return { had: false };
    b.click();
    for (let i = 0; i < 40; i++) { await new Promise((r2) => setTimeout(r2, 250)); const now = document.querySelector('#voices .now'); if (now && now.textContent.includes(${JSON.stringify(picked.name)})) return { had: true, now: now.textContent }; }
    return { had: true, now: document.querySelector('#voices .now')?.textContent ?? '' };
  })()`);
  const after = await (await fetch(`${base}/api/config`)).json();
  const nowVoice = after.tutors.find((t) => t.name === who.name)?.voice ?? null;
  ok(`给 ${who.display} 用 → cotutor.json 里 voice 变成 ${picked.voice}`, chosen.had && nowVoice === picked.voice, JSON.stringify({ nowVoice, now: chosen.now }));
  const mine = await evaluate(`document.querySelector('#voices .vrow.mine .vname span')?.textContent ?? ''`);
  ok('那一行标成「就是这个」', mine === picked.voice);

  await shot('voices-phone.png', 390, 844, 2);
} catch (err) {
  console.error('✗ 探针出错:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  if (who && !keepVoice) {
    await fetch(`${base}/api/config`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tutors: { [who.name]: { voice: original } } }) }).catch(() => {});
    console.log(`  ${who.display} 的音色改回 ${original ?? '没配'}`);
  }
  ws.close();
  proc.kill();
}

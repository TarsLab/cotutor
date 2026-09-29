#!/usr/bin/env node
/**
 * 按住说话带原声(《家长录像设计.md》拍板 4)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱):
 * Chrome 用假麦克风(--use-fake-device-for-media-stream),语音识别换成页面加载前注入的假识别器(认出「Apple苹」,stop 了才 end);
 * 孩子端进语文老师 → 在输入条上按住 2 秒松手 → 拦下发出去的消息:字是认出的字,voice 是 data:audio/… 且秒数对得上;
 * 上滑取消的那次什么都不发。只验页面这一段(录、收尾、发);iPad 上识别与录音同开一路麦克风要真机看。
 *
 * 用法:node scripts/probe-voice.mjs [--keep](留下 mock)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const keep = process.argv.includes('--keep');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8796;
const cdp = 9338;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

// 假识别器:start 后 300ms 出字;stop 了才 end(和 Safari 一样,松手收尾时 settle 会 stop 它)
const FAKE_SR = `(() => {
  class FakeSR {
    constructor() { this.ls = {}; }
    addEventListener(k, f) { (this.ls[k] ||= []).push(f); }
    fire(k) { for (const f of this.ls[k] || []) f({}); }
    start() { setTimeout(() => { this.fire('start'); this.fire('audiostart'); if (this.onresult) this.onresult({ results: [[{ transcript: 'Apple苹' }]] }); }, 300); }
    stop() { setTimeout(() => { if (this.onend) this.onend(); }, 50); }
    abort() { setTimeout(() => { if (this.onend) this.onend(); }, 10); }
  }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  window.__sent = [];
  const f = window.fetch;
  window.fetch = (url, init) => { if (String(url).endsWith('/messages') && init && init.body) window.__sent.push(JSON.parse(init.body)); return f(url, init); };
})();`;

const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-voice-'));
const mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

let browser = null;
try {
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_SR });
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor` });
  await until(`document.querySelector('#tutor') && document.querySelector('#tutor').classList.contains('on') && document.querySelectorAll('#board .sec').length > 0`);
  await sleep(500);
  const where = await evaluate(`(() => { const r = document.querySelector('#mid').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const mouse = (type, y = where.y) => send('Input.dispatchMouseEvent', { type, x: where.x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });

  // ---- 按住 2 秒松手 ----
  await mouse('mousePressed');
  await sleep(2000);
  await mouse('mouseReleased');
  await until(`window.__sent.length > 0`, 30);
  const b = await evaluate(`window.__sent[0] ? { text: window.__sent[0].text, mime: String(window.__sent[0].voice && window.__sent[0].voice.audio).slice(0, 30), len: String(window.__sent[0].voice && window.__sent[0].voice.audio).length, seconds: window.__sent[0].voice && window.__sent[0].voice.seconds } : null`);
  ok('松手发出去:字是认出的字,带原声(data:audio/…,不空)', b && b.text === 'Apple苹' && b.mime.startsWith('data:audio/') && b.len > 200, JSON.stringify(b));
  ok('第一次(麦克风冷开):从麦克风真开了才录,和识别听到的一样短一截', b && b.seconds > 0.5 && b.seconds < 2, JSON.stringify(b && b.seconds));

  // ---- 上滑取消:不发 ----
  await until(`!document.body.classList.contains('pending')`, 40);
  await sleep(1500);
  const before = await evaluate(`window.__sent.length`);
  await mouse('mousePressed');
  await sleep(1200);
  await mouse('mouseMoved', where.y - 120);
  await sleep(200);
  await mouse('mouseReleased', where.y - 120);
  await sleep(2500);
  ok('上滑取消:什么都不发', (await evaluate(`window.__sent.length`)) === before);

  // ---- 麦克风开着了再按住 2 秒:录到的接近按住的时长 ----
  await mouse('mousePressed');
  await sleep(2000);
  await mouse('mouseReleased');
  await until(`window.__sent.length > ${before}`, 30);
  const hot = await evaluate(`(() => { const x = window.__sent[window.__sent.length - 1]; return x && x.voice ? x.voice.seconds : null; })()`);
  ok('麦克风开着:按住 2 秒录到 1.7–3 秒(按下 150ms 才算按住,松手后收尾一小会儿)', hot !== null && hot >= 1.7 && hot <= 3, JSON.stringify(hot));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  if (browser) browser.kill();
  if (!keep) { mock.kill(); await sleep(300); try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  else { mock.unref(); console.log(`mock 留着:${base}/`); }
}
process.exit(bad ? 1 : 0);

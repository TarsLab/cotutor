#!/usr/bin/env node
/**
 * 「新话题」打断配音的手动验收(不进 pnpm test:开一个看得见的 Chrome 窗口、要一个跑着的 serve、会出声):
 * 用 Chrome DevTools 协议开孩子端老师页 → 在输入条打字发一句(老师是假 CLI,配音是真 mp3)→ 用 Fetch 域把第一段 mp3 的请求按住几秒,
 * 让 audioEl.play() 停在 pending → 这时点头部「新话题」→ 放开请求 → 看 speechSynthesis 有没有被叫起来念旧话题那句。
 * 预期(修好后):板书清空、什么都不响;坏的时候:板书清空了却响起浏览器合成声念「先看三角形」。
 *
 * 用法:node scripts/probe-thread-voice.mjs [页面 URL]
 *   缺省 http://127.0.0.1:8791/?tutor=math-tutor(临时 workspace:runtimes 指 tests/_fake-cli.ts --stream,tts.say 走 voxtell,post.mode off)
 *   HOLD_MS=按住 mp3 请求的毫秒数(缺省 4000);KEEP_MS=跑完后窗口再留多久(缺省 6000)
 */
import { spawn } from 'node:child_process';

const url = process.argv[2] ?? 'http://127.0.0.1:8791/?tutor=math-tutor';
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOLD_MS = Number(process.env.HOLD_MS ?? 4000);
const KEEP_MS = Number(process.env.KEEP_MS ?? 6000);
const port = 9334;
const proc = spawn(chrome, ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, '--window-size=1180,820', '--user-data-dir=/tmp/cotutor-probe-voice-profile', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const listeners = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method && listeners.has(m.method)) listeners.get(m.method)(m.params);
};
const on = (method, fn) => listeners.set(method, fn);
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
const rectOf = (sel) => evaluate(`(() => { const el = document.querySelector('${sel}'); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const click = async (sel) => {
  const p = await rectOf(sel);
  if (!p) throw new Error(`点不到 ${sel}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
};
const waitFor = async (expr, ms = 15000, step = 200) => { for (let i = 0; i < ms / step; i++) { if (await evaluate(expr)) return true; await sleep(step); } return false; };
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
const log = (s) => console.log(`  · ${s}`);

let failed = false;
try {
  await send('Runtime.enable');
  await send('Page.enable');
  // 探针:记下每次 speechSynthesis.speak 的文字与 Audio.play 的 src
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__spoken = []; window.__played = [];
    const sp = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (u) => { window.__spoken.push({ text: u.text, at: Date.now() }); return sp(u); };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__played.push({ src: this.src, at: Date.now() }); return play.call(this); };
  ` });
  // 按住 mp3 请求:第一段配音一来就扣住 HOLD_MS,让 play() 停在 pending
  let held = null;
  const heldDone = new Promise((r) => { held = r; });
  let seen = 0;
  on('Fetch.requestPaused', async ({ requestId, request }) => {
    seen++;
    if (seen === 1) {
      log(`扣住第一段配音 ${HOLD_MS}ms:${request.url.replace(/^https?:\/\/[^/]+/, '')}`);
      held(requestId);
      await sleep(HOLD_MS);
      log('放开配音请求');
    }
    await send('Fetch.continueRequest', { requestId });
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/audio/*', requestStage: 'Request' }] });

  await send('Page.navigate', { url });
  ok('老师页开了', await waitFor(`Boolean(document.querySelector('#mid')) && !document.body.classList.contains('offline')`));
  await sleep(600);

  // 输入条:点中间 = 打字;敲一句含「板书 点读」的话,假 CLI 就出两张卡 + 一张点读卡
  await click('#mid');
  ok('进了打字态', await waitFor(`!document.querySelector('#typed').hidden`, 3000));
  await send('Input.insertText', { text: '板书 点读 讲讲三角形' });
  await sleep(300);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  log('发出去了,等老师板书 + 配音');

  // 等第一段 mp3 的请求被扣住(这时 audioEl.play() 正 pending)
  const gotHeld = await Promise.race([heldDone.then(() => true), sleep(60000).then(() => false)]);
  ok('第一段配音请求来了并被扣住', gotHeld);
  if (!gotHeld) throw new Error('没等到配音请求:serve 的 tts.say 配好了吗?');
  await sleep(400);
  const before = await evaluate(`({ cards: document.querySelectorAll('#board .c').length, spoken: window.__spoken.length, played: window.__played.length })`);
  ok('板书铺了卡、mp3 已经叫了 play()、浏览器合成声还没响', before.cards > 0 && before.played > 0 && before.spoken === 0, JSON.stringify(before));

  // 关键一步:mp3 还没放出来就点「新话题」
  ok('头部有「新话题」钮', Boolean(await rectOf('#new-btn')));
  await click('#new-btn');
  log('点了「新话题」');
  ok('板书清空成空白态', await waitFor(`Boolean(document.querySelector('#board .blank')) && document.querySelectorAll('#board .c').length === 0`, 3000));

  // 放开请求之后再看:合成声被叫了吗?在响吗?
  await sleep(HOLD_MS + 1500);
  const after = await evaluate(`({ spoken: window.__spoken.map((s) => s.text), speaking: speechSynthesis.speaking || speechSynthesis.pending, audioPaused: (() => { const a = document.querySelector('audio'); return a ? a.paused : 'no-el'; })() })`);
  const strayVoice = after.spoken.length > 0;
  ok('新话题之后没有响起浏览器合成声(旧话题那句不该被念)', !strayVoice, strayVoice ? `念了:${JSON.stringify(after.spoken)}` : '');
  ok('此刻没有任何声音在放', !after.speaking, JSON.stringify(after));
  failed = strayVoice || after.speaking;
  log(`窗口再留 ${KEEP_MS}ms 给你看`);
  await sleep(KEEP_MS);
} catch (e) {
  failed = true;
  console.error('✗ 探针出错:', e.message);
} finally {
  try { ws.close(); } catch {}
  proc.kill();
  process.exit(failed ? 1 : 0);
}

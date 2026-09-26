#!/usr/bin/env node
/**
 * 录音卡的手动验收(《口播老师设计.md》§3;不进 pnpm test,要本机 Chrome 与一个跑着的 mock / serve):
 * Chrome 带假麦克风(--use-fake-device-for-media-stream,给了 wav 就放那个文件)→ 开口播老师第一节、舞台开在第一张录音卡 →
 * 用 CDP 的鼠标事件在大圆键上按住 1.5 秒再松手 → 查状态回来了、主键是「下一句」→ 三张录满 → 主键「交给老师」→ 交了这一节锁住。
 * 另查:按下时计时出来、往上滑 60px 松手不存。可选每一步截图(--shots <目录>,Page.captureScreenshot 卡住就跳过)。
 *
 * 用法:node scripts/probe-record.mjs [页面 URL] [--wav <16k 或任意格式的录音>] [--shots <目录>]
 *   缺省 http://127.0.0.1:8790/?tutor=koubo-tutor&step=0.0&stage=0.1(先给口播老师发一条消息,mock 里第一节就有了)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const wav = opt('--wav');
const shots = opt('--shots');
const url = args[0] ?? 'http://127.0.0.1:8790/?tutor=koubo-tutor&step=0.0&stage=0.1';
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9334;
const flags = ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--window-size=390,844', '--force-device-scale-factor=2', '--user-data-dir=/tmp/cotutor-probe-record', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...(wav ? [`--use-file-for-fake-audio-capture=${wav}`] : []), url];
const proc = spawn(chrome, flags, { stdio: 'ignore' });
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
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
let shotN = 0;
const shot = async (name) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  const r = await Promise.race([send('Page.captureScreenshot', { format: 'png' }), sleep(4000).then(() => null)]);
  if (r?.result?.data) writeFileSync(join(shots, `${String(++shotN).padStart(2, '0')}-${name}.png`), Buffer.from(r.result.data, 'base64'));
};
/** 按住大圆键 ms 毫秒;up 像素 = 松手前往上滑多少 */
const hold = async (ms, up = 0) => {
  const b = await evaluate(`(() => { const r = document.querySelector('#st-body .rc-mic').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await mouse('mousePressed', b.x, b.y);
  await sleep(ms / 2);
  const during = await evaluate(`({ rec: document.querySelector('#st-body .c-record')?.classList.contains('rec'), tm: document.querySelector('#st-body .rc-tm')?.textContent })`);
  if (up) { await mouse('mouseMoved', b.x, b.y - up / 2); await mouse('mouseMoved', b.x, b.y - up); }
  await sleep(ms / 2);
  await shot(up ? 'cancel' : 'holding');
  await mouse('mouseReleased', b.x, b.y - up);
  await sleep(900);
  return during;
};
const stageInfo = () => evaluate(`({ title: document.querySelector('#st-ttl')?.textContent, go: document.querySelector('#st-go')?.textContent, disabled: document.querySelector('#st-go')?.disabled, actHidden: document.querySelector('#st-act')?.hidden, note: document.querySelector('#st-note')?.textContent, mine: document.querySelector('#st-body .rc-top .rc-pl')?.textContent ?? '' })`);

const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
try {
  await send('Runtime.enable');
  await send('Page.enable');
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { ready = await evaluate(`Boolean(document.querySelector('#stage.on #st-body .rc-mic'))`); if (!ready) await sleep(250); }
  ok('舞台开在录音卡上,有大圆键', ready);
  await shot('stage');
  const s0 = await stageInfo();
  ok('没录:主键「下一句」灰着', s0.disabled === true && s0.go === '下一句' && /先听/.test(s0.note), JSON.stringify(s0));

  const c = await hold(1200, 90);
  ok('按下:计时出来,在录', c.rec === true && /^0:0\d$/.test(c.tm ?? ''), JSON.stringify(c));
  const s1 = await stageInfo();
  ok('往上滑松手:不存,还是没录', s1.disabled === true && !/听我的/.test(s1.mine), JSON.stringify(s1));

  const d = await hold(1600);
  ok('再按住:在录', d.rec === true, JSON.stringify(d));
  let s2 = await stageInfo();
  for (let i = 0; i < 20 && !/听我的/.test(s2.mine); i++) { await sleep(250); s2 = await stageInfo(); }
  await shot('recorded');
  ok('松手:录好了(听我的 · 秒数),主键「下一句」亮了', /听我的 · 1\.\d 秒/.test(s2.mine) && s2.go === '下一句' && s2.disabled === false, JSON.stringify(s2));
  const tutorUrl = new URL('/api/kid/conversations/koubo-tutor/today', url).href;
  const saved = await evaluate(`(async () => { for (let i = 0; i < 20; i++) { const d = await (await fetch(${JSON.stringify(tutorUrl)})).json(); const c = d.messages[0].section.cards.find((x) => x.kind === 'record' && x.state); if (c && c.state.audio) return c.state.audio; await new Promise((r) => setTimeout(r, 200)); } return ''; })()`);
  ok('服务端落盘,状态换成路径', /^conversations\/koubo-tutor\/.+\/rec-1\.(webm|m4a)$/.test(saved), saved);

  // 下一句 → 第二张、第三张
  for (const n of [2, 3]) {
    await evaluate(`document.querySelector('#st-go').click()`);
    await sleep(500);
    const t = await stageInfo();
    ok(`「下一句」切到第 ${n} 张`, /录音|老师|四是四/.test(t.title ?? '') && t.disabled === true, JSON.stringify(t));
    await hold(1300);
  }
  const s3 = await stageInfo();
  await shot('last');
  ok('三张都录了:主键「交给老师」', s3.go === '交给老师' && s3.disabled === false, JSON.stringify(s3));
  await evaluate(`document.querySelector('#st-go').click()`);
  await sleep(1500);
  const locked = await evaluate(`[...document.querySelectorAll('[data-sec="0"] .c-record')].map((e) => e.classList.contains('locked'))`);
  ok('交了:这一节的录音卡都锁住', Array.isArray(locked) && locked.length === 3 && locked.every(Boolean), JSON.stringify(locked));
  let next = 0;
  for (let i = 0; i < 40 && next < 2; i++) { next = await evaluate(`document.querySelectorAll('#board .sec').length`); if (next < 2) await sleep(250); }
  await shot('append');
  ok('老师的下一节来了', next >= 2, String(next));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  ws.close();
  proc.kill();
}

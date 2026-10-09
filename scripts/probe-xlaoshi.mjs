#!/usr/bin/env node
/**
 * 小老师的手动验收(不进 pnpm test,要本机 Chrome 与一个跑着的 serve;《wip/小老师设想.md》):
 * 出题 → 开始讲(假麦克风放一段 wav,当孩子在说)→ 用 CDP 的鼠标画几笔 → 讲完了 → 回看页出转写(无头 Chrome 的浏览器识别多半认不出字,
 * 就会自动叫 paraformer,要本机拿得到百炼 key)→ 写一份 notes.md(当 Claude Code)→ 初步理解页 → 追问:放那段、画一画、录、记一笔、问完了。
 * 每屏截一张图到 XLAOSHI_SHOTS 目录(给了才截)。
 *
 * 用法:node scripts/probe-xlaoshi.mjs [服务地址] [workspace 根]
 *   XLAOSHI_WAV=<16k 单声道 wav> 当麦克风的声音(不给就是 Chrome 的假哔声)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:8797';
const wsRoot = process.argv[3] ?? null;
const shots = process.env.XLAOSHI_SHOTS ?? null;
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9341;
const args = [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--window-size=1180,820', '--user-data-dir=/tmp/cotutor-probe-xlaoshi', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
if (process.env.XLAOSHI_WAV) args.push(`--use-file-for-fake-audio-capture=${process.env.XLAOSHI_WAV}`);
const proc = spawn(chrome, [...args, `${base}/xlaoshi`], { stdio: 'ignore' });
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
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails?.exception?.description ?? JSON.stringify(m.params.exceptionDetails));
};
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
const ok = (name, cond, detail = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); if (!cond) process.exitCode = 1; };
const until = async (expr, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await evaluate(expr); if (v) return v; await sleep(200); } return null; };
const center = (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const mouse = (type, x, y, buttons = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
const tap = async (sel) => { const [x, y] = await center(sel); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y, 0); await sleep(150); };
const stroke = async (pts) => { await mouse('mousePressed', ...pts[0]); for (const p of pts.slice(1)) { await mouse('mouseMoved', ...p); await sleep(16); } await mouse('mouseReleased', ...pts[pts.length - 1], 0); await sleep(120); };
const shot = async (name) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  const r = await Promise.race([send('Page.captureScreenshot', { format: 'png' }), sleep(8000).then(() => null)]);
  if (r?.result?.data) writeFileSync(join(shots, `${name}.png`), Buffer.from(r.result.data, 'base64'));
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);
  ok('出题页开了', await until(`document.querySelector('#v-list').classList.contains('on') && document.querySelector('#sessions') !== null`));
  await evaluate(`document.querySelector('#topic').value = '18 张贴纸平均分给 3 个人,每人几张?讲给我听。'`);
  await shot('1-list');
  await tap('#go');
  ok('交给他 → 进画板,先是「开始讲」', await until(`location.hash.startsWith('#/talk/') && !document.querySelector('#start').hidden`));
  const id = await evaluate(`location.hash.split('/')[2]`);
  await tap('#start-btn');
  ok('开始讲 → 在录、讲完了能按', await until(`document.querySelector('#rec').classList.contains('on') && !document.querySelector('#done-btn').disabled`, 10000));
  const box = await evaluate(`(() => { const r = document.querySelector('#board').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
  const [L, T] = box;
  // 三个人(竖线)、一行六个圈(短横)、红笔圈起来
  for (let i = 0; i < 3; i++) await stroke([[L + 80, T + 80 + i * 110], [L + 80, T + 130 + i * 110]]);
  await sleep(2500);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) await stroke([[L + 160 + k * 60, T + 100 + r * 110], [L + 180 + k * 60, T + 92 + r * 110], [L + 190 + k * 60, T + 108 + r * 110], [L + 165 + k * 60, T + 112 + r * 110]]);
  await tap('#tools .dot[data-color="#d23f1f"]');
  await sleep(2000);
  await stroke([[L + 140, T + 70], [L + 300, T + 60], [L + 520, T + 70], [L + 540, T + 130], [L + 300, T + 140], [L + 140, T + 130], [L + 140, T + 70]]);
  await tap('#undo');
  await stroke([[L + 140, T + 70], [L + 520, T + 66], [L + 540, T + 130], [L + 140, T + 132]]);
  await shot('2-talk');
  await sleep(Math.max(0, 16_000 - 8000));
  await tap('#done-btn');
  ok('讲完了 → 回看页', await until(`location.hash.startsWith('#/review/')`, 20000));
  const s0 = await (await fetch(`${base}/api/xlaoshi/${id}`)).json();
  ok('存上了:讲了十几秒、笔迹、原声、音量', s0.ms > 10_000 && s0.strokes >= 22 && s0.talk?.audio && s0.talk.levels.length > 80, JSON.stringify({ ms: s0.ms, strokes: s0.strokes, audio: s0.talk?.audio, levels: s0.talk?.levels.length, sr: s0.talk?.sr, segs: s0.talk?.segs.length, asr: s0.asr }));
  const undone = s0.strokesData.strokes.filter((x) => x.gone !== undefined).length;
  ok('撤销记成那一笔的 gone,笔不删', undone === 1, String(undone));
  // 等转写:浏览器认出了就有;没认出(无头 Chrome 常这样)就等 paraformer
  let lines = 0;
  for (let i = 0; i < 90 && !lines; i++) { await sleep(1000); const s = await (await fetch(`${base}/api/xlaoshi/${id}`)).json(); lines = s.lines.length; if (s.asr?.state === 'failed' || s.asr?.state === 'nokey') { ok('补转', false, JSON.stringify(s.asr)); break; } }
  const s1 = await (await fetch(`${base}/api/xlaoshi/${id}`)).json();
  ok('有转写了', lines > 0, JSON.stringify({ source: s1.transcript?.source, why: s1.why, asr: s1.asr, lines: s1.lines }));
  ok('回看页跟着刷新出转写行', await until(`document.querySelectorAll('#rv-lines .ln').length > 0`, 8000));
  await evaluate(`document.querySelector('#rv-play').click()`);
  await sleep(1500);
  const tm = await evaluate(`document.querySelector('#rv-tm').textContent`);
  ok('放:从头放、时间在走', /^0:0[1-3] /.test(tm), tm);
  await evaluate(`document.querySelector('#rv-play').click()`);
  await evaluate(`document.querySelector('#rv-lines .ln .tx').click()`);
  await sleep(100);
  await evaluate(`(() => { const i = document.querySelector('#rv-lines .ln input'); i.value = i.value + '(家长改)'; i.blur(); })()`);
  ok('改一行字 → 标「改过」', await until(`Boolean(document.querySelector('#rv-lines .chip.b'))`, 5000));
  await shot('3-review');

  if (wsRoot) {
    writeFileSync(join(wsRoot, 'xlaoshi', id, 'notes.md'), `# 初步理解\n\n## 讲到了\n- 三个人、十八个 @0:04\n\n## 说的和画的对不上\n- 说「一个一个地分」,可画圈时已经一行六个 @0:04-0:11\n\n## 还没讲到\n- 为什么要一样多\n\n## 追问\n- [x] 你说一个一个地分,再分一次给我看好吗? @0:04-0:11\n  放他讲的那段,让他重画\n- [x] 要是有一个人分到 7 张,还叫平均分吗?\n- [ ] 18 ÷ 3 里的 3,在你的画里是哪个?\n`);
    ok('写了 notes.md → 回看页亮「看初步理解」', await until(`Boolean(document.querySelector('#cc-next a'))`, 8000));
    await evaluate(`location.hash = '#/notes/${id}'`);
    ok('初步理解页:三节 + 追问 3 条,开始追问 · 2 个', await until(`document.querySelectorAll('#nt-left h3').length === 3 && document.querySelectorAll('#nt-right .q').length === 3 && /2 个/.test(document.querySelector('#nt-right .pill.main').textContent)`, 5000));
    await shot('4-notes');
    await tap('#nt-right .pill.main');
    ok('当面追问:第 1 个', await until(`location.hash === '#/ask/${id}/1' && document.querySelector('#ak-q').textContent.includes('再分一次')`, 5000));
    await tap('#ak-play');
    await sleep(1200);
    await tap('#ak-draw');
    const ab = await evaluate(`(() => { const r = document.querySelector('#ak-board').getBoundingClientRect(); return [r.left, r.top]; })()`);
    await stroke([[ab[0] + 40, ab[1] + 40], [ab[0] + 140, ab[1] + 80], [ab[0] + 200, ab[1] + 60]]);
    await tap('#ak-rec');
    await sleep(3500);
    await tap('#ak-rec');
    await sleep(800);
    await evaluate(`document.querySelector('#ak-note').value = '这次是轮着分的'`);
    await shot('5-ask');
    await tap('#ak-next');
    ok('下一个 → 第 2 个', await until(`location.hash === '#/ask/${id}/2'`, 8000));
    await tap('#ak-next');
    ok('问完了 → 回初步理解', await until(`location.hash === '#/notes/${id}'`, 8000));
    const s2 = await (await fetch(`${base}/api/xlaoshi/${id}`)).json();
    ok('追问的回答存了一条(第 2 个什么都没录,不存)', s2.asks === 1 && s2.asksData[0].audio && s2.asksData[0].drew === 1 && s2.asksData[0].note === '这次是轮着分的', JSON.stringify(s2.asksData));
  }
  ok('页面没有抛错', logs.length === 0, logs.join(' | '));
} catch (err) {
  console.error('✗ 探针出错:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  ws.close();
  proc.kill();
}

#!/usr/bin/env node
/**
 * 工作台 /dev 的手动验收(不进 pnpm test,要本机 Chrome 与一个跑着的 serve;只看不改,不发消息、不花钱):
 * 概览(数字与 /api/dev/overview 对得上、跑一次体检)→ 对话(选第一位有话的老师,板书与轮次出来)→ 看原文(六站、原文行)→
 * 老师团(展开第一行)→ activity(原文与底色层对齐、改一处标出要改的行、预览、和出厂比、撤销,不存;新话题 = 老师文件同样走一遍,老师团跳过来)→ 音色 → 设置;
 * 每屏桌面截一张,概览与对话再截手机尺寸。工作台的样子见《工作台设计.md》。
 *
 * 用法:node scripts/probe-dev.mjs [--base http://127.0.0.1:5180] [--shots <目录>]
 */
import { spawn } from './_guard.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIET_ARGS, quiet } from './_quiet.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://127.0.0.1:5180');
const shots = arg('--shots', '');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9337;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); if (!cond) process.exitCode = 1; };

const proc = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--window-size=1440,960', '--user-data-dir=/tmp/cotutor-probe-dev-profile', `${base}/dev#overview`], { stdio: 'ignore' });

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
const waitFor = async (expression, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(expression)) return true; await sleep(150); } return false; };
const shot = async (name, width = 1440, height = 960, scale = 1) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: scale > 1 });
  await sleep(400);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shots, name), Buffer.from(r.result.data, 'base64'));
  console.log(`  截图 ${join(shots, name)}`);
};
// 手指走 CDP 的鼠标事件(走命中判定),不用 dispatchEvent
const click = async (selector) => {
  const box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!box) throw new Error('点不到 ' + selector);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
};
// 按一段表达式找元素再点(按文字找按钮用)
const clickEl = async (expr) => {
  const box = await evaluate(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!box) throw new Error('点不到 ' + expr);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await quiet(send);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

  // 概览
  ok('概览出来了', await waitFor(`document.querySelector('#overview.on .bars .b') !== null`));
  const api = await (await fetch(`${base}/api/dev/overview`)).json();
  const shown = await evaluate(`document.querySelector('#overview .hero .big')?.textContent`);
  ok('今天的轮数与接口一致', shown === String(api.todayTurns), `页面 ${shown} / 接口 ${api.todayTurns}`);
  ok('七根柱子', (await evaluate(`document.querySelectorAll('#overview .bars .b').length`)) === 7);
  ok('侧栏当前是概览', (await evaluate(`document.querySelector('#side a.on')?.dataset.tab`)) === 'overview');
  await click('#overview .blk .btn.small');
  ok('体检跑完有结果', await waitFor(`document.querySelectorAll('#overview .checks .ck').length > 0`, 60000));
  await shot('dev-overview.png');
  await shot('dev-overview-phone.png', 390, 844, 2);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

  // 对话:挑最近一轮所在的老师与日期
  await click('#side a[data-tab=chat]');
  ok('对话:有老师', await waitFor(`document.querySelectorAll('#tutors .tutor').length > 0`));
  if (api.last) {
    await evaluate(`location.hash = '#overview'`);
    await click('#side a[data-tab=overview]');
    await waitFor(`document.querySelector('#overview .tiles button:nth-child(2)') !== null`);
    await click('#overview .tiles button:nth-child(2)');
    ok('「看原文」直达最近一轮', await waitFor(`document.querySelector('#drawer.on .rl') !== null || document.querySelector('#drawer.on .dsec') !== null`, 10000));
    await shot('dev-raw.png');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    ok('Esc 关掉看原文', await waitFor(`!document.querySelector('#drawer.on')`));
    ok('轮次出来了', await waitFor(`document.querySelectorAll('#msgs .turn').length > 0`));
    await evaluate(`(() => { const m = document.querySelector('#msgs'); m.scrollTop = m.scrollHeight; })()`);
  }
  await shot('dev-chat.png');
  await shot('dev-chat-phone.png', 390, 844, 2);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

  // 老师团、音色、设置
  await click('#side a[data-tab=team]');
  ok('老师团:有名单', await waitFor(`document.querySelectorAll('#team .roster .row').length > 0`));
  await click('#team .roster .row');
  ok('展开一行', await waitFor(`[...document.querySelectorAll('#team .rowbody')].some((b) => b.style.display !== 'none')`));
  await shot('dev-team.png');
  // activity:只看,改了不存,最后撤销
  await click('#side a[data-tab=activity]');
  ok('activity:列表与原文出来了', await waitFor(`document.querySelectorAll('#activity .ai').length > 0 && document.querySelector('#activity .eta') !== null`));
  if (await evaluate(`[...document.querySelectorAll('#activity .ai')].some((b) => b.textContent.includes('你说我画'))`)) {
    await clickEl(`[...document.querySelectorAll('#activity .ai')].find((b) => b.textContent.includes('你说我画'))`);
    await waitFor(`document.querySelector('#activity .ehead h2')?.textContent === '你说我画'`);
  }
  ok('activity:检查跑完、节出来了', await waitFor(`document.querySelector('#activity .aside .srow .st') !== null && document.querySelectorAll('#activity .secs button').length > 1`));
  ok('activity:原文与底色层同高(折行对得齐)', await evaluate(`(() => { const ta = document.querySelector('#activity .eta'); const bd = document.querySelector('#activity .bd'); return Math.abs(ta.offsetHeight - bd.scrollHeight) <= 2 && bd.children.length === ta.value.split('\\n').length; })()`));
  const name = await evaluate(`document.querySelector('#activity .ehead h2').textContent`);
  const tutor = await evaluate(`new URLSearchParams(location.hash.split('?')[1]).get('a').split('/')[0]`);
  const diskBefore = (await (await fetch(`${base}/api/dev/activities/${tutor}/${encodeURIComponent(name)}`)).json()).text;
  await shot('dev-activity.png');
  const edited = await evaluate(`(() => { const ta = document.querySelector('#activity .eta'); if (!ta.value.includes('## 老师怎么带\\n')) return false; ta.value = ta.value.replace('## 老师怎么带\\n', '## 老师怎么带\\n{{有 探针}}\\n{{/有}}\\n'); ta.dispatchEvent(new Event('input')); return true; })()`);
  if (edited) {
    ok('activity:改一处 → 标出要改的行、页头写没存', await waitFor(`document.querySelector('#activity .ln.bad') !== null && document.querySelector('#activity .iss.fix') !== null && document.querySelector('#activity .ehead .dirty') !== null`));
    await shot('dev-activity-bad.png');
    await click('#activity .aside .seg button:nth-child(2)');
    ok('activity:老师收到什么', await waitFor(`document.querySelector('#activity .pv') !== null || document.querySelector('#activity .aside .note') !== null`));
    await shot('dev-activity-preview.png');
    await click('#activity .aside .seg button:nth-child(3)');
    ok('activity:和出厂比有这一处', await waitFor(`document.querySelector('#activity .hunk') !== null || document.querySelector('#activity .aside .body .note') !== null`));
    await shot('dev-activity-diff.png');
    await clickEl(`[...document.querySelectorAll('#activity .ehead .btn')].find((b) => b.textContent === '撤销')`);
    ok('activity:撤销后都存了', await waitFor(`document.querySelector('#activity .ehead .dirty') === null && document.querySelector('#activity .ln.bad') === null`));
  }
  const diskAfter = (await (await fetch(`${base}/api/dev/activities/${tutor}/${encodeURIComponent(name)}`)).json()).text;
  ok('activity:磁盘上那份没动', diskAfter === diskBefore);
  // 新话题(老师文件,拍板 11):同一个编辑器;改坏 name 标要改、保存拦住,预览是去掉 frontmatter 的正文,撤销,不存
  await clickEl(`document.querySelector('#activity .ai.tf')`);
  ok('新话题:点开老师文件', await waitFor(`document.querySelector('#activity .ehead h2')?.textContent === '新话题' && document.querySelector('#activity .ehead .l2').textContent.includes('.claude/agents/')`));
  const tfTutor = await evaluate(`new URLSearchParams(location.hash.split('?')[1]).get('a')`);
  const tfBefore = (await (await fetch(`${base}/api/dev/tutor-files/${tfTutor}`)).json()).text;
  ok('新话题:检查跑完、节有头和开头', await waitFor(`document.querySelector('#activity .aside .srow .st') !== null && [...document.querySelectorAll('#activity .secs b')].map((b) => b.textContent).slice(0, 2).join() === '头,开头'`));
  await click('#activity .aside .seg button:nth-child(2)');
  ok('新话题:老师收到什么是正文,不带 frontmatter', await waitFor(`(() => { const pv = document.querySelector('#activity .aside .pv'); return pv !== null && !pv.textContent.startsWith('---') && !pv.textContent.includes('maxTurns'); })()`));
  await shot('dev-tutorfile-preview.png');
  await evaluate(`(() => { const ta = document.querySelector('#activity .eta'); ta.value = ta.value.replace(/^name: .*$/m, 'name: 改坏了'); ta.dispatchEvent(new Event('input')); })()`);
  await click('#activity .aside .seg button:nth-child(1)');
  ok('新话题:改坏 name → 标要改', await waitFor(`document.querySelector('#activity .ln.bad') !== null && document.querySelector('#activity .iss.fix') !== null`));
  await clickEl(`[...document.querySelectorAll('#activity .ehead .btn')].find((b) => b.textContent === '保存')`);
  ok('新话题:要改的不存,底栏说为什么', await waitFor(`document.querySelector('#activity .ebar .bad')?.textContent.includes('改好才能存')`));
  await shot('dev-tutorfile-bad.png');
  await clickEl(`[...document.querySelectorAll('#activity .ehead .btn')].find((b) => b.textContent === '撤销')`);
  ok('新话题:撤销后都存了', await waitFor(`document.querySelector('#activity .ehead .dirty') === null`));
  ok('新话题:磁盘上那份没动', (await (await fetch(`${base}/api/dev/tutor-files/${tfTutor}`)).json()).text === tfBefore);
  // 老师团的「改老师文件 →」跳到这位老师的新话题
  await click('#side a[data-tab=team]');
  await waitFor(`document.querySelector('#team .roster .row') !== null`);
  await click('#team .roster .row');
  await waitFor(`[...document.querySelectorAll('#team .btn')].some((b) => b.textContent === '改老师文件 →' && b.offsetParent)`);
  await clickEl(`[...document.querySelectorAll('#team .btn')].find((b) => b.textContent === '改老师文件 →' && b.offsetParent)`);
  ok('老师团:改老师文件 → 跳到 activity 的新话题', await waitFor(`location.hash.startsWith('#activity') && document.querySelector('#activity .ehead h2')?.textContent === '新话题' && document.querySelector('#activity .ai.tf.on') !== null`));

  await click('#side a[data-tab=voices]');
  ok('音色页出来了', await waitFor(`document.querySelector('#voices .panel') !== null`));
  await sleep(1500);
  await shot('dev-voices.png');
  await click('#side a[data-tab=settings]');
  ok('设置页出来了', await waitFor(`document.querySelector('#settings .pathrow') !== null`));
  await shot('dev-settings.png');
} finally {
  ws.close();
  proc.kill();
}

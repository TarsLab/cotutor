#!/usr/bin/env node
/**
 * 铺孩子拍的照片的一节课(数学「检查作业」,activity 头上 base: photo)孩子端整条线的手动验收:不进 pnpm test,要本机 Chrome;假百炼 + 假老师 + 假看图,不花钱。
 * 本进程起服务(临时 workspace;vault 的 教材/数学二年级上册/ 里放一张作业图当「课本页」,选它就当孩子拍的照片发;认字是假的,回一道第 3 题和一行字),无头 Chrome 开孩子端:
 *  一、首页点数学的「检查作业」方砖:先到拍照屏(拍照、相册、选课本页、不拍用白纸),不发东西。
 *  二、选那一页:照片马上铺上照片页(舞台 book.tsx 画一张),不等老师;顶栏有拍照、相册。
 *  三、孩子说「讲题吧」:老师写 [[看 第 3 题]] [[圈 心理辅导室]] [[请 圈]],念完那一句落上:窗移到第 3 题、「心理辅导室」圈上了。
 *  四、笔画一道:「给老师看」出现;按它:舞台先交窗里的图(shot),再发一条交了(action submit)。
 *  五、口语课(英语老师的第四块方砖,头上 base: photo + listen: open):不拍用白纸进来,一直听;老师的热身 [[请 说 duck]] 念完轮到他说,他说了 duck 接着念下一拍。
 * iPad 横屏各截一张。
 * 用法:node scripts/probe-photo-page.mjs [--photo <作业照片>] [--out <截图目录>]
 */
import { probeDir, spawn } from './_guard.mjs';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const photo = resolve(opt('--photo') ?? join(repo, 'grades', 'grade-2', 'agents', 'math-tutor', 'activities', '例子图', '疏散图-填错.jpg'));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdp = 9361;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
const tmp = probeDir('cotutor-probe-photo-page-');
const shots = opt('--out') ?? join(tmp, 'shots');
mkdirSync(shots, { recursive: true });
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import(join(repo, 'src', 'app', 'cli', 'init.ts'));
const { loadWorkspace } = await import(join(repo, 'src', 'app', 'workspace.ts'));
const { createContext, createHandler } = await import(join(repo, 'src', 'app', 'http', 'app.ts'));
const { makeLiveUpgrade } = await import(join(repo, 'src', 'app', 'ws', 'route.ts'));
const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));
const { startFakeTeacher } = await import(join(repo, 'tests', '_fake-teacher.ts'));

// 假看图:这一张认出一道第 3 题(框住整张)和 (1) 那一行
const LINES = [
  '{"full": "2.下面是某小学一层安全疏散示意图。", "box": [50, 45, 540, 90]}',
  '{"full": "(1)心理辅导室的东面有(美术教室)和(楼梯)。", "box": [64, 638, 700, 686]}',
  '{"question": "3", "box": [40, 30, 980, 900]}',
];
const look = async (o) => { o.onDelta?.(`${LINES.join('\n')}\n`); return { ok: true, text: LINES.join('\n'), ms: 5 }; };

const fake = await startFakeRealtime();
fake.audioMs = 300;
const teacher = await startFakeTeacher();
process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.runtimes = { default: 'stream', stream: { api: 'bailian', model: 'fake-stream' } };
for (const t of Object.values(cfg.tutors)) delete t.runtime;
cfg.live = { voices: { 'math-tutor': 'Serena', 'english-tutor': 'Theo Calm' } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const wsx = loadWorkspace(wsRoot);
mkdirSync(join(wsx.paths.textbooks, '数学二年级上册'), { recursive: true });
copyFileSync(photo, join(wsx.paths.textbooks, '数学二年级上册', '42.jpg'));
const ctx = createContext(wsx, { look });
await ctx.reload();
const upgrade = makeLiveUpgrade({ endpoint: fake.endpoint });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const T = 'math-tutor';

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--no-sandbox', '--hide-scrollbars', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${cdp}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  const errors = [];
  const frames = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Network.webSocketFrameSent' && m.params.response.opcode === 1) { try { frames.push(JSON.parse(m.params.response.payloadData)); } catch {} }
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shots, n), Buffer.from(r.result.data, 'base64')); return join(shots, n); };
  const until = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 200) { const v = await evaluate(expr); if (v) return v; await sleep(200); } return null; };
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 0 : 1, clickCount: 1 });
  const tapAt = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await sleep(50); await mouse('mouseReleased', x, y); };
  const STAGE = `document.querySelector('#st-frame')?.contentDocument`;
  const stageEval = (js) => evaluate(`(() => { const d = ${STAGE}; if (!d) return null; return (${js})(d, document.querySelector('#st-frame').getBoundingClientRect()); })()`);
  const center = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  const day = async (tutor = T) => (await (await fetch(`${base}/api/kid/conversations/${tutor}/today`)).json());
  const idle = async () => { for (let i = 0; i < 60 && (await day()).messages?.some((m) => m.result === 'running'); i++) await sleep(250); };
  const say = async (text) => {
    const n0 = (await day()).messages?.length ?? 0;
    for (let k = 0; k < 3; k++) {
      fake.kidTexts.push(text);
      const h = (await center('#cv-hold')) ?? (await center('#lv-hold'));
      await mouse('mouseMoved', h.x, h.y);
      await mouse('mousePressed', h.x, h.y);
      await sleep(1200);
      await mouse('mouseReleased', h.x, h.y);
      for (let i = 0; i < 20; i++) { if (((await day()).messages?.length ?? 0) > n0) return true; await sleep(250); }
      fake.kidTexts.length = 0;
    }
    return false;
  };
  const pageState = () => stageEval(`(d) => ({ phase: d.querySelector('.bk-board')?.dataset.phase ?? null, pages: d.querySelectorAll('.bk-page').length, rings: d.querySelectorAll('.bk-ring').length, inks: d.querySelectorAll('.bk-ink path').length })`);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });

  // 一、首页点数学的「检查作业」
  await send('Page.navigate', { url: `${base}/` });
  // 老师牌叠着:先把数学的牌翻到前面(直接点它的元素;叠着的牌坐标会落在别的牌上),再用鼠标点它的方砖
  await until(`Boolean(document.querySelector('[data-tutor="math-tutor"]'))`);
  await evaluate(`document.querySelector('[data-tutor="math-tutor"]').click(), true`);
  await until(`document.querySelector('[data-tutor="math-tutor"]').classList.contains('front')`, 5000);
  await sleep(800);
  const tile = await until(`(() => { const b = document.querySelector('[data-tutor="math-tutor"] .bt-tile[data-tile="check"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  ok('首页有数学的「检查作业」方砖', Boolean(tile));
  await tapAt(tile.x, tile.y);
  // 「选课本页」等课本页的清单拉回来才插进去:等它(拉不回来 until 到时候照样往下走,下面那条就红)
  const start = await until(`(() => { const b = document.querySelector('#board .bp-start'); const t = b ? [...b.querySelectorAll('.ask-go')].map((x) => x.textContent.trim()) : null; return t && t.includes('选课本页') ? t : null; })()`) ?? (await evaluate(`[...document.querySelectorAll('#board .bp-start .ask-go')].map((x) => x.textContent.trim())`));
  ok('点方砖:先到拍照屏(拍照、选课本页、从相册选、不拍用白纸),不发东西', Array.isArray(start) && start.includes('拍照') && start.includes('不拍,用白纸') && start.includes('选课本页') && !((await day()).messages?.length), JSON.stringify(start));
  console.log('  ', await shot('1-拍照屏.png'));

  // 二、选那一页课本页(当孩子拍的照片发):马上铺上照片页
  // 实时页上拍照屏的几颗在左栏(#lv-acts,照板上那块 .blank 的 _open 画的)
  await until(`[...document.querySelectorAll('#lv-acts .lv-go, #board .ask-go')].some((x) => x.textContent.includes('选课本页'))`, 5000);
  const tb = await evaluate(`(() => { const b = [...document.querySelectorAll('#lv-acts .lv-go, #board .ask-go')].find((x) => x.textContent.includes('选课本页') && x.getBoundingClientRect().width > 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tapAt(tb.x, tb.y);
  const pg = await until(`(() => { const b = document.querySelector('#tbk.on .pg'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tapAt(pg.x, pg.y);
  const laid = await until(`(() => { const d = ${STAGE}; return d && d.querySelector('.bk-board')?.dataset.phase === 'ready' && d.querySelectorAll('.bk-page').length === 1; })()`, 20000);
  const top = await evaluate(`({ ph: document.querySelector('#stage').classList.contains('ph'), cam: getComputedStyle(document.querySelector('#st-bp')).display })`);
  ok('选了一页:照片铺上照片页(一张),不等老师;顶栏有拍照、相册', Boolean(laid) && top.ph && top.cam !== 'none', JSON.stringify({ top, st: await pageState() }));
  await idle();
  const first = (await day()).messages?.[0];
  ok('开了一节课:话题第一条记 base: photo,带着那张照片', first?.base === 'photo' && first.photos?.length === 1, JSON.stringify(first));
  await sleep(1500);
  console.log('  ', await shot('2-照片页.png'));

  // 三、孩子说讲题吧:老师的动作念完那一句落上
  ok('孩子按住说「讲题吧」:收下了', await say('讲题吧'));
  const ringed = await until(`(() => { const d = ${STAGE}; return d && d.querySelectorAll('.bk-ring').length === 1; })()`, 25000);
  ok('老师的动作落下:「心理辅导室」圈上了', Boolean(ringed), JSON.stringify(await pageState()));
  await idle();
  // 「请 圈」写在第二句后面:那一句念完(或嘴静下来 5 秒)才落,笔这时才落得下
  await sleep(6000);
  console.log('  ', await shot('3-看第3题.png'));

  // 四、笔画一道,给老师看:先交窗里的图,再发交了
  const pen = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen' });
  await pen('mousePressed', 500, 420);
  for (let i = 1; i <= 10; i++) { await pen('mouseMoved', 500 + i * 22, 420 + (i % 2) * 6); await sleep(16); }
  await pen('mouseReleased', 720, 420);
  await sleep(900);
  const go = await center('#st-go');
  ok('画了一笔:「给老师看」出现', (await pageState()).inks === 1 && Boolean(go), JSON.stringify(await pageState()));
  console.log('  ', await shot('4-动了笔.png'));
  const n0 = frames.length;
  if (go) await tapAt(go.x, go.y);
  await sleep(1500);
  const after = frames.slice(n0);
  const shotAt = after.findIndex((f) => f.t === 'board' && f.body?.k === 'shot');
  const sendAt = after.findIndex((f) => f.t === 'send' && f.body?.action === 'submit');
  ok('给老师看:先交窗里的图(base 作业),再发一条交了', shotAt >= 0 && sendAt > shotAt && after[shotAt].body.base === '作业', JSON.stringify(after.map((f) => `${f.t}:${f.body?.k ?? f.body?.action ?? ''}`)));

  // 五、口语课:回首页点英语老师的「口语课」,不拍用白纸;一直听;热身 [[请 说 duck]] 念完轮到他,他说了接着念
  await idle();
  await evaluate(`document.querySelector('#back').click(), true`);
  await until(`Boolean(document.querySelector('[data-tutor="english-tutor"]'))`);
  await evaluate(`document.querySelector('[data-tutor="english-tutor"]').click(), true`);
  await until(`document.querySelector('[data-tutor="english-tutor"]').classList.contains('front')`, 5000);
  await sleep(800);
  const talkTile = await until(`(() => { const b = document.querySelector('[data-tutor="english-tutor"] .bt-tile[data-tile="talk"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  ok('英语老师的牌上有「口语课」方砖', Boolean(talkTile));
  // 假麦克风一直在嘀:没排着的转写回空的(一直听放过),只有要他说的时候才认成 duck
  fake.kidText = '';
  const nc = fake.conns.length;
  await tapAt(talkTile.x, talkTile.y);
  await until(`[...document.querySelectorAll('#lv-acts .lv-go, #board .ask-go')].some((x) => x.textContent.includes('不拍') && x.getBoundingClientRect().width > 0)`, 5000);
  const listenOpen = await (async () => { for (let i = 0; i < 40; i++) { const c = fake.conns.slice(nc).find((x) => x.session); if (c) return c.session.turn_detection?.type ?? null; await sleep(200); } return null; })();
  ok('口语课进来就一直听(嘴的会话开着 VAD)', listenOpen === 'server_vad', String(listenOpen));
  const white = await evaluate(`(() => { const b = [...document.querySelectorAll('#lv-acts .lv-go, #board .ask-go')].find((x) => x.textContent.includes('不拍') && x.getBoundingClientRect().width > 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tapAt(white.x, white.y);
  const conn = () => fake.conns[fake.conns.length - 1];
  const said = () => conn().responses.map((r) => r?.instructions ?? '');
  const warm = await (async () => { for (let i = 0; i < 100; i++) { if (said().some((x) => x.includes("我先来:duck!"))) return true; await sleep(200); } return false; })();
  const m0 = (await day('english-tutor')).messages?.[0];
  ok("不拍用白纸:开了一节口语课(第一条记 base: photo、listen: open),老师写热身", warm && m0?.base === 'photo' && m0?.listen === 'open', JSON.stringify({ warm, base: m0?.base, listen: m0?.listen }));
  const turn = await until(`document.querySelector('#lv-hold').dataset.voice === 'turn'`, 20000);
  ok('请他说的那句念完:按钮「轮到你说」,服务端不往下念', Boolean(turn) && !said().some((x) => x.includes('小声一点')), JSON.stringify(said()));
  console.log('  ', await shot('5-口语课轮到你.png'));
  fake.kidText = 'duck';
  const next = await (async () => { for (let i = 0; i < 100; i++) { if (said().some((x) => x.includes('小声一点'))) return true; await sleep(200); } return false; })();
  fake.kidText = '';
  ok('他说了 duck:接着念下一拍,不开新的一轮', next && (await day('english-tutor')).messages?.length === 1, JSON.stringify(said()));
  ok('页面没有脚本报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`\n截图在 ${shots}`);
  ws.close();
} finally {
  browser?.kill();
  server.close();
  await teacher.close();
  await fake.close?.();
}
process.exit(bad ? 1 : 0);

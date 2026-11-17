#!/usr/bin/env node
/**
 * 试用里打字当孩子说(kid-page.ts 的 TRIAL、src/app/http/trial-voice.ts)的手动验收:不进 pnpm test,要本机 Chrome;假百炼 + 假老师 + 假配音,不花钱。
 * 本进程起服务(临时 workspace,标成 sandbox;配音是 tests/_fake-tts.ts 的 tone,出一段解得开的 WAV;嘴是 tests/_fake-realtime.ts,转写照 kidTexts),
 * 无头 Chrome 开孩子端语文老师(假麦克风,一秒一声嘀):
 *  一、按住说的:敲键盘打一句、回车 → 配音一次(童声)、按钮是按着的样子、声音推上去(不开麦克风)、松手 commit;转写交给脑,孩子那句在左栏。
 *  二、请他说:脑这一轮念到 [[请 说 duck]] 停下等;打 duck → 照跟读办(开闸念下一拍,不起新一轮)。
 *  三、一直听(live.listen: open)、麦克风关着(吵的地方):打一句 → gate 开、推配音再推静音,VAD 判出一段、收下 → 脑开一轮;推完 gate 交回去(关着麦就不推了)。
 *  四、不是 sandbox:/api/kid/trial/voice 回 404。
 * 用法:node scripts/probe-trial-voice.mjs [--out <截图目录>]
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIET_ARGS } from './_quiet.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const outAt = process.argv.indexOf('--out');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cdp = 9363;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const tmp = probeDir('cotutor-probe-trial-voice-');
const shots = outAt > 0 ? process.argv[outAt + 1] : join(tmp, 'shots');
mkdirSync(shots, { recursive: true });
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import(join(repo, 'src', 'app', 'cli', 'init.ts'));
const { loadWorkspace } = await import(join(repo, 'src', 'app', 'workspace.ts'));
const { createContext, createHandler } = await import(join(repo, 'src', 'app', 'http', 'app.ts'));
const { makeLiveUpgrade } = await import(join(repo, 'src', 'app', 'ws', 'route.ts'));
const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));
const { startFakeTts } = await import(join(repo, 'tests', '_fake-tts.ts'));
const { TRIAL_KID_VOICE } = await import(join(repo, 'src', 'app', 'http', 'trial-voice.ts'));

const fake = await startFakeRealtime();
fake.audioMs = 600;
const tts = await startFakeTts({ tone: true });
process.env.COTUTOR_TTS_ENDPOINT = tts.url;
const { startFakeTeacher } = await import(join(repo, 'tests', '_fake-teacher.ts'));
const teacher = await startFakeTeacher();
process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.runtimes = { default: 'stream', stream: { api: 'bailian', model: 'fake-stream' } };
for (const t of Object.values(cfg.tutors)) delete t.runtime;
cfg.live = { voices: { 'chinese-tutor': 'Serena' } };
cfg.kid.name = 'Ray';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
// 标成 sandbox(同 cotutor serve --sandbox 分出来的):孩子端是试用的样子,有配音那个口子
const mark = join(wsRoot, '.cotutor', 'sandbox.json');
writeFileSync(mark, JSON.stringify({ from: join(tmp, 'real'), vault: join(tmp, 'real-vault'), forkedAt: new Date().toISOString() }));
const ctx = createContext(loadWorkspace(wsRoot));
await ctx.reload();
const upgrade = makeLiveUpgrade({ endpoint: fake.endpoint });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const { CHAT_RUN, writeChat } = await import(join(repo, 'tests', '_chat.ts'));
writeChat(wsRoot, ['chinese-tutor']);
await (await ctx.runner.send('chinese-tutor', { from: 'kid', text: '开始', newThread: true, activity: CHAT_RUN, live: {} })).done;
const conn = () => fake.conns[fake.conns.length - 1];
/** 今天的每一轮孩子那句(消息的 question) */
const kidSaid = async () => (await (await fetch(`${base}/api/kid/conversations/chinese-tutor/today`)).json()).messages.map((m) => m.question);

let browser = null;
try {
  browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
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
  const until = async (expr, n = 40) => { for (let i = 0; i < n; i++) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  const untilNode = async (f, ms = 10000) => { const t = Date.now() + ms; while (!f() && Date.now() < t) await sleep(50); return f(); };
  /** 键盘打一句再回车(试用:老师页上敲字就开输入条);一个字一个字敲,中文直接塞(无头 Chrome 没有输入法) */
  const type = async (text) => {
    const [first, ...rest] = Array.from(text);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: first, text: first });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: first });
    await sleep(100);
    if (rest.length) await send('Input.insertText', { text: rest.join('') });
    await sleep(100);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  const VOICE = `document.querySelector('#lv-hold').dataset.voice`;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 760, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor` });
  await until(`document.body.classList.contains('live') && document.body.classList.contains('trial')`);
  ok('sandbox 的孩子端是试用的样子(body.trial)、连上了嘴', await untilNode(() => Boolean(conn()?.session), 8000) && (await evaluate(`document.body.classList.contains('trial')`)));
  await until(`document.querySelector('#lv-hold').dataset.voice === 'idle'`, 20);

  // ---- 一、按住说的:打一句 = 按住说一句 ----
  fake.kidTexts = ['我写完了'];
  const c0 = conn().commits, a0 = conn().audio, t0 = tts.requests.length;
  await type('我写完了');
  const holding = await until(`document.querySelector('#lv-hold').dataset.voice === 'hold'`, 20);
  console.log('  ', await shot('trial-hold-ipad.png'));
  const committed = await untilNode(() => conn().commits > c0, 8000);
  const pushed = conn().audio - a0;
  const said = await until(`document.querySelector('#lv-kid').textContent === '我写完了'`, 40);
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const kids = await kidSaid();
  ok('按住说的:打一句 → 配音一次(童声、是打的那句)、按钮是按着的样子、声音推上去了(不止半秒)、松手 commit 一次;转写交给脑,孩子那句在左栏',
    tts.requests.length === t0 + 1 && tts.requests[t0]?.text === '我写完了' && tts.requests[t0]?.voice === TRIAL_KID_VOICE && holding && pushed >= 16000 && conn().commits === c0 + 1 && said && kids.at(-1) === '我写完了',
    JSON.stringify({ tts: tts.requests.slice(t0), holding, pushed, commits: conn().commits - c0, said, kid: kids.at(-1) }));
  const diag = (() => { try { return readFileSync(join(wsRoot, '.cotutor', 'voice-diag.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.where === 'live').pop(); } catch { return null; } })();
  ok('按住说的诊断记的是配音(fed),没开麦克风', Boolean(diag && diag.ev.some((e) => e[0] === 'fed') && !diag.ev.some((e) => e[0] === 'mic')), JSON.stringify(diag?.ev ?? null));

  // ---- 二、请他说:脑念到 [[请 说 duck]] 停下等;打 duck = 跟读,开闸念下一拍,不起新一轮 ----
  fake.kidTexts = ['热身'];
  const r0 = conn().responses.length;
  await type('热身');
  const asked = await untilNode(() => conn().responses.slice(r0).some((r) => String(r?.instructions).includes('duck')), 15000);
  await until(`document.querySelector('#lv-hold').dataset.voice === 'turn'`, 60);
  const jobs0 = (await kidSaid()).length;
  const r1 = conn().responses.length;
  fake.kidTexts = ['duck'];
  await type('duck');
  const next = await untilNode(() => conn().responses.length > r1, 10000);
  await sleep(800);
  const jobs1 = (await kidSaid()).length;
  ok('请他说:念到 [[请 说 duck]] 停下等;打 duck → 照跟读办,开闸念下一拍、不起新一轮', asked && next && jobs1 === jobs0, JSON.stringify({ asked, next, jobs: [jobs0, jobs1], last: String(conn().responses.at(-1)?.instructions ?? '').slice(0, 60) }));
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 20000);
  await sleep(1500);

  // ---- 三、一直听、麦克风关着:打一句 → gate 开、配音 + 静音推上去,VAD 判出一段收下 → 脑开一轮;推完 gate 交回去(关着麦就不推) ----
  cfg.live.listen = 'open';
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await ctx.reload();
  fake.kidText = '';
  const nOpen = fake.conns.length;
  await evaluate(`document.querySelector('#back').click()`);
  await sleep(300);
  await send('Page.navigate', { url: `${base}/?tutor=chinese-tutor` });
  await until(`Boolean(document.body && document.body.classList.contains('live'))`, 40);
  const vad = await untilNode(() => fake.conns.length > nOpen && conn().session?.turn_detection?.type === 'server_vad', 8000);
  await until(`/^open/.test(document.querySelector('#lv-hold').dataset.voice)`, 40);
  // 关麦(吵的地方的样子):这个话题铺着白纸(舞台铺满),露着的是那颗小头像,点一下关麦(同左栏那颗)
  const cvh = await evaluate(`(() => { const r = document.querySelector('#cv-hold').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, open: document.querySelector('#stage').classList.contains('cv') }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cvh.x, y: cvh.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cvh.x, y: cvh.y, button: 'left', buttons: 0, clickCount: 1 });
  ok('一直听、舞台铺满:点那颗小头像关麦(同左栏那颗)', cvh.open && (await until(`document.querySelector('#cv-hold').dataset.voice === 'muted'`, 20)), JSON.stringify(cvh));
  await sleep(1500);
  fake.kidTexts = ['老师我写完作业了'];
  const am = conn().audio, rr = conn().responses.length;
  await sleep(1000);
  const quietMuted = conn().audio - am;
  await type('老师我写完作业了');
  const took = await untilNode(() => conn().responses.slice(rr).some((r) => String(r?.instructions).startsWith('把这几句话原样说给孩子听')), 15000);
  const left = await until(`document.querySelector('#lv-kid').textContent === '老师我写完作业了'`, 40);
  await untilNode(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await sleep(1500);
  const a3 = conn().audio;
  await sleep(1500);
  const after = conn().audio - a3;
  const mutedAgain = await evaluate(VOICE);
  ok('一直听、关着麦:关着时不推;打一句 → 推配音和静音、VAD 收下这一段 → 脑开一轮、嘴照念,孩子那句在左栏;推完还是关着麦、不再推', vad && quietMuted === 0 && took && left && after === 0 && mutedAgain === 'muted', JSON.stringify({ vad, quietMuted, took, left, after, voice: mutedAgain, kid: (await kidSaid()).at(-1) }));
  console.log('  ', await shot('trial-open-ipad.png'));

  ok('页面没有报错', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  if (browser) browser.kill();
  server.close();
  fake.close();
  void teacher.close();
  void tts.close();
}

// ---- 四、不是 sandbox:没有这个口子 ----
{
  const { rmSync } = await import('node:fs');
  rmSync(mark);
  const ctx2 = createContext(loadWorkspace(wsRoot));
  await ctx2.reload();
  const s2 = createServer(createHandler(ctx2));
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${s2.address().port}/api/kid/trial/voice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '你好' }) });
  const page = await (await fetch(`http://127.0.0.1:${s2.address().port}/`)).text();
  ok('不是 sandbox:配音口子 404,孩子端不是试用的样子', r.status === 404 && page.includes('"trial":true') === false, String(r.status));
  s2.close();
}
console.log(bad ? `\n${bad} 项没过` : '\n全过');
console.log(`截图:${shots}`);
process.exit(bad ? 1 : 0);

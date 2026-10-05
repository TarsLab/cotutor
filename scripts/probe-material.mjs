#!/usr/bin/env node
/**
 * 素材卡(《备课设计.md》§11.3)的手动验收(不进 pnpm test,要本机 Chrome 与 figshot 出的三段片子;老师是假 CLI,不花钱):
 * 临时 workspace + materials/pingjunfen/(定本 material.md + share-2 / 3 / 6 当 1–3.mp4)+ HTTP 的 serve →
 * Chrome(iPad 横屏)开孩子端数学老师,从输入条发「放素材」→ 假老师回素材卡 + 「看三个人怎么分。[[play 2]]」→
 * 念完那句舞台自己铺满播第 2 段 → 播完停在末帧、舞台不关、接着念下一句、状态存成看到第 2 段 →
 * 孩子关了舞台,点卡自己开:从第 1 段起、一段一停;点段号 3 换第 3 段。
 *
 * 用法:node scripts/probe-material.mjs [--keep] [--shots <目录>] [--clips <figshot 的 out/clip/share 目录>]
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const keep = process.argv.includes('--keep');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const repo = fileURLToPath(new URL('..', import.meta.url));
const clips = arg('--clips') ?? join(repo, '..', 'figshot', 'out', 'clip', 'share');
if (!['share-2', 'share-3', 'share-6'].every((n) => existsSync(join(clips, `${n}.mp4`)))) { console.error(`✗ 找不到 figshot 的片子(${clips}/share-2|3|6.mp4);用 --clips 指过去`); process.exit(1); }
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8798;
const cdp = 9340;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);

const home = mkdtempSync(join(tmpdir(), 'cotutor-probe-material-'));
const root = join(home, 'ws');
const shots = arg('--shots') ?? join(home, 'shots');
mkdirSync(shots, { recursive: true });
const run = (args) => new Promise((resolve, reject) => { const p = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), ...args], { env: { ...process.env, HOME: home, COTUTOR_WORKSPACE: '' }, stdio: 'pipe' }); p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`cotutor ${args.join(' ')} exit ${c}`)))); });
await run(['init', 'probe', '--dir', root, '--name', '小探']);
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
const fake = join(repo, 'tests', '_fake-cli.ts');
cfg.runtimes.default = 'fake';
cfg.runtimes.fake = { run: [process.execPath, '--experimental-strip-types', '--no-warnings', fake, '--stream', '--agent', '{agent}', '{prompt}'], resume: [process.execPath, '--experimental-strip-types', '--no-warnings', fake, '--stream', '--agent', '{agent}', '--resume', '{session}', '{prompt}'] };
cfg.server.port = port;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const mdir = join(root, 'materials', 'pingjunfen');
mkdirSync(mdir, { recursive: true });
copyFileSync(join(repo, 'tests', 'fixtures', 'materials', 'pingjunfen', 'material.md'), join(mdir, 'material.md'));
['share-2', 'share-3', 'share-6'].forEach((n, k) => copyFileSync(join(clips, `${n}.mp4`), join(mdir, `${k + 1}.mp4`)));

const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', root, '--http'], { env: { ...process.env, HOME: home }, stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }
const api = async (path) => (await fetch(base + path)).json();

let browser = null;
try {
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(home, 'chrome')}`, `${base}/?tutor=math-tutor`], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page' && t.url.startsWith('http'))?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  const until = async (expr, n = 80) => { for (let i = 0; i < n; i++) { if (await evaluate(expr).catch(() => false)) return true; await sleep(250); } return false; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const f = join(shots, name); writeFileSync(f, Buffer.from(r.result.data, 'base64')); console.log('  ', f); };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  // 假的念:没有配音,浏览器合成声在无头里不一定有;把 speechSynthesis 拿掉,页面按字数计时念
  await until(`document.querySelector('#tutor')?.classList.contains('on')`);
  await evaluate(`(() => { try { delete window.speechSynthesis; window.speechSynthesis = undefined; } catch {} return true; })()`);

  // ---- 讲稿交给素材 ----
  await evaluate(`(() => { const t = document.querySelector('#typed'); t.value = '放素材 我分好了'; document.querySelector('#go').click(); return true; })()`);
  const carded = await until(`document.querySelectorAll('#board .c-material').length === 1`, 120);
  const compact = await evaluate(`(() => { const c = document.querySelector('#board .c-material'); return { title: c.querySelector('.sp')?.textContent, pl: c.querySelector('.pl')?.textContent, thumb: c.querySelector('.th video')?.getAttribute('src') }; })()`);
  ok('老师回了素材卡:卡上标题、「3 段 ▷」、第 1 段的头一帧', carded && compact.title === '平均分:分的人越多,每人越少' && compact.pl === '3 段 ▷' && compact.thumb?.startsWith('/api/kid/material/pingjunfen/1.mp4'), JSON.stringify(compact));
  await shot('material-board.png');
  const opened = await until(`document.querySelector('#stage').classList.contains('on') && Boolean(document.querySelector('#st-body video')?.getAttribute('src'))`, 120);
  const playing = await evaluate(`(() => { const v = document.querySelector('#st-body video'); return { src: v.getAttribute('src'), on: [...document.querySelectorAll('#st-body .segs button.on')].map((b) => b.textContent), kd: document.querySelector('#st-kd').textContent }; })()`);
  ok('念完「看三个人怎么分」那句:舞台自己铺满,播的是第 2 段,段号 2 亮', opened && playing.src.endsWith('/pingjunfen/2.mp4') && playing.on.join() === '2' && playing.kd === '动画', JSON.stringify(playing));
  await sleep(2500);
  await shot('material-stage-playing.png');
  const ended = await until(`document.querySelector('#st-body video')?.ended === true`, 60);
  await sleep(600);
  const after = await evaluate(`(() => { const v = document.querySelector('#st-body video'); return { stage: document.querySelector('#stage').classList.contains('on'), t: v.currentTime, d: v.duration, sub: document.querySelector('#sub-text').textContent }; })()`);
  ok('播完:舞台不关、停在末帧;接着念下一句(字幕到了「每人几块?」)', ended && after.stage && after.d > 6 && after.t >= after.d - 0.1 && after.sub.includes('每人几块'), JSON.stringify(after));
  await shot('material-stage-end.png');
  const today = await api('/api/kid/conversations/math-tutor/today');
  const st = today.messages.flatMap((m) => m.section?.cards ?? []).find((c) => c.kind === 'material')?.state;
  ok('状态存了:看到第 2 段、没看完', st?.segment === 2 && st.done === false, JSON.stringify(st));

  // ---- 孩子自己点开 ----
  await evaluate(`document.querySelector('#st-x').click()`);
  await until(`!document.querySelector('#stage').classList.contains('on')`);
  await evaluate(`document.querySelector('#board .c-material').click()`);
  const self = await until(`document.querySelector('#stage').classList.contains('on') && (document.querySelector('#st-body video')?.getAttribute('src') || '').endsWith('/1.mp4')`);
  ok('孩子点卡:舞台开、从第 1 段起', self);
  const stop1 = await until(`document.querySelector('#st-body video')?.ended === true`, 60);
  await sleep(800);
  const still = await evaluate(`document.querySelector('#st-body video').getAttribute('src')`);
  ok('一段一停:第 1 段播完停住,不自己往下播', stop1 && still.endsWith('/1.mp4'), still);
  await evaluate(`[...document.querySelectorAll('#st-body .segs button')].find((b) => b.textContent === '3').click()`);
  const third = await until(`(document.querySelector('#st-body video')?.getAttribute('src') || '').endsWith('/3.mp4') && document.querySelector('#st-body .segs button.on')?.textContent === '3'`);
  ok('点段号 3:换第 3 段、段号 3 亮', third);
  await until(`document.querySelector('#st-body video')?.ended === true`, 60);
  await sleep(600);
  const st2 = (await api('/api/kid/conversations/math-tutor/today')).messages.flatMap((m) => m.section?.cards ?? []).find((c) => c.kind === 'material')?.state;
  ok('看完第 3 段:状态记看完了', st2?.segment === 3 && st2.done === true, JSON.stringify(st2));
  ws.close();
} catch (err) {
  console.error('✗ 探针出错:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  browser?.kill();
  if (keep) { serve.unref(); console.log(`留着:workspace ${root},serve ${base}(pid ${serve.pid},自己 kill)`); }
  else { serve.kill(); await sleep(800); rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
}

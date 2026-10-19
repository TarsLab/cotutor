#!/usr/bin/env node
/**
 * 实时老师页在 Safari(WebKit)上的音频路径(《wip/实时老师开发计划.md》P2.6):常开那路麦克风接到 AudioWorklet 采 16k(makeAudio().use,不再开第二路)、
 * 推上去;嘴的 24k PCM 排进 AudioContext 放。本进程起服务(临时 workspace,语文老师开实时,老师是假 CLI,嘴是 tests/_fake-realtime.ts);
 * WebKit 没有假麦克风,页面加载前把 getUserMedia 换成一路振荡器的流,顺手数它被调了几次、worklet 出了几块、发了几块、排了几块声音。
 * 本仓不装 playwright:借一份 playwright-core 和它配套的 WebKit(见 probe-lecture-webkit.mjs)。
 * 用法:PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录> node scripts/probe-live-webkit.mjs
 */
import { probeDir } from './_guard.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
if (!process.env.PLAYWRIGHT_CORE) { console.error('要 PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录>'); process.exit(2); }
const { webkit } = require(process.env.PLAYWRIGHT_CORE + '/node_modules/playwright-core');
const repo = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import(join(repo, 'src', 'cli', 'init.ts'));
const { loadWorkspace } = await import(join(repo, 'src', 'cli', 'workspace.ts'));
const { createContext, createHandler } = await import(join(repo, 'src', 'server', 'app.ts'));
const { makeLiveUpgrade } = await import(join(repo, 'src', 'live', 'route.ts'));
const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));

const fake = await startFakeRealtime();
fake.kidText = '老师板书怎么写';
const FAKE = join(repo, 'tests', '_fake-cli.ts');
const rt = { run: [process.execPath, '--experimental-strip-types', '--no-warnings', FAKE, '--stream', '--tools', '{tools}', '--agent', '{agent}', '{prompt}'], resume: [process.execPath, '--experimental-strip-types', '--no-warnings', FAKE, '--stream', '--tools', '{tools}', '--agent', '{agent}', '--resume', '{session}', '{prompt}'] };
const tmp = probeDir('cotutor-probe-live-webkit-');
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot, proxy: false });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.runtimes = { default: 'stream', stream: rt };
for (const t of Object.values(cfg.tutors)) delete t.runtime;
cfg.live = { enabled: true, voices: { 'chinese-tutor': 'Serena' } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(wsRoot), { warm: false });
await ctx.reload();
const upgrade = makeLiveUpgrade({ endpoint: fake.endpoint, env: { DASHSCOPE_API_KEY: 'sk-probe' } });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// 假麦克风:一路 440Hz 的振荡器;数 getUserMedia 调了几次、AudioContext 排了几块声音、worklet 出了几块、WebSocket 发了几块二进制
const INJECT = `(() => {
  window.__played = 0; window.__gum = 0; window.__chunks = 0; window.__sentBin = 0; window.__err = [];
  window.addEventListener('error', (e) => window.__err.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__err.push(String(e.reason && e.reason.message || e.reason)));
  const AC = window.AudioContext || window.webkitAudioContext;
  const orig = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function () { const s = orig.call(this); const st = s.start; s.start = function () { window.__played++; return st.apply(this, arguments); }; return s; };
  navigator.mediaDevices.getUserMedia = async () => { window.__gum++; const ctx = new AC(); const osc = ctx.createOscillator(); osc.frequency.value = 440; const dst = ctx.createMediaStreamDestination(); osc.connect(dst); osc.start(); await ctx.resume(); return dst.stream; };
  const d = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  Object.defineProperty(MessagePort.prototype, 'onmessage', { set(f) { d.set.call(this, (e) => { window.__chunks++; f(e); }); }, get() { return d.get.call(this); } });
  const ws = WebSocket.prototype.send;
  WebSocket.prototype.send = function (x) { if (typeof x !== 'string') window.__sentBin++; return ws.call(this, x); };
})();`;

const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  await page.addInitScript(INJECT);
  // 先到首页记下给过麦克风权限(进老师页就先把常开那路开好,micWarm),再用 ?tutor= 进老师页的新话题
  await page.goto(`${base}/`);
  await page.waitForSelector('#tutors .c-tutor, #deck .c-tutor', { timeout: 10000 });
  await page.evaluate(() => { try { localStorage.setItem('kid-mic-ok', '1'); } catch {} });
  await page.goto(`${base}/?tutor=chinese-tutor&new=1`);
  await page.waitForFunction(() => document.body.classList.contains('live'), null, { timeout: 10000 });
  const t0 = Date.now(); while (!fake.conns.at(-1)?.session && Date.now() - t0 < 8000) await sleep(50);
  await sleep(500);
  ok('进老师页:body.live、连上了嘴', Boolean(fake.conns.at(-1)?.session));

  const box = await page.locator('#mid').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(1500);
  const held = await page.evaluate(() => ({ gum: window.__gum, chunks: window.__chunks, sent: window.__sentBin, listening: document.body.classList.contains('listening') }));
  await page.mouse.up();
  ok('按住:常开那路麦克风接到采音节点(只 getUserMedia 一次)、worklet 出块、推上去了', held.gum === 1 && held.chunks > 0 && held.sent > 0 && held.listening && fake.conns.at(-1).audio > 0, JSON.stringify({ ...held, server: fake.conns.at(-1).audio }));
  const caught = await page.waitForFunction(() => document.querySelector('#lv-cap .lv-cur').textContent === "It's a red car.", null, { timeout: 8000 }).then(() => true, () => false);
  const played = await page.waitForFunction(() => window.__played >= 2, null, { timeout: 15000 }).then(() => true, () => false);
  const st = await page.evaluate(() => ({ played: window.__played, cap: document.querySelector('#lv-cap .lv-cur').textContent, err: window.__err, cards: document.querySelectorAll('#board .sec .c').length }));
  ok('松手:嘴接住上字幕;嘴的声音排进 AudioContext 放(接住 + 照念)', caught && played && st.played >= 2, JSON.stringify(st));
  await page.waitForFunction(() => document.querySelector('#lv-cap .lv-cur').textContent.startsWith('第一次说'), null, { timeout: 20000 }).catch(() => {});
  const end = await page.evaluate(() => ({ cap: document.querySelector('#lv-cap .lv-cur').textContent, gum: window.__gum, err: window.__err }));
  ok('讲稿念到最后一句;从头到尾只 getUserMedia 一次;页面没报错', end.cap.startsWith('第一次说') && end.gum === 1 && end.err.length === 0, JSON.stringify(end));
} finally {
  await browser.close();
  server.close();
  fake.close();
}
console.log(bad ? `\n${bad} 项没过` : '\n全过');
process.exit(bad ? 1 : 0);

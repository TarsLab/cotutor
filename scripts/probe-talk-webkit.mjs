#!/usr/bin/env node
/**
 * 口语课孩子页在 Safari(WebKit)上的音频路径:AudioWorklet 采 16k、24k PCM 排进 AudioContext 放、[hidden] 真的藏起来。
 * 真 serve(临时 workspace)+ 假百炼(tests/_fake-realtime.ts);WebKit 没有假麦克风,页面加载前把 getUserMedia 换成一路振荡器的流。
 * 本仓不装 playwright:借一份 playwright-core 和它配套的 WebKit(见 probe-lecture-webkit.mjs)。
 * 用法:PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录> node scripts/probe-talk-webkit.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
if (!process.env.PLAYWRIGHT_CORE) { console.error('要 PLAYWRIGHT_CORE=<含 node_modules/playwright-core 的目录>'); process.exit(2); }
const { webkit } = require(process.env.PLAYWRIGHT_CORE + '/node_modules/playwright-core');
const repo = fileURLToPath(new URL('..', import.meta.url));
const port = 8799;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

const { startFakeRealtime } = await import(join(repo, 'tests', '_fake-realtime.ts'));
const { initWorkspace } = await import(join(repo, 'src', 'cli', 'init.ts'));
const fake = await startFakeRealtime();
const tmp = mkdtempSync(join(tmpdir(), 'cotutor-probe-talk-webkit-'));
const wsRoot = join(tmp, 'ws');
await initWorkspace({ slug: 'probe', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.talk = { enabled: true, minutes: 1 };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
try { await fetch(`${base}/api/health`); console.error(`端口 ${port} 上已经有东西,先停掉`); process.exit(2); } catch {}
const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', wsRoot, '--port', String(port), '--http'], { stdio: process.env.PROBE_LOG ? 'inherit' : 'ignore', env: { ...process.env, COTUTOR_TALK_ENDPOINT: fake.endpoint, DASHSCOPE_API_KEY: 'sk-probe', COTUTOR_WORKSPACE: wsRoot } });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }

// 假麦克风:一路 440Hz 的振荡器;顺手数 AudioContext 排了几块声音、worklet 出了几块
const INJECT = `(() => {
  window.__played = 0; window.__gum = 0; window.__chunks = 0; window.__sentBin = 0; window.__err = [];
  window.addEventListener('error', (e) => window.__err.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__err.push(String(e.reason && e.reason.message || e.reason)));
  const AC = window.AudioContext || window.webkitAudioContext;
  const orig = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function () { const s = orig.call(this); const st = s.start; s.start = function () { window.__played++; return st.apply(this, arguments); }; return s; };
  // 振荡器 → 增益 → 流;__mute() 把增益归零 = 孩子不说话了(假百炼的 VAD 收到全零的块才判「说完」)
  navigator.mediaDevices.getUserMedia = async () => { window.__gum++; const ctx = new AC(); const osc = ctx.createOscillator(); osc.frequency.value = 440; const g = ctx.createGain(); const dst = ctx.createMediaStreamDestination(); osc.connect(g); g.connect(dst); osc.start(); await ctx.resume(); window.__mute = () => { g.gain.value = 0; }; window.__unmute = () => { g.gain.value = 1; }; return dst.stream; };
  const d = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  Object.defineProperty(MessagePort.prototype, 'onmessage', { set(f) { d.set.call(this, (e) => { window.__chunks++; f(e); }); }, get() { return d.get.call(this); } });
  const ws = WebSocket.prototype.send;
  WebSocket.prototype.send = function (x) { if (typeof x !== 'string') window.__sentBin++; return ws.call(this, x); };
})();`;

const api = async (m, p, b) => (await fetch(base + p, { method: m, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined })).json();
const t = await api('POST', '/api/talk', {});
await api('PUT', `/api/talk/${t.id}/list`, { words: [{ en: 'red', zh: '红色' }], sentences: [{ en: 'It is a red car.', zh: '这是一辆红色的车。' }], ready: true });

const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  await page.addInitScript(INJECT);
  page.on('pageerror', (e) => console.log('  页面报错:', e.message));
  if (process.env.PROBE_LOG) page.on('console', (m) => console.log('  console:', m.text()));
  const visible = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return Boolean(el) && getComputedStyle(el).display !== 'none'; }, sel);
  const stats = () => page.evaluate(() => ({ played: window.__played, gum: window.__gum, chunks: window.__chunks, sentBin: window.__sentBin, err: window.__err, hint: document.querySelector('#k-hint').textContent, sr: null }));
  const untilFn = async (f, n = 40) => { for (let i = 0; i < n; i++) { if (await f()) return true; await sleep(250); } return false; };

  await page.goto(`${base}/talk#/kid/${t.id}`);
  await untilFn(() => page.evaluate(() => document.querySelector('#kid').classList.contains('on') && document.querySelector('#k-start-hint').textContent.includes('2 句')));
  ok('孩子页:只露「打电话」那块,跟读 / 聊 / 两条按钮栏都藏着', (await visible('#k-start')) && !(await visible('#k-read')) && !(await visible('#k-chat')) && !(await visible('#k-bar')) && !(await visible('#k-bar2')));
  await page.click('#k-go');
  const up = await untilFn(async () => fake.conns.length === 1 && (await visible('#k-read')) && (await page.evaluate(() => document.querySelector('#k-en').textContent === 'red' && window.__played > 0)), 60);
  ok('打电话:麦克风(假)开了、AudioWorklet 起了、接上、第一句在卡上、老师的声音排进去放了;打电话那块藏起来', up && !(await visible('#k-start')) && (await visible('#k-bar')), JSON.stringify(await stats()));
  const c1 = fake.conns[0];
  await untilFn(() => page.evaluate(() => document.querySelector('#k-hint').textContent.includes('按住')));
  const a0 = c1.audio;
  const box = await page.locator('#k-hold').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const got = await untilFn(() => c1.audio >= a0 + 3200 * 6, 40);
  ok('按住:worklet 的 16k PCM 一块块到了假百炼', got, `${c1.audio - a0} 字节 ${JSON.stringify(await stats())}`);
  await page.mouse.up();
  ok('松手:孩子那句的字出在卡下面', await untilFn(() => page.evaluate(() => document.querySelector('#k-heard').textContent.includes("It's a red car."))));
  await page.click('#k-next');
  await untilFn(() => page.evaluate(() => document.querySelector('#k-en').textContent === 'It is a red car.'));
  await page.click('#k-next');
  ok('读完开聊:聊那块露出来、跟读那块藏起来、倒计时', await untilFn(async () => fake.conns.length === 2 && (await visible('#k-chat')) && !(await visible('#k-read')) && (await page.evaluate(() => document.querySelector('#k-chip').textContent.includes('还有')))), JSON.stringify(await stats()));
  const c2 = fake.conns[1];
  await untilFn(() => c2.audio > 3200 * 5, 60);
  await page.evaluate(() => window.__mute());
  ok('聊:老师放完,孩子的声音推上去;停了 → 转写回来、老师接', await untilFn(() => page.evaluate(() => document.querySelector('#k-heard2').textContent.includes("It's a red car.")), 60) && c2.creates >= 2, JSON.stringify({ audio: c2.audio, creates: c2.creates }));
  await page.click('#k-hang');
  ok('挂断 → 回看', await untilFn(() => page.evaluate(() => document.querySelector('#review').classList.contains('on') && document.querySelectorAll('#r-lines .ln').length > 0)));
  const s = await stats();
  ok('页面没报错', s.err.length === 0, JSON.stringify(s.err));
  console.log(bad ? `${bad} 项没过` : '全过');
} finally {
  await browser.close();
  fake.close();
  serve.kill();
  await sleep(300);
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}
process.exit(bad ? 1 : 0);

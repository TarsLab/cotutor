#!/usr/bin/env node
/**
 * 作业照片线(R5)的手动验收(不进 pnpm test,要本机 Chrome;老师是假 CLI,不花钱):
 * 自己起一个临时 workspace(运行时指 tests/_fake-cli.ts --stream,后期关)+ 一个 HTTP 的 serve →
 * 把服务自己画的 /icon-192.png 当「照片」传上去(POST …/photos)→ 只带照片发一条 → 假老师「看图」:Read 那张、板书出 image 卡 + canvas 卡照片做底 →
 * 用 Chrome DevTools 协议开孩子端:节头有缩略图、直开画板舞台、iframe 里 excalidraw 的场景有一个 image 元素(底图)与一份 files →
 * 画一笔「给老师看」→ .cards/<n>.png 落盘;家长端那轮的问句下有缩略图。
 *
 * 用法:node scripts/probe-photo.mjs [--keep](留下临时 workspace 与 serve 不杀,自己再看)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const keep = process.argv.includes('--keep');
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8792;
const cdp = 9334;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);

// ---- 临时 workspace:假 CLI 当老师、后期关、端口 8792 ----
const home = mkdtempSync(join(tmpdir(), 'cotutor-probe-photo-'));
const root = join(home, 'ws');
const run = (args, opts = {}) => new Promise((resolve, reject) => { const p = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), ...args], { env: { ...process.env, HOME: home, COTUTOR_WORKSPACE: '' }, stdio: 'pipe', ...opts }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('exit', (c) => (c === 0 ? resolve(out) : reject(new Error(out)))); });
await run(['init', 'probe', '--dir', root, '--name', '小探']);
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
const fake = join(repo, 'tests', '_fake-cli.ts');
cfg.runtimes.default = 'fake';
cfg.runtimes.fake = { run: [process.execPath, '--experimental-strip-types', '--no-warnings', fake, '--stream', '--agent', '{agent}', '{prompt}'], resume: [process.execPath, '--experimental-strip-types', '--no-warnings', fake, '--stream', '--agent', '{agent}', '--resume', '{session}', '{prompt}'] };
cfg.policyDefaults = { post: { mode: 'off' } };
cfg.server.port = port;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const serve = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'serve', '--workspace', root, '--http'], { env: { ...process.env, HOME: home }, stdio: 'ignore', detached: keep });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }
const api = async (method, path, body) => { const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

let browser = null;
try {
  // ---- 传图 → 只带照片发一条 → 假老师看图 ----
  const png = Buffer.from(await (await fetch(`${base}/icon-192.png`)).arrayBuffer());
  const up = await api('POST', '/api/kid/conversations/math-tutor/photos', { image: `data:image/png;base64,${png.toString('base64')}` });
  const photo = up.json?.path;
  ok('传图:201、落 captures/<日期>/<HHMM>-1.png、文件在', up.status === 201 && /^captures\/\d{4}-\d{2}-\d{2}\/\d{4}-1\.png$/.test(photo ?? '') && existsSync(join(root, photo ?? 'x')), JSON.stringify(up.json));
  const sent = await api('POST', '/api/kid/conversations/math-tutor/messages', { text: '', photos: [photo], device: 'tablet-landscape' });
  ok('只带照片发一条 → 202', sent.status === 202, JSON.stringify(sent.json));
  let today = null;
  for (let i = 0; i < 80; i++) { today = (await api('GET', '/api/kid/conversations/math-tutor/today')).json; if (today && !today.pending && today.messages.every((m) => !m.pending)) break; await sleep(250); }
  const msg = today?.messages.find((m) => m.job === sent.json?.job);
  const cards = msg?.section?.cards ?? [];
  const canvasIdx = cards.findIndex((c) => c.kind === 'canvas');
  ok('孩子端条目:问句「(拍了一张)」带 photos;板书 image 卡引用原图、canvas 卡照片做底', msg?.question === '(拍了一张)' && msg?.photos?.[0] === photo && cards.some((c) => c.kind === 'image' && c.props.src === photo) && canvasIdx >= 0 && cards[canvasIdx].props.base?.image === photo, JSON.stringify({ q: msg?.question, photos: msg?.photos, kinds: cards.map((c) => c.kind) }));
  const parentDay = (await api('GET', '/api/conversations/math-tutor/today')).json;
  const pm = parentDay?.index?.messages.find((m) => m.job === sent.json?.job);
  ok('家长端索引:消息带 photos、转录里 Read 了那张', pm?.photos?.[0] === photo && JSON.stringify(parentDay?.runs?.[pm?.job] ?? []).includes(photo), JSON.stringify(pm?.photos));

  // ---- Chrome:孩子端节头缩略图 → 直开画板舞台 → excalidraw 场景里有底图 → 画一笔给老师看 ----
  const secIdx = 0;
  const url = `${base}/?tutor=math-tutor&step=${secIdx}.0&stage=${secIdx}.${canvasIdx}`;
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(home, 'chrome')}`, url], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page' && t.url.startsWith('http'))?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  await send('Runtime.enable');
  let scene = null;
  for (let i = 0; i < 80 && !scene; i++) { scene = await evaluate(`(() => { const w = document.querySelector('#st-frame')?.contentWindow; const a = w && w.__excalidraw; if (!a) return null; const els = a.getSceneElements(); const img = els.filter((e) => e.type === 'image'); return img.length ? { images: img.length, files: Object.keys(a.getFiles()).length, locked: img[0].locked, opacity: img[0].opacity, layer: img[0].customData?.layer, w: img[0].width, h: img[0].height } : null; })()`); if (!scene) await sleep(250); }
  ok('画板舞台:excalidraw 场景里有一个 image 元素做底(锁定、灰一档、layer base)、files 里一份', scene && scene.images === 1 && scene.files === 1 && scene.locked === true && scene.opacity === 45 && scene.layer === 'base' && scene.w > 0, JSON.stringify(scene));
  const head = await evaluate(`(() => { const im = document.querySelector('#board .sh img.ph'); return im ? { src: im.getAttribute('src'), h: im.getBoundingClientRect().height } : null; })()`);
  ok('孩子端节头有照片缩略图(经 /api/kid/image 取)', head && head.src.includes('/api/kid/image?p=') && head.h > 0, JSON.stringify(head));
  const compact = await evaluate(`(() => { const th = document.querySelector('#board .c-canvas .th.base img'); return th ? th.getAttribute('src') : null; })()`);
  ok('紧凑态画板卡上先是那张照片', typeof compact === 'string' && compact.includes('/api/kid/image?p=') && compact.includes(encodeURIComponent(photo)), String(compact));
  const drew = await evaluate(`(async () => {
    const d = document.querySelector('#st-frame').contentDocument;
    const cv = d.querySelector('.canvas-board .excalidraw__canvas.interactive') || d.querySelector('.canvas-board canvas');
    const r = cv.getBoundingClientRect();
    const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, pointerId: 1, pointerType: 'pen', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1, button: 0, pressure: 0.5 }));
    ev('pointerdown', 120, 120); for (const p of [[160, 140], [200, 170], [240, 190]]) { ev('pointermove', ...p); await new Promise((r) => setTimeout(r, 12)); } ev('pointerup', 240, 190);
    await new Promise((r) => setTimeout(r, 900));
    return document.querySelector('#st-note')?.textContent ?? '';
  })()`);
  ok('照片上画了一笔 → 「画了 1 笔」', /画了 1 笔/.test(drew), drew);
  const submitted = await evaluate(`(async () => { document.querySelector('#st-go').click(); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); const img = document.querySelector('#board .c-canvas .th:not(.base) img'); if (img) return img.getAttribute('src'); } return null; })()`);
  const pngFile = join(root, 'conversations', 'math-tutor', `${today.date}.${sent.json.job}.cards`, `${canvasIdx}.png`);
  ok('给老师看 → .cards/<n>.png 落盘(底图恢复原色一起导出)、紧凑态换成孩子画的', typeof submitted === 'string' && submitted.includes('.cards') && existsSync(pngFile) && readFileSync(pngFile).length > 2000, JSON.stringify({ submitted, size: existsSync(pngFile) ? readFileSync(pngFile).length : 0 }));
  await send('Page.navigate', { url: `${base}/parent?tutor=math-tutor` });
  let thumbs = null;
  for (let i = 0; i < 40 && !thumbs; i++) { thumbs = await evaluate(`(() => { const im = document.querySelector('.ask .q .photos img'); return im ? im.getAttribute('src') : null; })()`); if (!thumbs) await sleep(250); }
  ok('家长端那轮的问句下有缩略图', typeof thumbs === 'string' && thumbs.includes('/api/kid/image?p='), String(thumbs));
  ws.close();
} catch (err) {
  console.error('✗ 探针出错:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  browser?.kill();
  if (keep) { serve.unref(); console.log(`留着:workspace ${root},serve ${base}(pid ${serve.pid},自己 kill)`); }
  else { serve.kill(); await sleep(800); rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
}

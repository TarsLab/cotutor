#!/usr/bin/env node
/**
 * 拍给我看卡(cards/photo/card.md,《卡片协议.md》「拍给我看卡」)的手动验收(不进 pnpm test,要本机 Chrome;走 mock,不花钱)。
 * 孩子端只走实时那条连接:造数据也经它发(_live-send.mjs),板上只有实时一种画法(2026-11-04)。
 * 一、起 cotutor mock → 英语老师说两条(第二节是拍给我看卡,末句不是问句)→ Chrome 开孩子端:卡下沿是「等你拍…」带拍照、相册,没有补提问卡 →
 *    CDP 往卡上「拍照」的 file input 塞一张 PNG → 进发照片屏 → 发 → 照片放大在这张卡里(整宽),「等你拍…」没了;老师下一节出来了,板上别处不回显这张。
 * 二、换一份新的 mock,同样说到拍给我看卡 → 孩子不拍、直接说一句 → 那句写在这张卡里(照片的位置空着),等你拍没了。
 *
 * 用法:node scripts/probe-photo-card.mjs [--out <截图目录>] [--keep](留下 mock)
 */
import { probeDir, spawn } from './_guard.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { QUIET_ARGS } from './_quiet.mjs';
import { liveSend } from './_live-send.mjs';

const keep = process.argv.includes('--keep');
const outAt = process.argv.indexOf('--out');
const out = outAt > 0 ? process.argv[outAt + 1] : null;
if (out) mkdirSync(out, { recursive: true });
const repo = fileURLToPath(new URL('..', import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 8803;
const cdp = 9345;
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, detail = '') => { if (!cond) fails++; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`); };

/** 一张 96 × 64 的 PNG(橙底一道斜线),当孩子拍的照片 */
function png() {
  const w = 96, h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const line = Math.abs(x - y * 1.5) < 3; raw[o] = line ? 40 : 232; raw[o + 1] = line ? 40 : 160; raw[o + 2] = line ? 40 : 90; }
  }
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** 起一份新的 mock(脚本从头来:英语老师第二段才是拍给我看卡);有旧的先关掉、等端口空出来 */
let mock = null;
const startMock = async () => {
  if (mock) { mock.kill(); for (let i = 0; i < 40; i++) { try { await fetch(`${base}/api/health`); } catch { break; } await sleep(250); } }
  mock = spawn(process.execPath, [join(repo, 'bin', 'cotutor.js'), 'mock', '--port', String(port), '--http', '--delay', '0'], { stdio: 'ignore', detached: keep });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(250); }
};
const api = async (method, path, body) => { const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
const settle = async (who) => { for (let i = 0; i < 80; i++) { const d = (await api('GET', `/api/kid/conversations/${who}/today`)).json; if (d && !d.pending && d.messages.every((m) => !m.pending)) return d; await sleep(250); } return null; };
/** 英语老师说两条:第一节点读,第二节拍给我看卡;都经实时那条连接 */
const toPhotoCard = async () => {
  await liveSend(base, 'english-tutor', { text: 'hi', newThread: true });
  await settle('english-tutor');
  await liveSend(base, 'english-tutor', { text: 'apple' });
  return settle('english-tutor');
};

const home = probeDir('cotutor-probe-photo-card-');
const shotFile = join(home, 'kid.png');
writeFileSync(shotFile, png());
const browser = spawn(chrome, [...QUIET_ARGS, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--remote-debugging-port=${cdp}`, '--window-size=1180,820', `--user-data-dir=${join(home, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
try {
  // ---- 一、拍照 ----
  await startMock();
  const d = await toPhotoCard();
  const sec = d?.messages[1]?.section;
  ok('第二节:一张拍给我看卡,末句不是问句,没补提问卡;两条都是实时的', sec?.cards.length === 1 && sec.cards[0].kind === 'photo' && sec.cards[0].props.text === '家里的一种水果' && !sec.lines[sec.lines.length - 1].ask && d.messages.every((m) => m.live === true), JSON.stringify(sec?.cards));

  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null; } catch {} if (!wsUrl) await sleep(250); }
  if (!wsUrl) throw new Error('Chrome 没起来');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result?.result?.value; };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  const shot = async (name) => { if (!out) return; const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
  const waitFor = async (expr, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { if (await evaluate(expr)) return true; await sleep(100); } return false; };
  const tap = async (sel) => {
    const r = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!r) throw new Error(`点不到 ${sel}`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  };
  const look = async (name) => { await evaluate(`document.querySelector('${card}')?.scrollIntoView({ block: 'center' })`); await sleep(300); await shot(name); };

  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/?tutor=english-tutor` });
  const card = '#board .sec[data-sec="1"] .c-photo';
  ok('孩子端:第二节是拍给我看卡(相机 + 要拍什么)', await waitFor(`!!document.querySelector('${card} .pc-ic svg') && document.querySelector('${card} .pc-t')?.textContent === '家里的一种水果'`));
  const slot = await evaluate(`(() => { const a = document.querySelector('${card} .kid-ans.snap'); if (!a) return null; return { shown: a.getClientRects().length > 0, text: a.textContent, btns: [...a.querySelectorAll('.pc-go')].map((b) => ({ t: b.textContent.trim(), svg: !!b.querySelector('svg'), cam: b.querySelector('input')?.getAttribute('capture') })), ask: document.querySelectorAll('#board .sec[data-sec="1"] .c-ask').length, otherAns: document.querySelectorAll('#board .kid-ans:not(.snap)').length }; })()`);
  ok('下沿是「等你拍…」带拍照、相册(带相机 / 相册图标;拍照直接开相机),没有提问卡、别的卡没有答案栏', slot?.shown && slot.text.includes('等你拍') && slot.btns.map((b) => b.t).join() === '拍照,相册' && slot.btns.every((b) => b.svg) && slot.btns[0].cam === 'environment' && !slot.btns[1].cam && slot.ask === 0 && slot.otherAns === 0, JSON.stringify(slot));
  await look('photo-card-01-wait');

  // ---- 往「拍照」塞一张图 → 发照片屏 → 发 ----
  const { result: { root } } = await send('DOM.getDocument', { depth: -1, pierce: false });
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: `${card} .pc-go input[capture]` });
  await send('DOM.setFileInputFiles', { nodeId, files: [shotFile] });
  ok('拍好了:进发照片屏(同输入条的相机)', await waitFor(`document.querySelector('#ps')?.classList.contains('on') && document.querySelector('#ps-go')?.textContent.includes('英语老师')`));
  await shot('photo-card-02-ps');
  await tap('#ps-go');
  ok('发了:照片放进这张卡,「等你拍…」没了', await waitFor(`!!document.querySelector('${card} .pc-shots img') && !document.querySelector('${card} .kid-ans.snap')`, 12000));
  await waitFor(`(() => { const i = document.querySelector('${card} .pc-shots img'); return i && i.complete && i.naturalWidth > 0; })()`, 4000);
  const big = await evaluate(`(() => { const c = document.querySelector('${card}'); const i = c.querySelector('.pc-shots img'); const cr = c.getBoundingClientRect(), ir = i.getBoundingClientRect(); return { cardW: Math.round(cr.width), imgW: Math.round(ir.width), imgH: Math.round(ir.height), inCard: ir.top >= cr.top && ir.bottom <= cr.bottom + 1, src: i.getAttribute('src'), words: c.querySelector('.pc-said')?.textContent ?? null, fit: getComputedStyle(i).objectFit }; })()`);
  ok('照片是大图:在卡里、几乎整宽(同图片卡的分量)、整张看得见;只发照片时补的「(拍了一张)」不写', big.inCard && big.imgW >= big.cardW - 60 && big.imgH >= 200 && big.fit === 'contain' && /captures/.test(decodeURIComponent(big.src ?? '')) && big.words === null, JSON.stringify(big));
  await settle('english-tutor');
  const after = await evaluate(`(() => { const secs = document.querySelectorAll('#board .sec'); const imgs = [...document.querySelectorAll('#board img')].filter((i) => i.getAttribute('src') === ${JSON.stringify(big.src)}); return { secs: secs.length, sameImgs: imgs.length, stillInCard: !!document.querySelector('${card} .pc-shots img') }; })()`);
  ok('老师下一节出来了,照片还在那张卡里,板上别处不回显', after.secs >= 3 && after.stillInCard && after.sameImgs === 1, JSON.stringify(after));
  await look('photo-card-03-sent');
  // 板是平滑滚动的:先滚过去停稳再点,不然量的位置是滚到一半的
  await evaluate(`document.querySelector('${card} .pc-shots img').scrollIntoView({ block: 'center' })`);
  await sleep(600);
  await tap(`${card} .pc-shots img`);
  ok('点照片看大图', await waitFor(`document.querySelector('#lb')?.classList.contains('on')`, 3000));
  await evaluate(`document.querySelector('#lb-x')?.click()`);

  // ---- 二、不拍,直接说一句:那句写在这张卡里 ----
  await startMock();
  await toPhotoCard();
  await send('Page.navigate', { url: `${base}/?tutor=english-tutor` });
  ok('新的一份:拍给我看卡等着拍', await waitFor(`!!document.querySelector('${card} .kid-ans.snap')`, 12000));
  await liveSend(base, 'english-tutor', { text: '我家里没有水果' });
  ok('没拍、直接说的那句写在这张卡里,没有照片,等你拍没了', await waitFor(`document.querySelector('${card} .pc-said')?.textContent === '我家里没有水果' && !document.querySelector('${card} .pc-shots') && !document.querySelector('${card} .kid-ans.snap')`, 12000));
  await look('photo-card-04-said');
} catch (e) {
  fails++;
  console.log('✗ 出错', e?.message ?? e);
} finally {
  browser.kill();
  if (!keep && mock) mock.kill();
}
console.log(fails ? `${fails} 项没过` : '全过');
if (out) console.log(`截图在 ${out}`);
process.exit(fails ? 1 : 0);

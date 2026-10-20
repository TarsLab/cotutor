#!/usr/bin/env node
/**
 * 实时老师整条线真跑一遍(《wip/实时老师开发计划.md》P2,孩子端页面之前):临时 workspace(语文老师开实时),本进程起服务,
 * 孩子是 Ray 的真录音(conversations/<老师>/<日期>.<job>.voice.webm,按真实节奏 100 毫秒一块推),嘴是真百炼 realtime,脑是真 qwen 语文老师。
 * 量:松手 → 嘴接住的首包、松手 → 第一拍照念的首包、讲完;嘴念的字与讲稿对不对得上;嘴的声音存成 wav 听。一轮几分钱。
 * 用法:node scripts/probe-live-call.mjs [--ws ~/cotutor/ray] [--out <目录>] [--voice Serena] [--tutor chinese-tutor] [--say 2026-10-18/1205-2,2026-10-18/1206-3]
 *   --say:按顺序发那位老师的哪几条(<日期>/<job>):按住说的推录音,拍照的那条把照片拷进临时 workspace 走 send;缺省语文老师「老师三明治怎么写」「能吃的三」两段,
 *   第二条起接着同一话题。数学:--tutor math-tutor --say 2026-10-18/1133-7,2026-10-18/1135-8,2026-10-18/1140-14(拍题、不会做、我才一年级)
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const src = arg('--ws', join(homedir(), 'cotutor', 'ray'));
const out = arg('--out', mkdtempSync(join(tmpdir(), 'cotutor-probe-live-call-')));
const voice = arg('--voice', 'Serena');
const tutor = arg('--tutor', 'chinese-tutor');
const says = arg('--say', '2026-10-18/1205-2,2026-10-18/1206-3').split(',').map((x) => x.split('/'));
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms) => { const t = Date.now() + ms; while (!f() && Date.now() < t) await sleep(20); return f(); };

const { initWorkspace } = await import(join(repo, 'src', 'cli', 'init.ts'));
const { loadWorkspace } = await import(join(repo, 'src', 'cli', 'workspace.ts'));
const { createContext, createHandler } = await import(join(repo, 'src', 'server', 'app.ts'));
const { makeLiveUpgrade } = await import(join(repo, 'src', 'live', 'route.ts'));
const { wavOfPcm } = await import(join(repo, 'src', 'live', 'lib', 'wav.ts'));
const { addChunk, playbackInit } = await import(join(repo, 'src', 'live', 'lib', 'playback.ts'));
const { spoken } = await import(join(repo, 'src', 'live', 'lib', 'cue.ts'));

// ---- 临时 workspace:出厂老师(qwen),语文老师开实时 ----
const wsRoot = join(out, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot, proxy: false });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
cfg.live = { enabled: true, voices: { [tutor]: voice } };
cfg.kid.name = 'Ray';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(wsRoot), { warm: false });
await ctx.reload();
const server = createServer(createHandler(ctx));
const upgrade = makeLiveUpgrade({});
server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ---- 孩子端:连上、按住推录音、松手 ----
const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/${tutor}/ws`);
ws.binaryType = 'arraybuffer';
const msgs = [];
const audio = [];
let t0 = Date.now();
const T = () => Date.now() - t0;
ws.onmessage = (e) => {
  if (typeof e.data === 'string') { const m = JSON.parse(e.data); m.at = T(); msgs.push(m); if (m.t !== 'tutor' || m.done !== undefined) console.log(`${String(m.at).padStart(6)} ms  ${JSON.stringify(m)}`); }
  else audio.push({ at: T(), pcm: Buffer.from(e.data) });
};
await new Promise((r) => { ws.onopen = r; ws.onerror = r; });
const ready = await until(() => msgs.some((m) => m.t === 'ready' || m.t === 'fallback'), 15000);
if (!ready || msgs.some((m) => m.t === 'fallback')) { console.log('嘴没连上', JSON.stringify(msgs)); process.exit(1); }

const report = [`# 实时老师整条线真跑(${new Date().toLocaleString('zh-CN')})`, '', `嘴 ${voice},脑 qwen ${tutor}(临时 workspace \`${wsRoot}\`)`, ''];
let first = true;
for (const [date, job] of says) {
  const idx = JSON.parse(readFileSync(join(src, 'conversations', tutor, `${date}.json`), 'utf8'));
  const m = idx.messages.find((x) => x.job === job);
  const n0 = msgs.length;
  const a0 = audio.length;
  if (m.voice) {
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', join(src, 'conversations', tutor, m.voice.audio), '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 64 << 20 });
    ws.send(JSON.stringify({ t: 'hold' }));
    for (let p = 0; p < pcm.length; p += 3200) { ws.send(pcm.subarray(p, p + 3200)); await sleep(100); }
    t0 = Date.now();
    ws.send(JSON.stringify({ t: 'release', body: first ? { newThread: true } : {} }));
  } else {
    // 拍照的那条:照片拷进临时 workspace 同一位置,走 send(同孩子端拍了发)
    for (const ph of m.photos ?? []) { mkdirSync(dirname(join(wsRoot, ph)), { recursive: true }); copyFileSync(join(src, ph), join(wsRoot, ph)); }
    t0 = Date.now();
    ws.send(JSON.stringify({ t: 'send', body: { text: m.photos?.length ? '' : m.text, ...(m.photos?.length ? { photos: m.photos } : {}), ...(first ? { newThread: true } : {}) } }));
  }
  first = false;
  // 等这一轮讲完:脑写完、讲稿都念到、最后一段声音放完
  await until(() => msgs.slice(n0).some((x) => x.t === 'turn'), 20000);
  const turn = msgs.slice(n0).find((x) => x.t === 'turn');
  await until(() => turn && ctx.runner.running(tutor) === null, 240000);
  const today = new Intl.DateTimeFormat('sv-SE').format(new Date());
  const sec = JSON.parse(readFileSync(join(wsRoot, 'conversations', tutor, `${today}.json`), 'utf8')).messages.find((x) => x.job === turn?.job)?.section;
  const lines = (sec?.lines ?? []).map((l) => l.text);
  await until(() => msgs.slice(n0).filter((x) => x.t === 'read').length >= lines.length, 60000);
  // 等这一轮的声音在孩子端放完再按下一轮(2026-10-19 第一版只等 4 秒,把最后一段掐了):不再来声音了,按收到的字节算放到哪
  await until(() => audio.length > a0 && T() - audio[audio.length - 1].at > 1000, 60000);
  // 照孩子端的排法算(到达 + 60 毫秒或上一块放完,取晚的):接住和第一段之间等脑的那几秒不能当成在放
  const playEnd = audio.slice(a0).reduce((p, x) => addChunk(p, 0, x.at, x.pcm.length / 48).p, playbackInit()).end;
  while (T() < playEnd + 500) await sleep(100);
  const mine = msgs.slice(n0);
  const pcmOut = Buffer.concat(audio.slice(a0).map((x) => x.pcm));
  const wav = `turn-${job}.wav`;
  writeFileSync(join(out, wav), wavOfPcm(pcmOut, 24000));
  const firstAudio = audio.slice(a0).find((x) => x.at >= 0)?.at ?? null;
  const reads = mine.filter((x) => x.t === 'read');
  const firstRead = reads[0]?.at ?? null;
  const totalMs = Math.round(pcmOut.length / 48);
  const dones = mine.filter((x) => x.t === 'tutor' && typeof x.done === 'string').map((x) => x.done);
  const kid = mine.find((x) => x.t === 'kid')?.text;
  const ev = readFileSync(join(wsRoot, 'conversations', tutor, `${today}.${turn?.job}.events.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const line0 = ev.find((e) => e.lane === 'main' && e.kind === 'line' && e.line === 0)?.t;
  const startEv = ev.find((e) => e.lane === 'main' && e.kind === 'start');
  report.push(`## Ray ${date} ${job}(当时认的「${m.text}」${m.photos?.length ? ',拍照' : ''})`, '',
    `- realtime 认的:${kid}`,
    `- 嘴接住:「${dones[0] ?? ''}」,松手到首包 ${firstAudio} ms`,
    `- 脑:${turn?.job},讲稿 ${lines.length} 句、${sec?.cards?.length ?? 0} 张卡(${(sec?.cards ?? []).map((c) => c.kind).join('、')});进程起来到第一句定稿 ${line0 ?? '?'} ms${startEv?.warmMs !== undefined ? '(预热的)' : '(冷起)'}`,
    `- 松手到第一句开始放 ${firstRead} ms(孩子端放到那一刻发 {t:read},一句一个);嘴念了 ${dones.length - 1} 段`,
    `- 嘴的声音一共 ${(totalMs / 1000).toFixed(1)} 秒;松手到放完 ${(audio.slice(a0).reduce((p, x) => addChunk(p, 0, x.at, x.pcm.length / 48).p, playbackInit()).end / 1000).toFixed(1)} 秒(照孩子端的排法算)`,
    `- 嘴念的:${dones.slice(1).join('')}`,
    `- 讲稿:${lines.join('')}`,
    `- 对得上(讲稿换成念法再比):${dones.slice(1).join('').replace(/[\s,，。!！?？、;；:：「」“”"']/g, '') === lines.map(spoken).join('').replace(/[\s,，。!！?？、;；:：「」“”"']/g, '') ? '一字不差' : '有出入'}`,
    `- 声音:${wav}(${(pcmOut.length / 48000).toFixed(1)} 秒)`, '');
}
ws.send(JSON.stringify({ t: 'bye' }));
await sleep(500);
writeFileSync(join(out, 'report.md'), report.join('\n') + '\n');
console.log('\n' + report.join('\n'));
console.log(`\n报告:${join(out, 'report.md')}`);
server.close();
process.exit(0);

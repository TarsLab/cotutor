/**
 * 实时老师整条线(《wip/实时老师开发计划.md》P2.4、P2.5),假百炼(_fake-realtime.ts)+ 假老师(_fake-cli.ts --stream),不花钱:
 * 连上(手动轮次、嘴的人设)→ 按住说、松手 → 嘴先接住 → 转写交给脑(实时轮,消息记 live、上下文包带 caught)→ 一拍一拍照念(念的字就是讲稿)→
 * 念的时候按下 = 打断(清队列,下一轮上下文包带 cut)→ 挂了落录像;没开 / 不在 live.voices 拒升级;嘴连不上告诉孩子端走板书。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';
import { startFakeRealtime } from './_fake-realtime.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-live-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.DASHSCOPE_API_KEY;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, createHandler } = await import('../src/server/app.ts');
const { makeLiveUpgrade } = await import('../src/live/route.ts');
const { catchCue } = await import('../src/live/lib/cue.ts');
const { localDate } = await import('../src/lib/conversation.ts');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 6000): Promise<boolean> => { const t = Date.now() + ms; while (!f() && Date.now() < t) await sleep(10); return f(); };

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const node = process.execPath;
const fakeRt = (extra: string[] = []) => ({
  run: [node, '--experimental-strip-types', '--no-warnings', FAKE, ...extra, '--tools', '{tools}', '--agent', '{agent}', '{prompt}'],
  resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, ...extra, '--tools', '{tools}', '--agent', '{agent}', '--resume', '{session}', '{prompt}'],
});

const fake = await startFakeRealtime();
const wsRoot = join(home, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
cfg.runtimes = { default: 'stream', stream: fakeRt(['--stream']) };
for (const t of Object.values(cfg.tutors as Record<string, { runtime?: string }>)) delete t.runtime;
cfg.tutors['chinese-tutor'].voice = 'v-chinese';
cfg.live = { enabled: true, voices: { 'chinese-tutor': 'Serena' } };
cfg.kid.name = 'Ray';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(wsRoot), { warm: false });
await ctx.reload();
const finished: [string, string][] = [];
const liveUpgrade = makeLiveUpgrade({ endpoint: fake.endpoint, env: { DASHSCOPE_API_KEY: 'sk-t' }, onFinished: (tutor, why) => finished.push([tutor, why]) });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void liveUpgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

type Msg = Record<string, any>;
async function connect(tutor: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/${tutor}/ws`);
  ws.binaryType = 'arraybuffer';
  const k = { ws, msgs: [] as Msg[], bins: 0, closed: null as { code: number; reason: string } | null, refused: false };
  ws.onmessage = (e) => { if (typeof e.data === 'string') k.msgs.push(JSON.parse(e.data)); else k.bins++; };
  ws.onclose = (e) => { k.closed = { code: e.code, reason: e.reason }; };
  await new Promise<void>((resolve) => { ws.onopen = () => resolve(); ws.onerror = () => { k.refused = true; resolve(); }; });
  return k;
}
const has = (k: { msgs: Msg[] }, f: (m: Msg) => boolean): boolean => k.msgs.some(f);
const loud = (): Uint8Array => new Uint8Array(3200).fill(9);
const quoted = (ins: string | undefined): string => { const at = (ins ?? '').indexOf('说完就停:「'); return at >= 0 ? (ins ?? '').slice(at + '说完就停:「'.length, -1) : ''; };
const indexOf = (date: string) => JSON.parse(readFileSync(join(wsRoot, 'conversations', 'chinese-tutor', `${date}.json`), 'utf8')) as { messages: Msg[] };

{
  const k = await connect('chinese-tutor');
  const okReady = await until(() => has(k, (m) => m.t === 'ready'));
  const c = fake.conns[0];
  check('连上:手动轮次、嘴的人设(语文老师、Ray、只照做)、音色是 live.voices 的', okReady && c.session?.turn_detection === null && String(c.session?.instructions).includes('语文老师') && String(c.session?.instructions).includes('Ray') && String(c.session?.instructions).includes('原样说出来') && c.session?.voice === 'Serena', JSON.stringify(c.session).slice(0, 300));
  k.ws.send(JSON.stringify({ t: 'view', w: 1180, h: 820 }));

  // ---- 一轮:按住说 → 松手 → 嘴接住 → 脑 → 照念 ----
  fake.kidText = '老师板书怎么写';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  for (let i = 0; i < 4; i++) k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: { newThread: true } }));
  const okCatch = await until(() => c.responses.length >= 1 && has(k, (m) => m.t === 'kid'));
  check('松手:推了按着时的声音、commit、嘴接住(接住的指令,不答内容)、孩子那句的转写到孩子端', okCatch && c.audio === 4 * 3200 && c.commits === 1 && c.responses[0]?.instructions === catchCue('voice') && has(k, (m) => m.t === 'kid' && m.text === '老师板书怎么写'), JSON.stringify({ audio: c.audio, commits: c.commits, r: c.responses[0] }));
  const okTurn = await until(() => has(k, (m) => m.t === 'turn'));
  const turn = k.msgs.find((m) => m.t === 'turn')!;
  const okRun = await until(() => ctx.runner.running('chinese-tutor') === null && c.responses.length >= 3, 15000);
  const today = localDate(ctx.now());
  const msg = indexOf(today).messages.find((m) => m.job === turn.job)!;
  const lines: string[] = (msg.section?.lines ?? []).map((l: Msg) => String(l.text));
  // 脑写完了,嘴还在一拍一拍念:等讲稿都念到
  const okAll = await until(() => k.msgs.filter((m) => m.t === 'read' && m.job === turn.job).flatMap((m) => m.lines).length === lines.length && c.responses.length === 1 + k.msgs.filter((m) => m.t === 'read').length, 10000);
  await until(() => k.bins >= 1 + k.msgs.filter((m) => m.t === 'read').length);
  const said = c.responses.slice(1).map((r) => quoted(r?.instructions)).join('');
  check('脑:实时轮(消息记 live、讲稿没配音)、开了新话题', okTurn && okRun && msg.live === true && msg.thread === turn.job && turn.thread === turn.job && lines.length >= 2 && msg.section.lines.every((l: Msg) => !l.audio), JSON.stringify({ live: msg.live, lines }));
  check('照念:一拍一拍交给嘴,念的字拼起来就是讲稿,一句不多一句不少', okAll && said === lines.join(''), JSON.stringify({ said, lines }));
  const reads = k.msgs.filter((m) => m.t === 'read');
  check('孩子端:每拍念之前收到 {t:read, job, lines},序号连起来是全部讲稿', reads.length >= 2 && reads.every((m) => m.job === turn.job) && reads.flatMap((m) => m.lines).join() === lines.map((_l, i) => i).join(), JSON.stringify(reads));
  const runFile = JSON.parse(readFileSync(join(wsRoot, 'conversations', 'chinese-tutor', `${today}.${turn.job}.run.json`), 'utf8')) as { prompt: string };
  check('上下文包带 live:(嘴接住时说的那句);第一轮没有 cut', runFile.prompt.includes("  live:\n    caught: \"It's a red car.\"") && !runFile.prompt.includes('    cut:'), runFile.prompt.slice(0, 400));
  check('嘴的声音、字幕都到孩子端', k.bins >= 3 && has(k, (m) => m.t === 'tutor' && typeof m.done === 'string'));

  // ---- 打断:念讲稿时按下 → 清队列;下一轮上下文包带 cut ----
  fake.kidText = '再讲一遍板书';
  const n0 = k.msgs.length;
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: {} }));
  await until(() => k.msgs.slice(n0).some((m) => m.t === 'turn'));
  const turn2 = k.msgs.slice(n0).find((m) => m.t === 'turn')!;
  // 第二轮第一拍一交给嘴(声音还在放的那 400 毫秒里)就按下
  const okRead2 = await until(() => k.msgs.slice(n0).some((m) => m.t === 'read' && m.job === turn2.job), 15000);
  const read2 = k.msgs.slice(n0).find((m) => m.t === 'read' && m.job === turn2.job)!;
  fake.kidText = '我懂了';
  const n1 = k.msgs.length;
  k.ws.send(JSON.stringify({ t: 'hold' }));
  const okFlush = await until(() => k.msgs.slice(n1).some((m) => m.t === 'flush'));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: {} }));
  await until(() => ctx.runner.running('chinese-tutor') === null && k.msgs.slice(n1).some((m) => m.t === 'turn'), 15000);
  const turn3 = k.msgs.slice(n1).find((m) => m.t === 'turn')!;
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const prompt3 = (JSON.parse(readFileSync(join(wsRoot, 'conversations', 'chinese-tutor', `${today}.${turn3.job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  const reads2 = k.msgs.slice(n0, n1).filter((m) => m.t === 'read' && m.job === turn2.job).length;
  check('打断:嘴的声音还在放时按下 → 孩子端清播放队列;那一轮没念的拍不再念', okRead2 && okFlush && reads2 === 1 && !k.msgs.slice(n1).some((m) => m.t === 'read' && m.job === turn2.job), JSON.stringify({ reads2, read2 }));
  check('下一轮:同一话题接着(不开新话题)、上下文包带 cut(孩子听到第几句,1 起)', turn3.thread === turn.job && prompt3.includes(`    cut: ${read2.lines[0] + 1}\n`), prompt3.slice(0, 500));

  // ---- 按了没说清(转写空的):嘴只说没听清,不交给脑 ----
  fake.kidText = '';
  const n2 = k.msgs.length;
  const r2 = c.responses.length;
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: {} }));
  const okEmpty = await until(() => c.responses.length === r2 + 1);
  await sleep(600);
  check('转写空的:嘴只说没听清(empty 的指令),不交给脑(没有 turn)', okEmpty && c.responses[r2]?.instructions === catchCue('empty') && !k.msgs.slice(n2).some((m) => m.t === 'turn') && c.responses.length === r2 + 1, JSON.stringify(c.responses.slice(r2)));

  // ---- 挂断:落录像 ----
  k.ws.send(JSON.stringify({ t: 'bye' }));
  const okEnd = await until(() => finished.length === 1 && k.closed !== null);
  const liveDir = join(wsRoot, 'conversations', 'chinese-tutor', `${today}.live`);
  const files = existsSync(liveDir) ? readdirSync(liveDir) : [];
  const reel = files.find((f) => f.endsWith('.reel.json'));
  const rj = reel ? JSON.parse(readFileSync(join(liveDir, reel), 'utf8')) : null;
  check('挂断:嘴关了、孩子端收到 end、落录像(reel.json 记进出的消息、屏幕尺寸,call.wav)', okEnd && finished[0][1] === 'bye' && c.closed && has(k, (m) => m.t === 'end') && files.some((f) => f.endsWith('.wav')) && rj?.view?.[0] === 1180 && rj.msgs.some((m: Msg) => m[1] === 'i' && m[2].t === 'hold'), JSON.stringify({ files, view: rj?.view }));
}

{
  // 没在 live.voices 的老师、关着的实时:拒升级(孩子端走板书)
  const k1 = await connect('math-tutor');
  check('不在 live.voices 的老师:升级被拒', k1.refused);
  // 嘴连不上(配会话就报错):告诉孩子端走板书,然后关
  fake.failUpdate = true;
  const k2 = await connect('chinese-tutor');
  const okFb = await until(() => has(k2, (m) => m.t === 'fallback') && k2.closed !== null);
  fake.failUpdate = false;
  check('嘴连不上:孩子端收到 fallback(带原因),连接关掉', okFb && String(k2.msgs.find((m) => m.t === 'fallback')?.why).includes('Voice not supported'), JSON.stringify(k2.msgs));
  cfg.live.enabled = false;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await ctx.reload();
  const k3 = await connect('chinese-tutor');
  check('live.enabled 关了:升级被拒', k3.refused);
}

server.close();
fake.close();
done();

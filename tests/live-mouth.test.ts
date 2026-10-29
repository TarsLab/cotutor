/**
 * 字幕重放的声音(src/runtime/journal/mouth-index.ts + call.ts 落盘 + 孩子端取的接口),假百炼 + 假老师,不花钱:
 * 每句的起点怎么摊(出齐的按字数、没出齐的按出了的字幕);一轮念完落 <日期>.<job>.mouth.wav / .json;孩子按下时没放的那几句也在;
 * 嘴出到一半被掐,出了的那截在;换了连接接着留;接口只给实时的轮、没有就 404。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';
import { startFakeRealtime } from './_fake-realtime.ts';

const { mouthIndex } = await import('../src/runtime/journal/mouth-index.ts');

// ---- 起点怎么摊(纯函数;48 字节 = 1 毫秒,24k 单声道)----
{
  const seg = (lines: number[], texts: string[], ms: number, heard: number, isDone: boolean) => ({ lines, texts, bytes: ms * 48, heard, done: isDone });
  const a = mouthIndex([seg([0, 1], ['一二三四', '五六七八九十一二'], 1200, 12, true), seg([2], ['再来'], 600, 2, true)], 48);
  check('出齐的段:段首精确,段里按字数摊;下一段接在后面', a.ms === 1800 && JSON.stringify(a.lines) === JSON.stringify([{ line: 0, ms: 0 }, { line: 1, ms: 400 }, { line: 2, ms: 1200 }]), JSON.stringify(a));
  const b = mouthIndex([seg([0, 1, 2], ['一二三四五', '六七八九十', '十一十二'], 500, 6, false)], 48);
  check('没出齐就被掐:一个字多长按出了的字幕算,只算出了声的那几句', b.ms === 500 && JSON.stringify(b.lines) === JSON.stringify([{ line: 0, ms: 0 }, { line: 1, ms: 417 }]), JSON.stringify(b));
  const c = mouthIndex([seg([0, 1], ['一二', '三四'], 300, 0, false), seg([2], ['五'], 0, 0, false)], 48);
  check('字幕一个字都没来:只算段首那句;没出声的段不算', c.ms === 300 && JSON.stringify(c.lines) === JSON.stringify([{ line: 0, ms: 0 }]), JSON.stringify(c));
}

// ---- 整条线 ----
const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-live-mouth-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.DASHSCOPE_API_KEY;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, createHandler, route } = await import('../src/app/http/app.ts');
const { makeLiveUpgrade } = await import('../src/app/ws/route.ts');
const { localDate } = await import('../src/shared/time.ts');
const { pcmOfWav } = await import('../src/shared/wav.ts');
const { isKidPath } = await import('../src/app/http/access.ts');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 8000): Promise<boolean> => { const t = Date.now() + ms; while (!f() && Date.now() < t) await sleep(10); return f(); };

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const node = process.execPath;
const fakeRt = (extra: string[] = []) => ({
  run: [node, '--experimental-strip-types', '--no-warnings', FAKE, ...extra, '--tools', '{tools}', '--agent', '{agent}', '{prompt}'],
  resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, ...extra, '--tools', '{tools}', '--agent', '{agent}', '--resume', '{session}', '{prompt}'],
});

const fake = await startFakeRealtime();
// 一段声音放 1.5 秒:嘴出完了,孩子端还要放好一会儿(按下时没放的那几句是有声音的)
fake.audioMs = 1500;
const wsRoot = join(home, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
cfg.runtimes = { default: 'stream', stream: fakeRt(['--stream']) };
for (const t of Object.values(cfg.tutors as Record<string, { runtime?: string }>)) delete t.runtime;
cfg.live = { voices: { 'chinese-tutor': 'Serena' } };
cfg.kid.name = 'Ray';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(wsRoot), { warm: false });
await ctx.reload();
// 每次回答完、安静时就换连接:换了连接还接着留
const upgrade = makeLiveUpgrade({ endpoint: fake.endpoint, env: { DASHSCOPE_API_KEY: 'sk-t' }, swapTokens: 1 });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void upgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

type Msg = Record<string, any>;
const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/chinese-tutor/ws`);
ws.binaryType = 'arraybuffer';
const msgs: Msg[] = [];
ws.onmessage = (e) => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
await new Promise<void>((r) => { ws.onopen = () => r(); });
await until(() => msgs.some((m) => m.t === 'ready'));
const today = localDate(ctx.now());
const dir = join(wsRoot, 'conversations', 'chinese-tutor');
const json = (job: string): Msg | null => { try { return JSON.parse(readFileSync(join(dir, `${today}.${job}.mouth.json`), 'utf8')) as Msg; } catch { return null; } };
const wavMs = (job: string): number => { try { return (pcmOfWav(readFileSync(join(dir, `${today}.${job}.mouth.wav`)))?.pcm.length ?? 0) / 48; } catch { return 0; } };
const linesOf = (job: string): string[] => ((JSON.parse(readFileSync(join(dir, `${today}.json`), 'utf8')) as { messages: Msg[] }).messages.find((m) => m.job === job)?.section?.lines ?? []).map((l: Msg) => String(l.text));
const say = (text: string, newThread = false): void => {
  fake.kidText = text;
  ws.send(JSON.stringify({ t: 'hold' }));
  for (let i = 0; i < 4; i++) ws.send(new Uint8Array(3200).fill(9));
  ws.send(JSON.stringify({ t: 'release', body: newThread ? { newThread: true } : {} }));
};
const turnAfter = async (n: number): Promise<string> => { await until(() => msgs.slice(n).some((m) => m.t === 'turn'), 8000); return msgs.slice(n).find((m) => m.t === 'turn')?.job ?? ''; };

// ---- 一轮念完:落盘,每段的段首对得上 ----
let n0 = msgs.length;
say('老师板书怎么写', true);
const job1 = await turnAfter(n0);
await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
const lines1 = linesOf(job1);
const ok1 = await until(() => (json(job1)?.lines?.length ?? 0) === lines1.length, 12000);
const j1 = json(job1)!;
const segs1 = Math.round(wavMs(job1) / 1500);
check('一轮念完:落 <日期>.<job>.mouth.wav / .json,讲稿每句都有起点、升序、第一句在 0', ok1 && lines1.length >= 2 && j1.lines.map((l: Msg) => l.line).join() === lines1.map((_l, i) => i).join() && j1.lines[0].ms === 0 && j1.lines.every((l: Msg, i: number) => i === 0 || l.ms > j1.lines[i - 1].ms), JSON.stringify({ lines1, j1 }));
check('声音是这一轮每段照念接起来的(一段 1.5 秒),json 的 ms 就是 wav 的长度;每段的段首在 1.5 秒的整数倍上', segs1 >= 1 && j1.ms === wavMs(job1) && wavMs(job1) % 1500 === 0 && j1.lines.filter((l: Msg) => l.ms % 1500 === 0).length === segs1, JSON.stringify({ ms: j1.ms, wav: wavMs(job1), segs1 }));

// ---- 接口:孩子端取得到;只给实时的轮 ----
const api = await route('GET', `/api/kid/conversations/chinese-tutor/mouth/${today}/${job1}`, ctx);
const body = api.json as Msg;
check('接口:GET /api/kid/conversations/<老师>/mouth/<日期>/<job> → 声音的地址、多长、每句的起点', api.status === 200 && body.audio === `/api/audio/chinese-tutor/${today}.${job1}.mouth.wav` && body.ms === j1.ms && JSON.stringify(body.lines) === JSON.stringify(j1.lines), JSON.stringify(api));
const wavR = await route('GET', body.audio, ctx);
check('声音从 /api/audio 取,audio/wav,不让缓存拿到半截', wavR.status === 200 && wavR.contentType === 'audio/wav' && wavR.cacheControl === 'no-cache' && typeof wavR.file === 'string' && wavR.file.endsWith('.mouth.wav'), JSON.stringify(wavR));
writeFileSync(join(dir, `${today}.0000-99.mouth.json`), JSON.stringify(j1));
const notLive = await route('GET', `/api/kid/conversations/chinese-tutor/mouth/${today}/0000-99`, ctx);
const noTutor = await route('GET', `/api/kid/conversations/no-such/mouth/${today}/${job1}`, ctx);
check('接口:索引里不是实时的那一轮(文件在也不给)、没有的老师 → 404', notLive.status === 404 && noTutor.status === 404, `${notLive.status} ${noTutor.status}`);
check('两条路都在孩子端的白名单里(设了 PIN 也取得到)', isKidPath(`/api/kid/conversations/chinese-tutor/mouth/${today}/${job1}`) && isKidPath(body.audio));
check('换了连接接着留(每次回答完、安静时换一条)', fake.conns.length >= 2, String(fake.conns.length));

// ---- 孩子按下时没放的那几句:嘴早出完了,也在 ----
await sleep(Math.max(0, j1.ms + 300));
// 一段放 4 秒:脑写完、嘴都出完时,孩子端还在放第一句
fake.audioMs = 4000;
n0 = msgs.length;
say('再讲一遍板书');
const job2 = await turnAfter(n0);
await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
const lines2 = linesOf(job2);
// 脑写完、嘴把讲稿都出完了(每段出完就落一次盘),孩子端还只放到前面:这时按下
const ready2 = await until(() => (json(job2)?.lines?.length ?? 0) === lines2.length, 8000);
const heard = msgs.slice(n0).filter((m) => m.t === 'read' && m.job === job2).length;
const n1 = msgs.length;
ws.send(JSON.stringify({ t: 'hold' }));
await until(() => msgs.slice(n1).some((m) => m.t === 'flush'), 3000);
ws.send(JSON.stringify({ t: 'hush' }));
await sleep(200);
const ok2 = ready2 && (json(job2)?.lines?.length ?? 0) === lines2.length && wavMs(job2) === json(job2)?.ms;
check('按下时孩子端只放到前面,没放的那几句也落了(嘴早出完了;按下后也没被截掉)', ok2 && lines2.length >= 2 && heard < lines2.length && msgs.slice(n1).some((m) => m.t === 'flush'), JSON.stringify({ heard, lines2: lines2.length, j2: json(job2) }));

// ---- 嘴出到一半被掐:出了的那截在 ----
await sleep(300);
fake.audioMs = 1500;
fake.long = true;
n0 = msgs.length;
say('第三遍');
const job3 = await turnAfter(n0);
// 换连接开了又作废的那条也在 fake.conns 里:回答、掐都按所有连接数
const cancels = () => fake.conns.reduce((a, x) => a + x.cancels, 0);
const cancels0 = cancels();
await until(() => msgs.slice(n0).some((m) => m.t === 'tutor' && m.of === 'read'), 8000);
await sleep(100);
ws.send(JSON.stringify({ t: 'hold' }));
ws.send(JSON.stringify({ t: 'hush' }));
fake.long = false;
const ok3 = await until(() => json(job3) !== null, 4000);
const j3 = json(job3);
check('嘴出到一半被掐(response 回 cancelled):出了的那截落了,起点都在它里面', ok3 && cancels() > cancels0 && wavMs(job3) === 1500 && j3!.ms === 1500 && j3!.lines.length >= 1 && j3!.lines[0].ms === 0 && j3!.lines.every((l: Msg) => l.ms < 1500), JSON.stringify({ j3, wav: wavMs(job3), cancels: cancels() - cancels0 }));

ws.send(JSON.stringify({ t: 'bye' }));
await sleep(200);
check('挂了以后文件还在(删话题时按 <日期>.<job>.* 一起删)', existsSync(join(dir, `${today}.${job1}.mouth.wav`)) && existsSync(join(dir, `${today}.${job3}.mouth.json`)));

server.close();
fake.close();
done();

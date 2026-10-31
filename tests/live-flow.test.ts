/**
 * 实时老师整条线,假百炼(_fake-realtime.ts)+ 假老师(_fake-cli.ts --stream),不花钱:
 * 连上(手动轮次、嘴的人设)→ 按住说、松手 → 嘴先接住 → 转写交给脑(实时轮,消息记 live、上下文包带 caught)→ 一拍一拍照念(念的字就是讲稿)→
 * 念的时候按下 = 打断(清队列,下一轮上下文包带 cut)→ 挂了落录像;没开 / 不在 live.voices 拒升级;嘴连不上告诉孩子端走板书。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
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

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, createHandler } = await import('../src/app/http/app.ts');
const { makeLiveUpgrade } = await import('../src/app/ws/route.ts');
const { catchCue } = await import('../src/realtime/cues.ts');
const { localDate } = await import('../src/shared/time.ts');

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
cfg.live = { voices: { 'chinese-tutor': 'Serena' } };
cfg.kid.name = 'Ray';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(wsRoot), { warm: false });
await ctx.reload();
const finished: [string, string][] = [];
// 心跳缺省 30 秒,前面几段跑不到;断线那段改短
const liveDeps: { endpoint: string; env: NodeJS.ProcessEnv; heartbeatMs?: number; keepAliveMs?: number; swapTokens?: number; idleSwapMs?: number; echoWaitMs?: number; ringMs?: number; stallMs?: number; onFinished: (tutor: string, why: string) => void } = { endpoint: fake.endpoint, env: { DASHSCOPE_API_KEY: 'sk-t' }, onFinished: (tutor, why) => finished.push([tutor, why]) };
const liveUpgrade = makeLiveUpgrade(liveDeps);
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void liveUpgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

type Msg = Record<string, any>;
async function connect(tutor: string, query = '', cookie?: string) {
  // Node 的 WebSocket(undici)认 headers:设备 cookie 由浏览器自己带,这里手填
  const ws = cookie ? new WebSocket(`ws://127.0.0.1:${port}/api/live/${tutor}/ws${query}`, { headers: { cookie } } as never) : new WebSocket(`ws://127.0.0.1:${port}/api/live/${tutor}/ws${query}`);
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
  const k = await connect('chinese-tutor', '', 'cotutor_kid=a1b2c3d4e5f6');
  const okReady = await until(() => has(k, (m) => m.t === 'ready'));
  const c = fake.conns[0];
  check('连上:手动轮次、嘴的人设(语文老师、Ray、只照做)、音色是 live.voices 的', okReady && c.session?.turn_detection === null && String(c.session?.instructions).includes('语文老师') && String(c.session?.instructions).includes('Ray') && String(c.session?.instructions).includes('原样说出来') && c.session?.voice === 'Serena', JSON.stringify(c.session).slice(0, 300));
  k.ws.send(JSON.stringify({ t: 'view', w: 1180, h: 820 }));

  // ---- 一轮:按住说 → 松手 → 嘴不出声 → 脑 → 照念 ----
  fake.kidText = '老师板书怎么写';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  for (let i = 0; i < 4; i++) k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: { newThread: true } }));
  const okCatch = await until(() => c.responses.length >= 1 && has(k, (m) => m.t === 'kid'));
  check('松手:推了按着时的声音、commit、嘴不先说(第一次开口就是照念讲稿)、孩子那句的转写到孩子端', okCatch && c.audio === 4 * 3200 && c.commits === 1 && String(c.responses[0]?.instructions).startsWith('把这几句话原样说给孩子听') && has(k, (m) => m.t === 'kid' && m.text === '老师板书怎么写'), JSON.stringify({ audio: c.audio, commits: c.commits, r: c.responses[0] }));
  const okTurn = await until(() => has(k, (m) => m.t === 'turn'));
  const turn = k.msgs.find((m) => m.t === 'turn')!;
  const okRun = await until(() => ctx.runner.running('chinese-tutor') === null && c.responses.length >= 3, 15000);
  const today = localDate(ctx.now());
  const msg = indexOf(today).messages.find((m) => m.job === turn.job)!;
  const lines: string[] = (msg.section?.lines ?? []).map((l: Msg) => String(l.text));
  // 脑写完了,嘴还在一段一段念:等讲稿每句都亮过
  const okAll = await until(() => k.msgs.filter((m) => m.t === 'read' && m.job === turn.job).length === lines.length, 10000);
  await until(() => k.bins >= c.responses.length);
  const said = c.responses.map((r) => quoted(r?.instructions)).join('');
  check('脑:实时轮(消息记 live、讲稿没配音、升级请求里的设备)、开了新话题', okTurn && okRun && msg.live === true && msg.deviceId === 'a1b2c3d4e5f6' && msg.thread === turn.job && turn.thread === turn.job && lines.length >= 2 && msg.section.lines.every((l: Msg) => !l.audio), JSON.stringify({ live: msg.live, lines }));
  check('照念:一拍一拍交给嘴,念的字拼起来就是讲稿,一句不多一句不少', okAll && said === lines.join(''), JSON.stringify({ said, lines }));
  const reads = k.msgs.filter((m) => m.t === 'read');
  check('孩子端:每句开始放时收到 {t:read, job, line, text},一句一个、序号连起来是全部讲稿、字就是讲稿', reads.length >= 2 && reads.every((m) => m.job === turn.job) && reads.map((m) => m.line).join() === lines.map((_l, i) => i).join() && reads.every((m) => m.text === lines[m.line]), JSON.stringify(reads));
  check('孩子端:嘴的字都标照念(说话那轮没有接住)', !has(k, (m) => m.t === 'tutor' && m.of === 'catch') && has(k, (m) => m.t === 'tutor' && m.of === 'read' && m.done === lines[0]));
  const runFile = JSON.parse(readFileSync(join(wsRoot, 'conversations', 'chinese-tutor', `${today}.${turn.job}.run.json`), 'utf8')) as { prompt: string };
  check('上下文包:嘴没说话就没有 caught;第一轮没有 cut', !runFile.prompt.includes('caught:') && !runFile.prompt.includes('    cut:'), runFile.prompt.slice(0, 400));
  check('嘴的声音、字幕都到孩子端', k.bins >= 3 && has(k, (m) => m.t === 'tutor' && typeof m.done === 'string'));
  {
    // 嘴这一道补进这一轮的事件:按下、松手、接住在老师进程起来之前(t 负的),之后每句开始放一条
    const evFile = join(wsRoot, 'conversations', 'chinese-tutor', `${today}.${turn.job}.events.jsonl`);
    // 嘴的事件是追加的(异步),最后一句的那条比发给孩子端的 read 晚一点落盘
    await until(() => (readFileSync(evFile, 'utf8').match(/"lane":"mouth","kind":"read"/g) ?? []).length >= lines.length, 2000);
    const evText = readFileSync(evFile, 'utf8');
    const mouth = evText.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Msg).filter((e) => e.lane === 'mouth').sort((a, b) => a.t - b.t);
    const kinds = mouth.map((e) => e.kind).join(',');
    const pre = mouth.filter((e) => e.kind === 'hold' || e.kind === 'release');
    check('事件:嘴这一道(按下、松手在老师进程起来之前,t 负的;说话那轮没有接住;之后每句开始放一条)', kinds.startsWith('hold,release,') && pre.length === 2 && pre.every((e) => e.t < 0) && !mouth.some((e) => e.kind === 'catch') && mouth.filter((e) => e.kind === 'read').map((e) => e.line).join() === lines.map((_l, i) => i).join() && mouth.filter((e) => e.kind === 'read').every((e) => e.t > 0), kinds + ' ' + JSON.stringify(pre));
  }

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
  // 按下那一刻之前亮到的最后一句(服务端先发的 read 先到;flush 之后不该再有这一轮的 read)
  const fl = k.msgs.findIndex((m, i) => i >= n1 && m.t === 'flush');
  const read2 = k.msgs.slice(n0, fl).filter((m) => m.t === 'read' && m.job === turn2.job).at(-1);
  check('打断:嘴的声音还在放时按下 → 孩子端清播放队列;那一轮没念的句不再亮、不再念', okRead2 && okFlush && Boolean(read2) && !k.msgs.slice(fl).some((m) => m.t === 'read' && m.job === turn2.job), JSON.stringify({ read2 }));
  {
    const ev2File = join(wsRoot, 'conversations', 'chinese-tutor', `${today}.${turn2.job}.events.jsonl`);
    await until(() => readFileSync(ev2File, 'utf8').includes('"kind":"cut"'), 2000);
    const ev2 = readFileSync(ev2File, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Msg);
    const cutEv = ev2.find((e) => e.lane === 'mouth' && e.kind === 'cut');
    check('事件:嘴在念时按下 → 被打断的那一轮记一条 cut(念到第几句)', Boolean(cutEv) && cutEv!.line === read2?.line && cutEv!.t > 0, JSON.stringify(cutEv));
  }
  check('下一轮:同一话题接着(不开新话题)、上下文包带 cut(孩子听到第几句,1 起:按下前亮到的那句)', turn3.thread === turn.job && prompt3.includes(`    cut: ${(read2?.line ?? -9) + 1}\n`), prompt3.slice(0, 500));

  // ---- 上滑取消(hush):按下又作废 → 不 commit、不接住、不交给脑 ----
  {
    await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
    const nh = k.msgs.length, rh = c.responses.length, ch = c.commits, clr = c.clears;
    k.ws.send(JSON.stringify({ t: 'hold' }));
    k.ws.send(loud());
    k.ws.send(JSON.stringify({ t: 'hush' }));
    await sleep(400);
    check('上滑取消:hush → 声音缓冲清掉、不 commit、嘴不接住、没有新一轮', c.commits === ch && c.clears >= clr + 2 && c.responses.length === rh && !k.msgs.slice(nh).some((m) => m.t === 'turn') && has(k, (m) => m.t === 'state' && m.holding === false), JSON.stringify({ commits: c.commits - ch, clears: c.clears - clr, responses: c.responses.length - rh }));
  }

  // ---- 舞台开着打字(问这张卡 撤了卡上的「?」):一轮普通的(嘴不先说,脑拿到 focus 那张卡) ----
  const na = k.msgs.length;
  const ra = c.responses.length;
  k.ws.send(JSON.stringify({ t: 'send', body: { text: '我想问这张卡', focus: { card: `${turn.job}/0` } } }));
  const okAsk = await until(() => k.msgs.slice(na).some((m) => m.t === 'turn'), 10000);
  const turnA = k.msgs.slice(na).find((m) => m.t === 'turn')!;
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const promptA = (JSON.parse(readFileSync(join(wsRoot, 'conversations', 'chinese-tutor', `${today}.${turnA.job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  check('舞台开着发的:嘴不先说、脑这一轮的上下文包带 focus 那张卡、消息正文是孩子端给的', okAsk && c.responses.slice(ra).every((r) => String(r?.instructions).startsWith('把这几句话原样说给孩子听')) && promptA.includes(`  focus:\n    card: "${turn.job}/0"`) && promptA.trimEnd().endsWith('我想问这张卡'), promptA.slice(0, 300));
  await sleep(800);

  // ---- 按了没说清(转写空的):嘴只说没听清,不交给脑 ----
  fake.kidText = '';
  const n2 = k.msgs.length;
  const r2 = c.responses.length;
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: {} }));
  const okEmpty = await until(() => c.responses.length === r2 + 1);
  await sleep(600);
  check('转写空的:转写回来是空的嘴说没听清(一次);不交给脑(没有 turn)', okEmpty && c.responses[r2]?.instructions === catchCue('empty') && !k.msgs.slice(n2).some((m) => m.t === 'turn') && c.responses.length === r2 + 1, JSON.stringify(c.responses.slice(r2)));

  // ---- 按着一块声音都没到(2026-10-19 iPad 麦克风没开):不 commit,嘴直接说没听清 ----
  {
    fake.kidText = '不该有这句';
    const n = k.msgs.length, r = c.responses.length, cm = c.commits;
    k.ws.send(JSON.stringify({ t: 'hold' }));
    k.ws.send(JSON.stringify({ t: 'release', body: {} }));
    const ok = await until(() => c.responses.length === r + 1);
    await sleep(400);
    check('按着没声音:不 commit、嘴只说没听清(一次)、孩子端收到空的转写、不交给脑', ok && c.commits === cm && c.responses[r]?.instructions === catchCue('empty') && c.responses.length === r + 1 && has({ msgs: k.msgs.slice(n) }, (m) => m.t === 'kid' && m.text === '') && !k.msgs.slice(n).some((m) => m.t === 'turn'), JSON.stringify({ commits: c.commits - cm, r: c.responses.slice(r) }));
  }

  // ---- commit 没收下(百炼回 buffer too small):照转写空的办 ----
  {
    fake.failCommit = true;
    const n = k.msgs.length, r = c.responses.length;
    k.ws.send(JSON.stringify({ t: 'hold' }));
    k.ws.send(loud());
    k.ws.send(JSON.stringify({ t: 'release', body: {} }));
    const ok = await until(() => c.responses.length === r + 1);
    await sleep(400);
    fake.failCommit = false;
    check('commit 没收下:嘴说没听清(一次)、不交给脑', ok && c.responses[r]?.instructions === catchCue('empty') && c.responses.length === r + 1 && !k.msgs.slice(n).some((m) => m.t === 'turn'), JSON.stringify(c.responses.slice(r)));
  }

  // ---- 拍照(P2.7):嘴说「我看看」,照片交给脑(嘴不看图);只有照片没有字也行 ----
  {
    await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
    await sleep(300);
    const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0xff, 0xd9]).toString('base64');
    const up = await fetch(`http://127.0.0.1:${port}/api/kid/conversations/chinese-tutor/photos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: JPEG }) });
    const photo = ((await up.json()) as { path: string }).path;
    const np = k.msgs.length, rp = c.responses.length;
    k.ws.send(JSON.stringify({ t: 'send', body: { text: '', photos: [photo] } }));
    const okPhoto = await until(() => k.msgs.slice(np).some((m) => m.t === 'turn'), 10000);
    const turnP = k.msgs.slice(np).find((m) => m.t === 'turn')!;
    await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
    const mp = indexOf(localDate(ctx.now())).messages.find((m) => m.job === turnP?.job);
    const promptP = turnP ? (JSON.parse(readFileSync(join(wsRoot, 'conversations', 'chinese-tutor', `${localDate(ctx.now())}.${turnP.job}.run.json`), 'utf8')) as { prompt: string }).prompt : '';
    check('拍照:嘴先说「我看一看图片」、上下文包带它(caught)、照片交给脑(消息记 photos、上下文包带 photos:)、嘴的会话里没塞图', up.status === 201 && okPhoto && c.responses[rp]?.instructions === catchCue('photo') && promptP.includes('    caught: ') && mp?.photos?.join() === photo && promptP.includes(`  photos:\n    - ${JSON.stringify(photo)}`) && c.images === 0, JSON.stringify({ status: up.status, catch: c.responses[rp], photos: mp?.photos }));
  }

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
  // ---- activity 也走实时(P3.1):首页按钮的开场 → 嘴不先说、脑照 activity 带;上一句念的是问句,孩子再开口嘴也不先说 ----
  const { publishHome } = await import('../src/runtime/home/store.ts');
  mkdirSync(join(wsRoot, 'home'), { recursive: true });
  writeFileSync(join(wsRoot, 'home', 'draft.md'), '```tutor chinese-tutor\nactivity 看图说话\n```\n\n## 为什么这么排\n\n试实时\n');
  const pub = await publishHome(ctx.ws, { now: ctx.now() });
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const k = await connect('chinese-tutor');
  await until(() => has(k, (m) => m.t === 'ready'));
  const c = fake.conns.at(-1)!;
  k.ws.send(JSON.stringify({ t: 'send', body: { text: '看图说话', newThread: true, via: { home: pub.home?.id, button: 0 } } }));
  const okTurn = await until(() => has(k, (m) => m.t === 'turn'), 10000);
  const turn = k.msgs.find((m) => m.t === 'turn')!;
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const m0 = indexOf(localDate(ctx.now())).messages.find((m) => m.job === turn?.job);
  check('首页按钮开的 activity:嘴不先说(第一次开口就是照念)、脑照 activity 带(消息记 via 与 activity)、实时轮', pub.ok && okTurn && String(c.responses[0]?.instructions).startsWith('把这几句话原样说给孩子听') && m0?.activity?.name === '看图说话' && m0?.via?.button === 0 && m0?.live === true, JSON.stringify({ ok: pub.ok, r: c.responses[0], activity: m0?.activity, via: m0?.via, live: m0?.live }));

  // 脑这一轮末句是问句,念完了孩子再开口(答问):嘴也不先说
  fake.kidText = '你先问我吧?';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: { thread: turn.thread } }));
  const lastQ = await until(() => k.msgs.some((m) => m.t === 'read' && String(m.text).endsWith('你先问我吧?')), 15000);
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await sleep(300);
  const r = c.responses.length;
  fake.kidText = '有一个男孩';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: { thread: turn.thread } }));
  await until(() => c.responses.length > r);
  check('上一句念的是问句:孩子答了,嘴也不先说(第一次开口就是照念)', lastQ && String(c.responses[r]?.instructions).startsWith('把这几句话原样说给孩子听'), JSON.stringify(c.responses.slice(r)));

  // 讲稿的 [[play]](小课堂,P3.2):念完那句先停,read 带 play;孩子端回 staged 才接着念后面的
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await sleep(300);
  fake.kidText = '放课';
  const np = k.msgs.length;
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: { thread: turn.thread } }));
  const okPlay = await until(() => k.msgs.slice(np).some((m) => m.t === 'read' && m.play === true), 15000);
  const playRead = k.msgs.slice(np).find((m) => m.t === 'read' && m.play === true);
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await sleep(600);
  const before = k.msgs.slice(np).filter((m) => m.t === 'read' && m.job === playRead?.job).map((m) => m.line);
  k.ws.send(JSON.stringify({ t: 'staged' }));
  const okRest = await until(() => k.msgs.slice(np).filter((m) => m.t === 'read' && m.job === playRead?.job).length === 3, 10000);
  const after = k.msgs.slice(np).filter((m) => m.t === 'read' && m.job === playRead?.job).map((m) => m.line);
  check('[[play]]:念完那句(read 带 play)就停,脑写完了也不往下念;孩子端回 staged 才接着念后面的', okPlay && playRead?.line === 0 && playRead?.text === '我们回到那里再看一遍。' && before.join() === '0' && okRest && after.join() === '0,1,2', JSON.stringify({ before, after, playRead }));
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  k.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => k.closed !== null);
}

{
  // ---- 不垫话:脑想得久(讲稿一句还没有)嘴也不出声;第一句就是讲稿,照常念完;事件里没有接住 ----
  const k = await connect('chinese-tutor');
  await until(() => has(k, (m) => m.t === 'ready'));
  const c = fake.conns.at(-1)!;
  fake.kidText = '工具慢,板书讲讲三角形';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: { newThread: true } }));
  await until(() => has(k, (m) => m.t === 'turn'), 10000);
  const turn = k.msgs.find((m) => m.t === 'turn')!;
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const lines: string[] = (indexOf(localDate(ctx.now())).messages.find((m) => m.job === turn.job)?.section?.lines ?? []).map((l: Msg) => String(l.text));
  const okRead = await until(() => k.msgs.filter((m) => m.t === 'read' && m.job === turn.job).length === lines.length, 10000);
  const evFile = join(wsRoot, 'conversations', 'chinese-tutor', `${localDate(ctx.now())}.${turn.job}.events.jsonl`);
  await until(() => (readFileSync(evFile, 'utf8').match(/"lane":"mouth","kind":"read"/g) ?? []).length >= 1, 2000);
  const ev = readFileSync(evFile, 'utf8');
  check('不垫话:脑想得久嘴也不出声,嘴说的每次都是照念讲稿;孩子端没有接住的字;事件里没有 catch / fill', okRead && lines.length >= 2 && c.responses.length >= 1 && c.responses.every((r) => String(r?.instructions).startsWith('把这几句话原样说给孩子听')) && !has(k, (m) => m.t === 'tutor' && m.of === 'catch') && !ev.includes('"kind":"catch"') && !ev.includes('"kind":"fill"'), JSON.stringify(c.responses.map((r) => String(r?.instructions).slice(0, 20))));
  k.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => k.closed !== null);
}

{
  // ---- 嘴卡住(2026-10-31 真百炼:照念那段回了 created 就再没动静,孩子只听到第一句):换一条连接,那段放回排头再念 ----
  liveDeps.stallMs = 400;
  const k = await connect('chinese-tutor');
  await until(() => has(k, (m) => m.t === 'ready'));
  const n0 = fake.conns.length;
  const c = fake.conns[n0 - 1];
  fake.kidText = '老师板书怎么写';
  fake.stuck = 1;
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: { newThread: true } }));
  await until(() => has(k, (m) => m.t === 'turn'), 10000);
  const turn = k.msgs.find((m) => m.t === 'turn')!;
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const lines: string[] = (indexOf(localDate(ctx.now())).messages.find((m) => m.job === turn.job)?.section?.lines ?? []).map((l: Msg) => String(l.text));
  const okAll = await until(() => k.msgs.filter((m) => m.t === 'read' && m.job === turn.job).length === lines.length, 10000);
  const reads = k.msgs.filter((m) => m.t === 'read' && m.job === turn.job).map((m) => m.line);
  const said = fake.conns.slice(n0).flatMap((x) => x.responses.map((r) => quoted(r?.instructions))).join('');
  check('嘴卡住:那段一个字没出 → 旧连接关掉、换一条;从卡住的那句接着念,每句亮一次,念的拼起来就是讲稿;孩子端没收到 end / down', okAll && lines.length >= 2 && c.closed && fake.conns.length > n0 && reads.join() === lines.map((_l, i) => i).join() && said === lines.join('') && !k.msgs.some((m) => m.t === 'end' || m.t === 'down'), JSON.stringify({ reads, lines, said, conns: fake.conns.length - n0, oldClosed: c.closed }));
  delete liveDeps.stallMs;
  k.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => k.closed !== null);
}

{
  // ---- 脑还没写出第一句就被打断:这一轮的讲稿全丢;孩子那句排着,脑写完再交;下一轮上下文包带 cut: 0(孩子一句没听到)----
  const k = await connect('chinese-tutor');
  await until(() => has(k, (m) => m.t === 'ready'));
  const today = localDate(ctx.now());
  fake.kidText = '工具慢,板书讲讲三角形';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: { newThread: true } }));
  await until(() => has(k, (m) => m.t === 'turn'), 10000);
  const jobA = k.msgs.find((m) => m.t === 'turn')!.job as string;
  const nA = k.msgs.length;
  fake.kidText = '我不会';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: {} }));
  const okB = await until(() => k.msgs.slice(nA).some((m) => m.t === 'turn'), 15000);
  const jobB = k.msgs.slice(nA).find((m) => m.t === 'turn')?.job as string;
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const promptB = jobB ? (JSON.parse(readFileSync(join(wsRoot, 'conversations', 'chinese-tutor', `${today}.${jobB}.run.json`), 'utf8')) as { prompt: string }).prompt : '';
  check('第一句之前被打断:那一轮一句都不念;孩子那句等脑写完再交;下一轮上下文包带 cut: 0', okB && !k.msgs.some((m) => m.t === 'read' && m.job === jobA) && promptB.includes('  live:\n    cut: 0\n'), promptB.slice(0, 300));
  // 这一轮念完了再按:孩子都听到了,不带 cut
  const linesB = (indexOf(today).messages.find((m) => m.job === jobB)?.section?.lines ?? []).length;
  await until(() => k.msgs.filter((m) => m.t === 'read' && m.job === jobB).length === linesB, 10000);
  await until(() => !k.msgs.length || k.bins >= fake.conns.at(-1)!.responses.length, 3000);
  await sleep(1200);
  const nC = k.msgs.length;
  fake.kidText = '懂了';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: {} }));
  await until(() => k.msgs.slice(nC).some((m) => m.t === 'turn'), 15000);
  const jobC = k.msgs.slice(nC).find((m) => m.t === 'turn')?.job as string;
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const promptC = jobC ? (JSON.parse(readFileSync(join(wsRoot, 'conversations', 'chinese-tutor', `${today}.${jobC}.run.json`), 'utf8')) as { prompt: string }).prompt : '';
  check('上一轮念完了再按:不带 cut', Boolean(jobC) && !promptC.includes('cut:'), promptC.slice(0, 300));
  k.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => k.closed !== null);
}

{
  // ---- 实时的讲稿不截(replyMaxChars 60 只管板书):超过 60 字的一句原样交给嘴、原样上字幕 ----
  const k = await connect('chinese-tutor');
  await until(() => has(k, (m) => m.t === 'ready'));
  const long = '我们一个一个来,登在白日依山尽前面那首诗的标题里,登鹳雀楼,读登,声母是d,韵母是eng,题目已经给了d,你补上eng就行了';
  fake.kidText = long;
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: { newThread: true } }));
  const okLong = await until(() => k.msgs.some((m) => m.t === 'read' && String(m.text).endsWith('你补上eng就行了')), 15000);
  check('实时的讲稿不截:超过 60 字的一句原样交给嘴、原样上字幕(没有「…」)', okLong && Array.from(long).length > 60 && !k.msgs.some((m) => m.t === 'read' && String(m.text).endsWith('…')), JSON.stringify(k.msgs.filter((m) => m.t === 'read').map((m) => m.text)));
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  k.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => k.closed !== null);
}

{
  // ---- 交卡:嘴不当场说「对啦」,也不说「我看看」;第一句就是脑的 ----
  const k = await connect('chinese-tutor');
  await until(() => has(k, (m) => m.t === 'ready'));
  const c = fake.conns.at(-1)!;
  fake.kidText = '老师板书再来一遍';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: { newThread: true } }));
  await until(() => has(k, (m) => m.t === 'turn'), 10000);
  const job = k.msgs.find((m) => m.t === 'turn')!.job as string;
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await sleep(400);
  const put = await fetch(`http://127.0.0.1:${port}/api/kid/conversations/chinese-tutor/cards/${job}/1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ picked: [0] }) });
  const r = c.responses.length;
  k.ws.send(JSON.stringify({ t: 'send', body: { text: '', action: 'submit', focus: { card: `${job}/1` } } }));
  await until(() => c.responses.length > r, 10000);
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const first = String(c.responses[r]?.instructions);
  check('交卡:嘴不先说(没有「对啦」「我看看」),第一句就是照念脑的讲稿', put.ok && first.startsWith('把这几句话原样说给孩子听'), first.slice(0, 80));
  k.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => k.closed !== null);
}

{
  // ---- 换连接(P3.3):嘴最近一次回答的输入过了线,安静时换一条新的;孩子端不知道,下一轮在新连接上 ----
  liveDeps.swapTokens = 800; // 假百炼每次回答报输入 865
  const k = await connect('chinese-tutor');
  await until(() => has(k, (m) => m.t === 'ready'));
  const n0 = fake.conns.length;
  const c = fake.conns[n0 - 1];
  fake.kidText = '老师你好';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: { newThread: true } }));
  await until(() => has(k, (m) => m.t === 'turn'), 10000);
  const swapped = await until(() => fake.conns.length > n0 && c.closed, 15000);
  const nk = k.msgs.length;
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await sleep(500);
  const cur = fake.conns.at(-1)!;
  const cm = cur.commits;
  fake.kidText = '再说一句';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: {} }));
  const okNext = await until(() => cur.commits === cm + 1 && cur.responses.length >= 1, 8000);
  check('换连接:一轮讲完、安静了换上新的,旧的关掉;孩子端没收到 end / down;下一轮落在新连接上', swapped && okNext && !k.msgs.some((m) => m.t === 'end' || m.t === 'down') && k.closed === null, JSON.stringify({ conns: fake.conns.length - n0, oldClosed: c.closed, commits: cur.commits - cm, after: k.msgs.slice(nk).map((m) => m.t).join(',') }));
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  k.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => k.closed !== null);
  liveDeps.swapTokens = undefined;
}

{
  // ---- 嘴断了(百炼 300 秒没输入就关):心跳;断了电话不挂,下次按下现连、按着说的照序补;现连不上走板书 ----
  liveDeps.heartbeatMs = 100;
  const k = await connect('chinese-tutor');
  await until(() => has(k, (m) => m.t === 'ready'));
  const c = fake.conns.at(-1)!;
  const a0 = c.audio, cl0 = c.clears;
  await sleep(450);
  check('心跳:孩子没按着时一次推 1 秒静音(32000 字节)接着 clear;不 commit、不要回答', c.audio - a0 >= 2 * 32000 && (c.audio - a0) % 32000 === 0 && c.clears - cl0 >= 2 && c.commits === 0 && c.responses.length === 0, JSON.stringify({ audio: c.audio - a0, clears: c.clears - cl0 }));
  k.ws.send(JSON.stringify({ t: 'hold' }));
  await sleep(50);
  const a1 = c.audio;
  await sleep(350);
  check('按着时不跳', c.audio === a1, JSON.stringify({ more: c.audio - a1 }));
  k.ws.send(JSON.stringify({ t: 'hush' }));

  // 百炼报 idle 超时(会话其实没了,连接还开着):当场关;电话还通着,孩子端不知道
  const n = k.msgs.length, nc = fake.conns.length;
  c.sock.sendText(JSON.stringify({ type: 'error', error: { code: 'response_idle_timeout', message: 'Your session was closed because no response was generated for 300 seconds.' } }));
  const okClosed = await until(() => c.closed);
  await sleep(200);
  check('idle 超时:嘴的会话当场关;孩子端没收到 end / down,电话还通着,也不马上重连', okClosed && !k.msgs.slice(n).some((m) => m.t === 'end' || m.t === 'down') && k.closed === null && fake.conns.length === nc, JSON.stringify(k.msgs.slice(n)));

  // 下次按下:现连一条新会话,连上之前按着说的照序补过去,松手照常一轮
  fake.kidText = '再讲一个字';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  for (let i = 0; i < 3; i++) k.ws.send(loud());
  k.ws.send(JSON.stringify({ t: 'release', body: {} }));
  const okNew = await until(() => fake.conns.length === nc + 1 && fake.conns[nc].commits === 1 && fake.conns[nc].responses.length >= 1);
  const c2 = fake.conns[nc];
  const okTurn = await until(() => k.msgs.slice(n).some((m) => m.t === 'turn'), 10000);
  check('断了以后按下:现连,按着说的三块都补过去、commit,转写交给脑开一轮(嘴第一次开口是照念)', okNew && (c2.audio - 3 * 3200) % 32000 === 0 && c2.audio >= 3 * 3200 && String(c2.responses[0]?.instructions).startsWith('把这几句话原样说给孩子听') && okTurn && !k.msgs.slice(n).some((m) => m.t === 'end'), JSON.stringify({ conns: fake.conns.length - nc, audio: c2?.audio, commits: c2?.commits, r: c2?.responses[0] }));
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await sleep(500);

  // 又断了,现连两次都连不上:告诉孩子端走板书,挂掉
  const nf = k.msgs.length;
  c2.sock.sendText(JSON.stringify({ type: 'error', error: { code: 'user_idle_timeout', message: 'Your session was closed because no user input was received for 300 seconds.' } }));
  await until(() => c2.closed);
  fake.failUpdate = true;
  k.ws.send(JSON.stringify({ t: 'hold' }));
  const okFb = await until(() => has({ msgs: k.msgs.slice(nf) }, (m) => m.t === 'down') && k.closed !== null);
  fake.failUpdate = false;
  check('现连两次都连不上:孩子端收到 down,电话挂掉', okFb && fake.conns.length === nc + 3, JSON.stringify({ msgs: k.msgs.slice(nf), conns: fake.conns.length - nc }));

  // 孩子走开久了(最后一次动静过了 keepAliveMs)就不跳,让百炼关
  liveDeps.keepAliveMs = 250;
  const k4 = await connect('chinese-tutor');
  await until(() => has(k4, (m) => m.t === 'ready'));
  const c4 = fake.conns.at(-1)!;
  await sleep(500);
  const a4 = c4.audio;
  await sleep(500);
  check('最后一次动静过了 keepAliveMs 就停跳', a4 > 0 && c4.audio === a4, JSON.stringify({ before: a4, after: c4.audio }));
  k4.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => k4.closed !== null);
  liveDeps.heartbeatMs = undefined;
  liveDeps.keepAliveMs = undefined;
}

{
  // ---- 一直听:VAD 判开口 / 说完,应用判收下 / 放过 ----
  const quiet = (): Uint8Array => new Uint8Array(3200);
  const say = (k: { ws: WebSocket }, n = 3): void => { for (let i = 0; i < n; i++) k.ws.send(loud()); k.ws.send(quiet()); };
  const idle = () => until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await idle();
  const nc = fake.conns.length;
  const k = await connect('chinese-tutor', '?listen=open');
  await until(() => has(k, (m) => m.t === 'ready'));
  const c = fake.conns[nc];
  const td = c.session?.turn_detection;
  check('一直听:嘴的会话开 VAD(server_vad、silence 1600),服务端不自己回、不自己掐', td?.type === 'server_vad' && td.silence_duration_ms === 1600 && td.create_response === false && td.interrupt_response === false, JSON.stringify(td));

  // 开口 → 说完 → 转写收下:同按下 + 松手(交给脑),孩子端先后收到 vad 开 / 关、kid
  fake.kidTexts = ['老师三明治怎么写'];
  k.ws.send(JSON.stringify({ t: 'ctx', body: { newThread: true, device: 'tablet-landscape' } }));
  const n0 = k.msgs.length;
  say(k);
  const okTurn = await until(() => k.msgs.slice(n0).some((m) => m.t === 'turn'), 10000);
  const after = k.msgs.slice(n0).map((m) => m.t);
  check('一直听:不用按,开口(vad 开)→ 说完(vad 关)→ 收下(kid)→ 脑开一轮(新话题,用孩子端报的上下文;嘴不先说)', okTurn && after.indexOf('vad') < after.indexOf('kid') && has({ msgs: k.msgs.slice(n0) }, (m) => m.t === 'kid' && m.text === '老师三明治怎么写') && c.responses.every((r) => String(r?.instructions).startsWith('把这几句话原样说给孩子听')) && c.commits === 0, JSON.stringify({ after, err: k.msgs.slice(n0).find((m) => m.t === "err") }));
  const turnA = k.msgs.slice(n0).find((m) => m.t === 'turn')!;
  await idle();
  const today = localDate(ctx.now());
  const msgA = indexOf(today).messages.find((m) => m.job === turnA.job)!;
  check('一直听:那一轮的消息就是孩子说的那句、开了新话题、记 live', msgA?.text === '老师三明治怎么写' && msgA.live === true && msgA.thread === turnA.job, JSON.stringify(msgA).slice(0, 200));
  await until(() => !k.msgs.length || k.bins >= c.responses.length, 3000);
  await sleep(300);

  // 咳嗽(转写是空的)、只有「嗯」、VAD 不收:放过,嘴不出声、不开新一轮、孩子端不报错
  const r0 = c.responses.length;
  const n1 = k.msgs.length;
  fake.kidTexts = ['', '嗯。'];
  say(k);
  say(k);
  fake.vadReject = 1;
  say(k);
  await until(() => k.msgs.slice(n1).filter((m) => m.t === 'skip').length >= 3);
  await sleep(200);
  // 假百炼的 vadReject 是推之前就设的,哪一段被拒看到达顺序;只比有哪三种
  const skips = k.msgs.slice(n1).filter((m) => m.t === 'skip').map((m) => m.why).sort().join();
  check('一直听:空的、语气词、VAD 不收都放过(skip 带原因),嘴不出声、没有新一轮、没有 err', skips === 'empty,filler,rejected' && c.responses.length === r0 && !k.msgs.slice(n1).some((m) => m.t === 'turn' || m.t === 'err' || m.t === 'kid'), JSON.stringify(k.msgs.slice(n1)));

  // 停一下接着说:还没交给脑时又开口,两句并成一条交给脑
  fake.kidTexts = ['他们在跳绳', '还有踢毽子'];
  k.ws.send(JSON.stringify({ t: 'ctx', body: { thread: turnA.job } }));
  const n2 = k.msgs.length;
  say(k);
  say(k);
  const okMerge = await until(() => k.msgs.slice(n2).some((m) => m.t === 'turn'), 10000);
  await idle();
  const turnB = k.msgs.slice(n2).find((m) => m.t === 'turn')!;
  const msgB = indexOf(today).messages.find((m) => m.job === turnB?.job);
  check('一直听:停一下接着说的两句并成一条交给脑(嘴没先说)', okMerge && k.msgs.slice(n2).filter((m) => m.t === 'turn').length === 1 && msgB?.text === '他们在跳绳,还有踢毽子' && c.responses.slice(r0).every((r) => String(r?.instructions).startsWith('把这几句话原样说给孩子听')), JSON.stringify({ text: msgB?.text, turns: k.msgs.slice(n2).filter((m) => m.t === 'turn').length }));
  await sleep(300);

  // 全双工:嘴在说时孩子开口 → 先压低(duck);是回声 → 恢复(unduck)不掐;是孩子的话 → 掐(flush)、开新一轮
  fake.audioMs = 3000;
  fake.kidTexts = ['还有呢'];
  const n3 = k.msgs.length;
  say(k);
  await until(() => k.msgs.slice(n3).some((m) => m.t === 'turn'), 10000);
  const turnC = k.msgs.slice(n3).find((m) => m.t === 'turn')!;
  await until(() => k.msgs.slice(n3).some((m) => m.t === 'read' && m.job === turnC.job), 15000);
  const firstRead = k.msgs.slice(n3).find((m) => m.t === 'read' && m.job === turnC.job)!;
  fake.kidTexts = [String(firstRead.text)];
  const n4 = k.msgs.length;
  say(k);
  await until(() => k.msgs.slice(n4).some((m) => m.t === 'skip'));
  const echo = k.msgs.slice(n4);
  check('全双工:嘴在说时开口先压低;转写是嘴自己的话(回声)→ 放过、恢复,不掐', echo.some((m) => m.t === 'duck') && echo.some((m) => m.t === 'skip' && m.why === 'echo') && echo.some((m) => m.t === 'unduck') && !echo.some((m) => m.t === 'flush'), JSON.stringify(echo.map((m) => m.t)));
  fake.kidTexts = ['我懂了'];
  const n5 = k.msgs.length;
  say(k);
  const okCut = await until(() => k.msgs.slice(n5).some((m) => m.t === 'turn'), 10000);
  const cut = k.msgs.slice(n5);
  check('全双工:嘴在说时孩子插嘴 → 压低 → 收下 → 掐(flush)、开新一轮', okCut && cut.some((m) => m.t === 'duck') && cut.findIndex((m) => m.t === 'flush') < cut.findIndex((m) => m.t === 'turn') && cut.some((m) => m.t === 'flush'), JSON.stringify(cut.map((m) => m.t)));
  await idle();
  fake.audioMs = 100;
  await sleep(500);

  // 关麦:说到一半孩子端停推(gate off),那一句作废(clear)
  const clears = c.clears;
  const n6 = k.msgs.length;
  k.ws.send(loud());
  await until(() => k.msgs.slice(n6).some((m) => m.t === 'vad' && m.on === true));
  k.ws.send(JSON.stringify({ t: 'gate', on: false }));
  const okGate = await until(() => k.msgs.slice(n6).some((m) => m.t === 'vad' && m.on === false));
  check('关麦:说到一半停推,那一句作废(clear、vad 关)、不开新一轮', okGate && c.clears > clears && !k.msgs.slice(n6).some((m) => m.t === 'turn'), JSON.stringify(k.msgs.slice(n6)));
  k.ws.send(JSON.stringify({ t: 'gate', on: true }));
  k.ws.send(quiet());

  // 放过的句子攒着没回答:离上次回答 idleSwapMs 就在安静时换连接(防 response_idle_timeout)
  liveDeps.idleSwapMs = 300;
  liveDeps.heartbeatMs = 100;
  k.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => k.closed !== null);
  const k2 = await connect('chinese-tutor', '?listen=open');
  await until(() => has(k2, (m) => m.t === 'ready'));
  const nc2 = fake.conns.length;
  fake.kidTexts = [''];
  say(k2);
  const okIdle = await until(() => fake.conns.length === nc2 + 1, 3000);
  check('一直听:放过的句子攒着没回答,到点安静时换连接(新的还是 VAD)', okIdle && fake.conns[nc2]?.session?.turn_detection?.type === 'server_vad', JSON.stringify({ conns: fake.conns.length - nc2 }));
  liveDeps.idleSwapMs = undefined;
  liveDeps.heartbeatMs = undefined;
  k2.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => k2.closed !== null);

  // 按住说进来,孩子端切到一直听:换一条开 VAD 的连接,告诉孩子端 listen
  const k3 = await connect('chinese-tutor');
  await until(() => has(k3, (m) => m.t === 'ready'));
  const nc3 = fake.conns.length;
  check('按住说进来:嘴的会话手动轮次', fake.conns[nc3 - 1].session?.turn_detection === null);
  k3.ws.send(JSON.stringify({ t: 'listen', open: true }));
  const okSwitch = await until(() => has(k3, (m) => m.t === 'listen' && m.open === true) && fake.conns.length === nc3 + 1);
  check('切到一直听:安静时换一条开 VAD 的连接,孩子端收到 listen', okSwitch && fake.conns[nc3].session?.turn_detection?.type === 'server_vad' && fake.conns[nc3 - 1].closed, JSON.stringify({ conns: fake.conns.length - nc3 }));
  k3.ws.send(JSON.stringify({ t: 'listen', open: false }));
  const okBack = await until(() => has(k3, (m) => m.t === 'listen' && m.open === false) && fake.conns.length === nc3 + 2);
  check('切回按住说:再换回手动轮次', okBack && fake.conns[nc3 + 1].session?.turn_detection === null);
  k3.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => k3.closed !== null);
}

{
  // ---- 口语课热身:[[echo 词]] / [[say 词]] 念完等孩子跟,[[call]] 念完进打电话 ----
  const quiet = (): Uint8Array => new Uint8Array(3200);
  const say = (k: { ws: WebSocket }, n = 3): void => { for (let i = 0; i < n; i++) k.ws.send(loud()); k.ws.send(quiet()); };
  const idle = () => until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const promptOf = (job: string): string => (JSON.parse(readFileSync(join(wsRoot, 'conversations', 'chinese-tutor', `${localDate(ctx.now())}.${job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  const said = (c: { responses: ({ instructions?: string } | null)[] }): string[] => c.responses.map((r) => quoted(r?.instructions));
  const turns = (k: { msgs: Msg[] }): Msg[] => k.msgs.filter((m) => m.t === 'turn');
  await idle();

  // A:没开口等够了接着下一拍,连着两拍没开口停下交脑(app: quiet);对老师说的打断热身交脑;脑回 [[call]] 进打电话
  liveDeps.echoWaitMs = 500;
  liveDeps.ringMs = 300;
  const na = fake.conns.length;
  const a = await connect('chinese-tutor', '?listen=open');
  await until(() => has(a, (m) => m.t === 'ready'));
  const ca = fake.conns[na];
  a.ws.send(JSON.stringify({ t: 'send', body: { text: '热身', newThread: true, device: 'tablet-landscape' } }));
  const okQuiet = await until(() => turns(a).length >= 2, 15000);
  const t1 = turns(a)[0], t2 = turns(a)[1];
  check('热身:开头嘴接住、第一拍并段念到 [[echo]] 那句;没开口等够了接着念第二拍', said(ca).some((x) => x.endsWith('我先来:duck!')) && said(ca).some((x) => x === '小声一点:duck…'), JSON.stringify(said(ca)));
  await idle();
  const pq = t2 ? promptOf(t2.job) : '';
  const mq = t2 ? indexOf(localDate(ctx.now())).messages.find((m) => m.job === t2.job) : null;
  check('热身:连着两拍没开口 → 停下,应用起一轮交脑(app: quiet,摸底两拍没开口,接在同一话题),你先说那句没念', okQuiet && t2.thread === t1.thread && pq.includes('    app: quiet\n') && pq.includes('    warmup:\n      - "跟 duck:没开口"\n      - "跟 duck:没开口"\n') && mq?.text === '(没出声)' && !said(ca).some((x) => x.includes('你先说')), JSON.stringify({ said: said(ca), pq: pq.slice(0, 600) }));
  await until(() => a.bins >= ca.responses.length, 3000);
  await sleep(300);
  // 又一堂:第一拍时孩子说的是对老师说的 → 打断(嘴接住、交脑,摸底带上这一笔);脑回 [[call]] → 念完响铃,应用起一轮(app: call)
  a.ws.send(JSON.stringify({ t: 'send', body: { text: '再热身', newThread: true, device: 'tablet-landscape' } }));
  await until(() => said(ca).filter((x) => x.endsWith('我先来:duck!')).length >= 2, 15000);
  await sleep(150);
  fake.kidTexts = ['那我们直接打电话吧'];
  a.ws.send(JSON.stringify({ t: 'ctx', body: { device: 'tablet-landscape' } }));
  const nt = turns(a).length;
  say(a);
  const okTalk = await until(() => turns(a).length >= nt + 2, 15000);
  const tt = turns(a)[nt], tc = turns(a)[nt + 1];
  const pt = tt ? promptOf(tt.job) : '';
  check('热身:孩子说的不像跟读 → 收下(kid)、嘴接住(中文)、交脑,摸底带「没跟,对你说」', okTalk && has(a, (m) => m.t === 'kid' && m.text === '那我们直接打电话吧') && pt.includes('      - "跟 duck:没跟,对你说「那我们直接打电话吧」"\n') && pt.trimEnd().endsWith('那我们直接打电话吧'), pt.slice(0, 700));
  await idle();
  const pc = tc ? promptOf(tc.job) : '';
  check('[[call]] 念完:孩子端收到 read 带 call,应用起一轮(app: call、带摸底、打电话 0 分钟)', has(a, (m) => m.t === 'read' && m.call === true && String(m.text).includes('现在就打电话')) && pc.includes('    app: call\n') && pc.includes('    phone: 0\n') && pc.includes('    warmup:\n'), pc.slice(0, 700));
  a.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => a.closed !== null);

  // B:跟了两拍、你先说一拍 → [[call]] 那句念完,后面那句不念;铃响够了才念英文开场;打电话里接住说英文
  liveDeps.echoWaitMs = 5000;
  liveDeps.ringMs = 600;
  await idle();
  const nb = fake.conns.length;
  const b = await connect('chinese-tutor', '?listen=open');
  await until(() => has(b, (m) => m.t === 'ready'));
  const cb = fake.conns[nb];
  b.ws.send(JSON.stringify({ t: 'send', body: { text: '热身', newThread: true, device: 'tablet-landscape' } }));
  await until(() => said(cb).some((x) => x.endsWith('我先来:duck!')), 15000);
  await until(() => b.bins >= cb.responses.length, 3000);
  await sleep(200);
  const n1 = turns(b).length;
  b.ws.send(JSON.stringify({ t: 'ctx', body: { device: 'tablet-landscape' } }));
  fake.kidTexts = ['duck'];
  say(b);
  const ok2 = await until(() => said(cb).includes('小声一点:duck…'), 5000);
  check('热身:孩子跟了(像跟读)→ 开闸念下一拍,不交脑、不报 kid', ok2 && turns(b).length === n1 && !has(b, (m) => m.t === 'kid' && m.text === 'duck'), JSON.stringify(said(cb)));
  await until(() => b.bins >= cb.responses.length, 3000);
  await sleep(200);
  fake.kidTexts = ['Duck!'];
  say(b);
  await until(() => said(cb).some((x) => x.includes('你先说')), 5000);
  await until(() => b.bins >= cb.responses.length, 3000);
  await sleep(200);
  fake.kidTexts = ['鸭子'];
  say(b);
  const okCall = await until(() => turns(b).length >= n1 + 1, 8000);
  const callRead = cb.responses.findIndex((r) => quoted(r?.instructions).includes('老师给你打个电话'));
  check('你先说答中文(三个字以内)也算跟了;[[call]] 那句念了,后面那句不念', okCall && callRead >= 0 && !said(cb).some((x) => x.includes('这句不该念')) && turns(b).length === n1 + 1, JSON.stringify(said(cb)));
  const tcb = turns(b)[n1];
  const pcb = tcb ? promptOf(tcb.job) : '';
  check('打电话那一轮的摸底:跟了两拍、你先说答了中文', pcb.includes('      - "跟 duck:说了「duck」,开口') && pcb.includes('      - "跟 duck:说了「Duck!」') && pcb.includes('      - "自己说 duck:说了「鸭子」(转写里没有 duck),带中文'), pcb.slice(0, 900));
  const tCall = Date.now();
  const okOpen = await until(() => said(cb).some((x) => x.startsWith('Hello Ray! Where are the ducks?')), 10000);
  check('铃响够了才念英文开场(ringMs)', okOpen && Date.now() - tCall >= 300, JSON.stringify([Date.now() - tCall, said(cb)]));
  await until(() => b.bins >= cb.responses.length, 3000);
  await sleep(200);
  fake.kidTexts = ['Under the bus'];
  const nr = cb.responses.length;
  say(b);
  const okEn = await until(() => cb.responses.length > nr, 5000);
  check('打电话里孩子说话:嘴不先说,下一次开口就是照念脑的', okEn && String(cb.responses[nr]?.instructions).startsWith('把这几句话原样说给孩子听'), JSON.stringify(cb.responses[nr]));
  await idle();
  b.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => b.closed !== null);
  await sleep(300);
  const liveDir = join(wsRoot, 'conversations', 'chinese-tutor', `${localDate(ctx.now())}.live`);
  const reels = readdirSync(liveDir).filter((f) => f.endsWith('.reel.json')).map((f) => readFileSync(join(liveDir, f), 'utf8'));
  check('录像里有热身的每一拍({t:"echo"},只记不发)', reels.some((r) => r.includes('"t":"echo"') && r.includes('"outcome":"said"')) && !has(b, (m) => m.t === 'echo'));
  liveDeps.echoWaitMs = undefined;
  liveDeps.ringMs = undefined;
}

{
  // 有脸的老师都走实时:没挑音色的用出厂的;不是有脸的老师拒升级
  const n0 = fake.conns.length;
  const k1 = await connect('math-tutor');
  const okMath = await until(() => has(k1, (m) => m.t === 'ready'));
  k1.ws.close();
  check('没挑音色的出厂老师照样连得上,嘴用出厂的音色(数学 Andre)', !k1.refused && okMath && fake.conns[n0]?.session?.voice === 'Andre', JSON.stringify(fake.conns[n0]?.session));
  check('不是有脸的老师:升级被拒', (await connect('nobody')).refused && (await connect('nobody-tutor')).refused);
  // 嘴连不上(配会话就报错):告诉孩子端 down(孩子端回到「正在叫老师」再连),然后关
  fake.failUpdate = true;
  const k2 = await connect('chinese-tutor');
  const okFb = await until(() => has(k2, (m) => m.t === 'down') && k2.closed !== null);
  fake.failUpdate = false;
  check('嘴连不上:孩子端收到 down(带原因),连接关掉', okFb && String(k2.msgs.find((m) => m.t === 'down')?.why).includes('Voice not supported'), JSON.stringify(k2.msgs));
}

{
  // 工作台音色页「实时的嘴」:列 56 个、谁在用;试听真连一次(这里是假百炼)照念这一句,存着第二次不再连;不认的音色 400;挑 / 清掉走 PATCH /api/config 的 live
  const http = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init);
  const list = (await (await http('/api/tts/realtime')).json()) as { voices: { voice: string }[]; inUse: Record<string, string[]>; fallback: string; enabled?: boolean };
  check('实时的嘴:列 56 个音色、谁在用(没挑的算出厂的)、缺省音色;没有总开关', list.voices.length === 56 && list.voices.some((x) => x.voice === 'Liora Mira') && list.inUse.Serena?.join() === 'chinese-tutor' && list.inUse.Andre?.join() === 'math-tutor' && list.fallback === 'Serena' && list.enabled === undefined, JSON.stringify({ n: list.voices.length, inUse: list.inUse }));
  process.env.COTUTOR_LIVE_ENDPOINT = fake.endpoint;
  const n0 = fake.conns.length;
  const p1 = await http(`/api/tts/realtime/preview?voice=${encodeURIComponent('Theo Calm')}&text=${encodeURIComponent('你好呀')}`);
  const wav = Buffer.from(await p1.arrayBuffer());
  const n1 = fake.conns.length;
  const p2 = await http(`/api/tts/realtime/preview?voice=${encodeURIComponent('Theo Calm')}&text=${encodeURIComponent('你好呀')}`);
  const bad = await http('/api/tts/realtime/preview?voice=Bella');
  delete process.env.COTUTOR_LIVE_ENDPOINT;
  const said = fake.conns[n0]?.responses[0]?.instructions ?? '';
  check('试听:真连一次照念这一句(音色带上)、回 wav;同一句同一音色第二次不再连;不认的音色 400', p1.status === 200 && p1.headers.get('content-type') === 'audio/wav' && wav.subarray(0, 4).toString() === 'RIFF' && n1 === n0 + 1 && fake.conns[n0].session?.voice === 'Theo Calm' && said.endsWith('「你好呀」') && p2.status === 200 && fake.conns.length === n1 && bad.status === 400, JSON.stringify({ s1: p1.status, s2: p2.status, bad: bad.status, conns: [n0, n1, fake.conns.length], voice: fake.conns[n0]?.session?.voice }));
  const patch = (body: unknown) => http('/api/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const r1 = await patch({ live: { voices: { 'math-tutor': 'Maia' } } });
  const c1 = (await (await http('/api/config')).json()) as { live: { voices: Record<string, string> } };
  const r2 = await patch({ live: { voices: { 'math-tutor': null } } });
  const c2 = (await (await http('/api/config')).json()) as { live: { voices: Record<string, string> } };
  const r3 = await patch({ live: { voices: { 'not-a-tutor': 'Tina' } } });
  check('挑 / 清掉:PATCH 能改 live(给数学老师挑、清掉回出厂的);不是有脸老师的键不写', r1.status === 200 && c1.live.voices['math-tutor'] === 'Maia' && c1.live.voices['chinese-tutor'] === 'Serena' && r2.status === 200 && !('math-tutor' in c2.live.voices) && r3.status >= 400, JSON.stringify({ r: [r1.status, r2.status, r3.status], c1: c1.live, c2: c2.live }));
}

server.close();
fake.close();
done();

/**
 * 画板的服务端,假百炼(_fake-realtime.ts)+ 假老师(_fake-cli.ts --stream),不花钱:
 * 纸的读写(key 是话题或 new;清掉那几版的图只认 captures/;from new 存到话题名下删掉 new 那张);
 * 边画边聊:画板开着时按头像说的(release 带 chat)只给嘴——图跟着声音进对话、嘴照 chatCue 接住、不起脑;孩子端说该说一句了({t:'chat'})安静时 0.5 秒静音 + 图交给嘴、
 * 那段的转写吞掉,不安静回 skipped;交画那一轮(纸的 drawing、画板卡的 submit)上下文包带 drawing: 与 live.draw:(这张画上说过的),嘴不先说;
 * 新话题的第一条收下 new 那张纸;删话题一起删;画板卡的描述带各颜色几笔、画了多久、清空过几次。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';
import { startFakeRealtime } from './_fake-realtime.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-live-canvas-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.DASHSCOPE_API_KEY;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, createHandler } = await import('../src/server/app.ts');
const { makeLiveUpgrade } = await import('../src/live/route.ts');
const { chatCue } = await import('../src/live/lib/cue.ts');
const { localDate } = await import('../src/lib/conversation.ts');
const { deleteThread } = await import('../src/server/store.ts');
const { canvasInkText } = await import('../src/cards/canvas.ts');
const { sectionsFromMessages } = await import('../src/lib/kid-board.ts');

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
cfg.live = { voices: { 'chinese-tutor': 'Serena' } };
cfg.kid.name = 'Ray';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(wsRoot), { warm: false });
await ctx.reload();
const liveUpgrade = makeLiveUpgrade({ endpoint: fake.endpoint, env: { DASHSCOPE_API_KEY: 'sk-t' } });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void liveUpgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

type Msg = Record<string, any>;
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0xff, 0xd9]).toString('base64');
const RED = '#d9482b', BLUE = '#2f6fd6';
const t0 = Date.parse('2026-10-24T20:00:00');
const stroke = (color: string, at: number, x: number) => ({ type: 'freedraw', strokeColor: color, updated: at, x, y: 10, width: 20, height: 20, points: [[0, 0], [20, 20]], customData: { layer: 'ink' } });
const INK = [stroke(RED, t0 + 60_000, 0), stroke(RED, t0 + 120_000, 30), stroke(BLUE, t0 + 180_000, 300)];
const today = localDate(ctx.now());
const convDir = join(wsRoot, 'conversations', 'chinese-tutor');
const paperFile = (key: string) => join(convDir, `${today}.${key}.paper.json`);

// ---- 画板卡的描述:各颜色几笔、画了多久(算上清空前那一版)、清空过几次与清掉的那几版 ----
{
  const text = canvasInkText({ ink: INK, cleared: [{ at: t0 + 30_000, from: t0 - 240_000, strokes: 12, image: 'captures/x/1.jpg' }] });
  check('画板卡的描述:画了几笔(红 2、蓝 1),画了约 7 分钟,清空重画过 1 次与清掉的那一版', text === '画了 3 笔(红 2、蓝 1),画了约 7 分钟,清空重画过 1 次,清掉的那几版:captures/x/1.jpg(用 Read 看)', text);
}

// ---- 纸的读写 ----
const up = await api('POST', '/api/kid/conversations/chinese-tutor/photos', { image: JPEG });
const shot = up.json.path as string;
{
  const empty = await api('GET', '/api/kid/conversations/chinese-tutor/paper?key=new');
  check('纸:没有就是空白的', empty.status === 200 && empty.json.state.ink.length === 0);
  check('纸:key 只认话题 id 或 new', (await api('GET', '/api/kid/conversations/chinese-tutor/paper?key=../x')).status === 400 && (await api('PUT', '/api/kid/conversations/chinese-tutor/paper', { key: 'abc', state: { ink: [] } })).status === 400);
  check('纸:状态不对 400', (await api('PUT', '/api/kid/conversations/chinese-tutor/paper', { key: 'new', state: { ink: 'x' } })).status === 400);
  const put = await api('PUT', '/api/kid/conversations/chinese-tutor/paper', { key: 'new', state: { ink: INK, cleared: [{ at: t0 + 30_000, from: t0 - 240_000, strokes: 12, image: shot }, { at: t0 + 40_000, strokes: 2, image: 'cotutor.json' }] } });
  const back = (await api('GET', '/api/kid/conversations/chinese-tutor/paper?key=new')).json.state;
  check('纸:存了再读回来;清掉那几版的图只认 captures/ 里在的', put.status === 200 && back.ink.length === 3 && back.cleared.length === 2 && back.cleared[0].image === shot && back.cleared[1].image === undefined, JSON.stringify(back.cleared));
  check('纸:存一次记一行实录(.paper.jsonl)', existsSync(join(convDir, `${today}.new.paper.jsonl`)));
}

async function connect(tutor: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/${tutor}/ws`);
  ws.binaryType = 'arraybuffer';
  const k = { ws, msgs: [] as Msg[], bins: 0 };
  ws.onmessage = (e) => { if (typeof e.data === 'string') k.msgs.push(JSON.parse(e.data)); else k.bins++; };
  await new Promise<void>((resolve) => { ws.onopen = () => resolve(); });
  return k;
}
const loud = (): Uint8Array => new Uint8Array(3200).fill(9);

const k = await connect('chinese-tutor');
await until(() => k.msgs.some((m) => m.t === 'ready'));
const c = fake.conns[0];
const ASK = { colors: [{ name: '红', strokes: 2, where: '左边' }, { name: '蓝', strokes: 1, where: '右边' }], minutes: '约 3 分钟' };

// ---- 边画边聊:按头像说的只给嘴 ----
{
  fake.kidText = '这是我画的楼';
  const n = k.msgs.length, r = c.responses.length, img = c.images, commits = c.commits;
  k.ws.send(JSON.stringify({ t: 'hold' }));
  await sleep(30);
  for (let i = 0; i < 4; i++) k.ws.send(loud());
  await sleep(80);
  k.ws.send(JSON.stringify({ t: 'release', body: { device: 'tablet-landscape' }, chat: { canvas: 'paper', image: JPEG, ask: ASK } }));
  const okReply = await until(() => c.responses.length > r && k.msgs.slice(n).some((m) => m.t === 'kid'));
  await sleep(500);
  const ins = c.responses[r]?.instructions ?? '';
  check('按头像说(画板开着):图跟着这段声音进对话、commit、嘴照 chatCue(reply) 接住', okReply && c.images === img + 1 && c.commits === commits + 1 && ins === chatCue('reply', ASK, []), ins.slice(0, 200));
  check('边画边聊的指令:看图说、用「像……」、问正事叫他按住「给老师看」', ins.includes('「像……」') && ins.includes('按住『给老师看』') && ins.includes('红色 2 笔,在左边'));
  check('不起脑:没有 turn、老师没在写', !k.msgs.slice(n).some((m) => m.t === 'turn') && ctx.runner.running('chinese-tutor') === null);
  check('孩子的转写照样发给孩子端', k.msgs.slice(n).some((m) => m.t === 'kid' && m.text === '这是我画的楼'));
  check('嘴的字标接住(孩子端当接住上字幕)', k.msgs.slice(n).some((m) => m.t === 'tutor' && m.of === 'catch' && typeof m.done === 'string'));
}

// ---- 边画边聊:孩子端说该说一句了 ----
{
  await until(() => !c.responses.length || k.msgs.filter((m) => m.t === 'state').length > 0);
  await sleep(300);
  const n = k.msgs.length, r = c.responses.length, img = c.images, audio = c.audio;
  k.ws.send(JSON.stringify({ t: 'chat', canvas: 'paper', image: JPEG, ask: { ...ASK, color: '红', ask: true } }));
  const okLook = await until(() => c.responses.length > r);
  await sleep(400);
  const ins = c.responses[r]?.instructions ?? '';
  check('说了回 {t:chat, canvas, said}(孩子端这时才记成说过一句)', k.msgs.slice(n).some((m) => m.t === 'chat' && m.canvas === 'paper' && m.said === true));
  check('安静时嘴主动说一句:先垫 0.5 秒静音再交图、commit,指令说刚画完的红色、问一句', okLook && c.images === img + 1 && c.audio - audio >= 16000 && ins.includes('刚画完的红色') && ins.includes('说完问一句') && ins.includes('「孩子:这是我画的楼」'), ins.slice(0, 300));
  check('垫的静音的转写吞掉了(不当孩子说的)', !k.msgs.slice(n).some((m) => m.t === 'kid'), JSON.stringify(k.msgs.slice(n).filter((m) => m.t === 'kid')));
  // 不安静(孩子按着):不说
  k.ws.send(JSON.stringify({ t: 'hold' }));
  await sleep(50);
  const r2 = c.responses.length;
  k.ws.send(JSON.stringify({ t: 'chat', canvas: 'paper', image: JPEG, ask: {} }));
  const okSkip = await until(() => k.msgs.some((m) => m.t === 'chat' && m.skipped === true));
  check('不安静(孩子按着)回 skipped,嘴不说', okSkip && c.responses.length === r2);
  k.ws.send(JSON.stringify({ t: 'hush' }));
  await sleep(200);
}

// ---- 交画(纸):画和说过的一起给脑,嘴不先说;新话题收下 new 那张纸 ----
let drawJob = '';
{
  const n = k.msgs.length, r = c.responses.length;
  const draw = await api('POST', '/api/kid/conversations/chinese-tutor/photos', { image: JPEG });
  k.ws.send(JSON.stringify({ t: 'send', body: { text: '', newThread: true, drawing: { key: 'new', image: draw.json.path } } }));
  const okTurn = await until(() => k.msgs.slice(n).some((m) => m.t === 'turn'), 10000);
  const turn = k.msgs.slice(n).find((m) => m.t === 'turn')!;
  drawJob = turn?.job ?? '';
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const prompt = (JSON.parse(readFileSync(join(convDir, `${today}.${turn.job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  const msg = (JSON.parse(readFileSync(join(convDir, `${today}.json`), 'utf8')) as { messages: Msg[] }).messages.find((m) => m.job === turn.job)!;
  check('交画:消息记 drawing(图、几笔、各颜色、多久、清掉的那几版),字是「(画了一张,没说话)」', okTurn && msg.drawing?.image === draw.json.path && msg.drawing.strokes === 3 && msg.drawing.colors === '红 2、蓝 1' && msg.drawing.ms === 420_000 && msg.drawing.cleared?.join() === shot && msg.text === '(画了一张,没说话)', JSON.stringify(msg.drawing));
  check('上下文包 drawing: 一句(photos 第几张、几笔、多久、清掉的那几版是第几张);画和清掉的那版进 photos', prompt.includes('  drawing: "孩子在纸上画的,photos 第 1 张;画了 3 笔(红 2、蓝 1);画了约 7 分钟;清空重画过,清掉的那几版是 photos 第 2 张"') && prompt.includes(`  photos:\n    - ${JSON.stringify(draw.json.path)}\n    - ${JSON.stringify(shot)}`), prompt.slice(prompt.indexOf('  live'), prompt.indexOf('  live') + 600));
  check('上下文包 live.draw:这张画上孩子说的、嘴说的', prompt.includes('    draw:\n      - "孩子:这是我画的楼"\n      - "你:'), prompt.slice(prompt.indexOf('  live'), prompt.indexOf('  live') + 400));
  check('交画那轮嘴不先说:后面的回答都是照念', c.responses.slice(r).every((x) => (x?.instructions ?? '').includes('说完就停:「')), JSON.stringify(c.responses.slice(r).map((x) => (x?.instructions ?? '').slice(0, 30))));
  check('新话题的第一条收下 new 那张纸', existsSync(paperFile(turn.job)) && !existsSync(paperFile('new')));
  const day = (await api('GET', '/api/kid/conversations/chinese-tutor/today')).json;
  const km = day.messages.find((m: Msg) => m.job === turn.job);
  check('孩子端:这条带 drawing(图、几笔、多久),不带别的', km?.drawing?.image === draw.json.path && km.drawing.strokes === 3 && km.drawing.ms === 420_000 && km.drawing.colors === undefined, JSON.stringify(km?.drawing));
  const secs = sectionsFromMessages(day.messages);
  const sec = secs.find((s) => s.job === turn.job);
  check('板上:这一节带 drawing(节前画卡),「(画了一张,没说话)」不当孩子说的话', Boolean(sec?.drawing) && !sec?.said, JSON.stringify({ drawing: sec?.drawing, said: sec?.said }));
}

// ---- 画板卡:边画边聊记在那张卡上,交卡那轮带给脑 ----
{
  const card = `${drawJob}/0`;
  fake.kidText = '红色是太阳';
  k.ws.send(JSON.stringify({ t: 'hold' }));
  await sleep(30);
  for (let i = 0; i < 4; i++) k.ws.send(loud());
  await sleep(80);
  const r = c.responses.length;
  k.ws.send(JSON.stringify({ t: 'release', body: {}, chat: { canvas: card, image: JPEG, ask: { prompt: '画太阳落山' } } }));
  await until(() => c.responses.length > r);
  await sleep(500);
  check('画板卡的题目进了指令,但不许照题目猜', (c.responses[r]?.instructions ?? '').includes('老师给的题目是「画太阳落山」') && (c.responses[r]?.instructions ?? '').includes('别照题目去猜'));
  const n = k.msgs.length;
  k.ws.send(JSON.stringify({ t: 'send', body: { text: '', action: 'submit', focus: { card } } }));
  await until(() => k.msgs.slice(n).some((m) => m.t === 'turn'), 10000);
  const turn = k.msgs.slice(n).find((m) => m.t === 'turn')!;
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  const prompt = (JSON.parse(readFileSync(join(convDir, `${today}.${turn.job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  check('交画板卡:live.draw 是这张卡上说过的(纸上的那几句交过了,不再带)', prompt.includes('    draw:\n      - "孩子:红色是太阳"') && !prompt.includes('这是我画的楼'), prompt.slice(prompt.indexOf('  live'), prompt.indexOf('  live') + 300));
}

// ---- 按住「给老师看」没说清:画照交给脑,嘴不说没听清 ----
{
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await sleep(300);
  // 转写是空的(纸上的画)
  await api('PUT', '/api/kid/conversations/chinese-tutor/paper', { key: drawJob, state: { ink: INK } });
  const pic = (await api('POST', '/api/kid/conversations/chinese-tutor/photos', { image: JPEG })).json.path as string;
  fake.kidText = '';
  let n = k.msgs.length, r = c.responses.length;
  k.ws.send(JSON.stringify({ t: 'hold' }));
  await sleep(30);
  for (let i = 0; i < 4; i++) k.ws.send(loud());
  await sleep(80);
  k.ws.send(JSON.stringify({ t: 'release', body: { thread: drawJob, drawing: { key: drawJob, image: pic } } }));
  const ok1 = await until(() => k.msgs.slice(n).some((m) => m.t === 'turn'), 10000);
  check('按住给老师看、转写是空的:画照交(这一轮起了),嘴没说没听清', ok1 && !c.responses.slice(r).some((x) => (x?.instructions ?? '').includes('没听清')), JSON.stringify(c.responses.slice(r).map((x) => (x?.instructions ?? '').slice(0, 20))));
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await sleep(300);
  // 声音太少(画板卡)
  n = k.msgs.length; r = c.responses.length;
  k.ws.send(JSON.stringify({ t: 'hold' }));
  await sleep(30);
  k.ws.send(JSON.stringify({ t: 'release', body: { thread: drawJob, action: 'submit', focus: { card: `${drawJob}/1` } } }));
  const ok2 = await until(() => k.msgs.slice(n).some((m) => m.t === 'turn'), 10000);
  check('按住给老师看、声音太少:交卡照交,不说没听清', ok2 && !c.responses.slice(r).some((x) => (x?.instructions ?? '').includes('没听清')) && !k.msgs.slice(n).some((m) => m.t === 'kid'));
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  fake.kidText = "It's a red car.";
}

// ---- 删话题一起删纸 ----
{
  await until(() => ctx.runner.running('chinese-tutor') === null, 15000);
  await deleteThread(ctx.ws, 'chinese-tutor', today, drawJob);
  check('删话题:那个话题的纸一起删', !existsSync(paperFile(drawJob)) && !existsSync(join(convDir, `${today}.${drawJob}.paper.jsonl`)));
}

k.ws.send(JSON.stringify({ t: 'bye' }));
await sleep(200);
server.close();
fake.close();
done();

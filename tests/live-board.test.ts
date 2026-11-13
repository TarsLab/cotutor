/**
 * 以板为主的话题在实时那条线上(假百炼 _fake-realtime.ts + 假老师 + 假看图,不花钱):
 * 孩子端报 {t:'board', body:{k:'pick'…}} → 记进板的日志、不起脑;安静时嘴照念这个字的念法(认字时写好的),孩子按着时不念;
 * 点完了 stillMs 没动静,应用替他叫一次老师(live.app: still,上下文包带上他点了什么);连着只叫一次,孩子开口了才再叫。
 */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { FAKE_RUNTIMES, startFakeTeacher } from './_fake-teacher.ts';
import { startFakeRealtime } from './_fake-realtime.ts';
import { writeKeys } from './_keys.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-live-board-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
writeKeys(home, { payg: 'sk-t' });
const teacher = await startFakeTeacher();
process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, createHandler } = await import('../src/app/http/app.ts');
const { makeLiveUpgrade } = await import('../src/app/ws/route.ts');
const { readCue } = await import('../src/realtime/cues.ts');
const { localDate } = await import('../src/shared/time.ts');
const { readBoard } = await import('../src/runtime/journal/board-log.ts');
type Look = import('../src/scenes/look.ts').Look;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 6000): Promise<boolean> => { const t = Date.now() + ms; while (!f() && Date.now() < t) await sleep(10); return f(); };

const LINES = [
  '{"lesson": "我是什么"}',
  '{"text": "变", "kind": "char", "pick": true, "box": [237, 233, 281, 267], "sure": true, "say": "变,变化的变"}',
  '{"text": "晒", "kind": "read", "pick": false, "box": [323, 102, 360, 125], "sure": true, "say": "晒,晒太阳"}',
  '{"full": "我会变。太阳一晒,我就变成汽。", "box": [216, 202, 912, 228]}',
];
const look: Look = async (o) => { o.onDelta?.(`${LINES.join('\n')}\n`); return { ok: true, text: LINES.join('\n'), ms: 5 }; };

const fake = await startFakeRealtime();
const wsRoot = join(home, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
cfg.runtimes = { ...FAKE_RUNTIMES };
for (const t of Object.values(cfg.tutors as Record<string, { runtime?: string }>)) delete t.runtime;
cfg.live = { voices: { 'chinese-tutor': 'Serena' } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(wsRoot), { look });
await ctx.reload();
const liveUpgrade = makeLiveUpgrade({ endpoint: fake.endpoint, stillMs: 400 });
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void liveUpgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
type Msg = Record<string, any>;
const T = 'chinese-tutor';
const today = localDate(ctx.now());
const convDir = join(wsRoot, 'conversations', T);
const ws0 = loadWorkspace(wsRoot);

const sock = new WebSocket(`ws://127.0.0.1:${port}/api/live/${T}/ws`);
sock.binaryType = 'arraybuffer';
const msgs: Msg[] = [];
sock.onmessage = (e) => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
await new Promise<void>((resolve) => { sock.onopen = () => resolve(); });
await until(() => msgs.some((m) => m.t === 'ready'));
const c = fake.conns[0];
const settle = async (): Promise<void> => { await sleep(100); await until(() => ctx.runner.running(T) === null, 15000); await ctx.runner.flush(); await sleep(800); };

// 点「预习」带着照片进来:以板为主的话题
const JPG = 'data:image/jpeg;base64,' + Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex').toString('base64');
const shot = (await api('POST', `/api/kid/conversations/${T}/photos`, { image: JPG })).json.path as string;
const home0 = (await api('GET', '/api/kid/home')).json as { home: string | null };
sock.send(JSON.stringify({ t: 'send', body: { text: '', via: { home: home0.home, button: 'preview' }, photos: [shot] } }));
await until(() => msgs.some((m) => m.t === 'turn'), 10000);
const thread = msgs.find((m) => m.t === 'turn')!.thread as string;
await settle();

// ---- 点字:嘴照念念法,不起脑 ----
{
  const r = c.responses.length;
  const turns = msgs.filter((m) => m.t === 'turn').length;
  sock.send(JSON.stringify({ t: 'board', body: { k: 'pick', thread, text: '变', base: shot } }));
  const said = await until(() => c.responses.length > r);
  check('点字:嘴照念认字时写好的念法(原样念)', said && c.responses[r]?.instructions === readCue(['变,变化的变']), c.responses[r]?.instructions);
  await sleep(200);
  check('点字不起脑', msgs.filter((m) => m.t === 'turn').length === turns && ctx.runner.running(T) === null);
  const log = await readBoard(ws0, T, today, thread);
  check('记进板的日志', log.some((e) => e.k === 'pick' && e.text === '变' && e.base === shot), JSON.stringify(log));
  // 他接着按了说话(又松开不说):等着替他叫的那次作废
  sock.send(JSON.stringify({ t: 'hold' }));
  await sleep(30);
  sock.send(JSON.stringify({ t: 'hush' }));
  await sleep(600);
  check('点完了他按了说话:不替他叫老师', msgs.filter((m) => m.t === 'turn').length === turns);
}

// ---- 不对的不理;孩子按着时不念 ----
{
  await sleep(600);
  const r = c.responses.length;
  sock.send(JSON.stringify({ t: 'board', body: { k: 'pick', thread: '0000-1', text: '变', base: shot } }));
  sock.send(JSON.stringify({ t: 'board', body: { k: 'pick', thread, text: 'abc', base: shot } }));
  await sleep(300);
  check('不是以板为主的话题、不是汉字:不念、不记', c.responses.length === r && (await readBoard(ws0, T, today, thread)).filter((e) => e.k === 'pick').length === 1);
  sock.send(JSON.stringify({ t: 'hold' }));
  await sleep(50);
  sock.send(JSON.stringify({ t: 'board', body: { k: 'pick', thread, text: '晒', base: shot } }));
  await sleep(300);
  check('孩子按着说话时点字:记下,嘴不念', c.responses.length === r && (await readBoard(ws0, T, today, thread)).filter((e) => e.k === 'pick').length === 2);
  sock.send(JSON.stringify({ t: 'hush' }));
  await sleep(200);
}

// ---- 点完了不说话:替他叫一次老师 ----
{
  const turns = msgs.filter((m) => m.t === 'turn').length;
  sock.send(JSON.stringify({ t: 'board', body: { k: 'pick', thread, text: '晒', base: shot } }));
  const called = await until(() => msgs.filter((m) => m.t === 'turn').length > turns, 6000);
  const turn = msgs.filter((m) => m.t === 'turn').slice(-1)[0];
  check('点完 stillMs 没动静:应用替他叫一次老师,接在这个话题', called && turn.thread === thread);
  await settle();
  const prompt = (JSON.parse(readFileSync(join(convDir, `${today}.${turn.job}.run.json`), 'utf8')) as { prompt: string }).prompt;
  check('那一轮:live.app: still,board: 里有他点了什么', prompt.includes('    app: still') && prompt.includes('点开看了笔顺:变、晒(2 次)') && prompt.includes('最近点的'), prompt.slice(prompt.indexOf('  board:'), prompt.indexOf('  board:') + 300));
  check('日志里记了一笔 still', (await readBoard(ws0, T, today, thread)).some((e) => e.k === 'still'));
  // 连着只叫一次:再点,不再叫
  const n2 = msgs.filter((m) => m.t === 'turn').length;
  sock.send(JSON.stringify({ t: 'board', body: { k: 'pick', thread, text: '变', base: shot } }));
  await sleep(1200);
  check('连着只叫一次:老师接话以后他还是只点不说,就等着', msgs.filter((m) => m.t === 'turn').length === n2);
}

sock.send(JSON.stringify({ t: 'bye' }));
await sleep(200);
server.close();
await fake.close();
await teacher.close();
done();

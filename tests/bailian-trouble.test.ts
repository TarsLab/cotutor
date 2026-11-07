/**
 * 百炼跑起来以后坏了(src/app/machine/bailian.ts 的 note / trouble / blocked / recheck、src/realtime/preview.ts 的 askRealtime):
 * 分类照官方错误码表;要家长动手的一次就算,网络抖要连着两次;health、孩子端首页、家长端都看得到;好了自己恢复。
 * 整条线走真的 WebSocket:假百炼拒绝握手 → 孩子端收到 down → 故障记下;脑的 401 也记下。不花钱。假 key 对真百炼的 401 是 2026-11-07 真跑过的,欠费没法真测。
 */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { startFakeChat } from './_fake-bailian-chat.ts';
import { FAKE_RUNTIMES, teacherReply } from './_fake-teacher.ts';
import { startFakeRealtime } from './_fake-realtime.ts';
import { kidSend } from './_kid-send.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-bailian-trouble-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.COTUTOR_LIVE_ENDPOINT;
let brainDown = false;
const teacher = await startFakeChat({ reply: (body) => (brainDown ? { status: 401, text: '' } : teacherReply(body)) });
process.env.COTUTOR_BRAIN_ENDPOINT = teacher.baseURL;

const { createBailian, probeMessage, troubleKind } = await import('../src/app/machine/bailian.ts');
const { askRealtime, probeRealtime } = await import('../src/realtime/preview.ts');
const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, createHandler, kidHome, route } = await import('../src/app/http/app.ts');
const { makeLiveUpgrade } = await import('../src/app/ws/route.ts');
const { PARENT_HOME_PAGE } = await import('../src/ui/parent/parent-home-page.ts');
const { KID_PAGE } = await import('../src/ui/kid/kid-page.ts');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 8000): Promise<boolean> => { const t = Date.now() + ms; while (!f() && Date.now() < t) await sleep(10); return f(); };

// ---- 分类:照官方错误码表 ----
{
  const table: [string, string][] = [
    ['InvalidApiKey', 'key'], ['invalid_api_key', 'key'], ['api:HTTP 401 invalid_api_key', 'key'], ['http:401', 'key'],
    ['Arrearage', 'money'], ['api:HTTP 400 Arrearage', 'money'], ['PrepaidBillOverdue', 'money'], ['PostpaidBillOverdue', 'money'], ['Throttling.AllocationQuota', 'money'], ['CommodityNotPurchased', 'money'], ['AccessDenied.Unpurchased', 'money'],
    ['Workspace.AccessDenied', 'space'], ['Model.AccessDenied', 'space'], ['AccessDenied', 'space'], ['http:403', 'space'],
    ['network', 'network'], ['timeout', 'network'], ['api:请求或流断了', 'network'],
    ['LimitRequests', 'other'], ['api:没有收尾', 'other'], ['connect', 'other'], ['什么别的话', 'other'],
  ];
  for (const [why, kind] of table) check(`分类:${why} → ${kind}`, troubleKind(why) === kind, troubleKind(why));
  check('试连的说法:key 错、欠费说得清', probeMessage('InvalidApiKey').includes('key') && probeMessage('Arrearage').includes('欠费') && probeMessage('network').includes('连不上百炼'));
  check('试连的说法:别的照旧', probeMessage('no_auth').includes('还没配') && probeMessage('connect').includes('连不上') && probeMessage('xyz') === '百炼说:xyz');
}

// ---- 什么时候算、什么时候好 ----
{
  let t = 1000;
  let answer: string | null = 'InvalidApiKey';
  let probed: string | null = null;
  const b = createBailian({ env: { HOME: home }, now: () => t, ask: async () => answer, probe: async () => probed });
  check('没出过事:没有故障,孩子端不灰', b.trouble() === null && b.blocked() === false);

  await b.note('mouth', 'connect');
  check('「连不上」先问清原因:问出 key 错,一次就算,孩子端灰', b.trouble()?.kind === 'key' && b.trouble()?.why === 'InvalidApiKey' && b.blocked() === true && b.trouble()?.blocked === true, JSON.stringify(b.trouble()));
  b.fine('mouth');
  check('连上了:没了', b.trouble() === null && !b.blocked());

  answer = 'network';
  await b.note('mouth', 'connect');
  check('网络抖一下:一次不算(不打扰家长)', b.trouble() === null && !b.blocked());
  await b.note('mouth', 'connect');
  check('连着两次:算,但孩子端不灰(不用家长动手,接着重连)', b.trouble()?.kind === 'network' && !b.blocked() && b.trouble()?.blocked === false);
  b.fine('mouth');

  answer = null;
  await b.note('mouth', 'connect');
  await b.note('mouth', 'connect');
  check('问的时候又答应了(不是 key 的事):连着两次也只算 other', b.trouble()?.kind === 'other');
  b.fine();

  await b.note('mouth', 'ended');
  await b.note('mouth', 'no_auth');
  check('通话自己结束、还没配:不算故障', b.trouble() === null);

  await b.note('call', 'buffer too small');
  await b.note('call', 'buffer too small');
  check('通话中百炼报的小事(声音太短):不算', b.trouble() === null);
  await b.note('call', 'Arrearage: Access denied');
  check('通话中报欠费:算,家长要知道;孩子端不灰(连得上,灰了也回不来)', b.trouble()?.kind === 'money' && !b.blocked());
  b.fine();

  await b.note('brain', 'api:HTTP 400 Arrearage');
  check('脑报欠费:算', b.trouble()?.kind === 'money' && !b.blocked());
  t += 3601_000;
  check('脑的错一小时没再犯:过去了(再试要花钱,不能自己试)', b.trouble() === null);

  await b.note('mouth', 'Arrearage');
  await b.note('brain', 'api:HTTP 401 invalid_api_key');
  check('几处都有:先说嘴的', b.trouble()?.kind === 'money');
  b.fine('mouth');
  check('嘴好了,脑还坏着:还说', b.trouble()?.kind === 'key');
  b.fine('brain');

  await b.note('mouth', 'Arrearage');
  probed = 'Arrearage';
  await b.recheck();
  check('隔一阵再试还不行:还在', b.blocked() === true);
  probed = null;
  await b.recheck();
  check('隔一阵再试通了(充上钱):自己好', b.trouble() === null && !b.blocked());
  let asked = 0;
  const idle = createBailian({ env: { HOME: home }, probe: async () => { asked++; return null; } });
  await idle.recheck();
  check('没事的时候不试', asked === 0);

  await b.note('mouth', 'Arrearage');
  await b.save({ key: 'sk-0123456789abcdef0123', workspaceId: 'llm-x' });
  check('换了 key:清掉', b.trouble() === null);
}

// ---- 握手被拒问得出原因;WebSocket 自己只知道 connect ----
const servers: Server[] = [];
const listen = async (h: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; s: Server }> => {
  const s = createServer(h);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { url: `ws://127.0.0.1:${(s.address() as { port: number }).port}/api-ws/v1/realtime`, s };
};
const refuse401 = await listen((_q, r) => { r.writeHead(401, { 'content-type': 'application/json' }).end('{"request_id":"x","code":"InvalidApiKey","message":"Invalid API-key provided."}'); });
{
  check('askRealtime:被拒回错误码(同 2026-11-07 假 key 真跑的回答)', await askRealtime({ endpoint: refuse401.url }) === 'InvalidApiKey');
  const noBody = await listen((_q, r) => { r.writeHead(403).end(); });
  check('askRealtime:没有错误码回状态码,分类认得', await askRealtime({ endpoint: noBody.url }) === 'http:403' && troubleKind('http:403') === 'space');
  const nested = await listen((_q, r) => { r.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"code":"Arrearage","message":"Access denied"}}'); });
  check('askRealtime:错误码包在 error 里也认', await askRealtime({ endpoint: nested.url }) === 'Arrearage');
  check('askRealtime:根本连不上回 network', await askRealtime({ endpoint: 'ws://127.0.0.1:9/x', timeoutMs: 1000 }) === 'network');
  const fake = await startFakeRealtime();
  check('askRealtime:答应升级了回 null(key 是好的)', await askRealtime({ endpoint: fake.endpoint }) === null);
  check('试连:连不上时带回问到的原因,不再是笼统的 connect', await probeRealtime({ endpoint: refuse401.url }) === 'InvalidApiKey');
  check('试连:通了还是 null', await probeRealtime({ endpoint: fake.endpoint }) === null);
  check('askRealtime:没配 key 不发请求', await askRealtime({ env: { HOME: join(home, 'nobody') } }) === 'no_auth');
}

// ---- 整条线:孩子点开老师,百炼拒绝 → 家长看得到,孩子端首页灰;好了恢复 ----
const wsRoot = join(home, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
cfg.runtimes = { ...FAKE_RUNTIMES, default: 'stream' };
for (const t of Object.values(cfg.tutors as Record<string, { runtime?: string }>)) delete t.runtime;
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

let probeAnswer: string | null = 'InvalidApiKey';
// 带上 process.env:脑、配音的假端点都在里面,漏了就真的打到百炼上去了
const env = { ...process.env, HOME: home, COTUTOR_LIVE_ENDPOINT: refuse401.url };
const bailian = createBailian({ env, probe: async () => probeAnswer });
const ctx = createContext(loadWorkspace(wsRoot), { env, bailian });
await ctx.reload();
const good = await startFakeRealtime();
let useGood = false;
const upBad = makeLiveUpgrade({ endpoint: refuse401.url });
const upGood = makeLiveUpgrade({ endpoint: good.endpoint });
const server = createServer(createHandler(ctx));
servers.push(server);
server.on('upgrade', (req, socket, head) => { void (useGood ? upGood : upBad)(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

const call = async (): Promise<{ msgs: Record<string, unknown>[]; ws: WebSocket }> => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live/math-tutor/ws`);
  const msgs: Record<string, unknown>[] = [];
  ws.onmessage = (e) => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data) as Record<string, unknown>); };
  await new Promise<void>((r) => { ws.onopen = () => r(); });
  return { msgs, ws };
};
const health = async () => (await route('GET', '/api/health', ctx)).json as { bailian: boolean; bailianTrouble: { kind: string; message: string; fix: string; blocked: boolean } | null };

{
  check('开始:没有故障,孩子端首页 ready', (await health()).bailianTrouble === null && (await kidHome(ctx, ctx.now())).ready === true);
  const c = await call();
  check('嘴连不上:孩子端收到 down', await until(() => c.msgs.some((m) => m.t === 'down')), JSON.stringify(c.msgs));
  const h = await health();
  check('health:说清楚是 key 的事,配置那一项还是 true(配是配了)', h.bailian === true && h.bailianTrouble?.kind === 'key' && h.bailianTrouble.blocked === true && h.bailianTrouble.message.includes('key'), JSON.stringify(h));
  check('孩子端首页:ready false(说「叫爸爸妈妈」,不一直转)', (await kidHome(ctx, ctx.now())).ready === false);
  check('down 时孩子端回头看首页', KID_PAGE.includes("case 'down': liveDispatch({ type: 'drop' }); gateCheck(); break;"));
  const view = (await route('GET', '/api/parent/bailian', ctx, undefined, 'local')).json as { ready: boolean; trouble: { kind: string } | null };
  check('家长端百炼接口:带上故障;ready 还是「填过」', view.ready === true && view.trouble?.kind === 'key');
  check('家长端首页:有故障条,带试连', PARENT_HOME_PAGE.includes('id="troublebar"') && PARENT_HOME_PAGE.includes('hh.bailianTrouble'));
  check('家长端首页:key 或业务空间不对时,表单放最上面、展开(只自动展开一次,家长收起就收起)', PARENT_HOME_PAGE.includes("const blTop = BL.st && (!BL.st.ready || blFix)") && PARENT_HOME_PAGE.includes('!BL.opened'));
  c.ws.close();

  const stillBad = (await route('POST', '/api/parent/bailian/test', ctx, undefined, 'local')).json as { ok: boolean; message: string };
  check('试连没通:说原因,故障还在', stillBad.ok === false && stillBad.message.includes('key') && (await health()).bailianTrouble?.kind === 'key', JSON.stringify(stillBad));
  probeAnswer = null;
  const nowOk = (await route('POST', '/api/parent/bailian/test', ctx, undefined, 'local')).json as { ok: boolean };
  check('试连通了:故障清掉,孩子端马上能用', nowOk.ok === true && (await health()).bailianTrouble === null && (await kidHome(ctx, ctx.now())).ready === true);

  await bailian.note('mouth', 'Arrearage');
  useGood = true;
  const ok = await call();
  check('嘴连上了:故障清掉', await until(() => ok.msgs.some((m) => m.t === 'ready')) && (await health()).bailianTrouble === null, JSON.stringify(ok.msgs));
  ok.ws.close();
}

// ---- 脑的请求失败也记下;下一轮成了就好 ----
{
  brainDown = true;
  await kidSend(ctx, 'math-tutor', { from: 'kid', text: '第一句', newThread: true });
  check('脑 401:记下,带状态码', await until(() => bailian.trouble() !== null) && bailian.trouble()?.kind === 'key' && (bailian.trouble()?.why ?? '').includes('api:HTTP 401'), JSON.stringify(bailian.trouble()));
  check('脑坏了不灰孩子端(嘴还连得上)', (await kidHome(ctx, ctx.now())).ready === true);
  await until(() => ctx.runner.running('math-tutor') === null);
  brainDown = false;
  await kidSend(ctx, 'math-tutor', { from: 'kid', text: '第二句', newThread: true });
  check('下一轮成了:好了', await until(() => bailian.trouble() === null), JSON.stringify(bailian.trouble()));
}

for (const s of servers) s.close();
done();

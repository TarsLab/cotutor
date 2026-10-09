/**
 * 按住说话交给 omni 听写(kid.listen: omni,2026-10-09,假老师、假百炼,不花钱):
 * listenOmni 对一个本地假接口:请求的形状、拼流、<无> 当没听出字、HTTP 错 / 流里报错 / 超时 / 没有 key 都回 {ok: false};
 * 路由:首页接口给 listen、没开 404、坏的 400、没成 502;发消息带 listened → 索引记着、家长接口给、孩子接口与上下文包不给,形状不对当没带。
 */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-listen-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.DASHSCOPE_API_KEY;

const { listenOmni, readStream, tidy, LISTEN_MODEL } = await import('../src/server/listen.ts');
const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { readIndex, readRunFile } = await import('../src/server/store.ts');

// ---- 假百炼:按请求里的第一个字节决定回什么 ----
const seen: { auth?: string; body: Record<string, any> }[] = [];
const sse = (...parts: unknown[]): string => parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n';
const chunk = (content: string) => ({ choices: [{ delta: { content } }] });
const fake = createServer(async (req: IncomingMessage, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const body = JSON.parse(raw) as Record<string, any>;
  seen.push({ auth: req.headers.authorization, body });
  const audio = Buffer.from(String(body.messages?.[1]?.content?.[0]?.input_audio?.data ?? '').replace(/^data:;base64,/, ''), 'base64').toString();
  if (audio === 'HTTP401') { res.writeHead(401); res.end('{}'); return; }
  if (audio === 'SLOW') { setTimeout(() => { res.writeHead(200); res.end(sse(chunk('晚了'))); }, 500); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (audio === 'SILENT') res.end(sse(chunk('<无>')));
  else if (audio === 'BROKEN') res.end(sse({ error: { message: 'Voice not supported' } }));
  else res.end(sse(chunk('四,'), chunk('four。')));
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${(fake.address() as { port: number }).port}/v1/chat/completions`;
const env = { HOME: home, DASHSCOPE_API_KEY: 'sk-test' };
const hear = (tag: string, ext = 'webm', more: Record<string, unknown> = {}) => listenOmni({ data: Buffer.from(tag), ext }, { env, endpoint, ...more });

try {
  const r1 = await hear('FOUR');
  check('听写:拼起流里的字,回 ok、模型名、毫秒', r1.ok && r1.text === '四,four。' && r1.model === LISTEN_MODEL && r1.ms >= 0, JSON.stringify(r1));
  const b = seen[0]?.body;
  check('请求:key 进请求头、流式、只要文字、系统提示要它只转写并认 <无>、原声 base64 带扩展名当格式', seen[0]?.auth === 'Bearer sk-test' && b?.stream === true && JSON.stringify(b?.modalities) === '["text"]' && String(b?.messages?.[0]?.content).includes('<无>') && b?.messages?.[1]?.content?.[0]?.input_audio?.format === 'webm', JSON.stringify(b).slice(0, 300));
  const r2 = await hear('SILENT', 'm4a');
  check('<无> = 没听出字(空串),还是 ok;m4a 照原样交', r2.ok && r2.text === '' && seen[1]?.body?.messages?.[1]?.content?.[0]?.input_audio?.format === 'm4a', JSON.stringify(r2));
  const r3 = await hear('HTTP401');
  const r4 = await hear('BROKEN');
  const r5 = await hear('SLOW', 'webm', { timeoutMs: 100 });
  const r6 = await listenOmni({ data: Buffer.from('FOUR'), ext: 'webm' }, { env: { HOME: home }, endpoint });
  check('没成都不抛:HTTP 错 / 流里报错 / 超时 / 没有 key', !r3.ok && r3.error === 'http_401' && !r4.ok && r4.error === 'bad_reply' && !r5.ok && r5.error === 'timeout' && !r6.ok && r6.error === 'no_key', JSON.stringify([r3, r4, r5, r6]));
  check('拼流与收拾:引号、只剩标点的当没字', readStream('data: {"choices":[{"delta":{"content":"a"}}]}\ndata: [DONE]') === 'a' && readStream('data: {oops') === null && tidy('「鸡腿。」') === '鸡腿。' && tidy(' 。') === '' && tidy('<无>') === '');

  // ---- 路由与消息(假老师,注入假听写) ----
  const node = process.execPath;
  const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
  const { root } = await initWorkspace({ slug: 'ray', name: 'Ray' });
  const cfgFile = join(root, 'cotutor.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
  cfg.runtimes = { default: 'fake', fake: { run: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '{prompt}'], resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] } };
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  check('kid.listen 缺省 browser', loadWorkspace(root).config.kid.listen === 'browser');
  const now = new Date('2026-10-09T21:00:00');
  let next: { ok: true; text: string; model: string; ms: number } | { ok: false; error: string; ms: number } = { ok: true, text: '鸡腿的英语。', model: LISTEN_MODEL, ms: 600 };
  const heardAudio: string[] = [];
  const ctx = createContext(loadWorkspace(root), { now: () => now, transcribe: async (a) => { heardAudio.push(`${a.ext}:${a.data.toString()}`); return next; } });
  const audio = (tag: string, mime = 'audio/webm;codecs=opus') => `data:${mime};base64,` + Buffer.from(tag).toString('base64');
  const listen = (body: unknown) => route('POST', '/api/kid/listen', ctx, body);
  const off = await listen({ audio: audio('LEG') });
  const homeOff = (await route('GET', '/api/kid/home', ctx)).json as { listen: string };
  check('没开(browser):首页接口给 listen: browser,/api/kid/listen 404,不去问', homeOff.listen === 'browser' && off.status === 404 && heardAudio.length === 0, JSON.stringify([homeOff.listen, off.status]));

  ctx.ws = { ...ctx.ws, config: { ...ctx.ws.config, kid: { ...ctx.ws.config.kid, listen: 'omni' } } };
  const homeOn = (await route('GET', '/api/kid/home', ctx)).json as { listen: string };
  const ok1 = await listen({ audio: audio('LEG', 'audio/mp4') });
  check('开了(omni):首页接口给 listen: omni;原声解码后交去听(mp4 → m4a),回听出的字', homeOn.listen === 'omni' && ok1.status === 200 && (ok1.json as { text: string }).text === '鸡腿的英语。' && heardAudio[0] === 'm4a:LEG', JSON.stringify([homeOn.listen, ok1]));
  const bad = await listen({ audio: 'data:image/png;base64,AAAA' });
  next = { ok: false, error: 'timeout', ms: 8000 };
  const fail = await listen({ audio: audio('LEG') });
  check('不是声音 400;没成 502 带原因(孩子端退回浏览器的字)', bad.status === 400 && fail.status === 502 && (fail.json as { error: string }).error === 'timeout', JSON.stringify([bad.status, fail]));

  const wait = async (): Promise<void> => {
    for (let i = 0; i < 400 && ctx.runner.running('english-tutor'); i++) await new Promise((r) => setTimeout(r, 25));
  };
  const send = (body: unknown) => route('POST', '/api/kid/conversations/english-tutor/messages', ctx, body);
  const listened = { browser: '嗯,腿的英语', omni: '鸡腿的英语。', model: LISTEN_MODEL, ms: 612.4 };
  const s1 = await send({ text: '鸡腿的英语。', voice: { audio: audio('LEG'), seconds: 5.5 }, listened });
  await wait();
  const s2 = await send({ text: '形状不对的', listened: { browser: 42, omni: 'x'.repeat(3000) } });
  await wait();
  const idx = await readIndex(ctx.ws, 'english-tutor', '2026-10-09');
  const m1 = idx.messages.find((x) => x.job === (s1.json as { job: string }).job);
  const m2 = idx.messages.find((x) => x.job === (s2.json as { job: string }).job);
  check('发消息带 listened:索引记两份听法(毫秒取整),字是发来的字', s1.status === 202 && m1?.text === '鸡腿的英语。' && m1.listened?.browser === '嗯,腿的英语' && m1.listened.omni === '鸡腿的英语。' && m1.listened.ms === 612 && m1.listened.model === LISTEN_MODEL, JSON.stringify(m1?.listened));
  check('listened 形状不对:字照发,不记', s2.status === 202 && m2 !== undefined && m2.listened === undefined, JSON.stringify(m2?.listened));
  const run = await readRunFile(ctx.ws, 'english-tutor', '2026-10-09', m1!.job);
  const kid = JSON.stringify((await route('GET', '/api/kid/conversations/english-tutor/today', ctx)).json);
  type PB = { messages: { job: string; listened?: { browser?: string; omni?: string } }[] };
  const pb = (await route('GET', '/api/conversations/english-tutor/today/board', ctx)).json as PB;
  check('老师与孩子看不到浏览器认的那份;家长接口给', run !== null && !JSON.stringify(run).includes('嗯,腿') && !JSON.stringify(run).includes('listened') && !kid.includes('listened') && !kid.includes('嗯,腿') && pb.messages.find((x) => x.job === m1!.job)?.listened?.browser === '嗯,腿的英语', kid.slice(0, 200));
  await ctx.runner.close?.();
} finally {
  fake.close();
}

done();

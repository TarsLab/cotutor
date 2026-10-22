/**
 * 口语课页的接口(《口语课设计.md》),假 omni,不花钱:开关、开一次 + 照片读口语单、改、交给老师(ready)、照片、删、「接着上」;照片 → 口语单的解析。
 * 上课在英语老师的实时页(tests/talk-live.test.ts);这一页不再打电话(《产品规划.md》拍板 30)。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-talk-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.DASHSCOPE_API_KEY;
delete process.env.QWENCLOUD_TOKEN_PLAN_API_KEY;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext } = await import('../src/server/app.ts');
const { makeTalkRoute, parseItems, photoData } = await import('../src/talk/route.ts');
const { parseList, readList } = await import('../src/talk/list.ts');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---- 纯函数 ----
{
  const t = parseList('```json\n{"words":[{"en":"red","zh":"红色"},{"en":" red ","zh":"x"},{"en":"","zh":"空"}],"sentences":[{"en":"It\'s a red car.","zh":"这是一辆红色的车。"}]}\n```');
  check('parseList:去围栏、去重、去空', t?.words.length === 1 && t.words[0].en === 'red' && t.sentences[0].zh === '这是一辆红色的车。', JSON.stringify(t));
  check('parseList:不是 JSON / 形状不对回 null;没有英文两个都空', parseList('看不清') === null && parseList('{"words": 3}') === null && JSON.stringify(parseList('{"words":[],"sentences":[]}')) === '{"words":[],"sentences":[]}');
  const wc = parseList('{"words":[{"en":"apple","zh":"苹果","emoji":"🍎","split":"ap-ple"},{"en":"red","zh":"红色","emoji":"x","split":"r-x"},{"en":"Red car!","zh":"","emoji":"🚗","split":"r-ed"}],"sentences":[{"en":"It is red.","zh":"","emoji":"🔴","split":"it"}]}');
  check('parseList:词带单词卡的 emoji 与分段(过 cards/word 的 parse);不是 emoji、分段拼不回、词写不进四线三格就不要;句子不带', JSON.stringify(wc?.words) === JSON.stringify([{ en: 'apple', zh: '苹果', emoji: '🍎', chunks: ['ap', 'ple'] }, { en: 'red', zh: '红色' }, { en: 'Red car!', zh: '' }]) && JSON.stringify(wc?.sentences) === '[{"en":"It is red.","zh":""}]', JSON.stringify(wc));
  const kept = parseItems([{ en: 'apple', zh: '苹果', emoji: '🍎', chunks: ['ap', 'ple'] }, { en: 'apples', zh: '', emoji: '🍎', chunks: ['ap', 'ple'] }], 12, true);
  check('parseItems(词):家长没改的词留着 emoji 与分段;改了词旧分段拼不回就丢、emoji 留着;句子那组不收', JSON.stringify(kept) === JSON.stringify([{ en: 'apple', zh: '苹果', emoji: '🍎', chunks: ['ap', 'ple'] }, { en: 'apples', zh: '', emoji: '🍎' }]) && JSON.stringify(parseItems([{ en: 'Hi.', zh: '', emoji: '👋' }], 8)) === '[{"en":"Hi.","zh":""}]', JSON.stringify(kept));
  check('parseItems / photoData 守门', parseItems([{ en: ' red ', zh: '红' }, { en: 'RED' }, { en: '' }], 12)?.length === 1 && parseItems('x', 12) === null && parseItems([{ zh: 'x' }], 12) === null && photoData('data:image/png;base64,AAAA')?.mime === 'image/png' && photoData('data:audio/wav;base64,AAAA') === undefined && photoData(3) === undefined);
}

// ---- 假 omni(照片 → 口语单) ----
const omniSeen: Record<string, any>[] = [];
const omni = createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = JSON.parse(raw) as Record<string, any>;
  omniSeen.push(body);
  const img = String(body.messages?.[0]?.content?.[0]?.image_url?.url ?? '');
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const sse = (s: string): string => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\ndata: [DONE]\n\n`;
  if (img.includes('QkFE')) res.end(sse('看不清'));
  else res.end(sse('```json\n{"words":[{"en":"red","zh":"红色"},{"en":"blue","zh":"蓝色"}],"sentences":[{"en":"It\'s a red car.","zh":"这是一辆红色的车。"}]}\n```'));
});
await new Promise<void>((r) => omni.listen(0, '127.0.0.1', r));
const omniEndpoint = `http://127.0.0.1:${(omni.address() as { port: number }).port}/v1/chat/completions`;
{
  const r = await readList({ data: Buffer.from('PNG'), mime: 'image/png' }, { env: { DASHSCOPE_API_KEY: 'sk-t' }, endpoint: omniEndpoint, model: 'm' });
  const b = omniSeen[0];
  check('readList:不想、只要文字、图 + 提示;回口语单', r.ok && r.list.words.length === 2 && b.reasoning_effort === 'none' && b.model === 'm' && b.messages[0].content[1].text.includes('印刷') && b.messages[0].content[0].image_url.url.startsWith('data:image/png;base64,'), JSON.stringify(r));
  const r2 = await readList({ data: Buffer.from('BAD'), mime: 'image/jpeg' }, { env: { DASHSCOPE_API_KEY: 'sk-t' }, endpoint: omniEndpoint });
  const r3 = await readList({ data: Buffer.from('PNG'), mime: 'image/png' }, { env: { HOME: home }, endpoint: omniEndpoint });
  check('readList:回的不是 JSON → bad_json;没 key → no_key', !r2.ok && r2.error === 'bad_json' && !r3.ok && r3.error === 'no_key');
}

// ---- workspace 与接口 ----
const wsRoot = join(home, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
cfg.talk = { enabled: true, minutes: 1 };
cfg.kid.name = 'Ray';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(wsRoot), { warm: false });
const fakeRead = (photo: { data: Buffer; mime: string }, opts: Record<string, unknown>) => readList(photo, { ...opts, endpoint: omniEndpoint });
const talkRoute = makeTalkRoute({ readList: fakeRead as typeof readList, env: { DASHSCOPE_API_KEY: 'sk-t' } });
const call = (method: string, path: string, body?: unknown) => { void ctx.reload(); return talkRoute(method, new URL(path, 'http://x'), ctx, body); };
await ctx.reload();

const png = `data:image/png;base64,${Buffer.from('PNG-bytes').toString('base64')}`;
let id = '';
{
  const g = await call('GET', '/api/talk');
  check('GET /api/talk:开着、还没有', g?.status === 200 && (g.json as any).enabled && (g.json as any).talks.length === 0, JSON.stringify(g?.json));
  const c = await call('POST', '/api/talk', { photo: png });
  const m = c?.json as any;
  id = m.id;
  check('POST:开一次,照片落盘,omni 读出口语单(listBy omni)', c?.status === 201 && /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(id) && m.status === 'draft' && m.photo === 'photo.jpg' && m.listBy === 'omni' && m.list.words.length === 2 && existsSync(join(wsRoot, 'talk', id, 'photo.jpg')), JSON.stringify(m));
  const bad = await call('POST', '/api/talk', { photo: 'data:audio/wav;base64,AAAA' });
  check('POST:不是图 400', bad?.status === 400);
  const e = await call('PUT', `/api/talk/${id}/list`, { words: [{ en: 'red', zh: '红色' }, { en: 'bus', zh: '公共汽车' }], sentences: [{ en: "It's a red car.", zh: '这是一辆红色的车。' }], ready: true });
  const em = e?.json as any;
  check('PUT list:改了 → listBy parent;ready = 交给老师', e?.status === 200 && em.listBy === 'parent' && em.status === 'ready' && em.list.words[1].en === 'bus', JSON.stringify(em));
  const d0 = await call('PUT', `/api/talk/${id}/list`, { words: [{ en: 'red', zh: '红色' }, { en: 'bus', zh: '公共汽车' }], sentences: [{ en: "It's a red car.", zh: '这是一辆红色的车。' }] });
  check('PUT list 不带 ready:回到还在改(draft)', (d0?.json as any).status === 'draft');
  await call('PUT', `/api/talk/${id}/list`, { words: [{ en: 'red', zh: '红色' }, { en: 'bus', zh: '公共汽车' }], sentences: [{ en: "It's a red car.", zh: '这是一辆红色的车。' }], ready: true });
  const ph = await call('GET', `/api/talk/${id}/photo`);
  check('GET photo:文件', ph?.status === 200 && typeof ph.file === 'string' && ph.file.endsWith('photo.jpg'));
  const one = await call('GET', `/api/talk/${id}`);
  check('GET 一次:{meta},没有通话的字和声音', one?.status === 200 && (one.json as any).meta.id === id && !('transcript' in (one.json as any)));
  check('通话的接口都没了:audio、reel、ws 都 404', (await call('GET', `/api/talk/${id}/audio/kid`))?.status === 404 && (await call('GET', `/api/talk/${id}/reel`))?.status === 404 && (await call('GET', `/api/talk/${id}/ws`))?.status === 404);
  check('404:没有的 id、坏的 id', (await call('GET', '/api/talk/2020-01-01-0000'))?.status === 404 && (await call('GET', '/api/talk/x'))?.status === 404);
  check('别的路径不管', (await call('GET', '/api/kid/home')) === null);
}

// ---- 拍照屏的「接着上」:最近那份改好了的口语单 ----
{
  check('from 只认 latest', (await call('POST', '/api/talk', { from: 'x' }))?.status === 400);
  const a = await call('POST', '/api/talk', { from: 'latest' });
  check('接着上:回最近那份改好了的(200,不开新的)', a?.status === 200 && (a.json as any).id === id && (a.json as any).status === 'ready', JSON.stringify(a?.json));
}

// ---- 关着 / 删 ----
{
  cfg.talk.enabled = false;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await sleep(20);
  await ctx.reload();
  const p = await call('POST', '/api/talk', {});
  const g = await call('GET', '/api/talk');
  check('关着:POST 404、GET 说 enabled false', p?.status === 404 && (g?.json as any).enabled === false, JSON.stringify([p?.status]));
  cfg.talk.enabled = true;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await sleep(20);
  const d = await call('DELETE', `/api/talk/${id}`);
  check('删:目录没了,清单少一条', d?.status === 200 && !existsSync(join(wsRoot, 'talk', id)) && (await call('GET', `/api/talk/${id}`))?.status === 404);
}

omni.close();
done();

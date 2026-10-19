/**
 * 口语课整条线(《口语课设计.md》),假百炼、假 omni,不花钱:
 * 接口(开关、开一次 + 照片读口语单、家长改、给孩子、照片、删);
 * 通话中转(孩子端的 WebSocket ↔ 假 realtime):跟读不用按(响了推、静了 commit、读到了下一句、不沾再读、不出声再读两遍后不催、点再听不算次数)、读完开聊(第二条会话,semantic_vad)、聊里孩子开口掐老师、挂断落盘(字、用量、用到的词、两段 wav);
 * 关着时 404、升级被拒;照片 → 口语单的解析。
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { startFakeRealtime } from './_fake-realtime.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-talk-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
delete process.env.DASHSCOPE_API_KEY;
delete process.env.QWENCLOUD_TOKEN_PLAN_API_KEY;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, createHandler } = await import('../src/server/app.ts');
const { makeTalkRoute, makeTalkUpgrade, parseItems, photoData } = await import('../src/talk/route.ts');
const { parseList, readList } = await import('../src/talk/list.ts');
const { appears, usedIn } = await import('../src/talk/lib/used.ts');
const { pcmOfWav, wavOfPcm, rms } = await import('../src/live/lib/wav.ts');
const { readInstructions, chatInstructions, readSummary } = await import('../src/talk/prompt.ts');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 4000): Promise<boolean> => { const t = Date.now() + ms; while (!f() && Date.now() < t) await sleep(10); return f(); };

// ---- 纯函数 ----
{
  const t = parseList('```json\n{"words":[{"en":"red","zh":"红色"},{"en":" red ","zh":"x"},{"en":"","zh":"空"}],"sentences":[{"en":"It\'s a red car.","zh":"这是一辆红色的车。"}]}\n```');
  check('parseList:去围栏、去重、去空', t?.words.length === 1 && t.words[0].en === 'red' && t.sentences[0].zh === '这是一辆红色的车。', JSON.stringify(t));
  check('parseList:不是 JSON / 形状不对回 null;没有英文两个都空', parseList('看不清') === null && parseList('{"words": 3}') === null && JSON.stringify(parseList('{"words":[],"sentences":[]}')) === '{"words":[],"sentences":[]}');
  check('appears:整词找、不分大小写、去标点;句子按子串', appears('red', "It's RED!") && !appears('red', 'bored') && appears("It's a red car.", "yes, it's a red car") && !appears('bus', 'a red car'));
  const used = usedIn({ words: [{ en: 'red', zh: '' }, { en: 'bus', zh: '' }], sentences: [{ en: "It's a red car.", zh: '' }] }, [
    { who: 'tutor', text: 'Read: red', at: 0, phase: 'read', item: 0 }, { who: 'kid', text: 'Red. It is red.', at: 1, phase: 'chat' }, { who: 'tutor', text: "Yes! It's a red car.", at: 2, phase: 'chat' },
  ]);
  check('usedIn:只算聊那段,老师与孩子各计', used.words[0].kid === 1 && used.words[0].tutor === 1 && used.words[1].kid === 0 && used.sentences[0].tutor === 1 && used.sentences[0].kid === 0, JSON.stringify(used));
  const w = wavOfPcm(Buffer.from([0, 0, 0xff, 0x7f]), 16000);
  const back = pcmOfWav(w);
  check('wav 来回;rms', w.length === 48 && back?.rate === 16000 && back.channels === 1 && back.pcm.length === 4 && rms(Buffer.alloc(100)) === 0 && rms(Buffer.from([0xff, 0x7f])) > 0.99, JSON.stringify(back));
  const wc = parseList('{"words":[{"en":"apple","zh":"苹果","emoji":"🍎","split":"ap-ple"},{"en":"red","zh":"红色","emoji":"x","split":"r-x"},{"en":"Red car!","zh":"","emoji":"🚗","split":"r-ed"}],"sentences":[{"en":"It is red.","zh":"","emoji":"🔴","split":"it"}]}');
  check('parseList:词带单词卡的 emoji 与分段(过 cards/word 的 parse);不是 emoji、分段拼不回、词写不进四线三格就不要;句子不带', JSON.stringify(wc?.words) === JSON.stringify([{ en: 'apple', zh: '苹果', emoji: '🍎', chunks: ['ap', 'ple'] }, { en: 'red', zh: '红色' }, { en: 'Red car!', zh: '' }]) && JSON.stringify(wc?.sentences) === '[{"en":"It is red.","zh":""}]', JSON.stringify(wc));
  const kept = parseItems([{ en: 'apple', zh: '苹果', emoji: '🍎', chunks: ['ap', 'ple'] }, { en: 'apples', zh: '', emoji: '🍎', chunks: ['ap', 'ple'] }], 12, true);
  check('parseItems(词):家长没改的词留着 emoji 与分段;改了词旧分段拼不回就丢、emoji 留着;句子那组不收', JSON.stringify(kept) === JSON.stringify([{ en: 'apple', zh: '苹果', emoji: '🍎', chunks: ['ap', 'ple'] }, { en: 'apples', zh: '', emoji: '🍎' }]) && JSON.stringify(parseItems([{ en: 'Hi.', zh: '', emoji: '👋' }], 8)) === '[{"en":"Hi.","zh":""}]', JSON.stringify(kept));
  check('parseItems / photoData 守门', parseItems([{ en: ' red ', zh: '红' }, { en: 'RED' }, { en: '' }], 12)?.length === 1 && parseItems('x', 12) === null && parseItems([{ zh: 'x' }], 12) === null && photoData('data:image/png;base64,AAAA')?.mime === 'image/png' && photoData('data:audio/wav;base64,AAAA') === undefined && photoData(3) === undefined);
  const list = { words: [{ en: 'red', zh: '红色' }], sentences: [{ en: "It's a red car.", zh: '这是一辆红色的车。' }] };
  const ri = readInstructions(list, 'Ray');
  const ci = chatInstructions(list, 'Ray', 5, readSummary(list, 2, ['red', "it's a red car"]));
  const nr = readInstructions(list, 'Ray', '这周学颜色。多问他喜欢什么颜色');
  const nc = chatInstructions(list, 'Ray', 5, '', '这周学颜色。多问他喜欢什么颜色');
  check('提示词:家长的话(talk.note)两条会话都带,没写就没有这段', nr.includes('家长交代的') && nr.includes('多问他喜欢什么颜色') && nc.includes('多问他喜欢什么颜色') && !ri.includes('家长交代的') && !readInstructions(list, 'Ray', '  ').includes('家长交代的'));
  check('提示词:人设 + 口语单 + 规矩;聊的带跟读情况', ri.includes('Ray') && ri.includes('red(红色)') && ri.includes('不打分') && ri.includes('跟读') && ci.includes('5 分钟') && ci.includes('他跟读了 2 句') && ci.includes('「red」'), ci.slice(-200));
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
const fake = await startFakeRealtime();
const wsRoot = join(home, 'ws');
await initWorkspace({ slug: 'ray', name: 'Ray', dir: wsRoot });
const cfgFile = join(wsRoot, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, any>;
cfg.talk = { enabled: true, minutes: 1, read: { waitMs: 1000, again: 2, endMs: 300 } };
cfg.kid.name = 'Ray';
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
const ctx = createContext(loadWorkspace(wsRoot), { warm: false });
const fakeRead = (photo: { data: Buffer; mime: string }, opts: Record<string, unknown>) => readList(photo, { ...opts, endpoint: omniEndpoint });
const finished: [string, string][] = [];
/** 提示卡(《口语课设计.md》拍板 16):假的,记下老师说完的每一句 */
const hintSeen: string[] = [];
const fakeHint = async (line: string): Promise<{ hint: { zh: string; en: string; opts: string[] }; by: 'model' }> => { hintSeen.push(line); return { hint: { zh: '说一说:它是什么颜色的?', en: "It's ___.", opts: ['red'] }, by: 'model' }; };
const deps = { readList: fakeRead as typeof readList, endpoint: fake.endpoint, env: { DASHSCOPE_API_KEY: 'sk-t' }, onFinished: (id: string, why: string) => finished.push([id, why]), hint: fakeHint };
const talkRoute = makeTalkRoute(deps);
const talkUpgrade = makeTalkUpgrade(deps);
const call = (method: string, path: string, body?: unknown) => { void ctx.reload(); return talkRoute(method, new URL(path, 'http://x'), ctx, body); };
await ctx.reload();

const png = `data:image/png;base64,${Buffer.from('PNG-bytes').toString('base64')}`;
let id = '';
{
  const g = await call('GET', '/api/talk');
  check('GET /api/talk:开着、有 key(端点给了)、名字、还没有', g?.status === 200 && (g.json as any).enabled && (g.json as any).auth && (g.json as any).kid === 'Ray' && (g.json as any).talks.length === 0, JSON.stringify(g?.json));
  const c = await call('POST', '/api/talk', { photo: png });
  const m = c?.json as any;
  id = m.id;
  check('POST:开一次,照片落盘,omni 读出口语单(listBy omni)', c?.status === 201 && /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(id) && m.status === 'draft' && m.photo === 'photo.jpg' && m.listBy === 'omni' && m.list.words.length === 2 && existsSync(join(wsRoot, 'talk', id, 'photo.jpg')), JSON.stringify(m));
  const bad = await call('POST', '/api/talk', { photo: 'data:audio/wav;base64,AAAA' });
  check('POST:不是图 400', bad?.status === 400);
  const e = await call('PUT', `/api/talk/${id}/list`, { words: [{ en: 'red', zh: '红色' }, { en: 'bus', zh: '公共汽车' }], sentences: [{ en: "It's a red car.", zh: '这是一辆红色的车。' }], ready: true });
  const em = e?.json as any;
  check('PUT list:家长改了 → listBy parent、ready', e?.status === 200 && em.listBy === 'parent' && em.status === 'ready' && em.list.words[1].en === 'bus', JSON.stringify(em));
  const ph = await call('GET', `/api/talk/${id}/photo`);
  check('GET photo:文件', ph?.status === 200 && typeof ph.file === 'string' && ph.file.endsWith('photo.jpg'));
  const one = await call('GET', `/api/talk/${id}`);
  check('GET 一次:口语单、还没聊', one?.status === 200 && (one.json as any).transcript === null && (one.json as any).hasKidAudio === false);
  check('404:没有的 id、坏的 id', (await call('GET', '/api/talk/2020-01-01-0000'))?.status === 404 && (await call('GET', '/api/talk/x'))?.status === 404);
  check('别的路径不管', (await call('GET', '/api/kid/home')) === null);
}

// ---- 通话:真 http 服务 + 升级 ----
const server = createServer(createHandler(ctx));
server.on('upgrade', (req, socket, head) => { void talkUpgrade(req, socket, head, ctx).then((took) => { if (!took) socket.destroy(); }); });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

type Msg = Record<string, any>;
async function connectKid(talkId: string): Promise<{ ws: WebSocket; msgs: Msg[]; bins: number[]; closed: { code: number; reason: string } | null; refused: boolean; wait(f: () => boolean, ms?: number): Promise<boolean> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/talk/${talkId}/ws`);
  ws.binaryType = 'arraybuffer';
  const k = { ws, msgs: [] as Msg[], bins: [] as number[], closed: null as { code: number; reason: string } | null, refused: false, wait: (f: () => boolean, ms = 4000) => until(f, ms) };
  ws.onmessage = (e) => { if (typeof e.data === 'string') k.msgs.push(JSON.parse(e.data)); else k.bins.push((e.data as ArrayBuffer).byteLength); };
  ws.onclose = (e) => { k.closed = { code: e.code, reason: e.reason }; };
  // 握手被拒(非 101):Node 的客户端只发 error、不发 close,readyState 停在 CONNECTING
  await new Promise<void>((resolve) => { ws.onopen = () => resolve(); ws.onerror = () => { k.refused = true; resolve(); }; });
  return k;
}
const loud = (): Uint8Array => new Uint8Array(3200).fill(9);
const quiet = (): Uint8Array => new Uint8Array(3200);
const last = (k: { msgs: Msg[] }, t: string): Msg | undefined => [...k.msgs].reverse().find((m) => m.t === t);

{
  const k = await connectKid(id);
  const ok1 = await k.wait(() => k.msgs.some((m) => m.t === 'state' && m.item) && k.msgs.some((m) => m.t === 'tutor' && m.done !== undefined) && k.bins.length >= 1);
  const st = k.msgs.find((m) => m.t === 'state' && m.item)!;
  const c1 = fake.conns[0];
  k.ws.send(JSON.stringify({ t: 'view', w: 1180, h: 820 }));
  check('接通:跟读的会话(手动、人设带 Ray 与口语单)、第一句 cue、状态(第 1/3 句)、老师的声音与字到孩子端', ok1 && c1.session?.turn_detection === null && String(c1.session?.instructions).includes('Ray') && String(c1.session?.instructions).includes('bus(公共汽车)') && c1.items[0]?.content?.[0]?.text === '读这个词:red(中文意思:红色)' && st.phase === 'read' && st.i === 0 && st.n === 3 && st.item.en === 'red' && st.interrupt === false && k.bins[0] === 4800 && last(k, 'tutor')?.done === "It's a red car.", JSON.stringify({ st, items: c1.items, bins: k.bins }).slice(0, 400));
  // ---- 跟我读不用按(《口语课设计.md》§8.1;数是 cfg.talk.read:等 1 秒、再读 2 遍、静 300 毫秒算读完) ----
  const rdMode = (): string | undefined => last(k, 'state')?.rd?.mode;
  /** 孩子读一遍:响三块(300 毫秒)、静三块(300 毫秒) */
  const speak = (text: string): void => { fake.kidText = text; for (let i = 0; i < 3; i++) k.ws.send(loud()); for (let i = 0; i < 3; i++) k.ws.send(quiet()); };
  const cues = (): string[] => c1.items.map((it) => String(it.content[0].text));
  const okL = await k.wait(() => rdMode() === 'listen');
  const stL = last(k, 'state')!;
  check('老师的声音放完 → 等孩子(rd listen,倒计时不到 1 秒、一共 1 秒),这时什么都没推给模型', okL && stL.rd.left > 0 && stL.rd.left <= 1000 && stL.rd.wait === 1000 && c1.commits === 0 && c1.audio === 0, JSON.stringify(stL.rd));
  speak('hello');
  const okA = await until(() => cues().includes('再读一遍这个词:red(中文意思:红色)'));
  check('不用按:响了推给模型(带前垫)、静了 commit 拿转写;读的不沾这句 → 老师再读一遍', okA && c1.commits === 1 && c1.audio === 6 * 3200 && last(k, 'kid')?.text === 'hello' && c1.creates === 2, JSON.stringify({ audio: c1.audio, commits: c1.commits, creates: c1.creates }));
  await k.wait(() => rdMode() === 'listen');
  speak('Red!');
  const okN = await k.wait(() => k.msgs.some((m) => m.t === 'state' && m.i === 1 && m.item?.en === 'bus') && cues().includes('孩子读了「Red!」。先用一两个词接,再读下一个,这个词:bus(中文意思:公共汽车)'));
  check('读到了 → 下一句(接一两个词 + 下一句,一次回答)', okN && c1.commits === 2, JSON.stringify(cues()));
  const t0 = Date.now();
  const okW = await k.wait(() => rdMode() === 'wait', 6000);
  const agains = cues().filter((t) => t === '再读一遍这个词:bus(中文意思:公共汽车)').length;
  check('不出声:等 1 秒老师再读,两遍后不再催(wait,没有倒计时)', okW && agains === 2 && last(k, 'state')!.rd.left === null && Date.now() - t0 >= 2000, JSON.stringify({ agains, ms: Date.now() - t0 }));
  speak('banana');
  const okM = await k.wait(() => k.msgs.some((m) => m.t === 'state' && m.i === 2));
  check('等着时开口、还不沾 → 自动再读用完了,往下走,不卡在一句上', okM && cues().some((t) => t.startsWith('孩子读了「banana」') && t.endsWith("It's a red car.")), JSON.stringify(cues().slice(-2)));
  await k.wait(() => rdMode() === 'listen');
  k.ws.send(JSON.stringify({ t: 'again' }));
  const ok4 = await until(() => cues().includes("再读一遍这句:It's a red car."));
  const ok5 = await k.wait(() => cues().includes("再读一遍这句:It's a red car.") && rdMode() === 'listen');
  check('点「再听一遍」→ 再读,不算自动的次数', ok4 && ok5 && last(k, 'state')!.rd.again === 0);
  speak("It's a red car.");
  // 最后一句读完 → 夸一句、说要聊了 → 放完开聊
  const ok6 = await k.wait(() => fake.conns.length === 2 && k.msgs.some((m) => m.t === 'state' && m.phase === 'chat' && m.deadline !== null) && fake.conns[1].creates >= 1);
  const c2 = fake.conns[1];
  check('最后一句读完 → 老师夸一句说要聊了、放完 → 跟读会话关了、聊的会话开了(semantic_vad 1200,人设带跟读情况)、开聊的 cue、状态带截止', ok6 && cues().includes("孩子读了「It's a red car.」。跟读完了:用一句英文夸他,再说 Now let's talk!") && c1.closed && c2.session?.turn_detection?.type === 'semantic_vad' && c2.session?.turn_detection?.silence_duration_ms === 1200 && String(c2.session?.instructions).includes('他跟读了 3 句') && String(c2.session?.instructions).includes('1 分钟') && c2.items[0]?.content?.[0]?.text.startsWith('开聊'), JSON.stringify({ closed: c1.closed, td: c2.session?.turn_detection, items: c2.items }).slice(0, 300));
  // 聊:老师讲长的,孩子开口 → 掐、flush;停了 → 转写、老师接
  fake.long = true;
  k.ws.send(JSON.stringify({ t: 'chat' })); // 已经在聊,不理
  const nFlush = k.msgs.filter((m) => m.t === 'flush').length;
  fake.kidText = 'Red!';
  k.ws.send(loud());
  const ok7 = await k.wait(() => c2.cancels === 0 || k.msgs.filter((m) => m.t === 'flush').length > nFlush);
  fake.long = false;
  k.ws.send(quiet());
  const ok8 = await k.wait(() => k.msgs.some((m) => m.t === 'kid' && m.text === 'Red!') && c2.creates >= 2);
  check('聊:孩子开口 → 孩子端 flush;停了 → 转写回来、老师自动接', ok7 && ok8 && k.msgs.filter((m) => m.t === 'flush').length > nFlush, JSON.stringify({ cancels: c2.cancels, creates: c2.creates, flush: k.msgs.filter((m) => m.t === 'flush').length - nFlush }));
  const cards = k.msgs.filter((m) => m.t === 'card');
  check('聊:老师的字里出现口语单上的词 → {t:card, i}(red 亮;bus 没说不亮;一次回答一个词只亮一次)', cards.some((m) => m.i === 0) && !cards.some((m) => m.i === 1) && cards.length <= c2.creates, JSON.stringify(cards));
  // 提示卡:聊那段老师每说完一句发一张;跟读那段不出;孩子端的出来 / 翻面记进录像
  const okH = await k.wait(() => k.msgs.some((m) => m.t === 'hint'));
  const hints = k.msgs.filter((m) => m.t === 'hint');
  const chatAt = k.msgs.findIndex((m) => m.t === 'state' && m.phase === 'chat');
  check('聊:老师说完一句 → 提示卡 {t:hint, n, zh, en, opts, by}(只在聊那段)', okH && hints.every((m) => k.msgs.indexOf(m) > chatAt && typeof m.n === 'number' && m.zh && m.en === "It's ___." && m.opts[0] === 'red' && m.by === 'model') && hintSeen.length >= hints.length, JSON.stringify({ hints: hints.length, seen: hintSeen }));
  k.ws.send(JSON.stringify({ t: 'hint', e: 'show', n: hints[0].n, why: 'auto', zh: hints[0].zh, en: hints[0].en }));
  k.ws.send(JSON.stringify({ t: 'hint', e: 'flip', v: true, n: hints[0].n, zh: hints[0].zh, en: hints[0].en }));
  await sleep(50);
  // 挂断 → 落盘
  k.ws.send(JSON.stringify({ t: 'bye' }));
  const ok9 = await until(() => finished.length === 1, 5000);
  const dir = join(wsRoot, 'talk', id);
  const tr = JSON.parse(readFileSync(join(dir, 'transcript.json'), 'utf8')) as Record<string, any>;
  const meta = JSON.parse(readFileSync(join(dir, 'talk.json'), 'utf8')) as Record<string, any>;
  const kidWav = pcmOfWav(readFileSync(join(dir, 'kid.wav')));
  const tutorWav = pcmOfWav(readFileSync(join(dir, 'tutor.wav')));
  check('挂断:end 到孩子端、落盘(why bye、字分两段、孩子的话带 item、用量加总、用到的词、两段 wav)', ok9 && finished[0][1] === 'bye' && last(k, 'end')?.why === 'bye' && tr.why === 'bye' && tr.lines.some((l: any) => l.who === 'kid' && l.phase === 'read' && l.item === 0) && tr.lines.some((l: any) => l.who === 'kid' && l.phase === 'chat' && l.text === 'Red!') && tr.usage.input > 865 && tr.used.words[0].kid === 1 && meta.status === 'done' && meta.call.read === 3 && meta.call.items === 3 && kidWav?.rate === 16000 && kidWav.pcm.length === 4 * 6 * 3200 + 6400 && tutorWav?.rate === 24000 && tutorWav.pcm.length % 4800 === 0 && c2.closed, JSON.stringify({ why: tr.why, lines: tr.lines.length, usage: tr.usage, used: tr.used.words, kid: kidWav?.pcm.length, tutor: tutorWav?.pcm.length }));
  const reel = JSON.parse(readFileSync(join(dir, 'reel.json'), 'utf8')) as Record<string, any>;
  const callWav = pcmOfWav(readFileSync(join(dir, 'call.wav')));
  const has = (dir_: string, t: string): boolean => reel.msgs.some((m: any) => m[1] === dir_ && m[2].t === t);
  check('录像:提示卡发出去的(o)与孩子端的出来、翻面(i)都记了', has('o', 'hint') && reel.msgs.filter((m: any) => m[1] === 'i' && m[2].t === 'hint').length === 2);
  check('录像的数据:reel.json 记了发出去的每条(state、老师的字、亮卡、end)与孩子端发来的(again、bye),时刻不倒退;屏幕多大;call.wav 24k、和通话一样长;老师出声的时段', reel.v === 1 && reel.ms === tr.ms && has('o', 'state') && has('o', 'tutor') && has('o', 'card') && has('o', 'end') && has('i', 'again') && has('i', 'bye') && reel.msgs.every((m: any, i: number) => i === 0 || m[0] >= reel.msgs[i - 1][0]) && JSON.stringify(reel.view) === '[1180,820]' && callWav?.rate === 24000 && Math.abs(callWav.pcm.length / 48 - reel.ms) <= 1 && reel.playing.length > 0 && reel.playing.every((p: number[]) => p[1] > p[0]), JSON.stringify({ n: reel.msgs.length, ms: reel.ms, view: reel.view, wav: callWav?.pcm.length, playing: reel.playing.slice(0, 3) }));
  const ok10 = await until(() => k.closed !== null);
  check('孩子端的连接关了(1000 bye)', ok10 && k.closed?.code === 1000, JSON.stringify(k.closed));
  const one = await call('GET', `/api/talk/${id}`);
  const au = await call('GET', `/api/talk/${id}/audio/kid`);
  check('GET 一次:done、有字、有声;audio/kid 是文件', (one?.json as any).meta.status === 'done' && (one?.json as any).transcript.lines.length === tr.lines.length && (one?.json as any).hasKidAudio && au?.status === 200 && String(au.file).endsWith('kid.wav'));
  const g = await call('GET', '/api/talk');
  check('清单里一条,done', (g?.json as any).talks.length === 1 && (g?.json as any).talks[0].status === 'done');
}

// ---- 孩子端自己断、口语单空的直接聊、连不上 ----
{
  const c = await call('POST', '/api/talk', {});
  const id2 = (c?.json as any).id;
  await call('PUT', `/api/talk/${id2}/list`, { words: [], sentences: [{ en: 'Hello!', zh: '你好' }], ready: true });
  const k = await connectKid(id2);
  await k.wait(() => k.msgs.some((m) => m.t === 'state' && m.item));
  k.ws.close();
  const ok = await until(() => finished.length === 2, 5000);
  check('孩子端断了:记 kid-gone,照样落盘', ok && finished[1][1] === 'kid-gone' && existsSync(join(wsRoot, 'talk', id2, 'transcript.json')), JSON.stringify(finished));
  const e = await call('POST', '/api/talk', {});
  const id3 = (e?.json as any).id;
  const k3 = await connectKid(id3);
  const ok3 = await k3.wait(() => k3.msgs.some((m) => m.t === 'state' && m.phase === 'chat'));
  check('口语单空的:直接开聊', ok3 && fake.conns.at(-1)?.session?.turn_detection?.type === 'semantic_vad');
  k3.ws.send(JSON.stringify({ t: 'bye' }));
  await until(() => finished.length === 3, 5000);
  fake.failUpdate = true;
  const k4 = await connectKid(id3);
  const ok4 = await k4.wait(() => k4.msgs.some((m) => m.t === 'err') && k4.msgs.some((m) => m.t === 'end'), 5000);
  fake.failUpdate = false;
  check('连不上 realtime:err + end,不挂着', ok4 && last(k4, 'end')?.why.startsWith('connect:'), JSON.stringify(k4.msgs));
  await until(() => finished.length === 4, 5000);
}

// ---- 首页的「口语课」:最近那份口语单,没聊过就用它,聊过了照它再开一次 ----
{
  check('from 只认 latest', (await call('POST', '/api/talk', { from: 'x' }))?.status === 400);
  const a = await call('POST', '/api/talk', { from: 'latest' });
  const am = a?.json as any;
  check('最近有内容的那份聊过了:照它再开一次(201,ready,口语单一样,记 from)', a?.status === 201 && am.status === 'ready' && am.from && am.list.sentences[0]?.en === 'Hello!' && am.photo === null, JSON.stringify(am));
  const b = await call('POST', '/api/talk', { from: 'latest' });
  check('还没聊过的那份:直接回它,不再开新的', b?.status === 200 && (b.json as any).id === am.id);
  await call('DELETE', `/api/talk/${am.id}`);
}

// ---- 关着 / 删 ----
{
  cfg.talk.enabled = false;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await sleep(20);
  await ctx.reload();
  const p = await call('POST', '/api/talk', {});
  const g = await call('GET', '/api/talk');
  const k = await connectKid(id);
  check('关着:POST 404、GET 说 enabled false、升级被拒', p?.status === 404 && (g?.json as any).enabled === false && k.refused && k.ws.readyState !== WebSocket.OPEN, JSON.stringify([p?.status, k.refused, k.ws.readyState]));
  cfg.talk.enabled = true;
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  await sleep(20);
  const d = await call('DELETE', `/api/talk/${id}`);
  check('删:目录没了,清单少一条', d?.status === 200 && !existsSync(join(wsRoot, 'talk', id)) && (await call('GET', `/api/talk/${id}`))?.status === 404);
}

server.close();
omni.close();
fake.close();
done();

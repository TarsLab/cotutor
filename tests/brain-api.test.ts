/**
 * API 运行时全流程(假百炼,不花钱):cotutor.json 里写 {api: 'bailian', model},走它的老师不起 CLI——
 * 流式板书与卡、记忆段落盘、同一话题接着聊带上前文、照片直接附成图、只读工具来回(出界的读不到)、思考档、
 * 拼回去的历史是瘦过的(结束的轮不带思考、工具往返成一句话、照片只附最近那组)、缓存命中与上下文大小记下,
 * 用量缺了不记零、断流停住且下一轮注明、401 收尾、没配百炼的提醒;key 不落盘;家长端的转录照旧读得出。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';
import { startFakeChat, type ChatBody } from './_fake-bailian-chat.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-brain-api-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, dayView } = await import('../src/server/app.ts');
const { bailianBase, thinkingOf } = await import('../src/brain/api.ts');
const { localDate } = await import('../src/lib/conversation.ts');

const fake = await startFakeChat();
const SECRET = 'sk-test-secret-never-log';
const NOW = new Date('2026-10-29T10:00:00');
const date = localDate(NOW);
const textOf = (c: unknown): string => (typeof c === 'string' ? c : JSON.stringify(c));

try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const cfgFile = join(root, 'cotutor.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as { runtimes: Record<string, unknown>; tutors: Record<string, Record<string, unknown>> };
  cfg.runtimes.api = { api: 'bailian', model: 'qwen-test' };
  cfg.tutors['math-tutor'].runtime = 'api';
  cfg.tutors['chinese-tutor'].runtime = 'api';
  cfg.tutors['chinese-tutor'].policy = { tools: 'on' };
  cfg.tutors['english-tutor'].runtime = 'api';
  cfg.tutors['english-tutor'].policy = { stall: { ms: 400 } };
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  mkdirSync(join(root, '教材'), { recursive: true });
  const book = join(root, '教材', '三角形.md');
  writeFileSync(book, '三角形有三条边、三个角。\n只在书里的一行 ZQX\n');
  mkdirSync(join(root, 'captures'), { recursive: true });
  writeFileSync(join(root, 'captures', 'dot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5G8AAAAASUVORK5CYII=', 'base64'));

  const env = { ...process.env, HOME: home, DASHSCOPE_API_KEY: SECRET, DASHSCOPE_WORKSPACE_ID: 'ws-test', COTUTOR_BRAIN_ENDPOINT: fake.baseURL };
  const ctx = createContext(loadWorkspace(root), { env, warm: false, now: () => NOW });
  const send = async (tutor: string, input: Parameters<typeof ctx.runner.send>[1]) => {
    const started = await ctx.runner.send(tutor, input);
    const index = await started.done;
    return { started, index, m: index.messages.find((x) => x.job === started.job)! };
  };
  const conv = (tutor: string) => join(ctx.ws.dirs.conversations, tutor);
  const since = (n: number): ChatBody[] => fake.requests.slice(n);

  // ---- 一轮:流式板书、卡、记忆;不起 CLI ----
  let n = fake.requests.length;
  const t1 = await send('math-tutor', { from: 'kid', text: 'ZBOARD ZMEM 三角形' });
  const r1 = since(n);
  check('API 一轮:成了,两张卡,讲稿在', t1.m.result === 'ok' && t1.m.section?.cards.length === 2 && (t1.m.section?.lines.length ?? 0) >= 2, JSON.stringify({ result: t1.m.result, warnings: t1.m.warnings, section: t1.m.section }));
  check('API 一轮:记忆段照样落进 vault', (t1.m.remembered ?? []).some((x) => x.includes('手指比划')), JSON.stringify(t1.m.remembered));
  check('API 一轮:用量记上(假百炼回的 100 / 20)', t1.m.tokens?.in === 100 && t1.m.tokens?.out === 20, JSON.stringify(t1.m.tokens));
  check('API 一轮:命中缓存的与上下文大小记下(只有 API 报)', t1.m.tokens?.cached === 60 && t1.m.tokens?.context === 100, JSON.stringify(t1.m.tokens));
  check('API 一轮:运行时与会话记下', t1.m.runtime === 'api' && t1.index.sessions[t1.started.thread]?.runtime === 'api' && /^api-/.test(t1.index.sessions[t1.started.thread]?.id ?? ''), JSON.stringify(t1.index.sessions));
  check('API 一轮:一次请求,流式,系统提示是老师正文 + 板书写法', r1.length === 1 && r1[0].stream === true && r1[0].messages[0]?.role === 'system' && textOf(r1[0].messages[0].content).includes('```choice'), JSON.stringify(r1.map((r) => r.messages.map((m) => m.role))));
  check('API 一轮:孩子的话不带工具;数学老师 medium 想一点', r1[0].tools === undefined && r1[0].enable_thinking === true && r1[0].thinking_budget === 1024 && r1[0].preserve_thinking === true, JSON.stringify({ tools: r1[0].tools, enable: r1[0].enable_thinking, budget: r1[0].thinking_budget }));
  const log1 = readFileSync(join(conv('math-tutor'), `${date}.${t1.started.job}.log`), 'utf8');
  check('API 一轮:.log 是一行一条统一事件', log1.split('\n')[0].startsWith('{"kind":"session"') && log1.includes('{"kind":"result"'), log1.slice(0, 200));
  const hist1 = readFileSync(join(conv('math-tutor'), `${date}.${t1.started.thread}.brain.jsonl`), 'utf8').trim().split('\n');
  check('API 一轮:模型历史记一行(会话、模型、成了)', hist1.length === 1 && JSON.parse(hist1[0]).ok === true && JSON.parse(hist1[0]).model === 'qwen-test' && JSON.parse(hist1[0]).session === t1.index.sessions[t1.started.thread]?.id);
  const view = await dayView(ctx, 'math-tutor', date);
  check('API 一轮:家长端的转录照旧读得出', (view.runs[t1.started.job] ?? []).length > 0, JSON.stringify(view.runs[t1.started.job]));
  const run1 = JSON.parse(readFileSync(join(conv('math-tutor'), `${date}.${t1.started.job}.run.json`), 'utf8')) as { argv: string[]; runtime: string; resume: boolean };
  check('API 一轮:run 文件记运行时,没有命令行', run1.runtime === 'api' && run1.argv.length === 0 && run1.resume === false);

  // ---- 同一话题接着聊:前文带上 ----
  n = fake.requests.length;
  const t2 = await send('math-tutor', { from: 'kid', text: '接着说' });
  const r2 = since(n)[0];
  const roles2 = r2?.messages.map((m) => m.role).join(',');
  check('接着聊:同一话题、resume', t2.started.thread === t1.started.thread && t2.m.result === 'ok' && JSON.parse(readFileSync(join(conv('math-tutor'), `${date}.${t2.started.job}.run.json`), 'utf8')).resume === true);
  check('接着聊:前一轮的用户消息与老师的回复都在', roles2 === 'system,user,assistant,user' && textOf(r2.messages[1].content).includes('ZBOARD') && textOf(r2.messages[2].content).includes('三角形有几个角'), roles2);
  check('接着聊:假百炼看到了前文(先说「接着刚才的」)', (t2.m.kidText ?? '').includes('接着刚才的'), t2.m.kidText ?? '');

  // ---- 照片:直接附成图;带照片的轮带只读工具 ----
  n = fake.requests.length;
  const t3 = await send('math-tutor', { from: 'kid', text: 'ZPHOTO 看看这道题', photos: ['captures/dot.png'], newThread: true });
  const r3 = since(n)[0];
  const user3 = r3?.messages.at(-1);
  check('照片:用户消息里是图(data URI),不只是路径', t3.m.result === 'ok' && JSON.stringify(user3?.content).includes('data:image/png;base64,'), JSON.stringify(user3?.content).slice(0, 300));
  check('照片:这轮带只读的三样工具', JSON.stringify(r3?.tools?.map((t) => t.function.name)) === JSON.stringify(['read_file', 'glob', 'grep_search']), JSON.stringify(r3?.tools));
  const hist3 = JSON.parse(readFileSync(join(conv('math-tutor'), `${date}.${t3.started.thread}.brain.jsonl`), 'utf8').trim()) as { user: { images: string[] } };
  const images = (b: ChatBody | undefined): number => JSON.stringify(b?.messages ?? []).split('data:image/png;base64,').length - 1;
  writeFileSync(join(root, 'captures', 'dot2.png'), readFileSync(join(root, 'captures', 'dot.png')));
  n = fake.requests.length;
  await send('math-tutor', { from: 'kid', text: '再看看', thread: t3.started.thread });
  const r3b = since(n)[0];
  check('照片接着聊:最近交的那张照样附着(看图说话一张图聊十几轮)', images(r3b) === 1, String(images(r3b)));
  n = fake.requests.length;
  await send('math-tutor', { from: 'kid', text: '这是第二张', photos: ['captures/dot2.png'], thread: t3.started.thread });
  const r3c = since(n)[0];
  check('交了新照片:只附新的,前面那张换成一句占位', images(r3c) === 1 && JSON.stringify(r3c.messages).includes('(照片 captures/dot.png:前面交过,这里不再附图)'), JSON.stringify(r3c.messages.map((m) => [m.role, textOf(m.content).slice(0, 80)])));
  n = fake.requests.length;
  await send('math-tutor', { from: 'kid', text: '好了', thread: t3.started.thread });
  const r3d = since(n)[0];
  check('再接着聊:附的是第二张,第一张还是占位', images(r3d) === 1 && JSON.stringify(r3d.messages).includes('captures/dot.png:前面交过') && !JSON.stringify(r3d.messages).includes('captures/dot2.png:前面交过'));
  check('照片:历史只记相对 workspace 的路径,不存整张图', JSON.stringify(hist3.user.images) === JSON.stringify(['captures/dot.png']) && !readFileSync(join(conv('math-tutor'), `${date}.${t3.started.thread}.brain.jsonl`), 'utf8').includes('base64'));

  // ---- 只读工具:读教材来回一次;出界的读不到 ----
  n = fake.requests.length;
  const t4 = await send('chinese-tutor', { from: 'kid', text: `ZTOOL ${book}` });
  const r4 = since(n);
  check('工具:两次请求,第二次带着工具结果', r4.length === 2 && r4[1].messages.at(-1)?.role === 'tool' && textOf(r4[1].messages.at(-1)?.content).includes('ZQX'), JSON.stringify(r4.map((r) => r.messages.at(-1)?.role)));
  check('工具:回的是读到的内容', t4.m.result === 'ok' && (t4.m.kidText ?? '').includes('三角形有三条边'), JSON.stringify({ kidText: t4.m.kidText, warnings: t4.m.warnings }));
  check('工具:索引记下这轮读了哪个文件', t4.m.tools?.[0]?.name === 'read_file' && t4.m.tools[0].arg === book && t4.m.tools[0].ok === true, JSON.stringify(t4.m.tools));
  check('工具:上一步的思考原样带回(preserve_thinking)', r4[1].messages.some((m) => m.role === 'assistant' && m.reasoning_content === '先查一下书。'), JSON.stringify(r4[1].messages.filter((m) => m.role === 'assistant')));
  check('工具:一轮里的用量按两次请求累计,上下文是最后那次的', t4.m.tokens?.in === 200 && t4.m.tokens?.cached === 120 && t4.m.tokens?.context === 100, JSON.stringify(t4.m.tokens));
  n = fake.requests.length;
  await send('chinese-tutor', { from: 'kid', text: '我懂了', thread: t4.started.thread });
  const r4b = since(n)[0];
  const flat4 = JSON.stringify(r4b?.messages ?? []);
  check('工具那轮结束后:下一轮的历史里没有工具消息、没有思考', !r4b.messages.some((m) => m.role === 'tool' || m.tool_calls || m.reasoning_content), JSON.stringify(r4b.messages.map((m) => [m.role, Boolean(m.tool_calls), Boolean(m.reasoning_content)])));
  check('工具那轮结束后:工具往返换成一句话,读到的全文不再带', flat4.includes('(用了 read_file') && flat4.includes('结果这里不再带') && !flat4.includes('ZQX'), flat4.slice(0, 400));
  const t5 = await send('chinese-tutor', { from: 'kid', text: 'ZTOOL /etc/hosts', newThread: true });
  check('工具:workspace 与 vault 外面的读不到(工具报错,这轮照样收尾)', t5.m.result === 'ok' && t5.m.tools?.[0]?.ok === false && (t5.m.kidText ?? '').includes('书没读到'), JSON.stringify({ tools: t5.m.tools, kidText: t5.m.kidText }));

  // ---- 用量没回:不记零 ----
  const t6 = await send('math-tutor', { from: 'kid', text: 'ZNOUSAGE 你好', newThread: true });
  check('没回 usage:这轮成了,不记 token,提醒一句', t6.m.result === 'ok' && t6.m.tokens === undefined && (t6.m.warnings ?? []).some((w) => w.includes('用量没回全')), JSON.stringify({ tokens: t6.m.tokens, warnings: t6.m.warnings }));

  // ---- 断流:停住、记没成;下一轮带上写出来的那句并注明 ----
  const t7 = await send('english-tutor', { from: 'kid', text: 'ZSTALL 讲讲' });
  check('断流:这轮没成,家长端有提醒', t7.m.result === 'error' && (t7.m.warnings ?? []).some((w) => w.includes('API 流')), JSON.stringify({ result: t7.m.result, warnings: t7.m.warnings }));
  const hist7 = JSON.parse(readFileSync(join(conv('english-tutor'), `${date}.${t7.started.thread}.brain.jsonl`), 'utf8').trim().split('\n')[0]) as { ok: boolean; partial?: string };
  check('断流:历史记没成,留着写出来的那句', hist7.ok === false && hist7.partial === '我们先想一想。', JSON.stringify(hist7));
  n = fake.requests.length;
  const t8 = await send('english-tutor', { from: 'kid', text: '继续' });
  const r8 = since(n)[0];
  check('断流后接着聊:前一轮写出来的那句在,这条消息前头注明没回完', t8.m.result === 'ok' && r8.messages.some((m) => m.role === 'assistant' && textOf(m.content).includes('我们先想一想')) && textOf(r8.messages.at(-1)?.content).includes('上一轮你没有回完'), JSON.stringify(r8?.messages.map((m) => [m.role, textOf(m.content).slice(0, 40)])));

  // ---- 401:收尾,err.log 只记状态码 ----
  const t9 = await send('math-tutor', { from: 'kid', text: 'ZHTTP401', newThread: true });
  const err9 = readFileSync(join(conv('math-tutor'), `${date}.${t9.started.job}.err.log`), 'utf8');
  check('401:这轮没成,err.log 只记状态码', t9.m.result === 'error' && err9.includes('api:HTTP 401'), err9);

  // ---- key 不落盘 ----
  const leaks: string[] = [];
  for (const tutor of readdirSync(ctx.ws.dirs.conversations)) for (const f of readdirSync(conv(tutor))) if (!f.endsWith('.cards') && readFileSync(join(conv(tutor), f), 'utf8').includes(SECRET)) leaks.push(f);
  check('key 不落盘(日志、历史、run 文件、err.log)', leaks.length === 0, leaks.join(' '));

  // ---- 没配百炼:不发请求,家长端说去哪配 ----
  const bare = Object.fromEntries(Object.entries(env).filter(([k]) => !['DASHSCOPE_API_KEY', 'DASHSCOPE_WORKSPACE_ID', 'COTUTOR_BRAIN_ENDPOINT'].includes(k)));
  const ctx2 = createContext(loadWorkspace(root), { env: bare, warm: false, now: () => NOW });
  n = fake.requests.length;
  const s10 = await ctx2.runner.send('math-tutor', { from: 'kid', text: '你好', newThread: true });
  const m10 = (await s10.done).messages.find((x) => x.job === s10.job)!;
  check('没配百炼:不发请求,这轮没成,提醒去家长端配', fake.requests.length === n && m10.result === 'error' && (m10.warnings ?? []).some((w) => w.includes('百炼还没配好')), JSON.stringify({ result: m10.result, warnings: m10.warnings }));

  // ---- 思考档(同 qwen:low 不想,带工具至少想一点,high 不限) ----
  check('思考档:low 不想;low 带工具想一点;medium 想一点;high 不限', JSON.stringify([thinkingOf('low', 'off'), thinkingOf('low', 'read'), thinkingOf('medium', 'off'), thinkingOf('high', 'on')]) === JSON.stringify([{ enableThinking: false }, { enableThinking: true, thinkingBudget: 1024 }, { enableThinking: true, thinkingBudget: 1024 }, { enableThinking: true }]));
  // 端点:有业务空间 id 走它的域名;只有按量 key 走公网域名(同 qwen 按量那条线)
  check('端点:业务空间域名 / 公网域名', bailianBase('ws-1') === 'https://ws-1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' && bailianBase(null) === 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  ctx.runner.close();
  ctx2.runner.close();
} finally {
  await fake.close();
  rmSync(home, { recursive: true, force: true });
  done();
}

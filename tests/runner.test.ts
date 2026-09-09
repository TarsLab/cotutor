/**
 * 发消息全流程(假 CLI,不花钱):拼上下文包 → spawn / resume → 日志落盘 → 索引物化;
 * 三轮 resume 同会话、换预设新开、跨天新开、忙时 409、出错标 error、待裁量物化、老师团补丁写回并热重载、关掉老师即消失。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-runner-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { parseTranscript } = await import('../src/lib/transcript.ts');

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const FAKE_TTS = fileURLToPath(new URL('./_fake-tts.ts', import.meta.url));
const node = process.execPath;
const fake = (extra: string[] = []): { run: string[]; resume: string[] } => ({
  run: [node, '--experimental-strip-types', '--no-warnings', FAKE, ...extra, '--agent', '{agent}', '{prompt}'],
  resume: [node, '--experimental-strip-types', '--no-warnings', FAKE, ...extra, '--agent', '{agent}', '--resume', '{session}', '{prompt}'],
});

const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
cfg.agents = {
  default: 'fake',
  fake: fake(),
  fake2: { run: [...fake().run.slice(0, 4), '--body', '{agentBody}', ...fake().run.slice(4)], resume: [...fake().resume.slice(0, 4), '--body', '{agentBody}', ...fake().resume.slice(4)] },
  broken: fake(['--fail']),
  missing: { run: ['/nonexistent/cli', '{prompt}'], resume: ['/nonexistent/cli', '{prompt}'] },
};
cfg.paths = { vault: 'vault', plans: '计划', timetable: '课程表.md' };
cfg.tts = { say: [node, '--experimental-strip-types', '--no-warnings', FAKE_TTS, '{text}', '--voice', '{voice}', '--json', '-o', '{out}'] };
(cfg.tutors as Record<string, Record<string, unknown>>)['math-tutor'].voice = 'v-math';
(cfg.tutors as Record<string, Record<string, unknown>>)['reading-tutor'].voice = 'fail';
(cfg.tutors as Record<string, Record<string, unknown>>)['chinese-tutor'].policy = { dailyMessages: 1 };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
mkdirSync(join(root, 'vault', '计划'), { recursive: true });
writeFileSync(join(root, 'vault', '课程表.md'), '| 星期 | 时间 | 学科 |\n|---|---|---|\n| 二 | 16:00–17:00 | 数学 |\n| 三 | 19:00–19:40 | 语文 |\n');
writeFileSync(join(root, 'vault', '计划', '2026-W37.md'), '---\nweek: 2026-W37\nstatus: confirmed\n---\n## 数学老师\n- 周三前讲退位\n## 语文老师\n- 背古诗\n');
writeFileSync(join(root, 'ledger', 'observations.jsonl'), '{"id":"o-1","date":"2026-09-06","author":"math-tutor","subject":"数学","claim":"借位忘了"}\n{"id":"o-2","date":"2026-09-07","author":"chinese-tutor","subject":"语文","claim":"错别字"}\n');

let now = new Date(2026, 8, 8, 16, 20);
const ctx = createContext(loadWorkspace(root), { now: () => now });
const post = (tutor: string, body: unknown) => route('POST', `/api/conversations/${tutor}/messages`, ctx, body);
const day = (tutor: string, date: string) => route('GET', `/api/conversations/${tutor}/${date}`, ctx);
type Day = { index: { session: { id: string; agent: string } | null; messages: { job: string; result: string; kidText?: string | null; holdup?: { question: string; options: { label: string }[] } | null; handoff?: { to: string } | null; agent?: string; error?: string | null; audio?: string | null }[]; costUsd: number }; running: string | null; runs: Record<string, { kind: string; sub?: boolean; tools?: unknown[] }[]>; errors: Record<string, string> };
const wait = async (tutor: string): Promise<void> => {
  // runner 没暴露 done 给路由层,这里轮询 running 直到空
  for (let i = 0; i < 200 && ctx.runner.running(tutor); i++) await new Promise((r) => setTimeout(r, 25));
};

try {
  // ---- 第一轮:新开 ----
  const r1 = await post('math-tutor', { text: '妈妈我不懂这一步', from: 'kid' });
  check('202 带 job 与预设,第一条不 resume', r1.status === 202 && (r1.json as { job: string; resume: boolean; preset: string }).resume === false && (r1.json as { preset: string }).preset === 'fake', JSON.stringify(r1.json));
  const job1 = (r1.json as { job: string }).job;
  check('job 命名 HHMM-序号', job1 === '1620-1');
  const busy = await post('math-tutor', { text: '再问' });
  check('老师还在回 → 409', busy.status === 409, JSON.stringify(busy.json));
  const mid = (await day('math-tutor', '2026-09-08')).json as Day;
  check('跑的时候索引已有 running 条目', mid.index.messages[0].result === 'running' && mid.running === job1);
  await wait('math-tutor');
  const d1 = (await day('math-tutor', '2026-09-08')).json as Day;
  const m1 = d1.index.messages[0];
  check('跑完:ok、kidText 物化、费用累计', m1.result === 'ok' && m1.kidText === '第一次说:妈妈我不懂这一步' && d1.index.costUsd === 0.05 && m1.agent === 'fake', JSON.stringify(m1));
  check('会话记下', d1.index.session?.agent === 'fake' && d1.index.session.id.startsWith('fake-'));
  const log = readFileSync(join(root, 'conversations', 'math-tutor', `2026-09-08.${job1}.log`), 'utf8');
  const init = JSON.parse(log.split('\n')[0]) as { cwd: string; agent: string };
  check('cwd 是老师目录、--agent 填了老师名', init.cwd === join(root, 'agents', 'math-tutor') && init.agent === 'math-tutor', JSON.stringify(init));
  check('err.log 落了', readFileSync(join(root, 'conversations', 'math-tutor', `2026-09-08.${job1}.err.log`), 'utf8').includes('fake-cli done'));
  const rows = d1.runs[job1];
  check('原始视图:主线说话 + 工具 + 子代理标 sub + 收尾', rows.some((r) => r.kind === 'text' && !r.sub) && rows.some((r) => r.kind === 'tool') && rows.some((r) => r.sub) && rows.some((r) => r.kind === 'done'), JSON.stringify(rows));
  const t1 = parseTranscript(log);
  check('上下文包:计划行只带本老师的、观察只带本学科', !t1.final?.text?.includes('背古诗'));

  // 上下文包内容:假 CLI 只回显最后一行,所以检查索引里 text 与 prompt 分离——直接从 spawn 的 argv 无法取,改看 fake 的 init 事件之外的方式:读日志里 prompt 不存在。
  // 换个法子:再发一条让假 CLI 把整段 prompt 回显——它回显最后一行,而上下文包在前面。这里改为直接测 gatherContext。
  const { gatherContext } = await import('../src/server/runner.ts');
  const pack = await gatherContext(ctx.ws, 'math-tutor', { from: 'kid', at: now });
  check('gatherContext:本老师的计划行、本学科观察、at', pack.plan.join() === '周三前讲退位' && pack.recent.map((r) => r.claim).join() === '借位忘了' && pack.at === '2026-09-08T16:20', JSON.stringify(pack));
  const packZh = await gatherContext(ctx.ws, 'chinese-tutor', { from: 'parent', at: now });
  check('语文老师拿到自己的', packZh.plan.join() === '背古诗' && packZh.recent.map((r) => r.claim).join() === '错别字');
  check('课程表命中 → slot(2026-09-08 是周二 16:20)', pack.slot === '数学 16:00-17:00', String(pack.slot));
  check('时段外没有 slot', (await gatherContext(ctx.ws, 'math-tutor', { from: 'kid', at: new Date(2026, 8, 8, 18, 0) })).slot === undefined);
  check('配音:老师配了 voice → mp3 落会话目录、索引带 audio', m1.audio === `2026-09-08.${job1}.mp3` && readFileSync(join(root, 'conversations', 'math-tutor', `2026-09-08.${job1}.mp3`), 'utf8').startsWith('fake-mp3:v-math:'), JSON.stringify(m1.audio));

  // ---- 第二、三轮:resume 同会话 ----
  now = new Date(2026, 8, 8, 16, 25);
  const r2 = await post('math-tutor', { text: '再讲一遍,要拍板', from: 'parent' });
  check('第二条 resume', (r2.json as { resume: boolean }).resume === true, JSON.stringify(r2.json));
  await wait('math-tutor');
  now = new Date(2026, 8, 8, 16, 30);
  await post('math-tutor', { text: '第三条,顺便转交' });
  await wait('math-tutor');
  const d3 = (await day('math-tutor', '2026-09-08')).json as Day;
  check('三轮同一会话,费用累计', d3.index.messages.length === 3 && d3.index.session?.id === d1.index.session?.id && d3.index.costUsd === 0.15, JSON.stringify(d3.index));
  check('resume 的回复接着说', d3.index.messages[1].kidText === '接着说:再讲一遍,要拍板');
  check('待裁量物化成问题 + 选项,孩子视图剥掉', d3.index.messages[1].holdup?.question === '要不要重讲?' && d3.index.messages[1].holdup?.options.length === 2 && !d3.index.messages[1].kidText?.includes('待裁量'), JSON.stringify(d3.index.messages[1]));
  check('转交段物化', d3.index.messages[2].handoff?.to === 'planner' && d3.index.messages[2].kidText === '接着说:第三条,顺便转交');
  const dates = (await route('GET', '/api/conversations/math-tutor', ctx)).json as { dates: string[] };
  check('日期列表', dates.dates.join() === '2026-09-08');

  // ---- 换预设 → 新开,索引会话换掉 ----
  now = new Date(2026, 8, 8, 16, 40);
  const r4 = await post('math-tutor', { text: '换个 CLI', preset: 'fake2' });
  check('换预设不 resume', (r4.json as { resume: boolean; preset: string }).resume === false && (r4.json as { preset: string }).preset === 'fake2', JSON.stringify(r4.json));
  await wait('math-tutor');
  const d4 = (await day('math-tutor', '2026-09-08')).json as Day;
  check('换预设后会话换成新的', d4.index.session?.agent === 'fake2' && d4.index.session.id !== d1.index.session?.id);
  const log4 = readFileSync(join(root, 'conversations', 'math-tutor', '2026-09-08.1640-4.log'), 'utf8');
  check('{agentBody} 给了老师正文', (JSON.parse(log4.split('\n')[0]) as { bodyLen: number }).bodyLen > 100);
  const bad = await post('math-tutor', { text: 'x', preset: 'gemini' });
  check('不存在的预设 → 400', bad.status === 400 && String((bad.json as { message: string }).message).includes('gemini'));

  // ---- 跨天新开 ----
  now = new Date(2026, 8, 9, 8, 0);
  const r5 = await post('math-tutor', { text: '新的一天' });
  check('零点后第一条不 resume、落新文件', (r5.json as { resume: boolean; date: string }).resume === false && (r5.json as { date: string }).date === '2026-09-09');
  await wait('math-tutor');
  check('两天两份索引', existsSync(join(root, 'conversations', 'math-tutor', '2026-09-09.json')) && existsSync(join(root, 'conversations', 'math-tutor', '2026-09-08.json')));
  check('today 别名', ((await day('math-tutor', 'today')).json as Day).index !== undefined);

  // ---- 出错:CLI 报 error / 起不来 ----
  await post('reading-tutor', { text: '会失败', preset: 'broken' });
  await wait('reading-tutor');
  const dr = (await day('reading-tutor', '2026-09-09')).json as Day;
  check('CLI 报错 → error + 原因,孩子无话', dr.index.messages[0].result === 'error' && dr.index.messages[0].error === 'error_max_turns' && dr.index.messages[0].kidText === null, JSON.stringify(dr.index.messages[0]));
  await post('reading-tutor', { text: '配音会失败' });
  await wait('reading-tutor');
  const dr2 = (await day('reading-tutor', '2026-09-09')).json as Day & { index: { messages: { audio?: string | null }[] } };
  check('配音失败 → audio null、对话照常、原因进 err.log', dr2.index.messages[1].result === 'ok' && dr2.index.messages[1].audio === null && readFileSync(join(root, 'conversations', 'reading-tutor', `2026-09-09.${dr2.index.messages[1].job}.err.log`), 'utf8').includes('没合成'), JSON.stringify(dr2.index.messages[1]));
  await post('chinese-tutor', { text: '起不来', preset: 'missing' });
  await wait('chinese-tutor');
  const dm = (await day('chinese-tutor', '2026-09-09')).json as Day;
  check('起不来 → error 指向 err.log,尾巴带原因', dm.index.messages[0].result === 'error' && String(dm.index.messages[0].error).startsWith('spawn:') && dm.errors[dm.index.messages[0].job]?.includes('起不来'), JSON.stringify({ m: dm.index.messages[0], e: dm.errors }));

  // ---- 孩子端接口:首页、过滤后的会话、发消息、每日上限、配音文件 ----
  const home = (await route('GET', '/api/kid/home', ctx)).json as { title: string; timetable: unknown[]; tutors: { name: string; available: boolean; remaining: number; hasVoice: boolean }[]; stacks: unknown[] };
  check('首页:标题、课程表、孩子端老师(无 planner)', home.title === '小明的老师们' && home.timetable.length === 2 && home.tutors.length === 4 && !home.tutors.some((t) => t.name === 'planner') && home.stacks.length === 0, JSON.stringify(home.tutors));
  check('老师带 hasVoice 与剩余条数(今天 09-09 孩子还没发过)', home.tutors.find((t) => t.name === 'math-tutor')?.hasVoice === true && home.tutors.find((t) => t.name === 'math-tutor')?.remaining === 30, JSON.stringify(home.tutors));
  const kd = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { question: string | null; reply: string | null; audio: string | null }[]; remaining: number; pending: string | null };
  check('孩子视图:家长发的只见回复,搜不到工具、错误、待裁量', kd.messages.length === 1 && kd.messages[0].question === null && kd.messages[0].reply === '第一次说:新的一天' && !/工具|error|holdup|handoff|costUsd|Read/.test(JSON.stringify(kd)), JSON.stringify(kd));
  check('planner 对孩子端不存在', (await route('GET', '/api/kid/conversations/planner/today', ctx)).status === 404);
  const kp = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '孩子问的' });
  check('孩子发消息 202', kp.status === 202, JSON.stringify(kp.json));
  const kdMid = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { pending: string | null; messages: { pending: boolean }[] };
  check('跑的时候 pending', kdMid.pending !== null && kdMid.messages[1].pending === true);
  await wait('math-tutor');
  const kd2 = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { question: string | null; reply: string | null; audio: string | null }[] };
  check('回复 + 配音文件名', kd2.messages[1].question === '孩子问的' && kd2.messages[1].reply === '接着说:孩子问的' && kd2.messages[1].audio === '2026-09-09.0800-2.mp3', JSON.stringify(kd2.messages[1]));
  const au = await route('GET', '/api/audio/math-tutor/2026-09-09.0800-2.mp3', ctx);
  check('配音文件能取', au.status === 200 && au.file !== undefined && au.contentType === 'audio/mpeg' && readFileSync(au.file!, 'utf8').includes('接着说:孩子问的'), JSON.stringify(au));
  check('配音路径校验', (await route('GET', '/api/audio/math-tutor/../cotutor.json', ctx)).status === 404 && (await route('GET', '/api/audio/math-tutor/2026-09-09.0800-9.mp3', ctx)).status === 404);
  // 语文老师 dailyMessages = 1:孩子发一条后头像灰、再发 429;家长发的不算
  check('语文老师上限前可用', (await route('GET', '/api/kid/home', ctx)).status === 200 && ((await route('GET', '/api/kid/home', ctx)).json as typeof home).tutors.find((t) => t.name === 'chinese-tutor')?.available === true);
  check('孩子发第一条 202', (await route('POST', '/api/kid/conversations/chinese-tutor/messages', ctx, { text: '一' })).status === 202);
  await wait('chinese-tutor');
  const limited = await route('POST', '/api/kid/conversations/chinese-tutor/messages', ctx, { text: '二' });
  check('到上限 → 429,头像灰', limited.status === 429 && ((await route('GET', '/api/kid/home', ctx)).json as typeof home).tutors.find((t) => t.name === 'chinese-tutor')?.available === false, JSON.stringify(limited.json));
  check('家长照发不受孩子上限', (await post('chinese-tutor', { text: '家长的', from: 'parent' })).status === 202);
  await wait('chinese-tutor');
  const kdZh = (await route('GET', '/api/kid/conversations/chinese-tutor/today', ctx)).json as { messages: { question: string | null }[]; remaining: number };
  check('家长那条的问句不给孩子看,remaining 0', kdZh.messages.filter((m) => m.question !== null).length === 1 && kdZh.remaining === 0, JSON.stringify(kdZh));
  check('孩子端页面在,没有「错误」字样', ((await route('GET', '/', ctx)).html ?? '').includes('小明的老师们') && !((await route('GET', '/', ctx)).html ?? '').includes('错误'));

  // ---- 参数校验 ----
  check('空消息 400', (await post('math-tutor', { text: '   ' })).status === 400);
  check('坏 from 400', (await post('math-tutor', { text: 'x', from: 'dog' })).status === 400);
  check('没这位老师 404', (await post('nobody', { text: 'x' })).status === 404);
  check('坏日期 400', (await day('math-tutor', '2026-9-9')).status === 400);

  // ---- 老师团:补丁写回、热重载、关掉老师即消失 ----
  const p1 = await route('PATCH', '/api/config', ctx, { tutors: { 'math-tutor': { enabled: false, policy: { replyMaxChars: 20 } } } });
  check('PATCH 写回并热重载', p1.status === 200 && ctx.ws.config.tutors['math-tutor'].enabled === false, JSON.stringify(p1.json));
  const raw = JSON.parse(readFileSync(cfgFile, 'utf8')) as { tutors: Record<string, { enabled: boolean; display: string; policy: { replyMaxChars: number } }>; _note?: string; agents: { default: string } };
  check('文件里只动了那几个字段,_note 与预设都在', raw.tutors['math-tutor'].enabled === false && raw.tutors['math-tutor'].display === '数学老师' && raw.tutors['math-tutor'].policy.replyMaxChars === 20 && typeof raw._note === 'string' && raw.agents.default === 'fake');
  const tutorsNow = (await route('GET', '/api/config', ctx)).json as { tutors: { name: string; enabled: boolean; policy: { replyMaxChars: number } }[] };
  check('接口回报关闭与有效政策', tutorsNow.tutors.find((t) => t.name === 'math-tutor')?.enabled === false && tutorsNow.tutors.find((t) => t.name === 'math-tutor')?.policy.replyMaxChars === 20);
  check('孩子端列表里没了', !((await route('GET', '/api/tutors?kid=1', ctx)).json as { name: string }[]).some((t) => t.name === 'math-tutor'));
  check('关掉的老师不收消息', (await post('math-tutor', { text: 'x' })).status === 400);
  const p2 = await route('PATCH', '/api/config', ctx, { tutors: { 'math-tutor': { display: '' } } });
  check('不合契约的补丁 422 且不落盘', p2.status === 422 && (JSON.parse(readFileSync(cfgFile, 'utf8')) as typeof raw).tutors['math-tutor'].display === '数学老师', JSON.stringify(p2.json));
  check('改预设模板被拒', (await route('PATCH', '/api/config', ctx, { agents: { fake: { run: ['x'], resume: ['x'] } } })).status === 422);
  check('改 kid 被拒', (await route('PATCH', '/api/config', ctx, { kid: { slug: 'x' } })).status === 422);
  const p3 = await route('PATCH', '/api/config', ctx, { tutors: { 'math-tutor': { enabled: true, policy: { replyMaxChars: null } } } });
  check('null 删键:政策覆盖撤掉回到继承', p3.status === 200 && ctx.ws.config.tutors['math-tutor'].policy?.replyMaxChars === undefined && ctx.ws.config.tutors['math-tutor'].enabled === true);

  // ---- 家长在编辑器改文件 → 下个请求自动重读;改坏了留旧的并在 health 上响 ----
  const edited = JSON.parse(readFileSync(cfgFile, 'utf8')) as { title: string };
  edited.title = '改过的标题';
  await new Promise((r) => setTimeout(r, 10));
  writeFileSync(cfgFile, JSON.stringify(edited, null, 2));
  check('编辑器改了 → 热重载', ((await route('GET', '/api/config', ctx)).json as { title: string }).title === '改过的标题');
  await new Promise((r) => setTimeout(r, 10));
  writeFileSync(cfgFile, '{ 坏');
  const hh = (await route('GET', '/api/health', ctx)).json as { ok: boolean; configError: string | null };
  check('改坏了 → 留旧配置,health 报错', hh.configError !== null && ctx.ws.config.title === '改过的标题', JSON.stringify(hh));
  check('家长页在', ((await route('GET', '/parent', ctx)).html ?? '').includes('老师团'));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();

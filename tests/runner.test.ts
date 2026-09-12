/**
 * 发消息全流程(假 CLI,不花钱):拼上下文包 → spawn / resume → 日志落盘 → 索引物化;
 * 三轮 resume 同会话、换运行时新开、跨天新开、忙时 409、出错标 error、待裁量物化、老师团补丁写回并热重载、关掉老师即消失。
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
cfg.runtimes = {
  default: 'fake',
  fake: fake(),
  fake2: { run: [...fake().run.slice(0, 4), '--body', '{agentBody}', ...fake().run.slice(4)], resume: [...fake().resume.slice(0, 4), '--body', '{agentBody}', ...fake().resume.slice(4)] },
  broken: fake(['--fail']),
  stream: fake(['--stream']),
  fast: fake(['--output-format', 'json']),
  missing: { run: ['/nonexistent/cli', '{prompt}'], resume: ['/nonexistent/cli', '{prompt}'] },
};
cfg.paths = { vault: 'vault', plans: '计划', timetable: '课程表.md' };
// 板书后期走假 CLI 的 json 模式;等 1500ms(假 CLI 见「后期慢」拖 3 秒 → 超时)
cfg.policyDefaults = { post: { runtime: 'fast', timeoutMs: 1500 } };
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
type Timing = { startedAt: string; firstCardMs?: number; doneMs?: number; dubbedMs?: number };
type Day = { index: { session: { id: string; runtime: string } | null; messages: { job: string; result: string; kidText?: string | null; timing?: Timing; artifacts?: string[]; holdup?: { question: string; options: { label: string }[] } | null; handoff?: { to: string } | null; runtime?: string; error?: string | null; audio?: string | null }[]; costUsd: number }; running: string | null; runs: Record<string, { kind: string; sub?: boolean; tools?: unknown[] }[]>; errors: Record<string, string> };
const wait = async (tutor: string): Promise<void> => {
  // runner 没暴露 done 给路由层,这里轮询 running 直到空
  for (let i = 0; i < 200 && ctx.runner.running(tutor); i++) await new Promise((r) => setTimeout(r, 25));
};

try {
  // ---- 第一轮:新开 ----
  const r1 = await post('math-tutor', { text: '妈妈我不懂这一步', from: 'kid' });
  check('202 带 job 与运行时,第一条不 resume', r1.status === 202 && (r1.json as { job: string; resume: boolean; runtime: string }).resume === false && (r1.json as { runtime: string }).runtime === 'fake', JSON.stringify(r1.json));
  const job1 = (r1.json as { job: string }).job;
  check('job 命名 HHMM-序号', job1 === '1620-1');
  const busy = await post('math-tutor', { text: '再问' });
  check('老师还在回 → 409', busy.status === 409, JSON.stringify(busy.json));
  const mid = (await day('math-tutor', '2026-09-08')).json as Day;
  check('跑的时候索引已有 running 条目', mid.index.messages[0].result === 'running' && mid.running === job1);
  await wait('math-tutor');
  const d1 = (await day('math-tutor', '2026-09-08')).json as Day;
  const m1 = d1.index.messages[0];
  check('跑完:ok、kidText 物化、费用累计', m1.result === 'ok' && m1.kidText === '第一次说:妈妈我不懂这一步' && d1.index.costUsd === 0.05 && m1.runtime === 'fake', JSON.stringify(m1));
  check('会话记下', d1.index.session?.runtime === 'fake' && d1.index.session.id.startsWith('fake-'));
  check('埋点:startedAt 是 ISO、整轮与配音收尾都记了、整块出的没有首卡', typeof m1.timing?.startedAt === 'string' && !Number.isNaN(Date.parse(m1.timing.startedAt)) && typeof m1.timing.doneMs === 'number' && m1.timing.doneMs >= 0 && typeof m1.timing.dubbedMs === 'number' && m1.timing.dubbedMs >= m1.timing.doneMs && m1.timing.firstCardMs === undefined, JSON.stringify(m1.timing));
  const log = readFileSync(join(root, 'conversations', 'math-tutor', `2026-09-08.${job1}.log`), 'utf8');
  const init = JSON.parse(log.split('\n')[0]) as { cwd: string; agent: string };
  check('cwd 是老师目录、--agent 填了老师名', init.cwd === join(root, 'agents', 'math-tutor') && init.agent === 'math-tutor', JSON.stringify(init));
  check('err.log 落了', readFileSync(join(root, 'conversations', 'math-tutor', `2026-09-08.${job1}.err.log`), 'utf8').includes('fake-cli done'));
  const rows = d1.runs[job1];
  check('家长视图:主线说话 + 工具 + 子代理标 sub + 收尾', rows.some((r) => r.kind === 'text' && !r.sub) && rows.some((r) => r.kind === 'tool') && rows.some((r) => r.sub) && rows.some((r) => r.kind === 'done'), JSON.stringify(rows));
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
  const m1s = m1 as typeof m1 & { section?: { lines: { audio: string | null }[] } };
  check('配音:老师配了 voice → 讲稿逐句 mp3 落会话目录(一句话也是一句),索引的整段 audio 不用了', m1.audio === null && m1s.section?.lines[0].audio === `2026-09-08.${job1}.1.mp3` && readFileSync(join(root, 'conversations', 'math-tutor', `2026-09-08.${job1}.1.mp3`), 'utf8').startsWith('fake-mp3:v-math:'), JSON.stringify(m1s.section));

  // ---- 看原文:一轮拆成六站,一个接口给全(2026-09-11) ----
  type Raw = {
    stations: { id: string; state: string; note: string }[];
    pack: { prompt: string; argv: string[]; resume: boolean; session: string | null } | null;
    source: { text: string; rows: { role: string; label?: string }[]; warnings: { text: string; line?: number }[] };
    fresh: { same: boolean; diff: { s: string }[] };
    kid: { lines: { text: string; cut: string; audio: string | null; audioOk: boolean }[]; cards: unknown[] };
    trace: unknown[];
    stored: { kidText: string | null };
  };
  const rawR = await route('GET', `/api/conversations/math-tutor/2026-09-08/raw/${job1}`, ctx);
  const rawView1 = rawR.json as Raw;
  check('看原文:六站都在', rawR.status === 200 && rawView1.stations.map((x) => x.id).join() === 'pack,source,parse,kid,audio,trace', JSON.stringify(rawView1.stations?.map((x) => x.id)));
  check('看原文:上下文包落了盘,消息正文与完整命令行都在', rawView1.pack?.prompt.includes('妈妈我不懂这一步') === true && rawView1.pack.argv.includes('--agent') && rawView1.pack.resume === false, JSON.stringify(rawView1.pack?.argv));
  check('看原文:原文逐行标了角色', rawView1.source.text.includes('第一次说') && rawView1.source.rows.some((r) => r.role === 'say' && r.label?.startsWith('讲稿') === true), JSON.stringify(rawView1.source.rows));
  check('看原文:当前解析器重解 = 索引里存的(同一版解析器,不该有差异)', rawView1.fresh.same === true && rawView1.fresh.diff.every((d) => d.s === '·'), JSON.stringify(rawView1.fresh.diff));
  check('看原文:下发给孩子那一站带配音文件名与在不在', rawView1.kid.lines[0].audio === `2026-09-08.${job1}.1.mp3` && rawView1.kid.lines[0].audioOk === true && rawView1.kid.lines[0].cut === '', JSON.stringify(rawView1.kid.lines));
  const fx = (await route('GET', `/api/conversations/math-tutor/2026-09-08/raw/${job1}/fixture`, ctx)).json as { name: string; text: string };
  check('看原文:fixture 是原文原样一份', fx.name === `math-tutor-2026-09-08-${job1}.md` && fx.text.includes('第一次说') && fx.text.endsWith('\n'), JSON.stringify(fx));
  check('看原文:没有这一轮 → 404', (await route('GET', '/api/conversations/math-tutor/2026-09-08/raw/9999-9', ctx)).status === 404);
  const tryR = (await route('POST', '/api/tts/try', ctx, { text: '试一句' })).json as { ok: boolean; voice: string; ms: number; audio: string };
  check('设置页试一句:真跑一次 tts.say,回音色 / 耗时 / 音频', tryR.ok === true && tryR.voice === 'v-math' && typeof tryR.ms === 'number' && tryR.audio.startsWith('data:audio/mpeg;base64,'), JSON.stringify({ ok: tryR.ok, voice: tryR.voice }));

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

  // ---- 换运行时 → 新开,索引会话换掉 ----
  now = new Date(2026, 8, 8, 16, 40);
  const r4 = await post('math-tutor', { text: '换个 CLI', runtime: 'fake2' });
  check('换运行时不 resume', (r4.json as { resume: boolean; runtime: string }).resume === false && (r4.json as { runtime: string }).runtime === 'fake2', JSON.stringify(r4.json));
  await wait('math-tutor');
  const d4 = (await day('math-tutor', '2026-09-08')).json as Day;
  check('换运行时后会话换成新的', d4.index.session?.runtime === 'fake2' && d4.index.session.id !== d1.index.session?.id);
  const log4 = readFileSync(join(root, 'conversations', 'math-tutor', '2026-09-08.1640-4.log'), 'utf8');
  check('{agentBody} 给了老师正文', (JSON.parse(log4.split('\n')[0]) as { bodyLen: number }).bodyLen > 100);
  const bad = await post('math-tutor', { text: 'x', runtime: 'gemini' });
  check('不存在的运行时 → 400', bad.status === 400 && String((bad.json as { message: string }).message).includes('gemini'));

  // ---- 跨天新开 ----
  now = new Date(2026, 8, 9, 8, 0);
  const r5 = await post('math-tutor', { text: '新的一天' });
  check('零点后第一条不 resume、落新文件', (r5.json as { resume: boolean; date: string }).resume === false && (r5.json as { date: string }).date === '2026-09-09');
  await wait('math-tutor');
  check('两天两份索引', existsSync(join(root, 'conversations', 'math-tutor', '2026-09-09.json')) && existsSync(join(root, 'conversations', 'math-tutor', '2026-09-08.json')));
  check('today 别名', ((await day('math-tutor', 'today')).json as Day).index !== undefined);

  // ---- 出错:CLI 报 error / 起不来 ----
  await post('reading-tutor', { text: '会失败', runtime: 'broken' });
  await wait('reading-tutor');
  const dr = (await day('reading-tutor', '2026-09-09')).json as Day;
  check('CLI 报错 → error + 原因,孩子无话', dr.index.messages[0].result === 'error' && dr.index.messages[0].error === 'error_max_turns' && dr.index.messages[0].kidText === null, JSON.stringify(dr.index.messages[0]));
  await post('reading-tutor', { text: '配音会失败' });
  await wait('reading-tutor');
  const dr2 = (await day('reading-tutor', '2026-09-09')).json as Day & { index: { messages: { audio?: string | null }[] } };
  check('配音失败 → audio null、对话照常、原因进 err.log', dr2.index.messages[1].result === 'ok' && dr2.index.messages[1].audio === null && readFileSync(join(root, 'conversations', 'reading-tutor', `2026-09-09.${dr2.index.messages[1].job}.err.log`), 'utf8').includes('没合成'), JSON.stringify(dr2.index.messages[1]));
  await post('chinese-tutor', { text: '起不来', runtime: 'missing' });
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
  const kd2 = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { question: string | null; reply: string | null; audio: string | null; section?: { lines: { audio: string | null }[] } }[] };
  check('回复 + 逐句配音文件名', kd2.messages[1].question === '孩子问的' && kd2.messages[1].reply === '接着说:孩子问的' && kd2.messages[1].section?.lines[0].audio === '2026-09-09.0800-2.1.mp3', JSON.stringify(kd2.messages[1]));
  const au = await route('GET', '/api/audio/math-tutor/2026-09-09.0800-2.1.mp3', ctx);
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

  // ---- 板书:最终文本 → section 进索引、逐句配音、孩子端剥答案、家长尾巴与提醒 ----
  now = new Date(2026, 8, 9, 9, 0);
  // 上面孩子发过一条,下面这条 resume;板书卡 + 讲稿逐句配音 + 坏卡 + 家长尾巴一起来
  const rb = await post('math-tutor', { text: '讲讲板书 坏卡 家长段', from: 'kid' });
  const jobB = (rb.json as { job: string }).job;
  await wait('math-tutor');
  type BoardMsg = { job: string; kidText: string | null; audio: string | null; section: { cards: { kind: string; props: Record<string, unknown> }[]; lines: { text: string; audio: string | null; anchor: number | null }[] } | null; parentText?: string; warnings?: string[] };
  const db = (await day('math-tutor', '2026-09-09')).json as { index: { messages: BoardMsg[] } };
  const mb = db.index.messages.find((m) => m.job === jobB)!;
  check('板书:section 物化(2 张好卡 + 1 张退成文字的),讲稿 3 句,答案还在索引里', mb.section?.cards.map((c) => c.kind).join() === 'text,choice,text' && JSON.stringify(mb.section?.cards[1].props.answer) === '[0]' && mb.section?.lines.length === 3 && mb.kidText === '先看三角形。\n三角形有几个角?\n接着说:讲讲板书 坏卡 家长段', JSON.stringify(mb));
  check('板书:逐句配音,每句一个 mp3,整段 audio 不再合成', mb.audio === null && mb.section?.lines.every((l, i) => l.audio === `2026-09-09.${jobB}.${i + 1}.mp3`) === true && existsSync(join(root, 'conversations', 'math-tutor', `2026-09-09.${jobB}.2.mp3`)) && !existsSync(join(root, 'conversations', 'math-tutor', `2026-09-09.${jobB}.mp3`)), JSON.stringify(mb.section?.lines.map((l) => l.audio)));
  check('板书:家长尾巴与解析提醒进索引', mb.parentText === '## 家长\n他其实会了。' && mb.warnings?.length === 1 && mb.warnings[0].includes('choice'), JSON.stringify([mb.parentText, mb.warnings]));
  const kidB = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { job: string; section?: { cards: { props: Record<string, unknown> }[]; lines: { audio: string | null }[] } }[] };
  const kb = kidB.messages.find((m) => m.job === jobB)!;
  check('孩子端:section 下发、答案剥掉、家长尾巴与提醒不下发、每句带配音', kb.section?.cards.length === 3 && !('answer' in kb.section.cards[1].props) && !JSON.stringify(kb).includes('他其实会了') && !JSON.stringify(kb).includes('没解析成') && kb.section.lines[0].audio === `2026-09-09.${jobB}.1.mp3`, JSON.stringify(kb));
  const lineAudio = await route('GET', `/api/audio/math-tutor/2026-09-09.${jobB}.1.mp3`, ctx);
  check('逐句配音文件能取', lineAudio.status === 200, JSON.stringify(lineAudio.status));

  // ---- 卡的状态:PUT 存文件 → 孩子端读回(答案仍剥)→ 交给老师:上下文包 cards 段、消息记 cards / action;「继续」不计上限 ----
  const putBad = await route('PUT', `/api/kid/conversations/math-tutor/cards/${jobB}/1`, ctx, { picked: 'x' });
  const putText = await route('PUT', `/api/kid/conversations/math-tutor/cards/${jobB}/0`, ctx, { picked: [0] });
  const putNone = await route('PUT', `/api/kid/conversations/math-tutor/cards/${jobB}/9`, ctx, { picked: [0] });
  check('PUT 状态:坏形状 400、text 卡 400、没这张卡 404、GET 405', putBad.status === 400 && putText.status === 400 && putNone.status === 404 && (await route('GET', `/api/kid/conversations/math-tutor/cards/${jobB}/1`, ctx)).status === 405, JSON.stringify([putBad, putText, putNone]));
  const put = await route('PUT', `/api/kid/conversations/math-tutor/cards/${jobB}/1`, ctx, { picked: [1] });
  const stateFile = join(root, 'conversations', 'math-tutor', `2026-09-09.${jobB}.cards`, '1.json');
  check('PUT 状态 200,落 <日期>.<job>.cards/<n>.json,记 turn = 当时末条 job', put.status === 200 && (put.json as { card: string }).card === `${jobB}/1` && existsSync(stateFile) && (JSON.parse(readFileSync(stateFile, 'utf8')) as { turn: string; state: unknown }).turn === jobB, JSON.stringify(put.json));
  const kidS = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { job: string; section?: { cards: { props: Record<string, unknown>; state?: unknown }[] } }[] };
  const ks = kidS.messages.find((m) => m.job === jobB)!.section!.cards[1];
  check('孩子端读回状态,答案还是没有', JSON.stringify(ks.state) === '{"picked":[1]}' && !('answer' in ks.props), JSON.stringify(ks));
  // 改主意再选一次:同一张卡覆盖
  await route('PUT', `/api/kid/conversations/math-tutor/cards/${jobB}/1`, ctx, { picked: [0] });
  now = new Date(2026, 8, 9, 9, 5);
  const sub = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '', action: 'submit', focus: { card: `${jobB}/1` } });
  check('交给老师:空文本 + action 也 202', sub.status === 202, JSON.stringify(sub.json));
  const jobS = (sub.json as { job: string }).job;
  await wait('math-tutor');
  type SubMsg = { job: string; text: string; action?: string; focus?: { card?: string }; cards?: { card: string; text: string }[]; kidText: string | null };
  const ds = (await day('math-tutor', '2026-09-09')).json as { index: { messages: SubMsg[] } };
  const ms = ds.index.messages.find((m) => m.job === jobS)!;
  check('消息文本是「(交了答案,没说话)」,记 action / focus.card / cards(describe 那句,带答案)', ms.text === '(交了答案,没说话)' && ms.action === 'submit' && ms.focus?.card === `${jobB}/1` && ms.cards?.length === 1 && ms.cards[0].card === `${jobB}/1` && ms.cards[0].text === 'choice「三角形有几个角?」 选了「A 三个」(答案:「A 三个」)', JSON.stringify(ms));
  check('老师的上下文包里有 cards 段(假 CLI 回显)', ms.kidText?.includes(`看到卡:${jobB}/1 choice「三角形有几个角?」 选了「A 三个」(答案:「A 三个」)`) === true, String(ms.kidText));
  const dsBad = ds.index.messages.find((m) => m.job === jobS)!;
  void dsBad;
  now = new Date(2026, 8, 9, 9, 6);
  const again = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '没改卡' });
  await wait('math-tutor');
  const ma = (await day('math-tutor', '2026-09-09')).json as { index: { messages: SubMsg[] } };
  const mAgain = ma.index.messages.find((m) => m.job === (again.json as { job: string }).job)!;
  check('下一条没改卡就不再带', mAgain.cards === undefined && !mAgain.kidText?.includes('看到卡'), JSON.stringify(mAgain));
  check('坏 action 400;空文本没 action 400', (await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '', action: 'jump' })).status === 400 && (await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '' })).status === 400);
  // 语文老师到了上限(dailyMessages = 1):「继续」照样能发,交答案不行
  now = new Date(2026, 8, 9, 9, 7);
  const cont = await route('POST', '/api/kid/conversations/chinese-tutor/messages', ctx, { text: '', action: 'continue' });
  await wait('chinese-tutor');
  check('上限后「继续」202、文本「继续」、不计次数;交答案 429', cont.status === 202 && ((await route('GET', '/api/kid/conversations/chinese-tutor/today', ctx)).json as { remaining: number; messages: { question: string | null }[] }).remaining === 0 && (await route('POST', '/api/kid/conversations/chinese-tutor/messages', ctx, { text: '', action: 'submit' })).status === 429, JSON.stringify(cont.json));
  const dz = (await day('chinese-tutor', '2026-09-09')).json as { index: { messages: SubMsg[] } };
  check('「继续」在索引里:text 继续、action continue', dz.index.messages.some((m) => m.text === '继续' && m.action === 'continue'));


  // ---- 流式:假 CLI --stream 按行吐增量;跑到一半孩子端 pending 条目已有前几张卡(partial、答案剥掉);跑完正式一节 + 每句 mp3 ----
  now = new Date(2026, 8, 9, 9, 30);
  const rs = await post('math-tutor', { text: '流式 板书', from: 'kid', runtime: 'stream' });
  const jobS2 = (rs.json as { job: string }).job;
  const seen: { cards: number; partial: boolean | undefined; secret: boolean }[] = [];
  for (let i = 0; i < 200 && ctx.runner.running('math-tutor'); i++) {
    const kd = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { job: string; pending: boolean; section?: { cards: { props: Record<string, unknown> }[]; partial?: boolean } }[] };
    const pm = kd.messages.find((m) => m.job === jobS2);
    if (pm?.pending && pm.section) seen.push({ cards: pm.section.cards.length, partial: pm.section.partial, secret: pm.section.cards.some((c) => 'answer' in c.props) });
    await new Promise((r) => setTimeout(r, 15));
  }
  await wait('math-tutor');
  check('跑到一半:pending 条目带 partial 板书,先有 1 张卡再有 2 张,答案剥掉', seen.length > 0 && seen.every((x) => x.partial === true && !x.secret) && seen[0].cards >= 1 && seen[seen.length - 1].cards === 2 && seen.every((x, i) => i === 0 || x.cards >= seen[i - 1].cards), JSON.stringify(seen));
  const dS = (await day('math-tutor', '2026-09-09')).json as { index: { messages: BoardMsg[] } };
  const mS = dS.index.messages.find((m) => m.job === jobS2)!;
  check('跑完:正式一节(不带 partial)、2 张卡 3 句、每句 mp3(流式时已在路上)、子代理的增量没混进来', mS.section?.cards.length === 2 && !('partial' in mS.section) && mS.section.lines.length === 3 && mS.section.lines.every((l, i) => l.audio === `2026-09-09.${jobS2}.${i + 1}.mp3`) && !mS.kidText?.includes('子代理') && mS.kidText?.includes('第一次说:流式 板书') === true, JSON.stringify(mS));
  // ---- 板书后期:有卡就起,与配音并行;假 CLI 的提案里一半是坏的(卡 99、老师已标的、槽名 nope),校验丢掉,剩下的套上 ----
  type Post = { ok: boolean; ms: number; costUsd?: number; dropped: number; error?: string };
  type PostMsg = { result: string; post?: Post; device?: string; timing?: { postMs?: number }; section?: { layout?: { for: string; rows: number[][] }; cards: { look?: { tint?: string; emoji?: string } }[]; lines: { marks: { phrase: string; pen?: string }[] }[] } };
  const mP = mS as unknown as PostMsg;
  check('后期:收到、记了费用与丢的条数;layout 一行一张(两张卡)、for 缺省平板横屏;卡 0 的样子进了;老师的标注没 pen、模型重复的丢了', mP.post?.ok === true && mP.post.costUsd === 0.0021 && mP.post.dropped === 3 && mP.section?.layout?.for === 'tablet-landscape' && JSON.stringify(mP.section.layout.rows) === '[[0],[1]]' && mP.section.cards[0].look?.tint === 'sky' && mP.section.cards[0].look?.emoji === '📐' && mP.section.cards[1].look === undefined && mP.section.lines[0].marks.length === 1 && mP.section.lines[0].marks[0].pen === undefined && typeof mP.timing?.postMs === 'number', JSON.stringify([mP.post, mP.section?.layout, mP.section?.cards.map((c) => c.look)]));
  check('后期文件落了盘:提示词、原始输出、丢掉的三条', existsSync(join(root, 'conversations', 'math-tutor', `2026-09-09.${jobS2}.post.json`)) && (JSON.parse(readFileSync(join(root, 'conversations', 'math-tutor', `2026-09-09.${jobS2}.post.json`), 'utf8')) as { dropped: string[]; prompt: string; raw: string }).dropped.length === 3);
  const rawS = (await route('GET', `/api/conversations/math-tutor/2026-09-09/raw/${jobS2}`, ctx)).json as Raw & { post: { kept: { marks: number; layout: boolean } } | null };
  check('看原文:有卡的轮次多第七站「板书后期」,warn(有丢的);带提示词与校验结果', rawS.stations.map((x) => x.id).join() === 'pack,source,parse,kid,audio,trace,post' && rawS.stations.find((x) => x.id === 'post')?.state === 'warn' && rawS.post?.kept.layout === true && rawS.post.kept.marks === 0, JSON.stringify(rawS.stations));
  // 超时 → 素版(没有 layout、没有 look),post.ok false 带原因;坏输出 → 同样素版
  const rSlow = await post('math-tutor', { text: '板书 后期慢', from: 'kid' });
  await wait('math-tutor');
  const mSlow = (await day('math-tutor', '2026-09-09')).json as Day;
  const slow = mSlow.index.messages.find((m) => m.job === (rSlow.json as { job: string }).job) as unknown as PostMsg | undefined;
  check('后期超时 → 素版:卡还在、没有 layout、post.ok false 说超时', slow?.result === 'ok' && slow.section?.cards.length === 2 && slow.section.layout === undefined && slow.post?.ok === false && slow.post.error?.includes('超时') === true, JSON.stringify(slow?.post));
  const rBad = await post('math-tutor', { text: '板书 后期坏', from: 'kid' });
  await wait('math-tutor');
  const badP = ((await day('math-tutor', '2026-09-09')).json as Day).index.messages.find((m) => m.job === (rBad.json as { job: string }).job) as unknown as PostMsg | undefined;
  check('后期输出不是 JSON → 素版,post.error 说不合形状', badP?.section?.layout === undefined && badP?.post?.ok === false && badP.post.error?.includes('不合形状') === true, JSON.stringify(badP?.post));
  // 再做一次后期(家长端第七站的按钮):老师原文重解 → 再跑 → 改写索引
  const re = await route('POST', `/api/conversations/math-tutor/2026-09-09/raw/${(rBad.json as { job: string }).job}/repost`, ctx);
  const redone = ((await day('math-tutor', '2026-09-09')).json as Day).index.messages.find((m) => m.job === (rBad.json as { job: string }).job) as unknown as PostMsg | undefined;
  check('repost:这轮原文里还是「后期坏」→ 仍素版但重新跑过(post 换了新的);没这轮 → 404', re.status === 200 && (re.json as { ok: boolean }).ok === false && redone?.post?.ok === false && (await route('POST', '/api/conversations/math-tutor/2026-09-09/raw/9999-9/repost', ctx)).status === 404, JSON.stringify(re.json));
  // 孩子端发消息带端:后期按它排;坏的端 400
  const rPhone = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '板书 手机', device: 'phone' });
  await wait('math-tutor');
  const phone = ((await day('math-tutor', '2026-09-09')).json as Day).index.messages.find((m) => m.job === (rPhone.json as { job: string }).job) as unknown as PostMsg | undefined;
  check('孩子端带 device=phone → 消息记了端,layout.for 是 phone;坏的端 400', rPhone.status === 202 && phone?.device === 'phone' && phone.section?.layout?.for === 'phone' && (await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: 'x', device: 'watch' })).status === 400, JSON.stringify([phone?.device, phone?.section?.layout]));
  const tS = (mS as unknown as { timing?: Timing }).timing;
  check('埋点:流式轮记了首卡,首卡 ≤ 整轮 ≤ 配音收尾', typeof tS?.firstCardMs === 'number' && tS.firstCardMs >= 0 && typeof tS.doneMs === 'number' && tS.firstCardMs <= tS.doneMs && typeof tS.dubbedMs === 'number' && tS.dubbedMs >= tS.doneMs, JSON.stringify(tS));
  check('跑完后 partial 没了', ctx.runner.partial('math-tutor') === null && !(((await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { job: string; section?: { partial?: boolean } }[] }).messages.find((m) => m.job === jobS2)?.section?.partial));

  // ---- 点读资产与图片:点读段在索引写好后后台配到 .cards/<n>/<k>.mp3,孩子端卡上带 assets、/api/audio 能取;图片卡的图只认 workspace 内 ----
  now = new Date(2026, 8, 9, 9, 40);
  mkdirSync(join(root, 'vault'), { recursive: true });
  writeFileSync(join(root, 'vault', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const ra = await post('math-tutor', { text: '板书 点读 图片', from: 'kid' });
  const jobA = (ra.json as { job: string }).job;
  await wait('math-tutor');
  await ctx.runner.flush();
  const assetDir = join(root, 'conversations', 'math-tutor', `2026-09-09.${jobA}.cards`, '2');
  check('点读卡的两段配音落盘 .cards/2/1.mp3、2.mp3(第 3 张卡是点读)', existsSync(join(assetDir, '1.mp3')) && readFileSync(join(assetDir, '2.mp3'), 'utf8').includes('banana 香蕉'), String(existsSync(assetDir)));
  const kdA = (await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { messages: { job: string; section?: { cards: { kind: string; assets?: string[] }[] } }[] };
  const ka = kdA.messages.find((m) => m.job === jobA)!.section!;
  check('孩子端:点读卡带 assets,别的卡没有;图片卡在', ka.cards[2].kind === 'read' && JSON.stringify(ka.cards[2].assets) === `["2026-09-09.${jobA}.cards/2/1.mp3","2026-09-09.${jobA}.cards/2/2.mp3"]` && !('assets' in ka.cards[0]) && ka.cards[3].kind === 'image', JSON.stringify(ka.cards));
  const seg = await route('GET', `/api/audio/math-tutor/2026-09-09.${jobA}.cards/2/2.mp3`, ctx);
  check('点读段的 mp3 能取;乱路径 404', seg.status === 200 && seg.contentType === 'audio/mpeg' && (await route('GET', `/api/audio/math-tutor/2026-09-09.${jobA}.cards/2/x.mp3`, ctx)).status === 404 && (await route('GET', `/api/audio/math-tutor/2026-09-09.${jobA}.cards/../cotutor.json`, ctx)).status === 404);
  const im = await route('GET', '/api/kid/image?p=vault%2Fpic.png', ctx);
  check('图片:workspace 内的图能取', im.status === 200 && im.contentType === 'image/png' && im.file === join(root, 'vault', 'pic.png'));
  check('图片:越界 / 不是图 / 不存在 / 绝对路径都 404', (await route('GET', '/api/kid/image?p=..%2Fx.png', ctx)).status === 404 && (await route('GET', '/api/kid/image?p=cotutor.json', ctx)).status === 404 && (await route('GET', '/api/kid/image?p=vault%2Fnope.png', ctx)).status === 404 && (await route('GET', `/api/kid/image?p=${encodeURIComponent(join(root, 'vault', 'pic.png'))}`, ctx)).status === 404);

  // ---- 转交自动起一轮:数学老师「## 转交」给 scene-maker → 系统消息进 scene-maker 的索引(转交单:why / refs / 孩子的话 / voice),用它自己的 runtime;到了 scenes.dailyMax 不起,原因进 warnings ----
  now = new Date(2026, 8, 9, 10, 0);
  const cfgNow = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
  (cfgNow.tutors as Record<string, Record<string, unknown>>)['scene-maker'] = { display: '画图老师', avatar: '🎨', enabled: true, hidden: true, runtime: 'fake2', policy: { scenes: { dailyMax: 1 } } };
  writeFileSync(cfgFile, JSON.stringify(cfgNow, null, 2));
  const rh = await post('math-tutor', { text: '这题要画图,转交场景', from: 'kid' });
  const jobH = (rh.json as { job: string }).job;
  await wait('math-tutor');
  for (let i = 0; i < 200 && !ctx.runner.running('scene-maker') && i < 8; i++) await new Promise((r) => setTimeout(r, 25));
  await wait('scene-maker');
  type HMsg = { job: string; handoff?: { to: string } | null; handoffJob?: { tutor: string; job: string } | null; warnings?: string[]; text: string; from: string; runtime?: string; kidText?: string | null; artifacts?: string[]; timing?: Timing; costUsd?: number };
  const dh = (await day('math-tutor', '2026-09-09')).json as { index: { messages: HMsg[] } };
  const mh = dh.index.messages.find((m) => m.job === jobH)!;
  check('转交段解析、自动起了 scene-maker 的一轮', mh.handoff?.to === 'scene-maker' && mh.handoffJob?.tutor === 'scene-maker' && typeof mh.handoffJob.job === 'string' && !mh.warnings?.some((w) => w.includes('转交没起')), JSON.stringify(mh));
  const dsm = (await day('scene-maker', '2026-09-09')).json as { index: { messages: HMsg[] } };
  const sm = dsm.index.messages.find((m) => m.job === mh.handoffJob!.job)!;
  check('scene-maker 收到系统消息:转交单带 why / refs / 孩子的话 / voice,用自己的 runtime,回了「做好了」', sm.from === 'system' && sm.text.startsWith('转交自 数学老师(math-tutor') && sm.text.includes('why: 找规律填数') && sm.text.includes('refs: 2026-09-09-guilv') && sm.text.includes('孩子刚才说的:这题要画图,转交场景') && sm.text.includes('voice: v-math') && sm.runtime === 'fake2' && sm.kidText?.includes('课包 2026-09-09-guilv 做好了') === true, JSON.stringify(sm));
  const { mergeArtifacts, parseArtifactEvents } = await import('../src/lib/ledger.ts');
  const ledger1 = parseArtifactEvents(readFileSync(join(root, 'ledger', 'artifacts.jsonl'), 'utf8'));
  const art1 = mergeArtifacts(ledger1.rows).artifacts.find((a) => a.id === '2026-09-09-guilv');
  check('场景作业收尾:假老师没记账 → 应用补一整行(retired,没有 manifest)带 costUsd / durationMs / source,消息的 artifacts 记 id,warnings 说明', ledger1.errors.length === 0 && art1?.kind === '课包' && art1.by === 'scene-maker' && art1.status === 'retired' && art1.costUsd === 0.05 && typeof art1.durationMs === 'number' && art1.durationMs === sm.timing?.doneMs && art1.source?.conversation === 'scene-maker/2026-09-09' && art1.source.job === sm.job && JSON.stringify(sm.artifacts) === '["2026-09-09-guilv"]' && sm.warnings?.some((w) => w.includes('没往账本记')) === true, JSON.stringify({ art1, errors: ledger1.errors, sm }));
  now = new Date(2026, 8, 9, 10, 5);
  const rh2 = await post('math-tutor', { text: '再画一题,转交场景', from: 'kid' });
  await wait('math-tutor');
  const mh2 = ((await day('math-tutor', '2026-09-09')).json as { index: { messages: HMsg[] } }).index.messages.find((m) => m.job === (rh2.json as { job: string }).job)!;
  check('场景作业到了 dailyMax(1)→ 不起,原因进 warnings', mh2.handoff?.to === 'scene-maker' && mh2.handoffJob === null && mh2.warnings?.some((w) => w.includes('上限 1')) === true, JSON.stringify(mh2));
  now = new Date(2026, 8, 9, 10, 6);
  const rh3 = await post('math-tutor', { text: '转交', from: 'parent' });
  await wait('math-tutor');
  await wait('planner');
  const mh3 = ((await day('math-tutor', '2026-09-09')).json as { index: { messages: HMsg[] } }).index.messages.find((m) => m.job === (rh3.json as { job: string }).job)!;
  check('转交给 planner 也自动起(planner 在表里)', mh3.handoffJob?.tutor === 'planner', JSON.stringify(mh3));
  // 课包 id 撞了:scenes/<id>.ts 已有 → 改成 <id>-2,卡上的 bundle 与转交单的 refs 一起改,warnings 说明
  const cfg3 = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
  ((cfg3.tutors as Record<string, Record<string, unknown>>)['scene-maker'].policy as Record<string, unknown>) = { scenes: { dailyMax: 5 } };
  writeFileSync(cfgFile, JSON.stringify(cfg3, null, 2));
  mkdirSync(join(root, 'scenes'), { recursive: true });
  writeFileSync(join(root, 'scenes', '2026-09-09-guilv.ts'), 'export default {}');
  // 这次让「老师自己记了账」:先写好 ready 行(-2 是必然的 id),应用收尾只该追加费用行,不报没记账
  writeFileSync(join(root, 'ledger', 'artifacts.jsonl'), readFileSync(join(root, 'ledger', 'artifacts.jsonl'), 'utf8') + '{"id":"2026-09-09-guilv-2","at":"2026-09-09T10:08:00","by":"scene-maker","kind":"课包","status":"ready","path":"bundles/2026-09-09-guilv-2"}\n');
  now = new Date(2026, 8, 9, 10, 8);
  const rh4 = await post('math-tutor', { text: '同名的题,转交场景', from: 'kid' });
  await wait('math-tutor');
  await wait('scene-maker');
  type SceneMsg = HMsg & { section?: { cards: { kind: string; props: Record<string, unknown> }[] } | null; handoff?: { to: string; refs: string[] } | null };
  const mh4 = ((await day('math-tutor', '2026-09-09')).json as { index: { messages: SceneMsg[] } }).index.messages.find((m) => m.job === (rh4.json as { job: string }).job)!;
  check('id 撞了 → 卡上 bundle 与 refs 都改成 -2,warnings 说明,作业照起', mh4.section?.cards.find((c) => c.kind === 'scene')?.props.bundle === '2026-09-09-guilv-2' && mh4.handoff?.refs[0] === '2026-09-09-guilv-2' && mh4.warnings?.some((w) => w.includes('已占用')) === true && mh4.handoffJob?.tutor === 'scene-maker', JSON.stringify(mh4));
  const sm4 = ((await day('scene-maker', '2026-09-09')).json as { index: { messages: HMsg[] } }).index.messages.find((m) => m.job === mh4.handoffJob!.job)!;
  check('转交单里的 refs 也是新 id', sm4.text.includes('refs: 2026-09-09-guilv-2'), sm4.text);
  const ledger2 = parseArtifactEvents(readFileSync(join(root, 'ledger', 'artifacts.jsonl'), 'utf8'));
  const rows2 = ledger2.rows.filter((r) => r.id === '2026-09-09-guilv-2');
  const art2 = mergeArtifacts(ledger2.rows).artifacts.find((a) => a.id === '2026-09-09-guilv-2');
  check('老师记了账 → 应用只追加一行费用(没有 kind / status),折叠后 ready + costUsd + durationMs,不报没记账', ledger2.errors.length === 0 && rows2.length === 2 && rows2[1].kind === undefined && rows2[1].status === undefined && rows2[1].costUsd === 0.05 && art2?.status === 'ready' && art2.path === 'bundles/2026-09-09-guilv-2' && art2.costUsd === 0.05 && typeof art2.durationMs === 'number' && JSON.stringify(sm4.artifacts) === '["2026-09-09-guilv-2"]' && !sm4.warnings?.some((w) => w.includes('没往账本记')), JSON.stringify({ rows2, art2, sm4 }));
  check('sceneJobId:refs 优先,没 refs 从收尾句取,都没有 → null', (() => { const R = ctx.runner.constructor as unknown as { sceneJobId: (h: string, f: string | null) => string | null }; return R.sceneJobId('转交自 x\nwhy: y\nrefs: 2026-09-09-guilv-2, 别的', null) === '2026-09-09-guilv-2' && R.sceneJobId('why: 没 refs', '课包 2026-09-10-abc 做好了,6 步') === '2026-09-10-abc' && R.sceneJobId('why: 没 refs', '课包 2026-09-10-abc 没做成:check 过不了') === '2026-09-10-abc' && R.sceneJobId('why: 没', '什么都没说') === null; })());

  // ---- 话题:新话题不 resume 且不带旧卡;缺省接当前话题;指定今天的旧话题 resume 它自己的会话;history / 日期路由;卡的 turn 按话题 ----
  now = new Date(2026, 8, 9, 10, 20);
  type TMsg = { job: string; thread?: string; cards?: unknown[]; kidText?: string | null };
  type TDay = { index: { session: { id: string } | null; sessions: Record<string, { id: string }>; messages: TMsg[] } };
  const before = ((await day('math-tutor', '2026-09-09')).json as TDay).index;
  const oldThread = before.messages[0].job;
  const oldSession = before.session!.id;
  // 旧话题的一张卡先改一下(turn = 旧话题末条),新话题第一条不该带它
  const boardJob = before.messages.find((m) => m.job === jobS2)!.job;
  check('PUT 旧话题的卡', (await route('PUT', `/api/kid/conversations/math-tutor/cards/${boardJob}/1`, ctx, { picked: [0] })).status === 200);
  const rn = await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: '换个话题 板书', newThread: true });
  const newThread = (rn.json as { job: string; thread: string }).thread;
  check('新话题:202,thread = 自己的 job', rn.status === 202 && newThread === (rn.json as { job: string }).job, JSON.stringify(rn.json));
  await wait('math-tutor');
  let dT = ((await day('math-tutor', '2026-09-09')).json as TDay).index;
  const mN = dT.messages.find((m) => m.job === newThread)!;
  const logN = readFileSync(join(root, 'conversations', 'math-tutor', `2026-09-09.${newThread}.log`), 'utf8');
  check('新话题不 resume(假 CLI 新造 session)、不带旧话题的卡;sessions 里两条,顶层 = 新话题的', mN.thread === newThread && mN.cards === undefined && !logN.includes(oldSession) && mN.kidText?.includes('第一次说') === true && dT.sessions[oldThread]?.id === oldSession && dT.sessions[newThread] && dT.sessions[newThread].id !== oldSession && dT.session?.id === dT.sessions[newThread].id, JSON.stringify({ mN, sessions: dT.sessions }));
  const rT2 = await post('math-tutor', { text: '再说一句', from: 'parent' });
  await wait('math-tutor');
  check('缺省接当前(新)话题并 resume 它', (rT2.json as { thread: string; resume: boolean }).thread === newThread && (rT2.json as { resume: boolean }).resume === true);
  const r3 = await post('math-tutor', { text: '回到旧话题', from: 'parent', thread: oldThread });
  const j3 = (r3.json as { job: string; thread: string; resume: boolean });
  await wait('math-tutor');
  dT = ((await day('math-tutor', '2026-09-09')).json as TDay).index;
  const m3 = dT.messages.find((m) => m.job === j3.job)!;
  const log3 = readFileSync(join(root, 'conversations', 'math-tutor', `2026-09-09.${j3.job}.log`), 'utf8');
  check('指定旧话题:resume 旧话题自己的会话,带上旧话题里改过的卡,顶层 session 换回旧的', j3.thread === oldThread && j3.resume === true && log3.includes(oldSession) && m3.thread === oldThread && m3.cards?.length === 1 && m3.kidText?.includes('接着说') === true && dT.session?.id === oldSession, JSON.stringify({ j3, cards: m3.cards, log: log3.slice(0, 200) }));
  check('不存在的话题 → 4xx', (await post('math-tutor', { text: 'x', thread: '0000-9' })).status >= 400 && (await route('POST', '/api/kid/conversations/math-tutor/messages', ctx, { text: 'x', thread: 'bad' })).status === 400);
  const smDay = ((await day('scene-maker', '2026-09-09')).json as TDay).index;
  check('系统消息(转交)每条各开一个话题', smDay.messages.length >= 2 && smDay.messages.every((m) => m.thread === m.job));
  const hist = (await route('GET', '/api/kid/conversations/math-tutor/history?days=30', ctx)).json as { today: string; days: { date: string; threads: { thread: string; title: string; sections: number; cards: number }[] }[] };
  const todayH = hist.days.find((d) => d.date === '2026-09-09')!;
  check('history:按天(新的在前),今天两个话题(新的在前),名字是孩子第一句、节数与卡数', hist.today === '2026-09-09' && hist.days[0].date === '2026-09-09' && hist.days.some((d) => d.date === '2026-09-08') && todayH.threads[0].thread === newThread && todayH.threads[0].title === '换个话题 板书' && todayH.threads[0].sections === 2 && todayH.threads[0].cards === 2 && todayH.threads[1].thread === oldThread && todayH.threads[1].sections > 2, JSON.stringify(hist.days.map((d) => ({ date: d.date, n: d.threads.length, t: d.threads.map((t) => t.title) }))));
  const kdOld = (await route('GET', '/api/kid/conversations/math-tutor/2026-09-08', ctx)).json as { date: string; thread: string | null; messages: { thread: string }[] };
  check('日期路由给那天的孩子视图(带 thread);未来 / 坏日期 400;today 也带 thread', kdOld.date === '2026-09-08' && kdOld.messages.length > 0 && kdOld.messages.every((m) => typeof m.thread === 'string') && kdOld.thread === kdOld.messages[kdOld.messages.length - 1].thread && (await route('GET', '/api/kid/conversations/math-tutor/2027-01-01', ctx)).status === 400 && (await route('GET', '/api/kid/conversations/math-tutor/2026-13-01', ctx)).status === 400 && ((await route('GET', '/api/kid/conversations/math-tutor/today', ctx)).json as { thread: string }).thread === oldThread);

  // ---- 参数校验 ----
  check('空消息 400', (await post('math-tutor', { text: '   ' })).status === 400);
  check('坏 from 400', (await post('math-tutor', { text: 'x', from: 'dog' })).status === 400);
  check('没这位老师 404', (await post('nobody', { text: 'x' })).status === 404);
  check('坏日期 400', (await day('math-tutor', '2026-9-9')).status === 400);

  // ---- 老师团:补丁写回、热重载、关掉老师即消失 ----
  const p1 = await route('PATCH', '/api/config', ctx, { tutors: { 'math-tutor': { enabled: false, policy: { replyMaxChars: 20 } } } });
  check('PATCH 写回并热重载', p1.status === 200 && ctx.ws.config.tutors['math-tutor'].enabled === false, JSON.stringify(p1.json));
  const raw = JSON.parse(readFileSync(cfgFile, 'utf8')) as { tutors: Record<string, { enabled: boolean; display: string; policy: { replyMaxChars: number } }>; _note?: string; runtimes: { default: string } };
  check('文件里只动了那几个字段,_note 与运行时都在', raw.tutors['math-tutor'].enabled === false && raw.tutors['math-tutor'].display === '数学老师' && raw.tutors['math-tutor'].policy.replyMaxChars === 20 && typeof raw._note === 'string' && raw.runtimes.default === 'fake');
  const tutorsNow = (await route('GET', '/api/config', ctx)).json as { tutors: { name: string; enabled: boolean; policy: { replyMaxChars: number } }[] };
  check('接口回报关闭与有效政策', tutorsNow.tutors.find((t) => t.name === 'math-tutor')?.enabled === false && tutorsNow.tutors.find((t) => t.name === 'math-tutor')?.policy.replyMaxChars === 20);
  check('孩子端列表里没了', !((await route('GET', '/api/tutors?kid=1', ctx)).json as { name: string }[]).some((t) => t.name === 'math-tutor'));
  check('关掉的老师不收消息', (await post('math-tutor', { text: 'x' })).status === 400);
  const p2 = await route('PATCH', '/api/config', ctx, { tutors: { 'math-tutor': { display: '' } } });
  check('不合契约的补丁 422 且不落盘', p2.status === 422 && (JSON.parse(readFileSync(cfgFile, 'utf8')) as typeof raw).tutors['math-tutor'].display === '数学老师', JSON.stringify(p2.json));
  check('改运行时模板被拒', (await route('PATCH', '/api/config', ctx, { runtimes: { fake: { run: ['x'], resume: ['x'] } } })).status === 422);
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

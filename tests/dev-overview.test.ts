/** 工作台(《工作台设计.md》):概览的数字从会话索引算对、接口在、页面是侧栏 + 五个标签、三页共用一份色板。 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-dev-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { writeIndex } = await import('../src/server/store.ts');
const { ConversationIndexSchema } = await import('../src/schema/conversation.ts');
const { devOverview, SLOW_FIRST_MS } = await import('../src/server/dev-overview.ts');
const { localDate } = await import('../src/lib/conversation.ts');
const { DEV_PAGE } = await import('../src/server/dev-page.ts');
const { DEV_CSS } = await import('../src/server/dev-theme.ts');

try {
  const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
  const ws = loadWorkspace(root);
  const now = new Date(2026, 9, 16, 15, 50);
  const today = localDate(now);
  const yesterday = localDate(new Date(2026, 9, 15, 12));
  const msg = (job: string, extra: Record<string, unknown>) => ({ job, thread: job, at: `${extra.date ?? today}T${job.slice(0, 2)}:${job.slice(2, 4)}`, from: 'kid', text: '3/4 和 5/8 哪个大?', result: 'ok', runtime: 'qwen', ...extra });
  await writeIndex(ws, ConversationIndexSchema.parse({
    tutor: 'math-tutor',
    date: today,
    messages: [
      msg('1540-1', { tokens: { in: 1000, out: 50 }, timing: { startedAt: 'x', firstReadyMs: 3000, doneMs: 9000 } }),
      msg('1544-2', { thread: '1540-1', tokens: { in: 2000, out: 70 }, timing: { startedAt: 'x', firstReadyMs: SLOW_FIRST_MS + 23_200, doneMs: 44_000 } }),
      msg('1548-3', { thread: '1540-1', from: 'system', text: '记账', tokens: { in: 500, out: 20 } }),
    ],
  }));
  await writeIndex(ws, ConversationIndexSchema.parse({
    tutor: 'chinese-tutor',
    date: yesterday,
    messages: [
      { job: '0930-1', at: `${yesterday}T09:30`, from: 'kid', text: '师是什么意思', result: 'error', error: 'max_wall_time', runtime: 'claude', costUsd: 0.12 },
      { job: '0941-2', at: `${yesterday}T09:41`, from: 'kid', text: '那老呢', result: 'ok', runtime: 'claude', costUsd: 0.05, warnings: ['第 3 行 choice 卡没解析,当讲稿念了'] },
    ],
  }));

  const ov = await devOverview(ws, now);
  check('七天,今天在最后', ov.days.length === 7 && ov.days[6].date === today && ov.days[5].date === yesterday, JSON.stringify(ov.days));
  check('轮只算孩子的话;应用的任务单记', ov.todayTurns === 2 && ov.todayTasks === 1 && ov.days[5].turns === 2, JSON.stringify(ov));
  check('今天:一个话题、最近 15:44、慢的 1 轮', ov.todayThreads === 1 && ov.lastAt === `${today}T15:44` && ov.slow === 1);
  const math = ov.tutors.find((t) => t.name === 'math-tutor');
  const chinese = ov.tutors.find((t) => t.name === 'chinese-tutor');
  check('老师行:今天跑过的记那轮的运行时,没跑过的是配的', math?.turns === 2 && math.runtime === 'qwen' && chinese?.turns === 0 && chinese.runtime === (ws.config.tutors['chinese-tutor'].runtime ?? ws.config.runtimes.default), JSON.stringify(ov.tutors));
  const qwen = ov.usage.find((u) => u.runtime === 'qwen');
  const claude = ov.usage.find((u) => u.runtime === 'claude');
  check('用量按运行时:token 与钱各记各的,记账任务也算', qwen?.turns === 3 && qwen.tokensIn === 3500 && qwen.tokensOut === 140 && Math.abs((claude?.costUsd ?? 0) - 0.17) < 1e-9, JSON.stringify(ov.usage));
  check('要看一眼:新的在前,慢 / 出错 / 提醒各一条', ov.issues.map((i) => i.kind).join(',') === 'slow,warn,error' && ov.issues[0].detail.startsWith('首句就绪 38') && ov.issues[2].detail === 'max_wall_time', JSON.stringify(ov.issues));
  check('最近一轮给「看原文」直达', ov.last?.tutor === 'math-tutor' && ov.last.job === '1544-2');
  check('画图:今天 0 张,上限照 cotutor.json', ov.paint.today === 0 && ov.paint.daily === ws.config.paint.daily);

  const ctx = createContext(ws);
  const r = await route('GET', '/api/dev/overview', ctx);
  check('GET /api/dev/overview 200', r.status === 200 && Array.isArray((r.json as { days: unknown[] }).days));
  const h = (await route('GET', '/api/health', ctx)).json as { started: string; version: string | null };
  check('/api/health 带起服务的时刻与版本', typeof h.started === 'string' && !Number.isNaN(Date.parse(h.started)) && typeof h.version === 'string');
  const c = (await route('GET', '/api/config', ctx)).json as { root: string };
  check('/api/config 带 workspace 根(家目录写成 $HOME)', c.root === '$HOME/cotutor/ming', c.root);
  const dr = await route('POST', '/api/dev/doctor', ctx, {});
  check('POST /api/dev/doctor:不带 --live 的体检', dr.status === 200 && (dr.json as { checks: { name: string }[] }).checks.some((k) => k.name === 'workspace'));

  check('页面:侧栏五个标签,概览打头', ['overview', 'chat', 'team', 'voices', 'settings'].every((t) => DEV_PAGE.includes(`data-tab="${t}"`)) && DEV_PAGE.indexOf('data-tab="overview"') < DEV_PAGE.indexOf('data-tab="chat"') && DEV_PAGE.includes('<aside id="side">'));
  check('工作台页面用共用色板', DEV_PAGE.includes(DEV_CSS));
} finally {
  rmSync(home, { recursive: true, force: true });
}
done();

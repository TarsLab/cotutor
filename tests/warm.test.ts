/**
 * 预热(《工作流程.md》§四「预热」,假 CLI 不花钱):消息走 stdin 的运行时,一轮收尾 / 孩子端与家长端拉今天就起好下一轮的进程,
 * 两个位置:fresh(新开会话)与 resume(页面选着的话题,缺省当天末条的话题);对得上(argv、cwd、日期、这个话题末条)才接过来,
 * 不然杀掉冷起;别的话题说过话不碍事,同一话题被别人写过就不用;断流照旧 resume 冷起;系统轮之后不起;闲置超时杀。
 */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';
import { parseEvents } from '../src/lib/events.ts';
import { addMessage } from '../src/lib/conversation.ts';
import { planRun, stdinMessage } from '../src/lib/run-plan.ts';
import { WarmPool } from '../src/server/warm.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-warm-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace, parseConfig } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { readIndex, writeIndex } = await import('../src/server/store.ts');

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const node = process.execPath;
const base = [node, '--experimental-strip-types', '--no-warnings', FAKE];
const stdinRuntime = (extra: string[] = []) => ({
  stdin: 'stream-json',
  run: [...base, '--agent', '{agent}', ...extra, '--input-format', 'stream-json'],
  resume: [...base, '--agent', '{agent}', '--resume', '{session}', ...extra, '--input-format', 'stream-json'],
});

const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown> & { runtimes: Record<string, unknown> };
cfg.runtimes = { default: 'fake', fake: stdinRuntime() };
cfg.policyDefaults = { stall: { ms: 400, retries: 1 } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const now = new Date(2026, 8, 29, 20, 40);
const DATE = '2026-09-29';
const ctx = createContext(loadWorkspace(root), { now: () => now });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 3000): Promise<boolean> => { for (let t = 0; t < ms && !f(); t += 25) await sleep(25); return f(); };
type Msg = { job: string; thread?: string; result: string; kidText?: string | null; timing?: { warm?: true }; warnings?: string[] };
const send = async (tutor: string, text: string, o: { from?: 'kid' | 'system'; thread?: string; newThread?: boolean } = {}): Promise<Msg> => {
  const r = await route('POST', `/api/conversations/${tutor}/messages`, ctx, { text, from: o.from ?? 'kid', ...(o.thread ? { thread: o.thread } : {}), ...(o.newThread ? { newThread: true } : {}) });
  const job = (r.json as { job: string }).job;
  await until(() => !ctx.runner.running(tutor), 10_000);
  const d = (await route('GET', `/api/conversations/${tutor}/${DATE}`, ctx)).json as { index: { messages: Msg[] } };
  return d.index.messages.find((m) => m.job === job)!;
};
const starts = (tutor: string, job: string) => parseEvents(readFileSync(join(root, 'conversations', tutor, `${DATE}.${job}.events.jsonl`), 'utf8')).filter((e) => e.kind === 'start' && e.lane === 'main') as { resume: boolean; warmMs?: number }[];
const initOf = (tutor: string, job: string) => JSON.parse(readFileSync(join(root, 'conversations', tutor, `${DATE}.${job}.log`), 'utf8').split('\n')[0]) as { waitedMs?: number };
const warmUsed = (tutor: string, m: Msg): boolean => starts(tutor, m.job)[0]?.warmMs !== undefined && m.timing?.warm === true;
const both = (tutor: string): Promise<boolean> => until(() => ctx.runner.spares.has(tutor, 'fresh') && ctx.runner.spares.has(tutor, 'resume'));

try {
  // 契约:stdin 运行时不写 {prompt}、要带 --input-format stream-json;planRun 把消息放进 stdin 那一行
  {
    let bad = '';
    try {
      parseConfig({ ...cfg, runtimes: { default: 'fake', fake: { ...stdinRuntime(), run: [...base, '{prompt}'] } } }, 'x');
    } catch (e) {
      bad = (e as Error).message;
    }
    check('stdin 运行时模板写了 {prompt} / 没带 --input-format → 配置报错', bad.includes('--input-format stream-json'), bad);
    const plan = planRun(ctx.ws.config, { session: null }, { agent: 'math-tutor', prompt: '上下文包\n---\n你好' });
    check('planRun:消息不在 argv、在 stdin 那一行', !plan.argv.some((a) => a.includes('你好')) && plan.stdin === stdinMessage('上下文包\n---\n你好') && JSON.parse(plan.stdin!).message.content === '上下文包\n---\n你好');
  }

  // 孩子端 · 英语老师
  let t1 = '';
  {
    // 今天还没说过:拉今天只起 fresh(没有话题可 resume)
    await route('GET', '/api/kid/conversations/english-tutor/today', ctx);
    check('孩子拉今天:起了 fresh,没有 resume', (await until(() => ctx.runner.spares.has('english-tutor', 'fresh'))) && !ctx.runner.spares.has('english-tutor', 'resume'));
    await sleep(300);
    const m = await send('english-tutor', '苹果怎么说');
    t1 = m.thread ?? '';
    const s = starts('english-tutor', m.job);
    check('第一句:用 fresh(新会话)', m.result === 'ok' && m.kidText?.endsWith('第一次说:苹果怎么说') === true && s.length === 1 && !s[0].resume && (s[0].warmMs ?? 0) >= 300, JSON.stringify([m, s]));
    check('第一句:timing.warm、假 CLI 起来后等了 200ms 以上才收到消息', m.timing?.warm === true && (initOf('english-tutor', m.job).waitedMs ?? 0) >= 200, JSON.stringify([m.timing, initOf('english-tutor', m.job)]));
    check('这轮收尾两个位置都补齐', await both('english-tutor'));
    const m2 = await send('english-tutor', '香蕉呢');
    const s2 = starts('english-tutor', m2.job);
    check('第二句:用 resume,同一会话', m2.kidText?.endsWith('接着说:香蕉呢') === true && s2.length === 1 && s2[0].resume && warmUsed('english-tutor', m2), JSON.stringify([m2.kidText, s2]));
    // 新话题(首页新话题按钮 / 家长新话题):fresh 接
    await both('english-tutor');
    const m3 = await send('english-tutor', '换个话题', { newThread: true });
    check('新话题:用 fresh', m3.thread !== t1 && m3.kidText?.endsWith('第一次说:换个话题') === true && !starts('english-tutor', m3.job)[0].resume && warmUsed('english-tutor', m3), JSON.stringify(m3));
    // 切回头一个话题:页面拉今天带 ?thread=,resume 换成那个话题的
    await both('english-tutor');
    ctx.runner.spares.drop('english-tutor', 'resume');
    await route('GET', `/api/kid/conversations/english-tutor/today?thread=${t1}`, ctx);
    check('带 ?thread= 拉今天:resume 起了', await until(() => ctx.runner.spares.has('english-tutor', 'resume')));
    const m4 = await send('english-tutor', '回到苹果', { thread: t1 });
    check('切回的话题:用 resume,接的是那个话题的会话', m4.thread === t1 && m4.kidText?.endsWith('接着说:回到苹果') === true && starts('english-tutor', m4.job)[0].resume && warmUsed('english-tutor', m4), JSON.stringify(m4));
    // 同一话题 30 秒内再拉今天不再看(页面轮询)
    await both('english-tutor');
    ctx.runner.spares.drop('english-tutor');
    await route('GET', `/api/kid/conversations/english-tutor/today?thread=${t1}`, ctx);
    check('同一话题拉今天有节流', !(await until(() => ctx.runner.spares.has('english-tutor'), 300)));
  }

  // 数学老师:家长端看板书不预热(只看,不发);孩子端点进来才预热;别的话题说过话不碍事;同一话题被别人写过就不用;断流照旧
  {
    await route('GET', '/api/conversations/math-tutor/today/board', ctx);
    check('家长端看板书:不起备用进程', !(await until(() => ctx.runner.spares.has('math-tutor'), 300)));
    await route('GET', '/api/kid/conversations/math-tutor/today', ctx);
    check('孩子端拉今天:起了 fresh', await until(() => ctx.runner.spares.has('math-tutor', 'fresh')));
    const m = await send('math-tutor', '你好');
    const m1 = m.thread ?? '';
    check('第一句:用 fresh', m.result === 'ok' && warmUsed('math-tutor', m), JSON.stringify(m));
    check('这轮收尾两个位置都补齐', await both('math-tutor'));
    // 系统轮开新话题:用 fresh;resume(话题 m1)不动;系统轮之后不补
    const sys = await send('math-tutor', '系统说', { from: 'system' });
    check('系统轮:用 fresh,之后不补 fresh', sys.result === 'ok' && sys.thread !== m1 && warmUsed('math-tutor', sys) && !(await until(() => ctx.runner.spares.has('math-tutor', 'fresh'), 400)), JSON.stringify(sys));
    check('系统轮在别的话题:m1 的 resume 还在', ctx.runner.spares.has('math-tutor', 'resume'));
    const back = await send('math-tutor', '接着讲', { thread: m1 });
    check('别的话题说过话:m1 的 resume 照样用上', back.thread === m1 && back.kidText?.endsWith('接着说:接着讲') === true && warmUsed('math-tutor', back), JSON.stringify(back));
    // 同一话题被别的进程写过(比如另开的 cotutor send):索引里 m1 多了一条,resume 对不上,冷起
    await both('math-tutor');
    const idx = await readIndex(ctx.ws, 'math-tutor', DATE);
    await writeIndex(ctx.ws, addMessage(idx, { job: '2359-99', thread: m1, at: `${DATE}T23:59`, from: 'kid', text: '别处写的', result: 'ok', artifacts: [] }));
    const stale = await send('math-tutor', '再讲一遍', { thread: m1 });
    check('同一话题被别人写过:不用旧的,冷起', stale.result === 'ok' && starts('math-tutor', stale.job)[0].warmMs === undefined, JSON.stringify(stale));
    // 预热的那次断流:杀掉、resume 冷起接着写
    check('断流前 resume 已补上', await both('math-tutor'));
    const st = await send('math-tutor', '断流', { thread: m1 });
    const ss = starts('math-tutor', st.job);
    check('预热进程断流:半截拼回、resume 冷起接上', st.result === 'ok' && st.kidText === '断流前这句。\n半截句话接上了。' && ss.length === 2 && ss[0].warmMs !== undefined && ss[1].resume && ss[1].warmMs === undefined, JSON.stringify([st, ss]));
  }

  // cotutor.json 热重载改了模板:旧的备用进程对不上,冷起
  {
    check('改配置之前有备用进程', await both('math-tutor'));
    await sleep(20);
    cfg.runtimes = { default: 'fake', fake: stdinRuntime(['--model', 'haiku']) };
    writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
    const m = await send('math-tutor', '改了配置');
    check('改了模板:不用旧的,冷起', m.result === 'ok' && starts('math-tutor', m.job)[0].warmMs === undefined, JSON.stringify(m));
  }

  // 池子本身:两个位置各管各的;对不上杀掉;闲置超时杀掉;退了的不交
  {
    const pool = new WarmPool({ idleMs: 200 });
    const key = { argv: [node, '-e', 'process.stdin.resume()'], cwd: root, date: DATE, lastJob: '2040-1' };
    pool.warm('t', 'resume', key, process.env);
    pool.warm('t', 'fresh', { ...key, lastJob: null }, process.env);
    check('resume 末条 job 对不上:不交、只杀这个位置', pool.claim('t', 'resume', { ...key, lastJob: '2041-2' }) === null && !pool.has('t', 'resume') && pool.has('t', 'fresh'));
    check('闲置超时杀掉', await until(() => !pool.has('t'), 1500));
    pool.warm('t', 'fresh', { ...key, argv: [node, '-e', ''] }, process.env);
    await sleep(500);
    check('自己退了的不交', pool.claim('t', 'fresh', { ...key, argv: [node, '-e', ''] }) === null);
    pool.warm('t', 'resume', key, process.env);
    const ok = pool.claim('t', 'resume', key);
    check('对得上:交出去,池子里没了', ok !== null && !pool.has('t') && ok.closed() === false);
    ok?.child.stdin?.end();
    ok?.child.stdout?.resume();
    check('交出去的进程关 stdin 就退', await until(() => ok?.closed() === true));
    pool.dropAll();
  }
} finally {
  ctx.runner.close();
  await ctx.runner.flush();
}
done();

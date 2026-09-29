/**
 * 预热(《工作流程.md》§四「预热」,假 CLI 不花钱):消息走 stdin 的运行时,一轮收尾 / 孩子端拉今天就起好下一轮的进程;
 * 对得上(argv、cwd、日期、索引末条)才接过来,不然杀掉冷起;断流照旧 resume 冷起;系统轮不用也不起;闲置超时杀。
 */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';
import { parseEvents } from '../src/lib/events.ts';
import { planRun, stdinMessage } from '../src/lib/run-plan.ts';
import { WarmPool } from '../src/server/warm.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-warm-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace, parseConfig } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');

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
cfg.policyDefaults = { post: { mode: 'off' }, stall: { ms: 400, retries: 1 } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const now = new Date(2026, 8, 29, 20, 40);
const DATE = '2026-09-29';
const ctx = createContext(loadWorkspace(root), { now: () => now });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 3000): Promise<boolean> => { for (let t = 0; t < ms && !f(); t += 25) await sleep(25); return f(); };
type Msg = { job: string; result: string; kidText?: string | null; timing?: { warm?: true }; warnings?: string[] };
const send = async (tutor: string, text: string, from: 'kid' | 'system' = 'kid'): Promise<Msg> => {
  const r = await route('POST', `/api/conversations/${tutor}/messages`, ctx, { text, from });
  const job = (r.json as { job: string }).job;
  await until(() => !ctx.runner.running(tutor), 10_000);
  const d = (await route('GET', `/api/conversations/${tutor}/${DATE}`, ctx)).json as { index: { messages: Msg[] } };
  return d.index.messages.find((m) => m.job === job)!;
};
const starts = (tutor: string, job: string) => parseEvents(readFileSync(join(root, 'conversations', tutor, `${DATE}.${job}.events.jsonl`), 'utf8')).filter((e) => e.kind === 'start' && e.lane === 'main') as { resume: boolean; warmMs?: number }[];
const initOf = (tutor: string, job: string) => JSON.parse(readFileSync(join(root, 'conversations', tutor, `${DATE}.${job}.log`), 'utf8').split('\n')[0]) as { waitedMs?: number };

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

  // 孩子点进英语老师(今天还没说过):拉今天就起一个新开的备用进程;第一句用上它
  {
    await route('GET', '/api/kid/conversations/english-tutor/today', ctx);
    check('拉今天:起了备用进程', await until(() => ctx.runner.spares.has('english-tutor')));
    await sleep(300);
    const m = await send('english-tutor', '苹果怎么说');
    const s = starts('english-tutor', m.job);
    check('第一句:用的预热进程(新会话)', m.result === 'ok' && m.kidText?.endsWith('第一次说:苹果怎么说') === true && s.length === 1 && !s[0].resume && (s[0].warmMs ?? 0) >= 300, JSON.stringify([m, s]));
    check('第一句:timing.warm、假 CLI 起来后等了 200ms 以上才收到消息', m.timing?.warm === true && (initOf('english-tutor', m.job).waitedMs ?? 0) >= 200, JSON.stringify([m.timing, initOf('english-tutor', m.job)]));
    check('这轮收尾就起好下一轮', await until(() => ctx.runner.spares.has('english-tutor')));
    const m2 = await send('english-tutor', '香蕉呢');
    const s2 = starts('english-tutor', m2.job);
    check('第二句:预热进程 resume 同一会话', m2.kidText?.endsWith('接着说:香蕉呢') === true && s2.length === 1 && s2[0].resume && s2[0].warmMs !== undefined && m2.timing?.warm === true, JSON.stringify([m2.kidText, s2]));
    // 30 秒内再拉今天不再看(页面轮询)
    ctx.runner.spares.drop('english-tutor');
    await route('GET', '/api/kid/conversations/english-tutor/today', ctx);
    check('拉今天有节流', !(await until(() => ctx.runner.spares.has('english-tutor'), 300)));
  }

  // 数学老师:没预热过 → 冷起;之后预热的那次断流 → 杀掉、resume 冷起接着写
  {
    const m = await send('math-tutor', '你好');
    const s = starts('math-tutor', m.job);
    check('没预热:冷起,消息照样走 stdin', m.result === 'ok' && m.kidText?.endsWith('第一次说:你好') === true && s[0].warmMs === undefined && m.timing?.warm === undefined, JSON.stringify([m, s]));
    check('冷起的也起好下一轮', await until(() => ctx.runner.spares.has('math-tutor')));
    const st = await send('math-tutor', '断流');
    const ss = starts('math-tutor', st.job);
    check('预热进程断流:半截拼回、resume 冷起接上', st.result === 'ok' && st.kidText === '断流前这句。\n半截句话接上了。' && ss.length === 2 && ss[0].warmMs !== undefined && ss[1].resume && ss[1].warmMs === undefined, JSON.stringify([st, ss]));
  }

  // 系统轮(新话题、新会话):argv 对不上,备用进程杀掉;系统轮之后不起
  {
    check('系统轮之前有备用进程', await until(() => ctx.runner.spares.has('math-tutor')));
    const m = await send('math-tutor', '系统说', 'system');
    check('系统轮:冷起,备用进程没了,之后也不起', m.result === 'ok' && starts('math-tutor', m.job)[0].warmMs === undefined && !(await until(() => ctx.runner.spares.has('math-tutor'), 500)), JSON.stringify(m));
  }

  // cotutor.json 热重载改了模板:旧的备用进程对不上,冷起
  {
    await ctx.runner.prewarm('math-tutor');
    check('改配置之前有备用进程', ctx.runner.spares.has('math-tutor'));
    await sleep(20);
    cfg.runtimes = { default: 'fake', fake: stdinRuntime(['--model', 'haiku']) };
    writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
    const m = await send('math-tutor', '改了配置');
    check('改了模板:不用旧的,冷起', m.result === 'ok' && starts('math-tutor', m.job)[0].warmMs === undefined, JSON.stringify(m));
  }

  // 池子本身:对不上(比如索引末条变了——会话被别的进程写过)杀掉;闲置超时杀掉;退了的不交
  {
    const pool = new WarmPool({ idleMs: 200 });
    const key = { argv: [node, '-e', 'process.stdin.resume()'], cwd: root, date: DATE, lastJob: '2040-1' };
    pool.warm('t', key, process.env);
    const claimed = pool.claim('t', { ...key, lastJob: '2041-2' });
    check('末条 job 对不上:不交、池子里也没了', claimed === null && !pool.has('t'));
    pool.warm('t', key, process.env);
    check('闲置超时杀掉', pool.has('t') && (await until(() => !pool.has('t'), 1500)));
    pool.warm('t', { ...key, argv: [node, '-e', ''] }, process.env);
    await sleep(500);
    check('自己退了的不交', pool.claim('t', { ...key, argv: [node, '-e', ''] }) === null);
    pool.warm('t', key, process.env);
    const ok = pool.claim('t', key);
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

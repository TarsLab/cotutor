/**
 * 断流看门狗(policy.stall,假 CLI 不花钱):进程吐了半句就不吭声 → 杀掉、resume 同一会话接着写,半句拼回正文;
 * 工具在跑时的静默不算;次数用完这轮按出错收尾;stall.ms = 0 关掉。
 */
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';
import { parseEvents } from '../src/lib/events.ts';
import { stallPrompt } from '../src/lib/run-plan.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-stall-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { resolvePolicy } = await import('../src/schema/index.ts');

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const node = process.execPath;
const base = [node, '--experimental-strip-types', '--no-warnings', FAKE];

const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
cfg.runtimes = { default: 'fake', fake: { run: [...base, '--agent', '{agent}', '{prompt}'], resume: [...base, '--agent', '{agent}', '--resume', '{session}', '{prompt}'] } };
cfg.policyDefaults = { post: { mode: 'off' }, stall: { ms: 400, retries: 1 } };
(cfg.tutors as Record<string, Record<string, unknown>>)['chinese-tutor'].policy = { stall: { ms: 0 } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const now = new Date(2026, 8, 21, 19, 52);
const ctx = createContext(loadWorkspace(root), { now: () => now });
type Msg = { job: string; result: string; kidText?: string | null; warnings?: string[]; error?: string | null };
const send = async (tutor: string, text: string): Promise<Msg> => {
  const r = await route('POST', `/api/conversations/${tutor}/messages`, ctx, { text, from: 'kid' });
  const job = (r.json as { job: string }).job;
  for (let i = 0; i < 400 && ctx.runner.running(tutor); i++) await new Promise((res) => setTimeout(res, 25));
  const d = (await route('GET', `/api/conversations/${tutor}/2026-09-21`, ctx)).json as { index: { messages: Msg[] } };
  return d.index.messages.find((m) => m.job === job)!;
};
const events = (tutor: string, job: string) => parseEvents(readFileSync(join(root, 'conversations', tutor, `2026-09-21.${job}.events.jsonl`), 'utf8'));

try {
  check('缺省 30 秒、接着跑 2 次', JSON.stringify(resolvePolicy({ ...ctx.ws.config, policyDefaults: {} }, 'math-tutor').stall) === '{"ms":30000,"retries":2}');
  check('老师条目能盖', resolvePolicy(ctx.ws.config, 'chinese-tutor').stall.ms === 0 && resolvePolicy(ctx.ws.config, 'chinese-tutor').stall.retries === 1);
  check('接着跑的消息带着半截', stallPrompt('半截').includes('<<<\n半截\n>>>') && !stallPrompt('').includes('<<<'));

  // 断一次:吐「断流前这句。\n半截」后挂住 → 杀 → resume 同会话接上「句话接上了。」
  {
    const t0 = Date.now();
    const m = await send('math-tutor', '断流');
    check('断一次:收尾成功', m.result === 'ok', JSON.stringify(m));
    check('断一次:半截拼回正文', m.kidText === '断流前这句。\n半截句话接上了。', JSON.stringify(m.kidText));
    check('断一次:家长看得到提醒', (m.warnings ?? []).some((w) => w.includes('API 流断了 1 次')), JSON.stringify(m.warnings));
    check('断一次:没等到 CLI 自己的 180 秒', Date.now() - t0 < 5000, String(Date.now() - t0));
    const es = events('math-tutor', m.job);
    const stall = es.find((e) => e.kind === 'stall') as { retry: number; kept: number } | undefined;
    check('断一次:事件 stall retry 1、已写 9 字(含换行)', stall?.retry === 1 && stall.kept === 9, JSON.stringify(stall));
    const starts = es.filter((e) => e.kind === 'start') as { resume: boolean }[];
    check('断一次:第二次起是 resume', starts.length === 2 && !starts[0].resume && starts[1].resume, JSON.stringify(starts));
  }
  // 工具在跑时静默 1 秒(> 400ms)不算断流
  {
    const m = await send('math-tutor', '工具慢');
    check('工具慢:不杀', m.result === 'ok' && !events('math-tutor', m.job).some((e) => e.kind === 'stall'), JSON.stringify(m));
  }
  // 起就卡:init 吐了会话 id 但模型没回过 → 不 resume(会话不在盘上),原样从头再起
  {
    const m = await send('english-tutor', '起就卡');
    const starts = events('english-tutor', m.job).filter((e) => e.kind === 'start') as { resume: boolean }[];
    check('起就卡:从头再起、成了', m.result === 'ok' && m.kidText === '第一次说:起就卡' && starts.length === 2 && !starts[1].resume, JSON.stringify([m.result, m.kidText, starts]));
  }
  // 一直断:接着跑 1 次还断 → 出错收尾
  {
    const m = await send('english-tutor', '一直断');
    const stalls = events('english-tutor', m.job).filter((e) => e.kind === 'stall') as { retry: number }[];
    check('一直断:出错', m.result === 'error', JSON.stringify(m));
    check('一直断:断两次,第二次 retry 0', stalls.length === 2 && stalls[0].retry === 1 && stalls[1].retry === 0, JSON.stringify(stalls));
    check('一直断:提醒写着次数用完', (m.warnings ?? []).some((w) => w.includes('次数用完')), JSON.stringify(m.warnings));
  }
} finally {
  // 挂住的假 CLI 已被 SIGTERM;chinese-tutor 的 ms = 0 只查了政策,不起进程
}
done();

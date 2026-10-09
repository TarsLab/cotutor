/**
 * qwen 适配器走完整条路(《agent层设计.md》拍板 15,假 CLI 的 qwen 方言,不花钱):
 * 隔离的家(QWEN_HOME 与思考量配置按 effort 选)、key 从环境或本机 ~/.qwen/settings.json 来且不落盘、别处的 OPENAI_MODEL 去掉、
 * 孩子的话工具表为空 / 系统轮只读三样、多出来的工具记提醒、没有钱数记 token、超时退出不吐 result 当出错、旧出厂模板 upgrade 整份换新。
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-qwen-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;
process.env.DASHSCOPE_API_KEY = 'sk-from-env';
process.env.OPENAI_MODEL = 'gpt-x';

const { initWorkspace } = await import('../src/cli/init.ts');
const { loadWorkspace } = await import('../src/cli/workspace.ts');
const { createContext, route } = await import('../src/server/app.ts');
const { configGaps } = await import('../src/cli/migrate.ts');
const { qwen } = await import('../src/clis/qwen.ts');

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const flags = ['--system-prompt', '{systemBody}', '--input-format', 'stream-json', '--output-format', 'stream-json', '--approval-mode', 'default', '{toolArgs}', '--max-wall-time', '10m'];
const base = [process.execPath, '--experimental-strip-types', '--no-warnings', FAKE];

const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown> & { runtimes: Record<string, unknown> };
const factoryQwen = cfg.runtimes.qwen;
cfg.runtimes = { default: 'fakeqwen', fakeqwen: { cli: 'qwen', stdin: 'stream-json', run: [...base, ...flags], resume: [...base, '--resume', '{session}', ...flags] } };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

const now = new Date(2026, 9, 9, 20, 0);
const DATE = '2026-10-09';
const ctx = createContext(loadWorkspace(root), { now: () => now, warm: false });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 10_000): Promise<boolean> => { for (let t = 0; t < ms && !f(); t += 25) await sleep(25); return f(); };
type Msg = { job: string; result: string; error?: string | null; costUsd?: number; tokens?: { in: number; out: number }; warnings?: string[] };
const send = async (tutor: string, text: string, from: 'kid' | 'system' = 'kid'): Promise<Msg> => {
  const r = await route('POST', `/api/conversations/${tutor}/messages`, ctx, { text, from, newThread: true });
  const job = (r.json as { job: string }).job;
  await until(() => !ctx.runner.running(tutor));
  const d = (await route('GET', `/api/conversations/${tutor}/${DATE}`, ctx)).json as { index: { messages: Msg[] } };
  return d.index.messages.find((m) => m.job === job)!;
};
const init = (tutor: string, job: string) => JSON.parse(readFileSync(join(root, 'conversations', tutor, `${DATE}.${job}.log`), 'utf8').split('\n')[0]) as { tools: string[]; qwenHome?: string; effortFile?: string; key: boolean; openai: boolean };

try {
  const kid = await send('chinese-tutor', '大海怎么写');
  const i1 = init('chinese-tutor', kid.job);
  check('孩子的话:跑完、工具表为空、没有工具的提醒', kid.result === 'ok' && i1.tools.length === 0 && !(kid.warnings ?? []).some((w) => w.includes('工具')), JSON.stringify({ kid, i1 }));
  check('隔离的家:QWEN_HOME 在 workspace 的 .cotutor/qwen/home', i1.qwenHome === join(root, '.cotutor', 'qwen', 'home'));
  const settings = readFileSync(join(root, '.cotutor', 'qwen', 'home', 'settings.json'), 'utf8');
  check('家里的 settings.json:关了它自己的记忆整理与使用统计,只写 key 的环境变量名', settings.includes('"enableManagedAutoMemory": false') && settings.includes('"usageStatisticsEnabled": false') && settings.includes('"envKey": "DASHSCOPE_API_KEY"') && !settings.includes('sk-'));
  check('思考量:语文老师 effort low → 不想(effort-none.json)', i1.effortFile === join(root, '.cotutor', 'qwen', 'effort-none.json') && readFileSync(i1.effortFile!, 'utf8').includes('"reasoningEffort": "none"'));
  check('key 从环境来;别处的 OPENAI_MODEL 去掉', i1.key && !i1.openai);
  check('没有钱数,记 token(输入含缓存读)', kid.costUsd === undefined && kid.tokens?.in === 2500 && kid.tokens?.out === 120, JSON.stringify(kid));

  const sys = await send('math-tutor', '给家长写一句', 'system');
  const i2 = init('math-tutor', sys.job);
  check('系统轮:只读三样;数学老师 effort medium → effort-low.json', sys.result === 'ok' && i2.tools.join(',') === 'read_file,glob,grep_search' && i2.effortFile === join(root, '.cotutor', 'qwen', 'effort-low.json'), JSON.stringify(i2));

  process.env.FAKE_QWEN_LEAK = 'run_shell_command';
  const leak = await send('chinese-tutor', '再问一个');
  delete process.env.FAKE_QWEN_LEAK;
  check('关不掉的工具:这轮照跑,记一条提醒', leak.result === 'ok' && (leak.warnings ?? []).some((w) => w.includes('run_shell_command') && w.includes('不该有的工具')), JSON.stringify(leak.warnings));

  const slow = await send('chinese-tutor', '这次会超时');
  check('超时退出(55)不吐 result:当出错', slow.result === 'error' && (slow.error ?? '').includes('55'), JSON.stringify(slow));

  delete process.env.DASHSCOPE_API_KEY;
  mkdirSync(join(home, '.qwen'), { recursive: true });
  writeFileSync(join(home, '.qwen', 'settings.json'), JSON.stringify({ env: { DASHSCOPE_API_KEY: 'sk-from-qwen' } }));
  const local = await send('chinese-tutor', '没有环境变量');
  check('环境里没有 key:从本机 ~/.qwen/settings.json 现读,只进子进程', init('chinese-tutor', local.job).key && !readFileSync(join(root, '.cotutor', 'qwen', 'home', 'settings.json'), 'utf8').includes('sk-from-qwen'));
} finally {
  ctx.runner.close();
}

{
  const old = qwen.retired!.qwen[1];
  const raw = (rt: Record<string, unknown>): Record<string, unknown> => ({ version: 1, kid: { slug: 'ming' }, tutors: {}, runtimes: { default: 'qwen', ...rt } });
  const g = (await configGaps(raw({ qwen: { run: [...old.run], resume: [...old.resume] } }))).find((x) => x.path === 'runtimes.qwen');
  check('upgrade --config:没人改过的旧 qwen 模板整份换成新的', g?.kind === 'runtime' && JSON.stringify(g.value) === JSON.stringify(factoryQwen), JSON.stringify(g));
  const last = qwen.retired!.qwen.at(-1)!;
  const g2 = (await configGaps(raw({ qwen: { stdin: 'stream-json', run: [...last.run], resume: [...last.resume] } }))).find((x) => x.path === 'runtimes.qwen');
  check('upgrade --config:没改过的上一版(qwen3.7-plus)也整份换成新的(qwen3.8-max)', g2?.kind === 'runtime' && JSON.stringify(g2.value) === JSON.stringify(factoryQwen) && (g2.value as { run: string[] }).run.includes('qwen3.8-max'), JSON.stringify(g2));
  const mine = raw({ qwen: { run: [...old.run, '-m', 'qwen3.8-max'], resume: [...old.resume] } });
  check('改过的旧模板不动,也不往里插旗标', !(await configGaps(mine)).some((x) => x.path.startsWith('runtimes.qwen')));
}

done();

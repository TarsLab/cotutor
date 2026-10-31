/**
 * 自动记账(《vault重构方案》§5,2026-10-30):开关缺省关;今天的话题空闲 2 小时才记、不整理记忆;昨天的第二天补上并整理一次;
 * 前天及更早的不管;记账没成的一个话题最多试两次;孩子问:老师挑的(asked)核对过才用,没挑或都对不上由应用筛掉碎句。假 CLI,不花钱。
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-autobk-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext } = await import('../src/app/http/app.ts');
const { autoBookkeep, dueBookkeeping } = await import('../src/runtime/auto-bookkeep.ts');
const { readIndex } = await import('../src/runtime/journal/store.ts');

const FAKE = fileURLToPath(new URL('./_fake-cli.ts', import.meta.url));
const node = process.execPath;
const cli = [node, '--experimental-strip-types', '--no-warnings', FAKE, '--tools', '{tools}', '--agent', '{agent}'];
const { root } = await initWorkspace({ slug: 'ming', name: '小明' });
const cfgFile = join(root, 'cotutor.json');
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8')) as Record<string, unknown>;
cfg.runtimes = { default: 'fake', fake: { run: [...cli, '{prompt}'], resume: [...cli, '--resume', '{session}', '{prompt}'] } };
for (const t of Object.values(cfg.tutors as Record<string, { runtime?: string }>)) delete t.runtime;
cfg.paths = { vault: 'vault' };
writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
mkdirSync(join(root, 'vault', '记忆'), { recursive: true });

let now = new Date(2026, 9, 26, 10, 0);
const ctx = createContext(loadWorkspace(root), { now: () => now, warm: false });
const at = (d: number, h: number, m = 0): Date => new Date(2026, 9, d, h, m);
/** 孩子说一句(新话题或接着 thread),跑完;now 往后走一分钟 */
const say = async (text: string, thread?: string): Promise<string> => {
  const s = await ctx.runner.send('math-tutor', { from: 'kid', text, ...(thread ? { thread } : { newThread: true }) });
  await s.done;
  now = new Date(now.getTime() + 60_000);
  return s.job;
};
const tick = (): ReturnType<typeof autoBookkeep> => autoBookkeep(ctx.runner, ctx.ws, now);
const diary = (date: string): string => { try { return readFileSync(join(root, 'vault', '日记', `${date}.md`), 'utf8'); } catch { return ''; } };
const enable = async (on: boolean): Promise<void> => {
  writeFileSync(cfgFile, JSON.stringify({ ...cfg, vault: { keepScore: 4, autoBookkeep: on } }, null, 2));
  await ctx.reload();
};

try {
  // ---- 前天的话题:开关打开以后也不补(要记家长点「记账」) ----
  const old = await say('很早以前的话题');

  // ---- 10-28 下午:两个话题 ----
  now = at(28, 16, 0);
  const a = await say('宇宙怎么写');
  for (const t of ['嗯', '语文老师。', '宇宙怎么写', '老师把宇宙给画出来']) await say(t, a);
  now = at(28, 16, 10);
  const b = await say('三角形有几个角');

  check('开关缺省关:到了时候也不记', ctx.ws.config.vault.autoBookkeep === false && (now = at(28, 19, 0), (await tick()).length === 0) && !diary('2026-10-28'));
  await enable(true);
  const i0 = await readIndex(ctx.ws, 'math-tutor', '2026-10-28');
  check('今天的:空闲不到 2 小时不记;过了才记', dueBookkeeping(i0, { now: at(28, 17, 0), past: false }).threads.length === 0 && dueBookkeeping(i0, { now: at(28, 18, 30), past: false }).threads.join() === `${a},${b}` && !dueBookkeeping(i0, { now: at(28, 18, 30), past: false }).tidy);
  // 换过运行时:话题 a 的会话是别的运行时的,接不上那时的对话,不记(也不算一次没成)
  const rtNow = i0.sessions[b].runtime;
  const switched = { ...i0, sessions: { ...i0.sessions, [a]: { ...i0.sessions[a], runtime: 'old-cli' } } };
  check('换过运行时的话题不自动记;同一运行时的照记', dueBookkeeping(switched, { now: at(28, 18, 30), past: false, runtime: rtNow }).threads.join() === b && dueBookkeeping(i0, { now: at(28, 18, 30), past: false, runtime: rtNow }).threads.join() === `${a},${b}`, JSON.stringify({ rtNow, a: i0.sessions[a] }));

  // 老师挑了两句孩子问:话题 a 里一句对得上、一句孩子没说过;话题 b 里两句都对不上
  process.env.FAKE_BOOKKEEP_ASKED = '宇宙怎么写|孩子没说过这句';
  now = at(28, 18, 30);
  const r1 = await tick();
  delete process.env.FAKE_BOOKKEEP_ASKED;
  const i1 = await readIndex(ctx.ws, 'math-tutor', '2026-10-28');
  const d1 = diary('2026-10-28');
  const blockA = d1.slice(0, d1.indexOf('\n## ', 1) + 1);
  check('到点了:两个话题都记了,今天的不整理记忆', r1.length === 1 && r1[0].threads.join() === `${a},${b}` && !r1[0].tidied && i1.booked[a] && i1.booked[b] && !i1.messages.some((m) => m.tidy), JSON.stringify(r1));
  check('孩子问:老师挑的对上了就用它(只留对上的那句),碎句不进', blockA.includes('> [!question] 孩子问\n> 宇宙怎么写\n') && !blockA.includes('孩子没说过') && !blockA.includes('> 嗯') && !blockA.includes('语文老师。'), blockA);
  check('老师挑的孩子没说过:进提醒;都对不上的话题由应用从孩子的话里筛', i1.messages.find((m) => m.bookkeep?.thread === a)?.warnings?.some((w) => w.includes('孩子没说过') && w.includes('孩子没说过这句')) === true && d1.includes('> [!question] 孩子问\n> 三角形有几个角\n'), d1);
  check('记过的不再记', (await tick()).length === 0);

  // ---- 没挑孩子问:应用筛,去掉语气词与称呼后不到四个字的、重复的不要 ----
  now = at(28, 18, 40);
  const c = await say('嗯');
  for (const t of ['语文老师。', '宇宙', '画一幅图', '画 一幅图!']) await say(t, c);
  now = at(28, 21, 0);
  await tick();
  const d2 = diary('2026-10-28');
  const blockC = d2.slice(d2.lastIndexOf('## 数学'));
  check('应用筛的孩子问:只剩「画一幅图」一句', blockC.includes('> [!question] 孩子问\n> 画一幅图\n\n') && !blockC.includes('> 嗯') && !blockC.includes('> 宇宙') && !blockC.includes('语文老师'), blockC);

  // ---- 记账没成(老师没回记账段):一个话题最多试两次 ----
  now = at(28, 21, 10);
  const d = await say('记账会坏的话题');
  process.env.FAKE_BOOKKEEP_BAD = '1';
  for (const h of [[23, 20], [23, 30], [23, 40]]) { now = at(28, h[0], h[1]); await tick(); }
  delete process.env.FAKE_BOOKKEEP_BAD;
  const i3 = await readIndex(ctx.ws, 'math-tutor', '2026-10-28');
  check('记账没成:试两次就不再试,也没记成 booked', i3.messages.filter((m) => m.bookkeep?.thread === d).length === 2 && !i3.booked[d]);

  // ---- 第二天:昨天的补上、整理一次记忆;今天刚说的不记;前天的不管 ----
  writeFileSync(join(root, 'vault', '记忆', '数学老师.md'), '---\ncotutor: memory\nagent: math-tutor\n---\n\n- 2026-10-20 凑十他懂\n');
  now = at(29, 8, 0);
  const e = await say('今天早上的话题');
  now = at(29, 9, 0);
  const r4 = await tick();
  const i4 = await readIndex(ctx.ws, 'math-tutor', '2026-10-28');
  const tidies = i4.messages.filter((m) => m.tidy);
  check('第二天:昨天整理一次记忆(落在昨天的索引里);今天刚说的(1 小时)不记', r4.length === 1 && r4[0].date === '2026-10-28' && r4[0].tidied && tidies.length === 1 && !(await readIndex(ctx.ws, 'math-tutor', '2026-10-29')).booked[e], JSON.stringify(r4));
  now = at(29, 9, 30);
  check('整理过的不再整理', (await tick()).length === 0 && (await readIndex(ctx.ws, 'math-tutor', '2026-10-28')).messages.filter((m) => m.tidy).length === 1);
  check('前天的话题:自动记账不补', !(await readIndex(ctx.ws, 'math-tutor', '2026-10-26')).booked[old] && !diary('2026-10-26'));

  // ---- 纯函数的几条边 ----
  const msg = (job: string, thread: string, extra: Record<string, unknown> = {}) => ({ job, thread, at: '2026-10-28T10:00', from: 'kid' as const, text: '一句话很长', result: 'ok' as const, artifacts: [], ...extra });
  const idx = { booked: {}, ratings: { r: 5 }, messages: [msg('1', 'run', { result: 'running' }), msg('2', 'r', { from: 'system', text: '应用派的' }), msg('3', 't', { tidy: true, from: 'system' }), msg('4', 'q', { from: 'system' })] };
  check('跑着的不记;没有孩子的话但打了分的记;整理轮不算话题;都没有的不记', dueBookkeeping(idx as never, { now: at(28, 23, 0), past: true }).threads.join() === 'r');
} finally {
  rmSync(home, { recursive: true, force: true });
}

done();

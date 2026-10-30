/**
 * 家长过目机器写进 vault 的(《vault重构方案》§8,2026-10-30):家长端「记录」的概览给每个话题列出写进 vault 的每一笔
 * (记忆、孩子的记忆、日记那段,对上了孩子原话的带 quote),一笔一笔能撤回;家长后来改过那行就撤不了(409);撤过的删话题时不再撤一遍。假 CLI,不花钱。
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done } from './_check.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'cotutor-review-home-')));
process.env.HOME = home;
delete process.env.COTUTOR_WORKSPACE;

const { initWorkspace } = await import('../src/app/cli/init.ts');
const { loadWorkspace } = await import('../src/app/workspace.ts');
const { createContext, route } = await import('../src/app/http/app.ts');
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
const memFile = join(root, 'vault', '记忆', '数学老师.md');
const childFile = join(root, 'vault', '记忆', '孩子.md');
mkdirSync(join(root, 'vault', '记忆'), { recursive: true });
writeFileSync(memFile, '---\ncotutor: memory\nagent: math-tutor\n---\n\n- 2026-10-01 讲慢点他跟得上\n- 2026-10-01 爱用手指数\n');

const now = new Date(2026, 9, 30, 16, 0);
const DATE = '2026-10-30';
const ctx = createContext(loadWorkspace(root), { now: () => now, warm: false });
let thread = '';
const say = async (text: string): Promise<string> => {
  const s = await ctx.runner.send('math-tutor', { from: 'kid', text, ...(thread ? { thread } : { newThread: true }) });
  if (!thread) thread = s.job;
  await s.done;
  return s.job;
};
type W = { job: string; kind: 'memory' | 'child' | 'diary'; n: number; text: string; quote?: string };
const writes = async (): Promise<W[]> => ((await route('GET', `/api/overview/${DATE}`, ctx)).json as { tutors: { name: string; threads: { thread: string; writes: W[] }[] }[] }).tutors.find((t) => t.name === 'math-tutor')!.threads.find((th) => th.thread === thread)?.writes ?? [];
const undo = (w: Partial<W>) => route('POST', `/api/conversations/math-tutor/${DATE}/threads/${thread}/vault/undo`, ctx, w);

try {
  await say('改记忆');
  await say('带证据 我数成 35 了!');
  await say('记孩子 我不会');
  const bk = await ctx.runner.bookkeep('math-tutor', DATE, [thread], { tidy: false });
  await bk.done;
  const w0 = await writes();
  check('概览:这个话题写进 vault 的每一笔——改、删、带证据的新增、孩子的记忆、日记那段', w0.map((w) => `${w.kind}:${w.text}`).join('|') === 'memory:改:讲慢点他跟得上 → 讲慢点才跟得上|memory:删:爱用手指数|memory:阵列题先伸手指定行数,再一行点一个。|memory:讲角用手指比划|child:孩子的记忆:卡住时会先说我不会,先肯定他做对的部分。|diary:日记:数学 · 三角形的角', JSON.stringify(w0));
  check('对上了孩子原话的带 quote(记忆、孩子的记忆);没证据的没有', w0[2].quote === '我数成35了' && w0[4].quote === '我不会' && !w0[0].quote && !w0[3].quote, JSON.stringify(w0.map((w) => w.quote)));

  // ---- 一笔一笔撤 ----
  const r1 = await undo({ job: w0[2].job, kind: 'memory', n: w0[2].n });
  check('撤一行新增:记忆文件里没了,概览少一笔,那一轮的 remembered 也少一条', r1.status === 200 && !readFileSync(memFile, 'utf8').includes('阵列题') && !(await writes()).some((w) => w.text.includes('阵列题')) && !(await readIndex(ctx.ws, 'math-tutor', DATE)).messages.find((m) => m.job === w0[2].job)?.remembered?.some((r) => r.includes('阵列题')), JSON.stringify(r1.json));
  const r2 = await undo({ job: w0[1].job, kind: 'memory', n: w0[1].n });
  check('撤一行删除:删掉的那行接回末尾', r2.status === 200 && readFileSync(memFile, 'utf8').includes('- 2026-10-01 爱用手指数'));
  const w1 = await writes();
  const kid = w1.find((w) => w.kind === 'child')!;
  const r3 = await undo({ job: kid.job, kind: 'child', n: kid.n });
  check('撤孩子的记忆那行:孩子.md 里没了;remembered 里那条(孩子的记忆:…)也没了', r3.status === 200 && !readFileSync(childFile, 'utf8').includes('先说我不会') && !(await readIndex(ctx.ws, 'math-tutor', DATE)).messages.find((m) => m.job === kid.job)?.remembered?.some((r) => r.startsWith('孩子的记忆:')), JSON.stringify(r3.json));
  const diaryFile = join(root, 'vault', '日记', `${DATE}.md`);
  const dw = (await writes()).find((w) => w.kind === 'diary')!;
  const r4 = await undo({ job: dw.job, kind: 'diary' });
  const i4 = await readIndex(ctx.ws, 'math-tutor', DATE);
  check('撤日记那段:日记里摘掉,booked 照留(不会再被记一遍)', r4.status === 200 && !readFileSync(diaryFile, 'utf8').includes('三角形的角') && i4.booked[thread] === dw.job && !i4.messages.find((m) => m.job === dw.job)?.diaryBlock, JSON.stringify(r4.json));

  // ---- 家长改过的撤不了;请求不对的报错 ----
  writeFileSync(memFile, readFileSync(memFile, 'utf8').replace('- 2026-10-30 讲慢点才跟得上', '- 2026-10-30 讲慢点才跟得上,家长补的'));
  const changed = (await writes()).find((w) => w.text.startsWith('改:'))!;
  const r5 = await undo({ job: changed.job, kind: 'memory', n: changed.n });
  check('家长后来改过那行:409,文件不动,那一笔还在', r5.status === 409 && readFileSync(memFile, 'utf8').includes('家长补的') && (await writes()).some((w) => w.text.startsWith('改:')), JSON.stringify(r5.json));
  check('请求不对 400;没有那一轮 / 那一笔 404', (await undo({ job: changed.job, kind: 'memory' })).status === 400 && (await undo({ job: changed.job, kind: 'nope' as never, n: 0 })).status === 400 && (await undo({ job: '0000-9', kind: 'memory', n: 0 })).status === 404 && (await undo({ job: changed.job, kind: 'memory', n: 9 })).status === 404);

  // ---- 撤过的删话题时不再撤一遍 ----
  const left = (await writes()).length;
  const del = await route('DELETE', `/api/conversations/math-tutor/${DATE}/threads/${thread}`, ctx);
  const u = (del.json as { undo: { memory: number; diary: number; misses: string[] } }).undo;
  check('删话题:只撤还在的(撤过的不再撤,家长改过的那行进 misses)', del.status === 200 && left === 2 && u.memory === 1 && u.diary === 0 && u.misses.some((m) => m.includes('讲慢点才跟得上')) && !readFileSync(memFile, 'utf8').includes('讲角用手指比划'), JSON.stringify({ left, u }));
} finally {
  rmSync(home, { recursive: true, force: true });
}

done();

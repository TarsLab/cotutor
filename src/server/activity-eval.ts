/**
 * cotutor activity eval(《wip/activity设计.md》6.1):照例子文件,真老师 + 模拟孩子跑多轮,判只看板书。
 * 跑在 evals/ 里(同回放:不进孩子的对话、不配音、不写记忆);画家是假的(不花钱,当画好了)。一个例子跑几次,次次都过才算过(pass^k)。
 * 模拟孩子交给百炼的对话模型(缺省 qwen-plus,key 同 qwen 老师);写死的那几句先说完再交给它。
 */
import { homedir } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { localDashscopeKey } from '../clis/qwen.ts';
import { ACTIVITIES_DIR, activityRunFor } from '../cli/activities.ts';
import { PACKAGE_AGENTS_DIR } from '../cli/skeleton.ts';
import { UsageError, type Workspace } from '../cli/workspace.ts';
import { gradeRun, kidPrompt, parseExamples, type ActivityExample, type EvalTurn, type GradeResult } from '../lib/activity-eval.ts';
import type { Draw } from '../paint/draw.ts';
import { evalWorkspace, EVALS_DIR } from './replay.ts';
import { Runner } from './runner.ts';
import { writeCapture } from './store.ts';

/** 模拟孩子:给提示词,回孩子说的一句;不通回 null */
export type KidModel = (prompt: string) => Promise<string | null>;

const CHAT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export function makeKidModel(opts: { env?: NodeJS.ProcessEnv; model?: string; endpoint?: string; timeoutMs?: number } = {}): KidModel {
  const env = opts.env ?? process.env;
  return async (prompt) => {
    const key = env.DASHSCOPE_API_KEY?.trim() || localDashscopeKey(env.HOME || homedir());
    if (!key) return null;
    try {
      const res = await fetch(opts.endpoint ?? CHAT, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: opts.model ?? 'qwen-plus', enable_thinking: false, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
      if (!res.ok) return null;
      const text = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '';
      return text.replace(/^["“「]|["”」]$/g, '').replace(/^孩子[:\uFF1A]\s*/, '').trim() || null;
    } catch {
      return null;
    }
  };
}

/** 画家是假的:当画好了(1×1 的 png),不花钱 */
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const fakeDraw: Draw = async ({ model }) => ({ ok: true, data: PNG, model, ms: 1 });

export interface EvalRun {
  turns: EvalTurn[];
  grades: GradeResult[];
  pass: boolean;
  /** 跑不下去的原因(老师出错、模拟孩子不通) */
  error?: string;
  costUsd: number;
  /** 不报钱数的运行时(qwen)记 token */
  tokens: { in: number; out: number };
  thread: string;
  date: string;
}

export interface EvalExampleReport {
  name: string;
  runs: EvalRun[];
  /** 次次都过 */
  pass: boolean;
}

export interface EvalReport {
  tutor: string;
  activity: string;
  at: string;
  examples: EvalExampleReport[];
  costUsd: number;
  tokens: { in: number; out: number };
  /** 报告落在哪(相对 workspace 根) */
  file: string;
}

export function examplesFile(root: string, tutor: string, name: string): string {
  return join(root, 'agents', tutor, 'activities', `${name}.例子.md`);
}

/**
 * 跑一个 activity 的例子。onTurn 每一轮回调一次(终端现场打印)。
 * 例子文件不在、写坏、参数不对 → UsageError(不起老师)。
 */
export async function evalActivity(ws: Workspace, tutor: string, name: string, opts: { runs?: number; only?: string; kid?: KidModel; draw?: Draw; env?: NodeJS.ProcessEnv; onTurn?: (e: { example: string; run: number; turn: number; kid: string; said: string; paint: boolean }) => void } = {}): Promise<EvalReport> {
  if (!ws.config.tutors[tutor]) throw new UsageError(`没有叫 ${tutor} 的老师`);
  const file = examplesFile(ws.root, tutor, name);
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) throw new UsageError(`${file} 不在:写几个例子再跑(写法见出厂的 agents/chinese-tutor/activities/你说我画.例子.md)`);
  const parsed = parseExamples(text);
  if (parsed.issues.length) throw new UsageError(`例子文件要改:\n${parsed.issues.map((i) => `  ${i.line ? `第 ${i.line} 行 ` : ''}${i.text}`).join('\n')}`);
  if (parsed.activity !== name) throw new UsageError(`例子文件头上写的是 activity: ${parsed.activity},不是 ${name}`);
  const examples = parsed.examples.filter((e) => !opts.only || e.name === opts.only);
  if (!examples.length) throw new UsageError(`没有叫「${opts.only}」的例子;有:${parsed.examples.map((e) => e.name).join('、')}`);
  const runsN = opts.runs ?? 3;
  // 参数先都解析一遍:写错了一轮都不跑
  const runsOf = new Map<ActivityExample, Awaited<ReturnType<typeof activityRunFor>>>();
  for (const e of examples) runsOf.set(e, await activityRunFor(ws.root, tutor, name, e.params));
  // 照片先拷进 captures/(和孩子端拍照、cotutor send --photo 同一条路);读不到一轮都不跑
  const photosOf = new Map<ActivityExample, string[]>();
  for (const e of examples) {
    const saved: string[] = [];
    for (const p of e.photos) {
      const src = isAbsolute(p) ? p : join(dirname(file), p);
      // 出厂例子的图跟着包走,不拷进 workspace:workspace 里没有,就找包里同一个位置的
      const data = (await readFile(src).catch(() => null)) ?? (isAbsolute(p) ? null : await readFile(join(PACKAGE_AGENTS_DIR, tutor, ACTIVITIES_DIR, p)).catch(() => null));
      if (!data) throw new UsageError(`例子「${e.name}」的照片读不到:${src}`);
      saved.push(await writeCapture(ws, new Date(), data, /\.png$/i.test(p) ? 'png' : 'jpg'));
    }
    photosOf.set(e, saved);
  }
  const kid = opts.kid ?? makeKidModel({ env: opts.env });
  const evalWs = evalWorkspace(ws);
  const runner = new Runner(() => evalWs, { env: opts.env, warm: false, draw: opts.draw ?? fakeDraw });
  const out: EvalExampleReport[] = [];
  for (const e of examples) {
    const run = runsOf.get(e)!;
    const runs: EvalRun[] = [];
    for (let k = 0; k < runsN; k++) {
      const turns: EvalTurn[] = [];
      let thread = '';
      let date = '';
      let costUsd = 0;
      const tokens = { in: 0, out: 0 };
      let error: string | undefined;
      let scripted = 0;
      // 第一句是按钮上的字(activity 的名字),和孩子点首页按钮一样;照片随第一句写死的孩子的话发
      let say: string | null = name;
      let photos: string[] = [];
      while (say !== null && turns.length < e.maxTurns) {
        const started = await runner.send(tutor, { from: 'kid', text: say, eval: true, ...(photos.length ? { photos } : {}), ...(thread ? { thread } : { newThread: true, activity: run }) });
        photos = [];
        thread = started.thread;
        date = started.date;
        const index = await started.done;
        await runner.flush();
        const m = index.messages.find((x) => x.job === started.job);
        costUsd += m?.costUsd ?? 0;
        tokens.in += m?.tokens?.in ?? 0;
        tokens.out += m?.tokens?.out ?? 0;
        if (!m || m.result !== 'ok') { error = `第 ${turns.length + 1} 轮老师出错:${m?.error ?? '未知'}`; break; }
        const section = m.section ?? null;
        turns.push({ kid: say, section });
        const paint = (section?.cards ?? []).some((c) => c.kind === 'paint');
        opts.onTurn?.({ example: e.name, run: k + 1, turn: turns.length, kid: say, said: (section?.lines ?? []).map((l) => l.text).join(''), paint });
        if (paint) break;
        if (scripted < e.kid.length) {
          say = e.kid[scripted++];
          if (scripted === 1) photos = photosOf.get(e) ?? [];
        }
        else if (e.persona || e.story) {
          say = await kid(kidPrompt(e, turns));
          if (say === null) { error = '模拟孩子不通(百炼 key?)'; break; }
        } else say = null;
      }
      const grades = gradeRun(e.checks, turns, run.params);
      runs.push({ turns, grades, pass: !error && grades.every((g) => g.pass), ...(error ? { error } : {}), costUsd, tokens, thread, date });
    }
    out.push({ name: e.name, runs, pass: runs.every((r) => r.pass) });
  }
  const at = new Date().toISOString();
  const rel = join(EVALS_DIR, 'activity-eval', `${tutor}-${name}-${at.replace(/[:.]/g, '-')}.json`);
  const all = out.flatMap((x) => x.runs);
  const report: EvalReport = { tutor, activity: name, at, examples: out, costUsd: all.reduce((a, r) => a + r.costUsd, 0), tokens: { in: all.reduce((a, r) => a + r.tokens.in, 0), out: all.reduce((a, r) => a + r.tokens.out, 0) }, file: rel };
  await mkdir(join(ws.root, EVALS_DIR, 'activity-eval'), { recursive: true });
  await writeFile(join(ws.root, rel), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

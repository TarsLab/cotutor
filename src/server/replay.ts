/**
 * 回放(2026-09-15):把某一轮的问题,按**现在**的 vault / 老师文件 / 技能重新问一遍,和原轮并排比。
 * 手改了提示词或 vault 之后「效果好不好」不靠打分,靠人眼看 diff:上下文包哪几行变了、讲稿哪几句变了、卡变没变、
 * 读了什么文件、费用与用时。只有 CLI(`cotutor replay` / `cotutor compare`),家长端不露;给在 workspace 里开 Claude Code 分析用。
 *
 * 落在 workspace 的 evals/(和 conversations/ 同一套文件:索引 / run.json / log / events / post.json),不进孩子的对话、
 * 不算每日上限;永远新话题新会话;不配音;板书后期缺省关(post: true 才开)。做法是给 Runner 一个改了目录与配置的 Workspace,
 * 跑的仍是同一条路(gatherContext → buildContextPack → spawn → 解析 → 物化),所以看到的就是真跑会看到的。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cardLabel } from '../cards/index.ts';
import { UsageError, type Workspace } from '../cli/workspace.ts';
import { conversationFiles } from '../lib/conversation.ts';
import { compactDiff, diffLines, type DiffRow } from '../lib/diff.ts';
import { toolCalls, type ToolCall } from '../lib/transcript.ts';
import type { ConversationMessage, Timing } from '../schema/index.ts';
import { continueContext, homeButtonAt } from './home.ts';
import { Runner } from './runner.ts';
import { readIndex, readRunFile } from './store.ts';

export const EVALS_DIR = 'evals';

/** 在 Claude Code 会话里跑 cotutor replay(技能 cotutor-analyze 就是这么用的):claude 见到 CLAUDECODE 会当嵌套拒掉,起老师前把这几个去掉 */
const NESTED_KEYS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_PID', 'CLAUDE_EFFORT'];
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of NESTED_KEYS) delete out[k];
  return out;
}

export interface ReplayOptions {
  /** 换个运行时跑(比模型 / 比 CLI);缺省老师自己的 */
  runtime?: string;
  /** 开板书后期(缺省关:回放看的是老师) */
  post?: boolean;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

/** 回放用的 Workspace:对话目录换成 evals/、老师全部开着、不配音、后期按 opts */
export function evalWorkspace(ws: Workspace, opts: { post?: boolean } = {}): Workspace {
  const tutors = Object.fromEntries(Object.entries(ws.config.tutors).map(([k, t]) => {
    const { voice: _voice, ...rest } = t;
    const policy = opts.post ? rest.policy : { ...(rest.policy ?? {}), post: { ...(rest.policy?.post ?? {}), mode: 'off' as const } };
    return [k, { ...rest, enabled: true, ...(policy ? { policy } : {}) }];
  }));
  return { ...ws, config: { ...ws.config, tutors }, dirs: { ...ws.dirs, conversations: join(ws.root, EVALS_DIR) } };
}

export interface ReplayStarted {
  tutor: string;
  date: string;
  /** 原轮 */
  job: string;
  /** 回放那轮在 evals/<老师>/<日期>.json 里的 job */
  evalJob: string;
  done: Promise<void>;
}

/**
 * 起一次回放:原轮的问题(谁问的、文字、照片、动作、端)原样再发,上下文包按现在重拼。
 * 原轮带的「孩子在卡上做的」(cards: 段)回放里没有——那是话题里上一轮的卡,回放是新话题;compare 的 notes 会标出来。
 */
export async function startReplay(ws: Workspace, tutor: string, date: string, job: string, opts: ReplayOptions = {}): Promise<ReplayStarted> {
  if (!ws.config.tutors[tutor]) throw new UsageError(`没有叫 ${tutor} 的老师;cotutor.json 的 tutors 里有:${Object.keys(ws.config.tutors).join('、')}`);
  const index = await readIndex(ws, tutor, date);
  const m = index.messages.find((x) => x.job === job);
  if (!m) throw new UsageError(`${tutor} ${date} 没有 ${job} 这一轮(日期缺省今天;job 与日期对不对?)`);
  if (m.bookkeep) throw new UsageError('记账那轮不回放(它 resume 话题的会话,单独跑没有意义)');
  const evalWs = evalWorkspace(ws, { post: opts.post });
  const runner = new Runner(() => evalWs, { now: opts.now, env: opts.env });
  // 从首页按钮进来的那轮:讲法从当时发布的那份原文取,接着的话题从原 workspace 读(回放的 workspace 指到 evals/)
  const button = m.via && typeof m.via.button === 'number' ? await homeButtonAt(ws, tutor, m.via) : null;
  const continued = m.continues ? await continueContext(ws, tutor, m.continues.date, m.continues.thread) : null;
  const started = await runner.send(tutor, {
    from: m.from,
    text: m.text,
    focus: m.focus,
    action: m.action,
    photos: m.photos,
    device: m.device,
    newThread: true,
    date,
    replayOf: job,
    runtime: opts.runtime,
    ...(m.via ? { via: m.via } : {}),
    ...(m.via && typeof m.via.button === 'number' ? { home: { button: m.via.label, ...(button?.brief ? { brief: button.brief } : {}) } } : {}),
    ...(m.continues && continued ? { continues: { ...m.continues, pack: continued } } : {}),
  });
  return { tutor, date, job, evalJob: started.job, done: started.done.then(() => runner.flush()) };
}

/** 一轮的一侧(原轮或回放),给并排看 */
export interface RunSide {
  job: string;
  at: string;
  result: ConversationMessage['result'];
  error: string | null;
  runtime: string | null;
  costUsd: number | null;
  timing: Timing | null;
  kidText: string | null;
  lines: string[];
  cards: string[];
  tools: ToolCall[];
  parentText: string;
  scenes: string | null;
  warnings: string[];
  /** 上下文包 + 消息(run.json 的 prompt);老 workspace 没落就 null */
  prompt: string | null;
  /** 当时的老师文件 hash(run.json sources);没记就 null */
  agentHash: string | null;
  /** 原轮带给老师的「孩子在卡上做的」几句(回放没有) */
  cardsContext: string[];
}

export interface Compare {
  tutor: string;
  date: string;
  job: string;
  evalJob: string;
  status: ConversationMessage['result'];
  orig: RunSide;
  next: RunSide;
  /** 上下文包的 diff(只留变了的行前后两行) */
  pack: DiffRow[];
  lines: DiffRow[];
  cards: DiffRow[];
  tools: DiffRow[];
  /** 看的时候要知道的:回放没带 cards: 段、老师文件变没变之类 */
  notes: string[];
}

const toolLine = (t: ToolCall): string => `${t.name}${t.arg ? ` ${t.arg}` : ''}${t.ok === false ? ' ✗' : ''}${t.sub ? ' (子代理)' : ''}`;

export function sideOf(m: ConversationMessage, run: { prompt: string; sources?: { agent: { hash: string } | null } } | null, tools: ToolCall[]): RunSide {
  return {
    job: m.job,
    at: m.at,
    result: m.result,
    error: m.error ?? null,
    runtime: m.runtime ?? null,
    costUsd: m.costUsd ?? null,
    timing: m.timing ?? null,
    kidText: m.kidText ?? null,
    lines: m.section?.lines.map((l) => l.text) ?? [],
    cards: m.section?.cards.map((c, i) => `卡 ${i + 1}　${c.kind} ${cardLabel(c)}`.trim()) ?? [],
    tools,
    parentText: m.parentText ?? '',
    scenes: m.scenes?.length ? m.scenes.map((s) => `${s.bundle}${s.job ? '' : '(没起)'}`).join('、') : null,
    warnings: m.warnings ?? [],
    prompt: run?.prompt ?? null,
    agentHash: run?.sources?.agent?.hash ?? null,
    cardsContext: m.cards?.map((c) => `${c.card} ${c.text}`) ?? [],
  };
}

/** 纯函数:两侧 → 并排 diff */
export function compareSides(base: { tutor: string; date: string; job: string; evalJob: string }, orig: RunSide, next: RunSide): Compare {
  const notes: string[] = [];
  if (orig.cardsContext.length) notes.push(`原轮带了孩子在卡上做的 ${orig.cardsContext.length} 条(cards: 段),回放是新话题,没带`);
  if (orig.prompt === null) notes.push('原轮没落 run.json(装新版之前跑的),上下文包比不了');
  if (orig.agentHash && next.agentHash) notes.push(orig.agentHash === next.agentHash ? '老师文件没变(hash 一样):差异来自 vault、技能或模型本身' : `老师文件变了:${orig.agentHash.slice(7)} → ${next.agentHash.slice(7)}`);
  if (orig.runtime && next.runtime && orig.runtime !== next.runtime) notes.push(`运行时不同:原轮 ${orig.runtime},回放 ${next.runtime}`);
  const promptLines = (p: string | null): string[] => (p === null ? [] : p.split('\n'));
  return {
    ...base,
    status: next.result,
    orig,
    next,
    pack: orig.prompt !== null && next.prompt !== null ? compactDiff(diffLines(promptLines(orig.prompt), promptLines(next.prompt))) : [],
    lines: diffLines(orig.lines, next.lines),
    cards: diffLines(orig.cards, next.cards),
    tools: diffLines(orig.tools.map(toolLine), next.tools.map(toolLine)),
    notes,
  };
}

/** 一轮的工具调用:索引里物化过就用它,没有(老轮次)就从 .log 现抽 */
async function toolsOf(ws: Workspace, tutor: string, date: string, m: ConversationMessage): Promise<ToolCall[]> {
  if (m.tools) return m.tools;
  const text = await readFile(conversationFiles(ws.dirs.conversations, tutor, date).log(m.job), 'utf8').catch(() => '');
  return toolCalls(text);
}

export async function compareReplay(ws: Workspace, tutor: string, date: string, evalJob: string): Promise<Compare | null> {
  const evalWs = evalWorkspace(ws);
  const evalIndex = await readIndex(evalWs, tutor, date);
  const next = evalIndex.messages.find((x) => x.job === evalJob);
  if (!next?.replayOf) return null;
  const index = await readIndex(ws, tutor, date);
  const orig = index.messages.find((x) => x.job === next.replayOf);
  if (!orig) return null;
  const [origRun, nextRun, origTools, nextTools] = await Promise.all([readRunFile(ws, tutor, date, orig.job), readRunFile(evalWs, tutor, date, evalJob), toolsOf(ws, tutor, date, orig), toolsOf(evalWs, tutor, date, next)]);
  return compareSides({ tutor, date, job: orig.job, evalJob }, sideOf(orig, origRun, origTools), sideOf(next, nextRun, nextTools));
}

export interface ReplayRow {
  evalJob: string;
  replayOf: string;
  at: string;
  result: ConversationMessage['result'];
  costUsd: number | null;
  runtime: string | null;
}

/** 这天回放过哪些(evals/<老师>/<日期>.json 里 replayOf 指向 job 的;不给 job 就全部) */
export async function listReplays(ws: Workspace, tutor: string, date: string, job?: string): Promise<ReplayRow[]> {
  const evalIndex = await readIndex(evalWorkspace(ws), tutor, date);
  return evalIndex.messages.filter((m) => m.replayOf && (!job || m.replayOf === job)).map((m) => ({ evalJob: m.job, replayOf: m.replayOf as string, at: m.at, result: m.result, costUsd: m.costUsd ?? null, runtime: m.runtime ?? null }));
}

/** 终端打印 */
export function formatCompare(c: Compare): string {
  const out: string[] = [];
  const money = (s: RunSide): string => `${s.costUsd !== null ? `$${s.costUsd.toFixed(3)}` : '$?'}${s.timing?.doneMs !== undefined ? ` · ${(s.timing.doneMs / 1000).toFixed(1)}s` : ''}${s.runtime ? ` · ${s.runtime}` : ''}`;
  out.push(`回放 ${c.tutor} ${c.date} ${c.job} → evals/${c.tutor}/${c.date}.${c.evalJob}.*(${c.status})`);
  out.push(`  - 原轮 ${c.orig.at} · ${money(c.orig)}${c.orig.error ? ` · 出错 ${c.orig.error}` : ''}`);
  out.push(`  + 回放 ${c.next.at} · ${money(c.next)}${c.next.error ? ` · 出错 ${c.next.error}` : ''}`);
  for (const n of c.notes) out.push(`  ! ${n}`);
  const section = (title: string, rows: DiffRow[], empty: string): void => {
    const changed = rows.filter((r) => r.s !== '·').length;
    out.push(`\n## ${title}${rows.length ? `(${changed ? `${changed} 处不同` : '一样'})` : `(${empty})`}`);
    for (const r of rows) out.push(`${r.s} ${r.text}`);
  };
  section('上下文包', c.pack, '没有可比的');
  section('讲稿', c.lines, '两边都没有讲稿');
  section('卡', c.cards, '两边都没有卡');
  section('读了什么', c.tools, '两边都没用工具');
  if (c.orig.parentText || c.next.parentText) { out.push('\n## 给家长的尾巴'); out.push(`- ${c.orig.parentText || '(无)'}`); out.push(`+ ${c.next.parentText || '(无)'}`); }
  if (c.orig.scenes || c.next.scenes) out.push(`画图作业:原轮 ${c.orig.scenes ?? '无'} / 回放 ${c.next.scenes ?? '无'}`);
  if (c.orig.warnings.length || c.next.warnings.length) out.push(`提醒:原轮 ${c.orig.warnings.join(';') || '无'} / 回放 ${c.next.warnings.join(';') || '无'}`);
  out.push(`\n回放那轮自己的全部:cotutor show ${c.tutor} ${c.evalJob} ${c.date} --evals`);
  return `${out.join('\n')}\n`;
}

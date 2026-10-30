/**
 * 对话与配置的文件层:索引读写(坏索引响亮报错,不静默覆盖)、日期列表、转录读取、老师正文、cotutor.json 补丁写回。
 * 纯函数在 lib/,这里只碰文件系统。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { parseAgentFile } from '../agent-file.ts';
import { emptyIndex } from './conversation.ts';
import { localDate } from '../../shared/time.ts';
import { cardAssetName, conversationFiles, threads, type CardAssets, type CardStateFile, type CardStates } from '../../schema/index.ts';
import { parseTranscript, type Transcript } from '../../brain/transcript.ts';
import { logParser } from '../../brain/index.ts';
import {
  ConversationIndexSchema,
  DATE_RE,
  explainIssues,
  type ConversationIndex,
  type ConversationMessage,
} from '../../schema/index.ts';
import { undoThreadVault, type ThreadUndo } from '../../memory/vault.ts';
import { recoverPending } from '../../memory/commit.ts';
import { ConfigError } from '../../shared/errors.ts';
import { redactHome } from '../../shared/home.ts';
import type { Workspace } from '../../schema/index.ts';

export class IndexError extends Error {
  constructor(file: string, cause: string) {
    super(`对话索引用不了:${redactHome(file)}\n${cause}\n修好它或改名挪开(转录 .log 还在,能重建);不要删。`);
  }
}

export async function readIndex(ws: Workspace, tutor: string, date: string): Promise<ConversationIndex> {
  const file = conversationFiles(ws.dirs.conversations, tutor, date).index;
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return emptyIndex(tutor, date);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new IndexError(file, `不是合法 JSON:${err instanceof Error ? err.message : String(err)}`);
  }
  const r = ConversationIndexSchema.safeParse(raw);
  if (!r.success) throw new IndexError(file, explainIssues(r.error.issues).map((l) => `  - ${l}`).join('\n'));
  return r.data;
}

/** 先写 .tmp 再 rename:进程半路死掉不会留下半份索引 */
export async function writeIndex(ws: Workspace, index: ConversationIndex): Promise<void> {
  const { index: file } = conversationFiles(ws.dirs.conversations, index.tutor, index.date);
  await mkdir(join(ws.dirs.conversations, index.tutor), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`);
  await rename(tmp, file);
}

/** 有过对话的日期,新的在前 */
export async function listDates(ws: Workspace, tutor: string): Promise<string[]> {
  try {
    return (await readdir(join(ws.dirs.conversations, tutor)))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .filter((d) => DATE_RE.test(d))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** runtime:这轮的运行时名(消息上记着),按它的 CLI 适配器读;不给按 stream-json */
export async function readTranscript(ws: Workspace, tutor: string, date: string, job: string, runtime?: string): Promise<Transcript | null> {
  try {
    return parseTranscript(await readFile(conversationFiles(ws.dirs.conversations, tutor, date).log(job), 'utf8'), logParser(ws.config.runtimes, runtime));
  } catch {
    return null;
  }
}

/**
 * 一天里卡的目录 <date>.<job>.cards/ 全扫一遍:<n>.json 是孩子做的事(坏文件跳过,孩子端不报),<n>/<k>.mp3 是后台生成好的资产。
 */
export async function scanCards(ws: Workspace, tutor: string, date: string): Promise<{ states: CardStates; assets: CardAssets }> {
  const dir = join(ws.dirs.conversations, tutor);
  const states: CardStates = {};
  const assets: CardAssets = {};
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { states, assets };
  }
  for (const name of names) {
    const m = new RegExp(`^${date}\\.(\\d{4}-\\d+)\\.cards$`).exec(name);
    if (!m) continue;
    const job = m[1];
    let files: string[];
    try {
      files = await readdir(join(dir, name), { withFileTypes: true }).then((es) => es.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)));
    } catch {
      continue;
    }
    for (const f of files) {
      const n = /^(\d+)\.json$/.exec(f);
      if (n) {
        try {
          const raw = JSON.parse(await readFile(join(dir, name, f), 'utf8')) as CardStateFile;
          if (raw && typeof raw.at === 'string' && typeof raw.turn === 'string' && 'state' in raw) (states[job] ??= {})[Number(n[1])] = raw;
        } catch {
          /* 坏文件:当没做过 */
        }
        continue;
      }
      const d = /^(\d+)\/$/.exec(f);
      if (!d) continue;
      try {
        const inner = (await readdir(join(dir, name, d[1]))).filter((x) => /^\d+\.mp3$/.test(x)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
        if (inner.length) (assets[job] ??= {})[Number(d[1])] = inner.map((x) => cardAssetName(date, job, Number(d[1]), x));
      } catch {
        /* 目录没了:当没有 */
      }
    }
  }
  return { states, assets };
}

/** 只要孩子做的事(发消息时挑「上一轮之后改过的」) */
export async function readCardStates(ws: Workspace, tutor: string, date: string): Promise<CardStates> {
  return (await scanCards(ws, tutor, date)).states;
}

/** 存一张卡的状态(先 .tmp 再 rename);turn = 存的时候索引里最后一条的 job */
export async function writeCardState(ws: Workspace, tutor: string, date: string, job: string, n: number, file: CardStateFile): Promise<void> {
  const files = conversationFiles(ws.dirs.conversations, tutor, date);
  await mkdir(files.cardsDir(job), { recursive: true });
  const target = files.card(job, n);
  await writeFile(`${target}.tmp`, `${JSON.stringify(file, null, 2)}\n`);
  await rename(`${target}.tmp`, target);
}

/** 画板导出的 png:<date>.<job>.cards/<n>.png;返回相对 conversations/<老师>/ 的名字 */
export async function writeCardImage(ws: Workspace, tutor: string, date: string, job: string, n: number, png: Buffer): Promise<string> {
  const files = conversationFiles(ws.dirs.conversations, tutor, date);
  await mkdir(files.cardsDir(job), { recursive: true });
  const target = `${files.cardsDir(job)}/${n}.png`;
  await writeFile(target, png);
  return `${date}.${job}.cards/${n}.png`;
}

/**
 * 作业照片(R5,2026-09-14):落 workspace 的 captures/<日期>/<HHMM>-<n>.<ext>(paths.captures,相对 workspace 根),
 * 不落 vault。返回相对 workspace 根的路径(消息的 photos、上下文包的 photos: 段、/api/kid/image?p= 都用它)。
 */
export async function writeCapture(ws: Workspace, at: Date, data: Buffer, ext: 'jpg' | 'png'): Promise<string> {
  const date = localDate(at);
  const dir = join(ws.paths.captures, date);
  await mkdir(dir, { recursive: true });
  const hhmm = `${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}`;
  const taken = new Set(await readdir(dir).catch(() => [] as string[]));
  let n = 1;
  while (taken.has(`${hhmm}-${n}.jpg`) || taken.has(`${hhmm}-${n}.png`)) n++;
  const file = join(dir, `${hhmm}-${n}.${ext}`);
  await writeFile(file, data);
  return relative(ws.root, file).split(sep).join('/');
}

/** 消息里的照片路径合不合法:相对 workspace 根、落在 paths.captures 里、文件在 */
export async function capturePathOk(ws: Workspace, rel: string): Promise<boolean> {
  if (!rel || rel.startsWith('/') || rel.includes('..') || rel.includes('\\')) return false;
  const file = join(ws.root, rel);
  if (!(file === ws.paths.captures || file.startsWith(ws.paths.captures + sep))) return false;
  return (await stat(file).catch(() => null))?.isFile() ?? false;
}

/**
 * 这一轮真发出去的东西(<date>.<job>.run.json):上下文包与完整命令行。
 * 跑完就丢的话「老师为什么没看见孩子选了 C」永远查不了,所以落一份;只有家长端「看原文」读它。
 */
/** 这轮用的老师文件与技能的快照(2026-09-15):文件后来改了就查不回当时那份,所以记正文与 hash;技能只记 hash,变没变一眼看 */
export interface RunSources {
  agent: { file: string; hash: string; body: string } | null;
  /** 技能名 → SKILL.md 的 hash(workspace .claude/skills/ 下有的全部) */
  skills: Record<string, string>;
  /** 这轮上下文包里带了原文的笔记(守则、档案、记忆、口径……):role、路径、带进去那段的 hash 与字数、截没截(2026-10-30;续话题「未变」的不在这里) */
  notes?: { role: string; path: string; hash: string; chars: number; cut?: true }[];
  /** 替老师查的(memory/retrieval.ts):文件(相对 vault 根)、整篇的 hash、为什么查 */
  retrieved?: { path: string; hash: string; why: string }[];
}

export interface RunFile {
  at: string;
  /** 拼好的上下文包(消息正文在最后) */
  prompt: string;
  runtime: string;
  /** 完整命令行,argv[0] 是可执行文件 */
  argv: string[];
  resume: boolean;
  session: string | null;
  /** 老师文件与技能的快照;2026-09-15 之前的轮次没有 */
  sources?: RunSources;
  /** 这个运行时把老师正文塞进了命令行({agentBody} / {systemBody}) */
  agentBody: boolean;
}

export async function writeRunFile(
  ws: Workspace,
  tutor: string,
  date: string,
  job: string,
  r: { at: string; prompt: string; plan: { runtime: string; argv: string[]; resume: boolean; session: string | null }; agentBody: boolean; sources?: RunSources },
): Promise<void> {
  const file = conversationFiles(ws.dirs.conversations, tutor, date).run(job);
  const row: RunFile = { at: r.at, prompt: r.prompt, runtime: r.plan.runtime, argv: r.plan.argv, resume: r.plan.resume, session: r.plan.session, agentBody: r.agentBody, ...(r.sources ? { sources: r.sources } : {}) };
  try {
    await mkdir(join(ws.dirs.conversations, tutor), { recursive: true });
    await writeFile(file, `${JSON.stringify(row, null, 2)}\n`);
  } catch {
    /* 落不下就算了:这只是给「看原文」看的,不能拦着老师说话 */
  }
}

export async function readRunFile(ws: Workspace, tutor: string, date: string, job: string): Promise<RunFile | null> {
  try {
    const text = await readFile(conversationFiles(ws.dirs.conversations, tutor, date).run(job), 'utf8');
    const v = JSON.parse(text) as RunFile;
    return typeof v?.prompt === 'string' && Array.isArray(v.argv) ? v : null;
  } catch {
    return null;
  }
}

export async function readErrLog(ws: Workspace, tutor: string, date: string, job: string): Promise<string> {
  try {
    return await readFile(conversationFiles(ws.dirs.conversations, tutor, date).err(job), 'utf8');
  } catch {
    return '';
  }
}

const sha = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;

/** 这轮起跑时老师文件与技能长什么样(记进 run.json;读不到的就 null / 空,不拦这一轮) */
export async function snapshotSources(ws: Workspace, name: string): Promise<RunSources> {
  let agent: RunSources['agent'] = null;
  const file = join(ws.dirs.claudeAgents, `${name}.md`);
  try {
    const body = await readFile(file, 'utf8');
    agent = { file: relative(ws.root, file), hash: sha(body), body };
  } catch {
    /* 读不到:记 null */
  }
  const skills: Record<string, string> = {};
  const skillsDir = join(ws.root, '.claude', 'skills');
  for (const d of await readdir(skillsDir, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() && !d.isSymbolicLink()) continue;
    const text = await readFile(join(skillsDir, d.name, 'SKILL.md'), 'utf8').catch(() => null);
    if (text !== null) skills[d.name] = sha(text);
  }
  return { agent, skills };
}

/** 老师文件正文(系统提示),给 {agentBody} / {systemBody};从 .claude/agents/ 读(所有 CLI 都从这里拿) */
export async function readAgentBody(ws: Workspace, name: string): Promise<string> {
  const file = join(ws.dirs.claudeAgents, `${name}.md`);
  try {
    return parseAgentFile(await readFile(file, 'utf8')).body;
  } catch {
    throw new ConfigError(file, '老师文件读不到;cotutor init 补拷');
  }
}

/** 给一个话题打星(1–5;null 清掉):话题要在这天的索引里;写回索引 */
export async function rateThread(ws: Workspace, tutor: string, date: string, thread: string, rating: number | null): Promise<ConversationIndex> {
  const index = await readIndex(ws, tutor, date);
  if (!threads(index.messages).includes(thread)) throw new IndexError(conversationFiles(ws.dirs.conversations, tutor, date).index, `${date} 没有话题 ${thread}`);
  const ratings = { ...index.ratings };
  if (rating === null) delete ratings[thread];
  else ratings[thread] = rating;
  const next = { ...index, ratings };
  await writeIndex(ws, next);
  return next;
}

// ---- vault 搬到了 src/memory/vault.ts;旧路径留转发,迁完删 ----
export { readDiaries, readTextbooks, scanVault, undoThreadVault, writeDiary, type ThreadUndo, type Vault } from '../../memory/vault.ts';

/**
 * 删掉一天里的一个话题(家长板书页清单上的「删」,2026-09-22):索引里它的消息、会话、星、记账标记都去掉,
 * 这些轮的文件(转录、run、事件、配音、卡的状态与资产)按 <日期>.<job>.* 整个删。
 * 这个话题留下的痕迹一起撤(2026-10-05,家长在孩子端试过再删):各轮写进 vault 记忆的行(memoryLines)倒着撤、记账写进日记的那段(diaryBlock)摘掉;
 * 写到一半断了的(还带着 pending)先对照文件补记,写成了的一样撤。不动的:captures/ 里的照片。跑着的轮由路由先挡(409)。
 */
export async function deleteThread(ws: Workspace, tutor: string, date: string, thread: string): Promise<{ index: ConversationIndex; undo: ThreadUndo }> {
  const { index } = await recoverPending(ws, await readIndex(ws, tutor, date));
  const ths = threads(index.messages);
  if (!ths.includes(thread)) throw new IndexError(conversationFiles(ws.dirs.conversations, tutor, date).index, `${date} 没有话题 ${thread}`);
  const gone = index.messages.filter((_, i) => ths[i] === thread);
  const kept = index.messages.filter((_, i) => ths[i] !== thread);
  const dir = join(ws.dirs.conversations, tutor);
  const prefixes = gone.map((m) => `${date}.${m.job}.`);
  for (const e of await readdir(dir).catch(() => [] as string[])) if (prefixes.some((p) => e.startsWith(p))) await rm(join(dir, e), { recursive: true, force: true });
  const { [thread]: _s, ...sessions } = index.sessions;
  const { [thread]: _r, ...ratings } = index.ratings;
  const { [thread]: _b, ...booked } = index.booked;
  // 当前话题(末条所在)的会话:删的正是它就换成剩下的末条那个;不是就不动
  const keptThreads = threads(kept);
  const last = keptThreads[keptThreads.length - 1];
  const session = ths[ths.length - 1] === thread ? (last ? (sessions[last] ?? null) : null) : index.session;
  const next: ConversationIndex = { ...index, messages: kept, sessions, ratings, booked, session };
  const undo = await undoThreadVault(ws, tutor, date, gone);
  await writeIndex(ws, next);
  return { index: next, undo };
}

/** 话题写进 vault 的一笔:memory = 这位老师(或这个 activity)的记忆,child = 孩子的记忆,diary = 记账写进日记的那段 */
export type VaultWrite = { job: string; kind: 'memory' | 'child' | 'diary'; n: number };

/**
 * 撤回一个话题写进 vault 的一笔(家长端「记录」的「撤回」,2026-10-30,《vault重构方案》§8):n = 那一轮 memoryLines / childLines 的第几条(diary 不用)。
 * 撤法同删话题(undoThreadVault):家长后来改过那行就找不到,不动,回 misses。撤成了就从那一轮的记录里去掉(删话题时不再撤一遍);
 * 日记那段撤了 booked 照留,不再自动记它。写到一半断了的先补记。跑着的轮由路由先挡(409)。
 */
export async function undoVaultWrite(ws: Workspace, tutor: string, date: string, thread: string, w: VaultWrite): Promise<{ index: ConversationIndex; undo: ThreadUndo }> {
  const { index } = await recoverPending(ws, await readIndex(ws, tutor, date));
  const ths = threads(index.messages);
  const file = conversationFiles(ws.dirs.conversations, tutor, date).index;
  const at = index.messages.findIndex((m, i) => m.job === w.job && ths[i] === thread);
  if (at < 0) throw new IndexError(file, `${date} 的话题 ${thread} 里没有 ${w.job} 这一轮`);
  const m = index.messages[at];
  const lines = w.kind === 'memory' ? m.memoryLines : w.kind === 'child' ? m.childLines : undefined;
  if (w.kind === 'diary' ? !m.diaryBlock : !lines?.[w.n]) throw new IndexError(file, `${w.job} 这一轮没有这一笔(${w.kind} ${w.n})`);
  // 一笔撤一笔:拼一条只带这一笔的消息交给删话题那套;activity 话题的记忆在 activity 自己那篇,activity 记在话题第一条
  const activity = index.messages.find((x, i) => ths[i] === thread && x.activity)?.activity;
  const one: ConversationMessage = { ...m, ...(activity ? { activity } : {}), memoryLines: w.kind === 'memory' ? [lines![w.n]] : [], childLines: w.kind === 'child' ? [lines![w.n]] : [], diaryBlock: w.kind === 'diary' ? m.diaryBlock : undefined };
  const undo = await undoThreadVault(ws, tutor, date, [one]);
  if (!undo.memory && !undo.diary) return { index, undo };
  // remembered = 自己的改动在前、孩子的记忆在后(和 memoryLines、childLines 一一对上);对不上的老数据不动它
  const mem = m.memoryLines ?? [];
  const kid = m.childLines ?? [];
  const remembered = m.remembered && m.remembered.length === mem.length + kid.length && w.kind !== 'diary' ? m.remembered.filter((_, k) => k !== (w.kind === 'memory' ? w.n : mem.length + w.n)) : m.remembered;
  const next: ConversationMessage = w.kind === 'diary'
    ? (({ diaryBlock: _d, ...rest }) => rest)(m)
    : { ...m, ...(w.kind === 'memory' ? { memoryLines: mem.filter((_, k) => k !== w.n) } : { childLines: kid.filter((_, k) => k !== w.n) }), ...(remembered ? { remembered } : {}) };
  const out: ConversationIndex = { ...index, messages: index.messages.map((x, k) => (k === at ? next : x)) };
  await writeIndex(ws, out);
  return { index: out, undo };
}

// cotutor.json 的补丁写回与热重载在 src/app/workspace.ts(读配置那边)

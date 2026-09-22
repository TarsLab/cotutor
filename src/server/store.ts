/**
 * 对话与配置的文件层:索引读写(坏索引响亮报错,不静默覆盖)、日期列表、转录读取、老师正文、cotutor.json 补丁写回。
 * 纯函数在 lib/,这里只碰文件系统。
 */
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { parseAgentFile } from '../lib/agent-file.ts';
import { cardAssetName, conversationFiles, emptyIndex, localDate, threads, type CardAssets, type CardStateFile, type CardStates } from '../lib/conversation.ts';
import { parseTranscript, type Transcript } from '../lib/transcript.ts';
import { applyMemoryOps, frontmatter, memoryPath, memoryTemplate, parseMemoryOp, type VaultNote } from '../lib/vault-notes.ts';
import {
  ConversationIndexSchema,
  CotutorConfigSchema,
  DATE_RE,
  explainIssues,
  type ConversationIndex,
  type CotutorConfig,
} from '../schema/index.ts';
import { ConfigError, assembleWorkspace, parseConfig, readJson, redactHome, type Workspace } from '../cli/workspace.ts';

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

export async function readTranscript(ws: Workspace, tutor: string, date: string, job: string): Promise<Transcript | null> {
  try {
    return parseTranscript(await readFile(conversationFiles(ws.dirs.conversations, tutor, date).log(job), 'utf8'));
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
 * 作业照片(R5,2026-09-14,《产品规划.md》拍板 14):落 workspace 的 captures/<日期>/<HHMM>-<n>.<ext>(paths.captures,相对 workspace 根),
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
/** 这轮用的老师文件与技能的快照(2026-09-15):claude 走 --agent 时正文不在命令行里,文件后来改了就查不回当时那份,所以记正文与 hash;技能只记 hash,变没变一眼看 */
export interface RunSources {
  agent: { file: string; hash: string; body: string } | null;
  /** 技能名 → SKILL.md 的 hash(workspace .claude/skills/ 下有的全部) */
  skills: Record<string, string>;
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
  /** 这个运行时把老师正文塞进了命令行({agentBody};claude 走 --agent 就没有) */
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
  for (const dir of [ws.dirs.claudeAgents, ws.dirs.qwenAgents]) {
    const file = join(dir, `${name}.md`);
    try {
      const body = await readFile(file, 'utf8');
      agent = { file: relative(ws.root, file), hash: sha(body), body };
      break;
    } catch {
      /* 试下一处 */
    }
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

/** 老师文件正文(系统提示),给 {agentBody};从 .claude/agents/ 读,那里的链是必需项 */
export async function readAgentBody(ws: Workspace, name: string): Promise<string> {
  for (const dir of [ws.dirs.claudeAgents, ws.dirs.qwenAgents]) {
    try {
      return parseAgentFile(await readFile(join(dir, `${name}.md`), 'utf8')).body;
    } catch {
      /* 试下一处 */
    }
  }
  throw new ConfigError(join(ws.dirs.claudeAgents, `${name}.md`), '老师文件读不到;cotutor init 补拷');
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

// ---- vault(《obsidian仓库设计.md》§6 的封闭清单:日记只追加;教材只读)----

/** 这几天的日记(<日记目录>/<日期>.md);没有的跳过 */
/**
 * 删掉一天里的一个话题(家长板书页清单上的「删」,2026-09-22):索引里它的消息、会话、星、记账标记都去掉,
 * 这些轮的文件(转录、run、事件、后期、配音、卡的状态与资产)按 <日期>.<job>.* 整个删。
 * 不动的:已写进 vault 的记忆与日记(那是家长的,在 Obsidian 里改)、captures/ 里的照片。跑着的轮由路由先挡(409)。
 */
export async function deleteThread(ws: Workspace, tutor: string, date: string, thread: string): Promise<ConversationIndex> {
  const index = await readIndex(ws, tutor, date);
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
  const cost = Math.max(0, index.costUsd - gone.reduce((s, m) => s + (m.costUsd ?? 0), 0));
  const next: ConversationIndex = { ...index, messages: kept, sessions, ratings, booked, session, costUsd: Math.round(cost * 1e6) / 1e6 };
  await writeIndex(ws, next);
  return next;
}

export async function readDiaries(ws: Workspace, dates: readonly string[]): Promise<{ date: string; text: string }[]> {
  const out: { date: string; text: string }[] = [];
  for (const date of dates) {
    try {
      out.push({ date, text: await readFile(join(ws.paths.diary, `${date}.md`), 'utf8') });
    } catch {
      /* 那天没写 */
    }
  }
  return out;
}

/** 当天的日记:update 拿现有内容(没有 → null)回新内容;先 .tmp 再 rename。返回文件名(<日期>.md) */
export async function writeDiary(ws: Workspace, date: string, update: (existing: string | null) => string): Promise<string> {
  await mkdir(ws.paths.diary, { recursive: true });
  const file = join(ws.paths.diary, `${date}.md`);
  const existing = await readFile(file, 'utf8').catch(() => null);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, update(existing));
  await rename(tmp, file);
  return basename(file);
}

/** 教材目录下的每册文件(<教材目录>/<册>.md),给 textbookHeadings;没有目录 → [] */
export async function readTextbooks(ws: Workspace): Promise<{ name: string; text: string }[]> {
  let names: string[];
  try {
    names = (await readdir(ws.paths.textbooks)).filter((f) => f.endsWith('.md') && !f.startsWith('.')).sort();
  } catch {
    return [];
  }
  const out: { name: string; text: string }[] = [];
  for (const name of names) {
    try {
      out.push({ name, text: await readFile(join(ws.paths.textbooks, name), 'utf8') });
    } catch {
      /* 读不到就跳过 */
    }
  }
  return out;
}

/**
 * 扫 vault:所有文件的相对路径(解析 [[链接]] 用)+ 带 `cotutor:` 属性的 md(按属性定位,《obsidian仓库设计.md》2026-09-17)。
 * 跳过点开头的目录(.obsidian / .git)与日记、计划目录(机器写的,不带属性,越积越多)。读不到的文件跳过;vault 不在 → 全空。
 */
export async function scanVault(ws: Workspace): Promise<{ notes: VaultNote[]; files: string[] }> {
  const root = ws.paths.vault;
  const skip = new Set([ws.paths.diary, ws.paths.plans]);
  const notes: VaultNote[] = [];
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(abs)) await walk(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = relative(root, abs).split(sep).join('/');
      files.push(rel);
      if (!e.name.endsWith('.md')) continue;
      try {
        const text = await readFile(abs, 'utf8');
        const props = frontmatter(text);
        if (props.cotutor) notes.push({ path: rel, props, text });
      } catch {
        /* 读不到(iCloud 占位)就跳过 */
      }
    }
  };
  await walk(root);
  return { notes, files: files.sort() };
}

/**
 * 把「## 记忆」段落进这位 agent 的记忆文件(按 `cotutor: memory` + `agent:` 找;没有就建 记忆/<显示名>.md):
 * 新增追加到末尾,「改:」「删:」按原话找行改、删(任何一行都能动,2026-09-18);缺省位置已有一篇没属性的同名文件就不碰,进提醒。先 .tmp 再 rename。
 */
export async function updateVaultMemory(ws: Workspace, agent: string, display: string, items: readonly string[], date: string): Promise<{ file: string | null; changes: string[]; warnings: string[] }> {
  const found = (await scanVault(ws)).notes.find((n) => n.props.cotutor === 'memory' && n.props.agent?.trim() === agent);
  let file: string;
  let existing: string;
  if (found) {
    file = join(ws.paths.vault, found.path);
    existing = found.text;
  } else {
    file = join(ws.paths.vault, memoryPath(display));
    if ((await stat(file).catch(() => null)) !== null) return { file: null, changes: [], warnings: [`记忆没写:${memoryPath(display)} 已经有了但没有 cotutor: memory / agent: ${agent} 属性;加上属性,或挪开它`] };
    existing = memoryTemplate(agent, display);
  }
  const r = applyMemoryOps(existing, items.map(parseMemoryOp), date);
  const warnings = r.misses.length ? [`记忆:找不到原话,没改:${r.misses.join(';')}`] : [];
  if (!r.changes.length) return { file: null, changes: [], warnings };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, r.text);
  await rename(`${file}.tmp`, file);
  return { file, changes: r.changes, warnings };
}

/** PATCH 允许改的顶层键(老师团页与设置页);kid / version / 运行时模板走编辑器 */
export const CONFIG_PATCH_KEYS = ['title', 'policyDefaults', 'tutors', 'agents', 'paths', 'server', 'tts', 'vault'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * 深合并:对象递归、其余覆盖、null 删键(老师条目可整体删:tutors.x = null)。
 * 底下没有这个对象时也要**先剥掉 null 再放**——页面上留空的字段发的就是 null,
 * 直接把补丁原样放进去会写出 `policy: {replyMaxChars: null, …}`,整份过不了契约、一保存就报错
 * (2026-09-11:老师条目本来没有 policy 键时必然撞上,出厂六位都是这样)。
 */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObj(patch)) return patch;
  const out: Record<string, unknown> = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete out[k];
      continue;
    }
    const had = k in out;
    const merged = deepMerge(out[k], v);
    // 补丁里一组字段全留空(全是 null)时别凭空造个空对象出来:policy: {contextPack: {}} 这种噪音不该进政策文件
    if (!had && isObj(merged) && !Object.keys(merged).length) continue;
    out[k] = merged;
  }
  return out;
}

/**
 * 补丁合到原始 JSON 上(保留 _note 等机器不认识的键),整份过契约再写;写坏了不落盘。
 * 返回新配置;agents 只允许改 default(运行时模板走编辑器,页面上改错一个引号就把老师全弄哑)。
 */
export async function patchConfig(ws: Workspace, patch: Record<string, unknown>): Promise<CotutorConfig> {
  const unknown = Object.keys(patch).filter((k) => !(CONFIG_PATCH_KEYS as readonly string[]).includes(k));
  if (unknown.length) throw new ConfigError(ws.files.config, `页面只能改 ${CONFIG_PATCH_KEYS.join(' / ')},不认识:${unknown.join(', ')};其余字段请直接编辑文件`);
  if (isObj(patch.agents) && Object.keys(patch.agents).some((k) => k !== 'default')) {
    throw new ConfigError(ws.files.config, 'agents 只能在页面上改 default;运行时模板请直接编辑文件');
  }
  const raw = readJson(ws.files.config);
  if (raw === null) throw new ConfigError(ws.files.config, '不存在');
  const merged = deepMerge(raw, patch);
  const r = CotutorConfigSchema.safeParse(merged);
  if (!r.success) throw new ConfigError(ws.files.config, `补丁应用后不合契约,未写入:\n${explainIssues(r.error.issues).map((l) => `  - ${l}`).join('\n')}`);
  const tmp = `${ws.files.config}.tmp`;
  await writeFile(tmp, `${JSON.stringify(merged, null, 2)}\n`);
  await rename(tmp, ws.files.config);
  return r.data;
}

/** 文件改了(页面写的、或家长在编辑器改的)就重读;坏了抛 ConfigError,调用方决定是留旧的还是响 */
export async function reloadIfChanged(ws: Workspace, lastMtime: number): Promise<{ ws: Workspace; mtime: number }> {
  const st = await stat(ws.files.config);
  if (st.mtimeMs === lastMtime) return { ws, mtime: lastMtime };
  const raw = readJson(ws.files.config);
  if (raw === null) throw new ConfigError(ws.files.config, '不存在了');
  return { ws: assembleWorkspace(ws.root, ws.source, parseConfig(raw, ws.files.config)), mtime: st.mtimeMs };
}

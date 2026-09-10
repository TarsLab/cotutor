/**
 * 对话与配置的文件层:索引读写(坏索引响亮报错,不静默覆盖)、日期列表、转录读取、老师正文、cotutor.json 补丁写回。
 * 纯函数在 lib/,这里只碰文件系统。
 */
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAgentFile } from '../lib/agent-file.ts';
import { cardAssetName, conversationFiles, emptyIndex, type CardAssets, type CardStateFile, type CardStates } from '../lib/conversation.ts';
import { parseTranscript, type Transcript } from '../lib/transcript.ts';
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

export async function readErrLog(ws: Workspace, tutor: string, date: string, job: string): Promise<string> {
  try {
    return await readFile(conversationFiles(ws.dirs.conversations, tutor, date).err(job), 'utf8');
  } catch {
    return '';
  }
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

/** PATCH 允许改的顶层键(老师团页与设置页);kid / version / 运行时模板走编辑器 */
export const CONFIG_PATCH_KEYS = ['title', 'policyDefaults', 'tutors', 'agents', 'paths', 'server', 'tts'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** 深合并:对象递归、其余覆盖、null 删键(老师条目可整体删:tutors.x = null) */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObj(base) || !isObj(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = deepMerge(out[k], v);
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

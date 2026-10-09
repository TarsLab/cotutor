/**
 * 小老师的数据:workspace/xlaoshi/<id>/,一次讲课一个目录(《wip/小老师设想.md》§四 3)。
 * 不进对话索引、不进录像、不算条数;cotutor 别处不读这里。
 *
 *   session.json   题目、几时出的、家长记的一句
 *   topic.md       题目(给 Claude Code)
 *   talk.json      讲了多久、浏览器认出的段、音量、原声文件、补转的状态
 *   strokes.json   笔迹
 *   audio.<ext>    原声
 *   transcript.json 转写(浏览器的或 paraformer 的,家长改过的行带 edited)
 *   timeline.md + frames/  由上面几样生成,给 Claude Code 读
 *   notes.md       Claude Code 写
 *   asks.json + asks/      追问的回答
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GUIDE, GUIDE_FILE } from './guide.ts';
import { framePng } from './lib/png.ts';
import type { Strokes } from './lib/strokes.ts';
import { frameName, timelineMd, timelineRows, type AskRecord } from './lib/timeline.ts';
import type { AsrSource, BrowserSeg, Transcript } from './lib/transcript.ts';

export const ID_RE = /^\d{4}-\d{2}-\d{2}-\d{4}(?:-\d{1,2})?$/;

export interface Session {
  id: string;
  topic: string;
  createdAt: string;
  memo?: string;
}

export type AsrState = 'none' | 'running' | 'done' | 'failed' | 'nokey';

export interface Talk {
  startedAt: string;
  ms: number;
  sr: boolean;
  levels: number[];
  segs: BrowserSeg[];
  /** 原声文件名(目录里);没录上 = null */
  audio: string | null;
  /** paraformer 补转:none = 没叫(浏览器那份够);why = 为什么叫 */
  asr: { state: AsrState; why?: string; error?: string; source?: AsrSource };
}

export interface SessionData {
  session: Session;
  talk: Talk | null;
  strokes: Strokes | null;
  transcript: Transcript | null;
  notes: string | null;
  asks: AskRecord[];
}

export const rootOf = (wsRoot: string): string => join(wsRoot, 'xlaoshi');
export const dirOf = (wsRoot: string, id: string): string => join(rootOf(wsRoot), id);

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** 先写临时文件再换名:页面轮询时不会读到半截 */
export async function writeJson(file: string, v: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(v, null, 1)}\n`);
  await rename(tmp, file);
}

/** 整个 xlaoshi/ 不进 workspace 的 git(里面有孩子的原声;2026-10-09 拍板 10):自己放一份 .gitignore,骨架不动 */
const GITIGNORE = '# 小老师的数据(孩子的原声、笔迹)不进 git\n*\n';

/** 给 Claude Code 的说明与 .gitignore:每次都覆盖成这一版 */
export async function ensureGuide(wsRoot: string): Promise<void> {
  await mkdir(rootOf(wsRoot), { recursive: true });
  for (const [name, text] of [[GUIDE_FILE, GUIDE], ['.gitignore', GITIGNORE]] as const) {
    const f = join(rootOf(wsRoot), name);
    const cur = await readFile(f, 'utf8').catch(() => null);
    if (cur !== text) await writeFile(f, text);
  }
}

/** 新 id:日期-时分;同一分钟再出一题加 -2、-3 */
export function newId(wsRoot: string, now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const base = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  let id = base;
  for (let k = 2; existsSync(dirOf(wsRoot, id)); k++) id = `${base}-${k}`;
  return id;
}

export async function createSession(wsRoot: string, topic: string, now: Date): Promise<Session> {
  const id = newId(wsRoot, now);
  const dir = dirOf(wsRoot, id);
  await mkdir(dir, { recursive: true });
  const s: Session = { id, topic, createdAt: now.toISOString() };
  await writeJson(join(dir, 'session.json'), s);
  await writeFile(join(dir, 'topic.md'), `# ${topic}\n`);
  return s;
}

export async function readSession(wsRoot: string, id: string): Promise<SessionData | null> {
  const dir = dirOf(wsRoot, id);
  const session = await readJson<Session>(join(dir, 'session.json'));
  if (!session) return null;
  return {
    session,
    talk: await readJson<Talk>(join(dir, 'talk.json')),
    strokes: await readJson<Strokes>(join(dir, 'strokes.json')),
    transcript: await readJson<Transcript>(join(dir, 'transcript.json')),
    notes: await readFile(join(dir, 'notes.md'), 'utf8').catch(() => null),
    asks: (await readJson<AskRecord[]>(join(dir, 'asks.json'))) ?? [],
  };
}

export async function listSessions(wsRoot: string): Promise<SessionData[]> {
  const names = await readdir(rootOf(wsRoot)).catch(() => [] as string[]);
  const out: SessionData[] = [];
  for (const n of names.filter((x) => ID_RE.test(x)).sort().reverse()) {
    const d = await readSession(wsRoot, n);
    if (d) out.push(d);
  }
  return out;
}

const EMPTY: Strokes = { size: { w: 1200, h: 700 }, strokes: [] };

/** 重生成 timeline.md 与 frames/(笔迹、转写、追问变了就跑一次);帧整份重画,旧的删掉 */
export async function regenerate(wsRoot: string, id: string): Promise<void> {
  const d = await readSession(wsRoot, id);
  if (!d || !d.talk) return;
  const dir = dirOf(wsRoot, id);
  const strokes = d.strokes ?? EMPTY;
  const frames = join(dir, 'frames');
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });
  const seen = new Set<string>();
  for (const r of timelineRows(d.transcript, strokes, d.talk.ms)) {
    if (seen.has(r.frame)) continue;
    seen.add(r.frame);
    await writeFile(join(dir, r.frame), framePng(strokes, r.to));
  }
  const end = frameName(d.talk.ms);
  if (!seen.has(end)) await writeFile(join(dir, end), framePng(strokes, d.talk.ms));
  for (const [i, a] of d.asks.entries()) {
    if (a.strokes && a.strokes.strokes.length) await writeFile(join(frames, `ask-${i + 1}.png`), framePng(a.strokes, Number.MAX_SAFE_INTEGER));
  }
  await writeFile(join(dir, 'timeline.md'), timelineMd({ topic: d.session.topic, tr: d.transcript, strokes, totalMs: d.talk.ms, asks: d.asks }));
}

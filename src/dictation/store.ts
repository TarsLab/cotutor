/**
 * 听写的存放(《wip/听写设想.md》):workspace 根的 dictation/<id>.json,一次听写一个文件;孩子的笔迹整个不进 git(目录里放一份 .gitignore)。
 * id = 开始的时刻 YYYY-MM-DD-HHMM,同一分钟再开加 -2、-3。先写临时文件再换名,页面轮询读不到半截。
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DictationWord } from '../cards/index.ts';
import type { CharJudge, InkPoint } from './lib/match.ts';
import type { PhotoItem } from './recognize.ts';

export const ID_RE = /^\d{4}-\d{2}-\d{2}-\d{4}(?:-\d{1,2})?$/;

/** 一个格里写的:留下来的笔(撤销、擦掉的不在),撤销 / 擦掉了几次 */
export interface CharInk {
  strokes: InkPoint[][];
  undos: number;
}

/** 一个词写的一遍 */
export interface Attempt {
  at: string;
  chars: CharInk[];
  judges: CharJudge[];
}

/** 孩子在对答案时做的事:点开一个字逐笔看、问了再写一遍点「好」、自己说「我想再写」 */
export interface DictationEvent {
  at: string;
  kind: 'strokeOrder' | 'rewrite' | 'self' | 'again';
  word: number;
  char?: number;
}

export interface Session {
  id: string;
  /** 从哪份首页的第几张听写卡来的(首页 id 与听写卡的序号,0 起);拍照开始的 home = null、n = -1 */
  home: string | null;
  n: number;
  /** 拍照开始的:哪张照片(dictation/photos/<photo>.jpg)、照片上认出的课名 */
  photo?: string;
  lesson?: string | null;
  tutor: string | null;
  words: DictationWord[];
  startedAt: string;
  /** 第一遍:一个词一项,还没写的 null */
  first: (Attempt | null)[];
  /** 交了、开始对答案的时刻;之后第一遍不能改 */
  checkedAt: string | null;
  /** 对答案时问了「这个再写一遍?」的词 */
  asked: number[];
  /** 再写的:一个词可以写几遍 */
  rewrites: { word: number; self: boolean; attempt: Attempt }[];
  events: DictationEvent[];
  doneAt: string | null;
}

export const rootOf = (wsRoot: string): string => join(wsRoot, 'dictation');
const fileOf = (wsRoot: string, id: string): string => join(rootOf(wsRoot), `${id}.json`);

const GITIGNORE = '# 听写的数据(孩子的笔迹)不进 git\n*\n';

async function ensureRoot(wsRoot: string): Promise<void> {
  await mkdir(rootOf(wsRoot), { recursive: true });
  const f = join(rootOf(wsRoot), '.gitignore');
  if ((await readFile(f, 'utf8').catch(() => null)) !== GITIGNORE) await writeFile(f, GITIGNORE);
}

export async function writeSession(wsRoot: string, s: Session): Promise<void> {
  await ensureRoot(wsRoot);
  const file = fileOf(wsRoot, s.id);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(s)}\n`);
  await rename(tmp, file);
}

export async function readSession(wsRoot: string, id: string): Promise<Session | null> {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(await readFile(fileOf(wsRoot, id), 'utf8')) as Session;
  } catch {
    return null;
  }
}

/** 全部听写,新的在前 */
export async function listSessions(wsRoot: string): Promise<Session[]> {
  const names = await readdir(rootOf(wsRoot)).catch(() => [] as string[]);
  const ids = names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).filter((id) => ID_RE.test(id));
  const out: Session[] = [];
  for (const id of ids.sort().reverse()) {
    const s = await readSession(wsRoot, id);
    if (s) out.push(s);
  }
  return out;
}

const p2 = (n: number): string => String(n).padStart(2, '0');

export function newId(wsRoot: string, now: Date): string {
  const base = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
  let id = base;
  for (let k = 2; existsSync(fileOf(wsRoot, id)); k++) id = `${base}-${k}`;
  return id;
}

export async function createSession(wsRoot: string, init: { home: string | null; n: number; tutor: string | null; words: DictationWord[]; photo?: string; lesson?: string | null }, now: Date): Promise<Session> {
  await ensureRoot(wsRoot);
  const s: Session = { id: newId(wsRoot, now), ...init, startedAt: now.toISOString(), first: init.words.map(() => null), checkedAt: null, asked: [], rewrites: [], events: [], doneAt: null };
  await writeSession(wsRoot, s);
  return s;
}

// ---- 拍照认词表:dictation/photos/<id>.jpg 与 <id>.json(认的进度与结果) ----

export interface PhotoRecord {
  id: string;
  at: string;
  /** running 正在认(items 是已经认出的)/ done 认完 / failed 没认成(error 说为什么,items 是失败前认出的) */
  state: 'running' | 'done' | 'failed';
  items: PhotoItem[];
  lesson: string | null;
  error?: string;
  model?: string;
  ms?: number;
}

export const photosDir = (wsRoot: string): string => join(rootOf(wsRoot), 'photos');
export const photoFile = (wsRoot: string, id: string): string => join(photosDir(wsRoot), `${id}.jpg`);

export async function writePhotoRecord(wsRoot: string, r: PhotoRecord): Promise<void> {
  const file = join(photosDir(wsRoot), `${r.id}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(r)}\n`);
  await rename(tmp, file);
}

export async function readPhotoRecord(wsRoot: string, id: string): Promise<PhotoRecord | null> {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(await readFile(join(photosDir(wsRoot), `${id}.json`), 'utf8')) as PhotoRecord;
  } catch {
    return null;
  }
}

/** 存一张照片,开一份 running 的记录 */
export async function createPhoto(wsRoot: string, data: Buffer, now: Date): Promise<PhotoRecord> {
  await ensureRoot(wsRoot);
  await mkdir(photosDir(wsRoot), { recursive: true });
  const base = newId(wsRoot, now);
  let id = base;
  for (let k = 2; existsSync(photoFile(wsRoot, id)); k++) id = `${base}-${k}`;
  await writeFile(photoFile(wsRoot, id), data);
  const r: PhotoRecord = { id, at: now.toISOString(), state: 'running', items: [], lesson: null };
  await writePhotoRecord(wsRoot, r);
  return r;
}

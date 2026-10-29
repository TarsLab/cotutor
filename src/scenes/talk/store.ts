/**
 * 口语课的数据:workspace/talk/<id>/,一次一个目录。不进对话索引、不写 vault。
 * 口语课页只拍照、改口语单,上课在英语老师的实时页(src/runtime/talk-run.ts 读这里的 talk.json,那一课的录像在那个话题里)。
 *
 *   talk.json   口语单(读出来的 + 改过的)、状态
 *   photo.jpg   拍的那页
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TalkList } from './list.ts';

export const ID_RE = /^\d{4}-\d{2}-\d{2}-\d{4}(?:-\d{1,2})?$/;

/** draft = 还在改;ready = 改好了、交给老师了(「接着上」用它) */
export type TalkStatus = 'draft' | 'ready';

export interface TalkMeta {
  id: string;
  createdAt: string;
  status: TalkStatus;
  /** 照片文件名(目录里);没拍 = null */
  photo: string | null;
  list: TalkList;
  /** 口语单从哪来:omni 读的 / 家长手填 / 还没有;读失败记原因 */
  listBy: 'omni' | 'parent' | null;
  listError?: string;
  listMs?: number;
}

export const rootOf = (wsRoot: string): string => join(wsRoot, 'talk');
export const dirOf = (wsRoot: string, id: string): string => join(rootOf(wsRoot), id);

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return null; }
}
export const writeJson = (file: string, v: unknown): Promise<void> => writeFile(file, `${JSON.stringify(v, null, 2)}\n`);

const pad = (n: number): string => String(n).padStart(2, '0');
export function newId(root: string, now: Date): string {
  const base = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  let id = base;
  for (let k = 2; existsSync(dirOf(root, id)); k++) id = `${base}-${k}`;
  return id;
}

/** 开一次:目录 + talk.json(口语单先空着);照片有就落盘 */
export async function createTalk(root: string, now: Date, photo: Buffer | null): Promise<TalkMeta> {
  const id = newId(root, now);
  const dir = dirOf(root, id);
  await mkdir(dir, { recursive: true });
  if (photo) await writeFile(join(dir, 'photo.jpg'), photo);
  const meta: TalkMeta = { id, createdAt: now.toISOString(), status: 'draft', photo: photo ? 'photo.jpg' : null, list: { words: [], sentences: [] }, listBy: null };
  await writeJson(join(dir, 'talk.json'), meta);
  return meta;
}

export const readMeta = (root: string, id: string): Promise<TalkMeta | null> => readJson<TalkMeta>(join(dirOf(root, id), 'talk.json'));
export const writeMeta = (root: string, meta: TalkMeta): Promise<void> => writeJson(join(dirOf(root, meta.id), 'talk.json'), meta);

/** 全部,新的在前 */
export async function listTalks(root: string): Promise<TalkMeta[]> {
  let names: string[] = [];
  try { names = (await readdir(rootOf(root))).filter((n) => ID_RE.test(n)); } catch { return []; }
  const out: TalkMeta[] = [];
  for (const n of names.sort().reverse()) { const m = await readMeta(root, n); if (m) out.push(m); }
  return out;
}

export const deleteTalk = (root: string, id: string): Promise<void> => rm(dirOf(root, id), { recursive: true, force: true });

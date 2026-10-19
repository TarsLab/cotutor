/**
 * 口语课的数据:workspace/talk/<id>/,一次一个目录(《口语课设计.md》§四)。
 * 不进对话索引、不进录像、不算每日条数、不写 vault;cotutor 别处不读这里。
 *
 *   talk.json        口语单(读出来的 + 家长改过的)、状态、用的模型音色、通话的几样数
 *   photo.jpg        家长拍的那页
 *   transcript.json  通话的字:一行一句(谁、字、离开始的毫秒、哪一段)、用量、用到了哪些词
 *   kid.wav / tutor.wav  两边的声音(16k / 24k PCM16,各自首尾相接,没有时刻)
 *   reel.json / call.wav 录像:每条消息带毫秒 / 两边按到达时刻混成一条(24k)
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Usage } from '../live/realtime.ts';
import type { CallReel } from '../live/recorder.ts';
import { usedIn, type Line, type TalkList, type Used } from './lib/used.ts';
import { MIX_RATE } from '../live/lib/mix.ts';
import { wavOfPcm } from '../live/lib/wav.ts';

export const ID_RE = /^\d{4}-\d{2}-\d{2}-\d{4}(?:-\d{1,2})?$/;

export type TalkStatus = 'draft' | 'ready' | 'done';

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
  /** 照着哪一次的口语单再开的(孩子从首页的「口语课」进来,上一次已经聊过) */
  from?: string;
  /** 通话完了记的 */
  call?: { startedAt: string; ms: number; why: string; model: string; voice: string; items: number; read: number };
}

export interface Transcript {
  startedAt: string;
  ms: number;
  why: string;
  lines: Line[];
  usage: Usage;
  used: Used;
}

export interface TalkData { meta: TalkMeta; transcript: Transcript | null; hasKidAudio: boolean; hasTutorAudio: boolean; hasReel: boolean }

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

export async function readTalk(root: string, id: string): Promise<TalkData | null> {
  const meta = await readMeta(root, id);
  if (!meta) return null;
  const dir = dirOf(root, id);
  return { meta, transcript: await readJson<Transcript>(join(dir, 'transcript.json')), hasKidAudio: existsSync(join(dir, 'kid.wav')), hasTutorAudio: existsSync(join(dir, 'tutor.wav')), hasReel: existsSync(join(dir, 'reel.json')) };
}

/** 全部,新的在前 */
export async function listTalks(root: string): Promise<TalkMeta[]> {
  let names: string[] = [];
  try { names = (await readdir(rootOf(root))).filter((n) => ID_RE.test(n)); } catch { return []; }
  const out: TalkMeta[] = [];
  for (const n of names.sort().reverse()) { const m = await readMeta(root, n); if (m) out.push(m); }
  return out;
}

export const deleteTalk = (root: string, id: string): Promise<void> => rm(dirOf(root, id), { recursive: true, force: true });

/** 录像的数据(《口语课设计.md》§8.3):形状见 src/live/recorder.ts;声音另在 call.wav */
export type TalkReel = CallReel;

/** 通话完了:字、用量、用到的词、两边的声音、录像一起落盘;meta 标 done */
export async function finishCall(root: string, meta: TalkMeta, call: { startedAt: string; ms: number; why: string; model: string; voice: string; items: number; read: number; lines: Line[]; usage: Usage; kidPcm: Buffer; tutorPcm: Buffer; kidRate: number; tutorRate: number; reel?: TalkReel; callPcm?: Buffer }): Promise<void> {
  const dir = dirOf(root, meta.id);
  await mkdir(dir, { recursive: true });
  const transcript: Transcript = { startedAt: call.startedAt, ms: call.ms, why: call.why, lines: call.lines, usage: call.usage, used: usedIn(meta.list, call.lines) };
  // 字最后写:回看页拿到字就当这一次落盘完了(声音、录像都在)
  if (call.kidPcm.length) await writeFile(join(dir, 'kid.wav'), wavOfPcm(call.kidPcm, call.kidRate));
  if (call.tutorPcm.length) await writeFile(join(dir, 'tutor.wav'), wavOfPcm(call.tutorPcm, call.tutorRate));
  if (call.callPcm?.length) await writeFile(join(dir, 'call.wav'), wavOfPcm(call.callPcm, MIX_RATE));
  if (call.reel) await writeFile(join(dir, 'reel.json'), JSON.stringify(call.reel));
  await writeJson(join(dir, 'transcript.json'), transcript);
  meta.status = 'done';
  meta.call = { startedAt: call.startedAt, ms: call.ms, why: call.why, model: call.model, voice: call.voice, items: call.items, read: call.read };
  await writeMeta(root, meta);
}

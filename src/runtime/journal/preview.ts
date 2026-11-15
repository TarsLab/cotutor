/**
 * 话题的预览图(2026-11-15):孩子端板停下来时舞台导一张小图交上来,存成 <date>.<话题>.preview.jpg,只留最新一张;
 * 首页「今天」那一格用它(src/runtime/kid-view.ts 的 startedThreads 定哪些话题上首页)。还没有预览图就拿孩子发的最后一张照片。
 */
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { conversationFiles, threads, type Workspace } from '../../schema/index.ts';
import { jpegFromDataUrl } from '../../shared/jpeg.ts';
import { readIndex } from './store.ts';

/** 预览图的 base64 最多多长(舞台导的长边 480,几十 KB;放宽到一张清楚的大图) */
export const PREVIEW_B64_MAX = 400_000;

/** 存一张预览图:话题得是这一天这位老师的(孩子端只能写今天的);不是 jpeg、太大、没这个话题 → false */
export async function writePreview(ws: Workspace, tutor: string, date: string, thread: string, image: unknown): Promise<boolean> {
  const buf = jpegFromDataUrl(image, PREVIEW_B64_MAX);
  if (!buf || !thread) return false;
  const index = await readIndex(ws, tutor, date).catch(() => null);
  if (!index || !threads(index.messages).includes(thread)) return false;
  const file = conversationFiles(ws.dirs.conversations, tutor, date).preview(thread);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, buf);
  await rename(`${file}.tmp`, file);
  return true;
}

/** 这个话题的预览图在哪、什么时候存的(毫秒,孩子端拿它破缓存);没有 → null */
export async function previewOf(ws: Workspace, tutor: string, date: string, thread: string): Promise<{ file: string; mtime: number } | null> {
  const file = conversationFiles(ws.dirs.conversations, tutor, date).preview(thread);
  const st = await stat(file).catch(() => null);
  return st?.isFile() ? { file, mtime: Math.round(st.mtimeMs) } : null;
}

/**
 * 一节课的状态落盘(形状在 src/schema/lesson.ts,怎么变在 src/board/lesson.ts):一个话题一份 <date>.<话题>.lesson.json,旁边是板的日志。
 * 改它一律经 updateLesson:同一个文件的改动排成一条链(孩子一秒落两三笔,老师这一轮的动作也在同时落),读 → lessonStep → 写,不丢、不交错。
 * 读不出来(没有、坏了、旧的形状)当还什么都没铺。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { lessonInit } from '../../board/lesson.ts';
import { LessonSchema, conversationFiles, type Lesson, type Workspace } from '../../schema/index.ts';

const chains = new Map<string, Promise<unknown>>();

export const lessonFile = (ws: Workspace, tutor: string, date: string, thread: string): string => conversationFiles(ws.dirs.conversations, tutor, date).lesson(thread);

async function load(file: string): Promise<Lesson> {
  const text = await readFile(file, 'utf8').catch(() => '');
  if (!text) return lessonInit();
  try {
    const r = LessonSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : lessonInit();
  } catch {
    return lessonInit();
  }
}

/** 这节课现在的样子(等排着的改动写完) */
export async function readLesson(ws: Workspace, tutor: string, date: string, thread: string): Promise<Lesson> {
  const file = lessonFile(ws, tutor, date, thread);
  await chains.get(file)?.catch(() => undefined);
  return load(file);
}

/** 改一次:f 拿到现在的样子、回新的样子(一样就不写);回改完的样子。写不下不抛(丢一次改动不该挡住孩子),回改之前的 */
export function updateLesson(ws: Workspace, tutor: string, date: string, thread: string, f: (l: Lesson) => Lesson): Promise<Lesson> {
  const file = lessonFile(ws, tutor, date, thread);
  const next = (chains.get(file) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const cur = await load(file);
      const out = f(cur);
      if (out === cur) return cur;
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(out));
        await rename(`${file}.tmp`, file);
        return out;
      } catch {
        return cur;
      }
    });
  chains.set(file, next);
  void next.finally(() => { if (chains.get(file) === next) chains.delete(file); });
  return next;
}

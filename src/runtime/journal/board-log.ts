/**
 * 板的日志的读写(形状在 src/schema/board-log.ts):一个话题一份 jsonl,一件事一行,只追加。
 * 同一个文件的追加排成一条链(孩子一秒点两三下,两次 appendFile 不交错也不丢)。读的时候坏行跳过。
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BoardEventSchema, conversationFiles, type BoardEvent, type Workspace } from '../../schema/index.ts';

const chains = new Map<string, Promise<void>>();

export function boardLogFile(ws: Workspace, tutor: string, date: string, thread: string): string {
  return conversationFiles(ws.dirs.conversations, tutor, date).board(thread);
}

/** 追加一件事;写不下不抛(板的日志丢一行不该挡住孩子) */
export function appendBoard(ws: Workspace, tutor: string, date: string, thread: string, ev: BoardEvent): Promise<void> {
  const file = boardLogFile(ws, tutor, date, thread);
  const next = (chains.get(file) ?? Promise.resolve())
    .then(async () => {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(ev)}\n`);
    })
    .catch(() => undefined);
  chains.set(file, next);
  void next.finally(() => { if (chains.get(file) === next) chains.delete(file); });
  return next;
}

/** 这个话题板上的事,照先后;没有文件回 [] */
export async function readBoard(ws: Workspace, tutor: string, date: string, thread: string): Promise<BoardEvent[]> {
  const file = boardLogFile(ws, tutor, date, thread);
  await chains.get(file);
  const text = await readFile(file, 'utf8').catch(() => '');
  const out: BoardEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = BoardEventSchema.safeParse(JSON.parse(line));
      if (r.success) out.push(r.data);
    } catch { /* 坏行跳过 */ }
  }
  return out;
}

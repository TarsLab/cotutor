/**
 * 左栏的纸(《画板设计.md》§三):孩子在实时老师页左栏点「画板」打开的那张,一个话题一张,一直能改,关了不丢。
 * 存 conversations/<老师>/<日期>.<话题>.paper.json(状态同画板卡:笔迹 + 清空前存的那几版),每次存另记一行 .paper.jsonl(以后录像现画用);
 * 话题还没有(新话题、空板)时叫 new,这个话题的第一条发出去就改名成话题 id(adoptPaper)。删话题按 <日期>.<话题>.* 一起删。
 * 「给老师看」时孩子端先把导出的图传进 captures/,消息带 {drawing: {key, image}};这里按纸上的笔迹算摘要(几笔、各颜色、多久、清掉的那几版),记进消息。
 */
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Workspace } from '../cli/workspace.ts';
import { CanvasStateSchema, type CanvasState } from '../cards/canvas.ts';
import { canvasStrokes, canvasSummary, canvasMinutesText } from '../lib/canvas-chat.ts';
import type { ConversationMessage } from '../schema/index.ts';

/** 纸的名字:话题 id(<HHMM>-<n>),或 new(话题还没有) */
export const PAPER_KEY_RE = /^(?:new|\d{4}-\d+)$/;

/** 只交了画、没说话时这条消息的字(同「(拍了一张)」;孩子端不把它当孩子说的话,kid-board.ts 的 DRAW_ONLY) */
export const DRAW_ONLY_TEXT = '(画了一张,没说话)';

export type PaperState = Pick<CanvasState, 'ink' | 'cleared'>;

const paperFile = (ws: Workspace, tutor: string, date: string, key: string, ext: 'json' | 'jsonl'): string => join(ws.dirs.conversations, tutor, `${date}.${key}.paper.${ext}`);

/** 读一张纸;没有、坏了都是空白的 */
export async function readPaper(ws: Workspace, tutor: string, date: string, key: string): Promise<PaperState> {
  if (!PAPER_KEY_RE.test(key)) return { ink: [] };
  try {
    const r = CanvasStateSchema.safeParse(JSON.parse(await readFile(paperFile(ws, tutor, date, key, 'json'), 'utf8')));
    if (r.success) return { ink: r.data.ink, ...(r.data.cleared?.length ? { cleared: r.data.cleared } : {}) };
  } catch { /* 没有 */ }
  return { ink: [] };
}

/** 存一张纸(整份),另记一行实录 */
export async function writePaper(ws: Workspace, tutor: string, date: string, key: string, state: PaperState, now: Date): Promise<void> {
  const st = { ink: state.ink, ...(state.cleared?.length ? { cleared: state.cleared } : {}) };
  await mkdir(join(ws.dirs.conversations, tutor), { recursive: true });
  await writeFile(paperFile(ws, tutor, date, key, 'json'), JSON.stringify(st));
  await appendFile(paperFile(ws, tutor, date, key, 'jsonl'), `${JSON.stringify({ at: now.getTime(), k: 'paper', state: st })}\n`).catch(() => {});
}

/** 新话题的第一条发出去了:话题还没有时画的那张(new)归这个话题;这个话题已经有一张就不动 */
export async function adoptPaper(ws: Workspace, tutor: string, date: string, thread: string): Promise<void> {
  if (!PAPER_KEY_RE.test(thread) || thread === 'new') return;
  const from = paperFile(ws, tutor, date, 'new', 'json');
  if (!existsSync(from) || existsSync(paperFile(ws, tutor, date, thread, 'json'))) return;
  await rename(from, paperFile(ws, tutor, date, thread, 'json')).catch(() => {});
  await rename(paperFile(ws, tutor, date, 'new', 'jsonl'), paperFile(ws, tutor, date, thread, 'jsonl')).catch(() => {});
}

/** 删一张纸(测试、清场用) */
export async function dropPaper(ws: Workspace, tutor: string, date: string, key: string): Promise<void> {
  for (const ext of ['json', 'jsonl'] as const) await rm(paperFile(ws, tutor, date, key, ext), { force: true });
}

/** 交画:按纸上的笔迹算这条消息记的摘要(几笔、各颜色几笔、画了多久、清掉的那几版的图) */
export function paperDrawing(state: PaperState, image: string): NonNullable<ConversationMessage['drawing']> {
  const sum = canvasSummary(canvasStrokes(state.ink));
  const cleared = state.cleared ?? [];
  const named = sum.colors.filter((c) => c.name !== '别的颜色');
  const starts = [...cleared.map((c) => c.from ?? c.at), ...(sum.firstAt !== null ? [sum.firstAt] : [])].filter((x) => x > 0);
  const end = sum.lastAt ?? (cleared.length ? cleared[cleared.length - 1].at : null);
  const imgs = cleared.flatMap((c) => (c.image ? [c.image] : []));
  return {
    image,
    strokes: sum.strokes,
    ...(named.length ? { colors: named.map((c) => `${c.name} ${c.strokes}`).join('、') } : {}),
    ...(starts.length && end !== null ? { ms: Math.max(0, end - Math.min(...starts)) } : {}),
    ...(imgs.length ? { cleared: imgs } : {}),
  };
}

/** 上下文包 drawing: 那一句;first = 这张画在 photos 里是第几张(1 起),清掉的那几版紧跟在后面 */
export function drawingPackLine(d: NonNullable<ConversationMessage['drawing']>, first: number): string {
  const parts = [`孩子在纸上画的,photos 第 ${first} 张`, `画了 ${d.strokes} 笔${d.colors ? `(${d.colors})` : ''}`];
  if (d.ms !== undefined) parts.push(`画了${canvasMinutesText(d.ms)}`);
  const n = d.cleared?.length ?? 0;
  if (n) parts.push(`清空重画过,清掉的那几版是 photos 第 ${n === 1 ? first + 1 : `${first + 1}–${first + n}`} 张`);
  return parts.join(';');
}

/**
 * 小课堂(《小课堂设计.md》)读盘的那一半:从 bundles/<id>/ 读课包,拼时钟(src/lib/lecture.ts),
 * 给首页按钮的标题与课长、首页检查、上下文包 lecture: 用。课包坏了、不在都回 null,不抛。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUNDLE_ID_RE } from '../cards/scene.ts';
import { clockLabel, describeMark, lectureAt, lectureClock, lectureLines, type LectureBlock, type LectureClock, type LectureMark, type LectureSkeleton, type LectureStep } from '../lib/lecture.ts';
import type { ContextPack } from '../schema/index.ts';
import type { Workspace } from '../cli/workspace.ts';

export interface Lecture {
  id: string;
  title: string;
  problem: string;
  /** 课包的科目(scene.json 的 subject);没写 = null */
  subject: string | null;
  clock: LectureClock;
  /** drawtell 的词级命中块(scene.blocks);圈住块里的字说块的 text */
  blocks: LectureBlock[];
}

export async function readLecture(ws: Pick<Workspace, 'dirs'>, id: string): Promise<Lecture | null> {
  if (!BUNDLE_ID_RE.test(id)) return null;
  const dir = join(ws.dirs.bundles, id);
  try {
    const scene = JSON.parse(await readFile(join(dir, 'scene.json'), 'utf8')) as { title?: unknown; problem?: unknown; subject?: unknown; skeletons?: unknown; blocks?: unknown };
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { steps?: unknown };
    if (!Array.isArray(scene.skeletons) || !Array.isArray(manifest.steps) || !manifest.steps.length) return null;
    const clock = lectureClock(scene.skeletons as LectureSkeleton[], manifest.steps as LectureStep[]);
    const blocks = Array.isArray(scene.blocks) ? (scene.blocks as Partial<LectureBlock>[]).filter((b): b is LectureBlock => typeof b?.id === 'string' && typeof b.text === 'string' && Array.isArray(b.elementIds)) : [];
    return { id, title: String(scene.title ?? id), problem: String(scene.problem ?? ''), subject: typeof scene.subject === 'string' ? scene.subject : null, clock, blocks };
  } catch {
    return null;
  }
}

/** 孩子看完带来的:看了多久、看完没、停过几次;again = 问过以后「再看一遍」又圈了(这条只为带圈) */
export interface LectureWatch {
  watchedMs: number;
  finished: boolean;
  pauses: number;
  again?: boolean;
}

/** 落盘的一处圈:时刻、SVG 停在哪(画缩略图用,毫秒)、路径(课包坐标)、算出来的那段话(课包读不出来时没有) */
export interface StoredMark extends LectureMark {
  svgMs: number;
  text?: string;
}

/** 孩子带来的圈 → 落盘的样子:SVG 时刻与那段话由课包现算(《小课堂设计.md》§四);课包读不出来就只留时刻与路径 */
export function storedMarks(l: Lecture | null, marks: readonly LectureMark[]): StoredMark[] {
  return marks.map((m) => ({ atMs: m.atMs, svgMs: l ? Math.round(lectureAt(l.clock, m.atMs).svgMs * 10) / 10 : 0, path: m.path, ...(l ? { text: describeMark(l.clock, m, l.blocks).text } : {}) }));
}

/** 上下文包 lecture: 段:标题、来源、课长、每句起点与原话、看的情况、圈过的几处 */
export function lecturePack(l: Lecture, w: LectureWatch, marks: readonly StoredMark[] = []): NonNullable<ContextPack['lecture']> {
  const seen = w.finished ? (w.again ? '又看完了一遍' : '看完了') : `${w.again ? '又看了一遍,' : ''}看到 ${clockLabel(w.watchedMs)}`;
  const watched = `${seen}${w.pauses ? `,停过 ${w.pauses} 次` : ''}${marks.length ? `,圈了 ${marks.length} 处` : ''}`;
  return { title: l.title, source: `bundle ${l.id}`, length: clockLabel(l.clock.total), lines: lectureLines(l.clock), watched, marks: marks.flatMap((m) => (m.text ? [m.text] : [])) };
}

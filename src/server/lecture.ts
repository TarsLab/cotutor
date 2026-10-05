/**
 * 小课堂(《小课堂设计.md》)读盘的那一半:从 bundles/<id>/ 读课包,拼时钟(src/lib/lecture.ts),
 * 给首页按钮的标题与课长、首页检查、上下文包 lecture: 用。课包坏了、不在都回 null,不抛。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUNDLE_ID_RE } from '../cards/scene.ts';
import { clockLabel, lectureClock, lectureLines, type LectureClock, type LectureSkeleton, type LectureStep } from '../lib/lecture.ts';
import type { ContextPack } from '../schema/index.ts';
import type { Workspace } from '../cli/workspace.ts';

export interface Lecture {
  id: string;
  title: string;
  problem: string;
  /** 课包的科目(scene.json 的 subject);没写 = null */
  subject: string | null;
  clock: LectureClock;
}

export async function readLecture(ws: Pick<Workspace, 'dirs'>, id: string): Promise<Lecture | null> {
  if (!BUNDLE_ID_RE.test(id)) return null;
  const dir = join(ws.dirs.bundles, id);
  try {
    const scene = JSON.parse(await readFile(join(dir, 'scene.json'), 'utf8')) as { title?: unknown; problem?: unknown; subject?: unknown; skeletons?: unknown };
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { steps?: unknown };
    if (!Array.isArray(scene.skeletons) || !Array.isArray(manifest.steps) || !manifest.steps.length) return null;
    const clock = lectureClock(scene.skeletons as LectureSkeleton[], manifest.steps as LectureStep[]);
    return { id, title: String(scene.title ?? id), problem: String(scene.problem ?? ''), subject: typeof scene.subject === 'string' ? scene.subject : null, clock };
  } catch {
    return null;
  }
}

/** 孩子看完带来的:看了多久、看完没、停过几次 */
export interface LectureWatch {
  watchedMs: number;
  finished: boolean;
  pauses: number;
}

/** 上下文包 lecture: 段:标题、来源、课长、每句起点与原话、看的情况 */
export function lecturePack(l: Lecture, w: LectureWatch): NonNullable<ContextPack['lecture']> {
  const watched = `${w.finished ? '看完了' : `看到 ${clockLabel(w.watchedMs)}`}${w.pauses ? `,停过 ${w.pauses} 次` : ''}`;
  return { title: l.title, source: `bundle ${l.id}`, length: clockLabel(l.clock.total), lines: lectureLines(l.clock), watched };
}

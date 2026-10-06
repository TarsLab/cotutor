/**
 * 小课堂(《小课堂设计.md》)读盘的那一半:从 bundles/<id>/ 读课包,或从 lectures/<id>/ 读视频(lecture.md + video.mp4,第 4 步),拼时钟(src/lib/lecture.ts),
 * 给首页按钮的标题与课长、首页检查、上下文包 lecture: 用。同一个 id 两边都有,课包先。坏了、不在都回 null,不抛;为什么读不出来给首页检查(inspectLecture)。
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BUNDLE_ID_RE } from '../cards/scene.ts';
import { mp4DurationMs } from './mp4.ts';
import { LECTURE_FILE, LECTURE_VIDEO, clockLabel, describeMark, lectureAt, lectureClock, lectureLines, lectureRange, parseLectureDoc, videoClock, type LectureClock, type LectureMark, type LecturePicture, type LectureSkeleton, type LectureStep } from '../lib/lecture.ts';
import { bakeMatches, elementsAtSvgTime, renderFrameSvg } from 'drawtell/core';
import type { ContextPack } from '../schema/index.ts';
import type { BoardCard, BoardSection } from '../lib/kid-board.ts';

export interface Lecture {
  id: string;
  title: string;
  problem: string;
  /** 课包的科目(scene.json 的 subject);没写 = null */
  subject: string | null;
  clock: LectureClock;
  /** 画面的语义(课包的 groups、blocks 与 build 时量好的 bounds):圈住了什么靠它说;视频没有 */
  picture: LecturePicture;
  /** 视频(lectures/<id>/video.mp4);false = 课包 */
  video: boolean;
  /** 课包烤过(bake.json 和画面对得上):孩子端不用 excalidraw 现画,缩略图服务端出 */
  baked?: boolean;
}

/** 读小课堂要的目录:课包,与视频(没给就只认课包) */
export interface LectureDirs {
  dirs: { bundles: string; lectures?: string };
}

export async function readLecture(ws: LectureDirs, id: string): Promise<Lecture | null> {
  return (await inspectLecture(ws, id)).lecture;
}

/** 读一份小课堂:课包先,再视频;读不出来的,problems 说为什么(首页检查用) */
export async function inspectLecture(ws: LectureDirs, id: string): Promise<{ lecture: Lecture | null; problems: string[] }> {
  if (!BUNDLE_ID_RE.test(id)) return { lecture: null, problems: [`${id} 不是合规的 id(小写字母、数字、连字符)`] };
  const bundle = await readBundleLecture(ws, id);
  if (bundle) return { lecture: bundle, problems: [] };
  if (!ws.dirs.lectures) return { lecture: null, problems: [`bundles/${id}/ 不在或读不出来(要有 scene.json 与带步的 manifest.json)`] };
  const dir = join(ws.dirs.lectures, id);
  const md = await readFile(join(dir, LECTURE_FILE), 'utf8').catch(() => null);
  const hasVideo = Boolean((await stat(join(dir, LECTURE_VIDEO)).catch(() => null))?.isFile());
  if (md === null && !hasVideo) return { lecture: null, problems: [`bundles/${id}/ 与 lectures/${id}/ 都没有(课包要有 scene.json 与带步的 manifest.json;视频要有 ${LECTURE_VIDEO} 与 ${LECTURE_FILE})`] };
  const problems: string[] = [];
  if (!hasVideo) problems.push(`lectures/${id}/ 没有 ${LECTURE_VIDEO}`);
  if (md === null) problems.push(`lectures/${id}/ 没有 ${LECTURE_FILE}(# 标题,一行一句「分:秒 原话」)`);
  const doc = parseLectureDoc(md ?? '');
  if (md !== null) for (const i of doc.issues.filter((x) => x.level === 'fix')) problems.push(`lectures/${id}/${LECTURE_FILE}${i.line ? ` 第 ${i.line} 行` : ''}:${i.text}`);
  const total = hasVideo ? await mp4DurationMs(join(dir, LECTURE_VIDEO)) : null;
  if (hasVideo && total === null) problems.push(`lectures/${id}/${LECTURE_VIDEO} 读不出时长(要是 mp4)`);
  if (total !== null) for (const c of doc.chapters.filter((x) => x.start >= total)) problems.push(`lectures/${id}/${LECTURE_FILE} 第 ${c.at} 行:${clockLabel(c.start)} 超过了视频的长度 ${clockLabel(total)}`);
  if (problems.length || total === null) return { lecture: null, problems };
  return { lecture: { id, title: doc.title, problem: '', subject: doc.subject, clock: videoClock(doc.chapters, total), picture: {}, video: true }, problems: [] };
}

async function readBundleLecture(ws: LectureDirs, id: string): Promise<Lecture | null> {
  const dir = join(ws.dirs.bundles, id);
  try {
    const scene = JSON.parse(await readFile(join(dir, 'scene.json'), 'utf8')) as { title?: unknown; problem?: unknown; subject?: unknown; skeletons?: unknown; groups?: unknown; bounds?: unknown };
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { steps?: unknown; blocks?: unknown };
    if (!Array.isArray(scene.skeletons) || !Array.isArray(manifest.steps) || !manifest.steps.length) return null;
    const clock = lectureClock(scene.skeletons as LectureSkeleton[], manifest.steps as LectureStep[]);
    // 分组与 bounds 在 scene.json(画面),命中块在 manifest.json(交互);形状不对的丢掉,不拦
    const listOf = <T extends { elementIds: unknown }>(v: unknown, ok: (x: Record<string, unknown>) => boolean): T[] => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === 'object' && Array.isArray(x.elementIds) && ok(x)) as unknown as T[] : []);
    const picture: LecturePicture = {
      groups: listOf(scene.groups, (g) => typeof g.id === 'string' && typeof g.label === 'string'),
      blocks: listOf(manifest.blocks, (b) => typeof b.id === 'string' && typeof b.text === 'string'),
      ...(scene.bounds && typeof scene.bounds === 'object' ? { bounds: scene.bounds as NonNullable<LecturePicture['bounds']> } : {}),
    };
    const baked = await readFile(join(dir, 'bake.json'), 'utf8').then((t) => bakeMatches(JSON.parse(t), scene), () => false);
    return { id, title: String(scene.title ?? id), problem: String(scene.problem ?? ''), subject: typeof scene.subject === 'string' ? scene.subject : null, clock, picture, video: false, baked };
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

/** 孩子带来的一处圈;视频的带一张截好的图(captures/ 里,已经叠上了圈) */
export interface IncomingMark extends LectureMark {
  image?: string;
  /** 圈下去的那一刻:离这条消息发出去多少毫秒(≤ 0;录像用) */
  t?: number;
}

/** 落盘的一处圈:时刻、SVG 停在哪(画缩略图用,毫秒)、路径(课包坐标;视频是视频自己的像素坐标)、算出来的那段话(读不出来时没有)、视频的截图 */
export interface StoredMark extends IncomingMark {
  svgMs: number;
  text?: string;
}

/**
 * 孩子带来的圈 → 落盘的样子(《小课堂设计.md》§四):课包的 SVG 时刻与那段话由课包现算;
 * 视频算不出圈住了什么,那段话只说那时在讲哪句、截图是上下文包 photos 的第几张(photoBase = 前面已经有几张孩子自己拍的)。读不出来就只留时刻与路径
 */
export function storedMarks(l: Lecture | null, marks: readonly IncomingMark[], photoBase = 0): StoredMark[] {
  let k = photoBase;
  return marks.map((m) => {
    const shot = m.image ? ++k : null;
    const base = { atMs: m.atMs, svgMs: l && !l.video ? Math.round(lectureAt(l.clock, m.atMs).svgMs * 10) / 10 : 0, path: m.path, ...(m.image ? { image: m.image } : {}), ...(m.t !== undefined ? { t: m.t } : {}) };
    if (!l) return base;
    if (!l.video) return { ...base, text: describeMark(l.clock, m, l.picture).text };
    const line = l.clock.segments[lectureAt(l.clock, m.atMs).index]?.line.trim() ?? '';
    return { ...base, text: `${clockLabel(m.atMs)} 圈的${line ? `,那时在讲『${line}』` : ''};${shot ? `圈在截图上(photos 第 ${shot} 张)` : '没有截图,看不出圈的是什么'}` };
  });
}

/** 上下文包 lecture: 段:标题、来源、课长、每句起点与原话、看的情况、圈过的几处 */
export function lecturePack(l: Lecture, w: LectureWatch, marks: readonly StoredMark[] = []): NonNullable<ContextPack['lecture']> {
  const seen = w.finished ? (w.again ? '又看完了一遍' : '看完了') : `${w.again ? '又看了一遍,' : ''}看到 ${clockLabel(w.watchedMs)}`;
  const watched = `${seen}${w.pauses ? `,停过 ${w.pauses} 次` : ''}${marks.length ? `,圈了 ${marks.length} 处` : ''}`;
  return { title: l.title, source: `${l.video ? 'video' : 'bundle'} ${l.id}`, length: clockLabel(l.clock.total), lines: lectureLines(l.clock), watched, marks: marks.flatMap((m) => (m.text ? [m.text] : [])) };
}

/**
 * 小课堂卡(cards/lecture)下发时补的快照:课名、真放的起止(对齐段界)、末帧停在 SVG 的哪一刻、能不能放。
 * 课包每次现读(家长重做了课包,下一次下发就跟上);读不出来或起止对不上 → ready: false,讲稿 [[play]] 不停。
 */
export async function enrichLectures(ws: LectureDirs, section: BoardSection): Promise<BoardSection> {
  if (!section.cards.some((c) => c.kind === 'lecture')) return section;
  const seen = new Map<string, Promise<Lecture | null>>();
  const cards: BoardCard[] = [];
  for (const c of section.cards) {
    const p = c.props as { bundle?: unknown; from?: unknown; to?: unknown };
    if (c.kind !== 'lecture' || typeof p.bundle !== 'string') { cards.push(c); continue; }
    if (!seen.has(p.bundle)) seen.set(p.bundle, readLecture(ws, p.bundle));
    const l = await seen.get(p.bundle)!;
    const r = l ? lectureRange(l.clock, typeof p.from === 'number' ? p.from : undefined, typeof p.to === 'number' ? p.to : undefined) : null;
    // 视频没有 SVG:末帧的缩略图页面用 <video> 停在 end 前一点
    cards.push({ ...c, props: { ...c.props, ...(l ? { title: l.title } : {}), ...(l?.video ? { video: true } : {}), ...(l && r ? { start: r.start, end: r.end, ...(l.video ? {} : { still: Math.round(lectureAt(l.clock, Math.max(r.start, r.end - 1)).svgMs * 10) / 10 }) } : {}), ready: Boolean(l && r) } });
  }
  return { ...section, cards };
}

/**
 * 课包在 SVG 时刻 svgMs 的画面(圈的卡、lecture 卡的缩略图;《小课堂设计.md》§五):用烤好的画面(bake.json)在服务端现画成一张 SVG,
 * 有圈就叠上圈(课包坐标,加上导出时的平移)。没烤过、画面改过没重烤 → null(页面退回在浏览器里克隆播放器的 SVG)。
 * 背景图内嵌成 data URI:SVG 当 <img> 用时不去取外面的文件。
 */
export async function lectureFrameSvg(ws: Pick<LectureDirs, 'dirs'>, id: string, svgMs: number, ring: readonly [number, number][] = []): Promise<string | null> {
  if (!BUNDLE_ID_RE.test(id)) return null;
  const dir = join(ws.dirs.bundles, id);
  try {
    const [sceneRaw, manifestRaw, bakedRaw] = await Promise.all(['scene.json', 'manifest.json', 'bake.json'].map((f) => readFile(join(dir, f), 'utf8')));
    const scene = JSON.parse(sceneRaw) as { skeletons?: unknown; background?: unknown };
    const baked: unknown = JSON.parse(bakedRaw);
    if (!bakeMatches(baked, scene) || !Array.isArray(scene.skeletons)) return null;
    const steps = (JSON.parse(manifestRaw) as { steps?: unknown }).steps;
    const clock = lectureClock(scene.skeletons as LectureSkeleton[], (Array.isArray(steps) ? steps : []) as LectureStep[]);
    const [dx, dy] = baked.offset;
    const overlay = ring.length >= 2 ? `<path d="${ring.map((p, i) => `${i ? 'L' : 'M'}${p[0] + dx} ${p[1] + dy}`).join(' ')}" fill="none" stroke="#2f6fd6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : '';
    let backgroundHref: string | undefined;
    if (baked.background) {
      const ext = baked.background.src.split('.').pop()?.toLowerCase() ?? 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
      const data = await readFile(join(dir, baked.background.src)).catch(() => null);
      if (data) backgroundHref = `data:${mime};base64,${data.toString('base64')}`;
    }
    return renderFrameSvg(baked, new Map(elementsAtSvgTime(clock, svgMs).map((e) => [e.id, e.progress])), { overlay, ...(backgroundHref ? { backgroundHref } : {}) });
  } catch {
    return null;
  }
}

/** frame.svg 的 ring 参数:「x,y;x,y;…」(课包坐标,取整);认不出来 = 没有 */
export function parseRing(s: string | null): [number, number][] {
  if (!s) return [];
  const pts = s.split(';').slice(0, 400).map((p) => p.split(',').map(Number));
  return pts.every((p) => p.length === 2 && p.every((x) => Number.isFinite(x) && Math.abs(x) < 1e5)) ? (pts as [number, number][]) : [];
}

/**
 * 小课堂(《小课堂设计.md》)的纯函数:服务端(课长、上下文包 lecture: 的每句起点、画的地方盖着什么)与舞台包(播放器)共用。
 *
 * 课包的时钟、几何、圈住了什么(这里拿来说画的地方盖着什么)都在 drawtell/core(纯计算,不带 React,服务端能 import):一段 = 一步,段长 = max(画, 配音),
 * 课的 0 毫秒对着 SVG 的 START_MS;笔画按配音拉伸,和 buildAnimatedSvg 画出来的同一份时间。这里用小课堂的名字转出来
 * (视频也有时钟,videoClock),外加小课堂自己的:时间怎么写、上下文包的每句、老师放的那一段、视频的 lecture.md。
 */
import { circleHits, clockAt, hitPhrase, type LessonPicture } from 'drawtell/core';
import type { LessonClock, LessonSegment } from 'drawtell/core';

export { lessonClock as lectureClock, clockAt as lectureAt, START_MS as DRAW_START_MS } from 'drawtell/core';
export type { ChalkSkeleton as LectureSkeleton, ChalkStep as LectureStep, ChalkBlock as LectureBlock, ChalkGroup as LectureGroup, LessonPicture as LecturePicture } from 'drawtell/core';
/** 小课堂的时钟:课包的(drawtell lessonClock)或视频的(videoClock,没有画面元素) */
export type LectureClock = LessonClock;
export type LectureSegment = LessonSegment;

/** 毫秒 → 「分:秒」;一小时以上「时:分:秒」 */
export function clockLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 上下文包 lecture.lines:每段一句「0:18 讲稿」 */
export function lectureLines(clock: Pick<LectureClock, 'segments'>): string[] {
  return clock.segments.map((s) => `${clockLabel(s.start)} ${s.line.trim()}`);
}

/** 换了 src 声音迟迟不出来,等多久就不等了,按墙上的钟走(毫秒) */
export const VOICE_STALL_MS = 1500;

/**
 * 放着的时候时钟下一刻走到哪(课包;《小课堂设计.md》§三、拍板 36):这一段的配音在放,跟着配音走——
 * 「段起点 + 配音放到哪」,声音还没出来就停在原地等(不往回退);等过 VOICE_STALL_MS、配音放完了、没在放配音,按墙上的钟走 dt。
 * voice:正在放的是第几段的配音、放到哪(毫秒)、位置多久没动了;没在放 = null。
 */
export function lectureNext(clock: Pick<LectureClock, 'segments' | 'total'>, cur: number, dt: number, voice: { index: number; posMs: number; stalledMs: number } | null): number {
  const wall = Math.min(clock.total, cur + dt);
  if (!voice) return wall;
  const s = clock.segments[voice.index];
  if (!s || s.audioMs === null || voice.posMs >= s.audioMs || voice.stalledMs > VOICE_STALL_MS) return wall;
  // 声音是别的段的(刚拖过、刚换段):不跟
  if (cur < s.start || cur >= s.start + s.len) return wall;
  return Math.min(clock.total, Math.max(cur, s.start + voice.posMs));
}

// ---- 画(《小课堂设计.md》§四):孩子停住了在画面上画的一处(停在同一刻画的几笔)→ 一张截图 + 一段话(那一刻在讲哪句、画的地方盖着什么) ----

/** 一处画:课里的时刻 + 几笔(课包画面坐标,即 scene.json 的坐标系;视频是视频自己的像素坐标) */
export interface LectureMark {
  atMs: number;
  strokes: [number, number][][];
}

/** 一堂课最多画几处(播放器与路由都拦):一处一张截图,和孩子拍的照片一共不过 9 张 */
export const MARK_MAX = 6;
/** 一处最多几笔、一共几个点;一笔的点抽到 MARK_STROKE_POINTS 以内 */
export const MARK_MAX_STROKES = 60;
export const MARK_MAX_POINTS = 1200;
export const MARK_STROKE_POINTS = 300;

/** 「0:26 画的,那时在讲『…』」:一处画给老师、家长的那段话的头 */
export function markHead(clock: LectureClock, atMs: number): string {
  const line = clock.segments[clockAt(clock, atMs).index]?.line.trim() ?? '';
  return `${clockLabel(atMs)} 画的${line ? `,那时在讲『${line}』` : ''}`;
}

/** 太细的一处(一条线、一个点)给 circleHits 的框至少多宽(课包坐标) */
const MIN_RING = 24;

/**
 * 几笔 → 给 drawtell circleHits 的一圈:所有点的凸包(圈了一圈就是那一圈,没封口的也合上);
 * 太细的(划一道、点一下)用外框,各边放宽到 MIN_RING。没有点 = []。
 */
export function inkRing(strokes: readonly (readonly [number, number][])[]): [number, number][] {
  const pts = strokes.flat().slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!pts.length) return [];
  // 凸包(Andrew 单调链)
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]): [number, number][] => {
    const h: [number, number][] = [];
    for (const p of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); }
    h.pop();
    return h;
  };
  const hull = [...half(pts), ...half(pts.slice().reverse())];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (hull.length >= 3 && x1 - x0 >= MIN_RING && y1 - y0 >= MIN_RING) return hull;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = Math.max(x1 - x0, MIN_RING) / 2, hh = Math.max(y1 - y0, MIN_RING) / 2;
  return [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]];
}

/**
 * 画的地方盖着什么(只给课包,老师对着截图时的提示,用课里的叫法):「画的地方盖着:散的 3 根小棒;文字『3』」/「画在文字『3』旁边」/
 * 「画的地方那时还没画东西」。认的是 drawtell 的 circleHits(分组 > 命中块 > 带 label 的元素 > 文字 > 没字的按第几步、什么、颜色归堆),圈是 inkRing。
 */
export function inkHint(clock: LectureClock, mark: LectureMark, picture: LessonPicture = {}): { text: string; ids: string[] } {
  const ring = inkRing(mark.strokes);
  if (!ring.length) return { text: '', ids: [] };
  const r = circleHits(clock, mark.atMs, ring, picture);
  const say = (h: Parameters<typeof hitPhrase>[0]): string => hitPhrase(h).replace('(圈住了其中', '(盖着其中');
  const text = r.kind === 'hit' ? `画的地方盖着:${r.hits.map(say).join(';')}` : r.kind === 'near' && r.near ? `画在${say(r.near)}旁边` : r.kind === 'empty' ? '画的地方那时还没画东西' : '';
  return { text, ids: r.ids };
}

/** 一处画说成一段话(不带截图那半):「0:26 画的,那时在讲『…』;画的地方盖着:…」 */
export function describeMark(clock: LectureClock, mark: LectureMark, picture: LessonPicture = {}): { text: string; ids: string[] } {
  const h = inkHint(clock, mark, picture);
  return { text: `${markHead(clock, mark.atMs)}${h.text ? `;${h.text}` : ''}`, ids: h.ids };
}

// ---- 老师放课里的一段(《小课堂设计.md》§六):lecture 卡写「<课包 id> 0:19-0:30」 ----

/** 「分:秒」「时:分:秒」→ 毫秒;认不出来 null */
export function parseClock(s: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [h, mm, ss] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (ss >= 60 || (m[1] !== undefined && mm >= 60)) return null;
  return ((h * 60 + mm) * 60 + ss) * 1000;
}

/**
 * 卡上写的一段 → 真放的起止(毫秒)。lines: 里的时间是段起点取整到秒,老师照抄的「0:19」其实是 19.4 秒那段的开头:
 * 起止落在某个段界前后一秒内,就对齐到那个段界(不多放前一段的尾巴、不切掉这一段的末字)。
 * 不写止 = 放到起点所在那一段的末尾;都不写 = 整堂课。越界夹到课里;止不在起之后 = null。
 */
export function lectureRange(clock: Pick<LectureClock, 'segments' | 'total'>, from: number | undefined, to: number | undefined): { start: number; end: number } | null {
  if (!clock.segments.length) return null;
  const bounds = [...clock.segments.map((s) => s.start), clock.total];
  const snap = (ms: number): number => bounds.find((b) => b >= ms && b - ms < 1000) ?? ms;
  const start = from === undefined ? 0 : Math.min(snap(from), clock.total);
  let end: number;
  if (to !== undefined) end = Math.min(snap(to), clock.total);
  else if (from === undefined) end = clock.total;
  else { const i = clockAt(clock, start).index; end = clock.segments[i].start + clock.segments[i].len; }
  return end > start ? { start, end } : null;
}

// ---- 视频来源(《小课堂设计.md》§八第 4 步):lectures/<id>/lecture.md + video.mp4 ----

/** 视频小课堂放 workspace 的这个目录;一份一个子目录 */
export const LECTURES_DIR = 'lectures';
export const LECTURE_FILE = 'lecture.md';
export const LECTURE_VIDEO = 'video.mp4';

export interface LectureDocIssue {
  level: 'fix' | 'note';
  text: string;
  line?: number;
}
export interface LectureDoc {
  title: string;
  subject: string | null;
  /** 一句一条:在视频里的起点(毫秒)与原话 */
  chapters: { start: number; line: string; at: number }[];
  issues: LectureDocIssue[];
}

/**
 * lecture.md:frontmatter(subject 可写)+ `# 标题` + 一行一句「分:秒 原话」(这一句在视频里的起点)。
 * 别的行不认(给人看的话写在注释里);永不抛,问题带行号。时长不在这里查(要读 mp4),由调用方对。
 */
export function parseLectureDoc(md: string): LectureDoc {
  const lines = md.replace(/<!--[\s\S]*?-->/g, (c) => '\n'.repeat(c.split('\n').length - 1)).split(/\r?\n/);
  const issues: LectureDocIssue[] = [];
  let start = 0;
  let subject: string | null = null;
  if (/^---\s*$/.test(lines[0] ?? '')) {
    const close = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
    if (close < 0) issues.push({ level: 'fix', line: 1, text: 'frontmatter 没闭合:key: value 那几行之后单独一行写 ---' });
    else {
      for (let i = 1; i < close; i++) {
        const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
        if (m?.[1] === 'subject' && m[2].trim()) subject = m[2].trim();
        else if (lines[i].trim()) issues.push({ level: 'note', line: i + 1, text: `frontmatter 只认 subject:${lines[i].trim()}` });
      }
      start = close + 1;
    }
  }
  let title = '';
  const chapters: LectureDoc['chapters'] = [];
  for (let i = start; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    const h = /^#\s+(.+)$/.exec(l);
    if (h && !title) { title = h[1].trim(); continue; }
    const m = /^((?:\d{1,2}:)?\d{1,3}:\d{2})\s+(.+)$/.exec(l);
    const ms = m ? parseClock(m[1]) : null;
    if (m && ms !== null) {
      const prev = chapters[chapters.length - 1];
      if (prev && ms <= prev.start) issues.push({ level: 'fix', line: i + 1, text: `时间要一句比一句晚:${m[1]} 不晚于上一句的 ${clockLabel(prev.start)}` });
      else chapters.push({ start: ms, line: m[2].trim(), at: i + 1 });
    } else issues.push({ level: 'note', line: i + 1, text: `这行不认(一行一句写「分:秒 原话」,给人看的话写在 <!-- --> 里):${l.slice(0, 30)}` });
  }
  if (!title) issues.push({ level: 'fix', line: start + 1, text: '要有一行 # 标题(孩子首页按钮上、老师上下文包里的课名)' });
  if (!chapters.length) issues.push({ level: 'fix', text: '一句都没有:一行一句写「分:秒 原话」,老师靠它知道课里讲了什么、孩子停在哪' });
  else if (chapters[0].start !== 0) issues.push({ level: 'note', line: chapters[0].at, text: `第一句从 ${clockLabel(chapters[0].start)} 起,前面那段老师不知道在讲什么` });
  return { title, subject, chapters, issues };
}

/** 视频的时钟:一句一段(起点到下一句的起点,最后一句到视频末尾);没有画面元素,SVG 那几个数都是 0 */
export function videoClock(chapters: readonly { start: number; line: string }[], totalMs: number): LectureClock {
  const cs = chapters.filter((c) => c.start < totalMs);
  const segments: LectureSegment[] = cs.map((c, i) => {
    const end = i + 1 < cs.length ? cs[i + 1].start : totalMs;
    return { index: i, start: c.start, len: Math.max(1, end - c.start), drawStart: 0, drawEnd: 0, audioMs: null, line: c.line };
  });
  // 第一句不从 0 起:前面补一段没有话的
  if (segments.length && segments[0].start > 0) {
    segments.unshift({ index: 0, start: 0, len: segments[0].start, drawStart: 0, drawEnd: 0, audioMs: null, line: '' });
    segments.forEach((s, i) => { s.index = i; });
  }
  return { skeletons: [], segments, total: segments.length ? totalMs : 0, elements: new Map() };
}

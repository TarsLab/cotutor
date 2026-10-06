/**
 * 小课堂(《小课堂设计.md》)的时钟:课包的每一步首尾相接成一条时间线,像视频一样能拖到任意一刻。纯函数,服务端(课长、上下文包
 * lecture: 的每句起点)与舞台包(播放器)共用。
 *
 * 画的部分照 drawtell 的 timeline.ts(dist/player/timeline.js)一字不差地算:笔画串行、单笔 animateDuration 缺省 500、
 * 起点 START_MS;按配音拉伸(只拉不缩、封顶 5 倍)。drawtell 的包只导出整个播放器(带 React),服务端 import 不了,
 * 所以照抄一份;tests/lecture.test.ts 拿 drawtell 的原函数对。
 *
 * 时钟:一段 = 一步,段长 = max(这步画多久, 这步配音多久)——画完了定格,声音接着讲;声音先完,等画完。
 * 课的 0 毫秒对着 SVG 的 START_MS(开头那一秒空白不算进课里)。
 */

/** drawtell timeline.ts 的常量 */
export const DRAW_START_MS = 1000;
const DEFAULT_DUR = 500;
const MAX_STRETCH = 5;
/** 步尾定格退半毫秒(drawtell FREEZE_EPS_MS:停在整点会露出下一笔的起点) */
const FREEZE_EPS_MS = 0.5;

export interface LectureSkeleton {
  id: string;
  animateDuration?: number;
  [key: string]: unknown;
}
export interface LectureStep {
  step: number;
  elementIds: string[];
  line: string;
  audioSrc?: string;
  audioDurationMs?: number;
}

export interface LectureSegment {
  /** 第几步(0 起,与 steps 同序) */
  index: number;
  /** 这一段在课里的起点与长度(毫秒) */
  start: number;
  len: number;
  /** 这一步笔画在 SVG 时间线上的窗(毫秒,含 DRAW_START_MS) */
  drawStart: number;
  drawEnd: number;
  /** 配音时长;没有配音 = null */
  audioMs: number | null;
  line: string;
  audioSrc?: string;
}

export interface LectureClock {
  /** 拉伸后的元素(给 buildAnimatedSvg;时长和这条时钟同一份数) */
  skeletons: LectureSkeleton[];
  segments: LectureSegment[];
  /** 课长(毫秒) */
  total: number;
  /** 每个元素在 SVG 时间线上什么时候开始画、画完(毫秒) */
  elements: Map<string, { start: number; end: number; step: number }>;
}

export const durationOf = (e: { animateDuration?: number }): number => e.animateDuration ?? DEFAULT_DUR;

/** 课包 → 时钟。steps 的 elementIds 要按顺序覆盖全部元素(drawtell 的约定);没对上的元素不进任何一段 */
export function lectureClock(skeletons: readonly LectureSkeleton[], steps: readonly LectureStep[]): LectureClock {
  const byId = new Map(skeletons.map((e) => [e.id, e]));
  // 拉伸:有配音、配音比画长,这一步的笔画等比放大到 ≈ 配音时长(封顶 5 倍)
  const factor = new Map<string, number>();
  for (const s of steps) {
    const els = s.elementIds.map((id) => byId.get(id)).filter((e): e is LectureSkeleton => !!e);
    const drawMs = els.reduce((a, e) => a + durationOf(e), 0);
    const audioMs = s.audioDurationMs ?? null;
    const f = audioMs && drawMs > 0 && audioMs > drawMs ? Math.min(audioMs / drawMs, MAX_STRETCH) : 1;
    for (const e of els) factor.set(e.id, f);
  }
  const stretched = skeletons.map((e) => {
    const f = factor.get(e.id) ?? 1;
    return f === 1 ? e : { ...e, animateDuration: Math.round(durationOf(e) * f) };
  });
  const elements = new Map<string, { start: number; end: number; step: number }>();
  const stepOf = new Map<string, number>();
  steps.forEach((s, i) => s.elementIds.forEach((id) => stepOf.set(id, i)));
  let cur = DRAW_START_MS;
  for (const e of stretched) {
    const start = cur;
    cur += durationOf(e);
    elements.set(e.id, { start, end: cur, step: stepOf.get(e.id) ?? -1 });
  }
  const segments: LectureSegment[] = [];
  let prevDraw = DRAW_START_MS;
  let at = 0;
  steps.forEach((s, i) => {
    const last = s.elementIds[s.elementIds.length - 1];
    const drawEnd = last !== undefined ? (elements.get(last)?.end ?? prevDraw) : prevDraw;
    const drawStart = prevDraw;
    const audioMs = s.audioDurationMs ?? null;
    const len = Math.max(drawEnd - drawStart, audioMs ?? 0, 1);
    segments.push({ index: i, start: at, len, drawStart, drawEnd, audioMs, line: s.line, ...(s.audioSrc ? { audioSrc: s.audioSrc } : {}) });
    at += len;
    prevDraw = drawEnd;
  });
  return { skeletons: stretched, segments, total: at, elements };
}

/** 课里的某一刻 → 第几段、段内多少、SVG 该停在哪(毫秒)。越界夹到 0..total */
export function lectureAt(clock: Pick<LectureClock, 'segments' | 'total'>, ms: number): { index: number; offset: number; svgMs: number } {
  const t = Math.max(0, Math.min(ms, clock.total));
  const segs = clock.segments;
  if (!segs.length) return { index: -1, offset: 0, svgMs: DRAW_START_MS };
  let i = segs.findIndex((s) => t < s.start + s.len);
  if (i < 0) i = segs.length - 1;
  const s = segs[i];
  const offset = t - s.start;
  return { index: i, offset, svgMs: Math.min(s.drawStart + offset, s.drawEnd - FREEZE_EPS_MS) };
}

/** 那一刻画面上已经有的元素(开始画了就算;画到一半的也算) */
export function drawnAt(clock: Pick<LectureClock, 'segments' | 'total' | 'elements'>, ms: number): string[] {
  const { svgMs } = lectureAt(clock, ms);
  return [...clock.elements].filter(([, w]) => w.start <= svgMs).map(([id]) => id);
}

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

// ---- 圈(《小课堂设计.md》§四):孩子暂停后在画面上圈的一处 → 一段话(那一刻在讲哪句、圈住了什么)。只认课包 ----

/** 一处圈:课里的时刻 + 一条路径(课包画面坐标,即 scene.json 的坐标系) */
export interface LectureMark {
  atMs: number;
  path: [number, number][];
}
/** drawtell 的词级命中块(scene.blocks):圈住块里的字,说块的 text */
export interface LectureBlock {
  id: string;
  elementIds: string[];
  text: string;
}

interface Box { minX: number; minY: number; maxX: number; maxY: number }
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pointsOf = (e: LectureSkeleton): [number, number][] | null =>
  Array.isArray(e.points) ? (e.points as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2).map((p) => [num(e.x) + num(p[0]), num(e.y) + num(p[1])]) : null;

/** 文字的宽:场景里的文字不带量过的宽(drawtell 在浏览器里量),这里估:汉字一个字号宽,其余半个多 */
export function textBox(e: LectureSkeleton): Box {
  const size = num(e.fontSize, 20);
  const rows = String(e.text ?? '').split('\n');
  const w = Math.max(0, ...rows.map((r) => [...r].reduce((a, ch) => a + (ch === ' ' ? 0.3 : ch.codePointAt(0)! >= 0x2e80 ? 1 : 0.55), 0))) * size;
  const width = typeof e.width === 'number' && e.width > w ? e.width : w;
  return { minX: num(e.x), minY: num(e.y), maxX: num(e.x) + width, maxY: num(e.y) + rows.length * size * 1.25 };
}

/** 元素上取的样点:文字取包围盒里的九宫格,线取沿线的点,框 / 椭圆 / 菱形取边上的点(圈在框里面的东西不算圈住了框) */
function samplesOf(e: LectureSkeleton): [number, number][] {
  if (e.type === 'text') {
    const b = textBox(e);
    const out: [number, number][] = [];
    for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.25, 0.5, 0.75]) out.push([b.minX + (b.maxX - b.minX) * fx, b.minY + (b.maxY - b.minY) * fy]);
    return out;
  }
  const pts = pointsOf(e);
  if (pts && pts.length) {
    if (pts.length === 1) return pts;
    const out: [number, number][] = [];
    const per = Math.max(2, Math.ceil(12 / (pts.length - 1)));
    for (let i = 1; i < pts.length; i++) for (let k = 0; k <= per; k++) { if (i > 1 && k === 0) continue; const t = k / per; out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]); }
    return out;
  }
  const x = num(e.x), y = num(e.y), w = num(e.width), h = num(e.height);
  const out: [number, number][] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (e.type === 'ellipse') out.push([x + w / 2 + (w / 2) * Math.cos(a), y + h / 2 + (h / 2) * Math.sin(a)]);
    else if (e.type === 'diamond') { const c = Math.cos(a), s = Math.sin(a), k1 = 1 / (Math.abs(c) + Math.abs(s)); out.push([x + w / 2 + (w / 2) * c * k1, y + h / 2 + (h / 2) * s * k1]); }
    else { const t = (k / 16) * 4, side = Math.floor(t), f = t - side; out.push(side === 0 ? [x + w * f, y] : side === 1 ? [x + w, y + h * f] : side === 2 ? [x + w * (1 - f), y + h] : [x, y + h * (1 - f)]); }
  }
  return out;
}

function boxOf(pts: readonly [number, number][]): Box {
  return { minX: Math.min(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxX: Math.max(...pts.map((p) => p[0])), maxY: Math.max(...pts.map((p) => p[1])) };
}
const elementBox = (e: LectureSkeleton): Box => (e.type === 'text' ? textBox(e) : boxOf(samplesOf(e)));

/** 点在不在圈里(圈首尾连上;射线法) */
function inside(poly: readonly [number, number][], [x, y]: [number, number]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const boxGap = (a: Box, b: Box): number => Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY));

const SHAPE_WORD: Record<string, [string, string]> = { line: ['条', '线'], arrow: ['个', '箭头'], rectangle: ['个', '框'], ellipse: ['个', '圈'], diamond: ['个', '菱形'], freedraw: ['处', '笔画'], image: ['张', '图'] };
/** 笔画颜色 → 一个字(黑、灰不说) */
export function colorWord(hex: unknown): string {
  const m = typeof hex === 'string' ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
  if (!m) return '';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.3 || l < 0.15 || l > 0.92) return '';
  const h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return h < 15 || h >= 340 ? '红' : h < 40 ? '橙' : h < 70 ? '黄' : h < 170 ? '绿' : h < 255 ? '蓝' : '紫';
}

/** 样点有多少在圈里算圈住了 */
const HIT_SHARE = 0.5;
/** 什么都没圈住时,离圈多近的东西算「旁边」(课包坐标) */
const NEAR = 80;

/**
 * 一处圈 → 一段话给老师(上下文包 lecture.marks)与家长(圈的卡下面那行):
 * 「0:26 圈的,那时在讲『…』;圈住了:文字『3』;第 1 步画的 3 条线(旁边写着『3』)」。
 * 只看那一刻画面上已经有的(开始画了就算);文字先认块(blocks)的 text;线、框这类没字的说第几步画的、几条、什么颜色、旁边写着什么;
 * 什么都没圈住说离它最近的那样东西;画面上那一带什么都没有也照实说。
 */
export function describeMark(clock: LectureClock, mark: LectureMark, blocks: readonly LectureBlock[] = []): { text: string; ids: string[] } {
  const at = lectureAt(clock, mark.atMs);
  const line = clock.segments[at.index]?.line.trim() ?? '';
  const head = `${clockLabel(mark.atMs)} 圈的${line ? `,那时在讲『${line}』` : ''}`;
  const poly = mark.path;
  if (poly.length < 3) return { text: `${head};圈得太小,看不出圈的是什么`, ids: [] };
  const shown = clock.skeletons.filter((e) => { const w = clock.elements.get(e.id); return w !== undefined && w.start < at.svgMs; });
  const ring = boxOf(poly);
  const hits = shown.filter((e) => {
    const s = samplesOf(e);
    if (!s.length) return false;
    if (s.filter((p) => inside(poly, p)).length / s.length >= HIT_SHARE) return true;
    // 长的一行字里圈了几个字:圈整个落在这行字里
    const b = e.type === 'text' ? textBox(e) : null;
    return b !== null && ring.minX >= b.minX - 8 && ring.maxX <= b.maxX + 8 && ring.minY >= b.minY - 8 && ring.maxY <= b.maxY + 8;
  });
  const texts = shown.filter((e) => e.type === 'text');
  const quote = (e: LectureSkeleton): string => `『${String(e.text ?? '').replace(/\s*\n\s*/g, ' ').trim()}』`;
  const stepOf = (e: LectureSkeleton): number => clock.elements.get(e.id)?.step ?? -1;
  const shapeName = (type: string, color: string, n: number): string => {
    const [m, noun] = SHAPE_WORD[type] ?? ['样', '东西'];
    return `${n > 1 ? ` ${n} ${m}` : ''}${color ? `${color}色的` : ''}${noun}`;
  };

  if (!hits.length) {
    const center: Box = { minX: (ring.minX + ring.maxX) / 2, maxX: (ring.minX + ring.maxX) / 2, minY: (ring.minY + ring.maxY) / 2, maxY: (ring.minY + ring.maxY) / 2 };
    const near = shown.map((e) => ({ e, d: boxGap(elementBox(e), ring) })).filter((x) => x.d <= NEAR).sort((a, b) => a.d - b.d || boxGap(elementBox(a.e), center) - boxGap(elementBox(b.e), center))[0];
    if (!near) return { text: `${head};圈的地方那时还没画东西`, ids: [] };
    const what = near.e.type === 'text' ? `文字${quote(near.e)}` : `第 ${stepOf(near.e) + 1} 步画的${shapeName(String(near.e.type), colorWord(near.e.strokeColor), 1)}`;
    return { text: `${head};没圈住东西,圈在${what}旁边`, ids: [] };
  }

  const parts: string[] = [];
  const hitIds = new Set(hits.map((e) => e.id));
  // 文字:圈住了块里的字就说整个块
  const said = new Set<string>();
  const words: string[] = [];
  for (const e of hits.filter((x) => x.type === 'text')) {
    const b = blocks.find((k) => k.elementIds.includes(e.id));
    if (b) { if (!said.has(b.id)) { said.add(b.id); words.push(`『${b.text}』`); } }
    else words.push(quote(e));
  }
  if (words.length) parts.push(`文字${words.join('、')}`);
  // 没字的:按(第几步、什么、颜色)归成一堆,说几样、旁边写着什么
  const groups = new Map<string, LectureSkeleton[]>();
  for (const e of hits.filter((x) => x.type !== 'text')) {
    const k = `${stepOf(e)}|${String(e.type)}|${colorWord(e.strokeColor)}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  for (const [k, els] of groups) {
    const [step, type, color] = k.split('|');
    const gb = boxOf(els.flatMap((e) => { const b = elementBox(e); return [[b.minX, b.minY], [b.maxX, b.maxY]] as [number, number][]; }));
    const label = texts.filter((t) => !hitIds.has(t.id)).map((t) => ({ t, d: boxGap(textBox(t), gb) })).filter((x) => x.d <= NEAR / 2).sort((a, b) => a.d - b.d)[0];
    parts.push(`第 ${Number(step) + 1} 步画的${shapeName(type, color, els.length)}${label ? `(旁边写着${quote(label.t)})` : ''}`);
  }
  return { text: `${head};圈住了:${parts.join(';')}`, ids: hits.map((e) => e.id) };
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
  else { const i = lectureAt(clock, start).index; end = clock.segments[i].start + clock.segments[i].len; }
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

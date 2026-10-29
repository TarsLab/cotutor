/**
 * 画板:孩子的笔迹怎么数(各色几笔、大致在哪、画了多久),边画边聊时嘴什么时候主动说一句、说哪个颜色。纯函数。
 * 剥类型内联进孩子端页面(同 runtime/delivery/player.ts),名字都带 canvas 前缀;服务端的画板卡 describe、纸交画时的摘要也用它。
 * 改「什么时候说」先改的规矩,再改 tests/canvas-chat.test.ts,最后改这里(CANVAS_CHAT 是调参表)。
 */

/** 舞台的三支笔(src/ui/stage/canvas.tsx 的 INK_COLORS)叫什么;别的颜色(以后加的)叫「别的颜色」 */
export const CANVAS_COLOR_NAMES: Readonly<Record<string, string>> = { '#2b2b2b': '黑', '#d9482b': '红', '#2f6fd6': '蓝' };

/** 一笔:颜色名、画完的时刻(excalidraw 元素的 updated,毫秒)、外框(画布坐标) */
export interface CanvasStroke { color: string; at: number; x0: number; y0: number; x1: number; y1: number }

/** 一种颜色:几笔、在整张画里大致哪儿(上边偏右、中间、铺满大半张) */
export interface CanvasColor { name: string; strokes: number; where: string }

export interface CanvasSummary {
  strokes: number;
  /** 笔多的在前 */
  colors: CanvasColor[];
  /** 第一笔、最后一笔画完的时刻;没画是 null */
  firstAt: number | null;
  lastAt: number | null;
}

const canvasNum = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 笔迹(舞台存回来的 excalidraw 元素,customData.layer = 'ink')→ 一笔一行;删掉的、不是线条的不算 */
export function canvasStrokes(ink: readonly Record<string, unknown>[]): CanvasStroke[] {
  const out: CanvasStroke[] = [];
  for (const el of ink) {
    if (!el || el.isDeleted === true) continue;
    const x = canvasNum(el.x), y = canvasNum(el.y);
    const pts = Array.isArray(el.points) ? (el.points as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number') : [];
    let x0 = x, y0 = y, x1 = x + canvasNum(el.width), y1 = y + canvasNum(el.height);
    if (pts.length) {
      x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, x + p[0]); y0 = Math.min(y0, y + p[1]); x1 = Math.max(x1, x + p[0]); y1 = Math.max(y1, y + p[1]); }
    }
    const raw = typeof el.strokeColor === 'string' ? el.strokeColor.toLowerCase() : '';
    out.push({ color: CANVAS_COLOR_NAMES[raw] ?? '别的颜色', at: canvasNum(el.updated), x0, y0, x1, y1 });
  }
  return out;
}

/** 一块外框在整张画的外框里大致哪儿:占了一半以上 = 铺满大半张;不然按中心落在九宫格哪格 */
function canvasWhere(b: { x0: number; y0: number; x1: number; y1: number }, all: { x0: number; y0: number; x1: number; y1: number }): string {
  const W = Math.max(1, all.x1 - all.x0), H = Math.max(1, all.y1 - all.y0);
  const area = (Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)) / (W * H);
  if (area >= 0.5) return '铺满大半张';
  const cx = ((b.x0 + b.x1) / 2 - all.x0) / W, cy = ((b.y0 + b.y1) / 2 - all.y0) / H;
  const v = cy < 1 / 3 ? '上边' : cy > 2 / 3 ? '下边' : '中间';
  const hz = cx < 1 / 3 ? '偏左' : cx > 2 / 3 ? '偏右' : '';
  return v === '中间' && hz ? (hz === '偏左' ? '左边' : '右边') : v + hz;
}

/** 整张画的摘要:几笔、各颜色几笔在哪、第一笔与最后一笔的时刻 */
export function canvasSummary(strokes: readonly CanvasStroke[]): CanvasSummary {
  if (!strokes.length) return { strokes: 0, colors: [], firstAt: null, lastAt: null };
  const all = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const by = new Map<string, { n: number; first: number; b: { x0: number; y0: number; x1: number; y1: number } }>();
  let firstAt = Infinity, lastAt = -Infinity;
  strokes.forEach((s, i) => {
    all.x0 = Math.min(all.x0, s.x0); all.y0 = Math.min(all.y0, s.y0); all.x1 = Math.max(all.x1, s.x1); all.y1 = Math.max(all.y1, s.y1);
    if (s.at > 0) { firstAt = Math.min(firstAt, s.at); lastAt = Math.max(lastAt, s.at); }
    const c = by.get(s.color) ?? { n: 0, first: i, b: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } };
    c.n++;
    c.b = { x0: Math.min(c.b.x0, s.x0), y0: Math.min(c.b.y0, s.y0), x1: Math.max(c.b.x1, s.x1), y1: Math.max(c.b.y1, s.y1) };
    by.set(s.color, c);
  });
  const colors = [...by.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).map(([name, c]) => ({ name, strokes: c.n, where: canvasWhere(c.b, all) }));
  return { strokes: strokes.length, colors, firstAt: Number.isFinite(firstAt) ? firstAt : null, lastAt: Number.isFinite(lastAt) ? lastAt : null };
}

/** 「红 40 笔、蓝 51 笔」;只有一种颜色就只写几笔 */
export function canvasColorsText(s: CanvasSummary): string {
  if (!s.strokes) return '还没画';
  if (s.colors.length <= 1) return `${s.strokes} 笔${s.colors[0] ? `(${s.colors[0].name})` : ''}`;
  return s.colors.map((c) => `${c.name} ${c.strokes} 笔`).join('、');
}

/** 画了多久(第一笔到最后一笔,加上清空前画的那几版):不到 1 分钟写「不到 1 分钟」 */
export function canvasMinutesText(ms: number): string {
  if (!(ms >= 60_000)) return '不到 1 分钟';
  return `约 ${Math.round(ms / 60_000)} 分钟`;
}

/**
 * 边画边聊的规矩(10-22 :先这样,跑一周再调)。毫秒。
 * 换色:一种颜色从上一句到现在新画了 ≥ colorStrokes 笔、孩子换了颜色 → 说刚画完的那种;
 * 久停:这一张 ≥ pauseStrokes 笔以后停笔 ≥ pauseMs → 说整张(上一句之后又画过才算);
 * 不说:点开后 openQuietMs 内、上一笔不到 drawingMs(正在画)、清空后 clearQuietMs 内、孩子按头像说过 kidQuietMs 内、离上一句不到 gapMs、一张已经说了 maxLines 句;
 * 不追:上一句问了没回 → 这句只说不问;连着 stopUnanswered 句没回 → 这一张不说了(他画得入神)
 */
export const CANVAS_CHAT = {
  colorStrokes: 5,
  pauseStrokes: 10,
  pauseMs: 12_000,
  openQuietMs: 20_000,
  drawingMs: 2_000,
  clearQuietMs: 30_000,
  kidQuietMs: 15_000,
  gapMs: 45_000,
  maxLines: 4,
  stopUnanswered: 2,
};

/** 嘴主动说过的一句:时刻、说的哪种颜色(null = 整张)、问没问、孩子回了没有、那时各颜色几笔 */
export interface CanvasChatLine { at: number; color: string | null; ask: boolean; answered: boolean; counts: Record<string, number>; strokes: number }

/** 这一张纸(清空算新的一张)上边画边聊到哪了;kidAt = 孩子最近一次按头像说话 */
export interface CanvasChatState { openedAt: number; clearedAt: number | null; kidAt: number | null; lines: CanvasChatLine[] }

/** 要不要说:say = false 带为什么(测试、录像看);说的话带说哪种颜色(null = 整张)、问不问 */
export type CanvasChatDue = { say: false; why: string } | { say: true; color: string | null; ask: boolean; why: 'color' | 'pause' };

export function canvasChatInit(now: number): CanvasChatState {
  return { openedAt: now, clearedAt: null, kidAt: null, lines: [] };
}

/** 清空了:新的一张,计数重来 */
export function canvasChatCleared(st: CanvasChatState, now: number): CanvasChatState {
  return { ...st, clearedAt: now, lines: [] };
}

/** 孩子按着头像说了话(边画边聊):最近一句算回了;嘴刚接住他,一会儿内不再主动说 */
export function canvasChatAnswered(st: CanvasChatState, now: number): CanvasChatState {
  const lines = st.lines.slice();
  if (lines.length) lines[lines.length - 1] = { ...lines[lines.length - 1], answered: true };
  return { ...st, kidAt: now, lines };
}

const canvasCounts = (strokes: readonly CanvasStroke[]): Record<string, number> => {
  const c: Record<string, number> = {};
  for (const s of strokes) c[s.color] = (c[s.color] ?? 0) + 1;
  return c;
};

/**
 * 这一刻要不要说。busy = 孩子按着说话、嘴或卡在出声、脑在写(页面凑);strokes = 这一刻的笔(画完的时刻是 at)。
 * 换色比久停先:刚画完的那种颜色具体,好问
 */
export function canvasChatDue(st: CanvasChatState, now: number, strokes: readonly CanvasStroke[], busy: boolean): CanvasChatDue {
  const T = CANVAS_CHAT;
  if (busy) return { say: false, why: 'busy' };
  if (now - st.openedAt < T.openQuietMs) return { say: false, why: 'opened' };
  if (st.clearedAt !== null && now - st.clearedAt < T.clearQuietMs) return { say: false, why: 'cleared' };
  if (st.kidAt !== null && now - st.kidAt < T.kidQuietMs) return { say: false, why: 'kid' };
  if (!strokes.length) return { say: false, why: 'empty' };
  const lines = st.lines;
  if (lines.length >= T.maxLines) return { say: false, why: 'max' };
  const tail = lines.slice(-T.stopUnanswered);
  if (tail.length === T.stopUnanswered && tail.every((l) => !l.answered)) return { say: false, why: 'unanswered' };
  const last = lines[lines.length - 1];
  if (last && now - last.at < T.gapMs) return { say: false, why: 'gap' };
  const lastAt = strokes.reduce((m, s) => Math.max(m, s.at), 0);
  if (now - lastAt < T.drawingMs) return { say: false, why: 'drawing' };
  const ask = !(last && last.ask && !last.answered);
  // 换色:按画完的先后排,最后一段同色之前那段的颜色;它从上一句到现在新画了够多
  const seq = strokes.slice().sort((a, b) => a.at - b.at);
  const now0 = seq[seq.length - 1].color;
  let k = seq.length - 1;
  while (k >= 0 && seq[k].color === now0) k--;
  const counts = canvasCounts(strokes);
  if (k >= 0) {
    const prev = seq[k].color;
    const fresh = (counts[prev] ?? 0) - (last?.counts[prev] ?? 0);
    if (fresh >= T.colorStrokes) return { say: true, color: prev, ask, why: 'color' };
  }
  // 还没换色、这一种已经画了很多(一整张都是一种颜色):停笔够久也说它
  if (strokes.length >= T.pauseStrokes && now - lastAt >= T.pauseMs && (!last || lastAt > last.at)) {
    const only = Object.keys(counts).length === 1 ? now0 : null;
    return { say: true, color: only, ask, why: 'pause' };
  }
  return { say: false, why: 'wait' };
}

/** 说了:记下这一句(那时各颜色几笔,下次算「新画了几笔」) */
export function canvasChatSaid(st: CanvasChatState, now: number, due: Extract<CanvasChatDue, { say: true }>, strokes: readonly CanvasStroke[]): CanvasChatState {
  return { ...st, lines: [...st.lines, { at: now, color: due.color, ask: due.ask, answered: false, counts: canvasCounts(strokes), strokes: strokes.length }] };
}

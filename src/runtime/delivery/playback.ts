/**
 * 嘴的声音在孩子端什么时候放(纯函数,时间都是通话的毫秒):照孩子端 makeAudio().play 的排法——一块到了,上一块放完或到达 + LEAD_MS,取晚的(同 src/runtime/journal/mix.ts)。
 * 实时老师用它:一段讲稿什么时候开始放(到点告诉孩子端亮哪几句)、孩子按下时在放哪一段(打断报到哪句)、还在不在放(要不要清孩子端的队列)。
 */

/** 孩子端排队的起步(play 里的 0.06 秒) */
export const LEAD_MS = 60;

export interface Span<T> { tag: T; start: number; end: number }
export interface Playback<T> { end: number; spans: Span<T>[] }

export const playbackInit = <T>(): Playback<T> => ({ end: 0, spans: [] });

/** 一块声音到了:排在哪、放到哪;同一个 tag 接着的并进上一段 */
export function addChunk<T>(p: Playback<T>, tag: T, arrival: number, ms: number): { p: Playback<T>; start: number } {
  const start = Math.max(arrival + LEAD_MS, p.end);
  const end = start + ms;
  const last = p.spans[p.spans.length - 1];
  const spans = last && last.tag === tag && last.end === start ? [...p.spans.slice(0, -1), { ...last, end }] : [...p.spans, { tag, start, end }];
  return { p: { end, spans }, start };
}

/** t 这一刻在放的那段;没在放 null */
export function playingAt<T>(p: Playback<T>, t: number): Span<T> | null {
  for (let i = p.spans.length - 1; i >= 0; i--) { const s = p.spans[i]; if (s.start <= t && t < s.end) return s; }
  return null;
}

/** 孩子端清了队列:t 之后的都不放了 */
export function flushAt<T>(p: Playback<T>, t: number): Playback<T> {
  const spans = p.spans.filter((s) => s.start < t).map((s) => (s.end > t ? { ...s, end: t } : s));
  return { end: Math.min(p.end, t), spans };
}

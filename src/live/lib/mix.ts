/**
 * 录像的声音(口语课《口语课设计.md》§8.3、实时老师共用):两边的声音照到达的时刻摆成一条对齐墙钟的单声道(24k),和孩子当时听到的、说的一样。纯函数。
 *   孩子的块(16k)到了服务端才记时刻,声音是那之前 100 毫秒录的:往前挪一块的长度,升到 24k。
 *   老师的块照孩子端 A.play 的排法排:上一块放完或到达 + 60 毫秒,取晚的;flush(孩子插嘴、换段)那一刻还没放完的截掉,队列从头排。
 * 同时给出老师在出声的时段(录像里画「老师在说 / 轮到你」用)、孩子有声的时段(跳过空白时别把孩子说话剪掉)。
 */

import { rms } from './wav.ts';

export const MIX_RATE = 24000;
/** 孩子的一块响过这个算有声(同 read-flow 的门限下限) */
const KID_VOICE = 0.015;
const KID_RATE = 16000;
/** 孩子端排队的起步(A.play 里的 0.06 秒) */
const LEAD_MS = 60;

export interface Chunk { t: number; pcm: Buffer }

const samplesOf = (pcm: Buffer): number => pcm.length >> 1;

/** 老师的块排成段:[开始, 结束, pcm],flush 截断;时间都是毫秒 */
export function scheduleTutor(chunks: Chunk[], flushes: number[]): { start: number; end: number; pcm: Buffer }[] {
  const evs: ({ k: 'c'; t: number; c: Chunk } | { k: 'f'; t: number })[] = [...chunks.map((c) => ({ k: 'c' as const, t: c.t, c })), ...flushes.map((t) => ({ k: 'f' as const, t }))];
  // 同一刻先 flush 再排新块(孩子端先清队列、再收到新回答)
  evs.sort((a, b) => a.t - b.t || (a.k === 'f' ? -1 : 1));
  const out: { start: number; end: number; pcm: Buffer }[] = [];
  let queueEnd = 0;
  for (const e of evs) {
    if (e.k === 'f') {
      for (let i = out.length - 1; i >= 0 && out[i].end > e.t; i--) {
        const seg = out[i];
        if (seg.start >= e.t) { out.splice(i, 1); continue; }
        const keep = Math.round(((e.t - seg.start) * MIX_RATE) / 1000);
        seg.pcm = seg.pcm.subarray(0, keep * 2);
        seg.end = e.t;
      }
      queueEnd = 0;
      continue;
    }
    const start = Math.max(e.t + LEAD_MS, queueEnd);
    const end = start + (samplesOf(e.c.pcm) * 1000) / MIX_RATE;
    out.push({ start, end, pcm: e.c.pcm });
    queueEnd = end;
  }
  return out;
}

/** 老师出声的时段:挨着的段(间隔不到 150 毫秒)并成一段 */
export function playingOf(segs: { start: number; end: number }[]): [number, number][] {
  const out: [number, number][] = [];
  for (const s of [...segs].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && s.start - last[1] < 150) last[1] = Math.max(last[1], s.end);
    else out.push([Math.round(s.start), Math.round(s.end)]);
  }
  return out.map(([a, b]) => [Math.round(a), Math.round(b)]);
}

/** 两边混成一条(PCM16 单声道 24k,长到 ms 为止;挂断那一刻还没放完的老师的声音不要) */
export function mixCall(o: { kid: Chunk[]; tutor: Chunk[]; flushes: number[]; ms: number }): { pcm: Buffer; playing: [number, number][]; kidVoice: [number, number][] } {
  const n = Math.max(0, Math.round((o.ms * MIX_RATE) / 1000));
  const acc = new Float32Array(n);
  const put = (at: number, i16: (k: number) => number, len: number): void => {
    const base = Math.round((at * MIX_RATE) / 1000);
    for (let k = 0; k < len; k++) { const j = base + k; if (j >= 0 && j < n) acc[j] += i16(k); }
  };
  for (const c of o.kid) {
    const m = samplesOf(c.pcm);
    if (!m) continue;
    const len = Math.floor((m * MIX_RATE) / KID_RATE);
    const at = c.t - (m * 1000) / KID_RATE;
    put(at, (k) => {
      const x = (k * KID_RATE) / MIX_RATE, i = Math.floor(x), f = x - i;
      const a = c.pcm.readInt16LE(Math.min(i, m - 1) * 2), b = c.pcm.readInt16LE(Math.min(i + 1, m - 1) * 2);
      return a + (b - a) * f;
    }, len);
  }
  const segs = scheduleTutor(o.tutor, o.flushes).filter((s) => s.start < o.ms);
  for (const s of segs) put(s.start, (k) => s.pcm.readInt16LE(k * 2), samplesOf(s.pcm));
  const pcm = Buffer.alloc(n * 2);
  for (let j = 0; j < n; j++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(acc[j]))), j * 2);
  const voiced = o.kid.filter((c) => rms(c.pcm) >= KID_VOICE).map((c) => ({ start: c.t - (samplesOf(c.pcm) * 1000) / KID_RATE, end: c.t }));
  return { pcm, playing: playingOf(segs.map((s) => ({ start: s.start, end: Math.min(s.end, o.ms) }))), kidVoice: playingOf(voiced) };
}

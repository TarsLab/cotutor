/**
 * 录像的声音(口语课、实时老师共用):两边的声音照到达的时刻摆成一条对齐墙钟的单声道(24k),和孩子当时听到的、说的一样。纯函数。
 *   孩子的块(16k)到了服务端才记时刻,声音是那之前 100 毫秒录的:往前挪一块的长度,升到 24k。
 *   老师的块照孩子端 A.play 的排法排:上一块放完或到达 + 60 毫秒,取晚的;flush(孩子插嘴、换段)那一刻还没放完的截掉,队列从头排。
 * 同时给出老师在出声的时段(录像里画「老师在说 / 轮到你」用)、孩子有声的时段(跳过空白时别把孩子说话剪掉)。
 */

import { rms } from '../../shared/wav.ts';

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

/** 混出来的一条 + 老师出声的时段 + 孩子有声的时段 */
export interface Mixed { pcm: Buffer; playing: [number, number][]; kidVoice: [number, number][] }

/** 分片混:每混这么多个采样(10 秒)让一下事件循环——通话中切段时就在混,不能卡住正在说的那一路 */
const SLICE_SAMPLES = MIX_RATE * 10;

/**
 * 两边混成一条(PCM16 单声道 24k,长到 ms 为止;挂断那一刻还没放完的老师的声音不要)。
 * 直接往 Int16 里加、加一次削一次顶(两边叠着才会削,和先加完再削只差一个最低位);不另开整段的 Float32(一个钟头就是 345 MB)。
 * 生成器:每混 SLICE_SAMPLES 个采样 yield 一次,mixCall 一口气跑完,mixCallSliced 每次 yield 让一下事件循环
 */
function* mixing(o: { kid: Chunk[]; tutor: Chunk[]; flushes: number[]; ms: number }): Generator<void, Mixed> {
  const n = Math.max(0, Math.round((o.ms * MIX_RATE) / 1000));
  const pcm = Buffer.alloc(n * 2);
  let work = 0;
  const add = (j: number, v: number): void => {
    const s = pcm.readInt16LE(j * 2) + Math.round(v);
    pcm.writeInt16LE(s > 32767 ? 32767 : s < -32768 ? -32768 : s, j * 2);
  };
  const voiced: { start: number; end: number }[] = [];
  for (const c of o.kid) {
    const m = samplesOf(c.pcm);
    if (!m) continue;
    const len = Math.floor((m * MIX_RATE) / KID_RATE);
    const at = c.t - (m * 1000) / KID_RATE;
    const base = Math.round((at * MIX_RATE) / 1000);
    for (let k = 0; k < len; k++) {
      const j = base + k;
      if (j < 0 || j >= n) continue;
      const x = (k * KID_RATE) / MIX_RATE, i = Math.floor(x), f = x - i;
      const a = c.pcm.readInt16LE(Math.min(i, m - 1) * 2), b = c.pcm.readInt16LE(Math.min(i + 1, m - 1) * 2);
      add(j, a + (b - a) * f);
    }
    if (rms(c.pcm) >= KID_VOICE) voiced.push({ start: at, end: c.t });
    work += len;
    if (work >= SLICE_SAMPLES) { work = 0; yield; }
  }
  const segs = scheduleTutor(o.tutor, o.flushes).filter((s) => s.start < o.ms);
  for (const s of segs) {
    const base = Math.round((s.start * MIX_RATE) / 1000);
    const len = samplesOf(s.pcm);
    for (let k = 0; k < len; k++) { const j = base + k; if (j >= 0 && j < n) add(j, s.pcm.readInt16LE(k * 2)); }
    work += len;
    if (work >= SLICE_SAMPLES) { work = 0; yield; }
  }
  return { pcm, playing: playingOf(segs.map((s) => ({ start: s.start, end: Math.min(s.end, o.ms) }))), kidVoice: playingOf(voiced) };
}

/** 一口气混完(测试、短的) */
export function mixCall(o: { kid: Chunk[]; tutor: Chunk[]; flushes: number[]; ms: number }): Mixed {
  const g = mixing(o);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/** 分片混:结果同 mixCall,中间让出事件循环(通话里落录像走这个) */
export async function mixCallSliced(o: { kid: Chunk[]; tutor: Chunk[]; flushes: number[]; ms: number }): Promise<Mixed> {
  const g = mixing(o);
  let r = g.next();
  while (!r.done) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    r = g.next();
  }
  return r.value;
}

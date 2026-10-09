/**
 * timeline.md:给家长的 Claude Code 读的那一份——一句一行,这句说了什么、这段画了几笔、这段结束时的画面是哪张图。
 * 说的和画的对不对得上,要把这两样按时刻摆在一起才看得出来(《wip/小老师设想.md》§一)。
 */
import { strokesIn, type Strokes } from './strokes.ts';
import { clock, lineEnd, type Transcript } from './transcript.ts';

export interface AskRecord {
  /** 问的是哪一句(notes.md 里的原话) */
  q: string;
  at: string;
  ms: number;
  heard: string;
  /** 浏览器没认出字、paraformer 补的 */
  heardBy?: 'paraformer';
  note: string;
  audio?: string;
  strokes?: Strokes;
}

/** 一帧的文件名:frames/0031.png = 0:31 那一刻 */
export function frameName(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `frames/${String(Math.floor(s / 60)).padStart(2, '0')}${String(s % 60).padStart(2, '0')}.png`;
}

export interface TimelineRow {
  from: number;
  to: number;
  text: string | null;
  ink: number;
  erase: number;
  frame: string;
}

/** 一句一行;第一句之前画了东西,先补一行「没说话」;没有转写就十五秒一行 */
export function timelineRows(tr: Transcript | null, s: Strokes, totalMs: number): TimelineRow[] {
  const lines = tr?.lines ?? [];
  const spans: { from: number; to: number; text: string | null }[] = [];
  if (lines.length === 0) {
    for (let a = 0; a < Math.max(totalMs, 1); a += 15_000) spans.push({ from: a, to: Math.min(a + 15_000, totalMs), text: null });
  } else {
    if (lines[0].at > 0 && strokesIn(s, 0, lines[0].at).ink + strokesIn(s, 0, lines[0].at).erase > 0) spans.push({ from: 0, to: lines[0].at, text: null });
    lines.forEach((l, i) => spans.push({ from: l.at, to: lineEnd(lines, i, totalMs), text: l.text }));
  }
  return spans.map((sp) => ({ ...sp, ...strokesIn(s, sp.from, sp.to), frame: frameName(sp.to) }));
}

const cell = (s: string): string => s.replace(/\|/g, '｜').replace(/\n/g, ' ');

export function timelineMd(o: { topic: string; tr: Transcript | null; strokes: Strokes; totalMs: number; asks: AskRecord[] }): string {
  const rows = timelineRows(o.tr, o.strokes, o.totalMs);
  const ink = o.strokes.strokes.filter((k) => k.c !== 'erase').length;
  const erase = o.strokes.strokes.length - ink;
  const edited = o.tr?.lines.filter((l) => l.edited).length ?? 0;
  const src = !o.tr ? '没有' : o.tr.source === 'browser' ? '浏览器' : `paraformer${o.tr.why ? `(${o.tr.why})` : ''}`;
  const out = [
    `# ${o.topic}`,
    '',
    `讲了 ${clock(o.totalMs)} · 画了 ${ink} 笔${erase ? `(擦了 ${erase} 下)` : ''} · 转写:${src}${edited ? `,家长改了 ${edited} 处` : ''}`,
    '',
    '| 时刻 | 他说的 | 这段画的 | 这段结束时的画面 |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${clock(r.from)}–${clock(r.to)} | ${r.text === null ? '(没说话)' : cell(r.text)} | ${r.ink} 笔${r.erase ? `,擦 ${r.erase} 下` : ''} | ${r.frame} |`),
    '',
    `画板 ${o.strokes.size.w}×${o.strokes.size.h};每一笔的点和时刻在 strokes.json。`,
  ];
  if (o.asks.length) {
    out.push('', '## 追问的回答', '');
    o.asks.forEach((a, i) => {
      out.push(`${i + 1}. 问:${a.q}`, `   - 他说${a.heardBy === 'paraformer' ? '(paraformer 转的)' : ''}:${a.heard.trim() || '(没认出字,听 ' + (a.audio ?? '录音') + ')'}`);
      if (a.strokes && a.strokes.strokes.length) out.push(`   - 画了 ${a.strokes.strokes.length} 笔:frames/ask-${i + 1}.png`);
      if (a.note.trim()) out.push(`   - 家长记:${a.note.trim()}`);
    });
  }
  return `${out.join('\n')}\n`;
}

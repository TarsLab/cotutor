/**
 * 最终文本里的「## 待裁量」「## 转交」段:剥出来给家长 / 应用,剩下的是给孩子的话。
 * 宽容解析:段在但解析不出(缺 question、to 不合法…)就整段留在正文里——格式是增强不是门槛。
 */
import {
  HANDOFF_HEADING,
  HOLDUP_HEADING,
  HandoffSchema,
  HoldupAskSchema,
  type Handoff,
  type HoldupAsk,
  type HoldupOption,
} from '../schema/index.ts';

export interface ParsedSections {
  /** 去掉两种固定段后的正文 */
  body: string;
  holdup: HoldupAsk | null;
  handoff: Handoff | null;
  /** body 第 k 行 = 原文第 lineMap[k] 行(家长端「看原文」把解析器的行号映回原文用) */
  lineMap: number[];
}

const unquote = (s: string): string => {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1).trim() : t;
};

const H2 = /^##\s+(.+?)\s*$/;

interface SrcLine {
  i: number;
  text: string;
}

interface Segment {
  title: string | null;
  /** H2 标题行在原文里的行号;null 段是 -1 */
  titleLine: number;
  lines: SrcLine[];
}

const SPECIAL = new Set([HOLDUP_HEADING, HANDOFF_HEADING]);
/** 固定段里合法的行:key: value / 列表项 / 缩进的子键 */
const FIELD_LINE = /^(?:[a-z]+:\s*.*|\s*-\s+.*|\s+[a-z]+:\s*.*)$/;

/**
 * 切段。普通 H2 段到下一个 H2 为止;「待裁量」「转交」这两种固定段只吃字段行——
 * 遇到空行且下一非空行不是字段行,段就结束,后面的话回到正文(老师把给孩子的话放最后一段时不能被吞掉)。
 */
function segments(text: string): Segment[] {
  const lines = text.split('\n');
  const out: Segment[] = [{ title: null, titleLine: -1, lines: [] }];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fence = !fence;
    const m = !fence && H2.exec(line);
    if (m) {
      out.push({ title: m[1], titleLine: i, lines: [] });
      continue;
    }
    const cur = out[out.length - 1];
    if (cur.title !== null && SPECIAL.has(cur.title) && !line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = lines[j];
      if (next !== undefined && !H2.test(next) && !FIELD_LINE.test(next)) {
        out.push({ title: null, titleLine: -1, lines: [] });
        continue;
      }
    }
    cur.lines.push({ i, text: line });
  }
  return out;
}

function parseHoldupBody(lines: string[]): HoldupAsk | null {
  let question = '';
  const options: HoldupOption[] = [];
  let inOptions = false;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    let m = /^question:\s*(.*)$/.exec(raw);
    if (m) {
      question = unquote(m[1]);
      inOptions = false;
      continue;
    }
    if (/^options:\s*$/.test(raw)) {
      inOptions = true;
      continue;
    }
    if (!inOptions) continue;
    if (/^\S/.test(raw) && !raw.trimStart().startsWith('-')) {
      inOptions = false;
      continue;
    }
    m = /^\s*-\s+label:\s*(.*)$/.exec(raw);
    if (m) {
      options.push({ label: unquote(m[1]) });
      continue;
    }
    m = /^\s*-\s+(.*)$/.exec(raw);
    if (m) {
      options.push({ label: unquote(m[1]) });
      continue;
    }
    const cur = options[options.length - 1];
    if (!cur) continue;
    m = /^\s+(label|note|recommended):\s*(.*)$/.exec(raw);
    if (!m) continue;
    if (m[1] === 'label') cur.label = unquote(m[2]);
    else if (m[1] === 'note') cur.note = unquote(m[2]);
    else cur.recommended = /^true$/i.test(m[2].trim());
  }
  const r = HoldupAskSchema.safeParse({ question, options: options.filter((o) => o.label) });
  return r.success ? r.data : null;
}

function parseHandoffBody(lines: string[]): Handoff | null {
  const kv: Record<string, string> = {};
  const refs: string[] = [];
  let inRefs = false;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const m = /^([a-z]+):\s*(.*)$/.exec(raw);
    if (m) {
      inRefs = false;
      if (m[1] === 'refs') {
        const v = m[2].trim();
        if (v.startsWith('[') && v.endsWith(']')) {
          refs.push(...v.slice(1, -1).split(',').map(unquote).filter(Boolean));
        } else if (v) refs.push(unquote(v));
        else inRefs = true;
      } else kv[m[1]] = unquote(m[2]);
      continue;
    }
    const li = /^\s*-\s+(.*)$/.exec(raw);
    if (li && inRefs) refs.push(unquote(li[1]));
  }
  const r = HandoffSchema.safeParse({ to: kv.to, why: kv.why, refs });
  return r.success ? r.data : null;
}

export function parseSections(text: string): ParsedSections {
  const segs = segments(text);
  let holdup: HoldupAsk | null = null;
  let handoff: Handoff | null = null;
  const keep: string[] = [];
  const from: number[] = [];
  for (const seg of segs) {
    const body = seg.lines.map((l) => l.text);
    if (seg.title === HOLDUP_HEADING && !holdup) {
      const h = parseHoldupBody(body);
      if (h) {
        holdup = h;
        continue;
      }
    }
    if (seg.title === HANDOFF_HEADING && !handoff) {
      const h = parseHandoffBody(body);
      if (h) {
        handoff = h;
        continue;
      }
    }
    if (seg.title !== null) {
      keep.push(`## ${seg.title}`);
      from.push(seg.titleLine);
    }
    for (const l of seg.lines) {
      keep.push(l.text);
      from.push(l.i);
    }
  }
  // body 是 join 完 trim 的:掐头去尾的空行要同步掐掉,行号才对得上
  let a = 0;
  let b = keep.length;
  while (a < b && !keep[a].trim()) a++;
  while (b > a && !keep[b - 1].trim()) b--;
  return { body: keep.join('\n').trim(), holdup, handoff, lineMap: from.slice(a, b) };
}

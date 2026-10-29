/**
 * 最终文本里的「## 记账」「## 记忆」段:剥出来给应用,剩下的是给孩子的话。
 * 宽容解析:段在但解析不出(没有 thread、没有 name…)就整段留在正文里——格式是增强不是门槛。
 */
import { BOOKKEEPING_HEADING, BookkeepingSchema, MEMORY_HEADING, type Bookkeeping } from '../schema/index.ts';

export interface ParsedSections {
  /** 去掉固定段后的正文 */
  body: string;
  /** 记账任务的回答(《obsidian仓库设计.md》§6);应用按它写日记 */
  bookkeeping: Bookkeeping | null;
  /** 「## 记忆」段的条目(原话,去掉列表点);没有这段 = [] */
  memory: string[];
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

const SPECIAL = new Set([BOOKKEEPING_HEADING, MEMORY_HEADING]);
/** 固定段里合法的行:key: value / 列表项 / 缩进的子键 */
const FIELD_LINE = /^(?:[a-z]+:\s*.*|\s*-\s+.*|\s+[a-z]+:\s*.*)$/;

/**
 * 切段。普通 H2 段到下一个 H2 为止;「记账」这种固定段只吃字段行——
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

/**
 * 记账段:`- thread: x` 起一条,缩进的 `key: value` 是它的字段,`observations:` 后面缩进的 `- ` 是观察;
 * 老师漏写 `- thread:` 直接写 `thread:`(或只写字段)也认——记账任务一次只记一个话题。
 */
function parseBookkeepingBody(lines: string[]): Bookkeeping | null {
  type Draft = { thread?: string; name?: string; textbook?: string; summary?: string; steps?: string; observations: string[] };
  const entries: Draft[] = [];
  let cur: Draft | undefined;
  let inObs = false;
  const start = (): Draft => {
    const d: Draft = { observations: [] };
    entries.push(d);
    return d;
  };
  for (const raw of lines) {
    if (!raw.trim()) continue;
    let m = /^-\s+thread:\s*(.*)$/.exec(raw);
    if (m) {
      cur = start();
      cur.thread = unquote(m[1]);
      inObs = false;
      continue;
    }
    m = /^\s*-?\s*([a-z]+):\s*(.*)$/.exec(raw);
    if (m && (!inObs || /^\s*[a-z]+:/.test(raw))) {
      const c = cur ?? (cur = start());
      const [, key, v] = m;
      inObs = false;
      if (key === 'observations') {
        inObs = true;
        const val = unquote(v);
        if (val) c.observations.push(val);
      } else if (key === 'thread' || key === 'name' || key === 'textbook' || key === 'summary' || key === 'steps') c[key] = unquote(v);
      continue;
    }
    const li = /^\s*-\s+(.*)$/.exec(raw);
    if (li && inObs && cur) cur.observations.push(unquote(li[1]));
  }
  const r = BookkeepingSchema.safeParse({ entries: entries.filter((e) => e.thread && e.name) });
  return r.success ? r.data : null;
}

export function parseSections(text: string): ParsedSections {
  const segs = segments(text);
  let bookkeeping: Bookkeeping | null = null;
  const memory: string[] = [];
  const keep: string[] = [];
  const from: number[] = [];
  for (const seg of segs) {
    const body = seg.lines.map((l) => l.text);
    if (seg.title === BOOKKEEPING_HEADING && !bookkeeping) {
      const b = parseBookkeepingBody(body);
      if (b) {
        bookkeeping = b;
        continue;
      }
    }
    if (seg.title === MEMORY_HEADING) {
      const items = body.map((l) => /^\s*[-*]\s+(.*)$/.exec(l)?.[1].trim() ?? '').filter(Boolean);
      if (items.length) {
        memory.push(...items);
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
  return { body: keep.join('\n').trim(), bookkeeping, memory, lineMap: from.slice(a, b) };
}

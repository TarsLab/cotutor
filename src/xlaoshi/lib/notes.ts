/**
 * notes.md:家长的 Claude Code 写的初步理解(写法在 guide.ts)。页面只读它、只改追问前的勾。
 * 解析永不抛:认不出的行照原样当一条。
 */
import { parseClock } from './transcript.ts';

export interface NoteItem {
  text: string;
  /** 缩进的下一行(追问怎么问、放哪段) */
  detail?: string;
  /** @0:09 或 @0:09-0:52 */
  from?: number;
  to?: number;
  /** 追问前的勾;没写勾 = 要问 */
  checked?: boolean;
  /** 这一条在文件里第几行(0 起),改勾用 */
  line: number;
}

export interface NoteSection {
  title: string;
  /** 「追问」那节 */
  ask: boolean;
  items: NoteItem[];
}

export interface Notes {
  title: string | null;
  sections: NoteSection[];
}

const TIME_RE = /\s*@(\d+:\d{2}(?::\d{2})?)(?:\s*[-–—~]\s*(\d+:\d{2}(?::\d{2})?))?/;
const BOX_RE = /^\[( |x|X)\]\s*/;

function item(raw: string, line: number, ask: boolean): NoteItem {
  let text = raw;
  let checked: boolean | undefined;
  const box = BOX_RE.exec(text);
  if (box) {
    checked = box[1] !== ' ';
    text = text.slice(box[0].length);
  } else if (ask) checked = true;
  const out: NoteItem = { text, line, ...(checked !== undefined ? { checked } : {}) };
  const t = TIME_RE.exec(text);
  if (t) {
    const from = parseClock(t[1]);
    const to = t[2] ? parseClock(t[2]) : null;
    if (from !== null) {
      out.from = from;
      if (to !== null && to > from) out.to = to;
      out.text = (text.slice(0, t.index) + text.slice(t.index + t[0].length)).trim();
    }
  }
  return out;
}

export function parseNotes(md: string): Notes {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let title: string | null = null;
  const sections: NoteSection[] = [];
  let cur: NoteSection | null = null;
  let last: NoteItem | null = null;
  lines.forEach((ln, i) => {
    const h1 = /^#\s+(.+)$/.exec(ln);
    if (h1 && title === null && !cur) { title = h1[1].trim(); return; }
    const h2 = /^##\s+(.+)$/.exec(ln);
    if (h2) {
      const t = h2[1].trim();
      cur = { title: t, ask: t.includes('追问'), items: [] };
      sections.push(cur);
      last = null;
      return;
    }
    if (!cur) return;
    const sec: NoteSection = cur;
    const bullet = /^[-*]\s+(.*)$/.exec(ln);
    if (bullet) {
      last = item(bullet[1], i, sec.ask);
      sec.items.push(last);
      return;
    }
    const more = /^\s{2,}(\S.*)$/.exec(ln);
    if (more && last) {
      const it: NoteItem = last;
      it.detail = it.detail ? `${it.detail} ${more[1].trim()}` : more[1].trim();
      return;
    }
    if (ln.trim()) {
      last = item(ln.trim(), i, false);
      if (sec.ask) delete last.checked;
      sec.items.push(last);
    }
  });
  return { title, sections };
}

/** 追问:勾着的那几条(没写勾的也算) */
export function questions(n: Notes): NoteItem[] {
  return n.sections.filter((s) => s.ask).flatMap((s) => s.items.filter((it) => it.checked !== undefined));
}

/** 改第 line 行的勾;那一行没有勾就补一个;不是列表行 → null */
export function setCheck(md: string, line: number, on: boolean): string | null {
  const lines = md.split('\n');
  const ln = lines[line];
  if (ln === undefined) return null;
  const m = /^([-*]\s+)(\[( |x|X)\]\s*)?(.*)$/.exec(ln);
  if (!m) return null;
  lines[line] = `${m[1]}[${on ? 'x' : ' '}] ${m[4]}`;
  return lines.join('\n');
}

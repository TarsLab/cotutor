/**
 * 课文件(《备课设计.md》§十)的纯函数:解析 lessons/<名>.md、查问题(两级,同首页)、把后期的提案回写成围栏行上的修饰词与讲稿里的 [词]。
 * 文件 = frontmatter(tutor 必填、device / for 可省)+ 板书语法的正文(`---` 独占一行分节,一节 = 孩子端的一轮)+ 第一个 `## ` 起给老师的讲法。
 * 排版在围栏行上(same / tint= / look= / emoji=,src/lib/board.ts 的 splitMods),解析器把它们变成 section.layout 与 card.look,契约不变。
 * 永不抛错;问题都带行号(1 起)。要读盘的(老师在不在、主题槽表)由调用方查好传进来。
 */
import { parseBoard, splitMods, withMods, type CardMods } from './board.ts';
import type { HomeTutorInfo } from './home.ts';
import { findPhrase, isHeading, plainLine, type BoardCard, type BoardSection, type Device } from './kid-board.ts';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICES: readonly Device[] = ['phone', 'tablet-portrait', 'tablet-landscape'];
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const H2 = /^##\s+\S/;
const RULE = /^---\s*$/;
export const DEFAULT_LESSON_DEVICE: Device = 'tablet-landscape';
/** 课文件放 workspace 的这个目录(不进骨架,技能写时自己建) */
export const LESSONS_DIR = 'lessons';
/** 文件名(不带 .md):中英文、数字、-、_,别的字符不认(路径里不能有 / 与 ..) */
export const LESSON_NAME_RE = /^[\p{L}\p{N}_-]{1,64}$/u;

export type LessonIssueLevel = 'fix' | 'note';
export interface LessonIssue {
  level: LessonIssueLevel;
  text: string;
  /** 原文行号,1 起 */
  line?: number;
  /** 出在第几节、第几张卡(0 起;家长端把它钉在那张卡下面);没有就是整份文件的 */
  section?: number;
  card?: number;
}

export interface LessonSectionDoc {
  section: BoardSection;
  /** 每张卡围栏开头行(1 起),与 section.cards 同序;解析器补的提问卡没有围栏,记 0 */
  cardLines: number[];
  /** 每句讲稿的行(1 起),与 section.lines 同序 */
  lineLines: number[];
  /** 这节的原文(不含分节线),交给孩子时当 kidText 之外的原文留档 */
  md: string;
}

export interface LessonDoc {
  tutor: string | null;
  device: Device;
  for?: string;
  sections: LessonSectionDoc[];
  /** 第一个 H2 起给老师的讲法(原文含标题行);没有 = 空串 */
  brief: string;
  /** 解析时就能看出来的问题 */
  issues: LessonIssue[];
}

export interface Frontmatter {
  keys: Record<string, { value: string; line: number }>;
  /** 正文从第几行起(0 起) */
  start: number;
  issues: LessonIssue[];
}

export function readFrontmatter(all: readonly string[]): Frontmatter {
  const out: Frontmatter = { keys: {}, start: 0, issues: [] };
  if (!/^---\s*$/.test(all[0] ?? '')) return out;
  const close = all.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
  if (close < 0) {
    out.issues.push({ level: 'fix', line: 1, text: 'frontmatter 没闭合:tutor: 那几行之后单独一行写 ---' });
    return out;
  }
  for (let i = 1; i < close; i++) {
    const l = all[i];
    if (!l.trim()) continue;
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(l);
    if (!m) out.issues.push({ level: 'note', line: i + 1, text: `frontmatter 这行认不出(只认 key: value):${l.trim()}` });
    else out.keys[m[1]] = { value: m[2].trim().replace(/^(["'])(.*)\1$/, '$2').replace(/\s+#.*$/, ''), line: i + 1 };
  }
  out.start = close + 1;
  return out;
}

/** 正文按 `---` 分节(围栏里的不算),第一个 H2(围栏外)起是讲法 */
function splitBody(body: readonly string[], offset: number): { chunks: { lines: string[]; from: number }[]; brief: string } {
  const chunks: { lines: string[]; from: number }[] = [];
  let cur: { lines: string[]; from: number } = { lines: [], from: offset };
  let fence: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    if (fence) {
      cur.lines.push(line);
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      fence = open[1];
      cur.lines.push(line);
      continue;
    }
    if (H2.test(line)) {
      chunks.push(cur);
      return { chunks, brief: body.slice(i).join('\n').trim() };
    }
    if (RULE.test(line)) {
      chunks.push(cur);
      cur = { lines: [], from: offset + i + 1 };
      continue;
    }
    cur.lines.push(line);
  }
  chunks.push(cur);
  return { chunks, brief: '' };
}

export function parseLesson(md: string): LessonDoc {
  const all = md.replace(/\r\n/g, '\n').split('\n');
  const fm = readFrontmatter(all);
  const issues: LessonIssue[] = [...fm.issues];
  let tutor: string | null = null;
  let device: Device = DEFAULT_LESSON_DEVICE;
  let forDay: string | undefined;
  for (const [k, { value, line }] of Object.entries(fm.keys)) {
    if (k === 'tutor') tutor = value || null;
    else if (k === 'device') {
      if ((DEVICES as readonly string[]).includes(value)) device = value as Device;
      else issues.push({ level: 'fix', line, text: `device 只认 ${DEVICES.join(' / ')},「${value}」不认` });
    } else if (k === 'for') {
      if (DAY_RE.test(value)) forDay = value;
      else issues.push({ level: 'note', line, text: `for 要写成 YYYY-MM-DD,「${value}」不认` });
    } else issues.push({ level: 'note', line, text: `frontmatter 只认 tutor / device / for,${k} 不管用` });
  }
  if (!tutor) issues.push({ level: 'fix', line: fm.start ? 1 : undefined, text: 'frontmatter 要写 tutor: <老师的键>(cotutor.json 里以 -tutor 结尾的,如 math-tutor)' });
  const body = all.slice(fm.start);
  const { chunks, brief } = splitBody(body, fm.start);
  const sections: LessonSectionDoc[] = [];
  for (const ch of chunks) {
    if (!ch.lines.some((l) => l.trim())) continue;
    const board = parseBoard(ch.lines.join('\n'), { device });
    const at = (n: number): number => ch.from + n + 1;
    const k = sections.length;
    const cardAt = (line: number | undefined): { section: number; card: number } | Record<string, never> => {
      const n = line === undefined ? -1 : board.spans.cards.findIndex((s) => s[0] === line);
      return n >= 0 ? { section: k, card: n } : {};
    };
    for (const w of board.warnings) issues.push({ level: w.fallback ? 'fix' : 'note', text: w.text, ...(w.line !== undefined ? { line: at(w.line) } : {}), ...cardAt(w.line) });
    // 标签写的种类和解析出来的对不上 = 退了(解析器已报 fallback 的不重报;这里兜不认识的标签退成代码卡)
    board.spans.cards.forEach((s, n) => {
      const line = ch.lines[s[0]] ?? '';
      const m = FENCE.exec(line);
      const tag = m ? splitMods(m[2]).rest.split(/\s+/)[0]?.toLowerCase() ?? '' : '';
      const card = board.section.cards[n];
      if (tag && card.kind !== tag && !board.warnings.some((w) => w.fallback && w.line === s[0])) issues.push({ level: 'fix', line: at(s[0]), section: k, card: n, text: `这张卡没解析成 ${tag}(不认识的种类?)` });
    });
    if (!board.section.cards.length && !board.section.lines.length) continue;
    const { section } = board;
    if (!section.cards.some((c) => !c.props.ask)) issues.push({ level: 'note', line: at(0), section: k, text: '这节没有卡,孩子只听到话' });
    const last = section.lines[section.lines.length - 1];
    if (section.lines.length && !last.ask) issues.push({ level: 'note', line: at(board.spans.lines[board.spans.lines.length - 1][0]), section: k, text: '这节末句不是问句:孩子端念完不会停下等他答,直接接下一节' });
    sections.push({
      section,
      cardLines: board.spans.cards.map((s, n) => (board.section.cards[n].props.ask ? 0 : at(s[0]))),
      lineLines: board.spans.lines.map((s) => at(s[0])),
      md: ch.lines.join('\n').trim(),
    });
  }
  if (!sections.length) issues.push({ level: 'fix', text: '正文是空的:至少写一节(几张卡加讲稿,末句问孩子)' });
  return { tutor, device, ...(forDay ? { for: forDay } : {}), sections, brief, issues };
}

export interface LessonCheckContext {
  tutors: Record<string, HomeTutorInfo>;
  /** 主题的槽名(tint= / look= 只认这些) */
  tints: readonly string[];
  looks: readonly string[];
  today: string;
}

/** 解析的问题 + 老师在不在 + 槽名对不对 + 没讲法;按行号排 */
export function lessonIssues(doc: LessonDoc, ctx: LessonCheckContext): LessonIssue[] {
  const out = [...doc.issues];
  if (doc.tutor) {
    const t = ctx.tutors[doc.tutor];
    const names = Object.keys(ctx.tutors).filter((n) => n.endsWith('-tutor'));
    if (!t) out.push({ level: 'fix', line: 1, text: `tutor: ${doc.tutor}——cotutor.json 里没有这位老师(有:${names.join('、')})` });
    else if (!doc.tutor.endsWith('-tutor')) out.push({ level: 'fix', line: 1, text: `tutor: ${doc.tutor} 是工具人(键不以 -tutor 结尾),孩子不直接找它` });
    else if (!t.enabled) out.push({ level: 'fix', line: 1, text: `${t.display}关着(cotutor.json enabled = false),先打开` });
    else if (t.hidden) out.push({ level: 'fix', line: 1, text: `${t.display}孩子端不露(hidden),孩子找不到这节课` });
  }
  doc.sections.forEach((s, k) => {
    s.section.cards.forEach((c, n) => {
      const line = s.cardLines[n];
      if (c.look?.tint && !ctx.tints.includes(c.look.tint)) out.push({ level: 'fix', line, section: k, card: n, text: `tint=${c.look.tint} 不在主题的底色槽里(有:${ctx.tints.join('、')})` });
      if (c.look?.look && !ctx.looks.includes(c.look.look)) out.push({ level: 'fix', line, section: k, card: n, text: `look=${c.look.look} 不在主题的字形槽里(有:${ctx.looks.join('、') || '一个都没有'})` });
    });
  });
  if (doc.for && doc.for < ctx.today) out.push({ level: 'note', text: `for 是 ${doc.for},已经过去了(交给孩子照样能交)` });
  if (!doc.brief.trim()) out.push({ level: 'note', text: '没有给老师的讲法(「## 讲法」):孩子答了之后老师只知道孩子看过这几节,不知道你想怎么接' });
  return out.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
}

/** 一张卡的排版修饰词:接上一行(不是本行第一张)、样子 */
export function modsOf(section: BoardSection, n: number): CardMods {
  const rows = section.layout?.rows ?? [];
  const row = rows.find((r) => r.includes(n));
  const same = row !== undefined && row[0] !== n;
  const c = section.cards[n];
  return { ...(same ? { same: true as const } : {}), ...(c.look?.tint ? { tint: c.look.tint } : {}), ...(c.look?.look ? { look: c.look.look } : {}), ...(c.look?.emoji ? { emoji: c.look.emoji } : {}) };
}

/**
 * 后期的提案回写进文件(《备课设计.md》§10.4):每张卡的围栏行换上 same / tint= / look= / emoji=(手写过的当已定,只填没写的:posted 是「文件的节」跑完后期的结果,
 * 调用方已把文件里写了的盖回去);后期的标注(带 pen 的)写成讲稿里的 [词]——那句里有这个词才写得进,没有的丢掉。
 * 讲稿里已有 [词] 的不重复。返回新的全文与改了几处
 */
export function applyPostToLesson(md: string, doc: LessonDoc, posted: readonly BoardSection[]): { md: string; fences: number; marks: number } {
  const all = md.replace(/\r\n/g, '\n').split('\n');
  let fences = 0;
  let marks = 0;
  doc.sections.forEach((s, k) => {
    const sec = posted[k];
    if (!sec) return;
    sec.cards.forEach((c, n) => {
      const line = s.cardLines[n];
      if (!line || isHeading(c)) return;
      const next = withMods(all[line - 1], modsOf(sec, n));
      if (next !== all[line - 1]) { all[line - 1] = next; fences++; }
    });
    sec.lines.forEach((l, i) => {
      const line = s.lineLines[i];
      if (!line) return;
      let text = all[line - 1];
      for (const m of l.marks) {
        if (!m.pen) continue;
        if (text.includes(`[${m.phrase}]`)) continue;
        const plain = plainLine(text);
        if (findPhrase(plain, m.phrase) < 0) continue;
        // 词在原文里(去掉已有的方括号后)的位置:原文里方括号只包别的词,直接在原文找也找得到
        const at = text.indexOf(m.phrase);
        if (at < 0) continue;
        text = `${text.slice(0, at)}[${m.phrase}]${text.slice(at + m.phrase.length)}`;
        marks++;
      }
      if (text !== all[line - 1]) all[line - 1] = text;
    });
  });
  return { md: all.join('\n'), fences, marks };
}


/** 全文剥掉排版:围栏行去掉排版修饰词、围栏外的行去掉方括号(标注);比对两份文件「除了排版一个字没动」用 */
export function stripLayout(md: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (fence) {
      out.push(line);
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      continue;
    }
    const open = FENCE.exec(line);
    if (open) { fence = open[1]; out.push(withMods(line, {}).replace(/\s+$/, '')); continue; }
    out.push(line.replace(/[[\]]/g, ''));
  }
  return out.join('\n').trim();
}

/**
 * 整份排版的回复(模型回的整份文件)套回原文(《备课设计.md》§10.4,拍板 31):正文必须一个字没动(剥掉排版后逐字相同),否则整份不要;
 * 围栏行上你手写过的修饰词当已定(same、tint、look、emoji 逐项盖回去),模型只填你没写的;讲稿里的 [词] 收模型的。返回新全文与改了几处
 */
export function applyLayoutReply(md: string, reply: string): { ok: true; md: string; fences: number; marks: number } | { ok: false; why: string } {
  const text = reply.replace(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n\s*```\s*$/, '$1');
  if (stripLayout(md) !== stripLayout(text)) return { ok: false, why: '回来的文件正文和原文对不上(不只改了排版),整份不要' };
  const orig = parseLesson(md);
  const next = parseLesson(text);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const origLines = md.replace(/\r\n/g, '\n').split('\n');
  let fences = 0;
  next.sections.forEach((s, k) => {
    const o = orig.sections[k];
    s.section.cards.forEach((c, n) => {
      const line = s.cardLines[n];
      if (!line || isHeading(c)) return;
      const mine = o ? modsOf(o.section, n) : {};
      const theirs = modsOf(s.section, n);
      const merged: CardMods = { ...theirs, ...mine };
      const built = withMods(lines[line - 1], merged);
      const before = o?.cardLines[n] ? origLines[o.cardLines[n] - 1] : '';
      if (built !== before) fences++;
      lines[line - 1] = built;
    });
  });
  const marks = (text.match(/\[[^[\]\n]+\]/g) ?? []).length - (md.match(/\[[^[\]\n]+\]/g) ?? []).length;
  return { ok: true, md: lines.join('\n'), fences, marks: Math.max(0, marks) };
}

/** 给孩子端的节:讲稿句配好音的文件名并进去(与 runner 的做法同:audio = 相对 conversations/<老师>/ 的文件名) */
export function withAudio(section: BoardSection, audio: readonly (string | null)[]): BoardSection {
  return { ...section, lines: section.lines.map((l, i) => ({ ...l, audio: audio[i] ?? null })) };
}

/** 一张卡的提示(清单、工作台里用):种类 + 标题 */
export function cardBrief(c: BoardCard): string {
  const p = c.props;
  const t = typeof p.title === 'string' ? p.title : typeof p.question === 'string' ? p.question : typeof p.text === 'string' ? p.text : '';
  return `${c.kind}${t ? `「${Array.from(t).slice(0, 12).join('')}」` : ''}`;
}

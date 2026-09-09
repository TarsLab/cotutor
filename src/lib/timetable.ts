/**
 * 课程表解析(抄自 growth-apps apps/web/src/timetable.ts,2026-09-09;孩子列改为可选)。
 * 表头须含 星期/时间/学科 三列(孩子列可有可无,顺序不限,多余列忽略);可以有多张表;列名对不上的表整张跳过。
 * 错误即修复指南,带行号;解析尽量往下走,一次报全。
 */
import type { TimetableEntry } from '../schema/index.ts';

export interface TimetableParse {
  entries: TimetableEntry[];
  /** 没找到任何课程表时 entries 为空且这里有整体指南 */
  errors: string[];
  found: boolean;
}

const REQUIRED = ['星期', '时间', '学科'] as const;
const DAY_MAP: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const DAY_NAMES = ['', '一', '二', '三', '四', '五', '六', '日'];

export function dayName(day: number): string {
  return `周${DAY_NAMES[day] ?? '?'}`;
}

const cells = (line: string): string[] =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
const isTableRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);
const isSeparatorRow = (line: string): boolean => isTableRow(line) && cells(line).every((c) => /^:?-{2,}:?$/.test(c) || c === '');

function parseDay(raw: string): number | null {
  const s = raw.replace(/^(星期|周)/, '').trim();
  if (/^[1-7]$/.test(s)) return Number(s);
  return DAY_MAP[s] ?? null;
}

const TIME_RE = /^(\d{1,2}):(\d{2})\s*[-–—~至]+\s*(\d{1,2}):(\d{2})$/;

function parseTime(raw: string): { start: string; end: string } | null {
  const m = TIME_RE.exec(raw.trim());
  if (!m) return null;
  const [h1, m1, h2, m2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const start = `${String(h1).padStart(2, '0')}:${m[2]}`;
  const end = `${String(h2).padStart(2, '0')}:${m[4]}`;
  if (start >= end) return null;
  return { start, end };
}

export function parseTimetable(md: string): TimetableParse {
  const lines = md.split('\n');
  const errors: string[] = [];
  const entries: TimetableEntry[] = [];
  let found = false;
  let i = 0;
  while (i < lines.length) {
    if (!isTableRow(lines[i])) {
      i++;
      continue;
    }
    const header = cells(lines[i]);
    const col: Record<string, number> = { 星期: header.indexOf('星期'), 时间: header.indexOf('时间'), 学科: header.indexOf('学科'), 孩子: header.indexOf('孩子') };
    if (REQUIRED.some((name) => col[name] < 0)) {
      i++;
      while (i < lines.length && isTableRow(lines[i])) i++;
      continue;
    }
    found = true;
    i++;
    if (i < lines.length && isSeparatorRow(lines[i])) i++;
    for (; i < lines.length && isTableRow(lines[i]); i++) {
      const row = cells(lines[i]);
      const ln = i + 1;
      const get = (name: string): string => (col[name] >= 0 ? (row[col[name]] ?? '') : '');
      const day = parseDay(get('星期'));
      if (day === null) {
        errors.push(`第 ${ln} 行:星期「${get('星期')}」认不出;写 一/二/…/日(或 1–7)`);
        continue;
      }
      const time = parseTime(get('时间'));
      if (!time) {
        errors.push(`第 ${ln} 行:时间「${get('时间')}」应形如 19:00–19:40(起止用 – 或 - 连接,且结束晚于开始)`);
        continue;
      }
      const subject = get('学科');
      if (!subject) {
        errors.push(`第 ${ln} 行:学科为空;写 语文/数学/英语 等(与 cotutor.json 里老师的 subject 对齐即归到那位老师)`);
        continue;
      }
      const kid = get('孩子');
      entries.push({ day, ...time, subject, ...(kid ? { kid } : {}) });
    }
  }
  if (!found) return { entries: [], errors: ['没找到课程表:课程表.md 里需要一张含 星期/时间/学科 三列表头的 markdown 表(孩子列可选)'], found: false };
  entries.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  return { entries, errors, found: true };
}

/** js Date → 1–7(周一–周日) */
export function dayOf(now: Date): number {
  const d = now.getDay();
  return d === 0 ? 7 : d;
}

/** 本周(周一起算)第 day 天的日期 YYYY-MM-DD */
export function weekDate(now: Date, day: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + (day - dayOf(now)));
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 当前正在进行的时段(第一条命中;不在任何时段 = null,不猜) */
export function currentSlot(entries: readonly TimetableEntry[], now: Date): TimetableEntry | null {
  const day = dayOf(now);
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return entries.find((e) => e.day === day && e.start <= hm && hm < e.end) ?? null;
}

/** 上下文包的 slot 字段:「数学 16:00-17:00」 */
export function slotLabel(e: TimetableEntry): string {
  return `${e.subject} ${e.start}-${e.end}`;
}

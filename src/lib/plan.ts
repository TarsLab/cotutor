/**
 * 计划文件解析(《cotutor契约草案.md》§8),与课程表解析同法:纯函数,错误即修复指南带行号。
 * frontmatter 要有 week(2026-W37)与 status(draft | confirmed);正文按老师显示名分 H2。
 */
import { PLAN_STATUS, WEEK_RE, type Plan, type PlanSection, type PlanStatus } from '../schema/index.ts';

export interface PlanParse {
  plan: Plan | null;
  errors: string[];
}

const LIST_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+/;

export function parsePlan(md: string): PlanParse {
  const lines = md.split('\n');
  const errors: string[] = [];
  if (!/^---\s*$/.test(lines[0] ?? '')) {
    return { plan: null, errors: ['第 1 行:计划文件要以 --- 开头的 frontmatter 起,里面写 week: 2026-W37 和 status: draft'] };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) {
      close = i;
      break;
    }
  }
  if (close < 0) return { plan: null, errors: ['frontmatter 没有闭合:在 week / status 之后单独一行写 ---'] };
  const fm: Record<string, string> = {};
  for (let i = 1; i < close; i++) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (m) fm[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
    else if (lines[i].trim()) errors.push(`第 ${i + 1} 行:frontmatter 只认 key: value,这行认不出`);
  }
  if (!fm.week) errors.push('frontmatter 缺 week(如 week: 2026-W37)');
  else if (!WEEK_RE.test(fm.week)) errors.push(`week "${fm.week}" 格式不对,应为 YYYY-Www(如 2026-W37)`);
  if (!fm.status) errors.push('frontmatter 缺 status(draft 或 confirmed)');
  else if (!(PLAN_STATUS as readonly string[]).includes(fm.status)) errors.push(`status "${fm.status}" 只能是 draft 或 confirmed`);

  const sections: PlanSection[] = [];
  let cur: PlanSection | null = null;
  let fence = false;
  for (let i = close + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      cur = { title: h2[1], lines: [] };
      sections.push(cur);
      continue;
    }
    if (/^#\s/.test(line)) continue;
    const t = line.replace(LIST_PREFIX, '').trim();
    if (!t) continue;
    if (!cur) {
      errors.push(`第 ${i + 1} 行:正文要先有一个 ## 老师显示名 的标题,这行不知道归谁`);
      continue;
    }
    cur.lines.push(t);
  }
  if (errors.length) return { plan: null, errors };
  return { plan: { week: fm.week, status: fm.status as PlanStatus, author: fm.author, sections }, errors };
}

/** 抽「与这位老师相关的行」:H2 标题等于显示名(两侧空白不计),最多 limit 行 */
export function planLinesFor(plan: Plan, display: string, limit: number): string[] {
  const want = display.trim();
  const out: string[] = [];
  for (const s of plan.sections) if (s.title.trim() === want) out.push(...s.lines);
  return out.slice(0, limit);
}

/** ISO 周号 YYYY-Www(周一起,含 1 月 4 日的那周是第 1 周),计划文件按它命名 */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

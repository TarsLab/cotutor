/**
 * activity 文件的纯函数(形状在 src/schema/activity.ts):
 * 解析(永不抛,写坏的行变成问题)、检查(带行号,fix = 要改 / note = 提醒)、递给老师的那节(剥注释、按参数与卡裁段)、工具人模板填插槽。不读文件。
 */
import {
  ACTIVITY_BASES,
  ACTIVITY_OLD_BOARD,
  ACTIVITY_LISTENS,
  ACTIVITY_REPLIES,
  ACTIVITY_PARAM_TYPES,
  ACTIVITY_RESERVED_PARAMS,
  ACTIVITY_SECTIONS,
  ACTIVITY_SLOT,
  ACTIVITY_TOOLS,
  ACTIVITY_TOOL_SECTION_RE,
  type Activity,
  type ActivityBase,
  type ActivityParam,
  type ActivityParamType,
  type ActivityTool,
  type ActivityValue,
} from '../schema/index.ts';
import { parseFrontmatter } from '../shared/frontmatter.ts';
import { GUARD_CLOSE, GUARD_OPEN, applyGuards } from '../shared/guards.ts';
import { stripHumanNotes } from '../shared/human-notes.ts';

export type ActivityIssueLevel = 'fix' | 'note';

export interface ActivityIssue {
  /** fix = 要改;note = 提醒 */
  level: ActivityIssueLevel;
  text: string;
  /** 原文行号,1 起 */
  line?: number;
}

export interface ParsedActivity {
  activity: Activity;
  /** 写法上的问题(哪行解析不了);对不对得上注册表由 checkActivity 查 */
  issues: ActivityIssue[];
}

interface Line {
  text: string;
  no: number;
}

interface Fence {
  label: string;
  lines: Line[];
  no: number;
}

const FENCE_OPEN = /^(`{3,})[ \t]*(\S*)[ \t]*$/;
const H2 = /^##[ \t]+(.+?)[ \t]*$/;
/** 名: 说法 —— 说明 */
const NAMED_LINE = /^([^\s:：]+)[ \t]*[:：][ \t]*(.*)$/;
const NOTE_SEP = /\s*——\s*/;
const FIRST_LINE = /^第一句[ \t]*[:：]/m;
/** 人设:「老师怎么带」自己写「你是……」(没有别的地方说老师是谁) */
const PERSONA_LINE = /^你是/m;
const CLOSE_LINE = /^收[ \t]*[:：]/m;

const isType = (t: string): t is ActivityParamType => (ACTIVITY_PARAM_TYPES as readonly string[]).includes(t);

/** 一节里的围栏(按标签);没收口的报一条 */
function fencesOf(lines: Line[], issues: ActivityIssue[]): Fence[] {
  const out: Fence[] = [];
  let open: { ticks: string; fence: Fence } | null = null;
  for (const l of lines) {
    if (open) {
      if (new RegExp(`^${open.ticks}[ \\t]*$`).test(l.text)) {
        out.push(open.fence);
        open = null;
      } else open.fence.lines.push(l);
      continue;
    }
    const m = FENCE_OPEN.exec(l.text);
    if (m) open = { ticks: m[1], fence: { label: m[2], lines: [], no: l.no } };
  }
  if (open) issues.push({ level: 'fix', text: `第 ${open.fence.no} 行的围栏没有收口(少了 ${open.ticks})`, line: open.fence.no });
  return out;
}

/** 名: 说法 —— 说明;不是这个样子返回 null */
function namedLine(text: string): { name: string; spec: string; note?: string } | null {
  const [head, ...rest] = text.split(NOTE_SEP);
  const m = NAMED_LINE.exec(head.trim());
  if (!m) return null;
  const note = rest.join('——').trim();
  return { name: m[1], spec: m[2].trim(), ...(note ? { note } : {}) };
}

function parseParam(l: Line, issues: ActivityIssue[]): ActivityParam | null {
  const n = namedLine(l.text);
  if (!n || !n.spec) {
    issues.push({ level: 'fix', text: `「${l.text.trim()}」:参数写成「名: 类型[,可空][,缺省 X][,A 到 B] —— 说明」,如「词: 词表,可空 —— 这周学的词」`, line: l.no });
    return null;
  }
  const [type, ...flags] = n.spec.split(/\s*[,，]\s*/).filter(Boolean);
  if (!isType(type)) {
    issues.push({ level: 'fix', text: `参数「${n.name}」的类型「${type}」不认得:只有 ${ACTIVITY_PARAM_TYPES.join('、')}`, line: l.no });
    return null;
  }
  const p: ActivityParam = { name: n.name, type, optional: false, line: l.no, ...(n.note ? { note: n.note } : {}) };
  for (const f of flags) {
    const dflt = /^缺省\s*(.+)$/.exec(f);
    const range = /^(-?\d+)\s*到\s*(-?\d+)$/.exec(f);
    if (f === '可空') p.optional = true;
    else if (dflt) p.default = dflt[1].trim();
    else if (range) {
      p.min = Number(range[1]);
      p.max = Number(range[2]);
    } else issues.push({ level: 'fix', text: `参数「${n.name}」的「${f}」不认得:只有 可空、缺省 X、A 到 B`, line: l.no });
  }
  return p;
}

const contentLines = (f: Fence): Line[] => f.lines.filter((l) => l.text.trim());

/** 去掉一段行的头尾空行,拼回原文 */
function joinTrimmed(lines: Line[]): { text: string; line: number } {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].text.trim()) a++;
  while (b > a && !lines[b - 1].text.trim()) b--;
  return { text: lines.slice(a, b).map((l) => l.text).join('\n'), line: lines[a]?.no ?? 0 };
}

/** 解析一份 activity 文件。永不抛:写坏的行进 issues,其余照常解析 */
export function parseActivity(text: string): ParsedActivity {
  const issues: ActivityIssue[] = [];
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  let bodyStart = 0;
  let frontmatter: Record<string, string> = {};
  if (/^---[ \t]*$/.test(rows[0] ?? '')) {
    const end = rows.findIndex((r, i) => i > 0 && /^---[ \t]*$/.test(r));
    if (end > 0) {
      frontmatter = parseFrontmatter(rows.slice(0, end + 1).join('\n')).frontmatter;
      bodyStart = end + 1;
    } else issues.push({ level: 'fix', text: '头上的 --- 没有收口', line: 1 });
  } else issues.push({ level: 'fix', text: '头上要有 --- 包着的 name / description / base', line: 1 });

  // 按 `## ` 切节;围栏里的 `## ` 不算
  const sections: { title: string; no: number; lines: Line[] }[] = [];
  let ticks: string | null = null;
  for (let i = bodyStart; i < rows.length; i++) {
    const l = { text: rows[i], no: i + 1 };
    if (ticks) {
      if (new RegExp(`^${ticks}[ \\t]*$`).test(l.text)) ticks = null;
    } else {
      const f = FENCE_OPEN.exec(l.text);
      if (f) ticks = f[1];
      else {
        const h = H2.exec(l.text);
        if (h) {
          sections.push({ title: h[1], no: l.no, lines: [] });
          continue;
        }
      }
    }
    sections[sections.length - 1]?.lines.push(l);
  }

  // 旧的头还认一段时间:board: page 没写 base 的当 base: photo(ACTIVITY_OLD_BOARD);cards 读进来就丢(课里没有卡了,2026-11-17)
  const oldBoard = frontmatter.board?.trim() === ACTIVITY_OLD_BOARD;
  const old = [...(frontmatter.board?.trim() ? [`board: ${frontmatter.board.trim()}`] : []), ...(frontmatter.cards?.trim() ? [`cards: ${frontmatter.cards.trim()}`] : [])];
  const activity: Activity = {
    name: frontmatter.name ?? '',
    description: frontmatter.description ?? '',
    ...(frontmatter.base?.trim() ? { base: frontmatter.base.trim() } : oldBoard ? { base: 'photo' } : {}),
    ...(frontmatter.listen?.trim() ? { listen: frontmatter.listen.trim() } : {}),
    ...(frontmatter.reply?.trim() ? { reply: frontmatter.reply.trim() } : {}),
    ...(old.length ? { old } : {}),
    params: [],
    tutor: null,
    tools: [],
  };
  const seen = new Map<string, number>();
  for (const s of sections) {
    const tool = ACTIVITY_TOOL_SECTION_RE.exec(s.title)?.[1];
    const known = Object.values(ACTIVITY_SECTIONS).includes(s.title as never) || tool !== undefined;
    if (!known) continue;
    if (seen.has(s.title)) {
      issues.push({ level: 'fix', text: `「## ${s.title}」写了两节(第 ${seen.get(s.title)} 行已有),并成一节`, line: s.no });
      continue;
    }
    seen.set(s.title, s.no);
    if (s.title === ACTIVITY_SECTIONS.tutor) {
      activity.tutor = joinTrimmed(s.lines);
      continue;
    }
    const fences = fencesOf(s.lines, issues);
    const pick = (label: string): Fence[] => fences.filter((f) => f.label === label);
    if (s.title === ACTIVITY_SECTIONS.params) {
      const fs = pick('参数');
      if (!fs.length) issues.push({ level: 'fix', text: '「## 家长填的」里要有一个 ```参数 围栏,一行一个参数', line: s.no });
      for (const l of fs.flatMap(contentLines)) {
        const p = parseParam(l, issues);
        if (p) activity.params.push(p);
      }
    } else if (tool !== undefined) {
      if (!ACTIVITY_TOOLS[tool]) {
        issues.push({ level: 'fix', text: `没有「${tool}」这个工具人:只有 ${Object.keys(ACTIVITY_TOOLS).join('、')}`, line: s.no });
        continue;
      }
      const [prompt, ...more] = pick(tool);
      if (!prompt) {
        issues.push({ level: 'fix', text: `「## ${s.title}」里要有一个 \`\`\`${tool} 围栏,写交给${tool}的那段`, line: s.no });
        continue;
      }
      if (more.length) issues.push({ level: 'fix', text: `「## ${s.title}」里 \`\`\`${tool} 写了 ${more.length + 1} 个,只要一个`, line: more[0].no });
      const neg = pick(`${tool}不要`);
      const t: ActivityTool = { tool, prompt: joinTrimmed(prompt.lines).text, line: s.no, promptLine: prompt.no + 1 };
      if (neg.length) t.negative = neg.flatMap(contentLines).map((l) => l.text.trim()).join('\n');
      activity.tools.push(t);
    }
  }
  return { activity, issues };
}

export interface CheckOptions {
  /** 文件名(不带 .md);给了就查 name 和它一样 */
  fileName?: string;
}

/** 这一节课铺哪种页:头上的 base;没写当 photo(进来先拍照,不拍就是白纸;2026-11-17 起没有不铺页的课) */
export const activityBase = (a: Pick<Activity, 'base'>): ActivityBase => (a.base === 'textbook' || a.base === 'lecture' ? a.base : 'photo');

/** 对注册表查:参数、裁段的名字、插槽、第一句与收 */
export function checkActivity(a: Activity, opts: CheckOptions = {}): ActivityIssue[] {
  const issues: ActivityIssue[] = [];
  const fix = (text: string, line?: number): void => void issues.push({ level: 'fix', text, ...(line ? { line } : {}) });

  if (!a.name) fix('头上缺 name');
  else if (opts.fileName !== undefined && a.name !== opts.fileName) fix(`头上的 name 是「${a.name}」,文件名是「${opts.fileName}.md」,两个要一样`);
  if (!a.description) fix('头上缺 description:一句话说这个 activity 做什么,家长在首页挑的时候看它');

  const names = new Map<string, number>();
  for (const p of a.params) {
    if (names.has(p.name)) fix(`参数「${p.name}」写了两次(第 ${names.get(p.name)} 行已有)`, p.line);
    names.set(p.name, p.line);
    if ((ACTIVITY_RESERVED_PARAMS as readonly string[]).includes(p.name)) fix(`参数不能叫「${p.name}」:首页按钮下面这一行已经有别的意思`, p.line);
    if (p.min !== undefined && p.type !== '数') fix(`参数「${p.name}」是${p.type},不能写范围`, p.line);
    if (p.min !== undefined && p.max !== undefined && p.min > p.max) fix(`参数「${p.name}」的范围 ${p.min} 到 ${p.max} 反了`, p.line);
    if (p.default !== undefined) {
      if (p.type === '数') {
        const v = Number(p.default);
        if (!/^-?\d+$/.test(p.default)) fix(`参数「${p.name}」是数,缺省「${p.default}」不是整数`, p.line);
        else if ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) fix(`参数「${p.name}」的缺省 ${v} 不在 ${p.min} 到 ${p.max} 里`, p.line);
      }
      if (p.type === '日期' && !/^\d{4}-\d{2}-\d{2}$/.test(p.default)) fix(`参数「${p.name}」是日期,缺省要写成 2026-10-12 这样`, p.line);
    }
  }

  if (a.old?.length) issues.push({ level: 'note', text: `头上的「${a.old.join('」「')}」不用再写了:课里没有卡,铺哪种页写 base: photo(孩子拍的作业)、textbook(课本)或 lecture(小课堂),老师在讲稿里写动作(cards/动作怎么写.md)。现在照 base: ${activityBase(a)} 读` });
  if (a.base === undefined && !a.old?.length) issues.push({ level: 'note', text: '头上没写 base:当 base: photo(进来先拍照,不拍就是白纸)' });
  if (a.base !== undefined && !ACTIVITY_BASES[a.base]) fix(`头上 base 写的「${a.base}」不认得:只有 ${Object.keys(ACTIVITY_BASES).join('、')}`);
  if (a.listen !== undefined && !ACTIVITY_LISTENS[a.listen]) fix(`头上 listen 写的「${a.listen}」不认得:只有 ${Object.keys(ACTIVITY_LISTENS).join('、')}(不写 = 照老师的,缺省按住说)`);
  if (a.reply !== undefined && !ACTIVITY_REPLIES[a.reply]) fix(`头上 reply 写的「${a.reply}」不认得:只有 ${Object.keys(ACTIVITY_REPLIES).join('、')}(不写 = 脑先答)`);
  if (!a.tutor) fix('没有「## 老师怎么带」:这一节是老师的系统提示,activity 都要有');
  else {
    const rows = a.tutor.text.split('\n');
    const at = (i: number): number => a.tutor!.line + i;
    const open: number[] = [];
    rows.forEach((row, i) => {
      const g = GUARD_OPEN.exec(row);
      if (g) {
        open.push(at(i));
        for (const n of g[1].trim().split(/\s+/)) if (!names.has(n)) fix(`{{有 ${n}}}:「${n}」不是这个 activity 的参数`, at(i));
      } else if (GUARD_CLOSE.test(row) && open.pop() === undefined) fix('{{/有}} 多了一个', at(i));
    });
    for (const l of open) fix('{{有 …}} 没有配对的 {{/有}}', l);

    const body = stripHumanNotes(a.tutor.text);
    if (!PERSONA_LINE.test(body)) fix('「## 老师怎么带」要有一句人设,以「你是」开头:老师是谁写在这里', a.tutor.line);
    if (!FIRST_LINE.test(body)) fix('「## 老师怎么带」要写一行「第一句: …」:孩子点进来老师先说什么', a.tutor.line);
    if (!CLOSE_LINE.test(body)) fix('「## 老师怎么带」要写一行「收: …」:到哪一步收', a.tutor.line);
  }

  for (const t of a.tools) {
    const spec = ACTIVITY_TOOLS[t.tool];
    if (!spec) {
      fix(`没有「${t.tool}」这个工具人:只有 ${Object.keys(ACTIVITY_TOOLS).join('、')}`, t.line);
      continue;
    }
    const used = new Set([...t.prompt.matchAll(ACTIVITY_SLOT)].map((m) => m[1]));
    for (const s of used) if (!spec.slots.includes(s)) fix(`交给${t.tool}的那段里有 {{${s}}},${t.tool}只认 ${spec.slots.map((x) => `{{${x}}}`).join(' ')}`, t.promptLine);
    for (const s of spec.slots) if (!used.has(s)) fix(`交给${t.tool}的那段少了 {{${s}}}:没有它${t.tool}就收不到${s}`, t.promptLine);
    if (t.prompt.split('\n').some((r) => GUARD_OPEN.test(r) || GUARD_CLOSE.test(r))) fix(`交给${t.tool}的那段不能用 {{有 …}} 裁段`, t.promptLine);
  }
  return issues;
}

/** 解析 + 检查,按行号排 */
export function lintActivity(text: string, opts: CheckOptions = {}): { activity: Activity; issues: ActivityIssue[] } {
  const { activity, issues } = parseActivity(text);
  const all = [...issues, ...checkActivity(activity, opts)];
  return { activity, issues: all.sort((x, y) => (x.line ?? 0) - (y.line ?? 0)) };
}

/** 填了没有:空字符串、空列表、没给都算没填 */
export function isFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * 递给老师的那节:剥掉给人看的注释,`{{有 名}}` 按「参数填了」留或去。
 * 没有「老师怎么带」返回 null。守卫不配对会抛(checkActivity 先报)。
 */
export function renderTutorSection(a: Activity, opts: { params?: Record<string, unknown> } = {}): string | null {
  if (!a.tutor) return null;
  const params = opts.params ?? {};
  return applyGuards(stripHumanNotes(a.tutor.text), (n) => isFilled(params[n])).trim();
}

/**
 * 首页按钮下面家长填的参数(原文)→ 按 activity 文件的「家长填的」解析成值:按声明的顺序、补缺省、按类型转。
 * 写了没有的参数、要填的没填、类型不对,进 issues(一条一句,给首页检查);值里只留解析得了的。
 */
export function resolveParams(a: Activity, raw: Readonly<Record<string, string>>): { values: Record<string, ActivityValue>; issues: string[] } {
  const values: Record<string, ActivityValue> = {};
  const issues: string[] = [];
  const known = new Set(a.params.map((p) => p.name));
  for (const k of Object.keys(raw)) if (!known.has(k)) issues.push(`「${k}」不是 ${a.name} 的参数(${a.params.length ? `有:${a.params.map((p) => p.name).join('、')}` : '它没有参数'})`);
  for (const p of a.params) {
    const given = raw[p.name]?.trim();
    const text = given || p.default;
    if (!text) {
      if (!p.optional) issues.push(`${a.name} 要填「${p.name}」(${p.type}${p.note ? `:${p.note}` : ''})`);
      continue;
    }
    if (p.type === '词表') {
      const words = text.split(/[\s、,，;；]+/).filter(Boolean);
      if (words.length) values[p.name] = words;
    } else if (p.type === '数') {
      const n = Number(text);
      if (!/^-?\d+$/.test(text)) issues.push(`「${p.name}」要填整数,写的是「${text}」`);
      else if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) issues.push(`「${p.name}」要在 ${p.min} 到 ${p.max} 之间,写的是 ${n}`);
      else values[p.name] = n;
    } else if (p.type === '日期' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) issues.push(`「${p.name}」要写成 2026-10-12 这样,写的是「${text}」`);
    else values[p.name] = text;
  }
  return { values, issues };
}

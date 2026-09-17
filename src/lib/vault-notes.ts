/**
 * vault 里家长写的笔记按 frontmatter 定位(《obsidian仓库设计.md》2026-09-17 拍板):
 * `cotutor: profile | subject | textbook`,不认文件名与目录——家长会改名、挪位置。
 *  - profile:孩子档案,一个 vault 一个;`school_start: YYYY-MM` 算当前学期,`semester` 可覆盖
 *  - subject:一科一学期一个,就是这位老师的**入口文件**,原文整篇进上下文包
 *  - textbook:可以没有、可以多本;只给路径,老师要用自己 Read
 *  - memory:一个 agent 一篇(`agent: <name>`),老师在回复里写「## 记忆」、应用追加;家长可读可改,原文整篇进上下文包
 * 程序读的键用英文(cotutor / subject / semester / school_start / agent),中文键是给人看的描述,这里不读。
 */

export const NOTE_KINDS = ['profile', 'subject', 'textbook', 'memory'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export interface VaultNote {
  /** 相对 vault 根,`/` 分隔 */
  path: string;
  props: Record<string, string>;
  /** 整篇原文(含 frontmatter) */
  text: string;
}

/** 只认平铺的 `key: value`;值去掉成对引号。没有 frontmatter → {} */
export function frontmatter(md: string): Record<string, string> {
  const lines = md.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '---') return out;
    const m = /^([^\s:#][^:]*?)\s*:\s*(.*)$/.exec(l);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return {};
}

const CN_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

/**
 * 某天是几年级的哪个学期 / 假期:9–1 月上学期、2 月寒假、3–6 月下学期、7–8 月暑假(刚读完的那个年级的暑假)。
 * 学年从 9 月算;`school_start` 是读一年级那年的 9 月(写别的月份也按它所在学年算)。年级不在 1–12 → null。
 */
export function semesterAt(schoolStart: string, date: string): string | null {
  const s = /^(\d{4})-(\d{1,2})$/.exec(schoolStart.trim());
  const d = /^(\d{4})-(\d{2})-\d{2}/.exec(date);
  if (!s || !d) return null;
  const sm = Number(s[2]);
  if (sm < 1 || sm > 12) return null;
  const startYear = sm >= 9 ? Number(s[1]) : Number(s[1]) - 1;
  const y = Number(d[1]);
  const m = Number(d[2]);
  const schoolYear = m >= 9 ? y : y - 1;
  const grade = schoolYear - startYear + 1;
  if (grade < 1 || grade >= CN_DIGITS.length) return null;
  const term = m >= 9 || m === 1 ? '上' : m === 2 ? '寒假' : m <= 6 ? '下' : '暑假';
  return `${CN_DIGITS[grade]}年级${term}`;
}

/** 正文里的 `[[目标]]` / `![[目标|别名]]`:去掉 #节 与 |别名,去重,按出现顺序 */
export function wikilinks(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const t = m[1].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 像 Obsidian 那样解析链接:先按相对根的完整路径(可省 .md),再按文件名(同名取路径最短的);找不到 → null */
export function resolveLink(target: string, files: readonly string[]): string | null {
  const t = target.replace(/^\/+/, '');
  const exact = files.find((f) => f === t || f === `${t}.md`);
  if (exact) return exact;
  const base = t.includes('/') ? null : t;
  if (!base) return null;
  const hits = files.filter((f) => {
    const name = f.slice(f.lastIndexOf('/') + 1);
    return name === base || name === `${base}.md`;
  });
  return hits.sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? null;
}

export interface VaultPick {
  profile: VaultNote | null;
  /** 不止一个 `cotutor: profile` 时的其余几个(用写了 school_start / semester 的、再按路径的第一篇,doctor 报) */
  extraProfiles: string[];
  /** 当前学期;档案没有、没写 school_start 也没写 semester、或年级算不出 → null */
  semester: string | null;
  /** 这科这学期的入口文件;没有 → null(不沿用上学期的) */
  entry: VaultNote | null;
  /** 同一科同一学期不止一个入口文件时的其余几个 */
  extraEntries: string[];
  /** 这位 agent 的记忆文件;还没有 → null */
  memory: VaultNote | null;
  extraMemories: string[];
  /** 参考资料的路径:这科这学期的教材 + 档案与入口文件里的 [[链接]](去重,不含它俩自己) */
  refs: string[];
}

const byPath = (a: VaultNote, b: VaultNote): number => a.path.localeCompare(b.path);

/**
 * 从扫出来的笔记里挑一位老师要的:档案、当前学期、入口文件、参考路径。
 * `files` 是 vault 里所有文件的相对路径(解析 [[链接]] 用,不限 .md)。subject 没配 → 没有入口文件。
 */
export function pickNotes(notes: readonly VaultNote[], files: readonly string[], opts: { date: string; subject?: string; agent?: string }): VaultPick {
  const of = (k: NoteKind): VaultNote[] => notes.filter((n) => n.props.cotutor === k).sort(byPath);
  // 不止一篇时先要写了学期信息的那篇
  const dated = (n: VaultNote): number => (n.props.semester?.trim() || n.props.school_start?.trim() ? 0 : 1);
  const profiles = of('profile').sort((a, b) => dated(a) - dated(b));
  const profile = profiles[0] ?? null;
  const semester = profile ? (profile.props.semester?.trim() || (profile.props.school_start ? semesterAt(profile.props.school_start, opts.date) : null)) : null;
  const same = (n: VaultNote): boolean => !!opts.subject && !!semester && n.props.subject?.trim() === opts.subject && n.props.semester?.trim() === semester;
  const entries = of('subject').filter(same);
  const entry = entries[0] ?? null;
  const memories = of('memory').filter((n) => !!opts.agent && n.props.agent?.trim() === opts.agent);
  const refs: string[] = of('textbook').filter(same).map((n) => n.path);
  for (const n of [profile, entry]) {
    if (!n) continue;
    for (const l of wikilinks(n.text)) {
      const p = resolveLink(l, files);
      if (p) refs.push(p);
    }
  }
  const self = new Set([profile?.path, entry?.path]);
  return {
    profile,
    extraProfiles: profiles.slice(1).map((n) => n.path),
    semester,
    entry,
    extraEntries: entries.slice(1).map((n) => n.path),
    memory: memories[0] ?? null,
    extraMemories: memories.slice(1).map((n) => n.path),
    refs: [...new Set(refs)].filter((p) => !self.has(p)),
  };
}

/** 入口文件缺了为什么(进上下文包 entry: 与这条消息的 warnings;家长端就看得到) */
export function missingEntry(subject: string | undefined, pick: { profile: unknown; semester: string | null }): string {
  if (!subject) return '缺:cotutor.json 里这位老师没配 subject';
  if (!pick.profile) return '缺:vault 里没有 cotutor: profile 的档案,算不出学期';
  if (!pick.semester) return '缺:档案没写 school_start(或 semester),算不出学期';
  return `缺:vault 里没有 cotutor: subject、subject: ${subject}、semester: ${pick.semester} 的文件`;
}

/** 记忆文件缺省位置:记忆/<显示名>.md(显示名里的 / 换掉) */
export function memoryPath(display: string): string {
  return `记忆/${display.replace(/[\\/:]/g, '-')}.md`;
}

/** 新建的记忆文件 */
export function memoryTemplate(agent: string, display: string): string {
  return `---
cotutor: memory
agent: ${agent}
---

${display}自己记下的,每个话题开头会整篇读到。你可以随便改、删、分小节;它只往末尾加。

`;
}

/**
 * 往记忆文件末尾追加:每条一行 `- <日期> <原话>`(老师自己写了日期开头就不再加);文里已有同样的话就跳过。
 * 返回新全文与真加上的行;一条都没加 → text 原样。
 */
export function appendMemory(existing: string, items: readonly string[], date: string): { text: string; added: string[] } {
  const has = (s: string): boolean => existing.split('\n').some((l) => l.replace(/^\s*[-*]\s+(\d{4}-\d{2}-\d{2}\s+)?/, '').trim() === s);
  const added: string[] = [];
  for (const raw of items) {
    const s = raw.replace(/\s+/g, ' ').trim();
    const bare = s.replace(/^\d{4}-\d{2}-\d{2}\s+/, '');
    if (!bare || has(bare) || added.some((a) => a.endsWith(` ${bare}`))) continue;
    added.push(`- ${/^\d{4}-\d{2}-\d{2}\s/.test(s) ? s : `${date} ${s}`}`);
  }
  if (!added.length) return { text: existing, added };
  const base = existing.replace(/\s*$/, '');
  return { text: `${base}\n${/^\s*[-*]\s/.test(base.split('\n').at(-1) ?? '') ? '' : '\n'}${added.join('\n')}\n`, added };
}

/** 短 hash(FNV-1a 32 位):同一话题里判断「这篇上次带过、没改」 */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

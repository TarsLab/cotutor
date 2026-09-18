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

${display}自己记下的,每个话题开头会整篇读到。你可以随便改、删、分小节;新的加在末尾,老师也会改、删这里的任何一行(记账后整理一次)。

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

/**
 * 「## 记忆」段的一条(2026-09-18):缺省是新增;`改:原话 → 新的` 改一行;`删:原话` 删一行。
 * 冒号全角半角都认,箭头认 → 与 ->。
 */
export type MemoryOp = { op: 'add'; text: string } | { op: 'change'; from: string; to: string } | { op: 'delete'; from: string };

export function parseMemoryOp(item: string): MemoryOp {
  const s = item.replace(/\s+/g, ' ').trim();
  const del = /^删[::]\s*(.+)$/.exec(s);
  if (del) return { op: 'delete', from: del[1].trim() };
  const chg = /^改[::]\s*(.+?)\s*(?:→|->)\s*(.+)$/.exec(s);
  if (chg) return { op: 'change', from: chg[1].trim(), to: chg[2].trim() };
  return { op: 'add', text: s };
}

/** 一行记忆去掉列表点与日期前缀后的原话(比对用) */
const bareLine = (l: string): string => l.replace(/^\s*[-*]\s+/, '').replace(/^\d{4}-\d{2}-\d{2}\s+/, '').replace(/\s+/g, ' ').trim();

/**
 * 按原话找一行:正文(frontmatter 之后)里原话一字不差的那行;没有就找唯一一行包含它的(原话至少 4 个字);都不是 → -1。
 * 不分老师写的、家长写的(2026-09-18 定:机器一律可以改)。
 */
export function findMemoryLine(lines: readonly string[], from: string, bodyStart: number): number {
  const want = bareLine(from);
  if (!want) return -1;
  const exact = lines.findIndex((l, i) => i >= bodyStart && bareLine(l) === want);
  if (exact >= 0) return exact;
  if (Array.from(want).length < 4) return -1;
  const hits = lines.map((l, i) => (i >= bodyStart && l.trim() && bareLine(l).includes(want) ? i : -1)).filter((i) => i >= 0);
  return hits.length === 1 ? hits[0] : -1;
}

export interface MemoryApplied {
  text: string;
  /** 给家长看的改动,一条一行:新增的原样(`- <日期> …`),改的「改:旧 → 新」,删的「删:旧」 */
  changes: string[];
  /** 找不到原话的改 / 删 */
  misses: string[];
}

/**
 * 把一串操作落到记忆全文上:先改、删(按原话找行,见 findMemoryLine),再把新增的追加到末尾(appendMemory,去重)。
 * 改过的列表行换成 `- <今天> 新的`;不是列表的行整行换成新的。
 */
export function applyMemoryOps(existing: string, ops: readonly MemoryOp[], date: string): MemoryApplied {
  const lines = existing.split('\n');
  const fm = /^\uFEFF?---\s*$/.test(lines[0] ?? '') ? lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l)) : -1;
  const bodyStart = fm > 0 ? fm + 1 : 0;
  const changes: string[] = [];
  const misses: string[] = [];
  const gone = new Set<number>();
  for (const o of ops) {
    if (o.op === 'add') continue;
    const i = findMemoryLine(lines, o.from, bodyStart);
    if (i < 0 || gone.has(i)) {
      misses.push(o.op === 'change' ? `改:${o.from}` : `删:${o.from}`);
      continue;
    }
    const old = bareLine(lines[i]);
    if (o.op === 'delete') {
      gone.add(i);
      changes.push(`删:${old}`);
    } else {
      const bullet = /^(\s*[-*]\s+)/.exec(lines[i]);
      lines[i] = bullet ? `${bullet[1]}${date} ${o.to}` : o.to;
      changes.push(`改:${old} → ${o.to}`);
    }
  }
  const kept = lines.filter((_, i) => !gone.has(i)).join('\n');
  const adds = ops.flatMap((o) => (o.op === 'add' ? [o.text] : []));
  const r = appendMemory(kept, adds, date);
  return { text: r.text, changes: [...changes, ...r.added], misses };
}

/** 记忆文件里有几条(frontmatter 之后的列表行) */
export function memoryCount(text: string): number {
  const body = text.replace(/^\uFEFF?---\s*\n[\s\S]*?\n---\s*(\n|$)/, '');
  return body.split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).length;
}

/**
 * 记账后整理记忆那轮的消息正文(2026-09-18):新会话、from: system;记忆原文在上下文包的 <vault-note role="memory">。
 * 回的「## 记忆」段不受每轮条数上限,应用照单落盘、不问家长(家长在 Obsidian 里兜底)。
 */
export function tidyMemoryPrompt(opts: { date: string; count: number; cap: number; diaryFile: string }): string {
  return [
    `学习结束、账记完了,把你的记忆整理一遍。记忆文件的原文在上下文包的 <vault-note role="memory">(现在 ${opts.count} 条;截了就自己 Read 全文),今天(${opts.date})的日记在 ${opts.diaryFile},读你这一科的几段对照一下。`,
    '',
    '只回一段「## 记忆」,一行一条,别的一个字都不用写:',
    '',
    '## 记忆',
    '- 删:原话(过时的、今天看出来不对的、和别的重复的)',
    '- 改:原话 → 新的(要更新的,比如「还没学竖式 → 9 月中学会了两位数竖式」;几条说一件事就改成一条、删掉其余)',
    '- 新的一条(今天日记里看出来、以后还用得上、记忆里还没有的)',
    '',
    `原话照记忆文件里那一行抄,日期可以不抄;谁写的行都可以改、删。整理完不超过 ${opts.cap} 条。都不用动就只回一句「记忆不用整理」,不写「## 记忆」段。`,
  ].join('\n');
}

/**
 * 按 entryChars 截一篇笔记带进上下文包。档案、入口文件留开头(家长写在前面的最要紧);
 * 记忆留末尾——应用往末尾追加,最新的在后面,截开头丢的是旧的(2026-09-18 之前留的是开头,越记越看不到新的)。
 * 末尾那头从一行的开头起,不截半行。
 */
export function clipNote(text: string, limit: number, keep: 'head' | 'tail'): { text: string; cut: boolean } {
  if (text.length <= limit) return { text, cut: false };
  if (keep === 'head') return { text: `${text.slice(0, limit)}\n……(后面截掉了,要看全文自己 Read)`, cut: true };
  const tail = text.slice(-limit);
  const nl = tail.indexOf('\n');
  const aligned = text.at(-limit - 1) === '\n' || nl < 0 ? tail : tail.slice(nl + 1);
  return { text: `……(前面旧的截掉了,下面是最近的;要看全文自己 Read)\n${aligned}`, cut: true };
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

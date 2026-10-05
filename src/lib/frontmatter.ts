/**
 * md 文件头的 frontmatter 与检查出的问题(素材 material.md、小课堂 lecture.md 共用):只认 key: value,永不抛;问题带行号(1 起)。
 */
export type DocIssueLevel = 'fix' | 'note';
export interface DocIssue {
  level: DocIssueLevel;
  text: string;
  /** 原文行号,1 起 */
  line?: number;
  /** 出在第几节、第几张卡(0 起;家长端把它钉在那张卡下面);没有就是整份文件的 */
  section?: number;
  card?: number;
}

export interface Frontmatter {
  keys: Record<string, { value: string; line: number }>;
  /** 正文从第几行起(0 起) */
  start: number;
  issues: DocIssue[];
}

export function readFrontmatter(all: readonly string[]): Frontmatter {
  const out: Frontmatter = { keys: {}, start: 0, issues: [] };
  if (!/^---\s*$/.test(all[0] ?? '')) return out;
  const close = all.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
  if (close < 0) {
    out.issues.push({ level: 'fix', line: 1, text: 'frontmatter 没闭合:key: value 那几行之后单独一行写 ---' });
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

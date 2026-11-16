/**
 * Markdown 文件头上的平铺 frontmatter(`---` 包着、一行一个 `key: value`):activity 文件、技能的 SKILL.md 都这么写。
 * 只认平铺的键值,值两头的引号去掉;没有 frontmatter 就是全文当正文。
 */
export interface Frontmatter {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseFrontmatter(text: string): Frontmatter {
  const open = /^---[^\S\n]*\n/.exec(text);
  if (!open) return { frontmatter: {}, body: text.trim() };
  const rest = text.slice(open[0].length);
  const end = /\n---[^\S\n]*(\n|$)/.exec(rest);
  if (!end) return { frontmatter: {}, body: text.trim() };
  const frontmatter: Record<string, string> = {};
  for (const raw of rest.slice(0, end.index).split('\n')) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(raw);
    if (m) frontmatter[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { frontmatter, body: rest.slice(end.index + end[0].length).trim() };
}

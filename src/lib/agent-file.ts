/**
 * 老师定义文件(.claude/agents/<name>.md 同一份链到 .qwen/agents/):YAML frontmatter + 正文即系统提示。
 * 这里只认平铺的 `key: value` frontmatter(两个 CLI 的公共子集:name / description / maxTurns / permissionMode / memory);
 * 正文给没有 --agent 的 CLI 经 {agentBody} 塞进 --append-system-prompt。
 */
export interface AgentFile {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseAgentFile(text: string): AgentFile {
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

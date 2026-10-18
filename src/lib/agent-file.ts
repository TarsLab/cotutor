/**
 * 老师文件(.claude/agents/<name>.md):YAML frontmatter + 正文即系统提示。
 * 这里只认平铺的 `key: value` frontmatter(两个 CLI 的公共子集:name / description / maxTurns / permissionMode / memory);
 * 正文给没有 --agent 的 CLI 经 {agentBody} 塞进 --append-system-prompt。
 */
/** 两个 CLI 的公共子集:老师文件 frontmatter 只写这几个键(人设 / 政策 / 开关在 cotutor.json);技能 cotutor-tune 的字段表从这里取 */
export const AGENT_FRONTMATTER_KEYS = ['name', 'description', 'maxTurns', 'permissionMode', 'memory'] as const;

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

export interface AgentFileIssue {
  /** fix = 要改(这位老师起不来);note = 提醒 */
  level: 'fix' | 'note';
  text: string;
  /** 原文行号,1 起 */
  line?: number;
}

/** 写在 cotutor.json 里的东西(人设、声音、开关、政策),老师文件 frontmatter 里写了不生效 */
const CONFIG_KEYS = ['display', 'avatar', 'voice', 'enabled', 'hidden', 'policy', 'runtime', 'subject', 'color', 'cards'];

/**
 * 老师文件的检查(工作台边改边查):frontmatter 要在、name 要是老师键(claude 的 --agent 靠它找,不对这位老师就起不来);
 * 正文不能空(正文就是系统提示);两家 CLI 公共子集外的键提醒一句。和 parseAgentFile 同一套认法
 */
export function lintAgentFile(text: string, name: string): AgentFileIssue[] {
  const lines = text.split('\n');
  const out: AgentFileIssue[] = [];
  const open = /^---[^\S\n]*$/.test(lines[0] ?? '');
  const end = open ? lines.findIndex((l, i) => i > 0 && /^---[^\S\n]*$/.test(l)) : -1;
  if (end < 0) {
    out.push({ level: 'fix', line: 1, text: `开头要有两行 --- 包着的 frontmatter,里面至少写 name: ${name}` });
    return out;
  }
  let nameLine = 0;
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[1] === 'name') nameLine = i + 1;
    else if (CONFIG_KEYS.includes(m[1])) out.push({ level: 'note', line: i + 1, text: `${m[1]} 在 cotutor.json 里设(老师团页),写在这里不生效` });
    else if (!(AGENT_FRONTMATTER_KEYS as readonly string[]).includes(m[1])) out.push({ level: 'note', line: i + 1, text: `${m[1]} 不是两家 CLI 都认的键(只写 ${AGENT_FRONTMATTER_KEYS.join(' / ')})` });
  }
  const fm = parseAgentFile(text).frontmatter;
  if (!nameLine) out.push({ level: 'fix', line: 1, text: `frontmatter 里要有 name: ${name}(老师键靠它对上)` });
  else if (fm.name !== name) out.push({ level: 'fix', line: nameLine, text: `name 要是 ${name}(现在是「${fm.name ?? ''}」),不然这位老师起不来` });
  if (!parseAgentFile(text).body) out.push({ level: 'fix', line: Math.min(end + 2, lines.length), text: '正文是空的:正文就是老师的系统提示' });
  return out;
}

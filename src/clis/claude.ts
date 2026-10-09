/**
 * Claude Code(`claude`)的适配器。输出是 stream-json 的本家(stream-json.ts);工具白名单走 `--tools {tools}`,
 * 思考量走 `--effort {effort}`,代理靠 cotutor.json 的 proxy 注进环境(《agent层设计.md》拍板 15 之前就这样,搬过来行为不变)。
 */
import type { Runtime } from '../schema/index.ts';
import { parseStreamJson, streamJsonUserMessage } from './stream-json.ts';
import type { CliAdapter, ToolKind } from './types.ts';

/** 老师带工具时的白名单(`--tools`):Bash 查教材、裁作业照片;Read / Grep / Glob 读 vault 与技能文件 */
export const CLAUDE_TUTOR_TOOLS = 'Bash,Read,Grep,Glob';

const KINDS: Record<string, ToolKind> = { Read: 'read', Bash: 'shell', Grep: 'search', Glob: 'search', Edit: 'edit', Write: 'edit', NotebookEdit: 'edit', MultiEdit: 'edit', Skill: 'skill' };

export const claude: CliAdapter = {
  name: 'claude',
  parse: parseStreamJson,
  stdinMessage: streamJsonUserMessage,
  toolList: (set) => (set === 'on' ? CLAUDE_TUTOR_TOOLS : ''),
  toolArgs: (set) => ['--tools', set === 'on' ? CLAUDE_TUTOR_TOOLS : ''],
  toolKind: (name) => KINDS[name] ?? 'other',
  // 模板带 --setting-sources project,~/.claude/settings.json 的代理进不来:cotutor.json 设了 proxy 就注 HTTP(S)_PROXY(大小写都给)
  env: (env, ctx) => (typeof ctx.proxy === 'string' ? { ...env, HTTP_PROXY: ctx.proxy, HTTPS_PROXY: ctx.proxy, http_proxy: ctx.proxy, https_proxy: ctx.proxy } : env),
  // 在 Claude Code 会话里跑 cotutor replay(技能 cotutor-analyze 就是这么用的):claude 见到 CLAUDECODE 会当嵌套拒掉
  nestedEnv: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_PID', 'CLAUDE_EFFORT'],
  runtimes: (): Record<string, Runtime> => ({
    // --setting-sources project(2026-09-15):老师只读 workspace 的 .claude/,~/.claude 的技能(obsidian-cli 之类)/ hooks / additionalDirectories / 插件都不进老师会话;
    // 代价是 ~/.claude/settings.json 的 env(代理)也不进,serve 要从有代理的 shell 起,doctor env.userSettings 点名
    // 普通老师的工具是白名单(--tools,2026-09-20;之前是 --disallowedTools Agent 黑名单):只有查教材、读文件、裁作业照片用得上的那几个。
    // 不在名单里的连工具定义都不发(黑名单只禁调用、定义照发)。由来:claude 会把 .claude/agents/ 里的老师文件当可派的子代理,老师自己去派别的老师就把预算烧在自己这轮里;
    // CLI 升版本还会带进新工具——2.1.275 真跑里老师去调了 Artifact、ToolSearch,每次白花一个来回。Skill 也不给:板书写法与守则由应用递,别的技能按路径 Read
    // --strict-mcp-config(2026-10-04):--setting-sources 管不到账号上的 claude.ai 连接器,真跑里每位老师的会话都带着 8 个 Claude Docs 的 MCP 工具(--tools "" 也去不掉);
    // 加了它、又不给 --mcp-config,就一个 MCP 都不进
    // --tools {tools}(2026-10-04):孩子说的话缺省不带工具({tools} 填成空,工具定义都不发),带照片的、记账的填整份白名单;政策 tools: on 的老师总是带
    // --effort {effort}:老师政策里的 effort(缺省 low),见 schema 的 PolicySchema.effort
    // 板书写法由应用递给老师,递法看模板(《agent层设计.md》拍板 11):{boardFile} = 板书技能 SKILL.md 的绝对路径,claude 用 --append-system-prompt-file 追加进系统提示
    // (落在「工具 → 系统」这段缓存前缀里,同一位老师的各话题共享);{systemBody} = 老师正文 + 板书写法,给只收一段系统提示文字的 CLI;
    // 两个都没用的运行时(以后的 codex 之类),应用在话题第一条注入 <cotutor-board>。frontmatter 的 skills: 对 --agent 主线程不生效(claude 2.1.275 实测)
    claude: {
      run: ['claude', '--agent', '{agent}', '-p', '{prompt}', '--dangerously-skip-permissions', '--setting-sources', 'project', '--strict-mcp-config', '--tools', '{tools}', '--effort', '{effort}', '--append-system-prompt-file', '{boardFile}', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--max-budget-usd', '2'],
      resume: ['claude', '--agent', '{agent}', '-p', '--resume', '{session}', '{prompt}', '--dangerously-skip-permissions', '--setting-sources', 'project', '--strict-mcp-config', '--tools', '{tools}', '--effort', '{effort}', '--append-system-prompt-file', '{boardFile}', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--max-budget-usd', '2'],
    },
  }),
};

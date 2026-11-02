/**
 * 脑的统一事件与工具:API 脑(./api.ts)写进 .log、孩子端的流式板书、家长端看原文、转录都只认这些。
 * 名字里的 Cli 是 2026-11-02 以前起 Qwen Code 时留下的;那时的 .log 是 stream-json,由 ./stream-json.ts 读成同样的事件。
 */

/** 工具的类别:应用要知道「读了哪个文件」「是不是用技能回读板书写法」时按类别认,不比工具名 */
export type ToolKind = 'read' | 'shell' | 'search' | 'edit' | 'skill' | 'other';

/** 工具名 → 类别:API 脑的三样(./api-tools.ts)与旧轮次里 Qwen Code、Claude Code 的工具名;不认识的是 other */
const TOOL_KINDS: Record<string, ToolKind> = {
  read_file: 'read', read_many_files: 'read', zoom_image: 'read', list_directory: 'read', glob: 'search', grep_search: 'search',
  run_shell_command: 'shell', edit: 'edit', write_file: 'edit', notebook_edit: 'edit', skill: 'skill',
  Read: 'read', Bash: 'shell', Grep: 'search', Glob: 'search', Edit: 'edit', Write: 'edit', NotebookEdit: 'edit', MultiEdit: 'edit', Skill: 'skill',
};
export const toolKind = (name: string): ToolKind => TOOL_KINDS[name] ?? 'other';

/**
 * 这轮带不带工具(政策 tools 与消息种类定):off 一个不带;read 只读(看照片、读 vault、查教材);
 * on 与 read 一样只读,不提供 shell 与写入工具
 */
export type ToolSet = 'off' | 'read' | 'on';

export interface ToolUse {
  /** 和工具结果配对用;有的 CLI 可能不给 */
  id?: string;
  name: string;
  input?: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  ok: boolean;
  /** 结果的文字(图片等非文字块不算) */
  text: string;
}

/** 一条整的回复里的一段:正文或一次工具调用 */
export type AssistantPart = { type: 'text'; text: string } | { type: 'tool'; tool: ToolUse };

/** 一条回复的正文段 / 工具调用 */
export const textsOf = (parts: readonly AssistantPart[]): string[] => parts.flatMap((p) => (p.type === 'text' ? [p.text] : []));
export const toolsOf = (parts: readonly AssistantPart[]): ToolUse[] => parts.flatMap((p) => (p.type === 'tool' ? [p.tool] : []));

/** 一次模型请求的 token:in 含缓存读、缓存写,cached 是其中命中缓存的;id 是那条回复的消息 id */
export interface RequestUsage {
  id: string;
  in: number;
  out: number;
  cached: number;
}

/** 一轮的收尾 */
export interface CliFinal {
  ok: boolean;
  /** 最终正文(孩子视图只看它);没有就是 null */
  text: string | null;
  /** 不 ok 时的原因 */
  reason: string | null;
  numTurns?: number;
  /** 这一轮的 token:输入(含缓存读、缓存写)与输出;记账按它(报的钱数不认,src/shared/tokens.ts)。
   *  CLI 收尾报的可能是整个会话的累计(qwen 续会话时就是),parseTranscript 有每次请求的 usage 就按它们加总 */
  inTokens?: number;
  outTokens?: number;
  /** 输入里命中缓存的那部分(API 运行时报;CLI 有每次请求的 usage 时也有) */
  cachedTokens?: number;
  /** 这一轮最后一次请求的输入 = 这一轮结束时上下文多大(API 运行时报;过 32k 整段压缩看它) */
  contextTokens?: number;
}

/**
 * 统一事件:一行输出读出零到几条。sub = 来自子代理(老师不派子代理,有也不算老师的话)。
 * - session:这行带着会话 id(取第一次见到的)
 * - init:进程起来报的工具表(用来核对「不带工具」真的一个没有)
 * - start:开始新的一条回复(增量模式)
 * - delta:回复正文的一小段(增量模式)
 * - thinking:模型在想(增量模式,只说明模型开始回了)
 * - assistant:一条整的回复:正文段与工具调用,按原来的先后;usage = 这一次请求自己的 token(消息 id 去重用,同一条回复可能分几行出)
 * - results:工具结果
 * - result:一轮收尾
 */
export type CliEvent =
  | { kind: 'session'; id: string }
  | { kind: 'init'; tools: string[] }
  | { kind: 'start'; sub: boolean }
  | { kind: 'delta'; text: string; sub: boolean }
  | { kind: 'thinking'; sub: boolean }
  | { kind: 'assistant'; parts: AssistantPart[]; sub: boolean; usage?: RequestUsage }
  | { kind: 'results'; results: ToolResult[]; sub: boolean }
  | { kind: 'result'; final: CliFinal };

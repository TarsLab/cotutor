/**
 * CLI 适配器(《agent层设计.md》§6、拍板 15):一个 agent CLI 一个文件,写「这个 CLI 怎么说话」——
 * 输出流怎么读、消息怎么写进 stdin、工具叫什么怎么关、思考量怎么调、起进程要什么环境、出厂模板长什么样。
 * 选哪个模型、预算、时限还在 cotutor.json 的运行时模板里(数据);应用的其余部分只认这里的统一事件,不认哪家的 JSON。
 * 接一个新 CLI:照 claude.ts / qwen.ts 写一个文件,在 index.ts 的 ADAPTERS 里登记(《接一个 CLI.md》)。
 */
import type { Policy, Runtime } from '../schema/index.ts';

/** 工具的类别:应用要知道「读了哪个文件」「是不是用技能回读板书写法」时按类别认,不比工具名 */
export type ToolKind = 'read' | 'shell' | 'search' | 'edit' | 'skill' | 'other';

/** 这轮带不带工具(政策 tools 与消息种类定,《工作流程.md》拍板 12):off 一个不带;on 带老师干活用的那几样 */
export type ToolSet = 'off' | 'on';

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

/** 一轮的收尾 */
export interface CliFinal {
  ok: boolean;
  /** 最终正文(孩子视图只看它);没有就是 null */
  text: string | null;
  /** 不 ok 时的原因 */
  reason: string | null;
  /** 花了多少美元;有的 CLI 不报。新版 claude 接着会话跑时是整个会话的累计 */
  costUsd?: number;
  numTurns?: number;
  /** 各模型的输出 token 之和(累计时也累计)与最后一次请求的输出 token:判断 costUsd 是不是累计(claude) */
  modelOut?: number;
  lastOut?: number;
  /** 这一轮的 token(没有钱数的 CLI 靠它记账) */
  inTokens?: number;
  outTokens?: number;
}

/**
 * 统一事件:一行输出读出零到几条。sub = 来自子代理(老师不派子代理,有也不算老师的话)。
 * - session:这行带着会话 id(取第一次见到的)
 * - init:进程起来报的工具表(用来核对「不带工具」真的一个没有)
 * - start:开始新的一条回复(增量模式)
 * - delta:回复正文的一小段(增量模式)
 * - thinking:模型在想(增量模式,只说明模型开始回了)
 * - assistant:一条整的回复:正文段与工具调用,按原来的先后
 * - results:工具结果
 * - result:一轮收尾
 */
export type CliEvent =
  | { kind: 'session'; id: string }
  | { kind: 'init'; tools: string[] }
  | { kind: 'start'; sub: boolean }
  | { kind: 'delta'; text: string; sub: boolean }
  | { kind: 'thinking'; sub: boolean }
  | { kind: 'assistant'; parts: AssistantPart[]; sub: boolean }
  | { kind: 'results'; results: ToolResult[]; sub: boolean }
  | { kind: 'result'; final: CliFinal };

/** 起进程时环境的来源(适配器按需取用) */
export interface EnvContext {
  /** cotutor.json 的 proxy */
  proxy?: string | false;
}

/** 运行时模板里与适配器有关的占位能拿到的值 */
export interface PlanContext {
  /** workspace 根(适配器的私有文件放在它的 .cotutor/ 下);测试与不关心的调用可以不给 */
  root?: string;
  effort: Policy['effort'];
}

export interface CliAdapter {
  /** 适配器名:运行时的 cli 字段,或 run[0] 的文件名 */
  name: string;
  /** 一行原始输出 → 统一事件;读不懂的行返回 [] */
  parse(line: string): CliEvent[];
  /** stdin 模式(运行时 stdin: "stream-json")下写进 stdin 的那一行用户消息,带换行 */
  stdinMessage(prompt: string): string;
  /** 模板里 `{tools}` 填什么(一个参数里的文字) */
  toolList(set: ToolSet): string;
  /** 模板里独占一个参数的 `{toolArgs}` 展开成哪几个参数(可以是零个) */
  toolArgs(set: ToolSet): string[];
  toolKind(name: string): ToolKind;
  /** 由这轮的计划定下来的环境变量(进预热的比对:变了的备用进程不能用);没有就不写 */
  planEnv?(ctx: PlanContext): Record<string, string>;
  /** 起进程前最后过一遍环境(代理之类);不改就原样返回 */
  env(env: NodeJS.ProcessEnv, ctx: EnvContext): NodeJS.ProcessEnv;
  /** 在别的 agent 会话里起这个 CLI 会被当嵌套拒掉的那几个环境变量(cotutor replay 起老师前去掉) */
  nestedEnv?: readonly string[];
  /** 出厂运行时模板:键是运行时名 */
  runtimes(): Record<string, Runtime>;
}

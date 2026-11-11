/**
 * 脑执行:一轮教学里「让脑想、写出正文」的那一步。
 * runner 拼好上下文包与系统提示交到这里;这里请模型(应用直连百炼,./api.ts)、读输出,随流回报正文与工具,收尾给出整轮的转录。
 * 执行完不等于这一轮交付完:板书解析、配音、记忆与日记的收尾归 runner。
 * 2026-11-02 以前还能起 Qwen Code(命令行);那时的轮次照样读得出(./log.ts),运行时用不了了(./runtime.ts)。
 */
import type { ToolCall, Transcript } from './transcript.ts';
import type { CotutorConfig, Policy } from '../schema/index.ts';
import type { ToolSet } from './types.ts';
import type { RunPlan } from './runtime.ts';
import { ApiBrain, type BrainLine } from './api.ts';

export type { ToolKind, ToolSet } from './types.ts';
export { toolKind } from './types.ts';
export { parseLogLine } from './log.ts';
export { RuntimeError, getRuntime, runtimeIssue, type RunPlan } from './runtime.ts';
export { FACTORY_API_RUNTIMES } from './api.ts';

/** 一轮要脑做的:哪个运行时、接哪个会话、系统提示、这条消息(上下文包 + 孩子的话)、思考量、工具 */
export interface BrainRequest {
  /** 运行时名,缺省 cotutor.json 的 runtimes.default */
  runtime?: string;
  /** 接着的会话;null = 新开 */
  session: { id: string; runtime: string } | null;
  agent: string;
  prompt: string;
  /** 系统提示:老师正文(或 activity)+ 板书写法 */
  systemBody?: string;
  effort?: Policy['effort'];
  tools: ToolSet;
  /** 只读工具读得到的目录(workspace 根、vault) */
  readDirs: readonly string[];
  /** 本轮附的照片(绝对路径),直接附成图 */
  images?: readonly string[];
  /** 孩子这一轮交的板(数学卡的图,绝对路径):只附在这一轮,不算作业照片——不把前面交的作业照片挤掉 */
  boards?: readonly string[];
  /** 整段压缩(上一轮结束时上下文过了 32k):之前的模型历史不再发,digest 是应用照索引拼的前情;prompt 这一轮带笔记全文 */
  compact?: { digest: string };
}

export interface BrainHooks {
  onStart(s: { cli: string; runtime: string; resume: boolean }): void;
  /** 当前回复的正文变了(读 BrainRun.text()) */
  onText(): void;
  onTool(t: { name: string; sub: boolean }): void;
  /** 模型回完了,还没读日志收尾;at = Date.now() */
  onExit(at: number): void;
}

export interface BrainRun {
  /** 当前这条回复的正文 */
  text(): string;
  done: Promise<BrainResult>;
}

export interface BrainResult {
  /** final 总有:没收尾的记成没成 */
  transcript: Transcript & { final: NonNullable<Transcript['final']> };
  /** 这轮用了哪些工具、读了什么(最多 200 条) */
  tools: ToolCall[];
  /** 给家长端这一轮的提醒,按出现顺序 */
  warnings: string[];
}

/** 这一轮落在哪:统一事件、stderr、这个话题的模型历史 */
export interface BrainFiles {
  log: string;
  err: string;
  history: string;
}

export interface BrainExecutor {
  /** 定这一轮怎么跑:哪个运行时、接不接着会话(run 文件照记) */
  plan(req: BrainRequest): RunPlan;
  /** 跑一轮。files:统一事件与 stderr 落哪;stall:断流看门狗 */
  start(req: BrainRequest, plan: RunPlan, ctx: { tutor: string; files: BrainFiles; stall: Policy['stall'] }, hooks: BrainHooks): BrainRun;
}

/**
 * line:这个模型发到哪、带哪把 key(runner 给 compatibleLine);endpoint:测试与探针指到假百炼(…/compatible-mode/v1)
 */
export function createBrain(opts: { workspace: () => { config: CotutorConfig; root: string }; line?: BrainLine; endpoint?: string }): BrainExecutor {
  return new ApiBrain({ workspace: opts.workspace, line: opts.line ?? (() => null), endpoint: opts.endpoint });
}

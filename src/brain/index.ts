/**
 * 脑执行:一轮教学里「让脑想、写出正文」的那一步。
 * runner 拼好上下文包与系统提示交到这里;这里起老师(或接预热好的)、读输出、断流接着跑,随流回报正文与工具,收尾给出整轮的转录。
 * 执行完不等于这一轮交付完:板书解析、配音、记忆与日记的收尾归 runner。
 * 两种实现,按 cotutor.json 里这轮的运行时分:{run, resume} 起 CLI(./cli.ts,各家方言在 src/clis/);{api, model} 应用直连模型(./api.ts)。
 */
import { controlsTools as cliControlsTools, parserForRuntime, type CliEvent } from '../clis/index.ts';
import { getRuntime, type RunPlan } from '../lib/run-plan.ts';
import type { ToolCall, Transcript } from '../lib/transcript.ts';
import { isApiRuntime, type CotutorConfig, type Policy, type Runtime } from '../schema/index.ts';
import type { ToolSet } from '../clis/index.ts';
import type { Slot } from './warm.ts';
import { API_CLI, ApiBrain, parseEventLine } from './api.ts';
import { CliBrain } from './cli.ts';

export type { ToolSet } from '../clis/index.ts';
export type { Slot } from './warm.ts';

/** 一轮要脑做的:哪个运行时、接哪个会话、系统提示的几样、这条消息(上下文包 + 孩子的话)、思考量、工具 */
export interface BrainRequest {
  /** 运行时名,缺省 cotutor.json 的 runtimes.default */
  runtime?: string;
  /** 接着的会话;null = 新开 */
  session: { id: string; runtime: string } | null;
  agent: string;
  prompt: string;
  agentBody?: string;
  systemBody?: string;
  boardFile?: string;
  effort?: Policy['effort'];
  tools: ToolSet;
  /** 老师该读得到、在会话 cwd 外面的目录 */
  readDirs: readonly string[];
  /** 本轮附的照片(绝对路径):API 直接附成图;CLI 不用它,老师按上下文包里的路径自己读 */
  images?: readonly string[];
  /** 整段压缩(API 运行时;上一轮结束时上下文过了 32k):之前的模型历史不再发,digest 是应用照索引拼的前情;prompt 这一轮带笔记全文。CLI 不用它 */
  compact?: { digest: string };
}

/** 接预热好的进程要对得上的:老师目录(进程 cwd)、日期、这个话题末条 job(新开记 null) */
export interface WarmKey {
  cwd: string;
  date: string;
  lastJob: string | null;
}

export interface BrainHooks {
  /** 起了一次(第一次、断流接着跑、工具调用写成正文后接着跑);warmBornAt = 接过来的预热进程起来的时刻 */
  onStart(s: { cli: string; runtime: string; resume: boolean; warmBornAt?: number }): void;
  /** 当前回复的正文变了(读 BrainRun.text()) */
  onText(): void;
  onTool(t: { name: string; sub: boolean }): void;
  onStall(s: { idleMs: number; retry: number; kept: number }): void;
  /** 进程都退了,还没读日志收尾;at = Date.now() */
  onExit(at: number): void;
}

export interface BrainRun {
  /** 接的是预热好的进程 */
  warm: boolean;
  /** 当前这条回复的正文(断流接着跑的,含被杀那次已经写出的) */
  text(): string;
  done: Promise<BrainResult>;
}

export interface BrainResult {
  /** final 总有:进程退了没有收尾的,记成没成(原因指向 err.log) */
  transcript: Transcript & { final: NonNullable<Transcript['final']> };
  /** 这轮用了哪些工具、读了什么(最多 200 条) */
  tools: ToolCall[];
  /** 给家长端这一轮的提醒,按出现顺序 */
  warnings: string[];
}

/** 这一轮落在哪:原始输出(CLI 的 stream-json / API 的统一事件)、stderr、这个话题的模型历史(API 用;CLI 的历史在它自己的会话里) */
export interface BrainFiles {
  log: string;
  err: string;
  history: string;
}

export interface BrainExecutor {
  /** 定这一轮怎么跑。现在就是 CLI 的命令规划(run 文件照记命令行);API 脑进来时再分出共同的 runtime / resume / session 与各家私有的 */
  plan(req: BrainRequest): RunPlan;
  /** 这一轮在 workspace 里要的机器文件(qwen 的隔离家目录);备不好照起,原因进 err.log */
  prepare(plan: RunPlan): Promise<void>;
  /**
   * 跑一轮。同步返回:接预热进程在调用的这一拍里(调用方查完 busy 到这里之间不能有 await)。
   * files:原始输出与 stderr 落哪;stall:断流看门狗
   */
  start(req: BrainRequest, plan: RunPlan, ctx: { tutor: string; key: WarmKey; files: BrainFiles; stall: Policy['stall'] }, hooks: BrainHooks): BrainRun;
  /** 这个运行时能不能预热(消息走 stdin 的才行) */
  canWarm(runtime: Runtime): boolean;
  /** 给下一轮起好进程;这个位置已有对得上的就不动 */
  warm(tutor: string, slot: Slot, plan: RunPlan, key: WarmKey): void;
  warmed(tutor: string, slot?: Slot): boolean;
  dropWarm(tutor: string, slot?: Slot): void;
  /** 杀掉所有预热的进程(测试收尾;服务退出时它们的 stdin 断了会自己退) */
  close(): void;
}

/**
 * auth:百炼按量 key,知道的话带业务空间 id(API 运行时用;runner 给的是和实时那边同一条查找链);endpoint:测试与探针指到假百炼(…/compatible-mode/v1)
 */
export function createBrain(opts: { workspace: () => { config: CotutorConfig; root: string }; env?: NodeJS.ProcessEnv; warmIdleMs?: number; auth?: () => { key: string; workspaceId: string | null } | null; endpoint?: string }): BrainExecutor {
  return new Brains(opts.workspace, new CliBrain(opts), new ApiBrain({ workspace: opts.workspace, auth: opts.auth ?? (() => null), endpoint: opts.endpoint }));
}

/** 按这轮的运行时分给 CLI 或 API;预热只有 CLI 有 */
class Brains implements BrainExecutor {
  private readonly workspace: () => { config: CotutorConfig };
  private readonly cli: CliBrain;
  private readonly api: ApiBrain;
  constructor(workspace: () => { config: CotutorConfig }, cli: CliBrain, api: ApiBrain) {
    this.workspace = workspace;
    this.cli = cli;
    this.api = api;
  }

  plan(req: BrainRequest): RunPlan {
    return isApiRuntime(getRuntime(this.workspace().config, req.runtime).runtime) ? this.api.plan(req) : this.cli.plan(req);
  }

  prepare(plan: RunPlan): Promise<void> {
    return plan.cli === API_CLI ? Promise.resolve() : this.cli.prepare(plan);
  }

  start(req: BrainRequest, plan: RunPlan, ctx: Parameters<BrainExecutor['start']>[2], hooks: BrainHooks): BrainRun {
    return plan.cli === API_CLI ? this.api.start(req, plan, ctx, hooks) : this.cli.start(req, plan, ctx, hooks);
  }

  canWarm(runtime: Runtime): boolean {
    return !isApiRuntime(runtime) && this.cli.canWarm(runtime);
  }

  warm(tutor: string, slot: Slot, plan: RunPlan, key: WarmKey): void {
    if (plan.cli !== API_CLI) this.cli.warm(tutor, slot, plan, key);
  }

  warmed(tutor: string, slot?: Slot): boolean {
    return this.cli.warmed(tutor, slot);
  }

  dropWarm(tutor: string, slot?: Slot): void {
    this.cli.dropWarm(tutor, slot);
  }

  close(): void {
    this.cli.close();
  }
}

/** 这个运行时关得住工具吗:关得住的,孩子那轮不带工具时,只有工具才用得上的路径(refs、vault)不进上下文包 */
export function controlsTools(runtime: Runtime): boolean {
  return isApiRuntime(runtime) || cliControlsTools(runtime);
}

/**
 * 读一轮的 .log:API 的轮次是一行一条统一事件,CLI 的按运行时的适配器读(运行时后来删了或改了按 stream-json)。
 * 两种行长得不一样(统一事件以 {"kind": 开头),一行一行认,运行时从 CLI 换成 API 以后,以前的轮次照样读得出
 */
export function logParser(runtimes: Readonly<Record<string, unknown>>, name: string | undefined): (line: string) => CliEvent[] {
  const cli = parserForRuntime(runtimes, name);
  return (line) => {
    const e = parseEventLine(line);
    return e.length ? e : cli(line);
  };
}

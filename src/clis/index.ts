/**
 * 适配器注册表(《agent层设计.md》§6):运行时写了 `cli` 就按它找,没写按 run[0] 的文件名。
 * 都对不上(测试的假 CLI 是 `node …_fake-cli.ts`、自家套的壳脚本没写 cli)就按通用的 stream-json 读,
 * 行为同 claude 但不注代理——和适配器出来之前一样。
 */
import { basename } from 'node:path';
import { POLICY_DEFAULTS, fillRuntime, type Policy, type Runtime } from '../schema/index.ts';
import { claude } from './claude.ts';
import { qwen } from './qwen.ts';
import type { CliAdapter, CliEvent, ToolKind, ToolSet } from './types.ts';

export { textsOf, toolsOf, type AssistantPart, type CliAdapter, type CliEvent, type CliFinal, type ToolKind, type ToolResult, type ToolSet, type ToolUse } from './types.ts';

/** 登记在这里的才认;接一个新 CLI 加一行 */
export const ADAPTERS: readonly CliAdapter[] = [claude, qwen];

/** 认不出的 CLI:读 stream-json,工具名与旗标照 claude,不动环境 */
export const STREAM_JSON: CliAdapter = { ...claude, name: 'stream-json', env: (env) => env, nestedEnv: [], runtimes: () => ({}) };

/** 运行时的 CLI 名:cli 字段,或 run[0] 的文件名 */
export function runtimeCli(runtime: { run: readonly string[]; cli?: string }): string {
  return runtime.cli ?? basename(runtime.run[0] ?? '');
}

export function adapterNamed(name: string): CliAdapter | null {
  return ADAPTERS.find((a) => a.name === name) ?? null;
}

export function adapterFor(runtime: { run: readonly string[]; cli?: string }): CliAdapter {
  return adapterNamed(runtimeCli(runtime)) ?? STREAM_JSON;
}

/** 工具名属于哪一类:问遍登记的适配器(各家工具名不重),都不认就是 other。老数据只存了名字,也能认 */
export function toolKind(name: string): ToolKind {
  for (const a of ADAPTERS) {
    const k = a.toolKind(name);
    if (k !== 'other') return k;
  }
  return 'other';
}

/** 模板管得了这轮带不带工具吗:用了 `{tools}` 或 `{toolArgs}`。管不了的,应用也就不替它省掉上下文包里只有工具才用得上的路径 */
export function controlsTools(runtime: Runtime): boolean {
  return [...runtime.run, ...runtime.resume].some((a) => a.includes('{tools}') || a === '{toolArgs}');
}

/** 所有登记的 CLI 在别的 agent 会话里会被当嵌套拒掉的环境变量,一起去掉(cotutor replay 在 Claude Code 里跑) */
export function withoutNested(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const a of ADAPTERS) for (const k of a.nestedEnv ?? []) delete out[k];
  return out;
}

/** 出厂运行时:各适配器的模板合在一起(default 由 skeleton 定) */
export function factoryRuntimes(): Record<string, Runtime> {
  return Object.assign({}, ...ADAPTERS.map((a) => a.runtimes()));
}

export interface FillVars {
  agent: string;
  prompt: string;
  session?: string;
  agentBody?: string;
  systemBody?: string;
  boardFile?: string;
  effort?: Policy['effort'];
  /** 这轮带不带工具;不给 = 带 */
  tools?: ToolSet;
  /** 这轮该读得到的目录(workspace 根、vault) */
  readDirs?: readonly string[];
}

/**
 * 填模板:独占一个参数的 `{toolArgs}` 换成适配器给的几个参数(可以是零个),`{tools}` 换成适配器的工具名单,其余占位照 schema 的 fillRuntime。
 */
export function fillArgs(adapter: CliAdapter, argv: readonly string[], vars: FillVars): string[] {
  const set = vars.tools ?? 'on';
  const spread = argv.flatMap((a) => (a === '{toolArgs}' ? adapter.toolArgs(set, { readDirs: vars.readDirs ?? [] }) : [a]));
  return fillRuntime(spread, { ...vars, effort: vars.effort ?? POLICY_DEFAULTS.effort, tools: adapter.toolList(set) });
}

/** 起老师进程的环境:基础环境 + 这轮计划里适配器定的变量,再交给适配器过一遍(claude 注代理) */
export function processEnv(plan: { cli: string; env: Record<string, string> }, base: NodeJS.ProcessEnv, ctx: { proxy?: string | false }): NodeJS.ProcessEnv {
  const adapter = adapterNamed(plan.cli) ?? STREAM_JSON;
  return adapter.env({ ...base, ...plan.env }, ctx);
}

/** 按计划里记的适配器名读输出(老数据没有就按 stream-json) */
export function parserOf(cli: string | undefined): (line: string) => CliEvent[] {
  return (cli ? adapterNamed(cli) : null)?.parse ?? STREAM_JSON.parse;
}

/** 按运行时名读输出(落盘的老轮次只记了运行时名;运行时后来删了或改了就按 stream-json) */
export function parserForRuntime(runtimes: Readonly<Record<string, unknown>>, name: string | undefined): (line: string) => CliEvent[] {
  const r = name && name !== 'default' ? runtimes[name] : undefined;
  return r && typeof r === 'object' && Array.isArray((r as Runtime).run) ? adapterFor(r as Runtime).parse : STREAM_JSON.parse;
}

/** 起进程前让这个 CLI 的适配器备好 workspace 里的机器文件(qwen 的隔离家目录);没有这一步的 CLI 什么都不做 */
export async function prepareCli(cli: string, root: string): Promise<void> {
  await adapterNamed(cli)?.prepare?.(root);
}

/** 进程起来报的工具表里,不该有的那几样(适配器不核对就是空) */
export function unexpectedTools(cli: string, set: ToolSet, tools: readonly string[]): string[] {
  const want = adapterNamed(cli)?.expectedTools?.(set);
  return want ? tools.filter((t) => !want.includes(t)) : [];
}

/** 这份模板是不是某个 CLI 以前出厂过、没人改过的(换新时整份换) */
export function isRetiredRuntime(name: string, runtime: { run: readonly string[]; resume: readonly string[] }): boolean {
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  return ADAPTERS.some((a) => (a.retired?.[name] ?? []).some((r) => same(r.run, runtime.run) && same(r.resume, runtime.resume)));
}

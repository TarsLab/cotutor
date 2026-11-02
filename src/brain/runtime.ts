/**
 * 这一轮用哪个运行时、接不接着会话。运行时只有 API 一种(`{api: "bailian", model}`,./api.ts)。
 * 2026-11-02 起不再起命令行(Qwen Code;Claude CLI 10-28 就去掉了):旧 cotutor.json 里写着 `{run, resume}` 的照样读得进来,
 * 但用不了——doctor 报出来,用到它的那位老师发不出去,说怎么改。以前那种运行时下聊的话题照样能看(sameRuntime:接不上、不记账)。
 */
import { isApiRuntime, type ApiRuntime, type CotutorConfig, type Runtime } from '../schema/index.ts';
import type { ToolSet } from './types.ts';

export interface RunPlan {
  /** 运行时名(runtimes 里的键) */
  runtime: string;
  /** 哪种脑跑的(API 的是 api;旧轮次的 run.json 里是 CLI 的适配器名) */
  cli: string;
  /** 这轮带不带工具 */
  tools: ToolSet;
  /** 旧轮次起 CLI 的命令行;API 的是空 */
  argv: string[];
  /** 这次是接着会话还是新开 */
  resume: boolean;
  /** 接着的会话 id */
  session: string | null;
  env: Record<string, string>;
}

export class RuntimeError extends Error {}

/** 命令行运行时(旧配置里的 `{run, resume}`)用不了,说怎么改;API 运行时 null */
export function runtimeIssue(runtime: Runtime): string | null {
  return isApiRuntime(runtime) ? null : '命令行运行时(Qwen Code 等)2026-11-02 起不再支持:把 runtimes.default 和 tutors.*.runtime 改成 api 或 api-flash(应用直连百炼),再删掉这一条';
}

export function getRuntime(config: CotutorConfig, name?: string): { name: string; runtime: ApiRuntime } {
  const n = name ?? config.runtimes.default;
  const p = config.runtimes[n];
  if (n === 'default' || !p || typeof p === 'string') {
    const known = Object.keys(config.runtimes).filter((k) => k !== 'default');
    throw new RuntimeError(`运行时 "${n}" 不存在;cotutor.json 的 runtimes 里有:${known.join('、')}`);
  }
  if (!isApiRuntime(p)) throw new RuntimeError(`运行时 "${n}":${runtimeIssue(p)}`);
  return { name: n, runtime: p };
}

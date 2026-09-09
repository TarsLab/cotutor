/**
 * 一次运行的命令规划(纯函数):按运行时选 run 还是 resume、填占位符、定 cwd 相对路径。
 * 规则:当天索引里已有会话**且**是同一运行时跑出来的 → resume;否则新开(跨天索引本来就是新的,零点后第一条自然不带 --resume;
 * 换了运行时也新开——claude 的会话 id qwen 不认)。{agentBody} 只给模板里真用到它的运行时读老师正文。
 */
import { fillRuntime, type Runtime, type ConversationIndex, type CotutorConfig } from '../schema/index.ts';

export interface RunPlan {
  /** 运行时名(runtimes 里的键) */
  runtime: string;
  /** 完整命令行,argv[0] 是可执行文件 */
  argv: string[];
  /** 这次是 resume 还是新开 */
  resume: boolean;
  /** resume 的会话 id */
  session: string | null;
}

export class RuntimeError extends Error {}

export function getRuntime(config: CotutorConfig, name?: string): { name: string; runtime: Runtime } {
  const n = name ?? config.runtimes.default;
  const p = config.runtimes[n];
  if (n === 'default' || !p || typeof p === 'string') {
    const known = Object.keys(config.runtimes).filter((k) => k !== 'default');
    throw new RuntimeError(`运行时 "${n}" 不存在;cotutor.json 的 runtimes 里有:${known.join('、')}`);
  }
  return { name: n, runtime: p };
}

/** 模板里有没有用到某个占位符(决定要不要去读老师正文) */
export function runtimeUses(runtime: Runtime, placeholder: string): boolean {
  return [...runtime.run, ...runtime.resume].some((a) => a.includes(placeholder));
}

export function planRun(
  config: CotutorConfig,
  index: Pick<ConversationIndex, 'session'>,
  vars: { agent: string; prompt: string; agentBody?: string; runtime?: string },
): RunPlan {
  const { name, runtime } = getRuntime(config, vars.runtime);
  const session = index.session && index.session.runtime === name ? index.session.id : null;
  const template = session ? runtime.resume : runtime.run;
  return {
    runtime: name,
    argv: fillRuntime(template, { agent: vars.agent, prompt: vars.prompt, session: session ?? undefined, agentBody: vars.agentBody }),
    resume: session !== null,
    session,
  };
}

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

/**
 * 这个运行时把板书写法预载进系统提示了吗:模板用了 {boardFile} / {systemBody},或者(2026-09-19 头一版)写死了 cotutor-board/SKILL.md 的路径。
 * 没有 → 应用在话题第一条注入 <cotutor-board>。
 */
export function boardPreloaded(runtime: Runtime): boolean {
  return runtimeUses(runtime, '{boardFile}') || runtimeUses(runtime, '{systemBody}') || runtimeUses(runtime, 'cotutor-board/SKILL.md');
}

export function planRun(
  config: CotutorConfig,
  index: Pick<ConversationIndex, 'session'>,
  vars: { agent: string; prompt: string; agentBody?: string; systemBody?: string; boardFile?: string; runtime?: string; effort?: 'low' | 'medium' | 'high' },
): RunPlan {
  const { name, runtime } = getRuntime(config, vars.runtime);
  const session = index.session && index.session.runtime === name ? index.session.id : null;
  const template = session ? runtime.resume : runtime.run;
  return {
    runtime: name,
    argv: fillRuntime(template, { agent: vars.agent, prompt: vars.prompt, session: session ?? undefined, agentBody: vars.agentBody, systemBody: vars.systemBody, boardFile: vars.boardFile, effort: vars.effort }),
    resume: session !== null,
    session,
  };
}

/**
 * 断流后接着跑的那条消息(policy.stall):resume 同一个会话发给老师。被杀的那段回复只流到了 stdout,没进会话,
 * 所以断在半截的正文(open)原样递回去,让它从断处接着写;应用把 open 拼在这次的收尾正文前面。
 * open 为空 = 这一段一个字没出来,已经做完的工具调用与整段都在会话里,接着把这一轮做完。
 */
export function stallPrompt(open: string): string {
  const rule = '不道歉,不提断了,不重复前面的。';
  return open
    ? `(应用注)你刚才那段回复传到一半网络断了。孩子那边已经看到、听到的就是下面 <<< 与 >>> 之间这些:\n<<<\n${open}\n>>>\n从断的地方直接接着写,字要接得上;${rule}`
    : `(应用注)你刚才那段回复网络断了,一个字没传出来。已经做完的工具调用和写完的段都还在,接着把这一轮做完;${rule}`;
}

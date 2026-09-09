/**
 * 一次运行的命令规划(纯函数):按预设选 run 还是 resume、填占位符、定 cwd 相对路径。
 * 规则:当天索引里已有会话**且**是同一预设跑出来的 → resume;否则新开(跨天索引本来就是新的,零点后第一条自然不带 --resume;
 * 换了预设也新开——claude 的会话 id qwen 不认)。{agentBody} 只给模板里真用到它的预设读老师正文。
 */
import { fillPreset, type AgentPreset, type ConversationIndex, type CotutorConfig } from '../schema/index.ts';

export interface RunPlan {
  /** 预设名(agents 里的键) */
  preset: string;
  /** 完整命令行,argv[0] 是可执行文件 */
  argv: string[];
  /** 这次是 resume 还是新开 */
  resume: boolean;
  /** resume 的会话 id */
  session: string | null;
}

export class PresetError extends Error {}

export function getPreset(config: CotutorConfig, name?: string): { name: string; preset: AgentPreset } {
  const n = name ?? config.agents.default;
  const p = config.agents[n];
  if (n === 'default' || !p || typeof p === 'string') {
    const known = Object.keys(config.agents).filter((k) => k !== 'default');
    throw new PresetError(`预设 "${n}" 不存在;cotutor.json 的 agents 里有:${known.join('、')}`);
  }
  return { name: n, preset: p };
}

/** 模板里有没有用到某个占位符(决定要不要去读老师正文) */
export function presetUses(preset: AgentPreset, placeholder: string): boolean {
  return [...preset.run, ...preset.resume].some((a) => a.includes(placeholder));
}

export function planRun(
  config: CotutorConfig,
  index: Pick<ConversationIndex, 'session'>,
  vars: { agent: string; prompt: string; agentBody?: string; preset?: string },
): RunPlan {
  const { name, preset } = getPreset(config, vars.preset);
  const session = index.session && index.session.agent === name ? index.session.id : null;
  const template = session ? preset.resume : preset.run;
  return {
    preset: name,
    argv: fillPreset(template, { agent: vars.agent, prompt: vars.prompt, session: session ?? undefined, agentBody: vars.agentBody }),
    resume: session !== null,
    session,
  };
}

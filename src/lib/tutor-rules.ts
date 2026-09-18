/**
 * 老师守则(机器技能 cotutor-tutor):有脸的老师共同的那几段(上下文包、三种回复、记忆段、不变的规矩)。
 * 老师文件拷进 workspace 就归家长、改过 upgrade 就不再换,公共规矩放在那里修不到每一家;放进机器技能每次 upgrade 覆盖,
 * 由应用在每个话题第一条把原文放进上下文包(<cotutor-rules>,同一话题没改过的写「未变」),不靠老师自己去 Read。
 */
import { parseAgentFile } from './agent-file.ts';

export const TUTOR_SKILL = 'cotutor-tutor';
/** 相对 workspace 根 */
export const TUTOR_RULES_PATH = `.claude/skills/${TUTOR_SKILL}/SKILL.md`;

/** 放进上下文包的正文:去掉 frontmatter(那是给 CLI 的技能索引看的) */
export function tutorRulesBody(skillMd: string): string {
  return parseAgentFile(skillMd).body;
}

/** 谁拿守则:有脸的老师(键以 -tutor 结尾);scene-maker 这类工具人的工作流写在自己文件里 */
export function takesTutorRules(agent: string): boolean {
  return agent.endsWith('-tutor');
}

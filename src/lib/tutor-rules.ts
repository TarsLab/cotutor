/**
 * 老师守则(机器技能 cotutor-tutor):有脸的老师共同的那几段(上下文包、三种回复、记忆段、不变的规矩)。
 * 老师文件拷进 workspace 就归家长、改过 upgrade 就不再换,公共规矩放在那里修不到每一家;放进机器技能每次 upgrade 覆盖,
 * 由应用在每个话题第一条把原文放进上下文包(<cotutor-rules>,同一话题没改过的写「未变」),不靠老师自己去 Read。
 */
import { parseAgentFile } from './agent-file.ts';
import { stripHumanNotes } from './human-notes.ts';
import { applyCardGuards } from './card-guards.ts';
import { BOARD_CARD_KINDS } from '../schema/config.ts';
import { toolKind } from '../clis/index.ts';

export const TUTOR_SKILL = 'cotutor-tutor';
/** 相对 workspace 根 */
export const TUTOR_RULES_PATH = `.claude/skills/${TUTOR_SKILL}/SKILL.md`;

/**
 * 放进上下文包的正文:去掉 frontmatter(那是给 CLI 的技能索引看的)与给人看的注释,按这位老师的卡裁 `{{有 …}}` 段(没给 = 全部)。
 * 守卫写坏了(家长改过的机器件)就只去掉守卫行,整篇照给。
 */
export function tutorRulesBody(skillMd: string, kinds: readonly string[] = BOARD_CARD_KINDS): string {
  const body = stripHumanNotes(parseAgentFile(skillMd).body);
  try {
    return applyCardGuards(body, kinds);
  } catch {
    return body.replace(/^\{\{\/?有[^}]*\}\}\s*\n/gm, '');
  }
}

/** 谁拿守则:有脸的老师(键以 -tutor 结尾);工具人的工作流写在自己文件里 */
export function takesTutorRules(agent: string): boolean {
  return agent.endsWith('-tutor');
}

/** 板书写法(机器技能 cotutor-board 的 SKILL.md),相对 workspace 根。由应用递给老师:运行时能预载就进系统提示,否则进话题第一条的 <cotutor-board> */
export const BOARD_GUIDE_PATH = '.claude/skills/cotutor-board/SKILL.md';

/** 递给老师的正文:去掉 frontmatter 与给人看的注释 */
export function boardGuideBody(skillMd: string): string {
  return stripHumanNotes(parseAgentFile(skillMd).body);
}

/** 上下文包 boardGuide: 行在预载时写的话(事实陈述,不让老师自查) */
export const BOARD_GUIDE_IN_SYSTEM = '已在你的系统提示里(「# 板书怎么写」),不用读';

/**
 * 回归检查(与 CLI 无关):板书写法已经递到手里,老师这轮还用工具去读它 → 预载没起作用(换模型 / 换 CLI / 升版本后最先坏的地方)。
 * 认三种:技能工具(claude 的 Skill、qwen 的 skill,按 src/clis/ 的工具类别认)点名 cotutor-board;任何工具的参数里带 cotutor-board/SKILL.md(Read、cat、别家 CLI 的读文件工具),或按老师裁的那份 .cotutor/board/。
 * references/<种类>.md 是按需读的,不算。
 */
export function boardGuideReads(tools: readonly { name: string; arg: string }[]): string[] {
  return tools.filter((t) => (toolKind(t.name) === 'skill' && t.arg.trim() === 'cotutor-board') || t.arg.includes('cotutor-board/SKILL.md') || t.arg.includes('.cotutor/board/')).map((t) => `${t.name} ${t.arg}`.trim());
}

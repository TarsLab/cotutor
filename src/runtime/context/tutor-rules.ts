/**
 * 老师守则(机器技能 cotutor-tutor):老师们共同的那几段(上下文包、回复、记忆段、不变的规矩)。
 * activity 拷进 workspace 就归家长、改过 refresh 就不再换,公共规矩放在那里修不到每一家;放进机器技能每次 refresh 覆盖,
 * 由应用在每个话题第一条把原文放进上下文包(<cotutor-rules>,同一话题没改过的写「未变」),不靠老师自己去 Read。
 * 讲稿与动作怎么写不在守则里,进系统提示(cards/动作怎么写.md)。
 */
import { parseFrontmatter } from '../../shared/frontmatter.ts';
import { stripHumanNotes } from '../../shared/human-notes.ts';
import { SKILLS_DIR } from '../../schema/workspace.ts';

export const TUTOR_SKILL = 'cotutor-tutor';
/** 相对 workspace 根 */
export const TUTOR_RULES_PATH = `${SKILLS_DIR}/${TUTOR_SKILL}/SKILL.md`;

/** 放进上下文包的正文:去掉 frontmatter(那是给 CLI 的技能索引看的)与给人看的注释 */
export function tutorRulesBody(skillMd: string): string {
  return stripHumanNotes(parseFrontmatter(skillMd).body);
}

/**
 * 老师卡(kind 名 tutor,只用在首页,《首页设计.md》§3.3):一位老师 + 几个按钮,孩子点了进这位老师。
 * 标签修饰 = 老师的键;正文一行一个按钮:`接着 <日期> <话题> <字>` 接着那天的那个话题,其余行是开场按钮;
 * `讲法:` 行挂在上一个按钮下面,是家长和 LLM 写给老师的,strip 剥掉,孩子端 JSON 里没有。
 * 「新话题」应用永远放第一个,不进 props。老师在不在、话题在不在,由首页检查(src/server/home.ts)查。
 */
import { z } from 'zod';
import type { CardKind } from './kind.ts';

export const TUTOR_BUTTONS_MAX = 4;
export const BUTTON_LABEL_MAX = 16;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const THREAD_RE = /^\d{4}-\d+$/;
const LIST_PREFIX = /^(?:[-*+]|\d+[.)])\s+/;
const BRIEF_LINE = /^讲法\s*[::]\s*(.*)$/;
const CONTINUE_LINE = /^接着\s+/;

const label = z.string().min(1).refine((s) => Array.from(s).length <= BUTTON_LABEL_MAX, `按钮的字最多 ${BUTTON_LABEL_MAX} 个`);

export const TutorButtonSchema = z.discriminatedUnion('kind', [
  /** 开场:孩子点了就把 label 发给老师(新话题),老师照 brief 开讲 */
  z.object({ kind: z.literal('start'), label, brief: z.string().min(1).optional() }),
  /** 接着:那天的那个话题;今天的 resume,以前的新开会话、上下文包带那个话题的尾巴 */
  z.object({ kind: z.literal('continue'), label, date: z.string().regex(DAY_RE), thread: z.string().regex(THREAD_RE), brief: z.string().min(1).optional() }),
]);
export type TutorButton = z.infer<typeof TutorButtonSchema>;

export const TutorPropsSchema = z.object({
  /** 老师的键(cotutor.json tutors 里的,-tutor 结尾) */
  tutor: z.string().regex(NAME_RE),
  buttons: z.array(TutorButtonSchema).max(TUTOR_BUTTONS_MAX),
});
export type TutorProps = z.infer<typeof TutorPropsSchema>;

export const tutor: CardKind<TutorProps> = {
  name: 'tutor',
  where: ['home'],
  props: TutorPropsSchema,
  parse(body, mods) {
    const name = mods[0]?.toLowerCase();
    if (!name) throw new Error('标签后面写老师的键,如 ```tutor chinese-tutor');
    if (!NAME_RE.test(name)) throw new Error(`「${mods[0]}」不是老师的键(cotutor.json tutors 里的英文名,如 chinese-tutor)`);
    if (mods.length > 1) throw new Error(`一张老师卡只写一位老师(多了 ${mods.slice(1).join(' ')})`);
    const buttons: TutorButton[] = [];
    for (const raw of body.split('\n')) {
      const line = raw.trim().replace(LIST_PREFIX, '');
      if (!line) continue;
      const brief = BRIEF_LINE.exec(line);
      if (brief) {
        const last = buttons[buttons.length - 1];
        if (!last) throw new Error('「讲法:」前面要有一个按钮(讲法挂在上一个按钮下面)');
        const text = brief[1].trim();
        if (text) last.brief = last.brief ? `${last.brief}\n${text}` : text;
        continue;
      }
      if (line === '新话题') continue;
      if (CONTINUE_LINE.test(line)) {
        const m = /^接着\s+(\S+)\s+(\S+)\s+(.+)$/.exec(line);
        if (!m || !DAY_RE.test(m[1]) || !THREAD_RE.test(m[2])) throw new Error(`「${line}」:接着要写成「接着 <日期> <话题> <孩子看到的字>」,如「接着 2026-09-16 1930-1 接着写看图写话」`);
        buttons.push({ kind: 'continue', date: m[1], thread: m[2], label: m[3].trim() });
      } else buttons.push({ kind: 'start', label: line });
      const cps = Array.from(buttons[buttons.length - 1].label).length;
      if (cps > BUTTON_LABEL_MAX) throw new Error(`按钮「${buttons[buttons.length - 1].label}」${cps} 个字,最多 ${BUTTON_LABEL_MAX} 个;要跟老师说的挪到下一行的「讲法:」里`);
    }
    if (buttons.length > TUTOR_BUTTONS_MAX) throw new Error(`按钮最多 ${TUTOR_BUTTONS_MAX} 个(「新话题」不算),写了 ${buttons.length} 个`);
    return { tutor: name, buttons };
  },
  strip(props) {
    return { ...props, buttons: props.buttons.map(({ brief: _brief, ...b }) => b as TutorButton) };
  },
};

/**
 * 老师卡(kind 名 tutor,只用在首页,《首页设计.md》§3.3):一位老师 + 几个按钮,孩子点了进这位老师。
 * 标签修饰 = 老师的键;正文一行一个按钮:`接着 <日期> <话题> <字>` 接着那天的那个话题,`小课堂 <课包 id> <字>` 先看那份课包再聊(《小课堂设计.md》),其余行是开场按钮;
 * `讲法:` 行挂在上一个按钮下面,是家长和 LLM 写给老师的,strip 剥掉,孩子端 JSON 里没有;`留到: <日期>` 也挂在上一个按钮下面,过了那天孩子端不再出现(家长端表单的「只今天 / 到周日」,《首页设计.md》拍板 20)。
 * 小课堂按钮下面 `activity: <名>` 挂一个 activity,看完开口那条起照它带。
 * `activity <名> [孩子看到的字]` 进那个 activity(agents/<老师>/activities/<名>.md,《wip/activity设计.md》);它下面 `名: 值` 的行是这个 activity 的参数,和讲法一样 strip 剥掉。
 * 「新话题」应用永远放第一个,不进 props。老师在不在、话题在不在,由首页检查(src/server/home.ts)查。
 */
import { z } from 'zod';
import { BUNDLE_ID_RE, type CardKind } from './kind.ts';

export const TUTOR_BUTTONS_MAX = 4;
export const BUTTON_LABEL_MAX = 16;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const THREAD_RE = /^\d{4}-\d+$/;
const LIST_PREFIX = /^(?:[-*+]|\d+[.)])\s+/;
const BRIEF_LINE = /^讲法\s*[:：]\s*(.*)$/;
const UNTIL_LINE = /^留到\s*[:：]\s*(.*)$/;
const CONTINUE_LINE = /^接着\s+/;
const LECTURE_LINE = /^小课堂\s+/;
const ACTIVITY_LINE = /^activity(?:\s|$)/;
/** activity 按钮下面的参数行:名: 值 */
const PARAM_LINE = /^([^\s:：]+)\s*[:：]\s*(.*)$/;
/** 小课堂按钮下面挂一个 activity:看完开口那条起照那个 activity 带(参数用缺省) */
const LECTURE_ACTIVITY = /^activity\s*[:：]\s*(.*)$/;

const label = z.string().min(1).refine((s) => Array.from(s).length <= BUTTON_LABEL_MAX, `按钮的字最多 ${BUTTON_LABEL_MAX} 个`);
/** 留到哪天(含那天);过了孩子端不再出现 */
const until = z.string().regex(DAY_RE).optional();

export const TutorButtonSchema = z.discriminatedUnion('kind', [
  /** 开场:孩子点了就把 label 发给老师(新话题),老师照 brief 开讲 */
  z.object({ kind: z.literal('start'), label, brief: z.string().min(1).optional(), until }),
  /** 接着:那天的那个话题;今天的 resume,以前的新开会话、上下文包带那个话题的尾巴 */
  z.object({ kind: z.literal('continue'), label, date: z.string().regex(DAY_RE), thread: z.string().regex(THREAD_RE), brief: z.string().min(1).optional(), until }),
  /** 小课堂:孩子点了先看这份课包(铺满、一口气放完),看完才能开口;开口那条新开话题,老师拿到课的每句与孩子圈的地方 */
  z.object({ kind: z.literal('lecture'), label, bundle: z.string().regex(BUNDLE_ID_RE), brief: z.string().min(1).optional(), until, activity: z.string().min(1).optional() }),
  /** activity:孩子点了新开话题、把 label 发给老师;老师照那个 activity 文件带,params 是家长填的(原文,对不对由首页检查读 activity 文件查) */
  z.object({ kind: z.literal('activity'), label, activity: z.string().min(1), params: z.record(z.string(), z.string()), brief: z.string().min(1).optional(), until }),
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
      const keep = UNTIL_LINE.exec(line);
      if (keep) {
        const last = buttons[buttons.length - 1];
        if (!last) throw new Error('「留到:」前面要有一个按钮(留到挂在上一个按钮下面)');
        const day = keep[1].trim();
        if (!DAY_RE.test(day)) throw new Error(`「${line}」:留到要写日期,如「留到: 2026-10-12」(那天过完孩子就看不到这个按钮)`);
        last.until = day;
        continue;
      }
      if (line === '新话题') continue;
      const last = buttons[buttons.length - 1];
      const hang = LECTURE_ACTIVITY.exec(line);
      if (hang) {
        if (last?.kind !== 'lecture') throw new Error(`「${line}」:activity: 只挂在小课堂按钮下面;要一个 activity 按钮,写「activity <名>」`);
        const name = hang[1].trim();
        if (!/^\S+$/.test(name)) throw new Error(`「${line}」:activity: 后面写一个 activity 的名字,如「activity: 看图说话」`);
        last.activity = name;
        continue;
      }
      const param = last?.kind === 'activity' ? PARAM_LINE.exec(line) : null;
      if (last?.kind === 'activity' && param) {
        if (param[1] in last.params) throw new Error(`「${line}」:参数 ${param[1]} 写了两次`);
        last.params[param[1]] = param[2].trim();
        continue;
      }
      if (CONTINUE_LINE.test(line)) {
        const m = /^接着\s+(\S+)\s+(\S+)\s+(.+)$/.exec(line);
        if (!m || !DAY_RE.test(m[1]) || !THREAD_RE.test(m[2])) throw new Error(`「${line}」:接着要写成「接着 <日期> <话题> <孩子看到的字>」,如「接着 2026-09-16 1930-1 接着写看图写话」`);
        buttons.push({ kind: 'continue', date: m[1], thread: m[2], label: m[3].trim() });
      } else if (LECTURE_LINE.test(line)) {
        const m = /^小课堂\s+(\S+)\s+(.+)$/.exec(line);
        if (!m || !BUNDLE_ID_RE.test(m[1])) throw new Error(`「${line}」:小课堂要写成「小课堂 <课包 id> <孩子看到的字>」,如「小课堂 2026-09-18-po13-jian-8 13 减 8 怎么拆」`);
        buttons.push({ kind: 'lecture', bundle: m[1], label: m[2].trim() });
      } else if (ACTIVITY_LINE.test(line)) {
        const m = /^activity\s+(\S+)(?:\s+(.+))?$/.exec(line);
        if (!m) throw new Error(`「${line}」:activity 要写成「activity <名> [孩子看到的字]」,如「activity 你说我画」`);
        buttons.push({ kind: 'activity', activity: m[1], label: (m[2] ?? m[1]).trim(), params: {} });
      } else buttons.push({ kind: 'start', label: line });
      const cps = Array.from(buttons[buttons.length - 1].label).length;
      if (cps > BUTTON_LABEL_MAX) throw new Error(`按钮「${buttons[buttons.length - 1].label}」${cps} 个字,最多 ${BUTTON_LABEL_MAX} 个;要跟老师说的挪到下一行的「讲法:」里`);
    }
    if (buttons.length > TUTOR_BUTTONS_MAX) throw new Error(`按钮最多 ${TUTOR_BUTTONS_MAX} 个(「新话题」不算),写了 ${buttons.length} 个`);
    return { tutor: name, buttons };
  },
  strip(props) {
    // 讲法与 activity 的参数是写给老师的,孩子端不要
    return { ...props, buttons: props.buttons.map(({ brief: _brief, ...b }) => (b.kind === 'activity' ? { ...b, params: {} } : b) as TutorButton) };
  },
};

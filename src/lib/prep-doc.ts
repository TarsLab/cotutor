/**
 * cotutor-prep 技能(《备课设计.md》§十)的生成部分:references/ 下的课文件语法.md 与命令.md 由这里现生成,scripts/gen-skills.ts 写进包根 skills/cotutor-prep/,
 * tests/skills.test.ts 断言入库的和生成的一致。SKILL.md 本体(流程、铁律)是手写的。卡的写法不重复,指向 cotutor-board 的 references/。
 */
import { USAGE } from '../cli/usage.ts';
import { kindsFor } from '../cards/index.ts';
import type { ThemeManifest } from '../schema/theme.ts';
import { MAX_CARDS_PER_ROW } from './kid-board.ts';
import { MAX_MARKS_PER_CARD, MAX_MARKS_PER_LINE } from './postprocess.ts';

export const PREP_SKILL = 'cotutor-prep';

export function lessonSyntaxDoc(): string {
  const kinds = kindsFor('board').map((k) => k.name);
  return `# 课文件怎么写(机器生成,别改)

课文件是 workspace 的 lessons/<课名>.md,板书同一套语法、同一个解析器;一份文件 = 给孩子的几节课。

## 形状

\`\`\`\`markdown
---
tutor: math-tutor          # 必填:cotutor.json 里以 -tutor 结尾的老师
device: tablet-landscape   # 可省:排版是给哪个端排的(phone / tablet-portrait / tablet-landscape),缺省平板横屏;别的端由应用机械折行
for: 2026-09-28            # 可省:给哪天用的
---

讲稿一句一行。

\`\`\`text tint=sky
# 卡的标题
卡上的字
\`\`\`

讲这张卡的话,末句写成问句就停下等孩子。

---

第二节从这里起。

## 讲法

孩子答了之后老师要怎么接,写给老师的话(孩子看不到)。
\`\`\`\`

- **frontmatter** 只认 tutor / device / for。
- **正文 = 板书语法**:普通行是讲稿一句(会念出来),围栏是卡(标签第一个词是种类)。每种卡的写法见 ../../cotutor-board/references/<种类>.md,索引在 ../../cotutor-board/references/README.md。能用的种类:${kinds.join('、')}。
- **\`---\` 独占一行分节**(围栏里的不算):一节就是孩子端的一轮——念完末句问句停下等孩子;孩子答了才有下一节的老师。所以每节末句写成问句,能选配 choice、能填配 fill。
- **第一个 \`## \` 起是讲法**,给老师的,孩子看不到。孩子答了第一句,老师是新会话,只靠这段和课文件本身知道你想怎么接。

## 排版:写在围栏行上

围栏标签里种类后面可以加排版修饰词,哪种卡都认:

| 写 | 意思 |
|---|---|
| \`same\` | 这张卡和上一张并排(不写 = 孩子端按卡的宽度排:字少的两张自动并排)。一行最多 ${MAX_CARDS_PER_ROW} 张;标题行、画板(canvas)、录音卡(record)、讲解动画永远独占一行,写了 same 也接不上(检查会提醒) |
| \`tint=<槽>\` | 底色槽,名字在主题的 theme.json 的 tints 里(cotutor lesson check 会告诉你有哪些) |
| \`look=<槽>\` | 字形槽,名字在 theme.json 的 looks 里 |
| \`emoji=<一个>\` | 卡标题前的一个 emoji |

例:\`\`\`\`text formula same tint=sky\`\`\`\`。讲稿里想让某个词在卡上亮起来,用方括号:「这叫[底]」,那个词要在某张卡上出现。

排版是写课文件的一部分:写卡的时候就按 references/排版.md 排好,不另起一步。家长手写的文件没排版,\`cotutor lesson post <课名> --write\` 用同一份规则让模型整份排一遍回写进文件;手写过的当已定,只填没写的。

## 检查会报什么

- 要改(交不出去):没写 tutor、老师不在 / 关着 / 是工具人、卡没解析成、槽名不在主题里、正文是空的。
- 提醒(照交):某节末句不是问句、某节没有卡、没有讲法、for 已过去。
`;
}

export function lessonCommandsDoc(): string {
  const lines = USAGE.split('\n').filter((l) => /^\s*cotutor (lesson|home show|show|pack)\b/.test(l));
  return `# 命令(机器生成,别改)

\`\`\`
${lines.join('\n')}
\`\`\`

- check 不花钱;post 花钱(整份一次,几分到一毛钱),先问家长,自己写的文件不用它——写的时候就排好;hand 配音也花一点钱(同文本缓存,改过的句才花)。
- hand 之后:孩子首页上这位老师多一个只打开的按钮;同一文件孩子没开口再 hand 是覆盖(话题不变),孩子开口后再 hand 是新话题。
- 看孩子会看到什么:服务开着就请家长开家长端 /parent,清单里这位老师块下面「课文件」一栏点进这份,整份铺开;文件一改几秒后自己跟上。
`;
}

/** 排版规则(和板书后期的校验器同源的常量;槽名从 workspace 的主题现读):技能的 references/排版.md,也是 cotutor lesson post 的提示词正文 */
export function layoutRules(theme?: ThemeManifest): string {
  const slots = (t: Record<string, { use: string }>): string => Object.entries(t).map(([k, v]) => `- \`${k}\`:${v.use}`).join('\n');
  const tints = theme ? slots(theme.tints) : '看 workspace 的 themes/<主题>/theme.json 的 tints(每个槽一句「给什么用」);主题名在 cotutor.json 的 kid.theme,缺省 default';
  const looks = theme ? (Object.keys(theme.looks).length ? slots(theme.looks) : '(这个主题没有字形槽,别写 look=)') : '同上,看 theme.json 的 looks';
  return `## 行

- 不写 \`same\`,孩子端按卡的宽度排:字少的卡半宽,相邻两张半宽的自动并排。多数卡不用管。
- 只有一定要并排对照的「兄弟卡」才写 \`same\`:两种情况、公式和它所属的那一步。
- 一行最多 ${MAX_CARDS_PER_ROW} 张;不相干的别硬凑一行。
- 标题行(只有 \`# 标题\` 的 text)、画板(canvas)、录音卡(record)、讲解动画(scene)永远独占一行,写了 \`same\` 也接不上。
- 选择题、填空题能并排:短的题和它讲的那段原文并一行,孩子不用来回翻。
- 排的是平板横屏(frontmatter 的 device 不写就是它);手机上应用自己折,不用管。

## 底色槽 tint(一张卡一个;不写 = 缺省)

${tints}

- 同类的卡同一个底色(两种情况都用同一色、公式都用公式色),前后呼应;做题的卡留给应用(答题卡不用写 tint)。

## 字形槽 look(不写 = 缺省)

${looks}

## emoji

- 只给标题卡上一个,和内容相关,别用组合 emoji(ZWJ),别每张都放。

## 标注:讲稿里的 [词]

- 讲到某张卡时要在卡上亮起来的词,在讲稿那句里用方括号括出来:\`这叫[底]\`。**那个词必须一字不差地出现在某张卡上**,不在卡上的别标。
- 一句最多 ${MAX_MARKS_PER_LINE} 处,一张卡最多 ${MAX_MARKS_PER_CARD} 处;同一个词在同一张卡上只标一次;田字格卡不标。
- 标的是孩子要盯住的那个词(定义、公式里的量、题里的关键数),不是整句。

## 只动排版

- 只改围栏行上的 \`same\` / \`tint=\` / \`look=\` / \`emoji=\` 和讲稿里的方括号;卡的正文、讲稿的字、frontmatter、分节线、讲法一个字不动。
- 已经写了的修饰词和方括号是定了的,别改、别删。`;
}

export function layoutDoc(): string {
  return `# 课文件怎么排版(机器生成,别改)

排版是写课文件的一部分:写卡的时候就把它排好,不另起一步。写法是围栏行上的修饰词(\`same\` 和上一张并排、\`tint=<槽>\`、\`look=<槽>\`、\`emoji=<一个>\`)和讲稿里的 \`[词]\`,见 课文件语法.md。

${layoutRules()}

## 家长手写的文件

家长自己写的课文件多半没排版(按卡的宽度排、缺省底色,照样能交)。想排:\`cotutor lesson post <课名> --write\`,用上面这份规则让模型整份排一遍回写进文件——正文一个字不动(不一样就整份不要),手写过的修饰词当已定。花钱(一次几分到一毛钱),先问家长。你自己在会话里按规则改文件也一样,不花第二份钱。
`;
}

/** cotutor lesson post 的提示词:规则(带这个主题的槽表)+ 全文 + 回什么 */
export function layoutPrompt(md: string, theme: ThemeManifest): string {
  return `你是一份课文件的排版:课文件是给孩子看的板书,围栏是卡、普通行是老师念的话。老师已经决定了卡上写什么、讲稿说什么;你只决定哪几张卡一定要并排、用哪个底色槽 / 字形槽、要不要一个 emoji、讲到每句时在卡上标哪个词。

${layoutRules(theme)}

## 回什么

把下面整份文件原样回给我,只加、改围栏行上的修饰词和讲稿里的方括号;别的一个字不动。回答的第一个字符就是文件的第一个字符(\`---\`),不要解释、不要围栏包起来、不要别的字。

${md}`;
}

export function prepSkillGeneratedFiles(): Record<string, string> {
  return { 'references/课文件语法.md': lessonSyntaxDoc(), 'references/排版.md': layoutDoc(), 'references/命令.md': lessonCommandsDoc() };
}

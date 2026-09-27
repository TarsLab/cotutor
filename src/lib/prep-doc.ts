/**
 * cotutor-prep 技能(《备课设计.md》§十)的生成部分:references/ 下的课文件语法.md 与命令.md 由这里现生成,scripts/gen-skills.ts 写进包根 skills/cotutor-prep/,
 * tests/skills.test.ts 断言入库的和生成的一致。SKILL.md 本体(流程、铁律)是手写的。卡的写法不重复,指向 cotutor-board 的 references/。
 */
import { USAGE } from '../cli/usage.ts';
import { kindsFor } from '../cards/index.ts';
import { MAX_CARDS_PER_ROW } from './postprocess.ts';

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
| \`same\` | 这张卡接上一行(不写 = 另起一行)。一行最多 ${MAX_CARDS_PER_ROW} 张;标题行、答题卡(choice / fill / canvas / record)、讲解动画永远独占一行,写了 same 也接不上(检查会提醒) |
| \`tint=<槽>\` | 底色槽,名字在主题的 theme.json 的 tints 里(cotutor lesson check 会告诉你有哪些) |
| \`look=<槽>\` | 字形槽,名字在 theme.json 的 looks 里 |
| \`emoji=<一个>\` | 卡标题前的一个 emoji |

例:\`\`\`\`text formula same tint=sky\`\`\`\`。讲稿里想让某个词在卡上亮起来,用方括号:「这叫[底]」,那个词要在某张卡上出现。

不想自己排:\`cotutor lesson post <课名> --write\` 让板书后期(快模型)排一版回写进文件;你手写过的当已定,它只填没写的。花钱(每拍几分钱)。

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

- check 不花钱;post 花钱(每拍几分钱),先问家长;hand 配音也花一点钱(同文本缓存,改过的句才花)。
- hand 之后:孩子首页上这位老师多一个只打开的按钮;同一文件孩子没开口再 hand 是覆盖(话题不变),孩子开口后再 hand 是新话题。
- 看孩子会看到什么:服务开着就请家长开家长端 /parent,清单里这位老师块下面「课文件」一栏点进这份,整份铺开;文件一改几秒后自己跟上。
`;
}

export function prepSkillGeneratedFiles(): Record<string, string> {
  return { 'references/课文件语法.md': lessonSyntaxDoc(), 'references/命令.md': lessonCommandsDoc() };
}

/**
 * cotutor-home 技能的生成部分(《首页设计.md》§八):references/ 整个由这里现生成,scripts/gen-skills.ts 写进包根 skills/cotutor-home/,
 * tests/skills.test.ts 断言入库的和生成的一致。首页语法.md 从首页能用的卡的 card.md 拼(首页专属的全文,和板书共用的只给一句 + 指向 cotutor-board),
 * <kind>.md 是首页专属卡的协议全文,命令.md 从 CLI 用法文本取。SKILL.md 本体(流程、铁律)是手写的。
 */
import { USAGE } from '../cli/usage.ts';
import { BUTTON_LABEL_MAX, TUTOR_BUTTONS_MAX, kindsFor } from '../cards/index.ts';
import { PACKAGE_CARDS_DIR, readCardDoc } from '../cards/docs.ts';

export const HOME_SKILL = 'cotutor-home';

const EXPECT_RE = /^\s*<!--\s*expect\b.*?-->\s*\n?/gm;
const HOME_COMMANDS = ['home', 'show', 'rate', 'bookkeep'];

/** 只用在首页的种类(板书里不能用的) */
function homeOnly(): string[] {
  return kindsFor('home').filter((k) => !(k.where ?? ['board']).includes('board')).map((k) => k.name);
}

export function homeSyntaxDoc(dir = PACKAGE_CARDS_DIR): string {
  const only = homeOnly();
  const own = only.map((kind) => {
    const d = readCardDoc(kind, dir);
    return [`### ${d.headline}`, d.sections['是什么'], d.sections['写法'], d.sections['例子']?.replace(EXPECT_RE, '')].filter((x) => x && x.trim()).join('\n\n');
  });
  const shared = kindsFor('home')
    .filter((k) => !only.includes(k.name))
    .map((k) => {
      const d = readCardDoc(k.name, dir);
      const what = (d.sections['是什么'] ?? '').split('\n').find((l) => l.trim()) ?? '';
      return `- \`${k.name}\`:${what} 写法见 ../../cotutor-board/references/${k.name}.md(首页上没有讲稿,那里说「讲到这张卡时」的动作不会发生;孩子点了照样能用)。`;
    });
  return `# 首页怎么写(机器生成,别改)

首页文件是 workspace 的 home/draft.md,和板书同一个解析器:

- **frontmatter**(可选):只认 \`for: YYYY-MM-DD\`(这份是给哪天用的)。
- **围栏 = 卡**:标签第一个词是种类,其余是修饰。卡按文件顺序铺;老师卡永远排在最上面。
- **第一个 \`## \` 起是给家长的**(「## 为什么这么排」),孩子看不到。
- 围栏外的普通行首页不显示(检查会提醒),要给孩子看的写进卡里。

应用保证的:每位孩子端露出的老师都有一张老师卡(没写就补一张只有「新话题」的);「新话题」永远是第一个按钮;今天和这位老师聊过,第二个按钮是应用加的「接着刚才的」;引用坏了(话题找不到)的按钮不出现。

老师卡的按钮最多 ${TUTOR_BUTTONS_MAX} 个,每个最多 ${BUTTON_LABEL_MAX} 个字。

## 首页专属的卡

${own.join('\n\n')}

## 和板书共用的卡

${shared.join('\n')}

只能用在板书里的卡(选择题、填空、画板、讲解动画、代码)首页放不了——它们做完要交给某位老师。

## 一份完整的草稿

\`\`\`\`markdown
---
for: 2026-09-18
---

\`\`\`tutor chinese-tutor
我要预习小蝌蚪找妈妈
讲法: 第 22 课。先带他把 1–3 自然段读顺,重点字 塘、脑、袋;读完问他小蝌蚪先遇到了谁
接着 2026-09-16 1930-1 接着写看图写话
讲法: 上次第二句卡住了,先把他写的两句念给他听再往下
\`\`\`

\`\`\`tutor math-tutor
再练两道退位减法
讲法: 出 52−7、80−3,先让他说怎么想,跨十那一步慢一点
\`\`\`

\`\`\`tianzige
塘脑袋
\`\`\`

## 为什么这么排

- 语文:16 号小蝌蚪只读到第 1 段;看图写话第二句卡住,日记观察「句子接不上时会停很久」。
- 数学:近两周观察里两次跨十停顿,计划里写了周五小测。
- 朗读老师今天没有要接的,只留新话题。
\`\`\`\`
`;
}

export function homeCommandsDoc(): string {
  const cmds = USAGE.split('\n').filter((l) => {
    const m = /^\s+cotutor (\S+)/.exec(l);
    return m !== null && HOME_COMMANDS.includes(m[1]);
  });
  return `# 命令(机器生成,别改)

在 workspace 根跑;完整用法 cotutor --help。

\`\`\`
${cmds.join('\n')}
\`\`\`

## 文件

| 文件 | 是什么 |
|---|---|
| \`home/draft.md\` | 草稿:你写、家长可改;孩子端不读 |
| \`home/published.json\` | 已发布的那份(publish 生成,机器件,别手改);孩子端只读它 |
| \`home/history/<id>.md\` | 每次发布的原文 |
| \`conversations/<老师>/<日期>.json\` | 一天的对话索引;消息的 \`via\` = 从首页哪个按钮进来的(\`{home, button, label}\`),\`continues\` = 接着哪天哪个话题 |
`;
}

/** references/ 下的全部文件(相对技能根) */
export function homeSkillGeneratedFiles(dir = PACKAGE_CARDS_DIR): Record<string, string> {
  const out: Record<string, string> = { 'references/首页语法.md': homeSyntaxDoc(dir), 'references/命令.md': homeCommandsDoc() };
  for (const kind of homeOnly()) out[`references/${kind}.md`] = readCardDoc(kind, dir).md;
  return out;
}

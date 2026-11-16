/**
 * cotutor-home 技能的生成部分:references/ 整个由这里现生成,scripts/gen-skills.ts 写进包根 skills/cotutor-home/,
 * tests/skills.test.ts 断言入库的和生成的一致。首页语法.md 从首页能用的卡(老师卡、听写卡)的 card.md 拼,
 * <kind>.md 是首页专属卡的协议全文,命令.md 从 CLI 用法文本取。SKILL.md 本体(流程、铁律)是手写的。
 */
import { commandsReference } from '../cli/usage.ts';
import { BUTTON_LABEL_MAX, TUTOR_BUTTONS_MAX, kindsFor } from '../../board/cards/index.ts';
import { PACKAGE_CARDS_DIR, readCardDoc } from '../../board/cards/docs.ts';

export const HOME_SKILL = 'cotutor-home';

const EXPECT_RE = /^\s*<!--\s*expect\b.*?-->\s*\n?/gm;
const HOME_COMMANDS = ['home', 'show', 'rate', 'bookkeep'];

/** 首页能用的种类:老师卡、听写卡(2026-11-16 起只有这两种) */
function homeOnly(): string[] {
  return kindsFor('home').map((k) => k.name);
}

export function homeSyntaxDoc(dir = PACKAGE_CARDS_DIR): string {
  const only = homeOnly();
  const own = only.map((kind) => {
    const d = readCardDoc(kind, dir);
    return [`### ${d.headline}`, d.sections['是什么'], d.sections['写法'], d.sections['例子']?.replace(EXPECT_RE, '')].filter((x) => x && x.trim()).join('\n\n');
  });
  return `# 首页怎么写(机器生成,别改)

首页文件是 workspace 的 home/draft.md,和板书同一个解析器:

- **frontmatter**(可选):只认 \`for: YYYY-MM-DD\`(这份是给哪天用的)。
- **围栏 = 卡**:标签第一个词是种类,其余是修饰。卡按文件顺序铺;老师卡永远排在最上面。
- **第一个 \`## \` 起是给家长的**(「## 为什么这么排」),孩子看不到。
- 围栏外的普通行首页不显示(检查会提醒),要给孩子看的写进卡里。

应用保证的:每位孩子端露出的老师都有一张老师卡(没写就补一张);老师家里有预习、检查作业、复习这几个 activity 的,牌上第一行常驻这几块方砖(不用写,家长端能关,不占按钮的名额);每个按钮进去都是新话题,今天聊过的话题孩子在首页「今天」那一行接;没有新话题、开场按钮、接着按钮(话题都从 activity 开始);activity 用不了、课包读不出来的按钮不出现。

老师卡的按钮最多 ${TUTOR_BUTTONS_MAX} 个,每个最多 ${BUTTON_LABEL_MAX} 个字。

## 首页的卡

首页只放两种卡:老师卡和听写卡。别的卡(一段字、点读、图片、田字格、单词、选择题……)都放不了,写了检查报「要改」。

${own.join('\n\n')}

## 一份完整的草稿

\`\`\`\`markdown
---
for: 2026-09-18
---

\`\`\`tutor chinese-tutor
activity 预习 我要预习小蝌蚪找妈妈
范围: 第 22 课 1–3 自然段
讲法: 重点字 塘、脑、袋;读完问他小蝌蚪先遇到了谁
activity 看图说话
\`\`\`

\`\`\`tutor math-tutor
小课堂 2026-09-18-po13-jian-8 13 减 8 怎么拆
讲法: 他常把 13 当成 1 和 3,跨十那一步慢一点
\`\`\`

## 为什么这么排

- 语文:16 号小蝌蚪只读到第 1 段;看图说话第二句卡住,日记观察「句子接不上时会停很久」。
- 数学:近两周观察里两次跨十停顿,计划里写了周五小测。
- 英语老师今天没有要排的,只留方砖。
\`\`\`\`
`;
}

export function homeCommandsDoc(): string {
  return `# 命令(机器生成,别改)

在 workspace 根跑;每条就是 cotutor <命令> --help 的内容。

\`\`\`
${commandsReference(HOME_COMMANDS)}
\`\`\`

## 文件

| 文件 | 是什么 |
|---|---|
| \`home/draft.md\` | 草稿:你写、家长可改;孩子端不读 |
| \`home/published.json\` | 已发布的那份(publish 生成,机器件,别手改);孩子端只读它 |
| \`home/history/<id>.md\` | 每次发布的原文 |
| \`conversations/<老师>/<日期>.json\` | 一天的对话索引;消息的 \`via\` = 从首页哪个按钮进来的(\`{home, button, label}\`) |
`;
}

/** references/ 下的全部文件(相对技能根) */
export function homeSkillGeneratedFiles(dir = PACKAGE_CARDS_DIR): Record<string, string> {
  const out: Record<string, string> = { 'references/首页语法.md': homeSyntaxDoc(dir), 'references/命令.md': homeCommandsDoc() };
  for (const kind of homeOnly()) out[`references/${kind}.md`] = readCardDoc(kind, dir).md;
  return out;
}

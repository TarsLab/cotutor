/**
 * 卡的协议文件:每种能力型卡在包根 cards/<kind>/ 下有 card.md(协议:是什么 / 何时用 / 写法 / 例子 / 反例 /
 * 孩子看到什么 / 你会收回什么 / 状态的形状)与 card.css(这种卡的结构样式,只用主题变量)。
 * md 是可以单独 @ 的文件:init / upgrade 出厂成 workspace 里的**一个技能** .claude/skills/cotutor-board/(2026-09-14 拍板,原来是
 * .cotutor/板书语法.md + .cotutor/cards/):SKILL.md = 语法表(frontmatter + 各 md 的「是什么 / 写法 / 例子」拼),references/<kind>.md 逐张协议,
 * references/README.md 索引;老师按需 @ 单张。写盘的在 cli/skills.ts `writeBoardSkill`。
 * 例子即测试:tests/cards-doc.test.ts 把每个 card.md 里的围栏喂 parseCard,`<!-- expect {…} -->` 注释是期望。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_KINDS } from './index.ts';

/** 本包自带的卡协议目录(仓库检出与 npm 安装都在包根 cards/) */
export const PACKAGE_CARDS_DIR = fileURLToPath(new URL('../../cards/', import.meta.url));

export interface CardDoc {
  kind: string;
  /** 整份 card.md */
  md: string;
  /** 各栏目正文(按 ## 标题切;没有的栏目是空串) */
  sections: Record<string, string>;
  /** 标题行后面那句(「text — 一段字」) */
  headline: string;
}

/** md 按 `## ` 切栏目;`# ` 标题行单独取 */
export function splitSections(md: string): { headline: string; sections: Record<string, string> } {
  const lines = md.split('\n');
  // 标题行 = 第一个 ## 之前的那行 `# …`;栏目里的 `# 认边`(例子围栏里的)照收
  let headline = '';
  const sections: Record<string, string> = {};
  let cur: string | null = null;
  const buf: string[] = [];
  const flush = (): void => {
    if (cur !== null) sections[cur] = buf.join('\n').trim();
    buf.length = 0;
  };
  for (const l of lines) {
    if (l.startsWith('## ')) {
      flush();
      cur = l.slice(3).trim();
    } else if (cur === null) {
      if (!headline && l.startsWith('# ')) headline = l.slice(2).trim();
    } else buf.push(l);
  }
  flush();
  return { headline, sections };
}

export function readCardDoc(kind: string, dir = PACKAGE_CARDS_DIR): CardDoc {
  const md = readFileSync(join(dir, kind, 'card.md'), 'utf8');
  const { headline, sections } = splitSections(md);
  return { kind, md, sections, headline };
}

/** 全部(按注册表的顺序) */
export function cardDocs(dir = PACKAGE_CARDS_DIR): CardDoc[] {
  return CARD_KINDS.map((k) => readCardDoc(k.name, dir));
}

/** 例子里的 `<!-- expect {…} -->` 注释:给老师看的版本要去掉 */
const EXPECT_RE = /^\s*<!--\s*expect\b.*?-->\s*\n?/gm;

/** 给老师看的语法表(SKILL.md 的正文):从各 card.md 的「是什么 / 写法 / 例子」拼,不手写 */
export function boardSyntaxDoc(dir = PACKAGE_CARDS_DIR): string {
  const kinds = cardDocs(dir)
    .map((d) => {
      const parts = [`### ${d.headline}`, d.sections['是什么'], d.sections['写法'], d.sections['例子']?.replace(EXPECT_RE, '')].filter((x) => x && x.trim());
      return parts.join('\n\n').trim();
    })
    .join('\n\n');
  return `# 板书怎么写

回复正文就是孩子看到的板书,只有两种东西:

- **普通段落 = 你说的话。** 一行一句,每句会被念出来、显示在字幕行,所以不要写标题、列表、粗体、括号注释。想强调某个词,用方括号标出来(如「这叫[底]」,那个词要在某张卡上出现);不标也行,后期会挑。末句写成问句就停下等孩子。
- **围栏 = 板上的卡。** 围栏的语言标签是卡的种类;正文按各种卡的写法。卡写在讲它的那句话前面,卡与话交错。卡上是**名词**(定义、公式、题、图、选项),讲稿是**动词**(你说的话);别把一句话切成一张卡。不认识的标签当代码卡原样显示;正文写得不对的卡退成一段文字,孩子端不会报错。

一节 3–5 张卡、6–12 句话,一张卡至少能指着讲三句;一次只讲一个想法,讲完就问。随口问答就一两句话,没有卡。**板书写完就停**:最后一个字是问孩子的那句,后面不要再补总结、不要再用工具——孩子看到的是你这轮最后一段话,再补一句板书就丢了。

孩子在卡上做的事(选了、填了、画了)会在下一条消息的上下文包里以 \`cards:\` 段告诉你,一张卡一行(卡的编号、种类、标题、做了什么、答案);孩子只交答案没说话时消息正文是「(交了答案,没说话)」。孩子看到的卡上没有对错,对错由你口头说。上下文包里 \`focus.card\` 是孩子发消息时正开着的那张卡。每种卡完整的协议(何时用、别用、反例、你会收回什么)在本技能目录下的 references/<种类>.md,索引在 references/README.md。

板书到第一个「## 」为止,后面的孩子看不到。

## 一节长什么样

讲三角形面积的第一节(卡与话交错,卡在讲它的那句前面,最后一句是问孩子的):

\`\`\`\`
我们拿两个一样的三角形拼一拼。

\`\`\`text
# 拼
把两个一样的三角形倒过来拼在一起,得到一个平行四边形
\`\`\`

两个一样的三角形一拼,就是一个[平行四边形],它的底和高没变。

\`\`\`text formula
三角形面积 = 底 × 高 ÷ 2
\`\`\`

所以三角形的面积就是[底]乘[高],再除以 2。

\`\`\`choice
底 6 厘米、高 4 厘米的三角形,面积是多少?
- [ ] 24 平方厘米
- [x] 12 平方厘米
- [ ] 10 平方厘米
\`\`\`

你来算算:底 6 厘米、高 4 厘米,面积是多少?
\`\`\`\`

## 作业照片(上下文包里有 photos: 时)

照片路径相对 workspace 根;从你的 cwd(agents/<你>/)Read 要加 \`../../\`。先看图,认出是哪本、哪页、哪道题、卡在哪,讲稿第一句就说出来。第一张卡用 \`image\` 引原图(路径照 photos: 原样写)或 \`text\` 抄题面;一页好几道就用 \`choice\` 列题号问讲哪道,一次只讲一道;要孩子在作业上圈、写,用 \`canvas\`、第一行写照片路径。拍糊了、拍不全、认不出,讲稿里请孩子再拍一张或指一下。

## 卡的种类

${kinds}
`;
}

/** references/README.md:一行一种——名字、一句是什么、何时用;老师按需 @ 单张 */
export function cardsIndexDoc(dir = PACKAGE_CARDS_DIR): string {
  const rows = cardDocs(dir).map((d) => {
    const what = (d.sections['是什么'] ?? '').split('\n').find((l) => l.trim()) ?? '';
    const when = (d.sections['什么时候用 / 别用'] ?? '').split('\n').filter((l) => l.startsWith('- 用:')).map((l) => l.slice(4).trim()).join(';');
    return `- **${d.kind}**(${d.kind}.md)—— ${what}${when ? `\n  用在:${when}` : ''}`;
  });
  return `# 卡的种类(索引)

每种卡一份协议:是什么、什么时候用 / 别用、写法、例子、反例、孩子看到什么、你会收回什么、状态的形状。讲解前只读需要的那一两张;总表在 ../SKILL.md。机器文件,init / upgrade 刷新。

${rows.join('\n')}
`;
}

/** 技能名;目录 .claude/skills/cotutor-board/,Qwen 那边 .qwen/skills/cotutor-board 是相对链 */
export const BOARD_SKILL = 'cotutor-board';

/** SKILL.md:frontmatter(两 CLI 都只认 name / description)+ 语法表;description 列出卡的种类,让模型不读正文也知道有哪几种 */
export function boardSkillDoc(dir = PACKAGE_CARDS_DIR): string {
  const kinds = CARD_KINDS.map((k) => k.name).join(' / ');
  const description = `cotutor 的板书怎么写:回复正文就是孩子看到的板书,普通段落是讲稿(一行一句,会被念出来)、围栏是卡(标签 = 种类:${kinds}),各种卡的写法与例子都在这里。给孩子讲解、要出卡之前读一遍;每种卡完整的协议(何时用、别用、反例、你会收回什么)在 references/<种类>.md。含作业照片怎么接、一节的完整例子。不是:一道题怎么画成一步步的动画(那是画图老师的 drawtell-teaching / drawtell-scene)、vault 怎么读(→ cotutor-vault)。机器文件,从卡的注册表生成,cotutor init / upgrade 刷新,别改。`;
  return `---\nname: ${BOARD_SKILL}\ndescription: ${description}\n---\n\n${boardSyntaxDoc(dir)}`;
}

/** 技能目录的全部文件(相对技能根):SKILL.md + references/README.md + references/<kind>.md;scripts/gen-skills.ts 写进包根 skills/cotutor-board/,tests/skills.test.ts 断言入库的和它一致 */
export function boardSkillFiles(dir = PACKAGE_CARDS_DIR): Record<string, string> {
  const out: Record<string, string> = { 'SKILL.md': boardSkillDoc(dir), 'references/README.md': cardsIndexDoc(dir) };
  for (const d of cardDocs(dir)) out[`references/${d.kind}.md`] = d.md;
  return out;
}

/** 各种卡的结构样式(cards/<kind>/card.css)拼成一段,放在主题 css 前面(主题能盖) */
export function cardsCss(dir = PACKAGE_CARDS_DIR): string {
  return CARD_KINDS.map((k) => {
    try {
      return `/* ---- ${k.name}(cards/${k.name}/card.css)---- */\n${readFileSync(join(dir, k.name, 'card.css'), 'utf8').trim()}`;
    } catch {
      return '';
    }
  })
    .filter(Boolean)
    .join('\n\n');
}

/** 例子即测试用:md 里每个围栏 + 它前面的 expect 注释 */
export function docExamples(md: string): { tag: string; body: string; expect: Record<string, unknown> | null }[] {
  const out: { tag: string; body: string; expect: Record<string, unknown> | null }[] = [];
  const lines = md.split('\n');
  let expect: Record<string, unknown> | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const ex = /^<!--\s*expect\s+(\{.*\})\s*-->$/.exec(l.trim());
    if (ex) {
      expect = JSON.parse(ex[1]) as Record<string, unknown>;
      continue;
    }
    const open = /^```(.*)$/.exec(l);
    if (open && !l.startsWith('````')) {
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && !/^```\s*$/.test(lines[j]); j++) body.push(lines[j]);
      out.push({ tag: open[1].trim(), body: body.join('\n'), expect });
      expect = null;
      i = j;
    }
  }
  return out;
}

/**
 * 卡的协议文件(《卡片重设计评估.md》§三 D):每种能力型卡在包根 cards/<kind>/ 下有 card.md(协议:是什么 / 何时用 / 写法 / 例子 / 反例 /
 * 孩子看到什么 / 你会收回什么 / 状态的形状)与 card.css(这种卡的结构样式,只用主题变量)。
 * md 是可以单独 @ 的文件:init / upgrade 逐张出厂到 workspace 的 .cotutor/cards/<kind>.md + README.md(索引),
 * 老师文件与 skill 只引需要的那一两张;.cotutor/板书语法.md 仍从这些 md 的「是什么 / 写法 / 例子」拼(路径不变)。
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

/** 给老师看的语法表(出厂到 workspace 的 .cotutor/板书语法.md):从各 card.md 的「是什么 / 写法 / 例子」拼,不手写 */
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

孩子在卡上做的事(选了、填了、画了)会在下一条消息的上下文包里以 \`cards:\` 段告诉你,一张卡一行(卡的编号、种类、标题、做了什么、答案);孩子只交答案没说话时消息正文是「(交了答案,没说话)」。孩子看到的卡上没有对错,对错由你口头说。上下文包里 \`focus.card\` 是孩子发消息时正开着的那张卡。每种卡完整的协议(何时用、别用、反例、你会收回什么)在 .cotutor/cards/<种类>.md,索引在 .cotutor/cards/README.md。

对家长说的话、要拍板的事、要转交的事,用「## 家长」「## 待裁量」(question: 一句话;options: 列表)「## 转交」三个段放在正文末尾,孩子看不到;板书到第一个「## 」为止。

## 卡的种类

${kinds}
`;
}

/** .cotutor/cards/README.md:一行一种——名字、一句是什么、何时用;老师与 skill 按需 @ 单张 */
export function cardsIndexDoc(dir = PACKAGE_CARDS_DIR): string {
  const rows = cardDocs(dir).map((d) => {
    const what = (d.sections['是什么'] ?? '').split('\n').find((l) => l.trim()) ?? '';
    const when = (d.sections['什么时候用 / 别用'] ?? '').split('\n').filter((l) => l.startsWith('- 用:')).map((l) => l.slice(4).trim()).join(';');
    return `- **${d.kind}**(${d.kind}.md)—— ${what}${when ? `\n  用在:${when}` : ''}`;
  });
  return `# 卡的种类(索引)

每种卡一份协议:是什么、什么时候用 / 别用、写法、例子、反例、孩子看到什么、你会收回什么、状态的形状。讲解前只读需要的那一两张;总表在 ../板书语法.md。机器文件,init / upgrade 刷新。

${rows.join('\n')}
`;
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

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
import { CARD_KINDS, kindsFor, type CardPlace } from './index.ts';
import { stripHumanNotes } from '../lib/human-notes.ts';

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

/** 能用在某处的种类的协议(按注册表的顺序);缺省板书——cotutor-board 技能只列这些 */
export function cardDocs(dir = PACKAGE_CARDS_DIR, place: CardPlace = 'board'): CardDoc[] {
  return kindsFor(place).map((k) => readCardDoc(k.name, dir));
}

/** 例子里的 `<!-- expect {…} -->` 注释:给老师看的版本要去掉 */
const EXPECT_RE = /^\s*<!--\s*expect\b.*?-->\s*\n?/gm;

/** 板书写法的手写部分(开头的规矩、一节的例子、作业照片),人改的就是这一篇;`{{卡的种类}}` 那一行由下面拼的各种卡替换 */
export const BOARD_GUIDE_SOURCE = '板书怎么写.md';
const KINDS_SLOT = /^\{\{卡的种类\}\}$/m;

/** 给老师看的语法表(SKILL.md 的正文):cards/板书怎么写.md(剥掉给人看的注释)+ 各 card.md 的「是什么 / 写法 / 例子」 */
export function boardSyntaxDoc(dir = PACKAGE_CARDS_DIR): string {
  const kinds = cardDocs(dir)
    .map((d) => {
      const parts = [`### ${d.headline}`, d.sections['是什么'], d.sections['写法'], d.sections['例子']?.replace(EXPECT_RE, '')].filter((x) => x && x.trim());
      return parts.join('\n\n').trim();
    })
    .join('\n\n');
  const guide = stripHumanNotes(readFileSync(join(dir, BOARD_GUIDE_SOURCE), 'utf8'));
  if (!KINDS_SLOT.test(guide)) throw new Error(`cards/${BOARD_GUIDE_SOURCE} 里没有「{{卡的种类}}」那一行`);
  return `${guide.replace(KINDS_SLOT, () => kinds)}\n`;
}

/** references/README.md:一行一种——名字、一句是什么、何时用;老师按需 @ 单张 */
export function cardsIndexDoc(dir = PACKAGE_CARDS_DIR): string {
  const rows = cardDocs(dir).map((d) => {
    const what = (d.sections['是什么'] ?? '').split('\n').find((l) => l.trim()) ?? '';
    const when = (d.sections['什么时候用 / 别用'] ?? '').split('\n').filter((l) => l.startsWith('- 用:')).map((l) => `\n  - 用在:${l.slice(4).trim()}`).join('');
    return `- **${d.kind}**(${d.kind}.md)—— ${what}${when}`;
  });
  return `# 卡的种类(索引)

每种卡一份协议:是什么、什么时候用 / 别用、写法、例子、反例、孩子看到什么、你会收回什么、状态的形状。讲解前只读需要的那一两张;总表在 ../SKILL.md。机器文件,init / upgrade 刷新。

${rows.join('\n')}
`;
}

/** 技能名;目录 .claude/skills/cotutor-board/,Qwen 那边 .qwen/skills/cotutor-board 是相对链 */
export const BOARD_SKILL = 'cotutor-board';

/** SKILL.md:frontmatter(两 CLI 都认 name / description;disable-model-invocation 只有 claude 认)+ 语法表;description 列出卡的种类,让模型不读正文也知道有哪几种 */
export function boardSkillDoc(dir = PACKAGE_CARDS_DIR): string {
  const kinds = kindsFor('board').map((k) => k.name).join(' / ');
  const description = `cotutor 的板书怎么写:讲稿一行一句,围栏是卡(种类:${kinds})。应用已经递给老师,老师不用读;家长查阅用。每种卡完整的协议在 references/<种类>.md。机器生成,源在 cotutor 仓的 cards/,别在这里改。`;
  // disable-model-invocation:claude 不再主动用 Skill 工具调它(正文由应用递,再调一次就是白跑一个来回);家长仍可手动 /cotutor-board;别的 CLI 不认这个键,无害
  return `---\nname: ${BOARD_SKILL}\ndescription: ${description}\ndisable-model-invocation: true\n---\n\n${boardSyntaxDoc(dir)}`;
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

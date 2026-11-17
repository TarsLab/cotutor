/**
 * 卡的协议文件:首页的两种卡(老师牌、听写牌)在包根 cards/<kind>/ 下有 card.md(协议)与 card.css(结构样式,只用主题变量);
 * 首页技能 cotutor-home 的 references 由它拼(src/app/skills/home-doc.ts)。例子即测试:tests/cards-doc.test.ts 把每个 card.md 里的围栏喂 parseCard。
 * 还有给老师的一篇:cards/动作怎么写.md(讲稿与动作,铺着页的一节课的写法)进系统提示(actsGuide)。
 * 2026-11-17 起课里没有卡:板书写法、cotutor-board 技能、课里的那八种卡的协议删了。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_KINDS } from './index.ts';
import { stripHumanNotes } from '../../shared/human-notes.ts';

/** 本包自带的卡协议目录(仓库检出与 npm 安装都在包根 cards/) */
export const PACKAGE_CARDS_DIR = fileURLToPath(new URL('../../../cards/', import.meta.url));

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

/** 讲稿怎么写、老师对页做什么写在讲稿的句子后面(src/board/acts.ts):这一篇进系统提示(2026-11-17 起代替板书写法) */
export const ACTS_GUIDE_SOURCE = '动作怎么写.md';
export function actsGuide(dir = PACKAGE_CARDS_DIR): string {
  return stripHumanNotes(readFileSync(join(dir, ACTS_GUIDE_SOURCE), 'utf8')).trim();
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

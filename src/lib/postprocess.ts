/**
 * 板书后期(《卡片重设计评估.md》§五 §六):一节跑完,快模型拿卡 + 讲稿 + 端 + 主题清单,出 {marks, anchors, layout, look}。
 * 老师决定什么上板、什么要孩子做、答案是什么;后期决定长什么样、放哪、标哪;主题决定取值;渲染器按端折行。
 * 这里全是纯函数:拼提示词、解析输出、**校验**(模型只是提案,契约说了算:词不在卡上、卡号越界、笔名不认识、槽名不在清单、
 * 超配额、行没盖住全部卡——一律丢,丢了什么记进 dropped)。校验不过的部分就当没有,页面走机械规则(tintFor / penFor / rowsFor)。
 * 起进程、落盘在 src/server/post.ts。
 */
import { z } from 'zod';
import { cardTexts, findPhrase, hasState, isHeading, PENS, type BoardCard, type BoardLine, type BoardSection, type Device, type PenName } from './kid-board.ts';
import type { ThemeManifest } from '../schema/theme.ts';

export const PostOutputSchema = z.object({
  marks: z.array(z.object({ line: z.number().int().nonnegative(), card: z.number().int().nonnegative(), phrase: z.string().min(1), pen: z.string().min(1) })).default([]),
  anchors: z.array(z.object({ line: z.number().int().nonnegative(), card: z.number().int().nonnegative() })).default([]),
  layout: z.object({ rows: z.array(z.array(z.number().int().nonnegative())) }).nullable().optional(),
  look: z.record(z.string(), z.object({ tint: z.string().optional(), look: z.string().optional(), emoji: z.string().optional() })).default({}),
});
export type PostOutput = z.infer<typeof PostOutputSchema>;

export const MAX_MARKS_PER_LINE = 2;
export const MAX_MARKS_PER_CARD = 3;
export const MAX_CARDS_PER_ROW = 3;

const DEVICE_NOTE: Record<Device, string> = {
  phone: '手机竖屏,很窄:一行一张为主,只有两张都很短(各不到 20 字、没有选项)的卡才并排',
  'tablet-portrait': '平板竖屏:一行可以两张(兄弟卡并排:两种情况、公式和它所属的那一步),长卡独占一行',
  'tablet-landscape': '平板横屏,很宽:一行可以两三张(兄弟卡并排:两种情况、公式和它所属的那一步、三步搞懂),别浪费宽度,也别把不相干的硬凑一行',
};

function cardLine(c: BoardCard, i: number): string {
  const p = c.props || {};
  const tag = isHeading(c) ? '小节标题行(不算卡,不能标注,独占一行)' : hasState(c) || c.kind === 'scene' ? '有交互,独占一行' : '';
  const title = typeof p.title === 'string' && p.title && !isHeading(c) ? `标题「${p.title}」;` : '';
  const texts = isHeading(c) ? String(p.title ?? '') : cardTexts(c).filter((t) => t.trim()).join(' / ');
  return `${i}. ${c.kind}${tag ? `(${tag})` : ''}:${title}${texts.replace(/\s+/g, ' ').slice(0, 200)}`;
}

function lineLine(l: BoardLine, i: number): string {
  const mine = l.marks.length ? ` ★老师已标:${l.marks.map((m) => `「${m.phrase}」(卡 ${m.card})`).join('')}` : '';
  return `${i}. ${l.text}${l.anchor !== null ? `(默认讲卡 ${l.anchor})` : ''}${mine}`;
}

/** 提示词:规则 + 槽表(从主题清单现拼)+ 卡 + 讲稿 + 端 + 输出形状;换主题不用改提示词 */
export function postPrompt(section: BoardSection, device: Device, theme: ThemeManifest): string {
  const slots = (t: Record<string, { use: string }>): string => Object.entries(t).map(([k, v]) => `- ${k}:${v.use}`).join('\n');
  const pens = Object.keys(theme.pens).length ? theme.pens : Object.fromEntries(PENS.map((p) => [p, { use: p }]));
  return `你是一节板书的后期(排版与划重点),不是老师。老师已经决定了卡上写什么、讲稿说什么、答案是什么;你只决定:讲到每句时在哪张卡上标哪个词、用哪支笔;每张卡用哪个底色槽 / 字形槽、要不要一个 emoji;哪几张卡并排成一行。只输出一个 JSON 对象,不要解释,不要 markdown 围栏。

## 端
这节要在 ${device} 上看:${DEVICE_NOTE[device]}。

## 底色槽 tint(缺省 ${theme.default};一张卡一个)
${slots(theme.tints)}

## 字形槽 look(不写 = 缺省)
${slots(theme.looks)}

## 笔 pen
${slots(pens)}

## 规则
- marks:一句最多 ${MAX_MARKS_PER_LINE} 处,一张卡整节最多 ${MAX_MARKS_PER_CARD} 处;phrase 必须**逐字**出现在那张卡的文字里(不是讲稿里),数字与拉丁词要整个词;老师自己标过的(★)不要再标,也不要标封面标题和整句。
- anchors:讲稿一句默认讲它前面最近的那张卡;只有明显在讲别的卡(回头讲公式、总结时指结论卡)才写。
- layout.rows:每张卡恰好出现一次、顺序不变、一行最多 ${MAX_CARDS_PER_ROW} 张;标题行与有交互的卡独占一行。
- look:只给需要的卡;emoji 只给要记住的那一两张,一个字符。

## 卡
${section.cards.map(cardLine).join('\n')}

## 讲稿
${section.lines.map(lineLine).join('\n')}

## 输出(只这一个 JSON)
{"marks":[{"line":0,"card":0,"phrase":"…","pen":"tint"}],"anchors":[{"line":3,"card":1}],"layout":{"rows":[[0],[1,2],[3]]},"look":{"0":{"tint":"sky","look":"plain","emoji":"📐"}}}`;
}

export type ParsedPost = { ok: true; out: PostOutput } | { ok: false; why: string };

/** 模型的原文 → 输出:取第一个 { 到最后一个 } 之间当 JSON(模型偶尔会包围栏或多一句话);过 zod */
export function parsePost(raw: string): ParsedPost {
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return { ok: false, why: '输出里没有 JSON 对象' };
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(a, b + 1));
  } catch (err) {
    return { ok: false, why: `JSON 解析不了:${err instanceof Error ? err.message : String(err)}` };
  }
  const r = PostOutputSchema.safeParse(obj);
  if (!r.success) return { ok: false, why: r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join(';') };
  return { ok: true, out: r.data };
}

export interface ValidatedPost {
  section: BoardSection;
  /** 丢掉的提案,一条一句人话 */
  dropped: string[];
  /** 收下了多少:标注 / 锚点 / 行 / 样子 */
  kept: { marks: number; anchors: number; layout: boolean; looks: number };
}

const isPen = (p: string): p is PenName => (PENS as readonly string[]).includes(p);
const emojiOk = (e: string): boolean => Array.from(e).length <= 2 && !/[A-Za-z0-9\s]/.test(e);

/**
 * 校验并套用:老师自己写的标注一律保留(它们没有 pen,页面按机械规则选笔);模型的标注加在后面,带 pen。
 * 行没盖住全部卡 / 顺序变了 / 一行超 3 张 → 整个 layout 不要(页面一行一张);标题行与有交互的卡即使被并排,rowsFor 也会拆出来。
 */
export function validatePost(section: BoardSection, theme: ThemeManifest, device: Device, out: PostOutput): ValidatedPost {
  const dropped: string[] = [];
  const cards = section.cards;
  const lines = section.lines.map((l) => ({ ...l, marks: [...l.marks] }));
  const perCard = new Map<number, number>();
  for (const l of lines) for (const m of l.marks) perCard.set(m.card, (perCard.get(m.card) ?? 0) + 1);
  let marksKept = 0;
  for (const m of out.marks) {
    const where = `第 ${m.line + 1} 句「${m.phrase}」→ 卡 ${m.card}`;
    const line = lines[m.line];
    const card = cards[m.card];
    if (!line) { dropped.push(`${where}:没有这句`); continue; }
    if (!card || isHeading(card)) { dropped.push(`${where}:没有这张卡(或是标题行)`); continue; }
    if (!cardTexts(card).some((t) => findPhrase(t, m.phrase) >= 0)) { dropped.push(`${where}:这个词不在卡上`); continue; }
    if (!isPen(m.pen)) { dropped.push(`${where}:不认识的笔 ${m.pen}`); continue; }
    if (line.marks.some((x) => x.card === m.card && x.phrase === m.phrase)) { dropped.push(`${where}:老师已经标过`); continue; }
    if (line.marks.length >= MAX_MARKS_PER_LINE) { dropped.push(`${where}:这句已有 ${MAX_MARKS_PER_LINE} 处`); continue; }
    if ((perCard.get(m.card) ?? 0) >= MAX_MARKS_PER_CARD) { dropped.push(`${where}:这张卡已有 ${MAX_MARKS_PER_CARD} 处`); continue; }
    line.marks.push({ card: m.card, phrase: m.phrase, pen: m.pen });
    perCard.set(m.card, (perCard.get(m.card) ?? 0) + 1);
    marksKept++;
  }
  let anchorsKept = 0;
  for (const a of out.anchors) {
    const line = lines[a.line];
    const card = cards[a.card];
    if (!line || !card || isHeading(card)) { dropped.push(`锚点 第 ${a.line + 1} 句 → 卡 ${a.card}:没有这句或这张卡`); continue; }
    if (line.anchor !== a.card) { line.anchor = a.card; anchorsKept++; }
  }
  let layout: BoardSection['layout'] | undefined;
  if (out.layout && out.layout.rows.length) {
    const flat = out.layout.rows.flat();
    const inOrder = flat.length === cards.length && flat.every((v, i) => v === i);
    const rowOk = out.layout.rows.every((r) => r.length >= 1 && r.length <= MAX_CARDS_PER_ROW);
    if (!inOrder) dropped.push(`排版:行没有恰好盖住 ${cards.length} 张卡各一次(或顺序变了),整个不要`);
    else if (!rowOk) dropped.push(`排版:有一行超过 ${MAX_CARDS_PER_ROW} 张(或空行),整个不要`);
    else layout = { for: device, rows: out.layout.rows.map((r) => [...r]) };
  }
  const newCards = cards.map((c) => ({ ...c }));
  let looksKept = 0;
  for (const [k, v] of Object.entries(out.look)) {
    const i = Number(k);
    const card = newCards[i];
    if (!Number.isInteger(i) || !card || isHeading(card)) { dropped.push(`样子 卡 ${k}:没有这张卡(或是标题行)`); continue; }
    const look: NonNullable<BoardCard['look']> = {};
    if (v.tint !== undefined) {
      if (v.tint in theme.tints) look.tint = v.tint;
      else dropped.push(`样子 卡 ${k}:底色槽 ${v.tint} 不在主题里,落回 ${theme.default}`);
    }
    if (v.look !== undefined) {
      if (v.look in theme.looks) look.look = v.look;
      else dropped.push(`样子 卡 ${k}:字形槽 ${v.look} 不在主题里`);
    }
    if (v.emoji !== undefined) {
      if (emojiOk(v.emoji)) look.emoji = v.emoji;
      else dropped.push(`样子 卡 ${k}:emoji 不像一个 emoji(${v.emoji})`);
    }
    if (Object.keys(look).length) {
      card.look = { ...(card.look ?? {}), ...look };
      looksKept++;
    }
  }
  return {
    section: { ...section, cards: newCards, lines, ...(layout ? { layout } : {}) },
    dropped,
    kept: { marks: marksKept, anchors: anchorsKept, layout: Boolean(layout), looks: looksKept },
  };
}

/** 后期没来(关了 / 超时 / 坏了):素版——什么都不改,页面走机械规则 */
export function fallbackPost(section: BoardSection): BoardSection {
  return section;
}

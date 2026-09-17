/**
 * 板书后期(《卡片重设计评估.md》§五 §六;2026-09-13 起按拍,《工作流程.md》§三):一拍 = 一张卡 + 跟着它的讲稿句,拍关了就让快模型
 * 拿这拍的卡 + 讲稿、前面 3–5 张已定的卡(只读)、端、主题槽表,出 {row, look, marks, anchors}——这张卡接上一行还是另起一行、
 * 用哪个底色 / 字形 / emoji、讲到每句时在卡上标哪个词(said = 讲稿里念到的词)、哪句其实在讲前面的卡。
 * 老师决定什么上板、什么要孩子做、答案是什么;后期决定长什么样、放哪、标哪;主题决定取值;渲染器按端折行。
 *
 * 提示词的骨架是主题的 post.md(themes/<主题>/post.md,和 kid.css 同一套:出厂 / 拷贝 / hash / upgrade / 按 mtime 现读),任何一句都能改;
 * 占位符是代码生成的部分(HTML 方言,src/lib/post-html.ts):{board} 这一拍与前文、{marked} 已标的词、{patch} 要回的补丁、{rules} 与校验器同源,{tints} {looks} {pens} {defaultTint} 从槽表拼。
 * 缺必需占位符 → 整份退 POST_TEMPLATE_FALLBACK(= POST_TEMPLATE_HTML,与包里 themes/default/post.md 同文)。
 *
 * 这里全是纯函数:拼提示词、解析输出、**校验**(模型只是提案,契约说了算:词不在卡上、said 不在讲稿里、卡号越界、笔名不认识、
 * 槽名不在清单、超配额、并排会超 3 张或碰上独占的卡——一律丢,丢了什么记进 dropped)。校验不过的部分就当没有,页面走机械规则。
 * 整节一次的 validatePost 保留:把整节提案拆成各拍再走同一个校验器(mock 的写死提案、repost 都走它)。起进程、落盘在 src/server/post.ts。
 */
import { z } from 'zod';
import { beatsOf, cardTexts, findPhrase, hasState, isHeading, PENS, plainLine, type Beat, type BoardCard, type BoardMark, type BoardSection, type Device, type PenName } from './kid-board.ts';
import type { ThemeManifest } from '../schema/theme.ts';
import { POST_TEMPLATE_HTML, boardHtml, htmlRulesBlock, markedBlock, patchBlock } from './post-html.ts';

const LookSchema = z.object({ tint: z.string().optional(), look: z.string().optional(), emoji: z.string().optional() });

/** 一拍的提案(parseBeatPatch 从模型的补丁解析出来):line 是拍内下标(0 起);card 缺省 = 这拍的卡,写了只能是前面已定的卡 */
export const BeatPostOutputSchema = z.object({
  row: z.enum(['same', 'new']).default('new'),
  look: LookSchema.nullable().optional(),
  marks: z.array(z.object({ line: z.number().int().nonnegative(), card: z.number().int().nonnegative().optional(), phrase: z.string().min(1), pen: z.string().min(1), said: z.string().optional() })).default([]),
  anchors: z.array(z.object({ line: z.number().int().nonnegative(), card: z.number().int().nonnegative() })).default([]),
});
export type BeatPostOutput = z.infer<typeof BeatPostOutputSchema>;

/** 整节一次的提案(mock 的写死提案):line / card 都是节内下标 */
export const PostOutputSchema = z.object({
  marks: z.array(z.object({ line: z.number().int().nonnegative(), card: z.number().int().nonnegative(), phrase: z.string().min(1), pen: z.string().min(1), said: z.string().optional() })).default([]),
  anchors: z.array(z.object({ line: z.number().int().nonnegative(), card: z.number().int().nonnegative() })).default([]),
  layout: z.object({ rows: z.array(z.array(z.number().int().nonnegative())) }).nullable().optional(),
  look: z.record(z.string(), LookSchema).default({}),
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

/** 独占一行的卡:标题行、有交互的、场景 */
export function standsAlone(card: BoardCard): boolean {
  return isHeading(card) || hasState(card) || card.kind === 'scene';
}

const slots = (t: Record<string, { use: string }>): string => Object.entries(t).map(([k, v]) => `- ${k}:${v.use}`).join('\n');

/** 出厂骨架(与包里 themes/default/post.md 同文;主题的文件读不到 / 缺必需占位符时用它)。2026-09-14 晚拍板:HTML 方言 */
export const POST_TEMPLATE_FALLBACK = POST_TEMPLATE_HTML;

/** 骨架必需的占位符({marked} 可选) */
export const REQUIRED_SLOTS = ['board', 'rules', 'patch'] as const;

/** 骨架里缺的必需占位符;空 = 能用 */
export function missingSlots(template: string): string[] {
  return REQUIRED_SLOTS.filter((s) => !template.includes(`{${s}}`));
}

/** 骨架 + 各段 → 提示词;不认识的 {名} 原样留着 */
export function renderPostPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (m, k: string) => (k in values ? values[k] : m));
}

/** 一拍的提示词:骨架取主题的 post.md(template),缺必需占位符退出厂骨架 */
export function beatPrompt(section: BoardSection, beat: Beat, device: Device, theme: ThemeManifest, template?: string | null): string {
  const tpl = template && !missingSlots(template).length ? template : POST_TEMPLATE_FALLBACK;
  const pens = Object.keys(theme.pens).length ? theme.pens : Object.fromEntries(PENS.map((p) => [p, { use: p }]));
  return renderPostPrompt(tpl, {
    device: `这节要在 ${device} 上看:${DEVICE_NOTE[device]}。`,
    defaultTint: theme.default,
    tints: slots(theme.tints),
    looks: slots(theme.looks),
    pens: slots(pens),
    rules: htmlRulesBlock({ perLine: MAX_MARKS_PER_LINE, perCard: MAX_MARKS_PER_CARD, perRow: MAX_CARDS_PER_ROW }),
    board: boardHtml(section, beat),
    marked: markedBlock(section, beat),
    patch: patchBlock(beat.card),
  });
}

export type ParsedPost<T> = { ok: true; out: T } | { ok: false; why: string };

export interface BeatKept {
  marks: number;
  anchors: number;
  look: boolean;
  row: 'same' | 'new';
}
export interface ValidatedBeat {
  section: BoardSection;
  dropped: string[];
  kept: BeatKept;
}

const isPen = (p: string): p is PenName => (PENS as readonly string[]).includes(p);
const emojiOk = (e: string): boolean => Array.from(e).length <= 2 && !/[A-Za-z0-9\s]/.test(e);

/**
 * 校验并套用一拍的提案(纯函数,返回新节):
 * - 标注加在老师的后面(老师的没 pen);词要在卡上、said 要在讲稿里、配额不超、老师没标过
 * - 锚点只能指前面已定的卡
 * - 样子:槽名在主题里才收;emoji 要像一个 emoji
 * - 行:same 接上一行,前提是上一行还有位、两边都不是独占的卡;不行就 new。行永远有(素版的拍 = 另起一行),所以 layout 每拍都在长
 */
export function validateBeatPost(section: BoardSection, beat: Beat, theme: ThemeManifest, device: Device, out: BeatPostOutput): ValidatedBeat {
  const dropped: string[] = [];
  const cards = section.cards.map((c) => ({ ...c }));
  const lines = section.lines.map((l) => ({ ...l, marks: [...l.marks] }));
  const bc = beat.card;
  const tag = bc === null ? '这拍(没有卡)' : `卡 ${bc}`;
  const perCard = new Map<number, number>();
  for (const l of lines) for (const m of l.marks) perCard.set(m.card, (perCard.get(m.card) ?? 0) + 1);
  let marksKept = 0;
  for (const m of out.marks) {
    const li = beat.lines[m.line];
    const ci = m.card ?? bc;
    const where = `${tag} 第 ${m.line + 1} 句「${m.phrase}」→ 卡 ${ci}`;
    const line = li === undefined ? undefined : lines[li];
    const card = ci === null ? undefined : cards[ci];
    if (!line) { dropped.push(`${where}:这拍没有这句`); continue; }
    if (ci === null || !card || isHeading(card)) { dropped.push(`${where}:没有这张卡(或是标题行)`); continue; }
    if (bc !== null && ci > bc) { dropped.push(`${where}:只能标这拍的卡或前面已定的卡`); continue; }
    if (!cardTexts(card).some((t) => findPhrase(t, m.phrase) >= 0)) { dropped.push(`${where}:这个词不在卡上`); continue; }
    if (!isPen(m.pen)) { dropped.push(`${where}:不认识的笔 ${m.pen}`); continue; }
    if (lines.some((x) => x.marks.some((y) => y.card === ci && y.phrase === m.phrase))) { dropped.push(`${where}:${line.marks.some((y) => y.card === ci && y.phrase === m.phrase) ? '老师已经标过' : '这个词在这张卡上已经标过'}`); continue; }
    if (line.marks.length >= MAX_MARKS_PER_LINE) { dropped.push(`${where}:这句已有 ${MAX_MARKS_PER_LINE} 处`); continue; }
    if ((perCard.get(ci) ?? 0) >= MAX_MARKS_PER_CARD) { dropped.push(`${where}:这张卡已有 ${MAX_MARKS_PER_CARD} 处`); continue; }
    const kept: BoardMark = { card: ci, phrase: m.phrase, pen: m.pen };
    if (m.said) {
      if (findPhrase(plainLine(line.text), m.said) >= 0) kept.said = m.said;
      else dropped.push(`${where}:said「${m.said}」不在这句讲稿里,只丢 said(标注留下,句首就画)`);
    }
    line.marks.push(kept);
    perCard.set(ci, (perCard.get(ci) ?? 0) + 1);
    marksKept++;
  }
  let anchorsKept = 0;
  for (const a of out.anchors) {
    const li = beat.lines[a.line];
    const line = li === undefined ? undefined : lines[li];
    const card = cards[a.card];
    if (!line || !card || isHeading(card)) { dropped.push(`锚点 ${tag} 第 ${a.line + 1} 句 → 卡 ${a.card}:没有这句或这张卡(或是标题行)`); continue; }
    if (bc !== null && a.card > bc) { dropped.push(`锚点 ${tag} 第 ${a.line + 1} 句 → 卡 ${a.card}:只能指前面已定的卡`); continue; }
    if (line.anchor !== a.card) { line.anchor = a.card; anchorsKept++; }
  }
  let lookKept = false;
  if (out.look && bc !== null) {
    const card = cards[bc];
    if (isHeading(card)) dropped.push(`样子 ${tag}:标题行没有样子`);
    else {
      const look: NonNullable<BoardCard['look']> = {};
      if (out.look.tint !== undefined) {
        if (out.look.tint in theme.tints) look.tint = out.look.tint;
        else dropped.push(`样子 ${tag}:底色槽 ${out.look.tint} 不在主题里,落回 ${theme.default}`);
      }
      if (out.look.look !== undefined) {
        if (out.look.look in theme.looks) look.look = out.look.look;
        else dropped.push(`样子 ${tag}:字形槽 ${out.look.look} 不在主题里`);
      }
      if (out.look.emoji !== undefined) {
        if (emojiOk(out.look.emoji)) look.emoji = out.look.emoji;
        else dropped.push(`样子 ${tag}:emoji 不像一个 emoji(${out.look.emoji})`);
      }
      if (Object.keys(look).length) { card.look = { ...(card.look ?? {}), ...look }; lookKept = true; }
    }
  }
  // 行:接着已定的行往下长
  let layout = section.layout;
  let row: 'same' | 'new' = 'new';
  if (bc !== null) {
    const rows = (layout?.rows ?? []).map((r) => [...r]).filter((r) => r.every((i) => i < bc));
    const last = rows[rows.length - 1];
    const canJoin = out.row === 'same' && last !== undefined && last.length < MAX_CARDS_PER_ROW && last[last.length - 1] === bc - 1 && !standsAlone(cards[bc]) && !last.some((i) => standsAlone(cards[i]));
    if (out.row === 'same' && !canJoin) dropped.push(`行 ${tag}:接不上上一行(${last === undefined ? '前面没有行' : last.length >= MAX_CARDS_PER_ROW ? `已有 ${MAX_CARDS_PER_ROW} 张` : standsAlone(cards[bc]) || last.some((i) => standsAlone(cards[i])) ? '有独占一行的卡' : '上一张卡不在上一行'}),另起一行`);
    if (canJoin) { last!.push(bc); row = 'same'; } else rows.push([bc]);
    layout = { for: device, rows };
  }
  return { section: { ...section, cards, lines, ...(layout ? { layout } : {}) }, dropped, kept: { marks: marksKept, anchors: anchorsKept, look: lookKept, row } };
}

export interface ValidatedPost {
  section: BoardSection;
  dropped: string[];
  kept: { marks: number; anchors: number; layout: boolean; looks: number };
}

/**
 * 整节一次的提案 → 拆成各拍走 validateBeatPost(mock 的写死提案、repost)。
 * 行:rows 要恰好盖住全部卡、顺序不变、一行不超 3 张,否则整个不要(一行一张);合法的转成每张卡 same / new。
 */
export function validatePost(section: BoardSection, theme: ThemeManifest, device: Device, out: PostOutput): ValidatedPost {
  const dropped: string[] = [];
  const n = section.cards.length;
  let rowsOk = false;
  if (out.layout && out.layout.rows.length) {
    const flat = out.layout.rows.flat();
    const inOrder = flat.length === n && flat.every((v, i) => v === i);
    const rowOk = out.layout.rows.every((r) => r.length >= 1 && r.length <= MAX_CARDS_PER_ROW);
    if (!inOrder) dropped.push(`排版:行没有恰好盖住 ${n} 张卡各一次(或顺序变了),整个不要`);
    else if (!rowOk) dropped.push(`排版:有一行超过 ${MAX_CARDS_PER_ROW} 张(或空行),整个不要`);
    else rowsOk = true;
  }
  const sameAs = (card: number): 'same' | 'new' => (rowsOk && out.layout!.rows.some((r) => r.includes(card) && r[0] !== card) ? 'same' : 'new');
  const beats = beatsOf(section);
  const lineBeat = new Map<number, { beat: Beat; j: number }>();
  beats.forEach((b) => b.lines.forEach((li, j) => lineBeat.set(li, { beat: b, j })));
  for (const m of out.marks) if (!lineBeat.has(m.line)) dropped.push(`第 ${m.line + 1} 句「${m.phrase}」→ 卡 ${m.card}:没有这句`);
  for (const a of out.anchors) if (!lineBeat.has(a.line)) dropped.push(`锚点 第 ${a.line + 1} 句 → 卡 ${a.card}:没有这句`);
  for (const k of Object.keys(out.look)) { const i = Number(k); if (!Number.isInteger(i) || !section.cards[i]) dropped.push(`样子 卡 ${k}:没有这张卡`); }
  let cur: BoardSection = { ...section, layout: undefined };
  const kept = { marks: 0, anchors: 0, layout: false, looks: 0 };
  for (const b of beats) {
    const bo: BeatPostOutput = {
      row: b.card === null ? 'new' : sameAs(b.card),
      look: b.card !== null && out.look[String(b.card)] ? out.look[String(b.card)] : undefined,
      marks: out.marks.filter((m) => lineBeat.get(m.line)?.beat === b).map((m) => ({ line: lineBeat.get(m.line)!.j, card: m.card, phrase: m.phrase, pen: m.pen, ...(m.said ? { said: m.said } : {}) })),
      anchors: out.anchors.filter((a) => lineBeat.get(a.line)?.beat === b).map((a) => ({ line: lineBeat.get(a.line)!.j, card: a.card })),
    };
    const v = validateBeatPost(cur, b, theme, device, bo);
    cur = v.section;
    dropped.push(...v.dropped);
    kept.marks += v.kept.marks;
    kept.anchors += v.kept.anchors;
    if (v.kept.look) kept.looks++;
    if (v.kept.row === 'same') kept.layout = true;
  }
  if (rowsOk) kept.layout = true;
  return { section: cur, dropped, kept };
}

/**
 * 板书后期(《卡片重设计评估.md》§五 §六;2026-09-13 起按拍,《工作流程.md》§三):一拍 = 一张卡 + 跟着它的讲稿句,拍关了就让快模型
 * 拿这拍的卡 + 讲稿、前面 3–5 张已定的卡(只读)、端、主题槽表,出 {row, look, marks, anchors}——这张卡接上一行还是另起一行、
 * 用哪个底色 / 字形 / emoji、讲到每句时在卡上标哪个词(said = 讲稿里念到的词)、哪句其实在讲前面的卡。
 * 老师决定什么上板、什么要孩子做、答案是什么;后期决定长什么样、放哪、标哪;主题决定取值;渲染器按端折行。
 *
 * 提示词的骨架是主题的 post.md(themes/<主题>/post.md,和 kid.css 同一套:出厂 / 拷贝 / hash / upgrade / 按 mtime 现读),任何一句都能改;
 * 占位符是代码生成的部分:{rules} {output} 与校验器、schema 同源,{cards} {lines} {context} 是这一拍与前文,{tints} {looks} {pens} {defaultTint} 从槽表拼。
 * 缺必需占位符(cards / lines / rules / output)→ 整份退 POST_TEMPLATE_FALLBACK(与包里 themes/default/post.md 同文)。
 *
 * 这里全是纯函数:拼提示词、解析输出、**校验**(模型只是提案,契约说了算:词不在卡上、said 不在讲稿里、卡号越界、笔名不认识、
 * 槽名不在清单、超配额、并排会超 3 张或碰上独占的卡——一律丢,丢了什么记进 dropped)。校验不过的部分就当没有,页面走机械规则。
 * 整节一次的 validatePost 保留:把整节提案拆成各拍再走同一个校验器(mock 的写死提案、repost 都走它)。起进程、落盘在 src/server/post.ts。
 */
import { z } from 'zod';
import { beatsOf, cardTexts, findPhrase, hasState, isHeading, PENS, plainLine, type Beat, type BoardCard, type BoardLine, type BoardMark, type BoardSection, type Device, type PenName } from './kid-board.ts';
import type { ThemeManifest } from '../schema/theme.ts';

const LookSchema = z.object({ tint: z.string().optional(), look: z.string().optional(), emoji: z.string().optional() });

/** 一拍的提案(模型输出):line 是拍内下标(0 起);card 缺省 = 这拍的卡,写了只能是前面已定的卡 */
export const BeatPostOutputSchema = z.object({
  row: z.enum(['same', 'new']).default('new'),
  look: LookSchema.nullable().optional(),
  marks: z.array(z.object({ line: z.number().int().nonnegative(), card: z.number().int().nonnegative().optional(), phrase: z.string().min(1), pen: z.string().min(1), said: z.string().optional() })).default([]),
  anchors: z.array(z.object({ line: z.number().int().nonnegative(), card: z.number().int().nonnegative() })).default([]),
});
export type BeatPostOutput = z.infer<typeof BeatPostOutputSchema>;

/** 整节一次的提案(mock 的写死提案、老的 .post.json):line / card 都是节内下标 */
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
/** 前文带几张已定的卡 */
export const CONTEXT_CARDS = 5;

const DEVICE_NOTE: Record<Device, string> = {
  phone: '手机竖屏,很窄:一行一张为主,只有两张都很短(各不到 20 字、没有选项)的卡才并排',
  'tablet-portrait': '平板竖屏:一行可以两张(兄弟卡并排:两种情况、公式和它所属的那一步),长卡独占一行',
  'tablet-landscape': '平板横屏,很宽:一行可以两三张(兄弟卡并排:两种情况、公式和它所属的那一步、三步搞懂),别浪费宽度,也别把不相干的硬凑一行',
};

/** 独占一行的卡:标题行、有交互的、场景 */
export function standsAlone(card: BoardCard): boolean {
  return isHeading(card) || hasState(card) || card.kind === 'scene';
}

function cardLine(c: BoardCard, i: number): string {
  const p = c.props || {};
  const tag = isHeading(c) ? '小节标题行(不算卡,不能标注,独占一行)' : hasState(c) || c.kind === 'scene' ? '有交互,独占一行' : '';
  const title = typeof p.title === 'string' && p.title && !isHeading(c) ? `标题「${p.title}」;` : '';
  const texts = isHeading(c) ? String(p.title ?? '') : cardTexts(c).filter((t) => t.trim()).join(' / ');
  return `${i}. ${c.kind}${tag ? `(${tag})` : ''}:${title}${texts.replace(/\s+/g, ' ').slice(0, 200)}`;
}

function lineLine(l: BoardLine, i: number, beatCard: number): string {
  const mine = l.marks.length ? ` ★老师已标:${l.marks.map((m) => `「${m.phrase}」(卡 ${m.card})`).join('')}` : '';
  const elsewhere = l.anchor !== null && l.anchor !== beatCard ? `(默认讲卡 ${l.anchor})` : '';
  return `${i}. ${l.text}${elsewhere}${mine}`;
}

/** 行号:这张卡在已定的行里排第几行(0 起);没排到 = null */
function rowOf(section: BoardSection, card: number): number | null {
  const rows = section.layout?.rows ?? [];
  const i = rows.findIndex((r) => r.includes(card));
  return i < 0 ? null : i;
}

/** 前文:这拍之前的几张卡,已定的样子、行、已标的词——只读 */
function contextBlock(section: BoardSection, beat: Beat, n = CONTEXT_CARDS): string {
  if (beat.card === null || beat.card === 0) return '(这是第一张卡,前面没有)';
  const from = Math.max(0, beat.card - n);
  const out: string[] = [];
  for (let k = from; k < beat.card; k++) {
    const c = section.cards[k];
    const look = c.look ? [c.look.tint ? `tint ${c.look.tint}` : '', c.look.look ? `look ${c.look.look}` : '', c.look.emoji ? `emoji ${c.look.emoji}` : ''].filter(Boolean).join(' · ') : '';
    const row = rowOf(section, k);
    const marked = section.lines.flatMap((l) => l.marks.filter((m) => m.card === k).map((m) => `「${m.phrase}」`)).join('');
    const alone = standsAlone(c) ? '独占一行' : row !== null ? `第 ${row + 1} 行${(section.layout?.rows[row].length ?? 1) > 1 ? `(与卡 ${section.layout!.rows[row].filter((x) => x !== k).join('、')} 并排)` : ''}` : '';
    out.push(`- ${cardLine(c, k)}${look ? ` · ${look}` : ''}${alone ? ` · ${alone}` : ''}${marked ? ` · 已标:${marked}` : ''}`);
  }
  return out.join('\n');
}

/** 规则段:与校验器同一组常量,改常量这里自动跟着变 */
export function rulesBlock(): string {
  return [
    `- row:same = 这张卡接在上一张卡那一行(兄弟卡:两种情况、公式和它所属的那一步、三步搞懂),new = 另起一行;一行最多 ${MAX_CARDS_PER_ROW} 张,标题行与有交互的卡永远独占(写了 same 也会被改成 new)。`,
    `- marks:一句最多 ${MAX_MARKS_PER_LINE} 处,一张卡整节最多 ${MAX_MARKS_PER_CARD} 处;phrase 必须**逐字**出现在那张卡的文字里(不是讲稿里),数字与拉丁词要整个词;card 不写 = 这拍的卡,写了只能是前面已定的卡;老师自己标过的(★)不要再标,也不要标封面标题和整句;前面的卡已标过的词不要重复标。`,
    '- said:讲稿念到 phrase 时说的是哪个词(必须逐字出现在这句讲稿里),页面靠它决定念到哪个字才动笔;卡上的词讲稿里原样说了就不用写。',
    '- anchors:这拍的句默认讲这拍的卡;只有明显在讲前面某张卡(回头讲公式、指结论卡)才写。',
    '- look:只给需要的卡;同类卡用同一个底色槽(前后呼应);emoji 只给要记住的那一两张,一个字符。',
  ].join('\n');
}

/** 输出段:形状与 BeatPostOutputSchema 同源 */
export function outputBlock(): string {
  return '{"row":"same"|"new","look":{"tint":"sky","look":"plain","emoji":"📐"},"marks":[{"line":0,"phrase":"…","pen":"tint","said":"…"}],"anchors":[{"line":1,"card":0}]}';
}

const slots = (t: Record<string, { use: string }>): string => Object.entries(t).map(([k, v]) => `- ${k}:${v.use}`).join('\n');

/** 出厂骨架(与包里 themes/default/post.md 同文;主题的文件读不到 / 缺必需占位符时用它) */
export const POST_TEMPLATE_FALLBACK = `你是一节板书的后期(排版与划重点),不是老师。老师已经决定了卡上写什么、讲稿说什么、答案是什么;你只决定这一拍:这张卡接上一行还是另起一行、用哪个底色槽 / 字形槽、要不要一个 emoji、讲到每句时在卡上标哪个词、用哪支笔。只输出一个 JSON 对象,不要解释,不要 markdown 围栏。

## 端
{device}

## 底色槽 tint(缺省 {defaultTint};一张卡一个)
{tints}

## 字形槽 look(不写 = 缺省)
{looks}

## 笔 pen
{pens}

## 规则
{rules}

## 已定的卡(只看,不改)
{context}

## 这一拍
{cards}
讲稿:
{lines}

## 输出(只这一个 JSON)
{output}
`;

export const REQUIRED_SLOTS = ['cards', 'lines', 'rules', 'output'] as const;
export const ALL_SLOTS = ['device', 'defaultTint', 'tints', 'looks', 'pens', 'rules', 'context', 'cards', 'lines', 'output'] as const;

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
  const card = beat.card === null ? null : section.cards[beat.card];
  return renderPostPrompt(tpl, {
    device: `这节要在 ${device} 上看:${DEVICE_NOTE[device]}。`,
    defaultTint: theme.default,
    tints: slots(theme.tints),
    looks: slots(theme.looks),
    pens: slots(pens),
    rules: rulesBlock(),
    context: contextBlock(section, beat),
    cards: card && beat.card !== null ? `卡 ${cardLine(card, beat.card)}` : '(这拍没有卡,只有话)',
    lines: beat.lines.map((i, j) => lineLine(section.lines[i], j, beat.card ?? -1)).join('\n') || '(没有讲稿)',
    output: outputBlock(),
  });
}

/** 整节的提示词(2026-09-13 之前的形状,评测 / 测试还用它看骨架):就是第一张卡那一拍的 */
export function postPrompt(section: BoardSection, device: Device, theme: ThemeManifest, template?: string | null): string {
  const beats = beatsOf(section);
  const first = beats.find((b) => b.card !== null) ?? beats[0] ?? { card: null, lines: [] };
  return beatPrompt(section, first, device, theme, template);
}

export type ParsedPost<T> = { ok: true; out: T } | { ok: false; why: string };

function extractJson(raw: string): { ok: true; obj: unknown } | { ok: false; why: string } {
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return { ok: false, why: '输出里没有 JSON 对象' };
  try {
    return { ok: true, obj: JSON.parse(raw.slice(a, b + 1)) };
  } catch (err) {
    return { ok: false, why: `JSON 解析不了:${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 模型的原文 → 一拍的提案:取第一个 { 到最后一个 } 之间当 JSON(模型偶尔会包围栏或多一句话);过 zod */
export function parseBeatPost(raw: string): ParsedPost<BeatPostOutput> {
  const j = extractJson(raw);
  if (!j.ok) return j;
  const r = BeatPostOutputSchema.safeParse(j.obj);
  if (!r.success) return { ok: false, why: r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join(';') };
  return { ok: true, out: r.data };
}

/** 整节提案的解析(mock / 老文件) */
export function parsePost(raw: string): ParsedPost<PostOutput> {
  const j = extractJson(raw);
  if (!j.ok) return j;
  const r = PostOutputSchema.safeParse(j.obj);
  if (!r.success) return { ok: false, why: r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join(';') };
  return { ok: true, out: r.data };
}

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

/** 后期没来(关了 / 超时 / 坏了):素版——什么都不改,页面走机械规则 */
export function fallbackPost(section: BoardSection): BoardSection {
  return section;
}

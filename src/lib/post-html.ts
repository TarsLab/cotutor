/**
 * 板书后期的 HTML 方言(《快模型方案.md》§一 A):**HTML 进、补丁出**。
 * 这里把板书按孩子看到的结构给模型看(全是标准 HTML,自定义的都是 data-*,2026-09-14 改):`<div class="row">` 一行、
 * `<div class="c c-<kind>" id="cN" data-tint data-look>` 一张卡、这一拍的卡 class 带 now、讲稿 `<p class="line" data-n>`;
 * **已画的标注不画在卡上**,另给一行文字 `{marked}`(2026-09-14 四轮评测:原地 `<mark>` 每轮引模型再标同一个词 7–9/18,文字列表 0/18);模型回的补丁就是 now 那张卡的壳:
 * `<div class="c" id="cN" data-row data-tint data-look data-emoji>` 里面 `<mark data-pen data-said data-card data-line>词</mark>` 与 `<p class="line" data-n data-for></p>`,正文不抄。
 * 模型偶尔回老的 `<c row tint><mark pen said><line n for/></c>` 形状,解析器也认。
 * 补丁解析成 BeatPostOutput(词靠 said / 词本身在这拍的讲稿里找到是哪句,不用模型数下标),再走 postprocess.ts 的校验器。
 * CSS 一行都不给模型:类名的含义就是主题的槽表。这里的类名与孩子端页面同一套(c-<kind> / data-tint / data-look / pen)。
 * 全是纯函数。
 */
import { cardTexts, findPhrase, hasState, isHeading, lookFor, plainLine, tintFor, type Beat, type BoardSection } from './kid-board.ts';
import type { BeatPostOutput, ParsedPost } from './postprocess.ts';

/** 前文带几张已定的卡 */
const CONTEXT_CARDS = 5;
/** 前文的卡每段字最多给这么多(这一拍的卡不截) */
const CONTEXT_TEXT_MAX = 300;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function unescapeHtml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

interface InlineMark {
  phrase: string;
  /** 标注上的属性(pen="marker" / card="c1") */
  attrs: string;
}

/** 一段字里把几处标注原地包成 <mark …>词</mark>(各取第一次出现、不重叠);其余转义 */
export function markedText(text: string, marks: readonly InlineMark[], max = Infinity): string {
  const t = text.length > max ? `${text.slice(0, max)}…` : text;
  const ranges: { a: number; b: number; attrs: string }[] = [];
  for (const m of marks) {
    const i = findPhrase(t, m.phrase);
    if (i < 0) continue;
    const b = i + m.phrase.length;
    if (ranges.some((r) => i < r.b && b > r.a)) continue;
    ranges.push({ a: i, b, attrs: m.attrs });
  }
  ranges.sort((x, y) => x.a - y.a);
  let out = '';
  let at = 0;
  for (const r of ranges) {
    out += escapeHtml(t.slice(at, r.a)) + `<mark${r.attrs ? ` ${r.attrs}` : ''}>${escapeHtml(t.slice(r.a, r.b))}</mark>`;
    at = r.b;
  }
  return out + escapeHtml(t.slice(at));
}

/** 这张卡上已画的词(老师的 + 前面的拍定的),去重 */
function markedOn(section: BoardSection, idx: number): string[] {
  const out: string[] = [];
  for (const l of section.lines) for (const m of l.marks) if (m.card === idx && !out.includes(m.phrase)) out.push(m.phrase);
  return out;
}

/** 几段字 → 每段一个 <tag>(空段跳过;前文的卡每段截到 max) */
function paragraphs(texts: readonly string[], tag: string, max: number): string {
  return texts.filter((t) => t.trim()).map((t) => `<${tag}>${markedText(t, [], max)}</${tag}>`).join('');
}

/**
 * 一张卡 → 精简 HTML(孩子看到的结构,不带交互):c-<kind> / data-style / data-tint / data-look / data-emoji;有交互与场景的 class 带 alone;
 * now = 这一拍的卡。小节标题行不是卡:<h2 class="heading">。
 */
export function cardHtml(section: BoardSection, idx: number, opts: { now?: boolean; max?: number } = {}): string {
  const c = section.cards[idx];
  const p = c.props || {};
  const id = `c${idx}`;
  if (isHeading(c)) return `<h2 class="heading" id="${id}">${escapeHtml(str(p.title))}</h2>`;
  const max = opts.max ?? Infinity;
  const alone = hasState(c) || c.kind === 'scene';
  const cls = ['c', `c-${c.kind}`, ...(alone ? ['alone'] : []), ...(opts.now ? ['now'] : [])].join(' ');
  const look = lookFor(c);
  const marked = markedOn(section, idx);
  const attrs = [`class="${cls}"`, `id="${id}"`, ...(str(p.style) ? [`data-style="${escapeHtml(str(p.style))}"`] : []), `data-tint="${escapeHtml(tintFor(c))}"`, ...(look !== 'plain' ? [`data-look="${escapeHtml(look)}"`] : []), ...(c.look?.emoji ? [`data-emoji="${escapeHtml(c.look.emoji)}"`] : []), ...(marked.length ? [`data-marked="${escapeHtml(marked.map((w) => `「${w}」`).join(''))}"`] : [])].join(' ');
  const body = ((): string => {
    switch (c.kind) {
      case 'text':
        return `${str(p.title) ? `<h3>${markedText(str(p.title), [], max)}</h3>` : ''}${paragraphs(str(p.text).split('\n'), 'p', max)}`;
      case 'read':
        return paragraphs(strs(p.segments), 'p', max);
      case 'choice':
        return `<p>${markedText(str(p.question), [], max)}</p><ul>${paragraphs(strs(p.options), 'li', max)}</ul>`;
      case 'fill':
        return paragraphs([str(p.text)], 'p', max);
      case 'image':
        return `<img alt="图">${paragraphs([str(p.caption)], 'figcaption', max)}`;
      case 'scene':
        return `${str(p.title) ? `<h3>${markedText(str(p.title), [], max)}</h3>` : ''}${paragraphs([str(p.problem), str(p.text)], 'p', max)}`;
      case 'canvas':
        return paragraphs([str(p.prompt)], 'p', max);
      case 'code':
        return `<code>${markedText(str(p.text), [], max)}</code>`;
      default:
        return paragraphs(cardTexts(c), 'p', max);
    }
  })();
  const tag = c.kind === 'image' ? 'figure' : c.kind === 'code' ? 'pre' : 'div';
  return `<${tag} ${attrs}>${body}</${tag}>`;
}

/** 讲稿的一句(不念括号;念到时已经要画的标注写在 data-marked 上,不画成 <mark>);这句默认讲别的卡就 data-for="cN" */
export function lineHtml(section: BoardSection, li: number, n: number, beatCard: number | null): string {
  const l = section.lines[li];
  const elsewhere = l.anchor !== null && l.anchor !== beatCard ? ` data-for="c${l.anchor}"` : '';
  const marked = l.marks.length ? ` data-marked="${escapeHtml(l.marks.map((m) => `c${m.card}「${m.phrase}」`).join(' '))}"` : '';
  return `<p class="line" data-n="${n}"${elsewhere}${marked}>${escapeHtml(plainLine(l.text))}</p>`;
}

/**
 * 已标过的词(文字,不画在卡上):前文窗口里的卡与 now 卡上所有标注(老师的 + 前面的拍定的),加这一拍讲稿里老师标的(可能指后面的卡);
 * 按卡列,一张卡一行;没有就说没有
 */
export function markedBlock(section: BoardSection, beat: Beat): string {
  const bc = beat.card;
  const from = bc === null ? 0 : Math.max(0, bc - CONTEXT_CARDS);
  const byCard = new Map<number, string[]>();
  const add = (card: number, phrase: string): void => {
    const xs = byCard.get(card) ?? [];
    if (!xs.includes(phrase)) xs.push(phrase);
    byCard.set(card, xs);
  };
  section.lines.forEach((l, li) => {
    for (const m of l.marks) if ((bc !== null && m.card >= from && m.card <= bc) || beat.lines.includes(li)) add(m.card, m.phrase);
  });
  const cards = [...byCard.keys()].sort((x, y) => x - y);
  return cards.length ? cards.map((k) => `- c${k}:${byCard.get(k)!.map((w) => `「${w}」`).join('')}`).join('\n') : '(还没有)';
}

/**
 * 板书段:前面已定的卡按行包好(没排到行的卡不包)+ 这一拍的卡(class now,不包行)+ 这一拍的讲稿。
 * 前文取最近 CONTEXT_CARDS 张;第一张卡前面没有就写一句。
 */
export function boardHtml(section: BoardSection, beat: Beat): string {
  const bc = beat.card;
  const out: string[] = [];
  if (bc === null) out.push('(这拍没有卡,只有话)');
  else {
    const from = Math.max(0, bc - CONTEXT_CARDS);
    if (bc === 0) out.push('<!-- 这是第一张卡,前面没有 -->');
    else if (from > 0) out.push(`<!-- 更前面还有 ${from} 张,孩子已经滚过去了 -->`);
    const rows = section.layout?.rows ?? [];
    const rowOf = (k: number): number => rows.findIndex((r) => r.includes(k));
    let k = from;
    while (k < bc) {
      const r = rowOf(k);
      if (r < 0) { out.push(cardHtml(section, k, { max: CONTEXT_TEXT_MAX })); k++; continue; }
      const members = rows[r].filter((i) => i >= from && i < bc);
      out.push(`<div class="row">${members.map((i) => cardHtml(section, i, { max: CONTEXT_TEXT_MAX })).join('')}</div>`);
      k = members[members.length - 1] + 1;
    }
    out.push(cardHtml(section, bc, { now: true }));
  }
  const lines = beat.lines.map((li, n) => lineHtml(section, li, n, bc));
  out.push(lines.length ? lines.join('\n') : '<!-- 这拍没有讲稿 -->');
  return out.join('\n');
}

/** 规则段(HTML 方言):与校验器同一组常量 */
export function htmlRulesBlock(limits: { perLine: number; perCard: number; perRow: number }): string {
  return [
    `- 补丁是 now 那张卡的壳 <div class="c" id="…">,正文不抄,属性是你的决定:data-row="same" 接在上一张卡那一行(兄弟卡:两种情况、公式和它所属的那一步、三步搞懂),data-row="new" 另起一行;一行最多 ${limits.perRow} 张,标题行(h2.heading)与 class 带 alone 的卡永远独占(写了 same 也会被改成 new)。data-tint / data-look / data-emoji 只给需要的;同类卡用同一个底色槽(前后呼应);emoji 只给要记住的那一两张,一个字符。`,
    `- 壳里每个 <mark data-pen="…">词</mark> 是一处新标注:词必须**逐字**出现在那张卡的文字里(不是讲稿里),数字与拉丁词要整个词;一句最多 ${limits.perLine} 处,一张卡整节最多 ${limits.perCard} 处;缺省标 now 这张卡,data-card="c1" 只能指前面已定的卡;data-marked 里已经有的词不要再标(那是老师的决定,已经画上了),也不要标封面标题和整句;这一拍没有值得标的就不放 <mark>,多数封面、题目卡都不用标。`,
    '- data-said="…":讲稿念到这个词时动笔(必须逐字出现在这一拍的某句讲稿里),页面靠它决定念到哪个字才画;卡上的词讲稿里原样说了就不用写。',
    '- 壳里放一个空的 <p class="line" data-n="1" data-for="c0"></p>:这一拍的第 n 句(0 起)其实在讲前面的卡(回头讲公式、指结论卡);不写 = 讲 now 这张卡。',
  ].join('\n');
}

/** 输出段:补丁的形状(带 now 那张卡的 id) */
export function patchBlock(card: number | null = null): string {
  const id = card === null ? 'c?' : `c${card}`;
  return `<div class="c" id="${id}" data-row="same|new" data-tint="sky" data-look="plain" data-emoji="📐"><mark data-pen="tint" data-said="…">…</mark><p class="line" data-n="1" data-for="c0"></p></div>`;
}

/**
 * HTML 方言的出厂骨架。**板书在最前、任务在后**(2026-09-14 真跑):板书夹在规则与输出形状之间时,haiku 把整份当「系统说明」,
 * 16 拍里 9 拍回「我还没看到板书,请把 HTML 给我」(CLI 传到了,让它复述能一字不差复述出来;是读法问题不是传输问题),
 * 且先写两三百字分析再给补丁(6–9 秒);板书放最前、结尾「现在就为 now 那张卡回一个 <c>」后,4 次试 3 次直接回补丁(3.5 秒、45 token)。
 */
export const POST_TEMPLATE_HTML = `下面是一节板书讲到一半的样子(孩子看到的结构):div.row 一行、div.c 一张卡、data-tint / data-look 是它现在的底色与字形、data-marked 是这张卡上已经画了的标注;class 带 now 的那张卡是刚出现的这一拍,后面的 p.line 是老师讲这张卡时说的话(它的 data-marked 是念到这句时已经要画的)。

\`\`\`html
{board}
\`\`\`

已标过的词(老师标的或前面定的,已经画在卡上了,不要再标):
{marked}

你是这节板书的后期(排版与划重点),不是老师。老师已经决定了卡上写什么、讲稿说什么、答案是什么;你只决定这一拍:now 这张卡接上一行还是另起一行、用哪个底色槽 / 字形槽、要不要一个 emoji、讲到每句时在卡上标哪个词、用哪支笔。

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

## 现在就为上面 now 那张卡回一个补丁
补丁 = 那张卡的 <div class="c"> 壳,只带你的决定和新标注,正文不抄。回答的第一个字符就是 <,不要分析、不要解释、不要围栏、不要别的字。形状:
{patch}
`;

const ATTR_RE = /([a-zA-Z][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>\/]+)))?/g;

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(tag))) { const k = m[1].replace(/^data-/, '').toLowerCase(); if (k === 'div' || k === 'c' || k === 'mark' || k === 'p' || k === 'line') continue; out[k] = unescapeHtml(m[2] ?? m[3] ?? m[4] ?? ''); }
  return out;
}

/** "c1" / "1" → 1;不像卡号 → undefined */
function cardNo(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v.trim().replace(/^c/i, ''));
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * 模型回的补丁 → 一拍的提案(之后走 validateBeatPost)。
 * 认两种壳:标准的 <div class="c" …>…</div>(属性 data-row / data-tint / data-look / data-emoji)与老的 <c row tint …>…</c>;
 * 里面 <mark data-pen data-said data-card data-line>词</mark>(老写法不带 data- 也认)是新标注,带 data-done 的是板上抄回来的不算;
 * 锚点是 <p class="line" data-n data-for></p> 或老的 <line n for/>。宽容:围栏、前后多话都行;几个候选壳取最后一个(模型先说话后给答案)。
 * 标注落在哪句:line 属性 > said 在哪句讲稿里 > 词本身在哪句讲稿里 > 这拍第一句。
 */
export function parseBeatPatch(raw: string, section: BoardSection, beat: Beat): ParsedPost<BeatPostOutput> {
  const text = raw.replace(/```[a-zA-Z]*\n?/g, '');
  const cand: { open: number; headEnd: number; close: string }[] = [];
  const re = /<(div|c)\b([^>]*)>/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(text))) {
    const attrs = mm[2];
    if (mm[1] === 'div') {
      // 卡的壳:class 里有 c 这个词;板书里 class 带 row / now 的是抄回来的输入,不算
      const cls = /class\s*=\s*"([^"]*)"|class\s*=\s*'([^']*)'/.exec(attrs);
      const words = (cls?.[1] ?? cls?.[2] ?? '').split(/\s+/);
      if (!words.includes('c') || words.includes('now')) continue;
      cand.push({ open: mm.index, headEnd: mm.index + mm[0].length - 1, close: '</div>' });
    } else {
      // 老写法:<c 带属性,或紧跟 <mark / <line / </c>;正文里提到的「<c> 补丁」不算
      const hasAttr = /\s[a-zA-Z][\w-]*\s*=/.test(attrs);
      const next = text.slice(mm.index + mm[0].length).replace(/^\s+/, '');
      if (hasAttr || /\/\s*$/.test(attrs) || /^<(mark|line)\b|^<\/c>/.test(next)) cand.push({ open: mm.index, headEnd: mm.index + mm[0].length - 1, close: '</c>' });
    }
  }
  if (!cand.length) return { ok: false, why: '输出里没有补丁(<div class="c"> 壳)' };
  const { open, headEnd, close } = cand[cand.length - 1];
  const head = text.slice(open, headEnd + 1);
  const selfClosed = /\/>$/.test(head);
  const end = text.lastIndexOf(close);
  const body = selfClosed || end < headEnd ? '' : text.slice(headEnd + 1, end);
  const a = attrsOf(head);
  const lineTexts = beat.lines.map((li) => plainLine(section.lines[li].text));
  const whichLine = (said: string | undefined, phrase: string, explicit: string | undefined): number => {
    if (explicit !== undefined && /^\d+$/.test(explicit.trim())) return Number(explicit.trim());
    const hit = (w: string): number => lineTexts.findIndex((t) => findPhrase(t, w) >= 0);
    const bySaid = said ? hit(said) : -1;
    if (bySaid >= 0) return bySaid;
    const byPhrase = hit(phrase);
    return byPhrase >= 0 ? byPhrase : 0;
  };
  const marks: BeatPostOutput['marks'] = [];
  const markRe = /<mark\b([^>]*)>([\s\S]*?)<\/mark>/g;
  let m: RegExpExecArray | null;
  while ((m = markRe.exec(body))) {
    const at = attrsOf(m[1]);
    const phrase = unescapeHtml(m[2].replace(/<[^>]*>/g, '')).trim();
    if (!phrase || 'done' in at) continue; // 板上带 data-done 的抄回来不算提案
    const card = cardNo(at.card);
    marks.push({ line: whichLine(at.said, phrase, at.line), ...(card !== undefined ? { card } : {}), phrase, pen: at.pen ?? '(没写)', ...(at.said ? { said: at.said } : {}) });
  }
  const anchors: BeatPostOutput['anchors'] = [];
  const lineRe = /<(?:line\b([^>]*?)\/?|p\b([^>]*class\s*=\s*["'][^"']*\bline\b[^"']*["'][^>]*))>/g;
  while ((m = lineRe.exec(body))) {
    const at = attrsOf(m[1] ?? m[2] ?? '');
    const n = at.n !== undefined && /^\d+$/.test(at.n.trim()) ? Number(at.n.trim()) : undefined;
    const card = cardNo(at.for ?? at.card);
    if (n !== undefined && card !== undefined) anchors.push({ line: n, card });
  }
  const look: BeatPostOutput['look'] = {};
  if (a.tint) look.tint = a.tint;
  if (a.look) look.look = a.look;
  if (a.emoji) look.emoji = a.emoji;
  return { ok: true, out: { row: a.row === 'same' ? 'same' : 'new', ...(Object.keys(look).length ? { look } : {}), marks, anchors } };
}

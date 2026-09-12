/**
 * 板书(孩子端老师页)的纯逻辑:卡片 JSON 契约、标注锚点、播放状态机、字幕行与输入条的状态。
 * 这份文件两处共用:服务端(解析器、测试)与孩子端页面——kid-page.ts 把它剥掉类型内联进 <script>,
 * 所以**不能有运行时 import、不能碰 DOM、不能用 enum / namespace**(Node 的 stripTypeScriptTypes 只剥类型)。
 *
 * 契约的分工(《板书卡片设计.md》):老师写「段落 = 讲稿,围栏 = 卡」的正文,服务端(src/lib/board.ts + src/cards/)解析成
 * 下面的 BoardSection JSON 放进对话索引;孩子端只认 JSON。卡 = {kind, props},每种卡的 props 契约在 src/cards/<kind>.ts;
 * 这里只知道每种卡「哪些字能被标注、笔是什么样」,不认识的 kind 也有兜底。
 */

/**
 * 一张卡:kind 是种类(text / read / choice / fill / image / code…),props 由那种卡自己定;state 是孩子在卡上做的事(存服务端,形状由那种卡定);
 * assets 是已经生成好的配音文件(相对 conversations/<老师>/,如 2026-09-10.1620-1.cards/2/1.mp3),点读段按 <段号>.mp3 找
 */
export interface BoardCard {
  kind: string;
  props: Record<string, unknown>;
  state?: unknown;
  assets?: string[];
  /** 样子(板书后期定的;没有就走机械规则 tintFor / lookFor):底色槽、字形槽、emoji,名字来自主题清单 */
  look?: CardLook;
}

export interface CardLook {
  tint?: string;
  look?: string;
  emoji?: string;
}

/** 五支笔(《卡片重设计评估.md》§三 C):面类 marker / tint 一下子涂上;线条类 underline / box / circle 是 SVG 路径,描出来 */
export type PenName = 'marker' | 'tint' | 'underline' | 'box' | 'circle';
export const PENS: readonly PenName[] = ['marker', 'tint', 'underline', 'box', 'circle'];
export const LINE_PENS: readonly PenName[] = ['underline', 'box', 'circle'];

/** 孩子端是什么端(发消息时带上,后期按它排版;渲染器按它折行) */
export type Device = 'phone' | 'tablet-portrait' | 'tablet-landscape';

/** 一节的排版:为哪个端排的、每行哪几张卡(下标;顺序 = 讲的顺序);没有 = 一行一张 */
export interface BoardLayout {
  for: Device;
  rows: number[][];
}

/** 一处敲黑板:第几张卡上的哪个词;pen 没有就按 penFor 的机械规则 */
export interface BoardMark {
  card: number;
  phrase: string;
  pen?: PenName;
}

/** 讲到这句时对某张卡做的事(讲稿里 [[名 参数]]):open / close / play… 页面按卡的种类执行,不认识的忽略 */
export interface BoardCue {
  card: number;
  name: string;
  arg?: string;
}

/** 讲稿的一句:配音文件(没有 = 浏览器合成)、这句念到时要画的标注、是不是问句(末句问句 → 停下等)、锚到上一张卡 */
export interface BoardLine {
  text: string;
  audio: string | null;
  marks: BoardMark[];
  ask: boolean;
  /** 这句上面最近的一张卡(没有 = null);播到这句就滚到它,不依赖老师打括号 */
  anchor: number | null;
  cues: BoardCue[];
}

/** 一节板书 = 一轮回复:卡整块铺,讲稿逐句播;partial = 还在流式生成 */
export interface BoardSection {
  cards: BoardCard[];
  lines: BoardLine[];
  partial?: boolean;
  layout?: BoardLayout;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** 一张卡上所有能被标注的文字;不认识的 kind 拿 props 里所有字符串 */
export function cardTexts(card: BoardCard): string[] {
  const p = card.props || {};
  switch (card.kind) {
    case 'text':
      return isHeading(card) ? [] : [str(p.title), str(p.text)];
    case 'read':
      return strs(p.segments);
    case 'choice':
      return [str(p.question), ...strs(p.options)];
    case 'fill':
      return [str(p.text)];
    case 'code':
      return [str(p.text)];
    case 'image':
      return [str(p.caption)];
    case 'scene':
      return [str(p.title), str(p.problem), str(p.text)];
    case 'canvas':
      return [str(p.prompt)];
    default:
      return Object.values(p).flatMap((v) => (typeof v === 'string' ? [v] : strs(v)));
  }
}

const ALNUM = /[0-9A-Za-z]/;

/**
 * 词在一段字里的位置,数字与拉丁词按整词算(「5」不落在「25」里、「an」不落在「and」里),中文照子串;没有 → -1。
 * 标注锚点(anchorMarks)与页面画笔的落点都用它,两处一条规则。
 */
export function findPhrase(text: string, phrase: string): number {
  if (!phrase) return -1;
  const headWord = ALNUM.test(phrase[0]);
  const tailWord = ALNUM.test(phrase[phrase.length - 1]);
  let from = 0;
  while (from <= text.length) {
    const i = text.indexOf(phrase, from);
    if (i < 0) return -1;
    const before = i > 0 ? text[i - 1] : '';
    const after = i + phrase.length < text.length ? text[i + phrase.length] : '';
    if (!(headWord && ALNUM.test(before)) && !(tailWord && ALNUM.test(after))) return i;
    from = i + 1;
  }
  return -1;
}

/** 讲稿里方括号的词落到哪张卡:第一张含这个词(整词,见 findPhrase)的卡;找不到的词丢掉(只出字幕,不报错) */
export function anchorMarks(cards: readonly BoardCard[], phrases: readonly string[]): BoardMark[] {
  const out: BoardMark[] = [];
  for (const raw of phrases) {
    const phrase = raw.trim();
    if (!phrase) continue;
    const card = cards.findIndex((c) => cardTexts(c).some((t) => findPhrase(t, phrase) >= 0));
    if (card >= 0) out.push({ card, phrase });
  }
  return out;
}

/** 讲稿一句里的 [词] → 词列表;顺序保留 */
export function phrasesIn(line: string): string[] {
  const out: string[] = [];
  const re = /\[([^\[\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1]);
  return out;
}

/** 去掉讲稿一句里的方括号(念的时候不念括号) */
export function plainLine(line: string): string {
  return line.replace(/\[([^\[\]]+)\]/g, '$1');
}

/** 小节标题(text 卡只有一行 `# 标题`):渲染成无底加粗一行,不算一张卡——不选中、不标注、不并排 */
export function isHeading(card: BoardCard): boolean {
  return card.kind === 'text' && (card.props || {}).heading === true;
}

/**
 * 底色槽(机械规则;后期定了 look.tint 就用它):做题的卡紫(plum),定义 / 结论蓝(sky),方法绿(moss),事实 / 例子 / 引言米(sand),
 * 封面深(night),公式 / 图 / 代码白(paper)。老板书的 style 修饰词照映。名字对不上主题清单的,CSS 落回 paper。
 */
export function tintFor(card: BoardCard): string {
  const t = card.look?.tint;
  if (t) return t;
  const p = card.props || {};
  const style = str(p.style);
  switch (card.kind) {
    case 'text':
      return style === 'cover' ? 'night' : style === 'formula' ? 'paper' : style === 'quote' ? 'sand' : style === 'step' ? 'moss' : style === 'note' ? 'sky' : str(p.title) ? 'sky' : 'sand';
    case 'choice':
    case 'fill':
    case 'canvas':
      return 'plum';
    case 'read':
      return 'sand';
    default:
      return 'paper';
  }
}

/** 字形槽(机械规则;后期定了 look.look 就用它):note → title(大字居中),formula → formula(衬线),quote → quote,其余 plain */
export function lookFor(card: BoardCard): string {
  const l = card.look?.look;
  if (l) return l;
  const style = str((card.props || {}).style);
  return style === 'note' ? 'title' : style === 'formula' ? 'formula' : style === 'quote' ? 'quote' : 'plain';
}

const LATIN = /^[0-9A-Za-z.,%°²³+\-×÷=()\s]+$/;

/**
 * 笔(机械规则;后期定了 mark.pen 就用它):选项 → 方框;填空、数字与拉丁词 → 下划线;点读段、公式、大字、封面 → 荧光;
 * 标题位上的词 → 圈;其余(正文里正在定义的词)→ 术语底。
 */
export function penFor(card: BoardCard, phrase: string): PenName {
  const p = card.props || {};
  switch (card.kind) {
    case 'choice':
      return strs(p.options).some((o) => findPhrase(o, phrase) >= 0) ? 'box' : 'underline';
    case 'fill':
      return 'underline';
    case 'read':
      return 'marker';
    case 'text': {
      const look = lookFor(card);
      if (look === 'formula' || look === 'title' || str(p.style) === 'cover') return 'marker';
      if (str(p.title) && findPhrase(str(p.title), phrase) >= 0) return 'circle';
      return LATIN.test(phrase) ? 'underline' : 'tint';
    }
    default:
      return 'underline';
  }
}

/** 短卡(能与兄弟并排):没有选项的文字卡,字数 ≤ 20;标题行不算 */
export function isShortCard(card: BoardCard): boolean {
  if (card.kind !== 'text' || isHeading(card)) return false;
  return Array.from(cardTexts(card).join('')).length <= 20;
}

/** 有 layout 时它必须恰好盖住全部卡各一次、顺序不变;否则不用它 */
function validRows(rows: readonly (readonly number[])[], n: number): boolean {
  const flat = rows.flat();
  return flat.length === n && flat.every((v, i) => v === i);
}

/**
 * 一节的行(《卡片重设计评估.md》§三 H):存的是「为某个端排的」,渲染永远能落地——
 * 没 layout 一行一张;有 layout:同一个端照排;别的端按机械规则折:手机上一行 2 张且都短才并排、其余拆开、3 张拆开;
 * 标题行、有状态的卡(choice / fill / canvas / scene)永远独占一行。
 */
export function rowsFor(section: BoardSection, device: Device): number[][] {
  const n = section.cards.length;
  const lay = section.layout;
  let rows: number[][] = lay && validRows(lay.rows, n) ? lay.rows.map((r) => [...r]) : Array.from({ length: n }, (_, i) => [i]);
  const alone = (i: number): boolean => {
    const c = section.cards[i];
    return !c || isHeading(c) || hasState(c) || c.kind === 'scene';
  };
  const fold = lay ? lay.for !== device && device === 'phone' : false;
  const out: number[][] = [];
  for (const row of rows) {
    if (row.length === 1) {
      out.push(row);
      continue;
    }
    const split = row.some(alone) || (fold && (row.length > 2 || !row.every((i) => isShortCard(section.cards[i]))));
    if (split) for (const i of row) out.push([i]);
    else out.push(row);
  }
  return out;
}

/** 端:宽 ≥ 900 且横 → 平板横屏;短边 ≥ 600 → 平板竖屏;其余手机 */
export function deviceFor(width: number, height: number): Device {
  if (width >= 900 && width > height) return 'tablet-landscape';
  if (Math.min(width, height) >= 600) return 'tablet-portrait';
  return 'phone';
}

/** 当前卡(选中态):播到这句该在的那张(lineTarget);句子没锚就是本节第一张不是标题行的卡;没在播 → null */
export function nowCard(sections: readonly BoardSection[], state: PlayerState): number | null {
  const s = sections[state.section];
  if (!s || state.line < 0) return null;
  const line = s.lines[state.line];
  if (!line) return null;
  const t = lineTarget(line);
  if (t !== null && s.cards[t] && !isHeading(s.cards[t])) return t;
  const first = s.cards.findIndex((c) => !isHeading(c));
  return first >= 0 ? first : null;
}

// ---- 线条类的笔:SVG 路径,手绘感(端点微抖),抖动的种子取词的 hash,同一个词每次画一样 ----

function seedOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 笔画的框:相对被标注文字的一行矩形(宽 w、高 h),笔要伸出去多少 */
export function penBox(pen: PenName, w: number, h: number): PenBox {
  switch (pen) {
    case 'underline':
      return { x: -3, y: h - 4, w: w + 6, h: 10 };
    case 'box':
      return { x: -4, y: -3, w: w + 8, h: h + 6 };
    case 'circle':
      return { x: -10, y: -7, w: w + 20, h: h + 14 };
    default:
      return { x: 0, y: 0, w, h };
  }
}

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

/** 笔画的路径(viewBox 0 0 w h):下划线一笔、方框一圈、圈一圈多一点;seed 定抖动 */
export function penPath(pen: PenName, w: number, h: number, seed: string): string {
  const r = rng(seedOf(seed));
  const j = (amp: number): number => (r() - 0.5) * 2 * amp;
  if (pen === 'underline') {
    const y = h * 0.5;
    return `M2 ${f1(y + j(1.5))} C ${f1(w * 0.18)} ${f1(y + j(2.5))}, ${f1(w * 0.34)} ${f1(y + j(2.5))}, ${f1(w * 0.52)} ${f1(y + j(2))} S ${f1(w * 0.84)} ${f1(y + j(2.5))}, ${f1(w - 2)} ${f1(y + j(1.5))}`;
  }
  if (pen === 'box') {
    const l = 3 + j(0.8), t = 3 + j(0.8), rt = w - 3 + j(0.8), b = h - 3 + j(0.8);
    return `M${f1(l)} ${f1(t)} C ${f1(w * 0.3)} ${f1(t + j(1))}, ${f1(w * 0.7)} ${f1(t + j(1))}, ${f1(rt)} ${f1(t + j(0.8))} C ${f1(rt + j(1))} ${f1(h * 0.3)}, ${f1(rt + j(1))} ${f1(h * 0.7)}, ${f1(rt + j(0.8))} ${f1(b)} C ${f1(w * 0.7)} ${f1(b + j(1))}, ${f1(w * 0.3)} ${f1(b + j(1))}, ${f1(l + j(0.8))} ${f1(b + j(0.8))} C ${f1(l + j(1))} ${f1(h * 0.7)}, ${f1(l + j(1))} ${f1(h * 0.3)}, ${f1(l)} ${f1(t + 2)}`;
  }
  if (pen === 'circle') {
    const cx = w / 2, cy = h / 2, rx = w / 2 - 2.5, ry = h / 2 - 2.5;
    const n = 36;
    const start = -1.1; // 从右上起笔,顺时针,多画一点收尾
    const pts: string[] = [];
    for (let k = 0; k <= n + 3; k++) {
      const a = start + (k / n) * Math.PI * 2;
      const wob = 1 + j(0.035);
      pts.push(`${f1(cx + Math.cos(a) * rx * wob)} ${f1(cy + Math.sin(a) * ry * wob)}`);
    }
    return `M${pts[0]} L ${pts.slice(1).join(' L ')}`;
  }
  return '';
}

/** 有舞台交互(能改状态、能「交给老师」)的种类;其余点开只是放大看 */
export function hasState(card: BoardCard): boolean {
  return card.kind === 'choice' || card.kind === 'fill' || card.kind === 'canvas';
}

/** 画板上画了几笔(状态里的 ink 元素数) */
export function inkCount(card: BoardCard): number {
  const st = card.state as { ink?: unknown } | undefined;
  return Array.isArray(st?.ink) ? st.ink.length : 0;
}

/** 重卡:舞台在 iframe 里的舞台包(/stage/)开,页面只管顶栏、字幕行、输入条 */
export function isHeavy(card: BoardCard): boolean {
  return card.kind === 'scene' || card.kind === 'canvas';
}

/** 场景卡能不能播(课包到了);没到紧凑态写「图还在路上」 */
export function sceneReady(card: BoardCard): boolean {
  return card.kind === 'scene' && (card.props || {}).ready === true;
}

export type ScenePhase = 'loading' | 'ready' | 'drawing' | 'gap' | 'done' | 'paused';

/** 舞台里场景在播时的字幕行:讲稿句是场景的,右侧按钮映射到播放器(drawing → 暂停;gap / ready / paused → 继续 / 播放;done → 没钮) */
export function sceneSubtitle(phase: ScenePhase, line: string, step: number, total: number): SubtitleView {
  switch (phase) {
    case 'drawing':
      return { text: line, kind: 'line', right: 'pause' };
    case 'gap':
      return { text: line, kind: 'line', right: step >= total ? 'none' : 'continue' };
    case 'ready':
      return { text: line, kind: 'line', right: 'play' };
    case 'paused':
      return { text: line, kind: 'line', right: 'play' };
    case 'done':
      return { text: line, kind: 'line', right: 'none' };
    default:
      return { text: '', kind: 'empty', right: 'none' };
  }
}

/** 点读第 k 段(0 起)的配音文件(相对 conversations/<老师>/);没生成好 → null(退浏览器合成声) */
export function segmentAudio(card: BoardCard, k: number): string | null {
  const want = `/${k + 1}.mp3`;
  return (card.assets || []).find((a) => a.endsWith(want)) ?? null;
}

/** 填空当前填了什么(按空的顺序;没填的空是空串) */
export function filledAnswers(card: BoardCard): string[] {
  const blanks = typeof (card.props || {}).blanks === 'number' ? (card.props.blanks as number) : 0;
  const st = card.state as { answers?: unknown } | undefined;
  const got = Array.isArray(st?.answers) ? st.answers.map((x) => (typeof x === 'string' ? x.trim() : '')) : [];
  return Array.from({ length: blanks }, (_, i) => got[i] ?? '');
}

/** 孩子在这张卡上做了什么(「交给老师」能不能按、字幕行回显用):选择题是选项,填空是填的字;没做 → [] */
export function stateSummary(card: BoardCard): string[] {
  if (card.kind === 'choice') return pickedLabels(card);
  if (card.kind === 'fill') return filledAnswers(card).filter(Boolean);
  if (card.kind === 'canvas') return inkCount(card) ? [`画了 ${inkCount(card)} 笔`] : [];
  return [];
}

/** 舞台顶栏的名字:文字卡的标题 / 正文、选择题的问题、其余第一段有字的;截 24 字 */
export function cardTitle(card: BoardCard): string {
  const p = card.props || {};
  const first = str(p.title) || str(p.question) || str(p.text) || str(p.caption) || str(p.prompt) || strs(p.segments)[0] || cardTexts(card).find((t) => t.trim()) || (card.kind === 'image' ? '图' : card.kind === 'canvas' ? '画一画' : '');
  const cps = Array.from(first.trim().replace(/\s+/g, ' '));
  return cps.length > 24 ? `${cps.slice(0, 24).join('')}…` : cps.join('');
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 选择题:点第 i 项后的选中集合——单选换成它(再点取消),多选切换 */
export function togglePick(picked: readonly number[], i: number, multi: boolean): number[] {
  if (picked.includes(i)) return picked.filter((x) => x !== i);
  return multi ? [...picked, i] : [i];
}

/** 选择题当前选了什么(回显与紧凑态用):「B 三个」 */
export function pickedLabels(card: BoardCard): string[] {
  const options = strs((card.props || {}).options);
  const st = card.state as { picked?: unknown } | undefined;
  const picked = Array.isArray(st?.picked) ? st.picked.filter((x): x is number => typeof x === 'number') : [];
  return picked.filter((i) => i >= 0 && i < options.length).map((i) => `${LETTERS[i] ?? i + 1} ${options[i]}`);
}

export function isQuestion(text: string): boolean {
  const t = text.trim();
  return t.endsWith('?') || t.endsWith('?');
}

/** 孩子端条目里页面用到的字段(与 kid-view 的 KidMessage 兼容) */
export interface BoardMessage {
  job: string;
  at?: string;
  question: string | null;
  reply: string | null;
  audio: string | null;
  pending: boolean;
  section?: BoardSection | null;
}

export interface BoardEntry extends BoardSection {
  job: string;
  at?: string;
  /** 老师还在说:卡只增不改,讲稿不播;整轮跑完换成正式的一节 */
  partial?: boolean;
}

function lineFrom(text: string, audio: string | null): BoardLine {
  return { text, audio, marks: [], ask: isQuestion(text), anchor: null, cues: [] };
}

/**
 * 孩子端条目 → 板书节。有 section 用 section(讲稿空就把 reply 当一句);只有 reply 的退成一张文字卡 + 一句讲稿;
 * 孩子的话不上板;还在跑的只有带 partial 板书(流式,已有卡)才出节且标 partial,其余不出。
 */
export function sectionsFromMessages(messages: readonly BoardMessage[]): BoardEntry[] {
  const out: BoardEntry[] = [];
  for (const m of messages) {
    const at = m.at ? { at: m.at } : {};
    if (m.pending) {
      if (m.section && m.section.partial && m.section.cards.length) out.push({ job: m.job, ...at, cards: m.section.cards, lines: m.section.lines, partial: true });
      continue;
    }
    if (m.section && (m.section.cards.length || m.section.lines.length)) {
      const lines = m.section.lines.length ? m.section.lines : m.reply ? [lineFrom(m.reply, m.audio)] : [];
      out.push({ job: m.job, ...at, cards: m.section.cards, lines, ...(m.section.layout ? { layout: m.section.layout } : {}) });
    } else if (m.reply) out.push({ job: m.job, ...at, cards: [{ kind: 'text', props: { text: m.reply } }], lines: [lineFrom(m.reply, m.audio)] });
  }
  return out;
}

/** 一节在目录里的名字:封面标题 > 有名字的文字卡 > 第一张有字的卡 > 第一句讲稿;截到 14 个字 */
export function sectionTitle(s: BoardSection): string {
  const pick = (): string => {
    for (const c of s.cards) if (c.kind === 'text' && c.props.style === 'cover' && str(c.props.title)) return str(c.props.title);
    for (const c of s.cards) if (isHeading(c) && str(c.props.title)) return str(c.props.title);
    for (const c of s.cards) if (c.kind === 'text' && str(c.props.title)) return str(c.props.title);
    for (const c of s.cards) {
      const t = cardTexts(c).find((x) => x.trim());
      if (t) return t;
    }
    return s.lines[0]?.text ?? '';
  };
  const cps = Array.from(pick().trim());
  return cps.length > 14 ? `${cps.slice(0, 14).join('')}…` : cps.join('');
}

/** stage = 讲稿把这句交给了场景卡的舞台([[play]]),等它 done */
export type PlayStatus = 'idle' | 'playing' | 'paused' | 'waiting' | 'done' | 'stage';

export interface PlayerState {
  section: number;
  line: number;
  status: PlayStatus;
}

/** 打开页面时的位置:停在最后一节末尾;末句是问句就等着(继续钮在) */
export function playerAtEnd(sections: readonly BoardSection[]): PlayerState {
  if (!sections.length) return { section: -1, line: -1, status: 'idle' };
  const section = sections.length - 1;
  const line = sections[section].lines.length - 1;
  const last = sections[section].lines[line];
  return { section, line, status: last && last.ask ? 'waiting' : 'done' };
}

/** 新来一节:从它第一句开始播;没讲稿就直接算完 */
export function startSection(index: number, sections: readonly BoardSection[]): PlayerState {
  const s = sections[index];
  if (!s || !s.lines.length) return { section: index, line: -1, status: 'done' };
  return { section: index, line: 0, status: 'playing' };
}

/**
 * 一句播完往下走:同节还有句 → 下一句;没了 → 有下一节就进下一节(孩子已经答过了,不用等);
 * 没下一节且末句是问句 → 停下等;否则完。
 */
export function advance(state: PlayerState, sections: readonly BoardSection[]): PlayerState {
  const s = sections[state.section];
  if (!s) return { ...state, status: 'done' };
  if (state.line < s.lines.length - 1) return { section: state.section, line: state.line + 1, status: 'playing' };
  if (state.section < sections.length - 1) return startSection(state.section + 1, sections);
  const last = s.lines[state.line];
  return { ...state, status: last && last.ask ? 'waiting' : 'done' };
}

/** 当前节里播到这句为止该画上的标注(打开页面或跳到某句时一次画齐) */
export function marksUpTo(sections: readonly BoardSection[], state: PlayerState): BoardMark[] {
  const s = sections[state.section];
  if (!s || state.line < 0) return [];
  return s.lines.slice(0, state.line + 1).flatMap((l) => l.marks);
}

/** 播到这句该滚到哪张卡:标注所在的卡优先,其次锚点卡,再没有就 null(页面滚到本节第一张) */
export function lineTarget(line: BoardLine): number | null {
  if (line.marks.length) return line.marks[line.marks.length - 1].card;
  return line.anchor;
}

export interface SubtitleInput {
  state: PlayerState;
  sections: readonly BoardSection[];
  /** 孩子刚说的话,短暂回显(拍板 2026-09-10) */
  echo: string | null;
  pending: boolean;
  /** 等老师时那句人设话 */
  thinking: string;
  limit: boolean;
}

export interface SubtitleView {
  text: string;
  kind: 'line' | 'echo' | 'thinking' | 'limit' | 'empty';
  right: 'pause' | 'play' | 'continue' | 'none';
}

/** 字幕行:上限 > 回显孩子的话 > 等老师 > 当前句(按播放状态定右侧的钮) */
export function subtitleFor(i: SubtitleInput): SubtitleView {
  if (i.limit) return { text: '今天聊够啦,明天再来', kind: 'limit', right: 'none' };
  if (i.echo) return { text: i.echo, kind: 'echo', right: 'none' };
  if (i.pending) return { text: i.thinking, kind: 'thinking', right: 'none' };
  const line = i.sections[i.state.section]?.lines[i.state.line];
  const text = line ? plainLine(line.text) : '';
  switch (i.state.status) {
    case 'playing':
      return { text, kind: 'line', right: 'pause' };
    case 'paused':
      return { text, kind: 'line', right: 'play' };
    case 'waiting':
      return { text, kind: 'line', right: 'continue' };
    case 'done':
      return { text, kind: text ? 'line' : 'empty', right: 'none' };
    case 'stage':
      return { text, kind: 'line', right: 'none' };
    default:
      return { text: '', kind: 'empty', right: 'none' };
  }
}

export type BarMode = 'idle' | 'typing' | 'holding';
export type BarEvent = 'tap' | 'holdStart' | 'holdEnd' | 'holdCancel' | 'sent' | 'blur';

/** 输入条中间那段:点 → 打字;按住 → 说话;松手 / 上滑取消 / 发出 / 失焦 → 回到闲置 */
export function barNext(mode: BarMode, ev: BarEvent): BarMode {
  switch (ev) {
    case 'holdStart':
      return 'holding';
    case 'holdEnd':
    case 'holdCancel':
      return mode === 'holding' ? 'idle' : mode;
    case 'tap':
      return mode === 'idle' ? 'typing' : mode;
    case 'sent':
    case 'blur':
      return 'idle';
    default:
      return mode;
  }
}



/** 没配音也没浏览器合成时,一句停多久(毫秒):按字数估 */
export function lineDurationMs(text: string): number {
  return Math.max(1200, Array.from(plainLine(text)).length * 260);
}

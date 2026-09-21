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

/** 五支笔:面类 marker / tint 一下子涂上;线条类 underline / box / circle 是 SVG 路径,描出来 */
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
  /** 讲稿里念到它的那个词(卡上写「三个角」、讲稿说「几个角」时后期填);没有 = 用 phrase 在讲稿里找。只用来定时,不影响标在卡上哪个词 */
  said?: string;
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
  /** 流式时:前几拍已经就绪(配音齐;以后加后期回)——页面就绪一拍播一拍;定稿的节没有这个字段(全部就绪) */
  ready?: number;
  layout?: BoardLayout;
}

/**
 * 拍(2026-09-13,《工作流程.md》§二):一张卡 + 它后面直到下一张卡之前的讲稿句;第一张卡之前的句子是没有卡的一拍。
 * 不进契约,从卡与句的顺序现算——句子锚到上一张卡(anchor),所以按 anchor 分组;后期改过锚点的定稿节不用它(全部就绪,拍无所谓)。
 */
export interface Beat {
  card: number | null;
  lines: number[];
}
export function beatsOf(section: Pick<BoardSection, 'cards' | 'lines'>): Beat[] {
  const beats: Beat[] = [];
  const byCard = new Map<number | null, Beat>();
  const get = (card: number | null): Beat => {
    let b = byCard.get(card);
    if (!b) { b = { card, lines: [] }; byCard.set(card, b); beats.push(b); }
    return b;
  };
  section.lines.forEach((l, i) => { if (l.anchor === null) get(null).lines.push(i); });
  section.cards.forEach((_c, k) => get(k));
  section.lines.forEach((l, i) => { if (l.anchor !== null) get(Math.min(l.anchor, section.cards.length - 1)).lines.push(i); });
  return beats;
}

/**
 * 流式时前几拍就绪了:一拍要「关了」(后面已经有下一张卡,或老师写完了)且它的每句配音都落了盘(老师没配音色 = 不等配音)。
 * 返回就绪的拍数(前缀:第 k 拍就绪的前提是前面都就绪,播放本来就是顺着来的)。
 */
export function readyBeats(section: Pick<BoardSection, 'cards' | 'lines'>, opts: { voiced: boolean; done: boolean; settled?: (k: number, beat: Beat) => boolean }): number {
  const beats = beatsOf(section);
  let n = 0;
  for (let k = 0; k < beats.length; k++) {
    const closed = opts.done || k < beats.length - 1;
    const dubbed = !opts.voiced || beats[k].lines.every((i) => section.lines[i].audio !== null);
    const posted = opts.settled ? opts.settled(k, beats[k]) : true;
    if (!closed || !dubbed || !posted) break;
    n++;
  }
  return n;
}

/** 流式的节:前 ready 拍里的句子能播;定稿的节:全部 */
export function playableLines(section: BoardSection): number {
  if (!section.partial) return section.lines.length;
  const beats = beatsOf(section).slice(0, section.ready ?? 0);
  return beats.reduce((n, b) => Math.max(n, b.lines.length ? b.lines[b.lines.length - 1] + 1 : n), 0);
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
    case 'tianzige':
      return []; // 田字格里是 SVG 路径不是文字,标注落不上;讲稿里的 [鼓] 去别的卡找
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

/** 提问卡:末句问句没配能答的卡时解析器补的那张文字卡(《卡片协议.md》);字就是那句问话,不过后期、独占一行 */
export function isAskCard(card: BoardCard): boolean {
  return card.kind === 'text' && (card.props || {}).ask === true;
}

/**
 * 底色槽(机械规则;后期定了 look.tint 就用它):做题的卡紫(plum),定义 / 结论蓝(sky),方法绿(moss),事实 / 例子 / 引言米(sand),
 * 公式 / 图 / 代码白(paper)。名字对不上主题清单的,CSS 落回 paper。
 */
export function tintFor(card: BoardCard): string {
  const t = card.look?.tint;
  if (t) return t;
  const p = card.props || {};
  const style = str(p.style);
  switch (card.kind) {
    case 'text':
      return isAskCard(card) ? 'plum' : style === 'formula' ? 'paper' : str(p.title) ? 'sky' : 'sand';
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

/** 字形槽(机械规则;后期定了 look.look 就用它):formula → formula(衬线),其余 plain */
export function lookFor(card: BoardCard): string {
  const l = card.look?.look;
  if (l) return l;
  const style = str((card.props || {}).style);
  return style === 'formula' ? 'formula' : 'plain';
}

const LATIN = /^[0-9A-Za-z.,%°²³+\-×÷=()\s]+$/;

/**
 * 笔(机械规则;后期定了 mark.pen 就用它):选项 → 方框;填空、数字与拉丁词 → 下划线;点读段、公式、大字 → 荧光;
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
      if (look === 'formula' || look === 'title') return 'marker';
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
 * 一节的行:存的是「为某个端排的」,渲染永远能落地——
 * 没 layout 一行一张;有 layout:同一个端照排;别的端按机械规则折:手机上一行 2 张且都短才并排、其余拆开、3 张拆开;
 * 标题行、有状态的卡(choice / fill / canvas / scene)永远独占一行。
 */
export function rowsFor(section: BoardSection, device: Device): number[][] {
  const n = section.cards.length;
  const lay = section.layout;
  // 行只排到已定的那几张(前缀),后面的一行一张:流式的节,和定稿后不过后期的提问卡
  const last = section.cards[n - 1];
  const prefix = (section.partial || (last && isAskCard(last))) && lay && !validRows(lay.rows, n) && validRows(lay.rows, lay.rows.flat().length) && lay.rows.flat().length <= n;
  let rows: number[][] = lay && validRows(lay.rows, n) ? lay.rows.map((r) => [...r]) : prefix ? [...lay!.rows.map((r) => [...r]), ...Array.from({ length: n - lay!.rows.flat().length }, (_, i) => [lay!.rows.flat().length + i])] : Array.from({ length: n }, (_, i) => [i]);
  const alone = (i: number): boolean => {
    const c = section.cards[i];
    return !c || isHeading(c) || isAskCard(c) || hasState(c) || c.kind === 'scene';
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
  // 停下等答:亮的是提问卡(有的话)——孩子要答的那句在它上面
  const askAt = s.cards.length - 1;
  if (state.status === 'waiting' && !state.replay && state.line === s.lines.length - 1 && askAt >= 0 && isAskCard(s.cards[askAt])) return askAt;
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

/** 孩子在这张卡上做了什么(「交给老师」能不能按):选择题是选项,填空是填的字;没做 → [] */
export function stateSummary(card: BoardCard): string[] {
  if (card.kind === 'choice') return pickedLabels(card);
  if (card.kind === 'fill') return filledAnswers(card).filter(Boolean);
  if (card.kind === 'canvas') return inkCount(card) ? [`画了 ${inkCount(card)} 笔`] : [];
  return [];
}

/** 舞台顶栏的名字:文字卡的标题 / 正文、选择题的问题、其余第一段有字的;截 24 字 */
export function cardTitle(card: BoardCard): string {
  const p = card.props || {};
  const first = str(p.title) || str(p.question) || str(p.text) || str(p.caption) || str(p.prompt) || strs(p.segments)[0] || cardTexts(card).find((t) => t.trim()) || (card.kind === 'image' ? '图' : card.kind === 'canvas' ? '画一画' : card.kind === 'tianzige' ? str(p.chars) : '');
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
  pending: boolean;
  section?: BoardSection | null;
  /** 孩子这条带的作业照片(相对 workspace 根;R5):节头上回显缩略图 */
  photos?: string[];
}

export interface BoardEntry extends BoardSection {
  job: string;
  at?: string;
  /** 老师还在说:卡只增不改;前 ready 拍就绪了就能播(2026-09-13 之前是整轮跑完才播);整轮跑完换成正式的一节 */
  partial?: boolean;
  /** 孩子问这节时拍的照片(节头上回显) */
  photos?: string[];
}

/**
 * 孩子端条目 → 板书节(没有 section 的条目不出节);
 * 孩子的话不上板;还在跑的只有带 partial 板书(流式,已有卡)才出节且标 partial,其余不出。
 */
export function sectionsFromMessages(messages: readonly BoardMessage[]): BoardEntry[] {
  const out: BoardEntry[] = [];
  for (const m of messages) {
    const at = { ...(m.at ? { at: m.at } : {}), ...(m.photos?.length ? { photos: m.photos } : {}) };
    if (m.pending) {
      if (m.section && m.section.partial && m.section.cards.length) out.push({ job: m.job, ...at, cards: m.section.cards, lines: m.section.lines, partial: true, ready: m.section.ready ?? 0, ...(m.section.layout ? { layout: m.section.layout } : {}) });
      continue;
    }
    if (m.section && (m.section.cards.length || m.section.lines.length)) {
      out.push({ job: m.job, ...at, cards: m.section.cards, lines: m.section.lines, ...(m.section.layout ? { layout: m.section.layout } : {}) });
    }
  }
  return out;
}

/** 一节在目录里的名字:小节标题 > 有名字的文字卡 > 第一张有字的卡 > 第一句讲稿;截到 14 个字 */
export function sectionTitle(s: BoardSection): string {
  const pick = (): string => {
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
/** thinking = 老师还在写,已就绪的句子播完了,等下一拍(字幕行见 subtitleFor 的 wait / gap,不出错、不响) */
export type PlayStatus = 'idle' | 'playing' | 'paused' | 'waiting' | 'done' | 'stage' | 'thinking';

export interface PlayerState {
  section: number;
  line: number;
  status: PlayStatus;
  /** 再听(2026-09-18):正在重念的句子(下标,不一定连着——后期可能改过锚点)与念完回到哪里 */
  replay?: { lines: number[]; back: PlayerState };
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
  if (!s || !s.lines.length) return { section: index, line: -1, status: s && s.partial ? 'thinking' : 'done' };
  if (!playableLines(s)) return { section: index, line: -1, status: 'thinking' };
  return { section: index, line: 0, status: 'playing' };
}

/**
 * 一句播完往下走:同节还有句 → 下一句;没了 → 有下一节就进下一节(孩子已经答过了,不用等);
 * 没下一节且末句是问句 → 停下等;否则完。
 */
export function advance(state: PlayerState, sections: readonly BoardSection[]): PlayerState {
  if (state.replay) {
    const next = state.replay.lines[state.replay.lines.indexOf(state.line) + 1];
    return next === undefined ? state.replay.back : { ...state, line: next, status: 'playing' };
  }
  const s = sections[state.section];
  if (!s) return { ...state, status: 'done' };
  if (state.line < playableLines(s) - 1) return { section: state.section, line: state.line + 1, status: 'playing' };
  // 老师还在写这节:就绪的播完了就等着,下一拍就绪再从这里接上(advance 会再被叫)
  if (s.partial) return { ...state, status: 'thinking' };
  if (state.section < sections.length - 1) return startSection(state.section + 1, sections);
  const last = s.lines[state.line];
  return { ...state, status: last && last.ask ? 'waiting' : 'done' };
}

/**
 * 这节念完了几句(前缀):前面的节全念完,后面的节一句没念;本节看播放器——在念 / 暂停的那句不算,等下一拍 / 交给场景的那句算。
 * 再听时按回放前的位置算(重念不改「念到哪」)
 */
export function spokenLines(state: PlayerState, sections: readonly BoardSection[], secIdx: number): number {
  const at = state.replay ? state.replay.back : state;
  const s = sections[secIdx];
  if (!s || secIdx > at.section) return 0;
  if (secIdx < at.section) return s.lines.length;
  switch (at.status) {
    case 'waiting':
    case 'done':
      return s.lines.length;
    case 'thinking':
    case 'stage':
      return Math.max(0, at.line + 1);
    case 'playing':
    case 'paused':
      return Math.max(0, at.line);
    default:
      return 0;
  }
}

/**
 * 再听哪几句:卡 = 第一遍念时让它亮起来的句(nowCard:标注落在哪张算哪张,没标注看锚点,标题行与卡前的句算本节第一张)——
 * 不按锚点分拍:「这个成语说的是:[多做一步]」写在卡 0 后面、标注却在卡 1,按拍算会点卡 0 的喇叭亮卡 1。
 * 'all' = 整节。不看念到哪(2026-09-21:原来要那几句都念过才行,孩子在第一张卡念到一半点暂停,整屏一个喇叭都没有);
 * 能不能再听只看板上安不安静(replayQuiet)。老师还在写的节、没讲稿的卡不能([] = 不能)
 */
export function replayLines(sections: readonly BoardSection[], secIdx: number, target: number | 'all'): number[] {
  const s = sections[secIdx];
  if (!s || s.partial || !s.lines.length) return [];
  const all = s.lines.map((_l, i) => i);
  // 提问卡的喇叭 = 再听末句那一问(它自己一拍、没有讲稿)
  if (target !== 'all' && s.cards[target] && isAskCard(s.cards[target])) return all.slice(-1);
  return target === 'all' ? all : all.filter((i) => nowCard(sections, { section: secIdx, line: i, status: 'playing' }) === target);
}

/**
 * 这会儿能不能再听:板上安静才行——停下等答、念完、孩子自己暂停。老师在想、正在念(包括等下一拍、交给场景)都不行:
 * 再听会打断正在念的回答,同一个声音念旧内容听着像答非所问(2026-09-18 真机:念到一半点了田字格的喇叭)。再听中按回放前的位置算
 */
export function replayQuiet(state: PlayerState, pending: boolean): boolean {
  const at = state.replay ? state.replay.back : state;
  return !pending && (at.status === 'waiting' || at.status === 'done' || at.status === 'paused');
}

/** 开始再听:从第一句念起;念完回到原来的位置——在念的变暂停(孩子点播放接着念),等答的还等着。重念中再点别的,回的还是最初的位置 */
export function startReplay(state: PlayerState, secIdx: number, lines: readonly number[]): PlayerState {
  if (!lines.length) return state;
  const at = state.replay ? state.replay.back : state;
  const back: PlayerState = at.status === 'playing' ? { ...at, status: 'paused' } : at;
  return { section: secIdx, line: lines[0], status: 'playing', replay: { lines: [...lines], back } };
}

/** 播到这句该滚到哪张卡:标注所在的卡优先,其次锚点卡,再没有就 null(页面滚到本节第一张) */
export function lineTarget(line: BoardLine): number | null {
  if (line.marks.length) return line.marks[line.marks.length - 1].card;
  return line.anchor;
}

export interface SubtitleInput {
  state: PlayerState;
  sections: readonly BoardSection[];
  pending: boolean;
  /** 孩子发出后等了多久(毫秒):第一拍前等久了换一句 */
  waitedMs: number;
  limit: boolean;
}

export interface SubtitleView {
  text: string;
  /** wait = 第一拍前(板上有占位卡);gap = 拍与拍之间(留着刚念那句,变暗加点);replay = 再听(淡一档、前面一个小喇叭,和老师正在说的分开) */
  kind: 'line' | 'wait' | 'gap' | 'replay' | 'limit' | 'empty';
  /** stop = 再听时的钮(停,回原位置),和暂停 / 播放 / 继续长得不一样 */
  right: 'pause' | 'play' | 'continue' | 'stop' | 'none';
}

/** 第一拍前等过这么久,字幕从「我写给你看」换成「再等我一下下」 */
export const WAIT_LONG_MS = 8000;

/** 字幕行:上限 > 等老师 > 当前句(按播放状态定右侧的钮) */
export function subtitleFor(i: SubtitleInput): SubtitleView {
  if (i.limit) return { text: '今天聊够啦,明天再来', kind: 'limit', right: 'none' };
  const line = i.sections[i.state.section]?.lines[i.state.line];
  const text = line ? plainLine(line.text) : '';
  // 老师还在写:正在播已就绪的句子就照常出字幕;这节念过几句了就留着刚念那句等下一拍;一句还没念(第一拍前)才出等的话
  if (i.state.status === 'thinking' && text) return { text, kind: 'gap', right: 'none' };
  if (i.state.status === 'thinking' || (i.pending && i.state.status !== 'playing' && i.state.status !== 'paused' && i.state.status !== 'stage')) return { text: i.waitedMs < WAIT_LONG_MS ? '我写给你看' : '再等我一下下', kind: 'wait', right: 'none' };
  if (i.state.replay) return { text, kind: 'replay', right: 'stop' };
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

// ---- 播放器(2026-09-18):页面上一切改播放状态的事都走 step,页面只照单执行它回的「要做的事」 ----
// 为什么:以前 27 处直接改状态、20 处停声音,散在十几个事件入口里,「谁能打断谁」只能从这些地方拼出来;
// 再听加进来漏了两处就是真机事故(新回答被打断、「继续」被误点)。仲裁表在《工作流程.md》§孩子端「播放器」,
// 每一格在 tests/player.test.ts 里有一条;不变式用随机事件序列跑。

/** 播放器的全部状态:播到哪、在再听哪个(喇叭变橙、再点一下停)、「继续」在这之前不响应(毫秒时刻) */
export interface PlayerModel {
  state: PlayerState;
  replayOf: { section: number; card: number | 'all' | 'line' } | null;
  contGuardUntil: number;
}

/** step 要读的页面状态(只读) */
export interface PlayerCtx {
  sections: readonly BoardSection[];
  /** 孩子发出了、老师还在想 */
  pending: boolean;
  autoplay: boolean;
  /** 以前的话题:只读回放,不停下等答 */
  readonly: boolean;
  /** 舞台开着 */
  stage: boolean;
  limit: boolean;
  now: number;
}

/**
 * 事件:孩子做的(tap*、segment 点读、stageOpen 点卡、send 发话)、声音的(lineEnded 一句念完、lineMissing 那句不在了)、
 * 老师的(liveStart 第一拍就绪、liveBeat 又一拍、liveFinal 写完了、liveDropped 出错撤掉、fresh 整节到了)、舞台的(stageDone 场景播完或关了)、
 * 页面的(reset 换老师、halt 只停声音:关老师页 / 按住说话 / 清板、autoplayOff 关自动念、jump 调试跳句)
 */
export type PlayerEvent =
  | { type: 'reset' }
  | { type: 'halt' }
  | { type: 'send' }
  | { type: 'tapButton' }
  | { type: 'tapAgain'; section: number; target: number | 'all' }
  | { type: 'tapSubtitle' }
  | { type: 'segment' }
  | { type: 'stageOpen' }
  | { type: 'stageDone' }
  | { type: 'lineEnded' }
  | { type: 'lineMissing' }
  | { type: 'autoplayOff' }
  | { type: 'liveStart'; section: number }
  | { type: 'liveBeat'; section: number }
  | { type: 'liveFinal'; section: number; prevLines: string[] }
  | { type: 'liveDropped' }
  | { type: 'fresh'; sections: number[]; silent: boolean }
  | { type: 'jump'; section: number; line: number };

/**
 * 要做的事,按顺序执行。play / send / openStage / openAsk 会让页面再 dispatch,所以最多一个、且在最后(不变式,测试兜)。
 * stop 只停声音;paint = 把某节前 upTo+1 句的标注画齐(没 upTo 全画);unpaint = 撤掉这几句的标注(再听时重描);
 * replayStart = 解锁声音、田字格这一趟再写的记号清空;scrollLast = 滚到最后一节
 */
export type PlayerEffect =
  | { kind: 'stop' }
  | { kind: 'play' }
  | { kind: 'render' }
  | { kind: 'showNow' }
  | { kind: 'paint'; section: number; upTo?: number }
  | { kind: 'unpaint'; section: number; lines: number[] }
  | { kind: 'replayStart' }
  | { kind: 'openStage'; section: number; card: number }
  | { kind: 'openAsk'; section: number; line: number }
  | { kind: 'send'; action: 'continue' }
  | { kind: 'scrollLast' };

/** 再听停下后「继续」灰这么久:停钮与继续钮在同一个位置,想停再听的那一下别变成「继续」发给老师 */
export const CONT_GUARD_MS = 800;

export function initialPlayer(): PlayerModel {
  return { state: { section: -1, line: -1, status: 'idle' }, replayOf: null, contGuardUntil: 0 };
}

/** 停声音;在再听就回到再听前的位置,念过的标注补齐,「继续」防误点 */
function halt(m: PlayerModel, ctx: PlayerCtx, fx: PlayerEffect[], stopAudio = true): PlayerModel {
  if (stopAudio) fx.push({ kind: 'stop' });
  const r = m.state.replay;
  if (!r) return m;
  const sec = m.state.section;
  const n = spokenLines(r.back, ctx.sections, sec);
  if (n > 0) fx.push({ kind: 'paint', section: sec, upTo: n - 1 });
  fx.push({ kind: 'showNow' });
  return { state: r.back, replayOf: null, contGuardUntil: ctx.now + CONT_GUARD_MS };
}

/** 开始再听:板上要安静、舞台没开;先停掉在念的(包括别的再听) */
function beginReplay(m: PlayerModel, ctx: PlayerCtx, fx: PlayerEffect[], sec: number, lines: number[], target: number | 'all' | 'line'): PlayerModel {
  if (!lines.length || ctx.stage || !replayQuiet(m.state, ctx.pending)) return m;
  fx.push({ kind: 'replayStart' });
  m = halt(m, ctx, fx);
  fx.push({ kind: 'unpaint', section: sec, lines });
  fx.push({ kind: 'play' });
  return { ...m, replayOf: { section: sec, card: target }, state: startReplay(m.state, sec, lines) };
}

/** 状态换了:在念就念,不在念就重画字幕 */
function playOrRender(state: PlayerState, fx: PlayerEffect[]): void {
  fx.push({ kind: state.status === 'playing' ? 'play' : 'render' });
}

export function step(model: PlayerModel, ev: PlayerEvent, ctx: PlayerCtx): { model: PlayerModel; effects: PlayerEffect[] } {
  const fx: PlayerEffect[] = [];
  let m = model;
  const secs = ctx.sections;
  const put = (state: PlayerState): void => { m = { ...m, state }; };
  switch (ev.type) {
    case 'reset':
      m = initialPlayer();
      break;
    case 'halt':
      m = halt(m, ctx, fx);
      break;
    case 'send':
      m = halt(m, ctx, fx);
      if (m.state.status === 'playing' || m.state.status === 'paused' || m.state.status === 'stage') put({ ...m.state, status: 'done' });
      break;
    case 'segment':
      m = halt(m, ctx, fx);
      if (m.state.status === 'playing') { put({ ...m.state, status: 'paused' }); fx.push({ kind: 'render' }); }
      break;
    case 'stageOpen':
      if (m.state.replay) m = halt(m, ctx, fx);
      if (m.state.status === 'playing') { m = halt(m, ctx, fx); put({ ...m.state, status: 'paused' }); fx.push({ kind: 'render' }); }
      break;
    case 'stageDone':
      if (m.state.status !== 'stage') break;
      put(advance({ ...m.state, status: 'playing' }, secs));
      playOrRender(m.state, fx);
      break;
    case 'tapButton':
      if (m.state.replay) { m = halt(m, ctx, fx); fx.push({ kind: 'render' }); }
      else if (m.state.status === 'playing') { m = halt(m, ctx, fx); put({ ...m.state, status: 'paused' }); fx.push({ kind: 'render' }); }
      else if (m.state.status === 'paused') { put({ ...m.state, status: 'playing' }); fx.push({ kind: 'play' }); }
      else if (m.state.status === 'waiting' && ctx.now >= m.contGuardUntil) fx.push({ kind: 'send', action: 'continue' });
      break;
    case 'tapAgain': {
      const r = m.replayOf;
      if (m.state.replay && r && r.section === ev.section && r.card === ev.target) { m = halt(m, ctx, fx); fx.push({ kind: 'render' }); break; }
      m = beginReplay(m, ctx, fx, ev.section, replayLines(secs, ev.section, ev.target), ev.target);
      break;
    }
    case 'tapSubtitle': {
      const st = m.state;
      const s = secs[st.section];
      if (ctx.stage || ctx.pending || !s || s.partial || st.line < 0 || st.replay || !(st.status === 'paused' || st.status === 'waiting' || st.status === 'done')) break;
      if (subtitleFor({ state: st, sections: secs, pending: ctx.pending, waitedMs: 0, limit: ctx.limit }).kind !== 'line') break;
      m = beginReplay(m, ctx, fx, st.section, [st.line], 'line');
      break;
    }
    case 'lineMissing':
      put({ ...m.state, status: 'done' });
      fx.push({ kind: 'render' });
      break;
    case 'lineEnded': {
      const st = m.state;
      if (st.status !== 'playing') break;
      // 再听:只念句子,不执行 cue、不推答题卡;念完回到原来的位置
      if (st.replay) {
        const a = advance(st, secs);
        if (a.replay) { put(a); fx.push({ kind: 'play' }); }
        else { m = halt(m, ctx, fx, false); fx.push({ kind: 'render' }); }
        break;
      }
      // [[play]]:念完这句把场景铺满播,播完(stageDone)再接着念
      const line = secs[st.section]?.lines[st.line];
      const cue = line?.cues.find((c) => c.name === 'play');
      const card = cue ? secs[st.section].cards[cue.card] : undefined;
      if (cue && card && card.kind === 'scene' && sceneReady(card)) { put({ ...st, status: 'stage' }); fx.push({ kind: 'openStage', section: st.section, card: cue.card }); break; }
      let next = advance(st, secs);
      if (ctx.readonly && next.status === 'waiting') next = { ...next, status: 'done' };
      put(next);
      if (next.status === 'playing') fx.push({ kind: 'play' });
      else { fx.push({ kind: 'render' }); if (next.status === 'waiting') fx.push({ kind: 'openAsk', section: next.section, line: st.line }); }
      break;
    }
    case 'autoplayOff':
      if (m.state.status !== 'playing') break;
      m = halt(m, ctx, fx);
      fx.push({ kind: 'paint', section: m.state.section });
      put(playerAtEnd(secs));
      fx.push({ kind: 'render' }, { kind: 'showNow' });
      break;
    case 'liveStart': {
      const idx = ev.section;
      if (ctx.autoplay) { m = halt(m, ctx, fx); put(startSection(idx, secs)); playOrRender(m.state, fx); break; }
      if (m.state.replay) m = halt(m, ctx, fx);
      fx.push({ kind: 'paint', section: idx });
      put({ section: idx, line: playableLines(secs[idx]) - 1, status: 'thinking' });
      fx.push({ kind: 'render' }, { kind: 'showNow' });
      break;
    }
    case 'liveBeat': {
      const idx = ev.section;
      // 等下一拍时孩子在再听前面的,新的一拍到了:让给老师
      const B = m.state.replay?.back;
      if (B && B.section === idx && B.status === 'thinking' && playableLines(secs[idx]) > B.line + 1) m = halt(m, ctx, fx);
      if (m.state.section !== idx || m.state.status !== 'thinking') break;
      if (ctx.autoplay) { put(advance(m.state, secs)); playOrRender(m.state, fx); }
      else { fx.push({ kind: 'paint', section: idx }); put({ ...m.state, line: playableLines(secs[idx]) - 1 }); fx.push({ kind: 'render' }); }
      break;
    }
    case 'liveFinal': {
      const idx = ev.section;
      // 老师写完了,再听让给它接着念
      if (m.state.replay && m.state.replay.back.section === idx) m = halt(m, ctx, fx);
      // 正式节应该就是各拍的拼接;万一句的下标对不上,按正在播的那句的文字找回位置,不倒回去、不念两遍
      const st = m.state;
      if (st.section === idx && st.line >= 0) {
        const cur = ev.prevLines[st.line];
        const j = cur === undefined ? -1 : secs[idx].lines.findIndex((l) => l.text === cur);
        if (j >= 0 && j !== st.line) put({ ...st, line: j });
      }
      if (m.state.section !== idx) { fx.push({ kind: 'paint', section: idx }); break; }
      fx.push({ kind: 'paint', section: idx, upTo: m.state.line });
      if (m.state.status !== 'thinking') { fx.push({ kind: 'showNow' }); break; }
      if (!ctx.autoplay) { fx.push({ kind: 'paint', section: idx }); put(playerAtEnd(secs)); fx.push({ kind: 'render' }, { kind: 'showNow' }); break; }
      const next = advance(m.state, secs);
      put(next);
      if (next.status === 'playing') { fx.push({ kind: 'showNow' }, { kind: 'play' }); break; }
      fx.push({ kind: 'render' }, { kind: 'showNow' });
      if (next.status === 'waiting') fx.push({ kind: 'openAsk', section: idx, line: next.line });
      break;
    }
    case 'liveDropped':
      m = halt(m, ctx, fx);
      put(playerAtEnd(secs));
      fx.push({ kind: 'render' });
      break;
    case 'fresh': {
      if (!ev.sections.length) break;
      if (ev.silent || !ctx.autoplay) {
        // 新的一节来了,再听停下
        if (m.state.replay) m = halt(m, ctx, fx);
        for (const i of ev.sections) fx.push({ kind: 'paint', section: i });
        put(playerAtEnd(secs));
        fx.push({ kind: 'render' }, { kind: 'showNow' }, { kind: 'scrollLast' });
        break;
      }
      m = halt(m, ctx, fx);
      put(startSection(ev.sections[0], secs));
      playOrRender(m.state, fx);
      break;
    }
    case 'jump': {
      m = halt(m, ctx, fx);
      const sec = ev.section, line = ev.line;
      for (let i = 0; i < sec; i++) fx.push({ kind: 'paint', section: i });
      fx.push({ kind: 'paint', section: sec, upTo: line });
      const l = secs[sec]?.lines[line];
      const waiting = Boolean(l && l.ask && line === secs[sec].lines.length - 1 && sec === secs.length - 1);
      put({ section: sec, line, status: waiting ? 'waiting' : 'paused' });
      fx.push({ kind: 'render' }, { kind: 'showNow' });
      break;
    }
  }
  return { model: m, effects: fx };
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

/**
 * 一处标注在这句里什么时候画(2026-09-13):没有字级时间戳(voxtell align 还是规划),按字数比例估——中文每字语速很均匀,
 * 20 字一句误差两三百毫秒。词取 said(后期填的讲稿里的词),没有就拿 phrase 在讲稿里找;讲稿里没这个词 → null(句首就画,同以前)。
 * totalMs = 这句声音的总时长(mp3 的 duration,或没声音时的 lineDurationMs)。dur 最短 350ms,描线不至于一闪。
 */
export function markTiming(line: BoardLine, mark: BoardMark, totalMs: number): { at: number; dur: number } | null {
  const text = plainLine(line.text);
  const word = mark.said || mark.phrase;
  const i = findPhrase(text, word);
  if (i < 0 || !text.length || !(totalMs > 0)) return null;
  const chars = Array.from(text).length;
  const before = Array.from(text.slice(0, i)).length;
  const len = Array.from(word).length;
  return { at: Math.round((totalMs * before) / chars), dur: Math.max(350, Math.round((totalMs * len) / chars)) };
}

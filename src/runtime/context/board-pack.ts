/**
 * 以板为主的话题:每一轮给老师的那段「板此刻的样子」(上下文包的 board:,形状在 schema 的 ContextPack.slate)。纯函数。
 * 文字每一轮都给;图只在文字说不清时给(孩子交板,src/brain/ 的 boards)。2026-11-13《画板为主设计》下篇「老师怎么看到板」:
 *   底       孩子拍的那张(路径,认出了课名就带上),没有照片就是白板
 *   题       作业照片上认出的题号(分题:框写「第 3 题」就裁出那一道)
 *   全文     底上认出的正文:换底以后第一次认完那一轮给全,之后只写「未变」;还在认写「还在认」;这一轮刚发的照片不写(图随这一轮附上)
 *   你画的   老师上一次在板上画的(那张板卡的参数,图不算)
 *   开放     现在孩子能做的操作
 *   孩子做的 从上一轮到现在孩子在板上做的,合并过(点开看了哪几个字、各几次;课本上写画了几笔、擦过没有)
 *   最近点的 30 秒内点的最后一项(孩子说「这个」时指它)
 *   孩子在看 课本做底时:孩子自己挪了窗、停下来的地方(上一轮以后的最后一次)
 * 整段控制在 SLATE_MAX 字以内(课本 BOOK_SLATE_MAX):超了先截全文。
 * 课本做底(book)时:底是「课本《册》:《课》第几页」,全文是这一课分好段的正文(src/chalk/kit/book.ts 的 lessonBlocks),目录时是一单元一行。
 */
import { BOOK_TOC, lessonBlocks } from '../../chalk/index.ts';
import { lessonPage, lessonStrip } from '../../board/lesson.ts';
import { stripRead } from '../../board/strip.ts';
import type { BoardEvent, BookIndex, BookPage, ContextPack, Lesson, StripItem } from '../../schema/index.ts';

/** 「最近点的」多久以内算(孩子说「这个」指它);起点,试用后调 */
export const RECENT_PICK_MS = 30_000;
/** 板的说明最多多少字 */
export const SLATE_MAX = 600;
/** 课本做底时最多多少字:一课的正文(坐井观天带认字栏、课后题约 500 字,语文园地约 900)或整册目录要给全 */
export const BOOK_SLATE_MAX = 2400;
export const WHITE_BOARD = '白板';

export interface SlateInput {
  /** 底:孩子最近发的那张照片(相对 workspace 根);null = 白板 */
  photo: string | null;
  /** 这一轮孩子刚发了这张照片(图随这一轮附上,全文还没认) */
  fresh: boolean;
  /** 底上认出的东西(src/scenes/photo-words/store.ts 的那份);没认、白板 = null */
  words: { state: 'running' | 'done' | 'failed'; lesson: string | null; full: readonly string[]; questions?: readonly string[] } | null;
  /** 这个话题板的日志 */
  events: readonly BoardEvent[];
  /** 老师上一次在这块底上画的板卡:画法与参数、开放的操作;还没画 = null */
  kit: { kit: string; params: Readonly<Record<string, string>>; ops: readonly string[] } | null;
  /** 老师还没画时孩子就能做的(照片底开了认字 = 点字) */
  ops: readonly string[];
  /** 一节课的状态说成的那几样(课本做底时代替 kit 与 ops;lessonSlateBits) */
  lesson?: LessonBits;
  /** 这一刻(毫秒) */
  now: number;
  /**
   * 课本做底(base: textbook)时代替 photo / words:show 给老师看的底(「课本《语文二年级上册》:《坐井观天》第 54–55 页」),
   * key 板的日志里这块底的名字(「册子#课」),text 这一课的正文(一块一行;目录是一单元一行)
   */
  book?: { show: string; key: string; text: readonly string[]; /** 这一轮附了窗里的图(舞台交来的,孩子眼前那一块) */ shot?: boolean };
}

const ago = (ms: number): string => `${Math.max(1, Math.round(ms / 1000))} 秒前`;

/** 老师画的那张板卡说成一行:画法加上写了的参数(照片的「图」就是底,不重复) */
export function drawnLine(kit: NonNullable<SlateInput['kit']>): string {
  // 圈、遮写的字词只说字(框是应用找的);写的字照「字 在 位置」
  const named = (v: string): string => v.split(';').map((x) => (x.includes('|') ? x.split('|')[0] || x.split('|')[1] : x)).join('、');
  const parts = Object.entries(kit.params).filter(([k, v]) => v && k !== '图').map(([k, v]) => `${k} ${k === '圈' || k === '遮' || k === '盖' || k === '看' || (k === '框' && v.includes('|')) ? named(v) : v.split(';').map((x) => x.replace(/\|$/, '').replace(/\|/g, ' 在 ')).join(';')}`);
  return parts.length ? `${kit.kit}:${parts.join(';')}` : kit.kit;
}

/** 点开看的那些合并成一句:「点开看了笔顺:傍(2 次)、晒」;英文单词「点开看了单词:yellow(2 次)」 */
function pickLine(picks: readonly string[], what: string): string | null {
  if (!picks.length) return null;
  const n = new Map<string, number>();
  for (const p of picks) n.set(p, (n.get(p) ?? 0) + 1);
  return `点开看了${what}:${[...n].map(([w, k]) => (k > 1 ? `${w}(${k} 次)` : w)).join('、')}`;
}
const isEnglish = (t: string): boolean => /^[A-Za-z]/.test(t);

/** 一节课的状态里给老师看的那几样:你画的(一行)、开放的、遮了 / 盖了哪些、揭开了哪些 */
export interface LessonBits { drawn?: string; ops: string[]; covers: Record<'遮' | '盖', string[]>; revealed: string[]; /** 孩子在开着的白纸条上做的(每个图形一句,src/board/strip.ts 的 stripRead) */ strip?: string[] }

/** 白纸条里的一样说成几个字:点阵 6 行 6 个、方向盘(上 东)、写 6×4=24 */
export function stripItemLine(it: StripItem): string {
  if (it.kind === 'write') return `写 ${it.text}`;
  const p = it.params;
  if (it.kit === '点阵') return `点阵 ${p['共'] ? `共 ${p['共']} 个、每行 ${p['每行']} 个` : `${p['行']} 行 ${p['每行']} 个`}${p['线'] ? `(线 ${p['线']})` : ''}`;
  if (it.kit === '方向盘') return `方向盘(上 ${p['上'] ?? '北'}${p['小人'] === '没有' ? ',没有小人' : ''})`;
  return it.kit;
}

/**
 * 一节课现在这一页上:你画的(看哪里、圈 / 遮 / 盖了什么、白纸条里摆着什么,应用找的框不说)、开放的(点字是课本自带的,别的是你请的)。
 * 白纸条收着的(讲别的题时)不说,回到那道题才说
 */
export function lessonSlateBits(l: Lesson): LessonBits {
  const p = lessonPage(l);
  if (!p) return { ops: [], covers: { 遮: [], 盖: [] }, revealed: [] };
  const of = (k: '圈' | '遮' | '盖'): string[] => p.teacher.marks.filter((m) => m.k === k).map((m) => m.text);
  const strip = lessonStrip(l);
  const parts = [
    ...(l.look ? [`看 ${l.look.label}`] : []),
    ...(['圈', '遮', '盖'] as const).flatMap((k) => (of(k).length ? [`${k} ${of(k).join('、')}`] : [])),
    ...(strip?.items.length ? [`白纸条:${strip.items.map(stripItemLine).join('、')}`] : []),
  ];
  const asked = p.open.map((o) => (o === '点' ? '点字' : o));
  const onStrip = strip ? stripRead(strip, p.kid.stripInk[strip.key] ?? [], p.kid.turns) : [];
  return { ...(parts.length ? { drawn: parts.join(';') } : {}), ops: [...new Set([...(p.pick ? ['点字'] : []), ...asked])], covers: { 遮: of('遮'), 盖: of('盖') }, revealed: [...p.kid.revealed], ...(onStrip.length ? { strip: onStrip } : {}) };
}

/** 板此刻的样子;told = 这一轮把这块底的全文给了老师(记进日志,下一轮写「未变」) */
export function slateOf(x: SlateInput): { slate: NonNullable<ContextPack['slate']>; told?: string } {
  const base = x.book ? x.book.key : (x.photo ?? WHITE_BOARD);
  const onBase = (e: BoardEvent): e is BoardEvent & { k: 'pick' } => e.k === 'pick' && e.base === base;
  // 上一轮交给老师以后的事
  let from = 0;
  x.events.forEach((e, i) => { if (e.k === 'turn') from = i + 1; });
  const since = x.events.slice(from);
  const picked = since.filter(onBase).map((e) => e.text);
  const did = [pickLine(picked.filter((t) => !isEnglish(t)), '笔顺'), pickLine(picked.filter(isEnglish), '单词')].filter((s): s is string => Boolean(s));
  // 课本上写画的:几笔(笔画本身看图)、擦没擦过
  const inks = since.filter((e): e is BoardEvent & { k: 'ink' } => e.k === 'ink' && e.base === base);
  const wiped = inks.map((e) => Boolean(e.wipe)).lastIndexOf(true);
  const strokes = inks.slice(wiped + 1).length;
  if (wiped >= 0) did.push('擦掉了自己画的');
  if (strokes) did.push(`在课本上写画了 ${strokes} 笔(写了什么看图)`);
  // 白纸条上的图形:画法照几何算的大概(状态,不是这一轮才做的;以图为准)
  if (x.lesson?.strip) did.push(...x.lesson.strip);
  // 遮了拼音的、盖住印好的字的(课本):揭了哪些、没揭哪些(这块底上揭过的都算)
  const opened = new Set([...x.events.filter((e): e is BoardEvent & { k: 'reveal' } => e.k === 'reveal' && e.base === base).map((e) => e.text), ...(x.lesson?.revealed ?? [])]);
  for (const [key, what] of [['遮', '揭开了拼音'], ['盖', '揭开了盖住的']] as const) {
    const covered = x.lesson ? x.lesson.covers[key] : x.kit?.params[key] ? x.kit.params[key].split(';').map((v) => v.split('|')[0]).filter(Boolean) : [];
    if (!covered.length) continue;
    const yes = covered.filter((w) => opened.has(w)), no = covered.filter((w) => !opened.has(w));
    did.push(`${what}:${yes.length ? yes.join('、') : '一个也没有'}${no.length ? `;没揭:${no.join('、')}` : ''}`);
  }
  const last = [...x.events].reverse().find(onBase);
  const lastMs = last ? x.now - Date.parse(last.at) : Infinity;
  const recent = last && lastMs >= 0 && lastMs <= RECENT_PICK_MS ? `${last.text}(${ago(lastMs)})` : undefined;
  let text: string[] | undefined;
  let told: string | undefined;
  if (x.book) {
    // 课本:这一课的正文第一次给全,之后「未变」(同照片)
    if (x.events.some((e) => e.k === 'turn' && e.told === x.book!.key)) text = ['未变'];
    else if (x.book.text.length) { text = [...x.book.text]; told = x.book.key; }
  } else if (x.photo && !x.fresh && x.words) {
    const toldBefore = x.events.some((e) => e.k === 'turn' && e.told === x.photo);
    if (toldBefore) text = ['未变'];
    else if (x.words.state === 'running') text = ['还在认'];
    else if (x.words.full.length) { text = [...x.words.full]; told = x.photo; }
  }
  const lesson = x.words?.lesson;
  // 孩子眼前是哪一块:上一轮以后窗最后停下的地方(他自己挪的,或老师让他看的那一块移完);附了图的说一句
  const stop = x.book ? [...since].reverse().find((e): e is BoardEvent & { k: 'view' | 'shot' } => (e.k === 'view' || e.k === 'shot') && e.base === base)?.text : undefined;
  const view = stop && x.book?.shot ? `${stop}(这一块的图附在这一轮)` : stop;
  const slate: NonNullable<ContextPack['slate']> = {
    base: x.book ? x.book.show : x.photo ? (lesson ? `${x.photo}(《${lesson}》)` : x.photo) : WHITE_BOARD,
    ...(text ? { text } : {}),
    ...(x.words?.questions?.length ? { questions: `${x.words.questions.map((n) => `第${n}题`).join('、')}(框写题号就裁出那一道)` } : {}),
    ...(x.lesson ? (x.lesson.drawn ? { drawn: x.lesson.drawn } : {}) : x.kit ? { drawn: drawnLine(x.kit) } : {}),
    ops: [...(x.lesson ? x.lesson.ops : x.kit ? x.kit.ops : x.ops)],
    did,
    ...(recent ? { recent } : {}),
    ...(view ? { view } : {}),
  };
  // 超了先截全文(从后往前),截掉的说一句
  const size = (s: typeof slate): number => JSON.stringify(s).length;
  const max = x.book ? BOOK_SLATE_MAX : SLATE_MAX;
  if (slate.text && slate.text.length > 1 && size(slate) > max) {
    const all = slate.text;
    let keep = all.length;
    while (keep > 1 && size({ ...slate, text: [...all.slice(0, keep), '…'] }) > max) keep--;
    slate.text = [...all.slice(0, keep), `…(后面还有 ${all.length - keep} 行,${x.book ? '看图' : '看照片'})`];
  }
  return { slate, ...(told ? { told } : {}) };
}

/**
 * 课本做底时给老师看的底与全文(SlateInput.book 的 show、text):
 * 一课 = 分好的段(「第3段 小鸟回答说……」)、栏目(「【日积月累】……」)、课文后面的认字栏和课后题(带读音的写读音),换页处插一行「—— 第 55 页 ——」;
 * 数学 = 标题(「标题:6的乘法口诀」)、例题(「例4 ……」)、栏目(「【练一练】」)和下面的题(「第3题 ……」);图上的东西读不到,只有字。
 * 目录 = 一单元一行,课名后面是印的页码(老师照孩子说的课写「课: 坐井观天」);数学一个单元一行,后面是它下面的小节、课题(课题前带点)。
 */
export function bookSlateParts(index: BookIndex, at: { title: string; pages: readonly BookPage[] }): { show: string; text: string[] } {
  if (at.title === BOOK_TOC) {
    const show = `课本《${index.title}》:目录(还没翻到哪一课)`;
    if (index.layout === 'math') {
      const tops = new Map<string, string[]>();
      const top = new Set(index.lessons.filter((l) => !l.parent).map((l) => l.title));
      for (const l of index.lessons) {
        const at = `${l.title}(${l.from})`;
        if (!l.parent) tops.set(`${l.no ? `${l.no} ` : ''}${at}`, []);
        else [...tops.values()].pop()?.push(top.has(l.parent) ? at : `·${at}`);
      }
      return { show, text: [...tops].map(([t, xs]) => (xs.length ? `${t}:${xs.join('、')}` : t)) };
    }
    const units = new Map<string, string[]>();
    for (const l of index.lessons) {
      const u = l.unit ?? '附录';
      units.set(u, [...(units.get(u) ?? []), `${l.parent ? '·' : ''}${l.no ? `${l.no} ` : ''}${l.title}(${l.from})`]);
    }
    return { show, text: [...units].map(([u, xs]) => `${u}:${xs.join('、')}`) };
  }
  const printed = at.pages.map((p) => p.printed).filter((n): n is number => n !== null);
  const range = printed.length ? `第 ${printed[0]}${printed.length > 1 ? `–${printed[printed.length - 1]}` : ''} 页` : '';
  const math = index.layout === 'math';
  const text: string[] = [];
  let page: number | null = null;
  for (const b of lessonBlocks(at.pages, index.layout)) {
    const n = b.refs[0]?.n ?? null;
    const pr = at.pages.find((p) => p.n === n)?.printed ?? null;
    if (n !== page && page !== null && pr !== null) text.push(`—— 第 ${pr} 页 ——`);
    page = n;
    if (b.kind === 'title') { if (math) text.push(`标题:${b.text}`); continue; }
    text.push(b.kind === 'para' ? `第${b.no}段 ${b.text}` : b.kind === 'section' ? `【${b.head}】${b.text}` : b.kind === 'example' ? `例${b.no} ${b.text}` : b.kind === 'problem' ? `第${b.no}题 ${b.text}` : b.text);
  }
  return { show: `课本《${index.title}》:《${at.title}》${range}`, text };
}

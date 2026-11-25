/**
 * 一节课(铺着页的 activity):每一轮给老师的「页此刻的样子」(上下文包的 board:,形状在 schema 的 ContextPack.slate)和页的文字层(pageNotes)。纯函数。
 * 按变得多快分两层:
 *   页的文字层  这一页(课本的一课、照片的一张)印的字:第一次看到那一页时当一条笔记给(<page>),之后不重给;压缩以后重给现在这一页
 *   board:      每轮会变的——
 *     底       现在铺的是哪一页(课本《册》:《课》第几页 / 作业照片几张 / 白纸);这节课铺过几页就列出来(页集)
 *     你画的   看哪里、遮 / 盖了什么、白纸条里摆着什么(应用找的框不说;圈、划、加点不说,上一轮的这一轮一开口就收)
 *     开放     现在孩子能做的(点字是页自带的,别的是你请的)
 *     孩子做的 从上一轮到现在孩子在页上做的,合并过(自己翻到了哪一页、点开看了哪几个字、写画了几笔、擦过没有、在田字格里写了几个字、揭了哪些、白纸条上的图形)
 *     最近点的 30 秒内点的最后一项(孩子说「这个」时指它)
 *     孩子在看 上一轮以后窗最后停下的地方(他自己挪的,或你让他看的那一块移完);附了那一块的图就注一句
 */
import { BOOK_TOC, zoneBlocks } from '../../chalk/index.ts';
import { lessonPage, lessonStrip } from '../../board/lesson.ts';
import { stripRead } from '../../board/strip.ts';
import { PHOTO_PAGE, type BoardEvent, type BookIndex, type BookPage, type ContextPack, type ZonePage, type Lesson, type MarkName, type StripItem } from '../../schema/index.ts';

/** 「最近点的」多久以内算(孩子说「这个」指它);起点,试用后调 */
export const RECENT_PICK_MS = 30_000;
/** 一页的文字层最多多少字:一课的正文(坐井观天带认字栏、课后题约 500 字,语文园地约 900)、整册目录、一张作业照片都要给全 */
export const PAGE_NOTE_MAX = 2400;

/** 页的文字层的一条笔记:id 是板的日志里记「给过了」的键(课本「册子#课」、照片「作业#<路径>」),name 给老师看 */
export interface PageNote { id: string; name: string; text: string[] }

export interface SlateInput {
  /** 现在铺的那一页给老师看的名字;id 是它在板的日志里的 base */
  page: { id: string; show: string };
  /** 这节课铺过的别的页(页集;翻回去用),给老师看的名字 */
  others: readonly string[];
  /** 这个话题板的日志 */
  events: readonly BoardEvent[];
  /** 一节课的状态说成的那几样(lessonSlateBits) */
  lesson: LessonBits;
  /** 这一刻(毫秒) */
  now: number;
  /** 这一轮附了窗里的图(舞台交来的,孩子眼前那一块) */
  shot?: boolean;
  /** 孩子这一条带来的、板的日志里没有的(小课堂:看的情况、画的几处),接在「孩子做的」最前面 */
  did?: readonly string[];
}

const ago = (ms: number): string => `${Math.max(1, Math.round(ms / 1000))} 秒前`;

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
 * 一节课现在这一页上:你画的(看哪里、遮 / 盖了什么、白纸条里摆着什么,应用找的框不说)、开放的(点字是页自带的,别的是你请的)。
 * 圈、划、加点不说:这时候页上还有的都是上一轮的,老师这一轮一开口(round)就收掉,说了老师会以为还圈着;要接着看得再圈。
 * 白纸条收着的(讲别的题时)不说,回到那道题才说
 */
export function lessonSlateBits(l: Lesson): LessonBits {
  const p = lessonPage(l);
  if (!p) return { ops: [], covers: { 遮: [], 盖: [] }, revealed: [] };
  const of = (k: MarkName): string[] => [...new Set(p.teacher.marks.filter((m) => m.k === k).map((m) => m.text))];
  const strip = lessonStrip(l);
  const parts = [
    ...(l.look ? [`看 ${l.look.label}`] : []),
    ...(['遮', '盖'] as const).flatMap((k) => (of(k).length ? [`${k} ${of(k).join('、')}`] : [])),
    ...(strip?.items.length ? [`${p.kind === 'white' ? '白纸上' : '白纸条'}:${strip.items.map(stripItemLine).join('、')}`] : []),
  ];
  const asked = p.open.map((o) => (o === '点' ? '点字' : o));
  const onStrip = strip ? stripRead(strip, p.kid.stripInk[strip.key] ?? [], p.kid.turns) : [];
  return { ...(parts.length ? { drawn: parts.join(';') } : {}), ops: [...new Set([...(p.pick ? ['点字'] : []), ...asked])], covers: { 遮: of('遮'), 盖: of('盖') }, revealed: [...p.kid.revealed], ...(onStrip.length ? { strip: onStrip } : {}) };
}

/** 页此刻的样子 */
export function slateOf(x: SlateInput): NonNullable<ContextPack['slate']> {
  const base = x.page.id;
  const onBase = (e: BoardEvent): e is BoardEvent & { k: 'pick' } => e.k === 'pick' && e.base === base;
  // 上一轮交给老师以后的事
  let from = 0;
  x.events.forEach((e, i) => { if (e.k === 'turn') from = i + 1; });
  const since = x.events.slice(from);
  const picked = since.filter(onBase).map((e) => e.text);
  // 他自己翻过去的(目录上点了一课、按「目录」回去):只说最后那次,翻到的就是现在这一页
  const turned = [...since].reverse().find((e): e is BoardEvent & { k: 'open' } => e.k === 'open' && e.base === base);
  const did = [...(x.did ?? []), ...(turned ? [turned.text === BOOK_TOC ? '自己按「目录」翻回了目录' : turned.base === PHOTO_PAGE || turned.base.startsWith(`${PHOTO_PAGE}#`) ? `自己翻到了作业本的《${turned.text}》` : `自己在目录上点了《${turned.text}》,翻到了这一课`] : []), pickLine(picked.filter((t) => !isEnglish(t)), '笔顺'), pickLine(picked.filter(isEnglish), '单词')].filter((s): s is string => Boolean(s));
  // 页上写画的:几笔(笔画本身看图)、擦没擦过
  const inks = since.filter((e): e is BoardEvent & { k: 'ink' } => e.k === 'ink' && e.base === base);
  const wiped = inks.map((e) => Boolean(e.wipe)).lastIndexOf(true);
  const strokes = inks.slice(wiped + 1).length;
  if (wiped >= 0) did.push('擦掉了自己画的');
  if (strokes) did.push(`在页上写画了 ${strokes} 笔(写了什么看图)`);
  // 课本的田字格里写的字(放好的):几格、照着哪几个字写的;写成什么样看图
  const cells = since.filter((e): e is BoardEvent & { k: 'cell' } => e.k === 'cell' && e.base === base);
  const wrote = cells.filter((e) => !e.clear && !e.blank), models = [...new Set(wrote.flatMap((e) => (e.text ? [e.text] : [])))];
  if (wrote.length) did.push(`在田字格里写了 ${wrote.length} 个字${models.length ? `(照着「${models.join('」「')}」写的)` : ''},写成什么样看图`);
  const filled = cells.filter((e) => !e.clear && e.blank).length;
  if (filled) did.push(`在页上的空(方框、括号)里填了 ${filled} 处,填的什么看图`);
  if (cells.some((e) => e.clear)) did.push('擦掉了格子里写的');
  // 点读:点了标题或段首听课文(放的是录好的配音,不是你说的);一回一句,最多说最后三回
  const part = (n: number): string => (n === 0 ? '标题' : `第 ${n} 段`);
  const reads = since.filter((e): e is BoardEvent & { k: 'read' } => e.k === 'read' && e.base === base);
  for (const e of reads.slice(-3)) did.push(`自己点了课文听(点读的配音):${e.from === e.to ? `读了${part(e.from)}` : `从${part(e.from)}读到${part(e.to)}`}${e.done ? ',读完了全文' : `,在${part(e.to)}停了`}`);
  // 白纸条上的图形:画法照几何算的大概(状态,不是这一轮才做的;以图为准)
  if (x.lesson.strip) did.push(...x.lesson.strip);
  // 遮了拼音的、盖住印好的字的:揭了哪些、没揭哪些(这一页上揭过的都算)
  const opened = new Set(x.lesson.revealed);
  for (const [key, what] of [['遮', '揭开了拼音'], ['盖', '揭开了盖住的']] as const) {
    const covered = x.lesson.covers[key];
    if (!covered.length) continue;
    const yes = covered.filter((w) => opened.has(w)), no = covered.filter((w) => !opened.has(w));
    did.push(`${what}:${yes.length ? yes.join('、') : '一个也没有'}${no.length ? `;没揭:${no.join('、')}` : ''}`);
  }
  const last = [...x.events].reverse().find(onBase);
  const lastMs = last ? x.now - Date.parse(last.at) : Infinity;
  const recent = last && lastMs >= 0 && lastMs <= RECENT_PICK_MS ? `${last.text}(${ago(lastMs)})` : undefined;
  // 孩子眼前是哪一块:上一轮以后窗最后停下的地方(他自己挪的,或老师让他看的那一块移完);附了图的说一句
  const stop = [...since].reverse().find((e): e is BoardEvent & { k: 'view' | 'shot' } => (e.k === 'view' || e.k === 'shot') && e.base === base)?.text;
  const view = stop && x.shot ? `${stop}(这一块的图附在这一轮)` : stop;
  return {
    base: x.page.show,
    ...(x.others.length ? { pages: `还铺过:${x.others.join('、')}(翻回去写 [[翻 …]])` } : {}),
    ...(x.lesson.drawn ? { drawn: x.lesson.drawn } : {}),
    ops: [...x.lesson.ops],
    did,
    ...(recent ? { recent } : {}),
    ...(view ? { view } : {}),
  };
}

/** 一条页的笔记太长就从后面截(截掉的说一句) */
export function clipNote(text: readonly string[], max = PAGE_NOTE_MAX): string[] {
  const all = [...text];
  let keep = all.length, size = all.reduce((n, t) => n + t.length + 1, 0);
  while (keep > 1 && size > max) { keep--; size -= all[keep].length + 1; }
  return keep < all.length ? [...all.slice(0, keep), `…(后面还有 ${all.length - keep} 行,看图)`] : all;
}

/**
 * 课本给老师看的底与文字层:
 * 一课 = 分好的段(「第3段 小鸟回答说……」)、栏目(「【日积月累】……」)、课文后面的认字栏和课后题(带读音的写读音),换页处插一行「—— 第 55 页 ——」;
 * 数学 = 标题(「标题:6的乘法口诀」)、例题(「例4 ……」)、栏目(「【练一练】」)和下面的题(「第3题 ……」);图上的东西读不到,只有字。
 * 科学 = 栏目(「【探索与实践 1】」)、段(段号整课连着数)、图里和表里的字。
 * 目录 = 一单元一行,课名后面是印的页码(老师照孩子说的课写「课: 坐井观天」);数学一个单元一行,后面是它下面的小节、课题(课题前带点)。
 * zones = 这一课挑好的分块(schema 的 pickZones);last = 这本书上次翻到的那一课(src/runtime/journal/book-last.ts),目录的那一句里说一下。
 */
export function bookSlateParts(index: BookIndex, at: { title: string; pages: readonly BookPage[] }, zones: readonly ZonePage[], last?: string | null): { show: string; text: string[] } {
  if (at.title === BOOK_TOC) {
    const show = `课本《${index.title}》:目录(还没翻到哪一课${last ? `;上次翻到《${last}》` : ''})`;
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
  for (const b of zoneBlocks(at.pages, zones, index.layout)) {
    const n = b.refs[0]?.n ?? null;
    const pr = at.pages.find((p) => p.n === n)?.printed ?? null;
    if (n !== page && page !== null && pr !== null) text.push(`—— 第 ${pr} 页 ——`);
    page = n;
    if (b.kind === 'title') { if (math) text.push(`标题:${b.text}`); continue; }
    text.push(b.kind === 'para' ? `第${b.no}段 ${b.text}` : b.kind === 'section' ? `【${b.head}】${b.text}` : b.kind === 'example' ? `例${b.no} ${b.text}` : b.kind === 'problem' ? `第${b.no}题 ${b.text}` : b.text);
  }
  return { show: `课本《${index.title}》:《${at.title}》${range}`, text };
}

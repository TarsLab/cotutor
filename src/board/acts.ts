/**
 * 讲稿里的 `[[名 参数]]` 都在这里读(2026-11-16《多模态教学harness-开发计划》阶段 2 任务 1):
 *  - 老师的动作:看、圈、遮、盖、写、擦、摆、请、翻(src/schema/lesson.ts 的 ACT_NAMES),写在句子后面,这句念完才生效;
 *  - 小课堂的 [[play]]:对上一张卡的动作(cue),念完放那一段;
 * 纯函数,永不抛:不认得的、写错的回 bad(解析器丢掉它、给家长记一行)。
 * 每种动作的写法(也是给老师的说明,见 ACT_GUIDE):
 *   看 第 3 题 / 例 2 / 练一练第 3 题 / 第 55 页 / 栏目名 / 课本上的一句原话
 *   圈 心理辅导室、井沿(最多 4 处)   遮 傍晚、晒(拼音盖住,最多 8 处)   盖 3×5=15(印好的答案盖住,最多 8 处)
 *   写 6×4=24(白纸条里写一行字,最多 16 个字;前后可带 大 / 中 / 小)
 *   擦(擦掉自己上一样)/ 擦 全部(整条白纸条)
 *   摆 点阵 6 行 6 个 / 摆 方向盘 上 东(白纸条里摆一个图形;可带 大 / 中 / 小)
 *   请 圈 / 请 写、圈(开放哪些作答:写、圈、点、涂、切、转、说、添)
 *   请 说 duck / 请 说 The ducks are under the bus(请孩子说出这一句:念完停下等他说,应用比转写,说了接着念下一句;2026-11-17 阶段 4 任务 1,原来的 [[echo]] [[say]])
 *   翻 6的乘法口诀 / 翻 目录(换一课)
 */
import { kitOf, readKitLines } from '../chalk/index.ts';
import { ACT_NAMES, ASK_NAMES, SIZES, type ActName, type AskName, type LineAct, type Size } from '../schema/index.ts';

/** [[...]] 里的一处读成什么 */
export type Mark =
  | { kind: 'act'; act: LineAct; /** 读成了,但丢了一部分(请里不认得的那几个) */ warn?: string }
  | { kind: 'cue'; name: string; arg?: string }
  | { kind: 'bad'; text: string; why: string };

/** 卡上的动作(锚到上一张卡):只剩小课堂的 play */
const CUES = new Set(['play']);

/** 白纸条里能摆的图形(src/chalk/kit/ 的画法) */
export const SHAPES = ['点阵', '方向盘'] as const;
/** 写一行最多几个字(同白板的一行) */
export const WRITE_CHARS = 16;
/** 圈、遮、盖一处最多几个字;各最多几处 */
export const SPOT_CHARS = 12;
export const SPOT_MAX: Readonly<Record<'圈' | '遮' | '盖', number>> = { 圈: 4, 遮: 8, 盖: 8 };
/** 看、翻的参数最多几个字 */
const TARGET_CHARS = 40;
/** 请 说 后面要孩子说的一句最多几个字 */
export const SAY_CHARS = 60;
const LESSON_CHARS = 20;
const ERASE_ALL = ['全部', '全', '整条', '白纸条', '都擦'];

/** 读好的动作:参数拆开了 */
export type ActParts =
  | { name: '看'; target: string }
  | { name: '翻'; lesson: string }
  | { name: '圈' | '遮' | '盖'; spots: string[] }
  | { name: '写'; text: string; size: Size }
  | { name: '擦'; all: boolean }
  | { name: '摆'; kit: string; params: Record<string, string>; size: Size }
  /** say = 请 说 后面写的那一句(要孩子说出来的;没写 = 只是开放说,他说什么都交给老师) */
  | { name: '请'; ops: AskName[]; dropped: string[]; say?: string };

const SEP = /[、,,;;]+/;
const chars = (s: string): number => Array.from(s).length;
const unquote = (s: string): string => s.replace(/[「」『』《》"“”]/g, '').trim();

/** 前后的「大 / 中 / 小」摘出来;没写是中 */
function sizeOf(arg: string): { size: Size; rest: string } {
  const words = arg.split(/\s+/).filter(Boolean);
  for (const at of [0, words.length - 1]) {
    const w = words[at]?.replace(/[号的]$/, '');
    if (words.length > 1 && w && (SIZES as readonly string[]).includes(w)) return { size: w as Size, rest: words.filter((_, i) => i !== at).join(' ') };
  }
  return { size: '中', rest: arg.trim() };
}

/** 一个动作的参数拆开;写错就抛(说清怎么写) */
export function actParts(act: LineAct): ActParts {
  const arg = act.arg.trim();
  switch (act.name) {
    case '看': {
      const t = unquote(arg);
      if (!t || chars(t) > TARGET_CHARS) throw new Error('看 后面写一处:第 3 题、例 2、练一练第 3 题、第 55 页、栏目名,或课本上的一句原话');
      return { name: '看', target: t };
    }
    case '翻': {
      const t = unquote(arg);
      if (!t || chars(t) > LESSON_CHARS) throw new Error('翻 后面写课名(翻 6的乘法口诀),或 翻 目录');
      return { name: '翻', lesson: t };
    }
    case '圈':
    case '遮':
    case '盖': {
      const spots = arg.split(SEP).map(unquote).filter(Boolean);
      const max = SPOT_MAX[act.name];
      if (!spots.length || spots.length > max || spots.some((s) => chars(s) > SPOT_CHARS)) throw new Error(`${act.name} 后面写课本上的字词(一处 ${SPOT_CHARS} 个字以内),几处用顿号隔开,最多 ${max} 处`);
      return { name: act.name, spots };
    }
    case '写': {
      const { size, rest } = sizeOf(arg);
      const text = rest.trim();
      if (!text || chars(text) > WRITE_CHARS) throw new Error(`写 后面写一行字(${WRITE_CHARS} 个字以内),如 写 6×4=24`);
      return { name: '写', text, size };
    }
    case '擦': {
      if (!arg) return { name: '擦', all: false };
      if (ERASE_ALL.includes(arg)) return { name: '擦', all: true };
      throw new Error('擦 不带参数是擦掉你上一样;擦 全部 是擦掉整条白纸条');
    }
    case '摆': {
      const { size, rest } = sizeOf(arg);
      const [name, ...more] = rest.split(/\s+/);
      const kit = (SHAPES as readonly string[]).includes(name ?? '') ? kitOf(name) : undefined;
      if (!kit) throw new Error(`摆 后面先写图形的名字:${SHAPES.join('、')}(摆 点阵 6 行 6 个)`);
      const body = more.join(' ').trim();
      // 简写整句先试(6 行 6 个、共 17 个 每行 5 个);不是就一个键一个值(上 东 小人 没有;逗号隔开也行)
      const words = body.split(/[、,,;;\s]+/).filter(Boolean);
      const pairs = words.length % 2 === 0 && words.every((w, i) => i % 2 || kit.params.some((d) => d.key === w.replace(/[::]$/, '')));
      const lines = !body ? [] : kit.shorthand?.(body) ? [body] : pairs ? words.flatMap((w, i) => (i % 2 ? [] : [`${w.replace(/[::]$/, '')}: ${words[i + 1]}`])) : body.split(SEP).map((x) => x.trim().replace(/^(\S+?)\s+(?=\S)/, '$1: ')).filter(Boolean);
      const r = readKitLines(kit, lines);
      if (r.prompt) throw new Error(`摆 ${kit.name} 的参数认不出:「${r.prompt}」`);
      return { name: '摆', kit: kit.name, params: r.params, size };
    }
    case '请': {
      // 请 说 <一句>:说 后面的不是能请的名字,就是要孩子说的那一句(英文带空格,原样留着)
      const m = /(^|[、,,;;\s])说(?=$|[\s、,,;;::「『"“])/.exec(arg);
      const after = m ? arg.slice(m.index + m[0].length).replace(/^[\s、,,;;::]+/, '').trim() : '';
      const tail = after.split(/[、,,;;\s]+/).filter(Boolean);
      const phrase = after && !tail.every((x) => (ASK_NAMES as readonly string[]).includes(x)) ? unquote(after) : '';
      const head = m && phrase ? `${arg.slice(0, m.index + m[1].length)}说` : arg;
      const want = head.split(/[、,,;;\s]+/).map((x) => x.trim()).filter(Boolean);
      const ops = [...new Set(want.filter((x): x is AskName => (ASK_NAMES as readonly string[]).includes(x)))];
      const dropped = want.filter((x) => !(ASK_NAMES as readonly string[]).includes(x));
      if (!ops.length) throw new Error(`请 后面写请孩子做什么:${ASK_NAMES.join('、')}`);
      if (chars(phrase) > SAY_CHARS) throw new Error(`请 说 后面写孩子要说的一句(${SAY_CHARS} 个字以内)`);
      return { name: '请', ops, dropped, ...(phrase ? { say: phrase } : {}) };
    }
  }
}

/** 动作的名字和参数分开:名字都是一个字,后面可以不空格(看第3题) */
function splitAct(inner: string): { name: ActName; arg: string } | null {
  const ch = Array.from(inner)[0] ?? '';
  if (!(ACT_NAMES as readonly string[]).includes(ch)) return null;
  return { name: ch as ActName, arg: inner.slice(ch.length).trim() };
}

/** [[ ]] 里面的一段读成什么 */
export function readMark(raw: string): Mark {
  const inner = raw.trim();
  const act = splitAct(inner);
  if (act) {
    try {
      const p = actParts(act);
      if (p.name === '请') return { kind: 'act', act: { name: '请', arg: p.ops.join('、') + (p.say ? ` ${p.say}` : '') }, ...(p.dropped.length ? { warn: `请 里的「${p.dropped.join('」「')}」不认得,没开放(能请的:${ASK_NAMES.join('、')})` } : {}) };
      return { kind: 'act', act };
    } catch (e) {
      return { kind: 'bad', text: inner, why: e instanceof Error ? e.message : String(e) };
    }
  }
  const [name, ...rest] = inner.split(/\s+/);
  const n = (name ?? '').toLowerCase();
  if (CUES.has(n)) return { kind: 'cue', name: n, ...(rest.length ? { arg: rest.join(' ') } : {}) };
  return { kind: 'bad', text: inner, why: `不认得这个动作(动作有:${ACT_NAMES.join('、')})` };
}

const MARK = /\[\[([^\[\]]+)\]\]/g;

/** 一行讲稿里的 [[ ]] 都读出来,句子里拿掉它们 */
export function readMarks(line: string): { text: string; marks: Mark[] } {
  const marks: Mark[] = [];
  const text = line.replace(MARK, (_, inner: string) => { marks.push(readMark(inner)); return ''; }).replace(/\s{2,}/g, ' ').trim();
  return { text, marks };
}

/** 动作说回原文(家长端、录像、上下文包):[[看 第 3 题]] */
export const actText = (a: LineAct): string => `[[${a.name}${a.arg ? ` ${a.arg}` : ''}]]`;

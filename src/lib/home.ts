/**
 * 首页文件(《首页设计.md》§三、§四、§七)的纯函数:解析草稿、查问题(两级)、排卡(老师卡置顶、缺的补)、孩子端按钮。
 * 解析走板书同一个解析器(place = home);永不抛错,问题都带行号(1 起)与修法。要读盘的引用(话题在不在)由调用方查好传进来。
 */
import type { TutorButton } from '../cards/index.ts';
import { parseBoard } from './board.ts';
import type { BoardCard } from './kid-board.ts';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FENCE_TAG = /^ {0,3}(?:`{3,}|~{3,})\s*(\S*)/;

export type HomeIssueLevel = 'fix' | 'note';

export interface HomeIssue {
  /** fix = 要改(publish 拒绝);note = 提醒(照发) */
  level: HomeIssueLevel;
  text: string;
  /** 原文行号,1 起 */
  line?: number;
  /** 出在第几张卡(0 起,文件顺序);--force 发布时丢掉这张 */
  card?: number;
  /** 出在这张老师卡的第几个按钮;--force 发布时只丢这个按钮 */
  button?: number;
}

export interface HomeDoc {
  for?: string;
  /** 文件顺序 */
  cards: BoardCard[];
  /** 每张卡的开头行(1 起),与 cards 同序 */
  cardLines: number[];
  /** 第一个 H2 起的家长段 */
  note: string;
  /** 解析时就能看出来的问题(引用类的在 homeIssues) */
  issues: HomeIssue[];
}

export function parseHome(md: string): HomeDoc {
  const all = md.replace(/\r\n/g, '\n').split('\n');
  const issues: HomeIssue[] = [];
  let start = 0;
  let forDay: string | undefined;
  if (/^---\s*$/.test(all[0] ?? '')) {
    const close = all.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
    if (close < 0) issues.push({ level: 'fix', line: 1, text: 'frontmatter 没闭合:在 for: 之后单独一行写 ---(或整段删掉)' });
    else {
      for (let i = 1; i < close; i++) {
        const l = all[i];
        if (!l.trim()) continue;
        const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(l);
        if (!m) issues.push({ level: 'note', line: i + 1, text: `frontmatter 这行认不出(只认 key: value):${l.trim()}` });
        else if (m[1] !== 'for') issues.push({ level: 'note', line: i + 1, text: `frontmatter 只认 for,${m[1]} 不管用` });
        else {
          const v = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
          if (DAY_RE.test(v)) forDay = v;
          else issues.push({ level: 'note', line: i + 1, text: `for 要写成 YYYY-MM-DD(如 2026-09-18),「${v}」不认` });
        }
      }
      start = close + 1;
    }
  }
  const body = all.slice(start);
  const board = parseBoard(body.join('\n'), { place: 'home' });
  const at = (bodyLine: number): number => start + bodyLine + 1;
  for (const w of board.warnings) {
    const line = w.line === undefined ? undefined : at(w.line);
    const card = w.line === undefined ? -1 : board.spans.cards.findIndex((s) => s[0] === w.line);
    issues.push({ level: w.fallback ? 'fix' : 'note', text: w.text, ...(line !== undefined ? { line } : {}), ...(card >= 0 ? { card } : {}) });
  }
  // 标签写的种类和解析出来的对不上 = 退了(解析器已经报过 fallback 的,这里只兜不认识的标签)
  board.spans.cards.forEach((s, n) => {
    const tag = (FENCE_TAG.exec(body[s[0]] ?? '')?.[1] ?? '').toLowerCase();
    if (tag && tag !== board.section.cards[n].kind && !issues.some((x) => x.card === n && x.level === 'fix')) issues.push({ level: 'fix', line: at(s[0]), card: n, text: `这张卡没解析成 ${tag}` });
  });
  if (board.spans.lines.length) {
    const lines = board.spans.lines.map((s) => at(s[0]));
    issues.push({ level: 'note', line: lines[0], text: `第 ${lines.join('、')} 行是围栏外的普通行,首页不显示;要给孩子看的写进卡里,给家长的挪到「## 为什么这么排」下面` });
  }
  return { ...(forDay ? { for: forDay } : {}), cards: board.section.cards, cardLines: board.spans.cards.map((s) => at(s[0])), note: board.tail, issues };
}

/** 一位老师在 cotutor.json 里的样子(查老师卡用) */
export interface HomeTutorInfo {
  display: string;
  enabled: boolean;
  hidden: boolean;
}

export interface HomeCheckContext {
  tutors: Record<string, HomeTutorInfo>;
  /** 查得到的话题:`<老师> <日期> <话题>` */
  threads: ReadonlySet<string>;
  today: string;
}

/** 老师卡能不能上首页:有脸(-tutor 结尾)、开着、孩子端露 */
export function faceTutor(name: string, t: HomeTutorInfo | undefined): boolean {
  return Boolean(t && t.enabled && !t.hidden && name.endsWith('-tutor'));
}

/** 首页的老师(孩子端露的有脸老师),cotutor.json 的顺序 */
export function homeTutors(tutors: Record<string, HomeTutorInfo>): string[] {
  return Object.entries(tutors)
    .filter(([name, t]) => faceTutor(name, t))
    .map(([name]) => name);
}

export const threadKey = (tutor: string, date: string, thread: string): string => `${tutor} ${date} ${thread}`;

/** 草稿里要读盘才能查的引用:接着按钮指的话题(调用方按它读索引) */
export function homeRefs(doc: Pick<HomeDoc, 'cards'>): { tutor: string; date: string; thread: string }[] {
  const out: { tutor: string; date: string; thread: string }[] = [];
  for (const c of doc.cards) {
    if (c.kind !== 'tutor') continue;
    for (const b of (c.props.buttons ?? []) as TutorButton[]) if (b.kind === 'continue') out.push({ tutor: String(c.props.tutor), date: b.date, thread: b.thread });
  }
  return out;
}

/** 解析的问题 + 引用的问题 + 缺的老师 + 过期 + 没家长段;按行号排 */
export function homeIssues(doc: HomeDoc, ctx: HomeCheckContext): HomeIssue[] {
  const out = [...doc.issues];
  const names = Object.keys(ctx.tutors);
  const seen = new Map<string, number>();
  doc.cards.forEach((c, n) => {
    if (c.kind !== 'tutor') return;
    const line = doc.cardLines[n];
    const name = String(c.props.tutor);
    const t = ctx.tutors[name];
    if (!t) return void out.push({ level: 'fix', line, card: n, text: `老师卡 ${name}:cotutor.json 里没有这位老师(有:${names.join('、')})` });
    if (!name.endsWith('-tutor')) return void out.push({ level: 'fix', line, card: n, text: `老师卡 ${name}:它是工具人(键不以 -tutor 结尾),孩子不直接找它` });
    if (!t.enabled) return void out.push({ level: 'fix', line, card: n, text: `老师卡 ${name}:${t.display}关着(cotutor.json enabled = false),先打开或删掉这张卡` });
    if (t.hidden) return void out.push({ level: 'fix', line, card: n, text: `老师卡 ${name}:${t.display}孩子端不露(hidden),删掉这张卡` });
    const first = seen.get(name);
    if (first !== undefined) return void out.push({ level: 'fix', line, card: n, text: `${t.display}已经有一张老师卡(第 ${doc.cardLines[first]} 行),按钮合到那一张里` });
    seen.set(name, n);
    ((c.props.buttons ?? []) as TutorButton[]).forEach((b, k) => {
      if (b.kind !== 'continue') return;
      if (b.date > ctx.today) out.push({ level: 'fix', line, card: n, button: k, text: `${t.display}的「${b.label}」:${b.date} 还没到` });
      else if (!ctx.threads.has(threadKey(name, b.date, b.thread))) out.push({ level: 'fix', line, card: n, button: k, text: `${t.display}的「${b.label}」:${b.date} 没有话题 ${b.thread}(cotutor show ${name} <job> ${b.date} 或 conversations/${name}/${b.date}.json 里找话题 id)` });
    });
  });
  const missing = homeTutors(ctx.tutors).filter((name) => !seen.has(name));
  if (missing.length) out.push({ level: 'note', text: `${missing.map((m) => ctx.tutors[m].display).join('、')}没写老师卡,孩子端会补一张只有「新话题」的` });
  if (doc.for && doc.for < ctx.today) out.push({ level: 'note', text: `for 是 ${doc.for},已经过去了(孩子端照样显示)` });
  if (!doc.note.trim()) out.push({ level: 'note', text: '没有家长段(「## 为什么这么排」),下次回头看不知道为什么这么排' });
  return out.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
}

/** --force 发布:丢掉有「要改」的卡 / 按钮;返回剩下的卡与丢了什么 */
export function dropFixes(cards: readonly BoardCard[], issues: readonly HomeIssue[]): { cards: BoardCard[]; dropped: string[] } {
  const dropped: string[] = [];
  const out: BoardCard[] = [];
  cards.forEach((c, n) => {
    const mine = issues.filter((i) => i.level === 'fix' && i.card === n);
    if (!mine.length) return void out.push(c);
    if (mine.every((i) => i.button !== undefined) && c.kind === 'tutor') {
      const bad = new Set(mine.map((i) => i.button));
      const buttons = ((c.props.buttons ?? []) as TutorButton[]).filter((_, k) => !bad.has(k));
      dropped.push(...mine.map((i) => i.text));
      out.push({ ...c, props: { ...c.props, buttons } });
      return;
    }
    dropped.push(`第 ${n + 1} 张卡(${c.kind}):${mine.map((i) => i.text).join(';')}`);
  });
  return { cards: out, dropped };
}

/**
 * 孩子端的排法:老师卡置顶(文件里的先后;不在 / 关了 / 藏了 / 重复的丢掉),没写的老师补一张空的(cotutor.json 顺序),其余卡照文件顺序。
 * tutors = 首页的老师(homeTutors)。
 */
export function arrangeHome(cards: readonly BoardCard[], tutors: readonly string[]): BoardCard[] {
  const seen = new Set<string>();
  const top: BoardCard[] = [];
  const rest: BoardCard[] = [];
  for (const c of cards) {
    if (c.kind !== 'tutor') {
      rest.push(c);
      continue;
    }
    const name = String(c.props.tutor);
    if (!tutors.includes(name) || seen.has(name)) continue;
    seen.add(name);
    top.push(c);
  }
  for (const name of tutors) if (!seen.has(name)) top.push({ kind: 'tutor', props: { tutor: name, buttons: [] } });
  return [...top, ...rest];
}

/** 孩子端老师卡上的一个按钮:id = 文件里的下标,或应用加的 new / recent */
export type KidHomeButton =
  | { id: 'new'; kind: 'new'; label: string }
  | { id: 'recent'; kind: 'continue'; label: string; date: string; thread: string }
  | { id: number; kind: 'start'; label: string; brief?: string }
  | { id: number; kind: 'continue'; label: string; date: string; thread: string; brief?: string };

export const NEW_THREAD_LABEL = '新话题';
const RECENT_MAX = 10;

/**
 * 一张老师卡的按钮:新话题第一;今天有话题(recent)第二,字 = 「接着刚才的:」+ 那个话题第一句孩子的话(文件里有接着它的按钮就不加);然后是文件里的。
 * 接着按钮指的话题现在找不到(alive 说没有)就不出现。keepBriefs = 家长预览(讲法留着)。
 */
export function kidButtons(buttons: readonly TutorButton[], opts: { recent: { date: string; thread: string; title: string } | null; alive: (date: string, thread: string) => boolean; keepBriefs?: boolean }): KidHomeButton[] {
  const out: KidHomeButton[] = [{ id: 'new', kind: 'new', label: NEW_THREAD_LABEL }];
  // 文件里已经有接着这个话题的按钮(字与讲法是家长定的),就不再加一个「接着刚才的」
  const covered = opts.recent && buttons.some((b) => b.kind === 'continue' && b.date === opts.recent!.date && b.thread === opts.recent!.thread);
  if (opts.recent && !covered) {
    const cps = Array.from(opts.recent.title.replace(/\s+/g, ' ').trim());
    const title = cps.length > RECENT_MAX ? `${cps.slice(0, RECENT_MAX).join('')}…` : cps.join('');
    out.push({ id: 'recent', kind: 'continue', label: title ? `接着刚才的:${title}` : '接着刚才的', date: opts.recent.date, thread: opts.recent.thread });
  }
  buttons.forEach((b, k) => {
    const brief = opts.keepBriefs && b.brief ? { brief: b.brief } : {};
    if (b.kind === 'start') out.push({ id: k, kind: 'start', label: b.label, ...brief });
    else if (opts.alive(b.date, b.thread)) out.push({ id: k, kind: 'continue', label: b.label, date: b.date, thread: b.thread, ...brief });
  });
  return out;
}

/** 发布的 id:YYYY-MM-DD-HHMM(本地时间);taken 里有就加 -2、-3 */
export function homeId(now: Date, taken: (id: string) => boolean): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const base = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  if (!taken(base)) return base;
  for (let k = 2; ; k++) if (!taken(`${base}-${k}`)) return `${base}-${k}`;
}

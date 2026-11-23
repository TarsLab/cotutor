/**
 * 首页文件的纯函数:解析草稿、查问题(两级)、排牌(老师牌置顶、缺的补)、孩子端按钮。
 * 解析走 src/board/parse.ts 的 parseHomeBody;永不抛错,问题都带行号(1 起)与修法。要读盘的引用(话题在不在)由调用方查好传进来。
 */
import type { TutorButton } from '../../board/cards/index.ts';
import { HOME_TILES, type Activity, type ActivityBase, type HomeTileId } from '../../schema/index.ts';
import { resolveParams } from '../activity.ts';
import { parseHomeBody } from '../../board/parse.ts';
import type { BoardCard } from '../../board/presentation.ts';

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
  const board = parseHomeBody(body.join('\n'));
  const at = (bodyLine: number): number => start + bodyLine + 1;
  for (const w of board.warnings) {
    const line = w.line === undefined ? undefined : at(w.line);
    const card = w.line === undefined ? -1 : board.spans.cards.findIndex((s) => s[0] === w.line);
    issues.push({ level: w.fallback ? 'fix' : 'note', text: w.text, ...(line !== undefined ? { line } : {}), ...(card >= 0 ? { card } : {}) });
  }
  // 标签写的种类和解析出来的对不上 = 退了(解析器已经报过 fallback 的,这里只兜不认识的标签)
  board.spans.cards.forEach((s, n) => {
    const tag = (FENCE_TAG.exec(body[s[0]] ?? '')?.[1] ?? '').toLowerCase();
    if (tag && tag !== board.cards[n].kind && !issues.some((x) => x.card === n && x.level === 'fix')) issues.push({ level: 'fix', line: at(s[0]), card: n, text: `这张卡没解析成 ${tag}` });
  });
  if (board.spans.lines.length) {
    const lines = board.spans.lines.map((s) => at(s[0]));
    issues.push({ level: 'note', line: lines[0], text: `第 ${lines.join('、')} 行是围栏外的普通行,首页不显示;要给孩子看的写进卡里,给家长的挪到「## 为什么这么排」下面` });
  }
  return { ...(forDay ? { for: forDay } : {}), cards: board.cards, cardLines: board.spans.cards.map((s) => at(s[0])), note: board.tail, issues };
}

/** 一位老师在 cotutor.json 里的样子(查老师卡用) */
export interface HomeTutorInfo {
  display: string;
  enabled: boolean;
  hidden: boolean;
  /** cotutor.json 的 subject(对小课堂课包的科目用);没配 = 不查 */
  subject?: string;
}

export interface HomeCheckContext {
  tutors: Record<string, HomeTutorInfo>;
  /** 小课堂按钮引用的课包或视频:读得出来的 → 科目(没写 = null);不在表里 = 不在或坏了 */
  lectures?: ReadonlyMap<string, string | null>;
  /** 读不出来的那几份,为什么(src/runtime/lecture.ts inspectLecture);没给就说一句笼统的 */
  lectureProblems?: ReadonlyMap<string, readonly string[]>;
  /** 读得出来但没烤过(或画面改过没重烤)的课包 id:播放退回在浏览器里现跑 excalidraw,提醒去 cotutor chalk bake */
  unbaked?: ReadonlySet<string>;
  today: string;
  /**
   * activity 按钮引用的 activity 文件(键「老师/名」):读得出来的 → 解析出来的 activity 与文件自己的「要改」(activity check 那几条);
   * 不在表里 = 文件不在。没给就不查
   */
  activities?: ReadonlyMap<string, { activity: Activity; fixes: number }>;
  /** 每位老师家里铺小课堂的那个 activity(头上 base: lecture;src/runtime/activities.ts 的 lectureActivity):小课堂按钮没写 activity: 时看完照它聊;不在表里 = 没有 */
  lectureActivities?: ReadonlyMap<string, string>;
  /** activity 按钮挂的练习册(buttonWorkbook):名字 → 读不出来的原因(null = 读得出来);不在表里 = 没查 */
  workbooks?: ReadonlyMap<string, string | null>;
}

/** activity 按钮挂的练习册:这个 activity 里类型是「练习册」的那个参数(按钮上填的,没填用缺省);不铺练习册的 activity = null */
export function buttonWorkbook(act: Pick<Activity, 'params'>, params: Readonly<Record<string, string>>): string | null {
  const p = act.params.find((x) => x.type === '练习册');
  return p ? params[p.name]?.trim() || p.default || null : null;
}

/** 老师卡能不能上首页:开着、孩子端露 */
export function faceTutor(t: HomeTutorInfo | undefined): boolean {
  return Boolean(t && t.enabled && !t.hidden);
}

/** 首页的老师(孩子端露的有脸老师),cotutor.json 的顺序 */
export function homeTutors(tutors: Record<string, HomeTutorInfo>): string[] {
  return Object.entries(tutors)
    .filter(([, t]) => faceTutor(t))
    .map(([name]) => name);
}

/** 草稿里小课堂按钮引用的课包 id */
export function homeLectures(doc: Pick<HomeDoc, 'cards'>): string[] {
  const out = new Set<string>();
  for (const c of doc.cards) if (c.kind === 'tutor') for (const b of (c.props.buttons ?? []) as TutorButton[]) if (b.kind === 'lecture') out.add(b.bundle);
  return [...out];
}

/** 草稿里 activity 按钮引用的 activity:「老师/名」;小课堂按钮没写 activity: 的照 lectureOf(这位老师 base: lecture 的那个) */
export function homeActivities(doc: Pick<HomeDoc, 'cards'>, lectureOf: (tutor: string) => string | null | undefined = () => null): { tutor: string; name: string }[] {
  const out = new Map<string, { tutor: string; name: string }>();
  for (const c of doc.cards) if (c.kind === 'tutor') for (const b of (c.props.buttons ?? []) as TutorButton[]) {
    const name = b.kind === 'activity' ? b.activity : b.kind === 'lecture' ? (b.activity ?? lectureOf(String(c.props.tutor)) ?? undefined) : undefined;
    if (name) out.set(`${c.props.tutor}/${name}`, { tutor: String(c.props.tutor), name });
  }
  return [...out.values()];
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
    if (!t.enabled) return void out.push({ level: 'fix', line, card: n, text: `老师卡 ${name}:${t.display}关着(cotutor.json enabled = false),先打开或删掉这张卡` });
    if (t.hidden) return void out.push({ level: 'fix', line, card: n, text: `老师卡 ${name}:${t.display}孩子端不露(hidden),删掉这张卡` });
    const first = seen.get(name);
    if (first !== undefined) return void out.push({ level: 'fix', line, card: n, text: `${t.display}已经有一张老师卡(第 ${doc.cardLines[first]} 行),按钮合到那一张里` });
    seen.set(name, n);
    ((c.props.buttons ?? []) as TutorButton[]).forEach((b, k) => {
      // activity 按钮,或小课堂按钮看完照哪个 activity 聊(写了 activity: 就是它,没写是这位老师头上 base: lecture 的那个):文件在不在、文件自己要不要改、参数对不对(挂在小课堂下面的只用缺省)
      const lectureName = b.kind === 'lecture' ? (b.activity ?? ctx.lectureActivities?.get(name)) : undefined;
      if (b.kind === 'lecture' && !lectureName && ctx.activities) out.push({ level: 'fix', line, card: n, button: k, text: `${t.display}的「${b.label}」:${t.display}家里没有铺小课堂的 activity(头上写 base: lecture 的;cotutor refresh 补出厂的「小课堂」),或按钮下面写一行 activity: <名> 换一个` });
      const act = b.kind === 'activity' ? { name: b.activity, params: b.params } : lectureName ? { name: lectureName, params: {} } : null;
      if (act && ctx.activities) {
        const got = ctx.activities.get(`${name}/${act.name}`);
        if (!got) out.push({ level: 'fix', line, card: n, button: k, text: `${t.display}的「${b.label}」:agents/${name}/activities/${act.name}.md 不在(cotutor activity check ${name} 看这位老师有哪些)` });
        else {
          if (got.fixes) out.push({ level: 'fix', line, card: n, button: k, text: `${t.display}的「${b.label}」:activity 文件 ${act.name}.md 有 ${got.fixes} 处要改(cotutor activity check ${name} ${act.name})` });
          for (const text of resolveParams(got.activity, act.params).issues) out.push({ level: 'fix', line, card: n, button: k, text: `${t.display}的「${b.label}」:${text}` });
          const wb = buttonWorkbook(got.activity, act.params);
          const why = wb ? ctx.workbooks?.get(wb) : null;
          if (why) out.push({ level: 'fix', line, card: n, button: k, text: `${t.display}的「${b.label}」:${why}` });
        }
      }
      if (b.kind === 'activity') return;
      if (b.kind === 'lecture') {
        const subject = ctx.lectures?.get(b.bundle);
        if (ctx.lectures && subject === undefined) out.push({ level: 'fix', line, card: n, button: k, text: `${t.display}的「${b.label}」:${ctx.lectureProblems?.get(b.bundle)?.join(';') || `bundles/${b.bundle}/ 不在或读不出来(要有 scene.json 与带步的 manifest.json)`}` });
        else if (subject && t.subject && subject !== t.subject) out.push({ level: 'note', line, card: n, button: k, text: `${t.display}的「${b.label}」:小课堂 ${b.bundle} 是${subject}的,${t.display}教${t.subject}` });
        if (ctx.unbaked?.has(b.bundle)) out.push({ level: 'note', line, card: n, button: k, text: `${t.display}的「${b.label}」:课包 ${b.bundle} 没烤过(或画面改过没重烤),孩子端要现画,慢、iPad 上可能不顺;跑 cotutor chalk bake ${b.bundle}(服务端发现了也会在后台补烤)` });
        return;
      }
    });
  });
  // 听写卡写了念的老师:不在 cotutor.json 就换人念(听写页照样能用,只提醒)
  doc.cards.forEach((c, n) => {
    if (c.kind !== 'dictation' || typeof c.props.tutor !== 'string' || ctx.tutors[c.props.tutor]) return;
    out.push({ level: 'note', line: doc.cardLines[n], card: n, text: `听写卡写的 ${c.props.tutor} 不在 cotutor.json 里(有:${names.join('、')}),会换成语文老师念` });
  });
  const missing = homeTutors(ctx.tutors).filter((name) => !seen.has(name));
  if (missing.length) out.push({ level: 'note', text: `${missing.map((m) => ctx.tutors[m].display).join('、')}没写老师卡,孩子端会补一张(只有每天都在的方砖)` });
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

/** 非老师卡归哪位老师:文件顺序里跟在哪张(上首页的)老师卡后面;听写卡写了念的老师(而且上首页)就归他;都没有 = 公共 */
export function homeOwners(cards: readonly BoardCard[], tutors: readonly string[]): (string | null)[] {
  let cur: string | null = null;
  return cards.map((c) => {
    if (c.kind === 'tutor') { const n = String(c.props.tutor); if (tutors.includes(n)) cur = n; return null; }
    const who = c.kind === 'dictation' && typeof c.props.tutor === 'string' && tutors.includes(c.props.tutor) ? c.props.tutor : null;
    return who ?? cur;
  });
}

/**
 * 孩子端老师卡上的一个按钮:id = 文件里的下标。按钮进去都是新话题;今天聊过的话题在首页「今天」那一行接。
 * start = activity 按钮(孩子那边点了发出按钮上的字;是哪个 activity、参数是什么,服务端照 via 从发布件查)
 */
export type KidHomeButton =
  /** workbook = 挂的练习册(base: workbook 的 activity;孩子端点了就先铺那一册) */
  | ({ id: number; kind: 'start'; label: string; brief?: string; workbook?: string; cover?: KidCover } & ActivityLook)
  /** 小课堂:title / ms(课名、课长)由服务端读课包后补;base、listen 是看完照着聊的那个 activity 的(base 没写 = lecture) */
  | ({ id: number; kind: 'lecture'; label: string; bundle: string; brief?: string; title?: string; ms?: number; video?: true } & ActivityLook);

/**
 * 册的卡上的封面(首页的卡是竖版的,册铺封面;设计稿 https://claude.ai/artifact/KJFiRZD6E45YEKGQBbw98Q):
 * book = 课本,PDF 第 1 页(舞台画了交上来的,src/memory/textbook-cover.ts;还没有 image 就画学科色 + title、sub 的占位,孩子端进了课本叫舞台补画 book 那一册);
 * homework = 作业本,生成的(学科色 +「作业本」+ 最近一张照片和那天,一张都没有就只有字);workbook = 练习册,第一页的图
 */
export type KidCover =
  | { kind: 'book'; book: string; title: string; sub: string; image?: string }
  | { kind: 'homework'; subject: string; image?: string; day?: string }
  | { kind: 'workbook'; image: string };

/** 孩子端老师卡上常驻的一块方砖(HOME_TILES):label = activity 的名字 */
export interface KidHomeTile {
  id: HomeTileId;
  label: string;
  /** 铺课本、作业本的方砖的封面 */
  cover?: KidCover;
  /**
   * 这一节课铺哪种页(头上的 base:):photo = 孩子端点了先到拍照屏,带着照片(或白纸)开话题;textbook = 不到拍照屏,直接开话题、铺课本的目录
   */
  base?: ActivityBase;
  /** 一直听(头上的 listen: open):孩子端进去不用按着说 */
  listen?: 'open';
}

/** activity 头上孩子端进去前就要知道的:铺哪种页、一直听不听(方砖、activity 按钮、小课堂按钮都带) */
/** activity 头上孩子端要知道的:铺哪种页、一直听、老师先说(start: tutor;没有 = 孩子先说,进门不叫老师) */
export interface ActivityLook { base?: ActivityBase; listen?: 'open'; start?: 'tutor' }
/** activity 文件头 → 孩子端要的那两样 */
export const activityLook = (a: { base?: string; listen?: string; start?: string } | null | undefined): ActivityLook => ({ ...(a?.base === 'textbook' || a?.base === 'photo' || a?.base === 'lecture' || a?.base === 'workbook' || a?.base === 'homework' ? { base: a.base } : {}), ...(a?.listen === 'open' ? { listen: 'open' as const } : {}), ...(a?.start === 'tutor' ? { start: 'tutor' as const } : {}) });

/** 这位老师牌上的方砖:开着的(on,牌上的先后)里,家里那个 activity 用得了的才出 */
export function kidTiles(on: readonly HomeTileId[], opts: { usable: (activity: string) => boolean; looks?: ReadonlyMap<string, ActivityLook>; covers?: ReadonlyMap<string, KidCover> }): KidHomeTile[] {
  return HOME_TILES.filter((t) => on.includes(t.id) && opts.usable(t.activity)).map((t) => { const cover = opts.covers?.get(t.activity); return { id: t.id, label: t.activity, ...opts.looks?.get(t.activity), ...(cover ? { cover } : {}) }; });
}

/**
 * 一张老师牌的按钮:文件里的 activity、小课堂。以前发布的那份里的开场、接着按钮不出。keepBriefs = 家长预览(讲法留着)。
 */
export function kidButtons(buttons: readonly TutorButton[], opts: { lecture?: (bundle: string) => boolean; activity?: (name: string, params: Readonly<Record<string, string>>) => boolean; look?: (name: string) => ActivityLook; keepBriefs?: boolean; today?: string; /** 这位老师铺小课堂的 activity(base: lecture);没有就不出没写 activity: 的小课堂按钮 */ lectureActivity?: string | null; /** activity 按钮挂的练习册(读得出来的);不铺练习册的 = null */ workbook?: (name: string, params: Readonly<Record<string, string>>) => string | null }): KidHomeButton[] {
  const out: KidHomeButton[] = [];
  buttons.forEach((b, k) => {
    // 留到那天为止(家长端表单的「只今天 / 到周日」);过了就不出现,id 还是文件里的下标
    if (b.until && opts.today && b.until < opts.today) return;
    const brief = opts.keepBriefs && b.brief ? { brief: b.brief } : {};
    // activity 按钮在孩子那边是 start:点了发出按钮上的字;是哪个 activity、参数是什么,服务端照 via 从发布件查
    // activity 用不了(文件不在、写坏了、这个按钮的参数按现在的文件解析不出),按钮不出:不让孩子点进一个没人带或带不了的话题;小课堂看完照它聊,同样
    const hasActivity = (name: string, params: Readonly<Record<string, string>> = {}): boolean => opts.activity?.(name, params) ?? true;
    // 铺哪种页、一直听不听同方砖(activity 按钮也带)
    if (b.kind === 'activity') {
      const wb = opts.workbook?.(b.activity, b.params) ?? null;
      if (hasActivity(b.activity, b.params)) out.push({ id: k, kind: 'start', label: b.label, ...opts.look?.(b.activity), ...(wb ? { workbook: wb } : {}), ...brief });
    }
    else if (b.kind === 'lecture') {
      const name = b.activity ?? opts.lectureActivity ?? null;
      // 看完照着聊的 activity 没有(没写 activity:、家里也没有 base: lecture 的):不查 activity 的场合(没给 opts.activity)照出,别的不出
      if ((opts.lecture?.(b.bundle) ?? true) && (name ? hasActivity(name) : !opts.activity)) out.push({ id: k, kind: 'lecture', label: b.label, bundle: b.bundle, ...(name ? opts.look?.(name) : {}), ...brief });
    }
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

/**
 * 首页的读写:草稿 home/draft.md → 检查(引用读盘查)→ 发布 home/published.json + home/history/<id>.md;
 * 孩子端的首页现算(老师卡置顶、补缺、剥讲法、今天的「接着刚才的」);孩子点按钮发来的 via 在这里对上发布的那份,讲法只从这里取;
 * 接着以前话题时上下文包的 continue 段;家长看的点击统计。CLI(cotutor home)、家长端「首页」页、孩子端都走这里。
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { cardLabel, describeCard, stripSecrets, type TutorButton } from '../cards/index.ts';
import { UsageError } from '../shared/errors.ts';
import type { Workspace } from '../schema/index.ts';
import { conversationFiles, localDate, threads } from '../lib/conversation.ts';
import { kidQuestions } from '../lib/diary.ts';
import { activityFile } from '../cli/activities.ts';
import { lintActivity, parseActivity, resolveParams } from '../lib/activity.ts';
import { arrangeHome, dropFixes, homeActivities, homeOwners, faceTutor, homeId, homeIssues, homeLectures, homeRefs, homeTutors, kidButtons, parseHome, threadKey, todayResumes, type Resume, type HomeCheckContext, type HomeDoc, type HomeIssue, type HomeTutorInfo, type KidHomeButton } from '../lib/home.ts';
import type { BoardCard } from '../lib/kid-board.ts';
import { HOME_ID_RE, LECTURE_ACTIVITY, PublishedHomeSchema, type Activity, type ActivityRun, type ActivityValue, type ContextPack, type ConversationIndex, type HomeVia, type MessageVia, type PublishedHome } from '../schema/index.ts';
import { listDates, readCardStates, readIndex } from './store.ts';
import { bakeSoon, inspectLecture, readLecture, type Lecture } from './lecture.ts';

export function homeFiles(ws: Pick<Workspace, 'dirs'>): { dir: string; draft: string; published: string; history: string } {
  const dir = ws.dirs.home;
  return { dir, draft: join(dir, 'draft.md'), published: join(dir, 'published.json'), history: join(dir, 'history') };
}

export async function readDraft(ws: Workspace): Promise<string | null> {
  return readFile(homeFiles(ws).draft, 'utf8').catch(() => null);
}

/** 已发布的那份;没有 → home null;坏了 → error(孩子端退回缺省首页) */
export async function readPublished(ws: Workspace): Promise<{ home: PublishedHome | null; error: string | null }> {
  let text: string;
  try {
    text = await readFile(homeFiles(ws).published, 'utf8');
  } catch {
    return { home: null, error: null };
  }
  try {
    const r = PublishedHomeSchema.safeParse(JSON.parse(text));
    if (r.success) return { home: r.data, error: null };
    return { home: null, error: `home/published.json 形状不对:${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(';')}` };
  } catch (err) {
    return { home: null, error: `home/published.json 不是合法 JSON:${err instanceof Error ? err.message : String(err)}` };
  }
}

function tutorInfos(ws: Workspace): Record<string, HomeTutorInfo> {
  return Object.fromEntries(Object.entries(ws.config.tutors).map(([k, t]) => [k, { display: t.display, enabled: t.enabled, hidden: t.hidden, ...(t.subject ? { subject: t.subject } : {}) }]));
}

/** 这些引用里真在的话题 */
async function liveThreads(ws: Workspace, refs: readonly { tutor: string; date: string; thread: string }[]): Promise<Set<string>> {
  const alive = new Set<string>();
  const cache = new Map<string, ConversationIndex | null>();
  for (const r of refs) {
    if (!ws.config.tutors[r.tutor]) continue;
    const key = `${r.tutor} ${r.date}`;
    if (!cache.has(key)) cache.set(key, await readIndex(ws, r.tutor, r.date).catch(() => null));
    const index = cache.get(key);
    if (!index || !threads(index.messages).includes(r.thread)) continue;
    alive.add(threadKey(r.tutor, r.date, r.thread));
  }
  return alive;
}

async function checkContext(ws: Workspace, doc: Pick<HomeDoc, 'cards'>, now: Date): Promise<HomeCheckContext> {
  const lectures = new Map<string, string | null>();
  const lectureProblems = new Map<string, string[]>();
  const unbaked = new Set<string>();
  for (const id of homeLectures(doc)) {
    const r = await inspectLecture(ws, id);
    if (r.lecture) { lectures.set(id, r.lecture.subject); if (!r.lecture.video && !r.lecture.baked) unbaked.add(id); } else lectureProblems.set(id, r.problems);
  }
  const activities = new Map<string, { activity: Activity; fixes: number }>();
  for (const r of homeActivities(doc)) {
    const text = await readFile(activityFile(ws.root, r.tutor, r.name), 'utf8').catch(() => null);
    if (text === null) continue;
    const { activity, issues } = lintActivity(text, { fileName: r.name, tutorCards: ws.config.tutors[r.tutor]?.cards });
    activities.set(`${r.tutor}/${r.name}`, { activity, fixes: issues.filter((i) => i.level === 'fix').length });
  }
  return { tutors: tutorInfos(ws), threads: await liveThreads(ws, homeRefs(doc)), lectures, lectureProblems, unbaked, today: localDate(now), activities };
}

export interface HomeCheck {
  doc: HomeDoc;
  issues: HomeIssue[];
  fixes: number;
}

export async function checkHome(ws: Workspace, md: string, now: Date): Promise<HomeCheck> {
  const doc = parseHome(md);
  const issues = homeIssues(doc, await checkContext(ws, doc, now));
  return { doc, issues, fixes: issues.filter((i) => i.level === 'fix').length };
}

/** 孩子端能不能用这个 activity:文件在、检查没有「要改」(提醒不算);用不了 → null */
export async function usableActivity(ws: Workspace, tutor: string, name: string): Promise<Activity | null> {
  const text = await readFile(activityFile(ws.root, tutor, name), 'utf8').catch(() => null);
  if (text === null) return null;
  const { activity, issues } = lintActivity(text, { fileName: name, tutorCards: ws.config.tutors[tutor]?.cards });
  return issues.some((i) => i.level === 'fix') ? null : activity;
}

/** 已发布那份里现在还坏着的引用(doctor 与家长端用) */
export async function publishedIssues(ws: Workspace, home: PublishedHome, now: Date): Promise<HomeIssue[]> {
  const doc: HomeDoc = { cards: home.cards, cardLines: [], note: home.note, issues: [] };
  return homeIssues(doc, await checkContext(ws, doc, now)).filter((i) => i.level === 'fix');
}

export interface PublishResult {
  ok: boolean;
  check: HomeCheck;
  /** 发布了才有 */
  home?: PublishedHome;
  /** --force 丢掉的 */
  dropped: string[];
  /** 从哪份发的(相对 workspace 根) */
  source: string;
}

/**
 * 发布:检查 → 有「要改」且没 force 就不发 → 留历史 → 写 published.json(先写 .tmp 再 rename)。
 * from = 另一份原文(CLI 给路径;家长端只给历史 id,由路由拼成 home/history/<id>.md)。
 */
export async function publishHome(ws: Workspace, opts: { force?: boolean; from?: string; now: Date }): Promise<PublishResult> {
  const f = homeFiles(ws);
  const src = opts.from ? (isAbsolute(opts.from) ? opts.from : resolve(ws.root, opts.from)) : f.draft;
  const md = await readFile(src, 'utf8').catch(() => null);
  const shown = relative(ws.root, src) || src;
  if (md === null) throw new UsageError(opts.from ? `读不到 ${opts.from}` : '还没有草稿 home/draft.md(用 cotutor-home 技能写一份)');
  return publishHomeMd(ws, md, shown, opts);
}

/**
 * 家长端表单改首页:拿已发布那份的原文(没发布过 = 空的)改一下,照常检查、留历史、发布。
 * 改完和原来一样就不发;有「要改」的不发,回检查结果。草稿 home/draft.md 不动。
 */
export async function editPublished(ws: Workspace, edit: (md: string) => string, now: Date): Promise<PublishResult | null> {
  const { home } = await readPublished(ws);
  const base = home ? ((await publishedSource(ws, home)) ?? '') : '';
  const md = edit(base);
  if (md === base) return null;
  return publishHomeMd(ws, md, '家长端表单', { now });
}

async function publishHomeMd(ws: Workspace, md: string, shown: string, opts: { force?: boolean; now: Date }): Promise<PublishResult> {
  const f = homeFiles(ws);
  const check = await checkHome(ws, md, opts.now);
  if (check.fixes && !opts.force) return { ok: false, check, dropped: [], source: shown };
  const { cards, dropped } = opts.force ? dropFixes(check.doc.cards, check.issues) : { cards: check.doc.cards, dropped: [] };
  await mkdir(f.history, { recursive: true });
  const taken = new Set((await readdir(f.history).catch(() => [] as string[])).map((n) => n.replace(/\.md$/, '')));
  const id = homeId(opts.now, (x) => taken.has(x));
  const historyFile = join(f.history, `${id}.md`);
  await writeFile(historyFile, md);
  const home: PublishedHome = {
    id,
    publishedAt: opts.now.toISOString(),
    ...(check.doc.for ? { for: check.doc.for } : {}),
    source: relative(ws.root, historyFile).split(sep).join('/'),
    cards,
    note: check.doc.note,
    warnings: check.issues.filter((i) => i.level === 'note').map((i) => i.text),
  };
  const tmp = `${f.published}.tmp`;
  await writeFile(tmp, `${JSON.stringify(home, null, 2)}\n`);
  await rename(tmp, f.published);
  return { ok: true, check, home, dropped, source: shown };
}

/** 已发布那份的原文(home/history/<id>.md);不在了 → null */
export async function publishedSource(ws: Workspace, home: Pick<PublishedHome, 'source'>): Promise<string | null> {
  return readFile(resolve(ws.root, home.source), 'utf8').catch(() => null);
}

/** 历史 id → 原文路径(家长端「回到这份」用;id 不合法 → null) */
export function historyFile(ws: Workspace, id: string): string | null {
  return HOME_ID_RE.test(id) ? join(homeFiles(ws).history, `${id}.md`) : null;
}

/** 首页上的一张卡;非老师卡带 owner(写在哪张老师卡后面归哪位,听写卡写了念的老师归那位;null = 公共的) */
export type KidHomeCard = BoardCard & { owner?: string | null };

export interface KidHomeView {
  /** 发布的 id;缺省首页 / 预览草稿 = null */
  home: string | null;
  /** 老师卡在前(props.buttons 是孩子端的按钮;props.news = 家长这次给他排了东西、孩子发布以来还没找过他),其余卡照文件顺序;答案与讲法已剥(keepBriefs 除外) */
  cards: KidHomeCard[];
}

/** 发布以来孩子有没有找过这位老师(发布那天起每天的索引里有孩子的话,且晚于发布时刻);最多往回看 7 天 */
async function talkedSince(ws: Workspace, tutor: string, since: string, now: Date): Promise<boolean> {
  const from = localDate(new Date(since));
  for (let d = 0; d < 7; d++) {
    const date = localDate(new Date(now.getTime() - d * 86400000));
    if (date < from) break;
    const index = await readIndex(ws, tutor, date).catch(() => null);
    if (index?.messages.some((m) => m.from === 'kid' && m.at >= since)) return true;
  }
  return false;
}

/** 这位老师今天孩子能接着的话题(孩子端最后一条所在、孩子在里面说过话的) */
/** 今天这位老师每个入口最近的话题;读不出来 → 空 */
async function resumesOf(ws: Workspace, tutor: string, today: string): Promise<Map<string, Resume>> {
  try {
    return todayResumes((await readIndex(ws, tutor, today)).messages);
  } catch {
    return new Map();
  }
}

/**
 * 孩子端的首页卡:source = 已发布的(缺省)/ 草稿(家长预览)/ 缺省。
 * 老师卡按 arrangeHome 排、按钮按 kidButtons 算;其余卡过 stripSecrets。
 */
export async function kidHomeView(ws: Workspace, now: Date, opts: { source?: 'published' | 'draft'; keepBriefs?: boolean } = {}): Promise<KidHomeView> {
  const today = localDate(now);
  let id: string | null = null;
  let publishedAt: string | null = null;
  let cards: BoardCard[] = [];
  if (opts.source === 'draft') {
    const md = await readDraft(ws);
    if (md !== null) cards = parseHome(md).cards;
  } else {
    const { home } = await readPublished(ws);
    if (home) {
      id = home.id;
      publishedAt = home.publishedAt;
      cards = home.cards;
    }
  }
  const tutors = homeTutors(tutorInfos(ws));
  const alive = await liveThreads(ws, homeRefs({ cards }));
  // 小课堂按钮:课包读得出来才出现;课名与课长补在按钮上
  const lectures = new Map<string, Lecture | null>();
  for (const id of homeLectures({ cards })) {
    const l = await readLecture(ws, id);
    lectures.set(id, l);
    if (l && !l.video && !l.baked) bakeSoon(ws.dirs.bundles, id);
  }
  // 按钮引用的 activity 用不用得了:文件在、检查没有要改的;参数再按按钮各自解析(工作台能存下写坏的 activity)
  const usable = new Map<string, Activity>();
  for (const a of homeActivities({ cards })) {
    const act = await usableActivity(ws, a.tutor, a.name);
    if (act) usable.set(`${a.tutor}/${a.name}`, act);
  }
  const ownerOf = homeOwners(cards, tutors);
  const owners = new Map(cards.map((c, i) => [c, ownerOf[i]]));
  const out: KidHomeCard[] = [];
  for (const c of arrangeHome(cards, tutors)) {
    if (c.kind !== 'tutor') {
      out.push({ ...stripSecrets({ cards: [c], lines: [] }).cards[0], owner: owners.get(c) ?? null });
      continue;
    }
    const name = String(c.props.tutor);
    const buttons = kidButtons((c.props.buttons ?? []) as TutorButton[], {
      resumes: await resumesOf(ws, name, today),
      alive: (date, thread) => alive.has(threadKey(name, date, thread)),
      lecture: (bundle) => Boolean(lectures.get(bundle)),
      activity: (a, params) => { const act = usable.get(`${name}/${a}`); return Boolean(act) && resolveParams(act!, params).issues.length === 0; },
      keepBriefs: opts.keepBriefs,
      today,
    }).map((b) => { const l = b.kind === 'lecture' ? lectures.get(b.bundle) : null; return l ? { ...b, title: l.title, ms: l.clock.total, ...(l.video ? { video: true as const } : {}) } : b; });
    // 橙点:这份首页给他排了按钮或卡,而发布以来孩子还没找过他
    const arranged = buttons.some((b) => typeof b.id === 'number') || cards.some((x) => x.kind !== 'tutor' && owners.get(x) === name);
    const news = Boolean(publishedAt && arranged && !(await talkedSince(ws, name, publishedAt, now)));
    out.push({ kind: 'tutor', props: { tutor: name, buttons, ...(news ? { news: true } : {}) } });
  }
  return { home: id, cards: out };
}

export type ResolvedVia =
  | { kind: 'new'; label: string }
  | { kind: 'recent'; label: string }
  | { kind: 'start'; label: string; brief?: string }
  | { kind: 'continue'; label: string; date: string; thread: string; brief?: string }
  /** activity = 小课堂下面挂的(参数用缺省,点的那一刻解析) */
  | { kind: 'lecture'; label: string; bundle: string; brief?: string; activity?: ActivityRun }
  /** params = 按 activity 文件解析好的值(补了缺省);读不出来或参数不对 → resolveVia 回 null */
  | { kind: 'activity'; label: string; activity: string; params: Record<string, ActivityValue>; brief?: string };

/**
 * 孩子发来的 via → 这个按钮是什么(讲法从服务端的发布件取,不经过孩子设备)。
 * 对不上(不是当前发布的那份、这位老师没有这个按钮、老师不上首页)→ null,路由回 400。
 */
export async function resolveVia(ws: Workspace, tutor: string, via: HomeVia): Promise<ResolvedVia | null> {
  if (!faceTutor(tutor, tutorInfos(ws)[tutor])) return null;
  if (via.button === 'new') return { kind: 'new', label: '新话题' };
  if (via.button === 'recent') return { kind: 'recent', label: '接着刚才的' };
  if (via.home === null) return null;
  const { home } = await readPublished(ws);
  if (!home || home.id !== via.home) return null;
  const card = home.cards.find((c) => c.kind === 'tutor' && c.props.tutor === tutor);
  const b = card ? ((card.props.buttons ?? []) as TutorButton[])[via.button] : undefined;
  if (!b) return null;
  const brief = b.brief ? { brief: b.brief } : {};
  if (b.kind === 'start') return { kind: 'start', label: b.label, ...brief };
  // activity 的参数在点的那一刻按 activity 文件解析、补缺省,跟着话题走(家长后来改了只管以后的话题);文件不在、参数不对 → null
  const runOf = async (name: string, params: Record<string, string>): Promise<ActivityRun | null> => {
    const text = await readFile(activityFile(ws.root, tutor, name), 'utf8').catch(() => null);
    if (text === null) return null;
    const r = resolveParams(parseActivity(text).activity, params);
    return r.issues.length ? null : { name, params: r.values };
  };
  // 小课堂看完照哪个 activity 聊:写了 activity: 是它,没写是这位老师的「小课堂」;文件不在 → null
  if (b.kind === 'lecture') {
    const run = await runOf(b.activity ?? LECTURE_ACTIVITY, {});
    return run ? { kind: 'lecture', label: b.label, bundle: b.bundle, ...brief, activity: run } : null;
  }
  if (b.kind === 'activity') {
    const run = await runOf(b.activity, b.params);
    return run ? { kind: 'activity', label: b.label, activity: b.activity, params: run.params, ...brief } : null;
  }
  return { kind: 'continue', label: b.label, date: b.date, thread: b.thread, ...brief };
}

/** 某份发布过的首页(按 via.home 读历史原文)上这位老师的第几个按钮;回放取讲法用。找不到 → null */
export async function homeButtonAt(ws: Workspace, tutor: string, via: HomeVia): Promise<TutorButton | null> {
  if (via.home === null || typeof via.button !== 'number') return null;
  const file = historyFile(ws, via.home);
  const md = file ? await readFile(file, 'utf8').catch(() => null) : null;
  if (md === null) return null;
  const card = parseHome(md).cards.find((c) => c.kind === 'tutor' && c.props.tutor === tutor);
  return card ? (((card.props.buttons ?? []) as TutorButton[])[via.button] ?? null) : null;
}

export function messageVia(via: HomeVia, r: ResolvedVia): MessageVia {
  return { home: via.home, button: via.button, label: r.label };
}

const SAID_MAX = 6;

/** 接着以前的话题:那个话题最后一节的讲稿与卡(卡带孩子做的与答案)、话题名、索引路径;话题找不到 → null */
export async function continueContext(ws: Workspace, tutor: string, date: string, thread: string): Promise<NonNullable<ContextPack['continue']> | null> {
  let index;
  try {
    index = await readIndex(ws, tutor, date);
  } catch {
    return null;
  }
  const ths = threads(index.messages);
  if (!ths.includes(thread)) return null;
  const mine = index.messages.filter((_, i) => ths[i] === thread);
  const last = [...mine].reverse().find((m) => m.result === 'ok' && m.section && (m.section.cards.length || m.section.lines.length));
  const states = await readCardStates(ws, tutor, date).catch(() => ({}) as Awaited<ReturnType<typeof readCardStates>>);
  const booked = index.booked[thread] ? index.messages.find((m) => m.job === index.booked[thread])?.bookkeeping?.entries.find((e) => e.thread === thread)?.name : undefined;
  const asked = kidQuestions(index.messages, thread)[0] ?? mine.find((m) => m.via)?.via?.label;
  const title = booked ?? (asked ? Array.from(asked).slice(0, 20).join('') : undefined);
  const cards = last?.section
    ? last.section.cards.map((c, n) => {
        const st = states[last.job]?.[n];
        return `${last.job}/${n} ${st ? describeCard(c, st.state) : `${c.kind}「${cardLabel(c)}」`}`;
      })
    : [];
  return {
    from: `${date} ${thread}`,
    ...(title ? { title } : {}),
    said: last?.section ? last.section.lines.map((l) => l.text).slice(-SAID_MAX) : [],
    cards,
    index: conversationFiles(ws.dirs.conversations, tutor, date).index,
  };
}

export interface HomeClick {
  tutor: string;
  button: number | 'new' | 'recent';
  label: string;
  uses: { date: string; job: string; thread: string }[];
}

export interface HomeStats {
  home: PublishedHome | null;
  error: string | null;
  /** 发布到现在几天(按本地日期) */
  days: number | null;
  /** 文件里的每个按钮一行(没点过 uses 为空),再加点过的新话题 / 接着刚才的 */
  clicks: HomeClick[];
}

/** 发布那天起,各位老师的消息里 via.home 是这份的,按按钮聚合 */
export async function homeStats(ws: Workspace, now: Date): Promise<HomeStats> {
  const { home, error } = await readPublished(ws);
  if (!home) return { home: null, error, days: null, clicks: [] };
  const from = localDate(new Date(home.publishedAt));
  const today = localDate(now);
  const days = daysSince(home, now);
  const clicks: HomeClick[] = [];
  const find = (tutor: string, button: HomeClick['button'], label: string): HomeClick => {
    let c = clicks.find((x) => x.tutor === tutor && x.button === button);
    if (!c) clicks.push((c = { tutor, button, label, uses: [] }));
    return c;
  };
  for (const card of home.cards) {
    if (card.kind !== 'tutor') continue;
    ((card.props.buttons ?? []) as TutorButton[]).forEach((b, k) => find(String(card.props.tutor), k, b.label));
  }
  for (const tutor of Object.keys(ws.config.tutors)) {
    for (const date of (await listDates(ws, tutor)).filter((d) => d >= from && d <= today).sort()) {
      let index;
      try {
        index = await readIndex(ws, tutor, date);
      } catch {
        continue;
      }
      const ths = threads(index.messages);
      index.messages.forEach((m, i) => {
        if (!m.via || m.via.home !== home.id) return;
        find(tutor, m.via.button, m.via.label).uses.push({ date, job: m.job, thread: ths[i] });
      });
    }
  }
  return { home, error, days, clicks };
}

const BUTTON_ICON: Record<string, string> = { new: '✨', start: '▶', continue: '↻', lecture: '▷' };

/** cotutor home check 的文字版 */
export function formatCheck(ws: Workspace, check: HomeCheck, title: string, kid: KidHomeView): string {
  const out: string[] = [`${title}${check.doc.for ? `(for ${check.doc.for})` : ''}`];
  const display = (name: string): string => ws.config.tutors[name]?.display ?? name;
  const written = new Set(check.doc.cards.filter((c) => c.kind === 'tutor').map((c) => String(c.props.tutor)));
  out.push('老师卡(孩子端的样子,讲法只有老师看得到)');
  for (const c of kid.cards.filter((x) => x.kind === 'tutor')) {
    const name = String(c.props.tutor);
    const src = check.doc.cards.find((x) => x.kind === 'tutor' && x.props.tutor === name);
    const briefs = ((src?.props.buttons ?? []) as TutorButton[]).map((b) => b.brief);
    const buttons = (c.props.buttons as KidHomeButton[]).map((b) => {
      const brief = typeof b.id === 'number' && briefs[b.id] ? `(讲法 ${Array.from(briefs[b.id]!).length} 字)` : '';
      const act = typeof b.id === 'number' ? ((src?.props.buttons ?? []) as TutorButton[])[b.id] : undefined;
      const ref = b.kind === 'continue' ? ` → ${b.date} ${b.thread}` : b.kind === 'lecture' ? ` → 小课堂 ${b.bundle}` : act?.kind === 'activity' ? ` → activity ${act.activity}${Object.keys(act.params).length ? `(${Object.entries(act.params).map(([k, v]) => `${k}: ${v}`).join(';')})` : ''}` : '';
      return `${BUTTON_ICON[b.kind]} ${b.label}${ref}${brief}`;
    });
    out.push(`  ${display(name)} ${name}${written.has(name) ? '' : '(没写,应用补)'}:${buttons.join(' | ')}`);
  }
  const rest = kid.cards.filter((x) => x.kind !== 'tutor');
  if (rest.length) {
    out.push('其余的卡');
    // 听写卡在孩子端剥了字,家长看的这份从草稿里的原卡取词表
    const lists = check.doc.cards.filter((x) => x.kind === 'dictation');
    let k = 0;
    // 归哪位老师:孩子端只在那位老师展开时看到;公共的放在头像那一叠上面
    for (const c of rest) out.push(`  ${c.kind}「${cardLabel(c.kind === 'dictation' ? (lists[k++] ?? c) : c)}」 → ${c.owner ? `${display(c.owner)}的卡里` : '公共(头像上面)'}`);
  }
  out.push(`家长段:${check.doc.note ? `${check.doc.note.split('\n').length} 行` : '没有'}`);
  const fixes = check.issues.filter((i) => i.level === 'fix');
  const notes = check.issues.filter((i) => i.level === 'note');
  const where = (i: HomeIssue): string => (i.line ? `第 ${i.line} 行 ` : '');
  if (fixes.length) out.push(`要改 ${fixes.length} 条`, ...fixes.map((i) => `  ✗ ${where(i)}${i.text}`));
  if (notes.length) out.push(`提醒 ${notes.length} 条`, ...notes.map((i) => `  · ${where(i)}${i.text}`));
  if (!fixes.length && !notes.length) out.push('没有问题');
  return out.join('\n');
}

/** cotutor home show 的文字版 */
export function formatStats(ws: Workspace, s: HomeStats): string {
  if (!s.home) return s.error ? `已发布的首页用不了(孩子端是缺省首页):${s.error}` : '还没发布过首页:孩子端是缺省首页(每位老师一张只有「新话题」的卡)';
  const h = s.home;
  const tutorsN = h.cards.filter((c) => c.kind === 'tutor').length;
  const out = [`已发布 ${h.id}(${s.days === 0 ? '今天' : `${s.days} 天前`}${h.for ? `,for ${h.for}` : ''})· ${tutorsN} 张老师卡 · ${h.cards.length - tutorsN} 张别的卡 · 原文 ${h.source}`];
  const icon = (b: HomeClick['button']): string => (b === 'new' ? '✨' : b === 'recent' ? '↻' : '·');
  for (const c of s.clicks) {
    const who = ws.config.tutors[c.tutor]?.display ?? c.tutor;
    out.push(`  ${who} ${icon(c.button)} ${c.label}:${c.uses.length ? `点了 ${c.uses.length} 次(${c.uses.map((u) => `${u.date} ${u.thread}`).join('、')})` : '没点过'}`);
  }
  if (h.warnings.length) out.push(`发布时的提醒:${h.warnings.join(';')}`);
  return out.join('\n');
}

/** 发布到现在几天(按本地日期) */
export function daysSince(home: Pick<PublishedHome, 'publishedAt'>, now: Date): number {
  const day = (d: Date): number => Date.parse(`${localDate(d)}T00:00:00`);
  return Math.max(0, Math.round((day(now) - day(new Date(home.publishedAt))) / 86400000));
}

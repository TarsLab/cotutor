/**
 * 首页的读写(《首页设计.md》):草稿 home/draft.md → 检查(引用读盘查)→ 发布 home/published.json + home/history/<id>.md;
 * 孩子端的首页现算(老师卡置顶、补缺、剥讲法、今天的「接着刚才的」);孩子点按钮发来的 via 在这里对上发布的那份,讲法只从这里取;
 * 接着以前话题时上下文包的 continue 段;家长看的点击统计。CLI(cotutor home)、家长端「首页」页、孩子端都走这里。
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { cardLabel, describeCard, stripSecrets, type TutorButton } from '../cards/index.ts';
import { UsageError, type Workspace } from '../cli/workspace.ts';
import { conversationFiles, isPrepThread, kidSpoke, localDate, threads } from '../lib/conversation.ts';
import { kidQuestions } from '../lib/diary.ts';
import { arrangeHome, dropFixes, faceTutor, homeId, homeIssues, homeRefs, homeTutors, kidButtons, parseHome, threadKey, type HomeCheckContext, type HomeDoc, type HomeIssue, type HomeTutorInfo, type KidHomeButton } from '../lib/home.ts';
import type { BoardCard } from '../lib/kid-board.ts';
import { kidConversation, kidThreads } from '../lib/kid-view.ts';
import { HOME_ID_RE, PublishedHomeSchema, type ContextPack, type ConversationIndex, type HomeVia, type MessageVia, type PublishedHome } from '../schema/index.ts';
import { listDates, readCardStates, readIndex } from './store.ts';

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
  return Object.fromEntries(Object.entries(ws.config.tutors).map(([k, t]) => [k, { display: t.display, enabled: t.enabled, hidden: t.hidden }]));
}

/** 这些引用里真在的话题;其中家长备课、孩子还没开口的另列(交没交给孩子;《备课设计.md》§4.1) */
async function liveThreads(ws: Workspace, refs: readonly { tutor: string; date: string; thread: string }[]): Promise<{ alive: Set<string>; prep: Map<string, 'handed' | 'unhanded'> }> {
  const alive = new Set<string>();
  const prep = new Map<string, 'handed' | 'unhanded'>();
  const cache = new Map<string, ConversationIndex | null>();
  for (const r of refs) {
    if (!ws.config.tutors[r.tutor]) continue;
    const key = `${r.tutor} ${r.date}`;
    if (!cache.has(key)) cache.set(key, await readIndex(ws, r.tutor, r.date).catch(() => null));
    const index = cache.get(key);
    if (!index || !threads(index.messages).includes(r.thread)) continue;
    const k = threadKey(r.tutor, r.date, r.thread);
    alive.add(k);
    if (isPrepThread(index.messages, r.thread) && !kidSpoke(index.messages, r.thread)) prep.set(k, index.openings[r.thread] ? 'handed' : 'unhanded');
  }
  return { alive, prep };
}

async function checkContext(ws: Workspace, doc: Pick<HomeDoc, 'cards'>, now: Date): Promise<HomeCheckContext> {
  const { alive, prep } = await liveThreads(ws, homeRefs(doc));
  return { tutors: tutorInfos(ws), threads: alive, prep, today: localDate(now) };
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

/**
 * 家长把备课话题交给孩子(《备课设计.md》§4.1):往草稿里这位老师的老师卡追加一行「接着 <日期> <话题> <字>」,再发布。
 * 没有草稿就从已发布那份的原文起;没有这张卡就补一张;卡里已经有指这个话题的「接着」行就换字,不加第二行。
 * 检查有「要改」就不发(草稿里追加的那行留着),调用方把 issues 列给家长
 */
export async function appendContinue(ws: Workspace, tutor: string, date: string, thread: string, label: string, now: Date): Promise<PublishResult> {
  const f = homeFiles(ws);
  let md = await readDraft(ws);
  if (md === null) {
    const { home } = await readPublished(ws);
    md = home ? ((await publishedSource(ws, home)) ?? '') : '';
  }
  const line = `接着 ${date} ${thread} ${label}`;
  const lines = md.split('\n');
  const open = new RegExp(`^\`\`\`tutor\\s+${tutor}\\s*$`);
  const start = lines.findIndex((l) => open.test(l.trim()));
  if (start < 0) md = `${md.trimEnd()}${md.trim() ? '\n\n' : ''}\`\`\`tutor ${tutor}\n${line}\n\`\`\`\n`;
  else {
    let end = lines.findIndex((l, i) => i > start && /^```\s*$/.test(l.trim()));
    if (end < 0) end = lines.length;
    const same = new RegExp(`^(?:[-*+]\\s+)?接着\\s+${date}\\s+${thread}\\s`);
    const k = lines.findIndex((l, i) => i > start && i < end && same.test(l.trim()));
    if (k >= 0) lines[k] = line;
    else lines.splice(end, 0, line);
    md = lines.join('\n');
  }
  await mkdir(f.dir, { recursive: true });
  await writeFile(f.draft, md);
  return publishHome(ws, { now });
}

/** 已发布那份的原文(home/history/<id>.md);不在了 → null */
export async function publishedSource(ws: Workspace, home: Pick<PublishedHome, 'source'>): Promise<string | null> {
  return readFile(resolve(ws.root, home.source), 'utf8').catch(() => null);
}

/** 历史 id → 原文路径(家长端「回到这份」用;id 不合法 → null) */
export function historyFile(ws: Workspace, id: string): string | null {
  return HOME_ID_RE.test(id) ? join(homeFiles(ws).history, `${id}.md`) : null;
}

export interface KidHomeView {
  /** 发布的 id;缺省首页 / 预览草稿 = null */
  home: string | null;
  /** 老师卡在前(props.buttons 是孩子端的按钮),其余卡照文件顺序;答案与讲法已剥(keepBriefs 除外) */
  cards: BoardCard[];
}

/** 这位老师今天孩子能接着的话题(孩子端最后一条所在、孩子在里面说过话的) */
async function recentThread(ws: Workspace, tutor: string, today: string): Promise<{ date: string; thread: string; title: string } | null> {
  try {
    const msgs = kidConversation(await readIndex(ws, tutor, today));
    const last = msgs[msgs.length - 1];
    const t = last && kidThreads(msgs).find((x) => x.thread === last.thread);
    return t ? { date: today, thread: t.thread, title: t.title } : null;
  } catch {
    return null;
  }
}

/**
 * 孩子端的首页卡:source = 已发布的(缺省)/ 草稿(家长预览)/ 缺省。
 * 老师卡按 arrangeHome 排、按钮按 kidButtons 算;其余卡过 stripSecrets。
 */
export async function kidHomeView(ws: Workspace, now: Date, opts: { source?: 'published' | 'draft'; keepBriefs?: boolean } = {}): Promise<KidHomeView> {
  const today = localDate(now);
  let id: string | null = null;
  let cards: BoardCard[] = [];
  if (opts.source === 'draft') {
    const md = await readDraft(ws);
    if (md !== null) cards = parseHome(md).cards;
  } else {
    const { home } = await readPublished(ws);
    if (home) {
      id = home.id;
      cards = home.cards;
    }
  }
  const tutors = homeTutors(tutorInfos(ws));
  const { alive, prep } = await liveThreads(ws, homeRefs({ cards }));
  const out: BoardCard[] = [];
  for (const c of arrangeHome(cards, tutors)) {
    if (c.kind !== 'tutor') {
      out.push(stripSecrets({ cards: [c], lines: [] }).cards[0]);
      continue;
    }
    const name = String(c.props.tutor);
    const buttons = kidButtons((c.props.buttons ?? []) as TutorButton[], {
      recent: await recentThread(ws, name, today),
      alive: (date, thread) => alive.has(threadKey(name, date, thread)),
      handed: (date, thread) => prep.get(threadKey(name, date, thread)) === 'handed',
      keepBriefs: opts.keepBriefs,
    });
    out.push({ kind: 'tutor', props: { tutor: name, buttons } });
  }
  return { home: id, cards: out };
}

export type ResolvedVia =
  | { kind: 'new'; label: string }
  | { kind: 'recent'; label: string }
  | { kind: 'start'; label: string; brief?: string }
  | { kind: 'continue'; label: string; date: string; thread: string; brief?: string };

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
  return b.kind === 'start' ? { kind: 'start', label: b.label, ...(b.brief ? { brief: b.brief } : {}) } : { kind: 'continue', label: b.label, date: b.date, thread: b.thread, ...(b.brief ? { brief: b.brief } : {}) };
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

const BUTTON_ICON: Record<string, string> = { new: '✨', start: '▶', continue: '↻' };

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
      const ref = b.kind === 'continue' ? ` → ${b.date} ${b.thread}` : '';
      return `${BUTTON_ICON[b.kind]} ${b.label}${ref}${brief}`;
    });
    out.push(`  ${display(name)} ${name}${written.has(name) ? '' : '(没写,应用补)'}:${buttons.join(' | ')}`);
  }
  const rest = kid.cards.filter((x) => x.kind !== 'tutor');
  if (rest.length) {
    out.push('其余的卡');
    for (const c of rest) out.push(`  ${c.kind}「${cardLabel(c)}」`);
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

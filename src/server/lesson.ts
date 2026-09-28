/**
 * 课文件(《备课设计.md》§十)的读写:lessons/<名>.md → 检查(老师在不在、主题槽名)→ 后期提案回写(cotutor lesson post --write)→ 交给孩子(cotutor lesson hand):
 * 配音每句、在 conversations/<老师>/<今天>.json 建一个备课话题(一节一轮、from parent、第一条 prepThread、没有会话)、lessons[thread] 记 handedAt 与文件、
 * 首页草稿追加「接着」再发布。家长端备课话题的「交给孩子」先把那几节写成课文件(exportThread)再走同一条路。
 * 交了、孩子没开口:再交覆盖同一个话题(话题 id 不变,首页那行不用改);孩子开口后再交是新话题。
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cardAssets } from '../cards/index.ts';
import { UsageError, type Workspace } from '../cli/workspace.ts';
import { parseBoard } from '../lib/board.ts';
import { conversationFiles, isPrepThread, jobId, kidSpoke, localDate, localMinute, prepJobs, threads } from '../lib/conversation.ts';
import type { HomeTutorInfo } from '../lib/home.ts';
import type { BoardSection, Device } from '../lib/kid-board.ts';
import { kidSource } from '../lib/kid-view.ts';
import { LESSONS_DIR, LESSON_NAME_RE, applyLayoutReply, applyPostToLesson, cardBrief, lessonIssues, parseLesson, withAudio, type LessonDoc, type LessonIssue } from '../lib/lesson.ts';
import { layoutPrompt } from '../lib/prep-doc.ts';
import { withProxy } from '../lib/proxy.ts';
import { parseSections } from '../lib/sections.ts';
import { fillRuntime, resolvePolicy, type ConversationIndex, type ConversationMessage } from '../schema/index.ts';
import { appendContinue, type PublishResult } from './home.ts';
import { spawnPost, unwrapJsonOutput } from './post.ts';
import { readIndex, readTranscript, writeIndex } from './store.ts';
import { themeFiles } from './theme.ts';
import { DubQueue } from './tts.ts';

export function lessonFiles(ws: Pick<Workspace, 'root'>): { dir: string; file: (name: string) => string; rel: (name: string) => string } {
  const dir = join(ws.root, LESSONS_DIR);
  return { dir, file: (name) => join(dir, `${name}.md`), rel: (name) => `${LESSONS_DIR}/${name}.md` };
}

/** 文件名 → 课的名字(去掉 .md 与目录);不合法 → null */
export function lessonName(raw: string): string | null {
  const base = raw.replace(/^.*[\\/]/, '').replace(/\.md$/i, '');
  return LESSON_NAME_RE.test(base) ? base : null;
}

export interface LessonListItem {
  name: string;
  source: string;
  mtime: string;
  tutor: string | null;
  sections: number;
  cards: number;
  fixes: number;
}

export async function listLessons(ws: Workspace, now: Date): Promise<LessonListItem[]> {
  const f = lessonFiles(ws);
  const names = (await readdir(f.dir).catch(() => [] as string[])).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)).filter((n) => LESSON_NAME_RE.test(n)).sort();
  const out: LessonListItem[] = [];
  for (const name of names) {
    const md = await readFile(f.file(name), 'utf8').catch(() => null);
    if (md === null) continue;
    const st = await stat(f.file(name)).catch(() => null);
    const c = await checkLesson(ws, md, now);
    out.push({ name, source: f.rel(name), mtime: st?.mtime.toISOString() ?? '', tutor: c.doc.tutor, sections: c.doc.sections.length, cards: c.doc.sections.reduce((s, x) => s + x.section.cards.length, 0), fixes: c.fixes });
  }
  return out;
}

export async function readLesson(ws: Workspace, name: string): Promise<string | null> {
  return readFile(lessonFiles(ws).file(name), 'utf8').catch(() => null);
}

export interface LessonCheck {
  doc: LessonDoc;
  issues: LessonIssue[];
  fixes: number;
}

function tutorInfos(ws: Workspace): Record<string, HomeTutorInfo> {
  return Object.fromEntries(Object.entries(ws.config.tutors).map(([k, t]) => [k, { display: t.display, enabled: t.enabled, hidden: t.hidden }]));
}

export async function checkLesson(ws: Workspace, md: string, now: Date): Promise<LessonCheck> {
  const doc = parseLesson(md);
  const theme = await themeFiles(ws.root, ws.config.kid.theme);
  const issues = lessonIssues(doc, { tutors: tutorInfos(ws), tints: Object.keys(theme.manifest.tints), looks: Object.keys(theme.manifest.looks), today: localDate(now) });
  return { doc, issues, fixes: issues.filter((i) => i.level === 'fix').length };
}

export function formatCheck(check: LessonCheck, shown: string): string {
  const out = [`${shown}:${check.doc.tutor ?? '(没写 tutor)'} · ${check.doc.sections.length} 节 · ${check.doc.sections.reduce((s, x) => s + x.section.cards.length, 0)} 张卡 · ${check.doc.device}${check.doc.for ? ` · for ${check.doc.for}` : ''}`];
  check.doc.sections.forEach((s, k) => {
    out.push(`  第 ${k + 1} 节:${s.section.cards.map(cardBrief).join(' · ') || '(没有卡)'};${s.section.lines.length} 句${s.section.layout ? ` · 行 ${s.section.layout.rows.map((r) => r.length).join('/')}` : ''}`);
  });
  for (const i of check.issues) out.push(`  ${i.level === 'fix' ? '✗ 要改' : '· 提醒'}${i.line ? ` 第 ${i.line} 行` : ''}:${i.text}`);
  if (!check.issues.length) out.push('  没有问题');
  return out.join('\n');
}

export interface PostLessonResult {
  ok: boolean;
  /** --write 之后的全文(没写就是原文) */
  md: string;
  fences: number;
  marks: number;
  costUsd: number;
  ms: number;
  error?: string;
}

/**
 * 整份排一版(《备课设计.md》§10.4,拍板 31):课文件全文 + 排版规则(和 cotutor-prep 技能 references/排版.md 同一份,带这个主题的槽表)一次交给模型
 * (policy.post.runtime 那条运行时,缺省 haiku;--model 可换),它回整份文件;正文剥掉排版后必须逐字相同,否则整份不要;
 * 你手写过的修饰词当已定。给家长手写的文件用;技能写的文件写的时候就排好了
 */
export async function postLesson(ws: Workspace, name: string, opts: { write?: boolean; env?: NodeJS.ProcessEnv; now?: Date; model?: string }): Promise<PostLessonResult> {
  const md = await readLesson(ws, name);
  if (md === null) throw new UsageError(`没有 ${lessonFiles(ws).rel(name)}`);
  const doc = parseLesson(md);
  if (!doc.tutor || !ws.config.tutors[doc.tutor]) throw new UsageError(`${name}:frontmatter 的 tutor 要是 cotutor.json 里的老师(现在是 ${doc.tutor ?? '没写'})`);
  const policy = resolvePolicy(ws.config, doc.tutor);
  const theme = await themeFiles(ws.root, ws.config.kid.theme);
  const rt = ws.config.runtimes[policy.post.runtime];
  if (!rt || typeof rt === 'string') throw new UsageError(`运行时 ${policy.post.runtime} 不在 cotutor.json 的 runtimes 里(cotutor upgrade --config 可补)`);
  const run = rt.run.map((a, i, xs) => (opts.model && i > 0 && xs[i - 1] === '--model' ? opts.model : a));
  const prompt = layoutPrompt(md, theme.manifest);
  const t0 = Date.now();
  const argv = fillRuntime(run, { agent: doc.tutor, prompt });
  // 一问一答,不要思考(同板书后期:haiku 一想就是几十秒)
  const r = await spawnPost(argv, ws.root, withProxy(argv, { ...(opts.env ?? process.env), COTUTOR_WORKSPACE: ws.root, MAX_THINKING_TOKENS: '0' }, ws.config.proxy), 180_000);
  const ms = Date.now() - t0;
  if (r.error) return { ok: false, md, fences: 0, marks: 0, costUsd: 0, ms, error: r.error };
  const { text, costUsd } = unwrapJsonOutput(r.out);
  const applied = applyLayoutReply(md, text);
  if (!applied.ok) return { ok: false, md, fences: 0, marks: 0, costUsd: costUsd ?? 0, ms, error: applied.why };
  if (opts.write && applied.md !== md) await writeFile(lessonFiles(ws).file(name), applied.md);
  return { ok: true, md: opts.write ? applied.md : md, fences: applied.fences, marks: applied.marks, costUsd: Math.round((costUsd ?? 0) * 1e4) / 1e4, ms };
}

export interface HandResult {
  ok: boolean;
  check: LessonCheck;
  tutor: string | null;
  date: string;
  /** 建的话题(检查没过就没有) */
  thread: string | null;
  label: string;
  cards: number;
  /** 首页发布的结果(话题建好了才有;首页有「要改」时 ok=false,草稿里那行留着) */
  home: PublishResult | null;
  source: string;
}

const seqOf = (job: string): number => Number(job.split('-')[1] ?? 0);

/**
 * 交给孩子:检查 → 配音 → 建话题(或覆盖同一课文件、孩子没开口的那个)→ lessons[thread] → 首页追加「接着」再发布。
 * label 是首页按钮上的字(≤ 16 字;不给就取第一节第一句截 16 字)
 */
export async function handLessonFile(ws: Workspace, name: string, opts: { label?: string; now: Date; env?: NodeJS.ProcessEnv }): Promise<HandResult> {
  const f = lessonFiles(ws);
  const md = await readLesson(ws, name);
  if (md === null) throw new UsageError(`没有 ${f.rel(name)}`);
  const check = await checkLesson(ws, md, opts.now);
  const source = f.rel(name);
  const firstLine = check.doc.sections[0]?.section.lines[0]?.text ?? '';
  const label = (opts.label ?? '').replace(/\s+/g, ' ').trim() || Array.from(firstLine.replace(/[。!?!?,,、:;\s]+$/, '')).slice(0, 16).join('') || name;
  const base: HandResult = { ok: false, check, tutor: check.doc.tutor, date: localDate(opts.now), thread: null, label, cards: 0, home: null, source };
  if (check.fixes || !check.doc.tutor) return base;
  const tutor = check.doc.tutor;
  const t = ws.config.tutors[tutor];
  const date = localDate(opts.now);
  let index = await readIndex(ws, tutor, date);
  const files = conversationFiles(ws.dirs.conversations, tutor, date);
  // 同一课文件、孩子还没开口的话题:覆盖它(话题 id 不变),旧的几轮的文件删掉
  const ths = threads(index.messages);
  const old = Object.entries(index.lessons).find(([th, l]) => l.source === source && l.handedAt && ths.includes(th) && isPrepThread(index.messages, th) && !kidSpoke(index.messages, th))?.[0] ?? null;
  if (old) {
    const gone = index.messages.filter((_, i) => ths[i] === old);
    const dir = join(ws.dirs.conversations, tutor);
    const prefixes = gone.map((m) => `${date}.${m.job}.`);
    for (const e of await readdir(dir).catch(() => [] as string[])) if (prefixes.some((p) => e.startsWith(p))) await rm(join(dir, e), { recursive: true, force: true });
    index = { ...index, messages: index.messages.filter((_, i) => ths[i] !== old) };
  }
  // 序号接着这天最大的往下数(覆盖旧话题时它的第一轮 id 沿用,序号也要跳过它)
  let seq = Math.max(index.messages.reduce((s, m) => Math.max(s, seqOf(m.job)), 0), old ? seqOf(old) : 0);
  const thread = old ?? jobId(opts.now, ++seq);
  const at = localMinute(opts.now);
  const queue = t.voice ? new DubQueue(ws.config.tts, t.voice, files.err(thread), opts.env) : null;
  const messages: ConversationMessage[] = [];
  for (const [k, s] of check.doc.sections.entries()) {
    const job = k === 0 ? thread : jobId(opts.now, ++seq);
    const audio = queue ? await Promise.all(s.section.lines.map((l, i) => (l.text.trim() ? queue.add(files.lineAudio(job, i + 1), l.text, `第 ${k + 1} 节第 ${i + 1} 句`) : Promise.resolve(null)))) : s.section.lines.map(() => null);
    if (queue) {
      await Promise.all(s.section.cards.map(async (c, n) => {
        const list = cardAssets(c);
        if (!list.length) return;
        await mkdir(files.cardAssetsDir(job, n), { recursive: true });
        await Promise.all(list.map((a) => queue.add(files.cardAsset(job, n, a.file), a.text, `第 ${k + 1} 节第 ${n + 1} 张卡的 ${a.file} `)));
      }));
    }
    const section = withAudio(s.section, audio);
    messages.push({ job, thread, at, from: 'parent', text: k === 0 ? `课文件 ${name}` : `课文件 ${name} · 第 ${k + 1} 节`, result: 'ok', costUsd: 0, kidText: section.lines.map((l) => l.text).join('\n') || null, artifacts: [], section, device: check.doc.device, ...(k === 0 ? { prepThread: true as const } : {}) });
  }
  const next: ConversationIndex = { ...index, messages: [...index.messages, ...messages], lessons: { ...index.lessons, [thread]: { handedAt: opts.now.toISOString(), source } } };
  await writeIndex(ws, next);
  const home = await appendContinue(ws, tutor, date, thread, label, opts.now);
  return { ...base, ok: true, thread, cards: messages.reduce((s, m) => s + (m.section?.cards.length ?? 0), 0), home };
}

/**
 * 家长端备课话题里老师写的那几节 → 课文件 lessons/<日期>-<话题>.md(《备课设计.md》§10.3 第 3 条):每轮的原文(转录里的板书,到第一个 H2 为止)
 * 一节,后期定的行与样子写成围栏行的修饰词、标注写成 [词];家长在话题里说过的话进「## 讲法」。转录不在的轮跳过(skipped 里说)。
 * 写完记 lessons[thread].source(不记 handedAt:聊天的话题本身不给孩子看,给孩子的是从文件建的那个)
 */
export async function exportThread(ws: Workspace, tutor: string, date: string, thread: string): Promise<{ name: string; source: string; md: string; skipped: string[] }> {
  const index = await readIndex(ws, tutor, date);
  const ths = threads(index.messages);
  const prep = prepJobs(index.messages);
  const mine = index.messages.filter((_, i) => ths[i] === thread);
  const chunks: string[] = [];
  const posted: BoardSection[] = [];
  const skipped: string[] = [];
  for (const m of mine) {
    if (!prep.has(m.job) || m.result !== 'ok' || !m.section || !m.section.cards.some((c) => !c.props.ask)) continue;
    const tr = await readTranscript(ws, tutor, date, m.job);
    const raw = tr ? kidSource(tr) : null;
    if (!raw) { skipped.push(`${m.job}:转录不在,这一节没写进去`); continue; }
    const body = parseSections(raw).body;
    const b = parseBoard(body);
    const lines = body.split('\n');
    const cut = b.spans.tail ? lines.slice(0, b.spans.tail[0]) : lines;
    chunks.push(cut.join('\n').trim());
    posted.push(m.section);
  }
  const said = mine.filter((x) => x.from === 'parent' && !x.action && x.text.trim() && x.text.trim() !== '继续').map((x) => x.text.trim());
  const name = `${date}-${thread}`;
  const f = lessonFiles(ws);
  const head = `---\ntutor: ${tutor}\n---\n\n`;
  const brief = said.length ? `\n\n## 讲法\n\n${said.map((s) => `- ${s}`).join('\n')}\n` : '\n';
  let md = `${head}${chunks.join('\n\n---\n\n')}${brief}`;
  // 后期的决定回写:先按文件解析出各节的行号,再把原节(带 layout / look / 标注)套上去
  const doc = parseLesson(md);
  md = applyPostToLesson(md, doc, posted).md;
  await mkdir(f.dir, { recursive: true });
  await writeFile(f.file(name), md);
  const cur = index.lessons[thread] ?? { handedAt: null };
  await writeIndex(ws, { ...index, lessons: { ...index.lessons, [thread]: { ...cur, source: f.rel(name) } } });
  return { name, source: f.rel(name), md, skipped };
}

/** 家长端课文件页(《备课设计.md》§10.6)的一份:一节一条(job 带内容 hash,文件一改页面就重铺),答案不剥(是家长看),不配音(mp3 没有走浏览器的声) */
export interface LessonPage {
  name: string;
  source: string;
  tutor: string | null;
  device: Device;
  for: string | null;
  brief: string;
  mtime: string | null;
  issues: LessonIssue[];
  fixes: number;
  cards: number;
  sections: { job: string; at: string; from: number; section: BoardSection }[];
  /** 交给孩子了:哪个话题、首页按钮上的字(发布件里查得到才有)、孩子开口没有;没交 null */
  handed: { thread: string; date: string; label: string | null; kidSpoke: boolean } | null;
  /** 从家长端哪个备课话题写出来的(那个话题的 lessons[].source 指着这份、没交);没有 null */
  fromThread: string | null;
}
export function lessonPage(name: string, check: LessonCheck, mtime: string | null, handed: LessonPage['handed'], fromThread: string | null, now: Date): LessonPage {
  const at = localMinute(now);
  const hash = (s: string): string => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0; return h.toString(36); };
  const sections = check.doc.sections.map((s, k) => ({ job: `L${k + 1}-${hash(JSON.stringify(s.section))}`, at, from: s.cardLines.find((l) => l > 0) ?? s.lineLines[0] ?? 0, section: s.section }));
  return { name, source: lessonFiles({ root: '' }).rel(name), tutor: check.doc.tutor, device: check.doc.device, for: check.doc.for ?? null, brief: check.doc.brief, mtime, issues: check.issues, fixes: check.fixes, cards: sections.reduce((n, s) => n + s.section.cards.length, 0), sections, handed, fromThread };
}

/** 某份课文件在这位老师今天的索引里的下落:交出去的话题(handedAt)、从哪个备课话题写出来的 */
export function lessonThreads(index: ConversationIndex, source: string): { handed: string | null; from: string | null } {
  const ths = threads(index.messages);
  let handed: string | null = null;
  let from: string | null = null;
  for (const [th, l] of Object.entries(index.lessons)) {
    if (l.source !== source || !ths.includes(th)) continue;
    if (l.handedAt) handed = th;
    else from = th;
  }
  return { handed, from };
}

/** 某个话题交出去的课文件(runner 拼孩子第一条的上下文包用):文件路径与讲法;没有 / 读不到 → null */
export async function handedLessonOf(ws: Workspace, index: ConversationIndex, thread: string): Promise<{ file: string; brief: string } | null> {
  const src = index.lessons[thread]?.source;
  if (!src) return null;
  const md = await readFile(join(ws.root, src), 'utf8').catch(() => null);
  if (md === null) return null;
  return { file: join(ws.root, src), brief: parseLesson(md).brief };
}


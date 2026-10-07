/**
 * 发消息 = 拼上下文包 → 按运行时 spawn / resume → stream-json 落 conversations/<老师>/<日期>.<job>.log → 索引更新
 * (最终文本 → 板书节 section + 讲稿逐句配音 <日期>.<job>.<n>.mp3 + 家长尾巴 parentText + 解析提醒 warnings)。
 * 流式:stdout 经本进程落盘,同时喂 PartialReader 拼当前回复正文 → parseBoard(partial) → 内存里的 partial section
 * (孩子端 pending 条目带着它,卡随围栏闭合逐张出现);讲稿每定稿一句就开始配音,整轮跑完只等没配完的;
 * 点读段等资产在索引写好之后后台接着配(同一条队列),孩子端点到还没好的段用浏览器的声。
 * 一老师同时只跑一条(老师还在回上一条就 409),跨天自动新开(索引按本地日期分文件,新文件没 session 就不带 --resume)。
 * 话题(2026-09-11):一天可多个,每个话题自己的会话(index.sessions[thread]);newThread / 系统消息 / 今天第一条开新话题(不 resume、不带旧卡),
 * 指定 thread 接着今天的旧话题(resume 它的会话),缺省接当前话题。
 * 埋点(2026-09-11):每轮记 timing(进程起的时刻、首卡、进程退出、配音收尾,毫秒),家长视图每轮一行。
 * 进程 cwd 是老师目录 agents/<name>/(《agent层设计.md》拍板)。
 */
import { spawn } from 'node:child_process';
import { lecturePack, readLecture, storedMarks, type IncomingMark } from './lecture.ts';
import { closeSync, createWriteStream, existsSync, openSync, writeSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { buildContextPack } from '../lib/context-pack.ts';
import { addMessage, applyRun, cardId, lastJobOf, changedCards, conversationFiles, jobId, localDate, localMinute, sessionFor, threads } from '../lib/conversation.ts';
import { appendDiary, bookkeepingPrompt, diaryTopic, entryFor, extractObservations, kidQuestions, recentDiaryDates, renderDiaryBlock, textbookHeadings } from '../lib/diary.ts';
import { cardAssets, cardLabel, describeCard, tutorCardKinds, type RecordProps } from '../cards/index.ts';
import { boardGuideFor } from '../cards/docs.ts';
import { KouboQueue } from './koubo.ts';
import { withProxy } from '../lib/proxy.ts';
import { parseBoard } from '../lib/board.ts';
import { readyBeats, beatsOf, type BoardSection, type Device } from '../lib/kid-board.ts';
import { deriveKidView, truncateReply } from '../lib/kid-view.ts';
import { createPartialReader } from '../lib/stream.ts';
import { parseSections } from '../lib/sections.ts';
import { isoWeek, parsePlan, planLinesFor } from '../lib/plan.ts';
import { getRuntime, planRun, runtimeUses, stallPrompt, type RunPlan, boardPreloaded } from '../lib/run-plan.ts';
import { currentSlot, parseTimetable, slotLabel } from '../lib/timetable.ts';
import { parseTranscript, toolCalls, toolSummary } from '../lib/transcript.ts';
import { beatTimings, type RunEvent, type RunEventEnvelope, type RunEventInput } from '../lib/events.ts';
import { MEMORY_MAX_PER_TURN, MEMORY_TIDY_CAP, TUTOR_TOOLS, VAULT_PACK_ROLES, resolvePolicy, type Bookkeeping, type ContextPack, type ConversationIndex, type ConversationMessage, type Focus, type MessageFrom, type MessageVia, type Policy, type Runtime, type Timing } from '../schema/index.ts';
import { UsageError, type Workspace } from '../cli/workspace.ts';
import { updateVaultMemory, readAgentBody, readCardStates, readDiaries, readIndex, readTextbooks, scanVault, snapshotSources, writeDiary, writeIndex, writeRunFile } from './store.ts';
import { clipNote, memoryCount, missingEntry, pickNotes, textHash, tidyMemoryPrompt, type MemoryLine } from '../lib/vault-notes.ts';
import { TUTOR_RULES_PATH, takesTutorRules, tutorRulesBody, BOARD_GUIDE_IN_SYSTEM, BOARD_GUIDE_PATH, boardGuideBody, boardGuideReads } from '../lib/tutor-rules.ts';
import { DubQueue, LineDubber } from './tts.ts';
import { WarmPool, type Spare } from './warm.ts';
import { continueContext } from './home.ts';

export class BusyError extends Error {
  constructor(tutor: string, job: string) {
    super(`${tutor} 还在回上一条(${job}),等它说完再发`);
  }
}

export interface SendInput {
  from: MessageFrom;
  /** 带 action 时可以是空的:继续 → 「继续」;交给老师 → 「(交了答案,没说话)」 */
  text: string;
  focus?: Focus;
  /** 孩子端的动作:继续(不计每日上限)/ 交给老师(把改过的卡交出去) */
  action?: 'continue' | 'submit';
  /** 运行时名,缺省 cotutor.json 的 runtimes.default */
  runtime?: string;
  /** 开新话题:不 resume、不带旧话题卡上的状态;话题 id = 这条的 job */
  newThread?: boolean;
  /** 接着今天的某个话题聊(话题 id);缺省 = 当前(末条所在的)话题。from: system 的永远开新话题 */
  thread?: string;
  /** 孩子端是什么端(记进消息);缺省当平板横屏 */
  device?: Device;
  /** 记到哪一天的索引(缺省今天);记账给昨天的话题用 */
  date?: string;
  /** 这轮是记账任务(《obsidian仓库设计.md》§6):resume 那个话题的会话,老师回「## 记账」段,应用写日记 */
  bookkeep?: { thread: string };
  /** 这轮是记账后整理记忆(2026-09-18):新会话,「## 记忆」段不受每轮条数上限,孩子端看不到 */
  tidy?: boolean;
  /** 按住说话时的原声(已由路由解码、验过扩展名与大小):落成 <日期>.<job>.voice.<ext>,消息记 voice;只给家长端,不进上下文包 */
  voice?: { data: Buffer; ext: string; seconds: number };
  /** 这条带的作业照片(相对 workspace 根,已由路由验过在 captures/ 里;R5):进上下文包 photos: 段,老师自己 Read 看图;文字可以空 */
  photos?: string[];
  /** 这条是回放(server/replay.ts):原轮的 job,记进消息;调用方已经把 Runner 指到 evals/ */
  replayOf?: string;
  /** 孩子看完小课堂后的第一条(《小课堂设计.md》§六):上下文包带 lecture:(课的每句、看的情况、圈过的几处),消息记 lecture;again = 问过以后再看一遍又圈了 */
  lecture?: { bundle: string; watchedMs: number; finished: boolean; pauses: number; again?: boolean; marks?: IncomingMark[]; log?: { t: number; pos: number; play: boolean }[] };
  /** 孩子从首页哪个按钮进来的(《首页设计.md》§5.2),记进消息 */
  via?: MessageVia;
  /** 按钮的字与家长备好的讲法(服务端从发布件查的),进上下文包 home: 段 */
  home?: { button: string; brief?: string };
  /** 接着以前哪天的哪个话题:这条开新话题时上下文包带那个话题的尾巴(continue: 段),消息记 continues;pack 给了就不现读(回放从原 workspace 读好的) */
  continues?: { date: string; thread: string; pack?: NonNullable<ContextPack['continue']> };
}

export interface SendStarted {
  tutor: string;
  date: string;
  job: string;
  /** 这条消息所在的话题 */
  thread: string;
  plan: RunPlan;
  /** 老师说完(进程退出、索引写好)后 resolve */
  done: Promise<ConversationIndex>;
}

interface Active {
  job: string;
  date: string;
  done: Promise<ConversationIndex>;
  /** 还在说的时候已经解析出来的板书(卡只增不改;讲稿句已按 replyMaxChars 截) */
  partial: BoardSection | null;
}

/**
 * 上下文包的来源清单(2026-09-15,`cotutor pack` 干跑用):每段来自哪个文件、那里一共有多少、按政策带了几条。
 * 家长改了档案 / 入口文件 / 日记 / 计划,不起模型就能看到老师下一轮会看见什么、什么被截掉了。
 */
export interface PackReport {
  timetable: { file: string; found: boolean; slot: string | null };
  vault: { root: string; semester: string | null; profile: string | null; extraProfiles: string[]; entry: string | null; extraEntries: string[]; memory: string | null; extraMemories: string[]; subject: string | null; refs: string[]; limit: number; chars: { profile: number; entry: number; memory: number } };
  plan: { file: string; found: boolean; total: number; kept: number; limit: number };
  recent: { dir: string; days: number; filesFound: string[]; total: number; kept: number; limit: number; subject: string | null };
}

const MANY = 100_000;

/**
 * 上下文包的取材(《obsidian仓库设计.md》§7 每轮那行,2026-09-17 改):课程表命中的时段 + 老师守则(有脸的老师)+ 当前学期 + 档案与入口文件的原文(按 entryChars 截)
 * + 参考路径 + 本周计划里本老师的行 + 最近 14 天日记里本学科的「- 观察:」行。
 * 守则与笔记原文总是带上;同一话题里没改过的由 send 换成「未变」。
 */
export async function gatherContext(ws: Workspace, tutor: string, input: { from: MessageFrom; at: Date; focus?: Focus }, report?: PackReport): Promise<ContextPack> {
  const t = ws.config.tutors[tutor];
  const policy = resolvePolicy(ws.config, tutor);
  const pack: ContextPack = { at: localMinute(input.at), focus: input.focus, plan: [], recent: [] };
  if (report) report.timetable = { file: ws.paths.timetable, found: false, slot: null };
  try {
    const slot = currentSlot(parseTimetable(await readFile(ws.paths.timetable, 'utf8')).entries, input.at);
    if (report) report.timetable.found = true;
    if (slot) pack.slot = slotLabel(slot);
    if (report) report.timetable.slot = pack.slot ?? null;
  } catch {
    /* 没有课程表:不带 slot */
  }
  const { notes, files } = await scanVault(ws);
  const pick = pickNotes(notes, files, { date: localDate(input.at), subject: t?.subject, agent: tutor });
  const limit = policy.contextPack.entryChars;
  if (pick.semester) pack.semester = pick.semester;
  pack.notes = [];
  // 有脸的老师的公共守则:机器技能 cotutor-tutor 的原文,排在家长笔记前面(不截;同一话题没改过由 send 换成「未变」)
  if (takesTutorRules(tutor)) {
    try {
      pack.notes.push({ role: 'rules', path: TUTOR_RULES_PATH, text: tutorRulesBody(await readFile(join(ws.root, TUTOR_RULES_PATH), 'utf8'), tutorCardKinds(ws.config.tutors[tutor]?.cards) ?? undefined) });
      pack.rules = TUTOR_RULES_PATH;
    } catch {
      pack.rules = `缺:${TUTOR_RULES_PATH} 不在(cotutor upgrade 补),照你老师文件里的做`;
    }
  }
  for (const [role, n] of [['profile', pick.profile], ['entry', pick.entry], ['memory', pick.memory]] as const) {
    if (!n) continue;
    const clip = clipNote(n.text, limit, role === 'memory' ? 'tail' : 'head');
    pack[role] = clip.cut ? `${n.path}(原文 ${n.text.length} 字,${role === 'memory' ? `只带最近 ${limit}` : `截到 ${limit}`})` : n.path;
    pack.notes.push({ role, path: n.path, text: clip.text });
  }
  if (!pick.profile) pack.profile = '缺:vault 里没有 cotutor: profile 的档案';
  if (!pick.entry && t && tutor.endsWith('-tutor')) pack.entry = missingEntry(t.subject, pick);
  if (!pick.memory) pack.memory = '还没有';
  if (pick.refs.length) pack.refs = pick.refs.map((r) => join(ws.paths.vault, r));
  if (report) report.vault = { root: ws.paths.vault, semester: pick.semester, profile: pick.profile?.path ?? null, extraProfiles: pick.extraProfiles, entry: pick.entry?.path ?? null, extraEntries: pick.extraEntries, memory: pick.memory?.path ?? null, extraMemories: pick.extraMemories, subject: t?.subject ?? null, refs: pick.refs, limit, chars: { profile: pick.profile?.text.length ?? 0, entry: pick.entry?.text.length ?? 0, memory: pick.memory?.text.length ?? 0 } };
  const planFile = join(ws.paths.plans, `${isoWeek(input.at)}.md`);
  if (report) report.plan = { file: planFile, found: false, total: 0, kept: 0, limit: policy.contextPack.planLines };
  try {
    const { plan } = parsePlan(await readFile(planFile, 'utf8'));
    if (report) report.plan.found = true;
    if (plan && t) {
      pack.plan = planLinesFor(plan, t.display, policy.contextPack.planLines);
      if (report) report.plan = { ...report.plan, total: planLinesFor(plan, t.display, MANY).length, kept: pack.plan.length };
    }
  } catch {
    /* 没有本周计划,或读不到:上下文包不带 plan */
  }
  const dates = recentDiaryDates(localDate(input.at), 14);
  const diaries = await readDiaries(ws, dates);
  pack.recent = extractObservations(diaries, { subject: t?.subject, n: policy.contextPack.recent });
  if (report) report.recent = { dir: ws.paths.diary, days: dates.length, filesFound: diaries.map((d) => d.date).sort(), total: extractObservations(diaries, { subject: t?.subject, n: MANY }).length, kept: pack.recent.length, limit: policy.contextPack.recent, subject: t?.subject ?? null };
  pack.vault = vaultPack(ws.paths);
  return pack;
}

/** 按老师裁的板书写法落在哪(相对 workspace 根;机器文件,内容变了文件名跟着变) */
export const TUTOR_BOARD_DIR = '.cotutor/board';

/**
 * 这位老师的板书写法:正文 + 相对 workspace 根的路径(给 {boardFile} 与上下文包)。
 * 没写 cards → 出厂的 cotutor-board SKILL.md;写了 → 按清单从包里现拼(boardGuideFor),写到 .cotutor/board/<老师>-<hash>.md,
 * 文件名带内容的 hash:清单一改路径就变,预热进程的 argv 对不上,不会拿着旧写法去答。读不到 SKILL.md → null。
 */
export async function boardGuideOf(ws: Workspace, tutor: string): Promise<{ body: string; path: string } | null> {
  const kinds = tutorCardKinds(ws.config.tutors[tutor]?.cards);
  if (!kinds) {
    try {
      return { body: boardGuideBody(await readFile(join(ws.root, BOARD_GUIDE_PATH), 'utf8')), path: BOARD_GUIDE_PATH };
    } catch {
      return null;
    }
  }
  const body = boardGuideFor(kinds);
  const path = `${TUTOR_BOARD_DIR}/${tutor}-${textHash(body).slice(0, 8)}.md`;
  const file = join(ws.root, path);
  if (!existsSync(file)) {
    await mkdir(join(ws.root, TUTOR_BOARD_DIR), { recursive: true });
    await writeFile(file, body);
  }
  return { body, path };
}

/**
 * 板书写法怎么递给老师(2026-09-19):有脸的老师、板书没关才带。运行时预载了 → 上下文包只写一行事实;
 * 没预载 → 原文作为一条笔记放进话题第一条(<cotutor-board>),排在守则后面,续话题没改过写「未变」。返回板书写法(给 {systemBody} 与 {boardFile})。
 */
export async function attachBoardGuide(ws: Workspace, tutor: string, pack: ContextPack, o: { preloaded: boolean; boardOff: boolean }): Promise<{ body: string; path: string } | null> {
  if (!takesTutorRules(tutor) || o.boardOff) return null;
  const guide = await boardGuideOf(ws, tutor);
  if (!guide) {
    pack.boardGuide = `缺:${BOARD_GUIDE_PATH} 不在(cotutor upgrade 补),照你会的写`;
    return null;
  }
  if (o.preloaded) {
    pack.boardGuide = BOARD_GUIDE_IN_SYSTEM;
    return guide;
  }
  pack.boardGuide = guide.path;
  const notes = pack.notes ?? [];
  const at = notes.findIndex((n) => n.role === 'rules');
  notes.splice(at + 1, 0, { role: 'boardGuide', path: guide.path, text: guide.body });
  pack.notes = notes;
  return guide;
}

/**
 * 老师正文({agentBody})与系统提示({systemBody} = 正文 + 板书写法)、板书写法的文件({boardFile}):模板用到才读。send 与预热同一份,预热起的进程 argv 才对得上。
 * 顺手把板书写法挂到上下文包上(attachBoardGuide)。没递板书写法(工具人、板书关了)的 {boardFile} 照旧是出厂的 SKILL.md。
 */
async function systemParts(ws: Workspace, tutor: string, runtime: Runtime, policy: Policy, pack: ContextPack): Promise<{ agentBody?: string; systemBody?: string; boardFile: string }> {
  const wantsSystemBody = runtimeUses(runtime, '{systemBody}');
  const agentBody = runtimeUses(runtime, '{agentBody}') || wantsSystemBody ? await readAgentBody(ws, tutor) : undefined;
  const guide = await attachBoardGuide(ws, tutor, pack, { preloaded: boardPreloaded(runtime), boardOff: policy.board === 'off' });
  const systemBody = wantsSystemBody && agentBody !== undefined ? (guide ? `${agentBody}\n\n${guide.body}` : agentBody) : undefined;
  return { agentBody, systemBody, boardFile: join(ws.root, guide?.path ?? BOARD_GUIDE_PATH) };
}

/** 这轮带的笔记版本:role → `路径@hash`(记进消息;同一话题下一轮对得上就不再带原文) */
export function noteVersions(pack: ContextPack): Record<string, string> {
  return Object.fromEntries((pack.notes ?? []).map((n) => [n.role, `${n.path}@${textHash(n.text)}`]));
}

/** 续会话时:上一轮这个话题已经带过、版本没变的笔记去掉原文,YAML 里注明「未变」 */
export function dropSeenNotes(pack: ContextPack, seen: Record<string, string>): ContextPack {
  const now = noteVersions(pack);
  const keep = (pack.notes ?? []).filter((n) => seen[n.role] !== now[n.role]);
  const out: ContextPack = { ...pack, notes: keep };
  for (const n of pack.notes ?? []) if (!keep.includes(n)) out[n.role] = `${pack[n.role]}(未变,原文在本话题前面)`;
  return out;
}

/** 这个话题里最近一次记下的笔记版本(新话题、没记过 → {}) */
export function seenNotes(messages: readonly ConversationMessage[], thread: string): Record<string, string> {
  const ths = threads(messages);
  for (let i = messages.length - 1; i >= 0; i--) if (ths[i] === thread && messages[i].notes) return messages[i].notes as Record<string, string>;
  return {};
}

/** 干跑:现在给这位老师发这句话,上下文包会是什么样、每段从哪来、截了多少;不起模型、不写盘 */
export async function packDryRun(ws: Workspace, tutor: string, input: { from: MessageFrom; at: Date; text: string }): Promise<{ prompt: string; pack: ContextPack; report: PackReport }> {
  const t = ws.config.tutors[tutor];
  if (!t) throw new UsageError(`没有叫 ${tutor} 的老师;cotutor.json 的 tutors 里有:${Object.keys(ws.config.tutors).join('、')}`);
  const report = {} as PackReport;
  const pack = await gatherContext(ws, tutor, { from: input.from, at: input.at }, report);
  const policy = resolvePolicy(ws.config, tutor);
  if (policy.board === 'off') pack.board = 'off';
  const { runtime } = getRuntime(ws.config, t.runtime);
  // 和 send 同一条规矩:孩子的话不带工具时,只有工具才用得上的路径不进包
  if (policy.tools !== 'on' && input.from === 'kid' && runtimeUses(runtime, '{tools}')) { delete pack.refs; delete pack.vault; }
  await attachBoardGuide(ws, tutor, pack, { preloaded: boardPreloaded(runtime), boardOff: policy.board === 'off' });
  return { prompt: buildContextPack(pack, input.text, policy.contextPack), pack, report };
}

/** 上下文包的 vault: 段:root 绝对,其余角色相对 root;在 root 外面(家长把日记指到别处)就给绝对路径 */
export function vaultPack(paths: Workspace['paths']): NonNullable<ContextPack['vault']> {
  const root = paths.vault;
  const out: NonNullable<ContextPack['vault']> = { root };
  for (const r of VAULT_PACK_ROLES) {
    const p = paths[r];
    if (!p) continue;
    const rel = relative(root, p);
    out[r] = !rel || rel.startsWith('..') || isAbsolute(rel) ? p : rel;
  }
  return out;
}

export class Runner {
  private readonly active = new Map<string, Active>();
  /** 还在后台跑的资产生成(测试与关服前 flush) */
  private readonly background = new Set<Promise<void>>();
  private readonly getWs: () => Workspace;
  private readonly opts: { now?: () => Date; env?: NodeJS.ProcessEnv; warmIdleMs?: number };
  private readonly listeners = new Set<(e: RunEventEnvelope) => void>();
  /** 预热的老师进程(《工作流程.md》§四「预热」):一位老师最多一个 */
  readonly spares: WarmPool;
  /** 页面拉今天时的预热:每位老师(与带的话题)上次看的时刻 */
  private readonly prewarmedAt = new Map<string, number>();
  /** 起子进程用的环境(测试注入) */
  get env(): NodeJS.ProcessEnv | undefined {
    return this.opts.env;
  }
  /** 录音卡的评测队列(《口播老师设计.md》§4) */
  readonly koubo: KouboQueue;
  constructor(getWs: () => Workspace, opts: { now?: () => Date; env?: NodeJS.ProcessEnv; warmIdleMs?: number } = {}) {
    this.getWs = getWs;
    this.opts = opts;
    this.koubo = new KouboQueue(opts.env);
    this.spares = new WarmPool({ idleMs: opts.warmIdleMs });
  }

  /** 录音卡存了一条新录音:后台起评测(结果落录音旁边的 heard.json,交给老师时取) */
  assessRecording(audio: string, props: RecordProps): void {
    const ws = this.getWs();
    const p = this.koubo.start(ws.root, ws.config.koubo, join(ws.root, audio), props).then(() => {});
    this.background.add(p);
    void p.finally(() => this.background.delete(p));
  }

  running(tutor: string): { job: string; date: string } | null {
    const a = this.active.get(tutor);
    return a ? { job: a.job, date: a.date } : null;
  }

  /** 等所有后台资产生成完(测试用) */
  async flush(): Promise<void> {
    while (this.background.size) await Promise.all([...this.background]);
  }

  /** 订阅每一轮的事件(lib/events.ts;cotutor send 现场打印、serve --trace);返回退订函数。事件同时追加到 <日期>.<job>.events.jsonl */
  onEvent(fn: (e: RunEventEnvelope) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** 杀掉所有预热的进程(测试收尾;服务退出时它们的 stdin 断了会自己退) */
  close(): void {
    this.spares.dropAll();
  }

  /**
   * 预热(《工作流程.md》§四「预热」):给这位老师起好下一轮的进程,两个位置都补齐——
   * fresh:新开会话(新话题、接着上次都用它);
   * resume:接 thread(页面选着的话题;不给或今天没有 = 当天末条所在的话题,和 send 缺省一样)的会话,它没有会话就不留。
   * 只给有脸的、开着的、运行时 stdin: "stream-json"、这会儿没在跑的老师起;throttleMs 内同一话题看过就不再看(页面轮询今天)。
   * 起了返回 true;起不了不报错,下一轮冷起。
   */
  async prewarm(tutor: string, opts: { throttleMs?: number; thread?: string } = {}): Promise<boolean> {
    const t0 = Date.now();
    const seen = `${tutor}\n${opts.thread ?? ''}`;
    if (opts.throttleMs && t0 - (this.prewarmedAt.get(seen) ?? -Infinity) < opts.throttleMs) return false;
    this.prewarmedAt.set(seen, t0);
    const ws = this.getWs();
    const t = ws.config.tutors[tutor];
    if (!t?.enabled || !takesTutorRules(tutor) || this.active.has(tutor)) return false;
    const { runtime } = getRuntime(ws.config, t.runtime);
    if (!runtime.stdin) return false;
    const date = localDate((this.opts.now ?? (() => new Date()))());
    const index = await readIndex(ws, tutor, date);
    const known = threads(index.messages);
    const thread = opts.thread && known.includes(opts.thread) ? opts.thread : known.at(-1);
    const session = thread ? sessionFor(index, thread) : null;
    const policy = resolvePolicy(ws.config, tutor);
    const parts = await systemParts(ws, tutor, runtime, policy, { at: '', plan: [], recent: [] });
    const vars = { agent: tutor, prompt: '', ...parts, runtime: t.runtime, effort: policy.effort, tools: policy.tools === 'on' ? TUTOR_TOOLS : '' };
    // 预热的是孩子的下一句:工具照孩子那轮填(带照片的对不上,那轮冷起)
    const fresh = planRun(ws.config, { session: null }, vars);
    const resume = session ? planRun(ws.config, { session }, vars) : null;
    const cwd = join(ws.dirs.agents, tutor);
    await mkdir(cwd, { recursive: true });
    // 读索引这会儿孩子可能已经开口了:这轮在跑就不起(它收尾时会再起)
    if (this.active.has(tutor)) return false;
    const env = (p: RunPlan): NodeJS.ProcessEnv => withProxy(p.argv, { ...(this.opts.env ?? process.env), COTUTOR_WORKSPACE: ws.root }, ws.config.proxy);
    this.spares.warm(tutor, 'fresh', { argv: fresh.argv, cwd, date, lastJob: null }, env(fresh));
    if (resume?.resume && thread) this.spares.warm(tutor, 'resume', { argv: resume.argv, cwd, date, lastJob: lastJobOf(index, thread) }, env(resume));
    else this.spares.drop(tutor, 'resume');
    return true;
  }

  /** 正在回的那条已经出来的板书(流式);没在跑或还没出卡 → null */
  partial(tutor: string): BoardSection | null {
    return this.active.get(tutor)?.partial ?? null;
  }

  async send(tutor: string, input: SendInput): Promise<SendStarted> {
    const ws = this.getWs();
    const t = ws.config.tutors[tutor];
    if (!t) throw new UsageError(`没有叫 ${tutor} 的老师;cotutor.json 的 tutors 里有:${Object.keys(ws.config.tutors).join('、')}`);
    if (!t.enabled) throw new UsageError(`${t.display} 已关闭(cotutor.json tutors.${tutor}.enabled = false),打开再发`);
    const photos = input.photos?.filter(Boolean) ?? [];
    // 视频小课堂的圈带截图(《小课堂设计.md》拍板 4):和照片一样进上下文包 photos:(排在孩子拍的后面),这一轮带工具读图;消息的 photos 只记孩子拍的
    const shots = input.lecture?.marks?.flatMap((m) => (m.image ? [m.image] : [])) ?? [];
    const seen = [...photos, ...shots];
    const text = input.text.trim() || (input.action === 'continue' ? '继续' : input.action === 'submit' ? '(交了答案,没说话)' : photos.length ? (photos.length === 1 ? '(拍了一张)' : `(拍了 ${photos.length} 张)`) : '');
    if (!text) throw new UsageError('消息是空的');
    const busy = this.active.get(tutor);
    if (busy) throw new BusyError(tutor, busy.job);

    const now = (this.opts.now ?? (() => new Date()))();
    const date = input.date ?? localDate(now);
    const index = await readIndex(ws, tutor, date);
    const job = jobId(now, index.messages.length + 1);
    // 话题:新开(newThread / 没指定话题的系统消息 / 今天第一条)= 自己的 job;指定的要在这天的索引里;缺省接当前话题。会话按话题 resume
    const known = threads(index.messages);
    let thread: string;
    if (input.newThread || (input.from === 'system' && !input.thread) || !known.length) thread = job;
    else if (input.thread) {
      if (!known.includes(input.thread)) throw new UsageError(`${date} 没有话题 ${input.thread};有:${[...new Set(known)].join('、')}`);
      thread = input.thread;
    } else thread = known[known.length - 1];
    const fresh = thread === job;
    const session = fresh ? null : sessionFor(index, thread);
    const { runtime } = getRuntime(ws.config, input.runtime ?? t.runtime);
    const gathered = await gatherContext(ws, tutor, { from: input.from, at: now, focus: input.focus });
    const policy = resolvePolicy(ws.config, tutor);
    const { agentBody, systemBody, boardFile } = await systemParts(ws, tutor, runtime, policy, gathered);
    // 家长笔记原文:新会话整篇带;续会话时这个话题带过、没改的只写「未变」
    const notes = noteVersions(gathered);
    const pack = session ? dropSeenNotes(gathered, seenNotes(index.messages, thread)) : gathered;
    const noteWarnings = pack.entry?.startsWith('缺:') && !input.bookkeep ? [`入口文件${pack.entry}——在 vault 里给这位老师建一篇(cotutor doctor 有写法)`] : [];
    if (policy.board === 'off') pack.board = 'off';
    // 这轮带不带工具(policy.tools,2026-10-04):孩子说的话缺省不带,只凭上下文包答;带照片的(要 Read 看图)、系统任务照旧带。
    // 不带的那轮,只有工具才用得上的路径(refs / vault)不进包;模板里没有 {tools} 的运行时管不了它的工具,照旧
    const tools = policy.tools === 'on' || input.from !== 'kid' || seen.length > 0 ? TUTOR_TOOLS : '';
    const bare = !tools && runtimeUses(runtime, '{tools}');
    if (bare) { delete pack.refs; delete pack.vault; }
    // 这个话题里上一轮之后孩子在卡上做的事:逐张 describe 进上下文包,也记进这条消息(家长视图「孩子在板书上做的」);新话题不带
    // 录音卡:评测结果接在那一行后面(存录音时就起了,这里取;还在跑就等,最多等到存录音之后 timeoutMs;回放不起新的)
    const changed = fresh || input.bookkeep ? [] : changedCards(index, await readCardStates(ws, tutor, date), thread);
    const cards = await Promise.all(changed.map(async (c) => {
      const card = index.messages.find((m) => m.job === c.job)?.section?.cards[c.n];
      const id = cardId(c.job, c.n);
      const audio = (c.file.state as { audio?: unknown } | null)?.audio;
      const extra = card?.kind === 'record' && typeof audio === 'string' ? await this.koubo.take(ws.root, ws.config.koubo, join(ws.root, audio), card.props as RecordProps, { noStart: Boolean(input.replayOf) }) : undefined;
      return { card: id, text: card ? describeCard(card, c.file.state, extra) : JSON.stringify(c.file.state) };
    }));
    if (cards.length) pack.cards = cards.map((c) => `${c.card} ${c.text}`);
    if (seen.length) { pack.photos = seen; pack.photoFiles = seen.map((p) => join(ws.root, p)); }
    if (input.home) pack.home = input.home;
    // 小课堂:课包现读;读不出来(删了、坏了)就不带,这条照发,家长端提醒
    const lecture = input.lecture ? await readLecture(ws, input.lecture.bundle) : null;
    const marks = input.lecture?.marks?.length ? storedMarks(lecture, input.lecture.marks, photos.length) : [];
    if (input.lecture && lecture) pack.lecture = lecturePack(lecture, input.lecture, marks);
    const lectureWarn = input.lecture && !lecture ? [`小课堂:${input.lecture.bundle} 读不出来(bundles/ 与 lectures/ 下都没有能放的),老师没拿到课的内容`] : [];
    const continued = input.continues && fresh ? (input.continues.pack ?? (await continueContext(ws, tutor, input.continues.date, input.continues.thread))) : null;
    if (continued) pack.continue = continued;
    const prompt = buildContextPack(pack, text, policy.contextPack);
    const plan = planRun(ws.config, { session }, { agent: tutor, prompt, agentBody, systemBody, boardFile, runtime: input.runtime ?? t.runtime, effort: policy.effort, tools });

    // 原声:落在这轮旁边(删话题一起删);写不下就当没有,消息照发
    let voice: { audio: string; seconds: number } | undefined;
    if (input.voice) {
      const file = conversationFiles(ws.dirs.conversations, tutor, date).voice(job, input.voice.ext);
      if (await mkdir(join(ws.dirs.conversations, tutor), { recursive: true }).then(() => writeFile(file, input.voice!.data)).then(() => true, () => false)) voice = { audio: basename(file), seconds: Math.round(input.voice.seconds * 10) / 10 };
    }
    const started = addMessage(index, { job, thread, at: pack.at, from: input.from, text, focus: input.focus, ...(voice ? { voice } : {}), ...(input.action ? { action: input.action } : {}), ...(cards.length ? { cards } : {}), ...(photos.length ? { photos } : {}), ...(input.device ? { device: input.device } : {}), ...(input.bookkeep ? { bookkeep: input.bookkeep } : {}), ...(input.tidy ? { tidy: true as const } : {}), ...(input.replayOf ? { replayOf: input.replayOf } : {}), ...(input.via ? { via: input.via } : {}), ...(continued && input.continues ? { continues: { date: input.continues.date, thread: input.continues.thread } } : {}), ...(input.lecture ? { lecture: { bundle: input.lecture.bundle, title: lecture?.title ?? input.lecture.bundle, watchedMs: input.lecture.watchedMs, finished: input.lecture.finished, pauses: input.lecture.pauses, ...(input.lecture.again ? { again: true as const } : {}), ...(lecture?.video ? { video: true as const } : {}), ...(marks.length ? { marks } : {}), ...(input.lecture.log?.length ? { log: input.lecture.log } : {}) } } : {}), ...(Object.keys(notes).length ? { notes } : {}), ...(noteWarnings.length || lectureWarn.length ? { warnings: [...noteWarnings, ...lectureWarn] } : {}), result: 'running', artifacts: [], runtime: plan.runtime });
    await writeIndex(ws, started);
    await writeRunFile(ws, tutor, date, job, { at: pack.at, prompt, plan, agentBody: agentBody !== undefined, sources: await snapshotSources(ws, tutor) });

    // 预热的进程:resume 的接那个位置(对得上 = 这个话题从它起来之后没人写过),新开的接 fresh;对不上(或这轮不走 stdin)就杀掉
    const spare = this.spares.claim(tutor, plan.resume ? 'resume' : 'fresh', { argv: plan.argv, cwd: join(ws.dirs.agents, tutor), date, lastJob: plan.resume ? lastJobOf(index, thread) : null });
    const active: Active = { job, date, partial: null, done: Promise.resolve(started) };
    // 断流后接着跑:同一运行时 resume 这个会话,消息换成 stallPrompt
    const resumePlan = (id: string, open: string): RunPlan => planRun(ws.config, { session: { id, runtime: plan.runtime } }, { agent: tutor, prompt: stallPrompt(open), agentBody, systemBody, boardFile, runtime: plan.runtime, effort: policy.effort, tools });
    active.done = this.spawn(ws, tutor, date, job, plan, policy, active, resumePlan, spare).finally(() => {
      this.active.delete(tutor);
      // 孩子 / 家长这轮完了,马上起好下一轮的进程;系统轮(记账、整理记忆)之后孩子多半不在,不起
      if (input.from !== 'system' && !input.replayOf) void this.prewarm(tutor).catch(() => {});
    });
    this.active.set(tutor, active);
    return { tutor, date, job, thread, plan, done: active.done };
  }

  /**
   * 记账(《obsidian仓库设计.md》§4 / §6):家长晚上点一次。这天索引里每个还没记过、有孩子的话或打了分的话题,各起一轮记账任务
   * (from: system、resume 那个话题的会话,消息正文是 bookkeepingPrompt),顺着跑,老师回的「## 记账」段由 settleDiary 落进日记。
   * 立刻返回排了哪些、跳过哪些;链在后台跑(flush 会等)。老师正忙 → BusyError。
   */
  async bookkeep(tutor: string, date: string, only?: string[]): Promise<{ queued: string[]; skipped: { thread: string; why: string }[] }> {
    const ws = this.getWs();
    const t = ws.config.tutors[tutor];
    if (!t) throw new UsageError(`没有叫 ${tutor} 的老师;cotutor.json 的 tutors 里有:${Object.keys(ws.config.tutors).join('、')}`);
    const index = await readIndex(ws, tutor, date);
    // 整理记忆那轮自成一个话题,不是学的东西,不记账
    const all = [...new Set(threads(index.messages).filter((_, i) => !index.messages[i].tidy))];
    const queued: string[] = [];
    const skipped: { thread: string; why: string }[] = [];
    for (const th of only ?? all) {
      if (!all.includes(th)) skipped.push({ thread: th, why: `${date} 没有这个话题` });
      else if (index.booked[th]) skipped.push({ thread: th, why: `记过了(${index.booked[th]})` });
      else if (!only && !kidQuestions(index.messages, th).length && index.ratings[th] === undefined) skipped.push({ thread: th, why: '没有孩子的话也没打分' });
      else queued.push(th);
    }
    if (!queued.length) return { queued, skipped };
    const busy = this.active.get(tutor);
    if (busy) throw new BusyError(tutor, busy.job);
    const headings = textbookHeadings(await readTextbooks(ws));
    const chain = (async () => {
      for (const th of queued) {
        try {
          const idx = await readIndex(ws, tutor, date);
          // 话题里有照片:提示词多一句,让 summary 把册子 / 页 / 题号 / 题面写成文字(日记不存图,《obsidian仓库设计.md》§5)
          const ths = threads(idx.messages);
          const photos = idx.messages.reduce((n, m, i) => n + (ths[i] === th ? (m.photos?.length ?? 0) : 0), 0);
          const started = await this.send(tutor, { from: 'system', text: bookkeepingPrompt({ thread: th, rating: idx.ratings[th], keepScore: ws.config.vault.keepScore, headings, photos }), thread: th, date, bookkeep: { thread: th } });
          await started.done;
        } catch {
          /* 这条记不了(老师忙 / 起不来),下一条照记;索引里没记 booked,再点一次记账会重试 */
        }
      }
      // 账记完,这位老师整理一遍自己的记忆(新会话,结果直接落盘;《obsidian仓库设计.md》§8 2026-09-18)
      try {
        const tidy = await this.tidyMemory(tutor, date);
        if (tidy) await tidy.done;
      } catch {
        /* 整理不了(老师忙 / 起不来)不影响记账;下次记账再整理 */
      }
    })();
    this.background.add(chain);
    void chain.finally(() => this.background.delete(chain));
    return { queued, skipped };
  }

  /**
   * 记账后整理记忆:这位老师有记忆文件、里面有条目才起一轮(新会话、from: system、tidy);没有就返回 null。
   * 老师回的「## 记忆」段照单落盘(settleMemory 不限条数)。
   */
  async tidyMemory(tutor: string, date: string): Promise<SendStarted | null> {
    const ws = this.getWs();
    const memory = (await scanVault(ws)).notes.find((n) => n.props.cotutor === 'memory' && n.props.agent?.trim() === tutor);
    const count = memory ? memoryCount(memory.text) : 0;
    if (!count) return null;
    return this.send(tutor, { from: 'system', text: tidyMemoryPrompt({ date, count, cap: MEMORY_TIDY_CAP, diaryFile: join(ws.paths.diary, `${date}.md`) }), date, tidy: true });
  }

  /** 记忆段收尾:讲课的轮每轮最多 MEMORY_MAX_PER_TURN 条,多的丢(整理轮 max = null 不限);写不进(vault 不在、同名文件没属性)进提醒,不影响这轮 */
  private async settleMemory(ws: Workspace, tutor: string, date: string, items: string[], max: number | null): Promise<{ changes: string[]; lines: MemoryLine[]; warnings: string[] }> {
    const warnings: string[] = [];
    if (max !== null && items.length > max) warnings.push(`记忆:一轮最多记 ${max} 条,丢了 ${items.length - max} 条:${items.slice(max).join(';')}`);
    try {
      const r = await updateVaultMemory(ws, tutor, ws.config.tutors[tutor]?.display ?? tutor, max === null ? items : items.slice(0, max), date);
      return { changes: r.changes, lines: r.lines, warnings: [...warnings, ...r.warnings] };
    } catch (err) {
      return { changes: [], lines: [], warnings: [...warnings, `记忆没写进去:${err instanceof Error ? err.message : String(err)}`] };
    }
  }

  /** 记账那轮收尾:「## 记账」段 → 这个话题在日记里的一段(打分不够只留孩子问与观察)→ 追加到 vault 的日记,索引记 booked */
  private async settleDiary(ws: Workspace, tutor: string, date: string, job: string, index: ConversationIndex, thread: string, b: Bookkeeping | null): Promise<{ index: ConversationIndex; file: string | null; warnings: string[] }> {
    if (!b) return { index, file: null, warnings: ['记账:老师没回「## 记账」段,日记没写;再点一次记账'] };
    const entry = entryFor(b, thread);
    if (!entry) return { index, file: null, warnings: [`记账:「## 记账」段里没有话题 ${thread} 的那条,日记没写`] };
    const t = ws.config.tutors[tutor];
    const topic = diaryTopic(index, entry, { subject: t?.subject ?? t?.display ?? tutor, keepScore: ws.config.vault.keepScore });
    const block = renderDiaryBlock(topic);
    if (!block) return { index, file: null, warnings: ['记账:这个话题没有孩子的话、摘要、观察,日记没写'] };
    const file = await writeDiary(ws, date, (existing) => appendDiary(existing, block));
    // 写进去的那段原文记在这轮上:删这个话题时从日记里摘掉(store.deleteThread)
    const messages = index.messages.map((m) => (m.job === job ? { ...m, diaryBlock: block } : m));
    return { index: { ...index, messages, booked: { ...index.booked, [thread]: job } }, file, warnings: [] };
  }

  private async spawn(ws: Workspace, tutor: string, date: string, job: string, plan: RunPlan, policy: Policy, active: Active, resumePlan: (session: string, open: string) => RunPlan, spare: Spare | null = null): Promise<ConversationIndex> {
    const replyMaxChars = policy.replyMaxChars;
    const files = conversationFiles(ws.dirs.conversations, tutor, date);
    const cwd = join(ws.dirs.agents, tutor);
    await mkdir(cwd, { recursive: true });
    const out = createWriteStream(files.log(job));
    const err = openSync(files.err(job), 'w');
    // 埋点:从进程起来那一刻算,首卡 = partial 板书第一次有卡(孩子端第一次看到东西),done = 进程退出,dubbed = 配音收尾
    const t0 = Date.now();
    const timing: Timing = { startedAt: new Date(t0).toISOString(), ...(spare ? { warm: true as const } : {}) };
    const since = (): number => Date.now() - t0;
    // 事件:每道工序的关键点发一条,追加到 events.jsonl(按序),同时给内存里的订阅者;写盘失败不影响这一轮
    let eventsChain: Promise<void> = Promise.resolve();
    const events: RunEvent[] = [];
    const emit = (e: RunEventInput): void => {
      const event = { t: since(), ...e } as RunEvent;
      events.push(event);
      eventsChain = eventsChain.then(() => appendFile(files.events(job), `${JSON.stringify(event)}\n`)).catch(() => {});
      for (const fn of this.listeners) {
        try {
          fn({ tutor, date, job, event });
        } catch {
          /* 订阅者的错不影响这一轮 */
        }
      }
    };
    emit({ lane: 'main', kind: 'start', cli: plan.argv[0].slice(plan.argv[0].lastIndexOf('/') + 1), runtime: plan.runtime, resume: plan.resume, ...(spare ? { warmMs: t0 - spare.bornAt } : {}) });
    const voice = ws.config.tutors[tutor]?.voice;
    const queue = voice ? new DubQueue(ws.config.tts, voice, files.err(job), this.opts.env) : null;
    if (queue) queue.report = (e) => emit(e.kind === 'queued' ? { lane: 'tts', kind: 'queued', label: e.label } : e.kind === 'done' ? { lane: 'tts', kind: 'done', label: e.label, ms: e.ms, file: e.file ?? '' } : { lane: 'tts', kind: 'failed', label: e.label, ms: e.ms, error: e.error ?? '?' });
    const dubber = queue ? new LineDubber(queue, (n) => files.lineAudio(job, n)) : null;
    // 工具调用:stdout 的 assistant 事件里有 tool_use 就发一条(子代理的标 sub);只对含 tool_use / tool_result 的行 JSON.parse。
    // 顺手记哪些顶层工具还没回 tool_result:工具在跑时进程不吐字是正常的,断流看门狗不算这段
    let toolBuf = '';
    const toolsRunning = new Set<string>();
    // 消息走 stdin 的运行时:看到 result 就关 stdin,进程自己退(每次 runOnce 换一个)
    let onResult: (() => void) | null = null;
    const scanTools = (chunk: string): void => {
      toolBuf += chunk;
      const parts = toolBuf.split('\n');
      toolBuf = parts.pop() ?? '';
      for (const line of parts) {
        if (onResult && line.includes('"type":"result"')) onResult();
        if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue;
        try {
          const e = JSON.parse(line) as { type?: string; parent_tool_use_id?: string | null; message?: { content?: { type?: string; id?: string; tool_use_id?: string; name?: string; input?: Record<string, unknown> }[] } };
          if (!Array.isArray(e.message?.content)) continue;
          const top = !e.parent_tool_use_id;
          if (e.type === 'user') { if (top) for (const b of e.message.content) if (b.type === 'tool_result' && b.tool_use_id) toolsRunning.delete(b.tool_use_id); continue; }
          if (e.type !== 'assistant') continue;
          for (const b of e.message.content) {
            if (b.type !== 'tool_use' || !b.name) continue;
            if (top && b.id) toolsRunning.add(b.id);
            emit({ lane: 'main', kind: 'tool', name: toolSummary(b.name, b.input), sub: !top });
          }
        } catch {
          /* 不是一行完整 JSON:跳过 */
        }
      }
    };
    let cardsSeen = 0;
    let linesSeen = 0;
    // 拍的就绪(流式):每句配音落盘就填进 partial 的 audio,重算前几拍就绪;涨了发 ready:beat,第一拍记 firstReadyMs
    const lineAudio = new Map<number, string>();
    let readySeen = 0;
    const settleReady = (): void => {
      if (!active.partial) return;
      const n = readyBeats(active.partial, { voiced: Boolean(voice), done: false });
      if (n <= readySeen) return;
      const beats = beatsOf(active.partial);
      for (; readySeen < n; readySeen++) {
        if (timing.firstReadyMs === undefined) timing.firstReadyMs = since();
        emit({ lane: 'ready', kind: 'beat', beat: readySeen, card: beats[readySeen]?.card ?? null, first: readySeen === 0 });
      }
      active.partial = { ...active.partial, ready: n };
    };
    // 流式:stdout 的每一块先落盘再喂读取器;正文变了就(节流 150ms)重解析成 partial 板书,定稿的句子交去配音
    let reader = createPartialReader();
    // 断流接着跑(policy.stall):carried = 被杀那次已经拼出的正文(接着跑的那次换新读取器,正文 = carried + 新的);
    // open = 断在半截、没进会话的那段(递回给老师,收尾时拼在最后一段前面)
    let carried = '';
    let open = '';
    const liveText = (): string => { const t = reader.text(); return !carried ? t : !t ? carried : open ? carried + t : `${carried}\n\n${t}`; };
    let dirty = false;
    let timer: NodeJS.Timeout | null = null;
    const reparse = (): void => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      // 先剥「## 记账」再解析,和定稿的 deriveKidView 同一条路;不剥的话固定段写在前面的那轮流式时一张卡都出不来(2026-09-13 控制台里看见的)
      const { section } = parseBoard(parseSections(liveText()).body, { partial: true });
      const lines = section.lines.map((l, i) => ({ ...l, text: truncateReply(l.text, replyMaxChars).text, audio: lineAudio.get(i) ?? null }));
      active.partial = section.cards.length || lines.length ? { cards: section.cards, lines, partial: true, ready: readySeen } : null;
      if (section.cards.length && timing.firstCardMs === undefined) timing.firstCardMs = since();
      for (; cardsSeen < section.cards.length; cardsSeen++) emit({ lane: 'main', kind: 'card', card: cardsSeen, label: `${section.cards[cardsSeen].kind} ${cardLabel(section.cards[cardsSeen])}`.trim() });
      for (; linesSeen < lines.length; linesSeen++) emit({ lane: 'main', kind: 'line', line: linesSeen, text: lines[linesSeen].text });
      if (dubber) lines.forEach((l, i) => { const p = dubber.add(i, l.text); if (p) void p.then((name) => { if (name && active.partial && active.partial.lines[i]) { lineAudio.set(i, name); active.partial.lines[i].audio = name; settleReady(); } }, () => {}); });
      settleReady();
    };
    // 断流看门狗:进程 stall.ms 没吐一个字节、也没有工具在跑 → 杀掉,resume 同一个会话接着写(最多 stall.retries 次)。
    // claude CLI 自己要等约 180 秒才认断流(2026-09-21 真跑一轮连断两次,等了 6 分钟)
    let session = plan.session;
    // 新会话要等模型开始回了(第一条 stream_event / assistant)才在盘上、才 resume 得了
    // (2026-09-22 真跑:init 吐了会话 id 就被杀,resume 报 No conversation found;吐过三个字再杀,盘上有这条用户消息)
    let persisted = plan.resume;
    let stalls = 0;
    // warm:预热好的进程(只给第一次;断流接着跑的那次照旧冷起)
    const runOnce = (p: RunPlan, warm: Spare | null = null): Promise<{ code: number | null; spawnError?: Error; stalled?: boolean }> => new Promise((resolveExit) => {
      const child = warm?.child ?? spawn(p.argv[0], p.argv.slice(1), {
        cwd,
        env: withProxy(p.argv, { ...(this.opts.env ?? process.env), COTUTOR_WORKSPACE: ws.root }, ws.config.proxy),
        stdio: [p.stdin ? 'pipe' : 'ignore', 'pipe', err],
      });
      if (warm) {
        // 预热的进程 stderr 是管道(起它时还没有这轮的 err.log):攒下的和之后的都写进来(池子交出来时暂停着,这里 resume)
        const toErr = (c: Buffer): void => { try { writeSync(err, c); } catch { /* err.log 已关 */ } };
        warm.stderr.forEach(toErr);
        child.stderr?.on('data', toErr);
        child.stderr?.resume();
      }
      if (p.stdin) {
        child.stdin?.on('error', () => {});
        child.stdin?.write(p.stdin);
        onResult = () => { onResult = null; child.stdin?.end(); };
      } else onResult = null;
      let stalled = false;
      let idle: NodeJS.Timeout | null = null;
      let lastByte = Date.now();
      const arm = (): void => {
        if (idle) clearTimeout(idle);
        if (!policy.stall.ms) return;
        idle = setTimeout(() => {
          idle = null;
          if (toolsRunning.size) return arm();
          stalled = true;
          child.kill('SIGTERM');
          setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000).unref();
        }, policy.stall.ms);
      };
      arm();
      child.stdout?.on('data', (chunk: Buffer) => {
        lastByte = Date.now();
        arm();
        out.write(chunk);
        const s = chunk.toString('utf8');
        if (!session) session = /"session_id":"([^"]+)"/.exec(s)?.[1] ?? null;
        if (!persisted && (s.includes('"type":"stream_event"') || s.includes('"type":"assistant"'))) persisted = true;
        scanTools(s);
        if (reader.feed(s)) {
          dirty = true;
          if (!timer) timer = setTimeout(reparse, 150);
        }
      });
      const done = (r: { code: number | null; spawnError?: Error }): void => {
        if (idle) clearTimeout(idle);
        resolveExit({ ...r, ...(stalled ? { stalled: true } : {}) });
      };
      child.once('error', (e) => done({ code: null, spawnError: e }));
      child.once('close', (code) => { if (stalled) void appendFile(files.err(job), `cotutor: ${Date.now() - lastByte}ms 没有输出,当断流杀掉\n`).catch(() => {}); done({ code }); });
      if (warm) {
        // 开口前吐的(claude 实测一个字节都没有)按顺序补喂,再放开暂停;接手之前就退了的,close 已经错过,直接收尾
        for (const c of warm.stdout) child.stdout?.emit('data', c);
        child.stdout?.resume();
        if (warm.closed()) done({ code: child.exitCode });
      }
    });
    let exit = await runOnce(plan, spare);
    while (exit.stalled) {
      stalls++;
      if (persisted) open += reader.current();
      else { session = plan.session; open = ''; }
      const retry = stalls <= policy.stall.retries ? stalls : 0;
      emit({ lane: 'main', kind: 'stall', idleMs: policy.stall.ms, retry, kept: Array.from(open).length });
      if (!retry) break;
      carried = persisted ? liveText() : '';
      reader = createPartialReader();
      toolsRunning.clear();
      // 会话还没落盘(进程起来就卡住、一条整的回复都没有):原样从头再起一次;落了盘就 resume 接着写
      const next = persisted && session ? resumePlan(session, open) : plan;
      emit({ lane: 'main', kind: 'start', cli: next.argv[0].slice(next.argv[0].lastIndexOf('/') + 1), runtime: next.runtime, resume: next.resume });
      exit = await runOnce(next);
    }
    timing.doneMs = since();
    if (timer) clearTimeout(timer);
    await new Promise<void>((r) => out.end(r));
    closeSync(err);
    if (exit.spawnError) await appendFile(files.err(job), `cotutor: 起不来 ${plan.argv[0]}:${exit.spawnError.message}\n`);
    const logText = await readFile(files.log(job), 'utf8').catch(() => '');
    const transcript = parseTranscript(logText);
    // 断流接着跑的:断在半截的那段没进会话、也不在最后的 result 里,拼回最后一段前面(老师是从断处接着写的)
    // (result 的正文被 trim 过,断在句末 / 围栏上的补回换行,免得两句粘成一行)
    if (open && transcript.final?.text) transcript.final.text = open + (/[。!!??;;`\n]\s*$/.test(open) ? '\n' : '') + transcript.final.text;
    if (exit.stalled && !transcript.final) transcript.final = { text: null, ok: false, reason: `stalled:${stalls} 次断流(每次 ${policy.stall.ms}ms 没输出),接着跑的次数用完了` };
    // 这轮用了哪些工具、读了什么:从 .log 抽出来物化(家长端「看原文」一站、cotutor show)
    const tools = toolCalls(logText).slice(0, 200);
    if (!transcript.final) {
      // 进程退了但没有 result 事件:起不来、被杀、或 CLI 崩了;标 error,原因指向 err.log
      transcript.final = { text: null, ok: false, reason: exit.spawnError ? `spawn:${exit.spawnError.message}` : `exit:${exit.code ?? 'signal'}` };
      transcript.items.push({ kind: 'done', text: `本轮没有收尾(${transcript.final.reason}),看 ${date}.${job}.err.log` });
    }
    emit({ lane: 'main', kind: 'exit', ok: transcript.final.ok, ...(transcript.final.reason ? { reason: transcript.final.reason } : {}), ...(transcript.final.costUsd !== undefined ? { costUsd: transcript.final.costUsd } : {}), ...(transcript.final.numTurns !== undefined ? { turns: transcript.final.numTurns } : {}) });
    const kidView = deriveKidView(transcript, { replyMaxChars });
    if (stalls) kidView.warnings.push(`API 流断了 ${stalls} 次(每次 ${policy.stall.ms / 1000} 秒没动静),应用杀掉进程、resume 会话接着写的${exit.stalled ? ';次数用完还断,这轮没收尾' : ''}`);
    // 整块出的(没走流式):卡与句这时才第一次见到,也发一遍
    if (kidView.section) {
      for (; cardsSeen < kidView.section.cards.length; cardsSeen++) emit({ lane: 'main', kind: 'card', card: cardsSeen, label: `${kidView.section.cards[cardsSeen].kind} ${cardLabel(kidView.section.cards[cardsSeen])}`.trim() });
      for (; linesSeen < kidView.section.lines.length; linesSeen++) emit({ lane: 'main', kind: 'line', line: linesSeen, text: kidView.section.lines[linesSeen].text });
    }
    // 配音:老师配了音色才合成;失败不响,孩子端用浏览器的声。
    // 逐句配(流式时大多已在路上,这里只等没配完的)。
    if (dubber && voice && kidView.section?.lines.length) {
      const names = await dubber.finish(kidView.section.lines);
      kidView.section.lines.forEach((l, i) => { l.audio = names[i]; });
      timing.dubbedMs = since();
      if (timing.firstReadyMs === undefined) timing.firstReadyMs = since();
    }
    if (timing.firstReadyMs === undefined && (kidView.section?.lines.length || kidView.kidText)) timing.firstReadyMs = since();
    if (kidView.section) emit({ lane: 'ready', kind: 'all', cards: kidView.section.cards.length, lines: kidView.section.lines.length });
    if (kidView.section) timing.beats = beatTimings(events, beatsOf(kidView.section));
    // 重新读索引再并入:跑的这段时间里别的字段(比如家长改了别的)不被旧对象盖掉
    const latest = await readIndex(ws, tutor, date);
    // 板书写法已经递到手里(系统提示或话题第一条),老师还用工具去读它 → 预载没起作用,家长端这轮上点名(换模型 / CLI / 版本后最先坏的地方)
    const reread = takesTutorRules(tutor) && policy.board !== 'off' ? boardGuideReads(tools) : [];
    if (reread.length) kidView.warnings.push(`板书写法已经递给老师了,这轮它还是用工具去读了一遍(${reread.join(';')}):多一次模型来回。cotutor doctor 的 runtime.*.board 看这个运行时走的哪条递法`);
    // 清单外的卡(《卡片协议.md》「谁拿到哪些卡」):照常解析、照常显示,只在这轮记一条,家长据此调清单
    const kinds = tutorCardKinds(ws.config.tutors[tutor]?.cards);
    const outside = kinds && kidView.section ? [...new Set(kidView.section.cards.map((c) => c.kind).filter((k) => !kinds.includes(k)))] : [];
    if (outside.length) kidView.warnings.push(`板书里有清单外的卡:${outside.join('、')}(照常显示;要它就加进 cotutor.json tutors.${tutor}.cards)`);
    let next = applyRun(latest, job, { transcript, kidView, runtime: plan.runtime, timing, tools });
    // 「## 记忆」段:增 / 改 / 删落进 vault 里这位 agent 的记忆文件(回放不写;整理轮不限条数;家长视图看 remembered 与提醒;memoryLines 留给删话题时撤)
    if (kidView.memory.length) {
      const asked = latest.messages.find((m) => m.job === job);
      const r = asked?.replayOf ? { changes: [] as string[], lines: [] as MemoryLine[], warnings: ['回放不写记忆'] } : await this.settleMemory(ws, tutor, date, kidView.memory, asked?.tidy ? null : MEMORY_MAX_PER_TURN);
      if (r.changes.length || r.warnings.length) next = { ...next, messages: next.messages.map((m) => (m.job === job ? { ...m, ...(r.changes.length ? { remembered: r.changes } : {}), ...(r.lines.length ? { memoryLines: r.lines } : {}), ...(r.warnings.length ? { warnings: [...(m.warnings ?? []), ...r.warnings] } : {}) } : m)) };
    }
    // 记账那轮:「## 记账」段落进日记(老师不直接写 vault;写了什么、没写成为什么都在这条的 warnings 里)
    const mine = latest.messages.find((m) => m.job === job);
    if (mine?.bookkeep) {
      const r = await this.settleDiary(ws, tutor, date, job, next, mine.bookkeep.thread, kidView.bookkeeping);
      next = r.warnings.length ? { ...r.index, messages: r.index.messages.map((m) => (m.job === job ? { ...m, warnings: [...(m.warnings ?? []), ...r.warnings] } : m)) } : r.index;
      if (r.file) emit({ lane: 'ledger', kind: 'diary', thread: mine.bookkeep.thread, file: r.file });
    }
    await writeIndex(ws, next);
    emit({ lane: 'index', kind: 'written', warnings: next.messages.find((m) => m.job === job)?.warnings?.length ?? 0 });
    await eventsChain;
    // 资产:点读段逐段配音到 .cards/<n>/<k>.mp3,后台跑,不拦着这一轮收尾;孩子端每次拉 today 都会看到新生成好的
    if (queue && kidView.section) {
      const jobs: Promise<unknown>[] = [];
      kidView.section.cards.forEach((card, n) => {
        const list = cardAssets(card);
        if (!list.length) return;
        jobs.push(mkdir(files.cardAssetsDir(job, n), { recursive: true }).then(() => Promise.all(list.map((a) => queue.add(files.cardAsset(job, n, a.file), a.text, `第 ${n + 1} 张卡的 ${a.file} `)))));
      });
      if (jobs.length) {
        const bg = Promise.all(jobs).then(() => undefined, () => undefined);
        this.background.add(bg);
        void bg.finally(() => this.background.delete(bg));
      }
    }
    return next;
  }
}

/**
 * 发消息 = 拼上下文包 → 请脑(src/brain/,应用直连百炼;同一话题接着它的会话)→ 统一事件落 conversations/<老师>/<日期>.<job>.log → 索引更新
 * (最终文本 → 讲稿的一节 section + 家长尾巴 parentText + 解析提醒 warnings)。
 * 流式:脑的正文随流回报,这里拼当前回复正文 → parseBoard(partial) → 内存里的 partial section(孩子端 pending 条目带着它);讲稿不配音,交给实时的嘴照念。
 * 一老师同时只跑一条(老师还在回上一条就 409),跨天自动新开(索引按本地日期分文件,新文件没有会话就新开)。
 * 话题:一天可多个,每个话题自己的会话(index.sessions[thread]);newThread / 系统消息 / 今天第一条开新话题(不接会话),
 * 指定 thread 接着今天的旧话题(接它的会话),缺省接当前话题。孩子先说的 activity 点进来先「进门」(enter):话题有了、页铺好了、不请脑,
 * 孩子开口那条才是第一轮;没开口就走了的话题不存(leave 删、下次进门扫掉)。
 * 埋点:每轮记 timing(这一轮起的时刻、第一句出来、脑回完,毫秒),家长视图每轮一行。
 * 代码里还叫「进程」的地方指的就是脑这一轮。
 */
import { imageSize, jpegFromDataUrl } from '../shared/jpeg.ts';
import { lectureDid, lecturePage, readLecture, storedMarks, type IncomingMark, type Lecture } from './lecture.ts';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { buildContextPack } from './context/context-pack.ts';
import { addMessage, applyRun, jobId, sameRuntime, sessionFor } from './journal/conversation.ts';
import { localDate, localMinute } from '../shared/time.ts';
import { conversationFiles, pickBookZones, spokeIn, threads } from '../schema/index.ts';
import { bookkeepingPrompt, kidQuestions, textbookHeadings } from '../memory/diary.ts';
import { actsGuide } from '../board/cards/docs.ts';
import { activityBase, parseActivity, renderTutorSection } from './activity.ts';
import { findActivityFile } from './activities.ts';
import { readActivity, threadActivity } from './activity-state.ts';
import { createBrain, getRuntime, type BrainExecutor, type BrainRequest, type RunPlan, type ToolSet } from '../brain/index.ts';
import { lineFlags, parseBoard } from '../board/parse.ts';
import { clockLabel, lectureLines } from '../board/lecture.ts';
import type { BoardSection, Device } from '../board/presentation.ts';
import { deriveKidView, truncateReply } from './kid-view.ts';
import { parseSections } from '../board/sections.ts';
import { threadDigest } from './context/thread-digest.ts';
import { type RunEvent, type RunEventEnvelope, type RunEventInput } from '../schema/index.ts';
import { CELL_UNIT, LESSON_CELL_STROKES, LESSON_INK_POINTS, PEN_ASKS, PHOTO_PAGE, type ActivityBase, type Box, type Lesson, type LessonAct, type LessonEvent, type PagePhoto, canonicalSubject, subjectLang, MEMORY_MAX_PER_TURN, MEMORY_TIDY_CAP, VAULT_PACK_ROLES, isApiRuntime, resolvePolicy, type ContextPack, type ConversationIndex, type MemoryProposal, type PendingMemory, type ActivityRun, type ConversationMessage, type MessageFrom, type MessageVia, type Policy, type Timing, type Workbook } from '../schema/index.ts';
import { UsageError } from '../shared/errors.ts';
import type { Workspace } from '../schema/index.ts';
import { deleteThread, readIndex, snapshotSources, writeIndex, writeRunFile } from './journal/store.ts';
import { readTextbooks, scanVault, writeVaultMemory, type MemoryPlan } from '../memory/vault.ts';
import { learningContext, type PackReport } from '../memory/context.ts';
import { childChanges, planDiary, planMemory, recoverPending, writeDiaryBlock } from '../memory/commit.ts';
import { kidSaid } from '../memory/proposals.ts';
import type { Retrieved } from '../memory/retrieval.ts';
import { memoryCount, textHash, tidyMemoryPrompt } from '../memory/vault-notes.ts';
import { TUTOR_RULES_PATH, tutorRulesBody } from './context/tutor-rules.ts';
import { kidInput, type KidAccept } from './kid-input.ts';
import { compatibleLine } from '../shared/qianwen.ts';
import { lookAt } from '../media/vision.ts';
import type { Look } from '../scenes/look.ts';
import { photoPromptFrom, recognizeWith } from '../scenes/photo-words/recognize.ts';
import { readWords, startWords } from '../scenes/photo-words/store.ts';
import { appendBoard, readBoard } from './journal/board-log.ts';
import { bookSlateParts, clipNote, lessonSlateBits, slateOf, type PageNote } from './context/board-pack.ts';
import { bookLesson, bookPageOf, fitSection, homeworkLabels, lessonOpen, pageText, photoView, sectionActs, tocEntries, whitePage, type LessonBook, type LessonSource } from '../board/lesson-fit.ts';
import { readWorkbook } from '../memory/workbook.ts';
import { bookLast, lastSpot, rememberBook } from './journal/book-last.ts';
import { homeworkBookPage, keepPhotos } from './homework.ts';
import { dayTitle, lessonDone, lessonPage, lessonSection, lessonStep, photoDay, photoSheetBox } from '../board/lesson.ts';
import { readLesson, updateLesson } from './journal/lesson-store.ts';
import { BOOK_TOC, bookRegions, bookTeacherLines, bookView, bookZoneInk, photoBookPage, photoText, pickable, workbookInk, workbookPage, workbookPageId, workbookText, type PhotoText } from '../chalk/index.ts';
import { bookIndex, listBooks, pickBook } from '../memory/textbook-pdf.ts';
import { bookZones } from '../memory/textbook-zones.ts';

/** 课本做底的 activity:家长在按钮上填的这个参数说的是哪一课,进门直接铺它(出厂的课本叫「范围」) */
const ENTER_RANGE = '范围';
/** 给老师的底里列作业本最近这么多天(再早的也在本子里,老师写那天的日子就翻得到) */
const HOMEWORK_TURN_DAYS = 14;

/** 今天只进了门、没开口的话题(不存:进门时、点回首页时删) */
const quietThreads = (index: { messages: readonly ConversationMessage[] }): string[] => [...new Set(threads(index.messages))].filter((th) => !spokeIn(index.messages, th));

export class BusyError extends Error {
  constructor(tutor: string, job: string) {
    super(`${tutor} 还在回上一条(${job}),等它说完再发`);
  }
}

export interface SendInput {
  from: MessageFrom;
  /** 从首页的 activity 按钮起的新话题(或 cotutor send --activity):哪个 activity、点的那一刻的参数;记在这条消息上,话题后面每条照它带 */
  activity?: ActivityRun;
  /** 带 action 时可以是空的:给老师看(窗里的图)→ 「(给老师看,没说话)」 */
  text: string;
  /** 孩子端的动作:「给老师看」(窗里的图已经交了) */
  action?: 'submit';
  /** 运行时名,缺省 cotutor.json 的 runtimes.default */
  runtime?: string;
  /** 开新话题:不 resume、不带旧话题卡上的状态;话题 id = 这条的 job */
  newThread?: boolean;
  /** 接着今天的某个话题聊(话题 id);缺省 = 当前(末条所在的)话题。from: system 的永远开新话题 */
  thread?: string;
  /** 孩子端是什么端(记进消息);缺省当平板横屏 */
  device?: Device;
  /** 哪一台设备(服务端从 cookie 取) */
  deviceId?: string;
  /** 记到哪一天的索引(缺省今天);记账给昨天的话题用 */
  date?: string;
  /** 这轮是记账任务(《obsidian仓库设计.md》§6):resume 那个话题的会话,老师回「## 记账」段,应用写日记 */
  bookkeep?: { thread: string };
  /** 这轮是记账后整理记忆:新会话,「## 记忆」段不受每轮条数上限,孩子端看不到 */
  tidy?: boolean;
  /** 这条带的作业照片(相对 workspace 根,已由路由验过在 captures/ 里;R5):进上下文包 photos: 段,老师自己 Read 看图;文字可以空 */
  photos?: string[];
  /** 这条是回放(app/replay.ts):原轮的 job,记进消息;调用方已经把 Runner 指到 evals/ */
  replayOf?: string;
  /** cotutor activity eval 跑的一轮:不写记忆 */
  eval?: true;
  /** 孩子看完小课堂后的第一条:上下文包带 lecture:(课的每句、看的情况、画过的几处),消息记 lecture;again = 问过以后再看一遍又画了 */
  lecture?: { bundle: string; watchedMs: number; finished: boolean; pauses: number; again?: boolean; marks?: IncomingMark[]; log?: { t: number; pos: number; play: boolean }[] };
  /** 孩子从首页哪个按钮进来的,记进消息 */
  via?: MessageVia;
  /** 按钮的字与家长备好的讲法(服务端从发布件查的),进上下文包 home: 段 */
  home?: { button: string; brief?: string };
  /** 这一轮走实时:讲稿不配音(拍关就就绪)、交给嘴照念;消息记 live,上下文包带 live:(嘴接住时说的、上一轮念到第几句被打断;请他说的那几拍、应用起的这一轮) */
  live?: NonNullable<ContextPack['live']>;
}

/** 页上一件事记下以后回通话的:say = 嘴照念的(点字的念法);still: false = 不替他叫老师;shot = 窗图;asked = 老师请着用笔时落的(收笔替他交) */
export type BoardDone = { thread: string; say: string | null; still?: false; shot?: true; asked?: true };

export interface SendStarted {
  tutor: string;
  date: string;
  job: string;
  /** 这条消息所在的话题 */
  thread: string;
  /** 这节课的 activity 头上写了 reply: mouth:孩子作答以后嘴先答(实时那条线照它走,src/runtime/live/call.ts) */
  reply?: 'mouth';
  plan: RunPlan;
  /** 老师说完(进程退出、索引写好)后 resolve */
  done: Promise<ConversationIndex>;
}

interface Active {
  job: string;
  date: string;
  done: Promise<ConversationIndex>;
  /** 还在说的时候已经解析出来的讲稿(句已按 replyMaxChars 截) */
  partial: BoardSection | null;
  /** 这一轮走实时:讲稿不配音 */
  live?: boolean;
  /** 一节课(activity 头上写了 base:):页的文字层从哪来,和这一轮开始时这节课的样子(讲稿里的动作照它落到页上,src/board/lesson-fit.ts) */
  lesson?: { base: ActivityBase; src: LessonSource; at: Lesson };
}

export type { PackReport } from '../memory/context.ts';

/** 课本索引的缓存(相对 workspace 根;能重新生成,不进备份) */
const BOOK_CACHE = '.cotutor/textbooks';
/** 课本格子的 id:<PDF 页>.<作答区 id>(规则出的是第几格;编程助手量的起了名字,字母、数字、汉字、连字符,同分块) */
const CELL_ID = /^\d{1,4}\.[\p{L}\p{N}][\p{L}\p{N}-]{0,40}$/u;
/** 课本上揭开的(盖住的算式)最多几个字:同 [[盖 …]] 一处的上限 */
const BOOK_MARK_CHARS = 12;
/** 窗里的图(舞台导的 jpeg,长边 1024)base64 最多多长:够一张清楚的图,挡住塞进来的大文件 */
export const BOOK_SHOT_B64_MAX = 700_000;
/** 舞台交来的图(data:image/jpeg;base64,…)→ 字节;不是 jpeg、太大回 null */
const jpegBytes = (v: unknown): Buffer | null => jpegFromDataUrl(v, BOOK_SHOT_B64_MAX);

/** API 运行时的长话题:上一轮结束时上下文(tokens.context)过了这么多,这一轮整段压缩(2026-10-29 定 32k) */
export const COMPACT_TOKENS = 32_000;

/**
 * 这一轮该不该整段压缩:这个话题最近一轮报的上下文(只有 API 运行时报)过了 COMPACT_TOKENS,而且上一轮不是刚压缩过的
 * (压缩完还过线,说明系统提示与笔记本身就大,再压也小不下去,隔一轮再看)
 */
function dueCompact(messages: readonly ConversationMessage[], ths: readonly string[], thread: string): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (ths[i] !== thread) continue;
    if (messages[i].compacted) return false;
    if (messages[i].tokens?.context !== undefined) return messages[i].tokens!.context! >= COMPACT_TOKENS;
  }
  return false;
}

/**
 * 上下文包的取材(《obsidian仓库设计.md》§7 每轮那行):课程表命中的时段 + 老师守则(老师)+ 当前学期 + 档案与入口文件的原文(按 entryChars 截)
 * + 参考路径 + 本周计划里本老师的行 + 最近 14 天日记里本学科的「- 观察:」行。
 * 守则与笔记原文总是带上;同一话题里没改过的由 send 换成「未变」。
 */
export async function gatherContext(ws: Workspace, tutor: string, input: { from: MessageFrom; at: Date; agent?: string; query?: string }, report?: PackReport): Promise<ContextPack & { retrieved: Retrieved[] }> {
  const t = ws.config.tutors[tutor];
  const policy = resolvePolicy(ws.config, tutor);
  const pack: ContextPack = { at: localMinute(input.at), plan: [], recent: [] };
  // vault 那几段(src/memory/context.ts):activity 话题的记忆是它自己的(agent: <老师>/<activity>);档案、入口文件、日记观察照旧共用
  const mem = await learningContext(ws, { at: input.at, agent: input.agent ?? tutor, subject: t?.subject, display: t?.display, teacher: Boolean(t), ...(input.query ? { query: input.query } : {}), limits: { entryChars: policy.contextPack.entryChars, planLines: policy.contextPack.planLines, recent: policy.contextPack.recent } }, report);
  if (mem.slot) pack.slot = mem.slot;
  if (mem.semester) pack.semester = mem.semester;
  pack.notes = [];
  // 老师的公共守则:机器技能 cotutor-tutor 的原文,排在家长笔记前面(不截;同一话题没改过由 send 换成「未变」)
  try {
    pack.notes.push({ role: 'rules', path: TUTOR_RULES_PATH, text: tutorRulesBody(await readFile(join(ws.root, TUTOR_RULES_PATH), 'utf8')) });
    pack.rules = TUTOR_RULES_PATH;
  } catch {
    pack.rules = `缺:${TUTOR_RULES_PATH} 不在(cotutor refresh 补)`;
  }
  pack.notes.push(...mem.notes);
  pack.profile = mem.profile;
  if (mem.child !== undefined) pack.child = mem.child;
  if (mem.entry !== undefined) pack.entry = mem.entry;
  pack.memory = mem.memory;
  if (mem.teacherMemory) pack.teacherMemory = mem.teacherMemory;
  if (mem.lesson) pack.lesson = mem.lesson;
  if (mem.refs) pack.refs = mem.refs;
  pack.plan = mem.plan;
  pack.recent = mem.recent;
  if (mem.lookup.length) pack.lookup = mem.lookup;
  pack.vault = vaultPack(ws.paths);
  return { ...pack, retrieved: mem.retrieved };
}

/**
 * activity 的那两段:`activity:`(名字、参数)每条都带;
 * 「老师怎么带」那节(按参数裁过、剥了注释)作为一条笔记放进话题第一条(<cotutor-activity>),
 * 续话题没改过写「未变」(同守则)。文件不在、读不了 → activityGuide 写「缺」。返回给这轮的提醒。
 */
export async function attachActivity(ws: Workspace, tutor: string, pack: ContextPack, run: ActivityRun, inSystem = false): Promise<string[]> {
  pack.activity = { name: run.name, params: run.params };
  const path = relative(ws.root, findActivityFile(ws.root, tutor, run.name)).split(sep).join('/');
  const text = await readFile(join(ws.root, path), 'utf8').catch(() => null);
  if (text === null) {
    pack.activityGuide = `缺:${path} 不在`;
    return [`activity ${run.name}:${path} 不在,老师没拿到「老师怎么带」`];
  }
  const a = parseActivity(text).activity;
  // activity 已经是这个会话的系统提示:不再在第一条里带原文
  if (inSystem) {
    pack.activityGuide = ACTIVITY_IN_SYSTEM;
    return [];
  }
  const body = renderTutorSection(a, { params: run.params });
  if (body === null) return [];
  const notes = pack.notes ?? [];
  const at = notes.findIndex((n) => n.role === 'rules');
  notes.splice(at + 1, 0, { role: 'activityGuide', path, text: body });
  pack.notes = notes;
  pack.activityGuide = path;
  return [];
}

/** activity 在系统提示里时,上下文包 activityGuide 那一行 */
export const ACTIVITY_IN_SYSTEM = '已在你的系统提示里(这个话题的 activity,照它带)';

/**
 * activity 话题的系统提示(九点五):人设与做法都是 activity 自己的。
 *   body   「老师怎么带」按参数裁好、剥了注释
 *   guide  讲稿与动作怎么写(cards/动作怎么写.md)
 *   memory 这个 activity 自己的记忆:agent: <老师>/<activity>,文件名 <老师显示名>·<activity>
 * activity 文件不在、没有「老师怎么带」→ null(系统提示只剩一句「你是这个家的…」)。
 */
export interface ActivityParts {
  body: string;
  guide: string;
  memory: { agent: string; display: string };
}

export async function activityParts(ws: Workspace, tutor: string, run: ActivityRun): Promise<ActivityParts | null> {
  const a = await readActivity(ws, tutor, run.name);
  if (!a?.tutor) return null;
  const body = renderTutorSection(a, { params: run.params }) ?? '';
  const display = ws.config.tutors[tutor]?.display ?? tutor;
  return { body, guide: actsGuide(), memory: { agent: `${tutor}/${run.name}`, display: `${display}·${run.name}` } };
}

/**
 * 系统提示:activity 话题 = 它的「老师怎么带」+ 讲稿与动作怎么写,上下文包只写一行「已在系统提示里」。
 * 没有 activity 的(记账、整理记忆这种系统任务,以前不走 activity 的话题接着聊):一句「你是这个家的…」,要做什么写在消息里。
 */
async function systemParts(ws: Workspace, tutor: string, act: ActivityParts | null = null): Promise<{ systemBody: string; activityInSystem: boolean }> {
  if (act) return { systemBody: `${act.body}\n\n${act.guide}`, activityInSystem: true };
  return { systemBody: bareSystem(ws, tutor), activityInSystem: false };
}

/** 没有 activity 的那一句系统提示 */
export const bareSystem = (ws: Workspace, tutor: string): string => `你是这个家的${ws.config.tutors[tutor]?.display ?? tutor},对面是一个孩子。`;

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

/** 只读工具读得到的目录:workspace 根(作业照片、技能)与 vault(教材、日记) */
export function readDirsOf(ws: Workspace): string[] {
  return [...new Set([ws.root, ws.paths.vault])];
}

/** 干跑:现在给这位老师发这句话,上下文包会是什么样、每段从哪来、截了多少;不起模型、不写盘 */
export async function packDryRun(ws: Workspace, tutor: string, input: { from: MessageFrom; at: Date; text: string; activity?: ActivityRun }): Promise<{ prompt: string; pack: ContextPack; report: PackReport }> {
  const t = ws.config.tutors[tutor];
  if (!t) throw new UsageError(`没有叫 ${tutor} 的老师;cotutor.json 的 tutors 里有:${Object.keys(ws.config.tutors).join('、')}`);
  const report = {} as PackReport;
  const act = input.activity ? await activityParts(ws, tutor, input.activity) : null;
  const pack = await gatherContext(ws, tutor, { from: input.from, at: input.at, ...(input.from === 'kid' ? { query: input.text } : {}), ...(act ? { agent: act.memory.agent } : {}) }, report);
  const policy = resolvePolicy(ws.config, tutor);
  // 和 send 同一条规矩:孩子的话不带工具时,只有工具才用得上的路径不进包
  if (policy.tools !== 'on' && input.from === 'kid') { delete pack.refs; delete pack.vault; }
  const parts = await systemParts(ws, tutor, act);
  if (input.activity) await attachActivity(ws, tutor, pack, input.activity, parts.activityInSystem);
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
    out[r] = !rel || rel.startsWith('..') || isAbsolute(rel) ? p : rel.split(sep).join('/');
  }
  return out;
}

export class Runner {
  private readonly active = new Map<string, Active>();
  /** 还在后台跑的资产生成(测试与关服前 flush) */
  private readonly background = new Set<Promise<void>>();
  private readonly getWs: () => Workspace;
  private readonly opts: { now?: () => Date; env?: NodeJS.ProcessEnv; look?: Look };
  private readonly listeners = new Set<(e: RunEventEnvelope) => void>();
  /** noteEvent 每个事件文件一条追加链 */
  private readonly notes = new Map<string, Promise<void>>();
  /** 脑执行:请模型、读输出(src/brain/) */
  readonly brain: BrainExecutor;
  /** key、假端点从哪读的环境(测试注入) */
  get env(): NodeJS.ProcessEnv | undefined {
    return this.opts.env;
  }
  /** 当前的 workspace(cotutor.json 热重载后是新的;实时老师经它拿) */
  get ws(): Workspace {
    return this.getWs();
  }
  /** 认照片上的字词交给谁看(测试注入假的);COTUTOR_VISION_ENDPOINT:测试与探针指到假百炼 */
  private readonly look: Look;
  constructor(getWs: () => Workspace, opts: { now?: () => Date; env?: NodeJS.ProcessEnv; look?: Look } = {}) {
    this.getWs = getWs;
    this.opts = opts;
    const env0 = opts.env ?? process.env;
    const vision = env0.COTUTOR_VISION_ENDPOINT || undefined;
    // 脑指到了假百炼(测试、探针)而看图没指:不连真的,当没认成
    const offline = Boolean(env0.COTUTOR_BRAIN_ENDPOINT) && !vision;
    this.look = opts.look ?? (offline ? async () => ({ ok: false as const, error: 'no_endpoint', ms: 0 }) : (o) => lookAt({ ...o, env: opts.env, ...(vision ? { endpoint: vision } : {}) }));
    // API 运行时的 key 与配音、画图同一套选法(~/.config/cotutor/):Token Plan 有这个模型就走它,否则百炼按量;只有按量 key、没有业务空间 id 也能用(走公网域名)。
    // COTUTOR_BRAIN_ENDPOINT:测试与探针指到假百炼
    const env = opts.env ?? process.env;
    this.brain = createBrain({ workspace: () => { const ws = this.getWs(); return { config: ws.config, root: ws.root }; }, line: (model) => compatibleLine(model, env), endpoint: env.COTUTOR_BRAIN_ENDPOINT || undefined });
  }

  /** 孩子端发一条的验与拼(HTTP 与实时老师共用,./kid-input.ts):拼成 send 的入参,或回 reject;不起老师 */
  accept(tutor: string, body: unknown, date: string, deviceId?: string | null): Promise<KidAccept> {
    return kidInput(this.getWs(), tutor, body, date, deviceId);
  }

  /**
   * 一节课里孩子在页上做了一件事(实时那条连接报来的,src/runtime/live/call.ts 的 {t:'board'}):验过、落进这节课的状态、记进板的日志,不起老师。
   * base 是孩子那头现在铺的那一页(页的 id);和这节课现在的页对不上(他那头还没换过来)就不落。
   *  - 落一笔 {k:'stroke', pts, strip?}、擦掉 {k:'wipe'}、白纸条里的方向盘转了 {k:'turn', item, deg}:不念、不催;落的一笔是老师请着用笔时落的回 asked(收笔照它替他交)
   *  - 窗停下来 {k:'view', box}:照页的文字层说成一句(「第 55 页:第 7 段」「第 1 张:第 3 题」)记下
   *  - 窗里的图 {k:'shot', box, image}(jpeg data URL):只留最新一张,下一轮附给老师;不算孩子动了手
   *  - 点字 {k:'pick', text}:回这个字词的念法(照片上认字时模型写好的「傍,傍晚的傍」,嘴照念;没有就念它自己);揭开 {k:'reveal', text}:嘴不念
   *  - 自己翻页 {k:'open', title}:目录上点了一课(title 是目录上那一项,tocEntries),在一课里按「目录」回去(title = 目录,窗停在刚才那一课那一行),或翻到上一课、下一课(目录上的另一项)。
   *    照这本书的目录翻过去、记进板的日志;点的是一课就记下这本书翻到哪了(book-last)。不叫老师:下一轮「孩子做的」说他自己翻到了哪
   *  - 点读了一回 {k:'read', from, to, done?}(课本上点了标题或段首,孩子端放的配音;读到停下才报):记一笔,不叫老师
   *  作业本是连着滚的一整本:孩子滚到哪天、在目录上点了哪天都是挪窗(view),窗停下来说成「11月20日第 1 张:第 3 题」
   * 话题不是今天的一节课、东西不对:回 null,什么都不记
   */
  async boardEvent(tutor: string, date: string, body: unknown): Promise<BoardDone | null> {
    const ws = this.getWs();
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    if (typeof b.thread !== 'string' || typeof b.base !== 'string') return null;
    const thread = b.thread;
    const index = await readIndex(ws, tutor, date);
    const ths = threads(index.messages);
    if (!index.messages.find((_, i) => ths[i] === thread)?.base) return null;
    const r = await this.boardStep(ws, tutor, date, thread, b.base, b);
    // 孩子还没开口(只进了门):点字、挪窗都只记下,通话不替他叫老师(still: false),等他先说
    return r && !r.shot && !spokeIn(index.messages, thread) ? { ...r, still: false } : r;
  }

  /** boardEvent 的后半:话题与页已经验过 */
  private async boardStep(ws: Workspace, tutor: string, date: string, thread: string, base: string, b: Record<string, unknown>): Promise<BoardDone | null> {
    const at = (this.opts.now ?? (() => new Date()))().toISOString();
    /** 落进这节课的状态,回落完的样子;那一页不是现在的就不落(回 null) */
    const step = async (ev: LessonEvent): Promise<Lesson | null> => {
      let after = null as Lesson | null;
      await updateLesson(ws, tutor, date, thread, (l) => { if (l.at !== base) return l; after = lessonStep(l, ev); return after; });
      return after;
    };
    if (b.k === 'open') {
      if (typeof b.title !== 'string' || !b.title || b.title.length > 80) return null;
      const cur = lessonPage(await readLesson(ws, tutor, date, thread));
      if (!cur || cur.id !== base || cur.kind !== 'book') return null;
      const now = (this.opts.now ?? (() => new Date()))();
      const { book } = await this.bookOf(ws, tutor, now);
      const toc = b.title === BOOK_TOC;
      // 目录上点一课;一课里回目录,或翻到上一课、下一课(目录上的另一项);同一课、目录上点目录不翻
      if (!book || book.file !== cur.src || b.title === cur.title) return null;
      const entries = tocEntries(book)?.entries ?? [];
      const page = toc ? bookPageOf(book, null) : (entries.find((e) => e.title === b.title)?.page ?? null);
      if (!page) return null;
      const back = toc ? entries.find((e) => e.title === cur.title)?.box : undefined;
      let ok = false;
      await updateLesson(ws, tutor, date, thread, (l) => {
        if (l.at !== base) return l;
        ok = true;
        const s = lessonStep(l, { t: 'act', act: { k: '翻', page } });
        return back ? lessonStep(s, { t: 'view', box: back }) : s;
      });
      if (!ok) return null;
      await appendBoard(ws, tutor, date, thread, { at, k: 'open', text: page.title, base: page.id });
      if (!toc) await rememberBook(ws, book.file, page.title, now);
      return { thread, say: null, still: false };
    }
    // 点读了一回:只记一笔(读到哪停的),不念、不叫老师——他在听课文
    if (b.k === 'read') {
      const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 999;
      if (!int(b.from) || !int(b.to)) return null;
      const cur = lessonPage(await readLesson(ws, tutor, date, thread));
      if (!cur || cur.id !== base || cur.kind !== 'book') return null;
      await appendBoard(ws, tutor, date, thread, { at, k: 'read', base, from: b.from, to: b.to, ...(b.done === true ? { done: true as const } : {}) });
      return { thread, say: null, still: false };
    }
    // 点读一块:孩子点了分块里的一块听它的念法(声音孩子端自己放),记一笔,不叫老师
    if (b.k === 'hear') {
      if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 60) return null;
      const cur = lessonPage(await readLesson(ws, tutor, date, thread));
      if (!cur || cur.id !== base || cur.kind !== 'book') return null;
      await appendBoard(ws, tutor, date, thread, { at, k: 'hear', base, text: b.text.trim() });
      return { thread, say: null, still: false };
    }
    if (b.k === 'turn') {
      if (typeof b.item !== 'string' || b.item.length > 60 || typeof b.deg !== 'number' || !Number.isFinite(b.deg)) return null;
      return (await step({ t: 'turn', item: b.item, deg: b.deg })) ? { thread, say: null, still: false } : null;
    }
    if (b.k === 'stroke' || b.k === 'wipe') {
      const pts = b.k === 'stroke' && Array.isArray(b.pts) ? b.pts.slice(0, LESSON_INK_POINTS) : [];
      const ok = pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 100_000));
      if (b.k === 'stroke' && (!pts.length || !ok)) return null;
      const after = await step(b.k === 'stroke' ? { t: 'stroke', pts: pts as [number, number][], ...(typeof b.strip === 'string' && b.strip.length <= 60 ? { strip: b.strip } : {}) } : { t: 'wipe' });
      if (!after) return null;
      await appendBoard(ws, tutor, date, thread, { at, k: 'ink', base, ...(b.k === 'wipe' ? { wipe: true as const } : {}) });
      // 老师请着用笔(写、圈…)时落的:收笔替他交;没请他自己画的不交,随下一轮走
      const asked = b.k === 'stroke' && (lessonPage(after)?.open ?? []).some((o) => PEN_ASKS.includes(o));
      return { thread, say: null, still: false, ...(asked ? { asked: true as const } : {}) };
    }
    // 课本的田字格里写好了一个字(放好):这一格的笔画整个换掉(空的 = 擦干净了);请着用笔时同落笔一样替他交
    if (b.k === 'cell') {
      const strokes = Array.isArray(b.strokes) ? b.strokes : null;
      const pt = (p: unknown): boolean => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= CELL_UNIT);
      if (typeof b.id !== 'string' || !CELL_ID.test(b.id) || !strokes || strokes.length > LESSON_CELL_STROKES || !strokes.every((st) => Array.isArray(st) && st.length > 0 && st.length <= LESSON_INK_POINTS && st.every(pt))) return null;
      const after = await step({ t: 'cell', id: b.id, strokes: strokes as [number, number][][] });
      if (!after) return null;
      const model = typeof b.text === 'string' && b.text.length <= 4 && b.text.trim() ? b.text.trim() : undefined;
      await appendBoard(ws, tutor, date, thread, { at, k: 'cell', base, id: b.id, ...(model ? { text: model } : {}), ...(b.blank === true ? { blank: true as const } : {}), ...(strokes.length ? {} : { clear: true as const }) });
      const asked = strokes.length > 0 && (lessonPage(after)?.open ?? []).some((o) => PEN_ASKS.includes(o));
      return { thread, say: null, still: false, ...(asked ? { asked: true as const } : {}) };
    }
    if (b.k === 'view' || b.k === 'shot') {
      const box = Array.isArray(b.box) && b.box.length === 4 && b.box.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (b.box as [number, number, number, number]) : null;
      const shot = b.k === 'shot' ? jpegBytes(b.image) : null;
      if (!box || (b.k === 'shot' && !shot)) return null;
      const lesson = await readLesson(ws, tutor, date, thread);
      const page = lessonPage(lesson);
      if (!page || page.id !== base) return null;
      // 窗里的图:语文课本、目录不要(课文就是字,都在页的文字层里,每轮多一张图只多花钱);数学、科学课本、照片、白纸要(数、图、孩子写的在图上);
      // 语文课本上孩子在田字格里写了字也要(写成什么样只有图上有)
      const wrote = Object.keys(page.kid.cells ?? {}).length > 0;
      if (shot && page.kind === 'book' && (page.layout === 'prose' || page.title === BOOK_TOC) && !wrote) return null;
      const src = await this.lessonSource(ws, tutor, page.kind === 'book', lesson);
      const t = pageText(page, src);
      const text = (page.kind === 'white' ? '白纸' : page.kind === 'photo' ? photoView(page, t, box) : bookView(t.pages, t.sheets, t.blocks, box)).slice(0, 80);
      if (shot) {
        const file = conversationFiles(ws.dirs.conversations, tutor, date).shot(thread);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, shot);
        await rename(`${file}.tmp`, file);
        await appendBoard(ws, tutor, date, thread, { at, k: 'shot', text, base });
        return { thread, say: null, shot: true };
      }
      await appendBoard(ws, tutor, date, thread, { at, k: 'view', text, base });
      await step({ t: 'view', box });
      // 这一册翻到哪、窗停在哪(下次进门摆回来);目录不记
      if (page.kind === 'book' && page.title !== BOOK_TOC) await rememberBook(ws, page.src, page.title, new Date(at), box);
      else if (page.kind === 'workbook') await rememberBook(ws, workbookPageId(page.src), page.title, new Date(at), box);
      return { thread, say: null, still: false };
    }
    // 揭开的可以是盖住的算式(盖: 6×4=24),不只是字词
    if ((b.k !== 'pick' && b.k !== 'reveal') || typeof b.text !== 'string' || !(pickable(b.text) || (b.k === 'reveal' && b.text.trim().length > 0 && Array.from(b.text).length <= BOOK_MARK_CHARS))) return null;
    const text = b.text;
    if (!(await step(b.k === 'reveal' ? { t: 'reveal', text } : { t: 'pick', text }))) return null;
    await appendBoard(ws, tutor, date, thread, { at, k: b.k, text, base });
    // 揭开:露出来就够了,嘴不念(他在自己认)
    if (b.k === 'reveal') return { thread, say: null };
    // 照片上认字时模型写好了念法(「傍,傍晚的傍」)就念它
    const page = lessonPage(await readLesson(ws, tutor, date, thread));
    for (const ph of page?.kind === 'photo' ? page.photos : []) {
      const item = (await readWords(join(ws.root, ph.src)))?.items.find((x) => x.text === text && x.say?.trim());
      if (item) return { thread, say: item.say!.trim() };
    }
    return { thread, say: text };
  }

  /** 讲稿里的动作落到页上(src/board/lesson-fit.ts):照这一轮开始时这节课的样子一个一个落;不铺页的原样 */
  private fitBoard(section: BoardSection, active: Active): { section: BoardSection; why: string[] } {
    if (!active.lesson) return { section, why: [] };
    return fitSection(section, active.lesson.at, active.lesson.src);
  }

  /** 这位老师学科、这学期的那一册课本:索引;教材目录下没有、读不了回 problem(给老师的底、家长端) */
  private async bookOf(ws: Workspace, tutor: string, now: Date): Promise<{ book: LessonBook | null; problem?: string }> {
    const subject = canonicalSubject(ws.config.tutors[tutor]?.subject);
    const name = pickBook(await listBooks(ws.paths.textbooks, subject || null), now);
    if (!name) return { book: null, problem: `教材文件夹里没有${subject || '这一科'}的课本 PDF` };
    const index = await bookIndex(ws.paths.textbooks, join(ws.root, BOOK_CACHE), name).catch((e: unknown) => { void e; return null; });
    if (!index) return { book: null, problem: `课本《${name}》读不出来` };
    const zones = await bookZones(ws.paths.textbooks, join(ws.root, BOOK_CACHE), index);
    const problems = [...index.problems, ...zones.problems];
    return { book: { file: name, index, zones }, ...(problems.length ? { problem: `课本《${name}》:${problems.join(';')}` } : {}) };
  }

  /** 照片页上每张认出的字(还没认、没认成的没有);running = 还在认的那几张 */
  private async photoTexts(ws: Workspace, l: Lesson): Promise<{ photos: Record<string, PhotoText>; running: string[] }> {
    const photos: Record<string, PhotoText> = {};
    const running: string[] = [];
    for (const p of l.pages) {
      if (p.kind !== 'photo') continue;
      for (const ph of p.photos) {
        const rec = await readWords(join(ws.root, ph.src));
        if (!rec) continue;
        if (rec.state === 'running') running.push(ph.src);
        photos[ph.src] = { items: rec.items.flatMap((x) => (x.box ? [{ text: x.text, box: x.box }] : [])), lines: rec.lines ?? [], questions: rec.questions ?? [] };
      }
    }
    return { photos, running };
  }

  /** 页的文字层从哪来(找框、说窗里是哪):课本(要的话)、照片认出的字、小课堂的每一句、铺过的练习册 */
  private async lessonSource(ws: Workspace, tutor: string, withBook: boolean, l: Lesson): Promise<LessonSource> {
    const book = withBook ? (await this.bookOf(ws, tutor, (this.opts.now ?? (() => new Date()))())).book : null;
    return { book, photos: (await this.photoTexts(ws, l)).photos, lecture: await this.lectureOf(ws, l), workbooks: await this.workbooksOf(ws, l) };
  }

  /** 这节课铺过的练习册(现读 vault 的练习册/;读不出来的不在里面) */
  private async workbooksOf(ws: Workspace, l: Lesson): Promise<Record<string, Workbook>> {
    const out: Record<string, Workbook> = {};
    for (const p of l.pages) {
      if (p.kind !== 'workbook' || out[p.src]) continue;
      const r = await readWorkbook(ws.paths.workbooks, p.src);
      if ('wb' in r) out[p.src] = r.wb;
    }
    return out;
  }

  /** 这节课铺着的小课堂(页集里那一页的课包或视频);没有、读不出来 → null */
  private async lectureOf(ws: Workspace, l: Lesson): Promise<LessonSource['lecture']> {
    const p = l.pages.find((x) => x.kind === 'lecture');
    const got = p && p.kind === 'lecture' ? await readLecture(ws, p.bundle) : null;
    return got ? { bundle: got.id, clock: got.clock } : null;
  }

  /** 这一条带的照片的宽高(照片页照它排);读不出的不铺 */
  private async photoSizes(ws: Workspace, photos: readonly string[]): Promise<PagePhoto[]> {
    const out: PagePhoto[] = [];
    for (const src of photos) {
      const size = imageSize(await readFile(join(ws.root, src)).catch(() => Buffer.alloc(0)));
      if (size) out.push({ src, ...size });
    }
    return out;
  }

  /**
   * 一节课(activity 头上 base:)这一轮开始时的样子:从小课堂按钮进来的先铺那堂课;课本做底的先铺目录;练习册铺参数说的那一册(读不出来铺白纸,给家长记一句);
   * 这一条带的照片接在照片页后面(没有就开一页);
   * 作业本(base: homework):还没铺作业本就铺(最近拍过的那些天,今天拍过的也在;一张没拍过也铺,舞台只画最后那张白纸),拍来的接在后面;
   * 这一条带的照片抄进作业本(src/runtime/homework.ts)。
   * 孩子拍的作业(base: photo)、练习册还没有页就铺一张白纸页。落盘,回页的文字层从哪来、这节课现在的样子。
   * 孩子端照同样的规矩先落在自己那一份上(拍的照片发出去就铺、不等老师)
   */
  private async lessonOn(ws: Workspace, tutor: string, now: Date, date: string, thread: string, base: ActivityBase, photos: readonly string[], lecture: Lecture | null, workbook: string | null, want: string | null = null): Promise<{ src: LessonSource; lesson: Lesson; problem?: string; running: string[] }> {
    const got = base === 'textbook' ? await this.bookOf(ws, tutor, now) : { book: null };
    const { book } = got;
    let problem = 'problem' in got ? got.problem : undefined;
    const wbRead = base === 'workbook' ? (workbook ? await readWorkbook(ws.paths.workbooks, workbook) : { why: '这个 activity 没给练习册参数' }) : null;
    if (wbRead && 'why' in wbRead) problem = `练习册:${wbRead.why}`;
    const last = book ? await lastSpot(ws, book.file) : null;
    const wbLast = workbook ? await lastSpot(ws, workbookPageId(workbook)) : null;
    const sizes = await this.photoSizes(ws, photos);
    // 数学的照片上点的是数和算式,不弹田字格(同数学课本)
    const pick = canonicalSubject(ws.config.tutors[tutor]?.subject) !== '数学';
    // 作业本(这一条的照片抄进去之前的;这节课铺过就不再读)
    const hw = base === 'homework';
    const hwBook = hw && !(await readLesson(ws, tutor, date, thread)).pages.some((p) => p.id === PHOTO_PAGE) ? await homeworkBookPage(ws, tutor, date, pick) : null;
    if (hw && photos.length) await keepPhotos(ws, tutor, photos);
    const lesson = await updateLesson(ws, tutor, date, thread, (l) => {
      // 小课堂(孩子端点了按钮就铺上、先看完才开口;服务端收到第一条时照同样的规矩铺)
      let s = lecture && !l.pages.some((p) => p.kind === 'lecture') ? lessonStep(l, { t: 'act', act: { k: '翻', page: lecturePage(lecture) } }) : l;
      s = book ? lessonOpen(s, book, last, want) : s;
      // 练习册:这一册还没铺过才铺(铺过的翻回来原样在)
      // 第一次铺这一册:窗摆回上次停的地方
      if (workbook && wbRead && 'wb' in wbRead && !s.pages.some((p) => p.kind === 'workbook' && p.src === workbook)) {
        s = lessonStep(s, { t: 'act', act: { k: '翻', page: workbookPage(workbook, wbRead.wb, pick) } });
        if (wbLast?.view) s = lessonStep(s, { t: 'view', box: wbLast.view });
      }
      if (hwBook && !s.pages.some((p) => p.id === PHOTO_PAGE)) s = lessonStep(s, { t: 'act', act: { k: '翻', page: hwBook } });
      if (sizes.length) s = lessonStep(s, { t: 'photo', photos: sizes, pick, ...(hw ? { day: date } : {}) });
      else if ((base === 'photo' || base === 'workbook') && !s.at) s = lessonStep(s, { t: 'act', act: { k: '翻', page: whitePage() } });
      return s;
    });
    const texts = await this.photoTexts(ws, lesson);
    return { src: { book, photos: texts.photos, lecture: await this.lectureOf(ws, lesson), workbooks: await this.workbooksOf(ws, lesson) }, lesson, running: texts.running, ...(problem ? { problem } : {}) };
  }

  /**
   * 一节课这一轮给老师的「页此刻的样子」(board:)和页的文字层(这一轮第一次看到的页印的字;压缩以后重给现在这一页)。
   * 上一轮以后舞台交过窗里的图(shot)就挪成这一轮的(<date>.<job>.shot.jpg),shot 是它的绝对路径,随这一轮附给老师。
   * told = 这一轮给了哪几页的字(收尾记进板的日志,以后不重给)
   */
  private async lessonSlate(ws: Workspace, tutor: string, date: string, thread: string, job: string, x: { src: LessonSource; lesson: Lesson; problem?: string; running: string[] }, now: Date, opts: { compact: boolean; fresh: readonly string[]; /** 孩子这一条带来的、页上状态里没有的(小课堂看的情况、画的几处) */ did?: readonly string[]; /** 这节课认不认照片上的字(activity 有「认字收到什么」);false 时不说「还在认」 */ reads?: boolean }): Promise<{ slate: NonNullable<ContextPack['slate']>; notes: PageNote[]; told: string[]; shot?: string }> {
    const events = await readBoard(ws, tutor, date, thread);
    const page = lessonPage(x.lesson);
    const told = new Set(opts.compact ? [] : events.flatMap((e) => (e.k === 'turn' && e.told ? (Array.isArray(e.told) ? e.told : [e.told]) : [])));
    const notes: PageNote[] = [];
    /** 练习册上孩子用笔圈、画的,照作答区说成几句(上一轮以后落过笔才说) */
    let inked: string[] = [];
    /** 课本窗里那几块只给老师的话(分块的 teacher),每轮照窗现算 */
    let teacher: string[] = [];
    /** 课本格子的名字(分块的作答区):孩子在格里写了哪几格,照名字说 */
    let cellLabels: Record<string, string> | undefined;
    let show = '还没有页';
    if (page?.kind === 'book') {
      const at = x.src.book && page.src === x.src.book.file ? bookLesson(x.src.book.index, page.title) : null;
      const parts = at && x.src.book ? bookSlateParts(x.src.book.index, at, pickBookZones(x.src.book.index, x.src.book.zones, at.pages.map((p) => p.n)).pages, page.title === BOOK_TOC ? await bookLast(ws, x.src.book.file) : null) : null;
      show = parts?.show ?? `课本《${page.src}》读不出来`;
      if (parts && !told.has(page.id)) notes.push({ id: page.id, name: page.title === BOOK_TOC ? '目录' : `《${page.title}》`, text: clipNote(parts.text) });
      if (at && x.src.book && page.title !== BOOK_TOC) {
        const t = pageText(page, x.src);
        const regions = bookRegions(t.pages, t.sheets, pickBookZones(x.src.book.index, x.src.book.zones, page.pages).pages);
        const boxes = [x.lesson.view, x.lesson.look?.box].filter((b): b is Box => Boolean(b));
        teacher = boxes.length ? bookTeacherLines(t.pages, t.sheets, t.blocks, boxes) : [];
        cellLabels = Object.fromEntries(regions.map((r) => [r.id, r.label]));
        let last = 0;
        events.forEach((e, i) => { if (e.k === 'turn') last = i + 1; });
        if (events.slice(last).some((e) => e.k === 'ink' && e.base === page.id)) inked = bookZoneInk(regions, page.kid.ink);
      }
    } else if (page?.kind === 'photo' && page.day) {
      // 作业本:一整本连着滚(老的在上);今天拍的几张、以前那几天、孩子在看哪儿。字只给今天的和孩子眼前那几张
      const labels = homeworkLabels(page);
      const today = page.photos.flatMap((ph, i) => (photoDay(ph, page.day!) === page.day ? [i] : []));
      const reads = opts.reads !== false;
      const wait = reads ? today.filter((i) => x.running.includes(page.photos[i].src) || !x.src.photos?.[page.photos[i].src]).map((i) => labels[i].k) : [];
      const note = wait.length ? `;第 ${wait.join('、')} 张${opts.fresh.length ? '刚拍来、图附在这一轮,字' : '的字'}还在认` : !reads && today.length ? `;这节课不认照片上的字${opts.fresh.length ? ',图附在这一轮' : ''}` : '';
      const n = today.length;
      const days = [...new Set(page.photos.map((ph) => photoDay(ph, page.day!)))].filter((d) => d !== page.day);
      const recent = days.slice(-HOMEWORK_TURN_DAYS).map((d) => `${dayTitle(d)}(${labels.filter((l) => l.day === d).length} 张)`);
      const more = recent.length ? `;往前还有 ${recent.join('、')}${days.length > recent.length ? ` 等 ${days.length} 天` : ''}(窗移到那天写 [[翻 ${dayTitle(days[days.length - 1])}]],看那天的一张写 [[看 ${dayTitle(days[days.length - 1])}第1张]];以前的照片上留着那时的记号,只看,孩子擦不掉、也写不上)` : '';
      show = `作业本(检查作业拍的照片按天攒成一本,老的在上、新拍的接在后面,最后一张白纸是拍照的地方):今天${n ? `拍了 ${n} 张(第 1${n > 1 ? `–${n}` : ''} 张)${note}` : '还没拍'}${more}`;
      // 孩子眼前那几张(窗停在以前那天)也给字
      const near = (b: Box | null | undefined): number[] => (b ? page.photos.flatMap((_, i) => { const [, y1, , y2] = photoSheetBox(page.photos, i, page.day); return y1 < b[3] && y2 > b[1] ? [i] : []; }) : []);
      for (const i of [...new Set([...today, ...near(x.lesson.view), ...near(x.lesson.look?.box)])].sort((a, b) => a - b)) {
        const ph = page.photos[i];
        const id = `${PHOTO_PAGE}#${ph.src}`;
        const t = x.src.photos?.[ph.src];
        if (!t || x.running.includes(ph.src) || told.has(id)) continue;
        const layer = photoBookPage(i + 1, ph, t);
        notes.push({ id, name: labels[i].label, text: clipNote(photoText(layer.page, layer.blocks)) });
      }
    } else if (page?.kind === 'photo') {
      const n = page.photos.length;
      const reads = opts.reads !== false;
      const wait = reads ? page.photos.flatMap((ph, i) => (x.running.includes(ph.src) || !x.src.photos?.[ph.src] ? [i + 1] : [])) : [];
      const note = wait.length ? `;第 ${wait.join('、')} 张${opts.fresh.length ? '刚拍来、图附在这一轮,字' : '的字'}还在认` : !reads ? `;这节课不认照片上的字${opts.fresh.length ? ',图附在这一轮' : ''}` : '';
      show = `孩子拍的作业照片 ${n} 张(从上往下连着${n > 1 ? `,第 1–${n} 张` : ''})${note}`;
      page.photos.forEach((ph, i) => {
        const id = `${PHOTO_PAGE}#${ph.src}`;
        const t = x.src.photos?.[ph.src];
        if (!t || x.running.includes(ph.src) || told.has(id)) return;
        const layer = photoBookPage(i + 1, ph, t);
        notes.push({ id, name: `第${i + 1}张`, text: clipNote(photoText(layer.page, layer.blocks)) });
      });
    } else if (page?.kind === 'workbook') {
      const wb = x.src.workbooks?.[page.src];
      const n = page.sheets.length;
      show = wb ? `练习册《${page.title}》${n} 页(从上往下连着;看一道写 [[看 第 3 题]],题号一册里贯穿)` : `练习册《${page.title}》读不出来了`;
      wb?.pages.forEach((pg, i) => {
        const id = `${page.id}#${i + 1}`;
        if (!told.has(id)) notes.push({ id, name: `《${page.title}》第${i + 1}页`, text: clipNote(workbookText(pg)) });
      });
      let last = 0;
      events.forEach((e, i) => { if (e.k === 'turn') last = i + 1; });
      if (wb && events.slice(last).some((e) => e.k === 'ink' && e.base === page.id)) inked = workbookInk(wb, page.sheets, page.kid.ink);
    } else if (page?.kind === 'white') show = '白纸(老师摆、写的都在上面)';
    else if (page?.kind === 'lecture') {
      const c = x.src.lecture && x.src.lecture.bundle === page.bundle ? x.src.lecture.clock : null;
      show = `小课堂《${page.title}》(${page.video ? '视频' : '课包'},${clockLabel(page.ms)};放课里一段写 [[看 0:19–0:30]])${c ? '' : ';课读不出来了,放不了'}`;
      if (c && !told.has(page.id)) notes.push({ id: page.id, name: `小课堂《${page.title}》`, text: clipNote(lectureLines(c)) });
    }
    if (!page && x.problem) show = `课本:${x.problem}(请家长放进 vault 的教材文件夹)`;
    const others = x.lesson.pages.filter((p) => p !== page).map((p) => (p.kind === 'book' ? `《${p.title}》` : p.kind === 'photo' ? (p.day ? '作业本' : `作业照片(${p.photos.length} 张)`) : p.kind === 'lecture' ? `小课堂《${p.title}》` : p.kind === 'workbook' ? `练习册《${p.title}》` : '白纸'));
    let from = 0;
    events.forEach((e, i) => { if (e.k === 'turn') from = i + 1; });
    const files = conversationFiles(ws.dirs.conversations, tutor, date);
    const fresh = page ? events.slice(from).some((e) => e.k === 'shot' && e.base === page.id) : false;
    const shot = fresh ? await rename(files.shot(thread), files.shot(job)).then(() => files.shot(job), () => undefined) : undefined;
    const did = [...(opts.did ?? []), ...inked];
    const slate = slateOf({ page: { id: page?.id ?? '#', show }, others, events, lesson: lessonSlateBits(x.lesson), now: now.getTime(), ...(shot ? { shot: true } : {}), ...(did.length ? { did } : {}), ...(teacher.length ? { teacher } : {}), ...(cellLabels ? { cellLabels } : {}) });
    return { slate, notes, told: notes.map((n) => n.id), ...(shot ? { shot } : {}) };
  }

  /**
   * 进门(孩子先说的 activity):孩子点了首页的砖(activity eval 也先进门)。不请脑:记一条「进门」(话题第一条,带 via、activity、base、listen;text 是按钮上的字),
   * 把页铺好(课本:家长填的「范围」那一课 → 上次翻到的那一课 → 目录;练习册:按钮挂的那一册;作业本:整本,最后一张白纸;照片页:白纸)就回。
   * 孩子开口那条接着这个话题(kidInput 照进门那条补上按钮的讲法)。今天这位老师只进了门的旧话题(没开口就走了、页面没来得及说)先扫掉。
   * 老师正在回上一条 → BusyError(收尾时要整份重写索引,这时插一条会被盖掉;孩子端过一会儿再进)
   */
  async enter(tutor: string, input: SendInput): Promise<{ tutor: string; date: string; thread: string }> {
    const ws = this.getWs();
    const t = ws.config.tutors[tutor];
    if (!t) throw new UsageError(`没有叫 ${tutor} 的老师`);
    if (!t.enabled) throw new UsageError(`${t.display} 已关闭`);
    if (!input.activity) throw new UsageError('进门要从一个 activity 开始');
    const busy = this.active.get(tutor);
    if (busy) throw new BusyError(tutor, busy.job);
    const now = (this.opts.now ?? (() => new Date()))();
    const date = localDate(now);
    for (const th of quietThreads(await readIndex(ws, tutor, date))) await deleteThread(ws, tutor, date, th).catch(() => undefined);
    const index = await readIndex(ws, tutor, date);
    const job = jobId(now, index.messages.length + 1);
    const actDef = await readActivity(ws, tutor, input.activity.name);
    if (!actDef) throw new UsageError(`${t.display} 家里没有「${input.activity.name}」这个 activity`);
    const base = activityBase(actDef);
    const wbParam = actDef.params.find((p) => p.type === '练习册');
    const param = (name: string | undefined): string | null => (name ? String(input.activity?.params?.[name] ?? '').trim() || null : null);
    const wbName = wbParam ? param(wbParam.name) ?? (wbParam.default !== undefined ? String(wbParam.default) : null) : null;
    const les = await this.lessonOn(ws, tutor, now, date, job, base, [], null, wbName, base === 'textbook' ? param(ENTER_RANGE) : null);
    const msg = addMessage(index, { job, thread: job, at: localMinute(now), from: 'kid', text: input.text.trim() || input.activity.name, enter: true, ...(input.via ? { via: input.via } : {}), ...(input.eval ? { eval: true as const } : {}), activity: input.activity, base, ...(actDef.listen === 'open' ? { listen: 'open' as const } : {}), ...(input.device ? { device: input.device } : {}), ...(input.deviceId ? { deviceId: input.deviceId } : {}), ...(les.problem ? { warnings: [les.problem] } : {}), result: 'ok', artifacts: [], kidText: null });
    await writeIndex(ws, msg);
    return { tutor, date, thread: job };
  }

  /** 孩子点回首页:这个话题只进了门、没开口,就删掉(不存);开过口的、老师正在回的不动 */
  async leave(tutor: string, date: string, thread: string): Promise<boolean> {
    const ws = this.getWs();
    if (this.active.has(tutor)) return false;
    const index = await readIndex(ws, tutor, date);
    if (!quietThreads(index).includes(thread)) return false;
    await deleteThread(ws, tutor, date, thread);
    return true;
  }

  /** 应用替孩子叫了一次老师(他在板上点完了一直没出声):记进板的日志 */
  async boardStill(tutor: string, date: string, thread: string): Promise<void> {
    const now = (this.opts.now ?? (() => new Date()))();
    await appendBoard(this.getWs(), tutor, date, thread, { at: now.toISOString(), k: 'still' });
  }

  running(tutor: string): { job: string; date: string } | null {
    const a = this.active.get(tutor);
    return a ? { job: a.job, date: a.date } : null;
  }

  /** 等所有后台资产生成完(测试用) */
  async flush(): Promise<void> {
    while (this.background.size) await Promise.all([...this.background]);
  }

  /** 订阅每一轮的事件(runtime/journal/events.ts;cotutor send 现场打印、serve --trace);返回退订函数。事件同时追加到 <日期>.<job>.events.jsonl */
  onEvent(fn: (e: RunEventEnvelope) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** 别处给某一轮补事件(实时老师的嘴,src/runtime/live/call.ts;t 已经换成离这一轮老师进程起来的毫秒):追加到 events.jsonl、给订阅者;这一轮跑完了也行 */
  async noteEvent(tutor: string, date: string, job: string, event: RunEvent): Promise<void> {
    const file = conversationFiles(this.getWs().dirs.conversations, tutor, date).events(job);
    // 同一个文件按序追加(几条一起来时不乱序)
    const chain = (this.notes.get(file) ?? Promise.resolve()).then(() => appendFile(file, `${JSON.stringify(event)}\n`)).catch(() => {});
    this.notes.set(file, chain);
    void chain.finally(() => { if (this.notes.get(file) === chain) this.notes.delete(file); });
    await chain;
    for (const fn of this.listeners) {
      try {
        fn({ tutor, date, job, event });
      } catch {
        /* 订阅者的错不影响 */
      }
    }
  }

  /** 正在回的那条已经出来的讲稿(流式);没在跑或还没出来 → null */
  partial(tutor: string): BoardSection | null {
    return this.active.get(tutor)?.partial ?? null;
  }

  async send(tutor: string, input: SendInput): Promise<SendStarted> {
    const ws = this.getWs();
    const t = ws.config.tutors[tutor];
    if (!t) throw new UsageError(`没有叫 ${tutor} 的老师;cotutor.json 的 tutors 里有:${Object.keys(ws.config.tutors).join('、')}`);
    if (!t.enabled) throw new UsageError(`${t.display} 已关闭(cotutor.json tutors.${tutor}.enabled = false),打开再发`);
    const photos = input.photos?.filter(Boolean) ?? [];
    // 小课堂画的一处带一张截图:和照片一样进上下文包 photos:(排在孩子拍的后面),这一轮带工具读图;消息的 photos 只记孩子拍的
    const shots = input.lecture?.marks?.flatMap((m) => (m.image ? [m.image] : [])) ?? [];
    const seen = [...photos, ...shots];
    const text = input.text.trim() || (input.action === 'submit' ? '(给老师看,没说话)' : photos.length ? (photos.length === 1 ? '(拍了一张)' : `(拍了 ${photos.length} 张)`) : '');
    if (!text) throw new UsageError('消息是空的');
    const busy = this.active.get(tutor);
    if (busy) throw new BusyError(tutor, busy.job);
    const now = (this.opts.now ?? (() => new Date()))();
    const date = input.date ?? localDate(now);
    // 占位要在第一个 await 之前:查完 busy 到请脑之间十几个 await,孩子连点两下两条都过检查、算出同一个 job、起两轮。
    // 占位先进 map,job 等读了索引再填;起不来(索引坏、话题不在、CLI 没起)就放掉占位
    const active: Active = { job: '(准备中)', date, partial: null, done: new Promise<never>(() => {}) };
    this.active.set(tutor, active);
    try {
      return await this.begin(ws, tutor, input, { t, now, date, photos, seen, text }, active);
    } catch (err) {
      if (this.active.get(tutor) === active) this.active.delete(tutor);
      throw err;
    }
  }

  /**
   * 孩子这条带的照片,照这个 activity「认字收到什么」的要求认出字词和它们在照片上的位置,存在照片旁边(src/scenes/photo-words/store.ts)。
   * 不等它:起了就回,认的过程一行一行落盘;activity 没有那一节就不认。
   */
  private async startPhotoWords(ws: Workspace, tutor: string, activity: string, photos: readonly string[]): Promise<void> {
    const tool = (await readActivity(ws, tutor, activity))?.tools.find((x) => x.tool === '认字');
    if (!tool) return;
    // 全文的每一行也要框:正文里没被挑出来的字,孩子也能点
    // 认中文还是英文:照这位老师的学科(英语老师认单词)
    const lang = subjectLang(ws.config.tutors[tutor]?.subject);
    const text = photoPromptFrom(tool.prompt, lang, { boxed: true });
    const model = ws.config.dictation.model;
    for (const rel of photos) {
      const bg = (await startWords(join(ws.root, rel), (image, onProgress) => recognizeWith(this.look, image, onProgress, { model, text, lang }), { now: this.opts.now }))?.done;
      if (!bg) continue;
      this.background.add(bg);
      void bg.finally(() => this.background.delete(bg));
    }
  }

  /** send 的后半:占位已在 active 里,这里读索引、拼包、起进程;抛了由 send 放掉占位 */
  private async begin(ws: Workspace, tutor: string, input: SendInput, prep: { t: Workspace['config']['tutors'][string]; now: Date; date: string; photos: string[]; seen: string[]; text: string }, active: Active): Promise<SendStarted> {
    const { t, now, date, photos, seen, text } = prep;
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
    const { name: runtimeName, runtime } = getRuntime(ws.config, input.runtime ?? t.runtime);
    // 话题只属于开它的那种运行时:会话是别的运行时的(换过运行时)就接不上,这条开新话题,不把两种会话混在一个话题里;记账在 bookkeep 里先跳过了
    // 换了运行时开的新话题照旧是原来那个话题的 activity(话题从 activity 开始)
    const carried = thread !== job && !input.bookkeep && !sameRuntime(index, thread, runtimeName) ? threadActivity(index.messages, thread) : undefined;
    if (carried !== undefined) thread = job;
    const fresh = thread === job;
    const session = fresh ? null : sessionFor(index, thread);
    // 长话题整段压缩(API 运行时):之前的模型历史不再发,前情照索引拼;这一轮笔记带全文,不写「未变」(原文所在的那几轮不发了)
    const compact = !fresh && isApiRuntime(runtime) && dueCompact(index.messages, known, thread);
    // activity:新话题照这条带的,续话题照话题第一条记的。系统提示、卡、记忆都是它的(记账轮也是,接着同一个会话);上下文包的 activity 段记账轮不带
    const threadRun = fresh ? (input.activity ?? carried ?? null) : threadActivity(index.messages, thread);
    // 新话题都从一个 activity 开始(没有自由话题);系统任务(记账、整理记忆)不在此列
    if (fresh && !threadRun && input.from === 'kid') throw new UsageError('开新话题要从一个 activity 开始:孩子端点首页的按钮、方砖;cotutor send 加 --activity <名>');
    const act = threadRun ? await activityParts(ws, tutor, threadRun) : null;
    // 取材的查询:孩子这句话,加首页按钮的讲法(系统任务不查)
    const query = input.from === 'kid' ? [text, input.home?.brief].filter(Boolean).join('\n') : '';
    const gathered = await gatherContext(ws, tutor, { from: input.from, at: now, ...(query ? { query } : {}), ...(act ? { agent: act.memory.agent } : {}) });
    const policy = resolvePolicy(ws.config, tutor);
    const { systemBody, activityInSystem } = await systemParts(ws, tutor, act);
    const activityRun = input.bookkeep ? null : threadRun;
    const activityWarn = activityRun ? await attachActivity(ws, tutor, gathered, activityRun, activityInSystem) : [];
    // 家长笔记原文:新会话整篇带;续会话时这个话题带过、没改的只写「未变」
    const notes = noteVersions(gathered);
    const pack = session && !compact ? dropSeenNotes(gathered, seenNotes(index.messages, thread)) : gathered;
    // 这轮带不带工具(policy.tools):孩子说的话缺省不带,只凭上下文包答;带照片的(要 Read 看图)、
    // 系统任务带只读的(以前是整份白名单,照片里一句话就能让老师拿 Bash 读写 workspace 外);policy.tools: on 的老师总是整份。
    // 不带的那轮,只有工具才用得上的路径(refs / vault)不进包
    const tools: ToolSet = policy.tools === 'on' ? 'on' : input.from !== 'kid' || seen.length > 0 ? 'read' : 'off';
    if (tools === 'off') { delete pack.refs; delete pack.vault; }
    if (seen.length) { pack.photos = seen; pack.photoFiles = seen.map((p) => join(ws.root, p)); }
    if (input.home) pack.home = input.home;
    // 一节课(activity 头上 base:;记在话题第一条):每一轮带页此刻的样子,第一次看到的页带上它印的字
    const first = fresh ? null : index.messages.find((_, i) => known[i] === thread);
    const actDef = threadRun ? await readActivity(ws, tutor, threadRun.name) : null;
    // 小课堂:课包现读;读不出来(删了、坏了)就不带,这条照发,家长端提醒
    const lecture = input.lecture ? await readLecture(ws, input.lecture.bundle) : null;
    const marks = input.lecture?.marks?.length ? storedMarks(lecture, input.lecture.marks, photos.length) : [];
    const lectureWarn = input.lecture && !lecture ? [`小课堂:${input.lecture.bundle} 读不出来(bundles/ 与 lectures/ 下都没有能放的),老师没拿到课的内容`] : [];
    // 铺哪种页:activity 头上的 base(没写当 photo);从小课堂按钮进来的,页上还先铺那堂课(lessonOn)。不带 activity 的系统任务、以前不铺页的话题不铺
    const freshBase: ActivityBase | null = actDef ? activityBase(actDef) : input.lecture ? 'lecture' : null;
    const pageBase: ActivityBase | null = input.bookkeep ? null : fresh ? (activityRun || input.lecture ? freshBase : null) : (first?.base ?? null);
    // 练习册:这个 activity 里类型是「练习册」的那个参数(家长在首页按钮上填的,话题第一条记着)
    const wbParam = actDef?.params.find((p) => p.type === '练习册');
    const wbName = wbParam ? String(threadRun?.params?.[wbParam.name] ?? wbParam.default ?? '').trim() || null : null;
    const les = pageBase ? await this.lessonOn(ws, tutor, now, date, thread, pageBase, photos, lecture, wbName) : null;
    if (les?.problem) activityWarn.push(les.problem);
    if (les && pageBase) active.lesson = { base: pageBase, src: les.src, at: les.lesson };
    const slate = les ? await this.lessonSlate(ws, tutor, date, thread, job, les, now, { compact, fresh: photos, did: input.lecture ? lectureDid(lecture, input.lecture, marks) : [], reads: !actDef || actDef.tools.some((t) => t.tool === '认字') }) : null;
    if (slate) {
      pack.slate = slate.slate;
      if (slate.notes.length) pack.pageNotes = slate.notes;
      // 附给老师的图只有一条路:这一轮新拍的照片附整张(读题,images),窗里的那一块附这一轮(孩子眼前的样子,boards,以后换成一句占位);照片在页上,不进 photos:

      delete pack.photos;
      delete pack.photoFiles;
    }
    // 小课堂上画的一处带一张截图,排在这一轮新拍的照片后面(storedMarks 的那段话照这个顺序说第几张)
    const images = slate ? seen.map((p) => join(ws.root, p)) : (pack.photoFiles ?? []);
    if (input.live) {
      const l = input.live;
      pack.live = { ...(l.caught ? { caught: l.caught } : {}), ...(l.cut !== undefined ? { cut: l.cut } : {}), ...(l.echo?.length ? { echo: l.echo } : {}), ...(l.mouth?.length ? { mouth: l.mouth } : {}), ...(l.app ? { app: l.app } : {}) };
    }
    const prompt = buildContextPack(pack, text, policy.contextPack);
    const req: BrainRequest = { agent: tutor, prompt, systemBody, runtime: input.runtime ?? t.runtime, effort: policy.effort, tools, readDirs: readDirsOf(ws), session, ...(compact ? { compact: { digest: threadDigest(index.messages.filter((_, i) => known[i] === thread)) } } : {}), ...(images.length ? { images } : {}), ...(slate?.shot ? { boards: [slate.shot] } : {}) };
    const plan = this.brain.plan(req);

    // 原声:落在这轮旁边(删话题一起删);写不下就当没有,消息照发
    const started = addMessage(index, { job, thread, at: pack.at, from: input.from, text, ...(input.action ? { action: input.action } : {}), ...(photos.length ? { photos } : {}), ...(input.device ? { device: input.device } : {}), ...(input.deviceId ? { deviceId: input.deviceId } : {}), ...(input.bookkeep ? { bookkeep: input.bookkeep } : {}), ...(input.tidy ? { tidy: true as const } : {}), ...(input.replayOf ? { replayOf: input.replayOf } : {}), ...(input.eval ? { eval: true as const } : {}), ...(input.live ? { live: true as const } : {}), ...(input.via ? { via: input.via } : {}), ...(input.lecture ? { lecture: { bundle: input.lecture.bundle, title: lecture?.title ?? input.lecture.bundle, watchedMs: input.lecture.watchedMs, finished: input.lecture.finished, pauses: input.lecture.pauses, ...(input.lecture.again ? { again: true as const } : {}), ...(lecture?.video ? { video: true as const } : {}), ...(marks.length ? { marks } : {}), ...(input.lecture.log?.length ? { log: input.lecture.log } : {}) } } : {}), ...(Object.keys(notes).length ? { notes } : {}), ...(fresh && activityRun ? { activity: activityRun } : {}), ...(fresh && pageBase ? { base: pageBase } : {}), ...(fresh && actDef?.listen === 'open' ? { listen: 'open' as const } : {}), ...(compact ? { compacted: true as const } : {}), ...(lectureWarn.length || activityWarn.length ? { warnings: [...lectureWarn, ...activityWarn] } : {}), result: 'running', artifacts: [], runtime: plan.runtime });
    await writeIndex(ws, started);
    // 板的日志记一笔:这一轮把板交给了老师(下一轮「孩子做的」从这之后算;给了全文的下一轮写「未变」)
    if (slate) await appendBoard(ws, tutor, date, thread, { at: now.toISOString(), k: 'turn', job, ...(slate.told.length ? { told: slate.told } : {}) });
    // 照片上的字词:activity 写了「认字收到什么」就在后台认(和老师写讲稿同时),照片页的文字层(看题、圈字、点字)用;回放、eval 不认(要花钱)
    if (photos.length && activityRun && input.from === 'kid' && !input.replayOf && !input.eval) await this.startPhotoWords(ws, tutor, activityRun.name, photos).catch(() => undefined);
    // 运行记录:除了系统提示的来源(activity 文件)与技能,还记这轮带进上下文的每篇笔记、替老师查的每个文件,事后重建得出老师看到的是哪一版
    const notesSent = (pack.notes ?? []).map((n) => ({ role: n.role, path: n.path, hash: textHash(n.text), chars: n.text.length, ...(n.cut ? { cut: true as const } : {}) }));
    await writeRunFile(ws, tutor, date, job, { at: pack.at, prompt, plan, agentBody: true, sources: { ...(await snapshotSources(ws, threadRun ? findActivityFile(ws.root, tutor, threadRun.name) : null)), notes: notesSent, retrieved: gathered.retrieved } });

    active.job = job;
    if (input.live) active.live = true;
    // 实时的一轮讲稿是嘴念的,不按 replyMaxChars 截(截了孩子听到半句:10-20「题目已经…」后面「你补上 ēng 就行」没了)
    const runPolicy = input.live ? { ...policy, replyMaxChars: Number.MAX_SAFE_INTEGER } : policy;
    active.done = this.spawn(ws, tutor, date, job, thread, req, plan, runPolicy, active).finally(() => {
      if (this.active.get(tutor) === active) this.active.delete(tutor);
    });
    return { tutor, date, job, thread, ...(actDef?.reply === 'mouth' ? { reply: 'mouth' as const } : {}), plan, done: active.done };
  }

  /**
   * 记账(《obsidian仓库设计.md》§4 / §6):家长晚上点一次。这天索引里每个还没记过、有孩子的话或打了分的话题,各起一轮记账任务
   * (from: system、resume 那个话题的会话,消息正文是 bookkeepingPrompt),顺着跑,老师回的「## 记账」段由 settleDiary 落进日记。
   * 立刻返回排了哪些、跳过哪些;链在后台跑(flush 会等,done 也行)。老师正忙 → BusyError。
   * tidy: false 记完不整理记忆(自动记账记今天的话题时,孩子晚上可能还来,src/runtime/auto-bookkeep.ts)。
   */
  async bookkeep(tutor: string, date: string, only?: string[], opts: { tidy?: boolean } = {}): Promise<{ queued: string[]; skipped: { thread: string; why: string; oldRuntime?: string }[]; done: Promise<void> }> {
    const ws = this.getWs();
    const t = ws.config.tutors[tutor];
    if (!t) throw new UsageError(`没有叫 ${tutor} 的老师;cotutor.json 的 tutors 里有:${Object.keys(ws.config.tutors).join('、')}`);
    // 上次记到一半断了的(写完日记、没记进索引):先对照日记补记,不然这里当没记过又记一遍。老师正跑着时它的 pending 是真在写,不碰
    const read = await readIndex(ws, tutor, date);
    const recovered = this.active.get(tutor) ? { index: read, changed: false } : await recoverPending(ws, read);
    if (recovered.changed) await writeIndex(ws, recovered.index);
    const index = recovered.index;
    // 整理记忆那轮自成一个话题,不是学的东西,不记账
    const all = [...new Set(threads(index.messages).filter((_, i) => !index.messages[i].tidy))];
    const queued: string[] = [];
    const skipped: { thread: string; why: string; oldRuntime?: string }[] = [];
    const runtimeName = t.runtime ?? ws.config.runtimes.default;
    for (const th of only ?? all) {
      if (!all.includes(th)) skipped.push({ thread: th, why: `${date} 没有这个话题` });
      else if (index.booked[th]) skipped.push({ thread: th, why: `记过了(${index.booked[th]})` });
      // 换过运行时:老师接不上那时的对话,硬记就是编(2026-10-31 副本上试过,还被整理进了记忆)
      else if (!sameRuntime(index, th, runtimeName)) skipped.push({ thread: th, why: `这个话题是在「${index.sessions[th].runtime}」下聊的,老师现在用「${runtimeName}」,接不上那时的对话,不记账`, oldRuntime: index.sessions[th].runtime });
      else if (!only && !kidQuestions(index.messages, th).length && index.ratings[th] === undefined) skipped.push({ thread: th, why: '没有孩子的话也没打分' });
      else queued.push(th);
    }
    if (!queued.length) return { queued, skipped, done: Promise.resolve() };
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
      // 账记完,这位老师整理一遍自己的记忆(新会话,结果直接落盘;《obsidian仓库设计.md》§8)
      if (opts.tidy === false) return;
      try {
        const tidy = await this.tidyMemory(tutor, date);
        if (tidy) await tidy.done;
      } catch {
        /* 整理不了(老师忙 / 起不来)不影响记账;下次记账再整理 */
      }
    })();
    this.background.add(chain);
    void chain.finally(() => this.background.delete(chain));
    return { queued, skipped, done: chain };
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

  /**
   * 「## 记忆」段 → 建议与要怎么改,还不写:讲课的轮每轮最多 MEMORY_MAX_PER_TURN 条(整理轮不限);回放、eval 不写。
   * 证据对孩子在这个话题里说过的话(整理轮自成话题,对这一天的);老师写的 `孩子:` 进孩子的记忆。
   * seen = 这轮上下文包里老师看到的那两篇的版本(消息的 notes.memory / notes.child,`路径@hash`)
   */
  private async planMemoryOf(ws: Workspace, tutor: string, date: string, items: string[], asked: ConversationMessage | undefined, said: readonly string[], clip: number, owner?: { agent: string; display: string }): Promise<{ proposals: MemoryProposal[]; plan: MemoryPlan | null; child: MemoryPlan | null; warnings: string[] }> {
    if (asked?.replayOf || asked?.eval) return { proposals: [], plan: null, child: null, warnings: [asked.eval ? 'eval 不写记忆' : '回放不写记忆'] };
    const seenOf = (v: string | undefined): { path: string; hash: string; clip: number } | undefined => {
      const at = v?.lastIndexOf('@') ?? -1;
      return v && at > 0 ? { path: v.slice(0, at), hash: v.slice(at + 1), clip } : undefined;
    };
    const seen = seenOf(asked?.notes?.memory);
    const childSeen = seenOf(asked?.notes?.child);
    const shared = Boolean(ws.config.tutors[tutor]);
    return planMemory(ws, { agent: owner?.agent ?? tutor, display: owner?.display ?? ws.config.tutors[tutor]?.display ?? tutor, items, max: asked?.tidy ? null : MEMORY_MAX_PER_TURN, date, said, shared, ...(seen ? { seen } : {}), ...(childSeen ? { childSeen } : {}) });
  }

  private async spawn(ws: Workspace, tutor: string, date: string, job: string, thread: string, req: BrainRequest, plan: RunPlan, policy: Policy, active: Active): Promise<ConversationIndex> {
    const replyMaxChars = policy.replyMaxChars;
    const files = conversationFiles(ws.dirs.conversations, tutor, date);
    // 埋点:从这一轮起算,firstReadyMs = 第一句出来(嘴能开口),doneMs = 脑回完
    const t0 = Date.now();
    const timing: Timing = { startedAt: new Date(t0).toISOString() };
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
    // 讲稿不配音(嘴照念):第一句出来就能开口(记 firstReadyMs、发 ready:speak)
    let linesSeen = 0;
    const speak = (): void => {
      if (timing.firstReadyMs !== undefined) return;
      timing.firstReadyMs = since();
      emit({ lane: 'ready', kind: 'speak' });
    };
    // 流式:脑的正文变了就(节流 150ms)重解析成 partial 讲稿
    let dirty = false;
    let timer: NodeJS.Timeout | null = null;
    const reparse = (): void => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      // 先剥「## 记账」再解析,和定稿的 deriveKidView 同一条路;不剥的话固定段写在前面的那轮流式时什么都出不来(2026-09-13 控制台里看见的)
      const section = this.fitBoard(parseBoard(parseSections(brainRun.text()).body, { partial: true }).section, active).section;
      const lines = section.lines.map((l) => ({ ...l, text: truncateReply(l.text, replyMaxChars).text }));
      active.partial = lines.length || section.acts?.length ? { lines, partial: true, ...(section.acts ? { acts: section.acts } : {}) } : null;
      if (lines.length) speak();
      for (; linesSeen < lines.length; linesSeen++) emit({ lane: 'main', kind: 'line', line: linesSeen, text: lines[linesSeen].text, ...lineFlags(lines[linesSeen]) });
    };
    // 请老师(src/brain/):正文、工具随流回报
    const brainRun = this.brain.start(req, plan, { tutor, files: { log: files.log(job), err: files.err(job), history: files.brain(thread) }, stall: policy.stall }, {
      onStart: (s) => emit({ lane: 'main', kind: 'start', cli: s.cli, runtime: s.runtime, resume: s.resume }),
      onText: () => {
        dirty = true;
        if (!timer) timer = setTimeout(reparse, 150);
      },
      onTool: (tl) => emit({ lane: 'main', kind: 'tool', name: tl.name, sub: tl.sub }),
      onExit: (at) => {
        timing.doneMs = at - t0;
        if (timer) clearTimeout(timer);
      },
    });
    const { transcript, tools, warnings } = await brainRun.done;
    emit({ lane: 'main', kind: 'exit', ok: transcript.final.ok, ...(transcript.final.reason ? { reason: transcript.final.reason } : {}), ...(transcript.final.inTokens !== undefined ? { tokens: { in: transcript.final.inTokens, out: transcript.final.outTokens ?? 0 } } : {}), ...(transcript.final.numTurns !== undefined ? { turns: transcript.final.numTurns } : {}) });
    const kidView = deriveKidView(transcript, { replyMaxChars });
    kidView.warnings.push(...warnings);
    if (kidView.section) {
      // 这一轮写着的时候后台可能刚认完字:定稿前再读一遍
      if (active.lesson) active.lesson = { ...active.lesson, src: { ...active.lesson.src, photos: (await this.photoTexts(ws, active.lesson.at)).photos } };
      const fit = this.fitBoard(kidView.section, active);
      kidView.section = fit.section;
      kidView.warnings.push(...fit.why);
      // 这一节落好的动作照先后落进这节课的状态(先收上一轮的圈、划、加点,一句一句落、记念完几句,同孩子端);落的是现在的样子(这一轮写着的时候孩子可能又画了、揭了)
      if (active.lesson) {
        const acts = sectionActs(fit.section);
        await updateLesson(ws, tutor, date, thread, (l) => (l.jobs.includes(job) ? l : lessonDone(lessonSection(l, fit.section), job)));
        // 老师翻到了课本的一课:记下这本书翻到哪了(下次目录停在这一课)
        const went = [...acts].reverse().find((a): a is Extract<LessonAct, { k: '翻' }> => a.k === '翻');
        if (went?.page.kind === 'book' && went.page.title !== BOOK_TOC) await rememberBook(ws, went.page.src, went.page.title, (this.opts.now ?? (() => new Date()))());
      }
    }
    // 整块出的(没走流式):句子这时才第一次见到,也发一遍
    if (kidView.section) {
      for (; linesSeen < kidView.section.lines.length; linesSeen++) emit({ lane: 'main', kind: 'line', line: linesSeen, text: kidView.section.lines[linesSeen].text, ...lineFlags(kidView.section.lines[linesSeen]) });
    }
    if (timing.firstReadyMs === undefined && (kidView.section?.lines.length || kidView.kidText)) timing.firstReadyMs = since();
    if (kidView.section) emit({ lane: 'ready', kind: 'all', lines: kidView.section.lines.length });
    // 重新读索引再并入:跑的这段时间里别的字段(比如家长改了别的)不被旧对象盖掉
    const latest = await readIndex(ws, tutor, date);
    const jobAt = latest.messages.findIndex((m) => m.job === job);
    const run = jobAt >= 0 ? threadActivity(latest.messages, threads(latest.messages)[jobAt]) : null;
    const actFile = run ? await readActivity(ws, tutor, run.name) : null;
    let next = applyRun(latest, job, { transcript, kidView, runtime: plan.runtime, timing, tools });
    const patch = (f: (m: ConversationMessage) => ConversationMessage): void => { next = { ...next, messages: next.messages.map((m) => (m.job === job ? f(m) : m)) }; };
    const asked = latest.messages.find((m) => m.job === job);
    // 老师不直接写 vault,回的段由应用落盘;写了什么、没写成为什么都在这条的 warnings 里(家长视图看 remembered 与提醒)
    // 「## 记忆」段:每条是建议,证据对不上孩子说过的不记;其余增 / 改 / 删落进这位 agent 的记忆文件,memoryLines 留给删话题时撤
    const memory = kidView.memory.length ? await this.planMemoryOf(ws, tutor, date, kidView.memory, asked, kidSaid(latest.messages, asked?.tidy ? null : thread), policy.contextPack.entryChars, actFile && run ? { agent: `${tutor}/${run.name}`, display: `${ws.config.tutors[tutor]?.display ?? tutor}·${run.name}` } : undefined) : null;
    if (memory?.proposals.length) patch((m) => ({ ...m, memoryProposals: memory.proposals }));
    // 记账那轮:「## 记账」段 → 这个话题在日记里的一段;写进去的原文记在这轮上,删话题时从日记里摘掉(memory/vault.ts 的 undoThreadVault)
    const bookThread = asked?.bookkeep?.thread;
    const t = ws.config.tutors[tutor];
    const diary = bookThread ? planDiary({ date, index: next, thread: bookThread, bookkeeping: kidView.bookkeeping, subject: t?.subject ?? t?.display ?? tutor, keepScore: ws.config.vault.keepScore }) : null;
    const vaultWarnings = [...(memory?.warnings ?? []), ...(diary ? ('warning' in diary ? [diary.warning] : diary.notes) : [])];
    // 先在索引上记一笔 pending,再写 vault,写完换成结果(《运行层行为设计》§5):中间断了,下次记账、删话题前由 recoverPending 对照文件补
    const mp = memory?.plan;
    const cp = memory?.child;
    const db = diary && 'block' in diary && bookThread ? { file: diary.file, block: diary.block, thread: bookThread } : null;
    const pendingOf = (x: MemoryPlan): PendingMemory => ({ file: x.file, base: x.base === null ? null : textHash(x.base), hash: textHash(x.text), changes: x.changes, lines: x.lines });
    if (mp || cp || db) {
      const pending = { ...(mp ? { memory: pendingOf(mp) } : {}), ...(cp ? { child: pendingOf(cp) } : {}), ...(db ? { diary: db } : {}) };
      patch((m) => ({ ...m, pending }));
      await writeIndex(ws, next);
      patch(({ pending: _, ...m }) => m);
    }
    const remembered: string[] = [];
    for (const [x, child] of [[mp, false], [cp, true]] as [MemoryPlan | null | undefined, boolean][]) {
      if (!x) continue;
      const w = await writeVaultMemory(ws, x).catch((err: unknown) => `${child ? '孩子的记忆' : '记忆'}没写进去:${err instanceof Error ? err.message : String(err)}`);
      if (w) { vaultWarnings.push(w); continue; }
      remembered.push(...(child ? childChanges(x.changes) : x.changes));
      patch((m) => (child ? { ...m, childLines: x.lines } : { ...m, memoryLines: x.lines }));
    }
    if (remembered.length) patch((m) => ({ ...m, remembered }));
    if (db) {
      try {
        await writeDiaryBlock(ws, date, db.block);
        patch((m) => ({ ...m, diaryBlock: db.block }));
        next = { ...next, booked: { ...next.booked, [db.thread]: job } };
        emit({ lane: 'ledger', kind: 'diary', thread: db.thread, file: db.file });
      } catch (err) {
        vaultWarnings.push(`记账:日记没写进去:${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (vaultWarnings.length) patch((m) => ({ ...m, warnings: [...(m.warnings ?? []), ...vaultWarnings] }));
    await writeIndex(ws, next);
    emit({ lane: 'index', kind: 'written', warnings: next.messages.find((m) => m.job === job)?.warnings?.length ?? 0 });
    await eventsChain;
    return next;
  }
}

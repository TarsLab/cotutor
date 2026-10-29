/**
 * 发消息 = 拼上下文包 → 按运行时 spawn / resume → stream-json 落 conversations/<老师>/<日期>.<job>.log → 索引更新
 * (最终文本 → 板书节 section + 家长尾巴 parentText + 解析提醒 warnings)。
 * 流式:stdout 经本进程落盘,同时喂 PartialReader 拼当前回复正文 → parseBoard(partial) → 内存里的 partial section
 * (孩子端 pending 条目带着它,卡随围栏闭合逐张出现);讲稿不配音,交给实时的嘴照念。
 * 点读段、单词等卡的资产在索引写好之后后台配,孩子端点到还没好的段等它到,等不到就不出声。
 * 一老师同时只跑一条(老师还在回上一条就 409),跨天自动新开(索引按本地日期分文件,新文件没 session 就不带 --resume)。
 * 话题(2026-09-11):一天可多个,每个话题自己的会话(index.sessions[thread]);newThread / 系统消息 / 今天第一条开新话题(不 resume、不带旧卡),
 * 指定 thread 接着今天的旧话题(resume 它的会话),缺省接当前话题。
 * 埋点(2026-09-11):每轮记 timing(进程起的时刻、首卡、进程退出、配音收尾,毫秒),家长视图每轮一行。
 * 进程 cwd 是老师目录 agents/<name>/。
 */
import { lecturePack, readLecture, storedMarks, type IncomingMark } from './lecture.ts';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { buildContextPack } from './context/context-pack.ts';
import { addMessage, applyRun, lastJobOf, changedCards, jobId, sessionFor } from './journal/conversation.ts';
import { localDate, localMinute } from '../shared/time.ts';
import { cardId, conversationFiles, threads } from '../schema/index.ts';
import { bookkeepingPrompt, kidQuestions, textbookHeadings } from '../memory/diary.ts';
import { cardAssets, cardLabel, describeCard, tutorCardKinds } from '../board/cards/index.ts';
import { boardGuideFor, cardGuidesFor } from '../board/cards/docs.ts';
import { activityCards, parseActivity, renderTutorSection } from './activity.ts';
import { activityFile } from './activities.ts';
import { activityState, paintGate, paintTool, readActivity, threadActivity } from './activity-state.ts';
import { controlsTools, createBrain, type BrainExecutor, type BrainRequest, type Slot, type ToolSet } from '../brain/index.ts';
import { endsWithToolCall, lineFlags, parseBoard } from '../board/parse.ts';
import { readyBeats, beatsOf, type BoardSection, type Device } from '../board/presentation.ts';
import { deriveKidView, truncateReply } from './kid-view.ts';
import { parseSections } from '../board/sections.ts';
import { threadDigest } from './context/thread-digest.ts';
import { getRuntime, runtimeUses, type RunPlan, boardPreloaded } from '../brain/cli/run-plan.ts';
import { beatTimings } from './journal/events.ts';
import { type RunEvent, type RunEventEnvelope, type RunEventInput } from '../schema/index.ts';
import { BOARD_CARD_KINDS, MEMORY_MAX_PER_TURN, MEMORY_TIDY_CAP, VAULT_PACK_ROLES, isApiRuntime, resolvePolicy, type Bookkeeping, type ContextPack, type ConversationIndex, type ActivityRun, type ConversationMessage, type Focus, type MessageFrom, type MessageVia, type Policy, type Runtime, type Timing } from '../schema/index.ts';
import { UsageError } from '../shared/errors.ts';
import type { Workspace } from '../schema/index.ts';
import { readAgentBody, readCardStates, readIndex, snapshotSources, writeIndex, writeRunFile } from './journal/store.ts';
import { readTextbooks, scanVault } from '../memory/vault.ts';
import { learningContext, type PackReport } from '../memory/context.ts';
import { commitDiary, commitMemory } from '../memory/commit.ts';
import { memoryCount, textHash, tidyMemoryPrompt, type MemoryLine } from '../memory/vault-notes.ts';
import { TUTOR_RULES_PATH, takesTutorRules, tutorRulesBody, BOARD_GUIDE_IN_SYSTEM, BOARD_GUIDE_PATH, boardGuideBody, boardGuideReads } from './context/tutor-rules.ts';
import { DubQueue } from '../media/tts.ts';
import { continueContext } from './home/store.ts';
import { kidInput, type KidAccept } from './kid-input.ts';
import { dashscopeAuth } from '../realtime/bailian.ts';
import { qianwenKeys } from '../shared/qianwen.ts';
import { DRAW_ONLY_TEXT, drawingPackLine } from '../board/paper.ts';
import { makeDraw, type Draw } from '../media/draw.ts';
import { paintLines, startPaints } from '../scenes/paint/painter.ts';

export class BusyError extends Error {
  constructor(tutor: string, job: string) {
    super(`${tutor} 还在回上一条(${job}),等它说完再发`);
  }
}

export interface SendInput {
  from: MessageFrom;
  /** 从首页的 activity 按钮起的新话题(或 cotutor send --activity):哪个 activity、点的那一刻的参数;记在这条消息上,话题后面每条照它带 */
  activity?: ActivityRun;
  /** 口语课页的哪份口语单(只在话题第一条) */
  talk?: string;
  /** 带 action 时可以是空的:交给老师 → 「(交了答案,没说话)」 */
  text: string;
  focus?: Focus;
  /** 孩子端的动作:继续 / 交给老师(把改过的卡交出去) */
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
  /** 这轮是记账后整理记忆(2026-09-18):新会话,「## 记忆」段不受每轮条数上限,孩子端看不到 */
  tidy?: boolean;
  /** 这条带的作业照片(相对 workspace 根,已由路由验过在 captures/ 里;R5):进上下文包 photos: 段,老师自己 Read 看图;文字可以空 */
  photos?: string[];
  /** 孩子从左栏的纸交的画(路由已验过图在 captures/、摘要按纸上的笔迹算好):图与清掉的那几版排在照片后面进 photos:,上下文包 drawing: 一句;消息记 drawing */
  drawing?: NonNullable<ConversationMessage['drawing']>;
  /** 这条是回放(app/replay.ts):原轮的 job,记进消息;调用方已经把 Runner 指到 evals/ */
  replayOf?: string;
  /** cotutor activity eval 跑的一轮:不写记忆、不预热(画照画,画家由 eval 换成假的) */
  eval?: true;
  /** 孩子看完小课堂后的第一条:上下文包带 lecture:(课的每句、看的情况、画过的几处),消息记 lecture;again = 问过以后再看一遍又画了 */
  lecture?: { bundle: string; watchedMs: number; finished: boolean; pauses: number; again?: boolean; marks?: IncomingMark[]; log?: { t: number; pos: number; play: boolean }[] };
  /** 孩子从首页哪个按钮进来的,记进消息 */
  via?: MessageVia;
  /** 按钮的字与家长备好的讲法(服务端从发布件查的),进上下文包 home: 段 */
  home?: { button: string; brief?: string };
  /** 这一轮走实时:讲稿不配音(拍关就就绪)、交给嘴照念;消息记 live,上下文包带 live:(嘴接住时说的、上一轮念到第几句被打断;口语课的摸底、打电话几分钟、应用起的这一轮) */
  live?: NonNullable<ContextPack['live']>;
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
  /** 这一轮走实时:讲稿不配音 */
  live?: boolean;
}

export type { PackReport } from '../memory/context.ts';

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
 * 上下文包的取材(《obsidian仓库设计.md》§7 每轮那行,2026-09-17 改):课程表命中的时段 + 老师守则(有脸的老师)+ 当前学期 + 档案与入口文件的原文(按 entryChars 截)
 * + 参考路径 + 本周计划里本老师的行 + 最近 14 天日记里本学科的「- 观察:」行。
 * 守则与笔记原文总是带上;同一话题里没改过的由 send 换成「未变」。
 */
export async function gatherContext(ws: Workspace, tutor: string, input: { from: MessageFrom; at: Date; focus?: Focus; agent?: string; kinds?: readonly string[] }, report?: PackReport): Promise<ContextPack> {
  const t = ws.config.tutors[tutor];
  const policy = resolvePolicy(ws.config, tutor);
  const pack: ContextPack = { at: localMinute(input.at), focus: input.focus, plan: [], recent: [] };
  // vault 那几段(src/memory/context.ts):activity 话题的记忆是它自己的(agent: <老师>/<activity>);档案、入口文件、日记观察照旧共用
  const mem = await learningContext(ws, { at: input.at, agent: input.agent ?? tutor, subject: t?.subject, display: t?.display, teacher: Boolean(t) && tutor.endsWith('-tutor'), limits: { entryChars: policy.contextPack.entryChars, planLines: policy.contextPack.planLines, recent: policy.contextPack.recent } }, report);
  if (mem.slot) pack.slot = mem.slot;
  if (mem.semester) pack.semester = mem.semester;
  pack.notes = [];
  // 有脸的老师的公共守则:机器技能 cotutor-tutor 的原文,排在家长笔记前面(不截;同一话题没改过由 send 换成「未变」)
  if (takesTutorRules(tutor)) {
    try {
      pack.notes.push({ role: 'rules', path: TUTOR_RULES_PATH, text: tutorRulesBody(await readFile(join(ws.root, TUTOR_RULES_PATH), 'utf8'), input.kinds ?? tutorCardKinds(ws.config.tutors[tutor]?.cards) ?? undefined) });
      pack.rules = TUTOR_RULES_PATH;
    } catch {
      pack.rules = `缺:${TUTOR_RULES_PATH} 不在(cotutor upgrade 补),照你老师文件里的做`;
    }
  }
  pack.notes.push(...mem.notes);
  pack.profile = mem.profile;
  if (mem.entry !== undefined) pack.entry = mem.entry;
  pack.memory = mem.memory;
  if (mem.refs) pack.refs = mem.refs;
  pack.plan = mem.plan;
  pack.recent = mem.recent;
  pack.vault = vaultPack(ws.paths);
  return pack;
}

/**
 * activity 的那两段:`activity:`(名字、参数、应用算的)每条都带;
 * 「老师怎么带」那节(按参数与这个话题的卡裁过、剥了注释)+ 这个 activity 多带的卡的写法,作为一条笔记放进话题第一条(<cotutor-activity>),
 * 续话题没改过写「未变」(同守则)。文件不在、读不了 → activityGuide 写「缺」,老师照自己的文件做。返回给这轮的提醒。
 */
export async function attachActivity(ws: Workspace, tutor: string, pack: ContextPack, run: ActivityRun, where: { date: string; messages: readonly ConversationMessage[]; thread: string; now: number }, inSystem = false): Promise<string[]> {
  pack.activity = { name: run.name, params: run.params, state: {} };
  const path = relative(ws.root, activityFile(ws.root, tutor, run.name)).split(sep).join('/');
  const text = await readFile(join(ws.root, path), 'utf8').catch(() => null);
  if (text === null) {
    pack.activityGuide = `缺:${path} 不在,照你老师文件里的做`;
    return [`activity ${run.name}:${path} 不在,老师没拿到「老师怎么带」`];
  }
  const a = parseActivity(text).activity;
  pack.activity.state = await activityState(ws, tutor, where.date, where.messages, where.thread, run, a, where.now);
  // activity 已经是这个会话的系统提示:不再在第一条里带原文
  if (inSystem) {
    pack.activityGuide = ACTIVITY_IN_SYSTEM;
    return [];
  }
  const mine = tutorCardKinds(ws.config.tutors[tutor]?.cards);
  const cards = activityCards(a, mine ?? undefined);
  const body = renderTutorSection(a, { params: run.params, cards });
  if (body === null) return [];
  // 这个 activity 要用、老师的板书写法里没有的卡:写法跟在后面(不动系统提示)
  const extra = mine ? a.cards.filter((k) => !mine.includes(k)) : [];
  const notes = pack.notes ?? [];
  const at = Math.max(notes.findIndex((n) => n.role === 'boardGuide'), notes.findIndex((n) => n.role === 'rules'));
  notes.splice(at + 1, 0, { role: 'activityGuide', path, text: extra.length ? `${body}\n\n## 这个 activity 多用的卡\n\n${cardGuidesFor(extra)}` : body });
  pack.notes = notes;
  pack.activityGuide = path;
  return [];
}

/** 按老师裁的板书写法落在哪(相对 workspace 根;机器文件,内容变了文件名跟着变) */
export const TUTOR_BOARD_DIR = '.cotutor/board';

/** activity 在系统提示里时,上下文包 activityGuide 那一行 */
export const ACTIVITY_IN_SYSTEM = '已在你的系统提示里(这个话题的 activity,照它带)';

/**
 * activity 话题的系统提示(九点五):不读老师文件,人设与做法都是 activity 自己的。
 *   body   「老师怎么带」按参数与这个话题的卡裁好、剥了注释
 *   kinds  这个话题的卡:activity 头上的 cards 加 text(不并老师的)
 *   guide  只讲这几种卡的板书写法,写到 .cotutor/board/
 *   memory 这个 activity 自己的记忆:agent: <老师>/<activity>,文件名 <老师显示名>·<activity>
 * activity 文件不在、没有「老师怎么带」→ null(退回老师文件)。
 */
export interface ActivityParts {
  body: string;
  kinds: string[];
  guide: { body: string; path: string };
  memory: { agent: string; display: string };
}

export async function activityParts(ws: Workspace, tutor: string, run: ActivityRun): Promise<ActivityParts | null> {
  const a = await readActivity(ws, tutor, run.name);
  if (!a?.tutor) return null;
  const kinds = [...new Set(['text', ...a.cards.filter((k) => (BOARD_CARD_KINDS as readonly string[]).includes(k))])];
  const body = renderTutorSection(a, { params: run.params, cards: kinds }) ?? '';
  const guideBody = boardGuideFor(kinds);
  const guide = { body: guideBody, path: `${TUTOR_BOARD_DIR}/${tutor}-${textHash(guideBody).slice(0, 8)}.md` };
  const display = ws.config.tutors[tutor]?.display ?? tutor;
  await writeIfChanged(join(ws.root, guide.path), guideBody);
  return { body, kinds, guide, memory: { agent: `${tutor}/${run.name}`, display: `${display}·${run.name}` } };
}

async function writeIfChanged(file: string, text: string): Promise<void> {
  if ((await readFile(file, 'utf8').catch(() => null)) === text) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

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

/** 回复停在写成正文的工具调用上(后面只剩空行;「## 」尾巴不算):交给脑,CLI 据此 resume 一次 */
const stuckOnTool = (text: string): boolean => endsWithToolCall(parseSections(text).body);

/**
 * 老师正文({agentBody})与系统提示({systemBody} = 正文 + 板书写法)、板书写法的文件({boardFile}):模板用到才读。send 与预热同一份,预热起的进程 argv 才对得上。
 * 顺手把板书写法挂到上下文包上(attachBoardGuide)。没递板书写法(工具人、板书关了)的 {boardFile} 照旧是出厂的 SKILL.md。
 */
async function systemParts(ws: Workspace, tutor: string, runtime: Runtime, policy: Policy, pack: ContextPack, act: ActivityParts | null = null): Promise<{ agentBody?: string; systemBody?: string; boardFile: string; agent: string; activityInSystem: boolean }> {
  const wantsSystemBody = runtimeUses(runtime, '{systemBody}');
  // activity 话题:系统提示换成 activity 的(Qwen 走 {systemBody});模板没有它就退回老师文件 + 第一条带原文
  if (act && takesTutorRules(tutor) && wantsSystemBody) {
    const boardOff = policy.board === 'off';
    if (!boardOff) pack.boardGuide = BOARD_GUIDE_IN_SYSTEM;
    const systemBody = boardOff ? act.body : `${act.body}\n\n${act.guide.body}`;
    return { agentBody: act.body, systemBody, boardFile: join(ws.root, boardOff ? BOARD_GUIDE_PATH : act.guide.path), agent: tutor, activityInSystem: true };
  }
  const agentBody = runtimeUses(runtime, '{agentBody}') || wantsSystemBody ? await readAgentBody(ws, tutor) : undefined;
  const guide = await attachBoardGuide(ws, tutor, pack, { preloaded: boardPreloaded(runtime), boardOff: policy.board === 'off' });
  const systemBody = wantsSystemBody && agentBody !== undefined ? (guide ? `${agentBody}\n\n${guide.body}` : agentBody) : undefined;
  return { agentBody, systemBody, boardFile: join(ws.root, guide?.path ?? BOARD_GUIDE_PATH), agent: tutor, activityInSystem: false };
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

/** 老师该读得到的目录:workspace 根(作业照片、技能)与 vault(教材、日记);会话 cwd 是老师目录,这些在它外面(qwen 读外面要先划进来) */
export function readDirsOf(ws: Workspace): string[] {
  return [...new Set([ws.root, ws.paths.vault])];
}

/** 干跑:现在给这位老师发这句话,上下文包会是什么样、每段从哪来、截了多少;不起模型、不写盘 */
export async function packDryRun(ws: Workspace, tutor: string, input: { from: MessageFrom; at: Date; text: string; activity?: ActivityRun }): Promise<{ prompt: string; pack: ContextPack; report: PackReport }> {
  const t = ws.config.tutors[tutor];
  if (!t) throw new UsageError(`没有叫 ${tutor} 的老师;cotutor.json 的 tutors 里有:${Object.keys(ws.config.tutors).join('、')}`);
  const report = {} as PackReport;
  const act = input.activity ? await activityParts(ws, tutor, input.activity) : null;
  const pack = await gatherContext(ws, tutor, { from: input.from, at: input.at, ...(act ? { agent: act.memory.agent, kinds: act.kinds } : {}) }, report);
  const policy = resolvePolicy(ws.config, tutor);
  if (policy.board === 'off') pack.board = 'off';
  const { runtime } = getRuntime(ws.config, t.runtime);
  // 和 send 同一条规矩:孩子的话不带工具时,只有工具才用得上的路径不进包
  if (policy.tools !== 'on' && input.from === 'kid' && controlsTools(runtime)) { delete pack.refs; delete pack.vault; }
  const parts = await systemParts(ws, tutor, runtime, policy, pack, act);
  if (input.activity) await attachActivity(ws, tutor, pack, input.activity, { date: localDate(input.at), messages: [], thread: '', now: input.at.getTime() }, parts.activityInSystem);
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
  private readonly opts: { now?: () => Date; env?: NodeJS.ProcessEnv; warmIdleMs?: number; warm?: boolean; draw?: Draw };
  private readonly listeners = new Set<(e: RunEventEnvelope) => void>();
  /** noteEvent 每个事件文件一条追加链 */
  private readonly notes = new Map<string, Promise<void>>();
  /** 脑执行:起老师、读输出、断流接着跑、预热下一轮(src/brain/) */
  readonly brain: BrainExecutor;
  /** 预热池的旧入口(测试看有没有、杀掉);迁完删 */
  get spares(): { has(tutor: string, slot?: Slot): boolean; drop(tutor: string, slot?: Slot): void } {
    return { has: (tutor, slot) => this.brain.warmed(tutor, slot), drop: (tutor, slot) => this.brain.dropWarm(tutor, slot) };
  }
  /** 页面拉今天时的预热:每位老师(与带的话题)上次看的时刻 */
  private readonly prewarmedAt = new Map<string, number>();
  /** 起子进程用的环境(测试注入) */
  get env(): NodeJS.ProcessEnv | undefined {
    return this.opts.env;
  }
  /** 当前的 workspace(cotutor.json 热重载后是新的;实时老师经它拿) */
  get ws(): Workspace {
    return this.getWs();
  }
  /** 画图卡交给谁画(测试与 mock 注入假的) */
  readonly draw: Draw;
  constructor(getWs: () => Workspace, opts: { now?: () => Date; env?: NodeJS.ProcessEnv; warmIdleMs?: number; warm?: boolean; draw?: Draw } = {}) {
    this.getWs = getWs;
    this.opts = opts;
    this.draw = opts.draw ?? makeDraw({ env: opts.env });
    // API 运行时的凭证与实时那边同一条查找链(家长端配的在最前);只有按量 key、没有业务空间 id 也能用(走公网域名,同 qwen)。
    // COTUTOR_BRAIN_ENDPOINT:测试与探针指到假百炼
    const env = opts.env ?? process.env;
    this.brain = createBrain({ workspace: () => { const ws = this.getWs(); return { config: ws.config, root: ws.root }; }, env: opts.env, warmIdleMs: opts.warmIdleMs, auth: () => dashscopeAuth(env) ?? (qianwenKeys(env).payg ? { key: qianwenKeys(env).payg!, workspaceId: null } : null), endpoint: env.COTUTOR_BRAIN_ENDPOINT || undefined });
  }

  /** 孩子端发一条的验与拼(HTTP 与实时老师共用,./kid-input.ts):拼成 send 的入参,或回 reject;不起老师 */
  accept(tutor: string, body: unknown, date: string, deviceId?: string | null): Promise<KidAccept> {
    return kidInput(this.getWs(), tutor, body, date, deviceId);
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

  /** 杀掉所有预热的进程(测试收尾;服务退出时它们的 stdin 断了会自己退) */
  close(): void {
    this.brain.close();
  }

  /**
   * 预热:给这位老师起好下一轮的进程,两个位置都补齐——
   * fresh:新开会话(新话题、接着上次都用它);
   * resume:接 thread(页面选着的话题;不给或今天没有 = 当天末条所在的话题,和 send 缺省一样)的会话,它没有会话就不留。
   * 只给有脸的、开着的、运行时 stdin: "stream-json"、这会儿没在跑的老师起;throttleMs 内同一话题看过就不再看(页面轮询今天)。
   * 起了返回 true;起不了不报错,下一轮冷起。warm: false(cotutor send:跑完就退,留着备用进程会把它挂一小时)不起。
   */
  async prewarm(tutor: string, opts: { throttleMs?: number; thread?: string } = {}): Promise<boolean> {
    if (this.opts.warm === false) return false;
    const t0 = Date.now();
    const seen = `${tutor}\n${opts.thread ?? ''}`;
    if (opts.throttleMs && t0 - (this.prewarmedAt.get(seen) ?? -Infinity) < opts.throttleMs) return false;
    this.prewarmedAt.set(seen, t0);
    const ws = this.getWs();
    const t = ws.config.tutors[tutor];
    if (!t?.enabled || !takesTutorRules(tutor) || this.active.has(tutor)) return false;
    const { runtime } = getRuntime(ws.config, t.runtime);
    if (!this.brain.canWarm(runtime)) return false;
    const date = localDate((this.opts.now ?? (() => new Date()))());
    const index = await readIndex(ws, tutor, date);
    const known = threads(index.messages);
    const thread = opts.thread && known.includes(opts.thread) ? opts.thread : known.at(-1);
    const session = thread ? sessionFor(index, thread) : null;
    const policy = resolvePolicy(ws.config, tutor);
    const parts = await systemParts(ws, tutor, runtime, policy, { at: '', plan: [], recent: [] });
    const base = { prompt: '', runtime: t.runtime, effort: policy.effort, tools: policy.tools === 'on' ? ('on' as const) : ('off' as const), readDirs: readDirsOf(ws) };
    // 预热的是孩子的下一句:工具照孩子那轮填(带照片的对不上,那轮冷起)。新话题照老师文件;接着的话题是 activity 的,照它的系统提示
    const fresh = this.brain.plan({ ...base, ...parts, session: null });
    const run = thread ? threadActivity(index.messages, thread) : null;
    const act = run ? await activityParts(ws, tutor, run) : null;
    const resumeParts = act ? await systemParts(ws, tutor, runtime, policy, { at: '', plan: [], recent: [] }, act) : parts;
    const resume = session ? this.brain.plan({ ...base, ...resumeParts, session }) : null;
    const cwd = join(ws.dirs.agents, tutor);
    await mkdir(cwd, { recursive: true });
    // 读索引这会儿孩子可能已经开口了:这轮在跑就不起(它收尾时会再起)
    if (this.active.has(tutor)) return false;
    await this.brain.prepare(fresh);
    if (this.active.has(tutor)) return false;
    this.brain.warm(tutor, 'fresh', fresh, { cwd, date, lastJob: null });
    if (resume?.resume && thread) this.brain.warm(tutor, 'resume', resume, { cwd, date, lastJob: lastJobOf(index, thread) });
    else this.brain.dropWarm(tutor, 'resume');
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
    // 小课堂画的一处带一张截图:和照片一样进上下文包 photos:(排在孩子拍的后面),这一轮带工具读图;消息的 photos 只记孩子拍的
    const shots = input.lecture?.marks?.flatMap((m) => (m.image ? [m.image] : [])) ?? [];
    // 纸上交的画:那张画与清空前存的那几版也给老师 Read,排在照片与小课堂截图后面
    const drawn = input.drawing ? [input.drawing.image, ...(input.drawing.cleared ?? [])] : [];
    const seen = [...photos, ...shots, ...drawn];
    const text = input.text.trim() || (input.action === 'submit' ? '(交了答案,没说话)' : photos.length ? (photos.length === 1 ? '(拍了一张)' : `(拍了 ${photos.length} 张)`) : input.drawing ? DRAW_ONLY_TEXT : '');
    if (!text) throw new UsageError('消息是空的');
    const busy = this.active.get(tutor);
    if (busy) throw new BusyError(tutor, busy.job);
    const now = (this.opts.now ?? (() => new Date()))();
    const date = input.date ?? localDate(now);
    // 占位要在第一个 await 之前(2026-10-17):查完 busy 到 spawn 之间十几个 await,孩子连点两下两条都过检查、算出同一个 job、起两个进程。
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
    const fresh = thread === job;
    const session = fresh ? null : sessionFor(index, thread);
    const { runtime } = getRuntime(ws.config, input.runtime ?? t.runtime);
    // 长话题整段压缩(API 运行时):之前的模型历史不再发,前情照索引拼;这一轮笔记带全文,不写「未变」(原文所在的那几轮不发了)
    const compact = !fresh && isApiRuntime(runtime) && dueCompact(index.messages, known, thread);
    // activity:新话题照这条带的,续话题照话题第一条记的。系统提示、卡、记忆都是它的(记账轮也是,接着同一个会话);上下文包的 activity 段记账轮不带
    // 隔天「接着」是新话题:没带 activity 就沿用被接的那个话题的(参数也是那时的),不然退回老师文件,没有那套做法和卡
    const threadRun = fresh ? (input.activity ?? (input.continues ? threadActivity((await readIndex(ws, tutor, input.continues.date)).messages, input.continues.thread) : null)) : threadActivity(index.messages, thread);
    const act = threadRun ? await activityParts(ws, tutor, threadRun) : null;
    const gathered = await gatherContext(ws, tutor, { from: input.from, at: now, focus: input.focus, ...(act ? { agent: act.memory.agent, kinds: act.kinds } : {}) });
    const policy = resolvePolicy(ws.config, tutor);
    const { agentBody, systemBody, boardFile, agent, activityInSystem } = await systemParts(ws, tutor, runtime, policy, gathered, act);
    const activityRun = input.bookkeep ? null : threadRun;
    const activityWarn = activityRun ? await attachActivity(ws, tutor, gathered, activityRun, { date, messages: index.messages, thread, now: now.getTime() }, activityInSystem) : [];
    // 家长笔记原文:新会话整篇带;续会话时这个话题带过、没改的只写「未变」
    const notes = noteVersions(gathered);
    const pack = session && !compact ? dropSeenNotes(gathered, seenNotes(index.messages, thread)) : gathered;
    const noteWarnings = pack.entry?.startsWith('缺:') && !input.bookkeep ? [`入口文件${pack.entry}——在 vault 里给这位老师建一篇(cotutor doctor 有写法)`] : [];
    if (policy.board === 'off') pack.board = 'off';
    // 这个话题里上一轮之后孩子在卡上做的事:逐张 describe 进上下文包,也记进这条消息(家长视图「孩子在板书上做的」);新话题不带
    // 画板交上来的图(状态里是相对 workspace 根的路径):包里那行换成绝对路径(Read 只认绝对路径,老师的 cwd 在 agents/<名>/),消息里照旧记相对的
    const changed = fresh || input.bookkeep ? [] : changedCards(index, await readCardStates(ws, tutor, date), thread);
    let drawings = 0;
    const cards: { card: string; text: string; pack?: string }[] = await Promise.all(changed.map(async (c) => {
      const card = index.messages.find((m) => m.job === c.job)?.section?.cards[c.n];
      const id = cardId(c.job, c.n);
      if (!card) return { card: id, text: JSON.stringify(c.file.state) };
      const st = card.kind === 'canvas' ? (c.file.state as { image?: unknown; cleared?: { image?: unknown }[] } | null) : null;
      const image = typeof st?.image === 'string' ? st.image : undefined;
      // 清空前存的那几版也是图,一样换绝对路径、一样要 Read
      const cleared = Array.isArray(st?.cleared) ? st.cleared : [];
      if (!image && !cleared.some((x) => typeof x?.image === 'string')) return { card: id, text: describeCard(card, c.file.state) };
      drawings++;
      const abs = { ...(st as object), ...(image ? { image: join(ws.root, image) } : {}), cleared: cleared.map((x) => (typeof x?.image === 'string' ? { ...x, image: join(ws.root, x.image) } : x)) };
      return { card: id, text: describeCard(card, c.file.state), pack: describeCard(card, abs) };
    }));
    // 这轮带不带工具(policy.tools,2026-10-04):孩子说的话缺省不带,只凭上下文包答;带照片的、交了画的(要 Read 看图)、
    // 系统任务带只读的(以前是整份白名单,照片里一句话就能让老师拿 Bash 读写 workspace 外);policy.tools: on 的老师总是整份。
    // 不带的那轮,只有工具才用得上的路径(refs / vault)不进包;模板管不了工具的运行时(没有 {tools} / {toolArgs}),照旧
    const tools: ToolSet = policy.tools === 'on' ? 'on' : input.from !== 'kid' || seen.length > 0 || drawings > 0 ? 'read' : 'off';
    const bare = tools === 'off' && controlsTools(runtime);
    if (bare) { delete pack.refs; delete pack.vault; }
    // 画图卡:这个话题上一节有画图卡,告诉老师画好没有(老师看不到图)
    if (!fresh && !input.bookkeep) {
      const prevAt = index.messages.map((m, i) => ({ m, th: known[i] })).reverse().find((x) => x.th === thread && x.m.result === 'ok' && x.m.section);
      if (prevAt?.m.section?.cards.some((c) => c.kind === 'paint')) for (const line of await paintLines(ws, tutor, date, prevAt.m.job, prevAt.m.section)) cards.push({ card: line.slice(0, line.indexOf(' ')), text: line.slice(line.indexOf(' ') + 1) });
    }
    if (cards.length) pack.cards = cards.map((c) => `${c.card} ${c.pack ?? c.text}`);
    if (seen.length) { pack.photos = seen; pack.photoFiles = seen.map((p) => join(ws.root, p)); }
    // 纸上的画排在 photos 最后:它自己,再是清掉的那几版
    if (input.drawing) pack.drawing = drawingPackLine(input.drawing, seen.length - (input.drawing.cleared?.length ?? 0));
    if (input.home) pack.home = input.home;
    // 小课堂:课包现读;读不出来(删了、坏了)就不带,这条照发,家长端提醒
    const lecture = input.lecture ? await readLecture(ws, input.lecture.bundle) : null;
    const marks = input.lecture?.marks?.length ? storedMarks(lecture, input.lecture.marks, photos.length) : [];
    if (input.lecture && lecture) pack.lecture = lecturePack(lecture, input.lecture, marks);
    const lectureWarn = input.lecture && !lecture ? [`小课堂:${input.lecture.bundle} 读不出来(bundles/ 与 lectures/ 下都没有能放的),老师没拿到课的内容`] : [];
    const continued = input.continues && fresh ? (input.continues.pack ?? (await continueContext(ws, tutor, input.continues.date, input.continues.thread))) : null;
    if (continued) pack.continue = continued;
    if (input.live) {
      const l = input.live;
      pack.live = { ...(l.caught ? { caught: l.caught } : {}), ...(l.cut !== undefined ? { cut: l.cut } : {}), ...(l.warmup?.length ? { warmup: l.warmup } : {}), ...(l.phone !== undefined ? { phone: l.phone } : {}), ...(l.app ? { app: l.app } : {}), ...(l.draw?.length ? { draw: l.draw } : {}) };
    }
    const prompt = buildContextPack(pack, text, policy.contextPack);
    const req: BrainRequest = { agent, prompt, agentBody, systemBody, boardFile, runtime: input.runtime ?? t.runtime, effort: policy.effort, tools, readDirs: readDirsOf(ws), session, ...(compact ? { compact: { digest: threadDigest(index.messages.filter((_, i) => known[i] === thread)) } } : {}), ...(pack.photoFiles?.length ? { images: pack.photoFiles } : {}), stuckOnTool };
    const plan = this.brain.plan(req);

    // 原声:落在这轮旁边(删话题一起删);写不下就当没有,消息照发
    const started = addMessage(index, { job, thread, at: pack.at, from: input.from, text, focus: input.focus, ...(input.action ? { action: input.action } : {}), ...(cards.length ? { cards: cards.map(({ card, text }) => ({ card, text })) } : {}), ...(photos.length ? { photos } : {}), ...(input.drawing ? { drawing: input.drawing } : {}), ...(input.device ? { device: input.device } : {}), ...(input.deviceId ? { deviceId: input.deviceId } : {}), ...(input.bookkeep ? { bookkeep: input.bookkeep } : {}), ...(input.tidy ? { tidy: true as const } : {}), ...(input.replayOf ? { replayOf: input.replayOf } : {}), ...(input.eval ? { eval: true as const } : {}), ...(input.live ? { live: true as const } : {}), ...(input.via ? { via: input.via } : {}), ...(continued && input.continues ? { continues: { date: input.continues.date, thread: input.continues.thread } } : {}), ...(input.lecture ? { lecture: { bundle: input.lecture.bundle, title: lecture?.title ?? input.lecture.bundle, watchedMs: input.lecture.watchedMs, finished: input.lecture.finished, pauses: input.lecture.pauses, ...(input.lecture.again ? { again: true as const } : {}), ...(lecture?.video ? { video: true as const } : {}), ...(marks.length ? { marks } : {}), ...(input.lecture.log?.length ? { log: input.lecture.log } : {}) } } : {}), ...(Object.keys(notes).length ? { notes } : {}), ...(fresh && activityRun ? { activity: activityRun } : {}), ...(fresh && input.talk ? { talk: input.talk } : {}), ...(compact ? { compacted: true as const } : {}), ...(noteWarnings.length || lectureWarn.length || activityWarn.length ? { warnings: [...noteWarnings, ...lectureWarn, ...activityWarn] } : {}), result: 'running', artifacts: [], runtime: plan.runtime });
    await writeIndex(ws, started);
    await writeRunFile(ws, tutor, date, job, { at: pack.at, prompt, plan, agentBody: agentBody !== undefined, sources: await snapshotSources(ws, tutor) });
    // 这个 CLI 在 workspace 里要的机器文件(qwen 的隔离家目录):备不好这轮照起,起不来的原因会在 err.log
    await this.brain.prepare(plan);

    active.job = job;
    if (input.live) active.live = true;
    // 实时的一轮讲稿是嘴念的,不按 replyMaxChars 截(截了孩子听到半句:10-20「题目已经…」后面「你补上 ēng 就行」没了)
    const runPolicy = input.live ? { ...policy, replyMaxChars: Number.MAX_SAFE_INTEGER } : policy;
    // 预热的进程按这个话题末条 job 对(新开记 null);spawn 在同一拍里接过来
    const lastJob = plan.resume ? lastJobOf(index, thread) : null;
    active.done = this.spawn(ws, tutor, date, job, thread, req, plan, runPolicy, active, lastJob).finally(() => {
      if (this.active.get(tutor) === active) this.active.delete(tutor);
      // 孩子 / 家长这轮完了,马上起好下一轮的进程;系统轮(记账、整理记忆)之后孩子多半不在,不起
      if (input.from !== 'system' && !input.replayOf && !input.eval) void this.prewarm(tutor).catch(() => {});
    });
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
      // 账记完,这位老师整理一遍自己的记忆(新会话,结果直接落盘;《obsidian仓库设计.md》§8)
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
  private async settleMemory(ws: Workspace, tutor: string, date: string, items: string[], max: number | null, owner?: { agent: string; display: string }): Promise<{ changes: string[]; lines: MemoryLine[]; warnings: string[] }> {
    return commitMemory(ws, { agent: owner?.agent ?? tutor, display: owner?.display ?? ws.config.tutors[tutor]?.display ?? tutor, items, max, date });
  }

  /** 记账那轮收尾:「## 记账」段 → 这个话题在日记里的一段(打分不够只留孩子问与观察)→ 追加到 vault 的日记,索引记 booked */
  private async settleDiary(ws: Workspace, tutor: string, date: string, job: string, index: ConversationIndex, thread: string, b: Bookkeeping | null): Promise<{ index: ConversationIndex; file: string | null; warnings: string[] }> {
    const t = ws.config.tutors[tutor];
    const r = await commitDiary(ws, { date, index, thread, bookkeeping: b, subject: t?.subject ?? t?.display ?? tutor, keepScore: ws.config.vault.keepScore });
    if ('warning' in r) return { index, file: null, warnings: [r.warning] };
    // 写进去的那段原文记在这轮上:删这个话题时从日记里摘掉(memory/vault.ts 的 undoThreadVault)
    const messages = index.messages.map((m) => (m.job === job ? { ...m, diaryBlock: r.block } : m));
    return { index: { ...index, messages, booked: { ...index.booked, [thread]: job } }, file: r.file, warnings: [] };
  }

  private async spawn(ws: Workspace, tutor: string, date: string, job: string, thread: string, req: BrainRequest, plan: RunPlan, policy: Policy, active: Active, lastJob: string | null): Promise<ConversationIndex> {
    const replyMaxChars = policy.replyMaxChars;
    const files = conversationFiles(ws.dirs.conversations, tutor, date);
    // 埋点:从这一轮起算,首卡 = partial 板书第一次有卡(孩子端第一次看到东西),done = 进程退出,dubbed = 配音收尾
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
    // 讲稿不配音(嘴照念):拍关就就绪;卡自己的声音(点读段、单词)照配
    const cardVoice = ws.config.tutors[tutor]?.voice;
    const queue = cardVoice ? new DubQueue(ws.config.tts, cardVoice, files.err(job), this.opts.env) : null;
    if (queue) queue.report = (e) => emit(e.kind === 'queued' ? { lane: 'tts', kind: 'queued', label: e.label } : e.kind === 'done' ? { lane: 'tts', kind: 'done', label: e.label, ms: e.ms, file: e.file ?? '' } : { lane: 'tts', kind: 'failed', label: e.label, ms: e.ms, error: e.error ?? '?' });
    let cardsSeen = 0;
    let linesSeen = 0;
    // 就绪(流式):重算前几拍就绪(卡等它),涨了发 ready:beat;第一拍就绪记 firstReadyMs、发 ready:speak(嘴能开口了)
    let readySeen = 0;
    const speak = (): void => {
      if (timing.firstReadyMs !== undefined) return;
      timing.firstReadyMs = since();
      emit({ lane: 'ready', kind: 'speak' });
    };
    const settleReady = (): void => {
      if (!active.partial) return;
      const n = readyBeats(active.partial, { done: false });
      if (n <= readySeen) return;
      const beats = beatsOf(active.partial);
      for (; readySeen < n; readySeen++) {
        speak();
        emit({ lane: 'ready', kind: 'beat', beat: readySeen, card: beats[readySeen]?.card ?? null, first: readySeen === 0 });
      }
      active.partial = { ...active.partial, ready: n };
    };
    // 流式:脑的正文变了就(节流 150ms)重解析成 partial 板书
    let dirty = false;
    let timer: NodeJS.Timeout | null = null;
    const reparse = (): void => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      // 先剥「## 记账」再解析,和定稿的 deriveKidView 同一条路;不剥的话固定段写在前面的那轮流式时一张卡都出不来(2026-09-13 控制台里看见的)
      const { section } = parseBoard(parseSections(brainRun.text()).body, { partial: true });
      const lines = section.lines.map((l) => ({ ...l, text: truncateReply(l.text, replyMaxChars).text, audio: null }));
      active.partial = section.cards.length || lines.length ? { cards: section.cards, lines, partial: true, ready: readySeen } : null;
      if (section.cards.length && timing.firstCardMs === undefined) timing.firstCardMs = since();
      for (; cardsSeen < section.cards.length; cardsSeen++) emit({ lane: 'main', kind: 'card', card: cardsSeen, label: `${section.cards[cardsSeen].kind} ${cardLabel(section.cards[cardsSeen])}`.trim() });
      for (; linesSeen < lines.length; linesSeen++) emit({ lane: 'main', kind: 'line', line: linesSeen, text: lines[linesSeen].text, ...lineFlags(lines[linesSeen], section.cards) });
      settleReady();
    };
    // 起老师(src/brain/):预热的进程在这一拍里接过来(send 查完 busy 到这里之间没有 await);正文、工具、断流随流回报
    const brainRun = this.brain.start(req, plan, { tutor, key: { cwd: join(ws.dirs.agents, tutor), date, lastJob }, files: { log: files.log(job), err: files.err(job), history: files.brain(thread) }, stall: policy.stall }, {
      onStart: (s) => emit({ lane: 'main', kind: 'start', cli: s.cli, runtime: s.runtime, resume: s.resume, ...(s.warmBornAt !== undefined ? { warmMs: t0 - s.warmBornAt } : {}) }),
      onText: () => {
        dirty = true;
        if (!timer) timer = setTimeout(reparse, 150);
      },
      onTool: (tl) => emit({ lane: 'main', kind: 'tool', name: tl.name, sub: tl.sub }),
      onStall: (s) => emit({ lane: 'main', kind: 'stall', idleMs: s.idleMs, retry: s.retry, kept: s.kept }),
      onExit: (at) => {
        timing.doneMs = at - t0;
        if (timer) clearTimeout(timer);
      },
    });
    if (brainRun.warm) timing.warm = true;
    const { transcript, tools, warnings } = await brainRun.done;
    emit({ lane: 'main', kind: 'exit', ok: transcript.final.ok, ...(transcript.final.reason ? { reason: transcript.final.reason } : {}), ...(transcript.final.inTokens !== undefined ? { tokens: { in: transcript.final.inTokens, out: transcript.final.outTokens ?? 0 } } : {}), ...(transcript.final.numTurns !== undefined ? { turns: transcript.final.numTurns } : {}) });
    const kidView = deriveKidView(transcript, { replyMaxChars }, { live: active.live });
    kidView.warnings.push(...warnings);
    // 整块出的(没走流式):卡与句这时才第一次见到,也发一遍
    if (kidView.section) {
      for (; cardsSeen < kidView.section.cards.length; cardsSeen++) emit({ lane: 'main', kind: 'card', card: cardsSeen, label: `${kidView.section.cards[cardsSeen].kind} ${cardLabel(kidView.section.cards[cardsSeen])}`.trim() });
      for (; linesSeen < kidView.section.lines.length; linesSeen++) emit({ lane: 'main', kind: 'line', line: linesSeen, text: kidView.section.lines[linesSeen].text, ...lineFlags(kidView.section.lines[linesSeen], kidView.section.cards) });
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
    // activity 话题的卡是 activity 自己的(加 text);别的话题照老师的清单
    const jobAt = latest.messages.findIndex((m) => m.job === job);
    const run = jobAt >= 0 ? threadActivity(latest.messages, threads(latest.messages)[jobAt]) : null;
    const actFile = run ? await readActivity(ws, tutor, run.name) : null;
    const kinds = actFile ? ['text', ...actFile.cards] : tutorCardKinds(ws.config.tutors[tutor]?.cards);
    const outside = kinds && kidView.section ? [...new Set(kidView.section.cards.map((c) => c.kind).filter((k) => !kinds.includes(k)))] : [];
    if (outside.length) kidView.warnings.push(actFile ? `板书里有这个 activity 清单外的卡:${outside.join('、')}(照常显示;要它就加进 agents/${tutor}/activities/${run!.name}.md 头上的 cards)` : `板书里有清单外的卡:${outside.join('、')}(照常显示;要它就加进 cotutor.json tutors.${tutor}.cards)`);
    let next = applyRun(latest, job, { transcript, kidView, runtime: plan.runtime, timing, tools });
    // 「## 记忆」段:增 / 改 / 删落进 vault 里这位 agent 的记忆文件(回放不写;整理轮不限条数;家长视图看 remembered 与提醒;memoryLines 留给删话题时撤)
    if (kidView.memory.length) {
      const asked = latest.messages.find((m) => m.job === job);
      const r = asked?.replayOf || asked?.eval ? { changes: [] as string[], lines: [] as MemoryLine[], warnings: [asked.eval ? 'eval 不写记忆' : '回放不写记忆'] } : await this.settleMemory(ws, tutor, date, kidView.memory, asked?.tidy ? null : MEMORY_MAX_PER_TURN, actFile && run ? { agent: `${tutor}/${run.name}`, display: `${ws.config.tutors[tutor]?.display ?? tutor}·${run.name}` } : undefined);
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
    // 画图卡:后台画,一张一张排着;回放不画
    if (kidView.section?.cards.some((c) => c.kind === 'paint')) {
      const clock = (): number => (this.opts.now?.() ?? new Date()).getTime();
      const gate = await paintGate(ws, tutor, date, job, clock).catch(() => null);
      const painter = await paintTool(ws, tutor, date, job).catch(() => null);
      const bg = startPaints(ws, tutor, date, job, kidView.section, { draw: this.draw, now: this.opts.now, replay: Boolean(latest.messages.find((m) => m.job === job)?.replayOf), ...(gate ? { gate } : {}), painter });
      this.background.add(bg);
      void bg.finally(() => this.background.delete(bg));
    }
    return next;
  }
}

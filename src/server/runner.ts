/**
 * 发消息 = 拼上下文包 → 按运行时 spawn / resume → stream-json 落 conversations/<老师>/<日期>.<job>.log → 索引更新
 * (最终文本 → 板书节 section + 讲稿逐句配音 <日期>.<job>.<n>.mp3 + 家长尾巴 parentText + 解析提醒 warnings)。
 * 流式:stdout 经本进程落盘,同时喂 PartialReader 拼当前回复正文 → parseBoard(partial) → 内存里的 partial section
 * (孩子端 pending 条目带着它,卡随围栏闭合逐张出现);讲稿每定稿一句就开始配音,整轮跑完只等没配完的;
 * 点读段等资产在索引写好之后后台接着配(同一条队列),孩子端点到还没好的段用浏览器的声。
 * 板书里有新课包的场景卡就自动起 scene-maker 的一轮(from: system,作业单 = 谁放的卡、课包 id、题面与讲法、讲稿、孩子的话、照片、voice):
 * scene-maker 不在 / 关着 / 忙 / 到了 dailyMax 都不起,原因进这条消息的 warnings;起了记 scenes。它用自己的 runtime(cotutor.json tutors.scene-maker.runtime)。
 * 一老师同时只跑一条(老师还在回上一条就 409),跨天自动新开(索引按本地日期分文件,新文件没 session 就不带 --resume)。
 * 话题(2026-09-11):一天可多个,每个话题自己的会话(index.sessions[thread]);newThread / 系统消息 / 今天第一条开新话题(不 resume、不带旧卡),
 * 指定 thread 接着今天的旧话题(resume 它的会话),缺省接当前话题。
 * 埋点(2026-09-11):每轮记 timing(进程起的时刻、首卡、进程退出、配音收尾,毫秒),家长视图每轮一行;scene-maker 那轮收尾
 * 把课包的费用与时长追加进 artifacts.jsonl(老师自己只记 ready / retired 那行;它忘了记就由应用补一整行),消息的 artifacts 记课包 id。
 * 进程 cwd 是老师目录 agents/<name>/(《agent层设计.md》拍板)。
 */
import { spawn } from 'node:child_process';
import { closeSync, createWriteStream, existsSync, openSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { buildContextPack } from '../lib/context-pack.ts';
import { addMessage, applyRun, cardId, changedCards, conversationFiles, jobId, localDate, localMinute, sessionFor, threads } from '../lib/conversation.ts';
import { mergeArtifacts, parseArtifactEvents } from '../lib/ledger.ts';
import { appendDiary, bookkeepingPrompt, diaryTopic, entryFor, extractObservations, kidQuestions, recentDiaryDates, renderDiaryBlock, textbookHeadings } from '../lib/diary.ts';
import { BUNDLE_ID_RE, cardAssets, cardLabel, describeCard } from '../cards/index.ts';
import { parseBoard } from '../lib/board.ts';
import { readyBeats, beatsOf, isAskCard, type BoardSection, type Device } from '../lib/kid-board.ts';
import { deriveKidView, truncateReply } from '../lib/kid-view.ts';
import { createPartialReader } from '../lib/stream.ts';
import { parseSections } from '../lib/sections.ts';
import { isoWeek, parsePlan, planLinesFor } from '../lib/plan.ts';
import { getRuntime, planRun, runtimeUses, type RunPlan, boardPreloaded } from '../lib/run-plan.ts';
import { currentSlot, parseTimetable, slotLabel } from '../lib/timetable.ts';
import { parseTranscript, toolCalls, toolSummary } from '../lib/transcript.ts';
import { beatTimings, type RunEvent, type RunEventEnvelope, type RunEventInput } from '../lib/events.ts';
import { MEMORY_MAX_PER_TURN, MEMORY_TIDY_CAP, VAULT_PACK_ROLES, resolvePolicy, type ArtifactEvent, type Bookkeeping, type ContextPack, type ConversationIndex, type ConversationMessage, type Focus, type MessageFrom, type MessageVia, type Policy, type Timing } from '../schema/index.ts';
import { DEFAULT_DEVICE, assemblePost, postEnv, runBeatPost, writePostFile, type PostBeatFile, type PostEnv } from './post.ts';
import { validateBeatPost, type BeatPostOutput } from '../lib/postprocess.ts';
import type { Transcript } from '../lib/transcript.ts';
import { UsageError, type Workspace } from '../cli/workspace.ts';
import { updateVaultMemory, readAgentBody, readCardStates, readDiaries, readIndex, readTextbooks, scanVault, snapshotSources, writeDiary, writeIndex, writeRunFile } from './store.ts';
import { clipNote, memoryCount, missingEntry, pickNotes, textHash, tidyMemoryPrompt } from '../lib/vault-notes.ts';
import { TUTOR_RULES_PATH, takesTutorRules, tutorRulesBody, BOARD_GUIDE_IN_SYSTEM, BOARD_GUIDE_PATH, boardGuideBody, boardGuideReads } from '../lib/tutor-rules.ts';
import { DubQueue, LineDubber } from './tts.ts';
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
  /** 孩子端是什么端(板书后期按它排版);缺省当平板横屏 */
  device?: Device;
  /** 记到哪一天的索引(缺省今天);记账给昨天的话题用 */
  date?: string;
  /** 这轮是记账任务(《obsidian仓库设计.md》§6):resume 那个话题的会话,老师回「## 记账」段,应用写日记 */
  bookkeep?: { thread: string };
  /** 这轮是记账后整理记忆(2026-09-18):新会话,「## 记忆」段不受每轮条数上限,孩子端看不到 */
  tidy?: boolean;
  /** 这条带的作业照片(相对 workspace 根,已由路由验过在 captures/ 里;R5):进上下文包 photos: 段,老师自己 Read 看图;文字可以空 */
  photos?: string[];
  /** 这条是回放(server/replay.ts):原轮的 job,记进消息;调用方已经把 Runner 指到 evals/ */
  replayOf?: string;
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
  const pack: ContextPack = { from: input.from, at: localMinute(input.at), focus: input.focus, plan: [], recent: [] };
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
      pack.notes.push({ role: 'rules', path: TUTOR_RULES_PATH, text: tutorRulesBody(await readFile(join(ws.root, TUTOR_RULES_PATH), 'utf8')) });
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

/**
 * 板书写法怎么递给老师(2026-09-19):有脸的老师、板书没关才带。运行时预载了 → 上下文包只写一行事实;
 * 没预载 → 原文作为一条笔记放进话题第一条(<cotutor-board>),排在守则后面,续话题没改过写「未变」。返回板书写法的正文(给 {systemBody})。
 */
export async function attachBoardGuide(ws: Workspace, tutor: string, pack: ContextPack, o: { preloaded: boolean; boardOff: boolean }): Promise<string | null> {
  if (!takesTutorRules(tutor) || o.boardOff) return null;
  let body: string;
  try {
    body = boardGuideBody(await readFile(join(ws.root, BOARD_GUIDE_PATH), 'utf8'));
  } catch {
    pack.boardGuide = `缺:${BOARD_GUIDE_PATH} 不在(cotutor upgrade 补),照你会的写`;
    return null;
  }
  if (o.preloaded) {
    pack.boardGuide = BOARD_GUIDE_IN_SYSTEM;
    return body;
  }
  pack.boardGuide = BOARD_GUIDE_PATH;
  const notes = pack.notes ?? [];
  const at = notes.findIndex((n) => n.role === 'rules');
  notes.splice(at + 1, 0, { role: 'boardGuide', path: BOARD_GUIDE_PATH, text: body });
  pack.notes = notes;
  return body;
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
  await attachBoardGuide(ws, tutor, pack, { preloaded: boardPreloaded(getRuntime(ws.config, t.runtime).runtime), boardOff: policy.board === 'off' });
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

/** 画图老师:场景卡的课包由它做 */
const SCENE_MAKER = 'scene-maker';

export class Runner {
  private readonly active = new Map<string, Active>();
  /** 还在后台跑的资产生成(测试与关服前 flush) */
  private readonly background = new Set<Promise<void>>();
  private readonly getWs: () => Workspace;
  private readonly opts: { now?: () => Date; env?: NodeJS.ProcessEnv };
  private readonly listeners = new Set<(e: RunEventEnvelope) => void>();
  /** 起子进程用的环境(测试注入;repost 用同一份) */
  get env(): NodeJS.ProcessEnv | undefined {
    return this.opts.env;
  }
  constructor(getWs: () => Workspace, opts: { now?: () => Date; env?: NodeJS.ProcessEnv } = {}) {
    this.getWs = getWs;
    this.opts = opts;
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
    const wantsSystemBody = runtimeUses(runtime, '{systemBody}');
    const agentBody = runtimeUses(runtime, '{agentBody}') || wantsSystemBody ? await readAgentBody(ws, tutor) : undefined;
    const gathered = await gatherContext(ws, tutor, { from: input.from, at: now, focus: input.focus });
    const policy = resolvePolicy(ws.config, tutor);
    const preloaded = boardPreloaded(runtime);
    const boardBody = await attachBoardGuide(ws, tutor, gathered, { preloaded, boardOff: policy.board === 'off' });
    const systemBody = wantsSystemBody && agentBody !== undefined ? (boardBody ? `${agentBody}\n\n${boardBody}` : agentBody) : undefined;
    // 家长笔记原文:新会话整篇带;续会话时这个话题带过、没改的只写「未变」
    const notes = noteVersions(gathered);
    const pack = session ? dropSeenNotes(gathered, seenNotes(index.messages, thread)) : gathered;
    const noteWarnings = pack.entry?.startsWith('缺:') && !input.bookkeep ? [`入口文件${pack.entry}——在 vault 里给这位老师建一篇(cotutor doctor 有写法)`] : [];
    if (policy.board === 'off') pack.board = 'off';
    // 这个话题里上一轮之后孩子在卡上做的事:逐张 describe 进上下文包,也记进这条消息(家长视图「孩子在板书上做的」);新话题不带
    const cards = fresh || input.bookkeep ? [] : changedCards(index, await readCardStates(ws, tutor, date), thread).map((c) => {
      const card = index.messages.find((m) => m.job === c.job)?.section?.cards[c.n];
      const id = cardId(c.job, c.n);
      return { card: id, text: card ? describeCard(card, c.file.state) : JSON.stringify(c.file.state) };
    });
    if (cards.length) pack.cards = cards.map((c) => `${c.card} ${c.text}`);
    if (photos.length) { pack.photos = photos; pack.photoFiles = photos.map((p) => join(ws.root, p)); }
    if (input.home) pack.home = input.home;
    const continued = input.continues && fresh ? (input.continues.pack ?? (await continueContext(ws, tutor, input.continues.date, input.continues.thread))) : null;
    if (continued) pack.continue = continued;
    const prompt = buildContextPack(pack, text, policy.contextPack);
    const plan = planRun(ws.config, { session }, { agent: tutor, prompt, agentBody, systemBody, boardFile: join(ws.root, BOARD_GUIDE_PATH), runtime: input.runtime ?? t.runtime, effort: policy.effort });

    const started = addMessage(index, { job, thread, at: pack.at, from: input.from, text, focus: input.focus, ...(input.action ? { action: input.action } : {}), ...(cards.length ? { cards } : {}), ...(photos.length ? { photos } : {}), ...(input.device ? { device: input.device } : {}), ...(input.bookkeep ? { bookkeep: input.bookkeep } : {}), ...(input.tidy ? { tidy: true as const } : {}), ...(input.replayOf ? { replayOf: input.replayOf } : {}), ...(input.via ? { via: input.via } : {}), ...(continued && input.continues ? { continues: { date: input.continues.date, thread: input.continues.thread } } : {}), ...(Object.keys(notes).length ? { notes } : {}), ...(noteWarnings.length ? { warnings: noteWarnings } : {}), result: 'running', artifacts: [], runtime: plan.runtime });
    await writeIndex(ws, started);
    await writeRunFile(ws, tutor, date, job, { at: pack.at, prompt, plan, agentBody: agentBody !== undefined, sources: await snapshotSources(ws, tutor) });

    const active: Active = { job, date, partial: null, done: Promise.resolve(started) };
    active.done = this.spawn(ws, tutor, date, job, plan, policy, input.device ?? DEFAULT_DEVICE, active).finally(() => this.active.delete(tutor));
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
  private async settleMemory(ws: Workspace, tutor: string, date: string, items: string[], max: number | null): Promise<{ changes: string[]; warnings: string[] }> {
    const warnings: string[] = [];
    if (max !== null && items.length > max) warnings.push(`记忆:一轮最多记 ${max} 条,丢了 ${items.length - max} 条:${items.slice(max).join(';')}`);
    try {
      const r = await updateVaultMemory(ws, tutor, ws.config.tutors[tutor]?.display ?? tutor, max === null ? items : items.slice(0, max), date);
      return { changes: r.changes, warnings: [...warnings, ...r.warnings] };
    } catch (err) {
      return { changes: [], warnings: [...warnings, `记忆没写进去:${err instanceof Error ? err.message : String(err)}`] };
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
    return { index: { ...index, booked: { ...index.booked, [thread]: job } }, file, warnings: [] };
  }

  /**
   * 场景卡起画图作业:这节里每张 scene 卡,课包还没有(scenes/ 与 bundles/ 里都没这个 id)就起 scene-maker 的一轮(from: system)。
   * 已经有了:卡上没写题面 = 老师在放做好的课包,不起;写了题面 = 起名撞了(真跑见过:孩子卡上放了旧课包),改成 <id>-2、-3…,卡上一起改。
   * scene-maker 不在 / 关着 / 忙 / 今天到了 dailyMax / 这轮是回放,都不起,原因进 warnings。目标老师用自己的 runtime。
   */
  private async startScenes(ws: Workspace, from: string, job: string, section: BoardSection, asked: ConversationMessage | undefined): Promise<{ section: BoardSection; scenes: { bundle: string; job: string | null; why?: string }[]; warnings: string[] }> {
    const warnings: string[] = [];
    const scenes: { bundle: string; job: string | null; why?: string }[] = [];
    const taken = (x: string): boolean => existsSync(join(ws.dirs.scenes, `${x}.ts`)) || existsSync(join(ws.dirs.scenes, `${x}.md`)) || existsSync(join(ws.dirs.bundles, x));
    const cards = [...section.cards];
    for (let n = 0; n < cards.length; n++) {
      const c = cards[n];
      if (c.kind !== 'scene' || typeof c.props.bundle !== 'string') continue;
      let id = c.props.bundle;
      const brief = typeof c.props.brief === 'string' ? c.props.brief : '';
      if (taken(id)) {
        if (!brief) continue;
        let k = 2;
        while (taken(`${id}-${k}`)) k++;
        warnings.push(`课包 id ${id} 已占用,改成 ${id}-${k}(卡上一起改)`);
        id = `${id}-${k}`;
        cards[n] = { ...c, props: { ...c.props, bundle: id } };
      }
      const skip = (why: string): void => {
        scenes.push({ bundle: id, job: null, why });
        warnings.push(`画图作业 ${id} 没起:${why}`);
      };
      const target = ws.config.tutors[SCENE_MAKER];
      if (asked?.replayOf) { skip('回放不起画图作业'); continue; }
      if (!target || !target.enabled) { skip(`${SCENE_MAKER} ${target ? '关着' : '不在 cotutor.json 里'}`); continue; }
      const policy = resolvePolicy(ws.config, SCENE_MAKER);
      const today = await readIndex(ws, SCENE_MAKER, localDate((this.opts.now ?? (() => new Date()))()));
      if (today.messages.length >= policy.scenes.dailyMax) { skip(`今天已到上限 ${policy.scenes.dailyMax}(policy scenes.dailyMax)`); continue; }
      if (!brief) warnings.push(`场景卡 ${id} 没写「题面:」「讲法:」,画图老师只能看讲稿猜`);
      try {
        const lines = section.lines.map((l) => l.text);
        const r = await this.send(SCENE_MAKER, { from: 'system', text: Runner.sceneText(ws, from, job, id, brief, lines, asked?.text ?? ''), ...(asked?.photos?.length ? { photos: asked.photos } : {}) });
        scenes.push({ bundle: id, job: r.job });
      } catch (err) {
        skip(err instanceof Error ? err.message : String(err));
      }
    }
    return { section: { ...section, cards }, scenes, warnings };
  }

  /** 画图作业单:scene-maker 看到的那条消息(from: system) */
  static sceneText(ws: Workspace, from: string, job: string, bundle: string, brief: string, lines: readonly string[], kidText: string): string {
    const t = ws.config.tutors[from];
    const out = [`场景作业(${t?.display ?? from} ${from} 的 job ${job} 放的场景卡):`, `课包: ${bundle}`];
    if (brief) out.push(brief);
    if (lines.length) out.push(`老师这节的讲稿:${lines.join(' / ')}`);
    if (kidText.trim()) out.push(`孩子刚才说的:${kidText.trim()}`);
    if (t?.voice) out.push(`voice: ${t.voice}`);
    return out.join('\n');
  }

  /** 作业单里的课包 id(「课包: <id>」那行);没有就从收尾那句「课包 x 做好了 / 没做成」取 */
  static sceneJobId(jobText: string, finalText: string | null): string | null {
    const line = /^课包[:：]\s*(\S+)\s*$/m.exec(jobText)?.[1];
    return (line && BUNDLE_ID_RE.test(line) ? line : null) ?? /课包\s+(\S+?)\s*(?:做好了|没做成)/.exec(finalText ?? '')?.[1] ?? null;
  }

  /**
   * scene-maker 那轮收尾:往 artifacts.jsonl 追加这个课包的 costUsd / durationMs(一行,同 id 后者为准,老师文件那行不用改)。
   * 老师忘了记账(账本里没这个 id)就由应用补一整行:bundles/<id>/manifest.json 在 → ready,不在 → retired。
   */
  private async settleSceneLedger(ws: Workspace, tutor: string, date: string, job: string, jobText: string, transcript: Transcript, timing: Timing): Promise<{ id: string | null; warnings: string[] }> {
    const id = Runner.sceneJobId(jobText, transcript.final?.text ?? null);
    if (!id) return { id: null, warnings: ['作业单没有课包 id,收尾那句也没写「课包 x 做好了」,这轮的费用没记进账本'] };
    const warnings: string[] = [];
    const known = mergeArtifacts(parseArtifactEvents(await readFile(ws.files.artifacts, 'utf8').catch(() => '')).rows).artifacts.some((a) => a.id === id);
    const row: ArtifactEvent = { id, at: new Date().toISOString(), source: { conversation: `${tutor}/${date}`, job }, ...(transcript.final?.costUsd !== undefined ? { costUsd: transcript.final.costUsd } : {}), ...(timing.doneMs !== undefined ? { durationMs: timing.doneMs } : {}) };
    if (!known) {
      const ready = existsSync(join(ws.dirs.bundles, id, 'manifest.json'));
      Object.assign(row, { kind: '课包', by: tutor, status: ready ? 'ready' : 'retired', ...(ready ? { path: `bundles/${id}` } : {}) });
      warnings.push(`画图老师没往账本记 ${id},应用补了一行(${ready ? 'ready' : 'retired:bundles/' + id + '/manifest.json 不在'})`);
    }
    try {
      await mkdir(ws.dirs.ledger, { recursive: true });
      await appendFile(ws.files.artifacts, `${JSON.stringify(row)}\n`);
    } catch (err) {
      warnings.push(`账本写不进:${err instanceof Error ? err.message : String(err)}`);
    }
    return { id, warnings };
  }

  private async spawn(ws: Workspace, tutor: string, date: string, job: string, plan: RunPlan, policy: Policy, device: Device, active: Active): Promise<ConversationIndex> {
    const replyMaxChars = policy.replyMaxChars;
    const files = conversationFiles(ws.dirs.conversations, tutor, date);
    const cwd = join(ws.dirs.agents, tutor);
    await mkdir(cwd, { recursive: true });
    const out = createWriteStream(files.log(job));
    const err = openSync(files.err(job), 'w');
    // 埋点:从进程起来那一刻算,首卡 = partial 板书第一次有卡(孩子端第一次看到东西),done = 进程退出,dubbed = 配音收尾
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
    emit({ lane: 'main', kind: 'start', cli: plan.argv[0].slice(plan.argv[0].lastIndexOf('/') + 1), runtime: plan.runtime, resume: plan.resume });
    const voice = ws.config.tutors[tutor]?.voice;
    const queue = voice ? new DubQueue(ws.config.tts, voice, files.err(job), this.opts.env) : null;
    if (queue) queue.report = (e) => emit(e.kind === 'queued' ? { lane: 'tts', kind: 'queued', label: e.label } : e.kind === 'done' ? { lane: 'tts', kind: 'done', label: e.label, ms: e.ms, file: e.file ?? '' } : { lane: 'tts', kind: 'failed', label: e.label, ms: e.ms, error: e.error ?? '?' });
    const dubber = queue ? new LineDubber(queue, (n) => files.lineAudio(job, n)) : null;
    // 工具调用:stdout 的 assistant 事件里有 tool_use 就发一条(子代理的标 sub);只对含 tool_use 的行 JSON.parse
    let toolBuf = '';
    const scanTools = (chunk: string): void => {
      toolBuf += chunk;
      const parts = toolBuf.split('\n');
      toolBuf = parts.pop() ?? '';
      for (const line of parts) {
        if (!line.includes('"tool_use"')) continue;
        try {
          const e = JSON.parse(line) as { type?: string; parent_tool_use_id?: string | null; message?: { content?: { type?: string; name?: string; input?: Record<string, unknown> }[] } };
          if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
          for (const b of e.message.content) if (b.type === 'tool_use' && b.name) emit({ lane: 'main', kind: 'tool', name: toolSummary(b.name, b.input), sub: Boolean(e.parent_tool_use_id) });
        } catch {
          /* 不是一行完整 JSON:跳过 */
        }
      }
    };
    let cardsSeen = 0;
    let linesSeen = 0;
    // 板书后期按拍(2026-09-13):拍关了(后面有下一张卡)就起一次快模型;提案校验后记进 decisions,partial 每次重建都重新套一遍;
    // 回了 / 失败了都算 settled(失败 = 这拍素版),就绪要等它;老师写完后没起过的拍再补起,全部按卡的顺序套到定稿的节上
    const postOn = policy.post.mode !== 'off';
    let envP: Promise<PostEnv> | null = null;
    const getEnv = (): Promise<PostEnv> => (envP ??= postEnv(ws, tutor, { device, policy }));
    const beatPosts = new Map<number, Promise<PostBeatFile>>();
    const decisions = new Map<number, BeatPostOutput>();
    const settledCards = new Set<number>();
    let postT0: number | null = null;
    const applyDecisions = (section: BoardSection, env: PostEnv | null): BoardSection => {
      if (!env || !decisions.size) return section;
      let cur = section;
      for (const b of beatsOf(cur)) {
        const out = b.card === null ? undefined : decisions.get(b.card);
        if (out) cur = validateBeatPost(cur, b, env.theme, env.device, out).section;
      }
      return cur;
    };
    let envNow: PostEnv | null = null;
    const startBeatPost = (section: BoardSection, beat: { card: number | null; lines: number[] }, k: number): void => {
      if (beat.card === null || beatPosts.has(beat.card)) return;
      // 提问卡不过后期:字就是末句那句话,样子是机械规则定的,省一趟
      if (section.cards[beat.card] && isAskCard(section.cards[beat.card])) return;
      const card = beat.card;
      postT0 ??= Date.now();
      emit({ lane: 'post', kind: 'start', beat: k, card, context: Math.min(card, 5) });
      const p = getEnv().then((env) => { envNow = env; return runBeatPost(ws, tutor, section, beat, env, { device, policy, env: this.opts.env, cwd }); }).then((r) => {
        if (r.file.ok && r.file.output) decisions.set(card, r.file.output);
        settledCards.add(card);
        if (r.file.ok && r.file.kept) emit({ lane: 'post', kind: 'done', beat: k, ms: r.file.ms, kept: r.file.kept, dropped: r.file.dropped.length, ...(r.file.costUsd !== undefined ? { costUsd: r.file.costUsd } : {}) });
        else emit({ lane: 'post', kind: 'failed', beat: k, ms: r.file.ms, error: r.file.error ?? '?' });
        if (active.partial) { active.partial = { ...applyDecisions(active.partial, envNow), partial: true, ready: active.partial.ready }; settleReady(); }
        return r.file;
      });
      beatPosts.set(card, p);
    };
    // 拍的就绪(流式):每句配音落盘就填进 partial 的 audio,重算前几拍就绪(后期开着的还要等这拍的后期回);涨了发 ready:beat,第一拍记 firstReadyMs
    const lineAudio = new Map<number, string>();
    let readySeen = 0;
    const settleReady = (): void => {
      if (!active.partial) return;
      const n = readyBeats(active.partial, { voiced: Boolean(voice), done: false, settled: (_k, b) => b.card === null || !postOn || settledCards.has(b.card) });
      if (n <= readySeen) return;
      const beats = beatsOf(active.partial);
      for (; readySeen < n; readySeen++) {
        if (timing.firstReadyMs === undefined) timing.firstReadyMs = since();
        emit({ lane: 'ready', kind: 'beat', beat: readySeen, card: beats[readySeen]?.card ?? null, first: readySeen === 0 });
      }
      active.partial = { ...active.partial, ready: n };
    };
    // 流式:stdout 的每一块先落盘再喂读取器;正文变了就(节流 150ms)重解析成 partial 板书,定稿的句子交去配音
    const reader = createPartialReader();
    let dirty = false;
    let timer: NodeJS.Timeout | null = null;
    const reparse = (): void => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      // 先剥「## 记账」再解析,和定稿的 deriveKidView 同一条路;不剥的话固定段写在前面的那轮流式时一张卡都出不来(2026-09-13 控制台里看见的)
      const { section } = parseBoard(parseSections(reader.text()).body, { partial: true });
      const lines = section.lines.map((l, i) => ({ ...l, text: truncateReply(l.text, replyMaxChars).text, audio: lineAudio.get(i) ?? null }));
      active.partial = section.cards.length || lines.length ? { ...applyDecisions({ cards: section.cards, lines }, envNow), partial: true, ready: readySeen } : null;
      if (postOn && active.partial) { const bs = beatsOf(active.partial); bs.forEach((b, k) => { if (k < bs.length - 1) startBeatPost(active.partial!, b, k); }); }
      if (section.cards.length && timing.firstCardMs === undefined) timing.firstCardMs = since();
      for (; cardsSeen < section.cards.length; cardsSeen++) emit({ lane: 'main', kind: 'card', card: cardsSeen, label: `${section.cards[cardsSeen].kind} ${cardLabel(section.cards[cardsSeen])}`.trim() });
      for (; linesSeen < lines.length; linesSeen++) emit({ lane: 'main', kind: 'line', line: linesSeen, text: lines[linesSeen].text });
      if (dubber) lines.forEach((l, i) => { const p = dubber.add(i, l.text); if (p) void p.then((name) => { if (name && active.partial && active.partial.lines[i]) { lineAudio.set(i, name); active.partial.lines[i].audio = name; settleReady(); } }, () => {}); });
      settleReady();
    };
    const exit = await new Promise<{ code: number | null; spawnError?: Error }>((resolveExit) => {
      const child = spawn(plan.argv[0], plan.argv.slice(1), {
        cwd,
        env: { ...(this.opts.env ?? process.env), COTUTOR_WORKSPACE: ws.root },
        stdio: ['ignore', 'pipe', err],
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        out.write(chunk);
        const s = chunk.toString('utf8');
        scanTools(s);
        if (reader.feed(s)) {
          dirty = true;
          if (!timer) timer = setTimeout(reparse, 150);
        }
      });
      child.once('error', (e) => resolveExit({ code: null, spawnError: e }));
      child.once('close', (code) => resolveExit({ code }));
    });
    timing.doneMs = since();
    if (timer) clearTimeout(timer);
    await new Promise<void>((r) => out.end(r));
    closeSync(err);
    if (exit.spawnError) await appendFile(files.err(job), `cotutor: 起不来 ${plan.argv[0]}:${exit.spawnError.message}\n`);
    const logText = await readFile(files.log(job), 'utf8').catch(() => '');
    const transcript = parseTranscript(logText);
    // 这轮用了哪些工具、读了什么:从 .log 抽出来物化(家长端「看原文」一站、cotutor show)
    const tools = toolCalls(logText).slice(0, 200);
    if (!transcript.final) {
      // 进程退了但没有 result 事件:起不来、被杀、或 CLI 崩了;标 error,原因指向 err.log
      transcript.final = { text: null, ok: false, reason: exit.spawnError ? `spawn:${exit.spawnError.message}` : `exit:${exit.code ?? 'signal'}` };
      transcript.items.push({ kind: 'done', text: `本轮没有收尾(${transcript.final.reason}),看 ${date}.${job}.err.log` });
    }
    emit({ lane: 'main', kind: 'exit', ok: transcript.final.ok, ...(transcript.final.reason ? { reason: transcript.final.reason } : {}), ...(transcript.final.costUsd !== undefined ? { costUsd: transcript.final.costUsd } : {}), ...(transcript.final.numTurns !== undefined ? { turns: transcript.final.numTurns } : {}) });
    const kidView = deriveKidView(transcript, { replyMaxChars });
    // 整块出的(没走流式):卡与句这时才第一次见到,也发一遍
    if (kidView.section) {
      for (; cardsSeen < kidView.section.cards.length; cardsSeen++) emit({ lane: 'main', kind: 'card', card: cardsSeen, label: `${kidView.section.cards[cardsSeen].kind} ${cardLabel(kidView.section.cards[cardsSeen])}`.trim() });
      for (; linesSeen < kidView.section.lines.length; linesSeen++) emit({ lane: 'main', kind: 'line', line: linesSeen, text: kidView.section.lines[linesSeen].text });
    }
    // 板书后期收尾:流式时起过的拍等它回;没起过的(最后一拍、整块出的)现在并行起;全部按卡的顺序套到定稿的节上
    let postP: Promise<{ files: PostBeatFile[]; env: PostEnv; t0: number }> | null = null;
    if (postOn && kidView.section?.cards.length) {
      const finalSection = kidView.section;
      postP = (async () => {
        const env = await getEnv();
        envNow = env;
        const bs = beatsOf(finalSection);
        bs.forEach((b, k) => startBeatPost(finalSection, b, k));
        const files = await Promise.all(bs.flatMap((b) => { const p = b.card === null ? undefined : beatPosts.get(b.card); return p ? [p] : []; }));
        return { files, env, t0: postT0 ?? Date.now() };
      })();
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
    let post: ConversationMessage['post'] | undefined;
    if (postP && kidView.section) {
      try {
        const r = await postP;
        // 按拍的顺序套到定稿的节上(行顺着长);每拍的 dropped / kept 以套到定稿节上的为准
        let cur: BoardSection = kidView.section;
        const files: PostBeatFile[] = [];
        for (const f of r.files) {
          const b = beatsOf(cur).find((x) => x.card === f.card);
          if (f.ok && f.output && b) { const v = validateBeatPost(cur, b, r.env.theme, r.env.device, f.output); cur = v.section; files.push({ ...f, dropped: v.dropped, kept: v.kept }); } else files.push(f);
        }
        const a = assemblePost(files, r.env, timing.startedAt, Date.now() - r.t0);
        if (files.some((f) => f.ok)) kidView.section = { ...cur, lines: cur.lines.map((l, i) => ({ ...l, audio: kidView.section?.lines[i]?.audio ?? null })) };
        post = a.summary;
        timing.postMs = since();
        await writePostFile(ws, tutor, date, job, a.file);
      } catch (err) {
        post = { ok: false, ms: since(), dropped: 0, error: err instanceof Error ? err.message : String(err) };
        emit({ lane: 'post', kind: 'failed', beat: -1, ms: post.ms, error: post.error ?? '?' });
      }
    }
    if (kidView.section) emit({ lane: 'ready', kind: 'all', cards: kidView.section.cards.length, lines: kidView.section.lines.length });
    if (kidView.section) timing.beats = beatTimings(events, beatsOf(kidView.section));
    // 重新读索引再并入:跑的这段时间里别的字段(比如家长改了别的)不被旧对象盖掉
    const latest = await readIndex(ws, tutor, date);
    // 板书写法已经递到手里(系统提示或话题第一条),老师还用工具去读它 → 预载没起作用,家长端这轮上点名(换模型 / CLI / 版本后最先坏的地方)
    const reread = takesTutorRules(tutor) && policy.board !== 'off' ? boardGuideReads(tools) : [];
    if (reread.length) kidView.warnings.push(`板书写法已经递给老师了,这轮它还是用工具去读了一遍(${reread.join(';')}):多一次模型来回。cotutor doctor 的 runtime.*.board 看这个运行时走的哪条递法`);
    let next = applyRun(latest, job, { transcript, kidView, runtime: plan.runtime, timing, post, tools });
    // 「## 记忆」段:增 / 改 / 删落进 vault 里这位 agent 的记忆文件(回放不写;整理轮不限条数;家长视图看 remembered 与提醒)
    if (kidView.memory.length) {
      const asked = latest.messages.find((m) => m.job === job);
      const r = asked?.replayOf ? { changes: [] as string[], warnings: ['回放不写记忆'] } : await this.settleMemory(ws, tutor, date, kidView.memory, asked?.tidy ? null : MEMORY_MAX_PER_TURN);
      if (r.changes.length || r.warnings.length) next = { ...next, messages: next.messages.map((m) => (m.job === job ? { ...m, ...(r.changes.length ? { remembered: r.changes } : {}), ...(r.warnings.length ? { warnings: [...(m.warnings ?? []), ...r.warnings] } : {}) } : m)) };
    }
    // 场景作业收尾:课包的费用与时长进账本,消息的 artifacts 记课包 id
    if (tutor === SCENE_MAKER) {
      const r = await this.settleSceneLedger(ws, tutor, date, job, latest.messages.find((m) => m.job === job)?.text ?? '', transcript, timing);
      if (r.id) emit({ lane: 'ledger', kind: 'artifact', id: r.id, status: r.warnings.length ? '补了一行' : '记了账' });
      if (r.id || r.warnings.length) next = { ...next, messages: next.messages.map((m) => (m.job === job ? { ...m, ...(r.id ? { artifacts: [r.id] } : {}), ...(r.warnings.length ? { warnings: [...(m.warnings ?? []), ...r.warnings] } : {}) } : m)) };
    }
    // 场景卡:新课包起 scene-maker 的一轮;起不了的原因记进 warnings,撞名改过的 id 回写到卡上
    if (tutor !== SCENE_MAKER && kidView.section?.cards.some((c) => c.kind === 'scene')) {
      const r = await this.startScenes(ws, tutor, job, kidView.section, latest.messages.find((m) => m.job === job));
      for (const x of r.scenes) emit(x.job ? { lane: 'scene', kind: 'started', bundle: x.bundle, job: x.job } : { lane: 'scene', kind: 'skipped', bundle: x.bundle, why: x.why ?? '?' });
      const scenes = r.scenes.map(({ bundle, job: j }) => ({ bundle, job: j }));
      if (scenes.length || r.warnings.length) next = { ...next, messages: next.messages.map((m) => (m.job === job ? { ...m, section: r.section, ...(scenes.length ? { scenes } : {}), ...(r.warnings.length ? { warnings: [...(m.warnings ?? []), ...r.warnings] } : {}) } : m)) };
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

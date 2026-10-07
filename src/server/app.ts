/**
 * 服务的路由层:route(method, path, ctx, body) → {status, json|html},测试不用起端口。
 * R1 的查询接口照旧;R2 加:对话(列日期、看一天的家长视图、发消息)、cotutor.json 补丁(老师团页)、工作台 /dev(2026-09-22 之前叫家长页 /parent;
 * 现在 /parent 是家长端 = 家长板书页,给不懂技术的家长日常用,《家长板书页设计.md》拍板 13)。
 * R3 加:孩子端 `/`(kidPage)与 /api/kid/*(首页:课程表 + 老师卡 + 家长发布的首页卡;对话:服务端过滤后的孩子视图;发消息:from 固定 kid、每日上限 429)、配音文件 /api/audio。
 * 配置热重载:每个请求先看 cotutor.json 的 mtime,改了就重读;改坏了留旧配置并把错误挂在 /api/health 上。
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { foldRuns, type TranscriptRow } from '../lib/transcript.ts';
import { RuntimeError } from '../lib/run-plan.ts';
import { PHOTO_MAX_SIDE } from '../lib/photo-edit.ts';
import { conversationFiles, currentThread, lastJobOf, localDate, threads } from '../lib/conversation.ts';
import { kidConversation, kidMessageCount, kidThreads, parentConversation, type KidMessage, type KidThread, type ParentMessage } from '../lib/kid-view.ts';
import { parseEvents, type RunEvent } from '../lib/events.ts';
import { mp3DurationMs } from '../lib/mp3.ts';
import { buildReel, playRecordOk, reelCardTook, type PlayRecord, type Reel } from '../lib/reel.ts';
import { DATE_RE, FocusSchema, HomeViaSchema, MESSAGE_FROM, listTutors, resolvePolicy, type ConversationIndex, type ConversationMessage } from '../schema/index.ts';
import type { BoardCard } from '../lib/kid-board.ts';
import { ConfigError, UsageError, redactHome, workspaceReport, type Workspace } from '../cli/workspace.ts';
import { tutorStatuses } from '../cli/tutors.ts';
import { configGapsOf, upgradeConfig } from '../cli/migrate.ts';
import { ICON_SIZES, appIconPng, webManifest } from '../lib/icon.ts';
import { qrPage, type ListenInfo } from './qr-page.ts';
import { kidPage } from './kid-page.ts';
import { kidHomeView, messageVia, resolveVia } from './home.ts';
import { DEV_PAGE } from './dev-page.ts';
import { VOICE_TEST_PAGE } from './voice-test-page.ts';
import { BusyError, Runner } from './runner.ts';
import { sendFile } from './send-file.ts';
import { IndexError, capturePathOk, deleteThread, listDates, patchConfig, rateThread, readErrLog, readIndex, readTranscript, reloadIfChanged, scanCards, writeCapture, writeCardAudio, writeCardImage, writeCardState } from './store.ts';
import { IMAGE_EXT, parseCardState, stripSecrets, type Heard, type RecordProps } from '../cards/index.ts';
import { BUNDLE_ID_RE } from '../cards/kind.ts';
import { kouboYuanOfDay, readHeard } from './koubo.ts';
import { resolve, sep } from 'node:path';
import { bundleAsset, stageAsset, stageIndex, stageVersion } from './stage.ts';
import { themeFiles } from './theme.ts';
import { enrichLectures, inspectLecture, bakeSectionSoon, ensureBaked, lectureFrameSvg, parseRing, type IncomingMark } from './lecture.ts';
import { tianzigeData } from './tianzige.ts';
import { lettersData } from './letters.ts';
import { fixtureOf, rawView } from './raw-view.ts';
import { DeviceSchema } from '../schema/index.ts';
import { listVoices, synthesize, type VoiceInfo } from './tts.ts';
import { addTutorFile, readTutorFile, removeTutorFile, writeTutorFile } from '../cli/tutors.ts';

export interface RouteResult {
  status: number;
  json?: unknown;
  html?: string;
  /** 静态文件(配音);handler 流式发 */
  file?: string;
  /** 现生成的二进制(主屏幕图标) */
  body?: Uint8Array;
  contentType?: string;
  /** file 的缓存策略;不给 = 一天(配音、课包这些不会变);头像会被 figshot 换掉,给 no-cache。json 不给 = no-store(笔顺数据例外,给一天) */
  cacheControl?: string;
}

export interface AppContext {
  ws: Workspace;
  runner: Runner;
  /** 当前时间(测试可注入;孩子端「今天」与 today 别名都按它) */
  now: () => Date;
  /** 上次重载失败的原因(配置改坏了),健康接口回报 */
  configError: string | null;
  /** 在哪个地址上听着(serve 在 listen 之后填;扫码页 /qr 每次现问——局域网 IP 会在服务跑着的时候变)。没起端口(测试走 route)→ null */
  listen: (() => ListenInfo) | null;
  /** 重读 cotutor.json(改了才读) */
  reload(): Promise<void>;
}

export function createContext(ws: Workspace, opts: { now?: () => Date; env?: NodeJS.ProcessEnv } = {}): AppContext {
  let mtime = -1;
  const ctx: AppContext = {
    ws,
    runner: new Runner(() => ctx.ws, opts),
    now: opts.now ?? (() => new Date()),
    configError: null,
    listen: null,
    async reload() {
      try {
        const r = await reloadIfChanged(ctx.ws, mtime);
        ctx.ws = r.ws;
        mtime = r.mtime;
        ctx.configError = null;
      } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        ctx.configError = err.message;
      }
    },
  };
  return ctx;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** 一天的家长视图:索引 + 每条消息的转录行(主线 + 子代理折叠)+ 出错时的 err.log 尾巴 */
export interface DayView {
  index: ConversationIndex;
  running: string | null;
  runs: Record<string, TranscriptRow[]>;
  errors: Record<string, string>;
}

export async function dayView(ctx: AppContext, tutor: string, date: string): Promise<DayView> {
  const index = await readIndex(ctx.ws, tutor, date);
  const runs: Record<string, TranscriptRow[]> = {};
  const errors: Record<string, string> = {};
  for (const m of index.messages) {
    const t = await readTranscript(ctx.ws, tutor, date, m.job);
    runs[m.job] = t ? foldRuns(t.items) : [];
    if (m.result === 'error') {
      const tail = (await readErrLog(ctx.ws, tutor, date, m.job)).trim().split('\n').slice(-5).join('\n');
      if (tail) errors[m.job] = tail;
    }
  }
  const active = ctx.runner.running(tutor);
  return { index, running: active && active.date === date ? active.job : null, runs, errors };
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** 孩子端看到的老师:enabled 且不 hidden;每日上限用完 available = false(头像灰) */
export interface KidTutor {
  name: string;
  display: string;
  avatar: string | null;
  subject: string | null;
  hasVoice: boolean;
  remaining: number;
  available: boolean;
}

export async function kidTutors(ctx: AppContext, date: string): Promise<KidTutor[]> {
  const out: KidTutor[] = [];
  for (const t of listTutors(ctx.ws.config, { kidOnly: true })) {
    const used = kidMessageCount(await readIndex(ctx.ws, t.name, date));
    const remaining = Math.max(0, t.policy.dailyMessages - used);
    out.push({ name: t.name, display: t.display, avatar: t.avatar ?? null, subject: t.subject ?? null, hasVoice: Boolean(t.voice), remaining, available: remaining > 0 });
  }
  return out;
}

export interface KidHome {
  title: string;
  date: string;
  tutors: KidTutor[];
  /** 发布的首页 id(孩子点按钮时带回来);缺省首页 / 预览 = null */
  home: string | null;
  /** 首页的卡(《首页设计.md》):老师卡在前,props.buttons 是孩子端的按钮;其余卡照文件顺序 */
  cards: BoardCard[];
  /** 「给老师们换个样子」的入口(figshot pick 在这台电脑的哪个端口);cotutor.json 没配 figshot 就是 null */
  figshot: { port: number } | null;
}

export async function kidHome(ctx: AppContext, now: Date): Promise<KidHome> {
  const ws = ctx.ws;
  const date = localDate(now);
  const view = await kidHomeView(ws, now);
  const figshot = ws.config.figshot ? { port: ws.config.figshot.port } : null;
  return { title: ws.config.title, date, tutors: await kidTutors(ctx, date), home: view.home, cards: view.cards, figshot };
}

export interface KidDay {
  tutor: string;
  date: string;
  messages: KidMessage[];
  remaining: number;
  /** 老师正在回的那条 job */
  pending: string | null;
  /** 当前话题(末条消息所在);还没说过话 → null */
  thread: string | null;
}

/** 「以前的」:最近 days 天每天的话题列表(今天也在),新的在前;没有孩子问过的话题不列 */
export interface KidHistory {
  tutor: string;
  today: string;
  days: { date: string; threads: KidThread[] }[];
}

export async function kidHistory(ctx: AppContext, tutor: string, days: number): Promise<KidHistory> {
  const today = localDate(ctx.now());
  const floor = localDate(new Date(ctx.now().getTime() - (days - 1) * 86400000));
  const dates = (await listDates(ctx.ws, tutor)).filter((d) => d >= floor && d <= today).sort().reverse();
  const out: KidHistory['days'] = [];
  for (const date of dates) {
    const index = await readIndex(ctx.ws, tutor, date);
    const list = kidThreads(kidConversation(index)).reverse();
    if (list.length) out.push({ date, threads: list });
  }
  return { tutor, today, days: out };
}

export async function kidDay(ctx: AppContext, tutor: string, date: string): Promise<KidDay> {
  const index = await readIndex(ctx.ws, tutor, date);
  const policy = resolvePolicy(ctx.ws.config, tutor);
  const active = ctx.runner.running(tutor);
  const { states, assets } = await scanCards(ctx.ws, tutor, date);
  const messages = kidConversation(index, states, assets);
  // 流式:正在回的那条带上已经出来的板书(partial),卡随围栏闭合逐张出现;答案照样剥
  const partial = active && active.date === date ? ctx.runner.partial(tutor) : null;
  if (partial) {
    const m = messages.find((x) => x.job === active!.job);
    if (m) m.section = stripSecrets(partial);
  }
  // 小课堂卡:课读不读得出、那一段的起止,每次现读
  for (const m of messages) if (m.section) { bakeSectionSoon(ctx.ws.dirs.bundles, m.section); m.section = await enrichLectures(ctx.ws, m.section); }
  const remaining = Math.max(0, policy.dailyMessages - kidMessageCount(index));
  return { tutor, date, messages, remaining, pending: active && active.date === date ? active.job : null, thread: currentThread(index) };
}

/** 家长板书页的一天(《家长板书页设计.md》§4.1):形状同 KidDay 少 remaining;答案不剥,系统发的也在 */
export interface ParentDay {
  tutor: string;
  date: string;
  messages: ParentMessage[];
  pending: string | null;
  thread: string | null;
}

export async function parentDay(ctx: AppContext, tutor: string, date: string): Promise<ParentDay> {
  const index = await readIndex(ctx.ws, tutor, date);
  const active = ctx.runner.running(tutor);
  const { states, assets } = await scanCards(ctx.ws, tutor, date);
  const messages = parentConversation(index, states, assets);
  const partial = active && active.date === date ? ctx.runner.partial(tutor) : null;
  if (partial) {
    const m = messages.find((x) => x.job === active!.job);
    if (m) m.section = partial;
  }
  for (const m of messages) if (m.section) { bakeSectionSoon(ctx.ws.dirs.bundles, m.section); m.section = await enrichLectures(ctx.ws, m.section); }
  // 录音卡:家长端旁注要评测全量(档、逐字分、花费),从录音旁边的 heard.json 读;孩子端不走这里。
  // 挂在新的卡对象上:索引有进程内缓存,改原对象判就漏到孩子端了
  for (const m of messages) {
    if (!m.section?.cards.some((c) => c.kind === 'record')) continue;
    const cards = await Promise.all(m.section.cards.map(async (c) => {
      const audio = c.kind === 'record' ? (c.state as { audio?: unknown } | undefined)?.audio : undefined;
      const heard = typeof audio === 'string' && audio ? await readHeard(join(ctx.ws.root, audio)) : null;
      return heard ? ({ ...c, heard } as BoardCard & { heard: Heard }) : c;
    }));
    m.section = { ...m.section, cards };
  }
  // 「做了」旁注带上孩子在弹窗里想了多久、改过几次(《家长录像设计.md》§4.7;有实录才有):这张卡从同一话题上一条消息到这条之间的弹窗
  const plays = await readPlays(ctx.ws, tutor, date);
  if (plays.length) {
    const th = threads(index.messages);
    const at = (m: ConversationMessage): number => Date.parse(m.timing?.startedAt ?? '') || Date.parse(m.at);
    for (const pm of messages) {
      if (!pm.cards?.length) continue;
      const i = index.messages.findIndex((x) => x.job === pm.job);
      if (i < 0) continue;
      const prev = index.messages.slice(0, i).reverse().find((_x, k) => th[i - 1 - k] === th[i]);
      const [from, to] = [prev ? at(prev) : -Infinity, at(index.messages[i])];
      pm.cards = pm.cards.map((c) => { const [job, n] = c.card.split('/'); const took = reelCardTook(plays, job, Number(n), from, to); return took ? { ...c, took } : c; });
    }
  }
  return { tutor, date, messages, pending: active && active.date === date ? active.job : null, thread: currentThread(index) };
}

/** 一天里各轮的实录(<日期>.<job>.play.jsonl;jobs 给了就只读这几轮),合在一起按时刻排;坏行丢掉 */
async function readPlays(ws: Workspace, tutor: string, date: string, jobs?: ReadonlySet<string>): Promise<PlayRecord[]> {
  const dir = join(ws.dirs.conversations, tutor);
  const out: PlayRecord[] = [];
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    const m = new RegExp(`^${date}\\.(\\d{4}-\\d+)\\.play\\.jsonl$`).exec(name);
    if (!m || (jobs && !jobs.has(m[1]))) continue;
    const text = await readFile(join(dir, name), 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line) as unknown; if (playRecordOk(r)) out.push(r); } catch { /* 坏行丢掉 */ }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** mp3 时长(毫秒)按绝对路径缓存:配好的配音不会再变;还没落盘、读不出的不缓存,下次再读 */
const mp3Ms = new Map<string, number>();
async function audioMs(file: string): Promise<number | null> {
  const hit = mp3Ms.get(file);
  if (hit !== undefined) return hit;
  const ms = await readFile(file).then((b) => mp3DurationMs(b), () => null);
  if (ms !== null) mp3Ms.set(file, ms);
  return ms;
}

/** 家长端看录像(《家长录像设计.md》):这个话题的轨道(lib/reel.ts 推算)+ 这个话题的家长条目(页面照 /board 渲染)。没有孩子开口的话题 → null */
export interface ParentReel {
  tutor: string;
  date: string;
  thread: string;
  reel: Reel;
  messages: ParentMessage[];
}
export async function parentReel(ctx: AppContext, tutor: string, date: string, thread: string): Promise<ParentReel | null> {
  const index = await readIndex(ctx.ws, tutor, date);
  const ths = threads(index.messages);
  const mine = index.messages.filter((_m, i) => ths[i] === thread);
  if (!mine.length) return null;
  const files = conversationFiles(ctx.ws.dirs.conversations, tutor, date);
  const dir = join(ctx.ws.dirs.conversations, tutor);
  const events: Record<string, RunEvent[]> = {};
  const durations: Record<string, number> = {};
  for (const m of mine) {
    const text = await readFile(files.events(m.job), 'utf8').catch(() => null);
    if (text !== null) events[m.job] = parseEvents(text);
    for (const l of m.section?.lines ?? []) {
      if (!l.audio || durations[l.audio] !== undefined) continue;
      const ms = await audioMs(join(dir, l.audio));
      if (ms !== null) durations[l.audio] = ms;
    }
  }
  const { states } = await scanCards(ctx.ws, tutor, date);
  const jobs = new Set(mine.map((m) => m.job));
  const cards = Object.fromEntries(Object.entries(states).filter(([job]) => jobs.has(job)));
  const plays = await readPlays(ctx.ws, tutor, date, jobs);
  const reel = buildReel({ messages: mine, events, cards, durations, tutor, now: ctx.now().getTime(), plays });
  if (!reel) return null;
  const day = await parentDay(ctx, tutor, date);
  return { tutor, date, thread, reel, messages: day.messages.filter((m) => m.thread === thread) };
}

/** 家长板书页的清单(《家长板书页设计.md》§2.2):这一天每位有脸的老师几轮、几个话题、停在哪 */
export interface OverviewThread {
  thread: string;
  at: string;
  /** 第一句:孩子的话截 20 字;首页按钮进来的是「首页 · 按钮字」;系统起的话题标出来 */
  title: string;
  from: ConversationMessage['from'];
  via: string | null;
  sections: number;
  cards: number;
  /** 老师还在写 / 末句问句停下等孩子 / 没停 */
  stoppedAt: 'writing' | 'ask' | null;
  rating: number | null;
  booked: boolean;
}
export interface OverviewTutor {
  name: string;
  display: string;
  avatar: string | null;
  subject: string | null;
  turns: number;
  costUsd: number;
  threads: OverviewThread[];
  /** 正在记账(记账或整理记忆的轮还在跑):家长端清单上的「记账」灰掉、行上写「记账中」 */
  booking: boolean;
  /** 这天录音卡在 koubo 上花的钱(元,heard.json 加总);没花就没有 */
  kouboYuan?: number;
}

export interface Overview {
  title: string;
  date: string;
  today: string;
  tutors: OverviewTutor[];
}

export async function overview(ctx: AppContext, date: string): Promise<Overview> {
  const tutors: OverviewTutor[] = [];
  for (const t of listTutors(ctx.ws.config, { kidOnly: true })) {
    const index = await readIndex(ctx.ws, t.name, date);
    const ths = threads(index.messages);
    const by = new Map<string, OverviewThread>();
    for (const [i, m] of index.messages.entries()) {
      if (m.bookkeep || m.tidy) continue;
      const id = ths[i];
      let th = by.get(id);
      if (!th) {
        const via = m.via?.label ?? null;
        const raw = via ? `首页 · ${via}` : m.from === 'kid' ? m.text : `系统:${m.text}`;
        th = { thread: id, at: m.at, title: Array.from(raw.trim()).slice(0, 20).join(''), from: m.from, via, sections: 0, cards: 0, stoppedAt: null, rating: index.ratings[id] ?? null, booked: id in index.booked };
        by.set(id, th);
      }
      if (m.result === 'running') th.stoppedAt = 'writing';
      else if (m.result === 'ok' && m.section && (m.section.cards.length || m.section.lines.length)) {
        th.sections++;
        th.cards += m.section.cards.length;
        const last = m.section.lines[m.section.lines.length - 1];
        th.stoppedAt = last?.ask ? 'ask' : null;
      }
    }
    const booking = index.messages.some((m) => (m.bookkeep || m.tidy) && m.result === 'running');
    const kouboYuan = await kouboYuanOfDay(join(ctx.ws.dirs.conversations, t.name), date);
    tutors.push({ name: t.name, display: t.display, avatar: t.avatar ?? null, subject: t.subject ?? null, turns: index.messages.length, costUsd: index.costUsd, threads: [...by.values()], booking, ...(kouboYuan > 0 ? { kouboYuan } : {}) });
  }
  return { title: ctx.ws.config.title, date, today: localDate(ctx.now()), tutors };
}

/**
 * 卡的状态:孩子在舞台里选了、填了 → 存 <日期>.<job>.cards/<n>.json,不起老师;下一条消息带给老师。
 * 画板:body 里可以带 image(data:image/png;base64,…),存成 .cards/<n>.png,状态里只留路径(相对 workspace 根,老师 Read 看)
 * 录音卡:body 的 audio 可以是 data:audio/…;base64,…,存成 .cards/<n>/rec-<k>.<ext>,状态里换成路径(《口播老师设计.md》§2)
 */
async function putCardState(ctx: AppContext, ws: Workspace, tutor: string, job: string, n: number, body: unknown): Promise<RouteResult> {
  const date = localDate(ctx.now());
  const index = await readIndex(ws, tutor, date);
  const msg = index.messages.find((m) => m.job === job);
  const target = msg?.result === 'ok' ? msg.section?.cards[n] : undefined;
  if (!target) return { status: 404, json: { error: 'no_such_card' } };
  let state = body;
  /** 录音卡这次带来的新录音(相对 workspace 根):存好状态后起评测 */
  let fresh: string | null = null;
  if (target.kind === 'canvas' && isObj(body) && typeof body.image === 'string') {
    const { image, ...rest } = body;
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!m || m[1].length > 8_000_000) return { status: 400, json: { error: 'bad_state' } };
    const png = await writeCardImage(ws, tutor, date, job, n, Buffer.from(m[1], 'base64'));
    state = { ...rest, image: `conversations/${tutor}/${png}` };
  }
  if (target.kind === 'record' && isObj(body) && typeof body.audio === 'string' && body.audio.startsWith('data:')) {
    const m = /^data:audio\/([a-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(body.audio);
    const ext = m ? RECORD_EXT[m[1]] : undefined;
    if (!m || !ext || m[2].length > RECORD_MAX_B64) return { status: 400, json: { error: 'bad_state' } };
    const rel = await writeCardAudio(ws, tutor, date, job, n, Buffer.from(m[2], 'base64'), ext);
    state = { ...body, audio: `conversations/${tutor}/${rel}` };
    fresh = `conversations/${tutor}/${rel}`;
  }
  const r = parseCardState(target, state);
  if (!r.ok) return { status: 400, json: { error: 'bad_state' } };
  const last = index.messages[index.messages.length - 1];
  // turn = 这张卡所在话题的末条 job:下一条发给同一话题时才算「上一轮之后改过的」
  const mine = threads(index.messages)[index.messages.findIndex((m) => m.job === job)];
  await writeCardState(ws, tutor, date, job, n, { at: ctx.now().toISOString(), turn: lastJobOf(index, mine) ?? last.job, state: r.state });
  // 录像的实录:孩子的每一次存都记一条(选了又改、填空的过程、画板一笔一笔)
  await appendFile(conversationFiles(ws.dirs.conversations, tutor, date).play(job), `${JSON.stringify({ at: ctx.now().getTime(), k: 'card', job, card: n, state: r.state })}\n`).catch(() => {});
  if (fresh && target.kind === 'record') ctx.runner.assessRecording(fresh, target.props as RecordProps);
  return { status: 200, json: { ok: true, card: `${job}/${n}`, state: r.state } };
}

/** <日期>.<job>.mp3(整段)/ .<n>.mp3(讲稿第 n 句)/ .cards/<n>/<k>.mp3(第 n 张卡的第 k 个资产) */
const AUDIO_FILE_RE = /^\d{4}-\d{2}-\d{2}\.\d{4}-\d+(?:\.\d+|\.cards\/\d+\/\d+)?\.mp3$/;
/** 录音卡的录音(回放):<日期>.<job>.cards/<n>/rec-<k>.<ext>;按住说话的原声:<日期>.<job>.voice.<ext>(《家长录像设计.md》拍板 4) */
const REC_FILE_RE = /^\d{4}-\d{2}-\d{2}\.\d{4}-\d+\.(?:cards\/\d+\/rec-\d+|voice)\.(webm|m4a|ogg|wav)$/;
const REC_TYPES: Record<string, string> = { webm: 'audio/webm', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav' };
/** 浏览器录音的 MIME 子类型 → 落盘扩展名(Safari 录 mp4/aac,Chrome 录 webm/opus) */
const RECORD_EXT: Record<string, string> = { webm: 'webm', mp4: 'm4a', 'x-m4a': 'm4a', aac: 'm4a', ogg: 'ogg', wav: 'wav', 'x-wav': 'wav' };
/** 一条录音的 base64 最多这么长(60 秒 opus 约 0.5 MB,aac 约 1 MB;留足余量) */
const RECORD_MAX_B64 = 4_000_000;
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

/** 作业照片一张最多这么大(解码后;页面先缩到长边 PHOTO_MAX_SIDE 的 jpeg,通常几百 KB) */
const PHOTO_MAX_BYTES = 3_000_000;
/** 音色页的试听句;与 tutors.*.voice 里合法的 id 形状(voxtell 的是 qwen-audio-3.0-tts-plus-xxx) */
const PREVIEW_TEXT = '你好呀,我是你的老师。今天我们一起来学一个新东西,准备好了吗?';
const VOICE_ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;
/** 音色列表按命令模板缓存(进程内):列一次要起子进程,列表本身不会变 */
const voiceCache = new Map<string, { voices: VoiceInfo[]; error: string | null }>();

/**
 * 上传作业照片(R5):body {image: "data:image/jpeg;base64,…"}(也认 png)→ 落 captures/<日期>/<HHMM>-<n>.jpg → {path}。
 * 孩子端与家长端同一条路;照片只是落盘,发消息时把 path 放进 photos[] 才到老师那里。
 */
async function uploadPhoto(ws: Workspace, body: unknown, now: Date): Promise<RouteResult> {
  if (!isObj(body) || typeof body.image !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 {image: data:image/jpeg;base64,…}' } };
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.image);
  if (!m) return { status: 400, json: { error: 'bad_request', message: '只认 data:image/jpeg 或 image/png 的 base64' } };
  const data = Buffer.from(m[2], 'base64');
  if (!data.length || data.length > PHOTO_MAX_BYTES) return { status: 413, json: { error: 'too_large', message: `一张最多 ${PHOTO_MAX_BYTES / 1_000_000} MB,页面该先缩到长边 ${PHOTO_MAX_SIDE}` } };
  const path = await writeCapture(ws, now, data, m[1] === 'png' ? 'png' : 'jpg');
  return { status: 201, json: { path } };
}

/** 消息里的 photos[]:都得是 captures/ 里在的文件(相对 workspace 根);不合法 → null */
async function photosOf(ws: Workspace, v: unknown): Promise<string[] | null | undefined> {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 9 || !v.every((p): p is string => typeof p === 'string')) return null;
  for (const p of v) if (!(await capturePathOk(ws, p))) return null;
  return v;
}

/** 按住说话的原声(《家长录像设计.md》拍板 4):{audio: data:audio/…;base64,…, seconds};形状不对、太大就当没带——不回 400,认出的字照发 */
function voiceOf(v: unknown): { data: Buffer; ext: string; seconds: number } | undefined {
  if (!isObj(v) || typeof v.audio !== 'string' || typeof v.seconds !== 'number' || !(v.seconds > 0) || v.seconds > 600) return undefined;
  const m = /^data:audio\/([a-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(v.audio);
  const ext = m ? RECORD_EXT[m[1]] : undefined;
  if (!m || !ext || m[2].length > RECORD_MAX_B64) return undefined;
  return { data: Buffer.from(m[2], 'base64'), ext, seconds: v.seconds };
}

/** 一条消息最多带几处圈、一处圈最多几个点(《小课堂设计.md》§四) */
const MAX_MARKS = 12;
const MAX_MARK_POINTS = 400;
/** 看的过程最多几条(拖进度条只记松手那一下,一堂课几十条) */
const MAX_WATCH_LOG = 500;
type WatchLog = { t: number; pos: number; play: boolean }[];

/** 孩子看完小课堂带来的(《小课堂设计.md》§七):{bundle, watchedMs, finished, pauses, marks?};没带 undefined,形状不对 null(路由回 400) */
function lectureOf(v: unknown): { bundle: string; watchedMs: number; finished: boolean; pauses: number; marks: IncomingMark[]; log: WatchLog } | null | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v) || typeof v.bundle !== 'string' || !BUNDLE_ID_RE.test(v.bundle) || typeof v.watchedMs !== 'number' || !(v.watchedMs >= 0) || v.watchedMs > 6 * 3600_000 || typeof v.finished !== 'boolean') return null;
  const pauses = v.pauses === undefined ? 0 : v.pauses;
  if (typeof pauses !== 'number' || !Number.isInteger(pauses) || pauses < 0 || pauses > 999) return null;
  const raw = v.marks === undefined ? [] : v.marks;
  if (!Array.isArray(raw) || raw.length > MAX_MARKS) return null;
  const marks: IncomingMark[] = [];
  for (const m of raw as unknown[]) {
    if (!isObj(m) || typeof m.atMs !== 'number' || !(m.atMs >= 0) || m.atMs > 6 * 3600_000 || !Array.isArray(m.path) || m.path.length < 3 || m.path.length > MAX_MARK_POINTS) return null;
    const path = (m.path as unknown[]).map((p) => (Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e5) ? [Math.round(p[0] as number), Math.round(p[1] as number)] as [number, number] : null));
    if (path.some((p) => p === null)) return null;
    // 视频的圈带一张截图(先 POST photos 拿到的 captures/ 路径;在不在由路由再查)
    if (m.image !== undefined && (typeof m.image !== 'string' || m.image.length > 200)) return null;
    // 圈下去的那一刻(离发出去多少毫秒,≤ 0;录像用)
    const t = m.t === undefined ? undefined : typeof m.t === 'number' && Number.isFinite(m.t) && m.t <= 0 && m.t > -6 * 3600_000 ? Math.round(m.t) : null;
    if (t === null) return null;
    marks.push({ atMs: Math.round(m.atMs), path: path as [number, number][], ...(typeof m.image === 'string' ? { image: m.image } : {}), ...(t !== undefined ? { t } : {}) });
  }
  // 看的过程(录像用):放 / 停 / 拖到哪,一次一条,t ≤ 0
  const rawLog = v.log === undefined ? [] : v.log;
  if (!Array.isArray(rawLog) || rawLog.length > MAX_WATCH_LOG) return null;
  const log: WatchLog = [];
  for (const e of rawLog as unknown[]) {
    if (!isObj(e) || typeof e.t !== 'number' || !Number.isFinite(e.t) || e.t > 0 || e.t < -6 * 3600_000 || typeof e.pos !== 'number' || !(e.pos >= 0) || e.pos > 6 * 3600_000 || typeof e.play !== 'boolean') return null;
    log.push({ t: Math.round(e.t), pos: Math.round(e.pos), play: e.play });
  }
  return { bundle: v.bundle, watchedMs: Math.round(v.watchedMs), finished: v.finished, pauses, marks, log };
}

/** 页面拉今天时的预热参数:?thread= 是页面选着的话题;同一话题 30 秒看一次 */
function warmOpts(url: URL): { throttleMs: number; thread?: string } {
  const thread = url.searchParams.get('thread');
  return { throttleMs: 30_000, ...(thread ? { thread } : {}) };
}

export async function route(method: string, path: string, ctx: AppContext, body?: unknown): Promise<RouteResult> {
  await ctx.reload();
  const ws = ctx.ws;
  const url = new URL(path, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/health') return { status: 200, json: { ok: true, configError: ctx.configError } };
    if (p === '/api/workspace' && method === 'GET') return { status: 200, json: workspaceReport(ws) };
    if (p === '/api/config') {
      if (method === 'GET') {
        return {
          status: 200,
          json: {
            title: ws.config.title,
            kid: ws.config.kid,
            server: ws.config.server,
            runtime: ws.config.runtimes.default,
            runtimes: Object.keys(ws.config.runtimes).filter((k) => k !== 'default'),
            policyDefaults: ws.config.policyDefaults,
            paths: ws.config.paths,
            resolvedPaths: Object.fromEntries(Object.entries(ws.paths).map(([k, v]) => [k, redactHome(v)])),
            tts: ws.config.tts,
            theme: ws.config.kid.theme,
            https: ws.config.server.https ?? null,
            shipped: (await tutorStatuses(ws.root)).map((s) => s.name),
            /** 老 workspace 的政策文件缺的出厂件(新老师 / 新运行时 / 模板里的新旗标);设置页据此提示一行 */
            migrate: await configGapsOf(ws.root),
            tutors: listTutors(ws.config),
            /** 老师条目的原始政策补丁(页面区分「继承」与「覆盖」) */
            tutorPatches: Object.fromEntries(Object.entries(ws.config.tutors).map(([k, t]) => [k, t.policy ?? {}])),
          },
        };
      }
      if (method === 'PATCH') {
        if (!isObj(body)) return { status: 400, json: { error: 'bad_request', message: '要一个 JSON 对象' } };
        await patchConfig(ws, body);
        await ctx.reload();
        return { status: 200, json: { ok: true, tutors: listTutors(ctx.ws.config), runtime: ctx.ws.config.runtimes.default } };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }
    // 政策文件补缺(与 cotutor upgrade --config 同一条路):只加缺的出厂件,家长写过的值不动
    if (p === '/api/config/migrate' && method === 'POST') {
      const r = await upgradeConfig(ws.root, { renames: false });
      await ctx.reload();
      return { status: 200, json: { ok: true, gaps: r.gaps, applied: r.applied, installed: r.installed } };
    }
    if (p === '/api/tutors' && method === 'GET') {
      return { status: 200, json: listTutors(ws.config, { kidOnly: url.searchParams.get('kid') === '1' }) };
    }
    // ---- 加老师 / 老师文件 / 删老师:与 cotutor add 同一条路 ----
    if (p === '/api/tutors' && method === 'POST') {
      if (!isObj(body) || typeof body.name !== 'string' || typeof body.display !== 'string' || !body.display.trim()) return { status: 400, json: { error: 'bad_request', message: '要 {name, display, subject?, avatar?, hidden?, description?}' } };
      const name = body.name.trim();
      if (ws.config.tutors[name]) return { status: 409, json: { error: 'exists', message: `cotutor.json 里已经有 ${name}` } };
      const str = (k: string): string | undefined => (typeof body[k] === 'string' && (body[k] as string).trim() ? (body[k] as string).trim() : undefined);
      const r = await addTutorFile(ws.root, { name, display: body.display.trim(), subject: str('subject'), description: str('description') });
      await patchConfig(ws, { tutors: { [name]: { display: body.display.trim(), ...(str('subject') ? { subject: str('subject') } : {}), ...(str('avatar') ? { avatar: str('avatar') } : {}), enabled: true, ...(body.hidden === true ? { hidden: true } : {}) } } });
      await ctx.reload();
      return { status: 201, json: { ok: true, ...r, tutors: listTutors(ctx.ws.config) } };
    }
    const tf = /^\/api\/tutors\/([a-z0-9][a-z0-9-]*)(\/file)?$/.exec(p);
    if (tf) {
      const [, name, isFile] = tf;
      if (!ws.config.tutors[name]) return { status: 404, json: { error: 'no_such_tutor', tutor: name } };
      if (isFile && method === 'GET') return { status: 200, json: await readTutorFile(ws.root, name) };
      if (isFile && method === 'PUT') {
        if (!isObj(body) || typeof body.text !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 {text}' } };
        return { status: 200, json: await writeTutorFile(ws.root, name, body.text) };
      }
      if (!isFile && method === 'DELETE') {
        const r = await removeTutorFile(ws.root, name);
        await patchConfig(ws, { tutors: { [name]: null } });
        await ctx.reload();
        return { status: 200, json: { ok: true, ...r, tutors: listTutors(ctx.ws.config) } };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }

    // ---- 孩子端:过滤在服务端做,永远不带工具 / 错误 / 评判 ----
    if (p === '/api/kid/home' && method === 'GET') return { status: 200, json: await kidHome(ctx, ctx.now()) };
    // 按住说话的诊断:识别全在浏览器里、出错静默,真机上哪一步断了只有它自己知道;只收事件码与毫秒,不收字也不收声音
    if (p === '/api/kid/voice-diag' && method === 'POST') {
      if (!isObj(body) || JSON.stringify(body).length > 4000) return { status: 400, json: { error: 'bad_request' } };
      const row = { at: ctx.now().toISOString(), ...body };
      await mkdir(join(ws.root, '.cotutor'), { recursive: true });
      await appendFile(join(ws.root, '.cotutor', 'voice-diag.jsonl'), `${JSON.stringify(row)}\n`).catch(() => {});
      return { status: 200, json: { ok: true } };
    }
    const kid =/^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|messages|history|photos|play|\d{4}-\d{2}-\d{2})$/.exec(p);
    if (kid) {
      const [, tutor, tail] = kid;
      const t = ws.config.tutors[tutor];
      if (!t || !t.enabled || t.hidden) return { status: 404, json: { error: 'no_such_tutor' } };
      const date = localDate(ctx.now());
      // 录像的实录(《家长录像设计.md》§4):孩子端每 10 秒一批 {thread, sentAt, records};时刻按 sentAt 把两边的钟差校到服务端;
      // 形状不对的、不是这个话题的、太旧太新的丢掉,卡的改动只认服务端自己记的;不回错(孩子端不报错)。记在话题当时的末条 job 上,删话题一起删
      if (tail === 'play' && method === 'POST') {
        if (!isObj(body) || typeof body.thread !== 'string' || !Array.isArray(body.records) || body.records.length > 400) return { status: 400, json: { error: 'bad_request' } };
        const index = await readIndex(ws, tutor, date);
        const ths = threads(index.messages);
        const jobs = new Set(index.messages.filter((_m, i) => ths[i] === body.thread).map((m) => m.job));
        const last = jobs.size ? lastJobOf(index, body.thread) : null;
        if (!last) return { status: 200, json: { kept: 0 } };
        const now = ctx.now().getTime();
        const skew = typeof body.sentAt === 'number' && Math.abs(now - body.sentAt) < 86_400_000 ? now - body.sentAt : 0;
        const rows: string[] = [];
        for (const x of body.records as unknown[]) {
          if (!playRecordOk(x) || x.k === 'card') continue;
          const at = Math.round(x.at + skew);
          if (at > now + 60_000 || at < now - 86_400_000) continue;
          if ((x.k === 'play' && x.job !== null && !jobs.has(x.job)) || (x.k === 'stage' && !jobs.has(x.job))) continue;
          rows.push(JSON.stringify({ ...x, at }));
        }
        if (rows.length) await appendFile(conversationFiles(ws.dirs.conversations, tutor, date).play(last), `${rows.join('\n')}\n`).catch(() => {});
        return { status: 200, json: { kept: rows.length } };
      }
      // 作业照片(R5):先传图拿 path,再连 path 一起发消息;不起老师、不计上限
      if (tail === 'photos') return method === 'POST' ? uploadPhoto(ws, body, ctx.now()) : { status: 405, json: { error: 'method_not_allowed' } };
      if (tail === 'today' && method === 'GET') {
        // 孩子点进这位老师 / 选了话题(页面轮询也走这里,同一话题 30 秒看一次):把下一轮的老师进程提前起好(《工作流程.md》§四「预热」)
        void ctx.runner.prewarm(tutor, warmOpts(url)).catch(() => {});
        return { status: 200, json: await kidDay(ctx, tutor, date) };
      }
      // 以前的某一天(只读回放;未来的日期与坏日期 400)
      if (DATE_RE.test(tail) && method === 'GET') {
        if (tail > date || Number.isNaN(Date.parse(tail))) return { status: 400, json: { error: 'bad_request' } };
        return { status: 200, json: await kidDay(ctx, tutor, tail) };
      }
      if (tail === 'history' && method === 'GET') {
        const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') ?? 30) || 30));
        return { status: 200, json: await kidHistory(ctx, tutor, days) };
      }
      if (tail === 'messages' && method === 'POST') {
        if (!isObj(body) || typeof body.text !== 'string') return { status: 400, json: { error: 'bad_request' } };
        const focus = body.focus === undefined ? undefined : FocusSchema.safeParse(body.focus);
        if (focus && !focus.success) return { status: 400, json: { error: 'bad_request' } };
        const action = body.action === undefined ? undefined : body.action === 'continue' || body.action === 'submit' ? body.action : null;
        if (action === null) return { status: 400, json: { error: 'bad_request' } };
        const photos = await photosOf(ws, body.photos);
        if (photos === null) return { status: 400, json: { error: 'bad_request' } };
        const policy = resolvePolicy(ws.config, tutor);
        // 「继续」不计每日上限:到了上限也能把老师讲完的听完
        if (action !== 'continue' && kidMessageCount(await readIndex(ws, tutor, date)) >= policy.dailyMessages) return { status: 429, json: { error: 'limit', remaining: 0 } };
        const thread = body.thread === undefined ? undefined : typeof body.thread === 'string' && /^\d{4}-\d+$/.test(body.thread) ? body.thread : null;
        if (thread === null) return { status: 400, json: { error: 'bad_request' } };
        const device = body.device === undefined ? undefined : DeviceSchema.safeParse(body.device);
        if (device && !device.success) return { status: 400, json: { error: 'bad_request' } };
        // 首页的按钮(《首页设计.md》§5.2):via 只带 id,按钮是什么、讲法是什么都从服务端的发布件查;对不上就 400(孩子端刷新首页)
        const via = body.via === undefined ? undefined : HomeViaSchema.safeParse(body.via);
        if (via && !via.success) return { status: 400, json: { error: 'bad_request' } };
        const button = via ? await resolveVia(ws, tutor, via.data!) : null;
        if (via && !button) return { status: 400, json: { error: 'bad_via' } };
        let text = body.text;
        let newThread = body.newThread === true;
        let pick = thread;
        let home: { button: string; brief?: string } | undefined;
        let continues: { date: string; thread: string } | undefined;
        // 小课堂(《小课堂设计.md》):看完才能开口——这一条要带 lecture(哪份课包、看完了、看了多久、停过几次、圈过的几处),字是孩子说的;新开话题。
        // 问过以后「再看一遍」:同一话题的下一条带 lecture(新圈的、又看的过程;话题得是从这份课包开始的)
        let lecture: (NonNullable<ReturnType<typeof lectureOf>> & { again?: true }) | null | undefined = lectureOf(body.lecture);
        if (lecture === null) return { status: 400, json: { error: 'bad_request' } };
        if (lecture) {
          const shots = lecture.marks.flatMap((k) => (k.image ? [k.image] : []));
          if (shots.length + (photos?.length ?? 0) > 9) return { status: 400, json: { error: 'bad_request', message: '照片和圈的截图一共最多 9 张' } };
          for (const x of shots) if (!(await capturePathOk(ws, x))) return { status: 400, json: { error: 'bad_request' } };
        }
        if (lecture && button?.kind !== 'lecture') {
          const idx = thread && !via ? await readIndex(ws, tutor, date) : null;
          const ths = idx ? threads(idx.messages) : [];
          const from = idx?.messages.find((m, i) => ths[i] === thread && m.lecture && !m.lecture.again);
          if (!from || from.lecture?.bundle !== lecture.bundle || (!lecture.marks.length && !lecture.log.length)) return { status: 400, json: { error: 'bad_request' } };
          lecture = { ...lecture, again: true };
        }
        if (button?.kind === 'lecture') {
          if (!lecture || lecture.bundle !== button.bundle || !lecture.finished) return { status: 400, json: { error: 'bad_request', message: '小课堂要看完才能问' } };
          home = { button: button.label, ...(button.brief ? { brief: button.brief } : {}) };
          newThread = true;
          pick = undefined;
        }
        if (button && (button.kind === 'start' || button.kind === 'continue')) {
          text = button.label;
          home = { button: button.label, ...(button.brief ? { brief: button.brief } : {}) };
          if (button.kind === 'continue' && button.date === date) {
            newThread = false;
            pick = button.thread;
          } else {
            newThread = true;
            pick = undefined;
            if (button.kind === 'continue') continues = { date: button.date, thread: button.thread };
          }
        }
        if (!text.trim() && !action && !photos?.length) return { status: 400, json: { error: 'bad_request' } };
        const started = await ctx.runner.send(tutor, { from: 'kid', text, focus: focus?.data, action, newThread, thread: pick, device: device?.data, photos, ...(voiceOf(body.voice) ? { voice: voiceOf(body.voice) } : {}), ...(via && button ? { via: messageVia(via.data!, button) } : {}), ...(home ? { home } : {}), ...(continues ? { continues } : {}), ...(lecture ? { lecture } : {}) });
        return { status: 202, json: { tutor, date: started.date, job: started.job, thread: started.thread } };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }
    // 卡的状态:孩子在舞台里选了、填了 → 存 <日期>.<job>.cards/<n>.json,不起老师;下一条消息带给老师
    const card = /^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/cards\/(\d{4}-\d+)\/(\d+)$/.exec(p);
    if (card) {
      const [, tutor, job, nStr] = card;
      const t = ws.config.tutors[tutor];
      if (!t || !t.enabled || t.hidden) return { status: 404, json: { error: 'no_such_tutor' } };
      if (method !== 'PUT') return { status: 405, json: { error: 'method_not_allowed' } };
      return putCardState(ctx, ws, tutor, job, Number(nStr), body);
    }
    // 老师头像(R5b,2026-09-16):cotutor.json 里 avatar 是图片相对路径时(figshot 写的 avatars/<老师>.png)从这里取;
    // emoji 头像、越界、不是图、不存在都 404(孩子端退回显示 emoji / 首字)。no-cache:figshot 换了脸孩子端要马上见到
    const av = /^\/api\/kid\/avatar\/([a-z0-9][a-z0-9-]*)$/.exec(p);
    if (av && method === 'GET') {
      const rel = ws.config.tutors[av[1]]?.avatar ?? '';
      const file = resolve(ws.root, rel);
      const ext = IMAGE_EXT.exec(rel)?.[1]?.toLowerCase() ?? '';
      if (!rel || rel.startsWith('/') || !file.startsWith(ws.root + sep) || !IMAGE_TYPES[ext]) return { status: 404, json: { error: 'not_found' } };
      if (!(await stat(file).catch(() => null))?.isFile()) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, file, contentType: IMAGE_TYPES[ext], cacheControl: 'no-cache' };
    }
    // 写字卡的笔顺:一个汉字一份 JSON,数据包里现读;不是汉字 / 没有这个字 404(页面只显示字形不动)
    const hz = /^\/api\/kid\/tianzige\/([^/]+)$/.exec(p);
    if (hz && method === 'GET') {
      const d = await tianzigeData(decodeURIComponent(hz[1]));
      return d ? { status: 200, json: d, cacheControl: 'max-age=86400' } : { status: 404, json: { error: 'not_found' } };
    }
    // 单词卡的笔顺:词里每个字母的点序列(drawtell/glyphs 现采);写不出的词 404(页面退成字体的字)
    const lt = /^\/api\/kid\/letters\/([^/]+)$/.exec(p);
    if (lt && method === 'GET') {
      const d = lettersData(decodeURIComponent(lt[1]));
      return d ? { status: 200, json: d, cacheControl: 'max-age=86400' } : { status: 404, json: { error: 'not_found' } };
    }
    // 视频小课堂(《小课堂设计.md》§八第 4 步):lectures/<id>/ 的课名与一句一段(舞台包的播放器拼时钟用),与 video.mp4(Range 由 sendFile 管)
    const lv = /^\/api\/kid\/lectures\/([a-z0-9][a-z0-9-]*)\/(lecture\.json|video\.mp4)$/.exec(p);
    if (lv && method === 'GET') {
      const { lecture: l } = await inspectLecture(ws, lv[1]);
      if (!l?.video) return { status: 404, json: { error: 'not_found' } };
      if (lv[2] === 'video.mp4') return { status: 200, file: join(ws.dirs.lectures, lv[1], 'video.mp4'), contentType: 'video/mp4', cacheControl: 'no-cache' };
      return { status: 200, json: { title: l.title, total: l.clock.total, segments: l.clock.segments.map((x) => ({ start: x.start, len: x.len, line: x.line })) } };
    }
    // 图片卡的图:只认 workspace 根以内的图片文件(产物、照片);越界、不是图、不存在都 404
    if (p === '/api/kid/image' && method === 'GET') {
      const rel = url.searchParams.get('p') ?? '';
      const file = resolve(ws.root, rel);
      const ext = IMAGE_EXT.exec(rel)?.[1]?.toLowerCase() ?? '';
      if (!rel || rel.startsWith('/') || !file.startsWith(ws.root + sep) || !IMAGE_TYPES[ext]) return { status: 404, json: { error: 'not_found' } };
      if (!(await stat(file).catch(() => null))?.isFile()) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, file, contentType: IMAGE_TYPES[ext] };
    }
    const audio = /^\/api\/audio\/([a-z0-9][a-z0-9-]*)\/(.+)$/.exec(p);
    if (audio && method === 'GET') {
      const [, tutor, name] = audio;
      const rec = REC_FILE_RE.exec(name);
      if (!ws.config.tutors[tutor] || (!AUDIO_FILE_RE.test(name) && !rec)) return { status: 404, json: { error: 'not_found' } };
      const file = join(ws.dirs.conversations, tutor, name);
      if (!(await stat(file).catch(() => null))?.isFile()) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, file, contentType: rec ? REC_TYPES[rec[1]] : 'audio/mpeg' };
    }

    // 看原文(2026-09-11):一轮拆成六站,一个接口给全;/fixture 是原文原样一份,开发者放进 tests/fixtures/board/
    const rawRe = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2}|today)\/raw\/(\d{4}-\d+)(\/fixture)?$/.exec(p);
    if (rawRe) {
      const [, tutor, d, job, fixture] = rawRe;
      if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const view = await rawView(ws, tutor, d === 'today' ? localDate(ctx.now()) : d, job);
      if (!view) return { status: 404, json: { error: 'not_found', message: `${d} 没有 ${job} 这一轮` } };
      return { status: 200, json: fixture ? fixtureOf(view) : view };
    }
    // 试一句配音:设置页按一下就知道 tts.say 配没配对(最常见的坏法是等孩子那边没声音才发现)
    if (p === '/api/tts/try' && method === 'POST') {
      const text = isObj(body) && typeof body.text === 'string' && body.text.trim() ? body.text.trim() : '今天我们讲勾股定理';
      const voice = isObj(body) && typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : Object.values(ws.config.tutors).find((t) => t.voice)?.voice;
      if (!voice) return { status: 400, json: { error: 'no_voice', message: '没有老师配了音色(cotutor.json tutors.<名>.voice),先配一个再试' } };
      const out = join(ws.root, '.cotutor', 'tts-try.mp3');
      await mkdir(join(ws.root, '.cotutor'), { recursive: true });
      const t0 = Date.now();
      const r = await synthesize(ws.config.tts, { text, voice, out }, { env: process.env });
      if (!r.file) return { status: 200, json: { ok: false, ms: Date.now() - t0, voice, error: r.error } };
      const mp3 = await readFile(out).catch(() => null);
      return { status: 200, json: { ok: true, ms: Date.now() - t0, voice, bytes: mp3?.length ?? 0, audio: mp3 ? `data:audio/mpeg;base64,${mp3.toString('base64')}` : null } };
    }
    // 音色页(2026-09-17):列出 tts.voices 给的全部音色,家长挑之前先听。列表按命令模板缓存在进程里(597 条不会变);?refresh=1 重跑
    if (p === '/api/tts/voices' && method === 'GET') {
      const key = JSON.stringify(ws.config.tts.voices);
      let list = url.searchParams.get('refresh') ? undefined : voiceCache.get(key);
      if (!list) {
        list = await listVoices(ws.config.tts, { env: process.env });
        if (!list.error) voiceCache.set(key, list);
      }
      const inUse: Record<string, string[]> = {};
      for (const [name, t] of Object.entries(ws.config.tutors)) if (t.voice) (inUse[t.voice] ??= []).push(name);
      return { status: 200, json: { ok: !list.error, error: list.error, count: list.voices.length, voices: list.voices, inUse, sample: PREVIEW_TEXT } };
    }
    // 试听一个音色:同一句同一音色合成一次就存在 .cotutor/tts-preview/,之后直接给文件;失败回 JSON 说原因(页面拿 message 显示)
    if (p === '/api/tts/preview' && method === 'GET') {
      const voice = url.searchParams.get('voice')?.trim() ?? '';
      if (!VOICE_ID_RE.test(voice)) return { status: 400, json: { error: 'bad_voice', message: '音色 id 只能是字母数字与 . _ : -' } };
      const text = url.searchParams.get('text')?.trim().slice(0, 200) || PREVIEW_TEXT;
      const dir = join(ws.root, '.cotutor', 'tts-preview');
      const file = join(dir, `${createHash('sha1').update(`${voice}\n${text}`).digest('hex').slice(0, 20)}.mp3`);
      if (!(await stat(file).catch(() => null))?.isFile()) {
        await mkdir(dir, { recursive: true });
        const r = await synthesize(ws.config.tts, { text, voice, out: file }, { env: process.env });
        if (!r.file) return { status: 502, json: { error: 'tts_failed', voice, message: r.error } };
      }
      return { status: 200, file, contentType: 'audio/mpeg' };
    }


    // 话题打星(《obsidian仓库设计.md》§4):PUT {rating: 1–5 | null};记账:POST {threads?: [..]} → 每个话题一轮记账任务,老师回「## 记账」段,应用写日记
    const rate = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})\/threads\/([^/]+)\/rating$/.exec(p);
    if (rate && method === 'PUT') {
      const [, tutor, date, thread] = rate;
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const rating = isObj(body) ? body.rating : undefined;
      if (!(rating === null || (typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 5))) return { status: 400, json: { error: 'bad_request', message: '要 {rating: 1–5 或 null}' } };
      try {
        const index = await rateThread(ws, tutor, date, decodeURIComponent(thread), rating as number | null);
        return { status: 200, json: { tutor, date, thread: decodeURIComponent(thread), rating: index.ratings[decodeURIComponent(thread)] ?? null, keepScore: ws.config.vault.keepScore } };
      } catch (err) {
        return { status: 404, json: { error: 'no_such_thread', message: err instanceof Error ? err.message : String(err) } };
      }
    }
    // 看录像(《家长录像设计.md》):一个话题按时间排好的轨道;没有孩子开口的话题 404
    const reel = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|\d{4}-\d{2}-\d{2})\/threads\/([^/]+)\/reel$/.exec(p);
    if (reel && method === 'GET') {
      const [, tutor, tail, raw] = reel;
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const date = tail === 'today' ? localDate(ctx.now()) : tail;
      if (date > localDate(ctx.now()) || Number.isNaN(Date.parse(date))) return { status: 400, json: { error: 'bad_request', message: '日期要是今天或以前' } };
      const r = await parentReel(ctx, tutor, date, decodeURIComponent(raw));
      return r ? { status: 200, json: r } : { status: 404, json: { error: 'no_reel', message: '这个话题孩子没开过口,没有录像' } };
    }
    // 删掉一个话题(家长板书页清单上的「删」,2026-09-22):那个话题还有轮在跑就 409;这个话题写进记忆、日记的一起撤(store.deleteThread,2026-10-05),回撤了多少
    const del = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})\/threads\/([^/]+)$/.exec(p);
    if (del && method === 'DELETE') {
      const [, tutor, date, raw] = del;
      const thread = decodeURIComponent(raw);
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const target = ws;
      const active = ctx.runner.running(tutor);
      if (active && active.date === date) {
        const idx = await readIndex(target, tutor, date);
        const i = idx.messages.findIndex((m) => m.job === active.job);
        if (i >= 0 && threads(idx.messages)[i] === thread) return { status: 409, json: { error: 'busy', message: '老师还在写这个话题,等它写完再删' } };
      }
      try {
        const { index, undo } = await deleteThread(target, tutor, date, thread);
        return { status: 200, json: { tutor, date, thread, threadsLeft: new Set(threads(index.messages)).size, undo } };
      } catch (err) {
        if (err instanceof IndexError) return { status: 404, json: { error: 'no_such_thread', message: err.message } };
        throw err;
      }
    }
    const book = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})\/bookkeep$/.exec(p);
    if (book && method === 'POST') {
      const [, tutor, date] = book;
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const only = isObj(body) && Array.isArray(body.threads) ? (body.threads as unknown[]).filter((t): t is string => typeof t === 'string') : undefined;
      const r = await ctx.runner.bookkeep(tutor, date, only);
      return { status: 202, json: { tutor, date, ...r } };
    }

    // 家长板书页(《家长板书页设计.md》):清单与一天的板书,都在家长命名空间下;/api/kid/* 不动
    const ov = /^\/api\/overview\/(today|\d{4}-\d{2}-\d{2})$/.exec(p);
    if (ov && method === 'GET') {
      const date = ov[1] === 'today' ? localDate(ctx.now()) : ov[1];
      if (date > localDate(ctx.now()) || Number.isNaN(Date.parse(date))) return { status: 400, json: { error: 'bad_request', message: '日期要是今天或以前' } };
      return { status: 200, json: await overview(ctx, date) };
    }
    const pb = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|\d{4}-\d{2}-\d{2})\/board$/.exec(p);
    if (pb && method === 'GET') {
      const [, tutor, tail] = pb;
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const date = tail === 'today' ? localDate(ctx.now()) : tail;
      if (date > localDate(ctx.now()) || Number.isNaN(Date.parse(date))) return { status: 400, json: { error: 'bad_request', message: '日期要是今天或以前' } };
      return { status: 200, json: await parentDay(ctx, tutor, date) };
    }

    const conv = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)(?:\/([^/]+))?$/.exec(p);
    if (conv) {
      const [, tutor, tail] = conv;
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      if (tail === undefined && method === 'GET') {
        return { status: 200, json: { tutor, today: localDate(ctx.now()), dates: await listDates(ws, tutor), running: ctx.runner.running(tutor) } };
      }
      // 工作台传照片:与孩子端同一条路(落 captures/,回 {path})
      if (tail === 'photos') return method === 'POST' ? uploadPhoto(ws, body, ctx.now()) : { status: 405, json: { error: 'method_not_allowed' } };
      if (tail === 'messages' && method === 'POST') {
        if (!isObj(body) || typeof body.text !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 {text, from?, focus?, runtime?, photos?}' } };
        // 工作台 /dev 与 cotutor send 发的都算孩子的话(2026-10-05 起没有 from: parent;旧客户端带 parent 也当 kid)
        const from = body.from === undefined || body.from === 'parent' ? 'kid' : body.from;
        if (!(MESSAGE_FROM as readonly unknown[]).includes(from)) return { status: 400, json: { error: 'bad_request', message: `from 只能是 ${MESSAGE_FROM.join(' / ')}` } };
        const focus = body.focus === undefined ? undefined : FocusSchema.safeParse(body.focus);
        if (focus && !focus.success) return { status: 400, json: { error: 'bad_request', message: 'focus 形状不对' } };
        const photos = await photosOf(ws, body.photos);
        if (photos === null) return { status: 400, json: { error: 'bad_request', message: 'photos 要是 captures/ 里在的文件(先 POST …/photos 传图拿 path)' } };
        // 工作台 /dev 不带 device,缺省当平板横屏
        const device = body.device === undefined ? undefined : DeviceSchema.safeParse(body.device);
        if (device && !device.success) return { status: 400, json: { error: 'bad_request', message: 'device 只能是 phone / tablet' } };
        const action = body.action === undefined ? undefined : body.action === 'continue' || body.action === 'submit' ? body.action : null;
        if (action === null) return { status: 400, json: { error: 'bad_request', message: 'action 只能是 continue / submit' } };
        if (!body.text.trim() && !action && !photos?.length) return { status: 400, json: { error: 'bad_request', message: '要说点什么' } };
        const started = await ctx.runner.send(tutor, {
          from: from as (typeof MESSAGE_FROM)[number],
          text: body.text,
          action,
          focus: focus?.data,
          runtime: typeof body.runtime === 'string' ? body.runtime : undefined,
          newThread: body.newThread === true,
          thread: typeof body.thread === 'string' ? body.thread : undefined,
          photos,
          device: device?.data,
          voice: voiceOf(body.voice),
        });
        return { status: 202, json: { tutor, date: started.date, job: started.job, thread: started.thread, runtime: started.plan.runtime, resume: started.plan.resume } };
      }
      if (tail !== undefined && tail !== 'messages' && method === 'GET') {
        const date = tail === 'today' ? localDate(ctx.now()) : tail;
        if (!DATE_RE.test(date)) return { status: 400, json: { error: 'bad_request', message: '日期要是 YYYY-MM-DD 或 today' } };
        return { status: 200, json: await dayView(ctx, tutor, date) };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }

    // 孩子端的主题(themes/<kid.theme>/):css 与清单现读,mtime 缓存;坏了退出厂 default(孩子端永远有样子)
    if (method === 'GET' && (p === '/kid/theme.css' || p === '/kid/theme.json')) {
      const t = await themeFiles(ws.root, ws.config.kid.theme);
      if (p === '/kid/theme.css') return { status: 200, html: t.css, contentType: 'text/css; charset=utf-8' };
      return { status: 200, json: { ...t.manifest, theme: ws.config.kid.theme, source: t.source, ...(t.error ? { error: t.error } : {}) } };
    }
    // 舞台包(重卡在 iframe 里开)与课包文件:静态,越界 404
    if (method === 'GET' && p.startsWith('/stage/')) {
      if (p === '/stage/') { const html = await stageIndex(); return html === null ? { status: 404, json: { error: 'not_found' } } : { status: 200, html }; }
      const f = await stageAsset(p);
      return f ? { status: 200, file: f.file, contentType: f.contentType } : { status: 404, json: { error: 'not_found' } };
    }
    // 课包某一刻的画面(圈的卡、lecture 卡的缩略图):烤过的课包服务端现画;没烤过 404,页面退回自己克隆
    const frame = /^\/api\/bundles\/([a-z0-9][a-z0-9-]*)\/frame\.svg$/.exec(p);
    if (method === 'GET' && frame) {
      const svg = await lectureFrameSvg(ws, frame[1], Number(url.searchParams.get('svg')) || 0, parseRing(url.searchParams.get('ring')), { bake: ensureBaked });
      return svg === null ? { status: 404, json: { error: 'not_found' } } : { status: 200, body: Buffer.from(svg), contentType: 'image/svg+xml; charset=utf-8' };
    }
    if (method === 'GET' && p.startsWith('/api/bundles/')) {
      const f = await bundleAsset(ws.dirs.bundles, p);
      return f ? { status: 200, file: f.file, contentType: f.contentType } : { status: 404, json: { error: 'not_found' } };
    }
    if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
    // 工作台:对话原始视图、看原文、老师团、音色、设置、首页排版——给有技术背景的家长与开发者;家长端在 /parent
    if (p === '/dev') return { status: 200, html: DEV_PAGE };
    // 扫码页:在电脑上打开,iPad 用相机扫(不在孩子端的入口里)
    if (p === '/qr') return ctx.listen ? { status: 200, html: qrPage(ws.config.title, ctx.listen(), url.searchParams.get('via') === 'ip' ? 'ip' : 'name', url.searchParams.get('to') === 'parent' ? 'parent' : 'kid') } : { status: 404, json: { error: 'not_listening' } };
    // 按住说话的试验页(真机上比策略用;不在孩子端与家长端的入口里)
    if (p === '/voice-test') return { status: 200, html: VOICE_TEST_PAGE };
    // 主屏幕(iPad「添加到主屏幕」):清单与图标都按标题现生成,没有静态资源
    if (p === '/manifest.webmanifest') return { status: 200, json: webManifest(ws.config.title), contentType: 'application/manifest+json; charset=utf-8' };
    const icon = /^\/icon-(\d{2,4})\.png$/.exec(p);
    if (icon) {
      const n = Number(icon[1]);
      if (!(ICON_SIZES as readonly number[]).includes(n)) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, body: appIconPng(n), contentType: 'image/png' };
    }
    if (p === '/') return { status: 200, html: kidPage(esc(ws.config.title), {}, await stageVersion()) };
    // 家长端(《家长板书页设计.md》):也是孩子端页面本身,数据走家长接口(答案在、家长的话在),卡锁着;自己的清单,加到主屏幕才不会拿到孩子端那份
    if (p === '/parent') return { status: 200, html: kidPage(esc(ws.config.title), { parent: true }, await stageVersion()) };
    if (p === '/parent/manifest.webmanifest') return { status: 200, json: webManifest(`${ws.config.title} · 家长`, { startUrl: '/parent', scope: '/parent' }), contentType: 'application/manifest+json; charset=utf-8' };
    return { status: 404, json: { error: 'not_found', path: p } };
  } catch (err) {
    if (err instanceof BusyError) return { status: 409, json: { error: 'busy', message: err.message } };
    if (err instanceof RuntimeError) return { status: 400, json: { error: 'bad_runtime', message: err.message } };
    if (err instanceof ConfigError) return { status: 422, json: { error: 'config', message: err.message } };
    if (err instanceof IndexError) return { status: 500, json: { error: 'index', message: err.message } };
    if (err instanceof UsageError) return { status: 400, json: { error: 'usage', message: err.message } };
    throw err;
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 6_000_000) throw new UsageError('请求体超过 6MB');
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError('请求体不是合法 JSON');
  }
}

/**
 * 发文件(配音、图、小课堂的视频……):都带 accept-ranges 与长度;GET 带单段 Range → 206 只发那一段(iPad Safari 放视频非这样不可,
 * 先要 bytes=0-1,拿不到 206 就不放;音频拖动也靠它),起点越界 416;HEAD 只发头。文件读之前没了 → 404
 */
/** 这个进程的启动号:每个 JSON 响应都带(x-cotutor-boot)。页面轮询时见它变了 = 服务重起过(多半是换了新代码),空下来就自己重载——iPad 上下拉刷新常拉不到位 */
const BOOT = Date.now().toString(36);

export function createHandler(ctx: AppContext): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      let r: RouteResult;
      try {
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        // HEAD 照 GET 走路由;Node 对 HEAD 的响应本来就不发正文
        r = await route(req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET'), req.url ?? '/', ctx, body);
      } catch (err) {
        r = err instanceof UsageError ? { status: 400, json: { error: 'usage', message: err.message } } : { status: 500, json: { error: 'internal', message: err instanceof Error ? err.message : String(err) } };
        if (r.status === 500) console.error(err);
      }
      if (r.file !== undefined) await sendFile(req, res, r as RouteResult & { file: string });
      else if (r.body !== undefined) {
        res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=86400' });
        res.end(Buffer.from(r.body));
      } else if (r.html !== undefined) {
        res.writeHead(r.status, { 'content-type': r.contentType ?? 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(r.html);
      } else {
        res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/json; charset=utf-8', 'cache-control': r.cacheControl ?? 'no-store', 'x-cotutor-boot': BOOT });
        res.end(JSON.stringify(r.json ?? null));
      }
    })();
  };
}

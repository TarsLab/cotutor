/**
 * 服务的路由层:route(method, path, ctx, body) → {status, json|html},测试不用起端口。
 * R1 的查询接口照旧;R2 加:对话(列日期、看一天的家长视图、发消息)、cotutor.json 补丁(老师团页)、工作台 /dev(2026-09-22 之前叫家长页 /parent;
 * 现在 /parent 是家长端 = 家长板书页,给不懂技术的家长日常用,《家长板书页设计.md》拍板 13)。
 * R3 加:孩子端 `/`(kidPage)与 /api/kid/*(首页:课程表 + 老师卡 + 家长发布的首页卡;对话:服务端过滤后的孩子视图;发消息:from 固定 kid、每日上限 429)、配音文件 /api/audio。
 * 配置热重载:每个请求先看 cotutor.json 的 mtime,改了就重读;改坏了留旧配置并把错误挂在 /api/health 上。
 */
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { foldRuns, type TranscriptRow } from '../lib/transcript.ts';
import { RuntimeError } from '../lib/run-plan.ts';
import { PHOTO_MAX_SIDE } from '../lib/photo-edit.ts';
import { currentThread, isPrepThread, kidCurrentThread, kidSpoke, lastJobOf, localDate, prepJobs, threads } from '../lib/conversation.ts';
import { kidConversation, kidMessageCount, kidThreads, parentConversation, type KidMessage, type KidThread, type ParentMessage } from '../lib/kid-view.ts';
import { DATE_RE, FocusSchema, HOME_ID_RE, HomeViaSchema, MESSAGE_FROM, listTutors, resolvePolicy, type ConversationIndex, type ConversationMessage } from '../schema/index.ts';
import type { BoardCard } from '../lib/kid-board.ts';
import { ConfigError, UsageError, redactHome, workspaceReport, type Workspace } from '../cli/workspace.ts';
import { tutorStatuses } from '../cli/tutors.ts';
import { configGapsOf, upgradeConfig } from '../cli/migrate.ts';
import { ICON_SIZES, appIconPng, webManifest } from '../lib/icon.ts';
import { qrPage, type ListenInfo } from './qr-page.ts';
import { kidPage } from './kid-page.ts';
import { appendContinue, checkHome, historyFile, homeStats, kidHomeView, messageVia, publishHome, publishedIssues, readDraft, readPublished, resolveVia } from './home.ts';
import { DEV_PAGE } from './dev-page.ts';
import { VOICE_TEST_PAGE } from './voice-test-page.ts';
import { BusyError, Runner } from './runner.ts';
import { IndexError, capturePathOk, deleteThread, setHidden, setOpening, listDates, patchConfig, rateThread, readErrLog, readIndex, readTranscript, reloadIfChanged, scanCards, writeCapture, writeCardImage, writeCardState } from './store.ts';
import { BUTTON_LABEL_MAX, IMAGE_EXT, parseCardState, stripSecrets, type TutorButton } from '../cards/index.ts';
import { faceTutor } from '../lib/home.ts';
import { resolve, sep } from 'node:path';
import { bundleAsset, stageAsset } from './stage.ts';
import { themeFiles } from './theme.ts';
import { enrichScenes } from './scene-props.ts';
import { tianzigeData } from './tianzige.ts';
import { fixtureOf, rawView } from './raw-view.ts';
import { repost } from './post.ts';
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
  /** 工作台「首页」页里的预览(/dev/home-preview):草稿还是已发布的;孩子端没有 */
  preview?: 'draft' | 'published';
}

export async function kidHome(ctx: AppContext, now: Date, opts: { preview?: 'draft' | 'published' } = {}): Promise<KidHome> {
  const ws = ctx.ws;
  const date = localDate(now);
  const view = await kidHomeView(ws, now, opts.preview ? { source: opts.preview, keepBriefs: true } : {});
  return { title: ws.config.title, date, tutors: await kidTutors(ctx, date), home: opts.preview ? null : view.home, cards: view.cards, ...(opts.preview ? { preview: opts.preview } : {}) };
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
  // 场景卡:课包在不在、题面、步数、缩略图,每次现读(课包落地卡就变成可播)
  const sceneDirs = { bundles: ctx.ws.dirs.bundles, snaps: ctx.ws.dirs.snaps, thumbBase: 'snaps' };
  for (const m of messages) if (m.section) m.section = await enrichScenes(sceneDirs, m.section);
  // 当前话题只算孩子看得到的:家长还没交的备课话题排在最后也不算(《备课设计.md》§3.2)
  return { tutor, date, messages, remaining: Math.max(0, policy.dailyMessages - kidMessageCount(index)), pending: active && active.date === date ? active.job : null, thread: kidCurrentThread(index) };
}

/** 家长板书页的一天(《家长板书页设计.md》§4.1):形状同 KidDay 少 remaining;答案不剥,家长 / 系统发的也在 */
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
  const sceneDirs = { bundles: ctx.ws.dirs.bundles, snaps: ctx.ws.dirs.snaps, thumbBase: 'snaps' };
  for (const m of messages) if (m.section) m.section = await enrichScenes(sceneDirs, m.section);
  return { tutor, date, messages, pending: active && active.date === date ? active.job : null, thread: currentThread(index) };
}

/** 家长板书页的清单(《家长板书页设计.md》§2.2):这一天每位有脸的老师几轮、几个话题、停在哪 */
export interface OverviewThread {
  thread: string;
  at: string;
  /** 第一句:孩子的话截 20 字;首页按钮进来的是「首页 · 按钮字」;家长 / 系统起的话题标出来 */
  title: string;
  from: ConversationMessage['from'];
  via: string | null;
  sections: number;
  cards: number;
  /** 老师还在写 / 末句问句停下等孩子 / 没停 */
  stoppedAt: 'writing' | 'ask' | null;
  rating: number | null;
  booked: boolean;
  /** 家长开的备课话题、孩子还没开口(《备课设计.md》):孩子端看不到;handedAs = 交给孩子了,首页按钮上的字 */
  prep: boolean;
  handedAs: string | null;
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
}

export interface Overview {
  title: string;
  date: string;
  today: string;
  tutors: OverviewTutor[];
}

export async function overview(ctx: AppContext, date: string): Promise<Overview> {
  const tutors: OverviewTutor[] = [];
  // 交给孩子的备课话题在首页上叫什么:已发布那份里指向它的「接着」按钮的字
  const { home } = await readPublished(ctx.ws);
  const handed = new Map<string, string>();
  for (const c of home?.cards ?? []) if (c.kind === 'tutor') for (const b of (c.props.buttons ?? []) as TutorButton[]) if (b.kind === 'continue') handed.set(`${String(c.props.tutor)} ${b.date} ${b.thread}`, b.label);
  for (const t of listTutors(ctx.ws.config, { kidOnly: true })) {
    const index = await readIndex(ctx.ws, t.name, date);
    const ths = threads(index.messages);
    const prep = prepJobs(index.messages);
    const by = new Map<string, OverviewThread>();
    for (const [i, m] of index.messages.entries()) {
      if (m.bookkeep || m.tidy) continue;
      const id = ths[i];
      let th = by.get(id);
      if (!th) {
        const via = m.via?.label ?? null;
        const raw = via ? `首页 · ${via}` : m.from === 'kid' ? m.text : `${m.from === 'parent' ? '家长' : '系统'}:${m.text}`;
        const isPrep = prep.has(m.job);
        th = { thread: id, at: m.at, title: Array.from(raw.trim()).slice(0, 20).join(''), from: m.from, via, sections: 0, cards: 0, stoppedAt: null, rating: index.ratings[id] ?? null, booked: id in index.booked, prep: isPrep, handedAs: isPrep && index.openings[id] ? (handed.get(`${t.name} ${date} ${id}`) ?? '') : null };
        by.set(id, th);
      }
      if (m.from === 'kid') { th.prep = false; th.handedAs = null; }
      if (m.result === 'running') th.stoppedAt = 'writing';
      else if (m.result === 'ok' && m.section && (m.section.cards.length || m.section.lines.length)) {
        th.sections++;
        th.cards += m.section.cards.length;
        const last = m.section.lines[m.section.lines.length - 1];
        th.stoppedAt = last?.ask ? 'ask' : null;
      }
    }
    const booking = index.messages.some((m) => (m.bookkeep || m.tidy) && m.result === 'running');
    tutors.push({ name: t.name, display: t.display, avatar: t.avatar ?? null, subject: t.subject ?? null, turns: index.messages.length, costUsd: index.costUsd, threads: [...by.values()], booking });
  }
  return { title: ctx.ws.config.title, date, today: localDate(ctx.now()), tutors };
}

/**
 * 卡的状态:孩子在舞台里选了、填了(家长备课时做的也一样,交给孩子时清掉)→ 存 <日期>.<job>.cards/<n>.json,不起老师;下一条消息带给老师。
 * 画板:body 里可以带 image(data:image/png;base64,…),存成 .cards/<n>.png,状态里只留路径(相对 workspace 根,老师 Read 看)
 */
async function putCardState(ctx: AppContext, ws: Workspace, tutor: string, job: string, n: number, body: unknown): Promise<RouteResult> {
  const date = localDate(ctx.now());
  const index = await readIndex(ws, tutor, date);
  const msg = index.messages.find((m) => m.job === job);
  const target = msg?.result === 'ok' ? msg.section?.cards[n] : undefined;
  if (!target) return { status: 404, json: { error: 'no_such_card' } };
  let state = body;
  if (target.kind === 'canvas' && isObj(body) && typeof body.image === 'string') {
    const { image, ...rest } = body;
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!m || m[1].length > 8_000_000) return { status: 400, json: { error: 'bad_state' } };
    const png = await writeCardImage(ws, tutor, date, job, n, Buffer.from(m[1], 'base64'));
    state = { ...rest, image: `conversations/${tutor}/${png}` };
  }
  const r = parseCardState(target, state);
  if (!r.ok) return { status: 400, json: { error: 'bad_state' } };
  const last = index.messages[index.messages.length - 1];
  // turn = 这张卡所在话题的末条 job:下一条发给同一话题时才算「上一轮之后改过的」
  const mine = threads(index.messages)[index.messages.findIndex((m) => m.job === job)];
  await writeCardState(ws, tutor, date, job, n, { at: ctx.now().toISOString(), turn: lastJobOf(index, mine) ?? last.job, state: r.state });
  return { status: 200, json: { ok: true, card: `${job}/${n}` } };
}

/** <日期>.<job>.mp3(整段)/ .<n>.mp3(讲稿第 n 句)/ .cards/<n>/<k>.mp3(第 n 张卡的第 k 个资产) */
const AUDIO_FILE_RE = /^\d{4}-\d{2}-\d{2}\.\d{4}-\d+(?:\.\d+|\.cards\/\d+\/\d+)?\.mp3$/;
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
    const kid =/^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|messages|history|photos|\d{4}-\d{2}-\d{2})$/.exec(p);
    if (kid) {
      const [, tutor, tail] = kid;
      const t = ws.config.tutors[tutor];
      if (!t || !t.enabled || t.hidden) return { status: 404, json: { error: 'no_such_tutor' } };
      const date = localDate(ctx.now());
      // 作业照片(R5):先传图拿 path,再连 path 一起发消息;不起老师、不计上限
      if (tail === 'photos') return method === 'POST' ? uploadPhoto(ws, body, ctx.now()) : { status: 405, json: { error: 'method_not_allowed' } };
      if (tail === 'today' && method === 'GET') return { status: 200, json: await kidDay(ctx, tutor, date) };
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
        // 家长交给孩子的备课话题(《备课设计.md》§4.2):按钮只打开那个话题,孩子自己说的才是第一句;不改字、不带 home:,老师 resume 原会话
        const handed = button?.kind === 'continue' && button.date === date && Boolean((await readIndex(ws, tutor, date)).openings[button.thread]);
        if (button && handed && button.kind === 'continue') {
          newThread = false;
          pick = button.thread;
        } else if (button && (button.kind === 'start' || button.kind === 'continue')) {
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
        // 家长还没交给孩子的备课话题,孩子端发不进去(孩子本来也看不到它)
        if (pick && !newThread) {
          const idx = await readIndex(ws, tutor, date);
          if (isPrepThread(idx.messages, pick) && !idx.openings[pick]) return { status: 400, json: { error: 'bad_request' } };
        }
        const started = await ctx.runner.send(tutor, { from: 'kid', text, focus: focus?.data, action, newThread, thread: pick, device: device?.data, photos, ...(via && button ? { via: messageVia(via.data!, button) } : {}), ...(home ? { home } : {}), ...(continues ? { continues } : {}) });
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
      if (!ws.config.tutors[tutor] || !AUDIO_FILE_RE.test(name)) return { status: 404, json: { error: 'not_found' } };
      const file = join(ws.dirs.conversations, tutor, name);
      if (!(await stat(file).catch(() => null))?.isFile()) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, file, contentType: 'audio/mpeg' };
    }

    // 看原文(2026-09-11):一轮拆成六站,一个接口给全;/fixture 是原文原样一份,开发者放进 tests/fixtures/board/
    const rawRe = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2}|today)\/raw\/(\d{4}-\d+)(\/fixture|\/repost)?$/.exec(p);
    if (rawRe) {
      const [, tutor, d, job, fixture] = rawRe;
      // 再做一次后期(第七站的按钮):老师原文重解 → 跑后期 → 改写索引;老师原文与配音不动
      if (fixture === '/repost') {
        if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
        if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
        const r = await repost(ws, tutor, d === 'today' ? localDate(ctx.now()) : d, job, { env: ctx.runner.env });
        return r.message ? { status: 200, json: { ok: r.ok, post: r.message.post ?? null, error: r.error ?? null } } : { status: 404, json: { error: 'not_found', message: r.error } };
      }
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

    // ---- 首页(《首页设计.md》§七):家长端「首页」页;草稿与讲法只走这里,不经过孩子端接口 ----
    if (p === '/api/home' && method === 'GET') {
      const now = ctx.now();
      const which = url.searchParams.get('which') === 'published' ? 'published' : 'draft';
      const draft = await readDraft(ws);
      const draftCheck = draft === null ? null : await checkHome(ws, draft, now);
      const stats = await homeStats(ws, now);
      const pub = stats.home;
      return {
        status: 200,
        json: {
          which,
          draft: draftCheck ? { exists: true, for: draftCheck.doc.for ?? null, note: draftCheck.doc.note, issues: draftCheck.issues, fixes: draftCheck.fixes, cards: draftCheck.doc.cards } : { exists: false },
          published: pub ? { id: pub.id, publishedAt: pub.publishedAt, for: pub.for ?? null, days: stats.days, source: pub.source, note: pub.note, warnings: pub.warnings, cards: pub.cards, broken: await publishedIssues(ws, pub, now) } : null,
          publishedError: stats.error,
          clicks: stats.clicks,
          tutors: Object.fromEntries(Object.entries(ws.config.tutors).map(([k, t]) => [k, t.display])),
        },
      };
    }
    if (p === '/api/home/preview' && method === 'GET') {
      return { status: 200, json: await kidHome(ctx, ctx.now(), { preview: url.searchParams.get('which') === 'published' ? 'published' : 'draft' }) };
    }
    if (p === '/api/home/publish' && method === 'POST') {
      const force = isObj(body) && body.force === true;
      const fromId = isObj(body) && typeof body.from === 'string' ? body.from : undefined;
      const from = fromId === undefined ? undefined : historyFile(ws, fromId);
      if (from === null || (fromId !== undefined && !HOME_ID_RE.test(fromId))) return { status: 400, json: { error: 'bad_request', message: 'from 要是一份历史的 id(如 2026-09-17-2130)' } };
      const r = await publishHome(ws, { force, from, now: ctx.now() });
      return { status: r.ok ? 200 : 409, json: { ok: r.ok, id: r.home?.id ?? null, issues: r.check.issues, dropped: r.dropped } };
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
    // 删掉一个话题(家长板书页清单上的「删」,2026-09-22):孩子的与家长开的都能删;那个话题还有轮在跑就 409;记忆与日记不动(store.deleteThread)
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
        const index = await deleteThread(target, tutor, date, thread);
        return { status: 200, json: { tutor, date, thread, threadsLeft: new Set(threads(index.messages)).size } };
      } catch (err) {
        if (err instanceof IndexError) return { status: 404, json: { error: 'no_such_thread', message: err.message } };
        throw err;
      }
    }
    // 交给孩子(《备课设计.md》§4.1):家长开的备课话题,从 job 那一节起孩子看得到;首页草稿追加一行「接着」再发布。
    // 只交今天的;不是备课话题 / 孩子已经开口 409;检查有「要改」200 { ok: false, issues }(草稿里那行已追加,发布件没动)
    const op = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})\/threads\/([^/]+)\/opening$/.exec(p);
    if (op && method === 'POST') {
      const [, tutor, date, raw] = op;
      const thread = decodeURIComponent(raw);
      if (!faceTutor(tutor, ws.config.tutors[tutor])) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const job = isObj(body) && typeof body.job === 'string' ? body.job : '';
      const label = isObj(body) && typeof body.label === 'string' ? body.label.replace(/\s+/g, ' ').trim() : '';
      if (!label || Array.from(label).length > BUTTON_LABEL_MAX) return { status: 400, json: { error: 'bad_request', message: `按钮上的字 1–${BUTTON_LABEL_MAX} 个` } };
      if (date !== localDate(ctx.now())) return { status: 400, json: { error: 'bad_request', message: '只能把今天的备课话题交给孩子' } };
      const index = await readIndex(ws, tutor, date);
      const ths = threads(index.messages);
      if (!ths.includes(thread)) return { status: 404, json: { error: 'no_such_thread' } };
      if (!isPrepThread(index.messages, thread)) return { status: 409, json: { error: 'not_prep', message: '这不是家长开的话题' } };
      if (kidSpoke(index.messages, thread)) return { status: 409, json: { error: 'kid_spoke', message: '孩子已经在这个话题里说过话了' } };
      const turn = index.messages.find((m, i) => ths[i] === thread && m.job === job);
      if (!turn || turn.result !== 'ok' || !turn.section) return { status: 400, json: { error: 'bad_request', message: '要交的那一节还没写好' } };
      const active = ctx.runner.running(tutor);
      if (active && active.date === date && ths[index.messages.findIndex((m) => m.job === active.job)] === thread) return { status: 409, json: { error: 'busy', message: '老师还在写这个话题' } };
      await setOpening(ws, tutor, date, thread, job);
      const r = await appendContinue(ws, tutor, date, thread, label, ctx.now());
      return { status: 200, json: { ok: r.ok, label, issues: r.check.issues.filter((i) => i.level === 'fix').map((i) => i.text) } };
    }
    // 对孩子藏起 / 放出一节(《备课设计.md》§4.5):家长让老师重写过的旧版之类。只认备课话题里孩子开口之前的轮;开场那一轮不能藏
    const hid = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})\/threads\/([^/]+)\/hidden$/.exec(p);
    if (hid && method === 'PUT') {
      const [, tutor, date, raw] = hid;
      const thread = decodeURIComponent(raw);
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const job = isObj(body) && typeof body.job === 'string' ? body.job : '';
      const hide = isObj(body) ? body.hidden : undefined;
      if (typeof hide !== 'boolean') return { status: 400, json: { error: 'bad_request', message: '要 {job, hidden: true | false}' } };
      const index = await readIndex(ws, tutor, date);
      const ths = threads(index.messages);
      if (!ths.includes(thread)) return { status: 404, json: { error: 'no_such_thread' } };
      if (!index.messages.some((m, i) => ths[i] === thread && m.job === job)) return { status: 400, json: { error: 'bad_request', message: `话题 ${thread} 里没有 ${job} 这一轮` } };
      if (!isPrepThread(index.messages, thread)) return { status: 409, json: { error: 'not_prep', message: '只有家长开的备课话题能藏' } };
      if (!prepJobs(index.messages).has(job)) return { status: 409, json: { error: 'kid_spoke', message: '孩子已经看过这一节了' } };
      if (hide && index.openings[thread] === job) return { status: 400, json: { error: 'bad_request', message: '开场那一节不能藏;要换开场,在另一节尾点「改开场」' } };
      const next = await setHidden(ws, tutor, date, job, hide);
      return { status: 200, json: { tutor, date, thread, job, hidden: next.hidden.includes(job) } };
    }
    // 家长在备课话题里做卡(看效果;《备课设计.md》§3.2):只认备课轮的卡;孩子的话题里家长不替孩子答
    const pcard = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/cards\/(\d{4}-\d+)\/(\d+)$/.exec(p);
    if (pcard) {
      const [, tutor, job, nStr] = pcard;
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      if (method !== 'PUT') return { status: 405, json: { error: 'method_not_allowed' } };
      if (!prepJobs((await readIndex(ws, tutor, localDate(ctx.now()))).messages).has(job)) return { status: 409, json: { error: 'not_prep', message: '家长只在自己开的备课话题里做卡' } };
      return putCardState(ctx, ws, tutor, job, Number(nStr), body);
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
      // 家长端传照片:与孩子端同一条路(落 captures/,回 {path})
      if (tail === 'photos') return method === 'POST' ? uploadPhoto(ws, body, ctx.now()) : { status: 405, json: { error: 'method_not_allowed' } };
      if (tail === 'messages' && method === 'POST') {
        if (!isObj(body) || typeof body.text !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 {text, from?, focus?, runtime?, photos?}' } };
        const from = body.from ?? 'parent';
        if (!(MESSAGE_FROM as readonly unknown[]).includes(from)) return { status: 400, json: { error: 'bad_request', message: `from 只能是 ${MESSAGE_FROM.join(' / ')}` } };
        const focus = body.focus === undefined ? undefined : FocusSchema.safeParse(body.focus);
        if (focus && !focus.success) return { status: 400, json: { error: 'bad_request', message: 'focus 形状不对' } };
        const photos = await photosOf(ws, body.photos);
        if (photos === null) return { status: 400, json: { error: 'bad_request', message: 'photos 要是 captures/ 里在的文件(先 POST …/photos 传图拿 path)' } };
        // 家长端在 iPad 上真发(《家长板书页设计.md》第六节 3)带 device,板书后期按它排版;工作台 /dev 不带,缺省当平板横屏
        const device = body.device === undefined ? undefined : DeviceSchema.safeParse(body.device);
        if (device && !device.success) return { status: 400, json: { error: 'bad_request', message: 'device 只能是 phone / tablet' } };
        // 家长在自己的备课话题里按「继续」、做了卡「交给老师」(《备课设计.md》§3.2);孩子的话题里页面不给这两个
        const action = body.action === undefined ? undefined : body.action === 'continue' || body.action === 'submit' ? body.action : null;
        if (action === null) return { status: 400, json: { error: 'bad_request', message: 'action 只能是 continue / submit' } };
        if (!body.text.trim() && !action && !photos?.length) return { status: 400, json: { error: 'bad_request', message: '要说点什么' } };
        const started = await ctx.runner.send(tutor, {
          from: from as (typeof MESSAGE_FROM)[number],
          text: body.text,
          action,
          // 家长端「新话题」开的是备课话题(《备课设计.md》§3.1):孩子开口前孩子看不到、不写记忆;工作台与 CLI 开的不带
          prepThread: body.prep === true && body.newThread === true && from === 'parent',
          focus: focus?.data,
          runtime: typeof body.runtime === 'string' ? body.runtime : undefined,
          newThread: body.newThread === true,
          thread: typeof body.thread === 'string' ? body.thread : undefined,
          photos,
          device: device?.data,
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
      const f = await stageAsset(p);
      return f ? { status: 200, file: f.file, contentType: f.contentType } : { status: 404, json: { error: 'not_found' } };
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
    if (p === '/') return { status: 200, html: kidPage(esc(ws.config.title)) };
    // 工作台「首页」页的预览:就是孩子端页面本身,数据走家长接口(讲法在),按钮不真发
    if (p === '/dev/home-preview') return { status: 200, html: kidPage(esc(ws.config.title), { preview: url.searchParams.get('which') === 'published' ? 'published' : 'draft' }) };
    // 家长端(《家长板书页设计.md》):也是孩子端页面本身,数据走家长接口(答案在、家长的话在),卡锁着;自己的清单,加到主屏幕才不会拿到孩子端那份
    if (p === '/parent') return { status: 200, html: kidPage(esc(ws.config.title), { parent: true }) };
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

/** 这个进程的启动号:每个 JSON 响应都带(x-cotutor-boot)。页面轮询时见它变了 = 服务重起过(多半是换了新代码),空下来就自己重载——iPad 上下拉刷新常拉不到位 */
const BOOT = Date.now().toString(36);

export function createHandler(ctx: AppContext): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      let r: RouteResult;
      try {
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        r = await route(req.method ?? 'GET', req.url ?? '/', ctx, body);
      } catch (err) {
        r = err instanceof UsageError ? { status: 400, json: { error: 'usage', message: err.message } } : { status: 500, json: { error: 'internal', message: err instanceof Error ? err.message : String(err) } };
        if (r.status === 500) console.error(err);
      }
      if (r.file !== undefined) {
        res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/octet-stream', 'cache-control': r.cacheControl ?? 'private, max-age=86400' });
        createReadStream(r.file).on('error', () => res.end()).pipe(res);
      } else if (r.body !== undefined) {
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

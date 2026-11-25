/**
 * 服务的路由层:route(method, path, ctx, body) → {status, json|html},测试不用起端口。
 * 三端的页面与接口都从这里走:孩子端 `/`(kidPage)与 /api/kid/*(首页:课程表 + 老师牌 + 家长发布的牌;对话:服务端过滤后的孩子视图)、
 * 家长端 /parent 与 /api/parent/*(给不懂技术的家长日常用)、工作台 /dev 与其余 /api/*(对话、看原文、cotutor.json 补丁);声音文件从 /api/audio 取。
 * 配置热重载:每个请求先读一遍 cotutor.json,原文变了就重读(不比修改时间,Windows 上连写两次常常一样);改坏了留旧配置并把错误挂在 /api/health 上。
 */
import { trialVoice } from './trial-voice.ts';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { foldRuns, type TranscriptRow } from '../../brain/transcript.ts';
import { RuntimeError } from '../../brain/index.ts';
import { PHOTO_MAX_SIDE } from '../../ui/kid/photo-edit.ts';
import { currentThread, lastJobOf, sameRuntime } from '../../runtime/journal/conversation.ts';
import { localDate, weekOf } from '../../shared/time.ts';
import { cardVoice, conversationFiles, threads } from '../../schema/index.ts';
import { homeworkPast, homeworkPdf, homeworkPdfName, homeworkSubject } from '../../runtime/homework.ts';
import { kidConversation, startedThreads, parentConversation, type KidMessage, type KidTodayThread, type ParentMessage } from '../../runtime/kid-view.ts';
import { previewOf, writePreview } from '../../runtime/journal/preview.ts';
import { parseEvents } from '../../runtime/journal/events.ts';
import { pickBookZones, walkZones, zonesKidPage, type Lesson, type RunEvent } from '../../schema/index.ts';
import { NEUTRAL_COLOR, SUBJECT_COLORS, TUTOR_PALETTE, tutorColors } from '../../ui/shared/tutor-color.ts';
import { boardMarkOf, type BoardMarkId } from '../../ui/kid/board-mark.ts';
import { buildReel, playRecordOk, reelHolds, reelMissRuns, type PlayRecord, type Reel, type ReelCall } from '../../ui/kid/reel.ts';
import type { CallReel } from '../../runtime/journal/recorder.ts';
import { DATE_RE, canonicalSubject, MESSAGE_FROM, listTutors, spokeIn, subjectLang, viaSendsLabel, type ConversationIndex, type ConversationMessage, type MemoryLine, type TutorExtra } from '../../schema/index.ts';
import type { BoardCard, Device } from '../../board/presentation.ts';
import { ConfigError, patchConfig, reloadIfChanged, workspaceReport } from '../workspace.ts';
import { UsageError } from '../../shared/errors.ts';
import { redactHome } from '../../shared/home.ts';
import type { Workspace } from '../../schema/index.ts';
import { configGapsOf, upgradeConfig } from '../cli/migrate.ts';
import { ICON_SIZES, appIconPng, webManifest } from '../../ui/shared/icon.ts';
import { faviconResponse } from '../../ui/shared/favicon.ts';
import { cookieOf, createAccess, gatePage, isKidPath, type Access, type Who } from './access.ts';
import { factoryAvatarFile, shownAvatar } from './avatars.ts';
import { deviceCookie, newDeviceId, parseKidLog, readDevices, recordKidLog, renameDevice, validDevice } from '../../runtime/journal/kid-log.ts';
import { DEVICE_COOKIE } from '../../schema/kid-device.ts';
import { BUILD, codeChanged, headNow, shortCommit } from '../build.ts';
import { knownLatest, knownNotes } from '../machine/update.ts';
import { isNewer } from '../../shared/upgrade.ts';
import { qrPage, type ListenInfo } from '../../ui/parent/qr-page.ts';
import { kidPage } from '../../ui/kid/kid-page.ts';
import { KID_SW_JS } from '../../ui/kid/offline-sw.ts';
import { parentPage } from '../../ui/parent/parent-page.ts';
import { kidHomeView } from '../../runtime/home/store.ts';
import { photosOf } from '../../runtime/kid-input.ts';
import { DEV_PAGE } from '../../ui/dev/dev-page.ts';
import { devOverview } from './dev-overview.ts';
import { ActivityConflict, checkDevActivity, findDevActivity, listDevActivities, readDevActivity, restoreDevActivity, saveDevActivity } from './dev-activities.ts';
import { ZonesConflict, checkDevZoneLesson, devZoneLesson, dropStaleZones, listDevZones, readDevZoneLesson, restoreDevZoneLesson, saveDevZoneLesson, sayDevZone } from './dev-zones.ts';
import { doctorWorkspace } from '../cli/doctor.ts';
import { VOICE_GALLERY_PAGE } from '../../ui/dev/voice-gallery-page.ts';
import { BusyError, Runner } from '../../runtime/runner.ts';
import { sendFile } from './send-file.ts';
import { parentHomeRoute } from './parent-home.ts';
import { parentLookRoute } from './parent-look.ts';
import { bailianRoute, createBailian, type Bailian } from '../machine/bailian.ts';
import { PARENT_HOME_PAGE } from '../../ui/parent/parent-home-page.ts';
import { PARENT_SETTINGS_PAGE } from '../../ui/parent/parent-settings-page.ts';
import { dictationRoute } from '../dictation/route.ts';
import { kidWords, readWords } from '../../scenes/photo-words/store.ts';
import { imageSize } from '../../shared/jpeg.ts';
import { listTextbookPages, textbookPageFile } from '../../memory/textbook-pages.ts';
import { bookFile, bookIndex, listBooks, pickBook } from '../../memory/textbook-pdf.ts';
import { bookZones } from '../../memory/textbook-zones.ts';
import { readWorkbook, workbookImageFile } from '../../memory/workbook.ts';
import { readCover, saveCover } from '../../memory/textbook-cover.ts';
import { homeworkFile } from '../../memory/homework.ts';
import { lessonOpen, tocEntries, type LessonBook } from '../../board/lesson-fit.ts';
import { lastSpot } from '../../runtime/journal/book-last.ts';
import { lessonInit, lessonPage, lessonStep } from '../../board/lesson.ts';
import { readLesson } from '../../runtime/journal/lesson-store.ts';
import { BOOK_TOC, bookPages, bookReadTexts, readLessonText, readTimes, workbookLayer, workbookPage, zoneBlocks } from '../../chalk/index.ts';
import { synthesize, synthesizeTimed } from '../../media/tts.ts';
import type { Look } from '../../scenes/look.ts';
import { IndexError, capturePathOk, deleteThread, listDates, rateThread, readErrLog, readIndex, readTranscript, undoVaultWrite, writeCapture, type VaultWrite } from '../../runtime/journal/store.ts';
import { memoryLineText } from '../../memory/vault-notes.ts';
import { childItem } from '../../memory/proposals.ts';
import { isAbsolute, resolve, sep } from 'node:path';
import { bundleAsset, stageAsset, stageIndex, stageVersion } from './stage.ts';
import { themeFiles } from './theme.ts';
import { inspectLecture, ensureBaked, lectureFrameSvg, parseRing, parseSvgMs } from '../../runtime/lecture.ts';
import { tianzigeData } from '../../ui/kid/tianzige.ts';
import { lettersData } from '../../ui/kid/letters.ts';
import { fixtureOf, rawView } from './raw-view.ts';
import { DeviceSchema } from '../../schema/index.ts';
import { addTutorHome } from '../cli/tutors.ts';
import { activityRunFor } from '../../runtime/activities.ts';
import { shippedAgents } from '../cli/skeleton.ts';
import { workspaceGradePack } from '../cli/grades.ts';
import type { MouthIndex } from '../../runtime/journal/mouth-index.ts';

export interface RouteResult {
  status: number;
  json?: unknown;
  html?: string;
  /** 静态文件(配音);handler 流式发 */
  file?: string;
  /** 现生成的二进制(主屏幕图标、网页图标) */
  body?: Uint8Array;
  contentType?: string;
  /** file / body 的缓存策略;不给 = 一天(配音、课包这些不会变);头像会被 figshot 换掉,给 no-cache。json 不给 = no-store(笔顺数据例外,给一天) */
  cacheControl?: string;
  /** 要种的 cookie(/api/auth 对了 PIN) */
  setCookie?: string;
  /** body 是要下载的文件(作业本导出的 PDF):文件名 */
  download?: string;
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
  /** 现在开着几通电话(serve 接 ws 那边的数;没起端口 → null) */
  openCalls: (() => number) | null;
  /** 重读 cotutor.json(改了才读) */
  reload(): Promise<void>;
  /** 家长端与工作台的锁(access.ts):机器级 PIN,没设就全开;测试可注入 */
  access: Access;
  /** 百炼(bailian.ts):孩子端要它才打得开,家长端配;测试可注入 */
  bailian: Bailian;
  /** 嘴的连接好了 / 坏了(call.ts 报上来) */
  mouthHealth(why: string | null, midCall?: boolean): Promise<void>;
}

export function createContext(ws: Workspace, opts: { now?: () => Date; env?: NodeJS.ProcessEnv; look?: Look; access?: Access; bailian?: Bailian } = {}): AppContext {
  let configText: string | null = null;
  const ctx: AppContext = {
    ws,
    runner: new Runner(() => ctx.ws, opts),
    now: opts.now ?? (() => new Date()),
    configError: null,
    listen: null,
    openCalls: null,
    access: opts.access ?? createAccess({ now: () => ctx.now() }),
    bailian: opts.bailian ?? createBailian({ env: opts.env }),
    async mouthHealth(why, midCall) {
      if (why === null) ctx.bailian.fine('mouth');
      else await ctx.bailian.note(midCall ? 'call' : 'mouth', why);
    },
    async reload() {
      try {
        const r = await reloadIfChanged(ctx.ws, configText);
        ctx.ws = r.ws;
        configText = r.text;
        ctx.configError = null;
      } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        ctx.configError = err.message;
      }
    },
  };
  // 脑的结果:请求失败(欠费、key 失效)记下给家长看;成功了就算好了。不是请求的错(比如卡住)不算百炼的事
  ctx.runner.onEvent((e) => {
    if (e.event.lane !== 'main' || e.event.kind !== 'exit') return;
    if (e.event.ok) ctx.bailian.fine('brain');
    else if (e.event.reason?.startsWith('api:')) void ctx.bailian.note('brain', e.event.reason);
  });
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

/** 孩子端看到的老师:enabled 且不 hidden */
export interface KidTutor {
  name: string;
  display: string;
  avatar: string | null;
  subject: string | null;
  /** 学科色(服务端定好,src/ui/shared/tutor-color.ts;页面不自己算) */
  color: string;
  /** 板的底纹上写哪个学科字(board-mark.ts):三门主科各一个,别的老师 null 不写字 */
  mark: BoardMarkId | null;
  /** 他的听写写哪种:学科是英语(含别名)= en */
  lang: 'zh' | 'en';
  /** 有「点读的声音」(cotutor.json 写的,或出厂三位的缺省;cardVoice):课本上的点读照它出不出钮 */
  hasVoice: boolean;
  /** 卡上的常驻入口:dictation 听写与拍照听写 */
  extras: TutorExtra[];
  /** 实时老师页缺省怎么说话(live.listen):hold 按住说、open 一直听;孩子切过的记在设备上,以那个为准 */
  listen: 'hold' | 'open';
}

export async function kidTutors(ctx: AppContext): Promise<KidTutor[]> {
  const out: KidTutor[] = [];
  const colors = tutorColors(ctx.ws.config.tutors);
  for (const t of listTutors(ctx.ws.config, { kidOnly: true })) {
    out.push({ name: t.name, display: t.display, avatar: shownAvatar(t), subject: t.subject ?? null, color: colors[t.name], mark: boardMarkOf(t.subject), lang: subjectLang(t.subject), hasVoice: Boolean(cardVoice(ctx.ws.config.tutors, t.name)), extras: t.extras, listen: ctx.ws.config.live.listen });
  }
  return out;
}

export interface KidHome {
  title: string;
  date: string;
  tutors: KidTutor[];
  /** 发布的首页 id(孩子点按钮时带回来);缺省首页 / 预览 = null */
  home: string | null;
  /** 首页的卡:老师卡在前,props.buttons 是孩子端的按钮;其余卡照文件顺序 */
  cards: BoardCard[];
  /** 「给老师们换个样子」的入口(figshot pick 在这台电脑的哪个端口);cotutor.json 没配 figshot 就是 null */
  figshot: { port: number } | null;
  /** 按住说话那一栏在哪边(cotutor.json 的 kid.hand,家长端设置页改;缺省 right = 在左边):left = 平板横屏实时老师页的那一栏挪到右边 */
  hand: 'right' | 'left';
  /** 百炼配好了:没配孩子端只出「老师们还没到」,家长端配 */
  ready: boolean;
  /** 首页「今天」:今天开了头的话题(几位老师的混在一起,新的在前);点一格回到那个话题接着聊 */
  today: KidTodayItem[];
}

/** 首页「今天」的一格:image = 预览图(没有就是孩子最后发的照片;都没有 null,孩子端画老师的颜色) */
export interface KidTodayItem extends Omit<KidTodayThread, 'photo'> {
  tutor: string;
  image: string | null;
}

/** 这几位老师今天开了头的话题 */
export async function kidToday(ws: Workspace, tutors: readonly string[], date: string): Promise<KidTodayItem[]> {
  const out: KidTodayItem[] = [];
  for (const tutor of tutors) {
    const index = await readIndex(ws, tutor, date).catch(() => null);
    if (!index) continue;
    for (const { photo, ...t } of startedThreads(index.messages)) {
      // 课名:这节课此刻停在哪一课(进门铺的、孩子翻的、老师翻的都在里面);停在目录、不是课本的,照讲稿里老师最后翻到的(startedThreads)
      const l = await readLesson(ws, tutor, date, t.thread).catch(() => null);
      const page = l ? lessonPage(l) : null;
      if (page?.kind === 'book' && page.title !== BOOK_TOC) t.lesson = page.title;
      const pv = await previewOf(ws, tutor, date, t.thread);
      const image = pv ? `/api/kid/conversations/${tutor}/preview?thread=${encodeURIComponent(t.thread)}&date=${date}&v=${pv.mtime}` : photo ? `/api/kid/image?p=${encodeURIComponent(photo)}` : null;
      out.push({ ...t, tutor, image });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export async function kidHome(ctx: AppContext, now: Date): Promise<KidHome> {
  const ws = ctx.ws;
  const date = localDate(now);
  const view = await kidHomeView(ws, now);
  const figshot = ws.config.figshot ? { port: ws.config.figshot.port } : null;
  const names = view.cards.flatMap((c) => (c.kind === 'tutor' ? [String(c.props.tutor)] : []));
  return { title: ws.config.title, date, tutors: await kidTutors(ctx), home: view.home, cards: view.cards, figshot, hand: ws.config.kid.hand ?? 'right', ready: ctx.bailian.status().ready && !ctx.bailian.blocked(), today: await kidToday(ws, names, date) };
}

export interface KidDay {
  tutor: string;
  date: string;
  messages: KidMessage[];
  /** 老师正在回的那条 job */
  pending: string | null;
  /** 当前话题(末条消息所在);还没说过话 → null */
  thread: string | null;
}

export async function kidDay(ctx: AppContext, tutor: string, date: string): Promise<KidDay> {
  const index = await readIndex(ctx.ws, tutor, date);
  const active = ctx.runner.running(tutor);
  const messages = kidConversation(index);
  // 流式:正在回的那条带上已经出来的讲稿(partial)
  const partial = active && active.date === date ? ctx.runner.partial(tutor) : null;
  if (partial) {
    const m = messages.find((x) => x.job === active!.job);
    if (m) m.section = partial;
  }
  return { tutor, date, messages, pending: active && active.date === date ? active.job : null, thread: currentThread(index) };
}

/** 家长端「记录」的一天:形状同 KidDay;答案不剥,系统发的也在 */
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
  const messages = parentConversation(index);
  const partial = active && active.date === date ? ctx.runner.partial(tutor) : null;
  if (partial) {
    const m = messages.find((x) => x.job === active!.job);
    if (m) m.section = partial;
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

/**
 * 家长端看录像:这个话题的轨道(ui/kid/reel.ts 排)+ 这个话题的家长条目(录像栏的说明用)+ 孩子端条目(孩子的屏幕照它画,
 * 和 /api/kid 一样剥了答案)+ 孩子那台设备(屏幕多大)与老师的脸(孩子屏幕左上角)。话题一轮都没有 → null;孩子没开过口的也有(只有老师一轨)
 */
export interface ParentReel {
  tutor: string;
  date: string;
  thread: string;
  reel: Reel;
  messages: ParentMessage[];
  kid: KidMessage[];
  /** 孩子发这个话题最后一句时的设备;没记 → null(页面按 iPad 横屏) */
  device: Device | null;
  /** 今天的话题:还会长(老师在写、孩子还会接着说),录像停在最后时隔几秒重拿 */
  live: boolean;
  /** 这个话题有实时的轮:孩子的屏幕是实时老师页的样子(左栏大头像 + 字幕、卡角没有钮) */
  realtime: boolean;
  face: { name: string; display: string; avatar: string | null; subject: string | null; color: string };
}
export async function parentReel(ctx: AppContext, tutor: string, date: string, thread: string): Promise<ParentReel | null> {
  const index = await readIndex(ctx.ws, tutor, date);
  const ths = threads(index.messages);
  const mine = index.messages.filter((_m, i) => ths[i] === thread);
  if (!mine.length) return null;
  const files = conversationFiles(ctx.ws.dirs.conversations, tutor, date);
  const events: Record<string, RunEvent[]> = {};
  for (const m of mine) {
    const text = await readFile(files.events(m.job), 'utf8').catch(() => null);
    if (text !== null) events[m.job] = parseEvents(text);
  }
  const jobs = new Set(mine.map((m) => m.job));
  const plays = await readPlays(ctx.ws, tutor, date, jobs);
  const calls = mine.some((m) => m.live) ? await liveCalls(ctx, tutor, date, jobs) : [];
  const reel = buildReel({ messages: mine, events, now: ctx.now().getTime(), plays, calls });
  if (!reel) return null;
  const day = await parentDay(ctx, tutor, date);
  const kid = await kidDay(ctx, tutor, date);
  const device = [...mine].reverse().find((m) => m.device)?.device ?? null;
  const t = ctx.ws.config.tutors[tutor];
  const face = { name: tutor, display: t?.display ?? tutor, avatar: t ? shownAvatar(t) : null, subject: t?.subject ?? null, color: tutorColors(ctx.ws.config.tutors)[tutor] ?? NEUTRAL_COLOR, mark: boardMarkOf(t?.subject) };
  const live = date === localDate(ctx.now()) || mine.some((m) => m.result === 'running');
  return { tutor, date, thread, reel, messages: day.messages.filter((m) => m.thread === thread), kid: kid.messages.filter((m) => m.thread === thread), device, face, live, realtime: mine.some((m) => m.live) };
}

/** 一册课本:索引和分块(src/memory/textbook-zones.ts;规则出的第一次用到时出);读不出 = null */
async function bookOpen(ws: Workspace, name: string): Promise<LessonBook | null> {
  const cache = join(ws.root, '.cotutor', 'textbooks');
  const index = await bookIndex(ws.paths.textbooks, cache, name).catch(() => null);
  if (!index) return null;
  const zones = await bookZones(ws.paths.textbooks, cache, index).catch((e: unknown) => { console.error(`课本《${name}》的分块读不出:${e instanceof Error ? e.message : String(e)}`); return null; });
  return zones ? { file: name, index, zones } : null;
}

/**
 * 课本做底:这本书的目录当一页(一节课还没开始时孩子端先铺它,窗停在上次翻到的那一课那一行),和目录上能点的那几项(tocEntries:印在哪一行、点了铺哪一页;
 * 孩子端点了就自己先翻过去、在一课里按「目录」回来,不等服务端)。读不出、没有目录 → null
 */
async function bookBase(ws: Workspace, name: string): Promise<{ lesson: Lesson; toc: ReturnType<typeof tocEntries> } | null> {
  const book = await bookOpen(ws, name);
  if (!book) return null;
  const l = lessonOpen(lessonInit(), book, await lastSpot(ws, name));
  return l.at ? { lesson: l, toc: tocEntries(book) } : null;
}

/** 这一天实时老师的通话录像(<日期>.live/<时分秒>.reel.json,src/runtime/live/call.ts 落的)里有这几轮的;声音是同名的 .wav。坏的、没声音的跳过 */
async function liveCalls(ctx: AppContext, tutor: string, date: string, jobs: Set<string>): Promise<ReelCall[]> {
  const dir = join(ctx.ws.dirs.conversations, tutor, `${date}.live`);
  const out: ReelCall[] = [];
  for (const f of (await readdir(dir).catch(() => [] as string[])).filter((x) => /^\d{6}\.reel\.json$/.test(x)).sort()) {
    const r = await readFile(join(dir, f), 'utf8').then((t) => JSON.parse(t) as Partial<CallReel>, () => null);
    const startAt = Date.parse(r?.startedAt ?? '');
    if (!r || !Array.isArray(r.msgs) || !Array.isArray(r.playing) || Number.isNaN(startAt)) continue;
    if (!r.msgs.some((x) => Array.isArray(x) && x[1] === 'o' && x[2]?.t === 'turn' && jobs.has(String(x[2].job)))) continue;
    const wav = f.replace(/\.reel\.json$/, '.wav');
    if (!existsSync(join(dir, wav))) continue;
    out.push({ audio: `${date}.live/${wav}`, startAt, msgs: r.msgs, playing: r.playing });
  }
  return out;
}


/** 家长端「记录」的清单:这一天每位老师几轮、几个话题、停在哪 */
export interface OverviewThread {
  thread: string;
  at: string;
  /** 第一句:孩子的话截 20 字;首页按钮进来的是「首页 · 按钮字」;系统起的话题标出来 */
  title: string;
  from: ConversationMessage['from'];
  via: string | null;
  /**
   * 孩子是点哪颗进来的(记录的卡照搬孩子端那颗):new 新话题(或没从首页进来)、start 开场、continue 接着、lecture 小课堂、activity、system 系统起的;
   * label = 按钮上的字(new 是「新话题」)
   */
  start: { kind: 'new' | 'start' | 'lecture' | 'activity' | 'system'; label: string };
  /** 孩子自己说的第一句(截 30 字;按钮发的那句不算):新话题气泡上的小字 */
  said: string | null;
  /** 最后一轮老师写完(配好音)的时刻(ISO);没有计时的老数据 null */
  endAt: string | null;
  /** 看过小课堂:海报用 */
  lecture?: { bundle: string; title: string; video?: true; watchedMs: number; finished: boolean; marks: number };
  /** 各轮给家长的(去掉「## 家长」)与记住了:宽屏右栏「这一天老师跟你说的」 */
  notes: string[];
  remembered: string[];
  /** 这个话题写进 vault 的每一笔:家长过目、单行撤回(job / kind / n 交给撤回接口);quote = 对上了的孩子原话 */
  writes: { job: string; kind: VaultWrite['kind']; n: number; text: string; quote?: string }[];
  sections: number;
  /** 老师还在写 / 末句问句停下等孩子 / 没停 */
  stoppedAt: 'writing' | 'ask' | null;
  rating: number | null;
  booked: boolean;
  /** 换过运行时:这个话题是在哪个运行时下聊的;老师现在用别的,接不上那时的对话,不记账 */
  oldRuntime?: string;
  /** 按住说话连着几次没发出去(最长的一串,够 REEL_MISS_STREAK 才有) */
  misses?: number;
}
export interface OverviewTutor {
  name: string;
  display: string;
  avatar: string | null;
  subject: string | null;
  color: string;
  turns: number;
  threads: OverviewThread[];
  /** 正在记账(记账或整理记忆的轮还在跑):家长端清单上的「记账」灰掉、行上写「记账中」 */
  booking: boolean;
  /** 卡上的常驻入口:家长端「记录」把听写、口语课挂在常驻它们的老师下面 */
  extras: TutorExtra[];
}

export interface Overview {
  title: string;
  date: string;
  today: string;
  tutors: OverviewTutor[];
  /** 七天日期条:date 所在的七天,每天有话题的老师(听写页面自己从模块接口补) */
  week: { date: string; tutors: string[] }[];
  /** 百炼配好了;没配清单顶上一行叫家长去「首页」配 */
  ready: boolean;
}

/**
 * 一轮写进 vault 的每一笔,给家长过目:记忆的行(memoryLines)、孩子的记忆的行(childLines)、日记那段(diaryBlock)。
 * quote = 那一行对上了的孩子原话(这一轮的 memoryProposals 里核对过的那条)
 */
function vaultWrites(m: ConversationMessage): OverviewThread['writes'] {
  const verified = (m.memoryProposals ?? []).filter((p) => p.check === 'verified' && p.quote);
  const quoteOf = (text: string, child: boolean): string | undefined => verified.find((p) => {
    const item = child ? childItem(p.item) : p.item;
    return item === text || item.replace(/\s*(?:→|->)\s*/, ' → ').endsWith(` → ${text.replace(/^改:.*? → /, '')}`);
  })?.quote;
  const lines = (kind: 'memory' | 'child', ls: readonly MemoryLine[] | undefined): OverviewThread['writes'] => (ls ?? []).map((l, n) => {
    const text = memoryLineText(l);
    const quote = quoteOf(text, kind === 'child');
    return { job: m.job, kind, n, text: kind === 'child' ? `孩子的记忆:${text}` : text, ...(quote ? { quote } : {}) };
  });
  const diary = m.diaryBlock ? [{ job: m.job, kind: 'diary' as const, n: 0, text: `日记:${m.diaryBlock.split('\n')[0].replace(/^##\s*/, '')}` }] : [];
  return [...lines('memory', m.memoryLines), ...lines('child', m.childLines), ...diary];
}

export async function overview(ctx: AppContext, date: string): Promise<Overview> {
  const tutors: OverviewTutor[] = [];
  const colors = tutorColors(ctx.ws.config.tutors);
  for (const t of listTutors(ctx.ws.config, { kidOnly: true })) {
    const index = await readIndex(ctx.ws, t.name, date);
    const ths = threads(index.messages);
    const by = new Map<string, OverviewThread>();
    const diaries: { id: string; m: (typeof index.messages)[number] }[] = [];
    for (const [i, m] of index.messages.entries()) {
      // 记账那轮不算一节,写进日记的那段挂回它记的话题
      if (m.bookkeep && m.diaryBlock) diaries.push({ id: ths[i], m });
      // 只进了门、没开口的话题不存(孩子点回首页、下次进门时删):删掉之前也当没有
      if (m.bookkeep || m.tidy || !spokeIn(index.messages, ths[i])) continue;
      const id = ths[i];
      let th = by.get(id);
      if (!th) {
        const via = m.via?.label ?? null;
        const raw = via ? `首页 · ${via}` : m.from === 'kid' ? m.text : `系统:${m.text}`;
        const b = m.via?.button;
        const kind = m.from === 'system' ? 'system' : m.lecture ? 'lecture' : m.activity ? 'activity' : typeof b === 'number' ? 'start' : 'new';
        th = { thread: id, at: m.at, title: Array.from(raw.trim()).slice(0, 20).join(''), from: m.from, via, start: { kind, label: kind === 'new' ? '新话题' : (via ?? m.lecture?.title ?? '') }, said: null, endAt: null, notes: [], remembered: [], writes: [], sections: 0, stoppedAt: null, rating: index.ratings[id] ?? null, booked: id in index.booked };
        by.set(id, th);
      }
      if (m.lecture && !th.lecture) th.lecture = { bundle: m.lecture.bundle, title: m.lecture.title, ...(m.lecture.video ? { video: true as const } : {}), watchedMs: m.lecture.watchedMs, finished: m.lecture.finished, marks: (m.lecture.marks ?? []).length };
      // 孩子自己说的第一句:首页按钮发出去的那句(正文就是按钮上的字)不算
      if (th.said === null && m.from === 'kid' && m.text.trim() && !(m.via && viaSendsLabel(m.via) && m.via.label === m.text)) th.said = Array.from(m.text.trim()).slice(0, 30).join('');
      const t0 = Date.parse(m.timing?.startedAt ?? '');
      const dt = m.timing?.doneMs;
      if (Number.isFinite(t0) && dt !== undefined) th.endAt = new Date(t0 + dt).toISOString();
      const tail = (m.parentText ?? '').replace(/^##\s*家长\s*/, '').trim();
      if (tail) th.notes.push(tail);
      if (m.remembered?.length) th.remembered.push(...m.remembered);
      th.writes.push(...vaultWrites(m));
      if (m.result === 'running') th.stoppedAt = 'writing';
      else if (m.result === 'ok' && m.section && m.section.lines.length) {
        th.sections++;
        const last = m.section.lines[m.section.lines.length - 1];
        th.stoppedAt = last?.ask ? 'ask' : null;
      }
    }
    for (const d of diaries) by.get(d.id)?.writes.push(...vaultWrites(d.m));
    // 换过运行时的话题:卡上说一句,记账按钮不算它(runner.bookkeep 也会跳过)
    const runtimeName = ctx.ws.config.tutors[t.name]?.runtime ?? ctx.ws.config.runtimes.default;
    for (const th of by.values()) if (!th.booked && !sameRuntime(index, th.thread, runtimeName)) th.oldRuntime = index.sessions[th.thread].runtime;
    // 按住说话连着没发出去:实录里的 hold;孩子发成的一句(开口、打字发出去)把一串断开
    for (const th of by.values()) {
      const mine = index.messages.filter((_m, i) => ths[i] === th.thread);
      const plays = await readPlays(ctx.ws, t.name, date, new Set(mine.map((m) => m.job)));
      const holds = reelHolds(plays);
      if (!holds.length) continue;
      const sent = [...mine.filter((m) => m.from === 'kid').map((m) => (Date.parse(m.timing?.startedAt ?? '') || Date.parse(m.at))), ...plays.filter((r) => r.k === 'type' && r.e === 'send').map((r) => r.at)];
      const n = Math.max(0, ...reelMissRuns(holds, sent).map((x) => x.n));
      if (n) th.misses = n;
    }
    const booking = index.messages.some((m) => (m.bookkeep || m.tidy) && m.result === 'running');
    tutors.push({ name: t.name, display: t.display, avatar: shownAvatar(t), subject: t.subject ?? null, color: colors[t.name] ?? NEUTRAL_COLOR, turns: index.messages.length, threads: [...by.values()], booking, extras: t.extras });
  }
  const today = localDate(ctx.now());
  const names = tutors.map((t) => t.name);
  const week = await Promise.all(weekOf(date, today).map(async (d) => ({
    date: d,
    tutors: (await Promise.all(names.map(async (n) => ((await readIndex(ctx.ws, n, d)).messages.some((m) => !m.bookkeep && !m.tidy) ? n : null)))).filter((n): n is string => n !== null),
  })));
  return { title: ctx.ws.config.title, date, today, tutors, week, ready: ctx.bailian.status().ready };
}

/** 实时老师一次通话的声音(两边混好的,src/runtime/live/call.ts):<日期>.live/<时分秒>.wav;录像里实时的轮从这里放 */
const LIVE_CALL_RE = /^\d{4}-\d{2}-\d{2}\.live\/\d{6}\.wav$/;
/** 实时那一轮嘴照念的声音(字幕重放,src/runtime/live/call.ts 落的):<日期>.<job>.mouth.wav */
const MOUTH_FILE_RE = /^\d{4}-\d{2}-\d{2}\.\d{4}-\d+\.mouth\.wav$/;
/** 图片文件的扩展名(头像、照片、课本页) */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

/** 作业照片一张最多这么大(解码后;页面先缩到长边 PHOTO_MAX_SIDE 的 jpeg,通常几百 KB) */
export const PHOTO_MAX_BYTES = 3_000_000;

/**
 * 上传作业照片(R5):body {image: "data:image/jpeg;base64,…"}(也认 png)→ 落 captures/<日期>/<HHMM>-<n>.jpg → {path, w, h}。
 * 孩子端与家长端同一条路;照片只是落盘,发消息时把 path 放进 photos[] 才到老师那里。
 * w、h 是像素宽高(src/shared/jpeg.ts 的 imageSize):一节课里孩子端照它先把照片铺上照片页(同服务端收到那一条时铺的一样)
 */
async function uploadPhoto(ws: Workspace, body: unknown, now: Date): Promise<RouteResult> {
  if (!isObj(body) || typeof body.image !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 {image: data:image/jpeg;base64,…}' } };
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.image);
  if (!m) return { status: 400, json: { error: 'bad_request', message: '只认 data:image/jpeg 或 image/png 的 base64' } };
  const data = Buffer.from(m[2], 'base64');
  if (!data.length || data.length > PHOTO_MAX_BYTES) return { status: 413, json: { error: 'too_large', message: `一张最多 ${PHOTO_MAX_BYTES / 1_000_000} MB,页面该先缩到长边 ${PHOTO_MAX_SIDE}` } };
  const path = await writeCapture(ws, now, data, m[1] === 'png' ? 'png' : 'jpg');
  return { status: 201, json: { path, ...(imageSize(data) ?? {}) } };
}

/** 请求从哪来(createHandler 从请求头取):设备 cookie、来源地址 */
export interface RouteClient {
  device?: string | null;
  ip?: string;
}

/** who:请求是谁发的(createHandler 按来源地址与 cookie 算);直接调 route 的测试与 CLI 缺省 local = 本机免密 */
export async function route(method: string, path: string, ctx: AppContext, body?: unknown, who: Who = 'local', client: RouteClient = {}): Promise<RouteResult> {
  await ctx.reload();
  const ws = ctx.ws;
  const url = new URL(path, 'http://x');
  const p = url.pathname;
  try {
    // 服务起来的时刻、版本、跑的是哪个提交;仓里的提交变了 = 代码更新了,重起才用上(build.ts)。
    // pid、mode(后台服务 service / 终端里 foreground)、vault 读不读得到(macOS 上后台服务读「文稿」、iCloud 云盘里的 vault 会被系统拦,没有弹窗):cotutor service status 看
    if (p === '/api/health') {
      const head = await headNow();
      const vault = await readdir(ws.paths.vault).then(() => 'ok', (err: NodeJS.ErrnoException) => (err.code === 'EPERM' || err.code === 'EACCES' ? 'denied' : 'missing'));
      return { status: 200, json: { ok: true, configError: ctx.configError, started: BUILD.started, version: BUILD.version, commit: shortCommit(BUILD.commit), dirty: BUILD.dirty, head: shortCommit(head), changed: codeChanged(BUILD.commit, head), pid: process.pid, mode: process.env.COTUTOR_SERVICE ? 'service' : 'foreground', vault, calls: ctx.openCalls?.() ?? 0, bailian: ctx.bailian.status().ready, bailianTrouble: ctx.bailian.trouble(), latest: isNewer(knownLatest(), BUILD.version) ? knownLatest() : null, latestNotes: isNewer(knownLatest(), BUILD.version) ? knownNotes() : [] } };
    }
    // 家长端与工作台的锁(access.ts):对 PIN 换 cookie;设了 PIN、没凭证的设备,孩子端以外的页面回输 PIN 的页、接口回 401。没设 PIN 什么都不拦
    if (p === '/api/auth') {
      if (method === 'GET') return { status: 200, json: { who, pin: await ctx.access.pinSet() } };
      if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
      const r = await ctx.access.login(isObj(body) && typeof body.pin === 'string' ? body.pin : '', { secure: Boolean(ctx.listen?.().https) });
      if (r.ok) return { status: 200, json: { ok: true }, setCookie: r.cookie };
      return { status: r.retryMs ? 429 : 401, json: { error: r.retryMs ? 'locked' : 'pin', ...(r.retryMs ? { retryMs: r.retryMs } : {}) } };
    }
    if (who === 'anon' && !isKidPath(p) && (await ctx.access.pinSet())) {
      return method === 'GET' && !p.startsWith('/api/') ? { status: 401, html: gatePage(ws.config.title) } : { status: 401, json: { error: 'auth', message: '要家长 PIN:在 /parent 或 /dev 上输一次' } };
    }
    // 工作台概览:近七天的轮数、今天各老师、用量、要看一眼的轮次;体检 = doctor 不带 --live(不花钱)
    if (p === '/api/dev/overview' && method === 'GET') return { status: 200, json: await devOverview(ws) };
    // 孩子端的设备:对话页拿它给每轮写设备名;起名写进设备表,空着 = 去掉名字
    if (p === '/api/dev/devices' && method === 'GET') {
      const table = await readDevices(ws);
      return { status: 200, json: Object.fromEntries(Object.entries(table).map(([id, d]) => [id, { name: d.name ?? null, label: d.label }])) };
    }
    const devRename = /^\/api\/dev\/devices\/([0-9a-f]{12})$/.exec(p);
    if (devRename && method === 'PATCH') {
      if (!isObj(body) || typeof body.name !== 'string') return { status: 400, json: { error: 'bad_request' } };
      return (await renameDevice(ws, devRename[1], body.name)) ? { status: 200, json: { ok: true } } : { status: 404, json: { error: 'no_such_device' } };
    }
    if (p === '/api/dev/doctor' && method === 'POST') {
      const r = await doctorWorkspace(ws.root, { live: false });
      return { status: 200, json: { ok: r.ok, at: new Date().toISOString(), checks: r.checks.map((c) => ({ name: c.name, ok: c.ok, required: c.required, detail: redactHome(c.detail), fix: c.fix })) } };
    }
    // 工作台改 activity:只认 workspace 里列得出的名字;存要带读进来时的 hash,对不上 409
    if (p === '/api/dev/activities' && method === 'GET') return { status: 200, json: await listDevActivities(ws) };
    const da = /^\/api\/dev\/activities\/([a-z0-9][a-z0-9-]*)\/([^/]+?)(\/check|\/restore)?$/.exec(p);
    if (da) {
      const [, tutor, raw, sub] = da;
      let name: string;
      try { name = decodeURIComponent(raw); } catch { return { status: 400, json: { error: 'bad_request' } }; }
      if (!(await findDevActivity(ws, tutor, name))) return { status: 404, json: { error: 'no_such_activity', tutor, name } };
      if (!sub && method === 'GET') return { status: 200, json: await readDevActivity(ws, tutor, name) };
      if (sub === '/check' && method === 'POST') {
        if (!isObj(body) || typeof body.text !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 {text, params?}' } };
        const params = isObj(body.params) ? Object.fromEntries(Object.entries(body.params).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {};
        return { status: 200, json: await checkDevActivity(ws, tutor, name, body.text, params) };
      }
      if (!sub && method === 'PUT') {
        if (!isObj(body) || typeof body.text !== 'string' || typeof body.base !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 {text, base}' } };
        try {
          return { status: 200, json: await saveDevActivity(ws, tutor, name, body.text, body.base) };
        } catch (err) {
          if (err instanceof ActivityConflict) return { status: 409, json: { error: 'conflict', message: '这份文件在别处改过了', hash: err.hash } };
          throw err;
        }
      }
      if (sub === '/restore' && method === 'POST') return { status: 200, json: await restoreDevActivity(ws, tutor, name) };
      return { status: 405, json: { error: 'method_not_allowed' } };
    }
    // 工作台「分块」页(src/app/http/dev-zones.ts):课本一课的分块看、查、存、还原;一课一起存,带读进来时的 version,对不上 409
    if (p === '/api/dev/zones' && method === 'GET') return { status: 200, json: await listDevZones(ws) };
    if (p === '/api/dev/zones/stale' && method === 'DELETE') return (await dropStaleZones(ws, url.searchParams.get('sha') ?? '')) ? { status: 200, json: { ok: true } } : { status: 404, json: { error: 'not_found' } };
    if (p === '/api/dev/zones/say' && method === 'POST') {
      if (!isObj(body) || typeof body.b !== 'string' || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 400) return { status: 400, json: { error: 'bad_request', message: '要 {b, text}' } };
      const r = await sayDevZone(ws, body.b, body.text.trim());
      return 'file' in r ? { status: 200, file: r.file, contentType: 'audio/mpeg' } : { status: 404, json: { error: 'no_audio', message: r.error } };
    }
    if (p === '/api/dev/zones/lesson' || p === '/api/dev/zones/check') {
      const src = method === 'GET' || method === 'DELETE' ? { b: url.searchParams.get('b'), l: url.searchParams.get('l') } : isObj(body) ? body : {};
      if (typeof src.b !== 'string' || typeof src.l !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 b(册名)和 l(课)' } };
      const ref = await devZoneLesson(ws, src.b, src.l);
      if (!ref) return { status: 404, json: { error: 'no_such_lesson' } };
      if (p === '/api/dev/zones/check' && method === 'POST') return { status: 200, json: checkDevZoneLesson(ref, isObj(body) ? body.pages : null) };
      if (p === '/api/dev/zones/lesson' && method === 'GET') return { status: 200, json: await readDevZoneLesson(ws, ref) };
      if (p === '/api/dev/zones/lesson' && method === 'DELETE') return { status: 200, json: await restoreDevZoneLesson(ws, ref) };
      if (p === '/api/dev/zones/lesson' && method === 'PUT') {
        if (!isObj(body) || typeof body.version !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 {b, l, version, pages}' } };
        try {
          return { status: 200, json: await saveDevZoneLesson(ws, ref, body.version, body.pages) };
        } catch (err) {
          if (err instanceof ZonesConflict) return { status: 409, json: { error: 'conflict', message: err.message } };
          throw err;
        }
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }
    if (p === '/api/workspace' && method === 'GET') return { status: 200, json: workspaceReport(ws) };
    if (p === '/api/config') {
      if (method === 'GET') {
        return {
          status: 200,
          json: {
            title: ws.config.title,
            root: redactHome(ws.root),
            kid: ws.config.kid,
            server: ws.config.server,
            runtime: ws.config.runtimes.default,
            runtimes: Object.keys(ws.config.runtimes).filter((k) => k !== 'default'),
            policyDefaults: ws.config.policyDefaults,
            paths: ws.config.paths,
            resolvedPaths: Object.fromEntries(Object.entries(ws.paths).map(([k, v]) => [k, redactHome(v)])),
            /** 实时老师:总开关、嘴的模型、哪几位老师走实时用哪个音色(家长端「样子与声音」改) */
            live: ws.config.live,
            theme: ws.config.kid.theme,
            https: ws.config.server.https ?? null,
            shipped: (await shippedAgents((await workspaceGradePack(ws.root)).agentsDir)).map((s) => s.name),
            /** 老 workspace 的政策文件缺的出厂件(新老师 / 新运行时 / 模板里的新旗标);设置页据此提示一行 */
            migrate: await configGapsOf(ws.root),
            tutors: listTutors(ws.config),
            /** 学科色:每位老师现在用的(写了的、主科的、自动分的),与工作台点选的色块 */
            colors: tutorColors(ws.config.tutors),
            palette: { subject: SUBJECT_COLORS, auto: TUTOR_PALETTE },
            /** 老师条目的原始政策补丁(页面区分「继承」与「覆盖」) */
            tutorPatches: Object.fromEntries(Object.entries(ws.config.tutors).map(([k, t]) => [k, t.policy ?? {}])),
          },
        };
      }
      if (method === 'PATCH') {
        if (!isObj(body)) return { status: 400, json: { error: 'bad_request', message: '要一个 JSON 对象' } };
        // 孩子那段(kid)工作台不改:按住说话在哪边在家长端设置页(/api/parent/settings),别的直接编辑文件
        await patchConfig(ws, body);
        await ctx.reload();
        return { status: 200, json: { ok: true, tutors: listTutors(ctx.ws.config), runtime: ctx.ws.config.runtimes.default } };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }
    // 政策文件补缺(与 cotutor refresh --config 同一条路):只加缺的出厂件,家长写过的值不动
    if (p === '/api/config/migrate' && method === 'POST') {
      const r = await upgradeConfig(ws.root);
      await ctx.reload();
      return { status: 200, json: { ok: true, gaps: r.gaps, applied: r.applied, installed: r.installed } };
    }
    if (p === '/api/tutors' && method === 'GET') {
      return { status: 200, json: listTutors(ws.config, { kidOnly: url.searchParams.get('kid') === '1' }) };
    }
    // ---- 加老师 / 删老师:与 cotutor add 同一条路(只建老师的家、改 cotutor.json) ----
    if (p === '/api/tutors' && method === 'POST') {
      if (!isObj(body) || typeof body.name !== 'string' || typeof body.display !== 'string' || !body.display.trim()) return { status: 400, json: { error: 'bad_request', message: '要 {name, display, subject?, avatar?, hidden?, description?}' } };
      const name = body.name.trim();
      if (ws.config.tutors[name]) return { status: 409, json: { error: 'exists', message: `cotutor.json 里已经有 ${name}` } };
      const str = (k: string): string | undefined => (typeof body[k] === 'string' && (body[k] as string).trim() ? (body[k] as string).trim() : undefined);
      const r = await addTutorHome(ws.root, name);
      await patchConfig(ws, { tutors: { [name]: { display: body.display.trim(), ...(str('description') ? { description: str('description') } : {}), ...(str('subject') ? { subject: str('subject') } : {}), ...(str('avatar') ? { avatar: str('avatar') } : {}), enabled: true, ...(body.hidden === true ? { hidden: true } : {}) } } });
      await ctx.reload();
      return { status: 201, json: { ok: true, ...r, tutors: listTutors(ctx.ws.config) } };
    }
    const tf = /^\/api\/tutors\/([a-z0-9][a-z0-9-]*)$/.exec(p);
    if (tf) {
      const [, name] = tf;
      if (!ws.config.tutors[name]) return { status: 404, json: { error: 'no_such_tutor', tutor: name } };
      // 删老师:只从 cotutor.json 拿掉;老师的家(activity)、会话与记忆不动
      if (method === 'DELETE') {
        if ((await shippedAgents((await workspaceGradePack(ws.root)).agentsDir)).some((a) => a.name === name)) return { status: 400, json: { error: 'shipped', message: `${name} 是出厂老师,不删;不想用就在老师团页关掉` } };
        await patchConfig(ws, { tutors: { [name]: null } });
        await ctx.reload();
        return { status: 200, json: { ok: true, tutors: listTutors(ctx.ws.config) } };
      }
      return { status: 405, json: { error: 'method_not_allowed' } };
    }

    // ---- 孩子端:过滤在服务端做,永远不带工具 / 错误 / 评判 ----
    if (p === '/api/kid/home' && method === 'GET') return { status: 200, json: await kidHome(ctx, ctx.now()) };
    // 孩子端的流水:一次打开、页面脚本出错;没有设备 cookie 就种一枚
    if (p === '/api/kid/log' && method === 'POST') {
      const row = parseKidLog(body);
      if (!row) return { status: 400, json: { error: 'bad_request' } };
      const known = validDevice(client.device);
      const device = known ?? newDeviceId();
      await recordKidLog(ws, row, { device, ip: client.ip, srv: { v: BUILD.version, commit: shortCommit(BUILD.commit), started: BUILD.started } }, ctx.now()).catch((err) => console.error('kid-log: 落盘失败', err));
      return { status: 200, json: { ok: true }, ...(known ? {} : { setCookie: deviceCookie(device, Boolean(ctx.listen?.().https)) }) };
    }
    // 试用(--sandbox):打的字配成孩子的声音,孩子端当麦克风推给嘴(trial-voice.ts);别处 404
    if (p === '/api/kid/trial/voice' && method === 'POST') return trialVoice(ws, body);
    // 按住说话的诊断:真机上出错是静默的,哪一步断了只有页面自己知道;只收事件码与毫秒,不收字也不收声音
    if (p === '/api/kid/voice-diag' && method === 'POST') {
      if (!isObj(body) || JSON.stringify(body).length > 4000) return { status: 400, json: { error: 'bad_request' } };
      const row = { at: ctx.now().toISOString(), ...body };
      await mkdir(join(ws.root, '.cotutor'), { recursive: true });
      await appendFile(join(ws.root, '.cotutor', 'voice-diag.jsonl'), `${JSON.stringify(row)}\n`).catch(() => {});
      return { status: 200, json: { ok: true } };
    }
    const kid =/^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|messages|preview|photos|play|\d{4}-\d{2}-\d{2})$/.exec(p);
    if (kid) {
      const [, tutor, tail] = kid;
      const t = ws.config.tutors[tutor];
      if (!t || !t.enabled || t.hidden) return { status: 404, json: { error: 'no_such_tutor' } };
      const date = localDate(ctx.now());
      // 录像的实录:孩子端每 10 秒一批 {thread, sentAt, records};时刻按 sentAt 把两边的钟差校到服务端;
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
          if (!playRecordOk(x)) continue;
          const at = Math.round(x.at + skew);
          if (at > now + 60_000 || at < now - 86_400_000) continue;
          rows.push(JSON.stringify({ ...x, at }));
        }
        if (rows.length) await appendFile(conversationFiles(ws.dirs.conversations, tutor, date).play(last), `${rows.join('\n')}\n`).catch(() => {});
        return { status: 200, json: { kept: rows.length } };
      }
      // 作业照片(R5):先传图拿 path,再连 path 一起发消息;不起老师、不计上限
      if (tail === 'photos') return method === 'POST' ? uploadPhoto(ws, body, ctx.now()) : { status: 405, json: { error: 'method_not_allowed' } };
      // 左栏的纸:GET ?key=<话题 | new> 读;PUT {key, state} 存(清掉那几版的图只认 captures/ 里在的)。不起老师
      if (tail === 'today' && method === 'GET') {
        return { status: 200, json: await kidDay(ctx, tutor, date) };
      }
      // 以前的某一天(只读回放;未来的日期与坏日期 400)
      if (DATE_RE.test(tail) && method === 'GET') {
        if (tail > date || Number.isNaN(Date.parse(tail))) return { status: 400, json: { error: 'bad_request' } };
        return { status: 200, json: await kidDay(ctx, tutor, tail) };
      }
      // 话题的预览图(首页「今天」那一格):PUT {thread, image} 孩子端板停下来时交一张(只收今天的话题);GET ?thread=&date= 取
      if (tail === 'preview' && method === 'PUT') {
        if (!isObj(body) || typeof body.thread !== 'string') return { status: 400, json: { error: 'bad_request' } };
        return (await writePreview(ws, tutor, date, body.thread, body.image)) ? { status: 200, json: { ok: true } } : { status: 400, json: { error: 'bad_request' } };
      }
      if (tail === 'preview' && method === 'GET') {
        const d = url.searchParams.get('date') ?? date;
        const pv = DATE_RE.test(d) ? await previewOf(ws, tutor, d, url.searchParams.get('thread') ?? '') : null;
        return pv ? { status: 200, file: pv.file, contentType: 'image/jpeg', cacheControl: 'no-cache' } : { status: 404, json: { error: 'not_found' } };
      }
      // 孩子端发一条只走实时那条连接(/api/live/<老师>/ws,src/runtime/live/turns.ts);没有 HTTP 的发
      return { status: 405, json: { error: 'method_not_allowed' } };
    }
    // 字幕重放:实时那一轮嘴照念的声音在哪、多长、讲稿每句从哪开始(毫秒);只给实时的轮,没落过声音 404
    const mouth = /^\/api\/kid\/conversations\/([a-z0-9][a-z0-9-]*)\/mouth\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d+)$/.exec(p);
    if (mouth) {
      const [, tutor, d, job] = mouth;
      const t = ws.config.tutors[tutor];
      if (!t || !t.enabled || t.hidden) return { status: 404, json: { error: 'no_such_tutor' } };
      if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
      const m = (await readIndex(ws, tutor, d)).messages.find((x) => x.job === job);
      if (m?.live !== true) return { status: 404, json: { error: 'not_found' } };
      const raw = await readFile(conversationFiles(ws.dirs.conversations, tutor, d).mouth(job, 'json'), 'utf8').catch(() => null);
      // 正在重落的那一下可能读到半截:当没有
      let idx: MouthIndex | null = null;
      try { idx = raw === null ? null : (JSON.parse(raw) as MouthIndex); } catch { idx = null; }
      if (!idx?.lines?.length) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, json: { audio: `/api/audio/${tutor}/${d}.${job}.mouth.wav`, ms: idx.ms, lines: idx.lines } };
    }
    // 老师头像(R5b):cotutor.json 里 avatar 是图片相对路径时(figshot 写的 avatars/<老师>.png)从这里取;
    // 没写(或还是旧的出厂 emoji)的三门主科给包里的出厂头像(avatars.ts);
    // emoji 头像、越界、不是图、不存在都 404(孩子端退回显示 emoji / 首字)。no-cache:figshot 换了脸孩子端要马上见到
    const av = /^\/api\/kid\/avatar\/([a-z0-9][a-z0-9-]*)$/.exec(p);
    if (av && method === 'GET') {
      const factory = ws.config.tutors[av[1]] ? factoryAvatarFile(ws.config.tutors[av[1]]) : null;
      if (factory) return { status: 200, file: factory, contentType: 'image/webp', cacheControl: 'no-cache' };
      const rel = ws.config.tutors[av[1]]?.avatar ?? '';
      const file = resolve(ws.root, rel);
      const ext = IMAGE_EXT.exec(rel)?.[1]?.toLowerCase() ?? '';
      if (!rel || isAbsolute(rel) || !file.startsWith(ws.root + sep) || !IMAGE_TYPES[ext]) return { status: 404, json: { error: 'not_found' } };
      if (!(await stat(file).catch(() => null))?.isFile()) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, file, contentType: IMAGE_TYPES[ext], cacheControl: 'no-cache' };
    }
    // 写字卡的笔顺:一个汉字一份 JSON,数据包里现读;不是汉字 / 没有这个字 404(页面只显示字形不动)
    const hz = /^\/api\/kid\/tianzige\/([^/]+)$/.exec(p);
    if (hz && method === 'GET') {
      const d = await tianzigeData(decodeURIComponent(hz[1]));
      return d ? { status: 200, json: d, cacheControl: 'max-age=86400' } : { status: 404, json: { error: 'not_found' } };
    }
    // 英文单词的笔顺:词里每个字母的点序列(src/chalk/glyphs 现采);写不出的词 404(页面退成字体的字)
    const lt = /^\/api\/kid\/letters\/([^/]+)$/.exec(p);
    if (lt && method === 'GET') {
      const d = lettersData(decodeURIComponent(lt[1]));
      return d ? { status: 200, json: d, cacheControl: 'max-age=86400' } : { status: 404, json: { error: 'not_found' } };
    }
    // 视频小课堂(第 4 步):lectures/<id>/ 的课名与一句一段(舞台包的播放器拼时钟用),与 video.mp4(Range 由 sendFile 管)
    const lv = /^\/api\/kid\/lectures\/([a-z0-9][a-z0-9-]*)\/(lecture\.json|video\.mp4)$/.exec(p);
    if (lv && method === 'GET') {
      const { lecture: l } = await inspectLecture(ws, lv[1]);
      if (!l?.video) return { status: 404, json: { error: 'not_found' } };
      if (lv[2] === 'video.mp4') return { status: 200, file: join(ws.dirs.lectures, lv[1], 'video.mp4'), contentType: 'video/mp4', cacheControl: 'no-cache' };
      return { status: 200, json: { title: l.title, total: l.clock.total, segments: l.clock.segments.map((x) => ({ start: x.start, len: x.len, line: x.line })) } };
    }
    // 图:只认 workspace 根以内的图片文件(作业照片、窗图);越界、不是图、不存在都 404
    if (p === '/api/kid/image' && method === 'GET') {
      const rel = url.searchParams.get('p') ?? '';
      const file = resolve(ws.root, rel);
      const ext = IMAGE_EXT.exec(rel)?.[1]?.toLowerCase() ?? '';
      if (!rel || isAbsolute(rel) || !file.startsWith(ws.root + sep) || !IMAGE_TYPES[ext]) return { status: 404, json: { error: 'not_found' } };
      if (!(await stat(file).catch(() => null))?.isFile()) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, file, contentType: IMAGE_TYPES[ext] };
    }
    // 照片页的点字:这张作业照片上认出的字词与行框(认是 runner 在后台起的,流式落在照片旁边;舞台轮询)。只认 captures/ 里在的照片
    // 课本页(vault 里教材那篇旁边同名文件夹里的图):拍照屏上「选课本页」;只列这位老师学科的册子
    if (p === '/api/kid/textbook-pages' && method === 'GET') {
      const tutor = url.searchParams.get('tutor') ?? '';
      const t = ws.config.tutors[tutor];
      if (!t) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, json: { books: await listTextbookPages(ws.paths.textbooks, canonicalSubject(t.subject)) } };
    }
    if (p === '/api/kid/textbook-page' && (method === 'GET' || method === 'POST')) {
      const book = method === 'GET' ? (url.searchParams.get('b') ?? '') : isObj(body) && typeof body.book === 'string' ? body.book : '';
      const name = method === 'GET' ? (url.searchParams.get('f') ?? '') : isObj(body) && typeof body.file === 'string' ? body.file : '';
      const file = await textbookPageFile(ws.paths.textbooks, book, name);
      if (!file) return { status: 404, json: { error: 'not_found' } };
      if (method === 'GET') return { status: 200, file, contentType: IMAGE_TYPES[extname(file).slice(1).toLowerCase()] };
      // 选了这一页:拷进 captures/(同孩子拍的照片),回路径;发消息时放进 photos[]
      const data = await readFile(file);
      const path = await writeCapture(ws, ctx.now(), data, /\.png$/i.test(file) ? 'png' : 'jpg');
      return { status: 200, json: { path, ...(imageSize(data) ?? {}) } };
    }
    // 课本(base: textbook 的 activity,出厂语文、数学的「课本」):PDF 本身(舞台的 pdf.js 分段取,Range 由 sendFile 管)与几页的行和字(点字、找位置);b = 册子的文件名,p = PDF 的几页(59-60)
    if (p === '/api/kid/textbook/pdf' && method === 'GET') {
      const file = await bookFile(ws.paths.textbooks, url.searchParams.get('b') ?? '');
      if (!file) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, file, contentType: 'application/pdf' };
    }
    // 课本的封面(首页课本那张卡;src/memory/textbook-cover.ts):GET ?b= 取画好的;PUT {book, image} 孩子端首页画了第 1 页交上来
    if (p === '/api/kid/textbook/cover' && (method === 'GET' || method === 'PUT')) {
      const covers = join(ws.root, '.cotutor', 'covers');
      if (method === 'PUT') {
        const ok = isObj(body) && typeof body.book === 'string' && (await saveCover(ws.paths.textbooks, covers, body.book, body.image));
        return ok ? { status: 200, json: { ok: true } } : { status: 400, json: { error: 'bad_request' } };
      }
      const got = await readCover(ws.paths.textbooks, covers, url.searchParams.get('b') ?? '');
      return got ? { status: 200, file: got.file, contentType: 'image/jpeg' } : { status: 404, json: { error: 'not_found' } };
    }
    // 课本做底:这位老师学科、这学期那一册的目录当一页(孩子端新开一节课先铺它,老师翻到哪一课再换)和目录上能点的那几项(回到一节课时也要);没有课本 = lesson: null
    if (p === '/api/kid/textbook/base' && method === 'GET') {
      const t = ws.config.tutors[url.searchParams.get('tutor') ?? ''];
      if (!t) return { status: 404, json: { error: 'not_found' } };
      const name = pickBook(await listBooks(ws.paths.textbooks, canonicalSubject(t.subject) || null), ctx.now());
      const base = name ? await bookBase(ws, name) : null;
      return { status: 200, json: { lesson: base?.lesson ?? null, toc: base?.toc ?? null } };
    }
    // 练习册(base: workbook;w = 练习册/ 下那一册的文件夹名):铺成一节课的开头(孩子端点了按钮就先铺,不等老师)、第 n 页的图、几页的行和分块(能写的格、点读的块照它)、
    // 点读一块(z = 块的 id,同课本的 /api/kid/textbook/say:用这位老师点读的声音合成那一块的 say,有缓存)。
    // 只给孩子端看得到的:作答区的名字、物件、给老师的答案都不下发(src/schema/workbook.ts 的 workbookKidPage、zonesKidPage)
    if (p.startsWith('/api/kid/workbook/') && method === 'GET') {
      const name = url.searchParams.get('w') ?? '';
      const got = await readWorkbook(ws.paths.workbooks, name);
      if (!('wb' in got)) return { status: 404, json: { error: 'not_found' } };
      if (p === '/api/kid/workbook/base') {
        const t = ws.config.tutors[url.searchParams.get('tutor') ?? ''];
        const pick = canonicalSubject(t?.subject) !== '数学';
        return { status: 200, json: { lesson: lessonStep(lessonInit(), { t: 'act', act: { k: '翻', page: workbookPage(name, got.wb, pick) } }) } };
      }
      if (p === '/api/kid/workbook/image') {
        const file = await workbookImageFile(ws.paths.workbooks, name, got.wb, Number(url.searchParams.get('p')));
        return file ? { status: 200, file, contentType: 'image/png' } : { status: 404, json: { error: 'not_found' } };
      }
      if (p === '/api/kid/workbook/lines') { const layer = workbookLayer(got.wb); return { status: 200, json: { pages: layer.pages, zones: layer.zones.map(zonesKidPage) } }; }
      if (p === '/api/kid/workbook/say') {
        const tutor = url.searchParams.get('tutor') ?? '', id = url.searchParams.get('z') ?? '';
        const voice = ws.config.tutors[tutor] ? cardVoice(ws.config.tutors, tutor) : undefined;
        let text = '';
        for (const zp of workbookLayer(got.wb).zones) walkZones(zp.zones, (z) => { if (!text && z.id === id && z.say) text = z.say; });
        if (!voice || !text) return { status: 404, json: { error: 'not_found' } };
        const r = await synthesize({ text, voice }, { cacheDir: ws.dirs.tts, env: process.env });
        if (!r.file) { console.error(`点读一块(练习册):「${text}」没合成(${r.error ?? '?'})`); return { status: 404, json: { error: 'no_audio' } }; }
        return { status: 200, file: r.file, contentType: 'audio/mpeg' };
      }
      return { status: 404, json: { error: 'not_found' } };
    }
    // 作业本(base: homework,检查作业;src/runtime/homework.ts):
    //   photo 作业本里的一张(vault 里的;首页作业本封面上最近那张)
    //   past  这个话题的作业本上每张照片以前的话题留下的记号(键是照片的 src,照片自己的坐标);date + thread = 现在这个话题(它自己的、在它之后的不算)
    if (p.startsWith('/api/kid/homework/') && method === 'GET') {
      const q = url.searchParams, tutor = q.get('tutor') ?? '';
      const t = ws.config.tutors[tutor];
      if (!t) return { status: 404, json: { error: 'not_found' } };
      if (p === '/api/kid/homework/photo') {
        const file = await homeworkFile(ws.paths.homework, homeworkSubject(ws, tutor), q.get('day') ?? '', q.get('f') ?? '');
        return file ? { status: 200, file, contentType: IMAGE_TYPES[extname(file).slice(1).toLowerCase()] } : { status: 404, json: { error: 'not_found' } };
      }
      if (p === '/api/kid/homework/past') {
        const date = q.get('date') ?? '', thread = q.get('thread') ?? '';
        if (!DATE_RE.test(date) || !/^\d{4}-\d+$/.test(thread)) return { status: 400, json: { error: 'bad_request' } };
        const page = (await readLesson(ws, tutor, date, thread)).pages.find((x) => x.kind === 'photo' && x.day);
        return { status: 200, json: { past: page?.kind === 'photo' ? await homeworkPast(ws, tutor, page.photos.map((x) => x.src), { date, thread }) : {} } };
      }
      return { status: 404, json: { error: 'not_found' } };
    }
    // 家长端导出作业本:days = 选的那几天(逗号隔开),一张照片一页的 PDF(src/shared/pdf.ts);不是 jpeg 的跳过
    if (p === '/api/parent/homework/pdf' && method === 'GET') {
      const tutor = url.searchParams.get('tutor') ?? '';
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'not_found' } };
      const days = (url.searchParams.get('days') ?? '').split(',').filter((d) => DATE_RE.test(d));
      if (!days.length) return { status: 400, json: { error: 'bad_request', message: '要 days=YYYY-MM-DD,…' } };
      const r = await homeworkPdf(ws, tutor, days);
      return { status: 200, body: r.pdf, contentType: 'application/pdf', cacheControl: 'no-store', download: homeworkPdfName(homeworkSubject(ws, tutor), days) };
    }
    // 进门(孩子先说):首页 activity 按钮点进来,body 同孩子发的一条少 text({via, device});服务端记一条「进门」、铺好页,不叫老师,回话题 id。
    // 老师正在回上一条 → 409(孩子端过一会儿再进);离开(点回首页)时没开口的话题删掉({thread})
    if (p === '/api/kid/enter' && method === 'POST') {
      const tutor = url.searchParams.get('tutor') ?? '';
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'not_found' } };
      const date = localDate(ctx.now());
      const got = await ctx.runner.accept(tutor, { ...(isObj(body) ? body : {}), text: '' }, date, client.device);
      if ('reject' in got) return { status: got.reject.status, json: { error: got.reject.error } };
      if (!got.input.activity || !got.input.via || got.input.lecture) return { status: 400, json: { error: 'bad_request' } };
      return { status: 200, json: await ctx.runner.enter(tutor, got.input) };
    }
    if (p === '/api/kid/leave' && method === 'POST') {
      const tutor = url.searchParams.get('tutor') ?? '';
      const thread = isObj(body) && typeof body.thread === 'string' ? body.thread : '';
      if (!ws.config.tutors[tutor] || !/^\d{4}-\d+$/.test(thread)) return { status: 400, json: { error: 'bad_request' } };
      return { status: 200, json: { gone: await ctx.runner.leave(tutor, localDate(ctx.now()), thread) } };
    }
    // 一节课此刻的样子(src/runtime/journal/lesson-store.ts):孩子端回到这节课、刷新页面时照它铺;只读的(以前的、家长看)也照它
    if (p === '/api/kid/lesson' && method === 'GET') {
      const tutor = url.searchParams.get('tutor') ?? '', date = url.searchParams.get('date') ?? '', thread = url.searchParams.get('thread') ?? '';
      if (!ws.config.tutors[tutor] || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[0-9A-Za-z.-]{1,40}$/.test(thread)) return { status: 404, json: { error: 'not_found' } };
      const l = await readLesson(ws, tutor, date, thread);
      return { status: 200, json: { lesson: l.at ? l : null } };
    }
    // 一课几页的文字层和这一课挑好的分块(孩子端的那份:块的框与种类、能写的格;给老师的、答案不下发)。页上的格照分块给,索引里的 cells 不下发
    if (p === '/api/kid/textbook/lines' && method === 'GET') {
      const want = bookPages(url.searchParams.get('p') ?? '');
      const book = want.length ? await bookOpen(ws, url.searchParams.get('b') ?? '') : null;
      if (!book) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, json: { pages: book.index.pages.filter((x) => want.includes(x.n)).map(({ cells: _c, ...pg }) => pg), zones: pickBookZones(book.index, book.zones, want).pages.map(zonesKidPage) } };
    }
    // 点读课文(语文课本的一课,docs/dev/课本.md):这一课整篇一次合成(块和句照 bookReadTexts 分,舞台照同一份行摆钮),用这位老师「点读的声音」,
    // 带每个字的时间(有缓存,再读不花钱);回 {times[k][s]: 第 k 块第 s 句从第几毫秒起, end},加 audio=1 回那份声音(同一份缓存,能分段取)。
    // 字由服务端照课本现取,孩子端只给页。没配声音、合成失败 404(孩子端停下,不出错)
    if (p === '/api/kid/textbook/read' && method === 'GET') {
      const q = url.searchParams, tutor = q.get('tutor') ?? '';
      const voice = ws.config.tutors[tutor] ? cardVoice(ws.config.tutors, tutor) : undefined;
      const want = bookPages(q.get('p') ?? '');
      if (!voice || !want.length) return { status: 404, json: { error: 'not_found' } };
      const book = await bookOpen(ws, q.get('b') ?? '');
      if (!book || book.index.layout === 'math') return { status: 404, json: { error: 'not_found' } };
      const pages = book.index.pages.filter((x) => want.includes(x.n));
      const texts = bookReadTexts(pages, zoneBlocks(pages, pickBookZones(book.index, book.zones, want).pages, book.index.layout));
      if (!texts.length) return { status: 404, json: { error: 'not_found' } };
      const text = readLessonText(texts);
      const r = await synthesizeTimed({ text, voice }, { cacheDir: ws.dirs.tts, env: process.env });
      if (!r.file) { console.error(`点读:《${pages[0]?.n ?? '?'} 页起》整篇 ${text.length} 字没合成(${r.error ?? '?'})`); return { status: 404, json: { error: 'no_audio' } }; }
      if (q.get('audio') === '1') return { status: 200, file: r.file, contentType: 'audio/mpeg' };
      return { status: 200, json: readTimes(texts, r.words) };
    }
    // 点读一块(分块里有念法 say 的块,docs/dev/课本.md):用这位老师「点读的声音」合成那一块的念法(有缓存,同一块同一个音色只合成一次),回声音。
    // 念法由服务端照这一课挑好的分块现取,孩子端只给块的 id;没配声音、没有这一块、合成失败 404
    if (p === '/api/kid/textbook/say' && method === 'GET') {
      const q = url.searchParams, tutor = q.get('tutor') ?? '', id = q.get('z') ?? '';
      const voice = ws.config.tutors[tutor] ? cardVoice(ws.config.tutors, tutor) : undefined;
      const want = bookPages(q.get('p') ?? '');
      if (!voice || !want.length || !id) return { status: 404, json: { error: 'not_found' } };
      const book = await bookOpen(ws, q.get('b') ?? '');
      let text = '';
      if (book) for (const zp of pickBookZones(book.index, book.zones, want).pages) walkZones(zp.zones, (z) => { if (!text && z.id === id && z.say) text = z.say; });
      if (!text) return { status: 404, json: { error: 'not_found' } };
      const r = await synthesize({ text, voice }, { cacheDir: ws.dirs.tts, env: process.env });
      if (!r.file) { console.error(`点读一块:「${text}」没合成(${r.error ?? '?'})`); return { status: 404, json: { error: 'no_audio' } }; }
      return { status: 200, file: r.file, contentType: 'audio/mpeg' };
    }
    if (p === '/api/kid/photo-words' && method === 'GET') {
      const rel = url.searchParams.get('p') ?? '';
      if (!(await capturePathOk(ws, rel))) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, json: kidWords(await readWords(join(ws.root, rel))) };
    }
    const audio = /^\/api\/audio\/([a-z0-9][a-z0-9-]*)\/(.+)$/.exec(p);
    if (audio && method === 'GET') {
      const [, tutor, name] = audio;
      const call = LIVE_CALL_RE.test(name) || MOUTH_FILE_RE.test(name);
      if (!ws.config.tutors[tutor] || !call) return { status: 404, json: { error: 'not_found' } };
      const file = join(ws.dirs.conversations, tutor, name);
      if (!(await stat(file).catch(() => null))?.isFile()) return { status: 404, json: { error: 'not_found' } };
      // 嘴照念的那份一段一段重落(这一轮还在念时就取得到),别让孩子端拿到缓存里的半截
      return { status: 200, file, contentType: 'audio/wav', ...(MOUTH_FILE_RE.test(name) ? { cacheControl: 'no-cache' } : {}) };
    }

    // 看原文:一轮拆成六站,一个接口给全;/fixture 是原文原样一份,开发者放进 tests/fixtures/board/
    const rawRe = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2}|today)\/raw\/(\d{4}-\d+)(\/fixture)?$/.exec(p);
    if (rawRe) {
      const [, tutor, d, job, fixture] = rawRe;
      if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const view = await rawView(ws, tutor, d === 'today' ? localDate(ctx.now()) : d, job);
      if (!view) return { status: 404, json: { error: 'not_found', message: `${d} 没有 ${job} 这一轮` } };
      return { status: 200, json: fixture ? fixtureOf(view) : view };
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
    // 看录像:一个话题按时间排好的轨道;没有孩子开口的话题 404
    const reel = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(today|\d{4}-\d{2}-\d{2})\/threads\/([^/]+)\/reel$/.exec(p);
    if (reel && method === 'GET') {
      const [, tutor, tail, raw] = reel;
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const date = tail === 'today' ? localDate(ctx.now()) : tail;
      if (date > localDate(ctx.now()) || Number.isNaN(Date.parse(date))) return { status: 400, json: { error: 'bad_request', message: '日期要是今天或以前' } };
      const r = await parentReel(ctx, tutor, date, decodeURIComponent(raw));
      return r ? { status: 200, json: r } : { status: 404, json: { error: 'no_reel', message: '这个话题没有录像' } };
    }
    // 删掉一个话题(家长端「记录」清单上的「删」):那个话题还有轮在跑就 409;这个话题写进记忆、日记的一起撤(store.deleteThread),回撤了多少
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
    // 撤回话题写进 vault 的一笔(家长端「记录」的「记住了」):{job, kind, n},kind = memory / child / diary;这位老师这天还有轮在跑就 409(会写同一篇)
    const unw = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})\/threads\/([^/]+)\/vault\/undo$/.exec(p);
    if (unw && method === 'POST') {
      const [, tutor, date, raw] = unw;
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const kinds = ['memory', 'child', 'diary'];
      if (!isObj(body) || typeof body.job !== 'string' || typeof body.kind !== 'string' || !kinds.includes(body.kind) || (body.kind !== 'diary' && (typeof body.n !== 'number' || !Number.isInteger(body.n) || body.n < 0))) return { status: 400, json: { error: 'bad_request', message: '要 {job, kind: memory | child | diary, n}' } };
      if (ctx.runner.running(tutor)?.date === date) return { status: 409, json: { error: 'busy', message: '老师还在写,等它写完再撤' } };
      try {
        const { undo } = await undoVaultWrite(ws, tutor, date, decodeURIComponent(raw), { job: body.job, kind: body.kind as VaultWrite['kind'], n: typeof body.n === 'number' ? body.n : 0 });
        return undo.memory || undo.diary ? { status: 200, json: { ok: true, undo } } : { status: 409, json: { error: 'changed', message: undo.misses.join(';') || '找不到那一行,没撤', undo } };
      } catch (err) {
        if (err instanceof IndexError) return { status: 404, json: { error: 'no_such_write', message: err.message } };
        throw err;
      }
    }
    const book = /^\/api\/conversations\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})\/bookkeep$/.exec(p);
    if (book && method === 'POST') {
      const [, tutor, date] = book;
      if (!ws.config.tutors[tutor]) return { status: 404, json: { error: 'no_such_tutor', tutor } };
      const only = isObj(body) && Array.isArray(body.threads) ? (body.threads as unknown[]).filter((t): t is string => typeof t === 'string') : undefined;
      const { queued, skipped } = await ctx.runner.bookkeep(tutor, date, only);
      return { status: 202, json: { tutor, date, queued, skipped } };
    }

    // 家长端「记录」:清单与一天的讲稿,都在家长命名空间下;/api/kid/* 不动
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
        if (!isObj(body) || typeof body.text !== 'string') return { status: 400, json: { error: 'bad_request', message: '要 {text, from?, runtime?, photos?, thread?, activity?, params?}' } };
        // 工作台 /dev 与 cotutor send 发的都算孩子的话(没有 from: parent;旧客户端带 parent 也当 kid)
        const from = body.from === undefined || body.from === 'parent' ? 'kid' : body.from;
        if (!(MESSAGE_FROM as readonly unknown[]).includes(from)) return { status: 400, json: { error: 'bad_request', message: `from 只能是 ${MESSAGE_FROM.join(' / ')}` } };
        const photos = await photosOf(ws, body.photos);
        if (photos === null) return { status: 400, json: { error: 'bad_request', message: 'photos 要是 captures/ 里在的文件(先 POST …/photos 传图拿 path)' } };
        // 工作台 /dev 不带 device,缺省当平板横屏
        const device = body.device === undefined ? undefined : DeviceSchema.safeParse(body.device);
        if (device && !device.success) return { status: 400, json: { error: 'bad_request', message: 'device 只能是 phone / tablet' } };
        const action = body.action === undefined ? undefined : body.action === 'submit' ? ('submit' as const) : null;
        if (action === null) return { status: 400, json: { error: 'bad_request', message: 'action 只能是 submit' } };
        // 新话题从一个 activity 开始(同 cotutor send --activity;没有自由话题):{activity, params?: '名=值;名=值'}
        const activity = typeof body.activity === 'string' && body.activity ? await activityRunFor(ws.root, tutor, body.activity, typeof body.params === 'string' ? body.params : '') : undefined;
        const text = body.text.trim() || activity?.name || '';
        if (!text && !action && !photos?.length) return { status: 400, json: { error: 'bad_request', message: '要说点什么' } };
        const started = await ctx.runner.send(tutor, {
          from: from as (typeof MESSAGE_FROM)[number],
          text,
          action,
          runtime: typeof body.runtime === 'string' ? body.runtime : undefined,
          newThread: Boolean(activity),
          ...(activity ? { activity } : {}),
          thread: typeof body.thread === 'string' ? body.thread : undefined,
          photos,
          device: device?.data,
          // 孩子的话照实时写(同孩子端、同 replay:上下文包带 live:、讲稿不截);嘴不在,接住与打断不带。系统发的不算
          ...(from === 'kid' ? { live: {} } : {}),
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
    // 课包某一刻的画面(首页海报、播放器截图的底):烤过的课包服务端现画;没烤过先烤,烤不了 404
    const frame = /^\/api\/bundles\/([a-z0-9][a-z0-9-]*)\/frame\.svg$/.exec(p);
    if (method === 'GET' && frame) {
      const svg = await lectureFrameSvg(ws, frame[1], parseSvgMs(url.searchParams.get('svg')), parseRing(url.searchParams.get('ring')), { bake: ensureBaked });
      return svg === null ? { status: 404, json: { error: 'not_found' } } : { status: 200, body: Buffer.from(svg), contentType: 'image/svg+xml; charset=utf-8' };
    }
    if (method === 'GET' && p.startsWith('/api/bundles/')) {
      const f = await bundleAsset(ws.dirs.bundles, p);
      return f ? { status: 200, file: f.file, contentType: f.contentType } : { status: 404, json: { error: 'not_found' } };
    }
    // 家长端「首页」的接口(/api/parent/*)
    const phr = await parentHomeRoute(method, p, ctx, body); if (phr) return phr;
    const plr = await parentLookRoute(method, p, url, ctx, body); if (plr) return plr;
    const blr = await bailianRoute(method, p, ctx, body, who); if (blr) return blr;
    // 听写(路由 src/app/dictation/,页面 src/ui/dictation/,规则与存取 src/scenes/dictation/):/dictation 与 /api/dictation/* 交给它;首页的听写卡在 kid-page 画
    const tx = await dictationRoute(method, url, ctx, body); if (tx) return tx;
    if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
    // 工作台:对话原始视图、看原文、老师团、activity、设置——给有技术背景的家长与开发者;家长端在 /parent
    if (p === '/dev') return { status: 200, html: DEV_PAGE };
    // 按钮样张:老师页那颗「头像 + 按住说话」的每一种样子,调动画时看这一页
    if (p === '/dev/voice') return { status: 200, html: VOICE_GALLERY_PAGE };
    // 主屏幕(iPad「添加到主屏幕」):清单与图标都按标题现生成,没有静态资源
    if (p === '/manifest.webmanifest') return { status: 200, json: webManifest(ws.config.title), contentType: 'application/manifest+json; charset=utf-8' };
    // 孩子端的离线页(offline-sw.ts):平板打开时电脑关了、睡着了,给「老师们还没到」,不给浏览器的报错
    if (p === '/sw.js') return { status: 200, body: Buffer.from(KID_SW_JS), contentType: 'text/javascript; charset=utf-8', cacheControl: 'no-cache' };
    const icon = /^\/icon-(\d{2,4})\.png$/.exec(p);
    if (icon) {
      const n = Number(icon[1]);
      if (!(ICON_SIZES as readonly number[]).includes(n)) return { status: 404, json: { error: 'not_found' } };
      return { status: 200, body: appIconPng(n), contentType: 'image/png' };
    }
    // 网页图标(src/ui/shared/favicon.ts):所有页面都是 cotutor 的双 C;no-cache:换了 logo 马上见到
    const fav = faviconResponse(p);
    if (fav) return { status: 200, ...fav, cacheControl: 'no-cache' };
    // 试用(--sandbox):孩子端多一条键盘打字(kid-page.ts 的 TRIAL)
    if (p === '/') return { status: 200, html: kidPage(esc(ws.config.title), ws.sandbox ? { trial: true } : {}, await stageVersion()) };
    // 家长端:也是孩子端页面本身,数据走家长接口(答案在、家长的话在),卡锁着;自己的清单,加到主屏幕才不会拿到孩子端那份
    if (p === '/parent') return { status: 200, html: parentPage(esc(ws.config.title)) };
    // 家长端「首页」(设孩子的首页与几项常改的设置)
    if (p === '/parent/home') return { status: 200, html: PARENT_HOME_PAGE };
    // 家长端「设置」(设一次就不常动的:孩子的平板上按住说话那一栏放哪边)
    if (p === '/parent/settings') return { status: 200, html: PARENT_SETTINGS_PAGE };
    // 二维码的打印页:家长端「扫码打开」的「打印 ›」开它(不在孩子端的入口里)
    if (p === '/parent/qr') return ctx.listen ? { status: 200, html: qrPage(ws.config.title, ctx.listen(), url.searchParams.get('via') === 'ip' ? 'ip' : 'name', url.searchParams.get('to') === 'parent' ? 'parent' : 'kid') } : { status: 404, json: { error: 'not_listening' } };
    // 录像里孩子的屏幕:家长端录像时开在 iframe 里;直接打开也能看(调试),?tutor=&date=&thread=[&at=时:分:秒]
    if (p === '/reel') return { status: 200, html: kidPage(esc(ws.config.title), { reel: true }, await stageVersion()) };
    if (p === '/preview') return { status: 200, html: kidPage(esc(ws.config.title), { preview: true }, await stageVersion()) };
    if (p === '/parent/manifest.webmanifest') return { status: 200, json: webManifest(`${ws.config.title} · 家长`, { startUrl: '/parent', scope: '/parent' }), contentType: 'application/manifest+json; charset=utf-8' };
    return { status: 404, json: { error: 'not_found', path: p } };
  } catch (err) {
    if (err instanceof BusyError) return { status: 409, json: { error: 'busy', message: err.message } };
    if (err instanceof RuntimeError) return { status: 400, json: { error: 'bad_runtime', message: err.message } };
    if (err instanceof ConfigError) return { status: 422, json: { error: 'config', message: err.message } };
    if (err instanceof IndexError) return { status: 500, json: { error: 'index', message: err.message } };
    if (err instanceof UsageError) return { status: 400, json: { error: 'usage', message: err.message } };
    // 地址里的 % 编码写坏了(decodeURIComponent 抛的):是请求不对,不是服务出错
    if (err instanceof URIError) return { status: 400, json: { error: 'bad_request', message: '地址里的 % 编码不对' } };
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
        // HEAD 照 GET 走路由;Node 对 HEAD 的响应本来就不发正文
        r = await route(req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET'), req.url ?? '/', ctx, body, await ctx.access.whoOf(req), { device: cookieOf(req.headers.cookie, DEVICE_COOKIE), ip: req.socket.remoteAddress });
      } catch (err) {
        r = err instanceof UsageError ? { status: 400, json: { error: 'usage', message: err.message } } : { status: 500, json: { error: 'internal', message: err instanceof Error ? err.message : String(err) } };
        if (r.status === 500) console.error(err);
      }
      if (r.file !== undefined) await sendFile(req, res, r as RouteResult & { file: string });
      else if (r.body !== undefined) {
        res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/octet-stream', 'cache-control': r.cacheControl ?? 'private, max-age=86400', ...(r.download ? { 'content-disposition': `attachment; filename="homework.pdf"; filename*=UTF-8''${encodeURIComponent(r.download)}` } : {}) });
        res.end(Buffer.from(r.body));
      } else if (r.html !== undefined) {
        res.writeHead(r.status, { 'content-type': r.contentType ?? 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(r.html);
      } else {
        res.writeHead(r.status, { 'content-type': r.contentType ?? 'application/json; charset=utf-8', 'cache-control': r.cacheControl ?? 'no-store', 'x-cotutor-boot': BOOT, ...(r.setCookie ? { 'set-cookie': r.setCookie } : {}) });
        res.end(JSON.stringify(r.json ?? null));
      }
    })();
  };
}

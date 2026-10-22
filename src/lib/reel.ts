/**
 * 录像(《家长录像设计.md》):一个话题按时间排好的一条轨道——每一刻板上有哪几节、每节露了几张卡、嘴在念哪句、卡的状态、该出哪些旁注。
 * 实时的轮照通话放(<日期>.live/ 的 reel.json + wav:按下、松手、嘴每句开始放的时刻都记着);不是实时的轮(家长端试发、cotutor send)写完那一刻整节铺上、不念。
 * 2026-10-22 之前还有按每句 mp3 时长推算着「念」、拿孩子端的播放位置校正、原声与 voice-diag 补老话题的那一套,跟着讲稿配音一起删了(《产品规划.md》拍板 30)。
 *
 * 两处共用,和 kid-board.ts 一个做法:服务端 buildReel 算好下发;家长端页面把这份剥掉类型内联,拖进度条时现算 reelFrameAt / reelClock。
 * 所以**只准从 kid-board.ts 取运行时的东西**(内联时 import 行删掉,页面里本来就有那些函数)、不碰 DOM、不用 enum;顶层名字都带 reel 前缀,免得和页面撞。
 * 时刻都是墙钟毫秒(Date.parse 出来的)。
 */
import { cardTitle, lineDurationMs } from './kid-board.ts';
import type { BoardSection } from './kid-board.ts';
import type { RunEvent } from './events.ts';
import type { CardStates } from './conversation.ts';
import type { ConversationMessage } from '../schema/conversation.ts';

/** 嘴念一句的时段;audio = 那次通话的声音(相对 conversations/<老师>/),seek = 这句在里面从哪开始(毫秒) */
export interface ReelSay {
  job: string;
  line: number;
  from: number;
  to: number;
  audio: string;
  seek?: number;
}

/** 按住说话收尾时孩子看到的:sent 发出去了 · unclear「没听清,再按住说一次」· cancel 上滑取消 */
export type ReelHoldResult = 'sent' | 'unclear' | 'cancel';

/**
 * 实录(第二期,《家长录像设计.md》§4):孩子端记下的一条,落 <日期>.<job>.play.jsonl。at 是服务端的墙钟(路由按发来时两边的钟差校过)。
 * stage = 弹窗开 / 关;
 * visible = 页面切到后台 / 回来;card = 卡的一次存(服务端在 putCardState 里记,孩子端不发)。
 * 改版(拍板 6、7,孩子看到什么记什么):view = 孩子屏幕的 CSS 尺寸、键盘高、页面版本;
 * hold = 按住说话的一步(down 按下 / audio 话筒开了 / slide 上滑取消 on 或滑回来 / up 松手,cancel = 不是孩子松的手、是系统抢走了触摸(pointercancel,iPadOS 底部手势),照旧当松手 / end 收尾,r 见 ReelHoldResult,lv = 按下起每 100 毫秒一位的音量 0–9);
 * type = 打字(focus 点进输入框 / v 值变了 / send 发了 / blur 收起);ps = 发照片屏(open / tool:crop 裁剪 · pen 圈画 · rot 转 / send / cancel);
 * scroll = 孩子自己翻到哪(锚在卡上:那张卡的上沿离板书上沿 dy 像素)
 */
export type PlayRecord = { at: number } & (
  | { k: 'stage'; job: string; card: number; open: boolean }
  | { k: 'visible'; on: boolean }
  | { k: 'card'; job: string; card: number; state: unknown }
  | { k: 'view'; w: number; h: number; kb: number; v: string }
  | { k: 'hold'; e: 'down' | 'audio' | 'slide' | 'up' | 'end'; on?: boolean; r?: ReelHoldResult; lv?: string; cancel?: true }
  | { k: 'type'; e: 'focus' | 'v' | 'send' | 'blur'; v?: string }
  | { k: 'ps'; e: 'open' | 'tool' | 'send' | 'cancel'; tool?: string }
  | { k: 'scroll'; job: string; card: number; dy: number }
);

/** 一条实录的形状对不对(服务端收、读 play.jsonl 时用;坏的丢掉) */
export function playRecordOk(x: unknown): x is PlayRecord {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  const job = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d+$/.test(v);
  const int = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= -1 && v < 1000;
  const px = (v: unknown, lo: number, hi: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  const text = (v: unknown): boolean => v === undefined || (typeof v === 'string' && v.length <= 400);
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return false;
  switch (r.k) {
    case 'stage': return job(r.job) && int(r.card) && typeof r.open === 'boolean';
    case 'visible': return typeof r.on === 'boolean';
    case 'card': return job(r.job) && int(r.card) && 'state' in r;
    case 'view': return px(r.w, 100, 4000) && px(r.h, 100, 4000) && px(r.kb, 0, 2000) && typeof r.v === 'string' && r.v.length <= 16;
    case 'hold': return ['down', 'audio', 'slide', 'up', 'end'].includes(r.e as string) && (r.on === undefined || typeof r.on === 'boolean') && (r.r === undefined || ['sent', 'unclear', 'cancel'].includes(r.r as string)) && (r.lv === undefined || (typeof r.lv === 'string' && /^[0-9]{0,600}$/.test(r.lv))) && (r.cancel === undefined || r.cancel === true);
    case 'type': return ['focus', 'v', 'send', 'blur'].includes(r.e as string) && text(r.v);
    case 'ps': return ['open', 'tool', 'send', 'cancel'].includes(r.e as string) && (r.tool === undefined || (typeof r.tool === 'string' && r.tool.length <= 12));
    case 'scroll': return job(r.job) && int(r.card) && px(r.dy, -20000, 20000);
    default: return false;
  }
}

/** 弹窗开着的一段(实录) */
export interface ReelStage {
  job: string;
  card: number;
  from: number;
  to: number;
}

/**
 * 一段不是讲稿的声音(都在实时那次通话的录音里):voice = 孩子按住说的那一段(text 是嘴认成的字);mouth = 嘴接住的那句(text 是它说的)。
 * audio 相对 conversations/<老师>/;seek = 这段在 audio 里从哪开始(整次通话是一条声音)
 */
export interface ReelClip {
  kind: 'voice' | 'mouth';
  job: string;
  from: number;
  to: number;
  audio: string;
  text?: string;
  seek?: number;
}

/** 一节:什么时候出来、露几张卡的台阶(at 升序)、讲稿什么时候念完、末句是不是问句;streamed = 老师现讲(一拍一拍铺卡) */
export interface ReelTrack {
  job: string;
  at: number;
  streamed: boolean;
  cards: { at: number; n: number }[];
  doneAt: number;
  ask: boolean;
}

/** 一条消息的旁注:节前的(谁说的、做了什么)在 at 出,节尾的(给家长的、记住了、没成)在 postAt 出 */
export interface ReelNote {
  job: string;
  at: number;
  postAt: number;
}

export interface ReelCardChange {
  job: string;
  card: number;
  at: number;
  state: unknown;
}

/** 可压缩的空白:wait = 开口之后老师还没出声(前 REEL_WAIT_KEEP_MS 照放,压的是其余);think = 老师说完到下一次开口。ms = 整段真实时长(标签上写的) */
export interface ReelGap {
  kind: 'wait' | 'think';
  from: number;
  to: number;
  ms: number;
  /** think 被孩子中途的动作(改卡、开关弹窗)切开的后一段:字幕写「又过了」,不是又想了一回 */
  cont?: true;
}

/**
 * 进度条上的点:said 孩子 / 家长开口、card 孩子改了一张卡、ask 老师停下等孩子、error 这轮没成、lecture 开始看小课堂、ink 在小课堂上画了一处、
 * miss 按住说话没发出去(淡,偶尔一两次不算事)、misses 连着 REEL_MISS_STREAK 次以上没发出去(拍板 10;to 是这一串的末尾)
 */
export interface ReelMark {
  kind: 'said' | 'card' | 'ask' | 'error' | 'lecture' | 'ink' | 'miss' | 'misses';
  to?: number;
  at: number;
  job: string;
  label: string;
}

/**
 * 看小课堂的一段(《小课堂设计.md》§八第 5 步):孩子开口那条消息带来的看的过程,换成墙钟。log 每条:那一刻停在课里的哪儿、之后在不在放;
 * marks:画下去的那一刻(at)、画在课里的哪一刻(atMs)与几笔(没记 t 的当在这段末尾)
 */
export interface ReelLecture {
  job: string;
  bundle: string;
  title: string;
  video: boolean;
  from: number;
  to: number;
  log: { at: number; pos: number; play: boolean }[];
  marks: { at: number; atMs: number; svgMs: number; strokes: [number, number][][]; image?: string }[];
}

/** 按住说话的一次(拍板 6):按下 → 话筒开 → 松手 → 收尾 */
export interface ReelHold {
  from: number;
  to: number;
  audioAt: number | null;
  upAt: number | null;
  slides: { at: number; on: boolean }[];
  result: ReelHoldResult | null;
  lv: string;
}

/** 打字的一段:点进输入框到发了 / 收起;vals = 每次值变了 */
export interface ReelType {
  from: number;
  to: number;
  vals: { at: number; v: string }[];
  sent: boolean;
}

/** 发照片屏开着的一段;photo = 发出去的那条的第一张照片(相对 workspace;取消了没有) */
export interface ReelPhotoScreen {
  from: number;
  to: number;
  tools: { at: number; tool: string }[];
  sent: boolean;
  photo: string | null;
}

export interface Reel {
  startAt: number;
  endAt: number;
  tracks: ReelTrack[];
  says: ReelSay[];
  clips: ReelClip[];
  cards: ReelCardChange[];
  notes: ReelNote[];
  /** 开口 → 老师第一声(字幕行「等老师 N 秒」) */
  waits: { job: string; from: number; to: number }[];
  gaps: ReelGap[];
  marks: ReelMark[];
  /** 实录:弹窗开着的段、页面切到后台的段 */
  stages: ReelStage[];
  aways: { from: number; to: number }[];
  /** 看小课堂的几段(没有 = 这个话题不是从小课堂开始的,或那时还不记) */
  lectures: ReelLecture[];
  /** 改版补记的(拍板 6):孩子屏幕尺寸、按住说话、打字、发照片屏、自己翻板书;连着没发出去的几串(拍板 10) */
  views: { at: number; w: number; h: number; kb: number; v: string }[];
  holds: ReelHold[];
  types: ReelType[];
  photoScreens: ReelPhotoScreen[];
  scrolls: { at: number; job: string; card: number; dy: number }[];
  misses: { from: number; to: number; n: number }[];
}

/** 开口后老师多久没出声以内照真实时间放(这就是孩子感受到的慢) */
export const REEL_WAIT_KEEP_MS = 10000;
/** 老师说完到下一次开口,超过这么久就压 */
export const REEL_THINK_MIN_MS = 5000;
/** 压过的一段空白放多久 */
export const REEL_GAP_PLAY_MS = 1500;
/** 最后一件事之后再留一会儿 */
export const REEL_TAIL_MS = 1500;
/** 按住说话连着几次没发出去(中间一句也没发成)才标出来(拍板 10;待定,真看几个话题再调) */
export const REEL_MISS_STREAK = 3;
/** 「没听清,再按住说一次」在输入条上留多久(同孩子端) */
export const REEL_UNCLEAR_MS = 2500;

/**
 * 实时老师的一次通话(src/live/call.ts 落的 <日期>.live/<时分秒>.reel.json + .wav):实时的轮照它放,不推算。audio = 两边混好的那一条(相对 conversations/<老师>/);
 * startAt = 通话开始的墙钟毫秒;msgs 的时刻、playing(嘴的声音在孩子端放的时段)都是离开始的毫秒(同 src/live/recorder.ts 的 CallReel)
 */
export interface ReelCall {
  audio: string;
  startAt: number;
  msgs: readonly (readonly [number, 'o' | 'i', Record<string, unknown>])[];
  playing: readonly (readonly [number, number])[];
}

export interface ReelInput {
  /** 这个话题的消息,索引顺序 */
  messages: readonly ConversationMessage[];
  /** job → 那轮的事件(没有 events.jsonl 的轮不在) */
  events: Readonly<Record<string, readonly RunEvent[]>>;
  cards: CardStates;
  now: number;
  /** 实录(第二期):这个话题各轮的 play.jsonl 合在一起 */
  plays?: readonly PlayRecord[];
  /** 实时的轮所在的通话(《wip/实时老师设想.md》);没有通话录像的实时轮当不是实时的(写完那一刻铺上) */
  calls?: readonly ReelCall[];
}

/** 本地时间的「2026-09-28T20:29」或 ISO:都给墙钟毫秒;坏的 → NaN */
function reelParse(at: string | undefined): number {
  return at ? Date.parse(at) : NaN;
}

/** 孩子(或家长)这句在进度条上写成什么:交给老师(从首页按钮进来又交卡的,交卡更要紧)、首页按钮字、原话 */
export function reelSaid(m: Pick<ConversationMessage, 'text' | 'via' | 'action'>): string {
  if (m.action === 'submit') return '交给老师';
  if (m.via) return m.via.label;
  return m.text;
}

/** 按住说话的几次:照 hold 实录分段(按下起、收尾止) */
export function reelHolds(plays: readonly PlayRecord[]): ReelHold[] {
  const holds: ReelHold[] = [];
  let hd: ReelHold | null = null;
  for (const r of plays) {
    if (r.k !== 'hold') continue;
    if (r.e === 'down') { if (hd) holds.push({ ...hd, to: Math.max(hd.to, r.at - 1) }); hd = { from: r.at, to: r.at, audioAt: null, upAt: null, slides: [], result: null, lv: '' }; continue; }
    if (!hd) continue;
    hd.to = r.at;
    if (r.e === 'audio') hd.audioAt ??= r.at;
    else if (r.e === 'slide') hd.slides.push({ at: r.at, on: Boolean(r.on) });
    else if (r.e === 'up') hd.upAt ??= r.at;
    else { hd.result = r.r ?? null; hd.lv = r.lv ?? ''; holds.push(hd); hd = null; }
  }
  if (hd) holds.push({ ...hd, to: hd.to + 500 });
  return holds.sort((a, b) => a.from - b.from);
}

/** 前奏一段接一段:后一段开始前多久以内结束的前一段算连着(按住说话没认出来、马上又按一次) */
export const REEL_LEAD_GAP_MS = 1500;
/**
 * 每章的章尾(《家长录像设计.md》拍板 21):上一章 / 下一章落在这里,不落章头。章尾 = 下一章的前奏开始之前;最后一章是 endAt。
 * starts = 每章开头(墙钟,升序);leads = 孩子为开口做的动作的时段(按住说话、打字、发照片屏);前奏 = 跨过下一章开头、或在它前面
 * REEL_LEAD_GAP_MS 以内结束的那一段,再一段段往前连。章尾不早于这一章的开头
 */
export function reelChapterEnds(starts: readonly number[], leads: readonly { from: number; to: number }[], endAt: number): number[] {
  return starts.map((s, i) => {
    if (i === starts.length - 1) return Math.max(s, endAt);
    let t = starts[i + 1];
    for (;;) {
      const x = leads.reduce((m, l) => (l.from < t && l.to >= t - REEL_LEAD_GAP_MS ? Math.min(m, l.from) : m), t);
      if (x >= t) break;
      t = x;
    }
    return Math.max(s, t - 1);
  });
}

/** 连着没发出去的几串(拍板 10):按时间走,发出去的一次或中间孩子发成了一句(sentAt:开口、打字发出去的时刻)就断开;够 REEL_MISS_STREAK 次才算 */
export function reelMissRuns(holds: readonly ReelHold[], sentAt: readonly number[]): { from: number; to: number; n: number }[] {
  const out: { from: number; to: number; n: number }[] = [];
  let run: ReelHold[] = [];
  const flush = (): void => { if (run.length >= REEL_MISS_STREAK) out.push({ from: run[0].from, to: run[run.length - 1].to, n: run.length }); run = []; };
  for (const x of holds) {
    if (x.result === 'sent') { flush(); continue; }
    if (run.length && sentAt.some((at) => at > run[run.length - 1].to && at < x.from)) flush();
    run.push(x);
  }
  flush();
  return out;
}

/**
 * 一个话题的录像;话题里一轮都没有 → null。实时的轮照通话放(callTrack);不是实时的轮(家长端试发、cotutor send、没有通话录像的)
 * 写完那一刻整节铺上、不念(staticTrack)。孩子第一次开口之前的轮(系统起的)也一样,从它自己的时刻起。
 */
export function buildReel(input: ReelInput): Reel | null {
  const turns = input.messages.filter((m) => !m.bookkeep && !m.tidy);
  if (!turns.length) return null;
  const firstKid = turns.findIndex((m) => m.from === 'kid');
  const pre = firstKid < 0 ? [] : turns.slice(0, firstKid);
  const live = firstKid < 0 ? turns : turns.slice(firstKid);
  const tracks: ReelTrack[] = [];
  const says: ReelSay[] = [];
  const notes: ReelNote[] = [];
  const waits: Reel['waits'] = [];
  const marks: ReelMark[] = [];
  const clips: ReelClip[] = [];
  const sectionOf = (m: ConversationMessage): BoardSection | null => (m.result === 'ok' && m.section && (m.section.cards.length || m.section.lines.length) ? m.section : null);
  const startOf = (m: ConversationMessage): number => {
    const t = reelParse(m.timing?.startedAt);
    return Number.isNaN(t) ? reelParse(m.at) : t;
  };

  // ---- 实时的轮:在哪次通话里(脑开写 turn 的那条带 job);孩子那一下按住的从按下起、打字拍照交卡从发出起 ----
  const callOf = new Map<string, { call: ReelCall; turnAt: number }>();
  for (const call of input.calls ?? []) for (const [t, d, x] of call.msgs) if (d === 'o' && x.t === 'turn' && typeof x.job === 'string') callOf.set(x.job, { call, turnAt: t });
  const callTurn = (m: ConversationMessage): { call: ReelCall; turnAt: number; from: number; sent: number; voice: boolean } | null => {
    const c = m.live ? callOf.get(m.job) : undefined;
    if (!c) return null;
    let hold = -1, sent = -1, voice = false;
    for (const [t, d, x] of c.call.msgs) {
      if (t > c.turnAt) break;
      if (d !== 'i') continue;
      if (x.t === 'hold') hold = t;
      else if (x.t === 'release' || x.t === 'send') { sent = t; voice = x.t === 'release'; }
    }
    return sent < 0 ? null : { ...c, from: voice && hold >= 0 && hold <= sent ? hold : sent, sent, voice };
  };
  /** 照通话放的轮:下面的实录(play 记录)不再改它们——实时时孩子端的播放器不念讲稿,它的记录里没有念 */
  const callJobs = new Set<string>();
  /** 实时的一轮照通话放:接住是一段嘴的声音(mouth),每句从孩子端开始放它的那一刻(read)到下一句或这段放完,孩子按住到松手是原声;卡闭合了就铺(main:card) */
  const callTrack = (m: ConversationMessage, ct: NonNullable<ReturnType<typeof callTurn>>, t0: number, next: number): void => {
    const { call } = ct;
    callJobs.add(m.job);
    const W = (t: number): number => call.startAt + t;
    const stop = next - call.startAt;
    const ev = input.events[m.job] ?? [];
    marks.push({ kind: 'said', at: W(ct.from), job: m.job, label: reelSaid(m) });
    if (ct.voice && ct.sent > ct.from) clips.push({ kind: 'voice', job: m.job, from: W(ct.from), to: W(ct.sent), audio: call.audio, seek: ct.from, text: m.text });
    const reads = call.msgs.filter(([t, d, x]) => d === 'o' && x.t === 'read' && x.job === m.job && typeof x.line === 'number' && t < stop).map(([t, , x]) => ({ t, line: x.line as number }));
    // 接住:松手 / 发出后第一段嘴的声音,到第一句开始放为止(两段连着时 playing 并成了一段);
    // 脑想得久时嘴垫的那句(call.ts 的 fill)是第一句之前的又一段,同样是嘴的声音,字是它开始放之后的那条 tutor
    const firstRead = Math.min(reads[0]?.t ?? Infinity, stop);
    const before = call.playing.filter(([a]) => a >= ct.sent && a < firstRead);
    const said = [...call.msgs].reverse().find(([t, d, x]) => d === 'o' && x.t === 'tutor' && x.of === 'catch' && typeof x.done === 'string' && t >= ct.sent && t <= ct.turnAt)?.[2].done;
    before.forEach(([a, b], i) => {
      const text = i === 0 ? said : call.msgs.find(([t, d, x]) => d === 'o' && x.t === 'tutor' && x.of === 'catch' && typeof x.done === 'string' && t >= a && t < firstRead)?.[2].done;
      clips.push({ kind: 'mouth', job: m.job, from: W(a), to: W(Math.min(b, firstRead)), audio: call.audio, seek: a, ...(typeof text === 'string' && text ? { text } : {}) });
    });
    if (before[0] && before[0][0] > ct.sent) waits.push({ job: m.job, from: W(ct.sent), to: W(before[0][0]) });
    const s = sectionOf(m);
    if (!s) { notes.push({ job: m.job, at: t0, postAt: Math.min(next, Math.max(t0, W(ct.turnAt))) }); return; }
    reads.forEach((r, i) => {
      const span = call.playing.find(([a, b]) => a <= r.t && r.t < b);
      const after = reads[i + 1];
      const end = after && span && after.t < span[1] ? after.t : span ? span[1] : r.t + lineDurationMs(s.lines[r.line]?.text ?? '');
      says.push({ job: m.job, line: r.line, from: W(r.t), to: W(Math.min(end, stop)), audio: call.audio, seek: r.t });
    });
    const appear = Math.min(W(ct.turnAt), next);
    const track: ReelTrack = { job: m.job, at: appear, streamed: true, cards: [{ at: appear, n: 0 }], doneAt: appear, ask: false };
    let n = 0;
    for (const e of ev) if (e.lane === 'main' && e.kind === 'card') { n = Math.max(n, e.card + 1); track.cards.push({ at: Math.max(appear, Math.min(t0 + e.t, next)), n }); }
    const allRel = ev.find((e) => e.lane === 'ready' && e.kind === 'all')?.t ?? ev.find((e) => e.lane === 'index')?.t ?? m.timing?.doneMs;
    track.cards.push({ at: Math.max(appear, Math.min(allRel !== undefined ? t0 + allRel : appear, next)), n: s.cards.length });
    track.cards.sort((a, b) => a.at - b.at);
    const mine = says.filter((x) => x.job === m.job);
    track.doneAt = mine.length ? Math.max(...mine.map((x) => x.to)) : appear;
    track.ask = mine.length === s.lines.length && Boolean(s.lines[s.lines.length - 1]?.ask);
    tracks.push(track);
    notes.push({ job: m.job, at: t0, postAt: track.doneAt });
    if (track.ask) marks.push({ kind: 'ask', at: track.doneAt, job: m.job, label: s.lines[s.lines.length - 1].text });
  };

  /**
   * 不是实时的轮:开口 → 写完(ready all / 索引写入 / 退出)那一刻整节铺上,不念;没成的「没成」的点在老师退出那一刻,
   * 节尾旁注那时出来,之前算等老师。said = 要不要「开口」的点(孩子第一次开口之前的系统轮不要;家长页上系统的标「系统」)
   */
  const staticTrack = (m: ConversationMessage, t0: number, next: number, said: boolean): void => {
    const ev = input.events[m.job] ?? [];
    const exitAt = (() => { const e = ev.find((x) => x.lane === 'main' && x.kind === 'exit'); return e ? t0 + e.t : m.timing?.doneMs !== undefined ? t0 + m.timing.doneMs : t0; })();
    if (said) marks.push({ kind: 'said', at: t0, job: m.job, label: reelSaid(m) });
    if (m.result === 'error') {
      marks.push({ kind: 'error', at: exitAt, job: m.job, label: m.error ?? '没成' });
      notes.push({ job: m.job, at: t0, postAt: exitAt });
      if (exitAt > t0) waits.push({ job: m.job, from: t0, to: exitAt });
      return;
    }
    const s = sectionOf(m);
    if (!s) {
      const end = m.result === 'running' ? input.now : exitAt;
      notes.push({ job: m.job, at: t0, postAt: end });
      if (end > t0) waits.push({ job: m.job, from: t0, to: end });
      return;
    }
    const allRel = ev.find((e) => e.lane === 'ready' && e.kind === 'all')?.t ?? ev.find((e) => e.lane === 'index')?.t ?? m.timing?.doneMs ?? 0;
    const at = Math.min(t0 + allRel, next);
    const ask = Boolean(s.lines[s.lines.length - 1]?.ask);
    tracks.push({ job: m.job, at, streamed: false, cards: [{ at, n: s.cards.length }], doneAt: at, ask });
    if (at > t0) waits.push({ job: m.job, from: t0, to: at });
    notes.push({ job: m.job, at: t0, postAt: at });
    if (ask) marks.push({ kind: 'ask', at, job: m.job, label: s.lines[s.lines.length - 1].text });
  };

  // ---- 孩子开口之后的轮 ----
  // t0 = 消息发出去(老师进程起来)的那一刻;实时的轮孩子按住说话从按下起
  const liveCalls = live.map(callTurn);
  const liveStarts = live.map(startOf);
  const speakAt = live.map((_m, k) => { const ct = liveCalls[k]; return ct ? ct.call.startAt + ct.from : liveStarts[k]; });
  for (const [k, m] of live.entries()) {
    const t0 = liveStarts[k];
    const next = k + 1 < live.length ? speakAt[k + 1] : Infinity;
    const ct = liveCalls[k];
    if (ct && m.result !== 'error') callTrack(m, ct, t0, next);
    else staticTrack(m, t0, next, true);
  }

  // ---- 看小课堂(第 5 步):带 lecture.log 的那条,往前铺它的看的过程(t 相对这条发出去的那一刻) ----
  const lectures: ReelLecture[] = [];
  for (const [k, m] of live.entries()) {
    const l = m.lecture;
    if (!l?.log?.length) continue;
    const t0 = liveStarts[k];
    const log = [...l.log].sort((a, b) => a.t - b.t).map((e) => ({ at: t0 + Math.min(0, e.t), pos: e.pos, play: e.play }));
    const from = log[0].at;
    const to = log[log.length - 1].at;
    const lm = (l.marks ?? []).map((x) => ({ at: x.t !== undefined ? t0 + Math.min(0, x.t) : to, atMs: x.atMs, svgMs: x.svgMs, strokes: x.strokes, ...(x.image ? { image: x.image } : {}) }));
    lectures.push({ job: m.job, bundle: l.bundle, title: l.title, video: Boolean(l.video), from, to, log, marks: lm });
    marks.push({ kind: 'lecture', at: from, job: m.job, label: `${l.again ? '又看小课堂' : '看小课堂'} · ${l.title}` });
    for (const x of lm) marks.push({ kind: 'ink', at: x.at, job: m.job, label: `画了一处(课里 ${reelLecClock(x.atMs)})` });
  }

  // ---- 孩子开口之前的轮(系统起的):各从自己的时刻起 ----
  for (const [k, m] of pre.entries()) staticTrack(m, startOf(m), k + 1 < pre.length ? startOf(pre[k + 1]) : (speakAt[0] ?? Infinity), false);
  tracks.sort((a, b) => a.at - b.at);
  says.sort((a, b) => a.from - b.from);

  const secByJob = new Map(turns.map((m) => [m.job, sectionOf(m)]));
  const plays = [...(input.plays ?? [])].sort((a, b) => a.at - b.at);
  // 弹窗开着的段:开 → 同一张的关(没关的到下一次开弹窗 / 下一次开口 / 最后一条记录)
  const stages: ReelStage[] = [];
  const opens = plays.filter((r): r is Extract<PlayRecord, { k: 'stage' }> => r.k === 'stage');
  opens.forEach((r, i) => {
    if (!r.open || !secByJob.get(r.job)) return;
    const close = opens.slice(i + 1).find((x) => !x.open || x.job !== r.job || x.card !== r.card);
    const nextSpeak = speakAt.find((x) => x > r.at);
    const to = Math.min(close ? close.at : Infinity, nextSpeak ?? Infinity, plays.length ? Math.max(plays[plays.length - 1].at, r.at) : r.at);
    if (to > r.at) stages.push({ job: r.job, card: r.card, from: r.at, to });
  });
  const aways: Reel['aways'] = [];
  plays.forEach((r, i) => {
    if (r.k !== 'visible' || r.on) return;
    const back = plays.slice(i + 1).find((x) => x.k === 'visible' && x.on);
    aways.push({ from: r.at, to: back ? back.at : Math.max(r.at, plays[plays.length - 1].at) });
  });

  // ---- 改版补记的(拍板 6):按住说话、打字、发照片屏、屏幕尺寸、翻板书 ----
  const holds = reelHolds(plays);
  const types: ReelType[] = [];
  let ty: ReelType | null = null;
  for (const r of plays) {
    if (r.k !== 'type') continue;
    if (r.e === 'focus') { if (ty) types.push(ty); ty = { from: r.at, to: r.at, vals: [], sent: false }; continue; }
    if (!ty) continue;
    ty.to = r.at;
    if (r.e === 'v') ty.vals.push({ at: r.at, v: r.v ?? '' });
    else { ty.sent = r.e === 'send'; types.push(ty); ty = null; }
  }
  if (ty) types.push({ ...ty, to: ty.to + 1000 });
  const photoScreens: ReelPhotoScreen[] = [];
  let ps: ReelPhotoScreen | null = null;
  for (const r of plays) {
    if (r.k !== 'ps') continue;
    if (r.e === 'open') { if (ps) photoScreens.push(ps); ps = { from: r.at, to: r.at, tools: [], sent: false, photo: null }; continue; }
    if (!ps) continue;
    ps.to = r.at;
    if (r.e === 'tool') ps.tools.push({ at: r.at, tool: r.tool ?? '' });
    else {
      ps.sent = r.e === 'send';
      // 发出去的那条:这一刻之后最近的、带照片的那次开口
      if (ps.sent) { const k = live.findIndex((m, i) => liveStarts[i] >= r.at - 2000 && m.photos?.length); if (k >= 0) ps.photo = live[k].photos![0]; }
      photoScreens.push(ps); ps = null;
    }
  }
  if (ps) photoScreens.push({ ...ps, to: ps.to + 1000 });
  const views: Reel['views'] = [];
  const scrolls: Reel['scrolls'] = [];
  for (const r of plays) {
    if (r.k === 'view') views.push({ at: r.at, w: r.w, h: r.h, kb: r.kb, v: r.v });
    else if (r.k === 'scroll' && secByJob.get(r.job)) scrolls.push({ at: r.at, job: r.job, card: r.card, dy: r.dy });
  }
  // 没发出去的按住:每次一个淡点;连着 REEL_MISS_STREAK 次以上(中间孩子一句也没发成:开口或打字发出去)标成一串(拍板 10)
  const MISS_LABEL: Record<ReelHoldResult, string> = { sent: '', unclear: '没听清', cancel: '上滑取消了' };
  for (const x of holds) if (x.result !== 'sent') marks.push({ kind: 'miss', at: x.from, job: '', label: '按住说话没发出去' + (x.result ? ' · ' + MISS_LABEL[x.result] : '') });
  const misses = reelMissRuns(holds, [...speakAt, ...types.filter((t) => t.sent).map((t) => t.to)]);
  for (const x of misses) marks.push({ kind: 'misses', at: x.from, to: x.to, job: '', label: `按住说话连着 ${x.n} 次没发出去` });

  // ---- 卡的状态:有实录的卡用每一次存(选了又改都在);没有的用状态文件(at 起生效,只有最后一次) ----
  const cards: ReelCardChange[] = [];
  const seenCard = new Set<string>();
  for (const r of plays) if (r.k === 'card' && secByJob.get(r.job)?.cards[r.card]) { cards.push({ job: r.job, card: r.card, at: r.at, state: r.state }); seenCard.add(`${r.job}/${r.card}`); }
  for (const [job, per] of Object.entries(input.cards)) {
    const sec = secByJob.get(job);
    if (!sec) continue;
    for (const [nStr, f] of Object.entries(per)) {
      const n = Number(nStr);
      const at = reelParse(f.at);
      if (Number.isNaN(at) || !sec.cards[n] || seenCard.has(`${job}/${n}`)) continue;
      cards.push({ job, card: n, at, state: f.state });
    }
  }
  cards.sort((a, b) => a.at - b.at);
  const lastMark = new Map<string, number>();
  for (const c of cards) {
    const sec = secByJob.get(c.job)!;
    const key = `${c.job}/${c.card}`;
    // 进度条上的点:同一张卡 3 秒内连着改的只点一个(填空打字、画板连着画)
    if ((lastMark.get(key) ?? -Infinity) < c.at - 3000) marks.push({ kind: 'card', at: c.at, job: c.job, label: cardTitle(sec.cards[c.card]) });
    lastMark.set(key, c.at);
  }
  clips.sort((a, b) => a.from - b.from);
  marks.sort((a, b) => a.at - b.at);
  notes.sort((a, b) => a.at - b.at);

  // ---- 起止与空白 ----
  const points = [...tracks.map((t) => t.at), ...speakAt, ...clips.map((c) => c.from), ...stages.map((x) => x.from), ...lectures.map((x) => x.from), ...holds.map((x) => x.from), ...types.map((x) => x.from), ...photoScreens.map((x) => x.from)].filter((x) => Number.isFinite(x));
  const startAt = Math.min(...points);
  const running = live.some((m) => m.result === 'running');
  const lastAt = Math.max(...tracks.map((t) => t.doneAt), ...liveStarts, ...lectures.map((x) => x.to), ...cards.map((c) => c.at), ...clips.map((c) => c.to), ...notes.map((n) => n.postAt), ...says.map((x) => x.to), ...stages.map((x) => x.to), ...holds.map((x) => x.to), ...types.map((x) => x.to), ...photoScreens.map((x) => x.to));
  const endAt = running ? Math.max(input.now, lastAt) : lastAt + REEL_TAIL_MS;
  const gaps: ReelGap[] = [];
  for (const w of waits) if (w.to - w.from > REEL_WAIT_KEEP_MS) gaps.push({ kind: 'wait', from: w.from + REEL_WAIT_KEEP_MS, to: w.to, ms: w.to - w.from });
  // 忙的时段(有人在说、老师在写、孩子在录):两段之间超过 REEL_THINK_MIN_MS 的空当压成 think。
  // 空当里孩子改了卡、开关了弹窗:前后各留 1 秒照真实时间放(压缩时不会一闪而过),空当被切开,后一段标 cont
  const busy: [number, number][] = [
    ...waits.map((w): [number, number] => [w.from, w.to]),
    ...tracks.map((t): [number, number] => [t.at, t.doneAt]),
    ...says.map((x): [number, number] => [x.from, x.to]),
    ...clips.map((c): [number, number] => [c.from, c.to]),
    // 孩子按着说话、在打字、在发照片屏:照真实时间放(拍板 6)
    ...holds.map((x): [number, number] => [x.from, x.to + (x.result === 'unclear' ? REEL_UNCLEAR_MS : 0)]),
    ...types.map((x): [number, number] => [x.from, x.to]),
    ...photoScreens.map((x): [number, number] => [x.from, x.to]),
    // 小课堂在放的时段;停着的不算(孩子停下来想、画,太久照样压)
    ...lectures.flatMap((x) => x.log.flatMap((e, i): [number, number][] => (e.play ? [[e.at, i + 1 < x.log.length ? x.log[i + 1].at : x.to]] : []))),
  ];
  const acts: [number, number][] = [
    ...cards.map((c): [number, number] => [c.at - 1000, c.at + 1000]),
    ...stages.flatMap((x): [number, number][] => [[x.from - 1000, x.from + 1000], [x.to - 1000, x.to + 1000]]),
    ...lectures.flatMap((x) => x.marks.map((c): [number, number] => [c.at - 1000, c.at + 1000])),
  ];
  busy.sort((a, b) => a[0] - b[0]);
  acts.sort((a, b) => a[0] - b[0]);
  const think = (from: number, to: number): void => {
    let cur = from;
    for (const [a, b] of acts) {
      if (b <= cur || a >= to) continue;
      if (a - cur > REEL_THINK_MIN_MS) gaps.push({ kind: 'think', from: cur, to: a, ms: a - cur, ...(cur > from ? { cont: true as const } : {}) });
      cur = Math.max(cur, b);
    }
    if (to - cur > REEL_THINK_MIN_MS) gaps.push({ kind: 'think', from: cur, to, ms: to - cur, ...(cur > from ? { cont: true as const } : {}) });
  };
  let reach = startAt;
  for (const [from, to] of busy) {
    if (from - reach > REEL_THINK_MIN_MS) think(reach, from);
    reach = Math.max(reach, to);
  }
  gaps.sort((a, b) => a.from - b.from);
  return { startAt, endAt, tracks, says, clips, cards, notes, waits, gaps, marks, stages, aways, lectures, views, holds, types, photoScreens, scrolls, misses };
}

/** 课里的「分:秒」(同 lecture.ts 的 clockLabel;这份文件只准从 kid-board 取运行时的东西) */
function reelLecClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 播放时钟:压过的空白各放 REEL_GAP_PLAY_MS,其余 1:1。real = 按真实时间(不压)。p = 从 0 起的播放毫秒 */
export interface ReelClock {
  total: number;
  toWall: (p: number) => number;
  toPlay: (w: number) => number;
}

export function reelClock(reel: Pick<Reel, 'startAt' | 'endAt' | 'gaps'>, real: boolean): ReelClock {
  /** 一段:墙钟 [w0, w1) 对播放 [p0, p1) */
  const segs: { w0: number; w1: number; p0: number; p1: number }[] = [];
  let w = reel.startAt;
  let p = 0;
  const push = (to: number, len: number): void => { if (to <= w) return; segs.push({ w0: w, w1: to, p0: p, p1: p + len }); p += len; w = to; };
  if (!real) for (const g of reel.gaps) { if (g.from < w) continue; push(g.from, g.from - w); push(Math.min(g.to, reel.endAt), REEL_GAP_PLAY_MS); }
  push(reel.endAt, reel.endAt - w);
  const lerp = (x: number, a0: number, a1: number, b0: number, b1: number): number => (a1 === a0 ? b0 : b0 + ((x - a0) * (b1 - b0)) / (a1 - a0));
  return {
    total: p,
    toWall: (x) => {
      if (!segs.length) return reel.startAt;
      const s = segs.find((g) => x < g.p1) ?? segs[segs.length - 1];
      return Math.min(s.w1, lerp(Math.max(x, s.p0), s.p0, s.p1, s.w0, s.w1));
    },
    toPlay: (x) => {
      if (!segs.length) return 0;
      const s = segs.find((g) => x < g.w1) ?? segs[segs.length - 1];
      return Math.min(s.p1, lerp(Math.max(x, s.w0), s.w0, s.w1, s.p0, s.p1));
    },
  };
}

/** 某一刻的样子 */
export interface ReelFrame {
  /** 出来了的节(按出来的先后):露几张卡、开始念过几句(标注画到这里) */
  sections: { job: string; cards: number; spoken: number }[];
  /** 正在念的一句:offset = 从这句开头过了多久 */
  saying: { job: string; line: number; offset: number; audio: string | null; seek?: number } | null;
  /** 正在放的一段:孩子按住说的、嘴接住的那句(都在通话的录音里) */
  clip: { kind: ReelClip['kind']; job: string; offset: number; audio: string; text?: string; seek?: number } | null;
  /** 最近开始念的一句(不在念时字幕留着它) */
  last: { job: string; line: number } | null;
  /** `<job>/<卡>` → 这一刻的状态;不在 = 还没做 */
  cards: Record<string, unknown>;
  notes: { job: string; post: boolean }[];
  /** 开口了、老师还没出声:等了多久 */
  wait: { job: string; ms: number } | null;
  gap: ReelGap | null;
  /** 老师停下等孩子(末句问句念完了) */
  asking: boolean;
  /** 弹窗开着(实录):哪一张 */
  stage: { job: string; card: number } | null;
  /** 弹窗开着、这张卡孩子还没动:想了多久(切到后台的时间不算) */
  thinking: { job: string; card: number; ms: number } | null;
  /** 孩子切到别处了(页面在后台) */
  away: boolean;
  /** 在看小课堂:看的是哪一课、停在课里的哪一刻、在不在放、到这一刻画过的几处 */
  lecture: { job: string; bundle: string; title: string; video: boolean; pos: number; playing: boolean; marks: ReelLecture['marks'] } | null;
  /**
   * 孩子按着说话(拍板 6):wait = 话筒还没开(「等一下…」)、live = 在听、tail = 松手了在收尾(「正在听清…」);text = 到这一刻认出的字;
   * slide = 手上滑到了取消区;lv = 到这一刻为止最近 25 个 100 毫秒的音量(0–9;没记 = null,页面用假波形);diag = 老话题推的
   */
  hold: { phase: 'wait' | 'live' | 'tail'; slide: boolean; lv: string | null } | null;
  /** 输入条上「没听清,再按住说一次」那 2.5 秒 */
  unclear: boolean;
  /** 在打字:输入框里这一刻的字 */
  typing: { v: string } | null;
  /** 发照片屏开着:最近用的工具、发出去的那张照片 */
  photoScreen: { tool: string; photo: string | null } | null;
  /** 孩子屏幕这一刻的尺寸与键盘高(还没记 = null) */
  view: { w: number; h: number; kb: number } | null;
  /** 孩子自己最近一次翻到哪(at 是那一刻) */
  scroll: { at: number; job: string; card: number; dy: number } | null;
  /** 在一串连着没发出去的按住里:一共几次、这是第几次(还在两次之间也算) */
  miss: { n: number; k: number } | null;
}

export function reelFrameAt(reel: Reel, t: number): ReelFrame {
  const sections: ReelFrame['sections'] = [];
  for (const tr of reel.tracks) {
    if (tr.at > t) continue;
    let n = 0;
    for (const c of tr.cards) if (c.at <= t) n = c.n;
    // 念过几句 = 嘴念到的最远那句 + 1
    let spoken = 0;
    for (const x of reel.says) if (x.job === tr.job && x.from <= t) spoken = Math.max(spoken, x.line + 1);
    sections.push({ job: tr.job, cards: n, spoken });
  }
  let saying: ReelFrame['saying'] = null;
  let last: ReelFrame['last'] = null;
  // says 按时间排好(buildReel 保证):最后一句开始了的就是 last
  for (const x of reel.says) {
    if (x.from > t) break;
    last = { job: x.job, line: x.line };
    saying = t < x.to ? { job: x.job, line: x.line, offset: t - x.from, audio: x.audio, ...(x.seek !== undefined ? { seek: x.seek } : {}) } : null;
  }
  let clip: ReelFrame['clip'] = null;
  for (const c of reel.clips) if (c.from <= t && t < c.to) clip = { kind: c.kind, job: c.job, offset: t - c.from, audio: c.audio, ...(c.text !== undefined ? { text: c.text } : {}), ...(c.seek !== undefined ? { seek: c.seek } : {}) };
  const cards: Record<string, unknown> = {};
  for (const c of reel.cards) if (c.at <= t) cards[`${c.job}/${c.card}`] = c.state;
  const notes = reel.notes.filter((x) => x.at <= t).map((x) => ({ job: x.job, post: x.postAt <= t }));
  const w = reel.waits.find((x) => x.from <= t && t < x.to);
  const gap = reel.gaps.find((g) => g.from <= t && t < g.to) ?? null;
  // 停下等孩子:最近铺上的那一节问完了、写完(或嘴念完)了
  const shown = reel.tracks.filter((x) => x.at <= t);
  const tr = shown[shown.length - 1];
  const asking = !saying && !w && Boolean(tr && tr.ask && tr.doneAt <= t);
  const st = reel.stages.find((x) => x.from <= t && t < x.to) ?? null;
  const touched = st ? reel.cards.some((c) => c.job === st.job && c.card === st.card && c.at >= st.from && c.at <= t) : true;
  const thinking = st && !touched ? { job: st.job, card: st.card, ms: t - st.from - reelAwayMs(reel.aways, st.from, t) } : null;
  const away = reel.aways.some((a) => a.from <= t && t < a.to);
  const hd = (reel.holds ?? []).find((x) => x.from <= t && t < x.to) ?? null;
  let hold: ReelFrame['hold'] = null;
  if (hd) {
    let slide = false;
    for (const x of hd.slides) if (x.at <= t) slide = x.on;
    const i = Math.floor((t - hd.from) / 100);
    const lv = hd.lv ? hd.lv.slice(Math.max(0, i - 24), i + 1).padStart(25, '0') : null;
    hold = { phase: hd.upAt !== null && t >= hd.upAt ? 'tail' : hd.audioAt === null || t < hd.audioAt ? 'wait' : 'live', slide, lv };
  }
  const unclear = !hd && (reel.holds ?? []).some((x) => x.result === 'unclear' && x.to <= t && t < x.to + REEL_UNCLEAR_MS);
  const tp = (reel.types ?? []).find((x) => x.from <= t && t < x.to);
  let typing: ReelFrame['typing'] = null;
  if (tp) { let v = ''; for (const x of tp.vals) if (x.at <= t) v = x.v; typing = { v }; }
  const pss = (reel.photoScreens ?? []).find((x) => x.from <= t && t < x.to);
  let photoScreen: ReelFrame['photoScreen'] = null;
  if (pss) { let tool = ''; for (const x of pss.tools) if (x.at <= t) tool = x.tool; photoScreen = { tool, photo: pss.photo }; }
  let view: ReelFrame['view'] = null;
  for (const x of reel.views ?? []) { if (x.at > t && view) break; view = { w: x.w, h: x.h, kb: x.at <= t ? x.kb : 0 }; }
  let scroll: ReelFrame['scroll'] = null;
  for (const x of reel.scrolls ?? []) { if (x.at > t) break; scroll = x; }
  const ms = (reel.misses ?? []).find((x) => x.from <= t && t < x.to);
  const miss = ms ? { n: ms.n, k: (reel.holds ?? []).filter((x) => x.result !== 'sent' && x.from >= ms.from && x.from <= t).length } : null;
  return { sections, saying, clip, last, cards, notes, wait: w ? { job: w.job, ms: t - w.from } : null, gap, asking, stage: st ? { job: st.job, card: st.card } : null, thinking, away, lecture: reelLectureAt(reel.lectures ?? [], t), hold, unclear, typing, photoScreen, view, scroll, miss };
}

/** 这一刻在不在看小课堂:最近一条看的记录;在放的按真实时间往前推(推不过下一条) */
function reelLectureAt(lectures: readonly ReelLecture[], t: number): ReelFrame['lecture'] {
  const l = lectures.find((x) => x.from <= t && t <= x.to);
  if (!l) return null;
  let i = 0;
  for (let k = 0; k < l.log.length; k++) if (l.log[k].at <= t) i = k;
  const e = l.log[i];
  const next = l.log[i + 1];
  const pos = e.play ? e.pos + Math.max(0, Math.min(t, next ? next.at : t) - e.at) : e.pos;
  return { job: l.job, bundle: l.bundle, title: l.title, video: l.video, pos, playing: e.play && t < l.to, marks: l.marks.filter((x) => x.at <= t) };
}

/** [from, to) 里切到后台了多久 */
function reelAwayMs(aways: readonly { from: number; to: number }[], from: number, to: number): number {
  let ms = 0;
  for (const a of aways) ms += Math.max(0, Math.min(a.to, to) - Math.max(a.from, from));
  return ms;
}

/**
 * 一张卡孩子在弹窗里想了多久、改了几次(《家长录像设计.md》§4.7):[after, before) 里这张卡的弹窗加在一起——
 * 第一次打开到第一次改动(切到后台的不算)= 想了多久;改动的次数。没打开过弹窗 → null;打开了没改 → think = null
 */
export function reelCardTook(plays: readonly PlayRecord[], job: string, card: number, after: number, before: number): { think: number | null; changes: number } | null {
  const sorted = [...plays].sort((a, b) => a.at - b.at).filter((r) => r.at >= after && r.at < before);
  const open = sorted.find((r) => r.k === 'stage' && r.open && r.job === job && r.card === card);
  if (!open) return null;
  const changes = sorted.filter((r) => r.k === 'card' && r.job === job && r.card === card && r.at >= open.at);
  const aways: { from: number; to: number }[] = [];
  sorted.forEach((r, i) => { if (r.k === 'visible' && !r.on) { const back = sorted.slice(i + 1).find((x) => x.k === 'visible' && x.on); aways.push({ from: r.at, to: back ? back.at : before }); } });
  const first = changes[0];
  return { think: first ? Math.max(0, first.at - open.at - reelAwayMs(aways, open.at, first.at)) : null, changes: changes.length };
}

/** 「2 分 10 秒」「23 秒」「1 小时 5 分」 */
export function reelDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} 分 ${s % 60} 秒` : `${m} 分`;
  return m % 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${Math.floor(m / 60)} 小时`;
}

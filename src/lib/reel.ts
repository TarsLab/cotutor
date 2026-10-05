/**
 * 录像(《家长录像设计.md》):一个话题按时间排好的一条轨道——每一刻板上有哪几节、每节露了几张卡、在念哪句、卡的状态、该出哪些旁注。
 * 第一期全靠推算:孩子 / 家长开口的时刻(timing.startedAt)、每拍就绪(events.jsonl)、每句 mp3 的时长、卡状态文件的 at;孩子端还没有上报,
 * 暂停、再听、卡的中间状态看不到。
 *
 * 两处共用,和 kid-board.ts 一个做法:服务端 buildReel 算好下发;家长端页面把这份剥掉类型内联,拖进度条时现算 reelFrameAt / reelClock。
 * 所以**只准从 kid-board.ts 取运行时的东西**(内联时 import 行删掉,页面里本来就有那些函数)、不碰 DOM、不用 enum;顶层名字都带 reel 前缀,免得和页面撞。
 * 时刻都是墙钟毫秒(Date.parse 出来的)。
 */
import { beatsOf, cardTitle, lineDurationMs } from './kid-board.ts';
import type { BoardSection } from './kid-board.ts';
import type { RunEvent } from './events.ts';
import type { CardStates } from './conversation.ts';
import type { ConversationMessage } from '../schema/conversation.ts';

/** 一句念的时段;audio 相对 conversations/<老师>/(没配音 = null,页面只出字幕不出声);replay = 孩子点了「再听」重念的 */
export interface ReelSay {
  job: string;
  line: number;
  from: number;
  to: number;
  audio: string | null;
  replay?: true;
}

/**
 * 实录(第二期,《家长录像设计.md》§4):孩子端记下的一条,落 <日期>.<job>.play.jsonl。at 是服务端的墙钟(路由按发来时两边的钟差校过)。
 * play = 播放器的位置变了(job = 那一节的 job;status 同 PlayerState;replay = 在再听);stage = 弹窗开 / 关;autoplay = 喇叭;
 * visible = 页面切到后台 / 回来;card = 卡的一次存(服务端在 putCardState 里记,孩子端不发)
 */
export type PlayRecord = { at: number } & (
  | { k: 'play'; job: string | null; line: number; status: string; replay?: true }
  | { k: 'stage'; job: string; card: number; open: boolean }
  | { k: 'autoplay'; on: boolean }
  | { k: 'visible'; on: boolean }
  | { k: 'card'; job: string; card: number; state: unknown }
);

/** 一条实录的形状对不对(服务端收、读 play.jsonl 时用;坏的丢掉) */
export function playRecordOk(x: unknown): x is PlayRecord {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  const job = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d+$/.test(v);
  const int = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= -1 && v < 1000;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return false;
  switch (r.k) {
    case 'play': return (r.job === null || job(r.job)) && int(r.line) && typeof r.status === 'string' && r.status.length < 16 && (r.replay === undefined || r.replay === true);
    case 'stage': return job(r.job) && int(r.card) && typeof r.open === 'boolean';
    case 'autoplay':
    case 'visible': return typeof r.on === 'boolean';
    case 'card': return job(r.job) && int(r.card) && 'state' in r;
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
 * 孩子自己的声音:rec = 录音卡上的录音(存下来那一刻往前推 seconds);voice = 按住说话的原声(发出去那一刻往前推 seconds,text 是识别认成的字)。
 * audio 相对 conversations/<老师>/
 */
export interface ReelClip {
  kind: 'rec' | 'voice';
  job: string;
  /** 录音卡是第几张;原声没有 */
  card: number | null;
  from: number;
  to: number;
  audio: string;
  text?: string;
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

/** 进度条上的点:said 孩子 / 家长开口、card 孩子改了一张卡、ask 老师停下等孩子、error 这轮没成 */
export interface ReelMark {
  kind: 'said' | 'card' | 'ask' | 'error';
  at: number;
  job: string;
  label: string;
}

export interface Reel {
  startAt: number;
  endAt: number;
  /** 第一期永远是 false:念句的时刻是推的 */
  precise: boolean;
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
}

/** 开口后老师多久没出声以内照真实时间放(这就是孩子感受到的慢) */
export const REEL_WAIT_KEEP_MS = 10000;
/** 老师说完到下一次开口,超过这么久就压 */
export const REEL_THINK_MIN_MS = 5000;
/** 压过的一段空白放多久 */
export const REEL_GAP_PLAY_MS = 1500;
/** 句与句之间(换 mp3 的那一下) */
export const REEL_LINE_GAP_MS = 200;
/** 最后一件事之后再留一会儿 */
export const REEL_TAIL_MS = 1500;

export interface ReelInput {
  /** 这个话题的消息,索引顺序 */
  messages: readonly ConversationMessage[];
  /** job → 那轮的事件(没有 events.jsonl 的轮不在) */
  events: Readonly<Record<string, readonly RunEvent[]>>;
  cards: CardStates;
  /** 讲稿配音(相对 conversations/<老师>/)→ 毫秒;不在的按字数估 */
  durations: Readonly<Record<string, number>>;
  /** 老师文件的 key(录音卡的路径去掉 conversations/<老师>/ 用) */
  tutor: string;
  now: number;
  /** 实录(第二期):这个话题各轮的 play.jsonl 合在一起;没有 = 全靠推算 */
  plays?: readonly PlayRecord[];
}

/** 念到第 upTo 句(含)时露到第几张卡:锚到的、标到的、[[play]] 到的最后一张(同 kid-board 的 shownCards) */
function reelUnfold(s: BoardSection, upTo: number): number {
  let n = 0;
  for (const l of s.lines.slice(0, upTo + 1)) {
    n = Math.max(n, (l.anchor ?? -1) + 1);
    for (const m of l.marks) n = Math.max(n, m.card + 1);
    for (const c of l.cues) n = Math.max(n, c.card + 1);
  }
  return Math.min(n, s.cards.length);
}

function reelLineMs(s: BoardSection, i: number, durations: Readonly<Record<string, number>>): number {
  const l = s.lines[i];
  return (l.audio && durations[l.audio]) || lineDurationMs(l.text);
}

/** 本地时间的「2026-09-28T20:29」或 ISO:都给墙钟毫秒;坏的 → NaN */
function reelParse(at: string | undefined): number {
  return at ? Date.parse(at) : NaN;
}

/** 孩子(或家长)这句在进度条上写成什么:继续、交给老师(从首页按钮进来又交卡的,交卡更要紧)、首页按钮字、原话 */
export function reelSaid(m: Pick<ConversationMessage, 'text' | 'via' | 'action'>): string {
  if (m.action === 'continue') return '继续';
  if (m.action === 'submit') return '交给老师';
  if (m.via) return m.via.label;
  return m.text;
}

/**
 * 推算一个话题的录像;话题里一句孩子的话都没有 → null。
 * 孩子第一次开口之前的轮(2026-10-05 前交给孩子的课文件)是孩子打开话题时一节一节念的,时刻没记:从孩子第一次开口往前倒推,一节接一节;
 * 某节的卡有状态文件、时刻更早,就把这节往前挪到念完时正好是那一刻。之后的轮按开口时刻、每拍就绪、mp3 时长顺着排;
 * 下一次开口时这节没念完的句不念了(孩子端发消息就停声音)。
 */
export function buildReel(input: ReelInput): Reel | null {
  const turns = input.messages.filter((m) => !m.bookkeep && !m.tidy);
  const firstKid = turns.findIndex((m) => m.from === 'kid');
  if (firstKid < 0) return null;
  const pre = turns.slice(0, firstKid);
  const live = turns.slice(firstKid);
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

  /** 把一节从 from 起顺着念;每句不早于它那拍就绪(readyOf),到 stop 就不念了。返回最后一句念完的时刻 */
  const narrate = (job: string, s: BoardSection, from: number, stop: number, readyOf: (i: number) => number, unfold: boolean, track: ReelTrack): number => {
    let cursor = from;
    let end = from;
    for (let i = 0; i < s.lines.length; i++) {
      const start = Math.max(cursor, readyOf(i));
      if (start >= stop) break;
      const to = Math.min(start + reelLineMs(s, i, input.durations), stop);
      says.push({ job, line: i, from: start, to, audio: s.lines[i].audio });
      if (unfold) track.cards.push({ at: start, n: reelUnfold(s, i) });
      end = to;
      cursor = to + REEL_LINE_GAP_MS;
    }
    return end;
  };

  // ---- 孩子开口之后的轮 ----
  // t0 = 消息发出去(老师进程起来)的那一刻;按住说话的轮,孩子按下去更早 voice.seconds 秒——那一刻孩子端就停了声音,前一节没念的句不念了
  const liveStarts = live.map(startOf);
  const speakAt = live.map((m, k) => liveStarts[k] - (m.voice ? Math.round(m.voice.seconds * 1000) : 0));
  for (const [k, m] of live.entries()) {
    const t0 = liveStarts[k];
    const next = k + 1 < live.length ? speakAt[k + 1] : Infinity;
    const ev = input.events[m.job] ?? [];
    const rel = (e: RunEvent | undefined): number | undefined => (e ? t0 + e.t : undefined);
    const exitAt = rel(ev.find((e) => e.lane === 'main' && e.kind === 'exit')) ?? (m.timing?.doneMs !== undefined ? t0 + m.timing.doneMs : t0);
    marks.push({ kind: 'said', at: speakAt[k], job: m.job, label: reelSaid(m) });
    if (m.voice) clips.push({ kind: 'voice', job: m.job, card: null, from: speakAt[k], to: t0, audio: m.voice.audio, text: m.text });
    if (m.result === 'error') {
      marks.push({ kind: 'error', at: exitAt, job: m.job, label: m.error ?? '没成' });
      notes.push({ job: m.job, at: t0, postAt: exitAt });
      if (exitAt > t0) waits.push({ job: m.job, from: t0, to: exitAt });
      continue;
    }
    const s = sectionOf(m);
    if (!s) {
      const end = m.result === 'running' ? input.now : exitAt;
      notes.push({ job: m.job, at: t0, postAt: end });
      if (end > t0) waits.push({ job: m.job, from: t0, to: end });
      continue;
    }
    // 整节就绪:ready all → 索引写入 → timing 的配音 / 退出 → 开口那一刻
    const allRel = ev.find((e) => e.lane === 'ready' && e.kind === 'all')?.t ?? ev.find((e) => e.lane === 'index')?.t ?? m.timing?.dubbedMs ?? m.timing?.doneMs ?? 0;
    const allAt = t0 + allRel;
    const beats = beatsOf(s);
    const beatEv = new Map<number, number>();
    for (const e of ev) if (e.lane === 'ready' && e.kind === 'beat') beatEv.set(e.beat, t0 + e.t);
    const streaming = beatEv.size > 0;
    const beatReady: number[] = [];
    for (let b = 0; b < beats.length; b++) beatReady.push(Math.min(allAt, Math.max(b ? beatReady[b - 1] : 0, beatEv.get(b) ?? allAt)));
    const beatOfLine = new Map<number, number>();
    beats.forEach((b, k2) => { for (const i of b.lines) beatOfLine.set(i, k2); });
    const appear = Math.min(streaming ? beatReady[0] : allAt, next);
    const track: ReelTrack = { job: m.job, at: appear, streamed: streaming, cards: [], doneAt: appear, ask: false };
    if (streaming) {
      // 老师现讲:一拍就绪铺这拍的卡(一行一张),写完了整节都在
      let n = 0;
      beats.forEach((b, k2) => { if (b.card !== null) n = Math.max(n, b.card + 1); track.cards.push({ at: beatReady[k2], n }); });
    } else track.cards.push({ at: appear, n: s.lines.length ? 0 : s.cards.length });
    const end = narrate(m.job, s, appear, next, (i) => (streaming ? beatReady[beatOfLine.get(i) ?? 0] : appear), !streaming, track);
    const spokeAll = says.filter((x) => x.job === m.job).length === s.lines.length;
    track.doneAt = s.lines.length ? end : appear;
    // 流式的节写完(转正)整节都在;整块来的念完才都在;下一次开口时前面的节不管念没念完都整节在
    track.cards.push({ at: Math.min(streaming ? allAt : track.doneAt, next), n: s.cards.length });
    track.cards.sort((a, b) => a.at - b.at);
    track.ask = spokeAll && Boolean(s.lines[s.lines.length - 1]?.ask);
    tracks.push(track);
    const first = says.find((x) => x.job === m.job)?.from ?? appear;
    if (first > t0) waits.push({ job: m.job, from: t0, to: first });
    notes.push({ job: m.job, at: t0, postAt: track.doneAt });
    if (track.ask) marks.push({ kind: 'ask', at: track.doneAt, job: m.job, label: s.lines[s.lines.length - 1].text });
  }

  // ---- 孩子开口之前的轮:从第一次开口往前倒推 ----
  let bound = speakAt[0];
  const preTracks: ReelTrack[] = [];
  const preSays: ReelSay[] = [];
  for (let k = pre.length - 1; k >= 0; k--) {
    const m = pre[k];
    const s = sectionOf(m);
    if (!s) continue;
    let need = 0;
    for (let i = 0; i < s.lines.length; i++) need += reelLineMs(s, i, input.durations) + REEL_LINE_GAP_MS;
    let start = bound - need;
    for (const f of Object.values(input.cards[m.job] ?? {})) {
      const at = reelParse(f.at);
      if (!Number.isNaN(at) && at < bound) start = Math.min(start, at - need);
    }
    const track: ReelTrack = { job: m.job, at: start, streamed: false, cards: [{ at: start, n: s.lines.length ? 0 : s.cards.length }], doneAt: start, ask: false };
    const before = says.length;
    const end = narrate(m.job, s, start, bound, () => start, true, track);
    const mine = says.splice(before);
    preSays.unshift(...mine);
    track.doneAt = s.lines.length ? end : start;
    track.cards.push({ at: track.doneAt, n: s.cards.length });
    track.ask = mine.length === s.lines.length && Boolean(s.lines[s.lines.length - 1]?.ask);
    preTracks.unshift(track);
    notes.push({ job: m.job, at: start, postAt: track.doneAt });
    if (track.ask) marks.push({ kind: 'ask', at: track.doneAt, job: m.job, label: s.lines[s.lines.length - 1].text });
    bound = start;
  }
  tracks.unshift(...preTracks);
  says.unshift(...preSays);
  says.sort((a, b) => a.from - b.from);

  const secByJob = new Map(turns.map((m) => [m.job, sectionOf(m)]));

  // ---- 实录(第二期):有 play 记录的节,念句换成记录的(孩子暂停、再听、关了自动念都在里面);没记录的节照推算 ----
  const plays = [...(input.plays ?? [])].sort((a, b) => a.at - b.at);
  const pl = plays.filter((r): r is Extract<PlayRecord, { k: 'play' }> => r.k === 'play');
  const recorded = new Set(pl.map((r) => r.job).filter((j): j is string => Boolean(j) && Boolean(secByJob.get(j!))));
  if (recorded.size) {
    const recSays: ReelSay[] = [];
    pl.forEach((r, i) => {
      const sec = r.job ? secByJob.get(r.job) : null;
      const line = sec?.lines[r.line];
      if (r.status !== 'playing' || !r.job || !sec || !line) return;
      const nextAt = i + 1 < pl.length ? pl[i + 1].at : Infinity;
      recSays.push({ job: r.job, line: r.line, from: r.at, to: Math.min(nextAt, r.at + reelLineMs(sec, r.line, input.durations)), audio: line.audio, ...(r.replay ? { replay: true as const } : {}) });
    });
    for (let i = says.length - 1; i >= 0; i--) if (recorded.has(says[i].job)) says.splice(i, 1);
    says.push(...recSays);
    says.sort((a, b) => a.from - b.from);
    for (let i = marks.length - 1; i >= 0; i--) if (marks[i].kind === 'ask' && recorded.has(marks[i].job)) marks.splice(i, 1);
    for (const t of tracks) {
      if (!recorded.has(t.job)) continue;
      const sec = secByJob.get(t.job)!;
      const mine = recSays.filter((x) => x.job === t.job && !x.replay);
      const firstRec = pl.find((r) => r.job === t.job)!.at;
      // 念完:第一次停下等孩子 / 念完了的那一刻(孩子端这时整节都在)
      const settled = pl.find((r) => r.job === t.job && (r.status === 'waiting' || r.status === 'done'));
      if (!t.streamed) {
        t.at = Math.min(firstRec, mine[0]?.from ?? firstRec);
        t.cards = [{ at: t.at, n: sec.lines.length ? 0 : sec.cards.length }, ...mine.map((x) => ({ at: x.from, n: reelUnfold(sec, x.line) }))];
        if (settled) t.cards.push({ at: settled.at, n: sec.cards.length });
      }
      t.doneAt = settled ? settled.at : mine.length ? mine[mine.length - 1].to : t.at;
      t.ask = Boolean(pl.find((r) => r.job === t.job && r.status === 'waiting'));
      if (t.ask) marks.push({ kind: 'ask', at: t.doneAt, job: t.job, label: sec.lines[sec.lines.length - 1]?.text ?? '' });
      const n = notes.find((x) => x.job === t.job);
      if (n) { if (!t.streamed && !live.some((m) => m.job === t.job)) n.at = t.at; n.postAt = t.doneAt; }
      const w = waits.find((x) => x.job === t.job);
      if (w && mine[0] && mine[0].from > w.from) w.to = mine[0].from;
    }
  }
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

  // ---- 卡的状态:有实录的卡用每一次存(选了又改都在);没有的用状态文件(at 起生效,只有最后一次)。录音卡把孩子的录音也排进来 ----
  const cards: ReelCardChange[] = [];
  const recPrefix = `conversations/${input.tutor}/`;
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
    const st = c.state as { audio?: unknown; seconds?: unknown } | null;
    if (sec.cards[c.card].kind === 'record' && st && typeof st.audio === 'string' && st.audio.startsWith(recPrefix) && typeof st.seconds === 'number' && st.seconds > 0 && !clips.some((x) => x.kind === 'rec' && x.audio === st.audio!.toString().slice(recPrefix.length))) {
      clips.push({ kind: 'rec', job: c.job, card: c.card, from: c.at - Math.round(st.seconds * 1000), to: c.at, audio: st.audio.slice(recPrefix.length) });
    }
  }
  clips.sort((a, b) => a.from - b.from);
  marks.sort((a, b) => a.at - b.at);
  notes.sort((a, b) => a.at - b.at);

  // ---- 起止与空白 ----
  const points = [...tracks.map((t) => t.at), ...speakAt, ...clips.map((c) => c.from), ...stages.map((x) => x.from)].filter((x) => Number.isFinite(x));
  const startAt = Math.min(...points);
  const running = live.some((m) => m.result === 'running');
  const lastAt = Math.max(...tracks.map((t) => t.doneAt), ...liveStarts, ...cards.map((c) => c.at), ...clips.map((c) => c.to), ...notes.map((n) => n.postAt), ...says.map((x) => x.to), ...stages.map((x) => x.to));
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
  ];
  const acts: [number, number][] = [
    ...cards.map((c): [number, number] => [c.at - 1000, c.at + 1000]),
    ...stages.flatMap((x): [number, number][] => [[x.from - 1000, x.from + 1000], [x.to - 1000, x.to + 1000]]),
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
  // 实录:每一轮孩子开口之后、有讲稿的节都有 play 记录
  const precise = recorded.size > 0 && live.every((m) => !sectionOf(m)?.lines.length || recorded.has(m.job));
  return { startAt, endAt, precise, tracks, says, clips, cards, notes, waits, gaps, marks, stages, aways };
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
  saying: { job: string; line: number; offset: number; audio: string | null } | null;
  /** 正在放的孩子的声音(录音卡的录音 / 按住说话的原声) */
  clip: { kind: ReelClip['kind']; job: string; card: number | null; offset: number; audio: string; text?: string } | null;
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
}

export function reelFrameAt(reel: Reel, t: number): ReelFrame {
  const sections: ReelFrame['sections'] = [];
  for (const tr of reel.tracks) {
    if (tr.at > t) continue;
    let n = 0;
    for (const c of tr.cards) if (c.at <= t) n = c.n;
    // 念过几句 = 念到的最远那句 + 1(暂停后接着念同一句会有两段,再听的不算)
    let spoken = 0;
    for (const x of reel.says) if (x.job === tr.job && x.from <= t && !x.replay) spoken = Math.max(spoken, x.line + 1);
    sections.push({ job: tr.job, cards: n, spoken });
  }
  let saying: ReelFrame['saying'] = null;
  let last: ReelFrame['last'] = null;
  // says 按时间排好(buildReel 保证):最后一句开始了的就是 last
  for (const x of reel.says) {
    if (x.from > t) break;
    last = { job: x.job, line: x.line };
    saying = t < x.to ? { job: x.job, line: x.line, offset: t - x.from, audio: x.audio } : null;
  }
  let clip: ReelFrame['clip'] = null;
  for (const c of reel.clips) if (c.from <= t && t < c.to) clip = { kind: c.kind, job: c.job, card: c.card, offset: t - c.from, audio: c.audio, ...(c.text !== undefined ? { text: c.text } : {}) };
  const cards: Record<string, unknown> = {};
  for (const c of reel.cards) if (c.at <= t) cards[`${c.job}/${c.card}`] = c.state;
  const notes = reel.notes.filter((x) => x.at <= t).map((x) => ({ job: x.job, post: x.postAt <= t }));
  const w = reel.waits.find((x) => x.from <= t && t < x.to);
  const gap = reel.gaps.find((g) => g.from <= t && t < g.to) ?? null;
  const tr = last ? reel.tracks.find((x) => x.job === last!.job) : undefined;
  const asking = !saying && !w && Boolean(tr && tr.ask && tr.doneAt <= t);
  const st = reel.stages.find((x) => x.from <= t && t < x.to) ?? null;
  const touched = st ? reel.cards.some((c) => c.job === st.job && c.card === st.card && c.at >= st.from && c.at <= t) : true;
  const thinking = st && !touched ? { job: st.job, card: st.card, ms: t - st.from - reelAwayMs(reel.aways, st.from, t) } : null;
  const away = reel.aways.some((a) => a.from <= t && t < a.to);
  return { sections, saying, clip, last, cards, notes, wait: w ? { job: w.job, ms: t - w.from } : null, gap, asking, stage: st ? { job: st.job, card: st.card } : null, thinking, away };
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

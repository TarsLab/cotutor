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

/** 一句念的时段;audio 相对 conversations/<老师>/(没配音 = null,页面只出字幕不出声) */
export interface ReelSay {
  job: string;
  line: number;
  from: number;
  to: number;
  audio: string | null;
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

/** 一节:什么时候出来、露几张卡的台阶(at 升序)、讲稿什么时候念完、末句是不是问句 */
export interface ReelTrack {
  job: string;
  at: number;
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
 * 推算一个话题的录像;话题里一句孩子的话都没有(没交出去的备课话题)→ null。
 * 孩子第一次开口之前的轮(交给孩子的课、备课)是孩子打开话题时一节一节念的,时刻没记:从孩子第一次开口往前倒推,一节接一节;
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
  /** 忙的时段(有人在说、老师在写):两段之间超过 REEL_THINK_MIN_MS 的空当压成 think */
  const busy: [number, number][] = [];
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
      busy.push([t0, exitAt]);
      continue;
    }
    const s = sectionOf(m);
    if (!s) {
      const end = m.result === 'running' ? input.now : exitAt;
      notes.push({ job: m.job, at: t0, postAt: end });
      if (end > t0) waits.push({ job: m.job, from: t0, to: end });
      busy.push([t0, end]);
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
    const track: ReelTrack = { job: m.job, at: appear, cards: [], doneAt: appear, ask: false };
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
    busy.push([t0, Math.max(track.doneAt, first)]);
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
    const track: ReelTrack = { job: m.job, at: start, cards: [{ at: start, n: s.lines.length ? 0 : s.cards.length }], doneAt: start, ask: false };
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
    busy.push([start, track.doneAt]);
    bound = start;
  }
  tracks.unshift(...preTracks);
  says.unshift(...preSays);
  says.sort((a, b) => a.from - b.from);

  // ---- 卡的状态:状态文件的 at 起生效;录音卡把孩子的录音也排进来 ----
  const cards: ReelCardChange[] = [];
  const secByJob = new Map(turns.map((m) => [m.job, sectionOf(m)]));
  const recPrefix = `conversations/${input.tutor}/`;
  for (const [job, per] of Object.entries(input.cards)) {
    const s = secByJob.get(job);
    if (!s) continue;
    for (const [nStr, f] of Object.entries(per)) {
      const n = Number(nStr);
      const at = reelParse(f.at);
      if (Number.isNaN(at) || !s.cards[n]) continue;
      cards.push({ job, card: n, at, state: f.state });
      marks.push({ kind: 'card', at, job, label: cardTitle(s.cards[n]) });
      const st = f.state as { audio?: unknown; seconds?: unknown } | null;
      if (s.cards[n].kind === 'record' && st && typeof st.audio === 'string' && st.audio.startsWith(recPrefix) && typeof st.seconds === 'number' && st.seconds > 0) {
        clips.push({ kind: 'rec', job, card: n, from: at - Math.round(st.seconds * 1000), to: at, audio: st.audio.slice(recPrefix.length) });
      }
    }
  }
  cards.sort((a, b) => a.at - b.at);
  // 孩子的录音照真实时间放,不被压掉
  for (const c of clips) busy.push([c.from, c.to]);
  clips.sort((a, b) => a.from - b.from);
  marks.sort((a, b) => a.at - b.at);
  notes.sort((a, b) => a.at - b.at);

  // ---- 起止与空白 ----
  const points = [...tracks.map((t) => t.at), ...speakAt, ...clips.map((c) => c.from)].filter((x) => Number.isFinite(x));
  const startAt = Math.min(...points);
  const running = live.some((m) => m.result === 'running');
  const lastAt = Math.max(...tracks.map((t) => t.doneAt), ...liveStarts, ...cards.map((c) => c.at), ...clips.map((c) => c.to), ...notes.map((n) => n.postAt));
  const endAt = running ? Math.max(input.now, lastAt) : lastAt + REEL_TAIL_MS;
  const gaps: ReelGap[] = [];
  for (const w of waits) if (w.to - w.from > REEL_WAIT_KEEP_MS) gaps.push({ kind: 'wait', from: w.from + REEL_WAIT_KEEP_MS, to: w.to, ms: w.to - w.from });
  busy.sort((a, b) => a[0] - b[0]);
  let reach = startAt;
  for (const [from, to] of busy) {
    if (from - reach > REEL_THINK_MIN_MS) gaps.push({ kind: 'think', from: reach, to: from, ms: from - reach });
    reach = Math.max(reach, to);
  }
  gaps.sort((a, b) => a.from - b.from);
  return { startAt, endAt, precise: false, tracks, says, clips, cards, notes, waits, gaps, marks };
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
}

export function reelFrameAt(reel: Reel, t: number): ReelFrame {
  const sections: ReelFrame['sections'] = [];
  for (const tr of reel.tracks) {
    if (tr.at > t) continue;
    let n = 0;
    for (const c of tr.cards) if (c.at <= t) n = c.n;
    sections.push({ job: tr.job, cards: n, spoken: reel.says.filter((x) => x.job === tr.job && x.from <= t).length });
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
  return { sections, saying, clip, last, cards, notes, wait: w ? { job: w.job, ms: t - w.from } : null, gap, asking };
}

/** 「2 分 10 秒」「23 秒」「1 小时 5 分」 */
export function reelDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} 分 ${s % 60} 秒` : `${m} 分`;
  return m % 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${Math.floor(m / 60)} 小时`;
}

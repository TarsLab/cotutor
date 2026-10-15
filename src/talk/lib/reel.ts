/**
 * 口语课录像的轨道(《口语课设计.md》§8.3;播放器同《家长录像设计.md》拍板 13–15):reel.json → 章、进度条上的点、经过、可压的空白;
 * 任一刻放到第几条消息、老师在不在出声、孩子在不在出声。孩子的屏幕不在这里画:录像模式把 ≤ t 的消息原样喂回孩子端页面自己的处理函数。
 * 纯函数,没有 import、不碰 DOM:口语课页面的录像模式把它内联进去(src/server/inline-lib.ts)。时间都是离通话开始的毫秒。
 */

export type TkMsg = [number, 'o' | 'i', Record<string, unknown>];
export interface TkReelData { v: 1; startedAt: string; ms: number; view: [number, number] | null; msgs: TkMsg[]; playing: [number, number][]; kidVoice?: [number, number][] }
export interface TkReel {
  startAt: number;
  end: number;
  msgs: TkMsg[];
  playing: [number, number][];
  kidVoice: [number, number][];
  size: [number, number];
  chapters: { t: number; title: string }[];
  marks: { t: number; kind: string; label: string }[];
  notes: { t: number; kind: string; chip: string; text: string }[];
  gaps: { from: number; to: number }[];
}

/** 空白压成多长;多长的没动静才压 */
export const TK_SQUEEZE_MS = 1500;
const TK_GAP_MS = 5000;

const TK_END: Record<string, string> = { bye: '孩子挂的', time: '到点了,老师收尾', idle: '半天没说话,挂了', left: '离开了页面', max: '打太久了,挂了', 'kid-gone': '孩子端断了' };

/** 一段时间里有没有 t */
export function tkIn(spans: [number, number][], t: number): boolean {
  for (const [a, b] of spans) { if (t < a) return false; if (t <= b) return true; }
  return false;
}

export function tkBuild(d: TkReelData, words: { en: string }[]): TkReel {
  const chapters: TkReel['chapters'] = [];
  const marks: TkReel['marks'] = [];
  const notes: TkReel['notes'] = [];
  let phase = '';
  let lastI = -1;
  let again = 0;
  let mode = '';
  let waited = false;
  for (const [t, dir, m] of d.msgs) {
    const k = m.t;
    if (dir === 'i') {
      const tap: Record<string, string> = { again: '点了「再听一遍」', next: '点了「下一句」', chat: '点了「直接打电话」', bye: '点了「挂断」' };
      if (typeof k === 'string' && tap[k]) notes.push({ t, kind: 'tap', chip: '点', text: tap[k] });
      else if (k === 'say') notes.push({ t, kind: 'tap', chip: '点', text: '点了「听」:' + String(m.w ?? '') });
      continue;
    }
    if (k === 'state') {
      const ph = String(m.phase ?? '');
      const item = m.item as { en?: string } | null;
      const rd = m.rd as { mode?: string; again?: number } | null;
      // 读完最后一句、开聊前那一下 i 越过了头(item 是空的),不算一章
      if (ph === 'read' && typeof m.i === 'number' && m.i !== lastI && item) {
        lastI = m.i; again = 0; waited = false;
        chapters.push({ t, title: '跟我读 ' + (m.i + 1) + ' · ' + (item && item.en ? item.en : '') });
      }
      if (ph === 'chat' && phase !== 'chat') {
        chapters.push({ t, title: '打电话' });
        notes.push({ t, kind: 'tail', chip: '打电话', text: phase === 'read' ? '跟我读完了,开始打电话' : '开始打电话' });
      }
      if (rd) {
        const a = typeof rd.again === 'number' ? rd.again : 0;
        if (a > again) {
          const why = mode === 'heard' ? '读的跟这句不沾' : '没出声';
          marks.push({ t, kind: 'miss', label: why + ',老师再读一遍' });
          notes.push({ t, kind: 'miss', chip: '再读', text: why + ',老师再读一遍(第 ' + a + ' 遍)' });
        }
        again = a;
        if (rd.mode === 'wait' && !waited) { waited = true; notes.push({ t, kind: 'miss', chip: '等着', text: '再读两遍还没出声,不催了,等他' }); }
        mode = String(rd.mode ?? '');
      }
      phase = ph;
    } else if (k === 'tutor' && typeof m.done === 'string' && m.done) {
      notes.push({ t, kind: 'tutor', chip: '老师', text: m.done });
    } else if (k === 'kid' && typeof m.text === 'string') {
      notes.push({ t, kind: 'said', chip: phase === 'read' ? '读' : '说', text: m.text });
      marks.push({ t, kind: 'said', label: m.text });
    } else if (k === 'card' && typeof m.i === 'number') {
      const w = words[m.i] ? words[m.i].en : '';
      marks.push({ t, kind: 'card', label: '讲到 ' + w });
      notes.push({ t, kind: 'card', chip: '卡', text: '讲到 ' + w + ',那张单词卡亮了' });
    } else if (k === 'end') {
      const why = String(m.why ?? '');
      notes.push({ t, kind: 'tail', chip: '挂断', text: TK_END[why] || why });
    }
  }
  // 空白:没有消息、老师没出声、孩子没出声的地方;前后各留一点
  const kidVoice = d.kidVoice || [];
  const busy: [number, number][] = [...d.msgs.filter((x) => !(x[1] === 'i' && x[2].t === 'view')).map((x): [number, number] => [x[0], x[0]]), ...d.playing, ...kidVoice].sort((a, b) => a[0] - b[0]);
  const gaps: TkReel['gaps'] = [];
  let edge = 0;
  for (const [a, b] of busy) {
    if (a - edge > TK_GAP_MS) gaps.push({ from: edge + 1000, to: a - 500 });
    edge = Math.max(edge, b);
  }
  return { startAt: Date.parse(d.startedAt) || 0, end: d.ms, msgs: d.msgs, playing: d.playing, kidVoice, size: d.view || [1180, 820], chapters, marks, notes, gaps };
}

/** 放到哪(p)与通话里的时刻(t)来回换:跳过空白开着时空白压成 TK_SQUEEZE_MS */
export function tkClock(r: TkReel, real: boolean): { total: number; toPlay(t: number): number; toWall(p: number): number } {
  const gs = real ? [] : r.gaps;
  const toPlay = (t: number): number => {
    let cut = 0;
    for (const g of gs) {
      if (t >= g.to) cut += g.to - g.from - TK_SQUEEZE_MS;
      else if (t > g.from) return g.from - cut + ((t - g.from) / (g.to - g.from)) * TK_SQUEEZE_MS;
      else break;
    }
    return t - cut;
  };
  const toWall = (p: number): number => {
    let cut = 0;
    for (const g of gs) {
      const pa = g.from - cut;
      if (p < pa) return p + cut;
      if (p <= pa + TK_SQUEEZE_MS) return g.from + ((p - pa) / TK_SQUEEZE_MS) * (g.to - g.from);
      cut += g.to - g.from - TK_SQUEEZE_MS;
    }
    return p + cut;
  };
  return { total: toPlay(r.end), toPlay, toWall };
}

/** ≤ t 的消息有几条 */
export function tkUpto(r: TkReel, t: number): number {
  let lo = 0, hi = r.msgs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (r.msgs[mid][0] <= t) lo = mid + 1; else hi = mid; }
  return lo;
}

/** 录像栏「这一刻」那一行 */
export function tkCaption(r: TkReel, t: number): { text: string; cls: string } {
  for (const g of r.gaps) if (t > g.from && t < g.to) return { text: '孩子想了 ' + Math.round((g.to - g.from + 1500) / 1000) + ' 秒', cls: 'gap' };
  if (tkIn(r.kidVoice, t)) return { text: '孩子在说', cls: 'kid' };
  if (tkIn(r.playing, t)) {
    for (let i = tkUpto(r, t) - 1; i >= 0; i--) { const m = r.msgs[i][2]; if (r.msgs[i][1] === 'o' && m.t === 'tutor' && typeof m.done === 'string') return { text: '老师在说:' + m.done, cls: '' }; }
    return { text: '老师在说', cls: '' };
  }
  return { text: '', cls: 'gap' };
}

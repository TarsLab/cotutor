/**
 * 小老师的转写(《wip/小老师设想.md》§五、拍板 7):讲的时候浏览器在认,一段一行;讲完看够不够,不够才叫 paraformer。
 * 这里只有纯计算:一行的形状、浏览器的段 → 行、paraformer 的句 → 行、够不够、重转时留下家长改过的行。
 */

/** 转写的一行:at = 离开始讲多少毫秒;edited = 家长改过 */
export interface Line {
  at: number;
  text: string;
  edited?: true;
}

export type AsrSource = 'browser' | 'paraformer';

export interface Transcript {
  source: AsrSource;
  /** 为什么叫了 paraformer(自动判的原因,或「家长重转」) */
  why?: string;
  lines: Line[];
}

/** 浏览器认出的一段:at = 这段开始说的时刻,end = 最后一次出字的时刻 */
export interface BrowserSeg {
  at: number;
  end: number;
  text: string;
}

/** paraformer 的一句(实时接口的 sentence_end 那条);words 带标点,长句按它切 */
export interface AsrSentence {
  begin: number;
  end: number;
  text: string;
  words?: { begin: number; end: number; text: string; punctuation: string }[];
}

/** 讲的那一趟,页面交来的(笔迹另存) */
export interface TalkMeta {
  /** 讲了多久 */
  ms: number;
  /** 这台有没有浏览器识别 */
  sr: boolean;
  /** 每 100 毫秒一格的音量,0–100 */
  levels: number[];
  segs: BrowserSeg[];
}

/** 毫秒 → 「分:秒」;一小时以上带小时 */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 「分:秒」或「时:分:秒」→ 毫秒;认不出 → null */
export function parseClock(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const sec = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number(m[3]) < 60 ? sec * 1000 : null;
}

const PUNCT_RE = /[，。！？、；：,.!?;:…\s]/g;
const charCount = (s: string): number => s.replace(PUNCT_RE, '').length;

export function fromBrowser(segs: BrowserSeg[]): Line[] {
  return segs
    .map((s) => ({ at: Math.max(0, Math.round(s.at)), text: s.text.trim() }))
    .filter((l) => l.text)
    .sort((a, b) => a.at - b.at);
}

/** 一句太长(过 24 个字)就在带句读的词后面切开,每段从它第一个词的时刻起 */
export function fromParaformer(sentences: AsrSentence[]): Line[] {
  const out: Line[] = [];
  for (const s of sentences) {
    const words = s.words ?? [];
    if (charCount(s.text) <= 24 || words.length === 0) {
      if (s.text.trim()) out.push({ at: Math.max(0, Math.round(s.begin)), text: s.text.trim() });
      continue;
    }
    let at = words[0].begin;
    let text = '';
    for (const w of words) {
      if (!text) at = w.begin;
      text += w.text + w.punctuation;
      if (w.punctuation && /[，。！？；,.!?;]/.test(w.punctuation) && charCount(text) >= 8) {
        out.push({ at: Math.round(at), text: text.trim() });
        text = '';
      }
    }
    if (text.trim()) out.push({ at: Math.round(at), text: text.trim() });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** 音量过这条线算在说话(页面的音量是 RMS×4 再 ×100) */
export const SPEAK_LEVEL = 12;
/** 有声没字连着这么久就叫 paraformer(拍板 7:先定 3 秒,真用再调) */
export const GAP_MS = 3000;
const FRAME_MS = 100;
/** 说话的一段里,停这么久以内还算同一段 */
const BRIDGE_FRAMES = 5;
/** 一段识别前后各放宽这么多(开头出字晚、结尾的尾音) */
const SEG_PAD_MS = 700;
/** 认出的字少于说话秒数 × 这个数 = 字太少(孩子一秒三四个字,这条很宽) */
const MIN_CHARS_PER_SEC = 1;

/** 音量里说话的几段 [起, 止)(毫秒) */
export function speechRuns(levels: number[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  let quiet = 0;
  for (let i = 0; i <= levels.length; i++) {
    const loud = i < levels.length && levels[i] >= SPEAK_LEVEL;
    if (loud) {
      if (start < 0) start = i;
      quiet = 0;
    } else if (start >= 0) {
      quiet++;
      if (quiet > BRIDGE_FRAMES || i === levels.length) {
        const end = i - quiet + 1;
        if (end - start >= 3) runs.push([start * FRAME_MS, end * FRAME_MS]);
        start = -1;
        quiet = 0;
      }
    }
  }
  return runs;
}

/** 浏览器那份够不够:不够给原因(这台没有识别 / 有声没字 / 字太少);没说话就不叫 */
export function needParaformer(t: TalkMeta): { need: boolean; why: string } {
  const runs = speechRuns(t.levels);
  const speechMs = runs.reduce((a, [s, e]) => a + (e - s), 0);
  if (!t.sr) return { need: speechMs > 0 || t.levels.length === 0, why: '这台没有浏览器识别' };
  if (speechMs === 0) return { need: false, why: '' };
  const covered = t.segs.filter((s) => s.text.trim()).map((s) => [s.at - SEG_PAD_MS, s.end + SEG_PAD_MS] as const);
  for (const [s, e] of runs) {
    let gapStart = -1;
    for (let at = s; at <= e; at += FRAME_MS) {
      const hit = at < e && covered.some(([a, b]) => at >= a && at < b);
      if (!hit && at < e) {
        if (gapStart < 0) gapStart = at;
      } else if (gapStart >= 0) {
        if (at - gapStart >= GAP_MS) return { need: true, why: `有声没字 ${clock(gapStart)}–${clock(at)}` };
        gapStart = -1;
      }
    }
  }
  const chars = t.segs.reduce((a, s) => a + charCount(s.text), 0);
  const sec = speechMs / 1000;
  if (sec >= 5 && chars < sec * MIN_CHARS_PER_SEC) return { need: true, why: `字太少:说了约 ${Math.round(sec)} 秒,认出 ${chars} 个字` };
  return { need: false, why: '' };
}

/** 家长改了几行:同一位置字变了就标 edited(改回原样也还算改过);行数对不上 → null */
export function applyEdits(old: Line[], incoming: string[]): Line[] | null {
  if (incoming.length !== old.length) return null;
  return old.map((l, i) => {
    const text = incoming[i].trim();
    return text === l.text ? l : { at: l.at, text, edited: true as const };
  });
}

/** 重转:家长改过的行留着,新的行里离它 1.5 秒以内的不要 */
export function mergeRetranscribe(old: Line[], fresh: Line[]): Line[] {
  const kept = old.filter((l) => l.edited);
  const rest = fresh.filter((f) => !kept.some((k) => Math.abs(k.at - f.at) < 1500));
  return [...kept, ...rest].sort((a, b) => a.at - b.at);
}

/** 第 i 行到哪儿结束(下一行开始,或讲完) */
export function lineEnd(lines: Line[], i: number, totalMs: number): number {
  return i + 1 < lines.length ? lines[i + 1].at : Math.max(totalMs, lines[i].at);
}

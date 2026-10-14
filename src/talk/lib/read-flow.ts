/**
 * 跟我读不用按(《wip/口语课设想.md》§8.1):孩子读完自动下一句,几秒没出声老师再读一遍。纯函数,时间由调用方给。
 * 两样:
 *   vadStep  按上来那一块声音的响度判孩子开口 / 停(百炼的工作区端点 10-14 在本机连不上,没验 create_response:false,先不靠它的 VAD;
 *            跟读那条会话照旧手动轮次,判出停了由 relay commit 拿转写)
 *   readStep 一句的状态机:老师在读 → 等孩子 → 孩子在读 → 等转写 → 下一句 / 再读一遍
 * 往不往下走由这里定,模型只管念;屏上不画对错。
 */

export interface ReadRules {
  /** 老师读完多久没开口就再读一遍 */
  waitMs: number;
  /** 一句里自动再读最多几遍;用完了不再催,等着 */
  again: number;
  /** 开口之后静多久算读完 */
  endMs: number;
  /** 转写里有这句的词占多少算读完(单词就是那个词) */
  pass: number;
}
export const READ_RULES: ReadRules = { waitMs: 5000, again: 2, endMs: 900, pass: 0.5 };

// ---- 开口 / 停 ----

/** 响度(PCM16 的 RMS,0–1)低于这个永远不算开口 */
const MIN_LEVEL = 0.015;
/** 连着响这么久才算开口(滤掉一下咳嗽、碰桌子) */
const START_MS = 200;

export interface Vad { on: boolean; loudMs: number; quietMs: number; floor: number }
export const vadInit = (): Vad => ({ on: false, loudMs: 0, quietMs: 0, floor: 0.003 });

/** 门限:底噪的 4 倍,至少 MIN_LEVEL;开口后降到 0.7 倍(句中轻的音不算停) */
const threshold = (v: Vad): number => Math.max(MIN_LEVEL, v.floor * 4);

/** 一块声音(ms 毫秒长、响度 level)→ 新状态与「开口 / 停」 */
export function vadStep(v: Vad, level: number, ms: number, endMs: number): { v: Vad; ev: 'start' | 'stop' | null } {
  const th = threshold(v);
  if (!v.on) {
    if (level >= th) {
      const loudMs = v.loudMs + ms;
      if (loudMs >= START_MS) return { v: { ...v, on: true, loudMs, quietMs: 0 }, ev: 'start' };
      return { v: { ...v, loudMs }, ev: null };
    }
    // 只在静的时候跟底噪(慢慢跟,一块响的不带偏)
    return { v: { ...v, loudMs: 0, floor: Math.min(0.05, v.floor * 0.9 + level * 0.1) }, ev: null };
  }
  if (level < th * 0.7) {
    const quietMs = v.quietMs + ms;
    if (quietMs >= endMs) return { v: { ...v, on: false, loudMs: 0, quietMs: 0 }, ev: 'stop' };
    return { v: { ...v, quietMs }, ev: null };
  }
  return { v: { ...v, quietMs: 0 }, ev: null };
}

// ---- 读到了多少 ----

const CONTRACT: Record<string, string> = { "it's": 'it is', "i'm": 'i am', "that's": 'that is', "what's": 'what is', "he's": 'he is', "she's": 'she is', "there's": 'there is', "don't": 'do not', "can't": 'can not', "isn't": 'is not', "you're": 'you are', "they're": 'they are', "we're": 'we are', "let's": 'let us', "i'll": 'i will' };

/** 小写、展开常见缩写、去标点,拆成词 */
export function wordsOf(s: string): string[] {
  const t = s.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z' ]+/g, ' ');
  return t.split(/\s+/).flatMap((w) => (CONTRACT[w] ?? w.replace(/^'+|'+$/g, '')).split(' ')).filter(Boolean);
}

/** 两个词算不算同一个:一样;或四个字母以上差一个字母(认字的错一个字母常见:colour / color、apples / apple) */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

/** 这句(target)的词有多少出现在孩子读的(heard)里,0–1;不分先后 */
export function coverage(target: string, heard: string): number {
  const want = [...new Set(wordsOf(target))];
  if (!want.length) return 0;
  const got = wordsOf(heard);
  return want.filter((w) => got.some((g) => near(w, g))).length / want.length;
}

// ---- 一句的状态机 ----

/** tutor 老师在读(声音没放完)· listen 等孩子 · speech 孩子在读 · heard 等转写 · wait 自动再读用完了,只等孩子 */
export type ReadMode = 'tutor' | 'listen' | 'speech' | 'heard' | 'wait';
export interface ReadState { mode: ReadMode; since: number; again: number }
export type ReadEvent =
  | { e: 'cue'; t: number; fresh: boolean }
  | { e: 'idle'; t: number }
  | { e: 'start'; t: number }
  | { e: 'stop'; t: number }
  | { e: 'text'; t: number; text: string; target: string }
  | { e: 'tick'; t: number };
/** commit 把孩子读的交出去转写 · next 读完了 · again 老师再读一遍(自动的) */
export type ReadAction = 'commit' | 'next' | 'again' | null;

export const readInit = (t = 0): ReadState => ({ mode: 'tutor', since: t, again: 0 });
/** 转写一直不回来(网络卡了)就当读完 */
const TEXT_TIMEOUT_MS = 5000;

export function readStep(s: ReadState, ev: ReadEvent, rules: ReadRules = READ_RULES): { s: ReadState; act: ReadAction } {
  const keep = { s, act: null };
  switch (ev.e) {
    case 'cue': return { s: { mode: 'tutor', since: ev.t, again: ev.fresh ? 0 : s.again }, act: null };
    case 'idle': return s.mode === 'tutor' ? { s: { ...s, mode: s.again >= rules.again ? 'wait' : 'listen', since: ev.t }, act: null } : keep;
    case 'start': return s.mode === 'listen' || s.mode === 'wait' ? { s: { ...s, mode: 'speech', since: ev.t }, act: null } : keep;
    case 'stop': return s.mode === 'speech' ? { s: { ...s, mode: 'heard', since: ev.t }, act: 'commit' } : keep;
    case 'text': {
      if (s.mode !== 'heard') return keep;
      if (!ev.text.trim()) return { s: { ...s, mode: s.again >= rules.again ? 'wait' : 'listen', since: ev.t }, act: null };
      if (coverage(ev.target, ev.text) >= rules.pass || s.again >= rules.again) return { s: { ...s, mode: 'tutor', since: ev.t }, act: 'next' };
      return { s: { mode: 'tutor', since: ev.t, again: s.again + 1 }, act: 'again' };
    }
    case 'tick':
      if (s.mode === 'listen' && ev.t - s.since >= rules.waitMs) {
        if (s.again < rules.again) return { s: { mode: 'tutor', since: ev.t, again: s.again + 1 }, act: 'again' };
        return { s: { ...s, mode: 'wait', since: ev.t }, act: null };
      }
      if (s.mode === 'heard' && ev.t - s.since >= TEXT_TIMEOUT_MS) return { s: { ...s, mode: 'tutor', since: ev.t }, act: 'next' };
      return keep;
  }
}

/** 等孩子时离自动再读还有多久(孩子端画倒计时的圈);不在等、或自动再读用完了回 null */
export function readLeft(s: ReadState, t: number, rules: ReadRules = READ_RULES): number | null {
  if (s.mode !== 'listen' || s.again >= rules.again) return null;
  return Math.max(0, rules.waitMs - (t - s.since));
}

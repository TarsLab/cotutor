/**
 * 一直听:VAD 切出来、转写回来的一句,收下(算孩子对老师说的,同按下 + 松手)还是放过(《wip/实时老师常开麦设计.md》§四)。纯函数。
 * 按顺序:空的(咳嗽、碰桌子)→ 只有语气词、老师上一句又不是问句 → 是嘴自己的回声(开口时嘴的声音还在放,且和嘴最近说过的字重合过六成)→ 其余收下。
 * 回声只在嘴出声的时候才有:嘴停了以后孩子照着说一遍(跟读、复述老师的话)字一样也是孩子的(2026-10-20 评估口语课时改)。
 * 「不是对老师说的」(孩子跟家长说话)不在这里判(待拍板 3)。
 */

export type Skip = 'empty' | 'filler' | 'echo';
export type Verdict = { take: true } | { take: false; why: Skip };

/** 嘴说过的字留多久用来比回声 */
export const ECHO_WINDOW_MS = 10_000;
/** 重合到这么多算回声 */
const ECHO_RATIO = 0.6;
const FILLERS = new Set(['嗯', '啊', '哦', '呃', '哈', '额', '唔', '噢', '诶', '欸', '哎', '嗯嗯', '啊啊', '哦哦', '嗯啊', 'um', 'uh', 'hmm', 'mm']);

/** 只留字:去标点、空白,英文小写 */
export const bare = (s: string): string => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

/** 相邻两个字一组;一个字的就是它自己 */
function pairs(s: string): string[] {
  const cs = [...s];
  if (cs.length < 2) return cs;
  return cs.slice(1).map((c, i) => cs[i] + c);
}

/** text 有几成落在 said 里(按相邻两字比,中英都行) */
export function overlap(text: string, said: string): number {
  const t = pairs(bare(text));
  if (!t.length) return 0;
  const s = new Set(pairs(bare(said)));
  return t.filter((p) => s.has(p)).length / t.length;
}

/**
 * 判一句。asked = 老师上一句是问句(孩子在答,「嗯」「对」就是回答);said = 嘴最近说过的话(带说完的墙钟),now 用来挑 ECHO_WINDOW_MS 以内的;
 * mouthOn = 孩子开口那一刻嘴的声音还在放(或刚放完 300 毫秒内),false 时不比回声
 */
export function judge(text: string, o: { asked: boolean; said: { text: string; at: number }[]; now: number; mouthOn?: boolean }): Verdict {
  const t = bare(text);
  if (!t) return { take: false, why: 'empty' };
  if (!o.asked && t.length <= 2 && FILLERS.has(t)) return { take: false, why: 'filler' };
  const recent = o.said.filter((x) => o.now - x.at <= ECHO_WINDOW_MS).map((x) => x.text).join('');
  // 两个字以内的不比回声(「对」「好的」碰巧在嘴的话里也常见)
  if (o.mouthOn !== false && recent && t.length > 2 && overlap(t, recent) >= ECHO_RATIO) return { take: false, why: 'echo' };
  return { take: true };
}

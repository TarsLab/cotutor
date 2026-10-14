/**
 * 单词卡(cards/word)的排版:四线三格里每个字母摆在哪。纯函数,没有 import;孩子端的老师页与口语课都把它内联进页面(src/server/word-draw.ts)。
 */

/** 单词卡一个字母摆在哪:x 是左边界(x 高为 1),chunk 是它在第几段(没分段都是 0) */
export interface WordSlot {
  ch: string;
  x: number;
  chunk: number;
}

/**
 * 单词卡的排版(四线三格,x 高为 1):字母按 advance + 字间距从左往右排,空格只前进;split 时段与段之间再空 splitGap(舞台里分开写)。
 * 字形数据里没有的字母宽按 0.8 算(页面画不出笔顺,退成字体的字)。
 */
export function wordLayout(word: string, glyphs: Record<string, { advance: number }>, opts: { gap: number; space: number; chunks?: readonly string[]; split?: boolean; splitGap?: number }): { slots: WordSlot[]; width: number } {
  const owner: number[] = [];
  (opts.chunks && opts.chunks.join('') === word ? opts.chunks : [word]).forEach((c, k) => { for (let i = 0; i < c.length; i++) owner.push(k); });
  const splitGap = opts.split ? opts.splitGap ?? 0.8 : 0;
  const slots: WordSlot[] = [];
  let x = 0;
  let prev = -1;
  Array.from(word).forEach((ch, i) => {
    const chunk = owner[i] ?? 0;
    if (i > 0) x += opts.gap + (chunk !== prev ? splitGap : 0);
    prev = chunk;
    if (ch === ' ') { x += opts.space; return; }
    slots.push({ ch, x, chunk });
    x += glyphs[ch]?.advance ?? 0.8;
  });
  return { slots, width: x };
}


/**
 * 孩子说的英文说出了几个词:实时老师的热身(src/scenes/talk/warmup.ts)用。纯函数。
 * 比的是转写的字,不是发音:百炼的转写会往对的词上靠(coach),说出来了不等于念对了。
 */

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

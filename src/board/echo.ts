/**
 * 请孩子说(讲稿的 `[[请 说 duck]]`):
 * 那句念完停下等孩子,他说的是不是要他说的那一句(往下念)、还是对老师说的(交出去);每拍记一行,交给脑(上下文包 live.echo)。纯函数。
 * 比的是转写的字,不是发音:百炼的转写会往对的词上靠,所以只说明开没开口、说出了哪些词、自己说不说得出,不说明念得准不准。
 * 英文按词比,中文按字比。
 */

const CONTRACT: Record<string, string> = { "it's": 'it is', "i'm": 'i am', "that's": 'that is', "what's": 'what is', "he's": 'he is', "she's": 'she is', "there's": 'there is', "don't": 'do not', "can't": 'can not', "isn't": 'is not', "you're": 'you are', "they're": 'they are', "we're": 'we are', "let's": 'let us', "i'll": 'i will' };
const CJK = /[一-鿿]/g;
const HAS_CJK = /[一-鿿]/;

/** 英文的词:小写、展开常见缩写、去标点 */
export function wordsOf(s: string): string[] {
  const t = s.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z' ]+/g, ' ');
  return t.split(/\s+/).flatMap((w) => (CONTRACT[w] ?? w.replace(/^'+|'+$/g, '')).split(' ')).filter(Boolean);
}

/** 一句拆成比的单位:英文的词,加上一个一个汉字 */
function unitsOf(s: string): string[] {
  return [...wordsOf(s), ...(s.match(CJK) ?? [])];
}

/** 两个词算不算同一个:一样;或四个字母以上差一个字母(认字的错一个字母常见:colour / color、apples / apple) */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1 || HAS_CJK.test(a) || HAS_CJK.test(b)) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

/** 这句(target)的词、字有多少出现在孩子说的(heard)里,0–1;不分先后 */
export function coverage(target: string, heard: string): number {
  const want = [...new Set(unitsOf(target))];
  if (!want.length) return 0;
  const got = unitsOf(heard);
  return want.filter((w) => got.some((g) => near(w, g))).length / want.length;
}

/**
 * 是在说要他说的那一句,还是对老师说的:说出了那一句里的词(英文一个就算,「under under 在下面」也算;中文要一半的字);
 * 或四个英文词以内、没有中文(「Boss!」);或三个汉字以内、没有英文(你先说时答的「鸭子」、学鸭子叫的「嘎嘎嘎」)。
 * 其余(「那我们直接看下一个吧」「我不想读」)是对老师说的
 */
export function echoKind(text: string, word: string): 'said' | 'talk' {
  if (word && coverage(word, text) >= (HAS_CJK.test(word) ? 0.5 : Number.MIN_VALUE)) return 'said';
  const en = wordsOf(text).length;
  const zh = (text.match(CJK) ?? []).length;
  if (!zh && en >= 1 && en <= 4) return 'said';
  if (!en && zh >= 1 && zh <= 3) return 'said';
  return 'talk';
}

/** 这句讲稿里老师自己说了要孩子说的那一句没有:说了 = 跟我说;没说 = 你先说(「鸭子,英文怎么说?」) */
export function sayFirst(line: string, word: string): boolean {
  return coverage(word, line) < 0.5;
}

/** 一拍:要他说哪一句、是不是你先说、怎么样(说了 / 没开口 / 是对老师说的)、转写、念完到开口几毫秒、说出了那一句里几成的词 */
export interface EchoBeat {
  word: string;
  say: boolean;
  outcome: 'said' | 'silent' | 'talk';
  text?: string;
  startMs?: number;
  hit?: number;
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} 秒`;

/** 一拍一行(给脑看;家长那几句由脑写在尾巴里) */
export function echoLines(beats: readonly EchoBeat[]): string[] {
  return beats.map((b) => {
    const head = `${b.say ? '自己说' : '跟'} ${b.word || '(没写)'}:`;
    if (b.outcome === 'silent') return `${head}没开口`;
    if (b.outcome === 'talk') return `${head}没跟,对你说「${b.text ?? ''}」`;
    const n = new Set(unitsOf(b.word)).size;
    const got = n > 1 && b.hit !== undefined ? `,说出 ${Math.round(b.hit * n)}/${n} 个${HAS_CJK.test(b.word) ? '字' : '词'}` : n === 1 && b.hit === 0 ? `(转写里没有 ${b.word})` : '';
    const zh = !HAS_CJK.test(b.word) && HAS_CJK.test(b.text ?? '') ? ',带中文' : '';
    const fast = b.startMs !== undefined ? `,开口 ${secs(b.startMs)}` : '';
    return `${head}说了「${b.text ?? ''}」${got}${zh}${fast}`;
  });
}

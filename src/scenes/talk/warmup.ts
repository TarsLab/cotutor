/**
 * 热身:讲稿 [[echo 词]] / [[say 词]] 那句念完,孩子说的是跟读(往下一拍)还是对老师说的(交给脑);
 * 每拍记一条,拼成摸底交给脑(上下文包 live.warmup)。纯函数。
 * 比的是转写的字:百炼的转写会往对的词上靠,所以摸底只说明开没开口、说出了哪些词、自己说不说得出,不说明发音。
 */
import { coverage, wordsOf } from './en-words.ts';

const CJK = /[\u4e00-\u9fff]/g;
const HAS_CJK = /[\u4e00-\u9fff]/;

/**
 * 跟读还是对老师说的:说出了记号里的词(「under under 在下面」也算);或四个英文词以内、没有中文(「Boss!」);
 * 或三个汉字以内、没有英文(你先说时答的「鸭子」、学鸭子叫的「嘎嘎嘎」)。其余(「那我们直接打电话吧」「我不想读」)是对老师说的
 */
export function echoKind(text: string, word: string): 'said' | 'talk' {
  if (word && coverage(word, text) > 0) return 'said';
  const en = wordsOf(text).length;
  const zh = (text.match(CJK) ?? []).length;
  if (!zh && en >= 1 && en <= 4) return 'said';
  if (!en && zh >= 1 && zh <= 3) return 'said';
  return 'talk';
}

/** 一拍:跟哪个词、是不是你先说、怎么样(说了 / 没开口 / 是对老师说的)、转写、念完到开口几毫秒、说出了记号里几成的词 */
export interface WarmBeat {
  word: string;
  say: boolean;
  outcome: 'said' | 'silent' | 'talk';
  text?: string;
  startMs?: number;
  hit?: number;
}

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} 秒`;

/** 摸底,一拍一行(给脑看;家长那几句由脑写在尾巴里) */
export function warmLines(beats: readonly WarmBeat[]): string[] {
  return beats.map((b) => {
    const head = `${b.say ? '自己说' : '跟'} ${b.word || '(没写词)'}:`;
    if (b.outcome === 'silent') return `${head}没开口`;
    if (b.outcome === 'talk') return `${head}没跟,对你说「${b.text ?? ''}」`;
    const n = new Set(wordsOf(b.word)).size;
    const got = n > 1 && b.hit !== undefined ? `,说出 ${Math.round(b.hit * n)}/${n} 个词` : n === 1 && b.hit === 0 ? `(转写里没有 ${b.word})` : '';
    const zh = HAS_CJK.test(b.text ?? '') ? ',带中文' : '';
    const fast = b.startMs !== undefined ? `,开口 ${secs(b.startMs)}` : '';
    return `${head}说了「${b.text ?? ''}」${got}${zh}${fast}`;
  });
}

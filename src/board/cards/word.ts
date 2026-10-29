/**
 * 单词卡(kind 名 word):一个英文单词(或短词组),孩子端写在四线三格里,讲到这张卡时按笔顺写一遍;卡上没有中文(意思在讲稿里说)。
 * 点开舞台:自动慢念、按自然拼读分段一段一段慢写、合拢再慢念。笔顺是确定性资源(drawtell/glyphs,服务 /api/kid/letters/<词> 采好点),
 * 老师只写词、emoji 与分段。配音一段:1.mp3 = 这个词(舞台里同一段放慢)。没有状态。
 */
import { z } from 'zod';
import { bodyLines, type CardKind } from './kind.ts';

export const WordPropsSchema = z.object({
  /** 要写的词:字母、空格、撇号、连字符,最多 WORD_MAX 个字符、WORD_MAX_WORDS 个词 */
  word: z.string().min(1),
  /** 自然拼读分段:拼起来就是 word(非字母跟着前一段);只在舞台里分开写 */
  chunks: z.array(z.string().min(1)).min(2).optional(),
  /** 一张图:老师写的 emoji;没写看卡上的 look.emoji */
  emoji: z.string().min(1).optional(),
});
export type WordProps = z.infer<typeof WordPropsSchema>;

export const WORD_MAX = 16;
export const WORD_MAX_WORDS = 3;
/** 四线三格写得出的字:字母、空格、撇号、连字符 */
export const WORD_RE = /^[A-Za-z](?:[A-Za-z' -]*[A-Za-z])?$/;

const EMOJI = /\p{Extended_Pictographic}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*/u;
/** 中文意思、括号注释从这里起切掉(卡上不放中文) */
const CUT = /[\p{Script=Han}(（:：,，。=]/u;
const letters = (s: string): string => s.replace(/[^A-Za-z]/g, '').toLowerCase();

/** 分段行 → 按 word 切好的段;对不上(字母拼不回这个词、只有一段)→ undefined */
export function wordChunks(word: string, line: string): string[] | undefined {
  if (!/^[A-Za-z'·\-\s]+$/.test(line)) return undefined;
  const parts = line.split(/[-·\s]+/).map(letters).filter(Boolean);
  if (parts.length < 2 || parts.join('') !== letters(word)) return undefined;
  const out: string[] = [];
  let i = 0;
  for (const part of parts) {
    let chunk = '';
    let need = part.length;
    while (i < word.length && need > 0) {
      const ch = word[i++];
      chunk += ch;
      if (/[A-Za-z]/.test(ch)) need--;
    }
    // 词里的空格、撇号、连字符跟着前一段
    while (i < word.length && !/[A-Za-z]/.test(word[i])) chunk += word[i++];
    out.push(chunk);
  }
  return out;
}

export const word: CardKind<WordProps> = {
  name: 'word',
  where: ['board', 'home'],
  props: WordPropsSchema,
  parse(body) {
    const lines = bodyLines(body);
    if (!lines.length) throw new Error('要写的词呢(第一行:emoji 和英文单词)');
    let first = lines[0];
    const em = EMOJI.exec(first);
    if (em) first = first.replace(em[0], ' ');
    const cut = CUT.exec(first);
    // 「apple - 苹果」切到中文前剩个连字符:两头的非字母去掉
    const w = (cut ? first.slice(0, cut.index) : first).trim().replace(/^[\s'-]+|[\s'-]+$/g, '').replace(/\s+/g, ' ');
    if (!w) throw new Error('第一行没有英文单词(卡上只写英文,中文说在讲稿里)');
    if (!WORD_RE.test(w)) throw new Error(`「${w}」写不进四线三格:只能是字母、空格、撇号、连字符`);
    if (w.length > WORD_MAX || w.split(' ').length > WORD_MAX_WORDS) throw new Error(`一张卡一个词(最多 ${WORD_MAX_WORDS} 个词、${WORD_MAX} 个字母);整句用 read`);
    const chunks = lines.slice(1).map((l) => wordChunks(w, l)).find(Boolean);
    return { word: w, ...(chunks ? { chunks } : {}), ...(em ? { emoji: em[0] } : {}) };
  },
  assets(p) {
    return [{ file: '1.mp3', text: p.word }];
  },
};

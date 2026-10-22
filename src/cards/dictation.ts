/**
 * 听写卡(kind 名 dictation,只用在首页,《听写设计.md》):家长写一串词,孩子在首页点开,老师一个一个念、孩子在田字格里写,写完自己对。
 * 英文单词也行(拍板 15):词都是英文单词时 props.lang = 'en',孩子在四线三格里写整个单词。
 * 标签修饰 = 念的老师(cotutor.json 的键,用他的音色;不写用语文老师或第一位配了音色的);正文一行一个词,词后面空一格可以跟「怎么念」。
 * 英文单词前面可以配一个 emoji(拍板 21):只在孩子写完对一对时出,写的时候看不到。
 * 词就是答案:strip 只留几个词,孩子端首页 JSON 里没有字;听写页写完交了才拿到(src/dictation/route.ts)。
 */
import { z } from 'zod';
import { HAN } from './tianzige.ts';
import { bodyLines, type CardKind } from './kind.ts';

/** 一个词最多几个字(一个字一个田字格,同田字格卡) */
export const DICTATION_WORD_MAX = 4;
/** 英文单词最多几个字母(一个单词一个四线三格,《听写设计.md》拍板 15) */
export const DICTATION_EN_MAX = 20;
/** 英文单词:字母开头,可以带连字符与撇号(ice-cream、don't);不带空格,一行一个单词 */
export const EN_WORD_RE = /^[A-Za-z][A-Za-z'-]*$/;
export type DictationLang = 'zh' | 'en';

/** 能不能听写、是哪种:一到四个汉字 = zh;一个英文单词(≤ 20 个字母)= en;都不是 null */
export function dictationWordLang(text: string): DictationLang | null {
  const cs = Array.from(text);
  if (cs.length && cs.length <= DICTATION_WORD_MAX && cs.every((c) => HAN.test(c))) return 'zh';
  if (EN_WORD_RE.test(text) && text.length <= DICTATION_EN_MAX) return 'en';
  return null;
}
/** 一张卡最多几个词 */
export const DICTATION_WORDS_MAX = 20;
/** 念法最多几个字 */
export const DICTATION_SAY_MAX = 40;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
/** 一个 emoji:图形字符开头,后面只跟修饰符、连接符(👨‍👩‍👧、👍🏽、🇨🇳) */
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u200d|\ufe0f)*$/u;
/** 是一个 emoji 就回它(去掉两头空白),不是 undefined;英文单词配的图(《听写设计.md》拍板 21) */
export function dictationEmoji(v: unknown): string | undefined {
  const t = typeof v === 'string' ? v.trim() : '';
  return t && t.length <= 16 && EMOJI_RE.test(t) ? t : undefined;
}
const LIST_PREFIX = /^(?:[-*+]|\d+[.)、])\s*/;

export const DictationWordSchema = z.object({
  /** 要写的字,1–4 个汉字 */
  chars: z.string().min(1),
  /** 老师怎么念(「鼓励,老师鼓励我的鼓励」);没写就念词本身 */
  say: z.string().min(1).optional(),
  /** 英文单词配的 emoji(能画出来的东西才有);只在对一对时出 */
  emoji: z.string().min(1).max(16).optional(),
});
export type DictationWord = z.infer<typeof DictationWordSchema>;

export const DictationPropsSchema = z.object({
  /** 念的老师(cotutor.json 的键) */
  tutor: z.string().regex(NAME_RE).optional(),
  /** 英文单词听写(词都是英文单词);汉字的不写 */
  lang: z.literal('en').optional(),
  /** 词;孩子端剥成空的 */
  words: z.array(DictationWordSchema).max(DICTATION_WORDS_MAX),
  /** 几个词(strip 时补,孩子端首页卡上显示) */
  count: z.number().int().nonnegative().optional(),
});
export type DictationProps = z.infer<typeof DictationPropsSchema>;

export const dictation: CardKind<DictationProps> = {
  name: 'dictation',
  where: ['home'],
  props: DictationPropsSchema,
  parse(body, mods) {
    const who = mods[0];
    if (who !== undefined && !NAME_RE.test(who)) throw new Error(`「${who}」不像老师的键(cotutor.json tutors 里的英文名)`);
    if (mods.length > 1) throw new Error('标签后面只写一位老师');
    const words: DictationWord[] = [];
    for (const raw of bodyLines(body)) {
      let line = raw.replace(LIST_PREFIX, '');
      // 前面可以配一个 emoji(同单词卡的「🍎 apple」)
      const lead = /^(\S+)\s+(.+)$/.exec(line);
      const emoji = lead ? dictationEmoji(lead[1]) : undefined;
      if (emoji && lead) line = lead[2];
      const m = /^(\S+)(?:\s+(.+))?$/.exec(line);
      if (!m) continue;
      const lang = dictationWordLang(m[1]);
      if (!lang) {
        const chars = Array.from(m[1]);
        if (/^[A-Za-z]/.test(m[1])) throw new Error(`「${m[1]}」不像一个英文单词(只要字母,最多 ${DICTATION_EN_MAX} 个;一行一个单词,念法空一格写在后面)`);
        const bad = chars.find((c) => !HAN.test(c));
        if (bad) throw new Error(`「${m[1]}」里的「${bad}」不是汉字;一行一个词,念法空一格写在后面`);
        throw new Error(`「${m[1]}」超过 ${DICTATION_WORD_MAX} 个字,拆开写`);
      }
      if (words.length && (dictationWordLang(words[0].chars) ?? 'zh') !== lang) throw new Error(`「${m[1]}」:一张听写卡只写一种,汉字的词和英文单词分两张`);
      const say = m[2]?.trim();
      if (say && Array.from(say).length > DICTATION_SAY_MAX) throw new Error(`「${m[1]}」的念法超过 ${DICTATION_SAY_MAX} 个字`);
      words.push({ chars: m[1], ...(say ? { say } : {}), ...(emoji ? { emoji } : {}) });
    }
    if (!words.length) throw new Error('要听写的词呢(一行一个)');
    if (words.length > DICTATION_WORDS_MAX) throw new Error(`一张卡最多 ${DICTATION_WORDS_MAX} 个词(给了 ${words.length} 个),拆成两张`);
    const en = dictationWordLang(words[0].chars) === 'en';
    return { ...(who ? { tutor: who } : {}), ...(en ? { lang: 'en' as const } : {}), words };
  },
  strip(p) {
    return { ...(p.tutor ? { tutor: p.tutor } : {}), ...(p.lang ? { lang: p.lang } : {}), words: [], count: p.count ?? p.words.length };
  },
};

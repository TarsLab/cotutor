/**
 * 听写卡(kind 名 dictation,只用在首页,《wip/听写设想.md》):家长写一串词,孩子在首页点开,老师一个一个念、孩子在田字格里写,写完自己对。
 * 标签修饰 = 念的老师(cotutor.json 的键,用他的音色;不写用语文老师或第一位配了音色的);正文一行一个词,词后面空一格可以跟「怎么念」。
 * 词就是答案:strip 只留几个词,孩子端首页 JSON 里没有字;听写页写完交了才拿到(src/dictation/route.ts)。
 */
import { z } from 'zod';
import { HAN } from './tianzige.ts';
import { bodyLines, type CardKind } from './kind.ts';

/** 一个词最多几个字(一个字一个田字格,同田字格卡) */
export const DICTATION_WORD_MAX = 4;
/** 一张卡最多几个词 */
export const DICTATION_WORDS_MAX = 20;
/** 念法最多几个字 */
export const DICTATION_SAY_MAX = 40;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const LIST_PREFIX = /^(?:[-*+]|\d+[.)、])\s*/;

export const DictationWordSchema = z.object({
  /** 要写的字,1–4 个汉字 */
  chars: z.string().min(1),
  /** 老师怎么念(「鼓励,老师鼓励我的鼓励」);没写就念词本身 */
  say: z.string().min(1).optional(),
});
export type DictationWord = z.infer<typeof DictationWordSchema>;

export const DictationPropsSchema = z.object({
  /** 念的老师(cotutor.json 的键) */
  tutor: z.string().regex(NAME_RE).optional(),
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
      const line = raw.replace(LIST_PREFIX, '');
      const m = /^(\S+)(?:\s+(.+))?$/.exec(line);
      if (!m) continue;
      const chars = Array.from(m[1]);
      const bad = chars.find((c) => !HAN.test(c));
      if (bad) throw new Error(`「${m[1]}」里的「${bad}」不是汉字;一行一个词,念法空一格写在后面`);
      if (chars.length > DICTATION_WORD_MAX) throw new Error(`「${m[1]}」超过 ${DICTATION_WORD_MAX} 个字,拆开写`);
      const say = m[2]?.trim();
      if (say && Array.from(say).length > DICTATION_SAY_MAX) throw new Error(`「${m[1]}」的念法超过 ${DICTATION_SAY_MAX} 个字`);
      words.push({ chars: m[1], ...(say ? { say } : {}) });
    }
    if (!words.length) throw new Error('要听写的词呢(一行一个)');
    if (words.length > DICTATION_WORDS_MAX) throw new Error(`一张卡最多 ${DICTATION_WORDS_MAX} 个词(给了 ${words.length} 个),拆成两张`);
    return { ...(who ? { tutor: who } : {}), words };
  },
  strip(p) {
    return { ...(p.tutor ? { tutor: p.tutor } : {}), words: [], count: p.count ?? p.words.length };
  },
};

/**
 * 田字格卡(kind 名 tianzige):一到四个汉字,孩子端每个字一个田字格,讲到这张卡时逐笔写一遍,之后点哪个字哪个字再写一遍。
 * 笔顺数据是确定性资源(hanzi-writer-data,服务 /api/kid/tianzige/<字> 现读),老师只写字,不写笔画、不数笔画。没有状态。
 * 第二行可以写拼音(一字一个音节,声调符号或数字调),孩子端标在格子上方;多音字按这句话里的读法,老师写(《卡片协议.md》)。
 * 拼音对不上字数、不像拼音:卡照常只写字,家长视图报一句(note)。
 */
import { z } from 'zod';
import { toneMark } from '../presentation.ts';
import type { CardKind } from './kind.ts';

export const TianzigePropsSchema = z.object({
  /** 要写的字,1–4 个汉字,连着写 */
  chars: z.string().min(1),
  /** 每个字的拼音(带调号,一字一个);没写或对不上 = 没有 */
  pinyin: z.array(z.string().min(1)).optional(),
});
export type TianzigeProps = z.infer<typeof TianzigePropsSchema>;

export const HAN = /^\p{Script=Han}$/u;
export const TIANZIGE_MAX = 4;

/** 一个音节:数字调(gu3,轻声可不写数字)或一个调号(gǔ),不混写 */
const SYLLABLE = /^(?:[a-zü]+[1-5]?|[a-zü]*[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ][a-zü]*)$/;
const VOWEL = /[aeiouüāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;
const HAS_HAN = /\p{Script=Han}/u;

/** 正文 → 字那几行(连起来)与拼音那几行(没有汉字的行) */
function split(body: string): { chars: string[]; pinyin: string | null } {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const han = lines.filter((l) => HAS_HAN.test(l));
  const py = lines.filter((l) => !HAS_HAN.test(l));
  // 一行汉字都没有:当它是要写的字(报「不是汉字」),不当拼音
  if (!han.length) return { chars: Array.from(body.replace(/\s+/g, '')), pinyin: null };
  return { chars: Array.from(han.join('').replace(/\s+/g, '')), pinyin: py.length ? py.join(' ') : null };
}

/** 拼音那行 → 每字一个带调号的音节;对不上 → why */
function readPinyin(line: string, n: number): { pinyin: string[] } | { why: string } {
  const syl = line.toLowerCase().replace(/v/g, 'ü').split(/\s+/).filter(Boolean);
  const bad = syl.find((s) => !SYLLABLE.test(s) || !VOWEL.test(s));
  if (bad) return { why: `「${bad}」不像拼音` };
  if (syl.length !== n) return { why: `拼音 ${syl.length} 个音节,字 ${n} 个,要一字一个` };
  return { pinyin: syl.map(toneMark) };
}

export const tianzige: CardKind<TianzigeProps> = {
  name: 'tianzige',
  where: ['board', 'home'],
  props: TianzigePropsSchema,
  parse(body) {
    const { chars, pinyin } = split(body);
    if (!chars.length) throw new Error('要写的字呢(一到四个汉字)');
    const bad = chars.find((c) => !HAN.test(c));
    if (bad) throw new Error(`「${bad}」不是汉字;拼音写在第二行,标点写在讲稿里`);
    if (chars.length > TIANZIGE_MAX) throw new Error(`一张卡最多 ${TIANZIGE_MAX} 个字(给了 ${chars.length} 个),拆成两张`);
    const py = pinyin ? readPinyin(pinyin, chars.length) : null;
    return { chars: chars.join(''), ...(py && 'pinyin' in py ? { pinyin: py.pinyin } : {}) };
  },
  note(body, props) {
    const { pinyin } = split(body);
    if (!pinyin || props.pinyin) return null;
    const py = readPinyin(pinyin, Array.from(props.chars).length);
    return 'why' in py ? `田字格的拼音没用上(${py.why}),只写了字` : null;
  },
};

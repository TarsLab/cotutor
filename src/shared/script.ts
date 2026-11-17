/**
 * 字的样子:一个汉字、一个能写进四线三格的英文词。点字弹的田字格、单词卡(src/ui/kid/),听写的词(src/board/cards/dictation.ts)共用。
 * 2026-11-17 以前在板书的田字格卡、单词卡里;课里的卡删了,画法与这几条留给浮层用。
 */

/** 一个汉字 */
export const HAN = /^\p{Script=Han}$/u;

/** 四线三格里写得下的:字母、空格、撇号、连字符,最多 WORD_MAX 个字符 */
export const WORD_RE = /^[A-Za-z](?:[A-Za-z' -]*[A-Za-z])?$/;
export const WORD_MAX = 16;

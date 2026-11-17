/**
 * 字的样子:一个汉字、一个能写进四线三格的英文词。点字弹的田字格与四线三格(src/ui/kid/),听写的词(src/board/cards/dictation.ts)共用。
 */

/** 一个汉字 */
export const HAN = /^\p{Script=Han}$/u;

/** 四线三格里写得下的:字母、空格、撇号、连字符,最多 WORD_MAX 个字符 */
export const WORD_RE = /^[A-Za-z](?:[A-Za-z' -]*[A-Za-z])?$/;
export const WORD_MAX = 16;

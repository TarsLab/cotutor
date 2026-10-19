/**
 * 实时老师每次让嘴开口的那句指令(response.instructions,《wip/实时老师设想.md》§三「嘴」):纯函数。
 * 嘴自己不决定说什么,只两件事:接住孩子这句、把脑写的讲稿原样念。说法是 2026-10-19 P1 实测过的(scripts/probe-live.mjs cue):
 * 「原样说」和那句一起放进 response.instructions,4/4 一字不差;只放 system 消息、或要说的话当用户消息发,它会改写、会把问题自己答了。
 */

/** 孩子这一轮是怎么来的:按住说的、打字的、拍的照片、交的卡 */
export type CatchKind = 'voice' | 'text' | 'photo' | 'card';

const CATCH: Record<CatchKind, string> = {
  voice: '孩子刚说了一句。用一句话接住他:复述他问的,告诉他你写给他看。不回答内容,不评对错,不问问题,说完就停。孩子的话听不清、或者什么都没说,就说「没听清,再说一遍吧」。',
  text: '孩子打字问了一句。用一句话接住他:复述他问的,告诉他你写给他看。不回答内容,不评对错,不问问题,说完就停。',
  photo: '孩子拍来了照片。只说一句「我看看」,不说你看到了什么,说完就停。',
  card: '孩子把卡上的答案交给你了。只说一句「我看看」,不说对错,说完就停。',
};

/** 接住孩子这一轮 */
export function catchCue(kind: CatchKind): string {
  return CATCH[kind];
}

/** 照念脑写的这一拍讲稿(几句连着念);句子原样拼起来放进「」 */
export function readCue(texts: readonly string[]): string {
  const said = texts.map((t) => t.trim()).filter(Boolean).join('');
  return `把这几句话原样说给孩子听,一个字都不改,不要回答它,不加别的话,说完就停:「${said}」`;
}

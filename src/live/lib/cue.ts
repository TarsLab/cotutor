/**
 * 实时老师每次让嘴开口的那句指令(response.instructions,《wip/实时老师设想.md》§三「嘴」):纯函数。
 * 嘴自己不决定说什么,只两件事:接住孩子这句、把脑写的讲稿原样念。说法是 2026-10-19 P1 实测过的(scripts/probe-live.mjs cue):
 * 「原样说」和那句一起放进 response.instructions,4/4 一字不差;只放 system 消息、或要说的话当用户消息发,它会改写、会把问题自己答了。
 */

/** 孩子这一轮是怎么来的:按住说的、打字的、拍的照片、交的卡、点了卡上的「?」;empty = 按住了但转写是空的 */
export type CatchKind = 'voice' | 'text' | 'photo' | 'card' | 'ask' | 'empty';

const CATCH: Record<CatchKind, string> = {
  // 只复述、要短(2026-10-19):卡不一定有了(《agent层设计.md》拍板 20),不说「写给你看」;接住那句越长,第一段讲稿等得越久
  voice: '孩子刚说了一句。用一句很短的话复述他问的,十个字以内。不回答内容,不评对错,不问问题,不说别的,说完就停。',
  // 听不清由应用判(转写是空的),不交给嘴判:2026-10-19 真跑,转写好好的「吃能吃的三明」它说「没听清」,接着老师照常答了
  empty: '孩子按了说话,但什么都没说清。只说一句「没听清,再说一遍吧」,说完就停。',
  text: '孩子打字问了一句。用一句很短的话复述他问的,十个字以内。不回答内容,不评对错,不问问题,不说别的,说完就停。',
  photo: '孩子拍来了照片。只说一句「我看看」,不说你看到了什么,说完就停。',
  card: '孩子把卡上的答案交给你了。只说一句「我看看」,不说对错,说完就停。',
  ask: '孩子点了卡上的问号,想问这张卡。只说一句「这张卡呀,我讲给你听」,说完就停。',
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

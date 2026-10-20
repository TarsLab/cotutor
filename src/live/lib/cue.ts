/**
 * 实时老师每次让嘴开口的那句指令(response.instructions,《wip/实时老师设想.md》§三「嘴」):纯函数。
 * 嘴自己不决定说什么,只两件事:几种场合先说一句(拍照、没听清、热身)、把脑写的讲稿原样念。说法是 2026-10-19 P1 实测过的(scripts/probe-live.mjs cue):
 * 「原样说」和那句一起放进 response.instructions,4/4 一字不差;只放 system 消息、或要说的话当用户消息发,它会改写、会把问题自己答了。
 */

/**
 * 孩子这一轮是怎么来的:按住说的、打字的、拍的照片、交的卡、点了卡上的「?」、点了首页的按钮(activity 的开场、接着);
 * answer = 按住说的、上一句念给他的是问句(看图说话这种一问一答);empty = 按住了但转写是空的;
 * warm = 口语单拍好、进来上口语课(《wip/口语课改实时老师设计.md》§三之一),嘴先说要热身
 */
export type CatchKind = 'voice' | 'answer' | 'text' | 'photo' | 'card' | 'ask' | 'start' | 'empty' | 'warm';

/**
 * 嘴先说的那句;没写的那几种嘴不出声,等脑的第一句(《wip/实时老师设想.md》拍板 14)。
 * 10-20 晚 Ray 真用:「好,我讲给你听」「我想一想怎么讲」每轮都有,和孩子说的对不上(「老师。」也接成讲给你听),脑还常把它再说一遍;脑的第一句 3–5 秒就到
 */
const CATCH: Partial<Record<CatchKind, string>> = {
  // 拍照脑要读 14–29 秒,先说一句;说明白看的是孩子发的图片
  photo: '孩子拍来了照片。只说一句「我看一看图片」,不说你看到了什么,说完就停。',
  // 听不清由应用判(转写是空的),不交给脑,嘴不说孩子就不知道要再说一遍
  empty: '孩子按了说话,但什么都没说清。只说一句「没听清,再说一遍吧」,说完就停。',
  warm: '孩子拍好了今天的口语单,要开始上口语课。只说一句「好,我们先热热身!」,说完就停。',
};

/**
 * 口语课打电话那段(《wip/口语课改实时老师设计.md》§三之五):老师说英文,嘴先说的也换英文。
 * 指令照旧用中文写(嘴听得懂),要它说的是英文
 */
const CATCH_EN: Partial<Record<CatchKind, string>> = {
  photo: '孩子拍来了照片。只说一句「Let me look at your picture.」,不说你看到了什么,说完就停。',
  empty: '孩子说了,但什么都没说清。只说一句「Sorry? Say it again.」,说完就停。',
  warm: '孩子要开始上口语课。只说一句「Okay, let\'s start!」,说完就停。',
};

/** 这一轮嘴先说的那句的指令;null = 嘴不出声。en = 口语课打电话那段 */
export function catchCue(kind: CatchKind, lang: 'zh' | 'en' = 'zh'): string | null {
  return (lang === 'en' ? CATCH_EN : CATCH)[kind] ?? null;
}

/**
 * 交给嘴之前,把它念不好的写法换成念法(板上、字幕照旧是原文)。2026-10-20 真连(照念 → 声音转写回字):× + − = ÷ > 1/2 都念对;
 * 空括号念成「空格」「括号」(「每份都是( )个」成了「每份都是空格」),□ 念得含糊(「□+5=12」听成「正五等于十二」)。
 * 空括号、下划线的空照数学老师的说法念「几」(「二四得几」「每份都是几个」),□ 念「方框」;换了以后「方框+5」的 + 念成「正」,
 * 所以运算符一律换成字(+ 加、− 减、× 乘、÷ 除以、= 等于、> 大于、< 小于;ASCII 的 - 只在两个数之间算减)。
 */
export function spoken(text: string): string {
  return text
    .replace(/[(（][\s\u3000]*[)）]/g, '几')
    .replace(/_{2,}/g, '几')
    .replace(/□/g, '方框')
    .replace(/\s*[+＋]\s*/g, '加')
    .replace(/\s*[−－]\s*/g, '减')
    .replace(/(\d)\s*-\s*(?=\d)/g, '$1减')
    .replace(/\s*[×✕]\s*/g, '乘')
    .replace(/\s*÷\s*/g, '除以')
    .replace(/\s*[=＝]\s*/g, '等于')
    .replace(/\s*[>＞]\s*/g, '大于')
    .replace(/\s*[<＜]\s*/g, '小于');
}

/** 照念脑写的这一拍讲稿(几句连着念);句子换成念法(spoken)、原样拼起来放进「」 */
export function readCue(texts: readonly string[]): string {
  const said = texts.map((t) => spoken(t.trim())).filter(Boolean).join('');
  return `把这几句话原样说给孩子听,一个字都不改,不要回答它,不加别的话,说完就停:「${said}」`;
}

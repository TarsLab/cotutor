/**
 * 实时老师每次让嘴开口的那句指令(response.instructions):纯函数。
 * 嘴自己不决定说什么,只三件事:几种场合先说一句(拍照、没听清、收笔)、把脑写的讲稿原样念、嘴先答的 activity 里在脑给的范围里接孩子的作答(replyCue)。说法是 2026-10-19 P1 实测过的(scripts/probe-live.mjs cue):
 * 「原样说」和那句一起放进 response.instructions,4/4 一字不差;只放 system 消息、或要说的话当用户消息发,它会改写、会把问题自己答了。
 */

/**
 * 孩子这一轮是怎么来的:按住说的、打字的、拍的照片、交的卡、点了首页的按钮(activity 的开场、接着);
 * answer = 按住说的、上一句念给他的是问句(看图说话这种一问一答);empty = 按住了但转写是空的;
 * pen = 孩子在页上写完停了笔,应用替他交给老师(src/runtime/live/pen.ts)
 */
export type CatchKind = 'voice' | 'answer' | 'text' | 'photo' | 'card' | 'start' | 'empty' | 'away' | 'retry' | 'pen';

/**
 * 嘴先说的那句;没写的那几种嘴不出声,等脑的第一句。
 * 10-20 晚 Ray 真用:「好,我讲给你听」「我想一想怎么讲」每轮都有,和孩子说的对不上(「老师。」也接成讲给你听),脑还常把它再说一遍;脑的第一句 3–5 秒就到
 */
const CATCH: Partial<Record<CatchKind, string>> = {
  // 拍照脑要读 14–29 秒,先说一句;说明白看的是孩子发的图片
  photo: '孩子拍来了照片。只说一句「我看一看图片」,不说你看到了什么,说完就停。',
  // 听不清由应用判(转写是空的),不交给脑,嘴不说孩子就不知道要再说一遍
  empty: '孩子按了说话,但什么都没说清。只说一句「没听清,再说一遍吧」,说完就停。',
  // 收笔:脑要看图判他写的,要等 10–20 秒(阶段 0.1 量的),先接住;不说对不对
  pen: '孩子在页上写完了,停了笔。只说一句「我看看你写的」,不说对不对,说完就停。',
  // 脑这一轮没成,一句也没写出来(2026-11-14:Token Plan 拒了一下午,孩子说了 10 次老师一声不出)。不说错、不说为什么:
  // away = 要家长动手的(欠费、key、业务空间),孩子再说也没用;retry = 断流、网络抖一下,再说一遍多半就好
  away: '老师这边接不上了。只说一句「老师这会儿接不上了,请爸爸妈妈来看一看吧」,说完就停。',
  retry: '老师刚才没接上孩子的话。只说一句「刚才老师没听全,你再说一遍吧」,说完就停。',
};

/** 这一轮嘴先说的那句的指令;null = 嘴不出声 */
export function catchCue(kind: CatchKind): string | null {
  return CATCH[kind] ?? null;
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


/**
 * 嘴先答(activity 头上 reply: mouth;2026-11-17《多模态教学harness-开发计划》阶段 4 任务 2):老师这一轮最后一句请孩子说一句([[请 说 …]]),孩子答了,
 * 嘴先在脑给的范围里回应——范围就是那句问话(ask)和要他说出的那一句(want)。hit = 说出来了:一句接住(脑接着写下一步,这句当这一轮的接住);
 * miss = 还没说出来:提示一下、请他再说一遍(连着两次还不行就交给脑)。嘴不讲新内容、不评对错。img = 孩子眼前那一块的图跟着他那段声音进了对话
 */
export interface ReplyScope { ask: string; want: string; heard: string; img?: boolean }

export function replyCue(kind: 'hit' | 'miss', s: ReplyScope): string {
  const lines = [
    `孩子在作答。老师刚才说:「${s.ask.trim()}」,这一步要他说出:「${s.want.trim()}」。`,
    `他刚才说的你听到了(转写是「${s.heard.trim()}」,转写会往像的词上靠,不一定准)${s.img ? ';那张图是他眼前的那一页' : ''}。`,
  ];
  if (kind === 'hit') lines.push('他说出来了。用一句很短的话接住他,可以把那一句完整地再说一遍。不说「真棒」「Good job」这类夸奖,不问新问题,不讲新内容。');
  else lines.push('他还没说出来。给他一个很短的提示,再请他说一遍:可以说出开头的一个词,或者用一句中文点一下意思。不把整句说出来,不评对错,不讲新内容。');
  lines.push('用老师那句话的语言说(老师说英文你就说英文),一两句,说完就停。');
  return lines.join('\n');
}
